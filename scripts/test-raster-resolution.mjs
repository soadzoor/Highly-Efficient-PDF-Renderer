import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const setMemory = deviceMemory => Object.defineProperty(globalThis, "navigator", { configurable: true, value: { deviceMemory } });

try {
  const { RasterResolutionPlanner } = await import("../src/rasterResolution.ts");
  const { estimateRasterSourcePlanBytes, estimateRasterTextureBytes } = await import("../src/rasterMemoryBudget.ts");
  const { resampleMonochromeCoverage, createMonochromeRasterLayer } = await import("../src/monochromeRaster.ts");
  const { buildRasterScenePreview, sceneCpuBytes } = await import("../src/pageRasterPreview.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { prepareSceneForHepRendering } = await import("../src/hepShared.ts");
  setMemory(2);

  const source = { width: 2048, height: 1024, monochrome: {}, matrix: Float32Array.of(2048, 0, 0, 1024, 0, 0),
    get data() { throw new Error("Planning must not read canonical pixels"); } };
  const sources = [source], planner = new RasterResolutionPlanner();
  const view = { width: 512, height: 512, cameraCenterX: 1024, cameraCenterY: 512, zoom: .1 };
  const preview = planner.plan(sources, 8192, null);
  assert.deepEqual([preview.plans[0].width, preview.plans[0].height], [128, 64]);
  assert.equal(preview.estimatedBytes, estimateRasterTextureBytes(128, 64, false, null, true));
  const visible = planner.plan(sources, 8192, view);
  assert.equal(visible.plans[0].width, 256);
  assert.equal(planner.plan(sources, 8192, { ...view, zoom: .095 }).plans[0].width, 256, "small zoom changes within a tier keep its allocation");
  const full = planner.plan(sources, 8192, { ...view, zoom: 1 });
  assert.equal(full.plans[0].width, 2048);
  assert.equal(full.estimatedBytes, estimateRasterTextureBytes(2048, 1024, true), "full dimensions use exact packed storage");
  const distant = planner.plan(sources, 8192, { ...view, zoom: 1, cameraCenterX: 10000 });
  assert.equal(distant.plans[0].width, 128, "offscreen images release high resolution");
  assert.equal(source.width, 2048);
  assert.equal(source.height, 1024);

  const identity = Float32Array.of(1 / 2048, 0, 0, 0, 0, 1 / 1024, 0, 0, 0, 0, 1, 0, -.5, -.5, 0, 1);
  const projected = new RasterResolutionPlanner().plan(sources, 8192, { ...view, localToClip: identity });
  assert.equal(projected.plans[0].width, 1024, "projection uses drawing-buffer dimensions along both image axes");
  assert.equal(new RasterResolutionPlanner().plan(sources, 8192, { ...view, projection: () => null }).plans[0].width, 128,
    "hidden Three pages retain only a preview");
  const rotated = [{ ...Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(source)).filter(([key]) => key !== "data")
    .map(([key, descriptor]) => [key, descriptor.value])), matrix: Float32Array.of(0, 2048, -1024, 0, 1536, -512) }];
  assert.equal(new RasterResolutionPlanner().plan(rotated, 8192, view).plans[0].width, 256, "rotation preserves screen demand");

  const resources = [{ rasterPlan: visible.plans[0], estimatedBytes: visible.estimatedBytes }];
  assert.equal(planner.nextChange(sources, resources, full), 0);
  planner.failed(0, full);
  assert.equal(planner.nextChange(sources, resources, full), -1, "failed refinement does not retry every frame");
  planner.invalidate();
  assert.equal(planner.nextChange(sources, resources, full), 0);
  const pair = [source, source], pairPlan = planner.plan(pair, 8192, { ...view, projection: index => index ? null : identity });
  const pairResources = [{ rasterPlan: preview.plans[0], estimatedBytes: preview.estimatedBytes },
    { rasterPlan: full.plans[0], estimatedBytes: full.estimatedBytes }];
  assert.equal(planner.nextChange(pair, pairResources, pairPlan), 1, "demotions release allowance before promotions");

  // A whole scanned document can reduce binary display resolution under the same automatic budget.
  const scans = Array.from({ length: 614 }, () => ({ width: 2480, height: 3506, monochrome: {},
    matrix: Float32Array.of(2480, 0, 0, 3506, 0, 0), get data() { throw new Error("No RGBA expansion"); } }));
  let weakWidth;
  for (const deviceMemory of [.5, 2, 8]) {
    setMemory(deviceMemory);
    const result = new RasterResolutionPlanner().plan(scans, 8192,
      { width: 4096, height: 4096, cameraCenterX: 1240, cameraCenterY: 1753, zoom: 1 });
    assert(result.estimatedBytes <= result.availableBytes);
    assert.equal(result.protectedBytes, 0, "screen-sized binary displays participate in reduction");
    assert.equal(result.estimatedBytes, result.plans.reduce((sum, plan, index) => sum +
      estimateRasterSourcePlanBytes({ width: scans[index].width, height: scans[index].height,
        monochrome: scans[index].monochrome, reducedMonochrome: true }, plan), 0));
    if (deviceMemory === .5) weakWidth = result.plans[0].width;
    if (deviceMemory === 8) assert(result.plans[0].width > weakWidth, "larger devices retain more detail for identical PDF content");
  }

  // Compare packed area averaging with an independent pixel-cell integration, including odd row padding.
  for (const [width, height, outWidth, outHeight] of [[17, 9, 5, 4], [13, 7, 1, 1], [9, 5, 9, 5], [31, 17, 12, 6]]) {
    const stride = Math.ceil(width / 8), bits = new Uint8Array(stride * height);
    for (let index = 0; index < bits.length; index++) bits[index] = (index * 113 + 171) & 255;
    const mono = { data: bits, colors: Uint8Array.of(10, 20, 30, 0, 80, 90, 100, 128) };
    const before = bits.slice(), actual = resampleMonochromeCoverage(mono, width, height, outWidth, outHeight);
    const expected = referenceCoverage(bits, width, height, outWidth, outHeight);
    actual.forEach((value, index) => assert(Math.abs(value - expected[index]) <= 1));
    assert.deepEqual(bits, before);
    assert.throws(() => resampleMonochromeCoverage(mono, width, height, width + 1, height), RangeError);
    const layer = createMonochromeRasterLayer({ width, height, matrix: Float32Array.of(width, 0, 0, height, 0, 0) }, mono);
    Object.defineProperty(layer, "data", { enumerable: true, get() { throw new Error("Preview must use packed coverage directly"); } });
    const scene = Object.assign(createEmptyVectorScene(), { rasterLayers: [layer], rasterLayerWidth: width, rasterLayerHeight: height });
    Object.defineProperty(scene, "rasterLayerData", { enumerable: true, configurable: true, get() { return layer.data; } });
    const compact = buildRasterScenePreview(scene, 4);
    assert(Math.max(compact.rasterLayers[0].width, compact.rasterLayers[0].height) <= 4);
    assert.equal(compact.rasterLayers[0].monochrome, undefined);
    assert.equal(compact.rasterLayerData, compact.rasterLayers[0].data);
    assert.deepEqual(compact.rasterLayers[0].matrix, layer.matrix);
    for (let pixel = 0; pixel < compact.rasterLayerData.length; pixel += 4) {
      if (compact.rasterLayerData[pixel + 3]) assert.deepEqual([...compact.rasterLayerData.subarray(pixel, pixel + 3)], [80, 90, 100],
        "preview palette interpolation returns straight alpha");
    }
    assert(sceneCpuBytes(compact) < sceneCpuBytes(scene) + 256);
    prepareSceneForHepRendering(composeVectorScenesInGrid([scene], 1));
  }
  const shared = new ArrayBuffer(100);
  const accounting = Object.assign(createEmptyVectorScene(), { payloadA: new Uint8Array(shared), payloadB: new Uint8Array(shared, 20), label: "test" });
  assert.equal(sceneCpuBytes(accounting), sceneCpuBytes(createEmptyVectorScene()) + 108);
  console.log("Raster resolution: previews, visibility, zoom hysteresis, projections, RAM/content budgets, packed area filtering, canonical ownership and lazy-safe scene preparation passed.");
} finally {
  if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator); else delete globalThis.navigator;
  hooks.deregister();
}

function referenceCoverage(bits, width, height, outWidth, outHeight) {
  const out = new Uint8Array(outWidth * outHeight), stride = Math.ceil(width / 8);
  const sx = width / outWidth, sy = height / outHeight;
  for (let y = 0; y < outHeight; y++) for (let x = 0; x < outWidth; x++) {
    let sum = 0;
    for (let yy = Math.floor(y * sy); yy < Math.min(height, Math.ceil((y + 1) * sy)); yy++)
      for (let xx = Math.floor(x * sx); xx < Math.min(width, Math.ceil((x + 1) * sx)); xx++) {
        const weight = (Math.min((x + 1) * sx, xx + 1) - Math.max(x * sx, xx)) *
          (Math.min((y + 1) * sy, yy + 1) - Math.max(y * sy, yy));
        sum += weight * ((bits[yy * stride + (xx >> 3)] >>> (7 - (xx & 7))) & 1);
      }
    out[y * outWidth + x] = Math.round(sum * 255 / (sx * sy));
  }
  return out;
}
