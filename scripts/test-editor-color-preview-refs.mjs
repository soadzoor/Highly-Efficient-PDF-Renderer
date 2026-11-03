import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { resolveEditorColorPreviewRefs } = await import("../src/editorColorPreview.ts");
  const { applyEditorPropertyPatch } = await import("../src/editorProperties.ts");
  const { editorSourcePaintColors } = await import("../src/editorSourceColors.ts");
  const { editorPaintRole, editorPaintIdentity, editorPaintOwnerObject, setEditorPaintIdentity } = await import("../src/editorPaintIdentity.ts");
  const { scenePrimitiveCounts, PAGE_PRIMITIVE_KINDS } = await import("../src/scenePageViews.ts");
  const refs = scene => { const counts = scenePrimitiveCounts(scene); return PAGE_PRIMITIVE_KINDS.flatMap(kind =>
    kind === "raster" ? [] : Array.from({ length: counts[kind] }, (_, index) => ({ kind, index }))); };
  const key = ref => `${ref.kind}:${ref.index}`;
  const paint = (scene, ref) => JSON.stringify(editorSourcePaintColors(scene, [ref]).color.map(rgb => rgb.map(value => Math.round(value * 1e6))));
  const samePaint = async (session, id, property, label) => {
    const before = await session.getScene({ preview: false }), state = session.getState(), sourceStyles = session.sourceScene.styles.slice();
    const selected = resolveEditorColorPreviewRefs(session, before, [id], property);
    assert.deepEqual(session.getState(), state, `${label}: preview reference resolution cannot create history`);
    assert.deepEqual(session.sourceScene.styles, sourceStyles);
    const detached = resolveEditorColorPreviewRefs(session, before, [id], property); if (detached[0]) detached[0].index = -100;
    assert.deepEqual(resolveEditorColorPreviewRefs(session, before, [id], property), selected, "cached preview references are detached");
    applyEditorPropertyPatch(session, { [property]: "#f010c0" }, [id]);
    const after = await session.getScene({ preview: false });
    assert.deepEqual(scenePrimitiveCounts(after), scenePrimitiveCounts(before), `${label}: RGB changes preserve canonical geometry addresses`);
    const changed = refs(before).filter(ref => paint(before, ref) !== paint(after, ref)).map(key).sort();
    assert.deepEqual(selected.map(key).sort(), changed, `${label}: fast preview tints exactly the paint changed by commit`);
    if (selected.length) assert(session.undo());
    return { scene: before, selected };
  };
  const base = () => {
    const scene = buildStrokeScene([{ points: [[10, 10], [80, 10]], width: 2, color: "black" }]);
    scene.pageRects = Float32Array.of(0, 0, 200, 200); return scene;
  };
  for (const kind of ["rectangle", "ellipse", "arrow", "ink", "signature"]) for (const nonuniform of [false, true]) {
    const editor = createEditorSession(base());
    try {
      const object = ["ink", "signature"].includes(kind) ? { kind, paths: [[[20, 30], [60, 40], [30, 60], [20, 30]]], strokeWidth: 3, color: "black", fill: "black" }
        : { kind: "shape", shape: kind, x: 20, y: 30, width: 40, height: 30, strokeWidth: 3, color: "black", fill: kind === "arrow" ? undefined : "black" };
      const id = editor.addObject({ ...object, pageIndex: 0 }); editor.select([id]);
      if (nonuniform) editor.transformSelection([2, .25, .1, .5, 0, 0]);
      const color = await samePaint(editor, id, "color", `${kind}/${nonuniform}: Color`);
      await samePaint(editor, id, "fill", `${kind}/${nonuniform}: Fill`);
      if (nonuniform && kind !== "arrow") assert(color.selected.some(ref => ref.kind === "fill" && editorPaintRole(color.scene)(ref) === "color"), "outlined strokes retain their Color role");
      if (kind === "arrow") assert(color.selected.some(ref => ref.kind === "fill"), "arrowheads preview the stroke color");
    } finally { editor.dispose(); }
  }

  // Source originals and copies have different semantics from author models:
  // Color replaces all vector paint; Fill follows the original local fill role.
  const author = createEditorSession(base());
  author.addObject({ kind: "shape", shape: "rectangle", pageIndex: 0, x: 20, y: 30, width: 40, height: 30, color: "black", fill: "black", strokeWidth: 3 });
  const source = await author.getScene(); author.dispose();
  setEditorPaintIdentity(source, ref => `source:${key(ref)}`);
  const editor = createEditorSession(source);
  try {
    const id = "source:stroke:0"; editor.select([id]); editor.transformSelection([2, 0, 0, .5, 0, 0]);
    const preview = await samePaint(editor, id, "color", "original outlined source");
    assert(preview.selected.every(ref => ref.kind === "fill")); await samePaint(editor, id, "fill", "original stroke Fill unsupported");
    const clone = editor.cloneSelection([0, 0])[0]; await samePaint(editor, clone, "color", "raw source copy"); await samePaint(editor, clone, "fill", "raw source-copy Fill");
    editor.select([id]); await editor.copySelection(); const pasted = editor.pasteSelection({ offset: [0, 0] })[0];
    await samePaint(editor, pasted, "color", "captured outline copy"); await samePaint(editor, pasted, "fill", "captured outline Fill");
    editor.setObjectsLocked([pasted], true); assert.deepEqual(resolveEditorColorPreviewRefs(editor, await editor.getScene(), [pasted], "color"), []);
  } finally { editor.dispose(); }

  const text = await openEditorSession(base(), { loadFontAsset: asset => readFile(asset) });
  try {
    const id = text.addObject({ kind: "text", pageIndex: 0, x: 20, y: 50, width: 120, height: 50, fontSize: 14, color: "black", fontFamily: "Liberation Sans",
      runs: [{ text: "One", color: "black", underline: true }, { text: " Two", color: "blue", strikethrough: true }] });
    const { selected } = await samePaint(text, id, "color", "mixed rich text and decorators");
    assert(selected.some(ref => ref.kind === "text") && selected.some(ref => ref.kind === "stroke" || ref.kind === "fill"), `text decorators remain part of Color: ${JSON.stringify(selected)}`);
    const glyphSource = { ...await text.getScene() };
    setEditorPaintIdentity(glyphSource, ref => `source:${key(ref)}`);
    const glyphs = createEditorSession(glyphSource);
    try { assert.deepEqual((await samePaint(glyphs, "source:text:1", "color", "one source glyph")).selected, [{ kind: "text", index: 1 }]); }
    finally { glyphs.dispose(); }
  } finally { text.dispose(); }

  const masked = buildStrokeScene([{ points: [[10, 10], [40, 10]], width: 2 }, { points: [[10, 10], [40, 10]], width: 2 }]);
  masked.drawRuns = [{ kind: "stroke", first: 0, count: 1 }, { kind: "stroke", first: 1, count: 1 }];
  masked.paintGraph = { roots: [{ kind: "group", alpha: .7, isolated: true, knockout: false, blendMode: "Normal",
    children: [{ kind: "draw", runIndex: 0 }], softMask: { subtype: "Luminosity", children: [{ kind: "draw", runIndex: 1 }] } }] };
  const masks = createEditorSession(masked);
  try {
    masks.selectPrimitives([{ kind: "stroke", index: 0 }]); const owner = masks.getSelection()[0];
    assert.deepEqual(resolveEditorColorPreviewRefs(masks, await masks.getScene(), [owner], "color"), [{ kind: "stroke", index: 0 }], "luminosity-mask RGB is never preview paint");
  } finally { masks.dispose(); }

  // Coarse host identities are safe only when exact raw addresses survived, or
  // the selection contains the whole shared unit. Never tint an unrelated item.
  const coarse = buildStrokeScene([{ points: [[10, 10], [40, 10]], width: 2 }, { points: [[50, 50], [80, 50]], width: 2 }]);
  setEditorPaintIdentity(coarse, "shared"); const shared = createEditorSession(coarse);
  try {
    assert.deepEqual(resolveEditorColorPreviewRefs(shared, await shared.getScene(), ["source:stroke:0"], "color"), [{ kind: "stroke", index: 0 }]);
    shared.select(["source:stroke:0"]); shared.transformSelection([1, 0, 0, 1, 2, 0]);
    const transformed = await shared.getScene();
    assert.throws(() => resolveEditorColorPreviewRefs(shared, transformed, ["source:stroke:0"], "color"), /shared source identity/);
    assert.equal(resolveEditorColorPreviewRefs(shared, transformed, ["source:stroke:0", "source:stroke:1"], "color").length, 2);
    const identities = editorPaintIdentity(transformed); assert(refs(transformed).every(ref => editorPaintOwnerObject(identities(ref)) === undefined));
  } finally { shared.dispose(); }

  const large = buildStrokeScene(Array.from({ length: 5000 }, (_, i) => ({ points: [[i, 0], [i + 1, 1]], width: 1 })));
  let resolutions = 0; setEditorPaintIdentity(large, ref => { resolutions++; return `source:${key(ref)}`; });
  const smallSelection = createEditorSession(large);
  try {
    const canonical = await smallSelection.getScene(); resolutions = 0;
    assert.deepEqual(resolveEditorColorPreviewRefs(smallSelection, canonical, ["source:stroke:1"], "color"), [{ kind: "stroke", index: 1 }]);
    assert(resolutions <= 4, "an ordinary source preview resolves its selected refs without scanning unrelated page paint");
  } finally { smallSelection.dispose(); }
  console.log("Live color references: source/authored roles, outlined strokes, arrowheads, text decorators, copies, locks and shared-identity diagnostics passed.");
} finally { hooks.deregister(); }
