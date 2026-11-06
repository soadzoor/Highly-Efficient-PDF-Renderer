const owners = new WeakMap<Document, HTMLElement>();
const property = "--hepr-editor-toolbar-inset";

/** Reserve the floating editor toolbar's actual height in the Reader viewport. */
export function createEditorToolbarInset(toolbar: HTMLElement): { update(active: boolean): void; dispose(): void } {
  const document = toolbar.ownerDocument, style = document.documentElement.style;
  let active = false, disposed = false;
  function clear(): void {
    if (owners.get(document) !== toolbar) return;
    owners.delete(document); style.removeProperty(property);
  }
  function measure(): void {
    if (disposed) return;
    if (!active || toolbar.hidden) { clear(); return; }
    const value = `${Math.max(0, toolbar.getBoundingClientRect().height) + 16}px`;
    owners.set(document, toolbar);
    if (style.getPropertyValue(property) !== value) style.setProperty(property, value);
  }
  const observer = new ResizeObserver(measure);
  observer.observe(toolbar);
  return {
    update(value) { if (disposed) return; active = value; measure(); },
    dispose() { if (disposed) return; disposed = true; observer.disconnect(); clear(); }
  };
}
