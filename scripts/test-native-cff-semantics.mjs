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
  assert.deepEqual(
    blended.getGlyphOutline(1).commands,
    baseline.getGlyphOutline(1).commands
  );
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
  const stringIndex = cffIndex([ascii("fixtureGlyph")]);
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

testCffStructureAndType2Outlines();
testFontMatrixNormalization();
testBaseFontBlendIsNotMultipleMaster();
await testPdfFontSelectionIsSeparateFromToUnicode();
testMalformedProgramsAndLimits();
testDeprecatedPdfDotsectionCompatibility();

console.log("native CFF semantics tests passed");
hooks.deregister();
