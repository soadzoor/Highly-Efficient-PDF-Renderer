import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createEditorSetupLoading } from "../src/editorSetupLoading.ts";

class Element {
  constructor(tagName, ownerDocument) { this.tagName = tagName; this.ownerDocument = ownerDocument; this.children = []; this.attributes = new Map(); this.style = {}; this.textContent = ""; }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  remove() { if (this.parentElement) { const children = this.parentElement.children; children.splice(children.indexOf(this), 1); this.parentElement = null; } }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.get(name); }
  hasAttribute(name) { return this.attributes.has(name); }
  set value(value) { this.setAttribute("value", String(value)); }
  get value() { return Number(this.getAttribute("value") ?? 0); }
}
const listeners = new Map(), observers = [];
let allocations = 0, canvasReads = 0;
const window = {
  addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
  removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
  ResizeObserver: class {
    constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); this.disconnected = true; }
  }
};
const document = { defaultView: window, createElement(tag) { allocations++; return new Element(tag, document); } };
document.body = new Element("body", document);
let rect = { left: 72, top: 108, width: 800, height: 600 }, geometryReads = 0;
const firstCanvas = { ownerDocument: document, getBoundingClientRect: () => { geometryReads++; return rect; } };
let canvas = firstCanvas;
const loading = createEditorSetupLoading(() => { canvasReads++; return canvas; });
assert.equal(allocations, 0); assert.equal(canvasReads, 0);
assert.equal(listeners.size, 0); assert.equal(observers.length, 0, "View does not create indicator DOM or observers");

const first = loading.begin(), overlay = document.body.children[0], card = overlay.children[0];
const [heading, detail, bar] = card.children, [label, percentage] = detail.children;
assert.equal(heading.children[1].textContent, "Loading Edit mode");
assert.equal(card.getAttribute("role"), "status"); assert.equal(card.getAttribute("aria-live"), "polite");
assert.equal(label.textContent, "Loading editing tools…"); assert.equal(bar.getAttribute("value"), undefined);
assert.deepEqual(overlay.style, { left: "72px", top: "108px", width: "800px", height: "600px" }, "indicator is bounded by the document canvas");
assert(observers[0].targets.has(firstCanvas));
first.report({ stage: "document", value: .425 });
assert.equal(bar.value, .425); assert.equal(percentage.textContent, "43%");
assert.equal(bar.getAttribute("aria-label"), "Preparing full-quality pages…");
assert.equal(bar.getAttribute("aria-valuetext"), "Preparing full-quality pages… 43%");
first.report({ stage: "document", value: 4 }); assert.equal(bar.value, 1);
first.report({ stage: "fields" });
assert.equal(label.textContent, "Preparing form fields and fonts…"); assert.equal(percentage.textContent, "");
assert.equal(bar.getAttribute("value"), undefined); assert.equal(bar.getAttribute("aria-valuetext"), undefined,
  "an unmeasured stage resets the previous stage's completed percentage");
first.report({ stage: "fields", value: .5 }); assert.equal(percentage.textContent, "50%");
first.report({ stage: "session", value: NaN }); assert.equal(bar.getAttribute("value"), undefined);
first.report({ stage: "display" }); assert.equal(label.textContent, "Drawing the editable document…");
assert.equal(geometryReads, 1, "progress reports do not force repeated canvas layout reads");

rect = { left: 0, top: 48, width: 360, height: 300 };
observers[0].callback(); assert.equal(overlay.style.top, "48px"); assert.equal(overlay.style.width, "360px");
const replacement = { ownerDocument: document, getBoundingClientRect: () => ({ left: 0, top: 48, width: 400, height: 320 }) };
canvas = replacement; first.report({ stage: "display" });
assert(!observers[0].targets.has(firstCanvas)); assert(observers[0].targets.has(replacement), "a replaced canvas becomes the layout target");
assert.equal(overlay.style.width, "400px");

const second = loading.begin({ stage: "document", value: 0 });
assert.equal(document.body.children.length, 1, "starting another operation removes the previous indicator");
assert(observers[0].disconnected);
const currentOverlay = document.body.children[0], currentCard = currentOverlay.children[0];
first.finish(); first.report({ stage: "fields", value: 1 }); observers[0].callback();
assert.equal(document.body.children[0], currentOverlay, "late cleanup cannot hide a newer operation");
assert.equal(currentCard.children[1].children[0].textContent, "Preparing full-quality pages…", "stale reports cannot overwrite newer progress");
for (const type of ["resize", "scroll"]) assert.equal(listeners.get(type).size, 1);
second.finish(); second.finish();
assert.equal(document.body.children.length, 0); assert(observers[1].disconnected);
for (const type of ["resize", "scroll"]) assert.equal(listeners.get(type).size, 0, "finished setup leaves no layout listeners");
second.report({ stage: "session", value: 1 }); observers[1].callback(); assert.equal(document.body.children.length, 0);

const css = await readFile(new URL("../src/editorSetupLoading.css", import.meta.url), "utf8");
assert.match(css, /position:\s*fixed/); assert.match(css, /overflow:\s*hidden/);
assert.match(css, /prefers-reduced-motion:\s*reduce/); assert.match(css, /animation:\s*none/);
console.log("Editor setup indicator: lazy DOM, measured/indeterminate stages, canvas bounds, stale operations and cleanup passed.");
