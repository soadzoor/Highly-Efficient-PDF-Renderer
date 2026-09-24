import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { STROKE_COVERAGE_GLSL, STROKE_COVERAGE_WGSL } from "../src/strokeCoverageShaders.ts";

// Evaluate the actual scalar shader bodies, then compare their integrated
// coverage with geometric stroke area rather than a second coverage formula.
const smoothstep = (a, b, value) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const evaluate = source => {
  const body = source.slice(source.indexOf("{") + 1, source.lastIndexOf("}"));
  return new Function("smoothstep", `return function(distanceValue, halfWidth, aaWorld) { ${body} };`)(smoothstep);
};
const glsl = evaluate(STROKE_COVERAGE_GLSL);
const wgsl = evaluate(STROKE_COVERAGE_WGSL);
for (const coverage of [glsl, wgsl]) {
  for (const aa of [.5, .75, 1]) {
    for (const width of [.0001, .01, .1, .5, 1, 3, 8]) {
      const halfWidth = width / 2;
      const extent = halfWidth + aa;
      const count = 8192;
      const step = 2 * extent / count;
      let area = 0;
      for (let i = 0; i < count; i += 1) {
        const distance = Math.abs(-extent + (i + .5) * step);
        const value = coverage(distance, halfWidth, aa);
        assert(value >= 0 && value <= 1);
        area += value * step;
      }
      assert(Math.abs(area - width) < width * 1e-6,
        `filtered ${width}px stroke preserves its ink area with ${aa}px AA: ${area}`);
    }
  }
  for (let phase = 0; phase <= 1; phase += .05) {
    let previous = 0;
    for (const width of [.0001, .0002, .001, .01, .05, .1, .25, .5, 1]) {
      let sum = 0;
      for (let pixel = -2; pixel <= 2; pixel += 1) sum += coverage(Math.abs(pixel + phase), width / 2, .75);
      assert(sum > 0, `a ${width}px stroke remains present at pixel phase ${phase}`);
      assert(sum >= previous, "subpixel lines brighten continuously as they widen");
      assert(sum < 1.2 * width, "narrow strokes do not retain a half-opaque width floor");
      previous = sum;
    }
  }
  for (const aa of [.5, .75, 1]) {
    for (const halfWidth of [aa, aa * 2, aa * 10]) {
      for (let distance = 0; distance < halfWidth + aa; distance += .03) {
        const previousCoverage = 1 - smoothstep(halfWidth - aa, halfWidth + aa, distance);
        assert(Math.abs(coverage(distance, halfWidth, aa) - previousCoverage) < 1e-12,
          "resolved-width strokes keep their existing edge filter");
      }
    }
  }
  assert.equal(coverage(0, 0, .75), 0, "zero geometric width has no ink before hairline resolution");
  const hairline = coverage(.2, .5, .75);
  for (const unitsPerPixel of [.01, .1, 1, 10, 100]) {
    assert(Math.abs(coverage(.2 * unitsPerPixel, .5 * unitsPerPixel, .75 * unitsPerPixel) - hairline) < 1e-12,
      "device-width hairlines remain unchanged by zoom");
  }
}

for (const [file, language] of [
  ["webGlFloorplanRenderer.ts", "GLSL"],
  ["nativeGradientWebGlShaders.ts", "GLSL"],
  ["threeTriangleStrokeLayer.ts", "GLSL"],
  ["threeCompactedStrokeLayer.ts", "GLSL"],
  ["webGpuFloorplanRenderer.ts", "WGSL"],
  ["nativeGradientWebGpuShaders.ts", "WGSL"],
  ["threeWebGpuStrokeMaterial.ts", "WGSL"],
  ["threeWebGpuGradientMaterial.ts", "WGSL"]
]) {
  const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
  assert(source.includes(`STROKE_COVERAGE_${language}`), `${file} includes the shared filter`);
  assert(source.includes("heprStrokeCoverage("), `${file} applies the shared filter`);
  if (file !== "threeCompactedStrokeLayer.ts") {
    // Evaluate the actual vertex rejection clause independently of alpha.
    // A short segment can span many pixels after zoom and must reach the GPU.
    const rejection = source.match(/\(\((?:geometryLength|axisLen)\s*(?:==|<=|<)\s*[0-9.e+-]+\s*&&\s*!(?:isRoundCap|roundCap)\)/)?.[0].slice(1);
    assert(rejection, `${file} has a degenerate-stroke guard`);
    const rejects = new Function("geometryLength", "axisLen", "isRoundCap", "roundCap", `return ${rejection};`);
    for (const length of [1e-8, 1e-7, 1e-6, 1e-5, .01]) {
      assert.equal(rejects(length, length, false, false), false,
        `${file} keeps a positive ${length}-unit butt-capped mark at every zoom`);
    }
    assert.equal(rejects(0, 0, false, false), true, `${file} still omits an exact zero-length butt stroke`);
    assert.equal(rejects(0, 0, true, true), false, `${file} keeps zero-length round-cap dots`);
  }
}

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) {
    return nextResolve(specifier + ".ts", context);
  }
  return nextResolve(specifier, context);
} });
try {
  const { ThreeCompactedStrokeLayer } = await import("../src/threeCompactedStrokeLayer.ts");
  const bounds = { minX: 0, minY: 0, maxX: 4, maxY: 4 };
  const scene = {
    segmentCount: 3,
    endpoints: Float32Array.of(0,0,1e-7,0, 1,1,1,1, 3,3,3,3),
    primitiveMeta: Float32Array.of(1e-7,0,0,1, 1,1,0,1, 3,3,0,5),
    styles: Float32Array.of(.5,0,0,0, .5,0,0,0, .5,0,0,0)
  };
  const layer = new ThreeCompactedStrokeLayer(scene, {
    sceneBounds: bounds, sceneCenterX: 0, sceneCenterY: 0, vectorOverride: [0,0,0,0]
  });
  try {
    for (const unitsPerPixel of [1e-7, 1e-4, 1, 100]) {
      layer.updateForLocalUnitsPerPixel(unitsPerPixel);
      assert.equal(layer.getRenderedSegmentCount(), 2,
        "compacted CPU preparation preserves a tiny positive mark and a round dot, omitting only the zero-length butt stroke");
    }
  } finally { layer.dispose(); }
} finally { hooks.deregister(); }
console.log("Subpixel stroke shaders preserve ink, fade continuously, and agree across rendering backends.");
