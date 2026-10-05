import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createPdfAnnotationControls } from "../src/pdfAnnotationControls.ts";

const selectors = [".pdf-annotations", ".pdf-annotations-clear", ".pdf-annotations-all", ".pdf-annotations-all input", ".pdf-annotations-all span", ".pdf-annotations-filter",
  ".pdf-annotations-filter input", ".pdf-annotations-list", ".pdf-annotations-status"];
class Element extends EventTarget {
  childNodes = []; value = ""; textContent = ""; title = ""; className = ""; type = "";
  attributes = new Map();
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  scrollIntoView() { this.scrolled = true; }
  checked = false; indeterminate = false; disabled = false; hidden = false;
  constructor(tag = "div", created = false) {
    super(); this.tagName = tag; this.created = created;
    this.ownerDocument = { createElement: name => new Element(name, true) };
  }
  append(...children) { this.childNodes.push(...children); }
  replaceChildren(...children) { this.childNodes = [...children]; this.textContent = ""; }
  set innerHTML(_html) {
    if (this.created) throw new Error("PDF strings must never become HTML");
    this.elements = new Map(selectors.map(selector => [selector, new Element(selector.endsWith("input") ? "input" : "div")]));
  }
  querySelector(selector) { return this.elements.get(selector); }
}
const walk = node => [node, ...node.childNodes.flatMap(walk)];
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const annotation = (id, subtype, extra = {}) => ({ id, subtype, sourcePageIndex: 0, pageIndex: 0, annotationIndex: 0, flags: 0,
  visibleInDefaultView: true, hasAppearance: true, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, pdfGeometry: { rect: [0, 0, 1, 1] }, ...extra });

const sceneA = { annotations: [
  annotation("ref:1:0", "Square", { contents: "Kitchen <b>note</b>\n  second line", author: "Ann" }),
  annotation("ref:2:0", "Link", { sourcePageIndex: 2, action: { type: "URI", uri: "https://example.com/spec" } }),
  annotation("ref:3:0", "Popup", { parentId: "ref:1:0" }),
  annotation("ref:4:0", "Text", { flags: 2, contents: "Hidden flag" }),
  annotation("ref:5:0", "Link", { destination: { sourcePageIndex: 4 } }),
  // Inside a PDF layer that is off by default; turning the layer on shows it.
  annotation("ref:6:0", "Ink", { optionalContent: 0, visibleInDefaultView: false })
] };
let scene = sceneA;
let applied = new Map([["ref:1:0", true], ["ref:6:0", true]]);
const calls = [], pending = [];
let changes = 0;
const controller = {
  getScene: () => scene,
  getAnnotationLayers: () => [...applied].map(([annotationId, visible]) => ({ annotationId, visible })),
  setAnnotationVisibility(ids, visible) {
    calls.push([[...ids], visible]);
    return new Promise((resolve, reject) => pending.push({ resolve: () => { for (const id of ids) applied.set(id, visible); resolve(); }, reject }));
  }
};
const container = new Element();
const widget = createPdfAnnotationControls({ container, controller, onChange: () => { changes++; } });
const all = container.querySelector(".pdf-annotations-all input"), allText = container.querySelector(".pdf-annotations-all span");
const allLabel = container.querySelector(".pdf-annotations-all"), filterLabel = container.querySelector(".pdf-annotations-filter");
const filter = container.querySelector(".pdf-annotations-filter input");
const list = container.querySelector(".pdf-annotations-list"), status = container.querySelector(".pdf-annotations-status");
const boxes = () => walk(list).filter(node => node.tagName === "input");
const rows = () => walk(list).filter(node => node.tagName === "span").map(node => node.textContent);
const toggle = (box, checked) => { box.checked = checked; box.dispatchEvent(new Event("change")); };

assert.deepEqual(rows(), ["Square · p. 1 — Kitchen <b>note</b> second line", "Link · p. 3 — https://example.com/spec",
  "Link · p. 1 — Go to page 5", "Ink · p. 1"], "popups and Hidden/NoView annotations are not listed; text stays literal");
assert(boxes().every(box => box.checked && !box.disabled), "every listed annotation can be turned off, including links");
assert.equal(all.checked, true); assert.equal(all.indeterminate, false); assert.equal(allText.textContent, "All");

const square = boxes()[0];
toggle(square, false);
assert.deepEqual(calls, [[["ref:1:0"], false]]);
assert.equal(widget.isAnnotationEnabled("ref:1:0"), false); assert.equal(widget.isAnnotationEnabled(sceneA.annotations[0]), false);
assert.equal(changes, 1, "the host overlay is refreshed at once");
assert.match(status.textContent, /Applying/);
assert.equal(boxes()[0], square, "toggling keeps the row, and with it keyboard focus");
assert.equal(all.checked, false); assert.equal(all.indeterminate, true);
pending.shift().resolve(); await tick();
assert.equal(status.textContent, ""); assert.equal(applied.get("ref:1:0"), false);

toggle(boxes()[1], false);
assert.equal(calls.length, 1, "annotations without a drawn appearance change only in the overlay");
assert.equal(widget.isAnnotationEnabled("ref:2:0"), false); assert.equal(changes, 2); assert.equal(status.textContent, "");

filter.value = "LINK"; filter.dispatchEvent(new Event("input"));
assert.equal(boxes().length, 2); assert.equal(allText.textContent, "All matching");
assert.equal(all.indeterminate, true);
toggle(all, true);
assert.equal(widget.isAnnotationEnabled("ref:2:0"), true); assert.equal(widget.isAnnotationEnabled("ref:5:0"), true);
assert.equal(widget.isAnnotationEnabled("ref:1:0"), false, "All matching leaves filtered-out annotations alone");
assert.equal(calls.length, 1);
filter.value = "ann"; filter.dispatchEvent(new Event("input"));
assert.deepEqual(rows(), [rows()[0]]); assert.match(rows()[0], /^Square/, "the filter also matches authors");
filter.value = "nothing"; filter.dispatchEvent(new Event("input")); assert.equal(list.textContent, "No matching annotations.");
filter.value = ""; filter.dispatchEvent(new Event("input"));
assert.equal(boxes().length, 4); assert.equal(boxes()[0].checked, false); assert.equal(all.indeterminate, true);

toggle(all, true);
assert.deepEqual(calls.at(-1), [["ref:1:0", "ref:6:0"], true], "All sends one request for the drawn appearances");
assert.equal(boxes()[0].checked, true);
pending.shift().reject(new Error("Surface budget exceeded")); await tick();
assert.match(status.textContent, /Surface budget exceeded/);
assert.equal(boxes()[0].checked, false, "a failed change shows the applied appearance state");
assert.equal(widget.isAnnotationEnabled("ref:1:0"), false); assert.equal(widget.isAnnotationEnabled("ref:6:0"), true);

// A replacement renderer for the same document starts from its own state.
applied = new Map([["ref:1:0", true], ["ref:6:0", false]]);
widget.sceneChanged();
assert.deepEqual(calls.slice(-2), [[["ref:1:0"], false], [["ref:6:0"], true]], "same-document replacements get the panel state");
pending.splice(0).forEach(operation => operation.resolve()); await tick();
assert.equal(boxes()[0].checked, false); assert.equal(boxes()[3].checked, true);
widget.sceneChanged(); assert.equal(calls.length, 4, "an unchanged renderer needs no requests");

toggle(boxes()[3], false);
filter.value = "stale"; filter.dispatchEvent(new Event("input"));
scene = { annotations: Array.from({ length: 501 }, (_, index) => annotation(`ref:${100 + index}:0`, "Square", { sourcePageIndex: index })) };
applied = new Map();
widget.sceneChanged();
pending.shift().reject(new Error("old document")); await tick();
assert.equal(status.textContent, "", "failures from the previous document are ignored");
assert.equal(filter.value, ""); assert.equal(boxes().length, 500);
assert.match(walk(list).at(-1).textContent, /Showing 500 of 501/);
assert.equal(widget.isAnnotationEnabled("ref:1:0"), true, "a new document starts with every annotation on");
toggle(all, false);
assert.equal(widget.isAnnotationEnabled("ref:600:0"), false, "All reaches annotations beyond the list limit");

scene = { annotations: [annotation("ref:9:0", "FreeText")] };
applied = new Map([["ref:9:0", false]]);
widget.sceneChanged();
assert.equal(widget.isAnnotationEnabled("ref:9:0"), false, "a new document starts from its applied appearances");
assert.equal(boxes()[0].checked, false);

scene = { annotations: [] }; widget.sceneChanged();
assert.equal(list.textContent, "This document has no annotations.");
assert.equal(allLabel.hidden, true); assert.equal(filterLabel.hidden, true);
scene = null; widget.sceneChanged(); assert.equal(boxes().length, 0);

widget.dispose(); widget.dispose();
assert.equal(container.childNodes.length, 0);
const before = calls.length;
toggle(all, true); filter.dispatchEvent(new Event("input"));
assert.equal(calls.length, before, "disposal removes the panel listeners");

// Selection buttons never toggle appearance checkboxes; canvas selection reveals filtered/limited rows.
scene = { annotations: Array.from({ length: 502 }, (_, index) => annotation(`row:${index}`, "Square", { annotationIndex: index })) };
applied = new Map();
const selectionRoot = new Element(), selectedEvents = [], hoveredEvents = [];
const selectable = createPdfAnnotationControls({ container: selectionRoot, controller,
  onSelect: annotation => selectedEvents.push(annotation?.id ?? null),
  onHover: annotation => hoveredEvents.push(annotation?.id ?? null) });
const selectionList = selectionRoot.querySelector(".pdf-annotations-list");
const selectionButtons = () => walk(selectionList).filter(node => node.className === "pdf-annotation-select");
const selectionBoxes = () => walk(selectionList).filter(node => node.tagName === "input");
const selectionFilter = selectionRoot.querySelector(".pdf-annotations-filter input");
const clearSelection = selectionRoot.querySelector(".pdf-annotations-clear");
const firstButton = selectionButtons()[0];
firstButton.dispatchEvent(new Event("click"));
assert.deepEqual(selectedEvents, ["row:0"]); assert.equal(selectable.getSelection(), "row:0");
assert.equal(firstButton.getAttribute("aria-pressed"), "true"); assert.equal(clearSelection.disabled, false);
assert.equal(selectionBoxes()[0].checked, true, "row selection preserves visibility");
firstButton.dispatchEvent(new Event("pointerenter")); assert.equal(hoveredEvents.at(-1), "row:0");
firstButton.dispatchEvent(new Event("pointerleave")); assert.equal(hoveredEvents.at(-1), null);
toggle(selectionBoxes()[0], false);
assert.equal(selectable.getSelection(), "row:0", "visibility changes preserve selection");
selectionFilter.value = "row:0"; selectionFilter.dispatchEvent(new Event("input"));
selectable.selectAnnotation("row:501", { reveal: true });
assert.equal(selectionFilter.value, ""); assert.equal(selectionRoot.querySelector(".pdf-annotations").open, true);
assert.equal(selectionButtons().length, 500, "revealing a far row keeps the bounded list");
const revealed = selectionButtons().find(button => button.getAttribute("aria-pressed") === "true");
assert(revealed.title.includes("row:501")); assert.equal(revealed.scrolled, true);
assert.deepEqual(selectedEvents, ["row:0"], "canvas synchronization never calls onSelect recursively");
selectable.sceneChanged(); assert.equal(selectable.getSelection(), "row:501", "same-scene replacement preserves the selected row");
clearSelection.dispatchEvent(new Event("click")); assert.equal(selectable.getSelection(), null);
assert.equal(selectedEvents.at(-1), null); assert.equal(clearSelection.disabled, true);
scene = { annotations: [annotation("repeat", "Square"), annotation("repeat", "Square", { pageIndex: 1 })] };
selectable.sceneChanged();
toggle(selectionBoxes()[0], false); assert(selectionBoxes().every(box => !box.checked), "repeated IDs synchronize visibility");
selectionButtons()[0].dispatchEvent(new Event("click"));
assert(selectionButtons().every(button => button.getAttribute("aria-pressed") === "true"));
scene = { annotations: [] }; selectable.sceneChanged(); assert.equal(selectable.getSelection(), null);
selectable.dispose();

// The native example passes its real layer-visibility controller.
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createLayerVisibilityController } = await import("../src/layerVisibility.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const native = createEmptyVectorScene();
  native.optionalContent = { groups: [{ id: "annotation:ref:9:0", name: "Annotation ref:9:0", defaultVisible: true, locked: true,
    usedInView: false, annotationId: "ref:9:0" }], conditions: [], order: [], radioGroups: [] };
  native.annotations = [annotation("ref:9:0", "Square"), annotation("ref:10:0", "Link")];
  const visibility = createLayerVisibilityController({ getScene: () => native, getRenderer: () => ({}) });
  visibility.sceneChanged();
  const root = new Element();
  const panel = createPdfAnnotationControls({ container: root, controller: {
    getScene: () => native,
    getAnnotationLayers: () => visibility.getAnnotationLayers(),
    setAnnotationVisibility: (ids, visible) => visibility.setAnnotationVisibility(ids, visible)
  } });
  const nativeBoxes = () => walk(root.querySelector(".pdf-annotations-list")).filter(node => node.tagName === "input");
  toggle(root.querySelector(".pdf-annotations-all input"), false); await tick();
  assert.deepEqual(visibility.getAnnotationLayers(), [{ annotationId: "ref:9:0", visible: false }]);
  assert.equal(root.querySelector(".pdf-annotations-status").textContent, "");
  assert.equal(panel.isAnnotationEnabled("ref:10:0"), false);
  toggle(nativeBoxes()[0], true); await tick();
  assert.deepEqual(visibility.getAnnotationLayers(), [{ annotationId: "ref:9:0", visible: true }]);
  panel.dispose(); visibility.dispose();
} finally { hooks.deregister(); }

console.log("PDF annotation controls: listing, literal labels, enabled toggles, filter-scoped All, failures, renderer replacement, new documents, row limit and lifecycle passed.");
