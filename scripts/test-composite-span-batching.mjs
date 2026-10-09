import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { VectorOrderedBatches } = await import("../src/vectorOrderedBatches.ts");
  const { normalizeScenePaintGraph, planScenePaintPasses, scenePaintSpanSegments, scenePaintNodeBounds } = await import("../src/scenePaintGraph.ts");
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

  // A genuine opacity group anywhere in a document selects the compositor
  // globally. Ordinary layer wrappers elsewhere must still share one span.
  const layerRuns = runs.slice(0, 8).map(run => ({ ...run }));
  layerRuns[2].optionalContent = 1;
  const inheritedChild = Object.freeze(draw(0));
  const sameConditionChild = Object.freeze({ ...draw(2), optionalContent: 0 });
  const layerRoots = [
    group([inheritedChild], { optionalContent: 0 }),
    group([draw(1)], { optionalContent: 0 }),
    group([sameConditionChild], { optionalContent: 0 }),
    draw(3), group([draw(4), draw(5)], { optionalContent: 0 }),
    group([draw(6), draw(7)], { optionalContent: 0, alpha: 0.5 })
  ];
  const freezeNodes = nodes => {
    for (const node of nodes) {
      if (node.kind === "group") freezeNodes(node.children);
      Object.freeze(node);
    }
    return Object.freeze(nodes);
  };
  const layerScene = { ...scene, drawRuns: layerRuns, paintGraph: { roots: freezeNodes(layerRoots) } };
  const normalized = normalizeScenePaintGraph(layerScene);
  assert.equal(normalized.length, 7, "ordinary layer wrappers flatten while the opacity group survives");
  assert.equal(normalized[0].optionalContent, 0);
  assert.notEqual(normalized[0], inheritedChild, "condition inheritance clones the source node");
  assert.equal(inheritedChild.optionalContent, undefined, "the source graph is immutable");
  assert.equal(normalized[2], sameConditionChild, "an identical existing condition needs no replacement");
  assert.equal(normalized[6].alpha, 0.5, "real opacity remains a composite boundary");
  assert.equal(normalizeScenePaintGraph(layerScene), normalized, "normalization is cached independently of visibility");
  const layerSegments = scenePaintSpanSegments(layerScene);
  assert.equal(new Set(layerSegments.slice(0, 6)).size, 1, "ordinary layers share one span");
  assert.notEqual(layerSegments[5], layerSegments[6], "group opacity splits the span");
  const layerPlan = new VectorOrderedBatches(layerScene, null);
  layerPlan.update(layerRuns, 0.1);
  assert.equal(layerPlan.batches.length, 4, "eight paints with an opacity boundary need only four batches");
  const drawIndices = (target, visible) => planScenePaintPasses(target, visible)
    .filter(pass => pass.kind === "draw").map(pass => pass.runIndex);
  for (const layerVisible of [false, true]) for (const runVisible of [false, true]) {
    const visible = id => id === undefined || (id === 0 ? layerVisible : runVisible);
    const expected = drawIndices(layerScene, visible);
    assert.deepEqual(drawIndices({ ...layerScene, paintGraph: { roots: normalized } }, visible), expected,
      "inherited node conditions and run-owned conditions retain their intersection after a layer toggle");
    const layerSpans = [];
    compositeScenePaintGraph(layerScene, { ...adapter, draw: span => layerSpans.push(span) }, {}, visible, null);
    const actual = layerSpans.flatMap(span => span.flatMap(range => layerRuns.flatMap((run, index) =>
      run.kind === range.kind && run.first >= range.first && run.first + run.count <= range.first + range.count ? [index] : [])));
    assert.deepEqual(actual, expected, "the compositor paints exactly the visible source paints");
    assert.equal(layerSpans.length, layerVisible ? 2 : 1, "only the real opacity effect splits visible spans");
  }

  // Technical drawings can wrap every stroke/fill in a singleton Darken
  // group. Equal source colors can share one group without changing a run,
  // clip, optional-content condition, or the canonical source graph.
  const darkenScene = createEmptyVectorScene();
  const darkenCount = 256;
  darkenScene.pageRects = Float32Array.of(0, 0, darkenCount * 3, 10);
  darkenScene.fillPathCount = darkenCount;
  for (const key of ["fillPathMetaA", "fillPathMetaB", "fillPathMetaC"]) darkenScene[key] = new Float32Array(darkenCount * 4);
  darkenScene.drawRuns = Array.from({ length: darkenCount }, (_value, index) => ({ kind: "fill", first: index, count: 1 }));
  for (let index = 0; index < darkenCount; index++) {
    darkenScene.fillPathMetaA.set([0, 0, index * 3, 0], index * 4);
    darkenScene.fillPathMetaB.set([index * 3 + 1, 1, 0.25, 0.5], index * 4);
    darkenScene.fillPathMetaC.set([0, 0, 0.75, 0.5], index * 4);
  }
  darkenScene.paintGraph = { roots: freezeNodes(darkenScene.drawRuns.map((_run, index) =>
    group([{ ...draw(index), optionalContent: index % 2 }], { blendMode: "Darken" }))) };
  const darkenSource = structuredClone(darkenScene);
  const mergedDarken = normalizeScenePaintGraph(darkenScene);
  assert.equal(mergedDarken.length, 1, "long equal-color Darken spans group without a paint-count limit");
  assert.deepEqual(mergedDarken[0].children, darkenScene.paintGraph.roots.map(node => node.children[0]),
    "merged sources retain every child condition and paint in source order");
  const separateDarken = normalizeScenePaintGraph(darkenScene, false);
  assert.equal(separateDarken.length, darkenCount, "disabled color batching retains singleton groups");
  assert.equal(normalizeScenePaintGraph(darkenScene), mergedDarken, "enabled normalization retains its own cached graph");
  assert.equal(normalizeScenePaintGraph(darkenScene, false), separateDarken, "disabled normalization retains its own cached graph");
  assert.equal(new Set(scenePaintSpanSegments(darkenScene)).size, 1, "the merged Darken source has one batchable span");
  assert.equal(new Set(scenePaintSpanSegments(darkenScene, false)).size, darkenCount, "disabled spans keep every blend boundary");
  const mergedBounds = scenePaintNodeBounds(darkenScene), separateBounds = scenePaintNodeBounds(darkenScene, false);
  assert(mergedBounds.nodes.has(mergedDarken[0].children), "bounds address the enabled graph's merged child list");
  assert(separateBounds.nodes.has(separateDarken[0].children), "bounds address the disabled graph's original child lists");
  assert.notEqual(mergedBounds, separateBounds, "group extent caches follow color-batching eligibility");
  assert.deepEqual(darkenScene, darkenSource, "normalization never rewrites canonical paints or metadata");
  for (const change of [
    target => { target.fillPathMetaB[6] = 0.5; },
    target => { target.fillPathMetaC[6] = NaN; },
    target => { target.paintGraph.roots[1].alpha = 0.5; },
    target => { target.paintGraph.roots[1].softMask = { children: [], subtype: "Alpha" }; },
    target => { target.paintGraph.roots[1].knockout = true; },
    target => { target.paintGraph.roots[1].optionalContent = 1; },
    target => { target.paintGraph.roots[1].alphaIsShape = true; },
    target => { target.drawRuns[1].blendMode = "Multiply"; },
    target => { target.fillPathMetaC = new Float32Array(0); },
    target => { target.drawRuns[1].count = 2; target.fillPathMetaB[10] = 0.5; },
    target => {
      target.fillPathMetaB[2] = target.fillPathMetaB[3] = target.fillPathMetaC[2] = 0;
      target.drawRuns[1] = { kind: "text", first: 0, count: 1 };
      target.textInstanceC = Float32Array.of(0, 0, 0, 0.5);
    }
  ]) {
    const barrier = structuredClone(darkenScene);
    barrier.drawRuns = barrier.drawRuns.slice(0, 2);
    barrier.paintGraph.roots = barrier.paintGraph.roots.slice(0, 2);
    change(barrier);
    assert.equal(normalizeScenePaintGraph(barrier).length, 2,
      "color differences, unknown colors, effects and differing group conditions retain boundaries");
  }
  const knockedDarken = structuredClone(darkenScene);
  knockedDarken.paintGraph.roots = [group([group(knockedDarken.paintGraph.roots, { alpha: 0.5 })], { knockout: true })];
  assert.equal(normalizeScenePaintGraph(knockedDarken)[0].children[0].children.length, darkenCount,
    "Darken groups never merge under a knockout ancestor");
  const textDarken = structuredClone(darkenScene);
  textDarken.drawRuns = [0, 1].map(first => ({ kind: "text", first, count: 1 }));
  textDarken.paintGraph.roots = textDarken.paintGraph.roots.slice(0, 2);
  textDarken.textInstanceC = Float32Array.of(0.501, 0.501, 0.501, 0.5, 128 / 255, 128 / 255, 128 / 255, 0.5);
  assert.equal(normalizeScenePaintGraph(textDarken).length, 1,
    "text color equivalence uses the uploaded RGBA8_UNORM values");
  const crossKindDarken = structuredClone(darkenScene);
  crossKindDarken.segmentCount = darkenCount / 2;
  crossKindDarken.fillPathCount = darkenCount / 2;
  for (const key of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) crossKindDarken[key] = new Float32Array(crossKindDarken.segmentCount * 4);
  crossKindDarken.drawRuns = Array.from({ length: darkenCount }, (_value, index) =>
    ({ kind: index % 2 ? "stroke" : "fill", first: Math.floor(index / 2), count: 1 }));
  for (let index = 0; index < crossKindDarken.segmentCount; index++) {
    const x = index * 3, offset = index * 4;
    crossKindDarken.endpoints.set([x, 0, x + 1, 1], offset);
    crossKindDarken.primitiveMeta.set([x + 1, 1, 0, 0], offset);
    crossKindDarken.primitiveBounds.set([x, 0, x + 1, 1], offset);
    crossKindDarken.styles.set([0.5, 0.25, 0.5, 0.75], offset);
  }
  const crossKindPlan = new VectorOrderedBatches(crossKindDarken, null);
  crossKindPlan.update(crossKindDarken.drawRuns, 0.1);
  assert.equal(normalizeScenePaintGraph(crossKindDarken).length, 1,
    "equal float RGB stroke/fill sources share one Darken composite");
  assert.equal(crossKindPlan.batches.length, 2, "interleaved stroke/fill sources batch into one draw per program");
  const assertCrossKindInstances = () => {
    for (const kind of ["stroke", "fill"]) {
      const ids = crossKindPlan.batches.filter(batch => batch.kind === kind).flatMap(batch =>
        Array.from({ length: batch.count }, (_value, index) => crossKindPlan.uintInstances[(batch.first + index) * 2]));
      assert.deepEqual(ids, Array.from({ length: darkenCount / 2 }, (_value, index) => index),
        "cross-kind batching draws every canonical primitive exactly once");
    }
  };
  assertCrossKindInstances();
  crossKindPlan.setColorCommutationEnabled(false);
  crossKindPlan.update(crossKindDarken.drawRuns, 0.1);
  assert.equal(crossKindPlan.batches.length, darkenCount, "color overrides restore each stroke/fill Darken effect");
  assertCrossKindInstances();
  crossKindPlan.setColorCommutationEnabled(true);
  crossKindPlan.update(crossKindDarken.drawRuns, 0.1);
  assert.equal(crossKindPlan.batches.length, 2, "restoring source colors regroups cross-kind draws");
  assertCrossKindInstances();

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
