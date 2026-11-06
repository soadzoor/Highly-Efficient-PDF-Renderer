import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const originalDA = "/Helv 10 Tf 1 0 0 rg % preserve font settings";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { NativePdfFormAppearanceRegistry } = await import("../src/pdf/nativeForms.ts");
  const { parseDefaultAppearance } = await import("../src/pdf/nativeAppearanceSynthesis.ts");
  const { createNodeBundledStandardFontResolver } = await import("../src/nodePdfResources.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { applyEditorPropertyPatch } = await import("../src/editorProperties.ts");
  const { getSceneAnnotationRuns } = await import("../src/scenePrimitives.ts");
  const { editorSourcePaintColors } = await import("../src/editorSourceColors.ts");
  const green = [0, 128 / 255, 0], red = [1, 0, 0], decoder = new TextDecoder();
  const same = (color, expected) => color.every((channel, index) => Math.abs(channel - expected[index]) < 1e-6);
  const refs = (scene, annotationId) => (getSceneAnnotationRuns(scene).get(annotationId) ?? [])
    .flatMap(run => Array.from({ length: run.count }, (_, index) => ({ kind: run.kind, index: run.first + index })));
  const open = async bytes => {
    const parser = await openPdf({ kind: "bytes", bytes }, { missingFontResolver: createNodeBundledStandardFontResolver() });
    const services = await createEditorAppServices({ sourcePdf: bytes, loadFontAsset: url => readFile(url) });
    try {
      const scene = await parser.compileVectorPage(0, { optimization: "none", preserveDrawingOrder: true, retainOptionalContent: true });
      const editor = await openEditorSession(scene, { ...services.sessionOptions, sourcePdf: bytes });
      return { editor, close: async () => { editor.dispose(); services.dispose(); await parser.close(); } };
    } catch (error) { services.dispose(); await parser.close(); throw error; }
  };
  const save = async editor => new Uint8Array(await (await editor.savePdf()).arrayBuffer());
  const inspect = async (bytes, expectedLocal, fontSize = 10) => {
    const document = await NativePdfDocument.open({ kind: "bytes", bytes }, { repair: "off" });
    try {
      const widgets = await new NativePdfFormAppearanceRegistry(document).listPageAnnotations(0), first = widgets[0], second = widgets[1];
      assert.equal(first.widget.fullyQualifiedName, "Name"); assert.equal(second.widget.fullyQualifiedName, "Name");
      const owner = await document.resolveDictionary(first.dictionary.get("Parent"));
      const ownerDA = decoder.decode(owner.get("DA").bytes);
      if (fontSize === 10) assert.equal(ownerDA, originalDA, "recoloring or refilling one widget never changes the shared field default");
      else assert(ownerDA.startsWith(originalDA + "\n"), "shared size changes retain the original field default operators and comments");
      assert.deepEqual(parseDefaultAppearance(owner.get("DA").bytes, first).color.components, red, "a widget-local color never replaces the shared field color");
      assert.equal(second.dictionary.has("DA"), false, "the sibling keeps inheriting its original color");
      assert.deepEqual(parseDefaultAppearance(second.widget.defaultAppearance.bytes, second).color.components, red);
      for (const annotation of widgets) assert.equal(parseDefaultAppearance(annotation.widget.defaultAppearance.bytes, annotation).fontSize, fontSize);
      if (expectedLocal) {
        const da = decoder.decode(first.dictionary.get("DA").bytes);
        assert(da.startsWith(originalDA + "\n"), "font resource, size, operators and trailing comments stay byte-for-byte intact");
        assert.deepEqual(parseDefaultAppearance(first.widget.defaultAppearance.bytes, first).color.components, green);
      } else assert.equal(first.dictionary.has("DA"), false, "a partial glyph edit cannot become a default for the entire field");
    } finally { await document.close(); }
  };
  for (const mode of ["whole-widget", "text-role", "partial-glyph"]) {
    const document = await open(fixture());
    let saved;
    try {
      const { editor } = document, annotation = editor.sourceScene.annotations.find(annotation => annotation.annotationIndex === 0);
      const members = refs(editor.sourceScene, annotation.id), text = members.filter(ref => ref.kind === "text");
      assert(text.length >= 2);
      if (mode === "whole-widget") editor.updateObject(`annotation:${annotation.id}`, { color: "green" });
      else editor.transaction("Recolor field text", () => {
        for (const ref of mode === "partial-glyph" ? text.slice(0, 1) : text) editor.updateObject(`source:${ref.kind}:${ref.index}`, { color: "green" });
      });
      saved = await save(editor); await inspect(saved, mode !== "partial-glyph");
    } finally { await document.close(); }
    // Reopen the editable PDF, change the shared field value, then save again.
    // Both widgets share the value but retain independent color defaults.
    if (mode !== "partial-glyph") {
      const reopened = await open(saved);
      try {
        const { editor } = reopened;
        editor.setFieldValue("Name", "Longer replacement value");
        const scene = await editor.getScene(), fields = scene.annotations.filter(annotation => annotation.field?.name === "Name");
        assert.equal(fields.length, 2); assert(fields.every(annotation => annotation.field.value === "Longer replacement value"));
        for (let index = 0; index < fields.length; index++) {
          const colors = editorSourcePaintColors(scene, refs(scene, fields[index].id).filter(ref => ref.kind === "text")).color;
          assert(colors.length > 0 && colors.every(color => same(color, index === 0 ? green : red)),
            `regenerated shared widgets retain their own text color: ${JSON.stringify({ mode, index, colors, field: fields[index].field })}`);
        }
        await inspect(await save(editor), true);
        editor.select([`annotation:${fields[0].id}`]);
        applyEditorPropertyPatch(editor, { fontSize: 18 });
        editor.setFieldValue("Name", "Replacement after size change");
        const resized = await editor.getScene();
        for (let index = 0; index < fields.length; index++) {
          const colors = editorSourcePaintColors(resized, refs(resized, fields[index].id).filter(ref => ref.kind === "text")).color;
          assert(colors.length > 0 && colors.every(color => same(color, index === 0 ? green : red)), "shared size changes retain widget-local colors while regenerating appearances");
        }
        await inspect(await save(editor), true, 18);
      } finally { await reopened.close(); }
    }
  }
  for (const sizeFirst of [false, true]) {
    const document = await open(fixture());
    try {
      const { editor } = document, annotation = editor.sourceScene.annotations.find(annotation => annotation.annotationIndex === 0);
      const id = `annotation:${annotation.id}`;
      editor.select([id]);
      if (sizeFirst) applyEditorPropertyPatch(editor, { fontSize: 18 });
      editor.updateObject(id, { color: "green" });
      if (!sizeFirst) applyEditorPropertyPatch(editor, { fontSize: 18 });
      editor.setFieldValue("Name", "Same-session color and size change");
      await inspect(await save(editor), true, 18);
    } finally { await document.close(); }
  }
  // Valid local defaults override an unsupported ancestor; unused operators
  // must not prevent editing these widgets or be copied into their appearances.
  const overridden = await open(fixture({ ownerDA: "0 Tc", widgetDA: originalDA }));
  try {
    const { editor } = overridden, annotation = editor.sourceScene.annotations.find(annotation => annotation.annotationIndex === 0);
    editor.select([`annotation:${annotation.id}`]);
    applyEditorPropertyPatch(editor, { fontSize: 18 });
    const pdf = await NativePdfDocument.open({ kind: "bytes", bytes: await save(editor) }, { repair: "off" });
    try {
      const widgets = await new NativePdfFormAppearanceRegistry(pdf).listPageAnnotations(0);
      const owner = await pdf.resolveDictionary(widgets[0].dictionary.get("Parent"));
      assert.equal(decoder.decode(owner.get("DA").bytes), "0 Tc", "unused ancestor defaults remain untouched");
      for (const widget of widgets) {
        assert(decoder.decode(widget.dictionary.get("DA").bytes).startsWith(originalDA + "\n"));
        const appearance = parseDefaultAppearance(widget.widget.defaultAppearance.bytes, widget);
        assert.equal(appearance.fontSize, 18);
        assert.deepEqual(appearance.color.components, red);
      }
    } finally { await pdf.close(); }
  } finally { await overridden.close(); }
  console.log("Source field colors in PDF: widget-local DA, retained font/size/operators, shared values, sibling isolation, reopen/refill/resave and partial-glyph guards passed.");
} finally { hooks.deregister(); }

function fixture({ ownerDA = originalDA, widgetDA } = {}) {
  const localDA = widgetDA === undefined ? "" : ` /DA (${widgetDA})`;
  return writeTinyPdf({ objects: [
    "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] /DR << /Font << /Helv 8 0 R >> >> >> >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /Helv 8 0 R >> >> /Contents 4 0 R /Annots [6 0 R 7 0 R] >>",
    tinyPdfStream("", ""),
    `<< /FT /Tx /T (Name) /V (Old) /DA (${ownerDA}) /Kids [6 0 R 7 0 R] >>`,
    `<< /Type /Annot /Subtype /Widget /Parent 5 0 R /Rect [10 10 90 30] /F 4 /P 3 0 R /AP << /N 9 0 R >>${localDA} >>`,
    `<< /Type /Annot /Subtype /Widget /Parent 5 0 R /Rect [100 10 180 30] /F 4 /P 3 0 R /AP << /N 9 0 R >>${localDA} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 80 20] /Resources << /Font << /Helv 8 0 R >> >>", "0 0 1 rg 0 0 80 20 re f BT /Helv 10 Tf 1 0 0 rg 2 4 Td (Old) Tj ET")
  ].map((body, index) => ({ number: index + 1, body })) });
}
