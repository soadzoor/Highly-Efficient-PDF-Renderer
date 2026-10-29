export type EditorPdfFormExportChoice = "pdf" | "flatten";

/** An explicit copy-format decision; neither choice changes the active document. */
export function chooseEditorPdfFormExport(document: Document, signal?: AbortSignal, options: { layerStacking?: boolean } = {}): Promise<EditorPdfFormExportChoice | null> {
  if (signal?.aborted) return Promise.resolve(null);
  const dialog = document.createElement("dialog");
  dialog.className = "hepr-editor-form-export-dialog";
  const title = options.layerStacking ? "Save drawing order" : "Save artwork over form fields";
  dialog.setAttribute("aria-label", title);
  dialog.innerHTML = `<h2>${title}</h2>
    <p>${options.layerStacking ? "Object or layer order has changed. Standard PDF readers paint editable annotations above page graphics, and may paint form fields above other annotations, regardless of the requested drawing order." : "Some artwork may overlap form fields. Chrome and some other PDF readers paint editable fields above drawings, signatures and other annotations."}</p>
    <p><strong>Flattened PDF</strong> keeps the displayed paint order. Fields and annotations become page graphics in this copy.</p>
    <p><strong>Editable PDF</strong> keeps the form fields and annotations editable. ${options.layerStacking ? "Stacking follows the reader's separate page, annotation and form-field passes." : "Those readers may cover overlapping artwork with the fields."}</p>
    <p>Your active document stays editable with either choice.</p>
    <div><button type="button" data-export-choice="flatten">Save flattened PDF</button>
    <button type="button" data-export-choice="pdf" autofocus>Save editable PDF</button>
    <button type="button" data-export-choice="cancel">Cancel</button></div>`;
  const previous = document.activeElement as HTMLElement | null;
  document.body.append(dialog);
  return new Promise((resolve, reject) => {
    let settled = false;
    const clean = (): void => {
      signal?.removeEventListener("abort", cancel);
      if (dialog.open) dialog.close();
      dialog.remove();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
    const finish = (choice: EditorPdfFormExportChoice | null): void => {
      if (settled) return; settled = true; clean(); resolve(choice);
    };
    const cancel = (): void => finish(null);
    signal?.addEventListener("abort", cancel, { once: true });
    dialog.addEventListener("click", event => {
      const choice = (event.target as Element).closest<HTMLElement>("[data-export-choice]")?.dataset.exportChoice;
      if (choice === "pdf" || choice === "flatten") finish(choice);
      else if (choice === "cancel") cancel();
    });
    dialog.addEventListener("cancel", event => { event.preventDefault(); cancel(); });
    dialog.addEventListener("close", cancel);
    if (signal?.aborted) { cancel(); return; }
    try { dialog.showModal(); }
    catch (error) { settled = true; clean(); reject(error); }
  });
}
