import type { EditorSession } from "./editorTypes";
import { LoadProgressReporter, type LoadProgressCallback } from "./loadProgress";
import { isPdfPasswordError } from "./pdfObjectGenerator";
import { promptForPdfPassword } from "./pdfPasswordPrompt";
import type { PdfDiagnostic } from "./pdf/nativeTypes";
import { droppedFileKind } from "./documentDropFiles";
import { createEditorLayerDrag, type EditorLayerDropPosition } from "./editorLayerDrag";
import { toolbarIconMarkup } from "./toolbarIcons";
import type { PdfPageCropBox } from "./editorPdfPages";

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
  reorder?(order: readonly number[]): Promise<void>;
  duplicate?(pages: readonly number[], at: number): Promise<void>;
  extract?(pages: readonly number[]): Promise<void>;
  crop?(pages: readonly number[], box: PdfPageCropBox | null): Promise<void>;
  cancel(): void;
  onError(error: unknown): void;
  onClose(): void;
}

/** A drag moves selected pages as a stable block beside an unselected page. */
export function reorderEditorPageSelection(count: number, pages: readonly number[], target: number,
  position: EditorLayerDropPosition): number[] {
  const order = Array.from({ length: count }, (_, index) => index), selected = new Set(pages);
  if (!Number.isSafeInteger(target) || target < 0 || target >= count || !selected.size || selected.has(target) ||
      pages.some(page => !Number.isSafeInteger(page) || page < 0 || page >= count)) return order;
  const remaining = order.filter(page => !selected.has(page)), insertion = remaining.indexOf(target) + (position === "after" ? 1 : 0);
  remaining.splice(insertion, 0, ...order.filter(page => selected.has(page))); return remaining;
}

/** Move selected blocks one slot without changing their relative order. */
export function nudgeEditorPageSelection(count: number, pages: readonly number[], direction: -1 | 1): number[] {
  const order = Array.from({ length: count }, (_, index) => index), selected = new Set(pages);
  for (let step = 0; step < count; step++) {
    const index = direction < 0 ? step : count - step - 1, next = index + direction;
    if (next >= 0 && next < count && selected.has(order[index]) && !selected.has(order[next]))
      [order[index], order[next]] = [order[next], order[index]];
  }
  return order;
}

export function showEditorPagesDialog(document: Document, options: EditorPagesDialogOptions): EditorPagesDialog {
  const dialog = document.createElement("dialog"); dialog.className = "hepr-editor-pages-dialog";
  const button = (label: string, action: string): HTMLButtonElement => {
    const element = document.createElement("button"); element.type = "button"; element.textContent = label; element.dataset.pagesAction = action; return element;
  };
  const title = document.createElement("h2"); title.id = "hepr-editor-pages-title"; title.textContent = "Pages";
  dialog.setAttribute("aria-labelledby", title.id);
  const help = document.createElement("p"); help.textContent = options.reorder
    ? "Select pages to organize them. Drag a grip with mouse, touch or pen to reorder the selection; Alt+Up/Down moves it one slot. Changes support Undo and Redo."
    : "Select pages to rotate or remove. Insert all pages from one or more PDF files. Changes support Undo and Redo.";
  const rangeLabel = document.createElement("label"); rangeLabel.textContent = "Page range ";
  const range = document.createElement("input"); range.type = "text"; range.placeholder = "1-3, 5"; rangeLabel.append(range);
  const rangeButton = button("Select range", "range"), all = button("Select all", "all"), clear = button("Clear selection", "clear");
  const list = document.createElement("div"); list.className = "hepr-editor-pages-list"; list.setAttribute("aria-label", "Document pages");
  const rotateLeft = button("Rotate left 90°", "rotate-left"), rotateRight = button("Rotate right 90°", "rotate-right"),
    rotateHalf = button("Rotate 180°", "rotate-half"), remove = button("Remove selected pages", "remove");
  const actions = document.createElement("div"); actions.className = "hepr-editor-pages-actions"; actions.append(rotateLeft, rotateRight, rotateHalf, remove);
  const moveUp = button("Move up", "up"), moveDown = button("Move down", "down"), duplicate = button("Duplicate selected", "duplicate"), extract = button("Extract selected PDF…", "extract");
  if (options.reorder) actions.append(moveUp, moveDown);
  if (options.duplicate) actions.append(duplicate);
  if (options.extract) actions.append(extract);
  const insertLabel = document.createElement("label"); insertLabel.textContent = options.duplicate ? "Insert / duplicate position " : "Insert PDFs ";
  const position = document.createElement("select"); position.setAttribute("aria-label", "Insert PDF position");
  for (const [value, label] of [["before", "Before page"], ["after", "After page"], ["end", "At end"]]) {
    const option = document.createElement("option"); option.value = value; option.textContent = label; position.append(option);
  }
  position.value = "end";
  const pageNumber = document.createElement("input"); pageNumber.type = "number"; pageNumber.min = "1"; pageNumber.step = "1"; pageNumber.value = "1"; pageNumber.setAttribute("aria-label", "Insertion page number");
  const insert = button("Choose PDFs…", "insert");
  const input = document.createElement("input"); input.type = "file"; input.accept = ".pdf,application/pdf"; input.multiple = true; input.hidden = true;
  insertLabel.append(position, pageNumber, insert, input);
  const crop = document.createElement("fieldset"); crop.className = "hepr-editor-page-crop";
  const cropTitle = document.createElement("legend"); cropTitle.textContent = "Crop visible page area";
  const cropHelp = document.createElement("p"); cropHelp.textContent = "Points from the displayed lower-left corner. Cropping changes the visible page box; it does not remove hidden content or redact it.";
  crop.append(cropTitle, cropHelp);
  const cropInputs = Object.fromEntries(["x", "y", "width", "height"].map(name => {
    const label = document.createElement("label"); label.textContent = `${name === "x" ? "Left" : name === "y" ? "Bottom" : name} (pt) `;
    const field = document.createElement("input"); field.type = "number"; field.min = name === "x" || name === "y" ? "0" : "0.001"; field.step = "any"; field.dataset.pageCrop = name;
    field.setAttribute("aria-label", `Crop ${name} in points`); label.append(field); crop.append(label); return [name, field];
  })) as Record<"x" | "y" | "width" | "height", HTMLInputElement>;
  const applyCrop = button("Crop selected pages", "crop"), resetCrop = button("Reset crop", "reset-crop"), fullCrop = button("Use current page size", "full-crop");
  crop.append(applyCrop, resetCrop, fullCrop);
  const status = document.createElement("p"); status.setAttribute("role", "status");
  const cancel = button("Cancel operation", "cancel"), close = button("Close", "close"); cancel.hidden = true;
  dialog.append(title, help, rangeLabel, rangeButton, all, clear, list, actions, insertLabel);
  if (options.crop) dialog.append(crop);
  dialog.append(status, cancel, close);
  let busy = false, closed = false, selected = new Set([0]), warnings: readonly string[] = [], statusText = "", cropDraft = false;
  const rows = new Map<number, { element: HTMLElement; checkbox: HTMLInputElement; grip?: HTMLButtonElement }>();
  const selection = (): number[] => [...selected].sort((a, b) => a - b);
  const displayStatus = (text: string): void => { statusText = text; status.textContent = [text, ...warnings].filter(Boolean).join(" "); };
  const controls = [range, rangeButton, all, clear, rotateLeft, rotateRight, rotateHalf, remove, position, pageNumber, insert, input, close,
    moveUp, moveDown, duplicate, extract, applyCrop, resetCrop, fullCrop, ...Object.values(cropInputs)];
  const orderFor = (target: string, where: EditorLayerDropPosition) => reorderEditorPageSelection(options.getPages().length, selection(), Number(target), where);
  const changed = (order: readonly number[]) => order.some((page, index) => page !== index);
  const drag = options.reorder ? createEditorLayerDrag({ container: list, getRows: () => [...rows].map(([id, row]) => ({ id: String(id), element: row.element })),
    canDrop: (_source, target, where) => !busy && !closed && Boolean(options.reorder) && changed(orderFor(target, where)),
    start() { for (const [index, row] of rows) if (selected.has(index)) row.element.dataset.dragging = "true"; },
    preview(target, where) { for (const row of rows.values()) delete row.element.dataset.dropPosition; if (target !== null && where) rows.get(Number(target))!.element.dataset.dropPosition = where; },
    drop(_source, target, where) { const order = orderFor(target, where); if (changed(order)) void run(() => reorder(order)); },
    end() { for (const row of rows.values()) { delete row.element.dataset.dragging; delete row.element.dataset.dropPosition; } }
  }) : { begin: () => false, cancel() {}, dispose() {} };
  function updateCrop(): void {
    if (cropDraft) return;
    const page = options.getPages()[selection()[0] ?? 0];
    cropInputs.x.value = cropInputs.y.value = "0"; cropInputs.width.value = String(page?.width ?? 0); cropInputs.height.value = String(page?.height ?? 0);
  }
  function updateControls(): void {
    for (const control of controls) control.disabled = busy;
    for (const [index, row] of rows) { row.checkbox.disabled = busy; row.checkbox.checked = selected.has(index); if (row.grip) row.grip.disabled = busy; }
    rotateLeft.disabled = rotateRight.disabled = rotateHalf.disabled = duplicate.disabled = extract.disabled = applyCrop.disabled = resetCrop.disabled = busy || !selected.size;
    remove.disabled = busy || !selected.size || selected.size >= options.getPages().length;
    moveUp.disabled = busy || !selected.size || !changed(nudgeEditorPageSelection(options.getPages().length, selection(), -1));
    moveDown.disabled = busy || !selected.size || !changed(nudgeEditorPageSelection(options.getPages().length, selection(), 1));
    pageNumber.disabled = busy || position.value === "end"; cancel.hidden = !busy;
  }
  function insertionIndex(): number {
    const page = Number(pageNumber.value), count = options.getPages().length;
    if (position.value !== "end" && (!Number.isInteger(page) || page < 1 || page > count)) throw new Error(`Choose an insertion page from 1 through ${count}.`);
    return position.value === "end" ? count : position.value === "before" ? page - 1 : page;
  }
  async function reorder(order: readonly number[]): Promise<void> {
    const before = selection(); await options.reorder!(order); selected = new Set(before.map(page => order.indexOf(page)));
  }
  const controller: EditorPagesDialog = {
    refresh() {
      drag.cancel(); const pages = options.getPages(); selected = new Set([...selected].filter(index => index < pages.length)); rows.clear(); list.replaceChildren();
      pages.forEach((page, index) => {
        const row = document.createElement("div"), checkbox = document.createElement("input"), text = document.createElement("span");
        row.className = "hepr-editor-page-row"; row.tabIndex = 0; row.dataset.pageIndex = String(index);
        checkbox.type = "checkbox"; checkbox.checked = selected.has(index); checkbox.setAttribute("aria-label", `Select page ${index + 1}`);
        text.textContent = `Page ${index + 1}${page.width && page.height ? ` — ${Math.round(page.width)} × ${Math.round(page.height)}` : ""}`;
        let grip: HTMLButtonElement | undefined;
        if (options.reorder) {
          grip = button("", "drag"); grip.className = "hepr-editor-page-grip"; grip.tabIndex = -1; grip.draggable = false;
          grip.title = "Drag selected pages with mouse, touch or pen; Alt+Up/Down moves them"; grip.setAttribute("aria-label", `Reorder page ${index + 1}`); grip.innerHTML = toolbarIconMarkup("drag-handle");
          grip.addEventListener("pointerdown", event => {
            if (busy || closed) return;
            if (drag.begin(event, String(index))) { if (!selected.has(index)) selected = new Set([index]); updateControls(); row.focus(); }
          });
          grip.addEventListener("dragstart", event => event.preventDefault()); grip.addEventListener("contextmenu", event => { event.preventDefault(); event.stopPropagation(); });
          row.append(grip);
        }
        checkbox.addEventListener("change", () => { if (busy || closed) return; drag.cancel(); if (checkbox.checked) selected.add(index); else selected.delete(index); updateCrop(); updateControls(); });
        row.addEventListener("click", event => { if (busy || closed) return; if (event.target === row || event.target === text) { if (selected.has(index)) selected.delete(index); else selected.add(index); row.focus(); updateCrop(); updateControls(); } });
        row.addEventListener("keydown", event => {
          if (busy || closed || event.isComposing || event.keyCode === 229) return;
          if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown") && options.reorder) {
            event.preventDefault(); event.stopPropagation(); if (!selected.has(index)) selected = new Set([index]);
            const order = nudgeEditorPageSelection(pages.length, selection(), event.key === "ArrowUp" ? -1 : 1);
            if (changed(order)) void run(() => reorder(order));
          } else if (event.target === row && event.key === " ") { event.preventDefault(); if (selected.has(index)) selected.delete(index); else selected.add(index); updateCrop(); updateControls(); }
          else if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
            event.preventDefault(); event.stopPropagation(); const next = event.key === "Home" ? 0 : event.key === "End" ? pages.length - 1 : Math.max(0, Math.min(pages.length - 1, index + (event.key === "ArrowUp" ? -1 : 1)));
            rows.get(next)?.element.focus(); rows.get(next)?.element.scrollIntoView?.({ block: "nearest" });
          }
        });
        row.append(checkbox, text); list.append(row); rows.set(index, { element: row, checkbox, grip });
      });
      pageNumber.max = String(pages.length); if (Number(pageNumber.value) > pages.length) pageNumber.value = String(pages.length);
      updateCrop(); updateControls();
    },
    close(force = false) { if (closed) return; if (busy && !force) { options.cancel(); return; } closed = true; drag.dispose(); dialog.close(); dialog.remove(); options.onClose(); },
    isBusy: () => busy,
    setStatus: displayStatus,
    setWarnings(messages) { warnings = [...new Set(messages)]; displayStatus(statusText); }
  };
  async function run(operation: () => Promise<void>, complete = "Pages updated."): Promise<void> {
    if (busy || closed) return; drag.cancel(); busy = true; warnings = []; displayStatus("Updating pages…"); updateControls();
    try { await operation(); displayStatus(complete); }
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
  moveUp.addEventListener("click", () => { const order = nudgeEditorPageSelection(options.getPages().length, selection(), -1); if (changed(order)) void run(() => reorder(order)); });
  moveDown.addEventListener("click", () => { const order = nudgeEditorPageSelection(options.getPages().length, selection(), 1); if (changed(order)) void run(() => reorder(order)); });
  duplicate.addEventListener("click", () => { if (options.duplicate) void run(async () => { const pages = selection(), at = insertionIndex(); await options.duplicate!(pages, at); selected = new Set(pages.map((_, offset) => at + offset)); }); });
  extract.addEventListener("click", () => { if (options.extract) void run(() => options.extract!(selection()), "Extracted PDF prepared for download."); });
  position.addEventListener("change", updateControls); insert.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const files = Array.from(input.files ?? []); input.value = ""; if (!files.length) return;
    void run(() => options.insert(files, insertionIndex()));
  });
  for (const field of Object.values(cropInputs)) field.addEventListener("input", () => { cropDraft = true; });
  fullCrop.addEventListener("click", () => { cropDraft = false; updateCrop(); });
  applyCrop.addEventListener("click", () => { if (options.crop) void run(async () => {
    const entries = Object.entries(cropInputs).map(([name, field]) => [name, field.value.trim() ? Number(field.value) : NaN] as const), box = Object.fromEntries(entries) as unknown as PdfPageCropBox;
    if (!Object.values(box).every(Number.isFinite) || box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0) throw new Error("Enter a nonnegative crop origin and positive width and height in points.");
    await options.crop!(selection(), box); cropDraft = false;
  }); });
  resetCrop.addEventListener("click", () => { if (options.crop) void run(async () => { await options.crop!(selection(), null); cropDraft = false; }); });
  cancel.addEventListener("click", options.cancel); close.addEventListener("click", () => controller.close());
  dialog.addEventListener("cancel", event => { event.preventDefault(); controller.close(); });
  dialog.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); });
  controller.refresh(); document.body.append(dialog); dialog.showModal(); return controller;
}
