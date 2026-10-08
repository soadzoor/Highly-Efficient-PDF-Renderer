import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { OptionalContentController } = await import("../src/optionalContent.ts");
  const { ScenePrimitivePicker, getScenePrimitive, getPrimitiveOptionalContentCondition } = await import("../src/scenePrimitives.ts");
  const { createSceneTextSearcher } = await import("../src/textSearch.ts");
  const { ThreeVectorDrawRuns } = await import("../src/threeVectorDrawRuns.ts");
  const { createLayerVisibilityController } = await import("../src/layerVisibility.ts");
  const scene = Object.assign(createEmptyVectorScene(), {
    segmentCount: 2,
    endpoints: new Float32Array([0, 0, 0, 0, 0, 0, 0, 0]),
    primitiveMeta: new Float32Array([10, 0, 0, 1, 10, 0, 0, 1]),
    primitiveBounds: new Float32Array([0, -1, 10, 1, 0, -1, 10, 1]),
    styles: new Float32Array([1, 1, 0, 0, 1, 0, 0, 1]),
    bounds: { minX: 0, minY: -1, maxX: 10, maxY: 1 }, maxHalfWidth: 1,
    drawRuns: [{ kind: "stroke", first: 0, count: 1 }, { kind: "stroke", first: 1, count: 1, optionalContent: 0 }],
    optionalContent: { groups: [{ id: "upper", name: "Upper", defaultVisible: false, locked: false, usedInView: true }],
      conditions: [{ kind: "group", groupId: "upper" }], order: [], radioGroups: [] },
    textIndex: { version: 2, pages: [{ text: "lower upper", charInstance: new Int32Array([-2,-2,-2,-2,-2,-1,-3,-3,-3,-3,-3]),
      fallbackQuads: new Float32Array([0,0,4,1,5,0,9,1]), optionalContent: new Int32Array([-1,-1,-1,-1,-1,-1,0,0,0,0,0]) }] }
  });
  const original = structuredClone(scene);
  const layers = new OptionalContentController(scene);
  const picker = new ScenePrimitivePicker(scene);
  const point = { x: 5, y: 0 };
  const query = { point, clientPoint: point, project: p => p, unproject: p => p, tolerancePx: 0 };
  assert.equal((await picker.pick(query)).primitive.index, 0, "default-off paint cannot cover lower geometry in queries");
  await layers.setLayerVisibility("upper", true);
  const pick = () => picker.pick({ ...query, isVisible: ref => layers.isVisible(getPrimitiveOptionalContentCondition(scene, ref)) });
  const hit = await pick();
  assert.equal(hit.primitive.index, 1);
  assert.deepEqual(hit.optionalContent, { conditionId: 0, layerIds: ["upper"] });
  assert.deepEqual(getScenePrimitive(scene, hit.primitive).optionalContent, hit.optionalContent);
  const index = picker.index;
  await layers.setLayerVisibility("upper", false);
  assert.equal((await pick()).primitive.index, 0);
  assert.equal(picker.index, index, "layer toggles reuse the packed picking hierarchy");
  const searcher = createSceneTextSearcher(scene);
  assert.equal(searcher.search("lower").length, 1);
  assert.equal(searcher.search("upper").length, 0, "default-hidden OCR text is excluded");
  await layers.setLayerVisibility("upper", true);
  assert.equal(searcher.search("upper", { optionalContent: layers.getSnapshot() }).length, 1);

  const geometry = new THREE.InstancedBufferGeometry();
  geometry.instanceCount = 2;
  geometry.setAttribute("id", new THREE.InstancedBufferAttribute(new Float32Array([0,1]), 1));
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  const runs = ThreeVectorDrawRuns.create(scene, "stroke", mesh, "id");
  const drawnIds = parent => parent.children.flatMap(child => child.visible
    ? Array.from(child.geometry.getAttribute("id").array.subarray(0, child.geometry.instanceCount)) : []);
  assert.equal(mesh.children.length, 1, "adjacent OCG ranges share a renderer batch");
  assert.deepEqual(drawnIds(mesh), [0]);
  runs.setOptionalContentVisibility(layers.getSnapshot());
  assert.deepEqual(drawnIds(mesh), [0, 1]);
  runs.setEnabled(false); runs.setOptionalContentVisibility(layers.getSnapshot());
  assert(mesh.children.every(child => !child.visible), "layer updates respect the caller's draw enable state");
  runs.setEnabled(true);
  await layers.resetLayerVisibility(); runs.setOptionalContentVisibility(layers.getSnapshot());
  assert.deepEqual(drawnIds(mesh), [0]);
  runs.dispose(); geometry.dispose(); material.dispose();

  // Many OCG boundaries must not multiply submissions. Only visible canonical
  // IDs are packed, without changing the source ranges or geometry buffers.
  const denseScene = { ...scene, segmentCount: 4096, drawRuns: Array.from({ length: 4096 }, (_, index) =>
    ({ kind: "stroke", first: index, count: 1, ...(index % 2 ? { optionalContent: 0 } : {}) })) };
  const denseOriginal = structuredClone(denseScene.drawRuns);
  const denseGeometry = new THREE.InstancedBufferGeometry();
  const denseIds = new THREE.InstancedBufferAttribute(Float32Array.from({ length: 4096 }, (_, index) => index), 1);
  denseGeometry.setAttribute("id", denseIds); denseGeometry.instanceCount = 4096;
  const denseMaterial = new THREE.MeshBasicMaterial(), denseMesh = new THREE.Mesh(denseGeometry, denseMaterial);
  const denseRuns = ThreeVectorDrawRuns.create(denseScene, "stroke", denseMesh, "id");
  assert.equal(denseMesh.children.length, 1, "4,096 source runs need one compatible draw submission");
  assert.equal(denseMesh.children[0].geometry.instanceCount, 2048);
  assert.deepEqual(drawnIds(denseMesh), Array.from({ length: 2048 }, (_, index) => index * 2));
  const batchIds = denseMesh.children[0].geometry.getAttribute("id");
  let version = batchIds.version;
  denseRuns.beginUpdate(); denseIds.needsUpdate = true; denseRuns.finishUpdate();
  assert.equal(batchIds.version, version, "unchanged culling contents do not reupload each batch");
  await layers.setLayerVisibility("upper", true); denseRuns.setOptionalContentVisibility(layers.getSnapshot());
  assert.equal(denseMesh.children[0].geometry.instanceCount, 4096);
  denseRuns.beginUpdate(); denseIds.setX(0, 100); denseIds.setX(1, 101); denseIds.needsUpdate = true;
  denseGeometry.instanceCount = 2; denseRuns.finishUpdate();
  assert.deepEqual(drawnIds(denseMesh), [100, 101]);
  await layers.setLayerVisibility("upper", false); denseRuns.setOptionalContentVisibility(layers.getSnapshot());
  assert.deepEqual(drawnIds(denseMesh), [100], "layer changes retain the active culling subset");
  assert.deepEqual(denseScene.drawRuns, denseOriginal);
  denseRuns.dispose(); denseGeometry.dispose(); denseMaterial.dispose();

  const createBatches = fixture => {
    const geometry = new THREE.InstancedBufferGeometry(); geometry.instanceCount = fixture.segmentCount;
    geometry.setAttribute("id", new THREE.InstancedBufferAttribute(Float32Array.from({ length: fixture.segmentCount }, (_, i) => i), 1));
    const material = new THREE.MeshBasicMaterial(), mesh = new THREE.Mesh(geometry, material);
    const batches = ThreeVectorDrawRuns.create(fixture, "stroke", mesh, "id");
    return { mesh, batches, dispose() { batches.dispose(); geometry.dispose(); material.dispose(); } };
  };
  const duplicateScene = { ...scene, styles: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0]) };
  const duplicateOriginal = structuredClone(duplicateScene);
  const redundant = createBatches(duplicateScene);
  assert.deepEqual(drawnIds(redundant.mesh), [0], "hidden duplicate cannot remove the visible stroke");
  await layers.setLayerVisibility("upper", true);
  redundant.batches.setOptionalContentVisibility(layers.getSnapshot());
  assert.equal(redundant.batches.getRenderedCount(), 1, "visible opaque duplicates share one temporary representative");
  redundant.batches.setStrokeRedundancyEnabled(false);
  assert.deepEqual(drawnIds(redundant.mesh), [0, 1], "disabling redundancy restores canonical source order");
  redundant.batches.setStrokeRedundancyEnabled(true);
  assert.equal(redundant.batches.getRenderedCount(), 1);
  const duplicateIds = redundant.mesh.geometry.getAttribute("id");
  for (const selected of [1, 0]) {
    redundant.batches.beginUpdate();
    duplicateIds.setX(0, selected); duplicateIds.needsUpdate = true;
    redundant.mesh.geometry.instanceCount = 1;
    redundant.batches.finishUpdate();
    assert.deepEqual(drawnIds(redundant.mesh), [selected], "a viewport-culled representative cannot hide the remaining stroke");
  }
  redundant.batches.beginUpdate();
  duplicateIds.setX(0, 0); duplicateIds.setX(1, 1); duplicateIds.needsUpdate = true;
  redundant.mesh.geometry.instanceCount = 2;
  redundant.batches.finishUpdate();
  const planner = redundant.batches.strokeRedundancy;
  const originalUpdate = planner.update.bind(planner);
  let redundancyUpdates = 0;
  planner.update = (...args) => { redundancyUpdates++; originalUpdate(...args); };
  redundant.batches.beginUpdate();
  duplicateIds.setX(0, 1); duplicateIds.setX(1, 0); duplicateIds.needsUpdate = true;
  redundant.batches.finishUpdate();
  assert.equal(redundancyUpdates, 0, "reordering an unchanged viewport subset reuses the redundancy decision");
  await layers.setLayerVisibility("upper", false);
  redundant.batches.setOptionalContentVisibility(layers.getSnapshot());
  assert.deepEqual(drawnIds(redundant.mesh), [0], "layer changes restore the remaining duplicate immediately");
  assert.deepEqual(duplicateScene, duplicateOriginal, "render-only elimination never edits canonical data");
  redundant.dispose();
  const interleaved = createBatches({ ...scene, drawRuns: [scene.drawRuns[0], { kind: "fill", first: 0, count: 1 }, scene.drawRuns[1]] });
  assert.equal(interleaved.mesh.children.length, 2, "intervening paints remain source-order barriers");
  interleaved.dispose();
  const graph = { ...scene, paintGraph: { roots: [{ kind: "group", alpha: 1, isolated: true, knockout: false,
    blendMode: "Normal", optionalContent: 0, children: [{ kind: "draw", runIndex: 0 }] }, { kind: "draw", runIndex: 1 }] } };
  const flat = createBatches(graph);
  assert.deepEqual(drawnIds(flat.mesh), [], "flattened groups retain enclosing OCG visibility");
  await layers.setLayerVisibility("upper", true); flat.batches.setOptionalContentVisibility(layers.getSnapshot());
  assert.deepEqual(drawnIds(flat.mesh), [0, 1]);
  flat.dispose();
  const masked = createBatches({ ...scene, paintGraph: { roots: [{ kind: "group", alpha: 1, isolated: true, knockout: false,
    blendMode: "Normal", children: [{ kind: "draw", runIndex: 1 }], softMask: { subtype: "Alpha",
      children: [{ kind: "draw", runIndex: 0 }] } }] } });
  assert.equal(masked.mesh.children.length, 2, "real compositing keeps pass boundaries");
  assert.deepEqual(drawnIds(masked.mesh), [0], "soft-mask source geometry stays available to the compositor");
  masked.dispose();

  let currentScene = scene;
  let applied;
  let renderer = { setOptionalContentVisibility(value) { applied = value; } };
  const native = createLayerVisibilityController({ getScene: () => currentScene, getRenderer: () => renderer });
  native.sceneChanged(); await native.setLayerVisibility("upper", true);
  const revision = applied.revision;
  renderer = { setOptionalContentVisibility(value) { applied = value; } };
  native.rendererChanged(); assert.equal(applied.revision, revision); assert.equal(applied.conditions[0], 1);
  currentScene = structuredClone(scene); native.sceneChanged(); assert.equal(applied.conditions[0], 0);
  await native.setLayerVisibility("upper", true);
  currentScene = createEmptyVectorScene(); await native.sceneChanged(true);
  currentScene = structuredClone(scene); await native.sceneChanged(true);
  assert.equal(applied.conditions[0], 1, "page-cache scene changes retain visibility even when a layer temporarily disappears");
  currentScene = structuredClone(scene); await native.sceneChanged();
  assert.equal(applied.conditions[0], 0, "opening another document still resets visibility");
  assert.deepEqual(scene, original, "queries, renderer filters, and visibility state leave source buffers unchanged");
  native.dispose(); layers.dispose(); picker.dispose();
  console.log("Layer interaction passed: paint eligibility, inspection, hidden OCR, Three visibility and backend replay.");
} finally { hooks.deregister(); }
