import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { installSelectionTestHost } from "./lib/selectionTestHost.mjs";
const hooks = registerHooks({ resolve(s, c, n) { return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c); } });
const host = installSelectionTestHost();
try {
  const { createEditorReviewController, isEditorReviewTool } = await import("../src/editorReviewUi.ts");
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const doc = globalThis.document;
  class Node extends globalThis.HTMLElement {
    children = []; attributes = new Map(); listeners = new Map(); value = ""; ownerDocument = doc;
    constructor(tag = "div") { super(); this.tagName = tag.toUpperCase(); }
    append(...nodes) { for (const node of nodes) { this.children.push(node); node.parentElement = this; } }
    appendChild(node) { this.append(node); }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    addEventListener(name, handler) { const set = this.listeners.get(name) ?? new Set(); set.add(handler); this.listeners.set(name, set); }
    emit(name, props = {}) { const event = { target: this, preventDefault() {}, stopPropagation() {}, ...props }; for (const handler of this.listeners.get(name) ?? []) handler(event); }
    querySelector(selector) { const match = /^\[role="(.+)"\]$/.exec(selector); return this.find(node => match && node.attributes.get("role") === match[1]); }
    find(predicate) { return predicate(this) ? this : this.children.map(child => child.find?.(predicate)).find(Boolean); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
    showModal() { this.open = true; }
    close() { this.open = false; }
    focus() { doc.activeElement = this; }
    contains(node) { return node === this || this.children.some(child => child.contains?.(node)); }
  }
  doc.createElement = tag => new Node(tag); doc.createTextNode = text => Object.assign(new Node(), { textContent: text }); doc.body = new Node("body");
  const overlay = host.canvas; overlay.ownerDocument = doc;
  const localEvents = new Map(); overlay.addEventListener = (name, handler) => localEvents.set(name, handler);
  const scene = buildStrokeScene([{ points: [[0, 0], [100, 100]], width: 1 }]); scene.pageRects = Float32Array.of(0, 0, 100, 100);
  scene.textInstanceCount = 4; scene.textGlyphCount = 4;
  scene.textIndex = { version: 2, pages: [{ text: "ABCD", charInstance: Int32Array.of(0, 1, 2, 3) }] };
  scene.textInstanceA = Float32Array.from(Array.from({ length: 4 }, () => [1, 0, 0, 1]).flat());
  scene.textInstanceB = Float32Array.from(Array.from({ length: 4 }, (_, i) => [10 + i * 10, 5, i, 0]).flat());
  scene.textGlyphMetaA = Float32Array.from(Array.from({ length: 4 }, () => [0, 0, 0, 0]).flat());
  scene.textGlyphMetaB = Float32Array.from(Array.from({ length: 4 }, () => [8, 10, 0, 0]).flat());
  const session = createEditorSession(scene), errors = []; let drafts = 0, failed = false, latestScene = scene, selectionChanges = 0;
  const ui = createEditorReviewController({ overlay, session, getScene: () => latestScene, canEdit: () => true,
    toScene: (x, y) => ({ x, y }), toClient: (x, y) => ({ x, y }), style: () => ({ color: "#ffdf00", opacity: .3 }),
    change(fn) { if (failed) throw new Error("Injected failure"); fn(); }, added() {}, onError: error => errors.push(error), onDraftChange: () => drafts++, onSelectionChange: () => selectionChanges++ });
  try {
    ui.setActive(true); ui.setTool("select-text"); assert(host.listenerCount > 0);
    const beforeSelect = session.revision;
    host.pointer("pointerdown", 11, 10); host.pointer("pointermove", 48, 10); host.pointer("pointerup", 48, 10);
    assert.equal(session.revision, beforeSelect, "selecting text never applies a style or creates history");
    assert.equal(ui.getTextSelection().text, "ABCD"); assert(ui.preview()); assert(selectionChanges > 0);
    latestScene = { ...scene }; ui.updateOverlay();
    assert.equal(ui.getTextSelection().scene, scene, "formatting redraws retain the selected glyph provenance");
    assert.equal(isEditorReviewTool("highlight"), false, "highlight is a formatting action, never a persistent selection tool");
    host.advanceTime(500); host.pointer("pointerdown", 11, 10); host.pointer("pointermove", 48, 10); host.pointer("pointerup", 48, 10);
    assert.equal(ui.getTextSelection().scene, latestScene, "a fresh selection uses the new document scene");
    const layer = session.createLayer({ name: "Other layer" });
    ui.updateOverlay(); assert.equal(ui.getTextSelection(), null, "layer changes invalidate frozen selection context");
    host.advanceTime(500); host.pointer("pointerdown", 11, 10); host.pointer("pointermove", 48, 10); host.pointer("pointerup", 48, 10);
    assert(ui.getTextSelection()); session.updateLayer(layer, { defaultVisible: false }); ui.updateOverlay();
    assert.equal(ui.getTextSelection(), null, "hidden-layer geometry cannot remain a formatting target");
    const countBeforeSelect = session.getObjects().length;
    host.pointer("pointerdown", 11, 10); host.pointer("pointermove", 48, 10); host.pointer("pointerup", 48, 10);
    assert.equal(session.getObjects().length, countBeforeSelect, "new text selection never creates highlight markup");
    assert.equal(ui.getTextSelection().text, "ABCD"); assert(ui.preview(), "selection remains active for formatting actions");
    const countBeforeCancel = session.getObjects().length;
    host.pointer("pointerdown", 11, 10); host.pointer("pointermove", 48, 10); ui.cancelGesture(); host.pointer("pointerup", 48, 10);
    assert.equal(session.getObjects().length, countBeforeCancel, "camera/gesture cancellation cannot commit a pending text review");
    ui.setTool("comment"); assert.equal(host.listenerCount, 0, "review selection listeners detach outside text-review tools");
    localEvents.get("pointerdown")({ button: 0, clientX: 60, clientY: 60, preventDefault() {}, stopPropagation() {} });
    let dialog = doc.body.children.at(-1), contents = dialog.find(node => node.tagName === "TEXTAREA"); contents.value = "A note"; contents.emit("input");
    assert(ui.hasDraftChanges()); assert.equal(ui.getDraft().contents, "A note");
    failed = true; assert.equal(ui.flushDraft(), false); assert(dialog.open && ui.hasDraftChanges(), "failed commit keeps the draft open");
    failed = false; assert(ui.flushDraft()); assert.equal(ui.getDraft(), null);
    const note = session.getObjects().find(object => object.review?.type === "comment"); assert(note); session.select([note.id]); assert(ui.editSelection());
    dialog = doc.body.children.at(-1); contents = dialog.find(node => node.tagName === "TEXTAREA"); contents.value = "Changed note"; contents.emit("input"); assert(ui.flushDraft());
    assert.equal(session.getObject(note.id).review.contents, "Changed note");
    const count = drafts; ui.setActive(false); ui.setActive(false); assert.equal(drafts, count, "idle mode switches do not schedule recovery work");
    assert.equal(host.listenerCount, 0); assert.equal(errors.length, 1);
    console.log("Editor review UI: action-only selection, listener cleanup, comment drafts, failure preservation and edit/apply passed.");
  } finally { ui.dispose(); session.dispose(); }
} finally { host.close(); hooks.deregister(); }
