import type { EditorRecoveryController } from "./editorRecovery";
import type { EditorRecoveryMetadata } from "./editorRecoveryStore";

/** Recovery management is explicit; closing the dialog never discards a draft. */
export function showEditorRecoveryDialog(document: Document, options: {
  controller: EditorRecoveryController; currentKey: string; offered?: EditorRecoveryMetadata;
  onRestored?(): void | Promise<void>; onError?(error: unknown): void; onClose?(): void;
  onBusyChange?(busy: boolean): void;
}): { close(): void } {
  const dialog = document.createElement("dialog"); dialog.className = "hepr-editor-recovery-dialog";
  dialog.setAttribute("aria-label", options.offered ? "Recover PDF edits" : "PDF recovery drafts");
  const title = document.createElement("h2"); title.textContent = options.offered ? "Recover unsaved edits?" : "Recovery drafts";
  const detail = document.createElement("p"); detail.textContent = options.offered
    ? "A local recovery draft matches this document. Restore it to continue editing, or discard it. The original file is unchanged."
    : "Drafts stay in this browser. Open the matching source document to restore another draft. Protected drafts require its password.";
  const status = document.createElement("div"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const list = document.createElement("div"), actions = document.createElement("div"); actions.className = "hepr-editor-recovery-actions";
  const close = document.createElement("button"); close.type = "button"; close.textContent = options.offered ? "Later" : "Close"; actions.append(close);
  let closed = false, busy = false;
  const setBusy = (value: boolean): void => { busy = value; for (const button of dialog.querySelectorAll<HTMLButtonElement>("button")) button.disabled = value; options.onBusyChange?.(value); };
  const report = (error: unknown): void => { status.textContent = error instanceof Error ? error.message : String(error); options.onError?.(error); };
  const finish = (): void => { if (closed) return; closed = true; if (busy) setBusy(false); dialog.close(); dialog.remove(); options.onClose?.(); };
  async function remove(entry: EditorRecoveryMetadata): Promise<void> {
    if (busy || closed) return; setBusy(true);
    try { await options.controller.discard(entry.key); if (!closed) { status.textContent = "Recovery draft discarded."; await render(); } }
    catch (error) { if (!closed) report(error); } finally { if (!closed) setBusy(false); }
  }
  async function restore(): Promise<void> {
    if (busy || closed) return; setBusy(true); status.textContent = "Restoring edits…";
    try { await options.controller.restore(); if (closed) return; await options.onRestored?.(); finish(); }
    catch (error) { if (!closed) report(error); } finally { if (!closed) setBusy(false); }
  }
  async function render(): Promise<void> {
    const entries = await options.controller.list(); if (closed) return; list.replaceChildren();
    for (const entry of entries) {
      const row = document.createElement("div"); row.className = "hepr-editor-recovery-row";
      const label = document.createElement("span"); label.textContent = `${entry.label} — ${new Date(entry.updatedAt).toLocaleString()}${entry.protected ? " (encrypted)" : ""}`;
      const discard = document.createElement("button"); discard.type = "button"; discard.textContent = "Discard"; discard.title = `Discard recovery draft for ${entry.label}`;
      discard.addEventListener("click", () => { void remove(entry); }); row.append(label);
      if (entry.key === options.currentKey) {
        const restoreButton = document.createElement("button"); restoreButton.type = "button"; restoreButton.textContent = "Restore";
        restoreButton.addEventListener("click", () => { void restore(); }); row.append(restoreButton);
      }
      row.append(discard); list.append(row);
    }
    if (!entries.length) list.textContent = "No recovery drafts are stored.";
  }
  dialog.append(title, detail, list, status, actions); document.body.append(dialog); dialog.showModal();
  close.addEventListener("click", () => { if (!busy) finish(); });
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); else { event.preventDefault(); finish(); } });
  void render().catch(error => { if (!closed) report(error); }); close.focus();
  return { close: finish };
}
