import type { NativeGlyphPathCommand } from "./nativeFont";
import { PdfError, throwIfAborted } from "./nativeTypes";

export interface NativeGlyphStrokeStyle {
  /** Graphics-state CTM. PDF line widths and dashes are measured in this space. */
  readonly transform: ArrayLike<number>;
  readonly width: number;
  readonly lineCap: 0 | 1 | 2;
  readonly lineJoin: 0 | 1 | 2;
  readonly miterLimit: number;
  readonly dashArray: readonly number[];
  readonly dashPhase: number;
}

export interface NativeGlyphStrokeGeometry {
  readonly segmentsA: number[];
  readonly segmentsB: number[];
  readonly bounds: { minX: number; minY: number; maxX: number; maxY: number };
  readonly approximated: boolean;
}

/** Translation and paint color do not change a glyph's stroked silhouette. */
export function nativeGlyphStrokeCacheKey(font: number, glyph: number, transform: ArrayLike<number>,
  stroke: NativeGlyphStrokeStyle): string {
  return [font, glyph, ...Array.from({ length: 4 }, (_, i) => transform[i]),
    ...Array.from({ length: 4 }, (_, i) => stroke.transform[i]), stroke.width, stroke.lineCap,
    stroke.lineJoin, stroke.miterLimit, stroke.dashPhase, ...stroke.dashArray].join(":");
}

/** Keep the placement on the instance and retain the complete transformed pen. */
export function buildNativeGlyphStrokeAtOrigin(commands: readonly NativeGlyphPathCommand[],
  transform: ArrayLike<number>, stroke: NativeGlyphStrokeStyle, signal?: AbortSignal): NativeGlyphStrokeGeometry | null {
  return buildNativeGlyphStroke(commands, [transform[0], transform[1], transform[2], transform[3], 0, 0],
    { ...stroke, transform: [stroke.transform[0], stroke.transform[1], stroke.transform[2], stroke.transform[3], 0, 0] }, signal);
}

type Point = readonly [number, number];
interface Contour { points: Point[]; closed: boolean; hasSegment?: boolean; }

/**
 * Per-glyph bound on flattening work and on the stroke outline it produces.
 * Outlined display text in real documents reaches a little over two thousand
 * edges, so a tighter bound refuses ordinary headlines; the page-level
 * coordinate and path limits are what actually protect the frame's memory.
 */
const MAX_EDGES = 4096;
const MAX_INPUT_COMMANDS = 65536;
const MAX_CURVE_DEPTH = 20;
const EPSILON = 1e-12;

/**
 * Expands a glyph stroke into one nonzero-fill geometry. Rectangles and join/cap
 * contours all wind in the same direction: their overlaps form a union within
 * one fill, preserving holes and applying translucent paint only once.
 *
 * Curves are flattened to at most 0.01 page units of centerline error. The
 * result remains vector geometry at every zoom, within the glyph edge budget.
 */
export function buildNativeGlyphStroke(
  commands: readonly NativeGlyphPathCommand[],
  glyphTransform: ArrayLike<number>,
  stroke: NativeGlyphStrokeStyle,
  signal?: AbortSignal
): NativeGlyphStrokeGeometry | null {
  throwIfAborted(signal);
  if (commands.length > MAX_INPUT_COMMANDS) {
    throw new PdfError("resource-limit", "Glyph stroke has too many outline commands.", {
      details: { reason: "native-glyph-stroke-input-limit", limit: MAX_INPUT_COMMANDS }
    });
  }
  const ctm = matrix(stroke.transform);
  const glyph = matrix(glyphTransform);
  if (!Number.isFinite(stroke.width) || stroke.width <= 0) {
    throw unsupported("Device-dependent hairline glyph strokes require a raster fallback.");
  }
  if (![0, 1, 2].includes(stroke.lineCap) || ![0, 1, 2].includes(stroke.lineJoin) ||
      !Number.isFinite(stroke.miterLimit) || stroke.miterLimit < 1 ||
      !Number.isFinite(stroke.dashPhase)) {
    throw unsupported("Glyph stroke has an invalid line style.");
  }
  const determinant = ctm[0] * ctm[3] - ctm[1] * ctm[2];
  const scale = Math.hypot(ctm[0], ctm[1], ctm[2], ctm[3]);
  if (!Number.isFinite(scale) || Math.abs(determinant) <= EPSILON * scale * scale) {
    throw unsupported("A singular glyph stroke transform requires a raster fallback.");
  }
  const inverse = [ctm[3] / determinant, -ctm[1] / determinant,
    -ctm[2] / determinant, ctm[0] / determinant, 0, 0];
  inverse[4] = -inverse[0] * ctm[4] - inverse[2] * ctm[5];
  inverse[5] = -inverse[1] * ctm[4] - inverse[3] * ctm[5];
  const local = multiply(inverse, glyph);
  const radius = stroke.width / 2;
  const tolerance = Math.min(0.01 / scale, radius / 32);
  const contours: Contour[] = [];
  let current: Contour | null = null;
  let flattenedEdges = 0;
  let approximated = false;

  const append = (point: Point): void => {
    if (!current) throw unsupported("Glyph stroke contains a segment outside a contour.");
    current.hasSegment = true;
    if (same(current.points[current.points.length - 1], point)) return;
    if (++flattenedEdges > MAX_EDGES) throw complexity();
    current.points.push(point);
  };
  const flatten = (points: readonly Point[], depth = 0): void => {
    throwIfAborted(signal);
    const start = points[0];
    const end = points[points.length - 1];
    if (points.slice(1, -1).every(point => distanceToSegment(point, start, end) <= tolerance)) {
      append(end);
      return;
    }
    if (depth === MAX_CURVE_DEPTH) throw complexity();
    const left: Point[] = [start];
    const right: Point[] = [end];
    let row = [...points];
    while (row.length > 1) {
      row = row.slice(1).map((point, index) => midpoint(row[index], point));
      left.push(row[0]);
      right.push(row[row.length - 1]);
    }
    flatten(left, depth + 1);
    flatten(right.reverse(), depth + 1);
  };

  for (let index = 0; index < commands.length; index += 1) {
    if ((index & 0xff) === 0) throwIfAborted(signal);
    const command = commands[index];
    if (command.kind === "move") {
      current = { points: [transform(local, command.x, command.y)], closed: false };
      contours.push(current);
    } else if (command.kind === "close") {
      if (!current) throw unsupported("Glyph stroke closes a missing contour.");
      if (current.points.length > 1 && same(current.points[0], current.points.at(-1)!)) current.points.pop();
      current.closed = true;
      current.hasSegment = true;
      current = null;
    } else {
      if (!current) throw unsupported("Glyph stroke contains a segment outside a contour.");
      const end = transform(local, command.x, command.y);
      if (command.kind === "line") append(end);
      else {
        approximated = true;
        const start = current.points[current.points.length - 1];
        if (command.kind === "quadratic") {
          flatten([start, transform(local, command.controlX, command.controlY), end]);
        } else {
          flatten([start, transform(local, command.control1X, command.control1Y),
            transform(local, command.control2X, command.control2Y), end]);
        }
      }
    }
  }

  const segmentsA: number[] = [];
  const segmentsB: number[] = [];
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const polygon = (points: readonly Point[]): void => {
    if (points.length < 3) return;
    const pagePoints = points.map(point => transform(ctm, point[0], point[1]));
    let area = 0;
    for (let index = 0; index < pagePoints.length; index += 1) {
      const a = pagePoints[index];
      const b = pagePoints[(index + 1) % pagePoints.length];
      // Relative coordinates avoid cancellation for distant annotation glyphs.
      area += (a[0] - pagePoints[0][0]) * (b[1] - pagePoints[0][1]) -
        (a[1] - pagePoints[0][1]) * (b[0] - pagePoints[0][0]);
    }
    if (area === 0) return;
    if (area < 0) pagePoints.reverse();
    for (let index = 0; index < pagePoints.length; index += 1) {
      const a = pagePoints[index];
      const b = pagePoints[(index + 1) % pagePoints.length];
      if (same(a, b)) continue;
      if (segmentsA.length / 4 >= MAX_EDGES) throw complexity();
      segmentsA.push(a[0], a[1], b[0], b[1]);
      segmentsB.push(b[0], b[1], 0, 0);
      bounds.minX = Math.min(bounds.minX, a[0]);
      bounds.minY = Math.min(bounds.minY, a[1]);
      bounds.maxX = Math.max(bounds.maxX, a[0]);
      bounds.maxY = Math.max(bounds.maxY, a[1]);
    }
  };
  const arc = (center: Point, start: number, angle: number): void => {
    approximated = true;
    const step = Math.min(Math.PI / 4, 2 * Math.acos(Math.max(-1, 1 - tolerance / radius)));
    const count = Math.ceil(Math.abs(angle) / step);
    if (!Number.isFinite(count) || count > MAX_EDGES) throw complexity();
    const points: Point[] = [center];
    for (let index = 0; index <= count; index += 1) {
      const a = start + angle * index / count;
      points.push([center[0] + Math.cos(a) * radius, center[1] + Math.sin(a) * radius]);
    }
    polygon(points);
  };
  const join = (vertex: Point, before: Point, after: Point): void => {
    const cross = before[0] * after[1] - before[1] * after[0];
    const dot = before[0] * after[0] + before[1] * after[1];
    if (Math.abs(cross) <= EPSILON) {
      if (dot < 0 && stroke.lineJoin === 1) arc(vertex, 0, Math.PI * 2);
      return;
    }
    const side = cross > 0 ? -1 : 1;
    const a: Point = [vertex[0] - before[1] * radius * side, vertex[1] + before[0] * radius * side];
    const b: Point = [vertex[0] - after[1] * radius * side, vertex[1] + after[0] * radius * side];
    if (stroke.lineJoin === 1) {
      arc(vertex, Math.atan2(a[1] - vertex[1], a[0] - vertex[0]), Math.atan2(cross, dot));
    } else if (stroke.lineJoin === 0) {
      const distance = ((b[0] - a[0]) * after[1] - (b[1] - a[1]) * after[0]) / cross;
      const miter: Point = [a[0] + before[0] * distance, a[1] + before[1] * distance];
      if (Math.hypot(miter[0] - vertex[0], miter[1] - vertex[1]) <= stroke.miterLimit * radius) {
        polygon([vertex, a, miter, b]);
      } else polygon([vertex, a, b]);
    } else polygon([vertex, a, b]);
  };
  const cap = (point: Point, direction: Point, start: boolean): void => {
    const outward: Point = start ? [-direction[0], -direction[1]] : direction;
    if (stroke.lineCap === 1) {
      arc(point, Math.atan2(outward[1], outward[0]) - Math.PI / 2, Math.PI);
    } else if (stroke.lineCap === 2) {
      const normal: Point = [-direction[1] * radius, direction[0] * radius];
      polygon([[point[0] + normal[0], point[1] + normal[1]],
        [point[0] - normal[0], point[1] - normal[1]],
        [point[0] - normal[0] + outward[0] * radius, point[1] - normal[1] + outward[1] * radius],
        [point[0] + normal[0] + outward[0] * radius, point[1] + normal[1] + outward[1] * radius]]);
    }
  };

  const dash = normalizeDash(stroke.dashArray);
  for (const contour of contours) {
    throwIfAborted(signal);
    if (!contour.hasSegment) continue;
    if (contour.points.length === 1 && dash.length) {
      throw unsupported("Dashed zero-length glyph contours require a raster fallback.");
    }
    const fragments = dash.length ? dashContour(contour, dash, stroke.dashPhase, signal) : [contour];
    for (const fragment of fragments) {
      const { points, closed } = fragment;
      if (points.length === 1) {
        if (stroke.lineCap === 1) arc(points[0], 0, Math.PI * 2);
        else if (stroke.lineCap === 2) {
          cap(points[0], [1, 0], true);
          cap(points[0], [1, 0], false);
        }
        continue;
      }
      const directions: Point[] = [];
      const lengths: number[] = [];
      const count = closed ? points.length : points.length - 1;
      for (let index = 0; index < count; index += 1) {
        const a = points[index];
        const b = points[(index + 1) % points.length];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const direction: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
        directions.push(direction);
        lengths.push(length);
      }
      // Adjacent rectangles otherwise spend four edges per flattened curve
      // step, plus a join wedge. Merge safe steps into a continuous band. Its
      // shared end edges disappear, reducing smooth contours to two rails.
      const miters: Array<Point | null> = Array(points.length).fill(null);
      for (let index = closed ? 0 : 1; index < count; index += 1) {
        const previous = (index + count - 1) % count;
        const before = directions[previous];
        const after = directions[index];
        const dot = Math.max(-1, Math.min(1, before[0] * after[0] + before[1] * after[1]));
        const cross = before[0] * after[1] - before[1] * after[0];
        if (dot <= -1 + EPSILON) continue;
        const distance = radius * Math.abs(cross) / (1 + dot);
        // Keep each shared cross-section inside both adjoining segments so
        // sharp reversals and very short edges cannot invert a stroke band.
        if (distance > Math.min(lengths[previous], lengths[index]) / 2) continue;
        const miterRatio = Math.sqrt(2 / (1 + dot));
        const exactMiter = stroke.lineJoin === 0 && miterRatio <= stroke.miterLimit;
        // A miter beyond its limit becomes a bevel. Smooth subdivisions can
        // merge under the same error bound as explicit bevel/round joins.
        if (!exactMiter && 2 * radius * (miterRatio - 1) > tolerance) continue;
        if (!exactMiter && miterRatio > 1 + EPSILON) approximated = true;
        miters[index] = [-(before[1] + after[1]) * radius / (1 + dot),
          (before[0] + after[0]) * radius / (1 + dot)];
      }
      const startIndex = closed ? Math.max(0, miters.findIndex(value => value === null)) : 0;
      let left: Point[] = [];
      let right: Point[] = [];
      for (let step = 0; step < count; step += 1) {
        const index = (startIndex + step) % count;
        const next = (index + 1) % points.length;
        const normal: Point = [-directions[index][1] * radius, directions[index][0] * radius];
        const startOffset = miters[index] ?? normal;
        const endOffset = miters[next] ?? normal;
        if (!left.length) {
          left.push([points[index][0] + startOffset[0], points[index][1] + startOffset[1]]);
          right.push([points[index][0] - startOffset[0], points[index][1] - startOffset[1]]);
        }
        left.push([points[next][0] + endOffset[0], points[next][1] + endOffset[1]]);
        right.push([points[next][0] - endOffset[0], points[next][1] - endOffset[1]]);
        if (miters[next] === null || step === count - 1) {
          polygon([...left, ...right.reverse()]);
          left = [];
          right = [];
        }
      }
      for (let index = closed ? 0 : 1; index < count; index += 1) {
        if (miters[index] === null) {
          join(points[index], directions[(index + count - 1) % count], directions[index]);
        }
      }
      if (!closed) {
        cap(points[0], directions[0], true);
        cap(points[points.length - 1], directions[directions.length - 1], false);
      }
    }
  }
  return segmentsA.length ? { segmentsA, segmentsB, bounds, approximated } : null;
}

function normalizeDash(input: readonly number[]): readonly number[] {
  if (input.length > MAX_EDGES) throw complexity();
  if (!input.length) return input;
  if (input.some(value => !Number.isFinite(value) || value < 0)) {
    throw unsupported("Glyph stroke has an invalid dash pattern.");
  }
  const dash = input.length % 2 ? [...input, ...input] : [...input];
  const length = dash.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(length) || length <= 0) throw unsupported("Glyph stroke has an empty dash cycle.");
  return dash;
}

function dashContour(contour: Contour, dash: readonly number[], phase: number, signal?: AbortSignal): Contour[] {
  const cycle = dash.reduce((sum, value) => sum + value, 0);
  let offset = ((phase % cycle) + cycle) % cycle;
  let index = 0;
  while (offset > 0 && offset >= dash[index]) {
    offset -= dash[index];
    index = (index + 1) % dash.length;
  }
  let remaining = dash[index] - offset;
  const result: Contour[] = [];
  let active: Contour | null = null;
  let events = 0;
  const count = contour.closed ? contour.points.length : contour.points.length - 1;
  for (let segment = 0; segment < count; segment += 1) {
    const a = contour.points[segment];
    const b = contour.points[(segment + 1) % contour.points.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let position = 0;
    const pointAt = (value: number): Point => value === 0 ? a : value === length ? b :
      [a[0] + (b[0] - a[0]) * value / length, a[1] + (b[1] - a[1]) * value / length];
    while (position < length) {
      throwIfAborted(signal);
      if (++events > MAX_EDGES) throw complexity();
      const painted = index % 2 === 0;
      const step = Math.min(remaining, length - position);
      if (painted) {
        if (!active) {
          active = { points: [pointAt(position)], closed: false };
          result.push(active);
        }
        if (step > 0) active.points.push(pointAt(position + step));
      } else if (step > 0) active = null;
      position += step;
      remaining -= step;
      if (remaining === 0) {
        index = (index + 1) % dash.length;
        remaining = dash[index];
      }
    }
  }
  if (contour.closed && result.length) {
    const first = result[0];
    const last = result[result.length - 1];
    if (same(first.points[0], contour.points[0]) && same(last.points[last.points.length - 1], contour.points[0])) {
      if (first === last) {
        first.points.pop();
        first.closed = true;
      } else {
        first.points = [...last.points, ...first.points.slice(1)];
        result.pop();
      }
    }
  }
  return result;
}

function matrix(value: ArrayLike<number>): number[] {
  if (value.length < 6) throw unsupported("Glyph stroke has an incomplete transform.");
  const result = Array.from({ length: 6 }, (_, index) => value[index]);
  if (result.some(item => !Number.isFinite(item))) throw unsupported("Glyph stroke has a non-finite transform.");
  return result;
}

function multiply(a: readonly number[], b: readonly number[]): number[] {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

function transform(m: readonly number[], x: number, y: number): Point {
  const point: Point = [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) throw unsupported("Glyph stroke has non-finite coordinates.");
  return point;
}

function same(a: Point, b: Point): boolean { return Math.hypot(a[0] - b[0], a[1] - b[1]) <= EPSILON; }
function midpoint(a: Point, b: Point): Point { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function unsupported(message: string): PdfError {
  return new PdfError("unsupported-content", message, { details: { reason: "native-glyph-stroke" } });
}
function complexity(): PdfError {
  return new PdfError("unsupported-content", `Glyph stroke exceeds the renderer's ${MAX_EDGES}-edge budget.`, {
    details: { reason: "native-glyph-stroke-complexity", limit: MAX_EDGES }
  });
}
