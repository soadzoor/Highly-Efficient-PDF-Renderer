import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { captureEditorPageChanges, changedEditorPages } = await import("../src/editorPageChanges.ts");
  const scene = buildStrokeScene([10, 160, 310].map(x => ({ points: [[x, 10], [x + 10, 20]], width: 1 })));
  scene.pageCount = 3; scene.pageRects = Float32Array.of(0, 0, 100, 100, 150, 0, 250, 100, 300, 0, 400, 100);
  scene.pageTextRanges = new Uint32Array(6); scene.pagePrimitiveRanges = new Uint32Array(36);
  for (let page = 0; page < 3; page++) scene.pagePrimitiveRanges.set([page, 1], page * 12);
  scene.bounds = scene.pageBounds = { minX: 0, minY: 0, maxX: 400, maxY: 100 };
  scene.annotations = [0, 1, 2].map(page => ({ id: `field:${page}`, sourcePageIndex: page, annotationIndex: 0, subtype: "Widget",
    pdfGeometry: { rect: [10, 40, 30, 50] }, bounds: { minX: page * 150 + 10, minY: 40, maxX: page * 150 + 30, maxY: 50 },
    flags: 0, visibleInDefaultView: true, hasAppearance: false, pageIndex: page,
    field: { name: page === 1 ? "single" : "shared", type: "Tx", flags: 0, value: "Old" } }));
  const session = await openEditorSession(scene);
  let previous = captureEditorPageChanges(session);
  const expect = (pages, message) => {
    const current = captureEditorPageChanges(session);
    assert.deepEqual(changedEditorPages(previous, current), pages, message); previous = current;
  };
  const shape = (pageIndex, extra = {}) => ({ kind: "shape", shape: "rectangle", pageIndex, x: 5, y: 5, width: 20, height: 10, ...extra });
  try {
    assert.equal(changedEditorPages(undefined, previous), undefined, "an unknown baseline requests a full refresh");
    assert.equal(captureEditorPageChanges({}), undefined, "custom sessions can conservatively request a full refresh");
    session.selectPrimitives([{ kind: "stroke", index: 1 }]); expect([], "materializing and selecting source objects changes no page paint");
    session.setPreviewTransform([1, 0, 0, 1, 20, 0]); expect([], "pointer previews do not advance committed page paint");
    session.setPreviewTransform(null); expect([]);

    const id = session.addObject(shape(1)); expect([1], "adding an object invalidates only its page");
    const beforeColor = previous;
    session.updateObject(id, { color: "red" }); expect([1]);
    assert.equal(beforeColor.objects.get(id).color, undefined, "published snapshots keep immutable model values during later edits");
    assert(session.undo()); expect([1]); assert(session.redo()); expect([1], "redo invalidates the edited page");
    session.updateObject(id, { pageIndex: 0 }); expect([0, 1], "moving between pages invalidates both old and new owners");
    assert(session.undo()); expect([0, 1]);

    session.setObjectLink(id, { type: "url", url: "https://example.com" }); expect([], "inert links do not alter thumbnails");
    session.setObjectsLocked([id], true); expect([], "editing locks do not alter thumbnails");
    session.setObjectsLocked([id], false); expect([]);
    const other = session.addObject(shape(1, { x: 30 })); expect([1]);
    session.select([id, other]); session.groupSelection(); expect([], "temporary grouping changes no paint");
    session.ungroupSelection(); expect([]);

    session.selectPrimitives([{ kind: "stroke", index: 2 }]);
    session.updateObject(session.getSelection()[0], { color: "blue" }); expect([2], "source recoloring invalidates its owning page");
    session.transformSelection([1, 0, 0, 1, -300, 0]); expect([0, 2], "source transforms also cover old and new page intersections");
    assert(session.undo()); expect([0, 2]);
    session.setFieldValue("shared", "Updated"); expect([0, 2], "every widget of a shared field is invalidated");
    session.updateAnnotation("field:0", { contents: "Discussion only" }); expect([], "annotation discussion does not replace its appearance");
    session.selectAnnotations(["field:1"]); session.transformSelection([1, 0, 0, 1, 150, 0]); expect([1, 2]);
    session.setFieldValue("single", "Moved widget"); expect([1, 2], "field updates include transformed widgets");

    const first = session.createLayer({ name: "First" }); expect([], "creating an empty layer does not change paint");
    assert(session.undo()); expect([], "undoing an empty layer leaves page thumbnails intact");
    assert(session.redo()); expect([]);
    session.updateLayer(first, { name: "Renamed", locked: true }); expect([], "layer names and visibility locks change no paint");
    session.updateLayer(first, { locked: false }); expect([]);
    session.assignObjectsToLayer([id], first); expect([1], "authored membership changes stay on their page");
    session.selectPrimitives([{ kind: "stroke", index: 0 }]); session.assignSelectionToLayer(first); expect([0], "source membership changes stay on their page");
    session.updateLayer(first, { defaultVisible: false }); expect(undefined, "global visibility changes conservatively refresh all pages");
    session.updateLayer(first, { defaultVisible: true }); expect(undefined);
    const second = session.createLayer({ name: "Second" }); expect([]);
    session.moveLayer(second, { index: 0 }); expect(undefined, "visual layer restacking requests a full refresh");
    assert(session.undo()); expect(undefined);

    session.addObject(shape(1, { x: 40, layerId: first })); expect([1]);
    session.select([id]); assert(session.canReorderSelection("bring-to-front")); session.reorderSelection("bring-to-front");
    expect([1], "the first explicit within-layer reorder refreshes only its page");
    assert(session.undo()); expect([1], "undo restores implicit ordering without invalidating unrelated pages");
    assert(session.redo()); expect([1]);
    session.addObject(shape(0, { layerId: first })); expect([0]);
    session.selectPrimitives([{ kind: "stroke", index: 0 }]); assert(session.canReorderSelection("bring-to-front")); session.reorderSelection("bring-to-front");
    expect([0], "source artwork ordering is also scoped by page");

    const field = session.addObject({ kind: "field", fieldType: "text", name: "NewField", pageIndex: 1, x: 10, y: 10, width: 40, height: 15, value: "" }); expect([1]);
    session.updateObject(field, { name: "RenamedField", tooltip: "Accessible label", required: true, maxLength: 100 }); expect([], "authored field metadata changes no page pixels");
    session.setFieldValue("RenamedField", "Typed"); expect([1], "authored values refresh their page");
    const originalGetter = session.getObjects;
    session.getObjects = () => { throw new Error("Must not clone author geometry for thumbnail invalidation"); };
    assert.deepEqual(changedEditorPages(previous, captureEditorPageChanges(session)), []);
    session.getObjects = originalGetter;
    assert.equal(changedEditorPages(previous, { ...previous, sourceScene: structuredClone(scene) }), undefined,
      "structural changes and source replacement invalidate page identities");
  } finally { session.dispose(); }
  console.log("Editor affected-page model snapshots passed.");
} finally { hooks.deregister(); }
