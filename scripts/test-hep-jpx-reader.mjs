import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

try {
  const [{ buildHep }, { loadSceneFromHep }, { HepArchive }, { createEmptyVectorScene }, sections,
    jpx, fingerprints, { decodeBundledJpx }] = await Promise.all([
    import("../src/hepBuilder.ts"), import("../src/hepReader.ts"), import("../src/hepContainer.ts"),
    import("../src/emptyVectorScene.ts"), import("../src/hepRasterLayers.ts"),
    import("../src/hepJpxRaster.ts"), import("../src/sourceJpxRaster.ts"), import("../src/pdf/nativeJpxCodec.ts")
  ]);
  const limits = { maxLayers: 100, maxAtlases: 4, maxDimension: 0x7fffffff };
  const placement = (paintOrder, pageIndex, opacity) => ({ width: 8, height: 8, paintOrder, pageIndex,
    matrix: Float32Array.of(8.125, -.25, .5, -8.75, paintOrder * 10 + .125, 12.5),
    ...(opacity === undefined ? {} : { opacity }) });
  const records = [
    { ...placement(0, 0), storage: "jpx" },
    { ...placement(1, 1, .375), storage: "jpx", source: 0 },
    { ...placement(2, 1, 0), storage: "jpx" }
  ];
  const table = { atlases: [], layers: records };
  const wire = sections.encodeRasterLayerTable(table);
  assert.equal(wire[2], 128, "JPX owns the append-only bit 7 without changing earlier storage tags");
  assert.deepEqual(sections.decodeRasterLayerTable(wire, limits), table);
  for (const flag of [129, 130, 131, 136, 144, 160]) {
    const corrupt = wire.slice(); corrupt[2] = flag;
    assert.throws(() => sections.decodeRasterLayerTable(corrupt, limits), /conflicting storage/);
  }
  for (const [storage, flag] of [["rgba", 0], ["png", 1], ["webp", 2], ["mono", 8], ["jbig2", 16], ["binary", 32]]) {
    assert.equal(sections.encodeRasterLayerTable({ atlases: [], layers: [{ ...placement(0, 0), storage }] })[2], flag,
      `${storage} keeps its historical wire flag`);
  }
  assert.throws(() => sections.encodeRasterLayerTable({ atlases: [], layers: [records[0], { ...records[1], storage: "png" }] }),
    /incompatible section/);

  const fixtures = [];
  for (const [name, components] of [["rgb", 3], ["gray", 1]]) {
    const encoded = new Uint8Array(await readFile(new URL(`./fixtures/codecs/${name}-8x8.jp2`, import.meta.url)));
    const decoded = await decodeBundledJpx({ codec: "jpeg2000", encoded, globals: new Uint8Array(), width: 8, height: 8,
      components, bitsPerComponent: 8, imageMask: false, decodeParameters: {} }, Number.MAX_SAFE_INTEGER);
    const data = new Uint8Array(8 * 8 * 4);
    for (let pixel = 0; pixel < 64; pixel++) {
      for (let channel = 0; channel < 3; channel++) data[pixel * 4 + channel] = decoded.samples[pixel * components + (components === 1 ? 0 : channel)];
      data[pixel * 4 + 3] = 255;
    }
    const sourceJpx = { width: 8, height: 8, components, encoded,
      rgbaHash: fingerprints.hashSourceJpxRgba(data, 8, 8), encodedHash: fingerprints.hashSourceJpxEncoded(encoded) };
    fixtures.push({ data, sourceJpx, section: jpx.encodeHepJpxRaster(sourceJpx) });
  }
  const layers = [
    { ...placement(0, 0), data: fixtures[0].data, interpolate: true },
    { ...placement(1, 1, .375), data: fixtures[0].data, interpolate: false },
    { ...placement(2, 1, 0), data: fixtures[1].data }
  ];
  const scene = { ...createEmptyVectorScene(), pageCount: 2, pagesPerRow: 2,
    pageRects: Float32Array.of(0, 0, 30, 30, 31, 0, 61, 30), pageTextRanges: Uint32Array.of(0, 0, 0, 0),
    bounds: { minX: 0, minY: 0, maxX: 61, maxY: 30 }, pageBounds: { minX: 0, minY: 0, maxX: 61, maxY: 30 },
    rasterLayers: layers, rasterLayerWidth: 8, rasterLayerHeight: 8, rasterLayerData: fixtures[0].data,
    rasterLayerMatrix: layers[0].matrix, imagePaintOpCount: 3, drawRuns: [{ kind: "raster", first: 0, count: 3 }] };
  const original = new Uint8Array(await (await buildHep(scene, { compression: "store", encodeRasterImages: false })).arrayBuffer());
  const editArchive = async (bytes, edit) => {
    const archive = await HepArchive.loadAsync(bytes); await edit(archive);
    return archive.generateAsync({ type: "uint8array", compression: "STORE" });
  };
  const version16LegacyPixels = await editArchive(original, async archive => {
    const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
    archive.file("manifest.json", JSON.stringify({ ...manifest, formatVersion: 16 }));
  });
  assert.deepEqual((await loadSceneFromHep(version16LegacyPixels)).rasterLayers.map(layer => layer.data), layers.map(layer => layer.data),
    "v16 continues to read the unchanged earlier raster storage formats");
  const stored = await editArchive(original, async archive => {
    for (const name of Object.keys(archive.files)) if (name.startsWith("raster/")) archive.remove(name);
    archive.file("raster/layer-0.jpx", fixtures[0].section);
    archive.file("raster/layer-2.jpx", fixtures[1].section);
    archive.file(sections.SCENE_RASTER_LAYERS_PATH, wire);
    const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
    manifest.formatVersion = 16; manifest.scene.rasterLayers.atlasCount = 0;
    archive.file("manifest.json", JSON.stringify(manifest));
  });
  const loaded = await loadSceneFromHep(stored);
  for (const [index, expected] of layers.entries()) {
    const actual = loaded.rasterLayers[index];
    assert.deepEqual(actual.data, expected.data, "pinned JPX decoding returns exact canonical source pixels");
    assert.deepEqual(actual.matrix, expected.matrix);
    assert.equal(actual.opacity, expected.opacity); assert.equal(actual.pageIndex, expected.pageIndex);
    assert.equal(actual.paintOrder, expected.paintOrder); assert.equal(actual.interpolate, expected.interpolate);
    assert.deepEqual(actual.sourceJpx.encoded, fixtures[index === 2 ? 1 : 0].sourceJpx.encoded);
    assert.deepEqual(actual.sourceJpx.rgbaHash, fixtures[index === 2 ? 1 : 0].sourceJpx.rgbaHash);
  }
  assert.equal(loaded.rasterLayers[1].data, loaded.rasterLayers[0].data, "shared placements decode pixels once");
  assert.equal(loaded.rasterLayers[1].sourceJpx, loaded.rasterLayers[0].sourceJpx, "shared placements retain one provenance snapshot");
  for (let formatVersion = 9; formatVersion < 16; formatVersion++) {
    const outdated = await editArchive(stored, async archive => {
      const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
      archive.file("manifest.json", JSON.stringify({ ...manifest, formatVersion }));
    });
    await assert.rejects(loadSceneFromHep(outdated), /(?:JPEG 2000|Shared raster).*v(?:16|15)/);
  }
  for (const [edit, pattern] of [
    [archive => archive.remove("raster/layer-0.jpx"), /missing raster layer/i],
    [archive => archive.file("raster/layer-0.jpx", new Uint8Array(32)), /JPEG 2000 section size/],
    [archive => { const bytes = fixtures[0].section.slice(); new DataView(bytes.buffer).setUint32(8, 9, true); archive.file("raster/layer-0.jpx", bytes); }, /dimension/i],
    [archive => { const bytes = fixtures[0].section.slice(); bytes[20] ^= 1; archive.file("raster/layer-0.jpx", bytes); }, /hash|fingerprint/i]
  ]) await assert.rejects(loadSceneFromHep(await editArchive(stored, edit)), pattern);
  const controller = new AbortController(); controller.abort(new Error("cancel JPX reader"));
  await assert.rejects(loadSceneFromHep(stored, { signal: controller.signal }), /cancel JPX reader/);
  console.log("HEP JPX wire flags, version gates, canonical pixels, provenance, shared placements and malformed input passed.");
} finally { hooks.deregister(); }
