import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const { openPdf } = await import("../src/pdfSession.ts");

  await testSuccessfulResolution(openPdf);
  await testJpxResolution(openPdf);
  await testMalformedResolution(openPdf);
  await testCancellation(openPdf);
  await testCloseCancellation(openPdf);
  await testMissingResolver(openPdf);

  console.log("Direct PDF image-codec resolver tests passed.");
} finally {
  hooks.deregister();
}

async function testSuccessfulResolution(openPdf) {
  const callerSamples = Buffer.from([10, 20, 30]);
  const requests = [];
  const session = await openPdf(
    { kind: "bytes", bytes: codecImageFixture() },
    {
      imageCodecResolver(request, signal) {
        assert.equal(signal?.aborted, false);
        requests.push(request);
        assert.equal(request.codec, "jpeg");
        assert.equal(request.width, 1);
        assert.equal(request.height, 1);
        assert.equal(request.components, 3);
        assert.equal(request.bitsPerComponent, 8);
        assert.equal(request.imageMask, false);
        assert.deepEqual([...request.encoded], [0xff, 0xd8, 0xff, 0xd9]);
        return {
          samples: callerSamples,
          width: 1,
          height: 1,
          components: 3,
          bitsPerComponent: 8
        };
      }
    }
  );
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    assert.equal(requests.length, 1, "one image identity is decoded once per page registry");
    assert.deepEqual([...callerSamples], [10, 20, 30],
      "the direct parser must not mutate caller-owned codec output");
    assert.deepEqual([...page.stores.images.data], [10, 20, 30, 255]);
    assert.deepEqual([...page.stores.images.formats], [0]);
    assert.deepEqual([...page.stores.images.bitsPerComponent], [8]);
  } finally {
    await session.close();
  }
}

async function testJpxResolution(openPdf) {
  let requestSeen;
  const session = await openPdf(
    { kind: "bytes", bytes: jpxImageFixture(true, 1) },
    {
      imageCodecResolver(request) {
        requestSeen = request;
        return {
          samples: Uint8Array.of(128, 64),
          width: 1,
          height: 1,
          components: 2,
          bitsPerComponent: 8
        };
      }
    }
  );
  try {
    const page = await session.compilePage(0);
    assert.equal(requestSeen.codec, "jpeg2000");
    assert.equal(requestSeen.bitsPerComponent, 0,
      "JPX precision is codec-defined and reported by the resolver result");
    assert.equal(requestSeen.components, 2,
      "straight embedded JPX opacity is the final decoded component");
    assert.deepEqual([...page.stores.images.data], [128, 128, 128, 64]);
    assert.deepEqual([...page.stores.images.bitsPerComponent], [8]);
  } finally {
    await session.close();
  }

  let omittedColorResolverCalls = 0;
  const omittedColor = await openPdf(
    { kind: "bytes", bytes: jpxImageFixture(false, 0) },
    {
      imageCodecResolver() {
        omittedColorResolverCalls += 1;
        throw new Error("must remain unreachable");
      }
    }
  );
  try {
    await assert.rejects(
      omittedColor.compilePage(0),
      (error) => error?.code === "unsupported-image" &&
        error?.details?.reason === "jpx-codec-defined-color-space"
    );
    assert.equal(omittedColorResolverCalls, 0,
      "raw samples cannot resolve an omitted JPX managed color space");
  } finally {
    await omittedColor.close();
  }
}

async function testMalformedResolution(openPdf) {
  for (const resolution of [
    {
      samples: Uint8Array.of(1, 2, 3, 4, 5, 6),
      width: 2,
      height: 1,
      components: 3,
      bitsPerComponent: 8
    },
    {
      samples: Uint8Array.of(1, 2),
      width: 1,
      height: 1,
      components: 3,
      bitsPerComponent: 8
    },
    {
      samples: Uint8Array.of(1, 2, 3, 4),
      width: 1,
      height: 1,
      components: 4,
      bitsPerComponent: 8
    }
  ]) {
    const session = await openPdf(
      { kind: "bytes", bytes: codecImageFixture() },
      { imageCodecResolver: () => resolution }
    );
    try {
      await assert.rejects(
        session.compilePage(0, { optimization: "none" }),
        (error) => error?.code === "unsupported-image" &&
          error?.details?.reason === "invalid-codec-result"
      );
    } finally {
      await session.close();
    }
  }
}

async function testCancellation(openPdf) {
  let resolverSignal;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const session = await openPdf(
    { kind: "bytes", bytes: codecImageFixture() },
    {
      imageCodecResolver(_request, signal) {
        resolverSignal = signal;
        markStarted();
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
    }
  );
  try {
    const controller = new AbortController();
    const compiling = session.compilePage(0, { signal: controller.signal });
    await started;
    controller.abort("cancel direct codec fixture");
    await assert.rejects(compiling, (error) => error?.code === "aborted");
    assert.equal(resolverSignal.aborted, true);
  } finally {
    await session.close();
  }
}

async function testCloseCancellation(openPdf) {
  let resolverSignal;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const session = await openPdf(
    { kind: "bytes", bytes: codecImageFixture() },
    {
      imageCodecResolver(_request, signal) {
        resolverSignal = signal;
        markStarted();
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
    }
  );
  const compiling = session.compilePage(0);
  await started;
  await session.close();
  await assert.rejects(
    compiling,
    (error) => error?.code === "closed" || error?.code === "aborted"
  );
  assert.equal(resolverSignal.aborted, true,
    "closing a direct session must abort the active codec invocation");
}

async function testMissingResolver(openPdf) {
  const session = await openPdf({ kind: "bytes", bytes: codecImageFixture() });
  try {
    await assert.rejects(
      session.compilePage(0, { optimization: "none" }),
      (error) => error?.code === "unsupported-image" && error?.details?.codec === "jpeg"
    );
  } finally {
    await session.close();
  }
}

function codecImageFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    {
      number: 3,
      body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << /XObject << /Im 5 0 R /Alias 5 0 R >> >> /Contents 4 0 R >>"
    },
    { number: 4, body: tinyPdfStream("", "/Im Do /Alias Do") },
    {
      number: 5,
      body: tinyPdfStream(
        "/Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode",
        Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)
      )
    }
  ] });
}

function jpxImageFixture(explicitColorSpace, softMaskInData) {
  const dictionary = [
    "/Type /XObject /Subtype /Image /Width 1 /Height 1",
    explicitColorSpace ? "/ColorSpace /DeviceGray" : "",
    softMaskInData === 0 ? "" : `/SMaskInData ${softMaskInData}`,
    "/Filter /JPXDecode"
  ].filter(Boolean).join(" ");
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    {
      number: 3,
      body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << /XObject << /Im 5 0 R >> >> /Contents 4 0 R >>"
    },
    { number: 4, body: tinyPdfStream("", "/Im Do") },
    { number: 5, body: tinyPdfStream(dictionary, Uint8Array.of(0xff, 0x4f, 0xff, 0xd9)) }
  ] });
}
