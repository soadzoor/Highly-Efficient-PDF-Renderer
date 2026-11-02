import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import type { EditorColor, EditorReviewMetadata, EditorReviewQuad, EditorSession, EditorShapeObject } from "./editorTypes";
import type { TextSelectionSpan } from "./textSelection";
import { computeCharQuad } from "./sceneTextGeometry";
import { createDefaultOptionalContentSnapshot } from "./optionalContent";
import { isSceneTextCharVisible } from "./optionalContentText";
import { editorPoint, invertEditorMatrix } from "./editorScene";

export function validateEditorReviewMetadata(value: EditorReviewMetadata): void {
  if (!value || !["highlight", "underline", "strikeout", "comment"].includes(value.type)) throw new TypeError("Unknown review annotation type.");
  if (value.contents !== undefined && typeof value.contents !== "string" || value.author !== undefined && typeof value.author !== "string") throw new TypeError("Review text and author must be strings.");
  if (value.type !== "comment" && (!value.quads?.length || value.quads.some(quad => quad.length !== 4 || quad.some(point => point.length !== 2 || point.some(n => !Number.isFinite(n)))))) throw new TypeError("Text markup requires finite text quadrilaterals.");
}

/** Glyph-derived, oriented line quadrilaterals in current scene coordinates. */
export function editorTextMarkupQuads(scene: VectorScene, spans: readonly TextSelectionSpan[]): ReadonlyMap<number, readonly EditorReviewQuad[]> {
  const result = new Map<number, EditorReviewQuad[]>(), visibility = createDefaultOptionalContentSnapshot(scene), scratch = new Float32Array(4);
  for (const span of spans) {
    const page = scene.textIndex?.pages[span.pageIndex]; if (!page) continue;
    if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.length) || span.start < 0 || span.length < 0 || span.start + span.length > page.text.length) throw new RangeError("Text markup span is outside the page.");
    const quads = result.get(span.pageIndex) ?? []; result.set(span.pageIndex, quads);
    let line: { ux: number; uy: number; baseline: number; minU: number; maxU: number; minV: number; maxV: number; height: number } | null = null;
    const seen = new Set<number>();
    const flush = () => {
      if (!line) return;
      const { ux, uy } = line, nx = -uy, ny = ux, pad = Math.max(line.height * .10, .1);
      const point = (u: number, v: number): [number, number] => [ux * u + nx * v, uy * u + ny * v];
      quads.push([point(line.minU - pad / 2, line.maxV + pad), point(line.maxU + pad / 2, line.maxV + pad),
        point(line.minU - pad / 2, line.minV - pad), point(line.maxU + pad / 2, line.minV - pad)]); line = null;
    };
    for (let index = span.start; index < span.start + span.length; index++) {
      const ref = page.charInstance[index]; if (ref === -1 || ref === undefined || seen.has(ref) || !isSceneTextCharVisible(scene, page, index, visibility) || !computeCharQuad(scene, page, index, scratch, 0)) continue;
      seen.add(ref); let ux = 1, uy = 0, baseline = scratch[1];
      let points: [number, number][] = [[scratch[0], scratch[1]], [scratch[2], scratch[1]], [scratch[2], scratch[3]], [scratch[0], scratch[3]]];
      if (ref >= 0) {
        const i = ref * 4, a = scene.textInstanceA[i], b = scene.textInstanceA[i + 1], c = scene.textInstanceA[i + 2], d = scene.textInstanceA[i + 3], e = scene.textInstanceB[i], f = scene.textInstanceB[i + 1];
        const length = Math.hypot(a, b); if (length > 0) { ux = a / length; uy = b / length; }
        const glyph = Math.trunc(scene.textInstanceB[i + 2]) * 4, x0 = scene.textGlyphMetaA[glyph + 2], y0 = scene.textGlyphMetaA[glyph + 3], x1 = scene.textGlyphMetaB[glyph], y1 = scene.textGlyphMetaB[glyph + 1];
        if (!(scene.textInstanceB[i + 3] > 0)) points = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
        baseline = -uy * e + ux * f;
      }
      const us = points.map(([x, y]) => ux * x + uy * y), vs = points.map(([x, y]) => -uy * x + ux * y);
      const minU = Math.min(...us), maxU = Math.max(...us), minV = Math.min(...vs), maxV = Math.max(...vs), height = Math.max(maxV - minV, .1);
      const joins = line && line.ux * ux + line.uy * uy > .98 && Math.abs(line.baseline - baseline) < Math.max(line.height, height) * .5 && minU - line.maxU < Math.max(line.height, height) * 3;
      if (!joins) { flush(); line = { ux, uy, baseline, minU, maxU, minV, maxV, height }; }
      else if (line) { line.minU = Math.min(line.minU, minU); line.maxU = Math.max(line.maxU, maxU); line.minV = Math.min(line.minV, minV); line.maxV = Math.max(line.maxV, maxV); line.height = Math.max(line.height, height); }
    }
    flush();
  }
  return result;
}

export function editorReviewShapes(object: EditorShapeObject): readonly EditorShapeObject[] {
  const review = object.review; if (!review) return [object]; validateEditorReviewMetadata(review);
  if (review.type === "comment") return [{ ...object, review: undefined, shape: "polygon", fill: object.fill ?? "#ffe07a", color: object.color ?? "#735a12", strokeWidth: object.strokeWidth ?? 1,
    points: [[object.x, object.y + object.height], [object.x + object.width, object.y + object.height], [object.x + object.width, object.y + 4], [object.x + 8, object.y + 4], [object.x + 3, object.y], [object.x + 3, object.y + 4], [object.x, object.y + 4]] }];
  return review.quads!.map(quad => {
    if (review.type === "highlight") return { ...object, review: undefined, shape: "polygon", strokeWidth: 0, color: object.color ?? "#ffe04a", fill: object.fill ?? object.color ?? "#ffe04a", fillOpacity: object.fillOpacity ?? object.opacity ?? .3, points: [quad[0], quad[1], quad[3], quad[2]] };
    const mix = review.type === "underline" ? 0 : .5;
    const point = (top: readonly [number, number], bottom: readonly [number, number]): [number, number] => [bottom[0] + (top[0] - bottom[0]) * mix, bottom[1] + (top[1] - bottom[1]) * mix];
    return { ...object, review: undefined, shape: "line", fill: null, points: [point(quad[0], quad[2]), point(quad[1], quad[3])], strokeWidth: object.strokeWidth ?? 1 };
  });
}

export function addEditorTextMarkup(session: EditorSession, scene: VectorScene, spans: readonly TextSelectionSpan[], type: "highlight" | "underline" | "strikeout",
  options: { color?: EditorColor; opacity?: number; contents?: string; author?: string } = {}): readonly string[] {
  const ids: string[] = [], pages = editorTextMarkupQuads(scene, spans);
  session.transaction("Add text markup", () => {
    for (const [pageIndex, sceneQuads] of pages) {
      if (!sceneQuads.length) continue;
      const x = session.sourceScene.pageRects[pageIndex * 4], y = session.sourceScene.pageRects[pageIndex * 4 + 1];
      const quads = sceneQuads.map(quad => quad.map(point => [point[0] - x, point[1] - y] as const) as unknown as EditorReviewQuad), points = quads.flatMap(quad => [...quad]);
      const bounds = points.reduce<Bounds>((b, [x, y]) => ({ minX: Math.min(b.minX, x), minY: Math.min(b.minY, y), maxX: Math.max(b.maxX, x), maxY: Math.max(b.maxY, y) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
      ids.push(session.addObject({ kind: "shape", shape: "polygon", pageIndex, x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY,
        points, color: options.color ?? (type === "highlight" ? "#ffe04a" : "#cc3030"), opacity: options.opacity ?? (type === "highlight" ? .3 : 1), strokeWidth: type === "highlight" ? 0 : 1,
        review: { type, quads, contents: options.contents, author: options.author } }));
    }
    session.select(ids);
  }); return ids;
}

type ToggleMarkup = "underline" | "strikeout";
interface TextMarkup {
  id: string; pageIndex: number; quads: readonly EditorReviewQuad[]; object?: EditorShapeObject;
  style: { color?: EditorColor; opacity?: number; strokeWidth?: number };
  contents?: string; author?: string;
}
function markupBounds(points: readonly (readonly [number, number])[]): Bounds {
  return points.reduce<Bounds>((bounds, [x, y]) => ({ minX: Math.min(bounds.minX, x), minY: Math.min(bounds.minY, y),
    maxX: Math.max(bounds.maxX, x), maxY: Math.max(bounds.maxY, y) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}
function markupColor(channels: readonly number[] | undefined): EditorColor | undefined {
  if (!channels?.length) return undefined;
  if (channels.length === 1) return [channels[0], channels[0], channels[0]];
  if (channels.length === 3) return [channels[0], channels[1], channels[2]];
  if (channels.length === 4) return [0, 1, 2].map(index => 1 - Math.min(1, channels[index] + channels[3])) as [number, number, number];
  return undefined;
}

/** Match line ranges in the quad's own axes, including rotated or sheared text. */
function markupInterval(quad: EditorReviewQuad, cutter: EditorReviewQuad): readonly [number, number] | null {
  const [x, y] = quad[0], ux = quad[1][0] - x, uy = quad[1][1] - y, vx = quad[2][0] - x, vy = quad[2][1] - y;
  const determinant = ux * vy - uy * vx; if (Math.abs(determinant) < 1e-12) return null;
  const cx = cutter[1][0] - cutter[0][0], cy = cutter[1][1] - cutter[0][1];
  if (Math.abs(ux * cx + uy * cy) < Math.hypot(ux, uy) * Math.hypot(cx, cy) * .98) return null;
  const points = cutter.map(([cx, cy]) => [((cx - x) * vy - (cy - y) * vx) / determinant,
    (ux * (cy - y) - uy * (cx - x)) / determinant]);
  const minV = Math.min(...points.map(p => p[1])), maxV = Math.max(...points.map(p => p[1]));
  // Adjacent lines must not acquire each other's formatting through quad padding.
  if (Math.min(1, maxV) - Math.max(0, minV) < Math.min(1, maxV - minV) * .5) return null;
  const a = Math.max(0, Math.min(...points.map(p => p[0]))), b = Math.min(1, Math.max(...points.map(p => p[0])));
  return b - a > 1e-6 ? [a, b] : null;
}
function sliceMarkupQuad(quad: EditorReviewQuad, a: number, b: number): EditorReviewQuad {
  const mix = (left: readonly [number, number], right: readonly [number, number], t: number): readonly [number, number] =>
    [left[0] + (right[0] - left[0]) * t, left[1] + (right[1] - left[1]) * t];
  return [mix(quad[0], quad[1], a), mix(quad[0], quad[1], b), mix(quad[2], quad[3], a), mix(quad[2], quad[3], b)];
}
function subtractMarkup(quad: EditorReviewQuad, cutters: readonly EditorReviewQuad[]): EditorReviewQuad[] {
  const intervals = cutters.flatMap(cutter => { const interval = markupInterval(quad, cutter); return interval ? [interval] : []; }).sort((a, b) => a[0] - b[0]);
  const remaining: EditorReviewQuad[] = []; let offset = 0;
  for (const [start, end] of intervals) {
    if (start > offset + 1e-6) remaining.push(sliceMarkupQuad(quad, offset, start));
    offset = Math.max(offset, end);
  }
  if (offset < 1 - 1e-6) remaining.push(sliceMarkupQuad(quad, offset, 1));
  return remaining;
}
function textMarkups(session: EditorSession, scene: VectorScene, type: ToggleMarkup): TextMarkup[] {
  const result: TextMarkup[] = [];
  for (const object of session.getObjects()) {
    if (object.kind !== "shape" || object.review?.type !== type || !session.isObjectVisible(object.id)) continue;
    const x = session.sourceScene.pageRects[object.pageIndex * 4], y = session.sourceScene.pageRects[object.pageIndex * 4 + 1];
    result.push({ id: object.id, object, pageIndex: object.pageIndex,
      quads: object.review.quads!.map(quad => quad.map(([px, py]) => { const point = editorPoint(object.transform, px, py); return [point[0] + x, point[1] + y] as const; }) as unknown as EditorReviewQuad),
      style: { color: object.color, opacity: object.opacity, strokeWidth: object.strokeWidth }, contents: object.review.contents, author: object.review.author });
  }
  const subtype = type === "underline" ? "Underline" : "StrikeOut";
  for (const annotation of scene.annotations ?? []) {
    if (annotation.subtype !== subtype || !annotation.quadPoints?.length || !session.sourceScene.annotations?.some(source => source.id === annotation.id) || !session.isAnnotationVisible(annotation.id)) continue;
    const quads: EditorReviewQuad[] = [];
    for (let i = 0; i + 7 < annotation.quadPoints.length; i += 8) quads.push(Array.from({ length: 4 }, (_, j) =>
      [annotation.quadPoints![i + j * 2], annotation.quadPoints![i + j * 2 + 1]] as const) as unknown as EditorReviewQuad);
    const id = `annotation:${annotation.id}`; session.getObject(id);
    result.push({ id, pageIndex: annotation.pageIndex, quads, style: { color: markupColor(annotation.color),
      opacity: annotation.opacity, strokeWidth: annotation.border?.width }, contents: annotation.contents, author: annotation.author });
  }
  return result;
}

/** Read selection formatting from visible authored and standard PDF review annotations. */
export function editorTextMarkupState(session: EditorSession, scene: VectorScene, spans: readonly TextSelectionSpan[], type: ToggleMarkup): { value: boolean; mixed: boolean } {
  const marks = textMarkups(session, scene, type); let any = false, all = true, count = 0;
  for (const [pageIndex, quads] of editorTextMarkupQuads(scene, spans)) {
    const cutters = marks.filter(mark => mark.pageIndex === pageIndex).flatMap(mark => [...mark.quads]);
    for (const quad of quads) { count++; const remaining = subtractMarkup(quad, cutters);
      const covered = cutters.some(cutter => markupInterval(quad, cutter)); any ||= covered; all &&= remaining.length === 0; }
  }
  return { value: count > 0 && all, mixed: any && !all };
}

/** Apply or remove only the selected line ranges, retaining the rest and one undo step. */
export function setEditorTextMarkup(session: EditorSession, scene: VectorScene, spans: readonly TextSelectionSpan[], type: ToggleMarkup, enabled: boolean,
  style: { color?: EditorColor; opacity?: number; contents?: string; author?: string } = {}): readonly string[] {
  const pages = editorTextMarkupQuads(scene, spans), marks = textMarkups(session, scene, type), added: string[] = [], selection = session.getSelection();
  const insert = (pageIndex: number, quads: readonly EditorReviewQuad[], source?: TextMarkup): string | null => {
    if (!quads.length) return null;
    const x = session.sourceScene.pageRects[pageIndex * 4], y = session.sourceScene.pageRects[pageIndex * 4 + 1];
    const local = quads.map(quad => quad.map(([px, py]) => [px - x, py - y] as const) as unknown as EditorReviewQuad), points = local.flatMap(quad => [...quad]);
    const bounds = markupBounds(points);
    const id = session.addObject({ kind: "shape", shape: "polygon", pageIndex, x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY, points,
      color: source?.style.color ?? style.color ?? "#111111", opacity: source?.style.opacity ?? style.opacity ?? 1, strokeWidth: source?.style.strokeWidth ?? 1,
      review: { type, quads: local, contents: source?.contents ?? style.contents, author: source?.author ?? style.author } });
    if (source) session.copyObjectLayerMembership(source.id, id);
    added.push(id); return id;
  };
  session.transaction(enabled ? "Apply text formatting" : "Remove text formatting", () => {
    if (enabled) for (const [pageIndex, quads] of pages) {
      const cutters = marks.filter(mark => mark.pageIndex === pageIndex).flatMap(mark => [...mark.quads]), missing: EditorReviewQuad[] = [];
      for (const quad of quads) { const parts = subtractMarkup(quad, [...cutters, ...missing]); missing.push(...parts); }
      insert(pageIndex, missing);
    }
    else for (const mark of marks) {
      const cutters = pages.get(mark.pageIndex); if (!cutters || session.isObjectLocked(mark.id) || !mark.quads.some(quad => cutters.some(cutter => markupInterval(quad, cutter)))) continue;
      const remaining = mark.quads.flatMap(quad => subtractMarkup(quad, cutters));
      if (mark.object && remaining.length) {
        const object = mark.object, inverse = invertEditorMatrix(object.transform), x = session.sourceScene.pageRects[mark.pageIndex * 4], y = session.sourceScene.pageRects[mark.pageIndex * 4 + 1];
        const quads = remaining.map(quad => quad.map(([px, py]) => editorPoint(inverse, px - x, py - y)) as unknown as EditorReviewQuad), points = quads.flatMap(quad => [...quad]);
        const bounds = markupBounds(points);
        session.updateObject(object.id, { x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY, points, review: { ...object.review!, quads } });
      } else { session.select([mark.id]); session.deleteSelection(); insert(mark.pageIndex, remaining, mark); }
    }
    session.select(selection.filter(id => { try { return session.isObjectVisible(id); } catch { return false; } }));
  });
  return added;
}

export function addEditorComment(session: EditorSession, pageIndex: number, x: number, y: number, contents: string, author = "", style: { color?: EditorColor; opacity?: number } = {}): string {
  if (!contents.trim()) throw new Error("Enter a comment.");
  return session.addObject({ kind: "shape", shape: "rectangle", pageIndex, x, y, width: 20, height: 20, color: "#735a12", fill: style.color ?? "#ffe07a", opacity: style.opacity ?? 1,
    strokeWidth: 1, review: { type: "comment", contents, author } });
}

