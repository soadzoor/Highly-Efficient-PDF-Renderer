import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { Worker as NodeWorker } from "node:worker_threads";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";
import { waitForLoad } from "../src/loadCancellation.ts";

const resolveHook = (specifier, context, nextResolve) => {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
};
const loadHook = (url, context, nextLoad) => {
  const result = nextLoad(url, context);
  if (result.format === "module-typescript") {
    return { ...result, format: "module", source: stripTypeScriptTypes(String(result.source), { mode: "transform" }) };
  }
  return result;
};
const hooks = registerHooks({ resolve: resolveHook, load: loadHook });
const originalWorker = globalThis.Worker;
const workers = [];

// Exercise the actual browser worker entry in a Node thread, with only the
// browser message transport adapted. No browser or development server is used.
class BrowserWorker extends EventTarget {
  constructor(url, options) {
    super();
    assert.equal(options.type, "module");
    const bootstrap = `
      import { parentPort } from 'node:worker_threads';
      import { registerHooks, stripTypeScriptTypes } from 'node:module';
      registerHooks({ resolve: ${resolveHook.toString()}, load: ${loadHook.toString()} });
      globalThis.addEventListener = (_type, listener) => parentPort.on('message', data => listener({ data }));
      globalThis.postMessage = message => parentPort.postMessage(message);
      await import(${JSON.stringify(url.href)});
    `;
    this.thread = new NodeWorker(new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`), {
      execArgv: ["--experimental-strip-types"]
    });
    this.thread.on("message", data => this.dispatchEvent(new MessageEvent("message", { data })));
    this.thread.on("error", error => this.dispatchEvent(Object.assign(new Event("error"), {
      error, message: error.message
    })));
    this.terminated = false;
    workers.push(this);
  }
  postMessage(message, transfer) {
    this.request = message;
    assert.equal(transfer, undefined, "the renderer's buffers must not be transferred away");
    this.thread.postMessage(message, transfer);
  }
  terminate() {
    this.terminated = true;
    this.termination ??= this.thread.terminate();
  }
}

try {
  globalThis.Worker = BrowserWorker;
  const { detectRooms } = await import(process.argv.includes("--package") ? "@soadzoor/hepr" : "../src/index.ts");
  assert.equal(workers.length, 0, "importing the public API must not start a worker");
  const { detectRooms: detectSync } = await import("../src/roomDetector.ts");
  const scene = rectangleScene();
  const options = {
    pageIndexes: [0], maxRasterSize: 256, minRoomAreaPixels: 10,
    maxRoomAreaFraction: 0.9, wallHalfWidthThreshold: 0.25, collectDebugInfo: true
  };
  const snapshot = scene.endpoints.slice();
  // Unrelated rendering payloads must never enter the structured clone.
  scene.rasterLayers = [{ data: new Uint8Array(1024), nonCloneable: () => {} }];
  const expected = detectSync(scene, options);
  assert.equal(expected.rooms.length, 1);
  const [first, concurrent] = await Promise.all([detectRooms(scene, options), detectRooms(scene, options)]);
  assert.deepEqual(first, expected, "worker polygons, labels, and debug Maps must match direct detection");
  assert.deepEqual(concurrent, first, "concurrent requests must remain independent");
  assert.deepEqual(scene.endpoints, snapshot, "rendering data must remain attached and unchanged");
  assert.ok(workers.every(worker => worker.terminated));
  assert.ok(workers.every(worker => !("rasterLayers" in worker.request.scene)));
  assert.deepEqual(await detectRooms(scene, options), first, "repeat detection must still work");

  // HEP sources use glyph instances and the searchable index instead of textContent.
  const hepScene = { ...scene, textContent: undefined, textIndex: {
    version: 2, pages: [{ text: "Office", charInstance: new Int32Array(6), fallbackQuads: new Float32Array() }]
  }, textInstanceA: Float32Array.of(1, 0, 0, 1), textInstanceB: Float32Array.of(40, 40, 0, 0),
  textGlyphMetaA: Float32Array.of(0, 0, 0, 0), textGlyphMetaB: Float32Array.of(8, 4, 0, 0) };
  const hepResult = await detectRooms(hepScene, options);
  assert.equal(hepResult.seedSource, "textIndex");
  assert.deepEqual(hepResult, detectSync(hepScene, options));

  const controller = new AbortController();
  const reason = new Error("document disposed");
  controller.abort(reason);
  const countBeforeAbort = workers.length;
  await assert.rejects(detectRooms(scene, { ...options, signal: controller.signal }), error => error === reason);
  assert.equal(workers.length, countBeforeAbort, "pre-aborted requests must not create a worker");

  const { detectRoomsInWorker } = await import("../src/roomDetectorClient.ts");
  const active = new AbortController();
  const pending = detectRoomsInWorker(scene, { ...options, signal: active.signal });
  const activeWorker = workers.at(-1);
  assert.ok(!("signal" in activeWorker.request.options), "AbortSignal must remain on the host");
  active.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.ok(activeWorker.terminated, "aborting must stop computation immediately");

  await assert.rejects(detectRooms({ ...scene, pageRects: null }, options), /length/);
  assert.ok(workers.at(-1).terminated, "detector failures must release their worker");
  await assert.rejects(detectRooms(scene, { ...options, seeds: [() => {}] }), { name: "DataCloneError" });
  assert.ok(workers.at(-1).terminated, "posting failures must release their worker");

  for (const event of [new Event("messageerror"), Object.assign(new Event("error"), { message: "worker crashed" })]) {
    const pending = detectRoomsInWorker(scene, options);
    const worker = workers.at(-1);
    worker.dispatchEvent(event);
    await assert.rejects(pending, /unreadable response|worker crashed/);
    assert.ok(worker.terminated);
  }
  globalThis.Worker = class { constructor() { throw new Error("worker blocked"); } };
  await assert.rejects(detectRooms(scene, options), /worker blocked/);
  globalThis.Worker = undefined;
  assert.deepEqual(await detectRooms(scene, options), expected, "Node callers retain the direct fallback");

  await testDemoLifetime();
  console.log("Room detector worker: parity, text inputs, buffer ownership, concurrency, cancellation, failures, and demo cleanup passed.");
} finally {
  for (const worker of workers) worker.terminate();
  await Promise.all(workers.map(worker => worker.termination));
  if (originalWorker === undefined) delete globalThis.Worker;
  else globalThis.Worker = originalWorker;
  hooks.deregister();
}

function rectangleScene() {
  const segments = [[20, 20, 70, 20], [70, 20, 70, 70], [70, 70, 20, 70], [20, 70, 20, 20]];
  return {
    pageRects: Float32Array.of(0, 0, 100, 100), segmentCount: segments.length,
    endpoints: Float32Array.from(segments.flat()),
    primitiveMeta: Float32Array.from(segments.flatMap(([, , x1, y1]) => [x1, y1, 0, 1])),
    primitiveBounds: Float32Array.from(segments.flatMap(([x0, y0, x1, y1]) =>
      [Math.min(x0, x1) - 0.5, Math.min(y0, y1) - 0.5, Math.max(x0, x1) + 0.5, Math.max(y0, y1) + 0.5])),
    styles: Float32Array.from(segments.flatMap(() => [0.5, 0, 0, 0])),
    textContent: [{ text: "Office", minX: 40, minY: 40, maxX: 48, maxY: 44, pageIndex: 0 }],
    textIndex: null, textInstanceA: new Float32Array(), textInstanceB: new Float32Array(),
    textGlyphMetaA: new Float32Array(), textGlyphMetaB: new Float32Array()
  };
}

async function testDemoLifetime() {
  const source = await readFile(new URL("../src/room-overlay-demo.ts", import.meta.url), "utf8");
  for (const outcome of ["success", "failure", "dispose"]) {
    const result = Promise.withResolvers();
    let applied = 0;
    let called = false;
    const context = vm.createContext({
      AbortController, isBusy: false, roomDetectionToken: 0, roomDetectionController: null,
      currentPdfObject: { sceneData: {}, sourceLabel: "tiny", renderer: { setInteractionViewportProvider() {} }, dispose() {} },
      currentPdfCoordinateTransform: {}, detectRoomsSpinner: { hidden: true }, pdfValue: { textContent: "tiny" },
      scene: { remove() {} }, setStatus() {}, requestRender() {}, syncControlsEnabled() {},
      setBusy(value) { context.isBusy = value; }, yieldForLoad: async () => {},
      detectRooms(_scene, options) { called = true; return waitForLoad(result.promise, options.signal); },
      createGeneratedRoomTsv() { applied += 1; return { rowCount: 1, text: "tsv", fileName: "tiny.tsv" }; },
      parseRoomTsv() { return {}; }, disposeRoomOverlay() {}, rebuildCurrentRoomOverlay() {},
      clearRoomOverlay() {}, createIdentityPdfCoordinateTransform() { return {}; }
    });
    const run = vm.runInContext(`${sourceFunction(source, "detectRoomsForCurrentPdf")}\ndetectRoomsForCurrentPdf`, context);
    const clear = vm.runInContext(`${sourceFunction(source, "clearCurrentPdfObject")}\nclearCurrentPdfObject`, context);
    const pending = run();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(called);
    assert.equal(context.isBusy, true);
    assert.equal(applied, 0, "the overlay must wait for the worker result");
    if (outcome === "dispose") {
      const signal = context.roomDetectionController.signal;
      clear();
      assert.ok(signal.aborted);
      result.resolve({ seedSource: "none" });
    } else if (outcome === "failure") result.reject(new Error("worker failed"));
    else result.resolve({ seedSource: "none" });
    await pending;
    assert.equal(applied, outcome === "success" ? 1 : 0);
    assert.equal(context.roomDetectionController, null);
    if (outcome !== "dispose") assert.equal(context.isBusy, false, "restore controls after success or failure");
  }
}
