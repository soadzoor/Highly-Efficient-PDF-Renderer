import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { tinyJbig2, tinyJbig2Globals } from "./lib/imageCodecFixtures.mjs";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
const width = 17, height = 17, rowBytes = Math.ceil(width / 8);

try {
  const [{ openPdf }, { HEPR_IMAGE_FORMAT, expandHeprImageToRgba8 }, { validateHeprPageData },
    { lowerRetainedPageToVectorScene }, { encodeHeprPageData, decodeHeprPageData },
    { renderHeprPageToCanvas2d }, { resolveBundledImageCodec }] = await Promise.all([
    import("../src/pdfSession.ts"), import("../src/heprDocumentData.ts"),
    import("../src/heprDocumentDataValidation.ts"), import("../src/retainedVectorPage.ts"),
    import("../src/heprPageEncoding.ts"), import("../src/heprCanvas2dRenderer.ts"),
    import("../src/pdf/nativeJpegCodec.ts")
  ]);
  const jbig2 = largerJbig2(), globals = tinyJbig2Globals();
  const decoded = await resolveBundledImageCodec({ codec: "jbig2", encoded: jbig2, width, height,
    components: 1, bitsPerComponent: 1, imageMask: false, globals, decodeParameters: {} });
  assert.equal(decoded.bitsPerComponent, 1);
  assert.equal(decoded.samples.length, rowBytes * height, "the bundled decoder returns padded packed rows");
  assert.deepEqual(expandHeprImageToRgba8(decoded.samples, HEPR_IMAGE_FORMAT.Gray1, width, height),
    expectedRgba((x, y) => !(y === 1 && x < 8)), "JBIG2 black pixels use PDF sample zero");

  const raw = rawRows();
  for (const [name, encoded, extra, sourceBit, filter, imageGlobals] of [
    ["bundled JBIG2", jbig2, "", (x, y) => !(y === 1 && x < 8), "JBIG2Decode", globals],
    ["inverted JBIG2", jbig2, "/Decode [1 0]", (x, y) => y === 1 && x < 8, "JBIG2Decode", globals],
    ["raw DeviceGray", raw, "", rawBit, "", undefined],
    ["inverted raw DeviceGray", raw, "/Decode [1 0]", (x, y) => !rawBit(x, y), "", undefined]
  ]) {
    const diagnostics = [];
    const session = await openPdf({ kind: "bytes", bytes: imageFixture(encoded, extra, filter, imageGlobals) },
      { onDiagnostic: diagnostic => diagnostics.push(diagnostic) });
    try {
      const page = await session.compilePage(0, { optimization: "none" });
      const images = page.stores.images;
      assert.equal(images.formats.length, 1, name);
      assert.equal(images.formats[0], HEPR_IMAGE_FORMAT.Gray1, `${name}: retain packed pixels before GPU preparation`);
      assert.equal(images.dataOffsets[1] - images.dataOffsets[0], rowBytes * height, `${name}: packed payload byte count`);
      assert.equal(images.data.length, rowBytes * height);
      for (let y = 0; y < height; y++) {
        assert.equal(images.data[(y + 1) * rowBytes - 1] & 127, 0, `${name}: ignore and normalize padding bits`);
      }
      const expected = expectedRgba(sourceBit);
      assert.deepEqual(expandHeprImageToRgba8(images.data, images.formats[0], width, height), expected, name);
      validateHeprPageData(page);

      const corrupt = structuredClone(page);
      corrupt.stores.images.data = corrupt.stores.images.data.slice(0, -1);
      corrupt.stores.images.dataOffsets[1]--;
      assert.throws(() => validateHeprPageData(corrupt), /raw image payload must contain exactly 51 bytes/,
        `${name}: validation rejects truncated packed rows`);
      assert.equal(expandHeprImageToRgba8(corrupt.stores.images.data, HEPR_IMAGE_FORMAT.Gray1, width, height), null);

      const scene = await session.compileVectorPage(0, { optimization: "none", vectorFallback: "error" });
      assertPackedScene(scene, images.data, expected, name);
      const original = structuredClone(page);
      const retained = await lowerRetainedPageToVectorScene(page, { signal: new AbortController().signal });
      assertPackedScene(retained, images.data, expected, `${name}: retained lowering`);
      assert.deepEqual(page, original, "lowering leaves the source image store reusable");

      const restored = decodeHeprPageData(encodeHeprPageData(page));
      assert.deepEqual(restored.stores.images, images, `${name}: retained binary serialization preserves packed bytes`);
      const restoredScene = await lowerRetainedPageToVectorScene(restored, { signal: new AbortController().signal });
      assertPackedScene(restoredScene, images.data, expected, `${name}: restored retained lowering`);
      assert.deepEqual(await renderPixels(restored), expected, `${name}: Canvas2D fallback expands packed pixels correctly`);
      assert(!diagnostics.some(diagnostic => diagnostic.code.endsWith("raster-fallback")),
        `${name}: native packed images need no page raster fallback`);
    } finally { await session.close(); }
  }

  for (const [name, extra, pixel] of [
    ["custom Decode", "/Decode [.25 .75]", bit => [bit ? 191 : 64, bit ? 191 : 64, bit ? 191 : 64, 255]],
    ["color-key transparency", "/Mask [0 0]", bit => [bit ? 255 : 0, bit ? 255 : 0, bit ? 255 : 0, bit ? 255 : 0]]
  ]) {
    const session = await openPdf({ kind: "bytes", bytes: imageFixture(raw, extra) });
    try {
      const page = await session.compilePage(0, { optimization: "none" });
      assert.equal(page.stores.images.formats[0], HEPR_IMAGE_FORMAT.Rgba8,
        `${name}: color and alpha preparation keeps the existing RGBA representation`);
      const expected = expectedRgba(rawBit, pixel);
      assert.deepEqual(page.stores.images.data, expected, name);
      const scene = await session.compileVectorPage(0, { optimization: "none", vectorFallback: "error" });
      assert.equal(scene.rasterLayers[0].monochrome, undefined);
      assert.deepEqual(scene.rasterLayers[0].data, expected, `${name}: native scene preserves prepared pixels`);
      const retained = await lowerRetainedPageToVectorScene(page, { signal: new AbortController().signal });
      assert.equal(retained.rasterLayers[0].monochrome, undefined);
      assert.deepEqual(retained.rasterLayers[0].data, expected, `${name}: retained scene preserves prepared pixels`);
      assert.deepEqual(await renderPixels(page), expected, `${name}: Canvas2D preparation remains accurate`);
    } finally { await session.close(); }
  }

  {
    const session = await openPdf({ kind: "bytes", bytes: imageFixture(
      new Uint8Array(rowBytes * height).fill(255), "/SMask 7 0 R", "", undefined, raw) });
    try {
      const page = await session.compilePage(0, { optimization: "none" });
      assert.deepEqual([...page.stores.images.formats], [HEPR_IMAGE_FORMAT.Gray1, HEPR_IMAGE_FORMAT.Gray1],
        "both a binary source and its binary soft mask stay packed at rest");
      const expected = expectedRgba(rawBit, bit => [255, 255, 255, bit ? 255 : 0]);
      const scene = await session.compileVectorPage(0, { optimization: "none", vectorFallback: "error" });
      assert.equal(scene.rasterLayers[0].monochrome, undefined, "soft-mask preparation selects RGBA upload");
      assert.deepEqual(scene.rasterLayers[0].data, expected, "packed soft masks are sampled as alpha");
      const restored = decodeHeprPageData(encodeHeprPageData(page));
      const retained = await lowerRetainedPageToVectorScene(restored, { signal: new AbortController().signal });
      assert.deepEqual(retained.rasterLayers[0].data, expected, "retained lowering widens and applies packed soft masks");
      assert.deepEqual(await renderPixels(restored), expectedRgba(rawBit,
        bit => bit ? [255, 255, 255, 255] : [0, 0, 0, 0]), "Canvas2D composes the same mask coverage");
    } finally { await session.close(); }
  }
  console.log("Native monochrome images: bundled JBIG2, packed odd rows, Decode inversion, validation, lazy native scenes, retained serialization/lowering and Canvas2D fallback passed.");

  function assertPackedScene(scene, packed, rgba, name) {
    assert.equal(scene.rasterLayers.length, 1, name);
    const layer = scene.rasterLayers[0];
    assert.deepEqual([layer.width, layer.height], [width, height], name);
    assert.deepEqual(layer.monochrome?.data, packed, `${name}: retain source packed bytes`);
    assert.deepEqual([...layer.monochrome.colors], [0, 0, 0, 255, 255, 255, 255, 255]);
    assert.equal(typeof Object.getOwnPropertyDescriptor(layer, "data").get, "function", `${name}: RGBA stays lazy`);
    assert.equal(typeof Object.getOwnPropertyDescriptor(scene, "rasterLayerData").get, "function",
      `${name}: legacy scene alias stays lazy`);
    assert.deepEqual(layer.data, rgba, `${name}: legacy RGBA access preserves pixels`);
    assert.equal(layer.data, layer.data, `${name}: lazy expansion is cached`);
    assert.equal(scene.rasterLayerData, layer.data, `${name}: the legacy alias shares the cached RGBA view`);
  }

  async function renderPixels(page) {
    const result = await renderHeprPageToCanvas2d(page, { scale: 1, surfaceFactory(w, h) {
      const canvas = createCanvas(w, h);
      return { canvas, context: canvas.getContext("2d") };
    } });
    assert.deepEqual([result.width, result.height], [width, height]);
    return new Uint8Array(result.surface.context.getImageData(0, 0, width, height).data);
  }
} finally { hooks.deregister(); }

function largerJbig2() {
  const encoded = tinyJbig2();
  const header = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
  // Keep the 8x2 region inside a larger page. This includes pixels beyond the
  // region, a non-byte-aligned width, and the codec's four-byte row alignment.
  header.setUint32(11, width, false);
  header.setUint32(15, height, false);
  return encoded;
}

function rawBit(x, y) { return (x + y * 2) % 3 === 0; }

function rawRows() {
  const data = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (rawBit(x, y)) data[y * rowBytes + (x >> 3)] |= 128 >> (x & 7);
    data[(y + 1) * rowBytes - 1] |= 127;
  }
  return data;
}

function expectedRgba(bit, color = value => value ? [255, 255, 255, 255] : [0, 0, 0, 255]) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rgba.set(color(bit(x, y)), (y * width + x) * 4);
  }
  return rgba;
}

function imageFixture(encoded, extra = "", filter = "", globals, softMask) {
  const entries = `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
    `/ColorSpace /DeviceGray /BitsPerComponent 1 ${extra} ` +
    (filter ? `/Filter /${filter} ` : "") + (globals ? "/DecodeParms << /JBIG2Globals 6 0 R >>" : "");
  const objects = [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im 5 0 R >> >> /Contents 4 0 R >>` },
    { number: 4, body: tinyPdfStream("", `q ${width} 0 0 ${height} 0 0 cm /Im Do Q`) },
    { number: 5, body: tinyPdfStream(entries, encoded) }
  ];
  if (globals) objects.push({ number: 6, body: tinyPdfStream("", globals) });
  if (softMask) objects.push({ number: 7, body: tinyPdfStream(
    `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 1`, softMask) });
  return writeTinyPdf({ objects });
}
