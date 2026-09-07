import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const encoder = new TextEncoder();
const contentText = [
  "q",
  "5 5 180 80 re W n",
  "/G cs 0.25 sc",
  "/RGB cs 0.1 0.2 0.3 sc",
  "/CMYK cs 0.1 0.2 0.3 0.4 sc",
  "0.1 0.2 0.3 rg",
  "BT /F1 12 Tf 20 30 Td (Hello) Tj 18 0 Td (world) Tj ET",
  "BT /F1 8 Tf 3 Tr 20 10 Td (OCR) Tj ET",
  "Q",
  ""
].join("\n");
const retainedTextContent = encoder.encode(contentText);

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.includes("/src/") &&
      /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const [
    { openNativePdfDocument },
    { compileNativeDenseRetainedTextPage },
    { extractDenseTextMiniPdfWithNative },
    { createBundledStandardFontResolver }
  ] = await Promise.all([
    import("../src/pdf/nativeDocument.ts"),
    import("../src/nativeDenseRetainedTextCompiler.ts"),
    import("../src/nativeDenseTextExtractor.ts"),
    import("../src/standardFontResolver.ts")
  ]);
  const missingFontResolver = createBundledStandardFontResolver({
    async loadAsset(asset, signal) {
      signal?.throwIfAborted();
      const url = new URL(asset.url);
      url.search = "";
      return new Uint8Array(await readFile(url));
    }
  });
  const bytes = createFixture();
  const expected = (await extractDenseTextMiniPdfWithNative(bytes, {
    missingFontResolver
  }))[0];
  const document = await openNativePdfDocument({
    kind: "bytes",
    bytes,
    ownership: "copy",
    label: "retained-text-direct-test.pdf"
  });
  try {
    const page = document.getPage(0);
    const actual = await compileNativeDenseRetainedTextPage(
      document,
      page,
      retainedTextContent,
      ["F1"],
      { missingFontResolver }
    );
    assert.deepEqual(actual, expected);
    assert.equal(actual.pageCount, 1);
    assert.equal(actual.segmentCount, 0);
    assert.equal(actual.fillPathCount, 0);
    assert.equal(actual.rasterLayers.length, 0);
    assert.equal(actual.textIndex.pages[0].text, "Hello world OCR");

    // The direct helper borrows the document; it must remain reusable.
    assert.equal(document.getPage(0), page);
    assert.ok(await document.resolveDictionary(page.resources));

    await assert.rejects(
      compileNativeDenseRetainedTextPage(
        document,
        page,
        retainedTextContent,
        ["Wrong"],
        { missingFontResolver }
      ),
      (error) => error?.code === "invalid-object" &&
        error?.details?.reason === "retained-text-font-set"
    );
    await assert.rejects(
      compileNativeDenseRetainedTextPage(
        document,
        page,
        encoder.encode("/GS gs BT /F1 12 Tf (Hello) Tj ET"),
        ["F1"],
        { missingFontResolver }
      ),
      (error) => error?.code === "unsupported-content" &&
        error?.details?.resourceKind === "ExtGState"
    );
    const resourceBacked = await compileNativeDenseRetainedTextPage(
      document,
      page,
      encoder.encode(
        "/Span /P0 BDC /GS gs BT /F1 12 Tf 20 30 Td (Resources) Tj ET EMC"
      ),
      ["F1"],
      {
        missingFontResolver,
        extGStates: [{ resourceName: "GS", strokeAlpha: 0.8, fillAlpha: 0.5 }]
      }
    );
    assert.equal(resourceBacked.textIndex.pages[0].text, "Resources");

    const cancelled = new AbortController();
    cancelled.abort(new Error("cancel retained text"));
    await assert.rejects(
      compileNativeDenseRetainedTextPage(
        document,
        page,
        retainedTextContent,
        ["F1"],
        { missingFontResolver, signal: cancelled.signal }
      ),
      /cancel retained text/
    );
  } finally {
    await document.close();
  }

  const normalizedFontBytes = new Uint8Array(await readFile(
    new URL("./fixtures/sfnt/hmtx-under-count.ttf", import.meta.url)
  ));
  const normalizedFontContent = encoder.encode("BT /F1 12 Tf 20 30 Td (AB) Tj ET");
  const normalizedFontDocument = await openNativePdfDocument({
    kind: "bytes",
    bytes: createEmbeddedMetricFixture(normalizedFontBytes, normalizedFontContent),
    ownership: "copy",
    label: "retained-text-normalized-hmtx.pdf"
  });
  try {
    const diagnostics = [];
    const normalizedFontScene = await compileNativeDenseRetainedTextPage(
      normalizedFontDocument,
      normalizedFontDocument.getPage(0),
      normalizedFontContent,
      ["F1"],
      { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) }
    );
    assert.equal(normalizedFontScene.textIndex.pages[0].text, "AB");
    assert.equal(
      diagnostics[0]?.code,
      "font.sfnt-horizontal-metrics-normalized",
      "exact hmtx normalization is diagnostic but does not force text fallback"
    );
  } finally {
    await normalizedFontDocument.close();
  }

  const spatialText = encoder.encode([
    "BT /F1 10 Tf",
    "1 0 0 1 10 20 Tm (A) Tj",
    "1 0 0 1 200 20 Tm (B) Tj",
    "3 Tr",
    "1 0 0 1 20 40 Tm (C) Tj",
    "1 0 0 1 200 40 Tm (D) Tj",
    // Conservative OCR geometry and the visible outline both cross the page
    // edge. They must remain indexed even though neither is fully contained.
    "1 0 0 1 99 60 Tm (E) Tj",
    "0 Tr 1 0 0 1 99 70 Tm (F) Tj",
    "ET",
    "q 0 0 50 100 re W n",
    "BT /F1 10 Tf 3 Tr",
    "1 0 0 1 49 80 Tm (G) Tj",
    "1 0 0 1 60 80 Tm (H) Tj",
    "ET Q",
    ""
  ].join("\n"));
  const spatialDocument = await openNativePdfDocument({
    kind: "bytes",
    bytes: createSpatialFixture(spatialText),
    ownership: "copy",
    label: "retained-text-spatial-filter.pdf"
  });
  try {
    const spatialScene = await compileNativeDenseRetainedTextPage(
      spatialDocument,
      spatialDocument.getPage(0),
      spatialText,
      ["F1"],
      { missingFontResolver }
    );
    assert.deepEqual(
      spatialScene.textIndex.pages[0].text.trim().split(/\s+/u),
      ["A", "C", "E", "F", "G"],
      "only text intersecting the exact page/run clip remains searchable"
    );
    assert.equal(spatialScene.textInstanceCount, 2, "partially visible text still renders");
    assert.equal(
      spatialScene.textIndex.pages[0].fallbackQuads.length / 4,
      3,
      "in-page and partially visible OCR text keeps fallback geometry"
    );
  } finally {
    await spatialDocument.close();
  }

  console.log("Native direct retained-text compiler tests passed.");
} finally {
  hooks.deregister();
}

function createFixture() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [-10 -20 210 120] " +
          "/CropBox [0 0 200 100] /Rotate 90 /UserUnit 2 " +
          "/Resources << /Font << /F1 5 0 R >> " +
          "/Properties << /P0 6 0 R >> /ExtGState << /GS 7 0 R >> >> " +
          "/Contents 4 0 R >>"
      },
      { number: 4, body: tinyPdfStream("", retainedTextContent) },
      {
        number: 5,
        body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica " +
          "/Encoding /WinAnsiEncoding >>"
      },
      { number: 6, body: "<< /MCID 7 >>" },
      { number: 7, body: "<< /Type /ExtGState /CA 0.8 /ca 0.5 >>" }
    ]
  });
}

function createSpatialFixture(content) {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] " +
          "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"
      },
      { number: 4, body: tinyPdfStream("", content) },
      {
        number: 5,
        body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica " +
          "/Encoding /WinAnsiEncoding >>"
      }
    ]
  });
}

function createEmbeddedMetricFixture(fontBytes, content) {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] " +
          "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"
      },
      { number: 4, body: tinyPdfStream("", content) },
      {
        number: 5,
        body: "<< /Type /Font /Subtype /TrueType /BaseFont /FixtureSans " +
          "/FirstChar 65 /LastChar 66 /Widths [600 600] " +
          "/Encoding /WinAnsiEncoding /FontDescriptor 6 0 R >>"
      },
      {
        number: 6,
        body: "<< /Type /FontDescriptor /FontName /FixtureSans /Flags 32 " +
          "/FontBBox [0 0 150 100] /ItalicAngle 0 /Ascent 800 /Descent -200 " +
          "/CapHeight 700 /StemV 80 /FontFile2 7 0 R >>"
      },
      { number: 7, body: tinyPdfStream("", fontBytes) }
    ]
  });
}
