import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";
import { editorFrameCorners, editorFrameCenter, editorFrameSize, editorFrameResizeMatrix, editorFrameScaleMatrix,
  editorFrameClientGeometry, editorFrameRotation, editorFrameRotationMatrix, editorFrameRotationDragMatrix } from "../src/editorSelectionGeometry.ts";
import { waitForLoad } from "../src/loadCancellation.ts";
import { droppedFileKind } from "../src/documentDropFiles.ts";

const IDENTITY = [1, 0, 0, 1, 0, 0];
const frameHelpers = { editorFrameCorners, editorFrameCenter, editorFrameSize, editorFrameResizeMatrix, editorFrameScaleMatrix, editorFrameClientGeometry,
  editorFrameRotation, editorFrameRotationMatrix, editorFrameRotationDragMatrix, IDENTITY };

const [source, css, nativeCss, threeHtml] = await Promise.all([
  readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/editorUi.css", import.meta.url), "utf8"),
  readFile(new URL("../src/style.css", import.meta.url), "utf8"),
  readFile(new URL("../three-example.html", import.meta.url), "utf8")
]);
const nested = source.replace(/^ {2}/gm, "");
const install = (context, ...names) => {
  if (names.some(name => ["pointerDown", "pointerMove", "pointerUp"].includes(name))) names.push("createShapeDraft", "updateShapeGesture");
  for (const name of names) vm.runInContext(sourceFunction(nested, name), context);
};
const bounds = { minX: 10, minY: 20, maxX: 50, maxY: 60 };
let geometryFrame = { bounds, transform: IDENTITY };
const shapes = [], overlay = { dataset: {}, style: {} };
const rotationInput = { value: "", disabled: false, dataset: { transform: "rotation" } }, rotationDocument = { activeElement: null };
const geometry = vm.createContext({
  pendingDrawings: { visible: () => [] },
  ...frameHelpers,
  currentState: { revision: 0, selection: ["object"] }, presented: null, isSceneSettling: () => false,
  host: { getCanvas: () => ({ getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 300 }) }),
    sceneToClientPoint: (x, y) => ({ x: x + 100, y: y + 50 }) },
  overlay, toolbar: { style: {} }, graphic: { setAttribute() {}, replaceChildren() { shapes.length = 0; } },
  session: { getSelectionBounds: () => bounds, getSelectionFrame: () => geometryFrame, sourceScene: { pageRects: [0, 0, 400, 300] } },
  sceneBoundsToClient: value => ({ minX: value.minX + 100, minY: value.minY + 50, maxX: value.maxX + 100, maxY: value.maxY + 50 }),
  svg: (tag, attributes) => { const element = { tag, ...attributes, style: {} }; shapes.push(element); return element; }, fields: { querySelectorAll: () => [] },
  pointer: null, pendingPick: null, polygon: null, signature: null, signatureHover: null, activeText: null, running: false, tool: "select", latestScene: {},
  property: () => ({ value: "#123456" }), focusPendingField() {}, updateTextVisibility: () => true,
  query: () => rotationInput, document: rotationDocument, rotationDraft: null, opacityInput() {}
});
install(geometry, "displayedSelection", "updatePointerCursor", "toolbarInput", "updateRotationValue", "updateGeometry");
for (const tool of ["select", "pan", "form", "text", "rectangle", "ellipse", "line", "arrow", "polygon", "polyline", "ink", "signature", "image"]) {
  geometry.tool = tool; geometry.updateGeometry();
  const handles = shapes.filter(item => item["data-handle"]);
  assert.equal(handles.length, tool === "select" ? 5 : 0, `${tool}: transform handles are exclusive to Select`);
  assert.equal(shapes.some(item => item.class === "hepr-editor-selection"), tool === "select", `${tool}: selection frame follows the active tool`);
  assert.equal(shapes.some(item => item.class === "hepr-editor-selection-hit"), tool === "select", `${tool}: the move surface exists only for Select`);
  if (tool === "select") assert.deepEqual(handles.map(item => item["data-handle"]), ["nw", "ne", "se", "sw", "rotate"]);
}
geometry.tool = "select"; geometry.running = true; geometry.updateGeometry();
assert.equal(shapes.filter(item => item["data-handle"]).length, 0, "busy operations hide nonfunctional transform handles");
assert.equal(shapes.some(item => item.class === "hepr-editor-selection"), false);
assert.equal(shapes.some(item => item.class === "hepr-editor-selection-hit"), false, "busy operations remove the inactive move surface");
geometry.running = false;
geometry.activeText = { pageIndex: 0, x: 1, y: 2, width: 10, height: 10, transform: [1, 0, 0, 1, 0, 0], element: { style: {} } };
geometry.updateGeometry(); assert.equal(shapes.filter(item => item["data-handle"]).length, 0, "an active textbox owns the editing affordance");
assert.equal(rotationInput.disabled, true, "finish the textbox draft before changing its selection rotation");
assert.equal(shapes.some(item => item.class === "hepr-editor-selection-hit"), false);
geometry.activeText = null;
for (const [action, handle] of [["move", ""], ["rotate", ""], ["resize", "ne"], ["resize", "sw"], ["draw", ""], ["marquee", ""]]) {
  geometry.pointer = { action, handle }; geometry.updatePointerCursor();
  assert.equal(overlay.dataset.gesture, action); assert.equal(overlay.dataset.resizeHandle, action === "resize" ? handle : "");
}
geometry.pointer = null; geometry.pendingPick = {}; geometry.updatePointerCursor(); assert.equal(overlay.dataset.gesture, "pick");
geometry.pendingPick = null; geometry.running = true; geometry.updatePointerCursor();
assert.equal(overlay.dataset.gesture, ""); assert.equal(overlay.dataset.resizeHandle, ""); assert.equal(overlay.dataset.busy, "true");
geometry.running = false; geometry.updatePointerCursor(); assert.equal(overlay.dataset.busy, "false");

const captures = new Set(), selected = [], previews = [], released = [], toolButtons = [];
const gestureOverlay = { dataset: {}, style: {}, setPointerCapture(id) { captures.add(id); }, hasPointerCapture: id => captures.has(id),
  releasePointerCapture(id) { captures.delete(id); released.push(id); } };
for (const name of ["select", "pan", "form", "rectangle"]) toolButtons.push({ dataset: { tool: name }, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } });
let finishPick, abortedPicks = 0;
const gestures = vm.createContext({
  ...frameHelpers,
  isSceneSettling: () => false,
  active: true, running: false, structuralRunning: false, activeText: null, disposed: false, tool: "select", toolRequest: 0, textRequest: 0,
  pointer: null, pendingPick: null, pendingFieldFocus: null, fieldAtClientPoint: () => null, picking: { abort() { abortedPicks++; } }, polygon: null,
  overlay: gestureOverlay, fields: { hidden: true }, toolbar: { querySelectorAll: () => toolButtons },
  objectOpacity: 1, fillOpacity: 1, pageLocal: point => [point.x, point.y],
  property: name => ({ disabled: true, value: name === "stroke" ? "2" : "#123456", checked: false }), renderFields() {}, updateGeometry() {}, finishText: async () => {},
  currentState: { selection: [] }, updateOpacityControls() {},
  contextMenu: { close() {} },
  host: { clientToScenePoint: (x, y) => ({ x, y }) }, pageAt: () => 0,
  pick: () => new Promise(resolve => { finishPick = resolve; }), clearPreview: restore => previews.push(restore),
  interaction: { selectHit: id => selected.push(id), selectArea: () => assert.fail("unexpected area selection") },
  session: { getSelectionBounds: () => bounds, getSelectionFrame: () => ({ bounds, transform: IDENTITY }) }, commit: () => assert.fail("cancelled gestures cannot commit changes")
});
install(gestures, "updatePointerCursor", "cancelPointerGesture", "setTool", "pointerDown", "pointerUp");
let prevented = 0, stopped = 0;
const event = (id = 1, handle = null) => ({ pointerId: id, button: 0, clientX: 20, clientY: 30,
  target: { closest: () => null, getAttribute: name => name === "data-handle" ? handle : null },
  preventDefault() { prevented++; }, stopPropagation() { stopped++; } });

for (const tool of ["pan", "form"]) {
  gestures.tool = tool; await gestures.pointerDown(event());
  assert.equal(prevented, 0); assert.equal(stopped, 0); assert.equal(captures.size, 0, `${tool}: pass-through events remain owned by their native controls`);
}
gestures.tool = "select";
const pending = gestures.pointerDown(event(7));
const oldRequest = gestures.pendingPick;
assert(oldRequest); assert.equal(gestureOverlay.dataset.gesture, "pick"); assert(captures.has(7));
await gestures.pointerDown(event(8)); assert.equal(gestures.pendingPick, oldRequest, "a second press cannot replace a pending selection request");
gestures.polygon = { points: [[0, 0], [1, 1]] }; gestures.setTool("rectangle");
assert.equal(oldRequest.canceled, true); assert.equal(gestures.pendingPick, null); assert.equal(gestures.pointer, null);
assert.equal(gestures.polygon, null); assert.equal(gestureOverlay.dataset.tool, "rectangle"); assert.equal(gestureOverlay.dataset.gesture, "");
assert.equal(captures.size, 0); assert.equal(abortedPicks, 1); assert.deepEqual(previews, [true]);
finishPick("source:fill:1"); await pending;
assert.deepEqual(selected, [], "a picker completing after a tool switch cannot select or start a drag");
assert.equal(gestures.pointer, null);

await gestures.pointerDown(event(9, "rotate"));
assert.equal(gestures.pointer.action, "draw", "drawing tools ignore stale transform-handle attributes");
assert.equal(gestureOverlay.dataset.gesture, "draw");
const drawing = gestures.pointer; await gestures.pointerDown(event(10));
assert.equal(gestures.pointer, drawing, "a second press cannot replace an active drawing gesture");
gestures.cancelPointerGesture(false); assert.equal(gestureOverlay.dataset.gesture, ""); assert.equal(captures.size, 0);
assert.equal(previews.at(-1), false);

gestures.tool = "select";
for (const [handle, action] of [["rotate", "rotate"], ["ne", "resize"], ["sw", "resize"]]) {
  await gestures.pointerDown(event(11, handle));
  assert.equal(gestures.pointer.action, action); assert.equal(gestureOverlay.dataset.gesture, action);
  if (action === "resize") assert.equal(gestureOverlay.dataset.resizeHandle, handle);
  gestures.pointerUp(event(11, handle));
  assert.equal(gestures.pointer, null); assert.equal(gestureOverlay.dataset.gesture, ""); assert.equal(gestureOverlay.dataset.resizeHandle, ""); assert.equal(captures.size, 0);
}
const moving = gestures.pointerDown(event(12)); finishPick("source:fill:2"); await moving;
assert.equal(gestures.pointer.action, "move"); assert.equal(gestureOverlay.dataset.gesture, "move");
gestures.pointerUp(event(12)); assert.equal(gestureOverlay.dataset.gesture, "");
assert.deepEqual(selected, ["source:fill:2"]);
gestures.running = true; const preventBeforeBusy = prevented; await gestures.pointerDown(event(13));
assert.equal(prevented, preventBeforeBusy); assert.equal(gestures.pointer, null, "busy operations cannot start document gestures");

gestures.running = false;
const history = []; gestures.refreshScene = async () => {}; gestures.report = error => assert.fail(String(error));
gestures.session.undo = () => { assert.equal(gestures.pointer, null); assert.equal(captures.size, 0); history.push("undo"); };
gestures.session.redo = () => { assert.equal(gestures.pendingPick, null); assert.equal(captures.size, 0); history.push("redo"); };
install(gestures, "commit", "changeHistory");
await gestures.pointerDown(event(14, "rotate")); gestures.changeHistory(false);
assert.equal(gestureOverlay.dataset.gesture, ""); gestures.pointerUp(event(14, "rotate"));
const historyPick = gestures.pointerDown(event(15)), requestBeforeHistory = gestures.pendingPick;
gestures.changeHistory(true); assert.equal(requestBeforeHistory.canceled, true);
finishPick("source:fill:3"); await historyPick;
assert.deepEqual(history, ["undo", "redo"]); assert.deepEqual(selected, ["source:fill:2"], "history cancels stale drag and async pick ownership before modifying the document");

// Pointer IDs can be reused before an aborted pick settles. Exercise the real
// registration too: its error handler must not cancel a newer request by ID.
const pickerRequests = [], reportedPicks = [], pointerListeners = new Map();
gestures.pick = () => new Promise((resolve, reject) => pickerRequests.push({ resolve, reject }));
gestures.report = error => reportedPicks.push(error);
gestureOverlay.addEventListener = (name, listener) => pointerListeners.set(name, listener);
const pointerRegistration = source.match(/^  overlay\.addEventListener\("pointerdown",[^\n]+$/m)?.[0];
assert(pointerRegistration, "the stock pointer-down listener must be exercised");
vm.runInContext(pointerRegistration.trim(), gestures);
pointerListeners.get("pointerdown")(event(21)); const rejectedRequest = gestures.pendingPick;
gestures.cancelPointerGesture(); assert.equal(rejectedRequest.canceled, true);
pointerListeners.get("pointerdown")(event(21)); const replacementRequest = gestures.pendingPick;
assert.notEqual(replacementRequest, rejectedRequest); assert.equal(replacementRequest.id, rejectedRequest.id);
const releasesBeforeOldError = released.length, oldPickError = new Error("Earlier picker failed after cancellation");
pickerRequests[0].reject(oldPickError); await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(reportedPicks, [oldPickError]); assert.equal(gestures.pendingPick, replacementRequest);
assert.equal(gestureOverlay.dataset.gesture, "pick"); assert(captures.has(21));
assert.equal(released.length, releasesBeforeOldError, "an old rejection cannot release the newer request's reused pointer capture");
pickerRequests[1].resolve("source:fill:4"); await new Promise(resolve => setImmediate(resolve));
assert.equal(gestures.pendingPick, null); assert.equal(gestures.pointer.action, "move");
gestures.pointerUp(event(21)); assert.equal(captures.size, 0);
assert.deepEqual(selected, ["source:fill:2", "source:fill:4"]);

// A cold double-click replaces the still-pending press pick. Rejecting that
// older press must not abort the new double-click's picker controller.
const doublePicks = [], openedText = [];
gestures.pick = () => new Promise((resolve, reject) => {
  const request = { resolve, reject, aborted: false };
  doublePicks.push(request);
  gestures.picking = { abort() { request.aborted = true; reject(new DOMException("Synthetic picker cancellation", "AbortError")); } };
});
gestures.session.getObject = id => ({ id, kind: "text", text: "Existing textbox" });
gestures.startText = async (point, object) => openedText.push({ point, object });
install(gestures, "doubleClick");
pointerListeners.get("pointerdown")(event(23)); const coldPress = gestures.pendingPick;
const openingText = gestures.doubleClick(event(23));
assert.equal(coldPress.canceled, true); assert.equal(gestures.pendingPick, null); assert.equal(doublePicks.length, 2);
await new Promise(resolve => setImmediate(resolve));
assert.equal(doublePicks[0].aborted, true); assert.equal(doublePicks[1].aborted, false, "the old press rejection cannot abort the replacement double-click pick");
doublePicks[1].resolve("editor:text-1"); await openingText;
assert.equal(openedText.length, 1); assert.equal(openedText[0].object.id, "editor:text-1");
assert.deepEqual({ ...openedText[0].point }, { x: 20, y: 30 });
let finishStaleDoubleClick;
gestures.pick = () => new Promise(resolve => { finishStaleDoubleClick = resolve; });
const switchedDoubleClick = gestures.doubleClick(event(24));
gestures.setTool("rectangle"); finishStaleDoubleClick("editor:text-2"); await switchedDoubleClick;
assert.equal(openedText.length, 1, "a late double-click pick cannot open text after switching tools");

const freeText = { id: "source-free-text", subtype: "FreeText", pageIndex: 0 };
gestures.tool = "select"; gestures.session.sourceScene = { annotations: [freeText], pageRects: [0, 0, 400, 300] };
gestures.session.revision = 1; gestures.session.getAnnotationEdits = () => [];
gestures.session.getObject = () => ({ kind: "source", annotationId: freeText.id });
gestures.pick = async () => `annotation:${freeText.id}`;
gestures.source = { password: undefined }; gestures.lifetime = new AbortController();
gestures.editorServices = { readTextAnnotation: async () => ({ kind: "text", text: "Source textbox", transform: IDENTITY, pageIndex: 0 }) };
await gestures.doubleClick(event(24));
assert.equal(openedText.length, 2); assert.equal(openedText[1].object.text, "Source textbox", "existing PDF FreeText still opens its textbox editor");

const validationErrors = []; gestures.report = error => validationErrors.push(error);
gestures.pointer = { id: 25, action: "rotate" }; gestureOverlay.setPointerCapture(25); gestures.updatePointerCursor();
const invalidChange = new Error("Synthetic property validation failure");
gestures.commit(() => { throw invalidChange; });
assert.deepEqual(validationErrors, [invalidChange]); assert.equal(gestures.pointer, null); assert.equal(captures.size, 0);
assert.equal(previews.at(-1), true, "cancelling a gesture before a failing edit restores the rendered committed scene");
assert.equal(gestureOverlay.dataset.gesture, "");

const decodeRequests = [], activatedTools = [], imageStatuses = [], decodedCanvases = [], bitmapCloses = [];
const rgba = Uint8ClampedArray.of(20, 40, 60, 255, 80, 100, 120, 128), previousImage = { preserved: true };
const images = vm.createContext({ disposed: false, active: true, toolRequest: 1, pendingImage: previousImage,
  waitForLoad, createImageBitmap: file => new Promise((resolve, reject) => decodeRequests.push({ file, resolve, reject })),
  document: { createElement(tag) {
    assert.equal(tag, "canvas");
    const canvas = { getContext(kind) { assert.equal(kind, "2d"); return {
      drawImage(bitmap, x, y) { assert.equal(bitmap.width, 2); assert.equal(bitmap.height, 1); assert.equal(x, 0); assert.equal(y, 0); },
      getImageData(x, y, width, height) { assert.deepEqual([x, y, width, height], [0, 0, 2, 1]); return { data: rgba }; }
    }; } }; decodedCanvases.push(canvas); return canvas;
  } },
  setTool: tool => activatedTools.push(tool), setStatus: value => imageStatuses.push(value)
});
install(images, "decodeImage", "importImage");
const bitmap = name => ({ width: 2, height: 1, close() { bitmapCloses.push(name); } });
const switchedImage = images.importImage({ name: "switched.png" }, 1);
images.toolRequest = 2; decodeRequests.at(-1).resolve(bitmap("switched")); await switchedImage;
assert.equal(images.pendingImage, previousImage); assert.deepEqual(activatedTools, []); assert.equal(decodedCanvases.length, 0);
const leftEditImage = images.importImage({ name: "left-edit.png" }, 2);
images.active = false; decodeRequests.at(-1).resolve(bitmap("left-edit")); await leftEditImage;
assert.equal(images.pendingImage, previousImage); assert.deepEqual(activatedTools, []); assert.equal(decodedCanvases.length, 0);
images.active = true;
const disposedImage = images.importImage({ name: "disposed.png" }, 2);
images.disposed = true; decodeRequests.at(-1).resolve(bitmap("disposed")); await disposedImage;
assert.equal(images.pendingImage, previousImage); assert.deepEqual(activatedTools, []); assert.equal(decodedCanvases.length, 0);
images.disposed = false;
const readyImage = images.importImage({ name: "ready.png" }, 2);
decodeRequests.at(-1).resolve(bitmap("ready")); await readyImage;
assert.equal(images.pendingImage.kind, "image"); assert.equal(images.pendingImage.imageWidth, 2); assert.equal(images.pendingImage.imageHeight, 1);
assert.deepEqual(Array.from(images.pendingImage.data), Array.from(rgba)); assert.deepEqual(activatedTools, ["image"]);
assert.deepEqual([decodedCanvases[0].width, decodedCanvases[0].height], [2, 1]);
assert.match(imageStatuses[0], /place the image/); assert.equal(imageStatuses.length, 1);
rgba[0] = 255; assert.equal(images.pendingImage.data[0], 20, "the reusable image owns its decoded pixel copy");
assert.deepEqual(bitmapCloses, ["switched", "left-edit", "disposed", "ready"], "every completed bitmap is released, including stale decodes");

const droppedObjects = [], droppedSelections = [], dropBusy = [], dropRefreshes = [], imageCancel = { hidden: true };
const imageSource = { pageRects: Float32Array.of(0, 0, 200, 100) };
const imageCanvas = { getBoundingClientRect: () => ({ left: 10, top: 20, right: 410, bottom: 220 }) };
Object.assign(images, { DOMException, AbortController, AbortSignal, droppedFileKind, lifetime: new AbortController(),
  running: false, structuralRunning: false, activeText: null, fieldDrafts: new Map(), objectOpacity: .6, operation: null,
  flushEditorFieldDrafts() {}, hasPendingEditorFields: () => false, finishText: async () => {},
  cancelPointerGesture() {}, updatePointerCursor() {}, query: () => imageCancel,
  host: { getCanvas: () => imageCanvas, clientToScenePoint: (x, y) => ({ x: (x - 10) / 2, y: 100 - (y - 20) / 2 }), onBusyChange: value => dropBusy.push(value) },
  session: { sourceScene: imageSource, revision: 0,
    addObject(object) { droppedObjects.push(object); images.session.revision++; return `image-${droppedObjects.length}`; },
    select(ids) { droppedSelections.push([...ids]); } },
  refreshScene: async () => dropRefreshes.push("refresh"),
  pageLocal: (point, pageIndex) => [point.x - images.session.sourceScene.pageRects[pageIndex * 4], point.y - images.session.sourceScene.pageRects[pageIndex * 4 + 1]],
  setTool(tool) { images.toolRequest++; activatedTools.push(tool); }
});
install(images, "pageAt", "dropImages");
const imageFiles = [new File(["first"], "first.png", { type: "image/png" }), new File(["second"], "second.webp", { type: "image/webp" })];
const dropPoint = { x: 50, y: 80 }, settle = () => new Promise(resolve => setImmediate(resolve));
const requestsBeforeInvalid = decodeRequests.length;
images.active = false;
await assert.rejects(images.dropImages(imageFiles, dropPoint), /Edit mode/); images.active = true;
await assert.rejects(images.dropImages([new File(["pdf"], "document.pdf")], dropPoint), /PNG, JPEG or WebP/);
await assert.rejects(images.dropImages(imageFiles, { x: 5, y: 80 }), /document page/);
images.host.clientToScenePoint = () => ({ x: 300, y: 10 });
await assert.rejects(images.dropImages(imageFiles, dropPoint), /document page/);
images.host.clientToScenePoint = (x, y) => ({ x: (x - 10) / 2, y: 100 - (y - 20) / 2 });
assert.equal(decodeRequests.length, requestsBeforeInvalid, "invalid image drops never start a decode");
const droppedBatch = images.dropImages(imageFiles, dropPoint);
assert.equal(images.running, true); assert.equal(imageCancel.hidden, false); assert.equal(images.pendingImage, null);
images.host.clientToScenePoint = () => ({ x: 999, y: 999 });
decodeRequests.at(-1).resolve(bitmap("drop-first")); await settle();
assert.equal(decodeRequests.at(-1).file.name, "second.webp", "multiple dropped images decode and commit in order");
decodeRequests.at(-1).resolve(bitmap("drop-second")); await droppedBatch;
assert.equal(droppedObjects.length, 2); assert.deepEqual(droppedSelections.at(-1), ["image-1", "image-2"]);
for (const object of droppedObjects) {
  assert.deepEqual([object.pageIndex, object.x, object.y, object.width, object.height, object.imageWidth, object.imageHeight, object.opacity], [0, 20, 20, 100, 50, 2, 1, .6],
    "image top-left anchors to the captured canonical page point despite camera changes during decode");
  assert.deepEqual([...object.data], [...rgba], "image drops retain all source pixels and alpha");
}
assert.equal(images.pendingImage, null); assert.equal(activatedTools.at(-1), "select", "dropping images never arms a later click placement");
assert.equal(images.running, false); assert.equal(imageCancel.hidden, true); assert.deepEqual(dropBusy, [true, false]);
assert(dropRefreshes.length >= 1, "completed drops publish their images");
images.host.clientToScenePoint = (x, y) => ({ x: (x - 10) / 2, y: 100 - (y - 20) / 2 });
for (const stale of ["tool", "source", "view", "dispose"]) {
  const beforeObjects = droppedObjects.length, beforeCanvases = decodedCanvases.length;
  const pending = images.dropImages([imageFiles[0]], dropPoint);
  if (stale === "tool") images.toolRequest++;
  else if (stale === "source") images.session.sourceScene = { ...imageSource };
  else if (stale === "view") images.active = false;
  else { images.disposed = true; images.active = false; }
  const statusesBeforeStaleCompletion = imageStatuses.length;
  decodeRequests.at(-1).resolve(bitmap(`drop-stale-${stale}`));
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(droppedObjects.length, beforeObjects); assert.equal(decodedCanvases.length, beforeCanvases, "stale dropped images release their bitmap without a pixel canvas");
  if (stale === "dispose") assert.equal(imageStatuses.length, statusesBeforeStaleCompletion, "disposed image imports never replace a new document's status");
  images.disposed = false; images.active = true; images.session.sourceScene = imageSource;
}
const canceledDrop = new AbortController(), beforeCanceled = droppedObjects.length;
const pendingCanceled = images.dropImages([imageFiles[0]], dropPoint, canceledDrop.signal), lateDecode = decodeRequests.at(-1);
canceledDrop.abort(); await assert.rejects(pendingCanceled, { name: "AbortError" });
assert.equal(images.running, false); assert.equal(droppedObjects.length, beforeCanceled, "external cancellation finishes before an uncancellable bitmap decode");
lateDecode.resolve(bitmap("drop-late-cancelled")); await settle();
assert(bitmapCloses.includes("drop-late-cancelled"), "a bitmap resolving after cancellation is drained and released");
const beforePartial = droppedObjects.length, partialDrop = images.dropImages(imageFiles, dropPoint);
decodeRequests.at(-1).resolve(bitmap("drop-partial-first")); await settle();
decodeRequests.at(-1).reject(new Error("Synthetic second image decode failure"));
await assert.rejects(partialDrop, /Synthetic second image/);
assert.equal(droppedObjects.length, beforePartial + 1, "a later image failure preserves earlier completed image additions");
assert.equal(images.running, false); assert.equal(images.pendingImage, null);
const beforeUndoneDrop = droppedObjects.length, undoneDrop = images.dropImages(imageFiles, dropPoint);
decodeRequests.at(-1).resolve(bitmap("drop-before-undo")); await settle();
const selectionsBeforeUndo = droppedSelections.length;
droppedObjects.pop(); images.session.revision++;
decodeRequests.at(-1).resolve(bitmap("drop-after-undo"));
await assert.rejects(undoneDrop, { name: "AbortError" });
assert.equal(droppedObjects.length, beforeUndoneDrop, "undoing an earlier image cancels the remaining decoded image additions");
assert.equal(droppedSelections.length, selectionsBeforeUndo, "the stale batch never selects a deleted image ID");
assert.equal(imageStatuses.at(-1), "Image import cancelled.", "superseded batches do not claim undone images remain added");

const near = (actual, expected, label) => {
  assert(Number.isFinite(actual), `${label}: finite result`);
  assert(Math.abs(actual - expected) <= 1e-12 * Math.max(1, Math.abs(expected)), `${label}: expected ${expected}, received ${actual}`);
};
const nearMatrix = (actual, expected, label) => actual.forEach((value, index) => near(value, expected[index], `${label}, matrix ${index}`));
const transformPoint = (matrix, point) => ({ x: matrix[0] * point.x + matrix[2] * point.y + matrix[4], y: matrix[1] * point.x + matrix[3] * point.y + matrix[5] });
const composeMatrices = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const resizeBounds = { minX: 10, minY: 20, maxX: 110, maxY: 70 };
const matrixHost = vm.createContext({ ...frameHelpers }); install(matrixHost, "dragMatrix");
for (const [handle, start, fixed] of [
  ["nw", { x: 10, y: 70 }, { x: 110, y: 20 }], ["ne", { x: 110, y: 70 }, { x: 10, y: 20 }],
  ["sw", { x: 10, y: 20 }, { x: 110, y: 70 }], ["se", { x: 110, y: 20 }, { x: 10, y: 70 }]
]) {
  const dx = start.x - fixed.x, dy = start.y - fixed.y;
  for (const scale of [2, .4, -.5]) {
    // A perpendicular displacement changes pointer position without changing
    // its projection onto the fixed-corner diagonal.
    const point = { x: fixed.x + scale * dx - .3 * dy, y: fixed.y + scale * dy + .3 * dx };
    const matrix = matrixHost.dragMatrix({ action: "resize", handle, start, bounds: resizeBounds }, point);
    nearMatrix(matrix, [scale, 0, 0, scale, fixed.x * (1 - scale), fixed.y * (1 - scale)], `${handle}, signed scale ${scale}`);
    const anchored = transformPoint(matrix, fixed); near(anchored.x, fixed.x, `${handle}: fixed X`); near(anchored.y, fixed.y, `${handle}: fixed Y`);
    near(Math.abs((resizeBounds.maxX - resizeBounds.minX) * matrix[0] / ((resizeBounds.maxY - resizeBounds.minY) * matrix[3])), 2, `${handle}: aspect ratio`);
  }
  const free = matrixHost.dragMatrix({ action: "resize", handle, start, bounds: resizeBounds, freeResize: true }, { x: fixed.x + dx * 2, y: fixed.y + dy * .5 });
  nearMatrix(free, [2, 0, 0, .5, -fixed.x, fixed.y * .5], `${handle}: Shift frees both axes`);
}
for (const [name, bounds, start, point, scale] of [
  ["horizontal line", { minX: 10, minY: 20, maxX: 110, maxY: 20 }, { x: 110, y: 20 }, { x: 210, y: 500 }, 2],
  ["vertical line", { minX: 10, minY: 20, maxX: 10, maxY: 70 }, { x: 10, y: 70 }, { x: 500, y: 40 }, .4],
  ["tiny diagonal", { minX: 0, minY: 0, maxX: 1e-200, maxY: 5e-201 }, { x: 1e-200, y: 5e-201 }, { x: 2e-200, y: 1e-200 }, 2]
]) {
  const matrix = matrixHost.dragMatrix({ action: "resize", handle: "ne", start, bounds }, point);
  near(matrix[0], scale, `${name}: X scale`); near(matrix[3], scale, `${name}: Y scale`);
  assert(matrix.every(Number.isFinite));
}
nearMatrix(matrixHost.dragMatrix({ action: "resize", handle: "ne", start: { x: 10, y: 20 },
  bounds: { minX: 10, minY: 20, maxX: 10, maxY: 20 } }, { x: 30, y: 40 }), [1, 0, 0, 1, 0, 0], "point-sized fallback");
nearMatrix(matrixHost.dragMatrix({ action: "resize", handle: "ne", freeResize: true, start: { x: 110, y: 20 },
  bounds: { minX: 10, minY: 20, maxX: 110, maxY: 20 } }, { x: 210, y: 500 }), [2, 0, 0, 1, -10, 0], "Shift-free horizontal line retains its zero axis");
nearMatrix(matrixHost.dragMatrix({ action: "resize", handle: "ne", freeResize: true, start: { x: 10, y: 70 },
  bounds: { minX: 10, minY: 20, maxX: 10, maxY: 70 } }, { x: 500, y: 40 }), [1, 0, 0, .4, 0, 12], "Shift-free vertical line retains its zero axis");

const resizePreviews = [], resizeCommits = [], resizeUpdates = [], resizeRestores = [];
let resizeSelection = ["first", "second"];
let resizeFrame = { bounds: resizeBounds, transform: IDENTITY };
const textModel = { id: "textbox", kind: "text", pageIndex: 0, x: 10, y: 20, width: 100, height: 50,
  fontSize: 12, text: "Wrapping text", transform: [1, 0, 0, 1, 0, 0] };
const resizing = vm.createContext({ active: true, running: false, structuralRunning: false, activeText: null, disposed: false,
  ...frameHelpers,
  requestedPreview: null, isSceneSettling: () => false,
  tool: "select", textRequest: 0, pointer: null, pendingPick: null, polygon: null,
  overlay: { dataset: {}, style: {}, setPointerCapture() {}, releasePointerCapture() {} },
  host: { clientToScenePoint: (x, y) => ({ x, y }) }, clearPreview: restore => resizeRestores.push(restore), queuePreview() {},
  session: { getSelectionBounds: () => resizeBounds, getSelectionFrame: () => resizeFrame, getSelection: () => resizeSelection, getObject: () => textModel,
    sourceScene: { pageRects: [0, 0, 400, 300] }, updateObject: (id, patch) => resizeUpdates.push({ id, patch }) },
  interaction: { previewTransform: matrix => resizePreviews.push(Array.from(matrix)), applyTransform: matrix => resizeCommits.push(Array.from(matrix)) },
  commit: change => change()
});
install(resizing, "dragMatrix", "resizeTextBox", "transformModifiers", "updatePointerCursor", "pointerDown", "pointerMove", "pointerUp");
const resizeEvent = (x, y, modifiers = {}) => ({ ...event(30, "ne"), clientX: x, clientY: y, shiftKey: false, altKey: false, ...modifiers });
await resizing.pointerDown(resizeEvent(110, 70, { shiftKey: true, altKey: true }));
assert.equal(resizing.pointer.freeResize, true); assert.equal(resizing.pointer.scaleText, true, "corner press captures Shift and Alt");
resizing.pointerMove(resizeEvent(210, 45));
assert.equal(resizing.pointer.freeResize, false); assert.equal(resizing.pointer.scaleText, false, "pointer movement observes released modifiers");
nearMatrix(resizePreviews.at(-1), [1.7, 0, 0, 1.7, -7, -14], "default selection preview");
resizing.pointerMove(resizeEvent(210, 45, { shiftKey: true }));
nearMatrix(resizePreviews.at(-1), [2, 0, 0, .5, -10, 10], "Shift selection preview");
resizing.pointerUp(resizeEvent(210, 45, { shiftKey: true }));
nearMatrix(resizeCommits.at(-1), resizePreviews.at(-1), "multiselection preview and commit agree");
await resizing.pointerDown(resizeEvent(110, 70)); resizing.pointerMove(resizeEvent(210, 45, { shiftKey: true }));
resizing.pointerUp(resizeEvent(310, 70));
nearMatrix(resizeCommits.at(-1), [2.6, 0, 0, 2.6, -16, -32], "release reads its final coordinates and released Shift");
resizeSelection = ["textbox"];
await resizing.pointerDown(resizeEvent(110, 70)); resizing.pointerMove(resizeEvent(210, 45, { shiftKey: true, altKey: true }));
resizing.pointerUp(resizeEvent(210, 45, { shiftKey: true, altKey: true }));
nearMatrix(resizeCommits.at(-1), [2, 0, 0, .5, -10, 10], "Alt+Shift explicitly scales textbox appearance freely");
assert.equal(resizeUpdates.length, 0, "Alt scaling uses the affine edit rather than changing textbox wrapping dimensions");
for (const freeResize of [false, true]) {
  const affineBefore = resizeCommits.length;
  await resizing.pointerDown(resizeEvent(110, 70)); resizing.pointerMove(resizeEvent(210, 45, { shiftKey: freeResize }));
  const preview = resizePreviews.at(-1); resizing.pointerUp(resizeEvent(210, 45, { shiftKey: freeResize }));
  const update = resizeUpdates.at(-1), updated = { ...textModel, ...update.patch };
  assert.equal(update.id, "textbox"); assert.equal(updated.fontSize, 12); assert.equal(resizeCommits.length, affineBefore, "ordinary textbox resizing rewraps instead of scaling its font appearance");
  near(updated.width, freeResize ? 200 : 170, "textbox width"); near(updated.height, freeResize ? 25 : 85, "textbox height");
  const beforeCorners = [{ x: textModel.x, y: textModel.y }, { x: textModel.x + textModel.width, y: textModel.y + textModel.height }];
  const afterCorners = [{ x: updated.x, y: updated.y }, { x: updated.x + updated.width, y: updated.y + updated.height }];
  beforeCorners.forEach((point, index) => { const expected = transformPoint(preview, point); near(afterCorners[index].x, expected.x, "textbox preview/commit X"); near(afterCorners[index].y, expected.y, "textbox preview/commit Y"); });
}
const wrappingUpdatesBeforeReflection = resizeUpdates.length;
await resizing.pointerDown(resizeEvent(110, 70)); resizing.pointerMove(resizeEvent(-40, -5)); resizing.pointerUp(resizeEvent(-40, -5));
nearMatrix(resizeCommits.at(-1), [-.5, 0, 0, -.5, 15, 30], "reflected textbox resize uses a uniform appearance transform");
assert.equal(resizeUpdates.length, wrappingUpdatesBeforeReflection, "reflection does not produce negative textbox wrapping dimensions");
const textCorners = (object, pageOrigin) => [[0, 0], [object.width, 0], [object.width, object.height], [0, object.height]].map(([x, y]) => {
  const point = transformPoint(object.transform, { x: object.x + x, y: object.y + y });
  return { x: point.x + pageOrigin.x, y: point.y + pageOrigin.y };
});
for (const [name, transform] of [["rotated", [0, 1, -1, 0, 200, 300]], ["sheared", [1, .25, .4, 1.5, 17, -8]]]) {
  const pageOrigin = { x: 40, y: 60 }, object = { ...textModel, transform }, corners = textCorners(object, pageOrigin);
  resizing.session.sourceScene = { pageRects: [pageOrigin.x, pageOrigin.y, 1040, 1060] };
  const bounds = { minX: Math.min(...corners.map(point => point.x)), minY: Math.min(...corners.map(point => point.y)), maxX: Math.max(...corners.map(point => point.x)), maxY: Math.max(...corners.map(point => point.y)) };
  const start = { x: bounds.minX, y: bounds.maxY }, fixed = { x: bounds.maxX, y: bounds.minY };
  for (const scale of [1.4, .4]) {
    const point = { x: fixed.x + scale * (start.x - fixed.x), y: fixed.y + scale * (start.y - fixed.y) };
    const gesture = { action: "resize", handle: "nw", start, last: point, bounds }, matrix = resizing.dragMatrix(gesture, point);
    const patch = resizing.resizeTextBox(gesture, object, matrix), updated = { ...object, ...patch }, updatedCorners = textCorners(updated, pageOrigin);
    near(updated.width, object.width * scale, `${name}: local wrapping width`); near(updated.height, object.height * scale, `${name}: local wrapping height`);
    near(updated.width / updated.height, object.width / object.height, `${name}: local aspect ratio`);
    assert.equal(updated.fontSize, object.fontSize); assert.equal(updated.transform, object.transform);
    corners.forEach((corner, index) => { const expected = transformPoint(matrix, corner); near(updatedCorners[index].x, expected.x, `${name}: projected corner X`); near(updatedCorners[index].y, expected.y, `${name}: projected corner Y`); });
  }
}
resizing.session.sourceScene = { pageRects: [0, 0, 400, 300] }; resizeSelection = ["first", "second"];
await resizing.pointerDown(resizeEvent(110, 70)); resizing.pointerMove(resizeEvent(210, 45));
const stationaryPosition = resizing.pointer.last;
resizing.transformModifiers({ key: "Shift", shiftKey: true, altKey: false });
assert.equal(resizing.pointer.freeResize, true); nearMatrix(resizePreviews.at(-1), [2, 0, 0, .5, -10, 10], "Shift press previews free scaling without pointer movement");
resizing.transformModifiers({ key: "Alt", shiftKey: true, altKey: true }); assert.equal(resizing.pointer.scaleText, true);
resizing.transformModifiers({ key: "Shift", shiftKey: false, altKey: true });
assert.equal(resizing.pointer.freeResize, false); nearMatrix(resizePreviews.at(-1), [1.7, 0, 0, 1.7, -7, -14], "Shift release restores constrained scaling without pointer movement");
resizing.transformModifiers({ key: "Alt", shiftKey: false, altKey: false }); assert.equal(resizing.pointer.scaleText, false);
assert.equal(resizing.pointer.last, stationaryPosition);
const modifierPreviews = resizePreviews.length;
resizing.transformModifiers({ key: "Shift", shiftKey: true, altKey: false, isComposing: true });
resizing.transformModifiers({ key: "x", shiftKey: true, altKey: false });
assert.equal(resizePreviews.length, modifierPreviews, "IME and unrelated keys do not alter active resize geometry");
resizing.pointerUp(resizeEvent(210, 45)); nearMatrix(resizeCommits.at(-1), resizePreviews.at(-1), "stationary modifier preview and final commit agree");
await resizing.pointerDown(resizeEvent(110, 70, { shiftKey: true })); resizing.pointerMove(resizeEvent(-40, 120, { shiftKey: true }));
nearMatrix(resizePreviews.at(-1), [-.5, 0, 0, 2, 15, -20], "valid reflected free preview before releasing Shift");
const beforeSingularPreview = resizePreviews.length, beforeSingularCommit = resizeCommits.length;
resizing.transformModifiers({ key: "Shift", shiftKey: false, altKey: false });
assert.equal(resizePreviews.length, beforeSingularPreview); assert.equal(resizeRestores.at(-1), true, "singular uniform projection restores committed paint rather than retaining the prior preview");
geometry.IDENTITY = [1, 0, 0, 1, 0, 0]; geometry.dragMatrix = matrixHost.dragMatrix; geometry.pointer = resizing.pointer;
geometryFrame = resizing.pointer.frame; geometry.presented = null;
geometry.updateGeometry();
const restoredFrame = shapes.find(item => item.tag === "polygon" && item.class === "hepr-editor-selection");
assert.equal(restoredFrame.points, "10,70 110,70 110,20 10,20", "a singular candidate keeps the outline on committed corners");
resizing.pointerUp(resizeEvent(-40, 120)); assert.equal(resizeCommits.length, beforeSingularCommit, "singular release does not commit a collapsed transform");
geometry.pointer = null;
await resizing.pointerDown(resizeEvent(110, 70)); resizing.pointerMove(resizeEvent(-40, -5));
const reflectedPreviewCount = resizePreviews.length, restoresBeforeSingularMove = resizeRestores.length;
resizing.pointerMove(resizeEvent(-40, 120));
assert.equal(resizePreviews.length, reflectedPreviewCount); assert.equal(resizeRestores.length, restoresBeforeSingularMove + 1); assert.equal(resizeRestores.at(-1), true, "pointer movement to zero projection also clears an earlier reflected preview");
resizing.pointerUp(resizeEvent(-40, 120));
for (const type of ["keydown", "keyup"]) assert.match(source, new RegExp(`window\\.addEventListener\\(["']${type}["'],\\s*transformModifiers`));

// The rendered frame retains its actual corners through preview and all
// committed-selection states, instead of replacing them with an axis hull.
const angle30 = Math.PI / 6, initialOrientedFrame = { bounds: resizeBounds,
  transform: [Math.cos(angle30), Math.sin(angle30), -Math.sin(angle30), Math.cos(angle30), 200, 150] };
geometryFrame = initialOrientedFrame; geometry.pointer = null; geometry.updateGeometry();
assert.equal(rotationInput.value, "30", "Rotate shows the selection's current angle");
rotationDocument.activeElement = rotationInput; rotationInput.value = "12.75"; geometry.toolbarInput({ target: rotationInput }); geometry.updateGeometry();
assert.equal(rotationInput.value, "12.75", "frame updates preserve an active numeric draft");
geometry.currentState = { revision: 0, selection: ["other"] };
geometry.updateRotationValue({ bounds: resizeBounds, transform: [0, 1, -1, 0, 0, 0] });
assert.equal(rotationInput.value, "90", "selecting another object refreshes a focused Rotate field");
assert.equal(geometry.rotationDraft, null, "a draft cannot carry over to another selection");
geometry.currentState = { revision: 0, selection: ["object"] };
rotationDocument.activeElement = null; geometry.updateGeometry(); assert.equal(rotationInput.value, "30");
const renderedCorners = () => shapes.find(item => item.tag === "polygon" && item.class === "hepr-editor-selection")?.points.split(" ").map(pair => {
  const [x, y] = pair.split(",").map(Number); return { x, y };
});
const checkCornerSquares = corners => {
  let dx = corners[1].x - corners[0].x, dy = corners[1].y - corners[0].y;
  if (dx === 0 && dy === 0) { dx = corners[3].x - corners[0].x; dy = corners[3].y - corners[0].y; }
  const expectedAngle = Math.atan2(dy, dx) * 180 / Math.PI;
  const handles = shapes.filter(item => item.tag === "rect" && item["data-handle"]);
  assert.equal(handles.length, 4);
  handles.forEach((handle, index) => {
    const transform = /^rotate\(([^)]+)\)$/.exec(handle.transform ?? ""); assert(transform, "each corner square rotates with the projected frame");
    const [angle, x, y] = transform[1].trim().split(/[\s,]+/).map(Number);
    near(angle, expectedAngle, "corner square angle"); near(x, corners[index].x, "corner rotation center X"); near(y, corners[index].y, "corner rotation center Y");
    near(handle.x + 4, x, "square center X"); near(handle.y + 4, y, "square center Y");
    assert.equal(handle.width, 8); assert.equal(handle.height, 8, "handle dimensions stay in CSS pixels");
    if (geometry.pointer) assert.equal(handle.style.cursor, "inherit", "rotated squares retain the active gesture cursor");
  });
};
const checkRenderedFrame = expected => {
  renderedCorners().forEach((corner, index) => { near(corner.x, expected[index].x, "rendered frame X"); near(corner.y, expected[index].y, "rendered frame Y"); });
  const hitIndex = shapes.findIndex(item => item.class === "hepr-editor-selection-hit"), outlineIndex = shapes.findIndex(item => item.tag === "polygon" && item.class === "hepr-editor-selection");
  assert(hitIndex >= 0 && hitIndex < outlineIndex, "the move surface is below the frame and handles");
  assert.equal(shapes[hitIndex].points, shapes[outlineIndex].points, "the move surface follows the exact oriented preview/frame polygon");
  assert.equal(shapes[hitIndex]["data-selection-move"], "true");
  assert(shapes.findIndex(item => item["data-handle"]) > outlineIndex, "corner and rotation handles remain above the move surface");
  checkCornerSquares(expected);
};
checkRenderedFrame(editorFrameCorners(initialOrientedFrame));
const center = editorFrameCenter(initialOrientedFrame), turn = Math.PI / 4;
geometry.pointer = { action: "rotate", frame: initialOrientedFrame, bounds: resizeBounds,
  start: { x: center.x + 40, y: center.y }, last: { x: center.x + Math.cos(turn) * 40, y: center.y + Math.sin(turn) * 40 } };
const rotationDelta = geometry.dragMatrix(geometry.pointer, geometry.pointer.last), committedFrame = { ...initialOrientedFrame,
  transform: composeMatrices(rotationDelta, initialOrientedFrame.transform) };
geometry.updateGeometry(); checkRenderedFrame(editorFrameCorners(initialOrientedFrame));
assert.equal(rotationInput.value, "30", "the angle keeps the last presented pose until its preview is drawn");
geometry.presented = { sourceScene: geometry.session.sourceScene, revision: 0, selection: new Set(["object"]), frame: initialOrientedFrame, delta: rotationDelta };
rotationDocument.activeElement = rotationInput;
geometry.updateGeometry(); checkRenderedFrame(editorFrameCorners(initialOrientedFrame, rotationDelta));
near(Number(rotationInput.value), editorFrameRotation(initialOrientedFrame, rotationDelta), "the displayed angle follows the presented rotation preview");
assert(shapes.filter(item => item.tag === "rect" && item["data-handle"]).every(handle => handle.style.cursor === "inherit"),
  "corner handles inherit the active rotation cursor instead of overriding it with idle resize cursors");
geometryFrame = committedFrame; geometry.pointer = null;
geometry.presented = { sourceScene: geometry.session.sourceScene, revision: 0, selection: new Set(["object"]), frame: committedFrame, delta: null };
geometry.updateGeometry(); checkRenderedFrame(editorFrameCorners(committedFrame));
near(Number(rotationInput.value), editorFrameRotation(committedFrame), "a focused field follows the committed rotation after release");
rotationDocument.activeElement = null;
geometryFrame = null; geometry.updateGeometry(); assert.equal(renderedCorners(), undefined);
assert.equal(rotationInput.value, ""); assert.equal(rotationInput.disabled, true, "clearing selection disables and clears Rotate");
assert.equal(shapes.some(item => item.class === "hepr-editor-selection-hit"), false, "empty selection has no move hit area");
geometryFrame = committedFrame; geometry.updateGeometry(); checkRenderedFrame(editorFrameCorners(committedFrame));
geometryFrame = initialOrientedFrame; geometry.updateGeometry(); checkRenderedFrame(editorFrameCorners(initialOrientedFrame));
geometryFrame = committedFrame; geometry.updateGeometry(); checkRenderedFrame(editorFrameCorners(committedFrame));
const projectedFrame = editorFrameClientGeometry(committedFrame, point => ({ x: point.x + 100, y: point.y + 50 }));
shapes.filter(item => item.tag === "rect" && item["data-handle"]).forEach((handle, index) => {
  assert.equal(handle.style.cursor, projectedFrame.cursors[index], "each rendered corner gets its projected cursor family");
  near(handle.x + 4, projectedFrame.corners[index].x - 100, "handle X"); near(handle.y + 4, projectedFrame.corners[index].y - 50, "handle Y");
});
const originalFrameProject = geometry.host.sceneToClientPoint;
for (const zoom of [.25, 8]) {
  const hostAngle = -35 * Math.PI / 180;
  geometry.host.sceneToClientPoint = (x, y) => ({ x: 100 + zoom * (Math.cos(hostAngle) * x - Math.sin(hostAngle) * y),
    y: 50 + zoom * (Math.sin(hostAngle) * x + Math.cos(hostAngle) * y) });
  geometry.updateGeometry();
  checkCornerSquares(editorFrameCorners(committedFrame).map(point => {
    const client = geometry.host.sceneToClientPoint(point.x, point.y); return { x: client.x - 100, y: client.y - 50 };
  }));
}
for (const degenerateBounds of [{ minX: 10, minY: 20, maxX: 10, maxY: 70 }, { minX: 10, minY: 20, maxX: 10, maxY: 20 }]) {
  geometryFrame = { ...committedFrame, bounds: degenerateBounds }; geometry.updateGeometry();
  checkCornerSquares(renderedCorners());
}
geometryFrame = committedFrame; geometry.host.sceneToClientPoint = originalFrameProject; geometry.updateGeometry();

// A rotated textbox's Shift resize follows its own local axes and the same
// preview transform, while keeping glyph size unchanged.
const pageOrigin = { x: 40, y: 60 }, rotatedText = { ...textModel, transform: initialOrientedFrame.transform };
resizeFrame = { bounds: resizeBounds, transform: [...rotatedText.transform] };
resizeFrame.transform[4] += pageOrigin.x; resizeFrame.transform[5] += pageOrigin.y;
resizing.session.sourceScene = { pageRects: [40, 60, 1040, 1060] }; resizing.session.getObject = () => rotatedText; resizeSelection = ["textbox"];
const rotatedStart = editorFrameCorners(resizeFrame)[1], rotatedTarget = transformPoint(resizeFrame.transform, { x: 210, y: 45 });
await resizing.pointerDown(resizeEvent(rotatedStart.x, rotatedStart.y));
resizing.pointerMove(resizeEvent(rotatedTarget.x, rotatedTarget.y, { shiftKey: true }));
const rotatedPreview = resizePreviews.at(-1); resizing.pointerUp(resizeEvent(rotatedTarget.x, rotatedTarget.y, { shiftKey: true }));
const rotatedPatch = resizeUpdates.at(-1).patch, resizedRotatedText = { ...rotatedText, ...rotatedPatch };
near(resizedRotatedText.width, 200, "rotated Shift textbox width"); near(resizedRotatedText.height, 25, "rotated Shift textbox height"); assert.equal(resizedRotatedText.fontSize, 12);
const oldTextCorners = textCorners(rotatedText, pageOrigin), newTextCorners = textCorners(resizedRotatedText, pageOrigin);
oldTextCorners.forEach((corner, index) => { const expected = transformPoint(rotatedPreview, corner); near(newTextCorners[index].x, expected.x, "rotated Shift preview/commit X"); near(newTextCorners[index].y, expected.y, "rotated Shift preview/commit Y"); });

const forcedPageCalls = [];
resizeFrame = { bounds: resizeBounds, transform: IDENTITY, pageIndex: 4 }; resizeSelection = ["first", "second"];
resizing.host.clientToScenePoint = (x, y, pageIndex) => {
  forcedPageCalls.push(pageIndex);
  return pageIndex === 4 ? { x, y } : null;
};
await resizing.pointerDown(resizeEvent(110, 70));
assert.equal(resizing.pointer.frame.pageIndex, 4, "a margin handle press uses the selected frame's page plane");
resizing.pointerMove(resizeEvent(210, 45));
assert.equal(resizing.pointer.last.x, 210, "moving beyond the selected page continues on its captured plane");
resizing.pointerUp(resizeEvent(310, 70));
assert.deepEqual(forcedPageCalls, [4, 4, 4], "handle press, movement and final release retain the selected page index");
nearMatrix(resizeCommits.at(-1), [2.6, 0, 0, 2.6, -16, -32], "final handle release is reprojected on the captured page");

let numericFrame = initialOrientedFrame;
const numericMatrices = [], numericNudges = [];
const numeric = vm.createContext({ ...frameHelpers, activeText: null, pointer: null, currentState: { selection: ["numeric"] }, rotationDraft: null,
  document: rotationDocument, query: () => rotationInput, session: { sourceScene: {}, getSelectionFrame: () => numericFrame,
  getSelectionBounds() { const corners = editorFrameCorners(numericFrame); return { minX: Math.min(...corners.map(point => point.x)), minY: Math.min(...corners.map(point => point.y)), maxX: Math.max(...corners.map(point => point.x)), maxY: Math.max(...corners.map(point => point.y)) }; } },
  commit: change => change(), interaction: { applyTransform(matrix) { numericMatrices.push(Array.from(matrix)); numericFrame = { ...numericFrame, transform: composeMatrices(matrix, numericFrame.transform) }; },
    nudge(x, y) { numericNudges.push([x, y]); } } });
install(numeric, "transformProperty", "changeTransform", "updateRotationValue");
const initialSize = editorFrameSize(numericFrame), fixedSouthwest = editorFrameCorners(numericFrame)[3];
numeric.transformProperty("width", initialSize.width * 2);
near(editorFrameSize(numericFrame).width, initialSize.width * 2, "numeric rotated local width"); near(editorFrameSize(numericFrame).height, initialSize.height, "numeric width retains local height");
near(editorFrameCorners(numericFrame)[3].x, fixedSouthwest.x, "numeric southwest X"); near(editorFrameCorners(numericFrame)[3].y, fixedSouthwest.y, "numeric southwest Y");
numeric.transformProperty("height", initialSize.height * 1.5); near(editorFrameSize(numericFrame).height, initialSize.height * 1.5, "numeric rotated local height");
const beforeNumericRotation = numericFrame, numericCenter = editorFrameCenter(numericFrame);
numeric.transformProperty("rotation", 90); const numericRotation = numericMatrices.at(-1);
near(editorFrameRotation(numericFrame), 90, "numeric Rotate sets the absolute selection angle");
near(transformPoint(numericRotation, numericCenter).x, numericCenter.x, "numeric rotation fixes frame center X"); near(transformPoint(numericRotation, numericCenter).y, numericCenter.y, "numeric rotation fixes frame center Y");
const numericDragAngle = (90 - editorFrameRotation(beforeNumericRotation)) * Math.PI / 180;
const dragRotation = matrixHost.dragMatrix({ action: "rotate", frame: beforeNumericRotation, bounds: resizeBounds,
  freeRotation: true, start: { x: numericCenter.x + 50, y: numericCenter.y } },
  { x: numericCenter.x + Math.cos(numericDragAngle) * 50, y: numericCenter.y + Math.sin(numericDragAngle) * 50 });
nearMatrix(numericRotation, dragRotation, "numeric and drag rotation use the same center");
numeric.transformProperty("rotation", 90); nearMatrix(numericMatrices.at(-1), IDENTITY, "repeating an absolute angle does not rotate again");
numeric.transformProperty("rotation", 12.75); near(editorFrameRotation(numericFrame), 12.75, "numeric entry retains precise unsnapped angles");
numeric.transformProperty("rotation", 450); near(editorFrameRotation(numericFrame), 90, "numeric angles wrap to the current orientation");
rotationDocument.activeElement = rotationInput; rotationInput.value = "450";
numeric.changeTransform(rotationInput); assert.equal(rotationInput.value, "90", "a committed numeric angle normalizes even while focused");
numeric.updateRotationValue(beforeNumericRotation);
assert.equal(rotationInput.value, "90", "the accepted numeric value is retained while earlier document frames are still displayed");
const beforeBlankRotation = numericMatrices.length; rotationInput.value = ""; numeric.changeTransform(rotationInput);
assert.equal(numericMatrices.length, beforeBlankRotation, "blank rotation input does not rotate the selection to zero"); assert.equal(rotationInput.value, "90");
numeric.pointer = { action: "rotate" }; numeric.updateRotationValue(beforeNumericRotation);
assert.equal(rotationInput.value, "30", "a subsequent rotation gesture takes over from the focused numeric edit");
numeric.pointer = null; numeric.updateRotationValue(numericFrame); assert.equal(rotationInput.value, "90", "release or cancellation updates a focused field after gesture takeover");
rotationDocument.activeElement = null;
const worldBounds = numeric.session.getSelectionBounds(); numeric.transformProperty("x", worldBounds.minX + 17); numeric.transformProperty("y", worldBounds.minY - 9);
assert.deepEqual(numericNudges, [[17, 0], [0, -9]], "numeric positions retain their world-axis placement contract");
const transformsBeforeInvalidProperty = numericMatrices.length; numeric.transformProperty("width", 0); numeric.transformProperty("rotation", NaN);
assert.equal(numericMatrices.length, transformsBeforeInvalidProperty);

// Rotation uses the same snapped/free pose for drag previews, stationary
// modifier changes and final release, including a page-plane handle drag.
const rotateRadians = 17 * Math.PI / 180;
resizeFrame = { bounds: resizeBounds, transform: [Math.cos(rotateRadians), Math.sin(rotateRadians), -Math.sin(rotateRadians), Math.cos(rotateRadians), 20, 30], pageIndex: 7 };
resizeSelection = ["first", "second"];
const rotateCenter = editorFrameCenter(resizeFrame), rotationPages = [];
resizing.host.clientToScenePoint = (x, y, pageIndex) => { rotationPages.push(pageIndex); return { x, y }; };
const rotateEvent = (angle, modifiers = {}) => {
  const radians = angle * Math.PI / 180;
  return { ...resizeEvent(rotateCenter.x + Math.cos(radians) * 100, rotateCenter.y + Math.sin(radians) * 100, modifiers), target: event(30, "rotate").target };
};
const resultingAngle = matrix => editorFrameRotation(resizeFrame, matrix);
await resizing.pointerDown(rotateEvent(0));
assert.equal(resizing.pointer.action, "rotate"); assert.equal(resizing.pointer.freeRotation, false);
resizing.pointerMove(rotateEvent(-14)); near(resultingAngle(resizePreviews.at(-1)), 0, "rotation near zero snaps to zero");
resizing.pointerMove(rotateEvent(-11)); near(resultingAngle(resizePreviews.at(-1)), 6, "rotation outside zero's five-degree window remains free");
resizing.pointerMove(rotateEvent(18)); near(resultingAngle(resizePreviews.at(-1)), 35, "rotation outside the next snapping window remains free");
resizing.pointerMove(rotateEvent(30)); near(resultingAngle(resizePreviews.at(-1)), 45, "drag snaps the absolute orientation to 45 degrees");
resizing.transformModifiers({ key: "Alt", altKey: true, shiftKey: false });
near(resultingAngle(resizePreviews.at(-1)), 47, "Alt frees rotation without requiring pointer motion");
const beforeIgnoredRotationModifier = resizePreviews.length;
resizing.transformModifiers({ key: "Shift", altKey: true, shiftKey: true });
assert.equal(resizePreviews.length, beforeIgnoredRotationModifier, "Shift keeps its existing selection/resize role");
resizing.transformModifiers({ key: "Alt", altKey: false, shiftKey: false });
near(resultingAngle(resizePreviews.at(-1)), 45, "releasing Alt restores snapping at the stationary pointer");
resizing.pointerUp(rotateEvent(43, { altKey: true }));
near(resultingAngle(resizeCommits.at(-1)), 60, "release uses its final coordinates and Alt modifier");
assert(rotationPages.every(page => page === 7), "rotation keeps the selected page plane through release");
await resizing.pointerDown(rotateEvent(0, { altKey: true }));
assert.equal(resizing.pointer.freeRotation, true, "Alt is captured when the rotation starts");
resizing.pointerMove(rotateEvent(40, { altKey: true })); near(resultingAngle(resizePreviews.at(-1)), 57, "Alt pointer motion retains precise rotation");
resizing.pointerUp(rotateEvent(40)); near(resultingAngle(resizeCommits.at(-1)), 57, "release outside the snapping window stays free without Alt");
await resizing.pointerDown(rotateEvent(0, { altKey: true }));
resizing.pointerMove(rotateEvent(40, { altKey: true }));
resizing.pointerUp(rotateEvent(32)); near(resultingAngle(resizeCommits.at(-1)), 45, "release entering the snapping window uses the final coordinates and modifier");
const beforeRotationClick = resizeCommits.length;
await resizing.pointerDown(rotateEvent(0)); resizing.pointerUp(rotateEvent(0));
assert.equal(resizeCommits.length, beforeRotationClick, "clicking a rotated grip without dragging does not snap or commit");
assert.doesNotMatch(source, /input\.dataset\.transform === "rotation"\) input\.value = "0"/, "numeric Rotate is never reset to zero after a change");

const surfaceSelection = ["first", "second"], surfaceModifiers = [], surfacePlanes = [], surfaceTransforms = [], surfaceText = [];
let surfacePicks = 0;
const surfaceFrame = { bounds: resizeBounds, transform: IDENTITY, pageIndex: 5 };
const surface = vm.createContext({ ...frameHelpers, active: true, running: false, disposed: false, activeText: null,
  isSceneSettling: () => false,
  tool: "select", textRequest: 0, pointer: null, pendingPick: null, picking: null, polygon: null, fieldAtClientPoint: () => null,
  host: { clientToScenePoint(x, y, pageIndex) { surfacePlanes.push(pageIndex); return pageIndex === 5 ? { x, y } : null; } },
  overlay: { dataset: {}, style: {}, setPointerCapture() {}, releasePointerCapture() {} }, clearPreview() {}, queuePreview() {},
  session: { getSelectionBounds: () => resizeBounds, getSelectionFrame: () => surfaceFrame, getSelection: () => surfaceSelection,
    getObject: id => ({ id, kind: "text" }) },
  pick: async () => { surfacePicks++; return "picked-object"; }, startText: async (point, object) => surfaceText.push({ point, object }),
  interaction: { selectHit(id, modifiers) { surfaceModifiers.push({ id, ctrl: Boolean(modifiers.ctrlKey), cmd: Boolean(modifiers.metaKey), shift: Boolean(modifiers.shiftKey) }); },
    previewTransform() {}, applyTransform: matrix => surfaceTransforms.push(Array.from(matrix)) }, commit: change => change()
});
install(surface, "updatePointerCursor", "cancelPointerGesture", "dragMatrix", "pointerDown", "pointerMove", "pointerUp", "doubleClick");
const surfaceEvent = (x, y, modifiers = {}) => ({ ...event(40), clientX: x, clientY: y, ...modifiers,
  target: { closest: () => null, getAttribute: name => name === "data-selection-move" ? "true" : null } });
await surface.pointerDown(surfaceEvent(50, 50));
assert.equal(surface.pointer.action, "move"); assert.equal(surface.pointer.frame, surfaceFrame);
assert.equal(surfacePicks, 0); assert.deepEqual(surfaceModifiers, [], "plain selection-surface presses keep the current multiselection without picking again");
assert.deepEqual(surfaceSelection, ["first", "second"]);
surface.pointerMove(surfaceEvent(80, 70)); surface.pointerUp(surfaceEvent(80, 70));
nearMatrix(surfaceTransforms[0], [1, 0, 0, 1, 30, 20], "selection-surface drag moves the entire selection");
assert.deepEqual(surfacePlanes, [5, 5], "selection-surface press and drag use the selected frame's page plane");
surface.host.clientToScenePoint = (x, y) => ({ x, y });
for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) await surface.pointerDown(surfaceEvent(50, 50, modifiers));
assert.equal(surfacePicks, 3); assert.equal(surface.pointer, null);
assert.deepEqual(surfaceModifiers, [{ id: "picked-object", ctrl: true, cmd: false, shift: false },
  { id: "picked-object", ctrl: false, cmd: true, shift: false }, { id: "picked-object", ctrl: false, cmd: false, shift: true }], "surface modifiers retain ordinary object picking and selection semantics");
surface.host.clientToScenePoint = (x, y, pageIndex) => { assert.equal(pageIndex, 5); return { x, y }; };
await surface.doubleClick(surfaceEvent(50, 50)); assert.equal(surfaceText.length, 1);
assert.equal(surfaceText[0].object.id, "picked-object", "double-click text editing on the selection surface retains its forced page plane");

assert.match(source, /tool:\s*Tool\s*=\s*["']select["']/);
assert.match(source, /overlay\.dataset\.tool\s*=\s*tool/);
assert.match(source, /fields\.hidden\s*=\s*true/);
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({ selector: match[1].trim(), declarations: match[2] }));
const rule = (selector, declaration) => rules.some(value => selector.test(value.selector) && declaration.test(value.declarations));
assert(rule(/^\.hepr-editor-selection-hit$/, /cursor\s*:\s*move/));
assert(rule(/^\.hepr-editor-selection-hit$/, /fill\s*:\s*transparent/));
assert(rule(/^\.hepr-editor-selection-hit$/, /pointer-events\s*:\s*all/), "the whole selection interior accepts movement");
assert(rule(/data-gesture[^{}]*hepr-editor-selection-hit/, /cursor\s*:\s*inherit/), "the move surface cannot replace an active resize or rotation cursor");
for (const selector of [/not\(\[data-tool=select\]\)[^{}]*hepr-editor-selection-hit/, /data-busy=true[^{}]*hepr-editor-selection-hit/]) {
  assert(rule(selector, /display\s*:\s*none/)); assert(rule(selector, /pointer-events\s*:\s*none/));
}
assert.match(css, /--hepr-editor-rotate-cursor\s*:\s*url\([^;]+,\s*crosshair/, "rotation defines an SVG cursor with a fallback");
for (const attribute of ["handle", "gesture"]) assert(rule(new RegExp(`data-${attribute}\\s*=\\s*["']?rotate`), /cursor\s*:\s*var\(--hepr-editor-rotate-cursor\)/), "hover and active rotation both use the dedicated cursor");
for (const corner of ["ne", "sw"]) assert(rule(new RegExp(`data-(?:handle|resize-handle)\\s*=\\s*["']?${corner}["']?\\]`), /cursor\s*:\s*nesw-resize/), `${corner}: resize direction follows its screen diagonal`);
assert(rule(/hepr-editor-handle|data-(?:handle|resize-handle)\s*=\s*["']?(?:nw|se)/, /cursor\s*:\s*nwse-resize/));
assert(rule(/data-tool\s*=\s*["']?text/, /cursor\s*:\s*text/), "Text uses an insertion cursor before placement");
assert.match(css, /--hepr-editor-pencil-cursor\s*:\s*url\([^;]+,\s*crosshair/);
assert(rule(/data-tool\s*=\s*["']?ink/, /cursor\s*:\s*var\(--hepr-editor-pencil-cursor\)/), "pencil drawing has its own cursor");
assert(rule(/data-busy\s*=\s*["']?true/, /cursor\s*:\s*progress/), "busy surfaces do not advertise actionable drawing cursors");
assert(!rule(/data-tool\s*=\s*["']?(?:form|pan)[^{}]*hepr-editor-graphic/, /display\s*:\s*none/),
  "switching to Fill or Pan keeps pending drawing previews visible until presentation");
const settlingCursor = rules.find(value => /data-settling/.test(value.selector) && /cursor\s*:\s*progress/.test(value.declarations));
assert(settlingCursor); assert.match(settlingCursor.selector, /:is\(\[data-tool=select\],\[data-tool=text\],\[data-tool=image\]\)/,
  "same-source drawing tools retain their actionable cursors during preparation");
assert(rule(/^\.hepr-editor-overlay$/, /cursor\s*:\s*crosshair/), "shape and asset placement retain a precision crosshair fallback");
assert(rule(/data-tool\s*=\s*["']?pan/, /pointer-events\s*:\s*none/), "Pan leaves event ownership with the host canvas");
for (const style of [nativeCss, threeHtml]) {
  assert.match(style, /#viewport\s*\{[^}]*cursor:\s*grab/s);
  assert.match(style, /#viewport:active\s*\{[^}]*cursor:\s*grabbing/s);
}
console.log("Editor affordances: tool-only handles, gesture ownership/cancellation, cursor states and pan pass-through passed.");
