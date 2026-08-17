/**
 * Search-highlight rectangles drawn natively by the renderer, in the same
 * frame and with the same camera transform as the scene (no overlay lag).
 */
export interface SearchHighlightSet {
  /** 4 floats per rectangle: minX, minY, maxX, maxY in scene space. */
  rects: Float32Array;
  /** Number of valid rectangles in `rects`. */
  count: number;
  /** First rectangle drawn with the emphasized "current match" style, or -1. */
  currentIndex: number;
  /** Consecutive emphasized rectangles. Defaults to 1 for backward compatibility. */
  currentCount?: number;
}

export interface PreparedSearchHighlights {
  otherRects: Float32Array;
  otherCount: number;
  currentRects: Float32Array;
  currentCount: number;
}

/** Validates a flat payload and separates its normal/current draw batches. */
export function prepareSearchHighlights(
  highlights: SearchHighlightSet | null
): PreparedSearchHighlights | null {
  const requestedCount = highlights ? Math.floor(highlights.count) : 0;
  const count =
    highlights && Number.isFinite(requestedCount)
      ? Math.min(Math.max(0, requestedCount), Math.floor(highlights.rects.length / 4))
      : 0;
  if (!highlights || count === 0) {
    return null;
  }

  const requestedCurrentIndex = Math.floor(highlights.currentIndex);
  const currentIndex =
    requestedCurrentIndex >= 0 && requestedCurrentIndex < count ? requestedCurrentIndex : -1;
  const requestedCurrentCount = Math.floor(highlights.currentCount ?? 1);
  const normalizedCurrentCount = Number.isFinite(requestedCurrentCount)
    ? Math.max(1, requestedCurrentCount)
    : 1;
  const currentCount =
    currentIndex >= 0 ? Math.min(normalizedCurrentCount, count - currentIndex) : 0;
  const currentEnd = currentIndex + currentCount;
  const otherCount = count - currentCount;
  const otherRects = new Float32Array(otherCount * 4);
  let otherIndex = 0;
  for (let rectIndex = 0; rectIndex < count; rectIndex += 1) {
    if (rectIndex >= currentIndex && rectIndex < currentEnd) {
      continue;
    }
    otherRects.set(highlights.rects.subarray(rectIndex * 4, rectIndex * 4 + 4), otherIndex * 4);
    otherIndex += 1;
  }
  const currentRects =
    currentCount > 0
      ? highlights.rects.slice(currentIndex * 4, currentEnd * 4)
      : new Float32Array(0);
  return { otherRects, otherCount, currentRects, currentCount };
}
