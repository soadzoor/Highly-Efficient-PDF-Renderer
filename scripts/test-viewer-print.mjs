import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";

const fixtureKey = "__heprViewerPrintFixture";
const helperUrl = `data:text/javascript,${encodeURIComponent(`export const preparePrintPdf=(...args)=>globalThis.${fixtureKey}.prepare(...args);export const printPdfBlob=(...args)=>globalThis.${fixtureKey}.print(...args);`)}`;
let helperLoads = 0;
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith("/src/viewerPrint.ts") && specifier === "./pdfPrint") {
    helperLoads++; return { url: helperUrl, shortCircuit: true };
  }
  assert(!/editor(?:Ui|Session|AppServices)(?:\.ts)?$/.test(specifier), "View printing cannot initialize or import the editor runtime");
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
class Button extends EventTarget {
  disabled = false; textContent = ""; attributes = new Map();
  setAttribute(name, value) { this.attributes.set(name, value); }
}
try {
  const { createViewerPrintAction } = await import("../src/viewerPrint.ts");
  const preparations = [], printed = [], blob = new Blob(["synthetic PDF"], { type: "application/pdf" });
  const fixture = globalThis[fixtureKey] = { async prepare(input, options) { preparations.push({ input, options }); return blob; }, print(...args) { printed.push(args); } };
  const create = source => {
    const button = new Button(), document = { name: "print owner document" }, statuses = [];
    const state = { source, busy: false };
    const action = createViewerPrintAction({ button, document, getDocument: () => state.source, isBusy: () => state.busy, setStatus: value => statuses.push(value) });
    return { action, button, document, statuses, state };
  };
  const empty = create(null); assert.equal(empty.button.disabled, true); assert.equal(helperLoads, 0, "creating a View print action keeps PDF preparation lazy");
  await empty.action.print(); assert.match(empty.statuses.at(-1), /Open a PDF or HEP/); assert.equal(preparations.length, 0);

  const editorCalls = [], dirty = { value: true }, editing = create({ identity: {}, label: "edited.pdf" });
  editing.state.source.editor = { async save(kind) { editorCalls.push(kind); if (kind !== "print") dirty.value = false; editing.statuses.push("Editor reports its own print failure"); }, markSaved() { assert.fail("printing cannot mark edits saved"); } };
  await editing.action.print(); assert.deepEqual(editorCalls, ["print"]); assert.equal(dirty.value, true);
  assert.equal(editing.statuses.at(-1), "Editor reports its own print failure", "controller cannot replace an editor failure with a success message");
  assert.equal(helperLoads, 0, "the editor print route does not load another preparation path");

  fixture.prepare = async (input, options) => { preparations.push({ input, options }); options.onProgress({ value: .42, stage: "compile" });
    options.onWarning("Actual print preparation warning"); options.onWarning("Actual print preparation warning"); return blob; };
  const sourcePdf = { label: "report.pdf", bytes: Uint8Array.of(1, 2, 3) }, scene = { name: "visible scene" };
  const pdf = create({ identity: {}, label: "report.pdf", sourcePdf, password: "synthetic unlock", pages: "1,3", scene });
  await pdf.action.print(); assert(helperLoads > 0); assert.equal(preparations.length, 1);
  assert.deepEqual(preparations[0].input, { sourcePdf, password: "synthetic unlock", pages: "1,3", scene });
  assert.equal(preparations[0].options.signal.aborted, false); assert(pdf.statuses.includes("Preparing print… 42%"));
  assert.equal(pdf.statuses.at(-1), "Print-ready PDF opened. Actual print preparation warning");
  assert.equal(printed[0][0], blob); assert.equal(printed[0][1], pdf.document); assert.deepEqual(printed[0][2], { filename: "report-print.pdf", title: "Print PDF" });
  assert.equal(pdf.button.disabled, false); assert.equal(pdf.button.textContent, "Print"); assert.equal(pdf.button.attributes.get("aria-busy"), "false");

  fixture.prepare = async (input, options) => { preparations.push({ input, options }); return blob; };
  const hep = create({ identity: {}, label: "drawing.hep", scene });
  hep.button.dispatchEvent(new Event("click")); await tick();
  assert.equal(preparations.at(-1).input.scene, scene); assert.equal(preparations.at(-1).input.sourcePdf, undefined);
  assert.equal(printed.at(-1)[2].filename, "drawing-print.pdf", "HEP scenes use the shared vector preparation route without entering Edit");
  hep.state.busy = true; hep.action.refresh(); assert.equal(hep.button.disabled, true);
  const preparesBeforeBusy = preparations.length; await hep.action.print(); assert.equal(preparations.length, preparesBeforeBusy);
  hep.state.busy = false; hep.action.refresh(); assert.equal(hep.button.disabled, false);

  const pending = [];
  fixture.prepare = (input, options) => { const task = deferred(); pending.push({ ...task, input, options }); return task.promise; };
  const changing = create({ identity: {}, label: "old.pdf", sourcePdf });
  const stale = changing.action.print(); await tick();
  assert.equal(changing.button.disabled, true); assert.equal(changing.button.textContent, "Preparing print…");
  await changing.action.print(); assert.equal(pending.length, 1, "one controller preparation owns the action at a time");
  changing.state.source = { identity: {}, label: "new.pdf", sourcePdf };
  const printsBeforeStale = printed.length, statusesBeforeStale = changing.statuses.length;
  pending[0].options.onProgress({ value: .9, stage: "compile" }); pending[0].options.onWarning("Stale warning");
  assert.equal(changing.statuses.length, statusesBeforeStale, "old document progress cannot overwrite the new document's status");
  pending[0].resolve(blob); await stale; assert.equal(printed.length, printsBeforeStale, "a changed document identity prevents stale printing even without cancellation");
  assert.equal(changing.button.disabled, false);

  const canceled = changing.action.print(); await tick(); changing.action.cancel();
  assert.equal(pending[1].options.signal.aborted, true); assert.equal(changing.button.disabled, false);
  const replacement = changing.action.print(); await tick(); assert.equal(pending.length, 3);
  pending[1].resolve(blob); await canceled; assert.equal(changing.button.disabled, true, "an older canceled completion cannot clear a newer print job");
  pending[2].resolve(blob); await replacement; assert.equal(printed.length, printsBeforeStale + 1); assert.equal(changing.button.disabled, false);

  const removed = changing.action.print(); await tick(); changing.state.source = null; pending[3].resolve(blob); await removed;
  assert.equal(printed.length, printsBeforeStale + 1); assert.equal(changing.button.disabled, true);
  const missingIdentity = create({ identity: undefined, label: "identity.pdf", sourcePdf });
  const missing = missingIdentity.action.print(); await tick(); missingIdentity.state.source = null; pending[4].resolve(blob); await missing;
  assert.equal(printed.length, printsBeforeStale + 1, "a missing document cannot match an undefined previous identity");

  fixture.prepare = async () => { throw new Error("Synthetic preparation failure"); };
  const failing = create({ identity: {}, label: "failure.pdf", sourcePdf }); await failing.action.print();
  assert.match(failing.statuses.at(-1), /Failed to prepare printing: Synthetic preparation failure/); assert.equal(failing.button.disabled, false);
  fixture.prepare = async () => { throw new DOMException("Synthetic cancellation", "AbortError"); };
  await failing.action.print(); assert(!failing.statuses.at(-1).startsWith("Failed"), "cancellation does not produce a failure notice");
  fixture.prepare = async () => { throw Object.assign(new Error("Synthetic worker cancellation"), { name: "AbortError" }); };
  await failing.action.print(); assert(!failing.statuses.at(-1).startsWith("Failed"), "worker-style cancellation also avoids a failure notice");

  const [nativeSource, threeSource, nativeHtml, threeHtml] = await Promise.all([
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"), readFile(new URL("../src/three-example.ts", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"), readFile(new URL("../three-example.html", import.meta.url), "utf8")
  ]);
  const initializeEditor = () => assert.fail("a View print snapshot cannot initialize editing");
  const native = vm.createContext({ pdfEditor: null, lastLoadedSource: null, lastCanonicalScene: null, lastParsedScene: null,
    lastParsedSceneLabel: null, lastLoadedPdfPassword: undefined, lastDownloadablePdf: { url: "unused-hint.pdf" }, initializeEditor, createEditorUi: initializeEditor });
  vm.runInContext(sourceFunction(nativeSource, "getNativePrintDocument"), native);
  assert.equal(native.getNativePrintDocument(), null);
  const activeEditor = { save: async () => {} };
  native.pdfEditor = activeEditor;
  assert.equal(native.getNativePrintDocument().editor, activeEditor, "native editor state takes priority over original source bytes");
  assert.equal(native.getNativePrintDocument().identity, activeEditor);
  native.pdfEditor = null;
  const nativeBytes = Uint8Array.of(4, 5, 6), nativeLoadedSource = { kind: "pdf", label: "actual.pdf", bytes: nativeBytes };
  const nativeCanonical = { pageCount: 8,
    pageRects: Float32Array.from(Array.from({ length: 8 }, (_, index) => [0, index * 100, 100, index * 100 + 80]).flat()),
    pdfPages: [{ pageIndex: 3, sourcePageIndex: 3 }] };
  native.lastLoadedSource = nativeLoadedSource; native.lastCanonicalScene = nativeCanonical;
  native.lastParsedScene = { pdfPages: [{ sourcePageIndex: 99 }] }; native.lastParsedSceneLabel = "loaded selection.pdf";
  native.lastLoadedPdfPassword = "synthetic native password";
  const nativePdf = native.getNativePrintDocument();
  assert.equal(nativePdf.identity, nativeLoadedSource); assert.equal(nativePdf.sourcePdf.bytes, nativeBytes); assert.equal(nativePdf.label, "loaded selection.pdf");
  assert.equal(nativePdf.password, "synthetic native password");
  assert.equal(nativeCanonical.pageRects.length / 4, 8); assert.equal(nativeCanonical.pdfPages.length, 1);
  assert.equal(nativePdf.pages, undefined, "native printing keeps the whole source PDF when only one of eight scene pages is resident");
  assert.equal(nativePdf.sourcePdf.url, undefined, "native PDF bytes take priority over unrelated download hints");
  native.lastCanonicalScene = null; native.lastParsedScene = { name: "legacy scene" };
  assert.equal(native.getNativePrintDocument().pages, undefined, "legacy full-document scenes leave page scope unspecified");
  const nativeHepSource = { kind: "hep", label: "baked.hep", bytes: Uint8Array.of(9) };
  native.lastLoadedSource = nativeHepSource;
  const nativeHep = native.getNativePrintDocument();
  assert.equal(nativeHep.scene, native.lastParsedScene); assert.equal(nativeHep.sourcePdf, undefined, "native HEP printing ignores an available PDF download hint");
  native.lastParsedScene = null; assert.equal(native.getNativePrintDocument(), null);

  const three = vm.createContext({ currentPdfObject: null, pdfEditor: null, lastDownloadablePdf: null, initializeEditor, createEditorUi: initializeEditor });
  vm.runInContext(sourceFunction(threeSource, "getThreePrintDocument"), three); assert.equal(three.getThreePrintDocument(), null);
  const threeScene = { pageCount: 3, pageRects: Float32Array.of(0, 0, 100, 80, 0, 100, 100, 180, 0, 200, 100, 280),
    pdfPages: [{ pageIndex: 1, sourcePageIndex: 2 }] };
  const threeBytes = Uint8Array.of(7, 8, 9), threeObject = { sourceKind: "pdf", sourceBytes: threeBytes, sourceLabel: "three.pdf",
    sourceOptions: { password: "synthetic Three password", pages: "2-4" }, sceneData: threeScene };
  three.currentPdfObject = threeObject; three.pdfEditor = activeEditor;
  assert.equal(three.getThreePrintDocument().editor, activeEditor); assert.equal(three.getThreePrintDocument().identity, activeEditor);
  three.pdfEditor = null;
  const threePdf = three.getThreePrintDocument();
  assert.equal(threePdf.identity, threeObject); assert.equal(threePdf.sourcePdf.bytes, threeBytes); assert.equal(threePdf.password, "synthetic Three password");
  assert.equal(threeScene.pageRects.length / 4, 3); assert.equal(threeScene.pdfPages.length, 1);
  assert.equal(threePdf.pages, "2-4", "Three printing retains the complete requested page range despite partially resident scene metadata");
  threeObject.sourceOptions.pages = undefined;
  assert.equal(three.getThreePrintDocument().pages, undefined, "an unspecified Three source range prints all pages instead of only resident pages");
  threeObject.sourceOptions.pages = "2-4";
  const sourceHint = { label: "download.pdf", url: "https://example.invalid/original.pdf" };
  threeObject.sourceBytes = undefined; three.lastDownloadablePdf = sourceHint; threeObject.sceneData = { name: "legacy Three scene" };
  const hintedPdf = three.getThreePrintDocument(); assert.equal(hintedPdf.sourcePdf, sourceHint); assert.equal(hintedPdf.pages, "2-4", "Three PDF sources can fall back to their downloadable URL and configured page range");
  threeObject.sourceKind = "hep"; threeObject.sourceBytes = Uint8Array.of(10);
  const threeHep = three.getThreePrintDocument(); assert.equal(threeHep.scene, threeObject.sceneData); assert.equal(threeHep.sourcePdf, undefined, "Three HEP printing ignores PDF download hints");
  threeObject.sourceKind = "pdf"; threeObject.sourceBytes = undefined; three.lastDownloadablePdf = null;
  assert.equal(three.getThreePrintDocument().scene, threeObject.sceneData, "a PDF without retained source bytes can still print its loaded scene");
  threeObject.sourceLabel = ""; assert.equal(three.getThreePrintDocument().label, "document");

  for (const [stockSource, html] of [[nativeSource, nativeHtml], [threeSource, threeHtml]]) {
    assert.match(html, /<button\b[^>]*id="print-pdf"[^>]*>Print<\/button>/);
    assert.match(stockSource, /document\.querySelector\("\.reader-primary-controls"\)\?\.append\(editorModeButton,\s*printPdfButton\)/,
      "Print is attached to the persistent Reader toolbar alongside Edit");
  }
  // The controller's initial refresh immediately reads getDocument/isBusy.
  // Each captured stock binding must already have left its temporal dead zone.
  for (const [stockSource, bindings] of [[nativeSource, ["pdfEditor", "lastLoadedSource", "lastLoadedPdfPassword", "lastCanonicalScene", "lastParsedScene", "lastParsedSceneLabel",
    "pendingSourceLoadCount", "activeSceneLoadToken", "layoutChangeRunning", "editorInitialization", "editorSceneApplicationActive", "backendSwitcher", "activeHepExportController", "isBatchExampleExportRunning", "fileInputElement"]],
  [threeSource, ["currentPdfObject", "pdfEditor", "lastDownloadablePdf", "sourceLoadController", "editorInitialization", "editorSceneApplicationActive", "backendChangeActive", "pageLayoutWarmingUp", "activeHepExportController", "fileInputElement"]]]) {
    const creation = stockSource.indexOf("viewerPrintAction = createViewerPrintAction("); assert(creation >= 0);
    for (const binding of bindings) {
      const declaration = stockSource.search(new RegExp(`^(?:let|const) ${binding}(?:\\s|:|=)`, "m"));
      assert(declaration >= 0 && declaration < creation, `${binding} is initialized before the print controller's first refresh`);
    }
  }
  const replacementPreparation = deferred(), replacementEvents = [], replacementButton = new Button();
  let replacementOptions, replacementContext;
  fixture.prepare = (_input, options) => { replacementOptions = options; return replacementPreparation.promise; };
  const replacementDocument = { identity: {}, label: "replaced.pdf", sourcePdf };
  const replacementAction = createViewerPrintAction({ button: replacementButton, document: {}, getDocument: () => replacementDocument,
    isBusy: () => Boolean(replacementContext?.pendingSourceLoadCount), setStatus() {} });
  replacementContext = vm.createContext({ AbortController, loadToken: 10, pendingSourceLoadCount: 0, sourceLoadSerial: 7,
    sourceLoadController: { abort() { replacementEvents.push("abort previous source"); assert.equal(replacementOptions.signal.aborted, true); } },
    viewerPrintAction: { cancel() { replacementEvents.push("cancel print"); assert.equal(replacementContext.pendingSourceLoadCount, 0); replacementAction.cancel(); },
      refresh() { replacementEvents.push("refresh disabled print"); assert.equal(replacementContext.pendingSourceLoadCount, 1); replacementAction.refresh(); } },
    ocrTextCheckbox: {}, compressScansCheckbox: {}, pageStreamingCheckbox: {}, backendSelectElement: {},
    activeSceneLoadToken: null, activeHepExportController: null, pdfEditor: null, lastLoadedSource: { kind: "pdf" },
    layoutChangeRunning: false, editorSceneApplicationActive: false, activePdfPageLoader: null });
  for (const name of ["beginSourceLoad", "updateBackendSelectDisabledState"]) vm.runInContext(sourceFunction(nativeSource, name), replacementContext);
  const printsBeforeReplacement = printed.length, oldPrint = replacementAction.print(); await tick();
  assert.equal(replacementButton.disabled, true);
  assert.equal(replacementContext.beginSourceLoad(), 8);
  assert.deepEqual(replacementEvents, ["cancel print", "abort previous source", "refresh disabled print"], "native replacement cancels printing before invalidating and beginning its source load");
  assert.equal(replacementOptions.signal.aborted, true); assert.equal(replacementContext.loadToken, 11);
  assert.equal(replacementContext.pendingSourceLoadCount, 1); assert.equal(replacementButton.disabled, true);
  assert.equal(replacementButton.textContent, "Print", "canceled print preparation yields button ownership to the source load");
  replacementPreparation.resolve(blob); await oldPrint;
  assert.equal(printed.length, printsBeforeReplacement, "an old preparation cannot print during the replacement load even before document identity changes");
  assert.equal(replacementButton.disabled, true, "the old job's cleanup preserves the source load's disabled state");
  console.log("Viewer print: lazy PDF/HEP/editor routing, progress, warnings, busy state, cancellation and stale-document guards passed.");
} finally { delete globalThis[fixtureKey]; hooks.deregister(); }
