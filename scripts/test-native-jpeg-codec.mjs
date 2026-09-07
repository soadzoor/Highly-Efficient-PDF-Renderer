import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.includes("/src/") &&
      /^\.\.?\//.test(specifier) &&
      !specifier.endsWith(".ts")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const {
    BUNDLED_JPEG_CODEC_ASSET,
    createBundledImageCodecResolver,
    resolveBundledImageCodec
  } = await import("../src/pdf/nativeJpegCodec.ts");
  const { PdfError } = await import("../src/pdf/nativeTypes.ts");
  const { openPdf } = await import("../src/pdfSession.ts");

  await verifyPinnedAsset(BUNDLED_JPEG_CODEC_ASSET);

  const rgb = await readFixture("rgb-8x8.jpg");
  const gray = await readFixture("gray-8x8.jpg");
  const cmyk = await readFixture("cmyk-8x8.jpg");
  const app14Cmyk = await readFixture("app14-cmyk-8x8.jpg");
  const markerlessCmyk = await readFixture("markerless-cmyk-8x8.jpg");
  const progressiveRgb = await readFixture("progressive-rgb-8x8.jpg");

  const rgbResult = await resolveBundledImageCodec(request(rgb, 3));
  assertConstantPixels(rgbResult, [16, 85, 204]);

  const grayResult = await resolveBundledImageCodec(request(gray, 1));
  assertConstantPixels(grayResult, [64]);

  const cmykResult = await resolveBundledImageCodec(request(cmyk, 4));
  assertConstantPixels(cmykResult, [191, 127, 65, 223]);
  assert.deepEqual(
    [...cmykResult.samples.subarray(0, 4)],
    [191, 127, 65, 223],
    "the pinned TurboJPEG TJPF_CMYK output is already in PDF ink polarity"
  );

  const app14OverrideYcck = await resolveBundledImageCodec({
    ...request(cmyk, 4),
    decodeParameters: { ColorTransform: 0 }
  });
  assertConstantPixels(app14OverrideYcck, [191, 127, 65, 223]);

  const app14Direct = await resolveBundledImageCodec({
    ...request(app14Cmyk, 4),
    decodeParameters: { ColorTransform: 1 }
  });
  assertConstantPixels(app14Direct, [191, 128, 64, 230]);

  const markerlessDirect = await resolveBundledImageCodec(request(markerlessCmyk, 4));
  assertConstantPixels(markerlessDirect, [191, 128, 64, 230]);

  const progressiveResult = await resolveBundledImageCodec(request(progressiveRgb, 3));
  assertConstantPixels(progressiveResult, [16, 85, 204]);

  await assert.rejects(
    resolveBundledImageCodec(request(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9), 3, 1, 1)),
    unsupportedImage
  );
  await assert.rejects(
    resolveBundledImageCodec(request(rgb, 3, 7, 8)),
    (error) => unsupportedImage(error) && error.details?.reason === "dimension-mismatch"
  );
  await assert.rejects(
    resolveBundledImageCodec(request(rgb, 4)),
    (error) => unsupportedImage(error) && error.details?.reason === "component-mismatch"
  );
  await assert.rejects(
    resolveBundledImageCodec({
      ...request(rgb, 3),
      decodeParameters: { ColorTransform: 0 }
    }),
    (error) => unsupportedImage(error) && error.details?.reason === "color-transform-unavailable"
  );
  await assert.rejects(
    resolveBundledImageCodec({
      ...request(markerlessCmyk, 4),
      decodeParameters: { ColorTransform: 1 }
    }),
    (error) => unsupportedImage(error) && error.details?.reason === "color-transform-unavailable"
  );
  await assert.rejects(
    resolveBundledImageCodec({ ...request(rgb, 3), bitsPerComponent: 12 }),
    (error) => unsupportedImage(error) && error.details?.reason === "invalid-request"
  );
  await assert.rejects(
    resolveBundledImageCodec({ ...request(rgb, 3), codec: "jpeg2000" }),
    (error) => unsupportedImage(error) && error.details?.reason === "codec-not-bundled"
  );

  for (const malformed of [
    Uint8Array.of(0xff, 0xd8, 0xff, 0xd9),
    rgb.subarray(0, rgb.length - 1),
    Uint8Array.of(0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0xff, 0xd9),
    app14Cmyk.subarray(0, 10)
  ]) {
    await assert.rejects(
      resolveBundledImageCodec(request(malformed, 3, 1, 1)),
      (error) => unsupportedImage(error) && error.details?.reason === "invalid-jpeg-markers"
    );
  }

  await assert.rejects(
    resolveBundledImageCodec(request(manyScanJpeg(0xc2, 501), 1, 1, 1)),
    (error) => unsupportedImage(error) &&
      error.details?.reason === "progressive-scan-limit" &&
      error.details?.scans === 501 && error.details?.limit === 500
  );
  await assert.rejects(
    resolveBundledImageCodec(request(manyScanJpeg(0xc0, 501), 1, 1, 1)),
    (error) => unsupportedImage(error) && error.details?.reason === "jpeg-scan-limit"
  );
  await assert.rejects(
    resolveBundledImageCodec(request(manyScanJpeg(0xc3, 1), 1, 1, 1)),
    (error) => unsupportedImage(error) && error.details?.reason === "unsupported-jpeg-frame"
  );

  await assert.rejects(
    createBundledImageCodecResolver(1_024)(request(rgb, 3)),
    (error) => error?.code === "resource-limit" &&
      error.details?.reason === "jpeg-aggregate-working-set" &&
      error.details?.limit === 1_024 &&
      error.details?.codecOverhead === 1024 * 1024 &&
      error.details?.wasmPageBytes === 64 * 1024 &&
      error.details?.bytes % (64 * 1024) === 0
  );

  const cancelled = new AbortController();
  cancelled.abort("cancel JPEG fixture");
  await assert.rejects(
    resolveBundledImageCodec(request(rgb, 3), cancelled.signal),
    (error) => error?.code === "aborted"
  );

  const pdf = jpegPdfFixture(rgb);
  const session = await openPdf({ kind: "bytes", bytes: pdf });
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    assert.equal(page.stores.images.data.length, 8 * 8 * 4);
    assert.deepEqual([...page.stores.images.data.subarray(0, 4)], [16, 85, 204, 255]);
  } finally {
    await session.close();
  }

  const app14DecodeSession = await openPdf({
    kind: "bytes",
    bytes: cmykJpegPdfFixture(app14Cmyk, {
      decode: "[1 0 1 0 1 0 1 0]",
      colorTransform: 1
    })
  });
  try {
    const page = await app14DecodeSession.compilePage(0, { optimization: "none" });
    assert.deepEqual(
      [...page.stores.images.data.subarray(0, 4)],
      [185, 125, 77, 255],
      "PDF /Decode independently inverts the decoder's APP14 CMYK samples"
    );
  } finally {
    await app14DecodeSession.close();
  }

  const mismatchSession = await openPdf({
    kind: "bytes",
    bytes: jpegPdfFixture(rgb, 7, 8)
  });
  try {
    await assert.rejects(
      mismatchSession.compilePage(0, { optimization: "none" }),
      (error) => error?.code === "unsupported-image" &&
        error.details?.codec === "jpeg" &&
        error.details?.reason === "dimension-mismatch" &&
        error.details?.expectedWidth === 7 && error.details?.actualWidth === 8
    );
  } finally {
    await mismatchSession.close();
  }

  const callerResolverSession = await openPdf(
    { kind: "bytes", bytes: pdf },
    {
      imageCodecResolver() {
        throw new PdfError("resource-limit", "untrusted caller error");
      }
    }
  );
  try {
    await assert.rejects(
      callerResolverSession.compilePage(0, { optimization: "none" }),
      (error) => error?.code === "unsupported-image" &&
        error.details?.codec === "jpeg" &&
        error.details?.reason === "codec-resolver-failed"
    );
  } finally {
    await callerResolverSession.close();
  }

  await verifyCodecPreflightLimit(openPdf, jpegPdfFixture(rgb, 64, 64));
  await verifyBundledAggregateLimit(openPdf, pdf);
  console.log("Bundled native JPEG codec tests passed.");
} finally {
  hooks.deregister();
}

async function verifyPinnedAsset(asset) {
  const bytes = await readFile(asset.url);
  assert.equal(bytes.byteLength, asset.byteLength);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256);
  assert.equal(asset.byteLength, 139_151);
  assert.equal(asset.sha256, "80ed55eef2d0ff276f837ef521fad8181ccdfa6f298f652f6e45aed7fbbbc871");
  assert.equal(asset.sourcePackage, "@cwasm/jpeg-turbo@0.1.3");
  assert.equal(asset.sourceCommit, "61bcc6c3fa933c796ee9b64c5ea9821966ef8e42");
}

async function readFixture(name) {
  const bytes = new Uint8Array(await readFile(new URL(`./fixtures/jpeg/${name}`, import.meta.url)));
  const hashes = {
    "app14-cmyk-8x8.jpg": "768d7c9a7316b16996f4db6ce280fd8da3ee494cc7d946e7f1143a17ab04ee04",
    "markerless-cmyk-8x8.jpg": "f8c1d448c6b1b61c17431a201603d134602df516ba76de698a80154e9b97975a",
    "progressive-rgb-8x8.jpg": "cc65630e9789708dc17810d079bcff0072ddacbd1897fe831741eeaad2a839a3"
  };
  if (hashes[name]) {
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hashes[name]);
  }
  return bytes;
}

function request(encoded, components, width = 8, height = 8) {
  return {
    codec: "jpeg",
    width,
    height,
    components,
    bitsPerComponent: 8,
    imageMask: false,
    encoded,
    globals: new Uint8Array(0),
    decodeParameters: {}
  };
}

function assertConstantPixels(result, expected) {
  assert.equal(result.width, 8);
  assert.equal(result.height, 8);
  assert.equal(result.components, expected.length);
  assert.equal(result.bitsPerComponent, 8);
  assert.equal(result.samples.length, 8 * 8 * expected.length);
  for (let offset = 0; offset < result.samples.length; offset += expected.length) {
    assert.deepEqual([...result.samples.subarray(offset, offset + expected.length)], expected);
  }
}

function unsupportedImage(error) {
  return error?.code === "unsupported-image" && error.details?.codec === "jpeg";
}

async function verifyCodecPreflightLimit(openPdf, pdf) {
  for (const placement of ["session", "compilation"]) {
    let resolverCalls = 0;
    const options = {
      imageCodecResolver() {
        resolverCalls += 1;
        throw new Error("lowered image limit must reject before codec invocation");
      }
    };
    if (placement === "session") options.limits = { maxDecodedStreamBytes: 1_024 };
    const session = await openPdf({ kind: "bytes", bytes: pdf }, options);
    try {
      await assert.rejects(
        session.compilePage(0, placement === "compilation"
          ? { optimization: "none", limits: { maxDecodedStreamBytes: 1_024 } }
          : { optimization: "none" }),
        (error) => error?.code === "resource-limit" && error.details?.limit === 1_024
      );
      assert.equal(resolverCalls, 0, `${placement} limit must preflight codec allocation`);
    } finally {
      await session.close();
    }
  }
}

async function verifyBundledAggregateLimit(openPdf, pdf) {
  for (const placement of ["session", "compilation"]) {
    const session = await openPdf(
      { kind: "bytes", bytes: pdf },
      placement === "session" ? { limits: { maxDecodedStreamBytes: 1_024 } } : undefined
    );
    try {
      await assert.rejects(
        session.compilePage(0, placement === "compilation"
          ? { optimization: "none", limits: { maxDecodedStreamBytes: 1_024 } }
          : { optimization: "none" }),
        (error) => error?.code === "resource-limit" &&
          error.details?.codec === "jpeg" &&
          error.details?.reason === "jpeg-aggregate-working-set" &&
          error.details?.limit === 1_024
      );
    } finally {
      await session.close();
    }
  }
}

function manyScanJpeg(frameMarker, scans) {
  const output = [
    0xff, 0xd8,
    0xff, frameMarker, 0x00, 0x0b,
    0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00
  ];
  for (let index = 0; index < scans; index += 1) {
    output.push(0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00);
  }
  output.push(0xff, 0xd9);
  return Uint8Array.from(output);
}

function jpegPdfFixture(jpeg, width = 8, height = 8) {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    {
      number: 3,
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im 5 0 R >> >> /Contents 4 0 R >>`
    },
    { number: 4, body: tinyPdfStream("", "q 8 0 0 8 0 0 cm /Im Do Q") },
    {
      number: 5,
      body: tinyPdfStream(
        `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode`,
        jpeg
      )
    }
  ] });
}

function cmykJpegPdfFixture(jpeg, { decode = "", colorTransform } = {}) {
  const decodeEntry = decode ? ` /Decode ${decode}` : "";
  const decodeParameters = colorTransform === undefined
    ? ""
    : ` /DecodeParms << /ColorTransform ${colorTransform} >>`;
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    {
      number: 3,
      body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 8 8] /Resources << /XObject << /Im 5 0 R >> >> /Contents 4 0 R >>"
    },
    { number: 4, body: tinyPdfStream("", "q 8 0 0 8 0 0 cm /Im Do Q") },
    {
      number: 5,
      body: tinyPdfStream(
        `/Type /XObject /Subtype /Image /Width 8 /Height 8 /BitsPerComponent 8 /ColorSpace /DeviceCMYK${decodeEntry} /Filter /DCTDecode${decodeParameters}`,
        jpeg
      )
    }
  ] });
}
