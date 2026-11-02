import { PDF_PAGE_SIZE_PRESETS, resolvePdfPageSize, type PdfPageOrientation, type PdfPageSize, type PdfPageSizePreset } from "./pdfPageSizes";
import type { EditorRecoveryMetadata } from "./editorRecoveryStore";

export interface PdfPageSizeValue { pageSize: PdfPageSize; orientation: PdfPageOrientation }
export interface CreatedDocumentSource { createdDocument: true; initialUnsaved?: boolean; recoveryKey?: string; resumeRecovery?: boolean }
export interface NewPdfRequest extends PdfPageSizeValue { title: string; pageCount: number; pageNumbering: { enabled: boolean } }

/** Shared paper controls; custom dimensions are always returned in PDF points. */
export function createPdfPageSizeControls(document: Document, initial: Partial<PdfPageSizeValue> = {}) {
  const element = document.createElement("fieldset"); element.className = "hepr-pdf-page-size";
  const legend = document.createElement("legend"); legend.textContent = "Paper size"; element.append(legend);
  const label = (text: string, input: HTMLElement): void => { const node = document.createElement("label"); node.append(text, input); element.append(node); };
  const preset = document.createElement("select"); preset.setAttribute("aria-label", "Paper size");
  for (const value of [...Object.keys(PDF_PAGE_SIZE_PRESETS), "Custom"]) {
    const option = document.createElement("option"); option.value = value; option.textContent = value; preset.append(option);
  }
  label("Size ", preset);
  const orientation = document.createElement("select"); orientation.setAttribute("aria-label", "Paper orientation");
  for (const value of ["portrait", "landscape"]) { const option = document.createElement("option"); option.value = value; option.textContent = value[0].toUpperCase() + value.slice(1); orientation.append(option); }
  label("Orientation ", orientation);
  const custom = document.createElement("div"); custom.className = "hepr-pdf-custom-size";
  const width = document.createElement("input"), height = document.createElement("input");
  for (const [input, name] of [[width, "Width"], [height, "Height"]] as const) { input.type = "number"; input.min = "0"; input.step = "any"; input.setAttribute("aria-label", `Page ${name.toLowerCase()}`); const node = document.createElement("label"); node.append(`${name} `, input); custom.append(node); }
  const unit = document.createElement("select"); unit.setAttribute("aria-label", "Page dimension unit");
  for (const value of ["mm", "in", "pt"]) { const option = document.createElement("option"); option.value = value; option.textContent = value; unit.append(option); }
  custom.append(unit); element.append(custom);
  const unitScale = (): number => unit.value === "mm" ? 72 / 25.4 : unit.value === "in" ? 72 : 1;
  let previousScale = 72 / 25.4;
  const refresh = (): void => { custom.hidden = preset.value !== "Custom"; };
  const setValue = (value: Partial<PdfPageSizeValue>): void => {
    const size = value.pageSize ?? "A4", dimensions = resolvePdfPageSize(size);
    preset.value = typeof size === "string" ? size : "Custom"; orientation.value = value.orientation ?? (dimensions.width > dimensions.height ? "landscape" : "portrait");
    unit.value = "mm"; previousScale = unitScale(); width.value = String(dimensions.width / previousScale); height.value = String(dimensions.height / previousScale); refresh();
  };
  preset.addEventListener("change", () => { if (preset.value !== "Custom") { const dimensions = resolvePdfPageSize(preset.value as PdfPageSizePreset); width.value = String(dimensions.width / unitScale()); height.value = String(dimensions.height / unitScale()); } refresh(); });
  unit.addEventListener("change", () => { const scale = unitScale(); for (const input of [width, height]) if (input.value.trim()) input.value = String(Number(input.value) * previousScale / scale); previousScale = scale; });
  setValue(initial);
  return { element, setValue, focus: () => preset.focus(), read(): PdfPageSizeValue {
    const pageSize = preset.value === "Custom" ? { width: Number(width.value) * unitScale(), height: Number(height.value) * unitScale() } : preset.value as PdfPageSizePreset;
    const direction = orientation.value as PdfPageOrientation; resolvePdfPageSize(pageSize, direction); return { pageSize, orientation: direction };
  } };
}

/** Closing this dialog never replaces the current document. */
export function showNewPdfDialog(document: Document, options: {
  create(request: NewPdfRequest, signal: AbortSignal): Promise<boolean>;
  resume?(entry: EditorRecoveryMetadata, signal: AbortSignal): Promise<boolean>;
  listDrafts?(): Promise<readonly EditorRecoveryMetadata[]>;
  onError?(error: unknown): void;
}) {
  const dialog = document.createElement("dialog"); dialog.className = "hepr-new-pdf-dialog"; dialog.setAttribute("aria-label", "New PDF");
  const heading = document.createElement("h2"); heading.textContent = "New PDF";
  const name = document.createElement("input"); name.type = "text"; name.value = "Untitled"; name.setAttribute("aria-label", "Document name");
  const nameLabel = document.createElement("label"); nameLabel.append("Name ", name);
  const size = createPdfPageSizeControls(document);
  const count = document.createElement("input"); count.type = "number"; count.min = "1"; count.step = "1"; count.value = "1"; count.setAttribute("aria-label", "Initial page count");
  const countLabel = document.createElement("label"); countLabel.append("Pages ", count);
  const numbering = document.createElement("input"); numbering.type = "checkbox"; const numberingLabel = document.createElement("label"); numberingLabel.append(numbering, " Automatic page numbers");
  const hint = document.createElement("p"); hint.textContent = "Add content with the editing tools. Paper size and page numbering can be adjusted later in Pages.";
  const status = document.createElement("div"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const actions = document.createElement("div"); actions.className = "hepr-new-pdf-actions";
  const create = document.createElement("button"); create.type = "button"; create.textContent = "Create PDF";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel"; actions.append(cancel, create);
  const drafts = document.createElement("div"); drafts.className = "hepr-new-pdf-drafts";
  dialog.append(heading, nameLabel, size.element, countLabel, numberingLabel, hint, drafts, status, actions); document.body.append(dialog); dialog.showModal(); name.focus();
  let operation: AbortController | undefined, closed = false;
  const busy = (value: boolean): void => { for (const input of dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button")) input.disabled = value && input !== cancel; cancel.textContent = value ? "Cancel creation" : "Cancel"; };
  const close = (): void => { if (closed) return; closed = true; operation?.abort(); dialog.close(); dialog.remove(); };
  const run = async (action: (signal: AbortSignal) => Promise<boolean>): Promise<void> => {
    if (operation || closed) return; const controller = operation = new AbortController(); busy(true); status.textContent = "Preparing document…";
    try { if (await action(controller.signal) && !closed) close(); else if (!closed) status.textContent = controller.signal.aborted ? "Creation cancelled." : "The current document was kept."; }
    catch (error) { if (!closed) { status.textContent = controller.signal.aborted ? "Creation cancelled." : error instanceof Error ? error.message : String(error); if (!controller.signal.aborted) options.onError?.(error); } }
    finally { if (operation === controller) operation = undefined; if (!closed) busy(false); }
  };
  create.addEventListener("click", () => { void run(async signal => {
    const pageCount = Number(count.value); if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw new RangeError("Choose a positive whole number of pages.");
    return options.create({ ...size.read(), title: name.value.trim().replace(/\.pdf$/i, "") || "Untitled", pageCount, pageNumbering: { enabled: numbering.checked } }, signal);
  }); });
  cancel.addEventListener("click", () => { if (operation) operation.abort(); else close(); });
  dialog.addEventListener("cancel", event => { event.preventDefault(); if (operation) operation.abort(); else close(); });
  if (options.resume && options.listDrafts) void options.listDrafts().then(entries => {
    if (closed) return;
    for (const entry of entries.filter(item => item.createdDocument && !item.protected)) {
      const row = document.createElement("div"), label = document.createElement("span"), button = document.createElement("button");
      label.textContent = `${entry.label} — ${new Date(entry.updatedAt).toLocaleString()}`; button.type = "button"; button.textContent = "Resume draft";
      button.addEventListener("click", () => { void run(signal => options.resume!(entry, signal)); }); row.append(label, button); drafts.append(row);
    }
  }).catch(() => { /* New documents remain available when local recovery is unavailable. */ });
  return { close };
}

/** A resumed document must retain the record key even after structural edits changed its source bytes. */
export async function readCreatedDocumentRecovery(key: string, signal?: AbortSignal) {
  const [{ createEditorRecoveryStore }, { createEditorRecoveryCodec }] = await Promise.all([import("./editorRecoveryStore"), import("./editorRecoveryCodec")]);
  signal?.throwIfAborted(); const store = createEditorRecoveryStore();
  try {
    const record = await store.get(key); signal?.throwIfAborted();
    if (!record?.createdDocument || record.protected) throw new Error("This new-document draft is unavailable.");
    const recovered = await createEditorRecoveryCodec({}).decode(record.envelope, signal); signal?.throwIfAborted();
    const { openEditorSession } = await import("./editorSession"); signal?.throwIfAborted();
    const session = await openEditorSession(recovered.snapshot.sourceScene, { sourcePdf: recovered.snapshot.sourcePdf, sourceLabel: recovered.snapshot.sourceLabel, signal });
    try { await session.restoreRecovery(recovered.snapshot, { signal }); }
    finally { session.dispose(); }
    signal?.throwIfAborted();
    return { record, ...recovered };
  } finally { store.close?.(); }
}
