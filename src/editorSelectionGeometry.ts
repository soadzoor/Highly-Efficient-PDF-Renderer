import type { EditorMatrix, EditorSelectionFrame } from "./editorTypes";
import type { PrimitivePoint } from "./scenePrimitives";

type Corners = readonly [PrimitivePoint, PrimitivePoint, PrimitivePoint, PrimitivePoint];
type ResizeHandle = "nw" | "ne" | "se" | "sw";
const IDENTITY: EditorMatrix = [1, 0, 0, 1, 0, 0];
const finitePoint = (point: PrimitivePoint): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);
const finiteMatrix = (matrix: EditorMatrix): boolean => matrix.length === 6 && matrix.every(Number.isFinite);
const determinant = (matrix: EditorMatrix): number => matrix[0] * matrix[3] - matrix[1] * matrix[2];
const map = (matrix: EditorMatrix, point: PrimitivePoint): PrimitivePoint => ({
  x: matrix[0] * point.x + matrix[2] * point.y + matrix[4], y: matrix[1] * point.x + matrix[3] * point.y + matrix[5]
});
const multiply = (left: EditorMatrix, right: EditorMatrix): EditorMatrix => [
  left[0] * right[0] + left[2] * right[1], left[1] * right[0] + left[3] * right[1],
  left[0] * right[2] + left[2] * right[3], left[1] * right[2] + left[3] * right[3],
  left[0] * right[4] + left[2] * right[5] + left[4], left[1] * right[4] + left[3] * right[5] + left[5]
];
function inverse(matrix: EditorMatrix): EditorMatrix | null {
  const det = determinant(matrix); if (!finiteMatrix(matrix) || !Number.isFinite(det) || det === 0) return null;
  const [a, b, c, d, e, f] = matrix;
  const result: EditorMatrix = [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
  return finiteMatrix(result) ? result : null;
}
function validFrame(frame: EditorSelectionFrame): boolean {
  const b = frame.bounds;
  const det = determinant(frame.transform);
  return [b.minX, b.minY, b.maxX, b.maxY].every(Number.isFinite) && b.minX <= b.maxX && b.minY <= b.maxY &&
    finiteMatrix(frame.transform) && Number.isFinite(det) && det !== 0;
}
function previewMatrix(delta?: EditorMatrix): EditorMatrix {
  return delta && finiteMatrix(delta) && Number.isFinite(determinant(delta)) && determinant(delta) !== 0 ? delta : IDENTITY;
}
function safeMatrix(matrix: EditorMatrix): EditorMatrix { return finiteMatrix(matrix) ? matrix : IDENTITY; }

/** Stable local-corner order: northwest, northeast, southeast, southwest. */
export function editorFrameCorners(frame: EditorSelectionFrame, delta?: EditorMatrix): Corners {
  const b = frame.bounds, matrix = multiply(previewMatrix(delta), frame.transform);
  return [map(matrix, { x: b.minX, y: b.maxY }), map(matrix, { x: b.maxX, y: b.maxY }),
    map(matrix, { x: b.maxX, y: b.minY }), map(matrix, { x: b.minX, y: b.minY })];
}

export function editorFrameCenter(frame: EditorSelectionFrame): PrimitivePoint {
  const b = frame.bounds; return map(frame.transform, { x: b.minX + (b.maxX - b.minX) / 2, y: b.minY + (b.maxY - b.minY) / 2 });
}

/** Edge lengths in composed scene units; shear and reflection retain local axes. */
export function editorFrameSize(frame: EditorSelectionFrame): { width: number; height: number } {
  const bounds = frame.bounds, [a, b, c, d] = frame.transform;
  return { width: Math.hypot(a * (bounds.maxX - bounds.minX), b * (bounds.maxX - bounds.minX)),
    height: Math.hypot(c * (bounds.maxY - bounds.minY), d * (bounds.maxY - bounds.minY)) };
}

function normalizedDegrees(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped >= 180 ? wrapped - 360 : wrapped < -180 ? wrapped + 360 : wrapped === 0 ? 0 : wrapped;
}

/** Local x-axis orientation in page coordinates, normalized to [-180, 180). */
export function editorFrameRotation(frame: EditorSelectionFrame, delta?: EditorMatrix): number {
  if (!validFrame(frame)) return 0;
  const [a, b] = multiply(previewMatrix(delta), frame.transform);
  return Number.isFinite(a) && Number.isFinite(b) ? normalizedDegrees(Math.atan2(b, a) * 180 / Math.PI) : 0;
}

function rotateFrame(frame: EditorSelectionFrame, degrees: number): EditorMatrix {
  const angle = normalizedDegrees(degrees);
  if (Math.abs(angle) <= Number.EPSILON * 360 * 4) return IDENTITY;
  const center = editorFrameCenter(frame); if (!finitePoint(center)) return IDENTITY;
  const radians = angle * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
  return safeMatrix([c, s, -s, c, center.x - c * center.x + s * center.y, center.y - s * center.x - c * center.y]);
}

/** Absolute orientation changes rotate the whole frame, preserving its shear and reflection. */
export function editorFrameRotationMatrix(frame: EditorSelectionFrame, targetDegrees: number): EditorMatrix {
  if (!validFrame(frame) || !Number.isFinite(targetDegrees)) return IDENTITY;
  return rotateFrame(frame, normalizedDegrees(targetDegrees) - editorFrameRotation(frame));
}

/** Dragging snaps within five degrees of the absolute 45-degree grid; free rotation bypasses it. */
export function editorFrameRotationDragMatrix(frame: EditorSelectionFrame, start: PrimitivePoint,
  point: PrimitivePoint, freeRotation = false): EditorMatrix {
  if (!validFrame(frame) || !finitePoint(start) || !finitePoint(point)) return IDENTITY;
  const center = editorFrameCenter(frame); if (!finitePoint(center)) return IDENTITY;
  const sx = start.x - center.x, sy = start.y - center.y, dx = point.x - center.x, dy = point.y - center.y;
  if (sx === 0 && sy === 0 || dx === 0 && dy === 0) return IDENTITY;
  const angle = (Math.atan2(dy, dx) - Math.atan2(sy, sx)) * 180 / Math.PI;
  if (freeRotation) return rotateFrame(frame, angle);
  const rotation = editorFrameRotation(frame), absolute = normalizedDegrees(rotation + angle), target = Math.round(absolute / 45) * 45;
  // atan2 and affine composition can put an exact five-degree boundary a few ulps outside it.
  return rotateFrame(frame, Math.abs(absolute - target) <= 5 + Number.EPSILON * 360 * 8 ? target - rotation : angle);
}

function localScale(frame: EditorSelectionFrame, anchor: PrimitivePoint, sx: number, sy: number): EditorMatrix {
  const inverted = inverse(frame.transform); if (!inverted || !Number.isFinite(sx) || !Number.isFinite(sy)) return IDENTITY;
  const matrix: EditorMatrix = [sx, 0, 0, sy, anchor.x * (1 - sx), anchor.y * (1 - sy)];
  return safeMatrix(multiply(frame.transform, multiply(matrix, inverted)));
}

/** Corner scaling uses a captured committed frame and keeps its opposite corner fixed. */
export function editorFrameResizeMatrix(frame: EditorSelectionFrame, start: PrimitivePoint, point: PrimitivePoint,
  handle: string, freeResize = false): EditorMatrix {
  if (!validFrame(frame) || !finitePoint(start) || !finitePoint(point) || !["nw", "ne", "se", "sw"].includes(handle)) return IDENTITY;
  const b = frame.bounds, corner = handle as ResizeHandle;
  const anchor = { x: corner.includes("w") ? b.maxX : b.minX, y: corner.includes("n") ? b.minY : b.maxY };
  const fixed = map(frame.transform, anchor);
  if (!freeResize) {
    const dx = start.x - fixed.x, dy = start.y - fixed.y, length = Math.hypot(dx, dy);
    const scale = length === 0 ? 1 : ((point.x - fixed.x) * (dx / length) + (point.y - fixed.y) * (dy / length)) / length;
    return safeMatrix([scale, 0, 0, scale, fixed.x * (1 - scale), fixed.y * (1 - scale)]);
  }
  const inverted = inverse(frame.transform); if (!inverted) return IDENTITY;
  const localStart = map(inverted, start), localPoint = map(inverted, point);
  const dx = localStart.x - anchor.x, dy = localStart.y - anchor.y;
  return localScale(frame, anchor, dx === 0 ? 1 : (localPoint.x - anchor.x) / dx, dy === 0 ? 1 : (localPoint.y - anchor.y) / dy);
}

/** Numeric width/height changes scale along local frame axes, anchored at local southwest. */
export function editorFrameScaleMatrix(frame: EditorSelectionFrame, sx: number, sy: number): EditorMatrix {
  return validFrame(frame) ? localScale(frame, { x: frame.bounds.minX, y: frame.bounds.minY }, sx, sy) : IDENTITY;
}

export interface EditorFrameClientGeometry {
  corners: Corners;
  rotationBase: PrimitivePoint;
  rotation: PrimitivePoint;
  cursors: readonly [string, string, string, string];
}

/** Project the actual frame; the rotation grip remains 22 CSS pixels outside its local top edge. */
export function editorFrameClientGeometry(frame: EditorSelectionFrame, project: (point: PrimitivePoint) => PrimitivePoint | null,
  delta?: EditorMatrix): EditorFrameClientGeometry | null {
  if (!validFrame(frame)) return null;
  const projected = editorFrameCorners(frame, delta).map(point => finitePoint(point) ? project(point) : null);
  if (projected.some(point => !point || !finitePoint(point))) return null;
  const corners = projected as unknown as Corners, [nw, ne, se, sw] = corners;
  const rotationBase = { x: nw.x + (ne.x - nw.x) / 2, y: nw.y + (ne.y - nw.y) / 2 };
  const center = { x: (nw.x + ne.x + se.x + sw.x) / 4, y: (nw.y + ne.y + se.y + sw.y) / 4 };
  const dx = ne.x - nw.x, dy = ne.y - nw.y, length = Math.hypot(dx, dy);
  let nx = length ? -dy / length : rotationBase.x - center.x, ny = length ? dx / length : rotationBase.y - center.y;
  if (nx * (rotationBase.x - center.x) + ny * (rotationBase.y - center.y) < 0) { nx = -nx; ny = -ny; }
  const normalLength = Math.hypot(nx, ny); if (normalLength) { nx /= normalLength; ny /= normalLength; } else { nx = 0; ny = -1; }
  const rotation = { x: rotationBase.x + 22 * nx, y: rotationBase.y + 22 * ny };
  const directions = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"];
  const cursors = corners.map((corner, index) => {
    const previous = corners[(index + 3) % 4], next = corners[(index + 1) % 4];
    const x1 = corner.x - previous.x, y1 = corner.y - previous.y, x2 = corner.x - next.x, y2 = corner.y - next.y;
    const l1 = Math.hypot(x1, y1), l2 = Math.hypot(x2, y2);
    const angle = Math.atan2((l1 ? y1 / l1 : 0) + (l2 ? y2 / l2 : 0), (l1 ? x1 / l1 : 0) + (l2 ? x2 / l2 : 0));
    return directions[(Math.round(angle / (Math.PI / 4)) + 4) % 4];
  }) as unknown as EditorFrameClientGeometry["cursors"];
  return finitePoint(rotationBase) && finitePoint(rotation) ? { corners, rotationBase, rotation, cursors } : null;
}
