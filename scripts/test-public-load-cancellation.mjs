import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import vm from "node:vm";
import { HepArchive } from "../src/hepContainer.ts";
import { waitForLoad, yieldForLoad } from "../src/loadCancellation.ts";
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

  for (const pdfFastPath of ["auto", "off"]) {
    const controller = new AbortController();
    let reachedWorker = false;
    await assert.rejects(loadPdfSceneFromSource(bytes, {
      signal: controller.signal, pdfFastPath,
      onProgress: (event) => {
        if (event.executionPath && !controller.signal.aborted) {
          reachedWorker = true;
          controller.abort(reason);
        }
      }
    }), (error) => error === reason);
    assert.equal(reachedWorker, true, `${pdfFastPath} must exercise parser cancellation`);
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
  for (const stage of ["before", "source", "vector-lod", "text-lod", "upload", "create", "complete", "success"]) {
    const controller = new AbortController();
    let created = 0;
    let disposed = 0;
    const object = { dispose: () => { disposed += 1; } };
    const context = vm.createContext({
      createLoadProgressReporter, yieldForLoad,
      loadPdfSceneFromSource: async (_source, options) => {
        assert.equal(options.signal, controller.signal);
        options.onProgress({ stage: "source", value: 1 });
        return { scene: {}, sourceKind: "pdf" };
      },
      prebuildVectorStrokeLodRuntime: async (_scene, _mode, _backend, options) => {
        if (options.shouldCancel()) throw new Error("vector scheduler cancelled");
      },
      prebuildTextLod: async (_scene, options) => {
        assert.equal(options.signal, controller.signal);
        if (options.signal.aborted) throw new Error("text scheduler cancelled");
      },
      createThreePdfObject: async (_scene, _options, signal) => {
        assert.equal(signal, controller.signal);
        created += 1;
        if (stage === "create") controller.abort(reason);
        return object;
      },
      LOAD_PROGRESS_SCENE_END: 0.34, LOAD_PROGRESS_VECTOR_LOD_START: 0.38,
      LOAD_PROGRESS_VECTOR_LOD_END: 0.66, LOAD_PROGRESS_TEXT_LOD_START: 0.66,
      LOAD_PROGRESS_TEXT_LOD_END: 0.96, LOAD_PROGRESS_UPLOAD: 0.98
    });
    vm.runInContext(sourceFunction(source, "pdfObjectGenerator"), context);
    if (stage === "before") controller.abort(reason);
    const pending = context.pdfObjectGenerator(bytesForTest(), {
      signal: controller.signal,
      onProgress: (event) => { if (event.stage === stage) controller.abort(reason); }
    });
    if (stage === "success") {
      assert.equal(await pending, object);
      assert.equal(disposed, 0);
    } else {
      await assert.rejects(pending, (error) => error === reason, stage);
      assert.equal(disposed, created, `${stage}: every provisional object must be disposed`);
      if (!["create", "complete"].includes(stage)) assert.equal(created, 0, stage);
    }
  }
}

async function testLateRendererCleanup(reason) {
  const source = await readFile(new URL("../src/threePdfObject.ts", import.meta.url), "utf8");
  const controller = new AbortController();
  let finishRenderer;
  let disposed = 0;
  const context = vm.createContext({
    waitForLoad, document: { createElement: () => ({}) },
    normalizeBounds: (bounds) => bounds,
    resolveSceneFitBounds: () => ({ minX: 0, minY: 0, maxX: 10, maxY: 10 }),
    computeInitialCanvasSize: () => ({ width: 10, height: 10 }),
    normalizeRendererConfig: () => ({}), shouldUseVectorStrokeLod: () => false,
    DEFAULT_FIT_PADDING_PIXELS: 10,
    createNativeRenderer: () => new Promise((resolve) => { finishRenderer = resolve; })
  });
  vm.runInContext(sourceFunction(source, "createThreePdfObject"), context);
  const pending = context.createThreePdfObject({ scene: {} }, {}, controller.signal);
  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
  finishRenderer({ dispose: () => { disposed += 1; } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(disposed, 1, "a renderer resolving after cancellation must release its resources");
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
