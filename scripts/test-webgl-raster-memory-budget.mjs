import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const previousWarn = console.warn, warnings = [];
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { deviceMemory: 0.5 } });
console.warn = (...args) => warnings.push(args.join(" "));

try {
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { automaticRasterMemoryBudget, estimateRasterTextureBytes } = await import("../src/rasterMemoryBudget.ts");
  const { buildRasterStripBatches } = await import("../src/rasterStripBatches.ts");
  const { buildRasterAtlasBatches } = await import("../src/rasterAtlasBatches.ts");
  const { RasterResolutionPlanner } = await import("../src/rasterResolution.ts");
  const budget = automaticRasterMemoryBudget();
  assert.equal(budget.bytes, 16 * 1024 * 1024);
  const data = rgbaData(1024, 1024);
  const scene = Object.assign(createEmptyVectorScene(), { rasterLayers: Array.from({ length: 4 }, (_, index) => image(1024, 1024, data, index)) });
  let expanded = 0;
  scene.rasterLayers.push({ width: 1024, height: 1024,
    monochrome: { data: new Uint8Array(128 * 1024).fill(0x55), colors: Uint8Array.of(0, 0, 0, 255, 255, 255, 255, 255) },
    get data() { expanded++; throw new Error("Packed pixels must remain lazy"); },
    matrix: Float32Array.of(1024, 0, 0, 1024, 4, 0), paintOrder: 4, pageIndex: 0 });
  const { renderer, mock } = fixture(WebGlFloorplanRenderer, scene, estimateRasterTextureBytes);
  renderer.uploadRasterLayers(scene);
  const uploadSizes = mock.uploads.map(upload => [upload.width, upload.height]);
  assert.equal(renderer.rasterLayers.length, 5);
  assert.equal(expanded, 0, "global budgeting preserves the packed source getter");
  assert(renderer.rasterLayers[4].monochrome, "binary rasters retain full resolution under memory pressure");
  assert.equal(renderer.rasterLayers[4].monochrome.width, 1024);
  assert(mock.uploads.slice(0, 4).every(upload => upload.width < 1024 && upload.height < 1024),
    "the aggregate scene reduces RGBA uploads even though every image fits the device limit");
  assert(renderer.estimatedRasterResidentBytes() <= budget.bytes);
  assert.equal(renderer.estimatedRasterResidentBytes(), mock.textureBytes(), "texture ledger includes all RGBA and packed coverage mips");
  assert.equal(scene.rasterLayers[0].width, 1024);
  assert.equal(scene.rasterLayers[0].data, data);
  assert.deepEqual(data.subarray(0, 12), Uint8Array.of(0, 255, 255, 255, 1, 255, 255, 255, 2, 255, 255, 255));
  assert(warnings.some(warning => warning.includes("not measured VRAM")));
  assert(warnings.some(warning => warning.includes("automatic raster memory budget")));
  assert(!warnings.some(warning => warning.includes("texture limit")), "memory pressure has a distinct diagnostic");

  renderer.setRasterTextureResidency(false);
  assert.equal(mock.textureBytes(), 0);
  mock.uploads.length = 0;
  renderer.setRasterTextureResidency(true);
  assert.deepEqual(mock.uploads.map(upload => [upload.width, upload.height]), uploadSizes,
    "residency restoration reapplies the scene-wide budget");
  const untouched = renderer.rasterLayers.slice(1);
  const old = renderer.rasterLayers[0].texture;
  const replacement = image(2048, 2048, rgbaData(2048, 2048), 8);
  mock.uploads.length = 0;
  const staged = renderer.prepareRasterLayerUpdates(new Map([[0, replacement]]));
  assert(mock.alive.has(old), "staging keeps old pixels available until commit");
  assert(mock.uploads[0].width < 1024, "replacement uses the remaining whole-scene allowance");
  const stagedBytes = renderer.rasterStagedBytes;
  assert(stagedBytes > 0);
  const cancelled = renderer.prepareRasterLayerUpdates(new Map([[0, replacement]]));
  assert(renderer.rasterStagedBytes > stagedBytes, "concurrent staging is part of the peak reservation");
  cancelled.dispose();
  assert.equal(renderer.rasterStagedBytes, stagedBytes, "cancellation releases its staging reservation");
  assert(mock.peakBytes <= budget.peakBytes, "old/new texture staging stays within the heuristic peak allowance");
  staged.commit(); staged.dispose();
  assert.equal(renderer.rasterStagedBytes, 0, "committed textures leave the staging ledger");
  assert(!mock.alive.has(old));
  assert.deepEqual(renderer.rasterLayers.slice(1), untouched, "unaffected textures keep their resolution and ownership");
  assert(renderer.estimatedRasterResidentBytes() <= budget.bytes);
  assert.equal(scene.rasterLayers[0].data, data, "retained replacements preserve canonical document pixels");
  renderer.destroyRasterLayerTextures();
  assert.equal(mock.textureBytes(), 0);

  const concurrentScene = Object.assign(createEmptyVectorScene(), {
    rasterLayers: Array.from({ length: 2 }, (_, index) => image(256, 256, rgbaData(256, 256), index))
  });
  const concurrent = fixture(WebGlFloorplanRenderer, concurrentScene, estimateRasterTextureBytes);
  concurrent.renderer.uploadRasterLayers(concurrentScene);
  const firstUpdate = concurrent.renderer.prepareRasterLayerUpdates(new Map([[0, replacement]]));
  const secondUpdate = concurrent.renderer.prepareRasterLayerUpdates(new Map([[1, replacement]]));
  assert(concurrent.renderer.rasterStagedBytes <= budget.bytes,
    "disjoint transactions reserve the remaining final resident target instead of claiming it twice");
  firstUpdate.commit(); secondUpdate.commit();
  firstUpdate.dispose(); secondUpdate.dispose();
  assert.equal(concurrent.renderer.rasterStagedBytes, 0);
  assert(concurrent.renderer.estimatedRasterResidentBytes() <= budget.bytes);
  concurrent.renderer.destroyRasterLayerTextures();
  assert.equal(concurrent.mock.textureBytes(), 0);

  // An optimization atlas must fit beside canonical textures. Its instance
  // buffer is part of the allowance, even though it has no GPU mip levels.
  for (const [height, build, upload, slots] of [
    [1, source => buildRasterStripBatches(source, 4096, "linear"), "uploadRasterStripBatches", "rasterStripBatches"],
    [2, source => buildRasterAtlasBatches(source, 4096), "uploadRasterAtlasBatches", "rasterAtlasBatches"]
  ]) {
    const small = Object.assign(createEmptyVectorScene(), {
      rasterLayers: Array.from({ length: 4 }, (_, index) => image(4, height, rgbaData(4, height), index)),
      drawRuns: [{ kind: "raster", first: 0, count: 4 }]
    });
    const current = fixture(WebGlFloorplanRenderer, small, estimateRasterTextureBytes);
    const [batch] = build(small), bytes = batch.data.byteLength + batch.instances.byteLength;
    current.renderer[upload](small, 4096, bytes - 1);
    assert.equal(current.renderer[slots].size, 0, "insufficient remaining bytes skip the duplicate allocation");
    assert.equal(current.mock.uploads.length, 0);
    current.renderer[upload](small, 4096, bytes);
    assert.equal(new Set(current.renderer[slots].values()).size, 1);
    assert.equal(current.renderer.estimatedRasterResidentBytes(), bytes);
    current.renderer.destroyRasterLayerTextures();
    assert.equal(current.mock.textureBytes(), 0);
  }
  {
    const scan = scene.rasterLayers[4];
    const current = fixture(WebGlFloorplanRenderer, Object.assign(createEmptyVectorScene(), { rasterLayers: [scan] }), estimateRasterTextureBytes);
    Object.assign(current.renderer, { rasterResolutionPlanner: new RasterResolutionPlanner(), rasterResolutionView: null,
      rasterRenderingEnabled: true, canvas: { width: 512, height: 512 }, cameraCenterX: 512, cameraCenterY: 512, zoom: .1 });
    current.renderer.uploadRasterLayers(current.renderer.scene);
    let displayed = current.renderer.rasterLayers[0];
    const previewTexture = displayed.texture;
    assert.equal(displayed.rasterPlan.width, 128, "initial allocation generates only a preview tier");
    assert.equal(displayed.monochrome.coverage, true);
    assert.equal(displayed.estimatedBytes, current.mock.textureBytes(), "R8 bases and packed preview mips have an exact ledger");
    const beforeStale = current.mock.uploads.length;
    current.renderer.zoom = 1; current.renderer.updateRasterResolution();
    current.renderer.zoom = .1; current.renderer.updateRasterResolution();
    while (current.renderer.rasterPreparationRunning) await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(current.mock.uploads.length, beforeStale, "obsolete refinement is discarded after zoom-out");
    current.renderer.zoom = 1;
    await refine(current.renderer);
    displayed = current.renderer.rasterLayers[0];
    assert.equal(displayed.rasterPlan.width, 1024, "zoom promotes the original packed scan");
    assert(!displayed.monochrome.coverage);
    assert(current.mock.alive.has(previewTexture), "the previous tier remains warm in the bounded cache");
    assert.equal(current.mock.deletions.get(previewTexture) ?? 0, 0, "cached coverage aliases remain live");
    assert.equal(displayed.estimatedBytes + current.renderer.rasterResourceCache.bytes, current.mock.textureBytes());
    const uploadCount = current.mock.uploads.length;
    await refine(current.renderer);
    assert.equal(current.mock.uploads.length, uploadCount, "stationary frames do not regenerate mips");
    current.renderer.cameraCenterX = 10000;
    await refine(current.renderer);
    assert.equal(current.renderer.rasterLayers[0].rasterPlan.width, 128, "offscreen detail is released");
    assert.equal(expanded, 0);
    current.renderer.destroyRasterLayerTextures();
    assert.equal(current.mock.textureBytes(), 0);
  }
  {
    const scene = Object.assign(createEmptyVectorScene(), { rasterLayers: [image(24, 24, rgbaData(24, 24), 0), image(24, 24, rgbaData(24, 24), 1)] });
    const { renderer, mock } = fixture(WebGlFloorplanRenderer, scene, estimateRasterTextureBytes);
    renderer.uploadRasterLayers(scene);
    const old = renderer.rasterLayers.slice(), createResource = renderer.createRasterLayerGpu.bind(renderer);
    let preparedUploads = 0, ticks = 0;
    renderer.createRasterLayerGpu = (source, index, plan, format, prepared) => {
      assert(prepared); assert.deepEqual(prepared.plan, plan); preparedUploads++;
      return createResource(source, index, plan, format, prepared);
    };
    const timer = setInterval(() => ticks++, 0);
    const pixels = rgbaData(1600, 1600);
    const pending = renderer.prepareRasterLayerUpdatesAsync(new Map([[0, image(1600, 1600, pixels, 0)], [1, image(1600, 1600, pixels, 1)]]));
    assert(renderer.rasterStagedBytes > 0);
    assert.deepEqual(renderer.rasterLayers, old);
    const transaction = await pending; clearInterval(timer);
    assert(ticks > 0); assert.equal(preparedUploads, 2);
    assert.deepEqual(renderer.rasterLayers, old);
    assert(mock.peakBytes <= budget.peakBytes);
    transaction.commit(); transaction.dispose(); assert.equal(renderer.rasterStagedBytes, 0);
    assert.equal(renderer.estimatedRasterResidentBytes(), mock.textureBytes());
    assert(renderer.estimatedRasterResidentBytes() <= budget.bytes);
    renderer.destroyRasterLayerTextures(); assert.equal(mock.textureBytes(), 0);
  }
  console.log("WebGL automatic raster memory: aggregate plans, lazy packed pixels, exact mips, replacement peaks, residency, batch limits and zoom-dependent R8/packed allocations passed.");
} finally {
  console.warn = previousWarn;
  if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
  else delete globalThis.navigator;
  hooks.deregister();
}

function rgbaData(width, height) {
  const data = new Uint8Array(width * height * 4).fill(255);
  data[0] = 0; data[4] = 1; data[8] = 2;
  return data;
}

function image(width, height, data, index) {
  return { width, height, data, matrix: Float32Array.of(width, 0, 0, height, index, 0), paintOrder: index, pageIndex: 0 };
}

function fixture(Renderer, scene, estimateBytes) {
  const alive = new Set(), uploads = [];
  let texture = null, nextId = 0;
  const mock = { alive, uploads, deletions: new Map(), peakBytes: 0,
    textureBytes: () => [...alive].reduce((sum, value) => sum + (value.bytes ?? 0), 0) };
  const gl = new Proxy({}, { get(_target, name) {
    if (name.toUpperCase() === name) return name;
    return (...args) => {
      if (name === "getParameter") return 4096;
      if (name.startsWith("create")) { const value = { id: ++nextId, bytes: 0, levels: new Map() }; alive.add(value); return value; }
      if (name.startsWith("delete")) { mock.deletions.set(args[0], (mock.deletions.get(args[0]) ?? 0) + 1); alive.delete(args[0]); return; }
      if (name === "getUniformLocation") return args[1];
      if (name === "bindTexture") texture = args[1];
      if (name === "texImage2D") {
        const [, level, format, width, height] = args;
        texture.levels.set(level, width * height * (format === "R8" ? 1 : 4));
        texture.width = width; texture.height = height;
        texture.bytes = [...texture.levels.values()].reduce((sum, bytes) => sum + bytes, 0);
        uploads.push({ texture, format, level, width, height });
      }
      if (name === "generateMipmap") texture.bytes = estimateBytes(texture.width, texture.height, false);
      mock.peakBytes = Math.max(mock.peakBytes, mock.textureBytes());
    };
  } });
  const renderer = Object.assign(Object.create(Renderer.prototype), { gl, scene, isDisposed: false,
    rasterTextureResidencyEnabled: true, rasterLayers: [], rasterLayerUpdates: new Map(),
    rasterStripBatches: new Map(), rasterAtlasBatches: new Map(), paintFoldUnit: -1,
    createProgram: () => ({ program: true }), destroyVectorMinifyResources() {}, requestFrame() {} });
  return { renderer, mock };
}

async function refine(renderer) {
  renderer.updateRasterResolution();
  while (renderer.rasterPreparationRunning) await new Promise(resolve => setTimeout(resolve, 0));
}
