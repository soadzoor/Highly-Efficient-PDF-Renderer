import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { prepareSceneForHepRendering } = await import("../src/hepShared.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { OptionalContentController } = await import("../src/optionalContent.ts");
  const { getSceneAnnotationRuns, isScenePrimitiveVisible } = await import("../src/scenePrimitives.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const { writeScenePdf } = await import("../src/editorPdfWriter.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");

  // Older exports could persist internal appearance IDs as real OCGs. They
  // must remain valid PDF layers, independent of newly allocated form gates.
  const bytes = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [10 0 R] >> /OCProperties << /OCGs [5 0 R 6 0 R] /D << /Order [5 0 R 6 0 R] >> >> >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Properties << /A 5 0 R >> >> /Contents 4 0 R /Annots [10 0 R] >>" },
    { number: 4, body: tinyPdfStream("", "/OC /A BDC 1 0 0 rg 10 10 20 20 re f EMC") },
    { number: 5, body: "<< /Type /OCG /Name (Saved layer) /HEPRLayerId (annotation:ref:10:0) >>" },
    { number: 6, body: "<< /Type /OCG /Name (Other layer) /HEPRLayerId (annotation:ref:10:0:1) >>" },
    { number: 10, body: "<< /Type /Annot /Subtype /Widget /FT /Btn /T (Check) /V /Yes /AS /Yes /Rect [60 60 80 80] /AP << /N << /Yes 11 0 R /Off 12 0 R >> >> >>" },
    { number: 11, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 20 20] /Resources << >>", "0 0 1 rg 0 0 20 20 re f") },
    { number: 12, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 20 20] /Resources << >>", "") }
  ] });
  const parser = await openPdf({ kind: "bytes", bytes });
  try {
    let source;
    for (const options of [{ optimization: "none", preserveDrawingOrder: true },
      { optimization: "safe", enableSegmentMerge: true, enableInvisibleCull: true },
      { optimization: "safe", previewMaxDimension: 512 }]) {
      const scene = prepareSceneForHepRendering(composeVectorScenesInGrid([await parser.compileVectorPage(0, options)], 1));
      source ??= scene;
      const groups = scene.optionalContent.groups;
      assert.equal(new Set(groups.map(group => group.id)).size, groups.length, "native scene preparation accepts collision-free layer IDs");
      assert.deepEqual(groups.filter(group => !group.annotationId).map(group => group.id), ["annotation:ref:10:0", "annotation:ref:10:0:1"]);
      const appearance = getSceneAnnotationRuns(scene).get("ref:10:0");
      assert(appearance?.length, "the field appearance retains annotation ownership");
      const fieldRef = { kind: appearance[0].kind, index: appearance[0].first };
      const bodyRef = { kind: "fill", index: 0 };
      const controls = new OptionalContentController(scene);
      try {
        const visible = ref => isScenePrimitiveVisible(scene, ref, condition => controls.isVisible(condition));
        const thumbnailPixel = async (x, y) => {
          const result = await parser.renderThumbnailPage(0, { maxDimension: 100, backend: "canvas2d",
            background: [1, 1, 1, 1], optionalContent: controls.getSnapshot() });
          assert("rgba" in result);
          return Array.from(result.rgba.slice(((99 - y) * result.width + x) * 4, ((99 - y) * result.width + x) * 4 + 4));
        };
        await controls.setAnnotationVisibility(["ref:10:0"], false);
        assert.equal(visible(fieldRef), false);
        assert.equal(visible(bodyRef), true, "hiding the field keeps real OCG artwork visible");
        assert.deepEqual(await thumbnailPixel(70, 70), [255, 255, 255, 255], "thumbnails honor the collision-safe field gate");
        assert.deepEqual(await thumbnailPixel(20, 20), [255, 0, 0, 255]);
        await controls.setAnnotationVisibility(["ref:10:0"], true);
        await controls.setLayerVisibility("annotation:ref:10:0", false);
        assert.equal(visible(bodyRef), false);
        assert.equal(visible(fieldRef), true, "hiding a similarly named real OCG keeps the unrelated field visible");
        assert.deepEqual(await thumbnailPixel(70, 70), [0, 0, 255, 255], "a PDF layer with the annotation prefix does not hide the field in thumbnails");
        assert.deepEqual(await thumbnailPixel(20, 20), [255, 255, 255, 255]);
      } finally { controls.dispose(); }
    }
    const hep = await buildHep(source, { compression: "store", withVectorLod: false, withTextLod: false });
    const retained = prepareSceneForHepRendering(await loadSceneFromHep(await hep.arrayBuffer()));
    assert.equal(retained.optionalContent.groups.filter(group => group.annotationId).length, 1);
    assert(getSceneAnnotationRuns(retained).get("ref:10:0")?.length, "HEP retains distinct appearance ownership");
    const editor = await openEditorSession(source, { sourcePdf: bytes });
    try {
      editor.updateLayer("annotation:ref:10:0", { name: "Renamed saved layer" });
      for (const blob of [await editor.savePdf(), await writeScenePdf(retained)]) {
        const reopened = await openPdf({ kind: "bytes", bytes: new Uint8Array(await blob.arrayBuffer()) });
        try {
          const scene = prepareSceneForHepRendering(await reopened.compileVectorPage(0));
          assert.equal(scene.optionalContent.groups.filter(group => !group.annotationId).length, 2,
            "editable PDF and HEP-to-PDF saves preserve real layers without exporting internal form gates");
        } finally { await reopened.close(); }
      }
    } finally { editor.dispose(); }
  } finally { await parser.close(); }
  console.log("PDF appearance/layer ID collisions: optimized/preview loading, independent visibility, HEP and editable PDF round trips passed.");
} finally { hooks.deregister(); }
