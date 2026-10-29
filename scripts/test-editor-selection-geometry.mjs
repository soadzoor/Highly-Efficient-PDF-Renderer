import assert from "node:assert/strict";
import { editorFrameCorners, editorFrameCenter, editorFrameSize, editorFrameResizeMatrix,
  editorFrameScaleMatrix, editorFrameClientGeometry, editorFrameRotation, editorFrameRotationMatrix,
  editorFrameRotationDragMatrix } from "../src/editorSelectionGeometry.ts";

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
const rotatedFrame = (frame, delta) => ({ ...frame, transform: multiply(delta, frame.transform) });
const direction = (center, degrees, radius = 100) => ({ x: center.x + radius * Math.cos(degrees * Math.PI / 180),
  y: center.y + radius * Math.sin(degrees * Math.PI / 180) });
const determinant = transform => transform[0] * transform[3] - transform[1] * transform[2];
const normalized = degrees => ((degrees + 180) % 360 + 360) % 360 - 180;
for (const [degrees, expected] of [[0, 0], [45, 45], [180, -180], [-180, -180], [270, -90], [360, 0], [-405, -45]]) {
  near(editorFrameRotation({ bounds, transform: rotation(degrees) }), expected, "normalized current rotation");
}
for (const transform of [rotation(17), rotation(179), [1.8, .5, .4, 1.3, -17, 42], [-1, .2, .3, 1, 9, 13]]) {
  const frame = { bounds, transform }, center = editorFrameCenter(frame), size = editorFrameSize(frame);
  const shear = transform[0] * transform[2] + transform[1] * transform[3];
  for (const target of [0, 90, -90, 180, 270, 450, -540, 1080, 12.345]) {
    const delta = editorFrameRotationMatrix(frame, target), next = rotatedFrame(frame, delta);
    const expected = ((target + 180) % 360 + 360) % 360 - 180;
    near(editorFrameRotation(next), expected, "absolute numeric rotation");
    near(editorFrameRotation(frame, delta), editorFrameRotation(next), "preview orientation matches commit");
    nearPoint(editorFrameCenter(next), center, "absolute rotation preserves center");
    const nextSize = editorFrameSize(next);
    near(nextSize.width, size.width, "rotation preserves width"); near(nextSize.height, size.height, "rotation preserves height");
    near(determinant(next.transform), determinant(transform), "rotation preserves signed area and reflection");
    near(next.transform[0] * next.transform[2] + next.transform[1] * next.transform[3], shear, "rotation preserves shear");
    assert.deepEqual(editorFrameRotationMatrix(next, target), identity, "setting the same absolute angle twice is a no-op");
  }
  const initial = editorFrameRotation(frame), start = direction(center, 33);
  for (const movement of [-350, -100, -31, 0, 16, 88, 340]) {
    const target = direction(center, 33 + movement), free = editorFrameRotationDragMatrix(frame, start, target, true);
    const snapped = editorFrameRotationDragMatrix(frame, start, target);
    const expectedFree = ((initial + movement + 180) % 360 + 360) % 360 - 180;
    near(editorFrameRotation(frame, free), expectedFree, "free rotation follows pointer angle");
    const snappedAngle = editorFrameRotation(frame, snapped), nearest = Math.round(expectedFree / 45) * 45;
    const expected = Math.abs(expectedFree - nearest) <= 5 ? normalized(nearest) : expectedFree;
    near(normalized(snappedAngle - expected), 0, "default drag only snaps near an absolute 45-degree angle");
    nearPoint(point(free, center), center, "free drag keeps center fixed");
    nearPoint(point(snapped, center), center, "snapped drag keeps center fixed");
  }
}
const arbitrary = { bounds, transform: rotation(17) }, center = editorFrameCenter(arbitrary);
const start = direction(center, 10), target = direction(center, 40);
near(editorFrameRotation(arbitrary, editorFrameRotationDragMatrix(arbitrary, start, target)), 45, "17 + 30 snaps to absolute 45 rather than relative 62");
near(editorFrameRotation(arbitrary, editorFrameRotationDragMatrix(arbitrary, start, target, true)), 47, "Alt bypass retains unsnapped orientation");
near(editorFrameRotation(arbitrary, editorFrameRotationDragMatrix(arbitrary, start, direction(center, 50))), 57,
  "17 + 40 remains free outside the absolute snap window");
for (let grid = -720; grid <= 720; grid += 45) {
  for (const offset of [-5.0000001, -5, -4.9999999, -1, 0, 1, 4.9999999, 5, 5.0000001]) {
    for (const initial of [-179, -17, 0, 17, 179]) {
      const frame = { bounds, transform: rotation(initial) }, center = editorFrameCenter(frame), absolute = grid + offset;
      const start = direction(center, 137), target = direction(center, 137 + absolute - initial);
      const snapped = editorFrameRotation(frame, editorFrameRotationDragMatrix(frame, start, target));
      const free = editorFrameRotation(frame, editorFrameRotationDragMatrix(frame, start, target, true));
      const expected = normalized(Math.abs(offset) <= 5 ? grid : absolute);
      near(normalized(snapped - expected), 0, `grid ${grid}, offset ${offset}, initial ${initial}: inclusive five-degree boundary`);
      near(normalized(free - absolute), 0, `grid ${grid}, offset ${offset}: Alt bypasses every proximity window`);
    }
  }
}
for (const [absolute, expected] of [[359, 0], [-359, 0], [355, 0], [-355, 0], [354.9999999, -5.0000001],
  [-354.9999999, 5.0000001], [175, -180], [185, -180], [-175, -180], [-185, -180], [174.9999999, 174.9999999],
  [-174.9999999, -174.9999999], [22.5, 22.5], [-22.5, -22.5], [67.5, 67.5]]) {
  const delta = editorFrameRotationDragMatrix(arbitrary, start, direction(center, 10 + absolute - 17));
  near(normalized(editorFrameRotation(arbitrary, delta) - expected), 0, `absolute ${absolute}: negative/zero/180 wrap and free midpoints`);
}
const nearWrap = { bounds, transform: rotation(179) };
const wrapDelta = editorFrameRotationMatrix(nearWrap, -179);
near(wrapDelta[0], Math.cos(2 * Math.PI / 180)); near(wrapDelta[1], Math.sin(2 * Math.PI / 180), "absolute angle wrap uses shortest delta");
const acrossWrap = { bounds, transform: rotation(170) }, wrapCenter = editorFrameCenter(acrossWrap);
near(editorFrameRotation(acrossWrap, editorFrameRotationDragMatrix(acrossWrap, direction(wrapCenter, 179), direction(wrapCenter, -166))), -180,
  "pointer crossing atan2 boundary still snaps to absolute 180");
for (const invalidFrame of [{ bounds, transform: [0, 0, 0, 0, 0, 0] }, { bounds, transform: [NaN, 0, 0, 1, 0, 0] },
  { bounds: { ...bounds, maxX: Infinity }, transform: identity }]) {
  assert.equal(editorFrameRotation(invalidFrame), 0);
  assert.deepEqual(editorFrameRotationMatrix(invalidFrame, 45), identity);
  assert.deepEqual(editorFrameRotationDragMatrix(invalidFrame, start, target), identity);
}
assert.deepEqual(editorFrameRotationMatrix(arbitrary, Infinity), identity);
assert.deepEqual(editorFrameRotationMatrix(arbitrary, NaN), identity);
assert.deepEqual(editorFrameRotationDragMatrix(arbitrary, center, target), identity);
assert.deepEqual(editorFrameRotationDragMatrix(arbitrary, start, center), identity);
assert.deepEqual(editorFrameRotationDragMatrix(arbitrary, start, { x: NaN, y: 0 }), identity);
near(editorFrameRotation(arbitrary, [0, 0, 0, 0, 1, 2]), 17, "invalid preview keeps committed orientation");
console.log("Editor selection geometry: oriented corners, local resizing, absolute rotation, proximity-only 45-degree snapping, fixed anchors, projected cursors and rotation grips passed.");
