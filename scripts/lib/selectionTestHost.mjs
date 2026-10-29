// Minimal DOM/event host for the real selection controller, not a browser or
// a replacement implementation of its hit-testing, selection or highlighting.
export function installSelectionTestHost() {
  let now = 1000;
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
    getBoundingClientRect() { return { left: 0, top: 0, right: globals.window.innerWidth, bottom: globals.window.innerHeight }; }
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
    HTMLTextAreaElement: class extends Element {},
    performance: { now: () => now }
  };
  const originals = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  const canvas = new Element();
  return {
    canvas,
    pointer(type, x, y, options = {}) {
      const event = {
        type,
        target: canvas, clientX: x, clientY: y, pointerId: 1,
        pointerType: "mouse", button: 0, isPrimary: true, ctrlKey: false,
        buttons: type === "pointerup" ? 0 : 1,
        cancelable: true, propagationStopped: false, defaultPrevented: false,
        ...options,
        stopPropagation() { this.propagationStopped = true; },
        preventDefault() { this.defaultPrevented = true; }
      };
      for (const listener of listeners.get(type) ?? []) listener(event);
      return event;
    },
    advanceTime(elapsed) { now += elapsed; },
    close() {
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
    get listenerCount() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0); }
  };
}
