import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";

for (const [file, name, native] of [["main.ts", "openCreatedNativePdf", true], ["three-example.ts", "openCreatedThreePdf", false]]) {
  const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8"), method = sourceFunction(source, name);
  for (const outcome of ["success", "failed", "cancelled", "declined", "setup-failed", "edit-frame-failed", "recovery-failed"]) {
    const calls = []; let active = true;
    const previous = { isEditing: () => active, isBusy: () => false, confirmDocumentChange(options) { calls.push(["confirm", options.deferRecoveryDiscard]); return outcome !== "declined"; },
      async setEditing(value) { active = value; calls.push(["old-mode", value]); }, dispose(options) { calls.push(["dispose", options.discardRecovery]); } };
    const replacement = { async setEditing(value) { calls.push(["new-mode", value]); if (outcome === "edit-frame-failed" || outcome === "recovery-failed") throw new Error(outcome); }, dispose() { calls.push(["candidate-disposed"]); } };
    const context = vm.createContext({ AbortController, AbortSignal, File, Uint8Array, Error, pdfEditor: previous,
      editorInitialization: null, pendingSourceLoadCount: 0, activeSceneLoadToken: null, layoutChangeRunning: false,
      sourceLoadController: null, pageLayoutWarmingUp: false, backendChangeActive: false,
      lastParsedScene: { pageCount: 1 }, lastCanonicalScene: {}, documentPageScenes: [], canonicalPagesPerRow: 1, lastParsedSceneLabel: "Old", lastLoadedSource: {},
      lastLoadedPdfPassword: undefined, lastDownloadablePdf: {}, createdDocumentSource: null, nativeLayout: "grid", gridViewState: null, readerViewState: null, parsedPdfPageCache: null,
      activePdfPageLoader: null, loadedOcrTextOnly: false, loadedPageStreaming: false, loadedCompressScans: false, loadedCompressScansPreference: true,
      applyTextSearchScene() {}, refreshDropIndicator() {}, setDownloadDataButtonState() {}, setDownloadPdfButtonState() {},
      cancelActiveHepExport() {}, setPrimaryLoadControlsEnabled(value) { calls.push(["controls", value]); },
      setLoadControlsEnabled(value) { calls.push(["controls", value]); },
      beginSourceLoad() { context.sourceLoadController = new AbortController(); return 1; }, finishSourceLoad() { context.sourceLoadController = null; }, createParseBuffer: value => value,
      async ensureNativeEditor() { return ensure(); }, async ensureThreeEditor() { return ensure(); },
      async loadPdfBuffer(_bytes, _label, options) { await load(options); }, async loadSource(_source, options) { return load(options); }
    });
    function ensure() { calls.push(["ensure"]); assert(!calls.some(call => call[0] === "dispose")); if (outcome === "setup-failed") throw new Error(outcome); context.pdfEditor = replacement; return replacement; }
    async function load(options) {
      calls.push(["prepare"]); assert.equal(context.pdfEditor, previous); assert(!calls.some(call => call[0] === "dispose"), "authoring state survives candidate preparation");
      if (outcome === "cancelled") { controller.abort(); throw new DOMException("Cancelled", "AbortError"); }
      if (outcome === "failed") return false;
      await options.prepareEditor();
      assert(!calls.some(call => call[0] === "dispose"), "old author models and recovery survive first Edit frame/recovery preparation");
      options.beforeCommit(); calls.push(["commit"]); return true;
    }
    vm.runInContext(method, context); const controller = new AbortController();
    let result; try { result = await context[name](Uint8Array.of(1), "Untitled", { createdDocument: true, initialUnsaved: true }, controller.signal); }
    catch (error) { if (outcome === "cancelled") assert.equal(error.name, "AbortError"); else assert.equal(error.message, outcome); }
    if (outcome === "success") { assert.equal(result, true); assert(calls.some(call => call[0] === "dispose")); assert(calls.some(call => call[0] === "new-mode" && call[1])); assert.deepEqual(calls.at(-1), ["controls", true]); }
    else { assert.equal(context.pdfEditor, previous); assert(active, "failure restores the old editing mode"); assert(!calls.some(call => call[0] === "dispose")); if (["failed", "cancelled", "declined"].includes(outcome)) assert(!calls.some(call => call[0] === "ensure")); }
  }
  const html = await readFile(new URL(native ? "../index.html" : "../three-example.html", import.meta.url), "utf8"); assert.match(html, /id="new-pdf"/);
}
const nativeSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
assert.doesNotMatch(sourceFunction(nativeSource, "loadPdfBuffer"), /No visible geometry/);
assert.doesNotMatch(sourceFunction(nativeSource, "loadHepBuffer"), /No visible geometry/);
const threeSource = await readFile(new URL("../src/three-example.ts", import.meta.url), "utf8");
assert.match(sourceFunction(threeSource, "loadSource"), /replacementInstalled && !replacementCommitted/);
for (const failure of ["compile", "first-frame", "warmup", "editor-setup", "recovery", null]) {
  const calls = [], previous = { sourceLabel: "Old" }, next = { pageCount: 1, sourceKind: "pdf", sourceLabel: "New", sceneData: {},
    async compileForThreeRenderer() { calls.push("compile"); if (failure === "compile") throw new Error("shader failure"); }, dispose() { calls.push("candidate-disposed"); } };
  const noop = () => {}, context = vm.createContext({ AbortController, URLSearchParams, performance, Error,
    window: { location: { search: "" } }, canvasElement: { width: 100, height: 100 },
    currentPdfObject: previous, lastLoadedSource: "old.pdf", createdDocumentSource: { createdDocument: true, recoveryKey: "old-key" },
    lastDownloadablePdf: { label: "Old" }, pageLayoutView: null, activePageLayout: "grid", readerEditorThumbnailScene: "old-thumbnails", readerDocumentIdentity: "old-identity",
    loadToken: 0, sourceLoadController: null, renderer: {}, camera: { clone: () => ({ updateProjectionMatrix() {} }) }, THREE: { WebGLCoordinateSystem: 1, WebGPUCoordinateSystem: 2 },
    loadDiagnostics: { begin: noop, checkpoint: noop, progress: noop, finish: noop }, discardThreeEditor: () => assert.fail("retained replacement must not discard the editor during preparation"),
    cancelActiveHepExport: noop, readBackendMode: () => "webgl", readThreeObjectOptions: () => ({}), captureCameraSnapshot: () => ({}), restoreCameraSnapshot: () => calls.push("camera-restored"),
    reader: { snapshot: () => ({}), restore: () => calls.push("reader-restored") },
    setStatus: noop, setLoadingProgress: noop, setLoadControlsEnabled: noop, setDownloadDataButtonState: noop, setDownloadPdfButtonState: noop,
    backendSelectElement: {}, vectorLodSelectElement: {}, textLodSelectElement: {}, resetVectorStrokeLodBuildTiming: noop, pdfObjectGenerator: async () => next,
    consumeVectorStrokeLodBuildTiming: () => ({}), resolveDownloadablePdfSource: async () => ({ label: "New" }), updateLoadingProgress: noop,
    prepareThreeRendererBackend: async () => null, fitCameraToObject: noop,
    replacePdfObject(object, options) { calls.push(object === next ? "install-candidate" : "restore-previous"); if (object === next) assert(options.retainPrevious); else next.dispose(); context.currentPdfObject = object; },
    requestRender: noop, async waitForLoad(promise, signal) { signal.throwIfAborted(); const result = await promise; signal.throwIfAborted(); return result; },
    waitForNextRenderedFrame: async () => { if (failure === "first-frame") throw new Error("first frame failure"); },
    warmThreeRenderer: async () => { if (failure === "warmup") throw new Error("warmup failure"); }, formatLoadTiming: () => "", lastLoadTimingText: "",
    clearLoadedStatus: noop, updateSceneMetrics: noop, releasePdfObject: object => { assert.equal(object, previous); calls.push("previous-disposed"); },
    updateThreeBackendSelectDisabledState: noop
  });
  vm.runInContext(sourceFunction(threeSource, "loadSource"), context);
  const result = await context.loadSource({ name: "new.pdf", size: 10 }, { retainPrevious: true, createdDocument: { createdDocument: true },
    async prepareEditor() { calls.push("editor-preparing"); assert(!calls.includes("previous-disposed")); if (failure === "editor-setup" || failure === "recovery") throw new Error(failure); },
    beforeCommit: () => calls.push("editor-disposed") });
  if (failure) { assert.equal(result, false); assert.equal(context.currentPdfObject, previous); assert(!calls.includes("previous-disposed")); assert(!calls.includes("editor-disposed")); assert.equal(context.lastLoadedSource, "old.pdf"); assert.equal(context.createdDocumentSource.recoveryKey, "old-key"); if (failure !== "compile") assert(calls.includes("reader-restored")); }
  else { assert.equal(result, true); assert.equal(context.currentPdfObject, next); assert.deepEqual(calls.slice(-2), ["editor-disposed", "previous-disposed"]); }
}
console.log("New PDF hosts preserve authoring through preparation/cancellation, commit only on success, restore Edit, and accept blank PDF/HEP pages.");
