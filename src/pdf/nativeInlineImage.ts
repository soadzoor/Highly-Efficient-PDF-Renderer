import {
  PdfCosParser,
  PdfNeedMoreDataError,
  isPdfDictionary,
  isPdfName,
  isPdfRef,
  isPdfStream,
  type PdfDictionary,
  type PdfStream,
  type PdfValue
} from "./nativeCos";
import { readDecodeParameters, readFilterNames } from "./nativeFilters";
import { PdfError, throwIfAborted } from "./nativeTypes";

export interface NativeInlineImageLimits {
  readonly maxImages: number;
  readonly maxDictionaryEntries: number;
  readonly maxDictionaryBytes: number;
  readonly maxPayloadBytes: number;
  /** Cumulative bytes inspected, including boundary-continuation probes. */
  readonly maxScanBytes: number;
  readonly maxNestingDepth: number;
}

export const DEFAULT_NATIVE_INLINE_IMAGE_LIMITS: Readonly<NativeInlineImageLimits> = Object.freeze({
  maxImages: 65_536,
  maxDictionaryEntries: 256,
  maxDictionaryBytes: 64 * 1024,
  maxPayloadBytes: 512 * 1024 * 1024,
  maxScanBytes: 512 * 1024 * 1024,
  maxNestingDepth: 64
});

export interface NativeInlineImageOptions {
  readonly limits?: Partial<NativeInlineImageLimits>;
  readonly signal?: AbortSignal;
  /** Absolute offset represented by `content[0]`. @default 0 */
  readonly sourceOffset?: number;
}

export interface NativeInlineImageRecord {
  readonly kind: "image";
  readonly imageIndex: number;
  readonly stream: PdfStream;
  readonly filterNames: readonly string[];
  readonly decodeParameters: readonly (PdfDictionary | null)[];
  /** Absolute span from the `B` in BI through the `I` in EI. */
  readonly sourceOffset: number;
  readonly sourceLength: number;
  /** Absolute raw dictionary syntax span between BI and ID. */
  readonly dictionaryOffset: number;
  readonly dictionaryLength: number;
  /** Absolute encoded image-data span, excluding EI delimiter whitespace. */
  readonly dataOffset: number;
  readonly dataLength: number;
  readonly idOffset: number;
  readonly eiOffset: number;
}

export interface NativeInlineContentSpan {
  readonly kind: "content";
  readonly sourceOffset: number;
  readonly sourceLength: number;
  /** Zero-copy view over the caller's content bytes. */
  readonly bytes: Uint8Array;
}

export type NativeInlineContentSegment = NativeInlineContentSpan | NativeInlineImageRecord;

export interface NativeInlineImageResult {
  readonly sourceOffset: number;
  readonly sourceLength: number;
  readonly images: readonly NativeInlineImageRecord[];
  readonly contentSpans: readonly NativeInlineContentSpan[];
  readonly segments: readonly NativeInlineContentSegment[];
}

interface ContentItem {
  readonly kind: "value" | "word";
  readonly start: number;
  readonly end: number;
  readonly word?: string;
}

interface InlineBoundary {
  readonly dataEnd: number;
  readonly eiStart: number;
  readonly eiEnd: number;
}

interface ParsedInline {
  readonly record: NativeInlineImageRecord;
  readonly end: number;
}

const INLINE_KEY_NAMES: Readonly<Record<string, string>> = Object.freeze({
  BPC: "BitsPerComponent",
  CS: "ColorSpace",
  D: "Decode",
  DP: "DecodeParms",
  F: "Filter",
  H: "Height",
  IM: "ImageMask",
  I: "Interpolate",
  W: "Width"
});

const INLINE_ALLOWED_KEYS = new Set([
  "BitsPerComponent",
  "ColorSpace",
  "Decode",
  "DecodeParms",
  "Filter",
  "Height",
  "ImageMask",
  "Intent",
  "Interpolate",
  "Width"
]);

const INLINE_FILTER_NAMES: Readonly<Record<string, string>> = Object.freeze({
  AHx: "ASCIIHexDecode",
  A85: "ASCII85Decode",
  CCF: "CCITTFaxDecode",
  DCT: "DCTDecode",
  Fl: "FlateDecode",
  LZW: "LZWDecode",
  RL: "RunLengthDecode"
});

const INLINE_ALLOWED_FILTERS = new Set([
  "ASCIIHexDecode",
  "ASCII85Decode",
  "CCITTFaxDecode",
  "DCTDecode",
  "FlateDecode",
  "LZWDecode",
  "RunLengthDecode"
]);

const INLINE_COLOR_NAMES: Readonly<Record<string, string>> = Object.freeze({
  G: "DeviceGray",
  RGB: "DeviceRGB",
  CMYK: "DeviceCMYK",
  I: "Indexed"
});

const PDF_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

/**
 * Finds and prepares every inline image in one decoded PDF content byte stream.
 * It does not repair malformed syntax and never resolves references or fetches
 * resources. Non-image spans retain source order for later compiler interleave.
 */
export function prepareNativeInlineImages(
  content: Uint8Array,
  options: NativeInlineImageOptions = {}
): NativeInlineImageResult {
  if (!(content instanceof Uint8Array)) throw new TypeError("Inline-image content must be Uint8Array.");
  const limits = mergeInlineLimits(options.limits);
  const sourceOffset = options.sourceOffset ?? 0;
  if (
    !Number.isSafeInteger(sourceOffset) ||
    sourceOffset < 0 ||
    !Number.isSafeInteger(sourceOffset + content.length)
  ) {
    throw new RangeError("Inline-image sourceOffset is outside safe integer range.");
  }
  throwIfAborted(options.signal);
  // Most page-content streams contain no inline images. Prove that cheaply
  // before invoking the structural parser, which otherwise tokenizes every
  // path coordinate a second time. The probe may deliberately report false
  // positives for BI-shaped bytes inside strings, names, or comments; those
  // cases still take the exact parser path, so it can never hide an image.
  if (
    content.length <= limits.maxScanBytes &&
    !hasNativeInlineSyntaxCandidate(content, options.signal)
  ) {
    return createContentOnlyResult(content, sourceOffset);
  }
  return new NativeInlineImageParser(content, sourceOffset, limits, options.signal).parse();
}

/** Alias emphasizing the structural parsing phase. */
export const parseNativeInlineImages = prepareNativeInlineImages;

/**
 * Cheap, conservative BI-token probe used ahead of structural parsing.
 *
 * `false` proves there is no delimiter-bounded BI token. `true` only means
 * that exact parsing may be necessary: BI-shaped bytes in comments, strings,
 * hex strings, and names intentionally remain false positives.
 *
 * @internal
 */
export function hasNativeInlineImageCandidate(
  content: Uint8Array,
  signal?: AbortSignal
): boolean {
  if (!(content instanceof Uint8Array)) {
    throw new TypeError("Inline-image content must be Uint8Array.");
  }
  throwIfAborted(signal);
  const lastCandidateStart = content.length - 2;
  for (let offset = 0; offset <= lastCandidateStart; offset += 1) {
    if ((offset & 0xffff) === 0) throwIfAborted(signal);
    if (
      content[offset] === 0x42 &&
      content[offset + 1] === 0x49 &&
      isTokenBoundary(content[offset - 1]) &&
      isTokenBoundary(content[offset + 2])
    ) {
      return true;
    }
  }
  return false;
}

function hasNativeInlineSyntaxCandidate(
  content: Uint8Array,
  signal?: AbortSignal
): boolean {
  throwIfAborted(signal);
  const lastCandidateStart = content.length - 2;
  for (let offset = 0; offset <= lastCandidateStart; offset += 1) {
    if ((offset & 0xffff) === 0) throwIfAborted(signal);
    const first = content[offset];
    const second = content[offset + 1];
    if (
      ((first === 0x42 && second === 0x49) ||
        (first === 0x49 && second === 0x44) ||
        (first === 0x45 && second === 0x49)) &&
      isTokenBoundary(content[offset - 1]) &&
      isTokenBoundary(content[offset + 2])
    ) {
      return true;
    }
  }
  return false;
}

function createContentOnlyResult(
  content: Uint8Array,
  sourceOffset: number
): NativeInlineImageResult {
  const images: readonly NativeInlineImageRecord[] = Object.freeze([]);
  if (content.length === 0) {
    const empty: readonly NativeInlineContentSpan[] = Object.freeze([]);
    return Object.freeze({
      sourceOffset,
      sourceLength: 0,
      images,
      contentSpans: empty,
      segments: empty
    });
  }
  const span: NativeInlineContentSpan = Object.freeze({
    kind: "content",
    sourceOffset,
    sourceLength: content.length,
    bytes: content
  });
  const contentSpans: readonly NativeInlineContentSpan[] = Object.freeze([span]);
  return Object.freeze({
    sourceOffset,
    sourceLength: content.length,
    images,
    contentSpans,
    segments: contentSpans
  });
}

class NativeInlineImageParser {
  private readonly bytes: Uint8Array;
  private readonly baseOffset: number;
  private readonly limits: Readonly<NativeInlineImageLimits>;
  private readonly budget: ScanBudget;
  private readonly images: NativeInlineImageRecord[] = [];
  private readonly contentSpans: NativeInlineContentSpan[] = [];
  private readonly segments: NativeInlineContentSegment[] = [];

  constructor(
    bytes: Uint8Array,
    baseOffset: number,
    limits: Readonly<NativeInlineImageLimits>,
    signal?: AbortSignal
  ) {
    this.bytes = bytes;
    this.baseOffset = baseOffset;
    this.limits = limits;
    this.budget = new ScanBudget(limits.maxScanBytes, signal);
  }

  parse(): NativeInlineImageResult {
    this.budget.check();
    let offset = 0;
    let contentStart = 0;
    let operandCount = 0;
    while (true) {
      offset = skipWhitespaceAndComments(this.bytes, offset, this.budget);
      if (offset >= this.bytes.length) break;
      const item = readContentItem(
        this.bytes,
        offset,
        this.limits.maxNestingDepth,
        this.budget,
        this.baseOffset,
        "unsupported-content"
      );
      offset = item.end;
      if (item.kind === "value") {
        operandCount += 1;
        continue;
      }
      if (item.word === "BI") {
        if (operandCount !== 0) {
          throw contentError("BI cannot consume pending content operands.", this.absolute(item.start));
        }
        if (this.images.length >= this.limits.maxImages) {
          throw limitError("inline-image-count", "Inline image count exceeds its configured limit.", {
            count: this.images.length + 1,
            limit: this.limits.maxImages
          });
        }
        this.appendContentSpan(contentStart, item.start);
        const parsed = this.parseInline(item.start, item.end);
        this.images.push(parsed.record);
        this.segments.push(parsed.record);
        offset = parsed.end;
        contentStart = offset;
        operandCount = 0;
        continue;
      }
      if (item.word === "ID" || item.word === "EI") {
        throw contentError(`Inline-image operator ${item.word} appears outside BI…EI.`, this.absolute(item.start));
      }
      operandCount = 0;
    }
    this.appendContentSpan(contentStart, this.bytes.length);
    return Object.freeze({
      sourceOffset: this.baseOffset,
      sourceLength: this.bytes.length,
      images: Object.freeze([...this.images]),
      contentSpans: Object.freeze([...this.contentSpans]),
      segments: Object.freeze([...this.segments])
    });
  }

  private parseInline(biStart: number, biEnd: number): ParsedInline {
    const entries: [string, PdfValue][] = [];
    let offset = biEnd;
    let idStart = -1;
    let dataStart = -1;
    const dictionaryHardEnd = Math.min(
      this.bytes.length,
      biEnd + this.limits.maxDictionaryBytes + 1
    );
    while (true) {
      offset = skipWhitespaceAndComments(this.bytes, offset, this.budget);
      this.enforceDictionaryBytes(biEnd, offset);
      if (offset >= this.bytes.length) {
        throw imageError("inline-image-missing-id", "Inline image dictionary has no ID operator.", this.absolute(offset));
      }
      if (matchesKeywordAt(this.bytes, offset, "ID")) {
        idStart = offset;
        this.budget.consume(2);
        offset += 2;
        if (offset >= this.bytes.length || !isPdfWhitespace(this.bytes[offset])) {
          throw imageError(
            "inline-image-id-whitespace",
            "Inline image ID must be followed by whitespace.",
            this.absolute(offset)
          );
        }
        const whitespaceStart = offset;
        offset += this.bytes[offset] === 0x0d && this.bytes[offset + 1] === 0x0a ? 2 : 1;
        this.budget.consume(offset - whitespaceStart);
        dataStart = offset;
        break;
      }
      if (entries.length >= this.limits.maxDictionaryEntries) {
        throw limitError(
          "inline-image-dictionary-entries",
          "Inline image dictionary entry count exceeds its configured limit.",
          { count: entries.length + 1, limit: this.limits.maxDictionaryEntries }
        );
      }
      const key = parseDirectPdfValue(
        this.bytes,
        offset,
        dictionaryHardEnd,
        this.limits.maxNestingDepth,
        this.budget,
        this.baseOffset,
        "unsupported-image"
      );
      if (!isPdfName(key.value)) {
        throw imageError(
          "inline-image-dictionary-key",
          "Inline image dictionary keys must be names.",
          this.absolute(offset)
        );
      }
      offset = skipWhitespaceAndComments(this.bytes, key.end, this.budget);
      this.enforceDictionaryBytes(biEnd, offset);
      if (matchesKeywordAt(this.bytes, offset, "ID")) {
        throw imageError(
          "inline-image-dictionary-value",
          `Inline image dictionary key /${key.value.value} has no value.`,
          this.absolute(offset)
        );
      }
      const parsed = parseDirectPdfValue(
        this.bytes,
        offset,
        dictionaryHardEnd,
        this.limits.maxNestingDepth,
        this.budget,
        this.baseOffset,
        "unsupported-image"
      );
      entries.push([key.value.value, parsed.value]);
      offset = parsed.end;
      this.enforceDictionaryBytes(biEnd, offset);
    }

    const dictionary = normalizeInlineDictionary(entries, this.absolute(biStart));
    const { filterNames, decodeParameters } = readInlineFilterMetadata(dictionary, this.absolute(biStart));
    for (const filter of filterNames) {
      if (filter === "JPXDecode" || filter === "JBIG2Decode") {
        throw imageError(
          "inline-image-forbidden-filter",
          `/${filter} shall not be used with an inline image.`,
          this.absolute(biStart)
        );
      }
      if (!INLINE_ALLOWED_FILTERS.has(filter)) {
        throw imageError(
          "inline-image-unsupported-filter",
          `/${filter} is not a supported inline-image filter.`,
          this.absolute(biStart),
          { filter }
        );
      }
    }
    const boundary = this.findBoundary(dataStart, dictionary, filterNames);
    const dataLength = boundary.dataEnd - dataStart;
    if (dataLength < 0 || dataLength > this.limits.maxPayloadBytes) {
      throw limitError("inline-image-payload", "Inline image payload exceeds its configured limit.", {
        payloadBytes: Math.max(0, dataLength),
        limit: this.limits.maxPayloadBytes
      });
    }
    // NativePdfImageRegistry and the filter pipeline are read-only, so retain a
    // view instead of doubling potentially large encoded image payloads.
    const payload = this.bytes.subarray(dataStart, boundary.dataEnd);
    const stream: PdfStream = Object.freeze({ kind: "stream", dictionary, bytes: payload });
    const record: NativeInlineImageRecord = Object.freeze({
      kind: "image",
      imageIndex: this.images.length,
      stream,
      filterNames: Object.freeze([...filterNames]),
      decodeParameters: Object.freeze([...decodeParameters]),
      sourceOffset: this.absolute(biStart),
      sourceLength: boundary.eiEnd - biStart,
      dictionaryOffset: this.absolute(biEnd),
      dictionaryLength: idStart - biEnd,
      dataOffset: this.absolute(dataStart),
      dataLength,
      idOffset: this.absolute(idStart),
      eiOffset: this.absolute(boundary.eiStart)
    });
    return { record, end: boundary.eiEnd };
  }

  private findBoundary(
    dataStart: number,
    dictionary: PdfDictionary,
    filterNames: readonly string[]
  ): InlineBoundary {
    if (filterNames.length === 0) {
      const exactLength = exactUnfilteredPayloadLength(dictionary);
      if (exactLength !== null) {
        if (exactLength > this.limits.maxPayloadBytes) {
          throw limitError("inline-image-payload", "Inline image payload exceeds its configured limit.", {
            payloadBytes: exactLength,
            limit: this.limits.maxPayloadBytes
          });
        }
        const dataEnd = checkedOffset(dataStart, exactLength, "inline image payload");
        if (dataEnd > this.bytes.length) {
          throw imageError(
            "inline-image-truncated-payload",
            "Inline image payload is shorter than its exact sample layout.",
            this.absolute(dataStart)
          );
        }
        return this.requireEiAfterKnownPayload(dataEnd);
      }
    }
    const firstFilter = filterNames[0];
    if (firstFilter === "ASCIIHexDecode") {
      return this.requireEiAfterKnownPayload(this.findAsciiHexEnd(dataStart));
    }
    if (firstFilter === "ASCII85Decode") {
      return this.requireEiAfterKnownPayload(this.findAscii85End(dataStart));
    }
    if (firstFilter === "DCTDecode") {
      return this.requireEiAfterKnownPayload(this.findJpegEnd(dataStart));
    }
    return this.findGenericBoundary(dataStart);
  }

  private findAsciiHexEnd(dataStart: number): number {
    const limitEnd = Math.min(this.bytes.length, dataStart + this.limits.maxPayloadBytes);
    for (let offset = dataStart; offset < limitEnd; offset += 1) {
      this.budget.consume(1);
      if (this.bytes[offset] === 0x3e) return offset + 1;
    }
    if (limitEnd < this.bytes.length) {
      throw limitError("inline-image-payload", "ASCIIHex inline image exceeds its payload limit.", {
        limit: this.limits.maxPayloadBytes
      });
    }
    throw imageError(
      "inline-image-asciihex-terminator",
      "ASCIIHex inline image has no > terminator.",
      this.absolute(dataStart)
    );
  }

  private findAscii85End(dataStart: number): number {
    const limitEnd = Math.min(this.bytes.length, dataStart + this.limits.maxPayloadBytes);
    for (let offset = dataStart; offset < limitEnd; offset += 1) {
      this.budget.consume(1);
      if (this.bytes[offset] !== 0x7e) continue;
      let cursor = offset + 1;
      while (cursor < limitEnd && isPdfWhitespace(this.bytes[cursor])) {
        this.budget.consume(1);
        cursor += 1;
      }
      if (cursor < limitEnd && this.bytes[cursor] === 0x3e) {
        this.budget.consume(1);
        return cursor + 1;
      }
      throw imageError(
        "inline-image-ascii85-terminator",
        "ASCII85 inline image has a malformed ~> terminator.",
        this.absolute(offset)
      );
    }
    if (limitEnd < this.bytes.length) {
      throw limitError("inline-image-payload", "ASCII85 inline image exceeds its payload limit.", {
        limit: this.limits.maxPayloadBytes
      });
    }
    throw imageError(
      "inline-image-ascii85-terminator",
      "ASCII85 inline image has no ~> terminator.",
      this.absolute(dataStart)
    );
  }

  private findJpegEnd(dataStart: number): number {
    const reader = new InlineJpegReader(
      this.bytes,
      dataStart,
      this.limits.maxPayloadBytes,
      this.budget,
      this.baseOffset
    );
    return reader.findEnd();
  }

  private requireEiAfterKnownPayload(dataEnd: number): InlineBoundary {
    if (dataEnd >= this.bytes.length || !isPdfWhitespace(this.bytes[dataEnd])) {
      throw imageError(
        "inline-image-ei-whitespace",
        "Inline image data must be separated from EI by whitespace.",
        this.absolute(Math.min(dataEnd, this.bytes.length))
      );
    }
    let eiStart = dataEnd;
    while (eiStart < this.bytes.length && isPdfWhitespace(this.bytes[eiStart])) {
      this.budget.consume(1);
      eiStart += 1;
    }
    if (!matchesKeywordAt(this.bytes, eiStart, "EI")) {
      throw imageError(
        "inline-image-missing-ei",
        "Inline image data is not followed by EI.",
        this.absolute(eiStart)
      );
    }
    this.budget.consume(2);
    return { dataEnd, eiStart, eiEnd: eiStart + 2 };
  }

  private findGenericBoundary(dataStart: number): InlineBoundary {
    const maximumE = Math.min(
      this.bytes.length - 1,
      dataStart + this.limits.maxPayloadBytes + 1
    );
    let match: InlineBoundary | null = null;
    for (let eiStart = dataStart + 1; eiStart <= maximumE; eiStart += 1) {
      this.budget.consume(1);
      if (
        this.bytes[eiStart] !== 0x45 ||
        this.bytes[eiStart + 1] !== 0x49 ||
        !isPdfWhitespace(this.bytes[eiStart - 1]) ||
        !isTokenBoundary(this.bytes[eiStart + 2])
      ) continue;
      let dataEnd = eiStart - 1;
      if (this.bytes[dataEnd] === 0x0a && dataEnd > dataStart && this.bytes[dataEnd - 1] === 0x0d) {
        dataEnd -= 1;
      }
      if (dataEnd - dataStart > this.limits.maxPayloadBytes) continue;
      if (!this.isPlausibleContinuation(eiStart + 2)) continue;
      const candidate = { dataEnd, eiStart, eiEnd: eiStart + 2 };
      if (match) {
        throw imageError(
          "inline-image-ambiguous-boundary",
          "Inline image has multiple plausible EI boundaries.",
          this.absolute(match.eiStart),
          { firstEiOffset: this.absolute(match.eiStart), secondEiOffset: this.absolute(eiStart) }
        );
      }
      match = candidate;
    }
    if (match) return match;
    if (maximumE < this.bytes.length - 1) {
      throw limitError("inline-image-payload", "Inline image has no EI within its payload limit.", {
        limit: this.limits.maxPayloadBytes
      });
    }
    throw imageError(
      "inline-image-missing-ei",
      "Inline image has no unambiguous EI boundary.",
      this.absolute(dataStart)
    );
  }

  private isPlausibleContinuation(start: number): boolean {
    try {
      let offset = start;
      let operandCount = 0;
      while (true) {
        offset = skipWhitespaceAndComments(this.bytes, offset, this.budget);
        if (offset >= this.bytes.length) return operandCount === 0;
        const item = readContentItem(
          this.bytes,
          offset,
          this.limits.maxNestingDepth,
          this.budget,
          this.baseOffset,
          "unsupported-content"
        );
        offset = item.end;
        if (item.kind === "value") {
          operandCount += 1;
          continue;
        }
        if (item.word === "BI") return operandCount === 0;
        if (item.word === "ID" || item.word === "EI") return false;
        operandCount = 0;
      }
    } catch (error) {
      if (error instanceof PdfError && error.code === "unsupported-content") return false;
      throw error;
    }
  }

  private appendContentSpan(start: number, end: number): void {
    if (end <= start) return;
    const span: NativeInlineContentSpan = Object.freeze({
      kind: "content",
      sourceOffset: this.absolute(start),
      sourceLength: end - start,
      bytes: this.bytes.subarray(start, end)
    });
    this.contentSpans.push(span);
    this.segments.push(span);
  }

  private enforceDictionaryBytes(start: number, end: number): void {
    if (end - start > this.limits.maxDictionaryBytes) {
      throw limitError(
        "inline-image-dictionary-bytes",
        "Inline image dictionary exceeds its configured byte limit.",
        { dictionaryBytes: end - start, limit: this.limits.maxDictionaryBytes }
      );
    }
  }

  private absolute(offset: number): number {
    return this.baseOffset + offset;
  }
}

class ScanBudget {
  private used = 0;
  private readonly limit: number;
  private readonly signal?: AbortSignal;

  constructor(
    limit: number,
    signal?: AbortSignal
  ) {
    this.limit = limit;
    this.signal = signal;
  }

  get remaining(): number {
    return this.limit - this.used;
  }

  consume(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.limit - this.used) {
      throw limitError("inline-image-scan", "Inline image scanning exceeds its configured byte limit.", {
        scannedBytes: this.used + Math.max(0, count),
        limit: this.limit
      });
    }
    this.used += count;
    this.check();
  }

  check(): void {
    throwIfAborted(this.signal);
  }
}

class InlineJpegReader {
  private readonly bytes: Uint8Array;
  private readonly start: number;
  private readonly maxBytes: number;
  private readonly budget: ScanBudget;
  private readonly baseOffset: number;
  private cursor: number;

  constructor(
    bytes: Uint8Array,
    start: number,
    maxBytes: number,
    budget: ScanBudget,
    baseOffset: number
  ) {
    this.bytes = bytes;
    this.start = start;
    this.maxBytes = maxBytes;
    this.budget = budget;
    this.baseOffset = baseOffset;
    this.cursor = start;
  }

  findEnd(): number {
    if (this.readByte() !== 0xff || this.readByte() !== 0xd8) {
      throw this.invalid("DCT inline image does not start with JPEG SOI.");
    }
    let marker = this.readMarker();
    while (true) {
      if (marker === 0xd9) return this.cursor;
      if (marker === 0xd8 || marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
        throw this.invalid("JPEG marker appears in an invalid structural position.");
      }
      if (marker === 0x01) {
        marker = this.readMarker();
        continue;
      }
      const length = (this.readByte() << 8) | this.readByte();
      if (length < 2) throw this.invalid("JPEG marker segment has an invalid length.");
      this.skip(length - 2);
      if (marker !== 0xda) {
        marker = this.readMarker();
        continue;
      }
      marker = this.readEntropyMarker();
    }
  }

  private readMarker(): number {
    if (this.readByte() !== 0xff) throw this.invalid("JPEG marker prefix is missing.");
    let marker = this.readByte();
    while (marker === 0xff) marker = this.readByte();
    return marker;
  }

  private readEntropyMarker(): number {
    while (true) {
      const byte = this.readByte();
      if (byte !== 0xff) continue;
      let marker = this.readByte();
      while (marker === 0xff) marker = this.readByte();
      if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      return marker;
    }
  }

  private readByte(): number {
    if (this.cursor >= this.bytes.length) throw this.invalid("Truncated JPEG inline image.");
    if (this.cursor - this.start >= this.maxBytes) {
      throw limitError("inline-image-payload", "DCT inline image exceeds its payload limit.", {
        limit: this.maxBytes
      });
    }
    this.budget.consume(1);
    return this.bytes[this.cursor++];
  }

  private skip(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0) throw this.invalid("Invalid JPEG segment length.");
    if (count > this.maxBytes - (this.cursor - this.start)) {
      throw limitError("inline-image-payload", "DCT inline image exceeds its payload limit.", {
        limit: this.maxBytes
      });
    }
    if (count > this.bytes.length - this.cursor) throw this.invalid("Truncated JPEG marker segment.");
    this.budget.consume(count);
    this.cursor += count;
  }

  private invalid(message: string): PdfError {
    return imageError("inline-image-dct-structure", message, this.baseOffset + this.cursor);
  }
}

function readContentItem(
  bytes: Uint8Array,
  offset: number,
  maxDepth: number,
  budget: ScanBudget,
  baseOffset: number,
  errorCode: "unsupported-content" | "unsupported-image"
): ContentItem {
  const start = offset;
  const byte = bytes[offset];
  if (byte === 0x2f || byte === 0x28 || byte === 0x5b || byte === 0x3c) {
    const parsed = parseDirectPdfValue(
      bytes,
      offset,
      bytes.length,
      maxDepth,
      budget,
      baseOffset,
      errorCode
    );
    return { kind: "value", start, end: parsed.end };
  }
  if (isPdfDelimiter(byte)) {
    throw syntaxError(errorCode, "Unexpected PDF content delimiter.", baseOffset + offset);
  }
  let end = offset;
  while (end < bytes.length && !isTokenBoundary(bytes[end])) end += 1;
  if (end === offset) throw syntaxError(errorCode, "Empty PDF content token.", baseOffset + offset);
  budget.consume(end - offset);
  const word = asciiWord(bytes, offset, end, errorCode, baseOffset);
  if (word === "true" || word === "false" || word === "null" || PDF_NUMBER.test(word)) {
    if (PDF_NUMBER.test(word) && !Number.isFinite(Number(word))) {
      throw syntaxError(errorCode, "PDF content number is non-finite.", baseOffset + offset);
    }
    return { kind: "value", start, end };
  }
  return { kind: "word", start, end, word };
}

function parseDirectPdfValue(
  bytes: Uint8Array,
  offset: number,
  hardEnd: number,
  maxDepth: number,
  budget: ScanBudget,
  baseOffset: number,
  errorCode: "unsupported-content" | "unsupported-image"
): { value: PdfValue; end: number } {
  const budgetEnd = Math.min(bytes.length, offset + budget.remaining);
  const end = Math.min(bytes.length, hardEnd, budgetEnd);
  if (end <= offset) budget.consume(1);
  const parser = new PdfCosParser(bytes.subarray(0, end), { position: offset, maxDepth });
  let value: PdfValue;
  try {
    value = parser.parseValue();
  } catch (error) {
    if (error instanceof PdfNeedMoreDataError && end < bytes.length) {
      if (hardEnd <= budgetEnd && end === hardEnd) {
        throw limitError(
          "inline-image-dictionary-bytes",
          "Inline image dictionary exceeds its configured byte limit."
        );
      }
      budget.consume(budget.remaining + 1);
    }
    if (error instanceof PdfError && error.code === "resource-limit") throw error;
    throw syntaxError(errorCode, "Malformed direct PDF value in content.", baseOffset + offset, error);
  }
  const parsedEnd = parser.position;
  if (parsedEnd === end && end < bytes.length && !isTokenBoundary(bytes[end])) {
    if (hardEnd <= budgetEnd && end === hardEnd) {
      throw limitError(
        "inline-image-dictionary-bytes",
        "Inline image dictionary exceeds its configured byte limit."
      );
    }
    budget.consume(budget.remaining + 1);
  }
  budget.consume(parsedEnd - offset);
  rejectIndirectValues(value, errorCode, baseOffset + offset);
  return { value, end: parsedEnd };
}

function rejectIndirectValues(
  value: PdfValue,
  errorCode: "unsupported-content" | "unsupported-image",
  offset: number
): void {
  if (isPdfRef(value) || isPdfStream(value)) {
    throw syntaxError(errorCode, "Content values shall be direct non-stream objects.", offset);
  }
  if (Array.isArray(value)) {
    for (const item of value) rejectIndirectValues(item, errorCode, offset);
    return;
  }
  if (isPdfDictionary(value)) {
    for (const item of value.values()) rejectIndirectValues(item, errorCode, offset);
  }
}

function normalizeInlineDictionary(
  entries: readonly (readonly [string, PdfValue])[],
  offset: number
): PdfDictionary {
  const dictionary: PdfDictionary = new Map();
  for (const [rawKey, rawValue] of entries) {
    const key = INLINE_KEY_NAMES[rawKey] ?? rawKey;
    // ISO 32000 says non-table entries, including Type/Subtype/Length, are
    // ignored for inline images. They are parsed above but never interpreted.
    if (!INLINE_ALLOWED_KEYS.has(key)) continue;
    if (dictionary.has(key)) {
      throw imageError(
        "inline-image-duplicate-key",
        `Inline image dictionary repeats /${key} (possibly through an abbreviation).`,
        offset
      );
    }
    const value = key === "Filter"
      ? normalizeFilterValue(rawValue)
      : key === "ColorSpace"
        ? normalizeColorSpaceValue(rawValue)
        : rawValue;
    dictionary.set(key, value);
  }
  dictionary.set("Type", { kind: "name", value: "XObject" });
  dictionary.set("Subtype", { kind: "name", value: "Image" });
  return dictionary;
}

function normalizeFilterValue(value: PdfValue): PdfValue {
  if (isPdfName(value)) return normalizedName(value, INLINE_FILTER_NAMES);
  if (!Array.isArray(value)) return value;
  return value.map((item) => isPdfName(item) ? normalizedName(item, INLINE_FILTER_NAMES) : item);
}

function normalizeColorSpaceValue(value: PdfValue): PdfValue {
  if (isPdfName(value)) return normalizedName(value, INLINE_COLOR_NAMES);
  if (!Array.isArray(value) || value.length === 0 || !isPdfName(value[0])) return value;
  const output = [...value];
  output[0] = normalizedName(value[0], INLINE_COLOR_NAMES);
  if (!isPdfName(output[0])) return output;
  const family = output[0].value;
  const nestedIndex = family === "Indexed" || family === "Pattern" ? 1
    : family === "Separation" || family === "DeviceN" ? 2
      : -1;
  if (nestedIndex >= 0 && isPdfName(output[nestedIndex])) {
    output[nestedIndex] = normalizedName(output[nestedIndex], INLINE_COLOR_NAMES);
  }
  return output;
}

function normalizedName(value: { readonly kind: "name"; readonly value: string }, names: Readonly<Record<string, string>>) {
  const normalized = names[value.value];
  return normalized ? { kind: "name" as const, value: normalized } : value;
}

function readInlineFilterMetadata(
  dictionary: PdfDictionary,
  offset: number
): {
  filterNames: readonly string[];
  decodeParameters: readonly (PdfDictionary | null)[];
} {
  try {
    const filterNames = readFilterNames(dictionary.get("Filter"));
    const decodeParameters = readDecodeParameters(dictionary.get("DecodeParms"), filterNames.length);
    return { filterNames, decodeParameters };
  } catch (cause) {
    throw imageError(
      "inline-image-filter-dictionary",
      "Inline image Filter/DecodeParms entries are malformed.",
      offset,
      undefined,
      cause
    );
  }
}

function exactUnfilteredPayloadLength(dictionary: PdfDictionary): number | null {
  const width = dictionary.get("Width");
  const height = dictionary.get("Height");
  const imageMask = dictionary.get("ImageMask") ?? false;
  if (
    typeof width !== "number" || !Number.isSafeInteger(width) || width <= 0 ||
    typeof height !== "number" || !Number.isSafeInteger(height) || height <= 0 ||
    typeof imageMask !== "boolean"
  ) return null;
  let componentCount: number | null;
  let bitsPerComponent = dictionary.get("BitsPerComponent");
  if (imageMask) {
    componentCount = 1;
    bitsPerComponent ??= 1;
  } else {
    componentCount = colorComponentCount(dictionary.get("ColorSpace"));
  }
  if (
    componentCount === null ||
    typeof bitsPerComponent !== "number" ||
    !Number.isSafeInteger(bitsPerComponent) ||
    ![1, 2, 4, 8, 16].includes(bitsPerComponent)
  ) return null;
  const samplesPerRow = checkedMultiply(width, componentCount, "inline image samples per row");
  const rowBits = checkedMultiply(samplesPerRow, bitsPerComponent, "inline image row bits");
  const rowBytes = Math.ceil(rowBits / 8);
  return checkedMultiply(rowBytes, height, "inline image payload bytes");
}

function colorComponentCount(value: PdfValue | undefined): number | null {
  if (isPdfName(value)) {
    return value.value === "DeviceGray" ? 1
      : value.value === "DeviceRGB" ? 3
        : value.value === "DeviceCMYK" ? 4
          : null;
  }
  if (!Array.isArray(value) || value.length === 0 || !isPdfName(value[0])) return null;
  switch (value[0].value) {
    case "DeviceGray":
    case "CalGray":
    case "Indexed":
    case "Separation": return 1;
    case "DeviceRGB":
    case "CalRGB":
    case "Lab": return 3;
    case "DeviceCMYK": return 4;
    case "DeviceN": return Array.isArray(value[1]) && value[1].length > 0 ? value[1].length : null;
    default: return null;
  }
}

function skipWhitespaceAndComments(bytes: Uint8Array, initial: number, budget: ScanBudget): number {
  let offset = initial;
  while (offset < bytes.length) {
    if (isPdfWhitespace(bytes[offset])) {
      budget.consume(1);
      offset += 1;
      continue;
    }
    if (bytes[offset] !== 0x25) break;
    budget.consume(1);
    offset += 1;
    while (offset < bytes.length) {
      const byte = bytes[offset++];
      budget.consume(1);
      if (byte === 0x0a || byte === 0x0d) break;
    }
  }
  return offset;
}

function matchesKeywordAt(bytes: Uint8Array, offset: number, keyword: string): boolean {
  if (offset + keyword.length > bytes.length) return false;
  for (let index = 0; index < keyword.length; index += 1) {
    if (bytes[offset + index] !== keyword.charCodeAt(index)) return false;
  }
  return isTokenBoundary(bytes[offset + keyword.length]);
}

function asciiWord(
  bytes: Uint8Array,
  start: number,
  end: number,
  errorCode: "unsupported-content" | "unsupported-image",
  baseOffset: number
): string {
  let output = "";
  for (let offset = start; offset < end; offset += 1) {
    const byte = bytes[offset];
    if (byte < 0x21 || byte > 0x7e) {
      throw syntaxError(errorCode, "A PDF content keyword contains a non-ASCII byte.", baseOffset + offset);
    }
    output += String.fromCharCode(byte);
  }
  return output;
}

function isPdfWhitespace(byte: number | undefined): boolean {
  return byte === 0x00 || byte === 0x09 || byte === 0x0a ||
    byte === 0x0c || byte === 0x0d || byte === 0x20;
}

function isPdfDelimiter(byte: number | undefined): boolean {
  return byte === 0x28 || byte === 0x29 || byte === 0x3c || byte === 0x3e ||
    byte === 0x5b || byte === 0x5d || byte === 0x7b || byte === 0x7d ||
    byte === 0x2f || byte === 0x25;
}

function isTokenBoundary(byte: number | undefined): boolean {
  return byte === undefined || isPdfWhitespace(byte) || isPdfDelimiter(byte);
}

function mergeInlineLimits(
  overrides?: Partial<NativeInlineImageLimits>
): Readonly<NativeInlineImageLimits> {
  const limits = { ...DEFAULT_NATIVE_INLINE_IMAGE_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`Inline-image limit ${name} must be a positive safe integer.`);
    }
  }
  return Object.freeze(limits);
}

function checkedMultiply(left: number, right: number, label: string): number {
  const result = left * right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw limitError("inline-image-arithmetic", `${label} exceeds safe integer arithmetic.`, {
      left,
      right
    });
  }
  return result;
}

function checkedOffset(offset: number, length: number, label: string): number {
  const result = offset + length;
  if (!Number.isSafeInteger(result) || result < offset) {
    throw limitError("inline-image-arithmetic", `${label} exceeds safe offset arithmetic.`, {
      offset,
      length
    });
  }
  return result;
}

function syntaxError(
  code: "unsupported-content" | "unsupported-image",
  message: string,
  offset: number,
  cause?: unknown
): PdfError {
  return new PdfError(code, message, { offset, cause });
}

function contentError(message: string, offset: number): PdfError {
  return new PdfError("unsupported-content", message, { offset });
}

function imageError(
  reason: string,
  message: string,
  offset: number,
  details?: Readonly<Record<string, string | number | boolean | null>>,
  cause?: unknown
): PdfError {
  return new PdfError("unsupported-image", message, {
    offset,
    cause,
    details: { reason, ...details }
  });
}

function limitError(
  reason: string,
  message: string,
  details: Readonly<Record<string, string | number | boolean | null>> = {}
): PdfError {
  return new PdfError("resource-limit", message, { details: { reason, ...details } });
}
