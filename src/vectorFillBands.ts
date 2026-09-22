import type { VectorScene } from "./pdfVectorExtractor";

/**
 * Horizontal-band index over a fill path's segments.
 *
 * Analytic fill coverage asks two questions at every pixel: which side of the
 * path it lies on, and how far the nearest edge is. The first is answered by
 * casting a horizontal ray, so only segments whose y-range contains the pixel
 * can ever change the answer - every other segment in the path is loop
 * iterations and texture fetches spent proving it does not matter. The second
 * only decides anything within half a pixel of an edge, because coverage
 * saturates beyond that.
 *
 * Partitioning a path into horizontal bands answers both exactly: a pixel reads
 * the band holding its own row, widened by the antialiasing radius so the
 * nearest edge cannot be missed where it still affects coverage. A circle drawn
 * as a thousand dash quads goes from a thousand segments per pixel to a handful,
 * with identical output - the geometry is untouched, only the search over it.
 */
export interface VectorFillBandIndex {
  /** Four per fill path: band-table offset, band count, first band's y, band height. */
  readonly paths: Float32Array;
  /** Two per band: first entry and entry count in `segments`. */
  readonly bands: Uint32Array;
  /** Segment indices addressing the scene's fill segment stores, grouped by band. */
  readonly segments: Uint32Array;
}

/** Below this a path's whole segment list is already shorter than a band lookup. */
const MIN_INDEXED_SEGMENTS = 24;
/** Segments per band, traded against the index's own size. */
const TARGET_SEGMENTS_PER_BAND = 8;
const MAX_BANDS_PER_PATH = 512;
/**
 * A path whose segments each span most of its height lands in every band, so
 * the index would cost more than the search it replaces. Such a path keeps its
 * linear scan rather than paying for both.
 */
const MAX_ENTRIES_PER_SEGMENT = 4;

/**
 * A store of paths over shared segments, laid out as the fill and gradient-fill
 * stores both are: meta A holds each path's segment start, count and lower
 * bound, meta B its upper bound, and a segment is p0, p1, p2 with a curve flag.
 */
export interface VectorPathSegmentStore {
  readonly pathCount: number;
  readonly segmentCount: number;
  readonly pathMetaA: Float32Array;
  readonly pathMetaB: Float32Array;
  readonly segmentsA: Float32Array;
  readonly segmentsB: Float32Array;
}

export function vectorSceneFillStore(scene: VectorScene): VectorPathSegmentStore {
  return { pathCount: scene.fillPathCount, segmentCount: scene.fillSegmentCount,
    pathMetaA: scene.fillPathMetaA, pathMetaB: scene.fillPathMetaB,
    segmentsA: scene.fillSegmentsA, segmentsB: scene.fillSegmentsB };
}

export function vectorSceneGradientFillStore(scene: VectorScene): VectorPathSegmentStore {
  return { pathCount: scene.gradientFillPathCount, segmentCount: scene.gradientFillSegmentCount,
    pathMetaA: scene.gradientFillPathMetaA, pathMetaB: scene.gradientFillPathMetaB,
    segmentsA: scene.gradientFillSegmentsA, segmentsB: scene.gradientFillSegmentsB };
}

const fillIndexes = new WeakMap<VectorScene, VectorFillBandIndex | null>();
const gradientIndexes = new WeakMap<VectorScene, VectorFillBandIndex | null>();

/** Cached per scene; null when no path in the store is worth indexing. */
export function vectorFillBandIndex(scene: VectorScene): VectorFillBandIndex | null {
  const cached = fillIndexes.get(scene);
  if (cached !== undefined) return cached;
  const result = buildVectorFillBandIndex(vectorSceneFillStore(scene));
  fillIndexes.set(scene, result);
  return result;
}

export function vectorGradientFillBandIndex(scene: VectorScene): VectorFillBandIndex | null {
  const cached = gradientIndexes.get(scene);
  if (cached !== undefined) return cached;
  const result = buildVectorFillBandIndex(vectorSceneGradientFillStore(scene));
  gradientIndexes.set(scene, result);
  return result;
}

export function buildVectorFillBandIndex(store: VectorPathSegmentStore): VectorFillBandIndex | null {
  const pathCount = store.pathCount;
  const metaA = store.pathMetaA, metaB = store.pathMetaB;
  const segmentsA = store.segmentsA, segmentsB = store.segmentsB;
  if (!pathCount || !metaA || !metaB || !segmentsA || !segmentsB) return null;
  const paths = new Float32Array(pathCount * 4);
  const bandCounts = new Int32Array(pathCount);
  let totalBands = 0, totalEntries = 0, indexed = 0;
  // A quadratic stays inside its control hull, so the hull's vertical extent
  // bounds the curve's without evaluating it.
  const extent = (segment: number): [number, number] => {
    const a = segment * 4, b = segment * 4;
    const y0 = segmentsA[a + 1], y2 = segmentsB[b + 1];
    if (segmentsB[b + 2] < 1) return [Math.min(y0, y2), Math.max(y0, y2)];
    const y1 = segmentsA[a + 3];
    return [Math.min(y0, y1, y2), Math.max(y0, y1, y2)];
  };
  for (let path = 0; path < pathCount; path++) {
    const start = metaA[path * 4], count = metaA[path * 4 + 1];
    const minY = metaA[path * 4 + 3], maxY = metaB[path * 4 + 1];
    const height = maxY - minY;
    if (count < MIN_INDEXED_SEGMENTS || !(height > 0) || !Number.isFinite(height)) continue;
    let bands = Math.min(MAX_BANDS_PER_PATH, Math.max(1, Math.round(count / TARGET_SEGMENTS_PER_BAND)));
    let entries = 0;
    while (bands > 1) {
      entries = 0;
      const bandHeight = height / bands;
      for (let segment = start; segment < start + count; segment++) {
        const [low, high] = extent(segment);
        const first = Math.max(0, Math.min(bands - 1, Math.floor((low - minY) / bandHeight)));
        const last = Math.max(0, Math.min(bands - 1, Math.floor((high - minY) / bandHeight)));
        entries += last - first + 1;
      }
      if (entries <= count * MAX_ENTRIES_PER_SEGMENT) break;
      bands = Math.floor(bands / 2);
    }
    // Bands only pay for themselves when a row examines substantially less than
    // the path. Segments that each span its whole height land in every band, so
    // the search is no shorter and the index is pure overhead.
    if (bands <= 1 || entries / bands >= count / 2) continue;
    bandCounts[path] = bands;
    paths.set([totalBands, bands, minY, height / bands], path * 4);
    totalBands += bands;
    totalEntries += entries;
    indexed++;
  }
  if (!indexed) return null;
  const bands = new Uint32Array(totalBands * 2);
  const segments = new Uint32Array(totalEntries);
  // Counting sort: tally each band, turn the tallies into offsets, then place.
  for (let path = 0; path < pathCount; path++) {
    const bandCount = bandCounts[path];
    if (!bandCount) continue;
    const start = metaA[path * 4], count = metaA[path * 4 + 1];
    const table = paths[path * 4], minY = paths[path * 4 + 2], bandHeight = paths[path * 4 + 3];
    const bandOf = (y: number): number =>
      Math.max(0, Math.min(bandCount - 1, Math.floor((y - minY) / bandHeight)));
    for (let segment = start; segment < start + count; segment++) {
      const [low, high] = extent(segment);
      for (let band = bandOf(low); band <= bandOf(high); band++) bands[(table + band) * 2 + 1]++;
    }
  }
  let cursor = 0;
  for (let band = 0; band < totalBands; band++) {
    bands[band * 2] = cursor;
    cursor += bands[band * 2 + 1];
    bands[band * 2 + 1] = 0;
  }
  for (let path = 0; path < pathCount; path++) {
    const bandCount = bandCounts[path];
    if (!bandCount) continue;
    const start = metaA[path * 4], count = metaA[path * 4 + 1];
    const table = paths[path * 4], minY = paths[path * 4 + 2], bandHeight = paths[path * 4 + 3];
    const bandOf = (y: number): number =>
      Math.max(0, Math.min(bandCount - 1, Math.floor((y - minY) / bandHeight)));
    for (let segment = start; segment < start + count; segment++) {
      const [low, high] = extent(segment);
      for (let band = bandOf(low); band <= bandOf(high); band++) {
        const entry = (table + band) * 2;
        segments[bands[entry] + bands[entry + 1]++] = segment;
      }
    }
  }
  return { paths, bands, segments };
}

/**
 * The segments a pixel row has to examine, given the antialiasing radius that
 * still changes its coverage. Shared with the shaders' band arithmetic so the
 * selection they make is the one the tests check.
 */
export function vectorFillBandSegments(index: VectorFillBandIndex, path: number,
  y: number, radius: number): number[] {
  const table = index.paths[path * 4], bandCount = index.paths[path * 4 + 1];
  const minY = index.paths[path * 4 + 2], bandHeight = index.paths[path * 4 + 3];
  if (bandCount <= 0) return [];
  const bandOf = (value: number): number =>
    Math.max(0, Math.min(bandCount - 1, Math.floor((value - minY) / bandHeight)));
  const result: number[] = [];
  for (let band = bandOf(y - radius); band <= bandOf(y + radius); band++) {
    const entry = (table + band) * 2;
    for (let offset = 0; offset < index.bands[entry + 1]; offset++) result.push(index.segments[index.bands[entry] + offset]);
  }
  return result;
}

export interface PackedVectorFillBands {
  /** Texels appended after the path's segments, four floats each. */
  readonly data: Float32Array;
  /** Texel index, relative to the segment store, of the per-path records. */
  readonly pathBase: number;
  /** Texel index of the packed entry list, four segment indices per texel. */
  readonly entryBase: number;
  readonly texels: number;
}

/**
 * Lays the index out as texels that follow a path store's own segments, so it
 * travels in the texture the shader already samples and costs no further
 * sampler unit - the scarce resource in these programs.
 *
 * Per path: (first band texel, band count, first band's y, band height), with
 * a zero band count meaning the path keeps its linear scan. Per band: (first
 * entry, entry count). Then the entries themselves, packed four to a texel.
 */
export function packVectorFillBands(index: VectorFillBandIndex, segmentCount: number): PackedVectorFillBands {
  const pathCount = index.paths.length / 4;
  const bandCount = index.bands.length / 2;
  const entryTexels = Math.ceil(index.segments.length / 4);
  const pathBase = segmentCount;
  const bandBase = pathBase + pathCount;
  const entryBase = bandBase + bandCount;
  const texels = pathCount + bandCount + entryTexels;
  const data = new Float32Array(texels * 4);
  for (let path = 0; path < pathCount; path++) {
    const offset = path * 4;
    // Absolute texel indices spare the shader a second base uniform.
    data[offset] = index.paths[offset + 1] > 0 ? bandBase + index.paths[offset] : 0;
    data[offset + 1] = index.paths[offset + 1];
    data[offset + 2] = index.paths[offset + 2];
    data[offset + 3] = index.paths[offset + 3];
  }
  for (let band = 0; band < bandCount; band++) {
    const offset = (pathCount + band) * 4;
    data[offset] = index.bands[band * 2];
    data[offset + 1] = index.bands[band * 2 + 1];
  }
  for (let entry = 0; entry < index.segments.length; entry++) {
    data[(pathCount + bandCount) * 4 + entry] = index.segments[entry];
  }
  return { data, pathBase, entryBase, texels };
}
