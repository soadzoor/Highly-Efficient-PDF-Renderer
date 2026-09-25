import type { VectorScene } from "./pdfVectorExtractor";
import { VectorDrawRunCuller } from "./vectorDrawRunCulling";

const kinds = ["stroke", "fill", "text", "raster", "gradient-fill", "gradient-stroke"] as const;
const PAINT_LOOKAHEAD = 128;
// Dense interleaved drawings otherwise exhaust the search halfway through the
// page. This remains a linear work bound; it is paid only when replanning.
const PAINT_CHECKS_PER_RUN = 128;
// A source-wide schedule avoids replanning whenever a new paint enters the view.
// Small scenes retain subset scheduling, where its cost and draw count are low.
const FULL_SCHEDULE_MIN_RUNS = 1024;
// Large visibility changes should regroup draws instead of retaining a sparse schedule.
const MIN_CACHED_PAINT_FRACTION = 0.875;
// Coverage margins are a screen-space quantity, so minifying grows them without
// bound in page units. Once the largest page is shorter than this on screen,
// every paint's margin spans a noticeable share of it, the dependency graph
// saturates, and the schedule degenerates to one draw per source paint for a
// thumbnail-sized image. Holding the margin where it stands at this size keeps
// the test discriminating: it stays exact above it, and below it only lets
// paints commute that are within a fraction of a pixel of each other anyway.
const MIN_RESOLVED_PAGE_PIXELS = 256;
// Holding the margin trades exact order between those neighbours for draw
// calls, which only pays on a page carrying far more paints than a minified
// view can resolve. Smaller scenes are already cheap to draw in source order.
const MIN_CLAMPED_PAINTS = 1024;

/** Interleave independent paint streams; overlapping streams retain source order. */
export class VectorPageDrawScheduler {
  independentGroups = 1;
  /** True while minification holds the coverage margin at its page-relative bound. */
  paintOrderApproximated = false;
  private readonly bounds: VectorDrawRunCuller;
  private readonly pageForRun: Uint16Array;
  private readonly kindForRun: Uint8Array;
  private readonly colorForRun: Int32Array;
  private readonly components: Int32Array;
  private readonly pageBounds: Float64Array;
  private readonly paintBounds: Float64Array;
  private readonly heads: Int32Array;
  private readonly tails: Int32Array;
  private readonly next: Int32Array;
  private readonly ordered: number[] = [];
  private readonly compacted: number[] = [];
  private readonly colorGrouped: number[] = [];
  private readonly skipped = new Int32Array(PAINT_LOOKAHEAD);
  private readonly previousPaints: Uint32Array;
  private readonly selectedPaints: Uint8Array;
  private readonly allPaints: readonly number[] | null;
  private readonly filtered: number[] = [];
  private readonly segmentRuns: number[] = [];
  private readonly segments: Uint32Array | null;
  private readonly paddingLimit: number;
  private previousPaintCount = -1;
  private scheduleDirty = true;
  private padding = NaN;
  private enabled = false;
  private colorCommutationEnabled = true;

  /**
   * `segments` restricts reordering to paints that share a compositor span; see
   * scenePaintSpanSegments. Omitting it schedules the page as one span, which
   * is what a document without transparency groups already is.
   */
  static create(scene: VectorScene, strokes: VectorScene, sourceRuns: Uint32Array,
    segments: Uint32Array | null = null): VectorPageDrawScheduler | null {
    const pages = scene.pageRects.length / 4;
    // Bound setup work for arbitrary public scenes, including invalid layouts.
    if (!scene.drawRuns || pages < 1 || pages > 512 || !Number.isInteger(pages) ||
        !scene.pageRects.every(Number.isFinite)) return null;
    if (segments && segments.length !== scene.drawRuns.length) return null;
    return new VectorPageDrawScheduler(scene, strokes, sourceRuns, segments);
  }

  private constructor(scene: VectorScene, strokes: VectorScene, sourceRuns: Uint32Array, segments: Uint32Array | null) {
    const runs = scene.drawRuns!;
    const pages = scene.pageRects.length / 4;
    this.segments = segments;
    this.bounds = new VectorDrawRunCuller(scene, { scene: strokes, sourceRuns });
    this.pageForRun = new Uint16Array(runs.length);
    this.kindForRun = new Uint8Array(runs.length);
    this.colorForRun = uniformPaintColors(scene, strokes, sourceRuns);
    this.components = new Int32Array(pages);
    this.pageBounds = new Float64Array(pages * 4);
    this.paintBounds = new Float64Array(runs.length * 4);
    this.heads = new Int32Array(pages);
    this.tails = new Int32Array(pages);
    this.next = new Int32Array(runs.length);
    this.previousPaints = new Uint32Array(runs.length);
    this.selectedPaints = new Uint8Array(runs.length);
    this.allPaints = runs.length >= FULL_SCHEDULE_MIN_RUNS
      ? Array.from({ length: runs.length }, (_, index) => index) : null;
    let longestPage = 0;
    for (let page = 0; page < pages; page++) {
      const offset = page * 4, rect = scene.pageRects;
      longestPage = Math.max(longestPage, rect[offset + 2] - rect[offset], rect[offset + 3] - rect[offset + 1]);
    }
    // Margins below are four pixels wide, so this is the one the largest page
    // reaches at MIN_RESOLVED_PAGE_PIXELS. A degenerate rect keeps exact margins.
    this.paddingLimit = longestPage > 0 && runs.length >= MIN_CLAMPED_PAINTS
      ? 4 * longestPage / MIN_RESOLVED_PAGE_PIXELS : Infinity;
    const box = [0, 0, 0, 0];
    runs.forEach((run, index) => {
      this.kindForRun[index] = kinds.indexOf(run.kind);
      this.bounds.getBounds(index, 0, box);
      const x = (box[0] + box[2]) * 0.5, y = (box[1] + box[3]) * 0.5;
      let nearest = 0, distance = Infinity;
      for (let page = 0; page < pages; page++) {
        const offset = page * 4, rect = scene.pageRects;
        const dx = Math.max(rect[offset] - x, 0, x - rect[offset + 2]);
        const dy = Math.max(rect[offset + 1] - y, 0, y - rect[offset + 3]);
        if (dx * dx + dy * dy < distance) { nearest = page; distance = dx * dx + dy * dy; }
      }
      // Page proximity is only a partitioning hint. Safety comes from the
      // actual paint bounds below, including content outside the page rect.
      this.pageForRun[index] = nearest;
    });
  }

  /** Temporary primitive colors can invalidate source-color equivalence. */
  setColorCommutationEnabled(enabled: boolean): boolean {
    if (this.colorCommutationEnabled === enabled) return false;
    this.colorCommutationEnabled = enabled;
    this.scheduleDirty = true;
    return true;
  }

  /** null disables reordering for projections without a conservative pixel scale. */
  updateScale(unitsPerPixel: number | null): boolean {
    if (unitsPerPixel === null || !Number.isFinite(unitsPerPixel) || unitsPerPixel <= 0) {
      const changed = this.enabled;
      this.enabled = false;
      this.independentGroups = 1;
      this.paintOrderApproximated = false;
      return changed;
    }
    // A power-of-two upper bound avoids rebuilding the dependency partition
    // on every animated zoom step. Keep four pixels for the fallback kinds;
    // ordinary vector paints use their shader-specific coverage bounds below.
    const pixelPadding = Math.max(0.001, 4 * 2 ** Math.ceil(Math.log2(Math.max(1e-6, unitsPerPixel))));
    // Minification past a thumbnail otherwise fences every paint against every
    // other one, which costs a draw call per source paint and buys ordering
    // the page no longer has the pixels to show.
    const padding = Math.min(pixelPadding, this.paddingLimit);
    this.paintOrderApproximated = padding < pixelPadding;
    if (this.enabled && padding === this.padding) return false;
    this.enabled = true;
    this.padding = padding;
    this.scheduleDirty = true;
    const pages = this.components.length;
    for (let page = 0; page < pages; page++) this.pageBounds.set([Infinity, Infinity, -Infinity, -Infinity], page * 4);
    const box = [0, 0, 0, 0];
    for (let run = 0; run < this.pageForRun.length; run++) {
      const kind = this.kindForRun[run];
      // Stroke bounds already include source widths. Native fragment coverage
      // reaches another 1px, or 1.5px for device hairlines; 2px contains both.
      // Fill/text vertices stay within their source/transformed-glyph quads:
      // retain an extra half pixel instead of expanding them by stroke AA.
      // This changes dependency tests only, never rendered geometry or AA.
      const coveragePadding = Math.max(0.001, padding * (kind === 0 ? 0.5 : kind < 3 ? 0.125 : 1));
      this.bounds.getBounds(run, coveragePadding, box);
      if (box.some(Number.isNaN)) box.splice(0, 4, -Infinity, -Infinity, Infinity, Infinity);
      this.paintBounds.set(box, run * 4);
      if (box[0] > box[2] || box[1] > box[3]) continue;
      const offset = this.pageForRun[run] * 4;
      this.pageBounds[offset] = Math.min(this.pageBounds[offset], box[0]);
      this.pageBounds[offset + 1] = Math.min(this.pageBounds[offset + 1], box[1]);
      this.pageBounds[offset + 2] = Math.max(this.pageBounds[offset + 2], box[2]);
      this.pageBounds[offset + 3] = Math.max(this.pageBounds[offset + 3], box[3]);
    }
    const parents = Int32Array.from({ length: pages }, (_, index) => index);
    const root = (index: number): number => {
      while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; }
      return index;
    };
    for (let page = 0; page < pages; page++) {
      const a = page * 4, bounds = this.pageBounds;
      if (bounds[a] > bounds[a + 2] || bounds[a + 1] > bounds[a + 3]) continue;
      for (let other = 0; other < page; other++) {
        const b = other * 4;
        if (bounds[b] > bounds[b + 2] || bounds[b + 1] > bounds[b + 3] ||
            bounds[a + 2] < bounds[b] || bounds[b + 2] < bounds[a] ||
            bounds[a + 3] < bounds[b + 1] || bounds[b + 3] < bounds[a + 1]) continue;
        const first = root(page), second = root(other);
        parents[Math.max(first, second)] = Math.min(first, second);
      }
    }
    const groups = new Set<number>();
    for (let page = 0; page < pages; page++) {
      const group = root(page);
      this.components[page] = group;
      groups.add(group);
    }
    this.independentGroups = groups.size;
    // Within-page swaps depend on paint extents even when page groups stay
    // unchanged. Replan once per AA bucket, including when zooming back in.
    return true;
  }

  schedule(runs: readonly number[]): readonly number[] {
    if (!this.enabled) return runs;
    if (this.allPaints) {
      // Removing paints from a valid order preserves every dependency, including
      // when hidden layers or previously culled paints become visible again.
      // Bounds include all LOD levels, so only AA scale and color overrides
      // invalidate this template, not viewport membership or selected stroke IDs.
      if (this.scheduleDirty) {
        this.scheduleDirty = false;
        this.schedulePaints(this.allPaints);
      }
      return runs.length === this.allPaints.length ? this.compacted : this.filterSchedule(runs);
    }
    // Dependency bounds include every LOD level, so changing primitive IDs
    // within the same paints does not invalidate this order.
    if (!this.scheduleDirty && runs.length <= this.previousPaintCount &&
        runs.length >= this.previousPaintCount * MIN_CACHED_PAINT_FRACTION) {
      let cursor = 0;
      for (let index = 0; index < this.previousPaintCount && cursor < runs.length; index++) {
        if (runs[cursor] === this.previousPaints[index]) cursor++;
      }
      // Removing paints from a valid schedule preserves every overlap dependency
      // and cannot increase its draw count. Keep the original template so paints
      // that reenter the view can reuse it too; new paints still require scheduling.
      if (cursor === runs.length) {
        if (runs.length === this.previousPaintCount) return this.compacted;
        return this.filterSchedule(runs);
      }
    }
    this.previousPaints.set(runs);
    this.previousPaintCount = runs.length;
    this.scheduleDirty = false;
    return this.schedulePaints(runs);
  }

  private filterSchedule(runs: readonly number[]): readonly number[] {
    this.selectedPaints.fill(0);
    for (const run of runs) this.selectedPaints[run] = 1;
    this.filtered.length = 0;
    for (const run of this.compacted) if (this.selectedPaints[run]) this.filtered.push(run);
    return this.filtered;
  }

  private schedulePaints(runs: readonly number[]): readonly number[] {
    this.compacted.length = 0;
    if (!this.segments) { this.appendSchedule(runs); return this.compacted; }
    // Paints in different spans have a composite between them, so only paints
    // sharing one may be reordered. Segment ids rise along the graph, so equal
    // ids are already adjacent in this source-ordered list.
    for (let first = 0; first < runs.length;) {
      const segment = this.segments[runs[first]];
      this.segmentRuns.length = 0;
      while (first < runs.length && this.segments[runs[first]] === segment) this.segmentRuns.push(runs[first++]);
      this.appendSchedule(this.segmentRuns);
    }
    return this.compacted;
  }

  private appendSchedule(runs: readonly number[]): void {
    this.appendCompacted(this.independentGroups <= 1 ? runs : this.interleave(runs));
  }

  private interleave(runs: readonly number[]): readonly number[] {
    this.heads.fill(-1); this.tails.fill(-1); this.ordered.length = 0;
    for (const run of runs) {
      const group = this.components[this.pageForRun[run]];
      if (this.tails[group] < 0) this.heads[group] = run;
      else this.next[this.tails[group]] = run;
      this.tails[group] = run;
      this.next[run] = -1;
    }
    const votes = new Uint32Array(kinds.length);
    while (this.ordered.length < runs.length) {
      votes.fill(0);
      for (const head of this.heads) if (head >= 0) votes[this.kindForRun[head]]++;
      let kind = 0;
      for (let index = 1; index < votes.length; index++) if (votes[index] > votes[kind]) kind = index;
      for (let group = 0; group < this.heads.length; group++) {
        let head = this.heads[group];
        while (head >= 0 && this.kindForRun[head] === kind) {
          this.ordered.push(head); head = this.next[head];
        }
        this.heads[group] = head;
      }
    }
    return this.ordered;
  }

  /** Disjoint paints and equal-RGB Normal paints commute under source-over. */
  private appendCompacted(runs: readonly number[]): void {
    if (this.colorCommutationEnabled) runs = this.groupUniformColors(runs);
    for (let index = 0; index < runs.length; index++) this.next[runs[index]] = runs[index + 1] ?? -1;
    let head = runs[0] ?? -1;
    // Bound rebuild work when a document has many mutually overlapping paints.
    let checksLeft = Math.max(8192, runs.length * PAINT_CHECKS_PER_RUN);
    while (head >= 0) {
      const kind = this.kindForRun[head];
      this.compacted.push(head);
      head = this.next[head];
      // Images/gradients use separate GPU resources and cannot share a draw.
      if (kind >= 3) continue;
      let cursor = head, previous = -1, skippedCount = 0;
      while (cursor >= 0 && skippedCount < PAINT_LOOKAHEAD && checksLeft > 0) {
        const following = this.next[cursor];
        let movable = this.kindForRun[cursor] === kind;
        if (movable) {
          for (let index = 0; index < skippedCount; index++) {
            if (checksLeft-- <= 0 || this.dependsOn(cursor, this.skipped[index])) { movable = false; break; }
          }
        }
        if (movable) {
          this.compacted.push(cursor);
          if (previous < 0) head = following;
          else this.next[previous] = following;
        } else {
          this.skipped[skippedCount++] = cursor;
          previous = cursor;
        }
        cursor = following;
      }
    }
  }

  /** Long monochrome drawing spans need linear grouping, not bounded swaps. */
  private groupUniformColors(runs: readonly number[]): readonly number[] {
    this.colorGrouped.length = 0;
    for (let first = 0; first < runs.length;) {
      const color = this.colorForRun[runs[first]];
      let end = first + 1;
      if (color > 0) while (end < runs.length && this.colorForRun[runs[end]] === color) end++;
      if (end === first + 1) this.colorGrouped.push(runs[first]);
      else {
        // At most three passes through a span. Keep each kind's canonical
        // order and leave different colors, blends and images as barriers.
        for (let kind = 0; kind < 3; kind++) {
          for (let index = first; index < end; index++) {
            const run = runs[index];
            if (this.kindForRun[run] === kind) this.colorGrouped.push(run);
          }
        }
      }
      first = end;
    }
    return this.colorGrouped;
  }

  private dependsOn(first: number, second: number): boolean {
    // Alpha, antialiasing, and clipping change coverage, but equal RGB still
    // gives C * (a + b - a*b) over the same backdrop in either paint order.
    const color = this.colorForRun[first];
    if (this.colorCommutationEnabled && color > 0 && color === this.colorForRun[second]) return false;
    return this.overlaps(first, second);
  }

  private overlaps(first: number, second: number): boolean {
    const a = first * 4, b = second * 4, bounds = this.paintBounds;
    return !(bounds[a] > bounds[a + 2] || bounds[a + 1] > bounds[a + 3] ||
      bounds[b] > bounds[b + 2] || bounds[b + 1] > bounds[b + 3] ||
      bounds[a + 2] < bounds[b] || bounds[b + 2] < bounds[a] ||
      bounds[a + 3] < bounds[b + 1] || bounds[b + 3] < bounds[a + 1]);
  }
}

/** Exact uploaded RGB only; blending modes and images retain overlap order. */
function uniformPaintColors(scene: VectorScene, strokes: VectorScene, sourceRuns: Uint32Array): Int32Array {
  const runs = scene.drawRuns!;
  const ids = new Int32Array(runs.length);
  const colors = new Float32Array(runs.length * 3);
  const palette = new Map<string, number>();
  const include = (run: number, red: number, green: number, blue: number): void => {
    if (ids[run] < 0) return;
    const offset = run * 3;
    if (!Number.isFinite(red) || !Number.isFinite(green) || !Number.isFinite(blue)) { ids[run] = -1; return; }
    if (ids[run] > 0) {
      if (colors[offset] !== red || colors[offset + 1] !== green || colors[offset + 2] !== blue) ids[run] = -1;
      return;
    }
    colors[offset] = red; colors[offset + 1] = green; colors[offset + 2] = blue;
    const key = `${red},${green},${blue}`;
    let id = palette.get(key);
    if (id === undefined) { id = palette.size + 1; palette.set(key, id); }
    ids[run] = id;
  };
  runs.forEach((run, index) => {
    if (run.blendMode || (run.kind !== "stroke" && run.kind !== "fill" && run.kind !== "text")) { ids[index] = -1; return; }
    if (run.kind === "stroke") return;
    for (let primitive = run.first; primitive < run.first + run.count && ids[index] >= 0; primitive++) {
      const offset = primitive * 4;
      if (run.kind === "fill") include(index, scene.fillPathMetaB[offset + 2], scene.fillPathMetaB[offset + 3], scene.fillPathMetaC[offset + 2]);
      // Text colors use RGBA8_UNORM, while fills/strokes retain float32 RGB.
      // Equal source numbers alone do not establish equal shader colors.
      else include(index, textColor(scene.textInstanceC[offset]), textColor(scene.textInstanceC[offset + 1]), textColor(scene.textInstanceC[offset + 2]));
    }
  });
  // Include all LOD levels, even dormant ones, so tile/zoom changes can reuse
  // the schedule without assuming simplification preserves the original RGB.
  for (let index = 0; index < strokes.segmentCount; index++) {
    const offset = index * 4;
    include(sourceRuns[index], strokes.styles[offset + 1], strokes.styles[offset + 2], strokes.styles[offset + 3]);
  }
  return ids;
}

function textColor(value: number): number {
  return Number.isFinite(value) ? Math.fround(Math.round(Math.max(0, Math.min(1, value)) * 255) / 255) : NaN;
}
