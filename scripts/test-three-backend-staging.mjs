import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as THREE from "three";
import { sourceFunction } from "./lib/sourceFunction.mjs";

const source = await readFile(new URL("../src/three-example.ts", import.meta.url), "utf8");
const noop = () => {};

for (const outcome of ["ready", "cancelled", "failed"]) {
  const events = [];
  const controller = new AbortController();
  let finishInitialization;
  let rejectInitialization;
  const initialization = new Promise((resolve, reject) => {
    finishInitialization = resolve;
    rejectInitialization = reject;
  });
  let nextRenderer;
  let monitoredRenderers = 0;
  const previousCanvas = {
    width: 1600, height: 1200, clientWidth: 800, clientHeight: 600,
    cloneNode: () => ({ width: 0, height: 0, classList: { remove: noop } }),
    replaceWith: () => events.push("canvas installed")
  };
  const previousRenderer = { dispose: () => events.push("previous renderer disposed") };
  const previousTarget = { clone: () => ({}) };
  const host = vm.createContext({
    THREE: { UnsignedByteType: 1009, LinearSRGBColorSpace: "srgb-linear" },
    WebGPURenderer: class {
      constructor(options) {
        this.domElement = options.canvas;
        this.coordinateSystem = 2001;
        this._initialized = false;
        this.backend = { device: { destroy: () => events.push("next device destroyed") } };
        nextRenderer = this;
      }
      async init() { await initialization; this._initialized = true; }
      dispose() {
        assert.equal(this._initialized, true, "Disposing an uninitialized r186 renderer retries its rejected init promise");
        events.push("next renderer disposed");
      }
    },
    configureThreeRenderer: (target) => {
      target.viewport = [previousCanvas.clientWidth, previousCanvas.clientHeight];
    },
    loadDiagnostics: { monitorRenderer: (target, canvas) => {
      assert.equal(target, nextRenderer);
      assert.equal(canvas, target.domElement);
      assert.equal(target._initialized, true, "Monitor a replacement only after its device is initialized");
      monitoredRenderers++;
    } },
    stopThreeInternalAnimationLoop: () => events.push("internal animation stopped"),
    activeThreeRendererBackend: "webgl", canvasElement: previousCanvas,
    renderer: previousRenderer, controls: { target: previousTarget, dispose: () => events.push("controls disposed") },
    animationFrameId: 4, cancelAnimationFrame: () => events.push("frame cancelled"), needsRender: true,
    disposeCurrentObject: () => assert.fail("Preparing a renderer must not dispose the current document"),
    canvasResizeObserver: { disconnect: noop, observe: noop },
    resetFpsMeter: noop, captureGlCalls: null, captureProfiler: null, drawCallMeter: { reset: noop },
    createMapControls: () => ({ target: { copy: noop, clone: () => ({}) }, dispose: noop }),
    controlsConnected: true, syncPageCameraControls: noop, reader: { canvasChanged: noop },
    camera: { coordinateSystem: 2000 },
    updatePerspectiveCameraProjection: () => assert.equal(host.camera.coordinateSystem, host.renderer.coordinateSystem, "Rebuild the camera projection with the replacement renderer's clip convention"),
    updateCameraClipping: noop,
    drawingSelection: { rendererChanged: noop }, annotationInteraction: { refresh: noop },
    requestRender: () => assert.fail("Installing the renderer must remain synchronous with installing its document")
  });
  for (const name of ["createReplacementViewportCanvas", "createWebGpuThreeRenderer", "prepareThreeRendererBackend", "installThreeRendererBackend"]) {
    vm.runInContext(sourceFunction(source, name), host);
  }

  assert.equal(await host.prepareThreeRendererBackend("webgl", controller.signal), null);
  assert.equal(nextRenderer, undefined, "Keep the current context when its backend already matches");
  const preparing = host.prepareThreeRendererBackend("webgpu", controller.signal);
  assert.equal(host.canvasElement, previousCanvas, "Show the old canvas while device initialization is pending");
  assert.equal(host.renderer, previousRenderer);
  assert.equal(host.animationFrameId, 4, "The old renderer can keep servicing interaction frames");
  assert.deepEqual(events, []);
  assert.deepEqual(nextRenderer.viewport, [800, 600], "Detached contexts use the displayed viewport dimensions");

  if (outcome === "cancelled") controller.abort(new Error("Superseded switch"));
  if (outcome === "failed") rejectInitialization(new Error("GPU initialization failed"));
  else finishInitialization();

  if (outcome === "ready") {
    const prepared = await preparing;
    assert.equal(prepared.canvas.width, 1600);
    assert.equal(prepared.canvas.height, 1200);
    assert.equal(host.canvasElement, previousCanvas);
    host.installThreeRendererBackend(prepared, { disposeCurrentPdfObject: false });
    assert.equal(host.canvasElement, prepared.canvas);
    assert.equal(host.renderer, nextRenderer);
    assert.equal(host.activeThreeRendererBackend, "webgpu");
    assert.deepEqual(events, ["internal animation stopped", "frame cancelled", "controls disposed", "previous renderer disposed", "canvas installed"]);
    prepared.canvas.replaceWith = noop;
    const nextWebGl = { coordinateSystem: 2000, dispose: noop };
    host.installThreeRendererBackend({ backend: "webgl", canvas: {}, renderer: nextWebGl }, { disposeCurrentPdfObject: false });
    assert.equal(host.camera.coordinateSystem, 2000, "Switching back to WebGL restores its clip convention");
    assert.equal(host.renderer, nextWebGl);
  } else {
    await assert.rejects(preparing, outcome === "cancelled" ? /Superseded switch/ : /GPU initialization failed/);
    assert.equal(host.canvasElement, previousCanvas);
    assert.equal(host.renderer, previousRenderer);
    assert.equal(host.activeThreeRendererBackend, "webgl");
    assert.deepEqual(events, outcome === "cancelled"
      ? ["internal animation stopped", "next renderer disposed"] : ["next device destroyed"]);
  }
  assert.equal(monitoredRenderers, outcome === "failed" ? 0 : 1);
}

// Initial preparation and presentation must use the same fit, including the
// view direction left by the previous document, without moving that camera.
for (const coordinateSystem of [THREE.WebGLCoordinateSystem, THREE.WebGPUCoordinateSystem]) {
  const scene = new THREE.Scene();
  const object = new THREE.Mesh(new THREE.PlaneGeometry(3200, 1800), new THREE.MeshBasicMaterial());
  object.position.set(800, -400, 0);
  scene.add(object);
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.01, 10000);
  camera.position.set(20, 30, 90);
  camera.coordinateSystem = coordinateSystem;
  camera.updateProjectionMatrix();
  const previousPosition = camera.position.clone();
  const previousTarget = new THREE.Vector3(10, 5, 0);
  const controls = { target: previousTarget.clone(), update: noop };
  const host = vm.createContext({
    THREE, scene, camera, controls, currentPdfObject: object, activePageLayout: "grid",
    tempObjectBounds: new THREE.Box3(), tempObjectSize: new THREE.Vector3(), tempObjectCenter: new THREE.Vector3(),
    tempViewDirection: new THREE.Vector3(), tempClipDelta: new THREE.Vector3(), tempClipForward: new THREE.Vector3(),
    currentContentCenter: new THREE.Vector3(), currentContentRadius: 1,
    MIN_OBJECT_EXTENT: 0.001, CAMERA_FIT_PADDING_PIXELS: 64, CAMERA_CLIP_NEAR_MIN: 0.01,
    CAMERA_CLIP_MARGIN_MULTIPLIER: 3.5, CAMERA_CLIP_UPDATE_EPSILON: 0.001,
    resolveRendererViewportPixels: () => ({ width: 1920, height: 1080 }), requestRender: noop
  });
  for (const name of ["fitCameraToObject", "updateCameraClipping", "updateClipAnchor"]) {
    vm.runInContext(sourceFunction(source, name), host);
  }
  const preview = camera.clone();
  host.fitCameraToObject(object, true, preview);
  assert(camera.position.equals(previousPosition), "Preparation leaves the displayed camera intact");
  assert(controls.target.equals(previousTarget), "Preparation leaves the displayed controls intact");
  host.fitCameraToObject(object, true);
  assert(preview.position.equals(camera.position), "Precompile selects the first presented view");
  assert(preview.projectionMatrix.equals(camera.projectionMatrix), "Precompile includes the presented near/far and clip convention");
  object.geometry.dispose(); object.material.dispose();
}

// Reader projection is perpendicular and depends on CSS zoom and page depth,
// rather than the complete height of a long document.
for (const coordinateSystem of [THREE.WebGLCoordinateSystem, THREE.WebGPUCoordinateSystem]) {
  const camera = new THREE.PerspectiveCamera(45, 1, .01, 1000);
  camera.coordinateSystem = coordinateSystem;
  const object = new THREE.Group();
  const controls = { target: new THREE.Vector3() };
  const host = vm.createContext({ THREE, camera, controls });
  vm.runInContext(sourceFunction(source, "applyReaderCameraView"), host);
  const view = { centerX: 30, centerY: -100000, zoom: 2, width: 900, height: 600 };
  host.applyReaderCameraView(view, object);
  assert.equal(camera.aspect, 1.5);
  assert.equal(camera.position.x, view.centerX);
  assert.equal(camera.position.y, view.centerY);
  const pagePoint = new THREE.Vector3(view.centerX + 10, view.centerY + 10, 0).project(camera);
  assert(Math.abs(pagePoint.x * view.width / 2 - 20) < 1e-8);
  assert(Math.abs(pagePoint.y * view.height / 2 - 20) < 1e-8);
  assert(camera.near < camera.position.z && camera.far > camera.position.z);
  const clipping = [camera.near, camera.far];
  host.applyReaderCameraView({ ...view, centerY: -10000000 }, object);
  assert.deepEqual([camera.near, camera.far], clipping, "moving through a long column preserves depth precision");
  assert(controls.target.equals(new THREE.Vector3(view.centerX, -10000000, 0)));
}

{
  let disconnected = 0, connected = 0;
  const host = vm.createContext({
    activePageLayout: "reader", cameraInteractionEnabled: true, controlsConnected: true, canvasElement: {},
    controls: { enabled: true, disconnect: () => disconnected++, connect: () => connected++ }
  });
  vm.runInContext(sourceFunction(source, "syncPageCameraControls"), host);
  host.syncPageCameraControls();
  host.syncPageCameraControls();
  assert.equal(host.controls.enabled, false);
  assert.equal(disconnected, 1, "Reader removes MapControls input handlers once");
  host.activePageLayout = "sphere";
  host.cameraInteractionEnabled = false;
  host.syncPageCameraControls();
  assert.equal(connected, 1);
  assert.equal(host.controls.enabled, false, "layout switches preserve selection's interaction lock");
}

{
  const canonical = {
    pageRects: Float32Array.of(0, 0, 100, 200, 150, 0, 450, 100),
    pdfPages: [
      { pageIndex: 0, sourcePageIndex: 0, pdfToScene: [1, 0, 0, 1, 0, 0] },
      { pageIndex: 1, sourcePageIndex: 1, pdfToScene: [1, 0, 0, 1, 150, 0] }
    ]
  };
  const before = structuredClone(canonical);
  const host = vm.createContext({
    currentPdfObject: { sceneData: canonical }, readerNavigationSource: null, readerNavigationScene: null,
    readerPageRects: Float32Array.of(-50, -200, 50, 0, -150, -316, 150, -216)
  });
  vm.runInContext(sourceFunction(source, "getReaderNavigationScene"), host);
  const navigation = host.getReaderNavigationScene();
  assert.deepEqual(Array.from(navigation.pdfPages[0].pdfToScene), [1, 0, 0, 1, -50, -200]);
  assert.deepEqual(Array.from(navigation.pdfPages[1].pdfToScene), [1, 0, 0, 1, -150, -316]);
  assert.deepEqual(canonical, before, "Reader destinations use detached metadata and preserve canonical export coordinates");
  assert.equal(host.getReaderNavigationScene(), navigation, "link flights keep a stable scene identity");
}

// Lazy page preparation keeps the committed Grid camera and controls until
// Reader can install its complete column; failure or a newer choice keeps it.
for (const outcome of ["ready", "failed", "superseded"]) {
  let resolvePages, rejectPages;
  const preparation = new Promise((resolve, reject) => { resolvePages = resolve; rejectPages = reject; });
  const events = [], statuses = [];
  const object = { pageCount: 2, subscribePagePreparationProgress: () => noop, getPages: () => preparation };
  const host = vm.createContext({
    currentPdfObject: object, activePageLayout: "grid", pageLayoutRequest: 0, pageLayoutView: null,
    lifetimeSignal: new AbortController().signal,
    syncPageLayoutControls: () => events.push(`controls:${host.activePageLayout}`),
    syncPageCameraControls: () => events.push(`camera-controls:${host.activePageLayout}`),
    reader: { setLayout: layout => events.push(`reader:${layout}`), getView: () => ({}) },
    setStatus: message => statuses.push(message), setPageLayoutProgress: noop,
    createPageLayoutView: (owner, pages) => ({ object: owner, pages, layoutPages: [], layout: "grid", targets: ["grid"] }),
    computeExamplePageLayout: layout => [layout],
    applyExamplePageLayout: (_pages, targets) => events.push(`apply:${targets[0]}`),
    pageLayoutAnimator: { cancel: () => events.push("cancel-tween") },
    setPanelCollapsed: noop,
    applyReaderCameraView: () => events.push(`camera:${host.activePageLayout}`),
    formatPageLayout: layout => layout, requestRender: noop
  });
  vm.runInContext(sourceFunction(source, "setPageLayout"), host);
  const changing = host.setPageLayout("reader");
  assert.equal(host.activePageLayout, "grid", "pending Reader preparation leaves the committed mode unchanged");
  assert.deepEqual(events, [], "pending preparation does not expose Reader controls or move its camera");
  if (outcome === "failed") rejectPages(new Error("Page resources unavailable"));
  else {
    if (outcome === "superseded") await host.setPageLayout("grid");
    resolvePages([{}, {}]);
  }
  await changing;
  if (outcome === "ready") {
    assert.equal(host.activePageLayout, "reader");
    assert(events.indexOf("apply:reader") < events.indexOf("reader:reader"), "the complete column precedes Reader presentation");
    assert(events.includes("cancel-tween"));
    assert(events.includes("camera:reader"));
  } else {
    assert.equal(host.activePageLayout, "grid");
    assert(!events.includes("reader:reader"));
    assert(!events.includes("camera:reader"));
    assert.equal(host.pageLayoutView, null);
    if (outcome === "failed") assert(statuses.some(message => message.includes("Page resources unavailable")));
  }
}

console.log("Three renderer staging preserves the displayed canvas until install, matches the first camera fit and releases cancelled/failed GPU contexts.");
