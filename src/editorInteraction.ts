import type { Bounds } from "./pdfVectorExtractor";
import type { EditorMatrix, EditorSession } from "./editorTypes";

export interface EditorSelectionModifiers { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }
export interface EditorInteractionController {
  selectHit(id: string | null, modifiers?: EditorSelectionModifiers): void;
  /** Area selection is strictly contained; modifiers add to the selection. */
  selectArea(bounds: Bounds, options?: EditorSelectionModifiers & { pageIndex?: number }): void;
  previewTransform(matrix: EditorMatrix): void;
  /** Without a matrix, commit the current preview as one undoable edit. */
  applyTransform(matrix?: EditorMatrix): void;
  cancelTransform(): void;
  nudge(x: number, y: number): void;
  /** Release this controller before disposing the caller-owned session. */
  dispose(): void;
}

/** Shared editing gestures without a DOM, toolbar, camera, or rendering dependency. */
export function createEditorInteractionController(session: EditorSession): EditorInteractionController {
  let disposed = false;
  let pending: { matrix: EditorMatrix; selection: readonly string[]; revision: number } | null = null;
  const ensure = () => { if (disposed) throw new Error("Editor interaction controller is disposed."); };
  const cancel = () => {
    pending = null;
    if (session.getState().previewing) session.setPreviewTransform(null);
  };
  const controller: EditorInteractionController = {
    selectHit(id, modifiers = {}) {
      ensure(); cancel();
      const toggle = Boolean(modifiers.ctrlKey || modifiers.metaKey), additive = toggle || modifiers.shiftKey;
      if (id === null) { if (!additive) session.select([]); return; }
      if (toggle || additive || !session.getSelection().includes(id)) session.select([id], { additive: Boolean(additive), toggle });
    },
    selectArea(bounds, options = {}) {
      ensure(); cancel();
      session.selectArea(bounds, { additive: Boolean(options.ctrlKey || options.metaKey || options.shiftKey), intersects: false, pageIndex: options.pageIndex });
    },
    previewTransform(matrix) {
      ensure(); const selection = session.getSelection(), revision = session.revision;
      session.setPreviewTransform(matrix);
      pending = { matrix: [matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]], selection, revision };
    },
    applyTransform(matrix) {
      ensure(); const preview = pending;
      if (!matrix && preview) {
        const selection = session.getSelection();
        if (session.revision !== preview.revision || selection.length !== preview.selection.length || selection.some((id, i) => id !== preview.selection[i])) { cancel(); return; }
        matrix = preview.matrix;
      }
      cancel(); if (matrix) session.transformSelection(matrix);
    },
    cancelTransform() { ensure(); cancel(); },
    nudge(x, y) { ensure(); controller.applyTransform([1, 0, 0, 1, x, y]); },
    dispose() { if (disposed) return; cancel(); disposed = true; }
  };
  return controller;
}
