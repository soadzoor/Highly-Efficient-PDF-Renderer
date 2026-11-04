import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { createOcrPdfFixture } from "./lib/ocrPdfFixture.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const previousDocument = globalThis.document;
let object;
try {
  const { loadPdfSceneFromSource } = await import("../src/pdfObjectGenerator.ts");
  const { createThreePdfObject } = await import("../src/threePdfObject.ts");
  const { ScenePageViews } = await import("../src/scenePageViews.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const loaded = await loadPdfSceneFromSource(createOcrPdfFixture({ pageCount: 2, content: "" }),
    { pageLoading: "eager", vectorLod: "off", textLod: "off" });
  globalThis.document = { createElement: () => ({ width: 1, height: 1, style: {}, getContext: () => null }) };
  const nativeFactory = () => new Proxy({
    getViewState: () => ({ zoom: 1, cameraCenterX: 0, cameraCenterY: 0 }),
    getPresentedViewState: () => ({ zoom: 1, cameraCenterX: 0, cameraCenterY: 0 }),
    setScene: () => ({}), getSceneStats: () => ({})
  }, { get: (target, key) => target[key] ?? (() => {}) });
  let calls = 0, finished;
  const complete = new Promise(resolve => { finished = resolve; });
  const setting = { provider: { async recognize(input) {
    calls++;
    return { lines: [{ text: input.sourcePageIndex === 0 ? "FIRST" : "SECOND",
      polygon: [[10, 10], [90, 10], [90, 30], [10, 30]] }] };
  } }, onProgress(progress) { if (progress.state === "complete" && progress.completed === 2) finished(); } };
  object = await createThreePdfObject(loaded, { vectorLod: "off", textLod: "off", textRecognition: setting },
    undefined, undefined, nativeFactory);
  assert.throws(() => object.configureTextRecognition({ dpi: 0 }), RangeError,
    "invalid deferred configuration rejects before a background task starts");
  const pages = await object.getPages();
  for (const layer of loaded.scene.rasterLayers) {
    layer.gpuCompression = { viewerDerivative: true };
    layer.gpuPreparation = { viewerDerivative: true };
  }
  object.thumbnailSceneRenderer = { close() {}, async render(scene, options, signal) {
    signal.throwIfAborted();
    assert.equal(scene.rasterLayers[0].gpuCompression, undefined, "OCR omits lossy viewing textures");
    assert.equal(scene.rasterLayers[0].gpuPreparation, undefined, "OCR omits low-resolution viewing preparations");
    assert(loaded.scene.rasterLayers.some(layer => layer.data === scene.rasterLayers[0].data), "OCR retains canonical pixel ownership");
    assert.deepEqual(options.background, [1, 1, 1, 1]);
    assert.equal(options.ocrTextOnly, false);
    assert.equal(options.rasterQuality, "source");
    assert.equal(options.maxDimension, Math.ceil(200 * 300 / 72));
    return { width: 100, height: 50, rgba: new Uint8Array(100 * 50 * 4) };
  } };
  await delay(10);
  assert.equal(calls, 0, "constructing and preparing page views does not start recognition");
  assert.equal(object.hasSearchableText, false);
  let changes = 0;
  object.addEventListener("change", event => { if (event.reason === "text-recognized") changes++; });
  // Stand in for the first host-rendered frame, without starting a browser/GPU session.
  object.textRecognitionDisplayed = true;
  object.scheduleTextRecognition();
  let timer;
  try { await Promise.race([complete, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Recognition did not complete.")), 2000);
  })]); } finally { clearTimeout(timer); }
  assert.equal(calls, 2);
  for (const layer of loaded.scene.rasterLayers) {
    assert.equal(layer.gpuCompression.viewerDerivative, true, "OCR preserves display compression caches");
    assert.equal(layer.gpuPreparation.viewerDerivative, true, "OCR preserves display preparation caches");
    delete layer.gpuCompression;
    delete layer.gpuPreparation;
  }
  assert.equal(changes, 2);
  assert.equal(object.hasSearchableText, true);
  assert.equal(object.searchText("second")[0].pageIndex, 1);
  assert.equal(pages[0].searchText("first").length, 1);
  assert.equal(pages[1].searchText("second").length, 1);
  assert.equal(pages[1].searchText("first").length, 0, "child OCR stays with its source page");
  const scene = await object.loadCompleteScene();
  assert.deepEqual(scene.textIndex.pages.map(page => page.text), ["FIRST", "SECOND"]);
  const index = scene.textIndex;
  const searcher = object.textSearcher, childSearcher = pages[0].textSearcher;
  let updates = 0;
  const update = object.textRecognitionController.update.bind(object.textRecognitionController);
  object.textRecognitionController.update = (...args) => { updates++; return update(...args); };
  object.updateTextRecognitionPages(); object.updateTextRecognitionPages();
  assert.equal(updates, 0, "unchanged page inputs and priorities skip OCR metadata work");
  object.textRecognitionVisiblePages = [1];
  object.updateTextRecognitionPages();
  assert.equal(updates, 1, "a visible-page priority change reaches the controller");
  assert.equal(object.textSearcher, searcher, "prioritization preserves the folded-text search cache");
  assert.equal(pages[0].textSearcher, childSearcher, "prioritization preserves unaffected child search caches");
  object.configureTextRecognition("off");
  assert.equal(object.searchText("first").length, 1, "cancel keeps completed recognition searchable");
  assert.equal(scene.textIndex, index, "changing settings retains completed metadata identities");
  object.dispose();
  assert.equal(object.getTextRecognitionProgress().state, "disposed");
  object = undefined;

  // Demand loaders replace overview geometry with fresh detail scenes. Recognition
  // stays with source pages while displayed scenes, page handles and caches change.
  const partition = new ScenePageViews(loaded.scene);
  const scannedPages = [0, 1].map(index => ({ ...partition.extract(index).scene, textIndex: null }));
  const streamingScene = composeVectorScenesInGrid(scannedPages);
  let notify, closed = false;
  const demand = {
    pages: scannedPages, bound: streamingScene, boundPages: scannedPages,
    get displayPageScenes() { return this.pages; },
    setOnChange(callback) { notify = callback; }, setPerformanceListener() {},
    getDisplayUpdate(scene) {
      return scene === this.bound && this.pages.every((page, index) => page === this.boundPages[index])
        ? { layers: new Map(), rasterPages: new Set() } : null;
    },
    bindDisplayScene(scene, pages) { this.bound = scene; this.boundPages = pages; },
    isDisplayUpdateCurrent() { return true; },
    async getPageThumbnail(_index, options) {
      assert.equal(options.rasterQuality, "source", "canonical parser thumbnails also preserve OCR raster quality");
      return { width: 100, height: 50, rgba: new Uint8Array(100 * 50 * 4) };
    },
    async loadCompletePageScenes() { return this.pages.map(page => ({ ...page, textIndex: null })); },
    async close() { closed = true; }
  };
  let streamingCalls = 0, streamFinished;
  const streamComplete = new Promise(resolve => { streamFinished = resolve; });
  object = await createThreePdfObject({ ...loaded, scene: streamingScene, pageDemand: demand },
    { vectorLod: "off", textLod: "off", textRecognition: {
      provider: { async recognize(input) {
        streamingCalls++;
        return { lines: [{ text: input.sourcePageIndex === 0 ? "FIRST" : "SECOND",
          polygon: [[10, 10], [90, 10], [90, 30], [10, 30]] }] };
      } }, onProgress(progress) { if (progress.state === "complete" && progress.completed === 2) streamFinished(); }
    } }, undefined, undefined, nativeFactory);
  const streamingChildren = await object.getPages();
  object.textRecognitionDisplayed = true;
  object.scheduleTextRecognition();
  try { await Promise.race([streamComplete, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Streaming recognition did not complete.")), 2000);
  })]); } finally { clearTimeout(timer); }
  const previousScene = object.sceneData;
  demand.pages = scannedPages.map(page => ({ ...page, textIndex: null }));
  notify();
  clearTimeout(object.demandUpdateTimer); object.demandUpdateTimer = null;
  await object.updateDemandPages();
  assert.notEqual(object.sceneData, previousScene, "a detail replacement installs a new display generation");
  assert.deepEqual(object.sceneData.textIndex.pages.map(page => page.text), ["FIRST", "SECOND"]);
  assert.equal(streamingChildren[0].searchText("first").length, 1);
  assert.equal(streamingChildren[1].searchText("second").length, 1);
  assert.equal(streamingCalls, 2, "new detail scenes reuse recognized text without another OCR pass");
  const completeStreaming = await object.loadCompleteScene();
  assert.deepEqual(completeStreaming.textIndex.pages.map(page => page.text), ["FIRST", "SECOND"],
    "canonical demand export receives cached recognition independently of display scenes");
  object.dispose(); object = undefined;
  assert.equal(closed, true);
  console.log("Three OCR deferred startup, page mapping, stable caches, demand detail replacement, export and cancellation passed.");
} finally {
  object?.dispose();
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
  hooks.deregister();
}
