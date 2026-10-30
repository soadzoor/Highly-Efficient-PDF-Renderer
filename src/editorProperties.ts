import type { EditorObject, EditorSession, EditorTextObject } from "./editorTypes";
import { normalizePrimitiveColor } from "./colorInput";

export type EditorAppearanceProperty = "color" | "strokeWidth" | "fill" | "fontId" | "fontFamily" | "fontSize" | "align" |
  "fontWeight" | "fontStyle" | "underline" | "strikethrough";
const textProperties = new Set<EditorAppearanceProperty>(["fontId", "fontFamily", "fontSize", "align", "fontWeight", "fontStyle", "underline", "strikethrough"]);
const appearanceProperties: readonly EditorAppearanceProperty[] = ["color", "strokeWidth", "fill", ...textProperties];

/** Resolve temporary groups once and never pass group containers to updateObject. */
export function editorSelectionLeaves(session: EditorSession, ids = session.getSelection()): EditorObject[] {
  const seen = new Set<string>(), leaves: EditorObject[] = [];
  function visit(id: string): void {
    if (seen.has(id)) return; seen.add(id);
    const object = session.getObject(id);
    if (object.kind === "group") object.children.forEach(visit); else leaves.push(object);
  }
  ids.forEach(visit); return leaves;
}
export function editorSupportsAppearance(object: EditorObject, property: EditorAppearanceProperty): boolean {
  if (object.kind === "source" || object.kind === "group") return false;
  if (textProperties.has(property)) return object.kind === "text";
  if (property === "color") return object.kind !== "image";
  if (property === "strokeWidth") return object.kind === "shape" || object.kind === "ink" || object.kind === "signature";
  return object.kind === "ink" || object.kind === "signature" || object.kind === "shape" &&
    ["rectangle", "ellipse", "polygon"].includes(object.shape);
}
export function editorPropertySelection(session: EditorSession, property: EditorAppearanceProperty, ids = session.getSelection()): string[] {
  return editorSelectionLeaves(session, ids).filter(object => !session.isObjectLocked?.(object.id) && editorSupportsAppearance(object, property)).map(object => object.id);
}
export function editorPropertyColor(value: unknown): string {
  const color = normalizePrimitiveColor((value ?? "#111111") as Parameters<typeof normalizePrimitiveColor>[0]);
  return `#${color.map(channel => Math.round(channel * 255).toString(16).padStart(2, "0")).join("")}`;
}
export function editorPropertyState(session: EditorSession, property: EditorAppearanceProperty) {
  const leaves = editorSelectionLeaves(session), supported = leaves.filter(object => !session.isObjectLocked?.(object.id) && editorSupportsAppearance(object, property));
  const fallback = (object: EditorObject): unknown => {
    const value = (object as unknown as Record<string, unknown>)[property];
    if (property === "color") return editorPropertyColor(value);
    if (property === "fill") return value == null ? null : editorPropertyColor(value);
    if (property === "strokeWidth") return value ?? 1;
    if (property === "fontId" || property === "fontFamily") return value ?? "";
    if (property === "align") return value ?? "left";
    if (property === "fontWeight") return value === "bold" || typeof value === "number" && value >= 600;
    if (property === "fontStyle") return value === "italic" || value === "oblique";
    if (property === "underline" || property === "strikethrough") return value ?? false;
    return value;
  };
  const values = supported.flatMap(object => object.kind === "text" && object.runs?.length && property !== "align"
    ? object.runs.map(run => fallback({ ...object, ...Object.fromEntries(Object.entries(run).filter(([, value]) => value !== undefined)) } as EditorTextObject)) : [fallback(object)]);
  return { ids: supported.map(object => object.id), total: leaves.length, values,
    mixed: values.some(value => value !== values[0]), value: values[0] };
}
/** One undoable change applies only supported properties to authored leaves. */
export function applyEditorPropertyPatch(session: EditorSession, patch: Partial<EditorObject>, ids = session.getSelection()): number {
  const updates = editorSelectionLeaves(session, ids).flatMap(object => {
    if (session.isObjectLocked?.(object.id)) return [];
    const supported = Object.fromEntries(appearanceProperties.filter(key => Object.hasOwn(patch, key) && editorSupportsAppearance(object, key))
      .map(key => [key, (patch as Record<string, unknown>)[key]]));
    if (!Object.keys(supported).length) return [];
    return [{ id: object.id, patch: object.kind === "text" ? { ...supported,
      ...(object.runs ? { runs: object.runs.map(run => ({ ...run, ...Object.fromEntries(Object.entries(supported).filter(([key]) => key !== "align")) })) } : {}) } : supported }];
  });
  if (updates.length) session.transaction("Change appearance", () => { for (const update of updates) session.updateObject(update.id, update.patch); });
  return updates.length;
}

export function validateEditorOpacity(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError("Opacity must be a number from 0 through 1.");
  return value;
}

/** Original page content retains its source appearance; authored objects expose style controls. */
export function editorStyledSelection(session: EditorSession, ids = session.getSelection()): string[] {
  const visited = new Set<string>(), result: string[] = [];
  function visit(id: string): void {
    if (visited.has(id)) return; visited.add(id);
    const object = session.getObject(id);
    if (object.kind === "group") object.children.forEach(visit);
    else if (object.kind !== "source" && !session.isObjectLocked?.(id)) result.push(id);
  }
  ids.forEach(visit); return result;
}

export function applyEditorOpacity(session: EditorSession, opacity: number): void {
  validateEditorOpacity(opacity); const ids = editorStyledSelection(session);
  if (!ids.length) return;
  session.transaction("Change color opacity", () => { for (const id of ids) {
    const object = session.getObject(id);
    session.updateObject(id, { opacity, ...(object.kind === "shape" || object.kind === "ink" || object.kind === "signature"
      ? { fillOpacity: object.fillOpacity ?? object.opacity ?? 1 } : {}) });
  } });
}

export function editorFillSelection(session: EditorSession, styled = editorStyledSelection(session)): string[] {
  return styled.filter(id => {
    return editorSupportsAppearance(session.getObject(id), "fill");
  });
}

export function applyEditorFillOpacity(session: EditorSession, fillOpacity: number): void {
  validateEditorOpacity(fillOpacity); const ids = editorFillSelection(session);
  if (!ids.length) return;
  session.transaction("Change fill opacity", () => { for (const id of ids) session.updateObject(id, { fillOpacity }); });
}
