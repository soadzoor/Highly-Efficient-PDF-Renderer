/**
 * Current phase of source loading, parsing, LOD preparation, or upload.
 */
export type PDFLoadStage =
  | "source"
  | "pdf-page"
  | "pdf-operators"
  | "pdf-text"
  | "pdf-raster"
  | "compile"
  | "zip-open"
  | "zip-manifest"
  | "zip-file"
  | "raster-encode"
  | "zip-build"
  | "vector-lod"
  | "upload"
  | "first-render"
  | "complete";

/** Where PDF operator parsing is running. */
export type PDFLoadExecutionPath = "worker" | "main-thread" | "main-thread-fallback";

/**
 * Progress event emitted by HEPR loaders.
 *
 * `value` is always normalized from 0..1 for the overall operation. Additional
 * fields describe the active unit when HEPR knows it, such as bytes, pages, or
 * operators. When a PDF page subset is selected, `pageIndex` and `pageCount`
 * describe the composed subset; `sourcePageIndex` and `sourcePageCount`
 * identify the original PDF page. `processed` and `total` remain specific to
 * the active `unit`.
 */
export interface PDFLoadProgress {
  /** Overall normalized progress in the range 0..1. */
  value: number;

  /** Current load/parse/upload phase. */
  stage: PDFLoadStage;

  /** Execution path used for PDF parsing, when known. */
  executionPath?: PDFLoadExecutionPath;

  /** Source family currently being processed. */
  sourceType?: "pdf" | "zip";

  /** Unit represented by `processed` and `total`, when available. */
  unit?: "bytes" | "operators" | "files" | "pages" | "texels";

  /** Completed units for the current stage. */
  processed?: number;

  /** Total units for the current stage, when known. */
  total?: number;

  /** Zero-based page index within the selected/composed page set. */
  pageIndex?: number;

  /** Number of selected/composed pages, when known. */
  pageCount?: number;

  /** Zero-based page index within the source PDF, when known. */
  sourcePageIndex?: number;

  /** Total page count in the source PDF, when known. */
  sourcePageCount?: number;
}

/**
 * Receives progress events from `pdfObjectGenerator`.
 *
 * Example:
 *
 * ```ts
 * const onProgress: LoadProgressCallback = (progress) => {
 *   console.log(progress.stage, `${Math.round(progress.value * 100)}%`);
 * };
 * ```
 */
export type LoadProgressCallback = (progress: PDFLoadProgress) => void;

type ProgressMetadata = Omit<PDFLoadProgress, "value">;

interface ProgressRootState {
  callback?: LoadProgressCallback;
  throttleMs: number;
  minDelta: number;
  lastEmittedValue: number;
  lastEmittedAt: number;
  lastStage?: PDFLoadStage;
}

export class LoadProgressReporter {
  readonly enabled: boolean;

  private readonly root: ProgressRootState;

  private readonly start: number;

  private readonly end: number;

  private readonly fixedMeta: Partial<ProgressMetadata>;

  constructor(
    callback?: LoadProgressCallback,
    options: {
      start?: number;
      end?: number;
      throttleMs?: number;
      minDelta?: number;
      fixedMeta?: Partial<ProgressMetadata>;
      root?: ProgressRootState;
    } = {}
  ) {
    this.root = options.root ?? {
      callback,
      throttleMs: options.throttleMs ?? 80,
      minDelta: options.minDelta ?? 0.002,
      lastEmittedValue: -1,
      lastEmittedAt: 0
    };
    this.start = clamp01(options.start ?? 0);
    this.end = clamp01(options.end ?? 1);
    this.fixedMeta = options.fixedMeta ?? {};
    this.enabled = typeof this.root.callback === "function";
  }

  child(start: number, end: number, fixedMeta: Partial<ProgressMetadata> = {}): LoadProgressReporter {
    const rangeStart = lerp(this.start, this.end, clamp01(start));
    const rangeEnd = lerp(this.start, this.end, clamp01(end));
    return new LoadProgressReporter(undefined, {
      start: rangeStart,
      end: rangeEnd,
      root: this.root,
      fixedMeta: { ...this.fixedMeta, ...fixedMeta }
    });
  }

  toCallback(): LoadProgressCallback {
    return (progress: PDFLoadProgress): void => {
      this.report(progress.value, progress);
    };
  }

  report(value: number, meta: Partial<ProgressMetadata> = {}): void {
    if (!this.enabled) {
      return;
    }

    const mergedMeta = { ...this.fixedMeta, ...meta };
    const normalized = clamp01(value);
    const absoluteValue = lerp(this.start, this.end, normalized);
    const monotonicValue = Math.max(this.root.lastEmittedValue, absoluteValue);
    const stage = mergedMeta.stage ?? this.fixedMeta.stage ?? this.root.lastStage ?? "source";
    const now = nowMs();
    const delta = monotonicValue - this.root.lastEmittedValue;
    const stageChanged = stage !== this.root.lastStage;
    const shouldEmit =
      this.root.lastEmittedValue < 0 ||
      monotonicValue >= 1 ||
      stageChanged ||
      delta >= this.root.minDelta ||
      now - this.root.lastEmittedAt >= this.root.throttleMs;

    if (!shouldEmit) {
      return;
    }

    const payload: PDFLoadProgress = {
      value: clamp01(monotonicValue),
      stage,
      executionPath: mergedMeta.executionPath,
      sourceType: mergedMeta.sourceType,
      unit: mergedMeta.unit,
      processed: mergedMeta.processed,
      total: mergedMeta.total,
      pageIndex: mergedMeta.pageIndex,
      pageCount: mergedMeta.pageCount,
      sourcePageIndex: mergedMeta.sourcePageIndex,
      sourcePageCount: mergedMeta.sourcePageCount
    };

    this.root.lastEmittedValue = payload.value;
    this.root.lastEmittedAt = now;
    this.root.lastStage = payload.stage;
    this.root.callback?.(payload);
  }

  complete(meta: Partial<ProgressMetadata> = {}): void {
    this.report(1, { stage: "complete", ...meta });
  }

  async withIndeterminateProgress<T>(
    work: Promise<T> | (() => Promise<T>),
    options: {
      stage: PDFLoadStage;
      sourceType?: "pdf" | "zip";
      unit?: "bytes" | "operators" | "files" | "pages" | "texels";
      processed?: number;
      total?: number;
      pageIndex?: number;
      pageCount?: number;
      sourcePageIndex?: number;
      sourcePageCount?: number;
      tickMs?: number;
      ceiling?: number;
    }
  ): Promise<T> {
    if (!this.enabled) {
      return typeof work === "function" ? work() : work;
    }

    const tickMs = Math.max(50, Math.trunc(options.tickMs ?? 90));
    const ceiling = clamp(options.ceiling ?? 0.9, 0.1, 0.999);
    const startedAt = nowMs();
    const meta: Partial<ProgressMetadata> = {
      stage: options.stage,
      sourceType: options.sourceType,
      unit: options.unit,
      processed: options.processed,
      total: options.total,
      pageIndex: options.pageIndex,
      pageCount: options.pageCount,
      sourcePageIndex: options.sourcePageIndex,
      sourcePageCount: options.sourcePageCount
    };

    this.report(0, meta);
    const intervalId = globalThis.setInterval(() => {
      const elapsedMs = Math.max(0, nowMs() - startedAt);
      const ratio = elapsedMs / 800;
      this.report(Math.min(ceiling, ceiling * (1 - 1 / (1 + ratio))), meta);
    }, tickMs);

    try {
      const result = await (typeof work === "function" ? work() : work);
      this.report(1, meta);
      return result;
    } finally {
      globalThis.clearInterval(intervalId);
    }
  }
}

export function createLoadProgressReporter(
  callback?: LoadProgressCallback,
  options: { throttleMs?: number; minDelta?: number } = {}
): LoadProgressReporter {
  return new LoadProgressReporter(callback, options);
}

export function formatLoadProgressStage(stage: PDFLoadStage | undefined): string {
  switch (stage) {
    case "source":
      return "Reading source";
    case "pdf-page":
      return "Processing pages";
    case "pdf-operators":
      return "Scanning operators";
    case "pdf-text":
      return "Extracting text";
    case "pdf-raster":
      return "Extracting rasters";
    case "compile":
      return "Compiling";
    case "zip-open":
      return "Opening ZIP";
    case "zip-manifest":
      return "Reading manifest";
    case "zip-file":
      return "Decoding ZIP";
    case "raster-encode":
      return "Compressing raster images";
    case "zip-build":
      return "Building ZIP";
    case "vector-lod":
      return "Building Vector LOD";
    case "upload":
      return "Uploading";
    case "first-render":
      return "Rendering first frame";
    case "complete":
      return "Complete";
    default:
      return "Parsing / loading";
  }
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}
