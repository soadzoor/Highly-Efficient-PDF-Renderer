import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });

class Element extends EventTarget {
  children = []; attributes = new Map(); dataset = {}; style = {}; className = ""; textContent = "";
  value = ""; checked = false; width = 720; height = 240; captures = new Set(); htmlWrites = [];
  constructor(tagName) {
    super(); this.tagName = tagName.toUpperCase();
    this.classList = { add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(" "); } };
    this.context = Object.fromEntries(["clearRect", "beginPath", "moveTo", "lineTo", "quadraticCurveTo", "arc", "stroke", "fill"].map(name =>
      [name, (...args) => { this.commands.push([name, ...args]); }]));
    this.commands = [];
  }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "class") this.className = value;
    if (name === "value") this.value = value;
    if (name === "checked") this.checked = true;
    if (name === "width" || name === "height") this[name] = Number(value);
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
  }
  matches(selector) {
    return selector.startsWith(".") ? this.className.split(/\s+/).includes(selector.slice(1))
      : selector.startsWith("[") ? this.attributes.has(selector.slice(1, -1)) : this.tagName === selector.toUpperCase();
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  // Only the static dialog markup is parsed. User names must reach textContent.
  set innerHTML(value) {
    this.htmlWrites.push(value); this.replaceChildren(); const stack = [this];
    for (const match of value.matchAll(/<\/?([\w-]+)([^>]*)>|([^<]+)/g)) {
      if (match[3]) { stack.at(-1).textContent += match[3]; continue; }
      if (match[0].startsWith("</")) { stack.pop(); continue; }
      const child = new Element(match[1]);
      for (const attribute of match[2].matchAll(/([\w-]+)(?:="([^"]*)"|='([^']*)'|=([^\s>]+))?/g)) {
        child.setAttribute(attribute[1], attribute[2] ?? attribute[3] ?? attribute[4] ?? "");
      }
      stack.at(-1).append(child);
      if (!["INPUT", "BR", "IMG"].includes(child.tagName)) stack.push(child);
    }
  }
  click() {
    const event = new Event("click", { bubbles: true }); Object.defineProperty(event, "target", { value: this });
    for (let node = this; node; node = node.parentElement) node.dispatchEvent(event);
  }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event("close")); }
  remove() { this.removed = true; if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
  getContext(kind) { assert.equal(kind, "2d"); return this.context; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 720, height: 240 }; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); this.dispatchEvent(pointer("lostpointercapture", 0, 0, { pointerId: id })); }
}

const key = "hepr.signatures.v1";
const signature = { id: "legacy", name: "<img src=x onerror=alert(1)>", paths: [[0, 8, 15, 0, 30, 12], [5, 16, 25, 16]], width: 30, height: 16 };
const rawPoints = Array.from({ length: 41 }, (_, index) => [40 + index * 6, 50 + 80 * (index / 40) * (1 - index / 40)]);
const pointer = (type, x, y, extra = {}) => Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, button: 0, clientX: x, clientY: y, ...extra });
const send = (canvas, type, point, extra) => canvas.dispatchEvent(pointer(type, ...point, extra));
const storage = (items = []) => ({ raw: JSON.stringify(items), writes: 0,
  getItem(name) { assert.equal(name, key); return this.raw; },
  setItem(name, value) { assert.equal(name, key); this.writes++; if (this.fail) throw this.fail; this.raw = value; }
});
const documentWith = store => ({ body: new Element("body"), defaultView: { localStorage: store },
  createElement: tag => new Element(tag), createElementNS(namespace, tag) { assert.equal(namespace, "http://www.w3.org/2000/svg"); return new Element(tag); }
});
const action = (dialog, name) => dialog.querySelectorAll("[data-signature-action]").find(button => button.dataset.signatureAction === name).click();
const frame = canvas => canvas.commands.slice(canvas.commands.findLastIndex(command => command[0] === "clearRect") + 1);
const draw = (canvas, points) => {
  send(canvas, "pointerdown", points[0]);
  for (const point of points.slice(1, -1)) send(canvas, "pointermove", point, { getCoalescedEvents: () => [] });
  send(canvas, "pointerup", points.at(-1));
};

try {
  const { createEditorSignaturePreview, showSignatureDialog } = await import("../src/editorSignatureUi.ts");
  const { normalizeEditorSignature, validateEditorSignature, createEditorSignatureLibrary } = await import("../src/editorSignatures.ts");
  const { fitEditorInkPaths, editorInkPathData } = await import("../src/editorInkGeometry.ts");
  const { appendEditorInkSamples, editorInkCaptureTolerance } = await import("../src/editorInkCapture.ts");

  const capture = [[0, 0]], project = event => [event.clientX, event.clientY];
  appendEditorInkSamples(capture, pointer("pointermove", 1, 2, { getCoalescedEvents: () => [] }), project);
  appendEditorInkSamples(capture, pointer("pointermove", 5, 6, { getCoalescedEvents: () => [pointer("pointermove", 2, 3), pointer("pointermove", 4, 5)] }), project);
  appendEditorInkSamples(capture, pointer("pointerup", 7, 8), project);
  appendEditorInkSamples(capture, pointer("pointerup", 7, 8), project);
  appendEditorInkSamples(capture, pointer("pointermove", NaN, 3), project);
  appendEditorInkSamples(capture, pointer("pointermove", 9, 9), () => null);
  assert.deepEqual(capture, [[0, 0], [1, 2], [2, 3], [4, 5], [5, 6], [7, 8]], "empty coalesced batches and final dispatched samples remain in order without duplicates");
  const origin = { x: 20, y: 30 }, identity = point => point;
  const budget = editorInkCaptureTolerance(origin, identity);
  assert(Math.abs(budget - .35 / Math.SQRT2) < 1e-12);
  assert(Math.abs(editorInkCaptureTolerance(origin, point => ({ x: point.x * 4 + 100, y: point.y * 4 - 50 })) * 4 - budget) < 1e-12, "capture error follows zoom in document coordinates");
  const skew = point => ({ x: 2 * point.x + 1.5 * point.y + 70, y: .5 * point.x - 3 * point.y - 20 });
  const skewBudget = editorInkCaptureTolerance(origin, skew), projectedOrigin = skew(origin);
  for (let angle = 0; angle < Math.PI * 2; angle += .1) {
    const projected = skew({ x: origin.x + Math.cos(angle) * skewBudget, y: origin.y + Math.sin(angle) * skewBudget });
    assert(Math.hypot(projected.x - projectedOrigin.x, projected.y - projectedOrigin.y) <= .35 + 1e-12, "skewed projection stays within the screen-space fitting budget");
  }
  for (const projection of [() => null, () => ({ x: 0, y: 0 }), () => ({ x: Infinity, y: 0 }), point => ({ x: point.x * Number.MIN_VALUE, y: point.y * Number.MIN_VALUE })]) assert.equal(editorInkCaptureTolerance(origin, projection), 0);

  assert.throws(() => normalizeEditorSignature(rawPoints.flat(), "Capture", "invalid"), /signature path/i);
  const normalized = normalizeEditorSignature([rawPoints.flat()], "  Capture  ", "new", .35);
  assert.equal(normalized.name, "Capture"); assert.equal(normalized.smoothing, .35);
  assert.deepEqual(normalized.paths[0], rawPoints.flat().map((coordinate, index) => coordinate - (index % 2 ? 50 : 40)), "normalization retains every original sample");
  assert.equal(normalizeEditorSignature(signature.paths, "Legacy", "legacy").smoothing, undefined, "legacy API calls retain their original polyline semantics");
  for (const invalid of [-1, Infinity, NaN, "0.3"]) {
    assert.equal(validateEditorSignature({ ...signature, smoothing: invalid }), false);
    assert.throws(() => normalizeEditorSignature(signature.paths, "Invalid", "invalid", invalid), /smoothing/);
  }
  assert.equal(validateEditorSignature({ ...signature, smoothing: 0 }), true);

  const preview = createEditorSignaturePreview(documentWith(storage()), normalized), previewPath = preview.children[0];
  assert.equal(preview.tagName, "SVG"); assert.equal(preview.attributes.get("preserveAspectRatio"), "xMidYMid meet");
  assert.equal(preview.attributes.get("aria-hidden"), "true"); assert.equal(preview.attributes.get("focusable"), "false");
  assert.equal(previewPath.attributes.get("d"), editorInkPathData(fitEditorInkPaths([normalized.paths[0].reduce((points, _, index, values) => index % 2 ? points : [...points, [values[index], values[index + 1]]], [])], .35)), "library previews use the same canonical vectors as committed ink");
  assert.match(previewPath.attributes.get("d"), /Q/); assert.doesNotMatch(previewPath.attributes.get("d"), /NaN|Infinity/);
  for (const [attribute, value] of [["fill", "none"], ["stroke", "currentColor"], ["stroke-linecap", "round"], ["stroke-linejoin", "round"], ["vector-effect", "non-scaling-stroke"]]) assert.equal(previewPath.attributes.get(attribute), value);
  const box = preview.attributes.get("viewBox").split(" ").map(Number);
  assert(box.every(Number.isFinite) && box[2] > 0 && box[3] > 0, "preview viewBox pads the vector's nonzero aspect-preserving bounds");

  const legacyStore = storage([signature]); legacyStore.raw = JSON.stringify([signature], null, 2);
  const originalRaw = legacyStore.raw, document = documentWith(legacyStore), chosen = [], errors = [];
  showSignatureDialog(document, item => chosen.push(item), error => errors.push(error));
  const dialog = document.body.children[0], library = dialog.querySelector(".hepr-editor-signature-library"), card = library.children[0];
  assert.equal(dialog.open, true); assert.equal(card.className, "hepr-editor-signature-card");
  const choose = card.children[0], remove = card.children[1];
  assert.equal(choose.children[0].tagName, "SVG"); assert.equal(choose.children[1].textContent, signature.name);
  assert.equal(choose.attributes.get("aria-label"), `Use signature ${signature.name}`);
  assert.equal(remove.textContent, "Delete"); assert.equal(remove.attributes.get("aria-label"), `Delete ${signature.name}`);
  assert.equal(choose.querySelectorAll("img").length, 0); assert.equal(choose.htmlWrites.length, 0, "saved names are rendered as text rather than injected HTML");
  assert.equal(legacyStore.raw, originalRaw); assert.equal(legacyStore.writes, 0, "listing legacy signatures never rewrites browser storage");
  choose.children[0].click(); assert.deepEqual(chosen, [signature], "clicking the vector preview chooses its signature");
  assert.equal(dialog.removed, true); assert.equal(legacyStore.raw, originalRaw); assert.equal(legacyStore.writes, 0); assert.deepEqual(errors, []);
  const deleteDocument = documentWith(legacyStore);
  showSignatureDialog(deleteDocument, () => assert.fail("Delete must not choose a signature"), error => assert.fail(String(error)));
  deleteDocument.body.children[0].querySelector(".hepr-editor-signature-remove").click();
  assert.deepEqual(JSON.parse(legacyStore.raw), []); assert.equal(legacyStore.writes, 1);
  assert.equal(deleteDocument.body.children[0].querySelector(".hepr-editor-signature-empty").textContent, "No saved signatures yet. Draw one below.");

  const captureDocument = documentWith(storage()), captures = [];
  showSignatureDialog(captureDocument, item => captures.push(item), error => assert.fail(String(error)));
  const captureDialog = captureDocument.body.children[0], canvas = captureDialog.querySelector("canvas"), smoothing = captureDialog.querySelector("[data-signature-smooth]");
  assert.equal(smoothing.checked, true);
  send(canvas, "pointerdown", [10, 20]);
  send(canvas, "pointermove", [35, 40], { getCoalescedEvents: () => [pointer("pointermove", 20, 25)] });
  send(canvas, "pointerup", [50, 60]);
  send(canvas, "pointerdown", [100, 100]); send(canvas, "pointermove", [120, 110]); send(canvas, "pointercancel", [120, 110]);
  send(canvas, "pointerdown", [60, 50]); send(canvas, "pointercancel", [60, 50], { pointerId: 2 });
  send(canvas, "lostpointercapture", [60, 50], { pointerId: 2 }); send(canvas, "pointerup", [80, 55]);
  send(canvas, "pointerdown", [200, 80]); send(canvas, "pointerup", [200, 80]);
  action(captureDialog, "use");
  assert.deepEqual(captures[0].paths, [[0, 0, 10, 5, 25, 20, 40, 40], [50, 30, 70, 35], [190, 60, 190, 60]], "pointerup includes the final sample, cancellation discards only matching active ink, and taps remain dots");
  assert.equal(captures[0].smoothing, .35);

  const toggledDocument = documentWith(storage()), toggled = [];
  showSignatureDialog(toggledDocument, item => toggled.push(item), error => assert.fail(String(error)));
  const toggledDialog = toggledDocument.body.children[0], toggledCanvas = toggledDialog.querySelector("canvas"), toggle = toggledDialog.querySelector("[data-signature-smooth]");
  draw(toggledCanvas, rawPoints); const initialFrame = frame(toggledCanvas);
  assert(initialFrame.some(command => command[0] === "quadraticCurveTo"), "completed handwriting previews its fitted curves");
  for (let iteration = 0; iteration < 3; iteration++) {
    toggle.checked = false; toggle.dispatchEvent(new Event("change"));
    assert(!frame(toggledCanvas).some(command => command[0] === "quadraticCurveTo"), "turning smoothing off previews the raw captured polyline");
    toggle.checked = true; toggle.dispatchEvent(new Event("change"));
    assert.deepEqual(frame(toggledCanvas), initialFrame, "repeated smoothing toggles derive from original capture without drift");
  }
  toggle.checked = false; toggle.dispatchEvent(new Event("change")); action(toggledDialog, "use");
  assert.equal(toggled[0].smoothing, undefined); assert.deepEqual(toggled[0].paths, normalized.paths, "raw samples survive both smoothing states");

  const quotaStore = storage([signature]), quotaRaw = quotaStore.raw, quota = new DOMException("Storage full", "QuotaExceededError"); quotaStore.fail = quota;
  const quotaDocument = documentWith(quotaStore), quotaChosen = [], quotaErrors = [];
  showSignatureDialog(quotaDocument, item => quotaChosen.push(item), error => quotaErrors.push(error));
  const quotaDialog = quotaDocument.body.children[0]; draw(quotaDialog.querySelector("canvas"), [[12, 20], [40, 50]]);
  action(quotaDialog, "save"); assert.equal(quotaDialog.open, true); assert.deepEqual(quotaChosen, []); assert.deepEqual(quotaErrors, [quota]);
  assert.match(quotaDialog.querySelector("[data-signature-status]").textContent, /Storage full/);
  assert.equal(quotaStore.raw, quotaRaw, "failed storage writes preserve the saved library");
  action(quotaDialog, "use"); assert.equal(quotaChosen.length, 1); assert.deepEqual(quotaChosen[0].paths, [[0, 0, 28, 30]], "quota failure preserves active handwriting for Use without saving");
  assert.equal(quotaStore.raw, quotaRaw);
  const validationLibrary = createEditorSignatureLibrary(storage([signature]));
  assert.throws(() => validationLibrary.save({ ...signature, smoothing: -1 }), /Invalid handwritten signature/);
  const invalidStore = storage([{ ...signature, smoothing: -1 }]), invalidRaw = invalidStore.raw;
  assert.throws(() => createEditorSignatureLibrary(invalidStore).list(), /Saved signatures could not be read/);
  assert.equal(invalidStore.raw, invalidRaw); assert.equal(invalidStore.writes, 0, "invalid stored metadata is reported without overwriting the user's library");
  const deniedDocument = documentWith(null), deniedChosen = [], deniedErrors = [];
  Object.defineProperty(deniedDocument.defaultView, "localStorage", { get() { throw new DOMException("Storage blocked", "SecurityError"); } });
  showSignatureDialog(deniedDocument, item => deniedChosen.push(item), error => deniedErrors.push(error));
  const deniedDialog = deniedDocument.body.children[0];
  assert.match(deniedDialog.querySelector("[data-signature-status]").textContent, /Storage blocked/);
  draw(deniedDialog.querySelector("canvas"), [[20, 20], [60, 50]]); action(deniedDialog, "save");
  assert.equal(deniedDialog.open, true); assert.equal(deniedChosen.length, 0); assert.equal(deniedErrors.length, 1);
  action(deniedDialog, "use"); assert.deepEqual(deniedChosen[0].paths, [[0, 0, 40, 30]], "browser storage denial still allows placing the active signature");
  console.log("Editor signature previews, storage and ink capture tests passed.");
} finally { hooks.deregister(); }
