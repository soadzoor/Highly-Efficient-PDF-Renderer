import { layoutEditorText, editorTextPdf, type EditorTextLayout } from "./editorText";
import type { EditorFontRegistry } from "./editorFonts";
import type { EditorTextObject } from "./editorTypes";
import type { PdfCompositionTextBox, PdfCompositionTextStyle, PdfCompositionTextMetrics } from "./pdfCompositionTypes";
import type { PdfDiagnostic } from "./pdf/nativeTypes";
import { normalizePrimitiveColor } from "./colorInput";
import { waitForLoad } from "./loadCancellation";

export function compositionOpacity(value = 1): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError("Opacity must be between zero and one.");
  return value;
}
export function validateCompositionText(text: string, style: PdfCompositionTextStyle): void {
  if (typeof text !== "string") throw new TypeError("PDF text must be a string.");
  if (!Number.isFinite(style.fontSize) || style.fontSize <= 0) throw new RangeError("Font size must be positive and finite.");
  if (style.lineHeight !== undefined && (!Number.isFinite(style.lineHeight) || style.lineHeight <= 0)) throw new RangeError("Line height must be positive and finite.");
  for (const run of [style, ...(style.runs ?? [])]) {
    if ("text" in run && typeof run.text !== "string") throw new TypeError("Text runs require a string.");
    if (run.fontSize !== undefined && (!Number.isFinite(run.fontSize) || run.fontSize <= 0)) throw new RangeError("Run font size must be positive and finite.");
    compositionOpacity(run.opacity); compositionOpacity(run.backgroundOpacity);
    if (run.color !== undefined) normalizePrimitiveColor(run.color);
    if (run.backgroundColor != null) normalizePrimitiveColor(run.backgroundColor);
  }
}

export async function prepareCompositionText(text: string, style: PdfCompositionTextStyle, fonts: EditorFontRegistry,
  signal?: AbortSignal, onDiagnostic?: (diagnostic: PdfDiagnostic) => void, box?: PdfCompositionTextBox): Promise<{
    object: EditorTextObject; layout: EditorTextLayout; metrics: PdfCompositionTextMetrics; bounds: number[];
  }> {
  validateCompositionText(text, style); signal?.throwIfAborted();
  const warned = new Set<string>();
  const registry: EditorFontRegistry = { ...fonts, async resolve(request) {
    signal?.throwIfAborted(); const font = await waitForLoad(fonts.resolve(request), signal);
    const family = request.fontId ? fonts.get(request.fontId).family : request.fontFamily;
    if (family && font.family !== family && !warned.has(family)) {
      warned.add(family); onDiagnostic?.({ code: "composition.font-substitution", severity: "warning",
        message: `Font ${family} was substituted with ${font.family}. Supply the requested font bytes for exact typography.` });
    }
    return font;
  } };
  const object: EditorTextObject = { ...style, kind: "text", id: "composition-text", pageIndex: 0, transform: [1, 0, 0, 1, 0, 0],
    x: 0, y: 0, width: box?.width ?? 1, height: box?.height ?? 1, text,
    ...(box ? { align: box.align } : {}) };
  const layout = await layoutEditorText(object, registry, signal, { wrap: !!box, verticalAlignment: "top" });
  const shift = box ? box.verticalAlignment === "middle" ? (layout.height - box.height) / 2
    : box.verticalAlignment === "bottom" ? layout.height - box.height : 0 : -(layout.baselines?.[0] ?? 0);
  let ascent = 0, descent = 0, minX = 0, minY = 0, maxX = layout.width, maxY = 0;
  const runs = style.runs?.length ? style.runs : [{ text }];
  const ends: number[] = []; let offset = 0;
  for (const run of runs) { offset += run.text.length; ends.push(offset); }
  for (const glyph of layout.glyphs) {
    glyph.y += shift;
    let index = 0; while (index + 1 < ends.length && glyph.logicalIndex >= ends[index]) index++;
    const run = runs[index];
    glyph.opacity = run.opacity ?? 1;
    glyph.backgroundOpacity = run.backgroundOpacity ?? style.backgroundOpacity ?? 1;
    ascent = Math.max(ascent, glyph.ascent); descent = Math.min(descent, glyph.descent);
    // The form bounds must also contain italic overhangs and synthetic pens.
    minX = Math.min(minX, glyph.x - glyph.size); maxX = Math.max(maxX, glyph.x + Math.abs(glyph.advance) + glyph.size);
    minY = Math.min(minY, glyph.y + glyph.descent - glyph.size * .1); maxY = Math.max(maxY, glyph.y + glyph.ascent + glyph.size * .1);
    if (glyph.glyph === 0 && glyph.unicode.trim() && !warned.has("missing-glyph")) {
      warned.add("missing-glyph"); onDiagnostic?.({ code: "composition.missing-glyph", severity: "warning",
        message: "The supplied fonts lack one or more characters; their missing-glyph outlines are retained." });
    }
  }
  if (!layout.glyphs.length) {
    const hb = await import("harfbuzzjs"), font = await registry.resolve(style), face = new hb.Face(new hb.Blob(font.bytes));
    const metrics = new hb.Font(face).hExtents(); ascent = metrics.ascender * style.fontSize / face.upem; descent = metrics.descender * style.fontSize / face.upem;
    minY = descent; maxY = ascent;
  }
  return { object, layout, metrics: { width: layout.width, height: layout.height, ascent, descent },
    bounds: box ? [0, 0, box.width, box.height] : [minX, minY, Math.max(minX + 1, maxX), Math.max(minY + 1, maxY)] };
}

export async function compositionTextPdf(prepared: Awaited<ReturnType<typeof prepareCompositionText>>, fonts: EditorFontRegistry,
  signal?: AbortSignal, clip = false): Promise<Uint8Array> {
  return editorTextPdf(prepared.object, fonts, signal, { layout: prepared.layout, clip });
}
