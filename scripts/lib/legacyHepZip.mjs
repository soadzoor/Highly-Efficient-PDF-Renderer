// Development-only reader for the stored/DEFLATE ZIP subset emitted by the
// former HEP v6 writer. This is deliberately not a general-purpose ZIP reader.
import { createInflateRaw } from "node:zlib";

const MAX_ENTRIES = 8192;
const MAX_ENTRY_BYTES = 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function fail(message) {
  throw new Error(`Invalid legacy HEP ZIP: ${message}`);
}

function inflateEntry(bytes, expectedLength, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const inflater = createInflateRaw();
    const chunks = [];
    let length = 0;
    let settled = false;
    const finish = (error, output) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      if (error) {
        inflater.destroy();
        reject(error);
      } else {
        resolve(output);
      }
    };
    const abort = () => finish(signal.reason ?? new Error("Repack aborted"));
    signal?.addEventListener("abort", abort, { once: true });
    inflater.on("error", (error) => finish(error));
    inflater.on("data", (chunk) => {
      length += chunk.length;
      if (length > expectedLength) {
        finish(new Error("Invalid legacy HEP ZIP: DEFLATE output exceeds declared length"));
        return;
      }
      chunks.push(chunk);
    });
    inflater.on("end", () => {
      if (length !== expectedLength || inflater.bytesWritten !== bytes.length) {
        finish(new Error("Invalid legacy HEP ZIP: DEFLATE length or consumed input mismatch"));
        return;
      }
      finish(null, new Uint8Array(Buffer.concat(chunks, length)));
    });
    if (signal?.aborted) abort();
    else inflater.end(bytes);
  });
}

/** Decode and validate legacy sections without parsing the embedded PDF. */
export async function readLegacyHepZip(input, { crc32, signal } = {}) {
  if (typeof crc32 !== "function") throw new TypeError("A CRC32 implementation is required");
  signal?.throwIfAborted();
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) {
    fail("missing end record (ZIP comments and trailing bytes are unsupported)");
  }
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0 ||
      view.getUint16(end + 20, true) !== 0) fail("multi-disk archives and comments are unsupported");
  const entryCount = view.getUint16(end + 10, true);
  const indexLength = view.getUint32(end + 12, true);
  const indexOffset = view.getUint32(end + 16, true);
  if (entryCount === 0xffff || indexLength === 0xffffffff || indexOffset === 0xffffffff) {
    fail("ZIP64 is unsupported");
  }
  if (entryCount === 0 || entryCount > MAX_ENTRIES || indexLength > 16 * 1024 * 1024 ||
      entryCount !== view.getUint16(end + 8, true) || indexOffset + indexLength !== end) {
    fail("invalid central directory bounds or entry count");
  }
  const records = [];
  const names = new Set();
  let offset = indexOffset;
  let totalLength = 0;
  let rasterLength = 0;
  for (let i = 0; i < entryCount; i += 1) {
    signal?.throwIfAborted();
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) fail("invalid central record");
    const version = view.getUint16(offset + 6, true);
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const checksum = view.getUint32(offset + 16, true);
    const storedLength = view.getUint32(offset + 20, true);
    const decodedLength = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const disk = view.getUint16(offset + 34, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (version > 20 || (flags & ~0x800) !== 0 || (method !== 0 && method !== 8) || disk !== 0 ||
        extraLength !== 0 || commentLength !== 0) {
      fail("unsupported ZIP feature (encryption, descriptors, extra fields, comments, or codec)");
    }
    if (nameLength === 0 || offset + 46 + nameLength > end ||
        storedLength === 0xffffffff || localOffset === 0xffffffff || decodedLength > MAX_ENTRY_BYTES) {
      fail("invalid entry bounds or ZIP64 entry");
    }
    totalLength += decodedLength;
    if (totalLength > MAX_TOTAL_BYTES) fail("decoded archive exceeds 2 GiB");
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    if ((flags & 0x800) === 0 && nameBytes.some((byte) => byte >= 0x80)) {
      fail("non-ASCII filenames require the UTF-8 flag");
    }
    let name;
    try { name = utf8.decode(nameBytes); } catch { fail("invalid UTF-8 filename"); }
    const directory = name.endsWith("/");
    const components = (directory ? name.slice(0, -1) : name).split("/");
    if (name.includes("\\") || /[\u0000-\u001f\u007f:]/u.test(name) ||
        components.some((part) => part === "" || part === "." || part === "..") || names.has(name)) {
      fail("unsafe or duplicate filename");
    }
    names.add(name);
    const unixType = (externalAttributes >>> 16) & 0xf000;
    if ((unixType !== 0 && unixType !== (directory ? 0x4000 : 0x8000)) ||
        ((externalAttributes & 0x10) !== 0 && !directory)) fail("unsupported entry attributes");
    if (directory && (method !== 0 || storedLength !== 0 || decodedLength !== 0 || checksum !== 0)) {
      fail("directory entries must be empty and stored");
    }
    if (method === 0 && storedLength !== decodedLength) fail("stored length mismatch");
    if (name === "manifest.json" && decodedLength > MAX_MANIFEST_BYTES) fail("manifest exceeds 16 MiB");
    if ((name === "source/source.pdf" || name === "source.pdf") && decodedLength > 512 * 1024 * 1024) {
      fail("embedded source PDF exceeds 512 MiB");
    }
    if (name.startsWith("raster/")) {
      rasterLength += decodedLength;
      if (decodedLength > 768 * 1024 * 1024 || rasterLength > 1024 * 1024 * 1024) {
        fail("raster payload exceeds its decoded byte limit");
      }
    }
    if (localOffset + 30 > indexOffset || view.getUint32(localOffset, true) !== 0x04034b50) {
      fail("invalid local record");
    }
    // The corresponding fields through filename length have identical layouts
    // after the central directory's four-byte creator/version prefix.
    for (let field = 0; field < 22; field += 1) {
      if (bytes[localOffset + 4 + field] !== bytes[offset + 6 + field]) {
        fail("local and central metadata disagree");
      }
    }
    if (view.getUint16(localOffset + 26, true) !== nameLength ||
        view.getUint16(localOffset + 28, true) !== 0) fail("local name length or extra fields disagree");
    const dataOffset = localOffset + 30 + nameLength;
    const dataEnd = dataOffset + storedLength;
    if (dataEnd > indexOffset || !nameBytes.every((byte, j) => bytes[localOffset + 30 + j] === byte)) {
      fail("invalid local filename or payload bounds");
    }
    records.push({ name, directory, checksum, method, decodedLength, localOffset, dataOffset, dataEnd });
    offset += 46 + nameLength;
  }
  if (offset !== end) fail("central directory has extra or missing records");
  let localEnd = 0;
  for (const record of [...records].sort((a, b) => a.localOffset - b.localOffset)) {
    if (record.localOffset !== localEnd) fail("local records overlap or contain unexplained gaps");
    localEnd = record.dataEnd;
  }
  if (localEnd !== indexOffset) fail("unindexed bytes before central directory");

  const sections = new Map();
  for (const record of records) {
    signal?.throwIfAborted();
    if (record.directory) continue;
    const stored = bytes.subarray(record.dataOffset, record.dataEnd);
    const decoded = record.method === 0 ? stored : await inflateEntry(stored, record.decodedLength, signal);
    if (crc32(decoded) !== record.checksum) fail(`CRC32 mismatch for ${record.name}`);
    sections.set(record.name, decoded);
  }
  const manifestBytes = sections.get("manifest.json");
  if (!manifestBytes) fail("manifest.json is missing");
  let manifest;
  try { manifest = JSON.parse(utf8.decode(manifestBytes)); } catch { fail("invalid manifest JSON or UTF-8"); }
  if (manifest?.formatVersion !== 6) fail("only scene schema formatVersion 6 can be repacked");
  signal?.throwIfAborted();
  return sections;
}
