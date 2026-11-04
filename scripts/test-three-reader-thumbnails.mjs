import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";

const source = await readFile(new URL("../src/three-example.ts", import.meta.url), "utf8");
const noop = () => {};
function fixture() {
  const calls = [], identity = {}, rects = Float32Array.of(0, 0, 100, 200);
  const makeObject = () => ({ sceneData: {}, sourceKind: "hep", pageCount: 1,
    getTextRecognitionProgress: () => ({ state: "idle", completed: 0, total: 0 }),
    renderer: { setInteractionViewportProvider: noop }, listeners: {},
    setMinimumStrokeWidth: noop, setFrameListener: noop,
    addEventListener(name, callback) { this.listeners[name] = callback; },
    dispose() { calls.push(["dispose", this]); }
  });
  const original = makeObject();
  const host = vm.createContext({ DOMException, Float32Array, currentPdfObject: original,
    readerDocumentIdentity: identity, readerPageRects: rects,
    readerEditorThumbnailScene: { id: "committed" },
    readerNavigationSource: {}, readerNavigationScene: {}, lastNativeDrawStats: {},
    activePageLayout: "reader", renderer: { domElement: { getBoundingClientRect: noop } },
    readMinimumStrokeWidthValue: () => 0, minimumStrokeWidthInputElement: {},
    loadedCompressScansPreference: false, compressScansCheckboxElement: { checked: false },
    drawCallCounter: { recordNativeFrame: noop }, drawCallMeter: { reset: noop },
    resetPageLayout(view) { host.activePageLayout = view?.layout ?? "grid"; },
    reader: { setLayout(value) { calls.push(["layout", value]); },
      setDocument(value) { calls.push(["document", value]); }, getView: () => ({}),
      invalidateThumbnails(...args) { calls.push(["thumbnails", ...args]); } },
    getReaderPageRects: () => rects.slice(), syncPageCameraControls: noop,
    layerControls: { objectChanged() { calls.push(["layers", host.currentPdfObject]); } },
    scene: { add: noop, remove: noop }, resetFpsMeter: noop, refreshDropIndicator: noop,
    applyReaderCameraView: noop, setPanelCollapsed: noop, fitCameraToPdfObject: noop,
    updateCameraClipping: noop, drawingSelection: { sceneChanged: noop, rendererChanged: noop },
    annotationOverlay: { sceneChanged: noop }, annotationControls: { sceneChanged: noop },
    annotationInteraction: null, updateDrawStatsMeter: noop, setDownloadDataButtonState: noop,
    refreshSearchAvailability: noop, textSearchInputElement: { value: "" }, requestRender: noop,
    updateSceneMetrics: noop, setDownloadPdfButtonState: noop, lastDownloadablePdf: null,
    fileValueElement: {}, sourceSegmentsValueElement: {}, visibleSegmentsValueElement: {},
    timesValueElement: {}, setDrawStatsText: noop, setLodStatsText: noop, setTextLodStatsText: noop,
    textRecognitionControls: { setDocumentAvailable: noop, setProgress: noop },
    textSelection: { refreshHighlights() { calls.push(["selection-refresh"]); } }
  });
  for (const name of ["releasePdfObject", "disposeCurrentObject", "replacePdfObject"])
    vm.runInContext(sourceFunction(source, name), host);
  return { host, calls, identity, rects, original, makeObject };
}

{
  const f = fixture(), next = f.makeObject();
  f.host.replacePdfObject(next, { fitCamera: false, pageLayoutView: { layout: "reader" }, layout: "reader" });
  assert.equal(f.host.currentPdfObject, next);
  assert.equal(f.calls.filter(call => call[0] === "dispose").length, 1);
  assert.equal(f.calls.find(call => call[0] === "dispose")[1], f.original);
  const documents = f.calls.filter(call => call[0] === "document");
  assert.equal(documents.length, 1, "same-document scene replacement never clears the Reader document");
  assert.equal(documents[0][1].identity, f.identity);
  assert.deepEqual(documents[0][1].pageRects, f.rects);
  assert.deepEqual(f.calls.filter(call => call[0] === "layout"), [["layout", "reader"]]);
  next.listeners.change({ reason: "raster-ready" });
  assert.equal(f.calls.filter(call => call[0] === "thumbnails").length, 0, "GPU raster residency does not dirty thumbnail pixels");
  next.listeners.change({ reason: "pages-loaded" });
  assert.equal(f.calls.filter(call => call[0] === "thumbnails").length, 0, "display page swaps do not alter canonical thumbnail pages");
  next.listeners.change({ reason: "text-recognized" });
  assert.equal(f.calls.filter(call => call[0] === "selection-refresh").length, 1, "recognition refreshes selection metadata");
  assert.equal(f.calls.filter(call => call[0] === "thumbnails").length, 0, "recognition metadata retains canonical thumbnail pixels");
}
{
  const f = fixture(), next = f.makeObject();
  f.host.replacePdfObject(next);
  const documents = f.calls.filter(call => call[0] === "document");
  assert.equal(documents.length, 2, "opening another document clears the old sidebar");
  assert.equal(documents[0][1].identity, null); assert.equal(documents[1][1].identity, next);
}
{
  const f = fixture(); f.host.disposeCurrentObject();
  assert.equal(f.host.currentPdfObject, null);
  assert.equal(f.calls.find(call => call[0] === "document")[1].identity, null);
  assert.equal(f.host.readerPageRects.length, 0);
  assert.equal(f.host.readerEditorThumbnailScene, null);
}

function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function thumbnailFixture(getPageThumbnail) {
  const controller = new AbortController(), original = { getPageThumbnail, getOptionalContentVisibility: () => null };
  const host = vm.createContext({ DOMException, currentPdfObject: original,
    readerEditorThumbnailScene: null, readerEditorThumbnailRenderer: null, readerEditorThumbnailPages: new WeakMap(),
    readPageBackgroundColor: () => [1, 1, 1, 1], readVectorOverrideColor: () => [0, 0, 0, 0] });
  vm.runInContext(sourceFunction(source, "getThreeReaderPageThumbnail").replace(/\bimport\(/g, "importModule("), host);
  return { host, controller, original, render: () => host.getThreeReaderPageThumbnail(2, { maxDimension: 160, signal: controller.signal }) };
}
for (const result of ["abort", "stale-success"]) {
  const gate = deferred(), f = thumbnailFixture(() => gate.promise), pixels = { width: 1, height: 1, rgba: Uint8Array.of(1, 2, 3, 255) };
  const work = f.render(); let retried = 0;
  f.host.currentPdfObject = { getOptionalContentVisibility: () => null, async getPageThumbnail(page, options) {
    retried++; assert.equal(page, 2); assert.equal(options.signal, f.controller.signal); return pixels;
  } };
  if (result === "abort") gate.reject(new DOMException("Old object disposed.", "AbortError"));
  else gate.resolve({ stale: true });
  assert.equal(await work, pixels); assert.equal(retried, 1, "unaffected in-flight jobs retry on the replacement object");
}
{
  const error = new Error("Invalid image"), f = thumbnailFixture(async () => { throw error; });
  await assert.rejects(f.render(), candidate => candidate === error);
}
{
  const gate = deferred(), f = thumbnailFixture(() => gate.promise), work = f.render(); let retried = 0;
  const rejection = assert.rejects(work, { name: "AbortError" });
  f.host.currentPdfObject = { async getPageThumbnail() { retried++; } };
  f.controller.abort(); gate.reject(new DOMException("Old object disposed.", "AbortError"));
  await rejection; assert.equal(retried, 0, "invalidated Reader jobs never retry");
}
{
  const gate = deferred(), f = thumbnailFixture(() => gate.promise), work = f.render();
  const rejection = assert.rejects(work, { name: "AbortError" });
  f.host.currentPdfObject = null; gate.reject(new DOMException("Old object disposed.", "AbortError"));
  await rejection;
}
{
  const calls = [], committed = { id: "committed" }, preview = { id: "temporary-pose" };
  const f = thumbnailFixture(async () => assert.fail("Editor thumbnails must not use the displayed preview object"));
  f.host.readerEditorThumbnailScene = committed;
  f.host.currentPdfObject.sceneData = preview;
  f.host.importModule = async name => name === "./scenePageViews" ? { ScenePageViews: class {
    constructor(scene) { this.scene = scene; calls.push(["partition", scene]); }
    extract(page) { return { scene: { owner: this.scene, page } }; }
  } } : { ThumbnailSceneRenderer: class {
    constructor() { calls.push(["renderer"]); }
    async render(scene, options, signal) { signal.throwIfAborted(); calls.push(["render", scene]); return scene; }
  } };
  const first = await f.render();
  assert.equal(first.owner, committed); assert.equal(first.page, 2);
  f.host.currentPdfObject = { sceneData: { id: "another-pose" }, getOptionalContentVisibility: () => null,
    getPageThumbnail: async () => assert.fail("Replacement previews must stay outside thumbnail rendering") };
  const duringPreview = await f.render();
  assert.equal(duringPreview.owner, committed, "new sidebar requests retain committed pixels during canceled transforms");
  const next = { id: "committed-edit" }; f.host.readerEditorThumbnailScene = next;
  assert.equal((await f.render()).owner, next, "accepted edits advance the canonical thumbnail source");
  assert.equal(calls.filter(call => call[0] === "renderer").length, 1, "editor thumbnails share a disposable GPU context");
  assert.equal(calls.filter(call => call[0] === "partition").length, 2, "one page partition is cached for each committed scene");
}
{
  const gate = deferred(), committed = { id: "committed" }, f = thumbnailFixture(() => gate.promise);
  const work = f.render();
  f.host.readerEditorThumbnailScene = committed;
  f.host.currentPdfObject = { getOptionalContentVisibility: () => null,
    getPageThumbnail: async () => assert.fail("A retry must not read the new object's temporary pose") };
  f.host.importModule = async name => name === "./scenePageViews" ? { ScenePageViews: class {
    constructor(scene) { this.scene = scene; } extract() { return { scene: this.scene }; }
  } } : { ThumbnailSceneRenderer: class { async render(scene) { return scene; } } };
  gate.reject(new DOMException("Old object disposed.", "AbortError"));
  assert.equal(await work, committed, "a job crossing editor setup retries through the committed source");
}
console.log("Three Reader thumbnails: replacements retain Reader identity, display residency preserves caches, committed snapshots exclude previews, and unaffected jobs survive object disposal.");
