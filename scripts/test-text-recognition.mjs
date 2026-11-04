import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

const { TextRecognitionController } = await import("../src/textRecognitionController.ts");
const { createPaddleTextRecognitionProvider } = await import("../src/paddleTextRecognition.ts");
const { createSceneTextSearcher } = await import("../src/textSearch.ts");
const polygon = [[0, 0], [100, 0], [100, 20], [0, 20]];
const result = text => ({ lines: [{ text, polygon }] });
const pixels = () => ({ width: 100, height: 100, rgba: new Uint8Array(40_000) });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function page(sourcePageIndex = 0, text = "") {
  return { pageCount: 1, pageRects: Float32Array.of(0, 0, 200, 300), pdfOverviewKind: "raster",
    pdfPages: [{ pageIndex: 0, sourcePageIndex }],
    textIndex: text ? { version: 2, pages: [{ text, charInstance: Int32Array.from(text, () => -1), fallbackQuads: new Float32Array() }] } : null,
    rasterLayers: [{ matrix: Float32Array.of(200, 0, 0, -300, 0, 300) }] };
}

// One fallback slot per UTF-16 unit survives non-BMP and combining graphemes.
{
  const scene = page(7), inputs = [];
  let changes = 0;
  const controller = new TextRecognitionController({ provider: { async recognize(input) { inputs.push(input); return result("A😀e\u0301 B"); } } }, {
    renderPage: async (_index, dpi) => { assert.equal(dpi, 300); return pixels(); }, onChange: () => changes++
  });
  await controller.recognizeAll([scene]);
  const index = scene.textIndex.pages[0];
  assert.equal(index.text, "A😀e\u0301 B");
  assert.equal(index.charInstance.length, index.text.length);
  assert.equal(index.fallbackQuads.length, (index.text.length - 1) * 4);
  assert.deepEqual(Array.from(index.fallbackQuads.slice(4, 8)), Array.from(index.fallbackQuads.slice(8, 12)), "surrogate halves share geometry in separate slots");
  assert.deepEqual(Array.from(index.fallbackQuads.slice(12, 16)), Array.from(index.fallbackQuads.slice(16, 20)), "combining sequence shares geometry");
  assert.equal(inputs[0].sourcePageIndex, 7);
  assert.equal(changes, 1);
  assert.equal(createSceneTextSearcher(scene).search("😀e\u0301").length, 1);
  controller.apply(scene);
  assert.equal(scene.textIndex.pages[0], index, "applying cached metadata preserves index identity");
  const composed = { ...page(7), pageRects: Float32Array.of(500, 600, 900, 1200) };
  controller.apply(composed);
  assert.deepEqual(Array.from(composed.textIndex.pages[0].fallbackQuads.slice(0, 4)), [500, 1080, 580, 1200]);
  controller.dispose();
}

// Explicit character boxes override interpolated line geometry; stored text wins.
{
  const scene = page(4), stored = page(5, "Original text");
  const original = stored.textIndex;
  let calls = 0;
  const controller = new TextRecognitionController({ provider: { async recognize() { calls++; return { lines: [{ text: "AB", polygon,
    characters: [{ text: "A", polygon: [[0, 0], [10, 0], [10, 20], [0, 20]] },
      { text: "B", polygon: [[80, 0], [100, 0], [100, 20], [80, 20]] }] }] }; } } }, {
    renderPage: async () => pixels(), onChange() {}
  });
  await controller.recognizeAll([scene, stored]);
  assert.equal(calls, 1);
  assert.equal(stored.textIndex, original);
  assert.deepEqual(Array.from(scene.textIndex.pages[0].fallbackQuads), [0, 240, 20, 300, 160, 240, 200, 300]);
  controller.dispose();
}

// Availability is probed before rasterization. Incremental conversion skips placeholders.
{
  let rendered = 0;
  const diagnostics = [];
  const controller = new TextRecognitionController("auto", { renderPage: async () => { rendered++; return pixels(); }, onChange() {},
    onDiagnostic: diagnostic => diagnostics.push(diagnostic) });
  await controller.recognizeAll([page()]);
  assert.equal(controller.getProgress().state, "unavailable");
  assert.equal(rendered, 0);
  assert.equal(diagnostics[0].code, "text-recognition.unavailable");
  assert.equal(diagnostics[0].severity, "info");
  controller.update([page()]);
  assert.equal(diagnostics.length, 1);
  controller.dispose();
  const first = page(11), second = page(12);
  second.pendingPagePreviews = Uint8Array.of(1);
  const indexes = [];
  const incremental = new TextRecognitionController({ provider: { async recognize(input) { return result(`Page ${input.sourcePageIndex}`); } } }, {
    renderPage: async index => { indexes.push(index); return pixels(); }, onChange() {}
  });
  await incremental.recognizeAll([first, second]);
  assert.deepEqual(indexes, [0]);
  delete second.pendingPagePreviews;
  await incremental.recognizeAll([first, second]);
  assert.deepEqual(indexes, [0, 1]);
  incremental.dispose();
}

// Selected source IDs cannot collide with the slot IDs of pending page skeletons.
{
  const first = page(1), pending = page();
  delete pending.pdfPages;
  pending.pendingPagePreviews = Uint8Array.of(1);
  const composite = { ...page(), pageCount: 2, pageRects: Float32Array.of(0, 0, 200, 300, 300, 0, 500, 300),
    pdfPages: [{ pageIndex: 0, sourcePageIndex: 1 }] };
  const controller = new TextRecognitionController({ provider: { async recognize(input) { return result(`Source ${input.sourcePageIndex}`); } } }, {
    renderPage: async () => pixels(), onChange() { controller.apply(composite); }
  });
  await controller.recognizeAll([first, pending]);
  assert.equal(pending.textIndex, null, "pending selected slot 1 cannot receive source page 1 text");
  assert.equal(composite.textIndex.pages[0].text, "Source 1");
  assert.equal(composite.textIndex.pages[1].text, "", "record state protects composed scenes lacking pending flags");
  assert.equal(controller.getProgress().completed, 1);
  assert.equal(controller.getProgress().total, 1, "pending slot IDs do not count as completed source IDs");
  const second = page(2);
  composite.pdfPages = [{ pageIndex: 0, sourcePageIndex: 1 }, { pageIndex: 1, sourcePageIndex: 2 }];
  await controller.recognizeAll([first, second]);
  controller.apply(composite);
  assert.equal(composite.textIndex.pages[1].text, "Source 2");
  assert.equal(controller.getProgress().completed, 2);
  const evicted = { ...pending, pendingPagePreviews: Uint8Array.of(1) };
  controller.update([evicted, second]);
  const canonical = page(1);
  controller.apply(canonical);
  assert.equal(canonical.textIndex.pages[0].text, "Source 1", "canonical source metadata keeps cached OCR available after viewing eviction");
  controller.dispose();
}

// Empty scans complete once without claiming usable text or changing selection metadata.
{
  const scenes = [page(18), page(19), page(20)], diagnostics = [];
  let calls = 0, changed = 0, recover = false;
  const controller = new TextRecognitionController({ provider: { async recognize(input) {
    calls++;
    return recover || input.sourcePageIndex === 20 ? result("Usable") : input.sourcePageIndex === 19 ? result("\ufffd") : { lines: [] };
  } } }, { renderPage: async () => pixels(), onChange() { changed++; }, onDiagnostic: value => diagnostics.push(value) });
  await controller.recognizeAll(scenes.slice(0, 2));
  assert.equal(controller.getProgress().state, "complete", "blank scans are valid completed attempts");
  assert.equal(controller.getProgress().completed, 2);
  assert.equal(controller.getProgress().recognizedPages, 0, "empty and unusable text do not count as recognized pages");
  assert.equal(changed, 0, "no selection/search refresh is needed without usable text");
  assert(diagnostics.every(value => value.code === "text-recognition.no-text" && value.severity === "info"));
  assert.equal(diagnostics.length, 2);
  await controller.recognizeAll(scenes);
  assert.equal(calls, 3, "completed blank pages are not recognized in a loop");
  assert.equal(changed, 1);
  assert.equal(controller.getProgress().recognizedPages, 1, "count pages containing usable recognized text");
  controller.apply(scenes[1]);
  assert.equal(scenes[1].textIndex, null, "unusable replacement text is never attached, including on later updates");
  recover = true;
  controller.retry(); await controller.recognizeAll(scenes);
  assert.equal(calls, 5, "explicit Retry re-runs empty attempts and preserves completed text");
  assert.equal(controller.getProgress().recognizedPages, 3);
  assert.equal(scenes[0].textIndex.pages[0].text, "Usable");
  controller.dispose();
}

// Failures remain visible and retryable, while later pages still finish.
{
  let fail = true;
  const scenes = [page(21), page(22)], diagnostics = [];
  const controller = new TextRecognitionController({ provider: { async recognize(input) {
    if (input.sourcePageIndex === 21 && fail) throw new Error("Transient recognition failure");
    return result(`Recognized ${input.sourcePageIndex}`);
  } } }, { renderPage: async () => pixels(), onChange() {}, onDiagnostic: diagnostic => diagnostics.push(diagnostic) });
  await controller.recognizeAll(scenes);
  assert.equal(controller.getProgress().state, "failed");
  assert.equal(scenes[0].textIndex, null);
  assert.equal(scenes[1].textIndex.pages[0].text, "Recognized 22");
  assert.equal(diagnostics[0].pageIndex, 21);
  fail = false; controller.retry(); await controller.recognizeAll(scenes);
  assert.equal(controller.getProgress().state, "complete");
  assert.equal(scenes[0].textIndex.pages[0].text, "Recognized 21");
  controller.dispose();
}

// Late uncooperative recognizer results cannot alter a disposed document.
{
  const gate = deferred(), entered = deferred();
  let changed = 0, disposed = 0;
  const scene = page();
  const controller = new TextRecognitionController({ provider: { async recognize() { entered.resolve(); return gate.promise; }, dispose() { disposed++; } } }, {
    renderPage: async () => pixels(), onChange() { changed++; }
  });
  controller.update([scene]);
  await entered.promise;
  controller.dispose();
  gate.resolve(result("Too late"));
  await tick();
  assert.equal(changed, 0);
  assert.equal(scene.textIndex, null);
  assert.equal(disposed, 0, "explicit providers remain caller-owned");
}

// Asynchronous native creation is awaited before rasterization; init failure uses fallback.
{
  const previousDetector = Object.getOwnPropertyDescriptor(globalThis, "TextDetector");
  const previousImageData = Object.getOwnPropertyDescriptor(globalThis, "ImageData");
  globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
  let created = 0, destroyed = 0, fallbackCalls = 0;
  globalThis.TextDetector = class {
    constructor() { throw new Error("Legacy constructor must not be used"); }
    static async create() { created++; return { async detect() { return [{ rawValue: "Native", cornerPoints: [],
      boundingBox: { x: 0, y: 0, width: 100, height: 20 } }]; }, destroy() { destroyed++; } }; }
  };
  const progress = [];
  const controller = new TextRecognitionController({ onProgress: value => progress.push(value),
    fallback: async () => { fallbackCalls++; return null; } }, {
    renderPage: async () => { assert.equal(created, 1); return pixels(); }, onChange() {}
  });
  try {
    const scene = page(); await controller.recognizeAll([scene]);
    assert.equal(scene.textIndex.pages[0].text, "Native");
    assert.equal(fallbackCalls, 0, "a functioning native engine never initializes the optional download");
    assert.equal(controller.getProgress().provider, "native");
    assert(progress.some(value => value.stage === "initializing"));
    assert(progress.some(value => value.provider === "native" && value.stage === "rendering"));
    controller.dispose(); assert.equal(destroyed, 1);
    globalThis.TextDetector = class { static async create() { throw new Error("Cannot initialize native component"); } };
    const fallback = new TextRecognitionController({ fallback: async () => ({ async recognize() { return result("After init failure"); } }) }, {
      renderPage: async () => pixels(), onChange() {}
    });
    const fallbackScene = page(); await fallback.recognizeAll([fallbackScene]);
    assert.equal(fallbackScene.textIndex.pages[0].text, "After init failure"); fallback.dispose();
  } finally {
    controller.dispose();
    if (previousDetector) Object.defineProperty(globalThis, "TextDetector", previousDetector); else delete globalThis.TextDetector;
    if (previousImageData) Object.defineProperty(globalThis, "ImageData", previousImageData); else delete globalThis.ImageData;
  }
}

// Exposing a legacy constructor alone does not establish that native OCR works.
{
  const previousDetector = Object.getOwnPropertyDescriptor(globalThis, "TextDetector");
  const previousImageData = Object.getOwnPropertyDescriptor(globalThis, "ImageData");
  globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
  const probes = [], diagnostics = [];
  let rendered = 0, destroyed = 0;
  globalThis.TextDetector = class {
    async detect(image) { probes.push([image.width, image.height]); throw new DOMException("Text Detection not implemented.", "NotSupportedError"); }
    destroy() { destroyed++; }
  };
  const controller = new TextRecognitionController({ fallback: async () => ({ recognize: async () => result("Local") }) }, {
    renderPage: async () => { rendered++; return pixels(); }, onChange() {}, onDiagnostic: value => diagnostics.push(value)
  });
  try {
    await controller.recognizeAll([page()]);
    assert.deepEqual(probes, [[64, 64]], "unsupported native services are caught before a full-page raster is prepared");
    assert.equal(rendered, 1, "only fallback recognition needs the scanned-page raster");
    assert.equal(destroyed, 1);
    assert.equal(controller.getProgress().provider, "fallback");
    assert.match(diagnostics.find(value => value.code === "text-recognition.native-unavailable").details.reason,
      /NotSupportedError: Text Detection not implemented/);
  } finally {
    controller.dispose();
    if (previousDetector) Object.defineProperty(globalThis, "TextDetector", previousDetector); else delete globalThis.TextDetector;
    if (previousImageData) Object.defineProperty(globalThis, "ImageData", previousImageData); else delete globalThis.ImageData;
  }
}

// Synchronous progress callbacks can cancel conversion before provider/raster work starts.
{
  const abort = new AbortController();
  let rendered = 0, recognized = 0;
  const controller = new TextRecognitionController({
    provider: { async recognize() { recognized++; return result("Cancelled"); } },
    onProgress: progress => { if (progress.state === "recognizing") abort.abort(); }
  }, { renderPage: async () => { rendered++; return pixels(); }, onChange() {} });
  await assert.rejects(controller.recognizeAll([page()], abort.signal), error => error.name === "AbortError");
  await tick(); assert.equal(rendered, 0); assert.equal(recognized, 0);
  assert.equal(controller.getProgress().state, "paused"); controller.dispose();
}

// Disposal during fallback initialization releases the late provider and never renders.
{
  const loading = deferred(), entered = deferred();
  let rendered = 0, disposed = 0;
  const controller = new TextRecognitionController({ fallback: async () => { entered.resolve(); return loading.promise; } }, {
    renderPage: async () => { rendered++; return pixels(); }, onChange() { assert.fail("Disposed controller changed text"); }
  });
  controller.update([page()]); await entered.promise; controller.dispose();
  loading.resolve({ async recognize() { return result("Late"); }, dispose() { disposed++; } });
  await tick(); assert.equal(disposed, 1); assert.equal(rendered, 0);
}

// Pause persists across viewport updates; retry resumes without losing completed text.
{
  const gate = deferred(), entered = deferred();
  let calls = 0;
  const scene = page();
  const controller = new TextRecognitionController({ provider: { async recognize() {
    calls++; if (calls === 1) { entered.resolve(); return gate.promise; } return result("Retried");
  } } }, { renderPage: async () => pixels(), onChange() {} });
  controller.update([scene]); await entered.promise;
  controller.pause(); controller.update([scene]);
  gate.resolve(result("Cancelled")); await tick(); await tick();
  assert.equal(scene.textIndex, null);
  assert.equal(controller.getProgress().state, "paused");
  controller.retry(); await controller.recognizeAll([scene]);
  assert.equal(scene.textIndex.pages[0].text, "Retried");
  controller.configure("off"); controller.apply(scene);
  assert.equal(scene.textIndex.pages[0].text, "Retried");
  controller.dispose();
}

// Native detection failures try the lazy fallback; owned fallback is cleaned up once.
{
  const previousDetector = Object.getOwnPropertyDescriptor(globalThis, "TextDetector");
  const previousImageData = Object.getOwnPropertyDescriptor(globalThis, "ImageData");
  globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
  globalThis.TextDetector = class { async detect() { throw new Error("Platform recognizer unavailable"); } };
  let loaded = 0, disposed = 0;
  const controller = new TextRecognitionController({ fallback: async () => { loaded++; return {
    async recognize() { return result("Fallback"); }, dispose() { disposed++; }
  }; } }, { renderPage: async () => pixels(), onChange() {} });
  try {
    const scene = page();
    await controller.recognizeAll([scene]);
    assert.equal(loaded, 1); assert.equal(scene.textIndex.pages[0].text, "Fallback");
    controller.dispose(); await tick(); assert.equal(disposed, 1);
  } finally {
    controller.dispose();
    if (previousDetector) Object.defineProperty(globalThis, "TextDetector", previousDetector); else delete globalThis.TextDetector;
    if (previousImageData) Object.defineProperty(globalThis, "ImageData", previousImageData); else delete globalThis.ImageData;
  }
}

// Paddle adapter maps real prediction items and loads its runtime only on demand.
{
  let loaded = 0, disposed = 0;
  const provider = createPaddleTextRecognitionProvider({ prepareImage: input => input, loadClient: async () => {
    loaded++; return { predict: async input => { assert.equal(input.width, 100); return [{ items: [{ text: "Paddle", score: .9,
      poly: polygon.map(([x, y]) => ({ x, y })) }] }]; }, dispose() { disposed++; } };
  } });
  assert.equal(loaded, 0);
  const input = { ...pixels(), sourcePageIndex: 0, languages: [], signal: new AbortController().signal };
  assert.deepEqual(await provider.recognize(input), result("Paddle"));
  await provider.recognize(input); assert.equal(loaded, 1);
  await provider.dispose(); await provider.dispose(); assert.equal(disposed, 1);
}

console.log("Text recognition geometry, lifecycle, native fallback and Paddle adapter tests passed.");
