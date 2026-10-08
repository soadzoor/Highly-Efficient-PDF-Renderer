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
  const { ThreeVectorDrawPlan } = await import("../src/threeVectorDrawPlan.ts");
  const { ThreeVectorDrawRuns } = await import("../src/threeVectorDrawRuns.ts");
  const { createThreeVectorClipTexture, initializeThreeVectorClip } = await import("../src/threeVectorClips.ts");
  const count = 64, scene = createEmptyVectorScene();
  Object.assign(scene, {
    pageCount: 1, pageRects: Float32Array.of(0, 0, count * 10, 100),
    segmentCount: count, endpoints: new Float32Array(count * 4),
    primitiveMeta: new Float32Array(count * 4), primitiveBounds: new Float32Array(count * 4),
    styles: new Float32Array(count * 4), maxHalfWidth: 0.1,
    fillPathCount: count, fillPathMetaA: new Float32Array(count * 4),
    fillPathMetaB: new Float32Array(count * 4), fillPathMetaC: new Float32Array(count * 4),
    textInstanceCount: count, textInstanceA: new Float32Array(count * 4),
    textInstanceB: new Float32Array(count * 4), textInstanceC: new Float32Array(count * 4),
    textGlyphCount: 1, textGlyphMetaA: Float32Array.of(0, 0, 0, 0),
    textGlyphMetaB: Float32Array.of(1, 1, 0, 0), drawRuns: [],
    optionalContent: {
      groups: [{ id: "upper", name: "Upper", defaultVisible: true, locked: false, usedInView: true }],
      conditions: [{ kind: "group", groupId: "upper" }], order: [], radioGroups: []
    }
  });
  for (let index = 0; index < count; index++) {
    const x = index * 10, offset = index * 4;
    scene.endpoints.set([x, 0, x + 1, 1], offset);
    scene.primitiveMeta.set([x + 1, 1, 0, 0], offset);
    scene.primitiveBounds.set([x, 0, x + 1, 1], offset);
    scene.styles[offset] = 0.1;
    scene.fillPathMetaA.set([0, 0, x, 20], offset);
    scene.fillPathMetaB.set([x + 1, 21, 0, 0], offset);
    scene.fillPathMetaC[offset + 3] = 1;
    scene.textInstanceA.set([1, 0, 0, 1], offset);
    scene.textInstanceB.set([x, 40, 0, 0], offset);
    scene.textInstanceC[offset + 3] = 1;
    for (const kind of ["stroke", "fill", "text"]) scene.drawRuns.push({
      kind, first: index, count: 1, ...(index % 2 ? { optionalContent: 0 } : {})
    });
  }

  const createLayer = (kind, plan, origins) => {
    const size = origins?.length ?? count, geometry = new THREE.InstancedBufferGeometry();
    const corner = new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2);
    const index = new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1);
    const ids = new THREE.InstancedBufferAttribute(Float32Array.from({ length: size }, (_, id) => id), 1);
    geometry.setAttribute("aCorner", corner); geometry.setAttribute("id", ids);
    geometry.setIndex(index); geometry.instanceCount = size;
    const material = new THREE.RawShaderMaterial(), clips = createThreeVectorClipTexture(scene);
    initializeThreeVectorClip(material, clips);
    const mesh = new THREE.Mesh(geometry, material), foreign = new THREE.Object3D();
    mesh.add(foreign);
    const runs = ThreeVectorDrawRuns.create(scene, kind, mesh, "id", plan, origins);
    return { mesh, geometry, material, clips, ids, corner, index, runs, foreign,
      dispose() { runs.dispose(); geometry.dispose(); material.dispose(); clips.dispose(); } };
  };
  const batches = layer => layer.mesh.children.filter(mesh => mesh.userData.heprDrawRun);
  const drawn = layer => batches(layer).sort((a, b) => a.renderOrder - b.renderOrder).flatMap(mesh => mesh.visible
    ? Array.from(mesh.geometry.getAttribute("id").array.subarray(0, mesh.geometry.instanceCount)) : []);
  const refresh = (layer, ids) => {
    layer.runs.beginUpdate();
    if (ids) {
      layer.ids.array.set(ids); layer.ids.needsUpdate = true; layer.geometry.instanceCount = ids.length;
    }
    layer.runs.finishUpdate();
  };

  const eager = createLayer("stroke", new ThreeVectorDrawPlan(scene));
  assert.equal(batches(eager).length, count, "standalone plans preserve immediate canonical batches");
  eager.dispose();

  const plan = new ThreeVectorDrawPlan(scene, null, true);
  const layers = ["stroke", "fill", "text"].map(kind => createLayer(kind, plan));
  const controller = new OptionalContentController(scene);
  try {
    await controller.setLayerVisibility("upper", false);
    for (const layer of layers) {
      layer.runs.setOptionalContentVisibility(controller.getSnapshot());
      layer.runs.setStrokeRedundancyEnabled(false);
      layer.runs.setEnabled(false);
      assert.equal(batches(layer).length, 0, "construction and visibility changes defer every batch mesh");
      assert.equal(layer.geometry.instanceCount, 0, "the parent cannot draw before its ordered batches exist");
      assert.equal(layer.runs.getRenderedCount(), 0);
    }
    assert.equal(plan.update(0.01), true);
    for (const layer of layers) {
      refresh(layer);
      assert.equal(batches(layer).length, 1, "the first camera update builds the scheduled batch directly");
      assert.deepEqual(drawn(layer), [], "initial disabled state is respected");
      layer.runs.setEnabled(true);
      assert.deepEqual(drawn(layer), Array.from({ length: count / 2 }, (_, index) => index * 2),
        "deferred construction retains the source IDs and latest layer visibility");
    }
    await controller.setLayerVisibility("upper", true);
    for (const layer of layers) {
      layer.runs.setOptionalContentVisibility(controller.getSnapshot());
      assert.deepEqual(drawn(layer), Array.from({ length: count }, (_, index) => index),
        "every canonical primitive renders exactly once after showing the layer");
    }

    const retired = layers.flatMap(batches), disposed = [];
    for (const mesh of retired) mesh.geometry.addEventListener("dispose", () => disposed.push(mesh.geometry));
    const foreignTail = new THREE.Object3D(); layers[0].mesh.add(foreignTail);
    assert.equal(plan.update(null), true);
    for (const layer of layers) {
      refresh(layer);
      assert.equal(batches(layer).length, count, "unknown camera scale restores canonical batches");
      assert.deepEqual(drawn(layer), Array.from({ length: count }, (_, index) => index));
      for (const mesh of batches(layer)) {
        assert.equal(mesh.geometry.getAttribute("aCorner"), layer.corner);
        assert.equal(mesh.geometry.index, layer.index);
      }
      assert.equal(layer.foreign.parent, layer.mesh, "rebuilding leaves unrelated children attached");
    }
    assert.equal(disposed.length, retired.length, "every retired batch geometry is disposed");
    assert(disposed.every(geometry => geometry.getAttribute("aCorner") === undefined && geometry.index === null),
      "retired geometries release borrowed buffers before Three handles disposal");
    assert.equal(foreignTail.parent, layers[0].mesh);
    assert.equal(plan.update(0.01), true);
    for (const layer of layers) { refresh(layer); assert.equal(batches(layer).length, 1); }
    assert.equal(foreignTail.parent, layers[0].mesh, "removing many canonical batches preserves later foreign children");
  } finally { for (const layer of layers) layer.dispose(); }

  const lodPlan = new ThreeVectorDrawPlan(scene, null, true);
  const origins = Uint32Array.from({ length: count * 2 }, (_, id) => id % count);
  const lod = createLayer("stroke", lodPlan, origins);
  try {
    assert.equal(batches(lod).length, 0);
    lodPlan.update(0.01);
    refresh(lod, [count * 2 - 1, 0, count + 1]);
    assert.deepEqual(drawn(lod), [0, count + 1, count * 2 - 1],
      "the first sparse LOD selection builds in origin order without selecting dormant records");
    refresh(lod, [count + 1, 0]);
    assert.deepEqual(drawn(lod), [0, count + 1]);
  } finally { lod.dispose(); }

  console.log("Deferred Three draw batches: camera schedule, canonical coverage, visibility, sparse LOD and buffer disposal passed");
} finally { hooks.deregister(); }
