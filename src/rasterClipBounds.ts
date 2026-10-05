/**
 * Cached raster instance fields: inverse-transform row norms, padding, then
 * conservative UV bounds. Vertex expansion adds the live clip AA footprint.
 */
export function rasterClipInstanceBounds(matrix: ArrayLike<number>, bounds?: ArrayLike<number>): Float32Array {
  const unrestricted = (): Float32Array => Float32Array.of(0, 0, 0, 0, 0, 1, 1);
  if (!bounds) return unrestricted();
  if (bounds[0] > bounds[2] || bounds[1] > bounds[3]) return Float32Array.of(0, 0, 0, 1, 1, 0, 0);
  const a = matrix[0], b = matrix[1], c = matrix[2], d = matrix[3], e = matrix[4], f = matrix[5];
  const determinant = a * d - b * c;
  // Keep original quads when inversion would amplify Float32 cancellation.
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-8 * Math.max(Math.abs(a * d) + Math.abs(b * c), 1e-30)) {
    return unrestricted();
  }
  const ux = d / determinant, uy = -c / determinant, vx = -b / determinant, vy = a / determinant;
  const marginU = Math.abs(ux) + Math.abs(uy), marginV = Math.abs(vx) + Math.abs(vy);
  const x0 = bounds[0] - e, y0 = bounds[1] - f, x1 = bounds[2] - e, y1 = bounds[3] - f;
  // Widen for CPU/GPU Float32 transform and upload rounding as well as AA.
  const guard = Math.max(1, Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d), Math.abs(e), Math.abs(f),
    Math.abs(bounds[0]), Math.abs(bounds[1]), Math.abs(bounds[2]), Math.abs(bounds[3])) * 2 ** -20;
  const data = Float32Array.of(marginU, marginV, 0,
    Math.min(ux * x0, ux * x1) + Math.min(uy * y0, uy * y1) - guard * marginU,
    Math.min(vx * x0, vx * x1) + Math.min(vy * y0, vy * y1) - guard * marginV,
    Math.max(ux * x0, ux * x1) + Math.max(uy * y0, uy * y1) + guard * marginU,
    Math.max(vx * x0, vx * x1) + Math.max(vy * y0, vy * y1) + guard * marginV);
  return data.every(Number.isFinite) ? data : unrestricted();
}

/** Scalar component arithmetic lets regression tests evaluate the shipped helper. */
export const RASTER_CLIP_UV_BOUNDS_GLSL = `
vec4 heprRasterClipUvBounds(vec4 bounds, vec2 uvMargin, float worldMargin) {
  if (bounds.x > bounds.z || bounds.y > bounds.w) return bounds;
  float padU = uvMargin.x * worldMargin;
  float padV = uvMargin.y * worldMargin;
  return vec4(max(0.0, bounds.x - padU), max(0.0, bounds.y - padV),
    min(1.0, bounds.z + padU), min(1.0, bounds.w + padV));
}
`;
