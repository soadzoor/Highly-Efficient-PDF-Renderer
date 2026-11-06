import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createEditorCameraPan } from "../src/editorCameraPan.ts";
import { editorUiTestContext } from "./lib/editorUiTestContext.mjs";
import { sourceFunction } from "./lib/sourceFunction.mjs";

const source = await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8"), nested = source.replace(/^ {2}/gm, "");
const noop = () => {};
class Element extends EventTarget {
  dataset = {}; style = {}; captures = new Set();
  contains(node) { return node === this; }
  closest() { return null; }
  getAttribute() { return null; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 400 }; }
}
const previousNode = globalThis.Node; globalThis.Node = Element;
try {
  function harness() {
    const window = new EventTarget(), overlay = new Element(), canvas = new Element(), areas = [], rectangles = [], wheels = [];
    let currentCanvas = canvas;
    overlay.ownerDocument = { defaultView: window };
    const pose = { zoom: 1, x: 0, y: 0 }, rects = [0, 0, 100, 100, 150, 0, 250, 100];
    const offset = page => page === 1 ? { x: -150, y: 150 } : { x: 0, y: 0 };
    const pageAt = point => {
      for (let page = 0; page < 2; page++) if (point.x >= rects[page * 4] && point.x <= rects[page * 4 + 2] && point.y >= 0 && point.y <= 100) return page;
      return -1;
    };
    const host = {
      getCanvas: () => currentCanvas,
      clientToScenePoint(x, y, page) {
        const unproject = index => ({ x: (x - pose.x) / pose.zoom - offset(index).x, y: (y - pose.y) / pose.zoom - offset(index).y });
        if (page !== undefined) return unproject(page);
        for (let index = 0; index < 2; index++) { const point = unproject(index); if (pageAt(point) === index) return point; }
        return null;
      },
      sceneToClientPoint(x, y, page = pageAt({ x, y })) {
        if (page < 0) return null;
        return { x: (x + offset(page).x) * pose.zoom + pose.x, y: (y + offset(page).y) * pose.zoom + pose.y };
      },
      beginCameraPan: noop, endCameraPan: noop,
      panCameraByPixels(dx, dy) { pose.x += dx; pose.y += dy; }
    };
    canvas.dispatchEvent = event => { wheels.push(event); if (event.ctrlKey || event.metaKey) pose.zoom *= 1.5; else pose.y -= event.deltaY; return true; };
    const context = editorUiTestContext({
      active: true, window, host, overlay, createEditorCameraPan, toolbar: { style: {}, hidden: false },
      pointer: null, pendingPick: null, picking: null, polygon: null, signatureHover: null, textRequest: 0, pendingTextPaints: new Set(),
      pageAt, isSceneSettling: () => false, pick: async () => null, updatePolygonPreview: noop, updateShapeGesture: noop,
      pendingDrawings: { visible: () => [] }, displayedSelection: () => ({ frame: null }), updateRotationValue: noop,
      graphic: { setAttribute: noop, replaceChildren: () => { rectangles.length = 0; } }, focusPendingField: noop,
      svg: (tag, values) => { rectangles.push({ tag, ...values }); return { style: {} }; },
      session: { sourceScene: { pageRects: rects }, revision: 0, getSelection: () => [], getSelectionBounds: () => null,
        getSelectionFrame: () => null, getState: () => ({ previewing: false }) },
      interaction: { selectHit: noop, selectArea: (bounds, options) => areas.push({ bounds, options }), cancelTransform: noop },
      contextMenu: { close: noop }, previewGeneration: 0, previewQueued: false, previewPending: false, clearPreview: noop,
      updatePointerCursor: noop, running: false, refreshScene: async () => {},
      WheelEvent: class { constructor(type, values) { this.type = type; Object.assign(this, values); } }
    });
    for (const name of ["updateMarqueePoint", "pointerDown", "pointerMove", "pointerUp", "cancelPointerGesture", "forwardWheel", "updateGeometry"])
      vm.runInContext(sourceFunction(nested, name), context);
    const panStart = nested.indexOf("const cameraPan = createEditorCameraPan("), panEnd = nested.indexOf("\nconst review =", panStart);
    assert(panStart >= 0 && panEnd > panStart);
    vm.runInContext(nested.slice(panStart, panEnd).replace("const cameraPan =", "cameraPan ="), context);
    context.cameraPan.setActive(true);
    const event = (values = {}) => {
      const value = new Event(values.type ?? "pointermove", { cancelable: true });
      for (const [key, item] of Object.entries({ target: overlay, pointerId: 1, pointerType: "mouse", isPrimary: true,
        clientX: 10, clientY: 10, button: -1, buttons: 1, ...values })) if (key !== "type") Object.defineProperty(value, key, { value: item });
      return value;
    };
    return { context, pose, areas, rectangles, wheels, overlay, event,
      swapCanvas() { currentCanvas = new Element(); },
      async start(values) { await context.pointerDown(event({ type: "pointerdown", button: 0, ...values })); assert.equal(context.pointer.action, "marquee"); },
      panEvent(values) { const value = event(values); window.dispatchEvent(value); return value; },
      dispose: () => context.cameraPan.dispose() };
  }

  {
    const h = harness(), c = h.context; await h.start({ shiftKey: true });
    c.pointerMove(h.event({ clientX: 60, clientY: 60 })); const gesture = c.pointer;
    c.forwardWheel(h.event({ deltaY: 20 })); c.forwardWheel(h.event({ ctrlKey: true, deltaY: -20 }));
    assert.equal(c.pointer, gesture, "scroll and zoom retain the same marquee"); assert.equal(h.wheels.length, 2);
    Object.assign(h.pose, { zoom: 2, x: 10, y: 20 }); c.updateGeometry();
    assert.deepEqual({ ...c.pointer.last }, { x: 25, y: 20 }, "a stationary cursor is unprojected after camera changes");
    assert.deepEqual(h.rectangles[0], { tag: "rect", x: 30, y: 40, width: 30, height: 20, class: "hepr-editor-marquee" }, "the anchor follows the document and endpoint stays at the cursor");
    c.pointerUp(h.event({ type: "pointerup", button: 0, buttons: 0, clientX: 70, clientY: 70 }));
    assert.deepEqual({ ...h.areas[0].bounds }, { minX: 10, minY: 10, maxX: 30, maxY: 25 }, "release uses its final coordinates");
    assert.equal(h.areas[0].options.shiftKey, true); assert.equal(h.areas[0].options.pageIndex, undefined); h.dispose();
  }
  {
    const h = harness(), c = h.context; await h.start();
    c.pointerMove(h.event({ clientX: 50, clientY: 180 }));
    assert.equal(c.pointer.lastPageIndex, 1); assert.deepEqual({ ...c.pointer.last }, { x: 200, y: 30 });
    c.pointerMove(h.event({ clientX: 50, clientY: 130 }));
    assert.deepEqual({ ...c.pointer.last }, { x: 200, y: -20 }, "a gap uses the last page's unbounded plane");
    c.pointerUp(h.event({ type: "pointerup", button: 0, buttons: 0, clientX: 50, clientY: 210 }));
    assert.deepEqual({ ...h.areas[0].bounds }, { minX: 10, minY: 10, maxX: 200, maxY: 60 }, "cross-page selection remains unfiltered"); h.dispose();
  }
  for (const firstRelease of ["middle", "left"]) {
    const h = harness(), c = h.context; await h.start(); const gesture = c.pointer;
    h.panEvent({ clientX: 40, clientY: 50, button: 1, buttons: 5 });
    assert(c.cameraPan.isPanning()); assert.equal(c.pointer, gesture); assert(h.overlay.hasPointerCapture(1));
    h.panEvent({ clientX: 60, clientY: 80, buttons: 5 });
    assert.deepEqual(h.pose, { zoom: 1, x: 20, y: 30 });
    if (firstRelease === "middle") {
      h.panEvent({ clientX: 65, clientY: 85, button: 1, buttons: 1 });
      assert(!c.cameraPan.isPanning()); assert.equal(c.pointer, gesture); assert(h.overlay.hasPointerCapture(1), "middle release retains marquee capture");
      c.pointerUp(h.event({ type: "pointerup", clientX: 90, clientY: 95, button: 0, buttons: 0 }));
    } else {
      h.panEvent({ clientX: 65, clientY: 85, button: 0, buttons: 4 });
      assert.equal(c.pointer, null); assert(c.cameraPan.isPanning()); assert(h.overlay.hasPointerCapture(1), "left release transfers capture to the remaining pan");
      h.panEvent({ type: "pointerup", clientX: 75, clientY: 95, button: 1, buttons: 0 });
    }
    assert.equal(h.areas.length, 1); assert(!h.overlay.hasPointerCapture(1)); assert(!c.cameraPan.isPanning()); h.dispose();
  }
  for (const cancellation of ["Escape", "pointercancel", "blur", "capture"]) {
    const h = harness(), c = h.context; await h.start(); h.panEvent({ button: 1, buttons: 5 });
    if (cancellation === "capture") { h.overlay.releasePointerCapture(1); h.overlay.dispatchEvent(h.event({ type: "lostpointercapture" })); }
    else h.panEvent(cancellation === "Escape" ? { type: "keydown", key: "Escape" } : { type: cancellation });
    assert.equal(c.pointer, null); assert(!c.cameraPan.isPanning()); assert(!h.overlay.hasPointerCapture(1));
    h.panEvent({ buttons: 5 }); assert(!c.cameraPan.isPanning(), "a canceled chord cannot restart without a marquee");
    c.pointerUp(h.event({ type: "pointerup", buttons: 0 })); assert.equal(h.areas.length, 0, "late releases cannot commit canceled selection"); h.dispose();
  }
  for (const invalidation of ["busy", "canvas"]) {
    const h = harness(), c = h.context; await h.start(); h.panEvent({ button: 1, buttons: 5 });
    if (invalidation === "busy") c.running = true;
    else h.swapCanvas();
    h.panEvent({ type: "pointerup", button: 0, buttons: 0, clientX: 80, clientY: 90 });
    assert.equal(c.pointer, null); assert(!c.cameraPan.isPanning()); assert(!h.overlay.hasPointerCapture(1));
    assert.equal(h.areas.length, 0, `${invalidation} immediately before release cannot commit a stale marquee`); h.dispose();
  }
  console.log("Editor marquee navigation: scroll/zoom retention, stationary geometry, page gaps, cross-page selection, mouse chords, capture and cancellation passed.");
} finally { if (previousNode === undefined) delete globalThis.Node; else globalThis.Node = previousNode; }
