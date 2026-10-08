import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
const globals = Object.fromEntries(["GPUBufferUsage", "GPUTextureUsage", "GPUShaderStage", "navigator"]
  .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 };
globalThis.GPUTextureUsage = { TEXTURE_BINDING: 1, COPY_DST: 2 };
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2 };
const warnings = [], warn = console.warn;
console.warn = (...args) => warnings.push(args.join(" "));

try {
  const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { automaticRasterMemoryBudget } = await import("../src/rasterMemoryBudget.ts");
  const { buildRasterStripBatches } = await import("../src/rasterStripBatches.ts");
  const { RasterResolutionPlanner } = await import("../src/rasterResolution.ts");
  const sceneWith = (...layers) => Object.assign(createEmptyVectorScene(), { rasterLayers: layers });
  const create = scene => {
    const device = makeDevice();
    const renderer = new WebGpuFloorplanRenderer({}, device, { configure() {}, unconfigure() {} }, "rgba8unorm");
    renderer.scene = scene;
    renderer.requestFrame = () => {};
    return { device, renderer };
  };

  setMemoryHint(.25);
  const budget = automaticRasterMemoryBudget();
  assert.equal(budget.bytes, 16 * 1024 * 1024);
  assert.equal(budget.peakBytes, budget.bytes * 2);

  {
    const layers = [colorLayer(1600, 1600), colorLayer(1600, 1600), packedLayer(17, 17)];
    const scene = sceneWith(...layers), { renderer, device } = create(scene);
    const originalMatrix = layers[0].matrix.slice(), originalPixels = layers[0].data;
    renderer.configureRasterLayers(scene);
    const resources = renderer.rasterLayerResources;
    assert(resources[0].texture.descriptor.size.width < 1600,
      "aggregate demand reduces images that fit the device individually");
    assert.equal(resources[0].texture.descriptor.size.width, resources[1].texture.descriptor.size.width);
    assert.equal(resources[2].texture.descriptor.format, "r8unorm");
    assert.deepEqual(resources[2].texture.descriptor.size, { width: 3, height: 17, depthOrArrayLayers: 1 },
      "fitting binary images retain their exact packed resolution");
    for (const resource of resources) assert.equal(resource.estimatedBytes, layerBytes(resource));
    assert(residentBytes(renderer) <= budget.bytes, "textures, mips and raster uniforms fit together");
    const uniform = device.writes.find(write => write.buffer === resources[0].uniformBuffer).values;
    assert.deepEqual([...uniform.subarray(0, 6)], [...originalMatrix], "reduction keeps original placement");
    assert.equal(layers[0].data, originalPixels);
    assert.equal(layers[0].width, 1600);
    assert.deepEqual(layers[0].matrix, originalMatrix);
    assert(warnings.some(message => message.includes("reported device RAM") && message.includes("not measured VRAM")));
    assert.equal(renderer.rasterStripResources.size, 0);
    renderer.setRasterTextureResidency(false);
    assert.equal(residentBytes(renderer), 0);
    assert(resources.every(resource => resource.texture.destroyed));
    renderer.setRasterTextureResidency(true);
    assert(residentBytes(renderer) <= budget.bytes);
    assert.equal(renderer.rasterLayerResources[2].texture.descriptor.format, "r8unorm");
    renderer.dispose();
    assert(device.textures.every(texture => texture.destroyed));
  }

  {
    setMemoryHint(undefined);
    const scene = sceneWith(colorLayer(1600, 1600)), { renderer } = create(scene);
    renderer.configureRasterLayers(scene);
    assert.equal(automaticRasterMemoryBudget().source, "fallback");
    assert.equal(renderer.rasterLayerResources[0].texture.descriptor.size.width, 1600,
      "missing telemetry uses the automatic fallback without reducing a fitting scene");
    renderer.dispose();
    setMemoryHint(.25);
  }

  {
    const scene = sceneWith(colorLayer(24, 24), colorLayer(24, 24), packedLayer(17, 17));
    const { renderer, device } = create(scene);
    renderer.configureRasterLayers(scene);
    const old = renderer.rasterLayerResources.slice(), packed = old[2];
    const firstOffset = device.textures.length;
    const first = renderer.prepareRasterLayerUpdates(new Map([[0, colorLayer(1600, 1600)]]));
    const firstTextures = device.textures.slice(firstOffset), firstReservation = renderer.rasterStagedBytes;
    assert(firstReservation > 10 * 1024 * 1024);
    const secondOffset = device.textures.length;
    const second = renderer.prepareRasterLayerUpdates(new Map([[1, colorLayer(1600, 1600)]]));
    const secondTextures = device.textures.slice(secondOffset);
    assert(secondTextures[0].descriptor.size.width < firstTextures[0].descriptor.size.width,
      "pending updates reserve the same final budget instead of claiming it twice");
    assert(residentBytes(renderer) + renderer.rasterStagedBytes <= budget.peakBytes,
      "all concurrent old and new textures stay within the staging allowance");
    assert.deepEqual(renderer.rasterLayerResources, old, "preparation leaves displayed resources intact");
    second.commit(); second.dispose();
    assert.equal(renderer.rasterStagedBytes, firstReservation);
    first.commit(); first.dispose();
    assert.equal(renderer.rasterStagedBytes, 0);
    assert(residentBytes(renderer) <= budget.bytes);
    assert.equal(renderer.rasterLayerResources[2], packed, "unchanged sources preserve their resources and quality");
    assert(old.slice(0, 2).every(resource => resource.texture.destroyed ||
      [...renderer.rasterResourceCache.entries.values()].some(entry => entry.resource === resource)),
      "every retired resource is either cached or released under memory pressure");
    assert.equal(scene.rasterLayers[0].width, 24, "updates preserve the canonical document");

    const cancelOffset = device.textures.length;
    const cancelled = renderer.prepareRasterLayerUpdates(new Map([[0, colorLayer(1600, 1600)]]));
    assert(renderer.rasterStagedBytes > 0);
    cancelled.dispose();
    assert.equal(renderer.rasterStagedBytes, 0);
    assert(device.textures.slice(cancelOffset).every(texture => texture.destroyed));
    const retry = renderer.prepareRasterLayerUpdates(new Map([[0, colorLayer(1600, 1600)]]));
    assert(renderer.rasterStagedBytes > 0, "cancellation releases the reservation for later work");
    retry.dispose();
    assert.equal(renderer.rasterStagedBytes, 0);

    const failureOffset = device.textures.length;
    const current = renderer.rasterLayerResources.slice();
    device.failAtTexture = failureOffset + 2;
    assert.throws(() => renderer.prepareRasterLayerUpdates(new Map([
      [0, colorLayer(1600, 1600)], [1, colorLayer(1600, 1600)]
    ])), /synthetic allocation/);
    device.failAtTexture = null;
    assert.equal(renderer.rasterStagedBytes, 0, "partial staging failures release every reservation");
    assert(device.textures.slice(failureOffset).every(texture => texture.destroyed));
    assert.deepEqual(renderer.rasterLayerResources, current);
    renderer.dispose();
    assert(device.textures.every(texture => texture.destroyed));
  }

  {
    const scene = sceneWith(colorLayer(1771, 1771), ...Array.from({ length: 4 }, () => colorLayer(1024, 1)));
    scene.drawRuns = [{ kind: "raster", first: 1, count: 4 }];
    assert.equal(buildRasterStripBatches(scene, 4096).length, 1, "the strips otherwise qualify for batching");
    const { renderer } = create(scene);
    renderer.configureRasterLayers(scene);
    assert.equal(renderer.rasterLayerResources[0].texture.descriptor.size.width, 1771,
      "the canonical scene fits at original resolution");
    assert.equal(renderer.rasterStripResources.size, 0,
      "duplicate batching allocations are skipped when the remaining target cannot hold them");
    assert(residentBytes(renderer) <= budget.bytes);
    renderer.dispose();
  }

  {
    const scene = sceneWith(packedLayer(1024, 1024)), { renderer, device } = create(scene);
    renderer.rasterResolutionPlanner = new RasterResolutionPlanner();
    Object.assign(renderer.canvas, { width: 512, height: 512 });
    Object.assign(renderer, { cameraCenterX: 512, cameraCenterY: 512, zoom: .1 });
    renderer.configureRasterLayers(scene);
    let displayed = renderer.rasterLayerResources[0];
    const previewTexture = displayed.texture;
    assert.equal(displayed.rasterPlan.width, 128);
    assert.equal(displayed.texture.descriptor.format, "r8unorm");
    assert.equal(displayed.coverageTexture, undefined, "a reduced scan needs one R8 coverage chain only");
    assert(device.writes.find(write => write.buffer === displayed.uniformBuffer).values[7] < 0, "shader receives the coverage-only mode");
    assert.equal(displayed.estimatedBytes, layerBytes(displayed));
    const beforeStale = device.textures.length;
    renderer.zoom = 1; renderer.updateRasterResolution();
    renderer.zoom = .1; renderer.updateRasterResolution();
    while (renderer.rasterPreparationRunning) await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(device.textures.length, beforeStale, "obsolete refinement is discarded after zoom-out");
    renderer.zoom = 1; await refine(renderer);
    displayed = renderer.rasterLayerResources[0];
    assert.equal(displayed.rasterPlan.width, 1024);
    assert(!previewTexture.destroyed, "the previous tier remains warm");
    assert(displayed.coverageTexture, "full detail restores packed pixels with filtered coverage mips");
    assert(device.writes.find(write => write.buffer === displayed.uniformBuffer).values[7] > 0);
    assert.equal(displayed.estimatedBytes, layerBytes(displayed));
    const uploads = device.textures.length;
    await refine(renderer);
    assert.equal(device.textures.length, uploads);
    renderer.cameraCenterX = 10000; await refine(renderer);
    displayed = renderer.rasterLayerResources[0];
    assert.equal(displayed.rasterPlan.width, 128);
    renderer.cameraCenterX = 512;
    renderer.rasterResourceCache.clear();
    device.failAtTexture = device.textures.length + 1;
    await refine(renderer);
    assert.equal(renderer.rasterLayerResources[0], displayed, "failed promotion retains the working preview");
    device.failAtTexture = null;
    await refine(renderer);
    assert.equal(renderer.rasterLayerResources[0], displayed, "failed tier does not retry on every frame");
    renderer.zoom = .3; await refine(renderer);
    assert.equal(renderer.rasterLayerResources[0].rasterPlan.width, 512, "a different requested tier can still refine");
    renderer.dispose();
    assert(device.textures.every(texture => texture.destroyed));
  }
  // Async staging reserves the whole batch before yielding and consumes matching prepared plans.
  {
    const scene = sceneWith(colorLayer(24, 24), colorLayer(24, 24)), { renderer, device } = create(scene);
    renderer.configureRasterLayers(scene);
    const old = renderer.rasterLayerResources.slice(), createResource = renderer.createRasterLayerResource.bind(renderer);
    let preparedUploads = 0, ticks = 0;
    renderer.createRasterLayerResource = (source, index, plan, format, prepared) => {
      assert(prepared); assert.deepEqual(prepared.plan, plan); preparedUploads++;
      return createResource(source, index, plan, format, prepared);
    };
    const timer = setInterval(() => ticks++, 0);
    const pending = renderer.prepareRasterLayerUpdatesAsync(new Map([[0, colorLayer(1600, 1600)], [1, colorLayer(1600, 1600)]]));
    assert(renderer.rasterStagedBytes > 0, "the complete asynchronous batch reserves its budget immediately");
    assert.deepEqual(renderer.rasterLayerResources, old);
    const transaction = await pending; clearInterval(timer);
    assert(ticks > 0); assert.equal(preparedUploads, 2);
    assert.deepEqual(renderer.rasterLayerResources, old, "completed uploads remain hidden until commit");
    assert(residentBytes(renderer) + renderer.rasterStagedBytes <= budget.peakBytes);
    transaction.commit(); transaction.dispose(); assert.equal(renderer.rasterStagedBytes, 0);
    assert(residentBytes(renderer) <= budget.bytes);
    renderer.dispose(); assert(device.textures.every(texture => texture.destroyed));
  }
  console.log("WebGPU automatic raster budget: aggregate demand, packed preservation, fallback telemetry, placement, residency, concurrent updates, cleanup, duplicate batches and demand-driven R8/packed allocations passed.");
} finally {
  console.warn = warn;
  for (const [key, descriptor] of Object.entries(globals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
  hooks.deregister();
}

function setMemoryHint(deviceMemory) {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { deviceMemory } });
}

function colorLayer(width, height) {
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    data[index * 4 + index % 3] = 255;
    data[index * 4 + 3] = 255;
  }
  return { width, height, data, matrix: Float32Array.of(width, .25, .5, -height, 12, 34) };
}

function packedLayer(width, height) {
  const data = new Uint8Array(Math.ceil(width / 8) * height).fill(0xa5);
  const layer = { width, height, monochrome: { data, colors: Uint8Array.of(0, 0, 0, 255, 255, 255, 255, 255) },
    matrix: Float32Array.of(width, 0, 0, -height, 0, height) };
  return Object.defineProperty(layer, "data", { enumerable: true, get() {
    throw new Error("memory planning and upload must preserve packed sources without expanding RGBA");
  } });
}

function textureBytes(texture) {
  const { size, format, mipLevelCount = 1 } = texture.descriptor;
  let width = size.width, height = size.height, bytes = 0;
  for (let level = 0; level < mipLevelCount; level++) {
    bytes += width * height * (format === "r8unorm" ? 1 : 4);
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
  }
  return bytes;
}

function layerBytes(layer) {
  return [layer, ...layer.extraTiles ?? []].reduce((sum, tile) => sum + textureBytes(tile.texture) +
    (tile.coverageTexture ? textureBytes(tile.coverageTexture) : 0) + tile.uniformBuffer.descriptor.size, 0);
}

function residentBytes(renderer) {
  return renderer.rasterLayerResources.reduce((sum, layer) => sum + layerBytes(layer), 0) + (renderer.rasterResourceCache?.bytes ?? 0) +
    [...renderer.rasterStripResources.values()].reduce((sum, strip) => sum + textureBytes(strip.texture) +
      strip.instanceBuffer.descriptor.size, 0);
}

function makeDevice() {
  const textures = [], buffers = [], writes = [];
  return {
    textures, buffers, writes, failAtTexture: null, limits: { maxTextureDimension2D: 4096 },
    queue: {
      writeTexture() {},
      writeBuffer(buffer, offset, values) { writes.push({ buffer, offset, values: values.slice() }); }
    },
    createShaderModule: descriptor => descriptor,
    createBindGroupLayout: descriptor => descriptor,
    createPipelineLayout: descriptor => descriptor,
    createSampler: descriptor => descriptor,
    createBindGroup: descriptor => descriptor,
    createRenderPipeline: descriptor => ({ descriptor, getBindGroupLayout: index => descriptor.layout.bindGroupLayouts[index] }),
    createBuffer(descriptor) {
      const buffer = { descriptor, destroyed: false, destroy() { this.destroyed = true; } };
      buffers.push(buffer); return buffer;
    },
    createTexture(descriptor) {
      if (this.failAtTexture === textures.length + 1) throw new Error("synthetic allocation failure");
      const texture = { descriptor, destroyed: false, createView() { return { texture: this }; },
        destroy() { this.destroyed = true; } };
      textures.push(texture); return texture;
    },
    destroy() {}
  };
}

async function refine(renderer) {
  renderer.updateRasterResolution();
  while (renderer.rasterPreparationRunning) await new Promise(resolve => setTimeout(resolve, 0));
}
