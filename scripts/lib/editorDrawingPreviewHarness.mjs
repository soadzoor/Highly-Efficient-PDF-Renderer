import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { sourceFunction } from "./sourceFunction.mjs";
import { createEditorPendingDrawings } from "../../src/editorPendingDrawings.ts";
import { createEditorInkPreviewCache, editorInkPreviewTransform } from "../../src/editorInkPreview.ts";
import { createEditorShapePreviewCache } from "../../src/editorShapePreview.ts";
import { appendEditorInkSamples, editorInkCaptureTolerance } from "../../src/editorInkCapture.ts";
import { editorSignaturePlacement } from "../../src/editorSignaturePlacement.ts";

// Callers install the repository's TypeScript resolution hook before importing.
const source = (await readFile(new URL("../../src/editorUi.ts", import.meta.url), "utf8")).replace(/^ {2}/gm, "");
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const identity = [1, 0, 0, 1, 0, 0];

export function createEditorDrawingPreviewHarness(initialTool = "ink") {
  const preparations = [], applications = [], errors = [], paths = [], objects = new Map(), properties = {
    color: { value: "#369" }, stroke: { value: "7" }, fill: { value: "#abc" }, "fill-enabled": { checked: true }
  };
  const sourceScene = { pageRects: new Float32Array([1000, 2000, 1300, 2400]) };
  const rect = { left: 80, top: 40, width: 800, height: 1000, right: 880, bottom: 1040 };
  const captures = new Set(); let state = { revision: 0, selection: [], previewing: false };
  const context = vm.createContext({ AbortController, AbortSignal, Set, active: true, disposed: false, running: false, structuralRunning: false, clipboardRunning: false,
    currentState: state, presented: { sourceScene, revision: 0, selection: new Set(), frame: null, delta: null },
    requestedPreview: null, scenePreparation: null, sceneApplication: null, renderRevision: 0,
    latestScene: sourceScene, lifetime: new AbortController(), pointer: null, pendingPick: null, picking: null,
    activeText: null, textRequest: 0, toolRequest: 0, pendingFieldFocus: null, operation: null, tool: initialTool, polygon: null, signature: null, signatureHover: null,
    previewGeneration: 0, previewQueued: false, previewPending: false, objectOpacity: .6, fillOpacity: .2, IDENTITY: identity,
    appendEditorInkSamples, editorInkCaptureTolerance, editorInkPreviewTransform, editorSignaturePlacement,
    inkPreview: createEditorInkPreviewCache(), shapePreview: createEditorShapePreviewCache(), property: name => properties[name],
    window: { devicePixelRatio: 2, cancelAnimationFrame() {} },
    overlay: { dataset: {}, style: {}, setPointerCapture: id => captures.add(id),
      releasePointerCapture: id => captures.delete(id), hasPointerCapture: id => captures.has(id) },
    toolbar: { style: {}, querySelectorAll: () => [] }, fields: { querySelectorAll: () => [] },
    graphic: { setAttribute() {}, replaceChildren() { paths.length = 0; } },
    displayedSelection: () => ({ frame: null }), updateRotationValue() {}, focusPendingField() {},
    svg(tag, attributes) { paths.push({ tag, ...attributes }); return { style: {} }; },
    contextMenu: { close() {} }, updateOpacityControls() {}, renderFields() {}, updateFieldPaint() {}, finishText: async () => {},
    fieldAtClientPoint: () => null, pick: async () => null, startText: async () => {}, cancelText() {},
    inputTarget: () => false, canOpenContextMenu: () => false, showSelectionContextMenu() {}, save: async () => {}, changeHistory() {},
    synchronizeDocumentSource: async () => {}, report: error => { if (error.name !== "AbortError") errors.push(error); },
    pageLocal: (p, index) => [p.x - sourceScene.pageRects[index * 4], p.y - sourceScene.pageRects[index * 4 + 1]],
    session: { sourceScene, get revision() { return state.revision; }, getState: () => state,
      getSelection: () => state.selection,
      getSelectionFrame: () => null, getSelectionBounds: () => null, isObjectVisible: () => true,
      getObject: id => { assert(objects.has(id)); return structuredClone(objects.get(id)); },
      addObject(input) {
        const id = `ink-${objects.size + 1}`; objects.set(id, { ...structuredClone(input), id, transform: identity });
        state = { ...state, revision: state.revision + 1 }; context.currentState = state; return id;
      },
      select(selection) { state = { ...state, selection }; context.currentState = state; },
      getScene(options) {
        const job = { ...deferred(), options, scene: { revision: state.revision, objects: structuredClone([...objects.values()]) } };
        preparations.push(job); return job.promise;
      } },
    host: { getCanvas: () => ({ getBoundingClientRect: () => rect }),
      sceneToClientPoint: (x, y) => ({ x: 100 + 2 * (x - 1000), y: 60 + 2 * (2400 - y) }),
      clientToScenePoint: (x, y) => ({ x: 1000 + (x - 100) / 2, y: 2400 - (y - 60) / 2 }),
      applyScene(scene, signal, onPresented) {
        signal.throwIfAborted(); const job = { ...deferred(), scene, signal, acknowledge: onPresented };
        applications.push(job); return job.promise;
      } },
    interaction: { cancelTransform() {} }
  });
  context.pendingDrawings = createEditorPendingDrawings(context.session);
  for (const name of ["pageAt", "isSceneSettling", "updateGeometry", "drawDrawingPreview", "createShapeDraft", "updateShapeGesture", "updatePolygonPreview", "updatePointerCursor", "clearPreview",
    "cancelPointerGesture", "commit", "refreshScene", "pointerDown", "pointerMove", "pointerUp",
    "completePolygon", "doubleClick", "setTool", "keydown", "signaturePlacementAt", "drawSignatureGhost", "placeSignature"])
    vm.runInContext(sourceFunction(source, name), context);
  const methodStart = source.indexOf("  async setEditing(value, externalSignal) {"), methodEnd = source.indexOf("\n  },\n  isEditing:", methodStart);
  assert(methodStart >= 0 && methodEnd > methodStart);
  vm.runInContext(source.slice(methodStart, methodEnd).replace("async setEditing", "async function setEditing") + "\n}", context);
  const event = (id, x, y, coalesced = []) => ({ button: 0, pointerId: id, clientX: 100 + 2 * x, clientY: 60 + 2 * (400 - y),
    target: { closest: () => null, getAttribute: () => null }, getCoalescedEvents: () => coalesced,
    preventDefault() {}, stopPropagation() {} });
  return { context, paths, objects, properties, preparations, applications, errors, event, sourceScene, rect, captures,
    draw() { context.updateGeometry(); return paths; },
    resolve(index) { const job = preparations[index]; job.resolve(job.scene); },
    acknowledge(index) { applications[index].acknowledge(); },
    finish(index) { applications[index].resolve(); }
  };
}
