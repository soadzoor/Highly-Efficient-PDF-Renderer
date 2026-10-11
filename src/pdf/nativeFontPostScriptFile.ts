import { PdfError, throwIfAborted } from "./nativeTypes";
import { createNativeFontPostScriptCompressionDecoder } from "./nativeFontPostScriptCompression";
import type { NativeFontPostScriptByteDecoder, NativeFontPostScriptCompressionParameters } from "./nativeFontPostScriptCompression";
import { decodeNativeCcittFaxSource } from "./nativeCcitt";
import type { NativeCcittParameters } from "./nativeCcitt";
import { decodeBundledJpegSync } from "./nativeJpegCodec";
import { decodeBundledJbig2Sync } from "./nativeJbig2Codec";
import { stripJbig2FileHeader } from "./codecs/jbig2Preflight";

export interface NativeFontPostScriptFileOptions {
  readonly signal?: AbortSignal;
  /** Optional caller allowance for decoded bytes; there is no default ceiling. */
  readonly maxDecodedBytes?: number;
}

export interface NativeFontPostScriptFilterParameters extends NativeFontPostScriptCompressionParameters, NativeCcittParameters {
  readonly CloseSource?: boolean;
  readonly ColorTransform?: number;
  readonly Uncompressed?: boolean;
  readonly EODCount?: number;
  readonly EODString?: Uint8Array;
  readonly Filter?: string | readonly string[];
  readonly DecodeParms?: NativeFontPostScriptFilterParameters | readonly (NativeFontPostScriptFilterParameters | null)[];
}

/** A font-local file owns no host handle and never accesses an OS file/device. */
export interface NativeFontPostScriptFile {
  readonly closed: boolean;
  readByte(): number;
  peekByte(): number;
  readInto(target: Uint8Array): number;
  readHexInto(target: Uint8Array): number;
  readLineInto(target: Uint8Array): { readonly length: number; readonly complete: boolean };
  bytesAvailable(): number;
  tell(): number;
  seek(offset: number): void;
  flush(): void;
  close(): void;
}

export interface NativeFontPostScriptMemoryFileSnapshot {
  /** The original storage view; a VM clone can preserve its string aliases. */
  readonly bytes: Uint8Array;
  readonly position: number;
  readonly reusable: boolean;
  readonly closed: boolean;
  readonly encounteredEof: boolean;
}

/** PLRM §§3.8, 3.13 and operator details; sources retain their exact EOD cursor. */
abstract class InputFile implements NativeFontPostScriptFile {
  protected readonly options: NativeFontPostScriptFileOptions;
  protected position = 0;
  protected encounteredEof = false;
  protected isClosed = false;
  protected lookahead: number | undefined;
  protected readonly source?: NativeFontPostScriptFile;
  protected readonly closeSource: boolean;
  private readonly autoClose: boolean;

  constructor(options: NativeFontPostScriptFileOptions, source?: NativeFontPostScriptFile,
    closeSource = false, autoClose = true) {
    if (options.maxDecodedBytes !== undefined && (!Number.isSafeInteger(options.maxDecodedBytes) || options.maxDecodedBytes < 1)) {
      throw new RangeError("Invalid PostScript decoded-file byte limit.");
    }
    this.options = options;
    this.source = source;
    this.closeSource = closeSource;
    this.autoClose = autoClose;
  }

  get closed(): boolean { return this.isClosed; }

  readByte(): number {
    throwIfAborted(this.options.signal);
    if (this.isClosed) return -1;
    const value = this.lookahead ?? this.readDecodedByte();
    this.lookahead = undefined;
    if (value < 0) {
      this.encounteredEof = true;
      if (this.autoClose) this.close();
      return -1;
    }
    if (++this.position > (this.options.maxDecodedBytes ?? Number.MAX_SAFE_INTEGER)) throw limited();
    return value;
  }

  peekByte(): number {
    throwIfAborted(this.options.signal);
    if (this.isClosed) return -1;
    const value = this.lookahead ??= this.readDecodedByte();
    if (value < 0) {
      this.encounteredEof = true;
      if (this.autoClose) this.close();
    }
    return value;
  }

  readInto(target: Uint8Array): number {
    let length = 0;
    while (length < target.length) {
      const value = this.readByte();
      if (value < 0) break;
      target[length++] = value;
    }
    return length;
  }

  readHexInto(target: Uint8Array): number {
    let length = 0, high = -1;
    while (length < target.length) {
      const value = this.readByte();
      if (value < 0) break;
      const digit = hex(value);
      // Unlike ASCIIHexDecode, readhexstring ignores all nonhex characters
      // and discards an unmatched high nibble at EOF (PLRM readhexstring).
      if (digit < 0) continue;
      if (high < 0) high = digit;
      else { target[length++] = high * 16 + digit; high = -1; }
    }
    return length;
  }

  readLineInto(target: Uint8Array): { readonly length: number; readonly complete: boolean } {
    let length = 0;
    while (true) {
      const value = this.peekByte();
      if (value < 0) { this.readByte(); return { length, complete: false }; }
      if (value === 10 || value === 13) {
        this.readByte();
        if (value === 13 && this.peekByte() === 10) this.readByte();
        return { length, complete: true };
      }
      if (length === target.length) throw invalid("The PostScript readline target is shorter than the line.", "rangecheck");
      target[length++] = this.readByte();
    }
  }

  bytesAvailable(): number { return -1; }
  tell(): number { throw invalid("This PostScript filter is not positionable.", "ioerror"); }
  seek(_offset: number): void { throw invalid("This PostScript filter is not positionable.", "ioerror"); }
  flush(): void { while (this.readByte() >= 0) { /* Consume exactly through EOD. */ } }
  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.lookahead = undefined;
    if (this.closeSource) this.source?.close();
  }

  protected abstract readDecodedByte(): number;
  abstract cloneFile(cloneSource: (file: NativeFontPostScriptFile) => NativeFontPostScriptFile,
    cloneBytes: (bytes: Uint8Array) => Uint8Array, options?: NativeFontPostScriptFileOptions): InputFile;
  sourceFile(): NativeFontPostScriptFile | null { return this.source ?? null; }
  protected copyState<T extends InputFile>(target: T): T {
    target.position = this.position; target.encounteredEof = this.encounteredEof;
    target.isClosed = this.isClosed; target.lookahead = this.lookahead; return target;
  }
}

class MemoryFile extends InputFile {
  private offset = 0;
  private readonly bytes: Uint8Array;
  private readonly reusable: boolean;

  constructor(bytes: Uint8Array, options: NativeFontPostScriptFileOptions, reusable = false,
    source?: NativeFontPostScriptFile, closeSource = false) {
    super(options, source, closeSource, false);
    this.bytes = bytes;
    this.reusable = reusable;
  }

  protected readDecodedByte(): number { return this.offset < this.bytes.length ? this.bytes[this.offset++] : -1; }
  override bytesAvailable(): number {
    return this.isClosed || (this.encounteredEof && !this.reusable) ? -1 : this.bytes.length - this.position;
  }
  override tell(): number {
    if (this.isClosed) throw invalid("The PostScript input file is closed.", "ioerror");
    return this.position;
  }
  override seek(offset: number): void {
    throwIfAborted(this.options.signal);
    if (this.isClosed || !Number.isSafeInteger(offset) || offset < 0 || offset > this.bytes.length) {
      throw invalid("The PostScript input file position is unavailable.", "ioerror");
    }
    this.position = this.offset = offset;
    this.lookahead = undefined;
    this.encounteredEof = false;
  }
  snapshot(): NativeFontPostScriptMemoryFileSnapshot {
    return { bytes: this.bytes, position: this.position, reusable: this.reusable,
      closed: this.isClosed, encounteredEof: this.encounteredEof };
  }
  restore(snapshot: NativeFontPostScriptMemoryFileSnapshot): void {
    this.position = this.offset = snapshot.position;
    this.lookahead = undefined;
    this.isClosed = snapshot.closed;
    this.encounteredEof = snapshot.encounteredEof;
  }
  cloneFile(cloneSource: (file: NativeFontPostScriptFile) => NativeFontPostScriptFile,
    cloneBytes: (bytes: Uint8Array) => Uint8Array, options = this.options): MemoryFile {
    const result = new MemoryFile(cloneBytes(this.bytes), options, this.reusable,
      this.source ? cloneSource(this.source) : undefined, this.closeSource);
    result.offset = this.offset; return this.copyState(result);
  }
}

export function createNativeFontPostScriptMemoryFile(bytes: Uint8Array,
  options: NativeFontPostScriptFileOptions = {}): NativeFontPostScriptFile {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("PostScript file data must be a Uint8Array.");
  return new MemoryFile(bytes, options);
}

export function snapshotNativeFontPostScriptMemoryFile(file: NativeFontPostScriptFile): NativeFontPostScriptMemoryFileSnapshot | null {
  return file instanceof MemoryFile ? file.snapshot() : null;
}

export function restoreNativeFontPostScriptMemoryFile(snapshot: NativeFontPostScriptMemoryFileSnapshot,
  options: NativeFontPostScriptFileOptions = {}): NativeFontPostScriptFile {
  if (!Number.isSafeInteger(snapshot.position) || snapshot.position < 0 || snapshot.position > snapshot.bytes.length) {
    throw new RangeError("Invalid PostScript memory-file snapshot position.");
  }
  const file = new MemoryFile(snapshot.bytes, options, snapshot.reusable);
  file.restore(snapshot);
  return file;
}

class AsciiHexFile extends InputFile {
  private ended = false;
  protected readDecodedByte(): number {
    if (this.ended) return -1;
    let high = -1;
    while (true) {
      const value = this.source!.readByte();
      if (value < 0 || value === 62) {
        this.ended = true;
        return high < 0 ? -1 : high * 16;
      }
      if (white(value)) continue;
      const digit = hex(value);
      if (digit < 0) throw invalid("An ASCIIHexDecode font file contains an invalid character.", "ioerror");
      if (high < 0) high = digit;
      else return high * 16 + digit;
    }
  }
  cloneFile(cloneSource: (file: NativeFontPostScriptFile) => NativeFontPostScriptFile,
    _cloneBytes: (bytes: Uint8Array) => Uint8Array, options = this.options): AsciiHexFile {
    const result = new AsciiHexFile(options, cloneSource(this.source!), this.closeSource);
    result.ended = this.ended; return this.copyState(result);
  }
}

class Ascii85File extends InputFile {
  private output: readonly number[] = [];
  private outputOffset = 0;
  private ended = false;
  protected readDecodedByte(): number {
    if (this.outputOffset < this.output.length) return this.output[this.outputOffset++];
    if (this.ended) return -1;
    const group: number[] = [];
    while (group.length < 5) {
      const value = this.source!.readByte();
      if (value < 0 || value === 126) {
        if (value === 126 && this.source!.readByte() !== 62) throw invalid("An ASCII85Decode font file has an invalid terminator.", "ioerror");
        this.ended = true;
        if (group.length === 1) throw invalid("An ASCII85Decode font file has a one-character final group.", "ioerror");
        if (group.length === 0) return -1;
        break;
      }
      if (white(value)) continue;
      if (value === 122) {
        if (group.length) throw invalid("An ASCII85Decode z occurs inside a group.", "ioerror");
        this.output = [0, 0, 0, 0]; this.outputOffset = 1; return 0;
      }
      if (value < 33 || value > 117) throw invalid("An ASCII85Decode font file contains an invalid character.", "ioerror");
      group.push(value - 33);
    }
    const length = group.length;
    while (group.length < 5) group.push(84);
    let packed = 0;
    for (const digit of group) packed = packed * 85 + digit;
    if (packed > 0xffff_ffff) throw invalid("An ASCII85Decode font group overflows 32 bits.", "ioerror");
    this.output = [packed >>> 24, (packed >>> 16) & 255, (packed >>> 8) & 255, packed & 255].slice(0, length - 1);
    this.outputOffset = 1;
    return this.output[0];
  }
  cloneFile(cloneSource: (file: NativeFontPostScriptFile) => NativeFontPostScriptFile,
    _cloneBytes: (bytes: Uint8Array) => Uint8Array, options = this.options): Ascii85File {
    const result = new Ascii85File(options, cloneSource(this.source!), this.closeSource);
    result.output = [...this.output]; result.outputOffset = this.outputOffset; result.ended = this.ended; return this.copyState(result);
  }
}

class RunLengthFile extends InputFile {
  private remaining = 0;
  private repeat = -1;
  private ended = false;
  protected readDecodedByte(): number {
    if (this.ended) return -1;
    if (this.remaining === 0) {
      const control = this.source!.readByte();
      if (control < 0 || control === 128) { this.ended = true; return -1; }
      this.remaining = control < 128 ? control + 1 : 257 - control;
      this.repeat = control < 128 ? -1 : this.source!.readByte();
      if (control > 128 && this.repeat < 0) throw invalid("A RunLengthDecode font repeat is truncated.", "ioerror");
    }
    this.remaining--;
    const value = this.repeat < 0 ? this.source!.readByte() : this.repeat;
    if (value < 0) throw invalid("A RunLengthDecode font literal is truncated.", "ioerror");
    return value;
  }
  cloneFile(cloneSource: (file: NativeFontPostScriptFile) => NativeFontPostScriptFile,
    _cloneBytes: (bytes: Uint8Array) => Uint8Array, options = this.options): RunLengthFile {
    const result = new RunLengthFile(options, cloneSource(this.source!), this.closeSource);
    result.remaining = this.remaining; result.repeat = this.repeat; result.ended = this.ended; return this.copyState(result);
  }
}

class SubFile extends InputFile {
  private remaining: number;
  private readonly marker: Uint8Array;
  private pending: number[] = [];
  private output: number[] = [];
  private outputOffset = 0;
  private ended = false;

  constructor(source: NativeFontPostScriptFile, parameters: NativeFontPostScriptFilterParameters,
    options: NativeFontPostScriptFileOptions) {
    super(options, source, parameters.CloseSource);
    const count = parameters.EODCount;
    if (!Number.isSafeInteger(count) || count! < 0 || !(parameters.EODString instanceof Uint8Array)) {
      throw invalid("SubFileDecode requires a nonnegative EODCount and string EODString.", "rangecheck");
    }
    this.remaining = count!;
    this.marker = parameters.EODString;
  }

  protected readDecodedByte(): number {
    while (true) {
      if (this.outputOffset < this.output.length) return this.output[this.outputOffset++];
      this.output = []; this.outputOffset = 0;
      if (this.ended) return -1;
      if (!this.marker.length) {
        const value = this.source!.readByte();
        if (this.remaining > 0 && --this.remaining === 0) this.ended = true;
        return value;
      }
      const value = this.source!.readByte();
      if (value < 0) { this.output = this.pending; this.pending = []; this.ended = true; continue; }
      this.pending.push(value);
      while (this.pending.length && !prefix(this.pending, this.marker)) this.output.push(this.pending.shift()!);
      if (this.pending.length === this.marker.length) {
        if (this.remaining === 0) { this.pending = []; this.ended = true; }
        else {
          for (const byte of this.pending) this.output.push(byte); this.pending = [];
          if (--this.remaining === 0) this.ended = true;
        }
      }
    }
  }
  cloneFile(cloneSource: (file: NativeFontPostScriptFile) => NativeFontPostScriptFile,
    cloneBytes: (bytes: Uint8Array) => Uint8Array, options = this.options): SubFile {
    const result = new SubFile(cloneSource(this.source!), { EODCount: this.remaining, EODString: cloneBytes(this.marker),
      CloseSource: this.closeSource }, options);
    result.pending = [...this.pending]; result.output = [...this.output]; result.outputOffset = this.outputOffset;
    result.ended = this.ended; return this.copyState(result);
  }
}

class EexecFile extends InputFile {
  private initialized = false;
  private hexadecimal = false;
  private ciphertext: number[] = [];
  private key = 55665;

  protected readDecodedByte(): number {
    if (!this.initialized) {
      this.initialized = true;
      let value = this.source!.readByte();
      while (white(value)) value = this.source!.readByte();
      if (value >= 0) this.ciphertext.push(value);
      while (this.ciphertext.length < 4) {
        value = this.source!.readByte(); if (value < 0) break; this.ciphertext.push(value);
      }
      this.hexadecimal = this.ciphertext.length === 4 && this.ciphertext.every(byte => hex(byte) >= 0);
      for (let discard = 0; discard < 4; discard++) {
        if (this.decryptByte() < 0) throw invalid("The eexec font input is shorter than its four-byte prefix.", "ioerror");
      }
    }
    return this.decryptByte();
  }

  private cipherByte(): number {
    const next = (): number => this.ciphertext.length ? this.ciphertext.shift()! : this.source!.readByte();
    if (!this.hexadecimal) return next();
    let high = -1;
    while (true) {
      const value = next();
      if (value < 0) return -1;
      if (white(value)) continue;
      const digit = hex(value);
      if (digit < 0) throw invalid("The hexadecimal eexec font input contains an invalid character.", "ioerror");
      if (high < 0) high = digit;
      else return high * 16 + digit;
    }
  }

  private decryptByte(): number {
    const cipher = this.cipherByte();
    if (cipher < 0) return -1;
    const plain = cipher ^ (this.key >>> 8);
    this.key = ((cipher + this.key) * 52845 + 22719) & 0xffff;
    return plain;
  }
  cloneFile(cloneSource: (file: NativeFontPostScriptFile) => NativeFontPostScriptFile,
    _cloneBytes: (bytes: Uint8Array) => Uint8Array, options = this.options): EexecFile {
    const result = new EexecFile(options, cloneSource(this.source!), this.closeSource);
    result.initialized = this.initialized; result.hexadecimal = this.hexadecimal;
    result.ciphertext = [...this.ciphertext]; result.key = this.key; return this.copyState(result);
  }
}

class CompressionFile extends InputFile {
  private decoder: NativeFontPostScriptByteDecoder;
  readonly filterName: "LZWDecode" | "FlateDecode";
  readonly parameters: NativeFontPostScriptFilterParameters;
  constructor(source: NativeFontPostScriptFile, filterName: "LZWDecode" | "FlateDecode",
    parameters: NativeFontPostScriptFilterParameters, options: NativeFontPostScriptFileOptions) {
    super(options, source, parameters.CloseSource);
    this.filterName = filterName; this.parameters = parameters;
    this.decoder = createNativeFontPostScriptCompressionDecoder(() => source.readByte(), filterName, parameters, options);
  }
  protected readDecodedByte(): number { return this.decoder.readByte(); }
  cloneFile(cloneSource: (file: NativeFontPostScriptFile) => NativeFontPostScriptFile,
    _cloneBytes: (bytes: Uint8Array) => Uint8Array, options = this.options): CompressionFile {
    const source = cloneSource(this.source!), result = new CompressionFile(source, this.filterName, { ...this.parameters }, options);
    result.decoder = this.decoder.clone(() => source.readByte(), options); return this.copyState(result);
  }
}

/** Image codecs retain a decoded buffer after their first pull. Creation and
 * close remain lazy, and cloned glyph VMs own independent source positions. */
class ImageCodecFile extends InputFile {
  private output: Uint8Array | undefined;
  private encoded: Uint8Array | undefined;
  private outputOffset = 0;
  readonly filterName: "DCTDecode" | "CCITTFaxDecode" | "JBIG2Decode";
  readonly parameters: NativeFontPostScriptFilterParameters;
  constructor(source: NativeFontPostScriptFile, filterName: "DCTDecode" | "CCITTFaxDecode" | "JBIG2Decode",
    parameters: NativeFontPostScriptFilterParameters, options: NativeFontPostScriptFileOptions) {
    super(options, source, parameters.CloseSource);
    this.filterName = filterName; this.parameters = parameters;
  }
  protected readDecodedByte(): number {
    if (!this.output) {
      try {
        if (this.filterName === "CCITTFaxDecode") {
          this.output = decodeNativeCcittFaxSource(() => this.source!.readByte(), this.parameters, {
            signal: this.options.signal, limits: { maxOutputBytes: this.options.maxDecodedBytes ?? Number.MAX_SAFE_INTEGER }
          }).bytes;
        } else if (this.filterName === "JBIG2Decode") {
          // The Ghostscript extension consumes through source EOF, unlike DCT.
          // A SubFileDecode source supplies a boundary within executable font data.
          const encoded = this.encoded ??= readThroughSourceEof(this.source!, this.options.signal);
          const { width, height } = readJbig2Dimensions(encoded, this.options.signal);
          const outputBytes = Math.ceil(width / 8) * height;
          if (!Number.isSafeInteger(outputBytes) || outputBytes > (this.options.maxDecodedBytes ?? Number.MAX_SAFE_INTEGER)) throw limited();
          this.output = decodeBundledJbig2Sync({ codec: "jbig2", encoded, globals: new Uint8Array(), width, height,
            components: 1, bitsPerComponent: 1, imageMask: false, decodeParameters: {} }, Number.MAX_SAFE_INTEGER, this.options.signal).samples;
        } else {
          this.output = decodeBundledJpegSync(this.encoded ??= readJpegThroughEoi(this.source!, this.options.signal),
            this.parameters.ColorTransform === undefined ? {} : { ColorTransform: this.parameters.ColorTransform },
            { signal: this.options.signal, maxOutputBytes: this.options.maxDecodedBytes }).samples;
        }
      } catch (cause) {
        if (!(cause instanceof PdfError) || cause.code === "resource-limit" || cause.code === "aborted" || cause.code === "unsupported-font") throw cause;
        throw new PdfError("unsupported-font", `${this.filterName} font data could not be decoded: ${cause.message}`, {
          cause, details: { ...cause.details, reason: cause.details?.reason === "codec-not-prepared"
            ? "font-postscript-codec-not-prepared" : "font-postscript-image-filter", operator: this.filterName, postScriptError: "ioerror" }
        });
      }
    }
    return this.outputOffset < this.output.length ? this.output[this.outputOffset++] : -1;
  }
  cloneFile(cloneSource: (file: NativeFontPostScriptFile) => NativeFontPostScriptFile,
    cloneBytes: (bytes: Uint8Array) => Uint8Array, options = this.options): ImageCodecFile {
    const result = new ImageCodecFile(cloneSource(this.source!), this.filterName, { ...this.parameters }, options);
    result.output = this.output ? cloneBytes(this.output) : undefined;
    result.encoded = this.encoded ? cloneBytes(this.encoded) : undefined;
    result.outputOffset = this.outputOffset; return this.copyState(result);
  }
}

function readThroughSourceEof(source: NativeFontPostScriptFile, signal?: AbortSignal): Uint8Array {
  const bytes: number[] = [];
  for (let value; (value = source.readByte()) >= 0;) { throwIfAborted(signal); bytes.push(value); }
  return Uint8Array.from(bytes);
}

/** JBIG2Decode is a nonstandard PostScript filter; self-contained sequential
 * pages carry their dimensions in Page Information rather than PDF operands. */
function readJbig2Dimensions(source: Uint8Array, signal?: AbortSignal): { width: number; height: number } {
  const bytes = stripJbig2FileHeader(source);
  if (bytes !== source && !(source[8] & 1)) throw invalid("Random-access JBIG2 font images are unavailable.", "ioerror");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const require = (offset: number, length: number): void => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + length > bytes.length) throw invalid("Truncated JBIG2 font image segment.", "ioerror");
  };
  let offset = 0;
  while (offset < bytes.length) {
    throwIfAborted(signal);
    require(offset, 6);
    const number = view.getUint32(offset), flags = bytes[offset + 4], type = flags & 63;
    let count = bytes[offset + 5] >>> 5;
    offset += 6;
    if (count === 7) {
      require(offset - 1, 4); count = view.getUint32(offset - 1) & 0x1fffffff;
      offset += 3 + Math.ceil((count + 1) / 8);
    } else if (count === 5 || count === 6) throw invalid("Invalid JBIG2 font image reference flags.", "ioerror");
    offset += count * (number <= 256 ? 1 : number <= 65536 ? 2 : 4) + (flags & 64 ? 4 : 1);
    require(offset, 4);
    const length = view.getUint32(offset); offset += 4;
    if (type === 48) {
      require(offset, 19);
      const width = view.getUint32(offset), height = view.getUint32(offset + 4);
      if (!width || !height || height === 0xffffffff) throw invalid("Striped or empty JBIG2 font pages are unavailable.", "ioerror");
      return { width, height };
    }
    if (length === 0xffffffff) throw invalid("JBIG2 Page Information must precede unknown-length font image segments.", "ioerror");
    require(offset, length); offset += length;
  }
  throw invalid("The JBIG2 font image has no Page Information.", "ioerror");
}

/** JPEG APP/table payloads may contain FF D9, so marker lengths and entropy
 * byte stuffing must be respected instead of scanning for a byte pair. */
function readJpegThroughEoi(source: NativeFontPostScriptFile, signal?: AbortSignal): Uint8Array {
  const output: number[] = [];
  const read = (): number => {
    throwIfAborted(signal);
    const value = source.readByte();
    if (value < 0) throw invalid("DCTDecode font data ended before its JPEG EOI marker.", "ioerror");
    output.push(value); return value;
  };
  if (read() !== 255 || read() !== 216) throw invalid("DCTDecode font data has no JPEG SOI marker.", "ioerror");
  let entropy = false;
  while (true) {
    let marker: number;
    if (entropy) {
      if (read() !== 255) continue;
      do { marker = read(); } while (marker === 255);
      if (marker === 0 || (marker >= 208 && marker <= 215)) continue;
    } else {
      if (read() !== 255) throw invalid("DCTDecode encountered bytes outside a JPEG marker segment.", "ioerror");
      do { marker = read(); } while (marker === 255);
    }
    if (marker === 217) return Uint8Array.from(output);
    if (marker === 216 || marker === 0 || (marker >= 208 && marker <= 215)) throw invalid("DCTDecode encountered an invalid JPEG marker.", "ioerror");
    if (marker === 1) continue;
    const length = read() * 256 + read();
    if (length < 2) throw invalid("DCTDecode encountered an invalid JPEG segment length.", "ioerror");
    for (let i = 2; i < length; i++) read();
    // DNL can occur inside an entropy scan without ending it.
    if (marker !== 220) entropy = marker === 218;
  }
}

/** The caller memoizes sources and byte views to preserve its complete VM graph. */
export function cloneNativeFontPostScriptFile(file: NativeFontPostScriptFile,
  cloneSource: (file: NativeFontPostScriptFile) => NativeFontPostScriptFile,
  cloneBytes: (bytes: Uint8Array) => Uint8Array = bytes => bytes.slice(),
  options?: NativeFontPostScriptFileOptions): NativeFontPostScriptFile | null {
  return file instanceof InputFile ? file.cloneFile(cloneSource, cloneBytes, options) : null;
}

export function sourceNativeFontPostScriptFile(file: NativeFontPostScriptFile): NativeFontPostScriptFile | null {
  return file instanceof InputFile ? file.sourceFile() : null;
}

export function createNativeFontPostScriptEexecFile(source: NativeFontPostScriptFile | Uint8Array,
  options: NativeFontPostScriptFileOptions = {}): NativeFontPostScriptFile {
  return new EexecFile(options, source instanceof Uint8Array ? createNativeFontPostScriptMemoryFile(source, { signal: options.signal }) : source);
}

export function createNativeFontPostScriptFilter(source: NativeFontPostScriptFile | Uint8Array,
  name: string, parameters: NativeFontPostScriptFilterParameters = {},
  options: NativeFontPostScriptFileOptions = {}): NativeFontPostScriptFile {
  const input = source instanceof Uint8Array ? createNativeFontPostScriptMemoryFile(source, { signal: options.signal }) : source;
  switch (name) {
    case "ASCIIHexDecode": return new AsciiHexFile(options, input, parameters.CloseSource);
    case "ASCII85Decode": return new Ascii85File(options, input, parameters.CloseSource);
    case "RunLengthDecode": return new RunLengthFile(options, input, parameters.CloseSource);
    case "SubFileDecode": return new SubFile(input, parameters, options);
    case "LZWDecode": case "FlateDecode": return new CompressionFile(input, name, parameters, options);
    case "DCTDecode": case "CCITTFaxDecode": case "JBIG2Decode": return new ImageCodecFile(input, name, parameters, options);
    case "ReusableStreamDecode": {
      let decoded = input;
      const filters = typeof parameters.Filter === "string" ? [parameters.Filter] : parameters.Filter ?? [];
      for (let i = 0; i < filters.length; i++) {
        const decode = Array.isArray(parameters.DecodeParms) ? parameters.DecodeParms[i] : parameters.DecodeParms;
        decoded = createNativeFontPostScriptFilter(decoded, filters[i], { ...decode, CloseSource: false }, options);
      }
      const output: number[] = [];
      while (true) {
        const value = decoded.readByte(); if (value < 0) break;
        if (output.length >= (options.maxDecodedBytes ?? Number.MAX_SAFE_INTEGER)) throw limited();
        output.push(value);
      }
      return new MemoryFile(Uint8Array.from(output), options, true, input, parameters.CloseSource);
    }
    default: throw invalid(`PostScript font filter ${name} is unavailable.`, "filter");
  }
}

function prefix(bytes: readonly number[], marker: Uint8Array): boolean {
  if (bytes.length > marker.length) return false;
  return bytes.every((byte, index) => byte === marker[index]);
}
function white(byte: number): boolean { return byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32; }
function hex(byte: number): number { return byte >= 48 && byte <= 57 ? byte - 48 : byte >= 65 && byte <= 70 ? byte - 55 : byte >= 97 && byte <= 102 ? byte - 87 : -1; }
function invalid(message: string, operator: string): PdfError {
  return new PdfError("unsupported-font", message, { details: { reason: "font-postscript-file",
    postScriptError: operator === "filter" ? "undefined" : operator, ...(operator === "filter" ? { operator } : {}) } });
}
function limited(): PdfError {
  return new PdfError("resource-limit", "Font PostScript exceeds the configured decoded-file byte limit.",
    { details: { reason: "font-postscript-file-limit" } });
}
