import { MAX_CHUNK_BYTES } from "./hepContainerShared";

/** Exact Float32 vec4 palette: u16 count, u16 reserved, little-endian words, byte indices. */
const PALETTE_HEADER_BYTES = 4;
const FLOATS_PER_ITEM = 4;
export const BYTES_PER_ITEM = FLOATS_PER_ITEM * Float32Array.BYTES_PER_ELEMENT;
const MAX_PALETTE_ITEMS = 256;

/** Return null when a byte palette cannot reduce the uncompressed payload. */
export function encodeFloat32Palette(source: Float32Array): Uint8Array | null {
  if (source.length % FLOATS_PER_ITEM !== 0) {
    throw new Error("Float32 palette source must contain complete vec4 items.");
  }
  // Compare integer words, preserving signed zero and every NaN payload bit.
  return encodeWordPalette(new Uint32Array(source.buffer, source.byteOffset, source.length));
}

function encodeWordPalette(words: Uint32Array): Uint8Array | null {
  const itemCount = words.length / FLOATS_PER_ITEM;
  if (itemCount === 0 || words.byteLength > MAX_CHUNK_BYTES) return null;
  const palette = new Uint32Array(MAX_PALETTE_ITEMS * FLOATS_PER_ITEM);
  const indices = new Uint8Array(itemCount);
  const entries = new Map<string, number>();
  let previousA = NaN, previousB = NaN, previousC = NaN, previousD = NaN;
  let previousIndex = 0;
  for (let index = 0; index < itemCount; index++) {
    const offset = index * FLOATS_PER_ITEM;
    const a = words[offset], b = words[offset + 1], c = words[offset + 2], d = words[offset + 3];
    if (a !== previousA || b !== previousB || c !== previousC || d !== previousD) {
      const key = `${a},${b},${c},${d}`;
      let paletteIndex = entries.get(key);
      if (paletteIndex === undefined) {
        paletteIndex = entries.size;
        if (paletteIndex === MAX_PALETTE_ITEMS) return null;
        entries.set(key, paletteIndex);
        const paletteOffset = paletteIndex * FLOATS_PER_ITEM;
        palette[paletteOffset] = a;
        palette[paletteOffset + 1] = b;
        palette[paletteOffset + 2] = c;
        palette[paletteOffset + 3] = d;
      }
      previousA = a; previousB = b; previousC = c; previousD = d;
      previousIndex = paletteIndex;
    }
    indices[index] = previousIndex;
  }
  const paletteBytes = entries.size * BYTES_PER_ITEM;
  const length = PALETTE_HEADER_BYTES + paletteBytes + itemCount;
  if (length >= words.byteLength) return null;
  const output = new Uint8Array(length);
  const header = new DataView(output.buffer);
  header.setUint16(0, entries.size, true);
  for (let index = 0; index < entries.size * FLOATS_PER_ITEM; index++) {
    header.setUint32(PALETTE_HEADER_BYTES + index * 4, palette[index], true);
  }
  output.set(indices, PALETTE_HEADER_BYTES + paletteBytes);
  return output;
}

/** Expand into an independently owned Float32 array without numeric conversion. */
export function decodeFloat32Palette(bytes: Uint8Array, itemCount: number): Float32Array {
  if (!Number.isSafeInteger(itemCount) || itemCount <= 0 || bytes.byteLength < PALETTE_HEADER_BYTES) {
    throw new Error("Invalid Float32 palette item count or header.");
  }
  if (itemCount > MAX_CHUNK_BYTES / BYTES_PER_ITEM) {
    throw new Error("Float32 palette exceeds the decoded texture byte limit.");
  }
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const paletteCount = header.getUint16(0, true);
  if (paletteCount < 1 || paletteCount > MAX_PALETTE_ITEMS || paletteCount > itemCount ||
      header.getUint16(2, true) !== 0) {
    throw new Error("Invalid Float32 palette count or reserved fields.");
  }
  const indicesOffset = PALETTE_HEADER_BYTES + paletteCount * BYTES_PER_ITEM;
  if (bytes.byteLength !== indicesOffset + itemCount) {
    throw new Error("Float32 palette payload length does not match its item count.");
  }
  // Validate references before allocating the expanded array.
  for (let index = indicesOffset; index < bytes.length; index++) {
    if (bytes[index] >= paletteCount) throw new Error("Float32 palette index is out of range.");
  }
  const palette = new Uint32Array(paletteCount * FLOATS_PER_ITEM);
  for (let index = 0; index < palette.length; index++) {
    palette[index] = header.getUint32(PALETTE_HEADER_BYTES + index * 4, true);
  }
  const output = new Float32Array(itemCount * FLOATS_PER_ITEM);
  const words = new Uint32Array(output.buffer);
  for (let index = 0; index < itemCount; index++) {
    const source = bytes[indicesOffset + index] * FLOATS_PER_ITEM;
    const destination = index * FLOATS_PER_ITEM;
    words[destination] = palette[source];
    words[destination + 1] = palette[source + 1];
    words[destination + 2] = palette[source + 2];
    words[destination + 3] = palette[source + 3];
  }
  return output;
}

const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

export function encodePaletteBytes(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length % BYTES_PER_ITEM !== 0) return null;
  if (littleEndian && bytes.byteOffset % 4 === 0) {
    return encodeWordPalette(new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4));
  }
  // Container codecs preserve wire bytes even on hosts with different endian
  // order, or when a caller supplied an unaligned section view.
  const words = new Uint32Array(bytes.length / 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < words.length; index++) words[index] = view.getUint32(index * 4, true);
  return encodeWordPalette(words);
}

export function decodePaletteBytes(bytes: Uint8Array, decodedLength: number): Uint8Array {
  const decoded = decodeFloat32Palette(bytes, decodedLength / BYTES_PER_ITEM);
  const output = new Uint8Array(decoded.buffer);
  if (!littleEndian) {
    const words = new Uint32Array(decoded.buffer);
    const view = new DataView(decoded.buffer);
    for (let index = 0; index < words.length; index++) view.setUint32(index * 4, words[index], true);
  }
  return output;
}
