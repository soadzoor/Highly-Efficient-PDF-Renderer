import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

const {
  NativeSfntFont,
  glyphNameToUnicode,
  parseNativePdfFont,
  parseToUnicodeCMap
} = await import("../src/pdf/nativeFont.ts");
const {
  nativeStandard14GlyphWidth,
  resolveNativeStandard14MetricFace
} = await import("../src/pdf/nativeStandard14Metrics.ts");
const { NativeTextCompiler } = await import("../src/pdf/nativeText.ts");
const { HEPR_GLYPH_FLAG } = await import("../src/heprDocumentData.ts");
const { PdfError } = await import("../src/pdf/nativeTypes.ts");

const encoder = new TextEncoder();
const name = (value) => ({ kind: "name", value });
const pdfString = (value) => ({ kind: "string", bytes: encoder.encode(value), hex: false });
const cidSystemInfo = (ordering, supplement) => new Map([
  ["Registry", pdfString("Adobe")],
  ["Ordering", pdfString(ordering)],
  ["Supplement", supplement]
]);
const stream = (text, dictionary = new Map()) => ({
  kind: "stream",
  dictionary,
  bytes: typeof text === "string" ? encoder.encode(text) : text
});

const resolver = {
  async resolveValue(value) { return value; },
  async decodeStream(value) { return value.bytes; }
};

assert.equal(glyphNameToUnicode("Aacute.alt"), "Á");
assert.equal(glyphNameToUnicode("uhungarumlaut"), "ű");
assert.equal(glyphNameToUnicode("zero"), "0");
assert.equal(glyphNameToUnicode("uni00410042"), "AB");
assert.equal(glyphNameToUnicode("Delta"), "∆");

const toUnicodeSource = `
/CIDInit /ProcSet findresource begin
12 dict begin begincmap
2 begincodespacerange
<00> <7f>
<8100> <81ff>
endcodespacerange
4 beginbfchar
<40> <>
<41> <03a9>
<42> <00660069>
<46> <feff>
endbfchar
2 beginbfrange
<43> <45> <0043>
<8100> <8101> [<d83dde00> <0061>]
endbfrange
endcmap end end
`;

const cmap = parseToUnicodeCMap(encoder.encode(toUnicodeSource));
assert.deepEqual(cmap.decode(Uint8Array.of(0x40)), { code: 0x40, byteLength: 1, unicode: "" });
assert.deepEqual(cmap.decode(Uint8Array.of(0x41)), { code: 0x41, byteLength: 1, unicode: "Ω" });
assert.deepEqual(cmap.decode(Uint8Array.of(0x46)), { code: 0x46, byteLength: 1, unicode: "\ufeff" });
assert.deepEqual(cmap.decode(Uint8Array.of(0x44)), { code: 0x44, byteLength: 1, unicode: "D" });
assert.deepEqual(cmap.decode(Uint8Array.of(0x81, 0)), {
  code: 0x8100,
  byteLength: 2,
  unicode: "😀"
});

const simpleFontDictionary = new Map([
  ["Type", name("Font")],
  ["Subtype", name("TrueType")],
  ["BaseFont", name("FixtureSans")],
  ["FirstChar", 65],
  ["Widths", [600, 700, 710, 720, 730]],
  ["Encoding", new Map([
    ["BaseEncoding", name("WinAnsiEncoding")],
    ["Differences", [66, name("fi")]]
  ])],
  ["ToUnicode", stream(toUnicodeSource)]
]);

const simpleFont = await parseNativePdfFont(simpleFontDictionary, resolver);
const mappedA = simpleFont.decode(Uint8Array.of(65));
assert.equal(mappedA.glyphId, 65, "substitute selector remains separate from ToUnicode");
assert.equal(mappedA.unicode, "Ω");
assert.equal(mappedA.width, 600);
const mappedB = simpleFont.decode(Uint8Array.of(66));
assert.equal(mappedB.glyphName, "fi");
assert.equal(mappedB.unicode, "fi");
assert.equal(mappedB.width, 700);
const mappedWithoutText = simpleFont.decode(Uint8Array.of(64));
assert.equal(mappedWithoutText.unicode, "", "an explicit empty mapping remains distinct from a missing mapping");
assert.throws(
  () => simpleFont.getGlyphOutline(65),
  (error) => error instanceof PdfError && error.code === "unsupported-font"
);

const cidToGidBytes = new Uint8Array(2 * 103);
cidToGidBytes[202] = 0;
cidToGidBytes[203] = 9;
const cidEncoding = stream(`
/WMode 1 def
1 begincodespacerange <0000> <ffff> endcodespacerange
1 begincidrange <0020> <0022> 100 endcidrange
`);
const cidToUnicode = stream(`
1 begincodespacerange <0000> <ffff> endcodespacerange
1 beginbfrange <0020> <0022> <0041> endbfrange
`);
const descendant = new Map([
  ["Subtype", name("CIDFontType2")],
  ["CIDSystemInfo", cidSystemInfo("Fixture", 0)],
  ["DW", 1000],
  ["W", [100, [500, 600, 700]]],
  ["DW2", [880, -1000]],
  ["W2", [101, [-900, 300, 750]]],
  ["CIDToGIDMap", stream(cidToGidBytes)]
]);
const compositeFont = await parseNativePdfFont(new Map([
  ["Subtype", name("Type0")],
  ["BaseFont", name("FixtureCID")],
  ["Encoding", cidEncoding],
  ["DescendantFonts", [descendant]],
  ["ToUnicode", cidToUnicode]
]), resolver);
const mappedCid = compositeFont.decode(Uint8Array.of(0, 0x21));
assert.equal(mappedCid.code, 0x21);
assert.equal(mappedCid.cid, 101);
assert.equal(mappedCid.glyphId, 9);
assert.equal(mappedCid.unicode, "B");
assert.equal(mappedCid.width, 600);
assert.deepEqual(mappedCid.verticalMetric, { advanceY: -900, originX: 300, originY: 750 });

const text = new NativeTextCompiler({
  fonts: new Map([["F1", { font: simpleFont, fontIndex: 3 }]])
});
text.beginText();
text.setFont("F1", 10);
text.setTextMatrix([1, 0, 0, 1, 100, 200]);
text.showText(Uint8Array.of(65));
text.setRenderingMode(3);
text.showAdjustedText([Uint8Array.of(66), -100, Uint8Array.of(67)]);
text.endText();
const compiled = text.build();
assert.equal(compiled.textIndex.text, "ΩfiC");
assert.deepEqual([...compiled.textIndex.charGlyphIndices], [0, 1, 1, 2]);
assert.deepEqual([...compiled.glyphs.fontIndices], [3, 3, 3]);
assert.equal(compiled.glyphs.flags[0], 0);
assert.ok(compiled.glyphs.flags[1] & HEPR_GLYPH_FLAG.Invisible);
assert.equal(compiled.transforms.values[6 + 4], 100);
assert.equal(compiled.transforms.values[12 + 4], 106);
assert.ok(Math.abs(compiled.transforms.values[18 + 4] - 114) < 1e-6);

const suppressedText = new NativeTextCompiler({
  fonts: new Map([["F1", { font: simpleFont, fontIndex: 3 }]])
});
suppressedText.beginText();
suppressedText.setFont("F1", 10);
suppressedText.showText(Uint8Array.of(64));
suppressedText.endText();
const compiledSuppressedText = suppressedText.build();
assert.equal(compiledSuppressedText.glyphs.glyphIds.length, 1, "the painted glyph geometry is retained");
assert.equal(compiledSuppressedText.textIndex.text, "", "no replacement character is invented");
assert.deepEqual([...compiledSuppressedText.textIndex.charGlyphIndices], []);

const sfnt = NativeSfntFont.parse(buildTinySfnt());
assert.equal(sfnt.unitsPerEm, 1000);
assert.equal(sfnt.mapCodePoint(65), 1);
assert.equal(sfnt.mapCodePoint(66), 2);
assert.deepEqual(sfnt.getHorizontalMetric(1), { advanceWidth: 600, leftSideBearing: 0 });
const simpleOutline = sfnt.getGlyphOutline(1);
assert.equal(simpleOutline.commands[0].kind, "move");
assert.equal(simpleOutline.commands.at(-1).kind, "close");
const compoundOutline = sfnt.getGlyphOutline(2);
assert.deepEqual(compoundOutline.bounds, [50, 0, 150, 100]);
assert.equal(compoundOutline.commands[0].x, 50);

await testMissingFontResolution();
await testStandard14AdvanceMetrics();

console.log("native font/text tests passed");
hooks.deregister();

async function testStandard14AdvanceMetrics() {
  for (const [baseFont, expectedFace] of [
    ["Courier", "courier"],
    ["Courier-Bold", "courier"],
    ["Courier-Oblique", "courier"],
    ["Courier-BoldOblique", "courier"],
    ["Helvetica", "helvetica"],
    ["Helvetica-Oblique", "helvetica"],
    ["Helvetica-Bold", "helvetica-bold"],
    ["Helvetica-BoldOblique", "helvetica-bold"],
    ["Times-Roman", "times-roman"],
    ["Times-Italic", "times-italic"],
    ["Times-Bold", "times-bold"],
    ["Times-BoldItalic", "times-bold-italic"],
    ["Symbol", "symbol"],
    ["ZapfDingbats", "zapf-dingbats"]
  ]) {
    assert.equal(resolveNativeStandard14MetricFace(baseFont), expectedFace, baseFont);
  }
  assert.equal(
    resolveNativeStandard14MetricFace("ABCDEF+Arial-BoldItalicMT"),
    "helvetica-bold"
  );
  assert.equal(resolveNativeStandard14MetricFace("CourierNewPS-BoldItalicMT"), "courier");
  assert.equal(resolveNativeStandard14MetricFace("TimesNewRomanPS-ItalicMT"), "times-italic");
  assert.equal(resolveNativeStandard14MetricFace("SymbolMT"), "symbol");
  assert.equal(resolveNativeStandard14MetricFace("ITCZapfDingbatsStd"), "zapf-dingbats");
  assert.equal(resolveNativeStandard14MetricFace("ArialNarrow"), null);
  assert.equal(nativeStandard14GlyphWidth("helvetica", "Euro"), 556);
  assert.equal(nativeStandard14GlyphWidth("times-bold", "R"), 722);
  assert.equal(nativeStandard14GlyphWidth("times-bold-italic", "R"), 667);
  assert.equal(nativeStandard14GlyphWidth("times-roman", "not-a-glyph"), null);

  const substituteSfnt = buildTinySfnt();
  const parseStandardFont = (baseFont, entries = []) => parseNativePdfFont(new Map([
    ["Type", name("Font")],
    ["Subtype", name("Type1")],
    ["BaseFont", name(baseFont)],
    ...entries
  ]), resolver, {
    missingFontResolver: () => ({
      sfntBytes: substituteSfnt,
      identifier: "standard-14-metric-test"
    })
  });
  const widthsFor = (font, text) => Array.from(
    text,
    (character) => font.decode(Uint8Array.of(character.charCodeAt(0))).width
  );

  const helvetica = await parseStandardFont("Helvetica");
  assert.deepEqual(widthsFor(helvetica, "OCR"), [778, 722, 722]);
  assert.equal(
    helvetica.sfnt.getHorizontalMetric(0).advanceWidth,
    500,
    "the substitute's different hmtx remains irrelevant to Standard-14 positioning"
  );
  const positioned = new NativeTextCompiler({
    fonts: new Map([["F14", { font: helvetica, fontIndex: 0 }]])
  });
  positioned.beginText();
  positioned.setFont("F14", 10);
  positioned.showText(encoder.encode("OCR"));
  positioned.endText();
  const positionedGlyphs = positioned.build();
  for (const [index, expected] of [7.78, 0, 7.22, 0, 7.22, 0].entries()) {
    assert.ok(Math.abs(positionedGlyphs.glyphs.advances[index] - expected) < 1e-6);
  }
  assert.ok(Math.abs(positionedGlyphs.transforms.values[16] - 7.78) < 1e-6);
  assert.ok(Math.abs(positionedGlyphs.transforms.values[22] - 15) < 1e-6);

  const helveticaBoldAlias = await parseStandardFont("ABCDEF+Arial-BoldItalicMT");
  assert.equal(widthsFor(helveticaBoldAlias, "A")[0], 722);

  const helveticaWinAnsi = await parseStandardFont("Helvetica", [
    ["Encoding", name("WinAnsiEncoding")]
  ]);
  for (let code = 32; code <= 255; code += 1) {
    const mapped = helveticaWinAnsi.decode(Uint8Array.of(code));
    if (mapped.glyphName === null) continue;
    const standardWidth = nativeStandard14GlyphWidth("helvetica", mapped.glyphName);
    assert.notEqual(standardWidth, null, `WinAnsi code ${code} (${mapped.glyphName})`);
    assert.equal(mapped.width, standardWidth, `WinAnsi code ${code} (${mapped.glyphName})`);
  }
  for (const [code, glyphName, width] of [
    [0x88, "circumflex", 333],
    [0x8a, "Scaron", 667],
    [0xc0, "Agrave", 667]
  ]) {
    const mapped = helveticaWinAnsi.decode(Uint8Array.of(code));
    assert.equal(mapped.glyphName, glyphName);
    assert.equal(mapped.width, width);
  }

  const helveticaMacRoman = await parseStandardFont("Helvetica", [
    ["Encoding", name("MacRomanEncoding")]
  ]);
  for (const [code, glyphName, width] of [
    [173, "notequal", 549],
    [182, "partialdiff", 476],
    [183, "summation", 600],
    [195, "radical", 453],
    [198, "Delta", 612],
    [215, "lozenge", 471]
  ]) {
    const mapped = helveticaMacRoman.decode(Uint8Array.of(code));
    assert.equal(mapped.glyphName, glyphName);
    assert.equal(mapped.width, width);
  }

  const courierAlias = await parseStandardFont("CourierNewPS-BoldItalicMT");
  assert.deepEqual(widthsFor(courierAlias, "OCR"), [600, 600, 600]);

  const timesRoman = await parseStandardFont("Times-Roman");
  assert.deepEqual(widthsFor(timesRoman, "OCR"), [722, 667, 667]);
  const timesItalicAlias = await parseStandardFont("TimesNewRomanPS-ItalicMT");
  assert.deepEqual(widthsFor(timesItalicAlias, "OCR"), [722, 667, 611]);

  const symbolAlias = await parseStandardFont("SymbolMT");
  assert.equal(symbolAlias.decode(Uint8Array.of(34)).glyphName, "universal");
  assert.equal(symbolAlias.decode(Uint8Array.of(34)).width, 713);
  const zapfAlias = await parseStandardFont("ITCZapfDingbatsStd");
  assert.equal(zapfAlias.decode(Uint8Array.of(35)).glyphName, "a202");
  assert.equal(zapfAlias.decode(Uint8Array.of(35)).width, 974);

  const explicitWidth = await parseStandardFont("Helvetica", [
    ["FirstChar", 79],
    ["Widths", [321]],
    ["FontDescriptor", new Map([["MissingWidth", 432]])]
  ]);
  assert.equal(widthsFor(explicitWidth, "O")[0], 321, "an explicit /Widths entry wins");
  assert.equal(
    widthsFor(explicitWidth, "C")[0],
    432,
    "/MissingWidth wins outside an explicitly supplied /Widths range"
  );
}

async function testMissingFontResolution() {
  const requests = [];
  const diagnostics = [];
  const callerBytes = buildTinySfnt();
  const descriptor = new Map([
    ["Flags", 1 | 2 | 64 | (1 << 18)],
    ["FontFamily", { kind: "string", bytes: encoder.encode("Fixture Family"), hex: false }],
    ["FontStretch", name("SemiCondensed")],
    ["FontWeight", 600],
    ["ItalicAngle", -12],
    ["Ascent", 790],
    ["Descent", -210],
    ["CapHeight", 700],
    ["XHeight", 480],
    ["StemV", 90],
    ["FontBBox", [-20, -210, 1000, 790]]
  ]);
  const missingSimple = new Map(simpleFontDictionary);
  missingSimple.set("BaseFont", name("ABCDEF+FixtureSans-BoldItalic"));
  missingSimple.set("FontDescriptor", descriptor);
  const substituted = await parseNativePdfFont(missingSimple, resolver, {
    async missingFontResolver(request, signal) {
      assert.equal(signal, undefined);
      requests.push(request);
      return { sfntBytes: callerBytes, identifier: "fixture-sans-v1" };
    },
    onDiagnostic(diagnostic) {
      diagnostics.push(diagnostic);
    }
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].baseFont, "ABCDEF+FixtureSans-BoldItalic");
  assert.equal(requests[0].normalizedBaseFont, "FixtureSans-BoldItalic");
  assert.equal(requests[0].subtype, "TrueType");
  assert.equal(requests[0].descendantSubtype, null);
  assert.equal(requests[0].descriptor.embeddedKind, null);
  assert.equal(requests[0].descriptor.family, "Fixture Family");
  assert.equal(requests[0].style.family, "Fixture Family");
  assert.equal(requests[0].style.weight, 600);
  assert.equal(requests[0].style.italic, true);
  assert.equal(requests[0].style.fixedPitch, true);
  assert.equal(requests[0].style.serif, true);
  assert.equal(requests[0].style.forceBold, true);
  assert.equal(substituted.substitution.identifier, "fixture-sans-v1");
  assert.equal(substituted.substitution.outlineFormat, "glyf");
  assert.equal(substituted.diagnostics.length, 1);
  assert.equal(substituted.diagnostics[0].code, "font.missing-substituted");
  assert.deepEqual(diagnostics, substituted.diagnostics);
  const substitutedA = substituted.decode(Uint8Array.of(65));
  assert.equal(substitutedA.glyphId, 1, "glyph selection follows Encoding, not ToUnicode");
  assert.equal(substitutedA.unicode, "Ω", "ToUnicode remains semantic text metadata");
  callerBytes.fill(0);
  assert.equal(
    substituted.getGlyphOutline(1).commands[0].kind,
    "move",
    "resolver byte ownership must be isolated from later caller mutation"
  );

  const fingerprintedA = await parseNativePdfFont(simpleFontDictionary, resolver, {
    missingFontResolver: () => buildTinySfnt()
  });
  const fingerprintedB = await parseNativePdfFont(simpleFontDictionary, resolver, {
    missingFontResolver: () => buildTinySfnt()
  });
  assert.match(fingerprintedA.substitution.identifier, /^sfnt-\d+-[0-9a-f]{16}$/);
  assert.equal(fingerprintedA.substitution.identifier, fingerprintedB.substitution.identifier);

  let nullCalls = 0;
  const unresolved = await parseNativePdfFont(simpleFontDictionary, resolver, {
    missingFontResolver() {
      nullCalls += 1;
      return null;
    }
  });
  assert.equal(nullCalls, 1);
  assert.equal(unresolved.sfnt, null);
  assert.equal(unresolved.substitution, null);
  assert.equal(unresolved.diagnostics.length, 0);
  assert.throws(
    () => unresolved.getGlyphOutline(65),
    (error) => error instanceof PdfError && error.code === "unsupported-font"
  );

  await assert.rejects(
    parseNativePdfFont(simpleFontDictionary, resolver, {
      missingFontResolver: () => Uint8Array.of(0, 1, 2, 3)
    }),
    (error) => error instanceof PdfError && error.code === "unsupported-font"
  );
  await assert.rejects(
    parseNativePdfFont(simpleFontDictionary, resolver, {
      missingFontResolver: () => ({ sfntBytes: makeCffSfnt(buildTinySfnt()) })
    }),
    (error) => error instanceof PdfError && error.code === "unsupported-font" && /CFF/.test(error.message)
  );

  let embeddedResolverCalls = 0;
  const embeddedDictionary = new Map(simpleFontDictionary);
  embeddedDictionary.set("FontDescriptor", new Map([
    ["FontFile2", stream(buildTinySfnt())]
  ]));
  const embedded = await parseNativePdfFont(embeddedDictionary, resolver, {
    missingFontResolver() {
      embeddedResolverCalls += 1;
      return buildTinySfnt();
    }
  });
  assert(embedded.sfnt);
  assert.equal(embeddedResolverCalls, 0, "an embedded program must never invoke missing-font resolution");
  assert.equal(embedded.substitution, null);

  const normalizedMetricDiagnostics = [];
  const normalizedMetricDictionary = new Map(simpleFontDictionary);
  normalizedMetricDictionary.set("FontDescriptor", new Map([
    ["FontFile2", stream(new Uint8Array(await readFile(
      new URL("./fixtures/sfnt/hmtx-under-count.ttf", import.meta.url)
    )))]
  ]));
  const normalizedMetricFont = await parseNativePdfFont(
    normalizedMetricDictionary,
    resolver,
    { onDiagnostic: (diagnostic) => normalizedMetricDiagnostics.push(diagnostic) }
  );
  assert.deepEqual(
    normalizedMetricFont.sfnt.getHorizontalMetric(2),
    { advanceWidth: 600, leftSideBearing: 50 }
  );
  assert.equal(
    normalizedMetricFont.diagnostics[0]?.code,
    "font.sfnt-horizontal-metrics-normalized"
  );
  assert.deepEqual(normalizedMetricDiagnostics, normalizedMetricFont.diagnostics);

  let cffResolverCalls = 0;
  const embeddedCffDictionary = new Map(simpleFontDictionary);
  embeddedCffDictionary.set("Subtype", name("Type1"));
  embeddedCffDictionary.set("FontDescriptor", new Map([
    ["FontFile3", stream(Uint8Array.of(1, 0, 4, 4), new Map([["Subtype", name("Type1C")]]))]
  ]));
  await assert.rejects(
    parseNativePdfFont(embeddedCffDictionary, resolver, {
      missingFontResolver() {
        cffResolverCalls += 1;
        return buildTinySfnt();
      }
    }),
    (error) => error instanceof PdfError && error.code === "unsupported-font"
  );
  assert.equal(cffResolverCalls, 0, "an embedded CFF program is unsupported, not missing");

  let type3ResolverCalls = 0;
  const type3 = await parseNativePdfFont(new Map([
    ["Subtype", name("Type3")],
    ["BaseFont", name("PaintedGlyphs")],
    ["FontMatrix", [0.001, 0, 0, 0.001, 0, 0]]
  ]), resolver, {
    missingFontResolver() {
      type3ResolverCalls += 1;
      return buildTinySfnt();
    }
  });
  assert.equal(type3ResolverCalls, 0);
  assert.equal(type3.substitution, null);

  let compositeRequest = null;
  const compositeToUnicode = stream(`
1 begincodespacerange <0000> <ffff> endcodespacerange
1 beginbfchar <0001> <03a9> endbfchar
`);
  const substitutedComposite = await parseNativePdfFont(new Map([
    ["Subtype", name("Type0")],
    ["BaseFont", name("CIDFixture")],
    ["Encoding", name("Identity-H")],
    ["DescendantFonts", [new Map([
      ["Subtype", name("CIDFontType2")],
      ["CIDSystemInfo", cidSystemInfo("Japan1", 7)],
      ["FontDescriptor", new Map([["Flags", 4]])],
      ["CIDToGIDMap", name("Identity")]
    ])]],
    ["ToUnicode", compositeToUnicode]
  ]), resolver, {
    missingFontResolver(request) {
      compositeRequest = request;
      return { sfntBytes: buildTinySfnt(), identifier: "fixture-cid-v1" };
    }
  });
  assert.equal(compositeRequest.subtype, "Type0");
  assert.equal(compositeRequest.descendantSubtype, "CIDFontType2");
  const compositeGlyph = substitutedComposite.decode(Uint8Array.of(0, 1));
  assert.equal(compositeGlyph.cid, 1);
  assert.equal(compositeGlyph.glyphId, 1, "CIDToGID selection remains independent of ToUnicode");
  assert.equal(compositeGlyph.unicode, "Ω");
  assert.equal(substitutedComposite.getGlyphOutline(1).commands[0].kind, "move");
}

function makeCffSfnt(sfntBytes) {
  const bytes = sfntBytes.slice();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tableCount = view.getUint16(4, false);
  for (let index = 0; index < tableCount; index += 1) {
    const offset = 12 + index * 16;
    if (String.fromCharCode(...bytes.subarray(offset, offset + 4)) === "glyf") {
      bytes.set(encoder.encode("CFF "), offset);
      return bytes;
    }
  }
  throw new Error("tiny sfnt has no glyf table");
}

function buildTinySfnt() {
  const head = new Uint8Array(54);
  const headView = new DataView(head.buffer);
  headView.setUint16(18, 1000, false);
  headView.setInt16(50, 1, false);

  const maxp = new Uint8Array(6);
  const maxpView = new DataView(maxp.buffer);
  maxpView.setUint32(0, 0x00010000, false);
  maxpView.setUint16(4, 3, false);

  const hhea = new Uint8Array(36);
  const hheaView = new DataView(hhea.buffer);
  hheaView.setInt16(4, 800, false);
  hheaView.setInt16(6, -200, false);
  hheaView.setUint16(34, 3, false);

  const hmtx = new Uint8Array(12);
  const hmtxView = new DataView(hmtx.buffer);
  hmtxView.setUint16(0, 500, false);
  hmtxView.setUint16(4, 600, false);
  hmtxView.setUint16(8, 700, false);

  const simpleGlyph = new Uint8Array(30);
  const simpleView = new DataView(simpleGlyph.buffer);
  simpleView.setInt16(0, 1, false);
  simpleView.setInt16(2, 0, false);
  simpleView.setInt16(4, 0, false);
  simpleView.setInt16(6, 100, false);
  simpleView.setInt16(8, 100, false);
  simpleView.setUint16(10, 2, false);
  simpleView.setUint16(12, 0, false);
  simpleGlyph.set([1, 1, 1], 14);
  simpleView.setInt16(17, 0, false);
  simpleView.setInt16(19, 100, false);
  simpleView.setInt16(21, -100, false);
  simpleView.setInt16(23, 0, false);
  simpleView.setInt16(25, 0, false);
  simpleView.setInt16(27, 100, false);

  const compoundGlyph = new Uint8Array(18);
  const compoundView = new DataView(compoundGlyph.buffer);
  compoundView.setInt16(0, -1, false);
  compoundView.setInt16(2, 50, false);
  compoundView.setInt16(4, 0, false);
  compoundView.setInt16(6, 150, false);
  compoundView.setInt16(8, 100, false);
  compoundView.setUint16(10, 0x0003, false);
  compoundView.setUint16(12, 1, false);
  compoundView.setInt16(14, 50, false);
  compoundView.setInt16(16, 0, false);

  const glyf = new Uint8Array(simpleGlyph.length + compoundGlyph.length);
  glyf.set(simpleGlyph, 0);
  glyf.set(compoundGlyph, simpleGlyph.length);
  const loca = new Uint8Array(16);
  const locaView = new DataView(loca.buffer);
  locaView.setUint32(0, 0, false);
  locaView.setUint32(4, 0, false);
  locaView.setUint32(8, simpleGlyph.length, false);
  locaView.setUint32(12, glyf.length, false);

  const cmapSubtable = new Uint8Array(32);
  const cmapView = new DataView(cmapSubtable.buffer);
  cmapView.setUint16(0, 4, false);
  cmapView.setUint16(2, cmapSubtable.length, false);
  cmapView.setUint16(6, 4, false);
  cmapView.setUint16(8, 4, false);
  cmapView.setUint16(10, 1, false);
  cmapView.setUint16(14, 66, false);
  cmapView.setUint16(16, 0xffff, false);
  cmapView.setUint16(18, 0, false);
  cmapView.setUint16(20, 65, false);
  cmapView.setUint16(22, 0xffff, false);
  cmapView.setInt16(24, -64, false);
  cmapView.setInt16(26, 1, false);
  cmapView.setUint16(28, 0, false);
  cmapView.setUint16(30, 0, false);
  const cmapTable = new Uint8Array(12 + cmapSubtable.length);
  const cmapTableView = new DataView(cmapTable.buffer);
  cmapTableView.setUint16(0, 0, false);
  cmapTableView.setUint16(2, 1, false);
  cmapTableView.setUint16(4, 3, false);
  cmapTableView.setUint16(6, 1, false);
  cmapTableView.setUint32(8, 12, false);
  cmapTable.set(cmapSubtable, 12);

  const tables = new Map([
    ["cmap", cmapTable],
    ["glyf", glyf],
    ["head", head],
    ["hhea", hhea],
    ["hmtx", hmtx],
    ["loca", loca],
    ["maxp", maxp]
  ]);
  const directoryBytes = 12 + tables.size * 16;
  let totalBytes = directoryBytes;
  const records = [];
  for (const [tag, bytes] of tables) {
    totalBytes = (totalBytes + 3) & ~3;
    records.push({ tag, bytes, offset: totalBytes });
    totalBytes += bytes.length;
  }
  const output = new Uint8Array(totalBytes);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x00010000, false);
  view.setUint16(4, tables.size, false);
  records.forEach((record, index) => {
    const offset = 12 + index * 16;
    for (let char = 0; char < 4; char += 1) output[offset + char] = record.tag.charCodeAt(char);
    view.setUint32(offset + 8, record.offset, false);
    view.setUint32(offset + 12, record.bytes.length, false);
    output.set(record.bytes, record.offset);
  });
  return output;
}
