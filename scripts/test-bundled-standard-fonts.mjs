import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const [{
    BUNDLED_STANDARD_FONT_ASSETS,
    createBundledStandardFontResolver,
    resolveBundledStandardFontAsset
  }, {
    createNodeBundledStandardFontResolver
  }, {
    nativeSymbolEncodingEntry,
    nativeSymbolGlyphNameEntry
  }, {
    zapfDingbatEncodingGlyphName,
    zapfDingbatGlyphNameToUnicode
  }, {
    openPdf
  }, {
    openPdfInNodeWorker
  }] = await Promise.all([
    import("../src/standardFontResolver.ts"),
    import("../src/nodePdfSource.ts"),
    import("../src/pdf/nativeSymbolEncoding.ts"),
    import("../src/pdf/nativeZapfDingbats.ts"),
    import("../src/pdfSession.ts"),
    import("../src/pdf/workerClient.ts")
  ]);

  const request = (baseFont, overrides = {}) => ({
    baseFont,
    normalizedBaseFont: baseFont,
    subtype: "Type1",
    descendantSubtype: null,
    writingMode: 0,
    descriptor: {
      flags: 0,
      ascent: 800,
      descent: -200,
      missingWidth: 0,
      fontBBox: null,
      embeddedKind: null,
      family: null,
      stretch: null,
      weight: null,
      italicAngle: 0,
      capHeight: null,
      xHeight: null,
      stemV: null,
      ...overrides.descriptor
    },
    style: {
      family: null,
      weight: 400,
      stretch: null,
      italicAngle: 0,
      fixedPitch: false,
      serif: false,
      symbolic: false,
      script: false,
      italic: false,
      allCaps: false,
      smallCaps: false,
      forceBold: false,
      ...overrides.style
    }
  });

  const cases = [
    [request("Helvetica"), "liberation-sans-regular"],
    [request("Helvetica-BoldOblique"), "liberation-sans-bold-italic"],
    [request("Times-Roman"), "liberation-serif-regular"],
    [request("Times New Roman"), "liberation-serif-regular"],
    [request("Times New Roman,Bold", { style: { weight: 700 } }), "liberation-serif-bold"],
    [request("Times New Roman,BoldItalic", {
      style: { weight: 700, italic: true }
    }), "liberation-serif-bold-italic"],
    [request("Times-BoldItalic"), "liberation-serif-bold-italic"],
    [request("Courier-Oblique"), "liberation-mono-italic"],
    [request("Symbol"), "noto-sans-math"],
    [request("ZapfDingbats"), "noto-sans-symbols-2"],
    [request("Unknown", { style: { fixedPitch: true, weight: 700 } }), "liberation-mono-bold"],
    [request("Unknown", { style: { serif: true, italic: true } }), "liberation-serif-italic"]
  ];
  for (const [fontRequest, expected] of cases) {
    assert.equal(resolveBundledStandardFontAsset(fontRequest).id, expected);
  }

  for (const asset of Object.values(BUNDLED_STANDARD_FONT_ASSETS)) {
    const bytes = await readFile(asset.url);
    assert.equal(bytes.byteLength, asset.byteLength, asset.id);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256, asset.id);
    assert.equal(bytes[0], 0, `${asset.id} sfnt signature`);
    assert.equal(bytes[1], 1, `${asset.id} sfnt signature`);
  }

  let loads = 0;
  const cacheProbe = createBundledStandardFontResolver({
    async loadAsset(asset) {
      loads += 1;
      return new Uint8Array(asset.byteLength);
    }
  });
  const first = await cacheProbe(request("Helvetica"));
  const second = await cacheProbe(request("Arial"));
  assert.equal(loads, 1);
  assert.equal(first.sfntBytes, second.sfntBytes);
  assert.match(first.identifier, /^hepr:liberation-sans-regular:/);

  const invalid = createBundledStandardFontResolver({
    async loadAsset() {
      return new Uint8Array(3);
    }
  });
  await assert.rejects(() => invalid(request("Helvetica")), /expected 410712/);
  const aborted = new AbortController();
  aborted.abort(new Error("stop"));
  await assert.rejects(() => cacheProbe(request("Helvetica"), aborted.signal), /stop/);

  const nodeResolver = createNodeBundledStandardFontResolver();
  const nodeFont = await nodeResolver(request("Times-Italic"));
  assert.equal(nodeFont.identifier.startsWith("hepr:liberation-serif-italic:"), true);
  assert.equal(nodeFont.sfntBytes.byteLength, 375_632);

  assert.deepEqual(nativeSymbolEncodingEntry(34), {
    glyphName: "universal",
    unicode: "∀",
    selectionUnicode: "∀"
  });
  assert.equal(nativeSymbolGlyphNameEntry("radicalex")?.unicode, "\uf8e5");
  assert.equal(nativeSymbolGlyphNameEntry("radicalex")?.selectionUnicode, "⎷");
  assert.equal(zapfDingbatEncodingGlyphName(35), "a202");
  assert.equal(zapfDingbatGlyphNameToUnicode("a202"), "✃");
  assert.equal(zapfDingbatGlyphNameToUnicode("a80"), null);

  const fixture = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 3 /Kids [3 0 R 4 0 R 5 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 10 0 R >> >> /Contents 20 0 R >>" },
      { number: 4, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 11 0 R >> >> /Contents 21 0 R >>" },
      { number: 5, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 12 0 R >> >> /Contents 22 0 R >>" },
      { number: 10, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" },
      { number: 11, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>" },
      { number: 12, body: "<< /Type /Font /Subtype /Type1 /BaseFont /ZapfDingbats >>" },
      { number: 20, body: tinyPdfStream("", "BT /F1 20 Tf 10 40 Td (A) Tj ET\n") },
      { number: 21, body: tinyPdfStream("", "BT /F1 20 Tf 10 40 Td (\\042) Tj ET\n") },
      { number: 22, body: tinyPdfStream("", "BT /F1 20 Tf 10 40 Td (#) Tj ET\n") }
    ]
  });
  const session = await openPdf(
    { kind: "bytes", bytes: fixture },
    { missingFontResolver: nodeResolver }
  );
  try {
    const pages = await Promise.all([0, 1, 2].map((index) => session.compilePage(index)));
    assert.deepEqual(pages.map((page) => page.textIndex.text), ["A", "∀", "✃"]);
    for (const [pageIndex, page] of pages.entries()) {
      assert.equal(page.stores.glyphs.glyphIds[0] > 0, true, `page ${pageIndex} glyph id`);
      assert.equal(page.stores.fonts.outlinePathCounts[0] > 0, true, `page ${pageIndex} outline`);
    }
  } finally {
    await session.close();
  }

  const workerSession = await openPdfInNodeWorker(
    { kind: "bytes", bytes: fixture },
    { missingFontResolver: nodeResolver }
  );
  try {
    const firstPage = await workerSession.compileVectorPage(0);
    const repeatedPage = await workerSession.compileVectorPage(0);
    assert.equal(firstPage.textInstanceCount, 1);
    assert.equal(repeatedPage.textInstanceCount, 1);
    assert.equal(
      (await nodeResolver(request("Helvetica"))).sfntBytes.byteLength,
      BUNDLED_STANDARD_FONT_ASSETS["liberation-sans-regular"].byteLength,
      "worker transfer must not detach the cached Node Buffer"
    );
  } finally {
    await workerSession.close();
  }

  console.log("bundled Standard-14 font resolver tests passed");
} finally {
  hooks.deregister();
}
