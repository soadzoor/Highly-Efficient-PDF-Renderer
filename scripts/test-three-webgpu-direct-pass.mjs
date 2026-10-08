import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";
import { Backend, NodeMaterial, Renderer, StandardNodeLibrary, TSL, WGSLNodeBuilder } from "three/webgpu";
import WebGPUBindingUtils from "../node_modules/three/src/renderers/webgpu/utils/WebGPUBindingUtils.js";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const { createThreeWebGpuDirectPass } = await import("../src/threeWebGpuDirectPass.ts");
const { installThreeWebGpuSubmissionBatch } = await import("../src/threeWebGpuSubmissionBatch.ts");
const { enableThreeNodePaintFold, createThreeNodeSurfacePaintFoldMaterial } = await import("../src/threeWebGpuPaintFold.ts");
const { createThreePaintFoldRestorer, threePaintFoldState, THREE_GRADIENT_MASK_VECTORS } = await import("../src/threePaintFold.ts");
const { registerThreePdfShapeUniform, setThreePdfShapeOnly } = await import("../src/threePdfShape.ts");

function bytesOf(data, offset = 0, size) {
  const typed = ArrayBuffer.isView(data), elementSize = data.BYTES_PER_ELEMENT ?? 1;
  const byteOffset = typed ? data.byteOffset + offset * elementSize : offset;
  const byteLength = size === undefined ? data.byteLength - offset * elementSize : size * elementSize;
  return new Uint8Array(typed ? data.buffer : data, byteOffset, byteLength);
}

// Run Three's real objects, WGSL builder, nodes, pipelines and binding manager.
// Only GPU execution is replaced: snapshots are checked when commands submit,
// after later draws have reused shared node inputs and uniform buffers.
class TestBackend extends Backend {
  constructor() {
    super({ canvas: { width: 8, height: 8, style: {} } });
    this.isWebGPUBackend = true;
    this.draws = []; this.passes = []; this.finishes = 0; this.uniformChecks = 0; this.maskChecks = 0;
    this.device = {
      queue: {
        submit(commands) { for (const command of commands) for (const operation of command.operations) operation(); },
        writeBuffer(buffer, offset, data, dataOffset, size) { buffer.bytes.set(bytesOf(data, dataOffset, size), offset); }
      },
      createBuffer({ size, usage }) { return { size, usage, mapState: "unmapped", bytes: new Uint8Array(size), destroy() {} }; },
      createTexture() { return { createView() { return { texture: this }; }, destroy() {} }; },
      createBindGroup({ entries }) { return { entries }; },
      createCommandEncoder() {
        const operations = [];
        return {
          operations,
          copyBufferToBuffer(source, sourceOffset, target, targetOffset, size) {
            operations.push(() => target.bytes.set(source.bytes.subarray(sourceOffset, sourceOffset + size), targetOffset));
          },
          beginRenderPass() { return { setBindGroup() {}, end() {} }; },
          finish() { return { operations }; }
        };
      }
    };
    this.capabilities = { getUniformBufferLimit: () => 65536 };
    this.utils = { getTextureSampleData: () => ({ primarySamples: 1 }) };
    this.bindingUtils = new WebGPUBindingUtils(this);
  }
  get coordinateSystem() { return THREE.WebGPUCoordinateSystem; }
  hasFeature() { return false; }
  createNodeBuilder(mesh, host) { return new WGSLNodeBuilder(mesh, host); }
  createRenderPipeline(object) { this.get(object.pipeline).pipeline = {}; }
  getRenderCacheKey() { return "test"; }
  needsRenderUpdate() { return false; }
  createTexture(texture) { this.get(texture).texture = this.device.createTexture(); }
  createDefaultTexture(texture) { this.createTexture(texture); }
  createUniformBuffer(binding) {
    this.get(binding).buffer = this.device.createBuffer({ size: binding.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }
  updateBinding(binding) { this.bindingUtils.updateBinding(binding); }
  createBindings(group) {
    this.get(group).gpu = this.device.createBindGroup({ entries: group.bindings.map((binding, index) =>
      ({ binding: index, resource: binding.isUniformBuffer ? { buffer: this.get(binding).buffer }
        : this.get(binding.texture).texture.createView() })) });
  }
  updateBindings(group) { this.createBindings(group); }
  beginRender(context) {
    this.passes.push({ target: context.renderTarget, width: context.width, height: context.height,
      viewport: context.viewportValue.toArray(), scissor: context.scissorValue.toArray(), scissorTest: context.scissor,
      clear: context.clearColor, clearColor: { ...context.clearColorValue }, camera: context.camera });
    const data = this.get(context);
    data.encoder = this.device.createCommandEncoder(); data.pass = data.encoder.beginRenderPass({});
  }
  finishRender(context) {
    this.finishes++;
    const data = this.get(context); data.pass.end(); this.device.queue.submit([data.encoder.finish()]);
    if (this.failFinish) { this.failFinish = false; throw new Error("synthetic backend finish failure"); }
  }
  draw(object) {
    if (this.failDraw && (!this.failMesh || this.failMesh === object.object)) {
      this.failDraw = false; throw new Error("synthetic backend draw failure");
    }
    const expected = [];
    object.getBindings().forEach((group, index) => {
      this.get(object.context).pass.setBindGroup(index, this.get(group).gpu);
      for (const [bindingIndex, binding] of group.bindings.entries()) {
        if (binding.isUniformBuffer) {
          assert.equal(this.get(group).gpu.entries[bindingIndex].resource.buffer, this.get(binding).buffer);
          // Comparing equally stale CPU/GPU buffers would miss bad render IDs
          // and node invalidation. Check the live semantic values as well.
          for (const uniform of binding.uniforms) {
            const value = uniform.getValue(), values = typeof value === "number" ? [value] : value.toArray();
            assert.deepEqual(Array.from(binding.buffer.subarray(uniform.offset, uniform.offset + values.length)),
              values.map(Math.fround), "the packed UBO contains the current draw's node values");
            this.uniformChecks++;
          }
          expected.push({ buffer: this.get(binding).buffer, bytes: bytesOf(binding.buffer).slice() });
        } else if (binding.textureNode?.getUniformHash() === "hepr-paint-fold-mask") {
          assert.notEqual(binding.texture, object.context.renderTarget.texture,
            "a private draw never samples its own render attachment as a mask");
          assert.equal(binding.texture, binding.textureNode.value);
          assert.equal(this.get(group).gpu.entries[bindingIndex].resource.texture, this.get(binding.texture).texture,
            "the actual GPU bind group follows the current fold mask");
          const mask = object.object.userData.fold?.gradient?.lut ?? object.object.userData.fold?.mask;
          if (mask) assert.equal(binding.texture, mask);
          this.maskChecks++;
        }
      }
    });
    const draw = { mesh: object.object, geometry: object.geometry, material: object.material,
      side: object.material.side, target: object.context.renderTarget,
      state: threePaintFoldState(object.material), modelView: object.object.modelViewMatrix.toArray() };
    this.get(object.context).encoder.operations.push(() => {
      for (const { buffer, bytes } of expected) assert.deepEqual(buffer.bytes, bytes,
        "queued GPU draws retain their own values after shared inputs are restored");
      this.draws.push(draw);
    });
  }
}

function paint() {
  const material = new NodeMaterial(), shape = TSL.uniform(0), color = TSL.uniform(new THREE.Vector4());
  material.vertexNode = TSL.cameraProjectionMatrix.mul(TSL.highpModelViewMatrix).mul(TSL.vec4(TSL.positionLocal, 1));
  material.fragmentNode = color.add(TSL.vec4(shape.mul(0.01)));
  material.depthTest = material.depthWrite = material.lights = false;
  registerThreePdfShapeUniform(material, shape); enableThreeNodePaintFold(material);
  return { material, color, shape };
}

function texture(version) {
  const value = new THREE.DataTexture(Uint8Array.of(255, 255, 255, 255), 1, 1);
  value.needsUpdate = true; value.version = version;
  return value;
}

const previousSelf = globalThis.self, previousUsage = globalThis.GPUBufferUsage;
globalThis.self = { requestAnimationFrame: () => 1, cancelAnimationFrame() {} };
globalThis.GPUBufferUsage ??= { COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64 };
let renderer, batch;
const geometries = [], materials = [], textures = [], targets = [];
try {
  assert.equal(createThreeWebGpuDirectPass({}), null, "unrecognized hosts retain the normal renderer path");
  const backend = new TestBackend();
  renderer = new Renderer(backend, { outputBufferType: THREE.UnsignedByteType });
  renderer.isWebGPURenderer = true;
  renderer.library = new StandardNodeLibrary(); renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  await renderer.init(); renderer._animation.stop();
  const lifecycle = { lightingBegin: 0, lightingFinish: 0, inspectorBegin: 0, inspectorFinish: 0 };
  for (const [owner, method, count] of [[renderer.lighting, "beginRender", "lightingBegin"],
    [renderer.lighting, "finishRender", "lightingFinish"], [renderer.inspector, "beginRender", "inspectorBegin"],
    [renderer.inspector, "finishRender", "inspectorFinish"]]) {
    const original = owner[method];
    owner[method] = function (...args) { lifecycle[count]++; return original.apply(this, args); };
  }
  batch = installThreeWebGpuSubmissionBatch(renderer);
  const direct = createThreeWebGpuDirectPass(renderer);
  assert.ok(direct, "the initialized r186 WebGPU renderer supports private passes");
  const ordinary = paint(), other = paint(); materials.push(ordinary.material, other.material);
  const surface = createThreeNodeSurfacePaintFoldMaterial(ordinary.material); materials.push(surface);
  const mask = texture(101), lut = texture(102); textures.push(mask, lut);
  const gradient = { lut, linear: true,
    vectors: Float32Array.from({ length: THREE_GRADIENT_MASK_VECTORS * 4 }, (_, index) => index / 4) };
  const alpha = { subtype: "Alpha", children: [] }, luminosity = { subtype: "Luminosity", children: [], backdrop: [0.2, 0.3, 0.4] };
  const geometry = new THREE.PlaneGeometry(1, 1); geometries.push(geometry);
  const scene = new THREE.Scene(); scene.matrixWorldAutoUpdate = false;
  const cameras = [new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10), new THREE.PerspectiveCamera(45, 1, 0.1, 10)];
  for (const camera of cameras) {
    camera.position.z = 1; camera.updateMatrixWorld(); camera.matrixWorldAutoUpdate = false;
  }
  targets.push(new THREE.RenderTarget(8, 8, { depthBuffer: false, stencilBuffer: false, generateMipmaps: false }),
    new THREE.RenderTarget(12, 10, { depthBuffer: false, stencilBuffer: false, generateMipmaps: false }));
  let hooksBefore = 0, hooksAfter = 0;
  const mesh = (owner, material = owner.material) => {
    const value = new THREE.Mesh(geometry, material); value.frustumCulled = false; value.matrixAutoUpdate = false;
    value.userData.color = 0.25; value.userData.owner = owner;
    const fold = createThreePaintFoldRestorer(); let restore, restoreShape;
    value.onBeforeRender = () => {
      hooksBefore++;
      owner.color.value.set(value.userData.color, 0.2, 0.4, 0.8);
      const state = value.userData.fold;
      if (state) restore = fold.apply(value.material, state.opacity, state.mask, state.content, state.gradient);
      restoreShape = setThreePdfShapeOnly(value.material, value.userData.shape === true);
    };
    value.onAfterRender = () => { hooksAfter++; value.userData.restore(); };
    value.userData.restore = () => { restoreShape?.(); restore?.(); restoreShape = restore = null; };
    return value;
  };
  const first = mesh(ordinary, surface), second = mesh(ordinary), third = mesh(other);
  first.userData.fold = { opacity: 0.6, mask, content: alpha }; first.userData.shape = true;
  second.userData.fold = { opacity: 0.4, mask: null, content: luminosity, gradient };
  scene.add(first, second, third);
  let fullRenders = 0;
  const originalRender = renderer.render;
  renderer.render = function (...args) { fullRenders++; return originalRender.apply(this, args); };
  const draw = (target, camera = cameras[0]) => {
    renderer.setRenderTarget(target); direct.render(scene, camera);
    assert.deepEqual(threePaintFoldState(ordinary.material), { opacity: 1, masked: false, mask: null, weights: null });
    assert.equal(ordinary.shape.value, 0);
  };
  for (let frame = 0; frame < 4; frame++) {
    cameras[0].position.x = frame / 10; cameras[0].updateMatrixWorld();
    first.matrixWorld.makeTranslation(frame / 20, 0, 0);
    first.userData.color = frame / 5;
    third.userData.color = 0.8 - frame / 10;
    batch.run(() => { draw(targets[0]); draw(targets[1], cameras[1]); draw(targets[0]); });
  }
  assert.equal(fullRenders, 0, "private passes bypass every full Three render call");
  assert.ok(cameras.every(camera => camera.coordinateSystem === THREE.WebGPUCoordinateSystem),
    "cold private cameras receive Three's WebGPU projection initialization");
  assert.equal(backend.draws.length, 36); assert.equal(backend.passes.length, 12);
  assert.equal(hooksBefore, 36); assert.equal(hooksAfter, 36);
  assert.ok(backend.uniformChecks > 36 * 4 && backend.maskChecks === 36);
  assert.deepEqual(backend.draws.slice(0, 6).map(draw => draw.mesh), [first, second, third, first, second, third]);
  assert.equal(backend.draws[0].state.mask, mask); assert.equal(backend.draws[1].state.mask, lut);
  assert.notDeepEqual(backend.draws[0].modelView, backend.draws.at(-3).modelView,
    "camera and object movement updates Three's model-view inputs");
  assert.equal(batch.stats.submissions, 3, "reusing a render object's UBO preserves earlier GPU draw values");
  assert.equal(batch.stats.requestedSubmissions, 3);
  assert.equal(batch.stats.bufferWriteBarriers, 2);
  const independent = new THREE.Scene(); independent.matrixWorldAutoUpdate = false;
  independent.add(mesh(ordinary, surface), mesh(other));
  const independentTarget = new THREE.RenderTarget(8, 8, { depthBuffer: false, stencilBuffer: false, generateMipmaps: false });
  targets.push(independentTarget);
  renderer.setRenderTarget(independentTarget); direct.render(independent, cameras[0]);
  batch.run(() => {
    draw(targets[0]);
    renderer.setRenderTarget(independentTarget); direct.render(independent, cameras[0]);
  });
  assert.equal(batch.stats.requestedSubmissions, 2);
  assert.equal(batch.stats.submissions, 1, "independent private draw slots share one physical submission");

  // Rendered mask surfaces follow the same texture binding path as data masks.
  targets[0].texture.version = 103;
  first.userData.fold.mask = targets[0].texture;
  draw(targets[1]);
  assert.equal(backend.draws.at(-3).state.mask, targets[0].texture);
  first.userData.fold.mask = mask;

  // Clear and target rectangles use the same physical pixels as full rendering.
  targets[1].viewport.set(1, 2, 9, 7); targets[1].scissor.set(2, 3, 20, 20);
  renderer.setScissorTest(true); renderer.autoClear = true;
  renderer.setClearColor(new THREE.Color(0.2, 0.4, 0.6), 0.5);
  draw(targets[1]);
  const pass = backend.passes.at(-1);
  assert.equal(pass.target, targets[1]); assert.equal(pass.width, 12); assert.equal(pass.height, 10);
  assert.deepEqual(pass.viewport, [1, 2, 9, 7]); assert.deepEqual(pass.scissor, [2, 3, 10, 7]);
  assert.equal(pass.scissorTest, true); assert.equal(pass.clear, true); assert.equal(pass.clearColor.a, 0.5);
  renderer.autoClear = false; renderer.setScissorTest(false);

  // New LOD geometries and caller-owned replacement materials reach Three's
  // object/geometry caches without keeping stale GPU resource identities.
  const replacementGeometry = new THREE.PlaneGeometry(2, 2); geometries.push(replacementGeometry);
  first.geometry = replacementGeometry;
  const replacement = paint(); materials.push(replacement.material);
  third.material = replacement.material;
  third.userData.owner = replacement;
  third.onBeforeRender = () => { hooksBefore++; replacement.color.value.set(0.9, 0.8, 0.7, 1); };
  third.onAfterRender = () => { hooksAfter++; };
  const grown = mesh(other); scene.add(grown);
  draw(targets[0]);
  assert.equal(backend.draws.at(-4).geometry, replacementGeometry);
  assert.equal(backend.draws.at(-2).material, replacement.material);
  assert.equal(backend.draws.at(-1).mesh, grown);
  first.geometry.attributes.position.setX(0, -3); first.geometry.attributes.position.needsUpdate = true;
  draw(targets[0]);
  assert.equal(fullRenders, 0);

  // Preserve ordinary render visibility filters and transparent double-sided
  // lifecycle while letting Three own the pipelines for both face passes.
  grown.visible = false; second.layers.set(1); third.material.visible = false;
  const count = backend.draws.length;
  draw(targets[0]); assert.equal(backend.draws.length, count + 1);
  grown.visible = true; second.layers.set(0); third.material.visible = true;
  first.material.transparent = true; first.material.side = THREE.DoubleSide; first.material.forceSinglePass = false;
  const doubleStart = backend.draws.length;
  draw(targets[0]);
  assert.deepEqual(backend.draws.slice(doubleStart).filter(draw => draw.mesh === first).map(draw => draw.side),
    [THREE.BackSide, THREE.FrontSide]);
  assert.equal(first.material.side, THREE.DoubleSide);
  renderer.opaque = false;
  const transparentOnly = backend.draws.length;
  draw(targets[0]);
  assert.deepEqual(backend.draws.slice(transparentOnly).map(draw => draw.mesh), [first, first]);
  renderer.opaque = true; renderer.transparent = false;
  const opaqueOnly = backend.draws.length;
  draw(targets[0]);
  assert.deepEqual(backend.draws.slice(opaqueOnly).map(draw => draw.mesh), [second, third, grown]);
  renderer.transparent = true;

  // The compositor normally renders inside an outer host render. Sentinel
  // state verifies that its pass cannot corrupt that renderer's continuation.
  const sentinel = { context: {}, objectFunction() {}, handleFunction() {}, sourceMaterial: new THREE.Material(),
    renderId: 321, callDepth: 7 };
  materials.push(sentinel.sourceMaterial);
  renderer._currentRenderContext = sentinel.context;
  renderer._currentRenderObjectFunction = sentinel.objectFunction;
  renderer._handleObjectFunction = sentinel.handleFunction;
  renderer._currentSourceMaterial = sentinel.sourceMaterial;
  renderer._nodes.nodeFrame.renderId = sentinel.renderId; renderer._callDepth = sentinel.callDepth;
  const frameId = renderer._nodes.nodeFrame.frameId;
  const assertRestored = () => {
    assert.equal(renderer._currentRenderContext, sentinel.context);
    assert.equal(renderer._currentRenderObjectFunction, sentinel.objectFunction);
    assert.equal(renderer._handleObjectFunction, sentinel.handleFunction);
    assert.equal(renderer._currentSourceMaterial, sentinel.sourceMaterial);
    assert.equal(renderer._nodes.nodeFrame.renderId, sentinel.renderId);
    assert.equal(renderer._nodes.nodeFrame.frameId, frameId);
    assert.equal(renderer._callDepth, sentinel.callDepth);
  };
  draw(targets[0]); assertRestored();
  const finishes = backend.finishes;
  backend.failDraw = true; backend.failMesh = first;
  try {
    assert.throws(() => draw(targets[0]), /synthetic backend draw failure/);
  } finally { for (const value of scene.children) value.userData.restore?.(); }
  assert.equal(backend.finishes, finishes + 1, "a thrown draw still closes the active backend pass");
  assert.equal(first.material.side, THREE.DoubleSide, "a thrown back-face draw restores the caller's material side");
  assertRestored(); draw(targets[0]); assertRestored();
  backend.failMesh = null;
  backend.failFinish = true;
  assert.throws(() => draw(targets[0]), /synthetic backend finish failure/);
  assertRestored(); draw(targets[0]); assertRestored();
  const beforeScene = scene.onBeforeRender, passCount = backend.passes.length;
  scene.onBeforeRender = () => { throw new Error("synthetic scene preparation failure"); };
  try { assert.throws(() => draw(targets[0]), /synthetic scene preparation failure/); }
  finally { scene.onBeforeRender = beforeScene; }
  assert.equal(backend.passes.length, passCount, "preparation failure does not begin a backend pass");
  assertRestored();
  assert.equal(lifecycle.lightingBegin, lifecycle.lightingFinish, "lighting scopes close after every failure stage");
  assert.equal(lifecycle.inspectorBegin, lifecycle.inspectorFinish, "GPU timestamp/inspector scopes close after every failure stage");
  renderer._currentRenderContext = null; renderer._currentRenderObjectFunction = null;
  renderer._handleObjectFunction = null; renderer._currentSourceMaterial = null;
  renderer._nodes.nodeFrame.renderId = 0; renderer._callDepth = 0;

  // Unsupported host features fall back before the direct path touches state.
  const fallbacks = [
    () => { scene.matrixWorldAutoUpdate = true; return () => { scene.matrixWorldAutoUpdate = false; }; },
    () => { first.frustumCulled = true; return () => { first.frustumCulled = false; }; },
    () => { const custom = () => {}; renderer.setRenderObjectFunction(custom);
      return () => renderer.setRenderObjectFunction(null); }
  ];
  for (const change of fallbacks) {
    const restore = change(), renders = fullRenders;
    try { draw(targets[0]); assert.equal(fullRenders, renders + 1, "unsupported private passes use Three's normal render path"); }
    finally { restore(); }
  }
  const disposals = { geometry: 0, material: 0, texture: 0, target: 0 };
  replacementGeometry.addEventListener("dispose", () => disposals.geometry++);
  replacement.material.addEventListener("dispose", () => disposals.material++);
  mask.addEventListener("dispose", () => disposals.texture++);
  targets[0].addEventListener("dispose", () => disposals.target++);
  direct.dispose?.();
  assert.deepEqual(disposals, { geometry: 0, material: 0, texture: 0, target: 0 }, "direct passes never own the borrowed draw resources");
  console.log("Three WebGPU direct passes: exact queued values, masks, targets, evolving draws, host state and failure recovery passed");
} finally {
  batch?.dispose(); renderer?.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material?.dispose();
  for (const texture of textures) texture.dispose();
  for (const target of targets) target.dispose();
  hooks.deregister();
  if (previousSelf === undefined) delete globalThis.self; else globalThis.self = previousSelf;
  if (previousUsage === undefined) delete globalThis.GPUBufferUsage; else globalThis.GPUBufferUsage = previousUsage;
}
