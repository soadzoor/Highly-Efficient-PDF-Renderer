import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { ThreeVectorLodStrokeLayer } = await import("../src/vectorStrokeLod.ts");
  const { ThreeVectorDrawPlan } = await import("../src/threeVectorDrawPlan.ts");
  const { OptionalContentController } = await import("../src/optionalContent.ts");
  const scene = { ...createEmptyVectorScene(), segmentCount: 800, maxHalfWidth: 0.5,
    pageRects: Float32Array.of(0, -1, 10, 1), bounds: { minX: 0, minY: -1, maxX: 10, maxY: 1 },
    drawRuns: [{ kind: "stroke", first: 0, count: 400, clipIndex: 0, optionalContent: 0 },
      { kind: "fill", first: 0, count: 1 },
      { kind: "stroke", first: 400, count: 400, clipIndex: 1, optionalContent: 1 }],
    fillPathCount: 1, fillSegmentCount: 4,
    fillPathMetaA: Float32Array.of(0, 4, 0, -1), fillPathMetaB: Float32Array.of(10, 1, 0, 0),
    fillPathMetaC: Float32Array.of(0, 0, 0, 1),
    fillSegmentsA: Float32Array.of(0, -1, 10, -1, 10, -1, 10, 1, 10, 1, 0, 1, 0, 1, 0, -1),
    fillSegmentsB: Float32Array.of(10, -1, 0, 0, 10, 1, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0),
    optionalContent: { groups: ["a", "b"].map(id => ({ id, name: id, defaultVisible: true, locked: false, usedInView: true })),
      conditions: ["a", "b"].map(groupId => ({ kind: "group", groupId })), order: [], radioGroups: [] },
    clipPaths: [0, 5].map(x => ({ parent: -1, fillRule: 0,
      edges: Float32Array.of(x, -1, x + 5, -1, x + 5, -1, x + 5, 1, x + 5, 1, x, 1, x, 1, x, -1) })) };
  for (const key of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) scene[key] = new Float32Array(3200);
  for (let index = 0; index < 800; index++) {
    scene.endpoints.set([-1, 0, 11, 0], index * 4);
    scene.primitiveMeta.set([11, 0, 0, 9], index * 4);
    scene.primitiveBounds.set(index < 400 ? [0, -1, 5, 1] : [5, -1, 10, 1], index * 4);
    scene.styles.set([0.5, 0, 0, 0], index * 4);
  }
  const original = structuredClone(scene);
  for (const materialBackend of ["webgl", "webgpu"]) {
    const plan = new ThreeVectorDrawPlan(scene);
    const layer = new ThreeVectorLodStrokeLayer(scene, { materialBackend, drawPlan: plan,
      strokeCurveEnabled: true, vectorOverride: [0, 0, 0, 0] });
    const controller = new OptionalContentController(scene);
    const viewport = { width: 640, height: 480 };
    const frame = units => {
      plan.update(units); layer.setVisible(true); layer.updateForLocalUnitsPerPixel(units);
      layer.updateFrame({ cameraCenterX: 5, cameraCenterY: 0, zoom: 1 / units }, viewport);
    };
    const drawn = () => layer.group.children.flatMap(parent => parent.children)
      .filter(mesh => mesh.visible).flatMap(mesh => {
        const ids = mesh.geometry.getAttribute("aSegmentIndex"), origins = mesh.userData.heprCanonicalOrigins;
        return Array.from({ length: mesh.geometry.instanceCount }, (_, index) => origins[ids.getX(index)]);
      });
    frame(10);
    const coarse = drawn();
    assert.ok(coarse.length > 0 && coarse.length < scene.segmentCount,
      "ordered scenes actually select simplified vector strokes");
    assert.ok(coarse.some(index => index < 400) && coarse.some(index => index >= 400),
      "both canonical clip/paint ranges survive simplification");
    const material = layer.layers[0];
    let selectionUpdates = 0;
    const updateSelection = material.updateFrameWithVisibleSegmentIds.bind(material);
    material.updateFrameWithVisibleSegmentIds = (...args) => { selectionUpdates++; return updateSelection(...args); };
    const sourceVersion = material.segmentIndexAttribute.version;
    const entryVersions = material.mesh.children.map(mesh => mesh.geometry.getAttribute("aSegmentIndex").version);
    const combined = layer.combinedIds, visible = material.visibleSegmentIds;
    const runtimeIds = layer.runtime.levels.map(level => level.visibleSegmentIds);
    const noIdAccess = values => new Proxy(values, {
      get(target, key) {
        assert(!/^\d+$/.test(String(key)), "cached frames must not scan selected primitive IDs");
        return Reflect.get(target, key, target);
      },
      set(_target, key) { assert.fail(`cached frames must not repack selected primitive IDs (${String(key)})`); }
    });
    layer.combinedIds = noIdAccess(combined);
    material.visibleSegmentIds = noIdAccess(visible);
    layer.runtime.levels.forEach((level, index) => { level.visibleSegmentIds = noIdAccess(runtimeIds[index]); });
    try {
      for (let index = 0; index < 60; index++) {
        layer.updateFrame({ cameraCenterX: 5 + index / 100, cameraCenterY: index / 200, zoom: .1 }, viewport);
      }
      assert.equal(selectionUpdates, 0, "cached panning avoids both full selection-copy paths");
      assert.equal(material.cameraCenterUniform.x, 5.59);
      assert.equal(material.cameraCenterUniform.y, .295);
      assert.equal(material.zoomUniform.value, .1);
      assert.equal(material.segmentIndexAttribute.version, sourceVersion, "cached panning never dirties the source instance upload");
      assert.deepEqual(material.mesh.children.map(mesh => mesh.geometry.getAttribute("aSegmentIndex").version), entryVersions,
        "cached panning never dirties ordered instance uploads");
      assert.deepEqual(drawn(), coarse);

      // Selection can stay fixed while the shared solid-color proof changes.
      // Its new order still has to rebuild the child batches around the fill.
      assert.equal(material.mesh.children.length, 1);
      assert(plan.setColorCommutationEnabled(false));
      frame(10);
      assert.equal(material.mesh.children.length, 2, "a new paint plan is applied even when selected IDs are unchanged");
      assert.deepEqual(drawn().sort((a, b) => a - b), [...coarse].sort((a, b) => a - b));
      assert(plan.setColorCommutationEnabled(true));
      frame(10);
      assert.equal(material.mesh.children.length, 1);
      layer.setVectorOverride(.2, .3, .4, .5);
      layer.setStrokeCurveEnabled(false);
      frame(10);
      assert.deepEqual(material.vectorOverrideUniform.toArray(), [.2, .3, .4, .5]);
      assert.equal(material.curveUniform.value, 0);
      layer.setVectorOverride(0, 0, 0, 0); layer.setStrokeCurveEnabled(true);
      layer.setVisible(false);
      layer.updateFrame({ cameraCenterX: 5, cameraCenterY: 0, zoom: .1 }, viewport);
      assert.equal(layer.getRenderedSegmentCount(), 0);
      frame(10);
      assert.deepEqual(drawn(), coarse, "hide/show restores cached selection without copying IDs");
    } finally {
      layer.combinedIds = combined;
      material.visibleSegmentIds = visible;
      layer.runtime.levels.forEach((level, index) => { level.visibleSegmentIds = runtimeIds[index]; });
    }
    await controller.setLayerVisibility("a", false);
    layer.setOptionalContentVisibility(controller.getSnapshot());
    frame(10);
    assert.ok(drawn().length > 0 && drawn().every(index => index >= 400),
      "a hidden OCG filters derived LOD strokes by their canonical paint");
    assert.equal(selectionUpdates, 0, "layer toggles update ordered entries without revisiting the cached LOD IDs");
    await controller.setLayerVisibility("a", true);
    layer.setOptionalContentVisibility(controller.getSnapshot());
    frame(0.001);
    assert.deepEqual(drawn().sort((a, b) => a - b), Array.from({ length: 800 }, (_, index) => index),
      "zooming in restores every exact canonical stroke");
    layer.setForceExact(true); frame(10);
    assert.equal(drawn().length, 800, "primitive styling forces exact identity even at overview zoom");
    layer.setForceExact(false); frame(10);
    assert.equal(drawn().length, coarse.length, "clearing styling restores vector LOD");
    const beforeDeactivate = selectionUpdates;
    layer.deactivate();
    assert.equal(layer.getRenderedSegmentCount(), 0);
    frame(10);
    assert.equal(selectionUpdates, beforeDeactivate + 1, "deactivation forces one fresh selection upload on reactivation");
    assert.deepEqual(drawn(), coarse);
    layer.dispose();
  }
  const legacy = { ...scene, drawRuns: undefined };
  const legacyLayer = new ThreeVectorLodStrokeLayer(legacy, {
    materialBackend: "webgl", strokeCurveEnabled: true, vectorOverride: [0, 0, 0, 0]
  });
  try {
    legacyLayer.setVisible(true); legacyLayer.updateForLocalUnitsPerPixel(10);
    const viewport = { width: 640, height: 480 }, view = { cameraCenterX: 5, cameraCenterY: 0, zoom: .1 };
    legacyLayer.updateFrame(view, viewport);
    const rendered = legacyLayer.getRenderedSegmentCount();
    assert(rendered > 0);
    for (const layer of legacyLayer.layers) layer.updateFrameWithVisibleSegmentIds = () =>
      assert.fail("legacy per-level layers also reuse unchanged external selections");
    legacyLayer.updateFrame({ ...view, cameraCenterX: 6 }, viewport);
    assert.equal(legacyLayer.getRenderedSegmentCount(), rendered);
    assert(legacyLayer.layers.every(layer => layer.cameraCenterUniform.x === 6));
  } finally { legacyLayer.dispose(); }
  assert.deepEqual(scene, original, "LOD selection does not alter canonical PDF geometry");
  console.log("Ordered Three stroke LOD preserves paint/clip identity, OCG visibility, exact zoom and styling; 60 cached pan frames skip ID scans/uploads");
} finally { hooks.deregister(); }
