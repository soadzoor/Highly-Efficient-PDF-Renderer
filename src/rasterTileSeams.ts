import type { RasterLayer, VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import type { ScenePaintNode } from "./scenePaintGraph";

export interface RasterTileSeamDescriptor {
  /** Shared geometry edges, minX/minY/maxX/maxY, in scene coordinates. */
  bounds: Float32Array;
  /** Original gap's full width at each corresponding geometry edge. */
  gaps: Float32Array;
  /** Shared per-axis footprint ceiling before farther gaps need legacy sampling. */
  maxFootprint: Float32Array;
}

interface Tile {
  index: number;
  order: number;
  bounds: [number, number, number, number];
  pitch: [number, number];
  pixels: Uint8Array;
  count: number;
}

interface Neighbors { left: Tile; right: Tile; axis: 0 | 1; gap: number; limit: number }

/**
 * Identify small gaps between opaque image neighbors without changing source
 * pixels or placement. Geometry may meet at the shared midpoint; the fragment
 * shader must integrate the original gap, using the original matrix edges and
 * these full widths. Fading both original edges independently would introduce
 * source-over seams even between tiles that touch.
 *
 * Neighbor discovery sorts exact perpendicular-range buckets, O(n log n).
 * Opacity scans only cover source-order intervals of geometric candidates;
 * unrelated photographs need no pixel scan. No source pixel data is copied.
 */
export function buildRasterTileSeams(scene: VectorScene, eligible: (index: number) => boolean = () => true): Map<number, RasterTileSeamDescriptor> {
  const result = new Map<number, RasterTileSeamDescriptor>();
  if (!scene.drawRuns) return result;
  const opacity = new WeakMap<Uint8Array, Map<number, boolean>>();
  let span: Tile[] = [];
  let previousRun: VectorDrawRun | undefined, previousCondition: number | undefined;
  let previousPage: number | undefined;
  const flush = (): void => {
    if (span.length > 1) {
      const pairs = [...findNeighbors(span, 0), ...findNeighbors(span, 1)];
      const intervals = pairs.map(pair => [Math.min(pair.left.order, pair.right.order),
        Math.max(pair.left.order, pair.right.order)]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const translucent: number[] = [];
      let next = 0;
      for (const [first, last] of intervals) {
        // Sorted overlapping intervals scan their union, once per source tile.
        for (let index = Math.max(first, next); index <= last; index++) {
          if (!isOpaque(span[index], opacity)) translucent.push(index);
        }
        next = Math.max(next, last + 1);
      }
      for (const pair of pairs) {
        const first = Math.min(pair.left.order, pair.right.order), last = Math.max(pair.left.order, pair.right.order);
        let lo = 0, hi = translucent.length;
        while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (translucent[mid] < first) lo = mid + 1; else hi = mid; }
        if (lo === translucent.length || translucent[lo] > last) connectNeighbors(pair, result);
      }
    }
    span = [];
    previousRun = undefined;
    previousCondition = undefined;
    previousPage = undefined;
  };
  const append = (run: VectorDrawRun | undefined, condition?: number): void => {
    if (!run || run.kind !== "raster" || run.clipIndex !== undefined || run.blendMode ||
        !Number.isSafeInteger(run.first) || !Number.isSafeInteger(run.count) || run.first < 0 || run.count < 1 ||
        run.first + run.count > scene.rasterLayers.length) { flush(); return; }
    if (previousRun && (previousRun.optionalContent !== run.optionalContent || previousCondition !== condition ||
        !sameRepresentation(previousRun, run))) flush();
    for (let index = run.first; index < run.first + run.count; index++) {
      const layer = scene.rasterLayers[index];
      const tile = eligible(index) ? eligibleTile(layer, index) : null;
      if (!tile) { flush(); continue; }
      if (previousPage !== undefined && previousPage !== layer.pageIndex) flush();
      tile.order = span.length; span.push(tile);
      previousRun = run;
      previousCondition = condition;
      previousPage = layer.pageIndex;
    }
  };
  if (scene.paintGraph) {
    // Each list is one leaf parent. Never bridge a group, retained paint, mask
    // or an ancestor whose opacity/blending changes the backdrop calculation.
    const stack: { nodes: readonly ScenePaintNode[]; next: number }[] = [{ nodes: scene.paintGraph.roots, next: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.next === frame.nodes.length) { flush(); stack.pop(); continue; }
      const node = frame.nodes[frame.next++];
      if (node.kind === "draw") append(scene.drawRuns[node.runIndex], node.optionalContent);
      else {
        flush();
        if (node.kind === "group" && node.alpha === 1 && node.blendMode === "Normal" &&
            !node.knockout && !node.softMask) stack.push({ nodes: node.children, next: 0 });
      }
    }
  } else {
    for (const run of scene.drawRuns) append(run);
    flush();
  }
  return result;
}

function sameRepresentation(a: VectorDrawRun, b: VectorDrawRun): boolean {
  const first = a.pdfRepresentation, second = b.pdfRepresentation;
  return first === second || !!first && !!second && first.pageIndex === second.pageIndex && first.detail === second.detail;
}

function eligibleTile(layer: RasterLayer | undefined, index: number): Tile | null {
  if (!layer || layer.repeat || layer.monochrome || layer.pageDemandSlot || (layer.opacity ?? 1) !== 1 ||
      !Number.isSafeInteger(layer.width) || !Number.isSafeInteger(layer.height) || layer.width < 1 || layer.height < 1 ||
      !(layer.matrix instanceof Float32Array) || layer.matrix.length !== 6 || !layer.matrix.every(Number.isFinite)) return null;
  const [a, b, c, d, e, f] = layer.matrix;
  const diagonal = b === 0 && c === 0 && a !== 0 && d !== 0;
  if (!diagonal && !(a === 0 && d === 0 && b !== 0 && c !== 0)) return null;
  const count = layer.width * layer.height * 4;
  if (!Number.isSafeInteger(count)) return null;
  // Packed/lazy images must not be expanded merely to discover neighbors.
  const pixels: unknown = Object.getOwnPropertyDescriptor(layer, "data")?.value;
  if (!(pixels instanceof Uint8Array) || pixels.length < count) return null;
  // Match highp Float32 vertex corner addition, including quarter turns and
  // reflections. Shared edges use these uploaded endpoints, not double sums.
  const x = Math.fround((diagonal ? a : c) + e), y = Math.fround((diagonal ? d : b) + f);
  const bounds: Tile["bounds"] = [Math.min(e, x), Math.min(f, y), Math.max(e, x), Math.max(f, y)];
  const pitch: Tile["pitch"] = diagonal ? [Math.abs(a) / layer.width, Math.abs(d) / layer.height]
    : [Math.abs(c) / layer.height, Math.abs(b) / layer.width];
  return bounds.every(Number.isFinite) && bounds[0] < bounds[2] && bounds[1] < bounds[3] &&
    pitch.every(value => value > 0 && Number.isFinite(value)) ? { index, order: 0, bounds, pitch, pixels, count } : null;
}

function isOpaque(tile: Tile, opacity: WeakMap<Uint8Array, Map<number, boolean>>): boolean {
  let lengths = opacity.get(tile.pixels);
  if (!lengths) { lengths = new Map(); opacity.set(tile.pixels, lengths); }
  let opaque = lengths.get(tile.count);
  if (opaque === undefined) {
    opaque = true;
    for (let offset = 3; offset < tile.count; offset += 4) if (tile.pixels[offset] !== 255) { opaque = false; break; }
    lengths.set(tile.count, opaque);
  }
  return opaque;
}

function findNeighbors(tiles: readonly Tile[], axis: 0 | 1): Neighbors[] {
  const pairs: Neighbors[] = [];
  const perpendicular = 1 - axis;
  const buckets = new Map<number, Map<number, Tile[]>>();
  for (const tile of tiles) {
    const min = tile.bounds[perpendicular], max = tile.bounds[perpendicular + 2];
    let ends = buckets.get(min);
    if (!ends) { ends = new Map(); buckets.set(min, ends); }
    let bucket = ends.get(max);
    if (!bucket) { bucket = []; ends.set(max, bucket); }
    bucket.push(tile);
  }
  for (const ends of buckets.values()) for (const bucket of ends.values()) {
    bucket.sort((a, b) => a.bounds[axis] - b.bounds[axis] || a.bounds[axis + 2] - b.bounds[axis + 2] || a.index - b.index);
    let limit = Infinity;
    for (const tile of bucket) limit = Math.min(limit, tile.bounds[axis + 2] - tile.bounds[axis]);
    // A contained rectangle must not create a false gap through a wider
    // predecessor. An overlap on the opposite edge does not disqualify an
    // otherwise empty neighboring gap.
    let end = bucket[0].bounds[axis + 2];
    for (let index = 1; index < bucket.length; index++) {
      const left = bucket[index - 1], right = bucket[index];
      const gap = right.bounds[axis] - left.bounds[axis + 2];
      const exposed = left.bounds[axis + 2] === end;
      end = Math.max(end, right.bounds[axis + 2]);
      if (!exposed || !(gap > 0) || gap > Math.min(left.pitch[axis], right.pitch[axis])) continue;
      pairs.push({ left, right, axis, gap, limit });
    }
  }
  return pairs;
}

function connectNeighbors({ left, right, axis, gap, limit }: Neighbors, result: Map<number, RasterTileSeamDescriptor>): void {
  const descriptor = (tile: Tile): RasterTileSeamDescriptor => {
    let value = result.get(tile.index);
    if (!value) {
      value = { bounds: Float32Array.from(tile.bounds), gaps: new Float32Array(4), maxFootprint: new Float32Array(2) };
      result.set(tile.index, value);
    }
    return value;
  };
  const midpoint = Math.fround(left.bounds[axis + 2] + gap * 0.5), width = Math.fround(gap);
  const a = descriptor(left), b = descriptor(right);
  a.bounds[axis + 2] = b.bounds[axis] = midpoint;
  a.gaps[axis + 2] = b.gaps[axis] = width;
  a.maxFootprint[axis] = b.maxFootprint[axis] = limit;
}
