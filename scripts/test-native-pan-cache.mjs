import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { chooseNativePanCacheSize } = await import("../src/nativePanCache.ts");
  const { choosePdfCompositeResolution, PDF_COMPOSITE_MAX_BYTES } = await import("../src/pdfCompositeBudget.ts");
  const cacheBudget = 64 * 1024 * 1024;
  assert.deepEqual(chooseNativePanCacheSize(null, 1920, 1080, 8192), { width: 3456, height: 1944 },
    "ordinary viewports retain the existing 1.8x overscan");
  assert.deepEqual(chooseNativePanCacheSize(null, 100, 80, 8192), { width: 292, height: 272 },
    "small viewports retain a 96px border");
  assert.equal(chooseNativePanCacheSize(null, 8192, 8192, 8192), null,
    "a viewport at the device limit cannot provide overscan");
  assert.equal(chooseNativePanCacheSize(null, 9000, 9000, 16384), null,
    "a viewport larger than the entire cache budget stays direct");
  assert.equal(chooseNativePanCacheSize(null, 1000, 1000, 1010), null,
    "a few spare pixels do not provide useful pan coverage");
  for (const dimensions of [[0, 100, 8192], [100, -1, 8192], [100, 100, NaN], [1.5, 100, 8192]]) {
    assert.equal(chooseNativePanCacheSize(null, ...dimensions), null, "invalid texture dimensions are rejected");
  }

  const leaf = { kind: "draw", runIndex: 0 };
  const group = children => ({ kind: "group", children, alpha: 0.5, isolated: true, knockout: false, blendMode: "Normal" });
  const scene = { drawRuns: [{ kind: "fill", first: 0, count: 1 }],
    paintGraph: { roots: [group([group([leaf])])] } };
  const ordered = chooseNativePanCacheSize(scene, 1920, 1080, 8192);
  const unordered = chooseNativePanCacheSize(null, 1920, 1080, 8192);
  assert(ordered && ordered.width < unordered.width && ordered.height < unordered.height,
    "transparency surfaces constrain overscan before their memory budget lowers rendering resolution");
  assert.equal(chooseNativePanCacheSize(scene, 3840, 2160, 8192), null,
    "a direct frame already requiring compositor downscaling cannot afford additional full-density overscan");

  const previousScale = globalThis.HEPR_DEBUG_COMPOSITE_SCALE;
  try {
    for (const scale of [1, 0.5, 0.25]) {
      globalThis.HEPR_DEBUG_COMPOSITE_SCALE = scale;
      assert.deepEqual(chooseNativePanCacheSize(scene, 1920, 1080, 8192), ordered,
        "the debug compositor scale is not compounded while sizing the pan cache");
      const cacheBytes = ordered.width * ordered.height * 4;
      const direct = choosePdfCompositeResolution(scene, 1920, 1080);
      const cached = choosePdfCompositeResolution(scene, ordered.width, ordered.height,
        PDF_COMPOSITE_MAX_BYTES - cacheBytes);
      assert.equal(cached.scale, direct.scale, "reserving the cache cannot further lower compositor pixel density");
    }
  } finally {
    if (previousScale === undefined) delete globalThis.HEPR_DEBUG_COMPOSITE_SCALE;
    else globalThis.HEPR_DEBUG_COMPOSITE_SCALE = previousScale;
  }

  let checked = 0;
  for (const candidate of [null, scene]) {
    for (const [width, height] of [[801, 601], [800, 601], [1920, 945], [1921, 946],
      [3840, 2160], [4095, 3000], [100, 3000], [3000, 100]]) {
      for (const limit of [1024, 2048, 4096, 8192]) {
        const size = chooseNativePanCacheSize(candidate, width, height, limit);
        if (!size) continue;
        checked++;
        assert(size.width <= limit && size.height <= limit, "both axes fit the GPU texture limit");
        assert(size.width >= width + 32 && size.height >= height + 32, "both axes retain useful overscan");
        assert.equal((size.width - width) % 2, 0, "horizontal pixel centers remain aligned");
        assert.equal((size.height - height) % 2, 0, "vertical pixel centers remain aligned");
        assert(size.width * size.height * 4 <= cacheBudget, "one cache never exceeds 64 MiB");
        if (candidate) {
          const { estimatedSurfaces } = choosePdfCompositeResolution(candidate, width, height);
          assert(size.width * size.height * 4 * (estimatedSurfaces + 1) <= PDF_COMPOSITE_MAX_BYTES,
            "cache and conservative composite surfaces share the 512 MiB budget at full density");
        }
      }
    }
  }
  assert(checked > 15, "coverage includes both scene types, aspect ratios, texture limits and odd viewport dimensions");
  console.log(`Native pan-cache sizing: ${checked} bounded configurations, pixel alignment, compositor density and diagnostic scale passed`);
} finally { hooks.deregister(); }
