import type { PrimitivePoint } from "./scenePrimitives";
import type { SceneAnnotation, ScenePdfPage } from "./annotationData";
import type { Bounds } from "./pdfVectorExtractor";
import type { EditorMatrix } from "./editorTypes";

/** Project native PDF axes through page placement and any editor transform. */
export function editorFieldClientGeometry(annotation: SceneAnnotation, pages: readonly ScenePdfPage[] | undefined,
  project: (point: PrimitivePoint, pageIndex: number) => PrimitivePoint | null, sceneTransform?: EditorMatrix):
  { origin: PrimitivePoint; width: number; height: number; transform: EditorMatrix } | null {
  const rect = annotation.pdfGeometry?.rect, matrix = pages?.find(page => page.pageIndex === annotation.pageIndex)?.pdfToScene;
  if (!rect || rect.length !== 4 || !rect.every(Number.isFinite) || !matrix || matrix.length !== 6 || !matrix.every(Number.isFinite)) return null;
  if (sceneTransform && (sceneTransform.length !== 6 || !sceneTransform.every(Number.isFinite))) return null;
  const minX = Math.min(rect[0], rect[2]), maxX = Math.max(rect[0], rect[2]), minY = Math.min(rect[1], rect[3]), maxY = Math.max(rect[1], rect[3]);
  const width = maxX - minX, height = maxY - minY;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const [a, b, c, d, e, f] = matrix;
  const map = (x: number, y: number): PrimitivePoint | null => {
    let point = { x: a * x + c * y + e, y: b * x + d * y + f };
    if (sceneTransform) {
      const [ta, tb, tc, td, te, tf] = sceneTransform;
      point = { x: ta * point.x + tc * point.y + te, y: tb * point.x + td * point.y + tf };
    }
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const result = project(point, annotation.pageIndex);
    return result && Number.isFinite(result.x) && Number.isFinite(result.y) ? result : null;
  };
  const origin = map(minX, maxY), alongX = map(minX + 1, maxY), alongY = map(minX, maxY - 1);
  if (!origin || !alongX || !alongY) return null;
  const transform: EditorMatrix = [alongX.x - origin.x, alongX.y - origin.y, alongY.x - origin.x, alongY.y - origin.y, 0, 0];
  const determinant = transform[0] * transform[3] - transform[1] * transform[2];
  if (!transform.every(Number.isFinite) || !Number.isFinite(determinant) || determinant === 0) return null;
  return { origin, width, height, transform };
}

export function editorPageAtPoint(rects: Float32Array, point: PrimitivePoint): number {
  for (let i = 0; i < rects.length; i += 4) if (point.x >= rects[i] && point.x <= rects[i + 2] && point.y >= rects[i + 1] && point.y <= rects[i + 3]) return i / 4;
  return -1;
}

/** A small CSS-pixel click tolerance keeps hairlines usable at every zoom. */
export function editorBoundsClickHit(bounds: Bounds, point: PrimitivePoint, client: PrimitivePoint,
  project: (point: PrimitivePoint) => PrimitivePoint | null, tolerancePx = 4): boolean {
  if (point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY) return true;
  const corners = [[bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY]]
    .map(([x, y]) => project({ x, y }));
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length]; if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
    const t = length2 ? Math.max(0, Math.min(1, ((client.x - a.x) * dx + (client.y - a.y) * dy) / length2)) : 0;
    if ((client.x - a.x - t * dx) ** 2 + (client.y - a.y - t * dy) ** 2 <= tolerancePx * tolerancePx) return true;
  }
  return false;
}

/** Reader/grid layout is presentation; edit-session coordinates remain stable. */
export function remapEditorPagePoint(point: PrimitivePoint, from: Float32Array, to: Float32Array, pageIndex?: number): PrimitivePoint | null {
  const page = pageIndex ?? editorPageAtPoint(from, point), offset = page * 4;
  if (page < 0 || offset + 3 >= from.length || offset + 3 >= to.length) return null;
  return { x: point.x - from[offset] + to[offset], y: point.y - from[offset + 1] + to[offset + 1] };
}

/** Empty widgets and other annotations may have bounds without any paint primitives. */
export function pickEditorMetadataAnnotation(annotations: readonly SceneAnnotation[], point: PrimitivePoint,
  getBounds: (annotation: SceneAnnotation) => Bounds, hasPaint: (annotation: SceneAnnotation) => boolean = annotation => annotation.hasAppearance): string | null {
  let id: string | null = null, area = Infinity;
  for (const annotation of annotations) {
    if (!annotation.visibleInDefaultView || hasPaint(annotation) || annotation.subtype === "Popup") continue;
    const bounds = getBounds(annotation);
    if (point.x < bounds.minX || point.x > bounds.maxX || point.y < bounds.minY || point.y > bounds.maxY) continue;
    const nextArea = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
    if (nextArea <= area) { area = nextArea; id = annotation.id; }
  }
  return id;
}

/** Conjugate a composed-scene edit into a textbox's page-local transform. */
export function transformEditorAnnotationText(matrix: EditorMatrix, delta: EditorMatrix, pageX: number, pageY: number): EditorMatrix {
  const [a, b, c, d] = delta, e = a * pageX + c * pageY + delta[4] - pageX, f = b * pageX + d * pageY + delta[5] - pageY;
  const [m0, m1, m2, m3, m4, m5] = matrix;
  return [a * m0 + c * m1, b * m0 + d * m1, a * m2 + c * m3, b * m2 + d * m3, a * m4 + c * m5 + e, b * m4 + d * m5 + f];
}
