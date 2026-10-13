import type { RasterLayer } from "./pdfVectorExtractor";
import { validateRasterRepeat, type RasterRepeat } from "./rasterRepeat";

export const SCENE_RASTER_REPEATS_PATH = "geometry/raster-repeats.f64";
export const HEP_RASTER_REPEAT_HEADER_BYTES = 4;
export const HEP_RASTER_REPEAT_RECORD_BYTES = 136;

function fail(message: string): never {
  throw new Error(`Invalid HEP raster repeats section: ${message}.`);
}

/** Exact decoded size, including sequential post-float32 translation pairs. */
export function hepRasterRepeatsByteLength(count: number, translationCount: number): number {
  if (!Number.isSafeInteger(count) || count < 1 || count > 0xffffffff ||
      !Number.isSafeInteger(translationCount) || translationCount < 0) fail("counts are out of range");
  const bytes = HEP_RASTER_REPEAT_HEADER_BYTES + count * HEP_RASTER_REPEAT_RECORD_BYTES + translationCount * 16;
  if (!Number.isSafeInteger(bytes)) fail("byte length is out of range");
  return bytes;
}

/** Keep one record per repeat paint, without materializing any of its cells. */
export function encodeHepRasterRepeats(layers: readonly RasterLayer[], signal?: AbortSignal):
  { bytes: Uint8Array; count: number; translationCount: number } | undefined {
  signal?.throwIfAborted();
  const entries: { index: number; repeat: RasterRepeat }[] = [];
  let translationCount = 0;
  for (let index = 0; index < layers.length; index++) {
    signal?.throwIfAborted();
    const repeat = layers[index].repeat;
    if (!repeat) continue;
    if (index > 0xffffffff) fail("layer index is out of range");
    validateRasterRepeat(repeat);
    const pairs = (repeat.translations?.length ?? 0) / 2;
    if (pairs > 0xffffffff) fail("translation count is out of range");
    translationCount += pairs;
    entries.push({ index, repeat });
  }
  if (!entries.length) return undefined;
  const bytes = new Uint8Array(hepRasterRepeatsByteLength(entries.length, translationCount));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, entries.length, true);
  let offset = HEP_RASTER_REPEAT_HEADER_BYTES;
  for (const { index, repeat } of entries) {
    signal?.throwIfAborted();
    const pairs = (repeat.translations?.length ?? 0) / 2;
    view.setUint32(offset, index, true);
    view.setUint32(offset + 4, pairs, true);
    offset += 8;
    for (const values of [repeat.transform, repeat.bounds,
      [repeat.xStep, repeat.yStep, repeat.xFirst, repeat.xLast, repeat.yFirst, repeat.yLast], repeat.translations ?? []]) {
      for (const value of values) {
        signal?.throwIfAborted();
        view.setFloat64(offset, value, true);
        offset += 8;
      }
    }
  }
  return { bytes, count: entries.length, translationCount };
}

export function decodeHepRasterRepeats(bytes: Uint8Array, layerCount: number, count: number,
  translationCount: number, signal?: AbortSignal): Map<number, RasterRepeat> {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(layerCount) || layerCount < count || layerCount > 0xffffffff) fail("layer count is out of range");
  if (bytes.length !== hepRasterRepeatsByteLength(count, translationCount)) fail("byte length does not match its counts");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== count) fail("record count does not match its descriptor");
  const result = new Map<number, RasterRepeat>();
  let offset = HEP_RASTER_REPEAT_HEADER_BYTES, previous = -1, translationsRead = 0;
  const read = (length: number): Float64Array => {
    if (length * 8 > bytes.length - offset) fail("truncated record");
    const values = new Float64Array(length);
    for (let i = 0; i < length; i++) {
      signal?.throwIfAborted();
      values[i] = view.getFloat64(offset, true);
      offset += 8;
    }
    return values;
  };
  for (let i = 0; i < count; i++) {
    signal?.throwIfAborted();
    if (offset + HEP_RASTER_REPEAT_RECORD_BYTES > bytes.length) fail("truncated record");
    const index = view.getUint32(offset, true), pairs = view.getUint32(offset + 4, true);
    if (index <= previous || index >= layerCount) fail("layer indices must be increasing, unique and in range");
    if (pairs > translationCount - translationsRead) fail("translation count exceeds its descriptor");
    previous = index;
    translationsRead += pairs;
    offset += 8;
    const transform = read(6), bounds = read(4), grid = read(6);
    const repeat: RasterRepeat = { transform, bounds, xStep: grid[0], yStep: grid[1],
      xFirst: grid[2], xLast: grid[3], yFirst: grid[4], yLast: grid[5],
      ...(pairs ? { translations: read(pairs * 2) } : {}) };
    validateRasterRepeat(repeat);
    result.set(index, repeat);
  }
  if (offset !== bytes.length || translationsRead !== translationCount) fail("trailing data or incorrect translation count");
  return result;
}
