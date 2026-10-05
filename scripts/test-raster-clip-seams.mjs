import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) {
    return next(`${specifier}.ts`, context);
  }
  return next(specifier, context);
} });

try {
  const { RASTER_CLIP_GLSL, RASTER_CLIP_WGSL, RASTER_CLIP_RECT_GLSL, RASTER_CLIP_RECT_WGSL } =
    await import("../src/rasterClipShaders.ts");
  const { VECTOR_CLIP_GLSL, VECTOR_CLIP_AA_WGSL } = await import("../src/vectorClipShaders.ts");
  const { CORE_RASTER_FRAGMENT_SHADER_SOURCE } = await import("../src/coreShaders.ts");
  const { RASTER_STRIP_FRAGMENT_GLSL } = await import("../src/rasterStripWebGlShaders.ts");
  const { RASTER_ATLAS_FRAGMENT_GLSL } = await import("../src/rasterAtlasWebGlShaders.ts");
  const { RASTER_TEXTURE_BATCH_FRAGMENT_GLSL } = await import("../src/rasterTextureBatchWebGlShaders.ts");
  const { RASTER_STRIP_WGSL } = await import("../src/nativeRasterStripWebGpuShader.ts");

  // Evaluate the actual scalar conditions shipped to both GPUs. Reference
  // coverage comes from independent pixel subsampling and source-over blending.
  const conditions = [RASTER_CLIP_RECT_GLSL, RASTER_CLIP_RECT_WGSL].map(source =>
    new Function("point", "bounds", `return ${source.match(/inside = (.*);/)[1]} ? 1 : 0;`));
  const bounds = (x, y, z, w) => ({ x, y, z, w });
  const aa = (point, rect, width) => {
    let count = 0;
    for (const dx of [-0.375, -0.125, 0.125, 0.375]) {
      for (const dy of [-0.375, -0.125, 0.125, 0.375]) {
        const x = point.x + dx * width, y = point.y + dy * width;
        count += x >= rect.x && y >= rect.y && x < rect.z && y < rect.w;
      }
    }
    return count / 16;
  };
  const over = (first, second) => second + first * (1 - second);
  let oldSeams = 0;
  for (const coverage of conditions) {
    for (const zoom of [0.1, 0.25, 0.5, 1, 2, 4, 8, 16]) {
      for (const overlap of [0, 0.434]) {
        // The real PDF's neighboring tiles meet near x=202.085, y=554.888
        // and overlap by roughly 0.434 points. Also test horizontal seams.
        for (const horizontal of [false, true]) {
          const edge = horizontal ? 554.888 : 202.085;
          const a = horizontal ? bounds(0, 0, 756, edge + overlap) : bounds(0, 0, edge + overlap, 756);
          const b = horizontal ? bounds(0, edge, 756, 756) : bounds(edge, 0, 756, 756);
          for (const offset of [-0.374, -0.124, 0, 0.124, 0.374]) {
            const at = edge + offset / zoom;
            const point = horizontal ? { x: 100, y: at } : { x: at, y: 100 };
            assert.equal(over(coverage(point, a), coverage(point, b)), 1,
              `solid background at zoom ${zoom}, overlap ${overlap}, offset ${offset}`);
            oldSeams += over(aa(point, a, 1 / zoom), aa(point, b, 1 / zoom)) < 1;
          }
        }
      }
      const page = bounds(0, 0, 576, 756);
      for (const point of [{ x: 0.1 / zoom, y: 100 }, { x: 576 - 0.1 / zoom, y: 100 },
        { x: 100, y: 0.1 / zoom }, { x: 100, y: 756 - 0.1 / zoom }]) {
        assert.equal(coverage(point, page), 1, "page clips cannot reveal a faded outline inside the page");
        assert(aa(point, page, 1 / zoom) < 1, "the fixture reproduces the old outline");
      }
    }
    const page = bounds(0, 0, 576, 756);
    for (const point of [{ x: -0.001, y: 100 }, { x: 576, y: 100 }, { x: 100, y: 756 }]) {
      assert.equal(coverage(point, page), 0, "content outside the crop box stays clipped");
    }
    assert.equal(coverage({ x: 0, y: 0 }, page), 1, "minimum boundaries are included");
    assert.equal(coverage({ x: 2, y: 2 }, bounds(3, 3, 1, 1)), 0, "empty rectangles stay empty");
  }
  assert(oldSeams > 0, "the zoom sweep must reproduce the previous tile seam");

  for (const source of [RASTER_CLIP_GLSL, RASTER_CLIP_WGSL]) {
    assert.match(source, /samples &= (?:node.z < 0.0 \? )?heprRasterClipRectSamples/);
    assert.match(source, /heprRasterClipPolygonSamples\([^;]*point, sampleX, sampleY, span\)/);
    assert.match(source, /return heprClipPolygonSamples\([^;]*sampleX, sampleY, span\);/,
      "curved and rotated polygon outlines retain the original antialiasing");
    const expression = source.match(/min\(abs\(line.x - line.z\), abs\(line.y - line.w\)\) <= 0.002/)[0];
    const aligned = new Function("line", `return ${expression.replaceAll("min(", "Math.min(").replaceAll("abs(", "Math.abs(")};`);
    assert(aligned({ x: 202.518, y: 343.833, z: 202.519, w: 555.320 }),
      "a tile edge rounded to thousandths of a point uses solid exact winding");
    assert(!aligned({ x: 0, y: 0, z: 10, w: 1 }), "rotated polygon edges remain antialiased");
  }
  assert(VECTOR_CLIP_GLSL.includes("heprClipRectSamples(heprClipTexel(int(node.y)), sampleX, sampleY)"));
  assert(VECTOR_CLIP_AA_WGSL.includes("heprClipRectSamples(heprClipTexel(clipTexture, i32(node.y)), sampleX, sampleY)"));
  assert.match(RASTER_CLIP_WGSL.trimStart(), /^fn heprVectorClipAA\(/, "TSL must select the coverage entry point");
  for (const source of [CORE_RASTER_FRAGMENT_SHADER_SOURCE, RASTER_STRIP_FRAGMENT_GLSL,
    RASTER_ATLAS_FRAGMENT_GLSL, RASTER_TEXTURE_BATCH_FRAGMENT_GLSL, RASTER_STRIP_WGSL]) {
    assert(source.includes("heprRasterClipRectSamples"), "every raster batching path uses solid rectangle clips");
  }
  console.log("Raster clip seams: zoom sweeps, overlapping tiles, page edges, rounded tile quads and polygon AA passed.");
} finally { hooks.deregister(); }
