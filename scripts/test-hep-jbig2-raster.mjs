// Tiny synthetic JBIG2 pages only: no corpus conversion, browser, or server.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { HepArchive } from "./lib/hepContainer.mjs";
import { tinySymbolJbig2, imagePdf } from "./lib/imageCodecFixtures.mjs";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });

function guardRgba(scene) {
  for (const layer of scene.rasterLayers) if (layer.monochrome) Object.defineProperty(layer, "data", {
    enumerable: true, configurable: true,
    get() { throw new Error("HEP export must not expand scans into RGBA"); }
  });
  if (scene.rasterLayers[0]?.monochrome) Object.defineProperty(scene, "rasterLayerData", {
    enumerable: true, configurable: true,
    get() { throw new Error("HEP export must not read the primary RGBA alias"); }
  });
  return scene;
}

function rasterScene(emptyScene, layers) {
  const primary = layers[0];
  return guardRgba({
    ...emptyScene(), pageCount: 2, pagesPerRow: 2,
    pageRects: Float32Array.of(0, 0, 300, 300, 301, 0, 601, 300),
    pageTextRanges: Uint32Array.of(0, 0, 0, 0),
    bounds: { minX: 0, minY: 0, maxX: 601, maxY: 300 },
    pageBounds: { minX: 0, minY: 0, maxX: 601, maxY: 300 },
    imagePaintOpCount: layers.length, rasterLayers: layers,
    rasterLayerWidth: primary.width, rasterLayerHeight: primary.height,
    rasterLayerMatrix: primary.matrix,
    drawRuns: [{ kind: "raster", first: 0, count: layers.length }]
  });
}

async function editArchive(bytes, edit) {
  const archive = await HepArchive.loadAsync(bytes);
  await edit(archive);
  return archive.generateAsync({ type: "uint8array", compression: "STORE" });
}

// Legacy v11 fixtures are assembled independently of the current writer.
function legacySection(encoded, globalsLength, colors, invert, packedHash, globalsIndex = 0) {
  const bytes = new Uint8Array(40 + encoded.length);
  bytes.set([0x48, 0x4a, 0x42, 0x31]);
  bytes[4] = invert ? 1 : 0;
  bytes.set(colors, 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, encoded.length, true);
  view.setUint32(20, globalsLength, true);
  view.setUint32(24, globalsLength ? globalsIndex : 0xffffffff, true);
  view.setUint32(28, packedHash[0], true);
  view.setUint32(32, packedHash[1], true);
  bytes.set(encoded, 40);
  return bytes;
}

try {
  const [{ buildHep }, { loadSceneFromHep }, { openPdf }, { createEmptyVectorScene },
    sections, codec, mono, { collectPdfTransferables }] = await Promise.all([
    import("../src/hepBuilder.ts"), import("../src/hep.ts"), import("../src/pdfSession.ts"),
    import("../src/emptyVectorScene.ts"), import("../src/hepRasterLayers.ts"),
    import("../src/hepJbig2Raster.ts"), import("../src/monochromeRaster.ts"),
    import("../src/pdf/workerProtocol.ts")
  ]);
  const limits = { maxLayers: 100, maxAtlases: 4, maxDimension: 16_384 };
  const readTable = async archive => sections.decodeRasterLayerTable(
    await archive.file(sections.SCENE_RASTER_LAYERS_PATH).async("uint8array"), limits
  );
  const width = 257, height = 257;
  const fixture = tinySymbolJbig2({ width, height, useGlobals: true,
    placements: [[0, 0], [8, 1], [12, 2], [256, 256], [-1, 0], [258, 258]] });
  const encodedBefore = fixture.encoded.slice(), globalsBefore = fixture.globals.slice();
  const layers = [];
  for (const [index, extra] of ["", "/Decode [1 0]"].entries()) {
    const session = await openPdf({ kind: "bytes", bytes: imagePdf(fixture.encoded, {
      filter: "JBIG2Decode", width, height, colorSpace: "/DeviceGray",
      bitsPerComponent: 1, extra, globals: fixture.globals
    }) });
    try {
      const scene = await session.compileVectorPage(0, { optimization: "none", vectorFallback: "error" });
      const layer = scene.rasterLayers[0];
      assert(layer.monochrome, "native JBIG2 scans retain canonical packed pixels");
      assert.equal(layer.monochrome.jbig2Source, undefined,
        "PDF parsing keeps packed pixels and GPU symbols without retaining encoded source streams");
      if (!index) assert(layer.monochrome.symbols, "ordinary symbol pages retain their GPU dictionary");
      layers.push(mono.copyRasterLayer(layer, {
        matrix: Float32Array.of(257.5, -1.25, 2.5, -257.75, 42.25, -1.75),
        paintOrder: index + 4, pageIndex: index, opacity: index ? 0 : 0.375
      }));
    } finally { await session.close(); }
  }
  assert.deepEqual(fixture.encoded, encodedBefore);
  assert.deepEqual(fixture.globals, globalsBefore);

  const decodeBudget = 32 * 1024 * 1024;
  const palette = Uint8Array.of(7, 11, 13, 0, 241, 223, 197, 127);
  for (const layer of layers) layer.monochrome.colors = palette;
  const hashes = layers.map(layer => mono.hashMonochromePixels(layer.monochrome.data, width, height));
  const section = legacySection(fixture.encoded, fixture.globals.length, palette, false, hashes[0]);
  assert.equal(section.length, codec.HEP_JBIG2_RASTER_HEADER_BYTES + fixture.encoded.length);
  assert.deepEqual(section.subarray(codec.HEP_JBIG2_RASTER_HEADER_BYTES), fixture.encoded);
  const inspected = codec.inspectHepJbig2Raster(section, width, height, decodeBudget);
  assert.deepEqual(inspected.encoded, fixture.encoded);
  assert.deepEqual(inspected.colors, palette);
  assert.equal(inspected.globalsIndex, 0);
  assert.equal(inspected.globalsLength, fixture.globals.length);
  assert.equal(inspected.invert, false);
  assert.deepEqual(inspected.packedHash, hashes[0]);
  assert.equal(inspected.encoded.buffer, section.buffer, "inspection borrows encoded bytes rather than expanding pixels");
  const borrowed = new Uint8Array(section.length + 11);
  borrowed.set(section, 7);
  const decoded = await codec.decodeHepJbig2Raster(borrowed.subarray(7, 7 + section.length),
    fixture.globals, width, height, decodeBudget);
  assert.deepEqual(decoded.data, layers[0].monochrome.data);
  assert.deepEqual(decoded.colors, palette);
  assert.notEqual(decoded.colors.buffer, borrowed.buffer,
    "the decoded palette must not retain the original compressed section");
  assert.deepEqual(decoded.symbols, layers[0].monochrome.symbols);
  assert.deepEqual(fixture.encoded, encodedBefore);
  assert.deepEqual(fixture.globals, globalsBefore);
  const invertedSection = legacySection(fixture.encoded, fixture.globals.length, palette, true, hashes[1]);
  const inverted = await codec.decodeHepJbig2Raster(invertedSection, fixture.globals, width, height, decodeBudget);
  assert.deepEqual(inverted.data, layers[1].monochrome.data);
  assert.equal(inverted.symbols, undefined, "inverted pixels cannot use the original black-symbol atlas");
  assert.deepEqual(inverted.colors, palette);
  const standalone = tinySymbolJbig2({ width, height, placements: [[0, 0], [8, 1], [12, 2], [256, 256]] });
  const withoutGlobals = legacySection(standalone.encoded, 0, palette, false, hashes[0]);
  assert.equal(codec.inspectHepJbig2Raster(withoutGlobals, width, height, decodeBudget).globalsLength, 0);
  assert.deepEqual((await codec.decodeHepJbig2Raster(withoutGlobals, new Uint8Array(), width, height, decodeBudget)).data,
    layers[0].monochrome.data);
  for (const changed of [
    bytes => { bytes[0] ^= 1; }, bytes => { bytes[4] |= 2; }, bytes => { bytes[5] = 1; },
    bytes => { bytes[36] = 1; },
    bytes => { new DataView(bytes.buffer).setUint32(16, 0, true); },
    bytes => { new DataView(bytes.buffer).setUint32(16, fixture.encoded.length + 1, true); },
    bytes => { new DataView(bytes.buffer).setUint32(20, 0, true); },
    bytes => { new DataView(bytes.buffer).setUint32(24, codec.HEP_JBIG2_NO_GLOBALS, true); }
  ]) {
    const invalid = section.slice();
    changed(invalid);
    assert.throws(() => codec.inspectHepJbig2Raster(invalid, width, height, decodeBudget), /header|flag|reserved|length|globals/i);
  }
  assert.throws(() => codec.inspectHepJbig2Raster(section.subarray(0, 39), width, height, decodeBudget), /header/i);
  assert.throws(() => codec.inspectHepJbig2Raster(section, width, height,
    layers[0].monochrome.data.length + fixture.encoded.length + fixture.globals.length - 1), /budget/i);
  await assert.rejects(codec.decodeHepJbig2Raster(section, fixture.globals.subarray(0, fixture.globals.length - 1),
    width, height, decodeBudget), /globals|length/i);
  const wrongHash = section.slice();
  wrongHash[28] ^= 1;
  await assert.rejects(codec.decodeHepJbig2Raster(wrongHash, fixture.globals, width, height, decodeBudget), /hash/i);
  const scene = rasterScene(createEmptyVectorScene, layers);

  // Worker messages preserve packed pixels and GPU symbols without detaching cached data.
  const transport = mono.prepareMonochromeSceneTransfer(scene);
  const transferred = structuredClone(transport, {
    transfer: collectPdfTransferables(transport.rasterLayers.map(layer => layer.monochrome))
  });
  const restored = mono.restoreMonochromeSceneTransfer(transferred);
  for (const [index, layer] of layers.entries()) {
    assert.deepEqual(restored.rasterLayers[index].monochrome.data, layer.monochrome.data);
    assert.deepEqual(restored.rasterLayers[index].monochrome.symbols, layer.monochrome.symbols);
    assert.equal(restored.rasterLayers[index].monochrome.jbig2Source, undefined);
    assert(layer.monochrome.data.byteLength > 0);
  }

  let fastBytes, fastTable;
  for (const compression of ["store", "deflate"]) {
    for (const encodeRasterImages of [true, false]) {
      const progress = [];
      const bytes = new Uint8Array(await (await buildHep(scene, {
        compression, encodeRasterImages, onProgress: event => progress.push(event)
      })).arrayBuffer());
      const archive = await HepArchive.loadAsync(bytes);
      const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
      const table = await readTable(archive);
      assert.equal(manifest.formatVersion, 12);
      assert.deepEqual(table.atlases, []);
      assert.deepEqual(table.layers.map(layer => layer.storage), ["binary", "binary"]);
      assert.deepEqual(Object.keys(archive.files).filter(name => name.startsWith("raster/")).sort(),
        ["raster/layer-0.binary", "raster/layer-1.binary"],
        "all exports use fast binary scan sections without original streams or global dictionaries");
      assert(progress.every((event, index) => Number.isFinite(event.value) && event.value >= 0 && event.value <= 1 &&
        (!index || event.value >= progress[index - 1].value)));
      assert.equal(progress.at(-1).value, 1);
      const loaded = await loadSceneFromHep(bytes);
      for (const [index, expected] of layers.entries()) {
        const actual = loaded.rasterLayers[index];
        assert.equal(actual.width, expected.width);
        assert.equal(actual.height, expected.height);
        assert.equal(actual.paintOrder, expected.paintOrder);
        assert.equal(actual.pageIndex, expected.pageIndex);
        assert.equal(actual.opacity, expected.opacity);
        assert.deepEqual(actual.matrix, expected.matrix);
        assert.deepEqual(actual.monochrome.data, expected.monochrome.data);
        assert.deepEqual(actual.monochrome.colors, expected.monochrome.colors);
        assert.equal(actual.monochrome.jbig2Source, undefined);
        assert.equal(typeof Object.getOwnPropertyDescriptor(actual, "data")?.get, "function");
      }
      const reexport = await HepArchive.loadAsync(await (await buildHep(guardRgba(loaded), {
        compression: "store", encodeRasterImages
      })).arrayBuffer());
      assert.deepEqual((await readTable(reexport)).layers.map(layer => layer.storage), ["binary", "binary"]);
      if (compression === "store" && encodeRasterImages) { fastBytes = bytes; fastTable = table; }
    }
  }

  // Keep v11 compatibility using explicit historical envelopes rather than a
  // selectable legacy encoder in the current production export path.
  const storedTable = { ...fastTable, layers: fastTable.layers.map(layer => ({ ...layer, storage: "jbig2" })) };
  const storedBytes = await editArchive(fastBytes, async archive => {
    for (const name of Object.keys(archive.files)) if (name.startsWith("raster/")) archive.remove(name);
    archive.file(codec.hepJbig2GlobalsFile(0), fixture.globals);
    for (const [index, layer] of layers.entries()) archive.file(`raster/layer-${index}.jbig2`,
      legacySection(fixture.encoded, fixture.globals.length, layer.monochrome.colors, !!index, hashes[index]));
    archive.file(sections.SCENE_RASTER_LAYERS_PATH, sections.encodeRasterLayerTable(storedTable));
    const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
    archive.file("manifest.json", JSON.stringify({ ...manifest, formatVersion: 11 }));
  });
  const legacy = await loadSceneFromHep(storedBytes);
  for (const [index, expected] of layers.entries()) {
    const actual = legacy.rasterLayers[index];
    assert.deepEqual(actual.monochrome.data, expected.monochrome.data);
    assert.deepEqual(actual.monochrome.colors, expected.monochrome.colors);
    assert.deepEqual(actual.matrix, expected.matrix);
    assert.equal(actual.opacity, expected.opacity);
    assert.equal(actual.pageIndex, expected.pageIndex);
    assert.equal(actual.paintOrder, expected.paintOrder);
    assert.equal(actual.monochrome.jbig2Source, undefined, "legacy loading releases original encoded streams");
    if (!index) assert.deepEqual(actual.monochrome.symbols, expected.monochrome.symbols);
    for (let y = 0; y < height; y += 1) assert.equal(actual.monochrome.data[y * Math.ceil(width / 8) + 32] & 127, 0,
      "legacy decode normalizes sub-byte row padding without touching the next row");
  }
  for (const encodeRasterImages of [true, false]) {
    const reexport = await HepArchive.loadAsync(await (await buildHep(guardRgba(legacy), {
      compression: "store", encodeRasterImages
    })).arrayBuffer());
    assert.equal(JSON.parse(await reexport.file("manifest.json").async("string")).formatVersion, 12);
    assert.deepEqual((await readTable(reexport)).layers.map(layer => layer.storage), ["binary", "binary"],
      "re-exporting an old small HEP migrates its decoded scans to the fast format");
    assert(Object.keys(reexport.files).every(name => !/jbig2/.test(name)));
  }

  // Edits export the current canonical pixels instead of reviving old streams.
  const changed = mono.copyRasterLayer(legacy.rasterLayers[0]);
  changed.monochrome = { ...changed.monochrome, data: changed.monochrome.data.slice() };
  changed.monochrome.data[0] ^= 0x80;
  const changedBytes = await (await buildHep(rasterScene(createEmptyVectorScene, [changed]), {
    compression: "store", encodeRasterImages: false
  })).arrayBuffer();
  assert.deepEqual((await loadSceneFromHep(changedBytes)).rasterLayers[0].monochrome.data, changed.monochrome.data);

  // A larger fast-opening file stays downloadable and reports the tradeoff.
  const fastWarnings = [], consoleWarnings = [], originalWarn = console.warn;
  let fastBlob;
  try {
    console.warn = message => consoleWarnings.push(message);
    fastBlob = await buildHep(scene, { sourcePdfByteLength: 1,
      compression: "store", onWarning: message => fastWarnings.push(message) });
  } finally { console.warn = originalWarn; }
  assert.equal(fastWarnings.length, 1);
  assert.deepEqual(fastWarnings, consoleWarnings.map(message => message.replace(/^\[HEP\] /, "")));
  assert(fastWarnings[0].includes(String(fastBlob.size)) && fastWarnings[0].includes("1 bytes"));
  const warnedBytes = await fastBlob.arrayBuffer();
  const fastArchive = await HepArchive.loadAsync(warnedBytes);
  assert.equal(JSON.parse(await fastArchive.file("manifest.json").async("string")).formatVersion, 12);
  assert.deepEqual((await readTable(fastArchive)).layers.map(layer => layer.storage), ["binary", "binary"]);
  const fast = await loadSceneFromHep(warnedBytes);
  for (const [index, layer] of layers.entries()) assert.deepEqual(fast.rasterLayers[index].monochrome.data, layer.monochrome.data);
  for (const version of [9, 10, 11]) await assert.rejects(loadSceneFromHep(await editArchive(fastBytes, async archive => {
    const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
    archive.file("manifest.json", JSON.stringify({ ...manifest, formatVersion: version }));
  })), /v12|version 12|binary|format/i);

  const plain = mono.createMonochromeRasterLayer({ width: 3, height: 1, matrix: layers[0].matrix,
    paintOrder: layers[0].paintOrder, pageIndex: layers[0].pageIndex, opacity: layers[0].opacity },
    { data: Uint8Array.of(0xa5), colors: palette });
  const color = { width: 20, height: 1, matrix: Float32Array.of(20, 0, 0, 1, 0, 0),
    data: Uint8Array.from({ length: 80 }, (_, index) => index * 17 & 255), paintOrder: 8, pageIndex: 1 };
  const mixedSeed = await (await buildHep(rasterScene(createEmptyVectorScene, [layers[0], plain, color,
    { ...color, data: color.data.slice(), paintOrder: 9 }]), {
    compression: "store", encodeRasterImages: false
  })).arrayBuffer();
  const mixedBytes = await editArchive(mixedSeed, async archive => {
    archive.remove("raster/layer-0.binary");
    archive.file("raster/layer-0.jbig2", legacySection(fixture.encoded, fixture.globals.length,
      layers[0].monochrome.colors, false, hashes[0]));
    archive.file(codec.hepJbig2GlobalsFile(0), fixture.globals);
    const table = await readTable(archive);
    table.layers[0].storage = "jbig2";
    archive.file(sections.SCENE_RASTER_LAYERS_PATH, sections.encodeRasterLayerTable(table));
    const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
    archive.file("manifest.json", JSON.stringify({ ...manifest, formatVersion: 11 }));
  });
  const mixedArchive = await HepArchive.loadAsync(mixedBytes);
  assert.deepEqual((await readTable(mixedArchive)).layers.map(layer => layer.storage), ["jbig2", "mono", "atlas", "atlas"]);
  const mixed = await loadSceneFromHep(mixedBytes);
  assert.deepEqual(mixed.rasterLayers[0].monochrome.data, layers[0].monochrome.data);
  assert.deepEqual(mixed.rasterLayers[1].monochrome.data, plain.monochrome.data);
  assert.deepEqual(mixed.rasterLayers[2].data, color.data);
  assert.deepEqual(mixed.rasterLayers[3].data, color.data);

  const standaloneTable = sections.encodeRasterLayerTable({ atlases: [], layers: [storedTable.layers[0]] });
  assert.equal(standaloneTable[2], 16 | 4, "original JBIG2 has its own flag and retains opacity");
  for (const flag of [16 | 1, 16 | 2, 16 | 3, 16 | 8, 16 | 32, 64, 128]) {
    const invalid = standaloneTable.slice();
    invalid[2] = flag;
    assert.throws(() => sections.decodeRasterLayerTable(invalid, limits), /flag|storage/i);
  }

  for (const version of [9, 10]) await assert.rejects(loadSceneFromHep(await editArchive(storedBytes, async archive => {
    const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
    archive.file("manifest.json", JSON.stringify({ ...manifest, formatVersion: version }));
  })), /v11|version 11|JBIG2|format/i);
  await assert.rejects(loadSceneFromHep(await editArchive(storedBytes, archive => {
    archive.remove("raster/layer-0.jbig2");
  })), /missing.*raster/i);
  await assert.rejects(loadSceneFromHep(await editArchive(storedBytes, archive => {
    archive.remove(codec.hepJbig2GlobalsFile(0));
  })), /missing|globals/i);
  await assert.rejects(loadSceneFromHep(await editArchive(storedBytes, async archive => {
    const globals = await archive.file(codec.hepJbig2GlobalsFile(0)).async("uint8array");
    archive.file(codec.hepJbig2GlobalsFile(0), globals.subarray(0, globals.length - 1));
  })), /globals|length|size/i);
  await assert.rejects(loadSceneFromHep(await editArchive(storedBytes, async archive => {
    const payload = (await archive.file("raster/layer-0.jbig2").async("uint8array")).slice();
    payload[28] ^= 1;
    archive.file("raster/layer-0.jbig2", payload);
  })), /hash/i);
  await assert.rejects(loadSceneFromHep(await editArchive(storedBytes, archive => {
    archive.file(sections.SCENE_RASTER_LAYERS_PATH, sections.encodeRasterLayerTable({
      ...storedTable, layers: [{ ...storedTable.layers[0], width: width + 1 }, storedTable.layers[1]]
    }));
  })), /JBIG2|dimension|hash|mismatch/i);

  const controller = new AbortController(), reason = new Error("cancel JBIG2 HEP export");
  controller.abort(reason);
  await assert.rejects(codec.decodeHepJbig2Raster(section, fixture.globals, width, height, decodeBudget, controller.signal),
    error => error === reason);
  await assert.rejects(buildHep(scene, { signal: controller.signal }), error => error === reason);
  await assert.rejects(loadSceneFromHep(storedBytes, { signal: controller.signal }), error => error === reason);
  console.log("HEP scans passed: fast default export, v11 JBIG2 compatibility and migration, exact pixels, bounded decode, inverse polarity, globals, metadata, symbols, worker ownership and version gates.");
} finally {
  hooks.deregister();
}
