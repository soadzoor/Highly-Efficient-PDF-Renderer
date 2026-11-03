import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";
import { editorUiTestContext } from "./lib/editorUiTestContext.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
const source = await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8");
const method = sourceFunction(source.replace(/^ {2}/gm, ""), "runPresentationChange");
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
try {
  const { createBlankPdfScene } = await import("../src/pdfCreation.ts");
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  function fixture() {
    const scene = createBlankPdfScene({ pageCount: 2 }), session = createEditorSession(scene);
    const id = session.addObject({ kind: "shape", pageIndex: 1, shape: "rectangle", x: 20, y: 40, width: 50, height: 60 }); session.select([id]);
    session.setPreviewTransform([1, 0, 0, 1, 4, 8]);
    const events = [], text = { element: { innerHTML: "Uncommitted text" } }, fields = new Map([[{ value: "Uncommitted form value" }, "baseline"]]), color = { value: "#ff0000" };
    const context = editorUiTestContext({ active: true, session, scenePreparation: null, sceneApplication: null,
      toolbar: { inert: false }, overlay: { inert: false }, activeText: text, fieldDrafts: fields, colorDraft: color,
      contextMenu: { close() { events.push("close-menu"); } },
      cancelPointerGesture(restore) { assert.equal(restore, false); session.setPreviewTransform(null); events.push("cancel-preview"); },
      stopColorPreview(restore) { assert.equal(restore, true); events.push("restore-colors"); },
      host: { onBusyChange(value) { events.push(["busy", value]); } },
      async refreshScene(signal, preview, propagate) { signal.throwIfAborted(); assert.equal(preview, false); assert.equal(propagate, true); events.push("frame"); },
      updatePointerCursor() {}, updateGeometry() { events.push("geometry"); }, updateClipboardButtons() {}, queueColorPreview() { events.push("replay-color-draft"); },
      finishText() { assert.fail("layout changes must retain text drafts"); }, flushEditorFieldDrafts() { assert.fail("layout changes must retain form drafts"); }
    });
    vm.runInContext(method, context);
    return { context, events, session, scene, text, fields, color };
  }
  for (const clean of [false, true]) {
    const f = fixture(); if (clean) f.session.markSaved();
    const before = f.session.getState(), objects = f.session.getObjects(), gate = deferred();
    f.context.sceneApplication = gate.promise;
    const operation = f.context.runPresentationChange(async () => {
      assert(f.context.running && f.context.toolbar.inert && f.context.overlay.inert);
      assert(f.events.includes("frame"), "the old committed scene is acknowledged before pages move");
      f.events.push("layout");
    });
    await tick(); assert(!f.events.includes("layout"), "a layout cannot overtake an in-flight scene publication");
    f.context.sceneApplication = null; gate.resolve(); await operation;
    assert.equal(f.events.filter(value => value === "frame").length, 2, "new layout rebinds the same editor scene after the change");
    assert.equal(f.session.sourceScene, f.scene); assert.deepEqual(f.session.getObjects(), objects);
    assert.deepEqual(f.session.getState(), { ...before, previewing: false }, "view changes do not edit document history or selection");
    assert.equal(f.context.activeText, f.text); assert.equal(f.context.fieldDrafts, f.fields); assert.equal(f.context.colorDraft, f.color);
    assert.deepEqual(f.events.filter(Array.isArray), [["busy", true], ["busy", false]]);
    assert(!f.context.running && !f.context.toolbar.inert && !f.context.overlay.inert);
    assert(f.events.includes("geometry") && f.events.includes("replay-color-draft")); f.session.dispose();
  }
  for (const failure of ["layout", "frame", "new-frame", "abort", "disposed"]) {
    const f = fixture(), abort = new AbortController(), before = f.session.getState();
    if (failure === "frame") f.context.refreshScene = async () => { throw new Error("frame failed"); };
    if (failure === "new-frame") { let frames = 0; f.context.refreshScene = async () => { if (++frames === 2) throw new Error("new frame failed"); }; }
    if (failure === "disposed") f.context.disposed = true;
    const change = async () => { if (failure === "abort") abort.abort(); else if (failure !== "new-frame") throw new Error("layout failed"); };
    await assert.rejects(f.context.runPresentationChange(change, abort.signal));
    assert(!f.context.running && !f.context.toolbar.inert && !f.context.overlay.inert, "failed transitions restore interaction");
    assert.equal(f.session.revision, before.revision); assert.deepEqual(f.session.getSelection(), before.selection);
    assert.equal(f.context.activeText, f.text); assert.equal(f.context.fieldDrafts, f.fields); f.session.dispose();
  }
  for (const busy of ["running", "savePreparing", "structuralRunning", "recoveryRunning"]) {
    const f = fixture(); f.context[busy] = true;
    await assert.rejects(f.context.runPresentationChange(() => assert.fail("busy transitions cannot run")), /Wait for/);
    assert.equal(f.events.length, 0); f.session.dispose();
  }
  console.log("Editor presentation changes preserve document history, selection and drafts while serializing frames, gesture cancellation and failures.");
} finally { hooks.deregister(); }
