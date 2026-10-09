import {
  HEADER_BYTES,
  CHUNK_RECORD_BYTES,
  EMPTY_CHUNK,
  GROUP_BYTES,
  SMALL_ENTRY_BYTES,
  groupKey,
  isPrecompressed,
  encoder,
  decoder,
  crc32,
  asBytes,
  hasHepSignature,
  hasLegacyZipSignature,
  align4,
  fail,
  requireZero,
  validateName,
  validateEntryLength,
  transformBytes
} from "./hepContainerShared";
import { BYTES_PER_ITEM, decodePaletteBytes } from "./hepContainerPalette";
import { bytePlaneVarintMaxLength, decodeBytePlaneVarints } from "./hepContainerIntegers";
import type { HepArchiveLoadOptions, HepArchiveWriteOptions, HepArchiveProgress, EntryRecord, ChunkRecord } from "./hepContainerShared";
import { waitForLoad } from "./loadCancellation";

export { crc32, hasHepSignature, hasLegacyZipSignature } from "./hepContainerShared";
export { encodeFloat32Palette, decodeFloat32Palette } from "./hepContainerPalette";
export type { HepArchiveLoadOptions, HepArchiveWriteOptions, HepArchiveProgress } from "./hepContainerShared";

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
    const version = view.getUint16(4, true);
    if (version !== 1 && version !== 2 && version !== 3) fail("unsupported container version.");
    if (view.getUint16(6, true) !== 0 || view.getUint32(24, true) !== 0 || view.getUint32(28, true) !== 0) {
      fail("unsupported header flags or reserved fields.");
    }
    const entryCount = view.getUint32(8, true);
    const chunkCount = view.getUint32(12, true);
    const indexLength = view.getUint32(16, true);
    const indexEnd = HEADER_BYTES + indexLength;
    if (indexLength % 4 !== 0 || indexEnd > bytes.length ||
        indexLength < chunkCount * CHUNK_RECORD_BYTES + entryCount * 20) fail("invalid index length.");
    if (crc32(bytes.subarray(HEADER_BYTES, indexEnd)) !== view.getUint32(20, true)) fail("index checksum mismatch.");
    const chunks: ChunkRecord[] = [];
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
      if (chunk.codec !== 0 && chunk.codec !== 1 && !(version >= 2 && chunk.codec === 2) && !(version === 3 && chunk.codec === 3)) {
        fail("unsupported chunk codec.");
      }
      if (chunk.codec === 2 && chunk.decodedLength % BYTES_PER_ITEM !== 0) {
        fail("palette chunk length must contain complete vec4 items.");
      }
      if (chunk.codec === 3) bytePlaneVarintMaxLength(chunk.decodedLength);
      if (chunk.offset % 4 !== 0 || chunk.offset < indexEnd || chunk.storedLength === 0 ||
          chunk.offset + chunk.storedLength > bytes.length) fail("invalid chunk offset or stored length.");
      if (chunk.decodedLength === 0) fail("invalid decoded chunk length.");
      if (chunk.codec === 0 && chunk.storedLength !== chunk.decodedLength) fail("stored chunk lengths differ.");
      chunks.push(chunk);
      cursor += CHUNK_RECORD_BYTES;
    }
    const entries: EntryRecord[] = [];
    const seenNames = new Set<string>();
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
      const maxInflatedLength = chunk.codec === 3 ? bytePlaneVarintMaxLength(chunk.decodedLength) : chunk.decodedLength;
      const inflated = chunk.codec === 0 ? stored : await transformBytes(stored, false, maxInflatedLength, options.signal);
      const decoded = chunk.codec === 2 ? decodePaletteBytes(inflated, chunk.decodedLength)
        : chunk.codec === 3 ? decodeBytePlaneVarints(inflated, chunk.decodedLength) : inflated;
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
    // Capture the same entries before yielding to load the optional writer.
    const sources = Object.values(this.files);
    const { generateHepArchive } = await waitForLoad(import("./hepContainerWriter"), options.signal);
    options.signal?.throwIfAborted();
    return generateHepArchive(sources, options, compression, onProgress);
  }
}
