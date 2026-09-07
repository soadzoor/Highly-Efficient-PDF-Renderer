import {
  importNativeCidToUnicodeShard,
  isNativeCidToUnicodeCollection,
  NATIVE_CID_TO_UNICODE_METADATA,
  type NativeCidToUnicodeCollection
} from "./cmaps/unicodeGenerated/registry";
import { PdfError, throwIfAborted } from "./nativeTypes";

const SEQUENCE_TOKEN = 0x8000_0000;
const MAX_UNICODE_SCALAR_TOKEN = 0x11_0000;
const MAX_CID = 0xffff;
const MAX_SHARD_BYTES = 2 * 1024 * 1024;
const MAX_SEQUENCE_CODE_UNITS = 256;

export interface NativeCidSystemInfo {
  readonly registry: string;
  readonly ordering: string;
  readonly supplement: number;
}

export interface NativeCidToUnicodeShard {
  readonly systemInfo: Readonly<NativeCidSystemInfo>;
  readonly maxCid: number;
  readonly mappingCount: number;
  unicodeForCid(cid: number): string | null;
}

const shardCache = new Map<
  NativeCidToUnicodeCollection,
  Promise<NativeCidToUnicodeShard>
>();

/** Package-relative provenance manifest emitted beside the lazy HCU1 shards. */
export const NATIVE_CID_TO_UNICODE_MANIFEST_URL = new URL(
  "./cmaps/unicodeGenerated/manifest.json?no-inline",
  import.meta.url
);

/** Return the official bundled collection for a validated descendant ROS. */
export function nativeCidToUnicodeCollection(
  systemInfo: Readonly<NativeCidSystemInfo>
): NativeCidToUnicodeCollection | null {
  return systemInfo.registry === "Adobe" && isNativeCidToUnicodeCollection(systemInfo.ordering)
    ? systemInfo.ordering
    : null;
}

/** Lazily load and strictly decode one Adobe CID-to-Unicode mapping resource. */
export async function loadNativeCidToUnicode(
  collection: NativeCidToUnicodeCollection,
  signal?: AbortSignal
): Promise<NativeCidToUnicodeShard> {
  throwIfAborted(signal);
  if (!isNativeCidToUnicodeCollection(collection)) {
    throw new PdfError(
      "unsupported-font",
      `CID-to-Unicode collection Adobe-${String(collection)} is not bundled.`,
      { details: { reason: "font-cid-unicode-not-bundled", collection: String(collection) } }
    );
  }
  let pending = shardCache.get(collection);
  if (!pending) {
    pending = importNativeCidToUnicodeShard(collection)
      .then((encoded) => decodeShard(collection, encoded))
      .catch((error: unknown) => {
        shardCache.delete(collection);
        if (error instanceof PdfError) throw error;
        throw new PdfError(
          "unsupported-font",
          `Bundled CID-to-Unicode collection Adobe-${collection} could not be loaded.`,
          {
            cause: error,
            details: { reason: "font-cid-unicode-shard-load", collection }
          }
        );
      });
    shardCache.set(collection, pending);
  }
  const shard = await pending;
  throwIfAborted(signal);
  return shard;
}

function decodeShard(
  collection: NativeCidToUnicodeCollection,
  encoded: string
): NativeCidToUnicodeShard {
  const metadata = NATIVE_CID_TO_UNICODE_METADATA[collection];
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(encoded);
  } catch (cause) {
    throw new PdfError(
      "unsupported-font",
      `Bundled CID-to-Unicode collection Adobe-${collection} has invalid base64 data.`,
      {
        cause,
        details: { reason: "font-cid-unicode-shard-invalid", collection }
      }
    );
  }
  if (bytes.byteLength > MAX_SHARD_BYTES || bytes.byteLength !== metadata.shardByteLength) {
    throw malformedShard(collection, "byte length does not match the generated registry");
  }
  const reader = new ShardReader(collection, bytes);
  if (
    reader.readByte() !== 0x48 || reader.readByte() !== 0x43 ||
    reader.readByte() !== 0x55 || reader.readByte() !== 0x31
  ) {
    throw malformedShard(collection, "magic/version is not HCU1");
  }
  const registry = reader.readAscii(reader.readVarUint());
  const ordering = reader.readAscii(reader.readVarUint());
  const supplement = reader.readVarUint();
  const maxCid = reader.readVarUint();
  const declaredMappingCount = reader.readVarUint();
  const tableByteLength = reader.readVarUint();
  if (
    registry !== metadata.registry || ordering !== metadata.ordering ||
    supplement !== metadata.supplement || maxCid !== metadata.maxCid ||
    declaredMappingCount !== metadata.mappingCount
  ) {
    throw malformedShard(collection, "identity or mapping metadata does not match the registry");
  }
  if (maxCid > MAX_CID || tableByteLength !== (maxCid + 1) * 4) {
    throw malformedShard(collection, "dense CID token table has an invalid size");
  }
  const tokens = new Uint32Array(maxCid + 1);
  for (let cid = 0; cid <= maxCid; cid += 1) tokens[cid] = reader.readUint32();
  const poolByteLength = reader.readVarUint();
  const poolBytes = reader.readBytes(poolByteLength);
  if (!reader.done) throw malformedShard(collection, "contains trailing bytes");

  const sequences = decodeStringPool(collection, poolBytes);
  const referencedSequences = new Set<number>();
  let mappingCount = 0;
  for (const token of tokens) {
    if (token === 0) continue;
    mappingCount += 1;
    if ((token & SEQUENCE_TOKEN) !== 0) {
      const offset = token & ~SEQUENCE_TOKEN;
      if (!sequences.has(offset)) {
        throw malformedShard(collection, "CID token references an invalid string-pool offset");
      }
      referencedSequences.add(offset);
      continue;
    }
    const scalar = token - 1;
    if (
      token > MAX_UNICODE_SCALAR_TOKEN ||
      (scalar >= 0xd800 && scalar <= 0xdfff)
    ) {
      throw malformedShard(collection, "CID token is not a Unicode scalar or string reference");
    }
  }
  if (mappingCount !== declaredMappingCount || referencedSequences.size !== sequences.size) {
    throw malformedShard(collection, "mapping total or string-pool references are inconsistent");
  }
  const systemInfo = Object.freeze({ registry, ordering, supplement });
  return Object.freeze({
    systemInfo,
    maxCid,
    mappingCount,
    unicodeForCid(cid: number): string | null {
      if (!Number.isSafeInteger(cid) || cid < 0 || cid > MAX_CID) {
        throw new RangeError("CID-to-Unicode lookup is outside the 16-bit CID space.");
      }
      if (cid > maxCid) return null;
      const token = tokens[cid];
      if (token === 0) return null;
      if ((token & SEQUENCE_TOKEN) !== 0) {
        return sequences.get(token & ~SEQUENCE_TOKEN) ?? null;
      }
      return String.fromCodePoint(token - 1);
    }
  });
}

function decodeStringPool(
  collection: NativeCidToUnicodeCollection,
  bytes: Uint8Array
): ReadonlyMap<number, string> {
  const reader = new ShardReader(collection, bytes);
  const result = new Map<number, string>();
  while (!reader.done) {
    const offset = reader.position;
    const codeUnitCount = reader.readVarUint();
    if (codeUnitCount < 2 || codeUnitCount > MAX_SEQUENCE_CODE_UNITS) {
      throw malformedShard(collection, "string-pool sequence length is invalid");
    }
    const units = new Array<number>(codeUnitCount);
    for (let index = 0; index < units.length; index += 1) units[index] = reader.readUint16();
    validateUtf16(collection, units);
    const value = String.fromCharCode(...units);
    if ([...value].length < 2) {
      throw malformedShard(collection, "string-pool entry does not contain a Unicode sequence");
    }
    result.set(offset, value);
  }
  return result;
}

function validateUtf16(collection: NativeCidToUnicodeCollection, units: readonly number[]): void {
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = units[++index];
      if (low === undefined || low < 0xdc00 || low > 0xdfff) {
        throw malformedShard(collection, "string pool contains an unpaired high surrogate");
      }
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw malformedShard(collection, "string pool contains an unpaired low surrogate");
    }
  }
}

class ShardReader {
  private offset = 0;
  private readonly collection: NativeCidToUnicodeCollection;
  private readonly bytes: Uint8Array;

  constructor(collection: NativeCidToUnicodeCollection, bytes: Uint8Array) {
    this.collection = collection;
    this.bytes = bytes;
  }

  get done(): boolean {
    return this.offset === this.bytes.byteLength;
  }

  get position(): number {
    return this.offset;
  }

  readByte(): number {
    if (this.offset >= this.bytes.byteLength) {
      throw malformedShard(this.collection, "is truncated");
    }
    return this.bytes[this.offset++];
  }

  readUint16(): number {
    return this.readByte() * 0x100 + this.readByte();
  }

  readUint32(): number {
    return (
      this.readByte() * 0x1_000000 + this.readByte() * 0x1_0000 +
      this.readByte() * 0x100 + this.readByte()
    ) >>> 0;
  }

  readVarUint(): number {
    let result = 0;
    for (let index = 0; index < 5; index += 1) {
      const byte = this.readByte();
      result += (byte & 0x7f) * (2 ** (index * 7));
      if ((byte & 0x80) === 0) {
        if (result > 0xffff_ffff) throw malformedShard(this.collection, "varint exceeds uint32");
        return result;
      }
    }
    throw malformedShard(this.collection, "varint exceeds five bytes");
  }

  readAscii(length: number): string {
    if (length < 1 || length > 127 || length > this.bytes.byteLength - this.offset) {
      throw malformedShard(this.collection, "identity string has an invalid length");
    }
    let value = "";
    for (let index = 0; index < length; index += 1) {
      const byte = this.readByte();
      if (byte < 0x21 || byte > 0x7e) {
        throw malformedShard(this.collection, "identity string is not printable ASCII");
      }
      value += String.fromCharCode(byte);
    }
    return value;
  }

  readBytes(length: number): Uint8Array {
    if (length > this.bytes.byteLength - this.offset) {
      throw malformedShard(this.collection, "is truncated");
    }
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
}

function decodeBase64(value: string): Uint8Array {
  if (value.length === 0 || (value.length & 3) !== 0) {
    throw new Error("HCU1 base64 length is invalid.");
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  if (value.length / 4 * 3 - padding > MAX_SHARD_BYTES) {
    throw new Error("HCU1 base64 exceeds the bundled shard ceiling.");
  }
  const output = new Uint8Array((value.length / 4) * 3 - padding);
  let outputOffset = 0;
  for (let offset = 0; offset < value.length; offset += 4) {
    const final = offset + 4 === value.length;
    const a = base64Digit(value.charCodeAt(offset));
    const b = base64Digit(value.charCodeAt(offset + 1));
    const rawC = value.charCodeAt(offset + 2);
    const rawD = value.charCodeAt(offset + 3);
    if ((!final && (rawC === 0x3d || rawD === 0x3d)) || rawC === 0x3d && rawD !== 0x3d) {
      throw new Error("HCU1 base64 padding is misplaced.");
    }
    const c = rawC === 0x3d ? 0 : base64Digit(rawC);
    const d = rawD === 0x3d ? 0 : base64Digit(rawD);
    if (rawC === 0x3d && (b & 0x0f) !== 0 || rawD === 0x3d && rawC !== 0x3d && (c & 0x03) !== 0) {
      throw new Error("HCU1 base64 has nonzero padding bits.");
    }
    const bits = (a << 18) | (b << 12) | (c << 6) | d;
    if (outputOffset < output.length) output[outputOffset++] = bits >>> 16;
    if (outputOffset < output.length) output[outputOffset++] = bits >>> 8;
    if (outputOffset < output.length) output[outputOffset++] = bits;
  }
  return output;
}

function base64Digit(code: number): number {
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;
  if (code >= 0x61 && code <= 0x7a) return code - 0x61 + 26;
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 52;
  if (code === 0x2b) return 62;
  if (code === 0x2f) return 63;
  throw new Error("HCU1 base64 contains an invalid character.");
}

function malformedShard(collection: string, reason: string): PdfError {
  return new PdfError(
    "unsupported-font",
    `Bundled CID-to-Unicode collection Adobe-${collection} ${reason}.`,
    { details: { reason: "font-cid-unicode-shard-invalid", collection } }
  );
}
