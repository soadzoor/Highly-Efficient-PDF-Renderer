import { vectorFillBandStore, type VectorFillBandIndex, type VectorPathSegmentStore } from "./vectorFillBands";

/**
 * Multi-level cell index over a path's segments, for coverage at any zoom.
 *
 * Box-filtered coverage sums, for every segment, the part of each footprint
 * row lying left of it. Horizontal bands cut the rows a pixel must visit, but
 * once a band is thinner than a pixel every segment in the footprint's rows
 * is visited again: a line of fine print or a dashed rule costs thousands of
 * iterations per pixel when zoomed out. The work has to be bounded in x too.
 *
 * Each level is a grid of square cells, of a power-of-two size. A pixel reads
 * the finest level whose cells are at least its footprint, so it overlaps at
 * most two cells each way, and splits its box at their column edges. Within a
 * column only that column's segments need their exact contribution; segments
 * are split at the column edges so that each piece lies in one column. All
 * geometry right of a column is fully right of the part of the box inside it,
 * so each of those pieces adds just its vertical extent within the rows:
 * clamp(end) - clamp(start). Summed along the path those telescope, leaving
 * one term per vertex the right-hand pieces do not share with each other -
 * the points where the path crosses the column's right edge. A cell stores
 * them as closures (y, weight) contributing weight * (clamp(y) - top of rows);
 * vertices below the cell's rows fold into one closure at y = -infinity.
 * Crossings of a point's rightward ray follow from the same closures, so clip
 * polygons use this index for their point and distance tests as well.
 *
 * Nothing is approximated: pieces are exact sub-curves and closures carry the
 * exact vertical extents, so coverage matches the unindexed sum up to
 * rounding. Optional index storage uses the caller's available texture capacity.
 */

/** A path needs this many segments before an index is shorter than its scan. */
const MIN_INDEXED_SEGMENTS = 24;
/** The finest level stops refining once its cells average this many pieces. */
const TARGET_PIECES_PER_CELL = 8;
/** Absolute addresses are stored as exact Float32 integers in the GPU format. */
const MAX_ADDRESSABLE_TEXELS = 2 ** 24;
/** Where vertices below a cell's rows fold into a single closure. */
export const CELL_CLOSURE_BELOW = -1e30;

export interface VectorCellLevel {
  readonly columns: number;
  readonly rows: number;
  /** Per cell, row-major: first piece, piece count, first closure pair, closure pair count. */
  readonly cells: Uint32Array;
  /** Eight floats per piece: x0, y0, control x, control y, x2, y2, curve flag, 0. */
  readonly pieces: Float32Array;
  /** Four floats per closure pair: (y, weight) twice; an unused half has weight 0. */
  readonly closures: Float32Array;
}

export interface VectorCellOptions {
  /** Refinement stops once a level's occupied cells average this many pieces. */
  readonly targetPieces?: number;
  /** Cell size ratio between levels, as a power of two. */
  readonly levelStep?: number;
  /** Available texture texels, across all levels; defaults to the address format's capacity. */
  readonly maxTexels?: number;
  /** Optional caller-selected texels per original segment, across all levels. */
  readonly texelsPerSegment?: number;
  /**
   * Keep horizontal lines. They add nothing to coverage or winding, but a
   * clip's distance probe must still find them as boundary.
   */
  readonly keepHorizontal?: boolean;
}

export interface VectorPathCells {
  readonly originX: number;
  readonly originY: number;
  /** Finest level's cell size; level l has cells of cellSize * 2^(l * levelStep). */
  readonly cellSize: number;
  readonly levelStep: number;
  /** Finest level first. */
  readonly levels: readonly VectorCellLevel[];
  /** Texels the index needs: pieces (per texture), level and cell records, closure pairs. */
  readonly pieceCount: number;
  readonly cellCount: number;
  readonly closurePairCount: number;
  /** A finer complete level could not fit the caller's remaining texture capacity. */
  readonly capacityLimited: boolean;
}

/**
 * Index one path. Segments are read from the store layout: A is (p0, control),
 * B is (p2, curve flag); a flag of at least `curveThreshold` marks a quadratic.
 * Returns null when the path is too small or degenerate to benefit.
 */
export function buildVectorPathCells(segmentsA: Float32Array, segmentsB: Float32Array, start: number,
  count: number, bounds: readonly number[], curveThreshold = 0.5, options: VectorCellOptions = {}): VectorPathCells | null {
  if (count < MIN_INDEXED_SEGMENTS) return null;
  const target = options.targetPieces ?? TARGET_PIECES_PER_CELL, step = options.levelStep ?? 1;
  if (!Number.isInteger(step) || step < 1 || !Number.isFinite(target) || target < 0) {
    throw new RangeError("Invalid vector cell refinement options.");
  }
  const keepHorizontal = options.keepHorizontal ?? false;
  const maxTexels = Math.floor(Math.min(MAX_ADDRESSABLE_TEXELS, options.maxTexels ?? MAX_ADDRESSABLE_TEXELS,
    options.texelsPerSegment === undefined ? Infinity : count * options.texelsPerSegment));
  if (!(maxTexels > 0)) return null;
  const [minX, minY, maxX, maxY] = bounds;
  const extent = Math.max(maxX - minX, maxY - minY);
  if (!(extent > 0) || !Number.isFinite(extent) || !Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  const top = 2 ** Math.ceil(Math.log2(extent));
  if (!Number.isFinite(top) || top <= 0) return null;
  const levels: VectorCellLevel[] = [];
  let pieces = 0, cells = 0, pairs = 0;
  let finest = top, previousWork = Infinity, previousPieces = 0, capacityLimited = false;
  for (let depth = step; ; depth += step) {
    const size = top / 2 ** depth;
    // Float32 must represent the cell size, and every cell edge distinctly.
    if (Math.fround(size) !== size || size < Math.max(Math.abs(minX), Math.abs(minY), extent) * 2 ** -20) break;
    const columns = Math.max(1, Math.ceil((maxX - minX) / size));
    const rows = Math.max(1, Math.ceil((maxY - minY) / size));
    const remaining = maxTexels - pieces - cells - pairs - levels.length - 1;
    if (!Number.isSafeInteger(columns * rows) || columns * rows > remaining) { capacityLimited = true; break; }
    const level = buildLevel(segmentsA, segmentsB, start, count, minX, minY, size, columns, rows, curveThreshold,
      keepHorizontal, remaining);
    // A level that exceeds the construction budget is optional. Earlier,
    // complete levels still cover the whole path without dropping geometry.
    if (!level) { capacityLimited = true; break; }
    const levelPieces = level.pieces.length / 8, levelPairs = level.closures.length / 4;
    // Pieces occupy a texel in each store texture; records and closures in one.
    let occupied = 0, work = 0;
    for (let cell = 0; cell < columns * rows; cell++) {
      const candidates = level.cells[cell * 4 + 1] + 2 * level.cells[cell * 4 + 3];
      if (candidates > 0) { occupied++; work += candidates; }
    }
    const averageWork = occupied ? work / occupied : 0;
    // Finer grids that only duplicate long edges add storage without reducing
    // candidate work. Keep the complete earlier levels in that case.
    if (levels.length && averageWork >= previousWork && levelPieces >= previousPieces * 2 ** step) break;
    levels.unshift(level);
    pieces += levelPieces; cells += columns * rows; pairs += levelPairs;
    finest = size; previousWork = averageWork; previousPieces = levelPieces;
    if (!occupied || levelPieces / occupied <= target) break;
  }
  if (!levels.length) return null;
  return { originX: minX, originY: minY, cellSize: finest, levelStep: step, levels, pieceCount: pieces,
    cellCount: cells, closurePairCount: pairs, capacityLimited };
}

/** Growable piece storage: seven floats (x0, y0, cx, cy, x2, y2, flag) and a column each. */
class PieceBuffer {
  values = new Float64Array(7 * 256);
  columns = new Int32Array(256);
  count = 0;
  push(x0: number, y0: number, cx: number, cy: number, x2: number, y2: number, flag: number, column: number): void {
    if (this.count === this.columns.length) {
      const values = new Float64Array(this.values.length * 2); values.set(this.values); this.values = values;
      const columns = new Int32Array(this.columns.length * 2); columns.set(this.columns); this.columns = columns;
    }
    const at = this.count * 7;
    this.values[at] = x0; this.values[at + 1] = y0; this.values[at + 2] = cx; this.values[at + 3] = cy;
    this.values[at + 4] = x2; this.values[at + 5] = y2; this.values[at + 6] = flag;
    this.columns[this.count++] = column;
  }
}

function buildLevel(segmentsA: Float32Array, segmentsB: Float32Array, start: number, count: number,
  originX: number, originY: number, size: number, columns: number, rows: number,
  curveThreshold: number, keepHorizontal: boolean, maxTexels: number): VectorCellLevel | null {
  const cellCount = columns * rows;
  const maxPieces = maxTexels - cellCount;
  if (maxPieces < 0) return null;
  const edgeX = (column: number): number => Math.fround(originX + column * size);
  const edgeY = (row: number): number => Math.fround(originY + row * size);
  const columnOf = (x: number): number => Math.max(0, Math.min(columns - 1, Math.floor((x - originX) / size)));
  const buffer = sharedPieces;
  buffer.count = 0;
  const splits: number[] = [], order: number[] = [];
  for (let segment = start; segment < start + count; segment++) {
    const a = segment * 4;
    const x0 = segmentsA[a], y0 = segmentsA[a + 1], x2 = segmentsB[a], y2 = segmentsB[a + 1];
    const curve = segmentsB[a + 2] >= curveThreshold ? 1 : 0;
    const cx = curve ? segmentsA[a + 2] : x0, cy = curve ? segmentsA[a + 3] : y0;
    // A horizontal line adds nothing to any row and crosses no ray.
    if (!curve && y0 === y2 && (!keepHorizontal || x0 === x2)) continue;
    const flag = segmentsB[a + 2];
    const low = Math.min(x0, cx, x2), high = Math.max(x0, cx, x2);
    // Most segments lie within one column and need no splitting.
    if (columns === 1 || Math.floor((low - originX) / size) === Math.floor((high - originX) / size)) {
      if (buffer.count >= maxPieces) return null;
      buffer.push(x0, y0, cx, cy, x2, y2, flag, columnOf(curve ? 0.25 * (x0 + 2 * cx + x2) : 0.5 * (x0 + x2)));
      continue;
    }
    splits.length = 0;
    {
      const first = Math.max(1, Math.ceil((low - originX) / size) - 1);
      const last = Math.min(columns - 1, Math.floor((high - originX) / size) + 1);
      for (let column = first; column <= last; column++) {
        const x = edgeX(column);
        if (!(x > low && x < high)) continue;
        if (curve) {
          const qa = x0 - 2 * cx + x2, qb = 2 * (cx - x0), qc = x0 - x;
          if (Math.abs(qa) < 1e-12 * (Math.abs(qb) + 1e-30)) { if (qb !== 0) pushRoot(splits, -qc / qb, x); }
          else {
            const discriminant = qb * qb - 4 * qa * qc;
            if (discriminant >= 0) {
              const q = -0.5 * (qb + Math.sign(qb || 1) * Math.sqrt(discriminant));
              pushRoot(splits, q / qa, x);
              if (q !== 0) pushRoot(splits, qc / q, x);
            }
          }
        } else pushRoot(splits, (x - x0) / (x2 - x0), x);
        if (buffer.count + splits.length / 2 > maxPieces) return null;
      }
    }
    if (!splits.length) {
      if (buffer.count >= maxPieces) return null;
      buffer.push(x0, y0, cx, cy, x2, y2, flag, columnOf(curve ? 0.25 * (x0 + 2 * cx + x2) : 0.5 * (x0 + x2)));
      continue;
    }
    // Pairs of (t, x): sort by parameter, drop repeats, split successively.
    order.length = 0;
    for (let index = 0; index < splits.length; index += 2) order.push(index);
    order.sort((p, q) => splits[p] - splits[q]);
    const pointX = (t: number): number => (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x2;
    const pointY = (t: number): number => (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y2;
    const emit = (t0: number, t1: number, px: number, py: number, qx: number, qy: number): boolean => {
      if (px === qx && py === qy) return true;
      if (buffer.count >= maxPieces) return false;
      let controlX = px, controlY = py;
      if (curve) {
        const s0 = 1 - t0, s1 = 1 - t1, blend = s0 * t1 + t0 * s1;
        controlX = Math.fround(s0 * s1 * x0 + blend * cx + t0 * t1 * x2);
        controlY = Math.fround(s0 * s1 * y0 + blend * cy + t0 * t1 * y2);
      }
      buffer.push(px, py, controlX, controlY, qx, qy, flag, columnOf(curve ? pointX(0.5 * (t0 + t1)) : 0.5 * (px + qx)));
      return true;
    };
    let previousT = 0, previousX = x0, previousY = y0;
    for (const index of order) {
      const t = splits[index], x = splits[index + 1];
      if (t - previousT < 1e-9) continue;
      // The split point sits exactly on the column edge, shared by both pieces.
      const y = Math.fround(curve ? pointY(t) : y0 + t * (y2 - y0));
      if (!emit(previousT, t, previousX, previousY, x, y)) return null;
      previousT = t; previousX = x; previousY = y;
    }
    if (!emit(previousT, 1, previousX, previousY, x2, y2)) return null;
  }

  // Stable counting sort of the pieces by column.
  const pieceCount = buffer.count, values = buffer.values;
  const columnStart = new Int32Array(columns + 1);
  for (let piece = 0; piece < pieceCount; piece++) columnStart[buffer.columns[piece] + 1]++;
  for (let column = 0; column < columns; column++) columnStart[column + 1] += columnStart[column];
  const byColumn = new Int32Array(pieceCount), cursor = columnStart.slice(0, columns);
  for (let piece = 0; piece < pieceCount; piece++) byColumn[cursor[buffer.columns[piece]]++] = piece;

  // Vertices of everything right of each column edge that the pieces there do
  // not share with each other: the edge crossings (and the ends of any open
  // path). Each column's own shared vertices cancel first; the small residues
  // then accumulate right to left.
  const rightYs: Float64Array[] = new Array(columns), rightWeights: Float64Array[] = new Array(columns);
  let accumulatedYs: Float64Array = new Float64Array(0), accumulatedWeights: Float64Array = new Float64Array(0);
  let retainedEndpoints = 0;
  rightYs[columns - 1] = accumulatedYs; rightWeights[columns - 1] = accumulatedWeights;
  for (let column = columns - 1; column >= 1; column--) {
    const first = columnStart[column], total = columnStart[column + 1] - first;
    const starts = new Float64Array(total), ends = new Float64Array(total);
    for (let index = 0; index < total; index++) {
      const at = byColumn[first + index] * 7;
      starts[index] = values[at + 1]; ends[index] = values[at + 5];
    }
    starts.sort(); ends.sort();
    const [residueYs, residueWeights] = netWeights(starts, ends);
    [accumulatedYs, accumulatedWeights] = mergeWeights(accumulatedYs, accumulatedWeights, residueYs, residueWeights);
    // Columns can share the same arrays. Count only new retained arrays so
    // open/disjoint paths cannot grow an unbounded intermediate endpoint store.
    if (accumulatedYs !== rightYs[column]) {
      retainedEndpoints += accumulatedYs.length;
      if (retainedEndpoints > 2 * maxTexels) return null;
    }
    rightYs[column - 1] = accumulatedYs; rightWeights[column - 1] = accumulatedWeights;
  }

  // A small margin keeps a row's contents exact when a shader rounds a point
  // into the neighbouring row.
  const margin = (Math.abs(originY) + rows * size) * 2 ** -18;
  const rowOf = (y: number): number => Math.max(0, Math.min(rows - 1, Math.floor((y - originY) / size)));
  const pieceRows = new Int32Array(pieceCount * 2);
  const cellStart = new Int32Array(cellCount + 1);
  let duplicatedPieces = 0;
  for (let piece = 0; piece < pieceCount; piece++) {
    const at = piece * 7, column = buffer.columns[piece];
    const low = Math.min(values[at + 1], values[at + 3], values[at + 5]);
    const high = Math.max(values[at + 1], values[at + 3], values[at + 5]);
    const first = rowOf(low - margin), last = rowOf(high + margin);
    duplicatedPieces += last - first + 1;
    // Check before incrementing rows or allocating their duplicated geometry.
    if (duplicatedPieces > maxPieces) return null;
    pieceRows[piece * 2] = first; pieceRows[piece * 2 + 1] = last;
    for (let row = first; row <= last; row++) cellStart[row * columns + column + 1]++;
  }
  for (let cell = 0; cell < cellCount; cell++) cellStart[cell + 1] += cellStart[cell];
  const pieces = new Float32Array(cellStart[cellCount] * 8);
  const fill = cellStart.slice(0, cellCount);
  // Within a cell, pieces keep their column order.
  for (let index = 0; index < pieceCount; index++) {
    const piece = byColumn[index], at = piece * 7, column = buffer.columns[piece];
    for (let row = pieceRows[piece * 2]; row <= pieceRows[piece * 2 + 1]; row++) {
      const target = fill[row * columns + column]++ * 8;
      for (let value = 0; value < 7; value++) pieces[target + value] = values[at + value];
    }
  }

  const cells = new Uint32Array(cellCount * 4);
  let closures = new Float32Array(1024), closureLength = 0;
  const maxClosureFloats = (maxTexels - cellCount - duplicatedPieces) * 4;
  const pushClosure = (y: number, weight: number): boolean => {
    if (closureLength + 2 > maxClosureFloats) return false;
    if (closureLength + 2 > closures.length) { const grown = new Float32Array(closures.length * 2); grown.set(closures); closures = grown; }
    closures[closureLength++] = y; closures[closureLength++] = weight;
    return true;
  };
  const lowerBound = (ys: Float64Array, value: number): number => {
    let low = 0, high = ys.length;
    while (low < high) { const middle = (low + high) >> 1; if (ys[middle] < value) low = middle + 1; else high = middle; }
    return low;
  };
  for (let row = 0; row < rows; row++) {
    const low = row === 0 ? -Infinity : edgeY(row) - margin;
    const high = row === rows - 1 ? Infinity : edgeY(row + 1) + margin;
    for (let column = 0; column < columns; column++) {
      const cell = row * columns + column;
      cells[cell * 4] = cellStart[cell];
      cells[cell * 4 + 1] = cellStart[cell + 1] - cellStart[cell];
      const ys = rightYs[column], ws = rightWeights[column];
      const first = lowerBound(ys, low), last = lowerBound(ys, high);
      let below = 0;
      for (let index = 0; index < first; index++) below += ws[index];
      const begin = closureLength;
      if (below !== 0 && !pushClosure(CELL_CLOSURE_BELOW, below)) return null;
      for (let index = first; index < last; index++) if (!pushClosure(ys[index], ws[index])) return null;
      if ((closureLength - begin) % 4 && !pushClosure(0, 0)) return null;
      cells[cell * 4 + 2] = begin / 4;
      cells[cell * 4 + 3] = (closureLength - begin) / 4;
    }
  }
  return { columns, rows, cells, pieces, closures: closures.slice(0, closureLength) };
}

const sharedPieces = new PieceBuffer();

/** Net endpoint weights per y: +1 per end, -1 per start; cancelled values dropped. */
function netWeights(starts: Float64Array, ends: Float64Array): [Float64Array, Float64Array] {
  const ys: number[] = [], weights: number[] = [];
  let i = 0, j = 0;
  while (i < starts.length || j < ends.length) {
    const y = j >= ends.length || (i < starts.length && starts[i] < ends[j]) ? starts[i] : ends[j];
    let weight = 0;
    while (i < starts.length && starts[i] === y) { weight--; i++; }
    while (j < ends.length && ends[j] === y) { weight++; j++; }
    if (weight !== 0) { ys.push(y); weights.push(weight); }
  }
  return [Float64Array.from(ys), Float64Array.from(weights)];
}

/** Sum of two sorted weight lists, dropping values that cancel. */
function mergeWeights(ysA: Float64Array, weightsA: Float64Array, ysB: Float64Array,
  weightsB: Float64Array): [Float64Array, Float64Array] {
  if (!ysB.length) return [ysA, weightsA];
  const ys: number[] = [], weights: number[] = [];
  let i = 0, j = 0;
  while (i < ysA.length || j < ysB.length) {
    let y: number, weight: number;
    if (j >= ysB.length || (i < ysA.length && ysA[i] < ysB[j])) { y = ysA[i]; weight = weightsA[i++]; }
    else if (i >= ysA.length || ysB[j] < ysA[i]) { y = ysB[j]; weight = weightsB[j++]; }
    else { y = ysA[i]; weight = weightsA[i++] + weightsB[j++]; }
    if (weight !== 0) { ys.push(y); weights.push(weight); }
  }
  return [Float64Array.from(ys), Float64Array.from(weights)];
}

/** Records a split at parameter t where the curve meets column edge x. */
function pushRoot(splits: number[], t: number, x: number): void {
  if (t > 1e-9 && t < 1 - 1e-9) splits.push(t, x);
}

export interface VectorPathCellStoreOptions extends VectorCellOptions {
  /** Texel where the index begins; earlier texels belong to the caller (segments, bands). */
  readonly base?: number;
  /** Texels the whole index may add, beyond `base`. */
  readonly budget?: number;
  /** A segment with a flag at least this is a quadratic. */
  readonly curveThreshold?: number;
}

/** Index payload for one texture pair, starting at `base`. */
export interface VectorPathCellStore {
  /** Texels [base, texels) of texture A: the pieces' endpoints, then the index records. */
  readonly dataA: Float32Array;
  /** Texels [base, base + pieces) of texture B: the pieces' control points and curve flags. */
  readonly dataB: Float32Array;
  /** Texel count of texture A including everything before `base`. */
  readonly texels: number;
  /** Texel of the first per-path header, or -1 when no path is indexed. */
  readonly headerBase: number;
  readonly indexedPaths: number;
}

/** Defaults: a 4x size ratio between levels halves storage for ~20% more work. */
const STORE_DEFAULTS: VectorCellOptions = { targetPieces: 12, levelStep: 2,
  keepHorizontal: false };

/**
 * Lays indexed paths out from `base` in the textures the shaders already
 * sample. Pieces are appended to both textures, unlike the segments before
 * them: A holds a piece's endpoints (x0, y0, x2, y2), all a line needs, and B
 * its control point and curve flag. A then holds per path (first level texel,
 * level count, finest cell size, level step), per level (first cell texel,
 * columns, rows, 0), per cell (first piece, piece count, first closure texel,
 * closure texel count), and the closure pairs. A cell with a curve among its
 * pieces stores its piece count negated, so a cell of lines, nearly every
 * cell, reads one texel per piece. Every index is absolute. Paths with the
 * most segments gain the most and are indexed first, within the available
 * texture capacity; a path left out
 * has a zero level count and keeps its band index or linear scan.
 */
export function vectorPathCellStore(store: VectorPathSegmentStore, maxTextureSize = Math.sqrt(MAX_ADDRESSABLE_TEXELS),
  options: VectorPathCellStoreOptions = {}): VectorPathCellStore {
  const segmentCount = store.segmentCount, pathCount = store.pathCount;
  const base = options.base ?? segmentCount;
  const empty: VectorPathCellStore = { dataA: new Float32Array(0), dataB: new Float32Array(0), texels: base,
    headerBase: -1, indexedPaths: 0 };
  if (!pathCount || !store.pathMetaA || !store.pathMetaB) return empty;
  // Offsets must stay exact Float32 integers and inside one texture.
  const capacity = Math.min(maxTextureSize * maxTextureSize, MAX_ADDRESSABLE_TEXELS);
  const budget = Math.min(capacity - base - pathCount, options.budget ?? Infinity);
  if (budget <= 0) return empty;
  const cellOptions = { ...STORE_DEFAULTS, ...options };
  const curveThreshold = options.curveThreshold ?? 0.5;
  const order = Array.from({ length: pathCount }, (_, path) => path)
    .filter(path => store.pathMetaA[path * 4 + 1] >= MIN_INDEXED_SEGMENTS)
    .sort((a, b) => store.pathMetaA[b * 4 + 1] - store.pathMetaA[a * 4 + 1] || a - b);
  const indexes: (VectorPathCells | null)[] = new Array(pathCount).fill(null);
  let pieces = 0, levels = 0, cells = 0, pairs = 0, indexed = 0;
  for (const path of order) {
    const meta = path * 4;
    const count = store.pathMetaA[meta + 1];
    // Cheapest possible index for this path: one level of its own pieces.
    if (pieces + levels + cells + pairs + count > budget) continue;
    const index = buildVectorPathCells(store.segmentsA, store.segmentsB, store.pathMetaA[meta], count,
      [store.pathMetaA[meta + 2], store.pathMetaA[meta + 3], store.pathMetaB[meta], store.pathMetaB[meta + 1]],
      curveThreshold, { ...cellOptions, maxTexels: Math.min(cellOptions.maxTexels ?? Infinity,
        budget - pieces - levels - cells - pairs) });
    if (!index) continue;
    const size = index.pieceCount + index.levels.length + index.cellCount + index.closurePairCount;
    if (pieces + levels + cells + pairs + size > budget) continue;
    indexes[path] = index;
    pieces += index.pieceCount; levels += index.levels.length; cells += index.cellCount;
    pairs += index.closurePairCount;
    indexed++;
  }
  if (!indexed) return empty;
  const headerBase = base + pieces, levelBase = headerBase + pathCount;
  const cellBase = levelBase + levels, pairBase = cellBase + cells, texels = pairBase + pairs;
  const dataA = new Float32Array((texels - base) * 4), dataB = new Float32Array(pieces * 4);
  const at = (texel: number): number => (texel - base) * 4;
  const write = (texel: number, x: number, y: number, z: number, w: number): void => {
    const offset = at(texel);
    dataA[offset] = x; dataA[offset + 1] = y; dataA[offset + 2] = z; dataA[offset + 3] = w;
  };
  let piece = base, level = levelBase, cell = cellBase, pair = pairBase;
  for (let path = 0; path < pathCount; path++) {
    const index = indexes[path];
    if (!index) continue;
    write(headerBase + path, level, index.levels.length, index.cellSize, index.levelStep);
    for (const grid of index.levels) {
      const cellCount = grid.columns * grid.rows, firstPiece = piece, firstPair = pair;
      write(level++, cell, grid.columns, grid.rows, 0);
      const source = grid.pieces;
      for (let offset = 0; offset < source.length; offset += 8, piece++) {
        const target = at(piece);
        dataA[target] = source[offset]; dataA[target + 1] = source[offset + 1];
        dataA[target + 2] = source[offset + 4]; dataA[target + 3] = source[offset + 5];
        dataB[target] = source[offset + 2]; dataB[target + 1] = source[offset + 3];
        dataB[target + 2] = source[offset + 6];
      }
      dataA.set(grid.closures, at(pair));
      pair += grid.closures.length / 4;
      const records = grid.cells;
      for (let local = 0; local < cellCount; local++) {
        const first = records[local * 4], count = records[local * 4 + 1];
        let curved = false;
        for (let index = first; index < first + count && !curved; index++) curved = source[index * 8 + 6] >= curveThreshold;
        write(cell++, firstPiece + first, curved ? -count : count, firstPair + records[local * 4 + 2], records[local * 4 + 3]);
      }
    }
  }
  return { dataA, dataB, texels, headerBase, indexedPaths: indexed };
}

/** Texture payloads of a path store carrying both of its indexes. */
export interface VectorIndexedPathStore {
  readonly dataA: Float32Array;
  readonly dataB: Float32Array;
  readonly texels: number;
  /** Band records and packed entries, as vectorFillBandStore lays them out; -1 without. */
  readonly bandBase: number;
  readonly bandEntries: number;
  /** Per-path cell headers; -1 without. */
  readonly cellBase: number;
}

/**
 * Segments, then the band index, then the cell index. A path the cell budget
 * leaves out still has its bands; one without either scans linearly.
 */
export function vectorIndexedPathStore(store: VectorPathSegmentStore, bands: VectorFillBandIndex | null,
  maxTextureSize = Math.sqrt(MAX_ADDRESSABLE_TEXELS), options: VectorPathCellStoreOptions = {}): VectorIndexedPathStore {
  const banded = vectorFillBandStore(store.segmentsA, store.segmentCount, bands, maxTextureSize);
  const cells = vectorPathCellStore(store, maxTextureSize, { ...options, base: banded.texels });
  const dataA = new Float32Array(cells.texels * 4);
  dataA.set(banded.data.subarray(0, banded.texels * 4));
  dataA.set(cells.dataA, banded.texels * 4);
  const dataB = new Float32Array((banded.texels + cells.dataB.length / 4) * 4);
  dataB.set(store.segmentsB.subarray(0, store.segmentCount * 4));
  dataB.set(cells.dataB, banded.texels * 4);
  return { dataA, dataB, texels: cells.texels, bandBase: banded.pathBase, bandEntries: banded.entryBase,
    cellBase: cells.headerBase };
}
