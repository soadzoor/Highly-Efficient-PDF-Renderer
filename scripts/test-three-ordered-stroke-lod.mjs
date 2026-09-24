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
      { kind: "stroke", first: 400, count: 400, clipIndex: 1, optionalContent: 1 }],
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
    await controller.setLayerVisibility("a", false);
    layer.setOptionalContentVisibility(controller.getSnapshot());
    frame(10);
    assert.ok(drawn().length > 0 && drawn().every(index => index >= 400),
      "a hidden OCG filters derived LOD strokes by their canonical paint");
    await controller.setLayerVisibility("a", true);
    layer.setOptionalContentVisibility(controller.getSnapshot());
    frame(0.001);
    assert.deepEqual(drawn().sort((a, b) => a - b), Array.from({ length: 800 }, (_, index) => index),
      "zooming in restores every exact canonical stroke");
    layer.setForceExact(true); frame(10);
    assert.equal(drawn().length, 800, "primitive styling forces exact identity even at overview zoom");
    layer.setForceExact(false); frame(10);
    assert.equal(drawn().length, coarse.length, "clearing styling restores vector LOD");
    layer.dispose();
  }
  assert.deepEqual(scene, original, "LOD selection does not alter canonical PDF geometry");
  console.log("Ordered Three stroke LOD preserves paint/clip identity, OCG visibility, exact zoom and styling");
} finally { hooks.deregister(); }
