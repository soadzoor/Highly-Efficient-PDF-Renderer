import type { RasterLayer, VectorScene } from "./pdfVectorExtractor";
import type { RasterTile } from "./rasterTiles";
import type { SingleChannelUint8MipLevel } from "./singleChannelMipChain";
import { throwIfAborted } from "./pdf/nativeTypes";

/** Packed, MSB-first rows and straight-alpha RGBA colors for the zero and one bits. */
export interface MonochromeRaster {
  data: Uint8Array;
  colors: Uint8Array;
}

/** Materialize RGBA only for consumers that cannot use the packed representation. */
export function expandMonochromeRaster(
  monochrome: MonochromeRaster,
  width: number,
  height: number,
  signal?: AbortSignal
): Uint8Array {
  throwIfAborted(signal);
  const stride = validateMonochromeRaster(monochrome, width, height);
  const out = new Uint8Array(width * height * 4);
  const { data, colors } = monochrome;
  for (let y = 0; y < height; y++) {
    if ((y & 63) === 0) throwIfAborted(signal);
    for (let x = 0; x < width; x++) {
      const color = ((data[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1) * 4;
      const target = (y * width + x) * 4;
      out[target] = colors[color];
      out[target + 1] = colors[color + 1];
      out[target + 2] = colors[color + 2];
      out[target + 3] = colors[color + 3];
    }
  }
  return out;
}

/** Keep legacy RGBA access available without allocating it for packed-image renderers. */
export function createMonochromeRasterLayer(
  base: Omit<RasterLayer, "data" | "monochrome">,
  monochrome: MonochromeRaster
): RasterLayer {
  validateMonochromeRaster(monochrome, base.width, base.height);
  let rgba: Uint8Array | undefined;
  return Object.defineProperty({ ...base, monochrome }, "data", {
    enumerable: true,
    configurable: true,
    get: () => rgba ??= expandMonochromeRaster(monochrome, base.width, base.height)
  }) as RasterLayer;
}

/** Copy placement metadata without reading an enumerable lazy RGBA getter. */
export function copyRasterLayer(
  layer: RasterLayer,
  overrides: Partial<Omit<RasterLayer, "data" | "monochrome">> = {}
): RasterLayer {
  return Object.assign(
    Object.defineProperties({}, Object.getOwnPropertyDescriptors(layer)),
    overrides
  ) as RasterLayer;
}

/** Send packed images across workers without structured cloning their lazy RGBA getters. */
export function prepareMonochromeSceneTransfer(scene: VectorScene): VectorScene {
  if (!scene.rasterLayers.some(layer => layer.monochrome)) return scene;
  const layers = scene.rasterLayers.map(layer => {
    if (!layer.monochrome) return layer;
    const descriptors = Object.getOwnPropertyDescriptors(layer);
    // Retained images and later page compiles can share these buffers with the layer.
    // Transfer only worker-owned copies of the compact payload, never cached bytes.
    descriptors.monochrome = dataDescriptor({
      data: new Uint8Array(layer.monochrome.data),
      colors: new Uint8Array(layer.monochrome.colors)
    });
    descriptors.data = dataDescriptor(new Uint8Array(0));
    return Object.defineProperties({}, descriptors) as RasterLayer;
  });
  const descriptors = Object.getOwnPropertyDescriptors(scene);
  descriptors.rasterLayers = dataDescriptor(layers);
  if (layers[0]?.monochrome) descriptors.rasterLayerData = dataDescriptor(new Uint8Array(0));
  return Object.defineProperties({}, descriptors) as VectorScene;
}

/** Rebuild packed-image compatibility getters after a worker's plain-data transport. */
export function restoreMonochromeSceneTransfer(scene: VectorScene): VectorScene {
  if (!scene.rasterLayers.some(layer => layer.monochrome)) return scene;
  const layers = scene.rasterLayers.map(layer => {
    if (!layer.monochrome) return layer;
    const descriptors: PropertyDescriptorMap = Object.getOwnPropertyDescriptors(layer);
    delete descriptors.data;
    delete descriptors.monochrome;
    const base = Object.defineProperties({}, descriptors) as Omit<RasterLayer, "data" | "monochrome">;
    return createMonochromeRasterLayer(base, layer.monochrome);
  });
  const descriptors = Object.getOwnPropertyDescriptors(scene);
  descriptors.rasterLayers = dataDescriptor(layers);
  if (layers[0]?.monochrome) {
    descriptors.rasterLayerData = {
      enumerable: true,
      configurable: true,
      get: () => layers[0].data
    };
  }
  return Object.defineProperties({}, descriptors) as VectorScene;
}

function dataDescriptor(value: unknown): PropertyDescriptor {
  return { value, enumerable: true, configurable: true, writable: true };
}

/** Recover packed storage from legacy RGBA images with at most two exact colors. */
export function detectMonochromeRaster(
  source: Uint8Array,
  width: number,
  height: number
): MonochromeRaster | null {
  if (!validDimensions(width, height) || width * height < 256 || source.length !== width * height * 4) return null;
  const color0 = packedRgba(source, 0);
  let color1 = color0;
  let hasSecondColor = false;
  for (let offset = 4; offset < source.length; offset += 4) {
    const color = packedRgba(source, offset);
    if (color === color0 || (hasSecondColor && color === color1)) continue;
    if (hasSecondColor) return null;
    color1 = color;
    hasSecondColor = true;
  }

  const colors = new Uint8Array(8);
  colors.set(source.subarray(0, 4));
  colors[4] = color1 & 255;
  colors[5] = (color1 >>> 8) & 255;
  colors[6] = (color1 >>> 16) & 255;
  colors[7] = color1 >>> 24;
  const stride = Math.ceil(width / 8);
  const data = new Uint8Array(stride * height);
  if (hasSecondColor) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (packedRgba(source, (y * width + x) * 4) === color1) data[y * stride + (x >> 3)] |= 128 >> (x & 7);
      }
    }
  }
  return { data, colors };
}

/** Extract a tile directly from packed rows, including non-byte-aligned origins. */
export function monochromeRasterTile(
  monochrome: MonochromeRaster,
  sourceWidth: number,
  sourceHeight: number,
  tile: RasterTile,
  signal?: AbortSignal
): MonochromeRaster {
  throwIfAborted(signal);
  const sourceStride = validateMonochromeRaster(monochrome, sourceWidth, sourceHeight);
  if (!validDimensions(tile.width, tile.height) || !Number.isInteger(tile.x) || !Number.isInteger(tile.y) ||
      tile.x < 0 || tile.y < 0 || tile.x + tile.width > sourceWidth || tile.y + tile.height > sourceHeight) {
    throw new RangeError("Monochrome raster tile must fit within its source image.");
  }
  if (tile.x === 0 && tile.y === 0 && tile.width === sourceWidth && tile.height === sourceHeight) return monochrome;
  const stride = Math.ceil(tile.width / 8);
  const data = new Uint8Array(stride * tile.height);
  const bitOffset = tile.x & 7;
  const byteOffset = tile.x >> 3;
  const lastByteMask = tile.width & 7 ? 255 << (8 - (tile.width & 7)) : 255;
  for (let y = 0; y < tile.height; y++) {
    if ((y & 63) === 0) throwIfAborted(signal);
    const sourceRow = (tile.y + y) * sourceStride;
    for (let x = 0; x < stride; x++) {
      const index = byteOffset + x;
      data[y * stride + x] = (monochrome.data[sourceRow + index] << bitOffset) |
        (bitOffset && index + 1 < sourceStride ? monochrome.data[sourceRow + index + 1] >> (8 - bitOffset) : 0);
    }
    data[y * stride + stride - 1] &= lastByteMask;
  }
  return { data, colors: monochrome.colors };
}

/** Area-averaged coverage below the packed base, retaining odd-edge texels without unpacking the base. */
export function buildMonochromeMipChain(
  monochrome: MonochromeRaster,
  width: number,
  height: number,
  signal?: AbortSignal
): SingleChannelUint8MipLevel[] {
  throwIfAborted(signal);
  const stride = validateMonochromeRaster(monochrome, width, height);
  const chain: SingleChannelUint8MipLevel[] = [];
  let levelWidth = width, levelHeight = height;
  let sample = (x: number, y: number): number =>
    ((monochrome.data[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1) * 255;
  while (levelWidth > 1 || levelHeight > 1) {
    throwIfAborted(signal);
    const nextWidth = Math.max(1, levelWidth >> 1);
    const nextHeight = Math.max(1, levelHeight >> 1);
    const data = new Uint8Array(nextWidth * nextHeight);
    // Scale source-cell edges by the target size so overlap weights stay integral.
    // Each output cell has the same area, levelWidth * levelHeight, in this grid.
    const area = levelWidth * levelHeight;
    for (let y = 0; y < nextHeight; y++) {
      if ((y & 63) === 0) throwIfAborted(signal);
      const top = y * levelHeight, bottom = (y + 1) * levelHeight;
      const sourceTop = Math.floor(top / nextHeight), sourceBottom = Math.ceil(bottom / nextHeight);
      for (let x = 0; x < nextWidth; x++) {
        const left = x * levelWidth, right = (x + 1) * levelWidth;
        const sourceLeft = Math.floor(left / nextWidth), sourceRight = Math.ceil(right / nextWidth);
        let sum = 0;
        for (let sourceY = sourceTop; sourceY < sourceBottom; sourceY++) {
          const weightY = Math.min(bottom, (sourceY + 1) * nextHeight) - Math.max(top, sourceY * nextHeight);
          for (let sourceX = sourceLeft; sourceX < sourceRight; sourceX++) {
            const weightX = Math.min(right, (sourceX + 1) * nextWidth) - Math.max(left, sourceX * nextWidth);
            sum += sample(sourceX, sourceY) * weightX * weightY;
          }
        }
        data[y * nextWidth + x] = Math.round(sum / area);
      }
    }
    chain.push({ width: nextWidth, height: nextHeight, data });
    sample = (x, y) => data[y * nextWidth + x];
    levelWidth = nextWidth;
    levelHeight = nextHeight;
  }
  throwIfAborted(signal);
  return chain;
}

function packedRgba(data: Uint8Array, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

function validDimensions(width: number, height: number): boolean {
  return Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0 &&
    Number.isSafeInteger(width * height * 4);
}

function validateMonochromeRaster(monochrome: MonochromeRaster, width: number, height: number): number {
  if (!validDimensions(width, height)) throw new RangeError("Monochrome raster dimensions must be positive integers.");
  const stride = Math.ceil(width / 8);
  if (monochrome.colors.length !== 8 || monochrome.data.length < stride * height) {
    throw new RangeError("Monochrome raster needs packed rows and two RGBA colors.");
  }
  return stride;
}
