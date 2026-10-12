/** Temporary diagnostic modes; other paint kinds and the camera stay unchanged. */
export type VectorRenderComparisonMode = "all" | "fills" | "strokes" | "none";

interface VectorRenderComparisonTarget {
  setFillRenderingEnabled?(enabled: boolean): void;
  setStrokeRenderingEnabled?(enabled: boolean): void;
}

/** Validate before stopping a capture or changing either switch. */
export function setVectorRenderComparison(
  target: VectorRenderComparisonTarget,
  mode: VectorRenderComparisonMode,
  beforeChange: () => void
): { mode: VectorRenderComparisonMode; fillRendering: boolean; strokeRendering: boolean } {
  if (mode !== "all" && mode !== "fills" && mode !== "strokes" && mode !== "none") {
    throw new TypeError('Vector comparison must be "all", "fills", "strokes" or "none".');
  }
  if (!target.setFillRenderingEnabled || !target.setStrokeRenderingEnabled) {
    throw new Error("This renderer does not support fill/stroke comparisons.");
  }
  const fillRendering = mode === "all" || mode === "fills";
  const strokeRendering = mode === "all" || mode === "strokes";
  beforeChange();
  target.setFillRenderingEnabled(fillRendering);
  target.setStrokeRenderingEnabled(strokeRendering);
  return { mode, fillRendering, strokeRendering };
}
