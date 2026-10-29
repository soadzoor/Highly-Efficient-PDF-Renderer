import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const source = await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8");
// Execute the production initialization before its DOM construction boundary.
const initialize = sourceFunction(source, "createEditorUi").split("  const editorServices = services;")[0] + "  return { session, services };\n}";
function startup({ progress = true, abortStage, failure } = {}) {
  const events = [], controller = new AbortController(), scene = {}, sourcePdf = Uint8Array.of(1, 2);
  let disposedServices = 0, disposedSession = 0, prepareCalls = 0, receivedProgress, fieldProgress;
  const session = { dispose() { disposedSession++; } };
  const context = vm.createContext({ AbortController,
    yieldAfterPaint: async signal => { events.push(["paint", events.at(-1)?.[1]]); if (events.at(-1)[1] === abortStage) controller.abort(); signal.throwIfAborted(); },
    createEditorAppServices: async options => {
      assert.equal(options.sourcePdf, sourcePdf);
      fieldProgress = options.onPrepareProgress;
      return { sessionOptions: { prepareScene: async value => {
        assert.equal(value, scene); for (const fraction of [0, .25, .5, 1]) options.onPrepareProgress?.(fraction); return scene;
      } }, dispose() { disposedServices++; } };
    },
    openEditorSession: async (value, options) => {
      if (failure === "session") throw new Error("Session failed");
      await options.prepareScene(value, options.signal); return session;
    }
  });
  vm.runInContext(initialize, context);
  const host = { getSource: () => ({ pdf: sourcePdf, label: "fixture.pdf" }),
    async prepareScene(signal, onProgress) {
      prepareCalls++; receivedProgress = onProgress;
      signal.throwIfAborted(); if (failure === "document") throw new Error("Document failed");
      for (const value of [0, .5, 1]) onProgress?.({ stage: "compile", value }); return scene;
    }, ...(progress ? { onSetupProgress: item => events.push(["progress", item.stage, item.value]) } : {}) };
  return { run: () => context.createEditorUi(host, controller.signal), events,
    lateProgress() { receivedProgress?.({ value: .875 }); fieldProgress?.(.875); },
    counts: () => ({ disposedServices, disposedSession, prepareCalls, receivedProgress }) };
}
const initial = startup(); await initial.run();
assert.deepEqual(initial.events.filter(item => item[0] === "progress"), [
  ["progress", "document", undefined], ["progress", "document", 0], ["progress", "document", .5], ["progress", "document", 1],
  ["progress", "fields", undefined], ["progress", "fields", 0], ["progress", "fields", .25], ["progress", "fields", .5], ["progress", "fields", 1],
  ["progress", "session", undefined]
]);
assert.deepEqual(initial.events.filter(item => item[0] === "paint"), [["paint", "document"], ["paint", "fields"], ["paint", "session"]],
  "each synchronous preparation boundary allows its stage to paint");
const unobserved = startup({ progress: false }); await unobserved.run();
assert.deepEqual(unobserved.events, [], "hosts without a setup indicator incur no setup paint waits");
assert.equal(unobserved.counts().receivedProgress, undefined);
for (const stage of ["document", "fields", "session"]) {
  const cancelled = startup({ abortStage: stage }); await assert.rejects(cancelled.run(), { name: "AbortError" });
  assert.equal(cancelled.counts().prepareCalls, stage === "document" ? 0 : 1);
  assert.equal(cancelled.counts().disposedServices, stage === "session" ? 1 : 0);
  assert.equal(cancelled.counts().disposedSession, stage === "session" ? 1 : 0, "abort after session creation releases the initialized session");
  const progressCount = cancelled.events.length; cancelled.lateProgress();
  assert.equal(cancelled.events.length, progressCount, "late setup callbacks cannot update a cancelled indicator");
}
for (const failure of ["document", "session"]) {
  const broken = startup({ failure }); await assert.rejects(broken.run(), /failed/);
  assert.equal(broken.counts().disposedServices, failure === "session" ? 1 : 0);
}

const methodStart = source.indexOf("    async setEditing(value, externalSignal) {"), methodEnd = source.indexOf("\n    },\n    isEditing:", methodStart);
assert(methodStart >= 0 && methodEnd > methodStart);
const activate = source.slice(methodStart, methodEnd).replace("async setEditing", "async function setEditing") + "\n}";
function activation(mode = "success") {
  const events = [], controller = new AbortController(); let subscriptions = 0, releases = 0, ticks = 0;
  const classes = new Set(), context = vm.createContext({ AbortController, AbortSignal,
    disposed: false, structuralRunning: false, active: false, lifetime: new AbortController(), frame: 1,
    contextMenu: { close() {} }, toolbar: { hidden: true }, overlay: { hidden: true }, layerDialog: null, releaseFrameListener: null,
    layerControls: { setActive: value => events.push(["layers", value]) },
    document: { body: { classList: { toggle(name, value) { if (value) classes.add(name); else classes.delete(name); }, remove: name => classes.delete(name) } } },
    window: { cancelAnimationFrame: () => events.push(["cancelFrame"]) }, updateGeometry() {}, tick: () => { ticks++; },
    host: { onSetupProgress: progress => events.push(["progress", progress.stage]),
      subscribeToFrames() { subscriptions++; return () => { releases++; }; },
      setEditing: value => events.push(["editing", value]), onModeChange: value => events.push(["mode", value]) },
    yieldAfterPaint: async signal => { events.push(["paint"]); if (mode === "cancel-paint") controller.abort(); signal.throwIfAborted(); },
    refreshScene: async (signal, preview, propagateError) => {
      assert.equal(preview, false); assert.equal(propagateError, true); events.push(["refresh"]);
      if (mode === "error") throw new Error("Upload failed");
      if (mode === "cancel-compile") controller.abort();
      if (mode === "disposed") { context.disposed = true; context.active = false; context.lifetime.abort(); }
      signal.throwIfAborted();
    }
  });
  vm.runInContext(activate, context);
  return { run: () => context.setEditing(true, controller.signal), events, context, classes, counts: () => ({ subscriptions, releases, ticks }) };
}
const activated = activation(); await activated.run();
assert.equal(activated.context.active, true); assert.equal(activated.context.toolbar.hidden, false);
assert(activated.classes.has("hepr-editing")); assert.equal(activated.counts().ticks, 1);
assert(activated.events.findIndex(item => item[0] === "progress") < activated.events.findIndex(item => item[0] === "refresh"));
for (const mode of ["cancel-paint", "cancel-compile", "error"]) {
  const failed = activation(mode); await assert.rejects(failed.run(), mode === "error" ? /Upload failed/ : { name: "AbortError" });
  assert.equal(failed.context.active, false); assert.equal(failed.context.toolbar.hidden, true); assert.equal(failed.context.overlay.hidden, true);
  assert(!failed.classes.has("hepr-editing")); assert.equal(failed.counts().releases, 1); assert.equal(failed.counts().ticks, 0);
  assert.deepEqual(failed.events.filter(item => item[0] === "editing"), [["editing", true], ["editing", false]], "failed entry restores the host's viewing controls");
}
const disposed = activation("disposed"); await assert.rejects(disposed.run(), { name: "AbortError" });
assert.equal(disposed.context.active, false); assert.equal(disposed.counts().ticks, 0, "disposed entry cannot restart its animation loop");

for (const failure of ["compile", "apply"]) {
  const reports = [], context = vm.createContext({ AbortController, AbortSignal, renderRevision: 0, scenePreparation: null,
    pendingDrawings: { capture() {}, acknowledge() {} },
    sceneApplication: null, lifetime: new AbortController(), disposed: false, active: true, tool: "select", requestedPreview: null,
    synchronizeDocumentSource: async () => {}, updatePointerCursor() {}, updateGeometry() {}, report: error => reports.push(error),
    session: { sourceScene: {}, getState: () => ({ revision: 0, selection: [] }), getSelectionFrame: () => null,
      async getScene() { if (failure === "compile") throw new Error("Compile failed"); return {}; } },
    host: { async applyScene() { throw new Error("Apply failed"); } }
  });
  vm.runInContext(sourceFunction(source.replace(/^ {2}/gm, ""), "refreshScene"), context);
  await assert.rejects(context.refreshScene(undefined, false, true), /failed/);
  assert.equal(reports.length, 0, "activation errors reach the setup caller without a second status report");
  assert.equal(context.scenePreparation, null); assert.equal(context.sceneApplication, null);
  await context.refreshScene(); assert.equal(reports.length, 1, "ordinary edit refreshes keep their existing error reporting");
}

const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const bytes = fixture(), parser = await openPdf({ kind: "bytes", bytes });
  const progress = [], services = await createEditorAppServices({ sourcePdf: bytes,
    onPrepareProgress: value => progress.push(value), loadFontAsset: async url => new Uint8Array(await readFile(url)) });
  try {
    const pages = await Promise.all([0, 1].map(index => parser.compileVectorPage(index, { optimization: "none" })));
    const scene = composeVectorScenesInGrid(pages, 1), prepared = await services.sessionOptions.prepareScene(scene);
    assert.equal(prepared.annotations.filter(annotation => annotation.field?.textStyle).length, 4, "measured progress still prepares every field style");
    assert.deepEqual(progress, [0, .25, .5, .5, .75, 1, 1, 1], "field preparation measures widgets across their source pages");
    assert(progress.every((value, index) => Number.isFinite(value) && value >= 0 && value <= 1 && (!index || value >= progress[index - 1])));
    progress.length = 0;
    await assert.rejects(services.sessionOptions.prepareScene(scene, AbortSignal.abort()), { name: "AbortError" });
    assert.deepEqual(progress, [], "already cancelled preparation emits no misleading progress");
    await services.sessionOptions.prepareScene(createEmptyVectorScene()); assert.deepEqual(progress, [0, 1]);
    const cancelled = new AbortController(), partial = [];
    const cancellable = await createEditorAppServices({ sourcePdf: bytes,
      onPrepareProgress: value => { partial.push(value); if (value > 0) cancelled.abort(); },
      loadFontAsset: async url => new Uint8Array(await readFile(url)) });
    try {
      await assert.rejects(cancellable.sessionOptions.prepareScene(scene, cancelled.signal), { name: "AbortError" });
      assert.deepEqual(partial, [0, .25], "cancelled widget preparation never claims phase completion");
    } finally { cancellable.dispose(); }
  } finally { services.dispose(); await parser.close(); }
} finally { hooks.deregister(); }
console.log("Editor setup progress: measured pages/widgets, paint boundaries, optional callbacks, cancellation cleanup and failed activation rollback passed.");

function fixture() {
  const widget = name => `<< /Type /Annot /Subtype /Widget /FT /Tx /T (${name}) /Rect [10 10 80 30] /V () /AP << /N 8 0 R >> >>`;
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /AcroForm 7 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 5 0 R /Annots [10 0 R 11 0 R] >>" },
    { number: 4, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 5 0 R /Annots [12 0 R 13 0 R] >>" },
    { number: 5, body: tinyPdfStream("", "0 g 0 0 1 1 re f") },
    { number: 6, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" },
    { number: 7, body: "<< /Fields [10 0 R 11 0 R 12 0 R 13 0 R] /DR << /Font << /Helv 6 0 R >> >> /DA (/Helv 10 Tf 0 g) >>" },
    { number: 8, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 70 20]", "") },
    ...["A", "B", "C", "D"].map((name, index) => ({ number: index + 10, body: widget(name) }))
  ] });
}
