import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";
import { createCanvas } from "@napi-rs/canvas";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });
const previousDocument = globalThis.document;
globalThis.document = { createElement: () => Object.assign(createCanvas(1, 1), { style: {} }) };
try {
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { ThreeMaterialFillLayer } = await import("../src/threeMaterialFillLayer.ts");
  const { ThreeMaterialStrokeLayer } = await import("../src/threeMaterialStrokeLayer.ts");
  const { ThreeMixedVectorLayer } = await import("../src/threeMixedVectorLayer.ts");
  const { threeVectorDrawRunsOf } = await import("../src/threeVectorDrawRuns.ts");
  const { ThreeVectorDrawPlan } = await import("../src/threeVectorDrawPlan.ts");
  const { ThreeVectorLodStrokeLayer } = await import("../src/vectorStrokeLod.ts");
  const { ScenePageViews } = await import("../src/scenePageViews.ts");
  const { ThreePageTransforms } = await import("../src/threePageTransforms.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { OptionalContentController } = await import("../src/optionalContent.ts");
  const { createThreePdfObject } = await import("../src/threePdfObject.ts");
  const webGpu = await import("../src/threeWebGpuBackend.ts");
  const view = { cameraCenterX: 5, cameraCenterY: 5, zoom: 10 }, viewport = { width: 800, height: 600 };
  const camera = new THREE.OrthographicCamera(-40, 40, 30, -30, .1, 1000);
  camera.position.z = 100; camera.updateMatrixWorld();

  function sceneOf(count = 4) {
    const scene = buildStrokeScene(Array.from({ length: count }, (_, i) => ({
      points: [[1 + i / count, 1], [9, 9]], width: .25, color: i % 2 ? "red" : "blue"
    })));
    scene.fillPathCount = count; scene.fillSegmentCount = count * 4;
    for (const name of ["fillPathMetaA", "fillPathMetaB", "fillPathMetaC"]) scene[name] = new Float32Array(count * 4);
    scene.fillSegmentsA = new Float32Array(count * 16); scene.fillSegmentsB = new Float32Array(count * 16);
    for (let i = 0; i < count; i++) {
      scene.fillPathMetaA.set([i * 4, 4, 2, 2], i * 4);
      scene.fillPathMetaB.set([8, 8, .3, .7], i * 4);
      scene.fillPathMetaC.set([0, 0, .2, 1], i * 4);
      const corners = [[2, 2], [8, 2], [8, 8], [2, 8]];
      scene.fillSegmentsA.set(corners.flatMap(p => [...p, ...p]), i * 16);
      scene.fillSegmentsB.set(corners.flatMap((_, j) => [...corners[(j + 1) % 4], 0, 0]), i * 16);
    }
    scene.bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    scene.pageRects = Float32Array.of(0, 0, 10, 10);
    scene.drawRuns = Array.from({ length: count }, (_, i) => [
      { kind: "stroke", first: i, count: 1, clipIndex: i % 2 },
      { kind: "fill", first: i, count: 1 }
    ]).flat();
    scene.clipPaths = [0, 1].map(x => ({ parent: -1, fillRule: 0,
      edges: Float32Array.of(x, 0, 10, 0, 10, 0, 10, 10, 10, 10, x, 10, x, 10, x, 0) }));
    return scene;
  }
  function layers(scene, extra = {}) {
    const plan = new ThreeVectorDrawPlan(scene, extra.pageTransforms?.runPages);
    plan.setColorCommutationEnabled(false);
    const common = { drawPlan: plan, vectorOverride: [0, 0, 0, 0], ...extra };
    const fill = new ThreeMaterialFillLayer(scene, common);
    const stroke = new ThreeMaterialStrokeLayer(scene, { ...common, strokeCurveEnabled: true });
    const mixed = new ThreeMixedVectorLayer({ fill, stroke, materialBackend: extra.materialBackend ?? "webgl", webGpu });
    const roots = [fill.mesh, stroke.mesh, mixed.group];
    const refresh = () => { mixed.restore(); fill.setVisible(true); stroke.setVisible(true);
      fill.updateFrame(view, viewport); stroke.updateFrame(view, viewport); };
    const dispose = () => { mixed.dispose(); fill.dispose(); stroke.dispose(); };
    refresh();
    return { scene, plan, fill, stroke, mixed, roots, refresh, dispose };
  }
  const records = layer => layer.group.children.flatMap(mesh => {
    const geometry = mesh.geometry;
    return Array.from({ length: geometry.instanceCount }, (_, i) =>
      ["aVectorIndex", "aVectorClipIndex", "aVectorKind"].map(name => geometry.getAttribute(name).getX(i)));
  });
  // Three draws a batch only when it and its layer mesh are visible.
  const activeSources = entry => [entry.stroke.mesh, entry.fill.mesh].flatMap(root => root.visible ? root.children : [])
    .filter(mesh => mesh.visible && mesh.geometry.instanceCount > 0);

  // Actual selected source layers: 4096 interleaved paints become one mixed mesh.
  const entry = layers(sceneOf(2048)), gl = mockGl(undefined, { vertex: 11, fragment: 3, combined: 14 }),
    host = { getContext: () => gl };
  assert.equal(activeSources(entry).length, 4096);
  entry.mixed.update(entry.roots, host, camera);
  assert.equal(entry.mixed.group.children.length, 1);
  assert.equal(entry.mixed.group.visible, true);
  assert.equal(activeSources(entry).length, 0);
  assert.equal(entry.stroke.mesh.visible || entry.fill.mesh.visible, false,
    "fully mixed layers hide as one object, so Three skips their thousands of batches");
  assert(entry.stroke.mesh.children.every(child => child.visible), "batch visibility stays the layer's own selection");
  assert.equal(entry.mixed.getRenderedStrokeCount(), 2048);
  assert.deepEqual(records(entry.mixed), Array.from({ length: 2048 }, (_, i) => [[i, i % 2 + 1, 0], [i, 0, 1]]).flat(),
    "mixed instances retain exact selected IDs, per-paint clips and interleaved source order");
  const mesh = entry.mixed.group.children[0], geometry = mesh.geometry, data = geometry.getAttribute("aVectorIndex").data;
  assert.equal(mesh.material.uniforms.uSegmentStyleTex.value, entry.stroke.getMixedVectorResources().options.segmentStyleTexture);
  assert.equal(mesh.material.uniforms.uFillSegmentTexA.value, entry.fill.getMixedVectorResources().options.fillSegmentTextureA);
  assert.equal(mesh.material.uniforms.uVectorClipIndex.value, -2);
  entry.mixed.setRenderingEnabled(false, true);
  assert.deepEqual(mesh.material.uniforms.uMixedVectorEnabled.value.toArray(), [1, 0]);
  entry.refresh(); entry.mixed.update(entry.roots, host, camera);
  assert.equal(entry.mixed.group.children[0].geometry, geometry, "one-kind comparisons retain the ordered mixed upload");
  entry.mixed.setRenderingEnabled(true, false);
  assert.equal(entry.mixed.getRenderedStrokeCount(), 0);
  entry.mixed.setRenderingEnabled(true, true);
  assert.match(mesh.material.vertexShader, /#ifdef HEPR_SPLIT_STROKE_STORE/);
  assert.match(mesh.material.vertexShader, /const int uFillClipBoundsEnabled = 0/);
  assert.doesNotMatch(mesh.material.vertexShader, /uniform highp sampler2D uFillSegmentTex[AB]/,
    "mixed vertices no longer bind a fill segment/index texture");
  assert.match(mesh.material.vertexShader, /flat out ivec3 vMixedSegments/,
    "fill start/count/path addresses share one integer varying");
  assert.match(mesh.material.fragmentShader, /heprFillIndexedWinding\(vFillPathIndex/,
    "mixed fragment fallback uses its own path's lazy index headers");
  const probes = gl.links;
  for (let i = 0; i < 20; i++) { entry.refresh(); entry.mixed.update(entry.roots, host, camera); }
  assert.equal(entry.mixed.group.children[0].geometry, geometry, "stable selections reuse mixed geometry");
  const collected = entry.mixed.collect(entry.roots);
  assert.equal(entry.mixed.collect(entry.roots), collected, "unchanged layers reuse their collected batches");
  entry.mixed.restore();
  entry.stroke.mesh.updateMatrixWorld(true);
  const moved = new THREE.Group(); moved.position.set(3, 4, 0); moved.add(entry.stroke.mesh); moved.updateMatrixWorld(true);
  assert(entry.stroke.mesh.children.every(child => child.matrixWorld.elements[12] === 3 && child.matrixWorld.elements[13] === 4),
    "batches follow a moved layer without per-batch matrix updates");
  moved.remove(entry.stroke.mesh); entry.stroke.mesh.updateMatrixWorld(true);
  assert(entry.stroke.mesh.children.every(child => child.matrixWorld.elements[12] === 0), "and return with it");
  entry.refresh(); entry.mixed.update(entry.roots, host, camera);
  assert.equal(data.version, 0, "cached frames do not dirty the mixed upload");
  assert.equal(gl.links, probes, "shader preparation runs once");
  const sourceGroup = new THREE.Group(); sourceGroup.renderOrder = 17;
  sourceGroup.add(entry.stroke.mesh, entry.fill.mesh, entry.mixed.group);
  entry.refresh(); entry.mixed.update(entry.roots, host, camera);
  assert.equal(entry.mixed.group.renderOrder, 17, "a lazy mixed group preserves the effective source Group order");
  const nested = new THREE.Group(); nested.renderOrder = 19; nested.add(entry.fill.mesh); sourceGroup.add(nested);
  entry.refresh(); entry.mixed.update(entry.roots, host, camera);
  assert.equal(entry.mixed.group.visible, false, "different Group orders form a paint-order barrier");
  assert.equal(activeSources(entry).length, 4096);
  sourceGroup.add(entry.fill.mesh); entry.refresh(); entry.mixed.update(entry.roots, host, camera);
  entry.stroke.mesh.material.depthTest = true; entry.stroke.mesh.material.depthFunc = THREE.GreaterDepth;
  entry.refresh(); entry.mixed.update(entry.roots, host, camera);
  assert.equal(entry.mixed.group.children[0].material.depthTest, true);
  assert.equal(entry.mixed.group.children[0].material.depthFunc, THREE.GreaterDepth, "cached raw material tracks source depth modes");
  assert.equal(gl.links, probes, "WebGL depth state does not recompile an unchanged shader");
  sourceGroup.remove(entry.stroke.mesh, entry.fill.mesh, entry.mixed.group);
  entry.refresh(); entry.mixed.update(entry.roots, host, camera);
  entry.stroke.setVectorOverride(.1, .2, .3, .4); entry.stroke.setStrokeCurveEnabled(false);
  assert.deepEqual(mesh.material.uniforms.uVectorOverride.value.toArray(), [.1, .2, .3, .4]);
  assert.equal(mesh.material.uniforms.uStrokeCurveEnabled.value, 0, "live source uniforms reach the borrowed material");
  assert.equal(mesh.material.uniforms.uMinimumStrokeWidthPx.value, 0, "WebGL strokes default to source widths");
  entry.stroke.setMinimumStrokeWidth(true);
  assert.equal(mesh.material.uniforms.uMinimumStrokeWidthPx.value, 1, "mixed WebGL draws share the live width opt-in");
  entry.stroke.setMinimumStrokeWidth(false);
  assert.equal(mesh.material.uniforms.uMinimumStrokeWidthPx.value, 0, "mixed WebGL draws share the live width opt-out");

  entry.mixed.restore();
  assert.equal(activeSources(entry).length, 4096, "disabling restores every suppressed source mesh");
  // The owning layer revises its batches with every selection change.
  const withoutFirst = Uint32Array.from({ length: 2047 }, (_, i) => i + 1);
  entry.stroke.updateFrameWithVisibleSegmentIds(view, viewport, withoutFirst, withoutFirst.length);
  const reusedGeometry = entry.mixed.group.children[0].geometry;
  const reusedData = reusedGeometry.getAttribute("aVectorIndex").data, reusedVersion = reusedData.version;
  entry.mixed.update(entry.roots, host, camera);
  assert.equal(entry.mixed.group.children[0].geometry, reusedGeometry, "a changed selection rewrites the mixed buffer in place");
  assert.equal(reusedData.version, reusedVersion + 1);
  assert.deepEqual(reusedData.updateRanges, [{ start: 0, count: 4095 * 4 }], "only instances in use upload");
  assert.deepEqual(records(entry.mixed)[0], [0, 0, 1], "changed selected IDs invalidate mixed data");
  assert.equal(records(entry.mixed).filter(record => record[2] === 0).length, 2047);
  // Hidden whole, the ordinary batches skipped writing their own IDs; the mixed
  // records above came straight from their selection. Releasing them writes it.
  const strokeRuns = threeVectorDrawRunsOf(entry.stroke.mesh);
  assert.equal(strokeRuns.deferredInstanceWrites, true, "fully mixed batches defer their own instance writes");
  entry.mixed.restore(); entry.mixed.releaseDeferredWrites();
  assert.equal(strokeRuns.deferredInstanceWrites, false);
  const strokeIds = entry.stroke.mesh.children.filter(mesh => mesh.visible).flatMap(mesh =>
    Array.from(mesh.geometry.getAttribute("aSegmentIndex").array.subarray(0, mesh.geometry.instanceCount)));
  assert.deepEqual(strokeIds.sort((a, b) => a - b), Array.from(withoutFirst),
    "released batches write the deferred selection before they can draw");
  entry.refresh();
  const foreign = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  entry.fill.mesh.add(foreign); entry.mixed.update(entry.roots, host, camera);
  assert.equal(entry.fill.mesh.visible, true, "a layer with other children stays visible");
  assert.equal(activeSources(entry).length, 0, "its mixed batches are hidden individually");
  entry.mixed.restore(); entry.fill.mesh.remove(foreign); foreign.geometry.dispose(); foreign.material.dispose();
  entry.refresh();
  const barrier = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  barrier.userData.heprDrawRun = { kind: "text", first: 0, count: 1 };
  barrier.renderOrder = (entry.stroke.mesh.children[1].renderOrder + entry.fill.mesh.children[0].renderOrder) / 2;
  entry.mixed.update([...entry.roots, barrier], host, camera);
  assert.equal(entry.mixed.group.children.length, 2, "text stays between two adjacent mixed blocks");
  for (const kind of ["raster", "gradient-fill", "gradient-stroke"]) {
    entry.refresh(); barrier.userData.heprDrawRun.kind = kind;
    entry.mixed.update([...entry.roots, barrier], host, camera);
    assert.equal(entry.mixed.group.children.length, 2, `${kind} is a painter-order barrier`);
  }
  entry.refresh(); barrier.userData.heprDrawRun = { kind: "stroke", first: 0, count: 1, blendMode: "Multiply" };
  entry.mixed.update([...entry.roots, barrier], host, camera);
  assert.equal(entry.mixed.group.children.length, 2, "unsupported blend passes remain separate");
  entry.mixed.restore(); entry.fill.setVisible(false);
  entry.mixed.update(entry.roots, host, camera);
  assert.equal(entry.mixed.group.visible, false, "single-kind selections keep their ordinary shader");
  assert(entry.stroke.mesh.children.every(child => child.visible));
  entry.refresh(); entry.mixed.update(entry.roots, host, camera);
  const clips = entry.stroke.getMixedVectorResources().clipTexture;
  let textureDisposals = 0; clips.addEventListener("dispose", () => textureDisposals++);
  let retired = 0;
  const retiredGeometry = entry.mixed.group.children[0].geometry;
  retiredGeometry.addEventListener("dispose", () => { retired++; assert.equal(retiredGeometry.getAttribute("aCorner"), undefined);
    assert.equal(retiredGeometry.index, null, "borrowed corner/index buffers detach before geometry disposal"); });
  entry.mixed.dispose(); assert.equal(activeSources(entry).length, 4096); assert.equal(textureDisposals, 0);
  assert.equal(retired, 1);
  entry.fill.dispose(); assert.equal(textureDisposals, 0, "the surviving source still owns shared clipping");
  entry.stroke.dispose(); assert.equal(textureDisposals, 1, "mixed disposal never frees borrowed textures");
  barrier.geometry.dispose(); barrier.material.dispose();

  // Optional content and independent page transforms use the original selections.
  const optionalScene = sceneOf();
  optionalScene.optionalContent = { groups: [{ id: "a", name: "a", defaultVisible: true, locked: false, usedInView: true }],
    conditions: [{ kind: "group", groupId: "a" }], order: [], radioGroups: [] };
  optionalScene.drawRuns[0].optionalContent = 0;
  const optional = layers(optionalScene), controller = new OptionalContentController(optionalScene);
  await controller.setLayerVisibility("a", false);
  optional.stroke.setOptionalContentVisibility(controller.getSnapshot());
  optional.mixed.update(optional.roots, host, camera);
  assert(!records(optional.mixed).some(([id, , kind]) => kind === 0 && id === 0), "hidden OCG strokes stay absent");
  optional.dispose(); controller.dispose();

  const pagesScene = composeVectorScenesInGrid([sceneOf(2), sceneOf(2)], 2);
  const table = new ThreePageTransforms(new ScenePageViews(pagesScene));
  const pages = layers(pagesScene, { pageTransforms: table });
  pages.mixed.update(pages.roots, { getContext: () => mockGl(undefined, { vertex: 13, fragment: 3, combined: 16 }) }, camera);
  assert.equal(pages.mixed.group.visible, true, "page batching needs only thirteen vertex texture units");
  const pageMesh = pages.mixed.group.children[0], pageAttribute = pageMesh.geometry.getAttribute("aPageIndex");
  assert.deepEqual(Array.from({ length: pageMesh.geometry.instanceCount }, (_, i) => pageAttribute.getX(i)),
    [0, 0, 0, 0, 1, 1, 1, 1], "mixed IDs carry the correct page across both primitive stores");
  assert.equal(pageMesh.material.uniforms.uPageMatrices.value, table.matrices);
  assert.match(pageMesh.material.vertexShader, /return int\(aPageIndex\)/);
  pages.dispose(); table.dispose();

  const lodScene = sceneOf(800);
  for (let i = 0; i < 800; i++) {
    lodScene.endpoints.set([-1, 5, 11, 5], i * 4);
    lodScene.primitiveMeta.set([11, 5, 0, 9], i * 4);
    lodScene.primitiveBounds.set([0, 4, 10, 6], i * 4);
    lodScene.styles.set([.5, 0, 0, 0], i * 4);
  }
  lodScene.drawRuns = [{ kind: "stroke", first: 0, count: 400, clipIndex: 0 },
    { kind: "fill", first: 0, count: 1 }, { kind: "stroke", first: 400, count: 400, clipIndex: 1 },
    { kind: "fill", first: 1, count: 1 }];
  const plan = new ThreeVectorDrawPlan(lodScene); plan.setColorCommutationEnabled(false);
  const lod = new ThreeVectorLodStrokeLayer(lodScene, { drawPlan: plan, strokeCurveEnabled: true, vectorOverride: [0, 0, 0, 0] });
  assert(lod.getMixedVectorStrokeLayer(), "ordered LOD exposes its combined canonical and coarse store");
  lod.setMinimumStrokeWidth(false);
  assert.equal(lod.getMixedVectorStrokeLayer().getMixedVectorResources().minimumStrokeWidthUniform.value, 0,
    "coarse and canonical LOD strokes receive the minimum-width opt-out");
  const lodFill = new ThreeMaterialFillLayer(lodScene, { drawPlan: plan, vectorOverride: [0, 0, 0, 0] });
  const lodMixed = new ThreeMixedVectorLayer({ fill: lodFill, stroke: lod.getMixedVectorStrokeLayer(), materialBackend: "webgl" });
  plan.update(10); lod.setVisible(true); lod.updateForLocalUnitsPerPixel(10);
  lod.updateFrame({ ...view, zoom: .1 }, viewport); lodFill.setVisible(true); lodFill.updateFrame({ ...view, zoom: .1 }, viewport);
  const lodSelected = [...lod.getMixedVectorStrokeLayer().mesh.children, ...lodFill.mesh.children]
    .filter(mesh => mesh.visible).sort((a, b) => a.renderOrder - b.renderOrder).flatMap(mesh => {
      const kind = mesh.userData.heprDrawRun.kind === "stroke" ? 0 : 1;
      const ids = mesh.geometry.getAttribute(kind === 0 ? "aSegmentIndex" : "aFillPathIndex");
      return Array.from({ length: mesh.geometry.instanceCount }, (_, i) =>
        [ids.getX(i), (mesh.userData.heprDrawRun.clipIndex ?? -1) + 1, kind]);
    });
  assert(lodSelected.filter(([, , kind]) => kind === 0).length < 800, "fixture selects real coarse LOD strokes");
  assert(lod.getMixedVectorStrokeLayer().getMixedVectorResources().options.segmentTail,
    "coarse selections borrow the same split texture store as ordinary LOD rendering");
  lodMixed.update([lod.group, lodFill.mesh], host, camera);
  assert.deepEqual(records(lodMixed), lodSelected, "mixed LOD preserves the runtime-selected IDs, paint order and canonical clips");
  assert.equal(lodMixed.group.children.length, 1);
  lodMixed.dispose(); lodFill.dispose(); lod.dispose();

  // Optional GL failures preserve ordinary draws and clean every probe resource.
  for (const failure of ["caps", "vertex", "fragment", "link"]) {
    const fallback = layers(sceneOf()), bad = mockGl(failure), warnings = [], originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    try {
      fallback.mixed.update(fallback.roots, { getContext: () => bad }, camera);
      fallback.mixed.update(fallback.roots, { getContext: () => bad }, camera);
      assert.equal(fallback.mixed.group.visible, false);
      assert.equal(activeSources(fallback).length, 8, `${failure} falls back to ordinary source geometry`);
      assert.equal(warnings.length, 1); assert.equal(bad.live.size, 0, "all optional probe resources are freed");
    } finally { console.warn = originalWarn; fallback.dispose(); }
  }

  const gpu = layers(sceneOf(), { materialBackend: "webgpu", webGpu });
  let resolveCompile, compileCalls = 0;
  const gpuHost = { compileAsync(scene) { compileCalls++; assert(scene.children.length > 0);
    for (const mesh of scene.children) this._pipelines.getForRender(mesh);
    return new Promise(resolve => { resolveCompile = resolve; }); },
    _pipelines: { getForRender: () => ({}) }, backend: { get: () => ({ pipeline: {} }) } };
  gpu.mixed.update(gpu.roots, gpuHost, camera);
  assert.equal(gpu.mixed.group.visible, false); assert.equal(activeSources(gpu).length, 8);
  gpu.refresh(); gpu.mixed.update(gpu.roots, gpuHost, camera); assert.equal(compileCalls, 1);
  resolveCompile(); await gpu.mixed.preparing;
  gpu.mixed.update(gpu.roots, gpuHost, camera);
  assert.equal(gpu.mixed.group.visible, true); assert.equal(activeSources(gpu).length, 0);
  gpu.stroke.mesh.material.depthTest = true;
  gpu.refresh(); gpu.mixed.update(gpu.roots, gpuHost, camera);
  assert.equal(gpu.mixed.group.visible, false, "a new depth pipeline keeps ordinary paints until verification");
  assert.equal(activeSources(gpu).length, 8); assert.equal(compileCalls, 2);
  assert.equal(gpu.mixed.group.children[0].material.depthTest, true);
  resolveCompile(); await gpu.mixed.preparing;
  gpu.mixed.update(gpu.roots, gpuHost, camera);
  assert.equal(gpu.mixed.group.visible, true);
  gpu.stroke.setStrokeCurveEnabled(false); gpu.stroke.setVectorOverride(.2, .3, .4, .5);
  gpu.refresh(); gpu.mixed.update(gpu.roots, gpuHost, camera);
  assert.equal(gpu.mixed.state.curveUniform.value, 0);
  assert.equal(gpu.mixed.state.minimumStrokeWidthUniform.value, 0, "WebGPU strokes default to source widths");
  gpu.stroke.setMinimumStrokeWidth(true);
  gpu.refresh(); gpu.mixed.update(gpu.roots, gpuHost, camera);
  assert.equal(gpu.mixed.state.minimumStrokeWidthUniform.value, 1, "mixed WebGPU draws receive the live width opt-in");
  gpu.stroke.setMinimumStrokeWidth(false);
  gpu.refresh(); gpu.mixed.update(gpu.roots, gpuHost, camera);
  assert.equal(gpu.mixed.state.minimumStrokeWidthUniform.value, 0, "mixed WebGPU draws receive the live width opt-out");
  assert.deepEqual(gpu.mixed.state.material.fragmentNode ? gpu.stroke.getMixedVectorResources().options.vectorOverride.toArray() : [], [.2, .3, .4, .5]);
  gpu.dispose();
  const failedGpu = layers(sceneOf(), { materialBackend: "webgpu", webGpu }), originalWarn = console.warn;
  let failures = 0; console.warn = () => failures++;
  try {
    failedGpu.mixed.update(failedGpu.roots, { ...gpuHost, compileAsync: async () => { throw new Error("pipeline failure"); } }, camera);
    await failedGpu.mixed.preparing;
    assert.equal(failedGpu.mixed.group.visible, false); assert.equal(activeSources(failedGpu).length, 8);
    assert.equal(failures, 1);
  } finally { console.warn = originalWarn; failedGpu.dispose(); }

  const swallowed = layers(sceneOf(), { materialBackend: "webgpu", webGpu });
  failures = 0; console.warn = () => failures++;
  try {
    swallowed.mixed.update(swallowed.roots, { ...gpuHost, compileAsync: async function(scene) {
      for (const mesh of scene.children) this._pipelines.getForRender(mesh);
    }, backend: { get: () => ({ error: true }) } }, camera);
    await swallowed.mixed.preparing;
    assert.equal(swallowed.mixed.group.visible, false); assert.equal(activeSources(swallowed).length, 8);
    assert.equal(failures, 1, "Three's swallowed pipeline failure cannot activate mixed content");
  } finally { console.warn = originalWarn; swallowed.dispose(); }

  const pending = layers(sceneOf(), { materialBackend: "webgpu", webGpu });
  pending.mixed.update(pending.roots, gpuHost, camera);
  const pendingMesh = pending.mixed.group.children[0];
  let pendingDisposed = false; pendingMesh.geometry.addEventListener("dispose", () => { pendingDisposed = true; });
  pending.mixed.dispose();
  assert.equal(pendingDisposed, false, "pending compiler borrows geometry until preparation drains");
  assert.equal(activeSources(pending).length, 8);
  resolveCompile(); await pending.mixed.preparing; await Promise.resolve();
  assert.equal(pendingDisposed, true); assert.equal(pending.mixed.group.visible, false);
  pending.fill.dispose(); pending.stroke.dispose();

  const initializing = layers(sceneOf(), { materialBackend: "webgpu", webGpu });
  let finishInitialization, lateCompiles = 0;
  initializing.mixed.update(initializing.roots, { init: () => new Promise(resolve => { finishInitialization = resolve; }),
    compileAsync: async () => { lateCompiles++; } }, camera);
  initializing.mixed.dispose(); finishInitialization(); await initializing.mixed.preparing;
  assert.equal(lateCompiles, 0, "disposed optional layers cannot begin GPU allocation after delayed host initialization");
  initializing.fill.dispose(); initializing.stroke.dispose();

  // Public object switch reaches the native fallback and survives page/material changes.
  let nativeSetting = true, nativeView = view, nativeFills = true, nativeStrokes = true, nativeMinimumWidth;
  const native = new Proxy({ getViewState: () => nativeView, getPresentedViewState: () => nativeView,
    setViewState: value => { nativeView = value; }, getPresentedFrameSerial: () => 0, getRasterLayerUpdates: () => new Map(),
    setMixedVectorBatchingEnabled: value => { nativeSetting = value; }, getSceneStats: () => ({}),
    setFillRenderingEnabled: value => { nativeFills = value; },
    setStrokeRenderingEnabled: value => { nativeStrokes = value; },
    setMinimumStrokeWidth: value => { nativeMinimumWidth = value; } },
    { get: (target, key) => target[key] ?? (() => {}) });
  const visibilityScene = sceneOf();
  Object.assign(visibilityScene, {
    gradientCount: 1, gradientMetaA: Float32Array.of(0, 0, 0, 0), gradientMetaB: Float32Array.of(1, 0, 0, 1),
    gradientMetaC: Float32Array.of(0, 0, 0, 0), gradientMetaD: Float32Array.of(10, 0, 0, 0),
    gradientMetaE: new Float32Array(4), gradientLut: new Uint8Array(4096).fill(255),
    gradientFillPathCount: 1, gradientFillSegmentCount: 4,
    gradientFillPathMetaA: visibilityScene.fillPathMetaA.slice(0, 4),
    gradientFillPathMetaB: visibilityScene.fillPathMetaB.slice(0, 4),
    gradientFillPathMetaC: visibilityScene.fillPathMetaC.slice(0, 4),
    gradientFillSegmentsA: visibilityScene.fillSegmentsA.slice(0, 16),
    gradientFillSegmentsB: visibilityScene.fillSegmentsB.slice(0, 16), gradientFillPaintMeta: Float32Array.of(0, -1, 8, 0),
    gradientStrokeRunCount: 1, gradientStrokeSegmentCount: 1,
    gradientStrokeRunMetaA: Float32Array.of(0, 1, 0, -1), gradientStrokeRunMetaB: Float32Array.of(9, 0, 0, 0),
    gradientStrokeEndpoints: Float32Array.of(2, 2, 8, 8), gradientStrokePrimitiveMeta: new Float32Array(4),
    gradientStrokePrimitiveBounds: Float32Array.of(1, 1, 9, 9), gradientStrokeStyles: Float32Array.of(.2, 0, 0, 0)
  });
  visibilityScene.drawRuns.push({ kind: "gradient-fill", first: 0, count: 1 }, { kind: "gradient-stroke", first: 0, count: 1 });
  const object = await createThreePdfObject({ scene: visibilityScene, sourceKind: "hep", sourceLabel: "mixed" },
    { rendererType: "webgl", vectorLod: "off", textLod: "off", threeColorCompositing: "display" },
    undefined, undefined, () => native);
  assert.equal(object.getMinimumStrokeWidth(), 0);
  assert.equal(nativeMinimumWidth, 0, "the disabled public default reaches native fallback rendering");
  const canonicalStyles = visibilityScene.styles.slice();
  object.setMinimumStrokeWidth(true);
  assert.equal(object.getMinimumStrokeWidth(), 1);
  assert.equal(nativeMinimumWidth, 1, "the public opt-in reaches native fallback rendering");
  object.setMinimumStrokeWidth(false);
  assert.equal(object.getMinimumStrokeWidth(), 0);
  assert.equal(nativeMinimumWidth, 0);
  assert.equal(object.strokeMaterialLayer.getMixedVectorResources().minimumStrokeWidthUniform.value, 0);
  const gradientWidthUniform = object.gradientMaterialLayer.getOrderedPaintMeshes()
    .find(paint => paint.primitiveKind === "gradient-stroke").material.uniforms.uMinimumStrokeWidthPx;
  assert.equal(gradientWidthUniform.value, 0, "gradient strokes receive the opt-out");
  assert.deepEqual(visibilityScene.styles, canonicalStyles, "the display floor never modifies canonical stroke styles");
  const world = new THREE.Scene(); world.add(object); world.updateMatrixWorld(true);
  object.drawPlan.setColorCommutationEnabled(false);
  const objectHost = { ...host, isWebGLRenderer: true, outputColorSpace: THREE.LinearSRGBColorSpace,
    capabilities: { maxTextureSize: 16384 }, getDrawingBufferSize: v => v.set(800, 600), getPixelRatio: () => 1,
    domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } };
  object.prepareFrameForThreeRenderer(objectHost, camera);
  assert(object.mixedVectorLayer?.group.visible, "public frame integration activates prepared mixed draws");
  const gradientPaints = object.gradientMaterialLayer.getOrderedPaintMeshes();
  assert.deepEqual(gradientPaints.map(paint => paint.mesh.visible), [true, true]);
  const selectedGeometry = object.mixedVectorLayer.group.children[0].geometry;
  object.setFillRenderingEnabled(false); object.prepareFrameForThreeRenderer(objectHost, camera);
  assert.equal(object.getFillRenderingEnabled(), false); assert.equal(object.getStrokeRenderingEnabled(), true);
  assert.equal(object.fillMaterialLayer.mesh.visible, false);
  assert.deepEqual(gradientPaints.map(paint => paint.mesh.visible), [false, true], "fill comparisons hide gradient and pattern fills");
  assert.equal(object.mixedVectorLayer.group.visible, true, "stroke-only comparison retains mixed draws");
  assert.equal(object.mixedVectorLayer.group.children[0].geometry, selectedGeometry);
  assert.deepEqual(object.mixedVectorLayer.group.children[0].material.uniforms.uMixedVectorEnabled.value.toArray(), [1, 0]);
  assert.equal(nativeFills, false); assert.equal(nativeStrokes, false, "independent material mode keeps the native vectors suppressed");
  object.setStrokeRenderingEnabled(false); object.prepareFrameForThreeRenderer(objectHost, camera);
  assert.equal(object.getRenderedStrokeSegmentCount(), 0);
  assert.equal(object.mixedVectorLayer.group.visible, false);
  assert.deepEqual(gradientPaints.map(paint => paint.mesh.visible), [false, false]);
  object.configureNativeTexturePipeline();
  assert.equal(nativeFills, false); assert.equal(nativeStrokes, false, "native fallback honors persistent comparison flags");
  object.setStrokeRenderingEnabled(true); assert.equal(nativeStrokes, true);
  object.prepareFrameForThreeRenderer(objectHost, camera);
  assert.deepEqual(gradientPaints.map(paint => paint.mesh.visible), [false, true]);
  // Transparency proxies ignore Object3D.visible; verify the public comparison
  // also filters their source roots rather than allowing disabled paints back.
  let compositeRoots;
  const compositorMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  object.paintCompositor = { mesh: compositorMesh, render(_host, _scene, roots) { compositeRoots = roots; },
    dispose() { compositorMesh.geometry.dispose(); compositorMesh.material.dispose(); } };
  object.paintVisibility.requiresCompositing = true;
  object.prepareFrameForThreeRenderer(objectHost, camera);
  assert(!compositeRoots.includes(object.fillMaterialLayer.mesh));
  assert(!compositeRoots.includes(object.gradientMaterialLayer.group));
  assert(!compositeRoots.includes(gradientPaints[0].mesh)); assert(compositeRoots.includes(gradientPaints[1].mesh));
  object.paintVisibility.requiresCompositing = false;
  object.setMixedVectorBatchingEnabled(false);
  assert.equal(object.getMixedVectorBatchingEnabled(), false); assert.equal(nativeSetting, false);
  assert.equal(object.mixedVectorLayer.group.visible, false);
  assert(object.strokeMaterialLayer.mesh.children.every(child => child.visible));
  object.setMinimumStrokeWidth(.5);
  object.setVectorLodMode("force");
  assert(object.vectorLodStrokeLayer, "force mode actually replaces the exact stroke material");
  assert.equal(object.vectorLodStrokeLayer.getMixedVectorStrokeLayer().getMixedVectorResources().minimumStrokeWidthUniform.value, .5,
    "new LOD materials inherit the fractional width");
  object.setVectorLodMode("off");
  assert.equal(object.getMixedVectorBatchingEnabled(), false, "stroke material rebuilds retain the user setting");
  assert.equal(object.strokeMaterialLayer.getMixedVectorResources().minimumStrokeWidthUniform.value, .5,
    "stroke material rebuilds retain the fractional width");
  const children = await object.getPages();
  assert(children.every(page => !page.getMixedVectorBatchingEnabled()), "new page handles inherit the setting");
  assert(children.every(page => page.getMinimumStrokeWidth() === .5), "new page handles inherit the minimum-width opt-out");
  assert(children.every(page => !page.getFillRenderingEnabled() && page.getStrokeRenderingEnabled()),
    "new page handles inherit independent vector rendering flags");
  object.setFillRenderingEnabled(true);
  assert(children.every(page => page.getFillRenderingEnabled()));
  object.setMixedVectorBatchingEnabled(true);
  assert(children.every(page => page.getMixedVectorBatchingEnabled()));
  object.setMinimumStrokeWidth(10);
  assert(children.every(page => page.getMinimumStrokeWidth() === 10), "existing page handles receive runtime width changes");
  object.dispose();
  for (const rendererType of ["webgl", "webgpu"]) for (const minimumStrokeWidth of [undefined, false, true, 0, .5, 10]) {
    const configured = await createThreePdfObject({ scene: visibilityScene, sourceKind: "hep", sourceLabel: "width option" },
      { rendererType, vectorLod: "off", textLod: "off", minimumStrokeWidth },
      undefined, undefined, () => native);
    const width = typeof minimumStrokeWidth === "number" ? minimumStrokeWidth : minimumStrokeWidth === true ? 1 : 0;
    assert.equal(configured.getMinimumStrokeWidth(), width);
    assert.equal(nativeMinimumWidth, width);
    assert.equal(configured.strokeMaterialLayer.getMixedVectorResources().minimumStrokeWidthUniform.value, width,
      "constructor options apply before the first rendered frame");
    if (rendererType === "webgpu") {
      const gradientStroke = configured.gradientMaterialLayer.getOrderedPaintMeshes()
        .find(paint => paint.primitiveKind === "gradient-stroke");
      assert.equal(gradientStroke.strokeState.minimumStrokeWidthUniform.value, width);
      configured.setMinimumStrokeWidth(.25);
      assert.equal(gradientStroke.strokeState.minimumStrokeWidthUniform.value, .25, "WebGPU gradient strokes toggle at runtime");
    }
    configured.dispose();
  }
  console.log("Three mixed vectors: 4096 paints to one draw, order/clips/pages/OCG, stable uploads, LOD resources, lifecycle, GL/GPU fallbacks and public comparison switch passed");
} finally { globalThis.document = previousDocument; hooks.deregister(); }

function mockGl(failure, limits = {}) {
  const live = new Set();
  return { live, links: 0, VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    MAX_VERTEX_TEXTURE_IMAGE_UNITS: 5, MAX_TEXTURE_IMAGE_UNITS: 6, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 7, MAX_VARYING_VECTORS: 8,
    getParameter: key => failure === "caps" ? 0 : ({ 5: limits.vertex, 6: limits.fragment,
      7: limits.combined, 8: limits.varyings ?? 16 })[key] ?? 32,
    createShader(kind) { const shader = { kind }; live.add(shader); return shader; }, shaderSource() {}, compileShader() {},
    getShaderParameter: shader => !(failure === "vertex" && shader.kind === 1 || failure === "fragment" && shader.kind === 2),
    getShaderInfoLog: () => "shader failure", deleteShader: shader => live.delete(shader),
    createProgram() { const program = {}; live.add(program); return program; }, attachShader() {},
    linkProgram() { this.links++; }, getProgramParameter: () => failure !== "link", getProgramInfoLog: () => "link failure",
    deleteProgram: program => live.delete(program) };
}
