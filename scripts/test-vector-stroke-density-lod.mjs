import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { STROKE_COVERAGE_GLSL, STROKE_COVERAGE_WGSL,
  STROKE_DENSITY_GLSL, STROKE_DENSITY_WGSL } from "../src/strokeCoverageShaders.ts";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c);
} });
const [{ createEmptyVectorScene }, { buildVectorStrokeLodScenes, buildRuntimeTileBuckets, VectorStrokeLodRuntime, prebuildVectorStrokeLodRuntime },
  { strokePaintOrigins }, { pdfShapeCoverageWgsl }, { CORE_STROKE_FRAGMENT_SHADER_SOURCE }] = await Promise.all([
  import("../src/emptyVectorScene.ts"), import("../src/vectorStrokeLodCore.ts"),
  import("../src/vectorStrokePaintOrder.ts"), import("../src/pdfShapeCoverage.ts"), import("../src/coreShaders.ts")
]);
hooks.deregister();

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const scalar = (source, parameters) => new Function("smoothstep", "pow", "clamp", "max",
  `return (${parameters}) => { ${source.slice(source.indexOf("{") + 1, source.lastIndexOf("}"))} };`)(
    smoothstep, Math.pow, clamp, Math.max);
const coverage = scalar(STROKE_COVERAGE_GLSL, "distanceValue, halfWidth, aaWorld");
const coverageWgsl = scalar(STROKE_COVERAGE_WGSL, "distanceValue, halfWidth, aaWorld");
const density = scalar(STROKE_DENSITY_GLSL, "alpha, primitiveType");
const densityWgsl = scalar(STROKE_DENSITY_WGSL, "alpha, primitiveType");
for (const alpha of [0, 1e-8, .001, .02, .2, .5, .99, 1]) {
  for (const type of [0, 1]) assert.equal(density(alpha, type), alpha, "canonical lines and curves keep their exact alpha");
  for (const count of [1, 8, 64, 2048]) {
    let reference = 0;
    for (let i = 0; i < count; i++) reference += (1 - reference) * alpha;
    assert(Math.abs(density(alpha, 1 - count) - reference) < 2e-13,
      "density is repeated source-over, including very faint subpixel coverage");
    assert.equal(density(alpha, 1 - count), densityWgsl(alpha, 1 - count));
  }
}
for (const distance of [0, .05, .3, .6, 1]) {
  assert.equal(coverage(distance, .12, .75), coverageWgsl(distance, .12, .75));
}

// Check the actual consumers, including knockout's shape-only shader rewrite:
// weighting must follow coverage conversion and paint opacity, not precede it.
assert.match(CORE_STROKE_FRAGMENT_SHADER_SOURCE,
  /float alpha = heprThreeLinearCoverageToOutputAlpha\(coverage\) \* vAlpha;\s*alpha = heprStrokeLodAlpha\(alpha, vPrimitiveType\);/);
const gpuSource = await readFile(new URL("../src/webGpuFloorplanRenderer.ts", import.meta.url), "utf8");
const gpuStroke = gpuSource.slice(gpuSource.indexOf("const STROKE_SHADER_SOURCE"), gpuSource.indexOf("const FILL_SHADER_SOURCE"));
assert.match(gpuStroke, /var alpha = heprLinearCoverageToOutputAlpha\(coverage\) \* inData\.alpha;\s*alpha = heprStrokeLodAlpha\(alpha, inData\.primitiveType\);/);
assert.match(pdfShapeCoverageWgsl(gpuStroke), /var alpha = heprLinearCoverageToOutputAlpha\(coverage\) \* 1\.0;\s*alpha = heprStrokeLodAlpha\(alpha, inData\.primitiveType\);/);
for (const source of [CORE_STROKE_FRAGMENT_SHADER_SOURCE, gpuStroke]) {
  assert(/alpha = heprStrokeLodAlpha\([^;]+;\s*if \(alpha <= 0\.0\)/.test(source),
    "arbitrarily faint positive coverage reaches source-over blending before and after LOD");
}
const threeSource = await readFile(new URL("../src/threeWebGpuStrokeMaterial.ts", import.meta.url), "utf8");
assert.match(threeSource, /var alpha = coverage \* alphaStyle;\s*alpha = heprStrokeLodAlpha\(alpha, primitiveType\);/);
assert(threeSource.includes("TSL.wgslFn(STROKE_DENSITY_WGSL)"));
assert(/alpha = heprStrokeLodAlpha\([^;]+;\s*if \(alpha <= 0\.0\)/.test(threeSource));

const mark = (x = .011, y = .011, extra = {}) => ({ x0: x, y0: y, x1: x, y1: y, width: .24, packed: 5, ...extra });
const makeScene = marks => {
  const count = marks.length;
  const scene = Object.assign(createEmptyVectorScene(), { segmentCount: count, maxHalfWidth: .12,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    drawRuns: [{ kind: "stroke", first: 0, count }],
    endpoints: new Float32Array(count * 4), primitiveMeta: new Float32Array(count * 4),
    primitiveBounds: new Float32Array(count * 4), styles: new Float32Array(count * 4) });
  marks.forEach((m, i) => {
    scene.endpoints.set([m.x0, m.y0, m.cx ?? m.x1, m.cy ?? m.y1], i * 4);
    scene.primitiveMeta.set([m.x1, m.y1, m.type ?? 0, m.packed], i * 4);
    scene.primitiveBounds.set(m.clip ?? [Math.min(m.x0, m.cx ?? m.x1, m.x1), Math.min(m.y0, m.cy ?? m.y1, m.y1),
      Math.max(m.x0, m.cx ?? m.x1, m.x1), Math.max(m.y0, m.cy ?? m.y1, m.y1)], i * 4);
    scene.styles.set([m.width / 2, ...(m.color ?? [0, 0, 0])], i * 4);
  });
  return scene;
};
const weight = (scene, id) => Math.max(1, 1 - scene.primitiveMeta[id * 4 + 2]);
const weights = scene => Array.from({ length: scene.segmentCount }, (_, id) => weight(scene, id));
const chooseLevel = (levels, units) => levels.findLast(level => level.tolerance <= units * 1.25);
const snapshot = scene => ["endpoints", "primitiveMeta", "primitiveBounds", "styles"].map(name => scene[name].slice());

// Coincident dots and reversed finite centerlines are exact at any scale.
for (const finite of [false, true]) {
  const scene = makeScene(Array.from({ length: 64 }, (_, id) => finite
    ? mark(.005, .011, id % 2 ? { x0: .018, x1: .005 } : { x1: .018 }) : mark()));
  const before = snapshot(scene), levels = buildVectorStrokeLodScenes(scene);
  assert(levels.length > 1);
  assert.equal(levels[1].scene.segmentCount, 1);
  assert.deepEqual(weights(levels[1].scene), [64]);
  assert.deepEqual(snapshot(scene), before, "derived LOD never changes canonical primitives");
  for (const units of [.001, .4, 1, 16, 256]) {
    for (const x of [-.8, -.1, 0, .1, .8]) for (const y of [-.7, 0, .7]) {
      const exact = sample(scene, x, y, units), reduced = sample(levels[1].scene, x, y, units);
      assert(Math.abs(exact - reduced) < 3e-13, "coincident weighted geometry equals repeated source-over at every zoom");
    }
  }
}

// Independent round-capsule distance oracle uses the generated centerlines and
// actual filter. It measures existing renderer ink, not ideal capsule area:
// the existing finite-cap filter is not a two-dimensional area convolution.
function samples(scene) {
  const result = new Map();
  for (let id = 0; id < scene.segmentCount; id++) {
    const a = id * 4, type = scene.primitiveMeta[a + 2];
    const row = [...scene.endpoints.slice(a, a + 2), ...scene.primitiveMeta.slice(a, a + 2), scene.styles[a]];
    const key = row.join(",");
    const previous = result.get(key);
    if (previous) previous.count += Math.max(1, 1 - type);
    else result.set(key, { row, count: Math.max(1, 1 - type) });
  }
  return [...result.values()];
}
function sample(scene, x, y, units, prepared = samples(scene), aa = .75) {
  let transmission = 1;
  for (const { row: [ax, ay, bx, by, radius], count } of prepared) {
    const x0 = ax / units, y0 = ay / units, dx = (bx - ax) / units, dy = (by - ay) / units;
    const t = dx * dx + dy * dy > 0 ? clamp(((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy), 0, 1) : 0;
    const distance = Math.hypot(x - x0 - t * dx, y - y0 - t * dy);
    transmission *= 1 - density(coverage(distance, radius / units, aa), 1 - count);
  }
  return 1 - transmission;
}
function compareInk(scene, reduced, units, aa) {
  const source = samples(scene), target = samples(reduced);
  let ink = 0, reducedInk = 0, l1 = 0, maxError = 0;
  const extent = Math.max(1.4, .2 / units + aa), steps = 88;
  for (let ix = 0; ix < steps; ix++) for (let iy = 0; iy < steps; iy++) {
    const x = ((ix + .37) / steps * 2 - 1) * extent;
    const y = ((iy + .61) / steps * 2 - 1) * extent;
    const expected = sample(scene, x, y, units, source, aa), actual = sample(reduced, x, y, units, target, aa);
    ink += expected; reducedInk += actual;
    l1 += Math.abs(expected - actual); maxError = Math.max(maxError, Math.abs(expected - actual));
  }
  assert(ink > 0 && reducedInk > 0, "every zoom retains the cluster's faint ink");
  return { relativeInkError: Math.abs(ink - reducedInk) / ink, relativeL1: l1 / ink, maxError };
}

const quality = [];
for (const pattern of ["eight corners", "eight segments", "repeated grid", "antiphase corners"]) {
  const count = pattern.startsWith("eight") ? 8 : 1024;
  const marks = Array.from({ length: count }, (_, id) => {
    const grid = pattern === "repeated grid";
    const x = .001 + .023 * (grid ? (id % 8) / 7 : id % 2);
    const y = .001 + .023 * (grid ? (Math.floor(id / 8) % 8) / 7 : Math.floor(id / 2) % 2);
    return pattern === "eight segments" ? mark(x * .6, y, { x1: x * .6 + .008 }) : mark(x, y);
  });
  const scene = makeScene(marks), levels = buildVectorStrokeLodScenes(scene);
  assert(levels.length > 1, `${pattern} produces actual weighted geometry`);
  for (const units of [.4, 1, 4, 16, 64]) for (const aa of [.5, .75, 1]) {
    const selected = chooseLevel(levels, units);
    assert.equal(weights(selected.scene).reduce((a, b) => a + b), scene.segmentCount,
      "adaptive subdivision preserves total source multiplicity");
    const errors = compareInk(scene, selected.scene, units, aa);
    quality.push(errors);
    assert(errors.relativeInkError < .01, `${pattern} at ${units} units/px loses less than 1% integrated ink: ${JSON.stringify(errors)}`);
    assert(errors.relativeL1 < .025, `${pattern} keeps its spatial tone: ${JSON.stringify(errors)}`);
    assert(errors.maxError < .06, `${pattern} bounds AA-edge error: ${JSON.stringify(errors)}`);
  }
}

// Dense optimization must leave isolated details exact, and must never combine
// opposing colors or paint operations across their clips and ordering barriers.
const marks = Array.from({ length: 32 }, () => mark());
marks.push(mark(1, 1), mark(1.1, 1.1, { packed: 4.5 }), mark(1.2, 1.2, { packed: 7, width: 0 }),
  mark(1.3, 1.3, { type: 1, cx: 1.31, cy: 1.32, x1: 1.32 }));
const detailScene = makeScene(marks), detailLevels = buildVectorStrokeLodScenes(detailScene);
for (const level of detailLevels) {
  const origins = strokePaintOrigins(level.scene);
  for (let source = 32; source < marks.length; source++) {
    const output = origins.indexOf(source);
    assert(output >= 0, "isolated tiny details survive every LOD");
    for (const name of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) {
      assert.deepEqual(level.scene[name].slice(output * 4, output * 4 + 4), detailScene[name].slice(source * 4, source * 4 + 4));
    }
  }
}
for (const excluded of [ { packed: 4.5 }, { packed: 7, width: 0 },
  { type: 1, cx: .012, cy: .013, x1: .014 } ]) {
  const scene = makeScene(Array.from({ length: 16 }, () => mark(.011, .011, excluded)));
  assert.equal(buildVectorStrokeLodScenes(scene).length, 1,
    "dense translucent marks, hairlines, and curves retain exact geometry");
}
const partitioned = makeScene(Array.from({ length: 32 }, (_, id) => mark(.011, .011, {
  color: id >= 16 && id < 24 ? [1, 0, 0] : [0, 0, 0], packed: 13,
  clip: id < 8 ? [-1, -1, .012, 1] : [-1, -1, 1, 1]
})));
partitioned.drawRuns = [{ kind: "stroke", first: 0, count: 24 }, { kind: "stroke", first: 24, count: 8, clipIndex: 0 }];
partitioned.clipPaths = [{ parent: -1, fillRule: 0,
  edges: Float32Array.of(-1, -1, 1, -1, 1, -1, 1, 1, 1, 1, -1, 1, -1, 1, -1, -1) }];
const partitionedLevel = buildVectorStrokeLodScenes(partitioned)[1].scene;
assert.equal(partitionedLevel.segmentCount, 4, "fragment clips, colors, and run clips remain four separate paints");
assert.deepEqual([...strokePaintOrigins(partitionedLevel)].sort((a, b) => a - b), [0, 8, 16, 24]);
// Legacy scenes have no draw-run scheduler to repair generated array order.
// A preserved blue mark must stay between two dense red paint cohorts.
for (const trailingRed of [false, true]) {
  const legacy = makeScene([
    ...Array.from({ length: 16 }, () => mark(.011, .011, { color: [1, 0, 0] })),
    mark(.011, .011, { color: [0, 0, 1] }),
    ...Array.from({ length: trailingRed ? 16 : 0 }, () => mark(.011, .011, { color: [1, 0, 0] }))
  ]);
  delete legacy.drawRuns;
  const original = paintCenter(legacy), levels = buildVectorStrokeLodScenes(legacy);
  assert(levels.length > 1);
  if (trailingRed) {
    const cooperative = await prebuildVectorStrokeLodRuntime(legacy, "force", "webgl", { yieldIntervalMs: 1 });
    assert.deepEqual(cooperative.levels.map(level => snapshot(level.scene)), levels.map(level => snapshot(level.scene)),
      "cooperative and synchronous density builders preserve the same legacy paint order");
  }
  for (const { scene } of levels.slice(1)) {
    assert.equal(scene.segmentCount, trailingRed ? 3 : 2, "separate legacy color cohorts never share one density marker");
    const actual = paintCenter(scene);
    for (let channel = 0; channel < 3; channel++) assert(Math.abs(actual[channel] - original[channel]) < 1e-12,
      "legacy derived arrays preserve source-over color order around exact marks");
  }
}
function paintCenter(scene) {
  const color = [1, 1, 1];
  for (let id = 0; id < scene.segmentCount; id++) {
    const a = id * 4;
    const alpha = density(coverage(0, scene.styles[a], .75), scene.primitiveMeta[a + 2]);
    for (let channel = 0; channel < 3; channel++) color[channel] =
      scene.styles[a + 1 + channel] * alpha + color[channel] * (1 - alpha);
  }
  return color;
}

for (const change of [ { alpha: .5 }, { knockout: true }, { blendMode: "Multiply" },
  { softMask: { subtype: "Alpha", children: [] } } ]) {
  const scene = makeScene(Array.from({ length: 16 }, () => mark()));
  scene.paintGraph = { roots: [{ kind: "group", children: [{ kind: "draw", runIndex: 0 }],
    alpha: 1, isolated: true, knockout: false, blendMode: "Normal", ...change }] };
  assert.equal(buildVectorStrokeLodScenes(scene).length, 1, "effect groups keep exact coverage and shape");
}

// The reported draw count must reflect actual selected representatives. A
// concentrated cluster exceeds the shared budget without a giant fixture.
const runtimeScene = makeScene(Array.from({ length: 60000 }, () => mark()));
const levels = buildVectorStrokeLodScenes(runtimeScene);
const edges = Float64Array.from({ length: 17 }, (_, id) => -2 + id / 4);
const grid = { columns: 16, rows: 16, minX: -2, minY: -2, maxX: 2, maxY: 2,
  tileWidth: .25, tileHeight: .25, xEdges: edges, yEdges: edges };
const runtime = new VectorStrokeLodRuntime(runtimeScene, { tileGrid: grid, elapsedMs: 0,
  levels: levels.map(level => ({ ...level, segmentCount: level.scene.segmentCount, ...buildRuntimeTileBuckets(level.scene, grid) })) });
const viewport = { width: 100, height: 100 }, bounds = runtimeScene.bounds;
const update = units => {
  runtime.updateForLocalUnitsPerPixel(units);
  runtime.update({ cameraCenterX: 0, cameraCenterY: 0, zoom: 1 / units }, viewport, bounds);
  assert.equal(runtime.getStats().renderedSegments, runtime.levels.reduce((sum, level) => sum + level.visibleSegmentCount, 0));
};
update(1);
assert.equal(runtime.getRenderedSegmentCount(), 1, "overview uploads one weighted vector for 60,000 coincident marks");
assert(runtime.getStats().activeLevels.every(level => level.tolerance <= 1.25));
update(.001);
assert.equal(runtime.getRenderedSegmentCount(), 60000, "detail zoom restores exact primitives despite tile pressure");
update(1);
runtime.setForceExact(true); update(1);
assert.equal(runtime.getRenderedSegmentCount(), 60000, "selection/highlight force-exact disables weighted geometry");
runtime.setForceExact(false);
// Tilted views bound error per tile from the projection itself, not from the
// host's center-plane scale: magnified marks stay exact, distant ones aggregate.
const tilted = [1, 0, 0, .1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
runtime.setLocalToClipTransform(tilted, 1); update(1);
assert.equal(runtime.getRenderedSegmentCount(), 60000, "a magnified tilted view keeps exact density geometry");
const distantTilt = [.02, 0, 0, .002, 0, .02, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
runtime.setLocalToClipTransform(distantTilt, 1); update(1);
assert.equal(runtime.getRenderedSegmentCount(), 1, "a distant varying-W view aggregates dense marks");

const planar = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, 9, 10];
runtime.setLocalToClipTransform(planar, 1); update(1);
assert.equal(runtime.getRenderedSegmentCount(), 1, "constant-W perspective on the PDF plane safely permits density LOD");

const worst = Object.fromEntries(["relativeInkError", "relativeL1", "maxError"].map(key => [key, Math.max(...quality.map(row => row[key]))]));
console.log(`Dense vector LOD preserves source-over tone and isolated detail; overview instances 60000 → 1; worst sampled errors ${JSON.stringify(worst)}.`);
