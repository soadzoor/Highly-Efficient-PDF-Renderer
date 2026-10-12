import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildType1Fixture, type1CharString as cs } from "./lib/type1Fixture.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")
    ? `${specifier}.ts` : specifier, context);
} });

try {
  const [{ openPdf }, { renderHeprPageToCanvas2d }, { validateHeprPageData }] = await Promise.all([
    import("../src/pdfSession.ts"), import("../src/heprCanvas2dRenderer.ts"),
    import("../src/heprDocumentDataValidation.ts")
  ]);
  const backdrop = [0, 255, 0, 255];
  for (const [charProc, expected] of [
    ["500 0 d0 1 0 0 rg 0 0 500 500 re f", [255, 0, 0, 255]],
    ["500 0 0 0 500 500 d1 0 0 500 500 re f", backdrop],
    ["500 0 d0 0 0 500 500 re f", backdrop]
  ]) {
    const session = await openPdf({ kind: "bytes", bytes: fixture("<41>", [
      { number: 5, body: "<< /Type /Font /Subtype /Type3 /FontMatrix [.001 0 0 .001 0 0] /FontBBox [0 0 500 500] /FirstChar 65 /LastChar 65 /Widths [500] /Encoding << /Differences [65 /A] >> /CharProcs << /A 6 0 R >> /Resources << >> >>" },
      { number: 6, body: tinyPdfStream("", charProc) }
    ]) });
    try {
      const page = await session.compilePage(0, { optimization: "none" });
      validateHeprPageData(page);
      const pixel = await renderPixel(page, 3, 3);
      assert.deepEqual(pixel, expected, "glyph-owned color paints; inherited /None remains unpainted");
      const scene = await session.compileVectorPage(0, { optimization: "none", vectorFallback: "error" });
      assert.equal(scene.rasterLayers.length, 0);
      assert.equal(scene.fillPathCount, expected === backdrop ? 1 : 2);
      assert.equal(scene.textIndex.pages[0].text, "A");
      assert(!session.getDiagnostics().some(d => /raster-fallback|retained-vector-fallback/.test(d.code)));
    } finally { await session.close(); }
  }

  const ordinaryFont = [{ number: 5, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>" }];
  for (const [paint, mode, after, point, expected, fills] of [
    ["/N cs 0 scn /N CS 0 SCN", 0, "", [3, 3], backdrop, 1],
    ["/N cs 0 scn /N CS 0 SCN", 1, "", [3, 3], backdrop, 1],
    ["/N cs 0 scn 0 0 1 RG 2 w", 2, "", [1, 5], [0, 0, 255, 255], 1],
    ["/N CS 0 SCN 1 0 0 rg", 2, "", [3, 3], [255, 0, 0, 255], 1],
    ["/N cs 0 scn /N CS 0 SCN", 6, "1 0 0 rg 0 0 20 20 re f", [3, 3], [255, 0, 0, 255], 2]
  ]) {
    const content = `0 1 0 rg 0 0 20 20 re f ${paint} BT /F 100 Tf ${mode} Tr 1 0 0 1 1 1 Tm (A) Tj ET ${after}`;
    const ordinary = await openPdf({ kind: "bytes", bytes: fixture("(A)", ordinaryFont, content) }, {
      missingFontResolver() { return { sfntBytes: buildTinySfnt(), identifier: "none-ordinary" }; }
    });
    try {
      const page = await ordinary.compilePage(0, { optimization: "none" });
      validateHeprPageData(page);
      assert.deepEqual(await renderPixel(page, ...point), expected, `ordinary glyph mode ${mode} retains its exact visible roles`);
      if (mode >= 4) assert.deepEqual(await renderPixel(page, 15, 15), backdrop, "no-paint glyphs still install their text clip");
      const scene = await ordinary.compileVectorPage(0, { optimization: "none", vectorFallback: "error" });
      assert.equal(scene.rasterLayers.length, 0);
      assert.equal(scene.fillPathCount, fills);
      assert.equal(scene.textIndex.pages[0].text, "A");
      assert(!ordinary.getDiagnostics().some(d => /raster-fallback|retained-vector-fallback/.test(d.code)));
    } finally { await ordinary.close(); }
  }

  const font = buildType1Fixture({ privateExtra: "/OtherSubrs [{} {} {} {} { gsave 1 0 0 setrgbcolor closepath fill grestore }] def",
    glyphs: [[".notdef", cs(0, 500, "hsbw", "endchar")],
      ["A", cs(0, 500, "hsbw", 0, 0, "rmoveto", 500, 0, "rlineto", 0, 500, "rlineto", 0, 4, "callothersubr", "endchar")],
      ["B", cs(0, 500, "hsbw", 0, 0, "rmoveto", 500, 0, "rlineto", 0, 500, "rlineto", -500, 0, "rlineto", "closepath", "endchar")]] });
  const mixed = await openPdf({ kind: "bytes", bytes: fixture("(AB)", [
    { number: 5, body: "<< /Type /Font /Subtype /Type1 /BaseFont /FixtureType1 /FirstChar 65 /LastChar 66 /Widths [500 500] /Encoding /WinAnsiEncoding /FontDescriptor 6 0 R >>" },
    { number: 6, body: "<< /Type /FontDescriptor /Flags 32 /FontName /FixtureType1 /FontBBox [0 0 500 500] /FontFile 7 0 R >>" },
    { number: 7, body: tinyPdfStream(`/Length1 ${font.length1} /Length2 ${font.length2} /Length3 ${font.length3}`, font.bytes) }
  ]) });
  try {
    const page = await mixed.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    assert.deepEqual(await renderPixel(page, 4, 2), [255, 0, 0, 255], "explicit OtherSubr paint survives caller /None");
    assert.deepEqual(await renderPixel(page, 8, 2), backdrop, "ordinary glyph in the same PostScript font run has no placeholder paint");
    const scene = await mixed.compileVectorPage(0, { optimization: "none", vectorFallback: "error" });
    assert.equal(scene.rasterLayers.length, 0);
    assert.equal(scene.textInstanceCount, 0, "ordinary glyph remains indexed without black paint");
    assert.equal(scene.fillPathCount, 2);
    assert.equal(scene.textIndex.pages[0].text, "AB");
    assert(!mixed.getDiagnostics().some(d => /raster-fallback|retained-vector-fallback/.test(d.code)));
  } finally { await mixed.close(); }

  async function renderPixel(page, x, y) {
    const rendered = await renderHeprPageToCanvas2d(page, { surfaceFactory(width, height) {
      const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext("2d") };
    } });
    return [...rendered.surface.context.getImageData(x, 19 - y, 1, 1).data];
  }
} finally { hooks.deregister(); }

console.log("Font-owned paint under /None tests passed");

function fixture(text, fontObjects, content = `0 1 0 rg 0 0 20 20 re f /N cs 0 scn BT /F 10 Tf 1 0 0 1 1 1 Tm ${text} Tj ET`) {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Contents 4 0 R /Resources << /Font << /F 5 0 R >> /ColorSpace << /N [/Separation /None /DeviceRGB 8 0 R] >> >> >>" },
    { number: 4, body: tinyPdfStream("", content) },
    ...fontObjects,
    { number: 8, body: "<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0] /C1 [0 0 0] /N 1 >>" }
  ] });
}
