import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { deflateSync } from "node:zlib";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { validateHeprPageData } = await import("../src/heprDocumentDataValidation.ts");
  const options = { missingFontResolver(request) {
    assert.equal(request.normalizedBaseFont, "Helvetica");
    return { sfntBytes: buildTinySfnt(), identifier: "freetext-helvetica" };
  } };
  const content = "q 0 0 80 30 re W n BT 0 Tc 1 0 0 rg 3 20 Td (A) Tj 0 -9 Td (B) Tj ET Q";
  const pages = [];
  for (const [style, fontSelection, source] of [
    ["/DS (font: Helvetica 8pt; color:#FF0000)", "", "DS"],
    ["/RC (<body style=\"font: 8pt Helvetica; color:#FF0000\"><p>A</p></body>)", "", "RC"],
    ["/DS (font: SomethingElse 99pt)", "/F1 8 Tf", null],
    ["/DS (font: SomethingElse 99pt)", "/GS gs", null]
  ]) {
    const session = await openPdf({ kind: "bytes", bytes: fixture(content.replace("BT", `BT ${fontSelection}`), style) }, options);
    try {
      const page = await session.compilePage(0, { optimization: "none" });
      validateHeprPageData(page);
      pages.push(page);
      const scene = await session.compileVectorPage(0, { optimization: "none", vectorFallback: "error" });
      assert.equal(scene.textInstanceCount, 2);
      assert.equal(scene.rasterLayers.length, 0);
      const diagnostics = session.getDiagnostics().filter(d => d.code === "annotation.appearance-font-recovered");
      assert.equal(diagnostics.length, source ? 1 : 0, "valid appearances keep their font selection");
      if (source) {
        assert.equal(diagnostics[0].details.styleSource, source);
        assert.equal(diagnostics[0].details.fontSize, 8);
        assert.equal(diagnostics[0].details.approximate, true);
      }
    } finally { await session.close(); }
  }
  for (const page of pages.slice(0, 2)) {
    assert.deepEqual(page.stores.glyphs, pages[2].stores.glyphs, "recovered text retains glyphs and advances");
    assert.deepEqual(page.stores.transforms, pages[2].stores.transforms, "recovered text retains line positions and font size");
    assert.deepEqual(page.stores.colors, pages[2].stores.colors, "recovered text retains its red paint");
    assert.deepEqual(page.stores.paints, pages[2].stores.paints);
    assert.equal(page.textIndex.text, pages[2].textIndex.text);
  }
  for (const style of ["", "/DS (font: Helvetica 8px)", "/DS (font: Helvetica -8pt)"]) {
    const session = await openPdf({ kind: "bytes", bytes: fixture(content, style) }, options);
    try {
      await assert.rejects(session.compilePage(0), error => error.code === "unsupported-font" && /before a font/.test(error.message));
      assert(!session.getDiagnostics().some(d => d.code === "annotation.appearance-font-recovered"));
    } finally { await session.close(); }
  }
  const limited = await openPdf({ kind: "bytes", bytes: fixture(content.padEnd(1000, " "), "/DS (font: Helvetica 8pt)", true) }, {
    ...options, limits: { maxDecodedStreamBytes: 1024 }
  });
  try {
    await assert.rejects(limited.compilePage(0), error => error.code === "resource-limit" && /repaired FreeText/.test(error.message));
  } finally { await limited.close(); }
  const cancelled = await openPdf({ kind: "bytes", bytes: fixture(content, "/DS (font: Helvetica 8pt)") }, options);
  try {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(cancelled.compilePage(0, { signal: controller.signal }), error => error.code === "aborted");
  } finally { await cancelled.close(); }
} finally { hooks.deregister(); }

console.log("PDF FreeText missing-font recovery tests passed");

function fixture(content, style, compressed = false) {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Annots [5 0 R] >>" },
    { number: 4, body: tinyPdfStream("", "") },
    { number: 5, body: `<< /Subtype /FreeText /Rect [10 20 90 50] /AP << /N 6 0 R >> ${style} >>` },
    { number: 6, body: tinyPdfStream(`/Type /XObject /Subtype /Form /BBox [0 0 80 30] /Matrix [1 0 0 1 0 0] /Resources << /Font << /F1 7 0 R >> /ExtGState << /GS << /Font [7 0 R 8] >> >> >> ${compressed ? "/Filter /FlateDecode" : ""}`, compressed ? deflateSync(content) : content) },
    { number: 7, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>" }
  ] });
}
