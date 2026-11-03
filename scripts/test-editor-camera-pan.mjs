import assert from "node:assert/strict";
import { createEditorCameraPan } from "../src/editorCameraPan.ts";

class Hub extends EventTarget {
  listeners = new Set();
  addEventListener(type, callback, options = {}) {
    const token = { type, callback }; this.listeners.add(token);
    const own = typeof options === "boolean" ? { capture: options } : { ...options }; delete own.signal;
    super.addEventListener(type, callback, own);
    options.signal?.addEventListener("abort", () => { this.listeners.delete(token); super.removeEventListener(type, callback, own); }, { once: true });
  }
}
class Element extends Hub {
  dataset = {}; captures = new Set(); nodeType = 1;
  contains(node) { return node === this || node?.parent === this; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); this.releases = (this.releases ?? 0) + 1; }
}
const previousNode = globalThis.Node; globalThis.Node = Element;
try {
  function harness() {
    const window = new Hub(), document = { defaultView: window }, overlay = new Element(), canvas = new Element(), field = new Element();
    overlay.ownerDocument = document; field.parent = overlay; let currentCanvas = canvas, allowed = true;
    const calls = [], pan = createEditorCameraPan({ overlay, getCanvas: () => currentCanvas, canPan: () => allowed,
      begin: () => calls.push("begin"), pan: (x, y) => calls.push([x, y]), end: () => calls.push("end"),
      onStateChange: active => { assert.equal(pan.isPanning(), active); calls.push(["state", active]); } });
    const event = (type, props = {}) => {
      const value = new Event(type, { cancelable: true });
      for (const [name, item] of Object.entries({ target: overlay, pointerId: 1, button: 1, buttons: 4, isPrimary: true, clientX: 30, clientY: 40, ...props }))
        Object.defineProperty(value, name, { value: item });
      window.dispatchEvent(value); return value;
    };
    return { window, overlay, canvas, field, calls, pan, event, allow: value => { allowed = value; }, swap: () => { currentCanvas = new Element(); } };
  }
  {
    const h = harness(); assert.equal(h.window.listeners.size, 0, "View mode has no camera gesture observers");
    h.event("pointerdown"); assert.deepEqual(h.calls, []);
    h.pan.setActive(true);
    assert(!h.event("pointerdown", { button: 0, buttons: 1 }).defaultPrevented);
    assert(!h.event("pointerdown", { target: new Element() }).defaultPrevented, "toolbar/sidebar input is outside the camera navigation surface");
    assert(h.event("pointerdown").defaultPrevented); assert(h.pan.isPanning()); assert(h.overlay.captures.has(1));
    assert.equal(h.overlay.dataset.cameraPan, "true");
    h.event("pointermove", { clientX: 50, clientY: 55 }); h.event("pointermove", { clientX: 45, clientY: 45 });
    h.event("pointerup", { clientX: 49, clientY: 43, buttons: 0 });
    assert.deepEqual(h.calls.filter(Array.isArray).filter(call => call[0] !== "state"), [[20, 15], [-5, -10], [4, -2]], "camera deltas include final release coordinates without document transforms");
    assert.equal(h.calls.filter(call => call === "end").length, 1); assert(!h.pan.isPanning()); assert(!h.overlay.captures.size);
    assert.equal(h.overlay.dataset.cameraPan, undefined); assert.equal(h.window.listeners.size, 2, "only start/auxclick listeners remain in idle Edit");
    assert(h.event("auxclick", { target: h.canvas }).defaultPrevented);
    assert(!h.event("auxclick", { button: 2 }).defaultPrevented);
    h.pan.setActive(false); assert.equal(h.window.listeners.size, 0); h.pan.dispose();
  }
  for (const boundary of ["pointercancel", "capture", "blur", "resize", "escape", "buttons", "canvas", "busy", "view", "dispose", "secondary"]) {
    const h = harness(); h.pan.setActive(true); h.event("pointerdown", { target: h.field });
    assert(h.pan.isPanning(), "middle navigation over form/text fields preserves the tool rather than native middle paste");
    if (boundary === "capture") {
      const event = new Event("lostpointercapture"); Object.defineProperty(event, "pointerId", { value: 1 }); h.overlay.dispatchEvent(event);
    } else if (boundary === "escape") assert(h.event("keydown", { key: "Escape" }).defaultPrevented);
    else if (boundary === "buttons") h.event("pointermove", { buttons: 0 });
    else if (boundary === "canvas") { h.swap(); h.event("pointermove"); }
    else if (boundary === "busy") { h.allow(false); h.event("pointermove"); }
    else if (boundary === "view") h.pan.setActive(false);
    else if (boundary === "dispose") h.pan.dispose();
    else if (boundary === "secondary") assert(h.event("pointerdown", { pointerId: 2, button: 0 }).defaultPrevented);
    else h.event(boundary);
    assert(!h.pan.isPanning(), `${boundary} ends the camera-only gesture`);
    assert.equal(h.calls.filter(call => call === "end").length, 1);
    h.event("pointerup"); assert.equal(h.calls.filter(call => call === "end").length, 1, "late release cannot finish twice");
    h.pan.dispose(); assert.equal(h.window.listeners.size, 0);
  }
  {
    const h = harness(); h.pan.setActive(true); h.allow(false);
    assert(!h.event("pointerdown").defaultPrevented); assert(!h.pan.isPanning());
    h.allow(true); h.event("pointerdown");
    h.event("pointerup", { pointerId: 7 }); assert(h.pan.isPanning(), "another pointer's release cannot end the drag");
    h.pan.cancel(); h.pan.dispose();
  }
  console.log("Editor camera pan: middle-button capture/deltas, field surface, auxclick, camera/tool independence, lifecycle and idle View cleanup passed.");
} finally { if (previousNode === undefined) delete globalThis.Node; else globalThis.Node = previousNode; }
