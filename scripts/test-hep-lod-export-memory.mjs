// Synthetic scenes only: no PDF conversion, browser, server, or corpus work.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const vector = await import("../src/vectorStrokeLodCore.ts");
  const { prepareVectorLodForStorage, packVectorLod } = await import("../src/hepLodEncoding.ts");
  const { HepArchive } = await import("../src/hepContainer.ts");
  const { writeHepLod, readHepLod } = await import("../src/hepLod.ts");
  const fields = ["endpoints", "primitiveMeta", "primitiveBounds", "styles"];
  const makeScene = (count, spanning = false) => {
    const scene = { ...createEmptyVectorScene(), segmentCount: count, maxHalfWidth: .1,
      bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
      drawRuns: [{ kind: "stroke", first: 0, count }] };
    for (const field of fields) scene[field] = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const x = spanning ? 0 : i % 100, y = spanning ? 0 : Math.floor(i / 100) * .01;
      const x1 = spanning ? 1000 : x + 10, y1 = spanning ? 1000 : y;
      scene.endpoints.set([x, y, x1, y1], i * 4);
      scene.primitiveMeta.set([x1, y1, 0, 1], i * 4);
      scene.primitiveBounds.set([x, y, x1, y1], i * 4);
      scene.styles.set([.1, 0, 0, 0], i * 4);
    }
    return scene;
  };

  for (const scene of [makeScene(2048, true), makeScene(50_100)]) {
    const original = fields.map(field => scene[field].slice());
    const progress = [];
    const geometry = await vector.buildVectorStrokeLodForStorage(scene, {
      onProgress: event => progress.push(event)
    });
    assert.equal(vector.getStoredVectorStrokeLod(scene), null,
      "export preparation must not install a hierarchy without spatial indexes");
    assert.equal(vector.takePrebuiltVectorStrokeLodRuntime(scene), null,
      "export preparation must not retain a viewer runtime");
    assert(geometry.levels.every(level => [level.tileOffsets, level.tileCounts, level.tileSegmentIds]
      .every(values => values.byteLength === 0)), "export does not build discarded tile references");
    assert(progress.every((event, i) => i === 0 || event.value >= progress[i - 1].value));
    assert.equal(progress.at(-1).value, 1);
    assert(!progress.some(event => /bounds|buckets|tiles/i.test(event.message)),
      "export skips viewer bounds and tile-index construction");

    const runtime = new vector.VectorStrokeLodRuntime(scene);
    const expected = vector.getStoredVectorStrokeLod(scene);
    assert(expected);
    for (const compact of [false, true]) {
      assert.deepEqual(packVectorLod(scene, prepareVectorLodForStorage(geometry, compact)),
        packVectorLod(scene, prepareVectorLodForStorage(expected, compact)),
        "storage-only preparation preserves all geometry, tolerances, bounds, paint origins and packed data");
    }
    if (scene.segmentCount === 2048) {
      const tiles = runtime.tileGrid.columns * runtime.tileGrid.rows;
      assert.equal(runtime.levels[0].tileSegmentIds.length, scene.segmentCount * tiles,
        "page-spanning strokes reproduce the previous tile-reference multiplication");
    } else {
      assert(geometry.levels.some(level => level.overview), "exercise the overview hierarchy too");
    }
    fields.forEach((field, i) => assert.deepEqual(scene[field], original[i], "canonical geometry stays unchanged"));

    // Re-exporting a prepared viewer still reuses its exact geometry.
    vector.resetVectorStrokeLodBuildTiming();
    await writeHepLod(new HepArchive(), scene, { withTextLod: false });
    assert.equal(vector.consumeVectorStrokeLodBuildTiming().buildCount, 0);
    assert.equal(vector.getStoredVectorStrokeLod(scene).literals.endpoints, expected.literals.endpoints);
  }

  const fresh = makeScene(512, true), archive = new HepArchive();
  vector.resetVectorStrokeLodBuildTiming();
  const manifest = await writeHepLod(archive, fresh, { withTextLod: false, vectorLodPrecision: "lossless" });
  assert.equal(vector.consumeVectorStrokeLodBuildTiming().buildCount, 1);
  assert.equal(vector.takePrebuiltVectorStrokeLodRuntime(fresh), null,
    "successful HEP writing must not leave a document-sized idle viewer hierarchy");
  assert.equal(vector.getStoredVectorStrokeLod(fresh), null,
    "successful HEP writing must not expose unindexed export data to viewers");
  const index = JSON.parse(await archive.file(manifest.vector.file).async("string"));
  assert.equal(index.tileIndexes, "rebuild");
  const restored = makeScene(512, true);
  await readHepLod(archive, restored, manifest);
  const restoredRuntime = new vector.VectorStrokeLodRuntime(restored);
  assert(restoredRuntime.levels[0].tileSegmentIds.length > restored.segmentCount,
    "loading reconstructs the viewer indexes from the exported geometry");

  const cancelled = makeScene(512);
  const controller = new AbortController();
  await assert.rejects(vector.buildVectorStrokeLodForStorage(cancelled, {
    signal: controller.signal,
    onProgress: event => { if (event.message.startsWith("Simplifying tol")) controller.abort(); }
  }), /cancel/i);
  assert(controller.signal.aborted, "exercise cancellation during simplification");
  assert.equal(vector.getStoredVectorStrokeLod(cancelled), null);
  assert.equal(vector.takePrebuiltVectorStrokeLodRuntime(cancelled), null);
  await assert.rejects(vector.buildVectorStrokeLodForStorage(cancelled, { shouldCancel: () => true }), /cancel/i);
  const failure = new Error("progress failed");
  await assert.rejects(vector.buildVectorStrokeLodForStorage(cancelled, {
    onProgress: event => { if (event.message.startsWith("Simplifying tol")) throw failure; }
  }), error => error === failure);
  assert.equal(vector.getStoredVectorStrokeLod(cancelled), null);
  console.log("HEP LOD export: no viewer indexes or cache retention, packed geometry parity, active reuse, restoration and cancellation passed.");
} finally {
  hooks.deregister();
}
