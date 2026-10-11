import { PdfError, throwIfAborted } from "./nativeTypes";

export interface NativeFontPostScriptDecoderOptions {
  readonly signal?: AbortSignal;
  readonly maxDecodedBytes?: number;
}
export interface NativeFontPostScriptCompressionParameters {
  readonly EarlyChange?: number;
  readonly UnitLength?: number;
  readonly LowBitFirst?: boolean;
  readonly Predictor?: number;
  readonly Colors?: number;
  readonly Columns?: number;
  readonly BitsPerComponent?: number;
}
export interface NativeFontPostScriptByteDecoder {
  readByte(): number;
  clone(read: () => number, options?: NativeFontPostScriptDecoderOptions): NativeFontPostScriptByteDecoder;
}

/** PLRM §3.13.3; RFC 1950/1951. Pulls never consume the next encoded stream. */
export function createNativeFontPostScriptCompressionDecoder(read: () => number, name: "LZWDecode" | "FlateDecode",
  parameters: NativeFontPostScriptCompressionParameters = {}, options: NativeFontPostScriptDecoderOptions = {}): NativeFontPostScriptByteDecoder {
  const raw = name === "LZWDecode" ? new LzwDecoder(read, parameters, options) : new FlateDecoder(read, options);
  return (parameters.Predictor ?? 1) === 1 ? raw : new PredictorDecoder(raw, parameters, options);
}

class BitCursor {
  private buffer = 0;
  private count = 0;
  private readonly source: () => number;
  private readonly lowBitFirst: boolean;
  constructor(source: () => number, lowBitFirst: boolean) { this.source = source; this.lowBitFirst = lowBitFirst; }
  read(width: number): number {
    while (this.count < width) {
      const next = required(this.source(), "compressed bit stream");
      this.buffer = this.lowBitFirst ? this.buffer | (next << this.count) : (this.buffer << 8) | next;
      this.count += 8;
    }
    this.count -= width;
    const mask = (1 << width) - 1;
    const value = this.lowBitFirst ? this.buffer & mask : (this.buffer >>> this.count) & mask;
    this.buffer = this.lowBitFirst ? this.buffer >>> width : this.buffer & ((1 << this.count) - 1);
    return value;
  }
  align(): void { this.buffer = this.count = 0; }
  requireZeroPadding(): void { if (this.buffer !== 0) throw malformed("The LZW EOD byte has nonzero padding bits."); this.align(); }
  clone(read: () => number): BitCursor {
    const result = new BitCursor(read, this.lowBitFirst); result.buffer = this.buffer; result.count = this.count; return result;
  }
}

class LzwDecoder implements NativeFontPostScriptByteDecoder {
  private readonly options: NativeFontPostScriptDecoderOptions;
  private bits: BitCursor;
  private readonly prefix = new Int32Array(4096);
  private readonly suffix = new Uint8Array(4096);
  private readonly clearCode: number;
  private readonly earlyChange: number;
  private readonly unitLength: number;
  private readonly lowBitFirst: boolean;
  private width: number;
  private nextCode: number;
  private previous = -1;
  private tableFull = false;
  private output: number[] = [];
  private outputOffset = -1;
  private ended = false;

  constructor(read: () => number, parameters: NativeFontPostScriptCompressionParameters,
    options: NativeFontPostScriptDecoderOptions) {
    this.options = options;
    this.earlyChange = integer(parameters.EarlyChange, 1, "EarlyChange");
    this.unitLength = integer(parameters.UnitLength, 8, "UnitLength");
    if (this.earlyChange !== 0 && this.earlyChange !== 1) throw malformed("LZW EarlyChange must be 0 or 1.");
    if (this.unitLength < 3 || this.unitLength > 8) throw malformed("LZW UnitLength must be 3 through 8.");
    if (parameters.LowBitFirst !== undefined && typeof parameters.LowBitFirst !== "boolean") throw malformed("LZW LowBitFirst must be a boolean.");
    if (this.unitLength !== 8 && (parameters.Predictor ?? 1) !== 1) throw malformed("LZW UnitLength other than 8 cannot be combined with prediction.");
    this.lowBitFirst = parameters.LowBitFirst ?? false;
    this.bits = new BitCursor(read, this.lowBitFirst);
    this.clearCode = 1 << this.unitLength;
    this.width = this.unitLength + 1;
    this.nextCode = this.clearCode + 2;
  }

  readByte(): number {
    throwIfAborted(this.options.signal);
    if (this.outputOffset >= 0) return this.output[this.outputOffset--];
    while (!this.ended) {
      throwIfAborted(this.options.signal);
      const code = this.bits.read(this.width);
      if (code === this.clearCode) {
        this.width = this.unitLength + 1; this.nextCode = this.clearCode + 2; this.previous = -1; this.tableFull = false; continue;
      }
      if (code === this.clearCode + 1) { this.bits.requireZeroPadding(); this.ended = true; return -1; }
      if (this.tableFull) throw malformed("The LZW font table was not cleared after becoming full.");
      if (code < this.clearCode || (code >= this.clearCode + 2 && code < this.nextCode)) this.output = this.expand(code);
      else if (code === this.nextCode && this.previous >= 0) {
        this.output = this.expand(this.previous); this.output.unshift(this.output.at(-1)!);
      } else throw malformed("The LZW font stream references an undefined code.");
      const first = this.output.at(-1)!;
      if (this.previous >= 0 && this.nextCode < 4096) {
        this.prefix[this.nextCode] = this.previous; this.suffix[this.nextCode++] = first;
        if (this.width < 12 && this.nextCode + this.earlyChange === (1 << this.width)) this.width++;
        this.tableFull = this.nextCode === 4096;
      }
      this.previous = code;
      this.outputOffset = this.output.length - 1;
      return this.output[this.outputOffset--];
    }
    return -1;
  }

  private expand(code: number): number[] {
    const output: number[] = [];
    while (code >= this.clearCode) {
      throwIfAborted(this.options.signal);
      if (code >= this.nextCode || code < this.clearCode + 2) throw malformed("The LZW font dictionary chain is invalid.");
      output.push(this.suffix[code]); code = this.prefix[code];
    }
    output.push(code); return output;
  }

  clone(read: () => number, options = this.options): LzwDecoder {
    const result = new LzwDecoder(read, { EarlyChange: this.earlyChange, UnitLength: this.unitLength, LowBitFirst: this.lowBitFirst }, options);
    result.bits = this.bits.clone(read); result.prefix.set(this.prefix); result.suffix.set(this.suffix);
    result.width = this.width; result.nextCode = this.nextCode; result.previous = this.previous; result.tableFull = this.tableFull;
    result.output = [...this.output]; result.outputOffset = this.outputOffset; result.ended = this.ended; return result;
  }
}

interface HuffmanTable {
  readonly counts: readonly number[];
  readonly firstCodes: readonly number[];
  readonly firstSymbols: readonly number[];
  readonly symbols: readonly number[];
  readonly maximum: number;
}
function huffman(lengths: readonly number[], allowedIncomplete: boolean): HuffmanTable {
  const counts = Array<number>(16).fill(0);
  for (const length of lengths) {
    if (!Number.isInteger(length) || length < 0 || length > 15) throw malformed("A DEFLATE Huffman code length is invalid.");
    counts[length]++;
  }
  counts[0] = 0;
  let left = 1, maximum = 0;
  for (let width = 1; width <= 15; width++) {
    left = left * 2 - counts[width];
    if (left < 0) throw malformed("A DEFLATE Huffman tree is oversubscribed.");
    if (counts[width]) maximum = width;
  }
  // RFC 1951 permits a single one-bit code; an empty distance alphabet is
  // usable only by blocks containing no matches and fails if a match uses it.
  if (left !== 0 && !(allowedIncomplete && (maximum === 0 || (maximum === 1 && counts[1] === 1)))) {
    throw malformed("A DEFLATE Huffman tree is incomplete.");
  }
  const firstCodes = Array<number>(16).fill(0), firstSymbols = Array<number>(16).fill(0), symbols: number[] = [];
  let code = 0;
  for (let width = 1; width <= 15; width++) {
    code = (code + counts[width - 1]) * 2; firstCodes[width] = code; firstSymbols[width] = symbols.length;
    lengths.forEach((length, symbol) => { if (length === width) symbols.push(symbol); });
  }
  return { counts, firstCodes, firstSymbols, symbols, maximum };
}
function symbol(bits: BitCursor, table: HuffmanTable): number {
  let code = 0;
  for (let width = 1; width <= table.maximum; width++) {
    code = code * 2 + bits.read(1);
    const offset = code - table.firstCodes[width];
    if (offset >= 0 && offset < table.counts[width]) return table.symbols[table.firstSymbols[width] + offset];
  }
  throw malformed("The DEFLATE font stream contains an undefined Huffman code.");
}
const FIXED_LITERALS = huffman(Array.from({ length: 288 }, (_, code) => code <= 143 ? 8 : code <= 255 ? 9 : code <= 279 ? 7 : 8), false);
const FIXED_DISTANCES = huffman(Array<number>(32).fill(5), false);
const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DISTANCE_BITS = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

class FlateDecoder implements NativeFontPostScriptByteDecoder {
  private readonly source: () => number;
  private readonly options: NativeFontPostScriptDecoderOptions;
  private bits: BitCursor;
  private readonly history = new Uint8Array(32768);
  private historyOffset = 0;
  private availableHistory = 0;
  private windowSize = 32768;
  private initialized = false;
  private finalBlock = false;
  private blockKind = -1;
  private storedRemaining = 0;
  private literals: HuffmanTable | null = null;
  private distances: HuffmanTable | null = null;
  private matchRemaining = 0;
  private matchDistance = 0;
  private adlerFirst = 1;
  private adlerSecond = 0;
  private ended = false;

  constructor(source: () => number, options: NativeFontPostScriptDecoderOptions) {
    this.source = source; this.options = options;
    this.bits = new BitCursor(source, true);
  }

  readByte(): number {
    throwIfAborted(this.options.signal);
    if (this.ended) return -1;
    if (!this.initialized) {
      const method = required(this.source(), "zlib header"), flags = required(this.source(), "zlib header");
      if ((method & 15) !== 8 || (method >>> 4) > 7 || ((method << 8) + flags) % 31 !== 0) throw malformed("The Flate font stream has an invalid zlib header.");
      if (flags & 32) throw malformed("The Flate font stream requires an unavailable preset dictionary.");
      this.windowSize = 1 << ((method >>> 4) + 8); this.initialized = true;
    }
    while (true) {
      throwIfAborted(this.options.signal);
      if (this.matchRemaining) {
        this.matchRemaining--;
        return this.emit(this.history[(this.historyOffset - this.matchDistance) & 32767]);
      }
      if (this.blockKind === 0) {
        if (this.storedRemaining) { this.storedRemaining--; return this.emit(this.bits.read(8)); }
        if (this.finalBlock) return this.finish();
        this.blockKind = -1;
      } else if (this.blockKind >= 1) {
        const code = symbol(this.bits, this.literals!);
        if (code < 256) return this.emit(code);
        if (code === 256) {
          if (this.finalBlock) return this.finish();
          this.blockKind = -1; continue;
        }
        if (code > 285) throw malformed("The DEFLATE font stream uses a reserved length code.");
        const index = code - 257;
        this.matchRemaining = LENGTH_BASE[index] + this.bits.read(LENGTH_BITS[index]);
        const distance = symbol(this.bits, this.distances!);
        if (distance > 29) throw malformed("The DEFLATE font stream uses a reserved distance code.");
        this.matchDistance = DISTANCE_BASE[distance] + this.bits.read(DISTANCE_BITS[distance]);
        if (this.matchDistance > this.availableHistory || this.matchDistance > this.windowSize) throw malformed("A DEFLATE font match precedes the available history.");
        continue;
      }
      this.finalBlock = this.bits.read(1) !== 0; this.blockKind = this.bits.read(2);
      if (this.blockKind === 0) {
        this.bits.align();
        const length = this.bits.read(16), complement = this.bits.read(16);
        if ((length ^ complement) !== 65535) throw malformed("A DEFLATE stored block length is invalid.");
        this.storedRemaining = length;
      } else if (this.blockKind === 1) { this.literals = FIXED_LITERALS; this.distances = FIXED_DISTANCES; }
      else if (this.blockKind === 2) this.dynamicTables();
      else throw malformed("The DEFLATE font stream uses the reserved block type.");
    }
  }

  private dynamicTables(): void {
    const literalCount = this.bits.read(5) + 257, distanceCount = this.bits.read(5) + 1, lengthCount = this.bits.read(4) + 4;
    if (literalCount > 286) throw malformed("The DEFLATE literal alphabet is too large.");
    const codeLengths = Array<number>(19).fill(0);
    for (let i = 0; i < lengthCount; i++) codeLengths[CODE_LENGTH_ORDER[i]] = this.bits.read(3);
    const lengthsTable = huffman(codeLengths, false), lengths: number[] = [];
    while (lengths.length < literalCount + distanceCount) {
      throwIfAborted(this.options.signal);
      const code = symbol(this.bits, lengthsTable);
      if (code <= 15) lengths.push(code);
      else {
        if (code === 16 && lengths.length === 0) throw malformed("A DEFLATE repeat has no prior code length.");
        const count = code === 16 ? this.bits.read(2) + 3 : code === 17 ? this.bits.read(3) + 3 : this.bits.read(7) + 11;
        if (lengths.length + count > literalCount + distanceCount) throw malformed("A DEFLATE code-length repeat exceeds its alphabet.");
        const length = code === 16 ? lengths.at(-1)! : 0;
        for (let i = 0; i < count; i++) lengths.push(length);
      }
    }
    if (lengths[256] === 0) throw malformed("A DEFLATE literal alphabet omits its end-of-block code.");
    this.literals = huffman(lengths.slice(0, literalCount), true);
    this.distances = huffman(lengths.slice(literalCount), true);
  }

  private emit(value: number): number {
    this.history[this.historyOffset] = value; this.historyOffset = (this.historyOffset + 1) & 32767;
    this.availableHistory = Math.min(this.availableHistory + 1, 32768);
    this.adlerFirst = (this.adlerFirst + value) % 65521;
    this.adlerSecond = (this.adlerSecond + this.adlerFirst) % 65521;
    return value;
  }

  private finish(): number {
    this.bits.align();
    let expected = 0;
    for (let i = 0; i < 4; i++) expected = expected * 256 + required(this.source(), "zlib Adler-32 trailer");
    const actual = ((this.adlerSecond << 16) | this.adlerFirst) >>> 0;
    if (expected !== actual) throw malformed("The Flate font stream has an invalid Adler-32 checksum.");
    this.ended = true; return -1;
  }

  clone(read: () => number, options = this.options): FlateDecoder {
    const result = new FlateDecoder(read, options); result.bits = this.bits.clone(read); result.history.set(this.history);
    result.historyOffset = this.historyOffset; result.availableHistory = this.availableHistory; result.windowSize = this.windowSize;
    result.initialized = this.initialized; result.finalBlock = this.finalBlock; result.blockKind = this.blockKind;
    result.storedRemaining = this.storedRemaining; result.literals = this.literals; result.distances = this.distances;
    result.matchRemaining = this.matchRemaining; result.matchDistance = this.matchDistance;
    result.adlerFirst = this.adlerFirst; result.adlerSecond = this.adlerSecond; result.ended = this.ended; return result;
  }
}

class PredictorDecoder implements NativeFontPostScriptByteDecoder {
  private readonly source: NativeFontPostScriptByteDecoder;
  private readonly options: NativeFontPostScriptDecoderOptions;
  private readonly predictor: number;
  private readonly colors: number;
  private readonly columns: number;
  private readonly bits: number;
  private readonly rowBytes: number;
  private readonly samples: number;
  private readonly pixelBytes: number;
  private row: Uint8Array = new Uint8Array();
  private previous: Uint8Array = new Uint8Array();
  private offset = 0;
  private produced = 0;
  private ended = false;

  constructor(source: NativeFontPostScriptByteDecoder, parameters: NativeFontPostScriptCompressionParameters,
    options: NativeFontPostScriptDecoderOptions) {
    this.source = source; this.options = options;
    this.predictor = integer(parameters.Predictor, 1, "Predictor"); this.colors = integer(parameters.Colors, 1, "Colors");
    this.columns = integer(parameters.Columns, 1, "Columns"); this.bits = integer(parameters.BitsPerComponent, 8, "BitsPerComponent");
    if (this.predictor !== 2 && this.predictor < 10) throw malformed("The font stream has an unsupported predictor.");
    if (this.colors < 1 || this.columns < 1 || ![1, 2, 4, 8, 16].includes(this.bits)) throw malformed("The font stream has invalid predictor parameters.");
    this.samples = this.colors * this.columns;
    const rowBits = this.samples * this.bits;
    if (!Number.isSafeInteger(rowBits)) throw resource("The font predictor row size exceeds the integer representation.");
    this.rowBytes = Math.ceil(rowBits / 8); this.pixelBytes = Math.max(1, Math.ceil(this.colors * this.bits / 8));
  }

  readByte(): number {
    throwIfAborted(this.options.signal);
    if (this.offset < this.row.length) { this.produced++; return this.row[this.offset++]; }
    if (this.ended) return -1;
    let tag = 0;
    if (this.predictor >= 10) {
      tag = this.source.readByte(); if (tag < 0) { this.ended = true; return -1; }
      if (tag > 4) throw malformed("The font PNG predictor has an invalid row tag.");
    }
    const row: number[] = [];
    while (row.length < this.rowBytes) {
      const value = this.source.readByte();
      if (value < 0) { this.ended = true; break; }
      if (this.produced + row.length >= (this.options.maxDecodedBytes ?? Number.MAX_SAFE_INTEGER)) throw resource("Font PostScript exceeds the configured decoded-file byte limit.");
      row.push(value);
    }
    if (row.length === 0) {
      if (this.predictor >= 10) throw malformed("The font PNG predictor row contains a tag without samples.");
      return -1;
    }
    this.previous = this.row; this.row = bytes(row); this.offset = 0;
    if (this.predictor === 2) {
      const count = Math.min(this.samples, Math.floor(this.row.length * 8 / this.bits)), mask = 2 ** this.bits - 1;
      for (let sample = this.colors; sample < count; sample++) {
        throwIfAborted(this.options.signal);
        writeSample(this.row, sample, this.bits, (readSample(this.row, sample, this.bits) + readSample(this.row, sample - this.colors, this.bits)) & mask);
      }
    } else {
      for (let i = 0; i < this.row.length; i++) {
        throwIfAborted(this.options.signal);
        const left = i >= this.pixelBytes ? this.row[i - this.pixelBytes] : 0, up = this.previous[i] ?? 0;
        const upperLeft = i >= this.pixelBytes ? this.previous[i - this.pixelBytes] ?? 0 : 0;
        const prediction = tag === 0 ? 0 : tag === 1 ? left : tag === 2 ? up : tag === 3 ? Math.floor((left + up) / 2) : paeth(left, up, upperLeft);
        this.row[i] = (this.row[i] + prediction) & 255;
      }
    }
    this.produced++; return this.row[this.offset++];
  }

  clone(read: () => number, options = this.options): PredictorDecoder {
    const result = new PredictorDecoder(this.source.clone(read, options), { Predictor: this.predictor, Colors: this.colors,
      Columns: this.columns, BitsPerComponent: this.bits }, options);
    result.row = this.row.slice(); result.previous = this.previous.slice(); result.offset = this.offset;
    result.produced = this.produced; result.ended = this.ended; return result;
  }
}

function readSample(row: Uint8Array, index: number, bits: number): number {
  const bit = index * bits;
  const offset = Math.floor(bit / 8);
  if (bits === 16) return row[offset] * 256 + row[offset + 1];
  return (row[offset] >>> (8 - bits - (bit % 8))) & (2 ** bits - 1);
}
function writeSample(row: Uint8Array, index: number, bits: number, value: number): void {
  const bit = index * bits, offset = Math.floor(bit / 8);
  if (bits === 16) { row[offset] = value >>> 8; row[offset + 1] = value & 255; return; }
  const shift = 8 - bits - (bit % 8), mask = (2 ** bits - 1) << shift;
  row[offset] = (row[offset] & ~mask) | (value << shift);
}
function paeth(left: number, up: number, corner: number): number {
  const prediction = left + up - corner, a = Math.abs(prediction - left), b = Math.abs(prediction - up), c = Math.abs(prediction - corner);
  return a <= b && a <= c ? left : b <= c ? up : corner;
}
function integer(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value)) throw malformed(`The font stream ${label} parameter must be an integer.`); return value;
}
function required(value: number, label: string): number { if (value < 0) throw malformed(`The font ${label} is truncated.`); return value; }
function bytes(values: readonly number[]): Uint8Array {
  try { return Uint8Array.from(values); } catch (cause) { throw new PdfError("resource-limit", "The font predictor row allocation failed.", { cause }); }
}
function malformed(message: string): PdfError {
  return new PdfError("unsupported-font", message, { details: { reason: "font-postscript-compression", postScriptError: "ioerror" } });
}
function resource(message: string): PdfError {
  return new PdfError("resource-limit", message, { details: { reason: "font-postscript-file-limit" } });
}
