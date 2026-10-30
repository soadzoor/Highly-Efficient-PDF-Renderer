import { createTextSelectionController, type TextSelectionController } from "./textSelection";
import type { EditorColor, EditorSession } from "./editorTypes";
import type { VectorScene } from "./pdfVectorExtractor";
import { addEditorComment, addEditorTextMarkup } from "./editorReview";

export type EditorReviewTool = "highlight" | "underline-text" | "strikeout-text" | "comment";
export function isEditorReviewTool(value: string): value is EditorReviewTool { return ["highlight", "underline-text", "strikeout-text", "comment"].includes(value); }

interface CommentDraft { id?: string; annotationId?: string; pageIndex: number; x: number; y: number; contents: string; author: string }

/** Text selection and comment drafts are editor-only; no View-mode listeners. */
export function createEditorReviewController(options: {
  overlay: HTMLElement; session: EditorSession;
  getScene(): VectorScene;
  canEdit(): boolean;
  toScene(x: number, y: number): { x: number; y: number } | null;
  toClient(x: number, y: number): { x: number; y: number } | null;
  style(): { color?: EditorColor; opacity?: number };
  change(operation: () => void): void;
  added(ids: readonly string[]): void;
  onError(error: unknown): void;
  onDraftChange?(): void;
}) {
  const document = options.overlay.ownerDocument, lifetime = new AbortController();
  let tool: EditorReviewTool | null = null, enabled = false, disposed = false, selection: TextSelectionController | null = null;
  let preview: Float32Array | null = null, comment: CommentDraft | null = null, baseline = "", dialog: HTMLDialogElement | null = null;
  function closeComment(): void { const hadDraft = comment !== null; dialog?.close(); dialog?.remove(); dialog = null; comment = null; if (hadDraft) options.onDraftChange?.(); }
  function commitComment(): boolean {
    if (!comment || !options.canEdit()) return !comment;
    if (!comment.contents.trim()) { dialog?.querySelector<HTMLElement>('[role="status"]')?.replaceChildren(document.createTextNode("Enter a comment.")); return false; }
    try {
      const draft = comment;
      options.change(() => {
        if (draft.id) { const object = options.session.getObject(draft.id); if (object.kind !== "shape" || !object.review) throw new Error("The comment no longer exists.");
          options.session.updateObject(draft.id, { review: { ...object.review, contents: draft.contents, author: draft.author } }); }
        else if (draft.annotationId) options.session.updateAnnotation(draft.annotationId, { contents: draft.contents, author: draft.author });
        else { const id = addEditorComment(options.session, draft.pageIndex, draft.x, draft.y, draft.contents, draft.author, options.style()); options.added([id]); options.session.select([id]); }
      }); closeComment(); return true;
    } catch (error) { options.onError(error); return false; }
  }
  function openComment(draft: CommentDraft): void {
    if (disposed || !enabled || !options.canEdit()) return;
    closeComment(); comment = { ...draft }; baseline = JSON.stringify(comment);
    dialog = document.createElement("dialog"); dialog.className = "hepr-editor-comment-dialog"; dialog.setAttribute("aria-label", draft.id || draft.annotationId ? "Edit comment" : "Add comment");
    const title = document.createElement("h2"); title.textContent = draft.id || draft.annotationId ? "Edit comment" : "Add comment";
    const authorLabel = document.createElement("label"); authorLabel.textContent = "Author ";
    const author = document.createElement("input"); author.value = draft.author; author.setAttribute("aria-label", "Comment author"); authorLabel.append(author);
    const contents = document.createElement("textarea"); contents.rows = 6; contents.value = draft.contents; contents.setAttribute("aria-label", "Comment");
    const status = document.createElement("div"); status.setAttribute("role", "status");
    const actions = document.createElement("div"), save = document.createElement("button"), cancel = document.createElement("button");
    save.type = cancel.type = "button"; save.textContent = "Apply"; cancel.textContent = "Cancel"; actions.append(save, cancel);
    const changed = () => { if (comment) { comment.contents = contents.value; comment.author = author.value; options.onDraftChange?.(); } };
    author.addEventListener("input", changed); contents.addEventListener("input", changed);
    save.addEventListener("click", commitComment); cancel.addEventListener("click", closeComment);
    dialog.addEventListener("cancel", event => { event.preventDefault(); closeComment(); });
    dialog.addEventListener("keydown", event => { if (event.isComposing || event.keyCode === 229) return;
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); commitComment(); } });
    dialog.append(title, authorLabel, contents, status, actions); document.body.append(dialog); dialog.showModal(); contents.focus();
  }
  function applySelection(): boolean {
    if (!selection || !tool || tool === "comment" || !options.canEdit()) return false;
    const spans = selection.getSelectedSpans(); if (!spans.length) return false;
    try {
      const type = tool === "underline-text" ? "underline" : tool === "strikeout-text" ? "strikeout" : "highlight";
      const scene = options.getScene(), text = selection.getSelectedText();
      options.change(() => { const ids = addEditorTextMarkup(options.session, scene, spans, type, { ...options.style(), contents: text }); options.added(ids); });
      selection.clearSelection(); return true;
    } catch (error) { options.onError(error); return false; }
  }
  function resetSelection(): void { selection?.dispose(); selection = null; preview = null; }
  function sync(): void {
    resetSelection();
    if (!enabled || !tool || tool === "comment" || disposed) return;
    selection = createTextSelectionController({ getCanvas: () => options.canEdit() || selection?.isGestureActive() ? options.overlay : null,
      adapter: { getScene: options.getScene, clientToScenePoint: options.toScene, sceneToClientPoint: options.toClient,
        setSelectionHighlights: values => { preview = values; } },
      onSelectionCommit: () => applySelection() });
  }
  options.overlay.addEventListener("pointerdown", event => {
    if (!enabled || tool !== "comment" || event.button !== 0 || !options.canEdit()) return;
    const point = options.toScene(event.clientX, event.clientY); if (!point) return;
    const scene = options.getScene(); let pageIndex = -1;
    for (let index = 0; index < scene.pageCount; index++) { const i = index * 4;
      if (point.x >= scene.pageRects[i] && point.x <= scene.pageRects[i + 2] && point.y >= scene.pageRects[i + 1] && point.y <= scene.pageRects[i + 3]) { pageIndex = index; break; } }
    if (pageIndex < 0) return;
    event.preventDefault(); event.stopPropagation();
    openComment({ pageIndex, x: point.x - scene.pageRects[pageIndex * 4], y: point.y - scene.pageRects[pageIndex * 4 + 1], contents: "", author: "" });
  }, { signal: lifetime.signal });
  return {
    setTool(value: EditorReviewTool | null) { if (tool === value) return; tool = value; sync(); },
    setActive(value: boolean) { if (enabled === value) return; enabled = value; if (!value) { closeComment(); } sync(); },
    isActive: () => enabled && tool !== null,
    isSelecting: () => Boolean(selection?.isGestureActive()),
    preview: () => preview,
    updateOverlay: () => selection?.updateOverlay(),
    clearSelection: () => selection?.clearSelection(),
    cancelGesture() { selection?.disable(); selection?.enable(); },
    applySelection,
    flushDraft: commitComment,
    hasDraftChanges: () => comment !== null && JSON.stringify(comment) !== baseline,
    getDraft: () => comment ? { ...comment } : null,
    restoreDraft(value: unknown) {
      if (!value || typeof value !== "object") return;
      const draft = value as CommentDraft;
      if (Number.isSafeInteger(draft.pageIndex) && typeof draft.contents === "string" && typeof draft.author === "string" && Number.isFinite(draft.x) && Number.isFinite(draft.y)) openComment(draft);
    },
    editSelection(): boolean {
      if (!enabled || !options.canEdit()) return false;
      const ids = options.session.getSelection(); if (ids.length !== 1) return false;
      const object = options.session.getObject(ids[0]); if (options.session.isObjectLocked(ids[0])) throw new Error("Unlock this object before editing its comment.");
      if (object.kind === "shape" && object.review) { openComment({ id: object.id, pageIndex: object.pageIndex, x: object.x, y: object.y, contents: object.review.contents ?? "", author: object.review.author ?? "" }); return true; }
      if (object.kind !== "source" || !object.annotationId) return false;
      const annotation = options.getScene().annotations?.find(annotation => annotation.id === object.annotationId);
      if (!annotation || !["Text", "Highlight", "Underline", "StrikeOut"].includes(annotation.subtype)) return false;
      openComment({ annotationId: annotation.id, pageIndex: annotation.pageIndex, x: annotation.bounds.minX, y: annotation.bounds.minY,
        contents: annotation.contents ?? "", author: annotation.author ?? "" }); return true;
    },
    dispose() { if (disposed) return; disposed = true; resetSelection(); closeComment(); lifetime.abort(); }
  };
}
