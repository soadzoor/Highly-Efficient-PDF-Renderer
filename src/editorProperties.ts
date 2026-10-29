import type { EditorSession } from "./editorTypes";

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
    else if (object.kind !== "source") result.push(id);
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
    const kind = session.getObject(id).kind; return kind === "shape" || kind === "ink" || kind === "signature";
  });
}

export function applyEditorFillOpacity(session: EditorSession, fillOpacity: number): void {
  validateEditorOpacity(fillOpacity); const ids = editorFillSelection(session);
  if (!ids.length) return;
  session.transaction("Change fill opacity", () => { for (const id of ids) session.updateObject(id, { fillOpacity }); });
}
