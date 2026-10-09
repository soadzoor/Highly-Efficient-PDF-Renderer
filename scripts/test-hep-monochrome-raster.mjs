// Synthetic packed scans only: no PDF conversion, browser, or server.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { HepArchive, HepArchiveEntry, crc32 } from "./lib/hepContainer.mjs";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });

function packedLayer(width, height, data, colors, overrides = {}) {
  const layer = {
    width, height, monochrome: { data, colors },
    matrix: Float32Array.of(width, 0, 0, -height, 2, 3),
    paintOrder: 0, pageIndex: 0, ...overrides
  };
  Object.defineProperty(layer, "data", {
    enumerable: true,
    get() { throw new Error("HEP export must not expand packed scans into RGBA"); }
  });
  return layer;
}

function rasterScene(emptyScene, layers) {
  const primary = layers[0];
  const scene = {
    ...emptyScene(), pageCount: 2, pagesPerRow: 2,
    pageRects: Float32Array.of(0, 0, 100, 100, 101, 0, 201, 100),
    pageTextRanges: Uint32Array.of(0, 0, 0, 0),
    bounds: { minX: 0, minY: 0, maxX: 201, maxY: 100 },
    pageBounds: { minX: 0, minY: 0, maxX: 201, maxY: 100 },
    imagePaintOpCount: layers.length, rasterLayers: layers,
    rasterLayerWidth: primary.width, rasterLayerHeight: primary.height,
    rasterLayerMatrix: primary.matrix,
    drawRuns: [{ kind: "raster", first: 0, count: layers.length }]
  };
  Object.defineProperty(scene, "rasterLayerData", {
    enumerable: true,
    get() { throw new Error("HEP must not read the primary scan's RGBA alias"); }
  });
  return scene;
}

function expectedRgba(layer) {
  const output = new Uint8Array(layer.width * layer.height * 4);
  const stride = Math.ceil(layer.width / 8);
  for (let y = 0; y < layer.height; y += 1) {
    for (let x = 0; x < layer.width; x += 1) {
      const bit = (layer.monochrome.data[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1;
      output.set(layer.monochrome.colors.subarray(bit * 4, bit * 4 + 4), (y * layer.width + x) * 4);
    }
  }
  return output;
}

async function editArchive(bytes, edit) {
  const archive = await HepArchive.loadAsync(bytes);
  await edit(archive);
  return archive.generateAsync({ type: "uint8array", compression: "STORE" });
}

// Malformed declared sizes must be rejected before inflating/allocating pixels.
function patchEntrySize(buffer, path, size) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer);
  const entryCount = view.getUint32(8, true);
  const chunkCount = view.getUint32(12, true);
  const indexLength = view.getUint32(16, true);
  let offset = 32 + chunkCount * 20;
  let found = false;
  for (let index = 0; index < entryCount; index += 1) {
    const nameLength = view.getUint16(offset, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 16, offset + 16 + nameLength));
    if (name === path) {
      const chunk = 32 + view.getUint32(offset + 4, true) * 20;
      view.setUint32(chunk + 8, size, true);
      view.setUint8(chunk + 16, 1);
      view.setUint32(offset + 12, size, true);
      found = true;
    }
    offset = Math.ceil((offset + 16 + nameLength) / 4) * 4;
  }
  assert(found, `expected section ${path}`);
  view.setUint32(20, crc32(bytes.subarray(32, 32 + indexLength)), true);
  return bytes;
}

async function assertRasterMetadataPreflight(seedBytes, loadScene, sections, codec) {
  const seed = await HepArchive.loadAsync(seedBytes);
  const seedManifest = JSON.parse(await seed.file("manifest.json").async("string"));
  const originalLoader = HepArchive.loadAsync;
  const firstPackedRead = new Error("packed preflight accepted");
  let rasterReads = 0;

  async function tryMetadata({ count = 614, width = 2480, height = 3506, storage = "mono", extraBytes = 0 }, expected) {
    const archive = new HepArchive();
    Object.assign(archive.files, seed.files);
    for (const name of Object.keys(archive.files)) if (name.startsWith("raster/")) archive.remove(name);
    const layers = Array.from({ length: count }, (_, index) => ({
      width, height, storage, matrix: Float32Array.of(1, 0, 0, 1, 0, 0),
      paintOrder: index, pageIndex: 0
    }));
    archive.file(sections.SCENE_RASTER_LAYERS_PATH, sections.encodeRasterLayerTable({ atlases: [], layers }));
    archive.file("manifest.json", JSON.stringify({
      ...seedManifest, formatVersion: 10,
      scene: { ...seedManifest.scene, rasterLayers: {
        file: sections.SCENE_RASTER_LAYERS_PATH, count, atlasCount: 0
      } }
    }));
    const length = storage === "mono" ? codec.hepMonochromeRasterByteLength(width, height) : width * height * 4;
    for (let index = 0; index < count; index += 1) {
      const path = sections.rasterLayerFile(index, storage);
      archive.files[path] = new HepArchiveEntry(path, length + extraBytes, async () => {
        rasterReads += 1;
        throw firstPackedRead;
      });
    }
    rasterReads = 0;
    HepArchive.loadAsync = async () => archive;
    await assert.rejects(loadScene(seedBytes), expected);
  }

  try {
    // TIKA's 614 scan dimensions exceed the old aggregate RGBA texel limit.
    // Real archive entries exercise reader preflight without inflating the
    // hundreds of MiB of packed scan data or allocating any raster pixels.
    await tryMetadata({}, error => error === firstPackedRead);
    assert.equal(rasterReads, 1, "complete packed-scene metadata is admitted before reading its first pixels");
    for (const large of [
      { storage: "rgba", count: 40 },
      { count: 1100 },
      { count: 4097, width: 1, height: 1 },
      { count: 1, width: 16384, height: 8193 },
      { count: 1, width: 16385, height: 1 }
    ]) {
      await tryMetadata(large, error => error === firstPackedRead);
      assert.equal(rasterReads, 1, "metadata beyond the old byte, section, texel, and dimension caps reaches pixel decoding");
    }
    for (const invalid of [
      { extraBytes: 1 },
      { storage: "rgba", count: 1, width: 0x7fffffff, height: 0x7fffffff }
    ]) {
      await tryMetadata(invalid, /budget|limit|length|size|out of range/i);
      assert.equal(rasterReads, 0, "invalid raster metadata is rejected before inflating pixels");
    }
  } finally {
    HepArchive.loadAsync = originalLoader;
  }
}

try {
  const [{ buildHep }, { loadSceneFromHep }, { createEmptyVectorScene }, sections, codec, structure] = await Promise.all([
    import("../src/hepBuilder.ts"),
    import("../src/hep.ts"),
    import("../src/emptyVectorScene.ts"),
    import("../src/hepRasterLayers.ts"),
    import("../src/hepMonochromeRaster.ts"),
    import("../src/hepStructure.ts")
  ]);
  const limits = { maxLayers: 100, maxAtlases: 4, maxDimension: 16_384 };
  const readTable = async archive => sections.decodeRasterLayerTable(
    await archive.file(sections.SCENE_RASTER_LAYERS_PATH).async("uint8array"), limits
  );

  const colors = Uint8Array.of(7, 11, 13, 0, 241, 223, 197, 127);
  const layers = [
    // Width 13 leaves three padding bits in every row; preserve their values.
    packedLayer(13, 3, Uint8Array.of(0xa5, 0xaf, 0x01, 0x57, 0xff, 0xf9), colors, {
      matrix: Float32Array.of(13.5, -1.25, 2.5, -3.75, 42.25, -1.75),
      paintOrder: 7, pageIndex: 1, opacity: 0.375
    }),
    packedLayer(9, 2, Uint8Array.of(0x80, 0x7f, 0x55, 0xff),
      Uint8Array.of(255, 255, 255, 255, 0, 0, 0, 255), {
        paintOrder: 4, pageIndex: 0, opacity: 0
      })
  ];
  // Symbol dictionaries are an optional rendering optimization. The canonical
  // packed pixels alone are sufficient to reconstruct every visible pixel.
  layers[0].monochrome.symbols = {
    symbols: [{ width: 4, height: 2, data: Uint8Array.of(0xf0, 0x90) }],
    placements: Int32Array.of(0, 1, 0, 0)
  };
  const scene = rasterScene(createEmptyVectorScene, layers);
  scene.markedContent = {
    items: [{ pageIndex: 1, sourcePageIndex: 1, mcid: 3, tag: "Figure", elementId: "scan-1" }],
    ranges: { raster: Uint32Array.of(0, 1, 0) }
  };
  scene.structureElements = [{ id: "scan-1", type: "Figure", alt: "Scanned page" }];
  const structureArchive = new HepArchive();
  const structureDescriptor = structure.writeHepStructure(structureArchive, scene);
  const structureTarget = rasterScene(createEmptyVectorScene, layers);
  await structure.readHepStructure(structureArchive, structureDescriptor, structureTarget);
  assert.deepEqual(structureTarget.markedContent, scene.markedContent,
    "loading tagged scan metadata must preserve lazy RGBA getters");
  assert.deepEqual(structureTarget.structureElements, scene.structureElements);

  // The codec also supports exact byte-aligned and sub-byte rows, borrowed
  // input views, and both palette alpha values without RGBA intermediates.
  for (const width of [1, 7, 8, 9, 13, 31]) {
    const height = 3;
    const length = Math.ceil(width / 8) * height;
    const backing = Uint8Array.from({ length: length + 4 }, (_, index) => index * 37 & 255);
    const data = backing.subarray(2, length + 2);
    const original = backing.slice();
    const encoded = codec.encodeHepMonochromeRaster({ data, colors }, width, height);
    assert.equal(encoded.length, codec.hepMonochromeRasterByteLength(width, height));
    assert.deepEqual(encoded, Uint8Array.from([...colors, ...data]));
    const decoded = codec.decodeHepMonochromeRaster(encoded, width, height);
    assert.deepEqual(decoded.data, data);
    assert.deepEqual(decoded.colors, colors);
    assert.equal(decoded.data.buffer, encoded.buffer, "decode keeps packed pixels in the section buffer");
    assert.equal(decoded.colors.buffer, encoded.buffer, "decode keeps the palette in the section buffer");
    const sectionBacking = new Uint8Array(encoded.length + 8);
    sectionBacking.set(encoded, 4);
    const borrowedSection = sectionBacking.subarray(4, 4 + encoded.length);
    const borrowedDecoded = codec.decodeHepMonochromeRaster(borrowedSection, width, height);
    assert.deepEqual(borrowedDecoded.data, data);
    assert.deepEqual(borrowedDecoded.colors, colors);
    assert.equal(borrowedDecoded.data.byteOffset, borrowedSection.byteOffset + 8);
    assert.deepEqual(backing, original, "encoding does not alter borrowed source bytes");
    assert.throws(() => codec.decodeHepMonochromeRaster(encoded.subarray(0, encoded.length - 1), width, height), /length|size/i);
    assert.throws(() => codec.decodeHepMonochromeRaster(new Uint8Array(encoded.length + 1), width, height), /length|size/i);
  }
  for (const [width, height] of [[0, 1], [1, 0], [-1, 1], [1.5, 2], [NaN, 1], [1, Infinity]]) {
    assert.throws(() => codec.hepMonochromeRasterByteLength(width, height), /dimension|width|height|integer/i);
  }
  assert.throws(() => codec.encodeHepMonochromeRaster({ data: Uint8Array.of(0), colors: colors.subarray(0, 7) }, 1, 1), /palette|color|length|size/i);
  assert.throws(() => codec.encodeHepMonochromeRaster({ data: Uint8Array.of(0), colors }, 9, 1), /length|size/i);
  const preAborted = new AbortController();
  const abortReason = new Error("cancel packed export");
  preAborted.abort(abortReason);
  assert.throws(() => codec.encodeHepMonochromeRaster(layers[0].monochrome, 13, 3, preAborted.signal), error => error === abortReason);
  await assert.rejects(buildHep(scene, { signal: preAborted.signal }), error => error === abortReason);

  let storedBytes;
  let storedTable;
  for (const compression of ["store", "deflate"]) {
    for (const encodeRasterImages of [true, false]) {
      const progress = [];
      const blob = await buildHep(scene, {
        compression, encodeRasterImages,
        onProgress: event => progress.push(event)
      });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const archive = await HepArchive.loadAsync(bytes);
      const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
      const table = await readTable(archive);
      assert.equal(manifest.formatVersion, 10);
      assert.deepEqual(table.atlases, [], "packed scans keep their own bit sections");
      assert.deepEqual(table.layers.map(layer => layer.storage), ["mono", "mono"]);
      assert.deepEqual(Object.keys(archive.files).filter(name => name.startsWith("raster/")).sort(),
        ["raster/layer-0.mono", "raster/layer-1.mono"]);
      for (const [index, layer] of layers.entries()) {
        const payload = await archive.file(sections.rasterLayerFile(index, "mono")).async("uint8array");
        assert.deepEqual(payload, Uint8Array.from([...layer.monochrome.colors, ...layer.monochrome.data]));
      }
      assert(progress.every(event => Number.isFinite(event.value) && event.value >= 0 && event.value <= 1),
        "packed export progress stays finite and normalized");
      assert(progress.every((event, index) => !index || event.value >= progress[index - 1].value));
      const rasterProgress = progress.filter(event => event.stage === "raster-encode");
      if (encodeRasterImages) {
        const totalTexels = layers.reduce((total, layer) => total + layer.width * layer.height, 0);
        assert(rasterProgress.length > 0, "packed copying reports preparation progress");
        assert(rasterProgress.every(event => event.total === totalTexels && event.processed <= totalTexels));
        assert.equal(rasterProgress.at(-1).processed, totalTexels);
      } else {
        assert.equal(rasterProgress.length, 0);
      }
      assert(progress.some(event => event.stage === "hep-build"));
      assert.equal(progress.at(-1).stage, "complete");
      assert.equal(progress.at(-1).value, 1);

      const loaded = await loadSceneFromHep(bytes);
      assert.equal(loaded.rasterLayers.length, layers.length);
      assert.deepEqual(loaded.markedContent, scene.markedContent);
      assert.deepEqual(loaded.structureElements, scene.structureElements);
      assert.equal(typeof Object.getOwnPropertyDescriptor(loaded, "rasterLayerData")?.get, "function",
        "the primary scan's RGBA alias stays lazy after loading");
      for (const [index, source] of layers.entries()) {
        const actual = loaded.rasterLayers[index];
        assert.equal(actual.width, source.width);
        assert.equal(actual.height, source.height);
        assert.equal(actual.paintOrder, source.paintOrder);
        assert.equal(actual.pageIndex, source.pageIndex);
        assert.equal(actual.opacity, source.opacity);
        assert.deepEqual(actual.matrix, source.matrix);
        assert.deepEqual(actual.monochrome.data, source.monochrome.data);
        assert.deepEqual(actual.monochrome.colors, source.monochrome.colors);
        assert.equal(typeof Object.getOwnPropertyDescriptor(actual, "data")?.get, "function", "RGBA is available on demand");
        assert.deepEqual(actual.data, expectedRgba(source), "RGBA compatibility expands only real pixels, ignoring row padding");
        assert.equal(actual.data, actual.data, "compatibility expansion is cached");
      }
      assert.equal(loaded.rasterLayerData, loaded.rasterLayers[0].data);
      if (compression === "store" && encodeRasterImages) { storedBytes = bytes; storedTable = table; }

      // Re-export restored layers through descriptors that would fail if any
      // export path unexpectedly materialized the compatibility RGBA values.
      const fresh = await loadSceneFromHep(bytes);
      for (const layer of fresh.rasterLayers) Object.defineProperty(layer, "data", {
        configurable: true, get() { throw new Error("re-export expanded scan RGBA"); }
      });
      Object.defineProperty(fresh, "rasterLayerData", {
        configurable: true, get() { throw new Error("re-export expanded primary RGBA"); }
      });
      await buildHep(fresh, { compression: "store", encodeRasterImages });
    }
  }

  // Color images retain the v9 representation and remain readable when the
  // manifest is explicitly labelled with the older, supported scene version.
  const color = {
    width: 3, height: 2, data: Uint8Array.from({ length: 24 }, (_, index) => index * 11 & 255),
    matrix: Float32Array.of(3, 0, 0, 2, 0, 0), paintOrder: 2, pageIndex: 0
  };
  const colorBytes = new Uint8Array(await (await buildHep(rasterScene(createEmptyVectorScene, [color]), {
    compression: "store", encodeRasterImages: false
  })).arrayBuffer());
  const colorArchive = await HepArchive.loadAsync(colorBytes);
  assert.equal(JSON.parse(await colorArchive.file("manifest.json").async("string")).formatVersion, 9);
  assert.equal((await readTable(colorArchive)).layers[0].storage, "rgba");
  assert.deepEqual((await loadSceneFromHep(colorBytes)).rasterLayers[0].data, color.data);
  const mixed = await loadSceneFromHep(await (await buildHep(rasterScene(createEmptyVectorScene, [layers[0], color]), {
    compression: "store", encodeRasterImages: false
  })).arrayBuffer());
  assert.deepEqual(mixed.rasterLayers[0].monochrome.data, layers[0].monochrome.data);
  assert.deepEqual(mixed.rasterLayers[1].data, color.data);

  // Interleave packed scans with deduplicated RGBA atlas cells and standalone
  // images. Table indices and paint order must refer to the original layers.
  const atlasColor = { ...color, width: 20, height: 1,
    data: Uint8Array.from({ length: 80 }, (_, index) => index * 17 & 255) };
  const otherAtlasColor = { ...color, width: 17, height: 2,
    data: Uint8Array.from({ length: 136 }, (_, index) => index * 23 & 255) };
  const largeColor = { ...color, width: 128, height: 129,
    data: Uint8Array.from({ length: 128 * 129 * 4 }, (_, index) => index * 19 & 255) };
  const interleaved = [layers[0], atlasColor, layers[1], { ...atlasColor, data: atlasColor.data.slice() },
    otherAtlasColor, largeColor, { ...largeColor, data: largeColor.data.slice() }];
  const interleavedBytes = new Uint8Array(await (await buildHep(rasterScene(createEmptyVectorScene, interleaved), {
    compression: "store", encodeRasterImages: false
  })).arrayBuffer());
  const interleavedArchive = await HepArchive.loadAsync(interleavedBytes);
  const interleavedTable = await readTable(interleavedArchive);
  assert.deepEqual(interleavedTable.layers.map(layer => layer.storage), ["mono", "atlas", "mono", "atlas", "atlas", "rgba", "rgba"]);
  assert.deepEqual(interleavedTable.layers[1].cell, interleavedTable.layers[3].cell);
  assert.deepEqual(Object.keys(interleavedArchive.files).filter(name => name.startsWith("raster/")).sort(),
    ["raster/layer-0.mono", "raster/layer-2.mono", "raster/atlas-0.rgba", "raster/layer-5.rgba", "raster/layer-6.rgba"].sort());
  const loadedInterleaved = await loadSceneFromHep(interleavedBytes);
  for (const [index, source] of interleaved.entries()) {
    const actual = loadedInterleaved.rasterLayers[index];
    assert.equal(actual.width, source.width);
    assert.equal(actual.height, source.height);
    assert.deepEqual(actual.matrix, source.matrix);
    assert.equal(actual.paintOrder, source.paintOrder);
    assert.equal(actual.pageIndex, source.pageIndex);
    if (source.monochrome) assert.deepEqual(actual.monochrome.data, source.monochrome.data);
    else assert.deepEqual(actual.data, source.data);
  }

  const cancellation = new AbortController();
  const lateReason = new Error("cancel while storing packed scans");
  await assert.rejects(buildHep(scene, {
    compression: "store", signal: cancellation.signal,
    onProgress: event => { if (event.stage === "hep-build") cancellation.abort(lateReason); }
  }), error => error === lateReason);
  const copyingCancellation = new AbortController();
  const copyingReason = new Error("cancel after copying the first packed scan");
  await assert.rejects(buildHep(scene, {
    compression: "store", signal: copyingCancellation.signal,
    onProgress: event => {
      if (event.stage === "raster-encode" && event.processed > 0) copyingCancellation.abort(copyingReason);
    }
  }), error => error === copyingReason);

  const standaloneTable = sections.encodeRasterLayerTable({ atlases: [], layers: [storedTable.layers[0]] });
  assert.equal(standaloneTable[2], 8 | 4, "mono uses a new storage flag and preserves the old opacity flag");
  for (const flag of [8 | 1, 8 | 2, 8 | 3, 8 | 16, 8 | 32, 64, 128]) {
    const invalid = standaloneTable.slice();
    invalid[2] = flag;
    assert.throws(() => sections.decodeRasterLayerTable(invalid, limits), /flag|storage|monochrome/i);
  }
  for (const delta of [-1, 1]) {
    const corrupt = await editArchive(storedBytes, async archive => {
      const payload = await archive.file("raster/layer-0.mono").async("uint8array");
      const changed = new Uint8Array(payload.length + delta);
      changed.set(payload.subarray(0, changed.length));
      archive.file("raster/layer-0.mono", changed);
    });
    await assert.rejects(loadSceneFromHep(corrupt), /monochrome|packed|length|size/i);
  }
  await assert.rejects(loadSceneFromHep(await editArchive(storedBytes, archive => {
    archive.remove("raster/layer-0.mono");
  })), /missing.*raster/i);
  await assert.rejects(loadSceneFromHep(await editArchive(storedBytes, archive => {
    archive.file(sections.SCENE_RASTER_LAYERS_PATH, sections.encodeRasterLayerTable({
      ...storedTable, layers: [{ ...storedTable.layers[0], width: 17 }, storedTable.layers[1]]
    }));
  })), /monochrome|packed|length|size/i);
  await assert.rejects(loadSceneFromHep(await editArchive(storedBytes, async archive => {
    const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
    archive.file("manifest.json", JSON.stringify({ ...manifest, formatVersion: 9 }));
  })), /v10|version 10|monochrome|format.*9/i);
  await assert.rejects(loadSceneFromHep(patchEntrySize(storedBytes, "raster/layer-0.mono", 768 * 1024 * 1024 + 1)),
    /limit|budget|size|length/i);

  await assertRasterMetadataPreflight(storedBytes, loadSceneFromHep, sections, codec);

  console.log("HEP packed monochrome export passed: exact pixels, lazy RGBA, v9 compatibility, progress, cancellation, and malformed sections.");
} finally {
  hooks.deregister();
}
