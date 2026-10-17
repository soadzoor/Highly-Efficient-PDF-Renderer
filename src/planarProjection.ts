import type { Bounds } from "./pdfVectorExtractor";

/** Pixel dimensions used when projecting PDF-local planar geometry. */
export interface PlanarViewport {
  width: number;
  height: number;
}

/** Local viewport bounds and a conservative inverse fragment footprint. */
export interface PlanarViewportFootprint extends Bounds {
  maxUnitsPerPixel: number;
  unitsPerPixelX: number;
  unitsPerPixelY: number;
}

/**
 * Invert a planar projective viewport, including the neighbouring samples used
 * by fragment derivatives. Returns null for horizons, hidden planes and
 * numerically uncertain inverses. Pass Float32 coefficients to match uniforms;
 * callers doing source-space culling can retain their original precision.
 */
export function planarViewportFootprintInto(m: ArrayLike<number>, viewport: PlanarViewport,
  out: PlanarViewportFootprint): PlanarViewportFootprint | null {
  if (m.length < 16 || !(viewport.width > 0) || !(viewport.height > 0)) return null;
  const w = m[15];
  const a = m[0] * viewport.width / 2, b = m[4] * viewport.width / 2;
  const c = m[1] * viewport.height / 2, d = m[5] * viewport.height / 2;
  const tx = m[12] * viewport.width / 2, ty = m[13] * viewport.height / 2;
  const p = m[3], q = m[7], determinant = a * d - b * c;
  const tolerance = 2 ** -20;
  const inverseWX = c * q - d * p, inverseWY = b * p - a * q;
  const halfWidth = viewport.width / 2 + 1, halfHeight = viewport.height / 2 + 1;
  const variation = Math.abs(inverseWX) * halfWidth + Math.abs(inverseWY) * halfHeight;
  // Inverse W is linear in screen XY. Its minimum bounds perspective division
  // throughout the viewport; include cancellation error in that minimum.
  const minimumW = Math.abs(determinant) - variation;
  const uncertainty = (Math.abs(a * d) + Math.abs(b * c) +
    (Math.abs(c * q) + Math.abs(d * p)) * halfWidth +
    (Math.abs(b * p) + Math.abs(a * q)) * halfHeight) * tolerance;
  if (!(minimumW > uncertainty)) return null;
  const depth = w * determinant, offsetX = tx * inverseWX, offsetY = ty * inverseWY;
  const planarDeterminant = depth + offsetX + offsetY;
  // The on-screen plane must be in front of the eye; its data origin need not be.
  if (!(planarDeterminant * Math.sign(determinant) > 0) || Math.abs(planarDeterminant) <=
      (Math.abs(depth) + Math.abs(offsetX) + Math.abs(offsetY)) * tolerance) return null;
  // Inverse derivative numerators are det(H) times (d-q*y, q*x-b) and
  // (p*y-c, a-p*x). Their row norms also bound finite pixel differences.
  const factor = Math.abs(planarDeterminant) / (minimumW * minimumW) * (1 + tolerance);
  const unitsX = factor * Math.hypot(Math.abs(d) + Math.abs(q) * halfHeight, Math.abs(b) + Math.abs(q) * halfWidth);
  const unitsY = factor * Math.hypot(Math.abs(c) + Math.abs(p) * halfHeight, Math.abs(a) + Math.abs(p) * halfWidth);
  const units = Math.max(unitsX, unitsY);
  if (!Number.isFinite(units) || !(units > 0)) return null;
  const ax = d * w - ty * q, bx = tx * q - b * w, cx = b * ty - tx * d;
  const ay = ty * p - c * w, by = a * w - tx * p, cy = tx * c - a * ty;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  // With a sign-stable denominator, a linear-fractional coordinate has its
  // extrema at corners. The exact viewport bounds need no uniform-scale assumption.
  for (let corner = 0; corner < 4; corner++) {
    const x = (corner & 1 ? 1 : -1) * viewport.width / 2;
    const y = (corner & 2 ? 1 : -1) * viewport.height / 2;
    const inverseW = inverseWX * x + inverseWY * y + determinant;
    const localX = (ax * x + bx * y + cx) / inverseW;
    const localY = (ay * x + by * y + cy) / inverseW;
    minX = Math.min(minX, localX); minY = Math.min(minY, localY);
    maxX = Math.max(maxX, localX); maxY = Math.max(maxY, localY);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null;
  out.minX = minX; out.minY = minY; out.maxX = maxX; out.maxY = maxY;
  out.maxUnitsPerPixel = units;
  out.unitsPerPixelX = unitsX; out.unitsPerPixelY = unitsY;
  return out;
}

/** Conservative projection information for one local-space rectangle. */
export interface PlanarBoundsProjection {
  /** False only when the complete rectangle is outside one X/Y clip plane. */
  visible: boolean;
  /** False when the rectangle reaches/crosses the camera plane or data is invalid. */
  stable: boolean;
  /** Conservative upper bound on pixels per local unit, along the supplied direction if any. */
  maxPixelsPerLocalUnit: number;
  /**
   * Conservative lower bound on the largest stretch at every point of the
   * rectangle: no point magnifies less than this in its widest direction,
   * or along the supplied direction when one was requested.
   * Zero when unknown. Equal to the maximum for affine views.
   */
  minPixelsPerLocalUnit: number;
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
 * of the local-to-pixel Jacobian. For projective transforms the Jacobian is
 * bounded analytically over the complete rectangle. This can choose exact text
 * more often than necessary, but can never under-estimate readable text merely
 * because only a center point was sampled. An optional unit direction measures
 * stretch along that axis (for example glyph height) instead of the widest axis.
 * Supplying a baseline too measures height perpendicular to its projected line,
 * discounting perspective shear along that line.
 */
export function analyzePlanarBoundsProjection(
  bounds: Bounds,
  localToClip: ArrayLike<number>,
  viewport: PlanarViewport,
  direction?: readonly [number, number],
  baseline?: readonly [number, number]
): PlanarBoundsProjection {
  return analyzePlanarBoundsProjectionInto(bounds, localToClip, viewport, createPlanarBoundsProjection(), direction, baseline);
}

/** A result object suitable for reuse across `analyzePlanarBoundsProjectionInto` calls. */
export function createPlanarBoundsProjection(): PlanarBoundsProjection {
  return {
    visible: true,
    stable: false,
    maxPixelsPerLocalUnit: Number.POSITIVE_INFINITY,
    minPixelsPerLocalUnit: 0,
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
  out: PlanarBoundsProjection,
  direction?: readonly [number, number],
  baseline?: readonly [number, number]
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
  const affine = isAffinePlanarLocalToClip(localToClip);
  let maxPixelsPerLocalUnit: number;
  let minPixelsPerLocalUnit: number;
  if (affine) {
    maxPixelsPerLocalUnit = direction
      ? Math.hypot((m0 * direction[0] + m4 * direction[1]) * width * .5 / m15,
        (m1 * direction[0] + m5 * direction[1]) * height * .5 / m15)
      : affinePlanarPixelsPerLocalUnit(localToClip, width, height);
    if (direction && baseline) {
      const ux = (m0 * baseline[0] + m4 * baseline[1]) * width * .5 / m15;
      const uy = (m1 * baseline[0] + m5 * baseline[1]) * height * .5 / m15;
      const vx = (m0 * direction[0] + m4 * direction[1]) * width * .5 / m15;
      const vy = (m1 * direction[0] + m5 * direction[1]) * height * .5 / m15;
      const length = Math.hypot(ux, uy);
      if (length > 0) maxPixelsPerLocalUnit = Math.abs(ux * vy - uy * vx) / length;
    }
    minPixelsPerLocalUnit = maxPixelsPerLocalUnit;
  } else {
    // Each pixel-Jacobian entry is an affine numerator over W^2, for example
    // d(X/W)/dx = (m0*W - X*m3) / W^2. The numerator matrix N is therefore an
    // affine function of position, so its largest singular value is convex
    // and peaks at a corner, while W^2 (W > 0 here) is smallest at a corner.
    // Their ratio bounds the stretch everywhere inside the rectangle, without
    // the up-to-sqrt(2) excess of an entrywise Frobenius bound. Conversely, a
    // sign-stable entry keeps at least its smallest corner magnitude, which
    // over the largest W^2 bounds the stretch from below.
    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;
    let maxNumeratorSigma = 0;
    let minBaseX = Infinity, maxBaseX = -Infinity, minBaseY = Infinity, maxBaseY = -Infinity;
    let maxBaseLength = 0;
    let maxW2 = 0;
    let minA = Number.POSITIVE_INFINITY, maxA = Number.NEGATIVE_INFINITY;
    let minB = Number.POSITIVE_INFINITY, maxB = Number.NEGATIVE_INFINITY;
    let minC = Number.POSITIVE_INFINITY, maxC = Number.NEGATIVE_INFINITY;
    let minD = Number.POSITIVE_INFINITY, maxD = Number.NEGATIVE_INFINITY;
    for (let corner = 0; corner < 4; corner += 1) {
      const x = (corner & 1) === 0 ? bounds.minX : bounds.maxX;
      const y = (corner & 2) === 0 ? bounds.minY : bounds.maxY;
      const clipX = m0 * x + m4 * y + m12;
      const clipY = m1 * x + m5 * y + m13;
      const clipW = m3 * x + m7 * y + m15;
      let a = (m0 * clipW - clipX * m3) * halfWidth;
      let b = (m1 * clipW - clipY * m3) * halfHeight;
      let c = (m4 * clipW - clipX * m7) * halfWidth;
      let d = (m5 * clipW - clipY * m7) * halfHeight;
      if (direction && baseline) {
        const ux = a * baseline[0] + c * baseline[1], uy = b * baseline[0] + d * baseline[1];
        minBaseX = Math.min(minBaseX, ux); maxBaseX = Math.max(maxBaseX, ux);
        minBaseY = Math.min(minBaseY, uy); maxBaseY = Math.max(maxBaseY, uy);
        maxBaseLength = Math.max(maxBaseLength, Math.hypot(ux, uy));
      }
      if (direction) {
        // N times a fixed direction is affine too; its norm is convex, so
        // the same corner/min-W bound applies without a singular-value solve.
        a = a * direction[0] + c * direction[1];
        b = b * direction[0] + d * direction[1];
        c = d = 0;
        maxNumeratorSigma = Math.max(maxNumeratorSigma, Math.hypot(a, b));
      } else {
        maxNumeratorSigma = Math.max(maxNumeratorSigma, largestSingularValue2x2(a, b, c, d));
      }
      maxW2 = Math.max(maxW2, clipW * clipW);
      minA = Math.min(minA, a); maxA = Math.max(maxA, a);
      minB = Math.min(minB, b); maxB = Math.max(maxB, b);
      minC = Math.min(minC, c); maxC = Math.max(maxC, c);
      minD = Math.min(minD, d); maxD = Math.max(maxD, d);
    }
    maxPixelsPerLocalUnit = maxNumeratorSigma / (minAbsW * minAbsW);
    const minNumerator = Math.max(
      signStableMinAbs(minA, maxA),
      signStableMinAbs(minB, maxB),
      signStableMinAbs(minC, maxC),
      signStableMinAbs(minD, maxD)
    );
    minPixelsPerLocalUnit = maxW2 > 0 ? minNumerator / maxW2 : 0;
    if (direction && baseline) {
      // For homography H, det(J) = det(H) / W^3. With J*u = N*u/W^2,
      // perpendicular height is |det(H) det(u,v)| / (W |N*u|).
      // Bound W and the baseline numerator over the entire rectangle. The
      // numerator's component intervals give a safe lower norm even if its
      // direction turns; a zero bound falls back to the full height vector.
      const determinant = m0 * (m5 * m15 - m13 * m7) - m4 * (m1 * m15 - m13 * m3) +
        m12 * (m1 * m7 - m5 * m3);
      const area = Math.abs(determinant * (baseline[0] * direction[1] - baseline[1] * direction[0])) * halfWidth * halfHeight;
      const minBaseLength = Math.hypot(signStableMinAbs(minBaseX, maxBaseX), signStableMinAbs(minBaseY, maxBaseY));
      if (minBaseLength > 0) maxPixelsPerLocalUnit = Math.min(maxPixelsPerLocalUnit, area / (minW * minBaseLength));
      minPixelsPerLocalUnit = maxBaseLength > 0 ? area / (maxW * maxBaseLength) : 0;
    }
  }

  if (!Number.isFinite(maxPixelsPerLocalUnit)) {
    return writeUnstableProjection(out);
  }

  out.visible = visible;
  out.stable = true;
  out.maxPixelsPerLocalUnit = maxPixelsPerLocalUnit;
  out.minPixelsPerLocalUnit = Number.isFinite(minPixelsPerLocalUnit)
    ? Math.min(minPixelsPerLocalUnit, maxPixelsPerLocalUnit)
    : 0;
  out.minX = projectedMinX;
  out.minY = projectedMinY;
  out.maxX = projectedMaxX;
  out.maxY = projectedMaxY;
  return out;
}

/**
 * True when clip W does not vary across the plane, so every local rectangle
 * shares one pixel scale. {@link analyzePlanarBoundsProjectionInto} uses the
 * same rule for its exact affine branch.
 */
export function isAffinePlanarLocalToClip(localToClip: ArrayLike<number>): boolean {
  return localToClip.length >= 16 &&
    Math.abs(localToClip[3]) <= Number.EPSILON && Math.abs(localToClip[7]) <= Number.EPSILON;
}

/** Exact pixels per local unit of an affine planar view, for every rectangle. */
export function affinePlanarPixelsPerLocalUnit(localToClip: ArrayLike<number>, width: number, height: number): number {
  const inverseW = 1 / localToClip[15];
  return largestSingularValue2x2(
    localToClip[0] * inverseW * width * 0.5,
    localToClip[1] * inverseW * height * 0.5,
    localToClip[4] * inverseW * width * 0.5,
    localToClip[5] * inverseW * height * 0.5
  );
}

/**
 * Local-space bounds of the clip-space viewport for an affine planar view, or
 * null when the view cannot be inverted or sits at/behind the camera plane.
 */
export function affinePlanarViewportBoundsInto(localToClip: ArrayLike<number>, out: Bounds): Bounds | null {
  if (!isAffinePlanarLocalToClip(localToClip)) return null;
  const m0 = localToClip[0], m1 = localToClip[1], m4 = localToClip[4], m5 = localToClip[5];
  const m12 = localToClip[12], m13 = localToClip[13], w = localToClip[15];
  const determinant = m0 * m5 - m4 * m1;
  if (![m0, m1, m4, m5, m12, m13, w, determinant].every(Number.isFinite) || w <= CLIP_W_EPSILON ||
      Math.abs(determinant) <= Number.EPSILON * Math.max(m0 * m0 + m1 * m1, m4 * m4 + m5 * m5)) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let corner = 0; corner < 4; corner += 1) {
    // Solve [m0 m4; m1 m5] * local = clip * w - translation at each NDC corner.
    const rightX = ((corner & 1) === 0 ? -w : w) - m12;
    const rightY = ((corner & 2) === 0 ? -w : w) - m13;
    const x = (m5 * rightX - m4 * rightY) / determinant;
    const y = (m0 * rightY - m1 * rightX) / determinant;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  out.minX = minX;
  out.minY = minY;
  out.maxX = maxX;
  out.maxY = maxY;
  return out;
}

/** Smallest magnitude of an affine quantity over its corner range, or 0 if it can vanish. */
function signStableMinAbs(minimum: number, maximum: number): number {
  if (minimum > 0) return minimum;
  if (maximum < 0) return -maximum;
  return 0;
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
  out.minPixelsPerLocalUnit = 0;
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
  out.minPixelsPerLocalUnit = 0;
  out.minX = 0;
  out.minY = 0;
  out.maxX = 0;
  out.maxY = 0;
  return out;
}
