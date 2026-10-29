import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });
class Element extends EventTarget {
  dataset = {}; attributes = new Map(); open = false; removed = false;
  setAttribute(name, value) { this.attributes.set(name, value); }
  set innerHTML(value) {
    this.html = value;
    this.buttons = [...value.matchAll(/data-export-choice="([^"]+)"/g)].map(([, choice]) => ({
      dataset: { exportChoice: choice }, closest: () => ({ dataset: { exportChoice: choice } })
    }));
  }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event("close")); }
  remove() { this.removed = true; }
  choose(choice) {
    const event = new Event("click"), target = this.buttons.find(button => button.dataset.exportChoice === choice);
    assert(target); Object.defineProperty(event, "target", { value: target }); this.dispatchEvent(event);
  }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function documentHost() {
  const dialogs = [], focus = [];
  return { dialogs, focus, activeElement: { isConnected: true, focus: options => focus.push(options) },
    body: { append: element => dialogs.push(element) }, createElement: tag => { assert.equal(tag, "dialog"); return new Element(); } };
}
try {
  const { chooseEditorPdfFormExport } = await import("../src/editorPdfFormExportUi.ts");
  const { findEditorPdfFormOverlaps } = await import("../src/editorPdfFormOverlap.ts");
  const { LoadProgressReporter } = await import("../src/loadProgress.ts");
  for (const action of ["pdf", "flatten", "cancel", "escape", "close", "abort"]) {
    const document = documentHost(), abort = new AbortController(), pending = chooseEditorPdfFormExport(document, abort.signal);
    const dialog = document.dialogs[0]; assert(dialog.open);
    if (action === "escape") dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    else if (action === "close") dialog.close();
    else if (action === "abort") abort.abort();
    else dialog.choose(action);
    assert.equal(await pending, ["pdf", "flatten"].includes(action) ? action : null);
    assert(dialog.removed && !dialog.open); assert.equal(document.focus.length, 1);
    abort.abort(); dialog.close(); assert.equal(document.focus.length, 1, "cleanup and focus restoration happen only once");
  }
  const beforeAborted = documentHost();
  assert.equal(await chooseEditorPdfFormExport(beforeAborted, AbortSignal.abort()), null);
  assert.equal(beforeAborted.dialogs.length, 0, "cancelled exports do not open a modal");
  const layerDocument = documentHost(), layerChoice = chooseEditorPdfFormExport(layerDocument, undefined, { layerStacking: true });
  assert.match(layerDocument.dialogs[0].html, /drawing order|Object or layer order has changed/i);
  layerDocument.dialogs[0].choose("flatten"); assert.equal(await layerChoice, "flatten");

  const source = await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8");
  function harness({ sourcePdf = true, overlap = true } = {}) {
    const document = documentHost(), saves = [], downloads = [], statuses = [], busy = [], errors = [], marked = [];
    let revision = 7, sceneReads = 0;
    const scene = { pageCount: 1, pageRects: [0, 0, 200, 100], annotations: overlap ? [{ id: "widget", subtype: "Widget", pageIndex: 0,
      annotationIndex: 0, flags: 0, visibleInDefaultView: true, bounds: { minX: 20, minY: 20, maxX: 60, maxY: 60 }, field: { name: "Name" } }] : [] };
    const session = { sourcePdf: sourcePdf ? Uint8Array.of(1) : undefined, sourceScene: scene,
      getState: () => ({ revision, previewing: false }), async getScene() { sceneReads++; return scene; },
      getObjects: () => [{ id: "ink", kind: "ink", pageIndex: 0, paths: [[[10, 40], [80, 40]]], opacity: .5 }],
      getObjectBounds: () => ({ minX: 10, minY: 38, maxX: 80, maxY: 42 }),
      async savePdf(options) { saves.push(options); return new Blob(["PDF"], { type: "application/pdf" }); } };
    const protection = { mode: "password", password: "opening password" }, cancel = { hidden: true };
    const context = vm.createContext({ session, document, LoadProgressReporter, findEditorPdfFormOverlaps, chooseEditorPdfFormExport,
      structuralRunning: false, running: false, activeText: null, passwordDialog: null, fieldDrafts: new Map(), operation: null,
      flushEditorFieldDrafts() {}, hasPendingEditorFields: () => false, finishText: async () => {}, cancelPointerGesture() {}, updatePointerCursor() {},
      pdfProtection: { get: () => protection, markSaved: value => marked.push(value) }, hasUnsavedChanges: () => true,
      AbortController, query: () => cancel, setStatus: value => statuses.push(value), host: { onBusyChange: value => busy.push(value) },
      report: error => errors.push(error), source: { label: "form.pdf" }, formatPdfDownloadFilename: value => value,
      triggerBrowserDownload: (blob, name) => downloads.push({ blob, name }) });
    vm.runInContext(sourceFunction(source.replace(/^ {2}/gm, ""), "save"), context);
    return { context, session, document, saves, downloads, statuses, busy, errors, marked, cancel, protection,
      revise: () => revision++, get sceneReads() { return sceneReads; } };
  }
  for (const choice of ["pdf", "flatten", "cancel", "abort"]) {
    const h = harness(), pending = h.context.save("pdf"); await tick();
    assert.equal(h.document.dialogs.length, 1); assert.equal(h.saves.length, 0, "the user decides before serializing the PDF");
    assert(h.context.running); assert.equal(h.sceneReads, 1);
    if (choice === "abort") h.context.operation.abort(); else h.document.dialogs[0].choose(choice);
    await pending;
    const saved = choice === "pdf" || choice === "flatten";
    assert.equal(h.saves.length, saved ? 1 : 0); assert.equal(h.downloads.length, saved ? 1 : 0);
    assert.equal(h.marked.length, saved ? 1 : 0, "cancel does not mark output protection saved");
    if (saved) {
      assert.equal(h.saves[0].flatten, choice === "flatten"); assert.equal(h.saves[0].protection, h.protection);
      assert.equal(h.downloads[0].name, choice === "flatten" ? "form-flattened.pdf" : "form-edited.pdf");
    } else assert(h.statuses.includes("PDF export cancelled"));
    assert.deepEqual(h.errors, []); assert.deepEqual(h.busy, [true, false]); assert(!h.context.running && h.cancel.hidden);
  }
  for (const [options, kind] of [[{ overlap: false }, "pdf"], [{ sourcePdf: false }, "pdf"], [{}, "flatten"]]) {
    const h = harness(options); await h.context.save(kind);
    assert.equal(h.document.dialogs.length, 0, "ordinary, HEP-origin and explicit flattened exports skip the choice");
    assert.equal(h.saves.length, 1); assert.equal(h.saves[0].flatten, kind === "flatten"); assert.deepEqual(h.errors, []);
  }
  for (const change of [h => h.revise(), h => { h.session.sourceScene = { ...h.session.sourceScene }; }]) {
    const h = harness(), pending = h.context.save("pdf"); await tick(); change(h); h.document.dialogs[0].choose("flatten"); await pending;
    assert.equal(h.saves.length, 0); assert.equal(h.downloads.length, 0);
    assert.match(h.errors[0].message, /document changed/i, "a stale export choice cannot serialize a different document");
    assert(!h.context.running && h.cancel.hidden);
  }
  console.log("PDF form export choice: explicit formats, overlap-only prompting, cancellation, protection, filenames and stale-document guards passed.");
} finally { hooks.deregister(); }
