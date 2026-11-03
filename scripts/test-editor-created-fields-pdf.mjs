import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { NativePdfFormAppearanceRegistry, decodePdfString } = await import("../src/pdf/nativeForms.ts");
  const { isPdfDictionary, isPdfStream } = await import("../src/pdf/nativeCos.ts");
  const { createNodeBundledStandardFontResolver } = await import("../src/nodePdfResources.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { loadSceneFromHep } = await import("../src/hepReader.ts");
  const { getSceneAnnotationRuns } = await import("../src/scenePrimitives.ts");
  const { readEditorFieldFrame } = await import("../src/editorNativePdf.ts");
  const open = async bytes => {
    const parser = bytes ? await openPdf({ kind: "bytes", bytes }, { missingFontResolver: createNodeBundledStandardFontResolver() }) : undefined;
    const services = await createEditorAppServices({ sourcePdf: bytes, loadFontAsset: url => readFile(url) });
    try {
      const pages = [];
      if (parser) for (let index = 0; index < parser.info.pageCount; index++) pages.push(await parser.compileVectorPage(index,
        { optimization: "none", preserveDrawingOrder: true, retainOptionalContent: true }));
      const scene = pages.length ? composeVectorScenesInGrid(pages, 1) : buildStrokeScene([{ points: [[0, 0], [400, 500]], width: 1 }]);
      const session = await openEditorSession(scene, { ...services.sessionOptions, sourcePdf: bytes });
      return { session, close: async () => { session.dispose(); services.dispose(); await parser?.close(); } };
    } catch (error) { services.dispose(); await parser?.close(); throw error; }
  };
  const save = async (session, options) => new Uint8Array(await (await session.savePdf(options)).arrayBuffer());
  const add = (session, fieldType, name, extra = {}) => session.addObject({ kind: "field", fieldType, name, pageIndex: 0,
    x: 30, y: 430 - session.getObjects().length * 24, width: 160, height: 20, ...extra });
  const options = [{ value: "a", label: "Árvíz" }, { value: "b", label: "Été" }];
  const inspect = async (bytes, expectedCount, action = async () => {}) => {
    const document = await NativePdfDocument.open({ kind: "bytes", bytes }, { repair: "off" });
    try {
      const forms = new NativePdfFormAppearanceRegistry(document), annotations = [];
      for (let index = 0; index < document.pages.length; index++) annotations.push(...await forms.listPageAnnotations(index));
      assert.equal(annotations.length, expectedCount, "each authored widget appears exactly once");
      const byName = new Map(annotations.map(annotation => [annotation.widget?.fullyQualifiedName, annotation]));
      await action(document, forms, annotations, byName);
    } finally { await document.close(); }
  };
  const initial = fixture(), opened = await open(initial); let edited;
  try {
    const { session } = opened;
    const angle = Math.PI / 4, rotation = [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 200, -10];
    add(session, "text", "Unicode", { value: "Árvíztűrő", defaultValue: "Default", fontSize: 11, transform: rotation });
    add(session, "number", "Amount", { value: "12.5", required: true });
    add(session, "date", "Date", { value: "2026-11-02" });
    add(session, "email", "Email", { value: "person@example.com" });
    add(session, "tel", "Telephone", { value: "+36 123 456" });
    add(session, "url", "Website", { value: "https://example.com" });
    add(session, "checkbox", "Agree", { value: true, defaultValue: false, width: 18, height: 18 });
    add(session, "radio", "Choice", { onValue: "First", value: "Off", width: 18, height: 18 });
    add(session, "radio", "Choice", { onValue: "Second", value: "Second", width: 18, height: 18 });
    add(session, "dropdown", "Dropdown", { options, value: "b" });
    add(session, "list", "List", { options, multiSelect: true, value: ["a", "b"], height: 40 });
    add(session, "text", "Read only", { value: "Locked", readOnly: true });
    add(session, "text", "Notes", { value: "One\nTwo", multiline: true, maxLength: 100, tooltip: "Additional notes", height: 40 });
    edited = await save(session);
    await inspect(edited, 14, async (document, _forms, annotations, fields) => {
      const acro = await document.resolveDictionary(document.catalog.get("AcroForm"));
      assert.equal(acro.get("NeedAppearances"), false);
      const roots = await document.resolveValue(acro.get("Fields"));
      assert.equal(roots.length, 13, "radio widgets share one field root and existing roots are preserved");
      const resources = await document.resolveDictionary(acro.get("DR"));
      assert(isPdfDictionary(resources.get("XObject")), "existing AcroForm resource categories are preserved");
      const fonts = await document.resolveDictionary(resources.get("Font"));
      assert.equal(fonts.size, 1, "fields with the same face share an embedded authoring font");
      const font = await document.resolveDictionary([...fonts.values()][0]);
      const descendants = await document.resolveValue(font.get("DescendantFonts"));
      const descendant = await document.resolveDictionary(descendants[0]), descriptor = await document.resolveDictionary(descendant.get("FontDescriptor"));
      assert(isPdfStream(await document.resolveValue(descriptor.get("FontFile2"))), "future field edits retain real embedded font bytes");
      for (const [name, type] of [["Amount", "number"], ["Date", "date"], ["Email", "email"], ["Telephone", "tel"], ["Website", "url"]]) {
        assert.equal(fields.get(name).widget.fieldType, "Tx"); assert.equal(fields.get(name).dictionary.get("HEPRInputType").value, type);
        assert.equal(fields.get(name).dictionary.has("AA"), false, "typed controls do not generate PDF scripts");
      }
      assert(fields.get("Amount").widget.fieldFlags & 2);
      assert.equal(decodePdfString(fields.get("Unicode").widget.defaultValue, 0, 0), "Default");
      assert.equal(fields.get("Agree").widget.defaultValue.value, "Off");
      const unicodeOwner = await document.resolveDictionary(fields.get("Unicode").dictionary.get("Parent"));
      assert(new TextDecoder().decode(unicodeOwner.get("DA").bytes).startsWith("/HEPRFieldFont"), "authoring font defaults belong to the field owner too");
      assert(fields.get("Read only").widget.fieldFlags & 1);
      assert(fields.get("Notes").widget.fieldFlags & (1 << 12)); assert.equal(fields.get("Notes").widget.maxLength, 100);
      const notes = await document.resolveDictionary(fields.get("Notes").dictionary.get("Parent"));
      assert.equal(decodePdfString(notes.get("TU"), 0, 0), "Additional notes");
      const frame = await readEditorFieldFrame(document, fields.get("Unicode"));
      assert(frame && Math.abs(frame.rect[2] - frame.rect[0] - 160) < 1e-6, "the field's logical width survives arbitrary rotation");
      assert(Math.abs(frame.transform[1]) > .5);
      const radio = annotations.filter(annotation => annotation.widget?.fullyQualifiedName === "Choice");
      assert.equal(radio[0].widget.value.value, "Second"); assert.equal(radio[0].appearanceState, "Off"); assert.equal(radio[1].appearanceState, "Second");
      assert.equal(fields.get("Agree").appearanceState, "Yes");
      assert.deepEqual(fields.get("List").widget.selectedChoiceIndices, [0, 1]);
    });
    await inspect(await save(session, { flatten: true }), 0, async document => assert.equal(document.catalog.has("AcroForm"), false));
  } finally { await opened.close(); }
  const reopened = await open(edited);
  try {
    const { session } = reopened;
    const authored = session.sourceScene.annotations.filter(annotation => annotation.field?.name === "Amount");
    assert.equal(authored[0].field.inputType, "number", "the typed hint survives native parsing");
    session.setFieldValue("Unicode", "Őű Œ Ελληνικά");
    session.setFieldValue("Amount", "987.25"); session.setFieldValue("Choice", "First"); session.setFieldValue("Agree", false);
    const scene = await session.getScene();
    assert(scene.textInstanceCount > 0, "new Unicode content regenerates from the embedded font");
    assert(scene.textIndex.pages.some(page => page.text.includes("Őű Œ Ελληνικά")), "regenerated appearances map characters absent from the initial value");
    const saved = await save(session);
    await inspect(saved, 14, async (document, _forms, _annotations, fields) => {
      assert.equal(fields.get("Agree").appearanceState, "Off");
      const frame = await readEditorFieldFrame(document, fields.get("Unicode"));
      assert(frame && Math.abs(frame.rect[2] - frame.rect[0] - 160) < 1e-6, "refilling never enlarges the rotated logical field plane");
      assert.equal(decodePdfString(fields.get("Unicode").widget.value, 0, 0), "Őű Œ Ελληνικά");
    });
  } finally { await reopened.close(); }
  const hepInput = await open();
  try {
    add(hepInput.session, "number", "Scene amount", { value: "42" });
    await inspect(await save(hepInput.session), 1, async (_document, _forms, _annotations, fields) => assert.equal(fields.get("Scene amount").widget.fieldType, "Tx"));
  } finally { await hepInput.close(); }
  const pageOperations = await open(initial);
  try {
    const { session } = pageOperations;
    add(session, "text", "Page field", { value: "Initial" });
    add(session, "checkbox", "Page flag", { value: true, width: 18, height: 18 });
    add(session, "radio", "Page choice", { value: "Off", onValue: "A", width: 18, height: 18 });
    add(session, "radio", "Page choice", { value: "B", onValue: "B", width: 18, height: 18 });
    await session.rotatePages([0], 90);
    assert.equal(session.getObjects().filter(object => object.kind === "field").length, 4, "rotation retains authored field models");
    await session.duplicatePages([0], { at: 1 });
    const copied = session.getObjects().filter(object => object.kind === "field");
    assert.equal(copied.length, 8, "page duplication copies each widget exactly once");
    const texts = copied.filter(object => object.fieldType === "text");
    assert.equal(new Set(texts.map(object => object.name)).size, 2, "copied fields have independent names");
    const radio = copied.filter(object => object.fieldType === "radio");
    assert.equal(new Set(radio.map(object => object.name)).size, 2, "radio groups copy together into independent groups");
    const copy = texts.find(object => object.name !== "Page field");
    session.setFieldValue(copy.name, "Independent");
    assert.equal(session.getObject(texts.find(object => object.name === "Page field").id).value, "Initial");
    await session.reorderPages([1, 0]);
    assert.equal(session.getObjects().find(object => object.kind === "field" && object.name === "Page field").pageIndex, 1);
    assert(session.undo()); assert(session.redo());
    const scene = await session.getScene(), widgets = scene.annotations.filter(annotation => annotation.field);
    assert.equal(widgets.length, 10, "reseeded source widgets are replaced, rather than painted twice");
    const text = scene.textIndex.pages.map(page => page.text).join("\n");
    assert.equal(text.match(/Initial/g)?.length, 1, `source widget search text is replaced: ${JSON.stringify(scene.textIndex.pages.map(page => page.text))}`);
    assert.equal(text.match(/Independent/g)?.length, 1, "search text has no duplicate old appearances");
    const bytes = await save(session);
    await inspect(bytes, 10, async (document, _forms, annotations) => {
      assert.equal(document.pages.length, 2);
      const named = annotations.filter(annotation => annotation.widget?.fullyQualifiedName?.startsWith("Page "));
      assert.equal(new Set(named.map(annotation => annotation.widget.fullyQualifiedName)).size, 6, "copied radio pairs share roots without colliding with other copies");
    });
    const roundtrip = await open(bytes);
    try { assert.equal(roundtrip.session.sourceScene.annotations.filter(annotation => annotation.field).length, 10); await inspect(await save(roundtrip.session), 10); }
    finally { await roundtrip.close(); }
    const hep = await loadSceneFromHep(await (await session.saveHep({ withVectorLod: false, withTextLod: false, encodeRasterImages: false })).arrayBuffer());
    assert.equal(hep.annotations.filter(annotation => annotation.field).length, 10);
    assert(!Object.hasOwn(hep, "editor") && !Object.hasOwn(hep, "sourcePdf") && !Object.hasOwn(hep, "fonts"));
    assert(hep.annotations.filter(annotation => annotation.field).every(annotation => !Object.hasOwn(annotation.field, "inputType")), "HEP keeps compact rendering metadata instead of authoring hints");
    const transformed = await openEditorSession(hep);
    try {
      const runs = getSceneAnnotationRuns(hep).get(hep.annotations.find(annotation => annotation.field?.name === "Page field").id);
      assert(runs?.length); transformed.selectPrimitives([{ kind: runs[0].kind, index: runs[0].first }]);
      transformed.transformSelection([1, 0, 0, 1, 5, 0]); assert((await transformed.getScene()).segmentCount + hep.fillPathCount > 0);
    } finally { transformed.dispose(); }
  } finally { await pageOperations.close(); }
  console.log("Created PDF fields: typed controls, states/flags/options, radio groups, source resources, embedded fonts, transformed refill, flattened/source-free PDF, page rotation/duplication/reordering and compact HEP round trips passed.");
} finally { hooks.deregister(); }

function fixture() {
  return writeTinyPdf({ objects: [
    "<< /Type /Catalog /Pages 2 0 R /AcroForm 7 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << >> /Contents 4 0 R /Annots [5 0 R] >>",
    tinyPdfStream("", "0 0 1 rg 0 0 20 20 re f"),
    "<< /Type /Annot /Subtype /Widget /FT /Btn /T (Existing) /V /Off /AS /Off /F 4 /Rect [5 50 15 60] /AP << /N << /Off 6 0 R /Yes 6 0 R >> >> >>",
    tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Matrix [1 0 0 1 0 0] /Resources << >>", ""),
    "<< /Fields 8 0 R /DR << /Font << >> /XObject << /Retained 6 0 R >> >> >>",
    "[5 0 R]"
  ].map((body, index) => ({ number: index + 1, body })) });
}
