import { PdfError, throwIfAborted } from "./nativeTypes";
import type { NativeFontPostScriptProcedure } from "./nativeFontPostScript";
import type { NativeFontPostScriptFile, NativeFontPostScriptFileOptions } from "./nativeFontPostScriptFile";

export interface NativeFontPostScriptProcedureFileSnapshot {
  readonly procedure: NativeFontPostScriptProcedure;
  readonly chunk: Uint8Array;
  readonly chunkOffset: number;
  readonly position: number;
  readonly lookahead?: number;
  readonly closed: boolean;
  readonly ended: boolean;
}

/** The VM executes the procedure to its own task boundary, retaining its shared
 * operand/dictionary state and operation budget. It must return a readable string. */
export type NativeFontPostScriptProcedureSourceExecutor = (procedure: NativeFontPostScriptProcedure) => Uint8Array;

/** PLRM §3.13.1: pull one string only when the preceding string is exhausted;
 * an empty string is EOF. No host input or eager draining is involved. */
class ProcedureFile implements NativeFontPostScriptFile {
  private readonly procedure: NativeFontPostScriptProcedure;
  private readonly execute: NativeFontPostScriptProcedureSourceExecutor;
  private readonly options: NativeFontPostScriptFileOptions;
  private chunk: Uint8Array = new Uint8Array(0);
  private chunkOffset = 0;
  private position = 0;
  private lookahead: number | undefined;
  private isClosed = false;
  private ended = false;
  private pulling = false;

  constructor(procedure: NativeFontPostScriptProcedure, execute: NativeFontPostScriptProcedureSourceExecutor,
    options: NativeFontPostScriptFileOptions) {
    if (options.maxDecodedBytes !== undefined && (!Number.isSafeInteger(options.maxDecodedBytes) || options.maxDecodedBytes < 1)) {
      throw new RangeError("Invalid PostScript decoded-file byte limit.");
    }
    this.procedure = procedure; this.execute = execute; this.options = options;
  }

  get closed(): boolean { return this.isClosed; }

  private nextByte(): number {
    if (this.chunkOffset === this.chunk.length && !this.ended) {
      if (this.pulling) throw invalid("A PostScript procedure data source reads itself recursively.");
      this.pulling = true;
      try {
        const chunk = this.execute(this.procedure);
        if (!(chunk instanceof Uint8Array)) throw invalid("A PostScript procedure data source must return a string.", "typecheck");
        this.chunk = chunk; this.chunkOffset = 0;
        if (!chunk.length) this.ended = true;
      } finally { this.pulling = false; }
    }
    return this.chunkOffset < this.chunk.length ? this.chunk[this.chunkOffset++] : -1;
  }

  readByte(): number {
    throwIfAborted(this.options.signal);
    if (this.isClosed) return -1;
    const value = this.lookahead ?? this.nextByte(); this.lookahead = undefined;
    if (value < 0) { this.isClosed = true; return -1; }
    if (++this.position > (this.options.maxDecodedBytes ?? Number.MAX_SAFE_INTEGER)) {
      throw new PdfError("resource-limit", "The PostScript procedure data source exceeds the caller's decoded-byte allowance.",
        { details: { reason: "font-postscript-file-bytes" } });
    }
    return value;
  }

  peekByte(): number {
    throwIfAborted(this.options.signal);
    if (this.isClosed) return -1;
    const value = this.lookahead ??= this.nextByte();
    if (value < 0) this.isClosed = true;
    return value;
  }

  readInto(target: Uint8Array): number {
    let length = 0;
    while (length < target.length) { const byte = this.readByte(); if (byte < 0) break; target[length++] = byte; }
    return length;
  }

  readHexInto(target: Uint8Array): number {
    let length = 0, high = -1;
    while (length < target.length) {
      const byte = this.readByte(); if (byte < 0) break;
      const digit = byte >= 48 && byte <= 57 ? byte - 48 : byte >= 65 && byte <= 70 ? byte - 55 : byte >= 97 && byte <= 102 ? byte - 87 : -1;
      if (digit < 0) continue;
      if (high < 0) high = digit; else { target[length++] = high * 16 + digit; high = -1; }
    }
    return length;
  }

  readLineInto(target: Uint8Array): { readonly length: number; readonly complete: boolean } {
    let length = 0;
    while (true) {
      const byte = this.peekByte();
      if (byte < 0) { this.readByte(); return { length, complete: false }; }
      if (byte === 10 || byte === 13) {
        this.readByte(); if (byte === 13 && this.peekByte() === 10) this.readByte();
        return { length, complete: true };
      }
      if (length === target.length) throw invalid("The PostScript readline target is shorter than the line.", "rangecheck");
      target[length++] = this.readByte();
    }
  }

  bytesAvailable(): number { return -1; }
  tell(): number { throw invalid("A PostScript procedure data source is not positionable."); }
  seek(_offset: number): void { throw invalid("A PostScript procedure data source is not positionable."); }
  flush(): void { while (this.readByte() >= 0) { /* Pull only through source EOF. */ } }
  close(): void { this.isClosed = true; this.lookahead = undefined; }

  snapshot(): NativeFontPostScriptProcedureFileSnapshot {
    if (this.pulling) throw invalid("An active PostScript procedure pull cannot be cloned.");
    return { procedure: this.procedure, chunk: this.chunk, chunkOffset: this.chunkOffset, position: this.position,
      lookahead: this.lookahead, closed: this.isClosed, ended: this.ended };
  }
  restore(snapshot: NativeFontPostScriptProcedureFileSnapshot): void {
    if (!Number.isSafeInteger(snapshot.chunkOffset) || snapshot.chunkOffset < 0 || snapshot.chunkOffset > snapshot.chunk.length ||
      !Number.isSafeInteger(snapshot.position) || snapshot.position < 0) throw new RangeError("Invalid PostScript procedure-file snapshot.");
    this.chunk = snapshot.chunk; this.chunkOffset = snapshot.chunkOffset; this.position = snapshot.position;
    this.lookahead = snapshot.lookahead; this.isClosed = snapshot.closed; this.ended = snapshot.ended;
  }
}

export function createNativeFontPostScriptProcedureFile(procedure: NativeFontPostScriptProcedure,
  execute: NativeFontPostScriptProcedureSourceExecutor, options: NativeFontPostScriptFileOptions = {}): NativeFontPostScriptFile {
  return new ProcedureFile(procedure, execute, options);
}

export function snapshotNativeFontPostScriptProcedureFile(file: NativeFontPostScriptFile): NativeFontPostScriptProcedureFileSnapshot | null {
  return file instanceof ProcedureFile ? file.snapshot() : null;
}

export function restoreNativeFontPostScriptProcedureFile(snapshot: NativeFontPostScriptProcedureFileSnapshot,
  execute: NativeFontPostScriptProcedureSourceExecutor, options: NativeFontPostScriptFileOptions = {}): NativeFontPostScriptFile {
  const file = new ProcedureFile(snapshot.procedure, execute, options); file.restore(snapshot); return file;
}

function invalid(message: string, operator = "ioerror"): PdfError {
  return new PdfError("unsupported-font", message, { details: { reason: "font-postscript-file", operator } });
}
