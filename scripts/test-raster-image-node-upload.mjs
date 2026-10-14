import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";

const backend = createRequire(import.meta.url)("@napi-rs/canvas");
const originalCreateCanvas = backend.createCanvas, OriginalImageData = backend.ImageData;
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });

try {
  const width = 517, height = 1027, byteLength = width * height * 4;
  const padded = new Uint8Array(byteLength + 19).fill(99), rgba = padded.subarray(7, 7 + byteLength);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = (x + y) % 2 ? [31, 83, 143, 255] : y % 7 ? [90, 160, 240, 128] : [0, 0, 0, 0];
      rgba.set(color, (y * width + x) * 4);
    }
  }
  const original = rgba.slice(), reference = originalCreateCanvas(width, height);
  let referencePng, referenceWebp;
  try {
    reference.getContext("2d").putImageData(new OriginalImageData(
      new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height), 0, 0);
    referenceWebp = await reference.encode("webp", 80);
    referencePng = await reference.encode("png");
  } finally { reference.width = 0; reference.height = 0; }

  const constructions = [], canvases = [];
  backend.ImageData = function (data, imageWidth, imageHeight) {
    const image = new OriginalImageData(data, imageWidth, imageHeight);
    constructions.push({ width: imageWidth, height: imageHeight, bytes: data.byteLength });
    return image;
  };
  backend.createCanvas = (canvasWidth, canvasHeight) => {
    const canvas = originalCreateCanvas(canvasWidth, canvasHeight), context = canvas.getContext("2d");
    const put = context.putImageData.bind(context), uploads = [];
    context.putImageData = (image, x, y) => {
      uploads.push({ image, x, y }); return put(image, x, y);
    };
    canvases.push({ canvas, width: canvasWidth, height: canvasHeight, uploads });
    return canvas;
  };
  const codec = await import("../src/rasterImageCodec.ts?node-upload-real");
  const candidates = await codec.encodeRasterRgbaCandidates(width, height, rgba);
  assert.deepEqual(candidates.webp, new Uint8Array(referenceWebp), "band uploads preserve the exact WebP encoder input");
  const png = await codec.encodeRasterRgbaAsPng(width, height, rgba);
  assert.deepEqual(png, new Uint8Array(referencePng), "band uploads preserve PNG pixels, including alpha and partial final rows");
  const fullCanvases = canvases.filter(canvas => canvas.width === width && canvas.height === height);
  assert.equal(fullCanvases.length, 2);
  for (const { canvas, uploads } of fullCanvases) {
    assert.ok(uploads.length > 1, "a large image uploads through several row bands");
    assert.equal(new Set(uploads.map(upload => upload.image)).size, 1, "one owned ImageData band is reused");
    const rows = uploads[0].image.height;
    assert.ok(height % rows > 0, "fixture exercises a partial final band");
    assert.deepEqual(uploads.map(upload => [upload.x, upload.y]),
      Array.from({ length: Math.ceil(height / rows) }, (_, index) => [0, index * rows]));
    assert.ok(canvas.width < width && canvas.height < height, "the native backend releases its large canvas surface");
  }
  assert.ok(constructions.every(image => image.bytes < byteLength), "no Node ImageData duplicates the full large RGBA plane");
  assert.deepEqual(rgba, original, "nonaligned source pixels remain unchanged");
  assert.equal(padded[6], 99); assert.equal(padded.at(-1), 99);

  // A compatible backend shim may not expose stable owned ImageData pixels.
  // Keep the original whole-image upload when reuse would lose or edit data.
  for (const mode of ["missing", "copying-getter", "borrowed"]) {
    const uploads = [], imageHeights = [];
    backend.ImageData = function (data, imageWidth, imageHeight) {
      const pixels = mode === "borrowed" ? data : new Uint8ClampedArray(data);
      const image = { width: imageWidth, height: imageHeight, pixels };
      if (mode === "borrowed") image.data = pixels;
      if (mode === "copying-getter") Object.defineProperty(image, "data", { get: () => new Uint8ClampedArray(pixels) });
      imageHeights.push(imageHeight); return image;
    };
    backend.createCanvas = (canvasWidth, canvasHeight) => ({
      width: canvasWidth, height: canvasHeight,
      getContext: () => ({ putImageData(image, x, y) { uploads.push({ image, x, y }); } }),
      async encode() { return pngHeader(canvasWidth, canvasHeight); }
    });
    const shim = await import(`../src/rasterImageCodec.ts?node-upload-${mode}`);
    assert.ok(await shim.encodeRasterRgbaAsPng(width, height, rgba));
    assert.equal(uploads.length, 1, `${mode}: unsupported scratch ownership keeps one whole-image upload`);
    assert.equal(uploads[0].image.height, height);
    assert.deepEqual(uploads[0].image.pixels, new Uint8ClampedArray(original));
    assert.ok(imageHeights[0] < height, `${mode}: a small band is inspected before the fallback`);
    assert.deepEqual(rgba, original, `${mode}: the fallback does not modify source pixels`);
  }
  console.log("Node raster upload: reusable bands, PNG/WebP byte parity, alpha, nonaligned input, partial final band and backend-shim fallback passed.");
} finally {
  backend.createCanvas = originalCreateCanvas; backend.ImageData = OriginalImageData;
  hooks.deregister();
}

function pngHeader(width, height) {
  const bytes = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 0, 0, 0, 0, 0);
  const view = new DataView(bytes.buffer); view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}
