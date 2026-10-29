import assert from "node:assert/strict";
import { createEditorContextMenu } from "../src/editorContextMenu.ts";

class Target extends EventTarget {
  listeners = new Map();
  addEventListener(type, listener, options = {}) {
    if (options.signal?.aborted) return;
    const own = { ...options }; delete own.signal;
    super.addEventListener(type, listener, own);
    if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener);
    options.signal?.addEventListener("abort", () => this.removeEventListener(type, listener, own), { once: true });
  }
  removeEventListener(type, listener, options) {
    super.removeEventListener(type, listener, options); this.listeners.get(type)?.delete(listener);
  }
  get listenerCount() { return [...this.listeners.values()].reduce((count, items) => count + items.size, 0); }
}
class Element extends Target {
  childNodes = []; dataset = {}; style = {}; attributes = new Map(); disabled = false; hidden = false; textContent = ""; focusCount = 0;
  constructor(tag, document) { super(); this.tagName = tag; this.ownerDocument = document; }
  append(...nodes) { for (const node of nodes) { node.remove(); this.childNodes.push(node); node.parent = this; } }
  remove() {
    if (!this.parent) return;
    this.parent.childNodes = this.parent.childNodes.filter(node => node !== this); this.parent = null;
    if (this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body;
  }
  get isConnected() { return this === this.ownerDocument.body || Boolean(this.parent?.isConnected); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  contains(node) { return node === this || this.childNodes.some(child => child.contains(node)); }
  closest(selector) {
    return selector === "[data-stack-action]" && this.dataset.stackAction ? this : this.parent?.closest(selector) ?? null;
  }
  focus(options) { if (this.disabled) return; this.ownerDocument.activeElement = this; this.focusCount++; this.focusOptions = options; }
  getBoundingClientRect() { return { width: Math.min(180, parseFloat(this.style.maxWidth) || 0), height: Math.min(128, parseFloat(this.style.maxHeight) || 0) }; }
}
const window = new Target(); window.innerWidth = 320; window.innerHeight = 180;
const document = { defaultView: window, documentElement: { clientWidth: 320, clientHeight: 180 }, createElement: tag => new Element(tag, document) };
document.body = document.createElement("body");
const anchor = document.createElement("canvas"), outside = document.createElement("input"); document.body.append(anchor, outside); anchor.focus();
const actions = ["bring-to-front", "bring-forward", "send-backward", "send-to-back"];
const enabled = new Set(["bring-forward", "send-backward"]), calls = [], errors = [];
let throwCanRun = false, runError, asyncError;
const widget = createEditorContextMenu(document, {
  canRun(action) { if (throwCanRun) throw new Error("Eligibility failed"); return enabled.has(action); },
  run(action) {
    calls.push(action); assert.equal(document.body.childNodes.length, 2, "the popup closes before the document mutation");
    if (runError) throw runError; if (asyncError) return Promise.reject(asyncError);
  },
  onError: error => errors.push(error.message)
});
const menu = () => document.body.childNodes.find(node => node.className === "hepr-editor-context-menu");
const event = (target, type, origin = target, details = {}) => {
  const value = new Event(type, { cancelable: true });
  Object.defineProperty(value, "target", { value: origin });
  for (const [key, item] of Object.entries(details)) Object.defineProperty(value, key, { value: item });
  let stopped = false; const stop = value.stopPropagation.bind(value); value.stopPropagation = () => { stopped = true; stop(); };
  target.dispatchEvent(value); return { value, get stopped() { return stopped; } };
};
const click = action => { const panel = menu(); return event(panel, "click", panel.childNodes.find(button => button.dataset.stackAction === action)); };
const key = (name, viaWindow = false) => event(viaWindow ? window : menu(), "keydown", document.activeElement, { key: name });

assert.equal(window.listenerCount, 0); assert.equal(menu(), undefined, "idle View has no popup node or document listeners");
widget.show({ x: 315, y: 175 });
let panel = menu(); assert(panel); assert.equal(panel.attributes.get("role"), "menu");
assert.equal(panel.attributes.get("aria-label"), "Drawing order within layer");
assert.deepEqual(panel.childNodes.map(button => button.textContent), ["Bring to front", "Bring forward", "Send backward", "Send to back"]);
assert(panel.childNodes.every(button => button.attributes.get("role") === "menuitem"));
assert.deepEqual(panel.childNodes.map(button => button.disabled), [true, false, false, true]);
assert.equal(document.activeElement.dataset.stackAction, "bring-forward");
assert.equal(panel.style.left, "136px"); assert.equal(panel.style.top, "47px", "bottom-edge menus open above the anchor and remain in the viewport");
assert.equal(window.listenerCount, 8);
assert(key("ArrowDown", true).value.defaultPrevented); assert.equal(document.activeElement.dataset.stackAction, "send-backward");
key("ArrowDown"); assert.equal(document.activeElement.dataset.stackAction, "bring-forward", "navigation wraps and skips disabled commands");
key("End"); assert.equal(document.activeElement.dataset.stackAction, "send-backward");
key("Home"); assert.equal(document.activeElement.dataset.stackAction, "bring-forward");
assert(key("Delete", true).stopped, "menu keystrokes cannot delete or nudge the underlying editor selection");
assert(key("Backspace", true).value.defaultPrevented);
click("bring-to-front"); assert.equal(calls.length, 0); assert(menu(), "disabled commands do not close or execute");
click("bring-forward"); assert.deepEqual(calls, ["bring-forward"]); assert.equal(document.activeElement, anchor); assert.equal(window.listenerCount, 0);
assert.equal(menu(), undefined); assert.deepEqual(anchor.focusOptions, { preventScroll: true });

enabled.clear(); actions.forEach(action => enabled.add(action));
for (const action of actions) { widget.show({ x: 20, y: 30 }); click(action); assert.equal(calls.at(-1), action); assert.equal(window.listenerCount, 0); }
widget.show({ x: 10, y: 10 }); enabled.delete("send-to-back");
const beforeStale = calls.length; click("send-to-back");
assert.equal(calls.length, beforeStale, "eligibility is checked again after selection/history changes"); assert(!menu());
enabled.clear(); widget.show({ x: 0, y: 0 }); assert.equal(document.activeElement, menu(), "an all-disabled menu remains keyboard dismissible");
key("ArrowUp"); key("Escape", true); assert.equal(document.activeElement, anchor); assert.equal(window.listenerCount, 0);
actions.forEach(action => enabled.add(action));

for (const type of ["pointerdown", "contextmenu", "wheel", "scroll", "focusin", "resize", "blur"]) {
  anchor.focus(); widget.show({ x: 30, y: 30 }); panel = menu();
  if (["wheel", "scroll", "pointerdown", "contextmenu", "focusin"].includes(type)) {
    event(window, type, panel.childNodes[0]); assert(menu(), `${type} inside the popup remains available`);
  }
  if (type === "focusin") outside.focus();
  const dismissal = event(window, type, outside);
  assert(!menu(), `${type} dismisses the popup`); assert.equal(window.listenerCount, 0, `${type} removes every document listener`);
  if (type === "contextmenu") assert(!dismissal.value.defaultPrevented, "other context menus retain their default behavior");
  if (type === "focusin") assert.equal(document.activeElement, outside, "outside focus is not stolen back");
}

anchor.focus(); widget.show({ x: 10, y: 10 }); panel = menu();
assert(event(panel, "contextmenu").value.defaultPrevented, "the popup suppresses the browser menu over itself");
widget.show({ x: 40, y: 50 }); assert.equal(window.listenerCount, 8, "reopening does not accumulate document listeners");
assert(key("Tab").stopped); assert(!menu()); assert.equal(document.activeElement, anchor);
widget.show({ x: 10, y: 10 });
const saveShortcut = event(window, "keydown", document.activeElement, { key: "s", ctrlKey: true });
assert(!saveShortcut.stopped && !saveShortcut.value.defaultPrevented, "save shortcuts close the menu and remain available to the host");
assert(!menu()); assert.equal(window.listenerCount, 0); assert.equal(document.activeElement, anchor);
window.visualViewport = { offsetLeft: 50, offsetTop: 30, width: 100, height: 70 };
widget.show({ x: 500, y: 500 }); panel = menu();
assert.equal(panel.style.maxWidth, "92px"); assert.equal(panel.style.maxHeight, "62px");
assert.equal(panel.style.left, "54px"); assert.equal(panel.style.top, "34px"); widget.close();
window.visualViewport = null; window.innerWidth = window.innerHeight = 4;
widget.show({ x: NaN, y: Infinity }); panel = menu(); assert.equal(panel.style.maxWidth, "0px"); assert.equal(panel.style.left, "2px"); widget.close();
window.innerWidth = 320; window.innerHeight = 180;

throwCanRun = true; widget.show({ x: 0, y: 0 }); assert(!menu()); assert.equal(window.listenerCount, 0); assert.equal(errors.at(-1), "Eligibility failed"); throwCanRun = false;
anchor.focus(); widget.show({ x: 0, y: 0 }); throwCanRun = true; widget.show({ x: 20, y: 20 });
assert(!menu()); assert.equal(document.activeElement, anchor, "failed repositioning restores the original focus target"); assert.equal(window.listenerCount, 0); throwCanRun = false;
runError = new Error("Action failed"); widget.show({ x: 0, y: 0 }); click("bring-forward"); assert.equal(errors.at(-1), "Action failed"); runError = null;
asyncError = new Error("Async action failed"); widget.show({ x: 0, y: 0 }); click("bring-forward"); await new Promise(resolve => setImmediate(resolve));
assert.equal(errors.at(-1), "Async action failed"); asyncError = null;
anchor.focus(); widget.show({ x: 0, y: 0 }); widget.dispose();
assert(!menu()); assert.equal(window.listenerCount, 0); assert.equal(document.activeElement, anchor);
widget.show({ x: 10, y: 10 }); widget.close(); widget.dispose(); assert(!menu()); assert.equal(window.listenerCount, 0);
console.log("Editor context menu: commands, boundaries, keyboard/focus, viewport, dismissal and idle cleanup passed.");
