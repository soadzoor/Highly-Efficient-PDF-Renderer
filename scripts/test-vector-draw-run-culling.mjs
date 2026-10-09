import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c);
} });
try {
  const { VectorDrawRunCuller, vectorViewBounds } = await import("../src/vectorDrawRunCulling.ts");
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { VectorOrderedBatches } = await import("../src/vectorOrderedBatches.ts");
  const { VectorStrokeLodRuntime, buildRuntimeTileBuckets, storePrebuiltVectorStrokeLodRuntime } = await import("../src/vectorStrokeLodCore.ts");
  const { strokePaintOrigins, setStrokePaintOrigins } = await import("../src/vectorStrokePaintOrder.ts");
  const scene = fixture();
  const culler = new VectorDrawRunCuller(scene);
  const view = { minX: -2, minY: -2, maxX: 12, maxY: 12 };
  assert.deepEqual([...culler.select(view, 0.01)], [scene.drawRuns[0], scene.drawRuns[2], scene.drawRuns[4]]);
  // Callers that address runs by index read the same decision off the flags.
  assert.deepEqual([...culler.selected], [1, 0, 1, 0, 1]);
  assert.equal(culler.select(null, 1), scene.drawRuns, "unknown perspective bounds retain all paints");
  assert.equal(culler.selected, null, "retaining every paint needs no per-run index test");
  assert.deepEqual([...culler.select({ minX: 90, minY: 90, maxX: 112, maxY: 112 }, 0.01)], [scene.drawRuns[1], scene.drawRuns[3]]);
  assert.deepEqual([...culler.selected], [0, 1, 0, 1, 0]);
  const overview = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };
  assert.equal(culler.select(overview, 0.01), scene.drawRuns, "full visibility returns the immutable source list");
  assert.equal(culler.selected, null);
  const visible = culler.visible;
  culler.visible = Object.freeze([]);
  assert.equal(culler.select({ ...overview, minX: -999 }, 0.01), scene.drawRuns);
  culler.visible = visible;
  assert.deepEqual([...culler.select(view, 0.01)], [scene.drawRuns[0], scene.drawRuns[2], scene.drawRuns[4]],
    "panning into a detail resumes per-run culling");
  const wide = { ...scene, drawRuns: [scene.drawRuns[0]], styles: Float32Array.of(50, 0, 0, 0, 1, 0, 0, 0) };
  assert.equal(new VectorDrawRunCuller(wide).select({ minX: 4, minY: 45, maxX: 6, maxY: 46 }, 0.01).length, 1,
    "wide strokes stay visible when their centerline is offscreen");
  const hairline = { ...wide, styles: new Float32Array(8) };
  const hairlineCuller = new VectorDrawRunCuller(hairline);
  assert.equal(hairlineCuller.select({ minX: 4, minY: 1, maxX: 6, maxY: 2 }, 1).length, 1);
  assert.equal(hairlineCuller.select({ minX: 4, minY: 1, maxX: 6, maxY: 2 }, 0.01).length, 0);
  const emptyClip = { ...scene, drawRuns: [{ ...scene.drawRuns[0], clipIndex: 0 }],
    clipPaths: [{ parent: -1, fillRule: 0, edges: new Float32Array() }] };
  assert.equal(new VectorDrawRunCuller(emptyClip).select(view, 1).length, 0);
  assert.equal(new VectorDrawRunCuller(emptyClip).select(overview, 1).length, 0,
    "full-scene reuse must not restore empty clipped paints");
  const mixedClip = { ...scene, drawRuns: [scene.drawRuns[0], { ...scene.drawRuns[1], clipIndex: 0 }],
    clipPaths: emptyClip.clipPaths };
  const mixedCuller = new VectorDrawRunCuller(mixedClip);
  const mixedOverview = mixedCuller.select(overview, 0.2);
  assert.deepEqual([...mixedOverview], [mixedClip.drawRuns[0]]);
  assert.deepEqual([...mixedCuller.selected], [1, 0]);
  const getBounds = mixedCuller.getBounds.bind(mixedCuller);
  let boundsVisits = 0;
  mixedCuller.getBounds = (...args) => { boundsVisits++; return getBounds(...args); };
  const mixedDetailResult = mixedCuller.visible;
  mixedCuller.visible = Object.freeze([]);
  assert.equal(mixedCuller.select(overview, 0.24), mixedOverview,
    "zooming inside a conservative padding bucket reuses the overview excluding empty clips");
  assert.equal(boundsVisits, 0, "animated zoom does not rebuild every paint bound");
  assert.deepEqual([...mixedCuller.selected], [1, 0]);
  mixedCuller.visible = mixedDetailResult;
  assert.equal(mixedCuller.select({ minX: 900, minY: 900, maxX: 910, maxY: 910 }, 0.22).length, 0);
  assert.deepEqual([...mixedCuller.selected], [0, 0]);
  assert.equal(mixedCuller.select(overview, 0.23), mixedOverview);
  assert.deepEqual([...mixedCuller.selected], [1, 0],
    "detail culling cannot overwrite the cached overview membership");
  assert.deepEqual([...mixedCuller.select(overview, 0.26)], [mixedClip.drawRuns[0]]);
  assert.equal(boundsVisits, 2, "a larger padding bucket recomputes both paint bounds");

  const nearClip = { ...hairline, drawRuns: [{ ...hairline.drawRuns[0], clipIndex: 0 }],
    clipPaths: [{ parent: -1, fillRule: 0, edges: Float32Array.of(0,2,10,2,10,3,0,3) }] };
  const nearClipCuller = new VectorDrawRunCuller(nearClip);
  assert.equal(nearClipCuller.select(overview, 0.1).length, 0);
  assert.equal(nearClipCuller.select(overview, 1).length, 1,
    "a larger screen-space margin may restore a hairline previously outside its clip");
  assert.equal(nearClipCuller.selected, null);
  assert.equal(nearClipCuller.select(overview, 0.1).length, 0,
    "zooming back refreshes the nonempty overview list too");
  assert.deepEqual(vectorViewBounds(20, 40, 5, 6, 2), { minX: 0, minY: -4, maxX: 10, maxY: 16 });

  // A merged line belongs to its first paint, but reaches through many later
  // singleton paints. Panning onto its far end must retain that first paint
  // even after its canonical source segment has left the viewport.
  const count = 512;
  const merged = { ...createEmptyVectorScene(), segmentCount: count, maxHalfWidth: .5,
    bounds: { minX: 0, minY: -1, maxX: count * 20, maxY: 1 },
    drawRuns: Array.from({ length: count }, (_, first) => ({ kind: "stroke", first, count: 1 })) };
  for (const field of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) merged[field] = new Float32Array(count * 4);
  for (let id = 0; id < count; id++) {
    const x0 = id * 20, x1 = x0 + 20;
    merged.endpoints.set([x0, 0, x1, 0], id * 4);
    merged.primitiveMeta.set([x1, 0, 0, 1], id * 4);
    merged.primitiveBounds.set([x0, 0, x1, 0], id * 4);
    merged.styles.set([.5, 0, 0, 0], id * 4);
  }
  merged.paintGraph = { roots: merged.drawRuns.map((_run, runIndex) => ({ kind: "group", alpha: 1,
    isolated: true, knockout: false, blendMode: "Darken", children: [{ kind: "draw", runIndex }] })) };
  const coarseScene = { ...merged, segmentCount: 1, endpoints: Float32Array.of(0, 0, 640, 0),
    primitiveMeta: Float32Array.of(640, 0, 0, 1), primitiveBounds: Float32Array.of(0, 0, 640, 0),
    styles: Float32Array.of(.5, 0, 0, 0) };
  setStrokePaintOrigins(coarseScene, Uint32Array.of(0));
  const grid = { columns: 1, rows: 1, ...merged.bounds, tileWidth: count * 20, tileHeight: 2,
    xEdges: Float64Array.of(0, count * 20), yEdges: Float64Array.of(-1, 1) };
  const mergedRuntime = new VectorStrokeLodRuntime(merged, { tileGrid: grid, elapsedMs: 0,
    levels: [{ scene: merged, segmentCount: count, tolerance: 0, ...buildRuntimeTileBuckets(merged, grid) },
      { scene: coarseScene, segmentCount: 1, tolerance: 1, overview: true, ...buildRuntimeTileBuckets(coarseScene, grid) }] });
  const coarse = mergedRuntime.levels.at(-1);
  assert(coarse.tolerance > 0 && coarse.segmentCount < count);
  const origin = strokePaintOrigins(coarse.scene)[0], paint = merged.drawRuns[origin];
  const farX = coarse.scene.primitiveMeta[0] - 1;
  const farView = { minX: farX, minY: -.25, maxX: farX + 1, maxY: .25 };
  const mergedPlan = new VectorOrderedBatches(merged, mergedRuntime);
  const canonicalCuller = new VectorDrawRunCuller(merged);
  assert(!canonicalCuller.select(farView, .01, mergedPlan.cullingPadding).includes(paint),
    "the far-end fixture lies beyond the original paint and the LOD tolerance margin");
  const mergedCuller = mergedPlan.createRunCuller();
  assert(mergedCuller.select({ minX: 0, minY: -.25, maxX: 1, maxY: .25 }, .01,
    mergedPlan.cullingPadding).includes(paint), "the merged paint starts visible at its canonical origin");
  assert(mergedCuller.select(farView, .01, mergedPlan.cullingPadding).includes(paint),
    "paint culling includes every dormant LOD representative's actual reach");
  for (const level of mergedRuntime.levels) level.visibleSegmentCount = level === coarse ? 1 : 0;
  coarse.visibleSegmentIds[0] = 0;
  mergedPlan.update(mergedCuller.select(farView, .01, mergedPlan.cullingPadding), .01);
  assert.equal(mergedPlan.instanceCount, 1, "panning onto the merged line's far end still submits its selected representative");
  const outside = { minX: merged.bounds.maxX + 1000, minY: 0, maxX: merged.bounds.maxX + 1010, maxY: 1 };
  assert.equal(mergedCuller.select(outside, .01, mergedPlan.cullingPadding).length, 0,
    "expanded paint bounds still cull views outside all source and derived geometry");

  // Both production LOD rebuild paths install these bounds, and disabling LOD
  // restores the smaller canonical paint extents without changing origins.
  const usageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "GPUBufferUsage");
  Object.defineProperty(globalThis, "GPUBufferUsage", { configurable: true, value: { STORAGE: 1, COPY_DST: 2 } });
  try {
    for (const Renderer of [WebGlFloorplanRenderer, WebGpuFloorplanRenderer]) {
      const renderer = Object.create(Renderer.prototype);
      Object.assign(renderer, { scene: merged, vectorLodMode: "force", orderedInstanceBuffer: { destroy() {} },
        gpuDevice: { createBuffer: () => ({ destroy() {} }) },
        uploadSegments() {}, uploadVectorLodLevels() {}, uploadVectorClips() {}, destroyVectorLodResources() {} });
      const rebuild = Renderer === WebGlFloorplanRenderer ? "rebuildVectorLod" : "prepareVectorLod";
      storePrebuiltVectorStrokeLodRuntime(merged, mergedRuntime);
      assert(renderer[rebuild](merged));
      assert(renderer.orderedRunCuller.select(farView, .01, renderer.orderedBatches.cullingPadding).includes(paint),
        `${Renderer.name} uses derived geometry when culling canonical paints`);
      renderer.vectorLodMode = "off";
      assert.equal(renderer[rebuild](merged), false);
      assert(!renderer.orderedRunCuller.select(farView, .01).includes(paint),
        `${Renderer.name} restores canonical culling with Vector LOD off`);
    }
  } finally {
    if (usageDescriptor) Object.defineProperty(globalThis, "GPUBufferUsage", usageDescriptor);
    else delete globalThis.GPUBufferUsage;
  }

  // Production submission paths use the filtered list, in its original order.
  const gl = Object.create(WebGlFloorplanRenderer.prototype);
  const gpu = Object.create(WebGpuFloorplanRenderer.prototype);
  const flags = { scene, orderedRunCuller: culler, orderedCullingBounds: view, zoom: 1,
    fillRenderingEnabled: true, strokeRenderingEnabled: true, textRenderingEnabled: true, rasterRenderingEnabled: true };
  Object.assign(gl, flags); Object.assign(gpu, flags);
  const calls = [];
  gl.drawPageBackgrounds = () => {};
  gl.drawVisibleSegments = (_w, _h, _x, _y, _z, range) => { calls.push(["stroke", range.start]); return range.count; };
  gl.drawTextInstances = (_w, _h, _x, _y, _z, _lod, range) => calls.push(["text", range.start]);
  gl.drawFilledPaths = (_w, _h, _x, _y, _z, first) => calls.push(["fill", first]);
  gl.drawRasterLayerAtIndex = index => calls.push(["raster", index]);
  gl.drawSourceOrderedContent(14, 14, 5, 5, 1);
  assert.deepEqual(calls, [["stroke", 0], ["fill", 0], ["text", 0]]);
  assert.equal(gl.orderedRunsCulled, true);
  calls.length = 0;
  Object.assign(gpu, { fillPipeline: "fill", strokePipeline: "stroke", textPipeline: "text", rasterPipeline: "raster",
    fillBindGroup: {}, strokeBindGroupAll: {}, textBindGroup: {}, vectorClipBindGroups: [{}], rasterLayerResources: [{}] });
  gpu.drawPageBackgroundContentIntoPass = () => {};
  let pipeline;
  gpu.drawSourceOrderedContentIntoPass({ setPipeline(p) { pipeline = p; }, setBindGroup() {},
    draw(_vertices, _count, _firstVertex, first) { calls.push([pipeline, first]); } });
  assert.deepEqual(calls, [["stroke", 0], ["fill", 0], ["text", 0]]);

  console.log("Ordered draw culling preserves visible paints and native submission order");
} finally { hooks.deregister(); }

function fixture() {
  return { pageCount: 2, segmentCount: 2, fillPathCount: 1, textInstanceCount: 1,
    drawRuns: [{ kind: "stroke", first: 0, count: 1 }, { kind: "stroke", first: 1, count: 1 },
      { kind: "fill", first: 0, count: 1 }, { kind: "raster", first: 0, count: 1 }, { kind: "text", first: 0, count: 1 }],
    endpoints: Float32Array.of(0, 0, 10, 0, 100, 100, 110, 100),
    primitiveMeta: Float32Array.of(10, 0, 0, 1, 110, 100, 0, 1), styles: Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0),
    fillPathMetaA: Float32Array.of(0, 4, 0, 0), fillPathMetaB: Float32Array.of(10, 10, 0, 0),
    textInstanceA: Float32Array.of(0, 1, -1, 0), textInstanceB: Float32Array.of(10, 0, 0, 0),
    textGlyphMetaA: Float32Array.of(0, 4, 0, 0), textGlyphMetaB: Float32Array.of(10, 10, 0, 0),
    rasterLayers: [{ matrix: Float32Array.of(10, 0, 0, 10, 100, 100) }] };
}
