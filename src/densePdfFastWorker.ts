import {
  compileDensePdfContent,
  DensePdfSyntaxError,
  DensePdfUnsupportedError,
  type DensePdfBounds,
  type DensePdfContentSource,
  type DensePdfMatrix
} from "./densePdfContentCompiler";
import {
  DensePdfBuildError,
  buildDenseTextMiniPdf,
  preflightDensePdfDocument,
  type DensePdfPageBox
} from "./densePdfDocument";
import type {
  DensePdfFastCompiledPage,
  DensePdfFastWorkerProgress,
  DensePdfFastWorkerRequest,
  DensePdfFastWorkerResponse,
  DensePdfFastWorkerResult,
  DensePdfFastWorkerSerializedError,
  DensePdfFastWorkerStage
} from "./densePdfFastWorkerClient";

interface DensePdfWorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<DensePdfFastWorkerRequest>) => void
  ): void;
  postMessage(message: DensePdfFastWorkerResponse, transfer?: Transferable[]): void;
}

export interface DensePdfPageGeometryInput {
  cropBox: DensePdfPageBox | readonly number[];
  mediaBox?: DensePdfPageBox | readonly number[];
  rotation: number;
  userUnit: number;
}

interface ProgressUpdate {
  value: number;
  stage: DensePdfFastWorkerStage;
  unit?: DensePdfFastWorkerProgress["unit"];
  processed?: number;
  total?: number;
  pageIndex?: number;
  pageCount?: number;
  sourcePageIndex?: number;
  sourcePageCount?: number;
}

const PROGRESS_HEARTBEAT_MS = 150;
const COMPILE_YIELD_INTERVAL_MS = 50;
const PREFLIGHT_PROGRESS_END = 0.08;
const PAGE_PROGRESS_END = 0.92;

const workerScope = typeof self === "object" && typeof document === "undefined"
  ? self as unknown as DensePdfWorkerScope
  : null;

let requestStarted = false;

workerScope?.addEventListener("message", (event) => {
  if (requestStarted || event.data?.type !== "compile") {
    return;
  }
  requestStarted = true;
  void handleCompileRequest(event.data);
});

/** Reproduce HEPR's PDF.js viewport-to-Y-up page transform without PDF.js. */
export function computeDensePdfPageGeometry(input: DensePdfPageGeometryInput): {
  pageMatrix: DensePdfMatrix;
  pageBounds: DensePdfBounds;
} {
  const cropBox = normalizeBox(input.cropBox, "cropBox");
  const viewBox = input.mediaBox
    ? computePdfJsViewBox(normalizeBox(input.mediaBox, "mediaBox"), cropBox)
    : cropBox;
  const userUnit = Number.isFinite(input.userUnit) && input.userUnit > 0
    ? input.userUnit
    : 1;
  const rotation = normalizeRotation(input.rotation);
  const centerX = (viewBox[0] + viewBox[2]) / 2;
  const centerY = (viewBox[1] + viewBox[3]) / 2;

  let rotateA: number;
  let rotateB: number;
  let rotateC: number;
  let rotateD: number;
  switch (rotation) {
    case 0:
      rotateA = 1;
      rotateB = 0;
      rotateC = 0;
      rotateD = -1;
      break;
    case 90:
      rotateA = 0;
      rotateB = 1;
      rotateC = 1;
      rotateD = 0;
      break;
    case 180:
      rotateA = -1;
      rotateB = 0;
      rotateC = 0;
      rotateD = 1;
      break;
    case 270:
      rotateA = 0;
      rotateB = -1;
      rotateC = -1;
      rotateD = 0;
      break;
  }

  const unrotatedWidth = viewBox[2] - viewBox[0];
  const unrotatedHeight = viewBox[3] - viewBox[1];
  const viewportHeight = (rotateA === 0 ? unrotatedWidth : unrotatedHeight) * userUnit;
  const offsetCanvasX = Math.abs(
    (rotateA === 0 ? centerY - viewBox[1] : centerX - viewBox[0]) * userUnit
  );
  const offsetCanvasY = Math.abs(
    (rotateA === 0 ? centerX - viewBox[0] : centerY - viewBox[1]) * userUnit
  );
  const viewportA = rotateA * userUnit;
  const viewportB = rotateB * userUnit;
  const viewportC = rotateC * userUnit;
  const viewportD = rotateD * userUnit;
  const viewportE = offsetCanvasX - viewportA * centerX - viewportC * centerY;
  const viewportF = offsetCanvasY - viewportB * centerX - viewportD * centerY;

  // PDF.js's display viewport is Y-down. HEPR applies this second transform to
  // return to Y-up scene coordinates.
  const pageMatrix: DensePdfMatrix = [
    viewportA,
    -viewportB,
    viewportC,
    -viewportD,
    viewportE,
    viewportHeight - viewportF
  ];
  return {
    pageMatrix,
    pageBounds: transformBox(viewBox, pageMatrix)
  };
}

async function handleCompileRequest(request: DensePdfFastWorkerRequest): Promise<void> {
  if (!workerScope) {
    return;
  }
  const progress = new WorkerProgressEmitter(workerScope);
  const totalStartedAt = nowMs();
  progress.start({
    value: 0,
    stage: "pdf-fast-check",
    unit: "bytes",
    processed: 0,
    total: request.pdfBytes?.length
  });

  try {
    if (!(request.pdfBytes instanceof Uint8Array) || request.pdfBytes.length === 0) {
      throw new TypeError("The dense PDF worker requires non-empty Uint8Array input.");
    }

    const preflightStartedAt = nowMs();
    const preflight = await preflightDensePdfDocument(request.pdfBytes, {
      pages: request.options.pages
    });
    const preflightMs = nowMs() - preflightStartedAt;
    progress.update({
      value: PREFLIGHT_PROGRESS_END,
      stage: "pdf-fast-check",
      unit: "bytes",
      processed: request.pdfBytes.length,
      total: request.pdfBytes.length
    }, true);

    if (!preflight.eligible) {
      postResult(progress, {
        kind: "fallback",
        reason: preflight.reason,
        message: preflight.message,
        ...(preflight.sourcePageIndex !== undefined
          ? { sourcePageIndex: preflight.sourcePageIndex }
          : {}),
        ...(preflight.resourceName !== undefined ? { resourceName: preflight.resourceName } : {}),
        ...(preflight.filterName !== undefined ? { filterName: preflight.filterName } : {})
      });
      return;
    }

    const document = preflight.document;
    const pages = document.pages;
    const sourcePageCount = readSourcePageCount(document, pages);
    const compiledPages: DensePdfFastCompiledPage[] = [];
    let decodeMs = 0;
    let compileMs = 0;

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
      const page = pages[pageIndex];
      const { pageMatrix, pageBounds } = computeDensePdfPageGeometry(page);
      const pageProgressStart = interpolatePageProgress(pageIndex, pages.length, 0);
      let decodedContentBytes = 0;
      let pageDecodeMs = 0;
      let operatorStageStarted = false;
      const pageStartedAt = nowMs();

      progress.update({
        value: pageProgressStart,
        stage: "pdf-fast-decode",
        unit: "bytes",
        processed: 0,
        pageIndex,
        pageCount: pages.length,
        sourcePageIndex: page.sourcePageIndex,
        sourcePageCount
      }, true);

      const decodedChunks = observeDecodedChunks(
        page.decodedContentChunks(),
        (processedBytes) => {
          decodedContentBytes = processedBytes;
          if (!operatorStageStarted) {
            progress.update({
              value: interpolatePageProgress(pageIndex, pages.length, 0.08),
              stage: "pdf-fast-decode",
              unit: "bytes",
              processed: processedBytes,
              pageIndex,
              pageCount: pages.length,
              sourcePageIndex: page.sourcePageIndex,
              sourcePageCount
            });
          }
        },
        (elapsedMs) => {
          pageDecodeMs = elapsedMs;
        },
        () => {
          if (operatorStageStarted) {
            return;
          }
          operatorStageStarted = true;
          progress.update({
            value: interpolatePageProgress(pageIndex, pages.length, 0.1),
            stage: "pdf-operators",
            unit: "operators",
            processed: 0,
            pageIndex,
            pageCount: pages.length,
            sourcePageIndex: page.sourcePageIndex,
            sourcePageCount
          }, true);
        }
      );

      const compiled = await compileDensePdfContent(decodedChunks, {
        pageMatrix,
        pageBounds,
        availableExtGStates: page.availableExtGStates,
        enableSegmentMerge: request.options.enableSegmentMerge,
        enableInvisibleCull: request.options.enableInvisibleCull,
        yieldIntervalMs: COMPILE_YIELD_INTERVAL_MS,
        onProgress: (compilerProgress) => {
          operatorStageStarted = true;
          decodedContentBytes = Math.max(decodedContentBytes, compilerProgress.processedBytes);
          const elapsedMs = nowMs() - pageStartedAt;
          const indeterminate = Math.min(0.9, 0.1 + 0.8 * elapsedMs / (elapsedMs + 4_000));
          const stage = compilerProgress.phase === "finalizing"
            ? "compile"
            : "pdf-operators";
          progress.update({
            value: interpolatePageProgress(pageIndex, pages.length, indeterminate),
            stage,
            unit: "operators",
            processed: compilerProgress.operatorCount,
            pageIndex,
            pageCount: pages.length,
            sourcePageIndex: page.sourcePageIndex,
            sourcePageCount
          });
        }
      });

      const pageElapsedMs = nowMs() - pageStartedAt;
      const pageCompileMs = Math.max(0, pageElapsedMs - pageDecodeMs);
      decodeMs += pageDecodeMs;
      compileMs += pageCompileMs;
      compiledPages.push({
        sourcePageIndex: page.sourcePageIndex,
        mediaBox: copyBox(page.mediaBox, "mediaBox"),
        cropBox: copyBox(page.cropBox, "cropBox"),
        rotation: normalizeRotation(page.rotation),
        userUnit: Number.isFinite(page.userUnit) && page.userUnit > 0 ? page.userUnit : 1,
        pageMatrix,
        pageBounds,
        encodedContentBytes: Math.max(0, Math.trunc(page.encodedContentBytes)),
        decodedContentBytes,
        decodeMs: pageDecodeMs,
        compileMs: pageCompileMs,
        compiled
      });
      progress.update({
        value: interpolatePageProgress(pageIndex, pages.length, 1),
        stage: "compile",
        unit: "pages",
        processed: pageIndex + 1,
        total: pages.length,
        pageIndex,
        pageCount: pages.length,
        sourcePageIndex: page.sourcePageIndex,
        sourcePageCount
      }, true);
    }

    // Nothing page-shaped leaves the worker until this succeeds, so a later
    // unsupported page or text-resource failure falls back atomically.
    progress.update({
      value: PAGE_PROGRESS_END,
      stage: "compile",
      unit: "pages",
      processed: pages.length,
      total: pages.length,
      pageCount: pages.length,
      sourcePageCount
    }, true);
    const textMiniPdfStartedAt = nowMs();
    const textMiniPdf = await buildDenseTextMiniPdf(
      document,
      compiledPages.map(({ sourcePageIndex, compiled }) => ({
        sourcePageIndex,
        retainedTextContent: compiled.retainedTextContent,
        referencedFonts: new Set(compiled.referencedFonts),
        referencedProperties: new Set(compiled.referencedProperties)
      }))
    );
    const textMiniPdfMs = nowMs() - textMiniPdfStartedAt;

    // These fields are worker-only inputs to the mini-PDF builder. The main
    // thread needs only the text-show count plus the packed scene buffers.
    // Dropping them avoids cloning/transferring a second text program.
    for (const page of compiledPages) {
      page.compiled.retainedTextContent = new Uint8Array(0);
      page.compiled.referencedFonts = [];
      page.compiled.referencedProperties = [];
    }

    progress.update({
      value: 1,
      stage: "compile",
      unit: "pages",
      processed: pages.length,
      total: pages.length,
      pageCount: pages.length,
      sourcePageCount
    }, true);
    postResult(progress, {
      kind: "success",
      sourcePageCount,
      pages: compiledPages,
      textMiniPdfBytes: textMiniPdf.bytes,
      timing: {
        preflightMs,
        decodeMs,
        compileMs,
        textMiniPdfMs,
        totalMs: nowMs() - totalStartedAt
      }
    });
  } catch (error) {
    if (error instanceof DensePdfUnsupportedError) {
      postResult(progress, {
        kind: "fallback",
        reason: "unsupported-content",
        message: error.message,
        ...(error.operator ? { operator: error.operator } : {})
      });
      return;
    }
    if (error instanceof DensePdfSyntaxError) {
      postResult(progress, {
        kind: "fallback",
        reason: "invalid-content",
        message: error.message
      });
      return;
    }
    if (error instanceof DensePdfBuildError && error.code === "missing-resource") {
      postResult(progress, {
        kind: "fallback",
        reason: "unsupported-resource",
        message: error.message
      });
      return;
    }
    postResult(progress, { kind: "error", error: serializeError(error) });
  }
}

class WorkerProgressEmitter {
  private readonly scope: DensePdfWorkerScope;

  private latest: DensePdfFastWorkerProgress | null = null;

  private lastSentAt = 0;

  private heartbeatId: ReturnType<typeof setInterval> | null = null;

  constructor(scope: DensePdfWorkerScope) {
    this.scope = scope;
  }

  start(update: ProgressUpdate): void {
    this.update(update, true);
    this.heartbeatId = globalThis.setInterval(() => {
      if (this.latest) {
        this.latest = {
          ...this.latest,
          value: advanceHeartbeatValue(this.latest)
        };
        this.send(this.latest);
      }
    }, PROGRESS_HEARTBEAT_MS);
  }

  update(update: ProgressUpdate, force = false): void {
    const previousValue = this.latest?.value ?? 0;
    const next: DensePdfFastWorkerProgress = {
      value: clamp01(Math.max(previousValue, update.value)),
      stage: update.stage,
      executionPath: "dense-vector-worker",
      sourceType: "pdf",
      unit: update.unit,
      processed: update.processed,
      total: update.total,
      pageIndex: update.pageIndex,
      pageCount: update.pageCount,
      sourcePageIndex: update.sourcePageIndex,
      sourcePageCount: update.sourcePageCount
    };
    const stageChanged = next.stage !== this.latest?.stage;
    this.latest = next;
    if (force || stageChanged || nowMs() - this.lastSentAt >= PROGRESS_HEARTBEAT_MS) {
      this.send(next);
    }
  }

  stop(): void {
    if (this.heartbeatId !== null) {
      globalThis.clearInterval(this.heartbeatId);
      this.heartbeatId = null;
    }
  }

  private send(progress: DensePdfFastWorkerProgress): void {
    this.scope.postMessage({ type: "progress", progress });
    this.lastSentAt = nowMs();
  }
}

function postResult(progress: WorkerProgressEmitter, result: DensePdfFastWorkerResult): void {
  if (!workerScope) {
    return;
  }
  progress.stop();
  const response: DensePdfFastWorkerResponse = { type: "result", result };
  workerScope.postMessage(response, collectTransferables(result));
}

async function* observeDecodedChunks(
  source: DensePdfContentSource,
  onProgress: (processedBytes: number) => void,
  onDecodeTiming: (elapsedMs: number) => void,
  onChunkReady: () => void
): AsyncGenerator<Uint8Array> {
  let processedBytes = 0;
  let decodeMs = 0;
  if (source instanceof Uint8Array) {
    processedBytes = source.length;
    onProgress(processedBytes);
    onDecodeTiming(decodeMs);
    onChunkReady();
    yield source;
    return;
  }

  const iterator = Symbol.asyncIterator in source
    ? source[Symbol.asyncIterator]()
    : source[Symbol.iterator]();
  let completed = false;
  try {
    while (true) {
      const decodeStartedAt = nowMs();
      const next = await iterator.next();
      decodeMs += nowMs() - decodeStartedAt;
      onDecodeTiming(decodeMs);
      if (next.done) {
        completed = true;
        return;
      }
      processedBytes += next.value.length;
      onProgress(processedBytes);
      onChunkReady();
      yield next.value;
    }
  } finally {
    if (!completed && typeof iterator.return === "function") {
      await iterator.return();
    }
  }
}

function interpolatePageProgress(pageIndex: number, pageCount: number, pageValue: number): number {
  if (pageCount <= 0) {
    return PAGE_PROGRESS_END;
  }
  const pageRange = PAGE_PROGRESS_END - PREFLIGHT_PROGRESS_END;
  return PREFLIGHT_PROGRESS_END +
    ((pageIndex + clamp01(pageValue)) / pageCount) * pageRange;
}

function readSourcePageCount(document: unknown, selectedPages: readonly unknown[]): number {
  const candidate = document as { sourcePageCount?: unknown; pageCount?: unknown };
  const value = Number(candidate.sourcePageCount ?? candidate.pageCount);
  if (Number.isFinite(value) && value >= selectedPages.length) {
    return Math.trunc(value);
  }
  return selectedPages.length;
}

function normalizeRotation(value: number): 0 | 90 | 180 | 270 {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const normalized = ((Math.trunc(value) % 360) + 360) % 360;
  if (normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized;
  }
  throw new DensePdfUnsupportedError(
    `Dense PDF pages require a multiple-of-90 rotation; received ${value}.`
  );
}

type DensePdfPageBoxInput = DensePdfPageBox | readonly number[];

function normalizeBox(
  value: DensePdfPageBoxInput,
  label: string
): [number, number, number, number] {
  const coordinates: readonly number[] = isDensePdfPageBox(value)
    ? [value.left, value.bottom, value.right, value.top]
    : value;
  if (coordinates.length < 4) {
    throw new DensePdfSyntaxError(`Dense PDF ${label} must contain four coordinates.`);
  }
  const x0 = Number(coordinates[0]);
  const y0 = Number(coordinates[1]);
  const x1 = Number(coordinates[2]);
  const y1 = Number(coordinates[3]);
  if (![x0, y0, x1, y1].every(Number.isFinite)) {
    throw new DensePdfSyntaxError(`Dense PDF ${label} contains a non-finite coordinate.`);
  }
  const normalized: [number, number, number, number] = [
    Math.min(x0, x1),
    Math.min(y0, y1),
    Math.max(x0, x1),
    Math.max(y0, y1)
  ];
  if (normalized[0] === normalized[2] || normalized[1] === normalized[3]) {
    throw new DensePdfSyntaxError(`Dense PDF ${label} has zero area.`);
  }
  return normalized;
}

function isDensePdfPageBox(value: DensePdfPageBoxInput): value is DensePdfPageBox {
  return "left" in value;
}

function copyBox(value: DensePdfPageBoxInput, label: string): [number, number, number, number] {
  return normalizeBox(value, label);
}

function computePdfJsViewBox(
  mediaBox: [number, number, number, number],
  cropBox: [number, number, number, number]
): [number, number, number, number] {
  if (boxesEqual(mediaBox, cropBox)) {
    return mediaBox;
  }
  const intersection: [number, number, number, number] = [
    Math.max(mediaBox[0], cropBox[0]),
    Math.max(mediaBox[1], cropBox[1]),
    Math.min(mediaBox[2], cropBox[2]),
    Math.min(mediaBox[3], cropBox[3])
  ];
  return intersection[0] < intersection[2] && intersection[1] < intersection[3]
    ? intersection
    : mediaBox;
}

function boxesEqual(
  left: readonly number[],
  right: readonly number[]
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function transformBox(box: readonly number[], matrix: DensePdfMatrix): DensePdfBounds {
  const points = [
    transformPoint(matrix, box[0], box[1]),
    transformPoint(matrix, box[0], box[3]),
    transformPoint(matrix, box[2], box[1]),
    transformPoint(matrix, box[2], box[3])
  ];
  return {
    minX: Math.min(...points.map(([x]) => x)),
    minY: Math.min(...points.map(([, y]) => y)),
    maxX: Math.max(...points.map(([x]) => x)),
    maxY: Math.max(...points.map(([, y]) => y))
  };
}

function transformPoint(matrix: DensePdfMatrix, x: number, y: number): [number, number] {
  return [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5]
  ];
}

function collectTransferables(value: unknown): Transferable[] {
  const transfers = new Set<ArrayBuffer>();
  const visited = new WeakSet<object>();
  const visit = (candidate: unknown): void => {
    if (candidate instanceof ArrayBuffer) {
      if (candidate.byteLength > 0) {
        transfers.add(candidate);
      }
      return;
    }
    if (ArrayBuffer.isView(candidate)) {
      if (candidate.buffer instanceof ArrayBuffer && candidate.buffer.byteLength > 0) {
        transfers.add(candidate.buffer);
      }
      return;
    }
    if (!candidate || typeof candidate !== "object" || visited.has(candidate)) {
      return;
    }
    visited.add(candidate);
    if (candidate instanceof Set || candidate instanceof Map) {
      for (const entry of candidate.values()) {
        visit(entry);
      }
      return;
    }
    for (const entry of Object.values(candidate)) {
      visit(entry);
    }
  };
  visit(value);
  return [...transfers];
}

function serializeError(error: unknown): DensePdfFastWorkerSerializedError {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || String(error),
      ...(error.stack ? { stack: error.stack } : {})
    };
  }
  return { name: "Error", message: String(error) };
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function advanceHeartbeatValue(progress: DensePdfFastWorkerProgress): number {
  let ceiling = 0.99;
  if (progress.stage === "pdf-fast-check") {
    ceiling = PREFLIGHT_PROGRESS_END - 0.001;
  } else if (progress.pageIndex !== undefined && progress.pageCount) {
    ceiling = interpolatePageProgress(progress.pageIndex, progress.pageCount, 0.99);
  }
  const remaining = Math.max(0, ceiling - progress.value);
  if (remaining === 0) {
    return progress.value;
  }
  return clamp01(
    progress.value + Math.min(remaining, Math.max(0.0001, remaining * 0.04))
  );
}

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}
