import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { STROKE_AREA_COVERAGE_GLSL, STROKE_AREA_COVERAGE_WGSL,
  STROKE_AREA_COVERAGE_WGSL_FUNCTIONS } from "../src/strokeAreaCoverageShaders.ts";
import { evaluateGlsl, evaluateWgsl } from "./lib/scalarShaderEval.mjs";

const v = (x, y) => ({ x, y });
const variants = [
  ["GLSL", evaluateGlsl(STROKE_AREA_COVERAGE_GLSL, { atan: Math.atan2 })],
  ["WGSL", evaluateWgsl(STROKE_AREA_COVERAGE_WGSL, { atan2: Math.atan2 })]
];
const cross = (a, b) => a.x * b.y - a.y * b.x;
const map = (p, dx, dy) => v(dx.x * p.x + dy.x * p.y, dx.y * p.x + dy.y * p.y);
const inverse = (p, dx, dy) => v(cross(p, dy) / cross(dx, dy), cross(dx, p) / cross(dx, dy));
const frames = [[v(1, 0), v(0, 1)], [v(.8, .6), v(-.6, .8)], [v(1.3, .2), v(-.3, .7)], [v(1, 0), v(0, -1)]];

// Independent oracle: integrate geometric membership over a pixel. It does not
// use the shader's area formula, distance filter, or cap decomposition.
function reference(center, p0, p2, radius, dx, dy, round, samples = 300) {
  const ax = p2.x - p0.x, ay = p2.y - p0.y, length2 = ax * ax + ay * ay;
  let count = 0;
  for (let j = 0; j < samples; j++) for (let i = 0; i < samples; i++) {
    const u = (i + .5) / samples - .5, w = (j + .5) / samples - .5;
    const x = center.x + dx.x * u + dy.x * w - p0.x;
    const y = center.y + dx.y * u + dy.y * w - p0.y;
    const projection = length2 ? (x * ax + y * ay) / length2 : 0;
    if (!round && (length2 === 0 || projection < 0 || projection > 1)) continue;
    const t = Math.max(0, Math.min(1, projection));
    if ((x - t * ax) ** 2 + (y - t * ay) ** 2 <= radius * radius) count++;
  }
  return count / (samples * samples);
}

let seed = 0x728193;
const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);
for (const [name, shader] of variants) {
  const coverage = shader.heprLinearStrokeCoverage;
  assert(Math.abs(coverage(v(0, 0), v(0, 0), v(0, 0), .5, v(1, 0), v(0, 1), 1) - Math.PI / 4) < 1e-14,
    `${name} one-pixel round dot has pi/4 covered area`);
  assert.equal(coverage(v(0, 0), v(0, 0), v(0, 0), .5, v(1, 0), v(0, 1), 0), 0,
    `${name} a zero-length butt stroke has no area`);
  for (let i = 0; i < 90; i++) {
    const [dx, dy] = frames[i % frames.length], p0 = v(random() * 3 - 1.5, random() * 3 - 1.5);
    const p2 = i % 7 === 0 ? p0 : v(random() * 3 - 1.5, random() * 3 - 1.5);
    const radius = .03 + random() * 2, round = i % 3 ? 1 : 0;
    const expected = reference(v(0, 0), p0, p2, radius, dx, dy, round);
    const actual = coverage(v(0, 0), p0, p2, radius, dx, dy, round);
    assert(actual >= 0 && actual <= 1 && Number.isFinite(actual));
    assert(Math.abs(actual - expected) < .0025,
      `${name} ${i} analytic area ${actual} matches independent reference ${expected}`);
  }
  // Summed coverage must equal the capsule's actual area at every subpixel
  // phase, including dots smaller than a finite sampling grid could resolve.
  for (const [dx, dy] of frames) for (const width of [.001, .0625, .5, 1, 3]) {
    for (const length of [0, .025, .25, 1, 4]) for (const angle of [0, .23, Math.PI / 4, 1.48]) {
      for (const phase of [0, .17, .5, .93]) {
        const p0 = map(v(phase, phase * .73), dx, dy);
        const p2 = v(p0.x + length * Math.cos(angle), p0.y + length * Math.sin(angle));
        const radius = width / 2, a = inverse(p0, dx, dy), b = inverse(p2, dx, dy);
        const ru = radius * Math.hypot(dy.x, dy.y) / Math.abs(cross(dx, dy));
        const rv = radius * Math.hypot(dx.x, dx.y) / Math.abs(cross(dx, dy));
        for (const round of [0, 1]) {
          let ink = 0;
          for (let x = Math.floor(Math.min(a.x, b.x) - ru - 1); x <= Math.ceil(Math.max(a.x, b.x) + ru + 1); x++) {
            for (let y = Math.floor(Math.min(a.y, b.y) - rv - 1); y <= Math.ceil(Math.max(a.y, b.y) + rv + 1); y++) {
              ink += coverage(map(v(x, y), dx, dy), p0, p2, radius, dx, dy, round);
            }
          }
          const expected = (width * length + round * Math.PI * radius ** 2) / Math.abs(cross(dx, dy));
          assert(Math.abs(ink - expected) < 1e-8 * Math.max(expected, 1e-5),
            `${name} ${width}px/${length}/${angle}/${phase}/${round}: ink ${ink} equals shape area ${expected}`);
        }
      }
    }
  }
  // Units, endpoint order and very long offscreen endpoints cannot change the
  // result. The fully interior path integrates a strip without large corners.
  for (const scale of [1e-6, 1, 1e6]) {
    const actual = coverage(v(.12 * scale, .23 * scale), v(-1e8 * scale, 0), v(1e8 * scale, 0),
      .03 * scale, v(scale, 0), v(0, scale), 1);
    assert(Math.abs(actual - .06) < 1e-12, `${name} long thin line preserves area across units`);
  }
  for (const radius of [8, 128, 8192]) {
    const actual = coverage(v(radius + .1, .2), v(0, 0), v(0, 0), radius, v(1, 0), v(0, 1), 1);
    const expected = reference(v(radius + .1, .2), v(0, 0), v(0, 0), radius, v(1, 0), v(0, 1), 1);
    assert(Math.abs(actual - expected) < .0025, `${name} large cap stays finite and accurate`);
  }
  assert(coverage(v(0, 0), v(-1, 0), v(1, 0), .1, v(1, 0), v(1, 1e-14), 1) > 0,
    `${name} near-singular projected footprints keep a filtered approximation`);
  assert.equal(coverage(v(0, 0), v(0, 0), v(0, 0), .1, v(1, 0), v(1, 1e-14), 0), 0,
    `${name} degenerate footprints cannot give an empty butt stroke area`);
}

// Both language exports and the Three.js node definitions come from the same
// helper bodies. All consumers must actually call the geometry-aware filter.
assert.equal(STROKE_AREA_COVERAGE_WGSL_FUNCTIONS.join("\n\n"), STROKE_AREA_COVERAGE_WGSL);
for (const file of ["nativeWebGlCoreShaders.ts", "nativeGradientWebGlShaders.ts", "webGpuPdfRenderer.ts",
  "nativeGradientWebGpuShaders.ts", "threeWebGpuStrokeMaterial.ts", "threeWebGpuGradientMaterial.ts",
  "threeTriangleStrokeLayer.ts", "threeCompactedStrokeLayer.ts"]) {
  const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
  assert(source.includes("heprLinearStrokeCoverage("), `${file} uses actual stroke/pixel intersection`);
}
console.log("Stroke pixel-area coverage preserves dots, caps, subpixel ink, transforms and backend parity.");
