import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });
try {
  const { readEditorTextAnnotation } = await import("../src/editorTextAnnotations.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { createEditorFontRegistry } = await import("../src/editorFonts.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { NativePdfFormAppearanceRegistry } = await import("../src/pdf/nativeForms.ts");
  const { NativePdfWriter, pdfTextValue } = await import("../src/pdf/nativeWriter.ts");
  const { layoutEditorText } = await import("../src/editorText.ts");
  const { multiplyEditorMatrices } = await import("../src/editorScene.ts");
  const compile = async bytes => {
    const parser = await openPdf({ kind: "bytes", bytes });
    try { return await parser.compileVectorPage(0, { optimization: "none" }); }
    finally { await parser.close(); }
  };
  const bytes = sourceFixture(), scene = await compile(bytes);
  const services = await createEditorAppServices({ sourcePdf: bytes, loadFontAsset: async url => new Uint8Array(await readFile(url)) });
  const regular = await services.fonts.loadBundled("Liberation Sans"), boldItalic = await services.fonts.loadBundled("Liberation Sans", { fontWeight: 700, fontStyle: "italic" });
  const angle = .1, c = Math.cos(angle), s = Math.sin(angle);
  const model = { id: "rich-text", kind: "text", pageIndex: 0, transform: [c, s, -s, c, 5, 8],
    x: 10, y: 30, width: 180, height: 75, text: "Office Ω café", fontId: regular.id, fontFamily: "Saved family alias",
    fontSize: 16, fontWeight: 400, fontStyle: "normal", align: "center", lineHeight: 1.3, opacity: .8,
    color: "#123456", runs: [{ text: "Office ", fontId: regular.id, fontFamily: "Saved family alias", fontSize: 16, color: "#123456" },
      { text: "Ω café", fontId: boldItalic.id, fontFamily: "Saved family alias", fontSize: 20, fontWeight: 700,
        fontStyle: "italic", underline: true, strikethrough: true, color: [.8, .1, .2] }] };
  const editor = await openEditorSession(scene, services.sessionOptions);
  let saved;
  try { editor.addObject(model); saved = new Uint8Array(await (await editor.savePdf()).arrayBuffer()); }
  finally { editor.dispose(); services.dispose(); }
  const savedScene = await compile(saved), annotation = savedScene.annotations.find(annotation => annotation.name === model.id);
  assert(annotation); assert.equal(annotation.subtype, "FreeText");
  const restoredFonts = createEditorFontRegistry({ loadAsset() { throw new Error("Restored text must use its embedded font bytes."); } });
  const restored = await readEditorTextAnnotation(saved, annotation.id, restoredFonts);
  assert.deepEqual(restored, model, "saved text/runs/geometry/styles are recovered exactly");
  assert.deepEqual(restoredFonts.get(regular.id).bytes, regular.bytes, "regular source font bytes survive the PDF roundtrip");
  assert.deepEqual(restoredFonts.get(boldItalic.id).bytes, boldItalic.bytes, "styled source font bytes survive the PDF roundtrip");
  assert.equal(restoredFonts.get(regular.id).family, "Saved family alias");
  assert.equal(restoredFonts.get(boldItalic.id).fontStyle, "italic");
  const layout = await layoutEditorText(restored, restoredFonts);
  assert(layout.glyphs.some(glyph => glyph.font.id === regular.id));
  assert(layout.glyphs.some(glyph => glyph.font.id === boldItalic.id));
  assert.equal(layout.glyphs.map(glyph => glyph.unicode).join(""), model.text);

  const movedServices = await createEditorAppServices({ sourcePdf: saved,
    loadFontAsset() { throw new Error("Moving text must retain the existing appearance resources."); } });
  const movedEditor = await openEditorSession(savedScene, movedServices.sessionOptions), delta = [1, 0, 0, 1, 15, -7];
  let moved;
  try {
    movedEditor.select([`annotation:${annotation.id}`]); movedEditor.transformSelection(delta);
    moved = new Uint8Array(await (await movedEditor.savePdf()).arrayBuffer());
  } finally { movedEditor.dispose(); movedServices.dispose(); }
  const movedScene = await compile(moved), movedAnnotation = movedScene.annotations.find(annotation => annotation.name === model.id);
  const nestedFonts = createEditorFontRegistry({ loadAsset() { throw new Error("Nested appearance fonts must be found recursively."); } });
  const movedModel = await readEditorTextAnnotation(moved, movedAnnotation.id, nestedFonts);
  assert.deepEqual(movedModel.transform, multiplyEditorMatrices(delta, model.transform), "saved native annotation moves update the authoring transform");
  assert.deepEqual(nestedFonts.get(boldItalic.id).bytes, boldItalic.bytes, "fonts under nested transformed Form XObjects are restored");

  const editingServices = await createEditorAppServices({ sourcePdf: moved,
    loadFontAsset() { throw new Error("Re-editing saved text must not load replacement fonts."); } });
  const editable = await readEditorTextAnnotation(moved, movedAnnotation.id, editingServices.fonts);
  const editedModel = { ...editable, id: "edited-rich-text", text: "Edited Ω café", runs: [{ ...editable.runs[0], text: "Edited " }, editable.runs[1]] };
  const editing = await openEditorSession(movedScene, editingServices.sessionOptions);
  let edited;
  try {
    editing.select([`annotation:${movedAnnotation.id}`]); editing.deleteSelection(); editing.addObject(editedModel);
    edited = new Uint8Array(await (await editing.savePdf()).arrayBuffer());
  } finally { editing.dispose(); editingServices.dispose(); }
  const editedScene = await compile(edited), editedAnnotation = editedScene.annotations.find(annotation => annotation.name === editedModel.id);
  assert(editedAnnotation); assert(!editedScene.annotations.some(annotation => annotation.name === model.id), "replacement text removes the old annotation");
  assert(editedScene.textIndex.pages[0].text.includes("Edited")); assert(!editedScene.textIndex.pages[0].text.includes("Office"));
  const finalFonts = createEditorFontRegistry();
  assert.deepEqual(await readEditorTextAnnotation(edited, editedAnnotation.id, finalFonts), editedModel,
    "re-edited text retains run font sizes, decorators, color, font IDs and geometry");

  const emptyServices = await createEditorAppServices({ sourcePdf: bytes, loadFontAsset() { throw new Error("Selected imported fonts are already available."); } });
  await emptyServices.fonts.register(regular.bytes, { family: "Saved family alias" });
  await emptyServices.fonts.register(boldItalic.bytes, { family: "Saved family alias", fontWeight: 700, fontStyle: "italic" });
  const emptyEditor = await openEditorSession(scene, emptyServices.sessionOptions);
  const emptyModel = { ...model, id: "empty-text", text: "", runs: model.runs.map(run => ({ ...run, text: "" })) };
  const familyOnlyModel = { ...model, id: "second-text", x: 35, fontId: undefined,
    runs: model.runs.map(({ fontId, ...run }) => run) };
  let twoBoxes;
  try {
    emptyEditor.addObject(emptyModel); emptyEditor.addObject(familyOnlyModel);
    twoBoxes = new Uint8Array(await (await emptyEditor.savePdf()).arrayBuffer());
  } finally { emptyEditor.dispose(); emptyServices.dispose(); }
  const twoBoxesScene = await compile(twoBoxes), emptyAnnotation = twoBoxesScene.annotations.find(annotation => annotation.name === "empty-text");
  const emptyFonts = createEditorFontRegistry({ loadAsset() { throw new Error("Empty text retains the selected embedded fonts."); } });
  assert.deepEqual(await readEditorTextAnnotation(twoBoxes, emptyAnnotation.id, emptyFonts), emptyModel);
  assert.deepEqual(emptyFonts.get(regular.id).bytes, regular.bytes, "empty boxes retain the selected regular face");
  assert.deepEqual(emptyFonts.get(boldItalic.id).bytes, boldItalic.bytes, "empty styled runs retain their font bytes");
  const familyFonts = createEditorFontRegistry({ loadAsset() { throw new Error("Saved family names resolve to embedded faces."); } });
  const familyAnnotation = twoBoxesScene.annotations.find(annotation => annotation.name === "second-text");
  const familyOnly = await readEditorTextAnnotation(twoBoxes, familyAnnotation.id, familyFonts);
  assert.equal(familyOnly.fontFamily, familyOnlyModel.fontFamily);
  assert.equal(familyOnly.fontId, regular.id);
  assert.equal(familyOnly.runs[1].fontId, boldItalic.id, "family-only styles recover their actual embedded font identities");
  assert.equal(familyFonts.get(regular.id).family, "Saved family alias", "FontDescriptor family names preserve imported aliases");
  const deduplicated = await NativePdfDocument.open({ kind: "bytes", bytes: twoBoxes });
  try {
    const files = new Set(), visited = new Set();
    const resolve = value => deduplicated.resolveValue(value);
    const font = async value => {
      const dictionary = await resolve(value); if (!(dictionary instanceof Map) || visited.has(dictionary)) return; visited.add(dictionary);
      const descriptor = await resolve(dictionary.get("FontDescriptor"));
      if (descriptor instanceof Map) for (const name of ["FontFile2", "FontFile3", "FontFile"]) {
        const file = descriptor.get(name); if (file?.kind === "ref") files.add(`${file.objectNumber}:${file.generation}`);
      }
      const descendants = await resolve(dictionary.get("DescendantFonts")); if (Array.isArray(descendants)) for (const child of descendants) await font(child);
    };
    const resources = async value => {
      const dictionary = await resolve(value); if (!(dictionary instanceof Map) || visited.has(dictionary)) return; visited.add(dictionary);
      const fonts = await resolve(dictionary.get("Font")); if (fonts instanceof Map) for (const value of fonts.values()) await font(value);
      const objects = await resolve(dictionary.get("XObject")); if (objects instanceof Map) for (const value of objects.values()) {
        const stream = await resolve(value); if (stream?.kind === "stream") await resources(stream.dictionary.get("Resources"));
      }
    };
    const registry = new NativePdfFormAppearanceRegistry(deduplicated);
    for (const annotation of await registry.listPageAnnotations(0, undefined, true)) {
      const appearance = await resolve(annotation.dictionary.get("AP")), normal = await resolve(appearance?.get("N"));
      if (normal?.kind === "stream") await resources(normal.dictionary.get("Resources"));
    }
    assert.equal(files.size, 2, "two textboxes share the same two embedded font streams");
  } finally { await deduplicated.close(); emptyFonts.dispose(); familyFonts.dispose(); }

  const overrideServices = await createEditorAppServices({ sourcePdf: bytes,
    loadFontAsset() { throw new Error("Explicit font metadata must be retained."); } });
  await overrideServices.fonts.register(regular.bytes, { family: "User font label", fontWeight: 700, fontStyle: "italic" });
  const overrideModel = { ...model, id: "style-override", text: "A", runs: undefined, fontFamily: "User font label", fontWeight: 700, fontStyle: "italic" };
  const overrideEditor = await openEditorSession(scene, overrideServices.sessionOptions);
  let overrideBytes;
  try {
    overrideEditor.addObject(overrideModel); overrideBytes = new Uint8Array(await (await overrideEditor.savePdf()).arrayBuffer());
  } finally { overrideEditor.dispose(); overrideServices.dispose(); }
  const overrideScene = await compile(overrideBytes), overrideAnnotation = overrideScene.annotations.find(annotation => annotation.name === "style-override");
  const overrideFonts = createEditorFontRegistry(), override = await readEditorTextAnnotation(overrideBytes, overrideAnnotation.id, overrideFonts);
  try {
    assert.equal(overrideFonts.get(regular.id).fontWeight, 700);
    assert.equal(overrideFonts.get(regular.id).fontStyle, "italic");
    const layout = await layoutEditorText(override, overrideFonts);
    assert(layout.glyphs.every(glyph => !glyph.bold && !glyph.italic), "restoration never adds synthetic styling that the saved font metadata already supplied");
  } finally { overrideFonts.dispose(); }

  const sourceDocument = await NativePdfDocument.open({ kind: "bytes", bytes: saved });
  const rawRef = annotation.id.split(":").slice(1).map(Number), ref = { kind: "ref", objectNumber: rawRef[0], generation: rawRef[1] };
  try {
    const original = await sourceDocument.resolveObject(ref);
    for (const payload of [{ version: 2, object: model }, { version: 1, object: { ...model, fontSize: -1 } },
      { version: 1, object: { ...model, transform: [0, 0, 0, 0, 0, 0] } },
      { version: 1, object: { ...model, fontStyle: ["italic"] } },
      { version: 1, object: { ...model, runs: [{ text: "Bad", color: "url(https://invalid.example/)" }] } }]) {
      const writer = new NativePdfWriter(sourceDocument), dictionary = new Map(original);
      dictionary.set("HEPRText", pdfTextValue(JSON.stringify(payload))); writer.set(ref, dictionary);
      assert.equal(await readEditorTextAnnotation(await writer.save(), annotation.id, finalFonts), null, "invalid JSON model data is ignored");
    }
    const writer = new NativePdfWriter(sourceDocument), dictionary = new Map(original);
    dictionary.delete("HEPRText"); writer.set(ref, dictionary);
    assert.equal(await readEditorTextAnnotation(await writer.save(), annotation.id, finalFonts), null, "ordinary PDF annotations remain source drawing objects");
  } finally { await sourceDocument.close(); }
  assert.equal(await readEditorTextAnnotation(saved, "ref:99999:0", finalFonts), null);
  await assert.rejects(readEditorTextAnnotation(saved, annotation.id, finalFonts, { signal: AbortSignal.abort() }), { name: "AbortError" });
  restoredFonts.dispose(); nestedFonts.dispose(); finalFonts.dispose();
  console.log("Saved PDF text annotation restoration: rich styles, original embedded fonts, nested transforms, re-edit/save, validation and cancellation passed.");
} finally { hooks.deregister(); }

function sourceFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 250] /Rotate 90 /Resources << >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "1 1 1 rg 0 0 400 250 re f") }
  ] });
}
