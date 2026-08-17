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
