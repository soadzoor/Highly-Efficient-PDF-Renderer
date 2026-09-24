import type { NativeGlyphPathCommand } from "./nativeFont";
import type { NativeGlyphStrokeStyle } from "./nativeGlyphStroke";
import { PdfError, throwIfAborted } from "./nativeTypes";

export interface NativeGlyphHairlineGeometry {
  readonly endpoints: number[];
  readonly primitiveMeta: number[];
  readonly primitiveBounds: number[];
  readonly bounds: { minX: number; minY: number; maxX: number; maxY: number };
  readonly approximated: boolean;
  /** Packed strokes approximate square caps and nonround joins at device-pixel width. */
  readonly approximateStyle: boolean;
}

type Point = readonly [number, number];
interface Contour { segments: Point[][]; start: Point; end: Point; closed: boolean; }
const MAX_COMMANDS = 65536;
const MAX_PRIMITIVES = 4096;
const MAX_WORK = 65536;
const MAX_DEPTH = 20;
const CURVE_ERROR = 0.01;
const HAIRLINE = 1;
const ROUND_CAP = 2;

/**
 * Retains width-zero glyph outlines as device-pixel strokes. Quadratics remain
 * exact; cubic conversion and dashed-curve flattening have bounded page-space
 * error. Dash lengths are measured in graphics-state space, independently of
 * the text matrix and font size. Alpha is initially one for the caller to paint.
 */
export function buildNativeGlyphHairline(
  commands: readonly NativeGlyphPathCommand[],
  glyphTransform: ArrayLike<number>,
  stroke: NativeGlyphStrokeStyle,
  signal?: AbortSignal
): NativeGlyphHairlineGeometry | null {
  throwIfAborted(signal);
  if (commands.length > MAX_COMMANDS) {
    throw new PdfError("resource-limit", "Hairline glyph has too many outline commands.", {
      details: { reason: "native-glyph-stroke-input-limit", limit: MAX_COMMANDS }
    });
  }
  if (stroke.width !== 0 || ![0, 1, 2].includes(stroke.lineCap) ||
      ![0, 1, 2].includes(stroke.lineJoin) || !Number.isFinite(stroke.miterLimit) ||
      stroke.miterLimit < 1 || !Number.isFinite(stroke.dashPhase)) {
    throw unsupported("Hairline glyph stroke has an invalid line style.");
  }
  const glyph = matrix(glyphTransform);
  const ctm = matrix(stroke.transform);
  const dash = normalizeDash(stroke.dashArray);
  const inverse = dash.length ? invert(ctm) : null;
  const local = inverse ? multiply(inverse, glyph) : glyph;
  const page = inverse ? ctm : [1, 0, 0, 1, 0, 0];
  const contours: Contour[] = [];
  let current: Contour | null = null;
  let segmentCount = 0;
  let work = 0;
  const checkpoint = (): void => {
    throwIfAborted(signal);
    if (++work > MAX_WORK) throw complexity();
  };
  const append = (points: Point[]): void => {
    if (!current) throw unsupported("Hairline glyph contains a segment outside a contour.");
    if (++segmentCount > MAX_PRIMITIVES) throw complexity();
    current.segments.push(points);
    current.end = points[points.length - 1];
  };
  for (const command of commands) {
    checkpoint();
    if (command.kind === "move") {
      const start = transform(local, command.x, command.y);
      current = { start, end: start, segments: [], closed: false };
      contours.push(current);
    } else if (command.kind === "close") {
      if (!current) throw unsupported("Hairline glyph closes a missing contour.");
      if (!same(current.end, current.start) || !current.segments.length) append([current.end, current.start]);
      current.closed = true;
      current = null;
    } else {
      if (!current) throw unsupported("Hairline glyph contains a segment outside a contour.");
      const end = transform(local, command.x, command.y);
      if (command.kind === "line") append([current.end, end]);
      else if (command.kind === "quadratic") {
        append([current.end, transform(local, command.controlX, command.controlY), end]);
      } else {
        append([current.end, transform(local, command.control1X, command.control1Y),
          transform(local, command.control2X, command.control2Y), end]);
      }
    }
  }

  const endpoints: number[] = [];
  const primitiveMeta: number[] = [];
  const primitiveBounds: number[] = [];
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  let approximated = false;
  let approximateStyle = false;
  const emit = (points: readonly Point[], round: boolean): void => {
    checkpoint();
    if (points.some(point => !point.every(value => Number.isFinite(Math.fround(value))))) {
      throw unsupported("Hairline glyph coordinates exceed the vector representation.");
    }
    const start = points[0];
    const end = points[points.length - 1];
    const control = points.length === 3 ? points[1] : end;
    if (same(start, end) && same(start, control) && !round) return;
    if (endpoints.length / 4 >= MAX_PRIMITIVES) throw complexity();
    const minX = Math.min(start[0], control[0], end[0]);
    const minY = Math.min(start[1], control[1], end[1]);
    const maxX = Math.max(start[0], control[0], end[0]);
    const maxY = Math.max(start[1], control[1], end[1]);
    endpoints.push(start[0], start[1], control[0], control[1]);
    primitiveMeta.push(end[0], end[1], points.length === 3 ? 1 : 0,
      1 + 2 * (HAIRLINE | (round ? ROUND_CAP : 0)));
    primitiveBounds.push(minX, minY, maxX, maxY);
    bounds.minX = Math.min(bounds.minX, minX);
    bounds.minY = Math.min(bounds.minY, minY);
    bounds.maxX = Math.max(bounds.maxX, maxX);
    bounds.maxY = Math.max(bounds.maxY, maxY);
  };
  const cubic = (points: readonly Point[], round: boolean, depth = 0): void => {
    checkpoint();
    const [a, b, c, d] = points;
    const control: Point = [(3 * (b[0] + c[0]) - a[0] - d[0]) / 4,
      (3 * (b[1] + c[1]) - a[1] - d[1]) / 4];
    const error = Math.max(
      Math.hypot((a[0] + 2 * control[0]) / 3 - b[0], (a[1] + 2 * control[1]) / 3 - b[1]),
      Math.hypot((d[0] + 2 * control[0]) / 3 - c[0], (d[1] + 2 * control[1]) / 3 - c[1]));
    if (error <= CURVE_ERROR) {
      emit([a, control, d], round);
      return;
    }
    if (depth >= MAX_DEPTH) throw complexity();
    const [left, right] = split(points);
    cubic(left, round, depth + 1);
    cubic(right, round, depth + 1);
  };

  const cycle = dash.reduce((sum, value) => sum + value, 0);
  const scale = Math.hypot(ctm[0], ctm[1], ctm[2], ctm[3]);
  const positiveDash = dash.filter(value => value > 0);
  const smallestDash = positiveDash.length ? Math.min(...positiveDash) : 0;
  const dashTolerance = dash.length ? Math.min(CURVE_ERROR / scale, smallestDash / 32) : 0;
  for (const contour of contours) {
    checkpoint();
    if (!contour.segments.length) continue;
    const hasJoins = contour.closed || contour.segments.length > 1;
    approximateStyle ||= hasJoins && stroke.lineJoin !== 1;
    approximateStyle ||= (!contour.closed || dash.length > 0) && stroke.lineCap === 2;
    if (!dash.length) {
      const degenerate = contour.segments.every(points => points.every(point => same(point, contour.start)));
      const round = (contour.closed && !degenerate) || stroke.lineCap !== 0;
      for (let index = 0; index < contour.segments.length; index += 1) {
        const points = contour.segments[index];
        if (points.length === 4) {
          approximated = true;
          cubic(points, round);
        } else emit(points, round);
        // A round point covers the join when open contours use butt caps.
        if (!round && index + 1 < contour.segments.length) {
          const end = points[points.length - 1];
          emit([end, end], true);
        }
      }
      continue;
    }

    let dashIndex = 0;
    let phase = ((stroke.dashPhase % cycle) + cycle) % cycle;
    while (phase > 0 && phase >= dash[dashIndex]) {
      checkpoint();
      phase -= dash[dashIndex];
      dashIndex = (dashIndex + 1) % dash.length;
    }
    let remaining = dash[dashIndex] - phase;
    const round = stroke.lineCap !== 0;
    let previousPaintedEnd: Point | null = null;
    let firstPaintedStart: Point | null = null;
    const advance = (): void => {
      dashIndex = (dashIndex + 1) % dash.length;
      remaining = dash[dashIndex];
    };
    const skipZero = (point: Point): void => {
      while (remaining === 0) {
        checkpoint();
        if (dashIndex % 2 === 0 && round) {
          const p = transform(page, point[0], point[1]);
          emit([p, p], true);
        }
        advance();
      }
    };
    const dashedLine = (a: Point, b: Point): void => {
      checkpoint();
      skipZero(a);
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      // Glyph transforms use the packed Float32 stores. Their rounding can
      // move an exact dash boundary a fraction of a coordinate ULP, creating
      // an extra round-cap dot. Snap only within that precision envelope and
      // a tiny fraction of both the shortest dash and this segment's length.
      const epsilon = Math.min(smallestDash * 1e-5, length * 1e-5, 2 ** -22 * Math.max(1, length));
      if (!Number.isFinite(length)) throw unsupported("Hairline glyph dash length is invalid.");
      const at = (distance: number): Point => distance === 0 ? a : distance === length ? b :
        [a[0] + (b[0] - a[0]) * distance / length, a[1] + (b[1] - a[1]) * distance / length];
      if (length === 0 && dashIndex % 2 === 0 && round) {
        const p = transform(page, a[0], a[1]);
        emit([p, p], true);
      }
      let position = 0;
      while (position < length - epsilon) {
        checkpoint();
        const span = Math.min(remaining, length - position);
        const next = position + span;
        if (next === position) throw complexity();
        if (dashIndex % 2 === 0) {
          const start = at(position);
          const end = at(next);
          if (!round && previousPaintedEnd && same(previousPaintedEnd, start)) {
            const join = transform(page, start[0], start[1]);
            emit([join, join], true);
          }
          emit([transform(page, start[0], start[1]), transform(page, end[0], end[1])], round);
          firstPaintedStart ??= start;
          previousPaintedEnd = end;
        } else previousPaintedEnd = null;
        position = next;
        remaining -= span;
        if (remaining <= epsilon) {
          remaining = 0;
          advance();
          skipZero(at(position));
        }
      }
    };
    const flatten = (points: readonly Point[], depth = 0): void => {
      checkpoint();
      const start = points[0];
      const end = points[points.length - 1];
      let polygonLength = 0;
      for (let index = 1; index < points.length; index += 1) {
        polygonLength += Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
      }
      const chord = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (polygonLength - chord <= dashTolerance &&
          points.slice(1, -1).every(point => distanceToSegment(point, start, end) <= dashTolerance)) {
        dashedLine(start, end);
        return;
      }
      if (depth >= MAX_DEPTH) throw complexity();
      const [left, right] = split(points);
      flatten(left, depth + 1);
      flatten(right, depth + 1);
    };
    for (const points of contour.segments) {
      if (points.length === 2) dashedLine(points[0], points[1]);
      else {
        approximated = true;
        flatten(points);
      }
    }
    if (contour.closed && !round && firstPaintedStart && previousPaintedEnd &&
        same(firstPaintedStart, contour.start) && same(previousPaintedEnd, contour.start)) {
      const join = transform(page, contour.start[0], contour.start[1]);
      emit([join, join], true);
    }
  }
  return endpoints.length ? { endpoints, primitiveMeta, primitiveBounds, bounds,
    approximated, approximateStyle } : null;
}

function normalizeDash(input: readonly number[]): number[] {
  if (input.length > MAX_PRIMITIVES) throw complexity();
  if (input.some(value => !Number.isFinite(value) || value < 0)) {
    throw unsupported("Hairline glyph stroke has an invalid dash pattern.");
  }
  if (!input.length) return [];
  const dash = input.length % 2 ? [...input, ...input] : [...input];
  const cycle = dash.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(cycle) || cycle <= 0) throw unsupported("Hairline glyph stroke has an empty dash cycle.");
  return dash;
}

function matrix(input: ArrayLike<number>): number[] {
  const values = Array.from({ length: 6 }, (_, index) => input[index]);
  if (!values.every(Number.isFinite)) throw unsupported("Hairline glyph transform is invalid.");
  return values;
}

function invert(m: readonly number[]): number[] {
  const determinant = m[0] * m[3] - m[1] * m[2];
  const scale = Math.hypot(m[0], m[1], m[2], m[3]);
  if (!Number.isFinite(scale) || Math.abs(determinant) <= 1e-12 * scale * scale) {
    throw unsupported("A singular dashed hairline glyph transform requires a raster fallback.");
  }
  const inverse = [m[3] / determinant, -m[1] / determinant, -m[2] / determinant, m[0] / determinant, 0, 0];
  inverse[4] = -inverse[0] * m[4] - inverse[2] * m[5];
  inverse[5] = -inverse[1] * m[4] - inverse[3] * m[5];
  return matrix(inverse);
}

function multiply(a: readonly number[], b: readonly number[]): number[] {
  return matrix([a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]);
}

function transform(m: readonly number[], x: number, y: number): Point {
  const result: Point = [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  if (!result.every(value => Number.isFinite(Math.fround(value)))) {
    throw unsupported("Hairline glyph coordinates are invalid.");
  }
  return result;
}

function split(points: readonly Point[]): [Point[], Point[]] {
  let row = [...points];
  const left = [row[0]];
  const right = [row[row.length - 1]];
  while (row.length > 1) {
    row = row.slice(1).map((point, index): Point =>
      [(row[index][0] + point[0]) / 2, (row[index][1] + point[1]) / 2]);
    left.push(row[0]);
    right.push(row[row.length - 1]);
  }
  return [left, right.reverse()];
}

function same(a: Point, b: Point): boolean { return a[0] === b[0] && a[1] === b[1]; }

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1,
    ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length));
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
}

function unsupported(message: string): PdfError {
  return new PdfError("unsupported-content", message, { details: { reason: "native-glyph-stroke" } });
}

function complexity(): PdfError {
  return new PdfError("unsupported-content", "Hairline glyph stroke exceeds its geometry budget.", {
    details: { reason: "native-glyph-stroke-complexity", limit: MAX_PRIMITIVES }
  });
}
