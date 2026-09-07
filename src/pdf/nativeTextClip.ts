import type { DensePdfBounds, DensePdfPagePath, DensePdfTextClip } from "./nativeContentCompiler";
import { throwIfAborted } from "./nativeTypes";

// Search-only proofs must never discard potentially visible ink. Curves,
// boundary contact, and unusually complex clips are conservatively retained.
const MAX_EDGES = 16_384;
const MAX_CLIP_DEPTH = 64;

export class NativeTextClipTester {
  private readonly edges = new Map<DensePdfPagePath, Float64Array | null>();

  isFullyOutside(bounds: Readonly<DensePdfBounds>, clip: DensePdfTextClip, signal?: AbortSignal): boolean {
    for (let node: DensePdfTextClip | null = clip, depth = 0;
      node !== null && depth < MAX_CLIP_DEPTH; node = node.parent, depth += 1) {
      throwIfAborted(signal);
      let edges = this.edges.get(node.path);
      if (edges === undefined) {
        edges = polygonEdges(node.path, signal);
        this.edges.set(node.path, edges);
      }
      if (edges && outsidePolygon(bounds, edges, node.fillRule, signal)) return true;
    }
    return false;
  }
}

function polygonEdges(path: DensePdfPagePath, signal?: AbortSignal): Float64Array | null {
  const edges: number[] = [];
  const [a, b, c, d, e, f] = path.transform;
  let x = 0, y = 0, startX = 0, startY = 0, open = false;
  const append = (nextX: number, nextY: number): void => {
    edges.push(x, y, nextX, nextY);
    x = nextX;
    y = nextY;
  };
  for (let offset = 0; offset < path.data.length;) {
    if ((edges.length & 0xfff) === 0) throwIfAborted(signal);
    if (edges.length >= MAX_EDGES * 4) return null;
    const verb = path.data[offset++];
    if (verb === 4) { // close
      if (open) append(startX, startY);
      open = false;
      continue;
    }
    if (verb !== 0 && verb !== 1) return null; // do not flatten curves for a visibility proof
    const px = path.data[offset++], py = path.data[offset++];
    const nextX = a * px + c * py + e, nextY = b * px + d * py + f;
    if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return null;
    if (verb === 0) {
      if (open) append(startX, startY); // PDF fills implicitly close subpaths
      x = startX = nextX;
      y = startY = nextY;
      open = true;
    } else {
      append(nextX, nextY);
      open = true;
    }
  }
  if (open) append(startX, startY);
  return Float64Array.from(edges);
}

function outsidePolygon(bounds: Readonly<DensePdfBounds>, edges: Float64Array,
  fillRule: 0 | 1, signal?: AbortSignal): boolean {
  const epsilon = 1e-7 * Math.max(1, Math.abs(bounds.minX), Math.abs(bounds.minY),
    Math.abs(bounds.maxX), Math.abs(bounds.maxY));
  const minX = bounds.minX - epsilon, minY = bounds.minY - epsilon;
  const maxX = bounds.maxX + epsilon, maxY = bounds.maxY + epsilon;
  const x = (minX + maxX) / 2, y = (minY + maxY) / 2;
  if (![minX, minY, maxX, maxY, x, y].every(Number.isFinite)) return false;
  let winding = 0;
  for (let offset = 0; offset < edges.length; offset += 4) {
    if ((offset & 0xfff) === 0) throwIfAborted(signal);
    const x0 = edges[offset], y0 = edges[offset + 1];
    const x1 = edges[offset + 2], y1 = edges[offset + 3];
    if (segmentTouchesBox(x0, y0, x1, y1, minX, minY, maxX, maxY)) return false;
    if ((y0 > y) !== (y1 > y)) {
      const crossing = x0 + (y - y0) / (y1 - y0) * (x1 - x0);
      if (!Number.isFinite(crossing)) return false;
      if (crossing > x) winding += y1 > y0 ? 1 : -1;
    }
  }
  // With no boundary intersecting this connected box, its center and every
  // possible ink point have the same membership, including holes/subpaths.
  return fillRule === 1 ? winding % 2 === 0 : winding === 0;
}

function segmentTouchesBox(x0: number, y0: number, x1: number, y1: number,
  minX: number, minY: number, maxX: number, maxY: number): boolean {
  let first = 0, last = 1;
  const dx = x1 - x0, dy = y1 - y0;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return true;
  if (dx === 0) {
    if (x0 < minX || x0 > maxX) return false;
  } else {
    const a = (minX - x0) / dx, b = (maxX - x0) / dx;
    first = Math.max(first, Math.min(a, b));
    last = Math.min(last, Math.max(a, b));
  }
  if (dy === 0) {
    if (y0 < minY || y0 > maxY) return false;
  } else {
    const a = (minY - y0) / dy, b = (maxY - y0) / dy;
    first = Math.max(first, Math.min(a, b));
    last = Math.min(last, Math.max(a, b));
  }
  return first <= last;
}
