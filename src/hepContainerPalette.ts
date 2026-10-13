import { MAX_UINT32 } from "./hepContainerShared";

/** Exact Float32 vec4 palette: u16 count, u16 reserved, little-endian words, byte indices. */
export const PALETTE_HEADER_BYTES = 4;
export const FLOATS_PER_ITEM = 4;
export const BYTES_PER_ITEM = FLOATS_PER_ITEM * Float32Array.BYTES_PER_ELEMENT;
export const MAX_PALETTE_ITEMS = 256;

/** Expand into an independently owned Float32 array without numeric conversion. */
export function decodeFloat32Palette(bytes: Uint8Array, itemCount: number): Float32Array {
  if (!Number.isSafeInteger(itemCount) || itemCount <= 0 || bytes.byteLength < PALETTE_HEADER_BYTES) {
    throw new Error("Invalid Float32 palette item count or header.");
  }
  if (itemCount > MAX_UINT32 / BYTES_PER_ITEM) {
    throw new Error("Float32 palette exceeds the 32-bit decoded byte length field.");
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

export const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

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
