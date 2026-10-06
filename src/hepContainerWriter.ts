import {
  HEADER_BYTES,
  CHUNK_RECORD_BYTES,
  EMPTY_CHUNK,
  MAX_RECORDS,
  MAX_INDEX_BYTES,
  MAX_CHUNK_BYTES,
  MAX_TOTAL_BYTES,
  GROUP_BYTES,
  SMALL_ENTRY_BYTES,
  groupKey,
  isPrecompressed,
  crc32,
  align4,
  fail,
  validateName,
  validateEntryLength,
  transformBytes
} from "./hepContainerShared";
import { encodePaletteBytes } from "./hepContainerPalette";
import type { HepArchiveEntry, HepArchiveWriteOptions, HepArchiveProgress } from "./hepContainer";
import type { EntryRecord, ChunkRecord } from "./hepContainerShared";

/** Serialize an archive only when generateAsync is called. */
export async function generateHepArchive(
  sources: readonly HepArchiveEntry[],
  options: HepArchiveWriteOptions,
  compression: "DEFLATE" | "STORE",
  onProgress?: (progress: HepArchiveProgress) => void
): Promise<Blob | Uint8Array | ArrayBuffer> {
  type WriteChunk = { entries: { record: EntryRecord; source: HepArchiveEntry }[]; length: number; store: boolean };
  const entries: EntryRecord[] = [];
  const writeChunks: WriteChunk[] = [];
  const openGroups = new Map<string, number>();
  let indexLength = 0;
  let aggregate = 0;
  let rasterBytes = 0;
  for (const source of sources) {
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
      // This changes only the physical chunk codec: section names, decoded
      // bytes, checksum and scene manifest are identical. Keeping the chunk
      // layout fixed makes the padded byte comparison a whole-file guarantee.
      if (chunk.entries.length === 1 && isPaletteCandidate(chunk.entries[0].record.name)) {
        const palette = encodePaletteBytes(decoded);
        if (palette) {
          const packed = await transformBytes(palette, true, MAX_CHUNK_BYTES + 1024 * 1024, options.signal);
          if (align4(packed.length) < align4(stored.length)) { stored = packed; codec = 2; }
        }
      }
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
  view.setUint16(4, chunks.some(chunk => chunk.codec === 2) ? 2 : 1, true);
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

function isPaletteCandidate(name: string): boolean {
  return name === "textures/stroke-styles.f32" || name === "textures/stroke-styles.f32cm";
}

