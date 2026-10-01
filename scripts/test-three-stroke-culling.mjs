import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { buildSpatialGrid, writeStrokeCullingBounds } = await import("../src/spatialGrid.ts");
  const { ThreeMaterialStrokeLayer } = await import("../src/threeMaterialStrokeLayer.ts");
  const { VectorStrokeRedundancy } = await import("../src/vectorStrokeRedundancy.ts");
  const fields = ["endpoints", "primitiveMeta", "primitiveBounds", "styles"];

  // A 1000-unit page of short strokes. Every eighth stroke carries a clip
  // window covering the whole page, as PDF page clips often do.
  const count = 4000;
  const scene = { ...createEmptyVectorScene(), segmentCount: count, maxHalfWidth: 2,
    bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
    drawRuns: [{ kind: "stroke", first: 0, count }] };
  for (const field of fields) scene[field] = new Float32Array(count * 4);
  let seed = 3;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let index = 0; index < count; index++) {
    const x = random() * 990, y = random() * 990, dx = random() * 10, dy = random() * 10;
    const halfWidth = index % 5 === 0 ? 2 : 0.25;
    const clipped = index % 8 === 0;
    scene.endpoints.set([x, y, x + dx, y + dy], index * 4);
    scene.primitiveMeta.set([x + dx, y + dy, 0, 1 + (clipped ? 4 : 0) * 2], index * 4);
    scene.primitiveBounds.set(clipped ? [0, 0, 1000, 1000] : [x, y, x + dx, y + dy], index * 4);
    scene.styles.set([halfWidth, 0.2, 0.3, 0.4], index * 4);
  }
  // One clipped stroke whose clip misses its geometry draws nothing at all.
  scene.primitiveBounds.set([900, 900, 950, 950], 8 * 4);
  scene.endpoints.set([10, 10, 20, 20], 8 * 4);
  scene.primitiveMeta.set([20, 20], 8 * 4);

  // Reference: everything a stroke can draw, including square caps and the
  // antialiasing margin, clipped to its window.
  const reach = index => {
    const o = index * 4, h = scene.styles[o], margin = h + 0.35, extent = Math.SQRT2 * h + 0.35;
    const e = scene.endpoints, m = scene.primitiveMeta, b = scene.primitiveBounds;
    let box = [b[o] - margin, b[o + 1] - margin, b[o + 2] + margin, b[o + 3] + margin];
    if ((Math.floor(m[o + 3] / 2 + 1e-6) & 4) !== 0) {
      const hull = [Math.min(e[o], e[o + 2], m[o]) - extent, Math.min(e[o + 1], e[o + 3], m[o + 1]) - extent,
        Math.max(e[o], e[o + 2], m[o]) + extent, Math.max(e[o + 1], e[o + 3], m[o + 1]) + extent];
      box = [Math.max(box[0], hull[0]), Math.max(box[1], hull[1]), Math.min(box[2], hull[2]), Math.min(box[3], hull[3])];
    }
    return box[0] <= box[2] && box[1] <= box[3] ? box : null;
  };
  const bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  for (let index = 0; index < count; index++) {
    const expected = reach(index);
    assert.equal(writeStrokeCullingBounds(scene, index, bounds), expected !== null);
    if (expected) assert.deepEqual([bounds.minX, bounds.minY, bounds.maxX, bounds.maxY], expected);
  }

  // Clip windows no longer place a stroke in every cell; unclipped strokes
  // keep their registration, and a stroke that draws nothing has none.
  const grid = buildSpatialGrid(scene);
  const cells = grid.gridWidth * grid.gridHeight;
  const memberships = new Uint32Array(count);
  for (const id of grid.indices) memberships[id]++;
  assert.equal(memberships[8], 0, "a clip that misses its stroke registers nothing");
  for (let index = 16; index < count; index += 8) {
    assert(memberships[index] < cells / 100, `clipped stroke ${index} is registered near its geometry, not the whole page`);
  }
  assert(grid.indices.length < count * 16, "registration follows stroke geometry");

  const options = { materialBackend: "webgl", strokeCurveEnabled: true, vectorOverride: [0, 0, 0, 0] };
  const layer = new ThreeMaterialStrokeLayer(scene, options);
  try {
    assert.equal(layer.segmentMarks.BYTES_PER_ELEMENT, 1, "selection stamps take one byte per stroke");
    assert.equal(["segmentMinX", "segmentMinY", "segmentMaxX", "segmentMaxY", "allSegmentIds"]
      .filter(key => key in layer).length, 0, "no per-stroke bounds or identity IDs are retained");
    const viewport = { width: 800, height: 600 };
    let overwritten = 0;
    for (let step = 0; step < 300; step++) {
      const zoom = 0.8 * 2 ** (random() * 7);
      const view = { cameraCenterX: random() * 1000, cameraCenterY: random() * 1000, zoom };
      const visible = layer.collectVisibleSegments(view, viewport, null, true);
      const margin = Math.max(16 / zoom, scene.maxHalfWidth * 2, 0.5);
      const minX = view.cameraCenterX - viewport.width / (2 * zoom) - margin, maxX = view.cameraCenterX + viewport.width / (2 * zoom) + margin;
      const minY = view.cameraCenterY - viewport.height / (2 * zoom) - margin, maxY = view.cameraCenterY + viewport.height / (2 * zoom) + margin;
      const expected = [];
      for (let index = 0; index < count; index++) {
        const box = reach(index);
        if (box && Math.fround(box[2]) >= minX && Math.fround(box[0]) <= maxX &&
            Math.fround(box[3]) >= minY && Math.fround(box[1]) <= maxY) expected.push(index);
      }
      if (visible < 0) {
        assert(minX <= 0 && minY <= 0 && maxX >= 1000 && maxY >= 1000, "only a view covering the page draws everything");
        continue;
      }
      overwritten = Math.max(overwritten, visible);
      assert.deepEqual(Array.from(layer.visibleSegmentIds.subarray(0, visible)).sort((a, b) => a - b), expected,
        `view ${step}: culling keeps exactly the strokes that can draw into it`);
    }
    // Restoring the complete list rewrites and uploads only the replaced prefix.
    const attribute = layer.segmentIndexAttribute;
    attribute.clearUpdateRanges();
    layer.collectVisibleSegments({ cameraCenterX: 500, cameraCenterY: 500, zoom: 0.1 }, viewport, null, true);
    assert.deepEqual(Array.from(layer.visibleSegmentIds.subarray(0, count)), Array.from({ length: count }, (_, id) => id));
    assert.equal(layer.overwrittenSegmentIds, 0);
    assert.deepEqual(attribute.updateRanges.at(-1), { start: 0, count: overwritten });
    assert.equal(layer.mesh.geometry.instanceCount, count);
  } finally { layer.dispose(); }

  // Redundancy keeps state only for strokes that share a line with another.
  const lines = { ...createEmptyVectorScene(), segmentCount: 1000, bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 10 },
    drawRuns: [{ kind: "stroke", first: 0, count: 1000 }] };
  for (const field of fields) lines[field] = new Float32Array(4000);
  for (let index = 0; index < 1000; index++) {
    // Strokes 0-2 share y = 5; stroke 1 lies inside stroke 0. The rest are unique lines.
    const y = index < 3 ? 5 : index + 10, [x0, x1] = index === 1 ? [20, 40] : index === 2 ? [200, 300] : [10, 100];
    lines.endpoints.set([x0, y, x1, y], index * 4);
    lines.primitiveMeta.set([x1, y, 0, 1], index * 4);
    lines.primitiveBounds.set([x0, y, x1, y], index * 4);
    lines.styles.set([0.5, 0, 0, 0], index * 4);
  }
  const redundancy = new VectorStrokeRedundancy(lines);
  assert.equal(redundancy.candidateCount, 3);
  assert.deepEqual(Array.from({ length: 1000 }, (_, id) => redundancy.isCandidate(id)).flatMap((candidate, id) => candidate ? [id] : []), [0, 1, 2]);
  const stateBytes = Object.values(redundancy).filter(ArrayBuffer.isView).reduce((sum, value) => sum + value.byteLength, 0);
  assert(stateBytes < 1000 / 8 + 256, `candidate-only state stays small: ${stateBytes} bytes`);
  const all = Uint32Array.from({ length: 1000 }, (_, id) => id);
  redundancy.update(all);
  assert.deepEqual(Array.from({ length: 1000 }, (_, id) => redundancy.isRetained(id)).flatMap((kept, id) => kept ? [] : [id]), [1],
    "a contained collinear stroke is still culled");
  redundancy.update(all.filter(id => id !== 0));
  assert(redundancy.isRetained(1), "without its cover, the stroke returns");
  console.log("Three stroke culling: exact clipped-stroke reach, visible sets, prefix restore, and candidate-only redundancy passed");
} finally { hooks.deregister(); }
