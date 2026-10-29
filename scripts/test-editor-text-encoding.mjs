import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });

try {
  const { allocateEditorTextCodes } = await import("../src/editorTextEncoding.ts");
  assert.deepEqual(allocateEditorTextCodes([]), { partitions: [[]], codes: [] }, "empty text retains an embedded font resource");
  const repeated = Object.freeze([
    Object.freeze({ glyph: 7, unicode: "A" }), Object.freeze({ glyph: 7, unicode: "A" }),
    Object.freeze({ glyph: 8, unicode: "A" }), Object.freeze({ glyph: 7, unicode: "B" }),
    Object.freeze({ glyph: 9, unicode: "" }), Object.freeze({ glyph: 9, unicode: "" }),
    Object.freeze({ glyph: 10, unicode: "\u{1d400}" }), Object.freeze({ glyph: 10, unicode: "ffi" }),
    Object.freeze({ glyph: 0, unicode: "\u{10ffff}" })
  ]);
  const allocated = allocateEditorTextCodes(repeated);
  assert.deepEqual(allocated.codes, [1, 1, 2, 3, 4, 4, 5, 6, 7].map(code => ({ partition: 0, code })));
  assert.deepEqual(allocated.partitions[0], [repeated[0], repeated[2], repeated[3], repeated[4], repeated[6], repeated[7], repeated[8]]
    .map((glyph, index) => ({ ...glyph, code: index + 1 })), "GIDs, Unicode aliases, cluster continuations, ligatures and surrogate pairs remain distinct when required");
  const capacity = Array.from({ length: 0x10000 }, (_, index) => ({ glyph: 1, unicode: String.fromCodePoint(0x10000 + index) }));
  const full = allocateEditorTextCodes(capacity.slice(0, 0xffff));
  assert.equal(full.partitions.length, 1); assert.equal(full.partitions[0].length, 0xffff);
  assert.deepEqual(full.codes.at(-1), { partition: 0, code: 0xffff });
  const rollover = allocateEditorTextCodes([...capacity, capacity[0], capacity[0xfffe], capacity[0xffff]]);
  assert.deepEqual(rollover.partitions.map(part => part.length), [0xffff, 1], "an additional resource handles the two-byte format boundary without rejecting input");
  assert.deepEqual(rollover.codes.slice(-4), [
    { partition: 1, code: 1 }, { partition: 0, code: 1 }, { partition: 0, code: 0xffff }, { partition: 1, code: 1 }
  ], "repeated pairs reuse their original resource even after rollover");
  for (const partition of rollover.partitions) for (const entry of partition) assert(entry.code >= 1 && entry.code <= 0xffff);
  assert.throws(() => allocateEditorTextCodes([], AbortSignal.abort()), { name: "AbortError" });
  const cancel = new AbortController(); let checks = 0;
  assert.throws(() => allocateEditorTextCodes(capacity, { throwIfAborted() {
    if (++checks === 100) cancel.abort(); cancel.signal.throwIfAborted();
  } }), { name: "AbortError" });
  assert.equal(checks, 100, "allocation checks cancellation during long inputs");

  const { createEditorFontRegistry } = await import("../src/editorFonts.ts");
  const { editorTextPdf, layoutEditorText } = await import("../src/editorText.ts");
  const { NativeSfntFont } = await import("../src/pdf/nativeFont.ts");
  const { getScenePrimitive } = await import("../src/scenePrimitives.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { NativePdfFormAppearanceRegistry } = await import("../src/pdf/nativeForms.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const fonts = createEditorFontRegistry({ loadAsset: async url => new Uint8Array(await readFile(url)) });
  const regular = await fonts.loadBundled("Liberation Sans"), otf = await fonts.register(tinyOpenTypeCff(), { family: "Tiny" });
  const model = { id: "encoding-test", kind: "text", pageIndex: 0, transform: [1, 0, 0, 1, 0, 0],
    x: 10, y: 10, width: 300, height: 100, fontSize: 14, text: "x\u0301 q\u0338 x\u0323\u0300", fontId: regular.id };
  const utf16 = text => Array.from({ length: text.length }, (_, index) => text.charCodeAt(index).toString(16).padStart(4, "0")).join("");
  const decoder = new TextDecoder();
  async function inspect(document, rawResources, content, layout, expectedFont) {
    const resources = await document.resolveDictionary(rawResources), fontResources = await document.resolveDictionary(resources.get("Font"));
    const mappings = new Map();
    for (const [name, value] of fontResources) {
      const type0 = await document.resolveDictionary(value);
      assert.equal(type0.get("Subtype")?.value, "Type0");
      const encoding = await document.resolveValue(type0.get("Encoding")), unicode = await document.resolveValue(type0.get("ToUnicode"));
      assert.equal(encoding?.kind, "stream"); assert.equal(unicode?.kind, "stream");
      const encodingText = decoder.decode(await document.decodeStream(encoding)), unicodeText = decoder.decode(await document.decodeStream(unicode));
      for (const [stream, body, ordering] of [[encoding, encodingText, "Identity"], [unicode, unicodeText, "UCS"]]) {
        assert.equal(stream.dictionary.get("Type")?.value, "CMap");
        const cmapName = stream.dictionary.get("CMapName")?.value;
        assert(cmapName); assert(body.includes(`/CMapName /${cmapName} def`));
        const info = await document.resolveDictionary(stream.dictionary.get("CIDSystemInfo"));
        assert.equal(decoder.decode(info.get("Registry").bytes), "Adobe"); assert.equal(decoder.decode(info.get("Ordering").bytes), ordering);
        assert.match(body, /1 begincodespacerange\s*<0000> <ffff>\s*endcodespacerange/i,
          "a single two-byte codespace avoids PDFium's single-four-byte-range fallback");
        assert.doesNotMatch(body, /<00000000>/);
      }
      assert.equal(encoding.dictionary.get("WMode"), 0); assert.match(encodingText, /\/WMode 0 def/);
      assert.doesNotMatch(unicodeText, /<[0-9a-f]+>\s*<>/i, "continuation glyphs do not generate empty Unicode destinations");
      const cid = new Map([...encodingText.matchAll(/<([0-9a-f]{4})>\s+(\d+)/gi)].map(match => [match[1].toLowerCase(), Number(match[2])]));
      const text = new Map([...unicodeText.matchAll(/<([0-9a-f]{4})>\s+<([0-9a-f]+)>/gi)]
        .filter(match => match[1].toLowerCase() !== "0000").map(match => [match[1].toLowerCase(), match[2].toLowerCase()]));
      mappings.set(name, { cid, text });
      const descendants = await document.resolveValue(type0.get("DescendantFonts")), descendant = await document.resolveDictionary(descendants[0]);
      const descriptor = await document.resolveDictionary(descendant.get("FontDescriptor"));
      if (expectedFont.id !== otf.id) assert.equal(type0.get("BaseFont")?.value, descendant.get("BaseFont")?.value);
      assert.equal(descriptor.get("FontName")?.value, descendant.get("BaseFont")?.value);
      const cff = expectedFont.id === otf.id, file = await document.resolveValue(descriptor.get(cff ? "FontFile3" : "FontFile2"));
      assert.equal(descendant.get("Subtype")?.value, cff ? "CIDFontType0" : "CIDFontType2");
      if (cff) { assert(!descendant.has("CIDToGIDMap")); assert.equal(file.dictionary.get("Subtype")?.value, "OpenType"); }
      else { assert.equal(descendant.get("CIDToGIDMap")?.value, "Identity"); assert.equal(file.dictionary.get("Length1"), expectedFont.bytes.length); }
      assert.deepEqual(await document.decodeStream(file), expectedFont.bytes, "the original source font program survives embedding exactly");
    }
    const shown = [...content.matchAll(/\/(F\d+)\s+[\d.]+\s+Tf[\s\S]*?<([0-9a-f]+)>\s+Tj/gi)];
    const logical = [...layout.glyphs].sort((a, b) => a.logicalIndex - b.logicalIndex), owners = logical.filter(glyph => glyph.unicode);
    assert.equal(shown.length, owners.length, "only cluster owners emit PDF text that independent readers extract");
    assert.doesNotMatch(content, /\/ActualText/, "continuation marks do not rely on empty ActualText that some readers ignore");
    assert.equal((content.match(/^(?:f\*?|B\*?)$/gm) ?? []).length, logical.filter(glyph => !glyph.unicode).length,
      "every continuation mark is painted once as a font-derived vector outline");
    for (const [index, command] of shown.entries()) {
      const glyph = owners[index], code = command[2].toLowerCase(), mapping = mappings.get(command[1]);
      assert.equal(code.length, 4, "each positioned glyph is encoded as exactly two bytes"); assert.notEqual(code, "0000");
      assert.equal(mapping.cid.get(code), glyph.glyph, "text codes select the shaped glyph rather than an accidental byte or Unicode value");
      assert.equal(mapping.text.get(code), glyph.unicode ? utf16(glyph.unicode) : undefined);
    }
  }
  const nativeFont = NativeSfntFont.parse(regular.bytes);
  function assertMarkGeometry(scene, layout) {
    const continuation = [...layout.glyphs].sort((a, b) => a.logicalIndex - b.logicalIndex).filter(glyph => !glyph.unicode);
    assert.equal(scene.textInstanceCount, layout.glyphs.filter(glyph => glyph.unicode && !/^\s+$/u.test(glyph.unicode)).length,
      "cluster owners retain searchable text instances while continuation marks paint separately");
    assert.equal(scene.fillPathCount, continuation.length, "all four combining marks remain vector fills");
    for (const [index, glyph] of continuation.entries()) {
      const [left, bottom, right, top] = nativeFont.getGlyphOutline(glyph.glyph).bounds, scale = glyph.size / nativeFont.unitsPerEm;
      const box = { minX: glyph.x + left * scale, maxX: glyph.x + right * scale,
        minY: glyph.y + bottom * scale, maxY: glyph.y + top * scale };
      const expected = box;
      const actual = getScenePrimitive(scene, { kind: "fill", index }).bounds;
      for (const key of ["minX", "minY", "maxX", "maxY"]) assert(Math.abs(actual[key] - expected[key]) < .01,
        `continuation fill geometry matches the source font outline at the shaped glyph's page position: ${JSON.stringify({ index, glyph: glyph.glyph, key, actual, expected })}`);
    }
  }
  try {
    for (const [font, text] of [[regular, model.text], [regular, "Chrome résumé Ω a\u0301\u0315 ffi \u{1d400}"], [otf, "AAA"]]) {
      const object = { ...model, fontId: font.id, text };
      const layout = await layoutEditorText(object, fonts), bytes = await editorTextPdf(object, fonts);
      if (font.id === regular.id) assert(layout.glyphs.some(glyph => !glyph.unicode), "the fixture exercises continuation glyphs sharing a cluster");
      const document = await NativePdfDocument.open({ kind: "bytes", bytes });
      try { await inspect(document, document.getPage(0).resources,
        (await document.getDecodedPageContents(0)).map(bytes => decoder.decode(bytes)).join("\n"), layout, font); }
      finally { await document.close(); }
      if (text === model.text) {
        const parser = await openPdf({ kind: "bytes", bytes }); let compiled;
        try { compiled = await parser.compileVectorPage(0, { optimization: "none" }); } finally { await parser.close(); }
        assert.equal(compiled.textIndex.pages[0].text, model.text, "direct PDF extraction preserves the exact logical combining-mark clusters");
        assert.doesNotMatch(compiled.textIndex.pages[0].text, /[\ufffd\u0000-\u001f\u007f-\u009f]/u, "continuations add no replacement or control characters");
        assertMarkGeometry(compiled, layout);
      }
    }
    const syntheticFonts = { ...fonts, async resolve() { return regular; } };
    const styled = { ...model, fontWeight: 700, fontStyle: "italic", color: [.2, .4, .8], opacity: .45, underline: true, strikethrough: true };
    const styledLayout = await layoutEditorText(styled, syntheticFonts);
    assert(styledLayout.glyphs.every(glyph => glyph.bold && glyph.italic), "the imported-face fixture exercises synthetic styling on owners and continuation marks");
    const styledBytes = await editorTextPdf(styled, syntheticFonts), styledDocument = await NativePdfDocument.open({ kind: "bytes", bytes: styledBytes });
    try {
      const content = (await styledDocument.getDecodedPageContents(0)).map(bytes => decoder.decode(bytes)).join("\n");
      await inspect(styledDocument, styledDocument.getPage(0).resources, content, styledLayout, regular);
      const marks = styledLayout.glyphs.filter(glyph => !glyph.unicode);
      assert.equal((content.match(/^B$/gm) ?? []).length, marks.length, "synthetic bold continuation marks retain fill-and-stroke painting");
      assert.equal((content.match(/ re f$/gm) ?? []).length, styledLayout.glyphs.length * 2, "underline and strikethrough remain present for the complete shaped text");
      const scale = styled.fontSize / nativeFont.unitsPerEm;
      for (const glyph of marks) assert(content.includes(`${scale} 0 ${scale * .212556} ${scale} ${glyph.x} ${glyph.y} cm`),
        "continuation outlines retain synthetic italic shear at their shaped positions");
    } finally { await styledDocument.close(); }
    const styledParser = await openPdf({ kind: "bytes", bytes: styledBytes }); let styledScene;
    try { styledScene = await styledParser.compileVectorPage(0, { optimization: "none" }); } finally { await styledParser.close(); }
    assert.equal(styledScene.textIndex.pages[0].text, model.text);
    assert(styledScene.fillPathCount > 4 && styledScene.segmentCount > 0, "styled continuation outlines and text decorators retain vector painting");
    for (let index = 0; index < styledScene.fillPathCount; index++) {
      const primitive = getScenePrimitive(styledScene, { kind: "fill", index });
      for (let axis = 0; axis < 3; axis++) assert(Math.abs(primitive.color[axis] - styled.color[axis]) < 1e-6);
      assert(Math.abs(primitive.opacity - styled.opacity) < 1e-6, "continuation marks and decorators inherit the textbox's opacity");
    }
    const sourcePdf = writeTinyPdf({ objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << >> /Contents 4 0 R >>" },
      { number: 4, body: tinyPdfStream("", "") }
    ] });
    const parser = await openPdf({ kind: "bytes", bytes: sourcePdf }); let scene;
    try { scene = await parser.compileVectorPage(0, { optimization: "none" }); } finally { await parser.close(); }
    const services = await createEditorAppServices({ sourcePdf, loadFontAsset: async url => new Uint8Array(await readFile(url)) });
    await services.fonts.register(regular.bytes, { family: regular.family });
    const editor = await openEditorSession(scene, services.sessionOptions); let saved;
    try { editor.addObject(model); saved = new Uint8Array(await (await editor.savePdf()).arrayBuffer()); }
    finally { editor.dispose(); services.dispose(); }
    const document = await NativePdfDocument.open({ kind: "bytes", bytes: saved });
    try {
      const registry = new NativePdfFormAppearanceRegistry(document), annotations = await registry.listPageAnnotations(0, undefined, true);
      const annotation = annotations.find(item => item.dictionary.get("Subtype")?.value === "FreeText"); assert(annotation);
      const appearances = await document.resolveDictionary(annotation.dictionary.get("AP")), appearance = await document.resolveValue(appearances.get("N"));
      await inspect(document, appearance.dictionary.get("Resources"), decoder.decode(await document.decodeStream(appearance)), await layoutEditorText(model, fonts), regular);
    } finally { await document.close(); }
    const savedParser = await openPdf({ kind: "bytes", bytes: saved }); let savedScene;
    try { savedScene = await savedParser.compileVectorPage(0, { optimization: "none" }); } finally { await savedParser.close(); }
    assert.equal(savedScene.textIndex.pages[0].text, model.text, "normal saved FreeText extraction retains the exact logical cluster text");
    assert.doesNotMatch(savedScene.textIndex.pages[0].text, /[\ufffd\u0000-\u001f\u007f-\u009f]/u);
    const expected = await layoutEditorText(model, fonts);
    assertMarkGeometry(savedScene, expected);
  } finally { fonts.dispose(); }
  console.log("Editor text encoding: two-byte capacity/rollover/dedup/cancellation, TTF/OTF CMaps, Unicode, original font bytes and saved FreeText appearances passed.");
} finally { hooks.deregister(); }

/** Minimal name-keyed CFF OTF using the existing fixture's SFNT metrics/cmap. */
function tinyOpenTypeCff() {
  const concat = (...parts) => Uint8Array.from(parts.flatMap(part => [...part]));
  const index = entries => entries.length ? concat([0, entries.length, 1],
    [1, ...entries.map((_, i) => 1 + entries.slice(0, i + 1).reduce((sum, part) => sum + part.length, 0))], ...entries) : Uint8Array.of(0, 0);
  const cff = concat([1, 0, 4, 4], index([new TextEncoder().encode("Tiny")]), index([[29, 0, 0, 0, 28, 17]]),
    index([]), index([]), index([[14], [139, 139, 21, 239, 139, 139, 239, 39, 39, 5, 14]]));
  const source = buildTinySfnt(), input = new DataView(source.buffer), tables = [];
  for (let index = 0; index < input.getUint16(4); index++) {
    const record = 12 + index * 16, tag = new TextDecoder().decode(source.subarray(record, record + 4));
    if (tag === "glyf" || tag === "loca") continue;
    const offset = input.getUint32(record + 8), size = input.getUint32(record + 12), bytes = source.slice(offset, offset + size);
    if (tag === "maxp") { new DataView(bytes.buffer).setUint32(0, 0x00005000); new DataView(bytes.buffer).setUint16(4, 2); }
    if (tag === "hhea") new DataView(bytes.buffer).setUint16(34, 2);
    tables.push([tag, tag === "hmtx" ? bytes.slice(0, 8) : bytes]);
  }
  tables.push(["CFF ", cff]);
  const directory = 12 + tables.length * 16, total = directory + tables.reduce((sum, [, bytes]) => sum + Math.ceil(bytes.length / 4) * 4, 0);
  const bytes = new Uint8Array(total), output = new DataView(bytes.buffer); let offset = directory;
  output.setUint32(0, 0x4f54544f); output.setUint16(4, tables.length);
  for (const [index, [tag, table]] of tables.entries()) {
    const record = 12 + index * 16; bytes.set(new TextEncoder().encode(tag), record);
    output.setUint32(record + 8, offset); output.setUint32(record + 12, table.length); bytes.set(table, offset);
    offset += Math.ceil(table.length / 4) * 4;
  }
  return bytes;
}
