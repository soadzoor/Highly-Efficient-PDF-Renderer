import type { DensePdfBounds, DensePdfMatrix, DensePdfTextClip } from "./nativeContentCompiler";
import type { VectorClipPath } from "../pdfVectorExtractor";
import { PdfError, throwIfAborted } from "./nativeTypes";

export function rectangleVectorClip(bounds: Readonly<DensePdfBounds>, transform: DensePdfMatrix,
  parent: DensePdfTextClip | null): DensePdfTextClip {
  const { minX, minY, maxX, maxY } = bounds;
  return { parent, fillRule: 0, path: { data: new Float32Array([
    0, minX, minY, 1, maxX, minY, 1, maxX, maxY, 1, minX, maxY, 4
  ]), transform, bounds } };
}

/**
 * Re-roots clip chains under the page rectangle, so content past the crop
 * box is cut at the page edge. Each re-rooted node is shared, so a chain
 * that many runs use is still flattened once.
 */
export function pageRootedVectorClips(pageBounds: Readonly<DensePdfBounds>): (clip: DensePdfTextClip | null) => DensePdfTextClip {
  const page = rectangleVectorClip(pageBounds, [1, 0, 0, 1, 0, 0], null);
  const rooted = new WeakMap<DensePdfTextClip, DensePdfTextClip>();
  const under = (clip: DensePdfTextClip | null): DensePdfTextClip => {
    const chain: DensePdfTextClip[] = [];
    const visited = new Set<DensePdfTextClip>();
    let result = page;
    for (let node = clip; node; node = node.parent) {
      const existing = rooted.get(node);
      if (existing) { result = existing; break; }
      if (visited.has(node)) throw new PdfError("invalid-object", "Cyclic vector clip chain.");
      visited.add(node); chain.push(node);
    }
    for (let index = chain.length - 1; index >= 0; index--) {
      const node = chain[index];
      result = { ...node, parent: result };
      rooted.set(node, result);
    }
    return result;
  };
  return under;
}

/** Whether a unit-square image placed by `matrix` reaches past the page bounds. */
export function imageLeavesPage(matrix: ArrayLike<number>, pageBounds: Readonly<DensePdfBounds>): boolean {
  const [a, b, c, d, e, f] = Array.from({ length: 6 }, (_, index) => matrix[index]);
  const xs = [e, a + e, c + e, a + c + e], ys = [f, b + f, d + f, b + d + f];
  return Math.min(...xs) < pageBounds.minX - 1e-3 || Math.min(...ys) < pageBounds.minY - 1e-3 ||
    Math.max(...xs) > pageBounds.maxX + 1e-3 || Math.max(...ys) > pageBounds.maxY + 1e-3;
}

/** Geometry at the crop boundary still needs a clip for its outward shader AA. */
export function vectorPaintReachesPageEdge(minX: number, minY: number, maxX: number, maxY: number,
  pageBounds: Readonly<DensePdfBounds>): boolean {
  return minX <= pageBounds.minX + 1e-3 || minY <= pageBounds.minY + 1e-3 ||
    maxX >= pageBounds.maxX - 1e-3 || maxY >= pageBounds.maxY - 1e-3;
}

/** A source clip contained in the page already trims a path's outward AA. */
export function clipChainInsidePage(clip: DensePdfTextClip | null | undefined,
  pageBounds: Readonly<DensePdfBounds>): boolean {
  for (let node = clip; node; node = node.parent) {
    const { minX, minY, maxX, maxY } = node.path.bounds;
    const [a, b, c, d, e, f] = node.path.transform;
    let inside = true;
    for (let corner = 0; corner < 4; corner++) {
      const x = corner & 1 ? maxX : minX, y = corner & 2 ? maxY : minY;
      const px = a * x + c * y + e, py = b * x + d * y + f;
      inside &&= px >= pageBounds.minX && py >= pageBounds.minY && px <= pageBounds.maxX && py <= pageBounds.maxY;
    }
    if (inside) return true;
  }
  return false;
}

/** Clip curves flatten within this many points, which stays subpixel at the viewer's deepest zoom. */
const CLIP_CURVE_TOLERANCE = 0.0001;
interface FlattenedVectorClip {
  readonly edges: number[];
  readonly curves: boolean;
  readonly precisionLimitedCurves: boolean;
}

function flattenVectorClip(path: DensePdfTextClip["path"], tolerance: number, signal?: AbortSignal): FlattenedVectorClip {
  const edges: number[] = [];
  const data = path.data;
  const [a, b, c, d, e, f] = path.transform;
  const point = (offset: number): [number, number] => {
    const x = a * data[offset] + c * data[offset + 1] + e;
    const y = b * data[offset] + d * data[offset + 1] + f;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new PdfError("invalid-object", "Non-finite vector clip coordinates.");
    }
    return [x, y];
  };
  let x = 0, y = 0, sx = 0, sy = 0, open = false, curves = false;
  let precisionLimitedCurves = false, curveWork = 0;
  let subpathEdgeStart = 0;
  const line = (nx: number, ny: number): void => {
    if (x === nx && y === ny) return;
    if (![x, y, nx, ny].every(value => Number.isFinite(Math.fround(value)))) {
      throw new PdfError("invalid-object", "Non-finite vector clip coordinates.");
    }
    // Consecutive collinear edges have the same directed winding as their
    // endpoint chord, including partial or complete backtracking. Use exact
    // equality so simplification never changes a corner or a narrow hole.
    while (edges.length > subpathEdgeStart) {
      const last = edges.length - 4;
      const ax = edges[last], ay = edges[last + 1];
      if ((x - ax) * (ny - y) !== (y - ay) * (nx - x)) break;
      edges.length = last;
      x = ax; y = ay;
      if (x === nx && y === ny) return;
    }
    if ((edges.length & 1023) === 0) throwIfAborted(signal);
    edges.push(x, y, nx, ny); x = nx; y = ny;
  };
  const finishSubpath = (): void => {
    // The move point can lie in the middle of a straight boundary. Merge the
    // closing seam too, while keeping independent source contours separate.
    while (edges.length >= subpathEdgeStart + 8) {
      const first = subpathEdgeStart, last = edges.length - 4;
      const ax = edges[last], ay = edges[last + 1];
      const bx = edges[first], by = edges[first + 1];
      const cx = edges[first + 2], cy = edges[first + 3];
      if (edges[last + 2] !== bx || edges[last + 3] !== by ||
          (bx - ax) * (cy - by) !== (by - ay) * (cx - bx)) break;
      edges[first] = ax; edges[first + 1] = ay;
      edges.length = last;
      if (ax === cx && ay === cy) edges.splice(first, 4);
    }
  };
  const cubic = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number,
    x3: number, y3: number): void => {
    const pending = [[x0, y0, x1, y1, x2, y2, x3, y3]];
    while (pending.length) {
      if ((curveWork++ & 1023) === 0) throwIfAborted(signal);
      const current = pending.pop()!;
      const [x0, y0, x1, y1, x2, y2, x3, y3] = current;
      // These are points on the curve; its control hull may extend beyond
      // Float32 even when every rendered curve point remains representable.
      if (![x0, y0, x3, y3].every(value => Number.isFinite(Math.fround(value)))) {
        throw new PdfError("invalid-object", "Non-finite vector clip coordinates.");
      }
      // Distance to the endpoint segment bounds the complete Bezier control hull.
      const distance = (px: number, py: number): number => {
        const dx = x3 - x0, dy = y3 - y0;
        const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(px - x0 - t * dx, py - y0 - t * dy);
      };
      if (Math.max(distance(x1, y1), distance(x2, y2)) <= tolerance) { line(x3, y3); continue; }
      if (current[8] === 1) {
        // Subdivision rounded back to this same control polygon. Its chord is
        // the closest approximation further floating-point work can produce.
        precisionLimitedCurves = true;
        line(x3, y3);
        continue;
      }
      const ax = x0 / 2 + x1 / 2, ay = y0 / 2 + y1 / 2, bx = x1 / 2 + x2 / 2, by = y1 / 2 + y2 / 2;
      const cx = x2 / 2 + x3 / 2, cy = y2 / 2 + y3 / 2, dx = ax / 2 + bx / 2, dy = ay / 2 + by / 2;
      const ex = bx / 2 + cx / 2, ey = by / 2 + cy / 2, mx = dx / 2 + ex / 2, my = dy / 2 + ey / 2;
      const left = [x0, y0, ax, ay, dx, dy, mx, my], right = [mx, my, ex, ey, cx, cy, x3, y3];
      left.push(left.every((value, index) => value === current[index]) ? 1 : 0);
      right.push(right.every((value, index) => value === current[index]) ? 1 : 0);
      pending.push(right, left);
    }
  };
  let sourceWork = 0;
  for (let offset = 0; offset < data.length;) {
    // A long straight source path may now collapse to one stored edge.
    if ((sourceWork++ & 1023) === 0) throwIfAborted(signal);
    const op = data[offset++];
    if (op === 0) {
      if (open) { line(sx, sy); finishSubpath(); }
      subpathEdgeStart = edges.length;
      [x, y] = point(offset); sx = x; sy = y; offset += 2; open = true;
    } else if (op === 1) { line(...point(offset)); offset += 2; open = true; }
    else if (op === 2) {
      curves = true;
      cubic(x, y, ...point(offset), ...point(offset + 2), ...point(offset + 4)); offset += 6; open = true;
    } else if (op === 3) {
      curves = true;
      const [cx, cy] = point(offset), [nx, ny] = point(offset + 2);
      cubic(x, y, x + (cx - x) * 2 / 3, y + (cy - y) * 2 / 3,
        nx + (cx - nx) * 2 / 3, ny + (cy - ny) * 2 / 3, nx, ny); offset += 4; open = true;
    } else if (op === 4) {
      if (open) { line(sx, sy); finishSubpath(); }
      open = false; subpathEdgeStart = edges.length;
    }
    else throw new PdfError("invalid-object", "Invalid vector clip path operator.");
  }
  if (open) { line(sx, sy); finishSubpath(); }
  return { edges, curves, precisionLimitedCurves };
}

/** Clip curves use the usual subpixel tolerance regardless of their edge count. */
export class NativeVectorClipBuilder {
  readonly paths: VectorClipPath[] = [];
  approximatedCurves = false;
  precisionLimitedCurves = false;
  private readonly ids = new Map<DensePdfTextClip, number>();
  private readonly shapes = new Map<string, number>();
  add(clip: DensePdfTextClip | null | undefined, signal?: AbortSignal): number | undefined {
    if (!clip) return undefined;
    throwIfAborted(signal);
    const existing = this.ids.get(clip);
    if (existing !== undefined) return existing;
    const chain: DensePdfTextClip[] = [];
    const visited = new Set<DensePdfTextClip>();
    let parent = -1;
    for (let node: DensePdfTextClip | null = clip; node; node = node.parent) {
      throwIfAborted(signal);
      const known = this.ids.get(node);
      if (known !== undefined) { parent = known; break; }
      if (visited.has(node)) throw new PdfError("invalid-object", "Cyclic vector clip chain.");
      visited.add(node); chain.push(node);
    }
    for (let index = chain.length - 1; index >= 0; index--) parent = this.addNode(chain[index], parent, signal);
    return parent;
  }

  private addNode(clip: DensePdfTextClip, parent: number, signal?: AbortSignal): number {
    const flattened = flattenVectorClip(clip.path, CLIP_CURVE_TOLERANCE, signal);
    if (flattened.curves) this.approximatedCurves = true;
    if (flattened.precisionLimitedCurves) this.precisionLimitedCurves = true;
    const packedEdges = Float32Array.from(flattened.edges);
    if (!packedEdges.every(Number.isFinite)) throw new PdfError("invalid-object", "Non-finite vector clip coordinates.");
    const shapeKey = `${parent}:${clip.fillRule}:${packedEdges.join(",")}`;
    const sameShape = this.shapes.get(shapeKey);
    if (sameShape !== undefined) { this.ids.set(clip, sameShape); return sameShape; }
    const index = this.paths.length;
    this.paths.push({ parent, fillRule: clip.fillRule, edges: packedEdges });
    this.shapes.set(shapeKey, index);
    this.ids.set(clip, index);
    return index;
  }
}
