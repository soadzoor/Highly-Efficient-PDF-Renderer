export interface PdfPasswordPromptOptions {
  /** Document name shown in the prompt. */
  readonly label: string;
  /** The previously entered password was wrong. */
  readonly retry?: boolean;
  /** Closes the prompt as cancelled. */
  readonly signal?: AbortSignal;
}

/**
 * Ask for a PDF password in a modal dialog. Resolves with the entered text,
 * or null when the dialog is cancelled. The password is not kept anywhere.
 */
export function promptForPdfPassword(options: PdfPasswordPromptOptions): Promise<string | null> {
  if (options.signal?.aborted) return Promise.resolve(null);
  const dialog = document.createElement("dialog");
  dialog.className = "pdf-password-dialog";
  const form = document.createElement("form");
  form.method = "dialog";

  const title = document.createElement("h2");
  title.textContent = "Password required";
  const message = document.createElement("p");
  message.textContent = options.retry
    ? `The password for “${options.label}” is incorrect. Try again.`
    : `“${options.label}” is password protected. Enter its password to open it.`;
  if (options.retry) message.className = "pdf-password-error";

  const input = document.createElement("input");
  input.type = "password";
  input.required = true;
  input.autocomplete = "current-password";
  input.spellcheck = false;
  input.setAttribute("aria-label", "PDF password");

  const actions = document.createElement("div");
  actions.className = "pdf-password-actions";
  // Enter submits with the form's only submit button, Open; Cancel and
  // Escape close the dialog without a password.
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => dialog.close("cancel"));
  const open = document.createElement("button");
  open.type = "submit";
  open.value = "open";
  open.textContent = "Open";
  actions.append(cancel, open);
  form.append(title, message, input, actions);
  dialog.append(form);
  document.body.append(dialog);

  return new Promise((resolve) => {
    const onAbort = (): void => dialog.close("cancel");
    options.signal?.addEventListener("abort", onAbort, { once: true });
    dialog.addEventListener("close", () => {
      options.signal?.removeEventListener("abort", onAbort);
      const password = dialog.returnValue === "open" ? input.value : null;
      input.value = "";
      dialog.remove();
      resolve(password);
    }, { once: true });
    dialog.showModal();
    input.focus();
  });
}
