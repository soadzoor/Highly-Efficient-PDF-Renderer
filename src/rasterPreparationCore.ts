import { buildCompactMonochromeAtlas, buildCompactMonochromeAtlasAsync, type CompactMonochromeAtlas } from "./compactMonochromeRaster";
import { buildPackedMonochromeMipAtlas, buildPackedMonochromeMipAtlasAsync, resampleMonochromeCoverageAsync,
  monochromeCoverageTilePixels, monochromeRasterTile, type MonochromeRaster } from "./monochromeRaster";
import { rasterTilePixels, rasterTilePixelsAsync, type RasterTilePlan, type RasterTileSource } from "./rasterTiles";
import { buildPackedCoverageMipAtlas, buildPackedCoverageMipAtlasAsync,
  type PackedMonochromeCoverageAtlas } from "./packedMonochromeCoverage";

export interface PreparedRasterPixels {
  plan: RasterTilePlan;
  pixels: Uint8Array[];
  monochromeTiles?: MonochromeRaster[];
  coverageAtlases?: PackedMonochromeCoverageAtlas[];
  compactAtlases?: (CompactMonochromeAtlas | undefined)[];
}

/** Pure pixel preparation, shared by the worker and the renderer's compatibility fallback. */
export function buildPreparedRasterPixels(source: RasterTileSource, plan: RasterTilePlan): PreparedRasterPixels {
  const mono = source.monochrome;
  if (mono && plan.width === source.width && plan.height === source.height) {
    const monochromeTiles = plan.tiles.map(tile => monochromeRasterTile(mono, source.width, source.height, tile));
    const coverageAtlases = monochromeTiles.map((bits, index) => buildPackedMonochromeMipAtlas(bits, plan.tiles[index].width, plan.tiles[index].height));
    const compactAtlases = monochromeTiles.map((bits, index) => buildCompactMonochromeAtlas(bits, plan.tiles[index].width, plan.tiles[index].height, coverageAtlases[index]));
    return { plan, pixels: [], monochromeTiles, coverageAtlases, compactAtlases };
  }
  const pixels = mono ? monochromeCoverageTilePixels(mono, source.width, source.height, plan) : rasterTilePixels(source, plan);
  const coverageAtlases = mono ? pixels.map((data, index) => {
    const { width, height } = plan.tiles[index];
    return buildPackedCoverageMipAtlas(data, width, height);
  }) : undefined;
  const compactAtlases = mono ? pixels.map((data, index) => buildCompactMonochromeAtlas(mono, plan.tiles[index].width, plan.tiles[index].height, coverageAtlases![index], data)) : undefined;
  return { plan, pixels, ...(mono ? { coverageAtlases, compactAtlases } : {}) };
}

export async function buildPreparedRasterPixelsAsync(source: RasterTileSource, plan: RasterTilePlan,
  signal?: AbortSignal): Promise<PreparedRasterPixels> {
  signal?.throwIfAborted();
  const mono = source.monochrome;
  if (!mono) {
    const pixels = await rasterTilePixelsAsync(source, plan, signal);
    signal?.throwIfAborted();
    return { plan, pixels };
  }
  const pixels: Uint8Array[] = [], monochromeTiles: MonochromeRaster[] = [], coverageAtlases: PackedMonochromeCoverageAtlas[] = [];
  const compactAtlases: (CompactMonochromeAtlas | undefined)[] = [];
  if (plan.width === source.width && plan.height === source.height) {
    for (const tile of plan.tiles) {
      signal?.throwIfAborted();
      const bits = monochromeRasterTile(mono, source.width, source.height, tile);
      monochromeTiles.push(bits);
      const atlas = await buildPackedMonochromeMipAtlasAsync(bits, tile.width, tile.height, signal);
      coverageAtlases.push(atlas);
      compactAtlases.push(await buildCompactMonochromeAtlasAsync(bits, tile.width, tile.height, atlas, undefined, signal));
    }
    signal?.throwIfAborted();
    return { plan, pixels, monochromeTiles, coverageAtlases, compactAtlases };
  }
  const coverage = await resampleMonochromeCoverageAsync(mono, source.width, source.height, plan.width, plan.height, signal);
  for (const tile of plan.tiles) {
    signal?.throwIfAborted();
    let data = coverage;
    if (tile.width !== plan.width || tile.height !== plan.height) {
      data = new Uint8Array(tile.width * tile.height);
      for (let y = 0; y < tile.height; y++) {
        signal?.throwIfAborted();
        const start = (tile.y + y) * plan.width + tile.x;
        data.set(coverage.subarray(start, start + tile.width), y * tile.width);
      }
    }
    pixels.push(data);
    const atlas = await buildPackedCoverageMipAtlasAsync(data, tile.width, tile.height, signal);
    coverageAtlases.push(atlas);
    compactAtlases.push(await buildCompactMonochromeAtlasAsync(mono, tile.width, tile.height, atlas, data, signal));
  }
  signal?.throwIfAborted();
  return { plan, pixels, coverageAtlases, compactAtlases };
}
