import type { Bounds } from "./pdfVectorExtractor";
import type { EditorMatrix, EditorSession } from "./editorTypes";

export type EditorAlignment = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type EditorDistribution = "horizontal" | "vertical";
export interface EditorAlignmentGuide { axis: "x" | "y"; value: number; start: number; end: number }
const union = (a: Bounds, b: Bounds): Bounds => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) });

function roots(session: EditorSession): string[] {
  const selected = new Set(session.getSelection()), children = new Set<string>();
  const visit = (id: string): void => { const object = session.getObject(id); if (object.kind !== "group") return;
    for (const child of object.children) { children.add(child); visit(child); } };
  selected.forEach(visit); return [...selected].filter(id => !children.has(id));
}
function translate(session: EditorSession, moves: readonly { id: string; x: number; y: number }[], label: string): number {
  if (moves.some(move => session.isObjectLocked(move.id))) throw new Error("Unlock the selected objects before changing their layout.");
  const changed = moves.filter(move => Math.abs(move.x) > 1e-10 || Math.abs(move.y) > 1e-10);
  if (!changed.length) return 0;
  const selected = session.getSelection();
  session.transaction(label, () => {
    for (const move of changed) { session.select([move.id]); session.transformSelection([1, 0, 0, 1, move.x, move.y]); }
    session.select(selected);
  }); return changed.length;
}

/** Align visual bounds independently on each page, preserving object rotations. */
export function alignEditorSelection(session: EditorSession, alignment: EditorAlignment, reference: "selection" | "page" = "selection"): number {
  if (!["left", "center", "right", "top", "middle", "bottom"].includes(alignment)) throw new TypeError("Unknown alignment.");
  const pages = new Map<number, { id: string; bounds: Bounds }[]>();
  for (const id of roots(session)) { const page = session.getObject(id).pageIndex, entries = pages.get(page) ?? [];
    entries.push({ id, bounds: session.getObjectBounds(id) }); pages.set(page, entries); }
  const moves: { id: string; x: number; y: number }[] = [];
  for (const [page, objects] of pages) {
    if (reference === "selection" && objects.length < 2) continue;
    const rect = session.sourceScene.pageRects.subarray(page * 4, page * 4 + 4);
    const bounds = reference === "page" ? { minX: rect[0], minY: rect[1], maxX: rect[2], maxY: rect[3] }
      : objects.map(object => object.bounds).reduce(union);
    for (const object of objects) {
      const b = object.bounds;
      const x = alignment === "left" ? bounds.minX - b.minX : alignment === "center" ? (bounds.minX + bounds.maxX - b.minX - b.maxX) / 2 : alignment === "right" ? bounds.maxX - b.maxX : 0;
      const y = alignment === "bottom" ? bounds.minY - b.minY : alignment === "middle" ? (bounds.minY + bounds.maxY - b.minY - b.maxY) / 2 : alignment === "top" ? bounds.maxY - b.maxY : 0;
      moves.push({ id: object.id, x, y });
    }
  }
  return translate(session, moves, "Align objects");
}

/** Equal visual gaps, keeping the first and last object fixed on each page. */
export function distributeEditorSelection(session: EditorSession, direction: EditorDistribution): number {
  if (direction !== "horizontal" && direction !== "vertical") throw new TypeError("Unknown distribution.");
  const pages = new Map<number, { id: string; bounds: Bounds }[]>();
  for (const id of roots(session)) { const page = session.getObject(id).pageIndex, entries = pages.get(page) ?? [];
    entries.push({ id, bounds: session.getObjectBounds(id) }); pages.set(page, entries); }
  const horizontal = direction === "horizontal", lo = horizontal ? "minX" : "minY", hi = horizontal ? "maxX" : "maxY";
  const moves: { id: string; x: number; y: number }[] = [];
  for (const objects of pages.values()) {
    if (objects.length < 3) continue;
    objects.sort((a, b) => a.bounds[lo] - b.bounds[lo]);
    const first = objects[0].bounds[lo], end = objects[objects.length - 1].bounds[hi];
    const width = objects.reduce((sum, object) => sum + object.bounds[hi] - object.bounds[lo], 0), gap = (end - first - width) / (objects.length - 1);
    let position = first;
    for (const object of objects) {
      const delta = position - object.bounds[lo]; moves.push({ id: object.id, x: horizontal ? delta : 0, y: horizontal ? 0 : delta });
      position += object.bounds[hi] - object.bounds[lo] + gap;
    }
  }
  return translate(session, moves, "Distribute objects");
}

/** Prepare targets once per drag; no scene compilation or document scan per pose. */
export function createEditorAlignmentSnap(session: EditorSession, candidates?: readonly Bounds[]) {
  const selection = roots(session); if (!selection.length) return null;
  const objects = selection.map(id => session.getObject(id)), page = objects[0].pageIndex;
  if (objects.some(object => object.pageIndex !== page || session.isObjectLocked(object.id))) return null;
  const bounds = selection.map(id => session.getObjectBounds(id)).reduce(union), rect = session.sourceScene.pageRects.subarray(page * 4, page * 4 + 4);
  const pageBounds: Bounds = { minX: rect[0], minY: rect[1], maxX: rect[2], maxY: rect[3] }, excluded = new Set(selection);
  const exclude = (id: string): void => { const object = session.getObject(id); if (object.kind === "group") for (const child of object.children) { excluded.add(child); exclude(child); } };
  selection.forEach(exclude);
  const known = session.getObjects({ pageIndex: page });
  // A parent containing a selected child is not an independent snap target.
  let changed = true;
  while (changed) { changed = false; for (const object of known) if (object.kind === "group" && !excluded.has(object.id) && object.children.some(id => excluded.has(id))) { excluded.add(object.id); changed = true; } }
  const targets = [pageBounds, ...(candidates ?? known.filter(object => !excluded.has(object.id) && session.isObjectVisible(object.id))
    .map(object => session.getObjectBounds(object.id)))];
  const axes = (axis: "x" | "y") => targets.flatMap(target => axis === "x" ? [target.minX, (target.minX + target.maxX) / 2, target.maxX]
    : [target.minY, (target.minY + target.maxY) / 2, target.maxY]).sort((a, b) => a - b);
  const xTargets = axes("x"), yTargets = axes("y");
  function nearest(values: readonly number[], value: number): number | undefined {
    let low = 0, high = values.length;
    while (low < high) { const mid = (low + high) >>> 1; if (values[mid] < value) low = mid + 1; else high = mid; }
    const a = values[low], b = values[low - 1]; return a === undefined ? b : b === undefined || Math.abs(a - value) < Math.abs(b - value) ? a : b;
  }
  return { pageIndex: page, snap(matrix: EditorMatrix, tolerance: number, disabled = false): { matrix: EditorMatrix; guides: readonly EditorAlignmentGuide[] } {
    if (disabled || !Number.isFinite(tolerance) || tolerance < 0 || matrix[0] !== 1 || matrix[1] || matrix[2] || matrix[3] !== 1) return { matrix, guides: [] };
    let dx = matrix[4], dy = matrix[5]; const guides: EditorAlignmentGuide[] = [];
    for (const axis of ["x", "y"] as const) {
      const values = axis === "x" ? xTargets : yTargets, shift = axis === "x" ? dx : dy;
      const edges = axis === "x" ? [bounds.minX, (bounds.minX + bounds.maxX) / 2, bounds.maxX] : [bounds.minY, (bounds.minY + bounds.maxY) / 2, bounds.maxY];
      let best: { correction: number; value: number } | null = null;
      for (const edge of edges) { const target = nearest(values, edge + shift); if (target === undefined) continue;
        const correction = target - edge - shift; if (Math.abs(correction) <= tolerance && (!best || Math.abs(correction) < Math.abs(best.correction))) best = { correction, value: target }; }
      if (best) {
        if (axis === "x") dx += best.correction; else dy += best.correction;
        guides.push({ axis, value: best.value, start: axis === "x" ? Math.min(pageBounds.minY, bounds.minY + dy) : Math.min(pageBounds.minX, bounds.minX + dx),
          end: axis === "x" ? Math.max(pageBounds.maxY, bounds.maxY + dy) : Math.max(pageBounds.maxX, bounds.maxX + dx) });
      }
    }
    return { matrix: [1, 0, 0, 1, dx, dy], guides };
  } };
}
