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
    get() { throw new Error("JBIG2 HEP export must not expand scans into RGBA"); }
  });
  if (scene.rasterLayers[0]?.monochrome) Object.defineProperty(scene, "rasterLayerData", {
    enumerable: true, configurable: true,
    get() { throw new Error("JBIG2 HEP export must not read the primary RGBA alias"); }
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

function sectionCodecs(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = new Map();
  let offset = 32 + view.getUint32(12, true) * 20;
  for (let index = 0; index < view.getUint32(8, true); index += 1) {
    const nameLength = view.getUint16(offset, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 16, offset + 16 + nameLength));
    const chunk = view.getUint32(offset + 4, true);
    result.set(name, chunk === 0xffffffff ? null : view.getUint8(32 + chunk * 20 + 16));
    offset = Math.ceil((offset + 16 + nameLength) / 4) * 4;
  }
  return result;
}

try {
  const [{ buildHep }, { loadSceneFromHep }, { openPdf }, { createEmptyVectorScene },
    sections, codec, mono, { collectPdfTransferables }, { decodeBundledJbig2 }] = await Promise.all([
    import("../src/hepBuilder.ts"), import("../src/hep.ts"), import("../src/pdfSession.ts"),
    import("../src/emptyVectorScene.ts"), import("../src/hepRasterLayers.ts"),
    import("../src/hepJbig2Raster.ts"), import("../src/monochromeRaster.ts"),
    import("../src/pdf/workerProtocol.ts"), import("../src/pdf/nativeJbig2Codec.ts")
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
      assert(layer.monochrome.jbig2Source, "trusted native JBIG2 decoding retains encoded provenance");
      const source = layer.monochrome.jbig2Source;
      assert.equal(source.width, width);
      assert.equal(source.height, height);
      assert.equal(source.invert, index === 1);
      assert.deepEqual(source.encoded, fixture.encoded);
      assert.deepEqual(source.globals, fixture.globals);
      assert.deepEqual(source.packedHash, mono.hashMonochromePixels(layer.monochrome.data, width, height));
      if (!index) assert(layer.monochrome.symbols, "ordinary symbol pages retain their GPU dictionary");
      layers.push(mono.copyRasterLayer(layer, {
        matrix: Float32Array.of(257.5, -1.25, 2.5, -257.75, 42.25, -1.75),
        paintOrder: index + 4, pageIndex: index, opacity: index ? 0 : 0.375
      }));
    } finally { await session.close(); }
  }
  assert.deepEqual(fixture.encoded, encodedBefore);
  assert.deepEqual(fixture.globals, globalsBefore);

  // Altered PDF colors and caller-supplied decoders cannot claim that the
  // original encoded stream reproduces the prepared canonical image.
  for (const [extra, options] of [
    ["/Decode [.25 .75]", {}], ["/Mask [0 0]", {}],
    ["", { imageCodecResolver: request => decodeBundledJbig2(request, 32 * 1024 * 1024) }]
  ]) {
    const session = await openPdf({ kind: "bytes", bytes: imagePdf(fixture.encoded, {
      filter: "JBIG2Decode", width, height, colorSpace: "/DeviceGray",
      bitsPerComponent: 1, extra, globals: fixture.globals
    }) }, options);
    try {
      const scene = await session.compileVectorPage(0, { optimization: "none", vectorFallback: "error" });
      assert.equal(scene.rasterLayers[0].monochrome?.jbig2Source, undefined,
        "modified pixels and custom codec results cannot retain trusted stream provenance");
    } finally { await session.close(); }
  }

  const decodeBudget = 32 * 1024 * 1024;
  const palette = Uint8Array.of(7, 11, 13, 0, 241, 223, 197, 127);
  const source = layers[0].monochrome.jbig2Source;
  const section = codec.encodeHepJbig2Raster(source, palette, 0, width, height);
  assert.equal(section.length, codec.HEP_JBIG2_RASTER_HEADER_BYTES + fixture.encoded.length);
  assert.deepEqual(section.subarray(codec.HEP_JBIG2_RASTER_HEADER_BYTES), fixture.encoded);
  const inspected = codec.inspectHepJbig2Raster(section, width, height, decodeBudget);
  assert.deepEqual(inspected.encoded, fixture.encoded);
  assert.deepEqual(inspected.colors, palette);
  assert.equal(inspected.globalsIndex, 0);
  assert.equal(inspected.globalsLength, fixture.globals.length);
  assert.equal(inspected.invert, false);
  assert.deepEqual(inspected.packedHash, source.packedHash);
  assert.equal(inspected.encoded.buffer, section.buffer, "inspection borrows encoded bytes rather than expanding pixels");
  const borrowed = new Uint8Array(section.length + 11);
  borrowed.set(section, 7);
  const decoded = await codec.decodeHepJbig2Raster(borrowed.subarray(7, 7 + section.length),
    fixture.globals, width, height, decodeBudget);
  assert.deepEqual(decoded.data, layers[0].monochrome.data);
  assert.deepEqual(decoded.colors, palette);
  assert.deepEqual(decoded.symbols, layers[0].monochrome.symbols);
  assert.deepEqual(fixture.encoded, encodedBefore);
  assert.deepEqual(fixture.globals, globalsBefore);
  const invertedSection = codec.encodeHepJbig2Raster(layers[1].monochrome.jbig2Source, palette, 0, width, height);
  const inverted = await codec.decodeHepJbig2Raster(invertedSection, fixture.globals, width, height, decodeBudget);
  assert.deepEqual(inverted.data, layers[1].monochrome.data);
  assert.equal(inverted.symbols, undefined, "inverted pixels cannot use the original black-symbol atlas");
  assert.deepEqual(inverted.colors, palette);
  const standalone = tinySymbolJbig2({ width, height, placements: [[0, 0], [8, 1], [12, 2], [256, 256]] });
  const withoutGlobals = codec.encodeHepJbig2Raster({ ...source,
    encoded: standalone.encoded, globals: new Uint8Array()
  }, palette, codec.HEP_JBIG2_NO_GLOBALS, width, height);
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
  assert.throws(() => codec.encodeHepJbig2Raster(source, palette.subarray(0, 7), 0, width, height), /palette/i);
  assert.throws(() => codec.encodeHepJbig2Raster(source, palette, 0, width + 1, height), /dimension/i);
  await assert.rejects(codec.decodeHepJbig2Raster(section, fixture.globals.subarray(0, fixture.globals.length - 1),
    width, height, decodeBudget), /globals|length/i);
  const wrongHash = section.slice();
  wrongHash[28] ^= 1;
  await assert.rejects(codec.decodeHepJbig2Raster(wrongHash, fixture.globals, width, height, decodeBudget), /hash/i);
  const scene = rasterScene(createEmptyVectorScene, layers);

  // Worker messages copy provenance rather than detaching native cached bytes.
  const transport = mono.prepareMonochromeSceneTransfer(scene);
  const transferred = structuredClone(transport, {
    transfer: collectPdfTransferables(transport.rasterLayers.map(layer => layer.monochrome))
  });
  const restored = mono.restoreMonochromeSceneTransfer(transferred);
  for (const [index, layer] of layers.entries()) {
    assert.deepEqual(restored.rasterLayers[index].monochrome.jbig2Source, layer.monochrome.jbig2Source);
    assert(layer.monochrome.jbig2Source.encoded.byteLength > 0);
    assert(layer.monochrome.jbig2Source.globals.byteLength > 0);
    assert(layer.monochrome.data.byteLength > 0);
  }

  let storedBytes, storedTable;
  for (const compression of ["store", "deflate"]) {
    for (const encodeRasterImages of [true, false]) {
      const progress = [];
      const bytes = new Uint8Array(await (await buildHep(scene, {
        compression, encodeRasterImages, monochromeEncoding: "jbig2", onProgress: event => progress.push(event)
      })).arrayBuffer());
      const archive = await HepArchive.loadAsync(bytes);
      const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
      const table = await readTable(archive);
      assert.equal(manifest.formatVersion, 11);
      assert.deepEqual(table.atlases, []);
      assert.deepEqual(table.layers.map(layer => layer.storage), ["jbig2", "jbig2"]);
      assert.deepEqual(Object.keys(archive.files).filter(name => name.startsWith("raster/")).sort(),
        ["raster/layer-0.jbig2", "raster/layer-1.jbig2", codec.hepJbig2GlobalsFile(0)].sort(),
        "identical global dictionaries from independent PDF sessions share one section");
      const codecs = sectionCodecs(bytes);
      for (const name of Object.keys(archive.files).filter(name => name.startsWith("raster/"))) {
        assert.equal(codecs.get(name), 0, "original JBIG2 data bypasses redundant container recompression");
      }
      assert.deepEqual(await archive.file(codec.hepJbig2GlobalsFile(0)).async("uint8array"), fixture.globals);
      for (const [index, layer] of layers.entries()) {
        const payload = await archive.file(`raster/layer-${index}.jbig2`).async("uint8array");
        const stored = codec.inspectHepJbig2Raster(payload, width, height, decodeBudget);
        assert.deepEqual(stored.encoded, fixture.encoded, "HEP keeps the original compressed page bytes exactly");
        assert.deepEqual(stored.colors, layer.monochrome.colors);
        assert.equal(stored.globalsIndex, 0);
        assert.equal(stored.invert, !!index);
      }
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
        assert.deepEqual(actual.monochrome.jbig2Source.encoded, fixture.encoded);
        assert.deepEqual(actual.monochrome.jbig2Source.globals, fixture.globals);
        assert.equal(actual.monochrome.jbig2Source.invert, !!index);
        if (!index) assert.deepEqual(actual.monochrome.symbols, expected.monochrome.symbols);
        assert.equal(typeof Object.getOwnPropertyDescriptor(actual, "data")?.get, "function");
        for (let y = 0; y < height; y += 1) assert.equal(actual.monochrome.data[y * Math.ceil(width / 8) + 32] & 127, 0,
          "packed decode normalizes sub-byte row padding without touching the next row");
      }
      const reexport = await HepArchive.loadAsync(await (await buildHep(guardRgba(loaded), {
        compression: "store", encodeRasterImages, monochromeEncoding: "jbig2"
      })).arrayBuffer());
      assert.deepEqual((await readTable(reexport)).layers.map(layer => layer.storage), ["jbig2", "jbig2"]);
      if (compression === "store" && encodeRasterImages) { storedBytes = bytes; storedTable = table; }
    }
  }

  // Modified canonical pixels and dimensions must never revive stale encoded content.
  for (const change of [
    layer => { layer.monochrome.data[0] ^= 0x80; },
    layer => { layer.width += 1; },
    layer => {
      // The canonical pixel hash still matches. An encoded text region can
      // nevertheless declare an enormous decoder allocation; fall back to
      // the already decoded pixels without entering a codec or allocating it.
      const encoded = layer.monochrome.jbig2Source.encoded.slice();
      const view = new DataView(encoded.buffer);
      assert.equal(view.getUint32(42), 1);
      assert.equal(view.getUint32(46), 1);
      view.setUint32(42, 1_000_000);
      view.setUint32(46, 1_000_000);
      layer.monochrome.jbig2Source = { ...layer.monochrome.jbig2Source, encoded };
    }
  ]) {
    const changed = mono.copyRasterLayer(layers[0]);
    changed.monochrome = { ...layers[0].monochrome, data: layers[0].monochrome.data.slice() };
    change(changed);
    const bytes = await (await buildHep(rasterScene(createEmptyVectorScene, [changed]), {
      compression: "store", encodeRasterImages: false, monochromeEncoding: "jbig2"
    })).arrayBuffer();
    const archive = await HepArchive.loadAsync(bytes);
    assert.equal(JSON.parse(await archive.file("manifest.json").async("string")).formatVersion, 10);
    assert.equal((await readTable(archive)).layers[0].storage, "mono");
    assert.deepEqual((await loadSceneFromHep(bytes)).rasterLayers[0].monochrome.data, changed.monochrome.data);
  }

  // A larger fast-opening file stays downloadable and reports the tradeoff.
  const fastWarnings = [], consoleWarnings = [], originalWarn = console.warn;
  let fastBlob;
  try {
    console.warn = message => consoleWarnings.push(message);
    fastBlob = await buildHep(scene, { monochromeEncoding: "packed", sourcePdfByteLength: 1,
      compression: "store", onWarning: message => fastWarnings.push(message) });
  } finally { console.warn = originalWarn; }
  assert.equal(fastWarnings.length, 1);
  assert.deepEqual(fastWarnings, consoleWarnings.map(message => message.replace(/^\[HEP\] /, "")));
  assert(fastWarnings[0].includes(String(fastBlob.size)) && fastWarnings[0].includes("1 bytes"));
  const fastBytes = await fastBlob.arrayBuffer();
  const fastArchive = await HepArchive.loadAsync(fastBytes);
  assert.equal(JSON.parse(await fastArchive.file("manifest.json").async("string")).formatVersion, 12);
  assert.deepEqual((await readTable(fastArchive)).layers.map(layer => layer.storage), ["binary", "binary"]);
  const fast = await loadSceneFromHep(fastBytes);
  for (const [index, layer] of layers.entries()) assert.deepEqual(fast.rasterLayers[index].monochrome.data, layer.monochrome.data);
  for (const version of [9, 10, 11]) await assert.rejects(loadSceneFromHep(await editArchive(fastBytes, async archive => {
    const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
    archive.file("manifest.json", JSON.stringify({ ...manifest, formatVersion: version }));
  })), /v12|version 12|binary|format/i);

  const plain = mono.copyRasterLayer(layers[0]);
  plain.monochrome = { data: layers[0].monochrome.data, colors: layers[0].monochrome.colors };
  const color = { width: 20, height: 1, matrix: Float32Array.of(20, 0, 0, 1, 0, 0),
    data: Uint8Array.from({ length: 80 }, (_, index) => index * 17 & 255), paintOrder: 8, pageIndex: 1 };
  const mixedBytes = await (await buildHep(rasterScene(createEmptyVectorScene, [layers[0], plain, color,
    { ...color, data: color.data.slice(), paintOrder: 9 }]), {
    compression: "store", encodeRasterImages: false, monochromeEncoding: "jbig2"
  })).arrayBuffer();
  const mixedArchive = await HepArchive.loadAsync(mixedBytes);
  assert.equal(JSON.parse(await mixedArchive.file("manifest.json").async("string")).formatVersion, 11);
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
  assert.throws(() => codec.encodeHepJbig2Raster(source, palette, 0, width, height, controller.signal),
    error => error === reason);
  await assert.rejects(codec.decodeHepJbig2Raster(section, fixture.globals, width, height, decodeBudget, controller.signal),
    error => error === reason);
  await assert.rejects(buildHep(scene, { signal: controller.signal }), error => error === reason);
  await assert.rejects(loadSceneFromHep(storedBytes, { signal: controller.signal }), error => error === reason);
  console.log("HEP original JBIG2 passed: exact stream passthrough, bounded packed decode, inverse polarity, globals, metadata, symbols, worker ownership, stale-source fallback and version gates.");
} finally {
  hooks.deregister();
}
