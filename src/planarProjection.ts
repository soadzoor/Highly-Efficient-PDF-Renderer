import type { Bounds } from "./pdfVectorExtractor";

/** Pixel dimensions used when projecting PDF-local planar geometry. */
export interface PlanarViewport {
  width: number;
  height: number;
}

/** Conservative projection information for one local-space rectangle. */
export interface PlanarBoundsProjection {
  /** False only when the complete rectangle is outside one X/Y clip plane. */
  visible: boolean;
  /** False when the rectangle reaches/crosses the camera plane or data is invalid. */
  stable: boolean;
  /** Conservative upper bound on screen pixels per local-space unit. */
  maxPixelsPerLocalUnit: number;
  /** Projected pixel bounds. Infinite when projection is unstable. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const CLIP_W_EPSILON = 1e-8;

/**
 * Exact largest singular value of a 2x2 matrix.
 *
 * This is the maximum stretch of the matrix over all unit directions, not a
 * column-length approximation. It is therefore exact for affine planar views.
 */
export function largestSingularValue2x2(a: number, b: number, c: number, d: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) {
    return Number.POSITIVE_INFINITY;
  }
  const sumSquares = a * a + b * b + c * c + d * d;
  const determinant = a * d - b * c;
  const discriminant = Math.max(0, sumSquares * sumSquares - 4 * determinant * determinant);
  return Math.sqrt(Math.max(0, (sumSquares + Math.sqrt(discriminant)) * 0.5));
}

/**
 * Build a column-major planar local-to-clip matrix for the native 2D camera.
 */
export function createOrthographicLocalToClip(
  cameraCenterX: number,
  cameraCenterY: number,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number
): Float64Array {
  const width = Math.max(1, Math.abs(viewportWidth));
  const height = Math.max(1, Math.abs(viewportHeight));
  const safeZoom = Number.isFinite(zoom) ? zoom : 0;
  const sx = 2 * safeZoom / width;
  const sy = 2 * safeZoom / height;
  return new Float64Array([
    sx, 0, 0, 0,
    0, sy, 0, 0,
    0, 0, 1, 0,
    -cameraCenterX * sx, -cameraCenterY * sy, 0, 1
  ]);
}

/**
 * Project a PDF-local rectangle through a column-major 4x4 matrix.
 *
 * For affine transforms the returned scale is the exact maximum singular value
 * of the local-to-pixel Jacobian. For projective transforms each Jacobian entry
 * is bounded analytically over the complete rectangle and combined with a
 * Frobenius-norm bound. This can choose exact text more often than necessary,
 * but can never under-estimate readable text merely because only a center point
 * was sampled.
 */
export function analyzePlanarBoundsProjection(
  bounds: Bounds,
  localToClip: ArrayLike<number>,
  viewport: PlanarViewport
): PlanarBoundsProjection {
  return analyzePlanarBoundsProjectionInto(bounds, localToClip, viewport, createPlanarBoundsProjection());
}

/** A result object suitable for reuse across `analyzePlanarBoundsProjectionInto` calls. */
export function createPlanarBoundsProjection(): PlanarBoundsProjection {
  return {
    visible: true,
    stable: false,
    maxPixelsPerLocalUnit: Number.POSITIVE_INFINITY,
    minX: Number.NEGATIVE_INFINITY,
    minY: Number.NEGATIVE_INFINITY,
    maxX: Number.POSITIVE_INFINITY,
    maxY: Number.POSITIVE_INFINITY
  };
}

/**
 * Allocation-free form of {@link analyzePlanarBoundsProjection}.
 *
 * Selection runs this once per visible page and cluster every frame, so it
 * writes into a caller-owned result and avoids per-call temporaries. `out` is
 * returned for convenience and is only valid until the next call that reuses it.
 */
export function analyzePlanarBoundsProjectionInto(
  bounds: Bounds,
  localToClip: ArrayLike<number>,
  viewport: PlanarViewport,
  out: PlanarBoundsProjection
): PlanarBoundsProjection {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  if (!isFiniteBounds(bounds) || localToClip.length < 16 || !Number.isFinite(width) || !Number.isFinite(height)) {
    return writeUnstableProjection(out);
  }

  // Read the matrix without coercion: this runs for every visible page and
  // cluster each frame, and the finiteness guard below already rejects anything
  // that is not a real number by falling back to the exact representation.
  const m0 = localToClip[0];
  const m1 = localToClip[1];
  const m3 = localToClip[3];
  const m4 = localToClip[4];
  const m5 = localToClip[5];
  const m7 = localToClip[7];
  const m12 = localToClip[12];
  const m13 = localToClip[13];
  const m15 = localToClip[15];
  if (
    !Number.isFinite(m0) || !Number.isFinite(m1) || !Number.isFinite(m3) ||
    !Number.isFinite(m4) || !Number.isFinite(m5) || !Number.isFinite(m7) ||
    !Number.isFinite(m12) || !Number.isFinite(m13) || !Number.isFinite(m15)
  ) {
    return writeUnstableProjection(out);
  }

  let minW = Number.POSITIVE_INFINITY;
  let maxW = Number.NEGATIVE_INFINITY;
  let minAbsW = Number.POSITIVE_INFINITY;
  let projectedMinX = Number.POSITIVE_INFINITY;
  let projectedMinY = Number.POSITIVE_INFINITY;
  let projectedMaxX = Number.NEGATIVE_INFINITY;
  let projectedMaxY = Number.NEGATIVE_INFINITY;
  let outsideLeft = true;
  let outsideRight = true;
  let outsideBottom = true;
  let outsideTop = true;

  for (let corner = 0; corner < 4; corner += 1) {
    const x = (corner & 1) === 0 ? bounds.minX : bounds.maxX;
    const y = (corner & 2) === 0 ? bounds.minY : bounds.maxY;
    const clipX = m0 * x + m4 * y + m12;
    const clipY = m1 * x + m5 * y + m13;
    const clipW = m3 * x + m7 * y + m15;
    if (!Number.isFinite(clipX) || !Number.isFinite(clipY) || !Number.isFinite(clipW)) {
      return writeUnstableProjection(out);
    }
    minW = Math.min(minW, clipW);
    maxW = Math.max(maxW, clipW);
    minAbsW = Math.min(minAbsW, Math.abs(clipW));
    outsideLeft &&= clipX < -clipW;
    outsideRight &&= clipX > clipW;
    outsideBottom &&= clipY < -clipW;
    outsideTop &&= clipY > clipW;

    if (Math.abs(clipW) > CLIP_W_EPSILON) {
      const pixelX = (clipX / clipW * 0.5 + 0.5) * width;
      const pixelY = (clipY / clipW * 0.5 + 0.5) * height;
      if (!Number.isFinite(pixelX) || !Number.isFinite(pixelY)) {
        return writeUnstableProjection(out);
      }
      projectedMinX = Math.min(projectedMinX, pixelX);
      projectedMinY = Math.min(projectedMinY, pixelY);
      projectedMaxX = Math.max(projectedMaxX, pixelX);
      projectedMaxY = Math.max(projectedMaxY, pixelY);
    }
  }

  // A rectangle wholly behind the eye cannot contribute fragments and is safe
  // to cull without applying API-specific Z clip conventions.
  if (maxW < -CLIP_W_EPSILON) {
    return writeCulledProjection(out);
  }

  // A rectangle touching or crossing W=0 has an unbounded projective scale.
  // Treat it as visible/exact; culling it here could create a quality hole.
  if (minW <= CLIP_W_EPSILON || minAbsW <= CLIP_W_EPSILON) {
    return writeUnstableProjection(out);
  }

  const visible = !(outsideLeft || outsideRight || outsideBottom || outsideTop);
  const affine = Math.abs(m3) <= Number.EPSILON && Math.abs(m7) <= Number.EPSILON;
  let maxPixelsPerLocalUnit: number;
  if (affine) {
    const inverseW = 1 / m15;
    maxPixelsPerLocalUnit = largestSingularValue2x2(
      m0 * inverseW * width * 0.5,
      m1 * inverseW * height * 0.5,
      m4 * inverseW * width * 0.5,
      m5 * inverseW * height * 0.5
    );
  } else {
    // d(X/W)/dx = (m0*W - X*m3) / W^2. The numerator is
    // affine (and in fact independent of x); its maximum absolute value over a
    // rectangle occurs at a corner. Bound all four pixel-Jacobian entries and
    // use their Frobenius norm as a conservative singular-value upper bound.
    const invMinW2 = 1 / (minAbsW * minAbsW);
    const dXdx = maxAbsProjectiveDerivativeNumerator(bounds, m0, m4, m12, m3, m7, m15, m0, m3) * invMinW2 * width * 0.5;
    const dXdy = maxAbsProjectiveDerivativeNumerator(bounds, m0, m4, m12, m3, m7, m15, m4, m7) * invMinW2 * width * 0.5;
    const dYdx = maxAbsProjectiveDerivativeNumerator(bounds, m1, m5, m13, m3, m7, m15, m1, m3) * invMinW2 * height * 0.5;
    const dYdy = maxAbsProjectiveDerivativeNumerator(bounds, m1, m5, m13, m3, m7, m15, m5, m7) * invMinW2 * height * 0.5;
    maxPixelsPerLocalUnit = Math.hypot(dXdx, dXdy, dYdx, dYdy);
  }

  if (!Number.isFinite(maxPixelsPerLocalUnit)) {
    return writeUnstableProjection(out);
  }

  out.visible = visible;
  out.stable = true;
  out.maxPixelsPerLocalUnit = maxPixelsPerLocalUnit;
  out.minX = projectedMinX;
  out.minY = projectedMinY;
  out.maxX = projectedMaxX;
  out.maxY = projectedMaxY;
  return out;
}

function maxAbsProjectiveDerivativeNumerator(
  bounds: Bounds,
  numeratorX: number,
  numeratorY: number,
  numeratorConstant: number,
  wX: number,
  wY: number,
  wConstant: number,
  derivativeNumerator: number,
  derivativeW: number
): number {
  let maximum = 0;
  for (let corner = 0; corner < 4; corner += 1) {
    const x = (corner & 1) === 0 ? bounds.minX : bounds.maxX;
    const y = (corner & 2) === 0 ? bounds.minY : bounds.maxY;
    const numerator =
      derivativeNumerator * (wX * x + wY * y + wConstant) -
      (numeratorX * x + numeratorY * y + numeratorConstant) * derivativeW;
    maximum = Math.max(maximum, Math.abs(numerator));
  }
  return maximum;
}

function isFiniteBounds(bounds: Bounds): boolean {
  return Number.isFinite(bounds.minX) && Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxX) && Number.isFinite(bounds.maxY) &&
    bounds.maxX >= bounds.minX && bounds.maxY >= bounds.minY;
}

function writeUnstableProjection(out: PlanarBoundsProjection): PlanarBoundsProjection {
  out.visible = true;
  out.stable = false;
  out.maxPixelsPerLocalUnit = Number.POSITIVE_INFINITY;
  out.minX = Number.NEGATIVE_INFINITY;
  out.minY = Number.NEGATIVE_INFINITY;
  out.maxX = Number.POSITIVE_INFINITY;
  out.maxY = Number.POSITIVE_INFINITY;
  return out;
}

function writeCulledProjection(out: PlanarBoundsProjection): PlanarBoundsProjection {
  out.visible = false;
  out.stable = true;
  out.maxPixelsPerLocalUnit = 0;
  out.minX = 0;
  out.minY = 0;
  out.maxX = 0;
  out.maxY = 0;
  return out;
}
