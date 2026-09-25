import type { VectorClipPath, VectorScene } from "./pdfVectorExtractor";

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

/**
 * One RGBA header [parent, offset, originalEdgeCount, flags] per original clip.
 * flags bit 0 is the fill rule; bit 1 selects horizontal-band polygon storage.
 * A negative edge count retains the rectangle [minX, minY, maxX, maxY] fast path.
 * An indexed offset points to [tableOffset, minY, bandHeight, bandCount], followed
 * by one [firstEdgeTexel, count, 0, 0] per band and contiguous unchanged edge vec4s.
 * Edges shared by bands are duplicated to keep a single texture fetch per edge.
 * Consecutive rectangle ancestors are intersected once, preserving node IDs.
 * The optional capacity bounds derived GPU storage; indexing falls back to the
 * original scan when it cannot fit. Canonical scene/HEP geometry is untouched.
 */
export function packVectorClips(clips: readonly VectorClipPath[] = [], maxTexels = MAX_VECTOR_CLIP_TEXELS): Float32Array {
  if (!Number.isSafeInteger(maxTexels) || maxTexels < 1 || maxTexels > MAX_VECTOR_CLIP_TEXELS) {
    throw new RangeError("Invalid vector clip texture capacity.");
  }
  const rawCount = clips.reduce((total, clip) => total + clip.edges.length / 4, clips.length);
  if (rawCount > MAX_VECTOR_CLIP_TEXELS) throw new RangeError("Vector clip storage exceeds its limit.");
  const rectangles: (ClipRectangle | undefined)[] = [];
  const parents = new Int32Array(clips.length);
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
    count += rectangle ? 1 : clip.edges.length / 4;
  }
  if (count > maxTexels) throw new RangeError("Vector clip storage exceeds texture capacity.");
  // Reserve every clip's unindexed payload first. An earlier index must never
  // consume the room needed by a later clip that the original layout could fit.
  const indexes: (ClipBands | null)[] = [];
  for (let index = 0; index < clips.length; index++) {
    const bands = rectangles[index] ? null : buildClipBands(clips[index].edges);
    const extra = bands ? 1 + bands.counts.length + bands.entries - clips[index].edges.length / 4 : 0;
    if (bands && count + extra <= maxTexels) { indexes.push(bands); count += extra; }
    else indexes.push(null);
  }
  const data = new Float32Array(Math.max(1, count) * 4);
  let edgeOffset = clips.length;
  for (let index = 0; index < clips.length; index++) {
    const clip = clips[index], rectangle = rectangles[index], bands = indexes[index];
    data.set([parents[index], edgeOffset, rectangle ? -1 : clip.edges.length / 4,
      clip.fillRule + (bands ? 2 : 0)], index * 4);
    if (!bands) {
      data.set(rectangle ?? clip.edges, edgeOffset * 4);
      edgeOffset += rectangle ? 1 : clip.edges.length / 4;
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
    for (let offset = 0; offset < clip.edges.length; offset += 4) {
      const y0 = clip.edges[offset + 1], y1 = clip.edges[offset + 3];
      const first = Math.max(0, clipBandRow(Math.min(y0, y1), bands.minY, bands.height, bandCount) - 1);
      const last = Math.min(bandCount - 1, clipBandRow(Math.max(y0, y1), bands.minY, bands.height, bandCount) + 1);
      for (let band = first; band <= last; band++) {
        const target = bands.counts[band]++ * 4;
        for (let channel = 0; channel < 4; channel++) data[target + channel] = clip.edges[offset + channel];
      }
    }
  }
  return data;
}
