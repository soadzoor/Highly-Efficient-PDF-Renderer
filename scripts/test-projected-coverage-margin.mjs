import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { FILL_COVERAGE_VERTEX_GLSL, FILL_COVERAGE_VERTEX_WGSL,
  CLIPPED_PAINT_QUAD_GLSL, CLIPPED_PAINT_QUAD_WGSL } from "../src/fillCoverageShaders.ts";
import { evaluateGlsl, evaluateWgsl } from "./lib/scalarShaderEval.mjs";

// Run the scalar limiter from the shipped shaders. No browser, GPU, PDF
// conversion or corpus fixture is needed to reproduce the exploding quads.
const glsl = FILL_COVERAGE_VERTEX_GLSL.match(/float heprCoverageExpansionScale\([\s\S]*?\n}/)[0];
const wgsl = FILL_COVERAGE_VERTEX_WGSL.match(/fn heprCoverageExpansionScale\([\s\S]*?\n}/)[0];
const variants = [evaluateGlsl(glsl).heprCoverageExpansionScale, evaluateWgsl(wgsl).heprCoverageExpansionScale];
const pixelVariants = [
  evaluateGlsl(FILL_COVERAGE_VERTEX_GLSL.match(/float heprPixelCoverageExpansionScale\([\s\S]*?\n}/)[0]).heprPixelCoverageExpansionScale,
  evaluateWgsl(FILL_COVERAGE_VERTEX_WGSL.match(/fn heprPixelCoverageExpansionScale\([\s\S]*?\n}/)[0]).heprPixelCoverageExpansionScale
];
const vector = ([x, y, z, w]) => ({ x, y, z, w });
const viewport = { x: 1600, y: 900 };
const project = (m, x, y, w = 1) => [m[0] * x + m[4] * y + m[12] * w,
  m[1] * x + m[5] * y + m[13] * w, m[2] * x + m[6] * y + m[14] * w,
  m[3] * x + m[7] * y + m[15] * w];
const screen = clip => [clip[0] / clip[3] * viewport.x / 2, clip[1] / clip[3] * viewport.y / 2];

// The inverse of the projected glyph Jacobian, as used to expand glyph-space
// bounds. Near edge-on, a single pixel can span millions of glyph-space units.
function inverseMargin(m, world, basis) {
  const clip = project(m, ...world), w = Math.abs(clip[3]) > 1e-6 ? clip[3] : 1e-6;
  const j = [(m[0] - clip[0] / w * m[3]) / w * viewport.x / 2,
    (m[1] - clip[1] / w * m[3]) / w * viewport.y / 2,
    (m[4] - clip[0] / w * m[7]) / w * viewport.x / 2,
    (m[5] - clip[1] / w * m[7]) / w * viewport.y / 2];
  const [a, b, c, d] = [j[0] * basis[0] + j[2] * basis[1], j[1] * basis[0] + j[3] * basis[1],
    j[0] * basis[2] + j[2] * basis[3], j[1] * basis[2] + j[3] * basis[3]];
  const determinant = Math.abs(a * d - b * c);
  return { pixel: [a, b, c, d],
    margin: determinant > 1e-30 ? [Math.hypot(c, d) / determinant, Math.hypot(a, b) / determinant] : [0, 0] };
}

let crossingsWithoutFix = 0, excessivePaddingWithoutFix = 0, checked = 0;
const bases = [[0.012, 0, 0, 0.012], [0.012, 0.012, -0.012, 0.012],
  [0.012, 0.003, 0.018, 0.009], [-0.012, 0, 0, 0.012], [1e-7, 0, 0, 1e-7]];
const corners = [[0, 0], [500, 0], [500, 700], [0, 700]];
for (const perspective of [true, false]) {
  const camera = perspective ? new THREE.PerspectiveCamera(45, viewport.x / viewport.y, 1, 30000)
    : new THREE.OrthographicCamera(-7000, 7000, 4000, -4000, 1, 30000);
  for (const azimuth of [0, 45, 135]) for (const degrees of [0, 45, 70, 85, 89, 89.9, 89.99, 89.999, 90, 90.001, 91, 135, 180]) {
    const theta = degrees * Math.PI / 180, phi = azimuth * Math.PI / 180;
    camera.position.set(Math.sin(theta) * Math.sin(phi), -Math.sin(theta) * Math.cos(phi), Math.cos(theta)).multiplyScalar(9000);
    camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
    // Uniform matrices are uploaded as float32, including the residual slope
    // at exactly 90 degrees. Test those values instead of an ideal singular matrix.
    const m = Float32Array.from(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements);
    for (const offset of [[-2000, -2000], [0, 0], [2000, 2000]]) for (const basis of bases) {
      for (const [x, y] of corners) {
        const world = [basis[0] * x + basis[2] * y + offset[0], basis[1] * x + basis[3] * y + offset[1]];
        const clip = project(m, ...world), { margin, pixel } = inverseMargin(m, world, basis);
        const deltaX = project(m, basis[0] * margin[0], basis[1] * margin[0], 0);
        const deltaY = project(m, basis[2] * margin[1], basis[3] * margin[1], 0);
        const scales = variants.map(fn => fn(vector(clip), vector(deltaX), vector(deltaY), viewport));
        assert.equal(scales[0], scales[1], "GLSL and WGSL limit the same footprint");
        // The hot glyph path reuses its Jacobian instead of projecting the padding
        // again. It must preserve the same limiter for rotation, shear and grazing views.
        const depth = { x: (m[3] * basis[0] + m[7] * basis[1]) / clip[3],
          y: (m[3] * basis[2] + m[7] * basis[3]) / clip[3] };
        const pixelScales = pixelVariants.map(fn => fn(vector(pixel), { x: margin[0], y: margin[1] }, depth));
        assert.equal(pixelScales[0], pixelScales[1], "GLSL and WGSL reuse the same footprint");
        const scale = pixelScales[0];
        assert(Math.abs(scale - scales[0]) < 1e-7, "reusing the Jacobian preserves the projected safety bound");
        assert(Number.isFinite(scale) && scale >= 0 && scale <= 1);
        if (degrees === 0 && basis === bases[0]) assert.equal(scale, 1, "ordinary face-on glyph AA is unchanged");
        if (!perspective && degrees === 0 && basis === bases[4]) {
          assert.equal(scale, 1, "minuscule glyphs retain their pixel margin rather than capping glyph-space distance");
        }
        // All four signs of the expanded AABB must be safe, not just the
        // direction chosen by this vertex. Clipped gradients share one margin.
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
          const delta = deltaX.map((v, i) => sx * v + sy * deltaY[i]);
          const raw = clip.map((v, i) => v + delta[i]);
          if (clip[3] * raw[3] <= 0) crossingsWithoutFix++;
          const original = screen(clip), rawScreen = screen(raw);
          if (Math.max(Math.abs(rawScreen[0] - original[0]), Math.abs(rawScreen[1] - original[1])) > 1000) excessivePaddingWithoutFix++;
          const bounded = clip.map((v, i) => v + delta[i] * scale), result = screen(bounded);
          assert(bounded.every(Number.isFinite));
          assert(clip[3] * bounded[3] > 0, "padding cannot cross the eye plane");
          assert(Math.abs(bounded[3] - clip[3]) <= Math.abs(clip[3]) * 0.250001, "padding has bounded depth change");
          assert(Math.abs(result[0] - original[0]) <= 2.00001 && Math.abs(result[1] - original[1]) <= 2.00001,
            `${perspective ? "perspective" : "orthographic"} ${degrees}°/${azimuth}°: projected padding cannot become a screen-sized quad`);
          checked++;
        }
      }
    }
  }
}
assert(crossingsWithoutFix > 0 && excessivePaddingWithoutFix > 0,
  "the fixture must reproduce the original eye-plane crossings and runaway padding");

for (const limit of variants) {
  const zero = { x: 0, y: 0, z: 0, w: 0 };
  assert.equal(limit({ ...zero, w: 1 }, zero, zero, viewport), 1);
  assert.equal(limit(zero, zero, zero, viewport), 0, "the eye plane itself cannot be inverted");
  assert.equal(limit({ ...zero, w: 1e-8 }, zero, zero, viewport), 0);
  assert.equal(limit({ ...zero, w: 1 }, { ...zero, x: Infinity }, zero, viewport), 0);
  assert.equal(limit({ ...zero, w: 1 }, { ...zero, w: NaN }, zero, viewport), 0);
  const behind = { x: 0, y: 0, z: 0, w: -10 };
  const scale = limit(behind, { ...zero, w: 1000 }, zero, viewport);
  assert(behind.w + 1000 * scale < 0, "padding cannot bring a hidden point through the eye plane either");
}

for (const limit of pixelVariants) {
  const pixel = vector([1, 0, 0, 1]), margin = { x: 1, y: 1 }, depth = { x: 0, y: 0 };
  assert.equal(limit(pixel, margin, depth), 1, "ordinary glyphs keep their pixel margin");
  assert.equal(limit(pixel, { x: Infinity, y: 1 }, depth), 0);
  assert.equal(limit(pixel, margin, { x: NaN, y: 0 }), 0);
}

// Guard the shipping vertex paths and the clip-quad replacement against
// accidentally retaining the inverse margin without applying its limiter.
for (const [source, language] of [[FILL_COVERAGE_VERTEX_GLSL, "GLSL"], [FILL_COVERAGE_VERTEX_WGSL, "WGSL"]]) {
  assert.match(source, /if \(useLocalToClip < 0\.5\) (?:\{ )?return margin;/, `${language}: native 2D padding stays unchanged`);
  assert.match(source, /if \(!\(scale > 0\.0\)\)/, `${language}: zero times an infinite margin must not produce NaN`);
}
for (const source of [CLIPPED_PAINT_QUAD_GLSL, CLIPPED_PAINT_QUAD_WGSL]) {
  assert.equal((source.match(/heprBoundCoverageMargin\(/g) ?? []).length, 4,
    "a shared clipped-paint margin is safe at all four corners");
}
for (const file of ["nativeWebGlCoreShaders.ts", "nativeGradientWebGlShaders.ts", "threeWebGpuTextMaterial.ts", "threeWebGpuFillMaterial.ts"]) {
  const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
  assert.equal((source.match(/heprBoundCoverageMargin\(/g) ?? []).length, file === "threeWebGpuTextMaterial.ts" ? 0 : 1,
    `${file}: projected fills still apply the general limiter`);
  if (file === "nativeWebGlCoreShaders.ts" || file === "threeWebGpuTextMaterial.ts") {
    assert.equal((source.match(/heprBoundCoverageMarginFromPixel\(/g) ?? []).length, 1,
      `${file}: glyphs reuse the pixel Jacobian instead of reprojecting padding`);
    assert.match(source, /heprCoverageMargin\(glyphToPixel\)/);
    assert.match(source, /heprBoundCoverageMarginFromPixel\(cornerWorld, (?:rawMargin|margin), glyphToWorld, glyphToPixel/);
  }
}
console.log(`Projected AA margins: ${checked} perspective/orthographic cases; old eye-plane crossings reproduced, cached glyph footprints match full projection, GLSL/WGSL padding bounded, normal AA preserved.`);
