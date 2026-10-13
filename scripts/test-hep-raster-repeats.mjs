import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { encodeHepRasterRepeats, decodeHepRasterRepeats, hepRasterRepeatsByteLength,
    SCENE_RASTER_REPEATS_PATH } = await import("../src/hepRasterRepeats.ts");
  const { rasterRepeatMatrix, rasterRepeatBounds, rasterRepeatCount } = await import("../src/rasterRepeat.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { createMonochromeRasterLayer } = await import("../src/monochromeRaster.ts");
  const { HepArchive } = await import("../src/hepContainer.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hepReader.ts");
  const repeat = { transform: Float64Array.of(1.0000001192092896, 0, -0, 1.23456789012345, 1000000.25, -1024 / 3),
    bounds: Float64Array.of(-0, .00000000002, .9998646415770054, 1), xStep: 1, yStep: 1.25,
    xFirst: -3, xLast: 2, yFirst: 1, yLast: 4, translations: Float64Array.of(1.125, 1 / 3, -.625, -.125) };
  const otherRepeat = { ...repeat, transform: Float64Array.of(0, 1, -1, 0, 20, 30),
    translations: undefined, xFirst: 0, xLast: 1, yFirst: -2, yLast: 0 };
  const pixels = Uint8Array.of(12, 34, 56, 78, 91, 123, 145, 255);
  const ordinary = { width: 2, height: 1, data: pixels, matrix: Float32Array.of(2, 0, 0, 1, 0, 0),
    paintOrder: 0, pageIndex: 0, interpolate: false };
  const repeated = (base, grid) => {
    const bounds = rasterRepeatBounds(grid);
    return { ...base, repeat: grid, matrix: Float32Array.of(bounds.maxX - bounds.minX, 0, 0,
      bounds.maxY - bounds.minY, bounds.minX, bounds.minY) };
  };
  const color = repeated({ ...ordinary, paintOrder: 1, opacity: .375 }, repeat);
  const packed = createMonochromeRasterLayer(repeated({ width: 16, height: 16, paintOrder: 2, pageIndex: 0,
    interpolate: false }, otherRepeat), { data: new Uint8Array(32).fill(0x55),
    colors: Uint8Array.of(0, 0, 0, 255, 255, 255, 255, 255) });
  const layers = [ordinary, color, packed];
  const before = structuredClone(repeat);
  const encoded = encodeHepRasterRepeats(layers);
  assert.equal(encoded.count, 2); assert.equal(encoded.translationCount, 2);
  assert.equal(encoded.bytes.length, 4 + 136 * 2 + 16 * 2);
  assert.equal(hepRasterRepeatsByteLength(2, 2), encoded.bytes.length);
  const reference = new Uint8Array(encoded.bytes.length), view = new DataView(reference.buffer);
  view.setUint32(0, 2, true);
  let offset = 4;
  for (const [index, grid] of [[1, repeat], [2, otherRepeat]]) {
    view.setUint32(offset, index, true); view.setUint32(offset + 4, (grid.translations?.length ?? 0) / 2, true);
    offset += 8;
    for (const value of [...grid.transform, ...grid.bounds, grid.xStep, grid.yStep,
      grid.xFirst, grid.xLast, grid.yFirst, grid.yLast, ...(grid.translations ?? [])]) {
      view.setFloat64(offset, value, true); offset += 8;
    }
  }
  assert.deepEqual(encoded.bytes, reference, "the wire format retains exact little-endian float64 placement values");
  const padded = new Uint8Array(encoded.bytes.length + 13); padded.set(encoded.bytes, 7);
  const restored = decodeHepRasterRepeats(padded.subarray(7, 7 + encoded.bytes.length), layers.length, 2, 2);
  assert.deepEqual(restored.get(1), repeat);
  assert(Object.is(restored.get(1).bounds[0], -0));
  assert.deepEqual(restored.get(2), Object.fromEntries(Object.entries(otherRepeat).filter(([, value]) => value !== undefined)));
  for (let y = repeat.yFirst; y <= repeat.yLast; y++) for (let x = repeat.xFirst; x <= repeat.xLast; x++) {
    assert.deepEqual(rasterRepeatMatrix(restored.get(1), x, y), rasterRepeatMatrix(repeat, x, y),
      "each cell retains the same float32 rounding and sequential scene translations");
  }
  assert.deepEqual(repeat, before, "encoding preserves canonical source metadata");
  assert.equal(encodeHepRasterRepeats([ordinary]), undefined);
  const huge = { ...repeat, xFirst: 2 ** 40, xLast: 2 ** 40 + 1, yFirst: 0, yLast: 0 };
  const hugeEncoded = encodeHepRasterRepeats([{ ...ordinary, repeat: huge }]);
  assert.equal(decodeHepRasterRepeats(hugeEncoded.bytes, 1, 1, 2).get(0).xFirst, huge.xFirst,
    "safe cell coordinates are not narrowed to int32");
  const manyCells = { ...repeat, xFirst: 0, xLast: 999999, yFirst: 0, yLast: 999999 };
  const manyEncoded = encodeHepRasterRepeats([{ ...ordinary, repeat: manyCells }]);
  assert.equal(manyEncoded.bytes.length, hugeEncoded.bytes.length,
    "serialized size depends on repeat paints and translations, not the number of cells");
  assert.equal(rasterRepeatCount(decodeHepRasterRepeats(manyEncoded.bytes, 1, 1, 2).get(0)), 1_000_000_000_000,
    "decoding validates large safe grids without expanding cells or introducing a resource ceiling");

  const corrupt = change => { const bytes = encoded.bytes.slice(); change(new DataView(bytes.buffer)); return bytes; };
  const secondRecord = 4 + 136 + 32;
  for (const [bytes, pattern] of [
    [encoded.bytes.subarray(1), /byte length/],
    [Uint8Array.from([...encoded.bytes, 0]), /byte length/],
    [corrupt(v => v.setUint32(0, 1, true)), /record count/],
    [corrupt(v => v.setUint32(4, 3, true)), /layer indices/],
    [corrupt(v => v.setUint32(secondRecord, 1, true)), /layer indices/],
    [corrupt(v => v.setUint32(8, 0xffffffff, true)), /translation count/],
    [corrupt(v => v.setFloat64(12, NaN, true)), /repeat|finite/i],
    [corrupt(v => v.setFloat64(12 + 10 * 8, 0, true)), /repeat|step/i],
    [corrupt(v => v.setFloat64(12 + 12 * 8, .5, true)), /repeat|integer/i],
    [corrupt(v => v.setFloat64(12 + 16 * 8, Infinity, true)), /repeat|translation|finite/i]
  ]) assert.throws(() => decodeHepRasterRepeats(bytes, 3, 2, 2), pattern);
  assert.throws(() => decodeHepRasterRepeats(encoded.bytes, 1, 2, 2), /layer count/);
  for (const counts of [[0, 0], [1.5, 0], [1, -1], [1, Number.MAX_SAFE_INTEGER]]) {
    assert.throws(() => hepRasterRepeatsByteLength(...counts), /out of range/);
  }
  const cancellation = new AbortController(); cancellation.abort(new Error("cancelled repeat codec"));
  assert.throws(() => encodeHepRasterRepeats(layers, cancellation.signal), /cancelled repeat codec/);
  assert.throws(() => decodeHepRasterRepeats(encoded.bytes, 3, 2, 2, cancellation.signal), /cancelled repeat codec/);
  for (const run of [signal => encodeHepRasterRepeats(layers, signal),
    signal => decodeHepRasterRepeats(encoded.bytes, 3, 2, 2, signal)]) {
    let checks = 0;
    assert.throws(() => run({ throwIfAborted() { if (++checks === 15) throw new Error("cancelled while copying repeat values"); } }), /cancelled while copying/);
  }

  const bounds = rasterRepeatBounds(repeat);
  const scene = Object.assign(createEmptyVectorScene(), { pageCount: 1, bounds, pageBounds: bounds,
    pageRects: Float32Array.of(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY),
    rasterLayers: layers, imagePaintOpCount: layers.length,
    drawRuns: layers.map((_, first) => ({ kind: "raster", first, count: 1 })) });
  const options = { withVectorLod: false, withTextLod: false, encodeRasterImages: false, compression: "store" };
  const bytes = await (await buildHep(scene, options)).arrayBuffer();
  const archive = await HepArchive.loadAsync(bytes);
  const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
  assert.equal(manifest.formatVersion, 14);
  assert.deepEqual(manifest.scene.rasterLayers.repeats, { file: SCENE_RASTER_REPEATS_PATH, count: 2, translationCount: 2 });
  assert.deepEqual(await archive.file(SCENE_RASTER_REPEATS_PATH).async("uint8array"), encoded.bytes);
  const loaded = await loadSceneFromHep(bytes);
  assert.equal(loaded.rasterLayers.length, 3, "HEP loading keeps compact paints rather than expanding repeat cells");
  assert.equal(rasterRepeatCount(loaded.rasterLayers[1].repeat), 24);
  assert.equal(loaded.rasterLayers[0].repeat, undefined);
  assert.deepEqual(loaded.rasterLayers[1].repeat, repeat);
  assert.deepEqual(loaded.rasterLayers[1].data, pixels);
  assert.equal(loaded.rasterLayers[1].opacity, .375); assert.equal(loaded.rasterLayers[1].interpolate, false);
  assert.deepEqual(loaded.rasterLayers[2].monochrome, packed.monochrome, "packed rasters also retain repeat metadata");
  assert.deepEqual(loaded.rasterLayers[2].repeat, restored.get(2));
  assert.deepEqual(loaded.drawRuns, scene.drawRuns);
  const reexport = await HepArchive.loadAsync(await (await buildHep(loaded, options)).arrayBuffer());
  assert.deepEqual(await reexport.file(SCENE_RASTER_REPEATS_PATH).async("uint8array"), encoded.bytes,
    "loading and re-exporting do not fold post-float32 translations or quantize original transforms");
  const grouped = { ...scene, rasterLayers: Array.from({ length: 128 }, (_, index) =>
    index < layers.length ? layers[index] : { ...ordinary, paintOrder: index }), imagePaintOpCount: 128,
    drawRuns: Array.from({ length: 128 }, (_, first) => ({ kind: "raster", first, count: 1 })),
    paintGraph: { roots: Array.from({ length: 128 }, (_, runIndex) => ({ kind: "group", alpha: .5,
      isolated: false, knockout: false, blendMode: "Darken", children: [{ kind: "draw", runIndex }] })) } };
  const groupedBytes = await (await buildHep(grouped, options)).arrayBuffer();
  const groupedArchive = await HepArchive.loadAsync(groupedBytes);
  const groupedManifest = JSON.parse(await groupedArchive.file("manifest.json").async("string"));
  assert.equal(groupedManifest.formatVersion, 14);
  assert.equal(groupedManifest.scene.paintGraph.encoding, "group-runs-v1",
    "repeat grids coexist with the earlier scene v13 paint-group encoding");
  const groupedLoaded = await loadSceneFromHep(groupedBytes);
  assert.deepEqual(groupedLoaded.paintGraph, grouped.paintGraph);
  assert.deepEqual(groupedLoaded.rasterLayers[1].repeat, repeat);

  const rewritten = async edit => {
    const changed = await HepArchive.loadAsync(bytes), meta = JSON.parse(await changed.file("manifest.json").async("string"));
    edit(meta, changed); changed.file("manifest.json", JSON.stringify(meta));
    return changed.generateAsync({ type: "arraybuffer", compression: "STORE" });
  };
  for (const edit of [
    m => { m.formatVersion = 13; },
    m => { m.scene.rasterLayers.repeats.file = "other.bin"; },
    m => { m.scene.rasterLayers.repeats.count = 4; },
    m => { m.scene.rasterLayers.repeats.translationCount = 3; },
    m => { m.scene.rasterLayers.repeats.translationCount = -1; },
    (_, a) => { a.remove(SCENE_RASTER_REPEATS_PATH); },
    (_, a) => { a.file(SCENE_RASTER_REPEATS_PATH, encoded.bytes.subarray(1)); }
  ]) await assert.rejects(loadSceneFromHep(await rewritten(edit)), /repeat|format|count|length|entry|section/i);
  await assert.rejects(loadSceneFromHep(bytes, { signal: cancellation.signal }), /cancelled repeat codec/);
  const legacyScene = { ...scene, rasterLayers: [ordinary], imagePaintOpCount: 1,
    drawRuns: [{ kind: "raster", first: 0, count: 1 }] };
  const legacyBytes = await (await buildHep(legacyScene, options)).arrayBuffer();
  const legacyArchive = await HepArchive.loadAsync(legacyBytes);
  const legacyManifest = JSON.parse(await legacyArchive.file("manifest.json").async("string"));
  assert.equal(legacyManifest.formatVersion, 9); assert.equal(legacyManifest.scene.rasterLayers.repeats, undefined);
  legacyManifest.formatVersion = 12; legacyArchive.file("manifest.json", JSON.stringify(legacyManifest));
  assert.equal((await loadSceneFromHep(await legacyArchive.generateAsync({ type: "arraybuffer", compression: "STORE" }))).rasterLayers[0].repeat, undefined,
    "older scene v12 files retain ordinary raster behavior");
  console.log("HEP raster repeats passed: exact float64 grids/translations, compact roundtrip/re-export, mixed pixels, old schemas, malformed payloads and cancellation.");
} finally { hooks.deregister(); }
