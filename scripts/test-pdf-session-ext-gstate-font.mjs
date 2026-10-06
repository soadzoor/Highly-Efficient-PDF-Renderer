import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });

try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { validateHeprPageData } = await import("../src/heprDocumentDataValidation.ts");
  const { NativePdfExtGStateRegistry } = await import("../src/pdf/nativeExtGState.ts");
  const { openNativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const cases = [
    {
      name: "dictionary fonts need no named /Font resource and q/Q restores size and font",
      content: "/Small gs /NoFont gs BT 10 10 Td (A) Tj ET q /Large gs BT 25 10 Td (B) Tj ET Q BT 45 10 Td (A) Tj ET",
      reference: "BT /F1 10 Tf 10 10 Td (A) Tj ET q BT /F2 20 Tf 25 10 Td (B) Tj ET Q BT 45 10 Td (A) Tj ET"
    },
    {
      name: "gs inside BT overrides Tf and a later Tf overrides gs",
      content: "BT /F1 10 Tf 10 10 Td /Large gs (A) Tj /F1 8 Tf (B) Tj ET",
      reference: "BT /F1 10 Tf 10 10 Td /F2 20 Tf (A) Tj /F1 8 Tf (B) Tj ET",
      namedFonts: true
    },
    {
      name: "direct dictionary and indirect array/size remain usable",
      content: "/Direct gs BT 10 10 Td (A) Tj ET /Indirect gs BT 30 10 Td (B) Tj ET",
      reference: "BT /F2 12 Tf 10 10 Td (A) Tj ET BT /F1 -8 Tf 30 10 Td (B) Tj ET"
    },
    {
      name: "zero font size preserves invisible searchable text",
      content: "/Zero gs BT 10 10 Td (A) Tj ET",
      reference: "BT /F1 0 Tf 10 10 Td (A) Tj ET"
    },
    {
      name: "Type3 selected through gs retains glyph programs and searchable text",
      content: "/Type3 gs BT 10 10 Td (A) Tj ET",
      reference: "BT /F3 14 Tf 10 10 Td (A) Tj ET"
    },
    {
      name: "Form-local gs uses its font dictionary and leaves the page state intact",
      content: "/Small gs /Scoped Do BT 40 10 Td (A) Tj ET",
      reference: "BT /F1 10 Tf ET /Scoped Do BT 40 10 Td (A) Tj ET",
      formContent: "/Small gs BT 10 10 Td (B) Tj ET",
      formReference: "BT /F2 20 Tf 10 10 Td (B) Tj ET"
    },
    {
      name: "Form-local Type3 gs preserves vector output through retained lowering",
      content: "/Scoped Do",
      reference: "/Scoped Do",
      formContent: "/Type3 gs BT 10 10 Td (A) Tj ET",
      formReference: "BT /F3 14 Tf 10 10 Td (A) Tj ET"
    },
    {
      name: "Form inherits the selected dictionary font and specializes by font/size",
      content: "/Small gs /Inherited Do q /Large gs 1 0 0 1 25 0 cm /Inherited Do Q",
      reference: "BT /F1 10 Tf ET /Inherited Do q BT /F2 20 Tf ET 1 0 0 1 25 0 cm /Inherited Do Q",
      formContent: "BT 10 10 Td (A) Tj ET",
      formReference: "BT 10 10 Td (A) Tj ET",
      inherited: true
    }
  ];
  for (const test of cases) {
    const actualSession = await openPdf({ kind: "bytes", bytes: fixture(test.content, test.formContent, test.namedFonts, test.inherited) });
    const expectedSession = await openPdf({ kind: "bytes", bytes: fixture(test.reference, test.formReference, true, test.inherited) });
    try {
      const actual = await actualSession.compilePage(0, { optimization: "none" });
      const expected = await expectedSession.compilePage(0, { optimization: "none" });
      validateHeprPageData(actual);
      assert.deepEqual(textSnapshot(actual), textSnapshot(expected), `${test.name}: display-program glyphs and index match Tf`);
      if (test.inherited) {
        assert.equal(actual.displayProgram.programs.filter(program => program.resourceName === "Inherited").length, 2,
          "different inherited fonts get independent reusable programs");
      }
      const actualScene = await actualSession.compileVectorPage(0, { optimization: "none" });
      const expectedScene = await expectedSession.compileVectorPage(0, { optimization: "none" });
      assert.deepEqual(sceneTextSnapshot(actualScene), sceneTextSnapshot(expectedScene), `${test.name}: streamed vector text matches Tf`);
      assert.equal(actualScene.rasterLayers.length, 0, "font selection keeps vector output");
    } finally {
      await actualSession.close();
      await expectedSession.close();
    }
  }

  for (const fontEntry of ["null", "[10 0 R]", "[/F1 10]", "[10 0 R /Bad]", "[42 0 R 10]"]) {
    const session = await openPdf({ kind: "bytes", bytes: fixture("/Broken gs BT (A) Tj ET", undefined, false, false, fontEntry) });
    try {
      for (const method of ["compilePage", "compileVectorPage"]) {
        await assert.rejects(session[method](0), error => error?.code === "invalid-object" &&
          error.details?.reason === "extgstate-font-invalid", `malformed /Font ${fontEntry}`);
      }
    } finally { await session.close(); }
  }

  const document = await openNativePdfDocument({ kind: "bytes", bytes: fixture("") });
  try {
    const registry = new NativePdfExtGStateRegistry(document);
    const selected = registry.describe(await registry.resolvePageExtGState(0, "Indirect"));
    assert.equal(selected.font.value.objectNumber, 10, "font reference survives for deduplication");
    assert.equal(selected.font.size, -8);
    assert.equal(registry.describe(await registry.resolvePageExtGState(0, "NoFont")).font, null,
      "an omitted /Font leaves font selection unchanged");
  } finally { await document.close(); }
  console.log("ExtGState font selection, restoration and Form inheritance tests passed.");
} finally { hooks.deregister(); }

function textSnapshot(page) {
  const { glyphs, fonts, transforms } = page.stores;
  return {
    text: page.textIndex.text,
    glyphs: Array.from(glyphs.glyphIds, (glyph, i) => ({
      glyph, code: glyphs.characterCodes[i], font: fonts.names[glyphs.fontIndices[i]],
      transform: [...transforms.values.slice(glyphs.transformIndices[i] * 6, glyphs.transformIndices[i] * 6 + 6)],
      flags: glyphs.flags[i]
    })),
    fallbackQuads: [...page.textIndex.fallbackQuads]
  };
}

function sceneTextSnapshot(scene) {
  return {
    text: scene.textIndex,
    glyphA: scene.textGlyphMetaA, glyphB: scene.textGlyphMetaB,
    segmentsA: scene.textGlyphSegmentsA, segmentsB: scene.textGlyphSegmentsB,
    instancesA: scene.textInstanceA, instancesB: scene.textInstanceB, instancesC: scene.textInstanceC,
    fillA: scene.fillPathMetaA, fillB: scene.fillPathMetaB, fillC: scene.fillPathMetaC,
    fillSegmentsA: scene.fillSegmentsA, fillSegmentsB: scene.fillSegmentsB
  };
}

function fixture(content, formContent, namedFonts = false, inherited = false, brokenFont = "[/F1 10]") {
  const font1 = "/Type /Font /Subtype /TrueType /BaseFont /FixtureA /Encoding /WinAnsiEncoding /FirstChar 65 /LastChar 66 /Widths [600 700] /FontDescriptor 12 0 R";
  const font2 = font1.replace("/FixtureA", "/FixtureB");
  const formName = inherited ? "Inherited" : "Scoped";
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << " +
      (namedFonts ? "/Font << /F1 10 0 R /F2 11 0 R /F3 30 0 R >> " : "") +
      "/ExtGState << /Small << /Font [10 0 R 10] >> /Large << /Font [11 0 R 20] >> " +
      `/Direct << /Font [<< ${font2} >> 12] >> /Indirect << /Font 14 0 R >> /Zero << /Font [10 0 R 0] >> ` +
      `/Type3 << /Font [30 0 R 14] >> /NoFont << >> /Broken << /Font ${brokenFont} >> >> ` +
      (formContent === undefined ? "" : `/XObject << /${formName} 20 0 R >> `) +
      ">> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", content) },
    { number: 10, body: `<< ${font1} >>` },
    { number: 11, body: `<< ${font2} >>` },
    { number: 12, body: "<< /Type /FontDescriptor /FontName /FixtureA /Flags 32 /FontBBox [0 -200 700 800] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 800 /StemV 80 /FontFile2 13 0 R >>" },
    { number: 13, body: tinyPdfStream("", buildTinySfnt()) },
    { number: 14, body: "[10 0 R 15 0 R]" },
    { number: 15, body: "-8" },
    { number: 20, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << /Font << /F2 11 0 R /F3 30 0 R >> /ExtGState << /Small << /Font [11 0 R 20] >> /Type3 << /Font [30 0 R 14] >> >> >>", formContent ?? "") },
    { number: 30, body: "<< /Type /Font /Subtype /Type3 /Name /FixtureType3 /FontBBox [0 0 500 500] /FontMatrix [.001 0 0 .001 0 0] /FirstChar 65 /LastChar 65 /Widths [500] /Encoding << /Type /Encoding /Differences [65 /A] >> /CharProcs << /A 31 0 R >> >>" },
    { number: 31, body: tinyPdfStream("", "500 0 0 0 500 500 d1 0 0 m 500 0 l 0 500 l h f") },
    { number: 42, body: "5" }
  ] });
}
