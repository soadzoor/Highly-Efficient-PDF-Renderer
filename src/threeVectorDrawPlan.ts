import { sceneRequiresPaintCompositing } from "./scenePaintVisibility";
import { VectorPageDrawScheduler } from "./vectorPageDrawScheduler";
import type { VectorScene } from "./pdfVectorExtractor";

const plans = new WeakMap<VectorScene, ThreeVectorDrawPlan>();

/**
 * Scene-level paint schedule shared by the three.js material layers.
 *
 * The native backends collapse thousands of canonical paints into a handful of
 * instanced draws by reordering commuting paints with {@link VectorPageDrawScheduler}
 * before batching them. The three.js layers build one mesh per batch, so they
 * need the same order, and they need it to be the *same* order across the
 * stroke, fill, text, raster and gradient layers: `renderOrder` is global, and
 * a paint may only move relative to paints it provably commutes with.
 *
 * One plan per scene therefore owns the schedule, and every layer reads its
 * positions from here. Scenes that need the paint compositor keep the canonical
 * order, exactly as the compositor's transparency groups require.
 */
export class ThreeVectorDrawPlan {
  /** Bumped whenever {@link order} changes, so layers can rebuild their batches. */
  version = 0;
  private readonly scheduler: VectorPageDrawScheduler | null;
  private readonly all: readonly number[];
  private ordered: number[];
  private readonly positionOfRun: Int32Array;

  constructor(scene: VectorScene) {
    const runs = scene.drawRuns ?? [];
    this.all = Array.from({ length: runs.length }, (_, index) => index);
    this.ordered = [...this.all];
    this.positionOfRun = new Int32Array(runs.length);
    for (let index = 0; index < runs.length; index++) this.positionOfRun[index] = index;
    // Reordering paints under the compositor would move draws across the
    // transparency groups it renders into separate surfaces. Scenes without a
    // page layout cannot be partitioned at all, so they keep the source order.
    this.scheduler = runs.length > 0 && scene.pageRects?.length > 0 && !sceneRequiresPaintCompositing(scene)
      ? VectorPageDrawScheduler.create(scene, scene, strokeSourceRuns(scene)) : null;
  }

  /** Scheduled run indices; canonical order until a pixel scale is supplied. */
  get order(): readonly number[] { return this.ordered; }

  /** Submission position of each canonical run, for `renderOrder` assignment. */
  get positions(): Int32Array { return this.positionOfRun; }

  /** True while minification holds the scheduler's coverage margin. */
  get paintOrderApproximated(): boolean { return this.scheduler?.paintOrderApproximated ?? false; }

  /** Temporary primitive colors invalidate the source-color commutation proof. */
  setColorCommutationEnabled(enabled: boolean): boolean {
    if (!this.scheduler?.setColorCommutationEnabled(enabled)) return false;
    return this.reschedule();
  }

  /**
   * Replan for a conservative scene-units-per-pixel estimate. `null` keeps the
   * canonical order, for projections without a usable uniform pixel scale.
   */
  update(unitsPerPixel: number | null): boolean {
    const scale = Number.isFinite(unitsPerPixel) && (unitsPerPixel ?? 0) > 0 ? unitsPerPixel : null;
    if (!(this.scheduler?.updateScale(scale) ?? false)) return false;
    return this.reschedule();
  }

  private reschedule(): boolean {
    if (!this.scheduler) return false;
    // The scheduler returns its input untouched while no scale is set.
    const next = this.scheduler.schedule(this.all);
    let same = next.length === this.ordered.length;
    for (let index = 0; same && index < next.length; index++) same = next[index] === this.ordered[index];
    if (same) return false;
    // The scheduler reuses its output buffers, so keep a private copy.
    this.ordered = [...next];
    for (let position = 0; position < this.ordered.length; position++) {
      this.positionOfRun[this.ordered[position]] = position;
    }
    this.version++;
    return true;
  }
}

/** One plan per scene keeps every layer on the same submission order. */
export function getThreeVectorDrawPlan(scene: VectorScene): ThreeVectorDrawPlan {
  let plan = plans.get(scene);
  if (!plan) plans.set(scene, plan = new ThreeVectorDrawPlan(scene));
  return plan;
}

function strokeSourceRuns(scene: VectorScene): Uint32Array {
  const sourceRuns = new Uint32Array(Math.max(0, scene.segmentCount | 0));
  const runs = scene.drawRuns ?? [];
  for (let index = 0; index < runs.length; index++) {
    const run = runs[index];
    if (run.kind === "stroke") sourceRuns.fill(index, run.first, run.first + run.count);
  }
  return sourceRuns;
}
