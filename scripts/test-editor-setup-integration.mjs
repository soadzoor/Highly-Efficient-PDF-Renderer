import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";
import { waitForLoad } from "../src/loadCancellation.ts";

const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate, detail) { for (let index = 0; index < 30 && !predicate(); index++) await tick(); assert(predicate(), `expected setup checkpoint${detail ? `: ${JSON.stringify(detail)}` : ""}`); }

for (const [file, ensureName, discardName, setName] of [
  ["main.ts", "ensureNativeEditor", "discardNativeEditor", "setNativeEditing"],
  ["three-example.ts", "ensureThreeEditor", "discardThreeEditor", "setThreeEditing"]
]) {
  const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
  assert.match(source, /import \{ createEditorSetupLoading, type EditorSetupLoadingHandle \} from "\.\/editorSetupLoading"/);
  assert.match(source, /import "\.\/editorSetupLoading.css"/);
  assert.match(source, /const editorSetupLoading = createEditorSetupLoading\(\(\) => canvasElement\)/, "dormant View mode only creates the lightweight controller");
  const methods = [setName, "togglePdfEditing", ensureName, discardName].map(name => sourceFunction(source, name).replace(/\bimport\(/g, "importModule(")).join("\n");

  function fixture(kind = "pdf") {
    const events = [], handles = [], hosts = [], scene = { pagesPerRow: 1 }, bytes = new Uint8Array([1]);
    const state = { paintGate: null, prepareGate: null, displayGate: null, importFailure: null, displayFailure: null, currentHandle: null };
    const element = () => ({ checked: false, disabled: false, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; } });
    const button = element();
    const context = vm.createContext({
      AbortController, DOMException, Uint8Array,
      pdfEditor: null, editorInitialization: null, activeEditorSetup: null, editorModeButton: button,
      viewerPrintAction: { refresh() {} },
      editorSetupLoading: { begin(initial) {
        if (state.currentHandle) state.currentHandle.finished = true;
        const handle = { finished: false, report(progress) { if (!this.finished && state.currentHandle === this) events.push(["report", progress.stage, progress.value]); },
          finish() { this.finished = true; if (state.currentHandle === this) { state.currentHandle = null; events.push(["finish"]); } } };
        handles.push(handle); state.currentHandle = handle; events.push(["begin", initial.stage]); return handle;
      } },
      yieldAfterPaint: async signal => { events.push(["paint"]); signal?.throwIfAborted(); if (state.paintGate) await waitForLoad(state.paintGate.promise, signal); signal?.throwIfAborted(); },
      setToolbarIconButton(target, icon, title) { target.icon = icon; target.title = title; },
      setStatus: status => events.push(["status", status]), clearLoadedStatus: () => events.push(["clear"]),
      pendingSourceLoadCount: 0, activeSceneLoadToken: null, layoutChangeRunning: false, backendSwitcher: null,
      lastParsedScene: scene, lastLoadedSource: { kind, bytes, label: "document" }, lastLoadedPdfPassword: undefined,
      lastDownloadablePdf: null, nativeLayout: "reader", canonicalPagesPerRow: 1,
      activePdfPageLoader: { pause() { events.push(["pause"]); }, resume() { events.push(["resume"]); } },
      sourceLoadController: null, pageLayoutWarmingUp: false, backendChangeActive: false,
      currentPdfObject: { sourceKind: kind, sourceBytes: bytes, sourceOptions: {}, sceneData: scene, sourceLabel: "document",
        pausePageLoading() { events.push(["pause"]); }, resumePageLoading() { events.push(["resume"]); } },
      pdfLayersContainer: {}, canvasElement: {}, requestRender() {},
      document: { querySelector: () => element() }, setHudCollapsed() {}, setPanelCollapsed() {},
      createParseBuffer: value => value, getExtractionOptions: () => ({}),
      composeVectorScenesInColumn: pages => pages[0], composeVectorScenesInGrid: pages => pages[0],
      drawingSelection: { disable() {} }, textSelection: { disable() {}, enable() {} }, annotationOverlay: { hide() {} },
      annotationInteraction: { setInteractionEnabled() {} }, textSelectionCheckbox: element(), textSelectionCheckboxElement: element(),
      ocrTextCheckbox: element(), pageStreamingCheckbox: element(), compressScansCheckbox: element(),
      ocrTextCheckboxElement: element(), pageStreamingCheckboxElement: element(), compressScansCheckboxElement: element(), pageLayoutButtons: []
    });
    const load = async (options, signal) => {
      assert.equal(options.compressScans, false); assert.equal(options.ocrTextOnly, false);
      options.onProgress({ value: .25, stage: "pages" });
      if (state.prepareGate) await waitForLoad(state.prepareGate.promise, signal);
      signal.throwIfAborted(); options.onProgress({ value: 1, stage: "pages" }); return scene;
    };
    context.extractPdfPageScenes = async (_bytes, options, signal) => [await load(options, signal)];
    context.importModule = async specifier => {
      events.push(["import", specifier]);
      if (state.importFailure) throw state.importFailure;
      if (specifier === "./editorUi") return { createEditorUi: async (host, signal) => {
        hosts.push(host); host.onSetupProgress({ stage: "document" });
        await host.prepareScene(signal, progress => host.onSetupProgress({ stage: "document", value: progress.value }));
        host.onSetupProgress({ stage: "fields", value: .5 }); signal.throwIfAborted(); host.onSetupProgress({ stage: "session" });
        let active = false;
        const editor = { isEditing: () => active, confirmDocumentChange: () => true,
          async setEditing(value, signal) {
            assert(signal instanceof AbortSignal, "the Cancel action reaches editor scene compilation and presentation");
            signal.throwIfAborted(); active = value; host.setEditing(value);
            if (!value) return;
            host.onSetupProgress({ stage: "display" }); events.push(["display"]);
            assert.equal(button.icon, "cancel", "Cancel remains visible until the first editor scene is drawn");
            try {
              if (state.displayGate) await waitForLoad(state.displayGate.promise, signal);
              if (state.displayFailure) throw state.displayFailure;
              signal.throwIfAborted(); events.push(["presented"]);
            } catch (error) { active = false; host.setEditing(false); throw error; }
          },
          dispose() { active = false; events.push(["dispose"]); },
          attachDocuments: async () => { events.push(["attach"]); assert.equal(active, false); }
        };
        return editor;
      } };
      if (specifier === "./pdfObjectGenerator") return { loadPdfSceneFromSource: async (_bytes, options, signal) => ({ scene: await load(options, signal) }) };
      return { remapEditorPagePoint() {}, waitForEditorScenePresentation() {} };
    };
    vm.runInContext(methods, context);
    return { context, events, handles, hosts, state, button, ensure: (...args) => context[ensureName](...args), discard: () => context[discardName]() };
  }

  for (const kind of ["pdf", "hep"]) {
    const test = fixture(kind); test.state.displayGate = deferred();
    const pending = test.context.togglePdfEditing();
    assert.equal(test.handles.length, 1, `${file}: setup mounts synchronously before the first await`);
    await until(() => test.events.some(([name]) => name === "display"), test.events);
    assert.equal(test.handles.length, 1, "ensure and activation share one uninterrupted indicator");
    assert.equal(test.handles[0].finished, false, "upload completion cannot dismiss the setup before presentation");
    assert(test.events.findIndex(([name]) => name === "paint") < test.events.findIndex(([name]) => name === "import"), "the setup can paint before editor modules evaluate");
    if (kind === "pdf") assert(test.events.some(([name, stage, value]) => name === "report" && stage === "document" && value === .25), "measured page preparation progress is forwarded");
    test.state.displayGate.resolve(); await pending;
    assert.equal(test.handles[0].finished, true); assert.equal(test.context.activeEditorSetup, null);
    assert.equal(test.context.editorInitialization, null); assert.equal(test.button.attributes["aria-busy"], undefined);
    assert(test.events.findIndex(([name]) => name === "presented") < test.events.findIndex(([name]) => name === "finish"));
    assert.equal(test.button.icon, "view");
    await test.context.togglePdfEditing(); assert.equal(test.handles.length, 1, "returning to View does not mount an Edit setup indicator");
    const imports = test.events.filter(([name]) => name === "import").length;
    test.state.displayGate = deferred(); const reentry = test.context.togglePdfEditing();
    await until(() => test.handles.length === 2 && test.events.filter(([name]) => name === "display").length === 2);
    assert.equal(test.handles[1].finished, false); assert.equal(test.events.filter(([name]) => name === "import").length, imports, "cached editor re-entry does not reload modules");
    test.state.displayGate.resolve(); await reentry; assert.equal(test.handles[1].finished, true);
  }

  {
    const test = fixture(); test.state.paintGate = deferred(); const pending = test.context.togglePdfEditing();
    await test.context.togglePdfEditing(); await pending;
    assert.equal(test.handles[0].finished, true); assert.equal(test.context.pdfEditor, null);
    assert.equal(test.events.some(([name]) => name === "import"), false, "Cancel before the first paint prevents module loading");
    assert.equal(test.button.icon, "edit"); assert(test.events.some(([name]) => name === "resume"));
  }
  for (const failure of ["cancel", "upload"]) {
    const test = fixture(); test.state.displayGate = deferred(); const pending = test.context.togglePdfEditing();
    await until(() => test.events.some(([name]) => name === "display"));
    if (failure === "cancel") await test.context.togglePdfEditing();
    else { test.state.displayFailure = new Error("upload failed"); test.state.displayGate.resolve(); }
    await pending; assert.equal(test.handles[0].finished, true); assert.equal(test.context.pdfEditor.isEditing(), false);
    assert(test.events.some(([name]) => name === "resume"), "failed activation restores View page loading even though the initialized editor is cached");
    if (failure === "upload") {
      assert(test.events.some(([name, message]) => name === "status" && /upload failed/.test(message)));
      assert.equal(test.events.some(([name]) => name === "clear"), false, "failed activation must not overwrite the error with loaded status");
    }
    const imports = test.events.filter(([name]) => name === "import").length;
    test.state.displayGate = null; test.state.displayFailure = null; await test.context.togglePdfEditing();
    assert.equal(test.context.pdfEditor.isEditing(), true); assert.equal(test.events.filter(([name]) => name === "import").length, imports, "retry preserves the initialized editing session");
    await test.context.togglePdfEditing();
    const resumptions = test.events.filter(([name]) => name === "resume").length;
    test.state.displayGate = deferred(); const reentry = test.context.togglePdfEditing();
    const displays = test.events.filter(([name]) => name === "display").length;
    await until(() => test.events.filter(([name]) => name === "display").length > displays);
    await test.context.togglePdfEditing(); await reentry;
    assert.equal(test.context.pdfEditor.isEditing(), false);
    assert(test.events.filter(([name]) => name === "resume").length > resumptions, "cancelled cached activation also restores View pagination before a replacement scene is installed");
  }
  {
    const test = fixture(); test.state.importFailure = new Error("editor import failed"); await test.context.togglePdfEditing();
    assert.equal(test.handles[0].finished, true); assert.equal(test.context.pdfEditor, null); assert.equal(test.context.editorInitialization, null);
    test.state.importFailure = null; await test.context.togglePdfEditing(); assert.equal(test.context.pdfEditor.isEditing(), true);
  }
  {
    const test = fixture(), controller = new AbortController(); test.state.prepareGate = deferred();
    const pending = test.ensure(controller.signal); const rejection = assert.rejects(pending, { name: "AbortError" });
    await until(() => test.hosts.length > 0); controller.abort(); await rejection;
    assert.equal(test.handles[0].finished, true, "standalone preparation also cleans up on an external drop cancellation");
  }
  {
    const test = fixture(); const editor = await test.ensure();
    assert.equal(test.handles.length, 1); assert.equal(test.handles[0].finished, true);
    await editor.attachDocuments([]); assert.equal(editor.isEditing(), false, "View-mode attachment prepares without activating editing controls");
  }
  {
    const test = fixture(); await test.ensure(); const oldHost = test.hosts[0];
    test.discard(); test.state.prepareGate = deferred(); const pending = test.context.togglePdfEditing();
    await until(() => test.hosts.length === 2);
    const reports = test.events.filter(([name]) => name === "report").length;
    oldHost.onSetupProgress({ stage: "fields", value: .75 });
    assert.equal(test.events.filter(([name]) => name === "report").length, reports,
      "callbacks from a completed, later disposed editor remain bound to their finished setup handle");
    assert.equal(test.handles[1].finished, false); test.state.prepareGate.resolve(); await pending;
    assert.equal(test.context.pdfEditor.isEditing(), true); assert.equal(test.handles[1].finished, true);
  }
  {
    const test = fixture(); test.state.prepareGate = deferred(); const pending = test.context.togglePdfEditing();
    await until(() => test.hosts.length > 0); const oldHost = test.hosts[0]; test.discard();
    const replacementController = new AbortController(), replacement = test.context.editorSetupLoading.begin({ stage: "loading" });
    test.context.editorInitialization = replacementController; test.context.activeEditorSetup = replacement;
    test.button.setAttribute("aria-busy", "true"); test.button.icon = "cancel";
    oldHost.onSetupProgress({ stage: "fields", value: .75 }); const reports = test.events.filter(([name]) => name === "report").length;
    await pending;
    assert.equal(test.context.editorInitialization, replacementController); assert.equal(test.context.activeEditorSetup, replacement);
    assert.equal(test.button.attributes["aria-busy"], "true"); assert.equal(test.button.icon, "cancel");
    assert.equal(replacement.finished, false, "stale setup cleanup cannot dismiss a replacement operation");
    oldHost.onSetupProgress({ stage: "fields", value: 1 }); assert.equal(test.events.filter(([name]) => name === "report").length, reports, "stale preparation reports cannot enter the replacement indicator");
  }
}

console.log("Editor setup integration: native/Three PDF/HEP, pre-import paint, measured progress, uninterrupted first-draw lifetime, cached re-entry, cancel/retry, View attachment and stale-operation cleanup passed.");
