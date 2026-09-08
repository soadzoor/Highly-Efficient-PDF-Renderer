import {
  isPdfDictionary,
  isPdfName,
  isPdfRef,
  isPdfStream,
  isPdfString,
  pdfRefKey,
  type PdfDictionary,
  type PdfStream,
  type PdfValue
} from "./nativeCos";
import { PdfError, throwIfAborted, type PdfDiagnostic } from "./nativeTypes";
import {
  zapfDingbatEncodingGlyphName,
  zapfDingbatGlyphNameToUnicode
} from "./nativeZapfDingbats";
import {
  nativeSymbolEncodingEntry,
  nativeSymbolGlyphNameEntry
} from "./nativeSymbolEncoding";
import {
  loadNativePredefinedCMap,
  type NativePredefinedCMapCidRange,
  type NativePredefinedCMapNotdefRange
} from "./nativeCMaps";
import {
  loadNativeCidToUnicode,
  nativeCidToUnicodeCollection,
  type NativeCidSystemInfo,
  type NativeCidToUnicodeShard
} from "./nativeCidUnicode";
import {
  nativeMacExpertEncodingEntry,
  nativeMacExpertGlyphNameEntry
} from "./nativeMacExpertEncoding";
import {
  nativeStandard14GlyphWidth,
  resolveNativeStandard14MetricFace
} from "./nativeStandard14Metrics";
import {
  DEFAULT_NATIVE_CFF_PARSER_LIMITS,
  NativeCffFont,
  type NativeCffParserLimits
} from "./nativeCff";

/** Minimal resolver surface needed by the font engine. */
export interface NativePdfFontResolver {
  resolveValue(value: PdfValue | undefined, signal?: AbortSignal): Promise<PdfValue | undefined>;
  decodeStream(stream: PdfStream, signal?: AbortSignal): Promise<Uint8Array>;
}

export type NativePdfFontSubtype =
  | "Type1"
  | "MMType1"
  | "TrueType"
  | "Type0"
  | "CIDFontType0"
  | "CIDFontType2"
  | "Type3";

export interface NativeCodeSpaceRange {
  readonly byteLength: number;
  readonly start: number;
  readonly end: number;
}

export interface NativeVerticalMetric {
  /** Vertical displacement in PDF glyph-space units (normally negative). */
  readonly advanceY: number;
  readonly originX: number;
  readonly originY: number;
}

/** One decoded PDF character. Glyph selection and Unicode are intentionally separate. */
export interface NativeMappedCharacter {
  readonly code: number;
  readonly codeByteLength: number;
  readonly cid: number;
  readonly glyphId: number;
  readonly glyphName: string | null;
  readonly unicode: string | null;
  /** Horizontal width in PDF glyph-space units (1000 units per em). */
  readonly width: number;
  readonly verticalMetric: NativeVerticalMetric | null;
}

export interface NativeFontDescriptor {
  readonly flags: number;
  readonly ascent: number;
  readonly descent: number;
  readonly missingWidth: number;
  readonly fontBBox: readonly [number, number, number, number] | null;
  readonly embeddedKind: "truetype" | "opentype" | "cff" | "cff2" | "type1" | null;
  readonly family: string | null;
  readonly stretch: string | null;
  readonly weight: number | null;
  readonly italicAngle: number;
  readonly capHeight: number | null;
  readonly xHeight: number | null;
  readonly stemV: number | null;
}

export interface NativeFontStyleMetadata {
  readonly family: string | null;
  readonly weight: number;
  readonly stretch: string | null;
  readonly italicAngle: number;
  readonly fixedPitch: boolean;
  readonly serif: boolean;
  readonly symbolic: boolean;
  readonly script: boolean;
  readonly italic: boolean;
  readonly allCaps: boolean;
  readonly smallCaps: boolean;
  readonly forceBold: boolean;
}

/** Immutable information supplied to a caller-owned deterministic resolver. */
export interface NativeMissingFontRequest {
  readonly baseFont: string;
  readonly normalizedBaseFont: string;
  readonly subtype: NativePdfFontSubtype;
  readonly descendantSubtype: "CIDFontType0" | "CIDFontType2" | null;
  readonly writingMode: 0 | 1;
  readonly descriptor: Readonly<NativeFontDescriptor>;
  readonly style: Readonly<NativeFontStyleMetadata>;
}

export interface NativeMissingFontResult {
  /** Complete sfnt or TrueType Collection bytes. Ownership remains with the caller. */
  readonly sfntBytes: Uint8Array;
  /** Face in a TrueType Collection. @default 0 */
  readonly faceIndex?: number;
  /** Stable caller-defined asset identifier. A deterministic byte fingerprint is used when omitted. */
  readonly identifier?: string;
}

export type NativeMissingFontResolution = Uint8Array | NativeMissingFontResult;

export type NativeMissingFontResolver = (
  request: Readonly<NativeMissingFontRequest>,
  signal?: AbortSignal
) => NativeMissingFontResolution | null | Promise<NativeMissingFontResolution | null>;

export interface NativeFontSubstitution {
  readonly kind: "caller-sfnt";
  readonly requestedBaseFont: string;
  readonly normalizedBaseFont: string;
  readonly requestedSubtype: NativePdfFontSubtype;
  readonly descendantSubtype: "CIDFontType0" | "CIDFontType2" | null;
  readonly identifier: string;
  readonly faceIndex: number;
  readonly byteLength: number;
  readonly outlineFormat: "glyf";
}

export interface ParseNativePdfFontOptions {
  readonly signal?: AbortSignal;
  readonly missingFontResolver?: NativeMissingFontResolver;
  readonly onDiagnostic?: (diagnostic: Readonly<PdfDiagnostic>) => void;
  /** Parser ceilings may only lower the engine defaults. */
  readonly parserLimits?: Partial<NativePdfFontParserLimits>;
}

export interface NativeSfntParserLimits {
  readonly maxSfntFaces: number;
  readonly maxSfntTables: number;
  readonly maxSfntCmapRecords: number;
  readonly maxSfntCmapGroups: number;
  readonly maxGlyphPoints: number;
  readonly maxCompoundGlyphDepth: number;
  readonly maxCompoundGlyphComponents: number;
  readonly maxGlyphInstructionBytes: number;
}

export interface NativePdfFontParserLimits extends NativeSfntParserLimits, NativeCffParserLimits {
  readonly maxCMapBytes: number;
  readonly maxCMapMappings: number;
  readonly maxCMapTokens: number;
  readonly maxCodeSpaceRanges: number;
  readonly maxUseCMapDepth: number;
  readonly maxCidMetricEntries: number;
  readonly maxSimpleEncodingDifferences: number;
}

export type NativeGlyphPathCommand =
  | { readonly kind: "move"; readonly x: number; readonly y: number }
  | { readonly kind: "line"; readonly x: number; readonly y: number }
  | {
      readonly kind: "quadratic";
      readonly controlX: number;
      readonly controlY: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: "cubic";
      readonly control1X: number;
      readonly control1Y: number;
      readonly control2X: number;
      readonly control2Y: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly kind: "close" };

export interface NativeGlyphOutline {
  readonly glyphId: number;
  readonly commands: readonly NativeGlyphPathCommand[];
  readonly bounds: readonly [number, number, number, number];
  readonly advanceWidth: number;
  readonly leftSideBearing: number;
}

export interface NativePdfFont {
  readonly subtype: NativePdfFontSubtype;
  readonly baseFont: string;
  readonly writingMode: 0 | 1;
  readonly descriptor: NativeFontDescriptor;
  readonly style: NativeFontStyleMetadata;
  readonly unitsPerEm: number;
  readonly sfnt: NativeSfntFont | null;
  readonly cff: NativeCffFont | null;
  readonly substitution: NativeFontSubstitution | null;
  readonly diagnostics: readonly PdfDiagnostic[];
  decode(bytes: Uint8Array, offset?: number): NativeMappedCharacter;
  getGlyphOutline(glyphId: number): NativeGlyphOutline;
}

interface CMapEntry {
  readonly code: number;
  readonly byteLength: number;
}

interface ParsedCMap {
  readonly codeSpaces: readonly NativeCodeSpaceRange[];
  readonly unicode: ReadonlyMap<string, string>;
  readonly cids: ReadonlyMap<string, number>;
  /** Aggregate retained program bytes across the /UseCMap chain. */
  readonly sourceByteCount: number;
  /** Aggregate lexical tokens across the /UseCMap chain. */
  readonly tokenCount: number;
  /** Aggregate mapping operations, including locally overridden entries. */
  readonly mappingOperationCount: number;
  /** Predefined CMap range layers, ordered from base to most-local. */
  readonly cidRangeLayers: readonly CMapCidRangeLayer[];
  readonly cidRangeMappingCount: number;
  /** Undefined-code fallbacks, ordered from base to most-local. */
  readonly notdefRangeLayers: readonly CMapNotdefRangeLayer[];
  readonly notdefRangeMappingCount: number;
  readonly writingMode: 0 | 1;
  readonly writingModeExplicit: boolean;
  readonly identityBase: boolean;
  /** Effective registry/ordering and minimum supplement required by this encoding. */
  readonly systemInfo: Readonly<NativeCidSystemInfo> | null;
}

type CMapCidRangeLayer = readonly [
  readonly NativePredefinedCMapCidRange[],
  readonly NativePredefinedCMapCidRange[],
  readonly NativePredefinedCMapCidRange[],
  readonly NativePredefinedCMapCidRange[]
];

type CMapNotdefRangeLayer = readonly [
  readonly NativePredefinedCMapNotdefRange[],
  readonly NativePredefinedCMapNotdefRange[],
  readonly NativePredefinedCMapNotdefRange[],
  readonly NativePredefinedCMapNotdefRange[]
];

interface CMapResolutionStack {
  readonly refs: ReadonlySet<string>;
  readonly streams: ReadonlySet<PdfStream>;
  readonly names: ReadonlySet<string>;
  readonly depth: number;
}

const EMPTY_DESCRIPTOR: NativeFontDescriptor = Object.freeze({
  flags: 0,
  ascent: 800,
  descent: -200,
  missingWidth: 0,
  fontBBox: null,
  embeddedKind: null,
  family: null,
  stretch: null,
  weight: null,
  italicAngle: 0,
  capHeight: null,
  xHeight: null,
  stemV: null
});

const EMPTY_DIAGNOSTICS: readonly PdfDiagnostic[] = Object.freeze([]);

export const DEFAULT_NATIVE_PDF_FONT_PARSER_LIMITS: Readonly<NativePdfFontParserLimits> = Object.freeze({
  // These are aggregate limits across a /UseCMap chain. Keeping them below
  // the general decoded-stream ceiling bounds the object-heavy lexer/maps.
  maxCMapBytes: 16 * 1024 * 1024,
  maxCMapMappings: 262_144,
  maxCMapTokens: 1_048_576,
  maxCodeSpaceRanges: 4_096,
  maxUseCMapDepth: 64,
  // CID values and CID-keyed width/vertical metric tables are 16-bit spaces.
  maxCidMetricEntries: 65_536,
  // At most 256 codes can be assigned; a second 256 permits sparse resets.
  maxSimpleEncodingDifferences: 512,
  maxCffBytes: DEFAULT_NATIVE_CFF_PARSER_LIMITS.maxCffBytes,
  maxCffIndexEntries: DEFAULT_NATIVE_CFF_PARSER_LIMITS.maxCffIndexEntries,
  maxCffStringBytes: DEFAULT_NATIVE_CFF_PARSER_LIMITS.maxCffStringBytes,
  maxType2CharStringBytes: DEFAULT_NATIVE_CFF_PARSER_LIMITS.maxType2CharStringBytes,
  maxType2Operators: DEFAULT_NATIVE_CFF_PARSER_LIMITS.maxType2Operators,
  maxType2SubrDepth: DEFAULT_NATIVE_CFF_PARSER_LIMITS.maxType2SubrDepth,
  maxType2SubrCalls: DEFAULT_NATIVE_CFF_PARSER_LIMITS.maxType2SubrCalls,
  maxType2PathCommands: DEFAULT_NATIVE_CFF_PARSER_LIMITS.maxType2PathCommands,
  maxSfntFaces: 4_096,
  maxSfntTables: 4_096,
  maxSfntCmapRecords: 4_096,
  maxSfntCmapGroups: 1_000_000,
  maxGlyphPoints: 1_000_000,
  maxCompoundGlyphDepth: 32,
  maxCompoundGlyphComponents: 4_096,
  maxGlyphInstructionBytes: 16 * 1024 * 1024
});

export const DEFAULT_NATIVE_SFNT_PARSER_LIMITS: Readonly<NativeSfntParserLimits> =
  Object.freeze({
    maxSfntFaces: DEFAULT_NATIVE_PDF_FONT_PARSER_LIMITS.maxSfntFaces,
    maxSfntTables: DEFAULT_NATIVE_PDF_FONT_PARSER_LIMITS.maxSfntTables,
    maxSfntCmapRecords: DEFAULT_NATIVE_PDF_FONT_PARSER_LIMITS.maxSfntCmapRecords,
    maxSfntCmapGroups: DEFAULT_NATIVE_PDF_FONT_PARSER_LIMITS.maxSfntCmapGroups,
    maxGlyphPoints: DEFAULT_NATIVE_PDF_FONT_PARSER_LIMITS.maxGlyphPoints,
    maxCompoundGlyphDepth: DEFAULT_NATIVE_PDF_FONT_PARSER_LIMITS.maxCompoundGlyphDepth,
    maxCompoundGlyphComponents: DEFAULT_NATIVE_PDF_FONT_PARSER_LIMITS.maxCompoundGlyphComponents,
    maxGlyphInstructionBytes: DEFAULT_NATIVE_PDF_FONT_PARSER_LIMITS.maxGlyphInstructionBytes
  });

const MAX_CMAP_SOURCE_BYTES = 4;
// PDF ToUnicode mappings permit destination strings up to 512 bytes.
const MAX_CMAP_DESTINATION_BYTES = 512;
const MAX_CID = 0xffff;

/** Parse a ToUnicode CMap without coupling Unicode mapping to glyph selection. */
export function parseToUnicodeCMap(
  bytes: Uint8Array,
  options: {
    readonly maxBytes?: number;
    readonly maxMappings?: number;
    readonly maxTokens?: number;
    readonly maxCodeSpaceRanges?: number;
  } = {}
): {
  readonly codeSpaces: readonly NativeCodeSpaceRange[];
  readonly mappings: ReadonlyMap<string, string>;
  decode(bytes: Uint8Array, offset?: number): { code: number; byteLength: number; unicode: string | null };
} {
  const defaults = DEFAULT_NATIVE_PDF_FONT_PARSER_LIMITS;
  const parsed = parseCMap(bytes, {
    ...defaults,
    maxCMapBytes: boundedParserLimit(
      options.maxBytes,
      defaults.maxCMapBytes,
      "maxBytes"
    ),
    maxCMapMappings: boundedParserLimit(
      options.maxMappings,
      defaults.maxCMapMappings,
      "maxMappings"
    ),
    maxCMapTokens: boundedParserLimit(
      options.maxTokens,
      defaults.maxCMapTokens,
      "maxTokens"
    ),
    maxCodeSpaceRanges: boundedParserLimit(
      options.maxCodeSpaceRanges,
      defaults.maxCodeSpaceRanges,
      "maxCodeSpaceRanges"
    )
  });
  if (parsed.cids.size > 0 || parsed.cidRangeMappingCount > 0) {
    throw unsupportedFont("A ToUnicode CMap cannot contain CID mappings.");
  }
  if (parsed.notdefRangeMappingCount > 0) {
    throw unsupportedFont("A ToUnicode CMap cannot contain notdef mappings.");
  }
  return Object.freeze({
    codeSpaces: parsed.codeSpaces,
    mappings: parsed.unicode,
    decode(source: Uint8Array, offset = 0) {
      const entry = decodeCMapCode(source, offset, parsed.codeSpaces, parsed.unicode);
      return {
        code: entry.code,
        byteLength: entry.byteLength,
        unicode: parsed.unicode.get(cmapKey(entry.code, entry.byteLength)) ?? null
      };
    }
  });
}

/** Parse a simple or composite PDF font dictionary and its lazy embedded program. */
export async function parseNativePdfFont(
  dictionaryValue: PdfValue,
  resolver: NativePdfFontResolver,
  options: ParseNativePdfFontOptions = {}
): Promise<NativePdfFont> {
  const signal = options.signal;
  throwIfAborted(signal);
  const parserLimits = mergeFontParserLimits(options.parserLimits);
  const dictionary = await requireDictionary(dictionaryValue, resolver, signal, "font");
  const subtype = requireName(dictionary.get("Subtype"), "A PDF font has no supported /Subtype.");
  if (subtype === "Type0") {
    return await parseCompositeFont(dictionary, resolver, options, parserLimits);
  }
  if (
    subtype !== "Type1" && subtype !== "MMType1" && subtype !== "TrueType" &&
    subtype !== "Type3"
  ) {
    throw unsupportedFont(`PDF font subtype /${subtype} is not supported.`);
  }
  return await parseSimpleFont(dictionary, subtype, resolver, options, parserLimits);
}

class ParsedNativeFont implements NativePdfFont {
  readonly subtype: NativePdfFontSubtype;
  readonly baseFont: string;
  readonly writingMode: 0 | 1;
  readonly descriptor: NativeFontDescriptor;
  readonly style: NativeFontStyleMetadata;
  readonly unitsPerEm: number;
  readonly sfnt: NativeSfntFont | null;
  readonly cff: NativeCffFont | null;
  readonly substitution: NativeFontSubstitution | null;
  readonly diagnostics: readonly PdfDiagnostic[];
  private readonly decodeCharacter: (bytes: Uint8Array, offset: number) => NativeMappedCharacter;
  private readonly unsupportedOutlineReason: string | null;

  constructor(
    subtype: NativePdfFontSubtype,
    baseFont: string,
    writingMode: 0 | 1,
    descriptor: NativeFontDescriptor,
    style: NativeFontStyleMetadata,
    unitsPerEm: number,
    sfnt: NativeSfntFont | null,
    cff: NativeCffFont | null,
    substitution: NativeFontSubstitution | null,
    diagnostics: readonly PdfDiagnostic[],
    decodeCharacter: (bytes: Uint8Array, offset: number) => NativeMappedCharacter,
    unsupportedOutlineReason: string | null
  ) {
    this.subtype = subtype;
    this.baseFont = baseFont;
    this.writingMode = writingMode;
    this.descriptor = descriptor;
    this.style = style;
    this.unitsPerEm = unitsPerEm;
    this.sfnt = sfnt;
    this.cff = cff;
    this.substitution = substitution;
    this.diagnostics = diagnostics;
    this.decodeCharacter = decodeCharacter;
    this.unsupportedOutlineReason = unsupportedOutlineReason;
  }

  decode(bytes: Uint8Array, offset = 0): NativeMappedCharacter {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= bytes.length) {
      throw new RangeError("PDF font decode offset is outside the source string.");
    }
    return this.decodeCharacter(bytes, offset);
  }

  getGlyphOutline(glyphId: number): NativeGlyphOutline {
    if (this.sfnt) return this.sfnt.getGlyphOutline(glyphId);
    if (this.cff) return this.cff.getGlyphOutline(glyphId);
    throw unsupportedFont(
      this.unsupportedOutlineReason ??
      `Font ${this.baseFont || "(unnamed)"} has no embedded outline program; a deterministic substitute is required.`
    );
  }
}

async function parseSimpleFont(
  dictionary: PdfDictionary,
  subtype: "Type1" | "MMType1" | "TrueType" | "Type3",
  resolver: NativePdfFontResolver,
  options: ParseNativePdfFontOptions,
  parserLimits: Readonly<NativePdfFontParserLimits>
): Promise<NativePdfFont> {
  const signal = options.signal;
  const baseFont = optionalName(dictionary.get("BaseFont")) ?? "";
  const descriptor = await parseFontDescriptor(dictionary.get("FontDescriptor"), resolver, signal);
  const style = deriveFontStyle(baseFont, descriptor);
  const embeddedSfnt = await readEmbeddedSfnt(
    dictionary,
    descriptor,
    resolver,
    parserLimits,
    signal
  );
  const embeddedCff = await readEmbeddedCff(
    dictionary,
    descriptor,
    resolver,
    parserLimits,
    signal
  );
  reportFontDiagnostics(embeddedSfnt?.diagnostics ?? EMPTY_DIAGNOSTICS, options);
  const replacement = embeddedSfnt === null && embeddedCff === null &&
    descriptor.embeddedKind === null && subtype !== "Type3"
    ? await resolveMissingSfnt({
        baseFont,
        normalizedBaseFont: stripSubsetPrefix(baseFont),
        subtype,
        descendantSubtype: null,
        writingMode: 0,
        descriptor,
        style
      }, options)
    : null;
  const sfnt = embeddedSfnt ?? replacement?.sfnt ?? null;
  const encoding = await parseSimpleEncoding(
    dictionary.get("Encoding"),
    baseFont,
    resolver,
    parserLimits,
    signal,
    embeddedCff?.builtInGlyphNames
  );
  const toUnicode = await readToUnicode(
    dictionary.get("ToUnicode"),
    resolver,
    parserLimits,
    signal
  );
  const firstChar = integerOr(dictionary.get("FirstChar"), 0);
  const widthValues = await resolveArray(dictionary.get("Widths"), resolver, signal);
  const widths = new Map<number, number>();
  if (widthValues) {
    for (let index = 0; index < widthValues.length; index += 1) {
      const width = finiteNumber(widthValues[index]);
      if (width !== null) widths.set(firstChar + index, width);
    }
  }
  const type3Matrix = subtype === "Type3" ? readNumberArray(dictionary.get("FontMatrix"), 6) : null;
  const unitsPerEm = sfnt?.unitsPerEm ?? embeddedCff?.unitsPerEm ?? (
    type3Matrix && type3Matrix[0] !== 0 ? Math.max(1, Math.round(1 / Math.abs(type3Matrix[0]))) : 1000
  );
  const type3Widths = subtype === "Type3";
  // PDF's Standard-14 special treatment applies when the width entries are
  // omitted. Once /Widths is present, its range and descriptor /MissingWidth
  // define positioning instead of the built-in AFM program.
  const standardMetricFace =
    subtype !== "Type3" && widthValues === null &&
    embeddedSfnt === null && embeddedCff === null && descriptor.embeddedKind === null
      ? resolveNativeStandard14MetricFace(baseFont)
      : null;
  const outlineReason = subtype === "Type3"
    ? "Type3 glyphs must be compiled through their CharProc display programs."
    : descriptor.embeddedKind === "cff2"
      ? "CFF2 outlines require the native CFF2 engine, which is not available."
      : descriptor.embeddedKind === "cff"
        ? "The embedded CFF outline program could not be retained."
        : descriptor.embeddedKind === "type1"
          ? "PFA/PFB Type1 outlines require the native Type1 engine, which is not available."
          : subtype === "Type1" || subtype === "MMType1"
            ? "A nonembedded Type1 font requires a deterministic substitute."
        : null;

  return new ParsedNativeFont(
    subtype,
    baseFont,
    0,
    descriptor,
    style,
    unitsPerEm,
    sfnt,
    embeddedCff,
    replacement?.substitution ?? null,
    Object.freeze([
      ...(embeddedSfnt?.diagnostics ?? EMPTY_DIAGNOSTICS),
      ...(replacement?.diagnostics ?? EMPTY_DIAGNOSTICS)
    ]),
    (bytes, offset) => {
      const code = bytes[offset];
      const glyphName = encoding.glyphNames[code] ?? null;
      const mappedUnicode = toUnicode?.mappings.get(cmapKey(code, 1));
      const selectionUnicode = encoding.selectionUnicode[code] ??
        (glyphName ? glyphNameToSelectionUnicodeForFont(glyphName, baseFont) : null);
      const unicode = mappedUnicode ?? encoding.unicode[code] ??
        (glyphName ? glyphNameToUnicodeForFont(glyphName, baseFont) : null);
      let glyphId = code;
      if (embeddedCff) {
        // Name-keyed CFF selection follows the PDF Encoding glyph name. An
        // unrelated ToUnicode value must never redirect painted geometry.
        glyphId = embeddedCff.glyphIdForName(glyphName);
      } else if (sfnt) {
        // ToUnicode is semantic extraction metadata, never a glyph selector.
        // Substitute and embedded sfnt selection follows the PDF Encoding.
        const unicodeScalar = selectionUnicode ? firstUnicodeScalar(selectionUnicode) : -1;
        glyphId = unicodeScalar >= 0 ? sfnt.mapCodePoint(unicodeScalar) : 0;
        if (glyphId === 0 && descriptor.flags & 4) {
          glyphId = sfnt.mapSymbolCode(code);
        }
      }
      const standardWidth = widths.has(code) || standardMetricFace === null
        ? null
        : nativeStandard14GlyphWidth(standardMetricFace, glyphName);
      let width = widths.get(code) ?? standardWidth ?? descriptor.missingWidth;
      if (
        !widths.has(code) && standardWidth === null && width === 0 &&
        ((sfnt !== null && glyphId < sfnt.numGlyphs) ||
          (embeddedCff !== null && glyphId < embeddedCff.numGlyphs))
      ) {
        width = sfnt
          ? sfnt.getHorizontalMetric(glyphId).advanceWidth * 1000 / sfnt.unitsPerEm
          : embeddedCff!.getGlyphOutline(glyphId).advanceWidth * 1000 / embeddedCff!.unitsPerEm;
      }
      if (type3Widths && type3Matrix) {
        // Type3 widths are expressed through FontMatrix; normalize to the same
        // 1000-unit convention consumed by the text state interpreter.
        width *= Math.abs(type3Matrix[0]) * 1000;
      }
      return {
        code,
        codeByteLength: 1,
        cid: code,
        glyphId,
        glyphName,
        unicode,
        width,
        verticalMetric: null
      };
    },
    outlineReason
  );
}

async function parseCompositeFont(
  dictionary: PdfDictionary,
  resolver: NativePdfFontResolver,
  options: ParseNativePdfFontOptions,
  parserLimits: Readonly<NativePdfFontParserLimits>
): Promise<NativePdfFont> {
  const signal = options.signal;
  const baseFont = optionalName(dictionary.get("BaseFont")) ?? "";
  const descendants = await resolveArray(dictionary.get("DescendantFonts"), resolver, signal);
  if (!descendants || descendants.length !== 1) {
    throw unsupportedFont("A Type0 font must contain exactly one descendant font.");
  }
  const descendant = await requireDictionary(descendants[0], resolver, signal, "descendant font");
  const descendantSubtype = requireName(
    descendant.get("Subtype"),
    "A Type0 descendant font has no /Subtype."
  );
  if (descendantSubtype !== "CIDFontType0" && descendantSubtype !== "CIDFontType2") {
    throw unsupportedFont(`Type0 descendant subtype /${descendantSubtype} is not supported.`);
  }
  const descendantSystemInfo = await readCidSystemInfo(descendant, resolver, signal);

  const encoding = await readCompositeEncoding(
    dictionary.get("Encoding"),
    resolver,
    parserLimits,
    signal
  );
  validateEncodingSystemInfo(encoding, descendantSystemInfo);
  const toUnicode = await readToUnicode(
    dictionary.get("ToUnicode"),
    resolver,
    parserLimits,
    signal
  );
  const cidUnicode = toUnicode === null
    ? await resolveCidUnicodeFallback(descendantSystemInfo, options, parserLimits.maxCMapMappings)
    : Object.freeze({ shard: null, diagnostics: EMPTY_DIAGNOSTICS });
  const descriptor = await parseFontDescriptor(descendant.get("FontDescriptor"), resolver, signal);
  const style = deriveFontStyle(baseFont, descriptor);
  const embeddedSfnt = await readEmbeddedSfnt(
    descendant,
    descriptor,
    resolver,
    parserLimits,
    signal
  );
  reportFontDiagnostics(embeddedSfnt?.diagnostics ?? EMPTY_DIAGNOSTICS, options);
  const replacement = embeddedSfnt === null && descriptor.embeddedKind === null
    ? await resolveMissingSfnt({
        baseFont,
        normalizedBaseFont: stripSubsetPrefix(baseFont),
        subtype: "Type0",
        descendantSubtype,
        writingMode: encoding.writingMode,
        descriptor,
        style
      }, options)
    : null;
  const sfnt = embeddedSfnt ?? replacement?.sfnt ?? null;
  const defaultWidth = await readOptionalFiniteNumber(
    descendant,
    "DW",
    1000,
    resolver,
    signal
  );
  const widths = parseCidWidths(
    await resolveOptionalArrayStrict(descendant, "W", resolver, signal),
    parserLimits.maxCidMetricEntries
  );
  const [defaultOriginY, defaultAdvanceY] = encoding.writingMode === 1
    ? await readOptionalPair(descendant, "DW2", 880, -1000, resolver, signal)
    : [880, -1000] as const;
  const verticalMetrics = encoding.writingMode === 1
    ? parseCidVerticalMetrics(
        await resolveOptionalArrayStrict(descendant, "W2", resolver, signal),
        parserLimits.maxCidMetricEntries
      )
    : new Map<number, NativeVerticalMetric>();
  const cidToGid = descendantSubtype === "CIDFontType2"
    ? await readCidToGidMap(descendant.get("CIDToGIDMap"), resolver, signal)
    : null;
  const outlineReason = descendantSubtype === "CIDFontType0"
    ? "CIDFontType0 CFF outlines require the native CFF kernel, which is not available."
    : descriptor.embeddedKind === "cff" || descriptor.embeddedKind === "cff2"
      ? "CFF/CFF2 outlines require the native CFF kernel, which is not available."
      : null;

  return new ParsedNativeFont(
    "Type0",
    baseFont,
    encoding.writingMode,
    descriptor,
    style,
    sfnt?.unitsPerEm ?? 1000,
    sfnt,
    null,
    replacement?.substitution ?? null,
    Object.freeze([
      ...(embeddedSfnt?.diagnostics ?? EMPTY_DIAGNOSTICS),
      ...(replacement?.diagnostics ?? EMPTY_DIAGNOSTICS),
      ...cidUnicode.diagnostics
    ]),
    (bytes, offset) => {
      const entry = decodeCMapCode(
        bytes,
        offset,
        encoding.codeSpaces,
        (code, byteLength) => getCMapCid(encoding, cmapKey(code, byteLength), code, byteLength) !== null
      );
      const key = cmapKey(entry.code, entry.byteLength);
      const cid = getCMapCid(encoding, key, entry.code, entry.byteLength) ??
        (encoding.identityBase ? entry.code : 0);
      const rawGlyphId = cidToGid ? cidToGid(cid) : cid;
      const glyphId = sfnt && rawGlyphId >= sfnt.numGlyphs ? 0 : rawGlyphId;
      const unicode = toUnicode === null
        ? cidUnicode.shard?.unicodeForCid(cid) ?? null
        : toUnicode.mappings.get(key) ?? null;
      const width = widths.get(cid) ?? defaultWidth;
      const metric = encoding.writingMode === 1
        ? verticalMetrics.get(cid) ?? {
            advanceY: defaultAdvanceY,
            originX: width / 2,
            originY: defaultOriginY
          }
        : null;
      return {
        code: entry.code,
        codeByteLength: entry.byteLength,
        cid,
        glyphId,
        glyphName: null,
        unicode,
        width,
        verticalMetric: metric
      };
    },
    outlineReason
  );
}

interface ResolvedCidUnicodeFallback {
  readonly shard: NativeCidToUnicodeShard | null;
  readonly diagnostics: readonly PdfDiagnostic[];
}

async function readCidSystemInfo(
  descendant: PdfDictionary,
  resolver: NativePdfFontResolver,
  signal?: AbortSignal
): Promise<Readonly<NativeCidSystemInfo>> {
  const raw = descendant.get("CIDSystemInfo");
  if (raw === undefined || raw === null) {
    throw cidSystemInfoError(
      "A Type0 descendant font has no required /CIDSystemInfo dictionary.",
      "font-cid-system-info-missing"
    );
  }
  return await readCidSystemInfoDictionary(raw, resolver, signal, "CID font /CIDSystemInfo");
}

async function readOptionalCMapSystemInfo(
  dictionary: PdfDictionary,
  resolver: NativePdfFontResolver,
  signal?: AbortSignal
): Promise<Readonly<NativeCidSystemInfo> | null> {
  const raw = dictionary.get("CIDSystemInfo");
  return raw === undefined || raw === null
    ? null
    : await readCidSystemInfoDictionary(raw, resolver, signal, "CMap /CIDSystemInfo");
}

async function readCidSystemInfoDictionary(
  raw: PdfValue,
  resolver: NativePdfFontResolver,
  signal: AbortSignal | undefined,
  label: string
): Promise<Readonly<NativeCidSystemInfo>> {
  const dictionary = await requireDictionary(raw, resolver, signal, label);
  const registry = await readCidSystemInfoString(dictionary, "Registry", resolver, signal, label);
  const ordering = await readCidSystemInfoString(dictionary, "Ordering", resolver, signal, label);
  const rawSupplement = await resolver.resolveValue(dictionary.get("Supplement"), signal);
  if (
    typeof rawSupplement !== "number" || !Number.isSafeInteger(rawSupplement) ||
    rawSupplement < 0 || rawSupplement > 0xffff
  ) {
    throw cidSystemInfoError(
      `${label} /Supplement must be an integer from 0 through 65535.`,
      "font-cid-system-info-supplement"
    );
  }
  return Object.freeze({ registry, ordering, supplement: rawSupplement });
}

async function readCidSystemInfoString(
  dictionary: PdfDictionary,
  key: "Registry" | "Ordering",
  resolver: NativePdfFontResolver,
  signal: AbortSignal | undefined,
  label: string
): Promise<string> {
  const value = await resolver.resolveValue(dictionary.get(key), signal);
  if (!isPdfString(value) || value.bytes.length < 1 || value.bytes.length > 127) {
    throw cidSystemInfoError(
      `${label} /${key} must be a 1 through 127-byte string.`,
      "font-cid-system-info-string"
    );
  }
  // Producers routinely emit these as fixed-width strings padded with
  // trailing NULs. The padding carries no part of the collection name, so it
  // is trimmed before the character check; every other byte outside
  // printable ASCII remains an error.
  let length = value.bytes.length;
  while (length > 0 && value.bytes[length - 1] === 0) length -= 1;
  if (length < 1) {
    throw cidSystemInfoError(
      `${label} /${key} must contain at least one non-NUL byte.`,
      "font-cid-system-info-string"
    );
  }
  let result = "";
  for (let index = 0; index < length; index += 1) {
    const byte = value.bytes[index];
    if (byte < 0x20 || byte > 0x7e) {
      throw cidSystemInfoError(
        `${label} /${key} must contain printable ASCII.`,
        "font-cid-system-info-string"
      );
    }
    result += String.fromCharCode(byte);
  }
  return result;
}

function validateEncodingSystemInfo(
  encoding: ParsedCMap,
  descendant: Readonly<NativeCidSystemInfo>
): void {
  // Identity CMaps are collection-neutral by definition and are routinely
  // paired with Adobe-Japan1 and the other registered collections.
  const required = encoding.systemInfo;
  if (encoding.identityBase && (required === null || required.ordering === "Identity")) return;
  if (required === null) return;
  if (required.registry !== descendant.registry || required.ordering !== descendant.ordering) {
    throw new PdfError(
      "unsupported-font",
      `Type0 encoding CMap ${required.registry}-${required.ordering} is incompatible with ` +
      `descendant CID collection ${descendant.registry}-${descendant.ordering}.`,
      {
        details: {
          reason: "font-cid-system-info-mismatch",
          encodingRegistry: required.registry,
          encodingOrdering: required.ordering,
          descendantRegistry: descendant.registry,
          descendantOrdering: descendant.ordering
        }
      }
    );
  }
  if (descendant.supplement < required.supplement) {
    throw new PdfError(
      "unsupported-font",
      `Type0 encoding CMap requires ${required.registry}-${required.ordering} supplement ` +
      `${required.supplement}, but the descendant font declares supplement ${descendant.supplement}.`,
      {
        details: {
          reason: "font-cid-system-info-supplement-mismatch",
          encodingSupplement: required.supplement,
          descendantSupplement: descendant.supplement
        }
      }
    );
  }
}

async function resolveCidUnicodeFallback(
  systemInfo: Readonly<NativeCidSystemInfo>,
  options: ParseNativePdfFontOptions,
  maxMappings: number
): Promise<ResolvedCidUnicodeFallback> {
  const collection = nativeCidToUnicodeCollection(systemInfo);
  if (collection === null) {
    const diagnostic = cidUnicodeDiagnostic(
      "font.cid-unicode-fallback-unavailable",
      `No canonical CID-to-Unicode fallback is bundled for ` +
      `${systemInfo.registry}-${systemInfo.ordering}; characters without /ToUnicode remain unindexed.`,
      {
        registry: systemInfo.registry,
        ordering: systemInfo.ordering,
        fontSupplement: systemInfo.supplement
      }
    );
    options.onDiagnostic?.(diagnostic);
    return Object.freeze({ shard: null, diagnostics: Object.freeze([diagnostic]) });
  }
  const shard = await loadNativeCidToUnicode(collection, options.signal);
  if (shard.mappingCount > maxMappings) {
    throw new PdfError(
      "resource-limit",
      "CID-to-Unicode fallback exceeds the configured CMap mapping limit.",
      {
        details: {
          reason: "font-cid-unicode-mapping-limit",
          collection,
          mappingCount: shard.mappingCount,
          limit: maxMappings
        }
      }
    );
  }
  const unmappedWithinRange = shard.maxCid + 1 - shard.mappingCount;
  if (
    systemInfo.supplement <= shard.systemInfo.supplement &&
    unmappedWithinRange === 0
  ) {
    return Object.freeze({ shard, diagnostics: EMPTY_DIAGNOSTICS });
  }
  const diagnostic = cidUnicodeDiagnostic(
    "font.cid-unicode-fallback-partial",
    `The canonical CID-to-Unicode fallback for Adobe-${collection} does not cover every ` +
    `CID declared by this font collection; uncovered characters remain unindexed.`,
    {
      registry: systemInfo.registry,
      ordering: systemInfo.ordering,
      fontSupplement: systemInfo.supplement,
      mappingSupplement: shard.systemInfo.supplement,
      maxMappedCid: shard.maxCid,
      unmappedWithinRange
    }
  );
  options.onDiagnostic?.(diagnostic);
  return Object.freeze({ shard, diagnostics: Object.freeze([diagnostic]) });
}

function cidUnicodeDiagnostic(
  code: string,
  message: string,
  details: Readonly<Record<string, string | number | boolean | null>>
): Readonly<PdfDiagnostic> {
  return Object.freeze({
    code,
    severity: "warning" as const,
    message,
    details: Object.freeze({ ...details })
  });
}

function cidSystemInfoError(message: string, reason: string): PdfError {
  return new PdfError("unsupported-font", message, { details: { reason } });
}

interface SimpleEncoding {
  readonly glyphNames: readonly (string | null)[];
  readonly unicode: readonly (string | null)[];
  readonly selectionUnicode: readonly (string | null)[];
}

async function parseSimpleEncoding(
  value: PdfValue | undefined,
  baseFont: string,
  resolver: NativePdfFontResolver,
  limits: Readonly<NativePdfFontParserLimits>,
  signal?: AbortSignal,
  builtInGlyphNames?: readonly (string | null)[]
): Promise<SimpleEncoding> {
  const resolved = await resolver.resolveValue(value, signal);
  let baseName: string;
  let differences: readonly PdfValue[] | null = null;
  let useBuiltInDefault = false;
  if (isPdfName(resolved)) {
    requirePredefinedSimpleEncoding(resolved.value);
    baseName = resolved.value;
  } else if (isPdfDictionary(resolved)) {
    if (resolved.has("Type")) {
      const type = await resolver.resolveValue(resolved.get("Type"), signal);
      if (!isPdfName(type, "Encoding")) {
        throw unsupportedFont("A simple font encoding dictionary /Type must be /Encoding.");
      }
    }
    if (resolved.has("BaseEncoding")) {
      const base = await resolver.resolveValue(resolved.get("BaseEncoding"), signal);
      if (!isPdfName(base)) {
        throw unsupportedFont("A simple font encoding /BaseEncoding must be a name.");
      }
      requirePredefinedSimpleEncoding(base.value);
      baseName = base.value;
    } else {
      baseName = defaultEncodingForFont(baseFont);
      useBuiltInDefault = true;
    }
    if (resolved.has("Differences")) {
      differences = await resolveArray(resolved.get("Differences"), resolver, signal);
      if (!differences) throw unsupportedFont("A simple font encoding /Differences must be an array.");
      if (differences.length > limits.maxSimpleEncodingDifferences) {
        throw new PdfError("resource-limit", "Font encoding /Differences exceeds the configured limit.", {
          details: {
            reason: "font-encoding-differences-limit",
            limit: limits.maxSimpleEncodingDifferences
          }
        });
      }
    }
  } else if (resolved === undefined || resolved === null) {
    baseName = defaultEncodingForFont(baseFont);
    useBuiltInDefault = true;
  } else {
    throw unsupportedFont("A simple font /Encoding must be a name or dictionary.");
  }
  const mutable = useBuiltInDefault && builtInGlyphNames
    ? createBuiltInEncoding(builtInGlyphNames, baseFont)
    : createBaseEncoding(baseName, baseFont, useBuiltInDefault);
  if (differences) {
    let code = -1;
    for (const item of differences) {
      if (typeof item === "number" && Number.isInteger(item)) {
        if (item < 0 || item > 255) {
          throw unsupportedFont("Font encoding /Differences contains an invalid character code.");
        }
        code = item;
      } else if (isPdfName(item)) {
        if (code < 0 || code > 255) {
          throw unsupportedFont("Font encoding /Differences contains an invalid character code.");
        }
        const macExpert = baseName === "MacExpertEncoding"
          ? nativeMacExpertGlyphNameEntry(item.value)
          : null;
        mutable.glyphNames[code] = item.value;
        mutable.unicode[code] = macExpert?.unicode ?? glyphNameToUnicodeForFont(item.value, baseFont);
        mutable.selectionUnicode[code] = macExpert?.selectionUnicode ??
          glyphNameToSelectionUnicodeForFont(item.value, baseFont);
        code += 1;
      } else {
        throw unsupportedFont("Font encoding /Differences contains an invalid entry.");
      }
    }
  }
  return {
    glyphNames: Object.freeze(mutable.glyphNames),
    unicode: Object.freeze(mutable.unicode),
    selectionUnicode: Object.freeze(mutable.selectionUnicode)
  };
}

function createBuiltInEncoding(
  sourceNames: readonly (string | null)[],
  baseFont: string
): {
  glyphNames: (string | null)[];
  unicode: (string | null)[];
  selectionUnicode: (string | null)[];
} {
  if (sourceNames.length !== 256) {
    throw unsupportedFont("An embedded font's built-in Encoding is invalid.");
  }
  const glyphNames = [...sourceNames];
  const unicode = glyphNames.map((name) =>
    name === null ? null : glyphNameToUnicodeForFont(name, baseFont)
  );
  const selectionUnicode = glyphNames.map((name) =>
    name === null ? null : glyphNameToSelectionUnicodeForFont(name, baseFont)
  );
  return { glyphNames, unicode, selectionUnicode };
}

function createBaseEncoding(name: string, baseFont: string, useBuiltInDefault: boolean): {
  glyphNames: (string | null)[];
  unicode: (string | null)[];
  selectionUnicode: (string | null)[];
} {
  const glyphNames = new Array<string | null>(256).fill(null);
  const unicode = new Array<string | null>(256).fill(null);
  const selectionUnicode = new Array<string | null>(256).fill(null);
  const standardMetricFace = resolveNativeStandard14MetricFace(baseFont);
  if (useBuiltInDefault && standardMetricFace === "symbol") {
    fillSymbolEncoding(glyphNames, unicode, selectionUnicode);
    return { glyphNames, unicode, selectionUnicode };
  }
  if (useBuiltInDefault && standardMetricFace === "zapf-dingbats") {
    for (let code = 0; code < 256; code += 1) {
      const glyphName = zapfDingbatEncodingGlyphName(code);
      if (glyphName === null) continue;
      glyphNames[code] = glyphName;
      unicode[code] = glyphName === "space"
        ? " "
        : zapfDingbatGlyphNameToUnicode(glyphName);
      selectionUnicode[code] = unicode[code];
    }
    return { glyphNames, unicode, selectionUnicode };
  }
  if (name === "MacExpertEncoding") {
    for (let code = 0; code < 256; code += 1) {
      const entry = nativeMacExpertEncodingEntry(code);
      if (!entry) continue;
      glyphNames[code] = entry.glyphName;
      unicode[code] = entry.unicode;
      selectionUnicode[code] = entry.selectionUnicode;
    }
    return { glyphNames, unicode, selectionUnicode };
  }
  for (let code = 32; code <= 126; code += 1) {
    unicode[code] = String.fromCharCode(code);
    glyphNames[code] = asciiGlyphName(code);
  }
  if (name === "WinAnsiEncoding") {
    for (let code = 128; code <= 255; code += 1) {
      const scalar = decodeWinAnsi(code);
      if (scalar !== null) unicode[code] = String.fromCodePoint(scalar);
    }
    // Appendix D assigns every unused WinAnsi code above space to /bullet.
    for (const code of [127, 0x81, 0x8d, 0x8f, 0x90, 0x9d]) {
      glyphNames[code] = "bullet";
      unicode[code] = glyphNameToUnicode("bullet");
    }
    // These duplicate glyph names intentionally extract through AGL as the
    // ordinary space and hyphen, independent of their control semantics.
    glyphNames[0xa0] = "space";
    unicode[0xa0] = " ";
    glyphNames[0xad] = "hyphen";
    unicode[0xad] = "-";
  } else if (name === "MacRomanEncoding") {
    for (let code = 128; code <= 255; code += 1) unicode[code] = MAC_ROMAN[code - 128] ?? null;
    // PDF freezes the historical MacRoman vector: code 312 (octal) is a
    // duplicate /space and code 333 remains /currency, rather than Apple's
    // later nonbreaking-space/Euro assignments.
    glyphNames[0xca] = "space";
    unicode[0xca] = " ";
    glyphNames[0xdb] = "currency";
    unicode[0xdb] = "¤";
  } else if (name !== "StandardEncoding") {
    throw unsupportedFont(`Simple font encoding /${name} is not supported.`);
  }
  for (let code = 0; code < 256; code += 1) {
    const value = unicode[code];
    if (value && !glyphNames[code]) glyphNames[code] = unicodeToPreferredGlyphName(value);
    selectionUnicode[code] = value;
  }
  if (name === "StandardEncoding") fillStandardEncodingHigh(glyphNames, unicode);
  // StandardEncoding's high entries are populated after the common copy.
  for (let code = 0; code < 256; code += 1) selectionUnicode[code] = unicode[code];
  return { glyphNames, unicode, selectionUnicode };
}

function fillStandardEncodingHigh(
  names: (string | null)[],
  unicode: (string | null)[]
): void {
  // StandardEncoding differs from ASCII at both quote positions.
  names[39] = "quoteright";
  unicode[39] = glyphNameToUnicode("quoteright");
  names[96] = "quoteleft";
  unicode[96] = glyphNameToUnicode("quoteleft");
  const entries: Readonly<Record<number, string>> = {
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
  };
  for (const [rawCode, name] of Object.entries(entries)) {
    const code = Number(rawCode);
    names[code] = name;
    unicode[code] = glyphNameToUnicode(name);
  }
}

function requirePredefinedSimpleEncoding(name: string): void {
  if (
    name !== "MacRomanEncoding" && name !== "MacExpertEncoding" &&
    name !== "WinAnsiEncoding" && name !== "StandardEncoding"
  ) {
    throw unsupportedFont(
      `Simple font encoding /${name} is not supported.`
    );
  }
}

async function readCompositeEncoding(
  value: PdfValue | undefined,
  resolver: NativePdfFontResolver,
  limits: Readonly<NativePdfFontParserLimits>,
  signal?: AbortSignal
): Promise<ParsedCMap> {
  if (value === undefined || value === null) {
    throw unsupportedFont("A Type0 font /Encoding must be a CMap name or stream.");
  }
  const parsed = await resolveCMap(
    value,
    resolver,
    limits,
    { refs: new Set(), streams: new Set(), names: new Set(), depth: 0 },
    "Type0 /Encoding",
    true,
    signal
  );
  if (parsed.unicode.size > 0) {
    throw unsupportedFont("A Type0 encoding CMap cannot contain Unicode mappings.");
  }
  return parsed;
}

async function readToUnicode(
  value: PdfValue | undefined,
  resolver: NativePdfFontResolver,
  limits: Readonly<NativePdfFontParserLimits>,
  signal?: AbortSignal
): Promise<ReturnType<typeof parseToUnicodeCMap> | null> {
  if (value === undefined || value === null) return null;
  const parsed = await resolveCMap(
    value,
    resolver,
    limits,
    { refs: new Set(), streams: new Set(), names: new Set(), depth: 0 },
    "font /ToUnicode",
    false,
    signal
  );
  if (parsed.cids.size > 0 || parsed.cidRangeMappingCount > 0) {
    throw unsupportedFont("A font /ToUnicode CMap cannot contain CID mappings.");
  }
  if (parsed.notdefRangeMappingCount > 0) {
    throw unsupportedFont("A font /ToUnicode CMap cannot contain notdef mappings.");
  }
  return Object.freeze({
    codeSpaces: parsed.codeSpaces,
    mappings: parsed.unicode,
    decode(source: Uint8Array, offset = 0) {
      const entry = decodeCMapCode(source, offset, parsed.codeSpaces, parsed.unicode);
      return {
        code: entry.code,
        byteLength: entry.byteLength,
        unicode: parsed.unicode.get(cmapKey(entry.code, entry.byteLength)) ?? null
      };
    }
  });
}

async function resolveCMap(
  value: PdfValue,
  resolver: NativePdfFontResolver,
  limits: Readonly<NativePdfFontParserLimits>,
  stack: CMapResolutionStack,
  label: string,
  allowTopLevelName: boolean,
  signal?: AbortSignal
): Promise<ParsedCMap> {
  throwIfAborted(signal);
  if (stack.depth > limits.maxUseCMapDepth) {
    throw new PdfError("resource-limit", `CMap inheritance exceeds depth ${limits.maxUseCMapDepth}.`, {
      details: { reason: "font-cmap-depth", maxUseCMapDepth: limits.maxUseCMapDepth }
    });
  }
  if (isPdfRef(value)) {
    const identity = pdfRefKey(value);
    if (stack.refs.has(identity)) {
      throw unsupportedFont("A CMap /UseCMap reference graph contains a cycle.");
    }
    const refs = new Set(stack.refs);
    refs.add(identity);
    const resolved = await resolver.resolveValue(value, signal);
    if (resolved === undefined || resolved === null) {
      throw unsupportedFont(`${label} reference ${identity} is unresolved.`);
    }
    return await resolveCMap(
      resolved,
      resolver,
      limits,
      { ...stack, refs },
      label,
      allowTopLevelName,
      signal
    );
  }
  if (isPdfName(value)) {
    if (!allowTopLevelName) throw unsupportedFont(`${label} must be a CMap stream.`);
    return await predefinedCMap(value.value, limits, stack, signal);
  }
  if (!isPdfStream(value)) throw unsupportedFont(`${label} must be a CMap stream${allowTopLevelName ? " or name" : ""}.`);
  if (stack.streams.has(value)) throw unsupportedFont("A direct CMap /UseCMap graph contains a cycle.");
  const streams = new Set(stack.streams);
  streams.add(value);

  let inherited: ParsedCMap | null = null;
  if (value.dictionary.has("UseCMap")) {
    const rawBase = value.dictionary.get("UseCMap");
    if (rawBase === undefined || rawBase === null) {
      throw unsupportedFont(`${label} has a null /UseCMap entry.`);
    }
    inherited = await resolveCMap(
      rawBase,
      resolver,
      limits,
      { ...stack, streams, depth: stack.depth + 1 },
      `${label} /UseCMap`,
      true,
      signal
    );
  }
  const bytes = await resolver.decodeStream(value, signal);
  const inheritedByteCount = inherited?.sourceByteCount ?? 0;
  if (bytes.byteLength > limits.maxCMapBytes - inheritedByteCount) {
    throw new PdfError("resource-limit", "Aggregate CMap bytes exceed the configured parser limit.", {
      details: {
        byteLength: inheritedByteCount + bytes.byteLength,
        limit: limits.maxCMapBytes
      }
    });
  }
  const tokens = tokenizeCMap(
    bytes,
    limits.maxCMapTokens - (inherited?.tokenCount ?? 0)
  );
  const inlineBaseNames = findInlineUseCMaps(tokens);
  let inlineBase: ParsedCMap | undefined;
  if (inlineBaseNames.length === 1 && inherited === null) {
    inlineBase = await predefinedCMap(
      inlineBaseNames[0],
      limits,
      { ...stack, streams, depth: stack.depth + 1 },
      signal
    );
  }
  let parsed = parseCMap(bytes, limits, inherited, tokens, inlineBase);
  const dictionarySystemInfo = await readOptionalCMapSystemInfo(value.dictionary, resolver, signal);
  if (dictionarySystemInfo !== null) {
    parsed = Object.freeze({
      ...parsed,
      systemInfo: mergeCMapSystemInfo(parsed.systemInfo, dictionarySystemInfo, label)
    });
  }
  if (!value.dictionary.has("WMode")) return parsed;
  const rawWritingMode = await resolver.resolveValue(value.dictionary.get("WMode"), signal);
  if (rawWritingMode !== 0 && rawWritingMode !== 1) {
    throw unsupportedFont(`${label} /WMode must be 0 or 1.`);
  }
  if (parsed.writingModeExplicit && parsed.writingMode !== rawWritingMode) {
    throw unsupportedFont(`${label} has conflicting /WMode declarations.`);
  }
  return Object.freeze({ ...parsed, writingMode: rawWritingMode, writingModeExplicit: true });
}

async function predefinedCMap(
  name: string,
  limits: Readonly<NativePdfFontParserLimits>,
  stack: CMapResolutionStack,
  signal?: AbortSignal
): Promise<ParsedCMap> {
  throwIfAborted(signal);
  if (name === "Identity-H" || name === "Identity-V") return identityCMap(name);
  if (stack.depth > limits.maxUseCMapDepth) {
    throw new PdfError("resource-limit", `CMap inheritance exceeds depth ${limits.maxUseCMapDepth}.`, {
      details: { reason: "font-cmap-depth", maxUseCMapDepth: limits.maxUseCMapDepth }
    });
  }
  if (stack.names.has(name)) {
    throw unsupportedFont("A predefined CMap /UseCMap graph contains a cycle.");
  }
  const names = new Set(stack.names);
  names.add(name);
  const shard = await loadNativePredefinedCMap(name, signal);
  const inherited = shard.baseName === null
    ? null
    : await predefinedCMap(
        shard.baseName,
        limits,
        { ...stack, names, depth: stack.depth + 1 },
        signal
      );
  if (shard.codeSpaces.length > limits.maxCodeSpaceRanges - (inherited?.codeSpaces.length ?? 0)) {
    throw new PdfError("resource-limit", "CMap codespace count exceeds the configured limit.", {
      details: { limit: limits.maxCodeSpaceRanges }
    });
  }
  const codeSpaces: NativeCodeSpaceRange[] = inherited ? [...inherited.codeSpaces] : [];
  for (const range of shard.codeSpaces) addPredefinedCodeSpaceRange(codeSpaces, range);
  const cidRangeMappingCount = (inherited?.cidRangeMappingCount ?? 0) + shard.mappingCount;
  const notdefRangeMappingCount =
    (inherited?.notdefRangeMappingCount ?? 0) + shard.notdefMappingCount;
  if (cidRangeMappingCount + notdefRangeMappingCount > limits.maxCMapMappings) {
    throw new PdfError("resource-limit", "CMap expansion exceeds the configured mapping limit.", {
      details: { limit: limits.maxCMapMappings }
    });
  }
  const cidRangeLayers = inherited ? [...inherited.cidRangeLayers] : [];
  if (shard.mappingCount > 0) cidRangeLayers.push(shard.cidRanges);
  const notdefRangeLayers = inherited ? [...inherited.notdefRangeLayers] : [];
  if (shard.notdefMappingCount > 0) notdefRangeLayers.push(shard.notdefRanges);
  if (codeSpaces.length === 0) {
    throw unsupportedFont(`Predefined CMap /${name} has no declared or inherited codespace range.`);
  }
  validatePredefinedCMapRanges(name, shard.cidRanges, codeSpaces);
  validatePredefinedCMapRanges(name, shard.notdefRanges, codeSpaces);
  codeSpaces.sort((left, right) => right.byteLength - left.byteLength || left.start - right.start);
  const systemInfo = mergeCMapSystemInfo(
    inherited?.systemInfo ?? null,
    shard.systemInfo,
    `predefined /${name}`
  );
  return Object.freeze({
    codeSpaces: Object.freeze(codeSpaces),
    unicode: new Map(),
    cids: new Map(),
    sourceByteCount: inherited?.sourceByteCount ?? 0,
    tokenCount: inherited?.tokenCount ?? 0,
    mappingOperationCount:
      (inherited?.mappingOperationCount ?? 0) + shard.mappingCount + shard.notdefMappingCount,
    cidRangeLayers: Object.freeze(cidRangeLayers),
    cidRangeMappingCount,
    notdefRangeLayers: Object.freeze(notdefRangeLayers),
    notdefRangeMappingCount,
    writingMode: shard.writingMode,
    writingModeExplicit: true,
    identityBase: inherited?.identityBase ?? false,
    systemInfo
  });
}

function identityCMap(name: "Identity-H" | "Identity-V"): ParsedCMap {
  return Object.freeze({
    codeSpaces: Object.freeze([{ byteLength: 2, start: 0, end: 0xffff }]),
    unicode: new Map(),
    cids: new Map(),
    sourceByteCount: 0,
    tokenCount: 0,
    mappingOperationCount: 0,
    cidRangeLayers: Object.freeze([]),
    cidRangeMappingCount: 0,
    notdefRangeLayers: Object.freeze([]),
    notdefRangeMappingCount: 0,
    writingMode: name === "Identity-V" ? 1 : 0,
    writingModeExplicit: true,
    identityBase: true,
    systemInfo: Object.freeze({ registry: "Adobe", ordering: "Identity", supplement: 0 })
  });
}

function mergeCMapSystemInfo(
  inherited: Readonly<NativeCidSystemInfo> | null,
  local: Readonly<NativeCidSystemInfo>,
  label: string
): Readonly<NativeCidSystemInfo> {
  if (inherited === null || inherited.ordering === "Identity") return local;
  if (local.ordering === "Identity") return inherited;
  if (
    inherited.registry !== local.registry || inherited.ordering !== local.ordering
  ) {
    throw unsupportedFont(
      `CMap ${label} inherits an incompatible CID collection ` +
      `${inherited.registry}-${inherited.ordering}.`
    );
  }
  return inherited.supplement >= local.supplement
    ? inherited
    : Object.freeze({ ...local });
}

function requireSynchronousPredefinedCMap(name: string): ParsedCMap {
  if (name === "Identity-H" || name === "Identity-V") return identityCMap(name);
  throw unsupportedFont(
    `Synchronous ToUnicode parsing supports only /Identity-H and /Identity-V usecmap bases; ` +
    `font dictionaries resolve bundled /${name} asynchronously.`
  );
}

function validatePredefinedCMapRanges(
  name: string,
  layers: CMapCidRangeLayer | CMapNotdefRangeLayer,
  codeSpaces: readonly NativeCodeSpaceRange[]
): void {
  for (let byteLength = 1; byteLength <= 4; byteLength += 1) {
    for (const range of layers[byteLength - 1]) {
      if (!codeSpaces.some((space) =>
        space.byteLength === byteLength && range.start >= space.start && range.end <= space.end
      )) {
        throw unsupportedFont(
          `Bundled CMap /${name} contains a mapping outside its declared codespaces.`
        );
      }
    }
  }
}

function parseCMap(
  bytes: Uint8Array,
  limits: Readonly<NativePdfFontParserLimits>,
  externalBase: ParsedCMap | null = null,
  preparedTokens?: readonly CMapToken[],
  resolvedInlineBase?: ParsedCMap
): ParsedCMap {
  const preliminaryBase = externalBase ?? resolvedInlineBase ?? null;
  const inheritedByteCount = preliminaryBase?.sourceByteCount ?? 0;
  if (bytes.byteLength > limits.maxCMapBytes - inheritedByteCount) {
    throw new PdfError("resource-limit", "Aggregate CMap bytes exceed the configured parser limit.", {
      details: {
        byteLength: inheritedByteCount + bytes.byteLength,
        limit: limits.maxCMapBytes
      }
    });
  }
  const tokens = preparedTokens ?? tokenizeCMap(
    bytes,
    limits.maxCMapTokens - (preliminaryBase?.tokenCount ?? 0)
  );
  const inlineBaseNames = findInlineUseCMaps(tokens);
  if (inlineBaseNames.length > 1 || (inlineBaseNames.length === 1 && externalBase)) {
    throw unsupportedFont("A CMap declares more than one /UseCMap base.");
  }
  const inlineBase = inlineBaseNames.length === 1
    ? resolvedInlineBase ?? requireSynchronousPredefinedCMap(inlineBaseNames[0])
    : null;
  const inherited = externalBase ?? inlineBase;
  const sourceByteCount = (inherited?.sourceByteCount ?? 0) + bytes.byteLength;
  const tokenCount = (inherited?.tokenCount ?? 0) + tokens.length;
  if (tokenCount > limits.maxCMapTokens) {
    throw new PdfError("resource-limit", "Aggregate CMap token count exceeds the configured parser limit.", {
      details: { tokenCount, limit: limits.maxCMapTokens }
    });
  }
  const localSystemInfo = parseCMapSystemInfo(tokens);
  const codeSpaces: NativeCodeSpaceRange[] = inherited ? [...inherited.codeSpaces] : [];
  const localUnicode = new Map<string, string>();
  const localCids = new Map<string, number>();
  const cidRangeLayers = inherited ? [...inherited.cidRangeLayers] : [];
  const cidRangeMappingCount = inherited?.cidRangeMappingCount ?? 0;
  const notdefRangeLayers = inherited ? [...inherited.notdefRangeLayers] : [];
  let notdefRangeMappingCount = inherited?.notdefRangeMappingCount ?? 0;
  const localNotdefRanges: [
    NativePredefinedCMapNotdefRange[],
    NativePredefinedCMapNotdefRange[],
    NativePredefinedCMapNotdefRange[],
    NativePredefinedCMapNotdefRange[]
  ] = [[], [], [], []];
  const localUnicodeKeys = new Set<string>();
  const localCidKeys = new Set<string>();
  let writingMode: 0 | 1 = inherited?.writingMode ?? 0;
  let writingModeExplicit = false;
  const identityBase = inherited?.identityBase ?? false;
  let mappingOperations = inherited?.mappingOperationCount ?? 0;
  let localWritingMode: 0 | 1 | null = null;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind === "name" && token.value === "WMode") {
      const value = tokens[index + 1];
      if (value?.kind !== "number" || (value.value !== 0 && value.value !== 1)) {
        throw unsupportedFont("CMap /WMode must be 0 or 1.");
      }
      if (localWritingMode !== null && localWritingMode !== value.value) {
        throw unsupportedFont("CMap contains conflicting /WMode declarations.");
      }
      localWritingMode = value.value;
      continue;
    }
    if (token.kind !== "word") continue;
    if (token.value === "begincodespacerange") {
      const count = requireCMapBlockCount(tokens[index - 1], token.value);
      if (count > limits.maxCodeSpaceRanges - codeSpaces.length) {
        throw new PdfError("resource-limit", "CMap codespace count exceeds the configured limit.", {
          details: { limit: limits.maxCodeSpaceRanges }
        });
      }
      for (let item = 0; item < count; item += 1) {
        const start = requireCMapSource(tokens[++index], "codespace start");
        const end = requireCMapSource(tokens[++index], "codespace end");
        if (start.length !== end.length) {
          throw unsupportedFont("CMap codespace ranges must use one through four equal-length bytes.");
        }
        const range = {
          byteLength: start.length,
          start: bytesToCode(start),
          end: bytesToCode(end)
        };
        if (range.end < range.start) throw unsupportedFont("CMap codespace range is reversed.");
        addCodeSpaceRange(codeSpaces, range);
      }
      requireCMapBlockEnd(tokens[++index], "endcodespacerange");
    } else if (token.value === "beginnotdefchar") {
      const count = requireCMapBlockCount(tokens[index - 1], token.value);
      mappingOperations = reserveCMapMappings(mappingOperations, count, limits.maxCMapMappings);
      notdefRangeMappingCount += count;
      for (let item = 0; item < count; item += 1) {
        const source = requireCMapSource(tokens[++index], "notdefchar source");
        const cid = requireCMapNumber(tokens[++index], "notdefchar target");
        if (cid > MAX_CID) throw unsupportedFont("CMap notdefchar target exceeds 65535.");
        localNotdefRanges[source.length - 1].push({
          start: bytesToCode(source),
          end: bytesToCode(source),
          cid
        });
      }
      requireCMapBlockEnd(tokens[++index], "endnotdefchar");
    } else if (token.value === "beginnotdefrange") {
      const count = requireCMapBlockCount(tokens[index - 1], token.value);
      for (let item = 0; item < count; item += 1) {
        const startBytes = requireCMapSource(tokens[++index], "notdefrange start");
        const endBytes = requireCMapSource(tokens[++index], "notdefrange end");
        const cid = requireCMapNumber(tokens[++index], "notdefrange target");
        const start = bytesToCode(startBytes);
        const end = bytesToCode(endBytes);
        if (startBytes.length !== endBytes.length || end < start) {
          throw unsupportedFont("CMap notdefrange has an invalid source interval.");
        }
        if (cid > MAX_CID) throw unsupportedFont("CMap notdefrange target exceeds 65535.");
        const rangeCount = end - start + 1;
        mappingOperations = reserveCMapMappings(
          mappingOperations,
          rangeCount,
          limits.maxCMapMappings
        );
        notdefRangeMappingCount += rangeCount;
        localNotdefRanges[startBytes.length - 1].push({ start, end, cid });
      }
      requireCMapBlockEnd(tokens[++index], "endnotdefrange");
    } else if (token.value === "beginbfchar") {
      const count = requireCMapBlockCount(tokens[index - 1], token.value);
      mappingOperations = reserveCMapMappings(mappingOperations, count, limits.maxCMapMappings);
      for (let item = 0; item < count; item += 1) {
        const source = requireCMapSource(tokens[++index], "bfchar source");
        const target = requireCMapTarget(tokens[++index], "bfchar target");
        setLocalCMapMapping(
          localUnicode,
          localUnicodeKeys,
          cmapKey(bytesToCode(source), source.length),
          decodeUtf16Be(target),
          "Unicode"
        );
      }
      requireCMapBlockEnd(tokens[++index], "endbfchar");
    } else if (token.value === "beginbfrange") {
      const count = requireCMapBlockCount(tokens[index - 1], token.value);
      for (let item = 0; item < count; item += 1) {
        const startBytes = requireCMapSource(tokens[++index], "bfrange start");
        const endBytes = requireCMapSource(tokens[++index], "bfrange end");
        const start = bytesToCode(startBytes);
        const end = bytesToCode(endBytes);
        if (startBytes.length !== endBytes.length || end < start) {
          throw unsupportedFont("CMap bfrange has an invalid source interval.");
        }
        const rangeCount = end - start + 1;
        mappingOperations = reserveCMapMappings(
          mappingOperations,
          rangeCount,
          limits.maxCMapMappings
        );
        const target = tokens[++index];
        if (target?.kind === "hex") {
          const initialTarget = requireCMapTarget(target, "bfrange target");
          for (let code = start; code <= end; code += 1) {
            setLocalCMapMapping(
              localUnicode,
              localUnicodeKeys,
              cmapKey(code, startBytes.length),
              decodeUtf16Be(incrementBigEndian(initialTarget, code - start)),
              "Unicode"
            );
          }
        } else if (target?.kind === "array-start") {
          let code = start;
          while (code <= end) {
            const mapped = requireCMapTarget(tokens[++index], "bfrange array target");
            setLocalCMapMapping(
              localUnicode,
              localUnicodeKeys,
              cmapKey(code, startBytes.length),
              decodeUtf16Be(mapped),
              "Unicode"
            );
            code += 1;
          }
          if (tokens[++index]?.kind !== "array-end") {
            throw unsupportedFont("CMap bfrange target array has the wrong length.");
          }
        } else {
          throw unsupportedFont("CMap bfrange has an invalid target.");
        }
      }
      requireCMapBlockEnd(tokens[++index], "endbfrange");
    } else if (token.value === "begincidchar") {
      const count = requireCMapBlockCount(tokens[index - 1], token.value);
      mappingOperations = reserveCMapMappings(mappingOperations, count, limits.maxCMapMappings);
      for (let item = 0; item < count; item += 1) {
        const source = requireCMapSource(tokens[++index], "cidchar source");
        const target = requireCMapNumber(tokens[++index], "cidchar target");
        if (target > MAX_CID) throw unsupportedFont("CMap cidchar target exceeds 65535.");
        setLocalCMapMapping(
          localCids,
          localCidKeys,
          cmapKey(bytesToCode(source), source.length),
          target,
          "CID"
        );
      }
      requireCMapBlockEnd(tokens[++index], "endcidchar");
    } else if (token.value === "begincidrange") {
      const count = requireCMapBlockCount(tokens[index - 1], token.value);
      for (let item = 0; item < count; item += 1) {
        const startBytes = requireCMapSource(tokens[++index], "cidrange start");
        const endBytes = requireCMapSource(tokens[++index], "cidrange end");
        const firstCid = requireCMapNumber(tokens[++index], "cidrange target");
        const start = bytesToCode(startBytes);
        const end = bytesToCode(endBytes);
        if (startBytes.length !== endBytes.length || end < start) {
          throw unsupportedFont("CMap cidrange has an invalid source interval.");
        }
        const rangeCount = end - start + 1;
        if (firstCid > MAX_CID || rangeCount - 1 > MAX_CID - firstCid) {
          throw unsupportedFont("CMap cidrange target exceeds 65535.");
        }
        mappingOperations = reserveCMapMappings(
          mappingOperations,
          rangeCount,
          limits.maxCMapMappings
        );
        for (let code = start; code <= end; code += 1) {
          setLocalCMapMapping(
            localCids,
            localCidKeys,
            cmapKey(code, startBytes.length),
            firstCid + code - start,
            "CID"
          );
        }
      }
      requireCMapBlockEnd(tokens[++index], "endcidrange");
    }
  }
  if (localWritingMode !== null) {
    writingMode = localWritingMode;
    writingModeExplicit = true;
  }
  if (codeSpaces.length === 0) {
    // Inferring ranges from mapped keys changes string tokenization and is a
    // heuristic font repair. HEPR deliberately fails instead.
    throw unsupportedFont("CMap has no declared or inherited codespace range.");
  }
  // A font's Encoding CMap (or the fixed one-byte simple-font encoding), not
  // /ToUnicode's own codespace declaration, determines how a content string
  // is split into character codes. Real producers commonly emit a generic
  // two-byte ToUnicode codespace while retaining explicit one-byte bfchar
  // entries. Preserve those explicit semantic mappings; CID mappings and
  // notdef ranges still participate in tokenization and remain codespace
  // strict below.
  validateCMapMappingCodeSpaces(localCids, codeSpaces);
  validateLocalNotdefRanges(localNotdefRanges, codeSpaces);
  if (localNotdefRanges.some((ranges) => ranges.length > 0)) {
    notdefRangeLayers.push(Object.freeze(localNotdefRanges));
  }
  codeSpaces.sort((left, right) => right.byteLength - left.byteLength || left.start - right.start);
  return {
    codeSpaces: Object.freeze(codeSpaces),
    unicode: overlayCMapMappings(inherited?.unicode, localUnicode),
    cids: overlayCMapMappings(inherited?.cids, localCids),
    sourceByteCount,
    tokenCount,
    mappingOperationCount: mappingOperations,
    cidRangeLayers: Object.freeze(cidRangeLayers),
    cidRangeMappingCount,
    notdefRangeLayers: Object.freeze(notdefRangeLayers),
    notdefRangeMappingCount,
    writingMode,
    writingModeExplicit,
    identityBase,
    systemInfo: localSystemInfo === null
      ? inherited?.systemInfo ?? null
      : mergeCMapSystemInfo(inherited?.systemInfo ?? null, localSystemInfo, "program")
  };
}

type CMapToken =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "name" | "word"; readonly value: string }
  | { readonly kind: "hex" | "string"; readonly value: Uint8Array }
  | { readonly kind: "array-start" | "array-end" };

function tokenizeCMap(bytes: Uint8Array, maxTokens: number): CMapToken[] {
  const tokens: CMapToken[] = [];
  const push = (token: CMapToken): void => {
    if (tokens.length >= maxTokens) {
      throw new PdfError("resource-limit", "CMap token count exceeds the configured parser limit.", {
        details: { limit: maxTokens }
      });
    }
    tokens.push(token);
  };
  let offset = 0;
  while (offset < bytes.length) {
    const byte = bytes[offset];
    if (isCMapWhitespace(byte)) {
      offset += 1;
      continue;
    }
    if (byte === 0x25) {
      while (offset < bytes.length && bytes[offset] !== 0x0a && bytes[offset] !== 0x0d) offset += 1;
      continue;
    }
    if (byte === 0x5b || byte === 0x5d) {
      push({ kind: byte === 0x5b ? "array-start" : "array-end" });
      offset += 1;
      continue;
    }
    if (
      (byte === 0x3c && bytes[offset + 1] === 0x3c) ||
      (byte === 0x3e && bytes[offset + 1] === 0x3e)
    ) {
      offset += 2;
      continue;
    }
    if (byte === 0x28) {
      const previous = tokens.at(-1);
      if (
        previous?.kind === "name" &&
        (previous.value === "Registry" || previous.value === "Ordering")
      ) {
        const parsed = readCMapIdentityString(bytes, offset);
        push({ kind: "string", value: parsed.value });
        offset = parsed.offset;
      } else {
        offset = skipCMapLiteralString(bytes, offset);
      }
      continue;
    }
    if (byte === 0x3c && bytes[offset + 1] !== 0x3c) {
      const values: number[] = [];
      let high = -1;
      offset += 1;
      while (offset < bytes.length && bytes[offset] !== 0x3e) {
        if (isCMapWhitespace(bytes[offset])) {
          offset += 1;
          continue;
        }
        const nibble = hexNibble(bytes[offset++]);
        if (nibble < 0) throw unsupportedFont("CMap contains a malformed hex string.");
        if (high < 0) high = nibble;
        else {
          values.push((high << 4) | nibble);
          high = -1;
        }
      }
      if (offset >= bytes.length) throw unsupportedFont("CMap contains an unterminated hex string.");
      offset += 1;
      if (high >= 0) values.push(high << 4);
      push({ kind: "hex", value: Uint8Array.from(values) });
      continue;
    }
    const start = offset;
    const isName = byte === 0x2f;
    if (isName) offset += 1;
    while (offset < bytes.length && !isCMapDelimiter(bytes[offset])) offset += 1;
    const text = ascii(bytes, isName ? start + 1 : start, offset);
    if (!isName && /^[-+]?\d+$/.test(text)) {
      push({ kind: "number", value: Number(text) });
    } else if (text.length > 0) {
      push({ kind: isName ? "name" : "word", value: text });
    } else {
      // Dictionaries and literal strings are irrelevant to mapping blocks.
      offset += 1;
    }
  }
  return tokens;
}

function skipCMapLiteralString(bytes: Uint8Array, start: number): number {
  let depth = 1;
  let offset = start + 1;
  while (offset < bytes.length) {
    const byte = bytes[offset++];
    if (byte === 0x5c) {
      if (offset < bytes.length) offset += 1;
    } else if (byte === 0x28) {
      depth += 1;
    } else if (byte === 0x29) {
      depth -= 1;
      if (depth === 0) return offset;
    }
  }
  throw unsupportedFont("CMap contains an unterminated literal string.");
}

function readCMapIdentityString(
  bytes: Uint8Array,
  start: number
): { readonly value: Uint8Array; readonly offset: number } {
  const output: number[] = [];
  let depth = 1;
  let offset = start + 1;
  const push = (value: number): void => {
    if (output.length >= 127) {
      throw unsupportedFont("CMap /CIDSystemInfo strings exceed 127 bytes.");
    }
    output.push(value);
  };
  while (offset < bytes.length) {
    const byte = bytes[offset++];
    if (byte === 0x5c) {
      if (offset >= bytes.length) break;
      const escaped = bytes[offset++];
      if (escaped === 0x0a) continue;
      if (escaped === 0x0d) {
        if (bytes[offset] === 0x0a) offset += 1;
        continue;
      }
      const simple = escaped === 0x6e ? 0x0a
        : escaped === 0x72 ? 0x0d
          : escaped === 0x74 ? 0x09
            : escaped === 0x62 ? 0x08
              : escaped === 0x66 ? 0x0c
                : null;
      if (simple !== null) {
        push(simple);
        continue;
      }
      if (escaped >= 0x30 && escaped <= 0x37) {
        let value = escaped - 0x30;
        for (let count = 1; count < 3; count += 1) {
          const next = bytes[offset];
          if (next < 0x30 || next > 0x37) break;
          value = (value << 3) | (next - 0x30);
          offset += 1;
        }
        push(value & 0xff);
        continue;
      }
      push(escaped);
      continue;
    }
    if (byte === 0x28) {
      depth += 1;
      push(byte);
    } else if (byte === 0x29) {
      depth -= 1;
      if (depth === 0) return { value: Uint8Array.from(output), offset };
      push(byte);
    } else {
      push(byte);
    }
  }
  throw unsupportedFont("CMap contains an unterminated /CIDSystemInfo string.");
}

function findInlineUseCMaps(tokens: readonly CMapToken[]): readonly string[] {
  const names: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== "word" || token.value !== "usecmap") continue;
    const name = tokens[index - 1];
    if (name?.kind !== "name") throw unsupportedFont("CMap usecmap operand is not a name.");
    names.push(name.value);
  }
  return names;
}

function parseCMapSystemInfo(
  tokens: readonly CMapToken[]
): Readonly<NativeCidSystemInfo> | null {
  const markers = tokens
    .map((token, index) => token.kind === "name" && token.value === "CIDSystemInfo" ? index : -1)
    .filter((index) => index >= 0);
  if (markers.length === 0) return null;
  if (markers.length !== 1) {
    throw unsupportedFont("CMap contains more than one /CIDSystemInfo declaration.");
  }
  const start = markers[0] + 1;
  const endIndex = tokens.findIndex((token, index) =>
    index >= start && token.kind === "word" && token.value === "end"
  );
  const scope = tokens.slice(start, endIndex < 0 ? tokens.length : endIndex);
  const registry = requireCMapSystemInfoString(scope, "Registry");
  const ordering = requireCMapSystemInfoString(scope, "Ordering");
  const supplements = scope.flatMap((token, index) =>
    token.kind === "name" && token.value === "Supplement" ? [scope[index + 1]] : []
  );
  if (
    supplements.length !== 1 || supplements[0]?.kind !== "number" ||
    !Number.isSafeInteger(supplements[0].value) ||
    supplements[0].value < 0 || supplements[0].value > 0xffff
  ) {
    throw unsupportedFont("CMap /CIDSystemInfo has no valid /Supplement integer.");
  }
  return Object.freeze({ registry, ordering, supplement: supplements[0].value });
}

function requireCMapSystemInfoString(
  tokens: readonly CMapToken[],
  key: "Registry" | "Ordering"
): string {
  const values = tokens.flatMap((token, index) =>
    token.kind === "name" && token.value === key ? [tokens[index + 1]] : []
  );
  if (
    values.length !== 1 ||
    (values[0]?.kind !== "string" && values[0]?.kind !== "hex") ||
    values[0].value.length < 1 || values[0].value.length > 127
  ) {
    throw unsupportedFont(`CMap /CIDSystemInfo has no valid /${key} string.`);
  }
  // Mirrors readCidSystemInfoString: fixed-width padding with trailing NULs
  // is not part of the collection name, so it is trimmed before the
  // character check; every other non-printable byte remains an error.
  const bytes = values[0].value;
  let length = bytes.length;
  while (length > 0 && bytes[length - 1] === 0) length -= 1;
  if (length < 1) {
    throw unsupportedFont(
      `CMap /CIDSystemInfo /${key} must contain at least one non-NUL byte.`
    );
  }
  let result = "";
  for (let index = 0; index < length; index += 1) {
    const byte = bytes[index];
    if (byte < 0x20 || byte > 0x7e) {
      throw unsupportedFont(`CMap /CIDSystemInfo /${key} must contain printable ASCII.`);
    }
    result += String.fromCharCode(byte);
  }
  return result;
}

function requireCMapBlockCount(token: CMapToken | undefined, operator: string): number {
  if (token?.kind !== "number" || !Number.isSafeInteger(token.value) || token.value < 0) {
    throw unsupportedFont(`CMap ${operator} has no valid nonnegative entry count.`);
  }
  return token.value;
}

function requireCMapBlockEnd(token: CMapToken | undefined, expected: string): void {
  if (token?.kind !== "word" || token.value !== expected) {
    throw unsupportedFont(`CMap block is not terminated by ${expected}.`);
  }
}

function reserveCMapMappings(current: number, additional: number, limit: number): number {
  if (!Number.isSafeInteger(additional) || additional < 0 || additional > limit - current) {
    throw new PdfError("resource-limit", "CMap expansion exceeds the configured mapping limit.", {
      details: { limit }
    });
  }
  return current + additional;
}

/**
 * Retain local /UseCMap overrides as a shallow layer instead of cloning every
 * inherited mapping at every level. Iteration preserves Map's observable
 * ordering: inherited keys keep their position and new local keys append.
 */
class LayeredCMapMappings<Value> implements ReadonlyMap<string, Value> {
  readonly size: number;
  private readonly inherited: ReadonlyMap<string, Value>;
  private readonly local: ReadonlyMap<string, Value>;

  constructor(
    inherited: ReadonlyMap<string, Value>,
    local: ReadonlyMap<string, Value>
  ) {
    this.inherited = inherited;
    this.local = local;
    let added = 0;
    for (const key of local.keys()) {
      if (!inherited.has(key)) added += 1;
    }
    this.size = inherited.size + added;
  }

  get(key: string): Value | undefined {
    return this.local.has(key) ? this.local.get(key) : this.inherited.get(key);
  }

  has(key: string): boolean {
    return this.local.has(key) || this.inherited.has(key);
  }

  private *iterateEntries(): Generator<[string, Value], undefined, unknown> {
    for (const [key, inheritedValue] of this.inherited) {
      yield [key, this.local.has(key) ? this.local.get(key) as Value : inheritedValue];
    }
    for (const [key, value] of this.local) {
      if (!this.inherited.has(key)) yield [key, value];
    }
    return undefined;
  }

  entries(): MapIterator<[string, Value]> {
    return this.iterateEntries() as MapIterator<[string, Value]>;
  }

  private *iterateKeys(): Generator<string, undefined, unknown> {
    for (const [key] of this.iterateEntries()) yield key;
    return undefined;
  }

  keys(): MapIterator<string> {
    return this.iterateKeys() as MapIterator<string>;
  }

  private *iterateValues(): Generator<Value, undefined, unknown> {
    for (const [, value] of this.iterateEntries()) yield value;
    return undefined;
  }

  values(): MapIterator<Value> {
    return this.iterateValues() as MapIterator<Value>;
  }

  [Symbol.iterator](): MapIterator<[string, Value]> {
    return this.entries();
  }

  forEach(
    callback: (value: Value, key: string, map: ReadonlyMap<string, Value>) => void,
    thisArg?: unknown
  ): void {
    for (const [key, value] of this.entries()) callback.call(thisArg, value, key, this);
  }
}

function overlayCMapMappings<Value>(
  inherited: ReadonlyMap<string, Value> | undefined,
  local: ReadonlyMap<string, Value>
): ReadonlyMap<string, Value> {
  if (!inherited || inherited.size === 0) return local;
  if (local.size === 0) return inherited;
  return Object.freeze(new LayeredCMapMappings(inherited, local));
}

function setLocalCMapMapping<T>(
  mappings: Map<string, T>,
  localKeys: Set<string>,
  key: string,
  value: T,
  kind: "Unicode" | "CID"
): void {
  if (localKeys.has(key)) {
    throw unsupportedFont(`CMap contains overlapping local ${kind} mappings.`);
  }
  localKeys.add(key);
  // A local definition intentionally overrides the inherited /UseCMap value.
  mappings.set(key, value);
}

function addCodeSpaceRange(
  ranges: NativeCodeSpaceRange[],
  candidate: NativeCodeSpaceRange
): void {
  for (const existing of ranges) {
    if (
      existing.byteLength === candidate.byteLength &&
      existing.start === candidate.start &&
      existing.end === candidate.end
    ) {
      return;
    }
    if (codeSpaceRangesOverlap(existing, candidate)) {
      throw unsupportedFont("CMap codespace ranges overlap ambiguously.");
    }
  }
  ranges.push(candidate);
}

function addPredefinedCodeSpaceRange(
  ranges: NativeCodeSpaceRange[],
  candidate: NativeCodeSpaceRange
): void {
  for (const existing of ranges) {
    if (
      existing.byteLength === candidate.byteLength &&
      existing.start === candidate.start &&
      existing.end === candidate.end
    ) {
      return;
    }
    // Adobe's GB18030 CMaps deliberately distinguish two- and four-byte
    // codes through the second byte even though their numeric prefixes can
    // overlap. Same-length overlap remains ambiguous and is rejected.
    if (
      existing.byteLength === candidate.byteLength &&
      existing.start <= candidate.end && candidate.start <= existing.end
    ) {
      throw unsupportedFont("A bundled CMap has overlapping same-length codespaces.");
    }
  }
  ranges.push(candidate);
}

function codeSpaceRangesOverlap(left: NativeCodeSpaceRange, right: NativeCodeSpaceRange): boolean {
  if (left.byteLength === right.byteLength) {
    return left.start <= right.end && right.start <= left.end;
  }
  const shorter = left.byteLength < right.byteLength ? left : right;
  const longer = left.byteLength < right.byteLength ? right : left;
  const divisor = 2 ** ((longer.byteLength - shorter.byteLength) * 8);
  const prefixStart = Math.floor(longer.start / divisor);
  const prefixEnd = Math.floor(longer.end / divisor);
  return shorter.start <= prefixEnd && prefixStart <= shorter.end;
}

function validateCMapMappingCodeSpaces(
  mappings: ReadonlyMap<string, unknown>,
  ranges: readonly NativeCodeSpaceRange[]
): void {
  for (const key of mappings.keys()) {
    const separator = key.indexOf(":");
    const byteLength = Number(key.slice(0, separator));
    const code = Number(key.slice(separator + 1));
    if (!ranges.some((range) =>
      range.byteLength === byteLength && code >= range.start && code <= range.end
    )) {
      throw new PdfError(
        "unsupported-font",
        "CMap mapping lies outside every declared codespace range.",
        {
          details: {
            reason: "cmap-mapping-outside-codespace",
            byteLength,
            code,
            codeSpaces: ranges
              .map((range) => `${range.byteLength}:${range.start}-${range.end}`)
              .join(",")
          }
        }
      );
    }
  }
}

function validateLocalNotdefRanges(
  layers: [
    NativePredefinedCMapNotdefRange[],
    NativePredefinedCMapNotdefRange[],
    NativePredefinedCMapNotdefRange[],
    NativePredefinedCMapNotdefRange[]
  ],
  codeSpaces: readonly NativeCodeSpaceRange[]
): void {
  for (let byteLength = 1; byteLength <= 4; byteLength += 1) {
    const ranges = layers[byteLength - 1];
    ranges.sort((left, right) => left.start - right.start || left.end - right.end);
    let previousEnd = -1;
    for (const range of ranges) {
      if (range.start <= previousEnd) {
        throw unsupportedFont("CMap contains overlapping local notdef mappings.");
      }
      if (!codeSpaces.some((space) =>
        space.byteLength === byteLength && range.start >= space.start && range.end <= space.end
      )) {
        throw unsupportedFont("CMap notdef mapping lies outside every declared codespace range.");
      }
      previousEnd = range.end;
    }
    Object.freeze(ranges);
  }
}

function decodeCMapCode(
  bytes: Uint8Array,
  offset: number,
  codeSpaces: readonly NativeCodeSpaceRange[],
  mappings: Pick<ReadonlyMap<string, unknown>, "has"> |
    ((code: number, byteLength: number) => boolean)
): CMapEntry {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= bytes.length) {
    throw new RangeError("CMap decode offset is outside the source string.");
  }
  // Explicit ToUnicode mappings are authoritative even when a producer used
  // a generic, mismatched codespace declaration. Prefer the longest explicit
  // source, matching the normal descending-codespace lookup order. Encoding
  // CMaps pass a callback and remain strictly constrained to their codespaces.
  if (typeof mappings !== "function") {
    for (let byteLength = Math.min(MAX_CMAP_SOURCE_BYTES, bytes.length - offset);
      byteLength >= 1;
      byteLength -= 1) {
      const code = readCode(bytes, offset, byteLength);
      if (mappings.has(cmapKey(code, byteLength))) return { code, byteLength };
    }
  }
  let codespaceFallback: CMapEntry | null = null;
  for (const range of codeSpaces) {
    if (offset + range.byteLength > bytes.length) continue;
    const code = readCode(bytes, offset, range.byteLength);
    if (code < range.start || code > range.end) continue;
    const entry = { code, byteLength: range.byteLength };
    const mapped = typeof mappings === "function"
      ? mappings(code, range.byteLength)
      : mappings.has(cmapKey(code, range.byteLength));
    if (mapped) return entry;
    if (!codespaceFallback || entry.byteLength < codespaceFallback.byteLength) {
      codespaceFallback = entry;
    }
  }
  if (codespaceFallback) return codespaceFallback;
  throw unsupportedFont("A PDF string contains a code outside the font CMap codespaces.");
}

function getCMapCid(
  cmap: ParsedCMap,
  key: string,
  code: number,
  byteLength: number
): number | null {
  const explicit = cmap.cids.get(key);
  if (explicit !== undefined) return explicit;
  for (let layerIndex = cmap.cidRangeLayers.length - 1; layerIndex >= 0; layerIndex -= 1) {
    const ranges = cmap.cidRangeLayers[layerIndex][byteLength - 1];
    let low = 0;
    let high = ranges.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const range = ranges[middle];
      if (code < range.start) high = middle - 1;
      else if (code > range.end) low = middle + 1;
      else return range.firstCid + code - range.start;
    }
  }
  for (let layerIndex = cmap.notdefRangeLayers.length - 1; layerIndex >= 0; layerIndex -= 1) {
    const ranges = cmap.notdefRangeLayers[layerIndex][byteLength - 1];
    let low = 0;
    let high = ranges.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const range = ranges[middle];
      if (code < range.start) high = middle - 1;
      else if (code > range.end) low = middle + 1;
      else return range.cid;
    }
  }
  return null;
}

function parseCidWidths(
  values: readonly PdfValue[] | null,
  maxEntries: number
): ReadonlyMap<number, number> {
  const result = new Map<number, number>();
  if (!values) return result;
  let offset = 0;
  let metricOperations = 0;
  while (offset < values.length) {
    const first = requireIntegerValue(values[offset++], "CID width start");
    if (first > MAX_CID) throw unsupportedFont("CID width start exceeds 65535.");
    const next = values[offset++];
    if (Array.isArray(next)) {
      metricOperations = reserveCidMetrics(metricOperations, next.length, maxEntries);
      if (next.length > MAX_CID - first + 1) {
        throw unsupportedFont("CID width array exceeds the 16-bit CID space.");
      }
      for (let index = 0; index < next.length; index += 1) {
        result.set(first + index, requireNumberValue(next[index], "CID width"));
      }
    } else {
      const last = requireIntegerValue(next, "CID width end");
      const width = requireNumberValue(values[offset++], "CID width");
      if (last < first || last > MAX_CID) throw unsupportedFont("CID width range is invalid.");
      metricOperations = reserveCidMetrics(metricOperations, last - first + 1, maxEntries);
      for (let cid = first; cid <= last; cid += 1) result.set(cid, width);
    }
  }
  return result;
}

function parseCidVerticalMetrics(
  values: readonly PdfValue[] | null,
  maxEntries: number
): ReadonlyMap<number, NativeVerticalMetric> {
  const result = new Map<number, NativeVerticalMetric>();
  if (!values) return result;
  let offset = 0;
  let metricOperations = 0;
  while (offset < values.length) {
    const first = requireIntegerValue(values[offset++], "vertical CID start");
    if (first > MAX_CID) throw unsupportedFont("Vertical CID start exceeds 65535.");
    const next = values[offset++];
    if (Array.isArray(next)) {
      if (next.length % 3 !== 0) throw unsupportedFont("A vertical CID metric array is truncated.");
      const entryCount = next.length / 3;
      metricOperations = reserveCidMetrics(metricOperations, entryCount, maxEntries);
      if (entryCount > MAX_CID - first + 1) {
        throw unsupportedFont("Vertical CID metric array exceeds the 16-bit CID space.");
      }
      for (let index = 0; index < next.length; index += 3) {
        result.set(first + index / 3, {
          advanceY: requireNumberValue(next[index], "vertical advance"),
          originX: requireNumberValue(next[index + 1], "vertical origin x"),
          originY: requireNumberValue(next[index + 2], "vertical origin y")
        });
      }
    } else {
      const last = requireIntegerValue(next, "vertical CID end");
      const metric = {
        advanceY: requireNumberValue(values[offset++], "vertical advance"),
        originX: requireNumberValue(values[offset++], "vertical origin x"),
        originY: requireNumberValue(values[offset++], "vertical origin y")
      };
      if (last < first || last > MAX_CID) throw unsupportedFont("Vertical CID metric range is invalid.");
      metricOperations = reserveCidMetrics(metricOperations, last - first + 1, maxEntries);
      for (let cid = first; cid <= last; cid += 1) result.set(cid, metric);
    }
  }
  return result;
}

async function readCidToGidMap(
  value: PdfValue | undefined,
  resolver: NativePdfFontResolver,
  signal?: AbortSignal
): Promise<(cid: number) => number> {
  const resolved = await resolver.resolveValue(value, signal);
  if (resolved === undefined || resolved === null || isPdfName(resolved, "Identity")) {
    return (cid) => cid;
  }
  if (!isPdfStream(resolved)) throw unsupportedFont("CIDToGIDMap must be /Identity or a stream.");
  const bytes = await resolver.decodeStream(resolved, signal);
  if (bytes.length % 2 !== 0 || bytes.length > (MAX_CID + 1) * 2) {
    throw unsupportedFont("CIDToGIDMap stream has invalid 16-bit table bounds.");
  }
  return (cid) => {
    if (!Number.isSafeInteger(cid) || cid < 0 || cid > MAX_CID) return 0;
    const offset = cid * 2;
    return offset + 1 < bytes.length ? (bytes[offset] << 8) | bytes[offset + 1] : 0;
  };
}

async function parseFontDescriptor(
  value: PdfValue | undefined,
  resolver: NativePdfFontResolver,
  signal?: AbortSignal
): Promise<NativeFontDescriptor> {
  if (value === undefined || value === null) return EMPTY_DESCRIPTOR;
  const dictionary = await requireDictionary(value, resolver, signal, "font descriptor");
  let embeddedKind: NativeFontDescriptor["embeddedKind"] = null;
  if (dictionary.has("FontFile")) embeddedKind = "type1";
  if (dictionary.has("FontFile2")) embeddedKind = "truetype";
  if (dictionary.has("FontFile3")) {
    const fontFile = await resolver.resolveValue(dictionary.get("FontFile3"), signal);
    if (isPdfStream(fontFile)) {
      const subtype = optionalName(fontFile.dictionary.get("Subtype"));
      embeddedKind = subtype === "OpenType" ? "opentype"
        : subtype === "CIDFontType0C" || subtype === "Type1C" ? "cff"
          : subtype === "CFF2" ? "cff2"
            : "opentype";
    }
  }
  const flags = integerOr(await resolver.resolveValue(dictionary.get("Flags"), signal), 0);
  const ascent = numberOr(await resolver.resolveValue(dictionary.get("Ascent"), signal), 800);
  const descent = numberOr(await resolver.resolveValue(dictionary.get("Descent"), signal), -200);
  const missingWidth = numberOr(
    await resolver.resolveValue(dictionary.get("MissingWidth"), signal),
    0
  );
  const fontBBox = await resolveNumberArray(
    dictionary.get("FontBBox"),
    4,
    resolver,
    signal
  );
  const familyValue = await resolver.resolveValue(dictionary.get("FontFamily"), signal);
  const stretchValue = await resolver.resolveValue(dictionary.get("FontStretch"), signal);
  const weightValue = finiteNumber(await resolver.resolveValue(dictionary.get("FontWeight"), signal));
  const italicAngle = numberOr(
    await resolver.resolveValue(dictionary.get("ItalicAngle"), signal),
    0
  );
  return Object.freeze({
    flags,
    ascent,
    descent,
    missingWidth,
    fontBBox: fontBBox
      ? [fontBBox[0], fontBBox[1], fontBBox[2], fontBBox[3]] as const
      : null,
    embeddedKind,
    family: isPdfString(familyValue) ? decodePdfTextString(familyValue.bytes) : null,
    stretch: optionalName(stretchValue),
    weight: weightValue !== null && weightValue > 0 ? weightValue : null,
    italicAngle,
    capHeight: finiteNumber(await resolver.resolveValue(dictionary.get("CapHeight"), signal)),
    xHeight: finiteNumber(await resolver.resolveValue(dictionary.get("XHeight"), signal)),
    stemV: finiteNumber(await resolver.resolveValue(dictionary.get("StemV"), signal))
  });
}

function deriveFontStyle(
  baseFont: string,
  descriptor: NativeFontDescriptor
): NativeFontStyleMetadata {
  const normalizedName = stripSubsetPrefix(baseFont);
  const forceBold = (descriptor.flags & (1 << 18)) !== 0;
  const inferredBold = /(?:^|[-_, ])(?:bold|black|heavy|semibold|demibold)(?:$|[-_, ])/i.test(normalizedName);
  const inferredItalic = /(?:^|[-_, ])(?:italic|oblique)(?:$|[-_, ])/i.test(normalizedName);
  return Object.freeze({
    family: descriptor.family ?? inferFontFamily(normalizedName),
    weight: descriptor.weight ?? (forceBold || inferredBold ? 700 : 400),
    stretch: descriptor.stretch,
    italicAngle: descriptor.italicAngle,
    fixedPitch: (descriptor.flags & 1) !== 0,
    serif: (descriptor.flags & (1 << 1)) !== 0,
    symbolic: (descriptor.flags & (1 << 2)) !== 0,
    script: (descriptor.flags & (1 << 3)) !== 0,
    italic: (descriptor.flags & (1 << 6)) !== 0 || descriptor.italicAngle !== 0 || inferredItalic,
    allCaps: (descriptor.flags & (1 << 16)) !== 0,
    smallCaps: (descriptor.flags & (1 << 17)) !== 0,
    forceBold
  });
}

function inferFontFamily(baseFont: string): string | null {
  if (!baseFont) return null;
  const family = baseFont
    .replace(/(?:[-_, ])(?:bolditalic|boldoblique|semibold|demibold|bold|black|heavy|italic|oblique)$/i, "")
    .trim();
  return family || baseFont;
}

interface ResolvedMissingSfnt {
  readonly sfnt: NativeSfntFont;
  readonly substitution: NativeFontSubstitution;
  readonly diagnostics: readonly PdfDiagnostic[];
}

async function resolveMissingSfnt(
  requestValue: NativeMissingFontRequest,
  options: ParseNativePdfFontOptions
): Promise<ResolvedMissingSfnt | null> {
  const missingFontResolver = options.missingFontResolver;
  if (!missingFontResolver) return null;
  const request = Object.freeze({ ...requestValue });
  throwIfAborted(options.signal);
  let resolution: NativeMissingFontResolution | null;
  try {
    resolution = await missingFontResolver(request, options.signal);
  } catch (cause) {
    if (cause instanceof PdfError && cause.code === "aborted") throw cause;
    throwIfAborted(options.signal);
    throw new PdfError(
      "unsupported-font",
      `The missing-font resolver failed for ${request.baseFont || "(unnamed)"}.`,
      { cause }
    );
  }
  throwIfAborted(options.signal);
  if (resolution === null) return null;
  const result = resolution instanceof Uint8Array
    ? { sfntBytes: resolution }
    : resolution;
  if (
    !result || typeof result !== "object" ||
    !(result.sfntBytes instanceof Uint8Array)
  ) {
    throw unsupportedFont("The missing-font resolver returned an invalid result.");
  }
  const faceIndex = result.faceIndex ?? 0;
  if (!Number.isSafeInteger(faceIndex) || faceIndex < 0) {
    throw unsupportedFont("The missing-font resolver returned an invalid sfnt face index.");
  }
  if (
    result.identifier !== undefined &&
    (typeof result.identifier !== "string" || result.identifier.length === 0 ||
      result.identifier.length > 256 || /[\u0000-\u001f\u007f]/.test(result.identifier))
  ) {
    throw unsupportedFont("The missing-font resolver returned an invalid identifier.");
  }
  // The parser retains the sfnt through DataView-backed tables, so copy caller
  // bytes before validation to make ownership and subsequent output stable.
  const ownedBytes = new Uint8Array(result.sfntBytes);
  if (!looksLikeSfnt(ownedBytes)) {
    throw unsupportedFont("The missing-font resolver returned bytes without a valid sfnt signature.");
  }
  const sfnt = NativeSfntFont.parse(ownedBytes, faceIndex, options.parserLimits);
  throwIfAborted(options.signal);
  if (sfnt.outlineFormat === "cff" || sfnt.outlineFormat === "cff2") {
    throw unsupportedFont(
      "A caller-provided CFF/CFF2 substitute requires the native CFF kernel, which is not available."
    );
  }
  if (sfnt.outlineFormat !== "glyf") {
    throw unsupportedFont("A caller-provided substitute has no supported TrueType outline table.");
  }
  const identifier = result.identifier ?? fingerprintSfnt(ownedBytes, faceIndex);
  const substitution: NativeFontSubstitution = Object.freeze({
    kind: "caller-sfnt",
    requestedBaseFont: request.baseFont,
    normalizedBaseFont: request.normalizedBaseFont,
    requestedSubtype: request.subtype,
    descendantSubtype: request.descendantSubtype,
    identifier,
    faceIndex,
    byteLength: ownedBytes.length,
    outlineFormat: "glyf"
  });
  const diagnostic: PdfDiagnostic = Object.freeze({
    code: "font.missing-substituted",
    severity: "warning",
    message: `Missing font ${request.baseFont || "(unnamed)"} was replaced by caller asset ${identifier}.`,
    details: Object.freeze({
      baseFont: request.baseFont,
      normalizedBaseFont: request.normalizedBaseFont,
      subtype: request.subtype,
      substituteIdentifier: identifier,
      faceIndex,
      byteLength: ownedBytes.length
    })
  });
  options.onDiagnostic?.(diagnostic);
  return Object.freeze({
    sfnt,
    substitution,
    diagnostics: Object.freeze([diagnostic])
  });
}

function fingerprintSfnt(bytes: Uint8Array, faceIndex: number): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9 ^ faceIndex;
  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 0x01000193) >>> 0;
    second = Math.imul(second ^ byte, 0x85ebca6b) >>> 0;
  }
  return `sfnt-${bytes.length}-${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function decodePdfTextString(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let output = "";
    for (let offset = 2; offset + 1 < bytes.length; offset += 2) {
      output += String.fromCharCode((bytes[offset] << 8) | bytes[offset + 1]);
    }
    return output;
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  let output = "";
  for (const byte of bytes) output += String.fromCharCode(byte);
  return output;
}

async function readEmbeddedSfnt(
  fontDictionary: PdfDictionary,
  descriptor: NativeFontDescriptor,
  resolver: NativePdfFontResolver,
  limits: Readonly<NativeSfntParserLimits>,
  signal?: AbortSignal
): Promise<NativeSfntFont | null> {
  if (
    descriptor.embeddedKind === "cff" || descriptor.embeddedKind === "cff2" ||
    descriptor.embeddedKind === "type1"
  ) return null;
  const descriptorValue = fontDictionary.get("FontDescriptor");
  if (descriptorValue === undefined) return null;
  const descriptorDictionary = await requireDictionary(
    descriptorValue,
    resolver,
    signal,
    "font descriptor"
  );
  const fileValue = descriptorDictionary.get("FontFile2") ?? descriptorDictionary.get("FontFile3");
  if (fileValue === undefined) return null;
  const stream = await resolver.resolveValue(fileValue, signal);
  if (!isPdfStream(stream)) throw unsupportedFont("An embedded font file is not a stream.");
  const bytes = await resolver.decodeStream(stream, signal);
  throwIfAborted(signal);
  if (!looksLikeSfnt(bytes)) {
    throw unsupportedFont("The embedded TrueType/OpenType font has an invalid sfnt header.");
  }
  // Embedded PDF subsets are frequently produced with stale checksums or
  // dangling directory entries for metadata tables such as OS/2. None of
  // those records participate in HEPR's glyph mapping, metrics, or outlines.
  // Keep every table we do consume fully bounds checked, while treating the
  // unused directory metadata as advisory at this PDF trust boundary.
  return NativeSfntFont.parse(bytes, 0, limits, "pdf-embedded");
}

async function readEmbeddedCff(
  fontDictionary: PdfDictionary,
  descriptor: NativeFontDescriptor,
  resolver: NativePdfFontResolver,
  limits: Readonly<NativeCffParserLimits>,
  signal?: AbortSignal
): Promise<NativeCffFont | null> {
  if (descriptor.embeddedKind !== "cff") return null;
  const descriptorValue = fontDictionary.get("FontDescriptor");
  if (descriptorValue === undefined) return null;
  const descriptorDictionary = await requireDictionary(
    descriptorValue,
    resolver,
    signal,
    "font descriptor"
  );
  const value = descriptorDictionary.get("FontFile3");
  if (value === undefined) {
    throw unsupportedFont("A CFF font descriptor has no /FontFile3 stream.");
  }
  const stream = await resolver.resolveValue(value, signal);
  if (!isPdfStream(stream)) throw unsupportedFont("An embedded CFF font file is not a stream.");
  const subtype = optionalName(await resolver.resolveValue(stream.dictionary.get("Subtype"), signal));
  if (subtype !== "Type1C") {
    throw unsupportedFont(`Embedded CFF stream subtype /${subtype ?? "(missing)"} is not supported.`);
  }
  const bytes = await resolver.decodeStream(stream, signal);
  throwIfAborted(signal);
  return NativeCffFont.parse(bytes, limits);
}

function reportFontDiagnostics(
  diagnostics: readonly PdfDiagnostic[],
  options: ParseNativePdfFontOptions
): void {
  for (const diagnostic of diagnostics) options.onDiagnostic?.(diagnostic);
}

function embeddedHmtxDiagnostic(
  delta: number,
  numGlyphs: number,
  numberOfHMetrics: number,
  actualLength: number,
  expectedLength: number,
  firstRecoveredGlyph: number
): PdfDiagnostic {
  const missing = delta < 0;
  const details = missing
    ? Object.freeze({
        reason: "hmtx-missing-bearings",
        numGlyphs,
        numberOfHMetrics,
        actualLength,
        expectedLength,
        recoveredBearingCount: numGlyphs - firstRecoveredGlyph
      })
    : Object.freeze({
        reason: "hmtx-trailing-bytes",
        numGlyphs,
        numberOfHMetrics,
        actualLength,
        expectedLength,
        ignoredByteCount: delta
      });
  return Object.freeze({
    code: "font.sfnt-horizontal-metrics-normalized",
    severity: "warning",
    message: missing
      ? "An embedded sfnt omitted trailing horizontal bearings; exact values were recovered from glyph xMin bounds."
      : "An embedded sfnt contained a bounded unreachable hmtx tail; the tail was ignored.",
    details
  });
}

interface SfntTable {
  readonly offset: number;
  readonly length: number;
  readonly checksum?: number;
}

interface SfntProtectedRange {
  readonly offset: number;
  readonly length: number;
}

interface GlyphPoint {
  readonly x: number;
  readonly y: number;
  readonly onCurve: boolean;
}

interface ParsedGlyphGeometry {
  readonly points: readonly GlyphPoint[];
  readonly contourEnds: readonly number[];
  readonly bounds: readonly [number, number, number, number];
  readonly metricsGlyphId: number;
}

interface GlyphReadBudget {
  components: number;
  points: number;
}

interface MaxpTrueTypeProfile {
  readonly maxPoints: number;
  readonly maxContours: number;
  readonly maxCompositePoints: number;
  readonly maxCompositeContours: number;
  readonly maxSizeOfInstructions: number;
  readonly maxComponentElements: number;
  readonly maxComponentDepth: number;
}

interface CmapLookup {
  readonly platform: number;
  readonly encoding: number;
  readonly format: number;
  readonly language: number;
  readonly priority: number;
  lookup(codePoint: number): number;
}

type VariationCmapResult =
  | { readonly kind: "default" }
  | { readonly kind: "glyph"; readonly glyphId: number }
  | { readonly kind: "unsupported" };

interface VariationCmapLookup {
  lookup(codePoint: number, variationSelector: number): VariationCmapResult | undefined;
}

interface SfntCmaps {
  readonly base: readonly CmapLookup[];
  readonly variation: readonly VariationCmapLookup[];
}

/** Bounds-checked sfnt reader for TrueType/OpenType cmap, metrics, and glyf outlines. */
export class NativeSfntFont {
  readonly unitsPerEm: number;
  readonly numGlyphs: number;
  readonly ascender: number;
  readonly descender: number;
  readonly lineGap: number;
  readonly fontBounds: readonly [number, number, number, number];
  readonly outlineFormat: "glyf" | "cff" | "cff2" | "unknown";
  readonly diagnostics: readonly PdfDiagnostic[];

  private readonly view: DataView;
  private readonly tables: ReadonlyMap<string, SfntTable>;
  private readonly unicodeCmap: CmapLookup | null;
  private readonly symbolCmap: CmapLookup | null;
  private readonly variationCmaps: readonly VariationCmapLookup[];
  private readonly limits: Readonly<NativeSfntParserLimits>;
  private readonly validation: "strict" | "pdf-embedded";
  private readonly numberOfHMetrics: number;
  private readonly firstRecoveredHorizontalBearingGlyph: number;
  private readonly indexToLocFormat: number;
  private readonly glyphLocations: Uint32Array | null;
  private readonly maxpProfile: MaxpTrueTypeProfile | null;
  private readonly outlineCache = new Map<number, NativeGlyphOutline>();

  private constructor(
    bytes: Uint8Array,
    faceOffset: number,
    limits: Readonly<NativeSfntParserLimits>,
    protectedRanges: readonly SfntProtectedRange[] = Object.freeze([]),
    validation: "strict" | "pdf-embedded" = "strict"
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.limits = limits;
    this.validation = validation;
    this.tables = readSfntTables(
      this.view,
      faceOffset,
      limits,
      protectedRanges,
      validation
    );
    const head = this.requireTable("head");
    const maxp = this.requireTable("maxp");
    const hhea = this.requireTable("hhea");
    const hmtx = this.requireTable("hmtx");
    requireSfntTableLength(head, 54, "head");
    requireSfntTableLength(maxp, 6, "maxp");
    requireSfntTableLength(hhea, 36, "hhea");
    if (head.length !== 54 || hhea.length !== 36) {
      throw unsupportedFont("The sfnt head or hhea table has an invalid length.");
    }
    const hasDeclaredChecksums = [...this.tables.values()]
      .some((table) => table.checksum !== 0);
    if (
      hasDeclaredChecksums &&
      (
        this.u32(head.offset, head) !== 0x00010000 ||
        this.u32(head.offset + 12, head) !== 0x5f0f3cf5 ||
        this.i16(head.offset + 52, head) !== 0 ||
        this.u32(hhea.offset, hhea) !== 0x00010000
      )
    ) {
      throw unsupportedFont("The checked sfnt head or hhea header is invalid.");
    }
    this.unitsPerEm = this.u16(head.offset + 18, head);
    this.indexToLocFormat = this.i16(head.offset + 50, head);
    this.numGlyphs = this.u16(maxp.offset + 4, maxp);
    this.ascender = this.i16(hhea.offset + 4, hhea);
    this.descender = this.i16(hhea.offset + 6, hhea);
    this.lineGap = this.i16(hhea.offset + 8, hhea);
    this.fontBounds = freezeBounds([
      this.i16(head.offset + 36, head),
      this.i16(head.offset + 38, head),
      this.i16(head.offset + 40, head),
      this.i16(head.offset + 42, head)
    ], "sfnt head");
    this.numberOfHMetrics = this.u16(hhea.offset + 34, hhea);
    if (this.unitsPerEm < 16 || this.unitsPerEm > 16_384) {
      throw unsupportedFont("The sfnt unitsPerEm value is outside the valid range.");
    }
    if (this.indexToLocFormat !== 0 && this.indexToLocFormat !== 1) {
      throw unsupportedFont("The TrueType head table has an invalid indexToLocFormat.");
    }
    if (this.numGlyphs < 1 || this.numberOfHMetrics < 1 || this.numberOfHMetrics > this.numGlyphs) {
      throw unsupportedFont("The sfnt glyph or horizontal-metric count is invalid.");
    }
    if (this.i16(hhea.offset + 32, hhea) !== 0) {
      throw unsupportedFont("The sfnt hhea metricDataFormat is unsupported.");
    }
    const longMetricBytes = checkedSfntMultiply(
      this.numberOfHMetrics,
      4,
      "hmtx metrics"
    );
    const expectedHmtxLength = checkedSfntAdd(
      longMetricBytes,
      checkedSfntMultiply(this.numGlyphs - this.numberOfHMetrics, 2, "hmtx bearings"),
      "hmtx length"
    );
    // Some PDF subsetters omit a suffix of hmtx's trailing LSB array while
    // preserving head.flags bit 1, which makes each omitted value exactly the
    // corresponding glyph xMin. Others include final alignment bytes or two
    // stale trailing bearings. Keep strict fonts exact; for embedded subsets,
    // recover only the first form from fully bounded glyf/loca data and ignore
    // at most the already established four-byte unreachable tail.
    const embeddedHmtxDelta = validation === "pdf-embedded"
      ? hmtx.length - expectedHmtxLength
      : 0;
    const availableBearingBytes = hmtx.length - longMetricBytes;
    const canRecoverMissingBearings =
      validation === "pdf-embedded" && embeddedHmtxDelta < 0 &&
      availableBearingBytes >= 0 && availableBearingBytes % 2 === 0 &&
      (this.u16(head.offset + 16, head) & 0x0002) !== 0 &&
      this.tables.has("glyf") && this.tables.has("loca");
    const canIgnoreTrailingBytes =
      validation === "pdf-embedded" &&
      embeddedHmtxDelta > 0 && embeddedHmtxDelta <= 4;
    if (
      hmtx.length !== expectedHmtxLength &&
      !canRecoverMissingBearings && !canIgnoreTrailingBytes
    ) {
      throw unsupportedFont("The sfnt hhea/hmtx metric counts are inconsistent.");
    }
    this.firstRecoveredHorizontalBearingGlyph = canRecoverMissingBearings
      ? this.numberOfHMetrics + availableBearingBytes / 2
      : this.numGlyphs;
    this.diagnostics = embeddedHmtxDelta === 0
      ? EMPTY_DIAGNOSTICS
      : Object.freeze([embeddedHmtxDiagnostic(
          embeddedHmtxDelta,
          this.numGlyphs,
          this.numberOfHMetrics,
          hmtx.length,
          expectedHmtxLength,
          this.firstRecoveredHorizontalBearingGlyph
        )]);
    const maxpVersion = this.u32(maxp.offset, maxp);
    if (maxpVersion !== 0x00005000 && maxpVersion !== 0x00010000) {
      throw unsupportedFont("The sfnt maxp table has an unsupported version.");
    }
    if (this.tables.has("glyf") && maxpVersion !== 0x00010000) {
      throw unsupportedFont("A TrueType glyf table requires maxp version 1.0.");
    }
    if (
      maxpVersion === 0x00010000 && maxp.length !== 32 &&
      !(maxp.length === 6 && maxp.checksum === 0)
    ) {
      throw unsupportedFont("The TrueType maxp table has an invalid length.");
    }
    if (maxpVersion === 0x00005000 && maxp.length !== 6) {
      throw unsupportedFont("The CFF maxp table has an invalid length.");
    }
    this.maxpProfile = maxpVersion === 0x00010000 && maxp.length >= 32
      ? Object.freeze({
          maxPoints: this.u16(maxp.offset + 6, maxp),
          maxContours: this.u16(maxp.offset + 8, maxp),
          maxCompositePoints: this.u16(maxp.offset + 10, maxp),
          maxCompositeContours: this.u16(maxp.offset + 12, maxp),
          maxSizeOfInstructions: this.u16(maxp.offset + 26, maxp),
          maxComponentElements: this.u16(maxp.offset + 28, maxp),
          maxComponentDepth: this.u16(maxp.offset + 30, maxp)
        })
      : null;
    if (
      this.maxpProfile !== null &&
      (this.u16(maxp.offset + 14, maxp) < 1 || this.u16(maxp.offset + 14, maxp) > 2)
    ) {
      throw unsupportedFont("The TrueType maxp maxZones value is invalid.");
    }
    const cmaps = readSfntCmaps(this.view, this.tables.get("cmap"), limits);
    this.unicodeCmap = cmaps.base.find((cmap) => cmap.platform !== 3 || cmap.encoding !== 0) ?? null;
    this.symbolCmap = cmaps.base.find((cmap) => cmap.platform === 3 && cmap.encoding === 0) ?? null;
    this.variationCmaps = cmaps.variation;
    if (
      this.tables.has("glyf") !== this.tables.has("loca") &&
      !(this.tables.has("loca") && (this.tables.has("CFF ") || this.tables.has("CFF2")))
    ) {
      throw unsupportedFont("The sfnt must provide glyf and loca tables together.");
    }
    if (
      this.tables.has("glyf") &&
      (this.tables.has("CFF ") || this.tables.has("CFF2"))
    ) {
      throw unsupportedFont("The sfnt mixes TrueType and CFF outline tables.");
    }
    if (this.tables.has("CFF ") && this.tables.has("CFF2")) {
      throw unsupportedFont("The sfnt contains both CFF and CFF2 outline tables.");
    }
    this.outlineFormat = this.tables.has("glyf") && this.tables.has("loca") ? "glyf"
      : this.tables.has("CFF2") ? "cff2"
        : this.tables.has("CFF ") ? "cff"
          : "unknown";
    this.glyphLocations = this.outlineFormat === "glyf"
      ? this.readGlyphLocations()
      : null;
  }

  static parse(
    bytes: Uint8Array,
    faceIndex = 0,
    limitOverrides?: Partial<NativeSfntParserLimits>,
    validation: "strict" | "pdf-embedded" = "strict"
  ): NativeSfntFont {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 12) {
      throw unsupportedFont("The embedded sfnt font is truncated.");
    }
    const limits = mergeSfntParserLimits(limitOverrides);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let faceOffset = 0;
    let protectedRanges: readonly SfntProtectedRange[] = Object.freeze([]);
    if (readTag(view, 0) === "ttcf") {
      const version = safeU32(view, 4);
      if (version !== 0x00010000 && version !== 0x00020000) {
        throw unsupportedFont("The TrueType Collection has an unsupported version.");
      }
      const count = safeU32(view, 8);
      if (count < 1) {
        throw unsupportedFont("The TrueType Collection has no faces.");
      }
      if (count > limits.maxSfntFaces) {
        throw sfntLimit("The TrueType Collection face count exceeds the configured limit.");
      }
      const faceDirectoryEnd = checkedSfntAdd(
        12,
        checkedSfntMultiply(count, 4, "TTC face offsets"),
        "TTC header"
      );
      const headerEnd = version === 0x00020000
        ? checkedSfntAdd(faceDirectoryEnd, 12, "TTC v2 header")
        : faceDirectoryEnd;
      if (headerEnd > view.byteLength) {
        throw unsupportedFont("The TrueType Collection header is truncated.");
      }
      if (!Number.isSafeInteger(faceIndex) || faceIndex < 0 || faceIndex >= count) {
        throw unsupportedFont("The requested TrueType Collection face is out of range.");
      }
      const seenFaceOffsets = new Set<number>();
      const faceOffsets: number[] = [];
      for (let index = 0; index < count; index += 1) {
        const candidate = safeU32(view, 12 + index * 4);
        if (
          candidate % 4 !== 0 || candidate < headerEnd ||
          !sfntRangeFits(candidate, 12, view.byteLength) || seenFaceOffsets.has(candidate)
        ) {
          throw unsupportedFont("A TrueType Collection face offset is invalid.");
        }
        seenFaceOffsets.add(candidate);
        faceOffsets.push(candidate);
        if (index === faceIndex) faceOffset = candidate;
      }
      const mutableProtectedRanges: SfntProtectedRange[] = [{ offset: 0, length: headerEnd }];
      for (const candidate of faceOffsets) {
        const signature = safeU32(view, candidate);
        if (!isSfntFaceSignature(signature)) {
          throw unsupportedFont("A TrueType Collection face has an unsupported sfnt signature.");
        }
        const tableCount = view.getUint16(candidate + 4, false);
        if (tableCount < 1) {
          throw unsupportedFont("A TrueType Collection face has no tables.");
        }
        if (tableCount > limits.maxSfntTables) {
          throw sfntLimit("A TrueType Collection face exceeds the sfnt table-count limit.");
        }
        const faceDirectoryLength = checkedSfntAdd(
          12,
          checkedSfntMultiply(tableCount, 16, "TTC face table records"),
          "TTC face directory"
        );
        if (!sfntRangeFits(candidate, faceDirectoryLength, view.byteLength)) {
          throw unsupportedFont("A TrueType Collection face directory is truncated.");
        }
        if (
          mutableProtectedRanges.some((range) =>
            rangesOverlap(candidate, faceDirectoryLength, range.offset, range.length)
          )
        ) {
          throw unsupportedFont("TrueType Collection face directories overlap.");
        }
        mutableProtectedRanges.push({ offset: candidate, length: faceDirectoryLength });
      }
      if (version === 0x00020000) {
        const dsigTag = safeU32(view, faceDirectoryEnd);
        const dsigLength = safeU32(view, faceDirectoryEnd + 4);
        const dsigOffset = safeU32(view, faceDirectoryEnd + 8);
        const absent = dsigTag === 0 && dsigLength === 0 && dsigOffset === 0;
        const present = dsigTag === 0x44534947 && dsigLength > 0 &&
          sfntRangeFits(dsigOffset, dsigLength, view.byteLength);
        if (!absent && !present) {
          throw unsupportedFont("The TrueType Collection DSIG range is invalid.");
        }
        if (present) {
          if (
            mutableProtectedRanges.some((range) =>
              rangesOverlap(dsigOffset, dsigLength, range.offset, range.length)
            )
          ) {
            throw unsupportedFont("The TrueType Collection DSIG overlaps structural data.");
          }
          mutableProtectedRanges.push({ offset: dsigOffset, length: dsigLength });
        }
      }
      protectedRanges = Object.freeze(
        mutableProtectedRanges.map((range) => Object.freeze(range))
      );
    } else if (faceIndex !== 0) {
      throw unsupportedFont("A non-collection sfnt has only face zero.");
    }
    return new NativeSfntFont(bytes, faceOffset, limits, protectedRanges, validation);
  }

  mapCodePoint(codePoint: number, variationSelector?: number): number {
    if (
      !Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff ||
      unicodeRangeContainsSurrogates(codePoint, codePoint)
    ) return 0;
    if (variationSelector !== undefined) {
      if (
        !Number.isInteger(variationSelector) ||
        !isUnicodeVariationSelector(variationSelector)
      ) return 0;
      for (const cmap of this.variationCmaps) {
        const variation = cmap.lookup(codePoint, variationSelector);
        if (variation === undefined) continue;
        if (variation.kind === "unsupported") return 0;
        if (variation.kind === "default") return this.mapBaseCodePoint(codePoint);
        return this.validateMappedGlyphId(variation.glyphId, "variation cmap");
      }
      return 0;
    }
    return this.mapBaseCodePoint(codePoint);
  }

  private mapBaseCodePoint(codePoint: number): number {
    if (this.unicodeCmap === null) return 0;
    const glyph = this.unicodeCmap.lookup(codePoint);
    return glyph > 0
      ? this.validateMappedGlyphId(glyph, `cmap format ${this.unicodeCmap.format}`)
      : 0;
  }

  mapSymbolCode(code: number): number {
    if (!Number.isSafeInteger(code) || code < 0 || code > 0xff) return 0;
    const cmap = this.symbolCmap;
    if (cmap === null) return 0;
    const direct = cmap.lookup(code);
    if (direct > 0) return this.validateMappedGlyphId(direct, "symbol cmap");
    const privateUse = cmap.lookup(0xf000 + code);
    if (privateUse > 0) return this.validateMappedGlyphId(privateUse, "symbol cmap");
    return 0;
  }

  getHorizontalMetric(glyphId: number): { readonly advanceWidth: number; readonly leftSideBearing: number } {
    this.requireGlyphId(glyphId);
    const table = this.requireTable("hmtx");
    const metricIndex = Math.min(glyphId, this.numberOfHMetrics - 1);
    const advanceWidth = this.u16(table.offset + metricIndex * 4, table);
    const bearingOffset = glyphId < this.numberOfHMetrics
      ? table.offset + glyphId * 4 + 2
      : table.offset + this.numberOfHMetrics * 4 + (glyphId - this.numberOfHMetrics) * 2;
    const leftSideBearing = glyphId >= this.firstRecoveredHorizontalBearingGlyph
      ? this.readRecoveredHorizontalBearing(glyphId)
      : this.i16(bearingOffset, table);
    return Object.freeze({ advanceWidth, leftSideBearing });
  }

  getGlyphOutline(glyphId: number): NativeGlyphOutline {
    this.requireGlyphId(glyphId);
    const cached = this.outlineCache.get(glyphId);
    if (cached) return cached;
    if (this.outlineFormat !== "glyf") {
      throw unsupportedFont(
        this.outlineFormat === "cff" || this.outlineFormat === "cff2"
          ? "CFF/CFF2 outlines require the native CFF kernel, which is not available."
          : "The embedded sfnt has no supported outline table."
      );
    }
    const geometry = this.readGlyphGeometry(
      glyphId,
      new Set(),
      0,
      { components: 0, points: 0 }
    );
    const metric = this.getHorizontalMetric(geometry.metricsGlyphId);
    const outline: NativeGlyphOutline = Object.freeze({
      glyphId,
      commands: Object.freeze(
        contoursToCommands(geometry.points, geometry.contourEnds)
          .map((command) => Object.freeze(command))
      ),
      bounds: geometry.bounds,
      advanceWidth: metric.advanceWidth,
      leftSideBearing: metric.leftSideBearing
    });
    this.outlineCache.set(glyphId, outline);
    return outline;
  }

  private readGlyphGeometry(
    glyphId: number,
    stack: Set<number>,
    depth: number,
    budget: GlyphReadBudget
  ): ParsedGlyphGeometry {
    this.requireGlyphId(glyphId);
    if (stack.has(glyphId)) {
      throw unsupportedFont("A compound TrueType glyph is recursive.");
    }
    if (depth > this.limits.maxCompoundGlyphDepth) {
      throw sfntLimit("A compound TrueType glyph exceeds the configured nesting limit.");
    }
    const glyf = this.requireTable("glyf");
    const [start, end] = this.glyphOffsets(glyphId);
    if (start === end) {
      return {
        points: Object.freeze([]),
        contourEnds: Object.freeze([]),
        bounds: freezeBounds([0, 0, 0, 0], "empty TrueType glyph"),
        metricsGlyphId: glyphId
      };
    }
    if (start > end || end > glyf.length || end - start < 10) {
      throw unsupportedFont("The TrueType glyf/loca tables contain an invalid glyph span.");
    }
    const glyphOffset = glyf.offset + start;
    const glyphTable = { offset: glyphOffset, length: end - start };
    const contourCount = this.i16(glyphOffset, glyphTable);
    const bounds = freezeBounds([
      this.i16(glyphOffset + 2, glyphTable),
      this.i16(glyphOffset + 4, glyphTable),
      this.i16(glyphOffset + 6, glyphTable),
      this.i16(glyphOffset + 8, glyphTable)
    ], `TrueType glyph ${glyphId}`);
    if (contourCount >= 0) {
      return this.readSimpleGlyph(glyphId, glyphTable, contourCount, bounds, budget);
    }
    const nextStack = new Set(stack);
    nextStack.add(glyphId);
    return this.readCompoundGlyph(glyphId, glyphTable, bounds, nextStack, depth + 1, budget);
  }

  private readSimpleGlyph(
    glyphId: number,
    table: SfntTable,
    contourCount: number,
    bounds: readonly [number, number, number, number],
    budget: GlyphReadBudget
  ): ParsedGlyphGeometry {
    if (
      this.maxpProfile !== null &&
      contourCount > this.maxpProfile.maxContours
    ) {
      throw unsupportedFont("A simple TrueType glyph exceeds the maxp contour count.");
    }
    let offset = table.offset + 10;
    const contourEnds: number[] = [];
    let previousEnd = -1;
    for (let index = 0; index < contourCount; index += 1) {
      const end = this.u16(offset, table);
      if (end <= previousEnd) {
        throw unsupportedFont("A simple TrueType glyph has non-increasing contour endpoints.");
      }
      contourEnds.push(end);
      previousEnd = end;
      offset += 2;
    }
    const pointCount = contourCount === 0 ? 0 : contourEnds[contourEnds.length - 1] + 1;
    if (
      pointCount > this.limits.maxGlyphPoints ||
      budget.points + pointCount > this.limits.maxGlyphPoints
    ) {
      throw sfntLimit("A TrueType glyph exceeds the configured point limit.");
    }
    if (this.maxpProfile !== null && pointCount > this.maxpProfile.maxPoints) {
      throw unsupportedFont("A simple TrueType glyph exceeds the maxp point count.");
    }
    budget.points += pointCount;
    const instructionBytes = this.u16(offset, table);
    this.validateInstructionLength(instructionBytes);
    offset = checkedSfntAdd(offset, checkedSfntAdd(2, instructionBytes, "glyph instructions"), "glyph data");
    this.assertInTable(offset, 0, table);
    const flags: number[] = [];
    while (flags.length < pointCount) {
      const flag = this.u8(offset++, table);
      // Bit 6 is OVERLAP_SIMPLE; only bit 7 is reserved.
      if ((flag & 0x80) !== 0) {
        throw unsupportedFont("A simple TrueType glyph uses reserved flag bits.");
      }
      flags.push(flag);
      if (flag & 0x08) {
        const repeat = this.u8(offset++, table);
        if (flags.length + repeat > pointCount) throw unsupportedFont("TrueType flag repeats exceed glyph points.");
        for (let index = 0; index < repeat; index += 1) flags.push(flag);
      }
    }
    const xValues = new Array<number>(pointCount);
    let x = 0;
    for (let index = 0; index < pointCount; index += 1) {
      const flag = flags[index];
      if (flag & 0x02) {
        const delta = this.u8(offset++, table);
        x += flag & 0x10 ? delta : -delta;
      } else if (!(flag & 0x10)) {
        x += this.i16(offset, table);
        offset += 2;
      }
      if (x < -32_768 || x > 32_767) {
        throw unsupportedFont("A simple TrueType glyph x coordinate exceeds FWORD range.");
      }
      xValues[index] = x;
    }
    const points: GlyphPoint[] = [];
    let y = 0;
    for (let index = 0; index < pointCount; index += 1) {
      const flag = flags[index];
      if (flag & 0x04) {
        const delta = this.u8(offset++, table);
        y += flag & 0x20 ? delta : -delta;
      } else if (!(flag & 0x20)) {
        y += this.i16(offset, table);
        offset += 2;
      }
      if (y < -32_768 || y > 32_767) {
        throw unsupportedFont("A simple TrueType glyph y coordinate exceeds FWORD range.");
      }
      points.push({ x: xValues[index], y, onCurve: (flag & 1) !== 0 });
    }
    const resolvedBounds = resolveGlyphBounds(points, bounds, glyphId, this.validation);
    return {
      points: Object.freeze(points),
      contourEnds: Object.freeze(contourEnds),
      bounds: resolvedBounds,
      metricsGlyphId: glyphId
    };
  }

  private readCompoundGlyph(
    glyphId: number,
    table: SfntTable,
    bounds: readonly [number, number, number, number],
    stack: Set<number>,
    depth: number,
    budget: GlyphReadBudget
  ): ParsedGlyphGeometry {
    const points: GlyphPoint[] = [];
    const contourEnds: number[] = [];
    let offset = table.offset + 10;
    let flags = 0;
    let componentCount = 0;
    let metricsGlyphId = glyphId;
    let hasInstructions = false;
    do {
      flags = this.u16(offset, table);
      if ((flags & 0xe010) !== 0) {
        throw unsupportedFont("A compound TrueType glyph uses reserved component flags.");
      }
      if ((flags & 0x0100) !== 0) {
        hasInstructions = true;
      }
      const componentGlyph = this.u16(offset + 2, table);
      offset += 4;
      componentCount += 1;
      budget.components += 1;
      if (
        componentCount > this.limits.maxCompoundGlyphComponents ||
        budget.components > this.limits.maxCompoundGlyphComponents
      ) {
        throw sfntLimit("A compound TrueType glyph exceeds the configured component limit.");
      }
      if (
        this.maxpProfile !== null &&
        componentCount > this.maxpProfile.maxComponentElements
      ) {
        throw unsupportedFont("A compound TrueType glyph exceeds the maxp component count.");
      }
      const wordArgs = (flags & 0x0001) !== 0;
      const xyArgs = (flags & 0x0002) !== 0;
      if (!xyArgs && (flags & (0x0004 | 0x0800 | 0x1000)) !== 0) {
        throw unsupportedFont("A point-matched compound component uses xy-only flags.");
      }
      if ((flags & 0x1800) === 0x1800) {
        throw unsupportedFont("A compound component sets both scaled and unscaled offset flags.");
      }
      const arg1 = wordArgs
        ? (xyArgs ? this.i16(offset, table) : this.u16(offset, table))
        : (xyArgs ? this.i8(offset, table) : this.u8(offset, table));
      const arg2 = wordArgs
        ? (xyArgs ? this.i16(offset + 2, table) : this.u16(offset + 2, table))
        : (xyArgs ? this.i8(offset + 1, table) : this.u8(offset + 1, table));
      offset += wordArgs ? 4 : 2;
      let a = 1;
      let b = 0;
      let c = 0;
      let d = 1;
      const transformFlags = Number((flags & 0x0008) !== 0) +
        Number((flags & 0x0040) !== 0) +
        Number((flags & 0x0080) !== 0);
      if (transformFlags > 1) {
        throw unsupportedFont("A compound component declares conflicting transforms.");
      }
      if (flags & 0x0008) {
        a = d = this.f2dot14(offset, table);
        offset += 2;
      } else if (flags & 0x0040) {
        a = this.f2dot14(offset, table);
        d = this.f2dot14(offset + 2, table);
        offset += 4;
      } else if (flags & 0x0080) {
        a = this.f2dot14(offset, table);
        b = this.f2dot14(offset + 2, table);
        c = this.f2dot14(offset + 4, table);
        d = this.f2dot14(offset + 6, table);
        offset += 8;
      }
      const component = this.readGlyphGeometry(componentGlyph, stack, depth, budget);
      const transformed = component.points.map((point) => ({
        x: a * point.x + c * point.y,
        y: b * point.x + d * point.y,
        onCurve: point.onCurve
      }));
      let dx = 0;
      let dy = 0;
      if (xyArgs) {
        dx = arg1;
        dy = arg2;
        if (flags & 0x0800) {
          const scaledX = a * dx + c * dy;
          const scaledY = b * dx + d * dy;
          dx = scaledX;
          dy = scaledY;
        }
        if (flags & 0x0004) {
          dx = Math.round(dx);
          dy = Math.round(dy);
        }
      } else {
        const parentPoint = points[arg1];
        const componentPoint = transformed[arg2];
        if (!parentPoint || !componentPoint) {
          throw unsupportedFont("A compound TrueType point-matching argument is out of range.");
        }
        dx = parentPoint.x - componentPoint.x;
        dy = parentPoint.y - componentPoint.y;
      }
      const pointBase = points.length;
      if (pointBase + transformed.length > this.limits.maxGlyphPoints) {
        throw sfntLimit("A compound TrueType glyph exceeds the configured point limit.");
      }
      for (const point of transformed) {
        points.push({ x: point.x + dx, y: point.y + dy, onCurve: point.onCurve });
      }
      for (const end of component.contourEnds) contourEnds.push(pointBase + end);
      if ((flags & 0x0200) !== 0) {
        if (b !== 0 || c !== 0) {
          throw unsupportedFont("USE_MY_METRICS is undefined for a rotated compound component.");
        }
        // Some widely deployed fonts mark more than one component. The
        // component stream is ordered, so matching rasterizer behavior means
        // the last marked component deterministically supplies the metrics.
        metricsGlyphId = component.metricsGlyphId;
      }
    } while (flags & 0x0020);
    if (hasInstructions) {
      const instructionBytes = this.u16(offset, table);
      this.validateInstructionLength(instructionBytes);
      offset = checkedSfntAdd(
        offset,
        checkedSfntAdd(2, instructionBytes, "compound glyph instructions"),
        "compound glyph data"
      );
      this.assertInTable(offset, 0, table);
    }
    if (
      this.maxpProfile !== null &&
      (
        points.length > this.maxpProfile.maxCompositePoints ||
        contourEnds.length > this.maxpProfile.maxCompositeContours ||
        depth > this.maxpProfile.maxComponentDepth
      )
    ) {
      throw unsupportedFont("A compound TrueType glyph exceeds its maxp profile.");
    }
    const resolvedBounds = resolveGlyphBounds(points, bounds, glyphId, this.validation);
    return {
      points: Object.freeze(points),
      contourEnds: Object.freeze(contourEnds),
      bounds: resolvedBounds,
      metricsGlyphId
    };
  }

  private glyphOffsets(glyphId: number): readonly [number, number] {
    if (this.glyphLocations === null) {
      throw unsupportedFont("The embedded sfnt has no TrueType glyph locations.");
    }
    return [this.glyphLocations[glyphId], this.glyphLocations[glyphId + 1]];
  }

  private readRecoveredHorizontalBearing(glyphId: number): number {
    const glyf = this.requireTable("glyf");
    const [start, end] = this.glyphOffsets(glyphId);
    if (start === end) return 0;
    if (start > end || end > glyf.length || end - start < 10) {
      throw unsupportedFont("The TrueType glyf/loca tables contain an invalid glyph span.");
    }
    // The PDF-embedded recovery path is enabled only when head.flags bit 1
    // promises that each horizontal left side bearing equals glyph xMin.
    return this.i16(glyf.offset + start + 2, { offset: glyf.offset + start, length: end - start });
  }

  private readGlyphLocations(): Uint32Array {
    const loca = this.requireTable("loca");
    const glyf = this.requireTable("glyf");
    const entryBytes = this.indexToLocFormat === 0 ? 2 : 4;
    const expectedLength = checkedSfntMultiply(this.numGlyphs + 1, entryBytes, "loca length");
    if (loca.length !== expectedLength) {
      throw unsupportedFont("The TrueType loca length is inconsistent with maxp/head.");
    }
    const locations = new Uint32Array(this.numGlyphs + 1);
    let previous = 0;
    for (let index = 0; index <= this.numGlyphs; index += 1) {
      const value = this.indexToLocFormat === 0
        ? this.u16(loca.offset + index * 2, loca) * 2
        : this.u32(loca.offset + index * 4, loca);
      if (value < previous || value > glyf.length) {
        throw unsupportedFont("The TrueType loca offsets are non-monotonic or outside glyf.");
      }
      locations[index] = value;
      previous = value;
    }
    return locations;
  }

  private validateInstructionLength(length: number): void {
    if (length > this.limits.maxGlyphInstructionBytes) {
      throw sfntLimit("A TrueType glyph exceeds the configured instruction byte limit.");
    }
    if (
      this.maxpProfile !== null &&
      length > this.maxpProfile.maxSizeOfInstructions
    ) {
      throw unsupportedFont("A TrueType glyph exceeds the maxp instruction byte count.");
    }
  }

  private validateMappedGlyphId(glyphId: number, source: string): number {
    if (!Number.isSafeInteger(glyphId) || glyphId < 0 || glyphId >= this.numGlyphs) {
      throw unsupportedFont(`The sfnt ${source} maps to out-of-range glyph ID ${glyphId}.`);
    }
    return glyphId;
  }

  private requireTable(tag: string): SfntTable {
    const table = this.tables.get(tag);
    if (!table) throw unsupportedFont(`The sfnt font is missing its ${tag} table.`);
    return table;
  }

  private requireGlyphId(glyphId: number): void {
    if (!Number.isSafeInteger(glyphId) || glyphId < 0 || glyphId >= this.numGlyphs) {
      throw unsupportedFont(`Glyph ID ${glyphId} is outside the embedded font.`);
    }
  }

  private assertInTable(offset: number, length: number, table: SfntTable): void {
    if (
      !Number.isSafeInteger(offset) ||
      offset < table.offset ||
      !sfntRangeFits(offset - table.offset, length, table.length)
    ) {
      throw unsupportedFont("An sfnt table read is out of bounds.");
    }
  }

  private u8(offset: number, table: SfntTable): number {
    this.assertInTable(offset, 1, table);
    return this.view.getUint8(offset);
  }

  private i8(offset: number, table: SfntTable): number {
    this.assertInTable(offset, 1, table);
    return this.view.getInt8(offset);
  }

  private u16(offset: number, table: SfntTable): number {
    this.assertInTable(offset, 2, table);
    return this.view.getUint16(offset, false);
  }

  private i16(offset: number, table: SfntTable): number {
    this.assertInTable(offset, 2, table);
    return this.view.getInt16(offset, false);
  }

  private u32(offset: number, table: SfntTable): number {
    this.assertInTable(offset, 4, table);
    return this.view.getUint32(offset, false);
  }

  private f2dot14(offset: number, table: SfntTable): number {
    return this.i16(offset, table) / 16384;
  }
}

function readSfntTables(
  view: DataView,
  faceOffset: number,
  limits: Readonly<NativeSfntParserLimits>,
  protectedRanges: readonly SfntProtectedRange[],
  validation: "strict" | "pdf-embedded"
): ReadonlyMap<string, SfntTable> {
  if (!sfntRangeFits(faceOffset, 12, view.byteLength)) {
    throw unsupportedFont("The sfnt face offset is invalid.");
  }
  const signature = view.getUint32(faceOffset, false);
  if (!isSfntFaceSignature(signature)) {
    throw unsupportedFont("The embedded font has an unsupported sfnt signature.");
  }
  const count = view.getUint16(faceOffset + 4, false);
  if (count < 1) {
    throw unsupportedFont("The sfnt face has no tables.");
  }
  if (count > limits.maxSfntTables) {
    throw sfntLimit("The sfnt table count exceeds the configured limit.");
  }
  const directoryLength = checkedSfntAdd(
    12,
    checkedSfntMultiply(count, 16, "sfnt table records"),
    "sfnt table directory"
  );
  if (!sfntRangeFits(faceOffset, directoryLength, view.byteLength)) {
    throw unsupportedFont("The sfnt table directory is invalid.");
  }
  const searchRange = view.getUint16(faceOffset + 6, false);
  const entrySelector = view.getUint16(faceOffset + 8, false);
  const rangeShift = view.getUint16(faceOffset + 10, false);
  const largestPowerOfTwo = 2 ** Math.floor(Math.log2(count));
  const expectedSearchRange = largestPowerOfTwo * 16;
  const searchFieldsValid = searchRange === expectedSearchRange &&
    entrySelector === Math.log2(largestPowerOfTwo) &&
    rangeShift === count * 16 - expectedSearchRange;
  if (
    validation === "strict" &&
    (searchRange !== 0 || entrySelector !== 0 || rangeShift !== 0) &&
    !searchFieldsValid
  ) {
    throw unsupportedFont("The sfnt table-directory search fields are inconsistent.");
  }
  const tables = new Map<string, SfntTable>();
  const seenTags = new Set<string>();
  const directoryTags: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const record = faceOffset + 12 + index * 16;
    const tag = readTag(view, record);
    if (!/^[\x20-\x7e]{4}$/.test(tag) || seenTags.has(tag)) {
      throw unsupportedFont("The sfnt table directory tags are invalid or duplicated.");
    }
    seenTags.add(tag);
    directoryTags.push(tag);
    const checksum = view.getUint32(record + 4, false);
    const offset = view.getUint32(record + 8, false);
    const length = view.getUint32(record + 12, false);
    // HEPR never reads optional sfnt metadata. PDF generators nevertheless
    // commonly leave stale OS/2/name/post records behind when subsetting a
    // font. In the PDF-embedded profile, do not let an unreferenced record
    // expand the trusted byte range or invalidate otherwise sound outlines.
    // The directory itself, its record count, tags, and all consumed tables
    // remain bounded and validated below.
    if (validation === "pdf-embedded" && !isConsumedSfntTable(tag)) {
      continue;
    }
    // Four-byte alignment is an OpenType serialization requirement, but it is
    // not needed for DataView reads. Several real PDF subsetters pack tables
    // back-to-back and preserve otherwise valid offsets/checksums. Continue to
    // require alignment for caller/standalone fonts; for embedded subsets the
    // actual memory-safety boundary is the exact range check.
    if (
      (validation === "strict" && offset % 4 !== 0) ||
      !sfntRangeFits(offset, length, view.byteLength)
    ) {
      throw unsupportedFont(`The sfnt ${tag} table is out of bounds.`);
    }
    if (
      length > 0 &&
      rangesOverlap(offset, length, faceOffset, directoryLength)
    ) {
      throw unsupportedFont(`The sfnt ${tag} table overlaps its table directory.`);
    }
    for (const range of protectedRanges) {
      if (
        range.offset === faceOffset && range.length === directoryLength
      ) continue;
      if (length > 0 && rangesOverlap(offset, length, range.offset, range.length)) {
        throw unsupportedFont(`The sfnt ${tag} table overlaps protected collection data.`);
      }
    }
    const table: SfntTable = { offset, length, checksum };
    tables.set(tag, table);
  }
  // Establish disjoint table ownership before doing any linear checksum work;
  // otherwise many aliases to one large range could amplify validation cost.
  const ordered = [...tables.entries()]
    .filter(([, table]) => table.length > 0)
    .sort((left, right) => left[1].offset - right[1].offset);
  for (let index = 1; index < ordered.length; index += 1) {
    const [previousName, previous] = ordered[index - 1];
    const [name, current] = ordered[index];
    if (rangesOverlap(previous.offset, previous.length, current.offset, current.length)) {
      throw unsupportedFont(`The sfnt ${previousName} and ${name} tables overlap.`);
    }
  }
  // Old PDF producers sometimes zero every checksum. Keep that bounded legacy
  // form readable, but once any checksum is declared validate the entire set so
  // a zero cannot selectively disable validation for one table.
  const hasDeclaredChecksums = [...tables.values()].some((table) => table.checksum !== 0);
  if (validation === "strict" && hasDeclaredChecksums) {
    if (!searchFieldsValid) {
      throw unsupportedFont("A checked sfnt has invalid table-directory search fields.");
    }
    for (let index = 1; index < directoryTags.length; index += 1) {
      if (directoryTags[index] <= directoryTags[index - 1]) {
        throw unsupportedFont("A checked sfnt table directory is unsorted.");
      }
    }
    for (const [tag, table] of tables) {
      if (calculateSfntTableChecksum(view, table, tag === "head") !== table.checksum) {
        throw unsupportedFont(`The sfnt ${tag} table checksum is invalid.`);
      }
    }
  }
  return tables;
}

/** Tables read by the TypeScript sfnt engine or handed to an outline kernel. */
function isConsumedSfntTable(tag: string): boolean {
  return tag === "head" || tag === "maxp" || tag === "hhea" || tag === "hmtx" ||
    tag === "cmap" || tag === "glyf" || tag === "loca" || tag === "CFF " ||
    tag === "CFF2";
}

function readSfntCmaps(
  view: DataView,
  table: SfntTable | undefined,
  limits: Readonly<NativeSfntParserLimits>
): SfntCmaps {
  if (!table) return { base: Object.freeze([]), variation: Object.freeze([]) };
  requireSfntTableLength(table, 4, "cmap");
  if (boundedU16(view, table.offset, table) !== 0) {
    throw unsupportedFont("The sfnt cmap table has an unsupported version.");
  }
  const count = boundedU16(view, table.offset + 2, table);
  if (count > limits.maxSfntCmapRecords) {
    throw sfntLimit("The sfnt cmap record count exceeds the configured limit.");
  }
  const directoryLength = checkedSfntAdd(
    4,
    checkedSfntMultiply(count, 8, "cmap records"),
    "cmap directory"
  );
  if (directoryLength > table.length) {
    throw unsupportedFont("The sfnt cmap directory is truncated.");
  }
  const lookups: CmapLookup[] = [];
  const variationLookups: VariationCmapLookup[] = [];
  const groupBudget = { count: 0 };
  const seenSupportedRecords = new Set<string>();
  const lastLanguageByEncoding = new Map<string, number>();
  let sawUnsupportedCandidate = false;
  let previousPlatform = -1;
  let previousEncoding = -1;
  for (let index = 0; index < count; index += 1) {
    const record = table.offset + 4 + index * 8;
    const platform = boundedU16(view, record, table);
    const encoding = boundedU16(view, record + 2, table);
    if (
      platform < previousPlatform ||
      (platform === previousPlatform && encoding < previousEncoding)
    ) {
      throw unsupportedFont("The sfnt cmap encoding records are unsorted.");
    }
    previousPlatform = platform;
    previousEncoding = encoding;
    const relative = boundedU32(view, record + 4, table);
    if (relative < directoryLength || !sfntRangeFits(relative, 2, table.length)) {
      throw unsupportedFont("An sfnt cmap subtable offset is out of bounds.");
    }
    const offset = table.offset + relative;
    const format = boundedU16(view, offset, table);
    if (format === 14) {
      if (platform !== 0 || encoding !== 5) {
        throw unsupportedFont("A format 14 cmap must use Unicode platform encoding 5.");
      }
      if (variationLookups.length !== 0) {
        throw unsupportedFont("The sfnt cmap has duplicate format 14 encoding records.");
      }
      variationLookups.push(
        createVariationCmapLookup(view, table, offset, limits, groupBudget)
      );
      continue;
    }
    const priority = cmapPriority(platform, encoding, format);
    if (priority < 0) {
      if (isCandidateCmapEncoding(platform, encoding)) sawUnsupportedCandidate = true;
      continue;
    }
    const lookup = createCmapLookup(
      view,
      table,
      offset,
      format,
      platform,
      encoding,
      priority,
      limits,
      groupBudget
    );
    const recordKey = `${platform}:${encoding}:${lookup.language}`;
    if (seenSupportedRecords.has(recordKey)) {
      throw unsupportedFont("The sfnt cmap has duplicate platform, encoding, and language records.");
    }
    const encodingKey = `${platform}:${encoding}`;
    const previousLanguage = lastLanguageByEncoding.get(encodingKey);
    if (previousLanguage !== undefined && lookup.language < previousLanguage) {
      throw unsupportedFont("The sfnt cmap language records are unsorted.");
    }
    seenSupportedRecords.add(recordKey);
    lastLanguageByEncoding.set(encodingKey, lookup.language);
    lookups.push(lookup);
  }
  if (lookups.length === 0 && sawUnsupportedCandidate) {
    throw unsupportedFont("The sfnt has no supported base cmap subtable.");
  }
  if (variationLookups.length > 0 && lookups.length === 0) {
    throw unsupportedFont("The sfnt format 14 cmap has no supported base cmap.");
  }
  lookups.sort((left, right) =>
    right.priority - left.priority ||
    Number(right.language === 0) - Number(left.language === 0) ||
    left.language - right.language
  );
  return Object.freeze({
    base: Object.freeze(lookups),
    variation: Object.freeze(variationLookups)
  });
}

function createCmapLookup(
  view: DataView,
  parent: SfntTable,
  offset: number,
  format: number,
  platform: number,
  encoding: number,
  priority: number,
  limits: Readonly<NativeSfntParserLimits>,
  groupBudget: { count: number }
): CmapLookup {
  if (format === 0) {
    const length = boundedU16(view, offset + 2, parent);
    if (length !== 262 || !cmapRangeFits(parent, offset, length)) {
      throw unsupportedFont("The sfnt format 0 cmap is malformed.");
    }
    return {
      platform,
      encoding,
      format,
      language: view.getUint16(offset + 4, false),
      priority,
      lookup: (code) => code <= 255 ? view.getUint8(offset + 6 + code) : 0
    };
  }
  if (format === 4) {
    const length = boundedU16(view, offset + 2, parent);
    if (length < 16 || (length & 1) !== 0 || !cmapRangeFits(parent, offset, length)) {
      throw unsupportedFont("The sfnt format 4 cmap is malformed.");
    }
    const subtable: SfntTable = { offset, length };
    const segCount = boundedU16(view, offset + 6, subtable) / 2;
    if (!Number.isInteger(segCount) || segCount < 1) {
      throw unsupportedFont("The sfnt format 4 cmap has an invalid segment count.");
    }
    const largestPowerOfTwo = 2 ** Math.floor(Math.log2(segCount));
    if (
      boundedU16(view, offset + 8, subtable) !== largestPowerOfTwo * 2 ||
      boundedU16(view, offset + 10, subtable) !== Math.log2(largestPowerOfTwo) ||
      boundedU16(view, offset + 12, subtable) !== segCount * 2 - largestPowerOfTwo * 2
    ) {
      throw unsupportedFont("The sfnt format 4 cmap search fields are inconsistent.");
    }
    consumeSfntCmapGroups(groupBudget, segCount, limits);
    const endCodes = offset + 14;
    const startCodes = endCodes + segCount * 2 + 2;
    const deltas = startCodes + segCount * 2;
    const rangeOffsets = deltas + segCount * 2;
    const glyphArray = rangeOffsets + segCount * 2;
    if (glyphArray > offset + length || boundedU16(view, endCodes + segCount * 2, subtable) !== 0) {
      throw unsupportedFont("The sfnt format 4 cmap arrays are truncated.");
    }
    let previousEnd = -1;
    for (let index = 0; index < segCount; index += 1) {
      const start = boundedU16(view, startCodes + index * 2, subtable);
      const end = boundedU16(view, endCodes + index * 2, subtable);
      if (start > end || start <= previousEnd) {
        throw unsupportedFont("The sfnt format 4 cmap segments overlap or are unsorted.");
      }
      previousEnd = end;
      const range = boundedU16(view, rangeOffsets + index * 2, subtable);
      if (range !== 0) {
        const startAddress = rangeOffsets + index * 2 + range;
        const endAddress = checkedSfntAdd(
          startAddress,
          checkedSfntMultiply(end - start, 2, "format 4 glyph range"),
          "format 4 glyph address"
        );
        if (
          (range & 1) !== 0 ||
          startAddress < glyphArray ||
          !sfntRangeFits(startAddress - offset, endAddress - startAddress + 2, length)
        ) {
          throw unsupportedFont("The sfnt format 4 cmap glyph array offset is invalid.");
        }
      }
    }
    if (
      boundedU16(view, startCodes + (segCount - 1) * 2, subtable) !== 0xffff ||
      boundedU16(view, endCodes + (segCount - 1) * 2, subtable) !== 0xffff
    ) {
      throw unsupportedFont("The sfnt format 4 cmap has no terminal sentinel segment.");
    }
    return {
      platform,
      encoding,
      format,
      language: view.getUint16(offset + 4, false),
      priority,
      lookup(code) {
        if (code > 0xffff) return 0;
        let low = 0;
        let high = segCount - 1;
        while (low <= high) {
          const mid = (low + high) >>> 1;
          const end = view.getUint16(endCodes + mid * 2, false);
          if (code > end) low = mid + 1;
          else high = mid - 1;
        }
        if (low >= segCount) return 0;
        const start = view.getUint16(startCodes + low * 2, false);
        if (code < start) return 0;
        const delta = view.getInt16(deltas + low * 2, false);
        const range = view.getUint16(rangeOffsets + low * 2, false);
        if (range === 0) return (code + delta) & 0xffff;
        const address = rangeOffsets + low * 2 + range + (code - start) * 2;
        if (!sfntRangeFits(address - offset, 2, length)) return 0;
        const glyph = view.getUint16(address, false);
        return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
      }
    };
  }
  if (format === 6) {
    const length = boundedU16(view, offset + 2, parent);
    if (length < 10 || !cmapRangeFits(parent, offset, length)) {
      throw unsupportedFont("The sfnt format 6 cmap is malformed.");
    }
    const first = view.getUint16(offset + 6, false);
    const count = view.getUint16(offset + 8, false);
    if (10 + count * 2 !== length || first + count > 0x10000) {
      throw unsupportedFont("The sfnt format 6 cmap range is invalid.");
    }
    return {
      platform,
      encoding,
      format,
      language: view.getUint16(offset + 4, false),
      priority,
      lookup: (code) => code >= first && code < first + count
        ? view.getUint16(offset + 10 + (code - first) * 2, false)
        : 0
    };
  }
  if (format === 10) {
    const length = boundedU32(view, offset + 4, parent);
    if (
      boundedU16(view, offset + 2, parent) !== 0 ||
      length < 20 ||
      !cmapRangeFits(parent, offset, length)
    ) {
      throw unsupportedFont("The sfnt format 10 cmap is malformed.");
    }
    const first = view.getUint32(offset + 12, false);
    const count = view.getUint32(offset + 16, false);
    if (
      checkedSfntAdd(20, checkedSfntMultiply(count, 2, "format 10 glyphs"), "format 10 length") !== length ||
      first > 0x10ffff || count > 0x110000 || first + count > 0x110000 ||
      (count > 0 && unicodeRangeContainsSurrogates(first, first + count - 1))
    ) {
      throw unsupportedFont("The sfnt format 10 cmap range is invalid.");
    }
    return {
      platform,
      encoding,
      format,
      language: view.getUint32(offset + 8, false),
      priority,
      lookup: (code) => code >= first && code < first + count
        ? view.getUint16(offset + 20 + (code - first) * 2, false)
        : 0
    };
  }
  if (format === 12 || format === 13) {
    const length = boundedU32(view, offset + 4, parent);
    if (
      boundedU16(view, offset + 2, parent) !== 0 ||
      length < 16 ||
      !cmapRangeFits(parent, offset, length)
    ) {
      throw unsupportedFont(`The sfnt format ${format} cmap is malformed.`);
    }
    const count = view.getUint32(offset + 12, false);
    consumeSfntCmapGroups(groupBudget, count, limits);
    if (
      checkedSfntAdd(16, checkedSfntMultiply(count, 12, `format ${format} groups`), `format ${format} length`) !==
      length
    ) {
      throw unsupportedFont(`The sfnt format ${format} cmap groups are truncated.`);
    }
    let previousEnd = -1;
    for (let index = 0; index < count; index += 1) {
      const group = offset + 16 + index * 12;
      const start = view.getUint32(group, false);
      const end = view.getUint32(group + 4, false);
      const base = view.getUint32(group + 8, false);
      if (
        start > end || end > 0x10ffff || start <= previousEnd ||
        unicodeRangeContainsSurrogates(start, end) ||
        (format === 12 && base + end - start > 0xffffffff)
      ) {
        throw unsupportedFont(`The sfnt format ${format} cmap groups overlap or are invalid.`);
      }
      previousEnd = end;
    }
    return {
      platform,
      encoding,
      format,
      language: view.getUint32(offset + 8, false),
      priority,
      lookup(code) {
        let low = 0;
        let high = count - 1;
        while (low <= high) {
          const mid = (low + high) >>> 1;
          const group = offset + 16 + mid * 12;
          const start = view.getUint32(group, false);
          const end = view.getUint32(group + 4, false);
          if (code < start) high = mid - 1;
          else if (code > end) low = mid + 1;
          else {
            const base = view.getUint32(group + 8, false);
            return format === 12 ? base + code - start : base;
          }
        }
        return 0;
      }
    };
  }
  throw unsupportedFont(`The sfnt cmap format ${format} is unsupported.`);
}

interface VariationSelectorCmapRecord {
  readonly selector: number;
  readonly defaultRanges: readonly VariationSelectorDefaultRange[];
  readonly nonDefaultMappings: readonly VariationSelectorMapping[];
}

interface VariationSelectorDefaultRange {
  readonly start: number;
  readonly end: number;
}

interface VariationSelectorMapping {
  readonly codePoint: number;
  readonly glyphId: number;
}

/**
 * Format 14 is deliberately materialized while the sfnt is validated. This
 * keeps every later lookup bounded and ensures malformed UVS data cannot stay
 * latent behind an otherwise valid base cmap.
 */
function createVariationCmapLookup(
  view: DataView,
  parent: SfntTable,
  offset: number,
  limits: Readonly<NativeSfntParserLimits>,
  groupBudget: { count: number }
): VariationCmapLookup {
  const length = boundedU32(view, offset + 2, parent);
  if (length < 10 || !cmapRangeFits(parent, offset, length)) {
    throw unsupportedFont("The sfnt format 14 cmap is malformed.");
  }
  const subtable: SfntTable = { offset, length };
  const recordCount = boundedU32(view, offset + 6, subtable);
  if (recordCount > limits.maxSfntCmapRecords) {
    throw sfntLimit("The sfnt format 14 selector count exceeds the configured limit.");
  }
  const recordsEnd = checkedSfntAdd(
    10,
    checkedSfntMultiply(recordCount, 11, "format 14 selector records"),
    "format 14 selector directory"
  );
  if (recordsEnd > length) {
    throw unsupportedFont("The sfnt format 14 selector directory is truncated.");
  }

  const records: VariationSelectorCmapRecord[] = [];
  let previousSelector = -1;
  for (let index = 0; index < recordCount; index += 1) {
    const recordOffset = offset + 10 + index * 11;
    const selector = boundedU24(view, recordOffset, subtable);
    const defaultRelative = boundedU32(view, recordOffset + 3, subtable);
    const nonDefaultRelative = boundedU32(view, recordOffset + 7, subtable);
    if (!isUnicodeVariationSelector(selector) || selector <= previousSelector) {
      throw unsupportedFont("The sfnt format 14 variation selectors are invalid or unsorted.");
    }
    if (defaultRelative === 0 && nonDefaultRelative === 0) {
      throw unsupportedFont("An sfnt format 14 selector has no mappings.");
    }
    previousSelector = selector;

    const defaultRanges: VariationSelectorDefaultRange[] = [];
    if (defaultRelative !== 0) {
      if (defaultRelative < recordsEnd || !sfntRangeFits(defaultRelative, 4, length)) {
        throw unsupportedFont("An sfnt format 14 default UVS offset is invalid.");
      }
      const defaultOffset = offset + defaultRelative;
      const rangeCount = boundedU32(view, defaultOffset, subtable);
      consumeSfntCmapGroups(groupBudget, rangeCount, limits);
      const byteLength = checkedSfntAdd(
        4,
        checkedSfntMultiply(rangeCount, 4, "format 14 default ranges"),
        "format 14 default table"
      );
      if (!sfntRangeFits(defaultRelative, byteLength, length)) {
        throw unsupportedFont("An sfnt format 14 default UVS table is truncated.");
      }
      let previousEnd = -1;
      for (let rangeIndex = 0; rangeIndex < rangeCount; rangeIndex += 1) {
        const rangeOffset = defaultOffset + 4 + rangeIndex * 4;
        const start = boundedU24(view, rangeOffset, subtable);
        const end = start + view.getUint8(rangeOffset + 3);
        if (
          start <= previousEnd || end > 0x10ffff ||
          unicodeRangeContainsSurrogates(start, end)
        ) {
          throw unsupportedFont("The sfnt format 14 default UVS ranges are invalid or unsorted.");
        }
        defaultRanges.push(Object.freeze({ start, end }));
        previousEnd = end;
      }
    }

    const nonDefaultMappings: VariationSelectorMapping[] = [];
    if (nonDefaultRelative !== 0) {
      if (nonDefaultRelative < recordsEnd || !sfntRangeFits(nonDefaultRelative, 4, length)) {
        throw unsupportedFont("An sfnt format 14 non-default UVS offset is invalid.");
      }
      const nonDefaultOffset = offset + nonDefaultRelative;
      const mappingCount = boundedU32(view, nonDefaultOffset, subtable);
      consumeSfntCmapGroups(groupBudget, mappingCount, limits);
      const byteLength = checkedSfntAdd(
        4,
        checkedSfntMultiply(mappingCount, 5, "format 14 non-default mappings"),
        "format 14 non-default table"
      );
      if (!sfntRangeFits(nonDefaultRelative, byteLength, length)) {
        throw unsupportedFont("An sfnt format 14 non-default UVS table is truncated.");
      }
      let previousCodePoint = -1;
      for (let mappingIndex = 0; mappingIndex < mappingCount; mappingIndex += 1) {
        const mappingOffset = nonDefaultOffset + 4 + mappingIndex * 5;
        const codePoint = boundedU24(view, mappingOffset, subtable);
        const glyphId = boundedU16(view, mappingOffset + 3, subtable);
        if (
          codePoint <= previousCodePoint || codePoint > 0x10ffff ||
          unicodeRangeContainsSurrogates(codePoint, codePoint) ||
          rangeListContains(defaultRanges, codePoint)
        ) {
          throw unsupportedFont(
            "The sfnt format 14 non-default UVS mappings are invalid, unsorted, or duplicated."
          );
        }
        nonDefaultMappings.push(Object.freeze({ codePoint, glyphId }));
        previousCodePoint = codePoint;
      }
    }
    records.push(Object.freeze({
      selector,
      defaultRanges: Object.freeze(defaultRanges),
      nonDefaultMappings: Object.freeze(nonDefaultMappings)
    }));
  }

  const immutableRecords = Object.freeze(records);
  return Object.freeze({
    lookup(codePoint: number, variationSelector: number): VariationCmapResult | undefined {
      let low = 0;
      let high = immutableRecords.length - 1;
      while (low <= high) {
        const middle = (low + high) >>> 1;
        const record = immutableRecords[middle];
        if (variationSelector < record.selector) high = middle - 1;
        else if (variationSelector > record.selector) low = middle + 1;
        else {
          const mapping = findVariationMapping(record.nonDefaultMappings, codePoint);
          if (mapping !== undefined) {
            return { kind: "glyph", glyphId: mapping };
          }
          return rangeListContains(record.defaultRanges, codePoint)
            ? { kind: "default" }
            : { kind: "unsupported" };
        }
      }
      return undefined;
    }
  });
}

function findVariationMapping(
  mappings: readonly VariationSelectorMapping[],
  codePoint: number
): number | undefined {
  let low = 0;
  let high = mappings.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const mapping = mappings[middle];
    if (codePoint < mapping.codePoint) high = middle - 1;
    else if (codePoint > mapping.codePoint) low = middle + 1;
    else return mapping.glyphId;
  }
  return undefined;
}

function rangeListContains(
  ranges: readonly VariationSelectorDefaultRange[],
  codePoint: number
): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const range = ranges[middle];
    if (codePoint < range.start) high = middle - 1;
    else if (codePoint > range.end) low = middle + 1;
    else return true;
  }
  return false;
}

function cmapPriority(platform: number, encoding: number, format: number): number {
  // OpenType cmap subtables are exclusive (format 14 is the only
  // supplement), so this rank selects exactly one Unicode subtable. Keep the
  // platform/encoding/format combinations constrained to their defined use.
  if (platform === 0 && encoding === 4 && (format === 12 || format === 10)) {
    return format === 12 ? 1_260 : 1_250;
  }
  if (platform === 3 && encoding === 10 && (format === 12 || format === 10)) {
    return format === 12 ? 1_160 : 1_150;
  }
  if (platform === 0 && encoding === 3 && (format === 4 || format === 6)) {
    return format === 4 ? 1_040 : 1_030;
  }
  if (platform === 3 && encoding === 1 && (format === 4 || format === 6)) {
    return format === 4 ? 940 : 930;
  }
  if (
    platform === 0 && encoding <= 2 &&
    (format === 4 || format === 6 || format === 0)
  ) {
    return 800 + encoding * 10 + (format === 4 ? 3 : format === 6 ? 2 : 1);
  }
  if (platform === 0 && encoding === 6 && format === 13) return 700;
  if (
    platform === 3 && encoding === 0 &&
    (format === 4 || format === 6 || format === 0)
  ) {
    return 100 + (format === 4 ? 3 : format === 6 ? 2 : 1);
  }
  return -1;
}

function contoursToCommands(
  points: readonly GlyphPoint[],
  contourEnds: readonly number[]
): NativeGlyphPathCommand[] {
  const commands: NativeGlyphPathCommand[] = [];
  let contourStart = 0;
  for (const contourEnd of contourEnds) {
    if (contourEnd < contourStart || contourEnd >= points.length) {
      throw unsupportedFont("A TrueType contour endpoint is invalid.");
    }
    const contour = points.slice(contourStart, contourEnd + 1);
    const first = contour[0];
    const last = contour[contour.length - 1];
    const start = first.onCurve ? first : last.onCurve ? last : midpoint(last, first);
    commands.push({ kind: "move", x: start.x, y: start.y });
    let index = first.onCurve ? 1 : 0;
    let consumed = 0;
    const targetCount = first.onCurve ? contour.length - 1 : contour.length;
    while (consumed < targetCount) {
      const point = contour[index % contour.length];
      if (point.onCurve) {
        commands.push({ kind: "line", x: point.x, y: point.y });
        index += 1;
        consumed += 1;
      } else {
        const next = contour[(index + 1) % contour.length];
        if (next.onCurve) {
          commands.push({
            kind: "quadratic",
            controlX: point.x,
            controlY: point.y,
            x: next.x,
            y: next.y
          });
          index += 2;
          consumed += 2;
        } else {
          const implied = midpoint(point, next);
          commands.push({
            kind: "quadratic",
            controlX: point.x,
            controlY: point.y,
            x: implied.x,
            y: implied.y
          });
          index += 1;
          consumed += 1;
        }
      }
    }
    commands.push({ kind: "close" });
    contourStart = contourEnd + 1;
  }
  return commands;
}

function midpoint(left: GlyphPoint, right: GlyphPoint): GlyphPoint {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2, onCurve: true };
}

/** Adobe Glyph List-style mapping for common names and uni/u production names. */
export function glyphNameToUnicode(rawName: string): string | null {
  const name = rawName.split(".", 1)[0];
  const direct = AGL[name];
  if (direct !== undefined) return direct;
  const composed = composeProductionGlyphName(name);
  if (composed !== null) return composed;
  if (/^uni(?:[0-9A-Fa-f]{4})+$/.test(name)) {
    let output = "";
    for (let offset = 3; offset < name.length; offset += 4) {
      const scalar = Number.parseInt(name.slice(offset, offset + 4), 16);
      // Adobe's `uniXXXX` production form names BMP scalar values, not raw
      // UTF-16 code units. Non-BMP values use the `uXXXXX` form below.
      if (scalar >= 0xd800 && scalar <= 0xdfff) return null;
      output += String.fromCodePoint(scalar);
    }
    return output;
  }
  const match = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (match) {
    const scalar = Number.parseInt(match[1], 16);
    if (scalar <= 0x10ffff && !(scalar >= 0xd800 && scalar <= 0xdfff)) {
      return String.fromCodePoint(scalar);
    }
  }
  if (name.includes("_")) {
    let output = "";
    for (const part of name.split("_")) {
      const mapped = glyphNameToUnicode(part);
      if (mapped === null) return null;
      output += mapped;
    }
    return output;
  }
  if (name.length === 1) return name;
  return null;
}

function glyphNameToUnicodeForFont(rawName: string, baseFont: string): string | null {
  const standardMetricFace = resolveNativeStandard14MetricFace(baseFont);
  if (standardMetricFace === "zapf-dingbats") {
    return zapfDingbatGlyphNameToUnicode(rawName) ?? glyphNameToUnicode(rawName);
  }
  if (standardMetricFace === "symbol") {
    return nativeSymbolGlyphNameEntry(rawName)?.unicode ?? glyphNameToUnicode(rawName);
  }
  return glyphNameToUnicode(rawName);
}

function glyphNameToSelectionUnicodeForFont(rawName: string, baseFont: string): string | null {
  return resolveNativeStandard14MetricFace(baseFont) === "symbol"
    ? nativeSymbolGlyphNameEntry(rawName)?.selectionUnicode ?? glyphNameToUnicode(rawName)
    : glyphNameToUnicodeForFont(rawName, baseFont);
}

/**
 * Cover the regular Latin production-name family without carrying a large
 * eager AGL table. Multiple suffixes (for example `uhungarumlaut`) are
 * converted to combining marks and normalized to NFC when Unicode defines a
 * precomposed scalar.
 */
function composeProductionGlyphName(name: string): string | null {
  const bases: Readonly<Record<string, string>> = {
    dotlessi: "\u0131",
    dotlessj: "\u0237"
  };
  const accents: readonly (readonly [string, string])[] = [
    ["hungarumlaut", "\u030b"],
    ["commaaccent", "\u0326"],
    ["circumflex", "\u0302"],
    ["dotaccent", "\u0307"],
    ["dieresis", "\u0308"],
    ["cedilla", "\u0327"],
    ["ogonek", "\u0328"],
    ["macron", "\u0304"],
    ["breve", "\u0306"],
    ["caron", "\u030c"],
    ["acute", "\u0301"],
    ["grave", "\u0300"],
    ["tilde", "\u0303"],
    ["ring", "\u030a"]
  ];
  let remainder = name;
  const marks: string[] = [];
  while (remainder.length > 0) {
    const accent = accents.find(([suffix]) => remainder.endsWith(suffix));
    if (!accent) break;
    remainder = remainder.slice(0, -accent[0].length);
    marks.unshift(accent[1]);
  }
  if (marks.length === 0) return null;
  const base = remainder.length === 1 ? remainder : bases[remainder];
  if (!base) return null;
  return `${base}${marks.join("")}`.normalize("NFC");
}

const AGL: Readonly<Record<string, string>> = Object.freeze({
  space: " ", nonbreakingspace: "\u00a0", exclam: "!", quotedbl: "\"", numbersign: "#",
  dollar: "$", percent: "%", ampersand: "&", quotesingle: "'", quoteright: "’",
  quoteleft: "‘", parenleft: "(", parenright: ")", asterisk: "*", plus: "+", comma: ",",
  hyphen: "-", minus: "−", period: ".", slash: "/", colon: ":", semicolon: ";",
  less: "<", equal: "=", greater: ">", question: "?", at: "@", bracketleft: "[",
  backslash: "\\", bracketright: "]", asciicircum: "^", underscore: "_", grave: "`",
  braceleft: "{", bar: "|", braceright: "}", asciitilde: "~", exclamdown: "¡",
  cent: "¢", sterling: "£", currency: "¤", yen: "¥", brokenbar: "¦", section: "§",
  dieresis: "¨", copyright: "©", ordfeminine: "ª", guillemotleft: "«", logicalnot: "¬",
  registered: "®", macron: "¯", degree: "°", plusminus: "±", twosuperior: "²",
  threesuperior: "³", acute: "´", mu: "µ", paragraph: "¶", periodcentered: "·",
  cedilla: "¸", onesuperior: "¹", ordmasculine: "º", guillemotright: "»",
  onequarter: "¼", onehalf: "½", threequarters: "¾", questiondown: "¿",
  multiply: "×", divide: "÷", fraction: "⁄", florin: "ƒ", endash: "–", emdash: "—",
  dagger: "†", daggerdbl: "‡", bullet: "•", ellipsis: "…", perthousand: "‰",
  quotesinglbase: "‚", quotedblbase: "„", quotedblleft: "“", quotedblright: "”",
  guilsinglleft: "‹", guilsinglright: "›", Euro: "€", trademark: "™", fi: "ﬁ", fl: "ﬂ",
  notequal: "≠", lessequal: "≤", greaterequal: "≥", partialdiff: "∂", summation: "∑",
  radical: "√", lozenge: "◊",
  AE: "Æ", ae: "æ", OE: "Œ", oe: "œ", Oslash: "Ø", oslash: "ø", Lslash: "Ł",
  lslash: "ł", germandbls: "ß", dotlessi: "ı", dotlessj: "ȷ", Eth: "Ð", eth: "ð",
  Thorn: "Þ", thorn: "þ", Dcroat: "Đ", dcroat: "đ", Eng: "Ŋ", eng: "ŋ",
  IJ: "Ĳ", ij: "ĳ", Scedilla: "Ş", scedilla: "ş", Tcedilla: "Ţ", tcedilla: "ţ",
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9", caron: "ˇ", breve: "˘",
  circumflex: "ˆ", dotaccent: "˙", ring: "˚", ogonek: "˛", tilde: "˜",
  hungarumlaut: "˝",
  Alpha: "Α", Beta: "Β", Gamma: "Γ", Delta: "∆", Epsilon: "Ε", Zeta: "Ζ",
  Eta: "Η", Theta: "Θ", Iota: "Ι", Kappa: "Κ", Lambda: "Λ", Mu: "Μ", Nu: "Ν",
  Xi: "Ξ", Omicron: "Ο", Pi: "Π", Rho: "Ρ", Sigma: "Σ", Tau: "Τ", Upsilon: "Υ",
  Phi: "Φ", Chi: "Χ", Psi: "Ψ", Omega: "Ω", alpha: "α", beta: "β", gamma: "γ",
  delta: "δ", epsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", iota: "ι",
  kappa: "κ", lambda: "λ", mu1: "μ", nu: "ν", xi: "ξ", omicron: "ο", pi: "π",
  rho: "ρ", sigma: "σ", sigma1: "ς", tau: "τ", upsilon: "υ", phi: "φ", chi: "χ",
  psi: "ψ", omega: "ω"
});

const MAC_ROMAN = Array.from(
  "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ"
);

function fillSymbolEncoding(
  names: (string | null)[],
  unicode: (string | null)[],
  selectionUnicode: (string | null)[]
): void {
  for (let code = 0; code < 256; code += 1) {
    const entry = nativeSymbolEncodingEntry(code);
    if (!entry) continue;
    names[code] = entry.glyphName;
    unicode[code] = entry.unicode;
    selectionUnicode[code] = entry.selectionUnicode;
  }
}

// Preserve the first AGL alias, matching the previous ordered lookup.
const PREFERRED_GLYPH_NAMES = new Map<string, string>();
for (const [name, unicode] of Object.entries(AGL)) {
  if (!PREFERRED_GLYPH_NAMES.has(unicode)) PREFERRED_GLYPH_NAMES.set(unicode, name);
}

function asciiGlyphName(code: number): string {
  if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) return String.fromCharCode(code);
  if (code >= 48 && code <= 57) return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][code - 48];
  return ({
    32: "space", 33: "exclam", 34: "quotedbl", 35: "numbersign", 36: "dollar",
    37: "percent", 38: "ampersand", 39: "quotesingle", 40: "parenleft", 41: "parenright",
    42: "asterisk", 43: "plus", 44: "comma", 45: "hyphen", 46: "period", 47: "slash",
    58: "colon", 59: "semicolon", 60: "less", 61: "equal", 62: "greater", 63: "question",
    64: "at", 91: "bracketleft", 92: "backslash", 93: "bracketright", 94: "asciicircum",
    95: "underscore", 96: "grave", 123: "braceleft", 124: "bar", 125: "braceright",
    126: "asciitilde"
  } as Record<number, string>)[code] ?? `.notdef`;
}

function unicodeToPreferredGlyphName(value: string): string | null {
  const preferred = PREFERRED_GLYPH_NAMES.get(value);
  if (preferred !== undefined) return preferred;
  const composedName = unicodeToComposedGlyphName(value);
  if (composedName !== null) return composedName;
  const scalar = value.codePointAt(0);
  return scalar === undefined ? null : scalar <= 0xffff
    ? `uni${scalar.toString(16).toUpperCase().padStart(4, "0")}`
    : `u${scalar.toString(16).toUpperCase()}`;
}

function unicodeToComposedGlyphName(value: string): string | null {
  const characters = Array.from(value.normalize("NFD"));
  if (characters.length < 2 || characters[0].length !== 1) return null;
  const suffixes: Readonly<Record<string, string>> = {
    "\u0300": "grave",
    "\u0301": "acute",
    "\u0302": "circumflex",
    "\u0303": "tilde",
    "\u0304": "macron",
    "\u0306": "breve",
    "\u0307": "dotaccent",
    "\u0308": "dieresis",
    "\u030a": "ring",
    "\u030b": "hungarumlaut",
    "\u030c": "caron",
    "\u0326": "commaaccent",
    "\u0327": "cedilla",
    "\u0328": "ogonek"
  };
  let glyphName = characters[0];
  for (let index = 1; index < characters.length; index += 1) {
    const suffix = suffixes[characters[index]];
    if (suffix === undefined) return null;
    glyphName += suffix;
  }
  return glyphNameToUnicode(glyphName) === value ? glyphName : null;
}

function decodeWinAnsi(code: number): number | null {
  const special: Readonly<Record<number, number>> = {
    0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
    0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
    0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
    0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
    0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
    0x9e: 0x017e, 0x9f: 0x0178
  };
  if (code >= 0xa0) return code;
  return special[code] ?? null;
}

function defaultEncodingForFont(baseFont: string): string {
  const stripped = stripSubsetPrefix(baseFont);
  if (stripped === "Symbol" || stripped === "ZapfDingbats") return "StandardEncoding";
  return "StandardEncoding";
}

function stripSubsetPrefix(name: string): string {
  return /^[A-Z]{6}\+/.test(name) ? name.slice(7) : name;
}

function firstUnicodeScalar(value: string): number {
  return value.codePointAt(0) ?? -1;
}

function cmapKey(code: number, length: number): string {
  return `${length}:${code}`;
}

function readCode(bytes: Uint8Array, offset: number, length: number): number {
  let result = 0;
  for (let index = 0; index < length; index += 1) result = result * 256 + bytes[offset + index];
  return result;
}

function bytesToCode(bytes: Uint8Array): number {
  return readCode(bytes, 0, bytes.length);
}

function incrementBigEndian(bytes: Uint8Array, amount: number): Uint8Array {
  const result = bytes.slice();
  let carry = amount;
  for (let offset = result.length - 1; offset >= 0 && carry > 0; offset -= 1) {
    const value = result[offset] + carry;
    result[offset] = value & 0xff;
    carry = Math.floor(value / 256);
  }
  if (carry > 0) throw unsupportedFont("CMap bfrange target overflows its byte string.");
  return result;
}

function decodeUtf16Be(bytes: Uint8Array): string {
  if (bytes.length % 2 !== 0) throw unsupportedFont("A ToUnicode target has odd UTF-16BE length.");
  // A ToUnicode destination is already declared to be UTF-16BE. Consequently
  // FEFF is the Unicode value U+FEFF, not an encoding signature to discard.
  // An empty destination is an explicit mapping to no Unicode text; retaining
  // it as "" lets the painted glyph keep its geometry without inventing a
  // replacement character in the mandatory text index.
  let result = "";
  for (let offset = 0; offset < bytes.length; offset += 2) {
    const unit = (bytes[offset] << 8) | bytes[offset + 1];
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (offset + 3 >= bytes.length) {
        throw unsupportedFont("A ToUnicode target ends with an unpaired high surrogate.");
      }
      const low = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (low < 0xdc00 || low > 0xdfff) {
        throw unsupportedFont("A ToUnicode target contains an unpaired high surrogate.");
      }
      result += String.fromCharCode(unit, low);
      offset += 2;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw unsupportedFont("A ToUnicode target contains an unpaired low surrogate.");
    } else {
      result += String.fromCharCode(unit);
    }
  }
  return result;
}

function requireCMapTarget(token: CMapToken | undefined, label: string): Uint8Array {
  if (token?.kind !== "hex") throw unsupportedFont(`CMap ${label} is not a hex string.`);
  if (token.value.length > MAX_CMAP_DESTINATION_BYTES) {
    throw unsupportedFont(`CMap ${label} has an unsupported length.`);
  }
  return token.value;
}

function requireCMapSource(token: CMapToken | undefined, label: string): Uint8Array {
  if (token?.kind !== "hex") throw unsupportedFont(`CMap ${label} is not a hex string.`);
  const bytes = token.value;
  if (bytes.length < 1 || bytes.length > MAX_CMAP_SOURCE_BYTES) {
    throw unsupportedFont(`CMap ${label} must contain one through four bytes.`);
  }
  return bytes;
}

function requireCMapNumber(token: CMapToken | undefined, label: string): number {
  if (token?.kind !== "number" || !Number.isSafeInteger(token.value) || token.value < 0) {
    throw unsupportedFont(`CMap ${label} is not a nonnegative integer.`);
  }
  return token.value;
}

async function requireDictionary(
  value: PdfValue,
  resolver: NativePdfFontResolver,
  signal: AbortSignal | undefined,
  label: string
): Promise<PdfDictionary> {
  const resolved = await resolver.resolveValue(value, signal);
  if (isPdfStream(resolved)) return resolved.dictionary;
  if (!isPdfDictionary(resolved)) throw unsupportedFont(`PDF ${label} is not a dictionary.`);
  return resolved;
}

async function resolveArray(
  value: PdfValue | undefined,
  resolver: NativePdfFontResolver,
  signal?: AbortSignal
): Promise<readonly PdfValue[] | null> {
  if (value === undefined || value === null) return null;
  const resolved = await resolver.resolveValue(value, signal);
  if (!Array.isArray(resolved)) return null;
  const result: PdfValue[] = [];
  for (const item of resolved) result.push((await resolver.resolveValue(item, signal)) ?? null);
  return result;
}

async function resolveOptionalArrayStrict(
  dictionary: PdfDictionary,
  key: string,
  resolver: NativePdfFontResolver,
  signal?: AbortSignal
): Promise<readonly PdfValue[] | null> {
  if (!dictionary.has(key)) return null;
  const resolved = await resolver.resolveValue(dictionary.get(key), signal);
  if (resolved === undefined || resolved === null) return null;
  if (!Array.isArray(resolved)) throw unsupportedFont(`CID font /${key} must be an array.`);
  const result: PdfValue[] = [];
  for (const raw of resolved) {
    const value = (await resolver.resolveValue(raw, signal)) ?? null;
    if (Array.isArray(value)) {
      const nested: PdfValue[] = [];
      for (const item of value) nested.push((await resolver.resolveValue(item, signal)) ?? null);
      result.push(nested);
    } else {
      result.push(value);
    }
  }
  return result;
}

async function readOptionalPair(
  dictionary: PdfDictionary,
  key: string,
  first: number,
  second: number,
  resolver: NativePdfFontResolver,
  signal?: AbortSignal
): Promise<readonly [number, number]> {
  if (!dictionary.has(key)) return [first, second];
  const values = await resolveNumberArray(dictionary.get(key), 2, resolver, signal);
  if (!values) throw unsupportedFont(`CID font /${key} must contain two finite numbers.`);
  return [values[0], values[1]];
}

async function readOptionalFiniteNumber(
  dictionary: PdfDictionary,
  key: string,
  fallback: number,
  resolver: NativePdfFontResolver,
  signal?: AbortSignal
): Promise<number> {
  if (!dictionary.has(key)) return fallback;
  const value = await resolver.resolveValue(dictionary.get(key), signal);
  const number = finiteNumber(value);
  if (number === null) throw unsupportedFont(`CID font /${key} must be a finite number.`);
  return number;
}

function reserveCidMetrics(current: number, additional: number, limit: number): number {
  if (!Number.isSafeInteger(additional) || additional < 0 || additional > limit - current) {
    throw new PdfError("resource-limit", "CID metric expansion exceeds the configured entry limit.", {
      details: { reason: "font-cid-metric-limit", limit }
    });
  }
  return current + additional;
}

async function resolveNumberArray(
  value: PdfValue | undefined,
  length: number,
  resolver: NativePdfFontResolver,
  signal?: AbortSignal
): Promise<readonly number[] | null> {
  const values = await resolveArray(value, resolver, signal);
  if (!values || values.length !== length) return null;
  const numbers = values.map(finiteNumber);
  return numbers.every((number): number is number => number !== null) ? numbers : null;
}

function optionalName(value: PdfValue | undefined): string | null {
  return isPdfName(value) ? value.value : null;
}

function requireName(value: PdfValue | undefined, message: string): string {
  const name = optionalName(value);
  if (name === null) throw unsupportedFont(message);
  return name;
}

function finiteNumber(value: PdfValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberOr(value: PdfValue | undefined, fallback: number): number {
  return finiteNumber(value) ?? fallback;
}

function integerOr(value: PdfValue | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : fallback;
}

function requireNumberValue(value: PdfValue | undefined, label: string): number {
  const number = finiteNumber(value);
  if (number === null) throw unsupportedFont(`${label} must be numeric.`);
  return number;
}

function requireIntegerValue(value: PdfValue | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw unsupportedFont(`${label} must be a nonnegative integer.`);
  }
  return value;
}

function readNumberArray(value: PdfValue | undefined, length: number): readonly number[] | null {
  if (!Array.isArray(value) || value.length !== length) return null;
  const numbers = value.map(finiteNumber);
  return numbers.every((number): number is number => number !== null) ? numbers : null;
}

function looksLikeSfnt(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const tag = ascii(bytes, 0, 4);
  return (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) ||
    tag === "OTTO" || tag === "true" || tag === "typ1" || tag === "ttcf";
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let result = "";
  for (let offset = start; offset < end; offset += 1) result += String.fromCharCode(bytes[offset]);
  return result;
}

function isCMapWhitespace(byte: number): boolean {
  return byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
}

function isCMapDelimiter(byte: number): boolean {
  return isCMapWhitespace(byte) || byte === 0x25 || byte === 0x2f || byte === 0x3c ||
    byte === 0x3e || byte === 0x5b || byte === 0x5d || byte === 0x28 || byte === 0x29;
}

function hexNibble(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return -1;
}

function mergeFontParserLimits(
  overrides: Partial<NativePdfFontParserLimits> | undefined
): Readonly<NativePdfFontParserLimits> {
  const defaults = DEFAULT_NATIVE_PDF_FONT_PARSER_LIMITS;
  return Object.freeze({
    maxCMapBytes: boundedParserLimit(overrides?.maxCMapBytes, defaults.maxCMapBytes, "maxCMapBytes"),
    maxCMapMappings: boundedParserLimit(
      overrides?.maxCMapMappings,
      defaults.maxCMapMappings,
      "maxCMapMappings"
    ),
    maxCMapTokens: boundedParserLimit(overrides?.maxCMapTokens, defaults.maxCMapTokens, "maxCMapTokens"),
    maxCodeSpaceRanges: boundedParserLimit(
      overrides?.maxCodeSpaceRanges,
      defaults.maxCodeSpaceRanges,
      "maxCodeSpaceRanges"
    ),
    maxUseCMapDepth: boundedParserLimit(
      overrides?.maxUseCMapDepth,
      defaults.maxUseCMapDepth,
      "maxUseCMapDepth"
    ),
    maxCidMetricEntries: boundedParserLimit(
      overrides?.maxCidMetricEntries,
      defaults.maxCidMetricEntries,
      "maxCidMetricEntries"
    ),
    maxSimpleEncodingDifferences: boundedParserLimit(
      overrides?.maxSimpleEncodingDifferences,
      defaults.maxSimpleEncodingDifferences,
      "maxSimpleEncodingDifferences"
    ),
    maxCffBytes: boundedParserLimit(overrides?.maxCffBytes, defaults.maxCffBytes, "maxCffBytes"),
    maxCffIndexEntries: boundedParserLimit(
      overrides?.maxCffIndexEntries,
      defaults.maxCffIndexEntries,
      "maxCffIndexEntries"
    ),
    maxCffStringBytes: boundedParserLimit(
      overrides?.maxCffStringBytes,
      defaults.maxCffStringBytes,
      "maxCffStringBytes"
    ),
    maxType2CharStringBytes: boundedParserLimit(
      overrides?.maxType2CharStringBytes,
      defaults.maxType2CharStringBytes,
      "maxType2CharStringBytes"
    ),
    maxType2Operators: boundedParserLimit(
      overrides?.maxType2Operators,
      defaults.maxType2Operators,
      "maxType2Operators"
    ),
    maxType2SubrDepth: boundedParserLimit(
      overrides?.maxType2SubrDepth,
      defaults.maxType2SubrDepth,
      "maxType2SubrDepth"
    ),
    maxType2SubrCalls: boundedParserLimit(
      overrides?.maxType2SubrCalls,
      defaults.maxType2SubrCalls,
      "maxType2SubrCalls"
    ),
    maxType2PathCommands: boundedParserLimit(
      overrides?.maxType2PathCommands,
      defaults.maxType2PathCommands,
      "maxType2PathCommands"
    ),
    ...mergeSfntParserLimits(overrides)
  });
}

function mergeSfntParserLimits(
  overrides: Partial<NativeSfntParserLimits> | undefined
): Readonly<NativeSfntParserLimits> {
  const defaults = DEFAULT_NATIVE_SFNT_PARSER_LIMITS;
  return Object.freeze({
    maxSfntFaces: boundedParserLimit(
      overrides?.maxSfntFaces,
      defaults.maxSfntFaces,
      "maxSfntFaces"
    ),
    maxSfntTables: boundedParserLimit(
      overrides?.maxSfntTables,
      defaults.maxSfntTables,
      "maxSfntTables"
    ),
    maxSfntCmapRecords: boundedParserLimit(
      overrides?.maxSfntCmapRecords,
      defaults.maxSfntCmapRecords,
      "maxSfntCmapRecords"
    ),
    maxSfntCmapGroups: boundedParserLimit(
      overrides?.maxSfntCmapGroups,
      defaults.maxSfntCmapGroups,
      "maxSfntCmapGroups"
    ),
    maxGlyphPoints: boundedParserLimit(
      overrides?.maxGlyphPoints,
      defaults.maxGlyphPoints,
      "maxGlyphPoints"
    ),
    maxCompoundGlyphDepth: boundedParserLimit(
      overrides?.maxCompoundGlyphDepth,
      defaults.maxCompoundGlyphDepth,
      "maxCompoundGlyphDepth"
    ),
    maxCompoundGlyphComponents: boundedParserLimit(
      overrides?.maxCompoundGlyphComponents,
      defaults.maxCompoundGlyphComponents,
      "maxCompoundGlyphComponents"
    ),
    maxGlyphInstructionBytes: boundedParserLimit(
      overrides?.maxGlyphInstructionBytes,
      defaults.maxGlyphInstructionBytes,
      "maxGlyphInstructionBytes"
    )
  });
}

function boundedParserLimit(value: number | undefined, maximum: number, name: string): number {
  const configured = value ?? maximum;
  if (!Number.isSafeInteger(configured) || configured <= 0 || configured > maximum) {
    throw new RangeError(`${name} must be a positive safe integer no greater than ${maximum}.`);
  }
  return configured;
}

function readTag(view: DataView, offset: number): string {
  if (!sfntRangeFits(offset, 4, view.byteLength)) {
    throw unsupportedFont("An sfnt tag is out of bounds.");
  }
  return String.fromCharCode(
    view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3)
  );
}

function isSfntFaceSignature(signature: number): boolean {
  return signature === 0x00010000 || signature === 0x4f54544f ||
    signature === 0x74727565 || signature === 0x74797031;
}

function safeU32(view: DataView, offset: number): number {
  if (!sfntRangeFits(offset, 4, view.byteLength)) {
    throw unsupportedFont("An sfnt read is out of bounds.");
  }
  return view.getUint32(offset, false);
}

function boundedU16(view: DataView, offset: number, table: SfntTable): number {
  if (
    !Number.isSafeInteger(offset) || offset < table.offset ||
    !sfntRangeFits(offset - table.offset, 2, table.length)
  ) {
    throw unsupportedFont("An sfnt cmap read is out of bounds.");
  }
  return view.getUint16(offset, false);
}

function boundedU32(view: DataView, offset: number, table: SfntTable): number {
  if (
    !Number.isSafeInteger(offset) || offset < table.offset ||
    !sfntRangeFits(offset - table.offset, 4, table.length)
  ) {
    throw unsupportedFont("An sfnt cmap read is out of bounds.");
  }
  return view.getUint32(offset, false);
}

function boundedU24(view: DataView, offset: number, table: SfntTable): number {
  if (
    !Number.isSafeInteger(offset) || offset < table.offset ||
    !sfntRangeFits(offset - table.offset, 3, table.length)
  ) {
    throw unsupportedFont("An sfnt cmap read is out of bounds.");
  }
  return view.getUint8(offset) * 0x10000 + view.getUint16(offset + 1, false);
}

function requireSfntTableLength(table: SfntTable, minimum: number, tag: string): void {
  if (!Number.isSafeInteger(minimum) || minimum < 0 || table.length < minimum) {
    throw unsupportedFont(`The sfnt ${tag} table is truncated.`);
  }
}

function checkedSfntAdd(left: number, right: number, label: string): number {
  if (
    !Number.isSafeInteger(left) || left < 0 ||
    !Number.isSafeInteger(right) || right < 0 ||
    left > Number.MAX_SAFE_INTEGER - right
  ) {
    throw unsupportedFont(`The sfnt ${label} arithmetic overflows.`);
  }
  return left + right;
}

function checkedSfntMultiply(left: number, right: number, label: string): number {
  if (
    !Number.isSafeInteger(left) || left < 0 ||
    !Number.isSafeInteger(right) || right < 0 ||
    (left !== 0 && right > Math.floor(Number.MAX_SAFE_INTEGER / left))
  ) {
    throw unsupportedFont(`The sfnt ${label} arithmetic overflows.`);
  }
  return left * right;
}

function sfntRangeFits(offset: number, length: number, totalLength: number): boolean {
  return Number.isSafeInteger(offset) && offset >= 0 &&
    Number.isSafeInteger(length) && length >= 0 &&
    Number.isSafeInteger(totalLength) && totalLength >= 0 &&
    offset <= totalLength && length <= totalLength - offset;
}

function cmapRangeFits(parent: SfntTable, absoluteOffset: number, length: number): boolean {
  return Number.isSafeInteger(absoluteOffset) && absoluteOffset >= parent.offset &&
    sfntRangeFits(absoluteOffset - parent.offset, length, parent.length);
}

function rangesOverlap(
  leftOffset: number,
  leftLength: number,
  rightOffset: number,
  rightLength: number
): boolean {
  if (leftLength === 0 || rightLength === 0) return false;
  return leftOffset < rightOffset + rightLength && rightOffset < leftOffset + leftLength;
}

function calculateSfntTableChecksum(
  view: DataView,
  table: SfntTable,
  zeroHeadAdjustment: boolean
): number {
  let checksum = 0;
  for (let relative = 0; relative < table.length; relative += 4) {
    let word = 0;
    for (let byteIndex = 0; byteIndex < 4; byteIndex += 1) {
      const position = relative + byteIndex;
      const byte = position >= table.length ||
        (zeroHeadAdjustment && position >= 8 && position < 12)
        ? 0
        : view.getUint8(table.offset + position);
      word = (word * 256 + byte) >>> 0;
    }
    checksum = (checksum + word) >>> 0;
  }
  return checksum;
}

function freezeBounds(
  values: readonly number[],
  label: string
): readonly [number, number, number, number] {
  if (
    values.length !== 4 || values.some((value) => !Number.isFinite(value)) ||
    values[0] > values[2] || values[1] > values[3]
  ) {
    throw unsupportedFont(`The ${label} bounding box is invalid.`);
  }
  return Object.freeze([values[0], values[1], values[2], values[3]]);
}

function resolveGlyphBounds(
  points: readonly GlyphPoint[],
  declaredBounds: readonly [number, number, number, number],
  glyphId: number,
  validation: "strict" | "pdf-embedded"
): readonly [number, number, number, number] {
  if (points.length === 0) return declaredBounds;
  let actualXMin = Number.POSITIVE_INFINITY;
  let actualYMin = Number.POSITIVE_INFINITY;
  let actualXMax = Number.NEGATIVE_INFINITY;
  let actualYMax = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (
      !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
      point.x < -32_768 || point.x > 32_767 ||
      point.y < -32_768 || point.y > 32_767
    ) {
      throw unsupportedFont(
        `TrueType glyph ${glyphId} has a point outside the FWORD coordinate range.`
      );
    }
    actualXMin = Math.min(actualXMin, point.x);
    actualYMin = Math.min(actualYMin, point.y);
    actualXMax = Math.max(actualXMax, point.x);
    actualYMax = Math.max(actualYMax, point.y);
  }
  const [xMin, yMin, xMax, yMax] = declaredBounds;
  const exceedsDeclaredBounds = actualXMin < xMin || actualXMax > xMax ||
    actualYMin < yMin || actualYMax > yMax;
  if (!exceedsDeclaredBounds) return declaredBounds;
  if (validation === "strict") {
    throw unsupportedFont(`TrueType glyph ${glyphId} has a point outside its declared bounds.`);
  }
  // PDF subsetters in the wild can rewrite simple-glyph coordinates without
  // refreshing the glyph header. The decoded point program is the rendering
  // authority; keep every point and derive a conservative bound from it. All
  // byte spans, point/component budgets, and FWORD coordinate limits remain
  // mandatory before this compatibility rule is reached.
  return Object.freeze([actualXMin, actualYMin, actualXMax, actualYMax]);
}

function consumeSfntCmapGroups(
  budget: { count: number },
  count: number,
  limits: Readonly<NativeSfntParserLimits>
): void {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw unsupportedFont("An sfnt cmap group count is invalid.");
  }
  budget.count = checkedSfntAdd(budget.count, count, "cmap group count");
  if (budget.count > limits.maxSfntCmapGroups) {
    throw sfntLimit("The sfnt cmap group count exceeds the configured limit.");
  }
}

function isCandidateCmapEncoding(platform: number, encoding: number): boolean {
  return (platform === 0 && encoding !== 5) ||
    (platform === 3 && (encoding === 0 || encoding === 1 || encoding === 10));
}

function isUnicodeVariationSelector(value: number): boolean {
  return (value >= 0xfe00 && value <= 0xfe0f) ||
    (value >= 0xe0100 && value <= 0xe01ef);
}

function unicodeRangeContainsSurrogates(start: number, end: number): boolean {
  return start <= 0xdfff && end >= 0xd800;
}

function sfntLimit(message: string): PdfError {
  return new PdfError("resource-limit", message);
}

function unsupportedFont(message: string): PdfError {
  return new PdfError("unsupported-font", message);
}
