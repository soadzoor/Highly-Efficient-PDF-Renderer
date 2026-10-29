import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { writeScenePdf } = await import("../src/editorPdfWriter.ts");
  const { editorPaintIdentity, setEditorPaintIdentity } = await import("../src/editorPaintIdentity.ts");
  const bytes = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /AcroForm 5 0 R /OCProperties << /OCGs [6 0 R] /D << /Order [6 0 R] /ON [6 0 R] >> >> >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R /Annots [9 0 R] >>" },
    { number: 4, body: tinyPdfStream("", "0 0 1 rg 0 0 100 100 re f") },
    { number: 5, body: "<< /Fields [9 0 R] /DA (/F1 10 Tf 0 g) /DR << /Font << /F1 8 0 R >> >> >>" },
    { number: 6, body: "<< /Type /OCG /Name (Fields) >>" },
    { number: 8, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" },
    { number: 9, body: "<< /Type /Annot /Subtype /Widget /FT /Tx /T (Name) /V (Original) /Rect [20 20 80 80] /F 4 /P 3 0 R /DA (/F1 10 Tf 0 g) /OC 6 0 R /AP << /N 10 0 R >> >>" },
    { number: 10, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 60 60] /Resources << >>", "1 1 1 rg 0 0 60 60 re f") }
  ] });
  const parser = await openPdf({ kind: "bytes", bytes });
  let source; try { source = await parser.compileVectorPage(0, { optimization: "none", preserveDrawingOrder: true }); } finally { await parser.close(); }
  const originalIdentity = editorPaintIdentity(source);
  setEditorPaintIdentity(source, ref => `source:page:field-test:${originalIdentity(ref)}`);
  async function pixel(scene, coveredField = false) {
    const rect = scene.pageRects, matrix = scene.pdfPages[0].pdfToScene;
    const x = matrix[0] * 50 + matrix[2] * 50 + matrix[4] - rect[0], y = matrix[1] * 50 + matrix[3] * 50 + matrix[5] - rect[1];
    const data = new Uint8Array(await (await writeScenePdf(scene, { flatten: true })).arrayBuffer());
    const pdf = await openPdf({ kind: "bytes", bytes: data });
    try {
      const compiled = await pdf.compilePage(0, { optimization: "none" });
      const result = await renderHeprPageToCanvas2d({ ...compiled, displayProgram: { ...compiled.displayProgram,
        groups: compiled.displayProgram.groups.map(group => ({ ...group, blendingColorSpaceIndex: -1 })) } },
      { scale: 1, background: [1, 1, 1, 1], surfaceFactory(width, height) { const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext("2d") }; } });
      if (coveredField) {
        const width = result.surface.canvas.width, data = result.surface.context.getImageData(0, 0, width, result.surface.canvas.height).data;
        for (let fieldX = 22; fieldX < 78; fieldX++) for (let fieldY = 22; fieldY < 78; fieldY++) {
          const px = matrix[0] * (fieldX + .5) + matrix[2] * (fieldY + .5) + matrix[4] - rect[0];
          const py = matrix[1] * (fieldX + .5) + matrix[3] * (fieldY + .5) + matrix[5] - rect[1];
          const at = (Math.floor(rect[3] - rect[1] - py) * width + Math.floor(px)) * 4;
          assert.deepEqual([...data.subarray(at, at + 4)], [0, 255, 0, 255], `regenerated field glyphs/background stay below covering markup at ${fieldX},${fieldY}`);
        }
      }
      return [...result.surface.context.getImageData(Math.floor(x), Math.floor(rect[3] - rect[1] - y), 1, 1).data];
    } finally { await pdf.close(); }
  }
  const editor = await openEditorSession(source, { sourcePdf: bytes });
  try {
    const added = editor.addObject({ kind: "shape", shape: "rectangle", pageIndex: 0, x: 10, y: 10, width: 80, height: 80,
      fill: "#00ff00", strokeWidth: 0, layerId: "ref:6:0" });
    editor.selectAnnotations(["ref:9:0"]); editor.reorderSelection("bring-to-front");
    assert.deepEqual(await pixel(await editor.getScene()), [255, 255, 255, 255]);
    editor.reorderSelection("send-to-back"); assert.deepEqual(await pixel(await editor.getScene()), [0, 255, 0, 255]);
    await editor.rotatePages([0], 90);
    assert.deepEqual(await pixel(await editor.getScene()), [0, 255, 0, 255], "page rebase retains field behind authored markup");
    editor.setFieldValue("Name", "Changed after rotation");
    assert.deepEqual(await pixel(await editor.getScene(), true), [0, 255, 0, 255], "typing into a rebased field retains its namespaced original ordered paint owner");
    assert.equal(editor.getObject(added).kind, "shape");
    const saved = new Uint8Array(await (await editor.savePdf()).arrayBuffer()), reopened = await openPdf({ kind: "bytes", bytes: saved });
    try { assert.equal((await reopened.compileVectorPage(0, { optimization: "none" })).annotations.find(annotation => annotation.field?.name === "Name").field.value, "Changed after rotation"); }
    finally { await reopened.close(); }
  } finally { editor.dispose(); }
  console.log("Arranged/rebased fields retain drawing order while typing, and save/reopen their current value.");
} finally { hooks.deregister(); }
