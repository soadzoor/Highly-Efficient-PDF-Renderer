import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { pdfPathOperators, parseSvgPath, pdfRectanglePath, pdfEllipsePath } = await import("../src/pdfCompositionPath.ts");
  const near = (a, b, tolerance = 1e-9) => assert(Math.abs(a - b) <= tolerance, `${a} should equal ${b}`);
  assert.deepEqual(parseSvgPath(""), []); assert.equal(pdfPathOperators([]), "");
  assert.deepEqual(parseSvgPath("m1 2 3 4h5v-2l-1-1z m2,3 4,5"), [["M", 1, 2], ["L", 4, 6], ["L", 9, 6], ["L", 9, 4], ["L", 8, 3], ["Z"], ["M", 3, 5], ["L", 7, 10]]);
  assert.deepEqual(parseSvgPath("M.1-.2L1e2-2E-1 3.5.6"), [["M", .1, -.2], ["L", 100, -.2], ["L", 3.5, .6]]);
  assert.deepEqual(parseSvgPath("M0 0C1 2 3 4 5 6s2 3 4 5S11 12 13 14L15 16S20 21 22 23"), [["M", 0, 0], ["C", 1, 2, 3, 4, 5, 6], ["C", 7, 8, 7, 9, 9, 11], ["C", 11, 13, 11, 12, 13, 14], ["L", 15, 16], ["C", 15, 16, 20, 21, 22, 23]]);
  assert.deepEqual(parseSvgPath("M0 0q1 2 3 4t5 6T10 12l1 1T15 16"), [["M", 0, 0], ["Q", 1, 2, 3, 4], ["Q", 5, 6, 8, 10], ["Q", 11, 14, 10, 12], ["L", 11, 13], ["Q", 11, 13, 15, 16]]);
  const quadratic = pdfPathOperators([["M", 0, 0], ["Q", 3, 6, 9, 0], ["Z"], ["L", 2, 3]]);
  assert.equal(quadratic, "0 0 m\n2 4 5 4 9 0 c\nh\n2 3 l\n");
  const tiny = pdfPathOperators([["M", 1e-20, 1e21], ["L", -0, 0]]);
  assert(!/[eE]/.test(tiny)); assert(tiny.includes("0.00000000000000000001 1000000000000000000000 m"));
  assert.deepEqual(parseSvgPath("M1 2A0 4 0 0 1 9 10A2 2 0 1 0 9 10"), [["M", 1, 2], ["L", 9, 10]]);
  const quarter = parseSvgPath("M10 0A10 10 0 0 1 0 10");
  assert.equal(quarter.length, 2); assert.equal(quarter[1][0], "C"); near(quarter[1][1], 10); near(quarter[1][2], 5.522847498307933); near(quarter[1][3], 5.522847498307933); near(quarter[1][4], 10);
  assert.deepEqual(quarter[1].slice(-2), [0, 10]);
  const compactFlags = parseSvgPath("M10 0a10 10 0 010 10");
  assert.deepEqual(compactFlags.at(-1).slice(-2), [10, 10], "adjacent arc flags do not merge into a number");
  const large = parseSvgPath("M10 0A10 10 0 1 1 0 10"); assert.equal(large.length, 4, "large arcs retain their longer sweep");
  const opposite = parseSvgPath("M10 0A10 10 0 0 0 0 10"); assert(opposite[1][1] < 10, "opposite sweep takes the other ellipse center");
  const expanded = parseSvgPath("M0 0A1 1 0 0 1 20 0"); assert.equal(expanded.length, 3); assert.deepEqual(expanded.at(-1).slice(-2), [20, 0]);
  const rotated = parseSvgPath("M0 0a30 10 35 1 0 40 20"); assert(rotated.length >= 3); assert(rotated.flat().filter(v => typeof v === "number").every(Number.isFinite)); assert.deepEqual(rotated.at(-1).slice(-2), [40, 20]);
  assert.deepEqual(pdfRectanglePath(2, 3, 4, 5), [["M", 2, 3], ["L", 6, 3], ["L", 6, 8], ["L", 2, 8], ["Z"]]);
  const ellipse = pdfEllipsePath(2, 3, 4, 6); assert.equal(ellipse.length, 6); assert.deepEqual(ellipse[0], ["M", 6, 6]); assert.deepEqual(ellipse.at(-2).slice(-2), [6, 6]);
  // Check geometric ellipse error instead of mirroring the helper's coefficients.
  let start = ellipse[0].slice(1);
  for (const cubic of ellipse.slice(1, -1)) {
    for (let i = 0; i <= 20; i++) {
      const t = i / 20, u = 1 - t;
      const x = u ** 3 * start[0] + 3 * u ** 2 * t * cubic[1] + 3 * u * t ** 2 * cubic[3] + t ** 3 * cubic[5];
      const y = u ** 3 * start[1] + 3 * u ** 2 * t * cubic[2] + 3 * u * t ** 2 * cubic[4] + t ** 3 * cubic[6];
      near(Math.hypot((x - 4) / 2, (y - 6) / 3), 1, .00028);
    }
    start = cubic.slice(-2);
  }
  for (const invalid of ["L0 0", "Z", "M1", "M0 0L1", "M0 0X1 2", "M0 0z1", "M0 0A1 1 0 2 0 3 4", "M0 0L1e 2", "M0 0,", "M0,,0", "M,0 0", "M1e999 0"])
    assert.throws(() => parseSvgPath(invalid), { name: /1e999/.test(invalid) ? "RangeError" : "SyntaxError" }, invalid);
  for (const invalid of [[["L", 0, 0]], [["Z"]], [["M", NaN, 0]], [["M", 0, 0], ["L", Infinity, 0]], [["M", 0, 0, 1]], [["X", 0, 0]]]) assert.throws(() => pdfPathOperators(invalid));
  assert.throws(() => pdfRectanglePath(0, 0, -1, 2)); assert.throws(() => pdfEllipsePath(0, 0, Infinity, 2));
  const dense = parseSvgPath(`M0 0${"l1 1".repeat(100000)}`); assert.equal(dense.length, 100001, "path authoring has no fixed segment count limit");
  console.log("PDF composition paths: SVG commands, smooth controls, arcs, finite validation, exact quadratic conversion, bounds and uncapped paths passed.");
} finally { hooks.deregister(); }
