import type { VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import type { VectorOrderedBatches } from "./vectorOrderedBatches";

export type CanonicalRunLookup = Map<VectorDrawRun["kind"], { firsts: Int32Array; indices: Int32Array }>;

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
    lookup.set(kind, { firsts: Int32Array.from(list, index => runs[index].first), indices: Int32Array.from(list) });
  }
  return lookup;
}

/** The canonical run of this kind holding that primitive, or -1. */
function canonicalRunIndex(lookup: CanonicalRunLookup | null, kind: VectorDrawRun["kind"], primitive: number): number {
  const entry = lookup?.get(kind);
  if (!entry) return -1;
  let low = 0, high = entry.firsts.length - 1, found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (entry.firsts[middle] <= primitive) { found = middle; low = middle + 1; } else high = middle - 1;
  }
  return found < 0 ? -1 : entry.indices[found];
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
  let low = Infinity, high = -Infinity;
  if (plan && segments && plan.spanOrdered) {
    for (const run of runs) {
      for (const primitive of [run.first, run.first + run.count - 1]) {
        const index = canonicalRunIndex(lookup, run.kind, primitive);
        if (index >= 0 && plan.scheduledRuns[index]) {
          low = Math.min(low, segments[index]);
          high = Math.max(high, segments[index]);
        } else { low = Infinity; high = -Infinity; break; }
      }
      if (low > high) break;
    }
  }
  if (!plan || low > high) {
    for (const run of runs) draw(run);
    return;
  }
  // Span ids rise along the batches, and one span's batches are contiguous among
  // them. Searching rather than advancing a cursor keeps the geometric shape
  // pass, which submits the same span a second time, drawing the same batches.
  const ids = plan.batchSegments;
  let first = 0, last = ids.length - 1;
  while (first <= last) {
    const middle = (first + last) >> 1;
    if (ids[middle] < low) first = middle + 1; else last = middle - 1;
  }
  for (let index = first; index < plan.batches.length && ids[index] <= high; index++) draw(plan.batches[index]);
}
