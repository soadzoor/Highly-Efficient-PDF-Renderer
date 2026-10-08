import type { MonochromeRaster } from "./monochromeRaster";

/** Zero-bit and one-bit straight-alpha RGBA8 colors precede the packed rows. */
const PALETTE_BYTES = 8;
const MAX_DIMENSION = 0x7fffffff;

function fail(message: string): never {
  throw new Error(`Invalid HEP monochrome raster section: ${message}.`);
}

/** Exact uncompressed section size; validate it before inflating a layer. */
export function hepMonochromeRasterByteLength(width: number, height: number): number {
  if (!Number.isSafeInteger(width) || width < 1 || width > MAX_DIMENSION ||
      !Number.isSafeInteger(height) || height < 1 || height > MAX_DIMENSION) {
    fail("dimensions are out of range");
  }
  const bytes = PALETTE_BYTES + Math.ceil(width / 8) * height;
  if (!Number.isSafeInteger(bytes)) fail("byte length is out of range");
  return bytes;
}

/**
 * Preserve the canonical one-bit pixels without expanding RGBA or running an
 * image encoder. HEP's section compression handles these packed bytes. Row
 * padding and both palette alpha values are stored unchanged; viewing-only
 * symbol dictionaries and GPU derivatives do not belong to this section.
 */
export function encodeHepMonochromeRaster(
  monochrome: MonochromeRaster,
  width: number,
  height: number,
  signal?: AbortSignal
): Uint8Array {
  signal?.throwIfAborted();
  const bytes = hepMonochromeRasterByteLength(width, height);
  if (!(monochrome.colors instanceof Uint8Array) || monochrome.colors.length !== PALETTE_BYTES) {
    fail("palette must contain exactly two RGBA colors");
  }
  if (!(monochrome.data instanceof Uint8Array) || monochrome.data.length !== bytes - PALETTE_BYTES) {
    fail("packed byte length does not match its dimensions");
  }
  const out = new Uint8Array(bytes);
  out.set(monochrome.colors);
  out.set(monochrome.data, PALETTE_BYTES);
  return out;
}

/** Restore packed rows as views of the inflated section, with no RGBA allocation. */
export function decodeHepMonochromeRaster(bytes: Uint8Array, width: number, height: number): MonochromeRaster {
  const expected = hepMonochromeRasterByteLength(width, height);
  if (!(bytes instanceof Uint8Array) || bytes.length !== expected) {
    fail("byte length does not match its dimensions");
  }
  return { colors: bytes.subarray(0, PALETTE_BYTES), data: bytes.subarray(PALETTE_BYTES) };
}
