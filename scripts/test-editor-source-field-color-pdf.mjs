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
  const inspect = async (bytes, expectedLocal) => {
    const document = await NativePdfDocument.open({ kind: "bytes", bytes }, { repair: "off" });
    try {
      const widgets = await new NativePdfFormAppearanceRegistry(document).listPageAnnotations(0), first = widgets[0], second = widgets[1];
      assert.equal(first.widget.fullyQualifiedName, "Name"); assert.equal(second.widget.fullyQualifiedName, "Name");
      const owner = await document.resolveDictionary(first.dictionary.get("Parent"));
      assert.equal(decoder.decode(owner.get("DA").bytes), originalDA, "recoloring one widget never changes the shared field default");
      assert.equal(second.dictionary.has("DA"), false, "the sibling keeps inheriting its original color");
      assert.deepEqual(parseDefaultAppearance(second.widget.defaultAppearance.bytes, second).color.components, red);
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
      } finally { await reopened.close(); }
    }
  }
  console.log("Source field colors in PDF: widget-local DA, retained font/size/operators, shared values, sibling isolation, reopen/refill/resave and partial-glyph guards passed.");
} finally { hooks.deregister(); }

function fixture() {
  return writeTinyPdf({ objects: [
    "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] /DR << /Font << /Helv 8 0 R >> >> >> >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /Helv 8 0 R >> >> /Contents 4 0 R /Annots [6 0 R 7 0 R] >>",
    tinyPdfStream("", ""),
    `<< /FT /Tx /T (Name) /V (Old) /DA (${originalDA}) /Kids [6 0 R 7 0 R] >>`,
    "<< /Type /Annot /Subtype /Widget /Parent 5 0 R /Rect [10 10 90 30] /F 4 /P 3 0 R /AP << /N 9 0 R >> >>",
    "<< /Type /Annot /Subtype /Widget /Parent 5 0 R /Rect [100 10 180 30] /F 4 /P 3 0 R /AP << /N 9 0 R >> >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 80 20] /Resources << /Font << /Helv 8 0 R >> >>", "0 0 1 rg 0 0 80 20 re f BT /Helv 10 Tf 1 0 0 rg 2 4 Td (Old) Tj ET")
  ].map((body, index) => ({ number: index + 1, body })) });
}
