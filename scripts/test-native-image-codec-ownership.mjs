import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { imagePdf, tinyJbig2 } from "./lib/imageCodecFixtures.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

try {
  const [{ openNativePdfDocument }, { NativePdfImageRegistry }, { createBundledImageCodecResolver },
    { registerBundledJpxResolver, isBundledJpxResolver }] = await Promise.all([
    import("../src/pdf/nativeDocument.ts"), import("../src/pdf/nativeImage.ts"),
    import("../src/pdf/nativeJpegCodec.ts"), import("../src/sourceJpxRaster.ts")
  ]);
  const jpx = new Uint8Array(await readFile(new URL("./fixtures/codecs/rgb-8x8.jp2", import.meta.url)));
  const jpeg = new Uint8Array(await readFile(new URL("./fixtures/jpeg/rgb-8x8.jpg", import.meta.url)));
  const bundled = createBundledImageCodecResolver();
  assert(isBundledJpxResolver(bundled), "only the package resolver receives the JPX ownership brand");
  const imageRef = { kind: "ref", objectNumber: 5, generation: 0 };

  async function check({ trusted, branded, encoded = jpx, filter = "JPXDecode", options = {}, expectedCopies,
    expectedPixel = [16, 85, 204, 255] }) {
    const document = await openNativePdfDocument({ kind: "bytes", bytes: imagePdf(encoded, { filter, ...options }) });
    let result, copies = 0;
    const resolve = async (request, signal) => result = await bundled(request, signal);
    // This internal wrapper observes the real bundled operation-owned plane;
    // ordinary caller wrappers never inherit its identity brand.
    const resolver = branded ? registerBundledJpxResolver(resolve) : resolve;
    const originalSet = Uint8Array.prototype.set;
    Uint8Array.prototype.set = function (source, offset) {
      if (source === result?.samples) copies++;
      return originalSet.call(this, source, offset);
    };
    try {
      const registry = new NativePdfImageRegistry(document, undefined, { codecResolver: resolver, trustedCodecResolver: trusted });
      const index = await registry.add(imageRef), image = registry.describe(index), snapshot = image.data.slice();
      assert.equal(copies, expectedCopies, "only trusted, branded JPX planes avoid a second full sample allocation");
      assert.deepEqual(Array.from(image.data.subarray(0, 4)), expectedPixel);
      assert.equal(result.samples.byteOffset, 0);
      assert.equal(result.samples.byteLength, result.samples.buffer.byteLength,
        "the bundled result owns a standalone JavaScript plane rather than a decoder heap view");
      result.samples.fill(123);
      assert.deepEqual(image.data, snapshot, "canonical image resources do not expose codec sample storage");
      const next = await bundled(registry.getCodecRequests()[0]);
      assert.notEqual(next.samples.buffer, result.samples.buffer, "a later decode owns a fresh plane");
      assert.notEqual(next.samples[0], 123, "a previous result mutation cannot corrupt another decode");
    } finally {
      Uint8Array.prototype.set = originalSet;
      await document.close();
    }
  }
  await check({ trusted: true, branded: true, expectedCopies: 0 });
  await check({ trusted: false, branded: true, expectedCopies: 1 });
  await check({ trusted: true, branded: false, expectedCopies: 1 });
  await check({ trusted: false, branded: false, expectedCopies: 1 });
  await check({ trusted: true, branded: true, expectedCopies: 1, encoded: jpeg, filter: "DCTDecode" });
  await check({ trusted: true, branded: true, expectedCopies: 1, encoded: tinyJbig2(), filter: "JBIG2Decode",
    options: { width: 8, height: 2, colorSpace: "/DeviceGray", bitsPerComponent: 1 }, expectedPixel: [255, 255, 255, 255] });

  const document = await openNativePdfDocument({ kind: "bytes", bytes: imagePdf(jpx) });
  try {
    const cancellation = new AbortController();
    const cancelledResolver = registerBundledJpxResolver(async (request, signal) => {
      const decoded = await bundled(request, signal); cancellation.abort(); return decoded;
    });
    await assert.rejects(new NativePdfImageRegistry(document, undefined, { codecResolver: cancelledResolver,
      trustedCodecResolver: true }).add(imageRef, undefined, cancellation.signal), error => error.code === "aborted");
    const invalidResolver = registerBundledJpxResolver(async (request, signal) => ({ ...await bundled(request, signal), width: 7 }));
    await assert.rejects(new NativePdfImageRegistry(document, undefined, { codecResolver: invalidResolver,
      trustedCodecResolver: true }).add(imageRef), error => error.code === "unsupported-image" && error.details.reason === "invalid-codec-result");
    await assert.rejects(new NativePdfImageRegistry(document, undefined, { codecResolver: bundled,
      trustedCodecResolver: true, limits: { maxDecodedStreamBytes: 191 } }).add(imageRef), error => error.code === "resource-limit");
  } finally { await document.close(); }
  console.log("Native image codec ownership passed: bundled JPX adoption, caller isolation, JPEG/JBIG2 copies, fresh decoder planes, validation, limits and cancellation.");
} finally { hooks.deregister(); }
