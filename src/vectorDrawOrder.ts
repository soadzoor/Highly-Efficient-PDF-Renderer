import { validateVectorClips } from "./vectorClips";
import type { VectorDrawRun, VectorScene } from "./pdfVectorExtractor";

export function appendVectorDrawRun(runs: VectorDrawRun[], kind: VectorDrawRun["kind"], first: number, count: number, clipIndex?: number, blendMode?: VectorDrawRun["blendMode"], optionalContent?: number): void {
  if (count === 0) return;
  const previous = runs[runs.length - 1];
  if (previous?.kind === kind && previous.clipIndex === clipIndex && previous.blendMode === blendMode && previous.optionalContent === optionalContent && previous.first + previous.count === first) previous.count += count;
  else runs.push({ kind, first, count, ...(clipIndex === undefined ? {} : { clipIndex }), ...(blendMode ? { blendMode } : {}), ...(optionalContent === undefined ? {} : { optionalContent }) });
}

/**
 * Whether two paints submit identically as one instanced range: same program,
 * same clip, same blend, over adjacent instances. Every render-time batcher
 * coalesces on exactly these terms, so the backends agree on what one draw is.
 *
 * Optional content is deliberately not part of it. Both callers have already
 * established that the paints are showing this frame, and a hidden paint
 * between them breaks the contiguity test anyway. Canonical ranges, which must
 * keep each condition addressable, are built by appendVectorDrawRun instead.
 */
export function vectorDrawRunsShareSubmission(previous: VectorDrawRun | undefined, run: VectorDrawRun): boolean {
  return previous !== undefined && previous.kind === run.kind && previous.clipIndex === run.clipIndex &&
    previous.blendMode === run.blendMode && previous.first + previous.count === run.first;
}

/** Fixed-pass order for older scenes and pages that do not need interleaving. */
export function defaultVectorDrawRuns(scene: VectorScene): VectorDrawRun[] {
  const paints: { kind: VectorDrawRun["kind"]; first: number; page: number; order: number }[] = [];
  scene.rasterLayers.forEach((layer, first) => paints.push({ kind: "raster", first,
    page: layer.pageIndex ?? 0, order: layer.paintOrder ?? first }));
  for (let first = 0; first < scene.gradientFillPathCount; first++) {
    paints.push({ kind: "gradient-fill", first, page: scene.gradientFillPaintMeta[first * 4 + 3],
      order: scene.gradientFillPaintMeta[first * 4 + 2] });
  }
  for (let first = 0; first < scene.gradientStrokeRunCount; first++) {
    paints.push({ kind: "gradient-stroke", first, page: scene.gradientStrokeRunMetaB[first * 4 + 1],
      order: scene.gradientStrokeRunMetaB[first * 4] });
  }
  paints.sort((a, b) => a.page - b.page || a.order - b.order);
  const runs: VectorDrawRun[] = [];
  for (const paint of paints) appendVectorDrawRun(runs, paint.kind, paint.first, 1);
  appendVectorDrawRun(runs, "fill", 0, scene.fillPathCount);
  appendVectorDrawRun(runs, "stroke", 0, scene.segmentCount);
  appendVectorDrawRun(runs, "text", 0, scene.textInstanceCount);
  return runs;
}

/** Validate complete, disjoint coverage without allocating a per-primitive bitmap. */
export function validateVectorDrawRuns(scene: VectorScene): void {
  validateVectorClips(scene);
  if (scene.drawRuns === undefined) {
    if (scene.clipPaths?.length) throw new Error("Vector clipping requires ordered draw runs.");
    return;
  }
  if (!Array.isArray(scene.drawRuns)) throw new Error("Invalid vector draw runs.");
  const counts: Record<VectorDrawRun["kind"], number> = {
    fill: scene.fillPathCount, stroke: scene.segmentCount, text: scene.textInstanceCount,
    raster: scene.rasterLayers.length, "gradient-fill": scene.gradientFillPathCount,
    "gradient-stroke": scene.gradientStrokeRunCount
  };
  const ranges = new Map<string, VectorDrawRun[]>();
  for (const run of scene.drawRuns) {
    if (!run || !Object.hasOwn(counts, run.kind) || !Number.isSafeInteger(run.first) || run.first < 0 ||
        !Number.isSafeInteger(run.count) || run.count <= 0 || run.first + run.count > counts[run.kind]) {
      throw new Error("Vector draw run is outside its instance store.");
    }
    if (run.optionalContent !== undefined && (!Number.isSafeInteger(run.optionalContent) || run.optionalContent < 0 || run.optionalContent >= (scene.optionalContent?.conditions.length ?? 0))) throw new Error("Invalid optional-content draw condition.");
    if (run.blendMode !== undefined && run.blendMode !== "Multiply") throw new Error("Invalid vector blend mode.");
    if (run.blendMode && run.kind.startsWith("gradient-")) throw new Error("Gradient draw runs do not support Multiply blending.");
    if (run.clipIndex !== undefined && (!Number.isSafeInteger(run.clipIndex) || run.clipIndex < 0 ||
        run.clipIndex >= (scene.clipPaths?.length ?? 0))) throw new Error("Invalid draw-run clip reference.");
    const list = ranges.get(run.kind) ?? [];
    list.push(run);
    ranges.set(run.kind, list);
  }
  for (const [kind, count] of Object.entries(counts)) {
    let next = 0;
    for (const run of (ranges.get(kind) ?? []).sort((a, b) => a.first - b.first)) {
      if (run.first !== next) throw new Error("Vector draw runs overlap or omit visible content.");
      next += run.count;
    }
    if (next !== count) throw new Error("Vector draw runs do not cover their instance store.");
  }
}

/** Keep existing batching/culling paths when their order is already equivalent. */
export function simplifyVectorDrawRuns(scene: VectorScene): void {
  validateVectorDrawRuns(scene);
  if (!scene.clipPaths?.length && scene.drawRuns && JSON.stringify(scene.drawRuns) === JSON.stringify(defaultVectorDrawRuns(scene))) {
    delete scene.drawRuns;
  }
}
