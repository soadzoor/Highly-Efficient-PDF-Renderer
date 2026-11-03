import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createBlankPdfScene } = await import("../src/pdfCreation.ts");
  const { composeVectorScenesInColumn, composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { ScenePageViews } = await import("../src/scenePageViews.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { remapEditorPagePoint } = await import("../src/editorCoordinates.ts");
  const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const ensure = sourceFunction(source, "ensureNativeEditor");
  const methodsStart = ensure.indexOf("        documentChanged("), methodsEnd = ensure.indexOf("        subscribeToFrames(", methodsStart);
  const placementStart = ensure.indexOf("const sourcePlacementMatches = "), placementEnd = ensure.indexOf(";\n", placementStart);
  assert(methodsStart >= 0 && methodsEnd > methodsStart && placementStart >= 0 && placementEnd > placementStart);
  const fixture = async initialLayout => {
    const blank = createBlankPdfScene({ pageSize: { width: 100, height: 200 }, pageCount: 2 });
    const blankViews = new ScenePageViews(blank), pages = Array.from({ length: 2 }, (_, index) => blankViews.extract(index).scene);
    const canonical = composeVectorScenesInGrid(pages, 2), editSourceScene = initialLayout === "reader" ? composeVectorScenesInColumn(pages) : canonical;
    const session = await openEditorSession(editSourceScene);
    const id = session.addObject({ kind: "shape", shape: "rectangle", pageIndex: 1, x: 20, y: 30, width: 25, height: 40, fill: "#ff0000" });
    session.select([id]);
    let busy = false, failure = false, camera = { cameraCenterX: 0, cameraCenterY: 0, zoom: 1 };
    const layoutSelect = { value: initialLayout, disabled: false }, calls = [], statuses = [];
    const element = () => ({ checked: false, disabled: false });
    const document = { querySelector: () => layoutSelect }, noop = () => {};
    const context = vm.createContext({ AbortController, Uint8Array, Error,
      document, lastParsedScene: editSourceScene, lastCanonicalScene: canonical, documentPageScenes: pages,
      editSourceScene, initialEditScene: editSourceScene, originalLayout: initialLayout, editSourceLayout: initialLayout,
      lastLoadedSource: { kind: "hep", bytes: Uint8Array.of(1) }, lastParsedSceneLabel: "layout.hep", nativeLayout: initialLayout,
      originalSource: {}, originalPassword: undefined, originalDownload: null, pendingEditorSource: null,
      lastLoadedPdfPassword: undefined, lastDownloadablePdf: null, activePdfPageLoader: null, parsedPdfPageCache: null,
      layoutChangeRunning: false, editorSceneApplicationActive: false, editorInitialization: null,
      activeSceneLoadToken: null, pendingSourceLoadCount: 0, activeHepExportController: null,
      canonicalPagesPerRow: 2, gridViewState: null, readerViewState: null,
      canvasElement: { width: 1000, getBoundingClientRect: () => ({ width: 1000 }) },
      renderer: { getViewState: () => camera, setViewState: next => { camera = next; }, fitToBounds: noop,
        setScene(scene) { calls.push(["upload", scene]); context.lastParsedScene = scene; },
        clientToScenePoint: (x, y) => ({ x, y }), sceneToClientPoint: (x, y) => ({ x, y }) },
      readerViewport: { snapshot: () => ({ view: camera }), restore: value => { camera = value.view; },
        setLayout: value => { layoutSelect.value = value; }, goToPage: noop, invalidateThumbnails: noop },
      backendSwitcher: { isSwitchInFlight: () => false, getActiveBackend: () => "webgl", runWhenIdle: callback => Promise.resolve(callback()) },
      backendSelectElement: { disabled: false, ownerDocument: document },
      ocrTextCheckbox: element(), compressScansCheckbox: element(), pageStreamingCheckbox: element(),
      textSelectionCheckbox: element(), textSelection: { disable: noop, enable: noop }, drawingSelection: { disable: noop },
      annotationOverlay: { hide: noop }, annotationInteraction: null,
      editorModeButton: { setAttribute: noop }, setToolbarIconButton: noop, viewerPrintAction: { refresh: noop },
      uiControlManager: { readVectorLodModeInput: () => "off" },
      resolveSceneFitBounds: scene => scene.pageBounds, readerCaptureAnchor: () => ({ pageIndex: 1 }),
      reuseTextLodForPageTranslation: () => true, prebuildTextLod: async () => {},
      prebuildVectorStrokeLodRuntime: async () => { if (failure) throw new Error("layout upload failed"); },
      uploadSceneWithRollback: (_renderer, scene) => { calls.push(["layout-upload", scene]); return {}; },
      updateNativePresentation: (layout, displayed) => { context.nativeLayout = layout; layoutSelect.value = layout; calls.push(["layout", layout, displayed]); },
      layerVisibility: { sceneChanged: async () => {} }, applyTextSearchScene: noop, updateMetricsPanel: noop,
      textSearchController: { setScene: noop }, setDownloadPdfButtonState: noop,
      prepareSceneForHepRendering: value => value, scheduleDemandPdfUpdate: noop, demandPdfUpdatePending: false,
      composeVectorScenesInColumn, composeVectorScenesInGrid, ScenePageViews, remapEditorPagePoint,
      colorPreview: { beforeSceneChange: noop, bind: noop },
      async waitForLoad(promise, signal) { signal?.throwIfAborted(); const value = await promise; signal?.throwIfAborted(); return value; },
      setStatus: value => statuses.push(value)
    });
    vm.runInContext(stripTypeScriptTypes(`const sourcePlacementMatches = ${ensure.slice(placementStart + "const sourcePlacementMatches = ".length, placementEnd)};\nglobalThis.host = {${ensure.slice(methodsStart, methodsEnd)}};`), context);
    for (const name of ["updateBackendSelectDisabledState", "setNativeEditing", "changeNativeLayout"]) vm.runInContext(sourceFunction(source, name), context);
    const publish = async () => context.host.applyScene(await session.getScene({ preview: false }), new AbortController().signal);
    const editor = context.pdfEditor = { isEditing: () => true, isBusy: () => busy,
      async runPresentationChange(change) {
        assert.equal(busy, false); busy = true;
        try { await publish(); await change(); await publish(); }
        finally { busy = false; context.updateBackendSelectDisabledState(); }
      } };
    await publish();
    return { context, session, editor, id, layoutSelect, calls, statuses, publish,
      setBusy(value) { busy = value; }, fail(value) { failure = value; } };
  };
  for (const initialLayout of ["reader", "grid"]) {
    const f = await fixture(initialLayout), initialRevision = f.session.revision, original = f.session.sourceScene;
    try {
      f.context.setNativeEditing(true); assert.equal(f.layoutSelect.disabled, false, "idle Edit mode leaves Reader/Grid selectable");
      for (const layout of [initialLayout === "reader" ? "grid" : "reader", initialLayout, initialLayout === "reader" ? "grid" : "reader"]) {
        f.layoutSelect.value = layout; await f.context.changeNativeLayout(layout);
        assert.equal(f.context.nativeLayout, layout); assert.equal(f.context.pdfEditor, f.editor);
        assert.equal(f.session.sourceScene, original, "layout is presentation, not a source replacement");
        assert.equal(f.session.revision, initialRevision, "layout adds no edit-history operation");
        assert.deepEqual(f.session.getSelection(), [f.id]); assert(f.session.getState().canUndo);
        const sourcePoint = { x: original.pageRects[4] + 25, y: original.pageRects[5] + 35 };
        const expected = { x: f.context.lastParsedScene.pageRects[4] + 25, y: f.context.lastParsedScene.pageRects[5] + 35 };
        const projected = f.context.host.sceneToClientPoint(sourcePoint.x, sourcePoint.y, 1);
        assert.deepEqual({ ...projected }, expected, "selection and draft geometry project into the current page placement");
        assert.deepEqual({ ...f.context.host.clientToScenePoint(expected.x, expected.y, 1) }, sourcePoint, "new drawing/picking points return to stable session coordinates");
        assert(f.context.lastParsedScene.fillPathCount > 0, "authored content survives each layout switch");
        assert.equal(f.layoutSelect.disabled, false);
      }
      const before = f.context.nativeLayout, next = before === "reader" ? "grid" : "reader";
      f.setBusy(true); f.context.updateBackendSelectDisabledState(); assert(f.layoutSelect.disabled);
      f.layoutSelect.value = next; await f.context.changeNativeLayout(next); assert.equal(f.layoutSelect.value, before);
      f.setBusy(false); f.context.updateBackendSelectDisabledState();
      f.context.editorInitialization = new AbortController(); f.layoutSelect.value = next;
      await f.context.changeNativeLayout(next); assert.equal(f.context.nativeLayout, before); assert.equal(f.layoutSelect.value, before);
      f.context.editorInitialization = null;
      f.fail(true); f.layoutSelect.value = next; await f.context.changeNativeLayout(next);
      assert.equal(f.context.nativeLayout, before, "failed preparation restores the previous layout");
      assert.equal(f.layoutSelect.value, before); assert.equal(f.session.revision, initialRevision); assert.deepEqual(f.session.getSelection(), [f.id]);
      assert.match(f.statuses.at(-1), /Failed to change layout/);
      f.fail(false); f.session.updateObject(f.id, { fill: "#00ff00" }); await f.publish();
      assert.equal(f.session.revision, initialRevision + 1); assert(f.session.undo());
      assert.equal(f.session.getObject(f.id).fill, "#ff0000", "history remains available after layout changes");
    } finally { f.session.dispose(); }
  }
  console.log("Native Edit layouts preserve authored pages, source coordinates, selection/history and busy/failure rollback in Reader and Grid.");
} finally { hooks.deregister(); }
