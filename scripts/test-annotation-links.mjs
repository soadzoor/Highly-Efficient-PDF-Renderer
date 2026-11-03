import assert from "node:assert/strict";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { Group, PerspectiveCamera, Vector3 } from "three";

const hooks = registerHooks({ resolve(s, c, next) {
  return c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? next(`${s}.ts`, c) : next(s, c);
} });
const near = (actual, expected) => assert(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
class Window extends EventTarget {
  time = 0; frames = new Map(); next = 0; opened = []; reducedMotion = false;
  performance = { now: () => this.time };
  matchMedia = () => ({ matches: this.reducedMotion });
  open(...args) { this.opened.push(args); return null; }
  requestAnimationFrame(cb) { this.frames.set(++this.next, cb); return this.next; }
  cancelAnimationFrame(id) { this.frames.delete(id); }
  advance(ms) { this.time += ms; const callbacks = [...this.frames.values()]; this.frames.clear(); for (const cb of callbacks) cb(this.time); }
}

try {
  const { resolvePdfLinkUrl, resolveAnnotationUrl, resolveAnnotationView, createViewerLinkNavigation } = await import("../src/viewerLinkNavigation.ts");
  const { createThreeLinkNavigation } = await import("../src/threeLinkNavigation.ts");
  const { computeNativePdfPageGeometry } = await import("../src/pdf/nativePageGeometry.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const uri = (uri, extra = {}) => ({ action: { type: "URI", uri, ...extra } });
  assert.equal(resolveAnnotationUrl(uri("https://example.com/a?q=1#b")), "https://example.com/a?q=1#b");
  assert.equal(resolveAnnotationUrl(uri("../a", { uriBase: "https://example.com/dir/file" })), "https://example.com/a");
  assert.equal(resolveAnnotationUrl(uri("a"), "https://example.com/dir/doc.pdf"), "https://example.com/dir/a");
  assert.equal(resolveAnnotationUrl(uri("a", { uriBase: "../" }), "https://example.com/dir/doc.pdf"), "https://example.com/a");
  assert.equal(resolveAnnotationUrl(uri("https://example.com/", { uriBase: "broken" })), "https://example.com/");
  assert.equal(resolvePdfLinkUrl("mailto:reviewer@example.com?subject=PDF%20review"), "mailto:reviewer@example.com?subject=PDF%20review");
  assert.equal(resolveAnnotationUrl(uri("tel:+3615550100")), "tel:+3615550100");
  for (const url of ["javascript:alert(1)", "data:text/html,hello", "file:///tmp/file", "relative", "//example.com/"]) {
    assert.equal(resolveAnnotationUrl(uri(url)), null);
  }
  assert.equal(resolveAnnotationUrl({ action: { type: "GoToR", file: "https://example.com" } }), null);
  assert.equal(resolveAnnotationUrl({ action: { type: "JavaScript", next: [uri("https://example.com").action] } }), null);

  const page = (sourcePageIndex, rotation = 0) => {
    const { pageMatrix, pageBounds } = computeNativePdfPageGeometry({ mediaBox: [0, 0, 300, 200],
      cropBox: [10, 20, 210, 120], rotation, userUnit: 2 });
    return { ...createEmptyVectorScene(), pageCount: 1, pageRects: Float32Array.of(pageBounds.minX, pageBounds.minY, pageBounds.maxX, pageBounds.maxY),
      pageBounds, bounds: pageBounds, pageTextRanges: Uint32Array.of(0, 0),
      pdfPages: [{ pageIndex: 0, sourcePageIndex, pdfToScene: pageMatrix }], annotations: [] };
  };
  const destination = (sourcePageIndex, fit = "XYZ", parameters = [30, 40, 1]) => ({ destination: { sourcePageIndex, fit, parameters } });
  const viewport = { width: 848, height: 648 }, current = { centerX: 20, centerY: 30, zoom: 2 };
  const expected = [[40, 40], [40, 360], [360, 160], [160, 40]];
  for (const [index, rotation] of [0, 90, 180, 270].entries()) {
    const scene = page(7, rotation), view = resolveAnnotationView(scene, destination(7), current, viewport);
    near(view.centerX, expected[index][0]); near(view.centerY, expected[index][1]); near(view.zoom, 96 / 72);
    const fit = resolveAnnotationView(scene, destination(7, "Fit"), current, viewport);
    assert.equal(fit.centerX, scene.pageRects[2] / 2); assert.equal(fit.centerY, scene.pageRects[3] / 2);
    assert.deepEqual(resolveAnnotationView(scene, destination(7, "FitB"), current, viewport), fit);
  }
  const first = page(7, 90), second = page(2);
  let scene = composeVectorScenesInGrid([first, second], 2);
  const target = destination(2), view = resolveAnnotationView(scene, target, current, viewport);
  near(view.centerX, scene.pageRects[4] + 40); near(view.centerY, scene.pageRects[5] + 40);
  assert.equal(resolveAnnotationView(scene, destination(0), current, viewport), null, "source indexes are never mistaken for scene slots");
  const rectView = resolveAnnotationView(second, destination(2, "FitR", [30, 40, 80, 60]), current, viewport);
  assert.deepEqual(rectView, { centerX: 90, centerY: 60, zoom: 8 });
  const horizontal = resolveAnnotationView(second, destination(2, "FitH", [40]), current, viewport);
  assert.deepEqual(horizontal, { centerX: 200, centerY: 40, zoom: 2 });
  assert.deepEqual(resolveAnnotationView(second, destination(2, "FitBH", [40]), current, viewport), horizontal);
  const vertical = resolveAnnotationView(second, destination(2, "FitV", [30]), current, viewport);
  assert.deepEqual(vertical, { centerX: 40, centerY: 100, zoom: 3 });
  assert.deepEqual(resolveAnnotationView(second, destination(2, "FitBV", [30]), current, viewport), vertical);
  assert.deepEqual(resolveAnnotationView(second, destination(2, "XYZ", [null, null, 0]), current, viewport), current);
  for (const invalid of [destination(99), { destination: { name: "unknown" } }, destination(2, "Unknown"),
    destination(2, "FitR", [null, 0, 2, 2]), destination(2, "FitR", [2, 2, 0, 0]),
    { action: { type: "GoToR", destination: target.destination } }, { action: { type: "Named", name: "NextPage" } }]) {
    assert.equal(resolveAnnotationView(second, invalid, current, viewport), null);
  }
  assert.deepEqual(resolveAnnotationView(scene, { action: { type: "GoTo", destination: target.destination } }, current, viewport), view);
  const older = { ...second, pdfPages: undefined, annotations: [{ sourcePageIndex: 2, pageIndex: 0 }] };
  assert.deepEqual(resolveAnnotationView(older, target, current, viewport), { centerX: 200, centerY: 100, zoom: 2 },
    "older metadata fits the reliably identified page without guessing a PDF transform");

  const window = new Window();
  const canvas = { ownerDocument: { defaultView: window, baseURI: "https://viewer.example/app/" }, width: viewport.width * 2,
    getBoundingClientRect: () => viewport };
  let cameraView = { ...current }, identity = {}, changes = 0, cancelledGesture = 0;
  const navigation = createViewerLinkNavigation({ getCanvas: () => canvas, getScene: () => scene,
    getView: () => cameraView, setView: v => { cameraView = v; changes++; }, getIdentity: () => identity,
    getSourceUrl: () => "pdfs/doc.pdf", beforeNavigate: () => cancelledGesture++ });
  assert.equal(navigation.getActivationLabel(uri("/docs")), "Open link in new tab");
  assert.equal(navigation.getActivationLabel(uri("mailto:reviewer@example.com")), "Compose email");
  assert.equal(navigation.getActivationLabel(uri("tel:+3615550100")), "Call number");
  assert.equal(navigation.activate(uri("next.html")), true);
  assert.deepEqual(window.opened, [["https://viewer.example/app/pdfs/next.html", "_blank", "noopener,noreferrer"]]);
  assert.equal(changes, 0);
  assert.equal(navigation.getActivationLabel(target), "Go to destination");
  assert.equal(navigation.activate(target), true); assert.equal(cancelledGesture, 1);
  window.advance(225);
  assert(cameraView.centerX > current.centerX && cameraView.centerX < view.centerX, "the camera moves while zooming");
  assert(cameraView.zoom > 0 && cameraView.zoom < current.zoom);
  window.advance(1200);
  assert.deepEqual(cameraView, view, "the final destination is applied exactly");
  assert.equal(window.frames.size, 0);

  function sampleFlight(start, annotation, flightScene, flightViewport = viewport) {
    const flightWindow = new Window(), samples = [];
    let flightView = { ...start };
    const flightCanvas = { ownerDocument: { defaultView: flightWindow }, getBoundingClientRect: () => flightViewport };
    const flight = createViewerLinkNavigation({ getCanvas: () => flightCanvas, getScene: () => flightScene,
      getIdentity: () => flightScene, getView: () => flightView, setView: v => { flightView = v; samples.push(v); } });
    const end = resolveAnnotationView(flightScene, annotation, start, flightViewport);
    assert(flight.activate(annotation));
    flightWindow.advance(0);
    near(flightView.centerX, start.centerX); near(flightView.centerY, start.centerY); near(flightView.zoom, start.zoom);
    while (flightWindow.frames.size && flightWindow.time < 1216) flightWindow.advance(16);
    assert.equal(flightWindow.frames.size, 0, "even very distant trips finish within the duration cap");
    assert.deepEqual(flightView, end);
    for (const sample of samples) {
      assert(Object.values(sample).every(Number.isFinite) && sample.zoom > 0);
      for (const key of ["centerX", "centerY"]) {
        assert(sample[key] >= Math.min(start[key], end[key]) - 1e-7 && sample[key] <= Math.max(start[key], end[key]) + 1e-7,
          "camera travel never overshoots");
      }
    }
    flight.dispose();
    return { samples, duration: flightWindow.time, minZoom: Math.min(...samples.map(v => v.zoom)) };
  }
  const longScene = composeVectorScenesInGrid(Array.from({ length: 21 }, (_, i) => page(i)), 1);
  const longStart = resolveAnnotationView(longScene, destination(0, "Fit"), current, viewport);
  const farLink = destination(20, "Fit"), longEnd = resolveAnnotationView(longScene, farLink, longStart, viewport);
  const nearby = sampleFlight({ ...longEnd, centerX: longEnd.centerX - viewport.width * 0.1 / longEnd.zoom }, farLink, longScene);
  assert(nearby.minZoom > longEnd.zoom * 0.98 && nearby.minZoom < longEnd.zoom, "nearby links get only a subtle pullback");
  const stationary = sampleFlight(longEnd, farLink, longScene);
  assert(stationary.samples.every(v => Math.abs(v.zoom - longEnd.zoom) < 1e-7), "no zoom pulse at the current destination");
  const distant = sampleFlight(longStart, farLink, longScene);
  assert(distant.minZoom < longStart.zoom * 0.1, "a twenty-page trip pulls back to show the route");
  assert(distant.duration > nearby.duration && nearby.duration >= stationary.duration);
  const minimumIndex = distant.samples.findIndex(v => v.zoom === distant.minZoom);
  assert(minimumIndex > 0 && minimumIndex < distant.samples.length - 1, "the camera zooms out then back in");
  assert(Math.abs(distant.samples[minimumIndex].centerY - longStart.centerY) > Math.abs(longEnd.centerY - longStart.centerY) * 0.4);
  assert(Math.abs(distant.samples[minimumIndex].centerY - longEnd.centerY) > Math.abs(longEnd.centerY - longStart.centerY) * 0.4);
  for (let i = 1; i < distant.samples.length; i++) {
    assert(i <= minimumIndex ? distant.samples[i].zoom <= distant.samples[i - 1].zoom : distant.samples[i].zoom >= distant.samples[i - 1].zoom);
  }
  const reverse = sampleFlight(longEnd, destination(0, "Fit"), longScene);
  near(reverse.minZoom, distant.minZoom); assert.equal(reverse.duration, distant.duration);
  const extreme = sampleFlight({ ...longEnd, centerX: longEnd.centerX - 1e9 }, farLink, longScene);
  assert(extreme.minZoom >= longEnd.zoom / 32 - 1e-7, "pullback is bounded even for extreme distances");

  // A different destination zoom is still honored, including zoom-only links.
  sampleFlight({ ...longStart, zoom: longStart.zoom * 4 }, farLink, longScene);
  const zoomOnly = sampleFlight({ ...longEnd, zoom: longEnd.zoom / 4 }, farLink, longScene);
  for (let i = 1; i < zoomOnly.samples.length; i++) assert(zoomOnly.samples[i].zoom >= zoomOnly.samples[i - 1].zoom);

  // Scaling the CSS viewport and endpoint zooms equally preserves perceived travel.
  const pointLink = destination(20, "XYZ", [30, 40, 1]);
  const normal = sampleFlight(longStart, pointLink, longScene);
  const scaled = sampleFlight({ ...longStart, zoom: longStart.zoom * 2 }, destination(20, "XYZ", [30, 40, 2]), longScene,
    { width: viewport.width * 2, height: viewport.height * 2 });
  assert.equal(scaled.duration, normal.duration);
  for (let i = 0; i < normal.samples.length; i++) {
    near(scaled.samples[i].centerX, normal.samples[i].centerX);
    near(scaled.samples[i].centerY, normal.samples[i].centerY);
    near(scaled.samples[i].zoom, normal.samples[i].zoom * 2);
  }
  function event(type, target = canvas, extra = {}) {
    const e = new Event(type); Object.defineProperty(e, "target", { value: target }); Object.assign(e, extra); window.dispatchEvent(e);
  }
  for (const type of ["pointerdown", "wheel", "keydown", "blur"]) {
    navigation.activate(target); const count = changes; event(type, canvas, { key: "Escape" }); window.advance(500);
    assert.equal(changes, count, `${type} cancels navigation`);
  }
  navigation.activate(target); let outsideCount = changes; event("pointerdown", {}); window.advance(500);
  assert.equal(changes, outsideCount, "other viewer controls also interrupt a camera jump");
  navigation.activate(target); scene = { ...scene }; let count = changes; window.advance(500);
  assert.equal(changes, count, "document changes cancel navigation");
  navigation.activate(target); identity = {}; window.advance(500);
  assert.equal(changes, count, "backend changes cancel navigation");
  navigation.activate(target); navigation.activate(destination(7, "Fit")); window.advance(1200);
  const replaced = resolveAnnotationView(scene, destination(7, "Fit"), cameraView, viewport);
  assert.deepEqual(cameraView, replaced);
  navigation.activate(target); window.advance(100);
  const interrupted = { ...cameraView };
  navigation.activate(destination(7, "Fit")); window.advance(0);
  near(cameraView.centerX, interrupted.centerX); near(cameraView.centerY, interrupted.centerY); near(cameraView.zoom, interrupted.zoom);
  window.advance(1200); assert.deepEqual(cameraView, replaced, "a replacement flight starts at the current view without a jump");
  window.reducedMotion = true; navigation.activate(target); assert.equal(window.frames.size, 0); near(cameraView.centerX, view.centerX);
  window.reducedMotion = false; navigation.activate(target); count = changes;
  navigation.dispose(); window.advance(500); assert.equal(changes, count, "disposal cancels scheduled frames");
  assert.equal(navigation.activate(target), false);
  assert.equal(navigation.getActivationLabel(target), null);

  // Execute the native viewer's real adapter with a 2x backing store (no renderer or browser needed).
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const binding = main.match(/^const linkNavigation = createViewerLinkNavigation\(\{[\s\S]*?^\}\);/m);
  assert(binding);
  let nativeView = { cameraCenterX: 0, cameraCenterY: 0, zoom: 4 };
  const context = vm.createContext({ createViewerLinkNavigation, canvasElement: canvas, lastParsedScene: scene,
    renderer: { getViewState: () => nativeView, setViewState: v => { nativeView = v; } },
    navigateNativeView: value => { nativeView = value; }, readerViewport: null,
    lastDownloadablePdf: undefined, canvasInteractionController: { cancelActiveGesture() {} }, target });
  window.reducedMotion = true;
  vm.runInContext(stripTypeScriptTypes(binding[0]), context);
  vm.runInContext("linkNavigation.activate(target)", context);
  near(nativeView.cameraCenterX, view.centerX); near(nativeView.cameraCenterY, view.centerY); near(nativeView.zoom, view.zoom * 2);
  vm.runInContext("linkNavigation.dispose()", context);

  // Three adapter preserves the camera direction and moves into the transformed PDF plane.
  const object = new Group(); object.sceneData = second; object.position.set(10, -5, 3); object.scale.setScalar(0.01); object.rotation.z = 0.3;
  const camera = new PerspectiveCamera(60, viewport.width / viewport.height, 0.001, 2000);
  camera.position.set(10, -5, 13);
  const controls = { target: new Vector3(10, -5, 3), minDistance: 0, maxDistance: Infinity,
    update() { camera.lookAt(this.target); camera.updateMatrixWorld(); } };
  controls.update(); let renders = 0;
  const threeNavigation = createThreeLinkNavigation({ getCanvas: () => canvas, getPdfObject: () => object, camera,
    getControls: () => controls, onCameraChange: () => renders++ });
  assert(threeNavigation.activate(target)); assert.equal(renders, 1);
  const worldTarget = object.localToWorld(new Vector3(40 - 200, 40 - 100, 0));
  near(controls.target.distanceTo(worldTarget), 0);
  near(camera.position.clone().sub(controls.target).normalize().distanceTo(new Vector3(0, 0, 1)), 0);
  near(camera.position.distanceTo(controls.target), viewport.height * 0.01 / (2 * Math.tan(Math.PI / 6)) / (96 / 72));
  threeNavigation.dispose();
  console.log("Annotation links: URL policy, destination geometry, legacy metadata, distance-aware zoom flights, cancellation, native DPR and Three camera transforms passed.");
} finally { hooks.deregister(); }
