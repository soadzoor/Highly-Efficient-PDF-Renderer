import assert from "node:assert/strict";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { Worker as NodeWorker } from "node:worker_threads";

const resolveHook = (specifier, context, next) => next(
  context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
const loadHook = (url, context, next) => {
  const result = next(url, context);
  return result.format === "module-typescript"
    ? { ...result, format: "module", source: stripTypeScriptTypes(String(result.source), { mode: "transform" }) } : result;
};
const hooks = registerHooks({ resolve: resolveHook, load: loadHook });
const originalWorker = globalThis.Worker;
const workers = [];
class BrowserWorker extends EventTarget {
  constructor(url, options) {
    super();
    assert.equal(options.type, "module");
    const bootstrap = `
      import { parentPort } from 'node:worker_threads';
      import { registerHooks, stripTypeScriptTypes } from 'node:module';
      registerHooks({ resolve: ${resolveHook.toString()}, load: ${loadHook.toString()} });
      globalThis.addEventListener = (_type, listener) => parentPort.on('message', data => listener({ data }));
      globalThis.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
      await import(${JSON.stringify(url.href)});
    `;
    this.thread = new NodeWorker(new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`), {
      execArgv: ["--experimental-strip-types"]
    });
    this.thread.on("message", data => {
      if (data.type !== "progress") this.response = data;
      this.dispatchEvent(new MessageEvent("message", { data }));
    });
    this.thread.on("error", error => this.dispatchEvent(Object.assign(new Event("error"), { error, message: error.message })));
    workers.push(this);
  }
  postMessage(request, transfer) {
    assert.equal(transfer, undefined, "Canonical buffers must not be detached");
    this.request = request;
    this.thread.postMessage(request);
  }
  terminate() { this.terminated = true; this.termination ??= this.thread.terminate(); }
}

try {
  globalThis.Worker = BrowserWorker;
  const suffix = process.argv.includes("--package") ? "../dist/bundler/" : "../src/";
  const extension = process.argv.includes("--package") ? "js" : "ts";
  const vector = await import(`${suffix}vectorStrokeLodCore.${extension}`);
  const text = await import(`${suffix}textLodCore.${extension}`);
  const { buildTextLodAsync } = await import(`${suffix}textGreekLod.${extension}`);
  const { buildVectorLodInWorker } = await import(`${suffix}lodWorkerClient.${extension}`);
  const { strokePaintGroups, strokeLodOverviewAllowed } = await import(`${suffix}vectorStrokePaintOrder.${extension}`);
  const { createEmptyVectorScene } = await import(`${suffix}emptyVectorScene.${extension}`);
  assert.equal(workers.length, 0, "Importing preparation APIs must not start workers");

  const small = strokeScene(256, createEmptyVectorScene, 1);
  const expected = new vector.VectorStrokeLodRuntime(small);
  assert(expected.levels.length > 1, "The parity fixture must exercise simplification");
  const snapshot = small.endpoints.slice();
  // These unrelated payloads deliberately cannot enter a structured clone.
  small.rasterLayers = [{ nonCloneable: () => {} }];
  small.textIndex = { nonCloneable: () => {} };
  small.retainedPages = [{ nonCloneable: () => {} }];
  const prepared = await buildVectorLodInWorker(small, undefined, {});
  assert.deepEqual(prepared.data, vector.getStoredVectorStrokeLod(small), "Worker simplification, origins and indexes match direct construction");
  assert.deepEqual(prepared.bounds.minX, expected.levels[0].segmentMinX);
  assert.deepEqual(prepared.allLevelBounds, expected.allLevelBounds);
  assert.deepEqual(small.endpoints, snapshot);
  const strokeRequest = workers.at(-1).request.scene;
  assert(!("rasterLayers" in strokeRequest) && !("textIndex" in strokeRequest) && !("textInstanceA" in strokeRequest));
  assert.equal((await vector.prebuildVectorStrokeLodRuntime(small, "force", "webgl")).levels[0].scene, small);
  assert.equal(workers.length, 1, "Small forced builds keep the cooperative path");

  const dense = strokeScene(150_000, createEmptyVectorScene);
  const vectorProgress = [];
  const runtime = await vector.prebuildVectorStrokeLodRuntime(dense, "auto", "webgl", {
    onProgress: progress => vectorProgress.push(progress.value)
  });
  assert.equal(workers.length, 2, "Large automatic vector preparation uses a worker");
  assert.equal(runtime.levels[0].scene, dense);
  assert(runtime.levels.every(level => level.store.canonical === dense), "Rebind every level to the canonical scene");
  assert(vectorProgress.every((value, i) => !i || value >= vectorProgress[i - 1]));
  assert.equal(vectorProgress.at(-1), 1);
  assert.equal(dense.endpoints.length, 150_000 * 4);
  assert.equal(await vector.prebuildVectorStrokeLodRuntime(dense, "auto", "webgpu"), runtime, "Idle cache hits reuse the completed hierarchy");
  assert.equal(workers.length, 2);
  vector.takePrebuiltVectorStrokeLodRuntime(dense);
  const restored = { ...dense };
  const storedData = vector.getStoredVectorStrokeLod(dense);
  vector.storeVectorStrokeLod(restored, storedData);
  vector.resetVectorStrokeLodBuildTiming();
  const storedProgress = [];
  const restoredRuntime = await vector.prebuildVectorStrokeLodRuntime(restored, "auto", "webgl", {
    onProgress: progress => storedProgress.push(progress)
  });
  assert.equal(workers.length, 2, "Stored hierarchies are adopted without starting or cloning into a worker");
  assert.equal(storedProgress.at(-1).message, "Stored Vector LOD ready");
  assert.equal(storedProgress.at(-1).value, 1);
  assert.equal(vector.consumeVectorStrokeLodBuildTiming().buildCount, 0, "Stored adoption never records a new build");
  assert.equal(restoredRuntime.levels[0].scene, restored);
  assert(restoredRuntime.levels.every(level => level.store.canonical === restored));
  assert.deepEqual(restoredRuntime.levels[0].segmentMinX, runtime.levels[0].segmentMinX);
  assert.deepEqual(restoredRuntime.allLevelBounds, runtime.allLevelBounds);
  vector.takePrebuiltVectorStrokeLodRuntime(restored);
  const reservations = await Promise.all([
    vector.reserveVectorStrokeLodRuntime(restored, "auto", "webgl"),
    vector.reserveVectorStrokeLodRuntime(restored, "auto", "webgpu")
  ]);
  const first = reservations[0].take(restored), second = reservations[1].take(restored);
  assert.notEqual(first, second, "Concurrent viewers own independent selection scratch");
  assert.equal(workers.length, 2, "Independent stored reservations never start workers");
  assert.equal(first.levels[0].segmentMinX, restoredRuntime.levels[0].segmentMinX,
    "The first legacy restoration's bounds are retained for the next viewer");
  assert.equal(second.levels[0].segmentMinX, first.levels[0].segmentMinX);
  assert.notEqual(first.levels[0].segmentMarks, second.levels[0].segmentMarks);
  assert.notEqual(first.tileSelectedLevelIndices, second.tileSelectedLevelIndices);
  assert.equal(first.levels[0].store.canonical, restored);
  assert.equal(second.levels[0].store.canonical, restored);

  const storedAbort = new AbortController();
  storedAbort.abort();
  await assert.rejects(vector.reserveVectorStrokeLodRuntime(restored, "auto", "webgl", {
    signal: storedAbort.signal
  }), { name: "VectorStrokeLodBuildCancelledError" });
  await assert.rejects(vector.reserveVectorStrokeLodRuntime(restored, "auto", "webgl", {
    shouldCancel: () => true
  }), { name: "VectorStrokeLodBuildCancelledError" });
  assert.equal(workers.length, 2, "Cancelled stored adoption starts no worker");

  const storedCallbackScene = { ...dense }, storedCallbackError = new Error("stored progress failed");
  vector.storeVectorStrokeLod(storedCallbackScene, storedData);
  await assert.rejects(vector.reserveVectorStrokeLodRuntime(storedCallbackScene, "auto", "webgl", {
    onProgress: progress => { if (progress.value === 1) throw storedCallbackError; }
  }), error => error === storedCallbackError);
  const recoveredStoredRuntime = vector.takePrebuiltVectorStrokeLodRuntime(storedCallbackScene);
  assert(recoveredStoredRuntime, "A failed completion callback keeps the complete stored runtime reusable");
  assert.equal(recoveredStoredRuntime.levels[0].scene, storedCallbackScene);

  const darken = darkenStrokeScene(createEmptyVectorScene);
  const darkenExpected = new vector.VectorStrokeLodRuntime(darken);
  assert(strokeLodOverviewAllowed(darken), "Safe Darken groups permit density and overview simplification");
  assert(darkenExpected.levels.some(level => level.segmentCount < darken.segmentCount),
    "Consecutive singleton Darken paints must simplify across their source draw runs");
  const paintGroups = strokePaintGroups(darken);
  assert.equal(paintGroups[0], paintGroups[127]);
  for (const boundary of [128, 256, 384]) assert.notEqual(paintGroups[boundary - 1], paintGroups[boundary],
    "Intervening paints and both run/group OCG conditions are simplification barriers");
  const darkenSnapshot = darken.endpoints.slice();
  const darkenPrepared = await buildVectorLodInWorker(darken, undefined, {});
  assert.deepEqual(darkenPrepared.data, vector.getStoredVectorStrokeLod(darken),
    "Worker simplification retains full-scene Darken, intervening paint and OCG boundaries");
  const darkenRequest = workers.at(-1).request;
  assert.deepEqual(darkenRequest.paintGroups, paintGroups,
    "Precomputed paint groups retain barriers omitted from the minimal worker scene");
  assert.equal(darkenRequest.scene.drawRuns.length, darken.drawRuns.length - 1);
  assert(!("paintGraph" in darkenRequest.scene) && !("optionalContent" in darkenRequest.scene));
  assert.deepEqual(darken.endpoints, darkenSnapshot, "Worker preparation preserves canonical buffer ownership");
  const storedPrepared = await buildVectorLodInWorker(darken, vector.getStoredVectorStrokeLod(darken), {});
  assert.deepEqual(storedPrepared.allLevelBounds, darkenPrepared.allLevelBounds);
  assert.equal(workers.at(-1).request.paintGroups, undefined,
    "Stored bounds-only preparation does not clone paint groups");
  const unsupportedEffect = darkenStrokeScene(createEmptyVectorScene);
  unsupportedEffect.paintGraph.roots[0].blendMode = "Multiply";
  new vector.VectorStrokeLodRuntime(unsupportedEffect);
  const effectPrepared = await buildVectorLodInWorker(unsupportedEffect, undefined, {});
  assert.equal(workers.at(-1).request.overviewAllowed, false,
    "The minimal worker scene retains full-scene effect restrictions");
  assert.deepEqual(effectPrepared.data, vector.getStoredVectorStrokeLod(unsupportedEffect),
    "An unsupported blend preserves direct/worker conservative simplification parity");

  const denseText = textScene(50_000, createEmptyVectorScene);
  const expectedText = await buildTextLodAsync(denseText);
  assert(expectedText.data);
  denseText.rasterLayers = [{ nonCloneable: () => {} }];
  denseText.retainedPages = [{ nonCloneable: () => {} }];
  denseText.textIndex = { nonCloneable: () => {} };
  const textProgress = [];
  const pending = text.prebuildTextLod(denseText, { onProgress: progress => textProgress.push(progress.value) });
  assert.equal(text.prebuildTextLod(denseText), pending, "Concurrent text preparation shares one build");
  const textResult = await pending;
  assert.deepEqual(textResult.data, expectedText.data, "Text runs, cluster hierarchy and coarse geometry preserve parity");
  assert(Object.isFrozen(textResult) && Object.isFrozen(textResult.data.runs[0].transform));
  assert.equal(text.getCachedTextLod(denseText), textResult);
  assert.equal(await text.prebuildTextLod(denseText), textResult);
  assert(textProgress.every((value, i) => !i || value >= textProgress[i - 1]));
  assert.equal(textProgress.at(-1), 1);
  const textRequest = workers.at(-1).request.scene;
  assert(!("endpoints" in textRequest) && !("textIndex" in textRequest) && !("retainedPages" in textRequest));
  const count = workers.length;
  assert.equal((await text.prebuildTextLod(textScene(12, createEmptyVectorScene))).fallbackReason, "below-instance-threshold");
  assert.equal(workers.length, count);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(text.prebuildTextLod({ ...denseText }, { signal: controller.signal }), { name: "TextLodBuildCancelledError" });
  await assert.rejects(vector.prebuildVectorStrokeLodRuntime({ ...dense }, "auto", "webgl", {
    signal: controller.signal
  }), { name: "VectorStrokeLodBuildCancelledError" });
  assert.equal(workers.length, count, "Pre-aborted requests must not create workers");

  const cancelledScene = { ...denseText };
  const active = new AbortController();
  await assert.rejects(text.prebuildTextLod(cancelledScene, {
    signal: active.signal, onProgress: () => active.abort()
  }), { name: "TextLodBuildCancelledError" });
  assert.equal(text.getCachedTextLod(cancelledScene), null, "Cancelled work must not publish partial data");
  assert(workers.at(-1).terminated);
  assert.deepEqual((await text.prebuildTextLod(cancelledScene)).data, expectedText.data, "Cancellation permits a clean retry");

  let shouldCancel = false;
  class IdleWorker extends EventTarget {
    constructor() { super(); workers.push(this); }
    postMessage(request) { this.request = request; }
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = IdleWorker;
  const cancelledVector = vector.prebuildVectorStrokeLodRuntime({ ...dense }, "auto", "webgl", {
    shouldCancel: () => shouldCancel
  });
  const cancelTimer = setTimeout(() => { shouldCancel = true; }, 10);
  try { await assert.rejects(cancelledVector, { name: "VectorStrokeLodBuildCancelledError" }); }
  finally { clearTimeout(cancelTimer); }
  assert(workers.at(-1).terminated, "Cancellation polling stops workers even before their first progress response");

  globalThis.Worker = BrowserWorker;
  const callbackError = new Error("progress callback failed");
  const callbackScene = { ...denseText };
  await assert.rejects(text.prebuildTextLod(callbackScene, {
    onProgress: progress => { if (progress.value > 0) throw callbackError; }
  }), error => error === callbackError);
  assert.equal(text.getCachedTextLod(callbackScene), null);
  assert(workers.at(-1).terminated, "Callback failures release workers without publishing partial data");

  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    for (const event of [new Event("messageerror"), Object.assign(new Event("error"), { message: "worker crashed" })]) {
      globalThis.Worker = class extends BrowserWorker {
        postMessage(request) { this.request = request; this.dispatchEvent(event); }
      };
      assert.deepEqual((await text.prebuildTextLod({ ...denseText })).data, expectedText.data,
        "Worker crashes and unreadable responses retain cooperative preparation");
      assert(workers.at(-1).terminated);
    }

    globalThis.Worker = class { constructor() { throw new Error("worker blocked"); } };
    const fallbackProgress = [];
    const fallback = await text.prebuildTextLod({ ...denseText }, { onProgress: progress => fallbackProgress.push(progress.value) });
    assert.deepEqual(fallback.data, expectedText.data, "Blocked workers retain cooperative preparation");
    assert(fallbackProgress.every((value, i) => !i || value >= fallbackProgress[i - 1]));
    assert.equal(warnings.length, 3, "Reduced worker capability emits a diagnostic");
  } finally { console.warn = originalWarn; }
  globalThis.Worker = undefined;
  assert.deepEqual((await text.prebuildTextLod({ ...denseText })).data, expectedText.data, "Node keeps the cooperative path");
  assert(workers.every(worker => worker.terminated), "Success, failures and cancellation release workers");
  console.log("LOD workers: vector/text parity, minimal cloning, canonical ownership, stored bounds, caches, reservations, cancellation and cooperative fallback passed.");
} finally {
  for (const worker of workers) worker.terminate();
  await Promise.all(workers.map(worker => worker.termination));
  if (originalWorker === undefined) delete globalThis.Worker;
  else globalThis.Worker = originalWorker;
  hooks.deregister();
}

function strokeScene(count, empty, spacing = 2) {
  const scene = { ...empty(), segmentCount: count, maxHalfWidth: 0.1,
    bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
    drawRuns: [{ kind: "stroke", first: 0, count }] };
  for (const field of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) scene[field] = new Float32Array(count * 4);
  for (let index = 0; index < count; index++) {
    const x = index % 500 * spacing, y = Math.floor(index / 500) * 2;
    scene.endpoints.set([x, y, x + 1, y], index * 4);
    scene.primitiveMeta.set([x + 1, y, 0, 1], index * 4);
    scene.primitiveBounds.set([x, y, x + 1, y], index * 4);
    scene.styles.set([0.1, 0, 0, 0], index * 4);
  }
  return scene;
}

function darkenStrokeScene(empty) {
  const scene = strokeScene(512, empty, 1);
  scene.drawRuns = [];
  scene.paintGraph = { roots: [] };
  scene.optionalContent = { groups: [], conditions: [0, 1].map(() => ({ kind: "constant", value: true })),
    order: [], radioGroups: [] };
  scene.fillPathCount = 1;
  scene.fillPathMetaB = Float32Array.of(1000, 1000, 1, 0);
  scene.fillPathMetaC = Float32Array.of(0, 0, 0, 1);
  for (let index = 0; index < scene.segmentCount; index++) {
    scene.endpoints.set([.005, .011, .018, .011], index * 4);
    scene.primitiveMeta.set([.018, .011, 0, 1], index * 4);
    scene.primitiveBounds.set([.005, .011, .018, .011], index * 4);
    if (index === 128) {
      scene.paintGraph.roots.push({ kind: "draw", runIndex: scene.drawRuns.length });
      scene.drawRuns.push({ kind: "fill", first: 0, count: 1 });
    }
    const runIndex = scene.drawRuns.length;
    scene.drawRuns.push({ kind: "stroke", first: index, count: 1,
      ...(index >= 256 ? { optionalContent: 0 } : {}) });
    scene.paintGraph.roots.push({ kind: "group", alpha: 1, isolated: true, knockout: false, blendMode: "Darken",
      children: [{ kind: "draw", runIndex }], ...(index >= 384 ? { optionalContent: 1 } : {}) });
  }
  return scene;
}

function textScene(count, empty) {
  const scene = { ...empty(), pageCount: 1, pageRects: Float32Array.of(0, 0, 1000, 1000),
    pageTextRanges: Uint32Array.of(0, count), textInstanceCount: count, textGlyphCount: 1,
    textGlyphMetaA: Float32Array.of(0, 4, 0, 0), textGlyphMetaB: Float32Array.of(1, 1, 0, 0),
    textGlyphSegmentsA: Float32Array.of(0,0,0,0, 1,0,1,0, 1,1,1,1, 0,1,0,1),
    textGlyphSegmentsB: Float32Array.of(1,0,0,0, 1,1,0,0, 0,1,0,0, 0,0,0,0) };
  for (const field of ["textInstanceA", "textInstanceB", "textInstanceC"]) scene[field] = new Float32Array(count * 4);
  for (let index = 0; index < count; index++) {
    scene.textInstanceA.set([1, 0, 0, 1], index * 4);
    scene.textInstanceB.set([index % 100, Math.floor(index / 100) * 2, 0, 0], index * 4);
    scene.textInstanceC.set([0.1, 0.1, 0.1, 1], index * 4);
  }
  return scene;
}
