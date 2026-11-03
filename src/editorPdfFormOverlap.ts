import type { SceneAnnotation } from "./annotationData";
import type { EditorObject, EditorSession } from "./editorTypes";
import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import { editorPoint, getEditorAnnotationFrameTransform, getEditorAnnotationSource } from "./editorScene";
import { createDefaultOptionalContentSnapshot } from "./optionalContent";
import { editorObjectHasVisiblePaint } from "./editorObjectOpacity";

export interface EditorPdfFormOverlap {
  pageIndex: number;
  widgetId: string;
  fieldName?: string;
  objectId: string;
  objectKind: EditorObject["kind"] | "annotation";
  annotationSubtype?: string;
}

type Point = readonly [number, number];
interface Widget { annotation: SceneAnnotation; bounds: Bounds; quad?: readonly Point[] }

function intersect(a: Bounds, b: Bounds, includeBoundary = false): Bounds | null {
  const result = { minX: Math.max(a.minX, b.minX), minY: Math.max(a.minY, b.minY),
    maxX: Math.min(a.maxX, b.maxX), maxY: Math.min(a.maxY, b.maxY) };
  return (includeBoundary ? result.minX <= result.maxX && result.minY <= result.maxY
    : result.minX < result.maxX && result.minY < result.maxY) ? result : null;
}

function corners(bounds: Bounds): Point[] {
  return [[bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY]];
}

/** AABB checks supply the rectangle axes; test the transformed widget's axes too. */
function intersectsQuad(bounds: Bounds, quad: readonly Point[], includeBoundary: boolean): boolean {
  for (let index = 0; index < quad.length; index++) {
    const a = quad[index], b = quad[(index + 1) % quad.length], x = a[1] - b[1], y = b[0] - a[0];
    if (x === 0 && y === 0) continue;
    const values = quad.map(point => point[0] * x + point[1] * y);
    const low = (x >= 0 ? bounds.minX : bounds.maxX) * x + (y >= 0 ? bounds.minY : bounds.maxY) * y;
    const high = (x >= 0 ? bounds.maxX : bounds.minX) * x + (y >= 0 ? bounds.maxY : bounds.minY) * y;
    const overlap = Math.min(high, Math.max(...values)) - Math.max(low, Math.min(...values));
    if (includeBoundary ? overlap < 0 : overlap <= 0) return false;
  }
  return true;
}

/**
 * Potential editable-PDF layering differences: some readers paint form widgets
 * after ordinary annotations. Supply a committed scene and its matching session
 * snapshot. Bounds are conservative; an overlap does not prove opaque coverage.
 * This query performs no compilation, picking, or persistent scene changes.
 * The caller determines whether the chosen output retains native form widgets.
 */
export function findEditorPdfFormOverlaps(scene: VectorScene,
  session: Pick<EditorSession, "getObjects" | "getObjectBounds">,
  options: { signal?: AbortSignal } = {}): EditorPdfFormOverlap[] {
  const signal = options.signal; signal?.throwIfAborted();
  let visibility: Uint8Array | undefined;
  const visible = (annotation: SceneAnnotation): boolean => {
    if ((annotation.flags & (1 | 2 | 32)) !== 0) return false;
    if (annotation.optionalContent === undefined) return annotation.visibleInDefaultView;
    visibility ??= createDefaultOptionalContentSnapshot(scene).conditions;
    return visibility[annotation.optionalContent] === 1;
  };
  const pageBounds = (index: number): Bounds | null => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= scene.pageCount) return null;
    const offset = index * 4, r = scene.pageRects;
    return { minX: r[offset], minY: r[offset + 1], maxX: r[offset + 2], maxY: r[offset + 3] };
  };
  const pages = new Map<number, { bounds: Bounds; widgets: Widget[] }>();
  for (const annotation of scene.annotations ?? []) {
    signal?.throwIfAborted();
    if (annotation.subtype !== "Widget" || !visible(annotation)) continue;
    const page = pageBounds(annotation.pageIndex), bounds = page && intersect(annotation.bounds, page);
    if (!page || !bounds) continue;
    const source = getEditorAnnotationSource(scene, annotation.id), transform = getEditorAnnotationFrameTransform(scene, annotation.id);
    const quad = source && transform ? corners(source.bounds).map(([x, y]) => editorPoint(transform, x, y)) : undefined;
    let entry = pages.get(annotation.pageIndex);
    if (!entry) pages.set(annotation.pageIndex, entry = { bounds: page, widgets: [] });
    entry.widgets.push({ annotation, bounds, quad });
  }
  if (!pages.size) return [];
  const overlaps: EditorPdfFormOverlap[] = [];
  const include = (pageIndex: number, bounds: Bounds, objectId: string, objectKind: EditorPdfFormOverlap["objectKind"],
    annotation?: SceneAnnotation): void => {
    // PDF hairlines and point strokes can paint with zero-area geometric bounds.
    // Keep their boundary intersections without expanding ordinary artwork.
    const includeBoundary = bounds.minX === bounds.maxX || bounds.minY === bounds.maxY;
    const page = pages.get(pageIndex), clipped = page && intersect(bounds, page.bounds, includeBoundary);
    if (!page || !clipped) return;
    for (const widget of page.widgets) {
      signal?.throwIfAborted();
      if (annotation && annotation.annotationIndex <= widget.annotation.annotationIndex) continue;
      if (!intersect(clipped, widget.bounds, includeBoundary) || widget.quad && !intersectsQuad(clipped, widget.quad, includeBoundary)) continue;
      overlaps.push({ pageIndex, widgetId: widget.annotation.id,
        ...(widget.annotation.field?.name ? { fieldName: widget.annotation.field.name } : {}), objectId, objectKind,
        ...(annotation ? { annotationSubtype: annotation.subtype } : {}) });
    }
  };
  for (const object of session.getObjects()) {
    signal?.throwIfAborted();
    if (object.kind === "group" || object.kind === "source" && !object.isClone ||
      object.kind !== "source" && !editorObjectHasVisiblePaint(object) || !pages.has(object.pageIndex)) continue;
    if (object.kind === "text" && !(object.runs?.map(run => run.text).join("") ?? object.text)) continue;
    if ((object.kind === "ink" || object.kind === "signature") && !object.paths.some(path => path.length)) continue;
    include(object.pageIndex, session.getObjectBounds(object.id), object.id, object.kind);
  }
  // Reopened author objects and page-operation results may now be ordinary
  // annotations. Readers can synthesize visible markups even without an AP.
  for (const annotation of scene.annotations ?? []) {
    signal?.throwIfAborted();
    if (["Widget", "Popup", "Link"].includes(annotation.subtype) || !visible(annotation)) continue;
    include(annotation.pageIndex, annotation.bounds, `annotation:${annotation.id}`, "annotation", annotation);
  }
  return overlaps;
}
