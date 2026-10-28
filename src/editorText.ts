/// <reference path="./bidi-js.d.ts" />
import type { EditorTextObject, EditorTextRun } from "./editorTypes";
import type { EditorFont, EditorFontRegistry } from "./editorFonts";
import { PdfByteWriter, pdfName, pdfNumber as n, pdfRef, pdfUtf16Hex } from "./editorPdfBytes";
import { normalizePrimitiveColor } from "./primitiveAppearance";
import createBidi from "bidi-js";

export interface EditorPositionedGlyph {
  font: EditorFont; glyph: number; unicode: string; x: number; y: number;
  size: number; color: readonly number[]; underline: boolean; strikethrough: boolean;
  advance: number; italic: boolean; bold: boolean;
  logicalIndex: number;
}
export interface EditorTextLayout { glyphs: EditorPositionedGlyph[]; width: number; height: number }
const bidi = createBidi();

/** Canonical layout used by appearance generation and the visible editor scene. */
export async function layoutEditorText(object: EditorTextObject, fonts: EditorFontRegistry,
  signal?: AbortSignal): Promise<EditorTextLayout> {
  signal?.throwIfAborted();
  if (!(object.width > 0 && object.height > 0 && object.fontSize > 0)) throw new RangeError("Textbox dimensions and font size must be positive.");
  const hb = await import("harfbuzzjs");
  const runs = object.runs?.length ? object.runs : [{ text: object.text }];
  const fullText = runs.map(run => run.text).join("");
  const levels = bidi.getEmbeddingLevels(fullText);
  const tokens: { text: string; start: number; font: EditorFont; style: EditorTextRun; size: number; level: number }[] = [];
  let offset = 0;
  for (const run of runs) {
    const style = { ...object, ...run }; const font = await fonts.resolve(style);
    const size = style.fontSize ?? object.fontSize;
    if (!Number.isFinite(size) || size <= 0) throw new RangeError("Font sizes must be positive and finite.");
    for (const match of run.text.matchAll(/\r\n|[\r\n]|[^\S\r\n]+|[^\s]+/gu)) {
      const start = offset + match.index!;
      // Direction boundaries are split before shaping; script properties are
      // guessed by HarfBuzz per word, preserving joining and combining marks.
      const text = match[0]; let first = 0;
      for (let i = 1; i <= text.length; i++) if (i === text.length || levels.levels[start + i] !== levels.levels[start + first]) {
        tokens.push({ text: text.slice(first, i), start: start + first, font, style, size, level: levels.levels[start + first] ?? 0 }); first = i;
      }
    }
    offset += run.text.length;
  }
  interface Item { glyphs: EditorPositionedGlyph[]; width: number; height: number; start: number; end: number; level: number }
  const lines: Item[][] = [[]]; let lineWidth = 0;
  const fontCache = new Map<string, InstanceType<typeof hb.Font>>();
  const shape = (token: typeof tokens[number]): Item => {
    let font = fontCache.get(token.font.id);
    if (!font) { font = new hb.Font(new hb.Face(new hb.Blob(token.font.bytes))); fontCache.set(token.font.id, font); }
    const buffer = new hb.Buffer(); buffer.addText(token.text); buffer.guessSegmentProperties();
    buffer.setDirection(token.level % 2 ? hb.Direction.RTL : hb.Direction.LTR); hb.shape(font, buffer);
    const values = buffer.getGlyphInfosAndPositions();
    const boundaries = [...new Set(values.map(glyph => glyph.cluster))].sort((a, b) => a - b);
    const used = new Set<number>(); let x = 0;
    const scale = token.size / font.face.upem;
    const color = normalizePrimitiveColor(token.style.color ?? 0x000000);
    const glyphs = values.map(glyph => {
      const end = boundaries[boundaries.indexOf(glyph.cluster) + 1] ?? token.text.length;
      const unicode = used.has(glyph.cluster) ? "" : token.text.slice(glyph.cluster, end); used.add(glyph.cluster);
      const item: EditorPositionedGlyph = { font: token.font, glyph: glyph.codepoint, unicode,
        x: x + (glyph.xOffset ?? 0) * scale, y: (glyph.yOffset ?? 0) * scale,
        size: token.size, color, logicalIndex: token.start + glyph.cluster,
        underline: !!token.style.underline, strikethrough: !!token.style.strikethrough,
        advance: (glyph.xAdvance ?? 0) * scale,
        italic: (token.style.fontStyle === "italic" || token.style.fontStyle === "oblique") && token.font.fontStyle !== "italic",
        bold: (token.style.fontWeight === "bold" || Number(token.style.fontWeight) >= 600) && token.font.fontWeight < 600 };
      x += item.advance; return item;
    });
    return { glyphs, width: Math.abs(x), height: token.size * (object.lineHeight ?? 1.2), start: token.start,
      end: token.start + token.text.length - 1, level: token.level };
  };
  for (const token of tokens) {
    signal?.throwIfAborted();
    if (/^[\r\n]+$/.test(token.text)) { lines.push([]); lineWidth = 0; continue; }
    let item = shape(token);
    if (item.width > object.width && token.text.length > 1 && !/^\s+$/.test(token.text)) {
      // Break oversized words on grapheme boundaries, then reshape each piece
      // so contextual forms at the line boundaries remain correct.
      let text = "", start = token.start;
      for (const part of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(token.text)) {
        const candidate = shape({ ...token, text: text + part.segment, start });
        if (text && candidate.width > object.width) {
          const ready = shape({ ...token, text, start });
          if (lineWidth && lineWidth + ready.width > object.width) { lines.push([]); lineWidth = 0; }
          lines.at(-1)!.push(ready); lines.push([]); lineWidth = 0; start += text.length; text = "";
        }
        text += part.segment;
      }
      item = shape({ ...token, text, start });
    }
    if (lineWidth && lineWidth + item.width > object.width && !/^\s+$/.test(token.text)) { lines.push([]); lineWidth = 0; }
    lines.at(-1)!.push(item); lineWidth += item.width;
  }
  const glyphs: EditorPositionedGlyph[] = []; let y = object.y + object.height, widest = 0;
  for (const line of lines) {
    const width = line.reduce((sum, item) => sum + item.width, 0);
    widest = Math.max(widest, width);
    const height = Math.max(object.fontSize * (object.lineHeight ?? 1.2), ...line.map(item => item.height));
    y -= height;
    const first = line[0]?.start ?? 0, end = line.at(-1)?.end ?? first;
    const order = Array.from({ length: Math.max(0, end - first + 1) }, (_, i) => i + first);
    for (const [a, b] of bidi.getReorderSegments(fullText, levels, first, end)) {
      const slice = order.slice(a - first, b - first + 1).reverse(); order.splice(a - first, slice.length, ...slice);
    }
    const rank = new Map(order.map((index, i) => [index, i]));
    const visual = [...line].sort((a, b) => Math.min(...order.filter(i => i >= a.start && i <= a.end).map(i => rank.get(i)!)) -
      Math.min(...order.filter(i => i >= b.start && i <= b.end).map(i => rank.get(i)!)));
    let x = object.x + (object.align === "right" ? object.width - width : object.align === "center" ? (object.width - width) / 2 : 0);
    for (const item of visual) {
      for (const glyph of item.glyphs) glyphs.push({ ...glyph, x: glyph.x + x, y: glyph.y + y + height * 0.2 });
      x += item.width;
    }
  }
  return { glyphs, width: widest, height: object.y + object.height - y };
}

/** A portable PDF appearance using embedded source fonts and positioned glyphs. */
export async function editorTextPdf(object: EditorTextObject, fonts: EditorFontRegistry,
  signal?: AbortSignal): Promise<Uint8Array> {
  const layout = await layoutEditorText(object, fonts, signal);
  const hb = await import("harfbuzzjs");
  const writer = new PdfByteWriter({ signal }); const root = writer.reserve(), pages = writer.reserve();
  const fontResources: string[] = []; const codes = new Map<EditorPositionedGlyph, { name: string; code: string }>();
  const fontGroups = new Map<string, { asset: EditorFont; glyphs: EditorPositionedGlyph[] }>();
  const retainFont = (asset: EditorFont) => {
    if (!fontGroups.has(asset.id)) fontGroups.set(asset.id, { asset, glyphs: [] });
    return fontGroups.get(asset.id)!;
  };
  for (const glyph of layout.glyphs) retainFont(glyph.font).glyphs.push(glyph);
  // Preserve selected faces even for empty boxes/runs. Their editable PDF
  // appearance can then recover the exact font when the user types later.
  for (const run of [{ text: object.text }, ...(object.runs ?? [])]) {
    const style = { ...object, ...run };
    if (style.fontId) retainFont(fonts.get(style.fontId));
    retainFont(await fonts.resolve(style));
  }
  for (const { asset, glyphs: group } of fontGroups.values()) {
    const face = new hb.Face(new hb.Blob(asset.bytes)); const font = new hb.Font(face);
    const name = `F${fontResources.length}`, postscript = pdfName(face.getName(6, "en") || asset.family.replace(/\s/g, ""));
    const cff = !!face.referenceTable("CFF ") || !!face.referenceTable("CFF2");
    const file = await writer.stream(asset.bytes, cff ? "/Subtype /OpenType" : `/Length1 ${asset.bytes.length}`);
    const extents = font.hExtents(); const factor = 1000 / face.upem;
    const descriptor = writer.add(`<< /Type /FontDescriptor /FontName ${postscript} /FontFamily ${pdfUtf16Hex(asset.family)} /FontWeight ${n(asset.fontWeight)} /Flags 32 /FontBBox [-1000 -1000 3000 3000] /Ascent ${n(extents.ascender * factor)} /Descent ${n(extents.descender * factor)} /CapHeight ${n(extents.ascender * factor)} /ItalicAngle ${asset.fontStyle === "italic" ? -12 : 0} /StemV 80 /${cff ? "FontFile3" : "FontFile2"} ${pdfRef(file)} >>`);
    const unique = new Map<string, number>(), mappings: string[] = [], unicode: string[] = [];
    for (const glyph of group) {
      const key = `${glyph.glyph}:${glyph.unicode}`; let code = unique.get(key);
      if (code === undefined) {
        code = unique.size + 1; unique.set(key, code);
        const hex = code.toString(16).padStart(8, "0"); mappings.push(`<${hex}> ${glyph.glyph}`);
        unicode.push(`<${hex}> <${[...Array(glyph.unicode.length)].map((_, i) => glyph.unicode.charCodeAt(i).toString(16).padStart(4, "0")).join("")}>`);
      }
      codes.set(glyph, { name, code: code.toString(16).padStart(8, "0") });
    }
    const blocks = (rows: string[], op: string) => {
      const output: string[] = []; for (let i = 0; i < rows.length; i += 100) { const part = rows.slice(i, i + 100); output.push(`${part.length} begin${op}\n${part.join("\n")}\nend${op}`); } return output.join("\n");
    };
    const cmap = await writer.stream(`/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> def\n/CMapName /HEPREncoding def\n/CMapType 1 def\n1 begincodespacerange\n<00000000> <ffffffff>\nendcodespacerange\n${blocks(mappings, "cidchar")}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend end`);
    const toUnicode = await writer.stream(`/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CMapName /HEPRUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<00000000> <ffffffff>\nendcodespacerange\n${blocks(unicode, "bfchar")}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend end`);
    const glyphIds = [...new Set(group.map(glyph => glyph.glyph))].sort((a, b) => a - b);
    const widths = glyphIds.map(glyph => `${glyph} [${n(font.glyphHAdvance(glyph) * factor)}]`).join(" ");
    const descendant = writer.add(`<< /Type /Font /Subtype /${cff ? "CIDFontType0" : "CIDFontType2"} /BaseFont ${postscript} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${pdfRef(descriptor)} /CIDToGIDMap /Identity /DW 1000 /W [${widths}] >>`);
    const type0 = writer.add(`<< /Type /Font /Subtype /Type0 /BaseFont ${postscript} /Encoding ${pdfRef(cmap)} /DescendantFonts [${pdfRef(descendant)}] /ToUnicode ${pdfRef(toUnicode)} >>`);
    fontResources.push(`/${name} ${pdfRef(type0)}`);
  }
  const opacity = object.opacity ?? 1;
  const alpha = writer.add(`<< /Type /ExtGState /ca ${n(opacity)} /CA ${n(opacity)} >>`);
  const commands = ["q", "/HEPRTextAlpha gs", `${n(object.x)} ${n(object.y)} ${n(object.width)} ${n(object.height)} re W n`];
  // Absolute positions determine appearance. Emit clusters in logical order so
  // searchable Unicode retains bidi semantics without collapsing a whole box
  // into one ActualText selection quad.
  for (const glyph of [...layout.glyphs].sort((a, b) => a.logicalIndex - b.logicalIndex)) {
    const code = codes.get(glyph)!;
    commands.push(`${glyph.color.map(n).join(" ")} rg ${glyph.color.map(n).join(" ")} RG`, "BT", `/${code.name} ${n(glyph.size)} Tf`,
      glyph.bold ? `${n(glyph.size * .025)} w 2 Tr` : "0 Tr",
      `1 0 ${glyph.italic ? ".212556" : "0"} 1 ${n(glyph.x)} ${n(glyph.y)} Tm <${code.code}> Tj`, "ET");
    for (const offset of [glyph.underline ? -.1 : null, glyph.strikethrough ? .3 : null]) if (offset !== null) {
      commands.push(`${n(glyph.x)} ${n(glyph.y + offset * glyph.size)} ${n(glyph.advance)} ${n(glyph.size * .05)} re f`);
    }
  }
  commands.push("Q"); const content = await writer.stream(commands.join("\n"));
  const page = writer.add(`<< /Type /Page /Parent ${pdfRef(pages)} /MediaBox [0 0 ${n(Math.max(1, object.x + object.width))} ${n(Math.max(1, object.y + object.height))}] /Resources << /Font << ${fontResources.join(" ")} >> /ExtGState << /HEPRTextAlpha ${pdfRef(alpha)} >> >> /Contents ${pdfRef(content)} >>`);
  writer.set(pages, `<< /Type /Pages /Count 1 /Kids [${pdfRef(page)}] >>`); writer.set(root, `<< /Type /Catalog /Pages ${pdfRef(pages)} >>`);
  return writer.build(root);
}
