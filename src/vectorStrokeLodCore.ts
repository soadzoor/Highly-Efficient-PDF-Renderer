import type {Bounds, VectorScene} from "./pdfVectorExtractor";
import type {ViewState} from "./webGlFloorplanRenderer";

/**
 * Vector stroke level-of-detail behavior.
 *
 * - `"auto"` enables LOD for large stroke-heavy scenes.
 * - `"off"` always renders exact strokes.
 * - `"force"` builds and uses LOD even below the normal scene-size threshold.
 */
export type VectorLodMode = "auto" | "off" | "force";

/** Minimum source segment count where `"auto"` considers Vector LOD. */
export const VECTOR_STROKE_LOD_MIN_SEGMENTS = 150_000;

/** Simplification tolerances used to build Vector LOD levels. */
export const VECTOR_STROKE_LOD_TOLERANCES = [0.5, 1, 2, 4, 8, 16, 32] as const;

/** Runtime target for visible stroke segments when Vector LOD is active. */
export const VECTOR_STROKE_LOD_TARGET_VISIBLE_SEGMENTS = 50_000;

/** Per-level Vector LOD diagnostic stats. */
export interface VectorStrokeLodLevelStats {
  /** Zero-based LOD level index. */
  index: number;

  /** Simplification tolerance for this level. */
  tolerance: number;

  /** Number of stroke segments rendered from this level. */
  renderedSegments: number;
}

/** Runtime Vector LOD diagnostic stats for the current view. */
export interface VectorStrokeLodStats {
  /** Total rendered stroke segments across active LOD levels. */
  renderedSegments: number;

  /** Number of visible runtime tiles. */
  visibleTileCount: number;

  /** Segment budget assigned to each visible tile. */
  targetSegmentsPerTile: number;

  /** Baseline LOD level selected for the current zoom. */
  baselineLevelIndex: number;

  /** Simplification tolerance of the baseline level. */
  baselineTolerance: number;

  /** LOD levels that contributed visible segments this frame. */
  activeLevels: VectorStrokeLodLevelStats[];

  /** Largest source segment count in any visible baseline tile. */
  maxBaselineTileSegments: number;

  /** Largest selected segment count in any visible baseline tile. */
  maxBaselineTileSelectedSegments: number;

  /** LOD level selected for the largest baseline tile. */
  maxBaselineTileSelectedLevelIndex: number;

  /** Tolerance selected for the largest baseline tile. */
  maxBaselineTileSelectedTolerance: number;

  /** Largest selected segment count in any visible tile. */
  maxSelectedTileSegments: number;

  /** LOD level selected for the largest visible tile. */
  maxSelectedTileLevelIndex: number;

  /** Tolerance selected for the largest visible tile. */
  maxSelectedTileTolerance: number;

  /** Runtime tile grid column count. */
  tileGridColumns: number;

  /** Runtime tile grid row count. */
  tileGridRows: number;

  /** Total built LOD level count, including exact geometry. */
  totalLevels: number;
}

/** Aggregate timing for Vector LOD prebuild work. */
export interface VectorStrokeLodBuildTiming {
  /** Total build time in milliseconds. */
  elapsedMs: number;

  /** Number of Vector LOD builds included in this timing snapshot. */
  buildCount: number;

  /** Source stroke segment count used for the build. */
  sourceSegmentCount: number;

  /** Built LOD level count. */
  levelCount: number;
}

/** Progress event emitted while Vector LOD levels are built. */
export interface VectorStrokeLodBuildProgress {
  /** Normalized build progress in the range 0..1. */
  value: number;

  /** Human-readable build status message. */
  message: string;
}

/** Async Vector LOD prebuild controls. */
export interface VectorStrokeLodAsyncBuildOptions {
  /** Yield to the browser after this many milliseconds of build work. */
  yieldIntervalMs?: number;

  /** Receives Vector LOD build progress events. */
  onProgress?: (progress: VectorStrokeLodBuildProgress) => void;

  /** Return true to cancel an in-progress async build. */
  shouldCancel?: () => boolean;
}

export interface ViewportPixels {
  width: number;
  height: number;
}

export interface CullingBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface VectorStrokeLodScene {
  tolerance: number;
  scene: VectorScene;
}

export interface RuntimeTileGrid {
  columns: number;
  rows: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  tileWidth: number;
  tileHeight: number;
  xEdges: Float64Array;
  yEdges: Float64Array;
}

export interface RuntimeStrokeTileBuckets {
  tileOffsets: Uint32Array;
  tileCounts: Uint32Array;
  tileSegmentIds: Uint32Array;
  segmentMarks: Uint32Array;
  segmentMinX: Float32Array;
  segmentMinY: Float32Array;
  segmentMaxX: Float32Array;
  segmentMaxY: Float32Array;
  visibleSegmentIds: Uint32Array;
  visibleSegmentCount: number;
  markToken: number;
}

export interface RuntimeVectorStrokeLodLevel extends RuntimeStrokeTileBuckets {
  tolerance: number;
  scene: VectorScene;
  segmentCount: number;
}

interface StrokePrimitive {
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  x1: number;
  y1: number;
  primitiveType: number;
  halfWidth: number;
  flags: number;
  alpha: number;
  colorR: number;
  colorG: number;
  colorB: number;
  /** Clip-intersected bounds; only set for primitives carrying the clipped flag. */
  visibleBounds?: Bounds;
}

interface IntervalGroup {
  tileIndex: number;
  axisX: number;
  axisY: number;
  normalX: number;
  normalY: number;
  offset: number;
  offsetSum: number;
  offsetWeightSum: number;
  clipMinX: number;
  clipMinY: number;
  clipMaxX: number;
  clipMaxY: number;
  halfWidth: number;
  flags: number;
  alpha: number;
  colorR: number;
  colorG: number;
  colorB: number;
  intervals: number[];
}

interface TileGrid {
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
}

interface RuntimeTileRange {
  c0: number;
  c1: number;
  r0: number;
  r1: number;
}

interface VectorStrokeLodRuntimeBuildData {
  tileGrid: RuntimeTileGrid;
  levels: RuntimeVectorStrokeLodLevel[];
  elapsedMs?: number;
}

interface ProjectedTileAreaStats {
  averageArea: number;
  useDynamicBudget: boolean;
}

let accumulatedBuildTiming: VectorStrokeLodBuildTiming = {
  elapsedMs: 0,
  buildCount: 0,
  sourceSegmentCount: 0,
  levelCount: 0
};

const prebuiltRuntimeByScene = new WeakMap<VectorScene, VectorStrokeLodRuntime[]>();

class Float4Builder {
  private data: Float32Array;
  private length = 0;

  constructor(initialQuads = 16_384) {
    this.data = new Float32Array(Math.max(1, initialQuads) * 4);
  }

  get quadCount(): number {
    return this.length >> 2;
  }

  push(a: number, b: number, c: number, d: number): void {
    this.ensureCapacity(4);
    const offset = this.length;
    this.data[offset] = a;
    this.data[offset + 1] = b;
    this.data[offset + 2] = c;
    this.data[offset + 3] = d;
    this.length += 4;
  }

  toTypedArray(): Float32Array {
    return this.data.slice(0, this.length);
  }

  private ensureCapacity(extraFloats: number): void {
    if (this.length + extraFloats <= this.data.length) {
      return;
    }
    let nextLength = this.data.length;
    while (this.length + extraFloats > nextLength) {
      nextLength *= 2;
    }
    const next = new Float32Array(nextLength);
    next.set(this.data);
    this.data = next;
  }
}

const STROKE_PRIMITIVE_LINE = 0;
const STROKE_PRIMITIVE_QUADRATIC = 1;
const STROKE_STYLE_FLAG_HAIRLINE = 1 << 0;
const STROKE_STYLE_FLAG_ROUND_CAP = 1 << 1;
const STROKE_STYLE_FLAG_CLIPPED = 1 << 2;
const STROKE_STYLE_FLAG_OFFSET = 2;
const ANGLE_BIN_COUNT = 720;
const ANGLE_STEP = Math.PI / ANGLE_BIN_COUNT;
const MIN_LEVEL_REDUCTION_RATIO = 0.985;
const LOD_SCREEN_ERROR_BUDGET_PX = 1.25;
const LOD_RUNTIME_TILE_TARGET_SEGMENTS = 512;
const LOD_RUNTIME_MIN_TILE_COUNT = 256;
const LOD_RUNTIME_MAX_TILE_COUNT = 4096;
const LOD_RUNTIME_MIN_GRID_SIDE = 12;
const LOD_RUNTIME_MAX_GRID_SIDE = 96;
const LOD_RUNTIME_DENSITY_EDGE_MIN_TILE_RATIO = 0.22;
const LOD_RUNTIME_EDGE_CENTER_WEIGHT = 0.45;
const LOD_RUNTIME_EDGE_ENDPOINT_WEIGHT = 0.1;
const LOD_RUNTIME_EDGE_STYLE_BIN_WEIGHT = 3.2;
const LOD_RUNTIME_STYLE_BIN_KEY_STRIDE = 8192;
const LOD_TILE_MIN_VISIBLE_SEGMENTS = 24;
const LOD_TILE_EXACT_MIN_VISIBLE_SEGMENTS = 256;
const LOD_TILE_FINE_MIN_VISIBLE_SEGMENTS = 128;
const LOD_TILE_MEDIUM_MIN_VISIBLE_SEGMENTS = 48;
const LOD_TILE_SOFT_OVERSHOOT_RATIO = 1.65;
const LOD_TILE_SELECTION_HYSTERESIS_RATIO = 0.18;
const LOD_TILE_UNDERSHOOT_SCORE_WEIGHT = 1.15;
const LOD_TILE_PROJECTED_MIN_FACTOR = 0.1;
const LOD_TILE_PROJECTED_MAX_FACTOR = 4096;
const LOD_TILE_PROJECTED_DYNAMIC_AREA_RATIO = 1.25;
const LOD_TILE_PROJECTED_PERSPECTIVE_RATIO = 0.015;
const LOD_DROP_LOCAL_SIZE_FACTOR = 1.1;
const LOD_MERGE_GAP_FACTOR = 1.5;
const LOD_TILE_WORLD_FACTOR = 192;

export class VectorStrokeLodRuntime {
  readonly levels: RuntimeVectorStrokeLodLevel[];
  readonly tileGrid: RuntimeTileGrid;

  private readonly tileSelectedLevelIndices: Int16Array;
  private readonly projectedTileAreas: Float32Array;
  private readonly maxHalfWidth: number;
  private activeLevelIndex = 0;
  private useLocalToClip = false;
  private readonly localToClip = new Float64Array(16);
  private localUnitsPerPixel = 1;
  private lastVisibleSegmentCount = 0;
  private stats: VectorStrokeLodStats;

  constructor(scene: VectorScene, buildData?: VectorStrokeLodRuntimeBuildData) {
    const lodBuildStart = nowMs();
    this.tileGrid = buildData?.tileGrid ?? createRuntimeTileGrid(scene.bounds, Math.max(0, scene.segmentCount | 0), scene);
    this.tileSelectedLevelIndices = new Int16Array(this.tileGrid.columns * this.tileGrid.rows);
    this.tileSelectedLevelIndices.fill(-1);
    this.projectedTileAreas = new Float32Array(this.tileGrid.columns * this.tileGrid.rows);
    this.maxHalfWidth = Math.max(0, scene.maxHalfWidth);
    this.levels = buildData?.levels ?? buildVectorStrokeLodScenes(scene).map((levelScene) => {
      const tileData = buildRuntimeTileBuckets(levelScene.scene, this.tileGrid);
      return {
        tolerance: levelScene.tolerance,
        scene: levelScene.scene,
        segmentCount: Math.max(0, levelScene.scene.segmentCount | 0),
        ...tileData
      };
    });
    if (this.levels.length > 0) {
      this.activeLevelIndex = 0;
    }
    this.stats = this.createEmptyStats();
    const elapsedMs = buildData?.elapsedMs ?? (nowMs() - lodBuildStart);
    logVectorLodBuildTiming(elapsedMs, scene.segmentCount, this.levels);
    recordVectorLodBuildTiming(elapsedMs, scene.segmentCount, this.levels.length);
  }

  setScreenSpaceTransform(): void {
    this.useLocalToClip = false;
  }

  setLocalToClipTransform(localToClip: ArrayLike<number>, localUnitsPerPixel: number): void {
    this.useLocalToClip = true;
    for (let i = 0; i < 16; i += 1) {
      this.localToClip[i] = Number(localToClip[i]) || 0;
    }
    this.localUnitsPerPixel = normalizeLocalUnitsPerPixel(localUnitsPerPixel);
  }

  updateForLocalUnitsPerPixel(localUnitsPerPixel: number): boolean {
    this.localUnitsPerPixel = normalizeLocalUnitsPerPixel(localUnitsPerPixel);
    this.activeLevelIndex = this.chooseLevelIndex(this.localUnitsPerPixel);
    return this.activeLevelIndex > 0;
  }

  update(viewState: ViewState, viewport: ViewportPixels, cullingBounds?: CullingBounds | null): void {
    if (this.levels.length <= 0) {
      this.lastVisibleSegmentCount = 0;
      this.stats = this.createEmptyStats();
      return;
    }
    this.updateTiledVisibleSegments(viewState, viewport, cullingBounds);
  }

  getStats(): VectorStrokeLodStats {
    return {
      ...this.stats,
      activeLevels: this.stats.activeLevels.map((level) => ({...level}))
    };
  }

  resetVisible(): void {
    this.lastVisibleSegmentCount = 0;
    for (const level of this.levels) {
      level.visibleSegmentCount = 0;
    }
    this.stats = this.createEmptyStats();
  }

  estimateVisibleSegmentCount(): number {
    if (this.lastVisibleSegmentCount > 0) {
      return this.lastVisibleSegmentCount;
    }
    return this.levels[this.activeLevelIndex]?.segmentCount ?? 0;
  }

  getRenderedSegmentCount(): number {
    return this.lastVisibleSegmentCount;
  }

  private chooseLevelIndex(localUnitsPerPixel: number): number {
    const maxTolerance = localUnitsPerPixel * LOD_SCREEN_ERROR_BUDGET_PX;
    for (let i = this.levels.length - 1; i >= 1; i -= 1) {
      if (this.levels[i].tolerance <= maxTolerance) {
        return i;
      }
    }
    return 0;
  }

  private updateTiledVisibleSegments(
    viewState: ViewState,
    viewport: ViewportPixels,
    cullingBounds?: CullingBounds | null
  ): void {
    this.resetLevelDrawLists();

    const viewBounds = resolveStrokeViewBounds(viewState, viewport, cullingBounds, this.maxHalfWidth);
    const screenErrorLevelIndex = this.chooseLevelIndex(this.localUnitsPerPixel);
    const tileRange = tileRangeForBounds(viewBounds.minX, viewBounds.minY, viewBounds.maxX, viewBounds.maxY, this.tileGrid);
    if (!tileRange) {
      this.lastVisibleSegmentCount = 0;
      this.updateLevelStats(0, 0, 0, 0, screenErrorLevelIndex, 0, screenErrorLevelIndex, screenErrorLevelIndex);
      return;
    }

    this.activeLevelIndex = screenErrorLevelIndex;
    const visibleTileCount = Math.max(1, (tileRange.c1 - tileRange.c0 + 1) * (tileRange.r1 - tileRange.r0 + 1));
    const targetSegmentsPerTile = targetSegmentsPerTileForVisibleTiles(visibleTileCount, screenErrorLevelIndex);
    const projectedTileAreaStats = this.computeProjectedTileAreaStats(tileRange, viewport);
    let maxBaselineTileSegments = 0;
    let maxBaselineTileSelectedSegments = 0;
    let maxBaselineTileSelectedLevelIndex = screenErrorLevelIndex;
    let maxSelectedTileSegments = 0;
    let maxSelectedTileLevelIndex = screenErrorLevelIndex;

    for (let row = tileRange.r0; row <= tileRange.r1; row += 1) {
      let tileIndex = row * this.tileGrid.columns + tileRange.c0;
      for (let column = tileRange.c0; column <= tileRange.c1; column += 1) {
        const baselineTileSegments = this.levels[0].tileCounts[tileIndex];
        const tileTargetSegments = this.computeTileTargetSegments(
          targetSegmentsPerTile,
          projectedTileAreaStats,
          this.projectedTileAreas[tileIndex]
        );
        const levelIndex = this.chooseTileLevel(tileIndex, tileTargetSegments);
        const selectedTileSegments = this.levels[levelIndex].tileCounts[tileIndex];
        if (baselineTileSegments > maxBaselineTileSegments) {
          maxBaselineTileSegments = baselineTileSegments;
          maxBaselineTileSelectedSegments = selectedTileSegments;
          maxBaselineTileSelectedLevelIndex = levelIndex;
        }
        if (selectedTileSegments > maxSelectedTileSegments) {
          maxSelectedTileSegments = selectedTileSegments;
          maxSelectedTileLevelIndex = levelIndex;
        }
        appendTileSegments(this.levels[levelIndex], tileIndex, viewBounds);
        tileIndex += 1;
      }
    }

    this.updateLevelStats(
      visibleTileCount,
      targetSegmentsPerTile,
      maxBaselineTileSegments,
      maxBaselineTileSelectedSegments,
      maxBaselineTileSelectedLevelIndex,
      maxSelectedTileSegments,
      maxSelectedTileLevelIndex,
      screenErrorLevelIndex
    );
  }

  private resetLevelDrawLists(): void {
    for (const level of this.levels) {
      level.visibleSegmentCount = 0;
      level.markToken += 1;
      if (level.markToken === 0xffffffff) {
        level.segmentMarks.fill(0);
        level.markToken = 1;
      }
    }
  }

  private chooseTileLevel(tileIndex: number, targetSegmentsPerTile: number): number {
    const bestIndex = this.chooseTargetBalancedTileLevel(tileIndex, targetSegmentsPerTile);
    const previousLevelIndex = this.tileSelectedLevelIndices[tileIndex];

    if (previousLevelIndex >= 0 && previousLevelIndex < this.levels.length) {
      const softOvershootLimit = Math.max(1, targetSegmentsPerTile * LOD_TILE_SOFT_OVERSHOOT_RATIO);
      const previousCount = this.levels[previousLevelIndex].tileCounts[tileIndex];
      if (previousCount <= softOvershootLimit) {
        const bestCount = this.levels[bestIndex].tileCounts[tileIndex];
        const previousScore = tileLevelTargetScore(previousCount, targetSegmentsPerTile);
        const bestScore = tileLevelTargetScore(bestCount, targetSegmentsPerTile);
        const hysteresis = Math.max(2, targetSegmentsPerTile * LOD_TILE_SELECTION_HYSTERESIS_RATIO);
        if (previousScore <= bestScore + hysteresis) {
          return previousLevelIndex;
        }
      }
    }

    this.tileSelectedLevelIndices[tileIndex] = bestIndex;
    return bestIndex;
  }

  private chooseTargetBalancedTileLevel(tileIndex: number, targetSegmentsPerTile: number): number {
    const softOvershootLimit = Math.max(1, targetSegmentsPerTile * LOD_TILE_SOFT_OVERSHOOT_RATIO);
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    let smallestCount = Number.POSITIVE_INFINITY;
    let smallestCountIndex = Math.max(0, this.levels.length - 1);

    for (let i = 0; i < this.levels.length; i += 1) {
      const tileSegments = this.levels[i].tileCounts[tileIndex];
      if (tileSegments < smallestCount || (tileSegments === smallestCount && i < smallestCountIndex)) {
        smallestCount = tileSegments;
        smallestCountIndex = i;
      }
      if (tileSegments > softOvershootLimit) {
        continue;
      }

      const score = tileLevelTargetScore(tileSegments, targetSegmentsPerTile);
      if (score < bestScore || (score === bestScore && (bestIndex < 0 || i < bestIndex))) {
        bestScore = score;
        bestIndex = i;
      }
    }

    return bestIndex >= 0 ? bestIndex : smallestCountIndex;
  }

  private computeProjectedTileAreaStats(tileRange: RuntimeTileRange, viewport: ViewportPixels): ProjectedTileAreaStats {
    if (!this.useLocalToClip || !this.hasPerspectiveTileScaleVariation()) {
      return {averageArea: 0, useDynamicBudget: false};
    }

    let totalArea = 0;
    let areaCount = 0;
    let maxArea = 0;
    for (let row = tileRange.r0; row <= tileRange.r1; row += 1) {
      let tileIndex = row * this.tileGrid.columns + tileRange.c0;
      for (let column = tileRange.c0; column <= tileRange.c1; column += 1) {
        const area = this.computeProjectedTileArea(tileIndex, viewport);
        this.projectedTileAreas[tileIndex] = area;
        if (area > 0) {
          totalArea += area;
          areaCount += 1;
          maxArea = Math.max(maxArea, area);
        }
        tileIndex += 1;
      }
    }
    const averageArea = areaCount > 0 ? totalArea / areaCount : 0;
    return {
      averageArea,
      useDynamicBudget: averageArea > 1 && maxArea / averageArea >= LOD_TILE_PROJECTED_DYNAMIC_AREA_RATIO
    };
  }

  private computeTileTargetSegments(
    baseTargetSegmentsPerTile: number,
    projectedTileAreaStats: ProjectedTileAreaStats,
    projectedArea: number
  ): number {
    if (!this.useLocalToClip || !projectedTileAreaStats.useDynamicBudget || projectedTileAreaStats.averageArea <= 1) {
      return baseTargetSegmentsPerTile;
    }

    if (projectedArea <= 0) {
      return LOD_TILE_MIN_VISIBLE_SEGMENTS;
    }

    const areaFactor = clampNumber(
      projectedArea / projectedTileAreaStats.averageArea,
      LOD_TILE_PROJECTED_MIN_FACTOR,
      LOD_TILE_PROJECTED_MAX_FACTOR
    );
    return Math.max(LOD_TILE_MIN_VISIBLE_SEGMENTS, Math.round(baseTargetSegmentsPerTile * areaFactor));
  }

  private hasPerspectiveTileScaleVariation(): boolean {
    const elements = this.localToClip;
    const width = Math.max(0, this.tileGrid.maxX - this.tileGrid.minX);
    const height = Math.max(0, this.tileGrid.maxY - this.tileGrid.minY);
    const centerX = (this.tileGrid.minX + this.tileGrid.maxX) * 0.5;
    const centerY = (this.tileGrid.minY + this.tileGrid.maxY) * 0.5;
    const centerW = elements[3] * centerX + elements[7] * centerY + elements[15];
    if (!Number.isFinite(centerW) || Math.abs(centerW) <= 1e-8) {
      return false;
    }

    const wVariation = Math.abs(elements[3]) * width + Math.abs(elements[7]) * height;
    return wVariation / Math.abs(centerW) >= LOD_TILE_PROJECTED_PERSPECTIVE_RATIO;
  }

  private computeProjectedTileArea(tileIndex: number, viewport: ViewportPixels): number {
    const column = tileIndex % this.tileGrid.columns;
    const row = Math.floor(tileIndex / this.tileGrid.columns);
    const minX = this.tileGrid.xEdges[column];
    const minY = this.tileGrid.yEdges[row];
    const maxX = this.tileGrid.xEdges[column + 1];
    const maxY = this.tileGrid.yEdges[row + 1];
    const viewportWidth = Math.max(1, viewport.width);
    const viewportHeight = Math.max(1, viewport.height);
    const elements = this.localToClip;

    let projectedMinX = Number.POSITIVE_INFINITY;
    let projectedMinY = Number.POSITIVE_INFINITY;
    let projectedMaxX = Number.NEGATIVE_INFINITY;
    let projectedMaxY = Number.NEGATIVE_INFINITY;

    for (let corner = 0; corner < 4; corner += 1) {
      const x = (corner & 1) === 0 ? minX : maxX;
      const y = (corner & 2) === 0 ? minY : maxY;
      const clipX = elements[0] * x + elements[4] * y + elements[12];
      const clipY = elements[1] * x + elements[5] * y + elements[13];
      const clipW = elements[3] * x + elements[7] * y + elements[15];
      if (!Number.isFinite(clipW) || Math.abs(clipW) <= 1e-8) {
        continue;
      }
      const ndcX = clipX / clipW;
      const ndcY = clipY / clipW;
      if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY)) {
        continue;
      }
      const px = (ndcX * 0.5 + 0.5) * viewportWidth;
      const py = (ndcY * 0.5 + 0.5) * viewportHeight;
      projectedMinX = Math.min(projectedMinX, px);
      projectedMinY = Math.min(projectedMinY, py);
      projectedMaxX = Math.max(projectedMaxX, px);
      projectedMaxY = Math.max(projectedMaxY, py);
    }

    if (!Number.isFinite(projectedMinX) || !Number.isFinite(projectedMinY)) {
      return 0;
    }

    const clippedMinX = clampNumber(projectedMinX, 0, viewportWidth);
    const clippedMinY = clampNumber(projectedMinY, 0, viewportHeight);
    const clippedMaxX = clampNumber(projectedMaxX, 0, viewportWidth);
    const clippedMaxY = clampNumber(projectedMaxY, 0, viewportHeight);
    return Math.max(0, clippedMaxX - clippedMinX) * Math.max(0, clippedMaxY - clippedMinY);
  }

  private updateLevelStats(
    visibleTileCount: number,
    targetSegmentsPerTile: number,
    maxBaselineTileSegments: number,
    maxBaselineTileSelectedSegments: number,
    maxBaselineTileSelectedLevelIndex: number,
    maxSelectedTileSegments: number,
    maxSelectedTileLevelIndex: number,
    baselineLevelIndex: number
  ): void {
    let visibleSegmentCount = 0;
    const activeLevels: VectorStrokeLodLevelStats[] = [];
    for (let i = 0; i < this.levels.length; i += 1) {
      const level = this.levels[i];
      const drawCount = level.visibleSegmentCount;
      visibleSegmentCount += drawCount;
      if (drawCount > 0) {
        activeLevels.push({
          index: i,
          tolerance: level.tolerance,
          renderedSegments: drawCount
        });
      }
    }
    this.lastVisibleSegmentCount = visibleSegmentCount;
    this.stats = {
      renderedSegments: visibleSegmentCount,
      visibleTileCount,
      targetSegmentsPerTile,
      baselineLevelIndex,
      baselineTolerance: this.levels[baselineLevelIndex]?.tolerance ?? 0,
      activeLevels,
      maxBaselineTileSegments,
      maxBaselineTileSelectedSegments,
      maxBaselineTileSelectedLevelIndex,
      maxBaselineTileSelectedTolerance: this.levels[maxBaselineTileSelectedLevelIndex]?.tolerance ?? 0,
      maxSelectedTileSegments,
      maxSelectedTileLevelIndex,
      maxSelectedTileTolerance: this.levels[maxSelectedTileLevelIndex]?.tolerance ?? 0,
      tileGridColumns: this.tileGrid.columns,
      tileGridRows: this.tileGrid.rows,
      totalLevels: this.levels.length
    };
  }

  private createEmptyStats(): VectorStrokeLodStats {
    return {
      renderedSegments: 0,
      visibleTileCount: 0,
      targetSegmentsPerTile: 0,
      baselineLevelIndex: this.activeLevelIndex,
      baselineTolerance: this.levels[this.activeLevelIndex]?.tolerance ?? 0,
      activeLevels: [],
      maxBaselineTileSegments: 0,
      maxBaselineTileSelectedSegments: 0,
      maxBaselineTileSelectedLevelIndex: this.activeLevelIndex,
      maxBaselineTileSelectedTolerance: this.levels[this.activeLevelIndex]?.tolerance ?? 0,
      maxSelectedTileSegments: 0,
      maxSelectedTileLevelIndex: this.activeLevelIndex,
      maxSelectedTileTolerance: this.levels[this.activeLevelIndex]?.tolerance ?? 0,
      tileGridColumns: this.tileGrid.columns,
      tileGridRows: this.tileGrid.rows,
      totalLevels: this.levels.length
    };
  }
}

export function shouldUseVectorStrokeLod(mode: VectorLodMode, rendererType: "webgl" | "webgpu", segmentCount: number): boolean {
  if (mode === "off") {
    return false;
  }
  if (rendererType !== "webgl" && rendererType !== "webgpu") {
    return false;
  }
  if (mode === "force") {
    return segmentCount > 0;
  }
  return segmentCount >= VECTOR_STROKE_LOD_MIN_SEGMENTS;
}

export function buildVectorStrokeLodScenes(scene: VectorScene): VectorStrokeLodScene[] {
  const baseCount = Math.max(0, scene.segmentCount | 0);
  const levels: VectorStrokeLodScene[] = [{tolerance: 0, scene}];
  let previousCount = baseCount;

  for (const tolerance of VECTOR_STROKE_LOD_TOLERANCES) {
    const simplified = buildSimplifiedStrokeScene(scene, tolerance);
    if (!simplified || simplified.segmentCount <= 0) {
      continue;
    }
    if (simplified.segmentCount >= previousCount * MIN_LEVEL_REDUCTION_RATIO) {
      continue;
    }
    levels.push({
      tolerance,
      scene: {
        ...scene,
        segmentCount: simplified.segmentCount,
        endpoints: simplified.endpoints,
        primitiveMeta: simplified.primitiveMeta,
        primitiveBounds: simplified.primitiveBounds,
        styles: simplified.styles,
        bounds: simplified.bounds,
        maxHalfWidth: simplified.maxHalfWidth
      }
    });
    previousCount = simplified.segmentCount;
  }

  return levels;
}

export async function prebuildVectorStrokeLodRuntime(
  scene: VectorScene,
  mode: VectorLodMode,
  rendererType: "webgl" | "webgpu",
  options: VectorStrokeLodAsyncBuildOptions = {}
): Promise<VectorStrokeLodRuntime | null> {
  if (!shouldUseVectorStrokeLod(mode, rendererType, scene.segmentCount)) {
    return null;
  }

  const scheduler = new VectorStrokeLodYieldScheduler(options);
  const startedAt = nowMs();
  scheduler.report(0, "Preparing Vector LOD");
  const tileGrid = createRuntimeTileGrid(scene.bounds, Math.max(0, scene.segmentCount | 0), scene);
  await scheduler.maybeYield(true, 0.04, "Partitioning stroke density");

  const levelScenes = await buildVectorStrokeLodScenesAsync(scene, scheduler);
  const levels: RuntimeVectorStrokeLodLevel[] = [];
  const levelCount = Math.max(1, levelScenes.length);
  for (let i = 0; i < levelScenes.length; i += 1) {
    const levelScene = levelScenes[i];
    const startValue = 0.68 + i / levelCount * 0.3;
    const endValue = 0.68 + (i + 1) / levelCount * 0.3;
    scheduler.report(startValue, `Building Vector LOD buckets ${i + 1}/${levelScenes.length}`);
    const tileData = await buildRuntimeTileBucketsAsync(levelScene.scene, tileGrid, scheduler, startValue, endValue);
    levels.push({
      tolerance: levelScene.tolerance,
      scene: levelScene.scene,
      segmentCount: Math.max(0, levelScene.scene.segmentCount | 0),
      ...tileData
    });
  }

  scheduler.report(0.99, "Finalizing Vector LOD");
  await scheduler.maybeYield(true, 0.99, "Finalizing Vector LOD");
  const runtime = new VectorStrokeLodRuntime(scene, {
    tileGrid,
    levels,
    elapsedMs: nowMs() - startedAt
  });
  storePrebuiltVectorStrokeLodRuntimeInternal(scene, runtime);
  scheduler.report(1, "Vector LOD ready");
  return runtime;
}

export function takePrebuiltVectorStrokeLodRuntime(scene: VectorScene): VectorStrokeLodRuntime | null {
  const runtimes = prebuiltRuntimeByScene.get(scene);
  if (!runtimes || runtimes.length <= 0) {
    return null;
  }
  const runtime = runtimes.shift() ?? null;
  if (runtimes.length <= 0) {
    prebuiltRuntimeByScene.delete(scene);
  }
  return runtime;
}

export function storePrebuiltVectorStrokeLodRuntime(scene: VectorScene, runtime: VectorStrokeLodRuntime): void {
  runtime.resetVisible();
  storePrebuiltVectorStrokeLodRuntimeInternal(scene, runtime);
}

function storePrebuiltVectorStrokeLodRuntimeInternal(scene: VectorScene, runtime: VectorStrokeLodRuntime): void {
  const runtimes = prebuiltRuntimeByScene.get(scene);
  if (runtimes) {
    runtimes.push(runtime);
  } else {
    prebuiltRuntimeByScene.set(scene, [runtime]);
  }
}

async function buildVectorStrokeLodScenesAsync(
  scene: VectorScene,
  scheduler: VectorStrokeLodYieldScheduler
): Promise<VectorStrokeLodScene[]> {
  const baseCount = Math.max(0, scene.segmentCount | 0);
  const levels: VectorStrokeLodScene[] = [{tolerance: 0, scene}];
  let previousCount = baseCount;
  const toleranceCount = VECTOR_STROKE_LOD_TOLERANCES.length;

  for (let i = 0; i < toleranceCount; i += 1) {
    const tolerance = VECTOR_STROKE_LOD_TOLERANCES[i];
    const startValue = 0.06 + i / toleranceCount * 0.62;
    const endValue = 0.06 + (i + 1) / toleranceCount * 0.62;
    scheduler.report(startValue, `Simplifying Vector LOD ${i + 1}/${toleranceCount}`);
    const simplified = await buildSimplifiedStrokeSceneAsync(scene, tolerance, scheduler, startValue, endValue);
    if (!simplified || simplified.segmentCount <= 0) {
      continue;
    }
    if (simplified.segmentCount >= previousCount * MIN_LEVEL_REDUCTION_RATIO) {
      continue;
    }
    levels.push({
      tolerance,
      scene: {
        ...scene,
        segmentCount: simplified.segmentCount,
        endpoints: simplified.endpoints,
        primitiveMeta: simplified.primitiveMeta,
        primitiveBounds: simplified.primitiveBounds,
        styles: simplified.styles,
        bounds: simplified.bounds,
        maxHalfWidth: simplified.maxHalfWidth
      }
    });
    previousCount = simplified.segmentCount;
  }

  return levels;
}

async function buildSimplifiedStrokeSceneAsync(
  scene: VectorScene,
  tolerance: number,
  scheduler: VectorStrokeLodYieldScheduler,
  startValue: number,
  endValue: number
): Promise<{
  segmentCount: number;
  endpoints: Float32Array;
  primitiveMeta: Float32Array;
  primitiveBounds: Float32Array;
  styles: Float32Array;
  bounds: Bounds;
  maxHalfWidth: number;
} | null> {
  const segmentCount = Math.max(0, scene.segmentCount | 0);
  if (segmentCount <= 0 || tolerance <= 0) {
    return null;
  }

  const grid = createTileGrid(scene.bounds, tolerance);
  const groups = new Map<string, IntervalGroup>();
  const endpoints = new Float4Builder(Math.min(segmentCount, 65_536));
  const primitiveMeta = new Float4Builder(Math.min(segmentCount, 65_536));
  const primitiveBounds = new Float4Builder(Math.min(segmentCount, 65_536));
  const styles = new Float4Builder(Math.min(segmentCount, 65_536));
  const outBounds = createEmptyBounds();
  let maxHalfWidth = 0;

  for (let index = 0; index < segmentCount; index += 1) {
    const primitive = readStrokePrimitive(scene, index);
    if (!primitive || primitive.alpha <= 0.001) {
      continue;
    }
    if (shouldDropPrimitiveAtTolerance(scene, index, primitive, tolerance)) {
      continue;
    }

    if (primitive.primitiveType >= STROKE_PRIMITIVE_QUADRATIC - 0.5) {
      emitPrimitive(endpoints, primitiveMeta, primitiveBounds, styles, outBounds, primitive);
      maxHalfWidth = Math.max(maxHalfWidth, primitive.halfWidth);
      continue;
    }

    const dx = primitive.x1 - primitive.x0;
    const dy = primitive.y1 - primitive.y0;
    if (dx * dx + dy * dy <= 1e-10) {
      if ((primitive.flags & STROKE_STYLE_FLAG_ROUND_CAP) !== 0) {
        emitPrimitive(endpoints, primitiveMeta, primitiveBounds, styles, outBounds, primitive);
        maxHalfWidth = Math.max(maxHalfWidth, primitive.halfWidth);
      }
      continue;
    }

    const tileIndex = tileIndexForPoint(
      primitiveCenterX(primitive),
      primitiveCenterY(primitive),
      scene.bounds,
      grid
    );
    const group = resolveIntervalGroup(groups, primitive, tileIndex, tolerance);
    pushGroupInterval(group, primitive, tolerance);
    maxHalfWidth = Math.max(maxHalfWidth, primitive.halfWidth);

    if ((index & 4095) === 0) {
      const value = startValue + (endValue - startValue) * 0.72 * (index / Math.max(1, segmentCount));
      await scheduler.maybeYield(false, value, `Simplifying ${formatToleranceName(tolerance)}`);
    }
  }

  let groupIndex = 0;
  const groupCount = Math.max(1, groups.size);
  for (const group of groups.values()) {
    emitMergedIntervals(group, endpoints, primitiveMeta, primitiveBounds, styles, outBounds, tolerance);
    groupIndex += 1;
    if ((groupIndex & 1023) === 0) {
      const value = startValue + (endValue - startValue) * (0.72 + 0.28 * groupIndex / groupCount);
      await scheduler.maybeYield(false, value, `Merging ${formatToleranceName(tolerance)}`);
    }
  }

  if (endpoints.quadCount === 0) {
    return null;
  }

  return {
    segmentCount: endpoints.quadCount,
    endpoints: endpoints.toTypedArray(),
    primitiveMeta: primitiveMeta.toTypedArray(),
    primitiveBounds: primitiveBounds.toTypedArray(),
    styles: styles.toTypedArray(),
    bounds: normalizeOutputBounds(outBounds, scene.bounds),
    maxHalfWidth
  };
}

async function buildRuntimeTileBucketsAsync(
  scene: VectorScene,
  grid: RuntimeTileGrid,
  scheduler: VectorStrokeLodYieldScheduler,
  startValue: number,
  endValue: number
): Promise<RuntimeStrokeTileBuckets> {
  const segmentCount = Math.max(0, scene.segmentCount | 0);
  const tileCount = grid.columns * grid.rows;
  const tileCounts = new Uint32Array(tileCount);
  const bounds = await buildRuntimeSegmentBoundsAsync(scene, segmentCount, scheduler, startValue, startValue + (endValue - startValue) * 0.22);

  for (let i = 0; i < segmentCount; i += 1) {
    const range = tileRangeForBounds(bounds.minX[i], bounds.minY[i], bounds.maxX[i], bounds.maxY[i], grid);
    if (range) {
      for (let row = range.r0; row <= range.r1; row += 1) {
        let tileIndex = row * grid.columns + range.c0;
        for (let column = range.c0; column <= range.c1; column += 1) {
          tileCounts[tileIndex] += 1;
          tileIndex += 1;
        }
      }
    }
    if ((i & 4095) === 0) {
      const value = startValue + (endValue - startValue) * (0.22 + 0.28 * i / Math.max(1, segmentCount));
      await scheduler.maybeYield(false, value, "Counting Vector LOD tiles");
    }
  }

  const tileOffsets = new Uint32Array(tileCount + 1);
  for (let i = 0; i < tileCount; i += 1) {
    tileOffsets[i + 1] = tileOffsets[i] + tileCounts[i];
  }

  const tileSegmentIds = new Uint32Array(tileOffsets[tileCount]);
  const cursors = tileOffsets.slice(0, tileCount);
  for (let i = 0; i < segmentCount; i += 1) {
    const range = tileRangeForBounds(bounds.minX[i], bounds.minY[i], bounds.maxX[i], bounds.maxY[i], grid);
    if (range) {
      for (let row = range.r0; row <= range.r1; row += 1) {
        let tileIndex = row * grid.columns + range.c0;
        for (let column = range.c0; column <= range.c1; column += 1) {
          const writeOffset = cursors[tileIndex];
          tileSegmentIds[writeOffset] = i;
          cursors[tileIndex] = writeOffset + 1;
          tileIndex += 1;
        }
      }
    }
    if ((i & 4095) === 0) {
      const value = startValue + (endValue - startValue) * (0.5 + 0.5 * i / Math.max(1, segmentCount));
      await scheduler.maybeYield(false, value, "Assigning Vector LOD tiles");
    }
  }

  return {
    tileOffsets,
    tileCounts,
    tileSegmentIds,
    segmentMarks: new Uint32Array(segmentCount),
    segmentMinX: bounds.minX,
    segmentMinY: bounds.minY,
    segmentMaxX: bounds.maxX,
    segmentMaxY: bounds.maxY,
    visibleSegmentIds: new Uint32Array(Math.max(1, segmentCount)),
    visibleSegmentCount: 0,
    markToken: 1
  };
}

async function buildRuntimeSegmentBoundsAsync(
  scene: VectorScene,
  segmentCount: number,
  scheduler: VectorStrokeLodYieldScheduler,
  startValue: number,
  endValue: number
): Promise<{
  minX: Float32Array;
  minY: Float32Array;
  maxX: Float32Array;
  maxY: Float32Array;
}> {
  const minX = new Float32Array(segmentCount);
  const minY = new Float32Array(segmentCount);
  const maxX = new Float32Array(segmentCount);
  const maxY = new Float32Array(segmentCount);

  for (let i = 0; i < segmentCount; i += 1) {
    const primitiveBoundsOffset = i * 4;
    const styleOffset = i * 4;
    const margin = (scene.styles[styleOffset] ?? 0) + 0.35;
    minX[i] = scene.primitiveBounds[primitiveBoundsOffset] - margin;
    minY[i] = scene.primitiveBounds[primitiveBoundsOffset + 1] - margin;
    maxX[i] = scene.primitiveBounds[primitiveBoundsOffset + 2] + margin;
    maxY[i] = scene.primitiveBounds[primitiveBoundsOffset + 3] + margin;

    if ((i & 8191) === 0) {
      const value = startValue + (endValue - startValue) * (i / Math.max(1, segmentCount));
      await scheduler.maybeYield(false, value, "Preparing Vector LOD bounds");
    }
  }

  return {minX, minY, maxX, maxY};
}

export function resetVectorStrokeLodBuildTiming(): void {
  accumulatedBuildTiming = {
    elapsedMs: 0,
    buildCount: 0,
    sourceSegmentCount: 0,
    levelCount: 0
  };
}

export function consumeVectorStrokeLodBuildTiming(): VectorStrokeLodBuildTiming {
  const timing = {...accumulatedBuildTiming};
  resetVectorStrokeLodBuildTiming();
  return timing;
}

function recordVectorLodBuildTiming(elapsedMs: number, sourceSegmentCount: number, levelCount: number): void {
  accumulatedBuildTiming.elapsedMs += Math.max(0, elapsedMs);
  accumulatedBuildTiming.buildCount += 1;
  accumulatedBuildTiming.sourceSegmentCount += Math.max(0, sourceSegmentCount | 0);
  accumulatedBuildTiming.levelCount += Math.max(0, levelCount | 0);
}

class VectorStrokeLodBuildCancelledError extends Error {
  constructor() {
    super("Vector LOD build cancelled.");
    this.name = "VectorStrokeLodBuildCancelledError";
  }
}

class VectorStrokeLodYieldScheduler {
  private readonly yieldIntervalMs: number;
  private readonly onProgress?: (progress: VectorStrokeLodBuildProgress) => void;
  private readonly shouldCancel?: () => boolean;
  private lastYieldAt = nowMs();
  private lastProgressValue = -1;

  constructor(options: VectorStrokeLodAsyncBuildOptions) {
    this.yieldIntervalMs = Math.max(50, Math.trunc(options.yieldIntervalMs ?? 500));
    this.onProgress = options.onProgress;
    this.shouldCancel = options.shouldCancel;
  }

  report(value: number, message: string): void {
    const normalized = clamp01(value);
    if (normalized < this.lastProgressValue && this.lastProgressValue >= 0) {
      return;
    }
    this.lastProgressValue = normalized;
    this.onProgress?.({value: normalized, message});
  }

  async maybeYield(force: boolean, value: number, message: string): Promise<void> {
    if (this.shouldCancel?.()) {
      throw new VectorStrokeLodBuildCancelledError();
    }
    this.report(value, message);
    const now = nowMs();
    if (!force && now - this.lastYieldAt < this.yieldIntervalMs) {
      return;
    }
    await yieldToBrowser();
    this.lastYieldAt = nowMs();
    if (this.shouldCancel?.()) {
      throw new VectorStrokeLodBuildCancelledError();
    }
  }
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

export function createRuntimeTileGrid(bounds: Bounds, segmentCount: number, scene?: VectorScene): RuntimeTileGrid {
  const width = Math.max(1e-6, bounds.maxX - bounds.minX);
  const height = Math.max(1e-6, bounds.maxY - bounds.minY);
  const targetTileCount = clampInt(
    Math.round(Math.max(1, segmentCount) / LOD_RUNTIME_TILE_TARGET_SEGMENTS),
    LOD_RUNTIME_MIN_TILE_COUNT,
    LOD_RUNTIME_MAX_TILE_COUNT
  );
  const aspect = width / height;
  let columns = Math.round(Math.sqrt(targetTileCount * aspect));
  let rows = Math.round(targetTileCount / Math.max(1, columns));
  columns = clampInt(columns, LOD_RUNTIME_MIN_GRID_SIDE, LOD_RUNTIME_MAX_GRID_SIDE);
  rows = clampInt(rows, LOD_RUNTIME_MIN_GRID_SIDE, LOD_RUNTIME_MAX_GRID_SIDE);
  const xEdges = createRuntimeTileEdges(bounds.minX, bounds.maxX, columns, scene, "x");
  const yEdges = createRuntimeTileEdges(bounds.minY, bounds.maxY, rows, scene, "y");
  return {
    columns,
    rows,
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
    tileWidth: width / columns,
    tileHeight: height / rows,
    xEdges,
    yEdges
  };
}

function createRuntimeTileEdges(
  minValue: number,
  maxValue: number,
  tileCount: number,
  scene: VectorScene | undefined,
  axis: "x" | "y"
): Float64Array {
  if (!scene || tileCount <= 1 || scene.segmentCount <= tileCount * 4) {
    return createUniformTileEdges(minValue, maxValue, tileCount);
  }

  const span = Math.max(1e-9, maxValue - minValue);
  const segmentCount = Math.max(0, scene.segmentCount | 0);
  const binCount = clampInt(tileCount * 16, 256, 4096);
  const bins = new Float64Array(binCount);
  const styleBins = new Map<number, number>();
  const primitiveBounds = scene.primitiveBounds;
  let sampleCount = 0;

  for (let i = 0; i < segmentCount; i += 1) {
    const offset = i * 4;
    const a = axis === "x" ? primitiveBounds[offset] : primitiveBounds[offset + 1];
    const b = axis === "x" ? primitiveBounds[offset + 2] : primitiveBounds[offset + 3];
    const center = (a + b) * 0.5;
    if (!Number.isFinite(center)) {
      continue;
    }
    const normalized = (center - minValue) / span;
    const bin = clampInt(Math.floor(normalized * binCount), 0, binCount - 1);
    const minBin = clampInt(Math.floor((Math.min(a, b) - minValue) / span * binCount), 0, binCount - 1);
    const maxBin = clampInt(Math.floor((Math.max(a, b) - minValue) / span * binCount), 0, binCount - 1);
    const styleKey = strokeStyleKey(scene, i);
    bins[bin] += LOD_RUNTIME_EDGE_CENTER_WEIGHT;
    addStyleBinSample(styleBins, styleKey, bin, 1);
    if (minBin !== bin) {
      bins[minBin] += LOD_RUNTIME_EDGE_ENDPOINT_WEIGHT;
      addStyleBinSample(styleBins, styleKey, minBin, LOD_RUNTIME_EDGE_ENDPOINT_WEIGHT);
    }
    if (maxBin !== bin && maxBin !== minBin) {
      bins[maxBin] += LOD_RUNTIME_EDGE_ENDPOINT_WEIGHT;
      addStyleBinSample(styleBins, styleKey, maxBin, LOD_RUNTIME_EDGE_ENDPOINT_WEIGHT);
    }
    sampleCount += 1;
  }

  if (sampleCount <= tileCount) {
    return createUniformTileEdges(minValue, maxValue, tileCount);
  }

  for (const [key, weight] of styleBins) {
    const bin = key % LOD_RUNTIME_STYLE_BIN_KEY_STRIDE;
    bins[bin] += Math.sqrt(Math.max(0, weight)) * LOD_RUNTIME_EDGE_STYLE_BIN_WEIGHT;
  }

  // Small uniform density keeps quantile edges stable through empty spans without
  // losing the density signal from clustered vectors.
  const densityFloor = Math.max(1e-6, sampleCount / binCount * 0.015);
  let totalWeight = 0;
  for (let i = 0; i < binCount; i += 1) {
    bins[i] += densityFloor;
    totalWeight += bins[i];
  }

  const edges = new Float64Array(tileCount + 1);
  edges[0] = minValue;
  edges[tileCount] = maxValue;
  const minStep = span / tileCount * LOD_RUNTIME_DENSITY_EDGE_MIN_TILE_RATIO;
  let binIndex = 0;
  let cumulativeBeforeBin = 0;

  for (let edgeIndex = 1; edgeIndex < tileCount; edgeIndex += 1) {
    const targetWeight = totalWeight * edgeIndex / tileCount;
    while (binIndex < binCount - 1 && cumulativeBeforeBin + bins[binIndex] < targetWeight) {
      cumulativeBeforeBin += bins[binIndex];
      binIndex += 1;
    }
    const binWeight = Math.max(1e-9, bins[binIndex]);
    const fraction = clampNumber((targetWeight - cumulativeBeforeBin) / binWeight, 0, 1);
    const edge = minValue + ((binIndex + fraction) / binCount) * span;
    const minAllowed = edges[edgeIndex - 1] + minStep;
    const maxAllowed = maxValue - (tileCount - edgeIndex) * minStep;
    edges[edgeIndex] = clampNumber(edge, minAllowed, maxAllowed);
  }

  return edges;
}

function addStyleBinSample(styleBins: Map<number, number>, styleKey: number, bin: number, weight: number): void {
  const key = styleKey * LOD_RUNTIME_STYLE_BIN_KEY_STRIDE + bin;
  styleBins.set(key, (styleBins.get(key) ?? 0) + weight);
}

function strokeStyleKey(scene: VectorScene, segmentIndex: number): number {
  const offset = segmentIndex * 4;
  const halfWidth = Math.max(0, scene.styles[offset] ?? 0);
  const packedStyle = scene.primitiveMeta[offset + 3] ?? 0;
  const flags = Math.max(0, Math.floor(packedStyle / STROKE_STYLE_FLAG_OFFSET + 1e-6));
  const alpha = clamp01(packedStyle - flags * STROKE_STYLE_FLAG_OFFSET);
  const widthKey = clampInt(Math.round(Math.log1p(halfWidth) * 32), 0, 255);
  const styleFlagsKey = flags & (STROKE_STYLE_FLAG_HAIRLINE | STROKE_STYLE_FLAG_ROUND_CAP);
  const alphaKey = clampInt(Math.round(alpha * 15), 0, 15);
  const redKey = clampInt(Math.round(clamp01(scene.styles[offset + 1] ?? 0) * 31), 0, 31);
  const greenKey = clampInt(Math.round(clamp01(scene.styles[offset + 2] ?? 0) * 31), 0, 31);
  const blueKey = clampInt(Math.round(clamp01(scene.styles[offset + 3] ?? 0) * 31), 0, 31);
  return (((((widthKey * 4 + styleFlagsKey) * 16 + alphaKey) * 32 + redKey) * 32 + greenKey) * 32 + blueKey);
}

function createUniformTileEdges(minValue: number, maxValue: number, tileCount: number): Float64Array {
  const edges = new Float64Array(tileCount + 1);
  const span = maxValue - minValue;
  for (let i = 0; i <= tileCount; i += 1) {
    edges[i] = minValue + span * i / tileCount;
  }
  edges[0] = minValue;
  edges[tileCount] = maxValue;
  return edges;
}

export function buildRuntimeTileBuckets(scene: VectorScene, grid: RuntimeTileGrid): RuntimeStrokeTileBuckets {
  const segmentCount = Math.max(0, scene.segmentCount | 0);
  const tileCount = grid.columns * grid.rows;
  const tileCounts = new Uint32Array(tileCount);
  const bounds = buildRuntimeSegmentBounds(scene, segmentCount);

  for (let i = 0; i < segmentCount; i += 1) {
    const range = tileRangeForBounds(bounds.minX[i], bounds.minY[i], bounds.maxX[i], bounds.maxY[i], grid);
    if (!range) {
      continue;
    }
    for (let row = range.r0; row <= range.r1; row += 1) {
      let tileIndex = row * grid.columns + range.c0;
      for (let column = range.c0; column <= range.c1; column += 1) {
        tileCounts[tileIndex] += 1;
        tileIndex += 1;
      }
    }
  }

  const tileOffsets = new Uint32Array(tileCount + 1);
  for (let i = 0; i < tileCount; i += 1) {
    tileOffsets[i + 1] = tileOffsets[i] + tileCounts[i];
  }

  const tileSegmentIds = new Uint32Array(tileOffsets[tileCount]);
  const cursors = tileOffsets.slice(0, tileCount);
  for (let i = 0; i < segmentCount; i += 1) {
    const range = tileRangeForBounds(bounds.minX[i], bounds.minY[i], bounds.maxX[i], bounds.maxY[i], grid);
    if (!range) {
      continue;
    }
    for (let row = range.r0; row <= range.r1; row += 1) {
      let tileIndex = row * grid.columns + range.c0;
      for (let column = range.c0; column <= range.c1; column += 1) {
        const writeOffset = cursors[tileIndex];
        tileSegmentIds[writeOffset] = i;
        cursors[tileIndex] = writeOffset + 1;
        tileIndex += 1;
      }
    }
  }

  return {
    tileOffsets,
    tileCounts,
    tileSegmentIds,
    segmentMarks: new Uint32Array(segmentCount),
    segmentMinX: bounds.minX,
    segmentMinY: bounds.minY,
    segmentMaxX: bounds.maxX,
    segmentMaxY: bounds.maxY,
    visibleSegmentIds: new Uint32Array(Math.max(1, segmentCount)),
    visibleSegmentCount: 0,
    markToken: 1
  };
}

export function resolveStrokeViewBounds(
  viewState: ViewState,
  viewport: ViewportPixels,
  cullingBounds: CullingBounds | null | undefined,
  maxHalfWidth: number
): CullingBounds {
  const safeZoom = Math.max(1e-6, viewState.zoom);
  const halfViewWidth = Math.max(1, viewport.width) / (2 * safeZoom);
  const halfViewHeight = Math.max(1, viewport.height) / (2 * safeZoom);
  const margin = Math.max(16 / safeZoom, maxHalfWidth * 2, 0.5);

  return cullingBounds
    ? {
      minX: cullingBounds.minX - margin,
      minY: cullingBounds.minY - margin,
      maxX: cullingBounds.maxX + margin,
      maxY: cullingBounds.maxY + margin
    }
    : {
      minX: viewState.cameraCenterX - halfViewWidth - margin,
      minY: viewState.cameraCenterY - halfViewHeight - margin,
      maxX: viewState.cameraCenterX + halfViewWidth + margin,
      maxY: viewState.cameraCenterY + halfViewHeight + margin
    };
}

function appendTileSegments(level: RuntimeStrokeTileBuckets, tileIndex: number, viewBounds: CullingBounds): void {
  const start = level.tileOffsets[tileIndex];
  const end = start + level.tileCounts[tileIndex];
  let outCount = level.visibleSegmentCount;
  for (let i = start; i < end; i += 1) {
    const segmentIndex = level.tileSegmentIds[i];
    if (level.segmentMarks[segmentIndex] === level.markToken) {
      continue;
    }
    if (
      level.segmentMaxX[segmentIndex] < viewBounds.minX ||
      level.segmentMinX[segmentIndex] > viewBounds.maxX ||
      level.segmentMaxY[segmentIndex] < viewBounds.minY ||
      level.segmentMinY[segmentIndex] > viewBounds.maxY
    ) {
      continue;
    }
    level.segmentMarks[segmentIndex] = level.markToken;
    level.visibleSegmentIds[outCount] = segmentIndex;
    outCount += 1;
  }
  level.visibleSegmentCount = outCount;
}

function buildRuntimeSegmentBounds(scene: VectorScene, segmentCount: number): {
  minX: Float32Array;
  minY: Float32Array;
  maxX: Float32Array;
  maxY: Float32Array;
} {
  const minX = new Float32Array(segmentCount);
  const minY = new Float32Array(segmentCount);
  const maxX = new Float32Array(segmentCount);
  const maxY = new Float32Array(segmentCount);

  for (let i = 0; i < segmentCount; i += 1) {
    const primitiveBoundsOffset = i * 4;
    const styleOffset = i * 4;
    const margin = (scene.styles[styleOffset] ?? 0) + 0.35;
    minX[i] = scene.primitiveBounds[primitiveBoundsOffset] - margin;
    minY[i] = scene.primitiveBounds[primitiveBoundsOffset + 1] - margin;
    maxX[i] = scene.primitiveBounds[primitiveBoundsOffset + 2] + margin;
    maxY[i] = scene.primitiveBounds[primitiveBoundsOffset + 3] + margin;
  }

  return {minX, minY, maxX, maxY};
}

function tileRangeForBounds(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  grid: RuntimeTileGrid
): RuntimeTileRange | null {
  if (maxX < grid.minX || minX > grid.maxX || maxY < grid.minY || minY > grid.maxY) {
    return null;
  }
  return {
    c0: edgeLowerBound(grid.xEdges, minX),
    c1: edgeUpperBound(grid.xEdges, maxX),
    r0: edgeLowerBound(grid.yEdges, minY),
    r1: edgeUpperBound(grid.yEdges, maxY)
  };
}

function edgeLowerBound(edges: Float64Array, value: number): number {
  const maxIndex = edges.length - 2;
  if (value <= edges[0]) {
    return 0;
  }
  if (value >= edges[edges.length - 1]) {
    return maxIndex;
  }
  let low = 0;
  let high = edges.length - 1;
  while (low + 1 < high) {
    const mid = (low + high) >> 1;
    if (edges[mid] <= value) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return clampInt(low, 0, maxIndex);
}

function edgeUpperBound(edges: Float64Array, value: number): number {
  return edgeLowerBound(edges, value);
}

function minTileTargetForBaselineLevel(levelIndex: number): number {
  if (levelIndex <= 0) {
    return LOD_TILE_EXACT_MIN_VISIBLE_SEGMENTS;
  }
  if (levelIndex === 1) {
    return LOD_TILE_FINE_MIN_VISIBLE_SEGMENTS;
  }
  if (levelIndex === 2) {
    return LOD_TILE_MEDIUM_MIN_VISIBLE_SEGMENTS;
  }
  return LOD_TILE_MIN_VISIBLE_SEGMENTS;
}

function targetSegmentsPerTileForVisibleTiles(visibleTileCount: number, baselineLevelIndex: number): number {
  const globalTarget = Math.max(
    LOD_TILE_MIN_VISIBLE_SEGMENTS,
    Math.ceil(VECTOR_STROKE_LOD_TARGET_VISIBLE_SEGMENTS / Math.max(1, visibleTileCount))
  );
  const qualityFloor = minTileTargetForBaselineLevel(baselineLevelIndex);
  if (globalTarget >= qualityFloor) {
    return globalTarget;
  }
  return Math.max(globalTarget, Math.ceil(Math.sqrt(globalTarget * qualityFloor)));
}

function tileLevelTargetScore(tileSegments: number, targetSegmentsPerTile: number): number {
  const delta = tileSegments - targetSegmentsPerTile;
  return delta >= 0 ? delta : -delta * LOD_TILE_UNDERSHOOT_SCORE_WEIGHT;
}

function buildSimplifiedStrokeScene(scene: VectorScene, tolerance: number): {
  segmentCount: number;
  endpoints: Float32Array;
  primitiveMeta: Float32Array;
  primitiveBounds: Float32Array;
  styles: Float32Array;
  bounds: Bounds;
  maxHalfWidth: number;
} | null {
  const segmentCount = Math.max(0, scene.segmentCount | 0);
  if (segmentCount <= 0 || tolerance <= 0) {
    return null;
  }

  const grid = createTileGrid(scene.bounds, tolerance);
  const groups = new Map<string, IntervalGroup>();
  const endpoints = new Float4Builder(Math.min(segmentCount, 65_536));
  const primitiveMeta = new Float4Builder(Math.min(segmentCount, 65_536));
  const primitiveBounds = new Float4Builder(Math.min(segmentCount, 65_536));
  const styles = new Float4Builder(Math.min(segmentCount, 65_536));
  const outBounds = createEmptyBounds();
  let maxHalfWidth = 0;

  for (let index = 0; index < segmentCount; index += 1) {
    const primitive = readStrokePrimitive(scene, index);
    if (!primitive || primitive.alpha <= 0.001) {
      continue;
    }
    if (shouldDropPrimitiveAtTolerance(scene, index, primitive, tolerance)) {
      continue;
    }

    if (primitive.primitiveType >= STROKE_PRIMITIVE_QUADRATIC - 0.5) {
      emitPrimitive(endpoints, primitiveMeta, primitiveBounds, styles, outBounds, primitive);
      maxHalfWidth = Math.max(maxHalfWidth, primitive.halfWidth);
      continue;
    }

    const dx = primitive.x1 - primitive.x0;
    const dy = primitive.y1 - primitive.y0;
    if (dx * dx + dy * dy <= 1e-10) {
      if ((primitive.flags & STROKE_STYLE_FLAG_ROUND_CAP) !== 0) {
        emitPrimitive(endpoints, primitiveMeta, primitiveBounds, styles, outBounds, primitive);
        maxHalfWidth = Math.max(maxHalfWidth, primitive.halfWidth);
      }
      continue;
    }

    const tileIndex = tileIndexForPoint(
      primitiveCenterX(primitive),
      primitiveCenterY(primitive),
      scene.bounds,
      grid
    );
    const group = resolveIntervalGroup(groups, primitive, tileIndex, tolerance);
    pushGroupInterval(group, primitive, tolerance);
    maxHalfWidth = Math.max(maxHalfWidth, primitive.halfWidth);
  }

  for (const group of groups.values()) {
    emitMergedIntervals(group, endpoints, primitiveMeta, primitiveBounds, styles, outBounds, tolerance);
  }

  if (endpoints.quadCount === 0) {
    return null;
  }

  return {
    segmentCount: endpoints.quadCount,
    endpoints: endpoints.toTypedArray(),
    primitiveMeta: primitiveMeta.toTypedArray(),
    primitiveBounds: primitiveBounds.toTypedArray(),
    styles: styles.toTypedArray(),
    bounds: normalizeOutputBounds(outBounds, scene.bounds),
    maxHalfWidth
  };
}

function readStrokePrimitive(scene: VectorScene, index: number): StrokePrimitive | null {
  const offset = index * 4;
  const x0 = scene.endpoints[offset];
  const y0 = scene.endpoints[offset + 1];
  const cx = scene.endpoints[offset + 2];
  const cy = scene.endpoints[offset + 3];
  const x1 = scene.primitiveMeta[offset];
  const y1 = scene.primitiveMeta[offset + 1];
  const primitiveType = scene.primitiveMeta[offset + 2];
  const packedStyle = scene.primitiveMeta[offset + 3];
  const flags = Math.max(0, Math.trunc(packedStyle / STROKE_STYLE_FLAG_OFFSET + 1e-6));
  const alpha = clamp01(packedStyle - flags * STROKE_STYLE_FLAG_OFFSET);
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) {
    return null;
  }

  let visibleBounds: Bounds | undefined;
  if ((flags & STROKE_STYLE_FLAG_CLIPPED) !== 0) {
    const boundsMinX = scene.primitiveBounds[offset];
    const boundsMinY = scene.primitiveBounds[offset + 1];
    const boundsMaxX = scene.primitiveBounds[offset + 2];
    const boundsMaxY = scene.primitiveBounds[offset + 3];
    if (
      Number.isFinite(boundsMinX) &&
      Number.isFinite(boundsMinY) &&
      Number.isFinite(boundsMaxX) &&
      Number.isFinite(boundsMaxY)
    ) {
      visibleBounds = {minX: boundsMinX, minY: boundsMinY, maxX: boundsMaxX, maxY: boundsMaxY};
    }
  }

  return {
    x0,
    y0,
    cx,
    cy,
    x1,
    y1,
    primitiveType,
    halfWidth: Math.max(0, scene.styles[offset] ?? 0),
    flags,
    alpha,
    colorR: clamp01(scene.styles[offset + 1] ?? 0),
    colorG: clamp01(scene.styles[offset + 2] ?? 0),
    colorB: clamp01(scene.styles[offset + 3] ?? 0),
    visibleBounds
  };
}

function shouldDropPrimitiveAtTolerance(
  scene: VectorScene,
  index: number,
  primitive: StrokePrimitive,
  tolerance: number
): boolean {
  const offset = index * 4;
  const minX = scene.primitiveBounds[offset] - primitive.halfWidth;
  const minY = scene.primitiveBounds[offset + 1] - primitive.halfWidth;
  const maxX = scene.primitiveBounds[offset + 2] + primitive.halfWidth;
  const maxY = scene.primitiveBounds[offset + 3] + primitive.halfWidth;
  const projectedDropLocalSize = tolerance * LOD_DROP_LOCAL_SIZE_FACTOR;
  return Math.max(maxX - minX, maxY - minY) <= projectedDropLocalSize;
}

function resolveIntervalGroup(
  groups: Map<string, IntervalGroup>,
  primitive: StrokePrimitive,
  tileIndex: number,
  tolerance: number
): IntervalGroup {
  const dx = primitive.x1 - primitive.x0;
  const dy = primitive.y1 - primitive.y0;
  let angle = Math.atan2(dy, dx);
  if (angle < 0) {
    angle += Math.PI;
  }
  if (angle >= Math.PI) {
    angle -= Math.PI;
  }
  let angleBin = Math.round(angle / ANGLE_STEP);
  if (angleBin >= ANGLE_BIN_COUNT) {
    angleBin = 0;
  }
  const snappedAngle = angleBin * ANGLE_STEP;
  const axisX = Math.cos(snappedAngle);
  const axisY = Math.sin(snappedAngle);
  const normalX = -axisY;
  const normalY = axisX;
  const offset = primitive.x0 * normalX + primitive.y0 * normalY;
  const offsetKey = Math.round(offset / tolerance);
  const widthKey = (primitive.flags & STROKE_STYLE_FLAG_HAIRLINE) !== 0
    ? -1
    : Math.round(primitive.halfWidth * 10_000);
  const colorKey =
    `${Math.round(primitive.colorR * 255)},${Math.round(primitive.colorG * 255)},` +
    `${Math.round(primitive.colorB * 255)},${Math.round(primitive.alpha * 255)}`;
  const flags = primitive.flags & (STROKE_STYLE_FLAG_HAIRLINE | STROKE_STYLE_FLAG_ROUND_CAP | STROKE_STYLE_FLAG_CLIPPED);
  const key = `${tileIndex}|${flags}|${widthKey}|${colorKey}|${angleBin}|${offsetKey}`;

  let group = groups.get(key);
  if (!group) {
    group = {
      tileIndex,
      axisX,
      axisY,
      normalX,
      normalY,
      offset: offsetKey * tolerance,
      offsetSum: 0,
      offsetWeightSum: 0,
      clipMinX: Number.POSITIVE_INFINITY,
      clipMinY: Number.POSITIVE_INFINITY,
      clipMaxX: Number.NEGATIVE_INFINITY,
      clipMaxY: Number.NEGATIVE_INFINITY,
      halfWidth: primitive.halfWidth,
      flags,
      alpha: primitive.alpha,
      colorR: primitive.colorR,
      colorG: primitive.colorG,
      colorB: primitive.colorB,
      intervals: []
    };
    groups.set(key, group);
  }

  // Track the length-weighted true perpendicular offset of the group's members.
  // Emitting merged lines at this average (instead of the quantized bucket
  // offset) keeps regular patterns like hatching evenly spaced and makes line
  // positions agree across LOD levels, so per-tile level mixing stays seamless.
  const memberWeight = Math.hypot(dx, dy);
  group.offsetSum += offset * memberWeight;
  group.offsetWeightSum += memberWeight;

  // Clipped groups keep the union of their members' clip rects so merged
  // strokes can still be clip-discarded at render time. The union may span
  // multiple clip regions merged into one group; any resulting bleed is
  // bounded by the interval trim extension, i.e. the level's error budget.
  const clip = primitive.visibleBounds;
  if (clip) {
    group.clipMinX = Math.min(group.clipMinX, clip.minX);
    group.clipMinY = Math.min(group.clipMinY, clip.minY);
    group.clipMaxX = Math.max(group.clipMaxX, clip.maxX);
    group.clipMaxY = Math.max(group.clipMaxY, clip.maxY);
  }
  return group;
}

function emitMergedIntervals(
  group: IntervalGroup,
  endpoints: Float4Builder,
  primitiveMeta: Float4Builder,
  primitiveBounds: Float4Builder,
  styles: Float4Builder,
  bounds: Bounds,
  tolerance: number
): void {
  const pairCount = group.intervals.length >> 1;
  if (pairCount <= 0) {
    return;
  }

  if (group.offsetWeightSum > 0) {
    group.offset = group.offsetSum / group.offsetWeightSum;
  }

  const intervals = new Array<{start: number; end: number}>(pairCount);
  for (let i = 0; i < pairCount; i += 1) {
    const offset = i * 2;
    intervals[i] = {
      start: group.intervals[offset],
      end: group.intervals[offset + 1]
    };
  }
  intervals.sort((a, b) => a.start - b.start || a.end - b.end);

  const mergeGap = tolerance * LOD_MERGE_GAP_FACTOR;
  let currentStart = intervals[0].start;
  let currentEnd = intervals[0].end;
  for (let i = 1; i < intervals.length; i += 1) {
    const interval = intervals[i];
    if (interval.start <= currentEnd + mergeGap) {
      currentEnd = Math.max(currentEnd, interval.end);
      continue;
    }
    emitInterval(group, endpoints, primitiveMeta, primitiveBounds, styles, bounds, currentStart, currentEnd);
    currentStart = interval.start;
    currentEnd = interval.end;
  }
  emitInterval(group, endpoints, primitiveMeta, primitiveBounds, styles, bounds, currentStart, currentEnd);
}

function emitInterval(
  group: IntervalGroup,
  endpoints: Float4Builder,
  primitiveMeta: Float4Builder,
  primitiveBounds: Float4Builder,
  styles: Float4Builder,
  bounds: Bounds,
  start: number,
  end: number
): void {
  if (end - start <= 1e-6) {
    return;
  }
  const hasClip =
    (group.flags & STROKE_STYLE_FLAG_CLIPPED) !== 0 &&
    group.clipMinX <= group.clipMaxX &&
    group.clipMinY <= group.clipMaxY;
  emitPrimitive(endpoints, primitiveMeta, primitiveBounds, styles, bounds, {
    x0: group.axisX * start + group.normalX * group.offset,
    y0: group.axisY * start + group.normalY * group.offset,
    cx: group.axisX * end + group.normalX * group.offset,
    cy: group.axisY * end + group.normalY * group.offset,
    x1: group.axisX * end + group.normalX * group.offset,
    y1: group.axisY * end + group.normalY * group.offset,
    primitiveType: STROKE_PRIMITIVE_LINE,
    halfWidth: group.halfWidth,
    flags: group.flags,
    alpha: group.alpha,
    colorR: group.colorR,
    colorG: group.colorG,
    colorB: group.colorB,
    visibleBounds: hasClip
      ? {minX: group.clipMinX, minY: group.clipMinY, maxX: group.clipMaxX, maxY: group.clipMaxY}
      : undefined
  });
}

function emitPrimitive(
  endpoints: Float4Builder,
  primitiveMeta: Float4Builder,
  primitiveBounds: Float4Builder,
  styles: Float4Builder,
  bounds: Bounds,
  primitive: StrokePrimitive
): void {
  endpoints.push(primitive.x0, primitive.y0, primitive.cx, primitive.cy);
  primitiveMeta.push(
    primitive.x1,
    primitive.y1,
    primitive.primitiveType,
    primitive.alpha + primitive.flags * STROKE_STYLE_FLAG_OFFSET
  );
  styles.push(primitive.halfWidth, primitive.colorR, primitive.colorG, primitive.colorB);

  // Clipped primitives store their clip rect so the stroke shaders keep
  // discarding fragments outside it; everything else stores geometric bounds.
  const clip = primitive.visibleBounds;
  const minX = clip ? clip.minX : Math.min(primitive.x0, primitive.cx, primitive.x1);
  const minY = clip ? clip.minY : Math.min(primitive.y0, primitive.cy, primitive.y1);
  const maxX = clip ? clip.maxX : Math.max(primitive.x0, primitive.cx, primitive.x1);
  const maxY = clip ? clip.maxY : Math.max(primitive.y0, primitive.cy, primitive.y1);
  primitiveBounds.push(minX, minY, maxX, maxY);
  bounds.minX = Math.min(bounds.minX, minX);
  bounds.minY = Math.min(bounds.minY, minY);
  bounds.maxX = Math.max(bounds.maxX, maxX);
  bounds.maxY = Math.max(bounds.maxY, maxY);
}

function primitiveCenterX(primitive: StrokePrimitive): number {
  const clip = primitive.visibleBounds;
  return clip ? (clip.minX + clip.maxX) * 0.5 : (primitive.x0 + primitive.x1) * 0.5;
}

function primitiveCenterY(primitive: StrokePrimitive): number {
  const clip = primitive.visibleBounds;
  return clip ? (clip.minY + clip.maxY) * 0.5 : (primitive.y0 + primitive.y1) * 0.5;
}

function pushGroupInterval(group: IntervalGroup, primitive: StrokePrimitive, tolerance: number): void {
  const startProjection = primitive.x0 * group.axisX + primitive.y0 * group.axisY;
  const endProjection = primitive.x1 * group.axisX + primitive.y1 * group.axisY;
  let start = Math.min(startProjection, endProjection);
  let end = Math.max(startProjection, endProjection);

  // Clipped stroke geometry keeps its full unclipped extent in the source
  // scene; trim the LOD representative to the clip window (plus a small
  // extension so caps and AA still reach the clip edge before the fragment
  // discard cuts them) instead of emitting the invisible remainder.
  const clip = primitive.visibleBounds;
  if (clip) {
    const p0 = clip.minX * group.axisX + clip.minY * group.axisY;
    const p1 = clip.minX * group.axisX + clip.maxY * group.axisY;
    const p2 = clip.maxX * group.axisX + clip.minY * group.axisY;
    const p3 = clip.maxX * group.axisX + clip.maxY * group.axisY;
    const extension = Math.max(primitive.halfWidth * 4, tolerance, 1e-3);
    start = Math.max(start, Math.min(p0, p1, p2, p3) - extension);
    end = Math.min(end, Math.max(p0, p1, p2, p3) + extension);
    if (end - start <= 1e-6) {
      return;
    }
  }

  group.intervals.push(start, end);
}

function createTileGrid(bounds: Bounds, tolerance: number): TileGrid {
  const width = Math.max(1e-6, bounds.maxX - bounds.minX);
  const height = Math.max(1e-6, bounds.maxY - bounds.minY);
  const longSide = Math.max(width, height);
  const targetTileWorld = Math.max(96, tolerance * LOD_TILE_WORLD_FACTOR);
  const longAxisTiles = clampInt(Math.ceil(longSide / targetTileWorld), 16, 96);
  const aspect = width / height;
  const columns = aspect >= 1
    ? longAxisTiles
    : Math.max(1, Math.ceil(longAxisTiles * aspect));
  const rows = aspect >= 1
    ? Math.max(1, Math.ceil(longAxisTiles / aspect))
    : longAxisTiles;
  return {
    columns,
    rows,
    tileWidth: width / columns,
    tileHeight: height / rows
  };
}

function tileIndexForPoint(x: number, y: number, bounds: Bounds, grid: TileGrid): number {
  const column = clampInt(Math.floor((x - bounds.minX) / grid.tileWidth), 0, grid.columns - 1);
  const row = clampInt(Math.floor((y - bounds.minY) / grid.tileHeight), 0, grid.rows - 1);
  return row * grid.columns + column;
}

function createEmptyBounds(): Bounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };
}

function normalizeOutputBounds(bounds: Bounds, fallback: Bounds): Bounds {
  if (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.maxY)
  ) {
    return bounds;
  }
  return fallback;
}

function normalizeLocalUnitsPerPixel(value: number): number {
  return Number.isFinite(value) && value > 1e-8 ? value : 1;
}

export function formatToleranceName(tolerance: number): string {
  return tolerance <= 0 ? "exact" : `tol-${String(tolerance).replace(".", "_")}`;
}

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function logVectorLodBuildTiming(
  elapsedMs: number,
  sourceSegmentCount: number,
  levels: Array<{tolerance: number; segmentCount: number}>
): void {
  const levelSummary = levels
    .map((level) => `${formatToleranceName(level.tolerance)}:${level.segmentCount}`)
    .join(", ");
  console.info(
    `[hepr] vector stroke LOD generated in ${elapsedMs.toFixed(1)}ms ` +
    `(source segments: ${Math.max(0, sourceSegmentCount | 0)}, levels: ${levelSummary})`
  );
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function clampNumber(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function clampInt(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}
