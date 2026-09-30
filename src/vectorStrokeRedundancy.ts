import type { VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import { sceneRequiresPaintCompositing } from "./scenePaintVisibility";
import {
  sceneStrokeRecords, strokeRecordSegment, strokeSourceRecords, type StrokeRecords, type StrokeRecordSource
} from "./strokeRecords";

interface StrokeGeometry extends StrokeRecordSource {
  /** Source draw-run index of each primitive in the supplied geometry (including LOD). */
  sourceRuns: Uint32Array;
}

/**
 * Temporary opaque line containment, applied to the currently submitted IDs only.
 * Canonical geometry, paint ranges, layer conditions and picking identities stay intact.
 * As with the compiler's established containment optimization, this removes repeated
 * antialias coverage at coincident edges; it is not framebuffer-identical overdraw.
 */
export class VectorStrokeRedundancy {
  culledCount = 0;
  private readonly records: StrokeRecords;
  private readonly groups: Uint32Array;
  private readonly groupOffsets: Uint32Array;
  private readonly groupAxes: Uint8Array;
  private readonly candidates: Uint32Array;
  private readonly startRanks: Uint32Array;
  private readonly selected: Uint32Array;
  private readonly removed: Uint8Array;
  private readonly visited: Uint32Array;
  private readonly touched: Uint32Array;
  private readonly groupCulled: Uint32Array;
  private readonly coverage: Float64Array;
  private activeIds: Uint32Array;
  private previousIds: Uint32Array;
  private previousCount = 0;
  private revision = 0;

  constructor(scene: VectorScene, strokes?: StrokeGeometry) {
    this.records = strokes ? strokeSourceRecords(strokes) : sceneStrokeRecords(scene);
    const count = this.records.count;
    this.groups = new Uint32Array(count);
    this.startRanks = new Uint32Array(count);
    this.selected = new Uint32Array(count);
    this.removed = new Uint8Array(count);
    const runs = scene.drawRuns ?? [{ kind: "stroke", first: 0, count: scene.segmentCount }];
    const sourceRuns = strokes?.sourceRuns ?? new Uint32Array(count).fill(0xffffffff);
    if (!strokes) runs.forEach((run, index) => {
      if (run.kind === "stroke") sourceRuns.fill(index, run.first, run.first + run.count);
    });
    // Domains only classify strokes; skip scanning every fill and glyph without any.
    const domains = count ? paintDomains(scene, this.records, sourceRuns, runs) : new Uint32Array(runs.length);
    const lists: number[][] = [];
    const axes: number[] = [];
    const keys = new Map<string, number>();
    if (!sceneRequiresPaintCompositing(scene)) for (const segment of this.records.segments) for (let local = 0; local < segment.count; local++) {
      const geometry = segment.scene, id = segment.first + local, offset = local * 4, run = runs[sourceRuns[id]];
      if (!run || domains[sourceRuns[id]] === 0 || geometry.primitiveMeta[offset + 2] !== 0) continue;
      const encoded = geometry.primitiveMeta[offset + 3];
      const flags = Math.floor(encoded / 2 + 1e-6);
      const width = geometry.styles[offset];
      if (!Number.isInteger(flags) || flags < 0 || flags > 7 || encoded - flags * 2 !== 1 ||
          !Number.isFinite(width) || width < 0) continue;
      const x0 = geometry.endpoints[offset], y0 = geometry.endpoints[offset + 1];
      const x1 = geometry.primitiveMeta[offset], y1 = geometry.primitiveMeta[offset + 1];
      if (![x0, y0, x1, y1].every(Number.isFinite) || (x0 === x1 && y0 === y1)) continue;
      const dx = x1 - x0, dy = y1 - y0;
      const axis = Math.abs(dx) >= Math.abs(dy) ? 0 : 1;
      const slope = axis === 0 ? dy / dx : dx / dy;
      const intercept = axis === 0 ? y0 - slope * x0 : x0 - slope * y0;
      let key = `${domains[sourceRuns[id]]},${run.clipIndex ?? -1},${flags},${axis},${slope},${intercept}`;
      if ((flags & 4) !== 0) {
        const bounds = geometry.primitiveBounds;
        if (![bounds[offset], bounds[offset + 1], bounds[offset + 2], bounds[offset + 3]].every(Number.isFinite)) continue;
        key += `,${bounds[offset]},${bounds[offset + 1]},${bounds[offset + 2]},${bounds[offset + 3]}`;
      }
      let group = keys.get(key);
      if (group === undefined) {
        group = lists.length;
        keys.set(key, group); lists.push([]); axes.push(axis);
      } else {
        // Equal floating-point slopes/intercepts are only an index hint. Reject
        // cancellation collisions rather than merging nearby parallel geometry.
        const first = lists[group][0], held = strokeRecordSegment(this.records, first);
        const representative = (first - held.first) * 4, other = held.scene;
        const rx = other.endpoints[representative], ry = other.endpoints[representative + 1];
        const rdx = other.primitiveMeta[representative] - rx, rdy = other.primitiveMeta[representative + 1] - ry;
        if ((x0 - rx) * rdy !== (y0 - ry) * rdx || (x1 - rx) * rdy !== (y1 - ry) * rdx) continue;
      }
      lists[group].push(id);
    }
    let total = 0, groupCount = 0, largest = 0;
    for (const list of lists) if (list.length > 1) {
      total += list.length; groupCount++; largest = Math.max(largest, list.length);
    }
    this.candidates = new Uint32Array(total);
    this.groupOffsets = new Uint32Array(groupCount + 2);
    this.groupAxes = new Uint8Array(groupCount + 1);
    this.visited = new Uint32Array(groupCount + 1);
    this.touched = new Uint32Array(groupCount);
    this.groupCulled = new Uint32Array(groupCount + 1);
    this.coverage = new Float64Array(largest + 1);
    this.activeIds = new Uint32Array(total);
    this.previousIds = new Uint32Array(total);
    let cursor = 0, group = 0;
    lists.forEach((list, index) => {
      if (list.length < 2) return;
      group++;
      const axis = axes[index];
      this.groupAxes[group] = axis;
      this.groupOffsets[group] = cursor;
      list.sort((a, b) => this.start(a, axis) - this.start(b, axis));
      let rank = 0, previous = -Infinity;
      for (const id of list) {
        const start = this.start(id, axis);
        if (start !== previous) { rank++; previous = start; }
        this.startRanks[id] = rank;
        this.groups[id] = group;
      }
      const width = (id: number): number => {
        const segment = strokeRecordSegment(this.records, id), geometry = segment.scene, offset = (id - segment.first) * 4;
        return (Math.floor(geometry.primitiveMeta[offset + 3] / 2 + 1e-6) & 1) !== 0 ? 0 : geometry.styles[offset];
      };
      // A wider cover is processed first; equal-width containment puts the
      // earliest start and furthest end first. Exact duplicates prefer later paint.
      list.sort((a, b) => width(b) - width(a) || this.start(a, axis) - this.start(b, axis) ||
        this.end(b, axis) - this.end(a, axis) || sourceRuns[b] - sourceRuns[a] || b - a);
      this.candidates.set(list, cursor);
      cursor += list.length;
    });
    this.groupOffsets[group + 1] = cursor;
  }

  /** IDs may be in any order. Call only when visibility/LOD selection changes. */
  update(ids: ArrayLike<number>, count = ids.length): void {
    let previousRevision = this.revision;
    if (++this.revision > 0xffffffff) {
      this.revision = 1; this.selected.fill(0); this.removed.fill(0); this.visited.fill(0);
      this.groupCulled.fill(0); this.previousCount = 0; this.culledCount = 0; previousRevision = 0;
    }
    let touched = 0, active = 0;
    for (let index = 0; index < count; index++) {
      const id = ids[index], group = this.groups[id];
      if (!group || this.selected[id] === this.revision) continue;
      const added = previousRevision === 0 || this.selected[id] !== previousRevision;
      this.selected[id] = this.revision;
      this.activeIds[active++] = id;
      if (!added || this.visited[group] === this.revision) continue;
      this.visited[group] = this.revision;
      this.touched[touched++] = group;
    }
    for (let index = 0; index < this.previousCount; index++) {
      const id = this.previousIds[index];
      if (this.selected[id] === this.revision) continue;
      const group = this.groups[id];
      if (this.visited[group] === this.revision) continue;
      this.visited[group] = this.revision;
      this.touched[touched++] = group;
    }
    const previous = this.previousIds;
    this.previousIds = this.activeIds; this.activeIds = previous; this.previousCount = active;
    // Membership changes affect only their own collinear coverage groups.
    // Panning that changes a few viewport runs reuses all other decisions.
    for (let index = 0; index < touched; index++) {
      const group = this.touched[index], axis = this.groupAxes[group];
      const first = this.groupOffsets[group], end = this.groupOffsets[group + 1];
      const size = end - first;
      this.culledCount -= this.groupCulled[group];
      let removed = 0;
      this.coverage.fill(-Infinity, 0, size + 1);
      for (let candidate = first; candidate < end; candidate++) {
        const id = this.candidates[candidate];
        this.removed[id] = 0;
        if (this.selected[id] !== this.revision) continue;
        const rank = this.startRanks[id], farEnd = this.end(id, axis);
        let coveredEnd = -Infinity;
        for (let cursor = rank; cursor > 0; cursor -= cursor & -cursor) coveredEnd = Math.max(coveredEnd, this.coverage[cursor]);
        if (coveredEnd >= farEnd) {
          this.removed[id] = 1; removed++;
        } else for (let cursor = rank; cursor <= size; cursor += cursor & -cursor) {
          this.coverage[cursor] = Math.max(this.coverage[cursor], farEnd);
        }
      }
      this.groupCulled[group] = removed;
      this.culledCount += removed;
    }
  }

  isRetained(id: number): boolean { return this.removed[id] !== 1; }

  private start(id: number, axis: number): number {
    const segment = strokeRecordSegment(this.records, id), offset = (id - segment.first) * 4 + axis;
    return Math.min(segment.scene.endpoints[offset], segment.scene.primitiveMeta[offset]);
  }

  private end(id: number, axis: number): number {
    const segment = strokeRecordSegment(this.records, id), offset = (id - segment.first) * 4 + axis;
    return Math.max(segment.scene.endpoints[offset], segment.scene.primitiveMeta[offset]);
  }
}

/** Different colors, images, gradients and blends fence independent coverage domains. */
function paintDomains(scene: VectorScene, strokes: StrokeRecords, sourceRuns: Uint32Array,
  runs: readonly VectorDrawRun[]): Uint32Array {
  const colors: (string | null | undefined)[] = new Array(runs.length).fill(undefined);
  const include = (run: number, r: number, g: number, b: number): void => {
    if (colors[run] === null) return;
    if (![r, g, b].every(Number.isFinite)) { colors[run] = null; return; }
    const color = `${r},${g},${b}`;
    if (colors[run] === undefined) colors[run] = color;
    else if (colors[run] !== color) colors[run] = null;
  };
  runs.forEach((run, index) => {
    if (run.blendMode || (run.kind !== "stroke" && run.kind !== "fill" && run.kind !== "text")) {
      colors[index] = null; return;
    }
    if (run.kind === "stroke") return;
    for (let id = run.first; id < run.first + run.count && colors[index] !== null; id++) {
      const offset = id * 4;
      if (run.kind === "fill") include(index, scene.fillPathMetaB[offset + 2], scene.fillPathMetaB[offset + 3], scene.fillPathMetaC[offset + 2]);
      else include(index, textColor(scene.textInstanceC[offset]), textColor(scene.textInstanceC[offset + 1]), textColor(scene.textInstanceC[offset + 2]));
    }
  });
  for (const segment of strokes.segments) {
    const styles = segment.scene.styles;
    for (let index = 0; index < segment.count; index++) {
      const run = sourceRuns[segment.first + index];
      if (runs[run]?.kind === "stroke") include(run, styles[index * 4 + 1], styles[index * 4 + 2], styles[index * 4 + 3]);
    }
  }
  const domains = new Uint32Array(runs.length);
  let domain = 0, previous: string | null | undefined;
  colors.forEach((color, index) => {
    if (color !== previous || !color) domain++;
    if (color) domains[index] = domain;
    previous = color;
  });
  return domains;
}

function textColor(value: number): number {
  return Number.isFinite(value) ? Math.fround(Math.round(Math.max(0, Math.min(1, value)) * 255) / 255) : NaN;
}
