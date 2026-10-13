/** Drawings with at least this many paints keep an offscreen culling margin. */
export const GUARDED_RUN_COUNT = 1024;

/**
 * That margin in screen pixels. Native run culling, Three.js fill culling and
 * the stroke LOD share it, so they select again on the same frames. While the
 * view stays inside it, panning reuses the selected instances. Offscreen
 * instances cost vertex work only; a wider margin trades that, and a larger
 * selection when it is rebuilt, for fewer rebuilds.
 */
export const VISIBILITY_GUARD_PIXELS = 256;
