import assert from "node:assert/strict";
import { editorFrameCorners, editorFrameCenter, editorFrameSize, editorFrameResizeMatrix,
  editorFrameScaleMatrix, editorFrameClientGeometry } from "../src/editorSelectionGeometry.ts";

const identity = [1, 0, 0, 1, 0, 0];
const point = (matrix, p) => ({ x: matrix[0] * p.x + matrix[2] * p.y + matrix[4], y: matrix[1] * p.x + matrix[3] * p.y + matrix[5] });
const multiply = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const rotation = degrees => { const a = degrees * Math.PI / 180; return [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 50, -20]; };
function near(actual, expected, label = "coordinate") {
  assert(Number.isFinite(actual)); assert(Math.abs(actual - expected) <= 1e-10 * Math.max(1, Math.abs(expected)), `${label}: ${actual} versus ${expected}`);
}
const nearPoint = (actual, expected, label) => { near(actual.x, expected.x, `${label} X`); near(actual.y, expected.y, `${label} Y`); };
const bounds = { minX: 10, minY: 20, maxX: 110, maxY: 70 };
const localCorners = [{ x: 10, y: 70 }, { x: 110, y: 70 }, { x: 110, y: 20 }, { x: 10, y: 20 }];
const handles = ["nw", "ne", "se", "sw"];
for (const transform of [rotation(30), [1.8, .5, .4, 1.3, -17, 42], [-1, .2, .3, 1, 9, 13]]) {
  const frame = { bounds, transform }, corners = editorFrameCorners(frame), center = editorFrameCenter(frame);
  corners.forEach((corner, index) => nearPoint(corner, point(transform, localCorners[index]), "stable local corner"));
  nearPoint(center, point(transform, { x: 60, y: 45 }), "frame center");
  const size = editorFrameSize(frame);
  near(size.width, Math.hypot(transform[0] * 100, transform[1] * 100), "world width");
  near(size.height, Math.hypot(transform[2] * 50, transform[3] * 50), "world height");
  for (let index = 0; index < 4; index++) {
    const start = corners[index], fixed = corners[(index + 2) % 4], dx = start.x - fixed.x, dy = start.y - fixed.y;
    for (const scale of [2, .4, -.5]) {
      const target = { x: fixed.x + dx * scale - dy * .2, y: fixed.y + dy * scale + dx * .2 };
      const matrix = editorFrameResizeMatrix(frame, start, target, handles[index]);
      near(matrix[0], scale); near(matrix[3], scale); near(matrix[1], 0); near(matrix[2], 0);
      nearPoint(point(matrix, fixed), fixed, "uniform fixed corner");
      const nextSize = editorFrameSize({ bounds, transform: multiply(matrix, transform) });
      near(nextSize.width, size.width * Math.abs(scale)); near(nextSize.height, size.height * Math.abs(scale));
    }
    const localStart = localCorners[index], localFixed = localCorners[(index + 2) % 4];
    const localTarget = { x: localFixed.x + (localStart.x - localFixed.x) * 2, y: localFixed.y + (localStart.y - localFixed.y) * .5 };
    const target = point(transform, localTarget), free = editorFrameResizeMatrix(frame, start, target, handles[index], true);
    nearPoint(point(free, start), target, "free resize follows frame-local axes"); nearPoint(point(free, fixed), fixed, "free fixed corner");
    const nextSize = editorFrameSize({ bounds, transform: multiply(free, transform) });
    near(nextSize.width, size.width * 2); near(nextSize.height, size.height * .5);
  }
  const numeric = editorFrameScaleMatrix(frame, 2.5, 1.25);
  nearPoint(point(numeric, corners[3]), corners[3], "numeric resize anchors local southwest");
  const numericSize = editorFrameSize({ bounds, transform: multiply(numeric, transform) });
  near(numericSize.width, size.width * 2.5); near(numericSize.height, size.height * 1.25);
  for (const zoom of [.25, 1, 8]) {
    const project = p => ({ x: 100 + p.x * zoom, y: 500 - p.y * zoom });
    const client = editorFrameClientGeometry(frame, project);
    client.corners.forEach((corner, index) => nearPoint(corner, project(corners[index]), "client corner"));
    const stem = { x: client.rotation.x - client.rotationBase.x, y: client.rotation.y - client.rotationBase.y };
    const edge = { x: client.corners[1].x - client.corners[0].x, y: client.corners[1].y - client.corners[0].y };
    near(Math.hypot(stem.x, stem.y), 22, "constant CSS rotation grip distance"); near(stem.x * edge.x + stem.y * edge.y, 0, "rotation grip normal");
    const projectedCenter = project(center);
    assert(stem.x * (client.rotationBase.x - projectedCenter.x) + stem.y * (client.rotationBase.y - projectedCenter.y) > 0, "grip points outward even after reflection");
  }
  const delta = rotation(17), project = p => ({ x: p.x, y: -p.y });
  const preview = editorFrameClientGeometry(frame, project, delta), committed = editorFrameClientGeometry({ bounds, transform: multiply(delta, transform) }, project);
  preview.corners.forEach((corner, index) => nearPoint(corner, committed.corners[index], "preview/committed frame parity"));
  nearPoint(preview.rotation, committed.rotation, "preview/committed grip parity"); assert.deepEqual(preview.cursors, committed.cursors);
}
const project = p => ({ x: p.x, y: -p.y });
for (const [angle, expected] of [[0, ["nwse-resize", "nesw-resize", "nwse-resize", "nesw-resize"]],
  [45, ["ew-resize", "ns-resize", "ew-resize", "ns-resize"]], [90, ["nesw-resize", "nwse-resize", "nesw-resize", "nwse-resize"]]]) {
  for (const aspect of [1, 1000, .001]) {
    const frame = { bounds: { minX: 0, minY: 0, maxX: 100 * aspect, maxY: 100 }, transform: rotation(angle) };
    assert.deepEqual(editorFrameClientGeometry(frame, project).cursors, expected, "corner cursors use normalized edge bisectors, independently of aspect ratio");
  }
}
const frame = { bounds, transform: identity };
assert.deepEqual(editorFrameCorners(frame, [0, 0, 0, 0, 10, 20]), editorFrameCorners(frame), "singular preview restores the committed frame");
assert.deepEqual(editorFrameCorners(frame, [NaN, 0, 0, 1, 0, 0]), editorFrameCorners(frame));
assert.equal(editorFrameClientGeometry(frame, () => null), null); assert.equal(editorFrameClientGeometry(frame, () => ({ x: Infinity, y: 0 })), null);
assert.equal(editorFrameClientGeometry({ bounds, transform: [0, 0, 0, 0, 0, 0] }, project), null);
assert.deepEqual(editorFrameResizeMatrix(frame, { x: 0, y: 0 }, { x: NaN, y: 0 }, "ne"), identity);
for (const [bounds, start, target, expected] of [
  [{ minX: 0, minY: 0, maxX: 1e-200, maxY: 5e-201 }, { x: 1e-200, y: 5e-201 }, { x: 2e-200, y: 1e-200 }, 2],
  [{ minX: 0, minY: 0, maxX: 100, maxY: 0 }, { x: 100, y: 0 }, { x: 200, y: 50 }, 2],
  [{ minX: 0, minY: 0, maxX: 0, maxY: 100 }, { x: 0, y: 100 }, { x: 50, y: 40 }, .4],
  [{ minX: 0, minY: 0, maxX: 0, maxY: 0 }, { x: 0, y: 0 }, { x: 50, y: 40 }, 1]
]) {
  const matrix = editorFrameResizeMatrix({ bounds, transform: identity }, start, target, "ne");
  near(matrix[0], expected); near(matrix[3], expected); assert(matrix.every(Number.isFinite));
  const client = editorFrameClientGeometry({ bounds, transform: identity }, project);
  assert(client); assert(Number.isFinite(client.rotation.x)); assert(Number.isFinite(client.rotation.y));
}
console.log("Editor selection geometry: oriented corners, local resizing, fixed anchors, projected cursors and rotation grips passed.");
