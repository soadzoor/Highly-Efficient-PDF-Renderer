import { hepMonochromeRasterByteLength } from "./hepMonochromeRaster";
import type { MonochromeRaster } from "./monochromeRaster";

export const HEP_BINARY_RASTER_HEADER_BYTES = 16;
const MAGIC = Uint8Array.of(0x48, 0x42, 0x52, 0x31); // HBR1
const RUN_COUNTS = new Uint8Array(256);
const RUN_LENGTHS = new Uint8Array(256 * 8);
for (let value = 0; value < 256; value++) {
  let bit = value >>> 7, count = 0, length = 0;
  for (let shift = 7; shift >= 0; shift--) {
    const next = (value >>> shift) & 1;
    if (next !== bit) { RUN_LENGTHS[value * 8 + count++] = length; bit = next; length = 0; }
    length++;
  }
  RUN_LENGTHS[value * 8 + count++] = length;
  RUN_COUNTS[value] = count;
}

function fail(message: string): never {
  throw new Error(`Invalid HEP binary raster section: ${message}.`);
}

/** A binary section is selected only when it is smaller than plain packed storage. */
export function hepBinaryRasterByteLengthLimit(width: number, height: number): number {
  const plain = hepMonochromeRasterByteLength(width, height);
  if (plain > 0xffff_ffff) fail("byte length is out of range");
  return plain - 1;
}

/** Transpose one 8x8 bit block; absent final rows read as zero. */
function transposeBlock(source: Uint8Array, offset: number, stride: number, out: Uint8Array): number {
  let a = source[offset] ?? 0, b = source[offset + stride] ?? 0;
  let c = source[offset + stride * 2] ?? 0, d = source[offset + stride * 3] ?? 0;
  let e = source[offset + stride * 4] ?? 0, f = source[offset + stride * 5] ?? 0;
  let g = source[offset + stride * 6] ?? 0, h = source[offset + stride * 7] ?? 0, t: number;
  if ((a | b | c | d | e | f | g | h) === 0) { out.fill(0); return 0; }
  if ((a & b & c & d & e & f & g & h) === 255) { out.fill(255); return 255; }
  t = (a ^ (b >>> 1)) & 0x55; a ^= t; b ^= t << 1;
  t = (c ^ (d >>> 1)) & 0x55; c ^= t; d ^= t << 1;
  t = (e ^ (f >>> 1)) & 0x55; e ^= t; f ^= t << 1;
  t = (g ^ (h >>> 1)) & 0x55; g ^= t; h ^= t << 1;
  t = (a ^ (c >>> 2)) & 0x33; a ^= t; c ^= t << 2;
  t = (b ^ (d >>> 2)) & 0x33; b ^= t; d ^= t << 2;
  t = (e ^ (g >>> 2)) & 0x33; e ^= t; g ^= t << 2;
  t = (f ^ (h >>> 2)) & 0x33; f ^= t; h ^= t << 2;
  t = (a ^ (e >>> 4)) & 0x0f; a ^= t; e ^= t << 4;
  t = (b ^ (f >>> 4)) & 0x0f; b ^= t; f ^= t << 4;
  t = (c ^ (g >>> 4)) & 0x0f; c ^= t; g ^= t << 4;
  t = (d ^ (h >>> 4)) & 0x0f; d ^= t; h ^= t << 4;
  out[0] = a; out[1] = b; out[2] = c; out[3] = d;
  out[4] = e; out[5] = f; out[6] = g; out[7] = h;
  return -1;
}

/**
 * Transposed binary runs preserve exact packed bytes, including row padding.
 * The container compresses this section with native Deflate. No candidate may
 * grow beyond the plain packed section; noise immediately takes that fallback.
 */
export function encodeHepBinaryRaster(monochrome: MonochromeRaster, width: number, height: number,
  signal?: AbortSignal): Uint8Array | undefined {
  signal?.throwIfAborted();
  const limit = hepBinaryRasterByteLengthLimit(width, height), rowBytes = Math.ceil(width / 8);
  if (!(monochrome.colors instanceof Uint8Array) || monochrome.colors.length !== 8) fail("palette must contain two RGBA colors");
  if (!(monochrome.data instanceof Uint8Array) || monochrome.data.length !== rowBytes * height) {
    fail("packed byte length does not match its dimensions");
  }
  if (limit < HEP_BINARY_RASTER_HEADER_BYTES + 2) return undefined;
  const out = new Uint8Array(limit), scratch = new Uint8Array(8);
  out.set(MAGIC); out.set(monochrome.colors, 4);
  let offset = HEP_BINARY_RASTER_HEADER_BYTES + 1, bit = -1, run = 0, blocks = 0;
  const appendRun = (): boolean => {
    let length = run;
    do {
      if (offset === limit) return false;
      out[offset++] = (length % 128) | (length >= 128 ? 128 : 0);
      length = Math.floor(length / 128);
    } while (length);
    return true;
  };
  for (let row = 0; row < height; row += 8) for (let x = 0; x < rowBytes; x++) {
    if ((blocks++ & 255) === 0) signal?.throwIfAborted();
    const uniform = transposeBlock(monochrome.data, row * rowBytes + x, rowBytes, scratch);
    if (uniform >= 0) {
      const first = uniform >>> 7;
      if (bit < 0) { bit = first; out[HEP_BINARY_RASTER_HEADER_BYTES] = bit; }
      else if (bit !== first) { if (!appendRun()) return undefined; bit = first; run = 0; }
      run += 64;
      continue;
    }
    for (const value of scratch) {
      const first = value >>> 7;
      if (bit < 0) { bit = first; out[HEP_BINARY_RASTER_HEADER_BYTES] = bit; }
      else if (bit !== first) { if (!appendRun()) return undefined; bit = first; run = 0; }
      if (value === 0 || value === 255) { run += 8; continue; }
      const count = RUN_COUNTS[value];
      for (let i = 0; i < count; i++) {
        run += RUN_LENGTHS[value * 8 + i];
        if (i + 1 < count) { if (!appendRun()) return undefined; bit ^= 1; run = 0; }
      }
    }
  }
  if (!appendRun()) return undefined;
  signal?.throwIfAborted();
  return out.slice(0, offset);
}

/** Stream runs through an eight-byte scratch block, keeping decode memory packed. */
export function decodeHepBinaryRaster(bytes: Uint8Array, width: number, height: number,
  signal?: AbortSignal): MonochromeRaster {
  signal?.throwIfAborted();
  const limit = hepBinaryRasterByteLengthLimit(width, height), rowBytes = Math.ceil(width / 8);
  if (!(bytes instanceof Uint8Array) || bytes.length < HEP_BINARY_RASTER_HEADER_BYTES + 2 || bytes.length > limit) {
    fail("byte length is out of range");
  }
  if (MAGIC.some((byte, i) => bytes[i] !== byte)) fail("invalid header");
  if (bytes.subarray(12, 16).some(byte => byte !== 0)) fail("reserved header bytes must be zero");
  let bit = bytes[HEP_BINARY_RASTER_HEADER_BYTES];
  if (bit > 1) fail("initial bit must be zero or one");
  const totalBits = rowBytes * Math.ceil(height / 8) * 64;
  if (!Number.isSafeInteger(totalBits)) fail("transposed bit length is out of range");
  const data = new Uint8Array(rowBytes * height), scratch = new Uint8Array(8);
  const initialFill = bit ? 255 : 0;
  if (initialFill) data.fill(initialFill);
  let offset = HEP_BINARY_RASTER_HEADER_BYTES + 1, consumed = 0, blocks = 0;
  const readRun = (): number => {
    let value = 0, factor = 1, count = 0, byte: number;
    do {
      if (offset === bytes.length) fail("truncated run length");
      byte = bytes[offset++];
      value += (byte & 127) * factor;
      if (!Number.isSafeInteger(value) || value > totalBits - consumed) fail("run exceeds the transposed pixel limit");
      factor *= 128;
      if (++count > 8) fail("run length is out of range");
    } while (byte & 128);
    if (value === 0) fail("empty runs are invalid");
    if (count > 1 && byte === 0) fail("run length is not canonical");
    return value;
  };
  let run = readRun();
  for (let row = 0; row < height; row += 8) for (let x = 0; x < rowBytes; x++) {
    if ((blocks++ & 255) === 0) signal?.throwIfAborted();
    if (run === 0) { bit ^= 1; run = readRun(); }
    if (run >= 64) {
      const fill = bit ? 255 : 0;
      if (fill && row + 8 > height) fail("padded final rows must be zero");
      if (fill !== initialFill) for (let y = 0; y < 8 && row + y < height; y++) data[(row + y) * rowBytes + x] = fill;
      run -= 64; consumed += 64;
      continue;
    }
    scratch.fill(0);
    for (let position = 0; position < 64;) {
      if (run === 0) { bit ^= 1; run = readRun(); }
      const count = Math.min(run, 64 - position), end = position + count;
      if (bit) {
        const firstByte = position >>> 3, lastByte = (end - 1) >>> 3;
        if (firstByte === lastByte) {
          scratch[firstByte] |= (255 >>> (position & 7)) & (255 << (7 - ((end - 1) & 7)));
        } else {
          scratch[firstByte] |= 255 >>> (position & 7);
          scratch.fill(255, firstByte + 1, lastByte);
          scratch[lastByte] |= 255 << (7 - ((end - 1) & 7));
        }
      }
      position = end; run -= count; consumed += count;
    }
    transposeBlock(scratch, 0, 1, scratch);
    for (let y = 0; y < 8; y++) {
      if (row + y < height) data[(row + y) * rowBytes + x] = scratch[y];
      else if (scratch[y] !== 0) fail("padded final rows must be zero");
    }
  }
  if (run !== 0 || consumed !== totalBits) fail("run stream does not match its dimensions");
  if (offset !== bytes.length) fail("trailing run data");
  signal?.throwIfAborted();
  return { data, colors: bytes.subarray(4, 12) };
}
