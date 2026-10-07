import { compileGroupedVectorPageContent, scanDensePdfPreparedResourceReferences, type DensePdfContentSegment } from "./nativeContentCompiler";
import { NativePageFontRegistry } from "./nativeFontResources";
import { parseNativePdfFont, type NativeGlyphOutline, type NativeGlyphPathCommand, type NativeMissingFontResolver, type NativePdfFont } from "./nativeFont";
import { prepareNativeInlineImages } from "./nativeInlineImage";
import { NativeTextCompiler, type NativeTextFontResource } from "./nativeText";
import { buildNativeVectorPage } from "./nativeVectorPage";
import { computeNativePdfPageGeometry } from "./nativePageGeometry";
import { isPdfName, isPdfStream, type PdfDictionary, type PdfValue } from "./nativeCos";
import { PdfError, type PdfDiagnostic } from "./nativeTypes";
import type { NativePdfDocument } from "./nativeDocument";
import type { NativeOptionalContentRegistry } from "./nativeOptionalContent";
import type { NativeVectorCompileOptions } from "../pdfSession";

const TEXT_OPERATORS = new Set(["q", "Q", "cm", "BT", "ET", "Tf", "Tc", "Tw", "Tz", "TL", "Ts", "Td", "TD", "Tm", "T*", "Tj", "TJ", "'", '"', "Do", "gs", "BMC", "BDC", "EMC"]);
const fallbackFonts = new WeakMap<NativeMissingFontResolver, Promise<NativePdfFont>>();

/** A viewing approximation: keep stored Unicode and positioning, never decode scan pixels. */
export async function compileNativeOcrTextPage(document: NativePdfDocument, sourcePageIndex: number,
  options: NativeVectorCompileOptions, signal: AbortSignal, missingFontResolver: NativeMissingFontResolver | undefined,
  optionalContent: NativeOptionalContentRegistry, onDiagnostic: (diagnostic: PdfDiagnostic) => void) {
  const page = document.getPage(sourcePageIndex);
  const { pageMatrix, pageBounds } = computeNativePdfPageGeometry(page);
  const { nativeVectorMissingFontResolver } = await import("../pdfVectorExtractor");
  const bundledResolver = await nativeVectorMissingFontResolver();
  let pending = fallbackFonts.get(bundledResolver);
  if (!pending) {
    pending = parseNativePdfFont(new Map<string, PdfValue>([
      ["Subtype", { kind: "name", value: "Type1" }], ["BaseFont", { kind: "name", value: "Helvetica" }]
    ]), document, { missingFontResolver: bundledResolver });
    fallbackFonts.set(bundledResolver, pending);
    void pending.catch(() => fallbackFonts.delete(bundledResolver));
  }
  const fallback = await pending;
  signal.throwIfAborted();
  const registry = new NativePageFontRegistry(document, sourcePageIndex, missingFontResolver ?? bundledResolver);
  const fonts = new Map<string, NativeTextFontResource>();
  const fontResources: NativeTextFontResource[] = [];
  const aliases = new Map<number, string>();
  const text: string[] = [];
  let commandCount = 0, sourceBytes = 0, syntheticBytes = 0;
  const maxCommands = options.limits?.maxCommandsPerPage ?? document.limits.maxCommandsPerPage;
  const maxBytes = document.limits.maxDecodedStreamBytes;
  const activeForms = new Set<unknown>();
  const alias = (resource: NativeTextFontResource) => {
    let name = aliases.get(resource.fontIndex);
    if (!name) {
      name = `OCR${fontResources.length}`;
      const wrapped = { fontIndex: fontResources.length, font: substituteOcrFont(resource.font, fallback) };
      aliases.set(resource.fontIndex, name); fonts.set(name, wrapped); fontResources.push(wrapped);
    }
    return name;
  };
  const emit = (operator: string, operands: readonly unknown[] = []) => {
    const line = `${operands.map(serializeOperand).join(" ")} ${operator}\n`;
    syntheticBytes += line.length;
    if (syntheticBytes > maxBytes) throw new PdfError("resource-limit", "OCR text exceeds the decoded content limit.");
    text.push(line);
  };
  const walk = async (streams: readonly import("./nativeCos").PdfStream[], resources: PdfDictionary, depth: number) => {
    if (depth > document.limits.maxRecursionDepth) throw new PdfError("resource-limit", "OCR Form nesting exceeds the page limit.");
    const segments: DensePdfContentSegment[] = [];
    let offset = 0;
    for (const stream of streams) {
      const bytes = await document.decodeStream(stream, signal);
      sourceBytes += bytes.length;
      if (sourceBytes > maxBytes) throw new PdfError("resource-limit", "OCR content exceeds the decoded content limit.");
      // Inline payloads are bounded and skipped; no image codec or color conversion runs.
      const prepared = prepareNativeInlineImages(bytes, { signal, sourceOffset: offset });
      segments.push(...prepared.segments.map(segment => segment.kind === "content" ? segment : {
        kind: "image" as const, imageIndex: 0, sourceOffset: segment.sourceOffset, sourceLength: segment.sourceLength
      }));
      offset += bytes.length;
      segments.push({ kind: "content", bytes: Uint8Array.of(10), sourceOffset: offset++, sourceLength: 1 });
    }
    const operators: { operator: string; operands: readonly unknown[]; property?: PdfValue }[] = [];
    scanDensePdfPreparedResourceReferences(segments, { signal, onOperator(operator, operands, property) {
      if (++commandCount > maxCommands) throw new PdfError("resource-limit", "OCR content exceeds the page command limit.");
      if (TEXT_OPERATORS.has(operator)) operators.push({ operator, operands, property });
    } });
    const visible = [true];
    for (const { operator, operands, property } of operators) {
      signal.throwIfAborted();
      if (operator === "BMC" || operator === "BDC") {
        let ownVisible = true;
        if (operator === "BDC" && operands[0] === "OC") {
          const properties = resources.get("Properties");
          const value = typeof operands[1] === "string" && properties
            ? (await document.resolveDictionary(properties, signal)).get(operands[1])
            : property;
          ownVisible = value ? (await optionalContent.resolvePropertyValue(value, signal))?.defaultVisible ?? true : true;
        }
        if (visible.length > document.limits.maxRecursionDepth) throw new PdfError("resource-limit", "OCR marked-content nesting exceeds the page limit.");
        visible.push(visible.at(-1)! && ownVisible);
        continue;
      }
      if (operator === "EMC") { if (visible.length === 1) throw new PdfError("invalid-object", "Unbalanced OCR marked content."); visible.pop(); continue; }
      if (operator === "Tf") {
        const [resource] = await registry.loadScope(resources, [String(operands[0])], signal, { label: "OCR text", allowType3: true });
        emit("Tf", [alias(resource[1]), operands[1]]);
      } else if (operator === "gs") {
        const states = resources.get("ExtGState");
        if (!states) continue;
        const value = (await document.resolveDictionary(states, signal)).get(String(operands[0]));
        const state = await document.resolveDictionary(value, signal);
        const selection = await document.resolveValue(state.get("Font"), signal);
        if (Array.isArray(selection) && selection.length === 2) {
          const resource = await registry.loadDirect(selection[0], resources, signal, { label: "OCR text", allowType3: true });
          emit("Tf", [alias(resource), selection[1]]);
        }
      } else if (operator === "Do") {
        if (!visible.at(-1)) continue;
        const objects = resources.get("XObject");
        if (!objects) continue;
        const value = (await document.resolveDictionary(objects, signal)).get(String(operands[0]));
        const object = await document.resolveValue(value, signal);
        if (!isPdfStream(object) || !isPdfName(object.dictionary.get("Subtype"), "Form")) continue;
        const oc = object.dictionary.get("OC");
        if (oc && (await optionalContent.resolvePropertyValue(oc, signal))?.defaultVisible === false) continue;
        if (activeForms.has(object)) throw new PdfError("resource-limit", "Cyclic OCR Form reference.");
        activeForms.add(object);
        try {
          emit("q");
          const matrix = await document.resolveValue(object.dictionary.get("Matrix"), signal);
          if (Array.isArray(matrix)) emit("cm", matrix);
          const ownResources = object.dictionary.get("Resources");
          await walk([object], ownResources ? await document.resolveDictionary(ownResources, signal) : resources, depth + 1);
          emit("Q");
        } finally { activeForms.delete(object); }
      } else {
        const hiddenShow = !visible.at(-1) && ["Tj", "TJ", "'", '"'].includes(operator);
        if (hiddenShow) emit("BDC", ["OC", "OCRHidden"]);
        emit(operator, operands);
        if (hiddenShow) emit("EMC");
      }
    }
    if (visible.length !== 1) throw new PdfError("invalid-object", "Unbalanced OCR marked content.");
  };
  await walk(await document.getPageContentStreams(sourcePageIndex, signal),
    page.resources ? await document.resolveDictionary(page.resources, signal) : new Map(), 0);
  const maxGlyphs = options.limits?.maxGlyphsPerPage ?? document.limits.maxGlyphsPerPage;
  const runs: import("./nativeText").NativeTextDrawRun[] = [];
  const compiler = new NativeTextCompiler({ fonts, initialTransform: pageMatrix, maxGlyphs, signal, onRun: run => runs.push(run) });
  const compiled = await compileGroupedVectorPageContent(new TextEncoder().encode(text.join("")), {
    pageMatrix, pageBounds, signal, enableSegmentMerge: false, enableInvisibleCull: false,
    markedContentProperties: new Map([["OCRHidden", { resourceName: "OCRHidden", optionalContentIndex: 0, defaultVisible: false, mcid: -1 }]]),
    textOperatorSink: { applyOperator(operator, operands, context) {
      runs.length = 0;
      compiler.setOutputEnabled(context.outputEnabled);
      compiler.applyOperator(operator, operands);
      return runs;
    } }
  });
  // The grouped adapter uses the text runs independently of source paint ranges.
  const textCompilation = compiler.build();
  const scene = buildNativeVectorPage({ pageInfo: { sourcePageIndex, width: pageBounds.maxX - pageBounds.minX, height: pageBounds.maxY - pageBounds.minY },
    pageBounds, compiled, textCompilation, fontResources,
    imageRegistry: { size: 0, describe() { throw new Error("OCR text has no image resources."); } },
    maxPaths: options.limits?.maxPathsPerPage ?? document.limits.maxPathsPerPage,
    maxPathCoordinates: options.limits?.maxPathCoordinatesPerPage ?? document.limits.maxPathCoordinatesPerPage, signal });
  for (const diagnostic of [...registry.getDiagnostics(), ...textCompilation.diagnostics]) onDiagnostic(diagnostic);
  onDiagnostic({ code: "view.ocr-text-only", severity: "warning", pageIndex: sourcePageIndex,
    message: scene.textInstanceCount ? "Text-only view reconstructs stored text; font substitution may change its appearance. Images, diagrams, colors and clipping are omitted."
      : "This page has no drawable stored text. Disable text-only view to see its scanned content." });
  return scene;
}

function serializeOperand(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return `/${value}`; // Generated font aliases only.
  if (value instanceof Uint8Array) return `<${Array.from(value, byte => byte.toString(16).padStart(2, "0")).join("")}>`;
  if (Array.isArray(value)) return `[${value.map(serializeOperand).join(" ")}]`;
  throw new PdfError("invalid-object", "Invalid OCR text operand.");
}

function substituteOcrFont(original: NativePdfFont, fallback: NativePdfFont): NativePdfFont {
  const outlines: NativeGlyphOutline[] = [];
  const indexes = new Map<string, number>();
  return { ...fallback, writingMode: original.writingMode, unitsPerEm: 1000,
    decode(bytes, offset) {
      const mapped = original.decode(bytes, offset);
      const unicode = mapped.unicode ?? "\ufffd";
      const key = `${mapped.glyphId}:${unicode}:${mapped.width}`;
      let glyphId = indexes.get(key);
      if (glyphId === undefined) {
        glyphId = outlines.length;
        let originalOutline: NativeGlyphOutline | undefined;
        if (mapped.glyphId > 0 && mapped.unicode !== null && !/glyphless/i.test(original.baseFont)) {
          try {
            const outline = original.getGlyphOutline(mapped.glyphId);
            if (outline.commands.length) originalOutline = outline;
          } catch (error) {
            if (!(error instanceof PdfError) || error.code !== "unsupported-font") throw error;
          }
        }
        const glyphs = originalOutline ? [originalOutline] : Array.from(unicode,
          character => fallback.getGlyphOutline(fallback.sfnt!.mapCodePoint(character.codePointAt(0)!)));
        const advance = glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0);
        const scaleY = 1000 / (originalOutline ? original.unitsPerEm : fallback.unitsPerEm);
        const scaleX = originalOutline ? scaleY : advance > 0 && mapped.width > 0 ? mapped.width / advance : scaleY;
        let pen = 0;
        const commands: NativeGlyphPathCommand[] = [];
        const bounds = [Infinity, Infinity, -Infinity, -Infinity];
        for (const glyph of glyphs) {
          if (glyph.commands.length) {
            bounds[0] = Math.min(bounds[0], (pen + glyph.bounds[0]) * scaleX);
            bounds[1] = Math.min(bounds[1], glyph.bounds[1] * scaleY);
            bounds[2] = Math.max(bounds[2], (pen + glyph.bounds[2]) * scaleX);
            bounds[3] = Math.max(bounds[3], glyph.bounds[3] * scaleY);
          }
          for (const command of glyph.commands) {
            const transformed = { ...command } as Record<string, unknown>;
            for (const field of ["x", "controlX", "control1X", "control2X"]) if (field in transformed) transformed[field] = (Number(transformed[field]) + pen) * scaleX;
            for (const field of ["y", "controlY", "control1Y", "control2Y"]) if (field in transformed) transformed[field] = Number(transformed[field]) * scaleY;
            commands.push(transformed as unknown as NativeGlyphPathCommand);
          }
          pen += glyph.advanceWidth;
        }
        outlines.push({ glyphId, commands, bounds: (commands.length ? bounds : [0, 0, 0, 0]) as unknown as NativeGlyphOutline["bounds"], advanceWidth: mapped.width, leftSideBearing: 0 });
        indexes.set(key, glyphId);
      }
      return { ...mapped, glyphId };
    },
    getGlyphOutline(glyphId) { return outlines[glyphId]; }
  };
}
