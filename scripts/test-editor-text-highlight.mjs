import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(s, c, n) { return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c); } });
try {
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { layoutEditorText, editorTextPdf } = await import("../src/editorText.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { readEditorTextAnnotation } = await import("../src/editorTextAnnotations.ts");
  const { createEditorFontRegistry } = await import("../src/editorFonts.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { editorPropertyState, applyEditorPropertyPatch } = await import("../src/editorProperties.ts");
  const { editorSelectedTextStyleState, setEditorSelectedTextStyle } = await import("../src/editorTextStyles.ts");
  const { readRichTextRuns } = await import("../src/editorRichText.ts");
  const { loadSceneFromHep } = await import("../src/hepReader.ts");
  const compile = async bytes => {
    const parser = await openPdf({ kind: "bytes", bytes });
    try { return await parser.compileVectorPage(0, { optimization: "none", preserveDrawingOrder: true }); } finally { await parser.close(); }
  };
  const services = await createEditorAppServices({ loadFontAsset: async url => new Uint8Array(await readFile(url)) });
  const font = await services.fonts.loadBundled();
  const model = { id: "highlighted-text", kind: "text", pageIndex: 0, transform: [1, 0, 0, 1, 0, 0], x: 5, y: 5, width: 160, height: 60,
    text: "ABCD", fontId: font.id, fontSize: 20, color: "#123456", backgroundColor: "#aaffaa",
    runs: [{ text: "A" }, { text: "B", backgroundColor: null, fontWeight: "bold" }, { text: "CD", backgroundColor: "#ffdc00", color: "red" }] };
  const editor = createEditorSession(buildStrokeScene([{ points: [[0, 0], [200, 100]], width: 1 }]), services.sessionOptions);
  const restoredFonts = createEditorFontRegistry();
  try {
    editor.addObject(model); editor.select([model.id]); const initial = editor.getObject(model.id);
    const layout = await layoutEditorText(model, services.fonts);
    assert(layout.glyphs.find(glyph => glyph.unicode === "A").backgroundColor);
    assert.equal(layout.glyphs.find(glyph => glyph.unicode === "B").backgroundColor, null, "explicitly plain runs override an object highlight");
    const highlighted = await compile(await editorTextPdf(model, services.fonts));
    const plain = await compile(await editorTextPdf({ ...model, backgroundColor: null, runs: model.runs.map(run => ({ ...run, backgroundColor: null })) }, services.fonts));
    assert(highlighted.fillPathCount > plain.fillPathCount, "highlight stays portable vector background geometry");
    const firstTextRun = highlighted.drawRuns.findIndex(run => run.kind === "text");
    assert(firstTextRun > 0 && highlighted.drawRuns.slice(0, firstTextRun).some(run => run.kind === "fill"), "all highlight paint precedes the text glyphs");
    assert.equal(highlighted.textIndex.pages[0].text, plain.textIndex.pages[0].text, "highlight does not add searchable content");
    const presented = await editor.getScene({ preview: false }), page = presented.textIndex.pages[0], start = page.text.indexOf("ABCD");
    const span = [{ pageIndex: 0, start: start + 2, length: 1 }];
    assert.equal(editorSelectedTextStyleState(editor, presented, span, "highlight").value, true);
    const revision = editor.revision; setEditorSelectedTextStyle(editor, presented, span, "highlight", false);
    assert.equal(editor.revision, revision + 1);
    assert.equal(editorSelectedTextStyleState(editor, presented, span, "highlight").value, false);
    const changed = editor.getObject(model.id);
    assert.deepEqual(changed.runs.map(run => [run.text, run.backgroundColor]), [["A", undefined], ["B", null], ["C", null], ["D", "#ffdc00"]]);
    assert.equal(changed.runs[1].fontWeight, "bold"); assert.equal(changed.runs[2].color, "red");
    editor.undo(); assert.deepEqual(editor.getObject(model.id), initial, "one Undo restores the exact rich highlight model");
    assert.equal(editorPropertyState(editor, "backgroundColor").mixed, true);
    applyEditorPropertyPatch(editor, { backgroundColor: null }); assert.equal(editorPropertyState(editor, "backgroundColor").value, false); editor.undo();
    const saved = new Uint8Array(await (await editor.savePdf({ markSaved: false })).arrayBuffer());
    const savedScene = await compile(saved), annotation = savedScene.annotations.find(annotation => annotation.name === model.id);
    assert(annotation);
    const restored = await readEditorTextAnnotation(saved, annotation.id, restoredFonts);
    assert.equal(restored.backgroundColor, model.backgroundColor);
    assert.deepEqual(restored.runs.map(run => [run.text, run.backgroundColor]), model.runs.map(run => [run.text, run.backgroundColor]), "editable PDF preserves object and run background colors, including null overrides");
    const hep = await editor.saveHep({ markSaved: false, withVectorLod: false, withTextLod: false });
    const reopened = await loadSceneFromHep(await hep.arrayBuffer());
    assert(reopened.fillPathCount >= highlighted.fillPathCount, "HEP retains the visible highlight backgrounds");
    assert(reopened.textIndex.pages[0].text.includes("ABCD"));

    const root = { nodeType: 1, tagName: "DIV", childNodes: [], parentElement: null }, outer = { nodeType: 1, tagName: "SPAN", childNodes: [], parentElement: root }, inner = { nodeType: 1, tagName: "B", childNodes: [], parentElement: outer };
    const text = { nodeType: 3, textContent: "Nested", parentElement: inner }; root.childNodes = [outer]; outer.childNodes = [inner]; inner.childNodes = [text];
    for (const node of [root, outer, inner]) node.closest = () => null;
    const dom = { getComputedStyle: node => ({ fontFamily: '"Liberation Sans"', fontSize: "12px", fontWeight: "400", fontStyle: "normal", color: "rgb(0, 0, 0)", textDecorationLine: "none", backgroundColor: node === outer ? "rgb(255, 220, 0)" : "rgba(0, 0, 0, 0)" }) };
    assert.equal(readRichTextRuns(root, dom)[0].backgroundColor, "#ffdc00", "nested formatting retains a painted ancestor highlight");
    dom.getComputedStyle = () => ({ fontFamily: '"Liberation Sans"', fontSize: "12px", fontWeight: "400", fontStyle: "normal", color: "rgb(0, 0, 0)", textDecorationLine: "none", backgroundColor: "transparent" });
    assert.equal(readRichTextRuns(root, dom)[0].backgroundColor, null, "unhighlighted DOM text explicitly clears an object default");
    dom.getComputedStyle = node => ({ fontFamily: '"Liberation Sans"', fontSize: "12px", fontWeight: "400", fontStyle: "normal", color: "rgb(0, 0, 0)", textDecorationLine: "none", backgroundColor: node === root ? "rgba(255, 255, 255, 0.94)" : "transparent" });
    assert.equal(readRichTextRuns(root, dom)[0].backgroundColor, null, "the white editing backdrop never becomes a saved text highlight");
    console.log("Authored highlights: partial run toggles, inherited and cleared backgrounds, vector paint order, Unicode, Undo, rich DOM and PDF/HEP roundtrips passed.");
  } finally { restoredFonts.dispose(); editor.dispose(); services.dispose(); }
} finally { hooks.deregister(); }
