import type { Bounds } from "./pdfVectorExtractor";

export type InkPoint = readonly [number, number];
export interface EditorInkSegment { start: InkPoint; end: InkPoint; control?: InkPoint }

const same = (a: InkPoint, b: InkPoint): boolean => a[0] === b[0] && a[1] === b[1];
const point = (x: number, y: number): [number, number] => [x, y];
const at = (a: InkPoint, c: InkPoint, b: InkPoint, t: number): [number, number] => {
  const s = 1 - t; return point(s * s * a[0] + 2 * s * t * c[0] + t * t * b[0], s * s * a[1] + 2 * s * t * c[1] + t * t * b[1]);
};

/** Fit bounded quadratic centerlines; zero tolerance retains the caller's polylines. */
export function fitEditorInkPaths(paths: readonly (readonly InkPoint[])[], tolerance = 0, signal?: AbortSignal): EditorInkSegment[][] {
  signal?.throwIfAborted();
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new RangeError("Ink tolerance must be a nonnegative finite number.");
  return paths.map(input => {
    signal?.throwIfAborted();
    const points: InkPoint[] = [];
    for (const value of input) {
      signal?.throwIfAborted();
      if (value.length !== 2 || !value.every(Number.isFinite)) throw new TypeError("Ink points require finite X and Y coordinates.");
      if (!points.length || !same(points[points.length - 1], value)) points.push(point(value[0], value[1]));
    }
    if (!points.length) return [];
    if (points.length === 1) return [{ start: points[0], end: points[0] }];
    if (tolerance === 0) return points.slice(1).map((end, index) => ({ start: points[index], end }));
    const lengths = [0], anchors = [0];
    for (let i = 1; i < points.length; i++) {
      signal?.throwIfAborted();
      lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
      if (i + 1 === points.length) continue;
      const a = points[i - 1], b = points[i], c = points[i + 1];
      const ax = b[0] - a[0], ay = b[1] - a[1], bx = c[0] - b[0], by = c[1] - b[1];
      const left = Math.hypot(ax, ay), right = Math.hypot(bx, by), chord = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const projection = chord ? (ax * (c[0] - a[0]) + ay * (c[1] - a[1])) / (chord * chord) : 0;
      const height = chord && projection >= 0 && projection <= 1
        ? Math.abs(ax * (c[1] - a[1]) - ay * (c[0] - a[0])) / chord : Math.min(left, right);
      // Keep visible cusps and corners as exact anchors, including reversals.
      if (ax * bx + ay * by <= left * right * .5 && height > tolerance) anchors.push(i);
    }
    anchors.push(points.length - 1);
    const stack: [number, number][] = [];
    for (let i = anchors.length - 1; i > 0; i--) stack.push([anchors[i - 1], anchors[i]]);
    const result: EditorInkSegment[] = [];
    while (stack.length) {
      signal?.throwIfAborted();
      const [first, last] = stack.pop()!, start = points[first], end = points[last];
      if (last - first === 1) { result.push({ start, end }); continue; }
      const length = lengths[last] - lengths[first], parameters: number[] = [];
      let lineError = 0, numeratorX = 0, numeratorY = 0, denominator = 0;
      for (let i = first; i <= last; i++) {
        signal?.throwIfAborted();
        const t = length > 0 ? (lengths[i] - lengths[first]) / length : (i - first) / (last - first), s = 1 - t;
        parameters.push(t);
        lineError = Math.max(lineError, Math.hypot(points[i][0] - (s * start[0] + t * end[0]), points[i][1] - (s * start[1] + t * end[1])));
        const weight = 2 * s * t;
        numeratorX += weight * (points[i][0] - s * s * start[0] - t * t * end[0]);
        numeratorY += weight * (points[i][1] - s * s * start[1] - t * t * end[1]); denominator += weight * weight;
      }
      if (lineError <= tolerance) { result.push({ start, end }); continue; }
      const control = point(numeratorX / denominator, numeratorY / denominator);
      const curvature = Math.hypot(start[0] - 2 * control[0] + end[0], start[1] - 2 * control[1] + end[1]);
      let error = 0, worst = first, previousError = 0;
      for (let i = first + 1; i <= last; i++) {
        signal?.throwIfAborted();
        const t = parameters[i - first], p = at(start, control, end, t), dt = t - parameters[i - first - 1];
        const nextError = Math.hypot(p[0] - points[i][0], p[1] - points[i][1]);
        // The quadratic/chord error between samples is exactly bounded by
        // |P0 - 2C + P1| * dt² / 4, beyond the endpoint fitting errors.
        const bound = Math.max(previousError, nextError) + curvature * dt * dt / 4;
        if (bound > error) { error = bound; worst = i - 1; }
        previousError = nextError;
      }
      if (Number.isFinite(error) && control.every(Number.isFinite) && error <= tolerance) { result.push({ start, control, end }); continue; }
      let split = Math.max(first + 1, Math.min(last - 1, worst + 1));
      // Avoid quadratic work on a long path whose worst error hugs one end.
      if (Math.min(split - first, last - split) < (last - first) / 8) split = first + Math.floor((last - first) / 2);
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
