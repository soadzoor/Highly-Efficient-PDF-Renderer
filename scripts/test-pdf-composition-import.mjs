import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { deflateSync } from "node:zlib";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { NativePdfWriter, pdfNameValue, pdfReference, pdfStreamValue } = await import("../src/pdf/nativeWriter.ts");
  const { prepareCompositionSourcePage, collectCompositionSourceLinks } = await import("../src/pdfCompositionImport.ts");
  const { createNativeOptionalContentRegistry } = await import("../src/pdf/nativeOptionalContent.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const decoder = new TextDecoder();
  const seed = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 0 /Kids [] >>" }
  ] });
  const fixture = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [6 0 R] >> /OCProperties << /OCGs [12 0 R] /D << /OFF [12 0 R] /Order [12 0 R] >> >> >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] /Resources << /XObject << /Shared 11 0 R >> >> >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [-10 -20 110 100] /CropBox [0 0 100 90] /TrimBox [1 2 95 85] /Rotate 90 /UserUnit 2 /Group << /S /Transparency /CS /DeviceRGB /I true >> /Contents 4 0 R /Annots [6 0 R 7 0 R 8 0 R 9 0 R 10 0 R 13 0 R 14 0 R 15 0 R 16 0 R 17 0 R] >>" },
    { number: 4, body: tinyPdfStream("", "1 0 0 rg 0 0 100 90 re f /Shared Do") },
    { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Matrix [2 0 0 2 0 0]", "0 1 0 rg 0 0 10 10 re f /Shared Do") },
    { number: 6, body: "<< /Type /Annot /Subtype /Widget /FT /Btn /T (Toggle) /V /Yes /AS /Yes /Rect [10 10 30 30] /AP << /N << /Yes 5 0 R >> >> >>" },
    { number: 7, body: "<< /Type /Annot /Subtype /Square /Rect [40 10 60 30] /C [0 0 1] /IC [0 0 1] >>" },
    { number: 8, body: "<< /Type /Annot /Subtype /Square /Rect [70 10 90 30] /F 2 /AP << /N 5 0 R >> >>" },
    { number: 9, body: "<< /Type /Annot /Subtype /Square /Rect [10 40 30 60] /OC 12 0 R /AP << /N 5 0 R >> >>" },
    { number: 10, body: "<< /Type /Annot /Subtype /Square /Rect [40 40 60 60] /AP << /N 99 >> >>" },
    { number: 11, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 1 1] /Resources << >>", "") },
    { number: 12, body: "<< /Type /OCG /Name (Hidden background) >>" },
    { number: 13, body: "<< /Type /Annot /Subtype /Link /Rect [5 10 15 20] /QuadPoints [5 20 15 20 5 10 15 10] /Border [0 0 0] /A << /S /URI /URI (https://example.com/source) /Next << /S /JavaScript /JS (bad) >> >> >>" },
    { number: 14, body: "<< /Type /Annot /Subtype /Link /Rect [20 10 30 20] /Border [0 0 0] /Dest [3 0 R /XYZ 12 34 1] >>" },
    { number: 15, body: "<< /Type /Annot /Subtype /Link /Rect [35 10 45 20] /Border [0 0 0] /A << /S /JavaScript /JS (bad) >> >>" },
    { number: 16, body: "<< /Type /Annot /Subtype /Link /Rect [50 10 60 20] /F 2 /Border [0 0 0] /A << /S /URI /URI (https://example.com/hidden) >> >>" },
    { number: 17, body: "<< /Type /Annot /Subtype /Widget /FT /Sig /T (Signature) /Rect [70 40 90 60] /AP << /N 99 >> >>" }
  ] });
  const source = await NativePdfDocument.open({ kind: "bytes", bytes: fixture });
  const destination = await NativePdfDocument.open({ kind: "bytes", bytes: seed });
  try {
    const writer = new NativePdfWriter(destination), refs = new Map(), diagnostics = [];
    const links = await collectCompositionSourceLinks(source, 0, { onDiagnostic: value => diagnostics.push(value) });
    assert.equal(links.length, 2, "safe visible URL and local links survive while active actions/hidden links do not");
    assert.deepEqual(links[0].rect, { x: 20, y: 170, width: 20, height: 20 });
    assert.deepEqual(links[0].quadPoints, [40, 190, 40, 170, 20, 190, 20, 170]);
    assert.deepEqual(links[0].target, { type: "url", url: "https://example.com/source" });
    assert.deepEqual(links[1].target, { type: "page", pageIndex: 0, fit: "XYZ", parameters: [12, 34, 1], x: 68, y: 176 });
    assert(diagnostics.some(item => item.code === "composition.source-link-omitted"));
    const prepared = await prepareCompositionSourcePage(source, 0, writer, refs, { onDiagnostic: value => diagnostics.push(value) });
    assert.deepEqual(prepared.dictionary.get("MediaBox"), [-10, -20, 110, 100]);
    assert.deepEqual(prepared.dictionary.get("CropBox"), [0, 0, 100, 90]);
    assert.deepEqual(prepared.dictionary.get("TrimBox"), [1, 2, 95, 85]);
    assert.equal(prepared.dictionary.get("Rotate"), 90); assert.equal(prepared.dictionary.get("UserUnit"), 2);
    assert(prepared.dictionary.get("Group") instanceof Map); assert(!prepared.dictionary.has("Annots"));
    const content = decoder.decode(prepared.content);
    assert(content.indexOf("1 0 0 rg") < content.indexOf("HEPRBackgroundAnnotation"), "source paint precedes flattened annotation paint");
    assert.equal((content.match(/BackgroundAnnotation\d+ Do/g) ?? []).length, 3, "visible widget, synthesized square, and repaired malformed square are painted");
    assert(diagnostics.some(item => item.code === "annotation.appearance-synthesized"));
    assert(diagnostics.some(item => item.code === "composition.annotation-approximated"));
    assert(content.includes("70 40 20 20 re S"), "an unsynthesizable appearance retains a bounded visible placeholder");
    const importedObjects = prepared.resources.get("XObject"), shared = importedObjects.get("Shared");
    const widget = writer.get(importedObjects.get("HEPRBackgroundAnnotation1"));
    assert.deepEqual(widget.dictionary.get("Resources").get("XObject").get("Shared"), shared, "inherited appearance resources share imported identity");
    const again = await prepareCompositionSourcePage(source, 0, writer, refs);
    assert.deepEqual(again.resources.get("XObject").get("Shared"), shared, "repeated source pages share resources");
    const page = writer.add(new Map([...prepared.dictionary, ["Parent", pdfReference(2)],
      ["Contents", writer.add(pdfStreamValue(content + "q 0 0 0 rg 10 10 20 20 re f Q"))]]));
    writer.set(pdfReference(2), new Map([["Type", pdfNameValue("Pages")], ["Count", 1], ["Kids", [page]]]));
    const bytes = await writer.save(undefined, { rewrite: true });
    const reopened = await NativePdfDocument.open({ kind: "bytes", bytes });
    try {
      assert(!reopened.catalog.has("AcroForm")); assert.equal(reopened.getPage(0).annotations, undefined);
      const oc = await createNativeOptionalContentRegistry(reopened);
      assert.equal(oc.listGroups().length, 1); assert.equal(oc.listGroups()[0].defaultVisible, false);
    } finally { await reopened.close(); }
    const parser = await openPdf({ kind: "bytes", bytes });
    try {
      const scene = await parser.compileVectorPage(0, { optimization: "none", preserveDrawingOrder: true });
      assert(scene.fillPathCount >= 4, "original content, widget, square, and top overlay remain vector paint");
      assert.equal(scene.rasterLayers.length, 0); assert.equal(scene.annotations.length, 0);
      const last = scene.drawRuns.at(-1); assert.equal(last.kind, "fill");
      const offset = last.first * 4; assert.deepEqual(Array.from(scene.fillPathMetaB.subarray(offset + 2, offset + 4)), [0, 0], "last overlay remains black above source widget");
    } finally { await parser.close(); }
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(prepareCompositionSourcePage(source, 0, writer, refs, { signal: aborted.signal }), { name: "AbortError" });
  } finally { await source.close(); await destination.close(); }
  const fontBytes = Uint8Array.of(0, 1, 0, 0, 17, 23, 41, 59), fontFixture = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 4 0 R /F2 11 0 R >> >> >>" },
    { number: 4, body: "<< /Type /Font /Subtype /TrueType /BaseFont /Fixture /FirstChar 32 /LastChar 32 /Widths [500] /FontDescriptor 5 0 R >>" },
    { number: 5, body: "<< /Type /FontDescriptor /FontName /Fixture /Flags 32 /FontBBox [0 0 1000 1000] /Ascent 800 /Descent -200 /CapHeight 800 /ItalicAngle 0 /StemV 80 /FontFile2 6 0 R >>" },
    { number: 6, body: tinyPdfStream("/Length1 7 0 R /Filter 8 0 R /DecodeParms 9 0 R", new Uint8Array(deflateSync(fontBytes))) },
    { number: 7, body: String(fontBytes.length) },
    { number: 8, body: "[/FlateDecode]" },
    { number: 9, body: "[<< /Predictor 10 0 R >>]" },
    { number: 10, body: "1" },
    { number: 11, body: "<< /Type /Font /Subtype /TrueType /BaseFont /CyclicMetadata /FirstChar 32 /LastChar 32 /Widths [500] /FontDescriptor 12 0 R >>" },
    { number: 12, body: "<< /Type /FontDescriptor /FontName /CyclicMetadata /Flags 32 /FontBBox [0 0 1000 1000] /Ascent 800 /Descent -200 /CapHeight 800 /ItalicAngle 0 /StemV 80 /FontFile2 13 0 R >>" },
    { number: 13, body: tinyPdfStream("/Length1 7 0 R /Filter 8 0 R /DecodeParms 9 0 R /Metadata 14 0 R", new Uint8Array(deflateSync(fontBytes))) },
    { number: 14, body: "<< /Owner 13 0 R >>" }
  ] });
  const fontsSource = await NativePdfDocument.open({ kind: "bytes", bytes: fontFixture });
  const sameFontsSource = await NativePdfDocument.open({ kind: "bytes", bytes: fontFixture });
  const fontsOutput = await NativePdfDocument.open({ kind: "bytes", bytes: seed });
  try {
    const writer = new NativePdfWriter(fontsOutput);
    const imported = await prepareCompositionSourcePage(fontsSource, 0, writer, new Map());
    const repeated = await prepareCompositionSourcePage(sameFontsSource, 0, writer, new Map());
    const fontFiles = page => {
      const fonts = page.resources.get("Font"), font = writer.get(fonts.get("F1")), descriptor = writer.get(font.get("FontDescriptor"));
      const cyclicFont = writer.get(fonts.get("F2")), cyclicDescriptor = writer.get(cyclicFont.get("FontDescriptor"));
      return [descriptor.get("FontFile2"), cyclicDescriptor.get("FontFile2")];
    };
    const [fontFile, cyclicFile] = fontFiles(imported), [repeatFile] = fontFiles(repeated);
    assert.deepEqual(fontFile, repeatFile, "normalized indirect font metadata still deduplicates across source documents");
    const stream = writer.get(fontFile);
    assert.equal(stream.dictionary.get("Length1"), fontBytes.length);
    assert.deepEqual(stream.dictionary.get("Filter"), [{ kind: "name", value: "FlateDecode" }]);
    assert.equal(stream.dictionary.get("DecodeParms")[0].get("Predictor"), 1);
    const cyclic = writer.get(cyclicFile), metadata = writer.get(cyclic.dictionary.get("Metadata"));
    assert.deepEqual(metadata.get("Owner"), cyclicFile, "font metadata cycles retain destination graph identity");
    const reference = writer.add(new Map([...imported.dictionary, ["Parent", pdfReference(2)]]));
    writer.set(pdfReference(2), new Map([["Type", pdfNameValue("Pages")], ["Count", 1], ["Kids", [reference]]]));
    const reopened = await NativePdfDocument.open({ kind: "bytes", bytes: await writer.save(undefined, { rewrite: true }) });
    try {
      const resources = await reopened.resolveDictionary(reopened.getPage(0).resources), fonts = await reopened.resolveDictionary(resources.get("Font"));
      for (const name of ["F1", "F2"]) {
        const font = await reopened.resolveDictionary(fonts.get(name)), descriptor = await reopened.resolveDictionary(font.get("FontDescriptor"));
        const embedded = await reopened.resolveValue(descriptor.get("FontFile2"));
        assert.deepEqual(await reopened.decodeStream(embedded), fontBytes, `${name}: imported indirect filter/parameter refs decode in destination`);
      }
    } finally { await reopened.close(); }
  } finally { await fontsSource.close(); await sameFontsSource.close(); await fontsOutput.close(); }
  console.log("Composition source imports: geometry, shared resources, static widget/markup paint, layers, fallback and cancellation passed.");
} finally { hooks.deregister(); }
