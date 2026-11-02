import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { bakeEditorAnnotationEdits, bakeEditorSourceScene, compactEditorScene } = await import("../src/editorScene.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { PAGE_PRIMITIVE_KINDS } = await import("../src/scenePageViews.ts");
  const scene = buildStrokeScene([{ points: [[0, 0], [10, 0]], width: 1 }, { points: [[20, 0], [30, 0]], width: 1 }]);
  scene.annotations = ["deleted", "kept"].map((id, index) => ({ id, pageIndex: 0, sourcePageIndex: 0, annotationIndex: index,
    subtype: "Widget", pdfGeometry: { rect: [index * 20, 0, index * 20 + 10, 10] }, bounds: { minX: index * 20, minY: 0, maxX: index * 20 + 10, maxY: 10 },
    flags: 4, visibleInDefaultView: true, hasAppearance: true, field: { name: id, type: "Tx", flags: 0 } }));
  scene.optionalContent = { groups: ["deleted", "kept"].map(id => ({ id: `annotation:${id}`, name: id, annotationId: id, defaultVisible: true, locked: true, usedInView: false })),
    conditions: [{ kind: "group", groupId: "annotation:deleted" }, { kind: "group", groupId: "annotation:kept" },
      { kind: "and", operands: [0, 1] }, { kind: "or", operands: [0, 1] }], order: [], radioGroups: [] };
  scene.drawRuns = [{ kind: "stroke", first: 0, count: 1, optionalContent: 0 }, { kind: "stroke", first: 1, count: 1, optionalContent: 1 }];
  const text = "Deleted Kept Hidden Both Either", refs = [], conditions = [];
  for (const [word, ref, condition] of [["Deleted", -2, 0], ["Kept", -3, 1], ["Hidden", -4, -1], ["Both", -5, 2], ["Either", -6, 3]]) {
    if (refs.length) { refs.push(-1); conditions.push(-1); }
    for (const _char of word) { refs.push(ref); conditions.push(condition); }
  }
  scene.textIndex = { version: 2, pages: [{ text, charInstance: Int32Array.from(refs), optionalContent: Int32Array.from(conditions),
    fallbackQuads: Float32Array.of(0, 0, 10, 10, 20, 0, 30, 10, 40, 0, 50, 10, 60, 0, 70, 10, 80, 0, 90, 10) }] };
  const result = bakeEditorSourceScene(scene, [{ ref: { kind: "stroke", index: 0 }, deleted: true, transform: [1, 0, 0, 1, 0, 0] }]);
  const page = result.textIndex.pages[0];
  assert(!page.text.includes("Deleted")); assert(!page.text.includes("Both"));
  assert(page.text.includes("Kept")); assert(page.text.includes("Hidden"), "unowned invisible searchable text remains searchable");
  assert(page.text.includes("Either"), "an OR condition with a surviving alternative is not discarded");
  assert.equal(page.fallbackQuads.length, 12, "unused fallback geometry is removed with its annotation text");
  for (const ref of page.charInstance) if (ref <= -2) assert((-ref - 2) * 4 < page.fallbackQuads.length);
  assert.equal(scene.textIndex.pages[0].text, text, "source text remains unchanged");
  const partial = { ...scene, drawRuns: [{ kind: "stroke", first: 0, count: 2, optionalContent: 0 }] };
  const kept = Object.fromEntries(PAGE_PRIMITIVE_KINDS.map(kind => [kind, new Set(kind === "stroke" ? [1] : [])]));
  assert(compactEditorScene(partial, kept).textIndex.pages[0].text.includes("Deleted"), "partial paint removal retains its annotation's fallback text");
  const noPaint = { ...scene, drawRuns: [scene.drawRuns[1]] };
  const metadataDeleted = bakeEditorAnnotationEdits(noPaint, [{ id: "deleted", deleted: true, transform: [1, 0, 0, 1, 0, 0] }]);
  assert(!metadataDeleted.textIndex.pages[0].text.includes("Deleted"), "a metadata-only widget deletion drops its owned invisible fallback text");
  assert(metadataDeleted.textIndex.pages[0].text.includes("Hidden"));
  assert.equal(metadataDeleted.endpoints, noPaint.endpoints, "metadata-only deletion keeps canonical geometry buffers");
  console.log("Editor search compaction drops fully removed annotation fallback text while retaining partial, invisible and independently owned text.");
} finally { hooks.deregister(); }
