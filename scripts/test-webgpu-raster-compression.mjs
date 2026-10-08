import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
const globals = Object.fromEntries(["GPUBufferUsage", "GPUTextureUsage", "GPUShaderStage", "navigator"]
  .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, STORAGE: 4, COPY_SRC: 8, MAP_READ: 16 };
globalThis.GPUTextureUsage = { TEXTURE_BINDING: 1, COPY_DST: 2 };
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2 };
const warn = console.warn, warnings = [];
console.warn = (...args) => warnings.push(args.join(" "));

try {
  const { WebGpuRasterCompression } = await import("../src/webGpuRasterCompression.ts");
  const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { assessRasterCompression, estimateCompressedRasterBytes, rasterCompressionMipLayout } = await import("../src/rasterCompression.ts");
  const { automaticRasterMemoryBudget } = await import("../src/rasterMemoryBudget.ts");
  const sceneWith = (...layers) => Object.assign(createEmptyVectorScene(), { rasterLayers: layers });
  const createRenderer = async (scene, options = {}) => {
    const device = makeDevice(options);
    const requests = [];
    const advertised = new Set(options.advertisedFeatures ?? [...device.features]);
    const adapter = { features: advertised, limits: device.limits, async requestDevice(descriptor) {
      requests.push(descriptor);
      if (options.rejectOptionalFeatures && requests.length === 1) throw new Error("synthetic feature negotiation failure");
      device.features = new Set(descriptor.requiredFeatures ?? []);
      return device;
    } };
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
      deviceMemory: .25, gpu: { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => "rgba8unorm" }
    } });
    const renderer = await WebGpuFloorplanRenderer.create({ getContext: () => ({ configure() {}, unconfigure() {} }) });
    renderer.scene = scene;
    renderer.requestFrame = () => {};
    return { renderer, device, requests };
  };

  {
    const device = makeDevice({ features: [] });
    assert.equal(await WebGpuRasterCompression.create(device), null);
    assert.equal(device.computePipelines.length, 0, "unsupported devices do not compile optional kernels");
  }

  for (const [feature, format, gpuFormat] of [
    ["texture-compression-bc", "bc7", "bc7-rgba-unorm"],
    ["texture-compression-astc", "astc-4x4", "astc-4x4-unorm"]
  ]) {
    const device = makeDevice({ features: [feature], limit: 64 });
    const compressor = await WebGpuRasterCompression.create(device, 3200);
    assert.equal(compressor.format, format);
    assert(compressor.workspaceBytes <= 3200);
    assert.equal(compressor.residentBytes, 0);
    const data = new Uint8Array(5 * 33 * 4);
    for (let index = 0; index < 5 * 33; index++) data.set([64, 31, 15, 128], index * 4);
    const result = compressor.createTexture(5, 33, data);
    assert.equal(result.texture.descriptor.format, gpuFormat);
    assert.deepEqual(result.texture.descriptor.size, { width: 8, height: 36, depthOrArrayLayers: 1 });
    assert.deepEqual(result.uvScale, [5 / 8, 33 / 36]);
    assert.equal(result.estimatedBytes, estimateCompressedRasterBytes(5, 33, format));
    assert.equal(result.texture.descriptor.mipLevelCount, 6);
    assert.equal(compressor.residentBytes, compressor.workspaceBytes);
    assert.equal(device.buffers.length, 2, "all bands and mips share one output and one uniform buffer");
    assert(device.submissions.length > result.texture.descriptor.mipLevelCount, "tall levels use bounded bands");
    const output = device.buffers.find(buffer => buffer.descriptor.label === "hepr-raster-compression-blocks");
    assert.equal(output.descriptor.usage, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    assert(device.buffers.every(buffer => !(buffer.descriptor.usage & GPUBufferUsage.MAP_READ)),
      "compressed output never allocates a CPU readback buffer");
    const firstUpload = device.uploads[0];
    assert.deepEqual(firstUpload.firstPixels, [64, 31, 15, 128, 64, 31, 15, 128],
      "already-premultiplied colors and alpha are uploaded unchanged");
    checkCopies(device, result.texture);
    const scratch = device.textures.find(texture => texture.descriptor.label === "hepr-raster-compression-input");
    const bufferCount = device.buffers.length;
    const second = compressor.createTexture(5, 33, data);
    assert.equal(device.buffers.length, bufferCount);
    assert.equal(device.textures.filter(texture => texture.descriptor.label === "hepr-raster-compression-input").length, 1,
      "successive images reuse the same queue-ordered workspace");
    assert(!scratch.destroyed);
    result.texture.destroy(); second.texture.destroy();
    compressor.releaseWorkspace();
    assert.equal(compressor.residentBytes, 0);
    assert(scratch.destroyed && device.buffers.every(buffer => buffer.destroyed));
    assert(compressor.available, "residency release keeps a validated pipeline available for replay");
    const replay = compressor.createTexture(5, 33, data);
    replay.texture.destroy(); compressor.dispose();
    assert(device.textures.every(texture => texture.destroyed));
    assert(device.buffers.every(buffer => buffer.destroyed));
    assert.equal(compressor.createTexture(5, 33, data), null);
  }

  for (const [feature, format, gpuFormat] of [
    ["texture-compression-bc", "bc7", "bc7-rgba-unorm"],
    ["texture-compression-astc", "astc-4x4", "astc-4x4-unorm"]
  ]) {
    const device = makeDevice({ features: [feature], limit: 64 });
    const compressor = await WebGpuRasterCompression.create(device, 3200);
    const layout = rasterCompressionMipLayout(5, 33, format);
    const encoded = new Uint8Array(estimateCompressedRasterBytes(5, 33, format));
    layout.forEach((level, index) => encoded.fill(index + 1, level.byteOffset, level.byteOffset + level.byteLength));
    const preserved = encoded.slice();
    const result = compressor.createTextureFromEncoded(5, 33, encoded);
    assert.equal(result.texture.descriptor.format, gpuFormat);
    assert.deepEqual(result.texture.descriptor.size, { width: 8, height: 36, depthOrArrayLayers: 1 });
    assert.equal(result.texture.descriptor.mipLevelCount, layout.length);
    assert.deepEqual(result.uvScale, [5 / 8, 33 / 36]);
    assert.equal(result.estimatedBytes, encoded.byteLength);
    assert.equal(device.textures.length, 1, "prepared blocks allocate only their sampled destination");
    assert.equal(device.buffers.length, 0, "prepared blocks need no encoder output or parameter buffers");
    assert.equal(device.submissions.length, 0, "prepared uploads perform no compute dispatch or buffer copy");
    assert.equal(compressor.residentBytes, 0, "the import path consumes no shared encoder workspace");
    assert.equal(device.uploads.length, layout.length);
    for (const [mip, level] of layout.entries()) {
      const upload = device.uploads[mip];
      assert.equal(upload.destination.texture, result.texture);
      assert.equal(upload.destination.mipLevel, mip);
      assert.deepEqual(upload.layout, { bytesPerRow: level.blocksX * 16, rowsPerImage: level.blocksY });
      assert.deepEqual(upload.size, { width: level.blocksX * 4, height: level.blocksY * 4, depthOrArrayLayers: 1 },
        "terminal mip uploads include the complete physical compressed blocks");
      assert.deepEqual(upload.blockBytes, encoded.subarray(level.byteOffset, level.byteOffset + level.byteLength));
    }
    assert.deepEqual(encoded, preserved, "imports never change the cached mip bytes");
    const textureCount = device.textures.length;
    for (const invalid of [encoded.subarray(1), new Uint8Array(encoded.byteLength + 1)]) {
      assert.throws(() => compressor.createTextureFromEncoded(5, 33, invalid), RangeError);
    }
    for (const [width, height] of [[0, 33], [NaN, 33], [5, 1.5]]) {
      assert.throws(() => compressor.createTextureFromEncoded(width, height, encoded), RangeError);
    }
    assert.equal(compressor.createTextureFromEncoded(65, 33,
      new Uint8Array(estimateCompressedRasterBytes(65, 33, format))), null);
    assert.equal(device.textures.length, textureCount, "invalid bytes and unsupported dimensions fail before allocation");
    assert.equal(device.buffers.length, 0);
    assert.equal(compressor.available, true, "malformed cached blocks cannot disable valid GPU compression");
    await flush();
    assert.equal(device.scopePushes, device.scopePops);
    result.texture.destroy(); compressor.dispose();
    assert(device.textures.every(texture => texture.destroyed));
    assert.equal(compressor.createTextureFromEncoded(5, 33, encoded), null);
  }

  {
    const device = makeDevice(), compressor = await WebGpuRasterCompression.create(device);
    const failures = [], failure = new Error("synthetic saved-block validation failure");
    compressor.setFailureListener(error => failures.push(error));
    device.nextValidationError = failure;
    const result = compressor.createTextureFromEncoded(5, 7,
      new Uint8Array(estimateCompressedRasterBytes(5, 7, "bc7")));
    await flush();
    assert.deepEqual(failures, [failure], "late saved-block validation enters the existing renderer recovery path");
    assert.equal(compressor.available, false);
    assert.equal(compressor.residentBytes, 0);
    assert.equal(device.buffers.length, 0);
    assert.equal(device.scopePushes, device.scopePops);
    result.texture.destroy(); compressor.dispose();
  }

  {
    const device = makeDevice({ features: ["texture-compression-bc", "texture-compression-astc"], failPipeline: "bc7" });
    const compressor = await WebGpuRasterCompression.create(device);
    assert.equal(compressor.format, "astc-4x4", "a rejected BC7 pipeline can use an advertised ASTC encoder");
    assert.equal(device.scopePushes, device.scopePops);
    compressor.dispose();
    const failed = makeDevice({ validationError: new Error("synthetic pipeline validation error") });
    assert.equal(await WebGpuRasterCompression.create(failed), null,
      "asynchronous pipeline validation errors retain the uncompressed path");
    assert.equal(failed.scopePushes, failed.scopePops);
  }

  {
    const { renderer, requests } = await createRenderer(sceneWith(smoothLayer(64, 64)), {
      advertisedFeatures: ["timestamp-query", "texture-compression-bc"], rejectOptionalFeatures: true
    });
    assert.deepEqual(requests[0].requiredFeatures, ["timestamp-query", "texture-compression-bc"]);
    assert.deepEqual(requests[1].requiredFeatures, ["timestamp-query"]);
    assert.equal(renderer.rasterCompression, null);
    renderer.configureRasterLayers(renderer.scene);
    assert.equal(renderer.rasterLayerResources[0].texture.descriptor.format, "rgba8unorm");
    renderer.dispose();
  }

  {
    const layers = [smoothLayer(1601, 1601), smoothLayer(1601, 1601), packedLayer(17, 17)];
    assert(assessRasterCompression(layers[0]).eligible);
    const scene = sceneWith(...layers), { renderer, device, requests } = await createRenderer(scene);
    assert.deepEqual(requests[0].requiredFeatures, ["texture-compression-bc"]);
    renderer.configureRasterLayers(scene);
    assert(renderer.rasterLayerResources.slice(0, 2).every(resource => resource.compressionFormat === "bc7"));
    const resource = renderer.rasterLayerResources[0], uniforms = resource.uniformBuffer.values;
    assert.deepEqual(resource.texture.descriptor.size, { width: 1604, height: 1604, depthOrArrayLayers: 1 },
      "memory pressure selects full-resolution blocks before lowering the image resolution");
    assert.deepEqual([...uniforms.subarray(0, 6)], [...layers[0].matrix]);
    assert.deepEqual([...uniforms.subarray(12, 16)], [0, 0, Math.fround(1601 / 1604), Math.fround(1601 / 1604)]);
    assert.equal(uniforms[16], 1, "compressed opaque inputs force opaque samples before applying placement opacity");
    const shader = renderer.rasterPipeline.descriptor.fragment.module.code;
    assert(shader.indexOf("imageColor.a = 1.0") < shader.indexOf("imageColor * uRaster.matrixB.z"));
    assert.equal(renderer.rasterLayerResources[2].texture.descriptor.format, "r8unorm");
    assert(residentBytes(renderer) <= automaticRasterMemoryBudget().bytes, "workspace, physical mips and uniforms fit together");
    checkCopies(device, resource.texture);
    assert.equal(layers[0].width, 1601);
    const workspace = device.textures.find(texture => texture.descriptor.label === "hepr-raster-compression-input");
    renderer.setRasterTextureResidency(false);
    assert(workspace.destroyed);
    assert.equal(renderer.rasterCompression.residentBytes, 0);
    renderer.setRasterTextureResidency(true);
    assert.equal(renderer.rasterLayerResources[0].compressionFormat, "bc7");
    assert(residentBytes(renderer) <= automaticRasterMemoryBudget().bytes);
    renderer.dispose();
    assert(device.textures.every(texture => texture.destroyed));
    assert(device.buffers.every(buffer => buffer.destroyed));
  }

  {
    const scene = sceneWith(smoothLayer(1600, 1600), smoothLayer(1600, 1600));
    const { renderer, device } = await createRenderer(scene, { failCompressedTexture: true });
    renderer.configureRasterLayers(scene);
    assert(renderer.rasterLayerResources.every(resource => resource.texture.descriptor.format === "rgba8unorm"));
    assert(renderer.rasterLayerResources.every(resource => resource.texture.descriptor.size.width < 1600),
      "a failed compressed allocation initially falls back inside its compressed allowance");
    await flush();
    assert(residentBytes(renderer) <= automaticRasterMemoryBudget().bytes);
    assert(!renderer.rasterCompression.available);
    assert(device.textures.filter(texture => texture.descriptor.label === "hepr-raster-compression-input").every(texture => texture.destroyed));
    renderer.dispose();
    assert(device.textures.every(texture => texture.destroyed));
  }

  {
    const scene = sceneWith(smoothLayer(64, 64), smoothLayer(64, 64));
    const { renderer, device } = await createRenderer(scene);
    renderer.configureRasterLayers(scene);
    const offset = device.textures.length;
    device.nextValidationError = new Error("synthetic compressed copy validation failure");
    const replacement = smoothLayer(2000, 2000);
    const prepared = renderer.prepareRasterLayerUpdates(new Map([[0, replacement]]));
    const staged = device.textures.slice(offset).filter(texture => texture.descriptor.format === "bc7-rgba-unorm");
    assert.equal(staged.length, 1);
    assert(renderer.rasterStagedBytes > 0);
    await flush();
    assert(!renderer.rasterCompression.available);
    assert(renderer.rasterLayerResources.every(resource => resource.texture.descriptor.format === "rgba8unorm"),
      "asynchronous validation failures rebuild the displayed scene from canonical pixels");
    prepared.commit(); prepared.dispose();
    assert(staged.every(texture => texture.destroyed), "commit cannot resurrect a failed staged texture");
    assert.equal(renderer.rasterStagedBytes, 0);
    assert.equal(renderer.rasterLayerResources[0].texture.descriptor.format, "rgba8unorm");
    assert(renderer.rasterLayerResources[0].texture.descriptor.size.width < 2000);
    assert(residentBytes(renderer) <= automaticRasterMemoryBudget().bytes);
    assert.equal(scene.rasterLayers[0].width, 64);
    renderer.dispose();
    assert(device.textures.every(texture => texture.destroyed));
  }

  {
    const scene = sceneWith(smoothLayer(64, 64));
    const { renderer, device } = await createRenderer(scene);
    renderer.configureRasterLayers(scene);
    device.nextValidationError = new Error("synthetic late validation failure");
    const prepared = renderer.prepareRasterLayerUpdates(new Map([[0, smoothLayer(2000, 2000)]]));
    renderer.dispose();
    const textureCount = device.textures.length;
    await flush();
    assert.equal(device.textures.length, textureCount, "late validation cannot rebuild a disposed renderer");
    prepared.dispose();
    assert.equal(renderer.rasterStagedBytes, 0);
    assert(device.textures.every(texture => texture.destroyed));
    assert(device.buffers.every(buffer => buffer.destroyed));
  }

  assert(warnings.some(message => message.includes("raster compression failed")));
  console.log("WebGPU raster compression: negotiated BC7/ASTC kernels, bounded shared bands, prepared mip uploads, block validation, opaque sampling, residency and bounded sync/async recovery passed.");
} finally {
  console.warn = warn;
  for (const [key, descriptor] of Object.entries(globals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
  hooks.deregister();
}

function smoothLayer(width, height) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4;
    data.set([100 + Math.floor(x / width * 70), 80 + Math.floor(y / height * 80),
      30 + Math.floor((x + y) / (width + height) * 100), 255], index);
  }
  return { width, height, data, opacity: .75, matrix: Float32Array.of(width, .25, .5, -height, 12, 34) };
}

function packedLayer(width, height) {
  const layer = { width, height, monochrome: {
    data: new Uint8Array(Math.ceil(width / 8) * height).fill(0xa5),
    colors: Uint8Array.of(0, 0, 0, 255, 255, 255, 255, 255)
  }, matrix: Float32Array.of(width, 0, 0, -height, 0, height) };
  return Object.defineProperty(layer, "data", { enumerable: true, get() { throw new Error("packed RGBA expansion"); } });
}

function checkCopies(device, texture) {
  const copies = device.submissions.flatMap(submission => submission.copies).filter(copy => copy.destination.texture === texture);
  assert(copies.length > 0);
  for (let mip = 0; mip < texture.descriptor.mipLevelCount; mip++) {
    const width = Math.max(1, Math.floor(texture.descriptor.size.width / 2 ** mip));
    const height = Math.max(1, Math.floor(texture.descriptor.size.height / 2 ** mip));
    const physicalWidth = Math.ceil(width / 4) * 4, physicalHeight = Math.ceil(height / 4) * 4;
    const level = copies.filter(copy => copy.destination.mipLevel === mip);
    assert.equal(level.reduce((sum, copy) => sum + copy.size.height, 0), physicalHeight);
    for (const copy of level) {
      assert.equal(copy.source.bytesPerRow % 256, 0);
      assert.equal(copy.destination.origin.y % 4, 0);
      assert.equal(copy.size.width, physicalWidth);
      assert.equal(copy.size.height % 4, 0);
      assert(copy.destination.origin.y + copy.size.height <= physicalHeight);
      assert((copy.size.height / 4 - 1) * copy.source.bytesPerRow + copy.size.width / 4 * 16 <= copy.source.buffer.descriptor.size);
    }
  }
}

function residentBytes(renderer) {
  return renderer.rasterLayerResources.reduce((sum, resource) => sum + resource.estimatedBytes, 0) +
    (renderer.rasterCompression?.residentBytes ?? 0);
}

async function flush() { await new Promise(resolve => setImmediate(resolve)); }

function makeDevice(options = {}) {
  const textures = [], buffers = [], uploads = [], submissions = [], computePipelines = [];
  const device = {
    textures, buffers, uploads, submissions, computePipelines,
    features: new Set(options.features ?? ["texture-compression-bc"]),
    limits: { maxTextureDimension2D: options.limit ?? 4096, maxStorageBufferBindingSize: 128 * 1024 * 1024 },
    scopePushes: 0, scopePops: 0, nextValidationError: options.validationError ?? null,
    queue: {
      writeTexture(destination, pixels, layout, size) {
        uploads.push({ destination, layout, size, firstPixels: [...pixels.subarray(0, 8)],
          blockBytes: destination.texture.descriptor.format === "bc7-rgba-unorm" ||
            destination.texture.descriptor.format === "astc-4x4-unorm" ? pixels.slice() : undefined });
      },
      writeBuffer(buffer, offset, values) { buffer.values = values.slice(); },
      submit(commands) {
        for (const command of commands) submissions.push(command);
      }
    },
    pushErrorScope() { this.scopePushes++; },
    async popErrorScope() {
      this.scopePops++;
      const error = this.nextValidationError; this.nextValidationError = null;
      return error;
    },
    createShaderModule: descriptor => descriptor,
    createBindGroupLayout: descriptor => descriptor,
    createPipelineLayout: descriptor => descriptor,
    createSampler: descriptor => descriptor,
    createBindGroup: descriptor => descriptor,
    createRenderPipeline: descriptor => ({ descriptor, getBindGroupLayout: index => descriptor.layout.bindGroupLayouts[index] }),
    async createComputePipelineAsync(descriptor) {
      if (options.failPipeline && descriptor.label.includes(options.failPipeline)) throw new Error("synthetic pipeline rejection");
      const pipeline = { descriptor, getBindGroupLayout: () => ({ compute: true }) };
      computePipelines.push(pipeline); return pipeline;
    },
    createCommandEncoder() {
      const copies = [], dispatches = [];
      return {
        beginComputePass() { return { setPipeline() {}, setBindGroup() {},
          dispatchWorkgroups(...args) { dispatches.push(args); }, end() {} }; },
        copyBufferToTexture(source, destination, size) { copies.push({ source, destination, size }); },
        finish() { return { copies, dispatches }; }
      };
    },
    createBuffer(descriptor) {
      const buffer = { descriptor, destroyed: false, destroy() { this.destroyed = true; },
        mapAsync() { throw new Error("CPU readback is forbidden"); } };
      buffers.push(buffer); return buffer;
    },
    createTexture(descriptor) {
      if (options.failCompressedTexture && descriptor.format === "bc7-rgba-unorm") throw new Error("synthetic compressed allocation failure");
      const texture = { descriptor, destroyed: false, createView() { return { texture: this }; },
        destroy() { this.destroyed = true; } };
      textures.push(texture); return texture;
    },
    destroy() {}
  };
  return device;
}
