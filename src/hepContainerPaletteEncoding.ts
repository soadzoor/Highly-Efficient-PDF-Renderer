import { MAX_UINT32 } from "./hepContainerShared";
import { BYTES_PER_ITEM, FLOATS_PER_ITEM, MAX_PALETTE_ITEMS, PALETTE_HEADER_BYTES, littleEndian } from "./hepContainerPalette";

// Writer-only palette codecs; readers keep only the decoder module.

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
  if (itemCount === 0 || words.byteLength > MAX_UINT32) return null;
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
