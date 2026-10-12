import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
const oldRaf = globalThis.requestAnimationFrame, oldCancel = globalThis.cancelAnimationFrame;
const frames = new Map(); let nextFrame = 1;
globalThis.requestAnimationFrame = callback => { const id = nextFrame++; frames.set(id, callback); return id; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
function frame() { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(performance.now()); }
async function settle() { for (let i = 0; i < 12; i++) { frame(); await new Promise(resolve => setTimeout(resolve, 0)); } }
class Canvas extends EventTarget {
  width = 400; height = 400; ownerDocument = new EventTarget();
  classList = {
    tokens: new Set(),
    toggle(token, force) { if (force) this.tokens.add(token); else this.tokens.delete(token); },
    remove(token) { this.tokens.delete(token); }
  };
  getBoundingClientRect() { return { left: 75, top: 30, right: 275, bottom: 230, width: 200, height: 200 }; }
}
function pointer(canvas, type, x = 175, y = 130, extras = {}) {
  const event = new Event(type);
  Object.assign(event, { clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", button: 0, buttons: type === "pointerdown" ? 1 : 0, ...extras });
  canvas.dispatchEvent(event);
}
function click(canvas, x = 175, y = 130) { pointer(canvas, "pointerdown", x, y); pointer(canvas, "pointerup", x, y); }

try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { HeprThreePdfObject } = await import("../src/threePdfObject.ts");
  const { createThreePrimitiveInteractionController } = await import("../src/threePrimitiveInteraction.ts");
  const scene = Object.assign(createEmptyVectorScene(), {
    pageCount: 1, pageRects: Float32Array.of(0, 0, 10, 10),
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    segmentCount: 1, endpoints: Float32Array.of(1, 5, 0, 0), primitiveMeta: Float32Array.of(9, 5, 0, 0.5),
    primitiveBounds: Float32Array.of(0, 0, 10, 10), styles: Float32Array.of(1, 0, 0, 0)
  });
  const noop = () => {};
  const objects = [];
  function makeObject(data = scene) {
    const renderer = new Proxy({ hasUploadedScene: () => false,
      getViewState: () => ({ zoom: 1, cameraCenterX: 5, cameraCenterY: 5 }) },
    { get: (target, key) => target[key] ?? noop });
    const stub = () => new Proxy({ mesh: new THREE.Mesh(), group: new THREE.Group() },
      { get: (target, key) => target[key] ?? noop });
    const page = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial());
    const uv = new Float32Array(8);
    const pdf = new HeprThreePdfObject({ sourceLabel: "fixture", sourceKind: "hep", scene: data }, "webgl",
      renderer, { width: 200, height: 200 }, null,
      { vectorLodMode: "off", textLodMode: "off", strokeCurveEnabled: true, textVectorOnly: true,
        threeColorCompositing: "linear", pageBackground: [1, 1, 1, 1], vectorOverride: [0, 0, 0, 0] },
      0, stub(), stub(), stub(), stub(), null, null, null, stub(), null, page, uv, new THREE.BufferAttribute(uv, 2));
    objects.push(pdf); return pdf;
  }
  let object = makeObject(), canvas = new Canvas();
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 0, 20); camera.updateMatrixWorld(true);
  let selected = null, selectedColor = null, renders = 0;
  const progress = [], errors = [];
  const controller = createThreePrimitiveInteractionController({ getCanvas: () => canvas,
    getCamera: () => camera, getPdfObject: () => object, requestRender: () => renders++,
    onSelectionChange: (info, color) => { selected = info; selectedColor = color; },
    onPreparationProgress: value => progress.push(value), onError: error => errors.push(error) });
  pointer(canvas, "pointermove"); await settle();
  assert.equal(controller.isEnabled(), false); assert.equal(object.primitivePicker, null);
  controller.enable();
  pointer(canvas, "pointermove"); frame();
  assert.equal(progress.at(-1), 0);
  pointer(canvas, "pointerleave"); await settle();
  assert.equal(progress.at(-1), 100, "document preparation outlives an aborted hover");
  assert.equal(object.primitiveAppearance.getHover(), null);
  pointer(canvas, "pointermove"); await settle();
  assert.equal(canvas.classList.tokens.has("drawing-selection-hover"), true);
  const hoverRenders = renders;
  pointer(canvas, "pointermove", 180, 130); await settle();
  assert.equal(renders, hoverRenders, "unchanged hover reuses traces without scheduling another render");
  click(canvas); await settle();
  assert.equal(selected?.kind, "stroke");
  controller.setSelectedColor("red"); assert.deepEqual(selectedColor, [1, 0, 0]);
  assert.deepEqual(object.primitiveAppearance.getOverrideColor(selected.ref), [1, 0, 0]);

  const oldObject = object, oldCanvas = canvas;
  object = makeObject(); canvas = new Canvas();
  canvas.classList.tokens.add("drawing-selection-hover");
  controller.rendererChanged(); controller.onFrame();
  assert.equal(oldObject.primitivePicker, null, "replacement releases the old index");
  assert.equal(oldObject.primitiveAppearance.getSelection().length, 0);
  assert.equal(canvas.classList.tokens.has("drawing-selection-hover"), false, "a cloned canvas cannot retain stale hover");
  assert.deepEqual(object.primitiveAppearance.getSelection(), [{ kind: "stroke", index: 0 }]);
  assert.deepEqual(object.primitiveAppearance.getOverrideColor(selected.ref), [1, 0, 0]);
  click(oldCanvas, 90, 40); await settle(); assert(selected, "old canvas listeners are removed");
  pointer(canvas, "pointerdown"); pointer(canvas, "pointermove", 210, 180, { buttons: 1 }); pointer(canvas, "pointerup", 210, 180);
  await settle(); assert(selected, "dragging leaves selection intact");

  pointer(canvas, "pointerdown", 90, 40);
  object = makeObject(); controller.rendererChanged();
  pointer(canvas, "pointerup", 90, 40); await settle();
  assert(selected, "same-canvas replacement cancels the preceding gesture instead of selecting on release");
  pointer(canvas, "pointermove"); await settle();
  assert.equal(canvas.classList.tokens.has("drawing-selection-hover"), true,
    "same-canvas replacement releases gesture bookkeeping so hover resumes");

  // Moving the PDF before an asynchronous pick completes must discard that
  // result even without a frame notification from the host.
  click(canvas); frame(); object.position.y = 6; await settle();
  assert.equal(selected, null, "an object transform invalidates a pending click's projection");
  object.position.y = 0; controller.onFrame(); click(canvas); await settle(); assert(selected);
  // Page transforms are part of the view: moving a page while the camera holds
  // still retries a pending click against the new layout.
  const layoutPage = new THREE.Group(); layoutPage.userData.hepr = true; object.add(layoutPage); controller.onFrame();
  let picks = 0; const pick = object.pick.bind(object); object.pick = options => { picks++; return pick(options); };
  click(canvas); frame(); layoutPage.position.x = 1; await settle();
  assert.equal(picks, 2, "a page transform retries a pending click"); assert(selected);
  object.remove(layoutPage); delete object.pick; controller.onFrame();
  controller.resetSelectedColor(); assert.deepEqual(selectedColor, [0, 0, 0]);
  controller.setSelectedColor("blue"); controller.disable();
  assert.equal(object.primitivePicker, null); assert.equal(object.primitiveHighlightLayer, null);
  assert.equal(object.primitiveAppearance.hasOverrides("stroke"), false);
  assert.equal(canvas.classList.tokens.has("drawing-selection-hover"), false);
  assert.equal(progress.at(-1), null); assert.equal(selected, null);

  controller.enable(); pointer(canvas, "pointermove"); frame();
  assert.equal(progress.at(-1), 0);
  const previous = object; object = null; controller.sceneChanged();
  const progressCount = progress.length; await settle();
  assert.equal(progress.length, progressCount, "replaced documents cannot update progress");
  assert.equal(previous.primitivePicker, null);
  object = makeObject({ ...scene }); controller.sceneChanged();
  click(canvas); await settle(); assert(selected);
  const escape = new Event("keydown"); Object.assign(escape, { key: "Escape" });
  canvas.ownerDocument.dispatchEvent(escape); assert.equal(selected, null);
  controller.dispose(); controller.sceneChanged();
  assert.equal(frames.size, 0); assert.deepEqual(errors, []); assert(renders > 0);
  for (const pdf of objects) pdf.dispose();
  console.log("Three drawing-selection controller tests passed.");
} finally {
  hooks.deregister();
  if (oldRaf === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = oldRaf;
  if (oldCancel === undefined) delete globalThis.cancelAnimationFrame; else globalThis.cancelAnimationFrame = oldCancel;
}
