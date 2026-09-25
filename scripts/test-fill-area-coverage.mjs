import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { FILL_COVERAGE_GLSL, FILL_COVERAGE_WGSL } from "../src/fillCoverageShaders.ts";
import { evaluateGlsl, evaluateWgsl } from "./lib/scalarShaderEval.mjs";

// Evaluate the exact shipped shader sources rather than a second model.
const variants = [["GLSL", evaluateGlsl(FILL_COVERAGE_GLSL)], ["WGSL", evaluateWgsl(FILL_COVERAGE_WGSL)]];

// Shapes in box space: the pixel footprint is the unit square.
const line = (x0, y0, x1, y1) => ({ p0: [x0, y0], p1: [x0, y0], p2: [x1, y1], quadratic: false });
const quad = (x0, y0, cx, cy, x1, y1) => ({ p0: [x0, y0], p1: [cx, cy], p2: [x1, y1], quadratic: true });
const polygon = points => points.map((point, index) => {
  const next = points[(index + 1) % points.length];
  return line(point[0], point[1], next[0], next[1]);
});
const rect = (x0, y0, x1, y1) => polygon([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
// Eight quadratic arcs; a negative radius reverses the orientation.
const circle = (cx, cy, radius) => {
  const segments = [];
  const r = Math.abs(radius), direction = Math.sign(radius);
  const control = r / Math.cos(Math.PI / 8);
  for (let i = 0; i < 8; i += 1) {
    const a0 = direction * i * Math.PI / 4, a1 = direction * (i + 1) * Math.PI / 4, am = (a0 + a1) / 2;
    segments.push(quad(cx + r * Math.cos(a0), cy + r * Math.sin(a0), cx + control * Math.cos(am),
      cy + control * Math.sin(am), cx + r * Math.cos(a1), cy + r * Math.sin(a1)));
  }
  return segments;
};
const translate = (segments, dx, dy) => segments.map(segment => ({ ...segment,
  p0: [segment.p0[0] + dx, segment.p0[1] + dy], p1: [segment.p1[0] + dx, segment.p1[1] + dy],
  p2: [segment.p2[0] + dx, segment.p2[1] + dy] }));

// Reference: the exact integer winding number at a point.
const windingAt = (segments, x, y) => {
  let winding = 0;
  for (const { p0, p1, p2, quadratic } of segments) {
    if (!quadratic) {
      const upward = p0[1] <= y && p2[1] > y, downward = p0[1] > y && p2[1] <= y;
      if (!upward && !downward) continue;
      const crossing = p0[0] + (y - p0[1]) * (p2[0] - p0[0]) / (p2[1] - p0[1]);
      if (crossing > x) winding += upward ? 1 : -1;
      continue;
    }
    const a = p0[1] - 2 * p1[1] + p2[1], b = 2 * (p1[1] - p0[1]), c = p0[1] - y;
    const roots = Math.abs(a) < 1e-14 ? [-c / b]
      : b * b - 4 * a * c < 0 ? [] : [(-b - Math.sqrt(b * b - 4 * a * c)) / (2 * a), (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a)];
    for (const t of roots) {
      if (!(t >= 0 && t < 1)) continue;
      const s = 1 - t;
      const crossing = s * s * p0[0] + 2 * s * t * p1[0] + t * t * p2[0];
      const slope = b + 2 * a * t;
      if (crossing > x && slope !== 0) winding += slope > 0 ? 1 : -1;
    }
  }
  return winding;
};
const fill = (winding, evenOdd) => evenOdd ? Math.abs(winding) % 2 : Math.min(Math.abs(winding), 1);
const reference = (segments, evenOdd, samples = 400) => {
  let sum = 0;
  for (let j = 0; j < samples; j += 1) {
    for (let i = 0; i < samples; i += 1) {
      sum += fill(windingAt(segments, (i + 0.5) / samples, (j + 0.5) / samples), evenOdd);
    }
  }
  return sum / (samples * samples);
};
const box = { x: 0, y: 0, z: 1, w: 1 };
const averaged = (shader, segments, low = 0, high = 1, filter = box) => segments.reduce((sum, { p0, p1, p2, quadratic }) =>
  sum + shader.heprSegmentCoverage({ x: p0[0], y: p0[1] }, { x: p1[0], y: p1[1] }, { x: p2[0], y: p2[1] },
    quadratic, filter, low, high), 0);
const coverage = (shader, segments, evenOdd = false) => shader.heprFillCoverage(averaged(shader, segments), evenOdd);

const shapes = [
  ["vertical rule", rect(0.3, -5, 0.6, 5), false],
  ["horizontal rule", rect(-5, 0.42, 5, 0.47), false],
  ["subpixel dot", rect(0.2, 0.1, 0.5, 0.4), false],
  ["dot across a corner", rect(0.8, 0.85, 1.3, 1.2), false],
  ["reversed dot", polygon([[0.2, 0.1], [0.2, 0.4], [0.5, 0.4], [0.5, 0.1]]), false],
  ["diagonal sliver", polygon([[-2, -2.1], [3, 2.9], [3, 3.1], [-2, -1.9]]), false],
  ["triangle corner", polygon([[0.4, 0.3], [2, 0.5], [0.6, 2]]), false],
  ["small circle", circle(0.5, 0.5, 0.2), false],
  ["offset circle", circle(0.9, 0.2, 0.45), false],
  ["large circle edge", circle(0.3 - 40, 0.5, 40), false],
  ["huge circle edge", circle(0.5, 0.35 - 900, 900), false],
  ["even-odd ring hole", [...circle(0.5, 0.5, 3), ...circle(0.5, 0.5, 0.35)], true],
  ["even-odd ring edge", [...circle(0.5, 0.5, 3), ...circle(0.1, 0.5, 0.6)], true],
  ["even-odd third contour", [...circle(0.5, 0.5, 3), ...circle(0.5, 0.5, 2), ...circle(0.2, 0.6, 0.5)], true],
  ["even-odd opposed thin ring", [...circle(0.5, 0.5, 0.45), ...circle(0.5, 0.5, -0.3)], true],
  ["nonzero hole", [...circle(0.5, 0.5, 3), ...circle(0.25, 0.5, -0.5)], false],
  ["nonzero overlap", [...rect(-1, -1, 0.6, 2), ...rect(0.3, -1, 2, 2)], false],
  ["overlap-only edge", [...rect(-3, -3, 3, 3), ...rect(0.45, -3, 3, 3)], false]
];
for (const [name, shader] of variants) {
  for (const [label, segments, evenOdd] of shapes) {
    const expected = reference(segments, evenOdd);
    const actual = coverage(shader, segments, evenOdd);
    assert(Math.abs(actual - expected) < 0.02, `${name} ${label}: ${actual} matches box coverage ${expected}`);
  }
  // A footprint spanning windings 0, 1 and 2 at once saturates the average,
  // as in other area rasterizers: it may read darker, never lighter.
  const mixed = [...rect(-1, -1, 0.6, 2), ...rect(0.3, -1, 2, 0.7)];
  const mixedCoverage = coverage(shader, mixed);
  assert(mixedCoverage >= reference(mixed, false) && mixedCoverage <= 1, `${name} mixed overlap stays conservative`);
}

for (const [name, shader] of variants) {
  // Box-filter ink: a thin rule's coverage summed over the pixels it crosses
  // equals its width at every subpixel position, and it moves continuously.
  for (const width of [0.001, 0.05, 0.3, 0.72, 1.4]) {
    let previous = null;
    for (let offset = 0; offset <= 1; offset += 1 / 64) {
      let ink = 0;
      const values = [];
      for (let pixel = -3; pixel <= 3; pixel += 1) {
        const value = coverage(shader, rect(-10, offset - pixel, 10, offset - pixel + width));
        assert(value >= 0 && value <= 1);
        values.push(value);
        ink += value;
      }
      assert(Math.abs(ink - width) < 1e-9, `${name} ${width}px rule keeps its ink at offset ${offset}: ${ink}`);
      if (previous) {
        const jump = Math.max(...values.map((value, index) => Math.abs(value - previous[index])));
        assert(jump <= Math.min(width, 1 / 64) + 1e-9, `${name} ${width}px rule fades continuously: ${jump}`);
      }
      previous = values;
    }
  }
  // A subpixel dot keeps its area wherever it lies, including diagonally
  // between pixel centres where a centre-sampled fill has no fragment.
  for (const [dx, dy] of [[0, 0], [0.35, 0.8], [0.9, 0.95], [0.5, 0.5]]) {
    let ink = 0;
    for (let px = -2; px <= 2; px += 1) {
      for (let py = -2; py <= 2; py += 1) {
        ink += coverage(shader, rect(dx - px, dy - py, dx - px + 0.2, dy - py + 0.25));
      }
    }
    assert(Math.abs(ink - 0.05) < 1e-9, `${name} dot area survives at (${dx}, ${dy}): ${ink}`);
  }
  // A curved sliver: summed coverage equals its enclosed area.
  const crescent = [quad(-1.3, 0.2, 0.4, 1.9, 2.1, 0.2), quad(2.1, 0.2, 0.4, 1.5, -1.3, 0.2)];
  const area = (2 / 3) * 3.4 * (0.85 - 0.65);
  let curvedInk = 0;
  for (let px = -3; px <= 3; px += 1) {
    for (let py = -2; py <= 2; py += 1) curvedInk += coverage(shader, translate(crescent, -px, -py));
  }
  assert(Math.abs(curvedInk - area) < 0.004, `${name} curved sliver keeps its area: ${curvedInk} vs ${area}`);
  // Integrating each band over its own rows adds up to the whole footprint,
  // so a segment listed in two bands is never counted twice.
  for (const [label, segments] of shapes) {
    const whole = averaged(shader, segments);
    for (const split of [0.1, 0.37, 0.5, 0.93]) {
      const parts = averaged(shader, segments, 0, split) + averaged(shader, segments, split, 1);
      assert(Math.abs(parts - whole) < 0.01, `${name} ${label} splits into rows at ${split}`);
    }
  }
  // Path-space points map onto the footprint box before integration.
  const mapped = { x: 10, y: 20, z: 1 / 0.5, w: 1 / 0.25 };
  assert(Math.abs(averaged(shader, rect(10.1, 20.05, 10.3, 20.15), 0, 1, mapped) - 0.16) < 1e-9,
    `${name} maps path space onto the footprint`);
  assert.equal(averaged(shader, rect(5, 5, 5, 6)), 0, `${name} zero-width shapes have no ink`);
}

// Band-indexed paths: model the shader's band walk over the real index, with
// each band integrated over its own rows, against a linear scan of the path.
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });
try {
  const { buildVectorFillBandIndex } = await import("../src/vectorFillBands.ts");
  const path = [];
  for (let i = 0; i < 48; i += 1) {
    const angle = i * Math.PI / 24, next = (i + 1) * Math.PI / 24;
    path.push(line(40 * Math.cos(angle), 40 * Math.sin(angle), 40 * Math.cos(next), 40 * Math.sin(next)));
  }
  path.push(...translate(circle(0, 0, -12), 5, 3));
  path.push(...rect(-30, -0.2, 30, 0.1));
  const segmentsA = new Float32Array(path.flatMap(({ p0, p1 }) => [...p0, ...p1]));
  const segmentsB = new Float32Array(path.flatMap(({ p2, quadratic }) => [...p2, quadratic ? 1 : 0, 0]));
  const index = buildVectorFillBandIndex({ pathCount: 1, segmentCount: path.length,
    pathMetaA: Float32Array.of(0, path.length, -40, -40), pathMetaB: Float32Array.of(40, 40, 0, 0), segmentsA, segmentsB });
  const [table, bandCount] = index.paths;
  assert(bandCount > 4, "the fixture path is band indexed");
  const bandInfo = { x: table, y: bandCount, z: index.paths[2], w: index.paths[3] };
  const stored = segment => ({ p0: [segmentsA[segment * 4], segmentsA[segment * 4 + 1]],
    p1: [segmentsA[segment * 4 + 2], segmentsA[segment * 4 + 3]],
    p2: [segmentsB[segment * 4], segmentsB[segment * 4 + 1]], quadratic: segmentsB[segment * 4 + 2] >= 1 });
  const all = path.map((_, segment) => stored(segment));
  const bandOf = y => Math.max(0, Math.min(bandCount - 1, Math.floor((y - bandInfo.z) / bandInfo.w)));
  for (const [name, shader] of variants) {
    for (let step = 0; step < 900; step += 1) {
      const size = [0.05, 0.4, 1.5, 6][step % 4];
      const x = -42 + (step * 7.919) % 84, y = -42 + (step * 3.137) % 84;
      const filter = { x: x - size / 2, y: y - size / 2, z: 1 / size, w: 1 / size };
      // Lines integrate exactly in any row split; a curve split across two
      // bands is flattened per band, within the flattening tolerance.
      let bandedLines = 0, bandedCurves = 0;
      for (let band = bandOf(y - size / 2); band <= bandOf(y + size / 2); band += 1) {
        const rows = shader.heprBandRows(bandInfo, band, bandCount, filter);
        const first = index.bands[(table + band) * 2], count = index.bands[(table + band) * 2 + 1];
        for (let entry = first; entry < first + count; entry += 1) {
          const segment = stored(index.segments[entry]);
          const value = averaged(shader, [segment], rows.x, rows.y, filter);
          if (segment.quadratic) bandedCurves += value;
          else bandedLines += value;
        }
      }
      const lines = averaged(shader, all.filter(segment => !segment.quadratic), 0, 1, filter);
      const curves = averaged(shader, all.filter(segment => segment.quadratic), 0, 1, filter);
      assert(Math.abs(bandedLines - lines) < 1e-6, `${name} banded lines at ${x}, ${y} match the linear scan`);
      assert(Math.abs(bandedCurves - curves) < 0.01, `${name} banded curves at ${x}, ${y} match the linear scan`);
    }
    const whole = shader.heprBandRows(bandInfo, 0, 0, box);
    assert(whole.x === 0 && whole.y === 1, `${name} unindexed paths integrate the whole footprint`);
  }
} finally { hooks.deregister(); }

// Both variants agree bit-for-bit in double precision, so GPU backends differ
// only by their float precision.
let seed = 12345;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 6 - 2.5;
for (let i = 0; i < 4000; i += 1) {
  const segment = i % 3 ? quad(random(), random(), random(), random(), random(), random())
    : line(random(), random(), random(), random());
  const low = Math.max(0, random() / 5), high = Math.min(1, low + Math.abs(random()) / 4);
  const values = variants.map(([, shader]) => averaged(shader, [segment], low, high));
  assert(Number.isFinite(values[0]) && Math.abs(values[0] - values[1]) < 1e-12, "GLSL and WGSL agree");
}

for (const [file, language] of [
  ["webGlFloorplanRenderer.ts", "GLSL"],
  ["nativeGradientWebGlShaders.ts", "GLSL"],
  ["webGpuFloorplanRenderer.ts", "WGSL"],
  ["nativeGradientWebGpuShaders.ts", "WGSL"],
  ["threeWebGpuFillMaterial.ts", "WGSL"],
  ["threeWebGpuTextMaterial.ts", "WGSL"],
  ["threeWebGpuGradientMaterial.ts", "WGSL"]
]) {
  const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
  assert(source.includes(`FILL_COVERAGE_${language}`), `${file} includes the shared area filter`);
  assert(source.includes("heprSegmentCoverage("), `${file} integrates segments over the footprint`);
  assert(source.includes(`FILL_COVERAGE_VERTEX_${language}`) && source.includes("heprCoverageMargin("),
    `${file} widens quads to reach subpixel shapes`);
  assert.doesNotMatch(source, /clamp\(0\.5 - signedDistance/, `${file} has no single-edge fill filter left`);
}
console.log("Fill and glyph area coverage preserves ink, fades continuously, and agrees across backends.");
