/** HEP container versions 1–4. See docs/HEP_CONTAINER.md for the wire format. */
export const HEADER_BYTES = 32;
export const CHUNK_RECORD_BYTES = 20;
export const EMPTY_CHUNK = 0xffffffff;
/** Offsets and lengths in the container index are unsigned 32-bit fields. */
export const MAX_UINT32 = 0xffffffff;

export const GROUP_BYTES = 64 * 1024;
export const encoder = new TextEncoder();
export const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const crcTable = new Uint32Array(256);
for (let i = 0; i < crcTable.length; i += 1) {
  let value = i;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  crcTable[i] = value >>> 0;
}

export function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) value = crcTable[(value ^ bytes[i]) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

export function asBytes(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

export function hasHepSignature(input: ArrayBuffer | Uint8Array): boolean {
  const bytes = asBytes(input);
  return bytes.length >= 4 && bytes[0] === 0x48 && bytes[1] === 0x45 && bytes[2] === 0x50 && bytes[3] === 0;
}

export function hasLegacyZipSignature(input: ArrayBuffer | Uint8Array): boolean {
  const bytes = asBytes(input);
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
    ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6) ||
      (bytes[2] === 7 && bytes[3] === 8));
}

export interface HepArchiveLoadOptions {
  signal?: AbortSignal;
  /** Optional caller limits, checked from the index before decompression. */
  entryByteLimits?: Record<string, number>;
}

export interface HepArchiveWriteOptions {
  type: "blob" | "uint8array" | "arraybuffer";
  compression?: "DEFLATE" | "STORE";
  signal?: AbortSignal;
}

export interface HepArchiveProgress {
  percent: number;
}

export interface EntryRecord {
  name: string;
  nameBytes: Uint8Array;
  chunkId: number;
  offset: number;
  length: number;
}

export interface ChunkRecord {
  offset: number;
  storedLength: number;
  decodedLength: number;
  checksum: number;
  codec: number;
  entries: EntryRecord[];
}

export function align4(value: number): number {
  return Math.ceil(value / 4) * 4;
}

export function fail(message: string): never {
  throw new Error(`Invalid HEP container: ${message}`);
}

export function requireZero(bytes: Uint8Array, start: number, end: number, label: string): void {
  for (let offset = start; offset < end; offset += 1) {
    if (bytes[offset] !== 0) fail(`nonzero ${label}.`);
  }
}

export function validateName(name: string): Uint8Array {
  if (!name || name.includes("\0") || name.includes("\\") ||
      name.split("/").some(part => !part || part === "." || part === "..")) {
    fail(`invalid section name ${JSON.stringify(name)}.`);
  }
  const bytes = encoder.encode(name);
  if (bytes.length > 0xffff || decoder.decode(bytes) !== name) fail("invalid UTF-8 section name.");
  return bytes;
}

function entryLimit(name: string, limits?: Record<string, number>): number {
  let limit = MAX_UINT32;
  if (limits && Object.hasOwn(limits, name)) {
    const requested = limits[name];
    if (!Number.isSafeInteger(requested) || requested < 0) fail(`invalid byte limit for ${name}.`);
    limit = Math.min(limit, requested);
  }
  return limit;
}

export function validateEntryLength(name: string, length: number, limits?: Record<string, number>): void {
  if (!Number.isSafeInteger(length) || length < 0 || length > entryLimit(name, limits)) {
    fail(`section ${name} exceeds its decoded byte limit.`);
  }
}

/** Drain both sides concurrently and cancel both on errors or external aborts. */
export async function transformBytes(
  bytes: Uint8Array,
  compress: boolean,
  maxBytes: number,
  signal?: AbortSignal
): Promise<Uint8Array<ArrayBuffer>> {
  signal?.throwIfAborted();
  const Stream = compress ? globalThis.CompressionStream : globalThis.DecompressionStream;
  if (typeof Stream !== "function") {
    throw new Error(`HEP ${compress ? "compression" : "decompression"} requires native ` +
      `${compress ? "CompressionStream" : "DecompressionStream"}("deflate"). ` +
      "Use a current Node.js release or modern browser" +
      (compress ? ', or export with compression: "store".' : "."));
  }
  const stream = new Stream("deflate");
  const reader = stream.readable.getReader();
  const writer = stream.writable.getWriter();
  let failure: unknown;
  let failed = false;
  const stop = (reason: unknown): void => {
    if (!failed) { failed = true; failure = reason; }
    void reader.cancel(reason).catch(() => {});
    void writer.abort(reason).catch(() => {});
  };
  const onAbort = (): void => stop(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  const writing = (async () => {
    try {
      for (let offset = 0; offset < bytes.length; offset += GROUP_BYTES) {
        signal?.throwIfAborted();
        const part = bytes.subarray(offset, offset + GROUP_BYTES);
        await writer.write(part.buffer instanceof ArrayBuffer ? part as Uint8Array<ArrayBuffer> : new Uint8Array(part));
      }
      await writer.close();
    } catch (error) {
      stop(error);
    }
  })();
  try {
    const parts: Uint8Array[] = [];
    let length = 0;
    while (true) {
      signal?.throwIfAborted();
      const result = await reader.read();
      if (result.done) break;
      length += result.value.length;
      if (length > maxBytes) fail("decompressed output exceeds the declared chunk length or byte limit.");
      parts.push(result.value);
    }
    await writing;
    signal?.throwIfAborted();
    if (failed) throw failure;
    const output = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) { output.set(part, offset); offset += part.length; }
    return output;
  } catch (error) {
    stop(error);
    await writing;
    throw signal?.aborted ? signal.reason : error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
    writer.releaseLock();
  }
}

export const SMALL_ENTRY_BYTES = 4096;

export function groupKey(name: string): string | undefined {
  const slash = name.indexOf("/");
  if (name === "manifest.json" || name === "source.pdf" || slash < 0 ||
      name.startsWith("raster/") || name.startsWith("source/") || /\.pdf$/i.test(name)) return undefined;
  return name.slice(0, slash);
}

export function isPrecompressed(name: string): boolean {
  return /\.(webp|png)$/i.test(name);
}
