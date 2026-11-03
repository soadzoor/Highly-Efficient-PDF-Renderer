import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import vm from "node:vm";
import * as THREE from "three";
import { sourceFunction } from "./lib/sourceFunction.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const source = await readFile(new URL("../src/three-example.ts", import.meta.url), "utf8");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { createBlankPdfScene } = await import("../src/pdfCreation.ts");
  const { computeExamplePageLayout, applyExamplePageLayout } = await import("../src/examplePageLayouts.ts");
  const noop = () => {};
  const modes = ["reader", "grid", "sphere", "helix"];
  const layout = { disabled: true, options: modes.map(value => ({ value, disabled: false })) };
  const buttons = modes.map(pageLayout => ({ dataset: { pageLayout }, disabled: false }));
  let editing = false;
  const controls = vm.createContext({ document: { querySelector: selector => selector === ".reader-layout" ? layout : {} },
    pageLayoutButtons: buttons, drawingSelection: { disable: noop }, textSelection: { disable: noop, enable: noop }, annotationOverlay: { hide: noop },
    textSelectionCheckboxElement: {}, ocrTextCheckboxElement: {}, pageStreamingCheckboxElement: {}, compressScansCheckboxElement: {}, annotationInteraction: null,
    currentPdfObject: { sourceKind: "pdf", sourceOptions: {}, resumePageLoading: noop }, editorInitialization: null, editorModeButton: { setAttribute: noop },
    setToolbarIconButton: noop, viewerPrintAction: null, backendSelectElement: {}, pdfEditor: { isEditing: () => editing, isBusy: () => false },
    sourceLoadController: null, backendChangeActive: false, editorSceneApplicationActive: false, pageLayoutWarmingUp: false, activeHepExportController: null,
    openButtonElement: {}, fileInputElement: {}, exampleDropdown: { setDisabled: noop }, loadedCompressScansPreference: true });
  for (const name of ["syncThreeLayoutAvailability", "setThreeEditing", "setLoadControlsEnabled", "updateThreeBackendSelectDisabledState"]) vm.runInContext(sourceFunction(source, name), controls);
  for (const active of [true, false]) {
    editing = active; controls.setThreeEditing(active);
    assert.equal(layout.disabled, false, "editing alone never disables the layout selector");
    for (const option of layout.options) assert.equal(option.disabled, active && !["reader", "grid"].includes(option.value));
    for (const button of buttons) assert.equal(button.disabled, active && !["reader", "grid"].includes(button.dataset.pageLayout));
    controls.setLoadControlsEnabled(false); assert(layout.disabled); assert(buttons.every(button => button.disabled));
    controls.setLoadControlsEnabled(true); assert(!layout.disabled);
    for (const button of buttons) assert.equal(button.disabled, active && !["reader", "grid"].includes(button.dataset.pageLayout));
  }

  editing = true;
  for (const [name, value] of [["sourceLoadController", new AbortController()], ["editorInitialization", new AbortController()],
    ["backendChangeActive", true], ["editorSceneApplicationActive", true], ["pageLayoutWarmingUp", true], ["activeHepExportController", new AbortController()]]) {
    const previous = controls[name]; controls[name] = value;
    controls.syncThreeLayoutAvailability(false); assert(layout.disabled, `${name} remains blocked after an older busy callback finishes`);
    controls.setLoadControlsEnabled(true); assert(layout.disabled, `load-control cleanup cannot bypass ${name}`);
    controls.setThreeEditing(true); assert(layout.disabled, `Edit activation cannot bypass ${name}`);
    controls[name] = previous; controls.syncThreeLayoutAvailability(); assert(!layout.disabled, `${name} completion restores Reader/Grid`);
    assert(!buttons[0].disabled && !buttons[1].disabled); assert(buttons[2].disabled && buttons[3].disabled);
  }
  for (const name of ["backendChangeActive", "editorSceneApplicationActive"]) {
    controls[name] = true; controls.updateThreeBackendSelectDisabledState(); assert(layout.disabled);
    controls[name] = false; controls.updateThreeBackendSelectDisabledState(); assert(!layout.disabled, `${name} finalization refreshes layout availability after source-load cleanup`);
  }
  controls.pdfEditor.isBusy = () => true;
  controls.syncThreeLayoutAvailability(false); assert(layout.disabled, "another active editor operation survives stale callback cleanup");
  controls.pdfEditor.isBusy = () => false;
  controls.syncThreeLayoutAvailability(true); assert(layout.disabled, "current callback busy state reserves layout before the editor has published its state");
  controls.syncThreeLayoutAvailability(false); assert(!layout.disabled);

  const scene = createBlankPdfScene({ pageCount: 2 });
  const session = await openEditorSession(scene);
  const text = session.addObject({ kind: "text", pageIndex: 1, x: 25, y: 30, width: 150, height: 40, text: "Committed text", fontSize: 12 });
  session.select([text]);
  const state = session.getState(), objects = session.getObjects(), originalScene = structuredClone(scene);
  const textDraft = { text: "Uncommitted typing" }, formDraft = { value: "Uncommitted form value" };
  const pages = [new THREE.Group(), new THREE.Group()];
  pages.forEach((page, index) => page.position.set(scene.pageRects[index * 4], scene.pageRects[index * 4 + 1], 0));
  const object = { pageCount: 2, sceneData: scene, getPages: async () => pages, subscribePagePreparationProgress: () => noop };
  const events = [], statuses = [];
  const host = vm.createContext({ currentPdfObject: object, activePageLayout: "grid", pageLayoutRequest: 0, pageLayoutView: null,
    lifetimeSignal: new AbortController().signal, MIN_OBJECT_EXTENT: 1e-6, textDraft, formDraft,
    editorInitialization: null, sourceLoadController: null, backendChangeActive: false, editorSceneApplicationActive: false, pageLayoutWarmingUp: false, activeHepExportController: null,
    pdfEditor: { isEditing: () => true, async runPresentationChange(change, signal) { signal.throwIfAborted(); events.push("quiesce"); await change(); events.push("reproject"); } },
    reader: { setLayout: layout => events.push(`reader:${layout}`), getView: () => ({}) },
    setStatus: value => statuses.push(value), setPageLayoutProgress: noop, syncPageLayoutControls: noop, syncPageCameraControls: noop,
    computeExamplePageLayout, applyExamplePageLayout, pageLayoutAnimator: { cancel: noop },
    setPanelCollapsed: noop, applyReaderCameraView: () => events.push("reader-camera"), fitPageLayoutToCamera: () => events.push("grid-camera"),
    formatPageLayout: value => value, requestRender: noop });
  for (const name of ["readPageExtent", "createPageLayoutView", "applyPageLayout", "setPageLayout"]) vm.runInContext(sourceFunction(source, name), host);
  try {
    const transforms = [];
    for (const target of ["reader", "grid", "reader", "grid"]) {
      await host.setPageLayout(target);
      assert.equal(host.activePageLayout, target, statuses.at(-1)); transforms.push(pages.map(page => page.position.toArray()));
      assert.deepEqual(session.getState(), state, "switching layouts retains selection, dirty state and Undo/Redo");
      assert.deepEqual(session.getObjects(), objects, "layout is not an authoring transformation");
      assert.deepEqual(scene, originalScene, "layout does not rewrite canonical PDF/HEP coordinates");
      assert.equal(host.textDraft, textDraft); assert.equal(host.formDraft, formDraft);
    }
    assert.notDeepEqual(transforms[0], transforms[1], "Reader and Grid visibly use different page transforms");
    assert.deepEqual(transforms[0], transforms[2]); assert.deepEqual(transforms[1], transforms[3]);
    assert.equal(events.filter(event => event === "quiesce").length, 4);
    assert.equal(events.filter(event => event === "reproject").length, 4);
    const count = events.filter(event => event === "quiesce").length;
    await host.setPageLayout("grid"); assert.equal(events.filter(event => event === "quiesce").length, count, "same-layout requests avoid editor redraws");
    await host.setPageLayout("sphere"); assert.equal(host.activePageLayout, "grid");
    assert.equal(events.filter(event => event === "quiesce").length, count, "3D layouts stay guarded during Edit");
    host.editorInitialization = new AbortController();
    await host.setPageLayout("reader"); assert.equal(host.activePageLayout, "grid");
    assert.equal(events.filter(event => event === "quiesce").length, count, "pending editor setup does not start a layout change");
    host.editorInitialization = null;
    host.pdfEditor.runPresentationChange = async () => { throw new Error("Editor operation pending"); };
    await host.setPageLayout("reader"); assert.equal(host.activePageLayout, "grid");
    assert(statuses.at(-1).includes("Editor operation pending"));
    assert.deepEqual(session.getState(), state); assert.deepEqual(session.getObjects(), objects);
  } finally { session.dispose(); }
  console.log("Three Edit layout: Reader/Grid controls, view-only page transforms, shared presentation guard, draft/selection/history retention and failure reset passed.");
} finally { hooks.deregister(); }
