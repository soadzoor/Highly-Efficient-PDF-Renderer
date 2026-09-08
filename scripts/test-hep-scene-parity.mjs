import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import { HepArchive } from "../src/hepContainer.ts";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
        !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep, prepareSceneForHepRendering } = await import("../src/hep.ts");
  const { buildVectorStrokeLodScenes, VectorStrokeLodRuntime } = await import("../src/vectorStrokeLodCore.ts");

  // A floorplan-sized extent with closely spaced hatch lines. Tiny coordinate
  // shifts change LOD merge buckets even when the movement is subpixel.
  const segmentCount = 802;
  const scene = {
    ...composeVectorScenesInGrid([], 1),
    pageCount: 1,
    segmentCount,
    sourceSegmentCount: segmentCount,
    mergedSegmentCount: segmentCount,
    endpoints: new Float32Array(segmentCount * 4),
    primitiveMeta: new Float32Array(segmentCount * 4),
    primitiveBounds: new Float32Array(segmentCount * 4),
    styles: new Float32Array(segmentCount * 4),
    bounds: { minX: 0, minY: 0, maxX: 3024, maxY: 2160 },
    pageBounds: { minX: 0, minY: 0, maxX: 3024, maxY: 2160 },
    pageRects: new Float32Array([0, 0, 3024, 2160]),
    maxHalfWidth: 0.125
  };
  for (let index = 0; index < segmentCount; index += 1) {
    const offset = index * 4;
    const x = index < 800 ? 300.123 + Math.floor(index / 2) * 1.13 : 0;
    const y = index < 800 ? 100.249 + (index % 2) * 0.002 : 2160;
    const endX = index < 800 ? x + 1.125 : 3024;
    scene.endpoints.set([x, y, endX, y], offset);
    scene.primitiveMeta.set([endX, y, 0, 0.731], offset);
    scene.primitiveBounds.set([x, y, endX, y], offset);
    scene.styles.set([0.125, 0.2, 0.3, 0.4], offset);
  }

  // Preserve quadratic controls, clip bounds, hairline/round-cap flags, and
  // fractional opacity too. The last primitive is intentionally clipped.
  scene.endpoints.set([10.123, 20.456, 25.789, 60.123], 800 * 4);
  scene.primitiveMeta.set([30.456, 40.789, 1, 6.731], 800 * 4);
  scene.primitiveBounds.set([10.123, 20.456, 30.456, 60.123], 800 * 4);
  scene.primitiveMeta[801 * 4 + 3] = 8.731;
  scene.primitiveBounds.set([11.123, 2159, 29.456, 2160], 801 * 4);

  // Include fill and text rounding, plus two glyphs which become identical
  // after quantization and therefore deduplicate on HEP load.
  scene.fillSegmentCount = 2;
  scene.fillSegmentsA = new Float32Array([10.123, 20.456, 30.789, 40.123, 0, 0, 3024, 2160]);
  scene.fillSegmentsB = new Float32Array([30.789, 40.123, 0, 1, 3024, 2160, 0, 1]);
  scene.textInstanceCount = 2;
  scene.pageTextRanges = new Uint32Array([0, 2]);
  scene.textInstanceA = new Float32Array([1, 0, 0, 1, 1, 0, 0, 1]);
  scene.textInstanceB = new Float32Array([11.123, 22.456, 0, 0, 33.789, 44.123, 1, 0]);
  scene.textInstanceC = new Float32Array([0.123, 0.456, 0.789, 0.731, 0.123, 0.456, 0.789, 0.731]);
  scene.textGlyphCount = 2;
  scene.textGlyphSegmentCount = 4;
  scene.textGlyphMetaA = new Float32Array([0, 2, 0, 0, 2, 2, 0, 0]);
  scene.textGlyphMetaB = new Float32Array([10, 10, 0, 0, 10, 10, 0, 0]);
  scene.textGlyphSegmentsA = new Float32Array([0, 0, 5.123, 5, 10, 10, 0, 0, 0, 0, 5.123001, 5, 10, 10, 0, 0]);
  scene.textGlyphSegmentsB = new Float32Array([5.123, 5, 0, 0, 0, 0, 0, 0, 5.123001, 5, 0, 0, 0, 0, 0, 0]);
  scene.textIndex = { version: 2, pages: [{
    text: "abc", charInstance: new Int32Array([0, 1, -2]),
    fallbackQuads: new Float32Array([55.123, 66.456, 77.789, 88.123])
  }] };

  const snapshot = structuredClone(scene);
  const prepared = prepareSceneForHepRendering(scene);
  assert.deepEqual(scene, snapshot, "preparation must leave cached parser page buffers untouched");
  assert.equal(prepareSceneForHepRendering(prepared), prepared, "preparation must be idempotent");
  assert.notDeepEqual(prepared.endpoints, scene.endpoints, "PDF strokes must adopt HEP precision");
  assert.equal(prepared.textGlyphCount, 1, "PDF preparation must match post-quantization glyph deduplication");

  const strokeFields = ["endpoints", "primitiveMeta", "primitiveBounds", "styles"];
  const visualFields = [...strokeFields, "fillSegmentsA", "fillSegmentsB", "textInstanceA",
    "textInstanceB", "textInstanceC", "textGlyphMetaA", "textGlyphMetaB",
    "textGlyphSegmentsA", "textGlyphSegmentsB", "pageRects", "pageTextRanges"];
  function assertBuffersEqual(actual, expected, fields, context) {
    for (const field of fields) {
      const a = actual[field];
      const b = expected[field];
      assert.ok(Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(
        Buffer.from(b.buffer, b.byteOffset, b.byteLength)
      ), `${context}: ${field} must match bit-exactly`);
    }
  }
  function assertLodEqual(actual, expected) {
    const expectedLevels = buildVectorStrokeLodScenes(expected);
    const actualLevels = buildVectorStrokeLodScenes(actual);
    assert.ok(expectedLevels.length > 1, "fixture must exercise stroke simplification");
    assert.deepEqual(actualLevels.map(l => [l.tolerance, l.scene.segmentCount]),
      expectedLevels.map(l => [l.tolerance, l.scene.segmentCount]));
    for (let index = 0; index < expectedLevels.length; index += 1) {
      assertBuffersEqual(actualLevels[index].scene, expectedLevels[index].scene,
        strokeFields, `LOD ${expectedLevels[index].tolerance}`);
    }
    const a = new VectorStrokeLodRuntime(actual);
    const b = new VectorStrokeLodRuntime(expected);
    for (const zoom of [0.38, 2, 0.38]) {
      const view = { cameraCenterX: 1512, cameraCenterY: 1080, zoom };
      a.update(view, { width: 1400, height: 1000 });
      b.update(view, { width: 1400, height: 1000 });
      assert.deepEqual(a.getStats(), b.getStats(), `tile selection must match at zoom ${zoom}`);
    }
  }

  const options = { sourceLabel: "fixture.pdf", compression: "store" };
  const blob = await buildHep(scene, options);
  const rawZip = await HepArchive.loadAsync(await blob.arrayBuffer());
  const rawManifest = JSON.parse(await rawZip.file("manifest.json").async("string"));
  assert.equal(rawManifest.formatVersion, 6);
  assert.equal(rawManifest.strokeGeometry.endpointsFile, "geometry/stroke-endpoints.csq16");
  assert.equal(rawManifest.strokeGeometry.encoding, undefined, "keep the existing compact format");
  assert.equal(rawManifest.strokeGeometry.boundsFile, undefined, "do not add full float32 bounds");
  const loaded = await loadSceneFromHep(await blob.arrayBuffer());
  assertBuffersEqual(prepared, loaded, visualFields, "PDF vs original HEP");
  assert.deepEqual(prepared.textIndex, loaded.textIndex);
  assertLodEqual(prepared, loaded);

  for (const compression of ["store", "deflate"]) {
    let exportedScene = prepared;
    for (let round = 0; round < 2; round += 1) {
      const exported = await buildHep(exportedScene, { ...options, compression });
      if (compression === "store") assert.ok(exported.size <= blob.size, "HEPs must not grow");
      const zip = await HepArchive.loadAsync(await exported.arrayBuffer());
      const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
      assert.deepEqual(manifest.strokeGeometry, rawManifest.strokeGeometry);
      for (const path of [manifest.strokeGeometry.endpointsFile, manifest.strokeGeometry.metaFile,
        manifest.strokeGeometry.clipBoundsFile]) {
        assert.deepEqual(await zip.file(path).async("uint8array"),
          await rawZip.file(path).async("uint8array"), "reuse the original compact stroke encoding");
      }
      exportedScene = await loadSceneFromHep(await exported.arrayBuffer());
      assertBuffersEqual(exportedScene, prepared, visualFields, `round ${round}, ${compression}`);
      assert.deepEqual(exportedScene.textIndex, prepared.textIndex);
    }
  }

  // Quantize the composed document, not its cached pages: changing the grid
  // changes coordinate ranges. Repeated rearrangements must start from raw pages.
  for (const columns of [1, 2, 1]) {
    const composed = composeVectorScenesInGrid([scene, scene], columns);
    const expected = await loadSceneFromHep(await (await buildHep(composed, options)).arrayBuffer());
    const actual = prepareSceneForHepRendering(composed);
    assertBuffersEqual(actual, expected, visualFields, `page columns ${columns}`);
  }
  assert.deepEqual(scene, snapshot, "rearranging pages must not accumulate rounding");

  async function mutateArchive(mutate) {
    const zip = await HepArchive.loadAsync(await blob.arrayBuffer());
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    await mutate(zip, manifest);
    zip.file("manifest.json", JSON.stringify(manifest));
    return zip.generateAsync({ type: "arraybuffer", compression: "STORE" });
  }

  for (const [mutate, expectedError] of [
    [(_zip, manifest) => { delete manifest.strokeGeometry.clippedSegmentCount; }, /invalid strokeGeometry/],
    [(zip, manifest) => { zip.remove(manifest.strokeGeometry.endpointsFile); }, /missing v5 stroke geometry/],
    [(zip, manifest) => { zip.file(manifest.strokeGeometry.metaFile, new Uint8Array(4)); }, /truncated/],
    [(zip, manifest) => { zip.remove(manifest.strokeGeometry.clipBoundsFile); }, /missing clipped stroke bounds/]
  ]) {
    await assert.rejects(loadSceneFromHep(await mutateArchive(mutate)), expectedError);
  }

  // Hand-authored legacy v6 payload: one clipped quadratic, with integer
  // coordinates on a [0, 65535] grid and chained zigzag-varint columns.
  const legacyBytes = await mutateArchive((zip, manifest) => {
    manifest.strokeGeometry = {
      endpointsFile: "geometry/legacy.csq16",
      metaFile: "geometry/legacy.bin",
      clipBoundsFile: "geometry/legacy-clip.f32",
      clippedSegmentCount: 1,
      segmentCount: 1,
      curveCount: 1,
      quantizationMin: [0, 0, 0, 0],
      quantizationMax: [65535, 65535, 65535, 65535],
      ctrlQuantizationMin: [0, 0],
      ctrlQuantizationMax: [65535, 65535],
      endpointColumnByteLengths: [1, 1, 1, 1]
    };
    manifest.scene.segmentCount = 1;
    zip.file("geometry/legacy.csq16", new Uint8Array([20, 40, 40, 40]));
    zip.file("geometry/legacy.bin", new Uint8Array([1, 255, 79, 10, 60]));
    zip.file("geometry/legacy-clip.f32", new Float32Array([11, 22, 29, 50]).buffer);
  });
  const legacy = await loadSceneFromHep(legacyBytes);
  assert.deepEqual([...legacy.endpoints], [10, 20, 25, 60]);
  assert.deepEqual([...legacy.primitiveMeta], [30, 40, 1, 9]);
  assert.deepEqual([...legacy.primitiveBounds], [11, 22, 29, 50]);
  const legacyReexport = await loadSceneFromHep(
    await (await buildHep(legacy, options)).arrayBuffer()
  );
  assertBuffersEqual(legacyReexport, legacy, strokeFields, "legacy paths after re-export");
  const invalidLegacy = await HepArchive.loadAsync(legacyBytes);
  const invalidLegacyManifest = JSON.parse(await invalidLegacy.file("manifest.json").async("string"));
  delete invalidLegacyManifest.strokeGeometry.clippedSegmentCount;
  invalidLegacy.file("manifest.json", JSON.stringify(invalidLegacyManifest));
  await assert.rejects(loadSceneFromHep(await invalidLegacy.generateAsync({
    type: "arraybuffer", compression: "STORE"
  })), /invalid strokeGeometry/);

  const emptyBlob = await buildHep(composeVectorScenesInGrid([], 1), { compression: "store" });
  assert.equal((await loadSceneFromHep(await emptyBlob.arrayBuffer())).segmentCount, 0);
  console.log("PDF/HEP scene parity regression tests passed.");
} finally {
  hooks.deregister();
}
