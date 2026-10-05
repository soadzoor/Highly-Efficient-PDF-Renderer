import type { RasterLayer, VectorScene } from "./pdfVectorExtractor";

export interface RasterAtlasBatch {
  first: number;
  count: number;
  width: number;
  height: number;
  /** Independent premultiplied mip rectangles, all stored at texture level zero. */
  data: Uint8Array;
  /** Matrix ABCD, EF/opacity/padding, then atlas XY/source width/source height. */
  instances: Float32Array;
}

const MAX_IMAGE_SIZE = 1024;
const MAX_ATLAS_SIZE = 2048;
const MAX_BATCH_IMAGES = 512;
const MAX_ATLAS_IMAGES = 16_384;
const MAX_ATLAS_BYTES = 16 * 1024 * 1024;
const MIN_BATCH_IMAGES = 4;

/**
 * Atlas storage is independent of paint order and compositing. A renderer may
 * draw only a contiguous subset of a batch, within one compatible paint span;
 * canonical image textures remain available for other submissions. Each image
 * keeps its own mip chain, so minification never samples a neighbouring image.
 */
export function buildRasterAtlasBatches(
  scene: VectorScene,
  maxTextureSize: number,
  excluded: ReadonlySet<number> = new Set()
): RasterAtlasBatch[] {
  if (!scene.drawRuns || scene.retainedPages?.length || !Number.isFinite(maxTextureSize)) return [];
  const size = Math.min(MAX_ATLAS_SIZE, Math.floor(maxTextureSize));
  if (size < 2) return [];
  const batches: RasterAtlasBatch[] = [];
  let remainingBytes = MAX_ATLAS_BYTES, remainingImages = MAX_ATLAS_IMAGES;
  for (let first = 0; first < scene.rasterLayers.length && remainingImages >= MIN_BATCH_IMAGES;) {
    const slots: { x: number; y: number }[] = [];
    let x = 0, y = 0, rowHeight = 0, width = 0, height = 0;
    while (slots.length < Math.min(MAX_BATCH_IMAGES, remainingImages) && first + slots.length < scene.rasterLayers.length) {
      const index = first + slots.length, source = scene.rasterLayers[index];
      if (excluded.has(index) || !eligible(source, size)) break;
      const slotWidth = mipChainWidth(source.width, source.height);
      let nextX = x, nextY = y, nextRowHeight = rowHeight;
      if (nextX + slotWidth > size) { nextX = 0; nextY += rowHeight; nextRowHeight = 0; }
      const nextWidth = Math.max(width, nextX + slotWidth);
      const nextHeight = Math.max(height, nextY + source.height);
      if (nextHeight > size || nextWidth * nextHeight * 4 + (slots.length + 1) * 48 > remainingBytes) break;
      slots.push({ x: nextX, y: nextY });
      x = nextX + slotWidth; y = nextY; rowHeight = Math.max(nextRowHeight, source.height);
      width = nextWidth; height = nextHeight;
    }
    if (slots.length >= MIN_BATCH_IMAGES) {
      const data = new Uint8Array(width * height * 4), instances = new Float32Array(slots.length * 12);
      for (let image = 0; image < slots.length; image++) {
        const source = scene.rasterLayers[first + image], slot = slots[image];
        instances.set(source.matrix.subarray(0, 6), image * 12);
        instances[image * 12 + 6] = source.opacity ?? 1;
        instances.set([slot.x, slot.y, source.width, source.height], image * 12 + 8);
        writeMipChain(data, width, slot.x, slot.y, source);
      }
      batches.push({ first, count: slots.length, width, height, data, instances });
      remainingBytes -= data.byteLength + instances.byteLength;
      remainingImages -= slots.length;
    }
    first += Math.max(1, slots.length);
  }
  return batches;
}

function eligible(source: RasterLayer | undefined, size: number): source is RasterLayer {
  return !!source && Number.isInteger(source.width) && Number.isInteger(source.height) &&
    source.width > 0 && source.height > 0 && source.width <= MAX_IMAGE_SIZE && source.height <= MAX_IMAGE_SIZE &&
    source.height <= size && mipChainWidth(source.width, source.height) <= size &&
    source.data instanceof Uint8Array && source.data.length >= source.width * source.height * 4 &&
    source.matrix instanceof Float32Array && source.matrix.length >= 6 && source.matrix.subarray(0, 6).every(Number.isFinite) &&
    Number.isFinite(source.opacity ?? 1) && (source.opacity ?? 1) >= 0 && (source.opacity ?? 1) <= 1;
}

function mipChainWidth(width: number, height: number): number {
  let total = width;
  while (width > 1 || height > 1) {
    width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2));
    total += width;
  }
  return total;
}

function writeMipChain(atlas: Uint8Array, stride: number, x: number, y: number, source: RasterLayer): void {
  let width = source.width, height = source.height;
  let pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    const scale = source.data[i + 3] / 255;
    for (let channel = 0; channel < 3; channel++) pixels[i + channel] = Math.round(source.data[i + channel] * scale);
    pixels[i + 3] = source.data[i + 3];
  }
  for (;;) {
    for (let row = 0; row < height; row++) {
      atlas.set(pixels.subarray(row * width * 4, (row + 1) * width * 4), ((y + row) * stride + x) * 4);
    }
    if (width === 1 && height === 1) break;
    const nextWidth = Math.max(1, Math.floor(width / 2)), nextHeight = Math.max(1, Math.floor(height / 2));
    const next = new Uint8Array(nextWidth * nextHeight * 4);
    // Normalized bilinear downsampling retains the last texel of odd-sized
    // images, like the existing WebGL strip mip builder. Driver kernels can vary.
    for (let row = 0; row < nextHeight; row++) {
      const py = (row * 2 + 1) * height - nextHeight, dy = nextHeight * 2;
      const top = Math.floor(py / dy), fy = py - top * dy, bottom = Math.min(top + 1, height - 1);
      for (let column = 0; column < nextWidth; column++) {
        const px = (column * 2 + 1) * width - nextWidth, dx = nextWidth * 2;
        const left = Math.floor(px / dx), fx = px - left * dx, right = Math.min(left + 1, width - 1);
        for (let channel = 0; channel < 4; channel++) {
          const a = pixels[(top * width + left) * 4 + channel] * (dx - fx) + pixels[(top * width + right) * 4 + channel] * fx;
          const b = pixels[(bottom * width + left) * 4 + channel] * (dx - fx) + pixels[(bottom * width + right) * 4 + channel] * fx;
          next[(row * nextWidth + column) * 4 + channel] = Math.floor((a * (dy - fy) + b * fy + dx * dy / 2) / (dx * dy));
        }
      }
    }
    x += width; width = nextWidth; height = nextHeight; pixels = next;
  }
}
