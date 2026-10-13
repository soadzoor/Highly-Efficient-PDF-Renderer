import type { Bounds } from "./pdfVectorExtractor";

/** A reusable raster cell and its integer grid, without a scene object per repetition. */
export interface RasterRepeat {
  /** Pattern-to-scene matrix before the PDF cell transform is rounded to Float32. */
  readonly transform: Float64Array;
  /** Cropped cell rectangle [minX, minY, maxX, maxY] in pattern coordinates. */
  readonly bounds: Float64Array;
  readonly xStep: number;
  readonly yStep: number;
  readonly xFirst: number;
  readonly xLast: number;
  readonly yFirst: number;
  readonly yLast: number;
  /** Page placements, each applied after Float32 cell storage, in composition order. */
  readonly translations?: Float64Array;
}

export function rasterRepeatCount(repeat: RasterRepeat): number {
  const columns = repeat.xLast - repeat.xFirst + 1, rows = repeat.yLast - repeat.yFirst + 1;
  if (![repeat.xFirst, repeat.xLast, repeat.yFirst, repeat.yLast, columns, rows, columns * rows].every(Number.isSafeInteger) ||
      columns < 1 || rows < 1) throw new RangeError("Invalid raster repeat cell range.");
  return columns * rows;
}

export function validateRasterRepeat(repeat: RasterRepeat): void {
  if (!repeat || !(repeat.transform instanceof Float64Array) || repeat.transform.length !== 6 ||
      !(repeat.bounds instanceof Float64Array) || repeat.bounds.length !== 4 ||
      !repeat.transform.every(Number.isFinite) || !repeat.bounds.every(Number.isFinite) ||
      !Number.isFinite(repeat.xStep) || !Number.isFinite(repeat.yStep) || !repeat.xStep || !repeat.yStep ||
      (repeat.translations !== undefined && (!(repeat.translations instanceof Float64Array) ||
        repeat.translations.length % 2 !== 0 || !repeat.translations.every(Number.isFinite)))) {
    throw new RangeError("Invalid raster repeat geometry.");
  }
  const [a, b, c, d] = repeat.transform, bounds = repeat.bounds;
  if (!((a !== 0 && d !== 0 && b === 0 && c === 0) || (b !== 0 && c !== 0 && a === 0 && d === 0)) ||
      bounds[2] <= bounds[0] || bounds[3] <= bounds[1] ||
      bounds[2] - bounds[0] > Math.abs(repeat.xStep) || bounds[3] - bounds[1] > Math.abs(repeat.yStep)) {
    throw new RangeError("Raster repeats require nonoverlapping axis-aligned cells.");
  }
  rasterRepeatCount(repeat);
  const matrix = new Float32Array(6);
  for (const y of [repeat.yFirst, repeat.yLast]) for (const x of [repeat.xFirst, repeat.xLast]) {
    rasterRepeatMatrix(repeat, x, y, matrix);
    if (!matrix.every(Number.isFinite)) throw new RangeError("Raster repeat coordinates exceed Float32 storage.");
  }
}

/** Match the original PDF lowering's two Float32 stores, then each page placement store. */
export function rasterRepeatMatrix(repeat: RasterRepeat, x: number, y: number,
  out = new Float32Array(6), offset = 0): Float32Array {
  const [a0, b0, c0, d0, e0, f0] = repeat.transform, [minX, minY, maxX, maxY] = repeat.bounds;
  const a = Math.fround(a0), b = Math.fround(b0), c = Math.fround(c0), d = Math.fround(d0);
  const e = Math.fround(a0 * (x * repeat.xStep) + c0 * (y * repeat.yStep) + e0);
  const f = Math.fround(b0 * (x * repeat.xStep) + d0 * (y * repeat.yStep) + f0);
  const width = maxX - minX, height = minY - maxY;
  out[offset] = a * width + c * 0; out[offset + 1] = b * width + d * 0;
  out[offset + 2] = a * 0 + c * height; out[offset + 3] = b * 0 + d * height;
  out[offset + 4] = a * minX + c * maxY + e; out[offset + 5] = b * minX + d * maxY + f;
  const translations = repeat.translations;
  if (translations) for (let index = 0; index < translations.length; index += 2) {
    out[offset + 4] += translations[index]; out[offset + 5] += translations[index + 1];
  }
  return out;
}

/** One contiguous vertex payload; neither compilation nor rendering needs per-cell objects. */
export function buildRasterRepeatInstances(repeat: RasterRepeat, signal?: AbortSignal): Float32Array {
  validateRasterRepeat(repeat); signal?.throwIfAborted();
  const count = rasterRepeatCount(repeat);
  if (!Number.isSafeInteger(count * 6)) throw new RangeError("Raster repeat vertex storage exceeds a safe array length.");
  const data = new Float32Array(count * 6), columns = repeat.xLast - repeat.xFirst + 1, rows = repeat.yLast - repeat.yFirst + 1;
  let offset = 0;
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    if ((offset & 16383) === 0) signal?.throwIfAborted();
    rasterRepeatMatrix(repeat, repeat.xFirst + column, repeat.yFirst + row, data, offset); offset += 6;
  }
  return data;
}

export function rasterRepeatBounds(repeat: RasterRepeat): Bounds {
  const result: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }, matrix = new Float32Array(6);
  for (const y of [repeat.yFirst, repeat.yLast]) for (const x of [repeat.xFirst, repeat.xLast]) {
    rasterRepeatMatrix(repeat, x, y, matrix);
    for (let corner = 0; corner < 4; corner++) {
      const u = corner & 1, v = corner >> 1;
      const px = matrix[0] * u + matrix[2] * v + matrix[4], py = matrix[1] * u + matrix[3] * v + matrix[5];
      result.minX = Math.min(result.minX, px, Math.fround(px)); result.maxX = Math.max(result.maxX, px, Math.fround(px));
      result.minY = Math.min(result.minY, py, Math.fround(py)); result.maxY = Math.max(result.maxY, py, Math.fround(py));
    }
  }
  return result;
}

export function translateRasterRepeat(repeat: RasterRepeat, x: number, y: number): RasterRepeat {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError("Invalid raster repeat translation.");
  const previous = repeat.translations, translations = new Float64Array((previous?.length ?? 0) + 2);
  if (previous) translations.set(previous);
  translations.set([x, y], translations.length - 2);
  return { ...repeat, translations };
}

/** Locate a cell in logarithmic time, preserving true gaps and Float32 page-placement rounding. */
export function rasterRepeatPoint(repeat: RasterRepeat, x: number, y: number): { x: number; y: number } | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const matrix = new Float32Array(6), diagonal = repeat.transform[0] !== 0;
  const find = (horizontal: boolean): number | null => {
    const first = horizontal ? repeat.xFirst : repeat.yFirst, last = horizontal ? repeat.xLast : repeat.yLast;
    const axis = horizontal === diagonal ? 0 : 1, value = axis === 0 ? x : y;
    const increasing = (horizontal ? repeat.xStep * repeat.transform[diagonal ? 0 : 1]
      : repeat.yStep * repeat.transform[diagonal ? 3 : 2]) > 0;
    const indexAt = (index: number) => increasing ? first + index : last - index;
    let low = 0, high = last - first + 1;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2), index = indexAt(middle);
      rasterRepeatMatrix(repeat, horizontal ? index : repeat.xFirst, horizontal ? repeat.yFirst : index, matrix);
      const minimum = matrix[4 + axis] + Math.min(0, matrix[axis], matrix[2 + axis], matrix[axis] + matrix[2 + axis]);
      if (minimum <= value) low = middle + 1; else high = middle;
    }
    return low ? indexAt(low - 1) : null;
  };
  const cellX = find(true), cellY = find(false);
  if (cellX === null || cellY === null) return null;
  rasterRepeatMatrix(repeat, cellX, cellY, matrix);
  const [a, b, c, d, e, f] = matrix, determinant = a * d - b * c;
  if (!determinant) return null;
  const u = (d * (x - e) - c * (y - f)) / determinant, v = (-b * (x - e) + a * (y - f)) / determinant;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? { x: u, y: v } : null;
}
