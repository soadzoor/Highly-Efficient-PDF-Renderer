import type { VectorClipPath, VectorScene } from "./pdfVectorExtractor";
import { buildVectorPathCells, type VectorPathCells } from "./vectorCellIndex";

export const MAX_VECTOR_CLIP_EDGES = 8192;
export const MAX_VECTOR_CLIP_DEPTH = 64;
// Keep texel offsets exactly representable as floats and bound upload memory to 64 MiB.
export const MAX_VECTOR_CLIP_TEXELS = 4 * 1024 * 1024;

export function validateVectorClips(scene: VectorScene): void {
  const clips = scene.clipPaths;
  if (clips === undefined) return;
  if (!Array.isArray(clips)) throw new Error("Invalid vector clip paths.");
  const depths: number[] = [];
  let texels = clips.length;
  for (let index = 0; index < clips.length; index++) {
    const clip = clips[index];
    if (!clip || !Number.isInteger(clip.parent) || clip.parent < -1 || clip.parent >= index ||
        (clip.fillRule !== 0 && clip.fillRule !== 1) || !(clip.edges instanceof Float32Array) ||
        clip.edges.length % 4 !== 0 || clip.edges.length / 4 > MAX_VECTOR_CLIP_EDGES ||
        !clip.edges.every(Number.isFinite)) throw new Error("Invalid vector clip path.");
    const depth = clip.parent < 0 ? 1 : depths[clip.parent] + 1;
    if (depth > MAX_VECTOR_CLIP_DEPTH) throw new Error("Vector clip nesting exceeds its limit.");
    texels += clip.edges.length / 4;
    if (texels > MAX_VECTOR_CLIP_TEXELS) throw new Error("Vector clip storage exceeds its limit.");
    depths.push(depth);
  }
}

/** Clip-chain bounds that clamp nothing, for unclipped and per-instance draws. */
export const UNBOUNDED_VECTOR_CLIP_BOUNDS: readonly number[] = [-1e38, -1e38, 1e38, 1e38];

/**
 * World bounds [minX, minY, maxX, maxY] per clip, intersected with every
 * ancestor. Nothing outside them survives the clip chain, so a paint's quad
 * may be clamped to them (widened by its antialiasing reach) without changing
 * a pixel. An empty chain has minX > maxX or minY > maxY.
 */
export function vectorClipChainBounds(clips: readonly VectorClipPath[] = []): Float32Array {
  const bounds = new Float32Array(clips.length * 4);
  for (let index = 0; index < clips.length; index++) {
    const edges = clips[index].edges;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let offset = 0; offset < edges.length; offset += 4) {
      minX = Math.min(minX, edges[offset], edges[offset + 2]);
      minY = Math.min(minY, edges[offset + 1], edges[offset + 3]);
      maxX = Math.max(maxX, edges[offset], edges[offset + 2]);
      maxY = Math.max(maxY, edges[offset + 1], edges[offset + 3]);
    }
    const parent = clips[index].parent;
    if (parent >= 0) {
      minX = Math.max(minX, bounds[parent * 4]);
      minY = Math.max(minY, bounds[parent * 4 + 1]);
      maxX = Math.min(maxX, bounds[parent * 4 + 2]);
      maxY = Math.min(maxY, bounds[parent * 4 + 3]);
    }
    bounds.set([minX, minY, maxX, maxY], index * 4);
  }
  return bounds;
}

type ClipRectangle = [number, number, number, number];

function clipRectangle(edges: Float32Array): ClipRectangle | undefined {
  if (edges.length !== 16) return undefined;
  for (let offset = 0; offset < 16; offset += 4) {
    const next = (offset + 4) % 16;
    const vertical = edges[offset] === edges[offset + 2];
    const horizontal = edges[offset + 1] === edges[offset + 3];
    // Require a closed loop of four nonzero, alternating axis-aligned edges.
    // No tolerance: even a slight shear must retain polygon clipping.
    if (vertical === horizontal || vertical === (edges[next] === edges[next + 2]) ||
        edges[offset + 2] !== edges[next] || edges[offset + 3] !== edges[next + 1]) return undefined;
  }
  return [Math.min(edges[0], edges[8]), Math.min(edges[1], edges[9]),
    Math.max(edges[0], edges[8]), Math.max(edges[1], edges[9])];
}

const MIN_INDEXED_CLIP_EDGES = 64;
const TARGET_CLIP_EDGES_PER_BAND = 16;
const MAX_CLIP_BANDS = 512;
const MAX_CLIP_ENTRIES_PER_EDGE = 4;
// Subnormal band heights may flush to zero on the GPU.
const MIN_NORMAL_FLOAT32 = 2 ** -126;

interface ClipBands {
  minY: number;
  height: number;
  counts: Uint32Array;
  entries: number;
}

function clipBandRow(y: number, minY: number, height: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.floor(Math.fround(Math.fround(y - minY) / height))));
}

/** Keep the original directed edges; only shorten the per-pixel candidate list. */
function buildClipBands(edges: Float32Array): ClipBands | null {
  const edgeCount = edges.length / 4;
  if (edgeCount < MIN_INDEXED_CLIP_EDGES) return null;
  let minY = Infinity, maxY = -Infinity;
  for (let offset = 0; offset < edges.length; offset += 4) {
    minY = Math.min(minY, edges[offset + 1], edges[offset + 3]);
    maxY = Math.max(maxY, edges[offset + 1], edges[offset + 3]);
  }
  const span = Math.fround(maxY - minY);
  if (!(span > 0) || !Number.isFinite(span)) return null;
  const count = Math.min(MAX_CLIP_BANDS, 2 ** Math.ceil(Math.log2(edgeCount / TARGET_CLIP_EDGES_PER_BAND)));
  const height = Math.fround(span / count);
  if (height < MIN_NORMAL_FLOAT32) return null;
  const counts = new Uint32Array(count);
  let entries = 0;
  for (let offset = 0; offset < edges.length; offset += 4) {
    const y0 = edges[offset + 1], y1 = edges[offset + 3];
    // Horizontal edges cannot change winding, but still bound edge coverage.
    // Match Float32 addressing, with one neighbouring band on each side for
    // backend rounding at a boundary. No geometry or crossing math is changed.
    const first = Math.max(0, clipBandRow(Math.min(y0, y1), minY, height, count) - 1);
    const last = Math.min(count - 1, clipBandRow(Math.max(y0, y1), minY, height, count) + 1);
    entries += last - first + 1;
    if (entries > edgeCount * MAX_CLIP_ENTRIES_PER_EDGE) return null;
    for (let band = first; band <= last; band++) counts[band]++;
  }
  // Full-height edges gain nothing from indexing. Keep their original scan.
  if (entries / count >= edgeCount / 2) return null;
  return { minY, height, counts, entries };
}

/** Clip polygons are indexed more finely than fills: one texel per line piece. */
const CLIP_CELL_OPTIONS = { targetPieces: 8, levelStep: 1, texelsPerSegment: 12, keepHorizontal: true };

/** A cell index over a clip polygon's edges (see vectorCellIndex.ts), or null. */
function buildClipCells(edges: Float32Array): VectorPathCells | null {
  const count = edges.length / 4;
  const segmentsA = new Float32Array(count * 4), segmentsB = new Float32Array(count * 4);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let edge = 0; edge < count; edge++) {
    const x0 = edges[edge * 4], y0 = edges[edge * 4 + 1], x1 = edges[edge * 4 + 2], y1 = edges[edge * 4 + 3];
    segmentsA.set([x0, y0, x0, y0], edge * 4);
    segmentsB.set([x1, y1, 0, 0], edge * 4);
    minX = Math.min(minX, x0, x1); minY = Math.min(minY, y0, y1);
    maxX = Math.max(maxX, x0, x1); maxY = Math.max(maxY, y0, y1);
  }
  return buildVectorPathCells(segmentsA, segmentsB, 0, count, [minX, minY, maxX, maxY], 0.5, CLIP_CELL_OPTIONS);
}

/** Texels a clip's cell index occupies: header pair, levels, cells, pieces, closures. */
function clipCellTexels(cells: VectorPathCells): number {
  return 2 + cells.levels.length + cells.cellCount + cells.pieceCount + cells.closurePairCount;
}

/** Drop only the finest levels; every retained level still covers the whole polygon. */
function fitClipCells(cells: VectorPathCells, capacity: number): VectorPathCells | null {
  if (clipCellTexels(cells) <= capacity) return cells;
  let pieces = cells.pieceCount, count = cells.cellCount, pairs = cells.closurePairCount;
  for (let first = 1; first < cells.levels.length; first++) {
    const removed = cells.levels[first - 1];
    pieces -= removed.pieces.length / 8;
    count -= removed.columns * removed.rows;
    pairs -= removed.closures.length / 4;
    if (2 + cells.levels.length - first + count + pieces + pairs <= capacity) {
      return { ...cells, levels: cells.levels.slice(first), cellSize: cells.cellSize * 2 ** (first * cells.levelStep),
        pieceCount: pieces, cellCount: count, closurePairCount: pairs };
    }
  }
  return null;
}

export interface VectorClipPackingStats {
  readonly uniquePayloads: number;
  readonly sharedPayloads: number;
  readonly rectangleNodes: number;
  readonly cellIndexedNodes: number;
  readonly bandIndexedNodes: number;
  readonly unindexedPolygonNodes: number;
  readonly coarsenedCellNodes: number;
}

export interface PackVectorClipOptions {
  /**
   * Index polygons with cells instead of bands. Only shaders that read flag
   * bit 2 may be given this layout: the clip GLSL and WGSL both do.
   */
  readonly cells?: boolean;
  /** Upload-time diagnostics; node counts include nodes sharing a payload. */
  readonly onStats?: (stats: VectorClipPackingStats) => void;
}

interface ClipPayload {
  readonly edges: Float32Array;
  readonly words: Uint32Array;
  readonly rectangle: boolean;
  bands: ClipBands | null;
  cells: VectorPathCells | null;
  coarsened: boolean;
  offset: number;
}

/** Hash exact Float32 words, then verify collisions before sharing any geometry. */
function clipPayloadKey(words: Uint32Array, rectangle: boolean): string {
  let hash = 0x811c9dc5;
  for (const word of words) hash = Math.imul(hash ^ word, 0x01000193);
  return `${rectangle ? 1 : 0}:${words.length}:${hash >>> 0}`;
}

/**
 * One RGBA header [parent, offset, originalEdgeCount, flags] per original clip.
 * flags bit 0 is the fill rule; bit 1 selects horizontal-band polygon storage.
 * Bit 2 selects cell storage instead: the offset points to [first level texel,
 * level count, finest cell size, level step] and [origin x, origin y, 0, 0],
 * then per level [first cell texel, columns, rows, 0], per cell [first piece
 * texel, piece count, first closure texel, closure texel count], the line
 * pieces as edge vec4s and the closure pairs, all addressed absolutely.
 * A negative edge count retains the rectangle [minX, minY, maxX, maxY] fast path.
 * An indexed offset points to [tableOffset, minY, bandHeight, bandCount], followed
 * by one [firstEdgeTexel, count, 0, 0] per band and contiguous unchanged edge vec4s.
 * Edges shared by bands are duplicated to keep a single texture fetch per edge.
 * Consecutive rectangle ancestors are intersected once, preserving node IDs.
 * Identical geometry shares a payload, independently of parent and fill rule.
 * The optional capacity bounds derived GPU storage; indexing falls back to the
 * coarser cell levels, bands or original scan when it cannot fit. Canonical
 * scene/HEP geometry is untouched.
 */
export function packVectorClips(clips: readonly VectorClipPath[] = [], maxTexels = MAX_VECTOR_CLIP_TEXELS,
  options: PackVectorClipOptions = {}): Float32Array {
  if (!Number.isSafeInteger(maxTexels) || maxTexels < 1 || maxTexels > MAX_VECTOR_CLIP_TEXELS) {
    throw new RangeError("Invalid vector clip texture capacity.");
  }
  const rawCount = clips.reduce((total, clip) => total + clip.edges.length / 4, clips.length);
  if (rawCount > MAX_VECTOR_CLIP_TEXELS) throw new RangeError("Vector clip storage exceeds its limit.");
  const rectangles: (ClipRectangle | undefined)[] = [];
  const parents = new Int32Array(clips.length);
  const payloads: ClipPayload[] = [], nodePayloads: ClipPayload[] = [];
  const buckets = new Map<string, ClipPayload[]>();
  let count = clips.length;
  for (let index = 0; index < clips.length; index++) {
    const clip = clips[index];
    const rectangle = clipRectangle(clip.edges);
    const parentRectangle = rectangles[clip.parent];
    parents[index] = clip.parent;
    if (rectangle && parentRectangle) {
      rectangle[0] = Math.max(rectangle[0], parentRectangle[0]);
      rectangle[1] = Math.max(rectangle[1], parentRectangle[1]);
      rectangle[2] = Math.min(rectangle[2], parentRectangle[2]);
      rectangle[3] = Math.min(rectangle[3], parentRectangle[3]);
      parents[index] = parents[clip.parent];
    }
    rectangles.push(rectangle);
    // Rectangle fusion depends on the parent, so compare the final bounds,
    // not the original edges. Polygon storage is independent of both parent
    // and fill rule; those stay in each original node's header.
    const edges = rectangle ? Float32Array.from(rectangle) : clip.edges;
    const words = new Uint32Array(edges.buffer, edges.byteOffset, edges.length);
    const key = clipPayloadKey(words, !!rectangle), bucket = buckets.get(key);
    let payload = bucket?.find(candidate => candidate.words.every((word, i) => word === words[i]));
    if (!payload) {
      payload = { edges, words, rectangle: !!rectangle, bands: null, cells: null, coarsened: false, offset: 0 };
      if (bucket) bucket.push(payload); else buckets.set(key, [payload]);
      payloads.push(payload);
      count += edges.length / 4;
    }
    nodePayloads.push(payload);
  }
  if (count > maxTexels) throw new RangeError("Vector clip storage exceeds texture capacity.");
  // Reserve every unique unindexed payload first. An earlier index must never
  // consume the room needed by a later clip that the original layout could fit.
  for (const payload of payloads) {
    const original = payload.edges.length / 4;
    const fullCells = options.cells && !payload.rectangle ? buildClipCells(payload.edges) : null;
    const capacity = maxTexels - count + original;
    if (fullCells && clipCellTexels(fullCells) <= capacity) {
      payload.cells = fullCells;
      count += clipCellTexels(fullCells) - original;
      continue;
    }
    const bands = payload.rectangle ? null : buildClipBands(payload.edges);
    const extra = bands ? 1 + bands.counts.length + bands.entries - original : 0;
    // Keep the existing band fallback when it fits: a very coarse cell grid
    // may have longer candidate lists than bands. Coarsen only to avoid a
    // complete edge scan when neither the full cell index nor bands fit.
    if (bands && count + extra <= maxTexels) { payload.bands = bands; count += extra; continue; }
    const cells = fullCells ? fitClipCells(fullCells, capacity) : null;
    if (cells) {
      payload.cells = cells; payload.coarsened = true;
      count += clipCellTexels(cells) - original;
    }
  }
  const data = new Float32Array(Math.max(1, count) * 4);
  let edgeOffset = clips.length;
  for (const payload of payloads) {
    const { edges, bands, cells } = payload;
    payload.offset = edgeOffset;
    if (cells) {
      edgeOffset = packClipCells(data, edgeOffset, cells);
      continue;
    }
    if (!bands) {
      data.set(edges, edgeOffset * 4);
      edgeOffset += edges.length / 4;
      continue;
    }
    const bandCount = bands.counts.length, table = edgeOffset + 1;
    data.set([table, bands.minY, bands.height, bandCount], edgeOffset * 4);
    edgeOffset = table + bandCount;
    for (let band = 0; band < bandCount; band++) {
      const entries = bands.counts[band];
      data.set([edgeOffset, entries, 0, 0], (table + band) * 4);
      bands.counts[band] = edgeOffset; // Reuse the counts as write cursors.
      edgeOffset += entries;
    }
    for (let offset = 0; offset < edges.length; offset += 4) {
      const y0 = edges[offset + 1], y1 = edges[offset + 3];
      const first = Math.max(0, clipBandRow(Math.min(y0, y1), bands.minY, bands.height, bandCount) - 1);
      const last = Math.min(bandCount - 1, clipBandRow(Math.max(y0, y1), bands.minY, bands.height, bandCount) + 1);
      for (let band = first; band <= last; band++) {
        const target = bands.counts[band]++ * 4;
        for (let channel = 0; channel < 4; channel++) data[target + channel] = edges[offset + channel];
      }
    }
  }
  for (let index = 0; index < clips.length; index++) {
    const payload = nodePayloads[index];
    data.set([parents[index], payload.offset, payload.rectangle ? -1 : clips[index].edges.length / 4,
      clips[index].fillRule + (payload.bands ? 2 : 0) + (payload.cells ? 4 : 0)], index * 4);
  }
  if (options.onStats) {
    options.onStats({ uniquePayloads: payloads.length, sharedPayloads: clips.length - payloads.length,
      rectangleNodes: nodePayloads.filter(payload => payload.rectangle).length,
      cellIndexedNodes: nodePayloads.filter(payload => payload.cells).length,
      bandIndexedNodes: nodePayloads.filter(payload => payload.bands).length,
      unindexedPolygonNodes: nodePayloads.filter(payload => !payload.rectangle && !payload.cells && !payload.bands).length,
      coarsenedCellNodes: nodePayloads.filter(payload => payload.coarsened).length });
  }
  return data;
}

/** Writes a clip's cell index at `offset`, returning the next free texel. */
function packClipCells(data: Float32Array, offset: number, cells: VectorPathCells): number {
  const levelBase = offset + 2;
  let cell = levelBase + cells.levels.length;
  let piece = cell + cells.cellCount;
  let pair = piece + cells.pieceCount;
  data.set([levelBase, cells.levels.length, cells.cellSize, cells.levelStep], offset * 4);
  data.set([cells.originX, cells.originY, 0, 0], (offset + 1) * 4);
  cells.levels.forEach((grid, level) => {
    data.set([cell, grid.columns, grid.rows, 0], (levelBase + level) * 4);
    const firstPiece = piece, firstPair = pair;
    for (let local = 0; local < grid.columns * grid.rows; local++) {
      data.set([firstPiece + grid.cells[local * 4], grid.cells[local * 4 + 1],
        firstPair + grid.cells[local * 4 + 2], grid.cells[local * 4 + 3]], cell * 4);
      cell++;
    }
    for (let source = 0; source < grid.pieces.length; source += 8) {
      data.set([grid.pieces[source], grid.pieces[source + 1], grid.pieces[source + 4], grid.pieces[source + 5]], piece * 4);
      piece++;
    }
    data.set(grid.closures, pair * 4);
    pair += grid.closures.length / 4;
  });
  return pair;
}
