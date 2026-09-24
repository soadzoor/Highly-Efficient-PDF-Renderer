import type { VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import type { VectorStrokeLodRuntime } from "./vectorStrokeLodCore";
import { strokePaintOrigins } from "./vectorStrokePaintOrder";
import { scenePaintSpanSegments } from "./scenePaintGraph";
import { sceneRequiresPaintCompositing } from "./scenePaintVisibility";
import { VectorPageDrawScheduler } from "./vectorPageDrawScheduler";
import { VectorStrokeRedundancy } from "./vectorStrokeRedundancy";
import { VectorRunClipElision } from "./vectorRunClipElision";

/** Instanced draws retain overlapping paint order; clip roots travel with each instance. */
export class VectorOrderedBatches {
  readonly batches: VectorDrawRun[] = [];
  /**
   * The compositor span each batch belongs to, parallel to `batches`. Batches
   * rise through the spans in graph order, so a caller compositing one span
   * draws the contiguous stretch whose ids fall inside it. Empty without a
   * paint graph, where the whole page is one span.
   */
  readonly batchSegments: number[] = [];
  /**
   * Whether `batchSegments` rises along `batches`. A consumer walking the spans
   * in graph order can then take each one's batches as a contiguous stretch. A
   * graph that visits its paints out of source order can break this, and such a
   * consumer must fall back to submitting paints one at a time.
   */
  spanOrdered = true;
  /**
   * Which canonical runs this plan was given. Soft-mask contents are not page
   * paints and never reach it, so a caller drawing a span of them has to submit
   * them itself rather than look for batches that do not exist.
   */
  readonly scheduledRuns: Uint8Array;
  private readonly scheduledSpanPrefix: Uint32Array;
  readonly floatInstances: Float32Array;
  readonly uintInstances: Uint32Array;
  readonly strokeScene: VectorScene;
  readonly cullingPadding: number;
  instanceCount = 0;
  /** Visible strokes omitted temporarily; canonical scene counts never change. */
  culledSegmentCount = 0;
  /** True while minification relaxes paint order between sub-pixel neighbours. */
  get paintOrderApproximated(): boolean { return this.scheduler?.paintOrderApproximated ?? false; }
  private readonly runtime: VectorStrokeLodRuntime | null;
  private readonly runIndices = new Map<VectorDrawRun, number>();
  private readonly rankToId: Uint32Array;
  private readonly idToRank: Uint32Array;
  private readonly rankRun: Uint32Array;
  private readonly offsets: number[] = [];
  private readonly selectedRanks: Uint32Array;
  private readonly selectedRankBits: Uint32Array;
  private readonly selectedRankWords: Uint32Array;
  private orderedSelectedCount = 0;
  private readonly previousSelectedIds: Uint32Array;
  private previousSelectedCount = 0;
  private readonly sourceRuns: readonly VectorDrawRun[];
  private readonly runRanges: Uint32Array;
  private readonly visiblePaints: number[] = [];
  private readonly scheduler: VectorPageDrawScheduler | null;
  private readonly segments: Uint32Array | null;
  private readonly clipElision: VectorRunClipElision | null;
  private readonly redundancy: VectorStrokeRedundancy;
  private readonly redundancyIds: Uint32Array;
  private redundancyEnabled = true;
  private previousSelectedRanks = new Uint32Array(0);
  private previousRankCount = 0;
  private previousRuns: VectorDrawRun[] = [];
  private previousRunsAreSource = false;
  private initialized = false;
  private dirty = true;
  private orderDirty = false;

  constructor(scene: VectorScene, runtime: VectorStrokeLodRuntime | null) {
    this.runtime = runtime;
    this.cullingPadding = (runtime?.levels.at(-1)?.tolerance ?? 0) * 2;
    const runs = scene.drawRuns!;
    this.sourceRuns = runs;
    this.runRanges = new Uint32Array(runs.length * 2);
    const sourceRun = new Uint32Array(scene.segmentCount);
    runs.forEach((run, index) => {
      this.runIndices.set(run, index);
      if (run.kind === "stroke") sourceRun.fill(index, run.first, run.first + run.count);
    });
    const levels = runtime?.levels ?? [{ scene, segmentCount: scene.segmentCount }];
    let total = 0;
    for (const level of levels) { this.offsets.push(total); total += level.segmentCount; }
    // One texture store lets adjacent strokes from different tile LOD levels
    // share the same draw, in the original paint order.
    this.strokeScene = scene;
    if (runtime) {
      const combined = { ...scene, segmentCount: total };
      for (const key of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"] as const) {
        combined[key] = new Float32Array(total * 4);
        levels.forEach((level, index) => combined[key].set(level.scene[key], this.offsets[index] * 4));
      }
      this.strokeScene = combined;
    }
    this.rankToId = Uint32Array.from({ length: total }, (_, index) => index);
    this.idToRank = new Uint32Array(total);
    this.rankRun = new Uint32Array(total);
    this.selectedRanks = new Uint32Array(total);
    this.selectedRankBits = new Uint32Array(Math.ceil(total / 32));
    this.selectedRankWords = new Uint32Array(Math.ceil(this.selectedRankBits.length / 32));
    this.previousSelectedIds = new Uint32Array(total);
    const origins = new Uint32Array(total);
    levels.forEach((level, index) => {
      origins.set(strokePaintOrigins(level.scene)!, this.offsets[index]);
    });
    this.rankToId.sort((a, b) => sourceRun[origins[a]] - sourceRun[origins[b]] || origins[a] - origins[b] || a - b);
    const strokeSourceRuns = new Uint32Array(total);
    this.rankToId.forEach((id, rank) => {
      this.idToRank[id] = rank;
      this.rankRun[rank] = strokeSourceRuns[id] = sourceRun[origins[id]];
    });
    // Paints reorder only within a compositor span. A page that never reaches
    // the compositor is one span whatever its graph says, so it keeps the whole
    // page to reorder in.
    this.segments = sceneRequiresPaintCompositing(scene) ? scenePaintSpanSegments(scene) : null;
    let maxSpan = 0;
    for (const span of this.segments ?? []) maxSpan = Math.max(maxSpan, span);
    this.scheduledSpanPrefix = new Uint32Array(maxSpan + 2);
    this.scheduler = VectorPageDrawScheduler.create(scene, this.strokeScene, strokeSourceRuns, this.segments);
    this.clipElision = VectorRunClipElision.create(scene, { scene: this.strokeScene, sourceRuns: strokeSourceRuns });
    this.redundancy = new VectorStrokeRedundancy(scene, { scene: this.strokeScene, sourceRuns: strokeSourceRuns });
    this.redundancyIds = new Uint32Array(total);
    this.scheduledRuns = new Uint8Array(runs.length);
    const capacity = Math.max(1, total + scene.fillPathCount + scene.textInstanceCount) * 2;
    this.floatInstances = new Float32Array(capacity);
    this.uintInstances = new Uint32Array(capacity);
  }

  /** Number of complete canonical runs represented by a span interval. */
  scheduledSpanRunCount(first: number, last: number): number {
    return this.scheduledSpanPrefix[last + 1] - this.scheduledSpanPrefix[first];
  }

  invalidate(): void { this.dirty = true; }

  setColorCommutationEnabled(enabled: boolean): void {
    const changed = this.scheduler?.setColorCommutationEnabled(enabled) ?? false;
    if (!changed && this.redundancyEnabled === enabled) return;
    this.redundancyEnabled = enabled;
    this.orderDirty = true;
    this.dirty = true;
  }

  /** Returns true only when instance data needs uploading again. */
  update(runs: readonly VectorDrawRun[], unitsPerPixel: number | null = null): boolean {
    const clipChanged = this.clipElision?.update(unitsPerPixel) ?? false;
    const orderChanged = (this.scheduler?.updateScale(unitsPerPixel) ?? false) || this.orderDirty || clipChanged;
    this.orderDirty = false;
    let sameRuns = this.initialized && runs.length === this.previousRuns.length;
    if (sameRuns && !(runs === this.sourceRuns && this.previousRunsAreSource)) {
      for (let index = 0; index < runs.length; index++) {
        if (runs[index] !== this.previousRuns[index]) { sameRuns = false; break; }
      }
    }
    if (sameRuns) this.previousRunsAreSource = runs === this.sourceRuns;
    if (!this.dirty && sameRuns && !orderChanged) return false;
    this.dirty = false;
    let selectedCount = 0;
    let sameIds = this.initialized;
    if (this.runtime) {
      this.runtime.levels.forEach((level, index) => {
        const offset = this.offsets[index];
        for (let i = 0; i < level.visibleSegmentCount; i++) {
          const id = offset + level.visibleSegmentIds[i];
          if (this.previousSelectedIds[selectedCount] !== id) sameIds = false;
          this.previousSelectedIds[selectedCount++] = id;
        }
      });
    }
    sameIds &&= selectedCount === this.previousSelectedCount;
    this.previousSelectedCount = selectedCount;
    // Camera movement changes selection, never the PDF's paint order.
    if (sameIds && sameRuns && !orderChanged) return false;
    if (!sameIds) {
      for (let index = 0; index < selectedCount; index++) {
        const rank = this.idToRank[this.previousSelectedIds[index]];
        const word = rank >>> 5;
        this.selectedRankBits[word] |= 1 << (rank & 31);
        this.selectedRankWords[word >>> 5] |= 1 << (word & 31);
      }
      // Filter the order computed at scene setup. Scanning selected bits in
      // rank order replaces comparison sorting after every LOD/culling change.
      let count = 0;
      // The second bitset skips empty words when only a small detail is visible.
      for (let group = 0; group < this.selectedRankWords.length; group++) {
        let words = this.selectedRankWords[group];
        this.selectedRankWords[group] = 0;
        while (words !== 0) {
          const word = group * 32 + 31 - Math.clz32(words & -words);
          let bits = this.selectedRankBits[word];
          this.selectedRankBits[word] = 0;
          while (bits !== 0) {
            this.selectedRanks[count++] = word * 32 + 31 - Math.clz32(bits & -bits);
            bits = (bits & (bits - 1)) >>> 0;
          }
          words = (words & (words - 1)) >>> 0;
        }
      }
      this.orderedSelectedCount = count;
    }
    selectedCount = this.orderedSelectedCount;
    let sameSelection = sameRuns && selectedCount === this.previousRankCount;
    if (sameSelection) {
      for (let index = 0; index < selectedCount; index++) {
        if (this.previousSelectedRanks[index] !== this.selectedRanks[index]) { sameSelection = false; break; }
      }
    }
    if (sameSelection && !orderChanged) return false;
    this.initialized = true;
    if (!sameRuns) {
      this.previousRuns.length = runs.length;
      for (let index = 0; index < runs.length; index++) this.previousRuns[index] = runs[index];
    }
    this.previousRunsAreSource = runs === this.sourceRuns;
    if (this.previousSelectedRanks.length < selectedCount) {
      this.previousSelectedRanks = new Uint32Array(Math.min(this.selectedRanks.length,
        Math.max(selectedCount, this.previousSelectedRanks.length * 2)));
    }
    this.previousSelectedRanks.set(this.selectedRanks.subarray(0, selectedCount));
    this.previousRankCount = selectedCount;
    this.batches.length = 0;
    this.batchSegments.length = 0;
    this.spanOrdered = true;
    this.instanceCount = 0;
    this.culledSegmentCount = 0;
    this.visiblePaints.length = 0;
    this.scheduledRuns.fill(0);
    this.scheduledSpanPrefix.fill(0);
    let cursor = 0;
    for (const run of runs) {
      const runIndex = this.runIndices.get(run)!;
      // Marked whether or not it survives LOD selection: a run culled down to
      // nothing is still one this plan speaks for, and contributes no batch.
      this.scheduledRuns[runIndex] = 1;
      this.scheduledSpanPrefix[(this.segments?.[runIndex] ?? 0) + 1]++;
      let first = run.first, count = run.count;
      if (run.kind === "stroke" && this.runtime) {
        while (cursor < selectedCount && this.rankRun[this.selectedRanks[cursor]] < runIndex) cursor++;
        first = cursor;
        while (cursor < selectedCount && this.rankRun[this.selectedRanks[cursor]] === runIndex) cursor++;
        count = cursor - first;
      }
      if (count === 0) continue;
      this.runRanges[runIndex * 2] = first;
      this.runRanges[runIndex * 2 + 1] = count;
      this.visiblePaints.push(runIndex);
    }
    for (let span = 1; span < this.scheduledSpanPrefix.length; span++) {
      this.scheduledSpanPrefix[span] += this.scheduledSpanPrefix[span - 1];
    }
    if (this.redundancyEnabled) {
      let count = 0;
      for (const runIndex of this.visiblePaints) {
        const run = this.sourceRuns[runIndex];
        if (run.kind !== "stroke") continue;
        const start = this.runRanges[runIndex * 2], end = start + this.runRanges[runIndex * 2 + 1];
        for (let index = start; index < end; index++) {
          this.redundancyIds[count++] = this.runtime ? this.rankToId[this.selectedRanks[index]] : index;
        }
      }
      this.redundancy.update(this.redundancyIds, count);
      this.culledSegmentCount = this.redundancy.culledCount;
    }
    // Schedule paint ranges first, then write selected instances directly in
    // final order. No intermediate instance copy or per-run array views.
    for (const runIndex of this.scheduler?.schedule(this.visiblePaints) ?? this.visiblePaints) {
      const run = this.sourceRuns[runIndex];
      const segment = this.segments ? this.segments[runIndex] : 0;
      const start = this.runRanges[runIndex * 2], count = this.runRanges[runIndex * 2 + 1];
      if (run.kind !== "stroke" && run.kind !== "fill" && run.kind !== "text") {
        this.pushBatch({ ...run }, segment);
        continue;
      }
      const first = this.instanceCount;
      const clipCode = this.clipElision?.clipCodes[runIndex] ?? (run.clipIndex ?? -1) + 1;
      if (run.kind === "stroke" && this.runtime) {
        for (let index = start; index < start + count; index++) {
          const id = this.rankToId[this.selectedRanks[index]];
          if (!this.redundancyEnabled || this.redundancy.isRetained(id)) this.appendInstance(id, clipCode);
        }
      } else {
        for (let id = start; id < start + count; id++) {
          if (run.kind !== "stroke" || !this.redundancyEnabled || this.redundancy.isRetained(id)) this.appendInstance(id, clipCode);
        }
      }
      const retainedCount = this.instanceCount - first;
      if (!retainedCount) continue;
      const previous = this.batches[this.batches.length - 1];
      if (previous?.kind === run.kind && previous.clipIndex === -2 && previous.blendMode === run.blendMode &&
          this.batchSegments[this.batches.length - 1] === segment) previous.count += retainedCount;
      else this.pushBatch({ kind: run.kind, first, count: retainedCount, clipIndex: -2, ...(run.blendMode ? { blendMode: run.blendMode } : {}) }, segment);
    }
    this.floatInstances.set(this.uintInstances.subarray(0, this.instanceCount * 2));
    return true;
  }

  private pushBatch(batch: VectorDrawRun, segment: number): void {
    if (segment < (this.batchSegments[this.batchSegments.length - 1] ?? 0)) this.spanOrdered = false;
    this.batches.push(batch);
    this.batchSegments.push(segment);
  }

  private appendInstance(id: number, clipCode: number): void {
    const offset = this.instanceCount * 2;
    this.uintInstances[offset] = id;
    this.uintInstances[offset + 1] = clipCode;
    this.instanceCount++;
  }
}
