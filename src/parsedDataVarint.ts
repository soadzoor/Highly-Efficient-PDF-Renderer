// Integer/varint codecs for the parsed-data v5 format. Pure and DOM-free so
// headless tooling can load this module directly.
//
// All varints are LEB128-style base-128 with the low 7 bits first; signed
// values are zigzag-mapped to unsigned first. A zigzagged int32 always fits
// in 5 bytes, and byte 5 of a canonical u32 varint carries at most 4 bits.

/** Fixed-point grid for text positions and fallback quads: 1/512 scene unit. */
export const POSITION_FIXED_SCALE = 512;

/**
 * Quantized magnitudes are clamped so that any delta of two quantized values
 * zigzags into an unsigned 32-bit varint. 2^30/512 = ±2 million scene units,
 * far beyond any real page grid.
 */
const POSITION_FIXED_CLAMP = 0x3fffffff;

let warnedPositionClamp = false;

export function quantizePosition(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const q = Math.round(value * POSITION_FIXED_SCALE);
  if (q > POSITION_FIXED_CLAMP || q < -POSITION_FIXED_CLAMP) {
    if (!warnedPositionClamp) {
      warnedPositionClamp = true;
      console.warn(`[Parsed data] Position ${value} exceeds the fixed-point range and was clamped.`);
    }
    return q > 0 ? POSITION_FIXED_CLAMP : -POSITION_FIXED_CLAMP;
  }
  return q;
}

export function dequantizePosition(quantized: number): number {
  return quantized / POSITION_FIXED_SCALE;
}

export function zigzagEncode32(value: number): number {
  // Float-domain mapping: exact for |value| <= 2^31 - 1 and always yields an
  // unsigned value below 2^32.
  return value < 0 ? -value * 2 - 1 : value * 2;
}

export function zigzagDecode32(encoded: number): number {
  return (encoded >>> 1) ^ -(encoded & 1);
}

/**
 * Shared uint16 range quantization used by the q16 texture codecs and the
 * stroke geometry section. Writer, reader, and the curve-control predictor
 * must all use this one formula pair so reconstruction is bit-exact.
 */
export function encodeRangeUint16(rawValue: number, min: number, max: number): number {
  const range = max - min;
  if (Math.abs(range) <= 1e-20) {
    return 0;
  }
  const value = Number.isFinite(rawValue) ? rawValue : min;
  const normalized = (value - min) / range;
  const clamped = normalized < 0 ? 0 : normalized > 1 ? 1 : normalized;
  return Math.round(clamped * 65535);
}

export function decodeRangeUint16(quantized: number, min: number, max: number): number {
  const range = max - min;
  if (Math.abs(range) <= 1e-20) {
    return min;
  }
  return min + (quantized / 65535) * range;
}

export class ByteWriter {
  private data: Uint8Array;

  private used = 0;

  constructor(initialCapacity = 1024) {
    this.data = new Uint8Array(Math.max(16, initialCapacity));
  }

  get length(): number {
    return this.used;
  }

  writeByte(value: number): void {
    this.ensureCapacity(1);
    this.data[this.used++] = value & 255;
  }

  /** Little-endian uint16. */
  writeUint16(value: number): void {
    this.ensureCapacity(2);
    this.data[this.used++] = value & 255;
    this.data[this.used++] = (value >>> 8) & 255;
  }

  /** value must be an integer in [0, 2^32). */
  writeVarUint32(value: number): void {
    this.ensureCapacity(5);
    let z = value;
    for (;;) {
      if (z < 128) {
        this.data[this.used++] = z;
        return;
      }
      this.data[this.used++] = (z & 127) | 128;
      z = Math.floor(z / 128);
    }
  }

  /** value must be an integer in [-(2^31 - 1), 2^31 - 1]. */
  writeZigzagVarint(value: number): void {
    this.writeVarUint32(zigzagEncode32(value));
  }

  writeBytes(source: Uint8Array): void {
    this.ensureCapacity(source.length);
    this.data.set(source, this.used);
    this.used += source.length;
  }

  toUint8Array(): Uint8Array {
    return this.data.slice(0, this.used);
  }

  private ensureCapacity(extraBytes: number): void {
    if (this.used + extraBytes <= this.data.length) {
      return;
    }
    let nextLength = this.data.length * 2;
    while (this.used + extraBytes > nextLength) {
      nextLength *= 2;
    }
    const next = new Uint8Array(nextLength);
    next.set(this.data.subarray(0, this.used));
    this.data = next;
  }
}

/** Sequential varint reader over a byte range. */
export class VarintCursor {
  private readonly bytes: Uint8Array;

  private offset: number;

  private readonly end: number;

  constructor(bytes: Uint8Array, byteStart = 0, byteEnd = bytes.length) {
    this.bytes = bytes;
    this.offset = byteStart;
    this.end = byteEnd;
  }

  readVarUint32(): number {
    const bytes = this.bytes;
    let b = bytes[this.offset++];
    let value = b & 127;
    let shift = 7;
    while (b & 128) {
      b = bytes[this.offset++];
      value = shift < 28 ? value | ((b & 127) << shift) : (value | ((b & 15) << 28)) >>> 0;
      shift += 7;
    }
    return value >>> 0;
  }

  readZigzagVarint(): number {
    return zigzagDecode32(this.readVarUint32());
  }

  expectEnd(label: string): void {
    if (this.offset !== this.end) {
      throw new Error(`${label}: varint stream length mismatch (at ${this.offset}, expected ${this.end}).`);
    }
  }
}

/**
 * Encodes one channel of an interleaved Float32Array as fixed-point 1/512
 * values, delta-coded against the previous value in the same channel and
 * stored as zigzag varints.
 */
export function encodeFixed512DeltaColumn(
  source: Float32Array,
  count: number,
  stride: number,
  channel: number
): Uint8Array {
  const out = new Uint8Array(count * 5 + 8);
  let o = 0;
  let prev = 0;
  for (let i = 0; i < count; i += 1) {
    const q = quantizePosition(source[i * stride + channel]);
    const delta = q - prev;
    prev = q;
    let z = delta < 0 ? -delta * 2 - 1 : delta * 2;
    for (;;) {
      if (z < 128) {
        out[o++] = z;
        break;
      }
      out[o++] = (z & 127) | 128;
      z = Math.floor(z / 128);
    }
  }
  return out.slice(0, o);
}

/**
 * Decodes a fixed-point delta column into one channel of an interleaved
 * Float32Array. Integer accumulation is exact; no drift.
 */
export function decodeFixed512DeltaColumnInto(
  bytes: Uint8Array,
  byteStart: number,
  byteEnd: number,
  dst: Float32Array,
  count: number,
  stride: number,
  channel: number
): void {
  let o = byteStart;
  let prev = 0;
  for (let i = 0; i < count; i += 1) {
    let b = bytes[o++];
    let u = b & 127;
    let shift = 7;
    while (b & 128) {
      b = bytes[o++];
      u = shift < 28 ? u | ((b & 127) << shift) : (u | ((b & 15) << 28)) >>> 0;
      shift += 7;
    }
    prev += (u >>> 1) ^ -(u & 1);
    dst[i * stride + channel] = prev / POSITION_FIXED_SCALE;
  }
  if (o !== byteEnd) {
    throw new Error(`Fixed-point delta column length mismatch (at ${o}, expected ${byteEnd}).`);
  }
}

/**
 * Encodes one channel of an interleaved Uint16Array (already range-quantized)
 * as zigzag varint deltas against the previous value in the same channel.
 */
export function encodeU16DeltaColumn(
  quantized: Uint16Array,
  count: number,
  stride: number,
  channel: number
): Uint8Array {
  const out = new Uint8Array(count * 3 + 8);
  let o = 0;
  let prev = 0;
  for (let i = 0; i < count; i += 1) {
    const q = quantized[i * stride + channel];
    const delta = q - prev;
    prev = q;
    let z = delta < 0 ? -delta * 2 - 1 : delta * 2;
    for (;;) {
      if (z < 128) {
        out[o++] = z;
        break;
      }
      out[o++] = (z & 127) | 128;
      z = Math.floor(z / 128);
    }
  }
  return out.slice(0, o);
}

/** Decodes a u16 delta column back into one channel of an interleaved Uint16Array. */
export function decodeU16DeltaColumnInto(
  bytes: Uint8Array,
  byteStart: number,
  byteEnd: number,
  dstQuantized: Uint16Array,
  count: number,
  stride: number,
  channel: number
): void {
  let o = byteStart;
  let prev = 0;
  for (let i = 0; i < count; i += 1) {
    let b = bytes[o++];
    let u = b & 127;
    let shift = 7;
    while (b & 128) {
      b = bytes[o++];
      u = shift < 28 ? u | ((b & 127) << shift) : (u | ((b & 15) << 28)) >>> 0;
      shift += 7;
    }
    prev += (u >>> 1) ^ -(u & 1);
    dstQuantized[i * stride + channel] = prev;
  }
  if (o !== byteEnd) {
    throw new Error(`Uint16 delta column length mismatch (at ${o}, expected ${byteEnd}).`);
  }
}
