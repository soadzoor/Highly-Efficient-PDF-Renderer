import type { EditorPdfSaveOptions } from "./editorTypes";
import { validatePdfOutputProtection } from "./pdf/pdfProtection";

type PdfProtection = NonNullable<EditorPdfSaveOptions["protection"]>;

function sameProtection(left: PdfProtection, right: PdfProtection): boolean {
  return left.mode === right.mode && (left.mode !== "password" || right.mode === "password" &&
    left.password === right.password && left.ownerPassword === right.ownerPassword);
}

/** PDF export settings live only for the current editing session. */
export function createEditorPdfProtectionState() {
  let current: PdfProtection = { mode: "preserve" }, saved: PdfProtection = { mode: "preserve" };
  return {
    get(): PdfProtection { return { ...current }; },
    set(value: PdfProtection): void { current = { ...value }; },
    hasChanges(): boolean { return !sameProtection(current, saved); },
    // Keep the exported snapshot as the baseline if settings change during an async save.
    markSaved(exported: PdfProtection): void { saved = { ...exported }; },
    dispose(): void { current = saved = { mode: "preserve" }; }
  };
}

export function editorPdfPasswordDraft(mode: string, password: string, confirmation: string): PdfProtection {
  if (mode === "preserve" || mode === "remove") return validatePdfOutputProtection({ mode });
  if (mode !== "password") throw new Error("Choose a PDF password setting.");
  if (password !== confirmation) throw new Error("The passwords do not match.");
  return validatePdfOutputProtection({ mode, password });
}

export interface EditorPdfPasswordDialog {
  hasDraftChanges(): boolean;
  apply(): boolean;
  close(): void;
}

export function showEditorPdfPasswordDialog(document: Document, initial: PdfProtection,
  onApply: (value: PdfProtection) => void, onClose: () => void): EditorPdfPasswordDialog {
  const dialog = document.createElement("dialog"); dialog.className = "hepr-editor-password-dialog";
  dialog.setAttribute("aria-labelledby", "hepr-pdf-password-title");
  const title = document.createElement("h2"); title.id = "hepr-pdf-password-title"; title.textContent = "PDF password";
  const scope = document.createElement("p"); scope.textContent = "Applies to Save PDF and Flattened PDF. HEP files remain unencrypted; printing uses a temporary PDF without password protection.";
  const label = document.createElement("label"); label.textContent = "Saved PDF protection ";
  const mode = document.createElement("select"); mode.setAttribute("aria-label", "Saved PDF protection");
  for (const [value, text] of [["preserve", "Keep protection of the loaded PDF"], ["remove", "Remove password protection"], ["password", "Set or replace opening password"]]) {
    const option = document.createElement("option"); option.value = value; option.textContent = text; mode.append(option);
  }
  mode.value = initial.mode; label.append(mode);
  const passwordFields = document.createElement("div"); passwordFields.className = "hepr-editor-password-fields";
  const password = document.createElement("input"), confirmation = document.createElement("input");
  for (const [input, text] of [[password, "Password"], [confirmation, "Confirm password"]] as const) {
    input.type = "password"; input.autocomplete = "new-password"; input.spellcheck = false;
    const label = document.createElement("label"); label.textContent = `${text} `; label.append(input); passwordFields.append(label);
  }
  password.value = confirmation.value = initial.mode === "password" ? initial.password : "";
  const privacy = document.createElement("p"); privacy.textContent = "The app keeps these settings in memory for this editing session only and does not store passwords in browser storage.";
  const status = document.createElement("p"); status.setAttribute("role", "alert");
  const actions = document.createElement("div"), apply = document.createElement("button"), cancel = document.createElement("button");
  apply.type = cancel.type = "button"; apply.textContent = "Apply"; cancel.textContent = "Cancel"; actions.append(apply, cancel);
  dialog.append(title, scope, label, passwordFields, privacy, status, actions);
  let closed = false;
  const controller: EditorPdfPasswordDialog = {
    hasDraftChanges() { return !closed && (mode.value !== initial.mode || mode.value === "password" &&
      (password.value !== (initial.mode === "password" ? initial.password : "") || confirmation.value !== (initial.mode === "password" ? initial.password : ""))); },
    apply() {
      if (closed) return true;
      try {
        const value = editorPdfPasswordDraft(mode.value, password.value, confirmation.value);
        onApply(value); controller.close(); return true;
      } catch (error) { status.textContent = error instanceof Error ? error.message : "Check the PDF password settings."; return false; }
    },
    close() {
      if (closed) return; closed = true; password.value = confirmation.value = "";
      dialog.close(); dialog.remove(); onClose();
    }
  };
  const updateMode = (): void => { passwordFields.hidden = mode.value !== "password"; status.textContent = ""; };
  mode.addEventListener("change", updateMode);
  apply.addEventListener("click", () => { controller.apply(); }); cancel.addEventListener("click", () => controller.close());
  dialog.addEventListener("cancel", event => { event.preventDefault(); controller.close(); });
  dialog.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); });
  updateMode(); document.body.append(dialog); dialog.showModal();
  return controller;
}
