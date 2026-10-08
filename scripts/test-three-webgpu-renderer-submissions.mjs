import assert from "node:assert/strict";
import * as THREE from "three";
import { Backend, NodeMaterial, Renderer, StandardNodeLibrary, TSL, WGSLNodeBuilder } from "three/webgpu";
import { installThreeWebGpuSubmissionBatch } from "../src/threeWebGpuSubmissionBatch.ts";

// Exercise Three's real render objects, node updates and uniform bindings. The
// fake device executes queued commands in order and compares each GPU uniform
// buffer with the CPU values Three supplied for that particular draw.
function bytesOf(data, offset = 0, size) {
  const typed = ArrayBuffer.isView(data), elementSize = data.BYTES_PER_ELEMENT ?? 1;
  const byteOffset = typed ? data.byteOffset + offset * elementSize : offset;
  const byteLength = size === undefined ? data.byteLength - offset * elementSize : size * elementSize;
  return new Uint8Array(typed ? data.buffer : data, byteOffset, byteLength);
}

function testDevice() {
  const device = {
    draws: 0, checkedBuffers: 0, expected: [],
    queue: {
      submit(commands) { for (const command of commands) for (const operation of command.operations) operation(); },
      writeBuffer(buffer, offset, data, dataOffset, size) { buffer.bytes.set(bytesOf(data, dataOffset, size), offset); }
    },
    createBuffer({ size, usage }) { return { size, usage, mapState: "unmapped", bytes: new Uint8Array(size), destroy() {} }; },
    createBindGroup({ entries }) { return { entries }; },
    createCommandEncoder() {
      const operations = [];
      return {
        copyBufferToBuffer(source, sourceOffset, target, targetOffset, size) {
          operations.push(() => target.bytes.set(source.bytes.subarray(sourceOffset, sourceOffset + size), targetOffset));
        },
        beginRenderPass() {
          const groups = [];
          return {
            setBindGroup(index, group) { groups[index] = group; },
            draw() {
              const expected = device.expected;
              const bound = groups.flatMap(group => group.entries).flatMap(entry => entry.resource.buffer ? [entry.resource.buffer] : []);
              assert.deepEqual(bound, expected.map(item => item.buffer));
              operations.push(() => {
                for (const { buffer, bytes } of expected) {
                  assert.deepEqual(buffer.bytes, bytes, "each GPU draw uses the uniform values Three encoded for it");
                  device.checkedBuffers++;
                }
                device.draws++;
              });
            },
            end() {}
          };
        },
        finish() { return { operations }; }
      };
    }
  };
  return device;
}

class TestBackend extends Backend {
  constructor() {
    super({ canvas: { width: 8, height: 8, style: {} } });
    this.isWebGPUBackend = true;
    this.device = this.originalDevice = testDevice();
    this.capabilities = { getUniformBufferLimit: () => 65536 };
    this.utils = { getTextureSampleData: () => ({ primarySamples: 1 }) };
    this.writes = 0;
  }
  get coordinateSystem() { return THREE.WebGPUCoordinateSystem; }
  hasFeature() { return false; }
  createNodeBuilder(mesh, host) { return new WGSLNodeBuilder(mesh, host); }
  createRenderPipeline(object) { this.get(object.pipeline).pipeline = {}; }
  getRenderCacheKey() { return "test"; }
  needsRenderUpdate() { return false; }
  createTexture(texture) { this.get(texture).texture = {}; }
  createDefaultTexture(texture) { this.createTexture(texture); }
  createUniformBuffer(binding) {
    this.get(binding).buffer = this.device.createBuffer({ size: binding.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }
  updateBinding(binding) {
    const buffer = this.get(binding).buffer;
    if (binding.updateRanges.length) for (const range of binding.updateRanges) {
      this.device.queue.writeBuffer(buffer, range.start * binding.buffer.BYTES_PER_ELEMENT,
        binding.buffer, range.start, range.count);
      this.writes++;
    } else {
      this.device.queue.writeBuffer(buffer, 0, binding.buffer, 0);
      this.writes++;
    }
  }
  createBindings(group) {
    this.get(group).gpu = this.device.createBindGroup({ entries: group.bindings.map((binding, index) =>
      ({ binding: index, resource: binding.isUniformBuffer ? { buffer: this.get(binding).buffer } : {} })) });
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
    const pass = this.get(object.context).pass;
    this.device.expected = [];
    object.getBindings().forEach((group, index) => {
      pass.setBindGroup(index, this.get(group).gpu);
      for (const binding of group.bindings) if (binding.isUniformBuffer) {
        this.device.expected.push({ buffer: this.get(binding).buffer, bytes: bytesOf(binding.buffer).slice() });
      }
    });
    pass.draw();
  }
}

const previousSelf = globalThis.self, previousUsage = globalThis.GPUBufferUsage;
globalThis.self = { requestAnimationFrame: () => 1, cancelAnimationFrame() {} };
globalThis.GPUBufferUsage ??= { COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64 };
let renderer, batch;
try {
  const backend = new TestBackend();
  renderer = new Renderer(backend, { outputBufferType: THREE.UnsignedByteType });
  renderer.library = new StandardNodeLibrary();
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  await renderer.init(); renderer._animation.stop();
  batch = installThreeWebGpuSubmissionBatch(renderer);
  assert.ok(batch);
  const color = TSL.uniform(new THREE.Vector4());
  const material = new NodeMaterial();
  material.vertexNode = TSL.vec4(TSL.positionLocal, 1);
  material.fragmentNode = color;
  material.depthTest = material.depthWrite = false;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const first = new THREE.Mesh(geometry, material), second = new THREE.Mesh(geometry, material);
  first.frustumCulled = second.frustumCulled = false;
  const a = new THREE.Scene(), b = new THREE.Scene();
  a.add(first); b.add(second);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1; camera.updateMatrixWorld();
  const targetA = new THREE.RenderTarget(8, 8, { depthBuffer: false });
  const targetB = new THREE.RenderTarget(8, 8, { depthBuffer: false });
  const draw = (scene, target, value) => {
    color.value.set(value, value + 0.25, value + 0.5, 1);
    renderer.setRenderTarget(target); renderer.render(scene, camera);
  };
  draw(a, targetA, 0); draw(b, targetB, 0);
  backend.device.draws = backend.device.checkedBuffers = backend.writes = 0;

  // Two different objects/targets have independent Three uniform buffers and
  // can enter one GPU submission despite sharing the same node material.
  batch.run(() => { draw(a, targetA, 1); draw(b, targetB, 2); });
  assert.equal(backend.device.draws, 2);
  assert.equal(batch.stats.requestedSubmissions, 2);
  assert.equal(batch.stats.submissions, 1, JSON.stringify(batch.stats));
  assert.equal(batch.stats.requestedBufferWrites, 2);
  assert.equal(batch.stats.bufferWrites, 1, "independent Three uniform writes share one upload");

  // Reusing a render object also reuses its UBO. Rewriting that buffer must
  // keep earlier draws' values, including a partial Three uniform update.
  for (let frame = 0; frame < 4; frame++) {
    batch.run(() => {
      draw(a, targetA, frame + 3);
      draw(b, targetB, frame + 4);
      draw(a, targetA, frame + 5);
    });
  }
  assert.equal(backend.device.draws, 14);
  assert.ok(backend.device.checkedBuffers >= 14, "all actual Three UBO values survive delayed submission");
  assert.ok(backend.writes > 2, "the test exercises changed uniforms after the first draw");
  assert.equal(backend.device, backend.originalDevice, "renderer retains native device identity");
  batch.dispose(); batch = null;
  draw(a, targetA, 20);
  assert.equal(backend.device.draws, 15, "normal Three drawing works after adapter disposal");
  targetA.dispose(); targetB.dispose(); geometry.dispose(); material.dispose();
  console.log("Three WebGPU real renderer submissions: shared node materials, changed UBOs and draw values passed");
} finally {
  batch?.dispose(); renderer?.dispose();
  if (previousSelf === undefined) delete globalThis.self; else globalThis.self = previousSelf;
  if (previousUsage === undefined) delete globalThis.GPUBufferUsage; else globalThis.GPUBufferUsage = previousUsage;
}
