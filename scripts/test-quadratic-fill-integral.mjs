import assert from "node:assert/strict";
import { FILL_COVERAGE_GLSL, FILL_COVERAGE_WGSL } from "../src/fillCoverageShaders.ts";
import { evaluateGlsl, evaluateWgsl } from "./lib/scalarShaderEval.mjs";

// Execute the shipped functions. Probes count work without replacing their math.
function instrument(source, evaluate, language) {
  let counts = {};
  const declaration = language === "GLSL"
    ? /(\b(?:float|vec2|vec4|int|bool)\s+(hepr\w+)\s*\([^)]*\)\s*\{)/g
    : /(\bfn\s+(hepr\w+)\s*\([^)]*\)\s*->\s*[\w<>]+\s*\{)/g;
  const shader = evaluate(source.replace(declaration, (_, definition, name) => `${definition}\n probe("${name}");`), {
    probe(name) { counts[name] = (counts[name] ?? 0) + 1; },
    sqrt(value) { counts.sqrt = (counts.sqrt ?? 0) + 1; return Math.sqrt(value); },
    ceil(value) { counts.ceil = (counts.ceil ?? 0) + 1; return Math.ceil(value); }
  });
  return (curve, low = 0, high = 1) => {
    counts = {};
    const [a, b, c] = curve.map(([x, y]) => ({ x, y }));
    const value = shader.heprQuadraticCoverage(a, b, c, low, high);
    return { value, counts };
  };
}

const variants = [
  ["GLSL", instrument(FILL_COVERAGE_GLSL, evaluateGlsl, "GLSL")],
  ["WGSL", instrument(FILL_COVERAGE_WGSL, evaluateWgsl, "WGSL")]
];

// Independent reference: integrate x(t) * y'(t) in the polynomial power basis.
// Partition at exact intersections with the four clipping sides, then classify
// each interval by its midpoint. This uses neither Bezier subdivision nor the
// shader's chord/parabolic-area identity, monotonic splitting or root helper.
const polynomial = (a, b, c) => [a, 2 * (b - a), a - 2 * b + c];
const valueAt = (p, t) => p[0] + t * (p[1] + t * p[2]);
function intersections(p, boundary) {
  const [constant, linear, quadratic] = [p[0] - boundary, p[1], p[2]];
  if (quadratic === 0) return linear === 0 ? [] : [-constant / linear];
  const discriminant = linear * linear - 4 * quadratic * constant;
  if (discriminant < 0) return [];
  return [(-linear - Math.sqrt(discriminant)) / (2 * quadratic),
    (-linear + Math.sqrt(discriminant)) / (2 * quadratic)];
}
function reference(curve, low = 0, high = 1) {
  const x = polynomial(...curve.map(point => point[0]));
  const y = polynomial(...curve.map(point => point[1]));
  const cuts = [0, 1, ...intersections(x, 0), ...intersections(x, 1),
    ...intersections(y, low), ...intersections(y, high)]
    .filter(t => Number.isFinite(t) && t >= 0 && t <= 1).sort((a, b) => a - b);
  const coefficients = [x[0] * y[1], 2 * x[0] * y[2] + x[1] * y[1],
    2 * x[1] * y[2] + x[2] * y[1], 2 * x[2] * y[2]];
  const primitive = t => coefficients.reduce((sum, coefficient, index) =>
    sum + coefficient * t ** (index + 1) / (index + 1), 0);
  let integral = 0;
  for (let i = 1; i < cuts.length; i++) {
    const a = cuts[i - 1], b = cuts[i], middle = (a + b) / 2;
    const row = valueAt(y, middle), column = valueAt(x, middle);
    if (row <= low || row >= high || column <= 0) continue;
    integral += column >= 1 ? valueAt(y, b) - valueAt(y, a) : primitive(b) - primitive(a);
  }
  return integral;
}
function close(actual, expected, label, tolerance = 2e-11) {
  assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} matches independent polynomial integral ${expected} within ${tolerance}`);
}

const whole = [
  ["curved increasing", [[.1, .1], [.8, .3], [.4, .9]]],
  ["vertical turn", [[.1, .2], [.8, .9], [.4, .3]]],
  ["horizontal turn", [[.1, .1], [.9, .5], [.2, .9]]],
  ["all four boundaries", [[0, 0], [1, 0], [1, 1]]],
  ["straight quadratic", [[.2, .1], [.4, .5], [.6, .9]]],
  ["vertical retrace", [[.5, .1], [.5, .9], [.5, .1]]],
  ["horizontal", [[.1, .5], [.9, .5], [.3, .5]]],
  ["point", [[.25, .5], [.25, .5], [.25, .5]]],
  ["left boundary", [[0, .1], [0, .5], [0, .9]]],
  ["right boundary", [[1, .1], [1, .5], [1, .9]]]
];
const clipped = [
  ["both rows", [[.2, -1], [.8, .3], [.4, 2]], .1, .9],
  ["linear y", [[.2, -1], [.8, .5], [.4, 2]], .2, .8],
  ["y turn crosses rows twice", [[.1, -.5], [.8, 1.5], [.3, -.5]], .2, .4],
  ["narrow band at y turn", [[.1, -.5], [.8, 1.5], [.3, -.5]], .49, .490001],
  ["tangent to lower row", [[.1, 0], [.8, 1], [.3, 0]], .5, .7],
  ["endpoint on row", [[.1, .2], [.8, 1.5], [.3, -.5]], .2, .4],
  ["narrow monotonic band", [[.2, -1], [.8, .3], [.4, 2]], .400001, .400002],
  ["source crosses both sides, clipped chord stays inside", [[-1, -1], [.5, .5], [2, 2]], .1, .9],
  ["source crosses both sides, clipped curve stays inside", [[-.5, -2], [.7, .5], [1.5, 3]], .2, .8],
  ["source crosses sides, both y-turn pieces stay inside", [[-1.8, 0], [3, 1], [-2, 0]], .48, .49]
];
const crossing = [
  ["crosses left", [[-.3, .1], [.9, .5], [.2, .9]]],
  ["crosses right", [[.8, .1], [1.7, .5], [.3, .9]]],
  ["crosses both sides", [[-1, .1], [3, .5], [1.2, .9]]],
  ["control hull crosses despite interior endpoints", [[.2, .1], [-.8, .5], [.8, .9]]]
];

let seed = 0x6e0f14a3;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
const randomWhole = Array.from({ length: 800 }, (_, i) => {
  const low = random() * .8, high = low + .001 + random() * (1 - low - .001);
  return [`contained random ${i}`, Array.from({ length: 3 }, () => [random(), low + random() * (high - low)]), low, high];
});
const randomClipped = Array.from({ length: 800 }, (_, i) => {
  const low = random() * .7, high = low + .00001 + random() * (1 - low - .00001);
  return [`row-clipped random ${i}`, Array.from({ length: 3 }, () => [.02 + random() * .96, -2 + random() * 5]), low, high];
});
let clippedHits = 0, maxExactError = 0, maxCrossingError = 0;
for (const [language, run] of variants) {
  for (const [label, curve, low = 0, high = 1] of [...whole, ...randomWhole]) {
    for (const points of [curve, [...curve].reverse()]) {
      const { value, counts } = run(points, low, high), expected = reference(points, low, high);
      close(value, expected, `${language} ${label}`);
      maxExactError = Math.max(maxExactError, Math.abs(value - expected));
      assert.equal(counts.heprQuadraticRoot ?? 0, 0, `${language} ${label} needs no row intersections`);
      assert.equal(counts.heprQuadraticPieceCoverage ?? 0, 0, `${language} ${label} skips monotonic splitting`);
      assert.equal(counts.sqrt ?? 0, 0, `${language} ${label} skips root and subdivision square roots`);
      assert.equal(counts.ceil ?? 0, 0, `${language} ${label} never builds a subdivision count`);
    }
  }
  for (const [label, curve, low = 0, high = 1] of [...clipped, ...randomClipped]) {
    for (const points of [curve, [...curve].reverse()]) {
      const { value, counts } = run(points, low, high), expected = reference(points, low, high);
      close(value, expected, `${language} ${label}`);
      maxExactError = Math.max(maxExactError, Math.abs(value - expected));
      assert.equal(counts.ceil ?? 0, 0, `${language} ${label} skips subdivision after row clipping`);
      assert.equal(counts.heprLineCoverage ?? 0, 0, `${language} ${label} never falls back to polygonal pieces`);
      if ((counts.heprQuadraticRoot ?? 0) > 0 && Math.abs(value) > 1e-12) clippedHits++;
      // Splitting the pixel's rows must neither lose nor double-count a curve.
      const split = low + .37 * (high - low);
      close(run(points, low, split).value + run(points, split, high).value, value,
        `${language} ${label} band additivity`);
    }
  }
  for (const [label, curve] of crossing) {
    for (const points of [curve, [...curve].reverse()]) {
      const { value, counts } = run(points), expected = reference(points);
      close(value, expected, `${language} ${label} retains bounded side-crossing approximation`, .004);
      maxCrossingError = Math.max(maxCrossingError, Math.abs(value - expected));
      assert((counts.ceil ?? 0) > 0 && (counts.heprLineCoverage ?? 0) > 0,
        `${language} ${label} retains subdivision when the clipped control hull crosses a pixel side`);
    }
  }
}
assert(clippedHits > 500, "random cases exercise row roots followed by the analytic clipped-subcurve shortcut");
console.log(`Quadratic fill integral: GLSL/WGSL whole and clipped curves, reversals, turns, narrow bands, ` +
  `boundaries, degeneracy and side-crossing fallback passed; max exact error ${maxExactError}, ` +
  `max fallback error ${maxCrossingError}, ${clippedHits} row-clipped shortcut cases.`);
