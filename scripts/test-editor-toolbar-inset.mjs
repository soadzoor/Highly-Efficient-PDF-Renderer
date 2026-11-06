import assert from "node:assert/strict";
import { createEditorToolbarInset } from "../src/editorToolbarInset.ts";

const previous = globalThis.ResizeObserver, observers = [];
globalThis.ResizeObserver = class {
  constructor(callback) { this.callback = callback; observers.push(this); }
  observe(element) { this.element = element; }
  disconnect() { this.disconnected = true; }
};
try {
  const values = new Map(), writes = [];
  const document = { documentElement: { style: {
    getPropertyValue: name => values.get(name) ?? "",
    setProperty(name, value) { values.set(name, value); writes.push(value); },
    removeProperty: name => values.delete(name)
  } } };
  const toolbar = { ownerDocument: document, hidden: true, height: 120, getBoundingClientRect() { return { height: this.height }; } };
  const inset = createEditorToolbarInset(toolbar), property = "--hepr-editor-toolbar-inset";
  inset.update(false); assert.equal(values.has(property), false);
  toolbar.hidden = false; inset.update(true); assert.equal(values.get(property), "136px");
  observers[0].callback(); assert.equal(writes.length, 1, "unchanged measurements do not create resize feedback");
  toolbar.height = 220; observers[0].callback(); assert.equal(values.get(property), "236px", "wrapped toolbar reserves its new height");
  toolbar.hidden = true; inset.update(false); assert.equal(values.has(property), false);
  toolbar.hidden = false; inset.update(true);
  const replacement = { ...toolbar, height: 80 }, next = createEditorToolbarInset(replacement);
  next.update(true); assert.equal(values.get(property), "96px");
  inset.update(false); assert.equal(values.get(property), "96px", "old editor hiding cannot clear the replacement's reservation");
  inset.dispose(); observers[0].callback(); assert.equal(values.get(property), "96px");
  assert(observers[0].disconnected);
  next.dispose(); assert.equal(values.has(property), false); assert(observers[1].disconnected);
  next.update(true); observers[1].callback(); assert.equal(values.has(property), false, "late callbacks cannot recreate disposed spacing");
  console.log("Editor toolbar inset: measured wrapping, stable updates, mode cleanup and replacement ownership passed.");
} finally { globalThis.ResizeObserver = previous; }
