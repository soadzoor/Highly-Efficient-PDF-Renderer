import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";

const [source, css, nativeCss, threeHtml] = await Promise.all([
  readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/editorUi.css", import.meta.url), "utf8"),
  readFile(new URL("../src/style.css", import.meta.url), "utf8"),
  readFile(new URL("../three-example.html", import.meta.url), "utf8")
]);
const nested = source.replace(/^ {2}/gm, "");
const install = (context, ...names) => { for (const name of names) vm.runInContext(sourceFunction(nested, name), context); };
const bounds = { minX: 10, minY: 20, maxX: 50, maxY: 60 };
const shapes = [], overlay = { dataset: {}, style: {} };
const geometry = vm.createContext({
  host: { getCanvas: () => ({ getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 300 }) }),
    sceneToClientPoint: (x, y) => ({ x: x + 100, y: y + 50 }) },
  overlay, graphic: { setAttribute() {}, replaceChildren() { shapes.length = 0; } },
  session: { getSelectionBounds: () => bounds, sourceScene: { pageRects: [0, 0, 400, 300] } },
  sceneBoundsToClient: value => ({ minX: value.minX + 100, minY: value.minY + 50, maxX: value.maxX + 100, maxY: value.maxY + 50 }),
  svg: (tag, attributes) => { shapes.push({ tag, ...attributes }); }, fields: { querySelectorAll: () => [] },
  pointer: null, pendingPick: null, polygon: null, activeText: null, running: false, tool: "select", latestScene: {},
  property: () => ({ value: "#123456" })
});
install(geometry, "updatePointerCursor", "updateGeometry");
for (const tool of ["select", "pan", "form", "text", "rectangle", "ellipse", "line", "arrow", "polygon", "polyline", "ink", "signature", "image"]) {
  geometry.tool = tool; geometry.updateGeometry();
  const handles = shapes.filter(item => item["data-handle"]);
  assert.equal(handles.length, tool === "select" ? 5 : 0, `${tool}: transform handles are exclusive to Select`);
  assert.equal(shapes.some(item => item.class === "hepr-editor-selection"), tool === "select", `${tool}: selection frame follows the active tool`);
  if (tool === "select") assert.deepEqual(handles.map(item => item["data-handle"]), ["nw", "ne", "sw", "se", "rotate"]);
}
geometry.tool = "select"; geometry.running = true; geometry.updateGeometry();
assert.equal(shapes.filter(item => item["data-handle"]).length, 0, "busy operations hide nonfunctional transform handles");
assert.equal(shapes.some(item => item.class === "hepr-editor-selection"), false);
geometry.running = false;
geometry.activeText = { pageIndex: 0, x: 1, y: 2, width: 10, height: 10, transform: [1, 0, 0, 1, 0, 0], element: { style: {} } };
geometry.updateGeometry(); assert.equal(shapes.filter(item => item["data-handle"]).length, 0, "an active textbox owns the editing affordance");
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
const gestureOverlay = { dataset: {}, setPointerCapture(id) { captures.add(id); }, hasPointerCapture: id => captures.has(id),
  releasePointerCapture(id) { captures.delete(id); released.push(id); } };
for (const name of ["select", "pan", "form", "rectangle"]) toolButtons.push({ dataset: { tool: name }, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } });
let finishPick, abortedPicks = 0;
const gestures = vm.createContext({
  active: true, running: false, structuralRunning: false, activeText: null, disposed: false, tool: "select", toolRequest: 0, textRequest: 0,
  pointer: null, pendingPick: null, picking: { abort() { abortedPicks++; } }, polygon: null,
  overlay: gestureOverlay, fields: { hidden: true }, toolbar: { querySelectorAll: () => toolButtons },
  property: () => ({ disabled: true }), renderFields() {}, updateGeometry() {}, finishText: async () => {},
  host: { clientToScenePoint: (x, y) => ({ x, y }) }, pageAt: () => 0,
  pick: () => new Promise(resolve => { finishPick = resolve; }), clearPreview: restore => previews.push(restore),
  interaction: { selectHit: id => selected.push(id), selectArea: () => assert.fail("unexpected area selection") },
  session: { getSelectionBounds: () => bounds }, commit: () => assert.fail("cancelled gestures cannot commit changes")
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
  createImageBitmap: file => new Promise(resolve => decodeRequests.push({ file, resolve })),
  document: { createElement(tag) {
    assert.equal(tag, "canvas");
    const canvas = { getContext(kind) { assert.equal(kind, "2d"); return {
      drawImage(bitmap, x, y) { assert.equal(bitmap.width, 2); assert.equal(bitmap.height, 1); assert.equal(x, 0); assert.equal(y, 0); },
      getImageData(x, y, width, height) { assert.deepEqual([x, y, width, height], [0, 0, 2, 1]); return { data: rgba }; }
    }; } }; decodedCanvases.push(canvas); return canvas;
  } },
  setTool: tool => activatedTools.push(tool), setStatus: value => imageStatuses.push(value)
});
install(images, "importImage");
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

const near = (actual, expected, label) => {
  assert(Number.isFinite(actual), `${label}: finite result`);
  assert(Math.abs(actual - expected) <= 1e-12 * Math.max(1, Math.abs(expected)), `${label}: expected ${expected}, received ${actual}`);
};
const nearMatrix = (actual, expected, label) => actual.forEach((value, index) => near(value, expected[index], `${label}, matrix ${index}`));
const transformPoint = (matrix, point) => ({ x: matrix[0] * point.x + matrix[2] * point.y + matrix[4], y: matrix[1] * point.x + matrix[3] * point.y + matrix[5] });
const resizeBounds = { minX: 10, minY: 20, maxX: 110, maxY: 70 };
const matrixHost = vm.createContext({}); install(matrixHost, "dragMatrix");
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
const textModel = { id: "textbox", kind: "text", pageIndex: 0, x: 10, y: 20, width: 100, height: 50,
  fontSize: 12, text: "Wrapping text", transform: [1, 0, 0, 1, 0, 0] };
const resizing = vm.createContext({ active: true, running: false, structuralRunning: false, activeText: null, disposed: false,
  tool: "select", textRequest: 0, pointer: null, pendingPick: null, polygon: null,
  overlay: { dataset: {}, setPointerCapture() {}, releasePointerCapture() {} },
  host: { clientToScenePoint: (x, y) => ({ x, y }) }, clearPreview: restore => resizeRestores.push(restore), queuePreview() {},
  session: { getSelectionBounds: () => resizeBounds, getSelection: () => resizeSelection, getObject: () => textModel,
    sourceScene: { pageRects: [0, 0, 400, 300] }, updateObject: (id, patch) => resizeUpdates.push({ id, patch }) },
  interaction: { previewTransform: matrix => resizePreviews.push(Array.from(matrix)), applyTransform: matrix => resizeCommits.push(Array.from(matrix)) },
  commit: change => change()
});
install(resizing, "dragMatrix", "resizeTextBox", "resizeModifiers", "updatePointerCursor", "pointerDown", "pointerMove", "pointerUp");
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
resizing.resizeModifiers({ key: "Shift", shiftKey: true, altKey: false });
assert.equal(resizing.pointer.freeResize, true); nearMatrix(resizePreviews.at(-1), [2, 0, 0, .5, -10, 10], "Shift press previews free scaling without pointer movement");
resizing.resizeModifiers({ key: "Alt", shiftKey: true, altKey: true }); assert.equal(resizing.pointer.scaleText, true);
resizing.resizeModifiers({ key: "Shift", shiftKey: false, altKey: true });
assert.equal(resizing.pointer.freeResize, false); nearMatrix(resizePreviews.at(-1), [1.7, 0, 0, 1.7, -7, -14], "Shift release restores constrained scaling without pointer movement");
resizing.resizeModifiers({ key: "Alt", shiftKey: false, altKey: false }); assert.equal(resizing.pointer.scaleText, false);
assert.equal(resizing.pointer.last, stationaryPosition);
const modifierPreviews = resizePreviews.length;
resizing.resizeModifiers({ key: "Shift", shiftKey: true, altKey: false, isComposing: true });
resizing.resizeModifiers({ key: "x", shiftKey: true, altKey: false });
assert.equal(resizePreviews.length, modifierPreviews, "IME and unrelated keys do not alter active resize geometry");
resizing.pointerUp(resizeEvent(210, 45)); nearMatrix(resizeCommits.at(-1), resizePreviews.at(-1), "stationary modifier preview and final commit agree");
await resizing.pointerDown(resizeEvent(110, 70, { shiftKey: true })); resizing.pointerMove(resizeEvent(-40, 120, { shiftKey: true }));
nearMatrix(resizePreviews.at(-1), [-.5, 0, 0, 2, 15, -20], "valid reflected free preview before releasing Shift");
const beforeSingularPreview = resizePreviews.length, beforeSingularCommit = resizeCommits.length;
resizing.resizeModifiers({ key: "Shift", shiftKey: false, altKey: false });
assert.equal(resizePreviews.length, beforeSingularPreview); assert.equal(resizeRestores.at(-1), true, "singular uniform projection restores committed paint rather than retaining the prior preview");
geometry.IDENTITY = [1, 0, 0, 1, 0, 0]; geometry.dragMatrix = matrixHost.dragMatrix; geometry.pointer = resizing.pointer;
geometry.updateGeometry();
const restoredFrame = shapes.find(item => item.tag === "rect" && item.class === "hepr-editor-selection");
assert.deepEqual([restoredFrame.x, restoredFrame.y, restoredFrame.width, restoredFrame.height], [10, 20, 100, 50], "a singular candidate keeps the outline on committed bounds");
resizing.pointerUp(resizeEvent(-40, 120)); assert.equal(resizeCommits.length, beforeSingularCommit, "singular release does not commit a collapsed transform");
geometry.pointer = null;
await resizing.pointerDown(resizeEvent(110, 70)); resizing.pointerMove(resizeEvent(-40, -5));
const reflectedPreviewCount = resizePreviews.length, restoresBeforeSingularMove = resizeRestores.length;
resizing.pointerMove(resizeEvent(-40, 120));
assert.equal(resizePreviews.length, reflectedPreviewCount); assert.equal(resizeRestores.length, restoresBeforeSingularMove + 1); assert.equal(resizeRestores.at(-1), true, "pointer movement to zero projection also clears an earlier reflected preview");
resizing.pointerUp(resizeEvent(-40, 120));
for (const type of ["keydown", "keyup"]) assert.match(source, new RegExp(`window\\.addEventListener\\(["']${type}["'],\\s*resizeModifiers`));

assert.match(source, /tool:\s*Tool\s*=\s*["']select["']/);
assert.match(source, /overlay\.dataset\.tool\s*=\s*tool/);
assert.match(source, /fields\.hidden\s*=\s*true/);
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({ selector: match[1].trim(), declarations: match[2] }));
const rule = (selector, declaration) => rules.some(value => selector.test(value.selector) && declaration.test(value.declarations));
assert.match(css, /--hepr-editor-rotate-cursor\s*:\s*url\([^;]+,\s*crosshair/, "rotation defines an SVG cursor with a fallback");
for (const attribute of ["handle", "gesture"]) assert(rule(new RegExp(`data-${attribute}\\s*=\\s*["']?rotate`), /cursor\s*:\s*var\(--hepr-editor-rotate-cursor\)/), "hover and active rotation both use the dedicated cursor");
for (const corner of ["ne", "sw"]) assert(rule(new RegExp(`data-(?:handle|resize-handle)\\s*=\\s*["']?${corner}["']?\\]`), /cursor\s*:\s*nesw-resize/), `${corner}: resize direction follows its screen diagonal`);
assert(rule(/hepr-editor-handle|data-(?:handle|resize-handle)\s*=\s*["']?(?:nw|se)/, /cursor\s*:\s*nwse-resize/));
assert(rule(/data-tool\s*=\s*["']?text/, /cursor\s*:\s*text/), "Text uses an insertion cursor before placement");
assert.match(css, /--hepr-editor-pencil-cursor\s*:\s*url\([^;]+,\s*crosshair/);
assert(rule(/data-tool\s*=\s*["']?ink/, /cursor\s*:\s*var\(--hepr-editor-pencil-cursor\)/), "pencil drawing has its own cursor");
assert(rule(/data-busy\s*=\s*["']?true/, /cursor\s*:\s*progress/), "busy surfaces do not advertise actionable drawing cursors");
assert(rule(/^\.hepr-editor-overlay$/, /cursor\s*:\s*crosshair/), "shape and asset placement retain a precision crosshair fallback");
assert(rule(/data-tool\s*=\s*["']?pan/, /pointer-events\s*:\s*none/), "Pan leaves event ownership with the host canvas");
for (const style of [nativeCss, threeHtml]) {
  assert.match(style, /#viewport\s*\{[^}]*cursor:\s*grab/s);
  assert.match(style, /#viewport:active\s*\{[^}]*cursor:\s*grabbing/s);
}
console.log("Editor affordances: tool-only handles, gesture ownership/cancellation, cursor states and pan pass-through passed.");
