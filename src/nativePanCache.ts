import type { VectorScene } from "./pdfVectorExtractor";
import { choosePdfCompositeResolution, PDF_COMPOSITE_MAX_BYTES } from "./pdfCompositeBudget";

const PAN_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const PAN_CACHE_OVERSCAN_FACTOR = 1.8;
const PAN_CACHE_BORDER_PX = 96;
const PAN_CACHE_MIN_BORDER_PX = 16;

/**
 * Full-resolution pan-cache extent, including useful overscan on both axes.
 * Its center shares the viewport's pixel grid, so rebuilding at the same
 * camera cannot shift the image by half a pixel and blur the presentation.
 */
export function chooseNativePanCacheSize(scene: VectorScene | null, viewportWidth: number, viewportHeight: number,
  maxTextureSize: number): { width: number; height: number } | null {
  if (![viewportWidth, viewportHeight, maxTextureSize].every(value => Number.isSafeInteger(value) && value > 0)) return null;
  const desired = (size: number): number => size + 2 * Math.max(PAN_CACHE_BORDER_PX,
    Math.ceil(size * (PAN_CACHE_OVERSCAN_FACTOR - 1) / 2));
  const limit = (size: number): number => size + 2 * Math.floor((maxTextureSize - size) / 2);
  const maxWidth = Math.min(desired(viewportWidth), limit(viewportWidth));
  const maxHeight = Math.min(desired(viewportHeight), limit(viewportHeight));
  if (maxWidth < viewportWidth + 2 * PAN_CACHE_MIN_BORDER_PX ||
      maxHeight < viewportHeight + 2 * PAN_CACHE_MIN_BORDER_PX) return null;

  let maxPixels = PAN_CACHE_MAX_BYTES / 4;
  if (scene?.drawRuns && scene.paintGraph) {
    // Reserve the cache alongside all estimated compositor surfaces. Enlarging
    // the viewport must not force the compositor to render at a lower pixel
    // density than the direct frame. A viewport already at the memory limit
    // therefore stays direct. Use only the surface estimate: the optional
    // compositeScale diagnostic still applies once, inside the compositor.
    const { estimatedSurfaces } = choosePdfCompositeResolution(scene, viewportWidth, viewportHeight);
    maxPixels = Math.min(maxPixels, PDF_COMPOSITE_MAX_BYTES / (4 * (estimatedSurfaces + 1)));
  }
  if (viewportWidth * viewportHeight >= maxPixels) return null;

  const extraWidth = maxWidth - viewportWidth, extraHeight = maxHeight - viewportHeight;
  let expansion = 1;
  if (maxWidth * maxHeight > maxPixels) {
    // Solve (w + expansion * dx) * (h + expansion * dy) <= maxPixels,
    // preserving the target overscan proportions while shrinking its border.
    const remaining = maxPixels - viewportWidth * viewportHeight;
    const linear = viewportWidth * extraHeight + viewportHeight * extraWidth;
    const quadratic = extraWidth * extraHeight;
    expansion = 2 * remaining / (linear + Math.sqrt(linear * linear + 4 * quadratic * remaining));
  }
  const width = viewportWidth + 2 * Math.floor(extraWidth * expansion / 2);
  const height = viewportHeight + 2 * Math.floor(extraHeight * expansion / 2);
  if (width < viewportWidth + 2 * PAN_CACHE_MIN_BORDER_PX ||
      height < viewportHeight + 2 * PAN_CACHE_MIN_BORDER_PX || width * height > maxPixels) return null;
  return { width, height };
}
