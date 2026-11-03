import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { getSceneAnnotationRuns } = await import("../src/scenePrimitives.ts");
  const { editorSourcePaintColors } = await import("../src/editorSourceColors.ts");
  const { applyEditorSourceFieldColors } = await import("../src/editorSourceFieldColors.ts");
  const { normalizePrimitiveColor } = await import("../src/colorInput.ts");
  const { createNodeBundledStandardFontResolver } = await import("../src/nodePdfResources.ts");
  const same = (left, right) => normalizePrimitiveColor(left).every((channel, i) => Math.abs(channel - normalizePrimitiveColor(right)[i]) < 1e-6);
  const scene = buildStrokeScene([{ points: [[10, 10], [40, 10]], width: 2, color: "red" }, { points: [[50, 50], [80, 50]], width: 2, color: "blue" }]);
  scene.pageRects = Float32Array.of(0, 0, 100, 100);
  const source = createEditorSession(scene);
  try {
    source.updateObject("source:stroke:0", { color: "green" });
    source.setObjectLink("source:stroke:0", { type: "object", objectId: "source:stroke:1" });
    source.select(["source:stroke:0", "source:stroke:1"]);
    const clones = source.cloneSelection([0, 0]);
    assert.deepEqual(source.getObjectLink(clones[0]), { type: "object", objectId: clones[1] });
    assert(source.getObjectPaintColors(clones[0]).color.every(value => same(value, "green")), "rebinding a copied internal link retains the source clone's captured paint");
  } finally { source.dispose(); }

  // Partial primitive recoloring cannot guess which new glyph replaces an old
  // primitive. Complete uniform role edits can follow a regenerated appearance.
  const fieldId = "widget", layer = { groups: [{ id: "annotation:widget", name: "widget", annotationId: fieldId,
    defaultVisible: true, locked: true, usedInView: false }], conditions: [{ kind: "group", groupId: "annotation:widget" }], order: [], radioGroups: [] };
  const tagged = (source, count) => ({ ...source, optionalContent: layer,
    annotations: [{ id: fieldId, pageIndex: 0, field: { name: "Name", type: "Tx", flags: 0 }, subtype: "Widget", flags: 0, visibleInDefaultView: true,
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, pdfGeometry: { rect: [0, 0, 100, 100] } }],
    drawRuns: [{ kind: "stroke", first: 0, count, optionalContent: 0 }] });
  const oldAppearance = tagged(scene, 2), newAppearance = tagged(buildStrokeScene([
    { points: [[0, 0], [10, 0]], width: 1 }, { points: [[0, 1], [10, 1]], width: 1 }, { points: [[0, 2], [10, 2]], width: 1 }
  ]), 3);
  const colorEdit = index => ({ ref: { kind: "stroke", index }, transform: [1, 0, 0, 1, 0, 0], deleted: false, color: "green" });
  assert.equal(applyEditorSourceFieldColors(oldAppearance, newAppearance, [colorEdit(0)]), newAppearance,
    "partial old paint roles do not redirect a color change to unrelated regenerated primitives");
  const uniform = applyEditorSourceFieldColors(oldAppearance, newAppearance, [colorEdit(0), colorEdit(1)]);
  assert(editorSourcePaintColors(uniform, [{ kind: "stroke", index: 0 }, { kind: "stroke", index: 1 }, { kind: "stroke", index: 2 }]).color.every(value => same(value, "green")));

  const bytes = writeTinyPdf({ objects: [
    "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] /DA (/Helv 10 Tf 0 g) /DR << /Font << /Helv 6 0 R >> >> >> >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /Helv 6 0 R >> >> /Annots [5 0 R] /Contents 4 0 R >>",
    tinyPdfStream("", ""),
    "<< /Type /Annot /Subtype /Widget /FT /Tx /T (Name) /V (Old) /DA (/Helv 10 Tf 1 0 0 rg) /Rect [10 10 90 30] /F 4 /P 3 0 R /AP << /N 7 0 R >> >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 80 20] /Resources << /Font << /Helv 6 0 R >> >>", "0 0 1 rg 0 0 80 20 re f BT /Helv 10 Tf 1 0 0 rg 2 4 Td (Old) Tj ET")
  ].map((body, index) => ({ number: index + 1, body })) });
  const parser = await openPdf({ kind: "bytes", bytes }, { missingFontResolver: createNodeBundledStandardFontResolver() }), services = await createEditorAppServices({ sourcePdf: bytes });
  try {
    const canonical = await parser.compileVectorPage(0, { optimization: "none" });
    for (const colorFirst of [true, false]) {
      const editor = await openEditorSession(canonical, { ...services.sessionOptions, sourcePdf: bytes });
      try {
        const annotation = editor.sourceScene.annotations.find(value => value.field?.name === "Name"), id = `annotation:${annotation.id}`;
        if (colorFirst) {
          editor.updateObject(id, { color: "green" });
          const colorOnly = await editor.getScene();
          assert(same(colorOnly.annotations.find(value => value.id === annotation.id).field.textStyle.color, "green"),
            "a color-only edit updates typing style without requiring an earlier field-value change");
        }
        editor.setFieldValue("Name", "New and longer value");
        if (!colorFirst) { await editor.getScene(); editor.updateObject(id, { color: "green" }); }
        const current = await editor.getScene(), runs = getSceneAnnotationRuns(current).get(annotation.id) ?? [];
        const refs = runs.flatMap(run => Array.from({ length: run.count }, (_, index) => ({ kind: run.kind, index: run.first + index })));
        const colors = editorSourcePaintColors(current, refs).color;
        assert(colors.length && colors.every(value => same(value, "green")), "field appearance regeneration retains source color edits when its glyph count changes");
        const field = current.annotations.find(value => value.id === annotation.id).field;
        assert.equal(field.value, "New and longer value");
        assert(same(field.textStyle.color, "green"), "typing controls receive the committed source text color");
        assert.deepEqual({ ...field.textStyle, color: undefined }, { ...annotation.field.textStyle, color: undefined }, "recoloring retains the field's font and inset settings");
      } finally { editor.dispose(); }
    }
  } finally { services.dispose(); await parser.close(); }
  console.log("Source color lifecycle: cloned link rebinding and regenerated form appearance colors passed.");
} finally { hooks.deregister(); }
