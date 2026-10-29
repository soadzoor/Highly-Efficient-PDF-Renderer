import type { Bounds } from "./pdfVectorExtractor";

export type InkPoint = readonly [number, number];
export interface EditorInkSegment { start: InkPoint; end: InkPoint; control?: InkPoint }

const same = (a: InkPoint, b: InkPoint): boolean => a[0] === b[0] && a[1] === b[1];
const point = (x: number, y: number): [number, number] => [x, y];
// Deterministic geometric ties must not change after template scale/translation.
const farther = (a: number, b: number): boolean => Number.isFinite(a) && Number.isFinite(b)
  ? a - b > Math.max(Math.abs(a), Math.abs(b)) * 1e-10 : a > b;
const at = (a: InkPoint, c: InkPoint, b: InkPoint, t: number): [number, number] => {
  const s = 1 - t; return point(a[0] + 2 * s * t * (c[0] - a[0]) + t * t * (b[0] - a[0]), a[1] + 2 * s * t * (c[1] - a[1]) + t * t * (b[1] - a[1]));
};

function cleanInkPoints(input: readonly InkPoint[], signal?: AbortSignal): InkPoint[] {
  const points: InkPoint[] = [];
  for (const value of input) {
    signal?.throwIfAborted();
    if (value.length !== 2 || !value.every(Number.isFinite)) throw new TypeError("Ink points require finite X and Y coordinates.");
    if (!points.length || !same(points[points.length - 1], value)) points.push(point(value[0], value[1]));
  }
  return points;
}

function segmentDistance(p: InkPoint, a: InkPoint, b: InkPoint): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
  if (!length) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  if (!Number.isFinite(length)) return Infinity;
  const t = Math.max(0, Math.min(length, (p[0] - a[0]) * (dx / length) + (p[1] - a[1]) * (dy / length)));
  return Math.hypot(p[0] - a[0] - t * (dx / length), p[1] - a[1] - t * (dy / length));
}

/** Exact corners/reversals and a closed stroke's distinct sides remain anchors. */
function inkAnchors(points: readonly InkPoint[], tolerance: number, signal?: AbortSignal): { anchors: number[]; corners: Set<number> } {
  const last = points.length - 1, corners = new Set<number>(), anchors = new Set([0, last]);
  const corner = (a: InkPoint, b: InkPoint, c: InkPoint): boolean => {
    const ax = b[0] - a[0], ay = b[1] - a[1], bx = c[0] - b[0], by = c[1] - b[1];
    const left = Math.hypot(ax, ay), right = Math.hypot(bx, by);
    return ax * bx + ay * by <= left * right * .5 && farther(segmentDistance(b, a, c), tolerance);
  };
  for (let i = 1; i < last; i++) {
    signal?.throwIfAborted();
    if (corner(points[i - 1], points[i], points[i + 1])) { anchors.add(i); corners.add(i); }
  }
  if (last > 2 && same(points[0], points[last])) {
    if (corner(points[last - 1], points[0], points[1])) { corners.add(0); corners.add(last); }
    let opposite = 1, distance = -1;
    for (let i = 1; i < last; i++) {
      signal?.throwIfAborted(); const d = Math.hypot(points[i][0] - points[0][0], points[i][1] - points[0][1]);
      if (farther(d, distance)) { distance = d; opposite = i; }
    }
    anchors.add(opposite);
    for (const [first, end] of [[0, opposite], [opposite, last]]) {
      let farthest = first, deviation = 0;
      for (let i = first + 1; i < end; i++) {
        signal?.throwIfAborted(); const d = segmentDistance(points[i], points[first], points[end]);
        if (farther(d, deviation)) { deviation = d; farthest = i; }
      }
      if (deviation > 0) anchors.add(farthest);
    }
  }
  return { anchors: [...anchors].sort((a, b) => a - b), corners };
}

function simplifyInkPoints(points: InkPoint[], tolerance: number, signal?: AbortSignal): InkPoint[] {
  if (!tolerance || points.length < 3) return points;
  const { anchors } = inkAnchors(points, tolerance, signal), keep = new Set(anchors), stack: [number, number][] = [];
  for (let i = 1; i < anchors.length; i++) stack.push([anchors[i - 1], anchors[i]]);
  while (stack.length) {
    signal?.throwIfAborted(); const [first, last] = stack.pop()!;
    let error = tolerance, split = -1;
    for (let i = first + 1; i < last; i++) {
      signal?.throwIfAborted(); const distance = segmentDistance(points[i], points[first], points[last]);
      if (farther(distance, error)) { error = distance; split = i; }
    }
    if (split < 0) continue;
    // Balanced subdivision avoids quadratic work without dropping any detail.
    if (Math.min(split - first, last - split) < (last - first) / 8) split = first + Math.floor((last - first) / 2);
    keep.add(split); stack.push([first, split], [split, last]);
  }
  return [...keep].sort((a, b) => a - b).map(index => points[index]);
}

/** Bounded point compaction for new captures; preserves path boundaries and exact endpoints. */
export function simplifyEditorInkPaths(paths: readonly (readonly InkPoint[])[], tolerance = 0, signal?: AbortSignal): InkPoint[][] {
  signal?.throwIfAborted();
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new RangeError("Ink tolerance must be a nonnegative finite number.");
  return paths.map(input => simplifyInkPoints(cleanInkPoints(input, signal), tolerance, signal));
}

/** Fit compact quadratic centerlines with shared tangents where the error budget allows. */
export function fitEditorInkPaths(paths: readonly (readonly InkPoint[])[], tolerance = 0, signal?: AbortSignal): EditorInkSegment[][] {
  signal?.throwIfAborted();
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new RangeError("Ink tolerance must be a nonnegative finite number.");
  return paths.map(input => {
    signal?.throwIfAborted();
    const points = cleanInkPoints(input, signal), budget = tolerance;
    if (!points.length) return [];
    if (points.length === 1) return [{ start: points[0], end: points[0] }];
    if (tolerance === 0) return points.slice(1).map((end, index) => ({ start: points[index], end }));
    const lengths = [0], { anchors, corners } = inkAnchors(points, tolerance, signal);
    for (let i = 1; i < points.length; i++) {
      signal?.throwIfAborted();
      lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    }
    const total = lengths[lengths.length - 1], closed = same(points[0], points[points.length - 1]);
    const sample = (distance: number): InkPoint => {
      if (closed && total > 0) distance = (distance % total + total) % total;
      else distance = Math.max(0, Math.min(total, distance));
      let lo = 0, hi = lengths.length - 1;
      while (lo + 1 < hi) { const middle = (lo + hi) >>> 1; if (lengths[middle] <= distance) lo = middle; else hi = middle; }
      const t = (distance - lengths[lo]) / (lengths[hi] - lengths[lo]);
      return point(points[lo][0] + t * (points[hi][0] - points[lo][0]), points[lo][1] + t * (points[hi][1] - points[lo][1]));
    };
    const tangent = (index: number, first: number, last: number, start: boolean): InkPoint | undefined => {
      const radius = Math.min(tolerance * 4, total / 4), distance = lengths[index];
      let a: InkPoint, b: InkPoint;
      if (corners.has(index) || !closed && (index === 0 || index + 1 === points.length)) {
        a = start ? points[index] : sample(Math.max(lengths[first], distance - radius));
        b = start ? sample(Math.min(lengths[last], distance + radius)) : points[index];
      } else { a = sample(distance - radius); b = sample(distance + radius); }
      const x = b[0] - a[0], y = b[1] - a[1], length = Math.hypot(x, y);
      return length > 0 && Number.isFinite(length) ? point(x / length, y / length) : undefined;
    };
    const errorFor = (first: number, last: number, control: InkPoint, parameters: readonly number[]): { error: number; split: number } => {
      const start = points[first], end = points[last], curvature = Math.hypot((control[0] - start[0]) + (control[0] - end[0]), (control[1] - start[1]) + (control[1] - end[1]));
      let error = 0, split = first + 1, previousError = 0;
      for (let i = first + 1; i <= last; i++) {
        signal?.throwIfAborted(); const t = parameters[i - first], p = at(start, control, end, t), dt = t - parameters[i - first - 1];
        const nextError = Math.hypot(p[0] - points[i][0], p[1] - points[i][1]);
        // This bounds every point between samples, not only fitted vertices.
        const bound = Math.max(previousError, nextError) + curvature * dt * dt / 4;
        if (farther(bound, error)) { error = bound; split = i; }
        previousError = nextError;
      }
      return { error, split };
    };
    const reparameterize = (first: number, last: number, control: InkPoint, parameters: readonly number[]): number[] => {
      const start = points[first], end = points[last], next = [0];
      const ddx = 2 * ((end[0] - control[0]) - (control[0] - start[0])), ddy = 2 * ((end[1] - control[1]) - (control[1] - start[1]));
      for (let i = first + 1; i < last; i++) {
        signal?.throwIfAborted(); const t = parameters[i - first], p = at(start, control, end, t), x = p[0] - points[i][0], y = p[1] - points[i][1];
        const dx = 2 * ((1 - t) * (control[0] - start[0]) + t * (end[0] - control[0])), dy = 2 * ((1 - t) * (control[1] - start[1]) + t * (end[1] - control[1]));
        const denominator = dx * dx + dy * dy + x * ddx + y * ddy;
        const refined = denominator ? t - (x * dx + y * dy) / denominator : t;
        next.push(Number.isFinite(refined) ? Math.max(next[next.length - 1], Math.min(parameters[i - first + 1], refined)) : t);
      }
      next.push(1); return next;
    };
    const stack: [number, number][] = [];
    for (let i = anchors.length - 1; i > 0; i--) stack.push([anchors[i - 1], anchors[i]]);
    const result: EditorInkSegment[] = [];
    while (stack.length) {
      signal?.throwIfAborted();
      const [first, last] = stack.pop()!, start = points[first], end = points[last];
      const length = lengths[last] - lengths[first], parameters: number[] = [];
      const dx = end[0] - start[0], dy = end[1] - start[1], chord = Math.hypot(dx, dy);
      let lineError = 0, previous = 0;
      for (let i = first; i <= last; i++) {
        signal?.throwIfAborted();
        const t = length > 0 && Number.isFinite(length) ? (lengths[i] - lengths[first]) / length : (i - first) / (last - first);
        parameters.push(t);
        const projection = chord > 0 && Number.isFinite(chord) ? Math.max(previous, Math.min(1,
          ((points[i][0] - start[0]) * (dx / chord) + (points[i][1] - start[1]) * (dy / chord)) / chord)) : t;
        previous = projection;
        lineError = Math.max(lineError, Math.hypot(points[i][0] - start[0] - projection * dx, points[i][1] - start[1] - projection * dy));
      }
      if (lineError <= budget || last - first === 1) { result.push({ start, end }); continue; }
      let accepted: InkPoint | undefined;
      const left = tangent(first, first, last, true), right = tangent(last, first, last, false);
      if (left && right) {
        const determinant = left[0] * right[1] - left[1] * right[0];
        const alpha = determinant ? (dx * right[1] - dy * right[0]) / determinant : -1;
        const beta = determinant ? (left[0] * dy - left[1] * dx) / determinant : -1;
        if (alpha > 0 && beta > 0) {
          const control = point(start[0] + alpha * left[0], start[1] + alpha * left[1]);
          let params = parameters, measured = errorFor(first, last, control, params);
          while (Number.isFinite(measured.error) && measured.error > budget) {
            const next = reparameterize(first, last, control, params), candidate = errorFor(first, last, control, next);
            if (!(candidate.error < measured.error * .999)) break;
            params = next; measured = candidate;
          }
          if (control.every(Number.isFinite) && measured.error <= budget) accepted = control;
        }
      }
      if (accepted) { result.push({ start, control: accepted, end }); continue; }
      let params = parameters, measured = { error: Infinity, split: first + Math.floor((last - first) / 2) };
      for (;;) {
        let numeratorX = 0, numeratorY = 0, denominator = 0;
        for (let i = first + 1; i < last; i++) {
          signal?.throwIfAborted(); const t = params[i - first], weight = 2 * (1 - t) * t;
          numeratorX += weight * (points[i][0] - start[0] - t * t * dx);
          numeratorY += weight * (points[i][1] - start[1] - t * t * dy); denominator += weight * weight;
        }
        const control = point(start[0] + numeratorX / denominator, start[1] + numeratorY / denominator);
        const candidate = errorFor(first, last, control, params);
        if (!control.every(Number.isFinite) || !Number.isFinite(candidate.error) || candidate.error >= measured.error * .999) break;
        measured = candidate;
        if (measured.error <= budget) { accepted = control; break; }
        params = reparameterize(first, last, control, params);
      }
      if (accepted) { result.push({ start, control: accepted, end }); continue; }
      // Midpoint subdivision avoids choosing noise extrema as shared curve knots.
      const split = first + Math.floor((last - first) / 2);
      stack.push([split, last], [first, split]);
    }
    return result;
  });
}

/** SVG previews use exactly the same fitted centerlines as committed geometry. */
export function editorInkPathData(paths: readonly (readonly EditorInkSegment[])[]): string {
  const commands: string[] = [];
  for (const path of paths) {
    let previous: InkPoint | undefined;
    for (const segment of path) {
      if (!previous || !same(previous, segment.start)) commands.push(`M${segment.start[0]} ${segment.start[1]}`);
      commands.push(segment.control ? `Q${segment.control[0]} ${segment.control[1]} ${segment.end[0]} ${segment.end[1]}` : `L${segment.end[0]} ${segment.end[1]}`);
      previous = segment.end;
    }
  }
  return commands.join(" ");
}

/** Point-only PDF InkList fallback follows the canonical curves within tolerance. */
export function flattenEditorInkPaths(paths: readonly (readonly EditorInkSegment[])[], tolerance = .05, signal?: AbortSignal,
  precision: "float32" | "float64" = "float32"): [number, number][][] {
  signal?.throwIfAborted();
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new RangeError("Ink flattening tolerance must be positive and finite.");
  if (precision !== "float32" && precision !== "float64") throw new RangeError("Ink flattening precision must be float32 or float64.");
  const result: [number, number][][] = [];
  for (const path of paths) {
    let output: [number, number][] | undefined, previous: InkPoint | undefined;
    for (const segment of path) {
      signal?.throwIfAborted();
      if (!previous || !same(previous, segment.start)) { output = [point(...segment.start)]; result.push(output); }
      if (!segment.control) output!.push(point(...segment.end));
      else {
        const scale = Math.max(...segment.start.map(Math.abs), ...segment.end.map(Math.abs), ...segment.control.map(Math.abs));
        // GPU-local paths cannot improve beyond their Float32 coordinates;
        // transformed PDF paths retain Double precision before serialization.
        const error = precision === "float64" ? Math.max(tolerance, scale * Number.EPSILON, Number.MIN_VALUE)
          : Math.max(tolerance, scale * 2 ** -24, 2 ** -149);
        const stack: EditorInkSegment[] = [segment];
        while (stack.length) {
          signal?.throwIfAborted();
          const current = stack.pop()!, a = current.start, c = current.control!, b = current.end;
          const deviation = Math.hypot(a[0] - 2 * c[0] + b[0], a[1] - 2 * c[1] + b[1]) / 4;
          if (deviation <= error) { output!.push(point(...b)); continue; }
          const left = point((a[0] + c[0]) / 2, (a[1] + c[1]) / 2), right = point((c[0] + b[0]) / 2, (c[1] + b[1]) / 2);
          const middle = point((left[0] + right[0]) / 2, (left[1] + right[1]) / 2);
          // Stop only if floating-point precision prevents further subdivision.
          if (same(left, c) && same(middle, b) || same(right, c) && same(middle, a)) { output!.push(point(...b)); continue; }
          stack.push({ start: middle, control: right, end: b }, { start: a, control: left, end: middle });
        }
      }
      previous = segment.end;
    }
  }
  return result;
}

/** Tight centerline bounds retain quadratic extrema rather than control hulls. */
export function editorInkBounds(paths: readonly (readonly EditorInkSegment[])[]): Bounds | null {
  let bounds: Bounds | null = null;
  const include = (p: InkPoint): void => {
    if (!bounds) bounds = { minX: p[0], minY: p[1], maxX: p[0], maxY: p[1] };
    else { bounds.minX = Math.min(bounds.minX, p[0]); bounds.minY = Math.min(bounds.minY, p[1]); bounds.maxX = Math.max(bounds.maxX, p[0]); bounds.maxY = Math.max(bounds.maxY, p[1]); }
  };
  for (const path of paths) for (const { start, control, end } of path) {
    include(start); include(end);
    if (control) for (const axis of [0, 1] as const) {
      const denominator = start[axis] - 2 * control[axis] + end[axis], t = (start[axis] - control[axis]) / denominator;
      if (t > 0 && t < 1) include(at(start, control, end, t));
    }
  }
  return bounds;
}
