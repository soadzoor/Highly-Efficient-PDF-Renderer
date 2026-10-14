import { hashSourceJpxEncoded, hashSourceJpxRgba, type SourceJpxRaster } from "./sourceJpxRaster";

/** Original unsigned-eight-bit JPEG 2000 with an opaque canonical RGBA fingerprint. */
export const HEP_JPX_RASTER_HEADER_BYTES = 32;
const MAGIC = Uint8Array.of(0x48, 0x4a, 0x50, 0x31); // HJP1
const MAX_UINT32 = 0xffffffff;

function fail(message: string): never {
  throw new Error(`Invalid HEP JPEG 2000 raster section: ${message}.`);
}

function requireUint32(value: number, label: string, positive = false): void {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0) || value > MAX_UINT32) fail(`${label} is out of range`);
}

function rgbaByteLength(width: number, height: number): number {
  requireUint32(width, "width", true); requireUint32(height, "height", true);
  const bytes = width * height * 4;
  if (!Number.isSafeInteger(bytes)) fail("decoded RGBA length is out of range");
  return bytes;
}

/** The original encoded stream is copied; canonical pixels are never re-encoded. */
export function encodeHepJpxRaster(source: SourceJpxRaster): Uint8Array {
  rgbaByteLength(source.width, source.height);
  if (source.components !== 1 && source.components !== 3) fail("unsupported component count");
  if (!(source.encoded instanceof Uint8Array) || source.encoded.length === 0 ||
      source.encoded.length > MAX_UINT32 - HEP_JPX_RASTER_HEADER_BYTES) fail("encoded length is out of range");
  if (!Array.isArray(source.rgbaHash) || source.rgbaHash.length !== 2) fail("RGBA fingerprint is invalid");
  requireUint32(source.rgbaHash[0], "RGBA fingerprint"); requireUint32(source.rgbaHash[1], "RGBA fingerprint");
  if (!Array.isArray(source.encodedHash) || source.encodedHash.length !== 2) fail("encoded fingerprint is invalid");
  requireUint32(source.encodedHash[0], "encoded fingerprint"); requireUint32(source.encodedHash[1], "encoded fingerprint");
  const bytes = new Uint8Array(HEP_JPX_RASTER_HEADER_BYTES + source.encoded.length);
  const view = new DataView(bytes.buffer);
  bytes.set(MAGIC); bytes[5] = source.components;
  view.setUint32(8, source.width, true); view.setUint32(12, source.height, true);
  view.setUint32(16, source.encoded.length, true);
  view.setUint32(20, source.rgbaHash[0], true); view.setUint32(24, source.rgbaHash[1], true);
  bytes.set(source.encoded, HEP_JPX_RASTER_HEADER_BYTES);
  return bytes;
}

/** Validate the complete envelope and mandatory SIZ marker before decoder allocation. */
export async function inspectHepJpxRaster(bytes: Uint8Array, width: number, height: number,
  signal?: AbortSignal): Promise<SourceJpxRaster> {
  signal?.throwIfAborted();
  rgbaByteLength(width, height);
  if (!(bytes instanceof Uint8Array) || bytes.length < HEP_JPX_RASTER_HEADER_BYTES ||
      MAGIC.some((value, index) => bytes[index] !== value)) fail("header is invalid");
  if (bytes[4] || bytes[6] || bytes[7]) fail("header has reserved flags");
  const components = bytes[5];
  if (components !== 1 && components !== 3) fail("unsupported component count");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(28, true) !== 0) fail("header has reserved bytes");
  if (view.getUint32(8, true) !== width || view.getUint32(12, true) !== height) fail("dimensions disagree with the raster layer");
  const encodedLength = view.getUint32(16, true);
  if (!encodedLength || HEP_JPX_RASTER_HEADER_BYTES + encodedLength !== bytes.length) fail("encoded length does not fill the section");
  const encoded = bytes.subarray(HEP_JPX_RASTER_HEADER_BYTES);
  const { readJpxProperties } = await import("./pdf/nativeJpxCodec");
  signal?.throwIfAborted();
  const properties = readJpxProperties(encoded);
  if (properties.width !== width || properties.height !== height || properties.components !== components) {
    fail("codestream dimensions or components disagree with the envelope");
  }
  if (!properties.unsignedBytes) fail("codestream must use unsigned eight-bit samples");
  signal?.throwIfAborted();
  return { width, height, components, encoded, encodedHash: hashSourceJpxEncoded(encoded, signal),
    rgbaHash: [view.getUint32(20, true), view.getUint32(24, true)] };
}

/** Use the same lazy native kernel and canonical Gray/RGB mapping as the PDF reader. */
export async function decodeHepJpxRaster(bytes: Uint8Array, width: number, height: number,
  signal?: AbortSignal): Promise<{ data: Uint8Array; sourceJpx: SourceJpxRaster }> {
  signal?.throwIfAborted();
  const sourceJpx = await inspectHepJpxRaster(bytes, width, height, signal);
  const { decodeBundledJpx } = await import("./pdf/nativeJpxCodec");
  signal?.throwIfAborted();
  const decoded = await decodeBundledJpx({ codec: "jpeg2000", encoded: sourceJpx.encoded,
    width, height, components: sourceJpx.components, bitsPerComponent: 8, imageMask: false,
    globals: new Uint8Array(0), decodeParameters: {} }, Number.MAX_SAFE_INTEGER, signal);
  signal?.throwIfAborted();
  const pixelCount = width * height, components = sourceJpx.components;
  if (decoded.width !== width || decoded.height !== height || decoded.components !== components ||
      decoded.bitsPerComponent !== 8 || !(decoded.samples instanceof Uint8Array) ||
      decoded.samples.length !== pixelCount * components) fail("decoded sample layout disagrees with the envelope");
  const data = new Uint8Array(rgbaByteLength(width, height)), samples = decoded.samples;
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    if ((pixel & 16383) === 0) signal?.throwIfAborted();
    const source = pixel * components, target = pixel * 4;
    data[target] = samples[source];
    data[target + 1] = samples[source + (components === 1 ? 0 : 1)];
    data[target + 2] = samples[source + (components === 1 ? 0 : 2)];
    data[target + 3] = 255;
  }
  const hash = hashSourceJpxRgba(data, width, height, signal);
  signal?.throwIfAborted();
  if (hash[0] !== sourceJpx.rgbaHash[0] || hash[1] !== sourceJpx.rgbaHash[1]) fail("decoded pixels do not match their stored RGBA fingerprint");
  return { data, sourceJpx };
}
