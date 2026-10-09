import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { compositeScenePaintGraph } = await import("../src/scenePaintCompositor.ts");
  const { ThreeScenePaintPlan } = await import("../src/threeScenePaintPlan.ts");
  const group = (children, settings = {}) => ({ kind: "group", isolated: false, knockout: false,
    alpha: 1, blendMode: "Normal", children, ...settings });
  const draw = runIndex => ({ kind: "draw", runIndex });
  const scene = Object.assign(createEmptyVectorScene(), {
    drawRuns: [
      { kind: "stroke", first: 0, count: 2 },
      { kind: "fill", first: 0, count: 1 },
      { kind: "gradient-fill", first: 0, count: 1 },
      { kind: "fill", first: 1, count: 1 },
      { kind: "gradient-fill", first: 1, count: 1 },
      { kind: "stroke", first: 2, count: 2, blendMode: "Multiply" },
      { kind: "raster", first: 0, count: 1 },
      { kind: "stroke", first: 4, count: 1, optionalContent: 1 }
    ],
    paintGraph: { roots: [draw(0), group([draw(1)], { alpha: .5, isolated: true,
      softMask: { subtype: "Luminosity", children: [draw(2)], backdrop: [.1, .2, .3] } }),
    group([draw(3)], { alpha: .7, softMask: { subtype: "Alpha", children: [draw(4)] } }),
    group([draw(5), draw(6)], { isolated: false, knockout: true, alpha: .8, blendMode: "Screen",
      softMask: { subtype: "Luminosity", children: [draw(2)], transfer: Float32Array.of(0, .2, 1) } }),
    group([draw(7)], { optionalContent: 1, alpha: .4 }),
    { kind: "retained", retainedPage: 0, firstCommand: 0, count: 1, rasterIndex: 0 }] }
  });

  for (const blendsPasses of [false, true]) for (const canFold of [false, true]) for (const canFoldMask of [false, true]) {
    const state = { blendsPasses, canFold, canFoldMask, projection: 0, visible: true };
    const plan = new ThreeScenePaintPlan();
    let visibleCalls = 0;
    const visible = condition => { visibleCalls++; return condition !== 1 || state.visible; };
    const expected = executeOriginal(scene, state, visible, null);
    const initial = executePlan(plan, scene, state, visible, null);
    assert.deepEqual(initial, expected, "recorded plans preserve all source, mask, knockout, blend and lifetime operations");
    assert.equal(plan.reused, false);
    assert(visibleCalls > 0);
    visibleCalls = 0;
    assert.deepEqual(executePlan(plan, scene, state, visible, null), expected);
    assert.equal(plan.reused, true);
    assert.equal(visibleCalls, 0, "stable frames skip graph traversal and visibility checks");

    state.projection++;
    assert.deepEqual(executePlan(plan, scene, state, visible, null), executeOriginal(scene, state, visible, null),
      "fresh mask vectors and projected rectangles are applied while reusing the graph plan");
    assert.equal(plan.reused, true);

    const selected = Uint8Array.from(scene.drawRuns.map(() => 1));
    selected[5] = 0;
    assert.deepEqual(executePlan(plan, scene, state, visible, selected), executeOriginal(scene, state, visible, selected));
    assert.equal(plan.reused, false);
    executePlan(plan, scene, state, visible, selected);
    assert.equal(plan.reused, true);
    selected[5] = 1; selected[7] = 0;
    assert.deepEqual(executePlan(plan, scene, state, visible, selected), executeOriginal(scene, state, visible, selected),
      "a reused culling array never retains a stale selection");
    assert.equal(plan.reused, false);

    state.visible = false;
    assert.deepEqual(executePlan(plan, scene, state, visible, selected, 1), executeOriginal(scene, state, visible, selected));
    assert.equal(plan.reused, false, "optional-content changes rebuild the plan");
    state.visible = true; selected[7] = 1;
    assert.deepEqual(executePlan(plan, scene, state, visible, selected, 2), executeOriginal(scene, state, visible, selected),
      "hidden content returns when its optional-content revision changes");
    assert.equal(plan.reused, false);
    executePlan(plan, scene, state, visible, selected, 2, 2);
    assert.equal(plan.reused, false, "replacement scheduled proxies rebuild the plan");
    executePlan(plan, scene, state, visible, selected, 2, 2, 65);
    assert.equal(plan.reused, false, "a resized compositor rebuilds the plan");

    state.canFold = !state.canFold;
    assert.deepEqual(executePlan(plan, scene, state, visible, selected, 2, 2, 65), executeOriginal(scene, state, visible, selected));
    assert.equal(plan.reused, false, "material fold capability changes invalidate before drawing");
    state.canFold = true;
    executePlan(plan, scene, state, visible, selected, 2, 2, 65);
    state.canFoldMask = !state.canFoldMask;
    assert.deepEqual(executePlan(plan, scene, state, visible, selected, 2, 2, 65), executeOriginal(scene, state, visible, selected));
    assert.equal(plan.reused, false, "projection or mask eligibility changes fall back to the full mask path");
    state.canFoldMask = false;
    executePlan(plan, scene, state, visible, selected, 2, 2, 65);
    state.canFoldMask = true;
    assert.deepEqual(executePlan(plan, scene, state, visible, selected, 2, 2, 65), executeOriginal(scene, state, visible, selected));
    assert.equal(plan.reused, false, "removing a material override restores the computed-mask path with unchanged selection");
    state.blendsPasses = !state.blendsPasses;
    assert.deepEqual(executePlan(plan, scene, state, visible, selected, 2, 2, 65), executeOriginal(scene, state, visible, selected));
    assert.equal(plan.reused, false, "a changed adapter blend capability rebuilds the pass operations");
    const replacement = { ...scene };
    executePlan(plan, replacement, state, visible, selected, 2, 2, 65);
    assert.equal(plan.reused, false, "a replacement streaming scene rebuilds the plan");
    state.visible = true;
    assert.deepEqual(executePlan(plan, replacement, state, visible, null, undefined), executeOriginal(replacement, state, visible, null));
    state.visible = false;
    assert.deepEqual(executePlan(plan, replacement, state, visible, null, undefined), executeOriginal(replacement, state, visible, null));
    assert.equal(plan.reused, false, "callers without visibility revisions retain dynamic callback behavior");
  }

  const state = { blendsPasses: true, canFold: true, canFoldMask: true, projection: 0, visible: true };
  const monochrome = Object.assign(createEmptyVectorScene(), {
    fillPathCount: 2,
    fillPathMetaA: Float32Array.of(0, 0, 0, 0, 0, 0, 1, 1),
    fillPathMetaB: Float32Array.of(10, 10, .5, .5, 11, 11, .5, .5),
    fillPathMetaC: Float32Array.of(0, 0, .5, .6, 0, 0, .5, .7),
    drawRuns: [{ kind: "fill", first: 0, count: 1 }, { kind: "fill", first: 1, count: 1 }],
    paintGraph: { roots: [group([draw(0)], { blendMode: "Darken" }), group([draw(1)], { blendMode: "Darken" })] }
  });
  const colorPlan = new ThreeScenePaintPlan();
  const batched = executePlan(colorPlan, monochrome, state, () => true, null);
  assert.deepEqual(batched, executeOriginal(monochrome, state, () => true, null));
  assert.equal(batched.filter(operation => operation[0] === "draw").length, 1,
    "equal-color Darken groups share one draw span");
  executePlan(colorPlan, monochrome, state, () => true, null);
  assert.equal(colorPlan.reused, true);
  const unbatched = executePlan(colorPlan, monochrome, state, () => true, null, 0, 0, 64, false);
  assert.deepEqual(unbatched, executeOriginal(monochrome, state, () => true, null, false));
  assert.equal(colorPlan.reused, false, "primitive color changes invalidate cached color-dependent group batching");
  assert.equal(unbatched.filter(operation => operation[0] === "draw").length, 2,
    "disabled color batching retains separate Darken groups");
  executePlan(colorPlan, monochrome, state, () => true, null, 0, 0, 64, false);
  assert.equal(colorPlan.reused, true);
  assert.deepEqual(executePlan(colorPlan, monochrome, state, () => true, null), batched);
  assert.equal(colorPlan.reused, false, "restored source colors rebuild the batched plan");
  assert.deepEqual(executePlan(colorPlan, monochrome, state, () => true, null, undefined, 0, 64, false), unbatched,
    "uncached plans also respect disabled color batching");

  const plan = new ThreeScenePaintPlan();
  executePlan(plan, scene, state, () => true, null);
  const failing = makeAdapter(state);
  failing.adapter.pass = () => { throw new Error("draw failed"); };
  assert.throws(() => plan.execute(scene, failing.adapter, { id: 0 }, () => true, null, 0, 0, 64, 32), /draw failed/);
  assert.equal(failing.live.size, 0, "failed replay releases every acquired surface and leaves the caller's backdrop alone");
  plan.clear();
  assert.equal(plan.operations, 0);
  console.log("Three scene paint plans passed: exact operation/lifetime parity, dynamic mask projections, visibility/culling/scene/proxy/resize/capability invalidation and failure cleanup.");

  function executePlan(plan, input, state, visible, selected, revision, structure = 0, width = 64, colorBatchingEnabled = true) {
    if (arguments.length < 6) revision = 0;
    const host = makeAdapter(state);
    const result = plan.execute(input, host.adapter, { id: 0 }, visible, selected, revision, structure, width, 32, colorBatchingEnabled);
    host.live.delete(result.id);
    assert.equal(host.live.size, 0);
    return host.operations;
  }
  function executeOriginal(input, state, visible, selected, colorBatchingEnabled = true) {
    const host = makeAdapter(state);
    const result = compositeScenePaintGraph(input, host.adapter, { id: 0 }, visible, selected, true, colorBatchingEnabled);
    host.live.delete(result.id);
    assert.equal(host.live.size, 0);
    return host.operations;
  }
  function makeAdapter(state) {
    const live = new Set(), operations = [];
    let nextId = 0, acceptedMask;
    const remap = operation => Object.fromEntries(Object.entries(operation).filter(([, value]) => value !== undefined).map(([key, value]) =>
      [key, ["source", "shape", "current", "stats", "initial", "mask"].includes(key) ? value?.id : value]));
    const adapter = {
      blendsPasses: state.blendsPasses,
      acquire() { const surface = { id: ++nextId }; live.add(surface.id); operations.push(["acquire", surface.id]); return surface; },
      release(surface) { assert(live.delete(surface.id)); operations.push(["release", surface.id]); },
      clear(surface, color, bounds) { operations.push(["clear", surface.id, color, bounds, state.projection]); },
      copy(source, destination, bounds) { operations.push(["copy", source.id, destination.id, bounds, state.projection]); },
      draw(runs, destination, shapeOnly) { operations.push(["draw", runs, destination.id, shapeOnly]); },
      pass(operation, destination) { operations.push(["pass", remap(operation), destination.id, state.projection]); },
      canFold(run) { return state.canFold && run.kind === "fill"; },
      canFoldMaskPaint(run, maskRun) { acceptedMask = { first: maskRun.first, projection: state.projection }; return state.canFoldMask; },
      drawFolded(run, destination, opacity, mask, content, maskRun) {
        if (maskRun) assert.deepEqual(acceptedMask, { first: maskRun.first, projection: state.projection });
        operations.push(["fold", run, destination.id, opacity, mask?.id, content, maskRun, maskRun ? acceptedMask : undefined]);
      }
    };
    return { adapter, live, operations };
  }
} finally { hooks.deregister(); }
