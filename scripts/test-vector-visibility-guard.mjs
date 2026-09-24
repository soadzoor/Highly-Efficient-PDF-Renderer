import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c);
} });
try {
  const [{ createEmptyVectorScene }, { VectorDrawRunCuller, vectorViewBounds },
    { VectorStrokeLodRuntime, buildRuntimeTileBuckets }, { VectorOrderedBatches }] = await Promise.all([
    import("../src/emptyVectorScene.ts"), import("../src/vectorDrawRunCulling.ts"),
    import("../src/vectorStrokeLodCore.ts"), import("../src/vectorOrderedBatches.ts")
  ]);
  const count = 153_600, perRun = 96;
  const scene = Object.assign(createEmptyVectorScene(), {
    segmentCount: count, maxHalfWidth: .001, pageCount: 1,
    bounds: { minX: 0, minY: -200, maxX: 12000, maxY: 200 },
    pageRects: Float32Array.of(0, -200, 12000, 200),
    drawRuns: Array.from({ length: count / perRun }, (_, index) => ({ kind: "stroke", first: index * perRun, count: perRun })),
    endpoints: new Float32Array(count * 4), primitiveMeta: new Float32Array(count * 4),
    primitiveBounds: new Float32Array(count * 4), styles: new Float32Array(count * 4)
  });
  for (let id = 0; id < count; id++) {
    const x = id * 12000 / count, y = (id % perRun) * 4 - 190;
    scene.endpoints.set([x, y, x + .01, y], id * 4);
    scene.primitiveMeta.set([x + .01, y, 0, id % 2 ? 3 : 1], id * 4);
    scene.primitiveBounds.set([x, y, x + .01, y], id * 4);
    scene.styles.set([id % 2 ? 0 : .001, 0, 0, 0], id * 4);
  }
  // Inject exact geometry into two prebuilt levels. This tests selection/cache
  // invalidation without spending the test budget simplifying a large drawing.
  const grid = { columns: 8, rows: 1, minX: 0, minY: -200, maxX: 12000, maxY: 200,
    tileWidth: 1500, tileHeight: 400, xEdges: Float64Array.from({ length: 9 }, (_, i) => i * 1500),
    yEdges: Float64Array.of(-200, 200) };
  const buckets = buildRuntimeTileBuckets(scene, grid);
  const makeRuntime = () => new VectorStrokeLodRuntime(scene, { tileGrid: grid, elapsedMs: 0,
    levels: [0, .5].map(tolerance => ({ ...buckets, scene, tolerance, segmentCount: count,
      visibleSegmentIds: new Uint32Array(count), segmentMarks: new Uint32Array(count) })) });
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const viewport = { width: 1920, height: 945 };
  const viewAt = (x, units = 1) => ({ cameraCenterX: x, cameraCenterY: 0, zoom: 1 / units });
  const boundsAt = (x, units = 1) => vectorViewBounds(viewport.width, viewport.height, x, 0, 1 / units);
  const culler = new VectorDrawRunCuller(scene);
  // Each reference culler is below the guard threshold, preserving exact-view
  // membership with the same geometric/AA rules as the large guarded culler.
  const exactCullers = [0, 800].map(first => new VectorDrawRunCuller({ ...scene, drawRuns: scene.drawRuns.slice(first, first + 800) }));
  const exactRuns = (view, units) => exactCullers.flatMap(part => [...part.select(view, units)]);
  const checkRunSuperset = (view, units) => {
    const guarded = culler.select(view, units), selected = new Set(guarded);
    for (const run of exactRuns(view, units)) assert(selected.has(run), "guarded culling cannot omit an exact-view paint");
    scene.drawRuns.forEach((run, index) => assert.equal(culler.selected?.[index] ?? 1, Number(selected.has(run)),
      "cached membership flags agree with the cached draw list"));
    return guarded;
  };
  const initial = checkRunSuperset(boundsAt(6000), 1);
  const guard = culler.guardBounds;
  assert(initial.length > exactRuns(boundsAt(6000), 1).length, "the guard retains a bounded offscreen vector margin");
  assert.equal(checkRunSuperset(boundsAt(6020), 1), initial);
  assert.equal(culler.guardBounds, guard, "small pan keeps the selected window");
  checkRunSuperset(boundsAt(6000, .99), .99);
  assert.equal(culler.guardBounds, guard, "zoom within the AA bucket safely reuses the window");
  checkRunSuperset(boundsAt(6000, 1.01), 1.01);
  assert.notEqual(culler.guardBounds, guard, "a larger AA bucket invalidates the guarded selection");
  const refreshed = culler.guardBounds;
  checkRunSuperset(boundsAt(6200, 1.01), 1.01);
  assert.notEqual(culler.guardBounds, refreshed, "leaving the guard selects entering paints");
  assert.equal(culler.select(null, 1), scene.drawRuns);
  assert.equal(culler.guardBounds, null, "unknown bounds clear the cached subset");
  checkRunSuperset(boundsAt(6000), 1);
  assert.equal(culler.select({ minX: NaN, minY: 0, maxX: 1, maxY: 1 }, 1), scene.drawRuns);
  assert.equal(culler.guardBounds, null, "nonfinite bounds clear the cached subset");

  const zoomCuller = new VectorDrawRunCuller(scene);
  const broad = zoomCuller.select(boundsAt(6000, 2), 2, 64).length;
  const broadGuard = zoomCuller.guardBounds, broadPadding = zoomCuller.padding;
  const detail = zoomCuller.select(boundsAt(6000, .1), .1, 64).length;
  assert.equal(zoomCuller.padding, broadPadding, "LOD expansion can keep the AA bucket unchanged through a deep zoom");
  assert.notEqual(zoomCuller.guardBounds, broadGuard, "zooming in limits the old guard's overdraw");
  assert(detail < broad / 4, "detail views do not keep the whole overview selection");

  // Four AA pixels remain finite at this scale while 64 guard pixels overflow.
  // Such a window must never be cached as an infinite superset of a finite scan.
  const huge = { ...scene, segmentCount: 1024,
    drawRuns: Array.from({ length: 1024 }, (_, first) => ({ kind: "stroke", first, count: 1 })),
    endpoints: new Float64Array(4096), primitiveMeta: new Float64Array(4096), styles: new Float64Array(4096) };
  for (let id = 0; id < 1024; id++) {
    const x = (id % 3 - 1) * 1e308;
    huge.endpoints.set([x, 0, x, 0], id * 4); huge.primitiveMeta.set([x, 0, 0, 3], id * 4);
  }
  const hugeCuller = new VectorDrawRunCuller(huge);
  hugeCuller.select({ minX: -1, minY: -1, maxX: 1, maxY: 1 }, 1e307);
  assert.equal(hugeCuller.guardBounds, null);
  const hugeRight = hugeCuller.select({ minX: 9e307, minY: -1, maxX: 1.1e308, maxY: 1 }, 1e307);
  assert(hugeRight.every(run => run.first % 3 === 2), "an overflowing guard cannot reuse a distant previous subset");
  assert(hugeRight.length > 0);

  const runtime = makeRuntime();
  const step = (x, units = 1) => {
    runtime.updateForLocalUnitsPerPixel(units);
    return runtime.update(viewAt(x, units), viewport);
  };
  assert(step(6000));
  const marks = runtime.levels.map(level => level.markToken);
  const stats = runtime.getStats();
  assert.equal(step(6020), false, "small planar pan reuses selected primitive IDs");
  assert.deepEqual(runtime.levels.map(level => level.markToken), marks, "reuse does not rescan any tile primitives");
  assert.equal(step(6000, .99), false, "a safe zoom within the baseline level reuses selection");
  assert.deepEqual(runtime.getStats(), stats, "guard expansion does not change actual tile budgets");
  assert(step(6080), "crossing the guard refreshes selection even in the same tiles");
  assert(step(6500));
  const oldGuard = runtime.selectionGuard;
  assert(step(6530), "an entering tile invalidates selection even inside the previous guard");
  assert(viewAt(6530).cameraCenterX < oldGuard.bounds.maxX - viewport.width / 2 - 16);
  assert(step(6000));
  assert(step(6000, .8));
  const broadLodGuard = runtime.selectionGuard;
  assert(step(6000, .5), "a narrower view refreshes oversized cached selection");
  assert.deepEqual(runtime.selectionGuard.range, broadLodGuard.range, "zoom-in fixture stays in the same tile range");
  assert.equal(runtime.selectionGuard.baseline, broadLodGuard.baseline, "zoom-in fixture keeps the same baseline level");
  assert(step(6000, .2), "a changed baseline level refreshes selection");
  assert.equal(runtime.getStats().baselineLevelIndex, 0);
  assert(step(6000));
  runtime.setForceExact(true);
  assert(step(6000), "forced exact geometry invalidates the previous cache");
  runtime.setForceExact(false);
  assert(step(6000));
  runtime.setLocalToClipTransform(identity, 1);
  assert(step(6000));
  assert(step(6000), "arbitrary projection mode never reuses the planar guard");
  runtime.setScreenSpaceTransform();
  assert(step(6000), "returning to planar rendering refreshes the projection state");
  assert.equal(step(6000), false);
  runtime.resetVisible();
  assert(step(6000), "reset clears guarded IDs");

  // Compare complete CPU selection + batch updates over 60 small pan frames.
  // The identity local-to-clip reference has identical tile budgets but takes
  // the uncached projection path, providing the exact-view selection baseline.
  const guardedRuntime = makeRuntime(), referenceRuntime = makeRuntime();
  referenceRuntime.setLocalToClipTransform(identity, 1);
  const guardedCuller = new VectorDrawRunCuller(scene);
  const guardedPlan = new VectorOrderedBatches(scene, guardedRuntime), referencePlan = new VectorOrderedBatches(scene, referenceRuntime);
  let guardedSelections = 0, referenceSelections = 0, guardedRebuilds = 0, referenceRebuilds = 0;
  let guardedIds = 0, referenceIds = 0;
  const retainedIds = new Uint8Array(count);
  for (let frame = 0; frame < 60; frame++) {
    const x = 6000 + 20 * Math.sin(frame / 60 * Math.PI * 2);
    guardedRuntime.updateForLocalUnitsPerPixel(1); referenceRuntime.updateForLocalUnitsPerPixel(1);
    if (guardedRuntime.update(viewAt(x), viewport)) { guardedSelections++; guardedPlan.invalidate(); }
    if (referenceRuntime.update(viewAt(x), viewport)) { referenceSelections++; referencePlan.invalidate(); }
    const guardedRuns = guardedCuller.select(boundsAt(x), 1), referenceRuns = exactRuns(boundsAt(x), 1);
    if (guardedPlan.update(guardedRuns, 1)) guardedRebuilds++;
    if (referencePlan.update(referenceRuns, 1)) referenceRebuilds++;
    assert.equal(guardedRuntime.getStats().visibleTileCount, referenceRuntime.getStats().visibleTileCount);
    assert.equal(guardedRuntime.getStats().targetSegmentsPerTile, referenceRuntime.getStats().targetSegmentsPerTile);
    retainedIds.fill(0);
    for (let index = 0; index < guardedPlan.instanceCount; index++) retainedIds[guardedPlan.uintInstances[index * 2]] = 1;
    for (let index = 0; index < referencePlan.instanceCount; index++) assert(retainedIds[referencePlan.uintInstances[index * 2]],
      "every exact-view thin stroke and hairline remains submitted throughout the pan");
    guardedIds += guardedPlan.instanceCount; referenceIds += referencePlan.instanceCount;
  }
  assert.equal(guardedSelections, 1);
  assert.equal(guardedRebuilds, 1);
  assert.equal(referenceSelections, 60);
  assert(referenceRebuilds > 50, "the baseline exercises real instance-membership churn");
  assert(guardedIds >= referenceIds && guardedIds < referenceIds * 1.1, "guard overdraw stays bounded for a normal viewport");
  console.log(`Visibility guard passed: ${referenceSelections}→${guardedSelections} selections, ${referenceRebuilds}→${guardedRebuilds} batch rebuilds; ` +
    `${Math.round(referenceIds / 60)}→${Math.round(guardedIds / 60)} mean submitted strokes, no missing visible IDs.`);
} finally { hooks.deregister(); }
