import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import { buildTinySfnt } from "./lib/tinySfnt.mjs";
import {
  buildType1Fixture,
  concatType1Bytes,
  encryptType1Bytes,
  type1CharString as cs
} from "./lib/type1Fixture.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const { NativeType1Font, evaluateNativeType1CharString } = await import("../src/pdf/nativeType1.ts");
  const { parseNativePdfFont } = await import("../src/pdf/nativeFont.ts");
  const { PdfError } = await import("../src/pdf/nativeTypes.ts");
  const encoder = new TextEncoder();
  const notdef = [".notdef", cs(0, 500, "hsbw", "endchar")];
  const aCommands = [
    { kind: "move", x: 50, y: 0 },
    { kind: "line", x: 250, y: 0 },
    { kind: "line", x: 250, y: 300 },
    { kind: "line", x: 50, y: 300 },
    { kind: "close" }
  ];
  const expectPdf = (operation, code, pattern) => assert.throws(operation, error => {
    assert(error instanceof PdfError, `expected PdfError, received ${String(error)}`);
    assert.equal(error.code, code);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
  const parse = (fixture, limits = {}, framing = {}) => NativeType1Font.parse(fixture.bytes, limits, framing);
  const outline = (program, options = {}, limits = {}) => {
    const font = parse(buildType1Fixture({ glyphs: [notdef, ["A", program]], ...options }), limits);
    return font.getGlyphOutline(font.glyphIdForName("A"));
  };

  // These expected points come from the fixture's rectangle, not from another
  // decoder. Binary, ASCII hexadecimal and split PFB records must agree.
  for (const container of ["binary", "hex", "pfb"]) {
    for (const lenIV of [4, 0, -1]) {
      const fixture = buildType1Fixture({ container, lenIV });
      const font = parse(fixture);
      assert.equal(font.unitsPerEm, 1000);
      assert.equal(font.numGlyphs, 3);
      assert.equal(font.glyphNames[0], ".notdef");
      assert.equal(font.glyphIdForName("missing"), 0);
      assert.equal(font.builtInGlyphNames[1], "A");
      assert.equal(font.builtInGlyphNames[2], "B");
      const glyph = font.getGlyphOutline(font.glyphIdForName("A"));
      assert.deepEqual(glyph.commands, aCommands, `${container}, lenIV=${lenIV}: original outlines survive both encryption layers`);
      assert.deepEqual(glyph.bounds, [50, 0, 250, 300]);
      assert.equal(glyph.advanceWidth, 600);
      assert.strictEqual(font.getGlyphOutline(glyph.glyphId), glyph, "decoded glyphs are cached");
      assert(Object.isFrozen(glyph));
      assert(Object.isFrozen(glyph.commands));
      if (container === "binary") {
        const framed = parse(fixture, {}, fixture);
        assert.deepEqual(framed.getGlyphOutline(framed.glyphIdForName("A")), glyph,
          "PDF /Length1 and /Length2 preserve the exact binary boundary");
      }
    }
  }
  assert.deepEqual(parse(buildType1Fixture({ omitLenIV: true })).getGlyphOutline(1).commands, aCommands,
    "omitted lenIV defaults to four encrypted prefix bytes");
  assert.deepEqual(parse(buildType1Fixture({ rdName: "-|", ndName: "|-", npName: "|" })).getGlyphOutline(1).commands,
    aCommands, "the documented RD/ND/NP aliases retain binary string boundaries");
  assert.deepEqual(parse(buildType1Fixture({
    clearExtra: "(misleading /FontMatrix [9 0 0 9 0 0] /Encoding StandardEncoding) pop\n% /FontMatrix [8 0 0 8 0 0] def"
  })).getGlyphOutline(1).commands, aCommands, "strings and comments do not redefine font dictionaries");
  expectPdf(() => parse(buildType1Fixture({ encoding: "SomeUnknownEncoding" })), "unsupported-font",
    /Encoding|PostScript/i);
  expectPdf(() => parse(buildType1Fixture({ encoding: "256 array 0 1 255 {1 index exch /A put} for" })),
    "unsupported-font", /Encoding|PostScript/i);

  const transformed = parse(buildType1Fixture({ fontMatrix: [0.002, 0.001, 0.0005, 0.003, 0.01, -0.02] })).getGlyphOutline(1);
  assert.deepEqual(transformed.commands, [
    { kind: "move", x: 110, y: 30 },
    { kind: "line", x: 510, y: 230 },
    { kind: "line", x: 660, y: 1130 },
    { kind: "line", x: 260, y: 930 },
    { kind: "close" }
  ], "FontMatrix applies scale, shear, rotation and translation in the shared 1000-unit ABI");
  assert.equal(transformed.advanceWidth, 1200, "translation does not affect the width vector");

  const curved = outline(cs(30, 40, 600, 0, "sbw", 10, 20, "rmoveto",
    20, 0, 30, 50, 40, -20, "rrcurveto", "closepath", "endchar"));
  assert.deepEqual(curved.commands, [
    { kind: "move", x: 40, y: 60 },
    { kind: "cubic", control1X: 60, control1Y: 60, control2X: 90, control2Y: 110, x: 130, y: 90 },
    { kind: "close" }
  ], "sbw sets both sidebearing coordinates before relative curve operations");
  assert.deepEqual(outline(cs(0, 600, "hsbw", 0, 0, "rmoveto",
    0, 300, 300, 0, 0, -300, "rrcurveto", "closepath", "endchar")).bounds,
    [0, 0, 300, 225], "cubic bounds include the interior y extremum without expanding to its control points");
  assert.deepEqual(outline(cs(30, 600, "hsbw", 10, 20, "rmoveto", 60, 0, "rlineto", "closepath",
    5, 5, "rmoveto", 10, 0, "rlineto", "closepath", "endchar")).commands, [
    { kind: "move", x: 40, y: 20 }, { kind: "line", x: 100, y: 20 }, { kind: "close" },
    { kind: "move", x: 105, y: 25 }, { kind: "line", x: 115, y: 25 }, { kind: "close" }
  ], "Type 1 closepath preserves the prior current point rather than resetting to the contour start");
  assert.deepEqual(outline(cs(0, 600, "hsbw", 2000, 2, "div", 0, "rmoveto",
    -1500, -3, "div", 0, "rlineto", "closepath", "endchar")).commands, [
    { kind: "move", x: 1000, y: 0 }, { kind: "line", x: 1500, y: 0 }, { kind: "close" }
  ], "Type 1 byte 255 is a signed integer, while div produces its exact quotient");

  const subrs = [cs(200, 2, "div", 0, "rlineto", 1, "callsubr", "return"), cs(0, 80, "rlineto", "return")];
  const subroutineProgram = cs(50, 600, "hsbw", 0, 0, "rmoveto", 0, "callsubr", "closepath", "endchar");
  const subroutineCommands = [
    { kind: "move", x: 50, y: 0 }, { kind: "line", x: 150, y: 0 },
    { kind: "line", x: 150, y: 80 }, { kind: "close" }
  ];
  for (const stringForm of ["binary", "hex", "literal"]) {
    for (const lenIV of [4, 0, -1]) {
      assert.deepEqual(outline(subroutineProgram, { subrs, stringForm, lenIV }).commands, subroutineCommands,
        `${stringForm}, lenIV=${lenIV}: glyph and nested unbiased subr strings share correct decryption and state`);
    }
  }
  assert.deepEqual(outline(cs(0, 600, "hsbw", 0, 20, "hstem", 0, 20, "vstem",
    0, 10, 100, 10, 200, 10, "hstem3", 0, 10, 100, 10, 200, 10, "vstem3",
    0, 0, "rmoveto", "dotsection", 50, 0, "rlineto", "closepath", "dotsection", "endchar")).commands, [
    { kind: "move", x: 0, y: 0 }, { kind: "line", x: 50, y: 0 }, { kind: "close" }
  ], "hint and dot-section operators preserve the vector outline");
  assert.deepEqual(outline(cs(0, 600, "hsbw", 0, 0, "rmoveto",
    0, 1, 3, "callothersubr", "pop", "callsubr", 50, "hlineto", 60, "vlineto", "closepath", "endchar"),
    { subrs: [cs(0, 20, "hstem", "return")] }).commands, [
    { kind: "move", x: 0, y: 0 }, { kind: "line", x: 50, y: 0 },
    { kind: "line", x: 50, y: 60 }, { kind: "close" }
  ], "standard hint replacement returns the unbiased subroutine index and leaves visible geometry intact");

  // Standard OtherSubrs 0/1/2 represent two shallow cubic curves. The extra
  // reference point (140,100) is bookkeeping, never a painted contour point.
  const flexSubrs = [cs(3, 0, "callothersubr", "pop", "pop", "setcurrentpoint", "return"),
    cs(0, 1, "callothersubr", "return"), cs(0, 2, "callothersubr", "return"), cs("return")];
  const flexProgram = cs(0, 600, "hsbw", 80, 100, "rmoveto", 1, "callsubr",
    60, 0, "rmoveto", 2, "callsubr", -45, 0, "rmoveto", 2, "callsubr",
    15, 10, "rmoveto", 2, "callsubr", 30, 0, "rmoveto", 2, "callsubr",
    30, 0, "rmoveto", 2, "callsubr", 15, -10, "rmoveto", 2, "callsubr",
    15, 0, "rmoveto", 2, "callsubr", 50, 200, 100, 0, "callsubr",
    0, 50, "rlineto", "closepath", "endchar");
  assert.deepEqual(evaluateNativeType1CharString(flexProgram, { subrs: flexSubrs }).commands, [
    { kind: "move", x: 80, y: 100 },
    { kind: "cubic", control1X: 95, control1Y: 100, control2X: 110, control2Y: 110, x: 140, y: 110 },
    { kind: "cubic", control1X: 170, control1Y: 110, control2X: 185, control2Y: 100, x: 200, y: 100 },
    { kind: "line", x: 200, y: 150 }, { kind: "close" }
  ], "flex produces both original cubic segments and restores the final current point");
  // Adobe Type 1 Font Format, p69: unknown OtherSubrs return the original
  // arguments to immediately following pop operators; unused values vanish.
  const unknownOtherSubrProgram = cs(0, 600, "hsbw", 0, 0, "rmoveto",
    11, 22, 33, 3, 99, "callothersubr", "pop", "pop", "rlineto",
    42, 1, 99, "callothersubr", "pop", 0, "rlineto", "closepath", "endchar");
  const unknownOtherSubrFixture = buildType1Fixture({ glyphs: [notdef, ["A", unknownOtherSubrProgram]] });
  const unknownOtherSubrFont = parse(unknownOtherSubrFixture);
  assert.deepEqual(unknownOtherSubrFont.getGlyphOutline(1).commands, [
    { kind: "move", x: 0, y: 0 }, { kind: "line", x: 11, y: 22 },
    { kind: "line", x: 53, y: 22 }, { kind: "close" }
  ], "unknown OtherSubrs retain forwards-compatible argument order without leaking discarded results");
  unknownOtherSubrFont.getGlyphOutline(1);
  assert.equal(unknownOtherSubrFont.diagnostics.length, 1, "each unknown OtherSubr index is diagnosed once across calls and caching");
  assert.equal(unknownOtherSubrFont.diagnostics[0].code, "font.type1-othersubr-approximated");
  assert.equal(unknownOtherSubrFont.diagnostics[0].details.othersubr, 99);
  const flexFont = parse(buildType1Fixture({ glyphs: [notdef, ["A", flexProgram]], subrs: flexSubrs }));
  flexFont.getGlyphOutline(1);
  assert.deepEqual(flexFont.diagnostics, [], "standard flex and hint OtherSubrs need no approximation warning");

  const compositeFixture = buildType1Fixture({
    glyphs: [notdef,
      ["A", cs(50, 600, "hsbw", 0, 0, "rmoveto", 200, 0, "rlineto", 0, 300, "rlineto", -200, 0, "rlineto", "closepath", "endchar")],
      ["acute", cs(20, 0, "hsbw", 0, 0, "rmoveto", 40, 80, "rlineto", "closepath", "endchar")],
      ["Aacute", cs(50, 600, "hsbw", 20, 80, 350, 65, 194, "seac")]
    ],
    encoding: [[65, "A"], [194, "acute"], [193, "Aacute"]]
  });
  const compositeFont = parse(compositeFixture);
  const composite = compositeFont.getGlyphOutline(compositeFont.glyphIdForName("Aacute"));
  assert.deepEqual(composite.commands, [...aCommands,
    { kind: "move", x: 130, y: 350 }, { kind: "line", x: 170, y: 430 }, { kind: "close" }
  ], "seac positions the accent using composite sidebearing plus adx minus asb");
  assert.deepEqual(composite.bounds, [50, 0, 250, 430]);
  assert.equal(composite.advanceWidth, 600);
  // Independently checked with Ghostscript false charpath: changing only the
  // composite sidebearing moves the accent but must not shift the base glyph.
  const displacedCompositeOptions = {
    glyphs: [notdef,
      ["A", cs(50, 600, "hsbw", 0, 0, "rmoveto", 200, 0, "rlineto", 0, 300, "rlineto", -200, 0, "rlineto", "closepath", "endchar")],
      ["acute", cs(20, 0, "hsbw", 0, 0, "rmoveto", 40, 80, "rlineto", "closepath", "endchar")],
      ["Aacute", cs(150, 600, "hsbw", 20, 80, 350, 65, 194, "seac")]
    ]
  };
  const displacedFont = parse(buildType1Fixture(displacedCompositeOptions));
  const displacedCommands = [...aCommands,
    { kind: "move", x: 230, y: 350 }, { kind: "line", x: 270, y: 430 }, { kind: "close" }
  ];
  assert.deepEqual(displacedFont.getGlyphOutline(displacedFont.glyphIdForName("Aacute")).commands, displacedCommands);
  const scaledComposite = parse(buildType1Fixture({ ...displacedCompositeOptions, fontMatrix: [0.002, 0, 0, 0.002, 0, 0] }));
  assert.deepEqual(scaledComposite.getGlyphOutline(scaledComposite.glyphIdForName("Aacute")).commands,
    displacedCommands.map(command => command.kind === "close" ? command : {
      kind: command.kind, x: command.x * 2, y: command.y * 2
    }), "the shared FontMatrix transforms the complete seac outline and its accent offset exactly once");
  expectPdf(() => {
    const limited = parse(compositeFixture, { maxType1Operators: 13 });
    limited.getGlyphOutline(limited.glyphIdForName("Aacute"));
  }, "resource-limit");
  const compositeBytes = cs(50, 600, "hsbw", 20, 80, 350, 65, 194, "seac").length +
    cs(50, 600, "hsbw", 0, 0, "rmoveto", 200, 0, "rlineto", 0, 300, "rlineto", -200, 0, "rlineto", "closepath", "endchar").length +
    cs(20, 0, "hsbw", 0, 0, "rmoveto", 40, 80, "rlineto", "closepath", "endchar").length;
  expectPdf(() => {
    const limited = parse(compositeFixture, { maxType1CharStringBytes: compositeBytes - 1 });
    limited.getGlyphOutline(limited.glyphIdForName("Aacute"));
  }, "resource-limit");

  // Resource ceilings are caller-selected; malformed cycles must also fail
  // with default unlimited ceilings rather than waiting for a numeric budget.
  for (const run of [
    f => parse(f, { maxType1Bytes: 10 }),
    f => parse(f, { maxType1Glyphs: 1 }),
    f => parse(f, { maxType1StringBytes: 1 }),
    f => parse(f, { maxType1CharStringBytes: 1 }).getGlyphOutline(1),
    f => parse(f, { maxType1Operators: 1 }).getGlyphOutline(1),
    f => parse(f, { maxType1PathCommands: 1 }).getGlyphOutline(1)
  ]) {
    expectPdf(() => run(buildType1Fixture()), "resource-limit");
  }
  expectPdf(() => outline(cs(0, 600, "hsbw", 0, "callsubr", "endchar"),
    { subrs }, { maxType1Subrs: 1 }), "resource-limit");
  expectPdf(() => outline(cs(0, 600, "hsbw", 0, 0, "rmoveto", 0, "callsubr", "endchar"),
    { subrs }, { maxType1SubrDepth: 1 }), "resource-limit");
  expectPdf(() => outline(cs(0, 600, "hsbw", 0, 0, "rmoveto", 0, "callsubr", "endchar"),
    { subrs }, { maxType1SubrCalls: 1 }), "resource-limit");
  expectPdf(() => outline(cs(0, 600, "hsbw", 0, "callsubr", "endchar"),
    { subrs: [cs(0, "callsubr", "return")] }), "unsupported-font", /cycl/i);
  expectPdf(() => outline(cs(0, 600, "hsbw", 1, 1, 1, 65, 194, "seac"), {
    glyphs: [notdef, ["A", cs(0, 600, "hsbw", 0, 0, 0, 65, 194, "seac")], ["acute", cs(0, 0, "hsbw", "endchar")]]
  }), "unsupported-font", /cycl/i);
  for (const program of [
    Uint8Array.of(255, 1, 2), // truncated signed 32-bit operand
    cs(0, 600, "hsbw", 0, "rlineto", "endchar"), // wrong arity
    cs(0, 600, "hsbw", 1, 0, "div", "endchar"),
    cs(0, 600, "hsbw", 9, "callsubr", "endchar"),
    concatType1Bytes(cs(0, 600, "hsbw"), Uint8Array.of(12, 99), cs("endchar"))
  ]) expectPdf(() => outline(program), "unsupported-font");
  expectPdf(() => parse(buildType1Fixture({ paintType: 2 })), "unsupported-font");
  expectPdf(() => parse(buildType1Fixture({ fontMatrix: [0.001, 0, 0, 0.001, 0] })), "unsupported-font");
  const pfb = buildType1Fixture({ container: "pfb" }).bytes.slice();
  new DataView(pfb.buffer).setUint32(2, pfb.length + 1, true);
  expectPdf(() => NativeType1Font.parse(pfb), "unsupported-font", /trunc|bound|length/i);
  const truncated = buildType1Fixture();
  expectPdf(() => NativeType1Font.parse(truncated.bytes, {}, { length1: truncated.length1, length2: 3 }), "unsupported-font");
  const glyphHeader = encoder.encode("/B ");
  const glyphOffset = findBytes(truncated.privatePlaintext, glyphHeader);
  const shortPrivate = truncated.privatePlaintext.subarray(0, glyphOffset + 9);
  const shortEncrypted = encryptType1Bytes(concatType1Bytes(new Uint8Array(4), shortPrivate), 55665);
  expectPdf(() => NativeType1Font.parse(concatType1Bytes(truncated.cleartext, shortEncrypted), {},
    { length1: truncated.length1, length2: shortEncrypted.length }), "unsupported-font", /trunc|bound|length|binary/i);
  const aOffset = findBytes(truncated.privatePlaintext, encoder.encode("/A "));
  const bOffset = findBytes(truncated.privatePlaintext, encoder.encode("/B "));
  const dynamicPrivate = concatType1Bytes(truncated.privatePlaintext.subarray(0, aOffset),
    "/A 20 string def\n", truncated.privatePlaintext.subarray(bOffset));
  const dynamicEncrypted = encryptType1Bytes(concatType1Bytes(new Uint8Array(4), dynamicPrivate), 55665);
  expectPdf(() => NativeType1Font.parse(concatType1Bytes(truncated.cleartext, dynamicEncrypted), {},
    { length1: truncated.length1, length2: dynamicEncrypted.length }), "unsupported-font", /CharString|expression/i);

  const abort = new AbortController();
  abort.abort();
  expectPdf(() => parse(buildType1Fixture(), {}, { signal: abort.signal }), "aborted");
  const delayedAbort = new AbortController();
  const cancellable = parse(buildType1Fixture(), {}, { signal: delayedAbort.signal });
  delayedAbort.abort();
  expectPdf(() => cancellable.getGlyphOutline(1), "aborted");

  const name = value => ({ kind: "name", value });
  const stream = (bytes, dictionary = new Map()) => ({ kind: "stream", dictionary, bytes });
  const resolver = {
    async resolveValue(value) { return value; },
    async decodeStream(value) { return value.bytes; }
  };
  const dictionary = (fixture, encoding) => new Map([
    ["Subtype", name("Type1")], ["BaseFont", name("FixtureType1")],
    ["FontDescriptor", new Map([["Flags", 4], ["FontFile", stream(fixture.bytes,
      new Map([["Length1", fixture.length1], ["Length2", fixture.length2], ["Length3", fixture.length3]]))]])],
    ...(encoding === undefined ? [] : [["Encoding", encoding]])
  ]);
  const fixture = buildType1Fixture();
  const fontDictionary = dictionary(fixture);
  fontDictionary.set("FirstChar", 1);
  fontDictionary.set("Widths", [612, 721]);
  fontDictionary.set("ToUnicode", stream(encoder.encode(
    "1 begincodespacerange <00> <ff> endcodespacerange\n2 beginbfchar <01> <03a9> <02> <0041> endbfchar")));
  let resolverCalls = 0;
  const validFont = await parseNativePdfFont(fontDictionary, resolver, {
    missingFontResolver() { resolverCalls++; return buildTinySfnt(); }
  });
  assert.equal(resolverCalls, 0, "supported embedded Type 1 never calls the substitute resolver");
  assert.equal(validFont.substitution, null);
  const mapped = validFont.decode(Uint8Array.of(1));
  assert.equal(mapped.glyphName, "A", "omitted PDF Encoding uses the embedded Type 1 Encoding");
  assert.equal(mapped.unicode, "Ω", "ToUnicode remains independent of glyph selection");
  assert.equal(mapped.width, 612, "PDF /Widths override the embedded advance width");
  assert.deepEqual(validFont.getGlyphOutline(mapped.glyphId).commands, aCommands);
  fontDictionary.set("Encoding", new Map([["Differences", [1, name("B")]]]));
  const overridden = await parseNativePdfFont(fontDictionary, resolver);
  assert.equal(overridden.decode(Uint8Array.of(1)).glyphName, "B");
  assert.equal(overridden.decode(Uint8Array.of(1)).unicode, "Ω");
  assert.deepEqual(overridden.getGlyphOutline(overridden.decode(Uint8Array.of(1)).glyphId).bounds, [30, 20, 150, 100]);
  const embeddedWidths = await parseNativePdfFont(dictionary(fixture), resolver);
  assert.equal(embeddedWidths.decode(Uint8Array.of(1)).width, 600, "embedded hsbw width is used when /Widths is absent");
  const swapped = buildType1Fixture({ encoding: [[65, "B"], [66, "A"]] });
  const builtIn = await parseNativePdfFont(dictionary(swapped), resolver);
  const standard = await parseNativePdfFont(dictionary(swapped, name("StandardEncoding")), resolver);
  assert.equal(builtIn.decode(Uint8Array.of(65)).glyphName, "B");
  assert.equal(standard.decode(Uint8Array.of(65)).glyphName, "A", "explicit PDF Encoding takes precedence over the font's built-in vector");
  const extensionDiagnostics = [];
  const extensionFont = await parseNativePdfFont(dictionary(unknownOtherSubrFixture), resolver, {
    missingFontResolver() { throw new Error("forwards-compatible OtherSubrs retain original Type 1 outlines"); },
    onDiagnostic: diagnostic => extensionDiagnostics.push(diagnostic)
  });
  assert.equal(extensionFont.substitution, null);
  assert.equal(extensionDiagnostics.length, 1);
  assert.equal(extensionDiagnostics[0].code, "font.type1-othersubr-approximated");
  assert.deepEqual(extensionFont.diagnostics, extensionDiagnostics,
    "font integration retains the explicit extension approximation without a blanket font replacement");

  const diagnostics = [];
  const malformedFixture = { ...fixture, bytes: encoder.encode("%!PS-AdobeFont-1.0: broken\ncurrentfile eexec\n") };
  const malformedDictionary = dictionary(malformedFixture, new Map([["Differences", [65, name("A")]]]));
  const fallback = await parseNativePdfFont(malformedDictionary, resolver, {
    missingFontResolver() { return { sfntBytes: buildTinySfnt(), identifier: "malformed-type1-fallback" }; },
    onDiagnostic: diagnostic => diagnostics.push(diagnostic)
  });
  assert.equal(fallback.substitution.identifier, "malformed-type1-fallback");
  assert.equal(fallback.getGlyphOutline(fallback.decode(Uint8Array.of(65)).glyphId).commands[0].kind, "move");
  assert.equal(diagnostics.filter(diagnostic => diagnostic.code === "font.type1-substituted").length, 1,
    "unreadable source programs retain visible output with an explicit approximation diagnostic");
  for (const [programFixture, reason, message] of [
    [buildType1Fixture({ glyphs: [notdef, ["A", concatType1Bytes(cs(0, 600, "hsbw"), Uint8Array.of(12, 99), cs("endchar"))]] }),
      "type1-invalid-charstring", /Escaped operator 12 99/],
    [buildType1Fixture({ glyphs: [notdef, ["A", cs(0, 600, "hsbw", 0, "callsubr", "endchar")]],
      subrs: [cs(0, "callsubr", "return")] }), "type1-invalid-charstring", /cycle/i]
  ]) {
    const programDiagnostics = [];
    const recovered = await parseNativePdfFont(dictionary(programFixture), resolver, {
      missingFontResolver() { return { sfntBytes: buildTinySfnt(), identifier: "unsupported-charstring-fallback" }; },
      onDiagnostic: diagnostic => programDiagnostics.push(diagnostic)
    });
    assert.equal(recovered.type1, null, "unsupported lazy charstrings are validated before declaring original outline support");
    assert.equal(recovered.substitution.identifier, "unsupported-charstring-fallback");
    const selected = recovered.decode(Uint8Array.of(65));
    assert.equal(recovered.getGlyphOutline(selected.glyphId).commands[0].kind, "move");
    assert.equal(programDiagnostics.length, 1);
    assert.equal(programDiagnostics[0].code, "font.type1-substituted");
    assert.equal(programDiagnostics[0].details.fontProgramReason, reason);
    assert.match(programDiagnostics[0].details.fontProgramMessage, message,
      "approximation diagnostics retain the original unsupported operation or malformed cycle");
  }
  await assert.rejects(parseNativePdfFont(dictionary(fixture), resolver, {
    parserLimits: { maxType1Bytes: 1 },
    missingFontResolver() { throw new Error("a resource ceiling must not be replaced by a substitute"); }
  }), error => error instanceof PdfError && error.code === "resource-limit");
  await assert.rejects(parseNativePdfFont(dictionary(fixture), resolver, {
    parserLimits: { maxType1Operators: 1 },
    missingFontResolver() { throw new Error("a lazy charstring resource ceiling must not be replaced by a substitute"); }
  }), error => error instanceof PdfError && error.code === "resource-limit");

  console.log("Native Type 1 tests passed: encryption, framing, original geometry, subrs, flex, seac, PDF mapping, limits and cancellation.");
} finally {
  hooks.deregister();
}

function findBytes(bytes, target) {
  for (let offset = 0; offset <= bytes.length - target.length; offset++) {
    if (target.every((byte, index) => bytes[offset + index] === byte)) return offset;
  }
  throw new Error("Fixture marker not found.");
}
