import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { decodeRasterCompressionBlock, measureRasterCompressionError } from "./lib/rasterCompressionReference.mjs";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });

try {
  const {
    rasterCompressionFormatInfo, selectRasterCompressionFormat, rasterCompressionMipLayout,
    estimateCompressedRasterBytes, buildRasterCompressionMipChain, assessRasterCompression
  } = await import("../src/rasterCompression.ts");

  assert.equal(selectRasterCompressionFormat({ bc7: false, astc4x4: false }), null);
  assert.equal(selectRasterCompressionFormat({ bc7: true, astc4x4: true }), "bc7");
  assert.equal(selectRasterCompressionFormat({ bc7: false, astc4x4: true }), "astc-4x4");
  for (const format of ["bc7", "astc-4x4"]) {
    assert.equal(rasterCompressionFormatInfo(format).bytesPerBlock, 16);
    const padded = rasterCompressionMipLayout(5, 7, format);
    assert.deepEqual(padded, [
      { width: 8, height: 8, blocksX: 2, blocksY: 2, byteOffset: 0, byteLength: 64 },
      { width: 4, height: 4, blocksX: 1, blocksY: 1, byteOffset: 64, byteLength: 16 },
      { width: 2, height: 2, blocksX: 1, blocksY: 1, byteOffset: 80, byteLength: 16 },
      { width: 1, height: 1, blocksX: 1, blocksY: 1, byteOffset: 96, byteLength: 16 }
    ]);
    assert.equal(estimateCompressedRasterBytes(5, 7, format), 112);
    assert.equal(estimateCompressedRasterBytes(5, 7, format, false), 64);
    assert.equal(estimateCompressedRasterBytes(5, 7, format, true, false), 96);
    assert.equal(estimateCompressedRasterBytes(5, 7, format, true, true, 2), 80);
    assert.equal(estimateCompressedRasterBytes(1, 1, format), 48,
      "a padded 4x4 physical base includes its 2x2 and 1x1 mip blocks");
    assert.equal(estimateCompressedRasterBytes(9, 1, format), 112,
      "thin images still pay for every physical padded mip block");
    for (const [width, height] of [[Infinity, 1], [1, NaN], [0, 1], [-1, 2], [2.5, 1], [Number.MAX_SAFE_INTEGER, 1]]) {
      assert.throws(() => estimateCompressedRasterBytes(width, height, format), RangeError);
    }
    for (const mipLevelCount of [0, -1, 1.5, Infinity, 5]) {
      assert.throws(() => rasterCompressionMipLayout(5, 7, format, { mipLevelCount }), RangeError);
    }
  }
  assert.throws(() => rasterCompressionFormatInfo("astc-12x12"), RangeError);

  // Physical padding replicates every edge channel; mip pixels match the existing rounded box filter.
  const source = image(5, 7, (x, y) => [x * 7 + y, x + y * 9, x * 4 + y * 3, 50 + x * 2 + y]);
  const preserved = source.slice();
  const levels = [...buildRasterCompressionMipChain(source, 5, 7)];
  assert.deepEqual(levels.map(({ width, height }) => [width, height]), [[8, 8], [4, 4], [2, 2], [1, 1]]);
  let expected = image(8, 8, (x, y) => Array.from(source.subarray(
    (Math.min(6, y) * 5 + Math.min(4, x)) * 4, (Math.min(6, y) * 5 + Math.min(4, x)) * 4 + 4)));
  assert.deepEqual(levels[0].data, expected);
  for (let index = 1; index < levels.length; index++) {
    expected = boxFilter(expected, levels[index - 1].width, levels[index - 1].height);
    assert.deepEqual(levels[index].data, expected);
  }
  assert.deepEqual(source, preserved, "canonical pixels are never overwritten by GPU display preparation");
  const aligned = image(12, 4, (x, y) => [x * 3, y * 9, x + y, 255]);
  const alignedChain = buildRasterCompressionMipChain(aligned, 12, 4);
  assert.equal(alignedChain.next().value.data, aligned, "an aligned base needs no duplicate source allocation");
  assert.deepEqual([...alignedChain].map(({ width, height }) => [width, height]), [[6, 2], [3, 1], [1, 1]]);
  assert.throws(() => [...buildRasterCompressionMipChain(new Uint8Array(3), 1, 1)], RangeError);
  const abort = new AbortController();
  const cancelChain = buildRasterCompressionMipChain(aligned, 12, 4, abort.signal);
  cancelChain.next();
  abort.abort();
  assert.throws(() => cancelChain.next(), error => error.code === "aborted");

  const smooth = { width: 64, height: 64, data: image(64, 64, (x, y) => [x + 40, y + 60, x + y + 20, 255]) };
  const smoothAssessment = assessRasterCompression(smooth);
  assert.equal(smoothAssessment.reason, "smooth-color");
  assert.equal(smoothAssessment.eligible, true);
  assert.equal(smoothAssessment.opaque, true);
  assert.equal(smoothAssessment.sampledPixels, 4096);
  assert.equal(smoothAssessment.maxGradient, 1);

  // Metadata is read before lazy RGBA; binary and stencil masks remain lossless.
  for (const [metadata, reason] of [[{ monochrome: {} }, "monochrome"], [{ imageMask: true }, "mask"],
    [{ stencilMask: true }, "mask"], [{ exactPixels: true }, "exact-pixels"], [{ containsText: true }, "text"]]) {
    for (const compressionHint of [undefined, "scan"]) {
      const protectedResult = assessRasterCompression({ width: 4096, height: 4096, ...metadata, compressionHint,
        get data() { throw new Error("Must not expand protected pixels"); } });
      assert.equal(protectedResult.reason, reason);
      assert.equal(protectedResult.eligible, false, "a scan hint cannot override explicit lossless metadata");
    }
  }
  assert.equal(assessRasterCompression({ width: 1, height: 1, get data() { throw new Error("Small image"); } }).reason, "small-image");
  assert.equal(assessRasterCompression({ width: 1, height: 1, compressionHint: "scan",
    get data() { throw new Error("Small scan"); } }).reason, "small-image");
  assert.equal(assessRasterCompression({ width: 8, height: 1024, data: new Uint8Array(0) }).reason, "thin-image");
  assert.equal(assessRasterCompression({ width: 8, height: 1024, compressionHint: "scan", data: new Uint8Array(0) }).reason, "thin-image");
  assert.equal(assessRasterCompression({ width: NaN, height: 64, data: new Uint8Array(0) }).reason, "invalid-pixels");
  assert.equal(assessRasterCompression({ width: 64, height: 64, data: new Uint8Array(0) }).reason, "invalid-pixels");
  const binary = image(64, 64, (x, y) => (x + y) % 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
  assert.equal(assessRasterCompression({ width: 64, height: 64, data: binary }).reason, "binary");
  assert.equal(assessRasterCompression({ width: 64, height: 64, compressionHint: "scan", data: binary }).reason, "binary");
  const detail = image(64, 64, (x, y) => [[0, 0, 0, 255], [127, 127, 127, 255], [255, 255, 255, 255]][(x + y) % 3]);
  const detailed = assessRasterCompression({ width: 64, height: 64, data: detail, codec: "jpeg", filename: "photo.jpg" });
  assert.equal(detailed.reason, "detailed-content", "a codec or filename cannot override actual text-like edges");
  assert.equal(detailed.eligible, false);
  assert(detailed.edgeFraction > 0.025);
  const scannedText = smooth.data.slice();
  for (let y = 12; y < 18; y++) for (let x = 9; x < 55; x += 7) scannedText.set([0, 0, 0, 255], (y * 64 + x) * 4);
  assert.equal(assessRasterCompression({ width: 64, height: 64, data: scannedText }).reason, "detailed-content");
  for (const pixels of [detail, scannedText]) {
    const scan = assessRasterCompression({ width: 64, height: 64, data: pixels, compressionHint: "scan" });
    assert.equal(scan.reason, "scan", "loading a scanned page can explicitly opt its text-like detail into compression");
    assert.equal(scan.eligible, true);
    assert.equal(scan.opaque, true);
    const withoutHint = assessRasterCompression({ width: 64, height: 64, data: pixels });
    assert.equal(scan.edgeFraction, withoutHint.edgeFraction, "the diagnostic retains the actual scan edge assessment");
    assert.equal(scan.maxGradient, withoutHint.maxGradient);
  }
  const translucentScan = scannedText.slice();
  translucentScan[translucentScan.length - 1] = 254;
  const translucent = assessRasterCompression({ width: 64, height: 64, data: translucentScan, compressionHint: "scan" });
  assert.equal(translucent.reason, "alpha");
  assert.equal(translucent.eligible, false, "scan compression still requires every source alpha byte to be opaque");

  const larger = { width: 512, height: 768, data: image(512, 768, (x, y) =>
    [40 + Math.floor(x / 8), 50 + Math.floor(y / 8), 20 + Math.floor((x + y) / 12), 255]) };
  const boundedAssessment = assessRasterCompression(larger);
  assert.equal(boundedAssessment.eligible, true);
  assert(boundedAssessment.sampledPixels <= 65536);
  larger.data[(511 * 512 + 7) * 4 + 3] = 254;
  assert.equal(assessRasterCompression(larger).reason, "alpha", "all alpha bytes are checked even between spatial samples");
  larger.data[(511 * 512 + 7) * 4 + 3] = 255;
  assert.equal(assessRasterCompression(larger).eligible, true, "in-place pixel updates cannot reuse a stale identity cache");

  // Test-only CPU reference blocks come from the pinned upstream CPU encoder/decoder.
  // They check bit layouts and error bounds without claiming to execute a browser GPU shader.
  const graySource = image(4, 4, (x, y) => [80 + y * 4 + x, 80 + y * 4 + x, 80 + y * 4 + x, 255]);
  const colorSource = image(4, 4, (x, y) => [25 + (y * 4 + x) * 4, 55 + (y * 4 + x) * 4, 85 + (y * 4 + x) * 4, 255]);
  const fixtures = [
    ["bc7", [64, 212, 11, 245, 66, 189, 254, 255, 1, 33, 67, 101, 151, 186, 220, 254], graySource, 1],
    ["astc-4x4", [83, 2, 160, 190, 0, 0, 255, 238, 217, 74, 10, 222, 106, 201, 8, 2], graySource, 0],
    ["bc7", [64, 134, 106, 147, 83, 33, 255, 255, 17, 50, 84, 118, 152, 186, 220, 254], colorSource, 0],
    ["astc-4x4", [66, 2, 153, 213, 180, 184, 234, 91, 127, 59, 93, 25, 110, 42, 76, 8], colorSource, 2],
    ["astc-4x4", [83, 0, 101, 114, 160, 174, 220, 234, 0, 0, 95, 99, 17, 95, 99, 17],
      image(4, 4, (x, y) => [50 + (y * 4 + x) % 8, 80 + (y * 4 + x) % 8, 110 + (y * 4 + x) % 8, 255]), 0]
  ];
  for (const [format, block, pixels, maximum] of fixtures) {
    const decoded = decodeRasterCompressionBlock(format, Uint8Array.from(block));
    const error = measureRasterCompressionError(pixels, decoded);
    assert.equal(error.acceptable, true);
    assert.equal(error.maxChannelError, maximum);
    assert.equal(error.maxAlphaError, 0, "eligible opaque content must remain opaque");
  }
  const astc192 = decodeRasterCompressionBlock("astc-4x4", Uint8Array.from(fixtures[3][1]));
  assert.deepEqual(Array.from(astc192), [25, 54, 85, 255, 29, 58, 89, 255, 33, 62, 93, 255, 36, 65, 96, 255,
    41, 70, 101, 255, 45, 74, 105, 255, 48, 77, 108, 255, 52, 81, 112, 255,
    58, 87, 118, 255, 62, 91, 122, 255, 65, 94, 125, 255, 69, 98, 129, 255,
    74, 103, 134, 255, 78, 107, 138, 255, 81, 110, 141, 255, 85, 114, 145, 255]);
  const mode4 = decodeRasterCompressionBlock("bc7", Uint8Array.from([208, 162, 151, 141, 176, 130, 203, 201, 201, 201, 137, 198, 250, 136, 198, 250]));
  assert.deepEqual(Array.from(mode4), [16, 40, 66, 41, 47, 101, 85, 66, 79, 166, 103, 92, 110, 227, 122, 117,
    145, 40, 142, 146, 176, 101, 161, 171, 208, 166, 179, 197, 239, 227, 198, 222,
    16, 40, 66, 41, 47, 101, 85, 66, 79, 166, 103, 92, 110, 227, 122, 117,
    145, 40, 142, 146, 176, 101, 161, 171, 208, 166, 179, 197, 239, 227, 198, 222]);
  const astcAlpha = decodeRasterCompressionBlock("astc-4x4", Uint8Array.from([66, 128, 57, 164, 116, 224, 176, 28, 215, 170, 1, 0, 255, 85, 170, 0]));
  assert.deepEqual(Array.from(astcAlpha), Array.from({ length: 16 }, (_, pixel) =>
    [[28, 58, 88, 107], [46, 76, 106, 142], [64, 94, 124, 178], [82, 112, 142, 213]][Math.floor(pixel / 4)]).flat());
  assert.throws(() => decodeRasterCompressionBlock("bc7", new Uint8Array(16)), RangeError);
  assert.throws(() => decodeRasterCompressionBlock("astc-4x4", new Uint8Array(15)), RangeError);

  const mildError = smooth.data.map((byte, index) => index % 4 === 3 ? byte : byte + 2);
  assert.equal(measureRasterCompressionError(smooth.data, mildError).acceptable, true);
  const isolatedError = smooth.data.slice();
  isolatedError[0] += 25;
  const isolatedMetric = measureRasterCompressionError(smooth.data, isolatedError);
  assert(isolatedMetric.rgbRmse < 1);
  assert.equal(isolatedMetric.acceptable, false, "a small average error cannot conceal a large local pixel error");
  const alphaError = smooth.data.slice();
  alphaError[3] = 253;
  assert.equal(measureRasterCompressionError(smooth.data, alphaError).acceptable, false);
  for (const [a, b] of [[new Uint8Array(0), new Uint8Array(0)], [new Uint8Array(3), new Uint8Array(3)],
    [new Uint8Array(4), new Uint8Array(8)]]) assert.throws(() => measureRasterCompressionError(a, b), RangeError);

  console.log("Raster compression policy, physical mips, and CPU reference blocks passed.");
} finally {
  hooks.deregister();
}

function image(width, height, pixel) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return data;
}

function boxFilter(data, width, height) {
  const nextWidth = Math.max(1, Math.floor(width / 2)), nextHeight = Math.max(1, Math.floor(height / 2));
  return image(nextWidth, nextHeight, (x, y) => Array.from({ length: 4 }, (_, channel) => {
    let sum = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      sum += data[(Math.min(height - 1, y * 2 + dy) * width + Math.min(width - 1, x * 2 + dx)) * 4 + channel];
    }
    return Math.floor((sum + 2) / 4);
  }));
}
