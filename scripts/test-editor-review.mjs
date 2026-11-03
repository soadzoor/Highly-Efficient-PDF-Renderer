import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
const hooks = registerHooks({ resolve(s, c, n) { return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c); } });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { editorTextMarkupQuads, addEditorTextMarkup, addEditorComment } = await import("../src/editorReview.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { loadSceneFromHep } = await import("../src/hepReader.ts");
  const { editorShapePreviewGeometry } = await import("../src/editorShapePreview.ts");
  const { nativeVectorMissingFontResolver } = await import("../src/pdfVectorExtractor.ts");
  const bytes = writeTinyPdf({ objects: [
    "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 180] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    tinyPdfStream("", "BT /F1 16 Tf 1 0 0 1 20 130 Tm (First line) Tj 0 -24 Td (Second line) Tj ET\nBT /F1 14 Tf 0 1 -1 0 200 20 Tm (Rotated) Tj ET")
  ].map((body, index) => ({ number: index + 1, body })) });
  const missingFontResolver = await nativeVectorMissingFontResolver();
  const parser = await openPdf({ kind: "bytes", bytes }, { missingFontResolver });
  const scene = await parser.compileVectorPage(0, { optimization: "none", preserveDrawingOrder: true }); await parser.close();
  const services = await createEditorAppServices({ sourcePdf: bytes });
  const editor = await openEditorSession(scene, { ...services.sessionOptions, sourcePdf: bytes });
  try {
    const text = scene.textIndex.pages[0].text, start = text.indexOf("First"); assert(start >= 0);
    const spans = [{ pageIndex: 0, start, length: "First line".length }];
    const quads = editorTextMarkupQuads(scene, spans).get(0); assert.equal(quads.length, 1);
    assert(quads[0][0][1] > quads[0][2][1], "quad order is top-left, top-right, bottom-left, bottom-right");
    const rotated = editorTextMarkupQuads(scene, [{ pageIndex: 0, start: text.indexOf("Rotated"), length: 7 }]).get(0)[0];
    assert(Math.abs(rotated[1][1] - rotated[0][1]) > Math.abs(rotated[1][0] - rotated[0][0]), "text markup follows the glyph baseline on rotated text");
    const ids = [];
    for (const type of ["highlight", "underline", "strikeout"]) ids.push(...addEditorTextMarkup(editor, scene, spans, type, { color: "#ffd500", opacity: .4, contents: "Review note", author: "Reviewer" }));
    ids.push(addEditorComment(editor, 0, 175, 125, "Comment text", "Reviewer"));
    const preview = editorShapePreviewGeometry(editor.getObject(ids[0]));
    assert(preview.paths.length && preview.paths.every(path => path.stroke === "none" && path.style === "mix-blend-mode:multiply"), "highlight preview uses filled quads without hairline borders");
    const before = editor.getObjects().length; editor.undo(); assert.equal(editor.getObjects().length, before - 1); editor.redo();
    editor.select([ids[0]]); editor.transformSelection([0, 1, -1, 0, 180, 0]); editor.setObjectsLocked([ids[0]], true);
    const compiled = await editor.getScene(); assert(compiled.fillPathCount > 0);
    const warnings = [], saved = new Uint8Array(await (await editor.savePdf({ markSaved: false, onWarning: value => warnings.push(value) })).arrayBuffer());
    const doc = await NativePdfDocument.open({ kind: "bytes", bytes: saved });
    try {
      const page = doc.getPage(0), annotations = await doc.resolveValue(page.dictionary.get("Annots"));
      const values = await Promise.all(annotations.map(ref => doc.resolveValue(ref)));
      assert.deepEqual(values.map(a => a.get("Subtype").value), ["Highlight", "Underline", "StrikeOut", "Text"]);
      assert(values.slice(0, 3).every(a => a.get("QuadPoints").length === 8 && a.get("AP")), "standard PDF quads and explicit appearances remain editable");
      assert(values[0].get("F") & 128, "editing locks use standard annotation flags");
    } finally { await doc.close(); }
    const reopened = await openPdf({ kind: "bytes", bytes: saved }, { missingFontResolver });
    const next = await reopened.compileVectorPage(0, { optimization: "none", preserveDrawingOrder: true }); await reopened.close();
    assert.equal(next.annotations.length, 4); assert(next.annotations.some(a => a.contents === "Comment text"));
    const nextServices = await createEditorAppServices({ sourcePdf: saved }), nextEditor = await openEditorSession(next, { ...nextServices.sessionOptions, sourcePdf: saved });
    try {
      const note = next.annotations.find(a => a.subtype === "Text"); nextEditor.updateAnnotation(note.id, { contents: "Updated comment", author: "Another reviewer" });
      assert.equal((await nextEditor.getScene()).annotations.find(a => a.id === note.id).contents, "Updated comment");
      const changed = new Uint8Array(await (await nextEditor.savePdf()).arrayBuffer()), p = await openPdf({ kind: "bytes", bytes: changed }, { missingFontResolver });
      try { assert.equal((await p.compileVectorPage(0)).annotations.find(a => a.subtype === "Text").contents, "Updated comment"); } finally { await p.close(); }
    } finally { nextEditor.dispose(); nextServices.dispose(); }
    const hep = await editor.saveHep({ markSaved: false, withVectorLod: false, withTextLod: false, encodeRasterImages: false });
    const baked = await loadSceneFromHep(await hep.arrayBuffer()); assert.equal(baked.fillPathCount, compiled.fillPathCount);
    assert(!Object.hasOwn(baked, "editor") && !Object.hasOwn(baked, "sourcePdf"));
    assert(editor.getState().dirty, "generating a download does not claim a durable file write");
    assert.throws(() => editor.addObject({ kind: "shape", shape: "polygon", pageIndex: 0, x: 0, y: 0, width: 1, height: 1, review: { type: "highlight", quads: [] } }), /quadrilaterals/);
    console.log("Editor reviews: real glyph quads/rotation, standard PDF annotations/APs, comments, locks, reopen/edit and plain HEP geometry passed.");
  } finally { editor.dispose(); services.dispose(); }
} finally { hooks.deregister(); }
