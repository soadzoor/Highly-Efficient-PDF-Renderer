import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
} });

const identity = [1, 0, 0, 1, 0, 0];
const defaults = { transform: identity, width: 0, lineCap: 0, lineJoin: 0,
  miterLimit: 10, dashArray: [], dashPhase: 0 };
const move = (x, y) => ({ kind: "move", x, y });
const line = (x, y) => ({ kind: "line", x, y });
const close = { kind: "close" };

try {
  const { buildNativeGlyphHairline } = await import("../src/pdf/nativeGlyphHairline.ts");
  const build = (commands, options = {}, transform = identity) =>
    buildNativeGlyphHairline(commands, transform, { ...defaults, ...options });
  const segment = build([move(0, 0), line(8, 0)]);
  assert.deepEqual(segment.endpoints, [0, 0, 8, 0]);
  assert.deepEqual(segment.primitiveMeta, [8, 0, 0, 3]);
  assert.deepEqual(segment.bounds, { minX: 0, minY: 0, maxX: 8, maxY: 0 });
  assert.equal(segment.approximated, false);

  const quadratic = build([move(0, 0), { kind: "quadratic", controlX: 3, controlY: 8, x: 6, y: 0 }],
    {}, [2, 1, -1, 3, 10, 20]);
  assert.deepEqual(quadratic.endpoints, [10, 20, 8, 47]);
  assert.deepEqual(quadratic.primitiveMeta, [22, 26, 1, 3]);
  assert.deepEqual(quadratic.bounds, { minX: 8, minY: 20, maxX: 22, maxY: 47 });
  assert.equal(quadratic.approximated, false, "quadratics retain their analytic vector representation");

  const square = build([move(1, 2), line(5, 2), line(5, 6), line(1, 6), close]);
  assert.equal(square.endpoints.length, 16, "the closing edge is retained");
  assert.deepEqual(square.endpoints.slice(-4), [1, 6, 1, 2]);
  assert.ok(square.primitiveMeta.filter((_, index) => index % 4 === 3).every(value => value === 7),
    "closed contours have device-pixel hairlines and rounded joins");
  assert.equal(square.approximateStyle, true, "the approximation of default miter joins is explicit");
  assert.equal(square.approximated, false, "line join approximation is distinct from curve approximation");

  const cubic = build([move(0, 0),
    { kind: "cubic", control1X: 0, control1Y: 100, control2X: 100, control2Y: 100, x: 100, y: 0 }]);
  assert.ok(cubic.endpoints.length > 4);
  assert.ok(cubic.primitiveMeta.filter((_, index) => index % 4 === 2).every(value => value === 1),
    "cubic curves become vector quadratics instead of pixels");
  assert.equal(cubic.approximated, true);
  for (let offset = 0; offset < cubic.endpoints.length - 4; offset += 4) {
    assert.deepEqual(cubic.primitiveMeta.slice(offset, offset + 2), cubic.endpoints.slice(offset + 4, offset + 6),
      "subdivided curves meet exactly");
  }

  const dashed = build([move(0, 0), line(1, 0)],
    { transform: [2, 0, 0, 3, 10, 20], dashArray: [2, 2] }, [20, 0, 0, 30, 10, 20]);
  assert.deepEqual(dashed.endpoints, [10, 20, 14, 20, 18, 20, 22, 20, 26, 20, 30, 20],
    "dash lengths follow the graphics-state CTM, independently of glyph scaling");
  const triangle = [move(0, 0), line(100, 0), line(0, 100), close];
  const pen = { transform: [1.6, .2, .35, .7, 0, 0], dashArray: [2, 1], lineCap: 1 };
  const triangleTransform = [.096, .012, .028, .056, 0, 0];
  const exactTriangle = build(triangle, pen, triangleTransform);
  const packedTriangle = build(triangle, pen, Float32Array.from(triangleTransform));
  assert.equal(packedTriangle.endpoints.length / 4, 9,
    "packed glyph transform rounding creates no extra dash cap dots at corners or closure");
  assert.equal(packedTriangle.endpoints.length, exactTriangle.endpoints.length);
  for (let index = 0; index < packedTriangle.endpoints.length; index += 1) {
    assert.ok(Math.abs(packedTriangle.endpoints[index] - exactTriangle.endpoints[index]) < 1e-5,
      "dash boundary snapping stays within packed coordinate precision");
  }
  assert.equal(build([move(0, 0), line(1e-8, 0)], { dashArray: [2, 1], lineCap: 1 }).endpoints.length, 4,
    "precision handling preserves genuinely tiny painted segments");
  assert.equal(build([move(0, 0), line(2.2, 0)], { dashArray: [1e-8, 1], lineCap: 1 }).endpoints.length, 12,
    "precision handling preserves genuinely tiny painted dashes");
  const subpaths = build([move(0, 0), line(5, 0), move(0, 4), line(5, 4)], { dashArray: [2, 2], dashPhase: 1 });
  assert.deepEqual(subpaths.endpoints, [0, 0, 1, 0, 3, 0, 5, 0, 0, 4, 1, 4, 3, 4, 5, 4],
    "dash phase resets for every contour");
  const dotted = build([move(0, 0), line(6, 0)], { dashArray: [0, 2], lineCap: 1 });
  assert.deepEqual(dotted.endpoints, [0, 0, 0, 0, 2, 0, 2, 0, 4, 0, 4, 0, 6, 0, 6, 0],
    "zero-length painted round dashes remain visible");
  const dashedCurve = build([move(0, 0), { kind: "quadratic", controlX: 10, controlY: 20, x: 20, y: 0 }],
    { dashArray: [2, 2] });
  assert.ok(dashedCurve.endpoints.length > 4);
  assert.equal(dashedCurve.approximated, true);
  assert.ok(dashedCurve.endpoints.every(Number.isFinite));

  assert.equal(build([]), null);
  assert.equal(build([move(0, 0)]), null, "a moveto alone does not paint");
  assert.ok(build([move(0, 0), line(0, 0)], { lineCap: 1 }), "a round zero-length stroke remains visible");
  assert.ok(build([move(0, 0), close], { lineCap: 1 }), "a round zero-length closed subpath remains visible");
  assert.equal(build([move(0, 0), line(0, 0)]), null);
  assert.equal(build([move(0, 0), close]), null);
  assert.ok(build([move(0, 0), line(3, 0)], { transform: [0, 0, 0, 0, 0, 0] }),
    "an undashed hairline does not need an invertible graphics-state CTM");
  assert.throws(() => build([move(0, 0), line(3, 0)],
    { transform: [0, 0, 0, 0, 0, 0], dashArray: [1, 1] }), /singular/);
  assert.throws(() => build([move(0, 0), line(Infinity, 0)]), /coordinates/);
  assert.throws(() => build([line(1, 0)]), /outside a contour/);
  assert.throws(() => build([move(0, 0), line(100, 0)], { dashArray: [0.0001, 0.0001] }),
    error => error.code === "unsupported-content" && error.details.reason === "native-glyph-stroke-complexity",
    "extremely dense dashes use bounded compatibility fallback");
  assert.throws(() => build(Array.from({ length: 65537 }, () => move(0, 0))),
    error => error.code === "resource-limit", "oversized glyph input remains a hard resource limit");
  assert.throws(() => build([move(0, 0), line(10, 0)], { dashArray: [0, 0] }), /empty dash cycle/);
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => buildNativeGlyphHairline([move(0, 0), line(1, 0)], identity, defaults, controller.signal),
    error => error.name === "AbortError" || error.code === "aborted");
  console.log("Native glyph hairline geometry, transforms, dashes, curves, and resource bounds passed.");
} finally {
  hooks.deregister();
}
