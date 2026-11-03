import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const imports = [];
const hooks = registerHooks({
  resolve(specifier, context, next) {
    imports.push(specifier);
    return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
      ? `${specifier}.ts` : specifier, context);
  },
  load(url, context, next) {
    return url.endsWith("/viewerFileDrop.css") ? { format: "module", shortCircuit: true, source: "export {};" } : next(url, context);
  }
});
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const file = (name, type = "") => ({ name, type, arrayBuffer() { assert.fail("the drop router cannot read files before delegating an approved action"); } });
function emit(target, type, values = {}) {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(values)) Object.defineProperty(event, key, { value, configurable: true });
  target.dispatchEvent(event); return event;
}
class Element extends EventTarget {
  children = []; attributes = {}; open = false;
  constructor(tag, document) { super(); this.tagName = tag; this.ownerDocument = document; }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  setAttribute(key, value) { this.attributes[key] = value; }
  showModal() { this.open = true; }
  close() { this.open = false; emit(this, "close"); }
  focus() { this.ownerDocument.activeElement = this; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
}
function browser() {
  const window = new EventTarget(), elements = [], document = { defaultView: window, activeElement: null };
  document.createElement = tag => { const element = new Element(tag, document); elements.push(element); return element; };
  document.body = document.createElement("body"); document.documentElement = document.createElement("html");
  return { window, document, elements };
}
try {
  const { droppedFileKind } = await import("../src/documentDropFiles.ts");
  const { createViewerFileDropController, showViewerDropChoice } = await import("../src/viewerFileDrop.ts");
  assert(!imports.some(value => /editor(?:Ui|Session|AppServices)|pdfSession|hepReader|editorPdfWriter/.test(value)), "View drop setup cannot load parser/editor/font services");
  for (const [name, type, expected] of [["A.PDF", "", "pdf"], ["a", "application/pdf", "pdf"], ["A.HEP", "", "hep"],
    ["old.ZIP", "", "hep"], ["a", "application/x-zip-compressed", "hep"], ["a", "application/x-hep", "hep"],
    ["a.PNG", "", "image"], ["a.jpeg", "", "image"], ["a.JPG", "", "image"], ["a.webp", "", "image"],
    ["a", "image/png", "image"], ["a.gif", "image/gif", null]]) assert.equal(droppedFileKind(file(name, type)), expected);
  const a = file("first.pdf"), b = file("second.hep"), c = file("third.zip"), image = file("signature.png");
  function harness(source = { identity: {}, label: "current.pdf" }, choice = "attach") {
    const dom = browser(), state = { source, editing: false, busy: false, replace: true }, calls = [], statuses = [], dragging = [], choices = [];
    const options = { document: dom.document, getDocument: () => state.source, isEditing: () => state.editing, isBusy: () => state.busy,
      async replace(value, signal) { calls.push(["replace", value, signal]); if (state.replace) state.source = { identity: {}, label: value.name }; return state.replace; },
      async attach(values, signal) { calls.push(["attach", values, signal]); },
      async insertImages(values, point, signal) { calls.push(["images", values, point, signal]); },
      chooseAction: async (current, values, signal) => { choices.push({ current, values, signal }); return typeof choice === "function" ? choice(current, values, signal) : choice; },
      setStatus: value => statuses.push(value), setDragging: value => dragging.push(value) };
    const controller = createViewerFileDropController(options);
    return { ...dom, state, options, controller, calls, statuses, dragging, choices };
  }
  for (const editing of [false, true]) {
    const h = harness(); h.state.editing = editing;
    const source = h.state.source; await h.controller.drop([a, b, c], { x: 20, y: 30 });
    assert.deepEqual(h.calls.map(call => call.slice(0, 2)), [["attach", [a, b, c]]]);
    assert.equal(h.state.source, source); assert.equal(h.state.editing, editing, "attachment preserves View/Edit mode");
    assert.equal(h.choices[0].current, source); h.controller.dispose();
  }
  for (const source of [null, { identity: {}, label: "old.hep" }]) {
    const h = harness(source, "replace"); await h.controller.drop([a, b, c], { x: 0, y: 0 });
    assert.deepEqual(h.calls.map(call => call.slice(0, 2)), [["replace", a], ["attach", [b, c]]], "multiple replacements open the first then attach every remaining file in order");
    assert.equal(h.choices.length, source ? 1 : 0); h.controller.dispose();
  }
  {
    const h = harness(undefined, null); await h.controller.drop([a], { x: 0, y: 0 }); assert.equal(h.calls.length, 0); h.controller.dispose();
    const declined = harness(undefined, "replace"); declined.state.replace = false;
    await declined.controller.drop([a, b], { x: 0, y: 0 }); assert.deepEqual(declined.calls.map(call => call[0]), ["replace"], "declining unsaved replacement never appends to the old document"); declined.controller.dispose();
  }
  for (const boundary of ["source", "busy", "cancel", "dispose"]) {
    const choice = deferred(), h = harness(undefined, () => choice.promise);
    const dropping = h.controller.drop([a], { x: 0, y: 0 }); assert(h.controller.isBusy());
    await h.controller.drop([b], { x: 0, y: 0 }); assert.equal(h.choices.length, 1, "a second drop cannot overwrite an active decision");
    if (boundary === "source") h.state.source = { identity: {}, label: "new.pdf" };
    if (boundary === "busy") h.state.busy = true;
    if (boundary === "cancel") h.controller.cancel();
    if (boundary === "dispose") h.controller.dispose();
    choice.resolve("attach"); await dropping; assert.equal(h.calls.length, 0, `${boundary} invalidates the old choice`);
    assert.equal(h.controller.isBusy(), false); h.controller.dispose();
  }
  {
    const h = harness(); h.state.busy = true; await h.controller.drop([a], { x: 0, y: 0 }); assert.equal(h.choices.length, 0);
    h.state.busy = false;
    await h.controller.drop([image], { x: 5, y: 9 }); assert.equal(h.calls.length, 0); assert.match(h.statuses.at(-1), /switch to Edit/);
    const photo = file("photo.webp"); h.state.editing = true; await h.controller.drop([image, photo], { x: 5, y: 9 });
    assert.deepEqual(h.calls[0].slice(0, 3), ["images", [image, photo], { x: 5, y: 9 }]);
    assert.equal(h.choices.length, 0, "images never open the document replacement dialog");
    h.calls.length = 0; await h.controller.drop([a, image], { x: 0, y: 0 }); assert.equal(h.calls.length, 0); assert.match(h.statuses.at(-1), /separately/);
    await h.controller.drop([a, file("unknown.txt")], { x: 0, y: 0 }); assert.equal(h.calls.length, 0); assert.match(h.statuses.at(-1), /PDF\/HEP/);
    h.controller.dispose();
  }
  {
    const h = harness(null); assert(!emit(h.window, "dragover", { dataTransfer: { types: ["text/plain"] } }).defaultPrevented);
    const transfer = { types: ["Files"], files: [a] };
    assert(emit(h.window, "dragenter", { dataTransfer: transfer }).defaultPrevented);
    assert(emit(h.window, "dragover", { dataTransfer: transfer }).defaultPrevented); assert.equal(transfer.dropEffect, "copy");
    const event = emit(h.window, "drop", { dataTransfer: transfer, clientX: 12, clientY: 34 }); assert(event.defaultPrevented);
    await tick(); assert.equal(h.calls[0][1], a); assert.equal(h.dragging.at(-1), false);
    h.controller.dispose(); const before = h.calls.length;
    emit(h.window, "drop", { dataTransfer: transfer, clientX: 0, clientY: 0 }); await tick(); assert.equal(h.calls.length, before);
  }
  for (const action of ["Replace", "Attach at end", "Cancel", "Escape", "abort"]) {
    const dom = browser(), abort = new AbortController();
    const deciding = showViewerDropChoice(dom.document, { identity: {}, label: "<current.pdf>" }, [a, b], abort.signal);
    const dialog = dom.elements.find(element => element.tagName === "dialog"); assert(dialog.open);
    assert.equal(dom.document.activeElement.textContent, "Cancel");
    assert.match(dialog.children[1].textContent, /<current.pdf>/, "document labels are plain text");
    if (action === "Escape") emit(dialog, "cancel");
    else if (action === "abort") abort.abort();
    else emit(dom.elements.find(element => element.tagName === "button" && element.textContent === action), "click");
    assert.equal(await deciding, action === "Replace" ? "replace" : action === "Attach at end" ? "attach" : null);
    assert.equal(dom.document.body.children.length, 0); assert.equal(dialog.open, false);
  }
  console.log("Window file drops: decisions, ordered attachments, image mode routing, cancellation, stale identities, modal cleanup and lazy View setup passed.");
} finally { hooks.deregister(); }
