import type { RasterLayer, VectorScene } from "./pdfVectorExtractor";
import { detectMonochromeRaster } from "./monochromeRaster";

export interface RasterStripBatch {
  first: number;
  count: number;
  width: number;
  height: number;
  /** Each row contains one premultiplied image followed by its independent mip levels. */
  data: Uint8Array;
  /** Two vec4s per image: matrix ABCD, then EF, original width and opacity. */
  instances: Float32Array;
}

const MAX_STRIP_WIDTH = 1024;
const MAX_BATCH_ROWS = 512;
const MAX_BATCH_BYTES = 16 * 1024 * 1024;
const MIN_BATCH_ROWS = 4;

/**
 * Some PDFs encode imagery as thousands of single-row images. Keep their
 * original quads and paint order, but store independent mip chains together
 * for instanced drawing. Hardware atlas mipmaps would blend unrelated images;
 * the strip shader instead samples each level within its own row and bounds.
 * Canonical images remain available for partial draws and live replacements.
 */
export function buildRasterStripBatches(
  scene: VectorScene,
  maxTextureSize: number,
  mipFilter: "box" | "linear" = "box"
): RasterStripBatch[] {
  if (!scene.drawRuns || scene.paintGraph || scene.retainedPages?.length ||
      !Number.isFinite(maxTextureSize) || maxTextureSize < MIN_BATCH_ROWS) return [];
  const maxWidth = Math.min(MAX_STRIP_WIDTH, Math.floor(maxTextureSize / 2));
  const maxRows = Math.min(MAX_BATCH_ROWS, Math.floor(maxTextureSize));
  const batches: RasterStripBatch[] = [];
  let remainingBytes = MAX_BATCH_BYTES;
  const used = new Set<number>();
  for (const run of scene.drawRuns) {
    if (run.kind !== "raster" || run.blendMode) continue;
    const end = Math.min(scene.rasterLayers.length, run.first + run.count);
    let first = run.first;
    while (first < end) {
      if (used.has(first) || !isStrip(scene.rasterLayers[first], maxWidth)) { first++; continue; }
      let count = 0, width = 0;
      while (first + count < end && count < maxRows && !used.has(first + count)) {
        const source = scene.rasterLayers[first + count];
        if (!isStrip(source, maxWidth)) break;
        const nextWidth = Math.max(width, source.width * 2);
        if ((nextWidth * 4 + 32) * (count + 1) > remainingBytes) break;
        width = nextWidth;
        count++;
      }
      if (count >= MIN_BATCH_ROWS) {
        const data = new Uint8Array(width * count * 4);
        const instances = new Float32Array(count * 8);
        for (let row = 0; row < count; row++) {
          const source = scene.rasterLayers[first + row];
          instances.set(source.matrix.subarray(0, 6), row * 8);
          instances[row * 8 + 6] = source.width;
          instances[row * 8 + 7] = source.opacity ?? 1;
          writeMipRow(data, row * width * 4, source, mipFilter);
          used.add(first + row);
        }
        batches.push({ first, count, width, height: count, data, instances });
        remainingBytes -= data.byteLength + instances.byteLength;
      }
      first += Math.max(1, count);
    }
  }
  return batches;
}

function isStrip(source: RasterLayer | undefined, maxWidth: number): source is RasterLayer {
  return !!source && !source.monochrome && source.height === 1 && Number.isInteger(source.width) && source.width > 0 &&
    source.width <= maxWidth && source.data instanceof Uint8Array && source.data.length >= source.width * 4 &&
    !detectMonochromeRaster(source.data, source.width, source.height) &&
    source.matrix instanceof Float32Array && source.matrix.length >= 6 &&
    source.matrix.subarray(0, 6).every(Number.isFinite) &&
    Number.isFinite(source.opacity ?? 1) && (source.opacity ?? 1) >= 0 && (source.opacity ?? 1) <= 1;
}

function writeMipRow(target: Uint8Array, offset: number, source: RasterLayer, mipFilter: "box" | "linear"): void {
  let width = source.width;
  for (let x = 0; x < width; x++) {
    const pixel = x * 4, alpha = source.data[pixel + 3];
    for (let channel = 0; channel < 3; channel++) {
      target[offset + pixel + channel] = Math.round(source.data[pixel + channel] * alpha / 255);
    }
    target[offset + pixel + 3] = alpha;
  }
  // WebGPU's existing CPU mip builder uses a box filter. WebGL normally uses
  // normalized linear downsampling for generateMipmap (driver kernels can
  // differ). Respect odd widths in that mode instead of dropping the last
  // texel. Neither filter can sample outside this image's own mip level.
  while (width > 1) {
    const nextWidth = Math.floor(width / 2), nextOffset = offset + width * 4;
    const denominator = mipFilter === "linear" ? nextWidth * 2 : 2;
    for (let x = 0; x < nextWidth; x++) {
      // Integer weights avoid unstable half-byte rounding at texel centers.
      const numerator = mipFilter === "linear" ? (x * 2 + 1) * width - nextWidth : x * 4 + 1;
      const left = Math.floor(numerator / denominator), weight = numerator - left * denominator;
      for (let channel = 0; channel < 4; channel++) {
        target[nextOffset + x * 4 + channel] = Math.floor((
          target[offset + left * 4 + channel] * (denominator - weight) +
          target[offset + (left + 1) * 4 + channel] * weight + denominator / 2
        ) / denominator);
      }
    }
    offset = nextOffset;
    width = nextWidth;
  }
}
