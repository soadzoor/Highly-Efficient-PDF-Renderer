import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { validateRasterRepeat, rasterRepeatCount, rasterRepeatMatrix, rasterRepeatBounds,
    translateRasterRepeat, buildRasterRepeatInstances, rasterRepeatPoint, rasterRepeatPointRange,
    rasterRepeatPoints } = await import("../src/rasterRepeat.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { ScenePrimitivePicker } = await import("../src/scenePrimitives.ts");
  const make = (overrides = {}) => ({ transform: Float64Array.of(1, 0, 0, 1, .125, -.375),
    bounds: Float64Array.of(-.25, .125, .5, .875), xStep: 1.25, yStep: 1.5,
    xFirst: -3, xLast: 3, yFirst: -2, yLast: 3, ...overrides });
  const multiply = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  const referenceMatrix = (repeat, x, y) => {
    const cell = Float32Array.from(multiply(repeat.transform, [1, 0, 0, 1, x * repeat.xStep, y * repeat.yStep])),
      [minX, minY, maxX, maxY] = repeat.bounds,
      matrix = Float32Array.from(multiply(cell, [maxX - minX, 0, 0, minY - maxY, minX, maxY]));
    for (let index = 0; index < (repeat.translations?.length ?? 0); index += 2) {
      matrix[4] += repeat.translations[index]; matrix[5] += repeat.translations[index + 1];
    }
    return matrix;
  };
  const cells = repeat => {
    const result = [];
    for (let y = repeat.yFirst; y <= repeat.yLast; y++) for (let x = repeat.xFirst; x <= repeat.xLast; x++)
      result.push({ x, y, matrix: referenceMatrix(repeat, x, y) });
    return result;
  };
  const containing = (expanded, x, y) => expanded.flatMap(cell => {
    const [a, b, c, d, e, f] = cell.matrix, determinant = a * d - b * c;
    if (!determinant) return [];
    const u = (d * (x - e) - c * (y - f)) / determinant, v = (-b * (x - e) + a * (y - f)) / determinant;
    return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? [{ ...cell, uv: { x: u, y: v } }] : [];
  });
  const close = (actual, expected, message) => assert(Math.abs(actual - expected) <= 1e-12, `${message}: ${actual} vs ${expected}`);
  const fixtures = [make(),
    make({ transform: Float64Array.of(-1, -0, -0, -1, 0, -0), bounds: Float64Array.of(0, 0, 1, 1) }),
    make({ transform: Float64Array.of(-2, 0, 0, 3, 40.123, -2.123), xStep: -1.25 }),
    make({ transform: Float64Array.of(0, 1.75, -2.25, 0, 12.5, 33.25), yStep: -1.5 }),
    make({ transform: Float64Array.of(0, -1.75, 2.25, 0, -12.5, -33.25), xStep: -1.25, yStep: -1.5 }),
    make({ transform: Float64Array.of(1.0000001192092896, 0, -0, 1.23456789012345, 1000000.25, -1024 / 3),
      translations: Float64Array.of(1.125, 1 / 3, -.625, -.125) }),
    make({ transform: Float64Array.of(1, 0, 0, 1, 2 ** 26, 2 ** 26),
      bounds: Float64Array.of(0, 0, 1, 1), xStep: 1, yStep: 1 })];
  for (const repeat of fixtures) {
    const original = structuredClone(repeat);
    validateRasterRepeat(repeat);
    const expanded = cells(repeat), packed = buildRasterRepeatInstances(repeat), bounds = rasterRepeatBounds(repeat);
    assert.equal(rasterRepeatCount(repeat), expanded.length);
    assert.equal(packed.length, expanded.length * 6);
    expanded.forEach((cell, index) => {
      assert.deepEqual(rasterRepeatMatrix(repeat, cell.x, cell.y), cell.matrix, "independent two-store matrix reference");
      assert.deepEqual(packed.subarray(index * 6, index * 6 + 6), cell.matrix, "streamed instances preserve source y/x order");
      const target = new Float32Array(12).fill(123);
      assert.equal(rasterRepeatMatrix(repeat, cell.x, cell.y, target, 3), target);
      assert.deepEqual(target.subarray(3, 9), cell.matrix);
      assert.deepEqual([...target.subarray(0, 3), ...target.subarray(9)], new Array(6).fill(123));
      for (const u of [0, 1]) for (const v of [0, 1]) {
        const x = cell.matrix[0] * u + cell.matrix[2] * v + cell.matrix[4],
          y = cell.matrix[1] * u + cell.matrix[3] * v + cell.matrix[5];
        for (const px of [x, Math.fround(x)]) for (const py of [y, Math.fround(y)])
          assert(px >= bounds.minX && px <= bounds.maxX && py >= bounds.minY && py <= bounds.maxY,
            "grid bounds enclose CPU and GPU corners of every cell");
      }
      for (const u of [-.001, 0, .25, .5, .999, 1, 1.001]) for (const v of [0, .5, 1]) {
        const x = cell.matrix[0] * u + cell.matrix[2] * v + cell.matrix[4],
          y = cell.matrix[1] * u + cell.matrix[3] * v + cell.matrix[5], matching = containing(expanded, x, y),
          range = rasterRepeatPointRange(repeat, x, y), uv = rasterRepeatPoint(repeat, x, y),
          streamed = [...rasterRepeatPoints(repeat, x, y)];
        assert.equal(!!uv, matching.length > 0, "binary search agrees with brute-force coverage, including real gaps");
        assert.equal(streamed.length, matching.length, "all Float32-induced overlaps remain present");
        assert.equal(range ? (range.xLast - range.xFirst + 1) * (range.yLast - range.yFirst + 1) : 0,
          matching.length, "range multiplicity agrees with brute-force cells");
        matching.forEach((match, index) => {
          close(streamed[index].x, match.uv.x, "source-ordered overlap U");
          close(streamed[index].y, match.uv.y, "source-ordered overlap V");
        });
        if (uv) {
          close(uv.x, matching.at(-1).uv.x, "last matching source cell U");
          close(uv.y, matching.at(-1).uv.y, "last matching source cell V");
        }
      }
    });
    assert.equal(rasterRepeatPoint(repeat, NaN, 0), null);
    assert.equal(rasterRepeatPointRange(repeat, 0, Infinity), null);
    assert.deepEqual(repeat, original, "queries never modify reusable metadata");
  }
  const base = make(), translated = translateRasterRepeat(translateRasterRepeat(base, 1000000.3, -17 / 3), -1000000.125, .125);
  assert.deepEqual(translated.translations, Float64Array.of(1000000.3, -17 / 3, -1000000.125, .125));
  assert.equal(translated.transform, base.transform); assert.equal(translated.bounds, base.bounds);
  assert.equal(base.translations, undefined);
  assert.deepEqual(rasterRepeatMatrix(translated, 1, 2), referenceMatrix(translated, 1, 2));
  assert.throws(() => translateRasterRepeat(base, Infinity, 0), /translation/);
  for (const bad of [null, make({ transform: new Float32Array(6) }), make({ transform: new Float64Array(5) }),
    make({ transform: Float64Array.of(1, .1, 0, 1, 0, 0) }), make({ transform: Float64Array.of(0, 0, 0, 1, 0, 0) }),
    make({ bounds: Float64Array.of(0, 0, 2, 1) }), make({ bounds: Float64Array.of(0, 0, 0, 1) }),
    make({ bounds: Float64Array.of(0, 0, Infinity, 1) }), make({ xStep: 0 }), make({ yStep: NaN }),
    make({ xFirst: .5 }), make({ xLast: -4 }), make({ xLast: Number.MAX_SAFE_INTEGER + 1 }),
    make({ translations: Float64Array.of(1) }), make({ translations: Float64Array.of(0, NaN) }),
    make({ transform: Float64Array.of(1e40, 0, 0, 1, 0, 0) })]) {
    assert.throws(() => validateRasterRepeat(bad), RangeError, "malformed or unrepresentable metadata is rejected");
  }
  assert.equal(rasterRepeatCount(make({ xFirst: Number.MAX_SAFE_INTEGER, xLast: Number.MAX_SAFE_INTEGER, yFirst: 0, yLast: 0 })), 1);
  assert.equal(rasterRepeatCount(make({ xFirst: 0, xLast: Number.MAX_SAFE_INTEGER - 1, yFirst: 0, yLast: 0 })), Number.MAX_SAFE_INTEGER);
  assert.throws(() => rasterRepeatCount(make({ xFirst: 0, xLast: Number.MAX_SAFE_INTEGER, yFirst: 0, yLast: 0 })), RangeError);
  assert.throws(() => rasterRepeatCount(make({ xFirst: 0, xLast: 99999999, yFirst: 0, yLast: 99999999 })), RangeError);

  const trillion = make({ transform: Float64Array.of(.000001, 0, 0, .000001, 2 ** 26, 2 ** 26),
    bounds: Float64Array.of(0, 0, 1, 1), xStep: 1, yStep: 1, xFirst: 0, xLast: 999999, yFirst: 0, yLast: 999999 }),
    point = { x: 2 ** 26 + .0000005, y: 2 ** 26 - .0000005 }, OriginalFloat32Array = globalThis.Float32Array;
  let allocated = 0;
  try {
    globalThis.Float32Array = class extends OriginalFloat32Array {
      constructor(...args) { super(...args); allocated += this.byteLength; }
    };
    validateRasterRepeat(trillion);
    assert.equal(rasterRepeatCount(trillion), 1_000_000_000_000);
    const range = rasterRepeatPointRange(trillion, point.x, point.y);
    assert.deepEqual(range, { xFirst: 0, xLast: 999999, yFirst: 0, yLast: 999999 });
    assert(rasterRepeatPoint(trillion, point.x, point.y));
    assert(rasterRepeatBounds(trillion).maxX >= point.x);
  } finally { globalThis.Float32Array = OriginalFloat32Array; }
  assert(allocated < 1024, "trillion-cell validation/bounds/point queries allocate only small scratch matrices");

  const sampleScene = (repeat, data, width, opacity) => {
    const scene = createEmptyVectorScene(), bounds = rasterRepeatBounds(repeat);
    scene.rasterLayers = [{ repeat, data, width, height: 1, opacity, pageIndex: 0, paintOrder: 0,
      matrix: Float32Array.of(bounds.maxX - bounds.minX, 0, 0, bounds.maxY - bounds.minY, bounds.minX, bounds.minY) }];
    scene.drawRuns = [{ kind: "raster", first: 0, count: 1 }];
    scene.paintGraph = { roots: [{ kind: "draw", runIndex: 0 }] };
    return scene;
  };
  const sample = async (scene, x, y, work = { shouldYield: () => false, yield: async () => {} }) => {
    const picker = new ScenePrimitivePicker(scene), identity = point => ({ ...point });
    try { return await picker.samplePaint({ kind: "raster", index: 0 }, { x, y },
      { point: { x, y }, clientPoint: { x, y }, project: identity, unproject: identity, tolerancePx: 0 }, work); }
    finally { picker.dispose(); }
  };
  const collapsed = make({ transform: Float64Array.of(1, 0, 0, 1, 2 ** 26, 0), bounds: Float64Array.of(0, 0, 1, 1),
    xStep: 1, yStep: 1, xFirst: 0, xLast: 3, yFirst: 0, yLast: 0 });
  const alpha = await sample(sampleScene(collapsed, Uint8Array.of(64, 128, 192, 255), 1, .5), 2 ** 26 + .5, .5);
  close(alpha.color[3], 15 / 16, "four coincident half-alpha source paints compound instead of painting once");
  close(alpha.color[0], 64 / 255 * 15 / 16, "uniform premultiplied color");
  assert.equal(alpha.shape, 1);
  const massive = await sample(sampleScene(trillion, Uint8Array.of(255, 0, 0, 128), 1, .5), point.x, point.y);
  assert.deepEqual(massive.color, [1, 0, 0, 1]); assert.equal(massive.shape, 1);
  const nonuniform = make({ transform: Float64Array.of(1, 0, 0, 1, 2 ** 24, 0), bounds: Float64Array.of(0, 0, 3.05, 1),
    xStep: 3.1, yStep: 1, xFirst: 0, xLast: 3, yFirst: 0, yLast: 0 }),
    x = 2 ** 24 + 6.5, y = .5, data = Uint8Array.of(255, 0, 0, 128, 0, 0, 255, 192), expected = [0, 0, 0, 0];
  for (const match of containing(cells(nonuniform), x, y)) {
    const t = Math.max(0, Math.min(1, match.uv.x * 2 - .5)), a = (128 * (1 - t) + 192 * t) / 255 * .75,
      source = [128 / 255 * (1 - t) * .75, 0, 192 / 255 * t * .75, a];
    for (let channel = 0; channel < 4; channel++) expected[channel] = source[channel] + expected[channel] * (1 - a);
  }
  const actual = await sample(sampleScene(nonuniform, data, 2, .75), x, y);
  actual.color.forEach((value, channel) => close(value, expected[channel], "nonuniform overlapping samples preserve source order"));
  const controller = new AbortController(); controller.abort(new Error("cancelled repeat expansion"));
  assert.throws(() => buildRasterRepeatInstances(make(), controller.signal), /cancelled repeat expansion/);
  let checks = 0;
  assert.throws(() => buildRasterRepeatInstances(make({ xFirst: 0, xLast: 20000, yFirst: 0, yLast: 0 }),
    { throwIfAborted() { if (++checks === 3) throw new Error("cancelled during repeat expansion"); } }), /cancelled during repeat expansion/);
  await assert.rejects(sample(sampleScene(nonuniform, data, 2, .75), x, y,
    { shouldYield() { throw new Error("cancelled repeat sampling"); }, yield: async () => {} }), /cancelled repeat sampling/);
  console.log("Raster repeats: exact Float32 placement, validation, all-cell bounds, gaps/overlaps, source-order alpha, trillion-cell queries and cancellation passed.");
} finally { hooks.deregister(); }
