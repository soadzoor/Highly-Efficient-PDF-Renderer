import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";
import { Backend, NodeMaterial, Renderer, StandardNodeLibrary, TSL, WGSLNodeBuilder } from "three/webgpu";
import WebGPUBindingUtils from "../node_modules/three/src/renderers/webgpu/utils/WebGPUBindingUtils.js";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) {
    return next(`${specifier}.ts`, context);
  }
  return next(specifier, context);
} });
const { enableThreeNodePaintFold, createThreeNodeSurfacePaintFoldMaterial } = await import("../src/threeWebGpuPaintFold.ts");
const { createThreePaintFoldRestorer, threePaintFoldState, THREE_GRADIENT_MASK_VECTORS } = await import("../src/threePaintFold.ts");
const { registerThreePdfShapeUniform, setThreePdfShapeOnly } = await import("../src/threePdfShape.ts");
const { registerThreeNodeClipPosition } = await import("../src/threeWebGpuVectorClips.ts");
const { initializeThreeVectorClip, createThreeVectorClipMaterial, createThreeInstanceVectorClipMaterial } =
  await import("../src/threeVectorClips.ts");
const { installThreeWebGpuSubmissionBatch } = await import("../src/threeWebGpuSubmissionBatch.ts");

function dataTexture(version) {
  const texture = new THREE.DataTexture(Uint8Array.of(255, 255, 255, 255), 1, 1);
  texture.needsUpdate = true; texture.version = version;
  return texture;
}

function paint() {
  const material = new NodeMaterial(), shape = TSL.uniform(0), matrix = new THREE.Matrix4();
  material.vertexNode = TSL.mul(TSL.uniform(matrix), TSL.vec4(TSL.positionLocal, 1));
  material.fragmentNode = TSL.vec4(TSL.vec3(0.2, 0.4, 0.6).add(shape.mul(0.1)), 0.8);
  material.depthTest = material.depthWrite = false;
  registerThreePdfShapeUniform(material, shape);
  enableThreeNodePaintFold(material);
  return { material, shape, matrix };
}

function build(material, geometry) {
  const renderer = {
    contextNode: TSL.context({}), library: { fromMaterial: value => value },
    getRenderTarget: () => null, getMRT: () => null,
    backend: { compatibilityMode: false, utils: { getTextureSampleData: () => ({ primarySamples: 1 }) },
      capabilities: { getUniformBufferLimit: () => 65536 } },
    hasFeature: () => false, hasCompatibility: () => false,
    coordinateSystem: THREE.WebGPUCoordinateSystem,
    debug: { diagnostics: { keywords: false } }
  };
  const builder = new WGSLNodeBuilder(new THREE.Mesh(geometry, material), renderer);
  builder.scene = new THREE.Scene(); builder.camera = new THREE.PerspectiveCamera();
  return builder.build();
}

function uniformCount(builder) {
  return builder.getBindings().flatMap(group => group.bindings).reduce((count, binding) => count + (binding.uniforms?.length ?? 0), 0);
}

function bytesOf(data, offset = 0, size) {
  const typed = ArrayBuffer.isView(data), elementSize = data.BYTES_PER_ELEMENT ?? 1;
  const byteOffset = typed ? data.byteOffset + offset * elementSize : offset;
  const byteLength = size === undefined ? data.byteLength - offset * elementSize : size * elementSize;
  return new Uint8Array(typed ? data.buffer : data, byteOffset, byteLength);
}

// Three's real node and binding managers run here. The device only replaces
// GPU execution, retaining queued draw order and checking every UBO snapshot.
class TestBackend extends Backend {
  constructor() {
    super({ canvas: { width: 8, height: 8, style: {} } });
    this.isWebGPUBackend = true;
    this.draws = 0; this.uniformChecks = 0; this.maskChecks = 0;
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
          copyBufferToBuffer(source, sourceOffset, target, targetOffset, size) {
            operations.push(() => target.bytes.set(source.bytes.subarray(sourceOffset, sourceOffset + size), targetOffset));
          },
          beginRenderPass() { return { setBindGroup() {}, end() {} }; },
          finish() { return { operations }; }, operations
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
    const data = this.get(context);
    data.encoder = this.device.createCommandEncoder(); data.pass = data.encoder.beginRenderPass({});
  }
  finishRender(context) {
    const data = this.get(context); data.pass.end(); this.device.queue.submit([data.encoder.finish()]);
  }
  draw(object) {
    const expected = [];
    object.getBindings().forEach((group, index) => {
      this.get(object.context).pass.setBindGroup(index, this.get(group).gpu);
      for (const [bindingIndex, binding] of group.bindings.entries()) {
        if (binding.isUniformBuffer) {
          assert.equal(this.get(group).gpu.entries[bindingIndex].resource.buffer, this.get(binding).buffer);
          // GPU-vs-CPU bytes alone would also accept two equally stale buffers.
          // Compare packed values with the nodes' current semantic values first.
          for (const uniform of binding.uniforms) {
            const value = uniform.getValue();
            const values = typeof value === "number" ? [value] : value.toArray();
            assert.deepEqual(Array.from(binding.buffer.subarray(uniform.offset, uniform.offset + values.length)),
              values.map(Math.fround), "the packed UBO contains this draw's current node values");
            this.uniformChecks++;
          }
          expected.push({ buffer: this.get(binding).buffer, bytes: bytesOf(binding.buffer).slice() });
        } else if (binding.textureNode?.getUniformHash() === "hepr-paint-fold-mask") {
          assert.equal(binding.texture, binding.textureNode.value, "the mask binding follows the current shared fold input");
          assert.equal(this.get(group).gpu.entries[bindingIndex].resource.texture, this.get(binding.texture).texture,
            "the GPU bind group also references the current mask texture");
          if (this.expectedMask) assert.equal(binding.texture, this.expectedMask);
          this.maskChecks++;
        }
      }
    });
    this.get(object.context).encoder.operations.push(() => {
      for (const { buffer, bytes } of expected) assert.deepEqual(buffer.bytes, bytes,
        "later folds and restorations cannot change an earlier queued GPU draw");
      this.draws++;
    });
  }
}

const previousSelf = globalThis.self, previousUsage = globalThis.GPUBufferUsage;
globalThis.self = { requestAnimationFrame: () => 1, cancelAnimationFrame() {} };
globalThis.GPUBufferUsage ??= { COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64 };
let renderer, batch;
const materials = [], textures = [], targets = [];
const geometry = new THREE.PlaneGeometry(1, 1);
geometry.setAttribute("aVectorClipIndex", new THREE.Float32BufferAttribute([1, 1, 1, 1], 1));
try {
  const source = paint(); materials.push(source.material);
  const original = source.material.fragmentNode;
  const surface = createThreeNodeSurfacePaintFoldMaterial(source.material); materials.push(surface);
  assert.ok(surface instanceof NodeMaterial);
  assert.equal(source.material.fragmentNode, original, "public paints retain their computed-gradient shader");
  assert.equal(surface.vertexNode, source.material.vertexNode);
  assert.equal(surface.blending, source.material.blending);
  assert.equal(createThreeNodeSurfacePaintFoldMaterial(new THREE.Material()), null);
  const changed = paint(); materials.push(changed.material);
  changed.material.fragmentNode = TSL.vec4(1);
  assert.equal(createThreeNodeSurfacePaintFoldMaterial(changed.material), null,
    "a caller's replaced fragment graph cannot be silently overwritten");

  const assertShaders = (full, simple) => {
    const fullBuild = build(full, geometry), simpleBuild = build(simple, geometry);
    assert.match(fullBuild.fragmentShader, /fn heprPaintFoldScale/);
    assert.match(fullBuild.fragmentShader, /heprFoldGradientParameter/);
    assert.match(simpleBuild.fragmentShader, /fn heprSurfacePaintFoldScale/);
    assert.doesNotMatch(simpleBuild.fragmentShader, /heprFoldGradient|d14: vec4f/);
    assert.equal(uniformCount(fullBuild) - uniformCount(simpleBuild), THREE_GRADIENT_MASK_VECTORS,
      "surface folds omit exactly the computed-gradient vectors");
    assert.match(simpleBuild.fragmentShader, /textureLoad\(mask, clamp/,
      "surface masks retain bounded loads for the neutral 1x1 input");
    assert.match(simpleBuild.fragmentShader, /if \(fold\.y < 0\.5\) \{ return fold\.x; \}/,
      "unmasked paints preserve the direct opacity scale");
    assert.match(simpleBuild.fragmentShader, /return fold\.x \* clamp\(dot\(value, weights\) \+ fold\.z, 0\.0, 1\.0\);/,
      "rendered alpha and luminosity masks retain their scale, weights and backdrop bias");
    assert.ok(simpleBuild.getBindings().length <= 4, "variant stays within WebGPU's minimum bind-group limit");
    return [fullBuild.fragmentShader, simpleBuild.fragmentShader];
  };
  assertShaders(source.material, surface);

  const clipTexture = dataTexture(100); textures.push(clipTexture);
  for (const [antialias, raster] of [[false, false], ["straight-alpha", false], ["premultiplied", true]]) {
    const base = paint(); materials.push(base.material);
    registerThreeNodeClipPosition(base.material, TSL.positionLocal.xy, antialias, raster);
    initializeThreeVectorClip(base.material, clipTexture);
    for (const clipped of [createThreeVectorClipMaterial(base.material, 0), createThreeInstanceVectorClipMaterial(base.material)]) {
      const clippedSurface = createThreeNodeSurfacePaintFoldMaterial(clipped);
      materials.push(clipped, clippedSurface); assert.ok(clippedSurface);
      const shaders = assertShaders(clipped, clippedSurface);
      for (const shader of shaders) {
        assert.match(shader, raster ? /heprRasterClip/ : /heprVectorClip/);
        if (antialias) {
          assert.match(shader, /heprClipPixelWidth/);
          const width = shader.indexOf("heprClipAAWidth ="), paint = shader.indexOf("heprClipSource =");
          assert.ok(width >= 0 && paint > width,
            "clip derivatives run before a paint can discard in either variant");
        }
      }
    }
  }

  const backend = new TestBackend();
  renderer = new Renderer(backend, { outputBufferType: THREE.UnsignedByteType });
  renderer.library = new StandardNodeLibrary(); renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  await renderer.init(); renderer._animation.stop(); batch = installThreeWebGpuSubmissionBatch(renderer);
  const other = paint(); materials.push(other.material);
  const otherSurface = createThreeNodeSurfacePaintFoldMaterial(other.material); materials.push(otherSurface);
  const mask = dataTexture(101), lut = dataTexture(102); textures.push(mask, lut);
  const gradient = { lut, linear: true,
    vectors: Float32Array.from({ length: THREE_GRADIENT_MASK_VECTORS * 4 }, (_, index) => index / 4) };
  const alpha = { subtype: "Alpha", children: [] }, luminosity = { subtype: "Luminosity", backdrop: [0.2, 0.3, 0.4], children: [] };
  const cameras = [new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10), new THREE.PerspectiveCamera(45, 1, 0.1, 10)];
  for (const camera of cameras) { camera.position.z = 1; camera.updateMatrixWorld(); }
  targets.push(new THREE.RenderTarget(8, 8, { depthBuffer: false }), new THREE.RenderTarget(8, 8, { depthBuffer: false }));
  const scenes = new Map();
  const draw = (material, owner, camera, opacity, texture, content, description, shape = false) => {
    let scene = scenes.get(material);
    if (!scene) {
      scene = new THREE.Scene(); const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false;
      scene.add(mesh); scenes.set(material, scene);
    }
    const originalState = threePaintFoldState(owner.material);
    const restore = createThreePaintFoldRestorer().apply(material, opacity, texture, content, description);
    const restoreShape = setThreePdfShapeOnly(material, shape);
    try {
      assert.equal(owner.shape.value, shape ? 1 : 0, "variants share the public shape-only input");
      const state = threePaintFoldState(owner.material);
      assert.equal(state.opacity, opacity); assert.equal(state.mask, description?.lut ?? texture);
      if (description) assert.deepEqual(state.gradient, Array.from(description.vectors));
      backend.expectedMask = description?.lut ?? texture;
      renderer.setRenderTarget(targets[cameras.indexOf(camera)]); renderer.render(scene, camera);
    } finally {
      restoreShape(); restore(); backend.expectedMask = null;
    }
    assert.deepEqual(threePaintFoldState(owner.material), originalState, "draw cleanup restores the source's fold exactly");
    assert.equal(owner.shape.value, 0);
  };
  for (let frame = 0; frame < 3; frame++) {
    source.matrix.makeTranslation(frame / 10, -frame / 20, 0);
    other.matrix.makeScale(1 + frame / 10, 1, 1);
    batch.run(() => {
      draw(surface, source, cameras[0], 0.25 + frame / 10, null);
      draw(surface, source, cameras[0], 0.6, mask, alpha, undefined, true);
      draw(source.material, source, cameras[0], 0.4, null, luminosity, gradient);
      draw(surface, source, cameras[1], 0.7, mask, luminosity);
      draw(otherSurface, other, cameras[1], 0.9, mask, alpha);
      draw(surface, source, cameras[0], 1, null);
    });
    assert.deepEqual(threePaintFoldState(other.material), { opacity: 1, masked: false, mask: null, weights: null },
      "independent documents retain separate restored fold state");
  }
  assert.equal(backend.draws, 18);
  assert.ok(backend.uniformChecks >= 18 * 4 + 3 * THREE_GRADIENT_MASK_VECTORS);
  assert.equal(backend.maskChecks, 18);
  console.log("Three WebGPU fold variants: smaller WGSL, preserved clips, shared inputs and exact queued draw values passed");
} finally {
  batch?.dispose(); renderer?.dispose(); geometry.dispose();
  for (const material of materials) material?.dispose();
  for (const texture of textures) texture.dispose();
  for (const target of targets) target.dispose();
  hooks.deregister();
  if (previousSelf === undefined) delete globalThis.self; else globalThis.self = previousSelf;
  if (previousUsage === undefined) delete globalThis.GPUBufferUsage; else globalThis.GPUBufferUsage = previousUsage;
}
