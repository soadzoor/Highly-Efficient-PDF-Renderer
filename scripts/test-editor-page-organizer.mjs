import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
class Element extends EventTarget {
  childNodes = []; dataset = {}; attributes = new Map(); style = {}; value = ""; checked = false; disabled = false; hidden = false; captures = new Set();
  scrollTop = 0; clientWidth = 400; clientHeight = 240; isConnected = true;
  constructor(tagName, ownerDocument) { super(); this.tagName = tagName; this.ownerDocument = ownerDocument; }
  append(...children) { for (const child of children) { this.childNodes.push(child); child.parentElement = this; } }
  replaceChildren(...children) { this.childNodes = []; this.append(...children); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  remove() { this.isConnected = false; if (this.parentElement) this.parentElement.childNodes = this.parentElement.childNodes.filter(child => child !== this); }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  contains(node) { return node === this || this.childNodes.some(child => child.contains(node)); }
  get scrollHeight() { return this.childNodes.length * 40; }
  getBoundingClientRect() {
    const row = this.dataset.pageIndex !== undefined ? this : this.parentElement?.dataset.pageIndex !== undefined ? this.parentElement : null;
    const top = row ? row.parentElement.childNodes.indexOf(row) * 40 + 100 : 100, height = row ? 40 : this.clientHeight;
    return { left: 0, right: 400, top, bottom: top + height, width: 400, height };
  }
}
const window = new EventTarget(), document = { defaultView: window, createElement: tag => new Element(tag, document) };
document.body = document.createElement("body");
const event = (node, type, props = {}) => { const value = new Event(type, { cancelable: true }); for (const [key, item] of Object.entries(props)) Object.defineProperty(value, key, { value: item }); node.dispatchEvent(value); return value; };
const pointer = (node, type, pointerId, y, pointerType = "touch") => event(node, type, { pointerId, pointerType, button: 0, isPrimary: true, clientX: 20, clientY: y });
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };
const find = (root, predicate) => predicate(root) ? root : root.childNodes.map(child => find(child, predicate)).find(Boolean);
try {
  const { showEditorPagesDialog, reorderEditorPageSelection, nudgeEditorPageSelection } = await import("../src/editorPagesUi.ts");
  assert.deepEqual(reorderEditorPageSelection(5, [1, 3], 4, "after"), [0, 2, 4, 1, 3]);
  assert.deepEqual(reorderEditorPageSelection(5, [1, 3], 1, "before"), [0, 1, 2, 3, 4]);
  assert.deepEqual(nudgeEditorPageSelection(5, [1, 2, 4], -1), [1, 2, 0, 4, 3]);
  assert.deepEqual(nudgeEditorPageSelection(5, [0, 2, 3], 1), [1, 0, 4, 2, 3]);
  let pages = Array.from({ length: 5 }, (_, index) => ({ index, width: 200, height: 300 })), resolveExtract;
  const calls = [], errors = [], options = {
    getPages: () => pages, rotate: async (ids, degrees) => calls.push(["rotate", ids, degrees]), remove: async ids => calls.push(["remove", ids]), insert: async () => {},
    reorder: async order => { calls.push(["order", [...order]]); pages = order.map(index => pages[index]); },
    duplicate: async (ids, at) => { calls.push(["duplicate", [...ids], at]); pages.splice(at, 0, ...ids.map(index => ({ ...pages[index] }))); },
    extract: ids => { calls.push(["extract", [...ids]]); return new Promise(resolve => { resolveExtract = resolve; }); },
    crop: async (ids, box) => calls.push(["crop", [...ids], box]), cancel: () => calls.push(["cancel"]), onError: error => errors.push(error), onClose: () => calls.push(["close"])
  };
  const widget = showEditorPagesDialog(document, options), dialog = document.body.childNodes[0];
  const action = name => find(dialog, element => element.dataset.pagesAction === name), click = name => event(action(name), "click");
  const list = find(dialog, element => element.className === "hepr-editor-pages-list"), row = index => list.childNodes[index], grip = index => row(index).childNodes[0];
  const range = find(dialog, element => element.placeholder === "1-3, 5"), select = text => { range.value = text; click("range"); };
  const chosen = () => list.childNodes.flatMap((row, index) => row.childNodes.find(child => child.type === "checkbox").checked ? [index] : []);
  select("2, 4");
  for (const pointerType of ["touch", "mouse", "pen"]) {
    pointer(grip(1), "pointerdown", 7, 160, pointerType); pointer(window, "pointermove", 7, 295, pointerType);
    assert.equal(row(4).dataset.dropPosition, "after"); pointer(window, "pointerup", 7, 295, pointerType); await settle();
    assert.deepEqual(calls.at(-1), ["order", [0, 2, 4, 1, 3]], `${pointerType} moves selected pages together`); assert.deepEqual(chosen(), [3, 4]); select("2, 4");
  }
  pointer(grip(1), "pointerdown", 9, 160); pointer(window, "pointermove", 9, 295); event(window, "keydown", { key: "Escape" }); const count = calls.length;
  pointer(window, "pointerup", 9, 295); assert.equal(calls.length, count, "Escape cancels page dragging");
  event(row(1), "keydown", { key: "ArrowUp", altKey: true }); await settle(); assert.deepEqual(calls.at(-1), ["order", [1, 0, 3, 2, 4]]); assert.deepEqual(chosen(), [0, 2]);
  const position = find(dialog, element => element.attributes.get("aria-label") === "Insert PDF position"), insertion = find(dialog, element => element.attributes.get("aria-label") === "Insertion page number");
  position.value = "before"; insertion.value = "2"; event(position, "change"); click("duplicate"); await settle();
  assert.deepEqual(calls.at(-1), ["duplicate", [0, 2], 1]); assert.deepEqual(chosen(), [1, 2]);
  const crop = name => find(dialog, element => element.dataset.pageCrop === name);
  for (const [name, value] of Object.entries({ x: 10, y: 20, width: 90, height: 150 })) { crop(name).value = String(value); event(crop(name), "input"); }
  click("crop"); await settle(); assert.deepEqual(calls.at(-1), ["crop", [1, 2], { x: 10, y: 20, width: 90, height: 150 }]);
  click("reset-crop"); await settle(); assert.deepEqual(calls.at(-1), ["crop", [1, 2], null]);
  crop("width").value = ""; click("crop"); await settle(); assert.equal(errors.length, 1); assert.match(errors[0].message, /positive width/);
  click("extract"); assert(widget.isBusy()); assert(action("duplicate").disabled); widget.close(); assert.deepEqual(calls.at(-1), ["cancel"]); assert(dialog.open);
  resolveExtract(); await settle(); assert(!widget.isBusy()); assert.deepEqual(chosen(), [1, 2]); widget.close(); assert(!dialog.open);
  console.log("Page organizer supports stable-block mouse/touch/pen drag, keyboard ordering, duplicate position, extraction, crop/reset and cancellation.");
} finally { hooks.deregister(); }
