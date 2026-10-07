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
const warn = console.warn, warnings = [];
let createEmptyVectorScene;
console.warn = (...args) => warnings.push(args.join(" "));

const webGpu = await import("../src/threeWebGpuBackend.ts");

try {
  const { planRasterTiles, rasterTilePixels, reportRasterTileDownscale, sameRasterTilePlan, isRasterTilePlanDownscaled } =
    await import("../src/rasterTiles.ts");
  ({ createEmptyVectorScene } = await import("../src/emptyVectorScene.ts"));
  const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { ThreeMaterialRasterLayer } = await import("../src/threeMaterialRasterLayer.ts");
  const { applyThreePdfOverlayPaintOrder } = await import("../src/threePdfPaintOrder.ts");
  const { vectorDrawRunRenderOrder } = await import("../src/threeVectorDrawRuns.ts");
  const { HeprThreePdfObject } = await import("../src/threePdfObject.ts");

  // Images within the limit, or on a host without one, stay one texture.
  for (const limit of [64, Infinity, NaN]) {
    const plan = planRasterTiles(40, 64, limit);
    assert.deepEqual(plan, { width: 40, height: 64,
      tiles: [{ x: 0, y: 0, width: 40, height: 64, quad: [0, 0, 1, 1], uv: [0, 0, 1, 1] }] });
  }
  {
    const source = image(5, 3, 1);
    assert.deepEqual(rasterTilePixels(source, planRasterTiles(5, 3, 64))[0], premultiply(source.data),
      "a whole image keeps the renderers' premultiplied rounding");
  }

  // The reported sticker barcode: a 9000x1 image on WebGPU's default limit.
  {
    const plan = planRasterTiles(9000, 1, 8192);
    assert.equal(isRasterTilePlanDownscaled({ width: 9000, height: 1 }, plan), false);
    assert.deepEqual(plan.tiles.map(({ x, y, width, height }) => [x, y, width, height]),
      [[0, 0, 8128, 1], [8000, 0, 1000, 1]], "64 texel overlap on the inner side of each seam");
    assert.deepEqual(plan.tiles[0].quad, [0, 0, 8064 / 9000, 1]);
    assert.deepEqual(plan.tiles[1].quad, [8064 / 9000, 0, 1, 1]);
    assert.deepEqual(plan.tiles[0].uv, [0, 0, 8064 / 8128, 1]);
    assert.deepEqual(plan.tiles[1].uv, [64 / 1000, 0, 1, 1]);
  }

  // Seams sample exactly like the whole image, through log2(overlap) mip levels.
  for (const [width, height] of [[200, 16], [16, 200], [136, 8]]) {
    const limit = 64, gutter = 8, source = image(width, height, 2);
    const plan = planRasterTiles(width, height, limit);
    assert(plan.tiles.length > 1);
    assert.equal(plan.width, width);
    const whole = mipChain(premultiply(source.data), width, height);
    const pixels = rasterTilePixels(source, plan);
    assertCoversUnitSquare(plan);
    for (const [index, tile] of plan.tiles.entries()) {
      assert(tile.width <= limit && tile.height <= limit, "every tile fits the device");
      assert.equal(tile.x % gutter, 0); assert.equal(tile.y % gutter, 0);
      const chain = mipChain(pixels[index], tile.width, tile.height);
      const [minX, minY, maxX, maxY] = [tile.quad[0] * width, tile.quad[1] * height, tile.quad[2] * width, tile.quad[3] * height];
      assert.deepEqual([(minX - tile.x) / tile.width, (minY - tile.y) / tile.height,
        (maxX - tile.x) / tile.width, (maxY - tile.y) / tile.height], tile.uv);
      for (let level = 0; level <= Math.log2(gutter); level++) {
        const scale = 2 ** level;
        for (let x = minX; x <= maxX; x += 0.375) {
          for (let y = minY; y <= maxY; y += 0.375) {
            assert.deepEqual(bilinear(chain[level], (x - tile.x) / scale, (y - tile.y) / scale),
              bilinear(whole[level], x / scale, y / scale), `tile ${index} level ${level} at ${x},${y}`);
          }
        }
      }
    }
  }

  // Over budget: never more texels than the device's largest texture.
  {
    const plan = planRasterTiles(300, 300, 64);
    assert(isRasterTilePlanDownscaled({ width: 300, height: 300 }, plan));
    assert.deepEqual([plan.width, plan.height, plan.tiles.length], [64, 64, 1]);
    const flat = { width: 300, height: 300, data: new Uint8Array(300 * 300 * 4) };
    for (let offset = 0; offset < flat.data.length; offset += 4) flat.data.set([200, 100, 50, 255], offset);
    assert(rasterTilePixels(flat, plan)[0].every((value, offset) => value === [200, 100, 50, 255][offset % 4]),
      "a flat image stays flat");
    // Extreme strips are bounded to 16 tiles; resampling averages premultiplied color.
    const strip = { width: 384, height: 1, data: new Uint8Array(384 * 4) };
    for (let x = 0; x < 384; x++) strip.data.set(x % 2 ? [0, 0, 255, 255] : [255, 0, 0, 128], x * 4);
    const capped = planRasterTiles(384, 1, 16);
    assert.deepEqual([capped.width, capped.height, capped.tiles.length], [192, 1, 16]);
    const tiles = rasterTilePixels(strip, capped);
    assert.deepEqual([...tiles[1].subarray(8, 12)], [64, 0, 128, 192]);
    assert.equal(sameRasterTilePlan(capped, planRasterTiles(384, 1, 16)), true);
    assert.equal(sameRasterTilePlan(capped, planRasterTiles(384, 1, 32)), false);
    warnings.length = 0;
    reportRasterTileDownscale(3, strip, capped, 16);
    reportRasterTileDownscale(3, strip, capped, 16);
    reportRasterTileDownscale(4, flat, planRasterTiles(300, 300, 400), 400);
    assert.equal(warnings.length, 1, "each reduced image is reported once; full-resolution images never");
    assert.match(warnings[0], /Raster image 3 \(384x1\).*16x16.*drawing it at 192x1/);
  }

  // Native WebGPU: tiles share the image's pipeline, clip and paint slot.
  {
    const device = makeDevice(64);
    const renderer = new WebGpuFloorplanRenderer({}, device, { configure() {}, unconfigure() {} }, "rgba8unorm");
    const scene = sceneWith(image(150, 2, 3));
    renderer.scene = scene;
    renderer.requestFrame = () => {};
    renderer.vectorClipBindGroups = [{ clip: -2 }, { clip: -1 }];
    renderer.configureRasterLayers(scene);
    const plan = planRasterTiles(150, 2, 64), pixels = rasterTilePixels(scene.rasterLayers[0], plan);
    const resource = renderer.rasterLayerResources[0];
    const tiles = [resource, ...resource.extraTiles];
    assert.equal(plan.tiles.length, 4, "48 texel steps inside a 64 texel limit");
    assert.equal(tiles.length, plan.tiles.length);
    for (const [index, tile] of tiles.entries()) {
      assert.deepEqual([tile.texture.descriptor.size.width, tile.texture.descriptor.size.height],
        [plan.tiles[index].width, plan.tiles[index].height]);
      const upload = device.uploads.find(upload => upload.destination.texture === tile.texture && upload.destination.mipLevel === 0);
      assert.deepEqual(unpad(upload), pixels[index]);
      const uniforms = device.writes.find(write => write.buffer === tile.uniformBuffer).values;
      assert.deepEqual([...uniforms.subarray(0, 8)], [...scene.rasterLayers[0].matrix, 0.5, 0].map(Math.fround));
      assert.deepEqual([...uniforms.subarray(8, 16)], [...plan.tiles[index].quad, ...plan.tiles[index].uv].map(Math.fround));
    }
    const shader = renderer.rasterPipeline.descriptor.vertex.module.code;
    assert.match(shader, /select\(uRaster\.quad\.xy, uRaster\.quad\.zw, farCorner\)/, "corners select exact shared edges");
    let draws = submit(renderer);
    assert.deepEqual(draws.map(draw => draw.groups[0]), tiles.map(tile => tile.bindGroup));
    assert(draws.every(draw => draw.pipeline === renderer.rasterPipeline && draw.groups[1] === renderer.vectorClipBindGroups[1]));

    const staged = renderer.prepareRasterLayerUpdates(new Map([[0, image(100, 1, 4)]]));
    staged.commit(); staged.dispose();
    assert(tiles.every(tile => tile.texture.destroyed && tile.uniformBuffer.destroyed), "replaced tiles are released");
    draws = submit(renderer);
    assert.equal(draws.length, planRasterTiles(100, 1, 64).tiles.length, "an oversized replacement is tiled, not rejected");
    renderer.dispose();
    assert(device.textures.every(texture => texture.destroyed));
    assert(device.buffers.every(buffer => buffer.destroyed));
  }

  // WebGPU devices expose the adapter's texture limit, not the 8192 default.
  for (const [adapterLimit, expected] of [[16384, { maxTextureDimension2D: 16384 }], [8192, undefined]]) {
    let descriptor;
    const adapter = { limits: { maxTextureDimension2D: adapterLimit }, features: new Set(["timestamp-query"]),
      requestDevice: async value => { descriptor = value; return makeDevice(adapterLimit); } };
    const navigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true,
      value: { gpu: { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => "rgba8unorm" } } });
    try {
      const renderer = await WebGpuFloorplanRenderer.create({ getContext: () => ({ configure() {}, unconfigure() {} }) });
      renderer.dispose();
    } finally {
      if (navigator) Object.defineProperty(globalThis, "navigator", navigator);
      else delete globalThis.navigator;
    }
    assert.deepEqual(descriptor.requiredFeatures, ["timestamp-query"]);
    assert.deepEqual(descriptor.requiredLimits, expected);
  }

  // Native WebGL: one texture and uniform rect per tile.
  {
    const { gl, calls } = mockGl(64);
    const renderer = Object.assign(Object.create(WebGlFloorplanRenderer.prototype), {
      gl, isDisposed: false, rasterLayers: [], rasterStripBatches: new Map(), rasterLayerUpdates: new Map(),
      orderedTextureBindings: [], multiplyPass: null, frameDrawCalls: 0,
      uRasterOpacity: "uRasterOpacity", uRasterMatrixABCD: "uRasterMatrixABCD", uRasterMatrixEF: "uRasterMatrixEF",
      uRasterQuad: "uRasterQuad", uRasterUv: "uRasterUv"
    });
    const scene = Object.assign(sceneWith(image(150, 2, 5)), { rasterLayers: [image(150, 2, 5), image(4, 4, 6)] });
    renderer.uploadRasterLayers(scene);
    const plan = planRasterTiles(150, 2, 64), pixels = rasterTilePixels(scene.rasterLayers[0], plan);
    const uploads = calls.filter(call => call[0] === "texImage2D");
    assert.deepEqual(uploads.map(call => [call[4], call[5]]), [...plan.tiles.map(tile => [tile.width, tile.height]), [4, 4]]);
    uploads.slice(0, plan.tiles.length).forEach((call, index) => assert.deepEqual(call.at(-1), pixels[index]));
    assert.equal(calls.filter(call => call[0] === "generateMipmap").length, plan.tiles.length + 1, "each tile has its own mip chain");
    calls.length = 0;
    renderer.drawRasterLayerAtIndex(0, 100, 100, 0, 0, 1, true);
    renderer.drawRasterLayerAtIndex(1, 100, 100, 0, 0, 1, true);
    const draws = [];
    let quad, uv, unit, texture;
    for (const call of calls) {
      if (call[0] === "activeTexture") unit = call[1] - 1000;
      if (call[0] === "bindTexture" && unit === 12) texture = call[2];
      if (call[0] === "uniform4fv") call[1] === "uRasterQuad" ? quad = [...call[2]] : uv = [...call[2]];
      if (call[0] === "drawArrays") draws.push({ texture, quad, uv });
    }
    const layer = renderer.rasterLayers[0];
    assert.deepEqual(draws.map(draw => draw.texture), [layer.texture, ...layer.extraTiles.map(tile => tile.texture),
      renderer.rasterLayers[1].texture]);
    assert.deepEqual(draws.map(draw => [draw.quad, draw.uv]), [
      ...plan.tiles.map(tile => [[...tile.quad].map(Math.fround), [...tile.uv].map(Math.fround)]),
      [[0, 0, 1, 1], [0, 0, 1, 1]]], "a whole image after a tiled one resets its rects");
    renderer.destroyRasterLayerTextures();
    assert.equal(calls.filter(call => call[0] === "deleteTexture").length, plan.tiles.length + 1);
  }

  // Three: tiles follow the host's limit and paint with their image.
  for (const backend of ["webgl", "webgpu"]) {
    const scene = Object.assign(sceneWith(image(150, 2, 7)), { pageRects: Float32Array.of(0, 0, 200, 200),
      drawRuns: [{ kind: "fill", first: 0, count: 1 }, { kind: "raster", first: 0, count: 1, blendMode: "Multiply" }] });
    const layer = new ThreeMaterialRasterLayer(scene, { materialBackend: backend, webGpu, colorCompositing: "display",
      pageBackground: [1, 1, 1, 1] });
    const entry = layer.rasterEntries[0];
    assert.equal(entry.image.tiles.length, 0, "before a host reports its limit, images stay whole");
    assert.equal(layer.getMaxRasterTextureDimension(), 150);
    const whole = entry.texture;
    let disposed = 0;
    whole.addEventListener("dispose", () => disposed++);
    HeprThreePdfObject.prototype.hostSupportsRasterTextures.call({ rasterMaterialLayer: layer },
      backend === "webgl" ? { isWebGLRenderer: true, capabilities: { maxTextureSize: 64 } }
        : { isWebGPURenderer: true, backend: { device: { limits: { maxTextureDimension2D: 64 } } } });
    assert.equal(layer.getMaxRasterTextureDimension(), 64, "the host check tiles before the first upload");
    assert.equal(disposed, 1, "the whole-image texture is released");
    const plan = planRasterTiles(150, 2, 64), pixels = rasterTilePixels(scene.rasterLayers[0], plan);
    const textures = [entry.texture, ...entry.image.tiles.map(tile => tile.texture)];
    assert.equal(textures.length, plan.tiles.length);
    textures.forEach((texture, index) => assert.deepEqual(texture.image.data, pixels[index]));
    for (const [index, tile] of [entry, ...entry.image.tiles].entries()) {
      if (backend === "webgl") {
        assert.deepEqual(tile.material.uniforms.uRasterQuad.value.toArray(), plan.tiles[index].quad);
        assert.deepEqual(tile.material.uniforms.uRasterUv.value.toArray(), plan.tiles[index].uv);
        assert.equal(tile.material.uniforms.uRasterTex.value, textures[index]);
      }
      if (index > 0) {
        assert.equal(tile.mesh.parent, entry.mesh, "tiles inherit their image's visibility");
        assert.deepEqual(tile.mesh.userData.heprDrawRun, entry.mesh.userData.heprDrawRun, "compositing draws every tile");
      }
    }
    applyThreePdfOverlayPaintOrder(scene, layer.group, []);
    const order = item => vectorDrawRunRenderOrder(item, scene.drawRuns.length);
    for (const tile of [entry, ...entry.image.tiles]) {
      assert.equal(tile.mesh.renderOrder, order(1));
      const completion = tile.mesh.children.find(child => child.userData.heprMultiplyCompletion);
      assert.equal(completion.renderOrder, order(1.5), "each tile's Multiply completion follows its first pass");
    }

    layer.setTextureResidency(true);
    assert(entry.mesh.visible);
    const versions = textures.map(texture => texture.version);
    layer.setTextureResidency(false);
    layer.setTextureResidency(true);
    assert(textures.every((texture, index) => texture.version > versions[index]), "every tile re-uploads after eviction");

    // A replacement that fits drops the extra tiles; reporting the same limit changes nothing.
    const released = new Set();
    for (const texture of textures) texture.addEventListener("dispose", () => released.add(texture));
    const staged = layer.prepareRasterLayerUpdates(new Map([[0, image(40, 40, 8)]]));
    staged.commit();
    assert(textures.every(texture => released.has(texture)), "replaced tiles are released");
    assert.equal(entry.image.tiles.length, 0);
    assert.equal(entry.mesh.children.filter(child => child.userData.heprRasterTile).length, 0);
    assert.equal(layer.entries.length, 2, "the background and the one image remain");
    assert.equal(layer.getMaxRasterTextureDimension(), 40);
    layer.setMaxTextureSize(64);
    assert.equal(entry.image.tiles.length, 0);
    if (backend === "webgl") assert.deepEqual(entry.material.uniforms.uRasterQuad.value.toArray(), [0, 0, 1, 1]);
    const replacement = entry.texture;
    replacement.addEventListener("dispose", () => released.add(replacement));
    layer.dispose();
    assert(released.has(replacement));
  }
  console.log("Raster tiles: plans, exact seams through mip levels, budget resampling, WebGPU/WebGL/Three upload, draw, paint order, updates and cleanup passed.");
} finally {
  console.warn = warn;
  for (const [key, value] of Object.entries(globals)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
  hooks.deregister();
}

function image(width, height, seed) {
  const data = Uint8Array.from({ length: width * height * 4 }, (_, offset) =>
    offset % 4 === 3 ? [255, 0, 128, 37][(offset >> 2) % 4] : (offset * 31 + seed * 17) % 256);
  return { width, height, data, matrix: Float32Array.of(width / 10, 0.25, -0.5, -height, 3, 9), opacity: 0.5,
    pageIndex: 0, paintOrder: 0 };
}

function sceneWith(layer) {
  return Object.assign(createEmptyVectorScene(), { rasterLayers: [layer], drawRuns: [{ kind: "raster", first: 0, count: 1 }] });
}

function premultiply(data) {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 0) continue;
    for (let channel = 0; channel < 3; channel++) out[i + channel] = alpha === 255 ? data[i + channel] : Math.round(data[i + channel] * (alpha / 255));
    out[i + 3] = alpha;
  }
  return out;
}

// The WebGPU renderer's CPU box filter.
function mipChain(data, width, height) {
  const chain = [{ data, width, height }];
  while (width > 1 || height > 1) {
    const nextWidth = Math.max(1, width >> 1), nextHeight = Math.max(1, height >> 1);
    const next = new Uint8Array(nextWidth * nextHeight * 4);
    for (let y = 0; y < nextHeight; y++) {
      const y0 = Math.min(height - 1, y * 2), y1 = Math.min(height - 1, y0 + 1);
      for (let x = 0; x < nextWidth; x++) {
        const x0 = Math.min(width - 1, x * 2), x1 = Math.min(width - 1, x0 + 1);
        for (let channel = 0; channel < 4; channel++) {
          next[(y * nextWidth + x) * 4 + channel] = (data[(y0 * width + x0) * 4 + channel] + data[(y0 * width + x1) * 4 + channel] +
            data[(y1 * width + x0) * 4 + channel] + data[(y1 * width + x1) * 4 + channel] + 2) >> 2;
        }
      }
    }
    chain.push({ data: next, width: nextWidth, height: nextHeight });
    ({ data, width, height } = chain.at(-1));
  }
  return chain;
}

// Clamp-to-edge linear filtering at a position in texels.
function bilinear(level, x, y) {
  const fx = x - 0.5, fy = y - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const texel = (column, row) => (Math.min(level.height - 1, Math.max(0, row)) * level.width +
    Math.min(level.width - 1, Math.max(0, column))) * 4;
  return [0, 1, 2, 3].map(channel => {
    const at = (column, row) => level.data[texel(column, row) + channel];
    return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
  });
}

function assertCoversUnitSquare(plan) {
  for (const [min, max] of [[0, 2], [1, 3]]) {
    const spans = [...new Map(plan.tiles.map(tile => [tile.quad[min], tile.quad[max]])).entries()].sort((a, b) => a[0] - b[0]);
    assert.equal(spans[0][0], 0);
    assert.equal(spans.at(-1)[1], 1);
    // Shared edges are the same float32 value on both sides: no cracks, no double blending.
    for (let index = 1; index < spans.length; index++) assert.equal(Math.fround(spans[index][0]), Math.fround(spans[index - 1][1]));
  }
}

function makeDevice(maxTextureDimension2D) {
  const textures = [], buffers = [], uploads = [], writes = [];
  return {
    textures, buffers, uploads, writes,
    limits: { maxTextureDimension2D },
    queue: {
      writeTexture(destination, pixels, layout, dimensions) { uploads.push({ destination, pixels: pixels.slice(), layout, dimensions }); },
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
      const texture = { descriptor, destroyed: false, createView() { return { texture: this }; }, destroy() { this.destroyed = true; } };
      textures.push(texture); return texture;
    },
    destroy() {}
  };
}

function submit(renderer) {
  const draws = [], groups = [];
  let pipeline;
  renderer.drawSourceOrderedContentIntoPass({
    setPipeline(value) { pipeline = value; },
    setBindGroup(index, value) { groups[index] = value; },
    draw(...args) { draws.push({ pipeline, groups: groups.slice(), args }); }
  });
  return draws;
}

function unpad(upload) {
  const { width, height } = upload.dimensions;
  const stride = upload.layout.bytesPerRow ?? width * 4;
  const result = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) result.set(upload.pixels.subarray(row * stride, row * stride + width * 4), row * width * 4);
  return result;
}

function mockGl(maxTextureSize) {
  const calls = [];
  let nextId = 0;
  const gl = new Proxy({ TEXTURE0: 1000, MAX_TEXTURE_SIZE: "MAX_TEXTURE_SIZE" }, { get(target, name) {
    if (name in target) return target[name];
    if (name.toUpperCase() === name) return name;
    return (...args) => {
      calls.push([name, ...args]);
      if (name === "getParameter") return args[0] === "MAX_TEXTURE_SIZE" ? maxTextureSize : 0;
      if (name === "createTexture") return { id: ++nextId };
    };
  } });
  return { gl, calls };
}
