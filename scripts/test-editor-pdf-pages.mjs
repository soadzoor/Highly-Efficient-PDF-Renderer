import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? next(`${specifier}.ts`, context) : next(specifier, context);
} });
try {
  const { manipulatePdfPages } = await import("../src/editorPdfPages.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { NativePdfWriter } = await import("../src/pdf/nativeWriter.ts");
  const { NativePdfFormAppearanceRegistry, decodePdfString } = await import("../src/pdf/nativeForms.ts");
  const { createNativeOptionalContentRegistry } = await import("../src/pdf/nativeOptionalContent.ts");
  const { computeNativePdfPageGeometry } = await import("../src/pdf/nativePageGeometry.ts");
  const { multiplyEditorMatrices, invertEditorMatrix } = await import("../src/editorScene.ts");
  const { applyEditorPdfFields } = await import("../src/editorNativePdf.ts");
  const { createEditorFontRegistry } = await import("../src/editorFonts.ts");
  const open = (bytes, password) => NativePdfDocument.open({ kind: "bytes", bytes }, { password, repair: "off" });
  const run = async (bytes, request, options) => new Uint8Array(await (await manipulatePdfPages(bytes, request, options)).arrayBuffer());
  const original = fixture("main", true), foreign = fixture("foreign", false), before = original.slice(), diagnostics = [], progress = [];
  const rotated = await run(original, { kind: "rotate", pages: [0, 2], degrees: 90 }, { onDiagnostic: value => diagnostics.push(value), onProgress: value => progress.push(value) });
  const one = await open(rotated), source = await open(original);
  try {
    assert.equal(one.pages.length, 3); assert.deepEqual(one.pages.map(page => page.rotation), [180, 90, 180]);
    const stale = one.catalog.get("References"); assert.equal(await one.resolveValue(stale[1]), null); assert.equal((await one.resolveDictionary(stale[0])).get("Subtype").value, "TrueType");
    assert.deepEqual(one.pages[0].cropBox, [20, 30, 180, 130]); assert.deepEqual(one.pages[0].mediaBox, [0, 0, 200, 160]); assert.equal(one.pages[0].userUnit, 2);
    const refs = new NativePdfFormAppearanceRegistry(one), annotations = await refs.listPageAnnotations(0);
    const text = annotations.find(value => value.subtype === "FreeText"), stored = JSON.parse(decodePdfString(text.dictionary.get("HEPRText"), 0, 0));
    const delta = multiplyEditorMatrices(computeNativePdfPageGeometry(one.pages[0]).pageMatrix, invertEditorMatrix(computeNativePdfPageGeometry(source.pages[0]).pageMatrix));
    assert.deepEqual(stored.object.transform, multiplyEditorMatrices(delta, [1, 0, 0, 1, 10, 5]));
    assert.equal(Buffer.from((await one.getDecodedPageContents(0))[0]).toString(), Buffer.from((await source.getDecodedPageContents(0))[0]).toString(), "rotation retains exact source content bytes");
    const labels = await one.resolveDictionary(one.catalog.get("PageLabels")); assert.equal(labels.get("Nums")[2], 2, "rotation preserves the original page-label tree");
  } finally { await one.close(); await source.close(); }
  assert.equal(progress[0].value, 0); assert.equal(progress.at(-1).value, 1); assert.equal(progress.at(-1).stage, "complete");
  for (let index = 1; index < progress.length; index++) assert(progress[index].value >= progress[index - 1].value);
  for (const removedPages of [[0], [1], [2]]) {
    const removed = await run(original, { kind: "remove", pages: removedPages }), document = await open(removed);
    try {
      assert.equal(document.pages.length, 2); const registry = new NativePdfFormAppearanceRegistry(document), acro = await registry.getAcroFormMetadata();
      const names = [];
      for (let page = 0; page < 2; page++) for (const annotation of await registry.listPageAnnotations(page)) if (annotation.widget) names.push(annotation.widget.fullyQualifiedName);
      assert.equal(names.filter(name => name === "Name").length, removedPages[0] === 2 ? 2 : 1);
      assert.equal(names.includes("Unique"), removedPages[0] !== 2);
      assert.equal(acro.fields.length, removedPages[0] === 2 ? 2 : 3);
      const hidden = await document.resolveDictionary(acro.fields.find(field => field.objectNumber === 34));
      assert.equal(decodePdfString(hidden.get("V"), 0, 0), "private calculation input", "removing a page retains unattached non-widget fields");
      const labels = await document.resolveDictionary(document.catalog.get("PageLabels")); assert.equal(labels.get("Nums").length, 4);
      assert.equal((Buffer.from(removed).toString("latin1").match(/%%EOF/g) ?? []).length, 1, "removed-page revisions are not retained");
    } finally { await document.close(); }
  }
  const merged = await run(original, { kind: "insert", at: 1, bytes: foreign, pages: [1, 0] }, { onDiagnostic: value => diagnostics.push(value) });
  const mergedDocument = await open(merged);
  try {
    assert.equal(mergedDocument.pages.length, 5);
    assert.deepEqual(mergedDocument.pages.map(page => decodePdfString(page.dictionary.get("Marker"), 0, 0)), ["main-0", "foreign-1", "foreign-0", "main-1", "main-2"]);
    const registry = new NativePdfFormAppearanceRegistry(mergedDocument), names = [];
    for (let page = 0; page < 5; page++) for (const annotation of await registry.listPageAnnotations(page)) if (annotation.widget) names.push(annotation.widget.fullyQualifiedName);
    assert.equal(names.filter(name => name === "Name").length, 2); assert.equal(names.filter(name => name === "Imported1.Name").length, 2); assert.equal(names.filter(name => name === "Unique").length, 1);
    const layers = await createNativeOptionalContentRegistry(mergedDocument);
    assert.equal(layers.listGroups().length, 2); assert.deepEqual(layers.listGroups().map(group => group.defaultVisible), [true, false]);
    assert.notEqual(layers.listGroups()[0].identity, layers.listGroups()[1].identity);
    const layerProperties = await mergedDocument.resolveDictionary(mergedDocument.catalog.get("OCProperties")); assert.equal(layerProperties.get("Configs").length, 2, "alternate layer configurations retain separate imported identities");
    const imported = await registry.listPageAnnotations(2), link = imported.find(annotation => annotation.subtype === "Link");
    const destination = await mergedDocument.resolveValue(link.dictionary.get("Dest")); assert.equal(destination[0].objectNumber, mergedDocument.pages[1].ref.objectNumber, "selected-page link references are remapped");
    const resources = await mergedDocument.resolveDictionary(mergedDocument.pages[1].resources), fonts = await mergedDocument.resolveDictionary(resources.get("Font")), font = await mergedDocument.resolveDictionary(fonts.get("F"));
    const descriptor = await mergedDocument.resolveDictionary(font.get("FontDescriptor")), fontFile = await mergedDocument.resolveValue(descriptor.get("FontFile2"));
    assert.deepEqual(await mergedDocument.decodeStream(fontFile), buildTinySfnt(), "embedded imported font bytes are retained");
    assert(!mergedDocument.pages.some(page => decodePdfString(page.dictionary.get("Marker"), 0, 0) === "foreign-2"));
    const acro = await registry.getAcroFormMetadata(); assert.equal(acro.fields.length, 4);
    const labels = await mergedDocument.resolveDictionary(mergedDocument.catalog.get("PageLabels"));
    assert.deepEqual(labels.get("Nums").filter((_, index) => index % 2).map(label => label.get("St")), [1, 2, 1, 2, 10], "inserted page labels retain source numbering");
    const writer = new NativePdfWriter(mergedDocument), fontsRegistry = createEditorFontRegistry();
    try {
      await applyEditorPdfFields(writer, new Map([["Imported1.Name", "B"]]), fontsRegistry);
      const filled = await open(await writer.save()), fieldsRegistry = new NativePdfFormAppearanceRegistry(filled);
      try {
        assert.equal(decodePdfString((await fieldsRegistry.listPageAnnotations(1)).find(annotation => annotation.widget).widget.value, 0, 0), "B", "imported fields remain fillable through renamed default-resource fonts");
        assert.equal(decodePdfString((await fieldsRegistry.listPageAnnotations(0)).find(annotation => annotation.widget).widget.value, 0, 0), "A", "same-name primary fields stay independent");
      } finally { await filled.close(); }
    } finally { fontsRegistry.dispose(); }
  } finally { await mergedDocument.close(); }
  assert(diagnostics.some(value => value.code === "pages.fields-namespaced")); assert(diagnostics.some(value => value.code === "pages.navigation-detached"));
  const repeated = await run(merged, { kind: "insert", at: 5, bytes: foreign, pages: [2] }), repeatedDocument = await open(repeated);
  try {
    assert.equal(repeatedDocument.pages.length, 6);
    assert.equal((await new NativePdfFormAppearanceRegistry(repeatedDocument).listPageAnnotations(5)).find(annotation => annotation.widget).widget.fullyQualifiedName, "Imported2.Unique");
  }
  finally { await repeatedDocument.close(); }
  const protect = async (bytes, password) => { const document = await open(bytes); try { return await new NativePdfWriter(document).save(undefined, { protection: { mode: "password", password, ownerPassword: password + " owner" } }); } finally { await document.close(); } };
  const protectedMain = await protect(original, "main secret"), protectedForeign = await protect(foreign, "foreign secret");
  const protectedMerged = await run(protectedMain, { kind: "insert", at: 3, bytes: protectedForeign, pages: [0], password: "foreign secret" }, { password: "main secret" });
  for (const password of ["main secret", "main secret owner"]) { const document = await open(protectedMerged, password); try { assert.equal(document.pages.length, 4); assert.equal((await document.getDecodedPageContents(3)).length, 1); } finally { await document.close(); } }
  await assert.rejects(open(protectedMerged, "foreign secret"), error => error.code === "encrypted");
  const oldHeader = original.slice(); oldHeader.set(new TextEncoder().encode("%PDF-1.3"));
  const upgraded = await open(await run(oldHeader, { kind: "insert", at: 3, bytes: foreign, pages: [0] }));
  try { assert.equal(upgraded.catalog.get("Version").value, "1.7", "catalog declares imported optional-content/transparency capabilities"); }
  finally { await upgraded.close(); }
  for (const request of [{ kind: "remove", pages: [0, 1, 2] }, { kind: "remove", pages: [0, 0] }, { kind: "rotate", pages: [3], degrees: 90 }, { kind: "rotate", pages: [0], degrees: 45 }, { kind: "insert", at: 4, bytes: foreign }, { kind: "insert", at: 0, bytes: foreign, pages: [0, 0] }]) await assert.rejects(run(original, request), RangeError);
  await assert.rejects(run(original, { kind: "rotate", pages: [0], degrees: 90 }, { signal: AbortSignal.abort() }), { name: "AbortError" });
  assert.deepEqual(original, before, "native page operations do not mutate caller bytes");
  console.log("Native PDF pages: rotation geometry/text metadata, removal/shared fields, selected-page imports/fonts/forms/links/layers, encryption and cancellation passed.");
} finally { hooks.deregister(); }

function fixture(label, visible) {
  const payload = { version: 1, object: { kind: "text", id: "existing-text", pageIndex: 0, x: 90, y: 50, width: 40, height: 20, text: "AB", fontSize: 10, transform: [1, 0, 0, 1, 10, 5] } };
  const metadata = Buffer.from(JSON.stringify(payload), "utf16le").swap16().toString("hex");
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /AcroForm 15 0 R /OCProperties 27 0 R /Names 29 0 R /Outlines 32 0 R /PageLabels 16 0 R /References [8 0 R 8 1 R] >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 /MediaBox [0 0 200 160] /CropBox [20 30 180 130] /Rotate 90 /Resources 7 0 R >>" },
    ...[3, 4, 5].map((number, index) => ({ number, body: `<< /Type /Page /Parent 2 0 R /UserUnit 2 /Marker (${label}-${index}) /Contents ${[6, 10, 11][index]} 0 R /Annots [${["18 0 R 21 0 R 22 0 R", "19 0 R 23 0 R", "20 0 R"][index]}] >>` })),
    { number: 6, body: tinyPdfStream("", "1 0 0 rg 30 40 20 20 re f /OC /Layer BDC BT /F 10 Tf 40 80 Td (AB) Tj ET EMC") },
    { number: 10, body: tinyPdfStream("", "0 1 0 rg 30 40 20 20 re f") }, { number: 11, body: tinyPdfStream("", "0 0 1 rg 30 40 20 20 re f") },
    { number: 7, body: "<< /Font << /F 8 0 R >> /Properties << /Layer 26 0 R >> >>" },
    { number: 8, body: "<< /Type /Font /Subtype /TrueType /BaseFont /Tiny /FirstChar 65 /LastChar 66 /Widths [600 700] /Encoding /WinAnsiEncoding /FontDescriptor 9 0 R >>" },
    { number: 9, body: "<< /Type /FontDescriptor /FontName /Tiny /Flags 32 /FontBBox [0 -200 1000 800] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 12 0 R >>" },
    { number: 12, body: tinyPdfStream("", buildTinySfnt()) },
    { number: 13, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 40 20] /Resources << /Font << /F 8 0 R >> >>", "BT /F 10 Tf 2 5 Td (A) Tj ET") },
    { number: 14, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [90 50 130 70] /Resources << /Font << /F 8 0 R >> >>", "BT /F 10 Tf 90 55 Td (AB) Tj ET") },
    { number: 15, body: `<< /Fields [17 0 R 20 0 R ${label === "main" ? "34 0 R" : ""}] /DR << /Font << /F 8 0 R >> >> /DA (/F 10 Tf 0 g) /CO [17 0 R] >>` },
    { number: 16, body: `<< /Nums [0 << /S /r /P (${label}-) >> 2 << /S /D /St 10 >>] >>` },
    { number: 17, body: "<< /FT /Tx /T (Name) /V (A) /Kids [18 0 R 19 0 R] >>" },
    { number: 18, body: "<< /Type /Annot /Subtype /Widget /Parent 17 0 R /P 3 0 R /Rect [40 40 80 60] /AP << /N 13 0 R >> >>" },
    { number: 19, body: "<< /Type /Annot /Subtype /Widget /Parent 17 0 R /P 4 0 R /Rect [40 40 80 60] /AP << /N 13 0 R >> >>" },
    { number: 20, body: "<< /Type /Annot /Subtype /Widget /FT /Tx /T (Unique) /V (B) /P 5 0 R /Rect [40 40 80 60] /AP << /N 13 0 R >> >>" },
    { number: 21, body: `<< /Type /Annot /Subtype /FreeText /Rect [90 50 130 70] /P 3 0 R /AP << /N 14 0 R >> /HEPRText <feff${metadata}> >>` },
    { number: 22, body: "<< /Type /Annot /Subtype /Link /Rect [40 90 80 100] /P 3 0 R /Dest [4 0 R /Fit] >>" },
    { number: 23, body: "<< /Type /Annot /Subtype /Link /Rect [40 90 80 100] /P 4 0 R /A << /S /GoTo /D (target) >> >>" },
    { number: 26, body: "<< /Type /OCG /Name (Layer) /HEPRLayerId (ref:26:0) >>" },
    { number: 27, body: `<< /OCGs [26 0 R] /D << /BaseState /ON /${visible ? "ON" : "OFF"} [26 0 R] /Order [26 0 R] /Locked [26 0 R] /RBGroups [[26 0 R]] >> /Configs [<< /Name (${label} configuration) /BaseState /OFF /OFF [26 0 R] >>] >>` },
    { number: 29, body: "<< /Dests 30 0 R >>" }, { number: 30, body: "<< /Names [(target) [5 0 R /Fit]] >>" },
    { number: 32, body: "<< /Type /Outlines /First 33 0 R /Last 33 0 R /Count 1 >>" }, { number: 33, body: "<< /Title (Last page) /Parent 32 0 R /Dest [5 0 R /Fit] >>" },
    { number: 34, body: "<< /FT /Tx /T (Hidden) /V (private calculation input) >>" }
  ] });
}
