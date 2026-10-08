import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
const globals = Object.fromEntries(["GPUBufferUsage", "GPUTextureUsage", "GPUShaderStage"]
  .map(key => [key, globalThis[key]]));
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 };
globalThis.GPUTextureUsage = { TEXTURE_BINDING: 1, COPY_DST: 2 };
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2 };

try {
  const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { buildPackedMonochromeMipAtlas, expandMonochromeRaster, monochromeRasterTile } = await import("../src/monochromeRaster.ts");
  const { planRasterTiles } = await import("../src/rasterTiles.ts");
  const create = (limit = 2048) => {
    const device = makeDevice(limit);
    const renderer = new WebGpuFloorplanRenderer({}, device, { configure() {}, unconfigure() {} }, "rgba8unorm");
    renderer.requestFrame = () => {};
    return { device, renderer };
  };
  const sceneWith = (...layers) => Object.assign(createEmptyVectorScene(), { rasterLayers: layers });

  {
    const layer = packedLayer(17, 17);
    const { renderer, device } = create();
    const scene = sceneWith(layer, { width: 2, height: 2, data: new Uint8Array(16).fill(255),
      matrix: Float32Array.of(2, 0, 0, -2, 0, 2), paintOrder: 1, pageIndex: 0 });
    renderer.scene = scene;
    renderer.configureRasterLayers(scene);
    const resource = renderer.rasterLayerResources[0];
    assert.equal(resource.texture.descriptor.format, "r8unorm");
    assert.deepEqual(resource.texture.descriptor.size, { width: 3, height: 17, depthOrArrayLayers: 1 });
    assert.equal(resource.texture.descriptor.mipLevelCount ?? 1, 1, "packed bytes are never averaged together");
    const packedUploads = device.uploads.filter(upload => upload.destination.texture === resource.texture);
    assert.equal(packedUploads.length, 1);
    assert.deepEqual(unpad(packedUploads[0], 1), layer.monochrome.data);
    const expectedMips = buildPackedMonochromeMipAtlas(layer.monochrome, layer.width, layer.height);
    assert.equal(resource.coverageTexture.descriptor.format, "r8unorm");
    assert.deepEqual(resource.coverageTexture.descriptor.size, { width: expectedMips.width, height: expectedMips.height, depthOrArrayLayers: 1 });
    assert.equal(resource.coverageTexture.descriptor.mipLevelCount, 1, "the atlas has no hardware mip chain");
    const mipUploads = device.uploads.filter(upload => upload.destination.texture === resource.coverageTexture);
    assert.equal(mipUploads.length, 1);
    assert.equal(mipUploads[0].destination.mipLevel, 0);
    assert.deepEqual(unpad(mipUploads[0], 1), expectedMips.data);
    const uniforms = device.writes.find(write => write.buffer === resource.uniformBuffer).values;
    assert.equal(uniforms.byteLength, 96);
    assert.equal(uniforms[7], layer.width);
    assert.deepEqual([...uniforms.subarray(16)], [128, 50, 4, 128, 3, 77, 250, 255].map(v => Math.fround(v / 255)),
      "palette colors use the RGBA path's rounded premultiplied bytes");
    assert.equal(resource.bindGroup.entries.find(entry => entry.binding === 4).resource.texture, resource.coverageTexture);
    const regular = renderer.rasterLayerResources[1];
    assert.equal(regular.texture.descriptor.format, "rgba8unorm");
    assert.equal(regular.bindGroup.entries.find(entry => entry.binding === 4).resource.texture, regular.texture);
    assert.equal(regular.coverageTexture, undefined, "ordinary images reuse their texture binding");
    const shader = renderer.rasterPipeline.descriptor.fragment.module.code;
    const fragment = shader.slice(shader.indexOf("@fragment"));
    assert(fragment.indexOf("let uvDx = dpdx(inData.uv)") < fragment.indexOf("if (uRaster.matrixB.w"),
      "derivatives are evaluated before the image-mode branch in the fragment entry point");
    assert.match(shader, /textureLoad\(uRasterTex, vec2i\(p\.x \/ 8, p\.y\), 0\)/);
    assert.match(shader, /heprPackedCoverage\(uRasterCoverageTex, size, uv, lod - 1\.0\)/);
    assert.match(shader, /imageColor \* uRaster\.matrixB\.z/);
    assert.match(shader, /color \* heprVectorClipAA/);
    renderer.setRasterTextureResidency(false);
    assert(resource.texture.destroyed && resource.coverageTexture.destroyed && resource.uniformBuffer.destroyed);
    renderer.setRasterTextureResidency(true);
    assert.notEqual(renderer.rasterLayerResources[0].coverageTexture, resource.coverageTexture);
    renderer.dispose();
    assert(device.textures.every(texture => texture.destroyed));
    assert(device.buffers.every(buffer => buffer.destroyed));
  }

  {
    const layer = packedLayer(150, 2);
    const { renderer, device } = create(64);
    const scene = sceneWith(layer);
    renderer.scene = scene;
    renderer.configureRasterLayers(scene);
    const resource = renderer.rasterLayerResources[0], tiles = [resource, ...resource.extraTiles];
    const plan = planRasterTiles(layer.width, layer.height, 64);
    assert.equal(tiles.length, plan.tiles.length);
    for (const [index, tile] of tiles.entries()) {
      const expected = monochromeRasterTile(layer.monochrome, layer.width, layer.height, plan.tiles[index]);
      const upload = device.uploads.find(upload => upload.destination.texture === tile.texture);
      assert.deepEqual(unpad(upload, 1), expected.data);
      const uniforms = device.writes.find(write => write.buffer === tile.uniformBuffer).values;
      assert.equal(uniforms[7], plan.tiles[index].width, "logical pixel width excludes packed-byte padding");
      assert.deepEqual([...uniforms.subarray(8, 16)], [...plan.tiles[index].quad, ...plan.tiles[index].uv].map(Math.fround));
    }
    renderer.dispose();
    assert(tiles.every(tile => tile.texture.destroyed && tile.coverageTexture.destroyed));
  }

  {
    const packed = packedLayer(17, 17);
    const legacy = { width: packed.width, height: packed.height, matrix: packed.matrix,
      data: expandMonochromeRaster(packed.monochrome, packed.width, packed.height), paintOrder: 0, pageIndex: 0 };
    const { renderer } = create();
    renderer.configureRasterLayers(sceneWith(legacy));
    assert.equal(renderer.rasterLayerResources[0].texture.descriptor.format, "r8unorm",
      "legacy HEP RGBA images recover compact storage when both colors are exact");
    assert.equal(legacy.monochrome, undefined, "optimization leaves the canonical scene unchanged");
    renderer.dispose();
  }

  {
    const { renderer, device } = create();
    renderer.configureRasterLayers(sceneWith(packedLayer(1, 1)));
    const resource = renderer.rasterLayerResources[0];
    const upload = device.uploads.find(value => value.destination.texture === resource.coverageTexture);
    assert.deepEqual([...unpad(upload, 1)], [240], "a one-pixel image has a valid constant packed coverage texture");
    renderer.dispose();
  }

  {
    const { renderer } = create(64);
    const layer = packedLayer(300, 300);
    const warn = console.warn, warnings = [];
    console.warn = (...args) => warnings.push(args);
    try { renderer.configureRasterLayers(sceneWith(layer)); }
    finally { console.warn = warn; }
    const resource = renderer.rasterLayerResources[0];
    assert.equal(resource.texture.descriptor.format, "rgba8unorm", "resource-limit reductions retain averaged RGBA fallback");
    assert.deepEqual(resource.texture.descriptor.size, { width: 64, height: 64, depthOrArrayLayers: 1 });
    assert.equal(resource.coverageTexture, undefined);
    assert.equal(warnings.length, 1, "reduced fidelity is reported");
    renderer.dispose();
  }

  for (const failure of ["coverage upload", "raster uniform", "raster bind group"]) {
    const { renderer, device } = create();
    const previousTextures = device.textures.length, previousBuffers = device.buffers.length;
    device.failure = failure;
    assert.throws(() => renderer.configureRasterLayers(sceneWith(packedLayer(17, 17))), /synthetic/);
    assert.equal(renderer.rasterLayerResources.length, 0);
    assert(device.textures.slice(previousTextures).every(texture => texture.destroyed),
      "failed uploads and bind-group construction release both image textures");
    assert(device.buffers.slice(previousBuffers).every(buffer => buffer.destroyed));
    renderer.dispose();
    assert(device.textures.every(texture => texture.destroyed));
  }
  {
    const { renderer, device } = create();
    renderer.configureRasterLayers(sceneWith(packedLayer(256,256)));
    const resource = renderer.rasterLayerResources[0];
    assert.equal(resource.texture.descriptor.format, "rgba8unorm");
    assert.equal(resource.coverageTexture, resource.texture);
    assert.equal(device.writes.find(write => write.buffer === resource.uniformBuffer).values[7], 256.5);
    const size = resource.texture.descriptor.size;
    assert.equal(resource.estimatedBytes, size.width * size.height * 4 + 96);
    renderer.dispose();assert.equal(resource.texture.destroyCalls, 1, "shared compact bindings destroy the atlas once");
  }
  for (const failure of ["compact upload", "raster uniform", "raster bind group"]) {
    const { renderer, device } = create();const offset = device.textures.length;device.failure = failure;
    assert.throws(() => renderer.configureRasterLayers(sceneWith(packedLayer(256,256))), /synthetic/);
    assert(device.textures.slice(offset).every(texture => texture.destroyed && texture.destroyCalls === 1));
    renderer.dispose();
  }
  console.log("WebGPU packed monochrome: byte uploads, coverage mips, premultiplied colors, lazy sources, tiles, legacy detection, limits and cleanup passed.");
} finally {
  for (const [key, value] of Object.entries(globals)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
  hooks.deregister();
}

function packedLayer(width, height) {
  const stride = Math.ceil(width / 8), data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if ((x + y) % 3 === 0) data[y * stride + (x >> 3)] |= 128 >> (x & 7);
  }
  const layer = { width, height, monochrome: { data, colors: Uint8Array.of(255, 100, 8, 128, 3, 77, 250, 255) },
    matrix: Float32Array.of(width, 0, 0, -height, 0, height), opacity: .75, paintOrder: 0, pageIndex: 0 };
  return Object.defineProperty(layer, "data", { enumerable: true, get() {
    throw new Error("native packed uploads must not read the legacy RGBA getter");
  } });
}

function makeDevice(limit) {
  const textures = [], buffers = [], uploads = [], writes = [];
  const device = {
    textures, buffers, uploads, writes, failure: null, limits: { maxTextureDimension2D: limit },
    queue: {
      writeTexture(destination, pixels, layout, dimensions) {
        if (device.failure === "compact upload" && destination.texture.descriptor.format === "rgba8unorm") throw new Error("synthetic compact upload failure");
        if (device.failure === "coverage upload" && destination.texture.descriptor.format === "r8unorm" &&
            destination.texture.descriptor.mipLevelCount) throw new Error("synthetic coverage upload failure");
        uploads.push({ destination, pixels: pixels.slice(), layout, dimensions });
      },
      writeBuffer(buffer, offset, values) { writes.push({ buffer, offset, values: values.slice() }); }
    },
    createShaderModule: descriptor => descriptor,
    createBindGroupLayout: descriptor => descriptor,
    createPipelineLayout: descriptor => descriptor,
    createSampler: descriptor => descriptor,
    createBindGroup(descriptor) {
      if (this.failure === "raster bind group" && descriptor.entries.some(entry => entry.binding === 4) &&
          descriptor.entries[1].resource.buffer?.descriptor.size === 96) throw new Error("synthetic raster bind group failure");
      return descriptor;
    },
    createRenderPipeline: descriptor => ({ descriptor, getBindGroupLayout: index => descriptor.layout.bindGroupLayouts[index] }),
    createBuffer(descriptor) {
      if (this.failure === "raster uniform" && descriptor.size === 96) throw new Error("synthetic raster uniform failure");
      const buffer = { descriptor, destroyed: false, destroy() { this.destroyed = true; } };
      buffers.push(buffer); return buffer;
    },
    createTexture(descriptor) {
      const texture = { descriptor, destroyed: false, destroyCalls: 0, createView() { return { texture: this }; },
        destroy() { this.destroyed = true; this.destroyCalls++; } };
      textures.push(texture); return texture;
    },
    destroy() {}
  };
  return device;
}

function unpad(upload, bytesPerPixel) {
  const { width, height } = upload.dimensions;
  const rowBytes = width * bytesPerPixel, stride = upload.layout.bytesPerRow ?? rowBytes;
  const pixels = new Uint8Array(rowBytes * height);
  for (let row = 0; row < height; row++) {
    pixels.set(upload.pixels.subarray(row * stride, row * stride + rowBytes), row * rowBytes);
  }
  return pixels;
}
