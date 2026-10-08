import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { validateHeprPageData } = await import("../src/heprDocumentDataValidation.ts");
  const replacedText = "/Span << /ActualText <FEFF0932093F0902> >> BDC <00010002> Tj EMC";
  for (const content of [replacedText, "/Span /Replacement BDC <00010002> Tj EMC"]) {
    const session = await openPdf({ kind: "bytes", bytes: fixture(`BT /F1 10 Tf 20 30 Td ${content} ET`) });
    try {
      // compilePage uses prepared content; compileVectorPage streams page content.
      const page = await session.compilePage(0, { optimization: "none" });
      validateHeprPageData(page);
      assert.equal(page.textIndex.text, "लिं");
      assert.equal(page.stores.glyphs.glyphIds.length, 2);
      const scene = await session.compileVectorPage(0, { optimization: "none", vectorFallback: "error" });
      assert.equal(scene.textIndex.pages[0].text, "लिं");
      assert.equal(scene.textInstanceCount, 2);
      const ocr = await session.compileVectorPage(0, { ocrTextOnly: true });
      assert.equal(ocr.textIndex.pages[0].text, "लिं");
      assert.equal(ocr.textInstanceCount, 2);
      assert(!session.getDiagnostics().some(({ code }) => code === "font.missing-unicode-mapping"));
    } finally { await session.close(); }
  }

  const adjacent = await openPdf({ kind: "bytes", bytes: fixture(`BT /F1 10 Tf 20 30 Td ${replacedText} <0001> Tj ET`) });
  try {
    const scene = await adjacent.compileVectorPage(0, { optimization: "none", vectorFallback: "error" });
    assert.equal(scene.textIndex.pages[0].text, "लिंA", "the complete cluster advance prevents a false word gap");
    const retained = await adjacent.compileVectorPage(0, { optimization: "none", retainOptionalContent: true, vectorFallback: "error" });
    assert.equal(retained.textIndex.pages[0].text, "लिंA");
    const ocr = await adjacent.compileVectorPage(0, { ocrTextOnly: true });
    assert.equal(ocr.textIndex.pages[0].text, "लिंA");
  } finally { await adjacent.close(); }

  const form = await openPdf({ kind: "bytes", bytes: fixture(
    "q 1 0 0 1 10 0 cm /Text Do Q q 1 0 0 1 70 0 cm /Text Do Q",
    `BT /F1 10 Tf 0 30 Td ${replacedText} ET`
  ) });
  try {
    const page = await form.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    assert.equal(page.textIndex.text, "लिं लिं", "reused Forms replace text at each invocation");
    assert(page.textIndex.fallbackQuads.length > 0);
    const xs = Array.from({ length: page.textIndex.fallbackQuads.length / 4 }, (_, i) => page.textIndex.fallbackQuads[i * 4]);
    assert(Math.max(...xs) - Math.min(...xs) >= 60, "each occurrence keeps its transformed selection position");
    const scene = await form.compileVectorPage(0, { optimization: "none", vectorFallback: "error" });
    assert.equal(scene.textIndex.pages[0].text, "लिं लिं");
    const ocr = await form.compileVectorPage(0, { ocrTextOnly: true });
    assert.equal(ocr.textIndex.pages[0].text, "लिं लिं");
  } finally { await form.close(); }

  const mixed = await openPdf({ kind: "bytes", bytes: fixture(`
    BT /F1 10 Tf 20 30 Td
    /OC /Hidden BDC /Span /Replacement BDC <0002> Tj EMC EMC
    /Span << /ActualText () >> BDC <0002> Tj EMC
    /Span << /ActualText (outer) >> BDC
      /Span << /ActualText (inner) >> BDC <0002> Tj EMC
      /Artifact BMC <0002> Tj EMC
    EMC
    <0002> Tj ET
  `) });
  try {
    const page = await mixed.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    assert.equal(page.textIndex.text, "outer\ufffd");
    assert.equal(mixed.getDiagnostics().filter(({ code }) => code === "font.missing-unicode-mapping").length, 1);
    const ocr = await mixed.compileVectorPage(0, { ocrTextOnly: true });
    assert.equal(ocr.textIndex.pages[0].text, "outer\ufffd", "hidden and empty replacements stay excluded in OCR mode");
  } finally { await mixed.close(); }
  console.log("PDF ActualText tests passed");
} finally { hooks.deregister(); }

function fixture(content, formContent = "") {
  const resources = "/Font << /F1 5 0 R >> /Properties << /Replacement 14 0 R /Hidden 13 0 R >>";
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [13 0 R] /D << /OFF [13 0 R] >> >> >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << ${resources} /XObject << /Text 12 0 R >> >> /Contents 4 0 R >>` },
    { number: 4, body: tinyPdfStream("", content) },
    { number: 5, body: "<< /Type /Font /Subtype /Type0 /BaseFont /FixtureFont /Encoding /Identity-H /DescendantFonts [7 0 R] /ToUnicode 8 0 R >>" },
    { number: 7, body: "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /FixtureFont /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 9 0 R /DW 600 /CIDToGIDMap /Identity >>" },
    { number: 8, body: tinyPdfStream("", "begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfchar <0001> <0041> endbfchar endcmap") },
    { number: 9, body: "<< /Type /FontDescriptor /FontName /FixtureFont /Flags 4 /FontBBox [0 -200 1000 800] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 10 0 R >>" },
    { number: 10, body: tinyPdfStream("", buildTinySfnt()) },
    { number: 12, body: tinyPdfStream(`/Type /XObject /Subtype /Form /BBox [0 0 200 100] /Resources << ${resources} >>`, formContent) },
    { number: 13, body: "<< /Type /OCG /Name (Hidden) >>" },
    { number: 14, body: "<< /ActualText 15 0 R >>" },
    { number: 15, body: "<FEFF0932093F0902>" }
  ] });
}
