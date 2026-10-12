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
  const options = { missingFontResolver: () => ({ sfntBytes: buildTinySfnt(), identifier: "production-compatibility" }) };
  const lawful = "q 2 0 0 3 5 7 cm BT /F1 10 Tf 10 10 Td (A) Tj ET Q";
  const recovered = "BT /F1 10 Tf q 2 0 0 3 5 7 cm 10 10 Td (A) Tj Q ET";
  const pages = [];
  for (const content of [lawful, recovered]) {
    const session = await openPdf({ kind: "bytes", bytes: fixture(content) }, options);
    try {
      const page = await session.compilePage(0, { optimization: "none" });
      validateHeprPageData(page);
      pages.push(page);
      const scene = await session.compileVectorPage(0, { optimization: "none", vectorFallback: "error" });
      assert.equal(scene.textInstanceCount, 1);
      assert.equal(scene.rasterLayers.length, 0);
      if (content === recovered) assert(session.getDiagnostics().some(d => d.code === "text.graphics-inside-text"));
    } finally { await session.close(); }
  }
  assert.deepEqual(pages[1].stores.glyphs, pages[0].stores.glyphs, "graphics state inside BT/ET keeps the same glyph placement");
  assert.deepEqual(pages[1].stores.transforms, pages[0].stores.transforms);

  for (const [content, text, code] of [
    ["/Span << /ActualText (replacement) >> BDC BT /F1 10 Tf (A) Tj ET", "replacement", "marked-content.unclosed-scope"],
    ["EMC BT /F1 10 Tf (A) Tj ET", "A", "marked-content.unmatched-end"],
    ["/OC BMC BT /F1 10 Tf (A) Tj ET EMC", "A", "optional-content.missing-membership"]
  ]) {
    const session = await openPdf({ kind: "bytes", bytes: fixture(content) }, options);
    try {
      const page = await session.compilePage(0);
      validateHeprPageData(page);
      assert.equal(page.textIndex.text, text);
      const scene = await session.compileVectorPage(0, { vectorFallback: "error" });
      assert.equal(scene.textIndex.pages[0].text, text);
      assert.equal(scene.rasterLayers.length, 0);
      assert(session.getDiagnostics().some(d => d.code === code), code);
    } finally { await session.close(); }
  }

  const session = await openPdf({ kind: "bytes", bytes: fixture("10 10 10 10 re f", [
    "<< /Subtype /Link /Rect [20 20 40 40] /C [2 -1 .5] /BS << /W 1 /S /F >> >>",
    "<< /Subtype /Widget /Parent 10 0 R /Rect [50 50 70 70] /AS /Off /AP << /N << /Yes 9 0 R >> >> >>",
    "<< /Subtype /Stamp /Rect [70 70 90 90] /AP << /N 9 0 R >> >>"
  ]) }, options);
  try {
    const page = await session.compilePage(0);
    validateHeprPageData(page);
    assert.equal(page.annotations.length, 3);
    const scene = await session.compileVectorPage(0, { vectorFallback: "error" });
    assert.equal(scene.rasterLayers.length, 0);
    assert.equal(scene.annotations.length, 3);
    assert.equal(scene.fillPathCount, 2, "only page content and the bounded stamp paint; Off must never paint its Yes state");
    assert(scene.segmentCount > 0, "an unknown border style retains a visible vector border");
    for (const code of ["annotation.color-clamped", "annotation.appearance-approximated", "annotation.missing-off-appearance", "annotation.appearance-subtype-inferred", "annotation.duplicate-field-kid", "annotation.field-kids-missing", "annotation.field-root-recovered"]) {
      assert(session.getDiagnostics().some(d => d.code === code), code);
    }
  } finally { await session.close(); }
} finally { hooks.deregister(); }

console.log("PDF production compatibility tests passed");

function fixture(content, annotations = []) {
  return writeTinyPdf({ objects: [
    { number: 1, body: `<< /Type /Catalog /Pages 2 0 R ${annotations.length ? "/AcroForm 12 0 R" : ""} >>` },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R ${annotations.length ? `/Annots [${annotations.map((_, i) => `${i + 6} 0 R`).join(" ")}]` : ""} >>` },
    { number: 4, body: tinyPdfStream("", content) },
    { number: 5, body: "<< /Type /Font /Subtype /TrueType /BaseFont /Fixture /Encoding /WinAnsiEncoding >>" },
    ...annotations.map((body, i) => ({ number: i + 6, body })),
    { number: 9, body: tinyPdfStream("/BBox [0 0 10 10]", "0 0 10 10 re f") },
    { number: 10, body: "<< /Parent 11 0 R /Kids [7 0 R 7 0 R] >>" },
    { number: 11, body: "<< /FT /Btn >>" },
    { number: 12, body: "<< /Fields [] >>" }
  ] });
}
