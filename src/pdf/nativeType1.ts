import type { NativeGlyphOutline, NativeGlyphPathCommand, NativeGlyphPostScriptPaint, NativeGlyphPostScriptFinalState } from "./nativeFont";
import { PdfError, throwIfAborted, type PdfDiagnostic } from "./nativeTypes";
import { CFF_EXPERT_ENCODING } from "./nativeCffExpertData";
import { executeNativeFontPostScript, type NativeFontPostScriptResult, type NativeFontPostScriptValue } from "./nativeFontPostScript";
import { createNativeFontPostScriptFilter, createNativeFontPostScriptMemoryFile } from "./nativeFontPostScriptFile";
import { paintNativeGlyphCommands } from "./nativeGlyphPaint";
import { NativeFontPostScriptGlyphContext, transformNativeGlyphPostScriptPaints, nativeGlyphPostScriptPaintBounds,
  nativeGlyphPostScriptCommandCount, transformNativeGlyphPostScriptFinalState } from "./nativeFontPostScriptGraphics";

/** Caller-selected ceilings; defaults do not impose machine-dependent limits. */
export interface NativeType1ParserLimits {
  readonly maxType1Bytes: number;
  readonly maxType1StringBytes: number;
  readonly maxType1Glyphs: number;
  readonly maxType1Subrs: number;
  readonly maxType1CharStringBytes: number;
  readonly maxType1Operators: number;
  readonly maxType1SubrDepth: number;
  readonly maxType1SubrCalls: number;
  readonly maxType1PathCommands: number;
  readonly maxType1PostScriptOperations: number;
  readonly maxType1PostScriptStack: number;
}

export const DEFAULT_NATIVE_TYPE1_PARSER_LIMITS: Readonly<NativeType1ParserLimits> = Object.freeze({
  maxType1Bytes: Number.MAX_SAFE_INTEGER,
  maxType1StringBytes: Number.MAX_SAFE_INTEGER,
  maxType1Glyphs: Number.MAX_SAFE_INTEGER,
  maxType1Subrs: Number.MAX_SAFE_INTEGER,
  maxType1CharStringBytes: Number.MAX_SAFE_INTEGER,
  maxType1Operators: Number.MAX_SAFE_INTEGER,
  maxType1SubrDepth: Number.MAX_SAFE_INTEGER,
  maxType1SubrCalls: Number.MAX_SAFE_INTEGER,
  maxType1PathCommands: Number.MAX_SAFE_INTEGER,
  maxType1PostScriptOperations: Number.MAX_SAFE_INTEGER,
  maxType1PostScriptStack: Number.MAX_SAFE_INTEGER
});

export interface NativeType1Framing {
  readonly length1?: number;
  readonly length2?: number;
  readonly length3?: number;
  readonly signal?: AbortSignal;
}

export interface NativeType1RawOutline {
  readonly commands: readonly NativeGlyphPathCommand[];
  readonly advanceWidth: number;
  readonly leftSideBearing: number;
  readonly advanceY: number;
  readonly sideBearingY: number;
  readonly postScriptPaints?: readonly NativeGlyphPostScriptPaint[];
  readonly postScriptFinalState?: NativeGlyphPostScriptFinalState;
  /** Composite component implicit paints materialize after the PDF/font
   * PaintType policy is selected, preserving raw contours in both modes. */
  readonly postScriptPaintSequence?: readonly NativeType1PaintSequenceEntry[];
  readonly postScriptDiagnostics?: readonly PdfDiagnostic[];
}
type NativeType1PaintSequenceEntry = NativeGlyphPostScriptPaint | {
  readonly kind: "implicit";
  readonly commands: readonly NativeGlyphPathCommand[];
  readonly finalState?: NativeGlyphPostScriptFinalState;
};

export interface NativeType1CharStringOptions {
  readonly subrs?: readonly Uint8Array[] | ReadonlyMap<number, Uint8Array>;
  /** -1 means plaintext, as in CFF CharstringType 1 programs. */
  readonly lenIV?: number;
  readonly glyphId?: number;
  readonly limits?: Partial<NativeType1ParserLimits>;
  readonly signal?: AbortSignal;
  readonly budget?: NativeType1Budget;
  readonly onUnknownOtherSubr?: (index: number) => void;
  readonly blendWeights?: readonly number[];
  readonly executeOtherSubr?: (index: number, args: readonly number[], context: NativeFontPostScriptGlyphContext) => readonly number[] | null;
  /** Shared only while building one seac glyph; components retain the same
   * PostScript state and path until its final endchar. */
  readonly glyphContext?: NativeFontPostScriptGlyphContext;
  readonly initialCommands?: readonly NativeGlyphPathCommand[];
  readonly charStringOrigin?: readonly [number, number];
  /** Return base commands followed by accent commands translated by (x,y). */
  readonly resolveComposite?: (
    baseCode: number, accentCode: number, x: number, y: number
  ) => readonly NativeGlyphPathCommand[];
}

export interface NativeType1Budget {
  executedBytes: number;
  operators: number;
  subrCalls: number;
}

type Type1Matrix = readonly [number, number, number, number, number, number];
type PsToken =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "name" | "word" | "mark"; readonly value: string }
  | { readonly kind: "bytes"; readonly value: Uint8Array }
  | { readonly kind: "procedure"; readonly value: ReadonlySet<string>; readonly nonempty: boolean; readonly encodingInitializer: boolean };

/**
 * Adobe Type 1 Font Format, chapters 6–8. Ordinary records use a declarative
 * reader; computed dictionaries use the restricted font-local PS interpreter.
 * https://www.adobe.com/content/dam/acom/en/devnet/font/pdfs/T1_SPEC.pdf
 */
export class NativeType1Font {
  readonly unitsPerEm = 1000;
  readonly numGlyphs: number;
  readonly glyphNames: readonly string[];
  readonly builtInGlyphNames: readonly (string | null)[];
  readonly blendWeights: readonly number[] | null;
  readonly paintType: 0 | 2;
  readonly strokeWidth: number;
  private readonly glyphIds: ReadonlyMap<string, number>;
  private readonly rawCache = new Map<number, NativeType1RawOutline>();
  private readonly outlineCache = new Map<number, NativeGlyphOutline>();
  private readonly pdfOutlineCache = new Map<number, NativeGlyphOutline>();
  private readonly unknownOtherSubrs = new Set<number>();
  private fontDiagnostics: readonly PdfDiagnostic[] = Object.freeze([]);
  private readonly charStrings: readonly Uint8Array[];
  private readonly subrs: ReadonlyMap<number, Uint8Array>;
  private readonly matrix: Type1Matrix;
  private readonly limits: Readonly<NativeType1ParserLimits>;
  private signal?: AbortSignal;
  private otherSubrExecutorFactory?: NativeFontPostScriptResult["createOtherSubrExecutor"];

  get usesPostScript(): boolean {
    return this.otherSubrExecutorFactory !== undefined || this.fontDiagnostics.some(diagnostic => diagnostic.code === "font.type1-postscript-approximated");
  }

  private constructor(
    charStrings: readonly Uint8Array[],
    glyphNames: readonly string[],
    builtInGlyphNames: readonly (string | null)[],
    subrs: ReadonlyMap<number, Uint8Array>,
    matrix: Type1Matrix,
    limits: Readonly<NativeType1ParserLimits>,
    signal?: AbortSignal,
    blendWeights: readonly number[] | null = null,
    paintType: 0 | 2 = 0,
    strokeWidth = 0
  ) {
    this.charStrings = charStrings;
    this.subrs = subrs;
    this.matrix = matrix;
    this.limits = limits;
    this.signal = signal;
    this.blendWeights = blendWeights;
    this.paintType = paintType;
    this.strokeWidth = strokeWidth;
    this.numGlyphs = charStrings.length;
    this.glyphNames = Object.freeze([...glyphNames]);
    this.builtInGlyphNames = Object.freeze([...builtInGlyphNames]);
    this.glyphIds = new Map(glyphNames.map((name, index) => [name, index]));
  }

  static parse(
    sourceBytes: Uint8Array,
    overrides: Partial<NativeType1ParserLimits> = {},
    framing: NativeType1Framing = {}
  ): NativeType1Font {
    const limits = mergeType1Limits(overrides);
    if (!(sourceBytes instanceof Uint8Array)) throw new TypeError("Type1 source must be a Uint8Array.");
    throwIfAborted(framing.signal);
    ceiling(sourceBytes.length, limits.maxType1Bytes, "byte");
    const unpacked = unpackPfb(sourceBytes, framing);
    const bytes = unpacked.bytes;
    if (unpacked.length1 !== undefined && (!Number.isSafeInteger(unpacked.length1) ||
      unpacked.length1 < 0 || unpacked.length1 > bytes.length)) {
      throw invalid("The Type1 /Length1 is outside the cleartext section.", "framing");
    }
    // A loader may execute eexec from a procedure. Explicit PDF/PFB segment
    // boundaries keep the declarative scanner out of its binary ciphertext.
    const header = scanProgram(bytes.subarray(0, unpacked.length1 ?? bytes.length), limits, framing.signal, true);
    const framedEexec = unpacked.length1 !== undefined && ((unpacked.length2 ?? 0) > 0 ||
      header.tokens.some(token => token.kind === "procedure" && token.value.has("eexec")));
    const eexec = header.eexecEnd ?? (framedEexec ? unpacked.length1! : null);
    const cleartextEnd = eexec === null ? bytes.length : unpacked.length1 ?? eexec;
    let privateTokens: readonly PsToken[] = [];
    let privatePlaintext: Uint8Array | undefined;
    let tokenError: unknown;
    if (eexec !== null) {
      let start = eexec;
      while (start < bytes.length && isWhite(bytes[start])) start++;
      if (unpacked.length1 !== undefined) {
        if (!Number.isSafeInteger(unpacked.length1) || unpacked.length1 < eexec || unpacked.length1 > bytes.length) {
          throw invalid("The Type1 /Length1 is outside the cleartext section.", "framing");
        }
        start = unpacked.length1;
      }
      let end = bytes.length;
      if (unpacked.length2 !== undefined) {
        if (!Number.isSafeInteger(unpacked.length2) || unpacked.length2 < 0 || unpacked.length2 > bytes.length - start) {
          throw invalid("The Type1 /Length2 is outside the encrypted section.", "framing");
        }
        end = start + unpacked.length2;
      }
      let ciphertext = bytes.subarray(start, end);
      if (ciphertext.length >= 4 && ciphertext.subarray(0, 4).every(byte => hexValue(byte) >= 0)) {
        ciphertext = decodeEexecHex(ciphertext, framing.signal);
      }
      privatePlaintext = decrypt(ciphertext, 55665, 4, framing.signal);
      try { privateTokens = scanProgram(privatePlaintext, limits, framing.signal).tokens; }
      catch (error) { if (!isUnsupported(error)) throw error; tokenError = error; }
    }
    const tokens = [...header.tokens, ...privateTokens];
    const executeProgram = () => executeNativeFontPostScript(bytes.subarray(0, cleartextEnd), privatePlaintext, {
      signal: framing.signal, maxOperations: limits.maxType1PostScriptOperations, maxStack: limits.maxType1PostScriptStack,
      maxStringBytes: limits.maxType1StringBytes,
      standardEncoding: Array.from({ length: 256 }, (_, code) => standardEncodingName(code)), expertEncoding: CFF_EXPERT_ENCODING
    });
    const declarative = (): NativeType1Font => {
    if (tokenError) throw tokenError;
    const matrix = readMatrix(tokens);
    const paintType = readNumberRecord(tokens, "PaintType") ?? 0;
    if (paintType !== 0 && paintType !== 2) throw invalid("The Type1 PaintType must be 0 or 2.", "paint-type");
    const strokeWidth = readNumberRecord(tokens, "StrokeWidth") ?? 0;
    const fontType = readNumberRecord(tokens, "FontType");
    if (fontType !== undefined && fontType !== 1) throw invalid("The font program is not Type1.", "font-type");
    const blendWeights = readBlendMetadata(tokens, framing.signal);
    const lenIV = readNumberRecord(tokens, "lenIV") ?? 4;
    if (!Number.isSafeInteger(lenIV) || lenIV < -1) throw invalid("The Type1 lenIV is invalid.", "leniv");
    const glyphs = new Map<string, Uint8Array>();
    const subrs = new Map<number, Uint8Array>();
    let section: "subrs" | "glyphs" | null = null;
    let declaredSubrs = 0;
    let stringBytes = 0;
    let dictionaryDepth = 0, charStringsDepth: number | null = null;
    let awaitCharStringsBegin = false;
    for (let i = 0; i < tokens.length; i++) {
      throwIfAborted(framing.signal);
      const token = tokens[i];
      if (token.kind === "word" && token.value === "begin") {
        dictionaryDepth++;
        if (awaitCharStringsBegin) { charStringsDepth = dictionaryDepth; awaitCharStringsBegin = false; }
      } else if (token.kind === "word" && token.value === "end") {
        if (section === "glyphs" && dictionaryDepth === charStringsDepth) { section = null; charStringsDepth = null; }
        dictionaryDepth--;
      }
      if (token.kind === "name" && token.value === "Subrs") {
        section = "subrs";
        declaredSubrs = nonnegativeInteger(tokens[i + 1], "Subrs count");
        ceiling(declaredSubrs, limits.maxType1Subrs, "subrs");
      } else if (token.kind === "name" && token.value === "CharStrings") {
        section = "glyphs";
        awaitCharStringsBegin = true;
        ceiling(nonnegativeInteger(tokens[i + 1], "CharStrings count"), limits.maxType1Glyphs, "glyphs");
      } else if (section === "subrs" && token.kind === "word" && token.value === "dup" &&
        (tokens[i + 3]?.kind === "bytes" || tokens[i + 2]?.kind === "bytes")) {
        const index = nonnegativeInteger(tokens[i + 1], "Subrs index");
        if (index >= declaredSubrs) throw invalid("A Type1 subroutine index exceeds /Subrs.", "subr-index");
        const stringOffset = tokens[i + 2]?.kind === "bytes" ? 2 : 3;
        const raw = (tokens[i + stringOffset] as { kind: "bytes"; value: Uint8Array }).value;
        if (stringOffset === 3 && nonnegativeInteger(tokens[i + 2], "Subrs string length") !== raw.length) throw invalid("A Type1 subroutine string length disagrees.", "string-length");
        stringBytes += raw.length;
        ceiling(stringBytes, limits.maxType1StringBytes, "string-bytes");
        subrs.set(index, lenIV === -1 ? raw.slice() : decrypt(raw, 4330, lenIV, framing.signal));
        i += stringOffset;
      } else if (section === "glyphs" && charStringsDepth !== null && token.kind === "name" &&
        (tokens[i + 2]?.kind === "bytes" || tokens[i + 1]?.kind === "bytes")) {
        const stringOffset = tokens[i + 1]?.kind === "bytes" ? 1 : 2;
        const raw = (tokens[i + stringOffset] as { kind: "bytes"; value: Uint8Array }).value;
        if (stringOffset === 2 && nonnegativeInteger(tokens[i + 1], "CharStrings string length") !== raw.length) throw invalid("A Type1 glyph string length disagrees.", "string-length");
        if (glyphs.has(token.value)) throw invalid(`Duplicate Type1 glyph /${token.value}.`, "duplicate-glyph");
        stringBytes += raw.length;
        ceiling(stringBytes, limits.maxType1StringBytes, "string-bytes");
        glyphs.set(token.value, lenIV === -1 ? raw.slice() : decrypt(raw, 4330, lenIV, framing.signal));
        ceiling(glyphs.size, limits.maxType1Glyphs, "glyphs");
        i += stringOffset;
      } else if (section === "glyphs" && charStringsDepth === dictionaryDepth && token.kind === "name") {
        throw invalid(`Type1 glyph /${token.value} requires an unsupported PostScript expression.`, "charstring-expression");
      } else if (section === "subrs" && token.kind === "word" && token.value === "dup" && tokens[i + 1]?.kind === "number") {
        throw invalid("A Type1 subroutine requires an unsupported PostScript expression.", "subr-expression");
      }
    }
    if (!glyphs.size) throw invalid("The Type1 program has no readable CharStrings.", "charstrings-missing");
    const notdef = glyphs.get(".notdef") ?? Uint8Array.of(139, 139, 13, 14);
    glyphs.delete(".notdef");
    const names = [".notdef", ...glyphs.keys()];
    ceiling(names.length, limits.maxType1Glyphs, "glyphs");
    return new NativeType1Font([notdef, ...glyphs.values()], names, readEncoding(tokens), subrs,
      matrix, limits, framing.signal, blendWeights, paintType, strokeWidth);
    };
    let font: NativeType1Font;
    try {
      if (hasComputedFontRecords(tokens)) throw invalid("The Type1 dictionary requires PostScript evaluation.", "dictionary-expression");
      font = declarative();
    }
    catch (error) {
      if (!isUnsupported(error)) throw error;
      try {
        const computed = executeProgram();
        font = NativeType1Font.fromComputed(computed.dictionary, limits, framing.signal);
        font.otherSubrExecutorFactory = computed.createOtherSubrExecutor;
        return font;
      } catch (computedError) {
        // Keep a precise malformed-font reason when the broader reader cannot
        // recover it. Caller limits and cancellation always retain precedence.
        if (!isUnsupported(computedError)) throw computedError;
        if (String(error.details?.reason).endsWith("expression") && computedError.details?.operator) throw computedError;
        throw error;
      }
    }
    if (hasOpaqueLoadingCode(tokens)) {
      try {
        const computed = executeProgram();
        font = NativeType1Font.fromComputed(computed.dictionary, limits, framing.signal);
        font.otherSubrExecutorFactory = computed.createOtherSubrExecutor;
        return font;
      } catch (error) {
        if (!isUnsupported(error)) throw error;
        font.fontDiagnostics = Object.freeze([...font.fontDiagnostics, Object.freeze({
          code: "font.type1-postscript-approximated", severity: "warning",
          message: "The Type1 program uses unsupported loading procedures; its declarative font records are retained and may differ from the computed design.",
          details: Object.freeze({ reason: "font-postscript-unsupported", ...type1PostScriptFailureDetails(error) })
        })]);
      }
    }
    if (hasCustomOtherSubrs(tokens, font.blendWeights !== null)) {
      try { font.otherSubrExecutorFactory = executeProgram().createOtherSubrExecutor; }
      catch (error) { if (!isUnsupported(error)) throw error; }
    }
    return font;
  }

  private static fromComputed(dictionary: ReadonlyMap<string, NativeFontPostScriptValue>,
    limits: Readonly<NativeType1ParserLimits>, signal?: AbortSignal): NativeType1Font {
    const privateValue = dictionary.get("Private");
    const privateDictionary = privateValue instanceof Map ? privateValue : dictionary;
    const numeric = (key: string, fallback: number): number => {
      const value = dictionary.get(key) ?? privateDictionary.get(key) ?? fallback;
      if (typeof value !== "number" || !Number.isFinite(value)) throw invalid(`Computed Type1 /${key} is not a finite number.`, "postscript-record");
      return value;
    };
    if (numeric("FontType", 1) !== 1) throw invalid("The computed font program is not Type1.", "font-type");
    const paintType = numeric("PaintType", 0);
    if (paintType !== 0 && paintType !== 2) throw invalid("The Type1 PaintType must be 0 or 2.", "paint-type");
    const strokeWidth = numeric("StrokeWidth", 0);
    const matrixValue = dictionary.get("FontMatrix") ?? [0.001, 0, 0, 0.001, 0, 0];
    if (!Array.isArray(matrixValue) || matrixValue.length !== 6 || matrixValue.some(value => typeof value !== "number" || !Number.isFinite(value))) {
      throw invalid("The computed Type1 FontMatrix is invalid.", "font-matrix");
    }
    const matrix = matrixValue as unknown as Type1Matrix;
    if (matrix[0] * matrix[3] === matrix[1] * matrix[2]) throw invalid("The computed Type1 FontMatrix is singular.", "font-matrix");
    const lenIV = numeric("lenIV", 4);
    if (!Number.isSafeInteger(lenIV) || lenIV < -1) throw invalid("The Type1 lenIV is invalid.", "leniv");
    const glyphValues = dictionary.get("CharStrings");
    if (!(glyphValues instanceof Map) || !glyphValues.size) throw invalid("The computed Type1 program has no CharStrings dictionary.", "charstrings-missing");
    ceiling(glyphValues.size, limits.maxType1Glyphs, "glyphs");
    let stringBytes = 0;
    const string = (value: NativeFontPostScriptValue): Uint8Array => {
      if (!(value instanceof Uint8Array)) throw invalid("A computed Type1 CharString or Subr is not a byte string.", "postscript-record");
      stringBytes += value.length; ceiling(stringBytes, limits.maxType1StringBytes, "string-bytes");
      return lenIV === -1 ? value.slice() : decrypt(value, 4330, lenIV, signal);
    };
    const glyphs = new Map<string, Uint8Array>();
    for (const [name, value] of glyphValues) { throwIfAborted(signal); glyphs.set(name, string(value)); }
    const subrs = new Map<number, Uint8Array>();
    const subrValues = privateDictionary.get("Subrs");
    if (subrValues !== undefined) {
      if (!Array.isArray(subrValues)) throw invalid("The computed Type1 Subrs is not an array.", "postscript-record");
      ceiling(subrValues.length, limits.maxType1Subrs, "subrs");
      for (let i = 0; i < subrValues.length; i++) {
        throwIfAborted(signal);
        if (subrValues[i] !== null) subrs.set(i, string(subrValues[i]));
      }
    }
    const encodingValue = dictionary.get("Encoding");
    let encoding: readonly (string | null)[] = Array.from({ length: 256 }, (_, code) => standardEncodingName(code));
    if (encodingValue !== undefined) {
      if (!Array.isArray(encodingValue) || encodingValue.length > 256) throw invalid("The computed Type1 Encoding is invalid.", "encoding");
      encoding = Array.from({ length: 256 }, (_, code) => {
        const value = encodingValue[code];
        if (value === null || value === undefined) return null;
        if (typeof value !== "object" || !("kind" in value) || value.kind !== "name") throw invalid("A computed Type1 Encoding entry is not a name.", "encoding");
        return value.value === ".notdef" ? null : value.value;
      });
    }
    const fontInfo = dictionary.get("FontInfo");
    const records = new Map<string, Type1Literal[]>();
    for (const key of ["WeightVector", "BlendAxisTypes", "BlendDesignPositions", "BlendDesignMap"]) {
      const value = dictionary.get(key) ?? privateDictionary.get(key) ?? (fontInfo instanceof Map ? fontInfo.get(key) : undefined);
      if (value === undefined) continue;
      if (!Array.isArray(value)) throw invalid(`Computed Type1 /${key} is not an array.`, "multiple-master-expression");
      records.set(key, computedLiteralArray(value, signal));
    }
    const blendWeights = validateBlendMetadata(records);
    const notdef = glyphs.get(".notdef") ?? Uint8Array.of(139, 139, 13, 14);
    glyphs.delete(".notdef");
    const names = [".notdef", ...glyphs.keys()];
    ceiling(names.length, limits.maxType1Glyphs, "glyphs");
    return new NativeType1Font([notdef, ...glyphs.values()], names, encoding, subrs, matrix, limits, signal,
      blendWeights, paintType, strokeWidth);
  }

  glyphIdForName(name: string | null): number { return name === null ? 0 : this.glyphIds.get(name) ?? 0; }

  get diagnostics(): readonly PdfDiagnostic[] { return this.fontDiagnostics; }

  releaseParseSignal(): void { this.signal = undefined; }

  getGlyphOutline(glyphId: number, applyIntrinsicPaint = true, signal?: AbortSignal): NativeGlyphOutline {
    signal ??= this.signal;
    throwIfAborted(signal);
    if (!Number.isSafeInteger(glyphId) || glyphId < 0 || glyphId >= this.numGlyphs) {
      throw invalid(`Type1 glyph ${glyphId} is outside CharStrings.`, "glyph-index");
    }
    const cache = applyIntrinsicPaint ? this.outlineCache : this.pdfOutlineCache;
    const cached = cache.get(glyphId);
    if (cached) return cached;
    const raw = this.getRawOutline(glyphId, signal);
    const transform = Object.freeze(this.matrix.map(value => value * 1000));
    const paintType = applyIntrinsicPaint ? this.paintType : 0;
    const painted = paintNativeGlyphCommands(raw.commands, paintType, this.strokeWidth, {
      transform, signal: signal, maxPathCommands: this.limits.maxType1PathCommands
    });
    if (painted.approximated && !this.fontDiagnostics.some(diagnostic => diagnostic.code === "font.type1-stroke-approximated")) {
      this.fontDiagnostics = Object.freeze([...this.fontDiagnostics, Object.freeze({
        code: "font.type1-stroke-approximated", severity: "warning" as const,
        message: "The Type1 stroked outline uses the native vector stroke approximation.",
        details: Object.freeze({ reason: "type1-stroke-approximation", approximate: true })
      })]);
    }
    const commands = painted.commands;
    const materializedPaints: readonly NativeGlyphPostScriptPaint[] | undefined = raw.postScriptPaintSequence?.map(record => {
      if (record.kind !== "implicit") return record;
      const state = record.finalState;
      if (paintType === 2) {
        const changed = state?.changedStrokeFields ?? [];
        const stroke = state?.stroke;
        return Object.freeze({ kind: "stroke" as const, commands: record.commands, fillRule: 0 as const,
          clips: state?.clips ?? Object.freeze([]), color: state?.color ?? null, ...(state?.deviceColor ? { deviceColor: state.deviceColor } : {}), ...(state?.pattern ? { pattern: state.pattern } : {}),
          changedStrokeFields: Object.freeze([...new Set(["width" as const, ...changed])]),
          stroke: Object.freeze({ width: changed.includes("width") && stroke ? stroke.width : Math.abs(this.strokeWidth),
            lineCap: stroke?.lineCap ?? 0, lineJoin: stroke?.lineJoin ?? 0, miterLimit: stroke?.miterLimit ?? 10,
            dashArray: stroke?.dashArray ?? Object.freeze([]), dashPhase: stroke?.dashPhase ?? 0,
            transform: stroke?.transform ?? Object.freeze([1, 0, 0, 1, 0, 0]) }) });
      }
      return Object.freeze({ kind: "fill" as const, commands: record.commands, fillRule: 0 as const,
        clips: state?.clips ?? Object.freeze([]), color: state?.color ?? null, ...(state?.deviceColor ? { deviceColor: state.deviceColor } : {}), ...(state?.pattern ? { pattern: state.pattern } : {}) });
    }) ?? raw.postScriptPaints;
    const postScriptPaints = materializedPaints ? transformNativeGlyphPostScriptPaints(materializedPaints, transform as Type1Matrix) : undefined;
    let normalBounds = painted.bounds ?? measureBounds(commands);
    if (paintType === 2 && raw.postScriptFinalState && !raw.postScriptFinalState.omitFinalPaint) {
      const state = raw.postScriptFinalState, stroke = state.stroke;
      const centerline = paintNativeGlyphCommands(raw.commands, 0, 0, { transform, signal: signal,
        maxPathCommands: this.limits.maxType1PathCommands }).commands;
      const finalStroke = transformNativeGlyphPostScriptFinalState({ ...state, stroke: {
        width: state.changedStrokeFields?.includes("width") && stroke ? stroke.width : Math.abs(this.strokeWidth),
        lineCap: stroke?.lineCap ?? 0, lineJoin: stroke?.lineJoin ?? 0, miterLimit: stroke?.miterLimit ?? 10,
        dashArray: stroke?.dashArray ?? [], dashPhase: stroke?.dashPhase ?? 0,
        transform: stroke?.transform ?? [1, 0, 0, 1, 0, 0]
      } }, transform as Type1Matrix).stroke;
      const finalBounds = nativeGlyphPostScriptPaintBounds([{ kind: "stroke", commands: centerline,
        fillRule: 0, clips: [], color: null, stroke: finalStroke }]);
      if (finalBounds) normalBounds = Object.freeze([Math.min(normalBounds[0], finalBounds[0]), Math.min(normalBounds[1], finalBounds[1]),
        Math.max(normalBounds[2], finalBounds[2]), Math.max(normalBounds[3], finalBounds[3])]);
    }
    const explicitBounds = postScriptPaints ? nativeGlyphPostScriptPaintBounds(postScriptPaints) : null;
    const bounds = explicitBounds ? Object.freeze([Math.min(commands.length ? normalBounds[0] : Infinity, explicitBounds[0]),
      Math.min(commands.length ? normalBounds[1] : Infinity, explicitBounds[1]),
      Math.max(commands.length ? normalBounds[2] : -Infinity, explicitBounds[2]),
      Math.max(commands.length ? normalBounds[3] : -Infinity, explicitBounds[3])]) as readonly [number, number, number, number] : normalBounds;
    const [leftSideBearing] = transformPoint(raw.leftSideBearing, raw.sideBearingY, this.matrix);
    const outline = Object.freeze({ glyphId, commands, bounds,
      advanceWidth: finite(this.matrix[0] * 1000 * raw.advanceWidth + this.matrix[2] * 1000 * raw.advanceY),
      leftSideBearing,
      ...(postScriptPaints?.length ? { postScriptPaints } : {}),
      ...(raw.postScriptFinalState ? { postScriptFinalState: transformNativeGlyphPostScriptFinalState(raw.postScriptFinalState, transform as Type1Matrix) } : {}),
      ...(paintType === 2 ? { intrinsicStroke: Object.freeze({ width: this.strokeWidth, transform, commands: raw.commands }) } : {}) });
    cache.set(glyphId, outline);
    return outline;
  }

  private getRawOutline(glyphId: number, signal?: AbortSignal): NativeType1RawOutline {
    if (this.otherSubrExecutorFactory) {
      const cached = this.rawCache.get(glyphId);
      if (cached) return cached;
      let executeOtherSubr: ReturnType<NativeFontPostScriptResult["createOtherSubrExecutor"]> | undefined;
      let otherSubrFailure: PdfError | undefined;
      const raw = evaluateNativeType1CompositeGlyph({ source: this.charStrings[glyphId], glyphId, subrs: this.subrs }, {
        limits: this.limits, signal: signal, blendWeights: this.blendWeights ?? undefined,
        executeOtherSubr: (index, args, context) => {
          otherSubrFailure = undefined;
          try { executeOtherSubr ??= this.otherSubrExecutorFactory!(signal, context); return executeOtherSubr(index, args); }
          catch (error) { if (!isUnsupported(error)) throw error; otherSubrFailure = error; return null; }
        },
        onUnknownOtherSubr: index => {
          if (this.unknownOtherSubrs.has(index)) return;
          this.unknownOtherSubrs.add(index);
          this.fontDiagnostics = Object.freeze([...this.fontDiagnostics, Object.freeze({
            code: "font.type1-othersubr-approximated", severity: "warning" as const,
            message: `Type1 OtherSubr ${index} uses the format's argument-preserving compatibility fallback; extension-specific rendering may differ.`,
            details: Object.freeze({ reason: "type1-unknown-othersubr", othersubr: index, approximate: true,
              ...(otherSubrFailure ? type1PostScriptFailureDetails(otherSubrFailure) : {}) })
          })]);
        },
        resolveGlyph: code => {
          const name = standardEncodingName(code), id = name === null ? undefined : this.glyphIds.get(name);
          if (id === undefined) throw invalid("A Type1 seac references a missing StandardEncoding glyph.", "seac-glyph");
          return { source: this.charStrings[id], glyphId: id, subrs: this.subrs };
        }
      });
      for (const diagnostic of raw.postScriptDiagnostics ?? []) {
        if (!this.fontDiagnostics.some(existing => existing.code === diagnostic.code)) this.fontDiagnostics = Object.freeze([...this.fontDiagnostics, diagnostic]);
      }
      this.rawCache.set(glyphId, raw);
      return raw;
    }
    // Explicit dependency traversal avoids a JS call-stack limit on composites.
    const pending = [glyphId];
    const active = new Set(pending);
    const budget: NativeType1Budget = { executedBytes: 0, operators: 0, subrCalls: 0 };
    type Composite = { baseId: number; accentId: number; x: number; y: number };
    const evaluated = new Map<number, { raw: NativeType1RawOutline; composite?: Composite }>();
    while (pending.length) {
      throwIfAborted(signal);
      ceiling(pending.length, this.limits.maxType1SubrDepth, "composite-depth");
      const id = pending[pending.length - 1];
      if (this.rawCache.has(id)) { pending.pop(); active.delete(id); continue; }
      let entry = evaluated.get(id);
      if (!entry) {
        const composite: { value?: Composite } = {};
        const executorFactory = this.otherSubrExecutorFactory as NativeFontPostScriptResult["createOtherSubrExecutor"] | undefined;
        let executeOtherSubr: ReturnType<NonNullable<typeof executorFactory>> | undefined;
        let otherSubrFailure: PdfError | undefined;
        const raw = evaluateNativeType1CharString(this.charStrings[id], {
          subrs: this.subrs, glyphId: id, limits: this.limits, signal: signal, budget,
          ...(this.blendWeights ? { blendWeights: this.blendWeights } : {}),
          executeOtherSubr: executorFactory ? (index, args, context) => {
            otherSubrFailure = undefined;
            try { executeOtherSubr ??= executorFactory(signal, context); return executeOtherSubr(index, args); }
            catch (error) { if (!isUnsupported(error)) throw error; otherSubrFailure = error; return null; }
          } : undefined,
          onUnknownOtherSubr: index => {
            if (this.unknownOtherSubrs.has(index)) return;
            this.unknownOtherSubrs.add(index);
            this.fontDiagnostics = Object.freeze([...this.fontDiagnostics, Object.freeze({
              code: "font.type1-othersubr-approximated", severity: "warning" as const,
              message: `Type1 OtherSubr ${index} uses the format's argument-preserving compatibility fallback; extension-specific rendering may differ.`,
              details: Object.freeze({ reason: "type1-unknown-othersubr", othersubr: index, approximate: true,
                ...(otherSubrFailure ? type1PostScriptFailureDetails(otherSubrFailure) : {}) })
            })]);
          },
          resolveComposite: (baseCode, accentCode, x, y) => {
            const baseName = standardEncodingName(baseCode), accentName = standardEncodingName(accentCode);
            const baseId = baseName === null ? undefined : this.glyphIds.get(baseName);
            const accentId = accentName === null ? undefined : this.glyphIds.get(accentName);
            if (baseId === undefined || accentId === undefined) throw invalid("A Type1 seac references a missing StandardEncoding glyph.", "seac-glyph");
            composite.value = { baseId, accentId, x, y };
            return [];
          }
        });
        for (const diagnostic of raw.postScriptDiagnostics ?? []) {
          if (!this.fontDiagnostics.some(existing => existing.code === diagnostic.code)) this.fontDiagnostics = Object.freeze([...this.fontDiagnostics, diagnostic]);
        }
        entry = { raw, composite: composite.value };
        evaluated.set(id, entry);
      }
      if (!entry.composite) this.rawCache.set(id, entry.raw);
      else {
        const { baseId, accentId, x, y } = entry.composite;
        const base = this.rawCache.get(baseId), accent = this.rawCache.get(accentId);
        if (base && accent) {
          const commands = [...base.commands, ...accent.commands.map(command => Object.freeze(translateCommand(command, x, y)))];
          ceiling(commands.length, this.limits.maxType1PathCommands, "path-commands");
          const promoteFinal = Boolean(base.postScriptFinalState || accent.postScriptFinalState);
          if (promoteFinal && entry.raw.postScriptFinalState &&
            !this.fontDiagnostics.some(diagnostic => diagnostic.code === "font.type1-seac-state-approximated")) {
            this.fontDiagnostics = Object.freeze([...this.fontDiagnostics, Object.freeze({
              code: "font.type1-seac-state-approximated", severity: "warning" as const,
              message: "A Type1 seac parent's PostScript state is not fully inherited by its separately evaluated components; component paints are retained approximately.",
              details: Object.freeze({ reason: "type1-seac-parent-state", approximate: true })
            })]);
          }
          const componentSequence = (component: NativeType1RawOutline): readonly NativeType1PaintSequenceEntry[] => [
            ...(component.postScriptPaintSequence ?? component.postScriptPaints ?? []),
            ...(!component.postScriptFinalState?.omitFinalPaint && component.commands.length ? [Object.freeze({
              kind: "implicit" as const, commands: component.commands,
              ...(component.postScriptFinalState ? { finalState: component.postScriptFinalState } : {}) })] : [])];
          const translatedSequence = (sequence: readonly NativeType1PaintSequenceEntry[]): readonly NativeType1PaintSequenceEntry[] => sequence.map(record =>
            record.kind === "implicit" ? Object.freeze({ ...record, commands: Object.freeze(record.commands.map(command => Object.freeze(translateCommand(command, x, y)))),
              ...(record.finalState ? { finalState: transformNativeGlyphPostScriptFinalState(record.finalState, [1, 0, 0, 1, x, y]) } : {}) })
              : transformNativeGlyphPostScriptPaints([record], [1, 0, 0, 1, x, y])[0]);
          const postScriptPaintSequence = promoteFinal ? Object.freeze([...(entry.raw.postScriptPaintSequence ?? entry.raw.postScriptPaints ?? []),
            ...componentSequence(base), ...translatedSequence(componentSequence(accent))]) : undefined;
          const postScriptPaints = postScriptPaintSequence ? undefined : Object.freeze([...(entry.raw.postScriptPaints ?? []), ...(base.postScriptPaints ?? []),
            ...transformNativeGlyphPostScriptPaints(accent.postScriptPaints ?? [], [1, 0, 0, 1, x, y])]);
          const postScriptFinalState: NativeGlyphPostScriptFinalState | undefined = promoteFinal
            ? Object.freeze({ clips: Object.freeze([]), color: null, omitFinalPaint: true }) : entry.raw.postScriptFinalState;
          const sequenceCount = postScriptPaintSequence?.reduce((count, record) => count + (record.kind === "implicit"
            ? record.commands.length + nativeGlyphPostScriptCommandCount([], record.finalState)
            : nativeGlyphPostScriptCommandCount([record])), 0) ?? nativeGlyphPostScriptCommandCount(postScriptPaints ?? [], postScriptFinalState);
          ceiling(commands.length + sequenceCount, this.limits.maxType1PathCommands, "path-commands");
          this.rawCache.set(id, Object.freeze({ ...entry.raw, commands: Object.freeze(commands),
            ...(postScriptPaints?.length ? { postScriptPaints } : {}), ...(postScriptPaintSequence ? { postScriptPaintSequence } : {}),
            ...(postScriptFinalState ? { postScriptFinalState } : {}) }));
          continue;
        }
        // Push one dependency at a time so shared siblings are not mistaken for cycles.
        const dependency = base ? accentId : baseId;
        if (active.has(dependency)) throw invalid("A Type1 seac composite contains a glyph cycle.", "seac-cycle");
        pending.push(dependency); active.add(dependency);
      }
    }
    return this.rawCache.get(glyphId)!;
  }
}

export interface NativeType1CompositeGlyph {
  readonly source: Uint8Array;
  readonly glyphId: number;
  readonly subrs?: NativeType1CharStringOptions["subrs"];
}

/** Build seac in one glyph-local PostScript environment. The base endchar
 * ends its subglyph, while the accent endchar finishes the combined path;
 * neither component gets a separate implicit paint or VM clone. An explicit
 * traversal avoids the host call stack on nested composites. */
export function evaluateNativeType1CompositeGlyph(
  glyph: NativeType1CompositeGlyph,
  options: Omit<NativeType1CharStringOptions, "glyphId" | "subrs" | "resolveComposite" | "glyphContext" | "initialCommands" | "charStringOrigin"> & {
    readonly resolveGlyph: (standardEncodingCode: number) => NativeType1CompositeGlyph;
  }
): NativeType1RawOutline {
  const limits = mergeType1Limits(options.limits ?? {});
  const context = new NativeFontPostScriptGlyphContext({ signal: options.signal, maxPathCommands: limits.maxType1PathCommands });
  const budget = options.budget ?? { operators: 0, executedBytes: 0, subrCalls: 0 };
  type Frame = { glyph: NativeType1CompositeGlyph; origin: readonly [number, number];
    children?: readonly { glyph: NativeType1CompositeGlyph; origin: readonly [number, number] }[]; next: number };
  const frames: Frame[] = [{ glyph, origin: [0, 0], next: 0 }];
  const active = new Set<number>([glyph.glyphId]);
  let root: NativeType1RawOutline | undefined;
  while (frames.length) {
    throwIfAborted(options.signal);
    ceiling(frames.length, limits.maxType1SubrDepth, "composite-depth");
    const frame = frames[frames.length - 1];
    if (!frame.children) {
      let children: Frame["children"];
      const raw = evaluateNativeType1CharString(frame.glyph.source, { ...options, budget,
        glyphId: frame.glyph.glyphId, subrs: frame.glyph.subrs,
        glyphContext: context, initialCommands: context.pathCommands, charStringOrigin: frame.origin,
        resolveComposite: (baseCode, accentCode, x, y) => {
          children = [{ glyph: options.resolveGlyph(baseCode), origin: frame.origin },
            { glyph: options.resolveGlyph(accentCode), origin: [finite(frame.origin[0] + x), finite(frame.origin[1] + y)] }];
          return [];
        } });
      root ??= raw;
      frame.children = children ?? [];
    }
    const child = frame.children[frame.next++];
    if (child) {
      if (active.has(child.glyph.glyphId)) throw invalid("A Type1 seac composite contains a glyph cycle.", "seac-cycle");
      active.add(child.glyph.glyphId);
      frames.push({ ...child, next: 0 });
    } else { active.delete(frame.glyph.glyphId); frames.pop(); }
  }
  const commands = context.pathCommands, postScriptPaints = context.paintRecords, postScriptFinalState = context.finalState;
  ceiling(commands.length + nativeGlyphPostScriptCommandCount(postScriptPaints, postScriptFinalState), limits.maxType1PathCommands, "path-commands");
  return Object.freeze({ commands, advanceWidth: root!.advanceWidth, advanceY: root!.advanceY,
    leftSideBearing: root!.leftSideBearing, sideBearingY: root!.sideBearingY,
    ...(postScriptPaints.length ? { postScriptPaints } : {}), ...(postScriptFinalState ? { postScriptFinalState } : {}),
    ...(context.diagnostics.length ? { postScriptDiagnostics: context.diagnostics } : {}) });
}

/** Evaluates untransformed Type1 charstrings; CFF callers use lenIV=-1. */
export function evaluateNativeType1CharString(
  source: Uint8Array,
  options: NativeType1CharStringOptions = {}
): NativeType1RawOutline {
  const limits = mergeType1Limits(options.limits ?? {});
  const blendWeights = options.blendWeights ? validateBlendWeights(options.blendWeights) : null;
  const lenIV = options.lenIV ?? -1;
  if (!Number.isSafeInteger(lenIV) || lenIV < -1) throw invalid("The Type1 lenIV is invalid.", "leniv");
  const plain = (bytes: Uint8Array) => lenIV === -1 ? bytes : decrypt(bytes, 4330, lenIV, options.signal);
  const frames: { bytes: Uint8Array; offset: number; subr: number | null }[] = [{ bytes: plain(source), offset: 0, subr: null }];
  const activeSubrs = new Set<number>();
  const stack: number[] = [], results: number[] = [];
  const initialCommands = options.initialCommands ?? [];
  const commands: NativeGlyphPathCommand[] = [...initialCommands];
  let graphics: NativeFontPostScriptGlyphContext | undefined = options.glyphContext;
  const [originX, originY] = options.charStringOrigin ?? [0, 0];
  let x = originX, y = originY, sbx = 0, sby = 0, wx = 0, wy = 0;
  let metrics = false, open = false, ended = false;
  let flex: { x: number; y: number }[] | null = null;
  const budget = options.budget ?? { operators: 0, executedBytes: 0, subrCalls: 0 };
  const fail = (message: string): never => { throw invalid(`Type1 glyph ${options.glyphId ?? 0}: ${message}`, "invalid-charstring"); };
  const push = (value: number) => {
    if (stack.length >= 24) fail("The 24-operand Type1 stack overflows.");
    stack.push(finite(value));
  };
  const pop = (): number => { if (!stack.length) return fail("The operand stack underflows."); return stack.pop()!; };
  const args = (count: number): number[] => {
    if (stack.length !== count) return fail(`An operator requires ${count} operands, received ${stack.length}.`);
    return stack.splice(0);
  };
  const append = (command: NativeGlyphPathCommand) => {
    ceiling(commands.length + 1, limits.maxType1PathCommands, "path-commands");
    commands.push(command);
  };
  const close = () => { if (open) { append({ kind: "close" }); open = false; } };
  // BuildChar keeps its original character-space mapping and point. OtherSubr
  // CTMs affect PostScript marks and pens, rather than these charstring deltas.
  const move = (dx: number, dy: number) => {
    x = finite(x + dx); y = finite(y + dy);
    if (!flex) { close(); append({ kind: "move", x, y }); open = true; }
  };
  const line = (dx: number, dy: number) => {
    if (!open || flex) fail("A line occurs outside an ordinary contour.");
    x = finite(x + dx); y = finite(y + dy); append({ kind: "line", x, y });
  };
  const curve = (dx1: number, dy1: number, dx2: number, dy2: number, dx3: number, dy3: number) => {
    if (!open || flex) fail("A curve occurs outside an ordinary contour.");
    const control1X = finite(x + dx1), control1Y = finite(y + dy1);
    const control2X = finite(control1X + dx2), control2Y = finite(control1Y + dy2);
    x = finite(control2X + dx3); y = finite(control2Y + dy3);
    append({ kind: "cubic", control1X, control1Y, control2X, control2Y, x, y });
  };
  const readByte = (frame: typeof frames[number]): number => {
    if (frame.offset >= frame.bytes.length) return fail("A charstring operand is truncated.");
    ceiling(++budget.executedBytes, limits.maxType1CharStringBytes, "charstring-bytes");
    return frame.bytes[frame.offset++];
  };
  while (frames.length && !ended) {
    throwIfAborted(options.signal);
    const frame = frames[frames.length - 1];
    if (frame.offset === frame.bytes.length) fail(frame.subr === null ? "Missing endchar." : "A subroutine has no return.");
    const byte = readByte(frame);
    // OtherSubr results may only be read by immediately following pop commands;
    // the format explicitly discards any unused extension arguments.
    if (results.length && !(byte === 12 && frame.bytes[frame.offset] === 17)) results.length = 0;
    if (byte >= 32) {
      if (byte <= 246) push(byte - 139);
      else if (byte <= 250) push((byte - 247) * 256 + readByte(frame) + 108);
      else if (byte <= 254) push(-(byte - 251) * 256 - readByte(frame) - 108);
      else push((readByte(frame) << 24) | (readByte(frame) << 16) | (readByte(frame) << 8) | readByte(frame));
      continue;
    }
    ceiling(++budget.operators, limits.maxType1Operators, "operators");
    if (byte === 12) {
      const escape = readByte(frame);
      switch (escape) {
        case 0: args(0); break; // dotsection: hint only
        case 1: case 2: args(6); break; // vstem3 / hstem3
        case 6: {
          const [asb, adx, ady, baseCode, accentCode] = args(5);
          const priorPathOnly = commands.length === initialCommands.length && commands.every((command, index) => command === initialCommands[index]);
          if (!metrics || (!priorPathOnly && commands.length) || flex) fail("An invalid seac composite was encountered.");
          if (!Number.isSafeInteger(baseCode) || baseCode < 0 || baseCode > 255 ||
            !Number.isSafeInteger(accentCode) || accentCode < 0 || accentCode > 255) fail("seac codes are outside StandardEncoding.");
          if (!options.resolveComposite) fail("seac requires a composite resolver.");
          const composite = options.resolveComposite!(baseCode, accentCode, finite(adx + sbx - asb), ady);
          for (const command of composite) append(command);
          ended = true; break;
        }
        case 7: {
          const values = args(4);
          if (metrics || commands.length !== initialCommands.length) fail("Duplicate or late sbw.");
          [sbx, sby, wx, wy] = values; x = finite(sbx + originX); y = finite(sby + originY); metrics = true;
          graphics?.setMetrics(wx, wy); break;
        }
        case 12: { const right = pop(), left = pop(); if (right === 0) fail("div divides by zero."); push(left / right); break; }
        case 16: {
          const other = pop(), count = pop();
          if (!Number.isSafeInteger(other) || other < 0 || !Number.isSafeInteger(count) || count < 0 || count > stack.length) fail("Invalid callothersubr arguments.");
          const values = stack.splice(stack.length - count, count);
          if (other === 1) {
            if (count || flex || !open) fail("Invalid flex start.");
            flex = [];
          } else if (other === 2) {
            if (count || !flex || flex.length >= 7) fail("Invalid flex point.");
            flex!.push({ x, y });
          } else if (other === 0) {
            if (count !== 3 || !flex || flex.length !== 7) fail("Invalid flex end.");
            const points = flex!; flex = null;
            append({ kind: "cubic", control1X: points[1].x, control1Y: points[1].y,
              control2X: points[2].x, control2Y: points[2].y, x: points[3].x, y: points[3].y });
            append({ kind: "cubic", control1X: points[4].x, control1Y: points[4].y,
              control2X: points[5].x, control2Y: points[5].y, x: points[6].x, y: points[6].y });
            x = points[6].x; y = points[6].y;
            results.push(values[1], values[2]);
          } else if (other === 3) {
            if (count !== 1) fail("Invalid hint replacement OtherSubr.");
            results.push(values[0]);
          } else if (other === 12 || other === 13) {
            // Adobe 5015 counter-control data affects grid fitting, not paths.
          } else if (other >= 14 && other <= 18 && blendWeights) {
            // Adobe 5015 §3.12: all base values precede per-result blocks of
            // deltas against master zero. $Blend uses the remaining weights
            // directly; normalizing a rounded WeightVector would change it.
            const outputs = other === 18 ? 6 : other - 13;
            const masters = blendWeights.length;
            if (count !== outputs * masters) fail(`MM OtherSubr ${other} requires ${outputs * masters} arguments.`);
            for (let result = 0; result < outputs; result++) {
              let value = values[result];
              for (let master = 1; master < masters; master++) value = finite(value + blendWeights[master] * values[outputs + result * (masters - 1) + master - 1]);
              results.push(value);
            }
          } else {
            let executed: readonly number[] | null | undefined;
            if (options.executeOtherSubr) {
              graphics ??= new NativeFontPostScriptGlyphContext({ signal: options.signal, maxPathCommands: limits.maxType1PathCommands });
              graphics.replacePath(commands, commands.length ? undefined : [x, y]);
              if (!graphics.metrics) graphics.setMetrics(wx, wy);
              executed = options.executeOtherSubr(other, values, graphics);
              commands.length = 0;
              for (const command of graphics.pathCommands) append(command);
              open = graphics.pathOpen;
              if (graphics.metrics) [wx, wy] = graphics.metrics.width;
            }
            if (executed !== null && executed !== undefined) {
              for (const value of executed) results.push(finite(value));
              break;
            }
            // Adobe Type1 chapter 8 requires unknown extensions to pass their
            // arguments back to pop in source order; no PostScript is executed.
            results.push(...values);
            options.onUnknownOtherSubr?.(other);
          }
          break;
        }
        case 17: if (!results.length) fail("pop has no OtherSubr result."); else push(results.shift()!); break;
        case 33: { const values = args(2); if (flex) fail("setcurrentpoint occurs during flex."); x = finite(values[0] + originX); y = finite(values[1] + originY); break; }
        default: fail(`Escaped operator 12 ${escape} is unsupported.`);
      }
      continue;
    }
    switch (byte) {
      case 1: case 3: args(2); break; // Stem hints do not change the vector path.
      case 4: { const [dy] = args(1); move(0, dy); break; }
      case 5: { const [dx, dy] = args(2); line(dx, dy); break; }
      case 6: { const [dx] = args(1); line(dx, 0); break; }
      case 7: { const [dy] = args(1); line(0, dy); break; }
      case 8: { const v = args(6); curve(v[0], v[1], v[2], v[3], v[4], v[5]); break; }
      case 9: args(0); if (flex) fail("closepath occurs during flex."); close(); break;
      case 10: {
        const index = pop();
        if (!Number.isSafeInteger(index) || index < 0) fail("Invalid subroutine index.");
        const subrs = options.subrs;
        const subr = Array.isArray(subrs) ? subrs[index] : (subrs as ReadonlyMap<number, Uint8Array> | undefined)?.get(index);
        if (!subr) fail(`Subroutine ${index} is missing.`);
        if (activeSubrs.has(index)) fail("A subroutine cycle was encountered.");
        ceiling(++budget.subrCalls, limits.maxType1SubrCalls, "subr-calls");
        ceiling(frames.length, limits.maxType1SubrDepth, "subr-depth");
        activeSubrs.add(index); frames.push({ bytes: plain(subr!), offset: 0, subr: index }); break;
      }
      case 11:
        if (frame.subr === null) fail("return occurs outside a subroutine.");
        activeSubrs.delete(frame.subr!); frames.pop(); break;
      case 13: {
        const values = args(2);
        if (metrics || commands.length !== initialCommands.length) fail("Duplicate or late hsbw.");
        [sbx, wx] = values; x = finite(sbx + originX); y = originY; metrics = true;
        graphics?.setMetrics(wx, wy); break;
      }
      case 14: args(0); if (flex || !metrics) fail("An incomplete glyph ended."); close(); ended = true; break;
      case 21: { const [dx, dy] = args(2); move(dx, dy); break; }
      case 22: { const [dx] = args(1); move(dx, 0); break; }
      case 30: { const v = args(4); curve(0, v[0], v[1], v[2], v[3], 0); break; }
      case 31: { const v = args(4); curve(v[0], 0, v[1], v[2], 0, v[3]); break; }
      default: fail(`Operator ${byte} is unsupported.`);
    }
  }
  if (!ended || !metrics) fail("The charstring has no complete outline definition.");
  if (options.glyphContext) graphics!.replacePath(commands, [x, y]);
  const postScriptPaints = graphics?.paintRecords;
  const postScriptFinalState = graphics?.finalState;
  const totalCommands = commands.length + nativeGlyphPostScriptCommandCount(postScriptPaints ?? [], postScriptFinalState);
  ceiling(totalCommands, limits.maxType1PathCommands, "path-commands");
  return Object.freeze({ commands: Object.freeze(commands.map(command => Object.freeze(command))),
    advanceWidth: wx, leftSideBearing: sbx, advanceY: wy, sideBearingY: sby,
    ...(postScriptPaints?.length ? { postScriptPaints } : {}),
    ...(postScriptFinalState ? { postScriptFinalState } : {}),
    ...(graphics?.diagnostics.length ? { postScriptDiagnostics: graphics.diagnostics } : {}) });
}

class PsLexer {
  offset = 0;
  readonly bytes: Uint8Array;
  private readonly limits: Readonly<NativeType1ParserLimits>;
  private readonly signal?: AbortSignal;
  constructor(bytes: Uint8Array, limits: Readonly<NativeType1ParserLimits>, signal?: AbortSignal) {
    this.bytes = bytes; this.limits = limits; this.signal = signal;
  }
  next(): PsToken | null {
    const first = this.nextFlat();
    if (first?.kind !== "mark" || first.value !== "{") return first;
    const words = new Set<string>();
    let depth = 1, nonempty = false;
    const initializer = [{ kind: "number", value: 1 }, { kind: "word", value: "index" },
      { kind: "word", value: "exch" }, { kind: "name", value: ".notdef" }, { kind: "word", value: "put" }];
    let initializerMatches = true, initializerIndex = 0;
    while (depth) {
      const token = this.nextFlat();
      if (!token) throw invalid("A Type1 procedure is unterminated.", "token");
      if (!(token.kind === "mark" && token.value === "}" && depth === 1)) {
        nonempty = true;
        const expected = initializer[initializerIndex++];
        if (!expected || token.kind !== expected.kind || token.value !== expected.value) initializerMatches = false;
      }
      if (token.kind === "mark" && token.value === "{") depth++;
      else if (token.kind === "mark" && token.value === "}") depth--;
      else if (token.kind === "word") words.add(token.value);
      else if (token.kind === "name") words.add(`/${token.value}`);
    }
    return { kind: "procedure", value: words, nonempty, encodingInitializer: initializerMatches && initializerIndex === initializer.length };
  }
  private nextFlat(): PsToken | null {
    throwIfAborted(this.signal);
    while (this.offset < this.bytes.length) {
      const byte = this.bytes[this.offset];
      if (isWhite(byte)) { this.offset++; continue; }
      if (byte === 37) { while (this.offset < this.bytes.length && ![10, 13].includes(this.bytes[this.offset])) this.offset++; continue; }
      break;
    }
    if (this.offset >= this.bytes.length) return null;
    const byte = this.bytes[this.offset++];
    if (byte === 40) {
      const values: number[] = [];
      let depth = 1;
      while (this.offset < this.bytes.length && depth) {
        const b = this.bytes[this.offset++];
        if (b === 92) {
          if (this.offset === this.bytes.length) break;
          const escaped = this.bytes[this.offset++];
          if (escaped === 10) continue;
          if (escaped === 13) { if (this.bytes[this.offset] === 10) this.offset++; continue; }
          if (escaped >= 48 && escaped <= 55) {
            let octal = escaped - 48;
            for (let count = 1; count < 3 && this.bytes[this.offset] >= 48 && this.bytes[this.offset] <= 55; count++) octal = octal * 8 + this.bytes[this.offset++] - 48;
            values.push(octal & 255);
          } else values.push(({ 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 } as Readonly<Record<number, number>>)[escaped] ?? escaped);
        } else if (b === 40) { depth++; values.push(b); }
        else if (b === 41) { if (--depth) values.push(b); }
        else if (b === 13) { values.push(10); if (this.bytes[this.offset] === 10) this.offset++; }
        else values.push(b);
        ceiling(values.length, this.limits.maxType1StringBytes, "string-bytes");
      }
      if (depth) throw invalid("A Type1 string is unterminated.", "token");
      return { kind: "bytes", value: Uint8Array.from(values) };
    }
    if (byte === 60 && this.bytes[this.offset] === 126) {
      this.offset++;
      const source = createNativeFontPostScriptMemoryFile(this.bytes.subarray(this.offset), { signal: this.signal });
      const decoded = createNativeFontPostScriptFilter(source, "ASCII85Decode", {}, {
        signal: this.signal, maxDecodedBytes: this.limits.maxType1StringBytes
      });
      const values: number[] = [];
      for (let value = decoded.readByte(); value >= 0; value = decoded.readByte()) values.push(value);
      const length = source.tell();
      if (length < 2 || this.bytes[this.offset + length - 2] !== 126 || this.bytes[this.offset + length - 1] !== 62) {
        throw invalid("A Type1 ASCII85 string is unterminated.", "token");
      }
      this.offset += length;
      return { kind: "bytes", value: Uint8Array.from(values) };
    }
    if (byte === 60 && this.bytes[this.offset] !== 60) {
      const values: number[] = []; let high = -1;
      while (this.offset < this.bytes.length && this.bytes[this.offset] !== 62) {
        const b = this.bytes[this.offset++]; if (isWhite(b)) continue;
        const value = hexValue(b); if (value < 0) throw invalid("A Type1 hexadecimal string is invalid.", "token");
        if (high < 0) high = value; else { values.push(high * 16 + value); high = -1; }
        ceiling(values.length, this.limits.maxType1StringBytes, "string-bytes");
      }
      if (this.bytes[this.offset++] !== 62) throw invalid("A Type1 hexadecimal string is unterminated.", "token");
      if (high >= 0) values.push(high * 16);
      return { kind: "bytes", value: Uint8Array.from(values) };
    }
    if ([91, 93, 123, 125, 60, 62].includes(byte)) return { kind: "mark", value: String.fromCharCode(byte) };
    const literal = byte === 47;
    const immediate = literal && this.bytes[this.offset] === 47;
    if (immediate) this.offset++;
    const start = literal ? this.offset : this.offset - 1;
    while (this.offset < this.bytes.length && !isWhite(this.bytes[this.offset]) && !isDelimiter(this.bytes[this.offset])) this.offset++;
    let value = "";
    for (let i = start; i < this.offset; i++) value += String.fromCharCode(this.bytes[i]);
    if (immediate) return { kind: "word", value: `//${value}` };
    if (!value && !literal) throw invalid("An empty Type1 token was encountered.", "token");
    if (literal) return { kind: "name", value };
    const number = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?$/.test(value) ? Number(value) : NaN;
    return Number.isFinite(number) ? { kind: "number", value: number } : { kind: "word", value };
  }
  binary(length: number): Uint8Array {
    if (!isWhite(this.bytes[this.offset])) throw invalid("A Type1 RD token has no binary separator.", "binary-string");
    const separator = this.bytes[this.offset++];
    if (separator === 13 && this.bytes[this.offset] === 10) this.offset++;
    if (length > this.bytes.length - this.offset) throw invalid("A Type1 binary string is truncated.", "binary-string");
    ceiling(length, this.limits.maxType1StringBytes, "string-bytes");
    const value = this.bytes.subarray(this.offset, this.offset + length); this.offset += length; return value;
  }
}

function scanProgram(bytes: Uint8Array, limits: Readonly<NativeType1ParserLimits>, signal?: AbortSignal, stopEexec = false): { tokens: PsToken[]; eexecEnd: number | null } {
  const lexer = new PsLexer(bytes, limits, signal), tokens: PsToken[] = [];
  const binaryAliases = new Set(["RD", "-|"]);
  let token: PsToken | null;
  while ((token = lexer.next()) !== null) {
    const previous = tokens[tokens.length - 1];
    if (token.kind === "word" && token.value === "eexec" && stopEexec) return { tokens, eexecEnd: lexer.offset };
    if (token.kind === "word" && token.value === "closefile") break;
    if (token.kind === "procedure" && token.value.has("readstring") && previous?.kind === "name") binaryAliases.add(previous.value);
    if (token.kind === "word" && binaryAliases.has(token.value) && previous?.kind === "number") {
      const length = nonnegativeInteger(previous, "binary string length");
      tokens.push({ kind: "bytes", value: lexer.binary(length) });
    } else tokens.push(token);
  }
  return { tokens, eexecEnd: null };
}

function readNumberRecord(tokens: readonly PsToken[], name: string): number | undefined {
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].kind !== "name" || tokens[i].value !== name) continue;
    const next = tokens[i + 2];
    if (tokens[i + 1].kind !== "number" || next?.kind !== "word" || !["def", "ND", "|-", "readonly", "noaccess"].includes(next.value)) {
      throw invalid(`Type1 /${name} requires a computed PostScript value.`, "number-expression");
    }
    return tokens[i + 1].value as number;
  }
  return undefined;
}

type Type1Literal = number | string | Type1Literal[];

/** The selected default design is explicit; axis metadata never overrides it. */
function readBlendMetadata(tokens: readonly PsToken[], signal?: AbortSignal): readonly number[] | null {
  const keys = ["WeightVector", "BlendAxisTypes", "BlendDesignPositions", "BlendDesignMap"];
  const records = new Map<string, Type1Literal[]>();
  for (let i = 0; i < tokens.length; i++) {
    throwIfAborted(signal);
    const token = tokens[i];
    if (token.kind !== "name" || !keys.includes(token.value)) continue;
    if (tokens[i + 1]?.kind !== "mark" || tokens[i + 1].value !== "[") {
      throw invalid(`Type1 /${token.value} requires a computed PostScript array.`, "multiple-master-expression");
    }
    const { values, end } = readLiteralArray(tokens, i + 1, signal);
    if (!endsLiteralRecord(tokens[end + 1])) throw invalid(`Type1 /${token.value} requires a computed PostScript array.`, "multiple-master-expression");
    records.set(token.value, values);
    i = end;
  }
  return validateBlendMetadata(records);
}

function validateBlendMetadata(records: ReadonlyMap<string, Type1Literal[]>): readonly number[] | null {
  if (!records.size) return null;
  const weightRecord = records.get("WeightVector");
  if (!weightRecord) throw invalid("A Type1 Multiple Master font has no default WeightVector.", "multiple-master-weights");
  const weights = validateBlendWeights(weightRecord);
  const axes = records.get("BlendAxisTypes");
  if (axes && (axes.length < 1 || axes.length > 4 || axes.some(axis => typeof axis !== "string"))) {
    throw invalid("The Type1 BlendAxisTypes array is invalid.", "multiple-master-axes");
  }
  const positions = records.get("BlendDesignPositions");
  let axisCount = axes?.length;
  if (positions) {
    if (positions.length !== weights.length) throw invalid("Type1 master positions disagree with WeightVector.", "multiple-master-positions");
    for (const position of positions) {
      if (!Array.isArray(position)) throw invalid("A Type1 master position is not an array.", "multiple-master-positions");
      axisCount ??= position.length;
      if (axisCount < 1 || axisCount > 4 || position.length !== axisCount ||
        position.some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)) {
        throw invalid("A Type1 master position is invalid.", "multiple-master-positions");
      }
    }
  }
  const maps = records.get("BlendDesignMap");
  if (maps) {
    axisCount ??= maps.length;
    if (axisCount < 1 || axisCount > 4 || maps.length !== axisCount) throw invalid("The Type1 BlendDesignMap axis count is invalid.", "multiple-master-map");
    for (const map of maps) {
      if (!Array.isArray(map) || map.length < 2 || map.length > 12) throw invalid("A Type1 design map is invalid.", "multiple-master-map");
      let previousDesign = -Infinity, previousBlend = -Infinity;
      for (let point = 0; point < map.length; point++) {
        const pair = map[point];
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "number" || typeof pair[1] !== "number" ||
          !Number.isFinite(pair[0]) || !Number.isFinite(pair[1]) || pair[0] <= previousDesign || pair[1] < previousBlend ||
          pair[1] < 0 || pair[1] > 1 || (point === 0 && pair[1] !== 0) || (point === map.length - 1 && pair[1] !== 1)) {
          throw invalid("A Type1 design-map point is invalid.", "multiple-master-map");
        }
        previousDesign = pair[0]; previousBlend = pair[1];
      }
    }
  }
  return weights;
}

function computedLiteralArray(source: NativeFontPostScriptValue[], signal?: AbortSignal): Type1Literal[] {
  const values: Type1Literal[] = [];
  const active = new Set<NativeFontPostScriptValue[]>();
  const pending: { source: NativeFontPostScriptValue[]; values: Type1Literal[]; exit?: boolean }[] = [{ source, values }];
  while (pending.length) {
    throwIfAborted(signal);
    const entry = pending.pop()!;
    if (entry.exit) { active.delete(entry.source); continue; }
    if (active.has(entry.source)) throw invalid("A computed Type1 Multiple Master array is cyclic.", "multiple-master-expression");
    active.add(entry.source); pending.push({ ...entry, exit: true });
    for (const value of entry.source) {
      if (typeof value === "number") entry.values.push(value);
      else if (Array.isArray(value)) {
        const child: Type1Literal[] = [];
        entry.values.push(child); pending.push({ source: value, values: child });
      } else if (value && typeof value === "object" && "kind" in value && value.kind === "name") entry.values.push(value.value);
      else throw invalid("A computed Type1 Multiple Master array has an invalid entry.", "multiple-master-expression");
    }
  }
  return values;
}

function endsLiteralRecord(token: PsToken | undefined): boolean {
  return token?.kind === "word" && ["def", "ND", "|-", "readonly", "noaccess", "put"].includes(token.value);
}

function hasComputedFontRecords(tokens: readonly PsToken[]): boolean {
  const records = new Set(["FontMatrix", "FontType", "PaintType", "StrokeWidth", "Encoding", "CharStrings", "Subrs", "lenIV",
    "WeightVector", "BlendAxisTypes", "BlendDesignPositions", "BlendDesignMap"]);
  const procedures = new Set<string>();
  const definitions = new Set<string>();
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i], previous = tokens[i - 1];
    if (token.kind === "word" && records.has(token.value)) return true;
    if (token.kind === "name" && records.has(token.value)) {
      if (definitions.has(token.value) || (tokens[i + 1]?.kind === "word" && ["get", "known", "put", "undef"].includes(tokens[i + 1].value as string))) return true;
      definitions.add(token.value);
    }
    if (token.kind === "procedure" && previous.kind === "name") {
      // RD, ND and NP are declaration helpers. Other font-local procedures
      // called while loading can compute any of the records we depend on.
      const declaration = [...token.value].every(word => ["string", "currentfile", "exch", "readstring", "pop", "noaccess", "readonly", "def", "put"].includes(word));
      if (!declaration || (!token.value.size && token.nonempty)) procedures.add(previous.value);
    }
  }
  return tokens.some(token => token.kind === "word" && procedures.has(token.value));
}

/** Loading code can mutate records without naming them, for example forall
 * over currentdict. Procedures stored as metadata remain inert here. */
function hasOpaqueLoadingCode(tokens: readonly PsToken[]): boolean {
  const declarativeWords = new Set(["dict", "array", "string", "begin", "end", "dup", "exch", "index", "pop",
    "get", "put", "def", "readonly", "noaccess", "executeonly", "bind", "currentdict", "currentfile", "definefont", "mark",
    "FontName", "true", "false", "null", "StandardEncoding", "ExpertEncoding", "ND", "NP", "|-", "|", "-|"]);
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind === "procedure" && tokens[i - 1].kind === "name" &&
      [...token.value].every(word => ["string", "currentfile", "exch", "readstring", "pop", "noaccess", "readonly", "def", "put"].includes(word))) {
      declarativeWords.add(tokens[i - 1].value as string);
    }
  }
  let arrayDepth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind === "mark") {
      if (token.value === "[" || token.value === "<") arrayDepth++;
      else if (token.value === "]" || token.value === ">") arrayDepth--;
    }
    if (token.kind !== "word" || arrayDepth > 0 || declarativeWords.has(token.value)) continue;
    // The standard Encoding initializer is the one procedure executed by the
    // declarative reader; any other control flow belongs to the interpreter.
    const initializer = tokens[i - 1];
    if (token.value === "for" && tokens[i - 4]?.kind === "number" && tokens[i - 4].value === 0 &&
      tokens[i - 3]?.kind === "number" && tokens[i - 3].value === 1 &&
      tokens[i - 2]?.kind === "number" && tokens[i - 2].value === 255 &&
      initializer?.kind === "procedure" && initializer.encodingInitializer) continue;
    return true;
  }
  return false;
}

function hasCustomOtherSubrs(tokens: readonly PsToken[], multipleMaster: boolean): boolean {
  const index = tokens.findIndex(token => token.kind === "name" && token.value === "OtherSubrs");
  if (index < 0) return false;
  const builtin = (other: number) => other <= 3 || other === 12 || other === 13 || (multipleMaster && other >= 14 && other <= 18);
  if (tokens[index + 1]?.kind === "mark" && tokens[index + 1].value === "[") {
    let other = 0;
    for (let i = index + 2; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.kind === "mark" && token.value === "]") return false;
      if (token.kind !== "procedure") return true;
      if (!builtin(other++) && token.nonempty) return true;
    }
    return true;
  }
  if (tokens[index + 1]?.kind === "number" && tokens[index + 2]?.value === "array") {
    for (let i = index + 3; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.kind === "word" && ["def", "ND", "|-"].includes(token.value)) return false;
      if (token.kind === "procedure") {
        const other = tokens[i - 1];
        if (other?.kind !== "number" || (!builtin(other.value) && token.nonempty)) return true;
      }
    }
  }
  return true;
}

function validateBlendWeights(values: readonly unknown[]): readonly number[] {
  // Adobe 5015 permits 2–16 master designs and a .001 sum tolerance. The
  // stored weights are used directly, including rounding and extrapolation.
  if (values.length < 2 || values.length > 16 || values.some(value => typeof value !== "number" || !Number.isFinite(value))) {
    throw invalid("The Type1 WeightVector must contain 2–16 finite weights.", "multiple-master-weights");
  }
  const weights = values as readonly number[];
  const sum = weights.reduce((total, value) => total + value, 0);
  if (!Number.isFinite(sum) || Math.abs(sum - 1) > 0.001) throw invalid("The Type1 WeightVector does not sum to one.", "multiple-master-weights");
  return Object.freeze([...weights]);
}

function readLiteralArray(tokens: readonly PsToken[], start: number, signal?: AbortSignal): { values: Type1Literal[]; end: number } {
  const values: Type1Literal[] = [], stack = [values];
  for (let i = start + 1; i < tokens.length; i++) {
    throwIfAborted(signal);
    const token = tokens[i];
    if (token.kind === "mark" && token.value === "[") {
      const child: Type1Literal[] = [];
      stack[stack.length - 1].push(child); stack.push(child);
    } else if (token.kind === "mark" && token.value === "]") {
      stack.pop(); if (!stack.length) return { values, end: i };
    } else if (token.kind === "number" || token.kind === "name") stack[stack.length - 1].push(token.value);
    else throw invalid("A Type1 Multiple Master array requires a PostScript expression.", "multiple-master-expression");
  }
  throw invalid("A Type1 Multiple Master array is unterminated.", "multiple-master-expression");
}

function readMatrix(tokens: readonly PsToken[]): Type1Matrix {
  const index = tokens.findIndex(token => token.kind === "name" && token.value === "FontMatrix");
  if (index < 0) return [0.001, 0, 0, 0.001, 0, 0];
  if (tokens[index + 1]?.value !== "[" || tokens[index + 8]?.value !== "]") throw invalid("The Type1 FontMatrix is malformed.", "font-matrix");
  if (!endsLiteralRecord(tokens[index + 9])) throw invalid("The Type1 FontMatrix requires a PostScript expression.", "font-matrix");
  const values = tokens.slice(index + 2, index + 8).map(token => token.kind === "number" ? token.value : NaN);
  if (values.some(value => !Number.isFinite(value)) || values[0] * values[3] === values[1] * values[2]) throw invalid("The Type1 FontMatrix is invalid or singular.", "font-matrix");
  return values as unknown as Type1Matrix;
}

function readEncoding(tokens: readonly PsToken[]): readonly (string | null)[] {
  const names: (string | null)[] = Array.from({ length: 256 }, (_, code) => standardEncodingName(code));
  const index = tokens.findIndex(token => token.kind === "name" && token.value === "Encoding");
  if (index < 0) return names;
  const first = tokens[index + 1];
  let cursor = index + 2;
  if (first?.kind === "word" && first.value === "ExpertEncoding") names.splice(0, 256, ...CFF_EXPERT_ENCODING);
  else if (!(first?.kind === "word" && first.value === "StandardEncoding")) {
    if (first?.kind !== "number" && !(first?.kind === "mark" && first.value === "[")) {
      throw invalid("The Type1 Encoding requires an unsupported PostScript expression.", "encoding-expression");
    }
    if (first.kind === "number" && (first.value !== 256 || tokens[index + 2]?.kind !== "word" || tokens[index + 2].value !== "array")) {
      throw invalid("The Type1 Encoding array declaration is invalid.", "encoding");
    }
    names.fill(null);
    if (first.kind === "number") cursor++;
  }
  if (first?.kind === "word" && !endsLiteralRecord(tokens[cursor])) throw invalid("The Type1 Encoding copy requires PostScript evaluation.", "encoding-expression");
  if (first?.kind === "mark" && first.value === "[") {
    let code = 0;
    while (cursor < tokens.length && tokens[cursor].value !== "]") {
      if (tokens[cursor].kind !== "name" || code >= 256) throw invalid("A Type1 Encoding array is invalid.", "encoding");
      names[code++] = tokens[cursor++].value as string;
    }
    if (tokens[cursor]?.value !== "]") throw invalid("A Type1 Encoding array is unterminated.", "encoding");
    cursor++;
  }
  for (let i = cursor; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind === "word" && ["def", "ND", "|-"].includes(token.value)) return names.map(name => name === ".notdef" ? null : name);
    if (token.kind === "word" && ["readonly", "noaccess"].includes(token.value)) continue;
    if (token.kind === "number" && token.value === 0 && tokens[i + 1]?.value === 1 && tokens[i + 2]?.value === 255) {
      const procedure = tokens[i + 3];
      if (procedure?.kind !== "procedure" || !procedure.encodingInitializer || tokens[i + 4]?.value !== "for") {
        throw invalid("The Type1 Encoding initializer requires an unsupported PostScript expression.", "encoding-expression");
      }
      names.fill(null);
      i += 4;
      continue;
    }
    if (token.kind === "word" && token.value === "dup" && tokens[i + 1]?.kind === "number" && tokens[i + 2]?.kind === "name") {
      const code = nonnegativeInteger(tokens[i + 1], "Encoding code");
      if (code > 255) throw invalid("A Type1 Encoding code is outside its byte vector.", "encoding");
      if (tokens[i + 3]?.kind !== "word" || tokens[i + 3].value !== "put") throw invalid("A Type1 Encoding assignment is malformed.", "encoding");
      names[code] = tokens[i + 2].value as string;
      i += 3;
      continue;
    }
    throw invalid("The Type1 Encoding assignment requires PostScript evaluation.", "encoding-expression");
  }
  throw invalid("The Type1 Encoding definition is unterminated.", "encoding");
}

function unpackPfb(bytes: Uint8Array, framing: NativeType1Framing): { bytes: Uint8Array; length1?: number; length2?: number } {
  if (bytes[0] !== 128) return { bytes, length1: framing.length1, length2: framing.length2 };
  const parts: Uint8Array[] = []; let offset = 0, total = 0, length1 = 0, length2 = 0, binary = false, trailer = false, eof = false;
  while (offset < bytes.length) {
    throwIfAborted(framing.signal);
    if (bytes[offset++] !== 128 || offset >= bytes.length) throw invalid("The PFB segment marker is invalid.", "pfb-framing");
    const kind = bytes[offset++];
    if (kind === 3) { eof = true; break; }
    if ((kind !== 1 && kind !== 2) || offset + 4 > bytes.length) throw invalid("The PFB segment header is invalid.", "pfb-framing");
    const length = (bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536 + bytes[offset + 3] * 16777216); offset += 4;
    if (length > bytes.length - offset) throw invalid("The PFB segment is truncated.", "pfb-framing");
    if (kind === 2) {
      if (trailer) throw invalid("A PFB binary segment follows its trailer.", "pfb-framing");
      binary = true; length2 += length;
    } else if (!binary) length1 += length;
    else trailer = true;
    parts.push(bytes.subarray(offset, offset + length)); total += length; offset += length;
  }
  if (!eof) throw invalid("The PFB end marker is missing.", "pfb-framing");
  const joined = new Uint8Array(total); let at = 0;
  for (const part of parts) { joined.set(part, at); at += part.length; }
  return { bytes: joined, length1: binary ? length1 : undefined, length2: binary ? length2 : undefined };
}

function decrypt(bytes: Uint8Array, key: number, discard: number, signal?: AbortSignal): Uint8Array {
  if (discard > bytes.length) throw invalid("An encrypted Type1 string is shorter than its prefix.", "encryption");
  const result = new Uint8Array(bytes.length - discard);
  for (let i = 0; i < bytes.length; i++) {
    if ((i & 4095) === 0) throwIfAborted(signal);
    const cipher = bytes[i], plain = cipher ^ (key >> 8);
    key = ((cipher + key) * 52845 + 22719) & 65535;
    if (i >= discard) result[i - discard] = plain;
  }
  return result;
}

function decodeEexecHex(bytes: Uint8Array, signal?: AbortSignal): Uint8Array {
  const result = new Uint8Array(Math.ceil(bytes.length / 2)); let count = 0, high = -1;
  for (let i = 0; i < bytes.length; i++) {
    if ((i & 4095) === 0) throwIfAborted(signal);
    if (isWhite(bytes[i])) continue;
    const value = hexValue(bytes[i]);
    if (value < 0) break; // The unencrypted cleartomark trailer is not ciphertext.
    if (high < 0) high = value; else { result[count++] = high * 16 + value; high = -1; }
  }
  return result.subarray(0, count);
}

function standardEncodingName(code: number): string | null {
  if (!Number.isSafeInteger(code) || code < 0 || code > 255) return null;
  if (code >= 32 && code <= 126) return STANDARD_ASCII[code - 32];
  return STANDARD_HIGH[code] ?? null;
}
const STANDARD_ASCII = ("space exclam quotedbl numbersign dollar percent ampersand quoteright parenleft parenright asterisk plus comma hyphen period slash " +
  "zero one two three four five six seven eight nine colon semicolon less equal greater question at " +
  "A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore quoteleft " +
  "a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde").split(" ");
const STANDARD_HIGH: Readonly<Record<number, string>> = Object.freeze({
  161: "exclamdown", 162: "cent", 163: "sterling", 164: "fraction", 165: "yen", 166: "florin", 167: "section", 168: "currency", 169: "quotesingle",
  170: "quotedblleft", 171: "guillemotleft", 172: "guilsinglleft", 173: "guilsinglright", 174: "fi", 175: "fl", 177: "endash", 178: "dagger",
  179: "daggerdbl", 180: "periodcentered", 182: "paragraph", 183: "bullet", 184: "quotesinglbase", 185: "quotedblbase", 186: "quotedblright",
  187: "guillemotright", 188: "ellipsis", 189: "perthousand", 191: "questiondown", 193: "grave", 194: "acute", 195: "circumflex", 196: "tilde", 197: "macron",
  198: "breve", 199: "dotaccent", 200: "dieresis", 202: "ring", 203: "cedilla", 205: "hungarumlaut", 206: "ogonek", 207: "caron", 208: "emdash", 225: "AE",
  227: "ordfeminine", 232: "Lslash", 233: "Oslash", 234: "OE", 235: "ordmasculine", 241: "ae", 245: "dotlessi", 248: "lslash", 249: "oslash", 250: "oe", 251: "germandbls"
});

function transformPoint(x: number, y: number, m: Type1Matrix): [number, number] {
  return [finite(m[0] * 1000 * x + m[2] * 1000 * y + m[4] * 1000), finite(m[1] * 1000 * x + m[3] * 1000 * y + m[5] * 1000)];
}
function transformCommand(command: NativeGlyphPathCommand, matrix: Type1Matrix): NativeGlyphPathCommand {
  if (command.kind === "close") return command;
  const [x, y] = transformPoint(command.x, command.y, matrix);
  if (command.kind === "move" || command.kind === "line") return { kind: command.kind, x, y };
  if (command.kind === "quadratic") {
    const [controlX, controlY] = transformPoint(command.controlX, command.controlY, matrix);
    return { kind: "quadratic", controlX, controlY, x, y };
  }
  const [control1X, control1Y] = transformPoint(command.control1X, command.control1Y, matrix);
  const [control2X, control2Y] = transformPoint(command.control2X, command.control2Y, matrix);
  return { kind: "cubic", control1X, control1Y, control2X, control2Y, x, y };
}
function translateCommand(command: NativeGlyphPathCommand, x: number, y: number): NativeGlyphPathCommand {
  return transformCommand(command, [0.001, 0, 0, 0.001, x / 1000, y / 1000]);
}
function measureBounds(commands: readonly NativeGlyphPathCommand[]): readonly [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, x = 0, y = 0;
  const add = (px: number, py: number) => { minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py); };
  for (const command of commands) {
    if (command.kind === "close") continue;
    if (command.kind === "cubic") {
      const roots = [...cubicExtrema(x, command.control1X, command.control2X, command.x), ...cubicExtrema(y, command.control1Y, command.control2Y, command.y)];
      for (const t of roots) if (t > 0 && t < 1) {
        const s = 1 - t;
        add(s * s * s * x + 3 * s * s * t * command.control1X + 3 * s * t * t * command.control2X + t * t * t * command.x,
          s * s * s * y + 3 * s * s * t * command.control1Y + 3 * s * t * t * command.control2Y + t * t * t * command.y);
      }
    } else if (command.kind === "quadratic") {
      for (const t of [quadraticExtremum(x, command.controlX, command.x), quadraticExtremum(y, command.controlY, command.y)]) if (t > 0 && t < 1) {
        const s = 1 - t; add(s * s * x + 2 * s * t * command.controlX + t * t * command.x, s * s * y + 2 * s * t * command.controlY + t * t * command.y);
      }
    }
    x = command.x; y = command.y; add(x, y);
  }
  return Object.freeze(minX === Infinity ? [0, 0, 0, 0] : [finite(minX), finite(minY), finite(maxX), finite(maxY)]);
}
function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  // Normalize before differencing: finite outlines can have controls whose
  // unscaled derivative coefficients overflow even though the curve does not.
  const scale = Math.max(Math.abs(p0), Math.abs(p1), Math.abs(p2), Math.abs(p3), 1);
  p0 /= scale; p1 /= scale; p2 /= scale; p3 /= scale;
  const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
  if (a === 0) return b === 0 ? [] : [-c / b];
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  // Avoid subtracting nearly equal values when a nominally quadratic curve
  // acquires a tiny cubic coefficient through FontMatrix rounding.
  const root = Math.sqrt(discriminant);
  const q = -0.5 * (b + (b < 0 ? -root : root));
  return q === 0 ? [0] : [q / a, c / q];
}
function quadraticExtremum(p0: number, p1: number, p2: number): number {
  const scale = Math.max(Math.abs(p0), Math.abs(p1), Math.abs(p2), 1);
  p0 /= scale; p1 /= scale; p2 /= scale;
  return (p0 - p1) / (p0 - 2 * p1 + p2);
}
function mergeType1Limits(overrides: Partial<NativeType1ParserLimits>): Readonly<NativeType1ParserLimits> {
  const limits = { ...DEFAULT_NATIVE_TYPE1_PARSER_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`Type1 resource limit ${name} must be a positive safe integer.`);
  return Object.freeze(limits);
}
function nonnegativeInteger(token: PsToken | undefined, label: string): number {
  if (token?.kind !== "number" || !Number.isSafeInteger(token.value) || token.value < 0) throw invalid(`The Type1 ${label} is invalid.`, "integer");
  return token.value;
}
function ceiling(value: number, limit: number, reason: string): void {
  if (value > limit) throw new PdfError("resource-limit", `Type1 ${reason} exceeds the configured limit.`, { details: { reason: `type1-${reason}-limit`, limit } });
}
function finite(value: number): number { if (!Number.isFinite(value)) throw invalid("Type1 arithmetic is not finite.", "numeric-overflow"); return value; }
function invalid(message: string, reason: string): PdfError { return new PdfError("unsupported-font", message, { details: { reason: `type1-${reason}` } }); }
function isUnsupported(error: unknown): error is PdfError { return error instanceof PdfError && error.code === "unsupported-font"; }
function type1PostScriptFailureDetails(error: PdfError): Readonly<Record<string, string | number | boolean | null>> {
  return Object.freeze({ postScriptReason: error.details?.reason ?? "font-postscript-unsupported", fontProgramMessage: error.message,
    ...(error.details?.operator !== undefined ? { operator: error.details.operator } : {}) });
}
function isWhite(byte: number): boolean { return byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32; }
function isDelimiter(byte: number): boolean { return byte === 40 || byte === 41 || byte === 60 || byte === 62 || byte === 91 || byte === 93 || byte === 123 || byte === 125 || byte === 47 || byte === 37; }
function hexValue(byte: number): number { return byte >= 48 && byte <= 57 ? byte - 48 : byte >= 65 && byte <= 70 ? byte - 55 : byte >= 97 && byte <= 102 ? byte - 87 : -1; }
