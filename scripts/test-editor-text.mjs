import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
try {
  const { createEditorFontRegistry } = await import("../src/editorFonts.ts");
  const { layoutEditorText, editorTextPdf } = await import("../src/editorText.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const fonts = createEditorFontRegistry({ loadAsset: async url => new Uint8Array(await readFile(url)) });
  const regular = await fonts.loadBundled("Liberation Sans");
  assert.equal(regular.family, "Liberation Sans");
  assert.equal((await fonts.register(regular.bytes)).id, regular.id, "font data is deduplicated");
  const bold = await fonts.resolve({ fontId: regular.id, fontWeight: "bold" });
  assert.equal(bold.fontWeight, 700); assert.notEqual(bold.id, regular.id);
  assert.equal((await fonts.resolve({ fontId: bold.id })).id, bold.id, "an explicit face retains its intrinsic style when no override is supplied");
  assert.equal((await fonts.resolve({ fontId: bold.id, fontWeight: "normal" })).id, regular.id);
  const object = { id: "text", kind: "text", pageIndex: 0, transform: [1,0,0,1,0,0],
    x: 5, y: 5, width: 180, height: 90, fontSize: 15, text: "Office résumé Ω combining á",
    runs: [{ text:"Office résumé ", fontId:regular.id }, { text:"Ω combining á", fontId:bold.id, fontWeight:700, color:"red", underline:true, strikethrough:true }] };
  const layout = await layoutEditorText(object, fonts);
  assert(layout.glyphs.length > 5); assert(layout.glyphs.every(glyph => glyph.size === 15));
  assert(layout.glyphs.some(glyph => glyph.font.id === bold.id));
  assert.equal(layout.glyphs.map(glyph => glyph.unicode).join(""), object.text);
  assert(layout.glyphs.every(glyph => Number.isFinite(glyph.x) && Number.isFinite(glyph.y)));
  const bytes = await editorTextPdf(object, fonts);
  const parsed = await openPdf({ kind:"bytes", bytes });
  let scene;
  try { scene = await parsed.compileVectorPage(0, { optimization:"none" }); }
  finally { await parsed.close(); }
  assert(scene.textInstanceCount > 0, "new text remains glyph geometry");
  assert(scene.textIndex.pages[0].text.includes("résumé"));
  assert(scene.textIndex.pages[0].text.includes("Ω"));
  assert(scene.segmentCount + scene.fillPathCount > 0, "decorations remain vector");
  assert.equal(scene.rasterLayers.length, 0, "custom-font text does not rasterize");
  const wrapped = await layoutEditorText({ ...object, width:40, text:"A very long wordwithoutspaces", runs:undefined }, fonts);
  assert(wrapped.height > 30); assert(wrapped.glyphs.every(glyph => glyph.x >= object.x - .01));
  const rtl = await layoutEditorText({ ...object, text:"abc אבג 123", runs:undefined }, fonts);
  assert(rtl.glyphs.some(glyph => glyph.unicode === "א"));
  const rtlParser = await openPdf({ kind:"bytes", bytes:await editorTextPdf({ ...object, text:"abc אבג 123", runs:undefined }, fonts) });
  try {
    const indexed=(await rtlParser.compileVectorPage(0,{optimization:"none"})).textIndex.pages[0];
    assert(indexed.text.includes("אבג"), `RTL text remains searchable in logical order: ${indexed.text}`);
    const start=indexed.text.indexOf("אבג"); assert.equal(new Set(indexed.charInstance.slice(start,start+3)).size,3,"each RTL character retains its own selection geometry");
  }
  finally { await rtlParser.close(); }
  const aborted = new AbortController(); aborted.abort(); await assert.rejects(layoutEditorText(object, fonts, aborted.signal), {name:"AbortError"});

  const source = buildStrokeScene([{ points:[[0,0],[200,100]], width:1 }]);
  const services = await createEditorAppServices({ loadFontAsset:async url => new Uint8Array(await readFile(url)) });
  await services.fonts.register(regular.bytes, { family: regular.family });
  await services.fonts.register(bold.bytes, { family: bold.family, fontWeight:700 });
  const editor = await openEditorSession(source, services.sessionOptions);
  const textId=editor.addObject({ ...object, id:undefined }); const combined = await editor.getScene();
  assert.equal(combined.pageCount,1); assert(combined.textInstanceCount > 0);
  const pdf = await editor.savePdf(); assert.equal(pdf.type,"application/pdf");
  editor.updateObject(textId,{text:"Replaced text"}); assert.equal(editor.getObject(textId).runs,undefined,"plain text replacement clears previous rich runs");
  assert((await editor.getScene()).textIndex.pages[0].text.includes("Replaced text"));
  editor.updateObject(textId,{runs:[{text:"Rich updated",color:"blue"}]}); assert.equal(editor.getObject(textId).text,"Rich updated");
  editor.dispose(); services.dispose(); fonts.dispose();
  console.log("HarfBuzz rich text, custom font bytes, Unicode, decorations, wrapping and PDF vector round trips passed.");
} finally { hooks.deregister(); }
