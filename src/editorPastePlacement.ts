import { editorPageAtPoint } from "./editorCoordinates";
import type { EditorPasteOptions } from "./editorTypes";
import type { PrimitivePoint } from "./scenePrimitives";

/** Resolve against the current camera, never a remembered document-space cursor. */
export function resolveEditorPasteTarget(rects: Float32Array,
  viewport: { left: number; top: number; width: number; height: number },
  project: (x: number, y: number, pageIndex: number) => PrimitivePoint | null,
  unproject: (x: number, y: number) => PrimitivePoint | null,
  client: PrimitivePoint | null): EditorPasteOptions["target"] {
  if (!rects.length) return undefined;
  const right = viewport.left + viewport.width, bottom = viewport.top + viewport.height;
  if (client && client.x >= viewport.left && client.x <= right && client.y >= viewport.top && client.y <= bottom) {
    const point = unproject(client.x, client.y), pageIndex = point ? editorPageAtPoint(rects, point) : -1;
    if (point && pageIndex >= 0) return { pageIndex, center: [point.x, point.y] };
  }
  const middle = { x: viewport.left + viewport.width / 2, y: viewport.top + viewport.height / 2 };
  let pageIndex = 0, largestArea = -1, nearest = Infinity;
  for (let i = 0; i + 3 < rects.length; i += 4) {
    const index = i / 4, corners = [[rects[i], rects[i + 1]], [rects[i + 2], rects[i + 1]],
      [rects[i + 2], rects[i + 3]], [rects[i], rects[i + 3]]].map(([x, y]) => project(x, y, index));
    if (corners.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) continue;
    const points = corners as PrimitivePoint[], minX = Math.min(...points.map(point => point.x)), maxX = Math.max(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y)), maxY = Math.max(...points.map(point => point.y));
    const area = Math.max(0, Math.min(right, maxX) - Math.max(viewport.left, minX)) *
      Math.max(0, Math.min(bottom, maxY) - Math.max(viewport.top, minY));
    const distance = ((minX + maxX) / 2 - middle.x) ** 2 + ((minY + maxY) / 2 - middle.y) ** 2;
    if (area > largestArea || area === largestArea && distance < nearest) { pageIndex = index; largestArea = area; nearest = distance; }
  }
  const i = pageIndex * 4;
  return { pageIndex, center: [(rects[i] + rects[i + 2]) / 2, (rects[i + 1] + rects[i + 3]) / 2] };
}
