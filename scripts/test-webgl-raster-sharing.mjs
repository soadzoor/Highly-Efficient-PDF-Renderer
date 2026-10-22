import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { WebGlPdfRenderer } = await import("../src/webGlPdfRenderer.ts");
  const { planRasterTiles } = await import("../src/rasterTiles.ts");
  const source = { width: 8, height: 8, data: new Uint8Array(8 * 8 * 4).fill(127),
    matrix: Float32Array.of(8, 0, 0, 8, 0, 0), opacity: .5, pageIndex: 0, paintOrder: 0 };
  const { renderer, mock } = fixture(WebGlPdfRenderer);
  assert.equal(renderer.getSceneRasterLayers({ rasterLayers: [source] })[0], source,
    "already normalized canonical layers do not need metadata wrappers");
  assert.equal(renderer.classifyRasterLayerSource(source, true), source,
    "small ordinary pixels need no compression descriptor copies");
  const needsNormalization = { ...source, width: 8.9, matrix: [8, 0, 0, 8, 1, 2], paintOrder: NaN, pageIndex: -1,
    get data() { assert.equal(this, needsNormalization); return source.data; } };
  const normalized = renderer.getSceneRasterLayers({ rasterLayers: [needsNormalization] })[0];
  assert.equal(normalized.width, 8); assert.equal(normalized.pageIndex, 0); assert.equal(normalized.paintOrder, 0);
  assert(normalized.matrix instanceof Float32Array); assert.equal(normalized.data, source.data);
  assert.equal(needsNormalization.width, 8.9); assert(Number.isNaN(needsNormalization.paintOrder));
  const replacement = { ...source, data: source.data.slice() };
  renderer.rasterLayerUpdates.set(0, replacement);
  assert.equal(renderer.getSceneRasterLayers({ rasterLayers: [source] })[0], replacement,
    "source normalization observes current replacements without an invalidation cache");
  renderer.rasterLayerUpdates.clear();
  const detectable = { ...source, width: 32, height: 8,
    get data() { assert.equal(this, detectable); return monoRgba; } };
  const monoRgba = new Uint8Array(32 * 8 * 4).fill(255);
  const classified = renderer.classifyRasterLayerSource(detectable);
  assert(classified.monochrome); assert.equal(classified.data, monoRgba,
    "classification preserves the receiver of inherited canonical pixel accessors");
  assert.equal(detectable.monochrome, undefined, "classification never modifies canonical metadata");
  const resources = Array.from({ length: 1000 }, (_, index) => renderer.createRasterLayerGpu({ ...source,
    matrix: Float32Array.of(8, 0, 0, 8, index, -index), opacity: index / 1000, pageIndex: index % 2, paintOrder: index }, index));
  assert.equal(mock.created, 1, "one texture serves a thousand placements of the same image");
  assert.equal(mock.uploads, 1); assert.equal(mock.mipmaps, 1);
  assert.equal(new Set(resources.map(resource => resource.texture)).size, 1);
  assert.equal(new Set(resources.map(resource => resource.matrix)).size, 1000);
  assert.equal(resources[789].matrix[4], 789); assert.equal(resources[789].opacity, .789);
  assert.equal(resources[789].pageIndex, 1); assert.equal(resources[789].paintOrder, 789);
  renderer.rasterLayers = resources;
  assert.equal(renderer.estimatedRasterResidentBytes(), resources[0].estimatedBytes,
    "the physical ledger counts shared textures once across visible placements");
  renderer.getRasterResourceCache().park(resources[0], resources[0].estimatedBytes);
  renderer.rasterLayers = resources.slice(1);
  assert.equal(renderer.estimatedRasterResidentBytes(), resources[0].estimatedBytes,
    "parking a placement does not count its shared pixels twice");
  renderer.getRasterResourceCache().clear();
  assert.equal(mock.alive.size, 1, "LRU eviction cannot destroy a visible placement's texture");
  renderer.deleteRasterLayerTextures(resources[0]);
  assert.equal(mock.alive.size, 1, "releasing an already evicted lease is harmless");
  for (const resource of resources.slice(1)) renderer.deleteRasterLayerTextures(resource);
  renderer.rasterLayers = [];
  assert.equal(mock.alive.size, 0); assert.equal(mock.deleted, 1);
  assert.equal(renderer.estimatedRasterResidentBytes(), 0);
  const restored = renderer.createRasterLayerGpu(source, 0);
  assert.equal(mock.created, 2, "a fully released resource is uploaded anew");
  renderer.getRasterResourceCache().park(restored, restored.estimatedBytes);
  assert.equal(renderer.createRasterLayerGpu(source, 0), restored, "placement LRU still restores the original lease");
  renderer.deleteRasterLayerTextures(restored);

  const distinct = fixture(WebGlPdfRenderer);
  const controls = [source, { ...source, interpolate: false }, { ...source, data: source.data.slice() },
    { ...source, width: 4, height: 16 }].map((input, index) => distinct.renderer.createRasterLayerGpu(input, index));
  assert.equal(distinct.mock.created, 4, "sampling, dimensions and canonical pixel identity distinguish textures");
  for (const resource of controls) distinct.renderer.deleteRasterLayerTextures(resource);
  assert.equal(distinct.mock.alive.size, 0);
  const otherContext = fixture(WebGlPdfRenderer);
  const otherResource = otherContext.renderer.createRasterLayerGpu(source, 0);
  assert.equal(otherContext.mock.created, 1, "resources never cross WebGL contexts");
  otherContext.renderer.deleteRasterLayerTextures(otherResource);

  const tiled = fixture(WebGlPdfRenderer, 32);
  const wide = { ...source, width: 78, height: 1, data: new Uint8Array(78 * 4).fill(127) };
  const plan = planRasterTiles(wide.width, wide.height, 32);
  const first = tiled.renderer.createRasterLayerGpu(wide, 0, plan);
  const second = tiled.renderer.createRasterLayerGpu({ ...wide, paintOrder: 1 }, 1, plan);
  assert(plan.tiles.length > 1);
  assert.equal(tiled.mock.created, plan.tiles.length, "each tile is uploaded once across placements");
  assert.equal(first.texture, second.texture);
  assert.deepEqual(first.extraTiles, second.extraTiles);
  const differentPlan = { ...plan, tiles: plan.tiles.map((tile, index) => index ? tile : { ...tile, uv: [0, 0, .5, 1] }) };
  const changed = tiled.renderer.createRasterLayerGpu(wide, 2, differentPlan);
  assert.notEqual(changed.texture, first.texture, "UV and quad plans participate in texture identity");
  tiled.renderer.deleteRasterLayerTextures(first);
  assert(tiled.mock.alive.has(second.texture));
  tiled.renderer.deleteRasterLayerTextures(second); tiled.renderer.deleteRasterLayerTextures(changed);
  assert.equal(tiled.mock.alive.size, 0);

  const packed = fixture(WebGlPdfRenderer);
  const bits = { ...source, width: 9, height: 2,
    monochrome: { data: Uint8Array.of(128, 0, 64, 0), colors: Uint8Array.of(0, 0, 0, 255, 255, 255, 255, 255) },
    get data() { assert.fail("packed resource identity must not expand RGBA"); } };
  const mono1 = packed.renderer.createRasterLayerGpu(bits, 0);
  const mono2 = packed.renderer.createRasterLayerGpu(Object.defineProperties({}, Object.getOwnPropertyDescriptors(bits)), 1);
  assert.equal(mono1.texture, mono2.texture); assert.equal(mono1.monochrome.mipTexture, mono2.monochrome.mipTexture);
  const otherPalette = packed.renderer.createRasterLayerGpu({ ...source, width: bits.width, height: bits.height,
    monochrome: { ...bits.monochrome, colors: Uint8Array.of(255, 0, 0, 128, 0, 0, 255, 255) } }, 2);
  assert.notEqual(otherPalette.texture, mono1.texture, "packed palettes remain exact, including alpha");
  const monoCount = packed.mock.alive.size;
  packed.renderer.deleteRasterLayerTextures(mono1); assert.equal(packed.mock.alive.size, monoCount);
  packed.renderer.deleteRasterLayerTextures(mono2); packed.renderer.deleteRasterLayerTextures(otherPalette);
  assert.equal(packed.mock.alive.size, 0);

  const compressed = fixture(WebGlPdfRenderer);
  let compressedUploads = 0;
  compressed.renderer.rasterCompression = {
    uploadEncoded() { compressedUploads++; return { texture: compressed.renderer.mustCreateTexture(), uvScale: [1, 1] }; }
  };
  const compressedPlan = planRasterTiles(source.width, source.height, 64);
  const encoded = { format: "bc7", plan: compressedPlan, tiles: [new Uint8Array(64)] };
  const compressedSource = { ...source, gpuCompression: encoded };
  const compressed1 = compressed.renderer.createRasterLayerGpu(compressedSource, 0, compressedPlan, "bc7");
  const compressed2 = compressed.renderer.createRasterLayerGpu({ ...compressedSource, paintOrder: 1 }, 1, compressedPlan, "bc7");
  assert.equal(compressedUploads, 1); assert.equal(compressed1.texture, compressed2.texture);
  const otherEncoded = compressed.renderer.createRasterLayerGpu({ ...compressedSource, gpuCompression: { ...encoded } }, 2, compressedPlan, "bc7");
  assert.notEqual(compressed1.texture, otherEncoded.texture, "independently prepared compressed data keeps its own identity");
  const ordinary = compressed.renderer.createRasterLayerGpu(compressedSource, 3, compressedPlan);
  assert.notEqual(compressed1.texture, ordinary.texture, "compression format participates in texture identity");
  for (const resource of [compressed1, compressed2, otherEncoded, ordinary]) compressed.renderer.deleteRasterLayerTextures(resource);
  assert.equal(compressed.mock.alive.size, 0);

  const prepared = fixture(WebGlPdfRenderer);
  const derivative = { plan: compressedPlan, pixels: [source.data.slice()] };
  const prepared1 = prepared.renderer.createRasterLayerGpu(source, 0, compressedPlan, null, derivative);
  const prepared2 = prepared.renderer.createRasterLayerGpu({ ...source, paintOrder: 1 }, 1, compressedPlan, null, derivative);
  assert.equal(prepared1.texture, prepared2.texture);
  const otherDerivative = prepared.renderer.createRasterLayerGpu(source, 2, compressedPlan, null, { ...derivative });
  assert.notEqual(otherDerivative.texture, prepared1.texture, "independent display preparations cannot accidentally share pixels");
  for (const resource of [prepared1, prepared2, otherDerivative]) prepared.renderer.deleteRasterLayerTextures(resource);
  assert.equal(prepared.mock.alive.size, 0);

  const failed = fixture(WebGlPdfRenderer);
  failed.mock.failUpload = true;
  assert.throws(() => failed.renderer.createRasterLayerGpu(source, 0), /upload failed/);
  assert.equal(failed.mock.alive.size, 0); assert.equal(failed.renderer.estimatedRasterResidentBytes(), 0);
  failed.mock.failUpload = false;
  const retry = failed.renderer.createRasterLayerGpu(source, 0);
  failed.renderer.deleteRasterLayerTextures(retry);
  assert.equal(failed.mock.alive.size, 0, "failed uploads leave no stale shared cache entry");
  console.log("WebGL raster sharing passed: placement independence, exact keys, tiled/packed storage, LRU ownership, disposal and upload failure.");
} finally { hooks.deregister(); }

function fixture(Renderer, limit = 64) {
  const mock = { created: 0, deleted: 0, uploads: 0, mipmaps: 0, alive: new Set(), failUpload: false };
  const gl = new Proxy({}, { get(target, name) {
    if (name.toUpperCase() === name) return name;
    return (...args) => {
      if (name === "getParameter") return limit;
      if (name === "createTexture") { const texture = { id: ++mock.created }; mock.alive.add(texture); return texture; }
      if (name === "deleteTexture") { assert(mock.alive.delete(args[0]), "textures are deleted exactly once"); mock.deleted++; }
      if (name === "texImage2D") { mock.uploads++; if (mock.failUpload) throw new Error("upload failed"); }
      if (name === "generateMipmap") mock.mipmaps++;
    };
  } });
  return { renderer: Object.assign(Object.create(Renderer.prototype), { gl, rasterLayers: [], rasterLayerUpdates: new Map() }), mock };
}
