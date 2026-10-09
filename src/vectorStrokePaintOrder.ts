import type { VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import { normalizeScenePaintGraph, scenePaintSpanSegments, type ScenePaintNode } from "./scenePaintGraph";
import { scenePaintRunConditions } from "./scenePaintQuery";
import { sceneRequiresPaintCompositing } from "./scenePaintVisibility";

// Runtime metadata only: never serialized into a PDF/HEP scene.
const origins = new WeakMap<VectorScene, Uint32Array>();
const groups = new WeakMap<VectorScene, Uint32Array>();
const operationGroups = new WeakMap<VectorScene, Uint32Array>();
const sourceOrderedGraphs = new WeakMap<VectorScene, boolean>();
const overviewEligibility = new WeakMap<VectorScene, boolean>();

/** Budget approximations remain inside ordinary source-over or isolated Darken surfaces. */
export function strokeLodOverviewAllowed(scene: VectorScene): boolean {
  const cached = overviewEligibility.get(scene);
  if (cached !== undefined) return cached;
  let allowed = !scene.drawRuns?.some(run => run.blendMode);
  if (allowed && sceneRequiresPaintCompositing(scene)) {
    const visit = (nodes: readonly ScenePaintNode[]): boolean => nodes.every(node => node.kind !== "group" ||
      (node.alpha === 1 && !node.knockout && !node.softMask &&
        (node.blendMode === "Normal" || (node.blendMode === "Darken" && node.isolated)) && visit(node.children)));
    allowed = Boolean(scene.paintGraph && scene.drawRuns && paintGraphRunsInSourceOrder(scene) &&
      visit(normalizeScenePaintGraph(scene)));
  }
  overviewEligibility.set(scene, allowed);
  return allowed;
}

/** A reordered graph can put another paint between adjacent canonical runs. */
function paintGraphRunsInSourceOrder(scene: VectorScene): boolean {
  const cached = sourceOrderedGraphs.get(scene);
  if (cached !== undefined) return cached;
  const runs = scene.drawRuns ?? [];
  const retainedRuns = new Map<number, number>();
  runs.forEach((run, index) => { if (run.kind === "raster" && run.count === 1) retainedRuns.set(run.first, index); });
  let nextRun = 0;
  const visit = (nodes: readonly ScenePaintNode[]): boolean => {
    for (const node of nodes) {
      if (node.kind === "group") {
        if ((node.softMask && !visit(node.softMask.children)) || !visit(node.children)) return false;
      } else if ((node.kind === "draw" ? node.runIndex : retainedRuns.get(node.rasterIndex)) !== nextRun++) return false;
    }
    return true;
  };
  const ordered = visit(normalizeScenePaintGraph(scene)) && nextRun === runs.length;
  sourceOrderedGraphs.set(scene, ordered);
  return ordered;
}

export function strokePaintOrigins(scene: VectorScene): Uint32Array | undefined {
  if (!scene.drawRuns) return origins.get(scene);
  let result = origins.get(scene);
  if (!result) {
    result = new Uint32Array(scene.segmentCount);
    for (let index = 0; index < result.length; index++) result[index] = index;
    origins.set(scene, result);
  }
  return result;
}

export function setStrokePaintOrigins(scene: VectorScene, values?: Uint32Array): void {
  if (values) origins.set(scene, values);
}

/**
 * Explicit paint origins only. A scene with draw runs and none is canonical:
 * each stroke is its own origin, which needs no identity table.
 */
export function explicitStrokePaintOrigins(scene: VectorScene): Uint32Array | undefined {
  return origins.get(scene);
}

/** Whether strokes carry paint origins, explicit or implied by draw runs. */
export function hasStrokePaintOrigins(scene: VectorScene): boolean {
  return origins.has(scene) || scene.drawRuns !== undefined;
}

/** Paint origin of one stroke, without allocating an identity table. */
export function strokePaintOrigin(scene: VectorScene, index: number): number | undefined {
  const explicit = origins.get(scene);
  return explicit ? explicit[index] : scene.drawRuns ? index : undefined;
}

/** Paint groups are only needed while simplifying; recompute them on demand. */
export function releaseStrokePaintGroups(scene: VectorScene): void {
  groups.delete(scene);
  operationGroups.delete(scene);
}

/** Install groups computed before a worker drops unrelated scene payloads. */
export function setStrokePaintGroups(scene: VectorScene, values?: Uint32Array): void {
  if (values) groups.set(scene, values);
}

/** Merge within one clip, visibility condition, compositor span and opaque color; false retains each paint operation. */
export function strokePaintGroups(scene: VectorScene, mergeCompatibleRuns = true): Uint32Array | undefined {
  if (!scene.drawRuns) return undefined;
  const cache = mergeCompatibleRuns ? groups : operationGroups;
  let result = cache.get(scene);
  if (result) return result;
  result = new Uint32Array(scene.segmentCount);
  const spans = mergeCompatibleRuns && scene.paintGraph && paintGraphRunsInSourceOrder(scene)
    ? scenePaintSpanSegments(scene) : null;
  let previousRun: VectorDrawRun | undefined;
  let previousRunIndex = -1;
  let previousConditions: number[] | undefined;
  for (let runIndex = 0; runIndex < scene.drawRuns.length; runIndex++) {
    const run = scene.drawRuns[runIndex];
    if (run.kind !== "stroke") { previousRun = undefined; previousConditions = undefined; continue; }
    let group = run.first;
    let conditions: number[] | undefined;
    if (spans && previousRun && previousRunIndex === runIndex - 1 &&
        previousRun.first + previousRun.count === run.first && spans[previousRunIndex] === spans[runIndex] &&
        !run.blendMode && !previousRun.blendMode && previousRun.clipIndex === run.clipIndex &&
        previousRun.optionalContent === run.optionalContent &&
        previousRun.pdfRepresentation?.pageIndex === run.pdfRepresentation?.pageIndex &&
        previousRun.pdfRepresentation?.detail === run.pdfRepresentation?.detail &&
        sameOpaqueStrokeStyle(scene, run.first - 1, run.first)) {
      previousConditions ??= scenePaintRunConditions(scene, previousRun, false).sort((a, b) => a - b);
      conditions = scenePaintRunConditions(scene, run, false).sort((a, b) => a - b);
      if (previousConditions.length === conditions.length &&
          previousConditions.every((condition, index) => condition === conditions![index])) group = result[run.first - 1];
    }
    for (let index = run.first; index < run.first + run.count; index++) {
      const offset = index * 4;
      const packed = scene.primitiveMeta[offset + 3];
      const alpha = packed - Math.floor(packed / 2 + 1e-6) * 2;
      if (index > run.first && (alpha < 0.999 || packed !== scene.primitiveMeta[offset - 1] ||
          scene.styles[offset + 1] !== scene.styles[offset - 3] ||
          scene.styles[offset + 2] !== scene.styles[offset - 2] ||
          scene.styles[offset + 3] !== scene.styles[offset - 1])) group = index;
      result[index] = group;
    }
    previousRun = run;
    previousRunIndex = runIndex;
    previousConditions = conditions;
  }
  cache.set(scene, result);
  return result;
}

function sameOpaqueStrokeStyle(scene: VectorScene, previous: number, current: number): boolean {
  const a = previous * 4, b = current * 4;
  const packed = scene.primitiveMeta[b + 3];
  const alpha = packed - Math.floor(packed / 2 + 1e-6) * 2;
  return alpha === 1 && packed === scene.primitiveMeta[a + 3] &&
    scene.styles[b + 1] === scene.styles[a + 1] && scene.styles[b + 2] === scene.styles[a + 2] &&
    scene.styles[b + 3] === scene.styles[a + 3];
}
