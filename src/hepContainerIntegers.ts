import { MAX_UINT32, fail } from "./hepContainerShared";

/** Exact transforms of the existing four-byte-plane wire payload, not LOD geometry. */
export type BytePlaneVarintMode = 0 | 1 | 2;

export function bytePlaneVarintMaxLength(decodedLength: number): number {
  if (!Number.isSafeInteger(decodedLength) || decodedLength <= 0 || decodedLength > MAX_UINT32 || decodedLength % 4 !== 0) {
    fail("integer chunk length must contain complete 32-bit words.");
  }
  return 1 + 5 * (decodedLength / 4);
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
