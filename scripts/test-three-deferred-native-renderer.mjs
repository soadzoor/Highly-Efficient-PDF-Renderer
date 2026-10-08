import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
const { deferRendererInitialization } = await import("../src/deferredRendererInitialization.ts");
const { deferRendererSceneUpload } = await import("../src/deferredRendererApi.ts");
const { SharedPageRenderer } = await import("../src/sharedPageRenderer.ts");
const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");

const canvas = { width: 800, height: 600, getBoundingClientRect: () =>
  ({ left: 10, bottom: 320, width: 400, height: 300 }) };
const calls = [];
let creations = 0, unusedReleases = 0;
class NativeRenderer {
  view = { cameraCenterX: 0, cameraCenterY: 0, zoom: 1 };
  stats = null;
  setExternalFrameDriver(value) { calls.push(["external", value]); }
  setStrokeCurveEnabled(value) { calls.push(["curve", value]); }
  setVectorColorOverride(...rgba) { calls.push(["color", ...rgba]); }
  setInteractionViewportProvider(value) { calls.push(["viewport", value]); }
  setFrameListener(value) { calls.push(["listener", value]); }
  setViewState(value, options) { this.view = { ...value }; calls.push(["view", value, options]); }
  getViewState() { return { ...this.view }; }
  getPresentedViewState() { return { ...this.view }; }
  getPresentedFrameSerial() { return 12; }
  getVectorColorOverride() { return [0.2, 0.3, 0.4, 0.5]; }
  fitToBounds(bounds, padding) { calls.push(["fit", bounds, padding]); }
  beginPanInteraction() { calls.push(["beginPan"]); }
  endPanInteraction() { calls.push(["endPan"]); }
  panByPixels(x, y) { calls.push(["pan", x, y]); }
  zoomAtClientPoint(...args) { calls.push(["zoom", ...args]); }
  clientToScenePoint(x, y) { return { x, y }; }
  sceneToClientPoint(x, y) { return { x, y }; }
  resize() { calls.push(["resize"]); }
  setScene(scene) { calls.push(["scene", scene]); return this.stats = { marker: "uploaded" }; }
  getSceneStats() { return this.stats; }
  renderExternalFrame(timestamp) { assert(this.stats); calls.push(["render", timestamp]); }
  dispose() { calls.push(["dispose"]); }
}
const lazy = () => deferRendererInitialization(canvas, NativeRenderer.prototype, () => {
  creations++; return new NativeRenderer();
}, () => { unusedReleases++; });

try {
  const native = lazy(), scene = createEmptyVectorScene();
  const renderer = deferRendererSceneUpload(native, scene);
  const initialView = { cameraCenterX: 20, cameraCenterY: 30, zoom: 2 };
  renderer.setExternalFrameDriver(true);
  renderer.setStrokeCurveEnabled(true);
  renderer.setStrokeCurveEnabled(false);
  renderer.setVectorColorOverride(-1, 0.3, 2, 0.5);
  renderer.fitToBounds({ minX: 0, minY: 0, maxX: 400, maxY: 300 }, 0);
  renderer.setViewState(initialView, { scheduleFrame: false });
  renderer.setViewState({ ...initialView, zoom: NaN });
  renderer.resize();
  renderer.beginPanInteraction(); renderer.endPanInteraction();
  assert.deepEqual(renderer.getViewState(), initialView);
  assert.deepEqual(renderer.getPresentedViewState(), initialView);
  assert.equal(renderer.getPresentedFrameSerial(), 0);
  assert.deepEqual(renderer.getVectorColorOverride(), [0, 0.3, 1, 0.5]);
  assert.deepEqual(renderer.sceneToClientPoint(20, 30), { x: 210, y: 170 });
  assert.deepEqual(renderer.clientToScenePoint(210, 170), { x: 20, y: 30 });
  assert.equal(renderer.unsupportedOptionalMethod, undefined);
  assert.equal(creations, 0, "Three setup, view synchronization, and hit testing do not compile native shaders");
  assert(renderer instanceof NativeRenderer, "the advanced renderer retains its backend prototype");
  const render = renderer.renderExternalFrame;
  assert.equal(render, renderer.renderExternalFrame, "method identity remains stable");
  render(123);
  assert.equal(creations, 1);
  assert.deepEqual(calls[0], ["external", true], "configuration replay must not schedule unseen frames");
  assert.deepEqual(calls.filter(([name]) => name === "curve"), [["curve", false]], "only current config is replayed");
  assert.deepEqual(calls.slice(-2), [["scene", scene], ["render", 123]]);
  assert.deepEqual(native.getViewState(), initialView);
  assert.equal(native.getPresentedFrameSerial(), 12, "initialized queries use actual backend state");
  render(124);
  assert.equal(creations, 1);
  assert.equal(calls.filter(([name]) => name === "scene").length, 1);
  renderer.dispose(); renderer.dispose();
  assert.equal(calls.filter(([name]) => name === "dispose").length, 1);

  const dormant = lazy();
  dormant.dispose(); dormant.dispose();
  assert.equal(creations, 1, "disposal never creates unused GPU resources");
  assert.equal(unusedReleases, 1);
  assert.equal(dormant.clientToScenePoint(0, 0), null);
  assert.throws(() => dormant.getSceneStats(), /disposed/);

  const sharedNative = lazy();
  const shared = new SharedPageRenderer(deferRendererSceneUpload(sharedNative, scene), canvas);
  const page = shared.createView(scene, canvas);
  page.setStrokeCurveEnabled(false); page.setViewState(initialView);
  page.setFrameListener(null); page.resize();
  assert.equal(creations, 1, "independent page capability probes keep the shared fallback dormant");
  assert.deepEqual(page.getViewState(), initialView);
  assert.equal(page.getSceneStats().marker, "uploaded");
  assert.equal(creations, 2);
  page.dispose(); sharedNative.dispose();

  let failedDisposals = 0;
  class FailingRenderer extends NativeRenderer {
    setStrokeCurveEnabled() { throw new Error("config failure"); }
    dispose() { failedDisposals++; }
  }
  const failing = deferRendererInitialization(canvas, FailingRenderer.prototype, () => new FailingRenderer());
  failing.setStrokeCurveEnabled(false);
  assert.throws(() => failing.getSceneStats(), /config failure/);
  failing.dispose();
  assert.equal(failedDisposals, 1, "failed initialization releases the created backend exactly once");

  await testWebGpuFactory();
  await testThreeFactory();
  console.log("Three native fallback initialization: dormant configuration, view mapping, shared pages, first-use upload, WebGPU device ownership and initialization failures passed.");
} finally {
  hooks.deregister();
}

async function testThreeFactory() {
  const previousDocument = globalThis.document;
  let contextRequests = 0;
  globalThis.document = { createElement: type => {
    assert.equal(type, "canvas");
    return { ...canvas, style: {}, getContext() {
      contextRequests++;
      throw new Error("Three material setup must not initialize the native GPU canvas.");
    } };
  } };
  let object;
  try {
    const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
    const { createThreePdfObject } = await import("../src/threePdfObject.ts");
    const scene = buildStrokeScene([{ points: [[0, 0], [20, 20]], width: 1, color: "red" }]);
    object = await createThreePdfObject({ scene, sourceLabel: "deferred fallback", sourceKind: "scene" },
      { rendererType: "webgl", vectorLod: "off", textLod: "off" });
    assert.equal(contextRequests, 0, "the default Three factory does not initialize its native WebGL fallback");
    const host = { isWebGLRenderer: true, capabilities: { maxTextureSize: 16384 },
      getDrawingBufferSize: target => target.set(640, 480), getPixelRatio: () => 1,
      domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, bottom: 480, width: 640, height: 480 }) } };
    const hostScene = new THREE.Scene(); hostScene.add(object);
    const camera = new THREE.PerspectiveCamera(50, 640 / 480, 0.1, 1000);
    camera.position.set(0, 0, 250); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
    hostScene.updateMatrixWorld(true);
    hostScene.onBeforeRender(host, hostScene, camera, null);
    assert.equal(object.materialPipelineActive, true);
    assert.equal(contextRequests, 0, "the first Three material frame keeps the native fallback dormant");
    object.dispose(); object = null;
    assert.equal(contextRequests, 0, "disposing a material-only Three document does not initialize native resources");
  } finally {
    object?.dispose(); globalThis.document = previousDocument;
  }
}

async function testWebGpuFactory() {
  const keys = ["navigator", "GPUBufferUsage", "GPUTextureUsage", "GPUShaderStage"];
  const originals = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 };
  globalThis.GPUTextureUsage = { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 };
  globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2 };
  let device, contexts = 0, unconfigures = 0;
  const gpuCanvas = { ...canvas, getContext() { contexts++; return {
    configure() {}, unconfigure() { unconfigures++; }
  }; } };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { gpu: {
    requestAdapter: async () => ({ limits: { maxTextureDimension2D: 8192 }, features: new Set(),
      requestDevice: async () => device }), getPreferredCanvasFormat: () => "bgra8unorm"
  } } });
  try {
    const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");
    device = makeDevice(); device.features.add("texture-compression-bc");
    const dormant = await WebGpuFloorplanRenderer.createDeferred(gpuCanvas);
    dormant.setExternalFrameDriver(true); dormant.setStrokeCurveEnabled(false);
    dormant.setViewState({ cameraCenterX: 5, cameraCenterY: 6, zoom: 7 });
    assert.equal(contexts, 0, "preparing a deferred WebGPU fallback does not acquire/configure the canvas");
    assert.equal(device.pipelines, 0);
    assert.equal(device.shaders, 0);
    dormant.dispose(); dormant.dispose();
    assert.equal(device.destroyed, 1, "cancellation/disposal releases an unused prepared device exactly once");

    device = makeDevice();
    const deferred = await WebGpuFloorplanRenderer.createDeferred(gpuCanvas);
    deferred.setExternalFrameDriver(true);
    assert.equal(deferred.getSceneStats(), null);
    assert(device.pipelines >= 8, "the native pipelines are compiled when a native resource is requested");
    assert.equal(contexts, 1);
    deferred.dispose(); deferred.dispose();
    await Promise.resolve();
    assert.equal(device.destroyed, 1);
    assert.equal(unconfigures, 1);

    device = makeDevice();
    const eager = await WebGpuFloorplanRenderer.create(gpuCanvas);
    assert(device.pipelines >= 8, "native WebGPU creation remains eager");
    eager.dispose();
    assert.equal(device.destroyed, 1);

    device = makeDevice();
    const failed = await WebGpuFloorplanRenderer.createDeferred({ ...canvas, getContext: () => null });
    assert.throws(() => failed.getSceneStats(), /canvas context/);
    failed.dispose();
    assert.equal(device.destroyed, 1, "deferred context acquisition failure releases the prepared device");
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
}

function makeDevice() {
  const device = {
    destroyed: 0, pipelines: 0, shaders: 0, features: new Set(), limits: { maxTextureDimension2D: 8192 },
    destroy() { this.destroyed++; },
    queue: { writeBuffer() {}, writeTexture() {} },
    createShaderModule(descriptor) { this.shaders++; return descriptor; },
    createBindGroupLayout: descriptor => descriptor, createPipelineLayout: descriptor => descriptor,
    createSampler: descriptor => descriptor, createBindGroup: descriptor => descriptor,
    createRenderPipeline(descriptor) { this.pipelines++; return { getBindGroupLayout: index => descriptor.layout.bindGroupLayouts[index] }; },
    createBuffer: descriptor => ({ descriptor, destroy() {} }),
    createTexture: () => ({ createView: () => ({}), destroy() {} })
  };
  return device;
}
