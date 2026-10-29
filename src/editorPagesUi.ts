import type { EditorSession } from "./editorTypes";
import { LoadProgressReporter, type LoadProgressCallback } from "./loadProgress";
import { isPdfPasswordError } from "./pdfObjectGenerator";
import { promptForPdfPassword } from "./pdfPasswordPrompt";
import type { PdfDiagnostic } from "./pdf/nativeTypes";
import { droppedFileKind } from "./documentDropFiles";

export function parseEditorPageRange(value: string, count: number): number[] {
  const result = new Set<number>();
  for (const part of value.split(",")) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!match) throw new Error("Enter page numbers such as 1-3, 5.");
    const first = Number(match[1]), last = Number(match[2] ?? first);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > count)
      throw new Error(`Choose pages from 1 through ${count}, with ranges in increasing order.`);
    for (let index = first - 1; index < last; index++) result.add(index);
  }
  return [...result].sort((a, b) => a - b);
}

/** Each import commits atomically; cancellation leaves earlier completed files inserted. */
export async function insertEditorPdfFiles(session: Pick<EditorSession, "insertPdf" | "getPages">,
  files: readonly File[], at: number, options: { signal: AbortSignal; onProgress?: LoadProgressCallback;
    onDiagnostic?: (diagnostic: PdfDiagnostic) => void; requestPassword?: typeof promptForPdfPassword }): Promise<void> {
  await insertEditorFiles(session, files, at, options, false);
}

/** Attach PDF pages or rebuild a HEP's retained visual content as ordinary PDF pages. */
export async function insertEditorDocumentFiles(session: Pick<EditorSession, "insertPdf" | "getPages">,
  files: readonly File[], at: number, options: { signal: AbortSignal; onProgress?: LoadProgressCallback;
    onDiagnostic?: (diagnostic: PdfDiagnostic) => void; requestPassword?: typeof promptForPdfPassword }): Promise<void> {
  options.signal.throwIfAborted();
  if (files.some(file => !["pdf", "hep"].includes(droppedFileKind(file) ?? ""))) throw new TypeError("Attach PDF or HEP files.");
  await insertEditorFiles(session, files, at, options, true);
}

async function insertEditorFiles(session: Pick<EditorSession, "insertPdf" | "getPages">,
  files: readonly File[], at: number, options: { signal: AbortSignal; onProgress?: LoadProgressCallback;
    onDiagnostic?: (diagnostic: PdfDiagnostic) => void; requestPassword?: typeof promptForPdfPassword }, allowHep: boolean): Promise<void> {
  const progress = new LoadProgressReporter(options.onProgress);
  for (let index = 0; index < files.length; index++) {
    options.signal.throwIfAborted();
    const file = files[index], fileProgress = progress.child(index / files.length, (index + 1) / files.length);
    const onDiagnostic = (value: PdfDiagnostic): void => options.onDiagnostic?.({ ...value, message: `${file.name}: ${value.message}` });
    let bytes = new Uint8Array(await file.arrayBuffer());
    options.signal.throwIfAborted();
    const hep = allowHep && droppedFileKind(file) === "hep";
    if (hep) {
      const [{ loadSceneFromHep }, { writeScenePdf }] = await Promise.all([import("./hep"), import("./editorPdfWriter")]);
      options.signal.throwIfAborted();
      const scene = await loadSceneFromHep(bytes.buffer, { signal: options.signal,
        onProgress: fileProgress.child(0, .35).toCallback() });
      const pdf = await writeScenePdf(scene, { signal: options.signal,
        onProgress: fileProgress.child(.35, .55).toCallback(),
        onWarning: message => onDiagnostic({ code: "editor.hep-attachment", severity: "warning", message }) });
      options.signal.throwIfAborted(); bytes = new Uint8Array(await pdf.arrayBuffer()); options.signal.throwIfAborted();
    }
    let password: string | undefined;
    for (;;) {
      try {
        const count = session.getPages().length;
        await session.insertPdf(bytes, { at, password, signal: options.signal,
          onDiagnostic, onProgress: (hep ? fileProgress.child(.55, 1) : fileProgress).toCallback() });
        at += session.getPages().length - count; break;
      } catch (error) {
        if (!isPdfPasswordError(error) || options.signal.aborted) throw error;
        const answer = await (options.requestPassword ?? promptForPdfPassword)({ label: file.name,
          retry: error.details.reason === "password-incorrect", signal: options.signal });
        if (answer === null) throw new DOMException("PDF insertion was cancelled.", "AbortError");
        password = answer;
      }
    }
  }
  options.signal.throwIfAborted(); progress.complete({ sourceType: "pdf" });
}

export interface EditorPagesDialog {
  refresh(): void;
  close(force?: boolean): void;
  isBusy(): boolean;
  setStatus(text: string): void;
  setWarnings(messages: readonly string[]): void;
}
export interface EditorPagesDialogOptions {
  getPages(): readonly { width?: number; height?: number; rotation?: number }[];
  rotate(pages: readonly number[], degrees: number): Promise<void>;
  remove(pages: readonly number[]): Promise<void>;
  insert(files: readonly File[], at: number): Promise<void>;
  cancel(): void;
  onError(error: unknown): void;
  onClose(): void;
}

export function showEditorPagesDialog(document: Document, options: EditorPagesDialogOptions): EditorPagesDialog {
  const dialog = document.createElement("dialog"); dialog.className = "hepr-editor-pages-dialog";
  const title = document.createElement("h2"); title.id = "hepr-editor-pages-title"; title.textContent = "Pages";
  dialog.setAttribute("aria-labelledby", title.id);
  const help = document.createElement("p"); help.textContent = "Select pages to rotate or remove. Insert all pages from one or more PDF files. Changes support Undo and Redo.";
  const rangeLabel = document.createElement("label"); rangeLabel.textContent = "Page range ";
  const range = document.createElement("input"); range.type = "text"; range.placeholder = "1-3, 5"; rangeLabel.append(range);
  const rangeButton = document.createElement("button"); rangeButton.textContent = "Select range";
  const all = document.createElement("button"); all.textContent = "Select all";
  const clear = document.createElement("button"); clear.textContent = "Clear selection";
  const list = document.createElement("div"); list.className = "hepr-editor-pages-list";
  const rotateLeft = document.createElement("button"), rotateRight = document.createElement("button"), rotateHalf = document.createElement("button"), remove = document.createElement("button");
  rotateLeft.textContent = "Rotate left 90°"; rotateRight.textContent = "Rotate right 90°"; rotateHalf.textContent = "Rotate 180°"; remove.textContent = "Remove selected pages";
  const actions = document.createElement("div"); actions.className = "hepr-editor-pages-actions"; actions.append(rotateLeft, rotateRight, rotateHalf, remove);
  const insertLabel = document.createElement("label"); insertLabel.textContent = "Insert PDFs ";
  const position = document.createElement("select"); position.setAttribute("aria-label", "Insert PDF position");
  for (const [value, label] of [["before", "Before page"], ["after", "After page"], ["end", "At end"]]) {
    const option = document.createElement("option"); option.value = value; option.textContent = label; position.append(option);
  }
  position.value = "end";
  const pageNumber = document.createElement("input"); pageNumber.type = "number"; pageNumber.min = "1"; pageNumber.step = "1"; pageNumber.value = "1"; pageNumber.setAttribute("aria-label", "Insertion page number");
  const insert = document.createElement("button"); insert.textContent = "Choose PDFs…";
  const input = document.createElement("input"); input.type = "file"; input.accept = ".pdf,application/pdf"; input.multiple = true; input.hidden = true;
  insertLabel.append(position, pageNumber, insert, input);
  const status = document.createElement("p"); status.setAttribute("role", "status");
  const cancel = document.createElement("button"), close = document.createElement("button"); cancel.textContent = "Cancel operation"; cancel.hidden = true; close.textContent = "Close";
  for (const button of [rangeButton, all, clear, rotateLeft, rotateRight, rotateHalf, remove, insert, cancel, close]) button.type = "button";
  dialog.append(title, help, rangeLabel, rangeButton, all, clear, list, actions, insertLabel, status, cancel, close);
  let busy = false, closed = false, selected = new Set([0]), warnings: readonly string[] = [], statusText = "";
  const displayStatus = (text: string): void => { statusText = text; status.textContent = [text, ...warnings].filter(Boolean).join(" "); };
  const controls = [range, rangeButton, all, clear, rotateLeft, rotateRight, rotateHalf, remove, position, pageNumber, insert, input, close];
  const selection = (): number[] => [...selected].sort((a, b) => a - b);
  function updateControls(): void {
    for (const control of controls) control.disabled = busy;
    for (const checkbox of list.querySelectorAll<HTMLInputElement>("input")) checkbox.disabled = busy;
    rotateLeft.disabled = rotateRight.disabled = rotateHalf.disabled = busy || !selected.size;
    remove.disabled = busy || !selected.size || selected.size >= options.getPages().length;
    pageNumber.disabled = busy || position.value === "end"; cancel.hidden = !busy;
  }
  const controller: EditorPagesDialog = {
    refresh() {
      const pages = options.getPages(); selected = new Set([...selected].filter(index => index < pages.length)); list.replaceChildren();
      pages.forEach((page, index) => {
        const label = document.createElement("label"), checkbox = document.createElement("input"), text = document.createElement("span");
        checkbox.type = "checkbox"; checkbox.checked = selected.has(index); checkbox.setAttribute("aria-label", `Select page ${index + 1}`);
        text.textContent = `Page ${index + 1}${page.width && page.height ? ` — ${Math.round(page.width)} × ${Math.round(page.height)}` : ""}`;
        checkbox.addEventListener("change", () => { if (checkbox.checked) selected.add(index); else selected.delete(index); updateControls(); });
        label.append(checkbox, text); list.append(label);
      });
      pageNumber.max = String(pages.length); if (Number(pageNumber.value) > pages.length) pageNumber.value = String(pages.length);
      updateControls();
    },
    close(force = false) { if (closed) return; if (busy && !force) { options.cancel(); return; } closed = true; dialog.close(); dialog.remove(); options.onClose(); },
    isBusy: () => busy,
    setStatus: displayStatus,
    setWarnings(messages) { warnings = [...new Set(messages)]; displayStatus(statusText); }
  };
  async function run(operation: () => Promise<void>): Promise<void> {
    if (busy || closed) return; busy = true; warnings = []; displayStatus("Updating pages…"); updateControls();
    try { await operation(); displayStatus("Pages updated."); }
    catch (error) { options.onError(error); displayStatus(error instanceof DOMException && error.name === "AbortError" ? "Page operation cancelled." : error instanceof Error ? error.message : "Unable to update pages."); }
    finally { busy = false; if (!closed) controller.refresh(); }
  }
  rangeButton.addEventListener("click", () => { try { selected = new Set(parseEditorPageRange(range.value, options.getPages().length)); displayStatus(""); controller.refresh(); } catch (error) { displayStatus((error as Error).message); } });
  all.addEventListener("click", () => { selected = new Set(options.getPages().map((_, index) => index)); controller.refresh(); });
  clear.addEventListener("click", () => { selected.clear(); controller.refresh(); });
  rotateLeft.addEventListener("click", () => { void run(() => options.rotate(selection(), -90)); });
  rotateRight.addEventListener("click", () => { void run(() => options.rotate(selection(), 90)); });
  rotateHalf.addEventListener("click", () => { void run(() => options.rotate(selection(), 180)); });
  remove.addEventListener("click", () => { void run(() => options.remove(selection())); });
  position.addEventListener("change", updateControls); insert.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const files = Array.from(input.files ?? []); input.value = ""; if (!files.length) return;
    const page = Number(pageNumber.value), count = options.getPages().length;
    if (position.value !== "end" && (!Number.isInteger(page) || page < 1 || page > count)) { displayStatus(`Choose an insertion page from 1 through ${count}.`); return; }
    const at = position.value === "end" ? count : position.value === "before" ? page - 1 : page;
    void run(() => options.insert(files, at));
  });
  cancel.addEventListener("click", options.cancel); close.addEventListener("click", () => controller.close());
  dialog.addEventListener("cancel", event => { event.preventDefault(); controller.close(); });
  dialog.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); });
  controller.refresh(); document.body.append(dialog); dialog.showModal(); return controller;
}
