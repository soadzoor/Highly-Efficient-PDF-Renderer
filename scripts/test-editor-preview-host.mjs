import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";
import { waitForLoad } from "../src/loadCancellation.ts";
import { waitForEditorScenePresentation } from "../src/editorPresentation.ts";

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(test) { for (let i = 0; i < 30 && !test(); i++) await tick(); assert(test(), "expected host checkpoint"); }
// Preserve actual host method bodies and closure references without importing
// either app's DOM entry point. The enclosing production function is extracted
// with the same helper used by the other demo orchestration regressions.
async function hostSource(file) {
  const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8"), enclosing = sourceFunction(source, file === "main.ts" ? "ensureNativeEditor" : "ensureThreeEditor");
  const start = enclosing.indexOf("        documentChanged("), end = enclosing.indexOf("        clientToScenePoint:", start);
  assert(start >= 0 && end > start, `${file} editor host method boundaries`);
  const placementStart = enclosing.indexOf("const sourcePlacementMatches = "), placementEnd = enclosing.indexOf(";\n", placementStart);
  const placement = placementStart < 0 ? "" : `globalThis.sourcePlacementMatches = ${enclosing.slice(placementStart + "const sourcePlacementMatches = ".length, placementEnd)};`;
  return stripTypeScriptTypes(`${placement}\nglobalThis.host = {${enclosing.slice(start, end)}};`);
}
const nativeSource = await hostSource("main.ts"), threeSource = await hostSource("three-example.ts");

function nativeFixture() {
  const calls = [], state = { eligible: true, backendGate: null }, initial = { id: "original", pagesPerRow: 2, pageRects: {} }, originalPages = [{ id: "page" }], view = { zoom: 2 };
  const count = name => calls.filter(call => call[0] === name).length;
  const makeRenderer = label => ({ label, listener: null,
    getViewState() { calls.push(["view", label]); return view; },
    setViewState(value) { assert.equal(value, view); calls.push(["setView", label]); },
    updateEditorPreviewScene(scene) { calls.push(["partial", label, scene]); return state.eligible; },
    setScene(scene, options) { assert.equal(options.preserveRasterResolution, true); calls.push(["upload", label, scene]); },
    setFrameListener(listener) { this.listener = listener; }
  });
  const originalRenderer = makeRenderer("original"), loader = { close() { calls.push(["closeLoader"]); } };
  const context = vm.createContext({ AbortController, DOMException, Uint8Array, waitForLoad, waitForEditorScenePresentation,
    renderer: originalRenderer, backendSwitcher: { runWhenIdle(callback) { calls.push(["backendWait"]); return (state.backendGate?.promise ?? Promise.resolve()).then(callback); } },
    editorSceneApplicationActive: false, updateBackendSelectDisabledState() { calls.push(["busy", context.editorSceneApplicationActive]); },
    nativeLayout: "reader", editSourceLayout: "reader", canonicalPagesPerRow: 2, editSourceScene: initial, initialEditScene: initial, originalLayout: "reader",
    pendingEditorSource: null, originalSource: { kind: "pdf", bytes: Uint8Array.of(1), label: "original" }, originalPassword: "old", originalDownload: {},
    lastParsedScene: initial, lastCanonicalScene: initial, documentPageScenes: originalPages, activePdfPageLoader: loader, parsedPdfPageCache: {},
    lastLoadedSource: null, lastLoadedPdfPassword: null, lastDownloadablePdf: null,
    ScenePageViews: class { constructor(scene) { this.pages = scene.pages ?? [scene]; this.pageCount = this.pages.length; calls.push(["partition", scene]); } extract(index) { return { scene: this.pages[index] }; } },
    composeVectorScenesInGrid(pages, columns) { calls.push(["grid", pages, columns]); return { id: "canonical", pages }; },
    composeVectorScenesInColumn(pages) { calls.push(["column", pages]); return { id: "reader", pages }; },
    readerViewport: { snapshot() { calls.push(["snapshot"]); return view; }, restore(value) { assert.equal(value, view); calls.push(["restore"]); }, invalidateThumbnails() { calls.push(["thumbnails"]); } },
    updateNativePresentation(...args) { calls.push(["presentation", ...args]); }, setDownloadPdfButtonState() { calls.push(["download"]); },
    textSearchController: { setScene(scene) { calls.push(["searchGeometry", scene]); } },
    applyTextSearchScene(scene) { calls.push(["searchLayers", scene]); }, onRendererFrame() { calls.push(["frame"]); }
  });
  vm.runInContext(nativeSource, context);
  return { context, calls, count, state, initial, originalPages, originalRenderer, makeRenderer,
    apply: (scene, onPresented, options = { preview: true }, signal = new AbortController().signal) => context.host.applyScene(scene, signal, onPresented, options),
    frame: renderer => (renderer ?? context.renderer).listener?.({}) };
}

for (const eligible of [true, false]) {
  const f = nativeFixture(); f.state.eligible = eligible; const next = { id: "pose", pagesPerRow: 2 }; let ack = 0, finished = false;
  const work = f.apply(next, () => ack++).then(() => { finished = true; });
  await until(() => f.originalRenderer.listener);
  assert.equal(f.context.editorSceneApplicationActive, true); assert.equal(ack, 0); assert.equal(finished, false, "uploads do not acknowledge an undrawn generation");
  assert.equal(f.count("partial"), 1); assert.equal(f.count("upload"), eligible ? 0 : 1);
  for (const name of ["partition", "grid", "column", "searchLayers", "thumbnails", "closeLoader", "presentation"]) assert.equal(f.count(name), 0, `native preview skips ${name}`);
  assert.equal(f.context.documentPageScenes, f.originalPages); assert.equal(f.context.lastCanonicalScene, f.initial);
  assert.equal(f.context.lastParsedScene, next); assert.equal(f.count("searchGeometry"), 1, "lightweight search geometry follows the visible pose");
  f.frame(); await work; assert.equal(ack, 1); assert.equal(f.count("frame"), 1); assert.equal(f.context.editorSceneApplicationActive, false);
  assert.equal(f.originalRenderer.listener, f.context.onRendererFrame, "the transient listener restores the ordinary frame callback");
}
{
  const f = nativeFixture(), next = { id: "committed", pages: [{ id: "page0" }, { id: "page1" }] };
  await f.apply(next, undefined, { preview: false });
  assert.equal(f.count("partial"), 0); assert.equal(f.count("upload"), 1); assert.equal(f.count("partition"), 1);
  for (const name of ["grid", "searchLayers", "thumbnails", "closeLoader"]) assert.equal(f.count(name), 1, `native commit refreshes ${name}`);
  assert.deepEqual(Array.from(f.context.documentPageScenes), next.pages); assert.equal(f.context.activePdfPageLoader, null); assert.equal(f.context.parsedPdfPageCache, null);
}
{
  const f = nativeFixture(), bytes = Uint8Array.of(7), next = { id: "structural", pages: [{ id: "newPage" }], pageRects: {} };
  f.context.host.documentChanged(next, { pdf: bytes, password: "new", label: "merged" });
  await f.apply(next);
  assert.equal(f.count("partial"), 0); assert.equal(f.count("partition"), 1); assert.equal(f.count("column"), 1);
  assert.equal(f.count("presentation"), 1); assert.equal(f.count("searchLayers"), 1); assert.equal(f.count("thumbnails"), 1);
  assert.equal(f.context.lastLoadedSource.bytes, bytes); assert.equal(f.context.lastLoadedPdfPassword, "new"); assert.equal(f.context.pendingEditorSource, null);
}
{
  const f = nativeFixture(); f.context.editSourceLayout = "grid"; await f.apply({ id: "pose-other-layout" });
  assert.equal(f.count("partial"), 0); assert.equal(f.count("partition"), 1); assert.equal(f.count("column"), 1, "a changed layout uses full page composition");
}
{
  const f = nativeFixture(); f.state.backendGate = deferred(); const next = { id: "waiting-pose" }; let ack = 0;
  const work = f.apply(next, () => ack++); await until(() => f.count("backendWait"));
  assert.equal(f.count("partial"), 0); assert.equal(f.count("upload"), 0); assert.equal(f.context.editorSceneApplicationActive, true);
  const replacement = f.makeRenderer("replacement"); f.context.renderer = replacement; f.state.backendGate.resolve();
  await until(() => replacement.listener); assert.equal(f.calls.find(call => call[0] === "partial")[1], "replacement");
  f.frame(f.originalRenderer); assert.equal(ack, 0); f.frame(replacement); await work; assert.equal(ack, 1);
}
for (const mismatch of ["renderer", "scene", "abort"]) {
  const f = nativeFixture(), controller = new AbortController(); let ack = 0;
  const work = f.apply({ id: "pose" }, () => ack++, undefined, controller.signal), rejection = assert.rejects(work, { name: "AbortError" });
  await until(() => f.originalRenderer.listener);
  if (mismatch === "renderer") f.context.renderer = f.makeRenderer("replacement");
  else if (mismatch === "scene") f.context.lastParsedScene = {};
  else controller.abort();
  f.frame(f.originalRenderer); await rejection; assert.equal(ack, 0); assert.equal(f.context.editorSceneApplicationActive, false);
}

function threeFixture() {
  const calls = [], state = { eligible: true, createGate: null }, options = { textLod: "auto", vectorLod: "auto", backend: "webgl" };
  const count = name => calls.filter(call => call[0] === name).length;
  const makeObject = label => ({ label, sceneData: { id: label }, sourceKind: "pdf", sourceLabel: "document", sourceBytes: Uint8Array.of(1), sourceOptions: { password: "old" },
    position: { copy() { calls.push(["position"]); } }, quaternion: { copy() { calls.push(["quaternion"]); } }, scale: { copy() { calls.push(["scale"]); } },
    updateEditorPreviewScene(scene) { calls.push(["partial", scene]); if (state.eligible) this.sceneData = scene; return state.eligible; }, dispose() { calls.push(["dispose", label]); }
  });
  const original = makeObject("original");
  const context = vm.createContext({ AbortController, DOMException, Uint8Array, waitForLoad, waitForEditorScenePresentation,
    editorSceneApplicationActive: false, backendChangeCompletion: Promise.resolve(), currentPdfObject: original, editedSource: null,
    originalSource: { sourceKind: original.sourceKind, sourceBytes: original.sourceBytes, sourceOptions: original.sourceOptions }, renderer: {},
    updateThreeBackendSelectDisabledState() { calls.push(["busy", context.editorSceneApplicationActive]); }, requestRender() { calls.push(["render"]); },
    pendingRenderedFrameResolvers: [], captureCameraSnapshot() { calls.push(["captureCamera"]); return {}; }, restoreCameraSnapshot() { calls.push(["restoreCamera"]); },
    readThreeObjectOptions() { calls.push(["options"]); return options; }, getEditorSceneTranslationHint(scene) { return scene.hint; },
    async createThreePdfObject(input, received, signal) { calls.push(["create", input, received]); if (state.createGate) await state.createGate.promise; signal.throwIfAborted(); const next = makeObject("next"); next.sceneData = input.scene; return next; },
    async preparePageLayoutReplacement(next) { calls.push(["layout", next]); return {}; },
    replacePdfObject(next) { calls.push(["replace", next]); context.currentPdfObject = next; }, activePageLayout: "reader",
    updateSceneMetrics() { calls.push(["metrics"]); }, reader: { invalidateThumbnails() { calls.push(["thumbnails"]); } }
  });
  vm.runInContext(threeSource, context);
  return { context, state, calls, count, original, options, makeObject,
    apply: (scene, onPresented, received = { preview: true }, signal = new AbortController().signal) => context.host.applyScene(scene, signal, onPresented, received),
    frame() { for (const notify of context.pendingRenderedFrameResolvers.splice(0)) notify(); } };
}
{
  const f = threeFixture(), pose = { id: "pose", hint: {} }; let ack = 0;
  const work = f.apply(pose, () => ack++); await until(() => f.context.pendingRenderedFrameResolvers.length);
  assert.equal(f.context.currentPdfObject, f.original); assert.equal(f.original.sceneData, pose); assert.equal(ack, 0);
  for (const name of ["create", "captureCamera", "restoreCamera", "layout", "replace", "metrics", "thumbnails", "options"]) assert.equal(f.count(name), 0, `Three preview skips ${name}`);
  assert.equal(f.count("partial"), 1); assert.equal(f.count("render"), 1); assert.equal(f.context.editorSceneApplicationActive, true);
  f.frame(); await work; assert.equal(ack, 1); assert.equal(f.context.pendingRenderedFrameResolvers.length, 0); assert.equal(f.context.editorSceneApplicationActive, false);
}
for (const preview of [true, false]) for (const hinted of [true, false]) {
  const f = threeFixture(); f.state.eligible = false; const pose = { id: "pose", ...(hinted ? { hint: {} } : {}) }; let ack = 0;
  const work = f.apply(pose, () => ack++, { preview }); await until(() => f.context.pendingRenderedFrameResolvers.length);
  const create = f.calls.find(call => call[0] === "create"), received = create[2];
  assert.equal(f.count("create"), 1); assert.equal(f.count("replace"), 1); assert.equal(f.count("layout"), 1);
  assert.equal(f.count("captureCamera"), 1); assert.equal(f.count("restoreCamera"), 1);
  assert.equal(received.textLod, preview && hinted ? "off" : "auto"); assert.equal(received.vectorLod, preview && hinted ? "off" : "auto");
  assert.equal(f.options.textLod, "auto"); assert.equal(f.options.vectorLod, "auto", "transient exact rendering never changes user options");
  assert.equal(f.count("metrics"), preview ? 0 : 1); assert.equal(f.count("thumbnails"), preview ? 0 : 1);
  assert.equal(f.count("partial"), preview ? 1 : 0); assert.equal(ack, 0); assert.notEqual(f.context.currentPdfObject, f.original);
  f.frame(); await work; assert.equal(ack, 1);
}
{
  const f = threeFixture(), bytes = Uint8Array.of(7), pose = { id: "structural", hint: {} };
  f.context.host.documentChanged(pose, { pdf: bytes, password: "new" }); await f.apply(pose);
  assert.equal(f.count("partial"), 0, "structural source changes always replace the complete object"); assert.equal(f.count("create"), 1);
  const source = f.calls.find(call => call[0] === "create")[1]; assert.equal(source.sourceBytes, bytes); assert.equal(source.sourceOptions.password, "new");
}
{
  const f = threeFixture(), gate = deferred(); f.context.backendChangeCompletion = gate.promise; let ack = 0;
  const work = f.apply({ id: "afterBackend" }, () => ack++); await tick();
  assert.equal(f.count("partial"), 0); assert.equal(f.count("create"), 0); assert.equal(f.context.editorSceneApplicationActive, true);
  f.context.currentPdfObject = f.makeObject("replacement"); gate.resolve(); await until(() => f.context.pendingRenderedFrameResolvers.length);
  assert.equal(f.original.sceneData.id, "original"); assert.equal(f.context.currentPdfObject.sceneData.id, "afterBackend");
  f.frame(); await work; assert.equal(ack, 1);
}
for (const mismatch of ["renderer", "object", "scene", "abort"]) {
  const f = threeFixture(), controller = new AbortController(); let ack = 0;
  const work = f.apply({ id: "pose" }, () => ack++, undefined, controller.signal), rejection = assert.rejects(work, { name: "AbortError" });
  await until(() => f.context.pendingRenderedFrameResolvers.length);
  if (mismatch === "renderer") f.context.renderer = {};
  else if (mismatch === "object") f.context.currentPdfObject = f.makeObject("replacement");
  else if (mismatch === "scene") f.original.sceneData = {};
  else controller.abort();
  f.frame(); await rejection; assert.equal(ack, 0); assert.equal(f.context.editorSceneApplicationActive, false); assert.equal(f.context.pendingRenderedFrameResolvers.length, 0);
}
console.log("Editor host previews: actual native/Three methods skip document rebuilds, preserve full commit/source paths, wait for backend handoff and acknowledge only matching drawn generations.");
