import { MAX_UINT32, align4, fail, transformBytes } from "./hepContainerShared";
import { ByteWriter } from "./parsedDataVarint";

const POSITION_CLAMP = 0x3fffffff;

/** The physical codec preserves the existing d512 section, including its header. */
export function pathChainMaxLength(decodedLength: number): number {
  if (!Number.isSafeInteger(decodedLength) || decodedLength < 5 || decodedLength > MAX_UINT32) {
    fail("path chunk length is invalid.");
  }
  // Every coordinate needs at least one original byte and at most five chained
  // bytes. The mode, prefix length and four new column lengths add at most 26.
  return decodedLength * 5 + 26;
}

function pathFail(message: string): never {
  fail(`path chunk ${message}.`);
}

class PathCursor {
  offset: number;
  readonly bytes: Uint8Array;
  readonly end: number;
  constructor(bytes: Uint8Array, start = 0, end = bytes.length) {
    this.bytes = bytes;
    this.end = end;
    this.offset = start;
  }
  byte(): number {
    if (this.offset >= this.end) pathFail("is truncated");
    return this.bytes[this.offset++];
  }
  uint(): number {
    let value = 0;
    for (let part = 0; ; part++) {
      const byte = this.byte();
      if (part === 4 && byte > 15) pathFail("varint exceeds 32 bits");
      value |= (byte & 127) << (part * 7);
      if (!(byte & 128)) {
        if (part && byte === 0) pathFail("has a noncanonical varint");
        return value >>> 0;
      }
    }
  }
  signed(): number {
    const value = this.uint();
    return (value >>> 1) ^ -(value & 1);
  }
  expectEnd(): void {
    if (this.offset !== this.end) pathFail("has trailing column bytes");
  }
}

interface PathHeader {
  prefixLength: number;
  edgeCount: number;
  lengths: number[];
}

function readHeader(bytes: Uint8Array, decodedLength: number): PathHeader {
  const cursor = new PathCursor(bytes);
  const pathCount = cursor.uint();
  if (pathCount * 3 + 4 > bytes.length - cursor.offset) pathFail("path records are truncated");
  let edgeCount = 0;
  for (let index = 0; index < pathCount; index++) {
    const parent = cursor.signed();
    if (parent < -1 || parent >= index) pathFail("parent is invalid");
    if (cursor.byte() > 1) pathFail("fill rule is invalid");
    edgeCount += cursor.uint();
    if (edgeCount > Math.floor(decodedLength / 4)) pathFail("edge count exceeds the original payload");
  }
  const lengths = Array.from({ length: 4 }, () => cursor.uint());
  if (lengths.some(length => length < edgeCount || length > edgeCount * 5)) {
    pathFail("coordinate column length is invalid");
  }
  const prefixLength = cursor.offset;
  if (prefixLength + lengths.reduce((sum, length) => sum + length, 0) !== decodedLength) {
    pathFail("column lengths do not fill the original section");
  }
  return { prefixLength, edgeCount, lengths };
}

function columns(bytes: Uint8Array, start: number, lengths: number[]): PathCursor[] {
  return lengths.map(length => {
    const cursor = new PathCursor(bytes, start, start + length);
    start += length;
    return cursor;
  });
}

function checkPosition(value: number): void {
  if (value < -POSITION_CLAMP || value > POSITION_CLAMP) pathFail("coordinate is outside the fixed-point range");
}

function signedLength(value: number): number {
  const encoded = value < 0 ? -value * 2 - 1 : value * 2;
  return encoded < 0x80 ? 1 : encoded < 0x4000 ? 2 : encoded < 0x200000 ? 3 : encoded < 0x10000000 ? 4 : 5;
}

/** Replace duplicate edge endpoints with exact integer chain corrections. */
export function encodePathChains(bytes: Uint8Array): Uint8Array {
  pathChainMaxLength(bytes.length);
  const header = readHeader(bytes, bytes.length);
  const input = columns(bytes, header.prefixLength, header.lengths);
  const output = Array.from({ length: 4 }, () => new ByteWriter());
  const previous = [0, 0, 0, 0];
  for (let index = 0; index < header.edgeCount; index++) {
    const sx = previous[0] + input[0].signed(), sy = previous[1] + input[1].signed();
    const ex = previous[2] + input[2].signed(), ey = previous[3] + input[3].signed();
    checkPosition(sx); checkPosition(sy); checkPosition(ex); checkPosition(ey);
    output[0].writeZigzagVarint(sx - previous[2]); output[1].writeZigzagVarint(sy - previous[3]);
    output[2].writeZigzagVarint(ex - sx); output[3].writeZigzagVarint(ey - sy);
    previous[0] = sx; previous[1] = sy; previous[2] = ex; previous[3] = ey;
  }
  for (const cursor of input) cursor.expectEnd();
  const writer = new ByteWriter(header.prefixLength + output.reduce((sum, column) => sum + column.length, 0) + 26);
  writer.writeByte(0);
  writer.writeVarUint32(header.prefixLength);
  writer.writeBytes(bytes.subarray(0, header.prefixLength));
  for (const column of output) writer.writeVarUint32(column.length);
  for (const column of output) writer.writeBytes(column.toUint8Array());
  return writer.toUint8Array();
}

/** Validate the transformed stream before allocating its original section. */
export function decodePathChains(bytes: Uint8Array, decodedLength: number): Uint8Array {
  if (bytes.length > pathChainMaxLength(decodedLength)) pathFail("payload exceeds its original length bound");
  const cursor = new PathCursor(bytes);
  if (cursor.byte() !== 0) pathFail("mode is unsupported");
  const prefixLength = cursor.uint();
  if (prefixLength < 5 || prefixLength > decodedLength || prefixLength > bytes.length - cursor.offset) {
    pathFail("prefix length is invalid");
  }
  const prefix = bytes.subarray(cursor.offset, cursor.offset + prefixLength);
  cursor.offset += prefixLength;
  const header = readHeader(prefix, decodedLength);
  if (header.prefixLength !== prefixLength) pathFail("prefix has trailing bytes");
  const lengths = Array.from({ length: 4 }, () => cursor.uint());
  if (lengths.some(length => length < header.edgeCount || length > header.edgeCount * 5) ||
      cursor.offset + lengths.reduce((sum, length) => sum + length, 0) !== bytes.length) {
    pathFail("chained column lengths are invalid");
  }
  const start = cursor.offset;
  const validate = columns(bytes, start, lengths), originalLengths = [0, 0, 0, 0], previous = [0, 0, 0, 0];
  for (let index = 0; index < header.edgeCount; index++) {
    const sx = previous[2] + validate[0].signed(), sy = previous[3] + validate[1].signed();
    const ex = sx + validate[2].signed(), ey = sy + validate[3].signed();
    checkPosition(sx); checkPosition(sy); checkPosition(ex); checkPosition(ey);
    originalLengths[0] += signedLength(sx - previous[0]); originalLengths[1] += signedLength(sy - previous[1]);
    originalLengths[2] += signedLength(ex - previous[2]); originalLengths[3] += signedLength(ey - previous[3]);
    previous[0] = sx; previous[1] = sy; previous[2] = ex; previous[3] = ey;
  }
  for (const column of validate) column.expectEnd();
  if (originalLengths.some((length, channel) => length !== header.lengths[channel])) {
    pathFail("reconstructed column lengths do not match the original");
  }
  const output = new Uint8Array(decodedLength);
  output.set(prefix);
  const positions = header.lengths.map((_length, channel) => prefixLength + header.lengths.slice(0, channel).reduce((a, b) => a + b, 0));
  const write = (channel: number, value: number): void => {
    let encoded = value < 0 ? -value * 2 - 1 : value * 2;
    while (encoded >= 128) {
      output[positions[channel]++] = (encoded & 127) | 128;
      encoded = Math.floor(encoded / 128);
    }
    output[positions[channel]++] = encoded;
  };
  const input = columns(bytes, start, lengths);
  previous.fill(0);
  for (let index = 0; index < header.edgeCount; index++) {
    const sx = previous[2] + input[0].signed(), sy = previous[3] + input[1].signed();
    const ex = sx + input[2].signed(), ey = sy + input[3].signed();
    write(0, sx - previous[0]); write(1, sy - previous[1]);
    write(2, ex - previous[2]); write(3, ey - previous[3]);
    previous[0] = sx; previous[1] = sy; previous[2] = ex; previous[3] = ey;
  }
  return output;
}

/** Unsupported legacy payloads keep their original codec; no geometry is lost. */
export async function chooseHepPathEncoding(
  bytes: Uint8Array,
  originalStoredLength: number,
  signal?: AbortSignal
): Promise<Uint8Array | null> {
  signal?.throwIfAborted();
  let encoded: Uint8Array;
  try {
    encoded = encodePathChains(bytes);
  } catch (error) {
    if (error instanceof Error && /path chunk/.test(error.message)) return null;
    throw error;
  }
  signal?.throwIfAborted();
  const compressed = await transformBytes(encoded, true, Number.MAX_SAFE_INTEGER, signal);
  return align4(compressed.length) < align4(originalStoredLength) ? compressed : null;
}
