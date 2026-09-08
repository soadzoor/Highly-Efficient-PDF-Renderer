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
let nextParse = async (buffer) => [scene(new Uint8Array(buffer)[0])];
let failUpload = null;
let uploadedScene = null;
let view = { cameraCenterX: 0, cameraCenterY: 0, zoom: 1 };
const context = vm.createContext({
  performance, AbortController, Uint8Array, console: { log: noop, warn: noop },
  waitForLoad, createLoadProgressReporter,
  loadToken: 0, activeSceneLoadToken: null, pendingSourceLoadCount: 0, sourceLoadSerial: 0,
  sourceLoadController: null, activeHepExportController: null,
  lastLoadedSource: null, lastDownloadablePdf: null, lastParsedScene: null,
  lastParsedSceneLabel: null, parsedPdfPageCache: null,
  exampleManifestEntries: [], exampleSelectionMap: new Map(),
  exampleDropdown: { setDisabled: noop },
  statusTextElement: { textContent: "", hidden: true }, baseStatus: "",
  runtimeTextElement: {}, backendSelectElement: {},
  cancelActiveHepExport: noop,
  cloneSourceBytes: (buffer) => new Uint8Array(buffer).slice(),
  createParseBuffer: (bytes) => bytes.slice().buffer,
  setStatus: (message) => statuses.push(message), clearLoadedStatus: noop,
  setDownloadPdfButtonState: noop, setDownloadDataButtonState: noop,
  setDownloadAllDataButtonState: noop, setPrimaryLoadControlsEnabled: noop,
  setParsingLoader: noop, setMetricPlaceholder: noop, updateParsingLoaderProgress: noop,
  logSegmentMergeStats: noop, logInvisibleCullStats: noop, logTextVectorStats: noop,
  logTextureSizeStats: noop, applyTextSearchScene: noop, refreshDropIndicator: noop,
  updateMetricsPanel: noop,
  extractPdfPageScenes: (buffer, options, signal) => nextParse(buffer, options, signal),
  loadSceneFromHep: async (buffer, options) => (await nextParse(buffer, {}, options.signal))[0],
  tryReadSourcePdfBytesFromExistingHep: async () => null,
  computeAutoPagesPerRow: () => 1,
  composeVectorScenesInGrid: (pages) => pages[0],
  prepareSceneForHepRendering: (value) => value,
  listSceneRasterLayers: () => [], resolveSceneFitBounds: () => ({}),
  prebuildVectorLodForScene: async () => timing, prebuildTextLodForScene: async () => {},
  consumeVectorStrokeLodBuildTiming: () => timing, combineVectorLodTimings: () => timing,
  yieldToBrowserPaint: async () => {}, sanitizeDownloadName: (label) => label,
  triggerBrowserDownload: noop, formatFileSize: String,
  buildHep: async (value, options) => {
    exports.push({ scene: value, source: options.sourcePdf, label: options.sourceLabel });
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
  "isCurrentSourceLoad", "beginSceneLoad", "finishSceneLoad", "updateBackendSelectDisabledState", "downloadHep"
]) vm.runInContext(sourceFunction(source, name), context);

await context.loadPdfFile(file("A.pdf", 65));
assertDocument(65, "A.pdf");
const originalCache = context.parsedPdfPageCache;
await assertExport(65, "A.pdf");

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
await testThreeDocumentReplacement();
await testRoomDocumentReplacement();
console.log("Document replacement, export ownership, upload rollback, and superseded-load cancellation passed.");

function file(name, id) {
  return { name, arrayBuffer: async () => Uint8Array.of(id).buffer };
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
  assert.equal(await context.downloadHep(), true);
  assert.equal(exports.at(-1).scene.id, id);
  assert.equal(exports.at(-1).source[0], id);
  assert.equal(exports.at(-1).label, label);
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
  Object.assign(host, {
    currentPdfCoordinateTransform: { id: "A" }, currentGeneratedTsv: null, pdfValue: {},
    isHepFile: () => false, setBusy: noop, syncControlsEnabled: noop,
    updatePdfLoadProgress: noop, fitCameraToObject: noop, scene: { add: noop },
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
    },
    clearCurrentPdfObject: () => {
      host.currentPdfObject.dispose();
      host.currentPdfObject = null;
    }
  });
  vm.createContext(host);
  vm.runInContext(sourceFunction(source, "loadSceneSource"), host);
  const previous = host.currentPdfObject;
  assert.equal(await host.loadSceneSource({ name: "B" }), false);
  assert.equal(host.currentPdfObject, previous);
  assert.equal(host.currentPdfCoordinateTransform.id, "A");
  assert.equal(objects.get("B").disposals, 1);
  assert.equal(previous.disposals, 0);
  assert.equal(await host.loadSceneSource({ name: "C" }), true);
  assert.equal(host.currentPdfObject.id, "C");
  assert.equal(host.currentPdfCoordinateTransform.id, "C");
  assert.equal(previous.disposals, 1);
  assert.equal(objects.get("C").disposals, 0);
}

function demoHost() {
  return {
    performance, AbortController, waitForLoad,
    currentPdfObject: demoObject("A"), loadToken: 0, sourceLoadController: null,
    setStatus: noop, clearLoadedStatus: noop, requestRender: noop,
    backendSelectElement: {}, vectorLodSelectElement: {}, textLodSelectElement: {}
  };
}
function demoObject(id) {
  return {
    id, sourceLabel: id, sourceKind: "pdf", disposals: 0,
    renderer: { setInteractionViewportProvider: noop },
    dispose() { this.disposals += 1; }
  };
}
