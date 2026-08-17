import type { Bounds, PageTextIndex, VectorScene } from "./pdfVectorExtractor";

/**
 * Breathing room added around text bounds so highlights don't hug the glyph
 * ink. Proportional to the text height (em-relative), so it scales with the
 * text at every zoom. Horizontally half of the vertical padding looks best.
 */
export const TEXT_BOUNDS_VERTICAL_PADDING_FACTOR = 0.12;
export const TEXT_BOUNDS_HORIZONTAL_PADDING_FACTOR = TEXT_BOUNDS_VERTICAL_PADDING_FACTOR * 0.5;

/** Chars join a line fragment when their ink boxes overlap by this share. */
const TEXT_LINE_VERTICAL_OVERLAP_FACTOR = 0.5;
/** Baseline jitter tolerated within one line, relative to glyph height. */
const TEXT_LINE_BASELINE_TOLERANCE_FACTOR = 0.5;
/** Minimum absolute direction alignment for glyphs to share an oriented baseline. */
const TEXT_LINE_DIRECTION_DOT_MIN = 0.98;
/** Maximum center step used to infer an unseparated fallback-glyph direction. */
const TEXT_LINE_FALLBACK_STEP_FACTOR = 4;

/**
 * Writes the scene-space AABB of one indexed character into `out` as
 * minX, minY, maxX, maxY at out[outOffset..outOffset+3].
 *
 * Chars referencing a text instance get the glyph ink box (textGlyphMetaA/B)
 * transformed by the instance matrix — the same math the extractor used to
 * render the glyph — and fallback chars use their stored quad. Returns false
 * for separators (charInstance -1) and invalid references; `out` is left
 * untouched in that case.
 */
export function computeCharQuad(
  scene: VectorScene,
  page: PageTextIndex,
  charIndex: number,
  out: Float32Array,
  outOffset: number
): boolean {
  const ref = page.charInstance[charIndex];
  if (ref === -1 || ref === undefined) {
    return false;
  }

  if (ref <= -2) {
    const q = (-ref - 2) * 4;
    const fallbackQuads = page.fallbackQuads;
    if (q + 3 >= fallbackQuads.length) {
      return false;
    }
    out[outOffset] = fallbackQuads[q];
    out[outOffset + 1] = fallbackQuads[q + 1];
    out[outOffset + 2] = fallbackQuads[q + 2];
    out[outOffset + 3] = fallbackQuads[q + 3];
    return true;
  }

  const instanceA = scene.textInstanceA;
  const instanceB = scene.textInstanceB;
  const glyphMetaA = scene.textGlyphMetaA;
  const glyphMetaB = scene.textGlyphMetaB;

  const o = ref * 4;
  if (o + 3 >= instanceA.length || o + 3 >= instanceB.length) {
    return false;
  }
  const a = instanceA[o];
  const b = instanceA[o + 1];
  const c = instanceA[o + 2];
  const d = instanceA[o + 3];
  const e = instanceB[o];
  const f = instanceB[o + 1];
  const g = Math.trunc(instanceB[o + 2]) * 4;
  if (g < 0 || g + 3 >= glyphMetaA.length || g + 1 >= glyphMetaB.length) {
    return false;
  }
  const inkMinX = glyphMetaA[g + 2];
  const inkMinY = glyphMetaA[g + 3];
  const inkMaxX = glyphMetaB[g];
  const inkMaxY = glyphMetaB[g + 1];

  const x00 = a * inkMinX + c * inkMinY + e;
  const y00 = b * inkMinX + d * inkMinY + f;
  const x01 = a * inkMinX + c * inkMaxY + e;
  const y01 = b * inkMinX + d * inkMaxY + f;
  const x10 = a * inkMaxX + c * inkMinY + e;
  const y10 = b * inkMaxX + d * inkMinY + f;
  const x11 = a * inkMaxX + c * inkMaxY + e;
  const y11 = b * inkMaxX + d * inkMaxY + f;

  out[outOffset] = Math.min(x00, x01, x10, x11);
  out[outOffset + 1] = Math.min(y00, y01, y10, y11);
  out[outOffset + 2] = Math.max(x00, x01, x10, x11);
  out[outOffset + 3] = Math.max(y00, y01, y10, y11);
  return true;
}

const charQuadScratch = new Float32Array(4);
const charBaselineScratch = new Float64Array(4);

/** Writes pen origin x/y and normalized baseline direction x/y. */
function computeCharBaseline(
  scene: VectorScene,
  page: PageTextIndex,
  charIndex: number,
  out: Float64Array
): boolean {
  const ref = page.charInstance[charIndex];
  if (ref === undefined || ref < 0) {
    return false;
  }
  const offset = ref * 4;
  if (offset + 1 >= scene.textInstanceA.length || offset + 1 >= scene.textInstanceB.length) {
    return false;
  }
  const directionX = scene.textInstanceA[offset];
  const directionY = scene.textInstanceA[offset + 1];
  const directionLength = Math.hypot(directionX, directionY);
  if (!Number.isFinite(directionLength) || directionLength <= 1e-12) {
    return false;
  }
  out[0] = scene.textInstanceB[offset];
  out[1] = scene.textInstanceB[offset + 1];
  out[2] = directionX / directionLength;
  out[3] = directionY / directionLength;
  return Number.isFinite(out[0]) && Number.isFinite(out[1]);
}

function minBoundsProjection(bounds: Bounds, axisX: number, axisY: number): number {
  return (
    axisX * (axisX >= 0 ? bounds.minX : bounds.maxX) +
    axisY * (axisY >= 0 ? bounds.minY : bounds.maxY)
  );
}

function maxBoundsProjection(bounds: Bounds, axisX: number, axisY: number): number {
  return (
    axisX * (axisX >= 0 ? bounds.maxX : bounds.minX) +
    axisY * (axisY >= 0 ? bounds.maxY : bounds.minY)
  );
}

function boundsProjectionExtent(bounds: Bounds, axisX: number, axisY: number): number {
  return maxBoundsProjection(bounds, axisX, axisY) - minBoundsProjection(bounds, axisX, axisY);
}

function projectionRangesOverlap(
  aMin: number,
  aMax: number,
  bMin: number,
  bMax: number
): boolean {
  const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
  const smallerExtent = Math.min(aMax - aMin, bMax - bMin);
  return overlap >= smallerExtent * TEXT_LINE_VERTICAL_OVERLAP_FACTOR;
}

function boundsOverlapOnAxis(a: Bounds, b: Bounds, axisX: number, axisY: number): boolean {
  const aMin = minBoundsProjection(a, axisX, axisY);
  const aMax = maxBoundsProjection(a, axisX, axisY);
  const bMin = minBoundsProjection(b, axisX, axisY);
  const bMax = maxBoundsProjection(b, axisX, axisY);
  return projectionRangesOverlap(aMin, aMax, bMin, bMax);
}

function fallbackQuadsLikelyShareLine(a: Bounds, b: Bounds, afterSeparator: boolean): boolean {
  if (afterSeparator) {
    // With only one glyph before the separator there is no reliable line
    // direction yet. Splitting is conservative: it may leave adjacent word
    // fragments separate, but can never recreate a row-spanning wrap box.
    return false;
  }
  if (boundsOverlapOnAxis(a, b, 1, 0) || boundsOverlapOnAxis(a, b, 0, 1)) {
    return true;
  }
  const dx = (b.minX + b.maxX - a.minX - a.maxX) * 0.5;
  const dy = (b.minY + b.maxY - a.minY - a.maxY) * 0.5;
  const aDiagonal = Math.hypot(a.maxX - a.minX, a.maxY - a.minY);
  const bDiagonal = Math.hypot(b.maxX - b.minX, b.maxY - b.minY);
  return Math.hypot(dx, dy) <= Math.max(aDiagonal, bDiagonal, 1e-6) * TEXT_LINE_FALLBACK_STEP_FACTOR;
}

function padTextBounds(
  bounds: Bounds,
  directionX: number | null,
  directionY: number | null,
  lineThickness: number
): Bounds {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (width <= 0 || height <= 0) {
    const inflate = 0.5;
    return {
      minX: bounds.minX - inflate,
      minY: bounds.minY - inflate,
      maxX: bounds.maxX + inflate,
      maxY: bounds.maxY + inflate
    };
  }
  let horizontalPadding: number;
  let verticalPadding: number;
  if (
    directionX !== null &&
    directionY !== null &&
    Number.isFinite(lineThickness) &&
    lineThickness > 0
  ) {
    const normalX = -directionY;
    const normalY = directionX;
    const alongPadding = lineThickness * TEXT_BOUNDS_HORIZONTAL_PADDING_FACTOR;
    const normalPadding = lineThickness * TEXT_BOUNDS_VERTICAL_PADDING_FACTOR;
    horizontalPadding = Math.abs(directionX) * alongPadding + Math.abs(normalX) * normalPadding;
    verticalPadding = Math.abs(directionY) * alongPadding + Math.abs(normalY) * normalPadding;
  } else {
    verticalPadding = height * TEXT_BOUNDS_VERTICAL_PADDING_FACTOR;
    horizontalPadding = height * TEXT_BOUNDS_HORIZONTAL_PADDING_FACTOR;
  }
  return {
    minX: bounds.minX - horizontalPadding,
    minY: bounds.minY - verticalPadding,
    maxX: bounds.maxX + horizontalPadding,
    maxY: bounds.maxY + verticalPadding
  };
}

/**
 * Scene-space highlight rectangles for a character range, split at visual
 * line boundaries. Instanced glyph baselines provide the line direction;
 * fallback-only runs infer it from neighboring glyphs. Unknown directions are
 * split conservatively at separators so wrapped phrases never fill whole rows.
 */
export function computeCharRangeHighlightBounds(
  scene: VectorScene,
  page: PageTextIndex,
  startChar: number,
  length: number
): Bounds[] {
  const rects: Bounds[] = [];
  let current: Bounds | null = null;
  let previousQuad: Bounds | null = null;
  let currentHasDirection = false;
  let currentBaselineExact = false;
  let currentDirectionX = 0;
  let currentDirectionY = 0;
  let currentBaselineOffset = 0;
  let currentNormalMin = 0;
  let currentNormalMax = 0;
  let currentMaxThickness = 0;
  let separatorSincePrevious = false;

  const setDirectionFromBaseline = (quad: Bounds, includePrevious: Bounds | null): void => {
    currentHasDirection = true;
    currentBaselineExact = true;
    currentDirectionX = charBaselineScratch[2];
    currentDirectionY = charBaselineScratch[3];
    const normalX = -currentDirectionY;
    const normalY = currentDirectionX;
    currentBaselineOffset = normalX * charBaselineScratch[0] + normalY * charBaselineScratch[1];
    currentNormalMin = minBoundsProjection(quad, normalX, normalY);
    currentNormalMax = maxBoundsProjection(quad, normalX, normalY);
    currentMaxThickness = boundsProjectionExtent(quad, normalX, normalY);
    if (includePrevious) {
      currentNormalMin = Math.min(
        currentNormalMin,
        minBoundsProjection(includePrevious, normalX, normalY)
      );
      currentNormalMax = Math.max(
        currentNormalMax,
        maxBoundsProjection(includePrevious, normalX, normalY)
      );
      currentMaxThickness = Math.max(
        currentMaxThickness,
        boundsProjectionExtent(includePrevious, normalX, normalY)
      );
    }
  };

  const inferDirectionFromFallbackQuads = (previous: Bounds, next: Bounds): void => {
    const dx = (next.minX + next.maxX - previous.minX - previous.maxX) * 0.5;
    const dy = (next.minY + next.maxY - previous.minY - previous.maxY) * 0.5;
    const distance = Math.hypot(dx, dy);
    if (!Number.isFinite(distance) || distance <= 1e-12) {
      return;
    }
    currentHasDirection = true;
    currentBaselineExact = false;
    currentDirectionX = dx / distance;
    currentDirectionY = dy / distance;
    const normalX = -currentDirectionY;
    const normalY = currentDirectionX;
    currentNormalMin = Math.min(
      minBoundsProjection(previous, normalX, normalY),
      minBoundsProjection(next, normalX, normalY)
    );
    currentNormalMax = Math.max(
      maxBoundsProjection(previous, normalX, normalY),
      maxBoundsProjection(next, normalX, normalY)
    );
    currentMaxThickness = Math.max(
      boundsProjectionExtent(previous, normalX, normalY),
      boundsProjectionExtent(next, normalX, normalY)
    );
  };

  const updateOrientedLineBounds = (quad: Bounds): void => {
    const normalX = -currentDirectionY;
    const normalY = currentDirectionX;
    currentNormalMin = Math.min(currentNormalMin, minBoundsProjection(quad, normalX, normalY));
    currentNormalMax = Math.max(currentNormalMax, maxBoundsProjection(quad, normalX, normalY));
    currentMaxThickness = Math.max(
      currentMaxThickness,
      boundsProjectionExtent(quad, normalX, normalY)
    );
  };

  const flushCurrent = (): void => {
    if (current) {
      rects.push(
        padTextBounds(
          current,
          currentHasDirection ? currentDirectionX : null,
          currentHasDirection ? currentDirectionY : null,
          currentMaxThickness
        )
      );
      current = null;
      previousQuad = null;
      currentHasDirection = false;
      currentBaselineExact = false;
      currentMaxThickness = 0;
    }
  };

  const end = Math.min(startChar + length, page.charInstance.length);
  for (let i = Math.max(0, startChar); i < end; i += 1) {
    if (!computeCharQuad(scene, page, i, charQuadScratch, 0)) {
      if (page.charInstance[i] === -1) {
        separatorSincePrevious = true;
      }
      continue;
    }
    const minX = charQuadScratch[0];
    const minY = charQuadScratch[1];
    const maxX = charQuadScratch[2];
    const maxY = charQuadScratch[3];
    const quad = { minX, minY, maxX, maxY };
    const hasBaseline = computeCharBaseline(scene, page, i, charBaselineScratch);

    if (current) {
      let joinsLine: boolean;
      if (currentHasDirection) {
        const normalX = -currentDirectionY;
        const normalY = currentDirectionX;
        const nextNormalMin = minBoundsProjection(quad, normalX, normalY);
        const nextNormalMax = maxBoundsProjection(quad, normalX, normalY);
        if (hasBaseline) {
          const alignment = Math.abs(
            charBaselineScratch[2] * currentDirectionX + charBaselineScratch[3] * currentDirectionY
          );
          if (currentBaselineExact) {
            const nextBaselineOffset =
              normalX * charBaselineScratch[0] + normalY * charBaselineScratch[1];
            const nextThickness = nextNormalMax - nextNormalMin;
            const tolerance =
              Math.min(nextThickness, currentMaxThickness) * TEXT_LINE_BASELINE_TOLERANCE_FACTOR;
            joinsLine =
              alignment >= TEXT_LINE_DIRECTION_DOT_MIN &&
              Math.abs(nextBaselineOffset - currentBaselineOffset) <= tolerance;
          } else {
            joinsLine =
              alignment >= TEXT_LINE_DIRECTION_DOT_MIN &&
              projectionRangesOverlap(
                currentNormalMin,
                currentNormalMax,
                nextNormalMin,
                nextNormalMax
              );
          }
        } else {
          joinsLine = projectionRangesOverlap(
            currentNormalMin,
            currentNormalMax,
            nextNormalMin,
            nextNormalMax
          );
        }
      } else {
        joinsLine =
          previousQuad !== null &&
          fallbackQuadsLikelyShareLine(previousQuad, quad, separatorSincePrevious);
      }
      if (!joinsLine) {
        flushCurrent();
      }
    }

    if (!current) {
      current = quad;
      previousQuad = quad;
      if (hasBaseline) {
        setDirectionFromBaseline(quad, null);
      }
      separatorSincePrevious = false;
      continue;
    }

    if (!currentHasDirection) {
      if (hasBaseline) {
        setDirectionFromBaseline(quad, previousQuad);
      } else if (previousQuad) {
        inferDirectionFromFallbackQuads(previousQuad, quad);
      }
    } else {
      updateOrientedLineBounds(quad);
    }
    current.minX = Math.min(current.minX, minX);
    current.minY = Math.min(current.minY, minY);
    current.maxX = Math.max(current.maxX, maxX);
    current.maxY = Math.max(current.maxY, maxY);
    previousQuad = quad;
    separatorSincePrevious = false;
  }
  flushCurrent();
  return rects;
}

/**
 * Scene-space union of the character quads over [startChar, startChar+length)
 * plus em-relative padding. Char bounds are derived on demand; nothing
 * per-character is materialized up front.
 */
export function computeCharRangeBounds(
  scene: VectorScene,
  page: PageTextIndex,
  startChar: number,
  length: number
): Bounds {
  const rects = computeCharRangeHighlightBounds(scene, page, startChar, length);
  if (rects.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  let minX = rects[0].minX;
  let minY = rects[0].minY;
  let maxX = rects[0].maxX;
  let maxY = rects[0].maxY;
  for (let i = 1; i < rects.length; i += 1) {
    minX = Math.min(minX, rects[i].minX);
    minY = Math.min(minY, rects[i].minY);
    maxX = Math.max(maxX, rects[i].maxX);
    maxY = Math.max(maxY, rects[i].maxY);
  }
  return { minX, minY, maxX, maxY };
}
