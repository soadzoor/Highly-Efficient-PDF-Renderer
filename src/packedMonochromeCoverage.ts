import { buildSingleChannelUint8MipChain, buildSingleChannelUint8MipChainAsync,
  type SingleChannelUint8MipLevel } from "./singleChannelMipChain";
import { finishRasterSteps, finishRasterStepsAsync } from "./rasterPreparationYield";

export interface PackedMonochromeCoverageAtlas {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Logical levels below the base; rows store two four-bit coverage values per byte. */
export function packedMonochromeCoverageLayout(width: number, height: number): {
  width: number; height: number;
  levels: { width: number; height: number; rowBytes: number; byteOffset: number }[];
} {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      !Number.isSafeInteger(width * height)) throw new RangeError("Invalid packed coverage dimensions.");
  const levels = [];
  let byteOffset = 0;
  do {
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
    const rowBytes = Math.ceil(width / 2);
    levels.push({ width, height, rowBytes, byteOffset });
    byteOffset += rowBytes * height;
  } while (width > 1 || height > 1);
  const atlasWidth = levels[0].rowBytes;
  return { width: atlasWidth, height: Math.ceil(byteOffset / atlasWidth), levels };
}

/** Linear packing avoids the substantial padding of separate hardware mip levels. */
export function* packMonochromeCoverageSteps(
  levels: Iterable<SingleChannelUint8MipLevel | void>, width: number, height: number
): Generator<void, PackedMonochromeCoverageAtlas> {
  const layout = packedMonochromeCoverageLayout(width, height);
  const data = new Uint8Array(layout.width * layout.height);
  let index = 0;
  for (const level of levels) {
    if (!level) { yield; continue; }
    const target = layout.levels[index++];
    if (!target || level.width !== target.width || level.height !== target.height ||
        level.data.length < level.width * level.height) throw new RangeError("Invalid coverage mip level.");
    for (let y = 0; y < level.height; y++) {
      const row = target.byteOffset + y * target.rowBytes;
      for (let x = 0; x < level.width; x += 2) {
        const first = Math.round(level.data[y * level.width + x] / 17);
        const second = x + 1 < level.width ? Math.round(level.data[y * level.width + x + 1] / 17) : 0;
        data[row + (x >> 1)] = (first << 4) | second;
      }
      yield;
    }
  }
  if (index !== layout.levels.length) throw new RangeError("Incomplete coverage mip chain.");
  return { width: layout.width, height: layout.height, data };
}

export function packMonochromeCoverageMipChain(levels: SingleChannelUint8MipLevel[], width: number,
  height: number): PackedMonochromeCoverageAtlas {
  return finishRasterSteps(packMonochromeCoverageSteps(levels, width, height));
}

export function packMonochromeCoverageMipChainAsync(levels: SingleChannelUint8MipLevel[], width: number,
  height: number, signal?: AbortSignal): Promise<PackedMonochromeCoverageAtlas> {
  return finishRasterStepsAsync(packMonochromeCoverageSteps(levels, width, height), signal);
}

export function buildPackedCoverageMipAtlas(data: Uint8Array, width: number, height: number): PackedMonochromeCoverageAtlas {
  const levels = buildSingleChannelUint8MipChain(data, width, height);
  return packMonochromeCoverageMipChain(levels.length > 1 ? levels.slice(1) : levels, width, height);
}

export async function buildPackedCoverageMipAtlasAsync(data: Uint8Array, width: number,
  height: number, signal?: AbortSignal): Promise<PackedMonochromeCoverageAtlas> {
  const levels = await buildSingleChannelUint8MipChainAsync(data, width, height, signal);
  return packMonochromeCoverageMipChainAsync(levels.length > 1 ? levels.slice(1) : levels, width, height, signal);
}
