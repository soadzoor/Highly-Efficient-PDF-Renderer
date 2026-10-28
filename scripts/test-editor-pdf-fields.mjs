import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";
import { createCanvas } from "@napi-rs/canvas";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });
try {
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { NativePdfWriter } = await import("../src/pdf/nativeWriter.ts");
  const { NativePdfFormAppearanceRegistry, decodePdfString } = await import("../src/pdf/nativeForms.ts");
  const { applyEditorPdfFields, removeEditorPdfWidget } = await import("../src/editorNativePdf.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { createEditorFontRegistry } = await import("../src/editorFonts.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const bytes = formFixture(), original = bytes.slice(), warnings = [];
  const fonts = createEditorFontRegistry({ loadAsset: async url => new Uint8Array(await readFile(url)) });
  const document = await NativePdfDocument.open({ kind: "bytes", bytes });
  let saved;
  try {
    const writer = new NativePdfWriter(document);
    await applyEditorPdfFields(writer, new Map([["Text", "B"], ["Choice", "B"], ["Check", true],
      ["Radio", "B"], ["Shared", "B"], ["Direct", true], ["NoAppearance", true], ["NoRadio", "Choice1_14"]]), fonts,
      { onWarning: warning => warnings.push(warning) });
    saved = await writer.save();
    assert.deepEqual(bytes, original, "field filling does not change caller source bytes");
    const annotations = await new NativePdfFormAppearanceRegistry(document).listPageAnnotations(0);
    assert.equal(annotations.find(annotation => annotation.widget.fullyQualifiedName === "Direct").dictionary.get("AS").value, "Off",
      "direct widget parser dictionaries stay immutable");
  } finally { await document.close(); }
  assert.deepEqual(warnings, [], "ordinary source font appearances need no approximation");
  const reopened = await NativePdfDocument.open({ kind: "bytes", bytes: saved }, { repair: "off" });
  try {
    const registry = new NativePdfFormAppearanceRegistry(reopened), annotations = await registry.listPageAnnotations(0);
    const named = name => annotations.filter(annotation => annotation.widget.fullyQualifiedName === name);
    const textValue = annotation => decodePdfString(annotation.widget.value, 0, annotation.annotationIndex);
    assert.equal(textValue(named("Text")[0]), "B");
    assert.equal(textValue(named("Choice")[0]), "B");
    assert.deepEqual(named("Choice")[0].widget.selectedChoiceIndices, [1]);
    assert(named("Shared").every(annotation => textValue(annotation) === "B"), "all widgets sharing a field receive its value");
    assert(named("Shared").every(annotation => annotation.dictionary.get("AP")), "all shared widgets have explicit appearances");
    assert.equal(named("Check")[0].dictionary.get("AS").value, "Yes");
    assert.deepEqual(named("Radio").map(annotation => annotation.dictionary.get("AS").value), ["Off", "B"]);
    assert(named("Radio").every(annotation => annotation.widget.value.value === "B"));
    assert.equal(named("Direct")[0].dictionary.get("AS").value, "Yes");
    assert.equal(named("Direct")[0].widget.value.value, "Yes");
    assert.equal(named("NoAppearance")[0].dictionary.get("AS").value, "Yes");
    assert.deepEqual(named("NoRadio").map(annotation => annotation.dictionary.get("AS").value), ["Off", "Choice1_14"]);
    for (const annotation of [...named("NoAppearance"), ...named("NoRadio")]) {
      const appearance = await registry.resolveAnnotationAppearance(annotation);
      assert(appearance, "missing button appearances are generated explicitly");
      const ap = await reopened.resolveValue(annotation.dictionary.get("AP")), normal = await reopened.resolveValue(ap.get("N"));
      assert(normal.has("Off")); assert(normal.size >= 2, "buttons keep both Off and on appearances for other PDF readers");
    }
    const acro = await registry.getAcroFormMetadata(); assert.equal(acro.needAppearances, false);
    for (const name of ["Text", "Choice", "Shared"]) for (const annotation of named(name)) {
      const appearance = await registry.resolveAnnotationAppearance(annotation);
      assert(appearance, `${name} has a valid stored appearance`);
      assert.match(new TextDecoder().decode(await registry.decodeFormContent(appearance.normalAppearance.form)), /<42> Tj/,
        `${name} appearance paints the filled B value`);
    }
  } finally { await reopened.close(); }
  for (const [name, value, pattern] of [["ReadOnly", "B", /read-only/], ["Text", "AAA", /at most 2/],
    ["Choice", "Missing", /does not contain/], ["Missing", "A", /Unknown form field/],
    ["Digital", "Invalid", /not a fillable/], ["Push", true, /not a fillable/], ["NoRadio", "Invalid", /button choice/]]) {
    const document = await NativePdfDocument.open({ kind: "bytes", bytes });
    try { await assert.rejects(applyEditorPdfFields(new NativePdfWriter(document), new Map([[name, value]]), fonts), pattern); }
    finally { await document.close(); }
  }
  async function removeWidgets(numbers, values = new Map(), fixtureOptions = {}) {
    const document = await NativePdfDocument.open({ kind: "bytes", bytes: formFixture(fixtureOptions) });
    let saved;
    try {
      const writer = new NativePdfWriter(document);
      await applyEditorPdfFields(writer, values, fonts);
      const page = document.getPage(0), dictionary = new Map(writer.get(page.ref) ?? page.dictionary);
      const annotations = await document.resolveValue(dictionary.get("Annots"));
      dictionary.set("Annots", annotations.filter(item => item.kind !== "ref" || !numbers.includes(item.objectNumber)));
      writer.set(page.ref, dictionary);
      for (const number of numbers) await removeEditorPdfWidget(writer, { kind: "ref", objectNumber: number, generation: 0 });
      saved = await writer.save();
    } finally { await document.close(); }
    return NativePdfDocument.open({ kind: "bytes", bytes: saved }, { repair: "off" });
  }
  for (const fixtureOptions of [{}, { directAcro: true }, { indirectArrays: true }]) {
    const shared = await removeWidgets([19], new Map([["Shared", "B"]]), fixtureOptions);
    try {
      const parent = await shared.resolveObject({ kind: "ref", objectNumber: 18, generation: 0 });
      assert.deepEqual((await shared.resolveValue(parent.get("Kids"))).map(ref => ref.objectNumber), [20]);
      assert.equal(decodePdfString(parent.get("V"), 0, 0), "B", "deleting one widget keeps shared field values");
    } finally { await shared.close(); }
    const empty = await removeWidgets([19, 20, 11, 31], new Map(), fixtureOptions);
    try {
      const acro = await empty.resolveDictionary(empty.catalog.get("AcroForm"));
      const fields = await empty.resolveValue(acro.get("Fields")), order = await empty.resolveValue(acro.get("CO"));
      for (const removed of [18, 11, 29, 30]) {
        assert(!fields.some(ref => ref.objectNumber === removed), `empty widget ancestor ${removed} is removed from Fields: ${JSON.stringify(fixtureOptions)}`);
        assert(!order.some(ref => ref.objectNumber === removed), "calculation order loses deleted field references");
      }
    } finally { await empty.close(); }
    const selected = await removeWidgets([17], new Map([["Radio", "B"]]), fixtureOptions);
    try {
      const parent = await selected.resolveObject({ kind: "ref", objectNumber: 15, generation: 0 });
      assert.equal(parent.get("V").value, "Off", "deleting the selected radio clears its field value");
      const sibling = await selected.resolveObject({ kind: "ref", objectNumber: 16, generation: 0 });
      assert.equal(sibling.get("AS").value, "Off");
    } finally { await selected.close(); }
    const inactive = await removeWidgets([16], new Map([["Radio", "B"]]), fixtureOptions);
    try {
      const parent = await inactive.resolveObject({ kind: "ref", objectNumber: 15, generation: 0 });
      assert.equal(parent.get("V").value, "B", "deleting an inactive radio keeps the selected sibling");
    } finally { await inactive.close(); }
  }
  const decoratedBytes = formFixture({ decoratedText: true }), decoratedDocument = await NativePdfDocument.open({ kind: "bytes", bytes: decoratedBytes });
  let decoratedSaved;
  try {
    const writer = new NativePdfWriter(decoratedDocument);
    await applyEditorPdfFields(writer, new Map([["Text", "B"]]), fonts);
    decoratedSaved = await writer.save();
  } finally { await decoratedDocument.close(); }
  async function renderField(bytes) {
    const parser = await openPdf({ kind: "bytes", bytes });
    try {
      const page = await parser.compilePage(0, { optimization: "none" });
      const result = await renderHeprPageToCanvas2d(page, { scale: 4, surfaceFactory(width, height) {
        const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext("2d") };
      } });
      return { page, pixel(x, y) { return Array.from(result.surface.context.getImageData(Math.floor(x * 4), result.height - 1 - Math.floor(y * 4), 1, 1).data); } };
    } finally { await parser.close(); }
  }
  const decoratedBefore = await renderField(decoratedBytes), decoratedAfter = await renderField(decoratedSaved);
  assert.deepEqual(decoratedAfter.pixel(12, 72), decoratedBefore.pixel(12, 72), "custom AP background survives without /MK metadata");
  assert.deepEqual(decoratedAfter.pixel(10.25, 75), decoratedBefore.pixel(10.25, 75), "custom AP border survives without a duplicate generated border");
  assert.deepEqual(decoratedAfter.pixel(45, 77), decoratedBefore.pixel(45, 77), "all non-text decoration remains in the stored appearance");
  assert.equal(decoratedAfter.page.textIndex.text.replaceAll(" ", ""), "B", "the old field text is removed while its replacement remains searchable");
  const filledAgain = await NativePdfDocument.open({ kind: "bytes", bytes: decoratedSaved });
  let decoratedTwice;
  try {
    const writer = new NativePdfWriter(filledAgain); await applyEditorPdfFields(writer, new Map([["Text", "A"]]), fonts);
    decoratedTwice = await writer.save();
  } finally { await filledAgain.close(); }
  const decoratedReopened = await renderField(decoratedTwice);
  assert.equal(decoratedReopened.page.textIndex.text.replaceAll(" ", ""), "A", "nested appearance wrappers do not retain the previously filled text");
  assert.deepEqual(decoratedReopened.pixel(12, 72), decoratedBefore.pixel(12, 72), "decoration survives repeated save/reopen/fill");

  // Fill and add another annotation on the same page: the preservation saver
  // must retain the already rewritten direct-widget /Annots array.
  const services = await createEditorAppServices({ sourcePdf: bytes,
    loadFontAsset: async url => new Uint8Array(await readFile(url)) });
  const parser = await openPdf({ kind: "bytes", bytes });
  let session;
  try {
    const scene = await parser.compileVectorPage(0, { optimization: "none" });
    session = await openEditorSession(scene, services.sessionOptions);
    session.setFieldValue("Text", "B"); session.setFieldValue("Direct", true);
    session.addObject({ kind: "shape", shape: "rectangle", pageIndex: 0, x: 70, y: 80, width: 20, height: 10,
      color: 0xff0000, fill: 0xff0000, strokeWidth: 1 });
    const blob = await session.savePdf();
    const final = await NativePdfDocument.open({ kind: "bytes", bytes: new Uint8Array(await blob.arrayBuffer()) }, { repair: "off" });
    try {
      const annotations = await new NativePdfFormAppearanceRegistry(final).listPageAnnotations(0);
      assert.equal(annotations.find(annotation => annotation.widget?.fullyQualifiedName === "Direct").dictionary.get("AS").value, "Yes");
      assert(annotations.some(annotation => annotation.subtype === "Square"), "new shapes save alongside filled forms");
    } finally { await final.close(); }
  } finally { session?.dispose(); services.dispose(); await parser.close(); }
  // Browser font delivery lets appearance synthesis retain an original Type1
  // DA font. The editor must supply the same resolver when recompiling it.
  const { createBundledStandardFontResolver } = await import("../src/standardFontResolver.ts");
  const { writeScenePdf } = await import("../src/editorPdfWriter.ts");
  const type1Bytes = formFixture({ standardType1: true }), type1Original = type1Bytes.slice(), customAssetLoads = [], type1Diagnostics = [];
  const loadFontAsset = async input => { const url = new URL(input); url.search = ""; customAssetLoads.push(url.pathname); return new Uint8Array(await readFile(url)); };
  const missingFontResolver = createBundledStandardFontResolver({ loadAsset: asset => loadFontAsset(asset.url) });
  const originalFetch = globalThis.fetch; let browserAssetReads = 0, type1Services, type1Session, type1Parser;
  globalThis.fetch = async (input, options) => {
    const url = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url);
    if (url.protocol === "file:" && url.pathname.includes("/assets/standard-fonts/")) {
      options?.signal?.throwIfAborted(); url.search = ""; browserAssetReads++;
      return new Response(new Uint8Array(await readFile(url)), { status: 200 });
    }
    return originalFetch(input, options);
  };
  try {
    type1Parser = await openPdf({ kind: "bytes", bytes: type1Bytes }, { missingFontResolver });
    const initial = await type1Parser.compileVectorPage(0, { optimization: "none" });
    assert(initial.textIndex.pages[0].text.includes("Original Helvetica"));
    type1Services = await createEditorAppServices({ sourcePdf: type1Bytes, loadFontAsset, onDiagnostic: diagnostic => type1Diagnostics.push(diagnostic) });
    type1Session = await openEditorSession(initial, type1Services.sessionOptions);
    type1Session.setFieldValue("Text", "B");
    const modified = await type1Session.getScene();
    assert(browserAssetReads > 0, "browser-style standard font delivery exercises source Type1 AP synthesis instead of its embedded fallback");
    assert(customAssetLoads.some(path => path.endsWith("LiberationSans-Regular.ttf")) && customAssetLoads.some(path => path.endsWith("LiberationSerif-Regular.ttf")),
      "the custom asset loader supplies both original body and regenerated field substitutes");
    for (const baseFont of ["Helvetica", "Times-Roman"]) assert(type1Diagnostics.some(diagnostic => diagnostic.code === "font.missing-substituted" && diagnostic.details?.baseFont === baseFont),
      `${baseFont} substitution diagnostics remain visible during edited appearance compilation`);
    const assertType1Geometry = scene => {
      const text = scene.textIndex.pages[0].text;
      assert(text.includes("Original Helvetica"), "original body text stays searchable"); assert(text.includes("B"), "updated field text stays searchable");
      assert(scene.textInstanceCount > 1 || scene.fillPathCount > 1, "body and field text retain vector glyph instances or Type3 outline paths"); assert.equal(scene.rasterLayers.length, 0);
    };
    assertType1Geometry(modified);
    const editable = new Uint8Array(await (await type1Session.savePdf()).arrayBuffer());
    assert.deepEqual(type1Bytes, type1Original, "Type1 field editing retains caller-owned source bytes");
    const beforeType1 = await NativePdfDocument.open({ kind: "bytes", bytes: type1Bytes });
    const afterType1 = await NativePdfDocument.open({ kind: "bytes", bytes: editable }, { repair: "off" });
    try {
      const ref = number => ({ kind: "ref", objectNumber: number, generation: 0 });
      assert.deepEqual(await afterType1.decodeStream(await afterType1.resolveObject(ref(4))), await beforeType1.decodeStream(await beforeType1.resolveObject(ref(4))),
        "editing a field leaves original Type1 page-body operators unchanged");
      for (const number of [33, 34]) assert.deepEqual(await afterType1.resolveObject(ref(number)), await beforeType1.resolveObject(ref(number)),
        "preservation saves retain original nonembedded Type1 font dictionaries");
      const registry = new NativePdfFormAppearanceRegistry(afterType1), annotations = await registry.listPageAnnotations(0);
      const field = annotations.find(annotation => annotation.widget.fullyQualifiedName === "Text");
      assert.equal(decodePdfString(field.widget.value, 0, field.annotationIndex), "B");
      const appearance = await registry.resolveAnnotationAppearance(field); assert(appearance);
      const appearanceFonts = [], appearanceContents = [new TextDecoder().decode(await registry.decodeFormContent(appearance.normalAppearance.form))], visited = new Set();
      async function inspectResources(resources) {
        if (!resources || visited.has(resources)) return; visited.add(resources);
        const fonts = await afterType1.resolveValue(resources.get("Font"));
        if (fonts instanceof Map) for (const value of fonts.values()) appearanceFonts.push(await afterType1.resolveDictionary(value));
        const xobjects = await afterType1.resolveValue(resources.get("XObject"));
        if (xobjects instanceof Map) for (const value of xobjects.values()) {
          const stream = await afterType1.resolveValue(value);
          if (stream?.kind !== "stream" || stream.dictionary.get("Subtype")?.value !== "Form") continue;
          appearanceContents.push(new TextDecoder().decode(await afterType1.decodeStream(stream)));
          await inspectResources(await afterType1.resolveValue(stream.dictionary.get("Resources")));
        }
      }
      await inspectResources(appearance.normalAppearance.form.resources);
      assert(appearanceFonts.some(font => font.get("Subtype")?.value === "Type1" && font.get("BaseFont")?.value === "Times-Roman"),
        "the updated AP keeps the original nonembedded Times-Roman resource");
      assert.match(appearanceContents.join("\n"), /<42>\s*Tj|\(B\)\s*Tj/, "the retained Type1 AP explicitly paints the updated value");
    } finally { await beforeType1.close(); await afterType1.close(); }
    for (const output of [editable, new Uint8Array(await (await type1Session.savePdf({ flatten: true })).arrayBuffer()),
      new Uint8Array(await (await writeScenePdf(modified)).arrayBuffer())]) {
      const reopened = await openPdf({ kind: "bytes", bytes: output }, { missingFontResolver });
      try { assertType1Geometry(await reopened.compileVectorPage(0, { optimization: "none" })); }
      finally { await reopened.close(); }
    }
  } finally { globalThis.fetch = originalFetch; type1Session?.dispose(); type1Services?.dispose(); await type1Parser?.close(); }
  console.log("PDF fields: values, choices, radios, shared/direct widgets, appearances, validation and integrated save/reopen passed.");
} finally { hooks.deregister(); }

function formFixture({ directAcro = false, indirectArrays = false, decoratedText = false, standardType1 = false } = {}) {
  const ap = "/AP << /N 8 0 R >>", button = "/AP << /N << /Off 8 0 R /Yes 9 0 R >> >>";
  const direct = `<< /Type /Annot /Subtype /Widget /FT /Btn /T (Direct) /V /Off /AS /Off /Rect [75 10 95 30] ${button} >>`;
  const fields = "[11 0 R 12 0 R 13 0 R 14 0 R 15 0 R 18 0 R 22 0 R 23 0 R 24 0 R 25 0 R 29 0 R]";
  const order = "[11 0 R 15 0 R 18 0 R 25 0 R 29 0 R 30 0 R]";
  const acro = `<< /Fields ${indirectArrays ? "21 0 R" : fields} /CO ${indirectArrays ? "28 0 R" : order} /NeedAppearances true /DR << /Font << /F 5 0 R ${standardType1 ? "/TiRo 33 0 R" : ""} >> >> /DA (/F 10 Tf 0 g) >>`;
  return writeTinyPdf({ objects: [
    { number: 1, body: `<< /Type /Catalog /Pages 2 0 R /AcroForm ${directAcro ? acro : "10 0 R"} >>` },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << /Font << /F 5 0 R ${standardType1 ? "/Body 34 0 R" : ""} >> >> /Annots [11 0 R 12 0 R 13 0 R 14 0 R 16 0 R 17 0 R 19 0 R 20 0 R ${direct} 22 0 R 23 0 R 24 0 R 26 0 R 27 0 R 31 0 R] >>` },
    { number: 4, body: tinyPdfStream("", `1 1 1 rg 0 0 100 100 re f${standardType1 ? " BT /Body 6 Tf 0 g 1 0 0 1 5 94 Tm (Original Helvetica) Tj ET" : ""}`) },
    { number: 5, body: "<< /Type /Font /Subtype /TrueType /BaseFont /Tiny /FirstChar 65 /LastChar 66 /Widths [600 700] /Encoding /WinAnsiEncoding /FontDescriptor 6 0 R >>" },
    { number: 6, body: "<< /Type /FontDescriptor /FontName /Tiny /Flags 32 /FontBBox [0 -200 1000 800] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 7 0 R >>" },
    { number: 7, body: tinyPdfStream("", buildTinySfnt()) },
    { number: 8, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 20 20] /Resources << >>", "") },
    { number: 9, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 20 20] /Resources << >>", "0 0 0 rg 3 3 14 14 re f") },
    { number: 10, body: acro },
    { number: 11, body: `<< /Type /Annot /Subtype /Widget /FT /Tx /T (Text) /V (A) /MaxLen 2 /Rect [10 70 50 90] ${standardType1 ? "/DA (/TiRo 10 Tf 0 g)" : ""} ${decoratedText ? "/AP << /N 32 0 R >>" : ap} >>` },
    { number: 12, body: `<< /Type /Annot /Subtype /Widget /FT /Tx /T (ReadOnly) /Ff 1 /V (A) /Rect [55 70 95 90] ${ap} >>` },
    { number: 13, body: `<< /Type /Annot /Subtype /Widget /FT /Ch /T (Choice) /Opt [[(A) (A)] [(B) (B)]] /V (A) /I [0] /Rect [10 40 50 60] ${ap} >>` },
    { number: 14, body: `<< /Type /Annot /Subtype /Widget /FT /Btn /T (Check) /V /Off /AS /Off /Rect [55 40 75 60] ${button} >>` },
    { number: 15, body: "<< /FT /Btn /T (Radio) /Ff 32768 /V /A /Kids [16 0 R 17 0 R] >>" },
    { number: 16, body: "<< /Type /Annot /Subtype /Widget /Parent 15 0 R /AS /A /Rect [10 10 30 30] /AP << /N << /Off 8 0 R /A 9 0 R >> >> >>" },
    { number: 17, body: "<< /Type /Annot /Subtype /Widget /Parent 15 0 R /AS /Off /Rect [35 10 55 30] /AP << /N << /Off 8 0 R /B 9 0 R >> >> >>" },
    { number: 18, body: "<< /FT /Tx /T (Shared) /V (A) /DA (/F 5 Tf 0 g) /Kids [19 0 R 20 0 R] >>" },
    { number: 19, body: `<< /Type /Annot /Subtype /Widget /Parent 18 0 R /Rect [10 32 35 39] ${ap} >>` },
    { number: 20, body: `<< /Type /Annot /Subtype /Widget /Parent 18 0 R /Rect [45 32 70 39] ${ap} >>` },
    { number: 21, body: fields },
    { number: 22, body: "<< /Type /Annot /Subtype /Widget /FT /Btn /T (NoAppearance) /V /Off /AS /Off /Rect [80 40 95 55] >>" },
    { number: 23, body: `<< /Type /Annot /Subtype /Widget /FT /Sig /T (Digital) /V << /Contents <00> >> /Rect [80 60 95 65] ${ap} >>` },
    { number: 24, body: `<< /Type /Annot /Subtype /Widget /FT /Btn /Ff 65536 /T (Push) /Rect [80 65 95 70] ${ap} >>` },
    { number: 25, body: "<< /FT /Btn /Ff 32768 /T (NoRadio) /V /Off /Kids [26 0 R 27 0 R] >>" },
    { number: 26, body: "<< /Type /Annot /Subtype /Widget /Parent 25 0 R /AS /Off /Rect [5 3 15 13] >>" },
    { number: 27, body: "<< /Type /Annot /Subtype /Widget /Parent 25 0 R /AS /Off /Rect [20 3 30 13] >>" },
    { number: 28, body: order },
    { number: 29, body: "<< /T (Container) /Kids [30 0 R] >>" },
    { number: 30, body: "<< /FT /Tx /T (Leaf) /V (A) /Parent 29 0 R /Kids [31 0 R] >>" },
    { number: 31, body: `<< /Type /Annot /Subtype /Widget /Parent 30 0 R /Rect [35 3 45 13] ${ap} >>` },
    { number: 32, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 40 20] /Resources << /Font << /F 5 0 R >> >>",
      ".75 .875 1 rg 0 0 40 20 re f 0 0 1 RG .5 w .25 .25 39.5 19.5 re S /Tx << /ActualText (A) >> BDC BT /F 10 Tf 1 0 0 1 3 7 Tm (A) Tj ET EMC") },
    ...(standardType1 ? [{ number: 33, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>" },
      { number: 34, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>" }] : [])
  ] });
}
