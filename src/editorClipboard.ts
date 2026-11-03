import type { EditorObject, EditorSelectionFrame, EditorSession } from "./editorTypes";
import type { VectorScene } from "./pdfVectorExtractor";

/** Editor-only snapshots. These never become part of scene or document persistence. */
export interface EditorCapturedSource {
  scene: VectorScene;
  frame: EditorSelectionFrame;
}
export interface EditorClipboardSnapshot {
  source: VectorScene;
  roots: readonly string[];
  objects: ReadonlyMap<string, EditorObject>;
  sources: ReadonlyMap<string, EditorCapturedSource>;
  basis?: EditorSelectionFrame["transform"];
  cut: boolean;
  pastes: number;
}
export interface EditorClipboardStore { value: EditorClipboardSnapshot | null; sequence: number; documentOwned?: boolean }
const stores = new WeakMap<EditorSession, EditorClipboardStore>();
const sourceReaders = new WeakMap<EditorSession, (id: string) => VectorScene | undefined>();

export function editorClipboardStore(session: EditorSession): EditorClipboardStore {
  let store = stores.get(session);
  if (!store) { store = { value: null, sequence: 0 }; stores.set(session, store); }
  return store;
}
export function shareEditorClipboard(source: EditorSession, target: EditorSession): void {
  const store = editorClipboardStore(source); store.documentOwned = true; stores.set(target, store);
}
export function releaseEditorClipboard(session: EditorSession): void {
  const store = stores.get(session);
  // Obsolete page versions can be pruned before the document itself closes.
  if (store && !store.documentOwned) { store.value = null; store.sequence++; }
}
export function registerEditorCapturedSourceReader(session: EditorSession, read: (id: string) => VectorScene | undefined): void { sourceReaders.set(session, read); }
/** Exporters use frozen copied appearances instead of re-reading their former source. */
export function getEditorCapturedSourceScene(session: EditorSession, id: string): VectorScene | undefined { return sourceReaders.get(session)?.(id); }
