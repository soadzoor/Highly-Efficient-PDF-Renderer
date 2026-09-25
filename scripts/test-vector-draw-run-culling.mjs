import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c);
} });
try {
  const { VectorDrawRunCuller, vectorViewBounds } = await import("../src/vectorDrawRunCulling.ts");
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");
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
