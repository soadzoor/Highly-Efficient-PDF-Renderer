import type { VectorScene } from "./pdfVectorExtractor";

/** Stroke counts only: fill edges, glyph outlines and original image pixels are separate. */
export function getSceneSegmentAccounting(scene: VectorScene) {
  const mergedAway = scene.sourceSegmentCount - scene.mergedSegmentCount;
  const culled = scene.discardedTransparentCount + scene.discardedDegenerateCount +
    scene.discardedDuplicateCount + scene.discardedContainedCount;
  const imageLayers = scene.imageLayerSegmentCount;
  // Never infer image transfers from a residual: old archives omitted cull
  // counters, and unknown pipeline changes must not masquerade as optimization.
  const complete = imageLayers !== undefined &&
    [mergedAway, culled, imageLayers, scene.segmentCount].every(
      (value) => Number.isSafeInteger(value) && value >= 0) &&
    scene.mergedSegmentCount === culled + imageLayers + scene.segmentCount;
  return { mergedAway, culled: complete ? culled : null, imageLayers: complete ? imageLayers : null };
}

export function formatSceneSegmentAccounting(scene: VectorScene): string {
  const counts = getSceneSegmentAccounting(scene);
  const merged = `merge removed ${counts.mergedAway.toLocaleString()}`;
  return counts.culled === null || counts.imageLayers === null
    ? `${merged}; cull / image-layer breakdown unavailable`
    : `${merged}; culled ${counts.culled.toLocaleString()}; image layers ${counts.imageLayers.toLocaleString()} (still painted)`;
}

export function describeSceneOperatorCount(scene: VectorScene): string {
  const kind = scene.operatorCountKind === "native-estimate" ? "native estimate"
    : scene.operatorCountKind === "mixed" ? "mixed counters" : "legacy / unspecified";
  return `${scene.operatorCount.toLocaleString()} (${kind}; engine-specific)`;
}

export const OPERATOR_COUNT_EXPLANATION = "Parser diagnostic only, not a cross-engine workload metric. " +
  "The native count estimates legacy operator-list units and includes expanded Form occurrences. " +
  "It is neither a raw PDF operator count nor a GPU draw-call count; older engines count differently.";
