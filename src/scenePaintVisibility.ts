import type { VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import { createDefaultOptionalContentSnapshot, type OptionalContentSnapshot } from "./optionalContent";
import type { ScenePaintNode } from "./scenePaintGraph";
import { isScenePaintRunVisible } from "./scenePaintQuery";

const compositeRequirements = new WeakMap<VectorScene, boolean>();

/**
 * Opt-in A/B switch for diagnosing frame cost, set either as a global before
 * a document loads or as `?noComposite=1`, which survives the reload that
 * opening a document does. Paints then reach the canvas in source order with
 * no transparency groups at all, so group opacity, soft masks and blend modes
 * render wrong - but the frame shows what compositing costs as opposed to what
 * the document's geometry costs.
 */
function paintCompositingDisabled(): boolean {
  const host = globalThis as { HEPR_DEBUG_DISABLE_COMPOSITING?: boolean; location?: { search?: unknown } };
  if (host.HEPR_DEBUG_DISABLE_COMPOSITING === true) return true;
  return typeof host.location?.search === "string" && new URLSearchParams(host.location.search).has("noComposite");
}

/** Ordinary source-over groups need no intermediate surfaces, even when isolated. */
export function sceneRequiresPaintCompositing(scene: VectorScene): boolean {
  if (!scene.paintGraph) return false;
  // Eligibility is decided once per view, so nothing is cached while the
  // diagnostic switch is on and turning it back off restores the real answer.
  if (paintCompositingDisabled()) return false;
  const cached = compositeRequirements.get(scene);
  if (cached !== undefined) return cached;
  const runs = scene.drawRuns ?? [];
  let nextRun = 0;
  const flat = (nodes: readonly ScenePaintNode[]): boolean => {
    for (const node of nodes) {
      if (node.kind === "group") {
        // Isolation is immaterial only when every descendant uses Normal
        // source-over. Reject the whole shortcut if any descendant has effects.
        if (node.alpha !== 1 || node.knockout || node.softMask || node.blendMode !== "Normal" || !flat(node.children)) return false;
      } else {
        const run = runs[nextRun];
        if (!run || (node.kind === "draw" ? node.runIndex !== nextRun :
          run.kind !== "raster" || run.first !== node.rasterIndex || run.count !== 1) || run.blendMode) return false;
        nextRun++;
      }
    }
    return true;
  };
  const result = !flat(scene.paintGraph.roots) || nextRun !== runs.length;
  compositeRequirements.set(scene, result);
  return result;
}

/**
 * Per-view, per-revision eligibility. Canonical runs and geometry are untouched.
 * The all-visible case returns the original culling result without a frame-time
 * scan or allocation. Partial culling arrays may be mutated in place by callers.
 */
export class ScenePaintVisibility {
  readonly requiresCompositing: boolean;
  readonly orderedRuns: readonly VectorDrawRun[];
  private snapshot: OptionalContentSnapshot | null = null;
  private readonly eligible = new Set<VectorDrawRun>();
  private visibleRuns: readonly VectorDrawRun[] = [];
  private readonly selected: VectorDrawRun[] = [];
  private allVisible = true;
  private readonly scene: VectorScene;
  private readonly defaults: OptionalContentSnapshot;

  constructor(scene: VectorScene) {
    this.scene = scene;
    this.orderedRuns = scene.drawRuns ?? [];
    this.requiresCompositing = sceneRequiresPaintCompositing(scene);
    this.defaults = createDefaultOptionalContentSnapshot(scene);
    this.setVisibility(this.defaults);
  }

  setVisibility(snapshot: OptionalContentSnapshot | null): void {
    snapshot ??= this.defaults;
    if (this.snapshot === snapshot) return;
    this.snapshot = snapshot;
    this.eligible.clear();
    const visible = (condition?: number): boolean => condition === undefined || snapshot.conditions[condition] === 1;
    const runs: VectorDrawRun[] = [];
    for (const run of this.orderedRuns) {
      if (!isScenePaintRunVisible(this.scene, run, visible)) continue;
      this.eligible.add(run);
      runs.push(run);
    }
    this.allVisible = runs.length === this.orderedRuns.length;
    this.visibleRuns = this.allVisible ? this.orderedRuns : runs;
  }

  isRunVisible(run: VectorDrawRun): boolean { return this.eligible.has(run); }

  select(candidates: readonly VectorDrawRun[]): readonly VectorDrawRun[] {
    if (this.allVisible) return candidates;
    if (candidates === this.orderedRuns) return this.visibleRuns;
    this.selected.length = 0;
    for (const run of candidates) if (this.eligible.has(run)) this.selected.push(run);
    return this.selected;
  }
}
