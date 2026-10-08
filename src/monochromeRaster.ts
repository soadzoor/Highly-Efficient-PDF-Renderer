import type { MonochromeSymbolScene } from "./compactMonochromeRaster";
import type { RasterLayer, VectorScene } from "./pdfVectorExtractor";
import type { RasterTile, RasterTilePlan } from "./rasterTiles";
import type { SingleChannelUint8MipLevel } from "./singleChannelMipChain";
import { throwIfAborted } from "./pdf/nativeTypes";
import { finishRasterSteps, finishRasterStepsAsync } from "./rasterPreparationYield";
import { packMonochromeCoverageSteps, type PackedMonochromeCoverageAtlas } from "./packedMonochromeCoverage";

/** Packed, MSB-first rows and straight-alpha RGBA colors for the zero and one bits. */
export interface MonochromeRaster {
  data: Uint8Array;
  colors: Uint8Array;
  symbols?: MonochromeSymbolScene;
  /** Original bundled-decoder input, valid only while the canonical pixels match. */
  jbig2Source?: MonochromeJbig2Source;
}

/** Owned image streams, rather than views retaining the complete source PDF. */
export interface MonochromeJbig2Source {
  readonly width: number;
  readonly height: number;
  readonly encoded: Uint8Array;
  readonly globals: Uint8Array;
  readonly invert: boolean;
  readonly packedHash: readonly [number, number];
}

/** Detect pixel edits before reusing original compressed monochrome streams. */
export function hashMonochromePixels(data: Uint8Array, width: number, height: number): readonly [number, number] {
  let first = 0x811c9dc5, second = 0x9e3779b9;
  for (let offset = 0; offset < data.length; offset++) {
    first = Math.imul(first ^ data[offset], 0x01000193);
    second = Math.imul(second + data[offset], 0x85ebca6b);
  }
  return [
    (first ^ width ^ Math.imul(height, 0x9e3779b1)) >>> 0,
    (second ^ height ^ Math.imul(width, 0xc2b2ae35)) >>> 0
  ];
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
      colors: new Uint8Array(layer.monochrome.colors),
      ...(layer.monochrome.symbols ? { symbols: { symbols: layer.monochrome.symbols.symbols.map(symbol => ({
        ...symbol, data: new Uint8Array(symbol.data) })), placements: new Int32Array(layer.monochrome.symbols.placements) } } : {}),
      ...(layer.monochrome.jbig2Source ? { jbig2Source: {
        ...layer.monochrome.jbig2Source,
        encoded: new Uint8Array(layer.monochrome.jbig2Source.encoded),
        globals: new Uint8Array(layer.monochrome.jbig2Source.globals),
        packedHash: [layer.monochrome.jbig2Source.packedHash[0], layer.monochrome.jbig2Source.packedHash[1]]
      } } : {})
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

const BIT_COUNTS = Uint8Array.from({ length: 256 }, (_, value) => {
  let count = 0;
  for (; value; value &= value - 1) count++;
  return count;
});

/** Generate only the requested coverage resolution, without RGBA or larger mip intermediates. */
export function resampleMonochromeCoverage(source: MonochromeRaster, width: number, height: number,
  outWidth: number, outHeight: number): Uint8Array {
  return finishRasterSteps(monochromeCoverageSteps(source, width, height, outWidth, outHeight));
}

export function resampleMonochromeCoverageAsync(source: MonochromeRaster, width: number, height: number,
  outWidth: number, outHeight: number, signal?: AbortSignal): Promise<Uint8Array> {
  return finishRasterStepsAsync(monochromeCoverageSteps(source, width, height, outWidth, outHeight), signal);
}

function* monochromeCoverageSteps(source: MonochromeRaster, width: number, height: number,
  outWidth: number, outHeight: number): Generator<void, Uint8Array> {
  const stride = validateMonochromeRaster(source, width, height);
  if (!validDimensions(outWidth, outHeight) || outWidth > width || outHeight > height) {
    throw new RangeError("Monochrome coverage dimensions must fit the source.");
  }
  const out = new Uint8Array(outWidth * outHeight);
  const prefix = new Uint32Array(stride + 1), sums = new Float64Array(outWidth);
  const scaleX = width / outWidth, scaleY = height / outHeight, area = scaleX * scaleY;
  // Cell edges are identical in every row; evaluate each packed endpoint only once per row.
  const edgeBytes = new Uint32Array(outWidth + 1), edgeShifts = new Uint8Array(outWidth + 1);
  const edgeFractions = new Float64Array(outWidth + 1);
  for (let x = 0; x <= outWidth; x++) {
    const position = x * scaleX, whole = Math.floor(Math.min(width, position));
    edgeBytes[x] = whole >> 3;
    edgeShifts[x] = 8 - (whole & 7);
    edgeFractions[x] = position - whole;
  }
  for (let targetY = 0; targetY < outHeight; targetY++) {
    sums.fill(0);
    const top = targetY * scaleY, bottom = (targetY + 1) * scaleY;
    for (let y = Math.floor(top); y < Math.min(height, Math.ceil(bottom)); y++) {
      const row = y * stride;
      for (let byte = 0; byte < stride; byte++) prefix[byte + 1] = prefix[byte] + BIT_COUNTS[source.data[row + byte]];
      const weightY = Math.min(bottom, y + 1) - Math.max(top, y);
      // Prefix counts integrate entire bytes; only the two fractional cell edges read individual bits.
      let before = 0;
      for (let x = 0; x < outWidth; x++) {
        const edge = x + 1, byte = edgeBytes[edge], shift = edgeShifts[edge];
        const value = source.data[row + byte] ?? 0;
        const after = prefix[byte] + BIT_COUNTS[value >>> shift] +
          edgeFractions[edge] * ((value >>> (shift - 1)) & 1);
        sums[x] += (after - before) * weightY;
        before = after;
      }
      yield;
    }
    for (let x = 0; x < outWidth; x++) out[targetY * outWidth + x] = Math.round(sums[x] * 255 / area);
  }
  return out;
}

/** R8 display tiles retain the canonical image's placement and palette. */
export function monochromeCoverageTilePixels(source: MonochromeRaster, width: number, height: number,
  plan: RasterTilePlan): Uint8Array[] {
  const coverage = resampleMonochromeCoverage(source, width, height, plan.width, plan.height);
  return plan.tiles.map(tile => {
    if (tile.width === plan.width && tile.height === plan.height) return coverage;
    const data = new Uint8Array(tile.width * tile.height);
    for (let y = 0; y < tile.height; y++) {
      const start = (tile.y + y) * plan.width + tile.x;
      data.set(coverage.subarray(start, start + tile.width), y * tile.width);
    }
    return data;
  });
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
  const symbols = monochrome.symbols ? { symbols: monochrome.symbols.symbols,
    placements: new Int32Array(monochrome.symbols.placements) } : undefined;
  if (symbols) for (let i = 0; i < symbols.placements.length; i += 3) {
    symbols.placements[i] -= tile.x; symbols.placements[i + 1] -= tile.y;
  }
  return { data, colors: monochrome.colors, ...(symbols ? { symbols } : {}) };
}

/** Area-averaged coverage below the packed base, retaining odd-edge texels without unpacking the base. */
export function buildMonochromeMipChain(
  monochrome: MonochromeRaster,
  width: number,
  height: number,
  signal?: AbortSignal
): SingleChannelUint8MipLevel[] {
  return finishRasterSteps(monochromeMipSteps(monochrome, width, height, signal));
}

export function buildMonochromeMipChainAsync(monochrome: MonochromeRaster, width: number,
  height: number, signal?: AbortSignal): Promise<SingleChannelUint8MipLevel[]> {
  return finishRasterStepsAsync(monochromeMipSteps(monochrome, width, height, signal), signal);
}

function* monochromeMipSteps(monochrome: MonochromeRaster, width: number, height: number,
  signal?: AbortSignal): Generator<void, SingleChannelUint8MipLevel[]> {
  const chain: SingleChannelUint8MipLevel[] = [];
  for (const level of monochromeMipLevelSteps(monochrome, width, height, signal)) {
    if (level) chain.push(level);
    else yield;
  }
  return chain;
}

/** Quantize only the stored derivative; later levels average the unquantized coverage. */
export function buildPackedMonochromeMipAtlas(monochrome: MonochromeRaster, width: number,
  height: number, signal?: AbortSignal): PackedMonochromeCoverageAtlas {
  return finishRasterSteps(packedMonochromeMipSteps(monochrome, width, height, signal));
}

export function buildPackedMonochromeMipAtlasAsync(monochrome: MonochromeRaster, width: number,
  height: number, signal?: AbortSignal): Promise<PackedMonochromeCoverageAtlas> {
  return finishRasterStepsAsync(packedMonochromeMipSteps(monochrome, width, height, signal), signal);
}

function* packedMonochromeMipSteps(monochrome: MonochromeRaster, width: number, height: number,
  signal?: AbortSignal): Generator<void, PackedMonochromeCoverageAtlas> {
  throwIfAborted(signal);
  validateMonochromeRaster(monochrome, width, height);
  const levels = width === 1 && height === 1
    ? [{ width: 1, height: 1, data: Uint8Array.of((monochrome.data[0] & 128) ? 255 : 0) }]
    : monochromeMipLevelSteps(monochrome, width, height, signal);
  const steps = packMonochromeCoverageSteps(levels, width, height);
  let step = steps.next();
  while (!step.done) {
    throwIfAborted(signal);
    yield;
    step = steps.next();
  }
  throwIfAborted(signal);
  return step.value;
}

function* monochromeMipLevelSteps(monochrome: MonochromeRaster, width: number, height: number,
  signal?: AbortSignal): Generator<void | SingleChannelUint8MipLevel> {
  throwIfAborted(signal);
  const stride = validateMonochromeRaster(monochrome, width, height);
  let levelWidth = width, levelHeight = height;
  let levelData: Uint8Array | undefined;
  let sample = (x: number, y: number): number =>
    ((monochrome.data[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1) * 255;
  while (levelWidth > 1 || levelHeight > 1) {
    throwIfAborted(signal);
    const nextWidth = Math.max(1, levelWidth >> 1);
    const nextHeight = Math.max(1, levelHeight >> 1);
    const data = new Uint8Array(nextWidth * nextHeight);
    // Even reductions are exact 2x2 boxes; avoid overlap weights and unpacking the packed base.
    if ((levelWidth & 1) === 0 && (levelHeight & 1) === 0) {
      const rowBytes = levelData ? levelWidth : stride;
      for (let y = 0; y < nextHeight; y++) {
        if ((y & 63) === 0) throwIfAborted(signal);
        const top = y * 2 * rowBytes, bottom = top + rowBytes, target = y * nextWidth;
        if (levelData) {
          for (let x = 0; x < nextWidth; x++) {
            const sourceX = x * 2;
            data[target + x] = Math.round((levelData[top + sourceX] + levelData[top + sourceX + 1] +
              levelData[bottom + sourceX] + levelData[bottom + sourceX + 1]) / 4);
          }
        } else {
          for (let x = 0; x < nextWidth; x++) {
            const sourceX = x * 2, byte = sourceX >> 3, shift = 6 - (sourceX & 7);
            const count = BIT_COUNTS[(monochrome.data[top + byte] >> shift) & 3] +
              BIT_COUNTS[(monochrome.data[bottom + byte] >> shift) & 3];
            data[target + x] = Math.round(count * 255 / 4);
          }
        }
        yield;
      }
    } else {
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
        yield;
      }
    }
    yield { width: nextWidth, height: nextHeight, data };
    levelData = data;
    sample = (x, y) => data[y * nextWidth + x];
    levelWidth = nextWidth;
    levelHeight = nextHeight;
  }
  throwIfAborted(signal);
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
