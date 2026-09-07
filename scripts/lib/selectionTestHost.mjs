// Minimal DOM/event host for the real selection controller, not a browser or
// a replacement implementation of its hit-testing, selection or highlighting.
export function installSelectionTestHost() {
  class Element {
    style = { setProperty() {}, removeProperty() {} };
    offsetWidth = 80;
    offsetHeight = 24;
    addEventListener() {}
    appendChild() {}
    remove() {}
    setPointerCapture() {}
    hasPointerCapture() { return false; }
    releasePointerCapture() {}
  }
  const listeners = new Map();
  const globals = {
    window: {
      innerWidth: 2000, innerHeight: 2000,
      addEventListener(type, handler) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(handler);
      },
      removeEventListener(type, handler) { listeners.get(type)?.delete(handler); }
    },
    document: { createElement: () => new Element(), body: new Element(),
      activeElement: null, getSelection: () => null },
    HTMLElement: Element,
    HTMLInputElement: class extends Element {},
    HTMLTextAreaElement: class extends Element {}
  };
  const originals = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  const canvas = new Element();
  return {
    canvas,
    pointer(type, x, y) {
      for (const listener of listeners.get(type) ?? []) listener({
        target: canvas, clientX: x, clientY: y, pointerId: 1,
        pointerType: "mouse", button: 0, isPrimary: true, ctrlKey: false,
        cancelable: true, stopPropagation() {}, preventDefault() {}
      });
    },
    close() {
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
    get listenerCount() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0); }
  };
}
