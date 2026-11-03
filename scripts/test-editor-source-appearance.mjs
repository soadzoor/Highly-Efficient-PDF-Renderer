import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { editorSourcePaintColors } = await import("../src/editorSourceColors.ts");
  const { editorPaintIdentity, editorPaintOwnerObject } = await import("../src/editorPaintIdentity.ts");
  const { scenePrimitiveCounts, PAGE_PRIMITIVE_KINDS } = await import("../src/scenePageViews.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const { normalizePrimitiveColor } = await import("../src/colorInput.ts");
  const base = buildStrokeScene([{ points: [[10, 20], [60, 20]], width: 2, color: "red" }]);
  base.pageRects = Float32Array.of(0, 0, 100, 100); base.bounds = base.pageBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const seed = createEditorSession(base);
  seed.addObject({ kind: "shape", shape: "rectangle", pageIndex: 0, x: 10, y: 40, width: 30, height: 20, color: "blue", fill: "yellow", opacity: .6, fillOpacity: .3 });
  const scene = await seed.getScene(); seed.dispose();
  const colors = (session, id, channel = "color") => session.getObjectPaintColors(id)[channel];
  const has = (values, color) => values.some(value => normalizePrimitiveColor(value).every((channel, i) => Math.abs(channel - normalizePrimitiveColor(color)[i]) < 1e-6));
  const session = createEditorSession(scene), original = "source:stroke:0", fill = "source:fill:0";
  try {
    const beforeStyles = scene.styles.slice(), beforeFill = scene.fillPathMetaB.slice();
    session.updateObject(original, { color: "green" }); assert(has(colors(session, original), "green"));
    const revision = session.revision;
    session.updateObject(original, { color: "#008000" }); assert.equal(session.revision, revision, "same RGB does not create history");
    assert.throws(() => session.updateObject(original, { color: "invalid color" }), /color/i); assert.equal(session.revision, revision);
    session.select([original]); session.transformSelection([1, 0, 0, 1, 7, 3]);
    assert(has(colors(session, original), "green")); assert(has(editorSourcePaintColors(await session.getScene(), [{ kind: "stroke", index: 0 }]).color, "green"));
    assert.deepEqual(session.getSourceEdits()[0].transform, [1, 0, 0, 1, 7, 3]); assert(has([session.getSourceEdits()[0].color], "green"));
    assert(session.undo()); assert(has(colors(session, original), "green"), "undoing movement keeps the earlier color change");
    assert(session.redo());
    session.updateObject(fill, { fill: "purple" }); assert(has(colors(session, fill, "fill"), "purple"));
    assert.throws(() => session.updateObject(fill, { fill: null }), /color/i);
    const compiled = await session.getScene();
    assert(has(editorSourcePaintColors(compiled, [{ kind: "fill", index: 0 }]).fill, "purple"));
    assert.deepEqual(compiled.fillPathMetaC.filter((_, index) => index % 4 === 3), scene.fillPathMetaC.filter((_, index) => index % 4 === 3), "fill alpha survives recoloring");
    assert.deepEqual(scene.styles, beforeStyles); assert.deepEqual(scene.fillPathMetaB, beforeFill, "source buffers remain immutable");
    const readback = session.getObjectPaintColors(original); readback.color[0][0] = .125;
    assert(has(colors(session, original), "green"), "paint readback is detached");
    session.select([original]); const [duplicate] = await session.duplicateSelection({ offset: [0, 0] });
    assert(has(colors(session, duplicate), "green"), `copies capture the currently edited source paint: ${JSON.stringify({ colors: colors(session, duplicate), object: session.getObject(duplicate) })}`);
    session.updateObject(duplicate, { color: "cyan" }); assert(has(colors(session, duplicate), "cyan")); assert(has(colors(session, original), "green"));
    const copied = await session.getScene(), owner = editorPaintIdentity(copied), counts = scenePrimitiveCounts(copied);
    const refs = PAGE_PRIMITIVE_KINDS.flatMap(kind => Array.from({ length: counts[kind] }, (_, index) => ({ kind, index })))
      .filter(ref => editorPaintOwnerObject(owner(ref)) === duplicate);
    assert(has(editorSourcePaintColors(copied, refs).color, "cyan"), "source copies compile their independent RGB overrides");
    const recovery = await session.captureRecovery(), restored = createEditorSession(scene);
    try {
      await restored.restoreRecovery(recovery); assert(has(colors(restored, original), "green")); assert(has(colors(restored, duplicate), "cyan"));
      assert(has(editorSourcePaintColors(await restored.getScene(), [{ kind: "fill", index: 0 }]).fill, "purple"));
    } finally { restored.dispose(); }
    session.setObjectsLocked([original], true); assert.throws(() => session.updateObject(original, { color: "red" }), /locked/i);
    session.setObjectsLocked([original], false); session.select([original]); session.deleteSelection(); assert(session.undo());
    assert(has(colors(session, original), "green"), "delete/undo retains paint edits");
  } finally { session.dispose(); }
  const portable = await openEditorSession(scene);
  try {
    portable.updateObject(original, { color: "cyan" }); portable.updateObject(fill, { fill: "purple" });
    const hep = await portable.saveHep({ withVectorLod: false, withTextLod: false });
    const reopened = await loadSceneFromHep(await hep.arrayBuffer());
    assert(has(editorSourcePaintColors(reopened, [{ kind: "stroke", index: 0 }]).color, "cyan"));
    assert(has(editorSourcePaintColors(reopened, [{ kind: "fill", index: 0 }]).fill, "purple"));
    const editing = createEditorSession(reopened);
    try { editing.updateObject(original, { color: "orange" }); assert(has(colors(editing, original), "orange")); }
    finally { editing.dispose(); }
  } finally { portable.dispose(); }
  console.log("Source appearance: RGB changes, transforms, independent copies, locks, undo, recovery and HEP reopen/edit passed.");
} finally { hooks.deregister(); }
