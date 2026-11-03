import type { EditorShapeObject } from "./editorTypes";

export type EditorShapePoint = readonly [number, number];
export type EditorShapeGeometryInput = Pick<EditorShapeObject, "shape" | "x" | "y" | "width" | "height" | "points" | "strokeWidth">;
export interface EditorShapeGeometry {
  paths: readonly (readonly EditorShapePoint[])[];
  closed: boolean;
  arrowhead?: readonly EditorShapePoint[];
}

/** The same local arrowhead is used for rendering, previews and interaction bounds. */
export function editorArrowHeadPoints(object: EditorShapeGeometryInput): readonly EditorShapePoint[] {
  const endpoints = object.points?.length === 2 ? object.points : [[object.x, object.y], [object.x + object.width, object.y + object.height]];
  const start = endpoints[0], end = endpoints[1], [x, y] = end;
  const angle = Math.atan2(end[1] - start[1], end[0] - start[0]), size = Math.max((object.strokeWidth ?? 1) * 4, 8);
  return [[x, y], [x - size * Math.cos(angle - Math.PI / 6), y - size * Math.sin(angle - Math.PI / 6)],
    [x - size * Math.cos(angle + Math.PI / 6), y - size * Math.sin(angle + Math.PI / 6)]];
}

/** Canonical page-local outlines shared by live previews and scene compilation. */
export function editorShapeGeometry(object: EditorShapeGeometryInput, signal?: AbortSignal): EditorShapeGeometry {
  signal?.throwIfAborted();
  const { x, y, width, height } = object;
  let paths: readonly (readonly EditorShapePoint[])[], closed = false;
  if (object.shape === "ellipse") {
    // Bound centerline error in page points, independent of the number of marks.
    const radius = Math.max(width, height) / 2;
    // Subdivision below Float32 coordinate precision cannot improve the
    // canonical contour and would make very large valid coordinates stall.
    const tolerance = Math.max(0.002, radius * 2 ** -22), ratio = tolerance / Math.max(radius, tolerance);
    const angle = ratio < 1e-6 ? Math.sqrt(2 * ratio) : Math.acos(Math.max(-1, 1 - ratio));
    const count = Math.max(16, Math.ceil(Math.PI / angle));
    const points: EditorShapePoint[] = [];
    for (let i = 0; i < count; i++) {
      signal?.throwIfAborted(); const angle = i / count * Math.PI * 2;
      points.push([x + width / 2 * (1 + Math.cos(angle)), y + height / 2 * (1 + Math.sin(angle))]);
    }
    paths = [points]; closed = true;
  } else if (object.shape === "rectangle") { paths = [[[x, y], [x + width, y], [x + width, y + height], [x, y + height]]]; closed = true; }
  else if (object.shape === "polygon" || object.shape === "polyline") { paths = [object.points ?? []]; closed = object.shape === "polygon"; }
  else { paths = [object.points?.length === 2 ? object.points : [[x, y], [x + width, y + height]]]; }
  return { paths, closed, ...(object.shape === "arrow" ? { arrowhead: editorArrowHeadPoints(object) } : {}) };
}
