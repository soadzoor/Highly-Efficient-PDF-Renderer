import {
  HEPR_GLYPH_FLAG,
  type HeprGlyphStore,
  type HeprTextIndex,
  type HeprTransformStore,
  type PdfMatrix
} from "../heprDocumentData";
import { PdfError, throwIfAborted, type PdfDiagnostic } from "./nativeTypes";
import type { NativeMappedCharacter, NativePdfFont } from "./nativeFont";
import type { NativePdfPreparedType3Font } from "./nativeType3";

export interface NativeTextFontResource {
  readonly font: NativePdfFont;
  /** Page-local index into `HeprPageStores.fonts`. */
  readonly fontIndex: number;
  /**
   * Structurally prepared Type3 dictionary. CharProc streams remain lazy and
   * are resolved from retained character codes only after text interpretation.
   */
  readonly type3?: NativePdfPreparedType3Font;
}

export interface NativeTextDrawRun {
  readonly first: number;
  readonly count: number;
  readonly fontIndex: number;
  /** PDF text rendering mode 0..7. */
  readonly renderingMode: number;
}

export interface NativeTextCompilation {
  readonly transforms: HeprTransformStore;
  readonly glyphs: HeprGlyphStore;
  readonly textIndex: HeprTextIndex;
  /**
   * Per-glyph advance in local em units. The legacy VectorScene bridge uses
   * this compact value to reconstruct its pen-cell search geometry only when
   * a glyph has no emitted render instance.
   */
  readonly glyphAdvanceEms?: Float32Array;
  /**
   * Per-glyph PDF width in local em units, excluding Tc/Tw/TJ positioning.
   * This preserves the source text-cell boundary used by PDF.js-compatible
   * view-box rejection and inferred word spacing.
   */
  readonly glyphWidthEms?: Float32Array;
  /** Glyph-local marker for a PDF.js-compatible forward TJ word gap. */
  readonly glyphGapBefore?: Uint8Array;
  readonly runs: readonly NativeTextDrawRun[];
  readonly diagnostics: readonly PdfDiagnostic[];
}

export type NativeTextArrayItem = Uint8Array | number;

export interface NativeTextCompilerOptions {
  readonly fonts: ReadonlyMap<string, NativeTextFontResource>;
  /** Initial page-space CTM. @default identity */
  readonly initialTransform?: PdfMatrix;
  readonly maxGlyphs?: number;
  /** Maximum UTF-16 code units retained in the searchable index. */
  readonly maxTextCodeUnits?: number;
  /** Maximum explicit fallback geometry records retained in the text index. */
  readonly maxFallbackQuads?: number;
  /** Maximum distinct Float32 glyph transforms, including identity. */
  readonly maxTransforms?: number;
  /** Maximum cumulative string/number entries consumed from TJ arrays. */
  readonly maxTextArrayItems?: number;
  /** Maximum q/Q nesting handled by this standalone interpreter. */
  readonly maxGraphicsStateDepth?: number;
  readonly signal?: AbortSignal;
  readonly onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
  /** Fired synchronously at each source text-show position for ordered commands. */
  readonly onRun?: (run: Readonly<NativeTextDrawRun>) => void;
}

interface TextState {
  fontResourceName: string | null;
  fontSize: number;
  characterSpacing: number;
  wordSpacing: number;
  horizontalScale: number;
  leading: number;
  rise: number;
  renderingMode: number;
}

interface GraphicsSnapshot {
  readonly ctm: Matrix;
  readonly textState: TextState;
}

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const MAX_INT32 = 0x7fff_ffff;
const MAX_UINT32 = 0xffff_ffff;
const DEFAULT_MAX_TEXT_CODE_UNITS = 100_000_000;
const DEFAULT_MAX_GRAPHICS_STATE_DEPTH = 64;
/** PDF.js tracking-space threshold used for signed TJ positioning gaps. */
const TEXT_INDEX_GAP_EM_FACTOR = 0.102;

/**
 * Stateful PDF text interpreter.
 *
 * It accepts the standard text positioning/show operators through explicit
 * methods or `applyOperator()`. Each shown code produces a glyph instance even
 * when the rendering mode is invisible, so OCR text remains searchable and
 * geometry-backed. Missing Unicode becomes U+FFFD plus a stable diagnostic;
 * visible missing outlines remain the renderer's typed `unsupported-font`
 * responsibility and are never silently dropped here.
 */
export class NativeTextCompiler {
  private readonly fonts: ReadonlyMap<string, NativeTextFontResource>;
  private readonly maxGlyphs: number;
  private readonly maxTextCodeUnits: number;
  private readonly maxFallbackQuads: number;
  private readonly maxTransforms: number;
  private readonly maxTextArrayItems: number;
  private readonly maxGraphicsStateDepth: number;
  private readonly signal?: AbortSignal;
  private readonly onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
  private readonly onRun?: (run: Readonly<NativeTextDrawRun>) => void;
  private ctm: Matrix;
  private textMatrix: Matrix = [...IDENTITY];
  private lineMatrix: Matrix = [...IDENTITY];
  private state: TextState = createDefaultTextState();
  private readonly graphicsStack: GraphicsSnapshot[] = [];
  private inTextObject = false;
  private lockedClippingMode: number | null = null;

  private readonly fontIndices: number[] = [];
  private readonly characterCodes: number[] = [];
  private readonly glyphIds: number[] = [];
  private readonly transformIndices: number[] = [];
  private readonly advances: number[] = [];
  private readonly flags: number[] = [];
  private readonly glyphAdvanceEms: number[] = [];
  private readonly glyphWidthEms: number[] = [];
  private readonly glyphGapBefore: number[] = [];
  private readonly transforms: number[] = [...IDENTITY];
  private readonly transformTuple = new Float32Array(6);
  private readonly transformTupleWords = new Uint32Array(this.transformTuple.buffer);
  private readonly transformIndexes = new Map<number, number | Map<string, number>>();
  private readonly textParts: string[] = [];
  private readonly charGlyphIndices: number[] = [];
  private readonly fallbackQuads: number[] = [];
  private readonly runs: NativeTextDrawRun[] = [];
  private readonly diagnostics: PdfDiagnostic[] = [];
  private readonly missingUnicodeCodes = new Set<string>();
  private pendingSeparator: " " | "\n" | null = null;
  private explicitGapCandidatePending = false;
  private previousPenEndX = 0;
  private previousPenEndY = 0;
  private hasPreviousPenEnd = false;
  private textCodeUnits = 0;
  private outputEnabled = true;
  private processedGlyphCount = 0;
  private processedTextArrayItemCount = 0;

  constructor(options: NativeTextCompilerOptions) {
    this.fonts = options.fonts;
    this.maxGlyphs = options.maxGlyphs ?? 10_000_000;
    requirePositiveLimit(this.maxGlyphs, "maxGlyphs", MAX_INT32);
    this.maxTextCodeUnits = options.maxTextCodeUnits ?? Math.min(
      DEFAULT_MAX_TEXT_CODE_UNITS,
      Math.max(1_024, this.maxGlyphs * 8)
    );
    requirePositiveLimit(this.maxTextCodeUnits, "maxTextCodeUnits", MAX_INT32);
    this.maxFallbackQuads = options.maxFallbackQuads ?? this.maxGlyphs;
    requirePositiveLimit(this.maxFallbackQuads, "maxFallbackQuads", MAX_INT32 - 1);
    this.maxTransforms = options.maxTransforms ?? this.maxGlyphs + 1;
    requirePositiveLimit(this.maxTransforms, "maxTransforms", MAX_UINT32);
    this.maxTextArrayItems = options.maxTextArrayItems ?? Math.min(
      MAX_INT32,
      Math.max(1_024, this.maxGlyphs * 2)
    );
    requirePositiveLimit(this.maxTextArrayItems, "maxTextArrayItems", MAX_INT32);
    this.maxGraphicsStateDepth = options.maxGraphicsStateDepth ?? DEFAULT_MAX_GRAPHICS_STATE_DEPTH;
    requirePositiveLimit(this.maxGraphicsStateDepth, "maxGraphicsStateDepth", MAX_INT32);
    this.signal = options.signal;
    throwIfAborted(this.signal);
    this.ctm = validateMatrix(options.initialTransform ?? IDENTITY, "initial text transform");
    this.onDiagnostic = options.onDiagnostic;
    this.onRun = options.onRun;
    for (let index = 0; index < 6; index += 1) {
      this.transformTuple[index] = this.transforms[index];
    }
    this.transformIndexes.set(hashTransformWords(this.transformTupleWords), 0);
  }

  saveGraphicsState(): void {
    this.requireOutsideTextObject("q");
    this.checkCancellation();
    if (this.graphicsStack.length >= this.maxGraphicsStateDepth) {
      throw new PdfError("resource-limit", "PDF text graphics-state nesting exceeds its configured limit.", {
        details: { maxGraphicsStateDepth: this.maxGraphicsStateDepth }
      });
    }
    this.graphicsStack.push({ ctm: [...this.ctm], textState: { ...this.state } });
  }

  restoreGraphicsState(): void {
    this.requireOutsideTextObject("Q");
    this.checkCancellation();
    const snapshot = this.graphicsStack.pop();
    if (!snapshot) throw invalidText("PDF text graphics-state stack underflow.");
    this.ctm = [...snapshot.ctm];
    this.state = { ...snapshot.textState };
  }

  /** Concatenate a page-space transform after the current CTM. */
  concatTransform(matrix: PdfMatrix): void {
    this.requireOutsideTextObject("cm");
    this.checkCancellation();
    this.ctm = multiply(this.ctm, validateMatrix(matrix, "text CTM"));
  }

  beginText(): void {
    this.checkCancellation();
    if (this.inTextObject) throw invalidText("PDF BT/ET text objects cannot be nested.");
    this.inTextObject = true;
    this.lockedClippingMode = this.state.renderingMode >= 4
      ? this.state.renderingMode
      : null;
    this.textMatrix = [...IDENTITY];
    this.lineMatrix = [...IDENTITY];
  }

  endText(): void {
    this.requireTextObject("ET");
    this.checkCancellation();
    this.inTextObject = false;
    this.lockedClippingMode = null;
  }

  setFont(resourceName: string, size: number): void {
    this.checkCancellation();
    if (typeof resourceName !== "string" || resourceName.length === 0) {
      throw invalidText("Tf requires a nonempty font resource name.");
    }
    if (!this.fonts.has(resourceName)) {
      throw new PdfError("unsupported-font", `Page font resource /${resourceName} is missing.`);
    }
    this.state.fontResourceName = resourceName;
    this.state.fontSize = finite(size, "font size");
  }

  setCharacterSpacing(value: number): void {
    this.checkCancellation();
    this.state.characterSpacing = finite(value, "character spacing");
  }

  setWordSpacing(value: number): void {
    this.checkCancellation();
    this.state.wordSpacing = finite(value, "word spacing");
  }

  setHorizontalScale(percent: number): void {
    this.checkCancellation();
    this.state.horizontalScale = finite(percent, "horizontal text scale") / 100;
  }

  setLeading(value: number): void {
    this.checkCancellation();
    this.state.leading = finite(value, "text leading");
  }

  setRise(value: number): void {
    this.checkCancellation();
    this.state.rise = finite(value, "text rise");
  }

  setRenderingMode(mode: number): void {
    this.checkCancellation();
    if (!Number.isInteger(mode) || mode < 0 || mode > 7) {
      throw invalidText("PDF text rendering mode must be an integer from 0 through 7.");
    }
    if (this.inTextObject && this.lockedClippingMode !== null && mode < 4) {
      throw invalidText(
        "A PDF clipping text mode cannot change back to a non-clipping mode before ET."
      );
    }
    if (this.inTextObject && mode >= 4) this.lockedClippingMode = mode;
    this.state.renderingMode = mode;
  }

  /**
   * Enable or suppress glyph/text-index emission while retaining decoding,
   * metrics, and text-position advancement. Used by static optional content.
   */
  setOutputEnabled(enabled: boolean): void {
    if (typeof enabled !== "boolean") throw new TypeError("Native text output state must be boolean.");
    this.outputEnabled = enabled;
  }

  moveText(tx: number, ty: number, setLeading = false): void {
    this.requireTextObject(setLeading ? "TD" : "Td");
    this.checkCancellation();
    tx = finite(tx, "text x translation");
    ty = finite(ty, "text y translation");
    if (setLeading) this.state.leading = -ty;
    this.lineMatrix = multiply(this.lineMatrix, [1, 0, 0, 1, tx, ty]);
    this.textMatrix = [...this.lineMatrix];
    if (ty !== 0) {
      this.appendSeparator("\n");
    } else if (Math.abs(tx) > Math.abs(this.state.fontSize) * TEXT_INDEX_GAP_EM_FACTOR) {
      this.appendSeparator(" ");
    }
  }

  setTextMatrix(matrix: PdfMatrix): void {
    this.requireTextObject("Tm");
    this.checkCancellation();
    this.lineMatrix = validateMatrix(matrix, "text matrix");
    this.textMatrix = [...this.lineMatrix];
  }

  nextLine(): void {
    this.requireTextObject("T*");
    this.moveText(0, -this.state.leading);
    this.appendSeparator("\n");
  }

  showText(bytes: Uint8Array): void {
    this.requireTextObject("Tj");
    if (!(bytes instanceof Uint8Array)) throw invalidText("Tj requires a byte-string operand.");
    const resource = this.currentFont();
    const firstGlyph = this.glyphIds.length;
    this.appendTextBytes(resource, bytes);
    this.appendRun(firstGlyph, this.glyphIds.length - firstGlyph, resource.fontIndex);
  }

  showAdjustedText(items: readonly NativeTextArrayItem[]): void {
    this.requireTextObject("TJ");
    if (!Array.isArray(items)) throw invalidText("TJ requires an array operand.");
    if (items.length > this.maxTextArrayItems - this.processedTextArrayItemCount) {
      throw new PdfError("resource-limit", "Page text exceeds the configured TJ-array item limit.", {
        details: { maxTextArrayItems: this.maxTextArrayItems }
      });
    }
    this.processedTextArrayItemCount += items.length;
    const resource = this.currentFont();
    const firstGlyph = this.glyphIds.length;
    for (const item of items) {
      this.checkCancellation();
      if (item instanceof Uint8Array) this.appendTextBytes(resource, item);
      else if (typeof item === "number") {
        this.adjustTextPosition(finite(item, "TJ adjustment"), resource);
      } else {
        throw invalidText("TJ array entries must be byte strings or numbers.");
      }
    }
    this.appendRun(firstGlyph, this.glyphIds.length - firstGlyph, resource.fontIndex);
  }

  /** Append indexed OCR/ActualText geometry when no glyph instance exists. */
  appendFallbackText(
    text: string,
    bounds: readonly [minX: number, minY: number, maxX: number, maxY: number]
  ): void {
    if (typeof text !== "string" || bounds.length !== 4) {
      throw invalidText("Fallback text requires a string and four bounds.");
    }
    if (!this.outputEnabled || text.length === 0) return;
    this.checkCancellation();
    const [minX, minY, maxX, maxY] = bounds.map((value) =>
      finiteFloat32(value, "fallback text bound")
    );
    if (minX > maxX || minY > maxY) {
      throw invalidText("Fallback text bounds must be ordered.");
    }
    const fallbackIndex = this.fallbackQuads.length / 4;
    if (fallbackIndex >= this.maxFallbackQuads) {
      throw new PdfError("resource-limit", "Page text exceeds the configured fallback-quad limit.", {
        details: { maxFallbackQuads: this.maxFallbackQuads }
      });
    }
    this.flushPendingSeparator(text);
    this.ensureTextCapacity(text.length);
    this.fallbackQuads.push(minX, minY, maxX, maxY);
    this.textParts.push(text);
    this.textCodeUnits += text.length;
    for (let index = 0; index < text.length; index += 1) {
      if ((index & 0x3fff) === 0) this.checkCancellation();
      this.charGlyphIndices.push(-fallbackIndex - 2);
    }
  }

  appendSeparator(separator: " " | "\n"): void {
    if (separator !== " " && separator !== "\n") {
      throw invalidText("Text-index separators must be a space or line break.");
    }
    if (this.textCodeUnits === 0) return;
    // Keep separators pending so leading/trailing separators are never
    // materialized. A line break dominates repeated spacing hints.
    if (separator === "\n" || this.pendingSeparator === null) this.pendingSeparator = separator;
  }

  /** Route standard text operators from any allocation-conscious content lexer. */
  applyOperator(operator: string, operands: readonly unknown[]): void {
    this.checkCancellation();
    switch (operator) {
      case "q": this.requireOperandCount(operator, operands, 0); this.saveGraphicsState(); return;
      case "Q": this.requireOperandCount(operator, operands, 0); this.restoreGraphicsState(); return;
      case "cm": this.requireOperandCount(operator, operands, 6); this.concatTransform(numberMatrix(operands)); return;
      case "BT": this.requireOperandCount(operator, operands, 0); this.beginText(); return;
      case "ET": this.requireOperandCount(operator, operands, 0); this.endText(); return;
      case "Tf":
        this.requireOperandCount(operator, operands, 2);
        this.setFont(requireResourceName(operands[0]), requireNumber(operands[1], operator));
        return;
      case "Tc": this.requireUnaryNumber(operator, operands, (value) => this.setCharacterSpacing(value)); return;
      case "Tw": this.requireUnaryNumber(operator, operands, (value) => this.setWordSpacing(value)); return;
      case "Tz": this.requireUnaryNumber(operator, operands, (value) => this.setHorizontalScale(value)); return;
      case "TL": this.requireUnaryNumber(operator, operands, (value) => this.setLeading(value)); return;
      case "Ts": this.requireUnaryNumber(operator, operands, (value) => this.setRise(value)); return;
      case "Tr": this.requireUnaryNumber(operator, operands, (value) => this.setRenderingMode(value)); return;
      case "Td":
        this.requireOperandCount(operator, operands, 2);
        this.moveText(requireNumber(operands[0], operator), requireNumber(operands[1], operator));
        return;
      case "TD":
        this.requireOperandCount(operator, operands, 2);
        this.moveText(requireNumber(operands[0], operator), requireNumber(operands[1], operator), true);
        return;
      case "Tm": this.requireOperandCount(operator, operands, 6); this.setTextMatrix(numberMatrix(operands)); return;
      case "T*": this.requireOperandCount(operator, operands, 0); this.nextLine(); return;
      case "Tj":
        this.requireOperandCount(operator, operands, 1);
        this.showText(requireBytes(operands[0], operator));
        return;
      case "TJ": {
        this.requireOperandCount(operator, operands, 1);
        const array = operands[0];
        if (!Array.isArray(array)) throw invalidText("TJ requires an array operand.");
        this.showAdjustedText(array as readonly NativeTextArrayItem[]);
        return;
      }
      case "'":
        this.requireOperandCount(operator, operands, 1);
        this.nextLine();
        this.showText(requireBytes(operands[0], operator));
        return;
      case "\"":
        this.requireOperandCount(operator, operands, 3);
        this.setWordSpacing(requireNumber(operands[0], operator));
        this.setCharacterSpacing(requireNumber(operands[1], operator));
        this.nextLine();
        this.showText(requireBytes(operands[2], operator));
        return;
      default:
        // A graphics interpreter can route only text-relevant operators. Doing
        // nothing for paint/color/path operators keeps this helper composable.
        return;
    }
  }

  build(): NativeTextCompilation {
    this.checkCancellation();
    if (this.inTextObject) throw invalidText("The PDF content ends inside a BT/ET text object.");
    if (this.graphicsStack.length !== 0) throw invalidText("The PDF content ends with an unbalanced q/Q stack.");
    return Object.freeze({
      transforms: { values: Float32Array.from(this.transforms) },
      glyphs: {
        fontIndices: Uint32Array.from(this.fontIndices),
        characterCodes: Uint32Array.from(this.characterCodes),
        glyphIds: Uint32Array.from(this.glyphIds),
        transformIndices: Uint32Array.from(this.transformIndices),
        advances: Float32Array.from(this.advances),
        flags: Uint8Array.from(this.flags)
      },
      textIndex: {
        version: 1 as const,
        text: this.textParts.join(""),
        charGlyphIndices: Int32Array.from(this.charGlyphIndices),
        fallbackQuads: Float32Array.from(this.fallbackQuads)
      },
      glyphAdvanceEms: Float32Array.from(this.glyphAdvanceEms),
      glyphWidthEms: Float32Array.from(this.glyphWidthEms),
      glyphGapBefore: Uint8Array.from(this.glyphGapBefore),
      runs: Object.freeze(this.runs.map((run) => Object.freeze({ ...run }))),
      diagnostics: Object.freeze(this.diagnostics.map((diagnostic) => Object.freeze({ ...diagnostic })))
    });
  }

  private appendTextBytes(resource: NativeTextFontResource, bytes: Uint8Array): void {
    let offset = 0;
    while (offset < bytes.length) {
      this.checkGlyphLimit();
      const mapped = resource.font.decode(bytes, offset);
      if (
        typeof mapped !== "object" || mapped === null ||
        !Number.isSafeInteger(mapped.codeByteLength) || mapped.codeByteLength < 1 ||
        offset + mapped.codeByteLength > bytes.length
      ) {
        throw invalidText("A font decoder returned an invalid PDF character length.");
      }
      this.appendGlyph(resource, mapped);
      offset += mapped.codeByteLength;
    }
  }

  private appendTransform(matrix: Matrix): number {
    for (let index = 0; index < 6; index += 1) {
      this.transformTuple[index] = finiteFloat32(matrix[index], "glyph transform");
    }
    const hash = hashTransformWords(this.transformTupleWords);
    const existing = this.findTransform(hash);
    if (existing !== undefined) return existing;
    const transformIndex = this.transforms.length / 6;
    if (transformIndex >= this.maxTransforms) {
      throw new PdfError("resource-limit", "Page text exceeds the configured transform limit.", {
        details: { maxTransforms: this.maxTransforms }
      });
    }
    this.transforms.push(
      this.transformTuple[0], this.transformTuple[1], this.transformTuple[2],
      this.transformTuple[3], this.transformTuple[4], this.transformTuple[5]
    );
    const candidates = this.transformIndexes.get(hash);
    if (candidates === undefined) {
      this.transformIndexes.set(hash, transformIndex);
    } else if (typeof candidates === "number") {
      this.transformIndexes.set(hash, new Map([
        [this.storedTransformKey(candidates), candidates],
        [this.transformTupleKey(), transformIndex]
      ]));
    } else {
      candidates.set(this.transformTupleKey(), transformIndex);
    }
    return transformIndex;
  }

  private findTransform(hash: number): number | undefined {
    const candidates = this.transformIndexes.get(hash);
    if (candidates === undefined) return undefined;
    if (typeof candidates === "number") {
      return this.matchesTransform(candidates) ? candidates : undefined;
    }
    return candidates.get(this.transformTupleKey());
  }

  private matchesTransform(index: number): boolean {
    const offset = index * 6;
    for (let component = 0; component < 6; component += 1) {
      if (this.transforms[offset + component] !== this.transformTuple[component]) return false;
    }
    return true;
  }

  private transformTupleKey(): string {
    return `${this.transformTuple[0]},${this.transformTuple[1]},${this.transformTuple[2]},` +
      `${this.transformTuple[3]},${this.transformTuple[4]},${this.transformTuple[5]}`;
  }

  private storedTransformKey(index: number): string {
    const offset = index * 6;
    return `${this.transforms[offset]},${this.transforms[offset + 1]},` +
      `${this.transforms[offset + 2]},${this.transforms[offset + 3]},` +
      `${this.transforms[offset + 4]},${this.transforms[offset + 5]}`;
  }

  private flushPendingSeparator(nextText: string): void {
    const separator = this.pendingSeparator;
    if (separator === null || this.textCodeUnits === 0 || nextText.length === 0) return;
    this.pendingSeparator = null;
    const previous = lastCodeUnit(this.textParts);
    if (isSearchWhitespace(previous) || isSearchWhitespace(nextText[0])) return;
    this.ensureTextCapacity(1);
    this.textParts.push(separator);
    this.charGlyphIndices.push(-1);
    this.textCodeUnits += 1;
  }

  private ensureTextCapacity(extraCodeUnits: number): void {
    if (
      !Number.isSafeInteger(extraCodeUnits) || extraCodeUnits < 0 ||
      this.textCodeUnits > this.maxTextCodeUnits - extraCodeUnits
    ) {
      throw new PdfError("resource-limit", "Page text exceeds the configured Unicode-index limit.", {
        details: { maxTextCodeUnits: this.maxTextCodeUnits }
      });
    }
  }

  private appendGlyph(resource: NativeTextFontResource, mapped: NativeMappedCharacter): void {
    const font = resource.font;
    if (font.writingMode !== 0 && font.writingMode !== 1) {
      throw new PdfError("unsupported-font", "A native font has an invalid writing mode.", {
        details: { fontIndex: resource.fontIndex }
      });
    }
    validateMappedCharacter(mapped);
    const wordSpacing = mapped.code === 0x20 && mapped.codeByteLength === 1
      ? this.state.wordSpacing
      : 0;
    let advanceX = 0;
    let advanceY = 0;
    let originX = 0;
    let originY = this.state.rise;
    if (font.writingMode === 0) {
      advanceX = (
        mapped.width / 1000 * this.state.fontSize + this.state.characterSpacing + wordSpacing
      ) * this.state.horizontalScale;
    } else {
      const metric = mapped.verticalMetric ?? {
        advanceY: -1000,
        originX: mapped.width / 2,
        originY: 880
      };
      validateVerticalMetric(metric);
      advanceY = metric.advanceY / 1000 * this.state.fontSize +
        this.state.characterSpacing + wordSpacing;
      // The vertical position vector v locates origin 1 relative to the
      // ordinary glyph origin 0. The text point is origin 1, hence -v here.
      originX = -metric.originX / 1000 * this.state.fontSize * this.state.horizontalScale;
      originY -= metric.originY / 1000 * this.state.fontSize;
    }
    finite(advanceX, "horizontal glyph advance");
    finite(advanceY, "vertical glyph advance");

    if (this.outputEnabled) {
      const glyphIndex = this.glyphIds.length;
      requireUnsignedInteger(resource.fontIndex, "page font index");
      if (!Number.isSafeInteger(font.unitsPerEm) || font.unitsPerEm <= 0 || font.unitsPerEm > MAX_UINT32) {
        throw new PdfError("unsupported-font", "A native font has an invalid unitsPerEm value.", {
          details: { fontIndex: resource.fontIndex, unitsPerEm: font.unitsPerEm }
        });
      }
      const textOrigin = multiply(this.textMatrix, [1, 0, 0, 1, originX, originY]);
      const glyphScale: Matrix = [
        this.state.fontSize * this.state.horizontalScale / font.unitsPerEm,
        0,
        0,
        this.state.fontSize / font.unitsPerEm,
        0,
        0
      ];
      const glyphTransform = multiply(this.ctm, multiply(textOrigin, glyphScale));
      const transformIndex = this.appendTransform(glyphTransform);
      const advanceEm = font.writingMode === 0
        ? this.state.fontSize !== 0 && this.state.horizontalScale !== 0
          ? advanceX / (this.state.fontSize * this.state.horizontalScale)
          : mapped.width / 1000
        : this.state.fontSize !== 0
          ? advanceY / this.state.fontSize
          : (mapped.verticalMetric?.advanceY ?? -1000) / 1000;
      this.glyphAdvanceEms.push(finiteFloat32(advanceEm, "glyph fallback advance"));
      const widthEm = font.writingMode === 0
        ? mapped.width / 1000
        : (mapped.verticalMetric?.advanceY ?? -mapped.width) / 1000;
      this.glyphWidthEms.push(finiteFloat32(widthEm, "glyph PDF width"));
      const explicitGap = this.explicitGapCandidatePending &&
        this.hasForwardGapBefore(glyphTransform, font);
      this.explicitGapCandidatePending = false;
      if (explicitGap) this.appendSeparator(" ");
      this.glyphGapBefore.push(explicitGap ? 1 : 0);
      this.fontIndices.push(resource.fontIndex);
      this.characterCodes.push(mapped.code);
      this.glyphIds.push(mapped.glyphId);
      this.transformIndices.push(transformIndex);
      this.advances.push(
        finiteFloat32(advanceX, "horizontal glyph advance"),
        finiteFloat32(advanceY, "vertical glyph advance")
      );
      let flags = font.writingMode === 1 ? HEPR_GLYPH_FLAG.Vertical : 0;
      if (this.state.renderingMode === 3 || this.state.renderingMode === 7) {
        flags |= HEPR_GLYPH_FLAG.Invisible;
      }
      if (this.state.renderingMode >= 4) flags |= HEPR_GLYPH_FLAG.ClipOnly;
      if (font.subtype === "Type3") flags |= HEPR_GLYPH_FLAG.Type3;
      this.flags.push(flags);

      const unicode = mapped.unicode ?? "\ufffd";
      this.flushPendingSeparator(unicode);
      this.ensureTextCapacity(unicode.length);
      this.textParts.push(unicode);
      this.textCodeUnits += unicode.length;
      for (let index = 0; index < unicode.length; index += 1) {
        if ((index & 0x3fff) === 0) this.checkCancellation();
        this.charGlyphIndices.push(glyphIndex);
      }
      if (mapped.unicode === null) this.reportMissingUnicode(resource, mapped);
      const advanceUnits = widthEm * font.unitsPerEm;
      this.previousPenEndX = glyphTransform[4] +
        (font.writingMode === 1 ? glyphTransform[2] : glyphTransform[0]) * advanceUnits;
      this.previousPenEndY = glyphTransform[5] +
        (font.writingMode === 1 ? glyphTransform[3] : glyphTransform[1]) * advanceUnits;
      this.hasPreviousPenEnd = Number.isFinite(this.previousPenEndX) &&
        Number.isFinite(this.previousPenEndY);
    }
    this.textMatrix = multiply(this.textMatrix, [1, 0, 0, 1, advanceX, advanceY]);
  }

  private adjustTextPosition(
    adjustment: number,
    resource: NativeTextFontResource = this.currentFont()
  ): void {
    if (resource.font.writingMode === 0) {
      const amount = -adjustment / 1000 * this.state.fontSize * this.state.horizontalScale;
      this.textMatrix = multiply(this.textMatrix, [1, 0, 0, 1, amount, 0]);
      if (
        amount * (this.state.fontSize * this.state.horizontalScale) > 0 &&
        Math.abs(amount) >
        Math.abs(this.state.fontSize) * TEXT_INDEX_GAP_EM_FACTOR
      ) {
        if (this.outputEnabled) this.explicitGapCandidatePending = true;
      }
    } else {
      const amount = -adjustment / 1000 * this.state.fontSize;
      this.textMatrix = multiply(this.textMatrix, [1, 0, 0, 1, 0, amount]);
      if (
        amount * -this.state.fontSize > 0 &&
        Math.abs(amount) > Math.abs(this.state.fontSize) * TEXT_INDEX_GAP_EM_FACTOR
      ) {
        if (this.outputEnabled) this.explicitGapCandidatePending = true;
      }
    }
  }

  /**
   * A TJ number describes relative positioning, but a preceding Tm may have
   * reset the absolute text position. Confirm a candidate word gap against
   * the actual page-space pen geometry so a large leading TJ adjustment that
   * merely returns to the prior word does not split searchable text.
   */
  private hasForwardGapBefore(
    glyphTransform: Matrix,
    font: NativePdfFont
  ): boolean {
    if (!this.hasPreviousPenEnd) return false;
    const vertical = font.writingMode === 1;
    const directionX = vertical ? -glyphTransform[2] : glyphTransform[0];
    const directionY = vertical ? -glyphTransform[3] : glyphTransform[1];
    const directionLength = Math.hypot(directionX, directionY);
    if (!(directionLength > 0) || !Number.isFinite(directionLength)) {
      // Degenerate text has no usable page-space direction. Retain the
      // source TJ hint rather than silently losing its semantic boundary.
      return true;
    }
    const deltaX = glyphTransform[4] - this.previousPenEndX;
    const deltaY = glyphTransform[5] - this.previousPenEndY;
    const forwardGap = (deltaX * directionX + deltaY * directionY) / directionLength;
    const baselineEm = directionLength * font.unitsPerEm;
    const threshold = TEXT_INDEX_GAP_EM_FACTOR * Math.max(baselineEm, 1e-6);
    return Number.isFinite(forwardGap) && forwardGap > threshold;
  }

  private appendRun(first: number, count: number, fontIndex: number): void {
    if (count === 0) return;
    // Preserve the text-show boundary. The graphics interpreter may have a
    // backdrop/clip/group barrier between otherwise compatible glyph spans.
    const run = Object.freeze({
      first,
      count,
      fontIndex,
      renderingMode: this.state.renderingMode
    });
    this.runs.push(run);
    this.onRun?.(run);
  }

  private reportMissingUnicode(resource: NativeTextFontResource, mapped: NativeMappedCharacter): void {
    const key = `${resource.fontIndex}:${mapped.codeByteLength}:${mapped.code}`;
    if (this.missingUnicodeCodes.has(key)) return;
    this.missingUnicodeCodes.add(key);
    const diagnostic: PdfDiagnostic = {
      code: "font.missing-unicode-mapping",
      severity: "warning",
      message: `Font ${resource.font.baseFont || "(unnamed)"} has no Unicode mapping for character code ${mapped.code}.`,
      details: {
        fontIndex: resource.fontIndex,
        characterCode: mapped.code,
        codeByteLength: mapped.codeByteLength
      }
    };
    this.diagnostics.push(diagnostic);
    this.onDiagnostic?.(diagnostic);
  }

  private currentFont(): NativeTextFontResource {
    const name = this.state.fontResourceName;
    if (name === null) throw new PdfError("unsupported-font", "Text is shown before a font is selected.");
    const resource = this.fonts.get(name);
    if (!resource) throw new PdfError("unsupported-font", `Page font resource /${name} is missing.`);
    return resource;
  }

  private checkGlyphLimit(): void {
    this.checkCancellation();
    if (this.processedGlyphCount >= this.maxGlyphs) {
      throw new PdfError("resource-limit", "Page text exceeds the configured glyph limit.", {
        details: { maxGlyphs: this.maxGlyphs }
      });
    }
    this.processedGlyphCount += 1;
  }

  private requireTextObject(operator: string): void {
    this.checkCancellation();
    if (!this.inTextObject) throw invalidText(`Text operator ${operator} occurs outside BT/ET.`);
  }

  private requireOutsideTextObject(operator: string): void {
    this.checkCancellation();
    if (this.inTextObject) {
      throw invalidText(`Graphics operator ${operator} is not legal inside BT/ET.`);
    }
  }

  private checkCancellation(): void {
    throwIfAborted(this.signal);
  }

  private requireOperandCount(operator: string, operands: readonly unknown[], count: number): void {
    if (operands.length !== count) {
      throw invalidText(`Text operator ${operator} requires ${count} operand${count === 1 ? "" : "s"}.`);
    }
  }

  private requireUnaryNumber(
    operator: string,
    operands: readonly unknown[],
    callback: (value: number) => void
  ): void {
    this.requireOperandCount(operator, operands, 1);
    callback(requireNumber(operands[0], operator));
  }
}

function createDefaultTextState(): TextState {
  return {
    fontResourceName: null,
    fontSize: 0,
    characterSpacing: 0,
    wordSpacing: 0,
    horizontalScale: 1,
    leading: 0,
    rise: 0,
    renderingMode: 0
  };
}

/** `left * right` for PDF matrices using x'=a*x+c*y+e. */
export function multiplyPdfTextMatrices(left: PdfMatrix, right: PdfMatrix): PdfMatrix {
  return multiply(validateMatrix(left, "left matrix"), validateMatrix(right, "right matrix"));
}

function multiply(left: Matrix, right: Matrix): Matrix {
  const result: Matrix = [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5]
  ];
  for (const value of result) finite(value, "text matrix result");
  return result;
}

function validateMatrix(matrix: PdfMatrix, label: string): Matrix {
  if (matrix.length !== 6) throw invalidText(`${label} must contain six values.`);
  return matrix.map((value) => finite(value, label)) as Matrix;
}

function numberMatrix(values: readonly unknown[]): Matrix {
  return values.map((value) => requireNumber(value, "matrix")) as Matrix;
}

function requireNumber(value: unknown, operator: string): number {
  if (typeof value !== "number") throw invalidText(`${operator} requires numeric operands.`);
  return finite(value, `${operator} operand`);
}

function requireBytes(value: unknown, operator: string): Uint8Array {
  if (!(value instanceof Uint8Array)) throw invalidText(`${operator} requires a byte-string operand.`);
  return value;
}

function requireResourceName(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidText("Tf requires a nonempty font resource name.");
  }
  const resourceName = value.startsWith("/") ? value.slice(1) : value;
  if (resourceName.length === 0) throw invalidText("Tf requires a nonempty font resource name.");
  return resourceName;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw invalidText(`${label} must be finite.`);
  return value;
}

function finiteFloat32(value: number, label: string): number {
  finite(value, label);
  const stored = Math.fround(value);
  if (!Number.isFinite(stored)) throw invalidText(`${label} exceeds Float32 storage range.`);
  return Object.is(stored, -0) ? 0 : stored;
}

function hashTransformWords(words: Uint32Array): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < words.length; index += 1) {
    hash = Math.imul(hash ^ words[index], 0x01000193);
  }
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function validateMappedCharacter(mapped: NativeMappedCharacter): void {
  requireUnsignedInteger(mapped.code, "PDF character code");
  requireUnsignedInteger(mapped.cid, "PDF CID");
  requireUnsignedInteger(mapped.glyphId, "font glyph identifier");
  if (
    !Number.isSafeInteger(mapped.codeByteLength) ||
    mapped.codeByteLength <= 0 || mapped.codeByteLength > 4
  ) {
    throw invalidText("A font decoder returned an invalid PDF character length.");
  }
  finite(mapped.width, "glyph width");
  if (mapped.unicode !== null && typeof mapped.unicode !== "string") {
    throw invalidText("A font decoder returned an invalid Unicode mapping.");
  }
}

function validateVerticalMetric(metric: {
  readonly advanceY: number;
  readonly originX: number;
  readonly originY: number;
}): void {
  finite(metric.advanceY, "vertical glyph advance");
  finite(metric.originX, "vertical glyph origin x");
  finite(metric.originY, "vertical glyph origin y");
}

function requireUnsignedInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_UINT32) {
    throw invalidText(`${label} must be an unsigned 32-bit integer.`);
  }
}

function requirePositiveLimit(value: number, label: string, maximum: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new RangeError(`Native text ${label} must be a positive integer no greater than ${maximum}.`);
  }
}

function lastCodeUnit(parts: readonly string[]): string {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part.length > 0) return part[part.length - 1];
  }
  return "";
}

function isSearchWhitespace(value: string): boolean {
  return value !== "" && /\s/u.test(value);
}

function invalidText(message: string): PdfError {
  return new PdfError("unsupported-content", message);
}
