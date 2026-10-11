import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });
const { NativeCffFont } = await import("../src/pdf/nativeCff.ts");
const { PdfError } = await import("../src/pdf/nativeTypes.ts");

const cat = (...parts) => Uint8Array.from(parts.flatMap(part => [...part]));
const u16 = n => Uint8Array.of(n >>> 8, n & 255);
const u32 = n => Uint8Array.of(n >>> 24, n >>> 16 & 255, n >>> 8 & 255, n & 255);
const di = n => cat([29], u32(n));
function number(n) {
  if (n >= -107 && n <= 107) return Uint8Array.of(n + 139);
  if (n >= -32768 && n <= 32767) return cat([28], u16(n));
  throw new Error("Test number outside shortint range");
}
const cs = (...tokens) => cat(...tokens.map(token => typeof token === "number" ? number(token) : token));
function index(objects) {
  if (objects.length === 0) return u32(0);
  let length = 1;
  const offsets = [length];
  for (const bytes of objects) { length += bytes.length; offsets.push(length); }
  return cat(u32(objects.length), [4], ...offsets.map(u32), ...objects);
}
function variationStore(regions = [[[0, 1, 1]]], selections = [[0]]) {
  const axisCount = regions[0]?.length ?? 1;
  const regionBytes = cat(u16(axisCount), u16(regions.length), ...regions.flatMap(axes => axes.flatMap(axis => axis.map(n => u16(Math.round(n * 16384))))));
  const headerSize = 8 + selections.length * 4;
  let at = headerSize + regionBytes.length;
  const dataOffsets = selections.map(selection => { const result = at; at += 6 + selection.length * 2; return result; });
  const data = cat(u16(1), u32(headerSize), u16(selections.length), ...dataOffsets.map(u32), regionBytes,
    ...selections.map(selection => cat(u16(0), u16(0), u16(selection.length), ...selection.map(u16))));
  return cat(u16(data.length), data);
}
function fixture({ glyphs = [new Uint8Array(), cs(10, 20, [21], 100, 0, [5])],
  globals = [], locals = [[]], privateExtras = [], variation = null, fdSelect = null, topExtra = new Uint8Array() } = {}) {
  const globalIndex = index(globals), charIndex = index(glyphs);
  const privateDicts = locals.map((subrs, i) => {
    const extra = privateExtras[i] ?? new Uint8Array();
    return subrs.length ? cat(extra, di(extra.length + 6), [19]) : extra;
  });
  const localIndexes = locals.map(subrs => subrs.length ? index(subrs) : new Uint8Array());
  const topSize = 13 + (variation ? 6 : 0) + (fdSelect ? 7 : 0) + topExtra.length;
  const variationOffset = 5 + topSize + globalIndex.length;
  const charOffset = variationOffset + (variation?.length ?? 0);
  const fdOffset = charOffset + charIndex.length;
  const fdSize = index(privateDicts.map(() => new Uint8Array(11))).length;
  let at = fdOffset + fdSize;
  const dicts = privateDicts.map((bytes, i) => {
    const result = cat(di(bytes.length), di(bytes.length ? at : 0), [18]);
    at += bytes.length + localIndexes[i].length;
    return result;
  });
  const top = cat(di(charOffset), [17], di(fdOffset), [12, 36], variation ? cat(di(variationOffset), [24]) : [],
    fdSelect ? cat(di(at), [12, 37]) : [], topExtra);
  return cat([2, 0, 5], u16(top.length), top, globalIndex, variation ?? [], charIndex, index(dicts),
    ...privateDicts.flatMap((bytes, i) => [bytes, localIndexes[i]]), fdSelect ?? []);
}
function expectPdf(fn, code, pattern) {
  assert.throws(fn, error => error instanceof PdfError && error.code === code && pattern.test(error.message));
}
function testBasicCff2AndSubroutines() {
  const font = NativeCffFont.parse(fixture());
  assert.equal(font.numGlyphs, 2);
  assert.deepEqual(font.glyphNames, []);
  assert.equal(font.getGlyphOutline(0).commands.length, 0, "empty CFF2 glyph requires no endchar");
  const expected = [{ kind: "move", x: 10, y: 20 }, { kind: "line", x: 110, y: 20 }, { kind: "close" }];
  assert.deepEqual(font.getGlyphOutline(1).commands, expected);
  assert.equal(font.getGlyphOutline(1).advanceWidth, 0, "CFF2 metrics come from hmtx, not charstrings");
  const subr = NativeCffFont.parse(fixture({
    glyphs: [new Uint8Array(), cs(10, -107, [10], [21], -107, [29])],
    locals: [[cs(20)]], globals: [cs(100, 0, [5])]
  }));
  assert.deepEqual(subr.getGlyphOutline(1).commands, expected, "CFF2 end-of-data returns and shared operands work for local/global subroutines");
  const unknown = NativeCffFont.parse(fixture({ glyphs: [cs(20, 30, [12, 10], 10, 20, [21], 100, 0, [5], [14], 0, 40, [5])] }));
  assert.deepEqual(unknown.getGlyphOutline(0).commands.at(-2), { kind: "line", x: 110, y: 60 }, "removed CFF1 operators are ignored with cleared operands, without terminating CFF2");
}
function testVariationBlendsAndSelection() {
  const variation = variationStore([[[0, 1, 1]], [[-1, -1, 0]]], [[0, 1], [1]]);
  const glyph = cs(10, 20, [21], 100, 200, 40, -60, 80, -20, 2, [16], [5]);
  const bytes = fixture({ glyphs: [glyph], variation });
  const at = value => NativeCffFont.parse(bytes, {}, undefined, undefined, { normalizedCoordinates: [value] }).getGlyphOutline(0).commands[1];
  assert.deepEqual(at(0), { kind: "line", x: 110, y: 220 });
  assert.deepEqual(at(0.5), { kind: "line", x: 130, y: 260 }, "deltas are grouped by each default value, not each region");
  assert.deepEqual(at(-1), { kind: "line", x: 50, y: 200 });
  assert.deepEqual(at(1), { kind: "line", x: 150, y: 300 });
  const privateSelected = fixture({ glyphs: [cs(0, 0, [21], 100, -40, 1, [16], [6])], variation,
    privateExtras: [cs(1, [22], 50, 20, 1, [23], [10])] });
  const privateFont = NativeCffFont.parse(privateSelected, {}, undefined, undefined, { normalizedCoordinates: [-0.5] });
  assert.deepEqual(privateFont.getGlyphOutline(0).commands[1], { kind: "line", x: 80, y: 0 }, "Private DICT vsindex is inherited and its own blend operands are evaluated");
  const overridden = fixture({ glyphs: [cs(1, [15], 0, 0, [21], 100, -40, 1, [16], [6])], variation });
  assert.deepEqual(NativeCffFont.parse(overridden, {}, undefined, undefined, { normalizedCoordinates: [-1] }).getGlyphOutline(0).commands[1], { kind: "line", x: 60, y: 0 });
  const prefix = fixture({ glyphs: [cs(30, 20, 40, 1, [16], [21])], variation: variationStore() });
  assert.deepEqual(NativeCffFont.parse(prefix).getGlyphOutline(0).commands[0], { kind: "move", x: 30, y: 20 }, "blend preserves unrelated operands below its input group");
  const twoAxis = fixture({ glyphs: [cs(0, 0, [21], 100, 40, 1, [16], [6])], variation: variationStore([[[0, 1, 1], [-1, -1, 0]]]) });
  assert.deepEqual(NativeCffFont.parse(twoAxis, {}, undefined, undefined, { normalizedCoordinates: [0.5, -0.5] }).getGlyphOutline(0).commands[1], { kind: "line", x: 110, y: 0 }, "multi-axis region scalar is the product of axis scalars");
  const neutralAxis = fixture({ glyphs: [cs(0, 0, [21], 100, 40, 1, [16], [6])], variation: variationStore([[[-1, 0, 1]]]) });
  assert.deepEqual(NativeCffFont.parse(neutralAxis).getGlyphOutline(0).commands[1], { kind: "line", x: 140, y: 0 }, "peak zero removes an axis from the scalar calculation");
}
function testFdSelect4AndStackCapacity() {
  const manyLocals = Array.from({ length: 257 }, (_, i) => [cs(i, 0, [5])]);
  const fdSelect = cat([4], u32(1), u32(0), u16(256), u32(1));
  const font = NativeCffFont.parse(fixture({ glyphs: [cs(0, 0, [21], -107, [10])], locals: manyLocals, fdSelect }));
  assert.deepEqual(font.getGlyphOutline(0).commands[1], { kind: "line", x: 256, y: 0 }, "FDSelect4 retains uint16 dictionary indices above255");
  const large = fixture({ glyphs: [cs(0, 0, [21], ...Array(512).fill(1), [5])] });
  assert.equal(NativeCffFont.parse(large).getGlyphOutline(0).commands.length, 258, "CFF2 uses its 513-operand format stack rather than CFF1's48");
  expectPdf(() => NativeCffFont.parse(fixture({ glyphs: [cs(...Array(514).fill(1), [2])] })).getGlyphOutline(0), "unsupported-font", /513/);
}
function testMalformedCff2AndCallerLimits() {
  expectPdf(() => NativeCffFont.parse(Uint8Array.of(2, 0, 5, 0)), "unsupported-font", /CFF2/);
  const bytes = fixture();
  expectPdf(() => NativeCffFont.parse(bytes, { maxCffIndexEntries: 1 }), "resource-limit", /INDEX/);
  expectPdf(() => NativeCffFont.parse(bytes, { maxType2Operators: 1 }).getGlyphOutline(1), "resource-limit", /operators/);
  expectPdf(() => NativeCffFont.parse(bytes, { maxType2PathCommands: 1 }).getGlyphOutline(1), "resource-limit", /commands/);
  expectPdf(() => NativeCffFont.parse(fixture({ glyphs: [cs(0, 0, [21], 10, 1, [16], [6])] })).getGlyphOutline(0), "unsupported-font", /VariationStore/);
  expectPdf(() => NativeCffFont.parse(fixture({ glyphs: [cs(4, [15])], variation: variationStore() })).getGlyphOutline(0), "unsupported-font", /vsindex/);
  expectPdf(() => NativeCffFont.parse(fixture({ glyphs: [cs(0, [15], 0, [15])], variation: variationStore() })).getGlyphOutline(0), "unsupported-font", /vsindex/);
  expectPdf(() => NativeCffFont.parse(fixture({ glyphs: [cs(0, 0, [21], 10, 20, 1, [16], 0, [15])], variation: variationStore() })).getGlyphOutline(0), "unsupported-font", /vsindex/);
  expectPdf(() => NativeCffFont.parse(fixture({ glyphs: [cs(10, 2, [16])], variation: variationStore() })).getGlyphOutline(0), "unsupported-font", /blend/);
  expectPdf(() => NativeCffFont.parse(fixture({ variation: variationStore() }), {}, undefined, undefined, { normalizedCoordinates: [2] }), "unsupported-font", /coordinates/);
  expectPdf(() => NativeCffFont.parse(fixture({ variation: variationStore() }), {}, undefined, undefined, { normalizedCoordinates: [] }), "unsupported-font", /coordinates/);
  const badStore = variationStore(); badStore[badStore.length - 1] = 1;
  expectPdf(() => NativeCffFont.parse(fixture({ variation: badStore })), "unsupported-font", /region index/);
  const shortStore = variationStore(); shortStore[1] = 8;
  expectPdf(() => NativeCffFont.parse(fixture({ variation: shortStore })), "unsupported-font", /declared length/);
  const cycle = fixture({ glyphs: [cs(-107, [10])], locals: [[cs(-107, [10])]] });
  expectPdf(() => NativeCffFont.parse(cycle).getGlyphOutline(0), "unsupported-font", /cycle/);
  expectPdf(() => NativeCffFont.parse(fixture({ locals: [[], []] })), "unsupported-font", /FDSelect/);
  const badFd = cat([4], u32(1), u32(0), u16(2), u32(1));
  expectPdf(() => NativeCffFont.parse(fixture({ glyphs: [new Uint8Array()], fdSelect: badFd })), "unsupported-font", /missing Font DICT/);
  const controller = new AbortController(); controller.abort();
  expectPdf(() => NativeCffFont.parse(bytes, {}, undefined, controller.signal), "aborted", /abort/i);
  expectPdf(() => NativeCffFont.parse(bytes).getGlyphOutline(1, controller.signal), "aborted", /abort/i);
}
function testPrimaryOpenTypeExample() {
  // Microsoft's current CFF2 chapter publishes this complete226-byte table.
  // It exercises blended Private DICT arrays, local subrs and two active regions.
  const hex = `0200050007CF0C24C3119B1800000000002600010000000C00010000001C00010002C000E0000000C000C000E000000000000002000000010000000201010305200A200A00000001010105F706DA12779FF86C9DAE9AF49A959FB39F8B8B8B8B859A8B8B97738B8B8C808B8B8B8D8B8B8C8A8B8B971706FB8E95869D8B8B8D1707779FF86D9DAD9AF39A959FB39F08FB8D95091EA0375F0C098B0C0BC26E9E8C170ADB57F7028C170BB39A779F828A8D170C0CDB9557F702858B8D170C0DF706130000000101011BBDBDEF8C108B15F88827FB5C8C1006F88807FC88EFF75C8C1006`;
  const source = Uint8Array.from(Buffer.from(hex, "hex"));
  assert.equal(source.length, 226);
  const font = NativeCffFont.parse(source);
  assert.equal(font.numGlyphs, 2);
  assert.deepEqual(font.getGlyphOutline(0).bounds, [50, 0, 550, 500]);
  assert.deepEqual(font.getGlyphOutline(0).commands, font.getGlyphOutline(1).commands);
}

testBasicCff2AndSubroutines();
testVariationBlendsAndSelection();
testFdSelect4AndStackCapacity();
testMalformedCff2AndCallerLimits();
testPrimaryOpenTypeExample();
console.log("native CFF2 semantics tests passed (5 groups)");
hooks.deregister();
