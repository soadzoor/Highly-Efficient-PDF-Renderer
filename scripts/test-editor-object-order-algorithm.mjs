import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { arrangeEditorOrder, applyEditorOrderTokens, editorOrderToken, editorCloneOwner, editorOrderTokens,
    editorOrderGeometry, projectEditorOrder } = await import("../src/editorObjectOrder.ts");
  const { editorPaintIdentity, setEditorPaintIdentity } = await import("../src/editorPaintIdentity.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { validateScenePaintGraph } = await import("../src/scenePaintGraph.ts");
  const { validateVectorDrawRuns } = await import("../src/vectorDrawOrder.ts");
  const actions = ["send-to-back", "bring-to-front", "bring-forward", "send-backward"];
  const unit = (id, options = {}) => ({ owners: [id], tokens: [editorOrderToken(id, options.layer === undefined ? "A" : options.layer)],
    page: 0, layer: "A", plane: "paint", atomic: true, ...options });
  const names = units => units.map(item => item.owners.join("+"));
  const scope = item => [item.page, item.plane, item.layer];
  const originals = ["a", "b", "c", "d", "e"].map(id => unit(id));
  const untouched = structuredClone(originals);
  originals.forEach(value => { Object.freeze(value.owners); Object.freeze(value.tokens); Object.freeze(value); }); Object.freeze(originals);

  const cases = [
    ["send-to-back", ["b"], ["b", "a", "c", "d", "e"]],
    ["bring-to-front", ["b"], ["a", "c", "d", "e", "b"]],
    ["bring-forward", ["b"], ["a", "c", "b", "d", "e"]],
    ["send-backward", ["b"], ["b", "a", "c", "d", "e"]],
    ["send-to-back", ["b", "d"], ["b", "d", "a", "c", "e"]],
    ["bring-to-front", ["b", "d"], ["a", "c", "e", "b", "d"]],
    ["bring-forward", ["b", "d"], ["a", "c", "b", "e", "d"]],
    ["send-backward", ["b", "d"], ["b", "a", "d", "c", "e"]],
    ["send-to-back", ["b", "c"], ["b", "c", "a", "d", "e"]],
    ["bring-to-front", ["b", "c"], ["a", "d", "e", "b", "c"]],
    ["bring-forward", ["b", "c"], ["a", "d", "b", "c", "e"]],
    ["send-backward", ["b", "c"], ["b", "c", "a", "d", "e"]]
  ];
  for (const [action, selected, expected] of cases) {
    const result = arrangeEditorOrder(originals, new Set(selected), action);
    assert(result.changed, `${action} reports the mutation`); assert.deepEqual(names(result.units), expected);
    assert.deepEqual(names(arrangeEditorOrder(originals, new Set([...selected].reverse()), action).units), expected,
      `${action} follows paint order rather than click order`);
    assert.deepEqual(names(applyEditorOrderTokens(originals, editorOrderTokens(result.units))), expected,
      `${action} can be replayed from its ordinary token schedule`);
    assert.deepEqual(originals, untouched, `${action} leaves the source schedule immutable`);
  }
  for (const action of actions) {
    for (const selected of [[], ["unknown"], ["a", "b", "c", "d", "e"]]) {
      const result = arrangeEditorOrder(originals, new Set(selected), action);
      assert.equal(result.changed, false); assert.deepEqual(result.units, originals);
      assert(result.units.every((value, index) => value === originals[index]), "no-op schedules reuse their paint units");
    }
    assert.equal(arrangeEditorOrder([], new Set(["a"]), action).changed, false);
  }
  for (const [action, selected] of [["send-to-back", ["a"]], ["send-backward", ["a"]],
    ["bring-to-front", ["e"]], ["bring-forward", ["e"]], ["bring-forward", ["d", "e"]], ["send-backward", ["a", "b"]]])
    assert.equal(arrangeEditorOrder(originals, new Set(selected), action).changed, false, `${action} is disabled at its boundary`);
  assert.deepEqual(names(arrangeEditorOrder(originals, new Set(["b", "e"]), "bring-forward").units), ["a", "c", "b", "d", "e"],
    "one selected object at a boundary does not prevent other selected objects moving");
  assert.throws(() => arrangeEditorOrder(originals, new Set(["a"]), "front"), /Unknown stacking action/);

  const scopes = [unit("p0-a0"), unit("p1-a0", { page: 1 }), unit("p0-b0", { layer: "B" }), unit("p0-u0", { layer: null }),
    unit("p0-a1"), unit("p1-a1", { page: 1 }), unit("p0-b1", { layer: "B" }), unit("p0-u1", { layer: null }),
    unit("p0-m0", { plane: "metadata" }), unit("p0-m1", { plane: "metadata" })];
  const swapped = ["p0-a1", "p1-a1", "p0-b1", "p0-u1", "p0-a0", "p1-a0", "p0-b0", "p0-u0", "p0-m1", "p0-m0"];
  const first = ["p0-a0", "p1-a0", "p0-b0", "p0-u0", "p0-m0"], last = ["p0-a1", "p1-a1", "p0-b1", "p0-u1", "p0-m1"];
  for (const action of actions) {
    const selected = action === "bring-forward" || action === "bring-to-front" ? first : last;
    const result = arrangeEditorOrder(scopes, new Set(selected), action);
    assert.deepEqual(names(result.units), swapped, `${action} arranges each page/layer/paint-plane independently`);
    assert.deepEqual(result.units.map(scope), scopes.map(scope), "foreign layer, page and metadata slots remain fixed");
    assert.deepEqual(names(applyEditorOrderTokens(scopes, editorOrderTokens(result.units))), swapped);
  }
  const isolated = arrangeEditorOrder(scopes, new Set(["p0-a0"]), "bring-to-front");
  assert.deepEqual(names(isolated.units), ["p0-a1", "p1-a0", "p0-b0", "p0-u0", "p0-a0", "p1-a1", "p0-b1", "p0-u1", "p0-m0", "p0-m1"],
    "an intra-layer command never rearranges another layer or unlayered artwork");

  const children = [unit("a"), unit("b"), unit("c")];
  const container = unit("container", { owners: ["a", "b", "c"], tokens: editorOrderTokens(children), children, atomic: false });
  const nestedBefore = structuredClone(container);
  const nested = arrangeEditorOrder([container, unit("d")], new Set(["a"]), "bring-forward");
  assert(nested.changed); assert.deepEqual(names(nested.units), ["a+b+c", "d"]);
  assert.deepEqual(names(nested.units[0].children), ["b", "a", "c"]); assert.deepEqual(container, nestedBefore);
  const atomic = { ...container, atomic: true };
  assert.equal(arrangeEditorOrder([atomic, unit("d")], new Set(["a"]), "bring-forward").changed, false,
    "partial selection cannot split an atomic composite");
  const whole = arrangeEditorOrder([atomic, unit("d")], new Set(["c", "a", "b"]), "bring-forward");
  assert.deepEqual(names(whole.units), ["d", "a+b+c"]); assert.equal(whole.units[1], atomic);
  assert.deepEqual(names(whole.units[1].children), ["a", "b", "c"], "moving a whole composite preserves internal paint order");

  const escapedOwner = 'signature:["α", "b"]', escapedLayer = 'Review, ["Ω"]';
  assert.deepEqual(JSON.parse(editorOrderToken(escapedOwner, escapedLayer)), [escapedOwner, escapedLayer]);
  assert.notEqual(editorOrderToken("a", null), editorOrderToken("a", "null"));
  assert.notEqual(editorCloneOwner("a,b", "c"), editorCloneOwner("a", "b,c"), "clone qualification is unambiguous");
  const repeated = [unit("a"), container, unit("d")];
  assert.deepEqual(editorOrderTokens(repeated), ["a", "b", "c", "d"].map(id => editorOrderToken(id, "A")), "token schedules flatten children and deduplicate stable owners");
  const full = [unit("a"), unit("new"), unit("c")], fullOrder = [full[2], full[1], full[0]].map(value => value.tokens[0]);
  assert.deepEqual(names(applyEditorOrderTokens([full[0], full[2]], fullOrder)), ["c", "a"], "projection ignores an absent authored placeholder without losing source order");
  assert.deepEqual(names(applyEditorOrderTokens([...full, unit("later"), unit("latest")], fullOrder)), ["c", "new", "a", "later", "latest"],
    "new unmatched content keeps its stable append order");
  const movedLayer = [unit("a", { layer: "B" }), unit("b", { layer: "B" })];
  assert.deepEqual(names(applyEditorOrderTokens(movedLayer, [editorOrderToken("b", "A"), editorOrderToken("a", "A")])), ["b", "a"],
    "source-owner identity survives assignment to a different layer");
  const pageLayers = [unit("p0-a"), unit("p0-u", { layer: null }), unit("p0-b", { layer: "B" }),
    unit("p1-a", { page: 1 }), unit("p1-b", { page: 1, layer: "B" })];
  const globallyRestacked = applyEditorOrderTokens(pageLayers, undefined, new Map([["A", 0], ["B", 1]]));
  assert.deepEqual(names(globallyRestacked), ["p0-b", "p0-u", "p0-a", "p1-b", "p1-a"]);
  assert.deepEqual(globallyRestacked.map(value => value.page), pageLayers.map(value => value.page), "global layer restacking cannot move content between pages");

  const strokes = count => buildStrokeScene(Array.from({ length: count }, (_, index) => ({ points: [[index * 4, 0], [index * 4 + 2, 2]], width: 1 })));
  const source = strokes(4); source.drawRuns = [{ kind: "stroke", first: 0, count: 4, clipIndex: 0 }];
  source.clipPaths = [{ parent: -1, fillRule: 0, edges: Float32Array.of(-2, -2, 20, -2, 20, -2, 20, 4, 20, 4, -2, 4, -2, 4, -2, -2) }];
  const sourceBefore = structuredClone(source);
  const geometry = editorOrderGeometry(source, { layer: () => "A", atomic: () => false });
  assert.deepEqual(geometry.units.map(value => value.owners), [["source:stroke:0"], ["source:stroke:1"], ["source:stroke:2"], ["source:stroke:3"]]);
  assert.deepEqual(geometry.scene.drawRuns.map(run => [run.first, run.count]), [[0, 1], [1, 1], [2, 1], [3, 1]]);
  const desired = [geometry.units[2], unit("new"), geometry.units[0], geometry.units[1], geometry.units[3]];
  const ranks = new Map(editorOrderTokens(desired).map((token, index) => [token, index]));
  const projected = projectEditorOrder(geometry.scene, geometry.units, ranks);
  assert.deepEqual(projected.drawRuns.map(run => [run.first, run.count]), [[2, 1], [0, 2], [3, 1]], "projection restores source order and coalesces only compatible contiguous ranges");
  assert(projected.drawRuns.every(run => run.clipIndex === 0)); assert.equal(projected.clipPaths, source.clipPaths);
  assert.equal(projected.endpoints, source.endpoints, "ordering shares immutable geometry buffers");
  assert.equal(editorPaintIdentity(projected)({ kind: "stroke", index: 1 }), "source:stroke:1");
  assert.equal(Object.hasOwn(projected, "objectOrder"), false); assert.equal(Object.hasOwn(projected, "tokens"), false, "transient identities are not persisted in ordinary scene data");
  validateVectorDrawRuns(projected); validateScenePaintGraph(projected); assert.deepEqual(source, sourceBefore);

  const authored = strokes(4); authored.drawRuns = [{ kind: "stroke", first: 0, count: 4 }];
  setEditorPaintIdentity(authored, "clone:not-json");
  const authoredGeometry = editorOrderGeometry(authored, { layer: () => "A", atomic: () => false });
  assert.equal(authoredGeometry.units.length, 1); assert.deepEqual(authoredGeometry.units[0].owners, ["clone:not-json"], "raw authored ids cannot be confused with internal clone qualification");
  const excluded = editorOrderGeometry(authored, { layer: () => "A", atomic: () => false, excluded: new Set(["stroke:1"]) });
  assert.deepEqual(excluded.scene.drawRuns.map(run => [run.first, run.count]), [[0, 1], [2, 2]], "owner coalescing cannot reintroduce an excluded primitive");
  assert.deepEqual(excluded.units.flatMap(value => value.refs.map(ref => ref.index)), [0, 2, 3]);
  const clone = strokes(1); setEditorPaintIdentity(clone, ref => editorCloneOwner("copy", `source:${ref.kind}:${ref.index}`));
  const cloneGeometry = editorOrderGeometry(clone, { layer: () => "A", atomic: () => false, objectId: "copy" });
  assert.deepEqual(cloneGeometry.units[0].owners, ["copy"], "explicit clone aliases select preserved source units together");

  const masked = strokes(4); masked.drawRuns = Array.from({ length: 4 }, (_, first) => ({ kind: "stroke", first, count: 1 }));
  masked.paintGraph = { roots: [{ kind: "group", alpha: .5, isolated: true, knockout: true, blendMode: "Multiply",
    children: [{ kind: "draw", runIndex: 0 }, { kind: "draw", runIndex: 1 }],
    softMask: { subtype: "Alpha", children: [{ kind: "draw", runIndex: 2 }], transfer: Float32Array.of(0, .5, 1), backdrop: [0, 0, 0] } }, { kind: "draw", runIndex: 3 }] };
  const maskedBefore = structuredClone(masked), maskGeometry = editorOrderGeometry(masked, { layer: () => "A", atomic: node => node.kind === "group" });
  const maskOrder = new Map([[editorOrderToken("source:stroke:3", "A"), 0], [editorOrderToken("source:stroke:1", "A"), 1], [editorOrderToken("source:stroke:0", "A"), 2]]);
  const maskProjected = projectEditorOrder(maskGeometry.scene, maskGeometry.units, maskOrder), composite = maskProjected.paintGraph.roots[1];
  assert.equal(maskProjected.drawRuns[maskProjected.paintGraph.roots[0].runIndex].first, 3);
  assert.equal(composite.kind, "group"); assert.equal(composite.alpha, .5); assert.equal(composite.knockout, true); assert.equal(composite.blendMode, "Multiply");
  assert.deepEqual(composite.children.flatMap(node => Array.from({ length: maskProjected.drawRuns[node.runIndex].count }, (_, index) => maskProjected.drawRuns[node.runIndex].first + index)), [0, 1], "atomic children are never internally resorted by sibling ranks");
  assert.equal(maskProjected.drawRuns[composite.softMask.children[0].runIndex].first, 2);
  assert.equal(composite.softMask.transfer, masked.paintGraph.roots[0].softMask.transfer); assert.deepEqual(composite.softMask.backdrop, [0, 0, 0]);
  validateVectorDrawRuns(maskProjected); validateScenePaintGraph(maskProjected); assert.deepEqual(masked, maskedBefore);
  console.log("Object ordering algorithms: four actions, stable multi-selection, page/layer/plane isolation, replay/projection, clips and atomic masks passed.");
} finally { hooks.deregister(); }
