import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

const { NativeCffFont } = await import("../src/pdf/nativeCff.ts");
const { NativeSfntFont, parseNativePdfFont } = await import("../src/pdf/nativeFont.ts");
const { PdfError } = await import("../src/pdf/nativeTypes.ts");

function testCffStructureAndType2Outlines() {
  const bytes = buildCffFixture();
  const font = NativeCffFont.parse(bytes);

  assert.equal(font.unitsPerEm, 1000);
  assert.equal(font.numGlyphs, 5);
  assert.deepEqual(font.glyphNames, [".notdef", "A", "acute", "Aacute", "fixtureGlyph"]);
  assert.equal(font.glyphIdForName("A"), 1);
  assert.equal(font.glyphIdForName("missing"), 0);
  assert.equal(font.builtInGlyphNames[65], "A");
  assert.equal(font.builtInGlyphNames[194], "acute");
  assert.equal(font.builtInGlyphNames[193], "Aacute");
  assert.equal(font.builtInGlyphNames[66], "fixtureGlyph");

  const a = font.getGlyphOutline(1);
  assert.equal(a.advanceWidth, 600, "nominalWidthX plus the explicit width delta");
  assert.deepEqual(a.commands, [
    { kind: "move", x: 100, y: 0 },
    { kind: "line", x: 200, y: 0 },
    { kind: "line", x: 200, y: 100 },
    {
      kind: "cubic",
      control1X: 250,
      control1Y: 100,
      control2X: 300,
      control2Y: 200,
      x: 350,
      y: 200
    },
    { kind: "close" }
  ]);
  assert.deepEqual(a.bounds, [100, 0, 350, 200]);
  assert.strictEqual(font.getGlyphOutline(1), a, "decoded outlines are cached");
  assert(Object.isFrozen(a));
  assert(Object.isFrozen(a.commands));

  const composite = font.getGlyphOutline(3);
  assert.equal(composite.advanceWidth, 600);
  assert.deepEqual(composite.bounds, [70, 0, 350, 200]);
  assert.deepEqual(composite.commands.slice(-3), [
    { kind: "move", x: 70, y: 100 },
    { kind: "line", x: 70, y: 150 },
    { kind: "close" }
  ], "endchar seac appends the translated accent outline");

  const flex = font.getGlyphOutline(4);
  assert.equal(flex.commands.filter((command) => command.kind === "cubic").length, 2);
  assert.deepEqual(flex.bounds, [0, 0, 90, 50]);
}

function testBaseFontBlendIsNotMultipleMaster() {
  // Top DICT 12 23 is BaseFontBlend, a delta left behind by Multiple Master
  // tooling. It carries no interpolation state and no blend axes: the glyphs
  // stay exactly the ones in CharStrings. Rejecting it as a Multiple Master
  // font discards documents whose outlines are perfectly ordinary.
  const baseline = NativeCffFont.parse(buildCffFixture());
  const blended = NativeCffFont.parse(buildCffFixture({
    topDictExtra: concat(dictInteger(408), dictInteger(-397), Uint8Array.of(12, 23))
  }));
  assert.equal(blended.numGlyphs, baseline.numGlyphs);
  assert.deepEqual(blended.glyphNames, baseline.glyphNames);
  assert.deepEqual(blended.builtInGlyphNames, baseline.builtInGlyphNames);
  for (let glyphId = 0; glyphId < baseline.numGlyphs; glyphId += 1) {
    assert.deepEqual(
      blended.getGlyphOutline(glyphId),
      baseline.getGlyphOutline(glyphId),
      `BaseFontBlend must preserve glyph ${glyphId}'s commands, bounds, width, and side bearing`
    );
  }
}

function testLatin1StringsAreAccepted() {
  // Producers put Latin-1 text such as a copyright sign into Notice or
  // FullName strings although CFF calls for ASCII.
  const baseline = NativeCffFont.parse(buildCffFixture());
  const latin1 = NativeCffFont.parse(buildCffFixture({
    extraStrings: [Uint8Array.of(0xa9, 0x20, 0x32, 0x30, 0x31, 0x39), Uint8Array.of(0x00, 0x7f, 0xff)]
  }));
  assert.deepEqual(latin1.glyphNames, baseline.glyphNames);
  assert.deepEqual(latin1.getGlyphOutline(1), baseline.getGlyphOutline(1));
}

function testPredefinedExpertCharsetsAndEncoding() {
  const emptyGlyph = type2(["endchar"]);
  const expert = NativeCffFont.parse(buildCffFixture({
    charStrings: Array(166).fill(emptyGlyph), predefinedCharset: 1, predefinedEncoding: 1
  }));
  assert.equal(expert.numGlyphs, 166);
  assert.deepEqual(expert.glyphNames.slice(0, 5),
    [".notdef", "space", "exclamsmall", "Hungarumlautsmall", "dollaroldstyle"]);
  assert.equal(expert.glyphNames[15], "fraction");
  assert.equal(expert.glyphNames[46], "fi");
  assert.equal(expert.glyphNames[165], "Ydieresissmall");
  for (const [code, name] of [[32, "space"], [48, "zerooldstyle"], [87, "fi"],
    [97, "Asmall"], [188, "onequarter"], [201, "onesuperior"], [255, "Ydieresissmall"]]) {
    assert.equal(expert.builtInGlyphNames[code], name);
    assert.notEqual(expert.glyphIdForName(name), 0);
  }
  for (const code of [0, 31, 35, 64, 70, 92, 127, 160, 164, 198, 199]) {
    assert.equal(expert.builtInGlyphNames[code], null, `Expert code ${code} is unassigned`);
  }
  const subset = NativeCffFont.parse(buildCffFixture({
    charStrings: Array(87).fill(emptyGlyph), predefinedCharset: 2, predefinedEncoding: 1
  }));
  assert.deepEqual(subset.glyphNames.slice(0, 6),
    [".notdef", "space", "dollaroldstyle", "dollarsuperior", "parenleftsuperior", "parenrightsuperior"]);
  assert.equal(subset.glyphNames[86], "commainferior");
  assert.equal(subset.builtInGlyphNames[36], "dollaroldstyle");
  assert.equal(subset.builtInGlyphNames[33], null, "ExpertEncoding does not invent glyphs outside ExpertSubset");
  assert.equal(subset.builtInGlyphNames[97], null);
  for (const [predefinedCharset, count] of [[0, 230], [1, 167], [2, 88]]) {
    expectPdf(() => NativeCffFont.parse(buildCffFixture({
      charStrings: Array(count).fill(emptyGlyph), predefinedCharset, predefinedEncoding: 1
    })), "unsupported-font", /charset.*shorter/i);
  }
}

function testSeededRandomAndStackOperators() {
  const random = { bytes: [12, 23] }, mul = { bytes: [12, 24] };
  const direct = type2([0, 0, "rmoveto", random, 100, mul, random, 100, mul, "rlineto", "endchar"]);
  const withSeed = seed => buildCffFixture({
    aCharString: direct, privateExtra: concat(dictReal(seed), Uint8Array.of(12, 19))
  });
  const baseline = NativeCffFont.parse(withSeed(42)).getGlyphOutline(1);
  const line = baseline.commands[1];
  assert.equal(line.kind, "line");
  assert(line.x > 0 && line.x <= 100 && line.y > 0 && line.y <= 100);
  assert.notEqual(line.x, line.y, "each random operator advances its state");
  assert.deepEqual(NativeCffFont.parse(withSeed(42)).getGlyphOutline(1), baseline,
    "fresh parses produce exactly repeatable vector geometry");
  assert.notDeepEqual(NativeCffFont.parse(withSeed(43)).getGlyphOutline(1), baseline,
    "initialRandomSeed affects the resulting outline");
  assert.notDeepEqual(NativeCffFont.parse(withSeed(42.25)).getGlyphOutline(1), baseline,
    "a fractional seed is retained rather than silently truncated");
  const subroutine = NativeCffFont.parse(buildCffFixture({
    privateExtra: concat(dictInteger(42), Uint8Array.of(12, 19)),
    aCharString: type2([0, 0, "rmoveto", random, 100, mul, -107, "callsubr", "rlineto", "endchar"]),
    localSubrs: [type2([random, 100, mul, "return"])]
  }));
  assert.deepEqual(subroutine.getGlyphOutline(1), baseline, "subroutines share the glyph's PRNG state");
  const order = NativeCffFont.parse(withSeed(42));
  order.getGlyphOutline(4);
  assert.deepEqual(order.getGlyphOutline(1), baseline, "other glyph evaluation cannot change random geometry");
  const negativeIndex = NativeCffFont.parse(buildCffFixture({
    aCharString: type2([0, 0, "rmoveto", 20, -5, { bytes: [12, 29] }, "rlineto", "endchar"])
  }));
  assert.deepEqual(negativeIndex.getGlyphOutline(1).commands[1], { kind: "line", x: 20, y: 20 },
    "negative Type 2 index copies the top stack value, per Adobe TN 5177 section 4.4");
  expectPdf(() => NativeCffFont.parse(withSeed(42), { maxType2Operators: 2 }).getGlyphOutline(1),
    "resource-limit", /operator/i);
  expectPdf(() => NativeCffFont.parse(buildCffFixture({
    aCharString: type2([...Array(49).fill(random), "endchar"])
  })).getGlyphOutline(1), "unsupported-font", /stack.*48/i);
  expectPdf(() => NativeCffFont.parse(buildCffFixture({
    aCharString: type2([20, 1, { bytes: [12, 29] }, "endchar"])
  })).getGlyphOutline(1), "unsupported-font", /index.*stack/i);
  expectPdf(() => NativeCffFont.parse(buildCffFixture({
    privateExtra: concat(dictInteger(1), dictInteger(2), Uint8Array.of(12, 19))
  })), "unsupported-font", /initialRandomSeed/i);
}

function testSyntheticFontSets() {
  const bytes = buildSyntheticCffFixture();
  expectPdf(() => NativeCffFont.parse(bytes), "unsupported-font", /unambiguous.*name/i);
  expectPdf(() => NativeCffFont.parse(bytes, {}, "Missing"), "unsupported-font", /unambiguous.*name/i);
  const base = NativeCffFont.parse(bytes, {}, "Base");
  const synthetic = NativeCffFont.parse(bytes, {}, "Synthetic");
  assert.deepEqual(synthetic.glyphNames, base.glyphNames, "synthetic charset is inherited from its base");
  assert.equal(base.builtInGlyphNames[65], "A");
  assert.equal(synthetic.builtInGlyphNames[66], "A", "synthetic Encoding overrides the base encoding");
  assert.equal(synthetic.builtInGlyphNames[65], null);
  assert.deepEqual(synthetic.getGlyphOutline(1).bounds, [20, 0, 140, 100]);
  assert.deepEqual(base.getGlyphOutline(1).bounds, [0, 0, 100, 100]);
  assert.equal(synthetic.getGlyphOutline(1).advanceWidth, 600, "synthetic glyph inherits Private DICT width");
  assert.deepEqual(NativeCffFont.parse(bytes, {}, "ABCDEF+Synthetic").getGlyphOutline(1),
    synthetic.getGlyphOutline(1), "PDF subset prefixes do not hide a unique FontSet name");
  assert.deepEqual(NativeCffFont.parse(buildCffFixture(), {}, "RenamedSubset").glyphNames,
    NativeCffFont.parse(buildCffFixture()).glyphNames, "a single font remains unambiguous despite renaming");
  const inherited = NativeCffFont.parse(buildSyntheticCffFixture({ omitMatrix: true, omitEncoding: true }), {}, "Synthetic");
  assert.deepEqual(inherited.getGlyphOutline(1), base.getGlyphOutline(1),
    "an omitted synthetic FontMatrix inherits the base matrix");
  assert.deepEqual(inherited.builtInGlyphNames, base.builtInGlyphNames,
    "an omitted synthetic Encoding inherits the base encoding");
  const ambiguous = buildSyntheticCffFixture({ names: ["AAAAAA+Synthetic", "BBBBBB+Synthetic"] });
  expectPdf(() => NativeCffFont.parse(ambiguous, {}, "Synthetic"), "unsupported-font", /unambiguous/i);
  assert.deepEqual(NativeCffFont.parse(ambiguous, {}, "BBBBBB+Synthetic").getGlyphOutline(1),
    synthetic.getGlyphOutline(1), "an exact name wins over ambiguous subset-stripped names");
  for (const options of [{ baseIndex: 1 }, { baseIndex: 2 }, { baseIndex: -1 }, { baseIsSynthetic: true },
    { baseIsCid: true }, { syntheticHasPrivate: true }, { syntheticNotFirst: true }]) {
    expectPdf(() => NativeCffFont.parse(buildSyntheticCffFixture(options), {}, "Synthetic"),
      "unsupported-font", /synthetic|SyntheticBase/i);
  }
}

function testCancellation() {
  const controller = new AbortController();
  controller.abort();
  expectPdf(() => NativeCffFont.parse(buildCffFixture(), {}, undefined, controller.signal), "aborted", /aborted/i);
  const font = NativeCffFont.parse(buildCffFixture());
  font.getGlyphOutline(1);
  expectPdf(() => font.getGlyphOutline(1, controller.signal), "aborted", /aborted/i);
  let polls = 0;
  const duringExecution = { get aborted() { return ++polls === 12; }, reason: controller.signal.reason };
  expectPdf(() => NativeCffFont.parse(buildCffFixture()).getGlyphOutline(1, duringExecution),
    "aborted", /aborted/i);
}

function testApproximationDiagnosticsAndUnsupportedMasterPrograms() {
  const baseline = NativeCffFont.parse(buildCffFixture());
  assert.deepEqual(baseline.diagnostics, []);
  const approximate = NativeCffFont.parse(buildCffFixture({
    topDictExtra: concat(dictInteger(2), Uint8Array.of(12, 5), dictInteger(392), Uint8Array.of(12, 21)),
    extraStrings: [ascii("/SomeFontBehavior 1 def")]
  }));
  assert.deepEqual(approximate.getGlyphOutline(1), baseline.getGlyphOutline(1),
    "unsupported font-level behavior preserves usable outlines instead of refusing the font");
  assert.deepEqual(approximate.diagnostics.map(d => d.code),
    ["font.cff-paint-type-approximation", "font.cff-postscript-approximation"]);
  assert(approximate.diagnostics.every(d => d.severity === "warning"));
  assert(Object.isFrozen(approximate.diagnostics) && approximate.diagnostics.every(Object.isFrozen));
  const emptyPostScript = NativeCffFont.parse(buildCffFixture({
    topDictExtra: concat(dictInteger(0), Uint8Array.of(12, 5), dictInteger(392), Uint8Array.of(12, 21)),
    extraStrings: [ascii(" \n\t")]
  }));
  assert.deepEqual(emptyPostScript.diagnostics, [], "empty embedded PostScript and normal PaintType need no warning");
  const invalidPostScriptSid = NativeCffFont.parse(buildCffFixture({
    topDictExtra: concat(dictInteger(999), Uint8Array.of(12, 21))
  }));
  assert.equal(invalidPostScriptSid.diagnostics[0].code, "font.cff-postscript-approximation");
  assert.deepEqual(invalidPostScriptSid.getGlyphOutline(1), baseline.getGlyphOutline(1));
  for (const bytes of [[16], [12, 8], [12, 13]]) {
    const font = NativeCffFont.parse(buildCffFixture({ aCharString: Uint8Array.of(...bytes, 14) }));
    assert.throws(() => font.getGlyphOutline(1), error => {
      assert(error instanceof PdfError);
      assert.equal(error.code, "unsupported-font");
      assert.equal(error.details.reason, "cff-multiple-master-not-supported");
      assert.match(error.message, /Multiple Master/);
      return true;
    });
  }
}

async function testPdfSyntheticFontSetSelection() {
  const name = value => ({ kind: "name", value });
  const font = await parseNativePdfFont(new Map([
    ["Subtype", name("Type1")], ["BaseFont", name("ABCDEF+Synthetic")],
    ["FirstChar", 66], ["Widths", [600]],
    ["FontDescriptor", new Map([["Flags", 32], ["FontFile3", {
      kind: "stream", dictionary: new Map([["Subtype", name("Type1C")]]), bytes: buildSyntheticCffFixture()
    }]])]
  ]), { async resolveValue(value) { return value; }, async decodeStream(value) { return value.bytes; } });
  const mapped = font.decode(Uint8Array.of(66));
  assert.equal(mapped.glyphName, "A");
  assert.equal(mapped.glyphId, 1);
  assert.equal(mapped.unicode, "A");
  assert.deepEqual(font.getGlyphOutline(mapped.glyphId).bounds, [20, 0, 140, 100]);
  assert.equal(font.substitution, null);
}

async function testCffDiagnosticPropagation() {
  const approximate = buildCffFixture({
    topDictExtra: concat(dictInteger(2), Uint8Array.of(12, 5), dictInteger(392), Uint8Array.of(12, 21)),
    extraStrings: [ascii("/SomeFontBehavior 1 def")]
  });
  const unknownOtherSubr = type1([0, 500, "hsbw", 10, 20, 2, 9, "callothersubr", "pop", "pop",
    "rmoveto", 40, 0, "rlineto", "endchar"]);
  const type1Cff = buildCffFixture({
    topDictExtra: concat(dictInteger(1), Uint8Array.of(12, 6)),
    charStrings: [type1([0, 500, "hsbw", "endchar"]), ...Array(4).fill(unknownOtherSubr)], localSubrs: []
  });
  const direct = NativeCffFont.parse(type1Cff);
  assert.deepEqual(direct.diagnostics, []);
  assert.deepEqual(direct.getGlyphOutline(1).commands[0], { kind: "move", x: 10, y: 20 });
  direct.getGlyphOutline(2);
  assert.deepEqual(direct.diagnostics.map(d => d.code), ["font.type1-othersubr-approximated"],
    "unknown OtherSubr behavior is diagnosed once per extension across glyphs");

  const name = value => ({ kind: "name", value });
  const resolver = { async resolveValue(value) { return value; }, async decodeStream(value) { return value.bytes; } };
  for (const [program, expectedCodes] of [
    [approximate, ["font.cff-paint-type-approximation", "font.cff-postscript-approximation"]],
    [type1Cff, ["font.type1-othersubr-approximated"]]
  ]) {
    for (const openType of [false, true]) {
      const events = [];
      const font = await parseNativePdfFont(new Map([
        ["Subtype", name("Type1")], ["BaseFont", name("FixtureCff")],
        ["Encoding", new Map([["BaseEncoding", name("WinAnsiEncoding")], ["Differences", [65, name("A")]]])],
        ["FontDescriptor", new Map([["Flags", 32], ["FontFile3", {
          kind: "stream", dictionary: new Map([["Subtype", name(openType ? "OpenType" : "Type1C")]]),
          bytes: openType ? wrapOpenTypeCff(program) : program
        }]])]
      ]), resolver, { onDiagnostic: diagnostic => events.push(diagnostic) });
      const mapped = font.decode(Uint8Array.of(65));
      font.getGlyphOutline(mapped.glyphId);
      font.getGlyphOutline(mapped.glyphId);
      assert.deepEqual(font.diagnostics.map(d => d.code), expectedCodes,
        `${openType ? "OpenType" : "direct"} CFF warnings survive both eager and lazy font parsing`);
      assert.deepEqual(events.map(d => d.code), expectedCodes,
        `${openType ? "OpenType" : "direct"} CFF diagnostic events are delivered once`);
    }
  }
}

function testCffType1CharStrings() {
  const options = {
    topDictExtra: concat(dictInteger(1), Uint8Array.of(12, 6)),
    charStrings: [
      type1([0, 500, "hsbw", "endchar"]),
      type1([20, 600, "hsbw", 0, 0, "rmoveto", 0, "callsubr", 100, 0, "rlineto", "closepath", "endchar"]),
      type1([0, 100, "hsbw", 0, 0, "rmoveto", 10, 20, "rlineto", "endchar"]),
      type1([20, 600, "hsbw", 0, 30, 150, 65, 194, "seac"]),
      type1([15, 25, 600, 20, "sbw", 0, 0, "rmoveto", 30, 40, "rlineto", "endchar"])
    ],
    localSubrs: [type1([0, 100, "rlineto", "return"])]
  };
  const font = NativeCffFont.parse(buildCffFixture(options));
  const a = font.getGlyphOutline(1);
  assert.equal(a.advanceWidth, 600, "Type 1 hsbw width is not adjusted by Type 2 nominalWidthX");
  assert.deepEqual(a.commands, [
    { kind: "move", x: 20, y: 0 }, { kind: "line", x: 20, y: 100 },
    { kind: "line", x: 120, y: 100 }, { kind: "close" }
  ], "plaintext Type 1 charstrings use zero-biased CFF local subroutines");
  assert.deepEqual(font.getGlyphOutline(3).commands.slice(-3), [
    { kind: "move", x: 50, y: 150 }, { kind: "line", x: 60, y: 170 }, { kind: "close" }
  ], "Type 1 seac applies the accent side bearing correction and resolves the CFF charset");
  assert.deepEqual(font.getGlyphOutline(3).bounds, [20, 0, 120, 170]);
  assert.deepEqual(font.getGlyphOutline(4).bounds, [15, 25, 45, 65], "Type 1 sbw keeps both side bearing coordinates");
  const transformed = NativeCffFont.parse(buildCffFixture({ ...options,
    fontMatrix: [0.001, 0, 0.0005, 0.001, 0.01, 0]
  }));
  assert.equal(transformed.getGlyphOutline(4).advanceWidth, 610,
    "FontMatrix transforms the complete Type 1 advance vector, without translating it");
  assert.deepEqual(transformed.getGlyphOutline(1).commands[0], { kind: "move", x: 30, y: 0 });
  expectPdf(() => NativeCffFont.parse(buildCffFixture(options), { maxType2Operators: 10 }).getGlyphOutline(3),
    "resource-limit", /operator/i, "composite components share the caller's execution budget");
  const repeated = { ...options, charStrings: [...options.charStrings] };
  repeated.charStrings[1] = type1([0, 600, "hsbw", 0, 0, "rmoveto", 0, "callsubr", 0, "callsubr", "endchar"]);
  expectPdf(() => NativeCffFont.parse(buildCffFixture(repeated), { maxType2SubrCalls: 1 }).getGlyphOutline(1),
    "resource-limit", /subr.*calls/i);
  const recursive = { ...options, localSubrs: [type1([0, "callsubr", "return"])] };
  expectPdf(() => NativeCffFont.parse(buildCffFixture(recursive)).getGlyphOutline(1),
    "unsupported-font", /cycle/i);
  const malformed = { ...options, charStrings: [options.charStrings[0], type1([0, 600, "hsbw", 2, "callsubr", "endchar"])] };
  expectPdf(() => NativeCffFont.parse(buildCffFixture({ ...malformed, predefinedCharset: 0, predefinedEncoding: 0 })).getGlyphOutline(1),
    "unsupported-font", /subroutine.*missing|subroutine.*bounds/i);
}

function testFontMatrixNormalization() {
  const font = NativeCffFont.parse(buildCffFixture({
    fontMatrix: [0.002, 0, 0, 0.003, 0.01, -0.02]
  }));
  const outline = font.getGlyphOutline(1);

  // NativeTextCompiler scales every retained outline by fontSize/unitsPerEm.
  // Baking FontMatrix * 1000 here preserves PDF's glyph-space-to-text-space
  // transform while keeping the shared native ABI in 1000 units.
  assert.equal(font.unitsPerEm, 1000);
  assert.deepEqual(outline.commands[0], { kind: "move", x: 210, y: -20 });
  assert.deepEqual(outline.commands[1], { kind: "line", x: 410, y: -20 });
  assert.equal(outline.advanceWidth, 1200);
  assert.deepEqual(outline.bounds, [210, -20, 710, 580]);
}

async function testPdfFontSelectionIsSeparateFromToUnicode() {
  const bytes = buildCffFixture();
  const name = (value) => ({ kind: "name", value });
  const stream = (streamBytes, dictionary = new Map()) => ({
    kind: "stream",
    dictionary,
    bytes: streamBytes
  });
  const embedded = stream(bytes, new Map([["Subtype", name("Type1C")]]));
  const descriptor = new Map([
    ["FontName", name("FixtureCff")],
    ["Flags", 32],
    ["FontBBox", [0, -20, 710, 580]],
    ["Ascent", 800],
    ["Descent", -200],
    ["MissingWidth", 0],
    ["FontFile3", embedded]
  ]);
  const toUnicode = stream(new TextEncoder().encode(`
    1 begincodespacerange <00> <ff> endcodespacerange
    1 beginbfchar <41> <03a9> endbfchar
  `));
  const dictionary = new Map([
    ["Type", name("Font")],
    ["Subtype", name("Type1")],
    ["BaseFont", name("FixtureCff")],
    ["FirstChar", 65],
    ["Widths", [600]],
    ["Encoding", new Map([
      ["BaseEncoding", name("WinAnsiEncoding")],
      ["Differences", [65, name("A")]]
    ])],
    ["ToUnicode", toUnicode],
    ["FontDescriptor", descriptor]
  ]);
  const resolver = {
    async resolveValue(value) { return value; },
    async decodeStream(value) { return value.bytes; }
  };

  const font = await parseNativePdfFont(dictionary, resolver);
  assert.equal(font.sfnt, null);
  assert(font.cff instanceof NativeCffFont);
  assert.equal(font.unitsPerEm, 1000);
  const mapped = font.decode(Uint8Array.of(65));
  assert.equal(mapped.glyphId, 1, "PDF Encoding selects the CFF glyph by name");
  assert.equal(mapped.glyphName, "A");
  assert.equal(mapped.unicode, "Ω", "ToUnicode controls text semantics only");
  assert.equal(mapped.width, 600);
  assert.deepEqual(font.getGlyphOutline(mapped.glyphId).bounds, [100, 0, 350, 200]);
}

async function testOpenTypeCffOutlines() {
  const bytes = wrapOpenTypeCff(buildCffFixture());
  const sfnt = NativeSfntFont.parse(bytes);
  assert.equal(sfnt.outlineFormat, "cff");
  assert.equal(sfnt.unitsPerEm, 2000);
  assert.equal(sfnt.mapCodePoint(65), 1);
  const outline = sfnt.getGlyphOutline(1);
  assert.deepEqual(outline.bounds, [200, 0, 700, 400], "CFF outlines scale to the sfnt's unitsPerEm");
  assert.deepEqual(outline.commands[0], { kind: "move", x: 200, y: 0 });
  assert.deepEqual(outline.commands[3], {
    kind: "cubic", control1X: 500, control1Y: 200, control2X: 600, control2Y: 400, x: 700, y: 400
  });
  assert.equal(outline.advanceWidth, 1500, "OpenType hmtx metrics override CFF charstring widths");
  assert.equal(outline.leftSideBearing, 20);
  assert.strictEqual(sfnt.getGlyphOutline(1), outline);

  const name = value => ({ kind: "name", value });
  const embedded = { kind: "stream", dictionary: new Map([["Subtype", name("OpenType")]]), bytes };
  const dictionary = new Map([
    ["Subtype", name("Type1")], ["BaseFont", name("FixtureOpenTypeCff")],
    ["Encoding", name("WinAnsiEncoding")],
    ["FontDescriptor", new Map([["Flags", 32], ["FontFile3", embedded]])],
    ["ToUnicode", { kind: "stream", dictionary: new Map(), bytes: new TextEncoder().encode(`
      1 begincodespacerange <00> <ff> endcodespacerange
      1 beginbfchar <41> <03a9> endbfchar
    `) }]
  ]);
  const resolver = {
    async resolveValue(value) { return value; },
    async decodeStream(value) { return value.bytes; }
  };
  const font = await parseNativePdfFont(dictionary, resolver);
  const mapped = font.decode(Uint8Array.of(65));
  assert.equal(mapped.unicode, "Ω");
  assert.equal(mapped.glyphId, 1, "PDF Encoding selects the sfnt glyph independently from ToUnicode");
  assert.equal(mapped.width, 750);
  assert.deepEqual(font.getGlyphOutline(mapped.glyphId).commands, outline.commands);

  const limited = NativeSfntFont.parse(bytes, 0, { maxCffBytes: 1 });
  expectPdf(() => limited.getGlyphOutline(1), "resource-limit", /byte limit/i);
  const pdfLimited = await parseNativePdfFont(dictionary, resolver, { parserLimits: { maxCffBytes: 1 } });
  expectPdf(() => pdfLimited.getGlyphOutline(1), "resource-limit", /byte limit/i);
  const mismatched = NativeSfntFont.parse(wrapOpenTypeCff(buildCffFixture(), 4));
  expectPdf(() => mismatched.getGlyphOutline(1), "unsupported-font", /count disagrees/i);
}

function wrapOpenTypeCff(cffBytes, numGlyphs = 5) {
  const head = new Uint8Array(54);
  const headView = new DataView(head.buffer);
  headView.setUint16(18, 2000);
  headView.setInt16(36, 0);
  headView.setInt16(38, -40);
  headView.setInt16(40, 1420);
  headView.setInt16(42, 1160);
  const maxp = new Uint8Array(6);
  const maxpView = new DataView(maxp.buffer);
  maxpView.setUint32(0, 0x00005000);
  maxpView.setUint16(4, numGlyphs);
  const hhea = new Uint8Array(36);
  new DataView(hhea.buffer).setUint16(34, numGlyphs);
  const hmtx = new Uint8Array(numGlyphs * 4);
  const hmtxView = new DataView(hmtx.buffer);
  for (let glyph = 0; glyph < numGlyphs; glyph++) {
    hmtxView.setUint16(glyph * 4, 1500);
    hmtxView.setInt16(glyph * 4 + 2, 20);
  }
  const cmap = new Uint8Array(40);
  const cmapView = new DataView(cmap.buffer);
  cmapView.setUint16(2, 1);
  cmapView.setUint16(4, 3);
  cmapView.setUint16(6, 10);
  cmapView.setUint32(8, 12);
  cmapView.setUint16(12, 12);
  cmapView.setUint32(16, 28);
  cmapView.setUint32(24, 1);
  cmapView.setUint32(28, 65);
  cmapView.setUint32(32, 65);
  cmapView.setUint32(36, 1);
  const tables = [["head", head], ["maxp", maxp], ["hhea", hhea], ["hmtx", hmtx], ["cmap", cmap], ["CFF ", cffBytes]];
  const directorySize = 12 + tables.length * 16;
  const totalSize = directorySize + tables.reduce((sum, [, table]) => sum + Math.ceil(table.length / 4) * 4, 0);
  const bytes = new Uint8Array(totalSize);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x4f54544f);
  view.setUint16(4, tables.length);
  let offset = directorySize;
  tables.forEach(([tag, table], index) => {
    const record = 12 + index * 16;
    bytes.set(new TextEncoder().encode(tag), record);
    view.setUint32(record + 8, offset);
    view.setUint32(record + 12, table.length);
    bytes.set(table, offset);
    offset += Math.ceil(table.length / 4) * 4;
  });
  return bytes;
}

function testMalformedProgramsAndLimits() {
  expectPdf(() => NativeCffFont.parse(Uint8Array.of(1, 0, 4)), "unsupported-font", /header/i);

  const cff2 = buildCffFixture().slice();
  cff2[0] = 2;
  expectPdf(() => NativeCffFont.parse(cff2), "unsupported-font", /CFF2/i);

  const unknownOperator = NativeCffFont.parse(buildCffFixture({
    aCharString: Uint8Array.of(2, 14)
  }));
  expectPdf(() => unknownOperator.getGlyphOutline(1), "unsupported-font", /operator 2/i);

  const truncatedMask = NativeCffFont.parse(buildCffFixture({
    aCharString: type2([0, 20, "hstem", "hintmask"])
  }));
  expectPdf(() => truncatedMask.getGlyphOutline(1), "unsupported-font", /truncated/i);

  const subrCycle = NativeCffFont.parse(buildCffFixture({
    aCharString: type2([-107, "callsubr", "endchar"]),
    localSubrs: [type2([-107, "callsubr", "return"])]
  }));
  expectPdf(() => subrCycle.getGlyphOutline(1), "unsupported-font", /cycle/i);

  const operatorLimited = NativeCffFont.parse(buildCffFixture(), { maxType2Operators: 2 });
  expectPdf(() => operatorLimited.getGlyphOutline(1), "resource-limit", /operator/i);

  const pathLimited = NativeCffFont.parse(buildCffFixture(), { maxType2PathCommands: 2 });
  expectPdf(() => pathLimited.getGlyphOutline(1), "resource-limit", /path command/i);

  const repeated = buildCffFixture({
    aCharString: type2([0, 0, "rmoveto", ...Array.from({ length: 4_097 }, () => [-107, "callsubr"]).flat(), "endchar"]),
    localSubrs: [type2(["return"])]
  });
  NativeCffFont.parse(repeated).getGlyphOutline(1);
  expectPdf(() => NativeCffFont.parse(repeated, { maxType2SubrCalls: 4_096 }).getGlyphOutline(1),
    "resource-limit", /subroutine calls/i);
  const nested = buildCffFixture({
    aCharString: type2([0, 0, "rmoveto", -107, "callsubr", "endchar"]),
    localSubrs: Array.from({ length: 48 }, (_, index) => type2(index === 47 ? ["return"] : [index + 1 - 107, "callsubr", "return"]))
  });
  NativeCffFont.parse(nested).getGlyphOutline(1);
  expectPdf(() => NativeCffFont.parse(nested, { maxType2SubrDepth: 32 }).getGlyphOutline(1),
    "resource-limit", /subroutine depth/i);
}

function testDeprecatedPdfDotsectionCompatibility() {
  const font = NativeCffFont.parse(buildCffFixture({
    aCharString: type2([
      500,
      100, 0, "rmoveto",
      { bytes: [12, 0] },
      100, 0, "rlineto",
      "endchar"
    ])
  }));
  const outline = font.getGlyphOutline(1);

  assert.equal(outline.advanceWidth, 600);
  assert.deepEqual(outline.commands, [
    { kind: "move", x: 100, y: 0 },
    { kind: "line", x: 200, y: 0 },
    { kind: "close" }
  ], "deprecated Type 2 dotsection is the PDF-compatible no-op required by Adobe TN 5177");
}

function buildCffFixture(options = {}) {
  const localSubrs = options.localSubrs ?? [type2([100, 0, "rlineto", "return"])];
  const globalSubrs = options.globalSubrs ?? [type2([0, 100, "rlineto", "return"])];
  const aCharString = options.aCharString ?? type2([
    500, 0, 20, "hstem",
    0, 20, "vstem",
    "hintmask", { bytes: [0xc0] },
    100, 0, "rmoveto",
    -107, "callsubr",
    -107, "callgsubr",
    50, 0, 50, 100, 50, 0, "rrcurveto",
    "endchar"
  ]);
  const charStrings = options.charStrings ?? [
    type2(["endchar"]),
    aCharString,
    type2([50, 0, "rmoveto", 0, 50, "rlineto", "endchar"]),
    type2([500, 20, 100, 65, 194, "endchar"]),
    type2([
      0, 0, "rmoveto",
      10, 20, 50, 20, 10, 20, 10, "hflex",
      "endchar"
    ])
  ];
  const header = Uint8Array.of(1, 0, 4, 4);
  const nameIndex = cffIndex([ascii("FixtureCff")]);
  const stringIndex = cffIndex([ascii("fixtureGlyph"), ...(options.extraStrings ?? [])]);
  const globalSubrsIndex = cffIndex(globalSubrs);
  const encoding = Uint8Array.of(0, 4, 65, 194, 193, 66);
  const charset = Uint8Array.of(0, 0, 34, 0, 125, 0, 171, 1, 135);
  const charStringsIndex = cffIndex(charStrings);

  // Long DICT integers make all offset-bearing fields fixed-width, so one
  // placeholder pass is sufficient and cannot move the later data again.
  const privatePrefix = concat(
    dictInteger(500), Uint8Array.of(20),
    dictInteger(100), Uint8Array.of(21),
    options.privateExtra ?? new Uint8Array()
  );
  const privateDictionary = concat(privatePrefix, dictInteger(privatePrefix.length + 6), Uint8Array.of(19));
  const localSubrsIndex = cffIndex(localSubrs);
  const fontMatrix = options.fontMatrix ?? null;
  const topDictExtra = options.topDictExtra ?? new Uint8Array();
  const placeholderTop = topDictionary(0, 0, 0, privateDictionary.length, 0, fontMatrix, topDictExtra);
  const placeholderTopIndex = cffIndex([placeholderTop]);
  const prefixLength = header.length + nameIndex.length + placeholderTopIndex.length +
    stringIndex.length + globalSubrsIndex.length;
  const encodingOffset = prefixLength;
  const charsetOffset = encodingOffset + encoding.length;
  const charStringsOffset = charsetOffset + charset.length;
  const privateOffset = charStringsOffset + charStringsIndex.length;
  const top = topDictionary(
    options.predefinedCharset ?? charsetOffset,
    options.predefinedEncoding ?? encodingOffset,
    charStringsOffset,
    privateDictionary.length,
    privateOffset,
    fontMatrix,
    topDictExtra
  );
  assert.equal(top.length, placeholderTop.length);

  return concat(
    header,
    nameIndex,
    cffIndex([top]),
    stringIndex,
    globalSubrsIndex,
    encoding,
    charset,
    charStringsIndex,
    privateDictionary,
    localSubrsIndex,
    Uint8Array.of(0, 0)
  );
}

function topDictionary(charset, encoding, charStrings, privateSize, privateOffset, fontMatrix, extra = new Uint8Array()) {
  const matrix = fontMatrix === null
    ? new Uint8Array()
    : concat(...fontMatrix.map((value) => dictReal(value)), Uint8Array.of(12, 7));
  return concat(
    matrix,
    extra,
    dictInteger(charset), Uint8Array.of(15),
    dictInteger(encoding), Uint8Array.of(16),
    dictInteger(charStrings), Uint8Array.of(17),
    dictInteger(privateSize), dictInteger(privateOffset), Uint8Array.of(18)
  );
}

function buildSyntheticCffFixture(options = {}) {
  const header = Uint8Array.of(1, 0, 4, 4);
  const names = cffIndex((options.names ?? ["Base", "Synthetic"]).map(ascii));
  const strings = cffIndex([]);
  const globalSubrs = cffIndex([]);
  const baseEncoding = Uint8Array.of(0, 1, 65);
  const syntheticEncoding = Uint8Array.of(0, 1, 66);
  const charset = Uint8Array.of(0, 0, 34);
  const charStrings = cffIndex([type2(["endchar"]),
    type2([0, 0, "rmoveto", 100, 100, "rlineto", "endchar"])]);
  const privateDictionary = concat(dictInteger(600), Uint8Array.of(20));
  const buildTop = (encodingOffset, syntheticEncodingOffset, charsetOffset, charStringsOffset, privateOffset) => {
    const baseExtra = options.baseIsSynthetic ? concat(dictInteger(1), Uint8Array.of(12, 20)) :
      options.baseIsCid ? concat(dictInteger(0), dictInteger(0), dictInteger(0), Uint8Array.of(12, 30)) : new Uint8Array();
    const base = topDictionary(charsetOffset, encodingOffset, charStringsOffset,
      privateDictionary.length, privateOffset, null, baseExtra);
    const syntheticBase = concat(dictInteger(options.baseIndex ?? 0), Uint8Array.of(12, 20));
    const matrix = options.omitMatrix ? new Uint8Array() :
      concat(...[0.001, 0, 0.0002, 0.001, 0.02, 0].map(dictReal), Uint8Array.of(12, 7));
    const synthetic = concat(options.syntheticNotFirst ? matrix : new Uint8Array(), syntheticBase,
      options.syntheticNotFirst ? new Uint8Array() : matrix,
      options.omitEncoding ? new Uint8Array() : concat(dictInteger(syntheticEncodingOffset), Uint8Array.of(16)),
      options.syntheticHasPrivate ? concat(dictInteger(0), dictInteger(0), Uint8Array.of(18)) : new Uint8Array());
    return cffIndex([base, synthetic]);
  };
  const topPlaceholder = buildTop(0, 0, 0, 0, 0);
  const encodingOffset = header.length + names.length + topPlaceholder.length + strings.length + globalSubrs.length;
  const syntheticEncodingOffset = encodingOffset + baseEncoding.length;
  const charsetOffset = syntheticEncodingOffset + syntheticEncoding.length;
  const charStringsOffset = charsetOffset + charset.length;
  const privateOffset = charStringsOffset + charStrings.length;
  const top = buildTop(encodingOffset, syntheticEncodingOffset, charsetOffset, charStringsOffset, privateOffset);
  assert.equal(top.length, topPlaceholder.length);
  return concat(header, names, top, strings, globalSubrs, baseEncoding, syntheticEncoding,
    charset, charStrings, privateDictionary);
}

function cffIndex(objects) {
  if (objects.length === 0) return Uint8Array.of(0, 0);
  const dataLength = objects.reduce((total, bytes) => total + bytes.length, 0);
  assert(dataLength + 1 <= 0xffff);
  const bytes = new Uint8Array(2 + 1 + (objects.length + 1) * 2 + dataLength);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, objects.length, false);
  bytes[2] = 2;
  let dataOffset = 1;
  let offset = 3;
  for (const object of objects) {
    view.setUint16(offset, dataOffset, false);
    offset += 2;
    dataOffset += object.length;
  }
  view.setUint16(offset, dataOffset, false);
  offset += 2;
  for (const object of objects) {
    bytes.set(object, offset);
    offset += object.length;
  }
  return bytes;
}

function dictInteger(value) {
  assert(Number.isSafeInteger(value) && value >= -0x80000000 && value <= 0x7fffffff);
  const bytes = new Uint8Array(5);
  bytes[0] = 29;
  new DataView(bytes.buffer).setInt32(1, value, false);
  return bytes;
}

function dictReal(value) {
  const text = String(value);
  const nibbles = [];
  for (const character of text) {
    if (character >= "0" && character <= "9") nibbles.push(Number(character));
    else if (character === ".") nibbles.push(0x0a);
    else if (character === "e" || character === "E") nibbles.push(0x0b);
    else if (character === "-") nibbles.push(0x0e);
    else throw new Error(`Unsupported fixture real character ${character}`);
  }
  nibbles.push(0x0f);
  if (nibbles.length % 2 !== 0) nibbles.push(0x0f);
  const bytes = new Uint8Array(1 + nibbles.length / 2);
  bytes[0] = 30;
  for (let index = 0; index < nibbles.length; index += 2) {
    bytes[1 + index / 2] = (nibbles[index] << 4) | nibbles[index + 1];
  }
  return bytes;
}

function type2(tokens) {
  const chunks = [];
  for (const token of tokens) {
    if (typeof token === "number") chunks.push(type2Number(token));
    else if (typeof token === "string") chunks.push(Uint8Array.of(...TYPE2_OPERATORS[token]));
    else chunks.push(Uint8Array.from(token.bytes));
  }
  return concat(...chunks);
}

function type1(tokens) {
  const operators = { hsbw: [13], sbw: [12, 7], seac: [12, 6], closepath: [9],
    rmoveto: [21], rlineto: [5], callsubr: [10], return: [11], endchar: [14],
    callothersubr: [12, 16], pop: [12, 17] };
  return concat(...tokens.map(token => {
    if (typeof token === "string") return Uint8Array.from(operators[token]);
    if (token >= -107 && token <= 107) return Uint8Array.of(token + 139);
    if (token >= 108 && token <= 1131) {
      const delta = token - 108;
      return Uint8Array.of(247 + (delta >> 8), delta & 255);
    }
    if (token >= -1131 && token <= -108) {
      const delta = -token - 108;
      return Uint8Array.of(251 + (delta >> 8), delta & 255);
    }
    const bytes = new Uint8Array(5);
    bytes[0] = 255;
    new DataView(bytes.buffer).setInt32(1, token, false);
    return bytes;
  }));
}

const TYPE2_OPERATORS = Object.freeze({
  hstem: [1],
  vstem: [3],
  rlineto: [5],
  rrcurveto: [8],
  callsubr: [10],
  return: [11],
  endchar: [14],
  hintmask: [19],
  rmoveto: [21],
  callgsubr: [29],
  hflex: [12, 34]
});

function type2Number(value) {
  assert(Number.isSafeInteger(value) && value >= -32768 && value <= 32767);
  if (value >= -107 && value <= 107) return Uint8Array.of(value + 139);
  const bytes = new Uint8Array(3);
  bytes[0] = 28;
  new DataView(bytes.buffer).setInt16(1, value, false);
  return bytes;
}

function ascii(value) {
  return new TextEncoder().encode(value);
}

function concat(...parts) {
  const length = parts.reduce((total, bytes) => total + bytes.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const bytes of parts) {
    output.set(bytes, offset);
    offset += bytes.length;
  }
  return output;
}

function expectPdf(callback, code, message) {
  assert.throws(callback, (error) => {
    assert(error instanceof PdfError);
    assert.equal(error.code, code);
    assert.match(error.message, message);
    return true;
  });
}

function buildCidCffFixture({
  fdSelect = Uint8Array.of(0, 0, 0, 1, 0, 1),
  charset = Uint8Array.of(0, 0, 42, 0, 43, 3, 132, 3, 133),
  topMatrix = null,
  fdMatrix = null
} = {}) {
  const header = Uint8Array.of(1, 0, 4, 4);
  const names = cffIndex([ascii("SyntheticCID")]);
  const strings = cffIndex([ascii("Adobe"), ascii("Identity")]);
  // A global subroutine calls the selected Font DICT's local subroutine.
  const globalSubrs = cffIndex([type2([-107, "callsubr", "return"])]);
  const charStrings = cffIndex([
    type2(["endchar"]),
    type2([10, 20, "rmoveto", -107, "callgsubr", "endchar"]),
    type2([10, 20, "rmoveto", -107, "callgsubr", "endchar"]),
    type2([25, 10, 20, "rmoveto", -107, "callgsubr", "endchar"]),
    type2([25, 10, 20, "rmoveto", -107, "callgsubr", "endchar"])
  ]);
  const privateDict = index => concat(
    dictInteger(500 + 100 * index), Uint8Array.of(20),
    dictInteger(100 + 100 * index), Uint8Array.of(21),
    dictInteger(18), Uint8Array.of(19)
  );
  const privateParts = [0, 1].map(index => concat(privateDict(index),
    cffIndex([type2([100 + 100 * index, 0, 0, 50, -100 - 100 * index, 0, "rlineto", "return"])])));
  const matrixBytes = matrix => matrix === null ? new Uint8Array()
    : concat(...matrix.map(dictReal), Uint8Array.of(12, 7));
  const fd = offset => concat(matrixBytes(fdMatrix),
    dictInteger(18), dictInteger(offset), Uint8Array.of(18));
  const top = (charsetOffset, stringsOffset, arrayOffset, selectOffset) => concat(
    dictInteger(391), dictInteger(392), dictInteger(0), Uint8Array.of(12, 30),
    matrixBytes(topMatrix),
    dictInteger(charsetOffset), Uint8Array.of(15),
    dictInteger(stringsOffset), Uint8Array.of(17),
    dictInteger(arrayOffset), Uint8Array.of(12, 36),
    dictInteger(selectOffset), Uint8Array.of(12, 37)
  );
  const charsetOffset = header.length + names.length + cffIndex([top(0, 0, 0, 0)]).length +
    strings.length + globalSubrs.length;
  const selectOffset = charsetOffset + charset.length;
  const stringsOffset = selectOffset + fdSelect.length;
  const arrayOffset = stringsOffset + charStrings.length;
  const privateOffset = arrayOffset + cffIndex([fd(0), fd(0)]).length;
  return concat(header, names, cffIndex([top(charsetOffset, stringsOffset, arrayOffset, selectOffset)]),
    strings, globalSubrs, charset, fdSelect, charStrings,
    cffIndex([fd(privateOffset), fd(privateOffset + privateParts[0].length)]), ...privateParts);
}

async function testCidCffOutlinesAndPdfSelection() {
  const rangeSelect = Uint8Array.of(3, 0, 4, 0, 0, 0, 0, 2, 1, 0, 3, 0, 0, 4, 1, 0, 5);
  for (const fdSelect of [undefined, rangeSelect]) {
    for (const charset of [undefined, Uint8Array.of(1, 0, 42, 1, 3, 132, 1),
      Uint8Array.of(2, 0, 42, 0, 1, 3, 132, 0, 1)]) {
      const font = NativeCffFont.parse(buildCidCffFixture({ fdSelect, charset }));
      assert.equal(font.glyphIdForCid(42), 1, "subset CIDs are not GIDs");
      assert.equal(font.glyphIdForCid(901), 4);
      assert.equal(font.glyphIdForCid(7), 0, "unmapped CIDs select .notdef");
      assert.equal(font.glyphIdForName("A"), 0);
      assert(font.builtInGlyphNames.every(name => name === null), "CID CFF has no simple encoding");
      assert.deepEqual(font.getGlyphOutline(1).bounds, [10, 20, 110, 70]);
      assert.deepEqual(font.getGlyphOutline(2).bounds, [10, 20, 210, 70]);
      assert.equal(font.getGlyphOutline(1).advanceWidth, 500);
      assert.equal(font.getGlyphOutline(2).advanceWidth, 600);
      assert.equal(font.getGlyphOutline(3).advanceWidth, 125);
      assert.equal(font.getGlyphOutline(4).advanceWidth, 225);
      assert.strictEqual(font.getGlyphOutline(2), font.getGlyphOutline(2));
    }
  }
  const childMatrix = [0.002, 0, 0, 0.003, 0.01, -0.02];
  assert.deepEqual(NativeCffFont.parse(buildCidCffFixture({ fdMatrix: childMatrix }))
    .getGlyphOutline(1).bounds, [30, 40, 230, 190]);
  const matrixFont = NativeCffFont.parse(buildCidCffFixture({
    topMatrix: [0.001, 0, 0, 0.001, 0, 0], fdMatrix: [2, 0, 0, 3, 10, -20]
  }));
  assert.deepEqual(matrixFont.getGlyphOutline(1).bounds, [30, 40, 230, 190]);

  for (const fdSelect of [Uint8Array.of(0, 0, 0, 2, 0, 1),
    Uint8Array.of(3, 0, 1, 0, 1, 0, 0, 5),
    Uint8Array.of(3, 0, 1, 0, 0, 0, 0, 4),
    Uint8Array.of(3, 0, 2, 0, 0, 0, 0, 0, 1, 0, 5)]) {
    expectPdf(() => NativeCffFont.parse(buildCidCffFixture({ fdSelect })), "unsupported-font", /FDSelect/);
  }
  expectPdf(() => NativeCffFont.parse(buildCidCffFixture({
    charset: Uint8Array.of(0, 0, 42, 0, 42, 3, 132, 3, 133)
  })), "unsupported-font", /duplicate CIDs/);
  expectPdf(() => NativeCffFont.parse(buildCidCffFixture(), { maxCffIndexEntries: 5 }),
    "resource-limit", /INDEX/);
  const limited = NativeCffFont.parse(buildCidCffFixture(), { maxType2SubrCalls: 1 });
  expectPdf(() => limited.getGlyphOutline(1), "resource-limit", /subroutine/);

  const name = value => ({ kind: "name", value });
  const stream = (bytes, dictionary = new Map()) => ({ kind: "stream", bytes, dictionary });
  const resolver = { async resolveValue(value) { return value; }, async decodeStream(value) { return value.bytes; } };
  const dictionary = new Map([
    ["Subtype", name("Type0")], ["BaseFont", name("SyntheticCID")], ["Encoding", name("Identity-H")],
    ["ToUnicode", stream(ascii("1 begincodespacerange <0000> <ffff> endcodespacerange 1 beginbfchar <002a> <03a9> endbfchar"))],
    ["DescendantFonts", [new Map([
      ["Subtype", name("CIDFontType0")], ["W", [42, [700]]],
      ["CIDSystemInfo", new Map([
        ["Registry", { kind: "string", bytes: ascii("Adobe"), hex: false }],
        ["Ordering", { kind: "string", bytes: ascii("Identity"), hex: false }],
        ["Supplement", 0]
      ])],
      ["FontDescriptor", new Map([["FontFile3", stream(buildCidCffFixture(), new Map([["Subtype", name("CIDFontType0C")]]))]])]
    ])]]
  ]);
  const parsed = await parseNativePdfFont(dictionary, resolver);
  const glyph = parsed.decode(Uint8Array.of(0, 42));
  assert.equal(glyph.cid, 42);
  assert.equal(glyph.glyphId, 1);
  assert.equal(glyph.unicode, "Ω", "ToUnicode changes extraction, never the selected outline");
  assert.equal(glyph.width, 700, "PDF widths take precedence over the CFF width");
  assert.deepEqual(parsed.getGlyphOutline(glyph.glyphId).bounds, [10, 20, 110, 70]);
  const { tinyPdfStream, writeTinyPdf } = await import("./lib/tinyPdfWriter.mjs");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { createCanvas } = await import("@napi-rs/canvas");
  // Gray text; text in a pattern that is exactly one colour, an opaque fill of
  // its whole gapless cell; and text in a pattern that is not, whose glyphs
  // keep their shapes and positions in the fallback colour, with a warning.
  const paints = [
    { name: "gray", operator: "0 g", cell: "1 0 0 rg 0 0 2 2 re f", color: [0, 0, 0] },
    { name: "solid pattern", operator: "/Pattern cs /P scn", cell: "1 0 0 rg 0 0 2 2 re f", color: [1, 0, 0] },
    { name: "pattern", operator: "/Pattern cs /P scn", cell: "1 0 0 rg 0 0 1 1 re f", color: [0, 0, 0], approximated: true }
  ];
  for (const paint of paints) {
    const bytes = writeTinyPdf({ objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 30 20] /Resources << /Font << /F 5 0 R >> /Pattern << /P 9 0 R >> >> /Contents 4 0 R >>" },
      { number: 4, body: tinyPdfStream("", `${paint.operator} BT /F 100 Tf 1 0 0 1 2 2 Tm <002a> Tj ET`) },
      { number: 5, body: "<< /Type /Font /Subtype /Type0 /BaseFont /SyntheticCID /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 10 0 R >>" },
      { number: 6, body: "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /SyntheticCID /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 7 0 R /W [42 [700]] >>" },
      { number: 7, body: "<< /Type /FontDescriptor /FontName /SyntheticCID /Flags 4 /FontBBox [0 0 300 100] /ItalicAngle 0 /Ascent 100 /Descent 0 /CapHeight 100 /StemV 80 /FontFile3 8 0 R >>" },
      { number: 8, body: tinyPdfStream("/Subtype /CIDFontType0C", buildCidCffFixture()) },
      { number: 9, body: tinyPdfStream("/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 2 2] /XStep 2 /YStep 2 /Resources << >>", paint.cell) },
      { number: 10, body: tinyPdfStream("", "1 begincodespacerange <0000> <ffff> endcodespacerange 1 beginbfchar <002a> <0041> endbfchar") }
    ] });
    const session = await openPdf({ kind: "bytes", bytes });
    try {
      const page = await session.compilePage(0);
      assert.equal(page.textIndex.text, "A");
      const rendered = await renderHeprPageToCanvas2d(page, {
        surfaceFactory(width, height) {
          const canvas = createCanvas(width, height);
          return { canvas, context: canvas.getContext("2d") };
        }
      });
      assert.deepEqual([...rendered.surface.context.getImageData(5, 14, 1, 1).data], [...paint.color.map(v => v * 255), 255],
        `${paint.name}: the embedded CID outline paints at the correct position, in its colour or the pattern's fallback`);
      const scene = await session.compileVectorPage(0);
      assert.equal(scene.textIndex.pages[0].text, "A");
      assert.equal(scene.textInstanceCount, 1, `${paint.name}: the CID CFF glyph keeps vector geometry`);
      assert.deepEqual([...scene.textInstanceC.subarray(0, 3)], paint.color, `${paint.name}: in the colour it paints`);
      assert.equal(session.getDiagnostics().filter(d => d.code === "text-pattern-approximation").length,
        paint.approximated ? 1 : 0, `${paint.name}: only an unrepresentable pattern is reported as approximated`);
      if (!paint.approximated) assert.equal(scene.rasterLayers.length, 0, `${paint.name}: nothing is rasterized`);
    } finally {
      await session.close();
    }
  }
}

testCffStructureAndType2Outlines();
testFontMatrixNormalization();
testBaseFontBlendIsNotMultipleMaster();
testPredefinedExpertCharsetsAndEncoding();
testSeededRandomAndStackOperators();
testSyntheticFontSets();
testCancellation();
testCffType1CharStrings();
testApproximationDiagnosticsAndUnsupportedMasterPrograms();
testLatin1StringsAreAccepted();
await testPdfFontSelectionIsSeparateFromToUnicode();
await testPdfSyntheticFontSetSelection();
await testCffDiagnosticPropagation();
await testOpenTypeCffOutlines();
await testCidCffOutlinesAndPdfSelection();
testMalformedProgramsAndLimits();
testDeprecatedPdfDotsectionCompatibility();

console.log("native CFF semantics tests passed");
hooks.deregister();
