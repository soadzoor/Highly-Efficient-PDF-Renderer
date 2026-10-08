import { hashMonochromePixels, type MonochromeJbig2Source, type MonochromeRaster } from "./monochromeRaster";
import { hepMonochromeRasterByteLength } from "./hepMonochromeRaster";

/** HJB1 stores the PDF's original JBIG2 segments; shared globals live in their own section. */
export const HEP_JBIG2_RASTER_HEADER_BYTES = 40;
export const HEP_JBIG2_NO_GLOBALS = 0xffffffff;
export const HEP_JBIG2_MAX_DECODE_BYTES = 128 * 1024 * 1024;
const MAGIC = Uint8Array.of(0x48, 0x4a, 0x42, 0x31); // HJB1
const MAX_UINT32 = 0xffffffff;

export interface HepJbig2Raster {
  encoded: Uint8Array;
  colors: Uint8Array;
  invert: boolean;
  packedHash: readonly [number, number];
  globalsIndex: number;
  globalsLength: number;
}

function fail(message: string): never {
  throw new Error(`Invalid HEP JBIG2 raster section: ${message}.`);
}

function requireUint32(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_UINT32) fail(`${label} is out of range`);
  return value;
}

function packedBytes(width: number, height: number): number {
  return hepMonochromeRasterByteLength(width, height) - 8;
}

export function hepJbig2GlobalsFile(index: number): string {
  requireUint32(index, "globals index");
  if (index === HEP_JBIG2_NO_GLOBALS) fail("globals index is reserved");
  return `raster/jbig2-globals-${index}.bin`;
}

/** Copy encoded segments, not RGBA pixels or a newly compressed image. */
export function encodeHepJbig2Raster(
  source: MonochromeJbig2Source,
  colors: Uint8Array,
  globalsIndex: number,
  width: number,
  height: number,
  signal?: AbortSignal
): Uint8Array {
  signal?.throwIfAborted();
  packedBytes(width, height);
  if (source.width !== width || source.height !== height) fail("source dimensions do not match the layer");
  if (!(colors instanceof Uint8Array) || colors.length !== 8) fail("palette must contain exactly two RGBA colors");
  if (!(source.encoded instanceof Uint8Array) || source.encoded.length === 0) fail("encoded data is empty");
  if (!(source.globals instanceof Uint8Array)) fail("globals are not bytes");
  if (typeof source.invert !== "boolean") fail("polarity is invalid");
  if (!source.packedHash || source.packedHash.length !== 2) fail("packed pixel hash is invalid");
  const encodedLength = requireUint32(source.encoded.length, "encoded length");
  const globalsLength = requireUint32(source.globals.length, "globals length");
  requireUint32(globalsIndex, "globals index");
  if ((globalsLength === 0) !== (globalsIndex === HEP_JBIG2_NO_GLOBALS)) fail("globals reference does not match its length");
  const hash0 = requireUint32(source.packedHash[0], "packed pixel hash");
  const hash1 = requireUint32(source.packedHash[1], "packed pixel hash");
  const output = new Uint8Array(HEP_JBIG2_RASTER_HEADER_BYTES + encodedLength);
  output.set(MAGIC);
  output[4] = source.invert ? 1 : 0;
  output.set(colors, 8);
  const view = new DataView(output.buffer);
  view.setUint32(16, encodedLength, true);
  view.setUint32(20, globalsLength, true);
  view.setUint32(24, globalsIndex, true);
  view.setUint32(28, hash0, true);
  view.setUint32(32, hash1, true);
  output.set(source.encoded, HEP_JBIG2_RASTER_HEADER_BYTES);
  signal?.throwIfAborted();
  return output;
}

/** Validate the complete envelope and decode budget before entering a codec. */
export function inspectHepJbig2Raster(
  bytes: Uint8Array,
  width: number,
  height: number,
  maxBytes: number
): HepJbig2Raster {
  const outputBytes = packedBytes(width, height);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) fail("decode byte budget is out of range");
  if (!(bytes instanceof Uint8Array) || bytes.length < HEP_JBIG2_RASTER_HEADER_BYTES ||
      MAGIC.some((value, index) => bytes[index] !== value)) fail("header is invalid");
  if ((bytes[4] & ~1) || bytes[5] || bytes[6] || bytes[7]) fail("header has reserved flag bits");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(36, true) !== 0) fail("header has reserved bytes");
  const encodedLength = view.getUint32(16, true);
  const globalsLength = view.getUint32(20, true);
  const globalsIndex = view.getUint32(24, true);
  if (encodedLength === 0 || HEP_JBIG2_RASTER_HEADER_BYTES + encodedLength !== bytes.length) {
    fail("encoded byte length does not fill the section");
  }
  if ((globalsLength === 0) !== (globalsIndex === HEP_JBIG2_NO_GLOBALS)) fail("globals reference does not match its length");
  if (bytes.length > maxBytes || outputBytes + encodedLength + globalsLength > maxBytes) {
    fail("encoded data and packed pixels exceed the decode byte budget");
  }
  return {
    encoded: bytes.subarray(HEP_JBIG2_RASTER_HEADER_BYTES),
    colors: bytes.subarray(8, 16),
    invert: Boolean(bytes[4] & 1),
    globalsIndex,
    globalsLength,
    packedHash: [view.getUint32(28, true), view.getUint32(32, true)]
  };
}

/** Decode through the same bounded native kernel used when opening the PDF. */
export async function decodeHepJbig2Raster(
  bytes: Uint8Array,
  globals: Uint8Array,
  width: number,
  height: number,
  maxBytes: number,
  signal?: AbortSignal
): Promise<MonochromeRaster> {
  signal?.throwIfAborted();
  const stored = inspectHepJbig2Raster(bytes, width, height, maxBytes);
  if (!(globals instanceof Uint8Array) || globals.length !== stored.globalsLength) {
    fail("globals byte length does not match its reference");
  }
  const { decodeBundledJbig2 } = await import("./pdf/nativeJbig2Codec");
  signal?.throwIfAborted();
  const decoded = await decodeBundledJbig2({
    codec: "jbig2", width, height, components: 1, bitsPerComponent: 1, imageMask: false,
    encoded: stored.encoded, globals, decodeParameters: {}
  }, maxBytes, signal);
  const data = decoded.samples;
  const stride = Math.ceil(width / 8);
  const paddingMask = 255 << (8 - (width & 7));
  for (let row = 0; row < height; row++) {
    if ((row & 63) === 0) signal?.throwIfAborted();
    if (stored.invert) {
      const end = (row + 1) * stride;
      for (let offset = row * stride; offset < end; offset++) data[offset] ^= 255;
    }
    // Native packed grayscale conversion excludes padding from the canonical image.
    if (width & 7) data[(row + 1) * stride - 1] &= paddingMask;
  }
  const hash = hashMonochromePixels(data, width, height);
  signal?.throwIfAborted();
  if (hash[0] !== stored.packedHash[0] || hash[1] !== stored.packedHash[1]) {
    fail("decoded packed pixels do not match their stored hash");
  }
  return {
    data, colors: stored.colors,
    ...(!stored.invert && decoded.jbig2Symbols ? { symbols: decoded.jbig2Symbols } : {}),
    jbig2Source: {
      width, height, encoded: stored.encoded, globals, invert: stored.invert,
      packedHash: stored.packedHash
    }
  };
}
