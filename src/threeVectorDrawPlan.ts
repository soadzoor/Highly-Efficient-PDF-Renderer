import { normalizeScenePaintGraph, scenePaintSpanSegments, type ScenePaintNode } from "./scenePaintGraph";
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
 * Each PDF object owns one plan shared by its material layers. Compositing
 * constrains reordering to source-over spans, preserving every effect boundary.
 */
export class ThreeVectorDrawPlan {
  /** Bumped whenever {@link order} changes, so layers can rebuild their batches. */
  version = 0;
  private scheduler: VectorPageDrawScheduler | null;
  readonly segments: Uint32Array | null;
  private readonly scene: VectorScene;
  private unitsPerPixel: number | null = null;
  private colorCommutationEnabled = true;
  private readonly all: readonly number[];
  private ordered: number[];
  private readonly positionOfRun: Int32Array;

  constructor(scene: VectorScene) {
    this.scene = scene;
    const runs = scene.drawRuns ?? [];
    this.all = Array.from({ length: runs.length }, (_, index) => index);
    this.ordered = [...this.all];
    this.positionOfRun = new Int32Array(runs.length);
    for (let index = 0; index < runs.length; index++) this.positionOfRun[index] = index;
    this.segments = sceneRequiresPaintCompositing(scene) ? scenePaintSpanSegments(scene) : null;
    this.scheduler = this.createScheduler(scene, strokeSourceRuns(scene));
  }

  /** Scheduled run indices; canonical order until a pixel scale is supplied. */
  get order(): readonly number[] { return this.ordered; }

  /** Submission position of each canonical run, for `renderOrder` assignment. */
  get positions(): Int32Array { return this.positionOfRun; }

  /** True while minification holds the scheduler's coverage margin. */
  get paintOrderApproximated(): boolean { return this.scheduler?.paintOrderApproximated ?? false; }

  /** Temporary primitive colors invalidate the source-color commutation proof. */
  setColorCommutationEnabled(enabled: boolean): boolean {
    this.colorCommutationEnabled = enabled;
    if (!this.scheduler?.setColorCommutationEnabled(enabled)) return false;
    return this.reschedule();
  }

  /**
   * Replan for a conservative scene-units-per-pixel estimate. `null` keeps the
   * canonical order, for projections without a usable uniform pixel scale.
   */
  update(unitsPerPixel: number | null): boolean {
    const scale = Number.isFinite(unitsPerPixel) && (unitsPerPixel ?? 0) > 0 ? unitsPerPixel : null;
    this.unitsPerPixel = scale;
    if (!(this.scheduler?.updateScale(scale) ?? false)) return false;
    return this.reschedule();
  }

  /** Include every LOD level in the commutation proof, even while it is dormant. */
  setStrokeSource(strokes: VectorScene, origins: Uint32Array): void {
    const canonical = strokeSourceRuns(this.scene);
    const sourceRuns = Uint32Array.from(origins, origin => canonical[origin]);
    this.scheduler = this.createScheduler(strokes, sourceRuns);
    this.scheduler?.setColorCommutationEnabled(this.colorCommutationEnabled);
    this.scheduler?.updateScale(this.unitsPerPixel);
    this.reschedule();
  }

  private createScheduler(strokes: VectorScene, sourceRuns: Uint32Array): VectorPageDrawScheduler | null {
    // Arbitrary public graphs can visit canonical runs backwards. Such graphs
    // retain their source submissions rather than feeding a non-monotonic span
    // sequence to the scheduler.
    if (this.segments && !graphRunsInOrder(this.scene)) return null;
    return VectorPageDrawScheduler.create(this.scene, strokes, sourceRuns, this.segments);
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

function graphRunsInOrder(scene: VectorScene): boolean {
  let previous = -1;
  const raster = new Map<number, number>();
  scene.drawRuns?.forEach((run, index) => { if (run.kind === "raster" && run.count === 1) raster.set(run.first, index); });
  const visit = (nodes: readonly ScenePaintNode[]): boolean => {
    for (const node of nodes) {
      if (node.kind === "group") {
        if (node.softMask && !visit(node.softMask.children)) return false;
        if (!visit(node.children)) return false;
      } else {
        const index = node.kind === "draw" ? node.runIndex : raster.get(node.rasterIndex);
        if (index === undefined || index <= previous) return false;
        previous = index;
      }
    }
    return true;
  };
  return visit(normalizeScenePaintGraph(scene));
}
