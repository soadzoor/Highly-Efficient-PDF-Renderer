export interface OverviewTileBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface OverviewTileRenderConfig {
  pageBackground: [number, number, number, number];
  vectorOverride: [number, number, number, number];
  strokeCurveEnabled: boolean;
  textVectorOnly: boolean;
}

export interface OverviewTileLevelConfig {
  longAxisTiles: number;
  tileLongSide: number;
  maxProjectedLongRatio: number;
}

export interface OverviewTileSpec extends OverviewTileBounds {
  key: string;
  levelIndex: number;
  column: number;
  row: number;
  innerWidth: number;
  innerHeight: number;
  textureWidth: number;
  textureHeight: number;
  uvMinX: number;
  uvMinY: number;
  uvMaxX: number;
  uvMaxY: number;
}

export interface OverviewTileLevel {
  index: number;
  config: OverviewTileLevelConfig;
  specs: OverviewTileSpec[];
}

export type OverviewTileEncoding = "webp" | "png";

export interface OverviewTileAsset extends OverviewTileSpec {
  file: string;
  encoding: OverviewTileEncoding;
  byteLength: number;
  loadBytes: () => Promise<Uint8Array>;
}

export interface OverviewTileAssetLevel {
  index: number;
  config: OverviewTileLevelConfig;
  tiles: OverviewTileAsset[];
}

export interface OverviewTilePyramid {
  formatVersion: 1;
  encoding: OverviewTileEncoding;
  bounds: OverviewTileBounds;
  overlapPixels: number;
  renderConfig: OverviewTileRenderConfig;
  levels: OverviewTileAssetLevel[];
}

export const DEFAULT_OVERVIEW_TILE_OVERLAP_PIXELS = 16;

export const OVERVIEW_TILE_LEVEL_CONFIGS: readonly OverviewTileLevelConfig[] = [
  { longAxisTiles: 4, tileLongSide: 1024, maxProjectedLongRatio: 1.22 },
  { longAxisTiles: 8, tileLongSide: 768, maxProjectedLongRatio: 2.75 },
  { longAxisTiles: 16, tileLongSide: 768, maxProjectedLongRatio: 6.5 },
  { longAxisTiles: 32, tileLongSide: 768, maxProjectedLongRatio: 13 }
];

export function buildOverviewTileLevels(
  bounds: OverviewTileBounds,
  overlapPixels = DEFAULT_OVERVIEW_TILE_OVERLAP_PIXELS,
  configs: readonly OverviewTileLevelConfig[] = OVERVIEW_TILE_LEVEL_CONFIGS
): OverviewTileLevel[] {
  const safeOverlapPixels = Math.max(0, Math.trunc(overlapPixels));
  return configs
    .map((config, index) => ({
      index,
      config,
      specs: buildOverviewTileSpecs(bounds, index, config, safeOverlapPixels)
    }))
    .filter((level) => level.specs.length > 0);
}

export function buildOverviewTileSpecs(
  bounds: OverviewTileBounds,
  levelIndex: number,
  config: OverviewTileLevelConfig,
  overlapPixels: number
): OverviewTileSpec[] {
  const pageWidth = Math.max(1e-6, bounds.maxX - bounds.minX);
  const pageHeight = Math.max(1e-6, bounds.maxY - bounds.minY);
  const aspect = pageWidth / pageHeight;
  const columns = aspect >= 1
    ? config.longAxisTiles
    : Math.max(1, Math.ceil(config.longAxisTiles * aspect));
  const rows = aspect >= 1
    ? Math.max(1, Math.ceil(config.longAxisTiles / aspect))
    : config.longAxisTiles;

  const specs: OverviewTileSpec[] = [];
  for (let row = 0; row < rows; row += 1) {
    const y0 = bounds.minY + (pageHeight * row) / rows;
    const y1 = bounds.minY + (pageHeight * (row + 1)) / rows;
    for (let column = 0; column < columns; column += 1) {
      const x0 = bounds.minX + (pageWidth * column) / columns;
      const x1 = bounds.minX + (pageWidth * (column + 1)) / columns;
      const tileWidth = Math.max(1e-6, x1 - x0);
      const tileHeight = Math.max(1e-6, y1 - y0);
      const tileAspect = tileWidth / tileHeight;
      const innerWidth = tileAspect >= 1
        ? config.tileLongSide
        : Math.max(1, Math.round(config.tileLongSide * tileAspect));
      const innerHeight = tileAspect >= 1
        ? Math.max(1, Math.round(config.tileLongSide / tileAspect))
        : config.tileLongSide;
      const textureWidth = innerWidth + overlapPixels * 2;
      const textureHeight = innerHeight + overlapPixels * 2;
      specs.push({
        key: `${levelIndex}:${column}:${row}`,
        levelIndex,
        column,
        row,
        minX: x0,
        minY: y0,
        maxX: x1,
        maxY: y1,
        innerWidth,
        innerHeight,
        textureWidth,
        textureHeight,
        uvMinX: overlapPixels / textureWidth,
        uvMinY: overlapPixels / textureHeight,
        uvMaxX: (overlapPixels + innerWidth) / textureWidth,
        uvMaxY: (overlapPixels + innerHeight) / textureHeight
      });
    }
  }
  return specs;
}

export function overviewTileRenderConfigsMatch(
  expected: OverviewTileRenderConfig,
  actual: OverviewTileRenderConfig
): boolean {
  return (
    colorsMatch(expected.pageBackground, actual.pageBackground, false) &&
    colorsMatch(expected.vectorOverride, actual.vectorOverride, true) &&
    expected.strokeCurveEnabled === actual.strokeCurveEnabled &&
    expected.textVectorOnly === actual.textVectorOnly
  );
}

function colorsMatch(
  expected: [number, number, number, number],
  actual: [number, number, number, number],
  ignoreRgbWhenTransparent: boolean
): boolean {
  const epsilon = 1e-4;
  if (Math.abs(expected[3] - actual[3]) > epsilon) {
    return false;
  }
  if (ignoreRgbWhenTransparent && expected[3] <= epsilon && actual[3] <= epsilon) {
    return true;
  }
  return (
    Math.abs(expected[0] - actual[0]) <= epsilon &&
    Math.abs(expected[1] - actual[1]) <= epsilon &&
    Math.abs(expected[2] - actual[2]) <= epsilon
  );
}
