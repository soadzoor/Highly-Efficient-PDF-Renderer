import { MAX_UINT32, align4, fail, transformBytes } from "./hepContainerShared";

/** Exact transforms of the existing four-byte-plane wire payload, not LOD geometry. */
export type BytePlaneVarintMode = 0 | 1 | 2;

export function bytePlaneVarintMaxLength(decodedLength: number): number {
  if (!Number.isSafeInteger(decodedLength) || decodedLength <= 0 || decodedLength > MAX_UINT32 || decodedLength % 4 !== 0) {
    fail("integer chunk length must contain complete 32-bit words.");
  }
  return 1 + 5 * (decodedLength / 4);
}

/** Modes: signed literals, signed modulo-32 deltas, unsigned modulo-32 deltas. */
export function encodeBytePlaneVarints(bytes: Uint8Array, mode: BytePlaneVarintMode): Uint8Array {
  bytePlaneVarintMaxLength(bytes.length);
  if (mode !== 0 && mode !== 1 && mode !== 2) fail("unsupported integer chunk mode.");
  const count = bytes.length / 4;
  const word = (index: number): number => (bytes[index] | bytes[count + index] << 8 |
    bytes[count * 2 + index] << 16 | bytes[count * 3 + index] << 24) >>> 0;
  const transform = (value: number, previous: number): number => {
    const residual = mode === 0 ? value : (value - previous) >>> 0;
    return mode === 2 ? residual : ((residual << 1) ^ (residual >> 31)) >>> 0;
  };
  // Measure first instead of allocating the five-byte worst case for every word.
  let length = 1, previous = 0;
  for (let index = 0; index < count; index++) {
    const value = word(index), encoded = transform(value, previous);
    length += encoded < 0x80 ? 1 : encoded < 0x4000 ? 2 : encoded < 0x200000 ? 3 : encoded < 0x10000000 ? 4 : 5;
    previous = value;
  }
  const output = new Uint8Array(length);
  output[0] = mode;
  let cursor = 1;
  previous = 0;
  for (let index = 0; index < count; index++) {
    const value = word(index);
    let encoded = transform(value, previous);
    while (encoded >= 0x80) {
      output[cursor++] = (encoded & 0x7f) | 0x80;
      encoded >>>= 7;
    }
    output[cursor++] = encoded;
    previous = value;
  }
  return output;
}

export function decodeBytePlaneVarints(bytes: Uint8Array, decodedLength: number): Uint8Array {
  const maxLength = bytePlaneVarintMaxLength(decodedLength), count = decodedLength / 4;
  if (bytes.length < count + 1 || bytes.length > maxLength) fail("integer chunk payload length does not match its word count.");
  const mode = bytes[0];
  if (mode !== 0 && mode !== 1 && mode !== 2) fail("unsupported integer chunk mode.");
  // Check the complete stream before allocating its expanded wire payload.
  let cursor = 1;
  for (let index = 0; index < count; index++) {
    for (let part = 0; ; part++) {
      if (cursor === bytes.length) fail("truncated integer chunk varint.");
      const byte = bytes[cursor++];
      if (part === 4 && byte > 0x0f) fail("integer chunk varint exceeds 32 bits.");
      if (!(byte & 0x80)) {
        if (part !== 0 && byte === 0) fail("noncanonical integer chunk varint.");
        break;
      }
    }
  }
  if (cursor !== bytes.length) fail("unexpected trailing integer chunk bytes.");
  const output = new Uint8Array(decodedLength);
  cursor = 1;
  let previous = 0;
  for (let index = 0; index < count; index++) {
    let encoded = 0, shift = 0, byte: number;
    do {
      byte = bytes[cursor++];
      encoded |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    const residual = mode === 2 ? encoded >>> 0 : ((encoded >>> 1) ^ -(encoded & 1)) >>> 0;
    const value = mode === 0 ? residual : (previous + residual) >>> 0;
    output[index] = value;
    output[count + index] = value >>> 8;
    output[count * 2 + index] = value >>> 16;
    output[count * 3 + index] = value >>> 24;
    previous = value;
  }
  return output;
}

/** Return a compressed codec-3 payload only when it reduces the padded chunk. */
export async function chooseHepIntegerEncoding(
  bytes: Uint8Array,
  originalStoredLength: number,
  signal?: AbortSignal
): Promise<Uint8Array | null> {
  signal?.throwIfAborted();
  if (!bytes.length || bytes.length % 4 !== 0) return null;
  let best: Uint8Array | null = null;
  let bestLength = align4(originalStoredLength);
  for (const mode of [0, 1, 2] as const) {
    signal?.throwIfAborted();
    const encoded = encodeBytePlaneVarints(bytes, mode);
    signal?.throwIfAborted();
    const compressed = await transformBytes(encoded, true, Number.MAX_SAFE_INTEGER, signal);
    if (align4(compressed.length) < bestLength) {
      best = compressed;
      bestLength = align4(compressed.length);
    }
  }
  return best;
}
