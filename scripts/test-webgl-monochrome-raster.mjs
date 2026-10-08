import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { evaluateGlsl } from "./lib/scalarShaderEval.mjs";

const hooks = registerHooks({ resolve(s, c, next) {
  return next(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });

try {
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { createMonochromeRasterLayer, expandMonochromeRaster } = await import("../src/monochromeRaster.ts");
  const { monochromeRasterFragmentGlsl } = await import("../src/monochromeRasterWebGlShader.ts");
  const { RASTER_FRAGMENT_SHADER_SOURCE } = await import("../src/nativeWebGlCoreShaders.ts");
  const { buildPreparedRasterPixels } = await import("../src/rasterPreparationCore.ts");
  const { planRasterTiles } = await import("../src/rasterTiles.ts");
  const { RasterResolutionPlanner } = await import("../src/rasterResolution.ts");
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
  assert.deepEqual(uploads.map(call => [call[3], call[4], call[5]]), [["R8", 2, 2], ["R8", 2, 2]],
    "base rows contain eight bits per byte and coverage mips occupy one four-bit atlas");
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
  assert.equal(mock.calls.filter(call => call[0] === "texImage2D").at(-1).at(-1)[0], 240,
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
  let downscaleExpanded = 0;
  Object.defineProperty(oversized, "data", { get() { downscaleExpanded++; throw new Error("Full-size RGBA expansion is unnecessary"); } });
  const previousWarn = console.warn, warnings = [];
  let downscaled;
  console.warn = (...args) => warnings.push(args);
  try { downscaled = tiled.renderer.createRasterLayerGpu(oversized, 0); }
  finally { console.warn = previousWarn; }
  assert.equal(downscaled.monochrome, undefined, "resource-limit downscaling retains the area-averaged RGBA fallback");
  assert.equal(downscaleExpanded, 0, "device-limit downscaling samples packed pixels directly");
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

  {
    const { renderer: compactRenderer, mock: compactMock } = makeRenderer(WebGlFloorplanRenderer, 512);
    const bits = { data: new Uint8Array(512 * 512 / 8).fill(255), colors: mono.colors };
    const source = { width: 512, height: 512, monochrome: bits, matrix: Float32Array.of(512,0,0,512,0,0),
      get data() { assert.fail("compact upload must not expand RGBA"); } };
    const resource = compactRenderer.createRasterLayerGpu(source, 0);
    assert.equal(resource.monochrome.compact, true);
    assert.equal(resource.monochrome.mipTexture, resource.texture);
    const uploads = compactMock.calls.filter(call => call[0] === "texImage2D");
    assert.equal(uploads.length, 1); assert.equal(uploads[0][3], "RGBA8");
    assert.equal(resource.estimatedBytes, uploads[0].at(-1).byteLength);
    compactRenderer.drawRasterTile(resource);
    assert(compactMock.calls.some(call => call[0] === "uniform1f" && call[1] === "uRasterMonochrome" && call[2] === 3));
    compactRenderer.deleteRasterLayerTextures(resource);assert.equal(compactMock.alive.size, 0);
    const failed = makeRenderer(WebGlFloorplanRenderer, 512);failed.mock.failUpload = 1;
    assert.throws(() => failed.renderer.createRasterLayerGpu(source, 0), /upload failed/);
    assert.equal(failed.mock.alive.size, 0, "failed compact uploads release the atlas");
  }
  {
    const { renderer: preparedRenderer, mock: preparedMock } = makeRenderer(WebGlFloorplanRenderer, 512);
    const source = { width:512,height:512,matrix:Float32Array.of(512,0,0,512,0,0),paintOrder:0,pageIndex:0,
      monochrome:{ data:new Uint8Array(512*512/8).fill(255),colors:mono.colors },
      get data() { assert.fail("stored monochrome display preparation must keep canonical RGBA lazy"); } };
    const plan = planRasterTiles(256,256,512);
    source.gpuPreparation = buildPreparedRasterPixels(source,plan);
    assert(source.gpuPreparation.compactAtlases[0]);
    const collected = preparedRenderer.getSceneRasterLayers({ rasterLayers:[source] });
    assert.equal(collected[0].gpuPreparation,source.gpuPreparation,"native WebGL source collection retains stored preparation");
    const classified = preparedRenderer.classifyRasterLayerSource(collected[0]);
    assert.equal(classified.gpuPreparation,source.gpuPreparation);
    preparedRenderer.rasterResolutionPlanner = new RasterResolutionPlanner();
    const resource = preparedRenderer.createRasterLayerGpu(classified,0,plan);
    const uploads = preparedMock.calls.filter(call=>call[0]==="texImage2D");
    assert.equal(uploads.length,1); assert.equal(resource.monochrome.compact,true);
    assert.equal(uploads[0].at(-1),source.gpuPreparation.compactAtlases[0].data,
      "native WebGL uploads the stored compact atlas buffer without repeating coverage or compact preparation");
    preparedRenderer.deleteRasterLayerTextures(resource); assert.equal(preparedMock.alive.size,0);
  }

  const shader = monochromeRasterFragmentGlsl(RASTER_FRAGMENT_SHADER_SOURCE);
  assert(shader.includes("heprRasterColor(vUv, dFdx(vUv), dFdy(vUv))"));
  assert(shader.includes("heprVectorClipAA(vWorld, clipAAWidth)"));
  assert(shader.includes("heprPackedCoverage(uRasterMonoMips"));
  assert(shader.includes("texelFetch(image"), "packed coverage bytes use exact fetches before interpolation");
  assert(!RASTER_FRAGMENT_SHADER_SOURCE.includes("uRasterMonochrome"), "page background keeps the existing shader");
  testRasterColor(shader);
} finally {
  hooks.deregister();
}

console.log("WebGL packed monochrome raster tests passed");

function testRasterColor(shader) {
  // Expand componentwise vector multiplication for the scalar evaluator;
  // execute the shipped helper's sampling branches and palette interpolation.
  const source = shader.match(/vec4 heprRasterColor\([\s\S]*?\n}/)[0]
    .replace(/uvD([xy]) \* uRasterMonoSize/g, "vec2(uvD$1.x * uRasterMonoSize.x, uvD$1.y * uRasterMonoSize.y)");
  const palette0 = { r: 0.1, g: 0.2, b: 0.3, a: 0.4 }, palette1 = { r: 0.5, g: 0.6, b: 0.7, a: 0.8 };
  const sampledColor = { r: 0.2, g: 0.3, b: 0.4, a: 0.5 };
  for (const [mode, lod, opaque, coverage, expectedReads] of [
    [0, 2, 0, null, ["rgba"]], [0, 2, 1, null, ["rgba"]],
    [3, 2, 1, 0.6, ["compact"]],
    [1, 0, 0, 0.25, ["binary", "packed"]],
    [1, 0.5, 0, 0.5, ["binary", "packed"]],
    [2, 0.5, 0, 0.625, ["reduced", "packed"]],
    [1, 1, 0, 0.75, ["packed"]],
    [1, 2, 0, 0.75, ["packed"]], [2, 2, 0, 0.75, ["packed"]]
  ]) {
    const reads = [], uv = { x: 0.25, y: 0.75 }, size = { x: 8, y: 4 };
    const dx = { x: 2 ** lod / size.x, y: 0 }, dy = { x: 0, y: 0 };
    const { heprRasterColor } = evaluateGlsl(source, {
      uRasterTex: "raster", uRasterMonoMips: "mips", uRasterMonochrome: mode,
      uRasterOpaque: opaque, uRasterMonoSize: size, uRasterMonoColor0: palette0, uRasterMonoColor1: palette1,
      vec4: (r, g = r, b = r, a = r) => ({ r, g, b, a }), ivec2: value => ({ ...value }),
      length: value => Math.hypot(value.x, value.y),
      mix: (a, b, weight) => typeof a === "number" ? a + (b - a) * weight :
        Object.fromEntries(Object.keys(a).map(key => [key, a[key] + (b[key] - a[key]) * weight])),
      textureGrad(texture, sampledUv, sampledDx, sampledDy) {
        assert.equal(texture, "raster"); assert.equal(sampledUv, uv);
        assert.equal(sampledDx, dx); assert.equal(sampledDy, dy);
        reads.push("rgba"); return { ...sampledColor };
      },
      textureLod(texture, sampledUv, sampledLod) {
        assert.equal(texture, "raster"); assert.equal(sampledUv, uv); assert.equal(sampledLod, 0);
        reads.push("reduced"); return { r: 0.5 };
      },
      heprRasterBinaryLinear(sampledUv) {
        assert.equal(sampledUv, uv); reads.push("binary"); return 0.25;
      },
      heprPackedCoverage(texture, sampledSize, sampledUv, sampledLod) {
        assert.equal(texture, "mips"); assert.deepEqual(sampledSize, size); assert.equal(sampledUv, uv);
        assert(Math.abs(sampledLod - Math.max(lod - 1, 0)) < 1e-12);
        reads.push("packed"); return 0.75;
      },
      heprCompactSample(texture, sampledSize, sampledUv, sampledLod) {
        assert.equal(texture, "raster"); assert.deepEqual(sampledSize, size); assert.equal(sampledUv, uv);
        assert.equal(sampledLod, lod); reads.push("compact"); return 0.6;
      }
    });
    const color = heprRasterColor(uv, dx, dy);
    const expected = coverage === null ? { ...sampledColor, a: opaque ? 1 : sampledColor.a } :
      Object.fromEntries(Object.keys(palette0).map(key => [key, palette0[key] + (palette1[key] - palette0[key]) * coverage]));
    for (const key of Object.keys(expected)) assert(Math.abs(color[key] - expected[key]) < 1e-12,
      `raster mode ${mode}, LOD ${lod} preserves ${key}, including palette alpha`);
    assert.deepEqual(reads, expectedReads, `raster mode ${mode}, LOD ${lod} samples only its selected representation`);
  }
}

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
