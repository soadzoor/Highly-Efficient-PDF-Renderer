import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import {
  analyzePlanarBoundsProjectionInto,
  createPlanarBoundsProjection,
  type PlanarBoundsProjection,
  type PlanarViewport
} from "./planarProjection";
import {
  buildTextLod,
  buildTextLodAsync,
  type TextLodAsyncBuildOptions,
  type TextLodBuildData,
  type TextLodBuildResult
} from "./textGreekLod";

export {
  appendTextLodCombinedPayload,
  createTextLodCombinedPayload,
  TEXT_LOD_SOLID_GLYPH_SEGMENT_COUNT,
  type TextLodBuildData,
  type TextLodBuildResult,
  type TextLodCombinedDestinations,
  type TextLodCombinedPayload,
  type TextLodFallbackReason
} from "./textGreekLod";

/** Automatic clustered selection, or the original exact-only representation. */
export type TextLodMode = "auto" | "off";

/** Exact-to-coarse transition threshold for a previously exact cluster. */
export const TEXT_LOD_COARSE_ENTER_PX = 0.5;
/** Coarse-to-exact threshold for a previously coarse cluster. */
export const TEXT_LOD_EXACT_ENTER_PX = 0.75;
/**
 * Fraction of the view size used as the visibility quantisation step.
 *
 * A selection change forces a full rebuild and GPU upload of the instance list,
 * and testing clusters against the exact view makes some cluster cross the edge
 * on virtually every frame of a pan, so the list is re-uploaded continuously.
 * Snapping the visibility rectangle outward onto a grid of this size keeps the
 * tested region identical until the view has moved a meaningful distance, at the
 * cost of selecting the clusters within one grid step of the viewport. The
 * snapped rectangle always contains the real one, so nothing pops in late.
 */
const TEXT_LOD_VISIBILITY_STEP_RATIO = 0.1;

/** Diagnostic only: quality-driven exact selection is never capped to this. */
export const TEXT_LOD_SOFT_EXACT_GLYPH_BUDGET = 200_000;

export interface TextLodSelectionUpdate {
  /** Column-major PDF-local-to-clip 4x4 matrix. */
  localToClip: ArrayLike<number>;
  viewportWidth: number;
  viewportHeight: number;
  /** Optional conservative local-space visibility bounds. */
  cullingBounds?: Bounds | null;
}

export interface TextLodStats {
  mode: TextLodMode;
  available: boolean;
  fallbackReason: string | null;
  buildTimeMs: number;
  totalRuns: number;
  totalClusters: number;
  visibleClusters: number;
  exactClusters: number;
  coarseClusters: number;
  renderedGlyphs: number;
  renderedRuns: number;
  selectedInstances: number;
  selectionUploads: number;
  exactBudgetOverage: number;
}

export interface TextLodSelectionResult {
  /** Source-ordered absolute IDs into the exact-prefix/coarse-suffix payload. */
  instanceIds: Uint32Array;
  /** True only when the ordered ID contents changed. */
  changed: boolean;
  stats: TextLodStats;
}

const cachedBuilds = new WeakMap<VectorScene, TextLodBuildResult>();
const pendingBuilds = new WeakMap<VectorScene, Promise<TextLodBuildResult>>();

/** Return a shared result without initiating a build. */
export function getCachedTextLod(scene: VectorScene): TextLodBuildResult | null {
  return cachedBuilds.get(scene) ?? null;
}

/** Build once synchronously and share the immutable result through a WeakMap. */
export function getOrBuildTextLod(scene: VectorScene): TextLodBuildResult {
  const cached = cachedBuilds.get(scene);
  if (cached) return cached;
  const result = buildTextLod(scene);
  cachedBuilds.set(scene, result);
  return result;
}

/**
 * Build once cooperatively and share both in-flight and completed work. A
 * cancelled build rejects and is not cached, so a later renderer can retry.
 */
export function prebuildTextLod(
  scene: VectorScene,
  options: TextLodAsyncBuildOptions = {}
): Promise<TextLodBuildResult> {
  const cached = cachedBuilds.get(scene);
  if (cached) return Promise.resolve(cached);
  const pending = pendingBuilds.get(scene);
  if (pending) return pending;
  const promise = buildTextLodAsync(scene, options).then((result) => {
    cachedBuilds.set(scene, result);
    pendingBuilds.delete(scene);
    return result;
  }, (error: unknown) => {
    pendingBuilds.delete(scene);
    throw error;
  });
  pendingBuilds.set(scene, promise);
  return promise;
}

/** Allow a loader or renderer to publish an already completed immutable build. */
export function storePrebuiltTextLod(scene: VectorScene, result: TextLodBuildResult): void {
  cachedBuilds.set(scene, result);
}

/**
 * Per-renderer mutable selection state. Build data is never mutated and may be
 * shared by native WebGL/WebGPU and Three WebGL/WebGPU simultaneously.
 */
export class TextLodRuntime {
  private data: TextLodBuildData | null;
  private readonly buildTimeMs: number;
  private readonly buildFallbackReason: string | null;
  private resourceFallbackReason: string | null = null;
  private mode: TextLodMode;
  private clusterStates: Uint8Array;
  private clusterVisibility: Uint8Array;
  private selectedInstanceIds: Uint32Array = new Uint32Array(0);
  private exactIdentityInstanceIds: Uint32Array | null = null;
  private selectionScratch: Uint32Array = new Uint32Array(0);
  private selectionInitialized = false;
  private lastUpdateValid = false;
  private readonly lastLocalToClip = new Float64Array(16);
  private lastViewportWidth = 0;
  private lastViewportHeight = 0;
  private lastHasCullingBounds = false;
  private readonly lastCullingBounds = new Float64Array(4);
  private selectionUploads = 0;
  private stats: TextLodStats;
  // Selection projects every visible page and cluster each frame; the results are
  // consumed immediately, so two reusable slots keep the loop allocation-free.
  private readonly pageProjection: PlanarBoundsProjection = createPlanarBoundsProjection();
  private readonly clusterProjection: PlanarBoundsProjection = createPlanarBoundsProjection();
  private readonly selectionViewportScratch: PlanarViewport = {width: 1, height: 1};
  private readonly visibilityBounds: Bounds = {minX: 0, minY: 0, maxX: 0, maxY: 0};

  constructor(result: TextLodBuildResult, mode: TextLodMode = "auto") {
    this.data = result.data;
    this.buildTimeMs = result.buildTimeMs;
    this.buildFallbackReason = result.fallbackReason;
    this.mode = mode;
    this.clusterStates = new Uint8Array(result.data?.clusters.length ?? 0);
    this.clusterVisibility = new Uint8Array(result.data?.clusters.length ?? 0);
    this.stats = this.createEmptyStats();
  }

  setMode(mode: TextLodMode): void {
    if (mode !== "auto" && mode !== "off") {
      throw new RangeError(`Unsupported Text LOD mode: ${String(mode)}`);
    }
    if (mode === this.mode) {
      return;
    }
    this.mode = mode;
    if (mode === "off") {
      // Off is an exact-only reset, not a pause. Returning to Auto therefore
      // applies the initial/exact 0.50px threshold rather than reviving a stale
      // coarse state in the hysteresis band.
      this.clusterStates.fill(0);
    }
    this.selectionInitialized = false;
    this.lastUpdateValid = false;
    this.stats = this.createEmptyStats();
  }

  getMode(): TextLodMode {
    return this.mode;
  }

  /**
   * Disable LOD after a backend-specific allocation/capacity failure. Passing
   * null clears the backend reason and permits selection again.
   */
  setResourceFallback(reason: string | null): void {
    const normalized = reason && reason.length > 0 ? reason : null;
    if (normalized === this.resourceFallbackReason) {
      return;
    }
    this.resourceFallbackReason = normalized;
    this.selectionInitialized = false;
    this.lastUpdateValid = false;
    this.stats = this.createEmptyStats();
  }

  update(update: TextLodSelectionUpdate): TextLodSelectionResult {
    const data = this.data;
    if (!data || this.resourceFallbackReason) {
      return this.finishUnavailableSelection();
    }
    if (this.selectionInitialized && this.isSameSelectionUpdate(update)) {
      return {instanceIds: this.selectedInstanceIds, changed: false, stats: this.getStats()};
    }

    const forceSelectionRebuild = !this.selectionInitialized;
    let selectionDecisionChanged = false;
    let visibleClusters = 0;
    let exactClusters = 0;
    let coarseClusters = 0;
    let renderedGlyphs = 0;
    let renderedRuns = 0;
    const cullingBounds = this.resolveVisibilityBounds(update.cullingBounds);

    for (const page of data.pages) {
      if (cullingBounds && !boundsIntersect(page.bounds, cullingBounds)) {
        if (markClustersInvisible(page.clusterStart, page.clusterCount, this.clusterVisibility)) {
          selectionDecisionChanged = true;
        }
        continue;
      }
      const pageProjection = analyzePlanarBoundsProjectionInto(
        page.bounds,
        update.localToClip,
        this.selectionViewport(update),
        this.pageProjection
      );
      if (pageProjection.stable && !pageProjection.visible) {
        if (markClustersInvisible(page.clusterStart, page.clusterCount, this.clusterVisibility)) {
          selectionDecisionChanged = true;
        }
        continue;
      }

      // When the conservative scale over the complete page is already below
      // the applicable threshold, every child is safely coarse. This avoids
      // hundreds or thousands of per-cluster projections at overview scale.
      const pageWasEntirelyCoarse = page.eligible && page.clusterCount > 0 &&
        allClustersHaveState(this.clusterStates, page.clusterStart, page.clusterCount, 1);
      const pageCoarseThreshold = pageWasEntirelyCoarse
        ? TEXT_LOD_EXACT_ENTER_PX
        : TEXT_LOD_COARSE_ENTER_PX;
      const selectWholePageCoarse =
        this.mode === "auto" && page.eligible && pageProjection.stable &&
        (pageWasEntirelyCoarse
          ? page.maxInkHeight * pageProjection.maxPixelsPerLocalUnit < pageCoarseThreshold
          : page.maxInkHeight * pageProjection.maxPixelsPerLocalUnit <= pageCoarseThreshold);
      if (selectWholePageCoarse) {
        const clusterEnd = page.clusterStart + page.clusterCount;
        for (let clusterIndex = page.clusterStart; clusterIndex < clusterEnd; clusterIndex += 1) {
          const cluster = data.clusters[clusterIndex];
          if (setClusterValue(this.clusterVisibility, clusterIndex, 1)) {
            selectionDecisionChanged = true;
          }
          if (setClusterValue(this.clusterStates, clusterIndex, 1)) {
            selectionDecisionChanged = true;
          }
          visibleClusters += 1;
          coarseClusters += 1;
          renderedRuns += cluster.coarseCount;
        }
        continue;
      }

      const clusterEnd = page.clusterStart + page.clusterCount;
      for (let clusterIndex = page.clusterStart; clusterIndex < clusterEnd; clusterIndex += 1) {
        const cluster = data.clusters[clusterIndex];
        if (cullingBounds && !boundsIntersect(cluster.bounds, cullingBounds)) {
          if (setClusterValue(this.clusterVisibility, clusterIndex, 0)) {
            selectionDecisionChanged = true;
          }
          continue;
        }
        const projection = analyzePlanarBoundsProjectionInto(
          cluster.bounds,
          update.localToClip,
          this.selectionViewport(update),
          this.clusterProjection
        );
        if (projection.stable && !projection.visible) {
          if (setClusterValue(this.clusterVisibility, clusterIndex, 0)) {
            selectionDecisionChanged = true;
          }
          continue;
        }
        if (setClusterValue(this.clusterVisibility, clusterIndex, 1)) {
          selectionDecisionChanged = true;
        }
        visibleClusters += 1;

        let coarse = false;
        if (this.mode === "auto" && cluster.eligible && projection.stable) {
          const projectedInkHeight = cluster.maxInkHeight * projection.maxPixelsPerLocalUnit;
          const wasCoarse = this.clusterStates[clusterIndex] === 1;
          coarse = wasCoarse
            ? projectedInkHeight < TEXT_LOD_EXACT_ENTER_PX
            : projectedInkHeight <= TEXT_LOD_COARSE_ENTER_PX;
        }
        if (setClusterValue(this.clusterStates, clusterIndex, coarse ? 1 : 0)) {
          selectionDecisionChanged = true;
        }
        if (coarse) {
          coarseClusters += 1;
          renderedRuns += cluster.coarseCount;
        } else {
          exactClusters += 1;
          renderedGlyphs += cluster.exactCount;
        }
      }
    }

    // A rebuild only happens when a cluster decision moved or the selection was
    // reset, and either of those changes the emitted ranges. Deriving `changed`
    // from the decisions rather than diffing the ids avoids a second full pass,
    // and is what lets the ids be handed out as a view into a reused buffer.
    const changed = forceSelectionRebuild || selectionDecisionChanged;
    if (changed) {
      this.selectedInstanceIds = this.buildSelectedInstanceIds(
        data,
        visibleClusters === data.clusters.length &&
          coarseClusters === 0 &&
          renderedGlyphs === data.exactInstanceCount
      );
      this.selectionUploads += 1;
      this.selectionInitialized = true;
    }
    this.stats = {
      mode: this.mode,
      available: true,
      fallbackReason: null,
      buildTimeMs: this.buildTimeMs,
      totalRuns: data.runs.length,
      totalClusters: data.clusters.length,
      visibleClusters,
      exactClusters,
      coarseClusters,
      renderedGlyphs,
      renderedRuns,
      selectedInstances: this.selectedInstanceIds.length,
      selectionUploads: this.selectionUploads,
      exactBudgetOverage: Math.max(0, renderedGlyphs - TEXT_LOD_SOFT_EXACT_GLYPH_BUDGET)
    };
    this.rememberSelectionUpdate(update);
    return {instanceIds: this.selectedInstanceIds, changed, stats: this.getStats()};
  }

  /**
   * Snap the visibility rectangle outward onto a grid so panning does not change
   * the tested region every frame. Always a superset of the supplied bounds.
   */
  private resolveVisibilityBounds(bounds: Bounds | null | undefined): Bounds | null {
    if (!bounds) {
      return null;
    }
    const stepX = quantizeVisibilityStep((bounds.maxX - bounds.minX) * TEXT_LOD_VISIBILITY_STEP_RATIO);
    const stepY = quantizeVisibilityStep((bounds.maxY - bounds.minY) * TEXT_LOD_VISIBILITY_STEP_RATIO);
    if (stepX <= 0 || stepY <= 0) {
      return bounds;
    }

    const out = this.visibilityBounds;
    out.minX = Math.floor(bounds.minX / stepX) * stepX;
    out.minY = Math.floor(bounds.minY / stepY) * stepY;
    out.maxX = Math.ceil(bounds.maxX / stepX) * stepX;
    out.maxY = Math.ceil(bounds.maxY / stepY) * stepY;
    return out;
  }

  private selectionViewport(update: TextLodSelectionUpdate): PlanarViewport {
    this.selectionViewportScratch.width = update.viewportWidth;
    this.selectionViewportScratch.height = update.viewportHeight;
    return this.selectionViewportScratch;
  }

  getSelectedInstanceIds(): Uint32Array {
    return this.selectedInstanceIds;
  }

  getStats(): TextLodStats {
    return {...this.stats};
  }

  /** Retain no renderer-owned mutable or shared-build references after disposal. */
  dispose(): void {
    this.data = null;
    this.clusterStates = new Uint8Array(0);
    this.clusterVisibility = new Uint8Array(0);
    this.selectedInstanceIds = new Uint32Array(0);
    this.exactIdentityInstanceIds = null;
    this.selectionScratch = new Uint32Array(0);
    this.selectionInitialized = false;
    this.lastUpdateValid = false;
    this.stats = this.createEmptyStats();
  }

  private finishUnavailableSelection(): TextLodSelectionResult {
    const changed = this.selectedInstanceIds.length !== 0;
    if (changed) {
      this.selectedInstanceIds = new Uint32Array(0);
      this.selectionUploads += 1;
    }
    this.selectionInitialized = true;
    this.stats = this.createEmptyStats();
    return {instanceIds: this.selectedInstanceIds, changed, stats: this.getStats()};
  }

  private createEmptyStats(): TextLodStats {
    return {
      mode: this.mode,
      available: this.data !== null && this.resourceFallbackReason === null,
      fallbackReason: this.resourceFallbackReason ?? this.buildFallbackReason,
      buildTimeMs: this.buildTimeMs,
      totalRuns: this.data?.runs.length ?? 0,
      totalClusters: this.data?.clusters.length ?? 0,
      visibleClusters: 0,
      exactClusters: 0,
      coarseClusters: 0,
      renderedGlyphs: 0,
      renderedRuns: 0,
      selectedInstances: 0,
      selectionUploads: this.selectionUploads,
      exactBudgetOverage: 0
    };
  }

  /**
   * Every selected range is a contiguous slice of the combined payload, so the
   * ids are always a run of consecutive integers. Copying them out of one
   * identity array takes the engine's memcpy path instead of a per-element JS
   * loop, and reusing the destination keeps the frame allocation-free.
   *
   * The returned view aliases `selectionScratch` and is only valid until the
   * next selection; callers must copy it rather than retain it.
   */
  private buildSelectedInstanceIds(data: TextLodBuildData, exactInput: boolean): Uint32Array {
    const identity = this.ensureIdentityInstanceIds(data);
    if (exactInput) {
      return identity.subarray(0, data.exactInstanceCount);
    }

    if (this.selectionScratch.length < data.combinedInstanceCount) {
      this.selectionScratch = new Uint32Array(data.combinedInstanceCount);
    }
    const scratch = this.selectionScratch;

    let offset = 0;
    for (let clusterIndex = 0; clusterIndex < data.clusters.length; clusterIndex += 1) {
      if (this.clusterVisibility[clusterIndex] === 0) {
        continue;
      }
      const cluster = data.clusters[clusterIndex];
      const start = this.clusterStates[clusterIndex] === 1
        ? data.exactInstanceCount + cluster.coarseStart
        : cluster.exactStart;
      const count = this.clusterStates[clusterIndex] === 1 ? cluster.coarseCount : cluster.exactCount;
      if (count <= 0) {
        continue;
      }
      scratch.set(identity.subarray(start, start + count), offset);
      offset += count;
    }
    return scratch.subarray(0, offset);
  }

  private ensureIdentityInstanceIds(data: TextLodBuildData): Uint32Array {
    let identity = this.exactIdentityInstanceIds;
    if (!identity || identity.length < data.combinedInstanceCount) {
      identity = new Uint32Array(data.combinedInstanceCount);
      for (let i = 0; i < identity.length; i += 1) {
        identity[i] = i;
      }
      this.exactIdentityInstanceIds = identity;
    }
    return identity;
  }

  private isSameSelectionUpdate(update: TextLodSelectionUpdate): boolean {
    if (!this.lastUpdateValid || update.localToClip.length < 16) return false;
    if (
      Number(update.viewportWidth) !== this.lastViewportWidth ||
      Number(update.viewportHeight) !== this.lastViewportHeight
    ) {
      return false;
    }
    for (let i = 0; i < 16; i += 1) {
      if (Number(update.localToClip[i]) !== this.lastLocalToClip[i]) return false;
    }
    const bounds = update.cullingBounds;
    const hasBounds = bounds !== undefined && bounds !== null;
    if (hasBounds !== this.lastHasCullingBounds) return false;
    return !bounds || (
      bounds.minX === this.lastCullingBounds[0] &&
      bounds.minY === this.lastCullingBounds[1] &&
      bounds.maxX === this.lastCullingBounds[2] &&
      bounds.maxY === this.lastCullingBounds[3]
    );
  }

  private rememberSelectionUpdate(update: TextLodSelectionUpdate): void {
    if (update.localToClip.length < 16) {
      this.lastUpdateValid = false;
      return;
    }
    for (let i = 0; i < 16; i += 1) {
      this.lastLocalToClip[i] = Number(update.localToClip[i]);
    }
    this.lastViewportWidth = Number(update.viewportWidth);
    this.lastViewportHeight = Number(update.viewportHeight);
    const bounds = update.cullingBounds;
    this.lastHasCullingBounds = bounds !== undefined && bounds !== null;
    if (bounds) {
      this.lastCullingBounds[0] = bounds.minX;
      this.lastCullingBounds[1] = bounds.minY;
      this.lastCullingBounds[2] = bounds.maxX;
      this.lastCullingBounds[3] = bounds.maxY;
    }
    this.lastUpdateValid = true;
  }
}

/**
 * Round a step to a power of two.
 *
 * The step is derived from the view size, which drifts by tiny amounts frame to
 * frame from floating-point cancellation and continuously while zooming. Without
 * this the grid itself would move every frame and the snapped rectangle would
 * never repeat, defeating the quantisation.
 */
function quantizeVisibilityStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) {
    return 0;
  }
  return Math.pow(2, Math.round(Math.log2(step)));
}

function markClustersInvisible(
  clusterStart: number,
  clusterCount: number,
  visibility: Uint8Array
): boolean {
  const end = Math.min(visibility.length, clusterStart + clusterCount);
  let changed = false;
  for (let i = clusterStart; i < end; i += 1) {
    if (visibility[i] !== 0) {
      visibility[i] = 0;
      changed = true;
    }
  }
  return changed;
}

function setClusterValue(values: Uint8Array, index: number, value: number): boolean {
  if (values[index] === value) return false;
  values[index] = value;
  return true;
}

function boundsIntersect(left: Readonly<Bounds>, right: Readonly<Bounds>): boolean {
  return left.maxX >= right.minX && left.minX <= right.maxX &&
    left.maxY >= right.minY && left.minY <= right.maxY;
}

function allClustersHaveState(
  states: Uint8Array,
  clusterStart: number,
  clusterCount: number,
  expected: number
): boolean {
  const end = Math.min(states.length, clusterStart + clusterCount);
  for (let i = clusterStart; i < end; i += 1) {
    if (states[i] !== expected) return false;
  }
  return end - clusterStart === clusterCount;
}
