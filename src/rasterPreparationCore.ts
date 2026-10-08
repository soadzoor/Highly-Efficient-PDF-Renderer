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
}

/** Pure pixel preparation, shared by the worker and the renderer's compatibility fallback. */
export function buildPreparedRasterPixels(source: RasterTileSource, plan: RasterTilePlan): PreparedRasterPixels {
  const mono = source.monochrome;
  if (mono && plan.width === source.width && plan.height === source.height) {
    const monochromeTiles = plan.tiles.map(tile => monochromeRasterTile(mono, source.width, source.height, tile));
    return { plan, pixels: [], monochromeTiles,
      coverageAtlases: monochromeTiles.map((bits, index) => buildPackedMonochromeMipAtlas(bits, plan.tiles[index].width, plan.tiles[index].height)) };
  }
  const pixels = mono ? monochromeCoverageTilePixels(mono, source.width, source.height, plan) : rasterTilePixels(source, plan);
  return { plan, pixels, ...(mono ? { coverageAtlases: pixels.map((data, index) => {
    const { width, height } = plan.tiles[index];
    return buildPackedCoverageMipAtlas(data, width, height);
  }) } : {}) };
}

export async function buildPreparedRasterPixelsAsync(source: RasterTileSource, plan: RasterTilePlan): Promise<PreparedRasterPixels> {
  const mono = source.monochrome;
  if (!mono) return { plan, pixels: await rasterTilePixelsAsync(source, plan) };
  const pixels: Uint8Array[] = [], monochromeTiles: MonochromeRaster[] = [], coverageAtlases: PackedMonochromeCoverageAtlas[] = [];
  if (plan.width === source.width && plan.height === source.height) {
    for (const tile of plan.tiles) {
      const bits = monochromeRasterTile(mono, source.width, source.height, tile);
      monochromeTiles.push(bits);
      coverageAtlases.push(await buildPackedMonochromeMipAtlasAsync(bits, tile.width, tile.height));
    }
    return { plan, pixels, monochromeTiles, coverageAtlases };
  }
  const coverage = await resampleMonochromeCoverageAsync(mono, source.width, source.height, plan.width, plan.height);
  for (const tile of plan.tiles) {
    let data = coverage;
    if (tile.width !== plan.width || tile.height !== plan.height) {
      data = new Uint8Array(tile.width * tile.height);
      for (let y = 0; y < tile.height; y++) {
        const start = (tile.y + y) * plan.width + tile.x;
        data.set(coverage.subarray(start, start + tile.width), y * tile.width);
      }
    }
    pixels.push(data);
    coverageAtlases.push(await buildPackedCoverageMipAtlasAsync(data, tile.width, tile.height));
  }
  return { plan, pixels, coverageAtlases };
}
