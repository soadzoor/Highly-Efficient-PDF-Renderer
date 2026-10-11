import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { buildType1Fixture, type1CharString, concatType1Bytes as concat } from "./lib/type1Fixture.mjs";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
} });
const name = value => ({ kind: "name", value });
const stream = (bytes, dictionary = new Map()) => ({ kind: "stream", bytes, dictionary });
const resolver = { async resolveValue(value) { return value; }, async decodeStream(value) { return value.bytes; } };
const matrix = [0.002, 0, 0, 0.003, 0.01, -0.02];
const compatibilityCode = "font.intrinsic-paint-compatibility";

try {
  const { parseNativePdfFont, NativeSfntFont } = await import("../src/pdf/nativeFont.ts");
  const { NativeType1Font } = await import("../src/pdf/nativeType1.ts");
  const { NativeCffFont } = await import("../src/pdf/nativeCff.ts");
  const { PdfError } = await import("../src/pdf/nativeTypes.ts");
  const cases = [
    { label: "Type1", dictionary: type1Dictionary(), units: 1000, bearing: 110 },
    { label: "CFF", dictionary: cffDictionary(), units: 1000, bearing: 110 },
    { label: "CID CFF", dictionary: cffDictionary({ cid: true }), units: 1000, bearing: 110, cid: true },
    { label: "OpenType CFF", dictionary: cffDictionary({ sfnt: true }), units: 2000, bearing: 20 },
    { label: "CID OpenType CFF", dictionary: cffDictionary({ sfnt: true, composite: true }), units: 2000, bearing: 20, cid: true }
  ];
  for (const fixture of cases) {
    const events = [];
    const font = await parseNativePdfFont(fixture.dictionary, resolver, { onDiagnostic: value => events.push(value) });
    const mapped = font.decode(fixture.cid ? Uint8Array.of(0, fixture.label === "CID CFF" ? 42 : 1) : Uint8Array.of(65));
    const outline = font.getGlyphOutline(mapped.glyphId);
    const scale = fixture.units / 1000;
    assert.equal(font.unitsPerEm, fixture.units);
    assert.deepEqual(outline.commands[0], { kind: "move", x: 110 * scale, y: -20 * scale }, fixture.label);
    assert.deepEqual(outline.bounds, [110, -20, 510, 880].map(value => value * scale), `${fixture.label}: unexpanded raw bounds`);
    assert.equal(outline.leftSideBearing, fixture.bearing, `${fixture.label}: preserve normalized font or hmtx bearing`);
    assert.equal(outline.intrinsicStroke, undefined, `${fixture.label}: PDF Tr controls painting by default`);
    assert.strictEqual(font.getGlyphOutline(mapped.glyphId), outline, `${fixture.label}: normalized raw outlines are cached`);
    assert.equal(mapped.width, 700, `${fixture.label}: PDF widths remain authoritative`);
    assert.deepEqual(font.diagnostics, [], `${fixture.label}: no compatibility or unused-stroke warnings`);
    assert.deepEqual(events, []);

    const compatibilityEvents = [];
    const compatible = await parseNativePdfFont(fixture.dictionary, resolver, {
      embeddedFontPaint: "font", onDiagnostic: value => compatibilityEvents.push(value)
    });
    const painted = compatible.getGlyphOutline(mapped.glyphId);
    assert.equal(painted.intrinsicStroke.width, 100, `${fixture.label}: explicit font paint remains available`);
    assert.deepEqual(painted.bounds, [10, -170, 610, 1030].map(value => value * scale));
    assert.strictEqual(compatible.getGlyphOutline(mapped.glyphId), painted);
    compatible.decode(fixture.cid ? Uint8Array.of(0, fixture.label === "CID CFF" ? 42 : 1) : Uint8Array.of(65));
    compatible.getGlyphOutline(0);
    assert.equal(compatible.diagnostics.filter(value => value.code === compatibilityCode).length, 1);
    assert.equal(compatibilityEvents.filter(value => value.code === compatibilityCode).length, 1,
      `${fixture.label}: repeated outline/decode calls emit the compatibility warning once`);
  }

  // Separate caches prevent callers of the low-level font API from poisoning
  // the PDF policy, in either lookup order. Direct fonts retain their own paint.
  for (const first of [true, false]) {
    const type1 = NativeType1Font.parse(type1Fixture().bytes);
    const cff = NativeCffFont.parse(buildCff());
    const sfnt = NativeSfntFont.parse(wrapSfnt(buildCff()));
    for (const [label, provider, get] of [
      ["Type1", type1, (id, paint) => type1.getGlyphOutline(id, paint)],
      ["CFF", cff, (id, paint) => cff.getGlyphOutline(id, undefined, paint)],
      ["OpenType CFF", sfnt, (id, paint) => sfnt.getGlyphOutline(id, paint)]
    ]) {
      get(1, first);
      const raw = get(1, false), painted = get(1, true);
      assert.equal(raw.intrinsicStroke, undefined, label);
      assert.equal(painted.intrinsicStroke.width, 100, label);
      assert.notDeepEqual(raw.bounds, painted.bounds, label);
      assert.strictEqual(get(1, false), raw);
      assert.strictEqual(get(1, true), painted);
      assert(provider);
    }
  }

  // A legal raw five-command glyph must not exhaust the caller's path ceiling
  // merely because an ignored font stroke would expand it into many polygons.
  for (const fixture of [
    { dictionary: type1Dictionary(), parserLimits: { maxType1PathCommands: 5 }, type1: true },
    { dictionary: cffDictionary(), parserLimits: { maxType2PathCommands: 5 } },
    { dictionary: cffDictionary({ cid: true }), parserLimits: { maxType2PathCommands: 5 } },
    { dictionary: cffDictionary({ sfnt: true }), parserLimits: { maxType2PathCommands: 5 } }
  ]) {
    const font = await parseNativePdfFont(fixture.dictionary, resolver, { parserLimits: fixture.parserLimits });
    assert.equal(font.getGlyphOutline(1).commands.length, 5);
    const requireLimit = error => error instanceof PdfError && error.code === "resource-limit";
    if (fixture.type1) {
      await assert.rejects(parseNativePdfFont(fixture.dictionary, resolver, {
        parserLimits: fixture.parserLimits, embeddedFontPaint: "font"
      }), requireLimit);
    } else {
      const compatible = await parseNativePdfFont(fixture.dictionary, resolver, {
        parserLimits: fixture.parserLimits, embeddedFontPaint: "font"
      });
      assert.throws(() => compatible.getGlyphOutline(1), requireLimit);
    }
  }

  // An actual cubic must retain its extrema rather than its control-point box.
  // Its maximum y is 300 (not 400), before the FontMatrix multiplies it by 3.
  for (const fixture of [type1Dictionary({ curve: true }), cffDictionary({ curve: true }), cffDictionary({ curve: true, sfnt: true })]) {
    const events = [];
    const font = await parseNativePdfFont(fixture, resolver, { onDiagnostic: value => events.push(value) });
    const scale = font.unitsPerEm / 1000;
    assert.deepEqual(font.getGlyphOutline(1).bounds, [110, -20, 510, 880].map(value => value * scale));
    assert(font.getGlyphOutline(1).commands.some(value => value.kind === "cubic"));
    assert.deepEqual(events, [], "the unused stroked-curve approximation must never execute in PDF mode");
    assert.deepEqual(font.diagnostics, []);
    const compatible = await parseNativePdfFont(fixture, resolver, { embeddedFontPaint: "font" });
    compatible.getGlyphOutline(1);
    assert(compatible.diagnostics.some(value => /stroke-approxim/.test(value.code)));
    assert.equal(compatible.diagnostics.filter(value => value.code === compatibilityCode).length, 1);
  }

  const hairline = await parseNativePdfFont(type1Dictionary({ strokeWidth: 0 }), resolver);
  assert.equal(hairline.getGlyphOutline(1).intrinsicStroke, undefined, "zero width in the font cannot turn PDF Tr0 into a hairline");
  const compatibilityHairline = await parseNativePdfFont(type1Dictionary({ strokeWidth: 0 }), resolver, { embeddedFontPaint: "font" });
  assert.equal(compatibilityHairline.getGlyphOutline(1).intrinsicStroke.width, 0);
  await assert.rejects(parseNativePdfFont(type1Dictionary(), resolver, { embeddedFontPaint: "invalid" }), /embeddedFontPaint/);
  const ordinary = await parseNativePdfFont(type1Dictionary({ paintType: 0 }), resolver, { embeddedFontPaint: "font" });
  ordinary.getGlyphOutline(1);
  assert.deepEqual(ordinary.diagnostics, [], "compatibility option alone does not warn for ordinary filled fonts");
  console.log("Native embedded font paint policy passed: PDF default, explicit compatibility, Type1/CFF/CID/OpenType, independent caches, raw bounds, limits and warning deduplication.");
} finally { hooks.deregister(); }

function type1Fixture({ curve = false, strokeWidth = 100, paintType = 2 } = {}) {
  const commands = curve ? [0, 400, 200, 0, 0, -400, "rrcurveto"] :
    [200, 0, "rlineto", 0, 300, "rlineto", -200, 0, "rlineto"];
  return buildType1Fixture({ paintType, fontMatrix: matrix, clearExtra: `/StrokeWidth ${strokeWidth} def`, glyphs: [
    [".notdef", type1CharString(0, 600, "hsbw", "endchar")],
    ["A", type1CharString(50, 600, "hsbw", 0, 0, "rmoveto", ...commands, "closepath", "endchar")]
  ] });
}
function type1Dictionary(options) {
  const fixture = type1Fixture(options);
  const file = stream(fixture.bytes, new Map([["Length1", fixture.length1], ["Length2", fixture.length2], ["Length3", fixture.length3]]));
  return simpleDictionary(new Map([["FontFile", file]]));
}
function simpleDictionary(descriptor) {
  return new Map([["Subtype", name("Type1")], ["BaseFont", name("PaintFixture")], ["FontDescriptor", descriptor],
    ["Encoding", name("WinAnsiEncoding")], ["FirstChar", 65], ["Widths", [700]]]);
}
function cffDictionary({ sfnt = false, composite = false, ...options } = {}) {
  const bytes = buildCff(options);
  const descriptor = new Map([["FontFile3", stream(sfnt ? wrapSfnt(bytes) : bytes,
    new Map([["Subtype", name(sfnt ? "OpenType" : options.cid ? "CIDFontType0C" : "Type1C")]]))]]);
  if (!options.cid && !composite) return simpleDictionary(descriptor);
  const cid = options.cid ? 42 : 1;
  return new Map([["Subtype", name("Type0")], ["BaseFont", name("PaintFixture")], ["Encoding", name("Identity-H")],
    ["ToUnicode", stream(new TextEncoder().encode("1 begincodespacerange <0000> <ffff> endcodespacerange"))],
    ["DescendantFonts", [new Map([["Subtype", name("CIDFontType0")], ["FontDescriptor", descriptor], ["W", [cid, [700]]],
      ["CIDSystemInfo", new Map([["Registry", { kind: "string", bytes: new TextEncoder().encode("Adobe"), hex: false }],
        ["Ordering", { kind: "string", bytes: new TextEncoder().encode("Identity"), hex: false }], ["Supplement", 0]])]])]]]);
}

// Independent, fixed-offset CFF records (Adobe Technical Note 5176). Long
// DICT operands keep offsets stable; the CID case uses a real ROS/FDArray.
function buildCff({ curve = false, cid = false } = {}) {
  const header = Uint8Array.of(1, 0, 4, 4), names = index([new TextEncoder().encode("PaintFixture")]);
  const strings = index(cid ? [new TextEncoder().encode("Adobe"), new TextEncoder().encode("Identity")] : []), globalSubrs = index([]);
  const encoding = cid ? new Uint8Array() : Uint8Array.of(0, 1, 65);
  const charset = Uint8Array.of(0, 0, cid ? 42 : 34);
  const commands = curve ? [0, 400, 200, 0, 0, -400, "rrcurveto"] :
    [200, 0, "rlineto", 0, 300, "rlineto", -200, 0, "rlineto"];
  const charStrings = index([Uint8Array.of(14), type1CharString(50, 0, "rmoveto", ...commands, "endchar")]);
  const privateDict = concat(integer(600), Uint8Array.of(20));
  const fontDictionary = offset => concat(integer(privateDict.length), integer(offset), Uint8Array.of(18));
  const top = (encodingOffset, charsetOffset, glyphOffset, privateOffset, fdOffset, selectOffset) => concat(
    ...matrix.map(real), Uint8Array.of(12, 7), integer(2), Uint8Array.of(12, 5), integer(100), Uint8Array.of(12, 8),
    integer(charsetOffset), Uint8Array.of(15), integer(glyphOffset), Uint8Array.of(17),
    cid ? concat(integer(391), integer(392), integer(0), Uint8Array.of(12, 30),
      integer(fdOffset), Uint8Array.of(12, 36), integer(selectOffset), Uint8Array.of(12, 37))
      : concat(integer(encodingOffset), Uint8Array.of(16), fontDictionary(privateOffset)));
  const placeholder = index([top(0, 0, 0, 0, 0, 0)]);
  const encodingOffset = header.length + names.length + placeholder.length + strings.length + globalSubrs.length;
  const charsetOffset = encodingOffset + encoding.length, glyphOffset = charsetOffset + charset.length;
  const privateOffset = glyphOffset + charStrings.length, fdOffset = privateOffset + privateDict.length;
  const fdArray = cid ? index([fontDictionary(privateOffset)]) : new Uint8Array();
  return concat(header, names, index([top(encodingOffset, charsetOffset, glyphOffset, privateOffset, fdOffset, fdOffset + fdArray.length)]),
    strings, globalSubrs, encoding, charset, charStrings, privateDict, fdArray, cid ? Uint8Array.of(0, 0, 0) : new Uint8Array());
}
function index(objects) {
  if (!objects.length) return Uint8Array.of(0, 0);
  const length = objects.reduce((total, bytes) => total + bytes.length, 0);
  const bytes = new Uint8Array(3 + (objects.length + 1) * 2 + length), view = new DataView(bytes.buffer);
  view.setUint16(0, objects.length); bytes[2] = 2;
  let offset = 1, data = 3 + (objects.length + 1) * 2;
  for (let i = 0; i < objects.length; i++) {
    view.setUint16(3 + 2 * i, offset); bytes.set(objects[i], data); offset += objects[i].length; data += objects[i].length;
  }
  view.setUint16(3 + objects.length * 2, offset); return bytes;
}
function integer(value) {
  const bytes = new Uint8Array(5); bytes[0] = 29; new DataView(bytes.buffer).setInt32(1, value); return bytes;
}
function real(value) {
  const nibbles = [...String(value)].map(value => value === "." ? 10 : value === "-" ? 14 : Number(value));
  nibbles.push(15); if (nibbles.length % 2) nibbles.push(15);
  return Uint8Array.of(30, ...Array.from({ length: nibbles.length / 2 }, (_, i) => nibbles[i * 2] * 16 + nibbles[i * 2 + 1]));
}
function wrapSfnt(cff) {
  const head = new Uint8Array(54), maxp = new Uint8Array(6), hhea = new Uint8Array(36), hmtx = new Uint8Array(8), cmap = new Uint8Array(40);
  new DataView(head.buffer).setUint16(18, 2000);
  const maxpView = new DataView(maxp.buffer); maxpView.setUint32(0, 0x5000); maxpView.setUint16(4, 2);
  new DataView(hhea.buffer).setUint16(34, 2);
  const metricView = new DataView(hmtx.buffer);
  for (let i = 0; i < 2; i++) { metricView.setUint16(i * 4, 1500); metricView.setInt16(i * 4 + 2, 20); }
  const cmapView = new DataView(cmap.buffer);
  for (const [offset, value] of [[2, 1], [4, 3], [6, 10], [12, 12]]) cmapView.setUint16(offset, value);
  for (const [offset, value] of [[8, 12], [16, 28], [24, 1], [28, 65], [32, 65], [36, 1]]) cmapView.setUint32(offset, value);
  const tables = [["head", head], ["maxp", maxp], ["hhea", hhea], ["hmtx", hmtx], ["cmap", cmap], ["CFF ", cff]];
  const directory = 12 + 16 * tables.length;
  const bytes = new Uint8Array(directory + tables.reduce((total, [, value]) => total + Math.ceil(value.length / 4) * 4, 0));
  const view = new DataView(bytes.buffer); view.setUint32(0, 0x4f54544f); view.setUint16(4, tables.length);
  let offset = directory;
  tables.forEach(([tag, value], i) => {
    const record = 12 + 16 * i; bytes.set(new TextEncoder().encode(tag), record);
    view.setUint32(record + 8, offset); view.setUint32(record + 12, value.length); bytes.set(value, offset);
    offset += Math.ceil(value.length / 4) * 4;
  });
  return bytes;
}
