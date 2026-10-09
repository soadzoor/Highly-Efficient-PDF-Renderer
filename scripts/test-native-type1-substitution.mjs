import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import { buildTinySfnt } from "./lib/tinySfnt.mjs";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

const encoder = new TextEncoder();
const name = value => ({ kind: "name", value });
const stream = bytes => ({ kind: "stream", dictionary: new Map(), bytes });
const resolver = {
  async resolveValue(value) { return value; },
  async decodeStream(value) { return value.bytes; }
};
const toUnicode = `
1 begincodespacerange <00> <ff> endcodespacerange
4 beginbfchar <01> <0041> <02> <0041> <03> <0042> <41> <0042> endbfchar
`;

try {
  const [{ parseNativePdfFont }, { PdfError }, { extractPdfPageScenes }] = await Promise.all([
    import("../src/pdf/nativeFont.ts"),
    import("../src/pdf/nativeTypes.ts"),
    import("../src/pdfVectorExtractor.ts")
  ]);

  // Subsets with opaque names need semantic metadata to keep their substitute
  // readable. Recognized Encoding names and explicit .notdef still select paint.
  for (const [subtype, bytes] of [
    ["Type1", encoder.encode("%!PS-AdobeFont-1.0: Fixture\ncurrentfile eexec\n")],
    ["MMType1", Uint8Array.of(0x80, 1, 0, 0, 0, 0, 0x80, 3)]
  ]) {
    const diagnostics = [];
    let request;
    const font = await parseNativePdfFont(fontDictionary(subtype, bytes), resolver, {
      missingFontResolver(value) {
        request = value;
        return { sfntBytes: buildTinySfnt(), identifier: "type1-substitute" };
      },
      onDiagnostic: diagnostic => diagnostics.push(diagnostic)
    });
    assert.equal(request.descriptor.embeddedKind, "type1");
    assert.equal(request.normalizedBaseFont, "Fixture");
    assert.equal(font.descriptor.embeddedKind, "type1", "retain source font metadata");
    assert.deepEqual([1, 2, 3].map(code => font.decode(Uint8Array.of(code)).glyphId), [1, 2, 0]);
    assert.deepEqual([1, 2, 3].map(code => font.decode(Uint8Array.of(code)).width), [612, 721, 333]);
    assert.equal(font.decode(Uint8Array.of(2)).unicode, "A", "text metadata remains independent of paint");
    assert.equal(font.getGlyphOutline(1).commands[0].kind, "move");
    assert.equal(font.substitution.identifier, "type1-substitute");
    assert.deepEqual(diagnostics, font.diagnostics);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, "font.type1-substituted");
    assert.equal(diagnostics[0].details.approximate, true);
    assert.match(diagnostics[0].message, /ToUnicode/);
    assert.match(diagnostics[0].message, /default simple-font encoding/);
  }

  const omittedEncoding = fontDictionary();
  omittedEncoding.delete("Encoding");
  const approximated = await parseNativePdfFont(omittedEncoding, resolver, {
    missingFontResolver: () => buildTinySfnt()
  });
  assert.equal(approximated.decode(Uint8Array.of(65)).glyphId, 1);
  assert.equal(approximated.decode(Uint8Array.of(65)).unicode, "B");
  assert.match(approximated.diagnostics[0].message, /default simple-font encoding/);

  for (const options of [{}, { missingFontResolver: () => null }]) {
    const unsupported = await parseNativePdfFont(fontDictionary(), resolver, options);
    assert.equal(unsupported.substitution, null);
    assert.equal(unsupported.diagnostics.length, 0);
    assert.throws(() => unsupported.getGlyphOutline(1),
      error => error instanceof PdfError && error.code === "unsupported-font" && /Type1/.test(error.message));
  }
  const failure = new Error("caller substitute failure");
  await assert.rejects(parseNativePdfFont(fontDictionary(), resolver, {
    missingFontResolver() { throw failure; }
  }), error => error instanceof PdfError && error.code === "unsupported-font" && error.cause === failure);
  const controller = new AbortController();
  await assert.rejects(parseNativePdfFont(fontDictionary(), resolver, {
    signal: controller.signal,
    missingFontResolver() { controller.abort(); return buildTinySfnt(); }
  }), error => error instanceof PdfError && error.code === "aborted");
  await assert.rejects(parseNativePdfFont(fontDictionary(), resolver, {
    parserLimits: { maxSfntTables: 1 },
    missingFontResolver: () => buildTinySfnt()
  }), error => error instanceof PdfError && error.code === "resource-limit");

  // Exercise the source conversion path and its default bundled resolver in
  // the actual Node worker, including diagnostics and visible vector geometry.
  const pdf = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "BT /F1 12 Tf 1 0 0 1 10 50 Tm <0102> Tj ET") },
    { number: 5, body: "<< /Type /Font /Subtype /Type1 /BaseFont /ABCDEF+Fixture /FirstChar 1 /Widths [612 721] /Encoding << /Differences [1 /g56 /B] >> /FontDescriptor 6 0 R /ToUnicode 8 0 R >>" },
    { number: 6, body: "<< /Type /FontDescriptor /FontName /ABCDEF+Fixture /Flags 32 /FontFile 7 0 R >>" },
    { number: 7, body: tinyPdfStream("/Length1 32 /Length2 0 /Length3 0", "%!PS-AdobeFont-1.0: Fixture\n") },
    { number: 8, body: tinyPdfStream("", toUnicode) }
  ] });
  const diagnostics = [];
  const [scene] = await extractPdfPageScenes(pdf.buffer, {
    onDiagnostic: diagnostic => diagnostics.push(diagnostic)
  });
  assert.equal(scene.textIndex.pages[0].text, "AA");
  assert(scene.textGlyphCount > 0, "substituted Type1 text retains visible glyph geometry");
  assert.equal(diagnostics.filter(diagnostic => diagnostic.code === "font.type1-substituted").length, 1);
  console.log("Native Type1 substitution tests passed.");
} finally {
  hooks.deregister();
}

function fontDictionary(subtype = "Type1", bytes = encoder.encode("%!PS-AdobeFont-1.0: Fixture\n")) {
  return new Map([
    ["Subtype", name(subtype)],
    ["BaseFont", name("ABCDEF+Fixture")],
    ["FirstChar", 1],
    ["Widths", [612, 721, 333]],
    ["Encoding", new Map([["Differences", [1, name("g56"), name("B"), name(".notdef")]]])],
    ["FontDescriptor", new Map([["FontFile", stream(bytes)], ["Flags", 32]])],
    ["ToUnicode", stream(encoder.encode(toUnicode))]
  ]);
}
