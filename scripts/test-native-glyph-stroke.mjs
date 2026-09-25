import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
} });

const identity = [1, 0, 0, 1, 0, 0];
const defaults = { transform: identity, width: 4, lineCap: 0, lineJoin: 0,
  miterLimit: 10, dashArray: [], dashPhase: 0 };
const move = (x, y) => ({ kind: "move", x, y });
const line = (x, y) => ({ kind: "line", x, y });
const close = { kind: "close" };
const square = [move(20, 20), line(65, 20), line(65, 65), line(20, 65), close];
const corners = [move(15, 55), line(40, 20), line(65, 55), line(85, 20)];

try {
  const { buildNativeGlyphStroke, buildNativeGlyphStrokeAtOrigin, nativeGlyphStrokeCacheKey } = await import("../src/pdf/nativeGlyphStroke.ts");
  let comparisons = 0;
  const compare = (name, commands, options = {}, local = identity, zoom = 6) => {
    const style = { ...defaults, ...options };
    const geometry = buildNativeGlyphStroke(commands, multiply(style.transform, local), style);
    assert.ok(geometry, name);
    const placement = multiply(style.transform, local);
    const shared = buildNativeGlyphStrokeAtOrigin(commands, placement, style);
    assert.equal(shared.segmentsA.length, geometry.segmentsA.length, `${name}: sharing preserves the stroke silhouette`);
    for (let i = 0; i < geometry.segmentsA.length; i++) {
      assert.ok(Math.abs(shared.segmentsA[i] + placement[4 + i % 2] - geometry.segmentsA[i]) < 1e-7,
        `${name}: local stroke coordinates retain the complete transformed pen`);
      const translation = i % 4 < 2 ? placement[4 + i % 2] : 0;
      assert.ok(Math.abs(shared.segmentsB[i] + translation - geometry.segmentsB[i]) < 1e-7, name);
    }
    assert.equal(geometry.segmentsA.length, geometry.segmentsB.length, name);
    assert.ok(geometry.segmentsA.length / 4 <= 2048, name);
    assert.ok(geometry.segmentsA.every(Number.isFinite), name);
    const expected = render(context => {
      context.transform(...style.transform);
      context.beginPath();
      for (const command of commands) pathCommand(context, command, local);
      context.lineWidth = style.width;
      context.lineCap = ["butt", "round", "square"][style.lineCap];
      context.lineJoin = ["miter", "round", "bevel"][style.lineJoin];
      context.miterLimit = style.miterLimit;
      context.setLineDash(style.dashArray);
      context.lineDashOffset = style.dashPhase;
      context.stroke();
    }, zoom);
    const actual = render(context => {
      context.beginPath();
      let start = null;
      let previous = null;
      for (let offset = 0; offset < geometry.segmentsA.length; offset += 4) {
        const [x0, y0, x1, y1] = geometry.segmentsA.slice(offset, offset + 4);
        if (!previous || x0 !== previous[0] || y0 !== previous[1]) {
          if (start) context.closePath();
          context.moveTo(x0, y0);
          start = [x0, y0];
        }
        context.lineTo(x1, y1);
        previous = [x1, y1];
        if (x1 === start[0] && y1 === start[1]) {
          context.closePath();
          start = previous = null;
        }
      }
      if (start) context.closePath();
      context.fill("nonzero");
    }, zoom);
    let error = 0;
    let ink = 0;
    let hardMismatch = 0;
    for (let offset = 3; offset < actual.length; offset += 4) {
      error += Math.abs(actual[offset] - expected[offset]);
      ink += expected[offset];
      if (Math.abs(actual[offset] - expected[offset]) > 64) hardMismatch += 1;
      assert.ok(actual[offset] <= 128, `${name}: overlapping geometry must not apply alpha twice`);
    }
    assert.ok(error / ink < 0.025, `${name}: relative alpha error ${error / ink}, hard mismatch ${hardMismatch}`);
    comparisons += 1;
    return geometry;
  };

  const rect = compare("closed outline keeps its hole", square);
  assert.deepEqual(rect.bounds, { minX: 18, minY: 18, maxX: 67, maxY: 67 });
  assert.equal(rect.approximated, false);
  for (const lineJoin of [0, 1, 2]) {
    for (const lineCap of [0, 1, 2]) compare(`join ${lineJoin}, cap ${lineCap}`, corners, { lineJoin, lineCap });
  }
  compare("miter limit bevel", [move(20, 60), line(50, 15), line(45, 60)], { miterLimit: 1.5 });
  assert.equal(compare("miter limit one preserves sharp bevels", square, { miterLimit: 1 }).approximated, false);
  assert.equal(compare("miter limit one merges shallow bevels",
    [move(15, 50), line(50, 50), line(85, 50.3)], { miterLimit: 1 }).approximated, true);
  compare("clockwise and counterclockwise holes", [...square,
    move(30, 30), line(30, 55), line(55, 55), line(55, 30), close]);
  const curve = [move(20, 45), { kind: "quadratic", controlX: 20, controlY: 10, x: 50, y: 20 },
    { kind: "cubic", control1X: 90, control1Y: 30, control2X: 70, control2Y: 80, x: 40, y: 65 }, close];
  assert.equal(compare("quadratic and cubic curves", curve).approximated, true);
  const thinCurve = buildNativeGlyphStroke(curve, identity, { ...defaults, width: 0.148, lineJoin: 1 });
  assert.ok(thinCurve.segmentsA.length / 4 < 1500);
  const lowMiterCurve = buildNativeGlyphStroke(curve, identity, { ...defaults, width: 0.16, miterLimit: 1 });
  assert.ok(lowMiterCurve.segmentsA.length / 4 < 1500, "low miter limits must not exhaust the edge budget on smooth curves");
  assert.equal(lowMiterCurve.approximated, true);
  compare("thin curved glyph at high zoom", curve, { width: 0.148, lineJoin: 1 }, [0.1, 0, 0, 0.1, 0, 0], 48);
  compare("miter limit one at high zoom", curve, { width: 0.16, miterLimit: 1 }, [0.1, 0, 0, 0.1, 0, 0], 48);
  compare("reflected sheared stroke space", curve,
    { transform: [-0.85, 0.2, 0.3, 0.8, 88, 5], lineJoin: 1 }, [1, 0.1, 0, 0.9, 0, 0]);
  compare("miter limit one in reflected sheared stroke space", curve,
    { transform: [-0.85, 0.2, 0.3, 0.8, 8.8, 0.5], width: 0.16, miterLimit: 1 }, [0.1, 0.01, 0, 0.09, 0, 0], 48);
  compare("text transform differs from graphics-state transform", square,
    { transform: [1.1, 0.15, 0.35, 0.75, 8, 8] }, [0.5, -0.1, 0.1, 1.2, 0, 0]);
  compare("closed dash seam joins", square, { dashArray: [17, 6], dashPhase: 4, lineCap: 2 });
  compare("odd dash pattern", corners, { dashArray: [7, 3, 2], dashPhase: 3, lineCap: 1, lineJoin: 2 });
  compare("negative dash phase", square, { dashArray: [12, 4], dashPhase: -7 });
  compare("dashed curved outline", curve, { dashArray: [9, 5], lineCap: 1, dashPhase: 3 });
  compare("dashed curved outline with miter limit one", curve,
    { width: 0.16, miterLimit: 1, dashArray: [0.9, 0.5], dashPhase: 0.3 }, [0.1, 0, 0, 0.1, 0, 0], 64);
  compare("zero off dash joins continuous ink", corners, { dashArray: [6, 0], lineCap: 2 });
  compare("zero on dash paints round dots", corners, { dashArray: [0, 8], lineCap: 1 });
  compare("zero on dash paints square dots", corners, { dashArray: [0, 8], lineCap: 2 });
  compare("reversed segment round join", [move(20, 30), line(60, 30), line(30, 30)], { lineJoin: 1 });
  for (const lineCap of [1, 2]) {
    compare(`zero-length segment cap ${lineCap}`, [move(25, 25), line(25, 25)], { lineCap });
    compare(`zero-length closed contour cap ${lineCap}`, [move(25, 25), close], { lineCap });
  }
  let randomState = 37281;
  const random = () => ((randomState = Math.imul(randomState, 1664525) + 1013904223 >>> 0) / 4294967296);
  for (let index = 0; index < 12; index += 1) {
    const path = [move(15 + random() * 70, 15 + random() * 70)];
    for (let segment = 0; segment < 5; segment += 1) path.push(line(15 + random() * 70, 15 + random() * 70));
    if (index % 2) path.push(close);
    compare(`self-overlapping contour ${index}`, path, { lineCap: index % 3, lineJoin: index % 3, miterLimit: 2.5 });
  }

  const cacheKey = nativeGlyphStrokeCacheKey(0, 65, identity, defaults);
  assert.equal(nativeGlyphStrokeCacheKey(0, 65, [1, 0, 0, 1, 300, 40],
    { ...defaults, transform: [1, 0, 0, 1, -17, 6] }), cacheKey, "glyph and pen translations do not duplicate geometry");
  for (const change of [
    { width: 2 }, { lineCap: 1 }, { lineJoin: 1 }, { miterLimit: 2 }, { dashPhase: 1 },
    { dashArray: [1, 2] }, { transform: [1, .2, .3, 2, 0, 0] }
  ]) assert.notEqual(nativeGlyphStrokeCacheKey(0, 65, identity, { ...defaults, ...change }), cacheKey);
  assert.notEqual(nativeGlyphStrokeCacheKey(0, 65, [1, .2, .3, 2, 0, 0], defaults), cacheKey);
  assert.notEqual(nativeGlyphStrokeCacheKey(1, 65, identity, defaults), cacheKey);
  assert.notEqual(nativeGlyphStrokeCacheKey(0, 66, identity, defaults), cacheKey);

  const { buildNativeVectorTextStrokes } = await import("../src/pdf/nativeVectorTextStroke.ts");
  const count = 100, text = { glyphs: { glyphIds: new Uint32Array(count).fill(65), fontIndices: new Uint32Array(count),
    flags: new Uint8Array(count), transformIndices: Uint32Array.from({ length: count }, (_, i) => i) },
    transforms: { values: Float32Array.from(Array.from({ length: count }, (_, i) => [1, 0, 0, 1, i * 100, 0]).flat()) } };
  const makeStores = () => Object.fromEntries(["instanceA", "instanceB", "instanceC", "glyphMetaA", "glyphMetaB", "glyphSegmentsA", "glyphSegmentsB"].map(key => [key, new Float32Array()]));
  const compiled = { pathCount: 0, fillSegmentsA: [], fillSegmentsB: [], endpoints: [] };
  const sidecar = { glyphRunMeta: [0, count, 0], glyphStrokePaints: [{ ...defaults, color: [0, 0, 0, 1] }] };
  const stores = makeStores(), bounds = { minX: 0, minY: 0, maxX: count * 100, maxY: 100 };
  const outline = buildNativeGlyphStrokeAtOrigin(curve, identity, defaults);
  const coordinateBudget = outline.segmentsA.length + outline.segmentsB.length;
  buildNativeVectorTextStrokes(compiled, sidecar, text, stores, [{ getGlyphOutline: () => ({ commands: curve }) }],
    bounds, count, coordinateBudget);
  assert.equal(stores.instanceA.length / 4, count);
  assert.equal(stores.glyphMetaA.length / 4, 1, "100 translated glyphs use one outline");
  assert.equal(stores.glyphSegmentsA.length + stores.glyphSegmentsB.length, coordinateBudget,
    "coordinate budgets charge shared geometry once");
  assert.throws(() => buildNativeVectorTextStrokes(compiled, sidecar, text, makeStores(),
    [{ getGlyphOutline: () => ({ commands: curve }) }], bounds, count - 1, coordinateBudget),
    error => error.details?.reason === "vector-glyph-stroke-limit", "path budgets still count glyph instances");

  const denseContour = Array.from({ length: 1100 }, (_, i) => {
    const angle = i * Math.PI * 2 / 1100;
    return { kind: i ? "line" : "move", x: 40 + Math.cos(angle) * 20, y: 40 + Math.sin(angle) * 20 };
  });
  denseContour.push(close);
  const denseGeometry = buildNativeGlyphStrokeAtOrigin(denseContour, identity, defaults), denseStores = makeStores();
  const denseEdges = denseGeometry.segmentsA.length / 4;
  assert.ok(denseEdges > 2048 && denseEdges <= 4096, "valid detailed strokes exceed the former shader ceiling");
  buildNativeVectorTextStrokes(compiled, sidecar, text, denseStores,
    [{ getGlyphOutline: () => ({ commands: denseContour }) }], bounds, count,
    denseGeometry.segmentsA.length + denseGeometry.segmentsB.length);
  assert.equal(denseStores.glyphMetaA.length / 4, 1, "large outlines are still shared");
  assert.equal(denseStores.glyphMetaA[1], denseEdges, "the full valid outline reaches the shader metadata");
  assert.deepEqual(denseStores.glyphSegmentsA, Float32Array.from(denseGeometry.segmentsA));
  assert.deepEqual(denseStores.glyphSegmentsB, Float32Array.from(denseGeometry.segmentsB));

  assert.equal(buildNativeGlyphStroke([], identity, defaults), null);
  assert.throws(() => buildNativeGlyphStroke(square, identity, { ...defaults, width: 0 }),
    error => error.code === "unsupported-content");
  assert.throws(() => buildNativeGlyphStroke(square, identity, { ...defaults, transform: [0, 0, 0, 0, 0, 0] }),
    error => error.code === "unsupported-content");
  assert.throws(() => buildNativeGlyphStroke(square, identity, { ...defaults, dashArray: [0, 0] }),
    error => error.code === "unsupported-content");
  assert.throws(() => buildNativeGlyphStroke(square, identity, { ...defaults, dashArray: [0.0001, 0.0001] }),
    error => error.code === "unsupported-content" && error.details.reason === "native-glyph-stroke-complexity");
  assert.throws(() => buildNativeGlyphStroke(Array(65537).fill(move(0, 0)), identity, defaults),
    error => error.code === "resource-limit");
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => buildNativeGlyphStroke(square, identity, defaults, controller.signal),
    error => error.code === "aborted");
  console.log(`Native glyph stroke: ${comparisons} Canvas pixel comparisons and boundedness checks passed.`);
} finally {
  hooks.deregister();
}

function render(draw, zoom) {
  const canvas = createCanvas(660, 660);
  const context = canvas.getContext("2d");
  context.scale(zoom, zoom);
  context.globalAlpha = 0.5;
  draw(context);
  return context.getImageData(0, 0, 660, 660).data;
}

function multiply(a, b) {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

function pathCommand(context, command, matrix) {
  const point = (x, y) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
  if (command.kind === "move") context.moveTo(...point(command.x, command.y));
  else if (command.kind === "line") context.lineTo(...point(command.x, command.y));
  else if (command.kind === "quadratic") context.quadraticCurveTo(...point(command.controlX, command.controlY), ...point(command.x, command.y));
  else if (command.kind === "cubic") context.bezierCurveTo(...point(command.control1X, command.control1Y),
    ...point(command.control2X, command.control2Y), ...point(command.x, command.y));
  else context.closePath();
}
