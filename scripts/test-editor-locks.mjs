import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(s, c, n) { return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c); } });
try {
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const scene = buildStrokeScene([{ points: [[10, 20], [60, 20]], width: 2 }]);
  const session = createEditorSession(scene);
  try {
    const layer = session.createLayer({ name: "Visibility lock", locked: true });
    session.setActiveLayer(layer);
    const a = session.addObject({ kind: "shape", shape: "rectangle", pageIndex: 0, x: 1, y: 2, width: 10, height: 20 });
    const b = session.addObject({ kind: "shape", shape: "ellipse", pageIndex: 0, x: 30, y: 2, width: 10, height: 20 });
    assert(!session.isObjectLocked(a), "visibility lock is independent of editing locks");
    session.select([a, b]); const group = session.groupSelection();
    session.markSaved(); const saved = session.getState(); session.setObjectsLocked([group], false); assert.deepEqual(session.getState(), saved, "unchanged locks do not create history");
    session.setObjectsLocked([group], true);
    assert(session.isObjectLocked(group) && session.isObjectLocked(a) && session.isObjectLocked(b));
    assert(session.getState().dirty);
    const before = session.getState();
    for (const mutation of [() => session.transformSelection([1, 0, 0, 1, 2, 3]), () => session.setPreviewTransform([1, 0, 0, 1, 1, 0]),
      () => session.deleteSelection(), () => session.cloneSelection(), () => session.updateObject(a, { fill: "red" }),
      () => session.ungroupSelection(), () => session.assignSelectionToLayer(null), () => session.reorderSelection("send-to-back")]) assert.throws(mutation, /locked/);
    assert.deepEqual(session.getState(), before, "rejected edits keep state and history intact");
    assert.equal(await session.copySelection(), 1, "copy remains available on locked selections");
    await assert.rejects(session.cutSelection(), /locked/); await assert.rejects(session.duplicateSelection(), /locked/);
    session.select([a]); assert(session.isObjectLocked(a));
    session.setObjectsLocked([group], false); assert(!session.isObjectLocked(group) && !session.isObjectLocked(a));
    session.select([group]); session.transformSelection([1, 0, 0, 1, 2, 3]);
    session.undo(); session.undo(); assert(session.isObjectLocked(group), "undo restores lock state"); session.redo(); assert(!session.isObjectLocked(group));
    session.selectPrimitives([{ kind: "stroke", index: 0 }]); const [source] = session.getSelection();
    session.setObjectsLocked([source], true); assert(session.isObjectLocked(source)); assert.throws(() => session.deleteSelection(), /locked/);
    const snapshot = await session.captureRecovery();
    const restored = createEditorSession(structuredClone(snapshot.sourceScene));
    try { await restored.restoreRecovery(snapshot); assert(restored.isObjectLocked(source)); restored.setObjectsLocked([source], false); restored.deleteSelection(); }
    finally { restored.dispose(); }
  } finally { session.dispose(); }
  const annotationScene = structuredClone(scene);
  annotationScene.annotations = [{ id: "locked", pageIndex: 0, sourcePageIndex: 0, subtype: "Text", flags: 128,
    bounds: { minX: 1, minY: 2, maxX: 10, maxY: 20 }, pdfGeometry: { rect: [1, 2, 10, 20] } }];
  const original = createEditorSession(annotationScene);
  try { original.selectAnnotations(["locked"]); assert(original.isObjectLocked("annotation:locked")); original.setObjectsLocked(original.getSelection(), false); assert(!original.isObjectLocked("annotation:locked")); }
  finally { original.dispose(); }
  console.log("Editor locks: independent visibility locks, groups/children/source annotations, rejected mutations, copying, undo and recovery passed.");
} finally { hooks.deregister(); }
