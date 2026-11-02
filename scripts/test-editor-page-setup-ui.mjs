import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(s, c, next) { return next(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c); } });
class Element extends EventTarget {
  childNodes = []; attributes = new Map(); dataset = {}; value = ""; checked = false; disabled = false; hidden = false; style = {};
  constructor(tagName, ownerDocument) { super(); this.tagName = tagName; this.ownerDocument = ownerDocument; }
  append(...children) { this.childNodes.push(...children); for (const child of children) if (typeof child === "object") child.parentElement = this; }
  replaceChildren(...children) { this.childNodes = []; this.append(...children); }
  setAttribute(key, value) { this.attributes.set(key, value); }
  querySelectorAll(selector) { const names = selector.split(",").map(name => name.trim()); return this.childNodes.flatMap(child => typeof child === "object" ? [...(names.includes(child.tagName) ? [child] : []), ...child.querySelectorAll(selector)] : []); }
  showModal() { this.open = true; } close() { this.open = false; }
  remove() { if (this.parentElement) this.parentElement.childNodes = this.parentElement.childNodes.filter(child => child !== this); }
  focus() {} scrollIntoView() {}
}
const makeDocument = () => { const document = { createElement: name => new Element(name, document) }; document.body = document.createElement("body"); return document; };
const find = (root, test) => test(root) ? root : root.childNodes.filter(child => typeof child === "object").map(child => find(child, test)).find(Boolean);
const event = (node, type) => node.dispatchEvent(new Event(type, { cancelable: true }));
const settle = async () => { for (let index = 0; index < 4; index++) await new Promise(resolve => setImmediate(resolve)); };
try {
  const { showEditorPagesDialog } = await import("../src/editorPagesUi.ts");
  const document = makeDocument(), calls = [], errors = [];
  let pages = [{ width: 600, height: 800 }, { width: 300, height: 400 }], release;
  const widget = showEditorPagesDialog(document, { getPages: () => pages, rotate: async () => {}, remove: async () => {}, insert: async () => {},
    async insertBlank(value, at) { calls.push(["insert", value, at]); await new Promise(resolve => { release = resolve; }); pages.splice(at, 0, ...Array.from({ length: value.pageCount }, () => ({ width: 420, height: 300 }))); },
    async resize(selected, size) { calls.push(["resize", selected, size]); }, cancel: () => calls.push(["cancel"]), onClose: () => calls.push(["closed"]), onError: error => errors.push(error) });
  const dialog = document.body.childNodes[0], action = name => find(dialog, item => item.dataset.pagesAction === name), control = name => find(dialog, item => item.attributes.get("aria-label") === name);
  const preset = control("Paper size"), orientation = control("Paper orientation"), paper = find(dialog, item => item.className === "hepr-pdf-page-size");
  assert.equal(preset.value, "Custom", "existing paper dimensions initialize the controls");
  preset.value = "A5"; event(preset, "change"); orientation.value = "landscape"; event(paper, "change");
  control("Blank page count").value = "2"; control("Insert PDF position").value = "before"; control("Insertion page number").value = "2";
  event(action("insert-blank"), "click"); await settle(); assert(widget.isBusy()); assert(paper.disabled); assert.equal(calls[0][2], 1); assert.equal(calls[0][1].pageSize, "A5"); assert.equal(calls[0][1].orientation, "landscape");
  widget.close(); assert.deepEqual(calls.at(-1), ["cancel"]); assert(dialog.open); release(); await settle(); assert(!widget.isBusy());
  preset.value = "Letter"; event(preset, "change"); orientation.value = "landscape"; event(paper, "change"); event(action("resize"), "click"); await settle();
  assert.deepEqual(calls.at(-1), ["resize", [1, 2], { width: 792, height: 612 }]);
  preset.value = "Custom"; event(preset, "change"); control("Page width").value = "0"; event(paper, "input"); event(action("resize"), "click"); await settle(); assert.equal(errors.length, 1); assert.match(errors[0].message, /positive/);
  widget.close(); assert(!dialog.open);

  const { showEditorPageNumberingDialog } = await import("../src/editorPageNumberingUi.ts");
  const { normalizePageNumbering } = await import("../src/documentAuthoring.ts");
  const numberDocument = makeDocument(), applied = [], closed = [];
  showEditorPageNumberingDialog(numberDocument, { settings: normalizePageNumbering(), apply: value => applied.push(value), onClose: () => closed.push(true) });
  const numbering = numberDocument.body.childNodes[0], field = name => find(numbering, item => item.dataset.pageNumbering === name), apply = find(numbering, item => item.tagName === "button" && item.textContent === "Apply");
  field("startNumber").value = ""; event(apply, "click"); assert(numbering.open); assert.equal(applied.length, 0);
  field("startNumber").value = "5"; field("enabled").checked = field("skipFirstPage").checked = true;
  for (const [name, value] of Object.entries({ format: "page-of-total", position: "header", align: "right", marginX: "15", marginY: "8", fontFamily: "Liberation Serif", fontSize: "13", color: "#112233" })) field(name).value = value;
  event(apply, "click"); assert(!numbering.open); assert.equal(closed.length, 1); assert.equal(applied[0].startNumber, 5); assert(applied[0].skipFirstPage); assert.equal(applied[0].format, "page-of-total"); assert.equal(applied[0].position, "header"); assert.equal(applied[0].fontFamily, "Liberation Serif"); assert(Math.abs(applied[0].marginX - 15 * 72 / 25.4) < 1e-8);
  showEditorPageNumberingDialog(numberDocument, { settings: normalizePageNumbering(), apply: value => applied.push(value), onClose() {} });
  const cancelled = numberDocument.body.childNodes[0]; event(cancelled, "cancel"); assert(!cancelled.open); assert.equal(applied.length, 1);
  console.log("Page setup controls: mixed-size defaults, positioned blank insertion, busy cancellation, selected-page resizing and adjustable numbering validation passed.");
} finally { hooks.deregister(); }
