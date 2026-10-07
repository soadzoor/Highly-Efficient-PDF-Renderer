import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(s, c, next) {
  return next(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });

try {
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { createMonochromeRasterLayer, expandMonochromeRaster } = await import("../src/monochromeRaster.ts");
  const { monochromeRasterFragmentGlsl } = await import("../src/monochromeRasterWebGlShader.ts");
  const { RASTER_FRAGMENT_SHADER_SOURCE } = await import("../src/nativeWebGlCoreShaders.ts");
  const mono = { data: Uint8Array.of(0x80, 0x80, 0x55, 0), colors: Uint8Array.of(0, 0, 0, 0, 100, 50, 25, 128) };
  let expanded = 0;
  const layer = {
    width: 9, height: 2, monochrome: mono,
    get data() { expanded++; return expandMonochromeRaster(mono, 9, 2); },
    matrix: Float32Array.of(9, 0, 0, 2, 0, 0), paintOrder: 0, pageIndex: 0
  };
  const { renderer, mock } = makeRenderer(WebGlFloorplanRenderer, 64);
  const sources = renderer.getSceneRasterLayers({ rasterLayers: [layer] });
  assert.equal(expanded, 0, "collecting packed sources does not materialize legacy RGBA");
  const gpu = renderer.createRasterLayerGpu(sources[0], 0);
  assert.equal(expanded, 0, "packed uploads and mip construction keep RGBA lazy");
  assert.equal(gpu.monochrome.width, 9);
  assert.equal(gpu.monochrome.height, 2);
  const uploads = mock.calls.filter(call => call[0] === "texImage2D");
  assert.deepEqual(uploads.map(call => [call[3], call[4], call[5]]), [["R8", 2, 2], ["R8", 4, 1], ["R8", 2, 1], ["R8", 1, 1]],
    "base rows contain eight bits per byte and minification uses coverage mips");
  assert.deepEqual(uploads[0].at(-1), mono.data);
  assert.equal(mock.calls.filter(call => call[0] === "generateMipmap").length, 0);
  assert.deepEqual(Array.from(gpu.monochrome.colors), Array.from(Float32Array.of(0, 0, 0, 0, 50 / 255, 25 / 255, 13 / 255, 128 / 255)),
    "palette uses the existing rounded premultiplied-alpha convention");
  renderer.drawRasterTile(gpu);
  assert(mock.calls.some(call => call[0] === "uniform1f" && call[1] === "uRasterMonochrome" && call[2] === 1));
  assert.equal(mock.bindings.get(12), gpu.texture);
  assert.equal(mock.bindings.get(13), gpu.monochrome.mipTexture);
  renderer.deleteRasterLayerTextures(gpu);
  assert.equal(mock.alive.size, 0, "both packed and coverage textures are destroyed");

  const single = renderer.createRasterLayerGpu(createMonochromeRasterLayer({ width: 1, height: 1,
    matrix: layer.matrix, paintOrder: 0, pageIndex: 0 }, { data: Uint8Array.of(128), colors: mono.colors }), 0);
  assert.equal(mock.calls.filter(call => call[0] === "texImage2D").at(-1).at(-1)[0], 255,
    "a single source pixel supplies a complete coverage sampler");
  renderer.deleteRasterLayerTextures(single);

  const tiled = makeRenderer(WebGlFloorplanRenderer, 32);
  const wide = createMonochromeRasterLayer({ width: 78, height: 1, matrix: layer.matrix, paintOrder: 0, pageIndex: 0 },
    { data: Uint8Array.from({ length: 10 }, () => 0x55), colors: mono.colors });
  const tiledGpu = tiled.renderer.createRasterLayerGpu(wide, 0);
  assert(tiledGpu.extraTiles.length > 0);
  assert([tiledGpu, ...tiledGpu.extraTiles].every(tile => tile.monochrome && tile.quad && tile.uv),
    "tiling preserves packed storage, overlap UVs and placement quads");
  tiled.renderer.deleteRasterLayerTextures(tiledGpu);
  assert.equal(tiled.mock.alive.size, 0);

  const oversized = createMonochromeRasterLayer({ width: 48, height: 48, matrix: layer.matrix, paintOrder: 0, pageIndex: 0 },
    { data: Uint8Array.from({ length: 6 * 48 }, () => 0x55), colors: Uint8Array.of(0, 0, 0, 255, 255, 255, 255, 255) });
  const previousWarn = console.warn, warnings = [];
  let downscaled;
  console.warn = (...args) => warnings.push(args);
  try { downscaled = tiled.renderer.createRasterLayerGpu(oversized, 0); }
  finally { console.warn = previousWarn; }
  assert.equal(downscaled.monochrome, undefined, "resource-limit downscaling retains the area-averaged RGBA fallback");
  assert.equal(warnings.length, 1, "reduced image resolution remains diagnostic");
  assert.deepEqual(tiled.mock.calls.filter(call => call[0] === "texImage2D").at(-1).slice(3, 6), ["RGBA", 32, 32]);
  tiled.renderer.deleteRasterLayerTextures(downscaled);
  assert.equal(tiled.mock.alive.size, 0);

  const legacy = { width: 32, height: 8, matrix: layer.matrix, paintOrder: 0, pageIndex: 0,
    data: Uint8Array.from({ length: 32 * 8 * 4 }, (_, index) => index % 4 === 3 ? 255 : Math.floor(index / 4) % 2 * 255) };
  const recovered = renderer.createRasterLayerGpu(legacy, 0);
  assert(recovered.monochrome, "lossless legacy HEP RGBA recovers packed GPU storage");
  renderer.deleteRasterLayerTextures(recovered);
  const rgba = renderer.createRasterLayerGpu({ ...legacy, width: 1, height: 1, data: Uint8Array.of(255, 100, 50, 128) }, 0);
  assert.equal(rgba.monochrome, undefined);
  renderer.drawRasterTile(rgba);
  assert.equal(mock.bindings.get(13), rgba.texture, "ordinary RGBA keeps the second sampler complete");
  assert(mock.calls.some(call => call[0] === "uniform1f" && call[1] === "uRasterMonochrome" && call[2] === 0));
  renderer.deleteRasterLayerTextures(rgba);

  const failed = makeRenderer(WebGlFloorplanRenderer, 64);
  failed.mock.failTexture = 2;
  assert.throws(() => failed.renderer.createRasterLayerGpu(layer, 0), /texture/i);
  assert.equal(failed.mock.alive.size, 0, "failed coverage texture creation releases the packed texture");
  const uploadFailed = makeRenderer(WebGlFloorplanRenderer, 64);
  uploadFailed.mock.failUpload = 2;
  assert.throws(() => uploadFailed.renderer.createRasterLayerGpu(layer, 0), /upload/i);
  assert.equal(uploadFailed.mock.alive.size, 0, "failed mip upload releases both textures");
  assert.deepEqual(uploadFailed.mock.calls.filter(call => call[0] === "pixelStorei").at(-1), ["pixelStorei", "UNPACK_ALIGNMENT", 4]);

  const shader = monochromeRasterFragmentGlsl(RASTER_FRAGMENT_SHADER_SOURCE);
  assert(shader.includes("heprRasterColor(vUv, dFdx(vUv), dFdy(vUv))"));
  assert(shader.includes("heprVectorClipAA(vWorld, clipAAWidth)"));
  assert(shader.includes("textureLod(uRasterMonoMips"));
  assert(!RASTER_FRAGMENT_SHADER_SOURCE.includes("uRasterMonochrome"), "page background keeps the existing shader");
} finally {
  hooks.deregister();
}

console.log("WebGL packed monochrome raster tests passed");

function makeRenderer(Renderer, limit) {
  const calls = [], alive = new Set(), bindings = new Map();
  let textures = 0, uploads = 0, active = 0;
  const mock = { calls, alive, bindings, failTexture: -1, failUpload: -1 };
  const gl = new Proxy({ TEXTURE0: 1000 }, { get(target, name) {
    if (name in target) return target[name];
    if (name.toUpperCase() === name) return name;
    return (...args) => {
      calls.push([name, ...args]);
      if (name === "getParameter") return limit;
      if (name === "createTexture") {
        if (++textures === mock.failTexture) return null;
        const texture = { id: textures }; alive.add(texture); return texture;
      }
      if (name === "deleteTexture") alive.delete(args[0]);
      if (name === "texImage2D" && ++uploads === mock.failUpload) throw new Error("Texture upload failed");
      if (name === "activeTexture") active = args[0] - 1000;
      if (name === "bindTexture") bindings.set(active, args[1]);
    };
  } });
  const renderer = Object.assign(Object.create(Renderer.prototype), { gl, rasterLayerUpdates: new Map(),
    frameDrawCalls: 0, vectorClipIndex: -1,
    uRasterMonochrome: "uRasterMonochrome", uRasterMonoSize: "uRasterMonoSize",
    uRasterMonoColor0: "uRasterMonoColor0", uRasterMonoColor1: "uRasterMonoColor1",
    uRasterQuad: "uRasterQuad", uRasterUv: "uRasterUv" });
  return { renderer, mock };
}
