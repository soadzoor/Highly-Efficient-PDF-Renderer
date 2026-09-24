import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { VectorOrderedBatches } = await import("../src/vectorOrderedBatches.ts");
  const { strokePaintOrigins } = await import("../src/vectorStrokePaintOrder.ts");
  const { VectorStrokeLodRuntime, prebuildVectorStrokeLodRuntime, buildVectorStrokeLodScenes } = await import("../src/vectorStrokeLodCore.ts");
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");

  const scene = makeScene(60);
  scene.fillPathCount = 1;
  scene.textInstanceCount = 1;
  scene.drawRuns = [
    { kind: "stroke", first: 20, count: 20, clipIndex: 0 },
    { kind: "stroke", first: 0, count: 20, clipIndex: 1 },
    { kind: "fill", first: 0, count: 1 },
    { kind: "stroke", first: 40, count: 20, clipIndex: 0 },
    { kind: "text", first: 0, count: 1 }
  ];
  // Nearly coincident strokes in different paints must remain independently clipped
  // and retain their order relative to the intervening opaque fill.
  const levels = buildVectorStrokeLodScenes(scene);
  assert(levels.length > 1);
  assert.equal(levels[1].scene.segmentCount, 3);
  assert.deepEqual([...strokePaintOrigins(levels[1].scene)].sort((a, b) => a - b), [0, 20, 40]);
  const asyncLod = await prebuildVectorStrokeLodRuntime(scene, "force", "webgl");
  assert.deepEqual([...strokePaintOrigins(asyncLod.levels[1].scene)], [...strokePaintOrigins(levels[1].scene)]);

  const exact = new VectorOrderedBatches(scene, null);
  assert(exact.update(scene.drawRuns));
  assert.equal(exact.batches.length, 4, "adjacent strokes with different clips share a draw");
  assert.deepEqual([...exact.uintInstances.slice(0, 4)], [20, 1, 21, 1]);
  assert.deepEqual([...exact.uintInstances.slice(40, 44)], [0, 2, 1, 2]);
  assert.equal(exact.update(scene.drawRuns), false, "stationary frames reuse the uploaded draw list");
  assert(exact.update([scene.drawRuns[1], ...scene.drawRuns.slice(2)]), "culling rebuilds the draw list");
  assert.deepEqual([...exact.uintInstances.slice(0, 2)], [0, 2]);

  // Mix exact and simplified tiles, with deliberately shuffled tile order.
  for (const level of asyncLod.levels) level.visibleSegmentCount = 0;
  asyncLod.levels[0].visibleSegmentIds.set([40, 0, 20]);
  asyncLod.levels[0].visibleSegmentCount = 3;
  asyncLod.levels[1].visibleSegmentIds.set([2, 0, 1]);
  asyncLod.levels[1].visibleSegmentCount = 3;
  const mixed = new VectorOrderedBatches(scene, asyncLod);
  mixed.update(scene.drawRuns);
  mixed.invalidate();
  assert.equal(mixed.update(scene.drawRuns), false, "camera motion with the same tile selection reuses instance data");
  assert.equal(mixed.batches.length, 4, "LOD texture changes do not split draws");
  const origins = [...strokePaintOrigins(scene), ...asyncLod.levels.slice(1).flatMap(l => [...strokePaintOrigins(l.scene)])];
  const paintedOrigins = mixed.batches.filter(b => b.kind === "stroke").map(batch =>
    Array.from({ length: batch.count }, (_, i) => origins[mixed.uintInstances[(batch.first + i) * 2]]));
  assert.deepEqual(paintedOrigins, [[20, 20, 0, 0], [40, 40]]);
  assert.deepEqual(mixed.strokeScene.endpoints.slice(60 * 4, 63 * 4), levels[1].scene.endpoints);

  // Static paint ranks must never be comparison-sorted during selection.
  // Equal counts alone are insufficient: a different ID needs a new upload.
  const cacheScene = makeScene(4);
  cacheScene.drawRuns = [{ kind: "stroke", first: 0, count: 4 }];
  const cacheLevel = { scene: cacheScene, segmentCount: 4, tolerance: 0,
    visibleSegmentCount: 2, visibleSegmentIds: Uint32Array.from([2, 0, 0, 0]) };
  const cached = new VectorOrderedBatches(cacheScene, { levels: [cacheLevel] });
  let sorts = 0;
  const subarray = cached.selectedRanks.subarray.bind(cached.selectedRanks);
  cached.selectedRanks.subarray = (...args) => {
    const array = subarray(...args), sort = array.sort.bind(array);
    array.sort = (...args) => { sorts++; return sort(...args); };
    return array;
  };
  assert(cached.update(cacheScene.drawRuns));
  assert.equal(sorts, 0);
  cached.invalidate();
  assert.equal(cached.update(cacheScene.drawRuns), false);
  assert.equal(sorts, 0, "unchanged camera selections reuse static paint ranks");
  cacheLevel.visibleSegmentIds.set([0, 2]);
  cached.invalidate();
  assert.equal(cached.update(cacheScene.drawRuns), false, "a different tile traversal with the same paint IDs needs no upload");
  assert.equal(sorts, 0, "changing tile traversal filters the precomputed order without sorting");
  cached.invalidate();
  assert.equal(cached.update(cacheScene.drawRuns), false);
  assert.equal(sorts, 0, "the new tile traversal is cached too");
  cacheLevel.visibleSegmentIds.set([0, 3]);
  cached.invalidate();
  assert(cached.update(cacheScene.drawRuns));
  assert.deepEqual([...cached.uintInstances.slice(0, 4)], [0, 0, 3, 0]);
  cacheLevel.visibleSegmentCount = 1;
  cached.invalidate();
  assert(cached.update(cacheScene.drawRuns));
  assert.equal(cached.instanceCount, 1);
  assert.equal(sorts, 0);

  const boundaryScene = makeScene(1056);
  boundaryScene.drawRuns = [{ kind: "stroke", first: 0, count: 1056 }];
  const boundaryLevel = { scene: boundaryScene, segmentCount: 1056, tolerance: 0,
    visibleSegmentCount: 8, visibleSegmentIds: Uint32Array.from([1055, 1023, 1024, 63, 32, 31, 0, 63]) };
  const boundaryPlan = new VectorOrderedBatches(boundaryScene, { levels: [boundaryLevel] });
  boundaryPlan.update(boundaryScene.drawRuns);
  assert.equal(boundaryPlan.instanceCount, 7);
  assert.deepEqual(Array.from({ length: 7 }, (_, i) => boundaryPlan.uintInstances[i * 2]), [0, 31, 32, 63, 1023, 1024, 1055],
    "selection bits retain order across word boundaries and suppress duplicate tile IDs");
  boundaryLevel.visibleSegmentCount = 0;
  boundaryPlan.invalidate();
  boundaryPlan.update(boundaryScene.drawRuns);
  assert.equal(boundaryPlan.instanceCount, 0, "empty selection leaves no stale rank bits");
  boundaryPlan.invalidate();
  assert.equal(boundaryPlan.update(boundaryScene.drawRuns), false, "selection caches compare active length, not buffer capacity");

  // A red/blue/red stroke run cannot merge its two red paints through blue.
  const colors = makeScene(60);
  colors.drawRuns = [{ kind: "stroke", first: 0, count: 60 }];
  for (let i = 0; i < 60; i++) colors.styles.set([0.5, i < 20 || i >= 40 ? 1 : 0, 0, i >= 20 && i < 40 ? 1 : 0], i * 4);
  assert.equal(buildVectorStrokeLodScenes(colors)[1].scene.segmentCount, 3);

  // Large synthetic drawing: target the overview budget, restore exact local detail.
  const dense = makeScene(160_000, true);
  dense.drawRuns = [{ kind: "stroke", first: 0, count: dense.segmentCount }];
  const lod = new VectorStrokeLodRuntime(dense);
  lod.setScreenSpaceTransform();
  lod.updateForLocalUnitsPerPixel(10);
  lod.update({ cameraCenterX: 500, cameraCenterY: 500, zoom: 0.1 }, { width: 1000, height: 1000 });
  assert(lod.getRenderedSegmentCount() > 0 && lod.getRenderedSegmentCount() < 65_000);
  const overviewIds = lod.levels.map(level => level.visibleSegmentIds.slice(0, level.visibleSegmentCount));
  const overviewMarks = lod.levels.map(level => level.markToken);
  const overviewStats = lod.getStats();
  const overview = { cameraCenterX: 510, cameraCenterY: 490, zoom: 0.1 }, viewport = { width: 1000, height: 1000 };
  assert.equal(lod.update(overview, viewport), false, "a fully visible planar scene reuses LOD selection during pan");
  assert.deepEqual(lod.getStats(), overviewStats);
  assert.deepEqual(lod.levels.map(level => level.markToken), overviewMarks, "reused selection never scans tile primitives");
  assert.deepEqual(lod.levels.map(level => level.visibleSegmentIds.slice(0, level.visibleSegmentCount)), overviewIds);
  lod.updateForLocalUnitsPerPixel(11);
  assert.equal(lod.update({ ...overview, zoom: 1 / 11 }, viewport), false, "zoom within the same LOD budget reuses selection");
  lod.updateForLocalUnitsPerPixel(0.01);
  assert(lod.update(overview, viewport), "a changed LOD budget refreshes selection even while everything is visible");
  assert.equal(lod.getStats().baselineLevelIndex, 0);
  lod.updateForLocalUnitsPerPixel(10);
  assert(lod.update(overview, viewport));
  lod.resetVisible();
  assert.equal(lod.getRenderedSegmentCount(), 0);
  assert(lod.update(overview, viewport), "reset invalidates overview selection");
  assert(lod.update(overview, viewport, { minX: 0, minY: 0, maxX: 10, maxY: 10 }), "explicit culling bounds invalidate overview selection");
  assert(lod.update(overview, viewport));
  lod.setLocalToClipTransform([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 10);
  assert(lod.update(overview, viewport));
  assert(lod.update(overview, viewport), "arbitrary projections continue evaluating their tile budgets");
  lod.setScreenSpaceTransform();

  const outlierLevels = lod.levels.map(level => ({ ...level, visibleSegmentIds: level.visibleSegmentIds.slice(),
    segmentMarks: level.segmentMarks.slice(), segmentMaxX: level.segmentMaxX.slice() }));
  outlierLevels[1].segmentMaxX[0] = 1_000_000;
  const outlierRuntime = new VectorStrokeLodRuntime(dense, { tileGrid: lod.tileGrid, levels: outlierLevels, elapsedMs: 0 });
  outlierRuntime.updateForLocalUnitsPerPixel(10);
  assert(outlierRuntime.update(overview, viewport));
  assert.equal(outlierRuntime.fullViewBaselineLevelIndex, -1,
    "bounds from every LOD level still prevent the unbounded full-overview shortcut");
  assert.equal(outlierRuntime.update(overview, viewport), false,
    "an unchanged partial view may reuse its bounded visibility guard");

  lod.updateForLocalUnitsPerPixel(0.01);
  lod.update({ cameraCenterX: 500, cameraCenterY: 500, zoom: 100 }, { width: 1000, height: 1000 });
  assert(lod.getStats().activeLevels.every(level => level.index === 0), "deep zoom restores exact strokes");

  for (const Renderer of [WebGlFloorplanRenderer, WebGpuFloorplanRenderer]) {
    let updated = false, invalidations = 0;
    const renderer = Object.assign(Object.create(Renderer.prototype), { scene: dense,
      orderedBatches: { invalidate() { invalidations++; } }, vectorLodRuntime: {
        setScreenSpaceTransform() {}, updateForLocalUnitsPerPixel() {}, update() { return updated; },
        getStats() { return { renderedSegments: 3 }; }
      } });
    const update = Renderer === WebGlFloorplanRenderer
      ? () => renderer.updateVectorLodVisibleSet(overview, viewport, null, 10)
      : () => renderer.updateVectorLodVisibleSet(510, 490, 1000, 1000, 0.1);
    update();
    assert.equal(invalidations, 0, "native renderers retain the uploaded batches when selection is reused");
    updated = true; update();
    assert.equal(invalidations, 1);
    assert.equal(renderer.visibleSegmentCount, 3);
  }

  // Exercise actual GL instance offsets and both native batch dispatchers.
  const low = Object.create(WebGlFloorplanRenderer.prototype);
  const pointers = [], bound = [];
  low.gl = new Proxy({ bindBuffer: (_target, buffer) => bound.push(buffer),
    vertexAttribPointer: (...args) => pointers.push(args) }, { get: (o, k) => o[k] ?? (() => {}) });
  low.vectorClipIndex = -2; low.orderedInstanceBuffer = "instances";
  for (const location of [1, 2, 3]) low.bindOrderedInstanceAttribute(location, 5);
  assert.deepEqual(pointers.map(p => [p[0], p[4], p[5]]), [[1, 8, 40], [4, 8, 44], [2, 8, 40], [4, 8, 44], [3, 8, 40], [4, 8, 44]]);
  assert(bound.every(b => b === "instances"));
  const flags = { scene, orderedBatches: mixed, vectorLodLevels: [{ texture: "combined" }],
    vectorLodLevelResources: [{ bindGroup: "combined" }], fillRenderingEnabled: true,
    strokeRenderingEnabled: true, textRenderingEnabled: true, rasterRenderingEnabled: false };
  const gl = Object.assign(Object.create(WebGlFloorplanRenderer.prototype), flags);
  const calls = [];
  gl.drawStrokeInstances = (store, _buffer, count, _w, _h, _x, _y, _z, first) => {
    assert.equal(store.texture, "combined"); calls.push(["stroke", first, count]);
  };
  gl.drawFilledPaths = (_w, _h, _x, _y, _z, first, count) => calls.push(["fill", first, count]);
  gl.drawTextInstances = (_w, _h, _x, _y, _z, _lod, range) => calls.push(["text", range.start, range.count]);
  assert.equal(gl.drawSourceOrderedContent(100, 100, 50, 50, 1), 6);
  const expected = mixed.batches.map(b => [b.kind, b.first, b.count]);
  assert.deepEqual(calls, expected);
  const gpu = Object.assign(Object.create(WebGpuFloorplanRenderer.prototype), flags, {
    fillPipeline: "fill", strokePipeline: "stroke", textPipeline: "text", fillBindGroup: "fill",
    strokeBindGroupAll: "exact", textBindGroup: "text", vectorClipBindGroups: ["instances", "none"]
  });
  gpu.drawPageBackgroundContentIntoPass = () => {};
  calls.length = 0;
  let pipeline;
  assert.equal(gpu.drawSourceOrderedContentIntoPass({ setPipeline(p) { pipeline = p; },
    setBindGroup(group, value) { assert.equal(value, group === 1 ? "instances" : pipeline === "stroke" ? "combined" : pipeline); },
    draw(_vertices, count, _firstVertex, first) { calls.push([pipeline, first, count]); }
  }), 6);
  assert.deepEqual(calls, expected);

  // Visibility-only paint graphs retain the same native instancing fast path.
  // The view owns its visibility plan; canonical draw runs and geometry stay intact.
  const layerScene = makeScene(4);
  layerScene.drawRuns = [
    { kind: "stroke", first: 0, count: 2, optionalContent: 0 },
    { kind: "stroke", first: 2, count: 2, optionalContent: 1 }
  ];
  layerScene.optionalContent = {
    groups: ["a", "b"].map(id => ({ id, name: id, defaultVisible: true, locked: false, usedInView: true })),
    conditions: [{ kind: "group", groupId: "a" }, { kind: "group", groupId: "b" }], order: [], radioGroups: []
  };
  layerScene.paintGraph = { roots: [{ kind: "group", alpha: 1, isolated: false, knockout: false,
    blendMode: "Normal", optionalContent: 0, children: [{ kind: "draw", runIndex: 0 }, { kind: "draw", runIndex: 1 }] }] };
  const originalRuns = structuredClone(layerScene.drawRuns);
  for (const Renderer of [WebGlFloorplanRenderer, WebGpuFloorplanRenderer]) {
    const plan = new VectorOrderedBatches(layerScene, null);
    const draws = [], uploads = [];
    const instance = Object.assign(Object.create(Renderer.prototype), {
      scene: layerScene, orderedBatches: plan, zoom: 1,
      optionalContentVisibility: { revision: 0, conditions: Uint8Array.of(1, 1), layers: [] },
      vectorLodLevels: [], vectorLodLevelResources: [], orderedTextureBindings: [],
      strokeRenderingEnabled: true, fillRenderingEnabled: false, textRenderingEnabled: false, rasterRenderingEnabled: false,
      strokePipeline: "stroke", strokeBindGroupAll: "exact", vectorClipBindGroups: ["instances", "none"],
      gl: { bindBuffer() {}, bufferData(_target, data) { uploads.push([...data]); } },
      gpuDevice: { queue: { writeBuffer(_buffer, _offset, data) { uploads.push([...data]); } } },
      drawPageBackgroundContentIntoPass() {},
      drawVisibleSegments(_w, _h, _x, _y, _zoom, range) { draws.push(range.count); return range.count; },
      destroyVectorMinifyResources() {}, requestFrame() {}
    });
    const pass = { setPipeline() {}, setBindGroup() {}, draw(_vertices, count) { draws.push(count); } };
    const render = () => Renderer === WebGlFloorplanRenderer
      ? instance.drawSourceOrderedContent(100, 100, 50, 50, 1) : instance.drawSourceOrderedContentIntoPass(pass);
    assert.equal(render(), 4);
    assert.deepEqual(draws, [4], "a passthrough graph batches separately conditioned strokes in one draw");
    assert.equal(uploads.length, 1);
    assert.equal(instance.paintCompositor, undefined, "layer-only graphs allocate no composite surfaces");
    draws.length = 0;
    assert.equal(render(), 4);
    assert.equal(uploads.length, 1, "unchanged layer visibility reuses the instance upload");
    instance.setOptionalContentVisibility({ revision: 1, conditions: Uint8Array.of(1, 0), layers: [] });
    draws.length = 0;
    assert.equal(render(), 2);
    assert.deepEqual(draws, [2]);
    assert.equal(uploads.length, 2, "a committed layer change refreshes its native instance data once");
    assert.deepEqual([...plan.uintInstances.subarray(0, 4)], [0, 0, 1, 0]);
    instance.setOptionalContentVisibility({ revision: 2, conditions: Uint8Array.of(0, 1), layers: [] });
    draws.length = 0;
    assert.equal(render(), 0, "hidden enclosing groups suppress their children");
    assert.deepEqual(draws, []);
    assert.deepEqual(layerScene.drawRuns, originalRuns, "render-time batching preserves canonical layer associations");
  }

  // Render-time redundancy restores canonical IDs when a cover stops painting.
  const redundantScene = makeScene(2);
  redundantScene.endpoints.set([5, 0, 15, 0], 4);
  redundantScene.primitiveMeta.set([15, 0, 0, 1], 4);
  redundantScene.primitiveBounds.set([5, 0, 15, 0], 4);
  redundantScene.drawRuns = [
    { kind: "stroke", first: 0, count: 1, optionalContent: 0 },
    { kind: "stroke", first: 1, count: 1, optionalContent: 1 }
  ];
  redundantScene.optionalContent = structuredClone(layerScene.optionalContent);
  const canonical = structuredClone(redundantScene);
  for (const Renderer of [WebGlFloorplanRenderer, WebGpuFloorplanRenderer]) {
    const plan = new VectorOrderedBatches(redundantScene, null);
    const uploads = [], counts = [];
    const instance = Object.assign(Object.create(Renderer.prototype), {
      scene: redundantScene, orderedBatches: plan, zoom: 1,
      optionalContentVisibility: { revision: 0, conditions: Uint8Array.of(1, 1), layers: [] },
      vectorLodLevels: [], vectorLodLevelResources: [], orderedTextureBindings: [],
      strokeRenderingEnabled: true, fillRenderingEnabled: false, textRenderingEnabled: false, rasterRenderingEnabled: false,
      strokePipeline: "stroke", strokeBindGroupAll: "exact", vectorClipBindGroups: ["instances", "none"],
      gl: { bindBuffer() {}, bufferData(_target, data) { uploads.push([...data]); } },
      gpuDevice: { queue: { writeBuffer(_buffer, _offset, data) { uploads.push([...data]); } } },
      drawPageBackgroundContentIntoPass() {},
      drawVisibleSegments(_w, _h, _x, _y, _zoom, range) { counts.push(range.count); return range.count; },
      destroyVectorMinifyResources() {}, requestFrame() {}
    });
    const pass = { setPipeline() {}, setBindGroup() {}, draw(_vertices, count) { counts.push(count); } };
    const render = () => Renderer === WebGlFloorplanRenderer
      ? instance.drawSourceOrderedContent(100, 100, 50, 50, 1) : instance.drawSourceOrderedContentIntoPass(pass);
    assert.equal(render(), 1, "both native dispatchers omit the covered opaque stroke");
    assert.equal(instance.getRedundantSegmentCount(), 1);
    assert.equal(instance.orderedRunsCulled, true);
    assert.equal(plan.uintInstances[0], 0);
    assert.equal(render(), 1);
    assert.equal(uploads.length, 1, "unchanged native frames do not reupload temporary culling results");
    instance.setOptionalContentVisibility({ revision: 1, conditions: Uint8Array.of(0, 1), layers: [] });
    assert.equal(render(), 1);
    assert.equal(plan.uintInstances[0], 1, "hiding the covering layer restores the covered canonical ID");
    assert.equal(instance.getRedundantSegmentCount(), 0);
    instance.setOptionalContentVisibility({ revision: 2, conditions: Uint8Array.of(1, 1), layers: [] });
    assert.equal(render(), 1);
    plan.setColorCommutationEnabled(false);
    assert.equal(render(), 2, "temporary solid colors restore the complete visible stroke set");
    assert.equal(instance.getRedundantSegmentCount(), 0);
    plan.setColorCommutationEnabled(true);
    assert.equal(render(), 1);
    instance.orderedRunCuller = { select() { return [redundantScene.drawRuns[1]]; } };
    assert.equal(render(), 1);
    assert.equal(plan.uintInstances[0], 1, "a cover omitted by viewport culling cannot suppress a visible candidate");
    assert.equal(instance.getRedundantSegmentCount(), 0);
    assert.deepEqual(redundantScene, canonical);
  }

  // The native entry points must enable LOD for ordered scenes, and mode off
  // must keep instanced batching while returning to the original geometry.
  const previousUsage = globalThis.GPUBufferUsage;
  globalThis.GPUBufferUsage = { STORAGE: 1, COPY_DST: 2 };
  try {
    for (const Renderer of [WebGlFloorplanRenderer, WebGpuFloorplanRenderer]) {
      const renderer = Object.create(Renderer.prototype);
      renderer.vectorLodMode = "force";
      renderer.mustCreateBuffer = () => ({});
      renderer.gpuDevice = { createBuffer: () => ({ destroy() {} }) };
      renderer.uploadVectorClips = () => {};
      renderer.uploadVectorLodLevels = () => {};
      renderer.destroyVectorLodResources = () => {};
      assert(renderer.rebuildVectorLod(scene));
      assert(renderer.orderedBatches.strokeScene.segmentCount > scene.segmentCount);
      renderer.vectorLodMode = "off";
      assert.equal(renderer.rebuildVectorLod(scene), false);
      assert.equal(renderer.orderedBatches.strokeScene, scene);
      assert.equal(renderer.vectorLodRuntime, null);
    }
  } finally {
    if (previousUsage === undefined) delete globalThis.GPUBufferUsage;
    else globalThis.GPUBufferUsage = previousUsage;
  }

  const uniforms = Object.create(WebGlFloorplanRenderer.prototype);
  uniforms.vectorClipIndex = -2;
  uniforms.orderedUniformPrograms = new Set();
  assert.equal(uniforms.prepareOrderedProgram("stroke"), true);
  assert.equal(uniforms.prepareOrderedProgram("fill"), true);
  assert.equal(uniforms.prepareOrderedProgram("stroke"), false, "uniforms are set once per program per ordered frame");
  uniforms.orderedUniformPrograms.clear();
  assert.equal(uniforms.prepareOrderedProgram("stroke"), true, "a new frame updates camera uniforms");
  uniforms.vectorClipIndex = -1;
  assert.equal(uniforms.prepareOrderedProgram("stroke"), true, "legacy draws always set their own uniforms");

  const textureRenderer = Object.create(WebGlFloorplanRenderer.prototype);
  const textureCalls = [];
  let activeUnit;
  const textureRuns = ["stroke", "fill", "stroke", "raster", "stroke"].map(kind =>
    ({ kind, first: 0, count: 1, clipIndex: kind === "raster" ? undefined : -2 }));
  Object.assign(textureRenderer, {
    scene: { drawRuns: textureRuns }, orderedBatches: { update: () => false, batches: textureRuns },
    orderedTextureBindings: [], vectorLodLevels: [],
    fillRenderingEnabled: true, strokeRenderingEnabled: true, rasterRenderingEnabled: true,
    gl: { TEXTURE0: 100, TEXTURE_2D: 200,
      activeTexture(unit) { activeUnit = unit - 100; },
      bindTexture(_target, texture) { textureCalls.push([activeUnit, texture]); } }
  });
  textureRenderer.drawPageBackgrounds = () => {};
  textureRenderer.drawVisibleSegments = () => { textureRenderer.bindOrderedTexture(0, "stroke"); return 1; };
  textureRenderer.drawFilledPaths = () => textureRenderer.bindOrderedTexture(7, "fill");
  textureRenderer.drawRasterLayerAtIndex = () => {
    textureRenderer.gl.activeTexture(100); textureRenderer.gl.bindTexture(200, "raster");
  };
  const textureSequence = [[0, "stroke"], [7, "fill"], [0, "raster"], [0, "stroke"]];
  textureRenderer.drawSourceOrderedContent(100, 100, 50, 50, 1);
  assert.deepEqual(textureCalls, textureSequence, "compatible batches reuse texture bindings; raster paint invalidates them");
  textureCalls.length = 0;
  textureRenderer.drawSourceOrderedContent(100, 100, 50, 50, 1);
  assert.deepEqual(textureCalls, textureSequence, "each frame starts with fresh binding state");
  textureCalls.length = 0;
  textureRenderer.vectorClipIndex = -2;
  textureRenderer.bindOrderedTexture(0, "text");
  textureRenderer.bindOrderedTexture(0, "stroke");
  textureRenderer.bindOrderedTexture(0, "stroke");
  assert.deepEqual(textureCalls, [[0, "text"], [0, "stroke"]], "shared units are rebound when content changes");
  textureCalls.length = 0;
  textureRenderer.vectorClipIndex = -1;
  textureRenderer.bindOrderedTexture(0, "stroke"); textureRenderer.bindOrderedTexture(0, "stroke");
  assert.equal(textureCalls.length, 2, "legacy passes do not assume cached bindings");
  console.log("Ordered vector batching, clip isolation, and stroke LOD passed");

  function makeScene(count, spread = false) {
    const scene = createEmptyVectorScene();
    scene.segmentCount = count;
    scene.bounds = scene.pageBounds = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
    scene.maxHalfWidth = 0.5;
    for (const key of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) scene[key] = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      // Distinct parallel lines keep these ordering/LOD fixtures independent
      // of opaque duplicate suppression, which is exercised separately below.
      const x = spread ? (i % 400) * 2.5 : 0, y = spread ? Math.floor(i / 400) * 2.5 : i * 0.00001;
      scene.endpoints.set([x, y, x + 20, y], i * 4);
      scene.primitiveMeta.set([x + 20, y, 0, 1], i * 4);
      scene.primitiveBounds.set([x, y, x + 20, y], i * 4);
      scene.styles.set([0.5, 0, 0, 0], i * 4);
    }
    return scene;
  }
} finally { hooks.deregister(); }
