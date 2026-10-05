import assert from "node:assert/strict";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const hooks = registerHooks({ resolve(s, c, next) {
  return c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? next(`${s}.ts`, c) : next(s, c);
} });

class Element extends EventTarget {
  children = []; style = {}; attributes = new Map(); hidden = false; textContent = "";
  offsetWidth = 180; offsetHeight = 80;
  constructor(document) { super(); this.ownerDocument = document; }
  set innerHTML(_) { throw new Error("PDF strings must never become HTML"); }
  setAttribute(k, v) { this.attributes.set(k, v); }
  removeAttribute(k) { this.attributes.delete(k); }
  appendChild(child) { child.parent = this; this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  contains(child) { return this === child || this.children.some(c => c.contains(child)); }
  remove() { this.parent.children = this.parent.children.filter(c => c !== this); }
  focus() { this.ownerDocument.activeElement = this; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 300, bottom: 200 }; }
}
class Window extends EventTarget {
  innerWidth = 400; innerHeight = 300; frames = new Map(); nextId = 1;
  requestAnimationFrame(callback) { const id = this.nextId++; this.frames.set(id, callback); return id; }
  cancelAnimationFrame(id) { this.frames.delete(id); }
  frame() { const callbacks = [...this.frames.values()]; this.frames.clear(); for (const cb of callbacks) cb(); }
}
function annotation(index, bounds, extra = {}) {
  return { id: `ref:${index}:0`, sourcePageIndex: 4, pageIndex: 0, annotationIndex: index, subtype: "Square",
    bounds, pdfGeometry: { rect: [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY] },
    flags: 0, visibleInDefaultView: true, hasAppearance: true, contents: `Comment ${index}`, ...extra };
}
function text(element) { return element.textContent + element.children.map(text).join(""); }

try {
  const { createAnnotationOverlay, pickSceneAnnotation } = await import("../src/annotationOverlay.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const window = new Window();
  const document = { defaultView: window, createElement: () => new Element(document) };
  document.body = new Element(document);
  let canvas = new Element(document), suppressed = false, shift = 0, visibility = null;
  const annotations = [
    annotation(0, { minX: 5, minY: 5, maxX: 95, maxY: 95 }),
    annotation(1, { minX: 10, minY: 10, maxX: 30, maxY: 30 }, { contents: "<img src=x onerror=bad()>" }),
    annotation(2, { minX: 40, minY: 10, maxX: 70, maxY: 30 }, { subtype: "Popup" }),
    annotation(3, { minX: 40, minY: 40, maxX: 70, maxY: 70 }, { subtype: "Underline",
      quadPoints: [40, 70, 70, 70, 40, 60, 70, 60, 40, 50, 70, 50, 40, 40, 70, 40] }),
    annotation(4, { minX: 110, minY: 10, maxX: 180, maxY: 30 }, { subtype: "Ink", inkList: [[110, 20, 180, 20]] }),
    annotation(5, { minX: 210, minY: 10, maxX: 230, maxY: 30 }, { flags: 32 }),
    annotation(6, { minX: 210, minY: 50, maxX: 230, maxY: 70 }, { optionalContent: 0, visibleInDefaultView: false }),
    annotation(7, { minX: 280, minY: 150, maxX: 340, maxY: 180 })
  ];
  let scene = { ...createEmptyVectorScene(), annotations, pageCount: 1, pageRects: Float32Array.of(0, 0, 300, 200),
    optionalContent: { groups: [], conditions: [{ kind: "constant", value: false }], order: [], radioGroups: [] } };
  const adapter = {
    getScene: () => scene, getOptionalContentVisibility: () => visibility,
    clientToScenePoint: (x, y) => ({ x: x - shift, y }), sceneToClientPoint: (x, y) => ({ x: x + shift, y }),
    isInteractionSuppressed: () => suppressed
  };
  assert.equal(pickSceneAnnotation(scene, 20, 20, adapter), annotations[1], "smaller overlapping annotation wins");
  assert.equal(pickSceneAnnotation(scene, 50, 55, adapter), annotations[0], "multiline bounding-box gaps are not markup hits");
  assert.equal(pickSceneAnnotation(scene, 50, 65, adapter), annotations[3]);
  assert.equal(pickSceneAnnotation(scene, 150, 23, adapter), annotations[4]);
  assert.equal(pickSceneAnnotation(scene, 150, 29, adapter), null, "ink tests distance to the stroke");
  annotations[4].border = { width: 12 };
  assert.equal(pickSceneAnnotation(scene, 150, 29, adapter), annotations[4], "ink proximity includes source stroke width");
  delete annotations[4].border;
  const duplicate = { ...annotations[1], contents: "Later annotation" };
  scene.annotations = [...annotations, duplicate];
  assert.equal(pickSceneAnnotation(scene, 20, 20, adapter), duplicate, "ties use reverse collection order");
  scene.annotations = annotations;
  assert.equal(pickSceneAnnotation(scene, 220, 20, adapter), null, "NoView hides the hit area");
  assert.equal(pickSceneAnnotation(scene, 220, 60, adapter), null, "layer default hides the hit area");
  assert.equal(pickSceneAnnotation(scene, 320, 160, adapter), null, "page crop clips hit areas");
  // Execute the native example's actual bindings in source order. Its overlay
  // reads the scene during construction, before the renderer is assigned.
  const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const startupBindings = [
    mainSource.match(/^let lastParsedScene:[^\n]+;/m),
    mainSource.match(/^const annotationOverlay = createAnnotationOverlay\(\{[\s\S]*?^\}\);/m)
  ];
  assert(startupBindings.every(Boolean), "native example startup bindings exist");
  const startup = vm.createContext({
    createAnnotationOverlay, canvasElement: canvas, renderer: undefined,
    linkNavigation: { activate: () => false, getActivationLabel: () => null },
    annotationBubblesCheckbox: { checked: true },
    drawingSelection: { isEnabled: () => false },
    textSelection: { getSelectedText: () => "" },
    annotationControls: { isAnnotationEnabled: () => true },
    fixtureScene: scene,
    fixtureRenderer: { getOptionalContentVisibility: () => visibility,
      clientToScenePoint: adapter.clientToScenePoint, sceneToClientPoint: adapter.sceneToClientPoint }
  });
  vm.runInContext(stripTypeScriptTypes(startupBindings.sort((a, b) => a.index - b.index)
    .map(match => match[0]).join("\n")), startup);
  vm.runInContext("annotationOverlay.onFrame()", startup);
  vm.runInContext("renderer = fixtureRenderer; lastParsedScene = fixtureScene; annotationOverlay.show(lastParsedScene.annotations[1])", startup);
  assert.equal(document.body.children[0].hidden, false, "native overlay opens after renderer and document initialization");
  vm.runInContext("annotationOverlay.dispose()", startup);
  assert.equal(document.body.children.length, 0);

  const overlay = createAnnotationOverlay({ getCanvas: () => canvas, adapter });
  const panel = document.body.children[0];
  const hasPointerCursor = (element = canvas) => element.attributes.has("data-hepr-annotation-hover");
  canvas.style.cursor = "text";
  assert(panel.children.some(child => child.textContent.includes("cursor: pointer !important")),
    "annotation hover takes precedence over the text selection cursor");
  const event = (type, x = 20, y = 20, extra = {}, target = canvas) => {
    const e = new Event(type, { cancelable: true });
    Object.defineProperty(e, "target", { value: target });
    Object.assign(e, { clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", button: 0,
      buttons: type === "pointerdown" ? 1 : 0, ...extra });
    window.dispatchEvent(e); return e;
  };
  event("pointermove"); window.frame();
  assert.equal(panel.hidden, false); assert(text(panel).includes("<img src=x onerror=bad()>"));
  assert.equal(document.body.children.length, 1, "only one bubble element");
  assert.equal(hasPointerCursor(), true);
  assert.equal(canvas.style.cursor, "text", "the underlying text cursor is preserved");
  event("pointermove", 200, 100); window.frame();
  assert.equal(hasPointerCursor(), false, "empty page regions retain the host cursor");
  event("pointermove"); window.frame();
  event("pointerout", 20, 20, { relatedTarget: document.body });
  assert.equal(hasPointerCursor(), false, "leaving the canvas releases the hover cursor");
  event("pointermove"); window.frame();
  const down = event("pointerdown");
  assert.equal(hasPointerCursor(), false, "pointerdown releases the cursor for pan/selection gestures");
  event("pointerup"); window.frame();
  assert.equal(hasPointerCursor(), true, "idle cursor returns after a click");
  assert.equal(down.defaultPrevented, false, "camera and selection retain their pointer events");
  event("pointermove", 50, 65); window.frame();
  assert(text(panel).includes("<img"), "hover cannot replace a pinned bubble");
  assert.equal(hasPointerCursor(), true, "other clickable annotations retain pointer feedback while a bubble is pinned");
  event("pointermove", 200, 100); window.frame();
  assert.equal(hasPointerCursor(), false, "pinning a bubble does not pin the cursor");
  assert(text(panel).includes("<img"));
  event("pointerdown", 50, 65); event("pointerup", 50, 65);
  assert(text(panel).includes("Comment 3"), "click replaces the pinned annotation");
  const oldLeft = panel.style.left;
  shift = 10; overlay.onFrame(); window.frame();
  assert.notEqual(panel.style.left, oldLeft, "pin follows view projection");
  shift = 300; overlay.onFrame(); window.frame();
  assert.equal(hasPointerCursor(), false, "camera changes refresh cursor hit testing");
  shift = 10; event("pointermove", 60, 65); window.frame();
  assert.equal(hasPointerCursor(), true);
  const previousCanvas = canvas;
  canvas = new Element(document); overlay.sceneChanged(); overlay.onFrame(); window.frame();
  assert.equal(panel.hidden, false, "backend canvas changes preserve the same scene's pin");
  assert.equal(hasPointerCursor(previousCanvas), false, "backend replacement releases the previous canvas");
  assert.equal(hasPointerCursor(), true);
  event("keydown", 0, 0, { key: "Escape" }); window.frame();
  assert.equal(panel.hidden, true);
  event("pointerdown", 30, 20); event("pointermove", 80, 30, { buttons: 1 }); event("pointerup", 80, 30);
  assert.equal(panel.hidden, true, "dragging never pins");
  assert.equal(hasPointerCursor(), false, "dragging does not leave a pointer cursor");
  event("pointerdown", 30, 20); event("pointerdown", 30, 20, { pointerId: 2 });
  event("pointerup", 30, 20, { pointerId: 2 }); event("pointerup", 30, 20);
  assert.equal(panel.hidden, true, "multitouch gestures never pin");
  overlay.show(annotations[6]); assert.equal(panel.hidden, true);
  visibility = { revision: 1, layers: [], conditions: Uint8Array.of(1) };
  overlay.show(annotations[6]); assert.equal(panel.hidden, false);
  event("pointermove", 230, 60); window.frame(); assert.equal(hasPointerCursor(), true);
  visibility = { revision: 2, layers: [], conditions: Uint8Array.of(0) }; overlay.onFrame(); window.frame();
  assert.equal(panel.hidden, true, "hidden layer dismisses its pin");
  assert.equal(hasPointerCursor(), false, "hidden annotations have no pointer cursor");
  event("pointermove", 30, 20); window.frame(); assert.equal(hasPointerCursor(), true);
  canvas.style.cursor = "crosshair";
  suppressed = true; overlay.onFrame(); window.frame(); assert.equal(panel.hidden, true);
  assert.equal(hasPointerCursor(), false, "drawing selection takes precedence");
  assert.equal(canvas.style.cursor, "crosshair", "releasing annotation hover preserves a newer host cursor");
  suppressed = false; overlay.show(annotations[1]); assert.equal(panel.hidden, false);
  event("pointermove", 30, 20); window.frame(); assert.equal(hasPointerCursor(), true);
  overlay.disable(); assert.equal(panel.hidden, true); assert.equal(overlay.isEnabled(), false);
  assert.equal(hasPointerCursor(), false, "disabling annotation bubbles releases the cursor");
  overlay.enable(); overlay.show(annotations[1]);
  scene = { ...scene }; overlay.sceneChanged(); assert.equal(panel.hidden, true, "new document dismisses pin");
  assert.equal(hasPointerCursor(), false);
  event("pointermove", 30, 20); window.frame(); assert.equal(hasPointerCursor(), true);
  overlay.dispose(); overlay.dispose(); assert.equal(document.body.children.length, 0);
  assert.equal(hasPointerCursor(), false, "disposal restores the host cursor");
  event("pointermove"); window.frame(); assert.equal(document.body.children.length, 0);
  shift = 0;
  annotations[1].subtype = "Link";
  annotations[1].action = { type: "URI", uri: "https://example.com/" };
  annotations[7].subtype = "Link";
  annotations[7].destination = { name: "Missing target" };
  const activations = [];
  const links = createAnnotationOverlay({ getCanvas: () => canvas, adapter,
    onActivate: a => { activations.push(a); return a === annotations[1]; },
    getActivationLabel: () => "Go to destination" });
  const linkPanel = document.body.children[0];
  const buttons = linkPanel.children.filter(child => child.type === "button");
  event("pointermove"); window.frame();
  assert.equal(linkPanel.attributes.get("role"), "tooltip");
  assert.equal(linkPanel.style.pointerEvents, "none", "preview cannot intercept link clicks or pointer movement");
  assert.equal(linkPanel.style.userSelect, "none");
  assert(buttons.every(button => button.hidden), "link previews have no close or action buttons");
  assert(!text(linkPanel).includes("Go to destination"));
  assert.equal(linkPanel.style.left, "32px"); assert.equal(linkPanel.style.top, "32px");
  event("pointermove", 25, 24); window.frame();
  assert.equal(linkPanel.style.left, "37px"); assert.equal(linkPanel.style.top, "36px", "preview follows movement within one link");
  assert.equal(hasPointerCursor(), true);
  event("pointermove", 200, 100); window.frame();
  assert.equal(linkPanel.hidden, true, "leaving a link dismisses its preview");
  event("pointerdown"); event("pointerup");
  assert.deepEqual(activations, [annotations[1]], "a click invokes the host synchronously");
  window.frame(); assert.equal(linkPanel.hidden, true, "consumed activation does not pin or reopen the preview");
  event("pointermove"); window.frame(); canvas.focus();
  assert.equal(linkPanel.hidden, false);
  event("keydown", 0, 0, { key: "Enter" });
  assert.equal(activations.length, 2, "Enter activates the hovered link");
  assert.equal(document.activeElement, canvas, "link activation never focuses a hidden bubble control");
  event("pointerdown"); event("pointermove", 100, 20, { buttons: 1 }); event("pointerup", 20, 20);
  assert.equal(activations.length, 2, "dragging over and back to a link does not activate it");
  event("pointerdown"); event("pointerdown", 20, 20, { pointerId: 2 }); event("pointerup", 20, 20, { pointerId: 2 }); event("pointerup");
  assert.equal(activations.length, 2, "multitouch does not activate");
  suppressed = true; event("pointerdown"); event("pointerup");
  assert.equal(activations.length, 2, "selection suppression prevents activation");
  suppressed = false; links.disable(); event("pointerdown"); event("pointerup");
  assert.equal(activations.length, 2, "disabled helper prevents activation");
  links.enable();
  window.innerWidth = 300; window.innerHeight = 200;
  event("pointermove", 290, 170); window.frame();
  assert.equal(linkPanel.hidden, false, "unresolved destinations still preview");
  assert.equal(linkPanel.style.left, "98px"); assert.equal(linkPanel.style.top, "78px", "edge previews flip away from the pointer");
  assert(buttons.every(button => button.hidden));
  event("pointerdown", 290, 170); event("pointerup", 290, 170); window.frame();
  assert.equal(activations.length, 3);
  assert.equal(linkPanel.hidden, true, "unhandled link clicks cannot pin");
  event("pointermove", 290, 170); window.frame();
  event("keydown", 0, 0, { key: "Enter" });
  assert.equal(activations.length, 4);
  assert.equal(linkPanel.hidden, true, "unhandled keyboard activation cannot pin");
  event("pointerdown", 290, 170, { pointerType: "touch" }); event("pointerup", 290, 170, { pointerType: "touch" });
  assert.equal(activations.length, 5);
  assert.equal(linkPanel.hidden, true, "unhandled touch activation cannot pin");
  event("pointerdown", 20, 20, { pointerType: "touch" }); event("pointerup", 20, 20, { pointerType: "touch" });
  assert.equal(activations.length, 6, "touch still activates valid links directly");
  event("pointermove", 290, 170); window.frame();
  links.show(annotations[7]); assert.equal(linkPanel.hidden, false);
  event("pointermove", 200, 100); window.frame();
  assert.equal(linkPanel.hidden, true, "show(link) cannot pin a preview");
  links.show(annotations[7]); assert.equal(linkPanel.hidden, true, "show(link) requires hovering that link");
  event("pointermove", 290, 170); window.frame();
  event("pointerout", 290, 170, { relatedTarget: linkPanel });
  assert.equal(linkPanel.hidden, true, "moving toward a link preview cannot keep it open");
  event("pointermove"); window.frame();
  shift = 100; links.onFrame(); window.frame();
  assert.equal(linkPanel.hidden, true, "camera changes recheck the hovered link");
  shift = 0; event("pointermove"); window.frame();
  annotations[1].optionalContent = 0; links.onFrame(); window.frame();
  assert.equal(linkPanel.attributes.get("role"), "dialog", "hiding a link exposes the comment underneath, not its link preview");
  delete annotations[1].optionalContent;
  event("pointermove"); window.frame(); event("keydown", 0, 0, { key: "Escape" }); window.frame();
  assert.equal(linkPanel.hidden, true, "Escape dismisses a link preview until the next pointer movement");
  event("pointerdown", 50, 65); event("pointerup", 50, 65);
  assert.equal(linkPanel.hidden, false, "unhandled comments still pin normally");
  assert.equal(linkPanel.attributes.get("role"), "dialog");
  assert.equal(linkPanel.style.pointerEvents, "auto");
  assert.equal(linkPanel.style.userSelect, "text");
  assert(buttons.every(button => !button.hidden), "comments retain their controls, including custom actions");
  const pinnedPosition = [linkPanel.style.left, linkPanel.style.top];
  event("pointermove", 200, 100); window.frame();
  assert.equal(linkPanel.hidden, false);
  assert.deepEqual([linkPanel.style.left, linkPanel.style.top], pinnedPosition, "pinned comments stay anchored to their annotation");
  links.dispose();
  const passive = createAnnotationOverlay({ getCanvas: () => canvas, adapter });
  const passivePanel = document.body.children[0];
  event("pointerdown"); event("pointerup"); window.frame();
  assert.equal(passivePanel.hidden, true, "links cannot pin even without an activation handler");
  event("pointermove"); window.frame();
  assert.equal(passivePanel.hidden, false);
  event("keydown", 0, 0, { key: "Enter" });
  assert.equal(passivePanel.hidden, true);
  passive.dispose();
  // Annotations the host has turned off, as in the example Annotations panel.
  const turnedOff = new Set([annotations[1].id]), activated = [];
  const hostAdapter = { ...adapter, isAnnotationEnabled: a => !turnedOff.has(a.id) };
  assert.equal(pickSceneAnnotation(scene, 20, 20, hostAdapter), annotations[0], "turned-off annotations leave hits to annotations underneath");
  const hosted = createAnnotationOverlay({ getCanvas: () => canvas, adapter: hostAdapter,
    onActivate: a => { activated.push(a); return a === annotations[1]; } });
  const hostedPanel = document.body.children[0];
  event("pointerdown"); event("pointerup");
  assert.deepEqual(activated, [annotations[0]], "a turned-off link is never activated");
  assert.equal(hostedPanel.hidden, false); assert(text(hostedPanel).includes("Comment 0"));
  turnedOff.add(annotations[0].id); hosted.onFrame(); window.frame();
  assert.equal(hostedPanel.hidden, true, "turning an annotation off dismisses its pinned bubble");
  hosted.show(annotations[0]); assert.equal(hostedPanel.hidden, true, "show() skips turned-off annotations");
  event("pointermove"); window.frame();
  assert.equal(hasPointerCursor(), false, "turned-off annotations have no pointer cursor");
  turnedOff.clear(); event("pointermove"); window.frame();
  assert.equal(hasPointerCursor(), true); assert.equal(hostedPanel.hidden, false, "turning it back on restores hover");
  hosted.dispose();
  const manualActivations = [];
  const manual = createAnnotationOverlay({ getCanvas: () => canvas, adapter: hostAdapter, pointerInteraction: false,
    onActivate: a => { manualActivations.push(a); return true; } });
  const manualPanel = document.body.children[0];
  event("pointermove"); event("pointerdown"); event("pointerup"); manual.onFrame(); window.frame();
  assert.equal(manualPanel.hidden, true, "host-owned gestures do not run a second metadata picker");
  assert.deepEqual(manualActivations, [], "host-owned clicks never activate links twice");
  canvas.setAttribute("data-hepr-annotation-hover", "");
  manual.show(annotations[1], { x: 20, y: 20 });
  assert.equal(manualPanel.hidden, false); assert.equal(manualPanel.attributes.get("role"), "tooltip");
  manual.show(annotations[1], { x: 25, y: 20 }); assert.equal(manualPanel.style.left, "37px");
  event("pointermove", 200, 100); manual.onFrame(); window.frame();
  assert.equal(manualPanel.hidden, false, "host determines the hovered annotation");
  manual.hide(); assert.equal(manualPanel.hidden, true);
  assert.equal(hasPointerCursor(), true, "manual overlay leaves the host cursor alone");
  manual.show(annotations[0]); assert.equal(manualPanel.hidden, false, "row-selected comments do not require a client point");
  manual.show(annotations[1]); assert.equal(manualPanel.hidden, true, "selecting an unanchored link clears the previous comment bubble");
  manual.show(annotations[0]);
  turnedOff.add(annotations[0].id); manual.onFrame(); assert.equal(manualPanel.hidden, true);
  manual.dispose(); canvas.removeAttribute("data-hepr-annotation-hover");
  console.log("Annotation overlay: precise picking, safe HTML text, pinning, pointer-following links, cursor ownership, gestures, visibility, host-disabled annotations, projection and lifecycle passed.");
} finally { hooks.deregister(); }
