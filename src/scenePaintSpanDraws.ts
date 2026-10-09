import type { VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import type { VectorOrderedBatches } from "./vectorOrderedBatches";

export type CanonicalRunLookup = Map<VectorDrawRun["kind"], { firsts: Int32Array; ends: Int32Array; indices: Int32Array }>;

interface SpanBatchRange { low: number; high: number; revision: number; first: number; end: number }
interface SpanBatchCache {
  coverageRevision: number;
  segments: Uint32Array;
  lookup: CanonicalRunLookup | null;
  ranges: WeakMap<readonly VectorDrawRun[], SpanBatchRange | null>;
}
const spanBatchCaches = new WeakMap<VectorOrderedBatches, SpanBatchCache>();

/** Per kind, canonical run indices sorted by their first primitive. */
export function buildCanonicalRunLookup(scene: VectorScene): CanonicalRunLookup | null {
  const runs = scene.drawRuns;
  if (!runs) return null;
  const byKind = new Map<VectorDrawRun["kind"], number[]>();
  runs.forEach((run, index) => {
    const list = byKind.get(run.kind);
    if (list) list.push(index); else byKind.set(run.kind, [index]);
  });
  const lookup: CanonicalRunLookup = new Map();
  for (const [kind, list] of byKind) {
    list.sort((a, b) => runs[a].first - runs[b].first);
    lookup.set(kind, { firsts: Int32Array.from(list, index => runs[index].first),
      ends: Int32Array.from(list, index => runs[index].first + runs[index].count), indices: Int32Array.from(list) });
  }
  return lookup;
}

/** The canonical run of this kind holding that primitive, or -1. */
function canonicalRunPosition(lookup: CanonicalRunLookup | null, kind: VectorDrawRun["kind"], primitive: number): number {
  const entry = lookup?.get(kind);
  if (!entry) return -1;
  let low = 0, high = entry.firsts.length - 1, found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (entry.firsts[middle] <= primitive) { found = middle; low = middle + 1; } else high = middle - 1;
  }
  return found < 0 || primitive >= entry.ends[found] ? -1 : found;
}

/**
 * Submits one compositor span. Every paint in a span composes with plain
 * source-over onto the same surface, so the span can be drawn the way the
 * ordered plan batched it - a handful of instanced draws instead of one per
 * paint - by taking the stretch of batches whose span ids fall inside it.
 *
 * A span the plan does not speak for, soft-mask contents above all, submits its
 * own paints one at a time, exactly as every span did before batching existed.
 */
export function submitPaintSpan(runs: readonly VectorDrawRun[], plan: VectorOrderedBatches | null,
  segments: Uint32Array | null, lookup: CanonicalRunLookup | null, draw: (run: VectorDrawRun) => void): void {
  let cache: SpanBatchCache | undefined;
  if (plan && segments && plan.spanOrdered) {
    cache = spanBatchCaches.get(plan);
    if (!cache || cache.coverageRevision !== plan.coverageRevision || cache.segments !== segments || cache.lookup !== lookup) {
      cache = { coverageRevision: plan.coverageRevision, segments, lookup, ranges: new WeakMap() };
      spanBatchCaches.set(plan, cache);
    }
    // Recorded compositor spans are immutable and survive camera-only frames.
    // Resolving their canonical coverage again would visit every source paint,
    // even when LOD selected only a few thousand instances for the same batches.
    const range = cache.ranges.get(runs);
    if (range !== undefined) {
      if (range) {
        if (range.revision !== plan.revision) refreshSpanBatchRange(range, plan);
        for (let index = range.first; index < range.end; index++) draw(plan.batches[index]);
      } else for (const run of runs) draw(run);
      return;
    }
  }
  let low = Infinity, high = -Infinity;
  if (plan && segments && plan.spanOrdered) {
    const covered = new Set<number>();
    let complete = true;
    for (const run of runs) {
      const entry = lookup?.get(run.kind);
      let position = canonicalRunPosition(lookup, run.kind, run.first);
      let primitive = run.first;
      const end = primitive + run.count;
      // Compositors may merge consecutive canonical runs, or request just one
      // object of a blend/knockout run. Only complete runs may use the plan.
      while (entry && position >= 0 && primitive < end) {
        const index = entry.indices[position];
        if (entry.firsts[position] !== primitive || entry.ends[position] > end ||
            !plan.scheduledRuns[index] || covered.has(index)) break;
        covered.add(index);
        low = Math.min(low, segments[index]);
        high = Math.max(high, segments[index]);
        primitive = entry.ends[position++];
      }
      if (primitive !== end) { complete = false; break; }
    }
    // A singleton request inside a larger span must not draw its neighbours.
    if (!complete || covered.size !== plan.scheduledSpanRunCount(low, high)) {
      low = Infinity; high = -Infinity;
    }
  }
  if (!plan || low > high) {
    cache?.ranges.set(runs, null);
    for (const run of runs) draw(run);
    return;
  }
  const range = { low, high, revision: plan.revision, first: 0, end: 0 };
  refreshSpanBatchRange(range, plan);
  cache?.ranges.set(runs, range);
  for (let index = range.first; index < range.end; index++) draw(plan.batches[index]);
}

/** LOD changes batch ranges while the canonical span coverage stays reusable. */
function refreshSpanBatchRange(range: SpanBatchRange, plan: VectorOrderedBatches): void {
  // Span ids rise along the batches. Binary searches find both ends, including
  // an empty span, without walking the canonical runs during animated zooms.
  // A shape pass can repeat this span without advancing a shared draw cursor.
  const ids = plan.batchSegments;
  let first = 0, last = ids.length - 1;
  while (first <= last) {
    const middle = (first + last) >> 1;
    if (ids[middle] < range.low) first = middle + 1; else last = middle - 1;
  }
  range.first = first;
  last = ids.length - 1;
  while (first <= last) {
    const middle = (first + last) >> 1;
    if (ids[middle] <= range.high) first = middle + 1; else last = middle - 1;
  }
  range.end = first;
  range.revision = plan.revision;
}
