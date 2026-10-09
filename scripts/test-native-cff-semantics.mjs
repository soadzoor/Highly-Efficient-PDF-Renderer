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
const { parseNativePdfFont } = await import("../src/pdf/nativeFont.ts");
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

function testSyntheticBaseRemainsUnsupported() {
  const syntheticBase = concat(dictInteger(0), Uint8Array.of(12, 20));
  const baseFontBlend = concat(dictInteger(408), dictInteger(-397), Uint8Array.of(12, 23));
  for (const topDictExtra of [syntheticBase, concat(syntheticBase, baseFontBlend)]) {
    assert.throws(() => NativeCffFont.parse(buildCffFixture({ topDictExtra })), (error) => {
      assert(error instanceof PdfError);
      assert.equal(error.code, "unsupported-font");
      assert.equal(error.details?.reason, "cff-synthetic-not-supported");
      return true;
    });
  }
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
  const charStrings = [
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
  const privateDictionary = concat(
    dictInteger(500), Uint8Array.of(20),
    dictInteger(100), Uint8Array.of(21),
    dictInteger(18), Uint8Array.of(19)
  );
  assert.equal(privateDictionary.length, 18);
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
    charsetOffset,
    encodingOffset,
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
testSyntheticBaseRemainsUnsupported();
testLatin1StringsAreAccepted();
await testPdfFontSelectionIsSeparateFromToUnicode();
await testCidCffOutlinesAndPdfSelection();
testMalformedProgramsAndLimits();
testDeprecatedPdfDotsectionCompatibility();

console.log("native CFF semantics tests passed");
hooks.deregister();
