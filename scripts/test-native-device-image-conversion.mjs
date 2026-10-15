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

const { openNativePdfDocument } = await import("../src/pdf/nativePdf.ts");
const { NativePdfColorRegistry } = await import("../src/pdf/nativeColor.ts");
const { NativePdfImageRegistry } = await import("../src/pdf/nativeImage.ts");
const { HEPR_IMAGE_FORMAT } = await import("../src/heprDocumentData.ts");

// 256 pixels reach the table-driven device conversion; smaller images stay scalar.
const width = 16, height = 16, pixels = width * height;

function samples(seed) {
  const output = new Uint8Array(pixels * 3);
  let state = seed;
  for (let index = 0; index < output.length; index += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    output[index] = state >>> 24;
  }
  return output;
}

function rgbImage(number, entries, data) {
  return {
    number,
    body: tinyPdfStream(
      `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 ${entries}`,
      data
    )
  };
}

/** Straight RGBA8 per the PDF Decode mapping, independent of the converter. */
function expectedRgba(data, decode = [0, 1, 0, 1, 0, 1], alpha = () => 255) {
  const output = new Uint8Array(pixels * 4);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    for (let component = 0; component < 3; component += 1) {
      const [low, high] = [decode[component * 2], decode[component * 2 + 1]];
      const value = low + data[pixel * 3 + component] / 255 * (high - low);
      output[pixel * 4 + component] = Math.round(Math.min(1, Math.max(0, value)) * 255);
    }
    output[pixel * 4 + 3] = alpha(data.subarray(pixel * 3, pixel * 3 + 3));
  }
  return output;
}

const noisy = samples(7);
const white = new Uint8Array(pixels * 3).fill(255);
const black = new Uint8Array(pixels * 3);
const nearlyWhite = white.slice();
nearlyWhite[nearlyWhite.length - 1] = 254;
const inverted = [1, 0, 0.2, 0.8, 0, 1];
const keyed = noisy.slice();
keyed.fill(5, 0, 3 * 17);

const document = await openNativePdfDocument({ kind: "bytes", bytes: writeTinyPdf({
  objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>" },
    rgbImage(10, "", noisy),
    rgbImage(11, `/Decode [${inverted.join(" ")}]`, noisy),
    rgbImage(12, "", white),
    rgbImage(13, "", black),
    rgbImage(14, "", nearlyWhite),
    rgbImage(15, "/Mask [0 10 0 10 0 10]", keyed)
  ]
}) });
try {
  const images = new NativePdfImageRegistry(document, new NativePdfColorRegistry(document));
  const describe = async (objectNumber) =>
    images.describe(await images.add({ kind: "ref", objectNumber, generation: 0 }));

  const identity = await describe(10);
  assert.equal(identity.format, HEPR_IMAGE_FORMAT.Rgba8);
  assert.deepEqual(identity.data, expectedRgba(noisy), "DeviceRGB samples widen to opaque RGBA8");

  const decoded = await describe(11);
  assert.deepEqual(decoded.data, expectedRgba(noisy, inverted), "Decode arrays keep their exact rounding");

  for (const [objectNumber, value, name] of [[12, 255, "white"], [13, 0, "black"]]) {
    const uniform = await describe(objectNumber);
    assert.equal(uniform.format, HEPR_IMAGE_FORMAT.Gray1, `an all-${name} image packs to one bit per pixel`);
    const rowBytes = Math.ceil(width / 8);
    assert.deepEqual(uniform.data, new Uint8Array(rowBytes * height).fill(value), `all-${name} packed bits`);
  }

  const almost = await describe(14);
  assert.equal(almost.format, HEPR_IMAGE_FORMAT.Rgba8, "one differing final pixel keeps RGBA8");
  assert.deepEqual(almost.data, expectedRgba(nearlyWhite));

  const masked = await describe(15);
  assert.equal(masked.format, HEPR_IMAGE_FORMAT.Rgba8);
  assert.deepEqual(masked.data, expectedRgba(keyed, undefined,
    (rgb) => rgb.every(component => component <= 10) ? 0 : 255), "color-key masks keep per-pixel alpha");
} finally {
  await document.close();
  hooks.deregister();
}
console.log("Native device image conversion: opaque RGB words, Decode rounding, uniform packing and color-key alpha passed.");
