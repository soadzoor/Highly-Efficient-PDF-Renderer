// Synthetic scenes and DOM events; no browser, GPU context or PDF conversion.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import * as THREE from "three";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const originals = [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame];
const frames = new Map(); let nextFrame = 1;
globalThis.requestAnimationFrame = callback => { const id = nextFrame++; frames.set(id, callback); return id; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
function frame() { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(); }
async function settle() { for (let i = 0; i < 5; i++) { frame(); await new Promise(resolve => setTimeout(resolve, 0)); } }
class Canvas extends EventTarget {
  width = 100; height = 100; ownerDocument = new EventTarget();
  attributes = new Map();
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }; }
}
function pointer(canvas, type, x = 20, y = 10, extras = {}) {
  const event = new Event(type);
  Object.assign(event, { clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", button: 0,
    buttons: type === "pointerdown" ? 1 : 0, ...extras });
  canvas.dispatchEvent(event);
}
function click(canvas, x = 20, y = 10) { pointer(canvas, "pointerdown", x, y); pointer(canvas, "pointerup", x, y); }
const annotation = (id, rect, extra = {}) => ({ id, sourcePageIndex: 0, pageIndex: 0, annotationIndex: 0,
  subtype: "Square", flags: 0, visibleInDefaultView: true, hasAppearance: false, pdfGeometry: { rect },
  bounds: { minX: rect[0], minY: rect[1], maxX: rect[2], maxY: rect[3] }, ...extra });
try {
  const { createAnnotationInteractionController } = await import("../src/annotationInteraction.ts");
  const { createNativeAnnotationInteractionAdapter } = await import("../src/nativeAnnotationInteraction.ts");
  const { createThreeAnnotationInteractionAdapter } = await import("../src/threeAnnotationInteraction.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { createDefaultOptionalContentSnapshot } = await import("../src/optionalContent.ts");
  const a = annotation("a", [10, 5, 90, 15]), b = annotation("b", [45, 8, 55, 12]);
  let scene = { annotations: [a, b] }, canvas = new Canvas(), target = {}, key = "0", blocked = false;
  let selected = null, hovered = null, hit = "a", hold = false, picks = 0;
  const waiting = [], selectionEvents = [], hoverEvents = [], errors = [];
  const adapter = {
    getScene: () => scene, getCanvas: () => canvas, getTarget: () => target, getViewKey: () => key,
    setSelection: ids => { selected = ids; }, setHover: id => { hovered = id; },
    async pick(_point, signal) {
      picks++;
      if (hold) await new Promise(resolve => waiting.push({ resolve, signal }));
      return hit === null ? null : { annotationId: hit, distancePx: 0 };
    }
  };
  const controller = createAnnotationInteractionController({ adapter, isInteractionSuppressed: () => blocked,
    onSelectionChange: (ann, source) => selectionEvents.push([ann?.id ?? null, source]),
    onHoverChange: (ann, point) => hoverEvents.push([ann?.id ?? null, point]), onError: error => errors.push(error) });
  controller.select("a"); assert.deepEqual(selected, ["a"]);
  assert.deepEqual(selectionEvents.at(-1), ["a", "list"]);
  controller.select(null);
  pointer(canvas, "pointermove"); await settle(); assert.equal(hovered, "a");
  assert(canvas.attributes.has("data-hepr-annotation-hover"), "precise hover owns the pointer cursor");
  pointer(canvas, "pointermove", 21, 10); await settle();
  assert.equal(hoverEvents.at(-1)[1].x, 21, "tooltip follows the pointer within the same annotation");
  click(canvas); controller.onFrame(); await settle();
  assert.deepEqual(selectionEvents.at(-1), ["a", "canvas"]);
  const count = selectionEvents.length;
  pointer(canvas, "pointerdown"); pointer(canvas, "pointermove", 30, 10, { buttons: 1 }); pointer(canvas, "pointerup", 30, 10);
  pointer(canvas, "pointerdown"); pointer(canvas, "pointerdown", 20, 10, { pointerId: 2, pointerType: "touch" });
  pointer(canvas, "pointerup", 20, 10, { pointerId: 2, pointerType: "touch" }); pointer(canvas, "pointerup");
  click(canvas, 20, 10); pointer(canvas, "pointercancel");
  await settle(); assert.equal(selectionEvents.length, count, "drag, pinch and cancelled gestures do not select");
  blocked = true; controller.onFrame(); click(canvas); await settle();
  assert.equal(selectionEvents.length, count, "text selection and drawing mode suppress canvas picks");
  blocked = false; controller.onFrame(); await settle();

  hold = true; hit = "b"; click(canvas); frame();
  assert.equal(waiting.length, 1);
  pointer(canvas, "pointermove", 50, 10); pointer(canvas, "pointerleave");
  assert.equal(canvas.attributes.has("data-hepr-annotation-hover"), false);
  waiting.shift().resolve(); await settle();
  assert.deepEqual(selected, ["b"], "hover and leaving the canvas cannot replace an active click");
  hold = true; hit = "a"; click(canvas); frame();
  const oldPick = waiting.shift(); key = "1"; controller.onFrame();
  assert.equal(oldPick.signal.aborted, true);
  oldPick.resolve(); await settle();
  assert.equal(waiting.length, 1, "camera changes retry an in-flight click");
  hold = false; waiting.shift().resolve(); await settle(); assert.deepEqual(selected, ["a"]);

  hold = true; click(canvas); frame(); const stale = waiting.shift();
  const oldCanvas = canvas; canvas = new Canvas(); target = {}; controller.refresh();
  assert.equal(stale.signal.aborted, true); assert.deepEqual(selected, ["a"], "renderer replacement preserves selection");
  stale.resolve(); await settle(); const beforeOldEvents = picks;
  click(oldCanvas); await settle(); assert.equal(picks, beforeOldEvents, "old canvas listeners detach");
  click(canvas); frame(); const staleCanvas = waiting.shift();
  canvas = new Canvas(); controller.refresh();
  assert.equal(staleCanvas.signal.aborted, true, "canvas replacement cancels picks even when the PDF object stays the same");
  staleCanvas.resolve(); await settle(); assert.deepEqual(selected, ["a"]);
  scene = { annotations: [b] }; controller.sceneChanged(); assert.equal(selected, null);
  assert.equal(controller.getSelection(), null); assert.throws(() => controller.select("a"), RangeError);
  controller.setInteractionEnabled(false); hold = false; click(canvas); await settle(); assert.equal(selected, null);
  controller.setInteractionEnabled(true); hit = "b"; click(canvas); await settle(); assert.deepEqual(selected, ["b"]);
  hit = null; click(canvas); await settle(); assert.equal(controller.getSelection(), null, "empty canvas click clears the list");
  controller.dispose(); controller.dispose(); const afterDispose = picks; click(canvas); await settle();
  assert.equal(picks, afterDispose); assert.deepEqual(errors, []);

  // Native adapter uses the same annotation geometry and overlap ordering as the Three API.
  scene = buildStrokeScene([{ points: [[10, 10], [90, 10]], width: 1, color: "red" }]);
  scene.bounds = scene.pageBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  scene.pageRects = Float32Array.of(0, 0, 100, 100);
  scene.annotations = [a, b, annotation("shx", [70, 60, 80, 70], { contents: "AutoCAD SHX Text" })];
  scene.optionalContent = { groups: [{ id: "appearance", annotationId: "a", name: "A", defaultVisible: false,
    locked: true, usedInView: false }], conditions: [{ kind: "group", groupId: "appearance" }], order: [], radioGroups: [] };
  scene.drawRuns = [{ kind: "stroke", first: 0, count: 1, optionalContent: 0 }];
  const visibility = createDefaultOptionalContentSnapshot(scene);
  let highlights = null, uploads = 0, view = { cameraCenterX: 50, cameraCenterY: 50, zoom: 1 };
  const makeRenderer = () => ({ getViewState: () => view, getOptionalContentVisibility: () => visibility,
    clientToScenePoint: (x, y) => ({ x, y }), sceneToClientPoint: (x, y) => ({ x, y }),
    setPrimitiveHighlights: value => { highlights = value; uploads++; } });
  let renderer = makeRenderer();
  const native = createNativeAnnotationInteractionAdapter({ getCanvas: () => canvas, getScene: () => scene, getRenderer: () => renderer });
  native.setSelection(["a"]); assert.equal(highlights.selectionCount, 1, "hidden compiled appearance gets its exact trace");
  const signal = new AbortController().signal;
  assert.equal((await native.pick({ x: 20, y: 10 }, signal)).annotationId, "a");
  assert.equal((await native.pick({ x: 50, y: 10 }, signal)).annotationId, "b", "small metadata note stays reachable over drawn paint");
  assert.equal((await native.pick({ x: 75, y: 65 }, signal)).annotationId, "shx");
  native.setSelection(["shx"]); assert.equal(highlights.count, 4, "metadata-only selection traces bounds");
  const beforePan = uploads;
  for (let i = 0; i < 60; i++) { view.cameraCenterX++; native.refresh(); }
  assert.equal(uploads, beforePan, "camera-only refreshes do not upload highlight buffers again");
  native.setActive(false); assert.equal(highlights, null);
  native.setActive(true); assert.equal(highlights.selectionCount, 4, "leaving drawing mode replays annotation selection");
  native.setSelection(null); native.setActive(false); native.setActive(true);
  assert.equal(highlights, null, "cleared traces do not return after mode switching");
  native.setSelection(["a"]); renderer = makeRenderer(); native.refresh(); assert.equal(highlights.count, 1);
  highlights = null; native.refresh(true); assert.equal(highlights.count, 1, "same-renderer scene uploads can replay traces");
  native.dispose();

  const camera = new THREE.OrthographicCamera(-50, 50, 50, -50, .1, 1000);
  const pdf = new THREE.Group(); pdf.sceneData = scene; pdf.layerVisibilityRevision = 0;
  const page = new THREE.Group(); page.userData.hepr = true; pdf.add(page);
  let pickOptions, renderRequests = 0;
  pdf.pickAnnotation = async options => { pickOptions = options; return { annotationId: "a", distancePx: 0 }; };
  pdf.setAnnotationSelection = ids => { selected = ids; }; pdf.setAnnotationHover = id => { hovered = id; };
  const three = createThreeAnnotationInteractionAdapter({ getCanvas: () => canvas, getCamera: () => camera,
    getPdfObject: () => pdf, requestRender: () => renderRequests++ });
  await three.pick({ x: 20, y: 10 }, signal);
  assert.equal(pickOptions.camera, camera); assert.equal(pickOptions.element, canvas); assert.equal(pickOptions.includeHidden, true);
  three.setSelection(["a"]); three.setHover("b"); assert.equal(renderRequests, 2);
  const beforePageMove = three.getViewKey(); page.position.x = 10;
  assert.notEqual(three.getViewKey(), beforePageMove, "independent page transforms invalidate picking");

  // The native demo initializes annotation controls before constructing its renderer.
  const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const binding = source.match(/^annotationInteraction = createAnnotationInteractionController\(\{[\s\S]*?^\}\);/m)[0];
  const startup = vm.createContext({ createAnnotationInteractionController, createNativeAnnotationInteractionAdapter,
    annotationInteraction: undefined, canvasElement: canvas, lastParsedScene: null, renderer: undefined,
    drawingSelection: { isEnabled: () => false }, textSelection: { getSelectedText: () => "" },
    annotationControls: { selectAnnotation: () => {} }, annotationOverlay: { hide: () => {} }, setStatus: () => {} });
  vm.runInContext(stripTypeScriptTypes(binding), startup);
  vm.runInContext("annotationInteraction.dispose()", startup);
  console.log("Annotation UI interaction passed: synchronized selection, gestures, query races, lifecycle, native/Three adapters and highlight replay.");
} finally {
  [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame] = originals;
  hooks.deregister();
}
