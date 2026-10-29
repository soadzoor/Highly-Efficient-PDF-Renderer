import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import * as THREE from "three";
import { sourceFunction } from "./lib/sourceFunction.mjs";

const [source, html, css] = await Promise.all([
  readFile(new URL("../src/room-overlay-demo.ts", import.meta.url), "utf8"),
  readFile(new URL("../room-overlay-demo.html", import.meta.url), "utf8"),
  readFile(new URL("../src/viewerWorkspace.css", import.meta.url), "utf8")
]);
const close = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} vs ${expected}`);
assert.match(source, /import\s+["']\.\/viewerWorkspace\.css["']/);
assert.match(html, /<div class="viewer-workspace viewer-workspace-root">\s*<div class="viewer-document">\s*<canvas id="viewport"><\/canvas>\s*<div id="room-label-layer"[^>]*><\/div>\s*<\/div>\s*<div id="panel" class="viewer-settings">/,
  "canvas and label layer share the document column while Settings is its sibling");
for (const selector of ["#room-label-layer", ".room-label-pill"]) {
  const rule = html.match(new RegExp(`${selector.replace(/[.#]/g, "\\$&")}\\s*\\{([^}]+)\\}`))[1];
  assert.match(rule, /position:\s*absolute/, `${selector} uses document-relative placement`);
  if (selector === "#room-label-layer") assert.match(rule, /overflow:\s*(?:hidden|clip)/, "room labels cannot paint over Settings");
}
assert.match(css.match(/\.viewer-document\s*\{([^}]+)\}/)[1], /overflow:\s*hidden/, "document paint is clipped separately from Settings");
assert.match(css.match(/\.viewer-workspace\s*\{([^}]+)\}/)[1], /display:\s*flex/, "Settings consumes a separate layout column");
assert.match(css.match(/\.viewer-workspace\s*>\s*#panel\.viewer-settings\s*\{([^}]+)\}/)[1], /position:\s*relative/, "Settings is docked rather than covering document pixels");

const size = { width: 920, height: 700, left: 150, top: 90 }, drawing = { width: 1, height: 1, ratio: 1 };
const canvas = { get clientWidth() { return size.width; }, get clientHeight() { return size.height; },
  getBoundingClientRect: () => ({ left: size.left, top: size.top, width: size.width, height: size.height }) };
const renderer = { setPixelRatio(value) { drawing.ratio = value; }, setSize(width, height, updateStyle) {
  assert.equal(updateStyle, false, "drawing-buffer sizing preserves the CSS document column");
  drawing.width = Math.floor(width * drawing.ratio); drawing.height = Math.floor(height * drawing.ratio);
}, getDrawingBufferSize: target => target.set(drawing.width, drawing.height) };
const camera = new THREE.PerspectiveCamera(45, 1, .01, 2000), scene = new THREE.Scene();
camera.position.set(20, -30, 400);
const controls = { target: new THREE.Vector3(5, 8, 0), update() { camera.lookAt(this.target); camera.updateMatrixWorld(true); } }; controls.update();
let labelUpdates = 0, renderRequests = 0;
const observers = [];
const context = vm.createContext({ THREE, canvas, renderer, camera, scene, controls,
  window: { innerWidth: 1280, innerHeight: 900, devicePixelRatio: 2 },
  currentContentCenter: new THREE.Vector3(), currentContentRadius: 50, tempClipDelta: new THREE.Vector3(),
  tempObjectBounds: new THREE.Box3(), tempObjectSize: new THREE.Vector3(), tempObjectCenter: new THREE.Vector3(), tempViewDirection: new THREE.Vector3(),
  updateRoomDomLabels: () => labelUpdates++, requestRender: () => renderRequests++, isDisposed: false,
  ResizeObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe(target) { this.target = target; } }
});
for (const name of ["CAMERA_FIT_PADDING_PIXELS", "CAMERA_CLIP_NEAR_MIN", "CAMERA_CLIP_MARGIN_MULTIPLIER", "MIN_OBJECT_EXTENT"]) {
  vm.runInContext(source.match(new RegExp(`^const ${name} = [^;]+;`, "m"))[0], context);
}
for (const name of ["resolveCanvasAspect", "resolveRendererViewportPixels", "updateCameraClipping", "resizeRenderer", "fitCameraToObject"]) {
  vm.runInContext(sourceFunction(source, name), context);
}
const position = camera.position.clone(), direction = camera.getWorldDirection(new THREE.Vector3()), target = controls.target.clone();
for (const [width, height] of [[920, 700], [1280, 700], [320, 480]]) {
  size.width = width; size.height = height; context.resizeRenderer();
  assert.deepEqual([drawing.width, drawing.height], [width * 2, height * 2], "DPR 2 drawing buffers follow the actual document area");
  close(camera.aspect, width / height, "perspective aspect follows docked or expanded document width");
  assert(camera.position.equals(position)); assert(controls.target.equals(target));
  close(camera.getWorldDirection(new THREE.Vector3()).distanceTo(direction), 0, "resizing preserves the camera direction");
}
assert.equal(labelUpdates, 3, "resizing also refreshes label placement");
const observerSource = source.match(/const canvasResizeObserver = new ResizeObserver\(\(\) => \{[\s\S]*?\n\}\);\ncanvasResizeObserver\.observe\(canvas\);/);
assert(observerSource, "document-size changes observe the real canvas"); vm.runInContext(stripTypeScriptTypes(observerSource[0]), context);
assert.equal(observers[0].target, canvas);
size.width = 700; observers[0].callback(); assert.equal(drawing.width, 1400); assert.equal(renderRequests, 1);
context.isDisposed = true; size.width = 900; observers[0].callback(); assert.equal(drawing.width, 1400, "disposed resize observers perform no renderer work"); context.isDisposed = false;

const geometry = new THREE.PlaneGeometry(1200, 280), material = new THREE.MeshBasicMaterial(), object = new THREE.Mesh(geometry, material);
object.position.set(37, -25, 0); scene.add(object);
let fullDistance;
for (const width of [1200, 600]) {
  size.width = width; size.height = 720; context.resizeRenderer();
  camera.position.set(37, -25, 400); controls.target.copy(object.position); controls.update(); context.fitCameraToObject(object);
  assert(controls.target.equals(object.position), "fitting centers the actual document object");
  const corners = [new THREE.Vector3(-600, -140, 0), new THREE.Vector3(600, 140, 0)].map(point => object.localToWorld(point).project(camera));
  close((corners[0].x * .5 + .5) * width, 32, "fitting retains 64 drawing-buffer pixels of left padding at DPR 2");
  close((1 - (corners[1].x * .5 + .5)) * width, 32, "fitting retains right padding within the reduced document canvas");
  const distance = camera.position.distanceTo(controls.target);
  if (width === 1200) fullDistance = distance; else assert(distance > fullDistance, "docked Settings makes fitting use the narrower document area");
}
camera.position.set(80, -140, 300); controls.target.set(-20, 10, 0); controls.update();
const fitDirection = camera.position.clone().sub(controls.target).normalize(); context.fitCameraToObject(object);
close(camera.position.clone().sub(controls.target).normalize().distanceTo(fitDirection), 0, "fitting preserves an existing viewing direction");

size.width = 800; size.height = 600; size.left = 170; size.top = 110;
let layer = { left: 150, top: 95 };
Object.assign(context, { roomLabelLayer: { getBoundingClientRect: () => layer }, tempRoomLabelWorldPosition: new THREE.Vector3(),
  showRoomLabelsCheckbox: { checked: true }, showRoomNumbersCheckbox: { checked: true } });
const pdfObject = new THREE.Group(); pdfObject.position.set(10, 20, 0); pdfObject.rotation.z = .2; pdfObject.scale.set(1.3, .8, 1); pdfObject.updateMatrixWorld(true);
camera.position.set(0, 0, 100); controls.target.set(0, 0, 0); controls.update(); context.currentContentRadius = 10; context.currentContentCenter.set(0, 0, 0);
context.currentRoomOverlay = null; context.currentPdfObject = pdfObject;
vm.runInContext(sourceFunction(source, "updateRoomDomLabels"), context); context.resizeRenderer();
const halfHeight = 100 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), halfWidth = halfHeight * camera.aspect;
const label = (x, y, z = 0) => ({ anchor: pdfObject.worldToLocal(new THREE.Vector3(x, y, z)), element: { style: {} }, hasRoomNumber: true, hasNonNumberLines: true });
const center = label(0, 0), upperLeft = label(-halfWidth, halfHeight), lowerRight = label(halfWidth, -halfHeight);
const outside = label(halfWidth * 1.3, 0), behind = label(0, 0, 110), invalid = label(NaN, 0);
const textOnly = { ...label(0, 0), hasRoomNumber: false }, numberOnly = { ...label(0, 0), hasNonNumberLines: false };
context.currentRoomOverlay = { labelElements: [center, upperLeft, lowerRight, outside, behind, invalid, textOnly, numberOnly] }; context.updateRoomDomLabels();
function translated(element) { const match = /^translate3d\(([^p]+)px, ([^p]+)px, 0\) translate\(-50%, -50%\)$/.exec(element.style.transform); assert(match); return match.slice(1).map(Number); }
for (const [item, expected] of [[center, [420, 315]], [upperLeft, [20, 15]], [lowerRight, [820, 615]]]) {
  assert.equal(item.element.style.display, ""); translated(item.element).forEach((value, index) => close(value, expected[index], "labels project into their local layer from the current canvas rectangle"));
}
for (const item of [outside, behind, invalid]) assert.equal(item.element.style.display, "none", "offscreen, behind-camera and invalid label anchors remain hidden");
context.showRoomLabelsCheckbox.checked = false; context.updateRoomDomLabels();
assert.equal(textOnly.element.style.display, "none"); assert.equal(numberOnly.element.style.display, "", "number visibility remains independent of room text");
context.showRoomNumbersCheckbox.checked = false; context.updateRoomDomLabels(); assert.equal(center.element.style.display, "none");
context.showRoomLabelsCheckbox.checked = context.showRoomNumbersCheckbox.checked = true;
size.width = 600; size.height = 500; size.left = 250; size.top = 140; layer = { left: 230, top: 130 }; context.resizeRenderer();
translated(center.element).forEach((value, index) => close(value, [320, 260][index], "resizing Settings refreshes label position using the latest canvas and layer origins"));
geometry.dispose(); material.dispose();
console.log("Room overlay viewport: docked document sizing, DPR/aspect/observer lifecycle, camera fitting, local label projection and containment passed.");
