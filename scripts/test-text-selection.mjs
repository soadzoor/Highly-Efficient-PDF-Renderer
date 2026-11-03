import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
import { installSelectionTestHost } from "./lib/selectionTestHost.mjs";
const { createTextSelectionController } = await import("../src/textSelection.ts");
const { computeCharQuad } = await import("../src/sceneTextGeometry.ts");
const { createSelectionOverlay } = await import("../src/textSelectionOverlay.ts");

// UO.400 DETAILS, physical page 34: the drawing number precedes the project
// name in the stream. Its lower baseline accepts B/l but rejects the shorter
// o, creating an overlapping row-wide box and a mid-word fragment.
const titleRuns = [
  { text: "V27", x: 995, y: 88.41, height: 16.77 },
  { text: "Blok S1 Strijp S", x: 631, y: 92.78, height: 9.78 },
  { text: "1661D", x: 905, y: 91.41, height: 9.78 },
  { text: "fase", x: 894, y: 76.24, height: 4.76 },
  { text: "datum", x: 991, y: 76.24, height: 4.76 },
  { text: "omschrijving", x: 630, y: 76.24, height: 4.76 },
  { text: "T 040 260 67 60", x: 808, y: 36.33, height: 3.63 },
  { text: "dommelstraat 11", x: 630, y: 36.33, height: 3.63 },
  { text: "5611 cj Eindhoven", x: 708, y: 36.33, height: 3.63 }
];

function makeScene(runs, fallback = false) {
  // `joined` runs follow the previous one without a separator, like fields
  // repositioned with Tm that the text index does not split.
  const text = runs.map((run, index) => (index && !run.joined ? " " : "") + run.text).join("");
  const charInstance = [];
  const textInstanceA = [], textInstanceB = [], textGlyphMetaA = [], textGlyphMetaB = [], fallbackQuads = [];
  for (const run of runs) {
    if (charInstance.length && !run.joined) charInstance.push(-1);
    for (let i = 0; i < run.text.length; i++) {
      const ch = run.text[i];
      if (ch === " ") { charInstance.push(-1); continue; }
      const ref = textInstanceB.length / 4;
      const x = run.x + i * run.height * 0.75;
      const low = /[gjpqy,]/.test(ch) ? -run.height * 0.25 : ch === "'" ? run.height * 0.8 : 0;
      const high = /[aceonrsuvwxz]/.test(ch) ? run.height * 0.74 : ch === "," ? run.height * 0.1 : run.height;
      const width = run.height * 0.6;
      charInstance.push(fallback ? -2 - ref : ref);
      textInstanceA.push(1, 0, 0, 1);
      textInstanceB.push(x, run.y, ref, 0);
      textGlyphMetaA.push(0, 0, 0, low);
      textGlyphMetaB.push(width, high, 0, 0);
      fallbackQuads.push(x, run.y + low, x + width, run.y + high);
    }
  }
  return {
    pageRects: Float32Array.from([0, 0, 1200, 900]),
    textIndex: { version: 2, pages: [{ text, charInstance: Int32Array.from(charInstance), fallbackQuads: Float32Array.from(fallbackQuads) }] },
    textInstanceA: Float32Array.from(textInstanceA), textInstanceB: Float32Array.from(textInstanceB),
    textGlyphMetaA: Float32Array.from(textGlyphMetaA), textGlyphMetaB: Float32Array.from(textGlyphMetaB)
  };
}

function withSelection(scene, check, options = {}) {
  const host = installSelectionTestHost();
  let highlights;
  const controller = createTextSelectionController({ ...options, getCanvas: () => host.canvas, adapter: {
    getScene: () => scene,
    clientToScenePoint: (x, y) => ({ x, y }), sceneToClientPoint: (x, y) => ({ x, y }),
    setSelectionHighlights: rects => { highlights = rects; }
  } });
  try { check(host, controller, () => highlights); }
  finally { controller.dispose(); assert.equal(host.listenerCount, 0); host.close(); }
}

function point(scene, offset, fraction) {
  const quad = new Float32Array(4);
  assert(computeCharQuad(scene, scene.textIndex.pages[0], offset, quad, 0));
  return [quad[0] + (quad[2] - quad[0]) * fraction, (quad[1] + quad[3]) / 2];
}

function checkDrag(scene, from, to, expected, rectangleCount = 1, backwards = false) {
  withSelection(scene, (host, controller, highlights) => {
    const start = point(scene, from, 0.1);
    const end = point(scene, to - 1, 0.9);
    host.pointer("pointerdown", ...(backwards ? end : start));
    host.pointer("pointermove", ...(backwards ? start : end));
    host.pointer("pointerup", ...(backwards ? start : end));
    assert.equal(controller.getSelectedText(), expected);
    assert.deepEqual(controller.getSelectionRange(), { start: { pageIndex: 0, offset: from }, end: { pageIndex: 0, offset: to } });
    assert.equal(highlights()?.length, rectangleCount * 4, "separate fields must have separate, non-overlapping highlights");
    if (rectangleCount === 1) {
      const first = point(scene, from, 0);
      const last = point(scene, to - 1, 1);
      assert(highlights()[0] >= first[0] - 2 && highlights()[2] <= last[0] + 2,
        "a field highlight must stay near the selected characters");
    }
  });
}

function checkWord(scene, start, word) {
  withSelection(scene, (host, controller, highlights) => {
    const xy = point(scene, start, 0.5);
    for (let click = 0; click < 2; click++) {
      host.pointer("pointerdown", ...xy); host.pointer("pointerup", ...xy);
    }
    assert.equal(controller.getSelectedText(), word);
    assert.equal(highlights()?.length, 4);
  });
}

function checkTitleBlock(scene) {
  const text = scene.textIndex.pages[0].text;
  for (const run of titleRuns) {
    const start = text.indexOf(run.text);
    checkDrag(scene, start, start + run.text.length, run.text);
    checkDrag(scene, start, start + run.text.length, run.text, 1, true);
  }
  const nameStart = text.indexOf("Blok");
  // Every partial drag must advance within the project name, including the
  // B/l/o transition that originally selected the distant drawing number.
  for (let length = 1; length <= "Blok S1 Strijp S".length; length++) {
    if (text[nameStart + length - 1] !== " ") {
      checkDrag(scene, nameStart, nameStart + length, text.slice(nameStart, nameStart + length));
    }
  }
  for (const word of ["Blok", "Strijp", "1661D", "V27", "dommelstraat", "Eindhoven"]) {
    checkWord(scene, text.indexOf(word), word);
  }
  checkDrag(scene, nameStart, text.indexOf("V27") + 3, "Blok S1 Strijp S 1661D V27", 3);
  checkDrag(scene, nameStart, text.indexOf("V27") + 3, "Blok S1 Strijp S 1661D V27", 3, true);
  const street = text.indexOf("dommelstraat");
  const phoneEnd = text.indexOf("T 040") + "T 040 260 67 60".length;
  checkDrag(scene, street, phoneEnd, "dommelstraat 11 5611 cj Eindhoven T 040 260 67 60", 3);
}

checkTitleBlock(makeScene(titleRuns));
checkTitleBlock(makeScene(titleRuns, true));

// UO.400 DETAILS, last page: Tm places each title-block field with no text
// index separator, so the drawing number "H7" ends at the very offset where
// the visually earlier "Blok" field starts (and the small "H7" where
// "omschrijving", one row up, starts). A caret after the final "7" must stay
// on its own run instead of jumping to the start of the next one.
const joinedRuns = [
  { text: "tekeningnr.", x: 960, y: 114.08, height: 3.63 },
  { text: "H7", x: 996.73, y: 88.41, height: 16.77, joined: true },
  { text: "Blok S1 Strijp S", x: 631, y: 92.78, height: 9.78, joined: true },
  { text: "1661D", x: 905, y: 91.41, height: 9.78 },
  { text: "UO DETAIL H7", x: 630, y: 54.94, height: 9.78 },
  { text: "omschrijving", x: 630, y: 76.24, height: 4.76, joined: true }
];

function checkJoinedRuns(scene) {
  const text = scene.textIndex.pages[0].text;
  const drawingNumber = text.indexOf("H7Blok");
  const detail = text.indexOf("UO DETAIL H7");
  for (const backwards of [false, true]) {
    checkDrag(scene, drawingNumber, drawingNumber + 2, "H7", 1, backwards);
    checkDrag(scene, detail, detail + 12, "UO DETAIL H7", 1, backwards);
    // Both carets share one offset but sit on different runs: from the start
    // of "Blok" to the end of "H7" is the whole row, left to right.
    checkDrag(scene, drawingNumber + 2, drawingNumber + 2, "Blok S1 Strijp S 1661D H7", 3, backwards);
  }
  // Words stop at run boundaries even without a separator.
  checkWord(scene, drawingNumber, "H7");
  checkWord(scene, drawingNumber + 2, "Blok");
  checkWord(scene, detail + 10, "H7");
  checkWord(scene, detail + 12, "omschrijving");
  withSelection(scene, (host, controller) => {
    const blok = point(scene, drawingNumber + 2, 0.5);
    const seven = point(scene, drawingNumber + 1, 0.9);
    host.pointer("pointerdown", ...blok); host.pointer("pointerup", ...blok);
    host.pointer("pointerdown", ...blok); host.pointer("pointermove", ...seven); host.pointer("pointerup", ...seven);
    assert.equal(controller.getSelectedText(), "Blok S1 Strijp S 1661D H7", "word drags extend by the focus run's word");
  });
}

checkJoinedRuns(makeScene(joinedRuns));
checkJoinedRuns(makeScene(joinedRuns, true));

// Normal word spaces, descenders, punctuation and floating quotes stay in
// one run; the new field boundaries must not fragment ordinary prose.
const prose = "one, 'two' next";
const proseScene = makeScene([{ text: prose, x: 20, y: 100, height: 10 }]);
checkDrag(proseScene, 0, prose.length, prose);

// Both code units of a ligature share one glyph; its right half must place
// the caret after the whole ligature, never snap back to its left edge.
const ligature = makeScene([{ text: "fi", x: 20, y: 100, height: 10 }]);
ligature.textIndex.pages[0].charInstance[1] = 0;
checkDrag(ligature, 0, 2, "fi");
checkDrag(ligature, 0, 2, "fi", 1, true);

// Stream order may put a header/footer after the body. Visual order remains
// top to bottom even after same-row fields are sorted left to right.
const rows = makeScene([
  { text: "Body", x: 20, y: 100, height: 10 },
  { text: "Header", x: 20, y: 150, height: 10 },
  { text: "Footer", x: 20, y: 50, height: 10 }
]);
checkDrag(rows, 5, 4, "Header Body", 2);
checkDrag(rows, 0, rows.textIndex.pages[0].text.length, "Body Footer", 2);

// Text owns mouse/pen pointer events so dragging cannot pan the camera, but a
// plain click still needs to reach annotation picking for links over text.
const linkText = makeScene([{ text: "Chapter IX", x: 20, y: 100, height: 10 }]);
const linkPoint = point(linkText, 0, 0.1);
for (const pointerType of ["mouse", "pen"]) {
  const clicks = [];
  withSelection(linkText, (host, controller) => {
    const down = host.pointer("pointerdown", ...linkPoint, { pointerType });
    const up = host.pointer("pointerup", ...linkPoint, { pointerType });
    assert(down.propagationStopped && up.propagationStopped, "text clicks must keep camera gestures blocked");
    assert.deepEqual(clicks, [{ x: linkPoint[0], y: linkPoint[1] }], "plain text clicks must be available to annotation picking");
    assert.equal(controller.getSelectedText(), "");
    assert.equal(controller.isGestureActive(), false);
  }, { onTextClick: p => clicks.push(p) });
  const mixedClicks = [];
  withSelection(linkText, (host) => {
    host.pointer("pointerdown", ...linkPoint, { pointerType });
    host.pointer("pointerdown", ...linkPoint, { pointerType: "touch", pointerId: 2 });
    host.pointer("pointerup", ...linkPoint, { pointerType });
    host.pointer("pointerup", ...linkPoint, { pointerType: "touch", pointerId: 2 });
    assert.deepEqual(mixedClicks, [], "an additional pointer must cancel text link activation");
  }, { onTextClick: p => mixedClicks.push(p) });
}

for (const gesture of ["drag", "returning drag", "moved release", "long hold", "cancel", "disabled", "touch tap"]) {
  const clicks = [];
  withSelection(linkText, (host, controller) => {
    const options = gesture === "touch tap" ? { pointerType: "touch" } : {};
    const down = host.pointer("pointerdown", ...linkPoint, options);
    let end = linkPoint;
    if (gesture.includes("drag")) {
      end = point(linkText, 6, 0.9);
      host.pointer("pointermove", ...end);
      if (gesture === "returning drag") {
        end = linkPoint;
        host.pointer("pointermove", ...end);
      }
    }
    if (gesture === "moved release") end = [linkPoint[0] + 5, linkPoint[1]];
    if (gesture === "long hold") host.advanceTime(451);
    if (gesture === "disabled") controller.disable();
    host.pointer(gesture === "cancel" ? "pointercancel" : "pointerup", ...end, options);
    assert.deepEqual(clicks, [], `${gesture} must not activate a text link`);
    if (gesture === "drag") assert.equal(controller.getSelectedText(), "Chapter");
    if (gesture === "touch tap") assert.equal(down.propagationStopped, false, "annotation picking already receives touch taps");
  }, { onTextClick: p => clicks.push(p) });
}

const wordClicks = [];
withSelection(linkText, (host, controller) => {
  host.pointer("pointerdown", ...linkPoint);
  host.pointer("pointerup", ...linkPoint);
  host.pointer("pointerdown", ...linkPoint);
  host.pointer("pointerup", ...linkPoint);
  assert.equal(controller.getSelectedText(), "Chapter", "double click must still select a word");
  assert.equal(wordClicks.length, 1, "word selection must not forward the second click");
  const rightDown = host.pointer("pointerdown", ...linkPoint, { button: 2 });
  assert(rightDown.propagationStopped, "right click on a selection must still block camera gestures");
  host.pointer("pointerup", ...linkPoint, { button: 2 });
  assert.equal(controller.getSelectedText(), "Chapter", "right click must preserve text selection");
  assert.equal(wordClicks.length, 1, "right click must not activate a link");
}, { onTextClick: p => wordClicks.push(p) });

withSelection(linkText, (host, controller) => {
  let reads = 0;
  host.canvas.getBoundingClientRect = () => { reads++; return { left: 10, top: 20, right: 500, bottom: 400 }; };
  controller.updateOverlay(); assert.equal(reads, 0, "idle selection frames do not read document viewport geometry");
  for (let click = 0; click < 2; click++) { host.pointer("pointerdown", ...linkPoint); host.pointer("pointerup", ...linkPoint); }
  assert(reads > 0, "selected text refreshes the live canvas viewport");
  let replacementReads = 0;
  host.canvas = { getBoundingClientRect() { replacementReads++; return { left: 100, top: 80, right: 600, bottom: 500 }; } };
  controller.updateOverlay(); assert.equal(replacementReads, 1, "existing selection overlays follow a backend's replacement canvas");
});

// Exercise the real overlay's client-coordinate containment and drag handlers
// with a small DOM host, without a browser or a frame loop.
{
  class Element extends EventTarget {
    children = []; style = {}; textContent = ""; offsetWidth = 64; offsetHeight = 30; captures = new Set();
    appendChild(child) { child.parent = this; this.children.push(child); }
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
    contains(child) { return this === child || this.children.some(item => item.contains(child)); }
    setPointerCapture(id) { this.captures.add(id); }
    hasPointerCapture(id) { return this.captures.has(id); }
  }
  class Window extends EventTarget {
    innerWidth = 600; innerHeight = 400; listeners = new Set(); frameRequests = 0;
    addEventListener(type, listener, options = {}) {
      super.addEventListener(type, listener, options);
      const item = { type, listener }; this.listeners.add(item);
      options.signal?.addEventListener("abort", () => this.listeners.delete(item), { once: true });
    }
    requestAnimationFrame() { this.frameRequests++; throw new Error("Selection overlays must not run a frame loop."); }
  }
  const window = new Window(), document = { createElement: () => new Element(), body: new Element() };
  const originalGlobals = new Map(["window", "document", "Node"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.defineProperty(globalThis, "window", { value: window, configurable: true });
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  Object.defineProperty(globalThis, "Node", { value: Element, configurable: true });
  let overlay, legacy;
  const drags = [], copies = [], callbacks = { onHandleDragStart: (...args) => drags.push(["start", ...args]),
    onHandleDragMove: (...args) => drags.push(["move", ...args]), onHandleDragEnd: () => drags.push(["end"]),
    onCopyClick: () => copies.push("copy"), onContextMenuCopy: () => copies.push("menu copy") };
  try {
    let viewport = { left: 100, top: 60, right: 500, bottom: 350 };
    let canvas = { getBoundingClientRect: () => viewport };
    overlay = createSelectionOverlay(callbacks, () => canvas?.getBoundingClientRect() ?? null);
    const container = document.body.children[0], [start, end, copy, menu] = container.children;
    menu.offsetWidth = 120; menu.offsetHeight = 34;
    assert.match(container.style.cssText, /z-index:20;/, "text controls stay below application toolbars and sidebars");
    overlay.showHandles({ x: 90, y: 40, heightPx: 12 }, { x: 510, y: 355, heightPx: 12 });
    assert.equal(container.style.clipPath, "inset(60px 100px 50px 100px)");
    assert.deepEqual([start.style.left, start.style.top, end.style.left, end.style.top], ["68px", "40px", "510px", "355px"],
      "viewport clipping keeps selection handles in their original client coordinates");
    const emit = (element, type, values = {}) => {
      const event = new Event(type, { cancelable: true }); Object.assign(event, { pointerId: 17, clientX: 90, clientY: 40, ...values });
      element.dispatchEvent(event); return event;
    };
    assert.equal(emit(start, "pointerdown").defaultPrevented, true); assert(start.hasPointerCapture(17));
    overlay.showCopyButton(110, 70);
    assert.deepEqual([copy.style.left, copy.style.top], ["108px", "78px"], "Copy flips below and stays inside the canvas near its top edge");
    overlay.showCopyButton(490, 345);
    assert.deepEqual([copy.style.left, copy.style.top], ["428px", "307px"], "Copy stays clear of adjacent HTML at the canvas edge");
    overlay.showContextMenu(490, 340);
    assert.deepEqual([menu.style.left, menu.style.top], ["376px", "306px"], "the context menu flips and clamps to the canvas rather than the window");
    viewport = { left: 220, top: 100, right: 260, bottom: 130 }; overlay.refreshViewport();
    assert.deepEqual([copy.style.maxWidth, copy.style.maxHeight, menu.style.maxWidth, menu.style.maxHeight], ["24px", "14px", "32px", "22px"],
      "small document viewports constrain popup dimensions");
    assert.deepEqual([copy.style.left, copy.style.top, menu.style.left, menu.style.top], ["228px", "108px", "224px", "104px"]);
    assert(start.hasPointerCapture(17), "refreshing a clipped viewport retains the active handle's pointer capture");
    emit(start, "pointermove", { clientX: 40, clientY: 20 }); emit(start, "pointerup");
    assert.deepEqual(drags, [["start", "start", 17], ["move", "start", 40, 20], ["end"]], "clipped handle drags preserve their existing event contract");
    canvas = { getBoundingClientRect: () => ({ left: 20, top: 40, right: 180, bottom: 160 }) }; overlay.refreshViewport();
    assert.equal(container.style.clipPath, "inset(40px 420px 240px 20px)", "canvas replacement refreshes clipping without recreating the overlay");
    assert.deepEqual([copy.style.left, menu.style.left], ["108px", "56px"], "visible popups reclamp when the rendering canvas changes");
    canvas = { getBoundingClientRect: () => ({ left: -40, top: -50, right: 200, bottom: 250 }) }; overlay.refreshViewport();
    assert.equal(container.style.clipPath, "inset(0px 400px 150px 0px)", "canvas clipping intersects the browser viewport");
    canvas = { getBoundingClientRect: () => ({ left: 10.2, top: 20.1, right: 10.8, bottom: 20.7 }) }; overlay.refreshViewport();
    for (const element of [copy, menu]) {
      assert(Number.parseFloat(element.style.left) >= 10.2 && Number.parseFloat(element.style.top) >= 20.1, "fractional tiny viewports retain their actual client origin");
      assert(Number.parseFloat(element.style.maxWidth) <= .600000000001 && Number.parseFloat(element.style.maxHeight) <= .600000000001,
        "popup boxes stay bounded even when the visible canvas is less than a pixel wide");
    }
    assert(Number.parseFloat(copy.style.paddingLeft) * 2 <= Number.parseFloat(copy.style.maxWidth));
    assert(Number.parseFloat(copy.style.paddingTop) * 2 <= Number.parseFloat(copy.style.maxHeight));
    assert(Number.parseFloat(menu.style.padding) * 2 <= Number.parseFloat(menu.style.maxWidth), "minimum popup padding cannot defeat tiny viewport constraints");
    canvas = null; overlay.refreshViewport(); assert.equal(container.style.visibility, "hidden", "a detached canvas hides selection controls");
    canvas = { getBoundingClientRect: () => ({ left: 700, top: 10, right: 800, bottom: 100 }) }; overlay.refreshViewport();
    assert.equal(container.style.visibility, "hidden", "a fully offscreen canvas has no interactive overlay area");
    canvas = { getBoundingClientRect: () => ({ left: 100, top: 60, right: 500, bottom: 350 }) }; overlay.refreshViewport();
    assert.equal(container.style.visibility, "visible");
    emit(copy, "click"); emit(menu.children[0], "click"); assert.deepEqual(copies, ["copy", "menu copy"]);
    assert.equal(window.listeners.size, 0, "context-menu dismissal listeners still detach after copying");
    overlay.showContextMenu(150, 100);
    const escape = new Event("keydown"); Object.assign(escape, { key: "Escape" }); window.dispatchEvent(escape);
    assert.equal(menu.style.display, "none"); assert.equal(window.listeners.size, 0);
    legacy = createSelectionOverlay(callbacks);
    const defaultContainer = document.body.children[1], defaultCopy = defaultContainer.children[2];
    legacy.showCopyButton(0, 0);
    assert.equal(defaultContainer.style.clipPath, "inset(0px 0px 0px 0px)", "legacy direct consumers default to the window viewport");
    assert.deepEqual([defaultCopy.style.left, defaultCopy.style.top], ["8px", "8px"]);
    assert.equal(window.frameRequests, 0, "containment adds no animation loop");
  } finally {
    overlay?.dispose(); legacy?.dispose(); assert.equal(window.listeners.size, 0);
    for (const [name, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  }
}

console.log("text selection title-block fields, joined runs, partial/reverse drags, words, visual reading order and annotation clicks passed");
