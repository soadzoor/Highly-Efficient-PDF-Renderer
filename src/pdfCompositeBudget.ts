import type { VectorScene } from "./pdfVectorExtractor";
import { normalizeScenePaintGraph, type ScenePaintNode } from "./scenePaintGraph";

export const PDF_COMPOSITE_MAX_BYTES = 512 * 1024 * 1024;

/**
 * Opt-in diagnostic that shrinks every transient composite surface, set either
 * as a global or as `?compositeScale=0.5`, which survives a reload. Paint
 * graph, batching, draw calls and pass counts all stay exactly as they are;
 * only the number of pixels each pass touches changes. Comparing frame times
 * at two scales therefore says how much of a frame is composite fill rather
 * than command submission, without the flat rendering `?noComposite=1` gives.
 */
function debugCompositeScale(): number {
  const host = globalThis as { HEPR_DEBUG_COMPOSITE_SCALE?: number; location?: { search?: unknown } };
  let value = host.HEPR_DEBUG_COMPOSITE_SCALE;
  if (value === undefined && typeof host.location?.search === "string") {
    const parameter = new URLSearchParams(host.location.search).get("compositeScale");
    if (parameter !== null) value = Number(parameter);
  }
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1 ? value : 1;
}

/** Conservative concurrent surface estimate, including masks, ping-pong buffers and the final copy. */
export function choosePdfCompositeResolution(scene: VectorScene, width: number, height: number,
  byteBudget = PDF_COMPOSITE_MAX_BYTES, bytesPerPixel = 4): { width: number; height: number; scale: number; estimatedSurfaces: number } {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
      !Number.isFinite(byteBudget) || byteBudget <= 0 || !Number.isFinite(bytesPerPixel) || bytesPerPixel <= 0)
    throw new RangeError("Invalid PDF composite viewport or byte budget.");
  const depth = (nodes: readonly ScenePaintNode[], level: number): number => {
    if (level > 64) throw new RangeError("PDF compositor exceeds its group nesting budget.");
    let maximum = level;
    for (const node of nodes) if (node.kind === "group") {
      maximum = Math.max(maximum, depth(node.children, level + 1));
      if (node.softMask) maximum = Math.max(maximum, depth(node.softMask.children, level + 2));
    }
    return maximum;
  };
  // The compositor walks the normalized graph, which has no pass-through groups
  // left to nest, so the levels it actually allocates for are counted there.
  const estimatedSurfaces = 8 * (depth(normalizeScenePaintGraph(scene), 0) + 1) + 8;
  const scale = Math.min(1, Math.sqrt(byteBudget / (width * height * bytesPerPixel * estimatedSurfaces)))
    * debugCompositeScale();
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), scale, estimatedSurfaces };
}
