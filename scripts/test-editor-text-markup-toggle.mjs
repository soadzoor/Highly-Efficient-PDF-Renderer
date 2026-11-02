import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
const hooks = registerHooks({ resolve(s, c, n) { return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c); } });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { editorTextMarkupState, setEditorTextMarkup } = await import("../src/editorReview.ts");
  const { nativeVectorMissingFontResolver } = await import("../src/pdfVectorExtractor.ts");
  const { loadSceneFromHep } = await import("../src/hepReader.ts");
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { normalizePrimitiveColor } = await import("../src/colorInput.ts");
  const missingFontResolver = await nativeVectorMissingFontResolver();
  const bytes = writeTinyPdf({ objects: [
    "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 180] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    tinyPdfStream("", "BT /F1 16 Tf 1 0 0 1 20 130 Tm (ABCDE) Tj 0 -24 Td (Second) Tj ET\nBT /F1 14 Tf 0 1 -1 0 200 20 Tm (Rotated) Tj ET")
  ].map((body, index) => ({ number: index + 1, body })) });
  async function open(input) {
    const parser = await openPdf({ kind: "bytes", bytes: input }, { missingFontResolver });
    let scene;
    try { scene = await parser.compileVectorPage(0, { optimization: "none", preserveDrawingOrder: true }); } finally { await parser.close(); }
    const services = await createEditorAppServices({ sourcePdf: input });
    const editor = await openEditorSession(scene, { ...services.sessionOptions, sourcePdf: input });
    return { scene, editor, close() { editor.dispose(); services.dispose(); } };
  }
  for (const markupType of ["underline", "highlight"]) {
    const original = await open(bytes);
    try {
      const { scene, editor } = original, text = scene.textIndex.pages[0].text, start = text.indexOf("ABCDE"), span = (offset, length) => [{ pageIndex: 0, start: start + offset, length }], full = span(0, 5), middle = span(1, 3);
      const state = (spans, type = markupType, current = scene) => editorTextMarkupState(editor, current, spans, type);
      const set = (spans, enabled, type = markupType) => setEditorTextMarkup(editor, scene, spans, type, enabled, { color: "#123456", author: "Writer", contents: "Styled text" });
      if (markupType === "highlight") {
        const id = setEditorTextMarkup(editor, scene, full, markupType, true)[0], mark = editor.getObject(id);
        assert.equal(mark.color, "#ffe04a"); assert.equal(mark.opacity, .35); assert.equal(mark.strokeWidth, 0);
        const compiled = await editor.getScene({ preview: false });
        const multiply = nodes => nodes.some(node => node.kind === "group" && (node.blendMode === "Multiply" || multiply(node.children)));
        assert(multiply(compiled.paintGraph.roots), "highlight fill retains Multiply compositing");
        setEditorTextMarkup(editor, scene, full, markupType, false);
      }
      assert.deepEqual(state(full), { value: false, mixed: false });
      const ids = set(full, true); assert.equal(ids.length, 1); assert.deepEqual(state(full), { value: true, mixed: false });
      const appliedRevision = editor.revision; assert.deepEqual(set(full, true), []); assert.equal(editor.revision, appliedRevision, "reapplying formatting creates neither duplicate marks nor history");
      set(middle, false); assert.deepEqual(state(middle), { value: false, mixed: false });
      assert.deepEqual(state(span(0, 1)), { value: true, mixed: false }); assert.deepEqual(state(span(4, 1)), { value: true, mixed: false });
      assert.deepEqual(state(full), { value: false, mixed: true });
      assert.equal(editor.getObject(ids[0]).review.quads.length, 2, "removing the middle retains both unselected ends");
      editor.undo(); assert.deepEqual(state(full), { value: true, mixed: false }, "partial removal is one undo step");
      editor.redo(); assert.deepEqual(state(middle), { value: false, mixed: false });
      set(middle, true); assert.deepEqual(state(full), { value: true, mixed: false });
      set(full, true, "strikeout"); assert.deepEqual(state(full, "strikeout"), { value: true, mixed: false });
      set(full, false, "strikeout"); assert.deepEqual(state(full, "strikeout"), { value: false, mixed: false }); assert.deepEqual(state(full), { value: true, mixed: false });
      const second = [{ pageIndex: 0, start: text.indexOf("Second"), length: 6 }]; assert.deepEqual(state(second), { value: false, mixed: false }, "nearby lines remain independent");
      const rotated = [{ pageIndex: 0, start: text.indexOf("Rotated"), length: 7 }]; set(rotated, true, "strikeout"); assert.deepEqual(state(rotated, "strikeout"), { value: true, mixed: false }); set(rotated, false, "strikeout"); assert.deepEqual(state(rotated, "strikeout"), { value: false, mixed: false });
      const lockId = set(second, true)[0]; editor.setObjectsLocked([lockId], true); const lockedRevision = editor.revision;
      set(second, false); assert.equal(editor.revision, lockedRevision); assert.deepEqual(state(second), { value: true, mixed: false }, "locked review marks retain their formatting"); editor.setObjectsLocked([lockId], false); set(second, false);
      const layer = editor.createLayer({ name: "Styles" }); editor.assignObjectsToLayer([ids[0]], layer); editor.updateLayer(layer, { defaultVisible: false });
      assert.deepEqual(state(span(0, 1)), { value: false, mixed: false }, "hidden formatting is absent from selection readback"); editor.updateLayer(layer, { defaultVisible: true });
      set(full, false); const finalMark = set(full, true)[0]; editor.assignObjectsToLayer([finalMark], layer);
      const hep = await editor.saveHep({ markSaved: false, withVectorLod: false, withTextLod: false, encodeRasterImages: false });
      const baked = await loadSceneFromHep(await hep.arrayBuffer()), hepEditor = createEditorSession(baked);
      try {
        assert.equal(baked.annotations.filter(annotation => annotation.subtype === (markupType === "highlight" ? "Highlight" : "Underline")).length, 1, "HEP retains standard review metadata without duplicate annotations");
        assert.deepEqual(editorTextMarkupState(hepEditor, baked, full, markupType), { value: true, mixed: false });
        setEditorTextMarkup(hepEditor, baked, middle, markupType, false);
        const changed = await hepEditor.getScene({ preview: false });
        assert.deepEqual(editorTextMarkupState(hepEditor, changed, middle, markupType), { value: false, mixed: false });
        assert.deepEqual(editorTextMarkupState(hepEditor, changed, span(0, 1), markupType), { value: true, mixed: false });
        assert((markupType === "highlight" ? changed.fillSegmentCount : changed.segmentCount) > 0, "HEP unformatting retains the unselected review appearance");
      } finally { hepEditor.dispose(); }
      const saved = new Uint8Array(await (await editor.savePdf({ markSaved: false })).arrayBuffer()), reopened = await open(saved);
      try {
        const nextText = reopened.scene.textIndex.pages[0].text, all = [{ pageIndex: 0, start: nextText.indexOf("ABCDE"), length: 5 }], part = [{ pageIndex: 0, start: nextText.indexOf("ABCDE") + 1, length: 3 }];
        assert.deepEqual(editorTextMarkupState(reopened.editor, reopened.scene, all, markupType), { value: true, mixed: false }, "saved standard annotations are recognized after reopening");
        const before = reopened.editor.revision;
        setEditorTextMarkup(reopened.editor, reopened.scene, part, markupType, false);
        const after = await reopened.editor.getScene({ preview: false });
        assert.equal(reopened.editor.revision, before + 1); assert.deepEqual(editorTextMarkupState(reopened.editor, after, part, markupType), { value: false, mixed: false });
        assert(reopened.editor.getObjects().some(object => object.kind === "shape" && object.review?.author === "Writer"), "partial source-annotation replacement retains author metadata");
        const replacements = reopened.editor.getObjects().filter(object => object.kind === "shape" && object.review?.type === markupType);
        assert(replacements.every(object => reopened.editor.getObjectLayerIds(object.id).includes(layer)), "partial source-annotation replacement retains its layer membership");
        if (markupType === "highlight") {
          assert(replacements.every(object => Math.abs(object.opacity - .35) < 1e-6), "partial source highlight removal retains its translucency");
          const expected = normalizePrimitiveColor("#123456");
          assert(replacements.every(object => normalizePrimitiveColor(object.color).every((channel, index) => Math.abs(channel - expected[index]) < 1e-4)), "partial source highlight removal retains its saved color");
        }
        const againBytes = new Uint8Array(await (await reopened.editor.savePdf({ markSaved: false })).arrayBuffer()), again = await open(againBytes);
        try { const text = again.scene.textIndex.pages[0].text; assert.deepEqual(editorTextMarkupState(again.editor, again.scene, [{ pageIndex: 0, start: text.indexOf("ABCDE") + 1, length: 3 }], markupType), { value: false, mixed: false }, "partial unformatting persists through PDF save/reopen"); } finally { again.close(); }
        reopened.editor.undo(); assert.deepEqual(editorTextMarkupState(reopened.editor, reopened.scene, all, markupType), { value: true, mixed: false });
      } finally { reopened.close(); }
      const transformed = await open(bytes);
      try {
        const spans = [{ pageIndex: 0, start: transformed.scene.textIndex.pages[0].text.indexOf("Second"), length: 6 }];
        const mark = setEditorTextMarkup(transformed.editor, transformed.scene, spans, markupType, true)[0];
        const page = transformed.scene.textIndex.pages[0], refs = Array.from(page.charInstance.slice(spans[0].start, spans[0].start + spans[0].length)).filter(index => index >= 0).map(index => ({ kind: "text", index }));
        transformed.editor.selectPrimitives(refs); transformed.editor.select([mark], { additive: true });
        transformed.editor.transformSelection([1, .2, .1, 1, 5, -8]);
        const current = await transformed.editor.getScene({ preview: false });
        assert.deepEqual(editorTextMarkupState(transformed.editor, current, spans, markupType), { value: true, mixed: false }, "selection readback follows transformed authored markup");
        setEditorTextMarkup(transformed.editor, current, spans, markupType, false);
        assert.deepEqual(editorTextMarkupState(transformed.editor, await transformed.editor.getScene({ preview: false }), spans, markupType), { value: false, mixed: false }, "selected transformed markup can be removed without selecting a deleted object");
      } finally { transformed.close(); }
      console.log("Text markup toggles: apply/remove, mixed state, partial ranges, no duplicates, undo/redo, rotation, layers, locks and PDF reopen passed.");
    } finally { original.close(); }
  }
} finally { hooks.deregister(); }
