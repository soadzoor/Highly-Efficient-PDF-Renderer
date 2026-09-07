import { PdfError } from "./nativeTypes";

export interface PdfName {
  readonly kind: "name";
  readonly value: string;
}

export interface PdfString {
  readonly kind: "string";
  readonly bytes: Uint8Array;
  readonly hex: boolean;
}

export interface PdfRef {
  readonly kind: "ref";
  readonly objectNumber: number;
  readonly generation: number;
}

export type PdfDictionary = Map<string, PdfValue>;

export interface PdfStream {
  readonly kind: "stream";
  readonly dictionary: PdfDictionary;
  readonly bytes: Uint8Array;
}

export type PdfValue =
  | null
  | boolean
  | number
  | PdfName
  | PdfString
  | PdfRef
  | PdfValue[]
  | PdfDictionary
  | PdfStream;

export interface PdfIndirectObject {
  readonly ref: PdfRef;
  readonly value: PdfValue;
  readonly startOffset: number;
  /** First source byte of the object's direct COS value. */
  readonly valueStartOffset: number;
  /** First source byte after the object's direct COS value. */
  readonly valueEndOffset: number;
  readonly endOffset: number;
}

export interface PdfIndirectObjectPrefix {
  readonly ref: PdfRef;
  readonly value: PdfValue;
  readonly startOffset: number;
  readonly valueStartOffset: number;
  readonly valueEndOffset: number;
}

export class PdfNeedMoreDataError extends Error {
  constructor() {
    super("More PDF source bytes are required.");
    this.name = "PdfNeedMoreDataError";
  }
}

const WHITE_SPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const DEFAULT_MAX_CONTAINER_ENTRIES = 2_000_000;

interface ParsedNumberToken {
  readonly value: number;
  readonly integer: boolean;
}

export type PdfDuplicateDictionaryKeyPolicy = "reject" | "keep-first" | "keep-last";

export function isPdfName(value: PdfValue | undefined, expected?: string): value is PdfName {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    (value as PdfName).kind === "name" &&
    (expected === undefined || (value as PdfName).value === expected);
}

export function isPdfRef(value: PdfValue | undefined): value is PdfRef {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    (value as PdfRef).kind === "ref";
}

export function isPdfString(value: PdfValue | undefined): value is PdfString {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    (value as PdfString).kind === "string";
}

export function isPdfStream(value: PdfValue | undefined): value is PdfStream {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    (value as PdfStream).kind === "stream";
}

export function isPdfDictionary(value: PdfValue | undefined): value is PdfDictionary {
  return value instanceof Map;
}

export function pdfRefKey(ref: Pick<PdfRef, "objectNumber" | "generation">): string {
  return `${ref.objectNumber}:${ref.generation}`;
}

export class PdfCosParser {
  private readonly bytes: Uint8Array;
  private readonly baseOffset: number;
  private readonly maxDepth: number;
  private readonly maxContainerEntries: number;
  private readonly duplicateDictionaryKeys: PdfDuplicateDictionaryKeyPolicy;
  private readonly onDuplicateDictionaryKey?: (key: string, offset: number) => void;
  private readonly repairMissingStreamEndEol: boolean;
  private readonly onMissingStreamEndEol?: (offset: number) => void;
  private positionValue = 0;

  constructor(
    bytes: Uint8Array,
    options: {
      baseOffset?: number;
      position?: number;
      maxDepth?: number;
      maxContainerEntries?: number;
      duplicateDictionaryKeys?: PdfDuplicateDictionaryKeyPolicy;
      onDuplicateDictionaryKey?: (key: string, offset: number) => void;
      repairMissingStreamEndEol?: boolean;
      onMissingStreamEndEol?: (offset: number) => void;
    } = {}
  ) {
    const baseOffset = options.baseOffset ?? 0;
    const position = options.position ?? 0;
    const maxDepth = options.maxDepth ?? 64;
    const maxContainerEntries = options.maxContainerEntries ?? DEFAULT_MAX_CONTAINER_ENTRIES;
    const duplicateDictionaryKeys = options.duplicateDictionaryKeys ?? "reject";
    if (
      !Number.isSafeInteger(baseOffset) || baseOffset < 0 ||
      baseOffset > Number.MAX_SAFE_INTEGER - bytes.length
    ) {
      throw new RangeError("COS parser base offset is out of range.");
    }
    if (!Number.isSafeInteger(position) || position < 0 || position > bytes.length) {
      throw new RangeError("COS parser position is out of range.");
    }
    if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) {
      throw new RangeError("COS parser maximum depth must be a non-negative safe integer.");
    }
    if (!Number.isSafeInteger(maxContainerEntries) || maxContainerEntries < 0) {
      throw new RangeError("COS parser container-entry limit must be a non-negative safe integer.");
    }
    if (
      duplicateDictionaryKeys !== "reject" &&
      duplicateDictionaryKeys !== "keep-first" &&
      duplicateDictionaryKeys !== "keep-last"
    ) {
      throw new RangeError("COS parser duplicate dictionary key policy is invalid.");
    }
    this.bytes = bytes;
    this.baseOffset = baseOffset;
    this.positionValue = position;
    this.maxDepth = maxDepth;
    this.maxContainerEntries = maxContainerEntries;
    this.duplicateDictionaryKeys = duplicateDictionaryKeys;
    this.onDuplicateDictionaryKey = options.onDuplicateDictionaryKey;
    this.repairMissingStreamEndEol = options.repairMissingStreamEndEol === true;
    this.onMissingStreamEndEol = options.onMissingStreamEndEol;
  }

  get position(): number {
    return this.positionValue;
  }

  set position(value: number) {
    if (!Number.isSafeInteger(value) || value < 0 || value > this.bytes.length) {
      throw new RangeError("COS parser position is out of range.");
    }
    this.positionValue = value;
  }

  get absolutePosition(): number {
    return this.baseOffset + this.positionValue;
  }

  get remaining(): number {
    return this.bytes.length - this.positionValue;
  }

  skipWhitespaceAndComments(): void {
    while (this.positionValue < this.bytes.length) {
      const byte = this.bytes[this.positionValue];
      if (WHITE_SPACE.has(byte)) {
        this.positionValue += 1;
        continue;
      }
      if (byte !== 0x25) {
        return;
      }
      this.positionValue += 1;
      while (this.positionValue < this.bytes.length) {
        const commentByte = this.bytes[this.positionValue++];
        if (commentByte === 0x0a || commentByte === 0x0d) {
          break;
        }
      }
    }
  }

  peekKeyword(keyword: string): boolean {
    this.skipWhitespaceAndComments();
    return this.matchesKeywordAt(this.positionValue, keyword);
  }

  consumeKeyword(keyword: string): void {
    this.skipWhitespaceAndComments();
    if (!this.matchesKeywordAt(this.positionValue, keyword)) {
      const available = this.bytes.length - this.positionValue;
      if (available < keyword.length) {
        let prefixMatches = true;
        for (let index = 0; index < available; index += 1) {
          if (this.bytes[this.positionValue + index] !== keyword.charCodeAt(index)) {
            prefixMatches = false;
            break;
          }
        }
        if (prefixMatches) throw new PdfNeedMoreDataError();
      }
      this.invalid(`Expected ${keyword}.`);
    }
    this.positionValue += keyword.length;
  }

  readInteger(): number {
    const token = this.readNumberToken();
    if (!token.integer || !Number.isSafeInteger(token.value)) {
      this.invalid("Expected an integer.");
    }
    return token.value;
  }

  parseValue(depth = 0): PdfValue {
    if (depth > this.maxDepth) {
      throw new PdfError("resource-limit", "PDF object nesting exceeds the configured limit.", {
        offset: this.absolutePosition
      });
    }
    this.skipWhitespaceAndComments();
    if (this.positionValue >= this.bytes.length) {
      throw new PdfNeedMoreDataError();
    }
    const byte = this.bytes[this.positionValue];
    if (byte === 0x2f) return this.parseName();
    if (byte === 0x28) return this.parseLiteralString();
    if (byte === 0x5b) {
      this.requireContainerDepth(depth);
      return this.parseArray(depth + 1);
    }
    if (byte === 0x3c) {
      if (this.bytes[this.positionValue + 1] === 0x3c) {
        this.requireContainerDepth(depth);
        return this.parseDictionary(depth + 1);
      }
      return this.parseHexString();
    }
    if (byte === 0x74 && this.matchesKeywordAt(this.positionValue, "true")) {
      this.positionValue += 4;
      return true;
    }
    if (byte === 0x66 && this.matchesKeywordAt(this.positionValue, "false")) {
      this.positionValue += 5;
      return false;
    }
    if (byte === 0x6e && this.matchesKeywordAt(this.positionValue, "null")) {
      this.positionValue += 4;
      return null;
    }
    if (
      (byte === 0x74 && this.isPartialKeywordAt(this.positionValue, "true")) ||
      (byte === 0x66 && this.isPartialKeywordAt(this.positionValue, "false")) ||
      (byte === 0x6e && this.isPartialKeywordAt(this.positionValue, "null"))
    ) {
      throw new PdfNeedMoreDataError();
    }
    if (isNumberStart(byte)) {
      const first = this.readNumberToken();
      if (first.integer && Number.isSafeInteger(first.value) && first.value > 0) {
        const afterFirst = this.positionValue;
        try {
          this.skipWhitespaceAndComments();
          if (isNumberStart(this.bytes[this.positionValue])) {
            const second = this.readNumberToken();
            this.skipWhitespaceAndComments();
            if (this.positionValue >= this.bytes.length) throw new PdfNeedMoreDataError();
            if (
              second.integer && Number.isSafeInteger(second.value) &&
              second.value >= 0 && second.value <= 65_535 &&
              this.matchesKeywordAt(this.positionValue, "R")
            ) {
              this.positionValue += 1;
              return {
                kind: "ref",
                objectNumber: first.value,
                generation: second.value
              };
            }
          }
        } catch (error) {
          if (!(error instanceof PdfNeedMoreDataError)) throw error;
        }
        this.positionValue = afterFirst;
      }
      return first.value;
    }
    this.invalid("Unsupported or malformed COS value.");
  }

  parseIndirectObject(options: { resolveLength?: (value: PdfValue) => number | undefined } = {}): PdfIndirectObject {
    const prefix = this.parseIndirectObjectPrefix();
    const { startOffset, valueStartOffset, valueEndOffset } = prefix;
    let { value } = prefix;
    this.skipWhitespaceAndComments();
    if (value instanceof Map && this.isPartialKeywordAt(this.positionValue, "stream")) {
      throw new PdfNeedMoreDataError();
    }
    if (value instanceof Map && this.matchesKeywordAt(this.positionValue, "stream")) {
      this.positionValue += 6;
      if (this.positionValue >= this.bytes.length) throw new PdfNeedMoreDataError();
      if (this.bytes[this.positionValue] === 0x0d) {
        this.positionValue += 1;
        if (this.bytes[this.positionValue] === 0x0a) this.positionValue += 1;
      } else if (this.bytes[this.positionValue] === 0x0a) {
        this.positionValue += 1;
      } else {
        this.invalid("The stream keyword is not followed by an end-of-line marker.");
      }
      const streamStart = this.positionValue;
      const rawLength = value.get("Length");
      const length = typeof rawLength === "number"
        ? rawLength
        : rawLength === undefined ? undefined : options.resolveLength?.(rawLength);
      if (!Number.isSafeInteger(length) || (length as number) < 0) {
        this.invalid("A stream has no valid, resolvable non-negative integer /Length.");
      }
      if ((length as number) > this.bytes.length - streamStart) throw new PdfNeedMoreDataError();
      const streamEnd = streamStart + (length as number);
      this.positionValue = streamEnd;
      if (this.positionValue >= this.bytes.length) throw new PdfNeedMoreDataError();
      const dataEndsWithEol = streamEnd > streamStart &&
        (this.bytes[streamEnd - 1] === 0x0a || this.bytes[streamEnd - 1] === 0x0d);
      let consumedFramingEol = false;
      if (this.bytes[this.positionValue] === 0x0d) {
        consumedFramingEol = true;
        this.positionValue += 1;
        if (this.bytes[this.positionValue] === 0x0a) this.positionValue += 1;
      } else if (this.bytes[this.positionValue] === 0x0a) {
        consumedFramingEol = true;
        this.positionValue += 1;
      }
      if (!dataEndsWithEol && !consumedFramingEol) {
        // Safe repair accepts only an exact `endstream` token at the declared
        // byte boundary. It neither scans nor changes stream payload bytes;
        // strict parsing continues to reject the malformed framing.
        if (
          !this.repairMissingStreamEndEol ||
          !this.matchesKeywordAt(this.positionValue, "endstream")
        ) {
          this.invalid("Stream data is not followed by an end-of-line marker.", {
            reason: "missing-stream-end-eol"
          });
        }
        this.onMissingStreamEndEol?.(this.absolutePosition);
      }
      this.skipWhitespaceAndComments();
      if (!this.matchesKeywordAt(this.positionValue, "endstream")) {
        if (this.isPartialKeywordAt(this.positionValue, "endstream")) {
          throw new PdfNeedMoreDataError();
        }
        this.invalid("Stream Length does not end at endstream.");
      }
      const streamView = this.bytes.subarray(streamStart, streamEnd);
      // Large stream windows are already parser-owned immutable bytes. Keep a
      // view when the payload dominates the window, avoiding a second full
      // payload allocation at peak. Copy small payloads so a tiny cached
      // stream cannot retain an otherwise disposable large object window.
      const streamBytes = streamView.byteLength * 2 >= this.bytes.byteLength
        ? streamView
        : streamView.slice();
      this.positionValue += 9;
      value = { kind: "stream", dictionary: value, bytes: streamBytes };
    }
    this.consumeKeyword("endobj");
    return {
      ref: prefix.ref,
      value,
      startOffset,
      valueStartOffset,
      valueEndOffset,
      endOffset: this.absolutePosition
    };
  }

  /** Parse through an indirect object's first COS value, stopping before stream/endobj. */
  parseIndirectObjectPrefix(): PdfIndirectObjectPrefix {
    this.skipWhitespaceAndComments();
    const startOffset = this.absolutePosition;
    const objectNumber = this.readInteger();
    const generation = this.readInteger();
    if (objectNumber <= 0 || generation < 0 || generation > 65_535) {
      this.invalid("Invalid indirect-object reference.");
    }
    this.consumeKeyword("obj");
    this.skipWhitespaceAndComments();
    const valueStartOffset = this.absolutePosition;
    const value = this.parseValue();
    return {
      ref: { kind: "ref", objectNumber, generation },
      value,
      startOffset,
      valueStartOffset,
      valueEndOffset: this.absolutePosition
    };
  }

  private parseName(): PdfName {
    this.positionValue += 1;
    const output: number[] = [];
    while (this.positionValue < this.bytes.length) {
      const byte = this.bytes[this.positionValue];
      if (WHITE_SPACE.has(byte) || DELIMITERS.has(byte)) break;
      if (byte === 0x23) {
        if (this.positionValue + 2 >= this.bytes.length) throw new PdfNeedMoreDataError();
        const high = hexDigit(this.bytes[this.positionValue + 1]);
        const low = hexDigit(this.bytes[this.positionValue + 2]);
        if (high < 0 || low < 0) this.invalid("Malformed name escape.");
        output.push((high << 4) | low);
        this.positionValue += 3;
      } else {
        output.push(byte);
        this.positionValue += 1;
      }
    }
    return { kind: "name", value: bytesToBinaryString(output) };
  }

  private parseLiteralString(): PdfString {
    this.positionValue += 1;
    const output: number[] = [];
    let nesting = 1;
    while (this.positionValue < this.bytes.length) {
      let byte = this.bytes[this.positionValue++];
      if (byte === 0x28) {
        nesting += 1;
        output.push(byte);
        continue;
      }
      if (byte === 0x29) {
        nesting -= 1;
        if (nesting === 0) return { kind: "string", bytes: Uint8Array.from(output), hex: false };
        output.push(byte);
        continue;
      }
      if (byte === 0x0d) {
        if (this.bytes[this.positionValue] === 0x0a) this.positionValue += 1;
        output.push(0x0a);
        continue;
      }
      if (byte === 0x0a) {
        output.push(0x0a);
        continue;
      }
      if (byte !== 0x5c) {
        output.push(byte);
        continue;
      }
      if (this.positionValue >= this.bytes.length) throw new PdfNeedMoreDataError();
      byte = this.bytes[this.positionValue++];
      const escaped = byte === 0x6e ? 0x0a : byte === 0x72 ? 0x0d : byte === 0x74 ? 0x09
        : byte === 0x62 ? 0x08 : byte === 0x66 ? 0x0c : byte;
      if (byte === 0x0d || byte === 0x0a) {
        if (byte === 0x0d && this.bytes[this.positionValue] === 0x0a) this.positionValue += 1;
      } else if (byte >= 0x30 && byte <= 0x37) {
        let octal = byte - 0x30;
        for (let count = 1; count < 3; count += 1) {
          const next = this.bytes[this.positionValue];
          if (next < 0x30 || next > 0x37) break;
          octal = (octal << 3) | (next - 0x30);
          this.positionValue += 1;
        }
        output.push(octal & 0xff);
      } else {
        output.push(escaped);
      }
    }
    throw new PdfNeedMoreDataError();
  }

  private parseHexString(): PdfString {
    this.positionValue += 1;
    const nibbles: number[] = [];
    while (this.positionValue < this.bytes.length) {
      const byte = this.bytes[this.positionValue++];
      if (byte === 0x3e) {
        if (nibbles.length % 2 !== 0) nibbles.push(0);
        const output = new Uint8Array(nibbles.length / 2);
        for (let index = 0; index < output.length; index += 1) {
          output[index] = (nibbles[index * 2] << 4) | nibbles[index * 2 + 1];
        }
        return { kind: "string", bytes: output, hex: true };
      }
      if (WHITE_SPACE.has(byte)) continue;
      const digit = hexDigit(byte);
      if (digit < 0) this.invalid("Malformed hexadecimal string.");
      nibbles.push(digit);
    }
    throw new PdfNeedMoreDataError();
  }

  private parseArray(depth: number): PdfValue[] {
    this.positionValue += 1;
    const result: PdfValue[] = [];
    while (true) {
      this.skipWhitespaceAndComments();
      if (this.positionValue >= this.bytes.length) throw new PdfNeedMoreDataError();
      if (this.bytes[this.positionValue] === 0x5d) {
        this.positionValue += 1;
        return result;
      }
      if (result.length >= this.maxContainerEntries) {
        this.containerLimit("array");
      }
      result.push(this.parseValue(depth));
    }
  }

  private parseDictionary(depth: number): PdfDictionary {
    this.positionValue += 2;
    const result: PdfDictionary = new Map();
    let entryCount = 0;
    while (true) {
      this.skipWhitespaceAndComments();
      if (this.positionValue >= this.bytes.length) throw new PdfNeedMoreDataError();
      if (this.bytes[this.positionValue] === 0x3e) {
        if (this.positionValue + 1 >= this.bytes.length) throw new PdfNeedMoreDataError();
        if (this.bytes[this.positionValue + 1] === 0x3e) {
          this.positionValue += 2;
          return result;
        }
      }
      if (this.bytes[this.positionValue] !== 0x2f) {
        this.invalid("A dictionary key is not a name.");
      }
      if (entryCount >= this.maxContainerEntries) {
        this.containerLimit("dictionary");
      }
      const keyOffset = this.absolutePosition;
      const key = this.parseName();
      const duplicate = result.has(key.value);
      if (duplicate && this.duplicateDictionaryKeys === "reject") {
        this.invalid(
          `A dictionary contains duplicate /${key.value} keys.`,
          { reason: "duplicate-dictionary-key", key: key.value }
        );
      }
      const value = this.parseValue(depth);
      if (duplicate) this.onDuplicateDictionaryKey?.(key.value, keyOffset);
      if (!duplicate || this.duplicateDictionaryKeys === "keep-last") {
        result.set(key.value, value);
      }
      entryCount += 1;
    }
  }

  private readNumberToken(): ParsedNumberToken {
    this.skipWhitespaceAndComments();
    const start = this.positionValue;
    if (start >= this.bytes.length) throw new PdfNeedMoreDataError();
    while (this.positionValue < this.bytes.length) {
      const byte = this.bytes[this.positionValue];
      if (!isNumberPart(byte)) break;
      this.positionValue += 1;
    }
    if (start === this.positionValue) this.invalid("Expected a number.");
    const token = bytesToBinaryString(this.bytes.subarray(start, this.positionValue));
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(token)) {
      if (
        this.positionValue === this.bytes.length &&
        /^[+-]?(?:|\.)$/.test(token)
      ) {
        throw new PdfNeedMoreDataError();
      }
      this.invalid("Malformed number.");
    }
    const following = this.bytes[this.positionValue];
    if (following !== undefined && !WHITE_SPACE.has(following) && !DELIMITERS.has(following)) {
      this.invalid("A number token is not followed by a delimiter or white-space.");
    }
    const value = Number(token);
    if (!Number.isFinite(value)) this.invalid("Non-finite number.");
    const integer = /^[+-]?\d+$/.test(token);
    if (integer && !Number.isSafeInteger(value)) {
      this.invalid("An integer exceeds the safe integer range.");
    }
    return { value, integer };
  }

  private matchesKeywordAt(position: number, keyword: string): boolean {
    if (position + keyword.length > this.bytes.length) return false;
    for (let index = 0; index < keyword.length; index += 1) {
      if (this.bytes[position + index] !== keyword.charCodeAt(index)) return false;
    }
    const following = this.bytes[position + keyword.length];
    return following === undefined || WHITE_SPACE.has(following) || DELIMITERS.has(following);
  }

  private isPartialKeywordAt(position: number, keyword: string): boolean {
    const available = this.bytes.length - position;
    if (available >= keyword.length) return false;
    for (let index = 0; index < available; index += 1) {
      if (this.bytes[position + index] !== keyword.charCodeAt(index)) return false;
    }
    return true;
  }

  private requireContainerDepth(depth: number): void {
    if (depth >= this.maxDepth) {
      throw new PdfError("resource-limit", "PDF object nesting exceeds the configured limit.", {
        offset: this.absolutePosition,
        details: { limit: this.maxDepth }
      });
    }
  }

  private containerLimit(kind: "array" | "dictionary"): never {
    throw new PdfError("resource-limit", `A PDF ${kind} exceeds the configured entry limit.`, {
      offset: this.absolutePosition,
      details: { limit: this.maxContainerEntries }
    });
  }

  private invalid(
    message: string,
    details?: Readonly<Record<string, string | number | boolean | null>>
  ): never {
    throw new PdfError("invalid-object", message, {
      offset: this.absolutePosition,
      ...(details === undefined ? {} : { details })
    });
  }
}

function isNumberStart(byte: number | undefined): boolean {
  return byte !== undefined && (byte === 0x2b || byte === 0x2d || byte === 0x2e || (byte >= 0x30 && byte <= 0x39));
}

function isNumberPart(byte: number): boolean {
  return byte === 0x2b || byte === 0x2d || byte === 0x2e || (byte >= 0x30 && byte <= 0x39);
}

function hexDigit(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return -1;
}

function bytesToBinaryString(bytes: ArrayLike<number>): string {
  let output = "";
  const chunkSize = 8192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    output += String.fromCharCode(...Array.from(
      { length: Math.min(chunkSize, bytes.length - offset) },
      (_, index) => bytes[offset + index]
    ));
  }
  return output;
}
