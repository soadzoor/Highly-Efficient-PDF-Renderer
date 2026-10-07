import { throwIfAborted } from "./pdf/nativeTypes";

export type RasterCompressionFormat = "bc7" | "astc-4x4";

export interface RasterCompressionCapabilities {
  readonly bc7: boolean;
  readonly astc4x4: boolean;
}

export interface RasterCompressionFormatInfo {
  readonly blockWidth: number;
  readonly blockHeight: number;
  readonly bytesPerBlock: number;
  readonly webGpuFormat: "bc7-rgba-unorm" | "astc-4x4-unorm";
}

export interface RasterCompressionMipLayout {
  readonly width: number;
  readonly height: number;
  readonly blocksX: number;
  readonly blocksY: number;
  readonly byteOffset: number;
  readonly byteLength: number;
}

export interface RasterCompressionMipOptions {
  readonly padBase?: boolean;
  readonly mipmaps?: boolean;
  readonly mipLevelCount?: number;
}

export interface RasterCompressionMipLevel {
  readonly width: number;
  readonly height: number;
  /** Premultiplied RGBA8; a temporary display derivative, never canonical image pixels. */
  readonly data: Uint8Array;
}

export interface RasterCompressionSource {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  readonly monochrome?: unknown;
  readonly imageMask?: boolean;
  readonly stencilMask?: boolean;
  readonly exactPixels?: boolean;
  readonly containsText?: boolean;
}

export type RasterCompressionEligibilityReason = "smooth-color" | "monochrome" | "mask" | "exact-pixels" |
  "text" | "small-image" | "thin-image" | "invalid-pixels" | "alpha" | "binary" | "detailed-content";

export interface RasterCompressionEligibility {
  readonly eligible: boolean;
  readonly reason: RasterCompressionEligibilityReason;
  readonly opaque: boolean;
  readonly sampledPixels: number;
  readonly edgeFraction: number;
  readonly maxGradient: number;
}

export function rasterCompressionFormatInfo(format: RasterCompressionFormat): RasterCompressionFormatInfo {
  if (format === "bc7") return { blockWidth: 4, blockHeight: 4, bytesPerBlock: 16, webGpuFormat: "bc7-rgba-unorm" };
  if (format === "astc-4x4") return { blockWidth: 4, blockHeight: 4, bytesPerBlock: 16, webGpuFormat: "astc-4x4-unorm" };
  throw new RangeError(`Unsupported raster compression format: ${String(format)}.`);
}

export function selectRasterCompressionFormat(capabilities: RasterCompressionCapabilities): RasterCompressionFormat | null {
  return capabilities.bc7 ? "bc7" : capabilities.astc4x4 ? "astc-4x4" : null;
}

/** Physical allocation, including block rounding and the mip chain of a padded base. */
export function rasterCompressionMipLayout(
  width: number,
  height: number,
  format: RasterCompressionFormat,
  options: RasterCompressionMipOptions = {}
): RasterCompressionMipLayout[] {
  validateDimensions(width, height);
  const { blockWidth, blockHeight, bytesPerBlock } = rasterCompressionFormatInfo(format);
  let levelWidth = options.padBase === false ? width : Math.ceil(width / blockWidth) * blockWidth;
  let levelHeight = options.padBase === false ? height : Math.ceil(height / blockHeight) * blockHeight;
  validateDimensions(levelWidth, levelHeight);
  const maximumLevels = Math.floor(Math.log2(Math.max(levelWidth, levelHeight))) + 1;
  const count = options.mipmaps === false ? 1 : options.mipLevelCount ?? maximumLevels;
  if (!Number.isInteger(count) || count < 1 || count > maximumLevels) throw new RangeError("Invalid compressed mip level count.");
  const levels: RasterCompressionMipLayout[] = [];
  let byteOffset = 0;
  for (let index = 0; index < count; index++) {
    const blocksX = Math.ceil(levelWidth / blockWidth), blocksY = Math.ceil(levelHeight / blockHeight);
    const byteLength = blocksX * blocksY * bytesPerBlock;
    levels.push({ width: levelWidth, height: levelHeight, blocksX, blocksY, byteOffset, byteLength });
    byteOffset += byteLength;
    levelWidth = Math.max(1, Math.floor(levelWidth / 2));
    levelHeight = Math.max(1, Math.floor(levelHeight / 2));
  }
  return levels;
}

export function estimateCompressedRasterBytes(
  width: number,
  height: number,
  format: RasterCompressionFormat,
  mipmaps = true,
  paddedBase = true,
  mipLevelCount?: number
): number {
  return rasterCompressionMipLayout(width, height, format,
    { mipmaps, padBase: paddedBase, mipLevelCount }).reduce((sum, level) => sum + level.byteLength, 0);
}

/** Yield the same temporary physical mip pixels to every encoder, retaining only current and next levels. */
export function* buildRasterCompressionMipChain(
  source: Uint8Array,
  width: number,
  height: number,
  signal?: AbortSignal
): Generator<RasterCompressionMipLevel> {
  throwIfAborted(signal);
  validateDimensions(width, height);
  if (!(source instanceof Uint8Array) || source.length < width * height * 4) throw new RangeError("Insufficient compression source pixels.");
  let levelWidth = Math.ceil(width / 4) * 4, levelHeight = Math.ceil(height / 4) * 4;
  validateDimensions(levelWidth, levelHeight);
  let data = source;
  if (levelWidth !== width || levelHeight !== height) {
    data = new Uint8Array(levelWidth * levelHeight * 4);
    for (let y = 0; y < levelHeight; y++) {
      if ((y & 63) === 0) throwIfAborted(signal);
      const sourceY = Math.min(height - 1, y);
      const sourceRow = source.subarray(sourceY * width * 4, (sourceY + 1) * width * 4);
      data.set(sourceRow, y * levelWidth * 4);
      const edge = sourceRow.subarray((width - 1) * 4);
      for (let x = width; x < levelWidth; x++) data.set(edge, (y * levelWidth + x) * 4);
    }
  }
  yield { width: levelWidth, height: levelHeight, data };
  while (levelWidth > 1 || levelHeight > 1) {
    throwIfAborted(signal);
    const nextWidth = Math.max(1, Math.floor(levelWidth / 2)), nextHeight = Math.max(1, Math.floor(levelHeight / 2));
    const next = new Uint8Array(nextWidth * nextHeight * 4);
    for (let y = 0; y < nextHeight; y++) {
      if ((y & 63) === 0) throwIfAborted(signal);
      const y0 = Math.min(levelHeight - 1, y * 2), y1 = Math.min(levelHeight - 1, y0 + 1);
      for (let x = 0; x < nextWidth; x++) {
        const x0 = Math.min(levelWidth - 1, x * 2), x1 = Math.min(levelWidth - 1, x0 + 1);
        for (let channel = 0; channel < 4; channel++) {
          next[(y * nextWidth + x) * 4 + channel] = (data[(y0 * levelWidth + x0) * 4 + channel] +
            data[(y0 * levelWidth + x1) * 4 + channel] + data[(y1 * levelWidth + x0) * 4 + channel] +
            data[(y1 * levelWidth + x1) * 4 + channel] + 2) >> 2;
        }
      }
    }
    data = next;
    levelWidth = nextWidth;
    levelHeight = nextHeight;
    yield { width: levelWidth, height: levelHeight, data };
  }
}

/** Conservative content heuristic; source codec or filename never establishes photographic content. */
export function assessRasterCompression(source: RasterCompressionSource): RasterCompressionEligibility {
  const result = (reason: RasterCompressionEligibilityReason, opaque = false, sampledPixels = 0,
    edgeFraction = 0, maxGradient = 0): RasterCompressionEligibility =>
    ({ eligible: reason === "smooth-color", reason, opaque, sampledPixels, edgeFraction, maxGradient });
  // Inspect metadata first: an enumerable packed-image RGBA getter must stay untouched.
  if (source.monochrome) return result("monochrome");
  if (source.imageMask || source.stencilMask) return result("mask");
  if (source.exactPixels) return result("exact-pixels");
  if (source.containsText) return result("text");
  const { width, height } = source;
  if (!validDimensions(width, height)) return result("invalid-pixels");
  if (width * height < 4096) return result("small-image");
  if (Math.min(width, height) < 16) return result("thin-image");
  const data = source.data;
  if (!(data instanceof Uint8Array) || data.length < width * height * 4) return result("invalid-pixels");
  // Opacity is exact rather than sampled, so isolated mask/transparency pixels cannot slip through.
  let firstColor = -1, secondColor = -1, moreColors = false;
  for (let offset = 0; offset < width * height * 4; offset += 4) {
    if (data[offset + 3] !== 255) return result("alpha");
    if (!moreColors) {
      const color = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);
      if (firstColor < 0) firstColor = color;
      else if (color !== firstColor && color !== secondColor) {
        if (secondColor < 0) secondColor = color;
        else moreColors = true;
      }
    }
  }
  if (!moreColors) return result("binary", true);

  const blocksX = Math.ceil(width / 4), blocksY = Math.ceil(height / 4);
  const sampleColumns = Math.min(64, blocksX), sampleRows = Math.min(blocksY, Math.floor(4096 / sampleColumns));
  let sampledPixels = 0, gradients = 0, sharpEdges = 0, maxGradient = 0;
  const gradient = (a: number, b: number): void => {
    const difference = Math.max(Math.abs(data[a] - data[b]), Math.abs(data[a + 1] - data[b + 1]), Math.abs(data[a + 2] - data[b + 2]));
    gradients++;
    if (difference >= 24) sharpEdges++;
    maxGradient = Math.max(maxGradient, difference);
  };
  for (let row = 0; row < sampleRows; row++) {
    const blockY = sampleRows === 1 ? 0 : Math.floor(row * (blocksY - 1) / (sampleRows - 1));
    const startY = blockY * 4;
    for (let column = 0; column < sampleColumns; column++) {
      const blockX = sampleColumns === 1 ? 0 : Math.floor(column * (blocksX - 1) / (sampleColumns - 1));
      const startX = blockX * 4;
      for (let y = startY; y < Math.min(height, startY + 4); y++) {
        for (let x = startX; x < Math.min(width, startX + 4); x++) {
          const offset = (y * width + x) * 4;
          sampledPixels++;
          if (x + 1 < width) gradient(offset, offset + 4);
          if (y + 1 < height) gradient(offset, offset + width * 4);
        }
      }
    }
  }
  const edgeFraction = gradients ? sharpEdges / gradients : 0;
  return result(maxGradient >= 64 || edgeFraction > 0.025 ? "detailed-content" : "smooth-color",
    true, sampledPixels, edgeFraction, maxGradient);
}

function validDimensions(width: number, height: number): boolean {
  return Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0 &&
    Number.isSafeInteger(width * height * 4);
}

function validateDimensions(width: number, height: number): void {
  if (!validDimensions(width, height)) throw new RangeError("Invalid raster compression dimensions.");
}
