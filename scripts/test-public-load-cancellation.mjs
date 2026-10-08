import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import vm from "node:vm";
import { HepArchive } from "./lib/hepContainer.mjs";
import { createLoadYielder, waitForLoad, yieldForLoad } from "../src/loadCancellation.ts";
import { createLoadProgressReporter } from "../src/loadProgress.ts";
import { sourceFunction } from "./lib/sourceFunction.mjs";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });
try {
  const { loadPdfSceneFromSource } = await import("../src/pdfObjectGenerator.ts");
  const bytes = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "0 0 m 10 10 l S") }
  ] });
  const reason = new Error("cancelled by host");
  const aborted = new AbortController();
  aborted.abort(reason);
  let read = false;
  await assert.rejects(loadPdfSceneFromSource(new Blob([bytes]), {
    signal: aborted.signal,
    onProgress: () => { read = true; }
  }), (error) => error === reason);
  assert.equal(read, false);

  const originalFetch = globalThis.fetch;
  try {
    const controller = new AbortController();
    let fetchedSignal;
    globalThis.fetch = (_url, options) => {
      fetchedSignal = options.signal;
      return waitForLoad(new Promise(() => {}), options.signal);
    };
    const pending = loadPdfSceneFromSource("https://fixture.invalid/slow.pdf", { signal: controller.signal });
    assert.equal(fetchedSignal, controller.signal);
    controller.abort(reason);
    await assert.rejects(pending, (error) => error === reason);
  } finally {
    globalThis.fetch = originalFetch;
  }

  {
    const controller = new AbortController();
    let reachedWorker = false;
    await assert.rejects(loadPdfSceneFromSource(bytes, {
      signal: controller.signal,
      onProgress: (event) => {
        if (event.executionPath && !controller.signal.aborted) {
          reachedWorker = true;
          controller.abort(reason);
        }
      }
    }), (error) => error === reason);
    assert.equal(reachedWorker, true, "loading must exercise parser cancellation");
  }

  // An original, tiny archive fixture; no PDF conversion or corpus files.
  const zip = new HepArchive();
  zip.file("manifest.json", JSON.stringify({ formatVersion: 6, scene: {}, textures: [] }));
  const archive = await zip.generateAsync({ type: "uint8array" });
  const archiveController = new AbortController();
  await assert.rejects(loadPdfSceneFromSource(archive, {
    signal: archiveController.signal,
    onProgress: (event) => {
      if (event.stage === "hep-manifest") archiveController.abort(reason);
    }
  }), (error) => error === reason);

  await testPublicPipeline(reason);
  await testLateRendererCleanup(reason);
  await testConsumedReservationCleanup();
  await testCancelledFrame(reason);
  // The helper must drain a rejection even if given an already-aborted signal.
  await assert.rejects(waitForLoad(Promise.reject(new Error("late host error")), aborted.signal),
    (error) => error === reason);
  console.log("Public load cancellation passed: reads, both parser routes, HEP, LOD, upload, and late renderer cleanup.");
} finally {
  hooks.deregister();
}

async function testPublicPipeline(reason) {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  const stages = ["before", "source", "vector-lod", "text-lod", "upload", "create", "complete", "success"];
  const sources = [{ sourceKind: "pdf" }, { sourceKind: "scene" },
    { sourceKind: "hep", storedLod: false }, { sourceKind: "hep", storedLod: true }];
  const cases = sources.flatMap(source => stages.map(stage => ({ ...source, stage })));
  for (const { sourceKind, storedLod, stage } of cases) {
    if (sourceKind === "scene" && stage === "source") continue;
    const vectorLodStage = storedLod ? "vector-lod-restore" : "vector-lod";
    const events = [];
    const controller = new AbortController();
    let created = 0;
    let disposed = 0;
    let reserved = 0;
    let reservationConsumed = 0;
    let reservationReleased = 0;
    let reservationOwned = false;
    const reservation = {
      take() { assert(reservationOwned); reservationOwned = false; reservationConsumed++; },
      release() { if (reservationOwned) { reservationOwned = false; reservationReleased++; } }
    };
    const object = { dispose: () => { disposed += 1; } };
    const context = vm.createContext({
      createLoadProgressReporter, yieldForLoad,
      loadPdfSceneFromSource: async (_source, options) => {
        assert.notEqual(sourceKind, "scene", "compiled scenes must bypass source loading");
        assert.equal(options.signal, controller.signal);
        options.onProgress({ stage: "source", value: 1 });
        return { scene: {}, sourceKind };
      },
      hasStoredVectorStrokeLod: () => storedLod === true,
      reserveVectorStrokeLodRuntime: async (_scene, _mode, _backend, options) => {
        if (options.shouldCancel()) throw new Error("vector scheduler cancelled");
        reserved++;
        reservationOwned = true;
        return reservation;
      },
      prebuildTextLod: async (_scene, options) => {
        assert.equal(options.signal, controller.signal);
        if (options.signal.aborted) throw new Error("text scheduler cancelled");
      },
      createThreePdfObjectFromLoadedScene: async (loaded, options, signal, prepared) => {
        assert.equal(prepared, reservation);
        prepared.take();
        assert.equal(signal, controller.signal);
        assert.equal(loaded.sourceKind, sourceKind);
        if (sourceKind === "scene") {
          assert.equal(loaded.sourceLabel, "Host strokes");
          assert.equal(options.pageBackgroundOpacity, 0);
        }
        created += 1;
        if (stage === "create") controller.abort(reason);
        return object;
      },
      LOAD_PROGRESS_SCENE_END: 0.34, LOAD_PROGRESS_VECTOR_LOD_START: 0.38,
      LOAD_PROGRESS_VECTOR_LOD_END: 0.66, LOAD_PROGRESS_TEXT_LOD_START: 0.66,
      LOAD_PROGRESS_TEXT_LOD_END: 0.96, LOAD_PROGRESS_UPLOAD: 0.98
    });
    vm.runInContext(sourceFunction(source, "prepareThreePdfObject"), context);
    vm.runInContext(sourceFunction(source, "createThreePdfObject"), context);
    vm.runInContext(sourceFunction(source, "pdfObjectGenerator"), context);
    if (stage === "before") controller.abort(reason);
    const factory = sourceKind === "scene" ? context.createThreePdfObject : context.pdfObjectGenerator;
    const pending = factory(sourceKind === "scene" ? {} : bytesForTest(), {
      sourceLabel: "Host strokes",
      signal: controller.signal,
      onProgress: (event) => {
        events.push(event);
        if (event.stage !== "source") assert.equal(event.sourceType, sourceKind);
        if (event.stage === (stage === "vector-lod" ? vectorLodStage : stage)) controller.abort(reason);
      }
    });
    if (stage === "success") {
      assert.equal(await pending, object);
      assert.equal(disposed, 0);
      assert(events.some(event => event.stage === vectorLodStage));
      assert(!events.some(event => event.stage === (storedLod ? "vector-lod" : "vector-lod-restore")),
        "stored LOD reports restoration; a missing hierarchy reports building");
    } else {
      await assert.rejects(pending, (error) => error === reason, stage);
      assert.equal(disposed, created, `${stage}: every provisional object must be disposed`);
      if (!["create", "complete"].includes(stage)) assert.equal(created, 0, stage);
    }
    assert.equal(reservationConsumed, created);
    assert.equal(reservationConsumed + reservationReleased, reserved,
      `${stage}: every reservation is consumed or released`);
    assert.equal(reservationOwned, false);
  }
}

async function testLateRendererCleanup(reason) {
  const source = await readFile(new URL("../src/threePdfObject.ts", import.meta.url), "utf8");
  const controller = new AbortController();
  let finishRenderer;
  let enteredRenderer;
  const rendererStarted = new Promise(resolve => { enteredRenderer = resolve; });
  let disposed = 0;
  const context = vm.createContext({
    createLoadYielder, waitForLoad, document: { createElement: () => ({}) },
    normalizeBounds: (bounds) => bounds,
    resolveSceneFitBounds: () => ({ minX: 0, minY: 0, maxX: 10, maxY: 10 }),
    computeInitialCanvasSize: () => ({ width: 10, height: 10 }),
    normalizeRendererConfig: () => ({}), shouldUseVectorStrokeLod: () => false,
    DEFAULT_FIT_PADDING_PIXELS: 10,
    createNativeRenderer: () => new Promise((resolve) => { finishRenderer = resolve; enteredRenderer(); })
  });
  vm.runInContext(sourceFunction(source, "createThreePdfContent"), context);
  vm.runInContext(sourceFunction(source, "createThreePdfObject"), context);
  const pending = context.createThreePdfObject({ scene: {} }, {}, controller.signal);
  await rendererStarted;
  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
  finishRenderer({ dispose: () => { disposed += 1; } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(disposed, 1, "a renderer resolving after cancellation must release its resources");
}

async function testConsumedReservationCleanup() {
  const source = await readFile(new URL("../src/threePdfObject.ts", import.meta.url), "utf8");
  const scene = {};
  const failure = new Error("text layer initialization failed");
  let owned = true;
  let layerDisposals = 0;
  let rendererDisposals = 0;
  const reservation = {
    take(ownerScene) { assert.equal(ownerScene, scene); assert(owned); owned = false; },
    release() { assert.equal(owned, false, "the layer already consumed this reservation"); }
  };
  const context = vm.createContext({
    createLoadYielder, waitForLoad, document: { createElement: () => ({}) },
    normalizeBounds: bounds => bounds,
    resolveSceneFitBounds: () => ({ minX: 0, minY: 0, maxX: 10, maxY: 10 }),
    computeInitialCanvasSize: () => ({ width: 10, height: 10 }),
    normalizeRendererConfig: () => ({}), shouldUseVectorStrokeLod: () => true,
    DEFAULT_FIT_PADDING_PIXELS: 10,
    createNativeRenderer: async () => ({ dispose: () => { rendererDisposals++; } }),
    applyRendererConfig() {}, deferRendererSceneUpload() {}, applyThreePdfOverlayPaintOrder() {},
    ThreeMaterialRasterLayer: class {}, ThreeMaterialFillLayer: class {},
    ThreeMaterialGradientLayer: class { getOrderedPaintMeshes() { return []; } },
    ThreeVectorLodStrokeLayer: class {
      constructor(ownerScene, _options, prepared) {
        assert.equal(prepared, reservation);
        prepared.take(ownerScene);
      }
      dispose() { layerDisposals++; }
    },
    sceneRequiresPaintCompositing: () => false,
    ThreeTextLodLayer: { create() { throw failure; } }
  });
  vm.runInContext(sourceFunction(source, "createThreePdfContent"), context);
  vm.runInContext(sourceFunction(source, "createThreePdfObject"), context);
  await assert.rejects(context.createThreePdfObject({ scene }, {}, undefined, reservation),
    error => error === failure);
  reservation.release();
  assert.equal(layerDisposals, 1, "initialization failure disposes the runtime's new owner");
  assert.equal(rendererDisposals, 1);
}

async function testCancelledFrame(reason) {
  const previousRequest = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  const controller = new AbortController();
  let cancelled = 0;
  try {
    globalThis.requestAnimationFrame = () => 123; // A background tab never delivers this frame.
    globalThis.cancelAnimationFrame = (id) => { assert.equal(id, 123); cancelled += 1; };
    const pending = yieldForLoad(controller.signal);
    controller.abort(reason);
    await assert.rejects(pending, (error) => error === reason);
    assert.equal(cancelled, 1);
  } finally {
    if (previousRequest) globalThis.requestAnimationFrame = previousRequest;
    else delete globalThis.requestAnimationFrame;
    if (previousCancel) globalThis.cancelAnimationFrame = previousCancel;
    else delete globalThis.cancelAnimationFrame;
  }
}

function bytesForTest() { return Uint8Array.of(1); }
