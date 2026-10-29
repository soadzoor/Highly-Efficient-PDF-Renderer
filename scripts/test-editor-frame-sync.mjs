import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";
import { editorFieldClientGeometry } from "../src/editorCoordinates.ts";

const [uiSource, threeSource, formSource] = await Promise.all([
  readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/three-example.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/editorFormControls.ts", import.meta.url), "utf8")
]);
const eligibility = vm.createContext({}); vm.runInContext(sourceFunction(formSource, "canEditEditorField"), eligibility);
const canEditEditorField = eligibility.canEditEditorField;
vm.runInContext(sourceFunction(formSource, "updateEditorFieldControlAppearance"), eligibility);
const nested = uiSource.replace(/^ {2}/gm, "");
const apiStart = uiSource.indexOf("  return {\n    async setEditing("), apiEnd = uiSource.indexOf("\n  };\n}", apiStart);
assert(apiStart >= 0 && apiEnd > apiStart, "the editor exposes its mode and disposal lifecycle");
const apiSource = stripTypeScriptTypes(`globalThis.api = ${uiSource.slice(apiStart + "  return ".length, apiEnd + "\n  }".length)};`);
const tickStart = nested.indexOf("function tick("), tickEnd = nested.indexOf("\nfunction updateState(", tickStart);
assert(tickStart >= 0 && tickEnd > tickStart);
const tickSource = stripTypeScriptTypes(nested.slice(tickStart, tickEnd));
const noop = () => {};

function harness(frameHost = true) {
  const events = [], raf = new Map(), controls = [], callbacks = [];
  const annotationSources = new WeakMap(), annotationTransforms = new WeakMap();
  const fieldValues = new Map([["Text", "Initial value"], ["Legacy", "Legacy value"]]);
  let nextRaf = 0, listener = null, releases = 0, requests = 0, replacements = 0;
  let zoom = 1, panX = 0, panY = 0, projected = 0;
  let canvasRect = { left: 100, top: 50, width: 400, height: 300 }, geometryReads = 0, fieldQueries = 0;
  const makeCanvas = () => ({ getBoundingClientRect() { geometryReads++; return canvasRect; } });
  let canvas = makeCanvas();
  const sourceScene = {
    pageRects: [0, 0, 100, 100], pdfPages: [{ pageIndex: 0, pdfToScene: [1, 0, 0, 1, 0, 0] }],
    annotations: [
      { id: "pdf-axes", pageIndex: 0, subtype: "Widget", visibleInDefaultView: true, field: { name: "Text", type: "Tx", flags: 0 }, pdfGeometry: { rect: [10, 20, 50, 35] }, bounds: { minX: 10, minY: 20, maxX: 50, maxY: 35 } },
      { id: "legacy-bounds", pageIndex: 0, subtype: "Widget", visibleInDefaultView: true, field: { name: "Legacy", type: "Tx", flags: 0 }, bounds: { minX: 60, minY: 10, maxX: 90, maxY: 30 } }
    ]
  };
  const document = { activeElement: null, body: { classList: { toggle: noop, remove: noop } }, fonts: { delete: noop } };
  const fields = {
    replaceChildren() { replacements++; controls.length = 0; },
    append(element) { element.parentElement = fields; controls.push(element); },
    querySelectorAll() { fieldQueries++; return controls; }
  };
  const host = {
    getCanvas: () => canvas,
    sceneToClientPoint(x, y) { projected++; return { x: 100 + panX + x * zoom, y: 50 + panY + (100 - y) * zoom }; },
    setEditing: value => events.push(`editing:${value}`),
    requestFrame() { requests++; }
  };
  if (frameHost) host.subscribeToFrames = callback => {
    assert.equal(listener, null, "only one editor frame listener is active");
    listener = callback; callbacks.push(callback); events.push("subscribe");
    return () => { releases++; if (listener === callback) listener = null; events.push("unsubscribe"); };
  };
  const context = vm.createContext({
    pendingDrawings: { visible: () => [], capture() {}, clear() {} },
    host, document, fields, AbortSignal, editorFieldClientGeometry, latestScene: sourceScene, presented: null,
    overlay: { dataset: {}, style: {}, remove: noop }, toolbar: { style: {}, querySelectorAll: () => [], remove: noop }, graphic: { setAttribute: noop, replaceChildren: noop },
    displayedSelection: () => ({ frame: null }), pointer: null, polygon: null, activeText: null, tool: "form", running: false,
    active: false, disposed: false, structuralRunning: false, releaseFrameListener: null, frame: 0, previewFrame: 0,
    toolRequest: 0, textRequest: 0, pendingFieldFocus: null, fieldDrafts: new Map(), fieldPaintCache: null, fontFaces: new Map(),
    session: { sourceScene, getFieldValues: () => fieldValues, setFieldValue: (name, value) => fieldValues.set(name, value), isAnnotationVisible: () => true, dispose: noop },
    layerControls: { setActive: noop, dispose: noop }, layerDialog: null,
    contextMenu: { close: noop, dispose: noop },
    currentState: { selection: [] }, updateOpacityControls: noop, rotationDraft: null,
    query: () => ({ value: "", disabled: false }),
    canEditEditorField, isSceneSettling: () => false, property: () => ({ disabled: false }),
    updateEditorFieldControlAppearance: eligibility.updateEditorFieldControlAppearance,
    getEditorAnnotationSource: (scene, id) => annotationSources.get(scene)?.get(id),
    getEditorAnnotationFrameTransform: (scene, id) => annotationTransforms.get(scene)?.get(id),
    getSceneAnnotationRuns: () => new Map(),
    createEditorFieldControl: (_document, annotation, value, onValue) => ({ dataset: { fieldId: annotation.id }, annotation, value, onValue, hidden: false, style: {},
      addEventListener: noop,
      focus(options) { assert(!this.hidden && !fields.hidden, "focus waits until the input is placed and visible"); document.activeElement = this; events.push({ focus: annotation.id, options }); },
      click: () => assert.fail("autofocus cannot toggle a control"), dispatchEvent: () => assert.fail("autofocus cannot synthesize a value change") }),
    setEditorFieldControlValue(control, annotation, value) { control.styledAnnotation = annotation; control.value = value; }, commit: apply => apply(),
    createEditorFieldOptions: () => null, editorFieldDraftSignature: input => input.value,
    flushEditorFieldDrafts: noop, finishText: async () => {}, cancelPointerGesture: noop,
    refreshScene: async () => { events.push("refresh"); },
    window: { requestAnimationFrame(callback) { const id = ++nextRaf; raf.set(id, callback); return id; }, cancelAnimationFrame: id => raf.delete(id) },
    hasUnsavedChanges: () => false, save: noop, attachDocuments: noop, dropImages: noop, confirmDocumentChange: () => true,
    lifetime: new AbortController(), scenePreparation: null, operation: null, passwordDialog: null, pagesDialog: null,
    pdfProtection: { dispose: noop }, unsubscribe: noop, picker: null, interaction: { dispose: noop },
    editorServices: { dispose: noop, fonts: { resolve: async () => ({ id: "field-font" }) } }, activateFont: async () => {},
    styleEditorFieldControl(control, annotation, family) { control.fontStyleAnnotation = annotation; control.fontFamily = family; },
    report: error => assert.fail(String(error))
  });
  for (const name of ["sceneBoundsToClient", "focusPendingField", "updateTextVisibility", "updateGeometry", "updateFieldPaint", "renderFields", "setTool", "fieldAtClientPoint", "doubleClick"]) vm.runInContext(sourceFunction(nested, name), context);
  vm.runInContext(`${tickSource}\n${apiSource}`, context);
  return {
    context, host, document, fields, controls, callbacks, events, raf,
    requestView(nextZoom, x = 0, y = 0) { zoom = nextZoom; panX = x; panY = y; },
    resizeCanvas(rect, replace = false) { canvasRect = rect; if (replace) canvas = makeCanvas(); },
    setAnnotationPlacement(scene, id, source, matrix) {
      annotationSources.set(scene, new Map([[id, source]])); annotationTransforms.set(scene, new Map([[id, matrix]]));
    },
    draw() { assert(listener); events.push("draw"); listener(); },
    runRaf() { const entry = raf.entries().next().value; assert(entry); raf.delete(entry[0]); entry[1](); },
    get listener() { return listener; }, get releases() { return releases; }, get requests() { return requests; },
    get replacements() { return replacements; }, get projected() { return projected; }, get geometryReads() { return geometryReads; }, get fieldQueries() { return fieldQueries; }
  };
}

function assertPlacement(h, zoom, x = 0, y = 0) {
  const [field, legacy] = h.controls;
  assert.deepEqual(field.style, { left: `${10 * zoom + x}px`, top: `${65 * zoom + y}px`, width: "40px", height: "15px",
    transformOrigin: "0 0", transform: `matrix(${zoom},0,0,${zoom},0,0)` });
  assert.deepEqual(legacy.style, { left: `${60 * zoom + x}px`, top: `${70 * zoom + y}px`, width: `${30 * zoom}px`, height: `${20 * zoom}px`,
    transformOrigin: "0 0", transform: "none" });
  assert.equal(field.hidden, false); assert.equal(legacy.hidden, false);
}

const doubleClickEvent = (x, y) => ({ clientX: x, clientY: y, target: { getAttribute: () => null } });
const focused = h => h.events.filter(event => event?.focus);

// A docked Settings panel and Reader thumbnails both consume horizontal space.
// The body-mounted editing toolbar follows only the canvas that remains.
{
  const h = harness(); assert.equal(h.geometryReads, 0);
  await h.context.api.setEditing(false); assert.equal(h.geometryReads, 0, "idle View mode does not read toolbar geometry");
  let finishPreparation; h.context.refreshScene = () => new Promise(resolve => { finishPreparation = resolve; });
  const entering = h.context.api.setEditing(true), toolbar = h.context.toolbar;
  assert.deepEqual(toolbar.style, { left: "102px", right: "auto", width: "396px" }, "entering Edit places the toolbar before asynchronous scene preparation");
  finishPreparation(); await entering;
  for (const [label, rect, replace] of [
    ["Settings open", { left: 0, top: 80, width: 840, height: 720 }],
    ["Settings and thumbnails open", { left: 180, top: 80, width: 660, height: 720 }],
    ["narrow workspace", { left: 140, top: 112, width: 190, height: 500 }],
    ["Settings collapsed", { left: 180, top: 80, width: 1020, height: 720 }],
    ["toolbar hidden", { left: 180, top: 0, width: 1020, height: 800 }],
    ["replacement backend canvas", { left: 150, top: 64, width: 510, height: 600 }, true]
  ]) {
    h.resizeCanvas(rect, replace); h.runRaf();
    const left = Number.parseFloat(toolbar.style.left), width = Number.parseFloat(toolbar.style.width);
    assert(left >= rect.left && left + width <= rect.left + rect.width, `${label}: toolbar stays within the canvas horizontal extent`);
    assert.equal(toolbar.style.right, "auto");
    assert.equal(toolbar.style.top, undefined, `${label}: the CSS header offset remains authoritative`);
    assert.equal(h.context.overlay.style.left, `${rect.left}px`); assert.equal(h.context.overlay.style.width, `${rect.width}px`);
  }
  await h.context.api.setEditing(false); const before = h.geometryReads;
  assert.equal(h.raf.size, 0); h.callbacks.at(-1)();
  assert.equal(h.geometryReads, before, "leaving Edit detaches geometry work even after canvas changes");
  h.context.api.dispose();
}

// Enter Fill from Select without depending on whether a field has painted
// glyphs at the clicked location or belongs to a selected source group.
for (const hasAppearance of [false, true]) {
  const h = harness(); await h.context.api.setEditing(true); h.context.tool = "select";
  h.context.latestScene.annotations[0].hasAppearance = hasAppearance;
  h.context.session.getSelectionFrame = () => ({ pageIndex: 4 });
  h.host.clientToScenePoint = () => assert.fail("field double-clicks do not require the selected group's page plane");
  h.context.pick = () => assert.fail("field whitespace is resolved before primitive/group picking");
  await h.context.doubleClick(doubleClickEvent(149, 129));
  assert.equal(h.context.tool, "form"); assert.equal(h.context.pendingFieldFocus.id, "pdf-axes");
  assert(h.controls.every(input => input.hidden)); assert.equal(focused(h).length, 0);
  h.runRaf(); assert.equal(focused(h).length, 0, "gesture RAF cannot focus an unpresented control");
  h.draw();
  assert.equal(h.document.activeElement, h.controls[0]);
  assert.deepEqual(focused(h).map(event => ({ focus: event.focus, options: { ...event.options } })),
    [{ focus: "pdf-axes", options: { preventScroll: true } }]);
  assert.equal(h.controls[0].value, "Initial value", "entering Fill leaves field values unchanged");
  assert.equal(h.context.pendingFieldFocus, null); h.draw(); assert.equal(focused(h).length, 1);
  h.context.api.dispose();
}

// Shared-field names identify a value relationship, while focus targets one
// particular widget. Legacy bounds use the same exact-widget focus path.
{
  const h = harness(); await h.context.api.setEditing(true); h.context.tool = "select";
  h.context.latestScene.annotations[1].field.name = "Text";
  await h.context.doubleClick(doubleClickEvent(175, 130)); h.draw();
  assert.equal(h.document.activeElement, h.controls[1]); assert.equal(focused(h)[0].focus, "legacy-bounds");
  assert.equal(h.controls[0].value, "Initial value"); assert.equal(h.controls[1].value, "Initial value");
  h.context.api.dispose();
}

// Layer changes update the same presented field plane without leaving hidden
// controls focusable or preventing them from reappearing on the next draw.
{
  const h = harness(); await h.context.api.setEditing(true); h.context.renderFields(); h.draw();
  const firstId = h.controls[0].dataset.fieldId;
  h.context.session.isAnnotationVisible = id => id !== firstId; h.draw();
  assert(h.controls[0].hidden); assert(!h.controls[1].hidden);
  assert.equal(h.context.fieldAtClientPoint({ x: 125, y: 125 }), null);
  h.context.session.isAnnotationVisible = () => true; h.draw();
  assert(!h.controls[0].hidden, "showing a layer restores its existing form control");
  h.context.api.dispose();
}

// Hit testing follows the rotated widget plane, including its interior blank
// area; an empty corner of the conservative axis-aligned bounds is excluded.
{
  const h = harness(); await h.context.api.setEditing(true);
  const scene = h.context.latestScene, source = scene.annotations[0], c = Math.SQRT1_2, matrix = [c, c, -c, c, 50, -20];
  const rotated = { ...scene, annotations: [{ ...source, hasAppearance: true,
    bounds: { minX: 32.3, minY: 1.2, maxX: 71.3, maxY: 40.2 } }, scene.annotations[1]] };
  h.setAnnotationPlacement(rotated, source.id, source, matrix); h.context.latestScene = rotated;
  assert.equal(h.context.fieldAtClientPoint({ x: 133, y: 111 }), null, "rotated AABB corners do not count as field hits");
  assert.equal(h.context.fieldAtClientPoint({ x: 100 + 50 + 2.5 * c, y: 150 - (-20 + 57.5 * c) }), source.id);
  h.context.api.dispose();
}

for (const patch of [{ field: { name: "Text", type: "Tx", flags: 1 } }, { field: { name: "Text", type: "Sig", flags: 0 } },
  { field: { name: "Text", type: "Btn", flags: 65536 } }, { visibleInDefaultView: false }, { subtype: "FreeText" }]) {
  const h = harness(); await h.context.api.setEditing(true); h.context.tool = "select";
  Object.assign(h.context.latestScene.annotations[0], patch);
  h.host.clientToScenePoint = (x, y) => ({ x, y }); h.context.session.getSelectionFrame = () => null; h.context.pick = async () => null;
  await h.context.doubleClick(doubleClickEvent(149, 129));
  assert.equal(h.context.tool, "select", "read-only, unsupported and hidden annotations do not enter Fill");
  assert.equal(h.context.pendingFieldFocus, null); assert.equal(focused(h).length, 0); h.context.api.dispose();
}

// Without rendered-frame notifications, the ordinary geometry pass can focus
// immediately after it has placed the field control.
{
  const h = harness(false); await h.context.api.setEditing(true); h.context.tool = "select";
  await h.context.doubleClick(doubleClickEvent(149, 129));
  assert.equal(h.document.activeElement, h.controls[0]); assert.equal(focused(h).length, 1); h.context.api.dispose();
}

// Late frames cannot steal focus after a tool/mode/source/lifetime change.
for (const boundary of ["tool", "view", "source", "dispose"]) {
  const h = harness(); await h.context.api.setEditing(true); h.context.tool = "select";
  await h.context.doubleClick(doubleClickEvent(149, 129)); assert(h.context.pendingFieldFocus);
  const notify = h.listener;
  if (boundary === "tool") h.context.setTool("rectangle");
  else if (boundary === "view") await h.context.api.setEditing(false);
  else if (boundary === "source") h.context.session.sourceScene = { ...h.context.session.sourceScene };
  else h.context.api.dispose();
  notify(); assert.equal(h.context.pendingFieldFocus, null, `${boundary} change cancels pending field focus`);
  assert.equal(focused(h).length, 0); h.context.api.dispose();
}

// A slow generic pick from an older double-click cannot replace the new Fill
// intent when the next double-click resolves a field synchronously.
{
  const h = harness(); await h.context.api.setEditing(true); h.context.tool = "select";
  h.host.clientToScenePoint = (x, y) => ({ x, y }); let finishPick;
  h.context.pick = () => new Promise(resolve => { finishPick = resolve; });
  h.context.startText = () => assert.fail("an older pick cannot open text after entering Fill");
  const old = h.context.doubleClick(doubleClickEvent(300, 300));
  await h.context.doubleClick(doubleClickEvent(149, 129));
  finishPick("older-textbox"); await old;
  assert.equal(h.context.tool, "form"); assert.equal(h.context.pendingFieldFocus.id, "pdf-axes");
  h.draw(); assert.equal(h.document.activeElement, h.controls[0]); h.context.api.dispose();
}

// Exercise the actual geometry and RAF functions: requested camera changes must
// not move field controls until the document's draw callback runs.
{
  const h = harness(); await h.context.api.setEditing(true);
  h.context.renderFields();
  assert.equal(h.requests, 1, "new controls ask the host for an initial document frame");
  assert(h.controls.every(input => input.hidden), "new controls stay hidden until their first matched draw");
  const nodes = [...h.controls], field = nodes[0];
  field.value = "Uncommitted IME draft"; field.selectionStart = 4; field.selectionEnd = 9; h.document.activeElement = field;
  h.runRaf(); assert.equal(h.projected, 0, "gesture RAF cannot project fields before the first draw");
  h.draw(); assertPlacement(h, 1);
  for (const [zoom, x, y] of [[2.5, 13, -7], [.5, -20, 16], [4, 2, 5]]) {
    const styles = h.controls.map(input => ({ ...input.style })), before = h.projected;
    h.requestView(zoom, x, y); h.runRaf(); h.context.updateGeometry();
    assert.deepEqual(h.controls.map(input => input.style), styles, "zoom/pan requests retain the last displayed field pose");
    assert.equal(h.projected, before, "idle geometry updates do no field projection work between draws");
    h.draw(); assertPlacement(h, zoom, x, y);
    assert.equal(h.controls[0], nodes[0]); assert.equal(h.controls[1], nodes[1]);
    assert.equal(h.document.activeElement, field); assert.equal(field.value, "Uncommitted IME draft");
    assert.equal(field.selectionStart, 4); assert.equal(field.selectionEnd, 9);
  }
  assert.equal(h.replacements, 1, "camera frames reposition existing controls without rebuilding focused DOM");
  h.context.api.dispose();
}

// Changing source ownership must not reuse the previous document's widget
// coordinates. Acknowledging the replacement restores the existing controls.
{
  const h = harness(); await h.context.api.setEditing(true); h.context.renderFields(); h.draw();
  const previousSource = h.context.session.sourceScene, replacement = { ...previousSource };
  h.context.presented = { sourceScene: previousSource };
  h.context.session.sourceScene = replacement; h.requestView(2);
  h.runRaf(); assertPlacement(h, 1);
  h.draw(); assert(h.controls.every(input => input.hidden), "unpresented source coordinates cannot place field controls");
  h.context.latestScene = replacement; h.context.presented = { sourceScene: replacement };
  h.draw(); assertPlacement(h, 2);
  assert.equal(h.replacements, 1, "source acknowledgement only repositions existing controls");
  h.context.api.dispose();
}

// Field recompilation can change its axis-aligned metadata rectangle. The
// typing control retains its canonical dimensions and full object transform.
{
  const h = harness(); await h.context.api.setEditing(true);
  const sourceScene = h.context.latestScene, source = sourceScene.annotations[0], matrix = [0, 2, -3, 0, 100, -20];
  source.field.textStyle = { fontSize: 0 }; let resolveFont;
  h.context.editorServices.fonts.resolve = () => new Promise(resolve => { resolveFont = resolve; });
  const transformed = { ...source, bounds: { minX: -5, minY: 0, maxX: 40, maxY: 80 }, pdfGeometry: { rect: [-5, 0, 40, 80] } };
  const scene = { ...sourceScene, annotations: [transformed, sourceScene.annotations[1]] };
  h.setAnnotationPlacement(scene, source.id, source, matrix); h.context.latestScene = scene;
  h.context.renderFields(); h.draw();
  const field = h.controls[0], before = { ...field.style };
  assert.equal(field.annotation, source, "control creation uses the canonical field rectangle");
  assert.deepEqual(before, { left: "-5px", top: "100px", width: "40px", height: "15px", transformOrigin: "0 0", transform: "matrix(0,-2,3,0,0,0)" });
  field.onValue("Typed text");
  assert.equal(field.styledAnnotation, source, "shared-widget value styling uses canonical dimensions");
  const typedScene = { ...scene, annotations: [{ ...transformed, field: { ...transformed.field, value: "Typed text" } }, sourceScene.annotations[1]] };
  h.setAnnotationPlacement(typedScene, source.id, source, matrix); h.context.latestScene = typedScene;
  h.draw(); assert.deepEqual(field.style, before, "a newly compiled field appearance preserves its oriented input frame");
  assert.equal(h.controls[0], field); assert.equal(field.value, "Typed text");
  resolveFont({ id: "canonical-field-font" }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(field.fontStyleAnnotation, source, "late font activation uses the latest scene's canonical field dimensions");
  assert.equal(field.fontFamily, '"canonical-field-font"');
  h.context.api.dispose();
}

// Retained Fill controls consume no projection or DOM enumeration while a
// different tool is active, even when many widgets remain mounted.
{
  const h = harness();
  for (let index = 2; index < 40; index++) h.context.latestScene.annotations.push({
    ...h.context.latestScene.annotations[0], id: `shared-${index}`
  });
  await h.context.api.setEditing(true); h.context.renderFields(); h.draw(); assert.equal(h.controls.length, 40);
  h.context.setTool("select"); const projected = h.projected, queries = h.fieldQueries;
  h.requestView(2, 13, -7); h.runRaf(); h.draw();
  assert.equal(h.projected, projected); assert.equal(h.fieldQueries, queries, "Select does not enumerate hidden Fill controls");
  h.fields.hidden = false; h.context.updateGeometry(true); assert.equal(h.fieldQueries, queries, "the tool guard also excludes retained controls");
  h.context.tool = "form"; h.fields.hidden = true; h.context.updateGeometry(true);
  assert.equal(h.fieldQueries, queries, "a hidden Fill container does no projection work");
  h.fields.hidden = false; h.draw(); assert(h.fieldQueries > queries); assert(h.projected > projected);
  assertPlacement(h, 2, 13, -7); h.context.api.dispose();
}

// A host without frame notifications retains the existing RAF integration.
{
  const h = harness(false); await h.context.api.setEditing(true); h.context.renderFields();
  assert(h.controls.every(input => !input.hidden));
  h.requestView(3, -4, 8); h.runRaf(); assertPlacement(h, 3, -4, 8);
  assert.equal(h.callbacks.length, 0); h.context.api.dispose(); assert.equal(h.raf.size, 0);
}

// View mode and disposal detach both scheduling paths; late copied callbacks
// cannot touch controls after either lifecycle boundary.
{
  const h = harness(); assert.equal(h.listener, null);
  await h.context.api.setEditing(true); h.context.renderFields(); h.draw();
  await h.context.api.setEditing(true); assert.equal(h.callbacks.length, 1, "entering Edit twice does not duplicate subscriptions");
  const oldCallback = h.listener, oldRaf = h.raf.values().next().value;
  await h.context.api.setEditing(false);
  assert.equal(h.listener, null); assert.equal(h.releases, 1); assert.equal(h.raf.size, 0);
  const beforeView = h.projected; h.requestView(8); oldCallback(); oldRaf();
  assert.equal(h.projected, beforeView, "detached frame/RAF callbacks do no work in View mode");
  assert.equal(h.raf.size, 0);
  await h.context.api.setEditing(false); assert.equal(h.releases, 1);
  await h.context.api.setEditing(true); assert.equal(h.callbacks.length, 2);
  const disposedCallback = h.listener; h.context.api.dispose();
  assert.equal(h.listener, null); assert.equal(h.releases, 2); assert.equal(h.raf.size, 0);
  const beforeDispose = h.projected; disposedCallback(); h.context.api.dispose();
  assert.equal(h.projected, beforeDispose); assert.equal(h.releases, 2);
  await h.context.api.setEditing(true); assert.equal(h.callbacks.length, 2, "a disposed editor cannot resubscribe");
}

// Execute the common Three draw function. The editor must update synchronously
// after drawing, even while HUD updates are throttled.
{
  const h = harness(); await h.context.api.setEditing(true); h.context.renderFields();
  const events = [], camera = { zoom: 1 };
  const context = vm.createContext({
    animationFrameId: 1, needsRender: true, captureProfiler: null, activePageLayout: "grid", pageLayoutWarmingUp: false,
    pageLayoutAnimator: { update: () => false }, pageLayoutView: null,
    controls: { update() { camera.zoom = 2; h.requestView(camera.zoom); return false; } }, updateCameraClipping: noop,
    prepareThreeRendererFrame: () => events.push("prepare"),
    renderer: { info: {}, render() { events.push("draw"); assert(h.controls.every(input => input.hidden)); } }, scene: {}, camera,
    withThreeRenderPerformance: (_profile, draw) => draw(), drawCallCounter: { measure: (_info, draw) => { draw(); return 1; } },
    drawCallMeter: { update: noop }, updateFpsMeter: noop, currentPdfObject: { getViewState: () => ({ zoom: camera.zoom }) },
    zoomValueElement: {}, drawingSelection: { onFrame: noop }, annotationInteraction: null,
    annotationOverlay: { onFrame: noop }, textSelection: { updateOverlay: noop },
    hudTextLastUpdateTime: 0, HUD_TEXT_UPDATE_INTERVAL_MS: 100, updateDrawStatsMeter: () => assert.fail("HUD remains throttled"), updateLodStatsMeter: noop,
    renderedFrameSerial: 0, resolveRenderedFrameWaiters: () => events.push("publication acknowledged"),
    editorFrameListener() { events.push("editor"); h.listener(); assertPlacement(h, 2); }, requestRender: noop
  });
  vm.runInContext(sourceFunction(threeSource, "renderFrame"), context);
  context.renderFrame(1);
  assert.deepEqual(events, ["prepare", "draw", "publication acknowledged", "editor"]);
  assert.equal(context.renderedFrameSerial, 1); assertPlacement(h, 2);
  context.renderFrame(2); assert.equal(events.length, 4, "no document draw means no editor frame notification");
  h.context.api.dispose();
}

// The actual stock host subscription releases only the listener it installed.
{
  const start = threeSource.indexOf("        subscribeToFrames(listener) {"), end = threeSource.indexOf("\n        },", start);
  assert(start >= 0 && end > start);
  const method = stripTypeScriptTypes(threeSource.slice(start, end + "\n        }".length).replace("subscribeToFrames(", "function subscribeToFrames("));
  const context = vm.createContext({ editorFrameListener: null }); vm.runInContext(method, context);
  const first = () => {}, second = () => {};
  const releaseFirst = context.subscribeToFrames(first), releaseSecond = context.subscribeToFrames(second);
  releaseFirst(); assert.equal(context.editorFrameListener, second, "stale cleanup cannot detach a replacement listener");
  releaseSecond(); assert.equal(context.editorFrameListener, null);
}

console.log("Editor frame synchronization: matched form placement, source ownership, draft/focus preservation, fallback hosts, lifecycle cleanup and common Three draw ordering passed.");
