/** HEP container version 1. See docs/HEP_CONTAINER.md for the wire format. */
const HEADER_BYTES = 32;
const CHUNK_RECORD_BYTES = 20;
const EMPTY_CHUNK = 0xffffffff;
const MAX_RECORDS = 8192;
const MAX_INDEX_BYTES = 16 * 1024 * 1024;
const MAX_CHUNK_BYTES = 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * MAX_CHUNK_BYTES;
const SMALL_ENTRY_BYTES = 4096;
const GROUP_BYTES = 64 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
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

function asBytes(input: ArrayBuffer | Uint8Array): Uint8Array {
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
  /** Optional stricter limits, checked from the index before decompression. */
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

interface EntryRecord {
  name: string;
  nameBytes: Uint8Array;
  chunkId: number;
  offset: number;
  length: number;
}

interface ChunkRecord {
  offset: number;
  storedLength: number;
  decodedLength: number;
  checksum: number;
  codec: number;
  entries: EntryRecord[];
}

function align4(value: number): number {
  return Math.ceil(value / 4) * 4;
}

function fail(message: string): never {
  throw new Error(`Invalid HEP container: ${message}`);
}

function requireZero(bytes: Uint8Array, start: number, end: number, label: string): void {
  for (let offset = start; offset < end; offset += 1) {
    if (bytes[offset] !== 0) fail(`nonzero ${label}.`);
  }
}

function validateName(name: string): Uint8Array {
  if (!name || name.includes("\0") || name.includes("\\") ||
      name.split("/").some(part => !part || part === "." || part === "..")) {
    fail(`invalid section name ${JSON.stringify(name)}.`);
  }
  const bytes = encoder.encode(name);
  if (bytes.length > 0xffff || decoder.decode(bytes) !== name) fail("invalid UTF-8 section name.");
  return bytes;
}

function entryLimit(name: string, limits?: Record<string, number>): number {
  let limit = MAX_CHUNK_BYTES;
  if (name === "manifest.json") limit = 16 * 1024 * 1024;
  if (name === "source/source.pdf" || name === "source.pdf") limit = 512 * 1024 * 1024;
  if (name.startsWith("raster/")) limit = 768 * 1024 * 1024;
  if (limits && Object.hasOwn(limits, name)) {
    const requested = limits[name];
    if (!Number.isSafeInteger(requested) || requested < 0) fail(`invalid byte limit for ${name}.`);
    limit = Math.min(limit, requested);
  }
  return limit;
}

function validateEntryLength(name: string, length: number, limits?: Record<string, number>): void {
  if (!Number.isSafeInteger(length) || length < 0 || length > entryLimit(name, limits)) {
    fail(`section ${name} exceeds its decoded byte limit.`);
  }
}

function groupKey(name: string): string | undefined {
  const slash = name.indexOf("/");
  if (name === "manifest.json" || name === "source.pdf" || slash < 0 ||
      name.startsWith("raster/") || name.startsWith("source/") || /\.pdf$/i.test(name)) return undefined;
  return name.slice(0, slash);
}

function isPrecompressed(name: string): boolean {
  return /\.(webp|png)$/i.test(name);
}

/** Drain both sides concurrently and cancel both on errors or external aborts. */
async function transformBytes(
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

export class HepArchiveEntry {
  readonly dir = false;
  readonly name: string;
  readonly uncompressedSize: number;
  readonly compression?: "STORE" | "DEFLATE";
  private readonly readBytes: () => Promise<Uint8Array>;

  constructor(name: string, length: number, readBytes: () => Promise<Uint8Array>, compression?: "STORE" | "DEFLATE") {
    this.name = name;
    this.uncompressedSize = length;
    this.readBytes = readBytes;
    this.compression = compression;
  }

  async async(type: "string"): Promise<string>;
  async async(type: "uint8array"): Promise<Uint8Array>;
  async async(type: "arraybuffer"): Promise<ArrayBuffer>;
  async async(type: "string" | "uint8array" | "arraybuffer"): Promise<string | Uint8Array | ArrayBuffer> {
    const bytes = await this.readBytes();
    if (type === "string") return decoder.decode(bytes);
    // Each caller owns its result; mutating a grouped entry cannot poison cached siblings.
    if (type === "arraybuffer") return new Uint8Array(bytes).buffer;
    if (type === "uint8array") return new Uint8Array(bytes);
    throw new Error(`Unsupported HEP section output type: ${String(type)}`);
  }
}

export class HepArchive {
  readonly files: Record<string, HepArchiveEntry> = Object.create(null) as Record<string, HepArchiveEntry>;

  file(name: string): HepArchiveEntry | null;
  file(name: string, data: Uint8Array | ArrayBuffer | string, options?: { compression?: "STORE" | "DEFLATE" }): this;
  file(name: string, data?: Uint8Array | ArrayBuffer | string, options?: { compression?: "STORE" | "DEFLATE" }): this | HepArchiveEntry | null {
    if (data === undefined) return this.files[name] ?? null;
    validateName(name);
    const bytes = typeof data === "string" ? encoder.encode(data) : asBytes(data);
    validateEntryLength(name, bytes.length);
    if (options?.compression !== undefined && options.compression !== "STORE" && options.compression !== "DEFLATE") {
      throw new Error("HEP section compression must be STORE or DEFLATE.");
    }
    if (!Object.hasOwn(this.files, name) && Object.keys(this.files).length >= MAX_RECORDS) fail("too many sections.");
    this.files[name] = new HepArchiveEntry(name, bytes.length, async () => bytes, options?.compression);
    return this;
  }

  remove(name: string): this {
    delete this.files[name];
    return this;
  }

  static async loadAsync(input: ArrayBuffer | Uint8Array, options: HepArchiveLoadOptions = {}): Promise<HepArchive> {
    options.signal?.throwIfAborted();
    const bytes = asBytes(input);
    if (hasLegacyZipSignature(bytes)) {
      throw new Error("Legacy ZIP-based HEP containers are no longer supported. " +
        "Repack the file with scripts/repack-heps.mjs or regenerate it from the original PDF.");
    }
    if (!hasHepSignature(bytes) || bytes.length < HEADER_BYTES) fail("missing or truncated HEP header.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint16(4, true) !== 1) fail("unsupported container version.");
    if (view.getUint16(6, true) !== 0 || view.getUint32(24, true) !== 0 || view.getUint32(28, true) !== 0) {
      fail("unsupported header flags or reserved fields.");
    }
    const entryCount = view.getUint32(8, true);
    const chunkCount = view.getUint32(12, true);
    const indexLength = view.getUint32(16, true);
    const indexEnd = HEADER_BYTES + indexLength;
    if (entryCount > MAX_RECORDS || chunkCount > MAX_RECORDS) fail("too many sections or chunks.");
    if (indexLength > MAX_INDEX_BYTES || indexLength % 4 !== 0 || indexEnd > bytes.length ||
        indexLength < chunkCount * CHUNK_RECORD_BYTES + entryCount * 20) fail("invalid index length.");
    if (crc32(bytes.subarray(HEADER_BYTES, indexEnd)) !== view.getUint32(20, true)) fail("index checksum mismatch.");
    const chunks: ChunkRecord[] = [];
    let totalDecoded = 0;
    let cursor = HEADER_BYTES;
    for (let index = 0; index < chunkCount; index += 1) {
      const chunk: ChunkRecord = {
        offset: view.getUint32(cursor, true),
        storedLength: view.getUint32(cursor + 4, true),
        decodedLength: view.getUint32(cursor + 8, true),
        checksum: view.getUint32(cursor + 12, true),
        codec: bytes[cursor + 16],
        entries: []
      };
      requireZero(bytes, cursor + 17, cursor + 20, "chunk reserved fields");
      if (chunk.codec !== 0 && chunk.codec !== 1) fail("unsupported chunk codec.");
      if (chunk.offset % 4 !== 0 || chunk.offset < indexEnd || chunk.storedLength === 0 ||
          chunk.offset + chunk.storedLength > bytes.length) fail("invalid chunk offset or stored length.");
      if (chunk.decodedLength === 0 || chunk.decodedLength > MAX_CHUNK_BYTES) fail("invalid decoded chunk length.");
      if (chunk.codec === 0 && chunk.storedLength !== chunk.decodedLength) fail("stored chunk lengths differ.");
      totalDecoded += chunk.decodedLength;
      if (totalDecoded > MAX_TOTAL_BYTES) fail("aggregate decoded byte limit exceeded.");
      chunks.push(chunk);
      cursor += CHUNK_RECORD_BYTES;
    }
    const entries: EntryRecord[] = [];
    const seenNames = new Set<string>();
    let rasterBytes = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (cursor + 16 > indexEnd) fail("truncated section record.");
      const nameLength = view.getUint16(cursor, true);
      if (view.getUint16(cursor + 2, true) !== 0) fail("nonzero section reserved field.");
      if (!nameLength || cursor + 16 + nameLength > indexEnd) fail("invalid section name length.");
      const nameBytes = bytes.subarray(cursor + 16, cursor + 16 + nameLength);
      let name: string;
      try { name = decoder.decode(nameBytes); } catch { fail("invalid UTF-8 section name."); }
      validateName(name);
      if (seenNames.has(name)) fail(`duplicate section ${name}.`);
      seenNames.add(name);
      const entry: EntryRecord = {
        name, nameBytes, chunkId: view.getUint32(cursor + 4, true),
        offset: view.getUint32(cursor + 8, true), length: view.getUint32(cursor + 12, true)
      };
      validateEntryLength(name, entry.length, options.entryByteLimits);
      if (name.startsWith("raster/")) rasterBytes += entry.length;
      if (rasterBytes > MAX_CHUNK_BYTES) fail("aggregate raster byte limit exceeded.");
      if (entry.length === 0) {
        if (entry.chunkId !== EMPTY_CHUNK || entry.offset !== 0) fail("invalid empty section reference.");
      } else {
        const chunk = chunks[entry.chunkId];
        if (!chunk || entry.offset % 4 !== 0 || entry.offset + entry.length > chunk.decodedLength) {
          fail("invalid section chunk reference or range.");
        }
        chunk.entries.push(entry);
      }
      entries.push(entry);
      const nextCursor = align4(cursor + 16 + nameLength);
      if (nextCursor > indexEnd) fail("truncated section padding.");
      requireZero(bytes, cursor + 16 + nameLength, nextCursor, "section padding");
      cursor = nextCursor;
    }
    if (cursor !== indexEnd) fail("unexpected trailing index bytes.");
    let storedEnd = indexEnd;
    for (const chunk of [...chunks].sort((a, b) => a.offset - b.offset)) {
      if (chunk.offset !== align4(storedEnd)) fail("overlapping chunks or unexpected payload gaps.");
      requireZero(bytes, storedEnd, chunk.offset, "payload alignment padding");
      storedEnd = chunk.offset + chunk.storedLength;
      if (chunk.entries.length === 0) fail("unreferenced chunk.");
      chunk.entries.sort((a, b) => a.offset - b.offset);
      if (chunk.entries.length === 1) {
        const entry = chunk.entries[0];
        if (entry.offset !== 0 || entry.length !== chunk.decodedLength) fail("standalone section must cover its complete chunk.");
      } else {
        const key = groupKey(chunk.entries[0].name);
        if (key === undefined || chunk.decodedLength > GROUP_BYTES) fail("invalid grouped chunk.");
        let decodedEnd = 0;
        for (const entry of chunk.entries) {
          if (entry.length > SMALL_ENTRY_BYTES || groupKey(entry.name) !== key || isPrecompressed(entry.name) ||
              entry.offset !== align4(decodedEnd)) fail("overlapping sections or invalid grouped section layout.");
          decodedEnd = entry.offset + entry.length;
        }
        if (decodedEnd !== chunk.decodedLength) fail("unexpected trailing grouped bytes.");
      }
    }
    if (bytes.length !== align4(storedEnd)) fail("unexpected or truncated trailing payload bytes.");
    requireZero(bytes, storedEnd, bytes.length, "final payload padding");
    const cache = new Map<number, Promise<Uint8Array>>();
    const decodeChunk = async (chunk: ChunkRecord): Promise<Uint8Array> => {
      options.signal?.throwIfAborted();
      const stored = bytes.subarray(chunk.offset, chunk.offset + chunk.storedLength);
      const decoded = chunk.codec === 0 ? stored : await transformBytes(stored, false, chunk.decodedLength, options.signal);
      options.signal?.throwIfAborted();
      if (decoded.length !== chunk.decodedLength) fail("decoded chunk length mismatch.");
      if (crc32(decoded) !== chunk.checksum) fail("chunk checksum mismatch.");
      let end = 0;
      for (const entry of chunk.entries) {
        requireZero(decoded, end, entry.offset, "group alignment padding");
        end = entry.offset + entry.length;
      }
      return decoded;
    };
    const archive = new HepArchive();
    for (const entry of entries) {
      archive.files[entry.name] = new HepArchiveEntry(entry.name, entry.length, async () => {
        options.signal?.throwIfAborted();
        if (entry.chunkId === EMPTY_CHUNK) return new Uint8Array(0);
        const chunk = chunks[entry.chunkId];
        let decoded: Uint8Array;
        if (chunk.entries.length > 1) {
          let pending = cache.get(entry.chunkId);
          if (!pending) { pending = decodeChunk(chunk); cache.set(entry.chunkId, pending); }
          decoded = await pending;
        } else {
          decoded = await decodeChunk(chunk);
        }
        options.signal?.throwIfAborted();
        return decoded.subarray(entry.offset, entry.offset + entry.length);
      });
    }
    return archive;
  }

  async generateAsync(options: HepArchiveWriteOptions & { type: "blob" }, onProgress?: (progress: HepArchiveProgress) => void): Promise<Blob>;
  async generateAsync(options: HepArchiveWriteOptions & { type: "uint8array" }, onProgress?: (progress: HepArchiveProgress) => void): Promise<Uint8Array>;
  async generateAsync(options: HepArchiveWriteOptions & { type: "arraybuffer" }, onProgress?: (progress: HepArchiveProgress) => void): Promise<ArrayBuffer>;
  async generateAsync(options: HepArchiveWriteOptions, onProgress?: (progress: HepArchiveProgress) => void): Promise<Blob | Uint8Array | ArrayBuffer> {
    options.signal?.throwIfAborted();
    if ("compressionLevel" in options || "compressionOptions" in options) {
      throw new Error("HEP native compression does not support compressionLevel or compressionOptions; use compression: DEFLATE or STORE.");
    }
    const compression = options.compression ?? "DEFLATE";
    if (compression !== "DEFLATE" && compression !== "STORE") throw new Error("HEP compression must be DEFLATE or STORE.");
    if (options.type !== "blob" && options.type !== "uint8array" && options.type !== "arraybuffer") {
      throw new Error(`Unsupported HEP output type: ${String(options.type)}`);
    }
    onProgress?.({ percent: 0 });
    type WriteChunk = { entries: { record: EntryRecord; source: HepArchiveEntry }[]; length: number; store: boolean };
    const entries: EntryRecord[] = [];
    const writeChunks: WriteChunk[] = [];
    const openGroups = new Map<string, number>();
    let indexLength = 0;
    let aggregate = 0;
    let rasterBytes = 0;
    for (const source of Object.values(this.files)) {
      options.signal?.throwIfAborted();
      const nameBytes = validateName(source.name);
      validateEntryLength(source.name, source.uncompressedSize);
      if (source.name.startsWith("raster/")) rasterBytes += source.uncompressedSize;
      if (rasterBytes > MAX_CHUNK_BYTES) fail("aggregate raster byte limit exceeded.");
      const record: EntryRecord = { name: source.name, nameBytes, chunkId: EMPTY_CHUNK, offset: 0, length: source.uncompressedSize };
      entries.push(record);
      indexLength += align4(16 + nameBytes.length);
      if (indexLength > MAX_INDEX_BYTES) fail("index byte limit exceeded.");
      if (!record.length) continue;
      const store = compression === "STORE" || source.compression === "STORE" || isPrecompressed(source.name);
      const prefix = !isPrecompressed(source.name) && record.length <= SMALL_ENTRY_BYTES ? groupKey(source.name) : undefined;
      // A per-section STORE override must not be lost when sharing a chunk.
      const key = prefix === undefined ? undefined : `${prefix}:${store ? "store" : "deflate"}`;
      let chunkId = key === undefined ? undefined : openGroups.get(key);
      let chunk = chunkId === undefined ? undefined : writeChunks[chunkId];
      if (chunk && align4(chunk.length) + record.length > GROUP_BYTES) chunk = undefined;
      if (!chunk) {
        chunkId = writeChunks.length;
        chunk = { entries: [], length: 0, store };
        writeChunks.push(chunk);
        if (key !== undefined) openGroups.set(key, chunkId);
      }
      record.chunkId = chunkId!;
      record.offset = align4(chunk.length);
      aggregate += record.offset + record.length - chunk.length;
      chunk.length = record.offset + record.length;
      chunk.entries.push({ record, source });
      if (aggregate > MAX_TOTAL_BYTES) fail("aggregate decoded byte limit exceeded.");
    }
    indexLength += writeChunks.length * CHUNK_RECORD_BYTES;
    if (entries.length > MAX_RECORDS || writeChunks.length > MAX_RECORDS) fail("too many sections or chunks.");
    if (indexLength > MAX_INDEX_BYTES) fail("index byte limit exceeded.");
    const payloads: Uint8Array[] = [];
    const chunks: ChunkRecord[] = [];
    let outputLength = HEADER_BYTES + indexLength;
    let processed = 0;
    for (const chunk of writeChunks) {
      options.signal?.throwIfAborted();
      let decoded: Uint8Array;
      if (chunk.entries.length === 1) {
        decoded = await chunk.entries[0].source.async("uint8array");
      } else {
        decoded = new Uint8Array(chunk.length);
        for (const { record, source } of chunk.entries) {
          const entryBytes = await source.async("uint8array");
          if (entryBytes.length !== record.length) fail("section length changed during writing.");
          decoded.set(entryBytes, record.offset);
          options.signal?.throwIfAborted();
        }
      }
      if (decoded.length !== chunk.length) fail("section length changed during writing.");
      options.signal?.throwIfAborted();
      let stored = decoded;
      let codec = 0;
      if (!chunk.store) {
        const compressed = await transformBytes(decoded, true, MAX_CHUNK_BYTES + 1024 * 1024, options.signal);
        if (compressed.length < decoded.length) { stored = compressed; codec = 1; }
      }
      chunks.push({ offset: outputLength, storedLength: stored.length, decodedLength: decoded.length,
        checksum: crc32(decoded), codec, entries: chunk.entries.map(entry => entry.record) });
      payloads.push(stored);
      outputLength = align4(outputLength + stored.length);
      processed += chunk.length;
      onProgress?.({ percent: aggregate ? Math.min(99, processed / aggregate * 99) : 99 });
    }
    if (outputLength > 0xffffffff) fail("container exceeds the 32-bit offset limit.");
    const headerIndex = new Uint8Array(HEADER_BYTES + indexLength);
    headerIndex.set([0x48, 0x45, 0x50, 0]);
    const view = new DataView(headerIndex.buffer);
    view.setUint16(4, 1, true);
    view.setUint32(8, entries.length, true);
    view.setUint32(12, chunks.length, true);
    view.setUint32(16, indexLength, true);
    let cursor = HEADER_BYTES;
    for (const chunk of chunks) {
      view.setUint32(cursor, chunk.offset, true);
      view.setUint32(cursor + 4, chunk.storedLength, true);
      view.setUint32(cursor + 8, chunk.decodedLength, true);
      view.setUint32(cursor + 12, chunk.checksum, true);
      view.setUint8(cursor + 16, chunk.codec);
      cursor += CHUNK_RECORD_BYTES;
    }
    for (const entry of entries) {
      view.setUint16(cursor, entry.nameBytes.length, true);
      view.setUint32(cursor + 4, entry.chunkId, true);
      view.setUint32(cursor + 8, entry.offset, true);
      view.setUint32(cursor + 12, entry.length, true);
      headerIndex.set(entry.nameBytes, cursor + 16);
      cursor += align4(16 + entry.nameBytes.length);
    }
    view.setUint32(20, crc32(headerIndex.subarray(HEADER_BYTES)), true);
    const parts: Uint8Array<ArrayBuffer>[] = [headerIndex];
    for (const payload of payloads) {
      // All writer payloads are newly allocated ArrayBuffer-backed arrays.
      parts.push(payload as Uint8Array<ArrayBuffer>);
      const padding = align4(payload.length) - payload.length;
      if (padding) parts.push(new Uint8Array(padding));
    }
    options.signal?.throwIfAborted();
    let result: Blob | Uint8Array | ArrayBuffer;
    if (options.type === "blob") result = new Blob(parts, { type: "application/x-hep" });
    else {
      const bytes = new Uint8Array(outputLength);
      cursor = 0;
      for (const part of parts) { bytes.set(part, cursor); cursor += part.length; }
      result = options.type === "arraybuffer" ? bytes.buffer : bytes;
    }
    onProgress?.({ percent: 100 });
    options.signal?.throwIfAborted();
    return result;
  }
}
