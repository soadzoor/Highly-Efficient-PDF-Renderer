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
  const [
    { openPdf },
    { openPdfInNodeWorker, openPdfWithWorkerEndpoint },
    { attachPdfWorkerRuntime },
    { HEPR_COLOR_SPACE_KIND }
  ] = await Promise.all([
    import("../src/pdfSession.ts"),
    import("../src/pdf/workerClient.ts"),
    import("../src/pdf/workerRuntime.ts"),
    import("../src/heprDocumentData.ts")
  ]);

  await testDirectResolution(openPdf, HEPR_COLOR_SPACE_KIND.IccBased);
  await testMalformedResolution(openPdf);
  await testResourceLimit(openPdf);
  await testDirectCancellation(openPdf);
  await testCloneWorkerResolution(
    openPdfWithWorkerEndpoint,
    attachPdfWorkerRuntime,
    HEPR_COLOR_SPACE_KIND.IccBased
  );
  await testCloneWorkerMalformed(openPdfWithWorkerEndpoint, attachPdfWorkerRuntime);
  await testCloneWorkerCancellation(openPdfWithWorkerEndpoint, attachPdfWorkerRuntime);
  await testNodeWorkerResolution(openPdfInNodeWorker);

  console.log("Direct, browser-style, and Node ICC transform resolver tests passed.");
} finally {
  hooks.deregister();
}

async function testDirectResolution(openPdf, iccKind) {
  let calls = 0;
  let callerSamples;
  const session = await openPdf(
    { kind: "bytes", bytes: iccFixture() },
    {
      iccTransformResolver(request, signal) {
        calls += 1;
        assert.equal(signal?.aborted, false);
        assertRequest(request);
        const transferred = transferRequestArrays(request);
        callerSamples = Buffer.from(identityRgbSamples(
          transferred.inputSamples,
          request.sampleCount,
          request.inputComponents
        ));
        return transformResult(callerSamples, request.sampleCount);
      }
    }
  );
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    assert.equal(calls, 1, "one ICC profile identity should build one transform lattice");
    assert.equal(callerSamples.byteLength, 33 ** 3 * 3,
      "direct parsing must retain caller ownership of transform output");
    assertRgb(pagePaintRgb(page), [1, 0, 0]);

    const colorIndex = page.stores.colors.spaceKinds.indexOf(iccKind);
    assert(colorIndex >= 0);
    const profileStart = page.stores.colors.profileOffsets[colorIndex];
    assert.equal(page.stores.colors.profiles[profileStart + 36], "a".charCodeAt(0),
      "transferring resolver input must not detach or mutate the retained ICC profile");
  } finally {
    await session.close();
  }
}

async function testMalformedResolution(openPdf) {
  const session = await openPdf(
    { kind: "bytes", bytes: iccFixture() },
    {
      iccTransformResolver(request) {
        return transformResult(new Uint8Array(request.sampleCount * 3 - 1), request.sampleCount);
      }
    }
  );
  try {
    await assert.rejects(
      session.compilePage(0),
      (error) => error?.code === "unsupported-color" &&
        error?.details?.reason === "invalid-icc-transform-result"
    );
  } finally {
    await session.close();
  }
}

async function testResourceLimit(openPdf) {
  let calls = 0;
  const session = await openPdf(
    { kind: "bytes", bytes: iccFixture() },
    {
      limits: { maxIccTransformBytes: 1_000 },
      iccTransformResolver() {
        calls += 1;
        throw new Error("must remain unreachable");
      }
    }
  );
  try {
    await assert.rejects(
      session.compilePage(0),
      (error) => error?.code === "resource-limit" &&
        error?.details?.reason === "icc-transform-bytes"
    );
    assert.equal(calls, 0, "the transform working-set limit must run before the callback");
  } finally {
    await session.close();
  }
}

async function testDirectCancellation(openPdf) {
  let resolverSignal;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const session = await openPdf(
    { kind: "bytes", bytes: iccFixture() },
    {
      iccTransformResolver(_request, signal) {
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
    controller.abort("cancel direct ICC fixture");
    await assert.rejects(compiling, (error) => error?.code === "aborted");
    assert.equal(resolverSignal.aborted, true);
  } finally {
    await session.close();
  }
}

async function testCloneWorkerResolution(
  openPdfWithWorkerEndpoint,
  attachPdfWorkerRuntime,
  iccKind
) {
  const [hostEndpoint, workerEndpoint] = linkedCloneEndpoints();
  const runtime = attachPdfWorkerRuntime(workerEndpoint);
  let callerSamples;
  let calls = 0;
  const session = await openPdfWithWorkerEndpoint(
    { kind: "bytes", bytes: iccFixture() },
    {
      iccTransformResolver(request, signal) {
        calls += 1;
        assert.equal(signal?.aborted, false);
        assertRequest(request);
        const transferred = transferRequestArrays(request);
        callerSamples = Buffer.from(identityRgbSamples(
          transferred.inputSamples,
          request.sampleCount,
          request.inputComponents
        ));
        return transformResult(callerSamples, request.sampleCount);
      }
    },
    hostEndpoint
  );
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    assert.equal(calls, 1);
    assert.equal(callerSamples.byteLength, 33 ** 3 * 3,
      "worker response transfer must use an isolated copy of caller output");
    assertRgb(pagePaintRgb(page), [1, 0, 0]);
    assert(page.stores.colors.spaceKinds.includes(iccKind));
  } finally {
    await session.close();
    await runtime.close();
  }
}

async function testCloneWorkerCancellation(openPdfWithWorkerEndpoint, attachPdfWorkerRuntime) {
  const [hostEndpoint, workerEndpoint] = linkedCloneEndpoints();
  const runtime = attachPdfWorkerRuntime(workerEndpoint);
  let resolverSignal;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const session = await openPdfWithWorkerEndpoint(
    { kind: "bytes", bytes: iccFixture() },
    {
      iccTransformResolver(_request, signal) {
        resolverSignal = signal;
        markStarted();
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
    },
    hostEndpoint
  );
  const controller = new AbortController();
  const compiling = session.compilePage(0, { signal: controller.signal });
  await started;
  controller.abort("cancel worker ICC fixture");
  await assert.rejects(compiling, (error) => error?.code === "aborted");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(resolverSignal.aborted, true,
    "worker cancellation must abort only the matching host ICC invocation");
  await session.close();
  await runtime.close();
}

async function testCloneWorkerMalformed(openPdfWithWorkerEndpoint, attachPdfWorkerRuntime) {
  const [hostEndpoint, workerEndpoint] = linkedCloneEndpoints();
  const runtime = attachPdfWorkerRuntime(workerEndpoint);
  const session = await openPdfWithWorkerEndpoint(
    { kind: "bytes", bytes: iccFixture() },
    {
      iccTransformResolver(request) {
        return transformResult(
          new Uint8Array(request.sampleCount * 3 - 1),
          request.sampleCount
        );
      }
    },
    hostEndpoint
  );
  try {
    await assert.rejects(
      session.compilePage(0),
      (error) => error?.code === "unsupported-color" &&
        error?.details?.reason === "invalid-icc-transform-result"
    );
  } finally {
    await session.close();
    await runtime.close();
  }
}

async function testNodeWorkerResolution(openPdfInNodeWorker) {
  const workerUrl = sourceWorkerBootstrapUrl(
    new URL("../src/pdf/pdfWorkerEntry.ts", import.meta.url)
  );
  let calls = 0;
  let callerSamples;
  const session = await openPdfInNodeWorker(
    { kind: "bytes", bytes: iccFixture() },
    {
      workerUrl,
      workerName: "hepr-icc-transform-test",
      iccTransformResolver(request, signal) {
        calls += 1;
        assert.equal(signal?.aborted, false);
        assertRequest(request);
        callerSamples = Buffer.from(identityRgbSamples(
          request.inputSamples,
          request.sampleCount,
          request.inputComponents
        ));
        return transformResult(callerSamples, request.sampleCount);
      }
    }
  );
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    assert.equal(calls, 1);
    assert.equal(callerSamples.byteLength, 33 ** 3 * 3);
    assertRgb(pagePaintRgb(page), [1, 0, 0]);
  } finally {
    await session.close();
  }
}

function iccFixture() {
  const profile = createRgbIccHeader();
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    {
      number: 3,
      body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << /ColorSpace << /ICC [/ICCBased 5 0 R] >> >> /Contents 4 0 R >>"
    },
    { number: 4, body: tinyPdfStream("", "/ICC cs 1 0 0 sc 0 0 10 10 re f") },
    { number: 5, body: tinyPdfStream("/N 3 /Alternate /DeviceRGB", profile) }
  ] });
}

function createRgbIccHeader() {
  const profile = new Uint8Array(128);
  new DataView(profile.buffer).setUint32(0, profile.length, false);
  profile[8] = 4;
  writeAscii(profile, 12, "mntr");
  writeAscii(profile, 16, "RGB ");
  writeAscii(profile, 20, "XYZ ");
  writeAscii(profile, 36, "acsp");
  return profile;
}

function assertRequest(request) {
  assert.equal(request.inputComponents, 3);
  assert.equal(request.gridPointsPerComponent, 33);
  assert.equal(request.sampleCount, 33 ** 3);
  assert.equal(request.inputSamples.byteLength, request.sampleCount * 3);
  assert.equal(request.profile.byteLength, 128);
  assert.equal(request.metadata.dataColorSpace, "RGB ");
  assert.equal(request.renderingIntent, "relative-colorimetric");
}

function identityRgbSamples(input, sampleCount, inputComponents) {
  const samples = new Uint8Array(sampleCount * 3);
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const inputOffset = sample * inputComponents;
    const outputOffset = sample * 3;
    samples[outputOffset] = input[inputOffset];
    samples[outputOffset + 1] = input[inputOffset + 1];
    samples[outputOffset + 2] = input[inputOffset + 2];
  }
  return samples;
}

function transformResult(samples, sampleCount) {
  return { samples, sampleCount, outputComponents: 3, bitsPerComponent: 8 };
}

function transferRequestArrays(request) {
  return structuredClone({
    profile: request.profile,
    inputSamples: request.inputSamples
  }, { transfer: [request.profile.buffer, request.inputSamples.buffer] });
}

function pagePaintRgb(page) {
  const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
  assert.equal(root.commands.length, 1);
  const paintIndex = root.commands[0].paintIndex;
  const colorIndex = page.stores.paints.resourceIndices[paintIndex];
  const start = page.stores.colors.parameterOffsets[colorIndex];
  const end = page.stores.colors.parameterOffsets[colorIndex + 1];
  return [...page.stores.colors.parameters.subarray(start, end)];
}

function assertRgb(actual, expected, tolerance = 1 / 255) {
  assert.equal(actual.length, 3);
  for (let index = 0; index < 3; index += 1) {
    assert(Math.abs(actual[index] - expected[index]) <= tolerance,
      `${actual[index]} is not within ${tolerance} of ${expected[index]}`);
  }
}

function writeAscii(bytes, offset, value) {
  bytes.set(new TextEncoder().encode(value), offset);
}

function sourceWorkerBootstrapUrl(entryUrl) {
  const source = `
    import { registerHooks } from "node:module";
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (context.parentURL?.includes("/src/") && /^\\.\\.?\\//.test(specifier) && !specifier.endsWith(".ts")) {
          return nextResolve(specifier + ".ts", context);
        }
        return nextResolve(specifier, context);
      }
    });
    await import(${JSON.stringify(entryUrl.href)});
  `;
  return new URL(`data:text/javascript,${encodeURIComponent(source)}`);
}

function linkedCloneEndpoints() {
  const left = cloneEndpoint();
  const right = cloneEndpoint();
  left.send = (message, transfer) => queueMicrotask(() => right.dispatch(
    structuredClone(message, transfer?.length ? { transfer } : undefined)
  ));
  right.send = (message, transfer) => queueMicrotask(() => left.dispatch(
    structuredClone(message, transfer?.length ? { transfer } : undefined)
  ));
  return [left, right];
}

function cloneEndpoint() {
  const listeners = new Set();
  return {
    send: null,
    addEventListener(type, listener) {
      if (type === "message") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "message") listeners.delete(listener);
    },
    postMessage(message, transfer) {
      this.send(message, transfer);
    },
    dispatch(message) {
      for (const listener of listeners) listener({ data: message });
    }
  };
}
