import "./viewerFileDrop.css";
import { droppedFileKind } from "./documentDropFiles";

export type ViewerDropChoice = "replace" | "attach";
export interface ViewerDropDocument { identity: unknown; label: string }
export interface ViewerFileDropOptions {
  document: Document;
  signal?: AbortSignal;
  getDocument(): ViewerDropDocument | null;
  isEditing(): boolean;
  isBusy(): boolean;
  replace(file: File, signal: AbortSignal): Promise<boolean>;
  attach(files: readonly File[], signal: AbortSignal): Promise<void>;
  insertImages(files: readonly File[], client: { x: number; y: number }, signal: AbortSignal): Promise<void>;
  setDragging(active: boolean): void;
  setStatus(message: string): void;
  chooseAction?(current: ViewerDropDocument, files: readonly File[], signal: AbortSignal): Promise<ViewerDropChoice | null>;
}

/** Ask before changing the loaded document; no files are read until a choice is made. */
export function showViewerDropChoice(document: Document, current: ViewerDropDocument, files: readonly File[],
  signal: AbortSignal): Promise<ViewerDropChoice | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const dialog = document.createElement("dialog"); dialog.className = "hepr-file-drop-dialog";
    const title = document.createElement("h2"); title.textContent = "Open dropped documents";
    const help = document.createElement("p");
    help.textContent = `${current.label} is already open. Replace it with ${files.length === 1 ? files[0].name : `${files.length} dropped documents`}, or attach the dropped pages at the end?`;
    const detail = document.createElement("p"); detail.textContent = "Attach keeps your current changes and supports Undo. Replace uses the normal unsaved-changes confirmation.";
    const actions = document.createElement("div"), replace = document.createElement("button"), attach = document.createElement("button"), cancel = document.createElement("button");
    actions.className = "hepr-file-drop-actions";
    replace.type = attach.type = cancel.type = "button";
    replace.textContent = "Replace"; attach.textContent = "Attach at end"; cancel.textContent = "Cancel";
    dialog.setAttribute("aria-label", "Replace or attach dropped documents");
    actions.append(replace, attach, cancel); dialog.append(title, help, detail, actions);
    let settled = false;
    const finish = (choice: ViewerDropChoice | null, error?: unknown): void => {
      if (settled) return; settled = true; signal.removeEventListener("abort", abort);
      if (dialog.open) dialog.close(); dialog.remove(); if (error) reject(error); else resolve(choice);
    };
    const abort = (): void => finish(null);
    replace.addEventListener("click", () => finish("replace")); attach.addEventListener("click", () => finish("attach"));
    cancel.addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(null); });
    dialog.addEventListener("close", () => finish(null));
    dialog.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); });
    signal.addEventListener("abort", abort, { once: true });
    document.body.append(dialog);
    try { dialog.showModal(); cancel.focus(); }
    catch (error) { finish(null, error); }
  });
}

/** Shared window drop routing; rendering and editing services remain host-owned and lazy. */
export function createViewerFileDropController(options: ViewerFileDropOptions) {
  const window = options.document.defaultView!, lifetime = new AbortController();
  let job: AbortController | null = null, disposed = false;
  const setDragging = (active: boolean): void => { if (!disposed) options.setDragging(active); };
  const currentMatches = (source: ViewerDropDocument | null): boolean => {
    const current = options.getDocument();
    return source ? current !== null && Object.is(current.identity, source.identity) : current === null;
  };
  async function drop(files: readonly File[], client: { x: number; y: number }): Promise<void> {
    if (disposed || !files.length) return;
    if (job || options.isBusy()) { options.setStatus("Wait for the current operation before dropping files."); return; }
    const kinds = files.map(droppedFileKind);
    if (kinds.some(kind => kind === null)) { options.setStatus("Drop PDF/HEP documents, or PNG, JPEG and WebP images in Edit mode."); return; }
    const images = kinds.every(kind => kind === "image");
    if (!images && kinds.some(kind => kind === "image")) { options.setStatus("Drop documents and images separately."); return; }
    const source = options.getDocument();
    if (images && (!source || !options.isEditing())) { options.setStatus("Open a document and switch to Edit to insert dropped images."); return; }
    const operation = job = new AbortController(), signal = operation.signal;
    try {
      if (images) {
        await options.insertImages(files, client, signal); return;
      }
      const choice = source ? await (options.chooseAction ?? ((current, incoming, abortSignal) =>
        showViewerDropChoice(options.document, current, incoming, abortSignal)))(source, files, signal) : "replace";
      signal.throwIfAborted();
      if (!choice) return;
      if (!currentMatches(source)) throw new Error("The document changed. Drop the files again for the current document.");
      if (options.isBusy()) throw new Error("Wait for the current operation before dropping files.");
      if (choice === "attach") await options.attach(files, signal);
      else {
        if (!await options.replace(files[0], signal)) return;
        signal.throwIfAborted();
        if (files.length > 1) await options.attach(files.slice(1), signal);
      }
    } catch (error) {
      if (!disposed && !signal.aborted && !((error instanceof Error || error instanceof DOMException) && error.name === "AbortError"))
        options.setStatus(`Unable to use dropped files: ${error instanceof Error ? error.message : String(error)}`);
    } finally { if (job === operation) job = null; }
  }
  const fileDrag = (event: DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes("Files");
  window.addEventListener("dragenter", event => {
    if (!fileDrag(event)) return; event.preventDefault(); setDragging(true);
  }, { signal: lifetime.signal });
  window.addEventListener("dragover", event => {
    if (!fileDrag(event)) return; event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = job || options.isBusy() ? "none" : "copy";
    setDragging(true);
  }, { signal: lifetime.signal });
  window.addEventListener("dragleave", event => {
    if (event.target === options.document.documentElement || event.target === options.document.body) setDragging(false);
  }, { signal: lifetime.signal });
  window.addEventListener("drop", event => {
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!files.length) return; event.preventDefault(); setDragging(false);
    void drop(files, { x: event.clientX, y: event.clientY });
  }, { signal: lifetime.signal });
  const cancel = (): void => { job?.abort(); setDragging(false); };
  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && job && !event.isComposing) cancel();
  }, { signal: lifetime.signal });
  function dispose(): void {
    if (disposed) return; cancel(); disposed = true; lifetime.abort(); options.signal?.removeEventListener("abort", dispose);
  }
  options.signal?.addEventListener("abort", dispose, { once: true });
  if (options.signal?.aborted) dispose();
  return { drop, cancel, dispose, isBusy: () => job !== null };
}
