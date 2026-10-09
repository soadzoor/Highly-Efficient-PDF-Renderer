import type { DensePdfBounds, DensePdfMatrix, DensePdfTextClip } from "./nativeContentCompiler";
import type { VectorClipPath } from "../pdfVectorExtractor";
import { MAX_VECTOR_CLIP_DEPTH, MAX_VECTOR_CLIP_EDGES, MAX_VECTOR_CLIP_PATH_EDGES,
  MAX_VECTOR_CLIP_TEXELS, requiredVectorClipTexels } from "../vectorClips";
import { PdfError, throwIfAborted, type PdfDiagnostic } from "./nativeTypes";

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
    if (!clip) return page;
    let result = rooted.get(clip);
    if (!result) rooted.set(clip, result = { ...clip, parent: under(clip.parent) });
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
/**
 * A clip whose curves outgrow MAX_VECTOR_CLIP_EDGES flattens again at a 4x
 * coarser tolerance, up to about 0.1 point. That still beats what refusing it
 * leads to: a whole-page raster at twice the page size has half-point pixels.
 */
const MAX_CLIP_CURVE_TOLERANCE = CLIP_CURVE_TOLERANCE * 4 ** 5;

interface FlattenedVectorClip {
  readonly edges: number[];
  /** The edges stopped at their bounded representation limit; the path is incomplete. */
  readonly overflow: boolean;
  /** A curve took more than its chord, so a coarser tolerance needs fewer edges. */
  readonly subdivided: boolean;
  readonly curves: boolean;
}

function flattenVectorClip(path: DensePdfTextClip["path"], tolerance: number, signal?: AbortSignal,
  edgeLimit = MAX_VECTOR_CLIP_EDGES): FlattenedVectorClip {
  const edges: number[] = [];
  const data = path.data;
  const [a, b, c, d, e, f] = path.transform;
  const point = (offset: number): [number, number] => [
    a * data[offset] + c * data[offset + 1] + e, b * data[offset] + d * data[offset + 1] + f
  ];
  let x = 0, y = 0, sx = 0, sy = 0, open = false, overflow = false, subdivided = false, curves = false;
  let subpathEdgeStart = 0;
  const line = (nx: number, ny: number): void => {
    if (x === nx && y === ny) return;
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
    if (edges.length >= edgeLimit * 4) { overflow = true; return; }
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
    x3: number, y3: number, level = 0): void => {
    if (overflow) return;
    // Distance to the endpoint segment bounds the complete Bezier control hull.
    const distance = (px: number, py: number): number => {
      const dx = x3 - x0, dy = y3 - y0;
      const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(px - x0 - t * dx, py - y0 - t * dy);
    };
    if (Math.max(distance(x1, y1), distance(x2, y2)) <= tolerance) { line(x3, y3); return; }
    if (level >= 20) throw new PdfError("unsupported-content", "A vector clip curve exceeds its subdivision limit.",
      { details: { reason: "vector-clip-curve-limit" } });
    subdivided = true;
    const ax = (x0 + x1) / 2, ay = (y0 + y1) / 2, bx = (x1 + x2) / 2, by = (y1 + y2) / 2;
    const cx = (x2 + x3) / 2, cy = (y2 + y3) / 2, dx = (ax + bx) / 2, dy = (ay + by) / 2;
    const ex = (bx + cx) / 2, ey = (by + cy) / 2, mx = (dx + ex) / 2, my = (dy + ey) / 2;
    cubic(x0, y0, ax, ay, dx, dy, mx, my, level + 1);
    cubic(mx, my, ex, ey, cx, cy, x3, y3, level + 1);
  };
  let sourceWork = 0;
  for (let offset = 0; offset < data.length && !overflow;) {
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
  return { edges, overflow, subdivided, curves };
}

/** Clip curves use a bounded vector approximation; painted glyphs/paths stay untouched. */
export class NativeVectorClipBuilder {
  readonly paths: VectorClipPath[] = [];
  approximatedCurves = false;
  /** Clips flattened coarser than usual to fit their edge budget, and the coarsest tolerance used. */
  coarsenedClipCount = 0;
  coarsestCurveTolerance = CLIP_CURVE_TOLERANCE;
  private readonly ids = new Map<DensePdfTextClip, number>();
  private readonly shapes = new Map<string, number>();
  private texelCount = 0;

  add(clip: DensePdfTextClip | null | undefined, signal?: AbortSignal, depth = 0): number | undefined {
    if (!clip) return undefined;
    throwIfAborted(signal);
    if (depth >= MAX_VECTOR_CLIP_DEPTH) throw new PdfError("resource-limit", "Vector clip nesting exceeds its limit.");
    const existing = this.ids.get(clip);
    if (existing !== undefined) return existing;
    const parent = this.add(clip.parent, signal, depth + 1) ?? -1;
    let tolerance = CLIP_CURVE_TOLERANCE;
    let flattened = flattenVectorClip(clip.path, tolerance, signal, MAX_VECTOR_CLIP_PATH_EDGES);
    if (flattened.curves) this.approximatedCurves = true;
    while (flattened.overflow || (flattened.curves && flattened.edges.length > MAX_VECTOR_CLIP_EDGES * 4)) {
      // Without subdivided curves the edges are already as few as the path allows.
      if (!flattened.subdivided || tolerance >= MAX_CLIP_CURVE_TOLERANCE) throw new PdfError("unsupported-content",
        "A vector clip exceeds the bounded edge representation.", { details: { reason: "vector-clip-edge-limit" } });
      tolerance *= 4;
      flattened = flattenVectorClip(clip.path, tolerance, signal);
    }
    const packedEdges = Float32Array.from(flattened.edges);
    const payloadTexels = requiredVectorClipTexels(packedEdges);
    if (payloadTexels === null) {
      throw new PdfError("unsupported-content", "A vector clip exceeds the bounded edge representation.",
        { details: { reason: "vector-clip-edge-limit" } });
    }
    const shapeKey = `${parent}:${clip.fillRule}:${packedEdges.join(",")}`;
    const sameShape = this.shapes.get(shapeKey);
    if (sameShape !== undefined) { this.ids.set(clip, sameShape); return sameShape; }
    const index = this.paths.length;
    this.texelCount += 1 + payloadTexels;
    if (this.texelCount > MAX_VECTOR_CLIP_TEXELS) {
      throw new PdfError("resource-limit", "Vector clip storage exceeds its limit.");
    }
    if (tolerance > CLIP_CURVE_TOLERANCE) {
      this.coarsenedClipCount++;
      this.coarsestCurveTolerance = Math.max(this.coarsestCurveTolerance, tolerance);
    }
    this.paths.push({ parent, fillRule: clip.fillRule, edges: packedEdges });
    this.shapes.set(shapeKey, index);
    this.ids.set(clip, index);
    return index;
  }

  /** Names the clips whose curves needed a coarser tolerance than the usual one, if any. */
  coarseningDiagnostic(pageIndex: number): PdfDiagnostic | undefined {
    if (this.coarsenedClipCount === 0) return undefined;
    return { code: "clip-curve-coarsened", severity: "warning", pageIndex,
      message: `${this.coarsenedClipCount} curved clip boundar${this.coarsenedClipCount === 1 ? "y" : "ies"} ` +
        `exceeded ${MAX_VECTOR_CLIP_EDGES} vector edges at a ${CLIP_CURVE_TOLERANCE}-point subdivision tolerance; ` +
        `they use up to ${Number(this.coarsestCurveTolerance.toPrecision(3))} point, visible only at deep zoom.`,
      details: { clipCount: this.coarsenedClipCount, tolerance: this.coarsestCurveTolerance } };
  }
}
