import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { OptionalContentController } = await import("../src/optionalContent.ts");
  const { ScenePaintVisibility, sceneRequiresPaintCompositing } = await import("../src/scenePaintVisibility.ts");
  const scene = Object.assign(createEmptyVectorScene(), {
    drawRuns: [
      { kind: "stroke", first: 0, count: 1, optionalContent: 0 },
      { kind: "fill", first: 0, count: 1, optionalContent: 1 },
      { kind: "stroke", first: 1, count: 1 }
    ],
    optionalContent: { groups: ["A", "B"].map(id => ({ id, name: id, defaultVisible: true, locked: false, usedInView: true })),
      conditions: [{ kind: "group", groupId: "A" }, { kind: "group", groupId: "B" }], order: [], radioGroups: [] }
  });
  const original = structuredClone(scene);
  const state = new OptionalContentController(scene), plan = new ScenePaintVisibility(scene);
  assert.equal(plan.requiresCompositing, false);
  assert.equal(plan.select(scene.drawRuns), scene.drawRuns, "all-visible layers preserve batching's source-array fast path");
  const culled = [scene.drawRuns[1]];
  assert.equal(plan.select(culled), culled, "all-visible partial culling is allocation-free");
  await state.setLayerVisibility("B", false); plan.setVisibility(state.getSnapshot());
  const selected = plan.select(scene.drawRuns);
  assert.deepEqual(selected, [scene.drawRuns[0], scene.drawRuns[2]]);
  assert.equal(plan.select(scene.drawRuns), selected, "unchanged visibility reuses the full-scene selection");
  assert.deepEqual(plan.select(culled), []);
  culled[0] = scene.drawRuns[0];
  assert.deepEqual(plan.select(culled), [scene.drawRuns[0]], "in-place culler mutations never reuse stale results");
  assert.equal(plan.isRunVisible(scene.drawRuns[1]), false);
  await state.resetLayerVisibility(); plan.setVisibility(state.getSnapshot());
  assert.equal(plan.select(scene.drawRuns), scene.drawRuns);
  const initialSnapshot = state.getSnapshot();
  plan.setVisibility(initialSnapshot);
  const initialRevision = plan.revision;
  plan.setVisibility(initialSnapshot);
  assert.equal(plan.revision, initialRevision, "unchanged snapshots retain the paint-plan cache");
  plan.setVisibility({ ...initialSnapshot, conditions: Uint8Array.of(1, 0) });
  assert(plan.revision > initialRevision, "replacement snapshots invalidate plans even with identical source revisions");
  assert.deepEqual(plan.select(scene.drawRuns), [scene.drawRuns[0], scene.drawRuns[2]]);
  const hiddenRevision = plan.revision;
  plan.setVisibility(null);
  assert(plan.revision > hiddenRevision, "returning to defaults invalidates the cached visibility plan");
  assert.equal(plan.select(scene.drawRuns), scene.drawRuns);
  assert.deepEqual(scene, original, "runtime plans never merge, rewrite, or discard canonical runs");

  const group = (children, extra = {}) => ({ kind: "group", children, alpha: 1, isolated: false,
    knockout: false, blendMode: "Normal", ...extra });
  const draws = scene.drawRuns.map((_run, runIndex) => ({ kind: "draw", runIndex }));
  const graph = { ...scene, paintGraph: { roots: [group([draws[0], group([draws[1]], { isolated: true, optionalContent: 1 })]), draws[2]] } };
  const graphPlan = new ScenePaintVisibility(graph);
  assert.equal(graphPlan.requiresCompositing, false, "ordinary Normal source-over groups use the flat renderer");
  await state.setLayerVisibility("B", false); graphPlan.setVisibility(state.getSnapshot());
  assert.deepEqual(graphPlan.select(graph.drawRuns), [graph.drawRuns[0], graph.drawRuns[2]]);

  const nodeOnly = { ...scene, drawRuns: scene.drawRuns.map(({ optionalContent, ...run }) => run),
    paintGraph: { roots: [group([draws[0]], { optionalContent: 1 }), { ...draws[1], optionalContent: 1 }, draws[2]] } };
  const nodePlan = new ScenePaintVisibility(nodeOnly); nodePlan.setVisibility(state.getSnapshot());
  assert.deepEqual(nodePlan.select(nodeOnly.drawRuns), [nodeOnly.drawRuns[2]], "flattened node and ancestor conditions still apply");

  for (const extra of [{ alpha: .5 }, { knockout: true }, { blendMode: "Multiply" },
    { softMask: { subtype: "Alpha", children: [] } }]) {
    const effect = { ...scene, paintGraph: { roots: [group(draws, extra)] } };
    assert(sceneRequiresPaintCompositing(effect), `real compositing effect must retain surfaces: ${JSON.stringify(extra)}`);
  }
  assert(sceneRequiresPaintCompositing({ ...scene, paintGraph: { roots: [draws[1], draws[0], draws[2]] } }),
    "a different graph order must not be replaced with array order");
  assert(sceneRequiresPaintCompositing({ ...scene, drawRuns: [{ ...scene.drawRuns[0], blendMode: "Multiply" }, ...scene.drawRuns.slice(1)],
    paintGraph: { roots: [group(draws, { isolated: true })] } }), "isolation cannot be flattened around blending children");
  const masked = { ...scene, paintGraph: { roots: [group([draws[0], draws[2]], {
    softMask: { subtype: "Alpha", children: [draws[1]] } })] } };
  const maskedPlan = new ScenePaintVisibility(masked);
  assert.equal(maskedPlan.isRunVisible(masked.drawRuns[1]), false, "mask geometry is not direct page paint");

  const retained = { ...scene, drawRuns: [{ kind: "raster", first: 0, count: 1 }],
    paintGraph: { roots: [{ kind: "retained", retainedPage: 0, firstCommand: 0, count: 1, rasterIndex: 0, optionalContent: 1 }] } };
  const retainedPlan = new ScenePaintVisibility(retained); retainedPlan.setVisibility(state.getSnapshot());
  assert.equal(retainedPlan.requiresCompositing, false, "a replayed raster slot does not itself require GPU group compositing");
  assert.deepEqual(retainedPlan.select(retained.drawRuns), []);
  state.dispose();
  console.log("Scene paint visibility passed: cached layer eligibility, mutable culling, flat groups, effect barriers and canonical references.");
} finally { hooks.deregister(); }
