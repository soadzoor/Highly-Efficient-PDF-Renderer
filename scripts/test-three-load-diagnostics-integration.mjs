import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { ViewerLoadDiagnostics, VIEWER_LOAD_DIAGNOSTICS_STORAGE_KEY } from "../src/viewerLoadDiagnostics.ts";
import { sourceFunction } from "./lib/sourceFunction.mjs";

const source = await readFile(new URL("../src/three-example.ts", import.meta.url), "utf8");
const uiSource = await readFile(new URL("../src/threeExampleLoadDiagnostics.ts", import.meta.url), "utf8");
const noop = () => {};

class Control {
  listeners = new Map();
  checked = false;
  value = "";
  hidden = true;
  textContent = "";
  addEventListener(type, listener, options = {}) {
    if (options.signal?.aborted) return;
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    options.signal?.addEventListener("abort", () => this.listeners.get(type)?.delete(listener), { once: true });
  }
  dispatch(type) { for (const listener of this.listeners.get(type) ?? []) listener({ type }); }
  focus() {}
  select() {}
  setSelectionRange() {}
}

function fixture(layout, backend) {
  const controls = Object.fromEntries(["load-diagnostics-enabled", "show-load-report", "copy-load-report",
    "load-diagnostics-report", "load-diagnostics-status"].map(id => [id, new Control()]));
  const saved = new Map();
  const events = [];
  const statuses = [];
  const lifetime = new AbortController();
  let pagePreparations = 0;
  const renderer = {
    info: { memory: { geometries: 1, textures: 0 }, programs: [] },
    coordinateSystem: 2000, render: noop, dispose: noop
  };
  const cameraPart = { copy: noop };
  const context = vm.createContext({
    performance, AbortController, URLSearchParams, console: { warn: noop }, ViewerLoadDiagnostics,
    document: { querySelector: selector => controls[selector.slice(1)] },
    window: Object.assign(new Control(), {
      location: { search: layout === "grid" ? "?initialLayout=grid" : "" }, devicePixelRatio: 1,
      sessionStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }
    }),
    navigator: { userAgent: "integration-test", hardwareConcurrency: 4 },
    describeThreePerformanceScene: scene => ({ pages: scene.pageCount }),
    describeThreeLoadMemory: () => ({ objectNodes: 1, cpuBytes: 0 }),
    loadToken: 0, sourceLoadController: null, currentPdfObject: null, lastLoadedSource: null,
    lastDownloadablePdf: null, lastLoadTimingText: "", activePageLayout: layout,
    activeThreeRendererBackend: backend, canvasElement: { width: 800, height: 600 },
    backendSelectElement: {}, vectorLodSelectElement: {}, textLodSelectElement: {}, renderer,
    THREE: {
      REVISION: "test", WebGLCoordinateSystem: 2000, WebGPUCoordinateSystem: 2001,
      Scene: class { add() {} remove() {} }
    },
    camera: { clone: () => ({ position: cameraPart, quaternion: cameraPart, up: cameraPart,
      updateProjectionMatrix: noop, updateMatrixWorld: noop }) },
    readBackendMode: () => context.activeThreeRendererBackend,
    readThreeObjectOptions: () => ({ vectorLod: "auto", textLod: "auto" }),
    cancelActiveHepExport: noop, filenameFromUrl: value => value.split("/").at(-1),
    setStatus: message => statuses.push(message), clearLoadedStatus: noop,
    setLoadingProgress: noop, setLoadControlsEnabled: noop,
    setDownloadDataButtonState: noop, setDownloadPdfButtonState: noop,
    resetVectorStrokeLodBuildTiming: noop,
    consumeVectorStrokeLodBuildTiming: () => ({ elapsedMs: 0, buildCount: 0 }),
    isPdfPasswordError: () => false,
    resolveDownloadablePdfSource: async () => null,
    createPageLayoutView: (object, pages) => ({ object, pages, layoutPages: [], targets: [] }),
    computeExamplePageLayout: () => [], applyExamplePageLayout: noop,
    setPageLayoutProgress: noop, getInitialReaderView: () => ({}), applyReaderCameraView: noop,
    fitCameraToObject: noop, prepareThreeRendererFrame: noop,
    prepareThreeRendererBackend: async () => ({ renderer }),
    installThreeRendererBackend: () => { context.activeThreeRendererBackend = context.pendingBackend; },
    replacePdfObject: object => { context.currentPdfObject = object; },
    requestRender: noop, waitForNextRenderedFrame: async () => {},
    waitForLoad: async (promise, signal) => { const result = await promise; signal.throwIfAborted(); return result; },
    warmThreeRenderer: async () => {}, formatLoadTiming: () => "test timing", updateSceneMetrics: noop,
    captureCameraSnapshot: () => ({ position: {}, quaternion: {}, up: {} }), restoreCameraSnapshot: noop,
    reader: { snapshot: () => ({}), restore: noop, getView: () => ({}) },
    hasStoredVectorStrokeLod: () => false,
    reserveVectorStrokeLodRuntime: async (_scene, _mode, _backend, options) => {
      options.onProgress({ value: 1 });
      return { release: noop };
    },
    prebuildTextLod: async (_scene, options) => options.onProgress({ value: 1 }),
    layerControls: { prepareReplacement: async () => {} },
    preparePageLayoutReplacement: async () => null,
    formatBackendLabel: value => value, updateDrawStatsMeter: noop, updateLodStatsMeter: noop,
    formatLoadProgressStage: value => value
  });
  function object() {
    return {
      pageCount: 2, sourceLabel: "WarAndPeace.hep", sourceKind: "hep",
      sourceBytes: new Uint8Array([1]), sourceOptions: {}, sceneData: { pageCount: 2 },
      dispose: noop, compileForThreeRenderer: async () => {},
      subscribePagePreparationProgress: listener => { listener(0); return noop; },
      getPages: async () => { pagePreparations++; return [{}, {}]; }
    };
  }
  function assertCaptureStarted(kind) {
    events.push(kind);
    assert.equal(events[0], "begin", `${kind} must run after diagnostics.begin()`);
    assert.equal(context.loadDiagnostics.report().current?.status, "loading",
      `${kind} must run after the enabled UI starts the actual recorder`);
    assert(saved.has(VIEWER_LOAD_DIAGNOSTICS_STORAGE_KEY), "the start checkpoint is saved before generation");
  }
  context.pdfObjectGenerator = async (_source, options) => {
    assertCaptureStarted("generator");
    options.onProgress({ stage: "upload", value: 1 });
    return object();
  };
  context.createThreePdfObject = async () => { assertCaptureStarted("backend-object"); return object(); };
  for (const [text, name] of [[uiSource, "createThreeExampleLoadDiagnostics"],
    [source, "loadSource"], [source, "reloadSourceWithBackend"], [source, "updateLoadingProgress"]]) {
    vm.runInContext(sourceFunction(text, name), context);
  }
  const diagnostics = context.createThreeExampleLoadDiagnostics(lifetime.signal);
  context.loadDiagnostics = { ...diagnostics, begin(...args) {
    events.push("begin");
    diagnostics.begin(...args);
  } };
  // Exercise the checkbox path reported by the user, without a URL opt-in or a reload.
  controls["load-diagnostics-enabled"].checked = true;
  controls["load-diagnostics-enabled"].dispatch("change");
  return { context, controls, saved, events, statuses, lifetime, diagnostics,
    get pagePreparations() { return pagePreparations; } };
}

function assertComplete(test, operation, expectedProgress) {
  const report = test.diagnostics.report();
  assert.equal(report.current?.status, "complete", test.statuses.at(-1));
  assert.equal(report.current.context.operation, operation);
  assert.equal(report.current.context.document, "WarAndPeace.hep");
  const phases = report.current.events.map(event => event.phase);
  for (const phase of ["start", "object-ready", "reader-pages-ready", "shader-compile-start",
    "first-frame-ready", "warmup-ready", "complete", ...expectedProgress]) {
    assert(phases.includes(phase), `${operation} must route ${phase} to the actual recorder`);
  }
  assert(!test.statuses.some(message => /failed/i.test(message)), test.statuses.at(-1));
  test.controls["copy-load-report"].dispatch("click");
  const copied = JSON.parse(test.controls["load-diagnostics-report"].value);
  assert.equal(copied.current.status, "complete", "copying after the load includes the captured attempt");
  assert.equal(copied.current.id, report.current.id);
  assert.equal(JSON.parse(test.saved.get(VIEWER_LOAD_DIAGNOSTICS_STORAGE_KEY)).current.status, "complete");
}

for (const layout of ["reader", "grid"]) {
  for (const backend of ["webgl", "webgpu"]) {
    const test = fixture(layout, backend);
    try {
      test.context.pendingBackend = backend;
      await test.context.loadSource("examples/WarAndPeace.hep");
      assertComplete(test, "open", ["progress.upload", "progress.first-render"]);
      assert.equal(test.diagnostics.report().current.context.initialPageLayout, layout);
      assert.equal(test.pagePreparations, layout === "reader" ? 1 : 0,
        "both actual Reader preparation and the Grid bypass produce a complete report");

      test.events.length = 0;
      const nextBackend = backend === "webgl" ? "webgpu" : "webgl";
      test.context.pendingBackend = nextBackend;
      await test.context.reloadSourceWithBackend(nextBackend);
      assertComplete(test, "switch-backend", ["progress.vector-lod", "progress.text-lod", "progress.upload"]);
      assert.equal(test.diagnostics.report().previous.context.operation, "open");
      assert(test.events.includes("backend-object"), "backend-only switches exercise the canonical-scene factory");

      test.events.length = 0;
      await test.context.reloadSourceWithBackend(nextBackend, true);
      assertComplete(test, "reparse", ["progress.upload", "progress.first-render"]);
      assert.equal(test.diagnostics.report().previous.context.operation, "switch-backend");
      assert(test.events.includes("generator"), "reparsing exercises the source generator");
    } finally { test.lifetime.abort(); }
  }
}

console.log("Three load diagnostics integration: enabled UI records Reader/Grid opens, WebGL/WebGPU switches and source reparses before generation, through progress and completion, without a reload.");
