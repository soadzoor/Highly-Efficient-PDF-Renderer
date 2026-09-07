import { PdfError, throwIfAborted } from "./nativeTypes";
import {
  importNativePredefinedCMapShard,
  isNativePredefinedCMapName,
  nativePredefinedCMapSystemInfo,
  type NativePredefinedCMapSystemInfo,
  type NativePredefinedCMapName
} from "./cmaps/generated/registry";

export interface NativePredefinedCMapCodeSpace {
  readonly byteLength: number;
  readonly start: number;
  readonly end: number;
}

export interface NativePredefinedCMapCidRange {
  readonly start: number;
  readonly end: number;
  readonly firstCid: number;
}

export interface NativePredefinedCMapNotdefRange {
  readonly start: number;
  readonly end: number;
  readonly cid: number;
}

export interface NativePredefinedCMapShard {
  readonly name: NativePredefinedCMapName;
  readonly systemInfo: Readonly<NativePredefinedCMapSystemInfo>;
  readonly baseName: NativePredefinedCMapName | null;
  readonly writingMode: 0 | 1;
  readonly codeSpaces: readonly NativePredefinedCMapCodeSpace[];
  /** Sorted, non-overlapping local CID ranges indexed by source byte length minus one. */
  readonly cidRanges: readonly [
    readonly NativePredefinedCMapCidRange[],
    readonly NativePredefinedCMapCidRange[],
    readonly NativePredefinedCMapCidRange[],
    readonly NativePredefinedCMapCidRange[]
  ];
  /** Sorted, non-overlapping local notdef ranges indexed by source byte length minus one. */
  readonly notdefRanges: readonly [
    readonly NativePredefinedCMapNotdefRange[],
    readonly NativePredefinedCMapNotdefRange[],
    readonly NativePredefinedCMapNotdefRange[],
    readonly NativePredefinedCMapNotdefRange[]
  ];
  readonly mappingCount: number;
  readonly notdefMappingCount: number;
}

const shardCache = new Map<NativePredefinedCMapName, Promise<NativePredefinedCMapShard>>();

/** Package-relative reproducibility manifest emitted beside the lazy shards. */
export const NATIVE_CMAP_MANIFEST_URL = new URL(
  "./cmaps/generated/manifest.json?no-inline",
  import.meta.url
);

/** Load and strictly decode one generated Adobe CMap shard. */
export async function loadNativePredefinedCMap(
  name: string,
  signal?: AbortSignal
): Promise<NativePredefinedCMapShard> {
  throwIfAborted(signal);
  if (!isNativePredefinedCMapName(name)) {
    throw new PdfError("unsupported-font", `Predefined CMap /${name} is not bundled.`, {
      details: { reason: "font-cmap-not-bundled" }
    });
  }
  let pending = shardCache.get(name);
  if (!pending) {
    pending = importNativePredefinedCMapShard(name)
      .then((encoded) => decodeShard(name, encoded))
      .catch((error: unknown) => {
        shardCache.delete(name);
        if (error instanceof PdfError) throw error;
        throw new PdfError("unsupported-font", `Bundled CMap /${name} could not be loaded.`, {
          cause: error,
          details: { reason: "font-cmap-shard-load" }
        });
      });
    shardCache.set(name, pending);
  }
  const shard = await pending;
  throwIfAborted(signal);
  return shard;
}

function decodeShard(name: NativePredefinedCMapName, encoded: string): NativePredefinedCMapShard {
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(encoded);
  } catch (error) {
    throw new PdfError("unsupported-font", `Bundled CMap /${name} has invalid base64 data.`, {
      cause: error,
      details: { reason: "font-cmap-shard-invalid" }
    });
  }
  const reader = new ShardReader(name, bytes);
  if (
    reader.readByte() !== 0x48 ||
    reader.readByte() !== 0x43 ||
    reader.readByte() !== 0x4d ||
    reader.readByte() !== 0x33
  ) {
    throw malformedShard(name, "magic/version is not HCM3");
  }
  const rawWritingMode = reader.readByte();
  if (rawWritingMode !== 0 && rawWritingMode !== 1) {
    throw malformedShard(name, "writing mode is invalid");
  }
  const baseByteLength = reader.readVarUint();
  const baseNameValue = reader.readAscii(baseByteLength);
  const baseName = baseNameValue.length === 0 ? null : baseNameValue;
  if (baseName !== null && !isNativePredefinedCMapName(baseName)) {
    throw malformedShard(name, `base CMap /${baseName} is not bundled`);
  }

  const codeSpaceCount = reader.readVarUint();
  const codeSpaces: NativePredefinedCMapCodeSpace[] = [];
  for (let index = 0; index < codeSpaceCount; index += 1) {
    const byteLength = reader.readByte();
    const start = reader.readVarUint();
    const span = reader.readVarUint();
    const end = checkedCodeEnd(name, byteLength, start, span);
    codeSpaces.push(Object.freeze({ byteLength, start, end }));
  }

  const cidRanges: [
    NativePredefinedCMapCidRange[],
    NativePredefinedCMapCidRange[],
    NativePredefinedCMapCidRange[],
    NativePredefinedCMapCidRange[]
  ] = [[], [], [], []];
  let mappingCount = 0;
  for (let byteLength = 1; byteLength <= 4; byteLength += 1) {
    const count = reader.readVarUint();
    let previousEnd = -1;
    const ranges = cidRanges[byteLength - 1];
    for (let index = 0; index < count; index += 1) {
      const gap = reader.readVarUint();
      const start = previousEnd + 1 + gap;
      const span = reader.readVarUint();
      const end = checkedCodeEnd(name, byteLength, start, span);
      const firstCid = reader.readVarUint();
      if (firstCid > 0xffff || span > 0xffff - firstCid) {
        throw malformedShard(name, "CID range exceeds the 16-bit CID space");
      }
      mappingCount += span + 1;
      if (!Number.isSafeInteger(mappingCount)) {
        throw malformedShard(name, "mapping count is not a safe integer");
      }
      ranges.push(Object.freeze({ start, end, firstCid }));
      previousEnd = end;
    }
    Object.freeze(ranges);
  }
  const notdefRanges: [
    NativePredefinedCMapNotdefRange[],
    NativePredefinedCMapNotdefRange[],
    NativePredefinedCMapNotdefRange[],
    NativePredefinedCMapNotdefRange[]
  ] = [[], [], [], []];
  let notdefMappingCount = 0;
  for (let byteLength = 1; byteLength <= 4; byteLength += 1) {
    const count = reader.readVarUint();
    let previousEnd = -1;
    const ranges = notdefRanges[byteLength - 1];
    for (let index = 0; index < count; index += 1) {
      const gap = reader.readVarUint();
      const start = previousEnd + 1 + gap;
      const span = reader.readVarUint();
      const end = checkedCodeEnd(name, byteLength, start, span);
      const cid = reader.readVarUint();
      if (cid > 0xffff) {
        throw malformedShard(name, "notdef CID exceeds the 16-bit CID space");
      }
      notdefMappingCount += span + 1;
      if (!Number.isSafeInteger(notdefMappingCount)) {
        throw malformedShard(name, "notdef mapping count is not a safe integer");
      }
      ranges.push(Object.freeze({ start, end, cid }));
      previousEnd = end;
    }
    Object.freeze(ranges);
  }
  if (!reader.done) throw malformedShard(name, "contains trailing bytes");
  const systemInfo = nativePredefinedCMapSystemInfo(name);
  return Object.freeze({
    name,
    systemInfo,
    baseName,
    writingMode: rawWritingMode,
    codeSpaces: Object.freeze(codeSpaces),
    cidRanges: Object.freeze(cidRanges),
    notdefRanges: Object.freeze(notdefRanges),
    mappingCount,
    notdefMappingCount
  });
}

function checkedCodeEnd(
  name: NativePredefinedCMapName,
  byteLength: number,
  start: number,
  span: number
): number {
  if (byteLength < 1 || byteLength > 4) {
    throw malformedShard(name, "source byte length is outside one through four");
  }
  const maximum = byteLength === 4 ? 0xffff_ffff : (2 ** (byteLength * 8)) - 1;
  if (start > maximum || span > maximum - start) {
    throw malformedShard(name, "source-code interval exceeds its byte length");
  }
  return start + span;
}

class ShardReader {
  private offset = 0;
  private readonly name: NativePredefinedCMapName;
  private readonly bytes: Uint8Array;

  constructor(name: NativePredefinedCMapName, bytes: Uint8Array) {
    this.name = name;
    this.bytes = bytes;
  }

  get done(): boolean {
    return this.offset === this.bytes.byteLength;
  }

  readByte(): number {
    if (this.offset >= this.bytes.byteLength) {
      throw malformedShard(this.name, "is truncated");
    }
    return this.bytes[this.offset++];
  }

  readVarUint(): number {
    let result = 0;
    for (let index = 0; index < 5; index += 1) {
      const byte = this.readByte();
      result += (byte & 0x7f) * (2 ** (index * 7));
      if ((byte & 0x80) === 0) {
        if (result > 0xffff_ffff) throw malformedShard(this.name, "varint exceeds uint32");
        return result;
      }
    }
    throw malformedShard(this.name, "varint exceeds five bytes");
  }

  readAscii(length: number): string {
    if (length > 127 || this.offset + length > this.bytes.byteLength) {
      throw malformedShard(this.name, "base-name field is invalid");
    }
    let result = "";
    for (let index = 0; index < length; index += 1) {
      const byte = this.bytes[this.offset++];
      if (byte < 0x21 || byte > 0x7e) {
        throw malformedShard(this.name, "base-name field is not printable ASCII");
      }
      result += String.fromCharCode(byte);
    }
    return result;
  }
}

function decodeBase64(value: string): Uint8Array {
  if (value.length === 0 || (value.length & 3) !== 0) {
    throw new Error("HEPR CMap base64 length is invalid.");
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const output = new Uint8Array((value.length / 4) * 3 - padding);
  let outputOffset = 0;
  for (let offset = 0; offset < value.length; offset += 4) {
    const final = offset + 4 === value.length;
    const a = base64Digit(value.charCodeAt(offset));
    const b = base64Digit(value.charCodeAt(offset + 1));
    const rawC = value.charCodeAt(offset + 2);
    const rawD = value.charCodeAt(offset + 3);
    if ((!final && (rawC === 0x3d || rawD === 0x3d)) || (rawC === 0x3d && rawD !== 0x3d)) {
      throw new Error("HEPR CMap base64 padding is misplaced.");
    }
    const c = rawC === 0x3d ? 0 : base64Digit(rawC);
    const d = rawD === 0x3d ? 0 : base64Digit(rawD);
    if (
      (rawC === 0x3d && (b & 0x0f) !== 0) ||
      (rawD === 0x3d && rawC !== 0x3d && (c & 0x03) !== 0)
    ) {
      throw new Error("HEPR CMap base64 has nonzero padding bits.");
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
  throw new Error("HEPR CMap base64 data contains an invalid character.");
}

function malformedShard(name: string, reason: string): PdfError {
  return new PdfError("unsupported-font", `Bundled CMap /${name} ${reason}.`, {
    details: { reason: "font-cmap-shard-invalid" }
  });
}
