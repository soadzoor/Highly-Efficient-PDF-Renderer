import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { VectorStrokeLodRuntime, buildVectorStrokeLodScenes, buildRuntimeTileBuckets,
    prebuildVectorStrokeLodRuntime, shouldUseVectorStrokeLod } = await import("../src/vectorStrokeLodCore.ts");
  const { formatVectorStrokeLodStats } = await import("../src/vectorStrokeLodStatsFormat.ts");
  const count = 153_600;
  const scene = { ...createEmptyVectorScene(), segmentCount: count, maxHalfWidth: .06,
    bounds: { minX: 0, minY: 0, maxX: 1020, maxY: 1000 },
    pageRects: Float32Array.of(0, 0, 1020, 1000), pageCount: 1,
    drawRuns: [{ kind: "stroke", first: 0, count }] };
  for (const key of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) scene[key] = new Float32Array(count * 4);
  for (let index = 0; index < count; index++) {
    const x = index % 400 * 2.5, y = Math.floor(index / 400) * 2.5;
    const length = index < 102_400 ? .1 : index < 128_000 ? 1 : 16;
    scene.endpoints.set([x, y, x + length, y], index * 4);
    scene.primitiveMeta.set([x + length, y, 0, 5], index * 4);
    scene.primitiveBounds.set([x, y, x + length, y], index * 4);
    scene.styles.set([.06, 0, 0, 0], index * 4);
  }
  const original = structuredClone(scene);
  assert(shouldUseVectorStrokeLod("auto", "webgl", count));
  assert.equal(shouldUseVectorStrokeLod("off", "webgl", count), false);
  const built = buildVectorStrokeLodScenes(scene);
  assert(built.some(level => level.tolerance > 0 && !level.overview), "retain the conservative fine representation");
  assert(built.some(level => level.overview && level.scene.segmentCount < 50_000), "build useful overview geometry");
  const fields = ["endpoints", "primitiveMeta", "primitiveBounds", "styles"];
  const progress = [];
  const cooperative = await prebuildVectorStrokeLodRuntime(scene, "auto", "webgl", {
    yieldIntervalMs: 1, onProgress: event => progress.push(event.value)
  });
  assert.deepEqual(cooperative.levels.map(level => [level.tolerance, level.overview]),
    built.map(level => [level.tolerance, level.overview]));
  cooperative.levels.forEach((level, index) => {
    for (const key of fields) assert.deepEqual(level.scene[key], built[index].scene[key], "sync/async overview geometry agrees");
  });
  assert(progress.every((value, index) => index === 0 || value >= progress[index - 1]), "progress remains monotonic");
  const grid = { columns: 64, rows: 64, minX: 0, minY: 0, maxX: 1020, maxY: 1000,
    tileWidth: 1020 / 64, tileHeight: 1000 / 64,
    xEdges: Float64Array.from({ length: 65 }, (_, i) => i * 1020 / 64),
    yEdges: Float64Array.from({ length: 65 }, (_, i) => i * 1000 / 64) };
  const runtime = new VectorStrokeLodRuntime(scene, { tileGrid: grid, elapsedMs: 0,
    levels: built.map(level => ({ ...level, segmentCount: level.scene.segmentCount, ...buildRuntimeTileBuckets(level.scene, grid) })) });
  const viewport = { width: 1920, height: 1080 };
  const frame = (units, view = viewport) => {
    runtime.updateForLocalUnitsPerPixel(units);
    return runtime.update({ cameraCenterX: 510, cameraCenterY: 500, zoom: 1 / units }, view);
  };
  frame(2);
  const overviewCount = runtime.getRenderedSegmentCount(), stats = runtime.getStats();
  assert(overviewCount > 0 && overviewCount <= 82_500, `overview follows the 50k soft budget: ${overviewCount}`);
  assert(stats.activeLevels.some(level => level.overview), "report when overview approximation is in use");
  assert(stats.targetSegmentsPerTile < 24, "the old 24-stroke floor cannot inflate a 4,096-tile overview budget");
  assert(stats.activeLevels.every(level => level.tolerance <= 2 * 5), "budget pressure has a bounded overview tolerance");
  assert.match(formatVectorStrokeLodStats(stats), /overview/);
  assert.match(formatVectorStrokeLodStats(stats), /target ~50k total/);
  const marks = runtime.levels.map(level => level.markToken);
  assert.equal(frame(2), false, "an unchanged overview reuses selection");
  assert.deepEqual(runtime.levels.map(level => level.markToken), marks);
  const fullSceneViewport = { width: 200_000, height: 200_000 };
  frame(.01, fullSceneViewport);
  assert.equal(runtime.getRenderedSegmentCount(), count, "close zoom restores every canonical primitive");
  assert.deepEqual(runtime.getStats().activeLevels.map(level => level.index), [0]);
  // Past the normal threshold, pressure may still use overview levels within
  // their 5 px limit; only zoom beyond every such level forces exact geometry.
  frame(.3, fullSceneViewport);
  const detailPressure = runtime.getStats();
  assert.equal(detailPressure.baselineLevelIndex, 0, "the fixture is past the first normal LOD threshold");
  assert(runtime.getRenderedSegmentCount() <= 82_500 && detailPressure.activeLevels.some(level => level.overview),
    "a dense view past the normal threshold still follows the soft budget");
  assert(detailPressure.activeLevels.every(level => level.tolerance <= .3 * 5), "pressure keeps the 5 px overview limit");
  runtime.setForceExact(true); frame(2);
  assert.equal(runtime.getRenderedSegmentCount(), count, "primitive styling can still require exact identity");
  runtime.setForceExact(false); frame(2);
  assert.equal(runtime.getRenderedSegmentCount(), overviewCount);

  // Skipped tolerances must not hide a pressure-limit change behind the same
  // baseline cache key. This fixture tests selection, without another build.
  const oneTile = { ...grid, columns: 1, rows: 1, tileWidth: 1020, tileHeight: 1000,
    xEdges: Float64Array.of(0, 1020), yEdges: Float64Array.of(0, 1000) };
  const sparseLevels = [[0, count, false], [.5, 120_000, false], [4, 8000, true]].map(([tolerance, segmentCount, overview]) => {
    const reduced = { ...scene, segmentCount };
    return { tolerance, segmentCount, overview, scene: reduced, ...buildRuntimeTileBuckets(reduced, oneTile) };
  });
  const pressure = new VectorStrokeLodRuntime(scene, { tileGrid: oneTile, levels: sparseLevels, elapsedMs: 0 });
  const pressureFrame = units => {
    pressure.updateForLocalUnitsPerPixel(units);
    return pressure.update({ cameraCenterX: 510, cameraCenterY: 500, zoom: 1 / units }, fullSceneViewport);
  };
  assert(pressureFrame(.79));
  assert.equal(pressure.getRenderedSegmentCount(), 120_000);
  const baseline = pressure.getStats().baselineLevelIndex;
  assert(pressureFrame(.81), "entering a coarser pressure allowance invalidates full-view reuse");
  assert.equal(pressure.getStats().baselineLevelIndex, baseline);
  assert.equal(pressure.getRenderedSegmentCount(), 8000);
  assert.equal(pressureFrame(.81), false);
  assert(pressureFrame(.79), "zooming back restores geometry despite the unchanged baseline");
  assert.equal(pressure.getRenderedSegmentCount(), 120_000);
  pressureFrame(.01);
  assert.equal(pressure.getRenderedSegmentCount(), count);
  const qualityOnly = new VectorStrokeLodRuntime(scene, { tileGrid: oneTile, elapsedMs: 0,
    levels: sparseLevels.map(level => ({ ...level, overview: false,
      ...buildRuntimeTileBuckets(level.scene, oneTile) })) });
  qualityOnly.updateForLocalUnitsPerPixel(.81);
  qualityOnly.update({ cameraCenterX: 510, cameraCenterY: 500, zoom: 1 / .81 }, fullSceneViewport);
  assert.equal(qualityOnly.getRenderedSegmentCount(), 120_000,
    "pressure cannot exceed normal screen tolerance for levels without overview permission");
  assert.deepEqual(scene, original, "overview LOD never changes source PDF/HEP geometry");
  await assert.rejects(prebuildVectorStrokeLodRuntime(scene, "auto", "webgl", {
    yieldIntervalMs: 1, shouldCancel: () => true
  }), /cancel|abort/i);
  let cancelOverview = false;
  await assert.rejects(prebuildVectorStrokeLodRuntime(scene, "auto", "webgl", {
    yieldIntervalMs: 1,
    onProgress: progress => { if (progress.message.startsWith("Simplifying Vector LOD 2/")) cancelOverview = true; },
    shouldCancel: () => cancelOverview
  }), /cancel|abort/i);
  assert(cancelOverview, "cancellation reaches the new overview build, not just initial setup");
  console.log(`Overview LOD ${count}→${overviewCount}: budget, exact zoom, cache limits, async parity, cancellation and source identity passed`);
} finally { hooks.deregister(); }
