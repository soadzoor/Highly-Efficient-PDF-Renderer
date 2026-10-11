import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });
try {
  const { NativeSfntFont, parseNativePdfFont } = await import("../src/pdf/nativeFont.ts");
  const { NativeCffFont } = await import("../src/pdf/nativeCff.ts");
  const { PdfError } = await import("../src/pdf/nativeTypes.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hepReader.ts");
  const name = value => ({ kind: "name", value });
  const resolver = { async resolveValue(value) { return value; }, async decodeStream(value) { return value.bytes; } };

  // The default rectangle is independently specified in Microsoft's complete
  // CFF2 example, also exercised by the raw CFF2 semantic suite.
  const cff2 = Uint8Array.from(Buffer.from("0200050007CF0C24C3119B1800000000002600010000000C00010000001C00010002C000E0000000C000C000E000000000000002000000010000000201010305200A200A00000001010105F706DA12779FF86C9DAE9AF49A959FB39F8B8B8B8B859A8B8B97738B8B8C808B8B8B8D8B8B8C8A8B8B971706FB8E95869D8B8B8D1707779FF86D9DAD9AF39A959FB39F08FB8D95091EA0375F0C098B0C0BC26E9E8C170ADB57F7028C170BB39A779F828A8D170C0CDB9557F702858B8D170C0DF706130000000101011BBDBDEF8C108B15F88827FB5C8C1006F88807FC88EFF75C8C1006", "hex"));
  const sfntBytes = wrapSfnt(cff2);
  const font = NativeSfntFont.parse(sfntBytes);
  assert.equal(font.outlineFormat, "cff2");
  assert.equal(font.unitsPerEm, 2048);
  assert.equal(font.numGlyphs, 2);
  assert.equal(font.mapCodePoint(65), 1);
  const glyph = font.getGlyphOutline(1);
  assert.deepEqual(glyph.bounds, [102.4, 0, 1126.4, 1024], "CFF2 outlines scale from FontMatrix units into sfnt unitsPerEm");
  assert.equal(glyph.advanceWidth, 1500, "OpenType advances come from hmtx, never CFF2's absent widths");
  assert.equal(glyph.leftSideBearing, -25, "OpenType side bearings come from hmtx, not the outline's left edge");
  assert.strictEqual(font.getGlyphOutline(1), glyph);
  assert(Object.isFrozen(glyph));
  assert.deepEqual(font.diagnostics, []);

  const stream = { kind: "stream", dictionary: new Map([["Subtype", name("OpenType")]]), bytes: sfntBytes };
  const descriptor = new Map([["Flags", 32], ["FontFile3", stream]]);
  const simple = await parseNativePdfFont(new Map([
    ["Subtype", name("Type1")], ["BaseFont", name("FixtureCff2")], ["FontDescriptor", descriptor],
    ["Encoding", name("WinAnsiEncoding")], ["FirstChar", 65], ["Widths", [777]]
  ]), resolver);
  const mapped = simple.decode(Uint8Array.of(65));
  assert.equal(mapped.glyphId, 1);
  assert.equal(mapped.unicode, "A");
  assert.equal(mapped.width, 777, "PDF Widths overrides hmtx for PDF positioning");
  assert.deepEqual(simple.getGlyphOutline(mapped.glyphId), glyph);
  assert.equal(simple.substitution, null);

  const descendant = new Map([["Subtype", name("CIDFontType0")], ["BaseFont", name("FixtureCff2")],
    ["CIDSystemInfo", new Map([["Registry", { kind: "string", bytes: new TextEncoder().encode("Adobe"), hex: false }],
      ["Ordering", { kind: "string", bytes: new TextEncoder().encode("Identity"), hex: false }], ["Supplement", 0]])],
    ["FontDescriptor", descriptor], ["DW", 1000], ["W", [1, [654]]]]);
  const composite = await parseNativePdfFont(new Map([["Subtype", name("Type0")], ["BaseFont", name("FixtureCff2")],
    ["Encoding", name("Identity-H")], ["DescendantFonts", [descendant]]]), resolver);
  assert.equal(composite.decode(Uint8Array.of(0, 1)).glyphId, 1);
  assert.equal(composite.decode(Uint8Array.of(0, 1)).width, 654);
  assert.deepEqual(composite.getGlyphOutline(1), glyph);
  const rawDescendant = new Map(descendant);
  rawDescendant.set("FontDescriptor", new Map([["Flags", 32], ["FontFile3", {
    kind: "stream", dictionary: new Map([["Subtype", name("CFF2")]]), bytes: cff2
  }]]));
  const raw = await parseNativePdfFont(new Map([["Subtype", name("Type0")], ["Encoding", name("Identity-H")],
    ["DescendantFonts", [rawDescendant]]]), resolver);
  assert.equal(raw.decode(Uint8Array.of(0, 1)).glyphId, 1);
  assert.deepEqual(raw.getGlyphOutline(1).bounds, [50, 0, 550, 500]);

  const limited = NativeSfntFont.parse(sfntBytes, 0, { maxType2Operators: 1 });
  assert.throws(() => limited.getGlyphOutline(1), error => error instanceof PdfError && error.code === "resource-limit");
  const controller = new AbortController();
  const cancellable = NativeSfntFont.parse(sfntBytes, 0, {}, "pdf-embedded", controller.signal);
  controller.abort();
  assert.throws(() => cancellable.getGlyphOutline(1), error => error instanceof PdfError && error.code === "aborted",
    "lazy CFF2 execution retains the sfnt caller's cancellation signal");
  assert.throws(() => NativeSfntFont.parse(sfntBytes, 0, {}, "pdf-embedded", controller.signal),
    error => error instanceof PdfError && error.code === "aborted");
  const diagnostics = [];
  const hep = await buildHep(buildPdf(sfntBytes), { compression: "deflate", withVectorLod: true, withTextLod: true,
    onDiagnostic: diagnostic => diagnostics.push(diagnostic) });
  const scene = await loadSceneFromHep(await hep.arrayBuffer());
  assert.equal(scene.pageCount, 1);
  assert.equal(scene.textInstanceCount, 1);
  assert.equal(scene.textGlyphCount, 1);
  assert(scene.textGlyphSegmentCount > 0);
  assert.deepEqual(diagnostics, [], "CFF2 survives complete PDF-to-HEP export without font fallback warnings");

  const realPath = process.argv[2];
  if (realPath) {
    const bytes = new Uint8Array(await readFile(realPath));
    const real = NativeSfntFont.parse(bytes);
    const tables = readTables(bytes);
    const rawFont = NativeCffFont.parse(tables.get("CFF2"));
    const view = new DataView(tables.get("hmtx").buffer, tables.get("hmtx").byteOffset, tables.get("hmtx").byteLength);
    const hhea = tables.get("hhea");
    const count = new DataView(hhea.buffer, hhea.byteOffset, hhea.byteLength).getUint16(34);
    let commands = 0;
    for (let id = 0; id < real.numGlyphs; id++) {
      const outline = real.getGlyphOutline(id);
      assert.deepEqual(outline.commands, rawFont.getGlyphOutline(id).commands);
      assert.equal(outline.advanceWidth, view.getUint16(Math.min(id, count - 1) * 4));
      assert.equal(outline.leftSideBearing, view.getInt16(id < count ? id * 4 + 2 : count * 4 + (id - count) * 2));
      commands += outline.commands.length;
    }
    assert.deepEqual(real.diagnostics, []);
    const events = [];
    const realHep = await buildHep(buildPdf(bytes), { compression: "deflate", withVectorLod: true, withTextLod: true,
      onDiagnostic: diagnostic => events.push(diagnostic) });
    const realScene = await loadSceneFromHep(await realHep.arrayBuffer());
    assert.equal(realScene.textInstanceCount, 1);
    assert(realScene.textGlyphSegmentCount > 0);
    assert.deepEqual(events, []);
    console.log(`Actual OpenType CFF2 integration: ${real.numGlyphs} glyphs, ${commands} commands, all hmtx metrics match; PDF-to-HEP ${realHep.size} bytes, zero diagnostics.`);
  }
  console.log("Native OpenType CFF2/PDF/HEP integration checks passed.");
} finally { hooks.deregister(); }

function readTables(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), result = new Map();
  for (let i = 0; i < view.getUint16(4); i++) {
    const at = 12 + i * 16, tag = String.fromCharCode(...bytes.subarray(at, at + 4));
    const offset = view.getUint32(at + 8), length = view.getUint32(at + 12);
    result.set(tag, bytes.subarray(offset, offset + length));
  }
  return result;
}
function wrapSfnt(cff2) {
  const tables = readTables(buildTinySfnt());
  tables.delete("glyf"); tables.delete("loca"); tables.set("CFF2", cff2);
  const head = tables.get("head"), headView = new DataView(head.buffer, head.byteOffset, head.byteLength);
  headView.setUint32(0, 0x00010000); headView.setUint32(12, 0x5f0f3cf5); headView.setUint16(18, 2048);
  const hhea = tables.get("hhea"), hheaView = new DataView(hhea.buffer, hhea.byteOffset, hhea.byteLength);
  hheaView.setUint32(0, 0x00010000); hheaView.setUint16(34, 2);
  const maxp = tables.get("maxp"), maxpView = new DataView(maxp.buffer, maxp.byteOffset, maxp.byteLength);
  maxpView.setUint32(0, 0x00005000); maxpView.setUint16(4, 2);
  const hmtx = new Uint8Array(8), hmtxView = new DataView(hmtx.buffer);
  hmtxView.setUint16(0, 700); hmtxView.setInt16(2, 17); hmtxView.setUint16(4, 1500); hmtxView.setInt16(6, -25); tables.set("hmtx", hmtx);
  const records = [...tables].sort(([a], [b]) => a.localeCompare(b));
  let total = 12 + records.length * 16;
  const offsets = records.map(([, bytes]) => { const at = total; total = (total + bytes.length + 3) & ~3; return at; });
  const result = new Uint8Array(total), view = new DataView(result.buffer);
  view.setUint32(0, 0x4f54544f); view.setUint16(4, records.length);
  const power = 2 ** Math.floor(Math.log2(records.length)); view.setUint16(6, power * 16); view.setUint16(8, Math.log2(power)); view.setUint16(10, records.length * 16 - power * 16);
  records.forEach(([tag, bytes], i) => {
    const at = 12 + i * 16; result.set(new TextEncoder().encode(tag), at);
    let checksum = 0;
    for (let offset = 0; offset < bytes.length; offset += 4) { let word = 0; for (let j = 0; j < 4; j++) word = (word * 256 + (bytes[offset + j] ?? 0)) >>> 0; checksum = (checksum + word) >>> 0; }
    view.setUint32(at + 4, checksum); view.setUint32(at + 8, offsets[i]); view.setUint32(at + 12, bytes.length); result.set(bytes, offsets[i]);
  });
  return result;
}
function buildPdf(fontBytes) {
  const encoder = new TextEncoder();
  const cat = (...parts) => Uint8Array.from(parts.flatMap(part => [...(typeof part === "string" ? encoder.encode(part) : part)]));
  const content = "BT /F1 30 Tf 20 30 Td (A) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /FixtureCff2 /FirstChar 65 /LastChar 65 /Widths [777] /Encoding /WinAnsiEncoding /FontDescriptor 6 0 R >>",
    "<< /Type /FontDescriptor /FontName /FixtureCff2 /Flags 32 /FontBBox [-100 -100 1500 1500] /ItalicAngle 0 /Ascent 1000 /Descent -100 /CapHeight 700 /StemV 80 /FontFile3 7 0 R >>",
    cat(`<< /Subtype /OpenType /Length ${fontBytes.length} >>\nstream\n`, fontBytes, "\nendstream")];
  const parts = [cat("%PDF-1.7\n")], offsets = [0]; let length = parts[0].length;
  for (let i = 0; i < objects.length; i++) { offsets.push(length); const bytes = cat(`${i + 1} 0 obj\n`, objects[i], "\nendobj\n"); parts.push(bytes); length += bytes.length; }
  parts.push(cat(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return cat(...parts);
}
