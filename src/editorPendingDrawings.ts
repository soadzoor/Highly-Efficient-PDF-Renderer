import { createEditorInkPreviewCache } from "./editorInkPreview";
import { createEditorShapePreviewCache } from "./editorShapePreview";
import type { EditorInkObject, EditorSession, EditorShapeObject } from "./editorTypes";
import type { VectorScene } from "./pdfVectorExtractor";

export interface EditorPendingDrawingFrame { sourceScene: VectorScene; versions: ReadonlyMap<string, string> }
interface PendingDrawing {
  object: EditorInkObject | EditorShapeObject;
  version: string;
  geometry: ReturnType<typeof createEditorInkPreviewCache> | ReturnType<typeof createEditorShapePreviewCache>;
}

const isDrawing = (object: { kind: string }): object is PendingDrawing["object"] =>
  object.kind === "ink" || object.kind === "signature" || object.kind === "shape";
const createGeometry = (object: PendingDrawing["object"]): PendingDrawing["geometry"] =>
  object.kind === "shape" ? createEditorShapePreviewCache() : createEditorInkPreviewCache();

/** Only newly placed, not-yet-presented drawings need an editing overlay. */
export function createEditorPendingDrawings(session: Pick<EditorSession, "sourceScene" | "revision" | "getObject" | "isObjectVisible">) {
  const entries = new Map<string, PendingDrawing>();
  let sourceScene = session.sourceScene, revision = session.revision;
  function reconcile(): void {
    if (sourceScene !== session.sourceScene) { sourceScene = session.sourceScene; entries.clear(); }
    if (revision === session.revision) return;
    revision = session.revision;
    for (const [id, entry] of entries) {
      let object;
      try { object = session.getObject(id); } catch { entries.delete(id); continue; }
      if (!isDrawing(object)) { entries.delete(id); continue; }
      const version = JSON.stringify(object);
      if (entry.version !== version) {
        // Transform/style changes should not refit an unchanged centerline.
        if (object.kind !== "shape" && entry.object.kind !== "shape" && object.paths.length === entry.object.paths.length && object.paths.every((path, index) => {
          const previous = (entry.object as EditorInkObject).paths[index];
          return path.length === previous.length && path.every((point, i) => point[0] === previous[i][0] && point[1] === previous[i][1]);
        })) object.paths = entry.object.paths;
        if ((object.kind === "shape") !== (entry.object.kind === "shape")) entry.geometry = createGeometry(object);
        entry.object = object; entry.version = version;
      }
    }
  }
  return {
    add(id: string): void {
      reconcile();
      const object = session.getObject(id);
      if (!isDrawing(object)) return;
      entries.set(id, { object, version: JSON.stringify(object), geometry: createGeometry(object) });
    },
    reconcile,
    capture(): EditorPendingDrawingFrame | undefined {
      reconcile();
      return entries.size ? { sourceScene, versions: new Map([...entries].map(([id, entry]) => [id, entry.version])) } : undefined;
    },
    acknowledge(frame: EditorPendingDrawingFrame | undefined): void {
      reconcile();
      if (!frame || frame.sourceScene !== sourceScene) return;
      for (const [id, version] of frame.versions) if (entries.get(id)?.version === version) entries.delete(id);
    },
    visible(): readonly PendingDrawing[] {
      return [...entries].filter(([id]) => session.isObjectVisible(id)).map(([, entry]) => entry);
    },
    clear(): void { entries.clear(); }
  };
}
