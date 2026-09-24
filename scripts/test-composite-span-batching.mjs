import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { VectorOrderedBatches } = await import("../src/vectorOrderedBatches.ts");
  const { scenePaintSpanSegments } = await import("../src/scenePaintGraph.ts");
  const { compositeScenePaintGraph } = await import("../src/scenePaintCompositor.ts");
  const { ScenePaintVisibility } = await import("../src/scenePaintVisibility.ts");
  const { buildCanonicalRunLookup, submitPaintSpan } = await import("../src/scenePaintSpanDraws.ts");

  // Fills and strokes interleaved so source order alone cannot batch them, at
  // disjoint positions so the scheduler is free to regroup them by kind. Groups
  // and a Multiply paint split the page into several spans, and one group
  // carries a soft mask, whose contents are not page paints at all.
  const scene = createEmptyVectorScene();
  scene.pageRects = Float32Array.from([0, 0, 1000, 100]);
  scene.bounds = scene.pageBounds = { minX: 0, minY: 0, maxX: 1000, maxY: 100 };
  scene.maxHalfWidth = 0.5;
  const runs = [];
  const counts = { fill: 0, stroke: 0 };
  let position = 0;
  const add = (kind, extra = {}) => {
    runs.push({ kind, first: counts[kind]++, count: 1, ...extra });
    position += 10;
    return runs.length - 1;
  };
  const group = (children, extra = {}) => ({ kind: "group", children, alpha: 1, isolated: false,
    knockout: false, blendMode: "Normal", ...extra });
  const draw = index => ({ kind: "draw", runIndex: index });
  const stripe = count => Array.from({ length: count }, (_, index) => draw(add(index % 2 ? "stroke" : "fill")));
  const roots = [];
  roots.push(...stripe(8));
  roots.push(group(stripe(8), { alpha: 0.5 }));
  roots.push(...stripe(4));
  roots.push(draw(add("fill", { blendMode: "Multiply" })));
  const masked = stripe(2);
  const maskContents = stripe(2);
  roots.push(group(masked, { softMask: { children: maskContents, subtype: "Alpha" } }));
  roots.push(...stripe(4));
  scene.drawRuns = runs;
  scene.fillPathCount = counts.fill;
  scene.segmentCount = counts.stroke;
  scene.paintGraph = { roots };
  for (const key of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) scene[key] = new Float32Array(scene.segmentCount * 4);
  for (const key of ["fillPathMetaA", "fillPathMetaB", "fillPathMetaC"]) scene[key] = new Float32Array(scene.fillPathCount * 4);
  runs.forEach((run, index) => {
    const x = index * 10, offset = run.first * 4;
    if (run.kind === "stroke") {
      scene.endpoints.set([x, 0, x + 1, 1], offset);
      scene.primitiveMeta.set([x + 1, 1, 0, 0], offset);
      scene.primitiveBounds.set([x, 0, x + 1, 1], offset);
    } else {
      scene.fillPathMetaA.set([0, 0, x, 0], offset);
      scene.fillPathMetaB.set([x + 1, 1, 0, 0], offset);
    }
  });
  const maskRuns = maskContents.map(node => node.runIndex);

  const visibility = new ScenePaintVisibility(scene);
  assert.equal(visibility.requiresCompositing, true, "the fixture must exercise the compositing path");
  const visibleRuns = visibility.select(scene.drawRuns);
  const plan = new VectorOrderedBatches(scene, null);
  plan.update(visibleRuns, 0.1);
  const segments = scenePaintSpanSegments(scene);
  assert.equal(segments.length, scene.drawRuns.length);
  assert.equal(plan.spanOrdered, true, "span ids rise along the plan's batches");
  assert(plan.batches.length < visibleRuns.length, "the plan must batch something for this test to mean anything");

  // Soft-mask contents are not page paints, so the plan never speaks for them.
  for (const index of maskRuns) assert.equal(plan.scheduledRuns[index], 0);
  assert.equal(plan.scheduledRuns[0], 1);

  const lookup = buildCanonicalRunLookup(scene);
  const spans = [];
  const adapter = { acquire: () => ({}), release() {}, clear() {}, copy() {}, pass() {},
    draw: runs => spans.push(runs.map(run => ({ ...run }))) };
  compositeScenePaintGraph(scene, adapter, {}, () => true, null);
  assert(spans.length >= 4, "groups and a blend paint must split the document into several spans");

  const submitted = [];
  let fallbacks = 0;
  for (const span of spans) {
    const before = submitted.length;
    submitPaintSpan(span, plan, segments, lookup, run => submitted.push(run));
    if (submitted.slice(before).some(run => !plan.batches.includes(run))) fallbacks++;
  }
  const planned = submitted.filter(run => plan.batches.includes(run));
  assert.deepEqual(planned, plan.batches,
    "every page batch is submitted exactly once, in the plan's order");
  assert.equal(fallbacks, 1, "only the soft mask's span falls back to submitting its own paints");
  assert.deepEqual({ visible: visibleRuns.length, batches: plan.batches.length, spans: spans.length,
    submitted: submitted.length }, { visible: 27, batches: 11, spans: 7, submitted: 13 },
    "27 interleaved paints across 7 spans reach the GPU as 13 draws, the mask's two included");

  // Every surface a group composites through is transparent outside the group's
  // own paints, so all but the root's backdrop copy carry a rectangle, and none
  // of them reaches past the page.
  const operations = [];
  const boundedAdapter = { acquire: () => ({}), release() {}, draw() {},
    clear: (_surface, _color, bounds) => operations.push(["clear", bounds]),
    copy: (_source, _destination, bounds) => operations.push(["copy", bounds]),
    pass: operation => operations.push([`pass${operation.operation}`, operation.bounds]) };
  compositeScenePaintGraph(scene, boundedAdapter, {}, () => true, null);
  const unbounded = operations.filter(([, bounds]) => !bounds);
  assert.deepEqual(unbounded.map(([name]) => name), ["copy"],
    "only the root's backdrop copy, which seeds the whole result, stays unbounded");
  assert(operations.length > 6, "the fixture must exercise several composite operations");
  for (const [name, bounds] of operations) {
    if (!bounds) continue;
    assert([bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite), `${name} bounds are finite`);
    assert(bounds.minX >= scene.pageBounds.minX - 1 && bounds.maxX <= scene.pageBounds.maxX + 1,
      `${name} bounds stay on the page`);
  }

  // Profiling must not disable destination blending or lose scissor bounds:
  // either change adds GPU work and makes the diagnostic measure itself.
  const previousDebugStats = globalThis.HEPR_DEBUG_COMPOSITE_STATS;
  const previousConsoleInfo = console.info;
  try {
    console.info = () => {};
    for (const blendsPasses of [false, true]) {
      const traces = [];
      for (const enabled of [false, true]) {
        globalThis.HEPR_DEBUG_COMPOSITE_STATS = enabled;
        const trace = [];
        let nextSurface = 0;
        const tracedAdapter = {
          blendsPasses,
          acquire() { const surface = ++nextSurface; trace.push(["acquire", surface]); return surface; },
          release: surface => trace.push(["release", surface]),
          clear: (surface, color, bounds) => trace.push(["clear", surface, color, bounds]),
          copy: (source, destination, bounds) => trace.push(["copy", source, destination, bounds]),
          draw: (runs, destination, shapeOnly) => trace.push(["draw", runs, destination, shapeOnly]),
          pass: (operation, destination) => trace.push(["pass", operation, destination])
        };
        const result = compositeScenePaintGraph(scene, tracedAdapter, 0, () => true, null);
        tracedAdapter.release(result);
        traces.push(trace);
      }
      assert.deepEqual(traces[1], traces[0],
        `diagnostics preserve every operation, capability and bound with blendsPasses=${blendsPasses}`);
      assert(traces[0].some(([name, operation]) => name === "pass" && operation.operation === (blendsPasses ? 6 : 0)),
        "the fixture must exercise the destination blending decision");
    }
  } finally {
    console.info = previousConsoleInfo;
    if (previousDebugStats === undefined) delete globalThis.HEPR_DEBUG_COMPOSITE_STATS;
    else globalThis.HEPR_DEBUG_COMPOSITE_STATS = previousDebugStats;
  }

  // Without a plan, or with one whose spans do not rise, every paint is its own draw.
  const direct = [];
  submitPaintSpan(spans[0], null, segments, lookup, run => direct.push(run));
  assert.deepEqual(direct, spans[0], "no plan submits the span's own paints");
  const unordered = [];
  plan.spanOrdered = false;
  submitPaintSpan(spans[0], plan, segments, lookup, run => unordered.push(run));
  assert.deepEqual(unordered, spans[0], "an out-of-order plan is not used");
  plan.spanOrdered = true;

  const singleton = [];
  submitPaintSpan([runs[0]], plan, segments, lookup, run => singleton.push(run));
  assert.deepEqual(singleton, [runs[0]], "one canonical run cannot expand into neighbouring paints");

  const knockout = { ...scene, drawRuns: [
    { kind: "fill", first: 0, count: 2, blendMode: "Multiply" },
    { kind: "fill", first: 2, count: 1 },
    { kind: "stroke", first: 0, count: 1 }
  ], paintGraph: { roots: [group([draw(0), draw(1), draw(2)], { knockout: true })] } };
  const knockoutSegments = scenePaintSpanSegments(knockout);
  assert.equal(new Set(knockoutSegments).size, 3, "each knockout child has an independent span");
  const knockoutPlan = new VectorOrderedBatches(knockout, null);
  knockoutPlan.update(knockout.drawRuns, 0.1);
  const part = { ...knockout.drawRuns[0], first: 1, count: 1, blendMode: undefined };
  const partial = [];
  submitPaintSpan([part], knockoutPlan, knockoutSegments, buildCanonicalRunLookup(knockout), run => partial.push(run));
  assert.deepEqual(partial, [part], "one blended primitive never expands to its multi-object canonical run");

  console.log("Composite span batching: span ids, plan coverage, soft-mask fallback and ordering passed");
} finally { hooks.deregister(); }
