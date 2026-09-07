import {
  isPdfDictionary,
  isPdfName,
  isPdfRef,
  isPdfStream,
  pdfRefKey,
  type PdfDictionary,
  type PdfRef,
  type PdfStream,
  type PdfValue
} from "./nativeCos";
import type { NativePdfDocument } from "./nativeDocument";
import { parseNativePdfFont, parseToUnicodeCMap } from "./nativeFont";
import { PdfError, throwIfAborted } from "./nativeTypes";

export type NativePdfType3Matrix = readonly [number, number, number, number, number, number];
export type NativePdfType3Rectangle = readonly [number, number, number, number];
export type NativePdfType3ResourceOrigin = "local" | "inherited" | "empty";

export interface NativePdfType3ColoredMetrics {
  readonly operator: "d0";
  readonly colored: true;
  readonly widthX: number;
  readonly widthY: 0;
  readonly boundingBox: null;
  /** Byte immediately after the d0 token. */
  readonly contentOffset: number;
}

export interface NativePdfType3UncoloredMetrics {
  readonly operator: "d1";
  readonly colored: false;
  readonly widthX: number;
  readonly widthY: 0;
  readonly boundingBox: NativePdfType3Rectangle;
  /** Byte immediately after the d1 token. */
  readonly contentOffset: number;
}

export type NativePdfType3Metrics =
  | NativePdfType3ColoredMetrics
  | NativePdfType3UncoloredMetrics;

/** A decoded, structurally prepared CharProc ready for normal content compilation. */
export interface NativePdfType3CharProcRecord {
  readonly index: number;
  /** Source stream plus effective-resource identity. */
  readonly id: string;
  readonly ref: PdfRef | null;
  readonly dictionary: PdfDictionary;
  readonly resources: PdfDictionary;
  readonly resourceOrigin: NativePdfType3ResourceOrigin;
  readonly encodedContentBytes: number;
  readonly decodedBytes: Uint8Array;
  readonly metrics: NativePdfType3Metrics;
}

export interface NativePdfType3GlyphInvocation {
  readonly font: NativePdfPreparedType3Font;
  readonly code: number;
  readonly charProcName: string;
  readonly width: number;
  /** Unicode implied by /Encoding only; never by /ToUnicode. */
  readonly encodingUnicode: string | null;
  /** Semantic text mapping only; never used to choose the CharProc. */
  readonly toUnicode: string | null;
  readonly charProc: NativePdfType3CharProcRecord;
  readonly depth: number;
  readonly ancestry: readonly string[];
}

export interface NativePdfPreparedType3Font {
  readonly id: string;
  readonly dictionary: PdfDictionary;
  readonly fontMatrix: NativePdfType3Matrix;
  readonly fontBBox: NativePdfType3Rectangle;
  readonly firstChar: number;
  readonly lastChar: number;
  readonly widths: readonly number[];
  readonly charProcNames: readonly string[];
  readonly encodingUnicode: readonly (string | null)[];
  readonly toUnicode: readonly (string | null)[];
  readonly charProcs: ReadonlyMap<string, PdfValue>;
  readonly resources: PdfDictionary;
  readonly resourceOrigin: NativePdfType3ResourceOrigin;
  charProcNameForCode(code: number): string;
  widthForCode(code: number): number | null;
  resolveCharProc(name: string, signal?: AbortSignal): Promise<NativePdfType3CharProcRecord>;
  resolveGlyph(code: number, signal?: AbortSignal): Promise<NativePdfType3GlyphInvocation>;
}

export interface NativePdfType3PrepareOptions {
  /** Resource scope inherited by a font with no local /Resources. */
  readonly inheritedResources?: PdfDictionary;
  /** Optional source identity when the caller already knows the font reference. */
  readonly fontRef?: PdfRef;
  readonly signal?: AbortSignal;
}

export interface NativePdfType3Options {
  /** May lower, but never raise, the document recursion ceiling. */
  readonly maxCharProcDepth?: number;
  /** Maximum CharProc entries in one font and decoded definitions retained. */
  readonly maxCharProcs?: number;
  /** Maximum decoded bytes for one CharProc. */
  readonly maxDecodedCharProcBytes?: number;
  /** Maximum decoded CharProc bytes retained by this registry. */
  readonly maxCachedDecodedCharProcBytes?: number;
}

interface EffectiveResources {
  readonly dictionary: PdfDictionary;
  readonly origin: NativePdfType3ResourceOrigin;
  readonly identity: string;
}

interface CharProcResolutionStack {
  readonly aliases: ReadonlySet<string>;
  readonly refs: ReadonlySet<string>;
}

interface ParsedType3FontData {
  readonly fontMatrix: NativePdfType3Matrix;
  readonly fontBBox: NativePdfType3Rectangle;
  readonly firstChar: number;
  readonly lastChar: number;
  readonly widths: readonly number[];
  readonly charProcNames: readonly string[];
  readonly encodingUnicode: readonly (string | null)[];
  readonly toUnicode: readonly (string | null)[];
  readonly charProcs: PdfDictionary;
}

const EMPTY_RESOURCES: PdfDictionary = new Map();
const MAX_UINT32 = 0xffff_ffff;
const TYPE3_BYTES = new Uint8Array(1);

/**
 * Lazy Type3 font preparation owned by the dependency-free PDF engine.
 *
 * Definitions are cached by both stream identity and effective resource
 * scope. Invocation ancestry is tracked separately, allowing aliases to share
 * decoded bytes without allowing recursive Type3 resources to hide in the
 * definition cache.
 */
export class NativePdfType3Registry {
  readonly document: NativePdfDocument;

  private readonly maxCharProcDepth: number;
  private readonly maxCharProcs: number;
  private readonly maxDecodedCharProcBytes: number;
  private readonly maxCachedDecodedCharProcBytes: number;
  private readonly fonts = new Set<PreparedType3Font>();
  private readonly fontCache = new Map<string, Promise<PreparedType3Font>>();
  private readonly records: NativePdfType3CharProcRecord[] = [];
  private readonly recordCache = new Map<string, Promise<NativePdfType3CharProcRecord>>();
  private readonly invocations = new WeakSet<object>();
  private readonly objectIds = new WeakMap<object, number>();
  private nextObjectId = 1;
  private cachedDecodedBytes = 0;

  constructor(document: NativePdfDocument, options: NativePdfType3Options = {}) {
    this.document = document;
    this.maxCharProcDepth = boundedOption(
      options.maxCharProcDepth,
      document.limits.maxRecursionDepth,
      "maxCharProcDepth"
    );
    this.maxCharProcs = boundedOption(
      options.maxCharProcs,
      document.limits.maxGlyphsPerPage,
      "maxCharProcs"
    );
    this.maxDecodedCharProcBytes = boundedOption(
      options.maxDecodedCharProcBytes,
      document.limits.maxDecodedStreamBytes,
      "maxDecodedCharProcBytes"
    );
    this.maxCachedDecodedCharProcBytes = boundedOption(
      options.maxCachedDecodedCharProcBytes,
      document.limits.maxDecodedStreamBytes,
      "maxCachedDecodedCharProcBytes"
    );
  }

  get size(): number {
    return this.records.length;
  }

  get charProcDepthLimit(): number {
    return this.maxCharProcDepth;
  }

  describe(index: number): NativePdfType3CharProcRecord {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.records.length) {
      throw new RangeError(`Type3 CharProc index ${index} is out of range.`);
    }
    return this.records[index];
  }

  /** Validate a resolved Type3 dictionary while leaving every CharProc lazy. */
  async prepareFont(
    dictionary: PdfDictionary,
    options: NativePdfType3PrepareOptions = {}
  ): Promise<NativePdfPreparedType3Font> {
    throwIfAborted(options.signal);
    if (!isPdfDictionary(dictionary)) {
      throw new TypeError("prepareFont requires a resolved PDF font dictionary.");
    }
    const resources = await this.resolveResources(
      dictionary,
      options.inheritedResources,
      options.signal
    );
    const sourceIdentity = options.fontRef
      ? `ref:${pdfRefKey(options.fontRef)}`
      : this.objectIdentity(dictionary);
    const identity = `${sourceIdentity}|resources:${resources.identity}`;
    const cached = this.fontCache.get(identity);
    if (cached) return await cached;
    const pending = this.parseFont(dictionary, resources, identity, options.signal)
      .catch((error) => {
        this.fontCache.delete(identity);
        throw error;
      });
    this.fontCache.set(identity, pending);
    return await pending;
  }

  /** Enter a Type3 glyph reached while compiling another CharProc program. */
  async resolveNestedGlyph(
    parent: NativePdfType3GlyphInvocation,
    font: NativePdfPreparedType3Font,
    code: number,
    signal?: AbortSignal
  ): Promise<NativePdfType3GlyphInvocation> {
    throwIfAborted(signal);
    if (!this.invocations.has(parent as object)) {
      throw new TypeError("The parent Type3 invocation was not created by this registry.");
    }
    const prepared = this.requireFont(font);
    if (parent.depth >= this.maxCharProcDepth) {
      throw new PdfError(
        "resource-limit",
        `Type3 CharProc invocation exceeds the configured depth limit of ${this.maxCharProcDepth}.`,
        {
          details: {
            feature: "type3",
            reason: "type3-charproc-depth",
            limit: this.maxCharProcDepth
          }
        }
      );
    }
    const glyph = await this.resolveGlyphData(prepared, code, signal);
    if (parent.ancestry.includes(glyph.charProc.id)) {
      throw type3Error(
        `Type3 CharProc /${glyph.charProcName} participates in a resource invocation cycle.`,
        "type3-resource-cycle",
        { charProcName: glyph.charProcName, charProcIndex: glyph.charProc.index }
      );
    }
    return this.createInvocation(glyph, parent.depth + 1, [
      ...parent.ancestry,
      glyph.charProc.id
    ]);
  }

  async resolveFontGlyph(
    font: NativePdfPreparedType3Font,
    code: number,
    signal?: AbortSignal
  ): Promise<NativePdfType3GlyphInvocation> {
    const prepared = this.requireFont(font);
    const glyph = await this.resolveGlyphData(prepared, code, signal);
    return this.createInvocation(glyph, 1, [glyph.charProc.id]);
  }

  async resolveFontCharProc(
    font: NativePdfPreparedType3Font,
    rawName: string,
    signal?: AbortSignal
  ): Promise<NativePdfType3CharProcRecord> {
    throwIfAborted(signal);
    const prepared = this.requireFont(font);
    const name = normalizeCharProcName(rawName);
    return await prepared.resolveCharProcInternal(name, emptyResolutionStack(), signal);
  }

  private async parseFont(
    dictionary: PdfDictionary,
    resources: EffectiveResources,
    identity: string,
    signal?: AbortSignal
  ): Promise<PreparedType3Font> {
    await validateFontMarker(this.document, dictionary, signal);
    const data = await parseType3FontData(
      this.document,
      dictionary,
      this.maxCharProcs,
      signal
    );
    const prepared = new PreparedType3Font(this, identity, dictionary, resources, data);
    this.fonts.add(prepared);
    return prepared;
  }

  private async resolveGlyphData(
    font: PreparedType3Font,
    code: number,
    signal?: AbortSignal
  ): Promise<Omit<NativePdfType3GlyphInvocation, "depth" | "ancestry">> {
    throwIfAborted(signal);
    assertCharacterCode(code);
    const width = font.widthForCode(code);
    if (width === null) {
      throw type3Error(
        `Type3 character code ${code} has no declared /Widths entry.`,
        "type3-glyph-width-missing",
        { characterCode: code }
      );
    }
    const charProcName = font.charProcNameForCode(code);
    const charProc = await font.resolveCharProcInternal(
      charProcName,
      emptyResolutionStack(),
      signal
    );
    if (charProc.metrics.widthX !== width) {
      throw type3Error(
        `Type3 CharProc /${charProcName} width does not match the font /Widths entry.`,
        "type3-charproc-width-mismatch",
        {
          characterCode: code,
          charProcName,
          charProcWidth: charProc.metrics.widthX,
          fontWidth: width
        }
      );
    }
    return {
      font,
      code,
      charProcName,
      width,
      encodingUnicode: font.encodingUnicode[code],
      toUnicode: font.toUnicode[code],
      charProc
    };
  }

  private createInvocation(
    glyph: Omit<NativePdfType3GlyphInvocation, "depth" | "ancestry">,
    depth: number,
    ancestry: readonly string[]
  ): NativePdfType3GlyphInvocation {
    const invocation = Object.freeze({
      ...glyph,
      depth,
      ancestry: Object.freeze([...ancestry])
    });
    this.invocations.add(invocation);
    return invocation;
  }

  private requireFont(font: NativePdfPreparedType3Font): PreparedType3Font {
    if (!(font instanceof PreparedType3Font) || !this.fonts.has(font)) {
      throw new TypeError("The Type3 font was not prepared by this registry.");
    }
    return font;
  }

  async loadCharProcValue(
    font: PreparedType3Font,
    value: PdfValue,
    sourceName: string,
    stack: CharProcResolutionStack,
    signal?: AbortSignal,
    sourceRef: PdfRef | null = null
  ): Promise<NativePdfType3CharProcRecord> {
    throwIfAborted(signal);
    if (isPdfName(value)) {
      return await font.resolveCharProcInternal(value.value, stack, signal);
    }
    if (isPdfRef(value)) {
      const refIdentity = pdfRefKey(value);
      if (stack.refs.has(refIdentity)) {
        throw type3Error(
          `Type3 CharProc /${sourceName} contains a cyclic reference graph.`,
          "type3-charproc-reference-cycle",
          { charProcName: sourceName, objectNumber: value.objectNumber }
        );
      }
      const refs = new Set(stack.refs);
      refs.add(refIdentity);
      const resolved = await this.document.resolveObject(value, signal);
      return await this.loadCharProcValue(
        font,
        resolved,
        sourceName,
        { ...stack, refs },
        signal,
        sourceRef ?? value
      );
    }
    if (!isPdfStream(value)) {
      throw type3Error(
        `Visible Type3 CharProc /${sourceName} is not a stream.`,
        "type3-charproc-not-stream",
        { charProcName: sourceName }
      );
    }
    const sourceIdentity = sourceRef
      ? `ref:${pdfRefKey(sourceRef)}`
      : this.objectIdentity(value);
    const identity = `${sourceIdentity}|resources:${font.resourceIdentity}`;
    const cached = this.recordCache.get(identity);
    if (cached) return await cached;
    const pending = this.decodeAndAppendCharProc(
      value,
      sourceRef,
      sourceName,
      font,
      identity,
      signal
    ).catch((error) => {
      this.recordCache.delete(identity);
      throw error;
    });
    this.recordCache.set(identity, pending);
    return await pending;
  }

  private async decodeAndAppendCharProc(
    stream: PdfStream,
    sourceRef: PdfRef | null,
    sourceName: string,
    font: PreparedType3Font,
    identity: string,
    signal?: AbortSignal
  ): Promise<NativePdfType3CharProcRecord> {
    if (stream.bytes.byteLength > MAX_UINT32) {
      throw new PdfError(
        "resource-limit",
        `Encoded Type3 CharProc /${sourceName} exceeds the Uint32 sidecar range.`,
        {
          details: {
            feature: "type3",
            reason: "type3-charproc-encoded-bytes",
            charProcName: sourceName,
            byteLength: stream.bytes.byteLength
          }
        }
      );
    }
    const decodedBytes = await this.document.decodeStream(stream, signal);
    throwIfAborted(signal);
    if (decodedBytes.byteLength > this.maxDecodedCharProcBytes) {
      throw new PdfError(
        "resource-limit",
        `Decoded Type3 CharProc /${sourceName} exceeds ${this.maxDecodedCharProcBytes} bytes.`,
        {
          details: {
            feature: "type3",
            reason: "type3-charproc-decoded-bytes",
            charProcName: sourceName,
            byteLength: decodedBytes.byteLength,
            limit: this.maxDecodedCharProcBytes
          }
        }
      );
    }
    if (this.cachedDecodedBytes + decodedBytes.byteLength > this.maxCachedDecodedCharProcBytes) {
      throw new PdfError(
        "resource-limit",
        "Decoded Type3 CharProc cache exceeds its configured byte limit.",
        {
          details: {
            feature: "type3",
            reason: "type3-charproc-cache-bytes",
            byteLength: this.cachedDecodedBytes + decodedBytes.byteLength,
            limit: this.maxCachedDecodedCharProcBytes
          }
        }
      );
    }
    if (this.records.length >= this.maxCharProcs) {
      throw new PdfError(
        "resource-limit",
        `Decoded Type3 CharProc count exceeds ${this.maxCharProcs}.`,
        {
          details: {
            feature: "type3",
            reason: "type3-charproc-count",
            limit: this.maxCharProcs
          }
        }
      );
    }
    const metrics = parseLeadingType3Metrics(decodedBytes, sourceName);
    const index = this.records.length;
    const record: NativePdfType3CharProcRecord = Object.freeze({
      index,
      id: identity,
      ref: sourceRef,
      dictionary: stream.dictionary,
      resources: font.resources,
      resourceOrigin: font.resourceOrigin,
      encodedContentBytes: stream.bytes.byteLength,
      decodedBytes,
      metrics
    });
    this.records.push(record);
    this.cachedDecodedBytes += decodedBytes.byteLength;
    return record;
  }

  private async resolveResources(
    dictionary: PdfDictionary,
    inherited: PdfDictionary | undefined,
    signal?: AbortSignal
  ): Promise<EffectiveResources> {
    if (dictionary.has("Resources")) {
      const raw = dictionary.get("Resources");
      if (raw === undefined || raw === null) {
        throw invalidType3("A Type3 font has a null /Resources entry.", "type3-resources-null");
      }
      const local = await this.document.resolveDictionary(raw, signal);
      return {
        dictionary: local,
        origin: "local",
        identity: isPdfRef(raw) ? `ref:${pdfRefKey(raw)}` : this.objectIdentity(local)
      };
    }
    if (inherited) {
      if (!isPdfDictionary(inherited)) {
        throw new TypeError("inheritedResources must be a resolved PDF dictionary.");
      }
      return {
        dictionary: inherited,
        origin: inherited === EMPTY_RESOURCES ? "empty" : "inherited",
        identity: this.objectIdentity(inherited)
      };
    }
    return { dictionary: EMPTY_RESOURCES, origin: "empty", identity: "empty" };
  }

  private objectIdentity(value: object): string {
    let id = this.objectIds.get(value);
    if (id === undefined) {
      id = this.nextObjectId++;
      this.objectIds.set(value, id);
    }
    return `object:${id}`;
  }
}

class PreparedType3Font implements NativePdfPreparedType3Font {
  readonly id: string;
  readonly dictionary: PdfDictionary;
  readonly fontMatrix: NativePdfType3Matrix;
  readonly fontBBox: NativePdfType3Rectangle;
  readonly firstChar: number;
  readonly lastChar: number;
  readonly widths: readonly number[];
  readonly charProcNames: readonly string[];
  readonly encodingUnicode: readonly (string | null)[];
  readonly toUnicode: readonly (string | null)[];
  readonly charProcs: PdfDictionary;
  readonly resources: PdfDictionary;
  readonly resourceOrigin: NativePdfType3ResourceOrigin;
  readonly resourceIdentity: string;

  private readonly registry: NativePdfType3Registry;
  private readonly namedCache = new Map<string, Promise<NativePdfType3CharProcRecord>>();

  constructor(
    registry: NativePdfType3Registry,
    identity: string,
    dictionary: PdfDictionary,
    resources: EffectiveResources,
    data: ParsedType3FontData
  ) {
    this.registry = registry;
    this.id = identity;
    this.dictionary = dictionary;
    this.fontMatrix = data.fontMatrix;
    this.fontBBox = data.fontBBox;
    this.firstChar = data.firstChar;
    this.lastChar = data.lastChar;
    this.widths = data.widths;
    this.charProcNames = data.charProcNames;
    this.encodingUnicode = data.encodingUnicode;
    this.toUnicode = data.toUnicode;
    this.charProcs = data.charProcs;
    this.resources = resources.dictionary;
    this.resourceOrigin = resources.origin;
    this.resourceIdentity = resources.identity;
  }

  charProcNameForCode(code: number): string {
    assertCharacterCode(code);
    return this.charProcNames[code];
  }

  widthForCode(code: number): number | null {
    assertCharacterCode(code);
    return code >= this.firstChar && code <= this.lastChar
      ? this.widths[code - this.firstChar]
      : null;
  }

  async resolveCharProc(
    name: string,
    signal?: AbortSignal
  ): Promise<NativePdfType3CharProcRecord> {
    return await this.registry.resolveFontCharProc(this, name, signal);
  }

  async resolveGlyph(
    code: number,
    signal?: AbortSignal
  ): Promise<NativePdfType3GlyphInvocation> {
    return await this.registry.resolveFontGlyph(this, code, signal);
  }

  async resolveCharProcInternal(
    rawName: string,
    stack: CharProcResolutionStack,
    signal?: AbortSignal
  ): Promise<NativePdfType3CharProcRecord> {
    throwIfAborted(signal);
    const name = normalizeCharProcName(rawName);
    if (stack.aliases.has(name)) {
      throw type3Error(
        `Type3 CharProc alias /${name} participates in a cycle.`,
        "type3-charproc-alias-cycle",
        { charProcName: name }
      );
    }
    const cached = this.namedCache.get(name);
    if (cached) return await cached;
    const value = this.charProcs.get(name);
    if (value === undefined || value === null) {
      throw type3Error(
        `Visible Type3 glyph references missing CharProc /${name}.`,
        "type3-charproc-missing",
        { charProcName: name }
      );
    }
    const aliases = new Set(stack.aliases);
    aliases.add(name);
    const pending = this.registry.loadCharProcValue(
      this,
      value,
      name,
      { ...stack, aliases },
      signal
    ).catch((error) => {
      this.namedCache.delete(name);
      throw error;
    });
    this.namedCache.set(name, pending);
    return await pending;
  }
}

/** Convenience for a single prepared font; callers compiling a page should share a registry. */
export async function prepareNativePdfType3Font(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  options: NativePdfType3PrepareOptions & NativePdfType3Options = {}
): Promise<NativePdfPreparedType3Font> {
  const registry = new NativePdfType3Registry(document, options);
  return await registry.prepareFont(dictionary, options);
}

async function validateFontMarker(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  signal?: AbortSignal
): Promise<void> {
  if (dictionary.has("Type")) {
    const type = await document.resolveValue(dictionary.get("Type"), signal);
    if (!isPdfName(type, "Font")) {
      throw invalidType3("A Type3 font /Type entry is not /Font.", "type3-font-marker");
    }
  }
  const subtype = await document.resolveValue(dictionary.get("Subtype"), signal);
  if (!isPdfName(subtype, "Type3")) {
    throw invalidType3("A Type3 font /Subtype entry is not /Type3.", "type3-font-subtype");
  }
}

async function parseType3FontData(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  maxCharProcs: number,
  signal?: AbortSignal
): Promise<ParsedType3FontData> {
  const fontMatrix = asMatrix(await requiredNumberArray(
    document,
    dictionary.get("FontMatrix"),
    6,
    "/FontMatrix",
    signal
  ));
  const determinant = fontMatrix[0] * fontMatrix[3] - fontMatrix[1] * fontMatrix[2];
  if (!Number.isFinite(determinant) || determinant === 0) {
    throw invalidType3("A Type3 font /FontMatrix must be nonsingular.", "type3-font-matrix-singular");
  }
  const fontBBox = asRectangle(await requiredNumberArray(
    document,
    dictionary.get("FontBBox"),
    4,
    "/FontBBox",
    signal
  ));
  if (fontBBox[0] > fontBBox[2] || fontBBox[1] > fontBBox[3]) {
    throw invalidType3("A Type3 font /FontBBox is reversed.", "type3-font-bbox-reversed");
  }
  const firstChar = await requiredInteger(document, dictionary.get("FirstChar"), "/FirstChar", signal);
  const lastChar = await requiredInteger(document, dictionary.get("LastChar"), "/LastChar", signal);
  if (firstChar < 0 || firstChar > 255 || lastChar < firstChar || lastChar > 255) {
    throw invalidType3(
      "A Type3 font /FirstChar and /LastChar range is invalid.",
      "type3-character-range"
    );
  }
  const widths = Object.freeze(await requiredNumberArray(
    document,
    dictionary.get("Widths"),
    lastChar - firstChar + 1,
    "/Widths",
    signal
  ));
  const rawCharProcs = dictionary.get("CharProcs");
  if (rawCharProcs === undefined || rawCharProcs === null) {
    throw invalidType3("A Type3 font is missing /CharProcs.", "type3-charprocs-missing");
  }
  const charProcs = await document.resolveDictionary(rawCharProcs, signal);
  if (charProcs.size > maxCharProcs) {
    throw new PdfError(
      "resource-limit",
      `Type3 /CharProcs contains more than ${maxCharProcs} entries.`,
      {
        details: {
          feature: "type3",
          reason: "type3-charproc-dictionary-count",
          count: charProcs.size,
          limit: maxCharProcs
        }
      }
    );
  }
  const encodingValue = dictionary.get("Encoding");
  if (encodingValue === undefined || encodingValue === null) {
    throw invalidType3("A Type3 font is missing /Encoding.", "type3-encoding-missing");
  }
  await validateEncoding(document, encodingValue, signal);

  // Reuse the owned simple-font encoding implementation without allowing
  // ToUnicode to contaminate glyph/CharProc selection.
  const encodingDictionary: PdfDictionary = new Map([
    ["Type", { kind: "name", value: "Font" }],
    ["Subtype", { kind: "name", value: "Type3" }],
    ["Encoding", encodingValue],
    ["FirstChar", firstChar],
    ["Widths", [...widths]],
    ["FontMatrix", [...fontMatrix]]
  ]);
  if (dictionary.has("BaseFont")) {
    encodingDictionary.set("BaseFont", dictionary.get("BaseFont") ?? null);
  }
  let encodingFont;
  try {
    encodingFont = await parseNativePdfFont(encodingDictionary, document, { signal });
  } catch (cause) {
    if (cause instanceof PdfError && (cause.code === "aborted" || cause.code === "resource-limit")) {
      throw cause;
    }
    throw type3Error("A Type3 font has a malformed or unsupported /Encoding.", "type3-encoding", {}, cause);
  }
  const charProcNames: string[] = [];
  const encodingUnicode: (string | null)[] = [];
  for (let code = 0; code < 256; code += 1) {
    TYPE3_BYTES[0] = code;
    const mapped = encodingFont.decode(TYPE3_BYTES);
    charProcNames.push(mapped.glyphName ?? ".notdef");
    encodingUnicode.push(mapped.glyphName === null ? null : mapped.unicode);
  }
  const toUnicode = await readType3ToUnicode(document, dictionary.get("ToUnicode"), signal);
  return {
    fontMatrix,
    fontBBox,
    firstChar,
    lastChar,
    widths,
    charProcNames: Object.freeze(charProcNames),
    encodingUnicode: Object.freeze(encodingUnicode),
    toUnicode,
    charProcs
  };
}

async function validateEncoding(
  document: NativePdfDocument,
  value: PdfValue,
  signal?: AbortSignal
): Promise<void> {
  const resolved = await document.resolveValue(value, signal);
  if (isPdfName(resolved)) return;
  if (!isPdfDictionary(resolved)) {
    throw invalidType3("A Type3 font /Encoding is not a name or dictionary.", "type3-encoding-type");
  }
  if (resolved.has("Type")) {
    const marker = await document.resolveValue(resolved.get("Type"), signal);
    if (!isPdfName(marker, "Encoding")) {
      throw invalidType3("A Type3 encoding /Type entry is not /Encoding.", "type3-encoding-marker");
    }
  }
  if (resolved.has("BaseEncoding")) {
    const base = await document.resolveValue(resolved.get("BaseEncoding"), signal);
    if (!isPdfName(base)) {
      throw invalidType3("A Type3 /BaseEncoding entry is not a name.", "type3-base-encoding");
    }
  }
  if (resolved.has("Differences")) {
    const differences = await document.resolveValue(resolved.get("Differences"), signal);
    if (!Array.isArray(differences)) {
      throw invalidType3("A Type3 /Differences entry is not an array.", "type3-encoding-differences");
    }
    let code = -1;
    for (const rawItem of differences) {
      const item = await document.resolveValue(rawItem, signal);
      if (typeof item === "number" && Number.isSafeInteger(item)) {
        code = item;
      } else if (isPdfName(item)) {
        if (code < 0 || code > 255) {
          throw invalidType3(
            "A Type3 /Differences glyph name has no valid character code.",
            "type3-encoding-differences-code"
          );
        }
        code += 1;
      } else {
        throw invalidType3(
          "A Type3 /Differences array contains an invalid entry.",
          "type3-encoding-differences-entry"
        );
      }
    }
  }
}

async function readType3ToUnicode(
  document: NativePdfDocument,
  value: PdfValue | undefined,
  signal?: AbortSignal
): Promise<readonly (string | null)[]> {
  const mappings = new Array<string | null>(256).fill(null);
  if (value === undefined || value === null) return Object.freeze(mappings);
  try {
    const resolved = await document.resolveValue(value, signal);
    if (!isPdfStream(resolved)) {
      throw type3Error("A Type3 /ToUnicode entry is not a stream.", "type3-tounicode-stream");
    }
    const cmap = parseToUnicodeCMap(await document.decodeStream(resolved, signal));
    for (let code = 0; code < 256; code += 1) {
      mappings[code] = cmap.mappings.get(`1:${code}`) ?? null;
    }
    return Object.freeze(mappings);
  } catch (cause) {
    if (cause instanceof PdfError && (
      cause.code === "aborted" || cause.code === "resource-limit" ||
      cause.details?.reason === "type3-tounicode-stream"
    )) {
      throw cause;
    }
    throw type3Error("A Type3 /ToUnicode CMap is malformed.", "type3-tounicode", {}, cause);
  }
}

/** Parse only the required leading d0/d1 operator; never scan or repair content. */
export function parseLeadingType3Metrics(
  bytes: Uint8Array,
  charProcName = "(unnamed)"
): NativePdfType3Metrics {
  let offset = skipType3WhitespaceAndComments(bytes, 0);
  const numbers: number[] = [];
  let operator = "";
  let operatorEnd = offset;
  while (offset < bytes.length) {
    const token = readType3Token(bytes, offset);
    offset = token.end;
    if (isPdfNumberToken(token.value)) {
      const number = Number(token.value);
      if (!Number.isFinite(number)) {
        throw malformedMetrics(charProcName, "type3-charproc-metric-number");
      }
      assertFloat32(number, `Type3 CharProc /${charProcName} metric`);
      numbers.push(number);
      if (numbers.length > 6) {
        throw malformedMetrics(charProcName, "type3-charproc-metric-operands");
      }
      offset = skipType3WhitespaceAndComments(bytes, offset);
      continue;
    }
    operator = token.value;
    operatorEnd = token.end;
    break;
  }
  if (operator === "d0" && numbers.length === 2) {
    if (numbers[1] !== 0) {
      throw type3Error(
        `Type3 CharProc /${charProcName} d0 vertical width must be zero.`,
        "type3-charproc-vertical-width",
        { charProcName }
      );
    }
    return Object.freeze({
      operator: "d0",
      colored: true,
      widthX: numbers[0],
      widthY: 0,
      boundingBox: null,
      contentOffset: operatorEnd
    });
  }
  if (operator === "d1" && numbers.length === 6) {
    if (numbers[1] !== 0) {
      throw type3Error(
        `Type3 CharProc /${charProcName} d1 vertical width must be zero.`,
        "type3-charproc-vertical-width",
        { charProcName }
      );
    }
    const boundingBox = asRectangle(numbers.slice(2));
    if (boundingBox[0] > boundingBox[2] || boundingBox[1] > boundingBox[3]) {
      throw type3Error(
        `Type3 CharProc /${charProcName} d1 bounding box is reversed.`,
        "type3-charproc-bbox-reversed",
        { charProcName }
      );
    }
    return Object.freeze({
      operator: "d1",
      colored: false,
      widthX: numbers[0],
      widthY: 0,
      boundingBox,
      contentOffset: operatorEnd
    });
  }
  throw malformedMetrics(charProcName, "type3-charproc-leading-metrics");
}

function skipType3WhitespaceAndComments(bytes: Uint8Array, start: number): number {
  let offset = start;
  while (offset < bytes.length) {
    const byte = bytes[offset];
    if (isPdfWhitespace(byte)) {
      offset += 1;
      continue;
    }
    if (byte !== 0x25) return offset;
    offset += 1;
    while (offset < bytes.length && bytes[offset] !== 0x0a && bytes[offset] !== 0x0d) {
      offset += 1;
    }
  }
  return offset;
}

function readType3Token(bytes: Uint8Array, start: number): { readonly value: string; readonly end: number } {
  if (isPdfDelimiter(bytes[start])) {
    return { value: String.fromCharCode(bytes[start]), end: start + 1 };
  }
  let end = start;
  while (end < bytes.length && !isPdfWhitespace(bytes[end]) && !isPdfDelimiter(bytes[end])) {
    end += 1;
  }
  if (end === start) return { value: "", end: start + 1 };
  let value = "";
  for (let offset = start; offset < end; offset += 1) value += String.fromCharCode(bytes[offset]);
  return { value, end };
}

function isPdfNumberToken(value: string): boolean {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value);
}

function isPdfWhitespace(byte: number): boolean {
  return byte === 0x00 || byte === 0x09 || byte === 0x0a ||
    byte === 0x0c || byte === 0x0d || byte === 0x20;
}

function isPdfDelimiter(byte: number): boolean {
  return byte === 0x28 || byte === 0x29 || byte === 0x3c || byte === 0x3e ||
    byte === 0x5b || byte === 0x5d || byte === 0x7b || byte === 0x7d ||
    byte === 0x2f || byte === 0x25;
}

async function requiredInteger(
  document: NativePdfDocument,
  value: PdfValue | undefined,
  label: string,
  signal?: AbortSignal
): Promise<number> {
  const resolved = await document.resolveValue(value, signal);
  if (typeof resolved !== "number" || !Number.isSafeInteger(resolved)) {
    throw invalidType3(`A Type3 font ${label} entry is not an integer.`, "type3-font-integer", { label });
  }
  return resolved;
}

async function requiredNumberArray(
  document: NativePdfDocument,
  value: PdfValue | undefined,
  length: number,
  label: string,
  signal?: AbortSignal
): Promise<number[]> {
  const resolved = await document.resolveValue(value, signal);
  if (!Array.isArray(resolved) || resolved.length !== length) {
    throw invalidType3(
      `A Type3 font ${label} entry is not a ${length}-number array.`,
      "type3-font-number-array",
      { label, length }
    );
  }
  const result: number[] = [];
  for (const rawItem of resolved) {
    const item = await document.resolveValue(rawItem, signal);
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw invalidType3(
        `A Type3 font ${label} entry contains a non-finite number.`,
        "type3-font-number-array-value",
        { label }
      );
    }
    assertFloat32(item, `Type3 font ${label}`);
    result.push(item);
  }
  return result;
}

function asMatrix(values: readonly number[]): NativePdfType3Matrix {
  return Object.freeze([values[0], values[1], values[2], values[3], values[4], values[5]]);
}

function asRectangle(values: readonly number[]): NativePdfType3Rectangle {
  return Object.freeze([values[0], values[1], values[2], values[3]]);
}

function assertFloat32(value: number, label: string): void {
  if (!Number.isFinite(Math.fround(value))) {
    throw new PdfError("resource-limit", `${label} is outside the Float32 range.`, {
      details: { feature: "type3", reason: "type3-float-range" }
    });
  }
}

function assertCharacterCode(code: number): void {
  if (!Number.isSafeInteger(code) || code < 0 || code > 255) {
    throw new RangeError("A Type3 character code must be an integer from 0 through 255.");
  }
}

function normalizeCharProcName(value: string): string {
  const name = value.startsWith("/") ? value.slice(1) : value;
  if (name.length === 0) throw new TypeError("A Type3 CharProc name cannot be empty.");
  return name;
}

function emptyResolutionStack(): CharProcResolutionStack {
  return { aliases: new Set(), refs: new Set() };
}

function boundedOption(value: number | undefined, ceiling: number, label: string): number {
  const configured = value ?? ceiling;
  if (!Number.isSafeInteger(configured) || configured <= 0) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
  if (configured > ceiling) {
    throw new RangeError(`${label} may lower, but cannot raise, the document ceiling of ${ceiling}.`);
  }
  return configured;
}

function malformedMetrics(charProcName: string, reason: string): PdfError {
  return type3Error(
    `Type3 CharProc /${charProcName} does not begin with a valid d0 or d1 metrics operator.`,
    reason,
    { charProcName }
  );
}

function invalidType3(
  message: string,
  reason: string,
  details: Readonly<Record<string, string | number | boolean | null>> = {}
): PdfError {
  return new PdfError("invalid-object", message, {
    details: { feature: "type3", reason, ...details }
  });
}

function type3Error(
  message: string,
  reason: string,
  details: Readonly<Record<string, string | number | boolean | null>> = {},
  cause?: unknown
): PdfError {
  return new PdfError("unsupported-font", message, {
    cause,
    details: { feature: "type3", reason, ...details }
  });
}
