import type { VectorDrawRun } from "./pdfVectorExtractor";
import type { VectorOrderedBatches } from "./vectorOrderedBatches";

export interface MixedVectorDrawRun {
  kind: "mixed-vector";
  /** Range in the mixed instance buffers, whose records are [id, clipCode, kind]. */
  first: number;
  count: number;
  strokeCount: number;
  fillCount: number;
  clipIndex: -2;
}

export type MixedVectorBatch = VectorDrawRun | MixedVectorDrawRun;

/** Combine adjacent source-over strokes and fills without changing their instance order. */
export class MixedVectorBatches {
  readonly batches: MixedVectorBatch[] = [];
  readonly batchSegments: number[] = [];
  instanceCount = 0;
  revision = 0;
  private instanceData = new Uint32Array(0);
  private floatData = new Float32Array(0);
  private floatsDirty = false;
  private source: VectorOrderedBatches | null = null;
  private sourceRevision = -1;

  /** Mixed records only. Forwarded ordinary batches still address the source plan's buffer. */
  get uintInstances(): Uint32Array { return this.instanceData; }

  /** WebGL attributes use floats; WebGPU can upload uintInstances without this copy. */
  get floatInstances(): Float32Array {
    if (this.floatData.length < this.instanceCount * 3) {
      this.floatData = new Float32Array(this.instanceData.length);
      this.floatsDirty = true;
    }
    if (this.floatsDirty) {
      const count = this.instanceCount * 3;
      for (let index = 0; index < count; index++) this.floatData[index] = this.instanceData[index];
      this.floatsDirty = false;
    }
    return this.floatData;
  }

  /** Returns true when the derived batches and mixed instance data were rebuilt. */
  update(plan: VectorOrderedBatches): boolean {
    // revision includes LOD changes and clip elision even when coverageRevision is unchanged.
    if (this.source === plan && this.sourceRevision === plan.revision) return false;
    this.source = plan;
    this.sourceRevision = plan.revision;
    this.batches.length = 0;
    this.batchSegments.length = 0;
    this.instanceCount = 0;
    const groups: { first: number; end: number; output: number }[] = [];
    for (let first = 0; first < plan.batches.length;) {
      const segment = plan.batchSegments[first] ?? 0;
      let end = first, strokeCount = 0, fillCount = 0;
      while (end < plan.batches.length && (plan.batchSegments[end] ?? 0) === segment) {
        const next = plan.batches[end];
        if (!eligible(next)) break;
        if (next.kind === "stroke") strokeCount += next.count;
        else fillCount += next.count;
        end++;
      }
      if (strokeCount > 0 && fillCount > 0) {
        const count = strokeCount + fillCount;
        this.batches.push({ kind: "mixed-vector", first: this.instanceCount, count,
          strokeCount, fillCount, clipIndex: -2 });
        this.batchSegments.push(segment);
        groups.push({ first, end, output: this.instanceCount });
        this.instanceCount += count;
        first = end;
      } else {
        // One-kind ranges gain nothing from another shader or instance buffer.
        const next = Math.max(end, first + 1);
        for (let index = first; index < next; index++) {
          this.batches.push(plan.batches[index]);
          this.batchSegments.push(plan.batchSegments[index] ?? 0);
        }
        first = next;
      }
    }
    const floats = this.instanceCount * 3;
    if (this.instanceData.length < floats) {
      this.instanceData = new Uint32Array(Math.max(floats, this.instanceData.length * 2));
    }
    const source = plan.uintInstances;
    for (const group of groups) {
      let output = group.output * 3;
      for (let batch = group.first; batch < group.end; batch++) {
        const run = plan.batches[batch], kind = run.kind === "stroke" ? 0 : 1;
        for (let instance = run.first; instance < run.first + run.count; instance++) {
          this.instanceData[output++] = source[instance * 2];
          this.instanceData[output++] = source[instance * 2 + 1];
          this.instanceData[output++] = kind;
        }
      }
    }
    this.floatsDirty = true;
    this.revision++;
    return true;
  }
}

function eligible(run: VectorDrawRun): boolean {
  return (run.kind === "stroke" || run.kind === "fill") && run.clipIndex === -2 &&
    run.blendMode === undefined && run.count > 0;
}
