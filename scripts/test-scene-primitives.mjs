import assert from "node:assert/strict";
import { createHook } from "node:async_hooks";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });

try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { getScenePrimitive, getPrimitiveClipChain, getPrimitiveSegmentClipBounds,
    validatePrimitiveRef, ScenePrimitivePicker } = await import("../src/scenePrimitives.ts");
  const identity = point => ({ ...point });
  const query = (x, y, extra = {}) => ({ point: { x, y }, clientPoint: { x, y }, project: identity,
    unproject: identity, tolerancePx: 0, ...extra });
  const scene = () => ({ ...createEmptyVectorScene(), pageCount: 1,
    pageRects: new Float32Array([-100, -100, 100, 100]), pageTextRanges: new Uint32Array([0, 0]) });
  const appendStroke = (s, start, end, { control, halfWidth = 0.5, alpha = 1, flags = 0 } = {}) => {
    const append = (target, values) => new Float32Array([...target, ...values]);
    const i = s.segmentCount++;
    s.endpoints = append(s.endpoints, [...start, ...(control ?? end)]);
    s.primitiveMeta = append(s.primitiveMeta, [...end, control ? 1 : 0, flags * 2 + alpha]);
    s.styles = append(s.styles, [halfWidth, 1, 0, 0]);
    s.primitiveBounds = append(s.primitiveBounds, [Math.min(start[0], end[0], control?.[0] ?? start[0]),
      Math.min(start[1], end[1], control?.[1] ?? start[1]), Math.max(start[0], end[0], control?.[0] ?? start[0]),
      Math.max(start[1], end[1], control?.[1] ?? start[1])]);
    return i;
  };
  const rectangle = (x0, y0, x1, y1) => [
    [x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]
  ];
  const setFill = (s, edges, evenodd = false) => {
    s.fillPathCount = 1; s.fillSegmentCount = edges.length;
    s.fillPathMetaA = new Float32Array([0, edges.length, 0, 0]);
    s.fillPathMetaB = new Float32Array([10, 10, 0, 1]);
    s.fillPathMetaC = new Float32Array([+evenodd, 0, 0, 1]);
    s.fillSegmentsA = new Float32Array(edges.flat());
    s.fillSegmentsB = new Float32Array(edges.flatMap(edge => [edge[2], edge[3], 0, 0]));
  };
  const ref = (kind, index = 0) => ({ kind, index });
  const hitRef = async (picker, options) => (await picker.pick(options))?.primitive ?? null;

  {
    const s = scene();
    appendStroke(s, [0, 0], [10, 0]); appendStroke(s, [0, 0], [10, 0]);
    const picker = new ScenePrimitivePicker(s);
    assert.deepEqual(await hitRef(picker, query(5, 0)), ref("stroke", 1));
    assert.deepEqual(await hitRef(picker, query(5, 0, { resolvePaintRank: primitive => primitive.index === 0 ? 100 : 0 })), ref("stroke", 0),
      "layer-reordered picking uses current ranks without stale spatial-index rank pruning");
    assert.deepEqual(await hitRef(picker, query(5, 0)), ref("stroke", 1), "custom ranks do not mutate the reusable source index");
    picker.dispose();
  }

  {
    const s = scene();
    appendStroke(s, [0, 0], [10, 0]);
    appendStroke(s, [0, 10], [10, 10], { control: [5, 20], halfWidth: 0 });
    const original = s.endpoints.slice();
    const info = getScenePrimitive(s, ref("stroke", 1));
    assert.deepEqual(info.getSegment(0), { start: { x: 0, y: 10 }, control: { x: 5, y: 20 }, end: { x: 10, y: 10 } });
    assert.equal(info.pageIndex, 0);
    assert.equal(info.strokeWidth, 0);
    info.getSegment(0).start.x = 99;
    info.color[0] = 99;
    assert.deepEqual(s.endpoints, original, "getter points are detached");
    assert.equal(s.styles[5], 1, "getter color is detached");
    const style = info.getSegmentStyle(0);
    assert.deepEqual(style, { color: [1, 0, 0], opacity: 1, strokeWidth: 0, hairline: false, roundCap: false });
    style.color[0] = 99;
    assert.equal(info.getSegmentStyle(0).color[0], 1, "segment styles are detached from both scene and earlier results");
    info.ref.kind = "text"; info.ref.index = 999;
    assert.equal(info.getSegmentStyle(0).strokeWidth, 0, "mutating returned reference cannot change the snapshot accessors");
    assert.throws(() => info.getSegment(1), RangeError);
    assert.throws(() => info.getSegmentStyle(1), RangeError);
    for (const bad of [null, ref("invalid"), ref("stroke", -1), ref("stroke", 0.5), ref("stroke", 2)])
      assert.throws(() => validatePrimitiveRef(s, bad), RangeError);
    const picker = new ScenePrimitivePicker(s);
    assert.deepEqual(await hitRef(picker, query(5, 0.4)), ref("stroke"));
    assert.equal(await picker.pick(query(5, 0.6)), null);
    assert.deepEqual(await hitRef(picker, query(5, 1.5, { tolerancePx: 1 })), ref("stroke"));
    const curve = await picker.pick(query(5, 15));
    assert.deepEqual(curve?.primitive, ref("stroke", 1));
    assert(Math.abs(curve.closestPoint.x - 5) < 1e-5 && Math.abs(curve.closestPoint.y - 15) < 1e-5);
    assert.equal(await picker.pick(query(5, 15, { kinds: ["fill"] })), null);
    picker.dispose();
    await assert.rejects(picker.pick(query(5, 0)), /disposed/);
  }
  {
    const s = scene();
    appendStroke(s, [0, 0], [10, 0], { halfWidth: 0, flags: 1 });
    appendStroke(s, [20, 0], [20, 0], { flags: 2 });
    appendStroke(s, [30, 0], [30, 0]);
    appendStroke(s, [0, 2], [10, 2], { alpha: 0 });
    const picker = new ScenePrimitivePicker(s);
    assert.deepEqual(await hitRef(picker, query(5, 0.49)), ref("stroke"), "hairlines occupy screen pixels");
    assert.equal(getScenePrimitive(s, ref("stroke")).getSegmentStyle(0).hairline, true);
    assert.equal(getScenePrimitive(s, ref("stroke", 1)).getSegmentStyle(0).roundCap, true);
    assert.equal(await picker.pick(query(5, 0.6)), null);
    assert.deepEqual(await hitRef(picker, query(20, 0)), ref("stroke", 1), "round zero-length marks remain selectable");
    assert.equal(await picker.pick(query(30, 0)), null);
    assert.equal(await picker.pick(query(5, 2)), null);
  }
  {
    const s = scene();
    setFill(s, [...rectangle(0, 0, 10, 10), ...rectangle(3, 3, 7, 7)], true);
    const picker = new ScenePrimitivePicker(s);
    assert.deepEqual(await hitRef(picker, query(1, 1)), ref("fill"));
    assert.deepEqual(getScenePrimitive(s, ref("fill")).getSegmentStyle(0), { color: [0, 1, 0], opacity: 1 });
    assert.equal(await picker.pick(query(5, 5)), null, "even-odd holes must not hit");
    assert.deepEqual(await hitRef(picker, query(3.5, 5, { tolerancePx: 0.5 })), ref("fill"), "path boundaries can be picked with tolerance");
    const solid = scene(); setFill(solid, [...rectangle(0, 0, 10, 10), ...rectangle(3, 3, 7, 7)]);
    assert.deepEqual(await hitRef(new ScenePrimitivePicker(solid), query(5, 5)), ref("fill"), "nonzero fill retains same-winding overlap");
    assert.equal(await picker.pick(query(11, 11)), null);
  }
  {
    const s = scene(); setFill(s, rectangle(0, 0, 10, 10));
    appendStroke(s, [0, 5], [10, 5]);
    s.drawRuns = [{ kind: "stroke", first: 0, count: 1 }, { kind: "fill", first: 0, count: 1 }];
    assert.deepEqual(await hitRef(new ScenePrimitivePicker(s), query(5, 5)), ref("fill"), "source order beats fixed kind ordering");
    const legacy = { ...s, drawRuns: undefined };
    assert.deepEqual(await hitRef(new ScenePrimitivePicker(legacy), query(5, 5)), ref("stroke"), "legacy order matches rendering passes");
  }
  {
    const s = scene(); appendStroke(s, [0, 5], [10, 5], { flags: 4 });
    s.primitiveBounds.set([2, 4, 8, 6]);
    s.clipPaths = [
      { parent: -1, fillRule: 1, edges: new Float32Array([...rectangle(0, 0, 10, 10), ...rectangle(4, 4, 6, 6)].flat()) },
      { parent: 0, fillRule: 0, edges: new Float32Array(rectangle(0, 0, 7, 10).flat()) }
    ];
    s.drawRuns = [{ kind: "stroke", first: 0, count: 1, clipIndex: 1 }];
    assert.deepEqual(getPrimitiveClipChain(s, ref("stroke")), { clipIndex: 1, rect: { minX: 2, minY: 4, maxX: 8, maxY: 6 } });
    const style = getScenePrimitive(s, ref("stroke")).getSegmentStyle(0);
    style.clipBounds.minX = -999;
    assert.equal(getScenePrimitive(s, ref("stroke")).getSegmentStyle(0).clipBounds.minX, 2);
    const picker = new ScenePrimitivePicker(s);
    assert.deepEqual(await hitRef(picker, query(3, 5)), ref("stroke"));
    for (const x of [1, 5, 7.5]) assert.equal(await picker.pick(query(x, 5, { tolerancePx: 20 })), null, "tolerance cannot bypass clips");
    const hidden = scene(); appendStroke(hidden, [-10, 5], [-1, 5]);
    hidden.clipPaths = [{ parent: -1, fillRule: 0, edges: new Float32Array(rectangle(0, 0, 10, 10).flat()) }];
    hidden.drawRuns = [{ kind: "stroke", first: 0, count: 1, clipIndex: 0 }];
    assert.equal(await new ScenePrimitivePicker(hidden).pick(query(0.1, 5, { tolerancePx: 2 })), null,
      "a stroke wholly outside its clip cannot be picked from the visible side with tolerance");
  }
  {
    const s = scene();
    const edges = rectangle(0, 0, 2, 2);
    s.textInstanceCount = s.textGlyphCount = 1; s.textGlyphSegmentCount = 4;
    s.textGlyphMetaA = new Float32Array([0, 4, 0, 0]); s.textGlyphMetaB = new Float32Array([2, 2, 0, 0]);
    s.textGlyphSegmentsA = new Float32Array(edges.flat()); s.textGlyphSegmentsB = new Float32Array(edges.flatMap(e => [e[2], e[3], 0, 0]));
    s.textInstanceA = new Float32Array([0, 2, -1, 0]); s.textInstanceB = new Float32Array([10, 10, 0, 1]);
    s.textInstanceC = new Float32Array([0, 0, 1, 1]); s.textClipRects = new Float32Array([8, 10, 10, 12]);
    s.pageTextRanges = new Uint32Array([0, 1]);
    const info = getScenePrimitive(s, ref("text"));
    assert.deepEqual(info.getSegment(0), { start: { x: 10, y: 10 }, end: { x: 10, y: 14 } });
    assert.deepEqual(info.getSegmentStyle(0), { color: [0, 0, 1], opacity: 1,
      clipBounds: { minX: 8, minY: 10, maxX: 10, maxY: 12 } });
    const picker = new ScenePrimitivePicker(s);
    assert.deepEqual(await hitRef(picker, query(9, 11)), ref("text"));
    assert.equal(await picker.pick(query(9, 13)), null, "text's rectangular clip applies after its transform");
  }
  {
    const s = scene();
    s.rasterLayers = [{ width: 2, height: 1, data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 255]),
      matrix: new Float32Array([0, 10, -10, 0, 10, 0]), pageIndex: 0, paintOrder: 0 }];
    const picker = new ScenePrimitivePicker(s);
    assert.equal(await picker.pick(query(5, 1)), null, "transparent raster pixels do not hit");
    assert.deepEqual(await hitRef(picker, query(5, 9)), ref("raster"));
    assert.deepEqual(await hitRef(picker, query(5, 10.5, { tolerancePx: 0.5 })), ref("raster"));
    assert.equal(getScenePrimitive(s, ref("raster")).segmentCount, 4);
    assert.deepEqual(getScenePrimitive(s, ref("raster")).getSegmentStyle(0), { color: null, opacity: 1 });
    assert.deepEqual(getScenePrimitive(s, ref("raster")).quad[1], { x: 10, y: 10 });
    const singular = { ...s, rasterLayers: [{ ...s.rasterLayers[0], matrix: new Float32Array(6) }] };
    assert.equal(await new ScenePrimitivePicker(singular).pick(query(0, 0)), null);
  }
  {
    const s = scene(); setFill(s, rectangle(0, 0, 10, 10));
    s.gradientCount = 2;
    s.gradientMetaA = new Float32Array(8); s.gradientMetaB = new Float32Array([1, 0, 0, 1, 1, 0, 0, 1]);
    s.gradientMetaC = new Float32Array(8); s.gradientMetaD = new Float32Array([10, 0, 0, 0, 10, 0, 0, 0]);
    s.gradientMetaE = new Float32Array(8); s.gradientLut = new Uint8Array(2 * 1024 * 4);
    for (let i = 0; i < 1024; i++) { s.gradientLut[i * 4 + 3] = 255; s.gradientLut[(1024 + i) * 4 + 3] = i < 512 ? 0 : 255; }
    s.gradientFillPathCount = 1; s.gradientFillSegmentCount = 4;
    for (const suffix of ["PathMetaA", "PathMetaB", "PathMetaC", "SegmentsA", "SegmentsB"]) s[`gradientFill${suffix}`] = s[`fill${suffix}`];
    s.fillPathCount = 0; s.gradientFillPaintMeta = new Float32Array([0, 1, 0, 0]);
    const picker = new ScenePrimitivePicker(s);
    assert.equal(await picker.pick(query(1, 5)), null, "gradient soft mask applies");
    assert.deepEqual(await hitRef(picker, query(9, 5)), ref("gradient-fill"));
    assert.equal(getScenePrimitive(s, ref("gradient-fill")).color, null);
    const paint = getScenePrimitive(s, ref("gradient-fill"));
    assert.equal(paint.gradientIndex, 0); assert.equal(paint.maskGradientIndex, 1);
    assert.deepEqual(paint.getSegmentStyle(0), { color: null, opacity: 1 });
    const maskedEdge = { ...s, gradientMetaB: s.gradientMetaB.slice(), gradientLut: s.gradientLut.slice() };
    maskedEdge.gradientMetaB.set([0, 0, -1, 0], 4);
    for (let i = 0; i < 1024; i++) maskedEdge.gradientLut[(1024 + i) * 4 + 3] = i === 0 ? 0 : 255;
    assert.equal(await new ScenePrimitivePicker(maskedEdge).pick(query(5, -1, { tolerancePx: 1 })), null,
      "the cursor's opaque mask sample cannot make a transparent nearest edge selectable");
    const strokeScene = scene(); appendStroke(strokeScene, [0, 5], [10, 5], { flags: 4 });
    Object.assign(strokeScene, { gradientCount: s.gradientCount, gradientMetaA: s.gradientMetaA, gradientMetaB: s.gradientMetaB,
      gradientMetaC: s.gradientMetaC, gradientMetaD: s.gradientMetaD, gradientMetaE: s.gradientMetaE, gradientLut: s.gradientLut,
      gradientStrokeRunCount: 1, gradientStrokeSegmentCount: 1,
      gradientStrokeRunMetaA: new Float32Array([0, 1, 0, 1]), gradientStrokeRunMetaB: new Float32Array([0, 0, 0, 0]),
      gradientStrokeEndpoints: strokeScene.endpoints, gradientStrokePrimitiveMeta: strokeScene.primitiveMeta,
      gradientStrokeStyles: strokeScene.styles, gradientStrokePrimitiveBounds: new Float32Array([2, 4, 9, 6]), segmentCount: 0 });
    const strokePicker = new ScenePrimitivePicker(strokeScene);
    assert.equal(await strokePicker.pick(query(1, 5)), null);
    assert.deepEqual(await hitRef(strokePicker, query(8, 5)), ref("gradient-stroke"));
    assert.equal(await strokePicker.pick(query(9.5, 5)), null, "gradient-stroke per-member clip applies");
    assert.equal(getPrimitiveSegmentClipBounds(strokeScene, ref("gradient-stroke"), 0).maxX, 9);
    const mixed = { ...strokeScene, gradientStrokeRunMetaA: new Float32Array([0, 2, -1, 1]),
      gradientStrokeEndpoints: new Float32Array([0, 5, 10, 5, 0, 6, 10, 6]),
      gradientStrokePrimitiveMeta: new Float32Array([10, 5, 0, 0.25, 10, 6, 0, 6.75]),
      gradientStrokeStyles: new Float32Array([1, 1, 0, 0, 2, 0, 1, 0]), gradientStrokeSegmentCount: 2 };
    const run = getScenePrimitive(mixed, ref("gradient-stroke"));
    assert.equal(run.color, null); assert.equal(run.opacity, null);
    assert.equal(run.gradientIndex, null); assert.equal(run.maskGradientIndex, 1);
    assert.deepEqual(run.getSegmentStyle(0), { color: [1, 0, 0], opacity: 0.25, strokeWidth: 2, hairline: false, roundCap: false });
    assert.deepEqual(run.getSegmentStyle(1), { color: [0, 1, 0], opacity: 0.75, strokeWidth: 4, hairline: true, roundCap: true });
  }
  {
    const s = scene(); appendStroke(s, [0, 0], [10, 0], { halfWidth: 0 });
    const picker = new ScenePrimitivePicker(s);
    const project = p => ({ x: 100 + 3 * p.x, y: 200 + 2 * p.y });
    const unproject = p => ({ x: (p.x - 100) / 3, y: (p.y - 200) / 2 });
    const options = query(5, 1, { clientPoint: project({ x: 5, y: 1 }), project, unproject, tolerancePx: 2 });
    assert.deepEqual(await hitRef(picker, options), ref("stroke"), "CSS tolerance uses projected distances");
    assert.equal(await picker.pick({ ...options, tolerancePx: 1.9 }), null);
    const diagonal = scene(); appendStroke(diagonal, [0, 0], [10, 10], { halfWidth: 1 });
    const diagonalPicker = new ScenePrimitivePicker(diagonal);
    const diagonalProject = p => ({ x: p.x * 10, y: p.y });
    const diagonalUnproject = p => ({ x: p.x / 10, y: p.y });
    const normal = { x: -1 / Math.sqrt(101), y: 10 / Math.sqrt(101) };
    const diagonalQuery = (distance, tolerancePx = 0) => {
      const clientPoint = { x: 50 + normal.x * distance, y: 5 + normal.y * distance };
      return { point: diagonalUnproject(clientPoint), clientPoint, project: diagonalProject, unproject: diagonalUnproject, tolerancePx };
    };
    assert.deepEqual(await hitRef(diagonalPicker, diagonalQuery(1.3)), ref("stroke"), "nonuniform scaling preserves the projected stroke ribbon width");
    assert.equal(await diagonalPicker.pick(diagonalQuery(1.8)), null);
    const ribbonTolerance = await diagonalPicker.pick(diagonalQuery(1.8, 0.4));
    assert.deepEqual(ribbonTolerance?.primitive, ref("stroke"));
    assert(Math.abs(ribbonTolerance.distancePx - (1.8 - Math.sqrt(200 / 101))) < 1e-5,
      "tolerance is measured from the projected ribbon boundary");
    const capClient = { x: 105, y: 10 };
    assert.deepEqual(await hitRef(diagonalPicker, { point: diagonalUnproject(capClient), clientPoint: capClient,
      project: diagonalProject, unproject: diagonalUnproject, tolerancePx: 0 }), ref("stroke"), "projected end disk remains selectable under nonuniform scale");
    const perspectiveProject = p => ({ x: p.x / (1 + p.x * 0.05), y: p.y / (1 + p.x * 0.05) });
    const perspectiveUnproject = p => ({ x: p.x / (1 - p.x * 0.05), y: p.y / (1 - p.x * 0.05) });
    const hit = await picker.pick(query(7, 0, { clientPoint: perspectiveProject({ x: 7, y: 0 }), project: perspectiveProject, unproject: perspectiveUnproject }));
    assert(Math.abs(hit.closestPoint.x - 7) < 1e-6, "line closest point is perspective-correct");
    const horizonScene = scene(); appendStroke(horizonScene, [100, 0], [100, 10], { halfWidth: 0 });
    const horizon = await new ScenePrimitivePicker(horizonScene).pick(query(0, 0, {
      tolerancePx: 3, project: p => ({ x: p.x / (1 - p.x * 0.5), y: p.y / (1 - p.x * 0.5) }),
      unproject: p => ({ x: p.x / (1 + p.x * 0.5), y: p.y / (1 + p.x * 0.5) })
    }));
    assert.deepEqual(horizon?.primitive, ref("stroke"), "finite unprojection corners can still straddle the horizon");
    const negative = scene(); appendStroke(negative, [-30, -20], [-10, -20]);
    assert.deepEqual(await hitRef(new ScenePrimitivePicker(negative), query(-15, -20)), ref("stroke"));
    await assert.rejects(picker.pick(query(0, 0, { tolerancePx: -1 })), RangeError);
    await assert.rejects(picker.pick(query(0, 0, { kinds: ["bad"] })), RangeError);
  }
  {
    // Measure allocation overhead rather than imposing a machine-dependent
    // timing limit. Index construction must yield in batches, not per item.
    const s = scene(), count = 2048;
    s.segmentCount = count;
    for (const key of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) s[key] = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const offset = i * 4, y = i * 2;
      s.endpoints.set([0, y, 1, y], offset);
      s.primitiveMeta.set([1, y, 0, 1], offset);
      s.primitiveBounds.set([0, y, 1, y], offset);
      s.styles.set([0.25, 1, 0, 0], offset);
    }
    const progress = [], completedWithIndex = [];
    const picker = new ScenePrimitivePicker(s, percentage => {
      progress.push(percentage);
      if (percentage === 100) completedWithIndex.push(!!picker.index);
    });
    let promises = 0, first;
    const allocations = createHook({ init(_id, type) { if (type === "PROMISE") promises++; } });
    allocations.enable();
    try { first = await hitRef(picker, query(0.5, (count - 1) * 2)); }
    finally { allocations.disable(); }
    assert.deepEqual(first, ref("stroke", count - 1));
    assert(promises < count, `Index build allocated ${promises} promises for ${count} primitives; batch its yields`);
    assert.equal(progress[0], 0);
    assert.equal(progress.at(-1), 100);
    assert.deepEqual(completedWithIndex, [true], "100% is reported only after the complete hierarchy is usable");
    assert(progress.length > 2 && progress.length <= 101, "build reports intermediate percentages without per-item callbacks");
    assert(progress.every((value, index) => Number.isInteger(value) && (index === 0 || value > progress[index - 1])),
      "progress is monotonic and each integer percentage is reported at most once");
    const completedProgress = progress.slice();
    assert.deepEqual(await hitRef(picker, query(0.5, (count - 1) * 2)), first, "warm and cold picks agree");
    assert.deepEqual(progress, completedProgress, "warm queries do not restart build progress");
    picker.dispose();
  }
  {
    const s = scene(), members = 4096;
    s.gradientStrokeRunCount = 1; s.gradientStrokeSegmentCount = members;
    s.gradientStrokeRunMetaA = new Float32Array([0, members, -1, -1]);
    s.gradientStrokeRunMetaB = new Float32Array(4);
    for (const key of ["gradientStrokeEndpoints", "gradientStrokePrimitiveMeta", "gradientStrokeStyles", "gradientStrokePrimitiveBounds"])
      s[key] = new Float32Array(members * 4);
    for (let i = 0; i < members; i++) {
      s.gradientStrokeEndpoints.set([0, i, 1, i], i * 4);
      s.gradientStrokePrimitiveMeta.set([1, i, 0, 1], i * 4);
      s.gradientStrokeStyles.set([0.25, 1, 0, 0], i * 4);
    }
    const progress = [], abort = new AbortController();
    const picker = new ScenePrimitivePicker(s, percentage => progress.push(percentage));
    const canceledWait = picker.pick(query(-10, -10, { signal: abort.signal }));
    abort.abort();
    await assert.rejects(canceledWait, error => error.name === "AbortError");
    assert.equal(await picker.pick(query(-10, -10)), null);
    assert.deepEqual(progress, Array.from({ length: 101 }, (_, i) => i),
      "a shared build continues reporting gradient-member work after an individual request aborts");
    picker.dispose();
  }
  {
    // This crossed the old index-memory cutoff and silently fell back to a
    // complete geometric scan. Grouped leaves must keep dense drawings indexed
    // without allocating a hierarchy entry for every primitive.
    const s = scene(), count = 2 ** 20;
    s.segmentCount = count;
    for (const key of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) s[key] = new Float32Array(count * 4);
    const firstRows = [0, 0, -20, -10, -10, -30];
    for (let i = 0; i < count; i++) {
      const offset = i * 4;
      const y = firstRows[i] ?? i * 4;
      s.endpoints[offset + 1] = s.endpoints[offset + 3] = y;
      s.endpoints[offset + 2] = 1;
      s.primitiveMeta[offset] = s.primitiveMeta[offset + 3] = 1;
      s.primitiveMeta[offset + 1] = y;
      s.primitiveBounds[offset + 1] = s.primitiveBounds[offset + 3] = y;
      s.primitiveBounds[offset + 2] = 1;
      s.styles[offset] = 0.25;
      s.styles[offset + 1] = 1;
    }
    s.drawRuns = [
      { kind: "stroke", first: 1, count: 1 },
      { kind: "stroke", first: 3, count: count - 3 },
      { kind: "stroke", first: 2, count: 1 },
      { kind: "stroke", first: 0, count: 1 }
    ];
    const progress = [], completedWithIndex = [], abort = new AbortController();
    const picker = new ScenePrimitivePicker(s, value => {
      progress.push(value);
      if (value === 100) completedWithIndex.push(!!picker.index);
    });
    const canceledWait = picker.pick(query(0.5, 0, { signal: abort.signal }));
    abort.abort();
    await assert.rejects(canceledWait, error => error.name === "AbortError");
    assert.deepEqual(await hitRef(picker, query(0.5, 0)), ref("stroke", 0),
      "a dense shared build survives a canceled waiter and respects reordered paints inside a group");
    assert.equal(picker.index.groupSize, 2);
    assert.equal(picker.index.ids.length, count / 2, "the dense index groups canonical primitives to stay within its memory budget");
    assert.equal(progress[0], 0);
    assert.equal(progress.at(-1), 100);
    assert.deepEqual(completedWithIndex, [true], "dense preparation cannot report completion before installing an index");
    assert(progress.length > 2 && progress.length <= 101, "dense preparation reports bounded intermediate progress");
    assert(progress.every((value, index) => Number.isInteger(value) && (index === 0 || value > progress[index - 1])),
      "dense preparation reports strictly increasing percentages");
    const completedProgress = progress.slice();
    assert.deepEqual(await hitRef(picker, query(0.5, -10)), ref("stroke", 4),
      "a group's latest paint cannot promote another member above the actual latest overlapping primitive");
    assert.deepEqual(await hitRef(picker, query(0.5, (count - 1) * 4)), ref("stroke", count - 1),
      "warm dense picks retain late canonical indices after spatial packing");
    assert.deepEqual(await hitRef(picker, query(0.5, 0)), ref("stroke", 0), "warm and cold dense picks agree");
    let projected = 0;
    assert.equal(await picker.pick(query(0.5, 26, { project(point) { projected++; return point; } })), null,
      "empty space inside a group's combined bounds remains unselectable");
    assert.equal(projected, 0, "group members outside the query bounds are rejected before expensive geometry projection");
    assert.equal(await picker.pick(query(-10, -100, { project(point) { projected++; return point; } })), null);
    assert.equal(projected, 0, "an outlying empty query does not project the entire dense scene");
    assert.deepEqual(progress, completedProgress, "warm dense queries reuse the prepared index");
    picker.dispose();
    assert.equal(picker.index, null, "disposing releases the dense hierarchy");
    await assert.rejects(picker.pick(query(0.5, 0)), /disposed/);
  }
  {
    const emptyProgress = [], empty = new ScenePrimitivePicker(scene(), value => emptyProgress.push(value));
    assert.equal(await empty.pick(query(0, 0)), null);
    assert.deepEqual(emptyProgress, [0, 100], "an empty scene immediately finishes preparation");

    const s = scene(); appendStroke(s, [0, 0], [1, 0]);
    const disposedProgress = [], disposed = new ScenePrimitivePicker(s, value => disposedProgress.push(value));
    const pending = disposed.pick(query(0.5, 0));
    disposed.dispose();
    await assert.rejects(pending, /disposed/);
    assert.deepEqual(disposedProgress, [0], "disposal suppresses all late progress and failure notifications");

    const lastStepProgress = [];
    const disposedAtLastStep = new ScenePrimitivePicker(s, value => {
      lastStepProgress.push(value);
      if (value === 99) disposedAtLastStep.dispose();
    });
    await assert.rejects(disposedAtLastStep.pick(query(0.5, 0)), /disposed/);
    assert.equal(disposedAtLastStep.index, null, "an observer disposing at the last construction step cannot retain the new index");
    assert.equal(lastStepProgress.at(-1), 99, "disposal during an observer callback suppresses completion");

    const observerFailure = new ScenePrimitivePicker(s, () => { throw new Error("observer failed"); });
    assert.deepEqual(await hitRef(observerFailure, query(0.5, 0)), ref("stroke"), "an observer cannot corrupt a usable index");
    const failing = scene(), failureProgress = [];
    appendStroke(failing, [0, 0], [1, 0]);
    Object.defineProperty(failing, "styles", { get() { throw new Error("build failed"); } });
    const failure = new ScenePrimitivePicker(failing, value => failureProgress.push(value));
    await assert.rejects(failure.pick(query(0.5, 0)), /build failed/);
    assert.deepEqual(failureProgress, [0, null], "failed builds notify observers even without completing the hierarchy");
  }
  {
    // Exercise spatially shuffled packing against the independently known last
    // matching paint. Dense overlapping leaves must retain source identity.
    const s = scene();
    for (let i = 0; i < 1500; i++) appendStroke(s, [i % 31, (i * 17) % 101], [i % 31 + 10, (i * 17) % 101]);
    const picker = new ScenePrimitivePicker(s);
    for (let y = 0; y < 101; y += 7) {
      let expected = null;
      for (let i = s.segmentCount - 1; i >= 0; i--) if (s.endpoints[i * 4] <= 20 && s.primitiveMeta[i * 4] >= 20 && s.endpoints[i * 4 + 1] === y) { expected = ref("stroke", i); break; }
      assert.deepEqual(await hitRef(picker, query(20, y)), expected);
    }
    const abort = new AbortController();
    const pending = new ScenePrimitivePicker(s).pick(query(20, 10, { signal: abort.signal }));
    abort.abort(); await assert.rejects(pending, error => error.name === "AbortError");
    const disposed = new ScenePrimitivePicker(s), request = disposed.pick(query(20, 10));
    disposed.dispose(); await assert.rejects(request, /disposed/);
    const interrupted = new AbortController();
    let projects = 0;
    await assert.rejects(picker.pick(query(20, 10, { signal: interrupted.signal, project(point) {
      if (++projects === 2) interrupted.abort(); return point;
    } })), error => error.name === "AbortError");
  }
  console.log("Canonical primitive inspection, all-kind picking, clips, alpha, ordering, projection and cancellation passed.");
} finally { hooks.deregister(); }
