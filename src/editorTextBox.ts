/** Measure rich editing DOM in local units, independently of camera/object transforms. */
export function measureEditorTextBox(document: Document, element: HTMLElement, width?: number): { width: number; height: number } {
  const probe = element.cloneNode(true) as HTMLElement;
  probe.removeAttribute("id"); probe.contentEditable = "false"; probe.hidden = false;
  probe.setAttribute("aria-hidden", "true");
  Object.assign(probe.style, { position: "absolute", left: "0", top: "0", visibility: "hidden", pointerEvents: "none",
    transform: "none", width: width === undefined ? "max-content" : `${width}px`, minWidth: "0", maxWidth: "none",
    height: "auto", minHeight: "0", maxHeight: "none" });
  // Non-editable CSS can omit the empty line after a terminal literal newline.
  // Keep that line measurable without adding a line after a final block/BR.
  let tail: ChildNode | null = probe.lastChild;
  while (tail?.lastChild) tail = tail.lastChild;
  if (tail?.nodeType === 3 && tail.textContent?.endsWith("\n")) tail.parentNode?.appendChild(document.createTextNode("\u200b"));
  (element.parentElement ?? document.body).append(probe);
  try {
    const bounds = probe.getBoundingClientRect();
    const lineHeight = parseFloat(element.style.fontSize) * (Number(element.style.lineHeight) || 1.2);
    return { width: Math.max(1, Math.ceil(bounds.width)), height: Math.max(1, Math.ceil(bounds.height), probe.scrollHeight, lineHeight || 0) };
  } finally { probe.remove(); }
}
