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
// The export dialog's default: Download with no LOD checked. null is Cancel.
let hepLodChoice = {};
const context = vm.createContext({
  performance, AbortController, Uint8Array, console: { log: noop, warn: noop },
  waitForLoad, createLoadProgressReporter,
  loadToken: 0, activeSceneLoadToken: null, pendingSourceLoadCount: 0, sourceLoadSerial: 0,
  sourceLoadController: null, activeHepExportController: null,
  activePdfPageLoader: null, demandPdfUpdatePending: false,
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
  scheduleDemandPdfUpdate: noop, textSearchWidget: { setAvailability: noop },
  openPdfPageDemand: async () => ({ pageCount: 1, close: async () => {} }),
  extractPdfPageScenes: (buffer, options, signal) => nextParse(buffer, options, signal),
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
  promptForHepLod: async () => hepLodChoice,
  triggerBrowserDownload: noop, formatFileSize: String,
  buildHep: async (value, options) => {
    exports.push({ scene: value, label: options.sourceLabel });
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
// A page window exports the original document, never just its currently cached pages.
let demandClosed = false, demandPaused = false;
const demand = { pageCount: 17, pageScenes: [{ ...scene(73), segmentCount: 0 }], password: "secret",
  pause() { demandPaused = true; }, resume() { demandPaused = false; }, async close() { demandClosed = true; } };
context.openPdfPageDemand = async () => demand;
await context.loadPdfFile(file("paged.pdf", 73));
assertDocument(73, "paged.pdf");
assert.equal(context.activePdfPageLoader, demand);
assert.equal(context.parsedPdfPageCache, null, "partial windows are not mistaken for complete parsed documents");
assert.equal(await context.downloadHep(), true);
assert.equal(exports.at(-1).scene[0], 73, "paged export supplies complete source bytes to the shared builder");
assert.equal(demandPaused, false, "export resumes demand-driven loading");
await context.loadHepFile(file("replacement.hep", 74));
assert.equal(context.activePdfPageLoader, null);
assert.equal(demandClosed, true, "document replacement closes the paging worker");
await testThreeDocumentReplacement();
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
  assert.equal(exports.at(-1).source, undefined, "v7 exports the complete scene without embedding its source PDF");
  assert.equal(exports.at(-1).label, label);
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
  for (const failure of ["none", "renderer", "layers"]) {
    const failRenderer = failure === "renderer";
    const failed = failure !== "none";
    const host = demoHost();
    const canonicalScene = scene("same artifact");
    const previous = host.currentPdfObject;
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
      readThreeObjectOptions: () => ({ vectorLod: "auto", textLod: "auto" }),
      captureCameraSnapshot: () => ({}), restoreCameraSnapshot: noop,
      resetVectorStrokeLodBuildTiming: noop, consumeVectorStrokeLodBuildTiming: () => timing,
      hasStoredVectorStrokeLod: () => false,
      reserveVectorStrokeLodRuntime: async (sceneData) => {
        assert.equal(sceneData, canonicalScene);
        return reservation;
      },
      prebuildTextLod: async (sceneData) => assert.equal(sceneData, canonicalScene),
      pdfObjectGenerator: () => assert.fail("Backend switches must reuse the parsed scene"),
      createThreePdfObject: async (loadedScene, options, signal, prepared) => {
        assert.equal(prepared, reservation);
        prepared.take();
        assert.equal(loadedScene.scene, canonicalScene);
        assert.equal(loadedScene.sourceLabel, previous.sourceLabel);
        assert.equal(loadedScene.sourceKind, previous.sourceKind);
        assert.equal(options.rendererType, "webgpu");
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
    await host.reloadSourceWithBackend("webgpu");
    assert.equal(reservationTaken, 1, "Backend construction receives its prepared runtime");
    assert.equal(reservationReleased, 1, "The reservation is always finalized");
    assert.equal(layerResets, failRenderer ? 0 : 1);
    assert.equal(layerReplays, failRenderer ? 0 : 1, "Replay current PDF layer choices only after the target renderer is ready");
    assert.equal(layerBindings, failed ? 0 : 1, "Only a successfully prepared replacement becomes the panel's current object");
    assert.equal(sceneResets, 0, "Same-scene renderer replacements must retain selection and colors");
    assert.equal(stateReplays, failed ? 0 : 1);
    assert.equal(host.currentPdfObject, failed ? previous : replacement);
    assert.equal(previous.disposals, failed ? 0 : 1);
    assert.equal(replacement.disposals, failed ? 1 : 0);
    assert.deepEqual(backendChanges, failure === "layers" ? ["webgpu", "webgl"] : ["webgpu"]);
    assert.equal(host.activeThreeRendererBackend, failed ? "webgl" : "webgpu", "A layer replay failure rolls the renderer back with the old document intact");
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
