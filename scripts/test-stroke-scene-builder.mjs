import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });

try {
  const { buildStrokeScene, createThreePdfObject } = await import("../src/index.ts");
  const { getScenePrimitive } = await import("../src/scenePrimitives.ts");
  const { getSceneSegmentAccounting } = await import("../src/sceneStatistics.ts");
  const { ThreeMaterialStrokeLayer } = await import("../src/threeMaterialStrokeLayer.ts");
  const { ThreeVectorLodStrokeLayer, prebuildVectorStrokeLodRuntime, VECTOR_STROKE_LOD_TARGET_VISIBLE_SEGMENTS } =
    await import("../src/vectorStrokeLod.ts");
  assert.equal(typeof createThreePdfObject, "function");

  const input = [
    { points: [[10, 20], [20, 20], [20, 30]], width: 2, color: "#f00" },
    { points: new Float64Array([0, 0, 4, 0, 4, 4]), closed: true, color: [0, 0, 1] }
  ];
  const snapshot = structuredClone(input);
  const scene = buildStrokeScene(input, { width: 4, color: "green" });
  assert.equal(scene.segmentCount, 5);
  assert.equal(scene.pathCount, 2);
  assert.equal(scene.pageCount, 1);
  assert.deepEqual(scene.pageBounds, { minX: -2, minY: -2, maxX: 21, maxY: 31 });
  assert.equal(scene.maxHalfWidth, 2);
  assert.deepEqual([...scene.pageTextRanges], [0, 0]);
  assert.deepEqual(getSceneSegmentAccounting(scene), { mergedAway: 0, culled: 0, imageLayers: 0 });
  const first = getScenePrimitive(scene, { kind: "stroke", index: 0 });
  assert.deepEqual(first.getSegment(0), { start: { x: 10, y: 20 }, end: { x: 20, y: 20 } });
  assert.deepEqual(first.getSegmentStyle(0), {
    color: [1, 0, 0], opacity: 1, strokeWidth: 2, hairline: false, roundCap: true
  });
  const closing = getScenePrimitive(scene, { kind: "stroke", index: 4 });
  assert.deepEqual(closing.getSegment(0), { start: { x: 4, y: 4 }, end: { x: 0, y: 0 } });
  assert.equal(closing.strokeWidth, 4);
  assert.deepEqual(closing.color, [0, 0, 1]);
  assert.deepEqual(input, snapshot, "building never changes caller geometry or styles");
  input[0].points[0][0] = 999;
  input[1].points.fill(999);
  assert.deepEqual(first.getSegment(0).start, { x: 10, y: 20 }, "scene data owns its coordinates");
  assert.deepEqual(closing.getSegment(0).start, { x: 4, y: 4 });

  const closed = buildStrokeScene([{ points: [[0, 0], [1, 0], [0, 1], [0, 0]], closed: true }]);
  assert.equal(closed.segmentCount, 3, "an explicitly closed path gets no extra closing segment");
  const repeated = buildStrokeScene([{ points: [[0, 0], [0, 0], [10, 0], [10 + 1e-9, 0]] }]);
  assert.equal(repeated.segmentCount, 1, "duplicates are removed after float32 conversion");
  assert.equal(repeated.discardedDegenerateCount, 2);
  assert.deepEqual(getSceneSegmentAccounting(repeated), { mergedAway: 0, culled: 2, imageLayers: 0 });
  for (const key of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) {
    assert.equal(repeated[key].length, 4, "discarded points leave no trailing render primitives");
  }
  const hairline = buildStrokeScene([{ points: new Float32Array([0, 10, 20, 10]), width: 0 }]);
  assert.equal(getScenePrimitive(hairline, { kind: "stroke", index: 0 }).getSegmentStyle(0).hairline, true);
  assert(hairline.pageBounds.maxY > hairline.pageBounds.minY);
  for (const empty of [[], [{ points: [] }], [{ points: [[1, 2]], closed: true }], [{ points: [[1, 2], [1, 2]] }]]) {
    const result = buildStrokeScene(empty);
    assert.equal(result.segmentCount, 0);
    assert.equal(result.pageCount, 0);
    assert(Object.values(result.bounds).every(Number.isFinite));
  }
  const defaults = buildStrokeScene([{ points: [[0, 0], [1, 1]] }], { color: 0x123456, width: 8 });
  const defaultStroke = getScenePrimitive(defaults, { kind: "stroke", index: 0 });
  assert.equal(defaultStroke.strokeWidth, 8);
  assert.deepEqual(defaultStroke.color, [0x12, 0x34, 0x56].map(c => Math.fround(c / 255)));

  for (const points of [null, [1, 2], [[0]], [[0, 0, 0]], new Float32Array(3), [[NaN, 0]], [[Infinity, 0]], [[1e40, 0]], [["1", 0]]]) {
    assert.throws(() => buildStrokeScene([{ points }]), TypeError);
  }
  for (const width of [-1, Infinity, NaN, 1e40, 1e-50, "1"]) {
    assert.throws(() => buildStrokeScene([{ points: [[0, 0], [1, 1]], width }]), RangeError);
  }
  assert.throws(() => buildStrokeScene([{ points: [], color: "not-a-color" }]), TypeError);
  assert.throws(() => buildStrokeScene([{ points: [], closed: "yes" }]), TypeError);
  assert.throws(() => buildStrokeScene(null), TypeError);

  // Actual Three materials can consume the scene without any GPU or DOM.
  for (const materialBackend of ["webgl", "webgpu"]) {
    const layer = new ThreeMaterialStrokeLayer(scene, {
      materialBackend, strokeCurveEnabled: true, vectorOverride: [0, 0, 0, 0]
    });
    try {
      layer.setVisible(true);
      layer.updateFrame({ cameraCenterX: 10, cameraCenterY: 15, zoom: 1 }, { width: 100, height: 100 });
      assert.equal(layer.getRenderedSegmentCount(), scene.segmentCount);
      layer.updateFrame({ cameraCenterX: 1000, cameraCenterY: 1000, zoom: 10 }, { width: 10, height: 10 });
      assert.equal(layer.getRenderedSegmentCount(), 0, "host geometry participates in viewport culling");
    } finally { layer.dispose(); }
  }

  // LOD keeps exact strokes while they fit the visible budget, so the cluster
  // must exceed it before the overview can use simplified geometry.
  const clusterCount = VECTOR_STROKE_LOD_TARGET_VISIBLE_SEGMENTS + 10_000;
  const densePaths = Array.from({ length: clusterCount }, (_, i) => ({
    points: [[(i % 20) * 0.01, 0], [(i % 20) * 0.01 + 10, 0]], width: 1
  }));
  // Sheet edges around a dense local cluster let zoom narrow the visible tiles.
  densePaths.push({ points: [[0, -20], [10, -20]], width: 1 },
    { points: [[0, 20], [10, 20]], width: 1 });
  const dense = buildStrokeScene(densePaths);
  assert.equal(await prebuildVectorStrokeLodRuntime(dense, "off", "webgl"), null);
  const runtime = await prebuildVectorStrokeLodRuntime(dense, "force", "webgl");
  assert(runtime.levels.length > 1, "host strokes must produce usable simplified LOD levels");
  const lodLayer = new ThreeVectorLodStrokeLayer(dense, {
    materialBackend: "webgl", strokeCurveEnabled: true, vectorOverride: [0, 0, 0, 0]
  });
  try {
    assert.equal(lodLayer.runtime, runtime, "rendering reuses the prepared runtime");
    lodLayer.setVisible(true);
    const viewport = { width: 200, height: 200 };
    const transform = new THREE.Matrix4().makeOrthographic(-100, 100, 100, -100, -1, 1);
    lodLayer.setLocalToClipTransform(transform, 1);
    lodLayer.updateForLocalUnitsPerPixel(1);
    lodLayer.updateFrame({ cameraCenterX: 10, cameraCenterY: 0, zoom: 1 }, viewport);
    assert(lodLayer.getRenderedSegmentCount() > 0);
    assert(lodLayer.getRenderedSegmentCount() < dense.segmentCount, "overview uses fewer strokes");
    transform.makeOrthographic(4.99, 5.01, 0.01, -0.01, -1, 1);
    lodLayer.setLocalToClipTransform(transform, 0.0001);
    lodLayer.updateForLocalUnitsPerPixel(0.0001);
    lodLayer.updateFrame({ cameraCenterX: 5, cameraCenterY: 0, zoom: 10_000 }, viewport);
    assert.equal(lodLayer.getRenderedSegmentCount(), clusterCount, "zoom restores exact strokes in the visible cluster");
  } finally { lodLayer.dispose(); }

  console.log("Stroke scene builder: geometry, styles, validation, ownership, Three materials, culling and LOD passed.");
} finally {
  hooks.deregister();
}
