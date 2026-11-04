import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
registerHooks({
  resolve(specifier, context, next) {
    return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
      ? `${specifier}.ts` : specifier, context);
  },
  load(url, context, next) {
    return url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : next(url, context);
  }
});

class Element extends EventTarget {
  children = [];
  textContent = "";
  hidden = false;
  disabled = false;
  attributes = new Map();
  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  remove() { this.removed = true; }
}
globalThis.document = { createElement: () => new Element() };
const stored = new Map();
globalThis.localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
const originalClock = new Map(["performance", "setInterval", "clearInterval"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
let now = 10_000, intervalId = 0;
const intervals = new Map();
Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => now } });
Object.defineProperty(globalThis, "setInterval", { configurable: true, value: (callback, milliseconds) => {
  assert.equal(milliseconds, 1000); intervals.set(++intervalId, callback); return intervalId;
} });
Object.defineProperty(globalThis, "clearInterval", { configurable: true, value: id => intervals.delete(id) });

let constructed = 0;
const messages = new EventTarget();
const nextWorkerMessage = () => new Promise(resolve => messages.addEventListener("message", event => resolve(event.worker), { once: true }));
class FakeWorker extends EventTarget {
  static instances = [];
  constructor() { super(); constructed++; FakeWorker.instances.push(this); }
  postMessage(message, transfer) {
    this.message = message; this.transfer = transfer;
    messages.dispatchEvent(Object.assign(new Event("message"), { worker: this }));
  }
  terminate() { this.terminated = true; }
  respond(result) { this.dispatchEvent(Object.assign(new Event("message"), { data: { id: this.message.id, result } })); }
  progress(progress) { this.dispatchEvent(Object.assign(new Event("message"), { data: { id: this.message.id, progress } })); }
}
globalThis.Worker = FakeWorker;
const { createViewerTextRecognitionControls } = await import("../src/viewerTextRecognition.ts");
const { createViewerPaddleTextRecognitionProvider } = await import("../src/viewerPaddleOcr.ts");
for (const detectorMaxSide of [0, -1, NaN, Infinity, -Infinity, "", "default", "1536", null]) {
  assert.throws(() => createViewerPaddleTextRecognitionProvider({ detectorMaxSide }), RangeError,
    "invalid detection limits fail before starting a worker or fetching assets");
  assert.throws(() => createViewerTextRecognitionControls({ detectorMaxSide, onSettingsChange() {} }), RangeError,
    "viewer controls validate detection limits before fallback consent or loading");
}
for (const detectorMaxSide of [undefined, 0.5, 1536, "source"]) {
  const lazyProvider = createViewerPaddleTextRecognitionProvider({ detectorMaxSide });
  const lazyControls = createViewerTextRecognitionControls({ detectorMaxSide, onSettingsChange() {} });
  lazyProvider.dispose(); lazyControls.dispose();
}
assert.equal(constructed, 0, "valid options and validation failures never initialize the local engine");
const changes = [];
const uiOptions = { onSettingsChange: settings => changes.push(settings) };
const ui = createViewerTextRecognitionControls(uiOptions);
uiOptions.detectorMaxSide = 960;
const [label, status, useLocal, retry, elapsed] = ui.element.children;
const [checkbox, labelText] = label.children;
assert.equal(labelText.textContent, "Recognize scanned text");
assert.equal(checkbox.checked, true, "browser recognition defaults on independently of local engine consent");
assert.notEqual(ui.settings, "off");
assert.equal(ui.settings.fallback, undefined, "unconsented viewer must not register a downloadable engine");
assert.equal(constructed, 0);
ui.setDocumentAvailable(true);
assert.equal(useLocal.hidden, true, "local download action is hidden while native recognition is available");
ui.setProgress({ state: "recognizing", completed: 0, total: 3, provider: "native" });
assert.match(status.textContent, /Browser OCR/);
assert.equal(constructed, 0, "default native recognition never creates a local engine worker");
checkbox.checked = false;
checkbox.dispatchEvent(new Event("change"));
assert.equal(changes.at(-1), "off", "unchecking cancels active recognition");
assert.equal(ui.settings, "off");
const disabled = createViewerTextRecognitionControls({ onSettingsChange() {} });
assert.equal(disabled.settings, "off", "recognition-off preference survives viewer recreation");
disabled.dispose();
checkbox.checked = true;
checkbox.dispatchEvent(new Event("change"));
assert.equal(ui.settings.fallback, undefined, "re-enabling native recognition does not imply engine download consent");
ui.setProgress({ state: "unavailable", completed: 0, total: 3 });
assert.equal(useLocal.hidden, false);
assert.match(status.textContent, /Browser OCR unavailable/);
useLocal.dispatchEvent(new Event("click"));
assert.equal(typeof changes.at(-1).fallback, "function");
assert.equal(constructed, 0, "consent does not eagerly initialize the engine");
const fallback = await changes.at(-1).fallback();
assert.equal(constructed, 0, "fallback construction also stays lazy until actual recognition");
ui.setProgress({ state: "recognizing", completed: 0, total: 3, provider: "fallback", stage: "recognizing" });
const firstMessage = nextWorkerMessage();
const recognition = fallback.recognize({ width: 1, height: 1, rgba: new Uint8Array(4),
  sourcePageIndex: 0, languages: [], signal: new AbortController().signal });
const uiWorker = await firstMessage;
assert.equal(uiWorker.message.detectorMaxSide, undefined,
  "an omitted limit remains unset for the worker default, even if caller options change later");
assert.equal(uiWorker.message.assets, undefined, "detection tuning does not select different assets by default");
uiWorker.dispatchEvent(Object.assign(new Event("message"), { data: { id: uiWorker.message.id,
  progress: { stage: "downloading", completedBytes: 25, totalBytes: 100 } } }));
assert.match(status.textContent, /Downloading local OCR.*25%/);
uiWorker.dispatchEvent(Object.assign(new Event("message"), { data: { id: uiWorker.message.id,
  progress: { stage: "recognizing", backend: "webgpu", elapsedMs: 1250 } } }));
assert.match(status.textContent, /Local OCR \(GPU\).*0\/3/);
assert.equal(elapsed.textContent, "1s");
assert.equal(elapsed.attributes.get("aria-hidden"), "true", "seconds do not announce every tick through the live status");
assert.equal(intervals.size, 1);
now += 3000;
for (const callback of intervals.values()) callback();
assert.equal(elapsed.textContent, "4s", "the UI clock keeps advancing while synchronous CPU inference blocks worker heartbeats");
uiWorker.progress({ stage: "recognizing", backend: "mixed", elapsedMs: 2000 });
assert.match(status.textContent, /Local OCR \(GPU\/CPU\)/);
assert.equal(elapsed.textContent, "4s", "worker heartbeats do not reset elapsed wall time");
const cachedResult = { lines: [{ text: "Repeated", polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] }] };
uiWorker.respond(cachedResult);
const firstResult = await recognition;
firstResult.lines[0].text = "Changed by caller";
ui.setProgress({ state: "complete", completed: 3, total: 3, recognizedPages: 3, provider: "fallback" });
assert.match(status.textContent, /Local OCR.*complete/);
assert.equal(intervals.size, 0);
assert.equal(elapsed.hidden, true);
await fallback.dispose();
assert.notEqual(uiWorker.terminated, true, "document wrapper disposal retains the idle local models");
ui.setDocumentAvailable(false);
assert.notEqual(uiWorker.terminated, true, "closing a completed document keeps its models warm");
ui.setDocumentAvailable(true);
const warm = await ui.settings.fallback();
ui.setProgress({ state: "recognizing", completed: 0, total: 1, provider: "fallback", stage: "recognizing" });
const priorMessageId = uiWorker.message.id;
const cached = await warm.recognize({ width: 1, height: 1, rgba: new Uint8Array(4),
  sourcePageIndex: 12, languages: [], signal: new AbortController().signal });
assert.equal(cached.lines[0].text, "Repeated", "cached text owns its result independently of prior consumers");
assert.equal(uiWorker.message.id, priorMessageId, "the same scan in another document skips inference entirely");
const warmMessage = nextWorkerMessage();
const warmRecognition = warm.recognize({ width: 1, height: 1, rgba: new Uint8Array(4),
  sourcePageIndex: 0, languages: ["hu"], signal: new AbortController().signal });
assert.equal(await warmMessage, uiWorker, "the next document reuses the same initialized worker");
assert.notEqual(uiWorker.message.id, priorMessageId, "different language hints do not reuse a prior result");
uiWorker.progress({ stage: "recognizing", backend: "wasm", elapsedMs: 0 });
assert.match(status.textContent, /Local OCR \(CPU\)/);
uiWorker.respond({ lines: [] });
await warmRecognition;
ui.setProgress({ state: "complete", completed: 1, total: 1, recognizedPages: 0, provider: "fallback" });
assert.equal(status.textContent, "Local OCR (CPU): no text found", "an empty result must not report recognized text as complete");
assert.equal(retry.hidden, false, "empty attempts can be retried explicitly");
assert.equal(intervals.size, 0);
const emptyRetryMessage = nextWorkerMessage();
const emptyRetry = warm.recognize({ width: 1, height: 1, rgba: new Uint8Array(4),
  sourcePageIndex: 0, languages: ["hu"], signal: new AbortController().signal });
assert.equal(await emptyRetryMessage, uiWorker, "empty results are not cached across documents");
uiWorker.respond({ lines: [] }); await emptyRetry;
ui.setProgress({ state: "complete", completed: 0, total: 0, recognizedPages: 0 });
assert.equal(status.textContent, "No scanned pages", "no eligible pages differs from an attempted scan with no text");
assert.equal(retry.hidden, true);
Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
const noHashMessage = nextWorkerMessage();
const noHashRecognition = warm.recognize({ width: 1, height: 1, rgba: new Uint8Array(4),
  sourcePageIndex: 0, languages: [], signal: new AbortController().signal });
assert.equal(await noHashMessage, uiWorker, "without SHA256 support recognition proceeds through the existing worker");
uiWorker.respond({ lines: [] });
await noHashRecognition;
Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
let finishHash, hashedPixels;
Object.defineProperty(globalThis, "crypto", { configurable: true, value: { subtle: { digest(_algorithm, bytes) {
  hashedPixels = bytes;
  return new Promise(resolve => { finishHash = resolve; });
} } } });
const hashAbort = new AbortController(), hashInput = Uint8Array.of(9, 8, 7, 6), beforeHashMessage = uiWorker.message.id;
const hashWork = warm.recognize({ width: 1, height: 1, rgba: hashInput,
  sourcePageIndex: 0, languages: [], signal: hashAbort.signal });
const hashRejection = assert.rejects(hashWork, { name: "AbortError" });
hashInput[0] = 99;
assert.deepEqual([...hashedPixels], [9, 8, 7, 6], "hashing owns the same pixel snapshot later sent for inference");
hashAbort.abort(new DOMException("Hash cancelled", "AbortError"));
await hashRejection;
finishHash(new ArrayBuffer(32));
assert.equal(uiWorker.message.id, beforeHashMessage, "cancelled hashing never submits an inference job");
Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
ui.setProgress({ state: "failed", completed: 0, total: 3, provider: "fallback" });
assert.match(status.textContent, /Local OCR.*failed/);
assert.equal(intervals.size, 0, "failed inference clears the elapsed timer");
assert.equal(retry.hidden, false);
assert.equal(useLocal.hidden, true, "previous consent is retained without a duplicate download prompt");
retry.dispatchEvent(new Event("click"));
assert.equal(typeof changes.at(-1).fallback, "function");
const active = await changes.at(-1).fallback();
ui.setProgress({ state: "recognizing", completed: 0, total: 1, provider: "fallback", stage: "recognizing" });
const activeMessage = nextWorkerMessage();
const activeRecognition = active.recognize({ width: 1, height: 1, rgba: Uint8Array.of(1, 0, 0, 0),
  sourcePageIndex: 0, languages: [], signal: new AbortController().signal });
const closedRejection = assert.rejects(activeRecognition, { name: "AbortError" });
await activeMessage;
uiWorker.progress({ stage: "recognizing", backend: "wasm", elapsedMs: 0 });
ui.setDocumentAvailable(false);
await closedRejection;
assert.equal(uiWorker.terminated, true, "closing an active document cancels its shared worker before reuse");
assert.equal(intervals.size, 0);
await assert.rejects(active.recognize({ width: 1, height: 1, rgba: new Uint8Array(4),
  sourcePageIndex: 0, languages: [], signal: new AbortController().signal }), { name: "AbortError" });
ui.setDocumentAvailable(true);
const fresh = await ui.settings.fallback();
ui.setProgress({ state: "recognizing", completed: 0, total: 1, provider: "fallback", stage: "recognizing" });
const freshMessage = nextWorkerMessage();
const freshRecognition = fresh.recognize({ width: 1, height: 1, rgba: Uint8Array.of(2, 0, 0, 0),
  sourcePageIndex: 0, languages: [], signal: new AbortController().signal });
const freshWorker = await freshMessage;
assert.notEqual(freshWorker, uiWorker, "after active cancellation the next document gets a clean engine");
freshWorker.progress({ stage: "recognizing", backend: "webgpu", elapsedMs: 0 });
freshWorker.respond({ lines: [] });
await freshRecognition;
ui.setProgress({ state: "complete", completed: 1, total: 1, provider: "fallback" });
const savedFallback = changes.at(-1).fallback;
checkbox.checked = false;
checkbox.dispatchEvent(new Event("change"));
assert.equal(freshWorker.terminated, true, "turning recognition off releases idle local models");
assert.equal(await savedFallback(), null, "turning recognition off prevents a previously handed-out fallback from loading");
checkbox.checked = true; checkbox.dispatchEvent(new Event("change"));
const afterOff = await ui.settings.fallback(), afterOffMessage = nextWorkerMessage();
const afterOffRecognition = afterOff.recognize({ width: 1, height: 1, rgba: new Uint8Array(4),
  sourcePageIndex: 0, languages: [], signal: new AbortController().signal });
const afterOffWorker = await afterOffMessage;
assert.notEqual(afterOffWorker, freshWorker, "turning recognition off also purges prior text results");
afterOffWorker.respond({ lines: [] }); await afterOffRecognition;
let finishLateHash;
Object.defineProperty(globalThis, "crypto", { configurable: true, value: { subtle: { digest() {
  return new Promise(resolve => { finishLateHash = resolve; });
} } } });
const lateHash = afterOff.recognize({ width: 1, height: 1, rgba: Uint8Array.of(8, 0, 0, 0),
  sourcePageIndex: 0, languages: [], signal: new AbortController().signal });
const lateHashRejection = assert.rejects(lateHash, { name: "AbortError" });
checkbox.checked = false; checkbox.dispatchEvent(new Event("change"));
finishLateHash(new ArrayBuffer(32));
await lateHashRejection;
Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
ui.dispose();
assert.equal(ui.element.removed, true);

const remembered = createViewerTextRecognitionControls({ onSettingsChange() {} });
assert.equal(remembered.settings, "off");
remembered.element.children[0].children[0].checked = true;
remembered.element.children[0].children[0].dispatchEvent(new Event("change"));
const viewerAssets = { detectionModelUrl: "/ocr/det.tar", recognitionModelUrl: "/ocr/rec.tar", wasmPath: "/ocr/ort/" };
const restoredOptions = { onSettingsChange() {}, assets: viewerAssets, detectorMaxSide: "source" };
const restored = createViewerTextRecognitionControls(restoredOptions);
restoredOptions.detectorMaxSide = 1920;
viewerAssets.detectionModelUrl = "/changed/det.tar";
assert.equal(typeof restored.settings.fallback, "function", "explicit local engine consent survives checkbox off/on and viewer recreation");
const restoredProvider = await restored.settings.fallback();
const restoredMessage = nextWorkerMessage();
const restoredRecognition = restoredProvider.recognize({ width: 1, height: 1, rgba: new Uint8Array(4),
  sourcePageIndex: 0, languages: [], signal: new AbortController().signal });
const restoredWorker = await restoredMessage;
assert.equal(restoredWorker.message.detectorMaxSide, "source", "viewer controls forward the snapshotted full-source override");
assert.deepEqual(restoredWorker.message.assets, {
  detectionModelUrl: "/ocr/det.tar", recognitionModelUrl: "/ocr/rec.tar", wasmPath: "/ocr/ort/"
}, "viewer model URLs remain the configured assets and cannot change under cached recognition results");
restoredWorker.respond({ lines: [] });
await restoredRecognition;
remembered.dispose(); restored.dispose();
assert.equal(restoredWorker.terminated, true, "disposing viewer controls releases its retained model worker");

stored.clear();
stored.set("hepr.local-text-recognition.enabled.v1", "false");
const oldDisabledFallback = createViewerTextRecognitionControls({ onSettingsChange() {} });
assert.notEqual(oldDisabledFallback.settings, "off", "old local-fallback preference must not disable default browser OCR");
assert.equal(oldDisabledFallback.settings.fallback, undefined);
oldDisabledFallback.dispose();

for (const filename of ["index.html", "three-example.html"]) {
  const html = await readFile(new URL(`../${filename}`, import.meta.url), "utf8");
  const anchor = html.indexOf('id="text-recognition-controls"');
  assert.ok(anchor > html.indexOf('id="text-selection-checkbox"') && anchor < html.indexOf('id="ocr-text-checkbox"'),
    `${filename} must keep automatic OCR beside the existing text settings`);
}

const workers = [];
const assets = { detectionModelUrl: "/local/detection.tar", recognitionModelUrl: "/local/recognition.tar", wasmPath: "/local/wasm/" };
const providerOptions = { assets, detectorMaxSide: 1536, createWorker: () => {
  const worker = new FakeWorker(); workers.push(worker); return worker;
} };
const beforeProvider = constructed;
const provider = createViewerPaddleTextRecognitionProvider(providerOptions);
providerOptions.detectorMaxSide = "source";
assets.recognitionModelUrl = "/changed/recognition.tar";
assert.equal(constructed, beforeProvider, "configured detection limits remain lazy until recognition");
const bytes = Uint8Array.from([1, 2, 3, 255]);
const controller = new AbortController();
const pending = provider.recognize({ width: 1, height: 1, rgba: bytes,
  sourcePageIndex: 0, languages: ["hu"], signal: controller.signal });
assert.notEqual(workers[0].message.rgba.buffer, bytes.buffer, "worker transfer must own a copy");
assert.deepEqual([...bytes], [1, 2, 3, 255]);
assert.equal(workers[0].message.detectorMaxSide, 1536, "worker receives the original numeric detection limit");
assert.deepEqual(workers[0].message.assets, {
  detectionModelUrl: "/local/detection.tar", recognitionModelUrl: "/local/recognition.tar", wasmPath: "/local/wasm/"
}, "detection resizing preserves the configured model and WASM URLs");
controller.abort(new DOMException("Cancelled", "AbortError"));
await assert.rejects(pending, { name: "AbortError" });
assert.equal(workers[0].terminated, true);
const result = { lines: [{ text: "Example", polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] }] };
const retryPending = provider.recognize({ width: 1, height: 1, rgba: bytes,
  sourcePageIndex: 0, languages: [], signal: new AbortController().signal });
assert.equal(workers[1].message.detectorMaxSide, 1536, "cancellation retries retain the immutable detection configuration");
workers[0].dispatchEvent(Object.assign(new Event("error"), { message: "Late error from cancelled worker" }));
assert.notEqual(workers[1].terminated, true, "a stale worker event cannot stop a new recognition attempt");
workers[1].respond(result);
assert.deepEqual(await retryPending, result, "recognition can retry with a fresh worker after cancellation");
const failedPending = provider.recognize({ width: 1, height: 1, rgba: bytes,
  sourcePageIndex: 0, languages: [], signal: new AbortController().signal });
workers[1].dispatchEvent(Object.assign(new Event("message"), { data: { id: workers[1].message.id, error: "Model initialization failed" } }));
await assert.rejects(failedPending, /Model initialization failed/);
assert.equal(workers[1].terminated, true, "failed SDK initialization must release its entire worker heap");
const afterFailure = provider.recognize({ width: 1, height: 1, rgba: bytes,
  sourcePageIndex: 0, languages: [], signal: new AbortController().signal });
workers[2].respond(result);
assert.deepEqual(await afterFailure, result, "failed initialization can retry with a new worker");
provider.dispose();
assert.equal(workers[2].terminated, true);

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(packageJson.devDependencies["@paddleocr/paddleocr-js"], "0.4.2");
for (const key of ["dependencies", "optionalDependencies", "peerDependencies"]) {
  assert.equal(Object.keys(packageJson[key] ?? {}).some(name => /paddleocr|onnxruntime|opencv/.test(name)), false);
}
// Validate the transitive published source graph, including lazy imports and
// worker URL references, rather than checking only the barrel's direct imports.
const visited = new Set();
async function inspectSource(url) {
  if (visited.has(url.href)) return;
  visited.add(url.href);
  const source = await readFile(url, "utf8");
  assert.doesNotMatch(source, /@paddleocr|onnxruntime-web|viewerPaddleOcr|viewerTextRecognition/,
    `published source graph leaked optional viewer runtime: ${url.pathname}`);
  for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\bnew\s+URL\(\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
    const specifier = match[1];
    const target = new URL(/\.[a-z0-9]+$/i.test(specifier) ? specifier : `${specifier}.ts`, url);
    if (!target.pathname.endsWith(".ts")) continue;
    await inspectSource(target);
  }
}
await inspectSource(new URL("../src/index.ts", import.meta.url));
await inspectSource(new URL("../src/nodePdfSource.ts", import.meta.url));
assert.equal(intervals.size, 0, "every UI elapsed timer is released");
for (const [name, descriptor] of originalClock) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
}
if (originalCrypto) Object.defineProperty(globalThis, "crypto", originalCrypto); else delete globalThis.crypto;
console.log("Viewer OCR consent, detection options, warm model/result reuse, active cancellation, backend/elapsed status, ownership and package isolation passed");
