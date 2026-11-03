import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { editorPaintIdentity, editorPaintOwnerObject } = await import("../src/editorPaintIdentity.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const { createEditorSession, getEditorOrderedSourceScene } = await import("../src/editorSessionRuntime.ts");
  const { defaultVectorDrawRuns } = await import("../src/vectorDrawOrder.ts");
  const group = id => ({ id, name: id, defaultVisible: true, locked: false, usedInView: true });
  const make = (layers = [0, 0, 0, 0]) => {
    const scene = buildStrokeScene(layers.map((_, i) => ({ points: [[0, i * 4], [20, i * 4]], width: 1 })));
    scene.optionalContent = { groups: [group("A"), group("B")], conditions: [{ kind: "group", groupId: "A" }, { kind: "group", groupId: "B" }],
      order: [{ kind: "group", groupId: "A" }, { kind: "group", groupId: "B" }], radioGroups: [] };
    scene.drawRuns = layers.map((condition, first) => ({ kind: "stroke", first, count: 1, ...(condition === null ? {} : { optionalContent: condition }) }));
    return scene;
  };
  const owners = scene => {
    const result = [], identity = editorPaintIdentity(scene), runs = scene.drawRuns ?? defaultVectorDrawRuns(scene);
    const visit = nodes => { for (const node of nodes) {
      if (node.kind === "group") visit(node.children);
      else if (node.kind === "retained") result.push(identity({ kind: "raster", index: node.rasterIndex }));
      else { const run = runs[node.runIndex]; for (let index = run.first; index < run.first + run.count; index++) result.push(identity({ kind: run.kind, index })); }
    } };
    visit(scene.paintGraph?.roots ?? runs.map((_, runIndex) => ({ kind: "draw", runIndex })));
    return result.filter((owner, index) => owner !== result[index - 1]).map(owner => editorPaintOwnerObject(owner) ?? owner);
  };
  const ids = [0, 1, 2, 3].map(i => `source:stroke:${i}`);
  for (const [action, expected] of [
    ["bring-forward", [1, 0, 3, 2]], ["send-backward", [0, 2, 1, 3]],
    ["bring-to-front", [1, 3, 0, 2]], ["send-to-back", [0, 2, 1, 3]]
  ]) {
    const editor = await openEditorSession(make());
    try {
      editor.select([ids[2], ids[0]]); assert(editor.canReorderSelection(action));
      editor.reorderSelection(action);
      assert.deepEqual(owners(await editor.getScene()), expected.map(i => ids[i]), action);
      assert.equal(editor.getLayerEdits().stackingChanged, false, "within-layer ordering does not request whole-layer restacking");
      assert.equal(editor.getLayerEdits().objectOrderChanged, true);
      assert.deepEqual(editor.getSelection(), [ids[2], ids[0]], "selection click order is preserved independently of paint order");
      assert(editor.undo()); assert.deepEqual(owners(await editor.getScene()), ids);
      assert(editor.redo()); assert.deepEqual(owners(await editor.getScene()), expected.map(i => ids[i]));
      const hep = await loadSceneFromHep(await (await editor.saveHep()).arrayBuffer());
      assert.deepEqual([...hep.drawRuns].flatMap(run => Array.from({ length: run.count }, (_, offset) => run.first + offset)), expected,
        "HEP persists ordinary reordered paint without authoring data");
      assert.equal(Object.hasOwn(hep, "objectOrder"), false);
    } finally { editor.dispose(); }
  }
  {
    const editor = await openEditorSession(make([0, 1, 0, 1]));
    try {
      editor.select([ids[0]]); editor.reorderSelection("bring-to-front");
      assert.deepEqual(owners(await editor.getScene()), [ids[2], ids[1], ids[0], ids[3]], "other-layer paint slots stay fixed");
      editor.assignSelectionToLayer("B");
      assert.deepEqual(owners(await editor.getScene()), [ids[2], ids[1], ids[0], ids[3]], "changing membership preserves the existing explicit position");
      editor.removeLayer("A"); assert.deepEqual(owners(await editor.getScene()), [ids[2], ids[1], ids[0], ids[3]], "removing a layer preserves explicit order");
    } finally { editor.dispose(); }
  }
  {
    const editor = await openEditorSession(make());
    try {
      editor.select(ids); editor.markSaved(); const before = editor.getState();
      for (const action of ["bring-forward", "send-backward", "bring-to-front", "send-to-back"]) {
        assert.equal(editor.canReorderSelection(action), false); editor.reorderSelection(action);
      }
      assert.deepEqual(editor.getState(), before, "no-op commands do not dirty the document or add history");
      editor.select([ids[3]]); assert.equal(editor.canReorderSelection("bring-forward"), false);
      assert.throws(() => editor.reorderSelection("wrong"), /Unknown stacking action/);
    } finally { editor.dispose(); }
  }
  {
    const source = make([0, null]); source.drawRuns = source.drawRuns.slice(0, 2);
    const editor = await openEditorSession(source);
    try {
      const shape = editor.addObject({ kind: "shape", shape: "rectangle", pageIndex: 0, x: 3, y: 3, width: 5, height: 5, fill: "red", layerId: "A" });
      editor.select([shape]); editor.reorderSelection("send-to-back");
      assert.deepEqual(owners(await editor.getScene()), [shape, ids[1], ids[0]], "authored slots participate in full arrangement");
      assert.deepEqual(owners(await editor.getScene({ includeObjects: false })), [ids[1], ids[0]], "source-only projection retains occupied authored slots before filtering");
      assert(editor.getPrimitivePaintRank({ kind: "stroke", index: 0 }) > editor.getObjectPaintRank(shape));
      editor.select([ids[0]]); editor.transformSelection([2, .1, .3, 1, 0, 0]);
      assert.deepEqual(owners(await editor.getScene()), [shape, ids[1], ids[0]], "nonuniform stroke outlines retain source ownership");
    } finally { editor.dispose(); }
  }
  {
    const source = make(); source.drawRuns = [{ kind: "stroke", first: 0, count: 4, optionalContent: 0 }];
    const editor = await openEditorSession(source);
    try {
      editor.select([ids[0]]); editor.reorderSelection("bring-to-front");
      const scene = await editor.getScene(); assert.deepEqual(owners(scene), [ids[1], ids[2], ids[3], ids[0]]);
      assert.equal(scene.drawRuns.length, 2, "contiguous untouched primitive ranges are coalesced after precise arrangement");
    } finally { editor.dispose(); }
  }
  {
    const editor = await openEditorSession(make());
    try {
      editor.select([ids[0]]); editor.reorderSelection("bring-to-front");
      const [cloned] = editor.cloneSelection([0, 0]);
      editor.assignSelectionToLayer("A"); editor.reorderSelection("send-to-back");
      assert.equal(owners(await editor.getScene())[0], cloned, "explicitly layered source clones use their own object-order identity");
      editor.select([ids[3]]); editor.deleteSelection(); editor.select([ids[0]]);
      assert.equal(editor.canReorderSelection("bring-forward"), false, "deleted source peers do not create phantom order steps");
    } finally { editor.dispose(); }
  }
  {
    const source = make([null, null, 0, 1]);
    source.paintGraph = { roots: [{ kind: "group", alpha: 1, isolated: false, knockout: false, blendMode: "Normal", optionalContent: 0,
      children: [{ kind: "draw", runIndex: 0 }, { kind: "draw", runIndex: 1 }] }, { kind: "draw", runIndex: 2 }, { kind: "draw", runIndex: 3 }] };
    const editor = await openEditorSession(source);
    try {
      editor.select([ids[0]]); editor.reorderSelection("bring-to-front");
      assert.deepEqual(owners(await editor.getScene()), [ids[1], ids[2], ids[0], ids[3]], "ordinary inherited OCG scopes permit within-layer ordering without moving another layer");
    } finally { editor.dispose(); }
  }
  {
    let owner, readyResolve, finish;
    const ready = new Promise(resolve => { readyResolve = resolve; }), blocked = new Promise(resolve => { finish = resolve; });
    const editor = await openEditorSession(make(), { async savePdf(_scene, snapshot) { owner = snapshot; readyResolve(); await blocked; return new Blob(["PDF"]); } });
    try {
      editor.select([ids[0]]); editor.reorderSelection("bring-to-front"); const pending = editor.savePdf(); await ready;
      editor.undo(); assert(editor.canReorderSelection("bring-to-front"));
      assert.equal(owner.canReorderSelection("bring-to-front"), false, "export ranking/selection state is a captured snapshot");
      assert(owner.getPrimitivePaintRank({ kind: "stroke", index: 0 }) > owner.getPrimitivePaintRank({ kind: "stroke", index: 1 }));
      assert.throws(() => owner.reorderSelection("send-to-back"), /read-only/);
      editor.select([ids[1]]); editor.reorderSelection("bring-to-front");
      finish(); await pending; assert(editor.getState().dirty, "an older export cannot mark a newer order revision saved");
    } finally { finish(); editor.dispose(); }
  }
  {
    const source = make([0, 0]); source.pageRects = Float32Array.of(0, 0, 100, 100);
    let compiledAuthors = 0;
    const editor = createEditorSession(source, { async compileObject() {
      compiledAuthors++;
      const geometry = buildStrokeScene([{ points: [[30, 30], [40, 30]], width: 1 }]);
      geometry.textGlyphCount = 1; geometry.textGlyphMetaA = new Float32Array(4); geometry.textGlyphMetaB = new Float32Array(4);
      geometry.textIndex = { version: 2, pages: [{ text: "AUTHOR_ONLY", charInstance: new Int32Array(11).fill(-2),
        fallbackQuads: Float32Array.of(30, 30, 40, 30, 40, 40, 30, 40) }] };
      return geometry;
    } });
    try {
      editor.select([ids[0]]); const [clone] = editor.cloneSelection([0, 0]);
      const author = editor.addObject({ kind: "text", pageIndex: 0, x: 0, y: 0, width: 20, height: 20, fontSize: 12,
        text: "AUTHOR_ONLY", layerId: "A" });
      editor.select([author]); editor.reorderSelection("send-to-back");
      const captured = await getEditorOrderedSourceScene(editor);
      assert.equal(compiledAuthors, 0, "canonical source capture never compiles ordinary textbox authors");
      assert.deepEqual(owners(captured), [ids[0], ids[1], clone], "source capture includes source clones and preserves full virtual projection");
      assert.equal(captured.textGlyphCount, 0); assert.equal(captured.textIndex?.pages.some(page => page.text.includes("AUTHOR_ONLY")) ?? false, false);
      const full = await editor.getScene(); assert.equal(compiledAuthors, 1); assert.equal(full.textGlyphCount, 1);
      assert(full.textIndex.pages.some(page => page.text.includes("AUTHOR_ONLY")));
      const second = await getEditorOrderedSourceScene(editor);
      assert.notEqual(second, full, "canonical source capture cannot read the full-scene cache");
      assert.equal(second.textGlyphCount, 0, "cached ordinary author glyph resources stay out of canonical source capture");
      assert.equal(second.textIndex?.pages.some(page => page.text.includes("AUTHOR_ONLY")) ?? false, false,
        "negative fallback-text characters belonging to ordinary authors cannot leak into capture");
      assert.equal(await editor.getScene(), full, "canonical capture cannot overwrite the full-scene cache");
      await assert.rejects(getEditorOrderedSourceScene(editor, { signal: AbortSignal.abort() }), { name: "AbortError" });
    } finally { editor.dispose(); }
  }
  console.log("Editor object ordering: four commands, reversed multi-selection, layers, no-ops, undo/redo, HEP, authored slots, outlines and batching passed.");
} finally { hooks.deregister(); }
