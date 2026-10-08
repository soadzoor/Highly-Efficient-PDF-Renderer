import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createLoadProgressReporter } from "../src/loadProgress.ts";
import { waitForLoad } from "../src/loadCancellation.ts";
import { sourceFunction } from "./lib/sourceFunction.mjs";

const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const noop = () => {};
const stats = {};
const timing = { elapsedMs: 0, buildCount: 0, sourceSegmentCount: 0, levelCount: 0 };
const exports = [];
const statuses = [];
const downloads = [];
const exportProgress = [];
const completeParses = [];
const hepPrompts = [];
let exportWarning = null;
let duringBuild = null;
let nextParse = async (buffer) => [scene(new Uint8Array(buffer)[0])];
let failUpload = null;
let uploadedScene = null;
let view = { cameraCenterX: 0, cameraCenterY: 0, zoom: 1 };
// The export dialog's default: Download with no LOD checked. null is Cancel.
let hepLodChoice = {};
const context = vm.createContext({
  performance, AbortController, Uint8Array, console: { log: noop, warn: noop },
  waitForLoad, createLoadProgressReporter,
  loadToken: 0, activeSceneLoadToken: null, pendingSourceLoadCount: 0, sourceLoadSerial: 0,
  sourceLoadController: null, activeHepExportController: null,
  activePdfPageLoader: null, demandPdfUpdatePending: false,
  lastLoadedSource: null, lastDownloadablePdf: null, lastParsedScene: null,
  lastLoadedPdfPassword: undefined, loadedOcrTextOnly: false, ocrTextCheckbox: { checked: false, disabled: false },
  loadedPageStreaming: false, pageStreamingCheckbox: { checked: false, disabled: false },
  loadedCompressScans: false, compressScansCheckbox: { checked: false, disabled: false },
  lastParsedSceneLabel: null, parsedPdfPageCache: null,
  exampleManifestEntries: [], exampleSelectionMap: new Map(),
  exampleDropdown: { setDisabled: noop },
  statusTextElement: { textContent: "", hidden: true }, baseStatus: "",
  runtimeTextElement: {}, backendSelectElement: {},
  cancelActiveHepExport: noop,
  cloneSourceBytes: (buffer) => new Uint8Array(buffer).slice(),
  createParseBuffer: (bytes) => bytes.slice().buffer,
  setStatus: (message) => { statuses.push(message); context.statusTextElement.textContent = message; }, clearLoadedStatus: noop,
  setDownloadPdfButtonState: noop, setDownloadDataButtonState: noop,
  setDownloadAllDataButtonState: noop, setPrimaryLoadControlsEnabled: noop,
  setParsingLoader: noop, setMetricPlaceholder: noop, updateParsingLoaderProgress: event => exportProgress.push(event.value),
  logSegmentMergeStats: noop, logInvisibleCullStats: noop, logTextVectorStats: noop,
  logTextureSizeStats: noop, applyTextSearchScene: noop, refreshDropIndicator: noop,
  updateMetricsPanel: noop,
  scheduleDemandPdfUpdate: noop, textSearchWidget: { setAvailability: noop },
  openPdfPageDemand: openShortDocument,
  extractPdfPageScenes: (buffer, options, signal) => nextParse(buffer, options, signal),
  loadPdfSceneFromSource: async (bytes, options, signal) => {
    completeParses.push({ bytes, options, signal });
    return { scene: (await nextParse(bytes.buffer, options, signal))[0] };
  },
  loadSceneFromHep: async (buffer, options) => (await nextParse(buffer, {}, options.signal))[0],
  computeAutoPagesPerRow: () => 1,
  composeVectorScenesInGrid: (pages) => pages[0],
  prepareSceneForHepRendering: (value) => value,
  listSceneRasterLayers: () => [], resolveSceneFitBounds: () => ({}),
  hasStoredVectorStrokeLod: () => false,
  prebuildVectorLodForScene: async () => timing, prebuildTextLodForScene: async () => {},
  consumeVectorStrokeLodBuildTiming: () => timing, combineVectorLodTimings: () => timing,
  yieldToBrowserPaint: async () => {}, yieldAfterPaint: async (signal) => signal?.throwIfAborted(),
  sanitizeDownloadName: (label) => label,
  promptForHepLod: async (value, signal) => {
    hepPrompts.push({ scene: value, signal, completeParseCount: completeParses.length });
    return hepLodChoice;
  },
  triggerBrowserDownload: (_blob, name) => downloads.push(name), formatFileSize: String,
  buildHep: async (value, options) => {
    exports.push({ scene: value, label: options.sourceLabel, options });
    options.onProgress?.({ value: 0, stage: "hep-build" });
    options.onProgress?.({ value: 1, stage: "hep-build" });
    if (exportWarning) options.onWarning?.(exportWarning);
    await duringBuild?.(options);
    return { size: 1 };
  },
  renderer: {
    getViewState: () => ({ ...view }), setViewState: (next) => { view = next; },
    setScene: (value) => {
      uploadedScene = value; // Simulate an upload which can fail after replacing buffers.
      if (value.id === failUpload) throw new Error("GPU upload failed");
      return stats;
    },
    fitToBounds: () => { view = { cameraCenterX: 10, cameraCenterY: 20, zoom: 2 }; }
  },
  backendSwitcher: { runWhenIdle: async (action) => action(), isSwitchInFlight: () => false },
  LOAD_PROGRESS_PARSE_END: 0.34, LOAD_PROGRESS_COMPILE: 0.36,
  LOAD_PROGRESS_VECTOR_LOD_START: 0.38, LOAD_PROGRESS_UPLOAD: 0.98
});
for (const name of [
  "loadExampleSelection", "loadPdfFile", "loadHepFile", "loadPdfBuffer", "loadHepBuffer",
  "getExtractionOptions", "buildPdfPageCacheKey", "getCachedPdfPageScenes", "storeCachedPdfPageScenes",
  "commitLoadedSource", "uploadSceneWithRollback", "beginSourceLoad", "finishSourceLoad",
  "isCurrentSourceLoad", "beginSceneLoad", "finishSceneLoad", "updateBackendSelectDisabledState", "downloadHep",
  "reloadPdfViewingOptions"
]) vm.runInContext(sourceFunction(source, name), context);

await context.loadPdfFile(file("A.pdf", 65));
assertDocument(65, "A.pdf");
const originalCache = context.parsedPdfPageCache;
await assertExport(65, "A.pdf");
await testNativeHepExports();
hepLodChoice = null;
const exportCount = exports.length;
assert.equal(await context.downloadHep(), false, "cancelling the export dialog downloads nothing");
assert.equal(exports.length, exportCount);
hepLodChoice = {};

nextParse = async () => { throw new Error("invalid PDF"); };
await context.loadPdfFile(file("B.pdf", 66));
assertDocument(65, "A.pdf");
assert.equal(context.parsedPdfPageCache, originalCache);
await assertExport(65, "A.pdf");

await context.loadPdfFile({ name: "unreadable.pdf", arrayBuffer: async () => { throw new Error("read failed"); } });
assertDocument(65, "A.pdf");
await context.loadHepFile(file("invalid.hep", 67));
assertDocument(65, "A.pdf");
await assertExport(65, "A.pdf");

nextParse = async () => [{ ...scene(68), segmentCount: 0 }];
await context.loadPdfFile(file("empty.pdf", 68));
assertDocument(65, "A.pdf");
await assertExport(65, "A.pdf");

nextParse = async (buffer) => [scene(new Uint8Array(buffer)[0])];
failUpload = 69;
const originalView = { ...view };
await context.loadPdfFile(file("gpu-failure.pdf", 69));
assertDocument(65, "A.pdf");
assert.deepEqual(view, originalView);
await assertExport(65, "A.pdf");
failUpload = null;

// A second source cancels the old parser before the second read has completed.
let parseSignal;
let startParse;
const parseStarted = new Promise((resolve) => { startParse = resolve; });
nextParse = async (_buffer, _options, signal) => {
  parseSignal = signal;
  startParse();
  return waitForLoad(new Promise(() => {}), signal);
};
const slow = context.loadPdfFile(file("slow.pdf", 70));
await parseStarted;
let finishRead;
const newer = context.loadPdfFile({
  name: "newer.pdf",
  arrayBuffer: () => new Promise((resolve) => { finishRead = resolve; })
});
assert.equal(parseSignal.aborted, true);
await slow;
assertDocument(65, "A.pdf");
nextParse = async (buffer) => [scene(new Uint8Array(buffer)[0])];
finishRead(Uint8Array.of(71).buffer);
await newer;
assertDocument(71, "newer.pdf");
await assertExport(71, "newer.pdf");

// A successful HEP without an embedded PDF must clear the previous PDF source.
await context.loadHepFile(file("new.hep", 72));
assert.equal(context.lastLoadedSource.kind, "hep");
assert.equal(context.lastParsedScene.id, 72);
assert.equal(context.lastDownloadablePdf, null);
await context.downloadHep();
assert.equal(exports.at(-1).source, undefined);
assert.equal(context.pendingSourceLoadCount, 0);
assert.equal(context.activeSceneLoadToken, null);
assert.equal(context.sourceLoadController, null);
// A page window completes the original document once, never exporting just cached previews.
let demandClosed = false, demandPaused = false, completePageLoads = 0, demandResumes = 0;
const completePages = Array.from({ length: 17 }, () => ({ ...scene(73), complete: true }));
const demand = { pageCount: 17, pageScenes: [{ ...scene(73), segmentCount: 0 }], password: "secret",
  get displayPageScenes() { return this.pageScenes; }, bindDisplayScene: noop, setPerformanceListener: noop,
  async loadCompletePageScenes(options) {
    completePageLoads++;
    options.signal.throwIfAborted();
    options.onProgress?.({ value: 0, stage: "pdf-page" });
    options.onProgress?.({ value: 1, stage: "pdf-page" });
    return completePages;
  },
  pause() { demandPaused = true; }, resume() { demandPaused = false; demandResumes++; }, async close() { demandClosed = true; } };
context.openPdfPageDemand = async () => demand;
context.pageStreamingCheckbox.checked = true;
await context.loadPdfFile(file("paged.pdf", 73));
assertDocument(73, "paged.pdf");
assert.equal(context.activePdfPageLoader, demand);
assert.equal(context.parsedPdfPageCache, null, "partial windows are not mistaken for complete parsed documents");
hepLodChoice = {};
const pagedExportStart = exports.length;
const initialPrompt = context.promptForHepLod;
context.promptForHepLod = async (value, signal) => {
  assert.equal(completePageLoads, 0, "LOD choices precede full page extraction");
  return initialPrompt(value, signal);
};
assert.equal(await context.downloadHep(), true);
context.promptForHepLod = initialPrompt;
assert.equal(completePageLoads, 1, "export completes the loaded PDF only once");
assert.equal(exports.length, pagedExportStart + 1);
assert(exports.slice(pagedExportStart).every(item => item.scene === completePages[0]),
  "export uses the complete canonical scene, without reparsing source bytes");
assert.notEqual(exports.at(-1).scene, context.lastParsedScene, "viewing previews are never exported");
assert.equal(demandPaused, false, "export resumes demand-driven loading");
hepLodChoice = {};
const staleExportStart = exports.length, staleResumeStart = demandResumes;
const completePageLoader = demand.loadCompletePageScenes;
demand.loadCompletePageScenes = async () => {
  context.activePdfPageLoader = null;
  context.activeHepExportController.abort();
  context.activeHepExportController = null;
  return completePages;
};
assert.equal(await context.downloadHep(), false);
assert.equal(exports.length, staleExportStart, "ownership lost after extraction prevents building stale HEP data");
assert.equal(demandResumes, staleResumeStart, "replaced page loaders are not resumed by stale exports");
demand.loadCompletePageScenes = completePageLoader;
context.activePdfPageLoader = demand;
await context.loadHepFile(file("replacement.hep", 74));
assert.equal(context.activePdfPageLoader, null);
assert.equal(demandClosed, true, "document replacement closes the paging worker");

// With streaming off, even a large vector document is prepared and uploaded as one scene.
let initialLoads = 0, batchClosed = false;
const batch = { pageCount: 17, requiresPageDemand: false, pageScenes: Array.from({ length: 17 }, () => scene(76)),
  get displayPageScenes() { return this.pageScenes; },
  async loadInitialOverviews(signal, retainAll) { signal.throwIfAborted(); assert.equal(retainAll, true); initialLoads++; },
  async close() { batchClosed = true; } };
context.openPdfPageDemand = async () => batch;
await context.loadPdfFile(file("full-book.pdf", 76));
assertDocument(76, "full-book.pdf");
assert.equal(initialLoads, 1);
assert.equal(batchClosed, true, "completed vector documents release the paging worker");
assert.equal(context.activePdfPageLoader, null);
assert.equal(context.parsedPdfPageCache.pageScenes.length, 17);
assert.equal(context.loadedPageStreaming, false);
const batchView = { ...view };
context.pageStreamingCheckbox.checked = true;
context.openPdfPageDemand = async () => { throw new Error("streaming reload failed"); };
await context.reloadPdfViewingOptions();
assert.equal(context.pageStreamingCheckbox.checked, false, "failed reload restores the selected loading mode");
assertDocument(76, "full-book.pdf");
assert.deepEqual(view, batchView);

// Switching text mode uses the original source, keeps the view, and cannot export the approximation.
context.openPdfPageDemand = openShortDocument;
nextParse = async (buffer, options) => [{ ...scene(new Uint8Array(buffer)[0]), mode: options.ocrTextOnly === true }];
await context.loadPdfFile(file("ocr.pdf", 75));
const beforeOcrView = { ...view };
context.ocrTextCheckbox.checked = true;
await context.reloadPdfViewingOptions();
assert.equal(context.lastParsedScene.mode, true);
assert.equal(context.loadedOcrTextOnly, true);
assert.equal(context.parsedPdfPageCache.optionsKey, "merge:1|cull:1|ocr:1|stream:0|compress:0");
assert.deepEqual(view, beforeOcrView);
hepLodChoice = {};
const ocrExportStart = exports.length, ocrParseStart = completeParses.length;
await context.downloadHep();
assert.equal(hepPrompts.at(-1).completeParseCount, ocrParseStart,
  "text-only export does not parse the full PDF before opening the dialog");
assert.equal(completeParses.length, ocrParseStart + 1, "export completes text-only PDFs only once");
assert.equal(completeParses.at(-1).options.ocrTextOnly, false);
assert.equal(exports.length, ocrExportStart + 1);
assert.equal(exports.at(-1).scene.id, 75);
assert.equal(exports.at(-1).scene.mode, false, "text-only approximation is replaced with canonical content for export");
assert.notEqual(exports.at(-1).scene, context.lastParsedScene);
hepLodChoice = {};
nextParse = async () => { throw new Error("failed to restore scans"); };
context.ocrTextCheckbox.checked = false;
await context.reloadPdfViewingOptions();
assert.equal(context.lastParsedScene.mode, true);
assert.equal(context.ocrTextCheckbox.checked, true, "failed mode switch restores its checkbox");
nextParse = async (buffer, options) => [{ ...scene(new Uint8Array(buffer)[0]), mode: options.ocrTextOnly === true }];
context.ocrTextCheckbox.checked = false;
await context.reloadPdfViewingOptions();
assert.equal(context.lastParsedScene.mode, false);
assert.equal(context.loadedOcrTextOnly, false);
assert.deepEqual(view, beforeOcrView);

await testThreeDocumentReplacement();
await testThreeHepExports();
await testHepLodPrompt();
await testThreeBackendReplacement();
await testRoomDocumentReplacement();
await testNativeBackendLoading();
testNativePageDemandFrames();
console.log("Document replacement, export ownership, upload rollback, and superseded-load cancellation passed.");

function testNativePageDemandFrames() {
  let now = 1000;
  let zoom = .4;
  const views = [];
  const host = vm.createContext({
    performance: { now: () => now }, activePdfPageLoader: { update: view => views.push(view) },
    lastParsedScene: { pageRects: Float32Array.of(0, 0, 600, 800) },
    activeSceneLoadToken: null, pendingSourceLoadCount: 0, activeHepExportController: null,
    lastRuntimeTextUpdate: now,
    renderer: { getPresentedViewState: () => ({ cameraCenterX: 300, cameraCenterY: 400, zoom }) },
    canvasElement: { width: 400, height: 500 }, updateFpsMetric: noop, drawCallMeter: { update: noop },
    textSelection: { updateOverlay: noop }, drawingSelection: { onFrame: noop },
    annotationInteraction: null, annotationOverlay: { onFrame: noop }
  });
  vm.runInContext(sourceFunction(source, "onRendererFrame"), host);
  host.onRendererFrame({ drawCalls: 0 });
  now += 16; zoom = .1;
  host.onRendererFrame({ drawCalls: 0 });
  assert.deepEqual(views.map(view => view.zoom), [.4, .1],
    "a final zoom-out frame within 100 ms still updates the page display demand");
  assert.equal(views[1].width, 400);
  assert.equal(views[1].height, 500);
  host.activeHepExportController = {};
  host.onRendererFrame({ drawCalls: 0 });
  assert.equal(views.length, 2, "exports continue to suspend page-demand updates");
}

function file(name, id) {
  return { name, arrayBuffer: async () => Uint8Array.of(id).buffer };
}
async function openShortDocument(buffer, options) {
  return { pageCount: 1, requiresPageDemand: false, pageScenes: [],
    get displayPageScenes() { return this.pageScenes; },
    async loadInitialOverviews(signal) { this.pageScenes = await nextParse(buffer, options, signal); },
    async close() {} };
}
function scene(id) {
  return { id, segmentCount: 1, textInstanceCount: 0, fillPathCount: 0 };
}
function assertDocument(id, label) {
  assert.equal(context.lastParsedScene.id, id);
  assert.equal(uploadedScene.id, id);
  assert.equal(context.lastParsedSceneLabel, label);
  assert.equal(context.lastLoadedSource.bytes[0], id);
  assert.equal(context.lastLoadedSource.label, label);
  assert.equal(context.lastDownloadablePdf.bytes[0], id);
}
async function assertExport(id, label) {
  const parseCount = completeParses.length;
  const exportCount = exports.length, downloadCount = downloads.length;
  assert.equal(await context.downloadHep(), true);
  assert.equal(completeParses.length, parseCount, "complete eager scenes need no additional PDF extraction");
  assert.equal(exports.length, exportCount + 1, "Download HEP builds one file");
  assert.equal(exports.at(-1).scene.id, id);
  assert.equal(exports.at(-1).source, undefined, "v7 exports the complete scene without embedding its source PDF");
  assert.equal(exports.at(-1).label, label);
  assert.deepEqual(downloads.slice(downloadCount), [`${label}-parsed-data.hep`]);
}

async function testNativeHepExports() {
  hepLodChoice = { withVectorLod: true, vectorLodPrecision: "lossless" };
  const exportStart = exports.length, downloadStart = downloads.length;
  exportProgress.length = 0;
  exportWarning = "HEP (200 bytes) exceeds the original PDF (100 bytes). Selected LOD caches were retained.";
  assert.equal(await context.downloadHep(), true);
  const built = exports.slice(exportStart);
  assert.equal(built.length, 1);
  assert.equal(built[0].scene, context.lastParsedScene);
  assert.equal(built[0].options.withVectorLod, true);
  assert.equal(built[0].options.vectorLodPrecision, "lossless");
  assert.equal(built[0].options.monochromeEncoding, undefined, "fast binary compression is automatic");
  assert.deepEqual(downloads.slice(downloadStart), ["A.pdf-parsed-data-lod.hep"]);
  assert.deepEqual(exportProgress, [0, 1]);
  assert.match(context.statusTextElement.textContent, /HEP downloaded.*Warning.*200 bytes.*100 bytes/);
  assert.equal(context.activeHepExportController, null);
  exportWarning = null;
  for (const stage of ["before build", "during build"]) {
    const cancelledStart = exports.length, cancelledDownloads = downloads.length;
    const originalYield = context.yieldToBrowserPaint;
    const cancel = () => {
      context.activeHepExportController.abort();
      context.activeHepExportController = null;
    };
    if (stage === "before build") context.yieldToBrowserPaint = async () => cancel();
    else duringBuild = async options => {
      cancel();
      options.onWarning("stale export warning");
    };
    assert.equal(await context.downloadHep(), false);
    assert.equal(exports.length, cancelledStart + (stage === "during build" ? 1 : 0),
      "cancelled exports do not start additional work");
    assert.equal(downloads.length, cancelledDownloads, "cancelled exports do not download a completed blob");
    assert(!context.statusTextElement.textContent.includes("stale export warning"));
    context.yieldToBrowserPaint = originalYield;
    duringBuild = null;
  }
  hepLodChoice = {};
}

async function testThreeHepExports() {
  const source = await readFile(new URL("../src/three-example.ts", import.meta.url), "utf8");
  for (const cancel of ["none", "dialog", "before build", "during build", "replacement"])
    for (const mode of ["eager", "paged", "text-only"]) {
    const built = [], downloaded = [], statuses = [], progress = [];
    const completeScene = scene("scans"), object = demoObject("scans");
    let completeLoads = 0, resumes = 0;
    object.resumePageLoading = () => { resumes++; };
    object.sceneData = mode === "eager" ? completeScene : scene("viewing approximation");
    object.isPageDemandLoaded = mode === "paged";
    object.sourceOptions = mode === "text-only" ? { ocrTextOnly: true } : undefined;
    object.sourceBytes = new Uint8Array(100);
    object.loadCompleteScene = async options => {
      completeLoads++;
      options.signal.throwIfAborted();
      options.onProgress?.({ value: 0, stage: "pdf-page" });
      options.onProgress?.({ value: 1, stage: "pdf-page" });
      return completeScene;
    };
    object.pageCount = 1;
    object.sourceLabel = "scans.pdf";
    const host = vm.createContext({
      AbortController, console: { log: noop }, currentPdfObject: object,
      loadToken: 0, sourceLoadController: null, activeHepExportController: null,
      lastLoadedSource: {}, lastDownloadablePdf: { bytes: Uint8Array.of(1), label: "scans.pdf" },
      promptForHepLod: async value => {
        assert.equal(value, object.sceneData);
        assert.equal(completeLoads, 0, "Three LOD choices precede full page extraction");
        return cancel === "dialog" ? null : { withVectorLod: true, vectorLodPrecision: "compact" };
      },
      setDownloadDataButtonState: noop, setDownloadPdfButtonState: noop, setLoadControlsEnabled: noop,
      backendSelectElement: {}, vectorLodSelectElement: {}, textLodSelectElement: {},
      setLoadingProgress: (visible, label) => {
        if (visible && label?.endsWith("Building HEP")) progress.push(Number.parseFloat(label) / 100);
      },
      formatLoadProgressStage: stage => stage === "pdf-page" ? "Completing PDF pages" : "Building HEP",
      yieldToBrowserPaint: async () => {
        if (cancel === "before build") {
          host.activeHepExportController.abort();
          host.activeHepExportController = null;
        }
      }, formatFileSize: String,
      sanitizeDownloadName: label => label,
      setStatus: message => statuses.push(message),
      buildHep: async (input, options) => {
        built.push({ input, options });
        options.onProgress({ value: 0, stage: "hep-build" });
        options.onProgress({ value: 1, stage: "hep-build" });
        options.onWarning("HEP (200 bytes) exceeds the original PDF (100 bytes).");
        if (cancel === "during build" || cancel === "replacement") {
          if (cancel === "replacement") host.currentPdfObject = demoObject("replacement");
          host.activeHepExportController.abort();
          host.activeHepExportController = null;
          options.onWarning("stale export warning");
        }
        return { size: 200 };
      },
      triggerBrowserDownload: (_blob, name) => downloaded.push(name)
    });
    vm.runInContext(sourceFunction(source, "downloadHep"), host);
    assert.equal(await host.downloadHep(), cancel === "none");
    const startsBuild = cancel !== "dialog" && cancel !== "before build";
    assert.equal(completeLoads, mode === "eager" || !startsBuild ? 0 : 1,
      "export uses one complete extraction from the loaded document");
    assert.equal(built.length, startsBuild ? 1 : 0);
    assert(built.every(item => item.input === completeScene));
    assert(built.every(item => item.options.withVectorLod === true && item.options.vectorLodPrecision === "compact"));
    assert(built.every(item => item.options.monochromeEncoding === undefined));
    assert(built.every(item => item.options.sourcePdfByteLength === 100));
    assert.deepEqual(downloaded, cancel === "none" ? ["scans.pdf-parsed-data-lod.hep"] : []);
    assert.deepEqual(progress, !startsBuild ? [] : mode === "eager" ? [0, 1] : [.8, 1]);
    if (cancel === "none") assert.match(statuses.at(-1), /HEP downloaded.*Warning.*200 bytes.*100 bytes/);
    else assert.equal(statuses.length, 0, "cancelled and superseded exports do not publish warnings");
    assert.equal(resumes, cancel === "replacement" ? 0 : 1, "only the current document resumes loading");
    assert.equal(host.activeHepExportController, null);
  }
  const built = [], downloaded = [];
  const object = demoObject("replaced scans");
  let resumes = 0;
  object.sceneData = scene("preview");
  object.isPageDemandLoaded = true;
  object.resumePageLoading = () => { resumes++; };
  const host = vm.createContext({
    AbortController, console: { log: noop }, currentPdfObject: object,
    activeHepExportController: null, lastDownloadablePdf: null,
    promptForHepLod: async () => ({}),
    setDownloadDataButtonState: noop, setDownloadPdfButtonState: noop, setLoadControlsEnabled: noop,
    backendSelectElement: {}, vectorLodSelectElement: {}, textLodSelectElement: {},
    setLoadingProgress: noop, formatLoadProgressStage: String, yieldToBrowserPaint: async () => {},
    setStatus: noop, buildHep: async input => { built.push(input); return { size: 1 }; },
    triggerBrowserDownload: (_blob, name) => downloaded.push(name)
  });
  object.loadCompleteScene = async () => {
    object.dispose();
    host.currentPdfObject = demoObject("replacement");
    host.activeHepExportController.abort();
    host.activeHepExportController = null;
    return scene("complete replaced document");
  };
  vm.runInContext(sourceFunction(source, "downloadHep"), host);
  assert.equal(await host.downloadHep(), false);
  assert.equal(built.length, 0, "replaced Three documents cannot start a stale build after extraction");
  assert.equal(downloaded.length, 0);
  assert.equal(resumes, 0, "stale cleanup does not resume the disposed Three object");
}

async function testHepLodPrompt() {
  const source = await readFile(new URL("../src/hepLodPrompt.ts", import.meta.url), "utf8");
  const elements = [];
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.value = ""; }
    append(...children) {
      this.children.push(...children);
      if (this.tag === "select" && !this.value) this.value = children.find(child => child.tag === "option")?.value ?? "";
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    close(value) { this.returnValue = value; this.listeners.close?.(); }
    remove() { this.removed = true; }
    showModal() { this.shown = true; }
    focus() {}
  }
  const host = vm.createContext({
    AbortController,
    getCachedTextLod: () => null, shouldBuildTextLod: value => value.textInstanceCount > 0,
    document: { body: new Element("body"), createTextNode: text => ({ textContent: text }),
      createElement: tag => { const element = new Element(tag); elements.push(element); return element; } }
  });
  vm.runInContext(sourceFunction(source, "promptForHepLod"), host);
  for (const rasterLayers of [[], [{ monochrome: {} }], [{ pageDemandSlot: true }],
    [{ compressionHint: "scan" }], [{ data: Uint8Array.of(255, 0, 0, 255) }]]) {
    elements.length = 0;
    assert.equal(Object.keys(await host.promptForHepLod({ segmentCount: 0, textInstanceCount: 0, rasterLayers })).length, 0);
    assert.equal(elements.length, 0, "raster and metadata scenes without LODs export without a dialog");
  }
  const aborted = new AbortController();
  aborted.abort();
  assert.equal(await host.promptForHepLod(scene("cancelled"), aborted.signal), null);
  assert.equal(elements.length, 0, "an already cancelled export does not open a dialog");
  const cases = [
    { segmentCount: 1, textInstanceCount: 0, rasterLayers: [] },
    { segmentCount: 0, textInstanceCount: 1, rasterLayers: [] },
    { segmentCount: 1, textInstanceCount: 1, rasterLayers: [{ monochrome: {} }] }
  ];
  for (const item of cases) for (const selection of ["default", "uncheck", "lossless", "cancel", "abort"]) {
    elements.length = 0;
    const controller = new AbortController();
    const pending = host.promptForHepLod(item, controller.signal);
    assert(!elements.some(element => element.attributes["aria-label"] === "Scan export options"),
      "export dialogs contain no scan encoding controls");
    const inputs = elements.filter(element => element.tag === "input");
    assert.equal(inputs.length, Number(item.segmentCount > 0) + Number(item.textInstanceCount > 0));
    assert(inputs.every(input => input.type === "checkbox" && input.checked));
    const precision = elements.find(element => element.attributes["aria-label"] === "Vector LOD precision");
    assert.equal(Boolean(precision), item.segmentCount > 0);
    if (precision) {
      assert.equal(precision.value, "compact");
      assert.deepEqual(precision.children.map(option => option.value), ["compact", "lossless"]);
    }
    if (selection === "uncheck") {
      for (const input of inputs) { input.checked = false; input.listeners.change?.(); }
      if (precision) assert.equal(precision.disabled, true, "precision follows vector LOD selection");
    }
    if (selection === "lossless" && precision) precision.value = "lossless";
    const dialog = elements.find(element => element.tag === "dialog");
    assert(dialog.shown);
    if (selection === "abort") controller.abort();
    else dialog.close(selection === "cancel" ? "cancel" : "download");
    const result = await pending;
    if (selection === "cancel" || selection === "abort") assert.equal(result, null);
    else {
      assert.equal(result.withVectorLod, item.segmentCount > 0 ? selection !== "uncheck" : undefined);
      assert.equal(result.withTextLod, item.textInstanceCount > 0 ? selection !== "uncheck" : undefined);
      assert.equal(result.vectorLodPrecision, item.segmentCount > 0 && selection !== "uncheck"
        ? selection === "lossless" ? "lossless" : "compact" : undefined);
      assert.deepEqual(Object.keys(result).sort(), [
        ...(item.segmentCount > 0 ? ["withVectorLod"] : []),
        ...(item.textInstanceCount > 0 ? ["withTextLod"] : []),
        ...(item.segmentCount > 0 && selection !== "uncheck" ? ["vectorLodPrecision"] : [])
      ].sort(), "the dialog returns only LOD options");
    }
    assert(dialog.removed);
  }
}

async function testNativeBackendLoading() {
  let imports = 0;
  let failImport = true;
  const initialized = [];
  class WebGpuFloorplanRenderer {
    static async create(canvas) {
      if (canvas.fail) throw new Error("GPU initialization failed");
      return new this(canvas);
    }
    constructor(canvas) { this.canvas = canvas; }
  }
  const host = vm.createContext({
    webGpuRendererClass: null,
    initializeRendererCommon: renderer => initialized.push(renderer),
    loadWebGpuModule: async () => {
      imports++;
      if (failImport) throw new Error("Backend chunk unavailable");
      return { WebGpuFloorplanRenderer };
    }
  });
  // Replace only the module-loading boundary; exercise the real factory body.
  const factory = sourceFunction(source, "createWebGpuRenderer")
    .replace('import("./webGpuFloorplanRenderer")', "loadWebGpuModule()");
  vm.runInContext(factory, host);
  assert.equal(imports, 0, "Defining the factory must not load the optional backend");
  await assert.rejects(host.createWebGpuRenderer({}), /chunk unavailable/);
  assert.equal(host.webGpuRendererClass, null);
  failImport = false;
  await assert.rejects(host.createWebGpuRenderer({ fail: true }), /initialization failed/);
  assert.equal(initialized.length, 0, "Failed initialization does not bind viewer state");
  const canvas = {};
  const renderer = await host.createWebGpuRenderer(canvas);
  assert.equal(renderer.canvas, canvas);
  assert.deepEqual(initialized, [renderer]);
  assert(renderer instanceof host.webGpuRendererClass, "Capture retains the loaded constructor for profiler checks");
}

async function testThreeDocumentReplacement() {
  const source = await readFile(new URL("../src/three-example.ts", import.meta.url), "utf8");
  const host = demoHost();
  const objects = new Map();
  let metadataStarted;
  const metadataReady = new Promise((resolve) => { metadataStarted = resolve; });
  Object.assign(host, {
    lastLoadedSource: "A", lastDownloadablePdf: { label: "A" }, lastLoadTimingText: "",
    readBackendMode: () => "webgl", readThreeObjectOptions: () => ({}),
    cancelActiveHepExport: noop, ensureThreeRendererBackend: async () => {},
    resetVectorStrokeLodBuildTiming: noop, consumeVectorStrokeLodBuildTiming: () => timing,
    pdfObjectGenerator: async (name, options) => {
      options.signal.throwIfAborted();
      const object = demoObject(name);
      objects.set(name, object);
      return object;
    },
    resolveDownloadablePdfSource: async (name, _object, _hint, signal) => {
      if (name === "B") {
        metadataStarted();
        await waitForLoad(new Promise(() => {}), signal);
      }
      return { label: name };
    },
    replacePdfObject: (object) => {
      host.currentPdfObject.dispose();
      host.currentPdfObject = object;
    },
    updateLoadingProgress: noop, setLoadingProgress: noop, setLoadControlsEnabled: noop,
    setDownloadDataButtonState: noop, setDownloadPdfButtonState: noop,
    waitForNextRenderedFrame: async () => {}, formatLoadTiming: () => "timing", updateSceneMetrics: noop
  });
  vm.createContext(host);
  vm.runInContext(sourceFunction(source, "loadSource"), host);
  const previous = host.currentPdfObject;
  const b = host.loadSource("B");
  await metadataReady;
  assert.equal(host.currentPdfObject, previous, "metadata preparation must not replace the visible object");
  await host.loadSource("C");
  await b;
  assert.equal(host.currentPdfObject.id, "C");
  assert.equal(host.lastLoadedSource, "C");
  assert.equal(host.lastDownloadablePdf.label, "C");
  assert.equal(objects.get("B").disposals, 1);
  assert.equal(objects.get("C").disposals, 0);
  assert.equal(previous.disposals, 1);
}

async function testRoomDocumentReplacement() {
  const source = await readFile(new URL("../src/room-overlay-demo.ts", import.meta.url), "utf8");
  const host = demoHost();
  const objects = new Map();
  const previous = host.currentPdfObject;
  const layerBindings = [];
  Object.assign(host, {
    currentPdfCoordinateTransform: { id: "A" }, currentGeneratedTsv: null, pdfValue: {},
    roomDetectionToken: 0, roomDetectionController: null, currentParsedTsv: null,
    clearRoomOverlay: noop, createIdentityPdfCoordinateTransform: () => ({ id: "identity" }),
    drawingSelection: { sceneChanged: noop },
    layerControls: { objectChanged: () => {
      layerBindings.push(host.currentPdfObject?.id ?? null);
      if (!host.currentPdfObject) assert.equal(previous.disposals, 0, "Detach the old layer panel before disposing its object");
    } },
    isHepFile: () => false, setBusy: noop, syncControlsEnabled: noop,
    updatePdfLoadProgress: noop, fitCameraToObject: noop, scene: { add: noop, remove: noop },
    renderer: { domElement: { getBoundingClientRect: () => ({}) } },
    pdfObjectGenerator: async (file, options) => {
      options.signal.throwIfAborted();
      const object = demoObject(file.name);
      objects.set(file.name, object);
      return object;
    },
    readFirstPageCoordinateTransform: async (file) => {
      if (file.name === "B") throw new Error("coordinate read failed");
      return { id: file.name };
    }
  });
  vm.createContext(host);
  for (const name of ["loadSceneSource", "clearCurrentPdfObject"]) vm.runInContext(sourceFunction(source, name), host);
  assert.equal(await host.loadSceneSource({ name: "B" }), false);
  assert.equal(host.currentPdfObject, previous);
  assert.equal(host.currentPdfCoordinateTransform.id, "A");
  assert.equal(objects.get("B").disposals, 1);
  assert.equal(previous.disposals, 0);
  assert.deepEqual(layerBindings, [], "Failed document preparation preserves the current layer panel");
  assert.equal(await host.loadSceneSource({ name: "C" }), true);
  assert.equal(host.currentPdfObject.id, "C");
  assert.equal(host.currentPdfCoordinateTransform.id, "C");
  assert.equal(previous.disposals, 1);
  assert.equal(objects.get("C").disposals, 0);
  assert.deepEqual(layerBindings, [null, "C"], "The room demo detaches old layer controls and attaches the committed document");
}

async function testThreeBackendReplacement() {
  const source = await readFile(new URL("../src/three-example.ts", import.meta.url), "utf8");
  for (const failure of ["none", "renderer", "layers", "text-view"]) {
    const reparseSource = failure === "text-view";
    const targetBackend = reparseSource ? "webgl" : "webgpu";
    const failRenderer = failure === "renderer";
    const failed = failure === "renderer" || failure === "layers";
    const host = demoHost();
    const canonicalScene = scene("same artifact");
    const previous = host.currentPdfObject;
    previous.sourceBytes = Uint8Array.of(75);
    previous.sourceOptions = { password: "fixture-password", ocrTextOnly: false };
    previous.sceneData = canonicalScene;
    previous.setFrameListener = noop;
    previous.getLayers = () => [
      { id: "visible", visible: true, defaultVisible: true },
      { id: "hidden", visible: true, defaultVisible: false }
    ];
    const replacement = { ...demoObject("replacement"), sceneData: canonicalScene, setFrameListener: noop };
    let layerReplays = 0;
    let layerResets = 0;
    let layerBindings = 0;
    const backendChanges = [];
    const previousPageLayout = { object: previous, layout: "sphere" };
    const replacementPages = [{ id: "page 1" }, { id: "page 2" }];
    const arrangedPages = [];
    replacement.pageCount = replacementPages.length;
    const pageProgress = [];
    replacement.subscribePagePreparationProgress = listener => {
      listener(null); pageProgress.push('subscribed');
      return () => pageProgress.push('unsubscribed');
    };
    replacement.getPages = async ({ signal }) => {
      assert.equal(signal, host.sourceLoadController.signal);
      assert.equal(host.currentPdfObject, previous, "Arrange replacement pages before installing the replacement");
      return replacementPages;
    };
    replacement.resetLayerVisibility = async () => {
      assert.equal(host.currentPdfObject, previous, "Restore target PDF defaults before installing the replacement");
      layerResets++;
    };
    replacement.setLayerVisibilities = async changes => {
      assert.equal(JSON.stringify(changes), JSON.stringify([{ id: "hidden", visible: true }]));
      assert.equal(host.currentPdfObject, previous, "prepare layer state before installing replacement");
      assert.equal(layerResets, 1, "Replay nondefault choices after restoring the PDF defaults");
      layerReplays++;
      if (failure === "layers") throw new Error("Layer replay failed");
    };
    let sceneResets = 0;
    let stateReplays = 0;
    let reservationReleased = 0;
    let reservationTaken = 0;
    const reservation = {
      take: () => { reservationTaken++; },
      release: () => { reservationReleased++; }
    };
    Object.assign(host, {
      lastLoadedSource: "original.pdf", lastDownloadablePdf: { label: "original.pdf" },
      lastNativeDrawStats: null, activeThreeRendererBackend: "webgl", lastLoadTimingText: "",
      readThreeObjectOptions: () => ({ vectorLod: "auto", textLod: "auto", ocrTextOnly: reparseSource }),
      captureCameraSnapshot: () => ({}), restoreCameraSnapshot: noop,
      resetVectorStrokeLodBuildTiming: noop, consumeVectorStrokeLodBuildTiming: () => timing,
      hasStoredVectorStrokeLod: () => false,
      reserveVectorStrokeLodRuntime: async (sceneData) => {
        assert.equal(reparseSource, false, "A changed viewing mode prepares only the new scene's LOD");
        assert.equal(sceneData, canonicalScene);
        return reservation;
      },
      prebuildTextLod: async (sceneData) => assert.equal(sceneData, canonicalScene),
      pdfObjectGenerator: async (bytes, options, backend) => {
        assert.equal(reparseSource, true, "Backend-only switches reuse the parsed scene");
        assert.equal(bytes, previous.sourceBytes);
        assert.equal(options.ocrTextOnly, true);
        assert.equal(options.password, "fixture-password");
        assert.equal(backend, targetBackend);
        replacement.sourceOptions = { ocrTextOnly: true };
        return replacement;
      },
      createThreePdfObject: async (loadedScene, options, signal, prepared) => {
        assert.equal(prepared, reservation);
        prepared.take();
        assert.equal(loadedScene.scene, canonicalScene);
        assert.equal(loadedScene.sourceLabel, previous.sourceLabel);
        assert.equal(loadedScene.sourceKind, previous.sourceKind);
        assert.equal(loadedScene.sourceBytes, previous.sourceBytes);
        assert.equal(loadedScene.sourceOptions, previous.sourceOptions);
        assert.equal(options.rendererType, targetBackend);
        signal.throwIfAborted();
        return replacement;
      },
      ensureThreeRendererBackend: async (backend, options) => {
        assert.equal(options.disposeCurrentPdfObject, false);
        backendChanges.push(backend);
        if (failRenderer) throw new Error("Backend unavailable");
        host.activeThreeRendererBackend = backend;
      },
      layerControls: {
        prepareReplacement: async (target, signal) => {
          assert.equal(target, replacement);
          assert.equal(host.currentPdfObject, previous);
          assert.equal(previous.disposals, 0);
          assert.equal(target.sceneData, previous.sceneData);
          assert.equal(signal, host.sourceLoadController.signal);
          signal.throwIfAborted();
          await target.resetLayerVisibility();
          const changes = previous.getLayers().filter(layer => layer.visible !== layer.defaultVisible)
            .map(({ id, visible }) => ({ id, visible }));
          if (changes.length) await target.setLayerVisibilities(changes);
        },
        objectChanged: () => {
          assert.equal(host.currentPdfObject, replacement);
          assert.equal(previous.disposals, 0, "Rebind the layer panel before disposing the previous PDF object");
          layerBindings++;
        }
      },
      drawingSelection: {
        sceneChanged: () => { sceneResets += 1; },
        rendererChanged: () => {
          assert.equal(host.currentPdfObject, replacement);
          assert.equal(previous.disposals, 0, "Detach/replay interaction state before disposing the old object");
          stateReplays += 1;
        }
      },
      renderer: { domElement: { getBoundingClientRect: () => ({}) } },
      scene: { add: noop, remove: noop }, textSearchInputElement: { value: "" },
      resetFpsMeter: noop, refreshDropIndicator: noop, updateCameraClipping: noop,
      updateDrawStatsMeter: noop, updateLodStatsMeter: noop, refreshSearchAvailability: noop,
      updateLoadingProgress: noop, setLoadingProgress: noop, setLoadControlsEnabled: noop,
      setDownloadDataButtonState: noop, setDownloadPdfButtonState: noop,
      waitForNextRenderedFrame: async () => {}, formatLoadTiming: () => "timing",
      updateSceneMetrics: noop, formatBackendLabel: value => value,
      activePageLayout: "sphere", pageLayoutView: previousPageLayout, pageLayoutRequest: 0,
      pageLayoutAnimator: { cancel: noop }, pageLayoutRowElement: { hidden: true }, pageLayoutButtons: [],
      setPageLayoutProgress: noop,
      createPageLayoutView: (object, pages) => ({ object, pages, layoutPages: [], layout: "grid", targets: [] }),
      computeExamplePageLayout: layout => [`${layout} targets`],
      applyExamplePageLayout: (pages, targets) => {
        assert.equal(host.currentPdfObject, previous);
        arrangedPages.push({ pages, targets });
      }
    });
    vm.createContext(host);
    for (const name of [
      "reloadSourceWithBackend", "replacePdfObject", "releasePdfObject", "disposeCurrentObject",
      "preparePageLayoutReplacement", "resetPageLayout", "syncPageLayoutControls"
    ]) {
      vm.runInContext(sourceFunction(source, name), host);
    }
    await host.reloadSourceWithBackend(targetBackend, reparseSource);
    assert.equal(reservationTaken, reparseSource ? 0 : 1, "Backend construction receives its prepared runtime");
    assert.equal(reservationReleased, reparseSource ? 0 : 1, "The reservation is always finalized");
    assert.equal(layerResets, failRenderer ? 0 : 1);
    assert.equal(layerReplays, failRenderer ? 0 : 1, "Replay current PDF layer choices only after the target renderer is ready");
    assert.equal(layerBindings, failed ? 0 : 1, "Only a successfully prepared replacement becomes the panel's current object");
    assert.equal(sceneResets, 0, "Same-scene renderer replacements must retain selection and colors");
    assert.equal(stateReplays, failed ? 0 : 1);
    assert.equal(host.currentPdfObject, failed ? previous : replacement);
    assert.equal(previous.disposals, failed ? 0 : 1);
    assert.equal(replacement.disposals, failed ? 1 : 0);
    assert.deepEqual(backendChanges, failure === "layers" ? ["webgpu", "webgl"] : [targetBackend]);
    assert.equal(host.activeThreeRendererBackend, failed ? "webgl" : targetBackend, "A layer replay failure rolls the renderer back with the old document intact");
    assert.equal(host.activePageLayout, "sphere", "Backend switches keep the page layout");
    assert.equal(host.pageLayoutView.object, failed ? previous : replacement);
    assert.equal(host.pageLayoutView.layout, "sphere");
    assert.deepEqual(arrangedPages, failed ? [] : [{ pages: replacementPages, targets: ["sphere targets"] }]);
    assert.equal(host.pageLayoutRowElement.hidden, failed, "Multi-page replacements show the page layout controls");
    assert.deepEqual(pageProgress, failed ? [] : ['subscribed', 'unsubscribed'], "Replacement page preparation reports progress until it settles");
  }
}

function demoHost() {
  return {
    performance, AbortController, waitForLoad,
    annotationOverlay: { sceneChanged: noop }, annotationControls: { sceneChanged: noop },
    currentPdfObject: demoObject("A"), loadToken: 0, sourceLoadController: null,
    setStatus: noop, clearLoadedStatus: noop, requestRender: noop,
    drawCallMeter: { reset: noop }, drawCallCounter: { recordNativeFrame: noop },
    backendSelectElement: {}, vectorLodSelectElement: {}, textLodSelectElement: {}
  };
}
function demoObject(id) {
  return {
    addEventListener: noop, pausePageLoading: noop, resumePageLoading: noop,
    id, sourceLabel: id, sourceKind: "pdf", disposals: 0,
    renderer: { setInteractionViewportProvider: noop },
    setFrameListener: noop,
    dispose() { this.disposals += 1; }
  };
}
