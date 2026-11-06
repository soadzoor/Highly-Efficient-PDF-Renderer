import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";
import { editorUiTestContext } from "./lib/editorUiTestContext.mjs";

const source = (await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8")).replace(/^ {2}/gm, "");
const tick = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));

function harness() {
  const controls = new Map(), captures = new Set(), errors = [], measurements = [];
  const font = { id: "test-font", family: "Test font" };
  const scene = { pageRects: [100, 200, 600, 700] };
  const document = { activeElement: null, createElement: tag => new Element(tag), execCommand() {} };
  class Element extends EventTarget {
    nodeType = 1; childNodes = []; attributes = new Map(); dataset = {}; style = {}; value = ""; hidden = false; scrollHeight = 0;
    constructor(tag = "div") { super(); this.tagName = tag.toUpperCase(); this.ownerDocument = document; }
    set textContent(value) { this.childNodes = value ? [{ nodeType: 3, textContent: value, parentElement: this }] : []; }
    get textContent() { return this.childNodes.map(node => node.textContent).join(""); }
    get innerText() { return this.textContent; }
    get innerHTML() { return JSON.stringify(this.childNodes.map(node => [node.textContent, node.style])); }
    append(...children) { for (const child of children) { child.parentElement = this; this.childNodes.push(child); } }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    closest() { return null; }
    contains(node) { return node === this || this.childNodes.some(child => child === node || child.contains?.(node)); }
    focus() { document.activeElement = this; }
    remove() { if (this.parentElement) this.parentElement.childNodes = this.parentElement.childNodes.filter(node => node !== this); }
    setPointerCapture(id) { captures.add(id); }
    hasPointerCapture(id) { return captures.has(id); }
    releasePointerCapture(id) { captures.delete(id); }
  }
  const control = key => { if (!controls.has(key)) controls.set(key, new Element("button")); return controls.get(key); };
  const property = name => { const value = control(`prop:${name}`); value.value ||= name === "font" ? font.id : name === "font-size" ? "12" : name === "align" ? "left" : "#111111"; return value; };
  const overlay = new Element(), changes = [];
  let contentSize = { width: 60, height: 15 }, resizeOptions;
  const context = editorUiTestContext({
    active: true, tool: "text", toolRequest: 0, textRequest: 0, pointer: null, pendingPick: null, picking: null, polygon: null,
    pendingFieldFocus: null, presented: null, currentState: { selection: [] }, IDENTITY: [1, 0, 0, 1, 0, 0], objectOpacity: 1, fillOpacity: 1,
    session: { sourceScene: scene, revision: 0, getActiveLayer: () => "drawing-layer", getLayers: () => [{ id: "drawing-layer", defaultVisible: true }],
      getSelectionBounds: () => null, getSelectionFrame: () => null },
    document, overlay, fields: { hidden: true }, toolbar: { querySelectorAll: () => [] }, contextMenu: { close() {} },
    host: { clientToScenePoint: (x, y) => ({ x, y }), sceneToClientPoint: (x, y) => ({ x, y }) },
    window: {}, selectedFont: async () => font, activateFont: async () => {}, editorTextEditingFamily: id => id,
    editorServices: { fonts: { list: () => [font] } }, readRichTextRuns: element => [{ text: element.innerText }],
    property, query: selector => { const prop = /data-prop="([^"]+)"/.exec(selector); return prop ? property(prop[1]) : control(selector); },
    styleEnabled: () => false, clearPreview() {}, updatePointerCursor() {}, updateGeometry() {}, updateTransformControls() {},
    updateFonts() {}, syncOpacityControls() {}, updateOpacityControls() {}, updateClipboardButtons() {},
    isSceneSettling: () => false, fieldAtClientPoint: () => null,
    pageLocal: point => [point.x - scene.pageRects[0], point.y - scene.pageRects[1]],
    createEditorTextResizeControls(_document, _overlay, options) { resizeOptions = options; return { update() {}, cancel: () => false, dispose() {} }; },
    measureEditorTextBox(_document, element, width) { measurements.push({ element, width }); return { ...contentSize }; },
    recovery: { draftChanged() { changes.push("draft"); } },
    report: error => errors.push(error), commit: () => assert.fail("textbox creation must wait for Apply before modifying the session")
  });
  const names = ["pageAt", "textDraftBounds", "textContentSize", "updateTextAutoSize", "canResizeTextDraft", "textClientToLocal", "startText", "readTextDraft", "cancelText", "cancelPointerGesture", "setTool", "pointerDown", "pointerMove", "pointerUp", "updateShapeGesture"];
  for (const name of names) vm.runInContext(sourceFunction(source, name), context);
  const event = (x, y, options = {}) => ({ target: overlay, button: 0, pointerId: 7, pointerType: "mouse", isPrimary: true,
    clientX: x, clientY: y, preventDefault() {}, stopPropagation() {}, ...options });
  return { context, event, errors, captures, measurements, changes, property,
    resizeOptions: () => resizeOptions, setContentSize: size => { contentSize = size; },
    input(text) { const element = context.activeText.element; element.textContent = text; element.dispatchEvent(new Event("input")); } };
}

{
  const h = harness(), c = h.context;
  await c.pointerDown(h.event(300, 400));
  assert.equal(c.activeText, null, "a press begins drawing without opening a content editor");
  assert(c.pointer); assert(h.captures.has(7), "textbox drawing captures the pointer until release");
  c.pointerUp(h.event(300, 400)); await tick();
  const draft = c.activeText; assert(draft);
  assert(draft.width < 220 && draft.height < 50, "a click starts a smaller textbox than the old 220 by 50 default");
  assert.equal(draft.x + draft.width / 2, 200, "the clicked page-local X is the textbox center");
  assert.equal(draft.y + draft.height / 2, 200, "the clicked page-local Y is the textbox center");
  assert(draft.autoSize, "a click-created textbox retains automatic sizing"); assert.equal(draft.layerId, "drawing-layer");
  assert.equal(h.captures.size, 0); assert.equal(c.session.revision, 0);
  const anchor = { x: draft.x, top: draft.y + draft.height };
  h.setContentSize({ width: 310, height: 44 }); h.input("A longer first line\nwith a second line");
  assert(draft.width >= 310, "typing grows a click-created textbox horizontally");
  assert(draft.height >= 44, "multiline typing grows a click-created textbox vertically");
  assert.equal(draft.x, anchor.x); assert.equal(draft.y + draft.height, anchor.top, "growth keeps the text's top anchor stable");
  assert(h.measurements.length > 0); assert(h.changes.length > 0); assert.deepEqual(h.errors, []);
  const saved = await c.readTextDraft(); assert.equal(saved.width, draft.width); assert.equal(saved.height, draft.height);
  assert.equal(saved.x, draft.x); assert.equal(saved.y, draft.y); assert.equal(saved.fontSize, 12, "automatic sizing retains the original character size");
  const resize = h.resizeOptions();
  const originalBounds = { x: draft.x, y: draft.y, width: draft.width, height: draft.height }, autoSize = draft.autoSize;
  const movedBounds = { ...originalBounds, x: draft.x + 25, y: draft.y - 10 };
  resize.onMove(movedBounds); resize.onChange();
  assert.deepEqual(plain(resize.getBounds()), movedBounds, "moving updates only the pending textbox's position");
  assert.equal(draft.autoSize, autoSize, "moving a click-created textbox preserves automatic sizing");
  const movedDraft = await c.readTextDraft();
  assert.equal(movedDraft.x, movedBounds.x); assert.equal(movedDraft.y, movedBounds.y);
  assert.equal(movedDraft.fontSize, saved.fontSize); assert.equal(movedDraft.text, saved.text);
  resize.onMove(originalBounds); resize.onChange(true);
  resize.onResizeStart();
  resize.onResize({ x: draft.x, y: draft.y + draft.height - 40, width: 120, height: 40 });
  assert.equal(draft.autoSize, undefined);
  resize.onResize(originalBounds); resize.onChange(true);
  assert.equal(draft.autoSize, autoSize, "cancelling a resize restores the click-created textbox's automatic sizing");
  h.setContentSize({ width: 350, height: 60 }); h.input("Typing after resize cancellation grows the textbox again");
  assert.equal(draft.width, 350); assert.equal(draft.height, 60);
  resize.onResizeStart();
  resize.onResize({ x: draft.x, y: draft.y + draft.height - 40, width: 120, height: 40 });
  resize.onChange();
  const fixedBounds = { x: draft.x, y: draft.y, width: draft.width, height: draft.height };
  resize.onResizeStart();
  resize.onResize({ ...fixedBounds, width: 140 }); resize.onResize(fixedBounds); resize.onChange(true);
  assert.equal(draft.autoSize, undefined, "a later cancelled resize cannot revive automatic sizing after an accepted manual resize");
  h.setContentSize({ width: 500, height: 180 }); h.input("Manual sizing should preserve wrapping");
  assert.equal(draft.width, 120); assert.equal(draft.height, 40, "manual resizing disables automatic size changes");
  h.setContentSize({ width: 90, height: 60 }); resize.getContentSize(false, true);
  assert.equal(h.measurements.at(-1).width, 120, "height fitting measures content wrapped to the existing width");
  resize.getContentSize(true, false);
  assert.equal(h.measurements.at(-1).width, undefined, "width fitting measures the content's natural line width");
}

{
  const h = harness(), c = h.context;
  await c.pointerDown(h.event(300, 400)); c.pointerUp(h.event(300, 400)); await tick();
  const draft = c.activeText, resize = h.resizeOptions();
  const abandonedBounds = { x: draft.x, y: draft.y + draft.height - 40, width: 120, height: 40 };
  resize.onResizeStart(); resize.onResize(abandonedBounds);
  // Hiding or invalidating the controls can abandon a gesture without an end callback.
  resize.onResizeStart(); resize.onResize({ ...abandonedBounds, width: 140 });
  resize.onResize(abandonedBounds); resize.onChange(true);
  assert.equal(draft.autoSize, undefined, "cancelling a later resize cannot recover an abandoned gesture's old automatic sizing");
  h.setContentSize({ width: 500, height: 180 }); h.input("A later input retains the abandoned manual bounds");
  assert.equal(draft.width, 120); assert.equal(draft.height, 40); assert.deepEqual(h.errors, []);
}

for (const [start, end, expected] of [
  [[250, 350], [440, 420], { x: 150, y: 150, width: 190, height: 70 }],
  [[440, 420], [250, 350], { x: 150, y: 150, width: 190, height: 70 }]
]) {
  const h = harness(), c = h.context;
  await c.pointerDown(h.event(...start));
  c.pointerMove(h.event(end[0] - 10, end[1] - 10));
  assert.equal(c.activeText, null, "drawing does not take contenteditable focus during the drag");
  c.pointerUp(h.event(...end)); await tick();
  const draft = c.activeText; assert(draft);
  assert.deepEqual(plain({ x: draft.x, y: draft.y, width: draft.width, height: draft.height }), expected,
    "the final release point defines exact bounds in either drawing direction");
  assert.equal(draft.fixedHeight, true, "a drawn textbox retains its chosen height");
  h.setContentSize({ width: 500, height: 140 }); h.input("Text that would require a much larger box");
  assert.deepEqual(plain({ x: draft.x, y: draft.y, width: draft.width, height: draft.height }), expected,
    "typing preserves both dimensions of a drawn textbox");
  const saved = await c.readTextDraft();
  assert.deepEqual(plain({ x: saved.x, y: saved.y, width: saved.width, height: saved.height }), expected,
    "the author model retains the exact drawn bounds even when text overflows");
  assert.equal(h.captures.size, 0); assert.deepEqual(h.errors, []);
}

{
  const h = harness(), c = h.context;
  await c.pointerDown(h.event(300, 400));
  c.pointerMove(h.event(301, 400)); c.pointerUp(h.event(301, 401)); await tick();
  assert(c.activeText.width > 2 && c.activeText.height > 2, "click jitter must not create an unusably tiny fixed textbox");
  assert(c.activeText.autoSize);
  c.cancelText(); await c.pointerDown(h.event(300, 400)); c.cancelPointerGesture();
  c.pointerUp(h.event(440, 420)); await tick();
  assert.equal(c.activeText, null, "a cancelled drawing cannot reopen on its later release");
  assert.equal(h.captures.size, 0); assert.equal(c.session.revision, 0); assert.deepEqual(h.errors, []);
}

{
  const h = harness(), c = h.context;
  let finishFont;
  c.activateFont = () => new Promise(resolve => { finishFont = resolve; });
  await c.pointerDown(h.event(300, 400)); c.pointerUp(h.event(300, 400)); await tick();
  assert.equal(c.activeText, null); assert(finishFont);
  c.setTool("rectangle"); finishFont(); await tick();
  assert.equal(c.activeText, null, "changing tools during font loading cannot create a stale textbox");
  assert.deepEqual(h.errors, []);
}

console.log("Textbox creation: centered click-to-type growth, exact fixed drag bounds in both directions, click jitter, cancellation and delayed-font guards passed.");
