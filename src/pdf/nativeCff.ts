import type {
  NativeGlyphOutline,
  NativeGlyphPathCommand,
  NativeGlyphPostScriptPaint,
  NativeGlyphPostScriptFinalState
} from "./nativeFont";
import { PdfError, throwIfAborted } from "./nativeTypes";
import type { PdfDiagnostic } from "./nativeTypes";
import {
  CFF_EXPERT_CHARSET,
  CFF_EXPERT_ENCODING,
  CFF_EXPERT_SUBSET_CHARSET
} from "./nativeCffExpertData";
import { evaluateNativeType1CharString, evaluateNativeType1CompositeGlyph } from "./nativeType1";
import type { NativeType1ParserLimits } from "./nativeType1";
import { paintNativeGlyphCommands } from "./nativeGlyphPaint";
import { executeNativeFontPostScript } from "./nativeFontPostScript";
import type { NativeFontPostScriptResult, NativeFontPostScriptValue } from "./nativeFontPostScript";
import { nativeGlyphPostScriptCommandCount, nativeGlyphPostScriptPaintBounds,
  transformNativeGlyphPostScriptPaints, transformNativeGlyphPostScriptFinalState } from "./nativeFontPostScriptGraphics";
import { blendCffOperands, NativeCffVariationStore } from "./nativeCffVariation";
import type { NativeCffVariationOptions } from "./nativeCffVariation";
export type { NativeCffVariationOptions } from "./nativeCffVariation";

export interface NativeCffInstanceOptions extends NativeCffVariationOptions {
  /** Legacy CFF Multiple Master coordinates in the font's user design space. */
  readonly legacyDesignVector?: readonly number[];
  /** Optional explicit legacy master weights, bypassing NDV/CDV conversion. */
  readonly legacyWeightVector?: readonly number[];
}

/** Optional caller ceilings for the CFF and Type 2 interpreters. */
export interface NativeCffParserLimits {
  readonly maxCffBytes: number;
  readonly maxCffIndexEntries: number;
  readonly maxCffStringBytes: number;
  readonly maxType2CharStringBytes: number;
  readonly maxType2Operators: number;
  readonly maxType2SubrDepth: number;
  readonly maxType2SubrCalls: number;
  readonly maxType2PathCommands: number;
  readonly maxCffPostScriptOperations: number;
  readonly maxCffPostScriptStack: number;
}

export const DEFAULT_NATIVE_CFF_PARSER_LIMITS: Readonly<NativeCffParserLimits> = Object.freeze({
  maxCffBytes: Number.MAX_SAFE_INTEGER,
  maxCffIndexEntries: Number.MAX_SAFE_INTEGER,
  maxCffStringBytes: Number.MAX_SAFE_INTEGER,
  maxType2CharStringBytes: Number.MAX_SAFE_INTEGER,
  maxType2Operators: Number.MAX_SAFE_INTEGER,
  maxType2SubrDepth: Number.MAX_SAFE_INTEGER,
  maxType2SubrCalls: Number.MAX_SAFE_INTEGER,
  maxType2PathCommands: Number.MAX_SAFE_INTEGER,
  maxCffPostScriptOperations: Number.MAX_SAFE_INTEGER,
  maxCffPostScriptStack: Number.MAX_SAFE_INTEGER
});

interface CffIndex {
  readonly objects: readonly Uint8Array[];
  readonly end: number;
}

type CffMatrix = readonly [number, number, number, number, number, number];

interface CffFontDictionary {
  readonly localSubrs: readonly Uint8Array[];
  readonly defaultWidthX: number;
  readonly nominalWidthX: number;
  readonly initialRandomSeed: number;
  readonly fontMatrix: CffMatrix;
  readonly vsindex?: number;
  readonly paintType?: number;
  readonly strokeWidth?: number;
}

interface RawGlyphOutline {
  readonly commands: readonly NativeGlyphPathCommand[];
  readonly advanceWidth: number;
  readonly advanceY?: number;
  readonly postScriptPaints?: readonly NativeGlyphPostScriptPaint[];
  readonly postScriptFinalState?: NativeGlyphPostScriptFinalState;
  readonly postScriptPaintSequence?: readonly CffPostScriptPaintSequenceItem[];
}

type CffPostScriptPaintSequenceItem = NativeGlyphPostScriptPaint | {
  readonly kind: "implicit";
  readonly commands: readonly NativeGlyphPathCommand[];
  readonly finalState?: NativeGlyphPostScriptFinalState;
};

interface Type2Budget {
  executedBytes: number;
  operators: number;
  subrCalls: number;
  readonly signal?: AbortSignal;
}

interface Type2Seac {
  readonly accentX: number;
  readonly accentY: number;
  readonly baseCode: number;
  readonly accentCode: number;
}

interface CffLegacyMasterState {
  readonly masterCount: number;
  readonly axisCount: number;
  readonly registers: readonly number[][];
  readonly buildCharLength: number;
  readonly buildChar: Map<number, number>;
}

interface CffLegacyContext {
  readonly strings: readonly string[];
  readonly globalSubrs: readonly Uint8Array[];
  readonly limits: Readonly<NativeCffParserLimits>;
  readonly budget: Type2Budget;
  readonly options: NativeCffInstanceOptions;
  state?: CffLegacyMasterState;
}

/**
 * Bounds-checked CFF1 and CFF2 outline provider. CFF2 uses the default
 * variation instance unless already normalized coordinates are supplied.
 */
export class NativeCffFont {
  readonly unitsPerEm = 1000;
  readonly formatVersion: 1 | 2;
  readonly numGlyphs: number;
  readonly glyphNames: readonly string[];
  readonly builtInGlyphNames: readonly (string | null)[];

  private readonly charStrings: readonly Uint8Array[];
  private readonly charStringType: number;
  private readonly globalSubrs: readonly Uint8Array[];
  private readonly fontDictionaries: readonly CffFontDictionary[];
  private readonly fdSelect: Uint16Array;
  private readonly cff2: boolean;
  private readonly variationStore: NativeCffVariationStore | null;
  private readonly otherSubrExecutorFactory?: NativeFontPostScriptResult["createOtherSubrExecutor"];
  private readonly legacyMasterState?: CffLegacyMasterState;
  private readonly glyphIdsByCid: ReadonlyMap<number, number> | null;
  private readonly limits: Readonly<NativeCffParserLimits>;
  private readonly glyphIdsByName: ReadonlyMap<string, number>;
  private readonly rawOutlineCache = new Map<number, RawGlyphOutline>();
  private readonly outlineCache = new Map<number, NativeGlyphOutline>();
  private readonly pdfOutlineCache = new Map<number, NativeGlyphOutline>();
  private diagnosticData: readonly PdfDiagnostic[];
  private readonly unknownType1OtherSubrs = new Set<number>();

  get usesPostScript(): boolean {
    return this.otherSubrExecutorFactory !== undefined || this.diagnosticData.some(diagnostic => diagnostic.code.includes("postscript"));
  }

  private constructor(options: {
    readonly charStrings: readonly Uint8Array[];
    readonly charStringType: number;
    readonly globalSubrs: readonly Uint8Array[];
    readonly glyphNames: readonly string[];
    readonly builtInGlyphNames: readonly (string | null)[];
    readonly fontDictionaries: readonly CffFontDictionary[];
    readonly fdSelect: Uint16Array;
    readonly cff2?: boolean;
    readonly variationStore?: NativeCffVariationStore | null;
    readonly otherSubrExecutorFactory?: NativeFontPostScriptResult["createOtherSubrExecutor"];
    readonly legacyMasterState?: CffLegacyMasterState;
    readonly glyphIdsByCid: ReadonlyMap<number, number> | null;
    readonly limits: Readonly<NativeCffParserLimits>;
    readonly diagnostics: readonly PdfDiagnostic[];
  }) {
    this.charStrings = options.charStrings;
    this.charStringType = options.charStringType;
    this.globalSubrs = options.globalSubrs;
    this.glyphNames = options.glyphNames;
    this.builtInGlyphNames = options.builtInGlyphNames;
    this.fontDictionaries = options.fontDictionaries;
    this.fdSelect = options.fdSelect;
    this.cff2 = options.cff2 ?? false;
    this.formatVersion = this.cff2 ? 2 : 1;
    this.variationStore = options.variationStore ?? null;
    this.otherSubrExecutorFactory = options.otherSubrExecutorFactory;
    this.legacyMasterState = options.legacyMasterState;
    this.glyphIdsByCid = options.glyphIdsByCid;
    this.limits = options.limits;
    this.diagnosticData = options.diagnostics;
    this.numGlyphs = options.charStrings.length;
    const glyphIds = new Map<string, number>();
    for (let glyphId = 0; glyphId < options.glyphNames.length; glyphId += 1) {
      const name = options.glyphNames[glyphId];
      if (glyphIds.has(name)) {
        throw cffUnsupported(`The CFF charset contains duplicate glyph name /${name}.`,
          "cff-charset-duplicate-name");
      }
      glyphIds.set(name, glyphId);
    }
    this.glyphIdsByName = glyphIds;
  }

  static parse(
    sourceBytes: Uint8Array,
    limitOverrides: Partial<NativeCffParserLimits> = {},
    fontName?: string,
    signal?: AbortSignal,
    options: NativeCffInstanceOptions = {}
  ): NativeCffFont {
    throwIfAborted(signal);
    const limits = mergeCffLimits(limitOverrides);
    if (!(sourceBytes instanceof Uint8Array)) {
      throw new TypeError("CFF source must be a Uint8Array.");
    }
    if (sourceBytes.length > limits.maxCffBytes) {
      throw cffLimit("The CFF program exceeds the configured byte limit.",
        "cff-byte-limit", limits.maxCffBytes);
    }
    if (sourceBytes.length < 4) {
      throw cffUnsupported("The CFF header is truncated.", "cff-header-truncated");
    }
    if (sourceBytes[0] === 2) {
      return NativeCffFont.parseCff2(sourceBytes, limits, signal, options);
    }
    if (sourceBytes[0] !== 1) {
      throw cffUnsupported(
        `CFF major version ${sourceBytes[0]} is not supported.`, "cff-version"
      );
    }
    const headerSize = sourceBytes[2];
    const headerOffSize = sourceBytes[3];
    if (headerSize < 4 || headerSize > sourceBytes.length || headerOffSize < 1 || headerOffSize > 4) {
      throw cffUnsupported("The CFF header has invalid bounds.", "cff-header-bounds");
    }

    const reader = new CffReader(sourceBytes, limits, signal);
    const names = reader.readIndex(headerSize, "Name INDEX");
    if (names.objects.length === 0) {
      throw cffUnsupported(
        "A CFF FontSet must contain at least one font.",
        "cff-font-count"
      );
    }
    const fontNames = names.objects.map(bytes => readCffName(bytes, "CFF font name"));
    const fontIndex = selectCffFont(fontNames, fontName);
    const topIndexes = reader.readIndex(names.end, "Top DICT INDEX");
    if (topIndexes.objects.length !== names.objects.length) {
      throw cffUnsupported(
        "The CFF Name and Top DICT INDEX counts disagree.",
        "cff-top-dict-count"
      );
    }
    const stringsIndex = reader.readIndex(topIndexes.end, "String INDEX");
    let stringBytes = 0;
    const customStrings = stringsIndex.objects.map((bytes) => {
      stringBytes = checkedAdd(stringBytes, bytes.length, "CFF String INDEX bytes");
      if (stringBytes > limits.maxCffStringBytes) {
        throw cffLimit("The CFF String INDEX exceeds the configured byte limit.",
          "cff-string-byte-limit", limits.maxCffStringBytes);
      }
      return readCffString(bytes);
    });
    const globalSubrsIndex = reader.readIndex(stringsIndex.end, "Global Subrs INDEX");
    const legacy: CffLegacyContext = { strings: customStrings, globalSubrs: globalSubrsIndex.objects, limits,
      budget: { executedBytes: 0, operators: 0, subrCalls: 0, signal }, options };
    const selectedTop = parseCffDict(topIndexes.objects[fontIndex], "Top DICT", TOP_DICT_OPERATORS, { legacy });
    const top = resolveCffSyntheticBase(selectedTop, topIndexes.objects, fontIndex, legacy);
    const diagnostics = [...readCffApproximationDiagnostics(top, customStrings)];

    const ros = top.get(dictOperator(12, 30));
    const cidKeyed = ros !== undefined;
    if (ros && (ros.length !== 3 || ros.some(value => !Number.isSafeInteger(value) || value < 0))) {
      throw cffUnsupported("The CFF ROS entry is invalid.", "cff-cid-ros");
    }
    if (!cidKeyed && (top.has(dictOperator(12, 36)) || top.has(dictOperator(12, 37)))) {
      throw cffUnsupported("A CFF Font DICT array requires ROS.", "cff-cid-ros");
    }
    // BaseFontBlend (12 23) records the user design vector of an already
    // instantiated Multiple Master font. Its ordinary CharStrings are usable.
    const charStringType = readOptionalSingleton(top, dictOperator(12, 6), 2, "CharstringType");
    if (charStringType !== 1 && charStringType !== 2) {
      throw cffUnsupported(
        `CFF CharstringType ${charStringType} is not supported.`,
        "cff-charstring-type"
      );
    }
    const charStringsOffset = readRequiredOffset(top, dictOperator(17), "CharStrings");
    const charStringsIndex = reader.readIndex(charStringsOffset, "CharStrings INDEX");
    if (charStringsIndex.objects.length === 0) {
      throw cffUnsupported("The CFF CharStrings INDEX is empty.", "cff-charstrings-empty");
    }

    const glyphCount = charStringsIndex.objects.length;
    const topMatrix = readCffFontMatrix(top);
    let fontDictionaries: readonly CffFontDictionary[];
    let unappliedFontDictionaryPostScript = false;
    let fontDictionaryPostScriptFailure: { error: PdfError; index: number } | undefined;
    let fdSelect: Uint16Array;
    let glyphIdsByCid: ReadonlyMap<number, number> | null = null;
    let glyphNames: readonly string[];
    let builtInGlyphNames: readonly (string | null)[];
    if (cidKeyed) {
      const dictionaries = reader.readIndex(
        readRequiredOffset(top, dictOperator(12, 36), "FDArray"), "Font DICT INDEX"
      );
      if (dictionaries.objects.length === 0 || dictionaries.objects.length > 256) {
        throw cffUnsupported("The CFF Font DICT count is invalid.", "cff-fd-count");
      }
      fontDictionaries = Object.freeze(dictionaries.objects.map((bytes, index) => {
        const originalDictionary = parseCffDict(bytes, "Font DICT", TOP_DICT_OPERATORS, { legacy });
        const computed = applyCffFontDictionaryPostScript(originalDictionary, top, customStrings, limits, signal);
        const dictionary = computed.dictionary;
        if (!computed.executed && readCffApproximationDiagnostics(originalDictionary, customStrings)
          .some(diagnostic => diagnostic.code === "font.cff-postscript-approximation")) unappliedFontDictionaryPostScript = true;
        if (computed.failure && !fontDictionaryPostScriptFailure) fontDictionaryPostScriptFailure = { error: computed.failure, index };
        const matrix = dictionary.has(dictOperator(12, 7))
          ? top.has(dictOperator(12, 7))
            ? multiplyCffMatrices(topMatrix, readCffFontMatrix(dictionary))
            : readCffFontMatrix(dictionary)
          : topMatrix;
        return readCffPrivateDictionary(reader, dictionary, matrix, { paintDictionary: top, legacy });
      }));
      fdSelect = readCffFdSelect(reader,
        readRequiredOffset(top, dictOperator(12, 37), "FDSelect"), glyphCount, fontDictionaries.length);
      const charsetOffset = readRequiredOffset(top, dictOperator(15), "CID charset");
      if (charsetOffset <= 2) {
        throw cffUnsupported("CID CFF fonts cannot use predefined charsets.", "cff-cid-charset");
      }
      const cids = readCffCharsetValues(reader, charsetOffset, glyphCount);
      const mapping = new Map<number, number>();
      for (let glyphId = 0; glyphId < cids.length; glyphId += 1) {
        if (mapping.has(cids[glyphId])) {
          throw cffUnsupported("The CFF charset contains duplicate CIDs.", "cff-cid-duplicate");
        }
        mapping.set(cids[glyphId], glyphId);
      }
      glyphIdsByCid = mapping;
      glyphNames = Object.freeze([]);
      builtInGlyphNames = Object.freeze(Array<string | null>(256).fill(null));
    } else {
      fontDictionaries = Object.freeze([readCffPrivateDictionary(reader, top, topMatrix, { legacy })]);
      fdSelect = new Uint16Array(glyphCount);
      glyphNames = readCffCharset(reader,
        readOptionalOffset(top, dictOperator(15), 0, "charset"), glyphCount, customStrings);
      const glyphIds = new Map(glyphNames.map((name, glyphId) => [name, glyphId] as const));
      builtInGlyphNames = readCffEncoding(reader,
        readOptionalOffset(top, dictOperator(16), 0, "Encoding"), glyphNames, glyphIds, customStrings);
    }

    const computed = applyCffPostScript(top, customStrings, fontNames[fontIndex],
      charStringsIndex.objects, glyphNames, builtInGlyphNames, fontDictionaries, limits, signal);
    fontDictionaries = computed.fontDictionaries;
    builtInGlyphNames = computed.builtInGlyphNames;
    if (computed.executed) {
      const index = diagnostics.findIndex(diagnostic => diagnostic.code === "font.cff-postscript-approximation");
      if (index >= 0) diagnostics.splice(index, 1);
    }
    if (computed.failure) {
      const index = diagnostics.findIndex(diagnostic => diagnostic.code === "font.cff-postscript-approximation");
      if (index >= 0) diagnostics[index] = Object.freeze({ ...diagnostics[index], details: cffPostScriptFailureDetails(computed.failure) });
    }
    if (unappliedFontDictionaryPostScript && !diagnostics.some(diagnostic => diagnostic.code === "font.cff-postscript-approximation")) {
      diagnostics.push(Object.freeze({ code: "font.cff-postscript-approximation", severity: "warning",
        message: "Embedded CFF Font DICT PostScript could not be fully applied; ordinary glyph outlines are retained, but font behavior and appearance may differ.",
        ...(fontDictionaryPostScriptFailure ? { details: Object.freeze({
          ...cffPostScriptFailureDetails(fontDictionaryPostScriptFailure.error), fontDictionaryIndex: fontDictionaryPostScriptFailure.index
        }) } : {}) }));
    }
    if (fontDictionaryPostScriptFailure && computed.failure) {
      const index = diagnostics.findIndex(diagnostic => diagnostic.code === "font.cff-postscript-approximation");
      if (index >= 0) diagnostics[index] = Object.freeze({ ...diagnostics[index], details: Object.freeze({
        ...diagnostics[index].details, fontDictionaryIndex: fontDictionaryPostScriptFailure.index,
        fontDictionaryPostScriptMessage: fontDictionaryPostScriptFailure.error.message,
        ...(fontDictionaryPostScriptFailure.error.details?.operator !== undefined
          ? { fontDictionaryPostScriptOperator: fontDictionaryPostScriptFailure.error.details.operator } : {})
      }) });
    }
    const unsupportedPaint = fontDictionaries.some(dictionary => dictionary.paintType !== 0 && dictionary.paintType !== 2);
    const paintDiagnostic = diagnostics.findIndex(diagnostic => diagnostic.code === "font.cff-paint-type-approximation");
    if (!unsupportedPaint && paintDiagnostic >= 0) diagnostics.splice(paintDiagnostic, 1);
    if (unsupportedPaint && paintDiagnostic < 0) diagnostics.push(Object.freeze({ code: "font.cff-paint-type-approximation", severity: "warning",
      message: "Embedded CFF PaintType is unsupported; filled contours are retained and appearance may differ." }));
    if (fontDictionaries.some(dictionary => !Number.isFinite(dictionary.strokeWidth))) {
      diagnostics.push(Object.freeze({ code: "font.cff-stroke-width-approximation", severity: "warning",
        message: "Embedded CFF StrokeWidth is invalid; a device hairline is retained for stroked glyphs." }));
      fontDictionaries = Object.freeze(fontDictionaries.map(dictionary => Object.freeze({ ...dictionary,
        strokeWidth: Number.isFinite(dictionary.strokeWidth) ? dictionary.strokeWidth : 0 })));
    }

    return new NativeCffFont({
      charStrings: computed.charStrings,
      charStringType,
      globalSubrs: globalSubrsIndex.objects,
      glyphNames,
      builtInGlyphNames,
      fontDictionaries,
      fdSelect,
      glyphIdsByCid,
      limits,
      diagnostics: Object.freeze(diagnostics),
      otherSubrExecutorFactory: computed.otherSubrExecutorFactory,
      legacyMasterState: legacy.state
    });
  }

  private static parseCff2(
    bytes: Uint8Array,
    limits: Readonly<NativeCffParserLimits>,
    signal: AbortSignal | undefined,
    options: NativeCffVariationOptions
  ): NativeCffFont {
    const reader = new CffReader(bytes, limits, signal, true);
    const headerSize = reader.u8(2, "CFF2 header size");
    if (headerSize < 5 || headerSize > bytes.length) {
      throw cffUnsupported("The CFF2 header has invalid bounds.", "cff-header-bounds");
    }
    const topSize = reader.u16(3, "CFF2 Top DICT size");
    const top = parseCffDict(reader.slice(headerSize, topSize, "CFF2 Top DICT"),
      "CFF2 Top DICT", CFF2_TOP_DICT_OPERATORS, { cff2: true });
    const globalSubrs = reader.readIndex(headerSize + topSize, "CFF2 Global Subrs INDEX").objects;
    const variationStore = top.has(24)
      ? NativeCffVariationStore.parse(bytes, readRequiredOffset(top, 24, "VariationStore"), options, signal)
      : null;
    if (!variationStore && options.normalizedCoordinates?.some(value => value !== 0)) {
      throw cffUnsupported("CFF2 variation coordinates require a VariationStore.", "cff-variation-store");
    }
    const charStrings = reader.readIndex(readRequiredOffset(top, 17, "CharStrings"), "CFF2 CharStrings INDEX").objects;
    if (charStrings.length === 0) throw cffUnsupported("The CFF2 CharStrings INDEX is empty.", "cff-charstrings-empty");
    const dictionaryIndex = reader.readIndex(readRequiredOffset(top, dictOperator(12, 36), "FDArray"), "CFF2 Font DICT INDEX");
    if (dictionaryIndex.objects.length === 0) throw cffUnsupported("The CFF2 Font DICT INDEX is empty.", "cff-fd-count");
    const matrix = readCffFontMatrix(top);
    const fontDictionaries = Object.freeze(dictionaryIndex.objects.map(dictionaryBytes => {
      throwIfAborted(signal);
      const dictionary = parseCffDict(dictionaryBytes, "CFF2 Font DICT", CFF2_FONT_DICT_OPERATORS, { cff2: true });
      return readCffPrivateDictionary(reader, dictionary, matrix, { cff2: true, variationStore });
    }));
    const fdSelectOffset = top.get(dictOperator(12, 37));
    if (fontDictionaries.length > 1 && !fdSelectOffset) throw cffUnsupported("Multiple CFF2 Font DICTs require FDSelect.", "cff-fd-select");
    const fdSelect = fdSelectOffset
      ? readCffFdSelect(reader, readRequiredOffset(top, dictOperator(12, 37), "FDSelect"), charStrings.length, fontDictionaries.length, true)
      : new Uint16Array(charStrings.length);
    return new NativeCffFont({ charStrings, charStringType: 2, globalSubrs,
      glyphNames: Object.freeze([]), builtInGlyphNames: Object.freeze(Array<string | null>(256).fill(null)),
      fontDictionaries, fdSelect, glyphIdsByCid: null, limits, diagnostics: Object.freeze([]), cff2: true, variationStore });
  }

  glyphIdForName(name: string | null): number {
    return name === null ? 0 : this.glyphIdsByName.get(name) ?? 0;
  }

  get diagnostics(): readonly PdfDiagnostic[] {
    return this.diagnosticData;
  }

  glyphIdForCid(cid: number): number {
    return this.glyphIdsByCid === null
      ? Number.isSafeInteger(cid) && cid >= 0 && cid < this.numGlyphs ? cid : 0
      : this.glyphIdsByCid.get(cid) ?? 0;
  }

  getGlyphOutline(glyphId: number, signal?: AbortSignal, applyIntrinsicPaint = true): NativeGlyphOutline {
    throwIfAborted(signal);
    if (!Number.isSafeInteger(glyphId) || glyphId < 0 || glyphId >= this.numGlyphs) {
      throw cffUnsupported(`CFF glyph ${glyphId} is outside the CharStrings INDEX.`,
        "cff-glyph-index");
    }
    const cache = applyIntrinsicPaint ? this.outlineCache : this.pdfOutlineCache;
    const cached = cache.get(glyphId);
    if (cached) return cached;
    const budget: Type2Budget = { executedBytes: 0, operators: 0, subrCalls: 0, signal };
    const raw = this.evaluateRawGlyph(glyphId, new Set(), 0, budget);
    const dictionary = this.fontDictionaries[this.fdSelect[glyphId]];
    const fontMatrix = dictionary.fontMatrix;
    const paintType = applyIntrinsicPaint && dictionary.paintType === 2 ? 2 : 0;
    const transform = Object.freeze(fontMatrix.map(value => value * 1000));
    const painted = paintNativeGlyphCommands(raw.commands, paintType, dictionary.strokeWidth ?? 0, {
      transform, signal, maxPathCommands: this.limits.maxType2PathCommands
    });
    const commands = painted.commands;
    const rawPaints = raw.postScriptPaintSequence
      ? materializeCffPostScriptPaintSequence(raw.postScriptPaintSequence, paintType, dictionary.strokeWidth ?? 0)
      : raw.postScriptPaints;
    const postScriptPaints = rawPaints?.length
      ? transformNativeGlyphPostScriptPaints(rawPaints, transform as CffMatrix) : undefined;
    const postScriptFinalState = raw.postScriptFinalState
      ? transformNativeGlyphPostScriptFinalState(raw.postScriptFinalState, transform as CffMatrix) : undefined;
    if (painted.approximated && !this.diagnosticData.some(diagnostic => diagnostic.code === "font.cff-stroke-approximation")) {
      this.diagnosticData = Object.freeze([...this.diagnosticData, Object.freeze({
        code: "font.cff-stroke-approximation", severity: "warning" as const,
        message: "Stroked CFF glyph curves use a vector approximation within 0.01 raw font character-space units before FontMatrix."
      })]);
    }
    const ordinaryBounds = painted.bounds ?? measureCommands(commands);
    const finalStrokePaints = paintType === 2 && raw.postScriptFinalState && !raw.postScriptFinalState.omitFinalPaint
      ? transformNativeGlyphPostScriptPaints(materializeCffPostScriptPaintSequence([
        { kind: "implicit", commands: raw.commands, finalState: raw.postScriptFinalState }
      ], paintType, dictionary.strokeWidth ?? 0), transform as CffMatrix) : [];
    const paintBounds = nativeGlyphPostScriptPaintBounds([...(postScriptPaints ?? []), ...finalStrokePaints]);
    const bounds = paintBounds ? commands.length ? Object.freeze([
      Math.min(ordinaryBounds[0], paintBounds[0]), Math.min(ordinaryBounds[1], paintBounds[1]),
      Math.max(ordinaryBounds[2], paintBounds[2]), Math.max(ordinaryBounds[3], paintBounds[3])
    ]) as readonly [number, number, number, number] : paintBounds : ordinaryBounds;
    const advanceWidth = transformWidth(raw.advanceWidth, fontMatrix, raw.advanceY);
    const outline: NativeGlyphOutline = Object.freeze({
      glyphId,
      commands,
      bounds,
      advanceWidth,
      leftSideBearing: bounds[0],
      ...(postScriptPaints ? { postScriptPaints } : {}),
      ...(postScriptFinalState ? { postScriptFinalState } : {}),
      ...(paintType === 2 ? { intrinsicStroke: Object.freeze({ width: dictionary.strokeWidth ?? 0,
        transform, commands: raw.commands }) } : {})
    });
    cache.set(glyphId, outline);
    return outline;
  }

  private evaluateRawGlyph(
    glyphId: number,
    glyphAncestry: Set<number>,
    glyphDepth: number,
    budget: Type2Budget
  ): RawGlyphOutline {
    throwIfAborted(budget.signal);
    const cached = this.rawOutlineCache.get(glyphId);
    if (cached) return cached;
    if (glyphDepth > this.limits.maxType2SubrDepth) {
      throw cffLimit("CFF composite glyph depth exceeds the configured limit.",
        "type2-glyph-depth-limit", this.limits.maxType2SubrDepth);
    }
    if (glyphAncestry.has(glyphId)) {
      throw cffUnsupported("A CFF endchar composite contains a glyph cycle.",
        "type2-glyph-cycle");
    }
    glyphAncestry.add(glyphId);
    try {
      const dictionary = this.fontDictionaries[this.fdSelect[glyphId]];
      if (this.charStringType === 1) {
        let executeOtherSubr: ReturnType<NativeFontPostScriptResult["createOtherSubrExecutor"]> | undefined;
        if (this.otherSubrExecutorFactory) {
          let otherSubrFailure: PdfError | undefined;
          const interpreted = evaluateNativeType1CompositeGlyph({ source: this.charStrings[glyphId], glyphId,
            subrs: dictionary.localSubrs }, {
            signal: budget.signal, budget, limits: type1LimitsFromCff(this.limits),
            blendWeights: this.legacyMasterState?.registers[0].slice(0, this.legacyMasterState.masterCount),
            executeOtherSubr: (index, args, context) => {
              otherSubrFailure = undefined;
              try {
                executeOtherSubr ??= this.otherSubrExecutorFactory!(budget.signal, context);
                return executeOtherSubr(index, args);
              } catch (error) {
                if (!(error instanceof PdfError) || error.code !== "unsupported-font") throw error;
                otherSubrFailure = error;
                return null;
              }
            },
            onUnknownOtherSubr: index => {
              if (this.unknownType1OtherSubrs.has(index)) return;
              this.unknownType1OtherSubrs.add(index);
              this.diagnosticData = Object.freeze([...this.diagnosticData, Object.freeze({
                code: "font.type1-othersubr-approximated", severity: "warning" as const,
                message: `CFF Type 1 OtherSubr ${index} uses the required argument-preserving fallback; custom PostScript effects may differ.`,
                details: Object.freeze({ reason: "type1-unknown-othersubr", othersubr: index, approximate: true,
                  ...(otherSubrFailure ? cffPostScriptFailureDetails(otherSubrFailure) : {}) })
              })]);
            },
            resolveGlyph: code => {
              const name = standardEncodingGlyphName(code), id = name === null ? undefined : this.glyphIdsByName.get(name);
              if (this.glyphIdsByCid !== null || id === undefined) throw cffUnsupported("A CFF Type 1 composite references a missing StandardEncoding glyph.", "type1-seac-missing-glyph");
              return { source: this.charStrings[id], glyphId: id, subrs: this.fontDictionaries[this.fdSelect[id]].localSubrs };
            }
          });
          for (const diagnostic of interpreted.postScriptDiagnostics ?? []) {
            if (!this.diagnosticData.some(existing => existing.code === diagnostic.code)) this.diagnosticData = Object.freeze([...this.diagnosticData, diagnostic]);
          }
          const result = Object.freeze({ commands: interpreted.commands,
            advanceWidth: interpreted.advanceWidth, advanceY: interpreted.advanceY,
            ...(interpreted.postScriptPaints ? { postScriptPaints: interpreted.postScriptPaints } : {}),
            ...(interpreted.postScriptFinalState ? { postScriptFinalState: interpreted.postScriptFinalState } : {}) });
          this.rawOutlineCache.set(glyphId, result);
          return result;
        }
        let compositePaints: readonly NativeGlyphPostScriptPaint[] = [];
        let compositeSequence: readonly CffPostScriptPaintSequenceItem[] | undefined;
        let otherSubrFailure: PdfError | undefined;
        const interpreted = evaluateNativeType1CharString(this.charStrings[glyphId], {
          glyphId,
          subrs: dictionary.localSubrs,
          lenIV: -1,
          signal: budget.signal,
          budget,
          blendWeights: this.legacyMasterState?.registers[0].slice(0, this.legacyMasterState.masterCount),
          executeOtherSubr: this.otherSubrExecutorFactory ? (index, args, context) => {
            otherSubrFailure = undefined;
            try {
              executeOtherSubr ??= this.otherSubrExecutorFactory!(budget.signal, context);
              return executeOtherSubr(index, args);
            }
            catch (error) {
              if (!(error instanceof PdfError) || error.code !== "unsupported-font") throw error;
              otherSubrFailure = error;
              return null;
            }
          } : undefined,
          onUnknownOtherSubr: index => {
            if (this.unknownType1OtherSubrs.has(index)) return;
            this.unknownType1OtherSubrs.add(index);
            this.diagnosticData = Object.freeze([...this.diagnosticData, Object.freeze({
              code: "font.type1-othersubr-approximated",
              severity: "warning" as const,
              message: `CFF Type 1 OtherSubr ${index} uses the required argument-preserving fallback; custom PostScript effects may differ.`,
              details: Object.freeze({ reason: "type1-unknown-othersubr", othersubr: index, approximate: true,
                ...(otherSubrFailure ? cffPostScriptFailureDetails(otherSubrFailure) : {}) })
            })]);
          },
          limits: type1LimitsFromCff(this.limits),
          resolveComposite: (baseCode, accentCode, accentX, accentY) => {
            const baseName = standardEncodingGlyphName(baseCode);
            const accentName = standardEncodingGlyphName(accentCode);
            const baseId = baseName === null ? undefined : this.glyphIdsByName.get(baseName);
            const accentId = accentName === null ? undefined : this.glyphIdsByName.get(accentName);
            if (this.glyphIdsByCid !== null || baseId === undefined || accentId === undefined) {
              throw cffUnsupported("A CFF Type 1 composite references a missing StandardEncoding glyph.",
                "type1-seac-missing-glyph");
            }
            const base = this.evaluateRawGlyph(baseId, glyphAncestry, glyphDepth + 1, budget);
            const accent = this.evaluateRawGlyph(accentId, glyphAncestry, glyphDepth + 1, budget);
            if (base.postScriptFinalState || accent.postScriptFinalState || base.postScriptPaintSequence || accent.postScriptPaintSequence) {
              compositeSequence = Object.freeze([...cffComponentPaintSequence(base),
                ...translateCffPaintSequence(cffComponentPaintSequence(accent), accentX, accentY)]);
            } else {
              compositePaints = Object.freeze([...(base.postScriptPaints ?? []),
                ...transformNativeGlyphPostScriptPaints(accent.postScriptPaints ?? [], [1, 0, 0, 1, accentX, accentY])]);
            }
            const commands = [...base.commands,
              ...accent.commands.map(command => translateCommand(command, accentX, accentY))];
            if (commands.length > this.limits.maxType2PathCommands) {
              throw cffLimit("CFF composite glyph path commands exceed the configured limit.",
                "type2-path-command-limit", this.limits.maxType2PathCommands);
            }
            return commands;
          }
        });
        for (const diagnostic of interpreted.postScriptDiagnostics ?? []) {
          if (!this.diagnosticData.some(existing => existing.code === diagnostic.code)) {
            this.diagnosticData = Object.freeze([...this.diagnosticData, diagnostic]);
          }
        }
        const postScriptPaints = Object.freeze([...(interpreted.postScriptPaints ?? []), ...compositePaints]);
        const postScriptPaintSequence = compositeSequence
          ? Object.freeze([...(interpreted.postScriptPaints ?? []), ...compositeSequence]) : undefined;
        if (compositeSequence && interpreted.postScriptFinalState &&
          !this.diagnosticData.some(diagnostic => diagnostic.code === "font.type1-seac-state-approximated")) {
          this.diagnosticData = Object.freeze([...this.diagnosticData, Object.freeze({
            code: "font.type1-seac-state-approximated", severity: "warning" as const,
            message: "A Type1 seac parent's PostScript state is not fully inherited by its separately evaluated components; component paints are retained approximately.",
            details: Object.freeze({ reason: "type1-seac-parent-state", approximate: true })
          })]);
        }
        const postScriptFinalState: NativeGlyphPostScriptFinalState | undefined = compositeSequence
          ? Object.freeze({ clips: Object.freeze([]), color: null, omitFinalPaint: true }) : interpreted.postScriptFinalState;
        const countedPaints = postScriptPaintSequence
          ? materializeCffPostScriptPaintSequence(postScriptPaintSequence, 0, 0) : postScriptPaints;
        const retainedCommands = checkedAdd(interpreted.commands.length, nativeGlyphPostScriptCommandCount(countedPaints, postScriptFinalState),
          "CFF PostScript paint commands");
        if (retainedCommands > this.limits.maxType2PathCommands) {
          throw cffLimit("CFF glyph outlines and PostScript paints exceed the configured path command limit.",
            "type2-path-command-limit", this.limits.maxType2PathCommands);
        }
        const result = Object.freeze({ commands: interpreted.commands,
          advanceWidth: interpreted.advanceWidth, advanceY: interpreted.advanceY,
          ...(postScriptPaints.length ? { postScriptPaints } : {}),
          ...(postScriptFinalState ? { postScriptFinalState } : {}),
          ...(postScriptPaintSequence ? { postScriptPaintSequence } : {}) });
        this.rawOutlineCache.set(glyphId, result);
        return result;
      }
      const interpreter = new Type2Interpreter({
        glyphId,
        charString: this.charStrings[glyphId],
        localSubrs: dictionary.localSubrs,
        globalSubrs: this.globalSubrs,
        defaultWidthX: dictionary.defaultWidthX,
        nominalWidthX: dictionary.nominalWidthX,
        initialRandomSeed: dictionary.initialRandomSeed,
        cff2: this.cff2,
        variationStore: this.variationStore,
        vsindex: dictionary.vsindex ?? 0,
        legacyMasterState: this.legacyMasterState ? cloneCffLegacyState(this.legacyMasterState) : undefined,
        limits: this.limits,
        budget
      });
      const interpreted = interpreter.run();
      let commands = [...interpreted.commands];
      if (interpreted.seac) {
        if (this.glyphIdsByCid !== null) {
          throw cffUnsupported("CID CFF glyphs cannot use endchar composites.", "type2-cid-seac");
        }
        const baseName = standardEncodingGlyphName(interpreted.seac.baseCode);
        const accentName = standardEncodingGlyphName(interpreted.seac.accentCode);
        const baseGlyphId = baseName === null ? undefined : this.glyphIdsByName.get(baseName);
        const accentGlyphId = accentName === null ? undefined : this.glyphIdsByName.get(accentName);
        if (baseGlyphId === undefined || accentGlyphId === undefined) {
          throw cffUnsupported(
            "A CFF endchar composite references a missing StandardEncoding glyph.",
            "type2-seac-missing-glyph"
          );
        }
        if (commands.length !== 0) {
          throw cffUnsupported(
            "A CFF endchar composite also contains an explicit outline.",
            "type2-seac-explicit-outline"
          );
        }
        const base = this.evaluateRawGlyph(baseGlyphId, glyphAncestry, glyphDepth + 1, budget);
        const accent = this.evaluateRawGlyph(accentGlyphId, glyphAncestry, glyphDepth + 1, budget);
        commands = [
          ...base.commands,
          ...accent.commands.map((command) => translateCommand(
            command,
            interpreted.seac!.accentX,
            interpreted.seac!.accentY
          ))
        ];
        if (commands.length > this.limits.maxType2PathCommands) {
          throw cffLimit("CFF composite glyph path commands exceed the configured limit.",
            "type2-path-command-limit", this.limits.maxType2PathCommands);
        }
      }
      const result: RawGlyphOutline = Object.freeze({
        commands: Object.freeze(commands),
        advanceWidth: interpreted.advanceWidth
      });
      this.rawOutlineCache.set(glyphId, result);
      return result;
    } finally {
      glyphAncestry.delete(glyphId);
    }
  }
}

function cffComponentPaintSequence(outline: RawGlyphOutline): readonly CffPostScriptPaintSequenceItem[] {
  if (outline.postScriptPaintSequence) return outline.postScriptPaintSequence;
  return Object.freeze([...(outline.postScriptPaints ?? []), ...(outline.postScriptFinalState?.omitFinalPaint ? [] : [
    Object.freeze({ kind: "implicit" as const, commands: outline.commands,
      ...(outline.postScriptFinalState ? { finalState: outline.postScriptFinalState } : {}) })
  ])]);
}

function translateCffPaintSequence(sequence: readonly CffPostScriptPaintSequenceItem[], x: number, y: number): readonly CffPostScriptPaintSequenceItem[] {
  const matrix: CffMatrix = [1, 0, 0, 1, x, y];
  return Object.freeze(sequence.map(item => item.kind === "implicit" ? Object.freeze({ ...item,
    commands: Object.freeze(item.commands.map(command => translateCommand(command, x, y))),
    ...(item.finalState ? { finalState: transformNativeGlyphPostScriptFinalState(item.finalState, matrix) } : {})
  }) : transformNativeGlyphPostScriptPaints([item], matrix)[0]));
}

function materializeCffPostScriptPaintSequence(sequence: readonly CffPostScriptPaintSequenceItem[], paintType: number,
  strokeWidth: number): readonly NativeGlyphPostScriptPaint[] {
  const identity: CffMatrix = [1, 0, 0, 1, 0, 0];
  return Object.freeze(sequence.flatMap(item => {
    if (item.kind !== "implicit") return [item];
    if (item.finalState?.omitFinalPaint || item.commands.length === 0) return [];
    const state = item.finalState;
    const changed = state?.changedStrokeFields ?? [];
    return [Object.freeze({ kind: paintType === 2 ? "stroke" as const : "fill" as const,
      commands: item.commands, fillRule: 0 as const, clips: state?.clips ?? Object.freeze([]), color: state?.color ?? null,
      ...(state?.pattern ? { pattern: state.pattern } : {}),
      ...(paintType === 2 ? {
        stroke: Object.freeze({ width: changed.includes("width") ? state!.stroke!.width : Math.abs(strokeWidth),
          lineCap: state?.stroke?.lineCap ?? 0, lineJoin: state?.stroke?.lineJoin ?? 0,
          miterLimit: state?.stroke?.miterLimit ?? 10, dashArray: state?.stroke?.dashArray ?? Object.freeze([]),
          dashPhase: state?.stroke?.dashPhase ?? 0, transform: state?.stroke?.transform ?? identity }),
        changedStrokeFields: Object.freeze([...new Set(["width" as const, ...changed])])
      } : {})
    })];
  }));
}

class CffReader {
  private readonly bytes: Uint8Array;
  private readonly limits: Readonly<NativeCffParserLimits>;
  private readonly signal?: AbortSignal;
  private readonly cff2: boolean;
  private indexEntryCount = 0;

  constructor(bytes: Uint8Array, limits: Readonly<NativeCffParserLimits>, signal?: AbortSignal, cff2 = false) {
    this.bytes = bytes;
    this.limits = limits;
    this.signal = signal;
    this.cff2 = cff2;
  }

  readIndex(offset: number, label: string): CffIndex {
    throwIfAborted(this.signal);
    const countSize = this.cff2 ? 4 : 2;
    const count = this.cff2 ? this.u32(offset, label) : this.u16(offset, label);
    if (count === 0) return Object.freeze({ objects: Object.freeze([]), end: offset + countSize });
    this.indexEntryCount = checkedAdd(this.indexEntryCount, count, "CFF INDEX entry count");
    if (this.indexEntryCount > this.limits.maxCffIndexEntries) {
      throw cffLimit("CFF INDEX entries exceed the configured limit.",
        "cff-index-entry-limit", this.limits.maxCffIndexEntries);
    }
    const offSizePosition = checkedAdd(offset, countSize, `${label} OffSize position`);
    const offSize = this.u8(offSizePosition, label);
    if (offSize < 1 || offSize > 4) {
      throw cffUnsupported(`${label} has an invalid OffSize.`, "cff-index-offsize");
    }
    const offsetsStart = checkedAdd(offSizePosition, 1, `${label} offsets start`);
    const offsetCount = checkedAdd(count, 1, `${label} offset count`);
    const offsetBytes = checkedMultiply(offsetCount, offSize, `${label} offsets`);
    this.requireRange(offsetsStart, offsetBytes, label);
    const offsets = new Array<number>(offsetCount);
    for (let index = 0; index < offsetCount; index += 1) {
      offsets[index] = this.variableOffset(offsetsStart + index * offSize, offSize, label);
      if (offsets[index] < 1 || (index > 0 && offsets[index] < offsets[index - 1])) {
        throw cffUnsupported(`${label} offsets are invalid or unsorted.`,
          "cff-index-offsets");
      }
    }
    if (offsets[0] !== 1) {
      throw cffUnsupported(`${label} must begin at one-based offset 1.`,
        "cff-index-first-offset");
    }
    const dataStart = checkedAdd(offsetsStart, offsetBytes, `${label} data start`);
    const dataLength = offsets[offsets.length - 1] - 1;
    this.requireRange(dataStart, dataLength, label);
    const objects = new Array<Uint8Array>(count);
    for (let index = 0; index < count; index += 1) {
      const start = checkedAdd(dataStart, offsets[index] - 1, `${label} object start`);
      const length = offsets[index + 1] - offsets[index];
      objects[index] = this.bytes.subarray(start, start + length);
    }
    return Object.freeze({
      objects: Object.freeze(objects),
      end: checkedAdd(dataStart, dataLength, `${label} end`)
    });
  }

  slice(offset: number, length: number, label: string): Uint8Array {
    this.requireRange(offset, length, label);
    return this.bytes.subarray(offset, offset + length);
  }

  u8(offset: number, label: string): number {
    this.requireRange(offset, 1, label);
    return this.bytes[offset];
  }

  u16(offset: number, label: string): number {
    this.requireRange(offset, 2, label);
    return this.bytes[offset] * 256 + this.bytes[offset + 1];
  }

  u32(offset: number, label: string): number {
    return this.variableOffset(offset, 4, label);
  }

  private variableOffset(offset: number, size: number, label: string): number {
    this.requireRange(offset, size, label);
    let value = 0;
    for (let index = 0; index < size; index += 1) value = value * 256 + this.bytes[offset + index];
    return value;
  }

  private requireRange(offset: number, length: number, label: string): void {
    if (!rangeFits(offset, length, this.bytes.length)) {
      throw cffUnsupported(`${label} is out of bounds.`, "cff-bounds");
    }
  }
}

class Type2Interpreter {
  private readonly glyphId: number;
  private readonly charString: Uint8Array;
  private readonly localSubrs: readonly Uint8Array[];
  private readonly globalSubrs: readonly Uint8Array[];
  private readonly nominalWidthX: number;
  private readonly limits: Readonly<NativeCffParserLimits>;
  private readonly budget: Type2Budget;
  private readonly cff2: boolean;
  private readonly variationStore: NativeCffVariationStore | null;
  private vsindex: number;
  private sawVsindex = false;
  private sawBlend = false;
  private readonly legacyMasterState?: CffLegacyMasterState;
  private readonly metadataProgram: boolean;
  private metadataConsumed = 0;
  private readonly commands: NativeGlyphPathCommand[] = [];
  private readonly stack: number[] = [];
  private readonly transient = new Float64Array(32);
  private readonly activeSubrs = new Set<string>();
  private x = 0;
  private y = 0;
  private contourOpen = false;
  private stemCount = 0;
  private widthResolved = false;
  private advanceWidth: number;
  private randomState: number;
  private seac: Type2Seac | null = null;

  constructor(options: {
    readonly glyphId: number;
    readonly charString: Uint8Array;
    readonly localSubrs: readonly Uint8Array[];
    readonly globalSubrs: readonly Uint8Array[];
    readonly defaultWidthX: number;
    readonly nominalWidthX: number;
    readonly initialRandomSeed: number;
    readonly cff2?: boolean;
    readonly variationStore?: NativeCffVariationStore | null;
    readonly vsindex?: number;
    readonly legacyMasterState?: CffLegacyMasterState;
    readonly metadataProgram?: boolean;
    readonly initialOperands?: readonly number[];
    readonly limits: Readonly<NativeCffParserLimits>;
    readonly budget: Type2Budget;
  }) {
    this.glyphId = options.glyphId;
    this.charString = options.charString;
    this.localSubrs = options.localSubrs;
    this.globalSubrs = options.globalSubrs;
    this.nominalWidthX = options.nominalWidthX;
    this.limits = options.limits;
    this.budget = options.budget;
    this.cff2 = options.cff2 ?? false;
    this.variationStore = options.variationStore ?? null;
    this.vsindex = options.vsindex ?? 0;
    this.legacyMasterState = options.legacyMasterState;
    this.metadataProgram = options.metadataProgram ?? false;
    for (const operand of options.initialOperands ?? []) this.push(operand);
    this.widthResolved = this.cff2;
    this.advanceWidth = options.defaultWidthX;
    // Adobe specifies the random range, not a particular PRNG sequence.
    // Reset a seeded xorshift32 per glyph so cache order and parallelism cannot
    // change an outline. Fold both halves of fractional/large seeds as well.
    const seed = new DataView(new ArrayBuffer(8));
    seed.setFloat64(0, options.initialRandomSeed, true);
    this.randomState = (seed.getUint32(0, true) ^ seed.getUint32(4, true)) || 0x7384;
  }

  run(): {
    readonly commands: readonly NativeGlyphPathCommand[];
    readonly advanceWidth: number;
    readonly seac: Type2Seac | null;
  } {
    const status = this.execute(this.charString, 0, true);
    if (this.cff2) {
      if (this.stack.length !== 0) this.invalid("The CFF2 charstring ends with unused operands.");
      this.closeContour();
    } else if (status !== "endchar") {
      throw cffUnsupported(`CFF glyph ${this.glyphId} has no endchar operator.`,
        "type2-missing-endchar");
    }
    return Object.freeze({
      commands: Object.freeze(this.commands),
      advanceWidth: this.advanceWidth,
      seac: this.seac
    });
  }

  runMetadata(): { readonly operands: readonly number[]; readonly consumed: number } {
    const status = this.execute(this.charString, 0, true);
    if (status === "eof") this.invalid("A legacy CFF DICT/conversion program has no terminating operator.");
    return { operands: this.stack.slice(), consumed: this.metadataConsumed };
  }

  private execute(
    bytes: Uint8Array,
    depth: number,
    topLevel: boolean
  ): "endchar" | "return" | "eof" {
    if (this.cff2 && bytes.length > 65535) this.invalid("A CFF2 charstring exceeds the format's 65535-byte length.");
    if (depth > this.limits.maxType2SubrDepth) {
      throw cffLimit("Type 2 subroutine depth exceeds the configured limit.",
        "type2-subr-depth-limit", this.limits.maxType2SubrDepth);
    }
    this.budget.executedBytes = checkedAdd(
      this.budget.executedBytes,
      bytes.length,
      "Type 2 executed charstring bytes"
    );
    if (this.budget.executedBytes > this.limits.maxType2CharStringBytes) {
      throw cffLimit("Type 2 executed charstring bytes exceed the configured limit.",
        "type2-charstring-byte-limit", this.limits.maxType2CharStringBytes);
    }

    let offset = 0;
    while (offset < bytes.length) {
      throwIfAborted(this.budget.signal);
      const byte = bytes[offset++];
      if (isType2NumberByte(byte)) {
        const number = readType2Number(bytes, offset - 1);
        offset = number.next;
        this.push(number.value);
        continue;
      }
      this.countOperator();
      if (this.metadataProgram && [1, 3, 4, 5, 6, 7, 8, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 30, 31].includes(byte)) {
        this.invalid("A legacy CFF DICT/conversion program contains a drawing or hint operator.");
      }
      switch (byte) {
        case 1: // hstem
        case 3: // vstem
        case 18: // hstemhm
        case 23: // vstemhm
          this.consumeStemArguments(false);
          break;
        case 4: { // vmoveto
          const [dy] = this.consumeMoveArguments(1, "vmoveto");
          this.moveTo(0, dy);
          break;
        }
        case 5: { // rlineto
          const values = this.consumeMultiple(2, "rlineto");
          if (values.length % 2 !== 0) this.invalid("rlineto requires coordinate pairs.");
          for (let index = 0; index < values.length; index += 2) {
            this.lineTo(values[index], values[index + 1]);
          }
          break;
        }
        case 6:
        case 7: { // hlineto / vlineto
          const values = this.consumeMultiple(1, byte === 6 ? "hlineto" : "vlineto");
          let horizontal = byte === 6;
          for (const value of values) {
            this.lineTo(horizontal ? value : 0, horizontal ? 0 : value);
            horizontal = !horizontal;
          }
          break;
        }
        case 8: { // rrcurveto
          const values = this.consumeMultiple(6, "rrcurveto");
          if (values.length % 6 !== 0) this.invalid("rrcurveto requires groups of six operands.");
          for (let index = 0; index < values.length; index += 6) {
            this.curveTo(...values.slice(index, index + 6) as [number, number, number, number, number, number]);
          }
          break;
        }
        case 10: { // callsubr
          const rawIndex = this.popInteger("callsubr index");
          const status = this.callSubroutine(
            this.localSubrs,
            rawIndex,
            "local",
            depth + 1
          );
          if (status === "endchar") { if (topLevel) this.metadataConsumed = offset; return status; }
          break;
        }
        case 11: // return
          if (this.cff2) { this.stack.length = 0; break; }
          if (this.metadataProgram && topLevel) { this.metadataConsumed = offset; return "return"; }
          if (topLevel) this.invalid("return is not valid in a top-level charstring.");
          return "return";
        case 12: {
          if (offset >= bytes.length) this.invalid("An escaped Type 2 operator is truncated.");
          const escaped = bytes[offset++];
          this.executeEscaped(escaped);
          break;
        }
        case 14: // endchar
          if (this.cff2) { this.stack.length = 0; break; }
          if (this.metadataProgram) { if (topLevel) this.metadataConsumed = offset; return "endchar"; }
          if (!topLevel) {
            // An endchar reached through a subroutine terminates the glyph, not
            // merely that subroutine.
          }
          this.finishEndChar();
          return "endchar";
        case 15: // CFF2 vsindex
          if (!this.cff2) this.invalid("Type 2 operator 15 is reserved.");
          if (this.sawVsindex || this.sawBlend || this.stack.length !== 1) this.invalid("CFF2 vsindex must occur once, before blend, with one operand.");
          this.vsindex = this.popInteger("vsindex");
          this.requireVariationStore().getScalars(this.vsindex);
          this.sawVsindex = true;
          break;
        case 16: // CFF2 blend / legacy CFF1 Multiple Master blend
          if (this.cff2) {
            blendCffOperands(this.stack, this.requireVariationStore().getScalars(this.vsindex));
            this.sawBlend = true;
            break;
          }
          if (this.legacyMasterState) {
            blendCffOperands(this.stack, this.legacyMasterState.registers[0].slice(1, this.legacyMasterState.masterCount));
            break;
          }
          throw cffUnsupported("CFF Multiple Master blend requires interpolation state that is not supported.",
            "cff-multiple-master-not-supported");
        case 19:
        case 20: { // hintmask / cntrmask
          this.consumeStemArguments(true);
          const maskLength = Math.ceil(this.stemCount / 8);
          if (!rangeFits(offset, maskLength, bytes.length)) {
            this.invalid(`${byte === 19 ? "hintmask" : "cntrmask"} bytes are truncated.`);
          }
          offset += maskLength;
          break;
        }
        case 21: { // rmoveto
          const [dx, dy] = this.consumeMoveArguments(2, "rmoveto");
          this.moveTo(dx, dy);
          break;
        }
        case 22: { // hmoveto
          const [dx] = this.consumeMoveArguments(1, "hmoveto");
          this.moveTo(dx, 0);
          break;
        }
        case 24: { // rcurveline
          const values = this.consumeMultiple(8, "rcurveline");
          if ((values.length - 2) % 6 !== 0) {
            this.invalid("rcurveline has invalid curve/line operands.");
          }
          let index = 0;
          while (index < values.length - 2) {
            this.curveTo(...values.slice(index, index + 6) as [number, number, number, number, number, number]);
            index += 6;
          }
          this.lineTo(values[index], values[index + 1]);
          break;
        }
        case 25: { // rlinecurve
          const values = this.consumeMultiple(8, "rlinecurve");
          if ((values.length - 6) % 2 !== 0) {
            this.invalid("rlinecurve has invalid line/curve operands.");
          }
          let index = 0;
          while (index < values.length - 6) {
            this.lineTo(values[index], values[index + 1]);
            index += 2;
          }
          this.curveTo(...values.slice(index, index + 6) as [number, number, number, number, number, number]);
          break;
        }
        case 26: { // vvcurveto
          const values = this.consumeMultiple(4, "vvcurveto");
          const odd = values.length % 4;
          if (odd !== 0 && odd !== 1) this.invalid("vvcurveto has invalid operands.");
          let index = 0;
          let firstX = 0;
          if (odd === 1) firstX = values[index++];
          while (index < values.length) {
            this.curveTo(
              firstX, values[index],
              values[index + 1], values[index + 2],
              0, values[index + 3]
            );
            firstX = 0;
            index += 4;
          }
          break;
        }
        case 27: { // hhcurveto
          const values = this.consumeMultiple(4, "hhcurveto");
          const odd = values.length % 4;
          if (odd !== 0 && odd !== 1) this.invalid("hhcurveto has invalid operands.");
          let index = 0;
          let firstY = 0;
          if (odd === 1) firstY = values[index++];
          while (index < values.length) {
            this.curveTo(
              values[index], firstY,
              values[index + 1], values[index + 2],
              values[index + 3], 0
            );
            firstY = 0;
            index += 4;
          }
          break;
        }
        case 29: { // callgsubr
          const rawIndex = this.popInteger("callgsubr index");
          const status = this.callSubroutine(
            this.globalSubrs,
            rawIndex,
            "global",
            depth + 1
          );
          if (status === "endchar") { if (topLevel) this.metadataConsumed = offset; return status; }
          break;
        }
        case 30:
        case 31: { // vhcurveto / hvcurveto
          const values = this.consumeMultiple(4, byte === 30 ? "vhcurveto" : "hvcurveto");
          if (values.length % 4 !== 0 && values.length % 4 !== 1) {
            this.invalid(`${byte === 30 ? "vhcurveto" : "hvcurveto"} has invalid operands.`);
          }
          let index = 0;
          let verticalFirst = byte === 30;
          while (index < values.length) {
            const remaining = values.length - index;
            if (remaining < 4) this.invalid("Alternating curve operands are truncated.");
            const optionalLast = remaining === 5 ? values[index + 4] : 0;
            if (verticalFirst) {
              this.curveTo(
                0, values[index],
                values[index + 1], values[index + 2],
                values[index + 3], optionalLast
              );
            } else {
              this.curveTo(
                values[index], 0,
                values[index + 1], values[index + 2],
                optionalLast, values[index + 3]
              );
            }
            index += remaining === 5 ? 5 : 4;
            verticalFirst = !verticalFirst;
          }
          break;
        }
        default:
        if (this.cff2) { this.stack.length = 0; break; }
          this.invalid(`Type 2 operator ${byte} is reserved or unsupported.`);
      }
    }
    return "eof";
  }

  private executeEscaped(operator: number): void {
    // CFF2 deliberately removes CFF1 arithmetic/storage and return/endchar.
    // The OpenType forward-compatibility rule ignores unknown operators and
    // clears their operands; treating them as their CFF1 counterparts is wrong.
    if (this.cff2 && (operator < 34 || operator > 37)) { this.stack.length = 0; return; }
    switch (operator) {
      case 0: // dotsection
        // Adobe Type 2 Appendix C requires PDF-capable processors to accept
        // this deprecated hint-suspension operator. Adobe renderers have
        // always treated it as a no-op, so it has no outline or stack effect.
        break;
      case 3: { // and
        const [left, right] = this.popBinary("and");
        this.push(left !== 0 && right !== 0 ? 1 : 0);
        break;
      }
      case 4: { // or
        const [left, right] = this.popBinary("or");
        this.push(left !== 0 || right !== 0 ? 1 : 0);
        break;
      }
      case 5: // not
        this.push(this.pop("not") === 0 ? 1 : 0);
        break;
      case 8: // legacy MM store: reg j i count -> register[j..] = BCA[i..]
      case 13: { // legacy MM load: reg i count -> BCA[i..] = register[0..]
        const state = this.legacyMasterState;
        if (!state) throw cffUnsupported("CFF Multiple Master storage requires interpolation state that is not available.", "cff-multiple-master-not-supported");
        const count = this.popInteger("MM transfer count"), index = this.popInteger("MM BuildCharArray index");
        const registerIndex = operator === 8 ? this.popInteger("MM register index") : 0;
        const registerId = this.popInteger("MM register");
        const register = state.registers[registerId];
        if (!register || count < 0 || index < 0 || index > state.buildCharLength - count || registerIndex < 0 || registerIndex > register.length - count) this.invalid("Legacy CFF MM load/store operands are out of bounds.");
        for (let at = 0; at < count; at += 1) {
          if (operator === 8) register[registerIndex + at] = state.buildChar.get(index + at) ?? 0;
          else state.buildChar.set(index + at, register[at]);
        }
        break;
      }
      case 9: // abs
        this.push(Math.abs(this.pop("abs")));
        break;
      case 10: { // add
        const [left, right] = this.popBinary("add");
        this.pushFinite(left + right, "add");
        break;
      }
      case 11: { // sub
        const [left, right] = this.popBinary("sub");
        this.pushFinite(left - right, "sub");
        break;
      }
      case 12: { // div
        const [left, right] = this.popBinary("div");
        if (right === 0) this.invalid("Type 2 div divides by zero.");
        this.pushFinite(left / right, "div");
        break;
      }
      case 14: // neg
        this.pushFinite(-this.pop("neg"), "neg");
        break;
      case 15: { // eq
        const [left, right] = this.popBinary("eq");
        this.push(left === right ? 1 : 0);
        break;
      }
      case 18: // drop
        this.pop("drop");
        break;
      case 20: { // put
        const index = this.popInteger("put index");
        const value = this.pop("put value");
        if (index < 0 || index >= (this.legacyMasterState?.buildCharLength ?? this.transient.length)) {
          this.invalid("Type 2 put index is outside the transient array.");
        }
        if (this.legacyMasterState) this.legacyMasterState.buildChar.set(index, value);
        else this.transient[index] = value;
        break;
      }
      case 21: { // get
        const index = this.popInteger("get index");
        if (index < 0 || index >= (this.legacyMasterState?.buildCharLength ?? this.transient.length)) {
          this.invalid("Type 2 get index is outside the transient array.");
        }
        this.push(this.legacyMasterState ? this.legacyMasterState.buildChar.get(index) ?? 0 : this.transient[index]);
        break;
      }
      case 22: { // ifelse
        const comparisonRight = this.pop("ifelse comparison");
        const comparisonLeft = this.pop("ifelse comparison");
        const falseValue = this.pop("ifelse false value");
        const trueValue = this.pop("ifelse true value");
        this.push(comparisonLeft <= comparisonRight ? trueValue : falseValue);
        break;
      }
      case 23: { // random: Adobe TN 5177 section 4.4, range (0,1]
        let state = this.randomState;
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        this.randomState = state >>> 0;
        this.push((this.randomState + 1) / 0x100000000);
        break;
      }
      case 24: { // mul
        const [left, right] = this.popBinary("mul");
        this.pushFinite(left * right, "mul");
        break;
      }
      case 26: { // sqrt
        const value = this.pop("sqrt");
        if (value < 0) this.invalid("Type 2 sqrt received a negative operand.");
        this.pushFinite(Math.sqrt(value), "sqrt");
        break;
      }
      case 27: { // dup
        const value = this.pop("dup");
        this.push(value);
        this.push(value);
        break;
      }
      case 28: { // exch
        const right = this.pop("exch");
        const left = this.pop("exch");
        this.push(right);
        this.push(left);
        break;
      }
      case 29: { // index
        // Negative indices copy the top element (Adobe TN 5177 section 4.4).
        const index = Math.max(0, this.popInteger("index operand"));
        if (index >= this.stack.length) {
          this.invalid("Type 2 index operand is outside the argument stack.");
        }
        this.push(this.stack[this.stack.length - 1 - index]);
        break;
      }
      case 30: { // roll
        const shiftValue = this.popInteger("roll shift");
        const count = this.popInteger("roll count");
        if (count < 0 || count > this.stack.length) {
          this.invalid("Type 2 roll count is outside the argument stack.");
        }
        if (count > 1) {
          const shift = ((shiftValue % count) + count) % count;
          if (shift !== 0) {
            const start = this.stack.length - count;
            const values = this.stack.splice(start, count);
            this.stack.push(...values.slice(count - shift), ...values.slice(0, count - shift));
          }
        }
        break;
      }
      case 34: { // hflex
        const values = this.consumeExact(7, "hflex");
        this.curveTo(values[0], 0, values[1], values[2], values[3], 0);
        this.curveTo(values[4], 0, values[5], -values[2], values[6], 0);
        break;
      }
      case 35: { // flex
        const values = this.consumeExact(13, "flex");
        this.curveTo(...values.slice(0, 6) as [number, number, number, number, number, number]);
        this.curveTo(...values.slice(6, 12) as [number, number, number, number, number, number]);
        // flex depth (values[12]) influences raster hinting, not the exact path.
        break;
      }
      case 36: { // hflex1
        const values = this.consumeExact(9, "hflex1");
        this.curveTo(values[0], values[1], values[2], values[3], values[4], 0);
        this.curveTo(values[5], 0, values[6], values[7], values[8],
          -(values[1] + values[3] + values[7]));
        break;
      }
      case 37: { // flex1
        const values = this.consumeExact(11, "flex1");
        const sumX = values[0] + values[2] + values[4] + values[6] + values[8];
        const sumY = values[1] + values[3] + values[5] + values[7] + values[9];
        const lastX = Math.abs(sumX) > Math.abs(sumY) ? values[10] : -sumX;
        const lastY = Math.abs(sumX) > Math.abs(sumY) ? -sumY : values[10];
        this.curveTo(...values.slice(0, 6) as [number, number, number, number, number, number]);
        this.curveTo(values[6], values[7], values[8], values[9], lastX, lastY);
        break;
      }
      default:
        this.invalid(`Escaped Type 2 operator 12 ${operator} is reserved or unsupported.`);
    }
  }

  private callSubroutine(
    subrs: readonly Uint8Array[],
    rawIndex: number,
    kind: "local" | "global",
    depth: number
  ): "endchar" | "return" | "eof" {
    this.budget.subrCalls += 1;
    if (this.budget.subrCalls > this.limits.maxType2SubrCalls) {
      throw cffLimit("Type 2 subroutine calls exceed the configured limit.",
        "type2-subr-call-limit", this.limits.maxType2SubrCalls);
    }
    const index = rawIndex + type2SubrBias(subrs.length);
    if (!Number.isSafeInteger(index) || index < 0 || index >= subrs.length) {
      this.invalid(`Type 2 ${kind} subroutine index ${rawIndex} is out of bounds.`);
    }
    const key = `${kind}:${index}`;
    if (this.activeSubrs.has(key)) {
      this.invalid(`Type 2 ${kind} subroutine ${index} contains a call cycle.`);
    }
    this.activeSubrs.add(key);
    try {
      const status = this.execute(subrs[index], depth, false);
      if (status === "eof" && !this.cff2) {
        this.invalid(`Type 2 ${kind} subroutine ${index} has no return operator.`);
      }
      return status;
    } finally {
      this.activeSubrs.delete(key);
    }
  }

  private consumeStemArguments(allowEmpty: boolean): void {
    if (!this.widthResolved) {
      if (this.stack.length % 2 === 1) this.resolveWidth(this.stack.shift()!);
      else this.widthResolved = true;
    }
    if (this.stack.length % 2 !== 0 || (!allowEmpty && this.stack.length === 0)) {
      this.invalid("A Type 2 stem operator has invalid operands.");
    }
    this.stemCount = checkedAdd(this.stemCount, this.stack.length / 2, "Type 2 stem count");
    if (this.stemCount > 96) {
      this.invalid("A Type 2 glyph declares more than 96 hint stems.");
    }
    this.stack.length = 0;
  }

  private consumeMoveArguments(count: number, label: string): number[] {
    if (!this.widthResolved) {
      if (this.stack.length === count + 1) this.resolveWidth(this.stack.shift()!);
      else this.widthResolved = true;
    }
    return this.consumeExact(count, label);
  }

  private finishEndChar(): void {
    if (!this.widthResolved) {
      if (this.stack.length === 1 || this.stack.length === 5) this.resolveWidth(this.stack.shift()!);
      else this.widthResolved = true;
    }
    if (this.stack.length === 4) {
      const [accentX, accentY, baseCode, accentCode] = this.stack;
      if (
        !Number.isSafeInteger(baseCode) || baseCode < 0 || baseCode > 255 ||
        !Number.isSafeInteger(accentCode) || accentCode < 0 || accentCode > 255
      ) {
        this.invalid("Type 2 endchar composite character codes are invalid.");
      }
      this.seac = Object.freeze({ accentX, accentY, baseCode, accentCode });
    } else if (this.stack.length !== 0) {
      this.invalid("Type 2 endchar has invalid operands.");
    }
    this.stack.length = 0;
    this.closeContour();
  }

  private resolveWidth(delta: number): void {
    this.advanceWidth = finiteResult(this.nominalWidthX + delta, "Type 2 glyph width");
    this.widthResolved = true;
  }

  private moveTo(dx: number, dy: number): void {
    this.closeContour();
    this.x = finiteResult(this.x + dx, "Type 2 move x");
    this.y = finiteResult(this.y + dy, "Type 2 move y");
    this.emit({ kind: "move", x: this.x, y: this.y });
    this.contourOpen = true;
  }

  private lineTo(dx: number, dy: number): void {
    this.requireContour("line");
    this.x = finiteResult(this.x + dx, "Type 2 line x");
    this.y = finiteResult(this.y + dy, "Type 2 line y");
    this.emit({ kind: "line", x: this.x, y: this.y });
  }

  private curveTo(
    dx1: number,
    dy1: number,
    dx2: number,
    dy2: number,
    dx3: number,
    dy3: number
  ): void {
    this.requireContour("curve");
    const control1X = finiteResult(this.x + dx1, "Type 2 cubic control x");
    const control1Y = finiteResult(this.y + dy1, "Type 2 cubic control y");
    const control2X = finiteResult(control1X + dx2, "Type 2 cubic control x");
    const control2Y = finiteResult(control1Y + dy2, "Type 2 cubic control y");
    this.x = finiteResult(control2X + dx3, "Type 2 cubic x");
    this.y = finiteResult(control2Y + dy3, "Type 2 cubic y");
    this.emit({
      kind: "cubic",
      control1X,
      control1Y,
      control2X,
      control2Y,
      x: this.x,
      y: this.y
    });
  }

  private closeContour(): void {
    if (!this.contourOpen) return;
    this.emit({ kind: "close" });
    this.contourOpen = false;
  }

  private requireContour(label: string): void {
    if (!this.contourOpen) this.invalid(`A Type 2 ${label} appears before moveto.`);
  }

  private emit(command: NativeGlyphPathCommand): void {
    if (this.commands.length >= this.limits.maxType2PathCommands) {
      throw cffLimit("Type 2 path commands exceed the configured limit.",
        "type2-path-command-limit", this.limits.maxType2PathCommands);
    }
    this.commands.push(command);
  }

  private consumeMultiple(minimum: number, label: string): number[] {
    if (this.stack.length < minimum) this.invalid(`Type 2 ${label} has too few operands.`);
    const values = this.stack.slice();
    this.stack.length = 0;
    return values;
  }

  private consumeExact(count: number, label: string): number[] {
    if (this.stack.length !== count) {
      this.invalid(`Type 2 ${label} requires exactly ${count} operands.`);
    }
    const values = this.stack.slice();
    this.stack.length = 0;
    return values;
  }

  private push(value: number): void {
    if (!Number.isFinite(value)) this.invalid("A Type 2 operand is not finite.");
    const maximum = this.cff2 ? 513 : 48;
    if (this.stack.length >= maximum) this.invalid(`The Type 2 argument stack exceeds ${maximum} operands.`);
    this.stack.push(Object.is(value, -0) ? 0 : value);
  }

  private pushFinite(value: number, label: string): void {
    this.push(finiteResult(value, `Type 2 ${label} result`));
  }

  private pop(label: string): number {
    const value = this.stack.pop();
    if (value === undefined) this.invalid(`Type 2 ${label} underflows the argument stack.`);
    return value;
  }

  private popInteger(label: string): number {
    const value = this.pop(label);
    if (!Number.isSafeInteger(value)) this.invalid(`Type 2 ${label} is not an integer.`);
    return value;
  }

  private popBinary(label: string): readonly [number, number] {
    const right = this.pop(label);
    const left = this.pop(label);
    return [left, right];
  }

  private countOperator(): void {
    this.budget.operators += 1;
    if (this.budget.operators > this.limits.maxType2Operators) {
      throw cffLimit("Type 2 operators exceed the configured limit.",
        "type2-operator-limit", this.limits.maxType2Operators);
    }
  }

  private requireVariationStore(): NativeCffVariationStore {
    if (!this.variationStore) this.invalid("CFF2 variation operators require a VariationStore.");
    return this.variationStore;
  }

  private invalid(message: string): never {
    throw cffUnsupported(`CFF glyph ${this.glyphId}: ${message}`, "type2-invalid-charstring");
  }
}

type CffDictionary = Map<number, readonly number[]>;

function selectCffFont(names: readonly string[], requestedName: string | undefined): number {
  // Embedded subsets often rename their single program independently of the
  // PDF BaseFont. No selection is necessary in that unambiguous case.
  if (names.length === 1) return 0;
  const exact = names.flatMap((name, index) => name === requestedName ? [index] : []);
  if (exact.length === 1) return exact[0];
  const stripSubset = (name: string): string => name.replace(/^[A-Z]{6}\+/, "");
  const matches = requestedName === undefined ? [] : names.flatMap((name, index) =>
    stripSubset(name) === stripSubset(requestedName) ? [index] : []);
  if (matches.length === 1) return matches[0];
  throw cffUnsupported(
    "The CFF FontSet requires an unambiguous font name selection.", "cff-font-selection"
  );
}

function resolveCffSyntheticBase(
  selected: CffDictionary,
  topDicts: readonly Uint8Array[],
  selectedIndex: number,
  legacy?: CffLegacyContext
): CffDictionary {
  const synthetic = selected.get(dictOperator(12, 20));
  if (synthetic === undefined) return selected;
  if (selected.keys().next().value !== dictOperator(12, 20)) {
    throw cffUnsupported("A CFF synthetic Top DICT must begin with SyntheticBase.",
      "cff-synthetic-base");
  }
  if (synthetic.length !== 1 || !Number.isSafeInteger(synthetic[0]) || synthetic[0] < 0 ||
      synthetic[0] >= topDicts.length || synthetic[0] === selectedIndex) {
    throw cffUnsupported("The CFF SyntheticBase index is invalid or cyclic.", "cff-synthetic-base");
  }
  const base = parseCffDict(topDicts[synthetic[0]], "Synthetic base Top DICT", TOP_DICT_OPERATORS, { legacy });
  // Adobe TN 5176 section 17 forbids a CID-keyed or synthetic base. Rejecting
  // those cases also prevents indirect base cycles before any glyph executes.
  if (base.has(dictOperator(12, 20)) || base.has(dictOperator(12, 30))) {
    throw cffUnsupported("A CFF synthetic font requires a regular, non-synthetic base.",
      "cff-synthetic-base");
  }
  const allowed = new Set([2, 16, dictOperator(12, 2), dictOperator(12, 7), dictOperator(12, 20)]);
  for (const operator of selected.keys()) {
    if (!allowed.has(operator)) {
      throw cffUnsupported("A CFF synthetic font contains an unsupported Top DICT override.",
        "cff-synthetic-override");
    }
  }
  const effective = new Map(base);
  for (const [operator, operands] of selected) {
    if (operator !== dictOperator(12, 20)) effective.set(operator, operands);
  }
  return effective;
}

function type1LimitsFromCff(limits: Readonly<NativeCffParserLimits>): Partial<NativeType1ParserLimits> {
  return {
    maxType1CharStringBytes: limits.maxType2CharStringBytes,
    maxType1Operators: limits.maxType2Operators,
    maxType1SubrDepth: limits.maxType2SubrDepth,
    maxType1SubrCalls: limits.maxType2SubrCalls,
    maxType1PathCommands: limits.maxType2PathCommands
  };
}

function readCffApproximationDiagnostics(
  dictionary: CffDictionary,
  customStrings: readonly string[]
): readonly PdfDiagnostic[] {
  const diagnostics: PdfDiagnostic[] = [];
  const paint = dictionary.get(dictOperator(12, 5));
  if (paint !== undefined && (paint.length !== 1 || (paint[0] !== 0 && paint[0] !== 2))) {
    diagnostics.push(Object.freeze({
      code: "font.cff-paint-type-approximation",
      severity: "warning" as const,
      message: "The CFF font uses a non-default PaintType; its contours are retained as filled outlines, so stroked glyph appearance may differ."
    }));
  }
  const postScript = dictionary.get(dictOperator(12, 21));
  if (postScript !== undefined) {
    const sid = postScript.length === 1 ? postScript[0] : -1;
    const text = Number.isSafeInteger(sid) && sid >= 0 && sid <= 64_999
      ? CFF_STANDARD_STRINGS[sid] ?? customStrings[sid - CFF_STANDARD_STRINGS.length]
      : undefined;
    // The font-local interpreter may remove this warning once all computed
    // rendering properties have been applied successfully.
    if (text === undefined || text.trim().length !== 0) {
      diagnostics.push(Object.freeze({
        code: "font.cff-postscript-approximation",
        severity: "warning" as const,
        message: "Embedded CFF PostScript could not be fully applied; ordinary glyph outlines are retained, but font behavior and appearance may differ."
      }));
    }
  }
  return Object.freeze(diagnostics);
}

function applyCffPostScript(
  top: CffDictionary, strings: readonly string[], fontName: string,
  originalCharStrings: readonly Uint8Array[], glyphNames: readonly string[],
  originalEncoding: readonly (string | null)[], originalDictionaries: readonly CffFontDictionary[],
  limits: Readonly<NativeCffParserLimits>, signal?: AbortSignal
): { readonly charStrings: readonly Uint8Array[]; readonly builtInGlyphNames: readonly (string | null)[];
  readonly fontDictionaries: readonly CffFontDictionary[]; readonly executed: boolean;
  readonly failure?: PdfError;
  readonly otherSubrExecutorFactory?: NativeFontPostScriptResult["createOtherSubrExecutor"] } {
  const unchanged = { charStrings: originalCharStrings, builtInGlyphNames: originalEncoding,
    fontDictionaries: originalDictionaries, executed: false };
  const entry = top.get(dictOperator(12, 21));
  if (!entry || entry.length !== 1) return unchanged;
  let code: string;
  try { code = resolveCffTextSid(entry[0], strings); } catch { return unchanged; }
  if (!code.trim()) return { ...unchanged, executed: true };
  const name = (value: string): NativeFontPostScriptValue => ({ kind: "name", value, literal: true });
  const bytes = (value: string): Uint8Array => Uint8Array.from(value, char => char.charCodeAt(0));
  const topMatrix = readCffFontMatrix(top);
  const initialPaint = readCffPaintValue(top, undefined, dictOperator(12, 5), 0);
  const initialStroke = readCffPaintValue(top, undefined, dictOperator(12, 8), 0);
  const initialCharStrings = new Map<string, NativeFontPostScriptValue>(originalCharStrings.map((value, gid) =>
    [glyphNames[gid] ?? String(gid), value.slice()]));
  const initial = new Map<string, NativeFontPostScriptValue>([
    ["FontName", name(fontName)], ["FontType", top.has(dictOperator(12, 30)) ? 9 : 1],
    ["FontMatrix", [...topMatrix]], ["FontBBox", [...(top.get(5) ?? [0, 0, 0, 0])]],
    ["PaintType", initialPaint], ["StrokeWidth", initialStroke],
    ["Encoding", originalEncoding.map(value => name(value ?? ".notdef"))],
    ["CharStrings", initialCharStrings]
  ]);
  const fontInfo = new Map<string, NativeFontPostScriptValue>();
  for (const [operator, key] of [[0, "version"], [1, "Notice"], [2, "FullName"], [3, "FamilyName"], [4, "Weight"], [dictOperator(12, 0), "Copyright"]] as const) {
    const value = top.get(operator);
    if (value?.length === 1) { try { fontInfo.set(key, bytes(resolveCffTextSid(value[0], strings))); } catch { /* Retain malformed nonvisual metadata. */ } }
  }
  for (const [operator, key, fallback] of [[dictOperator(12, 1), "isFixedPitch", 0], [dictOperator(12, 2), "ItalicAngle", 0],
    [dictOperator(12, 3), "UnderlinePosition", -100], [dictOperator(12, 4), "UnderlineThickness", 50]] as const) {
    const value = readOptionalSingleton(top, operator, fallback, key);
    fontInfo.set(key, key === "isFixedPitch" ? value !== 0 : value);
  }
  initial.set("FontInfo", fontInfo);
  const initialFontType = initial.get("FontType");
  try {
    const computed = executeNativeFontPostScript(bytes(code), undefined, { initialDictionary: initial, signal,
      maxOperations: limits.maxCffPostScriptOperations, maxStack: limits.maxCffPostScriptStack,
      maxStringBytes: limits.maxCffStringBytes,
      standardEncoding: Array.from({ length: 256 }, (_, code) => standardEncodingGlyphName(code)), expertEncoding: CFF_EXPERT_ENCODING });
    const dictionary = computed.dictionary;
    // Font programs may keep arbitrary helper procedures and mutable data in
    // their dictionary. Those are retained by the glyph VM, not a reason to
    // discard otherwise valid computed records. Active hooks outside the CFF
    // charstring engine still require an explicit diagnosed fallback.
    rejectUnsupportedCffPostScriptHooks(dictionary);
    if (dictionary.get("FontType") !== initialFontType) return unchanged;
    const matrixValue = dictionary.get("FontMatrix");
    if (!Array.isArray(matrixValue) || matrixValue.some(value => typeof value !== "number")) return unchanged;
    const matrix = validateCffFontMatrix(matrixValue as number[]);
    const paintType = dictionary.get("PaintType"), strokeWidth = dictionary.get("StrokeWidth");
    if ((paintType !== 0 && paintType !== 2) || typeof strokeWidth !== "number" || !Number.isFinite(strokeWidth)) return unchanged;
    const encodingValue = dictionary.get("Encoding");
    if (!Array.isArray(encodingValue) || encodingValue.length !== 256) return unchanged;
    const encoding: (string | null)[] = [];
    for (const value of encodingValue) {
      if (!value || typeof value !== "object" || !("kind" in value) || value.kind !== "name") return unchanged;
      encoding.push(value.value === ".notdef" ? null : value.value);
    }
    const chars = dictionary.get("CharStrings");
    if (!(chars instanceof Map) || chars.size !== originalCharStrings.length) return unchanged;
    const charStrings: Uint8Array[] = [];
    for (let gid = 0; gid < originalCharStrings.length; gid += 1) {
      const value = chars.get(glyphNames[gid] ?? String(gid));
      if (!(value instanceof Uint8Array)) return unchanged;
      charStrings.push(value);
    }
    const determinant = topMatrix[0] * topMatrix[3] - topMatrix[1] * topMatrix[2];
    const inverse = validateCffFontMatrix([topMatrix[3] / determinant, -topMatrix[1] / determinant,
      -topMatrix[2] / determinant, topMatrix[0] / determinant,
      (topMatrix[2] * topMatrix[5] - topMatrix[3] * topMatrix[4]) / determinant,
      (topMatrix[1] * topMatrix[4] - topMatrix[0] * topMatrix[5]) / determinant]);
    const adjustment = multiplyCffMatrices(matrix, inverse);
    return { charStrings: Object.freeze(charStrings), builtInGlyphNames: Object.freeze(encoding), executed: true,
      otherSubrExecutorFactory: computed.createOtherSubrExecutor,
      fontDictionaries: Object.freeze(originalDictionaries.map(value => Object.freeze({ ...value,
        fontMatrix: matrix.every((item, index) => item === topMatrix[index]) ? value.fontMatrix
          : value.fontMatrix.every((item, index) => item === topMatrix[index]) ? matrix
            : multiplyCffMatrices(adjustment, value.fontMatrix),
        paintType: paintType === initialPaint ? value.paintType : paintType,
        strokeWidth: strokeWidth === initialStroke ? value.strokeWidth : strokeWidth }))) };
  } catch (error) {
    if (!(error instanceof PdfError) || error.code !== "unsupported-font") throw error;
    return { ...unchanged, failure: error };
  }
}

/** Adobe 5176 Appendix F executes each FD string before constructing the Top
 * dictionary, without access to that parent or to binary Private DICT data. */
function applyCffFontDictionaryPostScript(
  original: CffDictionary, top: CffDictionary, strings: readonly string[],
  limits: Readonly<NativeCffParserLimits>, signal?: AbortSignal
): { readonly dictionary: CffDictionary; readonly executed: boolean; readonly failure?: PdfError } {
  const unchanged = { dictionary: original, executed: false };
  const entry = original.get(dictOperator(12, 21));
  if (!entry) return { ...unchanged, executed: true };
  if (entry.length !== 1) return unchanged;
  let code: string;
  try { code = resolveCffTextSid(entry[0], strings); } catch { return unchanged; }
  if (!code.trim()) return { ...unchanged, executed: true };
  // An absent FD matrix contributes identity when the parent supplies a
  // matrix; otherwise its default supplies the usual .001 font scaling.
  const matrixOperator = dictOperator(12, 7), paintOperator = dictOperator(12, 5), strokeOperator = dictOperator(12, 8);
  const initialMatrix: CffMatrix = original.has(matrixOperator) ? readCffFontMatrix(original)
    : top.has(matrixOperator) ? [1, 0, 0, 1, 0, 0] : [0.001, 0, 0, 0.001, 0, 0];
  const initialPaint = readCffPaintValue(original, top, paintOperator, 0);
  const initialStroke = readCffPaintValue(original, top, strokeOperator, 0);
  const initial = new Map<string, NativeFontPostScriptValue>([
    ["FontType", 1], ["FontMatrix", [...initialMatrix]], ["PaintType", initialPaint], ["StrokeWidth", initialStroke],
    ["FontBBox", [...(original.get(5) ?? [0, 0, 0, 0])]], ["FontInfo", new Map<string, NativeFontPostScriptValue>()]
  ]);
  const fontName = original.get(dictOperator(12, 38));
  if (fontName?.length === 1) {
    try { initial.set("FontName", { kind: "name", value: resolveCffTextSid(fontName[0], strings), literal: true }); }
    catch { /* Invalid nonvisual names do not prevent retaining glyphs. */ }
  }
  try {
    const computed = executeNativeFontPostScript(Uint8Array.from(code, char => char.charCodeAt(0)), undefined, {
      initialDictionary: initial, signal, maxOperations: limits.maxCffPostScriptOperations,
      maxStack: limits.maxCffPostScriptStack, maxStringBytes: limits.maxCffStringBytes,
      standardEncoding: Array.from({ length: 256 }, (_, code) => standardEncodingGlyphName(code)), expertEncoding: CFF_EXPERT_ENCODING
    }).dictionary;
    rejectUnsupportedCffPostScriptHooks(computed, true);
    if (computed.get("FontType") !== 1) return unchanged;
    const matrixValue = computed.get("FontMatrix");
    if (!Array.isArray(matrixValue) || matrixValue.some(value => typeof value !== "number")) return unchanged;
    const matrix = validateCffFontMatrix(matrixValue as number[]);
    const paint = computed.get("PaintType"), stroke = computed.get("StrokeWidth");
    if ((paint !== 0 && paint !== 2) || typeof stroke !== "number" || !Number.isFinite(stroke)) return unchanged;
    const dictionary = new Map(original);
    if (original.has(matrixOperator) || matrix.some((value, index) => value !== initialMatrix[index])) dictionary.set(matrixOperator, [...matrix]);
    if (original.has(paintOperator) || paint !== initialPaint) dictionary.set(paintOperator, [paint]);
    if (original.has(strokeOperator) || stroke !== initialStroke) dictionary.set(strokeOperator, [stroke]);
    return { dictionary, executed: true };
  } catch (error) {
    if (!(error instanceof PdfError) || error.code !== "unsupported-font") throw error;
    return { ...unchanged, failure: error };
  }
}

function rejectUnsupportedCffPostScriptHooks(dictionary: ReadonlyMap<string, NativeFontPostScriptValue>, fontDictionary = false): void {
  const active = ["BuildChar", "BuildGlyph", "CDevProc", "Metrics", "Metrics2", "WMode", "FMapType", "FDepVector",
    "FDArray", "FDSelect", "CIDMap", "CIDMapOffset", "CIDCount", "GDBytes", "FDBytes", "CIDFontType"];
  if (fontDictionary) active.push("OtherSubrs", "CharStrings", "Encoding");
  const key = active.find(name => dictionary.has(name));
  if (key !== undefined) throw cffUnsupported(`CFF PostScript defines an active /${key} font hook that the native CFF glyph engine does not execute.`, "cff-postscript-font-hook");
  const privateDictionary = dictionary.get("Private");
  if (privateDictionary instanceof Map) {
    const privateKey = ["Subrs", "lenIV", ...(fontDictionary ? ["OtherSubrs"] : [])].find(name => privateDictionary.has(name));
    if (privateKey !== undefined) throw cffUnsupported(`CFF PostScript defines an active Private /${privateKey} record that cannot replace the binary CFF data.`, "cff-postscript-font-hook");
  }
}

function cffPostScriptFailureDetails(error: PdfError): Readonly<Record<string, string | number | boolean | null>> {
  return Object.freeze({ postScriptReason: error.details?.reason ?? "font-postscript-unsupported", fontProgramMessage: error.message,
    ...(error.details?.operator !== undefined ? { operator: error.details.operator } : {}) });
}

const TOP_DICT_OPERATORS = new Set([
  0, 1, 2, 3, 4, 5, 13, 14, 15, 16, 17, 18,
  dictOperator(12, 0), dictOperator(12, 1), dictOperator(12, 2),
  dictOperator(12, 3), dictOperator(12, 4), dictOperator(12, 5),
  dictOperator(12, 6), dictOperator(12, 7), dictOperator(12, 8),
  dictOperator(12, 20), dictOperator(12, 21), dictOperator(12, 22),
  dictOperator(12, 23), dictOperator(12, 24), dictOperator(12, 26), dictOperator(12, 30), dictOperator(12, 31),
  dictOperator(12, 32), dictOperator(12, 33), dictOperator(12, 34),
  dictOperator(12, 35), dictOperator(12, 36), dictOperator(12, 37),
  dictOperator(12, 38)
]);

const PRIVATE_DICT_OPERATORS = new Set([
  6, 7, 8, 9, 10, 11, 19, 20, 21,
  dictOperator(12, 9), dictOperator(12, 10), dictOperator(12, 11),
  dictOperator(12, 12), dictOperator(12, 13), dictOperator(12, 14),
  dictOperator(12, 17), dictOperator(12, 18), dictOperator(12, 19)
]);

const CFF2_TOP_DICT_OPERATORS = new Set([17, 24, dictOperator(12, 7), dictOperator(12, 36), dictOperator(12, 37)]);
const CFF2_FONT_DICT_OPERATORS = new Set([18]);
const CFF2_PRIVATE_DICT_OPERATORS = new Set([
  6, 7, 8, 9, 10, 11, 19, 22, 23,
  dictOperator(12, 9), dictOperator(12, 10), dictOperator(12, 11),
  dictOperator(12, 12), dictOperator(12, 13), dictOperator(12, 17), dictOperator(12, 18)
]);

interface CffDictOptions {
  readonly cff2?: boolean;
  readonly variationStore?: NativeCffVariationStore | null;
  readonly paintDictionary?: CffDictionary;
  readonly legacy?: CffLegacyContext;
}

// Adobe Technical Note #5176, Appendix A. These names are format constants,
// not data copied from another PDF implementation.
const CFF_STANDARD_STRINGS = Object.freeze((`
.notdef space exclam quotedbl numbersign dollar percent ampersand quoteright parenleft
parenright asterisk plus comma hyphen period slash zero one two three four five six seven
eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R
S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore quoteleft a b c d e f
g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde exclamdown cent
sterling fraction yen florin section currency quotesingle quotedblleft guillemotleft guilsinglleft
guilsinglright fi fl endash dagger daggerdbl periodcentered paragraph bullet quotesinglbase
quotedblbase quotedblright guillemotright ellipsis perthousand questiondown grave acute circumflex
tilde macron breve dotaccent dieresis ring cedilla hungarumlaut ogonek caron emdash AE ordfeminine
Lslash Oslash OE ordmasculine ae dotlessi lslash oslash oe germandbls onesuperior logicalnot mu
trademark Eth onehalf plusminus Thorn onequarter divide brokenbar degree thorn threequarters
twosuperior registered minus eth multiply threesuperior copyright Aacute Acircumflex Adieresis
Agrave Aring Atilde Ccedilla Eacute Ecircumflex Edieresis Egrave Iacute Icircumflex Idieresis
Igrave Ntilde Oacute Ocircumflex Odieresis Ograve Otilde Scaron Uacute Ucircumflex Udieresis
Ugrave Yacute Ydieresis Zcaron aacute acircumflex adieresis agrave aring atilde ccedilla eacute
ecircumflex edieresis egrave iacute icircumflex idieresis igrave ntilde oacute ocircumflex
odieresis ograve otilde scaron uacute ucircumflex udieresis ugrave yacute ydieresis zcaron
exclamsmall Hungarumlautsmall dollaroldstyle dollarsuperior ampersandsmall Acutesmall
parenleftsuperior parenrightsuperior twodotenleader onedotenleader zerooldstyle oneoldstyle
twooldstyle threeoldstyle fouroldstyle fiveoldstyle sixoldstyle sevenoldstyle eightoldstyle
nineoldstyle commasuperior threequartersemdash periodsuperior questionsmall asuperior bsuperior
centsuperior dsuperior esuperior isuperior lsuperior msuperior nsuperior osuperior rsuperior
ssuperior tsuperior ff ffi ffl parenleftinferior parenrightinferior Circumflexsmall hyphensuperior
Gravesmall Asmall Bsmall Csmall Dsmall Esmall Fsmall Gsmall Hsmall Ismall Jsmall Ksmall Lsmall
Msmall Nsmall Osmall Psmall Qsmall Rsmall Ssmall Tsmall Usmall Vsmall Wsmall Xsmall Ysmall Zsmall
colonmonetary onefitted rupiah Tildesmall exclamdownsmall centoldstyle Lslashsmall Scaronsmall
Zcaronsmall Dieresissmall Brevesmall Caronsmall Dotaccentsmall Macronsmall figuredash
hypheninferior Ogoneksmall Ringsmall Cedillasmall questiondownsmall oneeighth threeeighths
fiveeighths seveneighths onethird twothirds zerosuperior foursuperior fivesuperior sixsuperior
sevensuperior eightsuperior ninesuperior zeroinferior oneinferior twoinferior threeinferior
fourinferior fiveinferior sixinferior seveninferior eightinferior nineinferior centinferior
dollarinferior periodinferior commainferior Agravesmall Aacutesmall Acircumflexsmall Atildesmall
Adieresissmall Aringsmall AEsmall Ccedillasmall Egravesmall Eacutesmall Ecircumflexsmall
Edieresissmall Igravesmall Iacutesmall Icircumflexsmall Idieresissmall Ethsmall Ntildesmall
Ogravesmall Oacutesmall Ocircumflexsmall Otildesmall Odieresissmall OEsmall Oslashsmall
Ugravesmall Uacutesmall Ucircumflexsmall Udieresissmall Yacutesmall Thornsmall Ydieresissmall
001.000 001.001 001.002 001.003 Black Bold Book Light Medium Regular Roman Semibold
`).trim().split(/\s+/));

function parseCffDict(
  bytes: Uint8Array,
  label: string,
  allowedOperators: ReadonlySet<number>,
  options: CffDictOptions = {}
): CffDictionary {
  const dictionary: CffDictionary = new Map();
  const operands: number[] = [];
  let vsindex = 0;
  let sawBlend = false;
  let offset = 0;
  while (offset < bytes.length) {
    throwIfAborted(options.legacy?.budget.signal);
    const byte = bytes[offset];
    if (!options.cff2 && byte === 31) {
      if (!options.legacy?.state) throw cffUnsupported("Legacy CFF BlendLE requires Multiple Master metadata.", "cff-multiple-master-not-supported");
      const result = runCffLegacyProgram(bytes.subarray(offset + 1), operands, options.legacy);
      offset += 1 + result.consumed;
      operands.splice(0, operands.length, ...result.operands);
      continue;
    }
    if (isCffDictNumberByte(byte)) {
      const number = readCffDictNumber(bytes, offset);
      offset = number.next;
      const maximum = options.cff2 ? 513 : 48;
      if (operands.length >= maximum) {
        throw cffUnsupported(`${label} exceeds the ${maximum}-operand DICT stack.`,
          "cff-dict-stack");
      }
      operands.push(number.value);
      continue;
    }
    offset += 1;
    let operator = byte;
    if (byte === 12) {
      if (offset >= bytes.length) {
        throw cffUnsupported(`${label} ends in a truncated escaped operator.`,
          "cff-dict-operator");
      }
      operator = dictOperator(12, bytes[offset++]);
    } else if (byte > 21 && !options.cff2) {
      throw cffUnsupported(`${label} contains reserved operator byte ${byte}.`,
        "cff-dict-operator");
    }
    if (!allowedOperators.has(operator)) {
      if (options.cff2) { operands.length = 0; continue; }
      throw cffUnsupported(`${label} contains unsupported operator ${formatDictOperator(operator)}.`,
        "cff-dict-operator");
    }
    if (!options.cff2 && operator === dictOperator(12, 24)) {
      if (!options.legacy || dictionary.size !== 0) throw cffUnsupported("A legacy CFF MM Top DICT must start with numMasters.", "cff-multiple-master-metadata");
      initializeCffLegacyMaster(operands, options.legacy);
    }
    if (options.cff2 && (operator === 22 || operator === 23)) {
      if (!options.variationStore) throw cffUnsupported("CFF2 DICT variation operators require a VariationStore.", "cff-variation-store");
      if (operator === 23) {
        blendCffOperands(operands, options.variationStore.getScalars(vsindex));
        sawBlend = true;
        continue;
      }
      if (sawBlend || operands.length !== 1) throw cffUnsupported("CFF2 DICT vsindex must precede blend and have one operand.", "cff-variation-store");
      vsindex = operands[0];
      options.variationStore.getScalars(vsindex);
    }
    if (dictionary.has(operator)) {
      throw cffUnsupported(`${label} repeats operator ${formatDictOperator(operator)}.`,
        "cff-dict-duplicate-operator");
    }
    dictionary.set(operator, Object.freeze(operands.splice(0)));
  }
  if (operands.length !== 0) {
    throw cffUnsupported(`${label} ends with operands without an operator.`,
      "cff-dict-trailing-operands");
  }
  return dictionary;
}

function cloneCffLegacyState(state: CffLegacyMasterState): CffLegacyMasterState {
  return { ...state, registers: state.registers.map(values => values.slice()), buildChar: new Map(state.buildChar) };
}

function runCffLegacyProgram(bytes: Uint8Array, operands: readonly number[], context: CffLegacyContext): { readonly operands: readonly number[]; readonly consumed: number } {
  return new Type2Interpreter({ glyphId: -1, charString: bytes, localSubrs: [], globalSubrs: context.globalSubrs,
    defaultWidthX: 0, nominalWidthX: 0, initialRandomSeed: 0, limits: context.limits, budget: context.budget,
    legacyMasterState: context.state, metadataProgram: true, initialOperands: operands }).runMetadata();
}

function initializeCffLegacyMaster(operands: readonly number[], context: CffLegacyContext): void {
  // Adobe's historical CFF reader and dictops.h define this first Top DICT
  // entry as nMasters UDV... lenBuildCharArray NDV-SID CDV-SID (12 24).
  // https://github.com/adobe-type-tools/afdko/blob/develop/c/shared/cffread.c
  const axisCount = operands.length - 4, masterCount = operands[0];
  if (!Number.isSafeInteger(masterCount) || masterCount < 1 || masterCount > 16 || axisCount < 1 || axisCount > 15) {
    throw cffUnsupported("Legacy CFF Multiple Master counts are outside the format's master/axis ranges.", "cff-multiple-master-metadata");
  }
  const buildCharLength = requireNonnegativeInteger(operands[axisCount + 1], "Legacy CFF BuildCharArray length");
  const user = context.options.legacyDesignVector ?? operands.slice(1, axisCount + 1);
  if (user.length !== axisCount || user.some(value => !Number.isFinite(value))) throw cffUnsupported("The legacy CFF user design vector is invalid.", "cff-multiple-master-metadata");
  const state: CffLegacyMasterState = { masterCount, axisCount, buildCharLength, buildChar: new Map(),
    registers: [Array<number>(16).fill(0), Array<number>(15).fill(0), Array<number>(15).fill(0)] };
  state.registers[2].splice(0, user.length, ...user);
  context.state = state;
  const override = context.options.legacyWeightVector;
  if (override) {
    if (override.length !== masterCount || override.some(value => !Number.isFinite(value))) throw cffUnsupported("The legacy CFF master weight vector is invalid.", "cff-multiple-master-metadata");
    state.registers[0].splice(0, masterCount, ...override);
    return;
  }
  let remaining: readonly number[] = [];
  for (const sid of operands.slice(-2)) {
    if (!Number.isSafeInteger(sid) || sid < CFF_STANDARD_STRINGS.length) throw cffUnsupported("Legacy CFF NDV/CDV requires a String INDEX program SID.", "cff-multiple-master-metadata");
    const program = Uint8Array.from(resolveCffTextSid(sid, context.strings), char => char.charCodeAt(0));
    remaining = runCffLegacyProgram(program, remaining, context).operands;
  }
  if (remaining.length !== 0) throw cffUnsupported("Legacy CFF NDV/CDV leaves unused operands.", "cff-multiple-master-metadata");
}

function readCffPrivateDictionary(
  reader: CffReader,
  dictionary: CffDictionary,
  fontMatrix: CffMatrix,
  options: CffDictOptions = {}
): CffFontDictionary {
  const operands = dictionary.get(dictOperator(18));
  if (!operands || operands.length !== 2) {
    throw cffUnsupported("The CFF font has no valid Private DICT range.", "cff-private-range");
  }
  const size = requireNonnegativeInteger(operands[0], "CFF Private DICT size");
  const offset = requireNonnegativeInteger(operands[1], "CFF Private DICT offset");
  const privateDictionary = parseCffDict(
    reader.slice(offset, size, "Private DICT"), "Private DICT",
    options.cff2 ? CFF2_PRIVATE_DICT_OPERATORS : PRIVATE_DICT_OPERATORS, options
  );
  const subrs = privateDictionary.get(dictOperator(19));
  let localSubrs: readonly Uint8Array[] = Object.freeze([]);
  if (subrs) {
    if (subrs.length !== 1) {
      throw cffUnsupported("The CFF Private DICT /Subrs offset is invalid.", "cff-local-subrs-offset");
    }
    const relativeOffset = requireNonnegativeInteger(subrs[0], "CFF local Subrs offset");
    const absoluteOffset = checkedAdd(offset, relativeOffset, "CFF local Subrs offset");
    localSubrs = reader.readIndex(absoluteOffset, "Local Subrs INDEX").objects;
  }
  return Object.freeze({
    localSubrs,
    defaultWidthX: readOptionalSingleton(privateDictionary, dictOperator(20), 0, "defaultWidthX"),
    nominalWidthX: readOptionalSingleton(privateDictionary, dictOperator(21), 0, "nominalWidthX"),
    initialRandomSeed: readOptionalSingleton(privateDictionary, dictOperator(12, 19), 0, "initialRandomSeed"),
    fontMatrix,
    paintType: options.cff2 ? 0 : readCffPaintValue(dictionary, options.paintDictionary, dictOperator(12, 5), 0),
    strokeWidth: options.cff2 ? 0 : readCffPaintValue(dictionary, options.paintDictionary, dictOperator(12, 8), 0),
    vsindex: readOptionalSingleton(privateDictionary, 22, 0, "vsindex")
  });
}

function readCffPaintValue(dictionary: CffDictionary, parent: CffDictionary | undefined, operator: number, fallback: number): number {
  const values = dictionary.get(operator) ?? parent?.get(operator);
  return values === undefined ? fallback : values.length === 1 && Number.isFinite(values[0]) ? values[0] : NaN;
}

function readCffFontMatrix(dictionary: CffDictionary): CffMatrix {
  return validateCffFontMatrix(dictionary.get(dictOperator(12, 7)) ?? [0.001, 0, 0, 0.001, 0, 0]);
}

function validateCffFontMatrix(values: readonly number[]): CffMatrix {
  if (values.length !== 6 || values.some(value => !Number.isFinite(value))) {
    throw cffUnsupported("The CFF FontMatrix is invalid.", "cff-font-matrix");
  }
  const determinant = values[0] * values[3] - values[1] * values[2];
  if (!Number.isFinite(determinant) || determinant === 0) {
    throw cffUnsupported("The CFF FontMatrix is singular.", "cff-font-matrix");
  }
  return Object.freeze(values.slice()) as unknown as CffMatrix;
}

function multiplyCffMatrices(parent: CffMatrix, child: CffMatrix): CffMatrix {
  return validateCffFontMatrix([
    parent[0] * child[0] + parent[2] * child[1],
    parent[1] * child[0] + parent[3] * child[1],
    parent[0] * child[2] + parent[2] * child[3],
    parent[1] * child[2] + parent[3] * child[3],
    parent[0] * child[4] + parent[2] * child[5] + parent[4],
    parent[1] * child[4] + parent[3] * child[5] + parent[5]
  ]);
}

// Adobe Technical Note #5176, sections 18–19. Select the Private DICT by
// GID, independently of the charset's CID mapping and the PDF's text CMap.
function readCffFdSelect(
  reader: CffReader,
  offset: number,
  glyphCount: number,
  dictionaryCount: number,
  cff2 = false
): Uint16Array {
  const format = reader.u8(offset++, "FDSelect format");
  const selected = new Uint16Array(glyphCount);
  const validateIndex = (index: number): number => {
    if (index >= dictionaryCount) {
      throw cffUnsupported("CFF FDSelect references a missing Font DICT.", "cff-fd-index");
    }
    return index;
  };
  if (format === 0) {
    for (let glyph = 0; glyph < glyphCount; glyph += 1) {
      selected[glyph] = validateIndex(reader.u8(offset++, "FDSelect entry"));
    }
  } else if (format === 3 || (cff2 && format === 4)) {
    const wide = format === 4;
    const glyphSize = wide ? 4 : 2;
    const readGlyph = (at: number, label: string): number => wide ? reader.u32(at, label) : reader.u16(at, label);
    const count = readGlyph(offset, "FDSelect range count");
    offset += glyphSize;
    if (count === 0 || count > glyphCount) {
      throw cffUnsupported("CFF FDSelect has an invalid range count.", "cff-fd-ranges");
    }
    let first = readGlyph(offset, "FDSelect first glyph");
    offset += glyphSize;
    if (first !== 0) {
      throw cffUnsupported("CFF FDSelect must start at glyph zero.", "cff-fd-ranges");
    }
    for (let range = 0; range < count; range += 1) {
      const index = validateIndex(wide ? reader.u16(offset, "FDSelect Font DICT") : reader.u8(offset, "FDSelect Font DICT"));
      offset += wide ? 2 : 1;
      const next = readGlyph(offset, "FDSelect next glyph or sentinel");
      offset += glyphSize;
      if (next <= first || next > glyphCount || (range === count - 1 && next !== glyphCount)) {
        throw cffUnsupported("CFF FDSelect ranges or sentinel are invalid.", "cff-fd-ranges");
      }
      selected.fill(index, first, next);
      first = next;
    }
  } else {
    throw cffUnsupported(`CFF FDSelect format ${format} is not supported.`, "cff-fd-format");
  }
  return selected;
}

function readCffCharset(
  reader: CffReader,
  charsetOffset: number,
  glyphCount: number,
  customStrings: readonly string[]
): readonly string[] {
  if (charsetOffset === 0) {
    // ISOAdobe charset is exactly SIDs 0 through 228 in GID order.
    if (glyphCount > 229) {
      throw cffUnsupported("The predefined ISOAdobe charset is shorter than the CharStrings INDEX.",
        "cff-charset-length");
    }
    return Object.freeze(CFF_STANDARD_STRINGS.slice(0, glyphCount));
  }
  if (charsetOffset === 1 || charsetOffset === 2) {
    const charset = charsetOffset === 1 ? CFF_EXPERT_CHARSET : CFF_EXPERT_SUBSET_CHARSET;
    if (glyphCount > charset.length) {
      throw cffUnsupported("The predefined Expert charset is shorter than the CharStrings INDEX.",
        "cff-charset-length");
    }
    return Object.freeze(charset.slice(0, glyphCount));
  }
  return Object.freeze(readCffCharsetValues(reader, charsetOffset, glyphCount)
    .map(sid => resolveCffSid(sid, customStrings)));
}

function readCffCharsetValues(
  reader: CffReader,
  charsetOffset: number,
  glyphCount: number
): readonly number[] {
  const format = reader.u8(charsetOffset, "CFF charset");
  let offset = charsetOffset + 1;
  const values = [0];
  if (format === 0) {
    while (values.length < glyphCount) {
      values.push(reader.u16(offset, "CFF format 0 charset"));
      offset += 2;
    }
  } else if (format === 1 || format === 2) {
    while (values.length < glyphCount) {
      const first = reader.u16(offset, `CFF format ${format} charset`);
      offset += 2;
      const left = format === 1
        ? reader.u8(offset++, "CFF format 1 charset")
        : reader.u16(offset, "CFF format 2 charset");
      if (format === 2) offset += 2;
      if (left + 1 > glyphCount - values.length || first + left > 65535) {
        throw cffUnsupported("A CFF charset range exceeds its glyph or character bounds.",
          "cff-charset-length");
      }
      for (let delta = 0; delta <= left; delta += 1) values.push(first + delta);
    }
  } else {
    throw cffUnsupported(`CFF charset format ${format} is not supported.`, "cff-charset-format");
  }
  return Object.freeze(values);
}

function readCffEncoding(
  reader: CffReader,
  encodingOffset: number,
  glyphNames: readonly string[],
  glyphIds: ReadonlyMap<string, number>,
  customStrings: readonly string[]
): readonly (string | null)[] {
  const names = new Array<string | null>(256).fill(null);
  if (encodingOffset === 0) {
    for (let code = 0; code < names.length; code += 1) {
      const name = standardEncodingGlyphName(code);
      if (name !== null && glyphIds.has(name)) names[code] = name;
    }
    return Object.freeze(names);
  }
  if (encodingOffset === 1) {
    return Object.freeze(CFF_EXPERT_ENCODING.map(name => name !== null && glyphIds.has(name) ? name : null));
  }
  const rawFormat = reader.u8(encodingOffset, "CFF Encoding");
  const hasSupplements = (rawFormat & 0x80) !== 0;
  const format = rawFormat & 0x7f;
  let offset = encodingOffset + 1;
  let glyphId = 1;
  const assign = (code: number, name: string): void => {
    if (code < 0 || code > 255 || names[code] !== null) {
      throw cffUnsupported("The CFF Encoding assigns a character code more than once.",
        "cff-encoding-code");
    }
    names[code] = name;
  };
  if (format === 0) {
    const codeCount = reader.u8(offset++, "CFF format 0 Encoding");
    if (codeCount > glyphNames.length - 1) {
      throw cffUnsupported("The CFF Encoding exceeds the charset.", "cff-encoding-length");
    }
    for (let index = 0; index < codeCount; index += 1) {
      assign(reader.u8(offset++, "CFF format 0 Encoding"), glyphNames[glyphId++]);
    }
  } else if (format === 1) {
    const rangeCount = reader.u8(offset++, "CFF format 1 Encoding");
    for (let rangeIndex = 0; rangeIndex < rangeCount; rangeIndex += 1) {
      const firstCode = reader.u8(offset++, "CFF format 1 Encoding");
      const left = reader.u8(offset++, "CFF format 1 Encoding");
      if (left + 1 > glyphNames.length - glyphId || firstCode + left > 255) {
        throw cffUnsupported("A CFF Encoding range exceeds the charset or byte code space.",
          "cff-encoding-length");
      }
      for (let delta = 0; delta <= left; delta += 1) {
        assign(firstCode + delta, glyphNames[glyphId++]);
      }
    }
  } else {
    throw cffUnsupported(`CFF Encoding format ${format} is not supported.`,
      "cff-encoding-format");
  }
  if (hasSupplements) {
    const supplementCount = reader.u8(offset++, "CFF Encoding supplements");
    for (let index = 0; index < supplementCount; index += 1) {
      const code = reader.u8(offset++, "CFF Encoding supplement");
      const sid = reader.u16(offset, "CFF Encoding supplement");
      offset += 2;
      const name = resolveCffSid(sid, customStrings);
      if (!glyphIds.has(name)) {
        throw cffUnsupported("A CFF Encoding supplement references a glyph outside the charset.",
          "cff-encoding-supplement");
      }
      assign(code, name);
    }
  }
  return Object.freeze(names);
}

function standardEncodingGlyphName(code: number): string | null {
  if (!Number.isSafeInteger(code) || code < 0 || code > 255) return null;
  if (code >= 32 && code <= 126) {
    if (code === 39) return "quoteright";
    if (code === 96) return "quoteleft";
    // Standard-string SIDs 1–95 correspond to byte codes 32–126.
    return CFF_STANDARD_STRINGS[code - 31] ?? null;
  }
  return STANDARD_ENCODING_HIGH[code] ?? null;
}

const STANDARD_ENCODING_HIGH: Readonly<Record<number, string>> = Object.freeze({
  161: "exclamdown", 162: "cent", 163: "sterling", 164: "fraction", 165: "yen",
  166: "florin", 167: "section", 168: "currency", 169: "quotesingle",
  170: "quotedblleft", 171: "guillemotleft", 172: "guilsinglleft",
  173: "guilsinglright", 174: "fi", 175: "fl", 177: "endash", 178: "dagger",
  179: "daggerdbl", 180: "periodcentered", 182: "paragraph", 183: "bullet",
  184: "quotesinglbase", 185: "quotedblbase", 186: "quotedblright",
  187: "guillemotright", 188: "ellipsis", 189: "perthousand", 191: "questiondown",
  193: "grave", 194: "acute", 195: "circumflex", 196: "tilde", 197: "macron",
  198: "breve", 199: "dotaccent", 200: "dieresis", 202: "ring", 203: "cedilla",
  205: "hungarumlaut", 206: "ogonek", 207: "caron", 208: "emdash", 225: "AE",
  227: "ordfeminine", 232: "Lslash", 233: "Oslash", 234: "OE", 235: "ordmasculine",
  241: "ae", 245: "dotlessi", 248: "lslash", 249: "oslash", 250: "oe",
  251: "germandbls"
});

function transformCommand(
  command: NativeGlyphPathCommand,
  matrix: readonly [number, number, number, number, number, number]
): NativeGlyphPathCommand {
  if (command.kind === "close") return command;
  if (command.kind === "move" || command.kind === "line") {
    const [x, y] = transformCffPoint(command.x, command.y, matrix);
    return { kind: command.kind, x, y };
  }
  if (command.kind === "quadratic") {
    const [controlX, controlY] = transformCffPoint(command.controlX, command.controlY, matrix);
    const [x, y] = transformCffPoint(command.x, command.y, matrix);
    return { kind: "quadratic", controlX, controlY, x, y };
  }
  const [control1X, control1Y] = transformCffPoint(command.control1X, command.control1Y, matrix);
  const [control2X, control2Y] = transformCffPoint(command.control2X, command.control2Y, matrix);
  const [x, y] = transformCffPoint(command.x, command.y, matrix);
  return { kind: "cubic", control1X, control1Y, control2X, control2Y, x, y };
}

function translateCommand(
  command: NativeGlyphPathCommand,
  offsetX: number,
  offsetY: number
): NativeGlyphPathCommand {
  if (command.kind === "close") return command;
  if (command.kind === "move" || command.kind === "line") {
    return { kind: command.kind, x: command.x + offsetX, y: command.y + offsetY };
  }
  if (command.kind === "quadratic") {
    return {
      kind: "quadratic",
      controlX: command.controlX + offsetX,
      controlY: command.controlY + offsetY,
      x: command.x + offsetX,
      y: command.y + offsetY
    };
  }
  return {
    kind: "cubic",
    control1X: command.control1X + offsetX,
    control1Y: command.control1Y + offsetY,
    control2X: command.control2X + offsetX,
    control2Y: command.control2Y + offsetY,
    x: command.x + offsetX,
    y: command.y + offsetY
  };
}

function transformCffPoint(
  x: number,
  y: number,
  matrix: readonly [number, number, number, number, number, number]
): readonly [number, number] {
  // Normalize FontMatrix into the retained 1000-unit ABI before applying it.
  // Apart from making that convention explicit, this keeps the ubiquitous
  // 0.001 matrix numerically identity instead of introducing avoidable
  // 350.00000000000006-style coordinate noise.
  return [
    finiteResult(matrix[0] * 1000 * x + matrix[2] * 1000 * y + matrix[4] * 1000,
      "CFF transformed x coordinate"),
    finiteResult(matrix[1] * 1000 * x + matrix[3] * 1000 * y + matrix[5] * 1000,
      "CFF transformed y coordinate")
  ];
}

function transformWidth(
  width: number,
  matrix: readonly [number, number, number, number, number, number],
  advanceY = 0
): number {
  return finiteResult((matrix[0] * width + matrix[2] * advanceY) * 1000, "CFF transformed glyph width");
}

function measureCommands(
  commands: readonly NativeGlyphPathCommand[]
): readonly [number, number, number, number] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  const include = (pointX: number, pointY: number): void => {
    minX = Math.min(minX, pointX);
    minY = Math.min(minY, pointY);
    maxX = Math.max(maxX, pointX);
    maxY = Math.max(maxY, pointY);
  };
  for (const command of commands) {
    if (command.kind === "move") {
      x = startX = command.x;
      y = startY = command.y;
      include(x, y);
    } else if (command.kind === "line") {
      include(x, y);
      include(command.x, command.y);
      x = command.x;
      y = command.y;
    } else if (command.kind === "quadratic") {
      includeQuadraticBounds(x, command.controlX, command.x, (value) => include(value, y));
      includeQuadraticBounds(y, command.controlY, command.y, (value) => include(x, value));
      include(x, y);
      include(command.x, command.y);
      x = command.x;
      y = command.y;
    } else if (command.kind === "cubic") {
      include(x, y);
      include(command.x, command.y);
      for (const t of cubicExtrema(x, command.control1X, command.control2X, command.x)) {
        include(cubicAt(x, command.control1X, command.control2X, command.x, t),
          cubicAt(y, command.control1Y, command.control2Y, command.y, t));
      }
      for (const t of cubicExtrema(y, command.control1Y, command.control2Y, command.y)) {
        include(cubicAt(x, command.control1X, command.control2X, command.x, t),
          cubicAt(y, command.control1Y, command.control2Y, command.y, t));
      }
      x = command.x;
      y = command.y;
    } else {
      include(startX, startY);
      x = startX;
      y = startY;
    }
  }
  if (minX === Number.POSITIVE_INFINITY) return Object.freeze([0, 0, 0, 0]);
  return Object.freeze([minX, minY, maxX, maxY]);
}

function includeQuadraticBounds(
  start: number,
  control: number,
  end: number,
  include: (value: number) => void
): void {
  const denominator = start - 2 * control + end;
  if (denominator === 0) return;
  const t = (start - control) / denominator;
  if (t > 0 && t < 1) include((1 - t) ** 2 * start + 2 * (1 - t) * t * control + t ** 2 * end);
}

function cubicExtrema(start: number, first: number, second: number, end: number): number[] {
  // Normalize before differencing so finite controls cannot overflow the
  // derivative coefficients merely because the glyph coordinates are large.
  const scale = Math.max(Math.abs(start), Math.abs(first), Math.abs(second), Math.abs(end), 1);
  start /= scale;
  first /= scale;
  second /= scale;
  end /= scale;
  const a = -start + 3 * first - 3 * second + end;
  const b = 2 * (start - 2 * first + second);
  const c = first - start;
  if (a === 0) {
    if (b === 0) return [];
    const root = -c / b;
    return root > 0 && root < 1 ? [root] : [];
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  // FontMatrix rounding can leave a tiny cubic coefficient in a nominally
  // quadratic curve. Stable quadratic roots retain its interior extremum.
  const q = -0.5 * (b + (b < 0 ? -root : root));
  const firstRoot = q === 0 ? 0 : q / a;
  const secondRoot = q === 0 ? 0 : c / q;
  return [firstRoot, secondRoot].filter((value, index, values) =>
    value > 0 && value < 1 && (index === 0 || Math.abs(value - values[0]) > 1e-12)
  );
}

function cubicAt(start: number, first: number, second: number, end: number, t: number): number {
  const inverse = 1 - t;
  return inverse ** 3 * start + 3 * inverse ** 2 * t * first +
    3 * inverse * t ** 2 * second + t ** 3 * end;
}

function readCffDictNumber(
  bytes: Uint8Array,
  offset: number
): { readonly value: number; readonly next: number } {
  const first = bytes[offset];
  if (first >= 32 && first <= 246) return { value: first - 139, next: offset + 1 };
  if (first >= 247 && first <= 250) {
    requireByteRange(bytes, offset, 2, "CFF DICT number");
    return { value: (first - 247) * 256 + bytes[offset + 1] + 108, next: offset + 2 };
  }
  if (first >= 251 && first <= 254) {
    requireByteRange(bytes, offset, 2, "CFF DICT number");
    return { value: -(first - 251) * 256 - bytes[offset + 1] - 108, next: offset + 2 };
  }
  if (first === 28) {
    requireByteRange(bytes, offset, 3, "CFF DICT short integer");
    let value = bytes[offset + 1] * 256 + bytes[offset + 2];
    if (value & 0x8000) value -= 0x10000;
    return { value, next: offset + 3 };
  }
  if (first === 29) {
    requireByteRange(bytes, offset, 5, "CFF DICT long integer");
    const unsigned = bytes[offset + 1] * 0x1000000 + bytes[offset + 2] * 0x10000 +
      bytes[offset + 3] * 0x100 + bytes[offset + 4];
    return { value: unsigned >= 0x80000000 ? unsigned - 0x100000000 : unsigned, next: offset + 5 };
  }
  if (first === 30) return readCffReal(bytes, offset);
  throw cffUnsupported("A CFF DICT number uses a reserved encoding.", "cff-dict-number");
}

function readCffReal(
  bytes: Uint8Array,
  offset: number
): { readonly value: number; readonly next: number } {
  let text = "";
  let position = offset + 1;
  let ended = false;
  while (position < bytes.length && !ended) {
    const byte = bytes[position++];
    for (const nibble of [byte >>> 4, byte & 0x0f]) {
      if (nibble <= 9) text += String(nibble);
      else if (nibble === 0x0a) text += ".";
      else if (nibble === 0x0b) text += "E";
      else if (nibble === 0x0c) text += "E-";
      else if (nibble === 0x0e) text += "-";
      else if (nibble === 0x0f) { ended = true; break; }
      else throw cffUnsupported("A CFF real number contains a reserved nibble.",
        "cff-dict-real");
    }
  }
  const value = Number(text);
  if (!ended || text.length === 0 || !Number.isFinite(value)) {
    throw cffUnsupported("A CFF real number is malformed or truncated.", "cff-dict-real");
  }
  return { value, next: position };
}

function readType2Number(
  bytes: Uint8Array,
  offset: number
): { readonly value: number; readonly next: number } {
  const first = bytes[offset];
  if (first >= 32 && first <= 246) return { value: first - 139, next: offset + 1 };
  if (first >= 247 && first <= 250) {
    requireByteRange(bytes, offset, 2, "Type 2 number");
    return { value: (first - 247) * 256 + bytes[offset + 1] + 108, next: offset + 2 };
  }
  if (first >= 251 && first <= 254) {
    requireByteRange(bytes, offset, 2, "Type 2 number");
    return { value: -(first - 251) * 256 - bytes[offset + 1] - 108, next: offset + 2 };
  }
  if (first === 28) {
    requireByteRange(bytes, offset, 3, "Type 2 short integer");
    let value = bytes[offset + 1] * 256 + bytes[offset + 2];
    if (value & 0x8000) value -= 0x10000;
    return { value, next: offset + 3 };
  }
  if (first === 255) {
    requireByteRange(bytes, offset, 5, "Type 2 fixed number");
    const unsigned = bytes[offset + 1] * 0x1000000 + bytes[offset + 2] * 0x10000 +
      bytes[offset + 3] * 0x100 + bytes[offset + 4];
    const signed = unsigned >= 0x80000000 ? unsigned - 0x100000000 : unsigned;
    return { value: signed / 65536, next: offset + 5 };
  }
  throw cffUnsupported("A Type 2 number uses a reserved encoding.", "type2-number");
}

function isCffDictNumberByte(byte: number): boolean {
  return byte === 28 || byte === 29 || byte === 30 || (byte >= 32 && byte <= 254);
}

function isType2NumberByte(byte: number): boolean {
  return byte === 28 || byte === 255 || (byte >= 32 && byte <= 254);
}

function readRequiredOffset(dictionary: CffDictionary, operator: number, label: string): number {
  const values = dictionary.get(operator);
  if (!values || values.length !== 1) {
    throw cffUnsupported(`The CFF Top DICT has no valid ${label} offset.`,
      "cff-required-offset");
  }
  return requireNonnegativeInteger(values[0], `CFF ${label} offset`);
}

function readOptionalOffset(
  dictionary: CffDictionary,
  operator: number,
  fallback: number,
  label: string
): number {
  const values = dictionary.get(operator);
  if (!values) return fallback;
  if (values.length !== 1) {
    throw cffUnsupported(`The CFF ${label} offset is invalid.`, "cff-offset");
  }
  return requireNonnegativeInteger(values[0], `CFF ${label} offset`);
}

function readOptionalSingleton(
  dictionary: CffDictionary,
  operator: number,
  fallback: number,
  label: string
): number {
  const values = dictionary.get(operator);
  if (!values) return fallback;
  if (values.length !== 1 || !Number.isFinite(values[0])) {
    throw cffUnsupported(`The CFF ${label} value is invalid.`, "cff-dict-value");
  }
  return values[0];
}

function resolveCffSid(sid: number, customStrings: readonly string[]): string {
  if (!Number.isSafeInteger(sid) || sid < 0 || sid > 64_999) {
    throw cffUnsupported("A CFF charset SID is outside the valid range.", "cff-charset-sid");
  }
  if (sid < CFF_STANDARD_STRINGS.length) return CFF_STANDARD_STRINGS[sid];
  const custom = customStrings[sid - CFF_STANDARD_STRINGS.length];
  if (custom === undefined) {
    throw cffUnsupported("A CFF charset SID is outside the String INDEX.", "cff-charset-sid");
  }
  return validateCffGlyphName(custom, "CFF charset glyph name");
}

function resolveCffTextSid(sid: number, customStrings: readonly string[]): string {
  if (!Number.isSafeInteger(sid) || sid < 0 || sid > 64_999) throw cffUnsupported("A CFF text SID is invalid.", "cff-string-sid");
  const text = sid < CFF_STANDARD_STRINGS.length ? CFF_STANDARD_STRINGS[sid] : customStrings[sid - CFF_STANDARD_STRINGS.length];
  if (text === undefined) throw cffUnsupported("A CFF text SID is outside the String INDEX.", "cff-string-sid");
  return text;
}

function readCffName(bytes: Uint8Array, label: string): string {
  if (bytes.length === 0 || bytes.length > 127) {
    throw cffUnsupported(`${label} has an invalid length.`, "cff-name");
  }
  let result = "";
  for (const byte of bytes) {
    if (byte < 33 || byte > 126 || byte === 0x28 || byte === 0x29 || byte === 0x3c ||
        byte === 0x3e || byte === 0x5b || byte === 0x5d || byte === 0x7b || byte === 0x7d ||
        byte === 0x2f || byte === 0x25) {
      throw cffUnsupported(`${label} contains an invalid PostScript name byte.`, "cff-name");
    }
    result += String.fromCharCode(byte);
  }
  return result;
}

/**
 * The CFF specification calls for ASCII strings, but producers routinely put
 * Latin-1 text such as a copyright sign into Notice or FullName. Strings that
 * name glyphs are validated where they are used as names.
 */
function readCffString(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += String.fromCharCode(byte);
  return result;
}

function validateCffGlyphName(value: string, label: string): string {
  if (value.length === 0 || value.length > 127 || /[\s()[\]{}<>\/%]/.test(value)) {
    throw cffUnsupported(`${label} is not a valid PostScript name.`, "cff-name");
  }
  return value;
}

function dictOperator(first: number, second?: number): number {
  return second === undefined ? first : 0x0c00 | second;
}

function formatDictOperator(operator: number): string {
  return operator >= 0x0c00 ? `12 ${operator & 0xff}` : String(operator);
}

function type2SubrBias(count: number): number {
  return count < 1_240 ? 107 : count < 33_900 ? 1_131 : 32_768;
}

function requireNonnegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw cffUnsupported(`${label} is not a nonnegative integer.`, "cff-integer");
  }
  return value;
}

function finiteResult(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw cffUnsupported(`${label} is not finite.`, "cff-numeric-overflow");
  }
  return Object.is(value, -0) ? 0 : value;
}

function requireByteRange(bytes: Uint8Array, offset: number, length: number, label: string): void {
  if (!rangeFits(offset, length, bytes.length)) {
    throw cffUnsupported(`${label} is truncated.`, "cff-bounds");
  }
}

function checkedAdd(left: number, right: number, label: string): number {
  if (
    !Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0 ||
    left > Number.MAX_SAFE_INTEGER - right
  ) {
    throw cffUnsupported(`${label} arithmetic overflows.`, "cff-arithmetic-overflow");
  }
  return left + right;
}

function checkedMultiply(left: number, right: number, label: string): number {
  if (
    !Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0 ||
    (left !== 0 && right > Math.floor(Number.MAX_SAFE_INTEGER / left))
  ) {
    throw cffUnsupported(`${label} arithmetic overflows.`, "cff-arithmetic-overflow");
  }
  return left * right;
}

function rangeFits(offset: number, length: number, total: number): boolean {
  return Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(length) && length >= 0 &&
    Number.isSafeInteger(total) && total >= 0 && offset <= total && length <= total - offset;
}

function mergeCffLimits(
  overrides: Partial<NativeCffParserLimits>
): Readonly<NativeCffParserLimits> {
  const defaults = DEFAULT_NATIVE_CFF_PARSER_LIMITS;
  const bounded = <K extends keyof NativeCffParserLimits>(key: K): number => {
    const value = overrides[key] ?? defaults[key];
    if (!Number.isSafeInteger(value) || value <= 0 || value > defaults[key]) {
      throw new RangeError(`${key} must be a positive safe integer no greater than ${defaults[key]}.`);
    }
    return value;
  };
  return Object.freeze({
    maxCffBytes: bounded("maxCffBytes"),
    maxCffIndexEntries: bounded("maxCffIndexEntries"),
    maxCffStringBytes: bounded("maxCffStringBytes"),
    maxType2CharStringBytes: bounded("maxType2CharStringBytes"),
    maxType2Operators: bounded("maxType2Operators"),
    maxType2SubrDepth: bounded("maxType2SubrDepth"),
    maxType2SubrCalls: bounded("maxType2SubrCalls"),
    maxType2PathCommands: bounded("maxType2PathCommands"),
    maxCffPostScriptOperations: bounded("maxCffPostScriptOperations"),
    maxCffPostScriptStack: bounded("maxCffPostScriptStack")
  });
}

function cffUnsupported(message: string, reason: string): PdfError {
  return new PdfError("unsupported-font", message, { details: { reason } });
}

function cffLimit(message: string, reason: string, limit: number): PdfError {
  return new PdfError("resource-limit", message, { details: { reason, limit } });
}
