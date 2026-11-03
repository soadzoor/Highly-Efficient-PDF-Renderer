/** Saved toolbar ranges must still belong entirely to the active textbox. */
export function editorTextRangeWithin(element: HTMLElement, range: Range | null): range is Range {
  return range !== null && element.contains(range.startContainer) && element.contains(range.endContainer);
}

/** Capture before a toolbar input takes focus, including a collapsed typing caret. */
export function captureEditorTextRange(element: HTMLElement, selection: Selection | null): Range | null {
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  return editorTextRangeWithin(element, range) ? range.cloneRange() : null;
}

/** Change a saved range without moving focus or replacing the document selection. */
export function applyEditorTextRangeCss(element: HTMLElement, saved: Range | null, property: string, value: string): Range | null {
  if (!editorTextRangeWithin(element, saved)) return null;
  const range = saved.cloneRange(), document = element.ownerDocument;
  const style = (node: HTMLElement): void => { (node.style as unknown as Record<string, string>)[property] = value; };
  const container = range.startContainer;
  if (!range.collapsed && container === range.endContainer && container !== element && container.nodeType === 1 &&
      (container as HTMLElement).tagName === "SPAN" && range.startOffset === 0 && range.endOffset === container.childNodes.length) {
    const span = container as HTMLElement;
    style(span); for (const child of span.querySelectorAll<HTMLElement>("*")) style(child);
    return range;
  }
  if (range.collapsed) {
    const node = range.startContainer, parent = node.parentElement;
    // Repeated toolbar input updates the pending caret span instead of nesting
    // empty wrappers. No invisible text is inserted into saved/searchable text.
    if (node.nodeType === 3 && node.textContent === "" && parent && parent !== element && parent.tagName === "SPAN" && parent.childNodes.length === 1) {
      style(parent); return range;
    }
    const span = document.createElement("span"), text = document.createTextNode("");
    style(span); span.append(text); range.insertNode(span); range.setStart(text, 0); range.collapse(true);
    return range;
  }
  const span = document.createElement("span"), contents = range.extractContents();
  style(span);
  // Existing run wrappers have their own inline sizes and would override the
  // new selection style unless descendants receive the same property.
  for (const child of contents.querySelectorAll<HTMLElement>("*")) style(child);
  span.append(contents); range.insertNode(span); range.selectNodeContents(span);
  return range;
}
