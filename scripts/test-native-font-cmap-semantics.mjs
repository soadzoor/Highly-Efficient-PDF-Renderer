import assert from "node:assert/strict";
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

const {
  DEFAULT_NATIVE_PDF_FONT_PARSER_LIMITS,
  glyphNameToUnicode,
  parseNativePdfFont,
  parseToUnicodeCMap
} = await import("../src/pdf/nativeFont.ts");
const { openNativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
const { PdfError } = await import("../src/pdf/nativeTypes.ts");

const encoder = new TextEncoder();
const document = await openNativePdfDocument({ kind: "bytes", bytes: fixture() });
const resolvedRefs = [];
const resolver = {
  async resolveValue(value, signal) {
    if (value?.kind === "ref") resolvedRefs.push(`${value.objectNumber}:${value.generation}`);
    return await document.resolveValue(value, signal);
  },
  async decodeStream(stream, signal) {
    return await document.decodeStream(stream, signal);
  }
};
const identityResolver = {
  async resolveValue(value) { return value; },
  async decodeStream(value) { return value.bytes; }
};

try {
  await testInheritedCompositeFont();
  await testIdentityAndVerticalResourceLaziness();
  await testBundledPredefinedCMaps();
  await testCidUnicodeFallbackAndRos();
  await testUseCMapCyclesAndDepth();
  await testSimpleEncodingAndUnicodeSeparation();
  await testCidToGidBounds();
  testDirectCMapValidation();
  await testUnsupportedAssetsAndLimits();

  assert.ok(!resolvedRefs.includes("98:0"), "horizontal fonts must not resolve unused /DW2");
  assert.ok(!resolvedRefs.includes("99:0"), "unknown dictionary resources must remain lazy");
} finally {
  await document.close();
  hooks.deregister();
}

console.log("native font CMap/encoding semantics tests passed");

async function testInheritedCompositeFont() {
  const font = await loadFont(10);
  assert.equal(font.writingMode, 1);

  const ascii = font.decode(Uint8Array.of(0x41));
  assert.deepEqual(project(ascii), {
    code: 0x41,
    codeByteLength: 1,
    cid: 5,
    glyphId: 7,
    unicode: "A",
    width: 500,
    verticalMetric: { advanceY: -800, originX: 250, originY: 700 }
  });

  const scalarRange = font.decode(Uint8Array.of(0x81, 0x00));
  assert.deepEqual(project(scalarRange), {
    code: 0x8100,
    codeByteLength: 2,
    cid: 100,
    glyphId: 11,
    unicode: "😀",
    width: 700,
    verticalMetric: { advanceY: -900, originX: 300, originY: 750 }
  });

  const locallyOverridden = font.decode(Uint8Array.of(0x81, 0x01));
  assert.deepEqual(project(locallyOverridden), {
    code: 0x8101,
    codeByteLength: 2,
    cid: 200,
    glyphId: 17,
    unicode: "b",
    width: 900,
    verticalMetric: { advanceY: -1100, originX: 400, originY: 800 }
  });

  const arrayDestination = font.decode(Uint8Array.of(0x81, 0x02));
  assert.equal(arrayDestination.cid, 102);
  assert.equal(arrayDestination.glyphId, 13);
  assert.equal(arrayDestination.unicode, "cd");

  const shortCidToGid = font.decode(Uint8Array.of(0x42));
  assert.equal(shortCidToGid.cid, 500);
  assert.equal(shortCidToGid.glyphId, 0, "a CID beyond a stream map deterministically selects .notdef");
  assert.equal(shortCidToGid.unicode, null, "ToUnicode cannot inherit glyph-selection data");
  assert.deepEqual(shortCidToGid.verticalMetric, {
    advanceY: -1000,
    originX: 500,
    originY: 880
  });

  const unmapped = font.decode(Uint8Array.of(0x43));
  assert.equal(unmapped.cid, 0);
  assert.equal(unmapped.glyphId, 0);
  assert.equal(unmapped.unicode, null);
  assert.throws(
    () => font.decode(Uint8Array.of(0x80)),
    hasPdfError("unsupported-font", /outside.*codespace/i)
  );
}

async function testIdentityAndVerticalResourceLaziness() {
  const vertical = await loadFont(20);
  const mapped = vertical.decode(Uint8Array.of(0x02, 0x79));
  assert.equal(vertical.writingMode, 1);
  assert.equal(mapped.cid, 633);
  assert.equal(mapped.glyphId, 633);
  assert.equal(mapped.unicode, "\u3000", "Identity-V uses descendant Japan1 for Unicode fallback");
  assert.equal(mapped.width, 900);
  assert.deepEqual(mapped.verticalMetric, { advanceY: -1000, originX: 450, originY: 880 });

  const horizontal = await loadFont(50);
  const horizontalMapped = horizontal.decode(Uint8Array.of(0, 5));
  assert.equal(horizontal.writingMode, 0);
  assert.equal(horizontalMapped.cid, 5);
  assert.equal(horizontalMapped.verticalMetric, null);
}

async function testBundledPredefinedCMaps() {
  const horizontal = await parseNativePdfFont(
    compositeFont(name("90ms-RKSJ-H"), new Map([["Subtype", name("CIDFontType2")]])),
    identityResolver
  );
  assert.equal(horizontal.writingMode, 0);
  assert.equal(horizontal.decode(Uint8Array.of(0x81, 0x40)).cid, 633);

  const vertical = await parseNativePdfFont(
    compositeFont(name("90ms-RKSJ-V"), new Map([["Subtype", name("CIDFontType2")]])),
    identityResolver
  );
  assert.equal(vertical.writingMode, 1);
  assert.equal(vertical.decode(Uint8Array.of(0x81, 0x40)).cid, 633, "vertical CMap inherits H");
  assert.equal(vertical.decode(Uint8Array.of(0x81, 0x41)).cid, 7887, "local V mapping overrides H");

  const unicode = await parseNativePdfFont(
    compositeFont(name("UniJIS-UTF16-H"), new Map([["Subtype", name("CIDFontType2")]])),
    identityResolver
  );
  assert.equal(unicode.decode(Uint8Array.of(0, 0x41)).cid, 34);
  assert.equal(unicode.decode(Uint8Array.of(0xd8, 0x3d, 0xdf, 0x9c)).cid, 12244);

  const gb18030 = await parseNativePdfFont(
    compositeFont(name("GBK2K-H"), cidFont("GB1", 6)),
    identityResolver
  );
  assert.equal(gb18030.decode(Uint8Array.of(0x81, 0x30, 0x84, 0x36)).cid, 22354);
  assert.equal(
    gb18030.decode(Uint8Array.of(0x81, 0x7f, 0x81, 0x30)).codeByteLength,
    2,
    "an unmapped two-byte GBK code must not consume the following character"
  );

  const inheritedStream = await parseNativePdfFont(
    compositeFont(stream(`
      /90ms-RKSJ-H usecmap
      1 begincidchar <8140> 9 endcidchar
    `), new Map([["Subtype", name("CIDFontType2")]])),
    identityResolver
  );
  assert.equal(inheritedStream.decode(Uint8Array.of(0x81, 0x40)).cid, 9);
  assert.equal(inheritedStream.decode(Uint8Array.of(0x81, 0x41)).cid, 634);

  const localNotdef = await parseNativePdfFont(
    compositeFont(stream(`
      1 begincodespacerange <00> <ff> endcodespacerange
      1 beginnotdefrange <00> <ff> 9 endnotdefrange
      1 begincidchar <41> 7 endcidchar
    `), new Map([["Subtype", name("CIDFontType2")]])),
    identityResolver
  );
  assert.equal(localNotdef.decode(Uint8Array.of(0x41)).cid, 7, "CID mapping precedes notdef");
  assert.equal(localNotdef.decode(Uint8Array.of(0x42)).cid, 9, "undefined code uses notdef CID");

  const inheritedNotdefOverride = await parseNativePdfFont(
    compositeFont(stream(`
      /GBT-EUC-H usecmap
      1 beginnotdefchar <00> 9 endnotdefchar
    `), cidFont("GB1", 6)),
    identityResolver
  );
  assert.equal(inheritedNotdefOverride.decode(Uint8Array.of(0)).cid, 9);
  assert.equal(inheritedNotdefOverride.decode(Uint8Array.of(1)).cid, 7716);

  await assert.rejects(
    parseNativePdfFont(
      compositeFont(name("90ms-RKSJ-H"), new Map([["Subtype", name("CIDFontType2")]])),
      identityResolver,
      { parserLimits: { maxCMapMappings: 10 } }
    ),
    hasPdfError("resource-limit", /mapping limit/i)
  );
}

async function testCidUnicodeFallbackAndRos() {
  const shiftJis = await parseNativePdfFont(
    compositeFont(name("90ms-RKSJ-H"), cidFont("Japan1", 7)),
    identityResolver
  );
  const shiftJisSpace = shiftJis.decode(Uint8Array.of(0x81, 0x40));
  assert.equal(shiftJisSpace.cid, 633);
  assert.equal(shiftJisSpace.unicode, "\u3000");

  const identityJapan = await parseNativePdfFont(
    compositeFont(name("Identity-H"), cidFont("Japan1", 7)),
    identityResolver
  );
  assert.equal(identityJapan.decode(Uint8Array.of(0x02, 0x79)).unicode, "\u3000");
  assert.equal(identityJapan.decode(Uint8Array.of(0x20, 0x67)).unicode, "XIII");
  assert.equal(identityJapan.decode(Uint8Array.of(0x04, 0x6d)).unicode, "\u9022\uDB40\uDD00");

  const explicitOverride = await parseNativePdfFont(new Map([
    ["Subtype", name("Type0")],
    ["BaseFont", name("ExplicitOverride")],
    ["Encoding", name("90ms-RKSJ-H")],
    ["DescendantFonts", [cidFont("Japan1", 7)]],
    ["ToUnicode", stream(`
      1 begincodespacerange <0000> <ffff> endcodespacerange
      1 beginbfchar <8140> <005a> endbfchar
    `)]
  ]), identityResolver);
  assert.equal(explicitOverride.decode(Uint8Array.of(0x81, 0x40)).unicode, "Z");

  const gbDiagnostics = [];
  const gb = await parseNativePdfFont(
    compositeFont(name("Identity-H"), cidFont("GB1", 6)),
    identityResolver,
    { onDiagnostic: (diagnostic) => gbDiagnostics.push(diagnostic) }
  );
  assert.notEqual(gb.decode(Uint8Array.of(0x76, 0x4b)).unicode, null);
  assert.equal(gb.decode(Uint8Array.of(0x76, 0x4c)).unicode, null);
  assert.equal(gbDiagnostics[0]?.code, "font.cid-unicode-fallback-partial");
  assert.equal(gb.diagnostics[0]?.details.mappingSupplement, 5);

  const korea = await parseNativePdfFont(
    compositeFont(name("Identity-H"), cidFont("Korea1", 2)),
    identityResolver
  );
  assert.equal(korea.decode(Uint8Array.of(0x20, 0x01)).unicode, null);
  assert.equal(korea.diagnostics[0]?.code, "font.cid-unicode-fallback-partial");
  assert.equal(korea.diagnostics[0]?.details.unmappedWithinRange, 276);

  for (const ordering of ["Manga1", "Japan2"]) {
    const unsupported = await parseNativePdfFont(
      compositeFont(name("Identity-H"), cidFont(ordering, 0)),
      identityResolver
    );
    assert.equal(unsupported.decode(Uint8Array.of(0, 1)).unicode, null);
    assert.equal(unsupported.diagnostics[0]?.code, "font.cid-unicode-fallback-unavailable");
    assert.equal(unsupported.diagnostics[0]?.details.ordering, ordering);
  }

  await assert.rejects(
    parseNativePdfFont(
      compositeFont(name("90ms-RKSJ-H"), cidFont("GB1", 6)),
      identityResolver
    ),
    hasPdfError("unsupported-font", /font-cid-system-info-mismatch/)
  );
  await assert.rejects(
    parseNativePdfFont(
      compositeFont(name("UniJIS-UTF16-H"), cidFont("Japan1", 6)),
      identityResolver
    ),
    hasPdfError("unsupported-font", /font-cid-system-info-supplement-mismatch/)
  );
  const embeddedJapanEncoding = stream(`
    /CIDSystemInfo 3 dict dup begin
      /Registry (Adobe) def
      /Ordering (Japan1) def
      /Supplement 7 def
    end def
    1 begincodespacerange <00> <ff> endcodespacerange
    1 begincidchar <41> 633 endcidchar
  `);
  const embeddedJapan = await parseNativePdfFont(
    compositeFont(embeddedJapanEncoding, cidFont("Japan1", 7)),
    identityResolver
  );
  assert.equal(embeddedJapan.decode(Uint8Array.of(0x41)).unicode, "\u3000");
  await assert.rejects(
    parseNativePdfFont(
      compositeFont(embeddedJapanEncoding, cidFont("GB1", 6)),
      identityResolver
    ),
    hasPdfError("unsupported-font", /font-cid-system-info-mismatch/)
  );
  await assert.rejects(
    parseNativePdfFont(new Map([
      ["Subtype", name("Type0")],
      ["Encoding", name("Identity-H")],
      ["DescendantFonts", [new Map([["Subtype", name("CIDFontType2")]])]]
    ]), identityResolver),
    hasPdfError("unsupported-font", /font-cid-system-info-missing/)
  );
  await assert.rejects(
    parseNativePdfFont(
      compositeFont(name("Identity-H"), cidFont("Japan1", 7)),
      identityResolver,
      { parserLimits: { maxCMapMappings: 100 } }
    ),
    hasPdfError("resource-limit", /font-cid-unicode-mapping-limit/)
  );
}

async function testUseCMapCyclesAndDepth() {
  const oneInheritedLevel = await loadFont(10, { parserLimits: { maxUseCMapDepth: 1 } });
  assert.equal(oneInheritedLevel.decode(Uint8Array.of(0x81, 1)).cid, 200);
  await assert.rejects(loadFont(30), hasPdfError("unsupported-font", /cycle/i));
  await assert.rejects(
    loadFont(40, { parserLimits: { maxUseCMapDepth: 1 } }),
    hasPdfError("resource-limit", /font-cmap-depth|maxUseCMapDepth/)
  );

  const inline = parseToUnicodeCMap(encoder.encode(`
    /Identity-H usecmap
    1 beginbfchar <0041> <0042> endbfchar
  `));
  assert.deepEqual(inline.decode(Uint8Array.of(0, 0x41)), {
    code: 0x41,
    byteLength: 2,
    unicode: "B"
  });

  const base = stream(`
    1 begincodespacerange <00> <ff> endcodespacerange
    2 beginbfchar <41> <0041> <42> <0042> endbfchar
  `);
  const derived = stream(`
    2 beginbfchar <41> <005a> <43> <0043> endbfchar
  `, new Map([["UseCMap", base]]));
  const layeredDictionary = simpleFont(name("WinAnsiEncoding"), "LayeredUnicode");
  layeredDictionary.set("ToUnicode", derived);
  const layered = await parseNativePdfFont(layeredDictionary, identityResolver);
  assert.equal(layered.decode(Uint8Array.of(0x41)).unicode, "Z");
  assert.equal(layered.decode(Uint8Array.of(0x42)).unicode, "B");
  assert.equal(layered.decode(Uint8Array.of(0x43)).unicode, "C");

  await assert.rejects(
    parseNativePdfFont(layeredDictionary, identityResolver, {
      parserLimits: { maxCMapBytes: base.bytes.length + derived.bytes.length - 1 }
    }),
    hasPdfError("resource-limit", /Aggregate CMap bytes/i)
  );
  await assert.rejects(
    parseNativePdfFont(layeredDictionary, identityResolver, {
      parserLimits: { maxCMapTokens: 14 }
    }),
    hasPdfError("resource-limit", /token count/i)
  );
}

async function testSimpleEncodingAndUnicodeSeparation() {
  const font = await loadFont(60);
  const mappedA = font.decode(Uint8Array.of(65));
  assert.equal(mappedA.glyphName, "Aacute");
  assert.equal(mappedA.glyphId, 65);
  assert.equal(mappedA.unicode, "Ω", "ToUnicode is semantic text, not a glyph selector");
  assert.equal(mappedA.width, 600);

  const mappedB = font.decode(Uint8Array.of(66));
  assert.equal(mappedB.glyphName, "uni0042");
  assert.equal(mappedB.unicode, "B");
  assert.equal(mappedB.width, 610);

  const macRoman = await parseNativePdfFont(simpleFont(name("MacRomanEncoding")), resolver);
  assert.equal(macRoman.decode(Uint8Array.of(0x80)).unicode, "Ä");
  assert.equal(macRoman.decode(Uint8Array.of(0xca)).unicode, " ");
  assert.equal(macRoman.decode(Uint8Array.of(0xdb)).unicode, "¤");

  const winAnsi = await parseNativePdfFont(simpleFont(name("WinAnsiEncoding")), resolver);
  assert.equal(winAnsi.decode(Uint8Array.of(0x81)).glyphName, "bullet");
  assert.equal(winAnsi.decode(Uint8Array.of(0x81)).unicode, "•");
  assert.equal(winAnsi.decode(Uint8Array.of(0xa0)).unicode, " ");
  assert.equal(winAnsi.decode(Uint8Array.of(0xad)).unicode, "-");

  const standard = await parseNativePdfFont(simpleFont(undefined, "Helvetica"), resolver);
  assert.equal(standard.decode(Uint8Array.of(39)).glyphName, "quoteright");
  assert.equal(standard.decode(Uint8Array.of(39)).unicode, "’");
  assert.equal(standard.decode(Uint8Array.of(96)).glyphName, "quoteleft");
  assert.equal(standard.decode(Uint8Array.of(96)).unicode, "‘");

  const macExpert = await parseNativePdfFont(
    simpleFont(name("MacExpertEncoding"), "FixtureExpert"),
    identityResolver
  );
  assert.equal(macExpert.decode(Uint8Array.of(33)).glyphName, "exclamsmall");
  assert.equal(macExpert.decode(Uint8Array.of(33)).unicode, "\uf721");
  assert.equal(macExpert.decode(Uint8Array.of(48)).unicode, "\uf730");

  const macExpertDifference = await parseNativePdfFont(simpleFont(new Map([
    ["BaseEncoding", name("MacExpertEncoding")],
    ["Differences", [33, name("Aacutesmall")]]
  ]), "FixtureExpert"), identityResolver);
  assert.equal(macExpertDifference.decode(Uint8Array.of(33)).unicode, "\uf7e1");

  const explicitSymbolEncoding = await parseNativePdfFont(
    simpleFont(name("WinAnsiEncoding"), "Symbol"),
    resolver
  );
  assert.equal(explicitSymbolEncoding.decode(Uint8Array.of(65)).unicode, "A");
  const builtInSymbolEncoding = await parseNativePdfFont(simpleFont(undefined, "Symbol"), resolver);
  assert.equal(builtInSymbolEncoding.decode(Uint8Array.of(65)).unicode, "Α");

  assert.equal(glyphNameToUnicode("uni00410042"), "AB");
  assert.equal(glyphNameToUnicode("u1F600"), "😀");
  assert.equal(glyphNameToUnicode("uniD800"), null);
  assert.equal(glyphNameToUnicode("uniDC00"), null);
}

async function testCidToGidBounds() {
  await assert.rejects(loadFont(70), hasPdfError("unsupported-font", /CIDToGIDMap.*bounds/i));

  const oversizedMap = stream(new Uint8Array((0x10000 * 2) + 1));
  await assert.rejects(
    parseNativePdfFont(compositeFont(name("Identity-H"), new Map([
      ["Subtype", name("CIDFontType2")],
      ["CIDToGIDMap", oversizedMap]
    ])), identityResolver),
    hasPdfError("unsupported-font", /CIDToGIDMap.*bounds/i)
  );

  const identity = await parseNativePdfFont(compositeFont(name("Identity-H"), new Map([
    ["Subtype", name("CIDFontType2")],
    ["CIDToGIDMap", name("Identity")]
  ])), identityResolver);
  assert.equal(identity.decode(Uint8Array.of(0xab, 0xcd)).glyphId, 0xabcd);
}

function testDirectCMapValidation() {
  const valid = parseToUnicodeCMap(encoder.encode(`
    2 begincodespacerange <00> <7f> <8100> <81ff> endcodespacerange
    3 beginbfchar <40> <> <41> <d83dde00> <42> <feff> endbfchar
    2 beginbfrange <43> <43> <> <8100> <8101> [<0061> <00620063>] endbfrange
  `));
  assert.equal(valid.decode(Uint8Array.of(0x40)).unicode, "", "empty destinations suppress text");
  assert.equal(valid.decode(Uint8Array.of(0x41)).unicode, "😀");
  assert.equal(valid.decode(Uint8Array.of(0x42)).unicode, "\ufeff", "FEFF is a Unicode value, not a BOM");
  assert.equal(valid.decode(Uint8Array.of(0x43)).unicode, "", "singleton empty ranges suppress text");
  assert.equal(valid.decode(Uint8Array.of(0x81, 0)).unicode, "a");
  assert.equal(valid.decode(Uint8Array.of(0x81, 1)).unicode, "bc");
  assert.equal(valid.decode(Uint8Array.of(0x44)).unicode, null);

  const longDestination = parseToUnicodeCMap(encoder.encode(`
    1 begincodespacerange <00> <ff> endcodespacerange
    1 beginbfchar <41> <${"0041".repeat(17)}> endbfchar
  `));
  assert.equal(longDestination.decode(Uint8Array.of(0x41)).unicode, "A".repeat(17));

  assert.throws(
    () => parseToUnicodeCMap(encoder.encode(`
      2 begincodespacerange <00> <7f> <70> <ff> endcodespacerange
    `)),
    hasPdfError("unsupported-font", /overlap/i)
  );
  assert.throws(
    () => parseToUnicodeCMap(encoder.encode(`
      2 begincodespacerange <00> <ff> <8100> <81ff> endcodespacerange
    `)),
    hasPdfError("unsupported-font", /overlap/i)
  );
  assert.throws(
    () => parseToUnicodeCMap(encoder.encode(`
      1 begincodespacerange <00> <ff> endcodespacerange
      2 beginbfrange <40> <42> <0040> <42> <43> <0062> endbfrange
    `)),
    hasPdfError("unsupported-font", /overlapping local Unicode mappings/i)
  );
  const genericCodespace = parseToUnicodeCMap(encoder.encode(`
    1 begincodespacerange <0000> <ffff> endcodespacerange
    1 beginbfchar <20> <0020> endbfchar
  `));
  assert.equal(
    genericCodespace.mappings.get("1:32"),
    " ",
    "ToUnicode mappings use the font Encoding's already-tokenized character code"
  );
  assert.deepEqual(genericCodespace.decode(Uint8Array.of(0x20)), {
    code: 0x20,
    byteLength: 1,
    unicode: " "
  });
  assert.throws(
    () => parseToUnicodeCMap(encoder.encode("1 beginbfchar <41> <0041> endbfchar")),
    hasPdfError("unsupported-font", /no declared or inherited codespace/i)
  );
  assert.throws(
    () => parseToUnicodeCMap(encoder.encode(`
      1 begincodespacerange <00> <ff> endcodespacerange
      1 beginbfchar <41> <d800> endbfchar
    `)),
    hasPdfError("unsupported-font", /unpaired high surrogate/i)
  );
  assert.throws(
    () => parseToUnicodeCMap(encoder.encode(`
      1 begincodespacerange <00> <ff> endcodespacerange
      1 beginbfchar <41> <dc00> endbfchar
    `)),
    hasPdfError("unsupported-font", /unpaired low surrogate/i)
  );
  assert.throws(
    () => parseToUnicodeCMap(encoder.encode(`
      1 begincodespacerange <00> <ff> endcodespacerange
      1 beginbfchar <> <0041> endbfchar
    `)),
    hasPdfError("unsupported-font", /one through four bytes/i)
  );
  assert.throws(
    () => parseToUnicodeCMap(encoder.encode(`
      1 begincodespacerange <00> <ff> endcodespacerange
      1 beginbfrange <41> <42> [<0041>] endbfrange
    `)),
    hasPdfError("unsupported-font", /array target|wrong length/i)
  );
  assert.throws(
    () => parseToUnicodeCMap(encoder.encode(`
      1 begincodespacerange <00000000> <ffffffff> endcodespacerange
      1 beginbfrange <00000000> <ffffffff> <0041> endbfrange
    `), { maxMappings: 4 }),
    hasPdfError("resource-limit", /mapping limit/i)
  );
  assert.throws(
    () => parseToUnicodeCMap(encoder.encode(`
      1 begincodespacerange <00> <ff> endcodespacerange
      1 begincidrange <00> <01> 65535 endcidrange
    `)),
    hasPdfError("unsupported-font", /cidrange target exceeds/i)
  );
  assert.throws(
    () => parseToUnicodeCMap(encoder.encode(`
      1 begincodespacerange <00> <ff> endcodespacerange
      1 begincidchar <41> 7 endcidchar
    `)),
    hasPdfError("unsupported-font", /ToUnicode CMap cannot contain CID mappings/i)
  );
  assert.throws(
    () => parseToUnicodeCMap(encoder.encode(`
      1 begincodespacerange <00> <ff> endcodespacerange
      1 beginnotdefrange <00> <ff> 0 endnotdefrange
    `)),
    hasPdfError("unsupported-font", /notdef/i)
  );
  assert.throws(
    () => parseToUnicodeCMap(encoder.encode(`
      1 begincodespacerange <00> <ff> endcodespacerange
      2 beginnotdefrange <00> <10> 1 <10> <20> 2 endnotdefrange
    `)),
    hasPdfError("unsupported-font", /overlapping.*notdef/i)
  );
  assert.throws(
    () => parseToUnicodeCMap(Uint8Array.of(0, 0), { maxBytes: 1 }),
    hasPdfError("resource-limit", /CMap bytes/i)
  );
  assert.throws(
    () => parseToUnicodeCMap(encoder.encode("1 begincodespacerange"), { maxTokens: 1 }),
    hasPdfError("resource-limit", /token count/i)
  );
  assert.throws(
    () => parseToUnicodeCMap(encoder.encode(`
      2 begincodespacerange <00> <7f> <8100> <81ff> endcodespacerange
    `), { maxCodeSpaceRanges: 1 }),
    hasPdfError("resource-limit", /codespace count/i)
  );
}

async function testUnsupportedAssetsAndLimits() {
  const cidRangeToUnicode = simpleFont(name("WinAnsiEncoding"));
  cidRangeToUnicode.set("ToUnicode", stream(`
    1 begincodespacerange <00> <ff> endcodespacerange
    1 begincidrange <41> <42> 7 endcidrange
  `));
  await assert.rejects(
    parseNativePdfFont(cidRangeToUnicode, identityResolver),
    hasPdfError("unsupported-font", /ToUnicode CMap cannot contain CID mappings/i)
  );

  const notdefToUnicode = simpleFont(name("WinAnsiEncoding"));
  notdefToUnicode.set("ToUnicode", stream(`
    1 begincodespacerange <00> <ff> endcodespacerange
    1 beginnotdefrange <00> <ff> 0 endnotdefrange
  `));
  await assert.rejects(
    parseNativePdfFont(notdefToUnicode, identityResolver),
    hasPdfError("unsupported-font", /ToUnicode CMap cannot contain notdef mappings/i)
  );

  await assert.rejects(
    parseNativePdfFont(compositeFont(stream(`
      1 begincodespacerange <00> <ff> endcodespacerange
      1 beginbfchar <41> <0041> endbfchar
    `)), identityResolver),
    hasPdfError("unsupported-font", /encoding CMap cannot contain Unicode mappings/i)
  );
  await assert.rejects(
    parseNativePdfFont(compositeFont(stream(`
      /WMode 0 def
      1 begincodespacerange <00> <ff> endcodespacerange
    `, new Map([["WMode", 1]]))), identityResolver),
    hasPdfError("unsupported-font", /conflicting \/WMode/i)
  );
  await assert.rejects(
    parseNativePdfFont(compositeFont(name("Adobe-Japan1-H")), identityResolver),
    hasPdfError("unsupported-font", /not bundled/i)
  );
  await assert.rejects(
    parseNativePdfFont(simpleFont(new Map([
      ["Type", name("Encoding")],
      ["BaseEncoding", name("WinAnsiEncoding")],
      ["Differences", [0, name("A"), 1]]
    ])), identityResolver, {
      parserLimits: { maxSimpleEncodingDifferences: 2 }
    }),
    hasPdfError("resource-limit", /font-encoding-differences-limit/)
  );
  await assert.rejects(
    parseNativePdfFont(simpleFont(new Map([
      ["BaseEncoding", name("WinAnsiEncoding")],
      ["Differences", [256, name("A")]]
    ])), identityResolver),
    hasPdfError("unsupported-font", /invalid character code/i)
  );
  await assert.rejects(
    parseNativePdfFont(compositeFont(name("Identity-V"), new Map([
      ["Subtype", name("CIDFontType2")],
      ["W2", [1, [-900, 300]]]
    ])), identityResolver),
    hasPdfError("unsupported-font", /vertical CID metric array is truncated/i)
  );
  await assert.rejects(
    parseNativePdfFont(compositeFont(name("Identity-H"), new Map([
      ["Subtype", name("CIDFontType2")],
      ["W", [0, 2, 500]]
    ])), identityResolver, {
      parserLimits: { maxCidMetricEntries: 2 }
    }),
    hasPdfError("resource-limit", /font-cid-metric-limit/)
  );
  assert.throws(
    () => parseToUnicodeCMap(encoder.encode("1 begincodespacerange <00> <ff> endcodespacerange"), {
      maxMappings: DEFAULT_NATIVE_PDF_FONT_PARSER_LIMITS.maxCMapMappings + 1
    }),
    RangeError
  );
}

async function loadFont(objectNumber, options) {
  return await parseNativePdfFont(await document.resolveDictionary(ref(objectNumber)), resolver, options);
}

function project(mapped) {
  return {
    code: mapped.code,
    codeByteLength: mapped.codeByteLength,
    cid: mapped.cid,
    glyphId: mapped.glyphId,
    unicode: mapped.unicode,
    width: mapped.width,
    verticalMetric: mapped.verticalMetric
  };
}

function simpleFont(encoding, baseFont = "FixtureSimple") {
  const dictionary = new Map([
    ["Subtype", name("TrueType")],
    ["BaseFont", name(baseFont)]
  ]);
  if (encoding !== undefined) dictionary.set("Encoding", encoding);
  return dictionary;
}

function compositeFont(encoding, descendant = cidFont("Japan1", 7)) {
  const resolvedDescendant = new Map(descendant);
  if (!resolvedDescendant.has("CIDSystemInfo")) {
    resolvedDescendant.set("CIDSystemInfo", cidSystemInfo("Japan1", 7));
  }
  return new Map([
    ["Subtype", name("Type0")],
    ["BaseFont", name("FixtureCID")],
    ["Encoding", encoding],
    ["DescendantFonts", [resolvedDescendant]]
  ]);
}

function cidFont(ordering, supplement, entries = []) {
  return new Map([
    ["Subtype", name("CIDFontType2")],
    ["CIDSystemInfo", cidSystemInfo(ordering, supplement)],
    ...entries
  ]);
}

function cidSystemInfo(ordering, supplement) {
  return new Map([
    ["Registry", pdfString("Adobe")],
    ["Ordering", pdfString(ordering)],
    ["Supplement", supplement]
  ]);
}

function pdfString(value) {
  return { kind: "string", bytes: encoder.encode(value), hex: false };
}

function name(value) {
  return { kind: "name", value };
}

function ref(objectNumber) {
  return { kind: "ref", objectNumber, generation: 0 };
}

function stream(bytes, dictionary = new Map()) {
  return {
    kind: "stream",
    dictionary,
    bytes: typeof bytes === "string" ? encoder.encode(bytes) : bytes
  };
}

function hasPdfError(code, evidence) {
  return (error) => error instanceof PdfError && error.code === code && (
    evidence === undefined || evidence.test(`${error.message} ${JSON.stringify(error.details ?? {})}`)
  );
}

function fixture() {
  const cidToGid = new Uint8Array((200 + 1) * 2);
  setGid(cidToGid, 5, 7);
  setGid(cidToGid, 100, 11);
  setGid(cidToGid, 101, 12);
  setGid(cidToGid, 102, 13);
  setGid(cidToGid, 200, 17);

  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>" },
      {
        number: 10,
        body: "<< /Type /Font /Subtype /Type0 /BaseFont /FixtureCID /Encoding 12 0 R /DescendantFonts [11 0 R] /ToUnicode 14 0 R >>"
      },
      {
        number: 11,
        body: "<< /Subtype /CIDFontType2 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 7 >> /DW 1000 /W [5 [500] 100 102 700 200 [900]] /DW2 [880 -1000] /W2 [5 [-800 250 700] 100 102 -900 300 750 200 [-1100 400 800]] /CIDToGIDMap 16 0 R >>"
      },
      {
        number: 12,
        body: tinyPdfStream("/UseCMap 13 0 R /WMode 1 /Unused 99 0 R", `
          /WMode 1 def
          2 begincidchar <8101> 200 <42> 500 endcidchar
        `)
      },
      {
        number: 13,
        body: tinyPdfStream("", `
          /WMode 1 def
          2 begincodespacerange <00> <7f> <8100> <81ff> endcodespacerange
          1 begincidchar <41> 5 endcidchar
          1 begincidrange <8100> <8102> 100 endcidrange
        `)
      },
      {
        number: 14,
        body: tinyPdfStream("/UseCMap 15 0 R /Unused 99 0 R", `
          1 beginbfrange <8101> <8102> [<0062> <00630064>] endbfrange
        `)
      },
      {
        number: 15,
        body: tinyPdfStream("", `
          2 begincodespacerange <00> <7f> <8100> <81ff> endcodespacerange
          1 beginbfchar <41> <0041> endbfchar
          1 beginbfrange <8100> <8101> <d83dde00> endbfrange
        `)
      },
      { number: 16, body: tinyPdfStream("", cidToGid) },
      {
        number: 20,
        body: "<< /Type /Font /Subtype /Type0 /BaseFont /IdentityVertical /Encoding /Identity-V /DescendantFonts [21 0 R] >>"
      },
      {
        number: 21,
        body: "<< /Subtype /CIDFontType2 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 7 >> /DW 900 /CIDToGIDMap /Identity >>"
      },
      {
        number: 30,
        body: "<< /Type /Font /Subtype /Type0 /BaseFont /Cycle /Encoding 32 0 R /DescendantFonts [31 0 R] >>"
      },
      { number: 31, body: "<< /Subtype /CIDFontType2 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 7 >> >>" },
      { number: 32, body: tinyPdfStream("/UseCMap 33 0 R", "") },
      { number: 33, body: tinyPdfStream("/UseCMap 32 0 R", "") },
      {
        number: 40,
        body: "<< /Type /Font /Subtype /Type0 /BaseFont /Deep /Encoding 41 0 R /DescendantFonts [44 0 R] >>"
      },
      { number: 41, body: tinyPdfStream("/UseCMap 42 0 R", "") },
      { number: 42, body: tinyPdfStream("/UseCMap 43 0 R", "") },
      {
        number: 43,
        body: tinyPdfStream("", "1 begincodespacerange <00> <ff> endcodespacerange")
      },
      { number: 44, body: "<< /Subtype /CIDFontType2 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 7 >> >>" },
      {
        number: 50,
        body: "<< /Type /Font /Subtype /Type0 /BaseFont /Horizontal /Encoding /Identity-H /DescendantFonts [51 0 R] >>"
      },
      {
        number: 51,
        body: "<< /Subtype /CIDFontType2 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 7 >> /DW2 98 0 R /W2 99 0 R /CIDToGIDMap /Identity >>"
      },
      {
        number: 60,
        body: "<< /Type /Font /Subtype /TrueType /BaseFont /FixtureSimple /FirstChar 65 /LastChar 66 /Widths [600 610] /Encoding 61 0 R /ToUnicode 64 0 R >>"
      },
      {
        number: 61,
        body: "<< /Type /Encoding /BaseEncoding 62 0 R /Differences 63 0 R /Unused 99 0 R >>"
      },
      { number: 62, body: "/WinAnsiEncoding" },
      { number: 63, body: "[65 /Aacute /uni0042]" },
      {
        number: 64,
        body: tinyPdfStream("/Unused 99 0 R", `
          1 begincodespacerange <00> <ff> endcodespacerange
          1 beginbfchar <41> <03a9> endbfchar
        `)
      },
      {
        number: 70,
        body: "<< /Type /Font /Subtype /Type0 /BaseFont /OddMap /Encoding /Identity-H /DescendantFonts [71 0 R] >>"
      },
      { number: 71, body: "<< /Subtype /CIDFontType2 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 7 >> /CIDToGIDMap 72 0 R >>" },
      { number: 72, body: tinyPdfStream("", Uint8Array.of(0, 1, 2)) }
    ]
  });
}

function setGid(bytes, cid, gid) {
  bytes[cid * 2] = gid >>> 8;
  bytes[cid * 2 + 1] = gid & 0xff;
}
