// Build/representation changes must bump HEP_VECTOR_LOD_VERSION in hepLod.ts.
import {
  CompactStrokeIntervalGroups, NumberTupleTable,
  type StrokeIntervalPrimitive as StrokePrimitive, type StrokeIntervalGroup as IntervalGroup
} from "./vectorStrokeIntervalGroups";
import {
  explicitStrokePaintOrigins, hasStrokePaintOrigins, releaseStrokePaintGroups, setStrokePaintOrigins,
  strokePaintGroups, strokePaintOrigin
} from "./vectorStrokePaintOrder";
import {
  materializeVectorStrokeLodLevel, vectorStrokeLodLevelScene, type VectorStrokeLodRecordStore
} from "./vectorStrokeLodStorage";
import { sceneRequiresPaintCompositing } from "./scenePaintVisibility";
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
  /** Budget-oriented approximation that may omit tiny marks. */
  overview?: boolean;

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
  overview?: boolean;
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
  /** Selection stamps; a smaller element type only resets more often. */
  segmentMarks: Uint8Array | Uint32Array;
  /** Culling bounds, indexed by `records[id]` on store-backed levels, otherwise by `id`. */
  segmentMinX: Float32Array;
  segmentMinY: Float32Array;
  segmentMaxX: Float32Array;
  segmentMaxY: Float32Array;
  visibleSegmentIds: Uint32Array;
  visibleSegmentCount: number;
  markToken: number;
}

export interface RuntimeVectorStrokeLodLevel extends RuntimeStrokeTileBuckets {
  overview?: boolean;
  tolerance: number;
  /**
   * The level's standalone scene. Store-backed derived levels copy it out of
   * the shared store on first access; renderers address `records` instead.
   */
  readonly scene: VectorScene;
  segmentCount: number;
  /** Storage ID of each record in `store`; absent for the canonical level. */
  records?: Uint32Array;
  /** Canonical and LOD-only records shared by every level of one build. */
  store?: VectorStrokeLodRecordStore;
  /** Extent and widest pen of this level's records, as its scene reports them. */
  sceneBounds?: Bounds;
  maxHalfWidth?: number;
}

interface DenseStrokeGroup {
  /** Retain exact source IDs until the group is large enough to aggregate. */
  members: number[];
  count: number;
  coincident: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Paint group (-1 when absent), cell x/y, point flag and direction, flags,
// width, RGB, then the clip flag and rectangle: the fields of the original
// `paintGroup|x,y|direction|flags|width|r,g,b[|minX,minY,maxX,maxY]` key.
const DENSE_GROUP_KEY_LENGTH = 15;

/** Dense stroke groups in insertion order, keyed without a string per primitive. */
class DenseStrokeGroups {
  private readonly ids = new NumberTupleTable(DENSE_GROUP_KEY_LENGTH, 256);
  private readonly groups: DenseStrokeGroup[] = [];

  get key(): Float64Array {
    return this.ids.tuple;
  }

  get size(): number {
    return this.groups.length;
  }

  values(): readonly DenseStrokeGroup[] {
    return this.groups;
  }

  /** The group for `key`, or undefined; a miss remembers where add() stores it. */
  find(): DenseStrokeGroup | undefined {
    const entry = this.ids.find();
    return entry >= 0 ? this.groups[entry] : undefined;
  }

  add(group: DenseStrokeGroup): void {
    this.ids.insert();
    this.groups.push(group);
  }

  clear(): void {
    this.ids.clear();
    this.groups.length = 0;
  }
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

let accumulatedBuildTiming: VectorStrokeLodBuildTiming = {
  elapsedMs: 0,
  buildCount: 0,
  sourceSegmentCount: 0,
  levelCount: 0
};

// One idle hierarchy per scene is enough for renderer replacement. Keeping a
// queue lets every backend switch retain another complete, unused hierarchy.
const prebuiltRuntimeByScene = new WeakMap<VectorScene, VectorStrokeLodRuntime>();

// Fixed-size chunks avoid repeatedly doubling and copying multi-million-stroke
// buffers. Finalization releases each chunk as it copies into the exact-sized
// result, so only one array is consolidated at a time. Truncation discards the
// records of a level that is not retained.
const BUILDER_CHUNK_SHIFT = 14;
const BUILDER_CHUNK_RECORDS = 1 << BUILDER_CHUNK_SHIFT;

class ChunkedUint32Builder {
  private readonly chunks: Uint32Array[] = [];
  private readonly width: number;
  length = 0;

  constructor(width: 1 | 4) { this.width = width; }

  push(value: number): void {
    const chunk = this.chunkFor(this.length);
    chunk[this.length & (BUILDER_CHUNK_RECORDS - 1)] = value;
    this.length++;
  }

  /** Append four words from `source` at `offset`; this builder must have width 4. */
  push4(source: Uint32Array, offset: number): void {
    const chunk = this.chunkFor(this.length);
    const target = (this.length & (BUILDER_CHUNK_RECORDS - 1)) * 4;
    chunk[target] = source[offset];
    chunk[target + 1] = source[offset + 1];
    chunk[target + 2] = source[offset + 2];
    chunk[target + 3] = source[offset + 3];
    this.length++;
  }

  truncate(length: number): void {
    this.length = Math.min(this.length, length);
    this.chunks.length = Math.ceil(this.length / BUILDER_CHUNK_RECORDS);
  }

  toTypedArray(): Uint32Array {
    const result = new Uint32Array(this.length * this.width);
    const chunkWords = BUILDER_CHUNK_RECORDS * this.width;
    for (let index = 0; index < this.chunks.length; index++) {
      const offset = index * chunkWords;
      result.set(this.chunks[index].subarray(0, Math.min(chunkWords, result.length - offset)), offset);
      this.chunks[index] = new Uint32Array(0);
    }
    this.chunks.length = 0;
    this.length = 0;
    return result;
  }

  private chunkFor(record: number): Uint32Array {
    const index = record >>> BUILDER_CHUNK_SHIFT;
    return this.chunks[index] ?? (this.chunks[index] = new Uint32Array(BUILDER_CHUNK_RECORDS * this.width));
  }
}

const STROKE_LOD_FIELDS = ["endpoints", "primitiveMeta", "primitiveBounds", "styles"] as const;

/**
 * Collects every derived level of one build. A record whose 16 words and paint
 * origin equal a canonical stroke is stored as that stroke's ID; any other
 * record is appended once to the shared LOD-only store. Levels keep their exact
 * record order and bits without duplicating unchanged strokes.
 */
class StrokeLodRecordSink {
  readonly canonicalCount: number;
  private readonly canonical: VectorScene;
  private readonly canonicalWords: Uint32Array[];
  /** Explicit canonical origins; canonical scenes with draw runs use their own IDs. */
  private readonly canonicalOrigins: Uint32Array | undefined;
  private readonly hasOrigins: boolean;
  private readonly fields = STROKE_LOD_FIELDS.map(() => new ChunkedUint32Builder(4));
  private readonly literalOrigins: ChunkedUint32Builder | undefined;
  private readonly record = new Float32Array(16);
  private readonly recordWords = new Uint32Array(this.record.buffer);
  private records = new ChunkedUint32Builder(1);
  private levelLiteralStart = 0;
  private literalCount = 0;

  constructor(canonical: VectorScene) {
    this.canonical = canonical;
    this.canonicalCount = Math.max(0, canonical.segmentCount | 0);
    this.canonicalWords = STROKE_LOD_FIELDS.map(key => {
      const values = canonical[key];
      return new Uint32Array(values.buffer, values.byteOffset, values.length);
    });
    this.canonicalOrigins = explicitStrokePaintOrigins(canonical);
    this.hasOrigins = hasStrokePaintOrigins(canonical);
    this.literalOrigins = this.hasOrigins ? new ChunkedUint32Builder(1) : undefined;
  }

  get levelRecordCount(): number {
    return this.records.length;
  }

  beginLevel(): void {
    this.records = new ChunkedUint32Builder(1);
    this.levelLiteralStart = this.literalCount;
  }

  /**
   * `sourceIndex` names the canonical stroke an unmodified primitive was read
   * from. Constructed primitives are compared with their paint origin instead.
   */
  push(primitive: StrokePrimitive, minX: number, minY: number, maxX: number, maxY: number, sourceIndex: number): void {
    const record = this.record;
    record[0] = primitive.x0;
    record[1] = primitive.y0;
    record[2] = primitive.cx;
    record[3] = primitive.cy;
    record[4] = primitive.x1;
    record[5] = primitive.y1;
    record[6] = primitive.primitiveType;
    record[7] = primitive.alpha + primitive.flags * STROKE_STYLE_FLAG_OFFSET;
    record[8] = minX;
    record[9] = minY;
    record[10] = maxX;
    record[11] = maxY;
    record[12] = primitive.halfWidth;
    record[13] = primitive.colorR;
    record[14] = primitive.colorG;
    record[15] = primitive.colorB;
    const origin = primitive.paintOrder ?? 0;
    const candidate = sourceIndex >= 0 ? sourceIndex
      : this.hasOrigins && primitive.paintOrder !== undefined ? primitive.paintOrder : -1;
    if (candidate >= 0 && candidate < this.canonicalCount &&
        (!this.hasOrigins || (this.canonicalOrigins ? this.canonicalOrigins[candidate] : candidate) === origin) &&
        this.matchesCanonical(candidate)) {
      this.records.push(candidate);
      return;
    }
    for (let field = 0; field < STROKE_LOD_FIELDS.length; field++) this.fields[field].push4(this.recordWords, field * 4);
    this.literalOrigins?.push(origin);
    this.records.push(this.canonicalCount + this.literalCount++);
  }

  /** Finish the current level; a rejected level also releases its literals. */
  endLevel(keep: boolean): Uint32Array | null {
    if (!keep) {
      this.literalCount = this.levelLiteralStart;
      for (const field of this.fields) field.truncate(this.literalCount);
      this.literalOrigins?.truncate(this.literalCount);
      this.records = new ChunkedUint32Builder(1);
      return null;
    }
    const records = this.records.toTypedArray();
    this.records = new ChunkedUint32Builder(1);
    return records;
  }

  finish(): VectorScene {
    const literals: VectorScene = { ...this.canonical, segmentCount: this.literalCount };
    STROKE_LOD_FIELDS.forEach((key, index) => {
      literals[key] = new Float32Array(this.fields[index].toTypedArray().buffer);
    });
    setStrokePaintOrigins(literals, this.literalOrigins?.toTypedArray());
    return literals;
  }

  private matchesCanonical(index: number): boolean {
    const words = this.recordWords;
    const offset = index * 4;
    for (let field = 0; field < STROKE_LOD_FIELDS.length; field++) {
      const source = this.canonicalWords[field];
      const at = field * 4;
      if (source[offset] !== words[at] || source[offset + 1] !== words[at + 1] ||
          source[offset + 2] !== words[at + 2] || source[offset + 3] !== words[at + 3]) return false;
    }
    return true;
  }
}

const STROKE_PRIMITIVE_LINE = 0;
const STROKE_PRIMITIVE_QUADRATIC = 1;
const STROKE_STYLE_FLAG_HAIRLINE = 1 << 0;
const STROKE_STYLE_FLAG_ROUND_CAP = 1 << 1;
const STROKE_STYLE_FLAG_CLIPPED = 1 << 2;
const STROKE_STYLE_FLAG_OFFSET = 2;
const ANGLE_STEP = Math.PI / 720;
const MIN_LEVEL_REDUCTION_RATIO = 0.985;
const LOD_SCREEN_ERROR_BUDGET_PX = 1.25;
// Prefer overview levels within four times the normal tolerance. Dense views
// may retain coarser overview geometry when the visible draw list exceeds budget.
const LOD_OVERVIEW_SCREEN_ERROR_BUDGET_PX = 5;
// Relative to the entire drawing, not a world-space slope threshold. Three's
// camera controls can introduce ~1e-16 roundoff in an otherwise planar view.
const LOD_PLANAR_ROUNDOFF_EPSILON = 1e-12;
const LOD_PLANAR_BASIS_INDICES = [0, 1, 4, 5] as const;
const LOD_RUNTIME_TILE_TARGET_SEGMENTS = 512;
const LOD_VISIBILITY_GUARD_PIXELS = 64;
const LOD_RUNTIME_MIN_TILE_COUNT = 256;
const LOD_RUNTIME_MAX_TILE_COUNT = 4096;
const LOD_RUNTIME_MIN_GRID_SIDE = 12;
const LOD_RUNTIME_MAX_GRID_SIDE = 96;
const LOD_RUNTIME_DENSITY_EDGE_MIN_TILE_RATIO = 0.22;
const LOD_RUNTIME_EDGE_CENTER_WEIGHT = 0.45;
const LOD_RUNTIME_EDGE_ENDPOINT_WEIGHT = 0.1;
const LOD_RUNTIME_EDGE_STYLE_BIN_WEIGHT = 3.2;
const LOD_RUNTIME_STYLE_BIN_KEY_STRIDE = 8192;
const LOD_TILE_MIN_VISIBLE_SEGMENTS = 1;
const LOD_TILE_SOFT_OVERSHOOT_RATIO = 1.65;
const LOD_TILE_SELECTION_HYSTERESIS_RATIO = 0.18;
const LOD_TILE_UNDERSHOOT_SCORE_WEIGHT = 1.15;
// Tilted views test tiles against the view frustum widened by this screen
// margin, which covers antialiasing and pen width outside the viewport.
const LOD_PROJECTED_MARGIN_PX = 16;
// Four frustum side planes grow a clipped rectangle by at most four vertices.
const LOD_PROJECTED_CLIP_MAX_VERTICES = 8;
// Tile scale bounds cover this fraction of a tile beyond each side, where
// most border-crossing primitives end.
const LOD_PROJECTED_TILE_MARGIN = 0.25;
// Small details retain their exact geometry and fade through analytic pixel
// coverage. Merging them can close dash gaps or collapse neighbouring marks.
const LOD_PRESERVE_LOCAL_SIZE_FACTOR = 1.1;
const LOD_MERGE_GAP_FACTOR = 1.5;
// A cell side spans at most 0.0625 pixels at its permitted screen-space tolerance.
const LOD_DENSITY_CELL_FACTOR = 0.05;
const LOD_DENSITY_MIN_MEMBERS = 8;
const LOD_DENSITY_MAX_GROUPS = 250_000;
const LOD_DENSITY_MAX_MULTIPLICITY = 65_535;
const LOD_TILE_WORLD_FACTOR = 192;

export class VectorStrokeLodRuntime {
  readonly levels: RuntimeVectorStrokeLodLevel[];
  readonly tileGrid: RuntimeTileGrid;

  private readonly tileSelectedLevelIndices: Int16Array;
  // Tilted perspective views, per tile: the finest local units per pixel over
  // its visible part (-1 outside the frustum), its relative screen-area
  // magnification, its visible area fraction, and whether the frustum cuts it
  // (its primitives then need culling).
  private readonly projectedTileUnitsPerPixel: Float64Array;
  private readonly projectedTileWeights: Float64Array;
  private readonly projectedTileVisibleFractions: Float64Array;
  private readonly projectedTilePartial: Uint8Array;
  private readonly projectedPlanes = new Float64Array(12);
  private readonly projectedClip = new Float64Array(LOD_PROJECTED_CLIP_MAX_VERTICES * 4);
  private readonly projectedTileRect = new Float64Array(4);
  private readonly levelTileReach: Array<Float32Array | undefined> = [];
  private projectedHalfWidth = 1;
  private projectedHalfHeight = 1;
  private projectedClipCut = false;
  private projectedRectDepth = 0;
  private projectedRectArea = 0;
  private readonly maxHalfWidth: number;
  private activeLevelIndex = 0;
  private forceExact = false;
  private useLocalToClip = false;
  private constantClipW = false;
  private finiteLocalToClip = false;
  private readonly localToClip = new Float64Array(16);
  private readonly selectionProjectionBasis = new Float64Array(4);
  private localUnitsPerPixel = 1;
  private lastVisibleSegmentCount = 0;
  private readonly allLevelBounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  private fullViewBaselineLevelIndex = -1;
  private fullViewMaxLevelIndex = -1;
  private selectionGuard: { bounds: CullingBounds; range: RuntimeTileRange; baseline: number; maxLevel: number } | null = null;
  private stats: VectorStrokeLodStats;

  constructor(scene: VectorScene, buildData?: VectorStrokeLodRuntimeBuildData) {
    const restored = !buildData ? storedBuilds.get(scene) : undefined;
    if (restored) buildData = restoreVectorStrokeLodBuild(scene, restored);
    const lodBuildStart = nowMs();
    this.tileGrid = buildData?.tileGrid ?? createRuntimeTileGrid(scene.bounds, Math.max(0, scene.segmentCount | 0), scene);
    this.tileSelectedLevelIndices = new Int16Array(this.tileGrid.columns * this.tileGrid.rows);
    this.tileSelectedLevelIndices.fill(-1);
    this.projectedTileUnitsPerPixel = new Float64Array(this.tileGrid.columns * this.tileGrid.rows);
    this.projectedTileWeights = new Float64Array(this.tileGrid.columns * this.tileGrid.rows);
    this.projectedTileVisibleFractions = new Float64Array(this.tileGrid.columns * this.tileGrid.rows);
    this.projectedTilePartial = new Uint8Array(this.tileGrid.columns * this.tileGrid.rows);
    this.maxHalfWidth = Math.max(0, scene.maxHalfWidth);
    this.levels = buildData?.levels ?? runStrokeLodBuild(buildStoredStrokeLodLevels(scene, this.tileGrid));
    for (const level of this.levels) {
      const records = level.records;
      for (let index = 0; index < level.segmentCount; index++) {
        const id = records ? records[index] : index;
        this.allLevelBounds.minX = Math.min(this.allLevelBounds.minX, level.segmentMinX[id]);
        this.allLevelBounds.minY = Math.min(this.allLevelBounds.minY, level.segmentMinY[id]);
        this.allLevelBounds.maxX = Math.max(this.allLevelBounds.maxX, level.segmentMaxX[id]);
        this.allLevelBounds.maxY = Math.max(this.allLevelBounds.maxY, level.segmentMaxY[id]);
      }
    }
    if (this.levels.length > 0) {
      this.activeLevelIndex = 0;
    }
    this.stats = this.createEmptyStats();
    const elapsedMs = buildData?.elapsedMs ?? (nowMs() - lodBuildStart);
    if (buildData?.elapsedMs !== 0) {
      logVectorLodBuildTiming(elapsedMs, scene.segmentCount, this.levels);
      recordVectorLodBuildTiming(elapsedMs, scene.segmentCount, this.levels.length);
    }
    latestRuntimeByScene.set(scene, new WeakRef(this));
  }

  setScreenSpaceTransform(): void {
    if (this.useLocalToClip) {
      this.selectionGuard = null;
      this.fullViewBaselineLevelIndex = -1;
    }
    this.useLocalToClip = false;
  }

  /** Temporarily retain primitive identity without rebuilding the LOD payload. */
  setForceExact(enabled: boolean): void {
    if (this.forceExact === enabled) return;
    this.forceExact = enabled;
    this.selectionGuard = null;
    this.fullViewBaselineLevelIndex = -1;
    this.tileSelectedLevelIndices.fill(-1);
  }

  setLocalToClipTransform(localToClip: ArrayLike<number>, localUnitsPerPixel: number): void {
    // Bound roundoff over the drawing: a tiny W slope alone is not safe for
    // large coordinates. Keep the actual projection unchanged for rendering.
    let finite = true;
    let sameLinearTransform = this.useLocalToClip && this.constantClipW;
    for (let i = 0; i < 16; i += 1) {
      const value = Number(localToClip[i]);
      finite &&= Number.isFinite(value);
      this.localToClip[i] = value || 0;
    }
    this.finiteLocalToClip = finite;
    const elements = this.localToClip;
    const maxAbsX = Math.max(Math.abs(this.tileGrid.minX), Math.abs(this.tileGrid.maxX),
      Math.abs(this.allLevelBounds.minX), Math.abs(this.allLevelBounds.maxX));
    const maxAbsY = Math.max(Math.abs(this.tileGrid.minY), Math.abs(this.tileGrid.maxY),
      Math.abs(this.allLevelBounds.minY), Math.abs(this.allLevelBounds.maxY));
    const wOffset = elements[15];
    const wVariation = Math.abs(elements[3]) * maxAbsX + Math.abs(elements[7]) * maxAbsY;
    this.constantClipW = finite && Math.abs(wOffset) > 1e-8 && Number.isFinite(wVariation) &&
      wVariation <= Math.abs(wOffset) * LOD_PLANAR_ROUNDOFF_EPSILON;
    // Only the normalized XY basis changes projected density. The example
    // adjusts near/far planes during pans; those change depth, not screen area.
    // Compare with the last invalidated basis so repeated tiny changes cannot
    // accumulate into an undetected scale/orientation change.
    for (let row = 0; row < 2 && sameLinearTransform; row++) {
      const x = elements[row] / wOffset, y = elements[row + 4] / wOffset;
      const previousX = this.selectionProjectionBasis[row], previousY = this.selectionProjectionBasis[row + 2];
      const epsilon = Math.max(Math.abs(x), Math.abs(y), Math.abs(previousX), Math.abs(previousY)) *
        LOD_PLANAR_ROUNDOFF_EPSILON;
      if (Math.abs(x - previousX) > epsilon || Math.abs(y - previousY) > epsilon) sameLinearTransform = false;
    }
    if (!this.constantClipW || !sameLinearTransform) {
      this.selectionGuard = null;
      this.fullViewBaselineLevelIndex = -1;
      for (let i = 0; i < LOD_PLANAR_BASIS_INDICES.length; i++) {
        this.selectionProjectionBasis[i] = elements[LOD_PLANAR_BASIS_INDICES[i]] / wOffset;
      }
    }
    this.useLocalToClip = true;
    this.localUnitsPerPixel = normalizeLocalUnitsPerPixel(localUnitsPerPixel);
  }

  updateForLocalUnitsPerPixel(localUnitsPerPixel: number): boolean {
    this.localUnitsPerPixel = normalizeLocalUnitsPerPixel(localUnitsPerPixel);
    this.activeLevelIndex = this.chooseLevelIndex(this.localUnitsPerPixel);
    return this.activeLevelIndex > 0;
  }

  /** False means the previous visible IDs and statistics remain valid. */
  update(viewState: ViewState, viewport: ViewportPixels, cullingBounds?: CullingBounds | null): boolean {
    if (this.levels.length <= 0) {
      this.lastVisibleSegmentCount = 0;
      this.stats = this.createEmptyStats();
      return true;
    }
    return this.updateTiledVisibleSegments(viewState, viewport, cullingBounds);
  }

  getStats(): VectorStrokeLodStats {
    return {
      ...this.stats,
      activeLevels: this.stats.activeLevels.map((level) => ({...level}))
    };
  }

  resetVisible(): void {
    this.fullViewBaselineLevelIndex = -1;
    this.selectionGuard = null;
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

  private chooseLevelIndex(localUnitsPerPixel: number, errorBudget = LOD_SCREEN_ERROR_BUDGET_PX, overviewOnly = false): number {
    if (this.forceExact) return 0;
    const maxTolerance = localUnitsPerPixel * errorBudget;
    for (let i = this.levels.length - 1; i >= 1; i -= 1) {
      if ((!overviewOnly || this.levels[i].overview) && this.levels[i].tolerance <= maxTolerance) {
        return i;
      }
    }
    return 0;
  }

  private updateTiledVisibleSegments(
    viewState: ViewState,
    viewport: ViewportPixels,
    cullingBounds?: CullingBounds | null
  ): boolean {
    const viewBounds = resolveStrokeViewBounds(viewState, viewport, cullingBounds, this.maxHalfWidth);
    const screenErrorLevelIndex = this.chooseLevelIndex(this.localUnitsPerPixel);
    const maxLevelIndex = Math.max(screenErrorLevelIndex,
      this.chooseLevelIndex(this.localUnitsPerPixel, LOD_OVERVIEW_SCREEN_ERROR_BUDGET_PX, true));
    const tileRange = tileRangeForBounds(viewBounds.minX, viewBounds.minY, viewBounds.maxX, viewBounds.maxY, this.tileGrid);
    // Projected reuse needs caller-provided plane bounds; the scalar view state
    // alone cannot certify what an arbitrary host camera sees.
    const cacheableView = !this.useLocalToClip || (this.constantClipW && cullingBounds != null &&
      [cullingBounds.minX, cullingBounds.minY, cullingBounds.maxX, cullingBounds.maxY].every(Number.isFinite) &&
      cullingBounds.minX <= cullingBounds.maxX && cullingBounds.minY <= cullingBounds.maxY);
    // A static planar overview keeps the same tile budget and geometry while
    // every LOD's bounds remain visible. Panning needs no new selection scan.
    const fullyVisible = cacheableView && tileRange !== null &&
      tileRange.c0 === 0 && tileRange.r0 === 0 &&
      tileRange.c1 === this.tileGrid.columns - 1 && tileRange.r1 === this.tileGrid.rows - 1 &&
      viewBounds.minX <= this.allLevelBounds.minX && viewBounds.minY <= this.allLevelBounds.minY &&
      viewBounds.maxX >= this.allLevelBounds.maxX && viewBounds.maxY >= this.allLevelBounds.maxY;
    if (fullyVisible && this.fullViewBaselineLevelIndex === screenErrorLevelIndex &&
        this.fullViewMaxLevelIndex === maxLevelIndex) return false;
    const guard = cacheableView && this.levels[0].segmentCount >= VECTOR_STROKE_LOD_MIN_SEGMENTS &&
      [viewBounds.minX, viewBounds.minY, viewBounds.maxX, viewBounds.maxY].every(Number.isFinite)
      ? LOD_VISIBILITY_GUARD_PIXELS * this.localUnitsPerPixel : 0;
    const cached = this.selectionGuard;
    if (guard > 0 && cached && tileRange && cached.baseline === screenErrorLevelIndex && cached.maxLevel === maxLevelIndex &&
        cached.range.c0 === tileRange.c0 && cached.range.c1 === tileRange.c1 &&
        cached.range.r0 === tileRange.r0 && cached.range.r1 === tileRange.r1 &&
        viewBounds.minX >= cached.bounds.minX && viewBounds.minY >= cached.bounds.minY &&
        viewBounds.maxX <= cached.bounds.maxX && viewBounds.maxY <= cached.bounds.maxY &&
        cached.bounds.maxX - cached.bounds.minX <= viewBounds.maxX - viewBounds.minX + guard * 4 &&
        cached.bounds.maxY - cached.bounds.minY <= viewBounds.maxY - viewBounds.minY + guard * 4) return false;
    this.selectionGuard = null;
    this.fullViewBaselineLevelIndex = -1;
    this.resetLevelDrawLists();
    if (!tileRange) {
      this.lastVisibleSegmentCount = 0;
      this.updateLevelStats(0, 0, 0, 0, screenErrorLevelIndex, 0, screenErrorLevelIndex, screenErrorLevelIndex);
      return true;
    }

    // Expand primitive filtering, not the tile range: tile density budgets and
    // LOD choice remain exactly those of the actual viewport. A cached result
    // is reusable only while that tile range and baseline level also agree.
    const guardedBounds = guard > 0 ? { minX: viewBounds.minX - guard, minY: viewBounds.minY - guard,
      maxX: viewBounds.maxX + guard, maxY: viewBounds.maxY + guard } : null;
    const selectionBounds = guardedBounds && [guardedBounds.minX, guardedBounds.minY,
      guardedBounds.maxX, guardedBounds.maxY].every(Number.isFinite) ? guardedBounds : viewBounds;
    // A tilted perspective view has no uniform pixel scale: a center-plane
    // scale cannot bound magnification on its near side. Such views derive each
    // tile's error limits from its own closest visible point and share the
    // budget by screen area, so near content keeps detail while far content
    // thins out. Tiles outside the view frustum are skipped.
    const projectedWeightSum = this.useLocalToClip && !this.constantClipW
      ? this.projectTiles(tileRange, viewport) : -1;
    const projected = projectedWeightSum >= 0;
    let visibleTileCount = 0;
    let occupiedTileCount = 0;
    for (let row = tileRange.r0; row <= tileRange.r1; row++) {
      for (let column = tileRange.c0; column <= tileRange.c1; column++) {
        const tileIndex = row * this.tileGrid.columns + column;
        if (projected && this.projectedTileUnitsPerPixel[tileIndex] < 0) continue;
        visibleTileCount++;
        if (this.levels[0].tileCounts[tileIndex] > 0) occupiedTileCount++;
      }
    }
    let targetSegmentsPerTile = Math.max(LOD_TILE_MIN_VISIBLE_SEGMENTS,
      Math.ceil(VECTOR_STROKE_LOD_TARGET_VISIBLE_SEGMENTS / Math.max(1, occupiedTileCount)));
    let baselineLevelIndex = projected ? this.levels.length : screenErrorLevelIndex;
    let projectedTargetSum = 0;
    let maxBaselineTileSegments = 0;
    let maxBaselineTileSelectedSegments = 0;
    let maxBaselineTileSelectedLevelIndex = screenErrorLevelIndex;
    let maxSelectedTileSegments = 0;
    let maxSelectedTileLevelIndex = screenErrorLevelIndex;

    const canRelaxOverview = !this.forceExact && this.levels.some(level => level.overview);
    const softVisibleLimit = VECTOR_STROKE_LOD_TARGET_VISIBLE_SEGMENTS * LOD_TILE_SOFT_OVERSHOOT_RATIO;
    // First keep the normal screen-error limits. A tile exceeding its equal
    // share does not imply that the whole view is expensive (e.g. sparse hatch
    // lines crossing many tiles). Only relax quality after actual culled,
    // deduplicated draw IDs exceed the global soft budget. Stop that probe at
    // the limit so dense close-ups never build a million-entry exact draw list.
    for (let pass = 0; pass < 2; pass++) {
      if (pass > 0) {
        this.resetLevelDrawLists();
        baselineLevelIndex = projected ? this.levels.length : screenErrorLevelIndex;
        projectedTargetSum = 0;
        maxBaselineTileSegments = 0;
        maxSelectedTileSegments = 0;
      }
      let selectedSegmentCount = 0;
      selectTiles: for (let row = tileRange.r0; row <= tileRange.r1; row += 1) {
        for (let column = tileRange.c0; column <= tileRange.c1; column += 1) {
          const tileIndex = row * this.tileGrid.columns + column;
          const baselineTileSegments = this.levels[0].tileCounts[tileIndex];
          let tileBaselineLevelIndex = screenErrorLevelIndex;
          let tileMaxLevelIndex = maxLevelIndex;
          let tileTargetSegments = targetSegmentsPerTile;
          let cullingPlanes: Float64Array | null = null;
          if (projected) {
            const unitsPerPixel = this.projectedTileUnitsPerPixel[tileIndex];
            if (unitsPerPixel < 0 || baselineTileSegments === 0) continue;
            tileBaselineLevelIndex = this.chooseLevelIndex(unitsPerPixel);
            tileMaxLevelIndex = Math.max(tileBaselineLevelIndex,
              this.chooseLevelIndex(unitsPerPixel, LOD_OVERVIEW_SCREEN_ERROR_BUDGET_PX, true));
            while (tileMaxLevelIndex > 0 && !this.tileReachWithinBudget(tileIndex, tileMaxLevelIndex)) tileMaxLevelIndex--;
            tileBaselineLevelIndex = Math.min(tileBaselineLevelIndex, tileMaxLevelIndex);
            if (projectedWeightSum > 0) {
              tileTargetSegments = Math.max(LOD_TILE_MIN_VISIBLE_SEGMENTS, Math.round(
                VECTOR_STROKE_LOD_TARGET_VISIBLE_SEGMENTS * this.projectedTileWeights[tileIndex] / projectedWeightSum));
            }
            projectedTargetSum += tileTargetSegments;
            if (this.projectedTilePartial[tileIndex]) cullingPlanes = this.projectedPlanes;
            baselineLevelIndex = Math.min(baselineLevelIndex, tileBaselineLevelIndex);
          }
          const levelIndex = this.chooseTileLevel(tileIndex, tileTargetSegments, tileBaselineLevelIndex, tileMaxLevelIndex, pass > 0);
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
          const level = this.levels[levelIndex];
          const previousCount = level.visibleSegmentCount;
          appendTileSegments(level, tileIndex, selectionBounds, cullingPlanes,
            canRelaxOverview && pass === 0 ? softVisibleLimit + 1 - selectedSegmentCount : Infinity);
          selectedSegmentCount += level.visibleSegmentCount - previousCount;
          if (canRelaxOverview && pass === 0 && selectedSegmentCount > softVisibleLimit) break selectTiles;
        }
      }
      if (!canRelaxOverview || selectedSegmentCount <= softVisibleLimit) break;
    }
    if (projected) {
      // Report the nearest visible detail limit and the mean tile share.
      if (baselineLevelIndex >= this.levels.length) baselineLevelIndex = screenErrorLevelIndex;
      if (occupiedTileCount > 0) targetSegmentsPerTile = Math.round(projectedTargetSum / occupiedTileCount);
    }
    this.activeLevelIndex = baselineLevelIndex;

    this.updateLevelStats(
      visibleTileCount,
      targetSegmentsPerTile,
      maxBaselineTileSegments,
      maxBaselineTileSelectedSegments,
      maxBaselineTileSelectedLevelIndex,
      maxSelectedTileSegments,
      maxSelectedTileLevelIndex,
      baselineLevelIndex
    );
    if (fullyVisible) {
      this.fullViewBaselineLevelIndex = screenErrorLevelIndex;
      this.fullViewMaxLevelIndex = maxLevelIndex;
    }
    if (selectionBounds !== viewBounds) this.selectionGuard = {
      bounds: selectionBounds, range: tileRange, baseline: screenErrorLevelIndex, maxLevel: maxLevelIndex
    };
    return true;
  }

  private resetLevelDrawLists(): void {
    for (const level of this.levels) {
      level.visibleSegmentCount = 0;
      level.markToken += 1;
      // Byte stamps restart every 255 selections instead of costing four bytes per record.
      if (level.markToken >= 2 ** (8 * level.segmentMarks.BYTES_PER_ELEMENT) - 1) {
        level.segmentMarks.fill(0);
        level.markToken = 1;
      }
    }
  }

  private chooseTileLevel(tileIndex: number, targetSegmentsPerTile: number, baselineLevelIndex: number, maxLevelIndex: number,
    allowBudgetFallback = false): number {
    if (this.forceExact) {
      this.tileSelectedLevelIndices[tileIndex] = 0;
      return 0;
    }
    // Restore exact geometry as soon as it fits. At close zoom the larger
    // per-tile budget must not keep a coarse level alive through hysteresis.
    if (this.levels[0].tileCounts[tileIndex] <= targetSegmentsPerTile) {
      this.tileSelectedLevelIndices[tileIndex] = 0;
      return 0;
    }
    // Use coverage-preserving geometry whenever it fits. Overview approximation is
    // reserved for tiles whose finer representation exceeds the budget.
    for (let index = 1; index <= baselineLevelIndex; index++) {
      if (!this.levels[index].overview && this.levels[index].tileCounts[tileIndex] <= targetSegmentsPerTile) {
        this.tileSelectedLevelIndices[tileIndex] = index;
        return index;
      }
    }
    let bestIndex = this.chooseTargetBalancedTileLevel(tileIndex, targetSegmentsPerTile, maxLevelIndex);
    const softOvershootLimit = Math.max(1, targetSegmentsPerTile * LOD_TILE_SOFT_OVERSHOOT_RATIO);
    // A zoom threshold must not replace a usable overview with millions of
    // strokes. Relax the quality limit only for explicit overview levels,
    // stopping at the finest one that fits the soft budget. For tilted views
    // this also relaxes the primitive-reach limit, but keeps frustum culling
    // and the projected budget shares.
    if (allowBudgetFallback &&
        this.levels[bestIndex].tileCounts[tileIndex] > softOvershootLimit) {
      for (let index = maxLevelIndex + 1; index < this.levels.length; index++) {
        if (!this.levels[index].overview) continue;
        const count = this.levels[index].tileCounts[tileIndex];
        if (count < this.levels[bestIndex].tileCounts[tileIndex]) bestIndex = index;
        if (count <= softOvershootLimit) break;
      }
    }
    const previousLevelIndex = this.tileSelectedLevelIndices[tileIndex];

    if (previousLevelIndex >= 0 && previousLevelIndex <= maxLevelIndex) {
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

  private chooseTargetBalancedTileLevel(tileIndex: number, targetSegmentsPerTile: number, maxLevelIndex: number): number {
    const softOvershootLimit = Math.max(1, targetSegmentsPerTile * LOD_TILE_SOFT_OVERSHOOT_RATIO);
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    let smallestCount = Number.POSITIVE_INFINITY;
    let smallestCountIndex = maxLevelIndex;

    for (let i = 0; i <= maxLevelIndex; i += 1) {
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

  /**
   * Project the tile range through a tilted perspective transform.
   *
   * Tiles whose widened rectangle is outside the view frustum get -1 units per
   * pixel. Visible tiles get a conservative scale for the visible part of that
   * rectangle, a budget weight proportional to its screen-area magnification,
   * and a flag when the frustum cuts it. Returns the weight sum of occupied
   * tiles scaled by their visible fraction, which is the expected share of
   * rendered content, or -1 when the projection is unusable.
   */
  private projectTiles(tileRange: RuntimeTileRange, viewport: ViewportPixels): number {
    if (!this.finiteLocalToClip) return -1;
    const m = this.localToClip;
    this.projectedHalfWidth = Math.max(1, viewport.width) * 0.5;
    this.projectedHalfHeight = Math.max(1, viewport.height) * 0.5;
    const planes = this.projectedPlanes;
    for (let axis = 0; axis < 2; axis++) {
      // |clip x| <= w and |clip y| <= w, widened by the screen margin. These
      // planes all pass through the eye, so they also exclude W <= 0.
      const widen = 1 + LOD_PROJECTED_MARGIN_PX / (axis === 0 ? this.projectedHalfWidth : this.projectedHalfHeight);
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? 1 : -1;
        const offset = (axis * 2 + side) * 3;
        planes[offset] = m[3] * widen + sign * m[axis];
        planes[offset + 1] = m[7] * widen + sign * m[4 + axis];
        planes[offset + 2] = m[15] * widen + sign * m[12 + axis];
      }
    }

    const grid = this.tileGrid;
    const rect = this.projectedTileRect;
    let minDepth = Number.POSITIVE_INFINITY;
    for (let row = tileRange.r0; row <= tileRange.r1; row++) {
      for (let column = tileRange.c0; column <= tileRange.c1; column++) {
        const tileIndex = row * grid.columns + column;
        this.readProjectedTileRect(tileIndex);
        const unitsPerPixel = this.projectRect(rect[0], rect[1], rect[2], rect[3]);
        this.projectedTileUnitsPerPixel[tileIndex] = unitsPerPixel;
        if (unitsPerPixel < 0) continue;
        minDepth = Math.min(minDepth, this.projectedRectDepth);
        // Temporarily keep the depth; weights need the nearest depth first so
        // that close tiles cannot overflow the scale.
        this.projectedTileWeights[tileIndex] = this.projectedRectDepth;
        this.projectedTilePartial[tileIndex] = this.projectedClipCut ? 1 : 0;
        this.projectedTileVisibleFractions[tileIndex] =
          Math.min(1, this.projectedRectArea / Math.max(1e-300, (rect[2] - rect[0]) * (rect[3] - rect[1])));
      }
    }

    // Screen area per drawing area is |det H| / W^3 for the plane homography
    // H, so relative weights need only the depth of each visible part.
    let weightSum = 0;
    for (let row = tileRange.r0; row <= tileRange.r1; row++) {
      for (let column = tileRange.c0; column <= tileRange.c1; column++) {
        const tileIndex = row * grid.columns + column;
        if (this.projectedTileUnitsPerPixel[tileIndex] < 0) continue;
        const depth = this.projectedTileWeights[tileIndex];
        const ratio = minDepth > 0 ? minDepth / depth : (depth > 0 ? 0 : 1);
        const weight = ratio * ratio * ratio;
        this.projectedTileWeights[tileIndex] = weight;
        if (this.levels[0].tileCounts[tileIndex] > 0) weightSum += weight * this.projectedTileVisibleFractions[tileIndex];
      }
    }
    return weightSum;
  }

  /**
   * Tile rectangle widened by a quarter tile, so that its scale bound also
   * covers primitives that cross the tile border. Edge tiles also own the
   * parts of primitives beyond the grid.
   */
  private readProjectedTileRect(tileIndex: number): void {
    const grid = this.tileGrid;
    const column = tileIndex % grid.columns;
    const row = (tileIndex - column) / grid.columns;
    const rect = this.projectedTileRect;
    const marginX = (grid.xEdges[column + 1] - grid.xEdges[column]) * LOD_PROJECTED_TILE_MARGIN;
    const marginY = (grid.yEdges[row + 1] - grid.yEdges[row]) * LOD_PROJECTED_TILE_MARGIN;
    rect[0] = (column === 0 ? Math.min(grid.xEdges[0], this.allLevelBounds.minX) : grid.xEdges[column]) - marginX;
    rect[1] = (row === 0 ? Math.min(grid.yEdges[0], this.allLevelBounds.minY) : grid.yEdges[row]) - marginY;
    rect[2] = (column === grid.columns - 1
      ? Math.max(grid.xEdges[column + 1], this.allLevelBounds.maxX) : grid.xEdges[column + 1]) + marginX;
    rect[3] = (row === grid.rows - 1 ? Math.max(grid.yEdges[row + 1], this.allLevelBounds.maxY) : grid.yEdges[row + 1]) + marginY;
  }

  /**
   * Bound the screen scale of a drawing-plane rectangle's visible part.
   * Returns its finest local units per pixel, or -1 when it is outside the
   * frustum. Also leaves that part's mean clip W and area in
   * projectedRectDepth and projectedRectArea.
   */
  private projectRect(minX: number, minY: number, maxX: number, maxY: number): number {
    const count = this.clipRectToFrustum(minX, minY, maxX, maxY);
    if (count < 3) return -1;
    const m = this.localToClip;
    const clip = this.projectedClip;
    const halfWidth = this.projectedHalfWidth, halfHeight = this.projectedHalfHeight;
    let minW = Number.POSITIVE_INFINITY;
    let maxNorm = 0;
    let depthSum = 0;
    let doubleArea = 0;
    for (let vertex = 0; vertex < count; vertex++) {
      const x = clip[vertex * 2], y = clip[vertex * 2 + 1];
      const clipX = m[0] * x + m[4] * y + m[12];
      const clipY = m[1] * x + m[5] * y + m[13];
      const w = m[3] * x + m[7] * y + m[15];
      // The pixel Jacobian is N / w^2 with N affine in (x, y). The norm of N
      // is convex and 1 / w^2 peaks at the smallest W, so their maxima over
      // the vertices bound the magnification anywhere in the polygon.
      const a = (m[0] * w - clipX * m[3]) * halfWidth;
      const b = (m[4] * w - clipX * m[7]) * halfWidth;
      const c = (m[1] * w - clipY * m[3]) * halfHeight;
      const d = (m[5] * w - clipY * m[7]) * halfHeight;
      const sumSquares = a * a + b * b + c * c + d * d;
      const determinant = a * d - b * c;
      maxNorm = Math.max(maxNorm, Math.sqrt(0.5 * (sumSquares +
        Math.sqrt(Math.max(0, sumSquares * sumSquares - 4 * determinant * determinant)))));
      minW = Math.min(minW, w);
      depthSum += w;
      const next = vertex + 1 < count ? vertex + 1 : 0;
      doubleArea += x * clip[next * 2 + 1] - clip[next * 2] * y;
    }
    this.projectedRectDepth = Math.max(0, depthSum / count);
    this.projectedRectArea = Math.abs(doubleArea) * 0.5;
    // A zero W can only be the eye itself: treat it as unbounded magnification.
    return minW > 0 ? (maxNorm > 0 ? minW * minW / maxNorm : Infinity) : 0;
  }

  /**
   * Whether a level's primitives listed in a tile stay within the overview
   * error budget wherever they are visible. Merged lines can extend far past
   * their tile, into nearer and more magnified parts of a tilted view.
   */
  private tileReachWithinBudget(tileIndex: number, levelIndex: number): boolean {
    const reach = this.getLevelTileReach(levelIndex);
    const offset = tileIndex * 4;
    const minX = reach[offset], minY = reach[offset + 1], maxX = reach[offset + 2], maxY = reach[offset + 3];
    if (!(minX <= maxX && minY <= maxY)) return true;
    // The tile's own scale bound already covers its widened rectangle.
    this.readProjectedTileRect(tileIndex);
    const rect = this.projectedTileRect;
    if (minX >= rect[0] && minY >= rect[1] && maxX <= rect[2] && maxY <= rect[3]) return true;
    const unitsPerPixel = this.projectRect(minX, minY, maxX, maxY);
    return unitsPerPixel < 0 || this.levels[levelIndex].tolerance <= unitsPerPixel * LOD_OVERVIEW_SCREEN_ERROR_BUDGET_PX;
  }

  /** Per tile, the bounds of every primitive the level lists in it. Built on first tilted use. */
  private getLevelTileReach(levelIndex: number): Float32Array {
    let reach = this.levelTileReach[levelIndex];
    if (reach) return reach;
    const level = this.levels[levelIndex];
    const tileCount = this.tileGrid.columns * this.tileGrid.rows;
    reach = new Float32Array(tileCount * 4);
    const records = level.records;
    for (let tileIndex = 0; tileIndex < tileCount; tileIndex++) {
      let minX = Number.POSITIVE_INFINITY, minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY;
      const start = level.tileOffsets[tileIndex], end = start + level.tileCounts[tileIndex];
      for (let entry = start; entry < end; entry++) {
        const segmentIndex = records ? records[level.tileSegmentIds[entry]] : level.tileSegmentIds[entry];
        minX = Math.min(minX, level.segmentMinX[segmentIndex]);
        minY = Math.min(minY, level.segmentMinY[segmentIndex]);
        maxX = Math.max(maxX, level.segmentMaxX[segmentIndex]);
        maxY = Math.max(maxY, level.segmentMaxY[segmentIndex]);
      }
      reach[tileIndex * 4] = minX;
      reach[tileIndex * 4 + 1] = minY;
      reach[tileIndex * 4 + 2] = maxX;
      reach[tileIndex * 4 + 3] = maxY;
    }
    this.levelTileReach[levelIndex] = reach;
    return reach;
  }

  /** Clip a drawing-plane rectangle to the frustum planes. The result starts at projectedClip[0]. */
  private clipRectToFrustum(minX: number, minY: number, maxX: number, maxY: number): number {
    const clip = this.projectedClip;
    const planes = this.projectedPlanes;
    const stride = LOD_PROJECTED_CLIP_MAX_VERTICES * 2;
    clip[0] = minX; clip[1] = minY;
    clip[2] = maxX; clip[3] = minY;
    clip[4] = maxX; clip[5] = maxY;
    clip[6] = minX; clip[7] = maxY;
    let count = 4;
    let source = 0;
    let cut = false;
    for (let plane = 0; plane < planes.length && count > 0; plane += 3) {
      const a = planes[plane], b = planes[plane + 1], c = planes[plane + 2];
      const target = stride - source;
      let outCount = 0;
      let previousX = clip[source + count * 2 - 2];
      let previousY = clip[source + count * 2 - 1];
      let previousDistance = a * previousX + b * previousY + c;
      for (let vertex = 0; vertex < count; vertex++) {
        const x = clip[source + vertex * 2], y = clip[source + vertex * 2 + 1];
        const distance = a * x + b * y + c;
        if ((distance >= 0) !== (previousDistance >= 0) && outCount < LOD_PROJECTED_CLIP_MAX_VERTICES) {
          const t = previousDistance / (previousDistance - distance);
          clip[target + outCount * 2] = previousX + (x - previousX) * t;
          clip[target + outCount * 2 + 1] = previousY + (y - previousY) * t;
          outCount++;
        }
        if (distance < 0) {
          cut = true;
        } else if (outCount < LOD_PROJECTED_CLIP_MAX_VERTICES) {
          clip[target + outCount * 2] = x;
          clip[target + outCount * 2 + 1] = y;
          outCount++;
        }
        previousX = x;
        previousY = y;
        previousDistance = distance;
      }
      count = outCount;
      source = target;
    }
    this.projectedClipCut = cut;
    // Four planes swap the halves an even number of times.
    return count;
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
          overview: level.overview,
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

function strokeLodBuildSteps(scene: VectorScene): Array<{ tolerance: number; overview: boolean }> {
  const overview = scene.segmentCount > VECTOR_STROKE_LOD_TARGET_VISIBLE_SEGMENTS &&
    !sceneRequiresPaintCompositing(scene) && !scene.drawRuns?.some(run => run.blendMode);
  // Preserve a fine, coverage-weighted level before generating lossy overview
  // levels. Small/effect scenes keep the existing conservative hierarchy.
  return [
    ...(overview ? [{ tolerance: VECTOR_STROKE_LOD_TOLERANCES[0], overview: false }] : []),
    ...VECTOR_STROKE_LOD_TOLERANCES.map(tolerance => ({ tolerance, overview }))
  ];
}

/** Standalone scenes of every level; renderers use the shared store instead. */
export function buildVectorStrokeLodScenes(scene: VectorScene): VectorStrokeLodScene[] {
  const hierarchy = runStrokeLodBuild(buildStrokeLodHierarchy(scene));
  return hierarchy.levels.map(level => level.records ? {
    tolerance: level.tolerance,
    overview: level.overview,
    scene: materializeVectorStrokeLodLevel({ ...level, records: level.records, store: hierarchy.store })
  } : { tolerance: 0, scene });
}

/** Progress checkpoint of a Vector LOD build; only yieldable ones may pause it. */
interface StrokeLodBuildStep {
  value: number;
  message: string;
  yieldable: boolean;
}

/** One build implementation serves synchronous and cooperative callers. */
type StrokeLodBuild<T> = Generator<StrokeLodBuildStep, T, void>;

export interface StrokeLodHierarchyLevel {
  tolerance: number;
  overview?: boolean;
  segmentCount: number;
  records?: Uint32Array;
  sceneBounds: Bounds;
  maxHalfWidth: number;
}

interface StrokeLodHierarchy {
  store: VectorStrokeLodRecordStore;
  levels: StrokeLodHierarchyLevel[];
}

interface StrokeLodStorageBounds {
  minX: Float32Array;
  minY: Float32Array;
  maxX: Float32Array;
  maxY: Float32Array;
}

export interface StrokeLodTileBuckets {
  tileOffsets: Uint32Array;
  tileCounts: Uint32Array;
  tileSegmentIds: Uint32Array;
}

function runStrokeLodBuild<T>(build: StrokeLodBuild<T>): T {
  for (;;) {
    const step = build.next();
    if (step.done) return step.value;
  }
}

async function runStrokeLodBuildAsync<T>(build: StrokeLodBuild<T>, scheduler: VectorStrokeLodYieldScheduler): Promise<T> {
  try {
    for (;;) {
      const step = build.next();
      if (step.done) return step.value;
      if (step.value.yieldable) await scheduler.maybeYield(false, step.value.value, step.value.message);
      else scheduler.report(step.value.value, step.value.message);
    }
  } finally {
    // A cancelled build runs its cleanup; returning from a finished one does nothing.
    build.return(undefined as never);
  }
}

/**
 * Simplify every tolerance into one record store. Level order, record order,
 * geometry bits, paint origins and the level acceptance rule are those of a
 * standalone per-level build; only unchanged canonical strokes are shared.
 */
function* buildStrokeLodHierarchy(scene: VectorScene): StrokeLodBuild<StrokeLodHierarchy> {
  const baseCount = Math.max(0, scene.segmentCount | 0);
  const sink = new StrokeLodRecordSink(scene);
  const levels: StrokeLodHierarchyLevel[] = [
    { tolerance: 0, segmentCount: baseCount, sceneBounds: scene.bounds, maxHalfWidth: scene.maxHalfWidth }
  ];
  let previousCount = baseCount;
  const steps = strokeLodBuildSteps(scene);
  const toleranceCount = steps.length;

  try {
    for (let i = 0; i < toleranceCount; i += 1) {
      const { tolerance, overview } = steps[i];
      const startValue = 0.06 + i / toleranceCount * 0.62;
      const endValue = 0.06 + (i + 1) / toleranceCount * 0.62;
      yield { value: startValue, message: `Simplifying Vector LOD ${i + 1}/${toleranceCount}`, yieldable: false };
      const simplified = yield* simplifyStrokeLevel(scene, tolerance, overview, sink, startValue, endValue);
      const keep = simplified !== null && simplified.segmentCount > 0 &&
        simplified.segmentCount < previousCount * MIN_LEVEL_REDUCTION_RATIO;
      const records = sink.endLevel(keep);
      if (!simplified || !records) continue;
      levels.push({
        tolerance,
        overview,
        segmentCount: simplified.segmentCount,
        records,
        sceneBounds: simplified.bounds,
        maxHalfWidth: simplified.maxHalfWidth
      });
      previousCount = simplified.segmentCount;
    }
  } finally {
    // Only simplification reads paint groups; a later build recomputes them.
    releaseStrokePaintGroups(scene);
  }

  return { store: { canonical: scene, literals: sink.finish() }, levels };
}

/** Build the hierarchy with shared culling bounds and per-level tile buckets. */
function* buildStoredStrokeLodLevels(scene: VectorScene, tileGrid: RuntimeTileGrid): StrokeLodBuild<RuntimeVectorStrokeLodLevel[]> {
  const hierarchy = yield* buildStrokeLodHierarchy(scene);
  const bounds = yield* buildStrokeLodStorageBounds(hierarchy.store, 0.68, 0.72);
  const levels: RuntimeVectorStrokeLodLevel[] = [];
  const levelCount = Math.max(1, hierarchy.levels.length);
  for (let i = 0; i < hierarchy.levels.length; i += 1) {
    const level = hierarchy.levels[i];
    const startValue = 0.72 + i / levelCount * 0.26;
    const endValue = 0.72 + (i + 1) / levelCount * 0.26;
    yield { value: startValue, message: `Building Vector LOD buckets ${i + 1}/${hierarchy.levels.length}`, yieldable: false };
    const buckets = yield* buildStrokeLodTileBuckets(level.records, level.segmentCount, bounds, tileGrid, startValue, endValue);
    levels.push(new StoredVectorStrokeLodLevel(hierarchy.store, level, buckets, bounds));
  }
  return levels;
}

/** A level whose records address its hierarchy's shared store and culling bounds. */
class StoredVectorStrokeLodLevel implements RuntimeVectorStrokeLodLevel {
  overview?: boolean;
  tolerance: number;
  segmentCount: number;
  records?: Uint32Array;
  store: VectorStrokeLodRecordStore;
  sceneBounds: Bounds;
  maxHalfWidth: number;
  tileOffsets: Uint32Array;
  tileCounts: Uint32Array;
  tileSegmentIds: Uint32Array;
  segmentMarks: Uint8Array;
  segmentMinX: Float32Array;
  segmentMinY: Float32Array;
  segmentMaxX: Float32Array;
  segmentMaxY: Float32Array;
  visibleSegmentIds: Uint32Array;
  visibleSegmentCount = 0;
  markToken = 1;

  constructor(store: VectorStrokeLodRecordStore, level: StrokeLodHierarchyLevel, buckets: StrokeLodTileBuckets,
    bounds: StrokeLodStorageBounds) {
    this.overview = level.overview;
    this.tolerance = level.tolerance;
    this.segmentCount = level.segmentCount;
    this.records = level.records;
    this.store = store;
    this.sceneBounds = level.sceneBounds;
    this.maxHalfWidth = level.maxHalfWidth;
    this.tileOffsets = buckets.tileOffsets;
    this.tileCounts = buckets.tileCounts;
    this.tileSegmentIds = buckets.tileSegmentIds;
    this.segmentMarks = new Uint8Array(level.segmentCount);
    this.segmentMinX = bounds.minX;
    this.segmentMinY = bounds.minY;
    this.segmentMaxX = bounds.maxX;
    this.segmentMaxY = bounds.maxY;
    this.visibleSegmentIds = new Uint32Array(Math.max(1, Math.min(4096, level.segmentCount)));
  }

  get scene(): VectorScene {
    return vectorStrokeLodLevelScene(this);
  }
}

/** Culling bounds of every stored record; levels share them through their records. */
function* buildStrokeLodStorageBounds(
  store: VectorStrokeLodRecordStore,
  startValue: number,
  endValue: number
): StrokeLodBuild<StrokeLodStorageBounds> {
  const canonicalCount = Math.max(0, store.canonical.segmentCount | 0);
  const count = canonicalCount + Math.max(0, store.literals.segmentCount | 0);
  const minX = new Float32Array(count);
  const minY = new Float32Array(count);
  const maxX = new Float32Array(count);
  const maxY = new Float32Array(count);
  const ink = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  for (let id = 0; id < count; id += 1) {
    if (id < canonicalCount) strokeInkBounds(store.canonical, id, ink);
    else strokeInkBounds(store.literals, id - canonicalCount, ink);
    const margin = 0.35;
    minX[id] = ink.minX - margin;
    minY[id] = ink.minY - margin;
    maxX[id] = ink.maxX + margin;
    maxY[id] = ink.maxY + margin;

    if ((id & 8191) === 0) {
      yield {
        value: startValue + (endValue - startValue) * (id / Math.max(1, count)),
        message: "Preparing Vector LOD bounds",
        yieldable: true
      };
    }
  }

  return { minX, minY, maxX, maxY };
}

function* buildStrokeLodTileBuckets(
  records: Uint32Array | undefined,
  segmentCount: number,
  bounds: StrokeLodStorageBounds,
  grid: RuntimeTileGrid,
  startValue: number,
  endValue: number,
  maxReferences = Infinity
): StrokeLodBuild<StrokeLodTileBuckets> {
  let referenceCount = 0;
  const tileCount = grid.columns * grid.rows;
  const tileCounts = new Uint32Array(tileCount);
  const range: RuntimeTileRange = { c0: 0, c1: 0, r0: 0, r1: 0 };

  for (let i = 0; i < segmentCount; i += 1) {
    const id = records ? records[i] : i;
    if (writeTileRangeForBounds(bounds.minX[id], bounds.minY[id], bounds.maxX[id], bounds.maxY[id], grid, range)) {
      referenceCount += (range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1);
      if (referenceCount > maxReferences) throw new Error("Vector LOD tile index resource limit exceeded");
      for (let row = range.r0; row <= range.r1; row += 1) {
        let tileIndex = row * grid.columns + range.c0;
        for (let column = range.c0; column <= range.c1; column += 1) {
          tileCounts[tileIndex] += 1;
          tileIndex += 1;
        }
      }
    }
    if ((i & 4095) === 0) {
      const value = startValue + (endValue - startValue) * 0.5 * i / Math.max(1, segmentCount);
      yield { value, message: "Counting Vector LOD tiles", yieldable: true };
    }
  }

  const tileOffsets = new Uint32Array(tileCount + 1);
  for (let i = 0; i < tileCount; i += 1) {
    tileOffsets[i + 1] = tileOffsets[i] + tileCounts[i];
  }

  const tileSegmentIds = new Uint32Array(tileOffsets[tileCount]);
  const cursors = tileOffsets.slice(0, tileCount);
  for (let i = 0; i < segmentCount; i += 1) {
    const id = records ? records[i] : i;
    if (writeTileRangeForBounds(bounds.minX[id], bounds.minY[id], bounds.maxX[id], bounds.maxY[id], grid, range)) {
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
      yield { value, message: "Assigning Vector LOD tiles", yieldable: true };
    }
  }

  return { tileOffsets, tileCounts, tileSegmentIds };
}

export async function prebuildVectorStrokeLodRuntime(
  scene: VectorScene,
  mode: VectorLodMode,
  rendererType: "webgl" | "webgpu",
  options: VectorStrokeLodAsyncBuildOptions = {}
): Promise<VectorStrokeLodRuntime | null> {
  return prepareVectorStrokeLodRuntime(scene, mode, rendererType, options, true);
}

/** Exclusive preparation for a delayed renderer constructor. @internal */
export interface VectorStrokeLodRuntimeReservation {
  take(scene: VectorScene): VectorStrokeLodRuntime;
  release(): void;
}

/** Keeps an in-flight viewer's runtime outside the bounded idle cache. @internal */
export async function reserveVectorStrokeLodRuntime(
  scene: VectorScene,
  mode: VectorLodMode,
  rendererType: "webgl" | "webgpu",
  options: VectorStrokeLodAsyncBuildOptions = {}
): Promise<VectorStrokeLodRuntimeReservation | null> {
  let runtime = await prepareVectorStrokeLodRuntime(scene, mode, rendererType, options, false);
  if (!runtime) return null;
  return {
    take(ownerScene) {
      if (ownerScene !== scene) throw new Error("Vector LOD reservation belongs to a different scene.");
      if (!runtime) throw new Error("Vector LOD reservation has already been consumed or released.");
      const owned = runtime;
      runtime = null;
      return owned;
    },
    release() {
      if (!runtime) return;
      const idle = runtime;
      runtime = null;
      storePrebuiltVectorStrokeLodRuntime(scene, idle);
    }
  };
}

async function prepareVectorStrokeLodRuntime(
  scene: VectorScene,
  mode: VectorLodMode,
  rendererType: "webgl" | "webgpu",
  options: VectorStrokeLodAsyncBuildOptions,
  cacheResult: boolean
): Promise<VectorStrokeLodRuntime | null> {
  if (!shouldUseVectorStrokeLod(mode, rendererType, scene.segmentCount)) {
    return null;
  }

  const scheduler = new VectorStrokeLodYieldScheduler(options);
  const startedAt = nowMs();
  scheduler.report(0, "Preparing Vector LOD");
  const cached = takePrebuiltVectorStrokeLodRuntime(scene);
  if (cached) {
    // Reserve it across the yield: concurrent preparation must not borrow the
    // same mutable selection state. Cancellation/progress errors leave this
    // completed hierarchy reusable instead of discarding expensive geometry.
    let completed = false;
    try {
      await scheduler.maybeYield(true, 0.99, "Reusing Vector LOD");
      scheduler.report(1, "Vector LOD ready");
      completed = true;
      return cached;
    } finally {
      if (cacheResult || !completed) storePrebuiltVectorStrokeLodRuntimeInternal(scene, cached);
    }
  }
  if (storedBuilds.has(scene)) {
    const runtime = new VectorStrokeLodRuntime(scene);
    if (cacheResult) storePrebuiltVectorStrokeLodRuntimeInternal(scene, runtime);
    scheduler.report(1, "Stored Vector LOD ready");
    return runtime;
  }
  const tileGrid = createRuntimeTileGrid(scene.bounds, Math.max(0, scene.segmentCount | 0), scene);
  await scheduler.maybeYield(true, 0.04, "Partitioning stroke density");

  const levels = await runStrokeLodBuildAsync(buildStoredStrokeLodLevels(scene, tileGrid), scheduler);

  scheduler.report(0.99, "Finalizing Vector LOD");
  await scheduler.maybeYield(true, 0.99, "Finalizing Vector LOD");
  const runtime = new VectorStrokeLodRuntime(scene, {
    tileGrid,
    levels,
    elapsedMs: nowMs() - startedAt
  });
  if (cacheResult) storePrebuiltVectorStrokeLodRuntimeInternal(scene, runtime);
  try {
    scheduler.report(1, "Vector LOD ready");
  } catch (error) {
    if (!cacheResult) storePrebuiltVectorStrokeLodRuntimeInternal(scene, runtime);
    throw error;
  }
  return runtime;
}

export function takePrebuiltVectorStrokeLodRuntime(scene: VectorScene): VectorStrokeLodRuntime | null {
  const runtime = prebuiltRuntimeByScene.get(scene) ?? null;
  prebuiltRuntimeByScene.delete(scene);
  return runtime;
}

export function storePrebuiltVectorStrokeLodRuntime(scene: VectorScene, runtime: VectorStrokeLodRuntime): void {
  runtime.setForceExact(false);
  runtime.resetVisible();
  storePrebuiltVectorStrokeLodRuntimeInternal(scene, runtime);
}

function storePrebuiltVectorStrokeLodRuntimeInternal(scene: VectorScene, runtime: VectorStrokeLodRuntime): void {
  prebuiltRuntimeByScene.set(scene, runtime);
}

interface SimplifiedStrokeLevel {
  segmentCount: number;
  bounds: Bounds;
  maxHalfWidth: number;
}

/**
 * Simplify one tolerance into the sink's current level. The caller decides
 * whether that level is retained.
 */
function* simplifyStrokeLevel(
  scene: VectorScene,
  tolerance: number,
  overview: boolean,
  sink: StrokeLodRecordSink,
  startValue: number,
  endValue: number
): StrokeLodBuild<SimplifiedStrokeLevel | null> {
  sink.beginLevel();
  const segmentCount = Math.max(0, scene.segmentCount | 0);
  if (segmentCount <= 0 || tolerance <= 0) {
    return null;
  }

  const name = formatToleranceName(tolerance);
  const simplifying = `Simplifying ${name}`, aggregating = `Aggregating ${name}`, merging = `Merging ${name}`;
  const progress = (fraction: number, message: string): StrokeLodBuildStep =>
    ({ value: startValue + (endValue - startValue) * fraction, message, yieldable: true });
  const grid = createTileGrid(scene.bounds, tolerance);
  const groups = new CompactStrokeIntervalGroups(tolerance, overview, index => readStrokePrimitive(scene, index));
  const densityGroups = !overview && !sceneRequiresPaintCompositing(scene) && !scene.drawRuns?.some(run => run.blendMode)
    ? new DenseStrokeGroups() : null;
  const outBounds = createEmptyBounds();
  let maxHalfWidth = 0;
  let densityR = NaN, densityG = NaN, densityB = NaN;
  const streamPaintGroups = canStreamStrokePaintGroups(scene);
  let previousPaintGroup: number | undefined;
  // The original density admission limit spans the whole ordered scene. A
  // completed paint can release its groups without admitting extra groups.
  let completedDensityGroupCount = 0;

  for (let index = 0; index < segmentCount; index += 1) {
    if ((index & 4095) === 0) {
      yield progress(0.72 * (index / Math.max(1, segmentCount)), simplifying);
    }
    const primitive = readStrokePrimitive(scene, index);
    if (!primitive || primitive.alpha <= 0.001) {
      continue;
    }
    // Paint groups occupy consecutive source ranges and never merge with
    // each other. Release each completed group instead of retaining the entire
    // document's maps. Legacy scenes still flush only at color barriers.
    const paintGroupChanged = streamPaintGroups && primitive.paintGroup !== previousPaintGroup;
    if (paintGroupChanged || ((densityGroups || overview) && !scene.drawRuns &&
        (primitive.colorR !== densityR || primitive.colorG !== densityG || primitive.colorB !== densityB))) {
      let completedGroups = 0;
      for (const group of densityGroups?.values() ?? []) {
        emitDenseStrokeGroup(scene, group, sink, outBounds, tolerance * LOD_DENSITY_CELL_FACTOR);
        if ((++completedGroups & 1023) === 0) {
          yield progress(0.72 * index / Math.max(1, segmentCount), aggregating);
        }
      }
      if (overview || paintGroupChanged) {
        for (const group of groups.values()) {
          emitMergedIntervals(group, sink, outBounds, tolerance);
          if ((++completedGroups & 1023) === 0) {
            yield progress(0.72 * index / Math.max(1, segmentCount), merging);
          }
        }
        groups.clear();
      }
      if (paintGroupChanged) completedDensityGroupCount += densityGroups?.size ?? 0;
      densityGroups?.clear();
      previousPaintGroup = primitive.paintGroup;
      densityR = primitive.colorR;
      densityG = primitive.colorG;
      densityB = primitive.colorB;
    }
    if (overview && shouldDropOverviewPrimitive(primitive, tolerance)) continue;
    if (densityGroups && collectDenseStroke(densityGroups, primitive, index, tolerance, completedDensityGroupCount)) {
      maxHalfWidth = Math.max(maxHalfWidth, primitive.halfWidth);
      continue;
    }
    if (primitive.primitiveType >= STROKE_PRIMITIVE_QUADRATIC - 0.5 ||
        (!overview && shouldPreservePrimitiveAtTolerance(primitive, tolerance))) {
      emitPrimitive(sink, outBounds, primitive, index);
      maxHalfWidth = Math.max(maxHalfWidth, primitive.halfWidth);
      continue;
    }

    const dx = primitive.x1 - primitive.x0;
    const dy = primitive.y1 - primitive.y0;
    if (dx === 0 && dy === 0) {
      if ((primitive.flags & STROKE_STYLE_FLAG_ROUND_CAP) !== 0) {
        emitPrimitive(sink, outBounds, primitive, index);
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
    groups.add(primitive, index, tileIndex);
    maxHalfWidth = Math.max(maxHalfWidth, primitive.halfWidth);
  }

  let densityGroupIndex = 0;
  for (const group of densityGroups?.values() ?? []) {
    emitDenseStrokeGroup(scene, group, sink, outBounds, tolerance * LOD_DENSITY_CELL_FACTOR);
    if ((++densityGroupIndex & 1023) === 0) {
      yield progress(0.72, aggregating);
    }
  }

  let groupIndex = 0;
  const groupCount = Math.max(1, groups.size);
  for (const group of groups.values()) {
    emitMergedIntervals(group, sink, outBounds, tolerance);
    groupIndex += 1;
    if ((groupIndex & 1023) === 0) {
      yield progress(0.72 + 0.28 * groupIndex / groupCount, merging);
    }
  }

  groups.clear();
  densityGroups?.clear();
  const count = sink.levelRecordCount;
  if (count === 0) {
    return null;
  }

  return {
    segmentCount: count,
    bounds: normalizeOutputBounds(outBounds, scene.bounds),
    maxHalfWidth
  };
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
  const ink = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let sampleCount = 0;

  for (let i = 0; i < segmentCount; i += 1) {
    strokeInkBounds(scene, i, ink);
    const a = axis === "x" ? ink.minX : ink.minY;
    const b = axis === "x" ? ink.maxX : ink.maxY;
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
    visibleSegmentIds: new Uint32Array(Math.max(1, Math.min(4096, segmentCount))),
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

function appendTileSegments(
  level: RuntimeStrokeTileBuckets & { records?: Uint32Array },
  tileIndex: number,
  viewBounds: CullingBounds,
  cullingPlanes: Float64Array | null = null,
  maxAddedSegments = Infinity
): void {
  const start = level.tileOffsets[tileIndex];
  const end = start + level.tileCounts[tileIndex];
  const records = level.records;
  let outCount = level.visibleSegmentCount;
  const outLimit = outCount + maxAddedSegments;
  for (let i = start; i < end && outCount < outLimit; i += 1) {
    const segmentIndex = level.tileSegmentIds[i];
    if (level.segmentMarks[segmentIndex] === level.markToken) {
      continue;
    }
    const boundsIndex = records ? records[segmentIndex] : segmentIndex;
    const minX = level.segmentMinX[boundsIndex];
    const minY = level.segmentMinY[boundsIndex];
    const maxX = level.segmentMaxX[boundsIndex];
    const maxY = level.segmentMaxY[boundsIndex];
    if (maxX < viewBounds.minX || minX > viewBounds.maxX || maxY < viewBounds.minY || minY > viewBounds.maxY) {
      continue;
    }
    if (cullingPlanes && !boundsIntersectPlanes(cullingPlanes, minX, minY, maxX, maxY)) {
      continue;
    }
    level.segmentMarks[segmentIndex] = level.markToken;
    if (outCount === level.visibleSegmentIds.length) {
      const next = new Uint32Array(Math.min(level.segmentMarks.length, Math.max(1, outCount * 2)));
      next.set(level.visibleSegmentIds);
      level.visibleSegmentIds = next;
    }
    level.visibleSegmentIds[outCount] = segmentIndex;
    outCount += 1;
  }
  level.visibleSegmentCount = outCount;
}

/** False when the rectangle lies entirely outside one of the drawing-plane half-planes. */
function boundsIntersectPlanes(planes: Float64Array, minX: number, minY: number, maxX: number, maxY: number): boolean {
  for (let plane = 0; plane < planes.length; plane += 3) {
    const a = planes[plane], b = planes[plane + 1];
    if (a * (a >= 0 ? maxX : minX) + b * (b >= 0 ? maxY : minY) + planes[plane + 2] < 0) return false;
  }
  return true;
}

/** primitiveBounds stores a clip window for clipped strokes, not their ink extent. */
function strokeInkBounds(scene: VectorScene, index: number, out: Bounds): void {
  const offset = index * 4;
  const width = Math.max(0, scene.styles[offset] ?? 0);
  const flags = Math.floor(scene.primitiveMeta[offset + 3] / STROKE_STYLE_FLAG_OFFSET + 1e-6);
  if ((flags & STROKE_STYLE_FLAG_CLIPPED) === 0) {
    out.minX = scene.primitiveBounds[offset] - width;
    out.minY = scene.primitiveBounds[offset + 1] - width;
    out.maxX = scene.primitiveBounds[offset + 2] + width;
    out.maxY = scene.primitiveBounds[offset + 3] + width;
    return;
  }
  // The control hull conservatively encloses quadratic curves too. Preserve
  // the original clip metadata for rendering; tighten only the runtime index.
  out.minX = Math.max(scene.primitiveBounds[offset],
    Math.min(scene.endpoints[offset], scene.endpoints[offset + 2], scene.primitiveMeta[offset]) - width);
  out.minY = Math.max(scene.primitiveBounds[offset + 1],
    Math.min(scene.endpoints[offset + 1], scene.endpoints[offset + 3], scene.primitiveMeta[offset + 1]) - width);
  out.maxX = Math.min(scene.primitiveBounds[offset + 2],
    Math.max(scene.endpoints[offset], scene.endpoints[offset + 2], scene.primitiveMeta[offset]) + width);
  out.maxY = Math.min(scene.primitiveBounds[offset + 3],
    Math.max(scene.endpoints[offset + 1], scene.endpoints[offset + 3], scene.primitiveMeta[offset + 1]) + width);
  if (out.minX > out.maxX || out.minY > out.maxY) {
    out.minX = out.minY = Infinity;
    out.maxX = out.maxY = -Infinity;
  }
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
  const ink = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  for (let i = 0; i < segmentCount; i += 1) {
    strokeInkBounds(scene, i, ink);
    const margin = 0.35;
    minX[i] = ink.minX - margin;
    minY[i] = ink.minY - margin;
    maxX[i] = ink.maxX + margin;
    maxY[i] = ink.maxY + margin;
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
  const range = { c0: 0, c1: 0, r0: 0, r1: 0 };
  return writeTileRangeForBounds(minX, minY, maxX, maxY, grid, range) ? range : null;
}

/** tileRangeForBounds without allocating; false when the bounds miss the grid. */
function writeTileRangeForBounds(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  grid: RuntimeTileGrid,
  range: RuntimeTileRange
): boolean {
  if (maxX < grid.minX || minX > grid.maxX || maxY < grid.minY || minY > grid.maxY) {
    return false;
  }
  range.c0 = edgeLowerBound(grid.xEdges, minX);
  range.c1 = edgeUpperBound(grid.xEdges, maxX);
  range.r0 = edgeLowerBound(grid.yEdges, minY);
  range.r1 = edgeUpperBound(grid.yEdges, maxY);
  return true;
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

function tileLevelTargetScore(tileSegments: number, targetSegmentsPerTile: number): number {
  const delta = tileSegments - targetSegmentsPerTile;
  return delta >= 0 ? delta : -delta * LOD_TILE_UNDERSHOOT_SCORE_WEIGHT;
}

/** Partial/custom draw-run tables may reuse a group after another group. */
function canStreamStrokePaintGroups(scene: VectorScene): boolean {
  const groups = strokePaintGroups(scene);
  if (!groups) return false;
  for (let index = 1; index < groups.length; index++) {
    if (groups[index] < groups[index - 1]) return false;
  }
  return true;
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
    paintOrder: strokePaintOrigin(scene, index),
    paintGroup: strokePaintGroups(scene)?.[index],
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

/**
 * Aggregate only dense, subpixel neighborhoods of the same opaque mark. The
 * original pen width and mean endpoints survive; negative line type is a
 * runtime-only source-over multiplicity, decoded by the shared stroke shader.
 * This preserves repeated-dot coverage without inflating the vector radius.
 */
function collectDenseStroke(
  groups: DenseStrokeGroups, primitive: StrokePrimitive, index: number, tolerance: number, completedGroupCount = 0
): boolean {
  const dot = primitive.x0 === primitive.x1 && primitive.y0 === primitive.y1;
  if (primitive.primitiveType !== STROKE_PRIMITIVE_LINE || primitive.alpha !== 1 ||
      !(primitive.halfWidth > 0) || (primitive.flags & STROKE_STYLE_FLAG_HAIRLINE) !== 0 ||
      (dot && (primitive.flags & STROKE_STYLE_FLAG_ROUND_CAP) === 0)) return false;
  const cell = tolerance * LOD_DENSITY_CELL_FACTOR;
  const cellX = Math.floor(primitive.x0 / cell), cellY = Math.floor(primitive.y0 / cell);
  if (Math.floor(primitive.x1 / cell) !== cellX || Math.floor(primitive.y1 / cell) !== cellY) return false;
  const reversed = primitive.x1 < primitive.x0 ||
    (primitive.x1 === primitive.x0 && primitive.y1 < primitive.y0);
  const direction = dot ? 0 : Math.round(Math.atan2(
    reversed ? primitive.y0 - primitive.y1 : primitive.y1 - primitive.y0,
    Math.abs(primitive.x1 - primitive.x0)) / ANGLE_STEP);
  const clip = primitive.visibleBounds;
  // Paint groups are unsigned, so -1 stands for the absent group's empty field.
  const key = groups.key;
  key[0] = primitive.paintGroup ?? -1;
  key[1] = cellX;
  key[2] = cellY;
  key[3] = dot ? 1 : 0;
  key[4] = direction;
  key[5] = primitive.flags;
  key[6] = primitive.halfWidth;
  key[7] = primitive.colorR;
  key[8] = primitive.colorG;
  key[9] = primitive.colorB;
  key[10] = clip ? 1 : 0;
  key[11] = clip ? clip.minX : 0;
  key[12] = clip ? clip.minY : 0;
  key[13] = clip ? clip.maxX : 0;
  key[14] = clip ? clip.maxY : 0;
  let group = groups.find();
  if (!group) {
    // Resource bounds reduce optimization only: unmatched marks still emit
    // their complete source geometry through the normal preservation path.
    if (completedGroupCount + groups.size >= LOD_DENSITY_MAX_GROUPS) return false;
    group = createDenseStrokeGroup();
    groups.add(group);
  }
  appendDenseStroke(group, primitive, index);
  return true;
}

function createDenseStrokeGroup(): DenseStrokeGroup {
  return { members: [], count: 0, coincident: true, x0: 0, y0: 0, x1: 0, y1: 0 };
}

function appendDenseStroke(group: DenseStrokeGroup, primitive: StrokePrimitive, index: number): void {
  let x0 = primitive.x0, y0 = primitive.y0, x1 = primitive.x1, y1 = primitive.y1;
  // Reversing a centerline leaves its coverage unchanged. Normalize it before
  // averaging so reversed source paths do not collapse to dots.
  if (x1 < x0 || (x1 === x0 && y1 < y0)) {
    [x0, x1] = [x1, x0];
    [y0, y1] = [y1, y0];
  }
  if (group.count > 0 && (x0 !== group.x0 / group.count || y0 !== group.y0 / group.count ||
      x1 !== group.x1 / group.count || y1 !== group.y1 / group.count)) group.coincident = false;
  group.members.push(index);
  group.count++;
  group.x0 += x0;
  group.y0 += y0;
  group.x1 += x1;
  group.y1 += y1;
}

function emitDenseStrokeGroup(
  scene: VectorScene, group: DenseStrokeGroup, sink: StrokeLodRecordSink, bounds: Bounds, cell: number, depth = 0
): void {
  if (group.coincident ? group.count < 2 : group.count < LOD_DENSITY_MIN_MEMBERS || depth >= 8) {
    for (const index of group.members) {
      emitPrimitive(sink, bounds, readStrokePrimitive(scene, index)!, index);
    }
    return;
  }
  if (!group.coincident && group.count > LOD_DENSITY_MIN_MEMBERS) {
    // Chunking a crowded cell into repeated average representatives compounds
    // the same spatial error. Subdivide instead, retaining its distribution.
    const children = new Map<string, DenseStrokeGroup>();
    const childCell = cell * 0.5;
    for (const index of group.members) {
      const primitive = readStrokePrimitive(scene, index)!;
      const x = Math.floor(primitive.x0 / childCell), y = Math.floor(primitive.y0 / childCell);
      if (Math.floor(primitive.x1 / childCell) !== x || Math.floor(primitive.y1 / childCell) !== y) {
        emitPrimitive(sink, bounds, primitive, index);
        continue;
      }
      const key = `${x},${y}`;
      let child = children.get(key);
      if (!child) children.set(key, child = createDenseStrokeGroup());
      appendDenseStroke(child, primitive, index);
    }
    for (const child of children.values()) {
      emitDenseStrokeGroup(scene, child, sink, bounds, childCell, depth + 1);
    }
    return;
  }
  const primitive = readStrokePrimitive(scene, group.members[0])!;
  primitive.x0 = group.x0 / group.count;
  primitive.y0 = group.y0 / group.count;
  primitive.x1 = primitive.cx = group.x1 / group.count;
  primitive.y1 = primitive.cy = group.y1 / group.count;
  const source = readStrokePrimitive(scene, group.members[0])!;
  if ((source.x0 !== source.x1 || source.y0 !== source.y1) &&
      Math.fround(primitive.x0) === Math.fround(primitive.x1) &&
      Math.fround(primitive.y0) === Math.fround(primitive.y1)) {
    for (const index of group.members) {
      emitPrimitive(sink, bounds, readStrokePrimitive(scene, index)!, index);
    }
    return;
  }
  // Keep multiplicity exactly representable in Float32 metadata. Co-located
  // representatives compose to the same total source-over coverage.
  for (let remaining = group.count; remaining > 0;) {
    const count = Math.min(remaining, LOD_DENSITY_MAX_MULTIPLICITY);
    primitive.primitiveType = 1 - count;
    emitPrimitive(sink, bounds, primitive, -1);
    remaining -= count;
  }
}

function shouldDropOverviewPrimitive(primitive: StrokePrimitive, tolerance: number): boolean {
  // Fragment clip rectangles do not measure the mark itself. Include pen width
  // and curve controls so wide dots and curved features do not vanish as if
  // they were tiny centerlines. The canonical scene is never modified.
  const quadratic = primitive.primitiveType >= STROKE_PRIMITIVE_QUADRATIC - 0.5;
  const cx = quadratic ? primitive.cx : primitive.x1;
  const cy = quadratic ? primitive.cy : primitive.y1;
  const span = Math.max(
    Math.max(primitive.x0, cx, primitive.x1) - Math.min(primitive.x0, cx, primitive.x1),
    Math.max(primitive.y0, cy, primitive.y1) - Math.min(primitive.y0, cy, primitive.y1)
  ) + primitive.halfWidth * 2;
  return span <= tolerance * LOD_PRESERVE_LOCAL_SIZE_FACTOR;
}

function shouldPreservePrimitiveAtTolerance(
  primitive: StrokePrimitive,
  tolerance: number
): boolean {
  // Use centerline geometry rather than clip bounds: a tiny mark can carry a
  // page-sized fragment clip, and its pen width does not make it mergeable.
  const span = Math.max(
    Math.max(primitive.x0, primitive.cx, primitive.x1) - Math.min(primitive.x0, primitive.cx, primitive.x1),
    Math.max(primitive.y0, primitive.cy, primitive.y1) - Math.min(primitive.y0, primitive.cy, primitive.y1)
  );
  return span <= tolerance * LOD_PRESERVE_LOCAL_SIZE_FACTOR &&
    (span > 0 || (primitive.flags & STROKE_STYLE_FLAG_ROUND_CAP) !== 0);
}

function emitMergedIntervals(
  group: IntervalGroup,
  sink: StrokeLodRecordSink,
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

  // Sort pair indices instead of allocating an object for every source line.
  const intervals = group.intervals;
  const order = new Uint32Array(pairCount);
  for (let i = 0; i < pairCount; i += 1) order[i] = i * 2;
  order.sort((a, b) => intervals[a] - intervals[b] || intervals[a + 1] - intervals[b + 1]);

  const mergeGap = tolerance * LOD_MERGE_GAP_FACTOR;
  let currentStart = intervals[order[0]];
  let currentEnd = intervals[order[0] + 1];
  for (let i = 1; i < order.length; i += 1) {
    const start = intervals[order[i]], end = intervals[order[i] + 1];
    if (start <= currentEnd + mergeGap) {
      currentEnd = Math.max(currentEnd, end);
      continue;
    }
    emitInterval(group, sink, bounds, currentStart, currentEnd);
    currentStart = start;
    currentEnd = end;
  }
  emitInterval(group, sink, bounds, currentStart, currentEnd);
}

function emitInterval(
  group: IntervalGroup,
  sink: StrokeLodRecordSink,
  bounds: Bounds,
  start: number,
  end: number
): void {
  if (end <= start) {
    return;
  }
  const hasClip =
    (group.flags & STROKE_STYLE_FLAG_CLIPPED) !== 0 &&
    group.clipMinX <= group.clipMaxX &&
    group.clipMinY <= group.clipMaxY;
  emitPrimitive(sink, bounds, {
    paintOrder: group.paintOrder,
    paintGroup: group.paintGroup,
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
  }, -1);
}

/** `sourceIndex` is the canonical stroke of an unmodified primitive, otherwise -1. */
function emitPrimitive(
  sink: StrokeLodRecordSink,
  bounds: Bounds,
  primitive: StrokePrimitive,
  sourceIndex: number
): void {
  // Clipped primitives store their clip rect so the stroke shaders keep
  // discarding fragments outside it; everything else stores geometric bounds.
  const clip = primitive.visibleBounds;
  const minX = clip ? clip.minX : Math.min(primitive.x0, primitive.cx, primitive.x1);
  const minY = clip ? clip.minY : Math.min(primitive.y0, primitive.cy, primitive.y1);
  const maxX = clip ? clip.maxX : Math.max(primitive.x0, primitive.cx, primitive.x1);
  const maxY = clip ? clip.maxY : Math.max(primitive.y0, primitive.cy, primitive.y1);
  sink.push(primitive, minX, minY, maxX, maxY, sourceIndex);
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

/** Reusable geometry and spatial index; selection scratch is deliberately excluded. @internal */
export interface StoredVectorStrokeLod {
  /** Persisted coordinate grid for optional compact geometry; canonical strokes are untouched. */
  positionQuantum?: number;
  /** v3 per-record grids, bounded by the finest referencing level. */
  positionQuanta?: Float32Array;
  tileGrid: RuntimeTileGrid;
  literals: Pick<VectorScene, "segmentCount" | "endpoints" | "primitiveMeta" | "primitiveBounds" | "styles">;
  origins?: Uint32Array;
  levels: (StrokeLodHierarchyLevel & StrokeLodTileBuckets)[];
}

const storedBuilds = new WeakMap<VectorScene, StoredVectorStrokeLod>();
// Export may inspect an active hierarchy without borrowing its mutable runtime
// or keeping a disposed renderer alive.
const latestRuntimeByScene = new WeakMap<VectorScene, WeakRef<VectorStrokeLodRuntime>>();

export function getStoredVectorStrokeLod(scene: VectorScene): StoredVectorStrokeLod | null {
  const persisted = storedBuilds.get(scene);
  if (persisted) return persisted;
  const runtime = latestRuntimeByScene.get(scene)?.deref();
  const literals = runtime?.levels[0]?.store?.literals;
  if (!runtime || !literals) return null;
  return {
    tileGrid: runtime.tileGrid,
    literals: { segmentCount: literals.segmentCount, endpoints: literals.endpoints,
      primitiveMeta: literals.primitiveMeta, primitiveBounds: literals.primitiveBounds, styles: literals.styles },
    origins: explicitStrokePaintOrigins(literals),
    levels: runtime.levels.map(level => ({ tolerance: level.tolerance, overview: level.overview,
      segmentCount: level.segmentCount, records: level.records, sceneBounds: level.sceneBounds!,
      maxHalfWidth: level.maxHalfWidth!, tileOffsets: level.tileOffsets, tileCounts: level.tileCounts,
      tileSegmentIds: level.tileSegmentIds }))
  };
}

/** Install validated data. Each viewer gets its own selection state. @internal */
export function storeVectorStrokeLod(scene: VectorScene, data: StoredVectorStrokeLod): void {
  storedBuilds.set(scene, data);
}

function restoreVectorStrokeLodBuild(scene: VectorScene, data: StoredVectorStrokeLod): VectorStrokeLodRuntimeBuildData {
  const literals = { ...scene, ...data.literals };
  setStrokePaintOrigins(literals, data.origins);
  const store = { canonical: scene, literals };
  const bounds = runStrokeLodBuild(buildStrokeLodStorageBounds(store, 0, 1));
  return { tileGrid: data.tileGrid, elapsedMs: 0,
    levels: data.levels.map(level => new StoredVectorStrokeLodLevel(store, level, level, bounds)) };
}

/** Rebuild only spatial lookup tables, never simplification. Input geometry must be validated first. */
export async function rebuildStoredVectorStrokeLodIndexes(scene: VectorScene, data: StoredVectorStrokeLod,
  signal?: AbortSignal): Promise<StoredVectorStrokeLod> {
  signal?.throwIfAborted();
  const scheduler = new VectorStrokeLodYieldScheduler({ yieldIntervalMs: 50, shouldCancel: () => signal?.aborted ?? false });
  await scheduler.maybeYield(true, 0, "Restoring Vector LOD indexes");
  const literals = { ...scene, ...data.literals };
  setStrokePaintOrigins(literals, data.origins);
  const bounds = await runStrokeLodBuildAsync(buildStrokeLodStorageBounds({ canonical: scene, literals }, 0, 0.2), scheduler);
  const levels: StoredVectorStrokeLod["levels"] = [];
  let remainingReferences = 64 * 1024 * 1024;
  for (let i = 0; i < data.levels.length; i++) {
    const level = data.levels[i];
    const buckets = await runStrokeLodBuildAsync(buildStrokeLodTileBuckets(level.records, level.segmentCount,
      bounds, data.tileGrid, 0.2 + 0.8 * i / data.levels.length, 0.2 + 0.8 * (i + 1) / data.levels.length, remainingReferences), scheduler);
    remainingReferences -= buckets.tileSegmentIds.length;
    levels.push({ ...level, ...buckets });
  }
  signal?.throwIfAborted();
  return { ...data, levels };
}
