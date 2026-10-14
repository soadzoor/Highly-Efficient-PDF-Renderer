import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const [{ openPdf }, { lowerRetainedPageToVectorScene }, { buildHep }, { loadSceneFromHep },
    { HepArchive }, { decodeRasterLayerTable, SCENE_RASTER_LAYERS_PATH }, { decodeBundledJpx }] = await Promise.all([
    import("../src/pdfSession.ts"), import("../src/retainedVectorPage.ts"), import("../src/hepBuilder.ts"),
    import("../src/hepReader.ts"), import("../src/hepContainer.ts"), import("../src/hepRasterLayers.ts"),
    import("../src/pdf/nativeJpxCodec.ts")
  ]);
  const width = 16400, height = 2;
  const encoded = new Uint8Array(await readFile(new URL("./fixtures/codecs/rgb-wide-16400x2.jp2", import.meta.url)));
  const decoded = await decodeBundledJpx({ codec: "jpeg2000", encoded, width, height, components: 3,
    bitsPerComponent: 8, imageMask: false, globals: new Uint8Array(), decodeParameters: {} }, Number.MAX_SAFE_INTEGER);
  const expected = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    expected.set(decoded.samples.subarray(pixel * 3, pixel * 3 + 3), pixel * 4); expected[pixel * 4 + 3] = 255;
  }
  const maskedExpected = Uint8Array.of(64, 128, 192, 255, 0, 0, 0, 0);
  const pdf = fixture(encoded, width, height), diagnostics = [];
  const session = await openPdf({ kind: "bytes", bytes: pdf }, { onDiagnostic: diagnostic => diagnostics.push(diagnostic) });
  const read = async blob => {
    const bytes = await blob.arrayBuffer(), archive = await HepArchive.loadAsync(bytes);
    const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
    const table = decodeRasterLayerTable(await archive.file(SCENE_RASTER_LAYERS_PATH).async("uint8array"),
      { maxLayers: 10, maxAtlases: 10, maxDimension: 0x7fffffff });
    return { archive, manifest, table, scene: await loadSceneFromHep(bytes) };
  };
  const backgrounds = scene => scene.rasterLayers.filter(layer => layer.width === width);
  const maskedImages = scene => scene.rasterLayers.filter(layer => layer.width === 2);
  const assertPixels = scene => {
    const originals = backgrounds(scene), masked = maskedImages(scene);
    assert.equal(originals.length, 2, "both background placements survive retained lowering");
    assert.equal(masked.length, 1, "the separately masked image remains a normal image layer");
    originals.forEach(layer => {
      assert.deepEqual(layer.data, expected);
      assert.deepEqual(layer.sourceJpx?.encoded, encoded, "ordinary background keeps its original codestream");
      assert.notEqual(layer.interpolate, false);
    });
    assert.equal(originals[0].data, originals[1].data, "repeated placements reuse canonical pixels");
    assert.deepEqual(masked[0].data, maskedExpected, "explicit mask coverage is applied exactly");
    assert.equal(masked[0].sourceJpx, undefined, "a masked image never acquires original-JPX provenance");
  };
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    const images = page.stores.images;
    const backgroundIndex = images.widths.findIndex(value => value === width);
    assert.ok(backgroundIndex >= 0);
    assert.ok([...images.softMaskImageIndices].some(value => value >= 0),
      "fixture has an explicit image mask, which the direct native image adapter cannot lower");
    const retained = await lowerRetainedPageToVectorScene(page, { signal: new AbortController().signal });
    assertPixels(retained);
    const compiled = await session.compileVectorPage(0, { optimization: "none", vectorFallback: "error" });
    assertPixels(compiled);
    const exported = await read(await buildHep(compiled, { withVectorLod: false, withTextLod: false }));
    assert.equal(exported.manifest.formatVersion, 16);
    assert.deepEqual(exported.table.layers.slice(0, 2).map(layer => [layer.storage, layer.source]),
      [["jpx", undefined], ["jpx", 0]], "retained background placements share one original JPX section");
    assert.notEqual(exported.table.layers[2].storage, "jpx");
    const section = await exported.archive.file("raster/layer-0.jpx").async("uint8array");
    assert.deepEqual(section.subarray(32), encoded, "HJP1 carries byte-identical original JPX");
    assertPixels(exported.scene);

    // The first lowering must not establish a new source fingerprint from
    // publicly editable page pixels. The binding predates compilePage exposure.
    const editedSession = await openPdf({ kind: "bytes", bytes: pdf });
    try {
      const editedPage = await editedSession.compilePage(0, { optimization: "none" });
      const editedImages = editedPage.stores.images;
      const editedBackground = editedImages.widths.findIndex(value => value === width);
      const offset = editedImages.dataOffsets[editedBackground];
      editedImages.data[offset] ^= 255;
      const editedExpected = expected.slice(); editedExpected[0] ^= 255;
      const editedScene = await lowerRetainedPageToVectorScene(editedPage, { signal: new AbortController().signal });
      backgrounds(editedScene).forEach(layer => assert.deepEqual(layer.data, editedExpected));
      const editedExport = await read(await buildHep(editedScene, { withVectorLod: false, withTextLod: false }));
      editedExport.table.layers.slice(0, 2).forEach(layer => assert.equal(layer.storage, "png",
        "editing exposed page pixels before first lowering cannot bless stale JPX provenance"));
      backgrounds(editedExport.scene).forEach(layer => assert.deepEqual(layer.data, editedExpected));
      assert.deepEqual(maskedImages(editedExport.scene)[0].data, maskedExpected);
    } finally { await editedSession.close(); }
  } finally { await session.close(); }
  assert.ok(!diagnostics.some(diagnostic => /raster-fallback/.test(diagnostic.code)),
    "the explicit mask keeps retained layers without page or selective raster fallback");

  // The PDF worker transfers the first page's data while the same registry
  // image remains available for the second page and its repeated placements.
  const worker = await read(await buildHep(pdf, { withVectorLod: false, withTextLod: false }));
  assert.equal(worker.manifest.formatVersion, 16);
  assert.equal(worker.table.layers.length, 6);
  const workerBackgrounds = backgrounds(worker.scene), workerMasked = maskedImages(worker.scene);
  assert.equal(workerBackgrounds.length, 4); assert.equal(workerMasked.length, 2);
  workerBackgrounds.forEach(layer => { assert.deepEqual(layer.data, expected); assert.deepEqual(layer.sourceJpx.encoded, encoded); });
  workerMasked.forEach(layer => { assert.deepEqual(layer.data, maskedExpected); assert.equal(layer.sourceJpx, undefined); });
  assert.equal(worker.table.layers.filter(layer => layer.storage === "jpx" && layer.source === undefined).length, 1,
    "both transferred pages share a single original codestream");
  assert.ok(worker.table.layers.filter(layer => layer.width === 2).every(layer => layer.storage !== "jpx"));
  console.log("Retained source JPX: explicit-mask route, exact pixels/original bytes, shared placements, public edits and repeated-page worker transfer passed.");
} finally { hooks.deregister(); }

function fixture(encoded, width, height) {
  const page = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} 6] ` +
    "/Resources << /XObject << /Background 5 0 R /Masked 6 0 R >> >> /Contents 7 0 R >>";
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>" },
    { number: 3, body: page }, { number: 4, body: page },
    { number: 5, body: tinyPdfStream(`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
      "/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /JPXDecode /Interpolate true", encoded) },
    { number: 6, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 2 /Height 1 " +
      "/ColorSpace /DeviceRGB /BitsPerComponent 8 /Mask 8 0 R", Uint8Array.of(64, 128, 192, 0, 0, 0)) },
    { number: 7, body: tinyPdfStream("", `q ${width} 0 0 ${height} 0 0 cm /Background Do Q\n` +
      `q ${width} 0 0 ${height} 0 2 cm /Background Do Q\nq 2 0 0 1 0 4 cm /Masked Do Q`) },
    { number: 8, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 2 /Height 1 /ImageMask true /BitsPerComponent 1",
      Uint8Array.of(0x40)) }
  ] });
}
