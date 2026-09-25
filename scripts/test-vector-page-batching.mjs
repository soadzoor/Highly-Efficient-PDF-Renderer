import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { VectorOrderedBatches } = await import("../src/vectorOrderedBatches.ts");
  const { VectorDrawRunCuller } = await import("../src/vectorDrawRunCulling.ts");
  const { setStrokePaintOrigins } = await import("../src/vectorStrokePaintOrder.ts");
  const { compositePdfPixel } = await import("../src/pdfComposite.ts");
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");

  const scene = makePages([0, 100, 200]);
  const plan = new VectorOrderedBatches(scene, null);
  plan.update(scene.drawRuns);
  const original = paints(plan);
  assert.equal(plan.batches.length, 15);
  assert(plan.update(scene.drawRuns, 0.1));
  assert.equal(plan.batches.length, 7, "three pages share stroke, fill, and text draws; image textures remain separate");
  assert.deepEqual(paints(plan).slice().sort(), original.slice().sort(), "batching keeps every primitive and its clip root");
  for (let page = 0; page < 3; page++) assertPageOrder(plan, original, [page]);
  assert.deepEqual([...plan.floatInstances.slice(0, plan.instanceCount * 2)], [...plan.uintInstances.slice(0, plan.instanceCount * 2)]);
  assert.equal(plan.update(scene.drawRuns, 0.11), false, "zoom within the same safe partition reuses instance data");
  assert(plan.update(scene.drawRuns, 0.2), "a new AA bucket reevaluates within-page dependencies");
  assert(plan.update(scene.drawRuns, 20), "screen-space coverage can connect formerly independent pages");
  assert.deepEqual(paints(plan), original, "overlapping AA/hairline coverage retains global source order");
  assert(plan.update(scene.drawRuns, 0.1));
  assert.equal(plan.batches.length, 7);
  assert(plan.update(scene.drawRuns, null));
  assert.deepEqual(paints(plan), original, "unknown projection scale restores global order");

  const single = makePages([0]);
  single.fillPathMetaA[2] = 100; single.fillPathMetaB[0] = 110;
  const singlePlan = new VectorOrderedBatches(single, null);
  singlePlan.update(single.drawRuns, 0.1);
  assert.equal(singlePlan.batches.length, 4, "strokes share a draw across a disjoint fill on the same page");
  assert.deepEqual(paints(singlePlan), ["stroke:0:0", "stroke:1:0", "fill:0:0", "text:0:0", "raster:0:0"]);
  assert.equal(singlePlan.update(single.drawRuns, 0.11), false);
  assert(singlePlan.update(single.drawRuns, 20), "growing AA refreshes order even though the page group is unchanged");
  assert.equal(singlePlan.batches.length, 4, "a fill quad does not acquire the old four-pixel stroke margin");
  assert(singlePlan.update(single.drawRuns, 128));
  assert.equal(singlePlan.batches.length, 5, "actual stroke AA reaching the distant fill prevents the within-page swap");
  assert.equal(singlePlan.scheduler.paintOrderApproximated, false,
    "a handful of paints stays exact at any scale: there are no draw calls to win back");
  assert(singlePlan.update(single.drawRuns, 0.1));
  assert.equal(singlePlan.batches.length, 4, "zooming back restores safe batching");

  // Native strokes can paint beyond their centerlines; fill and glyph quads
  // remain bounded by their vertices. Exercise those distinct coverage limits.
  const aaStrokeScene = (hairline, gap) => {
    const value = makePages([0]);
    value.pageRects = Float32Array.of(-50, -50, 50, 50);
    value.drawRuns = value.drawRuns.slice(0, 3);
    value.endpoints.set([0,20,10,20, 20,0,30,0]);
    value.primitiveMeta.set([10,20,0,0.5, 30,0,0,hairline ? 3 : 1]);
    value.primitiveBounds.set([0,20,10,20, 20,0,30,0]);
    value.styles.set([0.25,0,0,0, hairline ? 0 : 0.75,0,0,0]);
    value.fillPathMetaA.set([0,4,20,gap]);
    value.fillPathMetaB.set([30,gap+1,1,0]);
    value.fillPathMetaC = Float32Array.of(0,0,0,1);
    return value;
  };
  for (const [hairline, gap] of [[true, 0.8], [false, 1.7]]) {
    const edge = aaStrokeScene(hairline, gap), edgePlan = new VectorOrderedBatches(edge, null);
    const edgeOriginal = structuredClone(edge);
    edgePlan.update(edge.drawRuns, 1);
    assert.deepEqual(paints(edgePlan), ["stroke:0:0", "fill:0:0", "stroke:1:0"],
      "different-color paint touching visible stroke AA keeps source order");
    assert.equal(edgePlan.update(edge.drawRuns, 0.9), false, "a shared conservative scale bucket reuses the upload");
    edgePlan.update(edge.drawRuns, 0.125);
    assert.deepEqual(paints(edgePlan), ["stroke:0:0", "stroke:1:0", "fill:0:0"],
      "zooming in may batch only after stroke AA no longer reaches the fill");
    edgePlan.update(edge.drawRuns, null);
    assert.deepEqual(paints(edgePlan), ["stroke:0:0", "fill:0:0", "stroke:1:0"]);
    edgePlan.update(edge.drawRuns, 1);
    assert.deepEqual(paints(edgePlan), ["stroke:0:0", "fill:0:0", "stroke:1:0"]);
    assert.deepEqual(edge, edgeOriginal, "coverage scheduling does not alter AA, source geometry, or styles");
  }
  const edgeLod = aaStrokeScene(true, 0.8);
  edgeLod.endpoints[5] = edgeLod.endpoints[7] = edgeLod.primitiveMeta[5] = 10;
  edgeLod.primitiveBounds[5] = edgeLod.primitiveBounds[7] = 10;
  const edgeCoarse = structuredClone(edgeLod);
  edgeCoarse.endpoints[5] = edgeCoarse.endpoints[7] = edgeCoarse.primitiveMeta[5] = 0;
  edgeCoarse.primitiveBounds[5] = edgeCoarse.primitiveBounds[7] = 0;
  setStrokePaintOrigins(edgeCoarse, Uint32Array.of(0, 1));
  const edgeRuntime = { levels: [edgeLod, edgeCoarse].map((scene, index) => ({ scene, tolerance: index,
    segmentCount: 2, visibleSegmentIds: Uint32Array.of(0, 1), visibleSegmentCount: index ? 0 : 2 })) };
  const edgeLodPlan = new VectorOrderedBatches(edgeLod, edgeRuntime);
  edgeLodPlan.update(edgeLod.drawRuns, 1);
  assert.deepEqual(paints(edgeLodPlan), ["stroke:0:0", "fill:0:0", "stroke:1:0"],
    "dormant LOD stroke coverage still fences a future overlapping paint");
  edgeRuntime.levels[0].visibleSegmentCount = 0; edgeRuntime.levels[1].visibleSegmentCount = 2;
  edgeLodPlan.invalidate(); edgeLodPlan.update(edgeLod.drawRuns, 1);
  assert.deepEqual(paints(edgeLodPlan), ["stroke:2:0", "fill:0:0", "stroke:3:0"]);

  const quadEdges = makePages([0, 10]);
  quadEdges.pageRects = Float32Array.of(-50, -50, 50, 50);
  quadEdges.segmentCount = 0;
  for (const key of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) quadEdges[key] = new Float32Array(0);
  quadEdges.drawRuns = [quadEdges.drawRuns[1], quadEdges.drawRuns[3], quadEdges.drawRuns[6]];
  quadEdges.textInstanceA.set([12,4,-4,12]); quadEdges.textInstanceB.set([12,-2,0,0]);
  const quadPlan = new VectorOrderedBatches(quadEdges, null);
  quadPlan.update(quadEdges.drawRuns, 0.001);
  assert.deepEqual(paints(quadPlan), ["fill:0:0", "text:0:0", "fill:1:0"],
    "transformed glyph corners overlapping a fill preserve source order at close zoom");
  const separatedQuads = structuredClone(quadEdges);
  separatedQuads.fillPathMetaA.set([0,4,-20,0]); separatedQuads.fillPathMetaB.set([-10,1,1,0]);
  separatedQuads.fillPathMetaA.set([0,4,2.25,0],4); separatedQuads.fillPathMetaB.set([3.25,1,1,0],4);
  separatedQuads.textInstanceA.set([1,0,0,1]); separatedQuads.textInstanceB.set([0,0,0,0]);
  const separatedPlan = new VectorOrderedBatches(separatedQuads, null);
  separatedPlan.update(separatedQuads.drawRuns, 1);
  assert.deepEqual(paints(separatedPlan), ["fill:0:0", "fill:1:0", "text:0:0"],
    "disjoint fill and glyph quads need only their conservative raster guard, not stroke AA expansion");

  // Page rectangles are only a hint: actual content can extend beyond them.
  // A and B overlap; C is independent and can still be batched with that stream.
  const overflow = makePages([0, 100, 300]);
  overflow.fillPathMetaB[0] = 110;
  const overlapping = new VectorOrderedBatches(overflow, null);
  overlapping.update(overflow.drawRuns);
  const overflowOrder = paints(overlapping);
  overlapping.update(overflow.drawRuns, 0.1);
  assertPageOrder(overlapping, overflowOrder, [0]);
  assertPageOrder(overlapping, overflowOrder, [1]);
  assertOverlapOrder(overlapping, overflowOrder, overflow);
  assertPageOrder(overlapping, overflowOrder, [2]);
  assert(overlapping.batches.length < 15, "independent pages still batch when other pages overlap");

  const chain = makePages([0, 100, 200]);
  chain.fillPathMetaB[0] = 110;
  chain.fillPathMetaB[4] = 210;
  assertOverlappingPaints(chain);

  const unknown = makePages([0, 100]);
  unknown.textInstanceA[0] = NaN;
  assertOverlappingPaints(unknown);
  const gradient = makePages([0, 100]);
  gradient.drawRuns.splice(1, 0, { kind: "gradient-fill", first: 0, count: 1 });
  assertOverlappingPaints(gradient);

  // A glyph transform, a wide stroke, and an image can each cross a page gap.
  for (const kind of ["text", "stroke", "raster"]) {
    const crossing = makePages([0, 100]);
    if (kind === "text") crossing.textInstanceA[0] = 110;
    if (kind === "stroke") crossing.styles[0] = 110;
    if (kind === "raster") crossing.rasterLayers[0].matrix[0] = 110;
    assertOverlappingPaints(crossing);
  }

  // Vector clips bound even very long primitives; different clip roots can
  // share a draw, including parent/child intersections.
  const clipped = makePages([0, 100]);
  clipped.clipPaths = [rectangle(-1000, -1000, 1000, 1000), rectangle(0, 0, 10, 10, 0), rectangle(100, 0, 110, 10, 0)];
  clipped.drawRuns.forEach((run, index) => { run.clipIndex = Math.floor(index / 5) + 1; });
  clipped.fillPathMetaB[0] = 110;
  const clippedPlan = new VectorOrderedBatches(clipped, null);
  clippedPlan.update(clipped.drawRuns);
  const clippedOrder = paints(clippedPlan);
  clippedPlan.update(clipped.drawRuns, 0.1);
  assert.equal(clippedPlan.batches.length, 6);
  assertPageOrder(clippedPlan, clippedOrder, [0]);
  assertPageOrder(clippedPlan, clippedOrder, [1]);
  const culler = new VectorDrawRunCuller(clipped);
  assert.equal(culler.select({ minX: 40, minY: 0, maxX: 60, maxY: 10 }, 0.1).length, 0);
  assert.deepEqual(culler.select({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 0.1), clipped.drawRuns.slice(0, 5));
  assert.deepEqual(culler.select({ minX: 100, minY: 0, maxX: 110, maxY: 10 }, 0.1), clipped.drawRuns.slice(5));
  const unclippedCuller = new VectorDrawRunCuller(scene);
  const gap = { minX: 40, minY: 0, maxX: 60, maxY: 10 };
  assert.equal(unclippedCuller.select(gap, 0.1).length, 0);
  assert(unclippedCuller.select(gap, 20).length > 0, "changing AA scale refreshes cached culling bounds");
  assert.equal(unclippedCuller.select(gap, 0.1).length, 0);

  // All LOD levels must participate in dependency bounds, including levels
  // that are not currently selected. Their geometry can extend farther.
  const lodScene = makePages([0, 100]);
  const coarse = { ...lodScene, endpoints: lodScene.endpoints.slice(), primitiveMeta: lodScene.primitiveMeta.slice() };
  coarse.endpoints[2] = coarse.primitiveMeta[0] = 110;
  setStrokePaintOrigins(coarse, Uint32Array.from([0, 1, 2, 3]));
  const runtime = { levels: [lodScene, coarse].map((scene, index) => ({ scene, tolerance: index,
    segmentCount: scene.segmentCount, visibleSegmentIds: Uint32Array.from([0, 1, 2, 3]), visibleSegmentCount: index ? 0 : 4 })) };
  const lodPlan = new VectorOrderedBatches(lodScene, runtime);
  lodPlan.update(lodScene.drawRuns);
  const lodOrder = paints(lodPlan);
  lodPlan.update(lodScene.drawRuns, 0.1);
  assertOverlapOrder(lodPlan, lodOrder, lodScene,
    new VectorDrawRunCuller(lodScene, { scene: coarse, sourceRuns: Uint32Array.from([0, 2, 5, 7]) }));
  coarse.primitiveMeta[3] = 9; // Alpha 1 and rectangular clip flag.
  const boundedLodPlan = new VectorOrderedBatches(lodScene, runtime);
  boundedLodPlan.update(lodScene.drawRuns, 0.1);
  assert.equal(boundedLodPlan.batches.length, 6, "fragment clip rectangles bound simplified strokes too");

  // Culling and changing the selected LOD subset must not retain old IDs.
  const visible = scene.drawRuns.slice(5, 10);
  plan.update(visible, 0.1);
  assert.deepEqual(paints(plan), original.filter(paint => pageOf(paint) === 1));
  assert.equal(plan.update(visible, 0.1), false);
  runtime.levels[0].visibleSegmentCount = 0;
  runtime.levels[1].visibleSegmentCount = 4;
  boundedLodPlan.invalidate();
  assert(boundedLodPlan.update(lodScene.drawRuns, 0.1));
  const strokeIds = paints(boundedLodPlan).filter(p => p.startsWith("stroke:")).map(p => Number(p.split(":")[1]));
  assert.deepEqual(strokeIds.slice().sort((a, b) => a - b), [4, 5, 6, 7]);

  // Camera transitions can change LOD IDs while keeping the same paints.
  // Cached scheduling must still use fresh instances, and notice changes to
  // the contents of the culler's reused array or to screen-space coverage.
  const transitionScene = makePages([0, 100, 200]);
  const transitionRuntime = { levels: [0, 1].map(index => ({ scene: transitionScene, tolerance: index,
    segmentCount: 6, visibleSegmentIds: Uint32Array.from([0, 1, 2, 3, 4, 5]), visibleSegmentCount: index ? 0 : 6 })) };
  const transition = new VectorOrderedBatches(transitionScene, transitionRuntime);
  let schedules = 0;
  // Count actual replans rather than the per-span compaction underneath, which
  // runs once for every span a document's transparency groups create.
  const schedulePaints = transition.scheduler.schedulePaints.bind(transition.scheduler);
  transition.scheduler.schedulePaints = runs => { schedules++; return schedulePaints(runs); };
  const compareFresh = (runs, scale) => {
    const fresh = new VectorOrderedBatches(transitionScene, transitionRuntime);
    fresh.update(runs, scale);
    assert.deepEqual(transition.batches, fresh.batches);
    assert.equal(transition.instanceCount, fresh.instanceCount);
    assert.deepEqual(transition.uintInstances.slice(0, transition.instanceCount * 2),
      fresh.uintInstances.slice(0, fresh.instanceCount * 2), "cached scheduling keeps the current primitive IDs and clips");
    assert.deepEqual([...transition.floatInstances.slice(0, transition.instanceCount * 2)],
      [...transition.uintInstances.slice(0, transition.instanceCount * 2)], "both native backends receive the same instances");
  };
  transition.update(transitionScene.drawRuns, 0.1);
  assert.equal(schedules, 1);
  const [fine, coarseLevel] = transitionRuntime.levels;
  fine.visibleSegmentCount = 0; coarseLevel.visibleSegmentCount = 6;
  transition.invalidate();
  assert(transition.update(transitionScene.drawRuns, 0.1));
  assert.equal(schedules, 1, "a different LOD reuses the paint schedule");
  compareFresh(transitionScene.drawRuns, 0.1);
  fine.visibleSegmentIds.set([0, 2, 4]); coarseLevel.visibleSegmentIds.set([1, 3, 5]);
  fine.visibleSegmentCount = coarseLevel.visibleSegmentCount = 3;
  transition.invalidate();
  assert(transition.update(transitionScene.drawRuns, 0.1));
  assert.equal(schedules, 1, "mixed tile LODs can share the same schedule");
  compareFresh(transitionScene.drawRuns, 0.1);
  const movingRuns = transitionScene.drawRuns.slice(0, 5);
  transition.update(movingRuns, 0.1);
  assert.equal(schedules, 2);
  compareFresh(movingRuns, 0.1);
  movingRuns.splice(0, 5, ...transitionScene.drawRuns.slice(5, 10));
  assert(transition.update(movingRuns, 0.1));
  assert.equal(schedules, 3, "same-length visibility changes refresh the schedule");
  compareFresh(movingRuns, 0.1);
  transition.update(movingRuns, 20);
  assert.equal(schedules, 4, "AA bucket changes refresh dependencies for the same paints");
  compareFresh(movingRuns, 20);
  for (const scale of [null, 0.1]) {
    transition.update(movingRuns, scale);
    compareFresh(movingRuns, scale);
  }
  assert.equal(schedules, 5, "restoring a planar projection refreshes scheduling");

  // Small visibility changes filter a previously valid schedule. The template
  // must survive removals so reentering paints regain their original position.
  const nearbyScene = makePages([0, 5, 100, 200]);
  const nearby = new VectorOrderedBatches(nearbyScene, null);
  let nearbySchedules = 0;
  const scheduleNearby = nearby.scheduler.schedulePaints.bind(nearby.scheduler);
  nearby.scheduler.schedulePaints = runs => { nearbySchedules++; return scheduleNearby(runs); };
  nearby.update(nearbyScene.drawRuns, 0.1);
  const template = paints(nearby), templateDraws = nearby.batches.length;
  const movingPaints = [];
  for (const hidden of [[3], [1, 7], [], [4], []]) {
    movingPaints.length = 0;
    const visibleKeys = new Set();
    nearbyScene.drawRuns.forEach((run, index) => {
      if (hidden.includes(index)) return;
      movingPaints.push(run); visibleKeys.add(`${run.kind}:${run.first}:0`);
    });
    nearby.update(movingPaints, 0.1);
    assert.equal(nearbySchedules, 1, "nearby visibility changes reuse scheduling, including reentry");
    assert.deepEqual(paints(nearby), template.filter(paint => visibleKeys.has(paint)), "only the current visible paints are emitted");
    assert(nearby.batches.length <= templateDraws, "filtering never adds draws to the cached schedule");
  }
  nearby.update(nearbyScene.drawRuns.slice(0, 10), 0.1);
  assert.equal(nearbySchedules, 2, "large removals regroup draws for the smaller view");
  nearby.update(nearbyScene.drawRuns.slice(1, 11), 0.1);
  assert.equal(nearbySchedules, 3, "paints outside the template require a new schedule");
  nearby.update(nearbyScene.drawRuns.slice(1, 11), 20);
  assert.equal(nearbySchedules, 4, "larger antialiasing bounds invalidate the subset cache");
  for (const scale of [null, 0.1]) {
    nearby.update(nearbyScene.drawRuns, scale);
    const fresh = new VectorOrderedBatches(nearbyScene, null);
    fresh.update(nearbyScene.drawRuns, scale);
    assert.deepEqual(paints(nearby), paints(fresh), "projection changes restore the correct paint order");
  }

  // Equal RGB commutes under Normal source-over, including unequal coverage,
  // layer conditions and clips. References and the source arrays never change.
  const monochrome = makePages([0]);
  monochrome.drawRuns.pop();
  monochrome.fillPathMetaB.set([10, 10, 0.25, 0.25]);
  monochrome.fillPathMetaC = Float32Array.of(0, 0, 0.25, 0.4);
  monochrome.textInstanceC = Float32Array.of(0.25, 0.25, 0.25, 0.7);
  for (let index = 0; index < 2; index++) monochrome.styles.set([0.25, 0.25, 0.25, 0.25], index * 4);
  monochrome.clipPaths = [rectangle(0, 0, 5, 10), rectangle(2, 0, 10, 10)];
  monochrome.drawRuns.forEach((run, index) => { run.optionalContent = index; run.clipIndex = index % 2; });
  const unchanged = structuredClone(monochrome);
  const monochromePlan = new VectorOrderedBatches(monochrome, null);
  monochromePlan.update(monochrome.drawRuns, 0.1);
  assert.equal(monochromePlan.batches.length, 3, "overlapping same-color strokes batch through fills from different layers");
  assert.deepEqual(paints(monochromePlan), ["stroke:0:1", "stroke:1:1", "fill:0:2", "text:0:2"]);
  monochromePlan.setColorCommutationEnabled(false);
  assert(monochromePlan.update(monochrome.drawRuns, 0.1), "an override invalidates the cached schedule even at the same scale");
  assert.equal(monochromePlan.batches.length, 4, "temporary primitive colors restore overlap dependencies");
  monochromePlan.setColorCommutationEnabled(false);
  assert.equal(monochromePlan.update(monochrome.drawRuns, 0.1), false, "unchanged override state keeps the instance upload");
  monochromePlan.setColorCommutationEnabled(true);
  assert(monochromePlan.update(monochrome.drawRuns, 0.1));
  assert.equal(monochromePlan.batches.length, 3, "clearing overrides restores color batching");
  monochromePlan.update(monochrome.drawRuns.filter((_, index) => index !== 1), 0.1);
  assert.deepEqual(paints(monochromePlan), ["stroke:0:1", "stroke:1:1", "text:0:2"], "hidden paints keep their canonical identities");
  assert.deepEqual(monochrome, unchanged);
  for (const backdrop of [[0, 0, 0, 0], [0.1, 0.2, 0.3, 0.5], [1, 1, 1, 1]]) {
    for (const tint of [0, 0.3, 1]) {
      const rgb = [0.25, 0.25, 0.25].map((channel, index) => channel * (1 - tint) + [1, 0, 0.5][index] * tint);
      const layers = [0.17, 0.4, 0.81].map(alpha => [...rgb.map(channel => channel * alpha), alpha]);
      const forward = layers.reduce((result, layer) => compositePdfPixel(result, layer), backdrop);
      const reverse = layers.slice().reverse().reduce((result, layer) => compositePdfPixel(result, layer), backdrop);
      forward.forEach((channel, index) => assert(Math.abs(channel - reverse[index]) < 1e-12,
        "equal RGB commutes with alpha/AA coverage, translucent backdrops, and global tint"));
    }
  }
  for (const change of [
    scene => { scene.fillPathMetaC[2] += 0.000001; },
    scene => { scene.drawRuns[1].blendMode = "Multiply"; },
    scene => { scene.fillPathMetaC[2] = NaN; }
  ]) {
    const different = structuredClone(monochrome);
    change(different);
    const differentPlan = new VectorOrderedBatches(different, null);
    differentPlan.update(different.drawRuns, 0.1);
    assert.equal(differentPlan.batches.length, 4, "different/unknown RGB and blend modes remain ordered barriers");
  }
  const multicolor = structuredClone(monochrome);
  multicolor.textInstanceCount = 2;
  multicolor.textInstanceA = Float32Array.from([1, 0, 0, 1, 1, 0, 0, 1]);
  multicolor.textInstanceB = new Float32Array(8);
  multicolor.textInstanceC = Float32Array.from([0.25, 0.25, 0.25, 1, 1, 0, 0, 1]);
  multicolor.drawRuns = [multicolor.drawRuns[0], { kind: "text", first: 0, count: 2 }, multicolor.drawRuns[2]];
  const multicolorPlan = new VectorOrderedBatches(multicolor, null);
  multicolorPlan.update(multicolor.drawRuns, 0.1);
  assert.equal(multicolorPlan.batches.length, 3, "every glyph's color must match before a text run can commute");
  const quantized = structuredClone(monochrome);
  quantized.drawRuns = [quantized.drawRuns[0], quantized.drawRuns[3], quantized.drawRuns[2]];
  quantized.drawRuns.forEach(run => { delete run.clipIndex; });
  quantized.textInstanceA.set([10, 0, 0, 10]);
  quantized.textInstanceC.fill(0.501);
  for (let index = 0; index < 2; index++) quantized.styles.set([0.25, 0.501, 0.501, 0.501], index * 4);
  const quantizedPlan = new VectorOrderedBatches(quantized, null);
  quantizedPlan.update(quantized.drawRuns, 0.1);
  assert.equal(quantizedPlan.batches.length, 3, "matching source RGB cannot commute when byte text colors round differently from float strokes");
  const byteColor = Math.fround(128 / 255);
  for (let index = 0; index < 2; index++) quantized.styles.set([0.25, byteColor, byteColor, byteColor], index * 4);
  const matchingBytePlan = new VectorOrderedBatches(quantized, null);
  matchingBytePlan.update(quantized.drawRuns, 0.1);
  assert.equal(matchingBytePlan.batches.length, 2, "matching uploaded RGB permits text batching after byte quantization");
  const changedLod = { ...monochrome, styles: monochrome.styles.slice() };
  changedLod.styles[5] = 0.75;
  setStrokePaintOrigins(changedLod, Uint32Array.of(0, 1));
  const colorRuntime = { levels: [monochrome, changedLod].map((scene, index) => ({ scene, tolerance: index,
    segmentCount: 2, visibleSegmentIds: Uint32Array.of(0, 1), visibleSegmentCount: index ? 0 : 2 })) };
  const lodColorPlan = new VectorOrderedBatches(monochrome, colorRuntime);
  lodColorPlan.update(monochrome.drawRuns, 0.1);
  assert.equal(lodColorPlan.batches.length, 4, "dormant LOD colors must also agree before reusing a paint schedule");

  const longMonochrome = makePages(Array.from({ length: 256 }, () => 0));
  longMonochrome.pageRects = Float32Array.of(0, 0, 10, 10);
  longMonochrome.drawRuns = longMonochrome.drawRuns.filter(run => run.kind !== "raster" && run.kind !== "text");
  longMonochrome.fillPathMetaC = new Float32Array(256 * 4);
  for (let index = 0; index < 256; index++) {
    longMonochrome.fillPathMetaB.set([10, 10, 0.25, 0.25], index * 4);
    longMonochrome.fillPathMetaC.set([0, 0, 0.25, 0.4], index * 4);
    for (const stroke of [index * 2, index * 2 + 1]) longMonochrome.styles.set([0.25, 0.25, 0.25, 0.25], stroke * 4);
  }
  const longPlan = new VectorOrderedBatches(longMonochrome, null);
  longPlan.update(longMonochrome.drawRuns, 0.1);
  assert.equal(longPlan.batches.length, 2, "long equal-color spans batch in linear time without the overlap lookahead limit");
  assert.deepEqual(paints(longPlan).filter(paint => paint.startsWith("stroke:")),
    Array.from({ length: 512 }, (_, index) => `stroke:${index}:0`), "equal-color grouping retains canonical order within each kind");
  longPlan.setColorCommutationEnabled(false);
  longPlan.update(longMonochrome.drawRuns, 0.1);
  assert.equal(longPlan.batches.length, 513, "overrides restore the long span's original overlap dependencies");
  longPlan.setColorCommutationEnabled(true);
  longPlan.update(longMonochrome.drawRuns.filter((_, index) => index % 7 !== 0), 0.1);
  assert.equal(longPlan.batches.length, 2, "layer/culling subsets retain compact equal-color groups");

  // Dense drawings alternate overlapping local stroke/fill operations. Distant
  // clusters may commute even across OCGs, including past blocked same-kind
  // paints; exhausting a small search budget used to leave the tail unbatched.
  const dense = makePages(Array.from({ length: 512 }, (_, index) => index * 20));
  dense.pageRects = Float32Array.of(0, 0, 512 * 20, 10);
  dense.drawRuns = dense.drawRuns.filter(run => run.kind === "stroke" || run.kind === "fill");
  dense.fillPathMetaC = new Float32Array(512 * 4);
  for (let index = 0; index < 512; index++) {
    dense.fillPathMetaB.set([index * 20 + 10, 10, 1, 0], index * 4);
    dense.fillPathMetaC[index * 4 + 3] = 1;
  }
  dense.drawRuns.forEach((run, index) => { run.optionalContent = index % 7; });
  const denseSource = structuredClone(dense);
  const densePlan = new VectorOrderedBatches(dense, null);
  densePlan.update(dense.drawRuns);
  const denseOriginal = paints(densePlan);
  let denseSchedules = 0;
  const scheduleDense = densePlan.scheduler.schedulePaints.bind(densePlan.scheduler);
  densePlan.scheduler.schedulePaints = runs => { denseSchedules++; return scheduleDense(runs); };
  densePlan.update(dense.drawRuns, 0.1);
  assert(densePlan.batches.length <= 32, "batching continues throughout a dense interleaved drawing");
  assertOverlapOrder(densePlan, denseOriginal, dense);
  const denseTemplate = paints(densePlan);
  for (const selected of [dense.drawRuns.filter(run => run.optionalContent < 3),
    dense.drawRuns.slice(700, 1000), [], dense.drawRuns.slice(100, 400), dense.drawRuns]) {
    densePlan.update(selected, 0.1);
    const keys = new Set(selected.map(run => `${run.kind}:${run.first}:0`));
    assert.deepEqual(paints(densePlan), denseTemplate.filter(paint => keys.has(paint)),
      "large viewport/layer changes and reentry filter the complete valid schedule");
    assert.equal(denseSchedules, 1, "panning and layer toggles never repeat the dense scheduling search");
  }
  densePlan.update(dense.drawRuns, 0.2);
  assert.equal(denseSchedules, 2, "changed AA coverage invalidates the full-scene template");
  densePlan.setColorCommutationEnabled(false);
  densePlan.update(dense.drawRuns, 0.2);
  assert.equal(denseSchedules, 3, "primitive recoloring invalidates dense color equivalence");
  densePlan.setColorCommutationEnabled(true);
  densePlan.update(dense.drawRuns, 0.2);
  assert.equal(denseSchedules, 4, "clearing overrides rebuilds the original color schedule");
  densePlan.update(dense.drawRuns, null);
  assert.deepEqual(paints(densePlan), denseOriginal, "unknown projection scales retain canonical paint order");
  densePlan.update(dense.drawRuns, 0.1);
  assert.equal(denseSchedules, 5);
  assert.deepEqual(dense, denseSource, "render batching never changes source geometry, ranges, or layer membership");

  // Coverage margins are screen-space, so minifying grows them without bound in
  // page units until every paint fences every other one and the schedule costs
  // a draw call per source paint. Below a thumbnail the margin is held instead.
  const minified = pageGrid();
  const minifiedPlan = new VectorOrderedBatches(minified, null);
  minifiedPlan.update(minified.drawRuns, 1);
  const resolved = paints(minifiedPlan);
  assert.equal(minifiedPlan.paintOrderApproximated, false, "a page wider than a thumbnail keeps exact margins");
  let held = null;
  for (const scale of [16, 64, 128, 1024]) {
    minifiedPlan.update(minified.drawRuns, scale);
    assert(minifiedPlan.paintOrderApproximated, "a thumbnail-sized page holds its coverage margin");
    held ??= minifiedPlan.batches.length;
    assert.equal(minifiedPlan.batches.length, held, "minifying further cannot keep growing the draw count");
    assert(held < minified.drawRuns.length / 16, "a held margin keeps batching a minified dense page");
    assert.deepEqual(paints(minifiedPlan).slice().sort(), resolved.slice().sort(),
      "holding the margin reorders paints, and keeps every one of them and its clip root");
  }
  minifiedPlan.update(minified.drawRuns, 1);
  assert.equal(minifiedPlan.paintOrderApproximated, false, "zooming back in restores exact margins");
  assert.deepEqual(paints(minifiedPlan), resolved, "and with them the exact schedule");
  minifiedPlan.update(minified.drawRuns, null);
  assert.equal(minifiedPlan.paintOrderApproximated, false, "an unknown projection scale disables scheduling outright");
  // The same drawing on a page too large to reach thumbnail size keeps every
  // margin, and pays the per-paint draw calls the held margin above saves.
  const spread = pageGrid(64);
  const spreadPlan = new VectorOrderedBatches(spread, null);
  spreadPlan.update(spread.drawRuns, 64);
  assert.equal(spreadPlan.paintOrderApproximated, false);
  assert(spreadPlan.batches.length > held * 16, "exact margins fence a minified dense page into per-paint draws");

  // Exercise both production dispatchers, including disabling scheduling for
  // GL's arbitrary local-to-clip projection. These checks need no GPU/server.
  for (const Renderer of [WebGlFloorplanRenderer, WebGpuFloorplanRenderer]) {
    const renderer = Object.assign(Object.create(Renderer.prototype), {
      scene, orderedBatches: new VectorOrderedBatches(scene, null), zoom: 10,
      vectorLodLevels: [], vectorLodLevelResources: [], rasterRenderingEnabled: false,
      gl: { bindBuffer() {}, bufferData() {} }, gpuDevice: { queue: { writeBuffer() {} } }
    });
    renderer.drawPageBackgroundContentIntoPass = () => {};
    const draw = Renderer === WebGlFloorplanRenderer
      ? () => renderer.drawSourceOrderedContent(100, 100, 50, 50, 10)
      : () => renderer.drawSourceOrderedContentIntoPass({});
    draw();
    assert.equal(renderer.orderedBatches.batches.length, 7);
    if (Renderer === WebGlFloorplanRenderer) {
      renderer.localToClipRenderingEnabled = true;
      draw();
      assert.deepEqual(paints(renderer.orderedBatches), original);
    }
  }

  // Varied, deterministic paint streams exercise overlap dependencies that
  // do not follow page or primitive-ID order, including translucent paints.
  let seed = 711;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let trial = 0; trial < 40; trial++) {
    const varied = makePages(Array.from({ length: 12 }, () => Math.floor(random() * 6) * 20));
    varied.pageRects = Float32Array.from([0, 0, 120, 10]);
    for (let i = varied.drawRuns.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [varied.drawRuns[i], varied.drawRuns[j]] = [varied.drawRuns[j], varied.drawRuns[i]];
    }
    assertOverlappingPaints(varied);
  }
  console.log("Independent-page batching, overlap order, vector clips, and LOD bounds passed");

  function makePages(xs) {
    const scene = createEmptyVectorScene();
    scene.pageRects = Float32Array.from(xs.flatMap(x => [x, 0, x + 10, 10]));
    scene.segmentCount = xs.length * 2;
    scene.fillPathCount = scene.textInstanceCount = xs.length;
    scene.textGlyphCount = 1;
    scene.textGlyphMetaA = Float32Array.from([0, 0, 0, 0]);
    scene.textGlyphMetaB = Float32Array.from([1, 1, 0, 0]);
    scene.drawRuns = [];
    for (const key of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) scene[key] = new Float32Array(scene.segmentCount * 4);
    for (const key of ["fillPathMetaA", "fillPathMetaB", "textInstanceA", "textInstanceB"]) scene[key] = new Float32Array(xs.length * 4);
    xs.forEach((x, page) => {
      for (const id of [page * 2, page * 2 + 1]) {
        scene.endpoints.set([x + 1, 1, x + 9, 9], id * 4);
        scene.primitiveMeta.set([x + 9, 9, 0, 0.5], id * 4);
        scene.primitiveBounds.set([x, 0, x + 10, 10], id * 4);
        scene.styles[id * 4] = 0.25;
      }
      scene.fillPathMetaA.set([0, 0, x, 0], page * 4);
      scene.fillPathMetaB.set([x + 10, 10, 0, 0.5], page * 4);
      scene.textInstanceA.set([1, 0, 0, 1], page * 4);
      scene.textInstanceB.set([x, 0, 0, 0.5], page * 4);
      scene.rasterLayers.push({ matrix: Float32Array.from([10, 0, 0, 10, x, 0]) });
      scene.drawRuns.push({ kind: "stroke", first: page * 2, count: 1 },
        { kind: "fill", first: page, count: 1 }, { kind: "stroke", first: page * 2 + 1, count: 1 },
        { kind: "text", first: page, count: 1 }, { kind: "raster", first: page, count: 1 });
    });
    return scene;
  }
  /**
   * A page-sized grid of small stroke/fill/text clusters, one color per column
   * so neighbouring clusters never commute by color alone. `pageScale` stretches
   * only the page rectangle, leaving the drawing itself untouched.
   */
  function pageGrid(pageScale = 1, cols = 48, rows = 24, width = 3024, height = 2160) {
    const scene = createEmptyVectorScene();
    const count = cols * rows;
    scene.pageRects = Float32Array.of(0, 0, width * pageScale, height * pageScale);
    scene.segmentCount = scene.fillPathCount = scene.textInstanceCount = count;
    scene.textGlyphCount = 1;
    scene.textGlyphMetaA = Float32Array.of(0, 0, 0, 0);
    scene.textGlyphMetaB = Float32Array.of(1, 1, 0, 0);
    for (const key of ["endpoints", "primitiveMeta", "primitiveBounds", "styles",
      "fillPathMetaA", "fillPathMetaB", "fillPathMetaC", "textInstanceA", "textInstanceB", "textInstanceC"]) {
      scene[key] = new Float32Array(count * 4);
    }
    scene.drawRuns = [];
    for (let index = 0; index < count; index++) {
      const x = (index % cols) * (width / cols), y = Math.floor(index / cols) * (height / rows);
      const tint = (index % cols) / cols;
      scene.endpoints.set([x, y, x + 4, y + 4], index * 4);
      scene.primitiveMeta.set([x + 4, y + 4, 0, 0.5], index * 4);
      scene.primitiveBounds.set([x, y, x + 4, y + 4], index * 4);
      scene.styles.set([0.25, tint, 0, 0], index * 4);
      scene.fillPathMetaA.set([0, 4, x, y], index * 4);
      scene.fillPathMetaB.set([x + 4, y + 4, 1, 0], index * 4);
      scene.fillPathMetaC.set([0, 0, tint, 1], index * 4);
      scene.textInstanceA.set([4, 0, 0, 4], index * 4);
      scene.textInstanceB.set([x, y, 0, 0], index * 4);
      scene.textInstanceC.set([tint, 0, 0, 1], index * 4);
      scene.drawRuns.push({ kind: "stroke", first: index, count: 1 },
        { kind: "fill", first: index, count: 1 }, { kind: "text", first: index, count: 1 });
    }
    return scene;
  }
  function paints(plan) {
    return plan.batches.flatMap(run => Array.from({ length: run.count }, (_, i) => {
      const instance = (run.first + i) * 2;
      return `${run.kind}:${run.clipIndex === -2 ? plan.uintInstances[instance] : run.first + i}:${run.clipIndex === -2 ? plan.uintInstances[instance + 1] : (run.clipIndex ?? -1) + 1}`;
    }));
  }
  function pageOf(paint) {
    const [kind, id] = paint.split(":");
    return kind === "stroke" ? Math.floor(Number(id) / 2) : Number(id);
  }
  function assertPageOrder(plan, source, pages) {
    const matches = paint => pages.includes(pageOf(paint));
    // A proven redundant rectangle clip may be omitted from GPU instances.
    // Paint identity/order is unchanged; clip equivalence has its own suite.
    const identity = paint => paint.split(":").slice(0, 2).join(":");
    assert.deepEqual(paints(plan).filter(matches).map(identity), source.filter(matches).map(identity),
      "overlapping paints keep source order, including transparency and images");
  }
  function assertOverlappingPaints(scene) {
    const plan = new VectorOrderedBatches(scene, null);
    plan.update(scene.drawRuns);
    const original = paints(plan);
    plan.update(scene.drawRuns, 0.1);
    assertOverlapOrder(plan, original, scene);
    // Also exhaustively validate overlap dependencies after a cached removal.
    const hidden = Math.floor(scene.drawRuns.length / 2);
    const selected = scene.drawRuns.filter((_, index) => index !== hidden);
    plan.update(selected, 0.1);
    assertOverlapOrder(plan, original.filter((_, index) => index !== hidden), { ...scene, drawRuns: selected });
  }
  function assertOverlapOrder(plan, original, scene, culler = new VectorDrawRunCuller(scene)) {
    const actual = paints(plan);
    assert.deepEqual(actual.slice().sort(), original.slice().sort(), "every paint appears exactly once");
    const boxes = scene.drawRuns.map((_, index) => {
      const box = [];
      culler.getBounds(index, 0.5, box);
      return box;
    });
    // Exhaustively check every dependency, independently of the bounded
    // scheduling search. These fixtures have one primitive per source run.
    for (let first = 0; first < original.length; first++) {
      for (let second = first + 1; second < original.length; second++) {
        const a = boxes[first], b = boxes[second];
        if (a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]) continue;
        assert(actual.indexOf(original[first]) < actual.indexOf(original[second]),
          `overlapping paints must keep source order: ${original[first]}, ${original[second]}`);
      }
    }
  }
  function rectangle(x0, y0, x1, y1, parent = -1) {
    return { parent, fillRule: 0, edges: Float32Array.from([x0, y0, x1, y0, x1, y0, x1, y1, x1, y1, x0, y1, x0, y1, x0, y0]) };
  }
} finally { hooks.deregister(); }
