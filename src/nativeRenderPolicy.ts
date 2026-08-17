/**
 * Native rendering choices that must stay aligned across the WebGL and WebGPU
 * implementations. This module is internal and is not exported by the package.
 */

const TEXT_HEAVY_INSTANCE_THRESHOLD = 100_000;

/**
 * Supersampled vector minification changes the effective coverage filter and
 * glyph-atlas cutoff. Direct rendering is the cross-backend parity contract,
 * so keep the legacy 2x path dormant.
 */
export const NATIVE_VECTOR_MINIFY_ENABLED = false;

/** A book-like scene that benefits from pan caching even without stroke data. */
export function isNativeTextHeavyStrokeFreeScene(
  textInstanceCount: number,
  strokeSegmentCount: number
): boolean {
  return textInstanceCount > TEXT_HEAVY_INSTANCE_THRESHOLD && strokeSegmentCount === 0;
}

/**
 * Decide whether a native frame may reuse the oversized pan cache.
 *
 * Zoom must render directly: scaling the previous cache postpones both text-LOD
 * selection and glyph-atlas sampling until the damped camera settles, producing
 * a visible late "sharpen" step. Translation-only drag and inertia may still
 * reuse the cache because they do not change the screen-space text scale.
 */
export function shouldUseNativePanCacheForFrame(
  sceneEligible: boolean,
  vectorLodActive: boolean,
  panInteracting: boolean,
  cameraAnimating: boolean,
  zoomAnimating: boolean
): boolean {
  if (!sceneEligible || vectorLodActive || zoomAnimating) {
    return false;
  }
  return panInteracting || cameraAnimating;
}
