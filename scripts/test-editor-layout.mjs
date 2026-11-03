import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(s, c, n) { return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c); } });
try {
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { alignEditorSelection, distributeEditorSelection, createEditorAlignmentSnap } = await import("../src/editorLayout.ts");
  const scene = buildStrokeScene([{ points: [[0, 0], [200, 200]], width: 1 }]);
  scene.pageRects = Float32Array.of(0, 0, 200, 200);
  const editor = createEditorSession(scene);
  const rect = (x, y, w = 10, h = 10) => editor.addObject({ kind: "shape", shape: "rectangle", pageIndex: 0, x, y, width: w, height: h, strokeWidth: 0, fill: "red" });
  try {
    const a = rect(10, 10), b = rect(40, 20, 20), c = rect(100, 40, 30);
    editor.select([a, b, c]); const before = editor.getSelection().map(id => editor.getObjectBounds(id));
    assert.equal(alignEditorSelection(editor, "top"), 2);
    assert(editor.getSelection().every(id => editor.getObjectBounds(id).maxY === 50));
    editor.undo(); assert.deepEqual(editor.getSelection().map(id => editor.getObjectBounds(id)), before, "one Undo restores bulk layout and selection");
    distributeEditorSelection(editor, "horizontal");
    const boxes = editor.getSelection().map(id => editor.getObjectBounds(id));
    assert.equal(boxes[1].minX - boxes[0].maxX, boxes[2].minX - boxes[1].maxX);
    assert.equal(boxes[0].minX, before[0].minX); assert.equal(boxes[2].maxX, before[2].maxX); editor.undo();
    editor.select([a]); alignEditorSelection(editor, "center", "page"); assert.equal(editor.getObjectBounds(a).minX, 95); editor.undo();
    editor.select([a, b]); const group = editor.groupSelection(); editor.select([group, a, c]);
    alignEditorSelection(editor, "left"); assert.equal(editor.getObjectBounds(a).minX, 10, "selected children of a selected group move only once"); editor.undo();
    editor.select([b]); const snap = createEditorAlignmentSnap(editor);
    const result = snap.snap([1, 0, 0, 1, -18, -8], 3);
    assert.equal(result.matrix[4], -20); assert.equal(result.matrix[5], -10); assert.equal(result.guides.length, 2);
    assert.deepEqual(snap.snap([1, 0, 0, 1, -18, -8], 3, true), { matrix: [1, 0, 0, 1, -18, -8], guides: [] }, "Alt bypasses all guides");
    const calls = editor.getObjects; editor.getObjects = () => { throw new Error("No document scans during pointer movement"); };
    snap.snap([1, 0, 0, 1, -18, -8], 3); editor.getObjects = calls;
    editor.setObjectsLocked([b], true); assert.equal(createEditorAlignmentSnap(editor), null);
    editor.select([a, b, c]); assert.throws(() => alignEditorSelection(editor, "left"), /Unlock|locked/);
    editor.setObjectsLocked([b], false);
    editor.select([c]); editor.transformSelection([0, 1, -1, 0, 150, 0]); const original = editor.getObject(c).transform.slice(0, 4);
    editor.select([a, c]); alignEditorSelection(editor, "bottom"); assert.deepEqual(editor.getObject(c).transform.slice(0, 4), original, "aligning rotated artwork preserves its linear transform");
    console.log("Editor layout: group roots, one-step undo, visual gaps, page alignment, locks, rotated objects and cached guide snapping passed.");
  } finally { editor.dispose(); }
} finally { hooks.deregister(); }
