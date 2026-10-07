import { automaticRasterMemoryBudget, estimateRasterSourcePlanBytes, planSceneRasterMemory, type RasterMemorySource,
  type SceneRasterMemoryPlan } from "./rasterMemoryBudget";
import { sameRasterTilePlan, type RasterTilePlan } from "./rasterTiles";
import type { RasterCompressionFormat } from "./rasterCompression";

export interface RasterResolutionSource extends RasterMemorySource {
  readonly matrix: ArrayLike<number>;
  readonly pageIndex?: number;
}

export interface RasterResolutionView {
  readonly width: number;
  readonly height: number;
  readonly cameraCenterX: number;
  readonly cameraCenterY: number;
  /** Drawing-buffer pixels per document unit, including device pixel ratio. */
  readonly zoom: number;
  readonly localToClip?: ArrayLike<number>;
  /** Independent page projections in the Three integration; null denotes a hidden page. */
  readonly projection?: (index: number) => ArrayLike<number> | null;
}

export interface RasterResolutionResource {
  readonly rasterPlan: RasterTilePlan;
  readonly estimatedBytes: number;
  readonly compressionFormat?: RasterCompressionFormat;
}

const PREVIEW_SIZE = 128;

/** Select display tiers from screen demand without reading or changing canonical pixels. */
export class RasterResolutionPlanner {
  private readonly tiers = new WeakMap<object, number>();
  private retainedTiers = new Map<string, number>();
  private readonly failures = new Map<number, string>();
  private sources: readonly RasterResolutionSource[] | undefined;
  private readonly cache = new Map<string, SceneRasterMemoryPlan>();
  private readonly singleChannelMonochrome: boolean;

  constructor(singleChannelMonochrome = true) { this.singleChannelMonochrome = singleChannelMonochrome; }

  /** Scene composition creates new wrappers and can shift raster indices. Keep their zoom hysteresis. */
  inheritTiers(previous: RasterResolutionPlanner, previousSources: readonly RasterResolutionSource[],
    sources: readonly RasterResolutionSource[]): void {
    const key = (source: RasterResolutionSource) =>
      `${source.pageIndex ?? 0}:${source.width}:${source.height}:${Array.from(source.matrix).join(",")}`;
    // A deferred native upload can release the old scene with an empty window first.
    const tiers = previousSources.length ? new Map<string, number>() : previous.retainedTiers;
    for (const source of previousSources) {
      const tier = previous.tiers.get(source);
      if (tier !== undefined) tiers.set(key(source), tier);
    }
    for (const source of sources) {
      const tier = tiers.get(key(source));
      if (tier !== undefined) this.tiers.set(source, tier);
    }
    this.retainedTiers = tiers;
  }

  plan(sources: readonly RasterResolutionSource[], maxTextureSize: number,
    view: RasterResolutionView | null, availableBytes?: number,
    format?: RasterCompressionFormat | null): SceneRasterMemoryPlan {
    const displaySources = sources.map((source, index) => {
      const previewTier = Math.max(0, Math.ceil(Math.log2(Math.max(source.width, source.height) / PREVIEW_SIZE)));
      const demand = view ? projectedDemand(source, index, view) : null;
      let tier = previewTier;
      if (demand !== null) {
        // A little oversampling and tier hysteresis keep zoom animation from reallocating every frame.
        const ratio = Math.min(1, Math.max(1 / Math.max(source.width, source.height), demand * 1.25));
        tier = Math.max(0, Math.floor(Math.log2(1 / ratio)));
        const previous = this.tiers.get(source);
        if (previous !== undefined) {
          const scale = 2 ** -previous;
          if (scale >= ratio && scale <= ratio * 2.5) tier = previous;
        }
      }
      this.tiers.set(source, tier);
      return { width: source.width, height: source.height,
        displayWidth: Math.max(1, Math.floor(source.width / 2 ** tier)),
        displayHeight: Math.max(1, Math.floor(source.height / 2 ** tier)),
        ...(this.singleChannelMonochrome && source.monochrome ? { monochrome: source.monochrome, reducedMonochrome: true } : {}),
        compressionEligible: source.compressionEligible, allocationCopies: source.allocationCopies };
    });
    if (this.sources !== sources) { this.sources = sources; this.cache.clear(); }
    const key = `${maxTextureSize}:${availableBytes}:${automaticRasterMemoryBudget().bytes}:${format}:` +
      displaySources.map(source => `${source.displayWidth},${source.displayHeight}`).join(";");
    const cached = this.cache.get(key);
    if (cached) return cached;
    const plan = planSceneRasterMemory(displaySources, maxTextureSize, availableBytes, format);
    // Reserve passes use a second key. Never retain an unbounded history of zoom levels.
    if (this.cache.size >= 4) this.cache.clear();
    this.cache.set(key, plan);
    return plan;
  }

  /** Release larger obsolete textures before spending their allowance on visible detail. */
  nextChange(sources: readonly RasterResolutionSource[], resources: readonly RasterResolutionResource[],
    plan: SceneRasterMemoryPlan): number {
    let promotion = -1;
    for (let index = 0; index < resources.length; index++) {
      const desired = plan.plans[index], resource = resources[index];
      const format = plan.compressionFormats[index];
      if (!desired || !resource || this.failures.get(index) === this.key(index, desired, format) ||
          (sameRasterTilePlan(resource.rasterPlan, desired) && (resource.compressionFormat ?? null) === format)) continue;
      const source = sources[index];
      const cost = estimateRasterSourcePlanBytes({ width: source.width, height: source.height,
        ...(this.singleChannelMonochrome && source.monochrome
          ? { monochrome: source.monochrome, reducedMonochrome: true } : {}) }, desired, format);
      if (cost < resource.estimatedBytes) return index;
      if (promotion < 0) promotion = index;
    }
    return promotion;
  }

  failed(index: number, plan: SceneRasterMemoryPlan): void {
    this.failures.set(index, this.key(index, plan.plans[index], plan.compressionFormats[index]));
  }

  invalidate(): void { this.cache.clear(); this.failures.clear(); }

  private key(index: number, plan: RasterTilePlan, format: RasterCompressionFormat | null): string {
    return `${index}:${plan.width}:${plan.height}:${format}`;
  }
}

function projectedDemand(source: RasterResolutionSource, index: number, view: RasterResolutionView): number | null {
  if (!(view.width > 0 && view.height > 0 && view.zoom > 0)) return null;
  const projection = view.projection ? view.projection(index) : view.localToClip;
  if (projection === null) return null;
  const m = source.matrix;
  const points = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => {
    const x = m[0] * u + m[2] * v + m[4], y = m[1] * u + m[3] * v + m[5];
    if (projection) {
      const w = projection[3] * x + projection[7] * y + projection[15];
      if (!(w > 1e-8)) return null;
      return [(projection[0] * x + projection[4] * y + projection[12]) / w * view.width / 2 + view.width / 2,
        (projection[1] * x + projection[5] * y + projection[13]) / w * view.height / 2 + view.height / 2];
    }
    return [(x - view.cameraCenterX) * view.zoom + view.width / 2,
      (y - view.cameraCenterY) * view.zoom + view.height / 2];
  });
  // Near-plane intersections have unbounded projected detail; the memory/device limits still cap them.
  if (points.some(point => point === null)) return 1;
  const p = points as number[][];
  const xs = p.map(point => point[0]), ys = p.map(point => point[1]);
  const margin = 64;
  if (Math.max(...xs) < -margin || Math.min(...xs) > view.width + margin ||
      Math.max(...ys) < -margin || Math.min(...ys) > view.height + margin) return null;
  const distance = (a: number, b: number) => Math.hypot(p[a][0] - p[b][0], p[a][1] - p[b][1]);
  return Math.max(Math.max(distance(0, 1), distance(2, 3)) / source.width,
    Math.max(distance(0, 2), distance(1, 3)) / source.height);
}
