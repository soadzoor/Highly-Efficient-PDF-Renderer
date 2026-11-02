import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(specifier, context, next) { return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context); } });
class Element extends EventTarget {
  childNodes = []; attributes = new Map(); value = ""; checked = false; disabled = false; hidden = false;
  constructor(tagName, ownerDocument) { super(); this.tagName = tagName; this.ownerDocument = ownerDocument; }
  append(...children) { this.childNodes.push(...children); for (const child of children) if (child && typeof child === "object") child.parentElement = this; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  querySelectorAll(selector) { const names = selector.split(",").map(name => name.trim()); return this.childNodes.flatMap(child => typeof child === "object" ? [...(names.includes(child.tagName) ? [child] : []), ...child.querySelectorAll(selector)] : []); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  remove() { if (this.parentElement) this.parentElement.childNodes = this.parentElement.childNodes.filter(child => child !== this); }
  focus() { this.ownerDocument.activeElement = this; }
}
const makeDocument = () => { const document = { createElement: name => new Element(name, document) }; document.body = document.createElement("body"); return document; };
const find = (root, test) => test(root) ? root : root.childNodes.filter(child => typeof child === "object").map(child => find(child, test)).find(Boolean);
const dispatch = (node, type) => node.dispatchEvent(new Event(type, { cancelable: true }));
const settle = async () => { for (let index = 0; index < 5; index++) await new Promise(resolve => setImmediate(resolve)); };
try {
  const { createPdfPageSizeControls, showNewPdfDialog, readCreatedDocumentRecovery } = await import("../src/newPdfUi.ts");
  const document = makeDocument(), paper = createPdfPageSizeControls(document);
  assert.deepEqual(paper.read(), { pageSize: "A4", orientation: "portrait" });
  const control = label => find(paper.element, item => item.attributes.get("aria-label") === label);
  const preset = control("Paper size"), width = control("Page width"), height = control("Page height"), unit = control("Page dimension unit"), orientation = control("Paper orientation");
  preset.value = "Custom"; dispatch(preset, "change"); width.value = "210"; height.value = "297";
  assert(Math.abs(paper.read().pageSize.width - 210 * 72 / 25.4) < 1e-8);
  unit.value = "in"; dispatch(unit, "change"); assert(Math.abs(Number(width.value) - 210 / 25.4) < 1e-8);
  unit.value = "pt"; dispatch(unit, "change"); assert(Math.abs(Number(height.value) - 297 * 72 / 25.4) < 1e-8);
  width.value = ""; assert.throws(() => paper.read(), /positive/);
  paper.setValue({ pageSize: "Letter", orientation: "landscape" }); assert.deepEqual(paper.read(), { pageSize: "Letter", orientation: "landscape" }); assert.equal(orientation.value, "landscape");

  const calls = [], errors = [];
  const handle = showNewPdfDialog(document, { create: async request => { calls.push(request); return false; }, onError: error => errors.push(error) });
  const dialog = document.body.childNodes[0], name = find(dialog, item => item.attributes.get("aria-label") === "Document name"), count = find(dialog, item => item.attributes.get("aria-label") === "Initial page count");
  const button = text => find(dialog, item => item.tagName === "button" && item.textContent === text);
  count.value = "1.5"; dispatch(button("Create PDF"), "click"); await settle(); assert.equal(errors.length, 1); assert.equal(calls.length, 0);
  count.value = "3"; name.value = " My document.pdf "; dispatch(button("Create PDF"), "click"); await settle();
  assert.deepEqual(calls[0], { pageSize: "A4", orientation: "portrait", title: "My document", pageCount: 3, pageNumbering: { enabled: false } }); assert(dialog.open);
  handle.close(); assert(!dialog.open);

  let signal, release;
  const cancelDocument = makeDocument();
  showNewPdfDialog(cancelDocument, { create: async (_request, value) => { signal = value; await new Promise(resolve => { release = resolve; }); return false; } });
  const pending = cancelDocument.body.childNodes[0]; dispatch(find(pending, item => item.textContent === "Create PDF"), "click"); await settle();
  const cancel = find(pending, item => item.tagName === "button" && item.textContent === "Cancel creation"); assert(!cancel.disabled); dispatch(cancel, "click"); assert(signal.aborted); release(); await settle(); assert(pending.open); dispatch(find(pending, item => item.tagName === "button" && item.textContent === "Cancel"), "click"); assert(!pending.open);
  const resumeDocument = makeDocument(), entries = [{ key: "new", label: "New", updatedAt: 1, createdDocument: true, protected: false }, { key: "source", label: "Source", updatedAt: 1, protected: false }, { key: "protected", label: "Secret", updatedAt: 1, createdDocument: true, protected: true }], resumed = [];
  showNewPdfDialog(resumeDocument, { create: async () => false, listDrafts: async () => entries, resume: async entry => { resumed.push(entry.key); return true; } }); await settle();
  const resumeDialog = resumeDocument.body.childNodes[0], resume = find(resumeDialog, item => item.tagName === "button" && item.textContent === "Resume draft");
  assert(resume); assert.equal(resumeDialog.querySelectorAll("button").filter(item => item.textContent === "Resume draft").length, 1); dispatch(resume, "click"); await settle(); assert.deepEqual(resumed, ["new"]); assert(!resumeDialog.open);
  const previousIndexedDb = globalThis.indexedDB;
  const records = new Map();
  globalThis.indexedDB = { open() { const request = {}; queueMicrotask(() => {
    request.result = { close() {}, transaction() { const tx = { objectStore() { return { get(key) { const result = {}; queueMicrotask(() => { result.result = records.get(key); result.onsuccess?.(); queueMicrotask(() => tx.oncomplete?.()); }); return result; } }; } }; return tx; } };
    request.onsuccess?.();
  }); return request; } };
  try {
    const { createBlankPdfScene } = await import("../src/pdfCreation.ts"), { openEditorSession } = await import("../src/editorSession.ts"), { createEditorRecoveryCodec } = await import("../src/editorRecoveryCodec.ts");
    const editor = await openEditorSession(createBlankPdfScene()); let snapshot, object;
    try { object = editor.addObject({ kind: "shape", shape: "rectangle", pageIndex: 0, x: 10, y: 20, width: 30, height: 40 }); await editor.rotatePages([0], 90); snapshot = await editor.captureRecovery(); }
    finally { editor.dispose(); }
    assert(snapshot.sourcePdf, "structural edits retain replacement PDF bytes in the checkpoint");
    const codec = createEditorRecoveryCodec({});
    records.set("original-key", { key: "original-key", label: "New", createdDocument: true, protected: false, envelope: await codec.encode(snapshot, { text: null }) });
    const loaded = await readCreatedDocumentRecovery("original-key"); assert.equal(loaded.record.key, "original-key"); assert.equal(loaded.snapshot.sourcePdf.length, snapshot.sourcePdf.length);
    const invalid = structuredClone(snapshot); invalid.data.state.objects.get(object).width = -10;
    records.set("invalid", { key: "invalid", label: "Invalid", createdDocument: true, protected: false, envelope: await codec.encode(invalid) });
    await assert.rejects(readCreatedDocumentRecovery("invalid"), /width/i); assert(records.has("original-key"), "failed resume preflight keeps all existing draft records");
    records.set("source", { key: "source", protected: false }); await assert.rejects(readCreatedDocumentRecovery("source"), /unavailable/);
    const aborted = new AbortController(); aborted.abort(); await assert.rejects(readCreatedDocumentRecovery("original-key", aborted.signal), { name: "AbortError" });
  } finally { if (previousIndexedDb === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = previousIndexedDb; }
  console.log("New PDF controls: presets/custom units, cancellation, created-draft resume, original recovery keys and invalid-checkpoint preflight passed.");
} finally { hooks.deregister(); }
