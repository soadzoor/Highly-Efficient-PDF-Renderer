/** A bounded, opt-in capture. CPU timings measure JavaScript/submission work,
 * while asynchronous GPU timer queries measure the sampled GPU command span. */
export interface RenderPerformanceOptions {
  maxFrames?: number;
  /** Bounded correlated records in reports (default 120); zero disables them. */
  maxFrameRecords?: number;
  /** Defaults to true. Requires a WebGL2 context with the timer-query extension. */
  gpu?: boolean;
}

export interface RenderPerformanceFrameContext {
  cameraCenterX?: number | null;
  cameraCenterY?: number | null;
  zoom?: number | null;
  viewportWidth?: number | null;
  viewportHeight?: number | null;
  unitsPerPixel?: number | null;
  schedulePadding?: number | null;
  /** Raw interval, including gaps omitted from the frame-interval summary. */
  frameGapMs?: number | null;
}

type FrameRecordReason = "slow-cpu" | "slow-gpu" | "high-batches" | "stall-neighbour" | "timeline";

export interface RenderPerformanceEvent { name: string; durationMs: number }
type FrameGpuStatus = "not-sampled" | "pending" | "available" | "discarded";

export interface RenderPerformanceFrameRecord {
  /** One-based capture-local frame number; startMs is relative to capture start. */
  frame: number;
  startMs: number;
  intervalMs: number | null;
  cpuMs: number;
  gpuMs: number | null;
  gpuStatus: FrameGpuStatus;
  context: RenderPerformanceFrameContext;
  cpuSectionsMs: Record<string, number>;
  counters: Record<string, number>;
  reasons: readonly FrameRecordReason[];
  /** Up to eight longest diagnostic events in this frame. */
  events: RenderPerformanceEvent[];
}

export interface RenderPerformanceSummary {
  samples: number;
  total: number;
  average: number | null;
  p50: number | null;
  p95: number | null;
  min: number | null;
  max: number | null;
}

export interface RenderPerformanceReport {
  active: boolean;
  frames: number;
  maxFrames: number;
  elapsedMs: number;
  frameIntervalMs: RenderPerformanceSummary;
  frameCpuMs: RenderPerformanceSummary;
  /** Sections and counters are totals per completed frame, including zeroes. */
  cpuSections: Record<string, RenderPerformanceSummary>;
  counters: Record<string, RenderPerformanceSummary>;
  /** Chronological subset, selected only on report creation from slow CPU/GPU,
   * high-batch and evenly spaced frames. Aggregates still cover all frames. */
  frameRecords: RenderPerformanceFrameRecord[];
  frameRecordLimit: number;
  ignoredFrameGaps: number;
  discardedMetricNames: number;
  gpu: {
    status: "disabled" | "unavailable" | "available" | "disjoint";
    reason: string | null;
    frameMs: RenderPerformanceSummary;
    pendingSamples: number;
    droppedSamples: number;
    sampleEvery: number;
  };
  notes: readonly string[];
}

interface TimerExtension { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number; }
interface PendingGpuQuery { query: WebGLQuery; frame: number; }
const GPU_SAMPLE_EVERY = 4;
const MAX_PENDING_QUERIES = 8;
const MAX_METRIC_NAMES = 64;
const IDLE_GAP_MS = 250;
const FRAME_CONTEXT_KEYS = ["cameraCenterX", "cameraCenterY", "zoom", "viewportWidth", "viewportHeight",
  "unitsPerPixel", "schedulePadding", "frameGapMs"] as const;
const NOTES = [
  "CPU times cover JavaScript and command submission, excluding asynchronous GPU execution.",
  "Frame intervals describe rendered frames, not a continuous FPS benchmark; gaps over 250 ms are omitted.",
  "GPU times sample every fourth rendered frame without waiting; unresolved or invalid samples are discarded.",
  "GPU timers measure the command-stream span, including possible gaps during CPU preparation, not pure GPU busy time. CPU and GPU measurements overlap and must not be added.",
  "Section and counter summaries include zero for completed frames in which that metric was absent.",
  "Nested CPU sections overlap; do not add parent, child, and GL-call timings. Slow GL calls include driver waits, not just GPU execution.",
  "Frame context frameGapMs preserves gaps omitted from interval summaries. Events retain up to eight longest instrumented calls per frame.",
  "Frame records are a bounded subset of slow CPU/GPU, high-batch and timeline frames; their selection is not a representative performance distribution."
] as const;

export class RenderPerformanceProfiler {
  private readonly gl: WebGL2RenderingContext | undefined;
  private readonly now: () => number;
  private active = false;
  private disposed = false;
  private maxFrames = 600;
  private maxFrameRecords = 120;
  private startedAt = 0;
  private endedAt = 0;
  private frameStart: number | null = null;
  private previousFrame: number | null = null;
  private frameInterval: number | null = null;
  private frameContext: RenderPerformanceFrameContext | null = null;
  private ignoredFrameGaps = 0;
  private discardedMetricNames = 0;
  private readonly frameIntervals: number[] = [];
  private readonly frameCpu: number[] = [];
  private readonly frameStarts: number[] = [];
  private readonly recordedIntervals: (number | null)[] = [];
  private readonly frameContexts: RenderPerformanceFrameContext[] = [];
  private readonly frameEvents: RenderPerformanceEvent[][] = [];
  private events: RenderPerformanceEvent[] = [];
  private readonly frameGpuTimes: (number | null)[] = [];
  private readonly frameGpuStates: FrameGpuStatus[] = [];
  private readonly cpuSections = new Map<string, number[]>();
  private readonly counters = new Map<string, number[]>();
  private readonly openSections = new Map<string, number>();
  private readonly sectionTotals = new Map<string, number>();
  private readonly counterTotals = new Map<string, number>();
  private extension: TimerExtension | null = null;
  private gpuStatus: RenderPerformanceReport["gpu"]["status"] = "disabled";
  private gpuReason: string | null = null;
  private activeQuery: PendingGpuQuery | null = null;
  private readonly pendingQueries: PendingGpuQuery[] = [];
  private readonly gpuTimes: number[] = [];
  private droppedGpuSamples = 0;

  constructor(options: { gl?: WebGL2RenderingContext; now?: () => number } = {}) {
    this.gl = options.gl;
    this.now = options.now ?? (() => performance.now());
  }

  get enabled(): boolean { return this.active; }

  start(options: RenderPerformanceOptions = {}): void {
    if (this.disposed) throw new Error("Render performance profiler is disposed.");
    const maxFrames = options.maxFrames ?? 600;
    const maxFrameRecords = options.maxFrameRecords ?? 120;
    if (!Number.isInteger(maxFrames) || maxFrames < 1 || maxFrames > 10_000) {
      throw new RangeError("maxFrames must be an integer from 1 to 10000.");
    }
    if (!Number.isInteger(maxFrameRecords) || maxFrameRecords < 0 || maxFrameRecords > 1_000) {
      throw new RangeError("maxFrameRecords must be an integer from 0 to 1000.");
    }
    if (options.gpu !== undefined && typeof options.gpu !== "boolean") throw new TypeError("gpu must be a boolean.");
    this.reset();
    this.maxFrames = maxFrames;
    this.maxFrameRecords = maxFrameRecords;
    this.startedAt = this.now();
    this.endedAt = this.startedAt;
    this.active = true;
    if (options.gpu === false) return;
    if (!this.gl) {
      this.gpuStatus = "unavailable";
      this.gpuReason = "No WebGL2 context was provided.";
      return;
    }
    try {
      this.extension = this.gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExtension | null;
      this.gpuStatus = this.extension ? "available" : "unavailable";
      this.gpuReason = this.extension ? null : "EXT_disjoint_timer_query_webgl2 is unavailable.";
    } catch {
      this.gpuStatus = "unavailable";
      this.gpuReason = "The WebGL timer-query extension could not be initialized.";
    }
  }

  beginFrame(timestamp?: number): void {
    if (!this.active || this.frameStart !== null) return;
    const now = this.now();
    const frameTime = timestamp !== undefined && Number.isFinite(timestamp) ? timestamp : now;
    this.frameInterval = null;
    const gap = this.previousFrame === null ? null : frameTime - this.previousFrame;
    if (this.previousFrame !== null) {
      const interval = frameTime - this.previousFrame;
      if (interval > IDLE_GAP_MS) this.ignoredFrameGaps++;
      else if (interval > 0) { this.frameIntervals.push(interval); this.frameInterval = interval; }
    }
    this.previousFrame = frameTime;
    this.frameStart = now;
    this.frameContext = this.maxFrameRecords ? { frameGapMs: gap !== null && gap > 0 ? gap : null } : null;
    this.events = [];
    this.pollGpu();
    if (this.gpuStatus !== "available" || this.frameCpu.length % GPU_SAMPLE_EVERY !== 0) return;
    if (this.maxFrameRecords) this.frameGpuStates[this.frameCpu.length] = "discarded";
    if (this.pendingQueries.length >= MAX_PENDING_QUERIES) { this.droppedGpuSamples++; return; }
    const gl = this.gl!, extension = this.extension!;
    try {
      // Host applications can have their own query in flight on this context.
      if (gl.getQuery(extension.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) { this.droppedGpuSamples++; return; }
      const query = gl.createQuery();
      if (!query) { this.droppedGpuSamples++; return; }
      this.activeQuery = { query, frame: this.frameCpu.length };
      gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
      if (this.maxFrameRecords) this.frameGpuStates[this.frameCpu.length] = "pending";
    } catch { this.disableGpu("A WebGL timer query could not be started."); }
  }

  endFrame(): void {
    if (!this.active || this.frameStart === null) return;
    const now = this.now();
    for (const [name, start] of this.openSections) {
      this.sectionTotals.set(name, (this.sectionTotals.get(name) ?? 0) + Math.max(0, now - start));
    }
    this.openSections.clear();
    this.recordMetrics(this.cpuSections, this.sectionTotals);
    this.recordMetrics(this.counters, this.counterTotals);
    if (this.maxFrameRecords) {
      this.frameStarts.push(Math.max(0, this.frameStart - this.startedAt));
      this.recordedIntervals.push(this.frameInterval);
      this.frameContexts.push(this.frameContext ?? {});
      this.frameEvents.push(this.events);
    }
    this.frameCpu.push(Math.max(0, now - this.frameStart));
    this.frameStart = null;
    this.endedAt = now;
    this.finishGpuQuery();
    if (this.frameCpu.length >= this.maxFrames) this.finish();
  }

  beginSection(name: string): void {
    if (!this.active || this.frameStart === null || this.openSections.has(name)) return;
    if (!this.ensureMetric(this.cpuSections, name)) return;
    this.openSections.set(name, this.now());
  }

  endSection(name: string): void {
    if (!this.active || this.frameStart === null) return;
    const start = this.openSections.get(name);
    if (start === undefined) return;
    this.openSections.delete(name);
    this.sectionTotals.set(name, (this.sectionTotals.get(name) ?? 0) + Math.max(0, this.now() - start));
  }

  /** Record a duration measured by an integration, including nested calls. */
  addSectionTime(name: string, durationMs: number): void {
    if (!this.active || this.frameStart === null || !Number.isFinite(durationMs) || durationMs < 0) return;
    if (!this.ensureMetric(this.cpuSections, name)) return;
    this.sectionTotals.set(name, (this.sectionTotals.get(name) ?? 0) + durationMs);
  }

  recordEvent(name: string, durationMs: number): void {
    if (!this.active || this.frameStart === null || !this.maxFrameRecords ||
        !Number.isFinite(durationMs) || durationMs < 0) return;
    if (this.events.length === 8 && durationMs <= this.events[7].durationMs) return;
    this.events.push({ name: name.slice(0, 96), durationMs });
    this.events.sort((a, b) => b.durationMs - a.durationMs);
    if (this.events.length > 8) this.events.length = 8;
  }

  add(name: string, value = 1): void {
    if (!this.active || this.frameStart === null || !Number.isFinite(value)) return;
    if (!this.ensureMetric(this.counters, name)) return;
    this.counterTotals.set(name, (this.counterTotals.get(name) ?? 0) + value);
  }

  /** Snapshot numeric camera/scale values for this frame. This does no work
   * when profiling or correlated records are disabled. Caller data is detached. */
  setFrameContext(context: RenderPerformanceFrameContext): void {
    if (!this.active || this.frameStart === null || !this.maxFrameRecords) return;
    this.frameContext ??= {};
    for (const key of FRAME_CONTEXT_KEYS) {
      const value = context[key];
      if (value === null || (typeof value === "number" && Number.isFinite(value))) this.frameContext[key] = value;
    }
  }

  stop(): RenderPerformanceReport {
    this.finish();
    return this.getReport();
  }

  reset(): void {
    this.finish();
    this.startedAt = this.endedAt = 0;
    this.previousFrame = null;
    this.frameInterval = null;
    this.frameContext = null;
    this.ignoredFrameGaps = this.discardedMetricNames = this.droppedGpuSamples = 0;
    this.frameIntervals.length = this.frameCpu.length = this.gpuTimes.length = 0;
    this.frameStarts.length = this.recordedIntervals.length = this.frameContexts.length = this.frameEvents.length = 0;
    this.events = [];
    this.frameGpuTimes.length = this.frameGpuStates.length = 0;
    this.cpuSections.clear(); this.counters.clear();
    this.extension = null;
    this.gpuStatus = "disabled";
    this.gpuReason = null;
  }

  getReport(): RenderPerformanceReport {
    return {
      active: this.active, frames: this.frameCpu.length, maxFrames: this.maxFrames,
      elapsedMs: Math.max(0, (this.active ? this.now() : this.endedAt) - this.startedAt),
      frameIntervalMs: summarize(this.frameIntervals), frameCpuMs: summarize(this.frameCpu),
      cpuSections: Object.fromEntries([...this.cpuSections].map(([name, samples]) => [name, summarize(samples)])),
      counters: Object.fromEntries([...this.counters].map(([name, samples]) => [name, summarize(samples)])),
      frameRecords: this.getFrameRecords(), frameRecordLimit: this.maxFrameRecords,
      ignoredFrameGaps: this.ignoredFrameGaps, discardedMetricNames: this.discardedMetricNames,
      gpu: { status: this.gpuStatus, reason: this.gpuReason, frameMs: summarize(this.gpuTimes),
        pendingSamples: this.pendingQueries.length + (this.activeQuery ? 1 : 0),
        droppedSamples: this.droppedGpuSamples, sampleEvery: GPU_SAMPLE_EVERY },
      notes: [...NOTES]
    };
  }

  dispose(): void { this.finish(); this.disposed = true; }

  private ensureMetric(metrics: Map<string, number[]>, name: string): boolean {
    if (metrics.has(name)) return true;
    if (metrics.size >= MAX_METRIC_NAMES) { this.discardedMetricNames++; return false; }
    metrics.set(name, new Array<number>(this.frameCpu.length).fill(0));
    return true;
  }

  private recordMetrics(metrics: Map<string, number[]>, totals: Map<string, number>): void {
    for (const [name, samples] of metrics) samples.push(totals.get(name) ?? 0);
    totals.clear();
  }

  private getFrameRecords(): RenderPerformanceFrameRecord[] {
    const count = this.frameCpu.length, limit = Math.min(this.maxFrameRecords, count);
    if (!limit) return [];
    const selected = new Map<number, Set<FrameRecordReason>>();
    const add = (frame: number, reason: FrameRecordReason): void => {
      let reasons = selected.get(frame);
      if (!reasons) {
        if (selected.size >= limit) return;
        reasons = new Set(); selected.set(frame, reasons);
      }
      reasons.add(reason);
    };
    const quota = Math.max(1, Math.floor(limit / 4));
    const highest = (values: readonly (number | null)[], reason: FrameRecordReason): void => {
      const frames: number[] = [];
      for (let frame = 0; frame < count; frame++) if ((values[frame] ?? 0) > 0) frames.push(frame);
      frames.sort((a, b) => values[b]! - values[a]! || a - b);
      for (let index = 0; index < Math.min(quota, frames.length); index++) add(frames[index], reason);
    };
    highest(this.frameCpu, "slow-cpu");
    highest(this.frameGpuTimes, "slow-gpu");
    // Integrations can report the total explicitly; older integrations already
    // expose per-kind batch counters, which are sufficient for correlation.
    let batches = this.counters.get("drawBatches") ?? this.counters.get("drawCalls");
    if (!batches) {
      batches = new Array<number>(count).fill(0);
      for (const [name, values] of this.counters) if (name.endsWith("Batches")) {
        for (let frame = 0; frame < count; frame++) batches[frame] += values[frame] ?? 0;
      }
    }
    highest(batches, "high-batches");
    // Keep transition evidence around major stalls, after preserving the
    // highest CPU/GPU/batch samples and before filling baseline timeline slots.
    const stalls = [...selected.keys()].filter(frame => this.frameCpu[frame] >= 100)
      .sort((a, b) => this.frameCpu[b] - this.frameCpu[a]);
    for (const frame of stalls) {
      if (frame > 0) add(frame - 1, "stall-neighbour");
      if (frame + 1 < count) add(frame + 1, "stall-neighbour");
    }
    // Repeatedly bisect the timeline so remaining baseline slots span the whole
    // capture, even when the slow categories overlap heavily or select its ends.
    add(0, "timeline"); add(count - 1, "timeline");
    for (let divisions = 2; selected.size < limit && divisions < count * 2; divisions *= 2) {
      for (let index = 1; index < divisions && selected.size < limit; index += 2) {
        add(Math.round(index * (count - 1) / divisions), "timeline");
      }
    }
    for (let frame = 0; selected.size < limit && frame < count; frame++) add(frame, "timeline");
    return [...selected].sort(([a], [b]) => a - b).map(([frame, reasons]) => ({
      frame: frame + 1, startMs: this.frameStarts[frame], intervalMs: this.recordedIntervals[frame],
      cpuMs: this.frameCpu[frame], gpuMs: this.frameGpuTimes[frame] ?? null,
      gpuStatus: this.frameGpuStates[frame] ?? "not-sampled", context: { ...this.frameContexts[frame] },
      cpuSectionsMs: Object.fromEntries([...this.cpuSections].map(([name, values]) => [name, values[frame] ?? 0])),
      counters: Object.fromEntries([...this.counters].map(([name, values]) => [name, values[frame] ?? 0])),
      reasons: [...reasons], events: this.frameEvents[frame].map(event => ({ ...event }))
    }));
  }

  private finish(): void {
    if (!this.active) return;
    this.endedAt = this.now();
    this.finishGpuQuery();
    this.pollGpu();
    this.releaseQueries();
    this.active = false;
    this.frameStart = null;
    this.openSections.clear(); this.sectionTotals.clear(); this.counterTotals.clear();
  }

  private finishGpuQuery(): void {
    if (!this.activeQuery) return;
    const pending = this.activeQuery;
    this.activeQuery = null;
    try {
      this.gl!.endQuery(this.extension!.TIME_ELAPSED_EXT);
      this.pendingQueries.push(pending);
    } catch {
      try { this.gl!.deleteQuery(pending.query); } catch { /* A lost context may reject cleanup. */ }
      this.discardFrameGpu(pending.frame);
      this.droppedGpuSamples++;
      this.disableGpu("A WebGL timer query could not be completed.");
    }
  }

  private pollGpu(): void {
    if (this.gpuStatus !== "available") return;
    const gl = this.gl!;
    try {
      if (gl.getParameter(this.extension!.GPU_DISJOINT_EXT)) {
        this.gpuStatus = "disjoint";
        this.gpuReason = "GPU clock disjoint detected; GPU timings were discarded for this capture.";
        this.droppedGpuSamples += this.gpuTimes.length;
        this.gpuTimes.length = 0;
        for (let frame = 0; frame < this.frameGpuStates.length; frame++) {
          if (this.frameGpuStates[frame] === "available") this.discardFrameGpu(frame);
        }
        this.releaseQueries();
        return;
      }
      while (this.pendingQueries.length) {
        const pending = this.pendingQueries[0], query = pending.query;
        if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
        const nanoseconds = Number(gl.getQueryParameter(query, gl.QUERY_RESULT));
        this.pendingQueries.shift(); gl.deleteQuery(query);
        if (Number.isFinite(nanoseconds) && nanoseconds >= 0) {
          const milliseconds = nanoseconds / 1_000_000;
          this.gpuTimes.push(milliseconds);
          if (this.maxFrameRecords) {
            this.frameGpuTimes[pending.frame] = milliseconds;
            this.frameGpuStates[pending.frame] = "available";
          }
        } else { this.droppedGpuSamples++; this.discardFrameGpu(pending.frame); }
      }
    } catch { this.disableGpu("WebGL timer-query results could not be read."); }
  }

  private disableGpu(reason: string): void {
    this.gpuStatus = "unavailable";
    this.gpuReason = reason;
    this.releaseQueries();
  }

  private releaseQueries(): void {
    if (this.activeQuery) {
      try { this.gl!.endQuery(this.extension!.TIME_ELAPSED_EXT); } catch { /* A lost context may reject cleanup. */ }
      this.pendingQueries.push(this.activeQuery);
      this.activeQuery = null;
    }
    for (const pending of this.pendingQueries) {
      try { this.gl!.deleteQuery(pending.query); } catch { /* Cleanup must not interrupt rendering. */ }
      this.discardFrameGpu(pending.frame);
      this.droppedGpuSamples++;
    }
    this.pendingQueries.length = 0;
  }

  private discardFrameGpu(frame: number): void {
    if (!this.maxFrameRecords) return;
    this.frameGpuTimes[frame] = null;
    this.frameGpuStates[frame] = "discarded";
  }
}

function summarize(samples: readonly number[]): RenderPerformanceSummary {
  if (!samples.length) return { samples: 0, total: 0, average: null, p50: null, p95: null, min: null, max: null };
  const sorted = [...samples].sort((a, b) => a - b);
  const total = samples.reduce((sum, value) => sum + value, 0);
  const percentile = (fraction: number): number => {
    const position = (sorted.length - 1) * fraction, lower = Math.floor(position);
    return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
  };
  return { samples: samples.length, total, average: total / samples.length,
    p50: percentile(0.5), p95: percentile(0.95), min: sorted[0], max: sorted[sorted.length - 1] };
}
