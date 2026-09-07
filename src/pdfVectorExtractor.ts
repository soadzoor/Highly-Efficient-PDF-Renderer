import {
  createLoadProgressReporter,
  type LoadProgressCallback,
  type LoadProgressReporter,
  type PDFLoadExecutionPath,
  type PDFLoadStage
} from "./loadProgress";
import {
  compileDensePdfInWorker,
  type DensePdfFastCompiledPage,
  type DensePdfFastWorkerProgress,
  type DensePdfFastWorkerSuccess
} from "./densePdfFastWorkerClient";

import type { PdfProgress } from "./heprDocumentData";
import type { NativeMissingFontResolver } from "./pdf/nativeFont";
import type { NativeVectorPdfSession, PdfSession } from "./pdfSession";

type Mat2D = [number, number, number, number, number, number];

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface RasterLayer {
  width: number;
  height: number;
  data: Uint8Array<ArrayBufferLike>;
  matrix: Float32Array;
  /** Dense PDF paint ordinal within `pageIndex`. */
  paintOrder: number;
  /** Zero-based page slot in the composed scene. */
  pageIndex: number;
}

/** Searchable text for one page, in scene space (Y-up, page placement baked in). */
export interface PageTextIndex {
  /** Searchable text; word gaps and line breaks are encoded as a single " ". */
  text: string;
  /**
   * One entry per UTF-16 code unit of `text`:
   *   >= 0  -> row index into textInstanceA/B/C (bounds derivable from the
   *            instance transform and the glyph ink box);
   *   -1    -> separator " " (no geometry);
   *   <= -2 -> fallback quad slot k = (-value - 2) into `fallbackQuads`, used
   *            for glyphs without a render instance (invisible OCR text,
   *            atlas misses, clip-culled, vertical fonts).
   * Multi-code-unit glyphs (ligatures) repeat the same reference per unit.
   */
  charInstance: Int32Array;
  /** 4 floats per fallback slot: minX, minY, maxX, maxY in scene space. */
  fallbackQuads: Float32Array;
}

export interface SceneTextIndex {
  version: 2;
  /** One entry per page, aligned with pageRects ordering. */
  pages: PageTextIndex[];
}

/**
 * One text string with its axis-aligned bounding box in composed scene
 * coordinates (Y-up, same space as `VectorScene.endpoints`).
 */
export interface SceneTextItem {
  text: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Index into `VectorScene.pageRects` (4 floats per page). */
  pageIndex: number;
}

export interface VectorScene {
  pageCount: number;
  pagesPerRow: number;
  pageRects: Float32Array;
  pageTextRanges: Uint32Array;
  textIndex: SceneTextIndex | null;
  fillPathCount: number;
  fillSegmentCount: number;
  fillPathMetaA: Float32Array;
  fillPathMetaB: Float32Array;
  fillPathMetaC: Float32Array;
  fillSegmentsA: Float32Array;
  fillSegmentsB: Float32Array;
  gradientCount: number;
  gradientMetaA: Float32Array;
  gradientMetaB: Float32Array;
  gradientMetaC: Float32Array;
  gradientMetaD: Float32Array;
  gradientMetaE: Float32Array;
  gradientLut: Uint8Array;
  gradientFillPathCount: number;
  gradientFillSegmentCount: number;
  gradientFillPathMetaA: Float32Array;
  gradientFillPathMetaB: Float32Array;
  gradientFillPathMetaC: Float32Array;
  gradientFillPaintMeta: Float32Array;
  gradientFillSegmentsA: Float32Array;
  gradientFillSegmentsB: Float32Array;
  gradientStrokeRunCount: number;
  gradientStrokeSegmentCount: number;
  gradientStrokeRunMetaA: Float32Array;
  gradientStrokeRunMetaB: Float32Array;
  gradientStrokeEndpoints: Float32Array;
  gradientStrokePrimitiveMeta: Float32Array;
  gradientStrokePrimitiveBounds: Float32Array;
  gradientStrokeStyles: Float32Array;
  segmentCount: number;
  sourceSegmentCount: number;
  mergedSegmentCount: number;
  /** Post-cull stroke segments still painted in image layers; absent in older HEP files. */
  imageLayerSegmentCount?: number;
  sourceTextCount: number;
  textInstanceCount: number;
  textGlyphCount: number;
  textGlyphSegmentCount: number;
  textInPageCount: number;
  textOutOfPageCount: number;
  textInstanceA: Float32Array;
  textInstanceB: Float32Array;
  textInstanceC: Float32Array;
  /** Optional page-space clip rectangles; `textInstanceB.w` stores index + 1. */
  textClipRects?: Float32Array;
  textGlyphMetaA: Float32Array;
  textGlyphMetaB: Float32Array;
  textGlyphSegmentsA: Float32Array;
  textGlyphSegmentsB: Float32Array;
  rasterLayers: RasterLayer[];
  // Legacy single-layer fields kept for backward compatibility with old HEP files.
  rasterLayerWidth: number;
  rasterLayerHeight: number;
  rasterLayerData: Uint8Array<ArrayBufferLike>;
  rasterLayerMatrix: Float32Array;
  endpoints: Float32Array;
  primitiveMeta: Float32Array;
  primitiveBounds: Float32Array;
  styles: Float32Array;
  bounds: Bounds;
  pageBounds: Bounds;
  maxHalfWidth: number;
  operatorCount: number;
  /** Engine-specific diagnostic units, not raw PDF operators or GPU draw calls. */
  operatorCountKind?: "native-estimate" | "mixed";
  imagePaintOpCount: number;
  pathCount: number;
  discardedTransparentCount: number;
  discardedDegenerateCount: number;
  discardedDuplicateCount: number;
  discardedContainedCount: number;
  /**
   * Text strings with scene-space bounding boxes, present only when extracted from a PDF
   * source with `extractTextContent` enabled (HEP sources do not carry strings).
   */
  textContent?: SceneTextItem[];
}

export interface VectorExtractOptions {
  enableSegmentMerge?: boolean;
  enableInvisibleCull?: boolean;
  /** Use the content-gated dense-vector PDF compiler when available. Default `"auto"`. */
  pdfFastPath?: "auto" | "off";
  /** One-based PDF page selection such as `"1-5, 8, 11-13"`. */
  pages?: string;
  maxPagesPerRow?: number;
  onProgress?: LoadProgressCallback;
  /** Also expose word-level text strings with scene-space positions. Default false. */
  extractTextContent?: boolean;
}

class Float4Builder {
  private data: Float32Array;

  private length = 0;

  constructor(initialQuads = 32_768) {
    this.data = new Float32Array(initialQuads * 4);
  }

  get quadCount(): number {
    return this.length >> 2;
  }

  truncateQuads(quadCount: number): void {
    this.length = Math.max(0, Math.min(this.length, Math.trunc(quadCount) * 4));
  }

  push(a: number, b: number, c: number, d: number): void {
    this.ensureCapacity(4);
    const offset = this.length;
    this.data[offset] = a;
    this.data[offset + 1] = b;
    this.data[offset + 2] = c;
    this.data[offset + 3] = d;
    this.length += 4;
  }

  append(source: Float32Array, offset: number, length: number): void {
    if (length <= 0) {
      return;
    }
    this.ensureCapacity(length);
    this.data.set(source.subarray(offset, offset + length), this.length);
    this.length += length;
  }

  toTypedArray(): Float32Array {
    return this.data.slice(0, this.length);
  }

  private ensureCapacity(extraFloats: number): void {
    if (this.length + extraFloats <= this.data.length) {
      return;
    }
    let nextLength = this.data.length;
    while (this.length + extraFloats > nextLength) {
      nextLength *= 2;
    }
    const next = new Float32Array(nextLength);
    next.set(this.data);
    this.data = next;
  }
}

export const GRADIENT_LUT_WIDTH = 1024;

export const STROKE_STYLE_FLAG_HAIRLINE = 1 << 0;

const STROKE_STYLE_FLAG_OFFSET = 2;
const PAGE_GRID_GAP_FACTOR = 0.08;
const PAGE_GRID_MIN_GAP = 24;
const DENSE_PDF_FAST_ATTEMPT_PROGRESS_END = 0.18;
const DENSE_PDF_TEXT_PROGRESS_END = 0.45;
const NATIVE_PDF_SUCCESS_PROGRESS_END = 0.94;

export function decodeStrokeStyleMeta(encoded: number): { alpha: number; styleFlags: number } {
  const flags = Math.max(0, Math.trunc(encoded / STROKE_STYLE_FLAG_OFFSET + 1e-6));
  const alpha = clamp01(encoded - flags * STROKE_STYLE_FLAG_OFFSET);
  return { alpha, styleFlags: flags };
}

export async function extractFirstPageVectors(pdfData: ArrayBuffer, options: VectorExtractOptions = {}): Promise<VectorScene> {
  return extractPdfVectors(pdfData, {
    ...options,
    pages: "1",
    maxPagesPerRow: 1
  });
}

export async function extractPdfPageScenes(
  pdfData: ArrayBuffer,
  options: VectorExtractOptions = {},
  /** @internal Used by HEP export to cancel active PDF parser work. */
  signal?: AbortSignal
): Promise<VectorScene[]> {
  signal?.throwIfAborted();
  const progress = createLoadProgressReporter(options.onProgress);
  if (options.pdfFastPath === "off") {
    return extractPdfPageScenesWithNativeTier(
      pdfData,
      options,
      progress,
      0,
      signal
    );
  }

  const fastProgress = progress.child(0, DENSE_PDF_FAST_ATTEMPT_PROGRESS_END);
  let sawFastProgress = false;
  let fastResult: Awaited<ReturnType<typeof compileDensePdfInWorker>> | null = null;
  try {
    fastResult = await compileDensePdfInWorker(pdfData, {
      pages: options.pages,
      enableSegmentMerge: options.enableSegmentMerge,
      enableInvisibleCull: options.enableInvisibleCull,
      signal,
      onProgress: (event) => {
        sawFastProgress = true;
        reportDenseWorkerProgress(fastProgress, event);
      }
    });
  } catch (error) {
    signal?.throwIfAborted();
    console.info(`[hepr] dense PDF fast path unavailable: ${formatErrorMessage(error)}`);
    return extractPdfPageScenesWithNativeTier(
      pdfData,
      options,
      progress,
      sawFastProgress ? DENSE_PDF_FAST_ATTEMPT_PROGRESS_END : 0,
      signal
    );
  }
  signal?.throwIfAborted();

  if (!fastResult) {
    console.info("[hepr] dense PDF fast path fallback: worker completed without a result");
    return extractPdfPageScenesWithNativeTier(
      pdfData,
      options,
      progress,
      sawFastProgress ? DENSE_PDF_FAST_ATTEMPT_PROGRESS_END : 0,
      signal
    );
  }

  if (fastResult.kind !== "success") {
    const reason = fastResult.kind === "fallback"
      ? `${fastResult.reason}: ${fastResult.message}`
      : `${fastResult.error.name}: ${fastResult.error.message}`;
    console.info(`[hepr] dense PDF fast path fallback: ${reason}`);
    return extractPdfPageScenesWithNativeTier(
      pdfData,
      options,
      progress,
      sawFastProgress ? DENSE_PDF_FAST_ATTEMPT_PROGRESS_END : 0,
      signal
    );
  }

  try {
    return await finishDensePdfPageScenes(fastResult, options, progress, signal);
  } catch (error) {
    signal?.throwIfAborted();
    console.info(`[hepr] dense PDF fast path text/finalization fallback: ${formatErrorMessage(error)}`);
    // Do not retain hundreds of megabytes of speculative packed geometry while
    // the full native parser builds its resource-aware page representation.
    fastResult = null;
    return extractPdfPageScenesWithNativeTier(
      pdfData,
      options,
      progress,
      DENSE_PDF_TEXT_PROGRESS_END,
      signal
    );
  }
}

function reportDenseWorkerProgress(
  reporter: LoadProgressReporter,
  event: DensePdfFastWorkerProgress
): void {
  reporter.report(event.value, event);
}

function withRemappedProgress(
  options: VectorExtractOptions,
  reporter: LoadProgressReporter,
  start: number,
  end: number,
  executionPath: PDFLoadExecutionPath
): VectorExtractOptions {
  const phaseProgress = reporter.child(start, end);
  return {
    ...options,
    pdfFastPath: "off",
    onProgress: (event) => {
      phaseProgress.report(event.value, {
        ...event,
        executionPath
      });
    }
  };
}

async function extractPdfPageScenesWithNativeTier(
  pdfData: ArrayBuffer,
  options: VectorExtractOptions,
  progress: LoadProgressReporter,
  start: number,
  signal?: AbortSignal
): Promise<VectorScene[]> {
  const pageScenes = await extractPdfPageScenesWithNative(
    pdfData,
    withRemappedProgress(
      options,
      progress,
      start,
      NATIVE_PDF_SUCCESS_PROGRESS_END,
      "worker"
    ),
    signal
  );
  progress.report(NATIVE_PDF_SUCCESS_PROGRESS_END, {
    stage: "compile",
    executionPath: "worker",
    sourceType: "pdf",
    unit: "pages",
    processed: pageScenes.length,
    total: pageScenes.length,
    pageCount: pageScenes.length
  });
  return pageScenes;
}

async function extractPdfPageScenesWithNative(
  pdfData: ArrayBuffer,
  options: VectorExtractOptions,
  signal?: AbortSignal
): Promise<VectorScene[]> {
  signal?.throwIfAborted();
  const {
    openPdfInBrowserWorker,
    openPdfInNodeWorker
  } = await import("./pdf/workerClient");
  signal?.throwIfAborted();
  const progress = createLoadProgressReporter(options.onProgress);
  progress.report(0, {
    stage: "source",
    executionPath: "worker",
    sourceType: "pdf",
    unit: "bytes",
    processed: 0,
    total: pdfData.byteLength
  });

  let selectionIndex = -1;
  let selectedPageCount = 0;
  let sourcePageCount = 0;
  const reportProgress = (event: Readonly<PdfProgress>): void => {
    reportNativePdfProgress(progress, event, {
      selectionIndex,
      selectedPageCount,
      sourcePageCount
    });
  };
  let session: PdfSession | null = null;
  let failed = false;
  try {
    const source = {
      kind: "bytes",
      bytes: new Uint8Array(pdfData),
      ownership: "copy"
    } as const;
    const missingFontResolver = await nativeVectorMissingFontResolver();
    const openOptions = {
      repair: "safe",
      signal,
      missingFontResolver,
      onProgress: reportProgress
    } as const;
    session = isNodeRuntime()
      ? await openPdfInNodeWorker(source, openOptions)
      : await openPdfInBrowserWorker(source, openOptions);
    const vectorSession = readNativeVectorSession(session);
    sourcePageCount = vectorSession.info.pageCount;
    const pageNumbers = resolvePdfPageNumbers(sourcePageCount, options.pages);
    selectedPageCount = pageNumbers.length;
    const pageScenes: VectorScene[] = [];

    for (selectionIndex = 0; selectionIndex < selectedPageCount; selectionIndex += 1) {
      signal?.throwIfAborted();
      const sourcePageIndex = pageNumbers[selectionIndex] - 1;
      const pageStart = 0.12 + (selectionIndex / selectedPageCount) * 0.82;
      const pageEnd = 0.12 + ((selectionIndex + 1) / selectedPageCount) * 0.82;
      progress.report(pageStart, {
        stage: "pdf-page",
        executionPath: "worker",
        sourceType: "pdf",
        unit: "pages",
        processed: selectionIndex,
        total: selectedPageCount,
        pageIndex: selectionIndex,
        pageCount: selectedPageCount,
        sourcePageIndex,
        sourcePageCount
      });
      const scene = await vectorSession.compileVectorPage(sourcePageIndex, {
        signal,
        optimization:
          options.enableSegmentMerge === false && options.enableInvisibleCull === false
            ? "none"
            : "safe",
        enableSegmentMerge: options.enableSegmentMerge !== false,
        enableInvisibleCull: options.enableInvisibleCull !== false,
        onProgress: reportProgress
      });
      signal?.throwIfAborted();
      if (options.extractTextContent === true) {
        scene.textContent = deriveSceneTextContentFromIndex(scene, 0);
      }
      pageScenes.push(scene);
      progress.report(pageEnd, {
        stage: "pdf-page",
        executionPath: "worker",
        sourceType: "pdf",
        unit: "pages",
        processed: selectionIndex + 1,
        total: selectedPageCount,
        pageIndex: selectionIndex,
        pageCount: selectedPageCount,
        sourcePageIndex,
        sourcePageCount
      });
    }

    signal?.throwIfAborted();
    progress.report(1, {
      stage: "compile",
      executionPath: "worker",
      sourceType: "pdf",
      unit: "pages",
      processed: pageScenes.length,
      total: pageScenes.length,
      pageCount: pageScenes.length,
      sourcePageCount
    });
    return pageScenes;
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      await session?.close();
    } catch (closeError) {
      if (!failed) throw closeError;
    }
  }
}

let nativeVectorMissingFontResolverPromise: Promise<NativeMissingFontResolver> | undefined;

/**
 * The full native compatibility tier owns deterministic substitutes just like
 * the dense worker. Keep the resolver on the host so browser and Node workers
 * share one lazy face cache through the existing request protocol.
 */
function nativeVectorMissingFontResolver(): Promise<NativeMissingFontResolver> {
  nativeVectorMissingFontResolverPromise ??= isNodeRuntime()
    ? import("./nodePdfSource").then(({ createNodeBundledStandardFontResolver }) =>
        createNodeBundledStandardFontResolver())
    : import("./standardFontResolver").then(({ createBundledStandardFontResolver }) =>
        createBundledStandardFontResolver());
  return nativeVectorMissingFontResolverPromise;
}

function isNodeRuntime(): boolean {
  const nodeProcess = (globalThis as {
    readonly process?: { readonly versions?: { readonly node?: string } };
  }).process;
  return typeof nodeProcess?.versions?.node === "string";
}

function readNativeVectorSession(session: PdfSession): NativeVectorPdfSession {
  const candidate = session as Partial<NativeVectorPdfSession>;
  if (typeof candidate.compileVectorPage !== "function") {
    throw new TypeError("The native PDF session does not expose VectorScene compilation.");
  }
  return session as NativeVectorPdfSession;
}

function reportNativePdfProgress(
  reporter: LoadProgressReporter,
  event: Readonly<PdfProgress>,
  context: {
    readonly selectionIndex: number;
    readonly selectedPageCount: number;
    readonly sourcePageCount: number;
  }
): void {
  const stage = nativePdfLoadStage(event.stage);
  const pageSelected = context.selectionIndex >= 0 && context.selectedPageCount > 0;
  const ratio = event.total && event.total > 0
    ? Math.max(0, Math.min(1, event.completed / event.total))
    : 0;
  let value: number;
  if (!pageSelected) {
    value = event.stage === "source-read"
      ? 0.02 * ratio
      : event.stage === "xref"
        ? 0.05
        : event.stage === "catalog"
          ? 0.09
          : 0.11;
  } else {
    const pageStart = 0.12 + (context.selectionIndex / context.selectedPageCount) * 0.82;
    const pageSpan = 0.82 / context.selectedPageCount;
    const local = event.stage === "content"
      ? 0.08 + ratio * 0.56
      : event.stage === "optimize"
        ? 0.66 + ratio * 0.24
        : event.stage === "font"
          ? 0.92
          : event.stage === "image" || event.stage === "color"
            ? 0.96
            : 0.04;
    value = pageStart + pageSpan * local;
  }
  reporter.report(value, {
    stage,
    executionPath: "worker",
    sourceType: "pdf",
    unit: nativePdfLoadUnit(event.stage),
    processed: event.completed,
    ...(event.total === null ? {} : { total: event.total }),
    ...(pageSelected ? {
      pageIndex: context.selectionIndex,
      pageCount: context.selectedPageCount
    } : {}),
    ...(event.sourcePageIndex === null ? {} : { sourcePageIndex: event.sourcePageIndex }),
    ...(context.sourcePageCount > 0 ? { sourcePageCount: context.sourcePageCount } : {})
  });
}

function nativePdfLoadStage(stage: PdfProgress["stage"]): PDFLoadStage {
  switch (stage) {
    case "source-read":
    case "xref":
    case "catalog":
      return "source";
    case "page":
      return "pdf-page";
    case "content":
      return "pdf-operators";
    case "font":
      return "pdf-text";
    case "image":
    case "color":
      return "pdf-raster";
    case "optimize":
      return "pdf-optimize";
    default:
      return "compile";
  }
}

function nativePdfLoadUnit(
  stage: PdfProgress["stage"]
): "bytes" | "pages" | undefined {
  if (stage === "source-read" || stage === "content" || stage === "optimize") return "bytes";
  if (stage === "page") return "pages";
  return undefined;
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name || "Error"}: ${error.message || String(error)}`;
  }
  return String(error);
}

async function finishDensePdfPageScenes(
  result: DensePdfFastWorkerSuccess,
  options: VectorExtractOptions,
  progress: LoadProgressReporter,
  signal?: AbortSignal
): Promise<VectorScene[]> {
  signal?.throwIfAborted();
  if (result.pages.length === 0) {
    throw new Error("The dense PDF worker returned no selected pages.");
  }

  const geometryScenes = result.pages.map(createDenseGeometryScene);
  const hasText = result.pages.some((page) => page.compiled.textShowOpCount > 0);
  let pageScenes = geometryScenes;
  const nativeTextMs = result.timing.nativeTextMs ?? 0;

  if (hasText) {
    const textProgress = progress.child(
      DENSE_PDF_FAST_ATTEMPT_PROGRESS_END,
      DENSE_PDF_TEXT_PROGRESS_END
    );
    const textScenes = result.nativeTextScenes;
    if (!textScenes) {
      throw new Error("The native dense worker returned no text scene for a text-bearing page.");
    }
    if (textScenes.length !== geometryScenes.length) {
      throw new Error(
        `Dense PDF text page count mismatch: expected ${geometryScenes.length}, ` +
        `received ${textScenes.length}.`
      );
    }
    for (let index = 0; index < geometryScenes.length; index += 1) {
      assertDenseTextSceneParity(geometryScenes[index], textScenes[index], index);
    }
    textProgress.report(1, {
      stage: "pdf-text",
      executionPath: "dense-vector-worker",
      sourceType: "pdf",
      unit: "pages",
      processed: textScenes.length,
      total: textScenes.length,
      pageCount: textScenes.length,
      sourcePageCount: result.sourcePageCount
    });
    pageScenes = geometryScenes.map((geometry, index) => {
      assertDenseTextSceneParity(geometry, textScenes[index], index);
      const scene = mergeDenseGeometryWithText(geometry, textScenes[index]);
      if (options.extractTextContent === true && !scene.textContent) {
        scene.textContent = deriveSceneTextContentFromIndex(scene, 0);
      }
      return scene;
    });
  } else {
    if (options.extractTextContent === true) {
      for (const scene of pageScenes) scene.textContent = [];
    }
    progress.report(DENSE_PDF_TEXT_PROGRESS_END, {
      stage: "pdf-text",
      executionPath: "dense-vector-worker",
      sourceType: "pdf",
      unit: "pages",
      processed: result.pages.length,
      total: result.pages.length,
      pageCount: result.pages.length,
      sourcePageCount: result.sourcePageCount
    });
  }

  signal?.throwIfAborted();
  progress.report(0.94, {
    stage: "compile",
    executionPath: "dense-vector-worker",
    sourceType: "pdf",
    unit: "pages",
    processed: pageScenes.length,
    total: pageScenes.length,
    pageCount: pageScenes.length,
    sourcePageCount: result.sourcePageCount
  });

  const totalDecodedBytes = result.pages.reduce(
    (total, page) => total + page.decodedContentBytes,
    0
  );
  console.info(
    `[hepr] dense PDF fast path: backend=${result.structureBackend}, ` +
    `pages=${pageScenes.length}, decoded=${totalDecodedBytes.toLocaleString()} bytes, ` +
    `preflight=${result.timing.preflightMs.toFixed(1)}ms, decode=${result.timing.decodeMs.toFixed(1)}ms, ` +
    `compile=${result.timing.compileMs.toFixed(1)}ms, ` +
    `native-text=${nativeTextMs.toFixed(1)}ms, ` +
    `worker-total=${result.timing.totalMs.toFixed(1)}ms`
  );
  return pageScenes;
}

/** Build the legacy room-detection text side channel from the native text index. @internal */
export function deriveSceneTextContentFromIndex(
  scene: VectorScene,
  pageIndex: number
): SceneTextItem[] {
  const page = scene.textIndex?.pages[pageIndex];
  const items: SceneTextItem[] = [];
  if (!page || page.text.length === 0) return items;

  let runStart = -1;
  for (let index = 0; index <= page.charInstance.length; index += 1) {
    const separator = index === page.charInstance.length || page.charInstance[index] === -1;
    if (!separator) {
      if (runStart < 0) runStart = index;
      continue;
    }
    if (runStart < 0) continue;
    const text = page.text.slice(runStart, index).trim();
    const bounds = textRunBounds(scene, page, runStart, index);
    if (text.length !== 0 && bounds) items.push({ text, ...bounds, pageIndex });
    runStart = -1;
  }
  return items;
}

function textRunBounds(
  scene: VectorScene,
  page: PageTextIndex,
  start: number,
  end: number
): Bounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let index = start; index < Math.min(end, page.charInstance.length); index += 1) {
    const reference = page.charInstance[index];
    if (reference === -1) continue;
    if (reference <= -2) {
      const offset = (-reference - 2) * 4;
      if (offset + 3 < page.fallbackQuads.length) {
        minX = Math.min(minX, page.fallbackQuads[offset]);
        minY = Math.min(minY, page.fallbackQuads[offset + 1]);
        maxX = Math.max(maxX, page.fallbackQuads[offset + 2]);
        maxY = Math.max(maxY, page.fallbackQuads[offset + 3]);
      }
      continue;
    }

    const instanceOffset = reference * 4;
    if (
      instanceOffset + 3 >= scene.textInstanceA.length ||
      instanceOffset + 3 >= scene.textInstanceB.length
    ) continue;
    const glyphOffset = Math.trunc(scene.textInstanceB[instanceOffset + 2]) * 4;
    if (
      glyphOffset < 0 ||
      glyphOffset + 3 >= scene.textGlyphMetaA.length ||
      glyphOffset + 1 >= scene.textGlyphMetaB.length
    ) continue;

    const a = scene.textInstanceA[instanceOffset];
    const b = scene.textInstanceA[instanceOffset + 1];
    const c = scene.textInstanceA[instanceOffset + 2];
    const d = scene.textInstanceA[instanceOffset + 3];
    const e = scene.textInstanceB[instanceOffset];
    const f = scene.textInstanceB[instanceOffset + 1];
    const inkMinX = scene.textGlyphMetaA[glyphOffset + 2];
    const inkMinY = scene.textGlyphMetaA[glyphOffset + 3];
    const inkMaxX = scene.textGlyphMetaB[glyphOffset];
    const inkMaxY = scene.textGlyphMetaB[glyphOffset + 1];
    const x00 = a * inkMinX + c * inkMinY + e;
    const y00 = b * inkMinX + d * inkMinY + f;
    const x01 = a * inkMinX + c * inkMaxY + e;
    const y01 = b * inkMinX + d * inkMaxY + f;
    const x10 = a * inkMaxX + c * inkMinY + e;
    const y10 = b * inkMaxX + d * inkMinY + f;
    const x11 = a * inkMaxX + c * inkMaxY + e;
    const y11 = b * inkMaxX + d * inkMaxY + f;
    let glyphMinX = Math.min(x00, x01, x10, x11);
    let glyphMinY = Math.min(y00, y01, y10, y11);
    let glyphMaxX = Math.max(x00, x01, x10, x11);
    let glyphMaxY = Math.max(y00, y01, y10, y11);
    const clipReference = Math.trunc(scene.textInstanceB[instanceOffset + 3]);
    const clipOffset = (clipReference - 1) * 4;
    if (clipReference > 0 && scene.textClipRects &&
        clipOffset + 3 < scene.textClipRects.length) {
      glyphMinX = Math.max(glyphMinX, scene.textClipRects[clipOffset]);
      glyphMinY = Math.max(glyphMinY, scene.textClipRects[clipOffset + 1]);
      glyphMaxX = Math.min(glyphMaxX, scene.textClipRects[clipOffset + 2]);
      glyphMaxY = Math.min(glyphMaxY, scene.textClipRects[clipOffset + 3]);
    }
    if (glyphMinX <= glyphMaxX && glyphMinY <= glyphMaxY) {
      minX = Math.min(minX, glyphMinX);
      minY = Math.min(minY, glyphMinY);
      maxX = Math.max(maxX, glyphMaxX);
      maxY = Math.max(maxY, glyphMaxY);
    }
  }

  return Number.isFinite(minX) && Number.isFinite(minY) && maxX > minX && maxY > minY
    ? { minX, minY, maxX, maxY }
    : null;
}

function assertDenseTextSceneParity(
  geometry: VectorScene,
  text: VectorScene,
  pageIndex: number
): void {
  if (text.pageCount !== 1 || !boundsNearlyEqual(geometry.pageBounds, text.pageBounds)) {
    throw new Error(`Dense PDF text page ${pageIndex + 1} has mismatched page geometry.`);
  }
  const unexpectedPaintCount =
    text.segmentCount +
    text.fillPathCount +
    text.fillSegmentCount +
    text.gradientCount +
    text.gradientFillPathCount +
    text.gradientFillSegmentCount +
    text.gradientStrokeRunCount +
    text.gradientStrokeSegmentCount +
    text.imagePaintOpCount +
    text.pathCount +
    text.rasterLayers.length +
    text.rasterLayerData.length;
  if (unexpectedPaintCount !== 0) {
    throw new Error(
      `Dense PDF text page ${pageIndex + 1} produced non-text paint that cannot be merged safely.`
    );
  }
}

function createDenseGeometryScene(page: DensePdfFastCompiledPage): VectorScene {
  const scene = createEmptyVectorScene();
  const { compiled } = page;
  const pageBounds: Bounds = { ...page.pageBounds };
  return {
    ...scene,
    pageCount: 1,
    pagesPerRow: 1,
    pageRects: new Float32Array([
      pageBounds.minX,
      pageBounds.minY,
      pageBounds.maxX,
      pageBounds.maxY
    ]),
    pageTextRanges: new Uint32Array([0, 0]),
    textIndex: {
      version: 2,
      pages: [{
        text: "",
        charInstance: new Int32Array(0),
        fallbackQuads: new Float32Array(0)
      }]
    },
    fillPathCount: compiled.fillPathCount,
    fillSegmentCount: compiled.fillSegmentCount,
    fillPathMetaA: compiled.fillPathMetaA,
    fillPathMetaB: compiled.fillPathMetaB,
    fillPathMetaC: compiled.fillPathMetaC,
    fillSegmentsA: compiled.fillSegmentsA,
    fillSegmentsB: compiled.fillSegmentsB,
    segmentCount: compiled.segmentCount,
    sourceSegmentCount: compiled.sourceSegmentCount,
    mergedSegmentCount: compiled.mergedSegmentCount,
    imageLayerSegmentCount: 0,
    operatorCountKind: "native-estimate",
    endpoints: compiled.endpoints,
    primitiveMeta: compiled.primitiveMeta,
    primitiveBounds: compiled.primitiveBounds,
    styles: compiled.styles,
    bounds: { ...compiled.bounds },
    pageBounds,
    maxHalfWidth: compiled.maxHalfWidth,
    operatorCount: compiled.operatorCount,
    imagePaintOpCount: 0,
    pathCount: compiled.pathCount,
    discardedTransparentCount: compiled.discardedTransparentCount,
    discardedDegenerateCount: compiled.discardedDegenerateCount,
    discardedDuplicateCount: compiled.discardedDuplicateCount,
    discardedContainedCount: compiled.discardedContainedCount
  };
}

function mergeDenseGeometryWithText(
  geometry: VectorScene,
  text: VectorScene
): VectorScene {
  const hasGeometryBounds = geometry.segmentCount > 0 || geometry.fillPathCount > 0;
  const hasTextBounds = text.sourceTextCount > 0 || text.textInstanceCount > 0;
  const combinedBounds = hasGeometryBounds
    ? hasTextBounds
      ? combineBounds(geometry.bounds, text.bounds) ?? geometry.bounds
      : geometry.bounds
    : hasTextBounds
      ? { ...text.bounds }
      : { ...geometry.pageBounds };
  return {
    ...geometry,
    pageTextRanges: new Uint32Array([0, text.textInstanceCount]),
    textIndex: text.textIndex,
    sourceTextCount: text.sourceTextCount,
    textInstanceCount: text.textInstanceCount,
    textGlyphCount: text.textGlyphCount,
    textGlyphSegmentCount: text.textGlyphSegmentCount,
    textInPageCount: text.textInPageCount,
    textOutOfPageCount: text.textOutOfPageCount,
    textInstanceA: text.textInstanceA,
    textInstanceB: text.textInstanceB,
    textInstanceC: text.textInstanceC,
    ...(text.textClipRects ? { textClipRects: text.textClipRects } : {}),
    textGlyphMetaA: text.textGlyphMetaA,
    textGlyphMetaB: text.textGlyphMetaB,
    textGlyphSegmentsA: text.textGlyphSegmentsA,
    textGlyphSegmentsB: text.textGlyphSegmentsB,
    bounds: combinedBounds,
    ...(text.textContent ? { textContent: text.textContent } : {})
  };
}

export function composeVectorScenesInGrid(pageScenes: VectorScene[], requestedPagesPerRow: number): VectorScene {
  return composeScenesInGrid(pageScenes, requestedPagesPerRow);
}

export async function extractPdfVectors(pdfData: ArrayBuffer, options: VectorExtractOptions = {}): Promise<VectorScene> {
  const maxPagesPerRow = normalizePositiveInt(options.maxPagesPerRow, 10, 1, 100);
  const pageScenes = await extractPdfPageScenes(pdfData, options);
  const progress = createLoadProgressReporter(options.onProgress);
  progress.report(0.96, { stage: "compile", sourceType: "pdf" });
  const scene = composeScenesInGrid(pageScenes, maxPagesPerRow);
  progress.complete({ sourceType: "pdf" });
  return scene;
}

export async function extractPdfRasterPageScenes(
  pdfData: ArrayBuffer,
  options: VectorExtractOptions = {},
  signal?: AbortSignal
): Promise<VectorScene[]> {
  const pageScenes = await extractPdfPageScenesWithNative(pdfData, {
    ...options,
    // Embedded-source recovery needs only the image paints. Avoid retaining a
    // second searchable-text sidecar while loading the surrounding HEP scene.
    extractTextContent: false
  }, signal);
  return pageScenes.map(createNativeRasterOnlyPageScene);
}

export async function extractPdfRasterScene(pdfData: ArrayBuffer, options: VectorExtractOptions = {}, signal?: AbortSignal): Promise<VectorScene> {
  const maxPagesPerRow = normalizePositiveInt(options.maxPagesPerRow, 10, 1, 100);
  const pageScenes = await extractPdfRasterPageScenes(pdfData, options, signal);
  signal?.throwIfAborted();
  const progress = createLoadProgressReporter(options.onProgress);
  progress.report(0.96, { stage: "compile", sourceType: "pdf" });
  const scene = composeScenesInGrid(pageScenes, maxPagesPerRow);
  progress.complete({ sourceType: "pdf" });
  return scene;
}

/**
 * Retain only the image resources from a native one-page VectorScene.
 *
 * HEP v6 may embed its source PDF when an older producer could count image
 * paints but could not serialize their pixels. Recovery must not merge the
 * freshly compiled vector/text data into the already-decoded HEP scene; only
 * the ordered raster layers cross this compatibility boundary.
 */
function createNativeRasterOnlyPageScene(scene: VectorScene): VectorScene {
  const pageBounds = normalizeSceneBounds(scene.pageBounds, scene.bounds);
  const rasterLayers = listSceneRasterLayers(scene).map((layer) => ({
    ...layer,
    pageIndex: 0
  }));
  let rasterBounds: Bounds | null = null;
  for (const layer of rasterLayers) {
    const matrix: Mat2D = [
      layer.matrix[0],
      layer.matrix[1],
      layer.matrix[2],
      layer.matrix[3],
      layer.matrix[4],
      layer.matrix[5]
    ];
    rasterBounds = combineBounds(
      rasterBounds,
      transformBounds({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, matrix)
    );
  }

  const base = createEmptyVectorScene();
  const primaryRasterLayer = rasterLayers[0] ?? null;
  return {
    ...base,
    pageCount: 1,
    pagesPerRow: 1,
    pageRects: new Float32Array([
      pageBounds.minX,
      pageBounds.minY,
      pageBounds.maxX,
      pageBounds.maxY
    ]),
    pageTextRanges: new Uint32Array([0, 0]),
    rasterLayers,
    rasterLayerWidth: primaryRasterLayer?.width ?? 0,
    rasterLayerHeight: primaryRasterLayer?.height ?? 0,
    rasterLayerData: primaryRasterLayer?.data ?? new Uint8Array(0),
    rasterLayerMatrix:
      primaryRasterLayer?.matrix ?? new Float32Array([1, 0, 0, 1, 0, 0]),
    bounds: combineBounds(pageBounds, rasterBounds) ?? pageBounds,
    pageBounds,
    imagePaintOpCount: scene.imagePaintOpCount,
    operatorCount: scene.operatorCount
  };
}

interface PagePlacement {
  translateX: number;
  translateY: number;
}

function composeScenesInGrid(pageScenes: VectorScene[], requestedPagesPerRow: number): VectorScene {
  if (pageScenes.length === 0) {
    return createEmptyVectorScene();
  }

  if (pageScenes.length === 1) {
    return {
      ...pageScenes[0],
      pageCount: 1,
      pagesPerRow: 1,
      pageTextRanges: normalizePageTextRangesForScene(pageScenes[0])
    };
  }

  const pagesPerRow = normalizePositiveInt(requestedPagesPerRow, 10, 1, 100);
  const placements = computeGridPlacements(pageScenes, pagesPerRow);

  let totalFillPathCount = 0;
  let totalFillSegmentCount = 0;
  let totalGradientCount = 0;
  let totalGradientFillPathCount = 0;
  let totalGradientFillSegmentCount = 0;
  let totalGradientStrokeRunCount = 0;
  let totalGradientStrokeSegmentCount = 0;
  let totalSegmentCount = 0;
  let totalSourceSegmentCount = 0;
  let totalMergedSegmentCount = 0;
  let totalSourceTextCount = 0;
  let totalTextInstanceCount = 0;
  let totalTextGlyphCount = 0;
  let totalTextGlyphSegmentCount = 0;
  let totalTextClipRectCount = 0;
  let totalTextInPageCount = 0;
  let totalTextOutOfPageCount = 0;
  let totalOperatorCount = 0;
  let totalImagePaintOpCount = 0;
  let totalPathCount = 0;
  let totalDiscardedTransparentCount = 0;
  let totalDiscardedDegenerateCount = 0;
  let totalDiscardedDuplicateCount = 0;
  let totalDiscardedContainedCount = 0;
  let maxHalfWidth = 0;
  let totalPageRectCount = 0;
  let hasAnyTextIndex = false;

  for (const scene of pageScenes) {
    hasAnyTextIndex = hasAnyTextIndex || scene.textIndex !== null;
    totalFillPathCount += scene.fillPathCount;
    totalFillSegmentCount += scene.fillSegmentCount;
    totalGradientCount += scene.gradientCount;
    totalGradientFillPathCount += scene.gradientFillPathCount;
    totalGradientFillSegmentCount += scene.gradientFillSegmentCount;
    totalGradientStrokeRunCount += scene.gradientStrokeRunCount;
    totalGradientStrokeSegmentCount += scene.gradientStrokeSegmentCount;
    totalSegmentCount += scene.segmentCount;
    totalSourceSegmentCount += scene.sourceSegmentCount;
    totalMergedSegmentCount += scene.mergedSegmentCount;
    totalSourceTextCount += scene.sourceTextCount;
    totalTextInstanceCount += scene.textInstanceCount;
    totalTextGlyphCount += scene.textGlyphCount;
    totalTextGlyphSegmentCount += scene.textGlyphSegmentCount;
    totalTextClipRectCount += Math.floor((scene.textClipRects?.length ?? 0) / 4);
    totalTextInPageCount += scene.textInPageCount;
    totalTextOutOfPageCount += scene.textOutOfPageCount;
    totalOperatorCount += scene.operatorCount;
    totalImagePaintOpCount += scene.imagePaintOpCount;
    totalPathCount += scene.pathCount;
    totalDiscardedTransparentCount += scene.discardedTransparentCount;
    totalDiscardedDegenerateCount += scene.discardedDegenerateCount;
    totalDiscardedDuplicateCount += scene.discardedDuplicateCount;
    totalDiscardedContainedCount += scene.discardedContainedCount;
    maxHalfWidth = Math.max(maxHalfWidth, scene.maxHalfWidth);
    const rectCount = scene.pageRects.length >= 4 ? Math.floor(scene.pageRects.length / 4) : 1;
    totalPageRectCount += Math.max(1, rectCount);
  }

  const fillPathMetaA = new Float32Array(totalFillPathCount * 4);
  const fillPathMetaB = new Float32Array(totalFillPathCount * 4);
  const fillPathMetaC = new Float32Array(totalFillPathCount * 4);
  const fillSegmentsA = new Float32Array(totalFillSegmentCount * 4);
  const fillSegmentsB = new Float32Array(totalFillSegmentCount * 4);
  const gradientMetaA = new Float32Array(totalGradientCount * 4);
  const gradientMetaB = new Float32Array(totalGradientCount * 4);
  const gradientMetaC = new Float32Array(totalGradientCount * 4);
  const gradientMetaD = new Float32Array(totalGradientCount * 4);
  const gradientMetaE = new Float32Array(totalGradientCount * 4);
  const gradientLut = new Uint8Array(totalGradientCount * GRADIENT_LUT_WIDTH * 4);
  const gradientFillPathMetaA = new Float32Array(totalGradientFillPathCount * 4);
  const gradientFillPathMetaB = new Float32Array(totalGradientFillPathCount * 4);
  const gradientFillPathMetaC = new Float32Array(totalGradientFillPathCount * 4);
  const gradientFillPaintMeta = new Float32Array(totalGradientFillPathCount * 4);
  const gradientFillSegmentsA = new Float32Array(totalGradientFillSegmentCount * 4);
  const gradientFillSegmentsB = new Float32Array(totalGradientFillSegmentCount * 4);
  const gradientStrokeRunMetaA = new Float32Array(totalGradientStrokeRunCount * 4);
  const gradientStrokeRunMetaB = new Float32Array(totalGradientStrokeRunCount * 4);
  const gradientStrokeEndpoints = new Float32Array(totalGradientStrokeSegmentCount * 4);
  const gradientStrokePrimitiveMeta = new Float32Array(totalGradientStrokeSegmentCount * 4);
  const gradientStrokePrimitiveBounds = new Float32Array(totalGradientStrokeSegmentCount * 4);
  const gradientStrokeStyles = new Float32Array(totalGradientStrokeSegmentCount * 4);
  const endpoints = new Float32Array(totalSegmentCount * 4);
  const primitiveMeta = new Float32Array(totalSegmentCount * 4);
  const primitiveBounds = new Float32Array(totalSegmentCount * 4);
  const styles = new Float32Array(totalSegmentCount * 4);
  const textInstanceA = new Float32Array(totalTextInstanceCount * 4);
  const textInstanceB = new Float32Array(totalTextInstanceCount * 4);
  const textInstanceC = new Float32Array(totalTextInstanceCount * 4);
  const textClipRects = new Float32Array(totalTextClipRectCount * 4);
  const textGlyphMetaA = new Float32Array(totalTextGlyphCount * 4);
  const textGlyphMetaB = new Float32Array(totalTextGlyphCount * 4);
  const textGlyphSegmentsA = new Float32Array(totalTextGlyphSegmentCount * 4);
  const textGlyphSegmentsB = new Float32Array(totalTextGlyphSegmentCount * 4);
  const pageRects = new Float32Array(totalPageRectCount * 4);
  const pageTextRanges = new Uint32Array(totalPageRectCount * 2);

  let fillPathOffset = 0;
  let fillSegmentOffset = 0;
  let gradientOffset = 0;
  let gradientFillPathOffset = 0;
  let gradientFillSegmentOffset = 0;
  let gradientStrokeRunOffset = 0;
  let gradientStrokeSegmentOffset = 0;
  let segmentOffset = 0;
  let textInstanceOffset = 0;
  let textGlyphOffset = 0;
  let textGlyphSegmentOffset = 0;
  let textClipRectOffset = 0;
  let pageRectOffset = 0;
  let combinedBounds: Bounds | null = null;
  let combinedPageBounds: Bounds | null = null;

  const rasterLayers: RasterLayer[] = [];
  const mergedTextIndexPages: PageTextIndex[] = [];
  const combinedTextContent: SceneTextItem[] = [];
  let hasTextContent = false;

  for (let pageIndex = 0; pageIndex < pageScenes.length; pageIndex += 1) {
    const scene = pageScenes[pageIndex];
    const placement = placements[pageIndex];
    const tx = placement.translateX;
    const ty = placement.translateY;
    const pageRectBase = pageRectOffset;

    if (scene.textContent) {
      hasTextContent = true;
      for (const item of scene.textContent) {
        combinedTextContent.push({
          text: item.text,
          minX: item.minX + tx,
          minY: item.minY + ty,
          maxX: item.maxX + tx,
          maxY: item.maxY + ty,
          pageIndex: pageRectBase + item.pageIndex
        });
      }
    }

    for (let i = 0; i < scene.fillPathCount; i += 1) {
      const src = i * 4;
      const dst = (fillPathOffset + i) * 4;
      fillPathMetaA[dst] = scene.fillPathMetaA[src] + fillSegmentOffset;
      fillPathMetaA[dst + 1] = scene.fillPathMetaA[src + 1];
      fillPathMetaA[dst + 2] = scene.fillPathMetaA[src + 2] + tx;
      fillPathMetaA[dst + 3] = scene.fillPathMetaA[src + 3] + ty;

      fillPathMetaB[dst] = scene.fillPathMetaB[src] + tx;
      fillPathMetaB[dst + 1] = scene.fillPathMetaB[src + 1] + ty;
      fillPathMetaB[dst + 2] = scene.fillPathMetaB[src + 2];
      fillPathMetaB[dst + 3] = scene.fillPathMetaB[src + 3];

      fillPathMetaC[dst] = scene.fillPathMetaC[src];
      fillPathMetaC[dst + 1] = scene.fillPathMetaC[src + 1];
      fillPathMetaC[dst + 2] = scene.fillPathMetaC[src + 2];
      fillPathMetaC[dst + 3] = scene.fillPathMetaC[src + 3];
    }

    for (let i = 0; i < scene.fillSegmentCount; i += 1) {
      const src = i * 4;
      const dst = (fillSegmentOffset + i) * 4;
      fillSegmentsA[dst] = scene.fillSegmentsA[src] + tx;
      fillSegmentsA[dst + 1] = scene.fillSegmentsA[src + 1] + ty;
      fillSegmentsA[dst + 2] = scene.fillSegmentsA[src + 2] + tx;
      fillSegmentsA[dst + 3] = scene.fillSegmentsA[src + 3] + ty;

      fillSegmentsB[dst] = scene.fillSegmentsB[src] + tx;
      fillSegmentsB[dst + 1] = scene.fillSegmentsB[src + 1] + ty;
      fillSegmentsB[dst + 2] = scene.fillSegmentsB[src + 2];
      fillSegmentsB[dst + 3] = scene.fillSegmentsB[src + 3];
    }

    for (let i = 0; i < scene.gradientCount; i += 1) {
      const src = i * 4;
      const dst = (gradientOffset + i) * 4;
      gradientMetaA.set(scene.gradientMetaA.subarray(src, src + 4), dst);
      gradientMetaB.set(scene.gradientMetaB.subarray(src, src + 4), dst);
      gradientMetaC[dst] = scene.gradientMetaC[src] - scene.gradientMetaB[src] * tx - scene.gradientMetaB[src + 2] * ty;
      gradientMetaC[dst + 1] = scene.gradientMetaC[src + 1] - scene.gradientMetaB[src + 1] * tx - scene.gradientMetaB[src + 3] * ty;
      gradientMetaC[dst + 2] = scene.gradientMetaC[src + 2];
      gradientMetaC[dst + 3] = scene.gradientMetaC[src + 3];
      gradientMetaD.set(scene.gradientMetaD.subarray(src, src + 4), dst);
      gradientMetaE.set(scene.gradientMetaE.subarray(src, src + 4), dst);
      const lutSourceOffset = i * GRADIENT_LUT_WIDTH * 4;
      const lutTargetOffset = (gradientOffset + i) * GRADIENT_LUT_WIDTH * 4;
      gradientLut.set(
        scene.gradientLut.subarray(lutSourceOffset, lutSourceOffset + GRADIENT_LUT_WIDTH * 4),
        lutTargetOffset
      );
    }

    for (let i = 0; i < scene.gradientFillPathCount; i += 1) {
      const src = i * 4;
      const dst = (gradientFillPathOffset + i) * 4;
      gradientFillPathMetaA[dst] = scene.gradientFillPathMetaA[src] + gradientFillSegmentOffset;
      gradientFillPathMetaA[dst + 1] = scene.gradientFillPathMetaA[src + 1];
      gradientFillPathMetaA[dst + 2] = scene.gradientFillPathMetaA[src + 2] + tx;
      gradientFillPathMetaA[dst + 3] = scene.gradientFillPathMetaA[src + 3] + ty;
      gradientFillPathMetaB[dst] = scene.gradientFillPathMetaB[src] + tx;
      gradientFillPathMetaB[dst + 1] = scene.gradientFillPathMetaB[src + 1] + ty;
      gradientFillPathMetaB[dst + 2] = scene.gradientFillPathMetaB[src + 2];
      gradientFillPathMetaB[dst + 3] = scene.gradientFillPathMetaB[src + 3];
      gradientFillPathMetaC.set(scene.gradientFillPathMetaC.subarray(src, src + 4), dst);
      const sourceGradientIndex = scene.gradientFillPaintMeta[src];
      const maskGradientIndex = scene.gradientFillPaintMeta[src + 1];
      gradientFillPaintMeta[dst] = sourceGradientIndex >= 0 ? sourceGradientIndex + gradientOffset : -1;
      gradientFillPaintMeta[dst + 1] = maskGradientIndex >= 0 ? maskGradientIndex + gradientOffset : -1;
      gradientFillPaintMeta[dst + 2] = scene.gradientFillPaintMeta[src + 2];
      gradientFillPaintMeta[dst + 3] = pageRectBase + scene.gradientFillPaintMeta[src + 3];
    }

    for (let i = 0; i < scene.gradientFillSegmentCount; i += 1) {
      const src = i * 4;
      const dst = (gradientFillSegmentOffset + i) * 4;
      gradientFillSegmentsA[dst] = scene.gradientFillSegmentsA[src] + tx;
      gradientFillSegmentsA[dst + 1] = scene.gradientFillSegmentsA[src + 1] + ty;
      gradientFillSegmentsA[dst + 2] = scene.gradientFillSegmentsA[src + 2] + tx;
      gradientFillSegmentsA[dst + 3] = scene.gradientFillSegmentsA[src + 3] + ty;
      gradientFillSegmentsB[dst] = scene.gradientFillSegmentsB[src] + tx;
      gradientFillSegmentsB[dst + 1] = scene.gradientFillSegmentsB[src + 1] + ty;
      gradientFillSegmentsB[dst + 2] = scene.gradientFillSegmentsB[src + 2];
      gradientFillSegmentsB[dst + 3] = scene.gradientFillSegmentsB[src + 3];
    }

    for (let i = 0; i < scene.gradientStrokeRunCount; i += 1) {
      const src = i * 4;
      const dst = (gradientStrokeRunOffset + i) * 4;
      gradientStrokeRunMetaA[dst] = scene.gradientStrokeRunMetaA[src] + gradientStrokeSegmentOffset;
      gradientStrokeRunMetaA[dst + 1] = scene.gradientStrokeRunMetaA[src + 1];
      const sourceGradientIndex = scene.gradientStrokeRunMetaA[src + 2];
      const maskGradientIndex = scene.gradientStrokeRunMetaA[src + 3];
      gradientStrokeRunMetaA[dst + 2] = sourceGradientIndex >= 0 ? sourceGradientIndex + gradientOffset : -1;
      gradientStrokeRunMetaA[dst + 3] = maskGradientIndex >= 0 ? maskGradientIndex + gradientOffset : -1;
      gradientStrokeRunMetaB[dst] = scene.gradientStrokeRunMetaB[src];
      gradientStrokeRunMetaB[dst + 1] = pageRectBase + scene.gradientStrokeRunMetaB[src + 1];
      gradientStrokeRunMetaB[dst + 2] = 0;
      gradientStrokeRunMetaB[dst + 3] = 0;
    }

    for (let i = 0; i < scene.gradientStrokeSegmentCount; i += 1) {
      const src = i * 4;
      const dst = (gradientStrokeSegmentOffset + i) * 4;
      gradientStrokeEndpoints[dst] = scene.gradientStrokeEndpoints[src] + tx;
      gradientStrokeEndpoints[dst + 1] = scene.gradientStrokeEndpoints[src + 1] + ty;
      gradientStrokeEndpoints[dst + 2] = scene.gradientStrokeEndpoints[src + 2] + tx;
      gradientStrokeEndpoints[dst + 3] = scene.gradientStrokeEndpoints[src + 3] + ty;
      gradientStrokePrimitiveMeta[dst] = scene.gradientStrokePrimitiveMeta[src] + tx;
      gradientStrokePrimitiveMeta[dst + 1] = scene.gradientStrokePrimitiveMeta[src + 1] + ty;
      gradientStrokePrimitiveMeta[dst + 2] = scene.gradientStrokePrimitiveMeta[src + 2];
      gradientStrokePrimitiveMeta[dst + 3] = scene.gradientStrokePrimitiveMeta[src + 3];
      gradientStrokePrimitiveBounds[dst] = scene.gradientStrokePrimitiveBounds[src] + tx;
      gradientStrokePrimitiveBounds[dst + 1] = scene.gradientStrokePrimitiveBounds[src + 1] + ty;
      gradientStrokePrimitiveBounds[dst + 2] = scene.gradientStrokePrimitiveBounds[src + 2] + tx;
      gradientStrokePrimitiveBounds[dst + 3] = scene.gradientStrokePrimitiveBounds[src + 3] + ty;
      gradientStrokeStyles.set(scene.gradientStrokeStyles.subarray(src, src + 4), dst);
    }

    for (let i = 0; i < scene.segmentCount; i += 1) {
      const src = i * 4;
      const dst = (segmentOffset + i) * 4;
      endpoints[dst] = scene.endpoints[src] + tx;
      endpoints[dst + 1] = scene.endpoints[src + 1] + ty;
      endpoints[dst + 2] = scene.endpoints[src + 2] + tx;
      endpoints[dst + 3] = scene.endpoints[src + 3] + ty;

      primitiveMeta[dst] = scene.primitiveMeta[src] + tx;
      primitiveMeta[dst + 1] = scene.primitiveMeta[src + 1] + ty;
      primitiveMeta[dst + 2] = scene.primitiveMeta[src + 2];
      primitiveMeta[dst + 3] = scene.primitiveMeta[src + 3];

      primitiveBounds[dst] = scene.primitiveBounds[src] + tx;
      primitiveBounds[dst + 1] = scene.primitiveBounds[src + 1] + ty;
      primitiveBounds[dst + 2] = scene.primitiveBounds[src + 2] + tx;
      primitiveBounds[dst + 3] = scene.primitiveBounds[src + 3] + ty;

      styles[dst] = scene.styles[src];
      styles[dst + 1] = scene.styles[src + 1];
      styles[dst + 2] = scene.styles[src + 2];
      styles[dst + 3] = scene.styles[src + 3];
    }

    textInstanceA.set(scene.textInstanceA, textInstanceOffset * 4);
    textInstanceC.set(scene.textInstanceC, textInstanceOffset * 4);

    for (let i = 0; i < scene.textInstanceCount; i += 1) {
      const src = i * 4;
      const dst = (textInstanceOffset + i) * 4;
      textInstanceB[dst] = scene.textInstanceB[src] + tx;
      textInstanceB[dst + 1] = scene.textInstanceB[src + 1] + ty;
      textInstanceB[dst + 2] = scene.textInstanceB[src + 2] + textGlyphOffset;
      const clipReference = scene.textInstanceB[src + 3];
      textInstanceB[dst + 3] = clipReference > 0
        ? clipReference + textClipRectOffset
        : 0;
    }
    const sceneClipRects = scene.textClipRects;
    if (sceneClipRects) {
      for (let i = 0; i < sceneClipRects.length; i += 4) {
        const dst = textClipRectOffset * 4 + i;
        textClipRects[dst] = sceneClipRects[i] + tx;
        textClipRects[dst + 1] = sceneClipRects[i + 1] + ty;
        textClipRects[dst + 2] = sceneClipRects[i + 2] + tx;
        textClipRects[dst + 3] = sceneClipRects[i + 3] + ty;
      }
      textClipRectOffset += sceneClipRects.length / 4;
    }

    for (let i = 0; i < scene.textGlyphCount; i += 1) {
      const src = i * 4;
      const dst = (textGlyphOffset + i) * 4;
      textGlyphMetaA[dst] = scene.textGlyphMetaA[src] + textGlyphSegmentOffset;
      textGlyphMetaA[dst + 1] = scene.textGlyphMetaA[src + 1];
      textGlyphMetaA[dst + 2] = scene.textGlyphMetaA[src + 2];
      textGlyphMetaA[dst + 3] = scene.textGlyphMetaA[src + 3];

      textGlyphMetaB[dst] = scene.textGlyphMetaB[src];
      textGlyphMetaB[dst + 1] = scene.textGlyphMetaB[src + 1];
      textGlyphMetaB[dst + 2] = scene.textGlyphMetaB[src + 2];
      textGlyphMetaB[dst + 3] = scene.textGlyphMetaB[src + 3];
    }

    textGlyphSegmentsA.set(scene.textGlyphSegmentsA, textGlyphSegmentOffset * 4);
    textGlyphSegmentsB.set(scene.textGlyphSegmentsB, textGlyphSegmentOffset * 4);

    const scenePageRects = scene.pageRects;
    if (scenePageRects.length >= 4) {
      const sceneRectCount = Math.floor(scenePageRects.length / 4);
      const sceneTextRanges = normalizePageTextRangesForScene(scene, sceneRectCount);
      for (let i = 0; i < sceneRectCount; i += 1) {
        const src = i * 4;
        const dst = (pageRectOffset + i) * 4;
        pageRects[dst] = scenePageRects[src] + tx;
        pageRects[dst + 1] = scenePageRects[src + 1] + ty;
        pageRects[dst + 2] = scenePageRects[src + 2] + tx;
        pageRects[dst + 3] = scenePageRects[src + 3] + ty;

        const rangeDst = (pageRectOffset + i) * 2;
        const rangeSrc = i * 2;
        pageTextRanges[rangeDst] = sceneTextRanges[rangeSrc] + textInstanceOffset;
        pageTextRanges[rangeDst + 1] = sceneTextRanges[rangeSrc + 1];
      }
      appendTranslatedTextIndexPages(mergedTextIndexPages, scene, sceneRectCount, tx, ty, textInstanceOffset);
      pageRectOffset += sceneRectCount;
    } else {
      const dst = pageRectOffset * 4;
      pageRects[dst] = scene.pageBounds.minX + tx;
      pageRects[dst + 1] = scene.pageBounds.minY + ty;
      pageRects[dst + 2] = scene.pageBounds.maxX + tx;
      pageRects[dst + 3] = scene.pageBounds.maxY + ty;
      const rangeDst = pageRectOffset * 2;
      pageTextRanges[rangeDst] = textInstanceOffset;
      pageTextRanges[rangeDst + 1] = scene.textInstanceCount;
      appendTranslatedTextIndexPages(mergedTextIndexPages, scene, 1, tx, ty, textInstanceOffset);
      pageRectOffset += 1;
    }

    combinedBounds = combineBounds(combinedBounds, offsetBounds(scene.bounds, tx, ty));
    combinedPageBounds = combineBounds(combinedPageBounds, offsetBounds(scene.pageBounds, tx, ty));

    for (const layer of listSceneRasterLayers(scene)) {
      if (layer.matrix.length < 6) {
        continue;
      }

      const matrix = new Float32Array(6);
      matrix[0] = layer.matrix[0];
      matrix[1] = layer.matrix[1];
      matrix[2] = layer.matrix[2];
      matrix[3] = layer.matrix[3];
      matrix[4] = layer.matrix[4] + tx;
      matrix[5] = layer.matrix[5] + ty;
      rasterLayers.push({
        width: layer.width,
        height: layer.height,
        data: layer.data,
        matrix,
        paintOrder: layer.paintOrder,
        pageIndex: pageRectBase + layer.pageIndex
      });
    }

    fillPathOffset += scene.fillPathCount;
    fillSegmentOffset += scene.fillSegmentCount;
    gradientOffset += scene.gradientCount;
    gradientFillPathOffset += scene.gradientFillPathCount;
    gradientFillSegmentOffset += scene.gradientFillSegmentCount;
    gradientStrokeRunOffset += scene.gradientStrokeRunCount;
    gradientStrokeSegmentOffset += scene.gradientStrokeSegmentCount;
    segmentOffset += scene.segmentCount;
    textInstanceOffset += scene.textInstanceCount;
    textGlyphOffset += scene.textGlyphCount;
    textGlyphSegmentOffset += scene.textGlyphSegmentCount;
  }

  const primaryRasterLayer = rasterLayers[0] ?? null;

  const composedScene: VectorScene = {
    pageCount: pageScenes.length,
    pagesPerRow,
    pageRects,
    pageTextRanges,
    textIndex: hasAnyTextIndex ? { version: 2, pages: mergedTextIndexPages } : null,
    fillPathCount: totalFillPathCount,
    fillSegmentCount: totalFillSegmentCount,
    fillPathMetaA,
    fillPathMetaB,
    fillPathMetaC,
    fillSegmentsA,
    fillSegmentsB,
    gradientCount: totalGradientCount,
    gradientMetaA,
    gradientMetaB,
    gradientMetaC,
    gradientMetaD,
    gradientMetaE,
    gradientLut,
    gradientFillPathCount: totalGradientFillPathCount,
    gradientFillSegmentCount: totalGradientFillSegmentCount,
    gradientFillPathMetaA,
    gradientFillPathMetaB,
    gradientFillPathMetaC,
    gradientFillPaintMeta,
    gradientFillSegmentsA,
    gradientFillSegmentsB,
    gradientStrokeRunCount: totalGradientStrokeRunCount,
    gradientStrokeSegmentCount: totalGradientStrokeSegmentCount,
    gradientStrokeRunMetaA,
    gradientStrokeRunMetaB,
    gradientStrokeEndpoints,
    gradientStrokePrimitiveMeta,
    gradientStrokePrimitiveBounds,
    gradientStrokeStyles,
    segmentCount: totalSegmentCount,
    sourceSegmentCount: totalSourceSegmentCount,
    mergedSegmentCount: totalMergedSegmentCount,
    ...(pageScenes.every((scene) => scene.imageLayerSegmentCount !== undefined)
      ? { imageLayerSegmentCount: pageScenes.reduce((sum, scene) => sum + scene.imageLayerSegmentCount!, 0) }
      : {}),
    ...(pageScenes.every((scene) => scene.operatorCountKind === "native-estimate")
      ? { operatorCountKind: "native-estimate" as const }
      : pageScenes.some((scene) => scene.operatorCountKind !== undefined)
        ? { operatorCountKind: "mixed" as const } : {}),
    sourceTextCount: totalSourceTextCount,
    textInstanceCount: totalTextInstanceCount,
    textGlyphCount: totalTextGlyphCount,
    textGlyphSegmentCount: totalTextGlyphSegmentCount,
    textInPageCount: totalTextInPageCount,
    textOutOfPageCount: totalTextOutOfPageCount,
    textInstanceA,
    textInstanceB,
    textInstanceC,
    ...(textClipRects.length === 0 ? {} : { textClipRects }),
    textGlyphMetaA,
    textGlyphMetaB,
    textGlyphSegmentsA,
    textGlyphSegmentsB,
    rasterLayers,
    rasterLayerWidth: primaryRasterLayer?.width ?? 0,
    rasterLayerHeight: primaryRasterLayer?.height ?? 0,
    rasterLayerData: primaryRasterLayer?.data ?? new Uint8Array(0),
    rasterLayerMatrix: primaryRasterLayer?.matrix ?? new Float32Array([1, 0, 0, 1, 0, 0]),
    endpoints,
    primitiveMeta,
    primitiveBounds,
    styles,
    bounds: combinedBounds ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    pageBounds: combinedPageBounds ?? combinedBounds ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    maxHalfWidth,
    imagePaintOpCount: totalImagePaintOpCount,
    operatorCount: totalOperatorCount,
    pathCount: totalPathCount,
    discardedTransparentCount: totalDiscardedTransparentCount,
    discardedDegenerateCount: totalDiscardedDegenerateCount,
    discardedDuplicateCount: totalDiscardedDuplicateCount,
    discardedContainedCount: totalDiscardedContainedCount
  };

  if (hasTextContent) {
    composedScene.textContent = combinedTextContent;
  }

  return optimizeVectorSceneTextGlyphs(composedScene);
}

function appendTranslatedTextIndexPages(
  target: PageTextIndex[],
  scene: VectorScene,
  rectCount: number,
  tx: number,
  ty: number,
  textInstanceOffset: number
): void {
  const sourcePages = scene.textIndex?.pages ?? [];
  for (let i = 0; i < rectCount; i += 1) {
    const page = sourcePages[i];
    if (page && page.text.length > 0) {
      target.push(offsetPageTextIndex(page, tx, ty, textInstanceOffset));
    } else {
      target.push({ text: "", charInstance: new Int32Array(0), fallbackQuads: new Float32Array(0) });
    }
  }
}

function offsetPageTextIndex(page: PageTextIndex, tx: number, ty: number, instanceOffset: number): PageTextIndex {
  // Copy instead of mutating: cached page scenes get re-composed at other
  // pagesPerRow layouts, so the source data must stay untranslated.
  const charInstance = new Int32Array(page.charInstance.length);
  for (let i = 0; i < charInstance.length; i += 1) {
    const ref = page.charInstance[i];
    charInstance[i] = ref >= 0 ? ref + instanceOffset : ref;
  }

  const source = page.fallbackQuads;
  const fallbackQuads = new Float32Array(source.length);
  for (let i = 0; i + 3 < source.length; i += 4) {
    fallbackQuads[i] = source[i] + tx;
    fallbackQuads[i + 1] = source[i + 1] + ty;
    fallbackQuads[i + 2] = source[i + 2] + tx;
    fallbackQuads[i + 3] = source[i + 3] + ty;
  }
  return { text: page.text, charInstance, fallbackQuads };
}

export function optimizeVectorSceneTextGlyphs(scene: VectorScene): VectorScene {
  const glyphCount = Math.max(0, scene.textGlyphCount | 0);
  const glyphSegmentCount = Math.max(0, scene.textGlyphSegmentCount | 0);
  if (
    glyphCount <= 1 ||
    glyphSegmentCount <= 0 ||
    scene.textGlyphMetaA.length < glyphCount * 4 ||
    scene.textGlyphMetaB.length < glyphCount * 4
  ) {
    return scene;
  }

  const segmentWordsA = new Uint32Array(
    scene.textGlyphSegmentsA.buffer,
    scene.textGlyphSegmentsA.byteOffset,
    scene.textGlyphSegmentsA.length
  );
  const segmentWordsB = new Uint32Array(
    scene.textGlyphSegmentsB.buffer,
    scene.textGlyphSegmentsB.byteOffset,
    scene.textGlyphSegmentsB.length
  );
  const metaWordsA = new Uint32Array(scene.textGlyphMetaA.buffer, scene.textGlyphMetaA.byteOffset, scene.textGlyphMetaA.length);
  const metaWordsB = new Uint32Array(scene.textGlyphMetaB.buffer, scene.textGlyphMetaB.byteOffset, scene.textGlyphMetaB.length);

  const remap = new Uint32Array(glyphCount);
  const uniqueOldGlyphIndices: number[] = [];
  const candidatesByHash = new Map<string, number[]>();
  const dedupGlyphMetaA = new Float4Builder(Math.min(glyphCount, 4096));
  const dedupGlyphMetaB = new Float4Builder(Math.min(glyphCount, 4096));
  const dedupGlyphSegmentsA = new Float4Builder(Math.min(glyphSegmentCount, 65_536));
  const dedupGlyphSegmentsB = new Float4Builder(Math.min(glyphSegmentCount, 65_536));

  for (let glyphIndex = 0; glyphIndex < glyphCount; glyphIndex += 1) {
    const hash = hashTextGlyph(scene, glyphIndex, metaWordsA, metaWordsB, segmentWordsA, segmentWordsB);
    const candidates = candidatesByHash.get(hash);
    let uniqueIndex = -1;

    if (candidates) {
      for (const candidateUniqueIndex of candidates) {
        if (textGlyphsEqual(scene, glyphIndex, uniqueOldGlyphIndices[candidateUniqueIndex])) {
          uniqueIndex = candidateUniqueIndex;
          break;
        }
      }
    }

    if (uniqueIndex < 0) {
      uniqueIndex = uniqueOldGlyphIndices.length;
      uniqueOldGlyphIndices.push(glyphIndex);
      if (candidates) {
        candidates.push(uniqueIndex);
      } else {
        candidatesByHash.set(hash, [uniqueIndex]);
      }

      const metaOffset = glyphIndex * 4;
      const segmentStart = Math.max(0, Math.trunc(scene.textGlyphMetaA[metaOffset]));
      const segmentCount = Math.max(0, Math.trunc(scene.textGlyphMetaA[metaOffset + 1]));
      const segmentFloatStart = segmentStart * 4;
      const segmentFloatCount = Math.min(
        segmentCount * 4,
        Math.max(0, scene.textGlyphSegmentsA.length - segmentFloatStart),
        Math.max(0, scene.textGlyphSegmentsB.length - segmentFloatStart)
      );
      const nextSegmentStart = dedupGlyphSegmentsA.quadCount;
      dedupGlyphSegmentsA.append(scene.textGlyphSegmentsA, segmentFloatStart, segmentFloatCount);
      dedupGlyphSegmentsB.append(scene.textGlyphSegmentsB, segmentFloatStart, segmentFloatCount);
      dedupGlyphMetaA.push(
        nextSegmentStart,
        segmentFloatCount / 4,
        scene.textGlyphMetaA[metaOffset + 2],
        scene.textGlyphMetaA[metaOffset + 3]
      );
      dedupGlyphMetaB.push(
        scene.textGlyphMetaB[metaOffset],
        scene.textGlyphMetaB[metaOffset + 1],
        scene.textGlyphMetaB[metaOffset + 2],
        scene.textGlyphMetaB[metaOffset + 3]
      );
    }

    remap[glyphIndex] = uniqueIndex;
  }

  if (uniqueOldGlyphIndices.length === glyphCount) {
    return scene;
  }

  const textInstanceB = scene.textInstanceB;
  for (let i = 0; i < scene.textInstanceCount; i += 1) {
    const offset = i * 4 + 2;
    const oldGlyphIndex = Math.max(0, Math.trunc(textInstanceB[offset]));
    if (oldGlyphIndex < remap.length) {
      textInstanceB[offset] = remap[oldGlyphIndex];
    }
  }

  return {
    ...scene,
    textInstanceB,
    textGlyphCount: uniqueOldGlyphIndices.length,
    textGlyphSegmentCount: dedupGlyphSegmentsA.quadCount,
    textGlyphMetaA: dedupGlyphMetaA.toTypedArray(),
    textGlyphMetaB: dedupGlyphMetaB.toTypedArray(),
    textGlyphSegmentsA: dedupGlyphSegmentsA.toTypedArray(),
    textGlyphSegmentsB: dedupGlyphSegmentsB.toTypedArray()
  };
}

export function inferPageTextRanges(
  pageRects: Float32Array,
  textInstanceB: Float32Array,
  textInstanceCount: number
): Uint32Array {
  const pageCount = Math.max(1, Math.floor(pageRects.length / 4));
  const ranges = new Uint32Array(pageCount * 2);
  const instanceCount = Math.max(0, Math.min(textInstanceCount | 0, Math.floor(textInstanceB.length / 4)));

  if (pageCount <= 1 || instanceCount <= 0) {
    ranges[0] = 0;
    ranges[1] = instanceCount;
    return ranges;
  }

  const margin = computePageTextRangeMargin(pageRects, pageCount);
  let currentPage = 0;
  let rangeStart = 0;

  for (let i = 0; i < instanceCount; i += 1) {
    const offset = i * 4;
    const x = textInstanceB[offset];
    const y = textInstanceB[offset + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y) || pointInPageRect(pageRects, currentPage, x, y, margin)) {
      continue;
    }

    const nextPage = findContainingPageFrom(pageRects, pageCount, currentPage + 1, x, y, margin);
    if (nextPage <= currentPage) {
      continue;
    }

    ranges[currentPage * 2] = rangeStart;
    ranges[currentPage * 2 + 1] = i - rangeStart;
    for (let pageIndex = currentPage + 1; pageIndex < nextPage; pageIndex += 1) {
      ranges[pageIndex * 2] = i;
      ranges[pageIndex * 2 + 1] = 0;
    }
    currentPage = nextPage;
    rangeStart = i;
  }

  ranges[currentPage * 2] = rangeStart;
  ranges[currentPage * 2 + 1] = instanceCount - rangeStart;
  for (let pageIndex = currentPage + 1; pageIndex < pageCount; pageIndex += 1) {
    ranges[pageIndex * 2] = instanceCount;
    ranges[pageIndex * 2 + 1] = 0;
  }

  return ranges;
}

function normalizePageTextRangesForScene(scene: VectorScene, requestedPageCount?: number): Uint32Array {
  const inferredPageCount = Math.floor(scene.pageRects.length / 4) || scene.pageCount || 1;
  const pageCount = Math.max(1, requestedPageCount ?? inferredPageCount);
  const expectedLength = pageCount * 2;
  if (scene.pageTextRanges instanceof Uint32Array && scene.pageTextRanges.length >= expectedLength) {
    return scene.pageTextRanges.subarray(0, expectedLength);
  }
  return inferPageTextRanges(scene.pageRects, scene.textInstanceB, scene.textInstanceCount);
}

function hashTextGlyph(
  scene: VectorScene,
  glyphIndex: number,
  metaWordsA: Uint32Array,
  metaWordsB: Uint32Array,
  segmentWordsA: Uint32Array,
  segmentWordsB: Uint32Array
): string {
  const metaOffset = glyphIndex * 4;
  const segmentStart = Math.max(0, Math.trunc(scene.textGlyphMetaA[metaOffset]));
  const segmentCount = Math.max(0, Math.trunc(scene.textGlyphMetaA[metaOffset + 1]));
  const segmentWordStart = segmentStart * 4;
  const segmentWordCount = Math.min(
    segmentCount * 4,
    Math.max(0, segmentWordsA.length - segmentWordStart),
    Math.max(0, segmentWordsB.length - segmentWordStart)
  );

  let hash = 2166136261;
  hash = fnv1aAdd(hash, segmentCount);
  hash = fnv1aAdd(hash, metaWordsA[metaOffset + 2] ?? 0);
  hash = fnv1aAdd(hash, metaWordsA[metaOffset + 3] ?? 0);
  hash = fnv1aAdd(hash, metaWordsB[metaOffset] ?? 0);
  hash = fnv1aAdd(hash, metaWordsB[metaOffset + 1] ?? 0);

  for (let i = 0; i < segmentWordCount; i += 1) {
    hash = fnv1aAdd(hash, segmentWordsA[segmentWordStart + i]);
    hash = fnv1aAdd(hash, segmentWordsB[segmentWordStart + i]);
  }

  return `${segmentCount}:${hash >>> 0}`;
}

function textGlyphsEqual(scene: VectorScene, glyphA: number, glyphB: number): boolean {
  if (glyphA === glyphB) {
    return true;
  }

  const metaOffsetA = glyphA * 4;
  const metaOffsetB = glyphB * 4;
  const segmentCountA = Math.max(0, Math.trunc(scene.textGlyphMetaA[metaOffsetA + 1]));
  const segmentCountB = Math.max(0, Math.trunc(scene.textGlyphMetaA[metaOffsetB + 1]));
  if (segmentCountA !== segmentCountB) {
    return false;
  }

  if (
    scene.textGlyphMetaA[metaOffsetA + 2] !== scene.textGlyphMetaA[metaOffsetB + 2] ||
    scene.textGlyphMetaA[metaOffsetA + 3] !== scene.textGlyphMetaA[metaOffsetB + 3] ||
    scene.textGlyphMetaB[metaOffsetA] !== scene.textGlyphMetaB[metaOffsetB] ||
    scene.textGlyphMetaB[metaOffsetA + 1] !== scene.textGlyphMetaB[metaOffsetB + 1] ||
    scene.textGlyphMetaB[metaOffsetA + 2] !== scene.textGlyphMetaB[metaOffsetB + 2] ||
    scene.textGlyphMetaB[metaOffsetA + 3] !== scene.textGlyphMetaB[metaOffsetB + 3]
  ) {
    return false;
  }

  const segmentStartA = Math.max(0, Math.trunc(scene.textGlyphMetaA[metaOffsetA]));
  const segmentStartB = Math.max(0, Math.trunc(scene.textGlyphMetaA[metaOffsetB]));
  const segmentFloatStartA = segmentStartA * 4;
  const segmentFloatStartB = segmentStartB * 4;
  const segmentFloatCount = segmentCountA * 4;
  for (let i = 0; i < segmentFloatCount; i += 1) {
    if (
      scene.textGlyphSegmentsA[segmentFloatStartA + i] !== scene.textGlyphSegmentsA[segmentFloatStartB + i] ||
      scene.textGlyphSegmentsB[segmentFloatStartA + i] !== scene.textGlyphSegmentsB[segmentFloatStartB + i]
    ) {
      return false;
    }
  }

  return true;
}

function fnv1aAdd(hash: number, value: number): number {
  hash ^= value >>> 0;
  return Math.imul(hash, 16777619);
}

function computePageTextRangeMargin(pageRects: Float32Array, pageCount: number): number {
  let extentSum = 0;
  let extentCount = 0;
  for (let i = 0; i < pageCount; i += 1) {
    const offset = i * 4;
    const width = Math.abs(pageRects[offset + 2] - pageRects[offset]);
    const height = Math.abs(pageRects[offset + 3] - pageRects[offset + 1]);
    const extent = Math.max(width, height);
    if (Number.isFinite(extent) && extent > 0) {
      extentSum += extent;
      extentCount += 1;
    }
  }
  if (extentCount === 0) {
    return 8;
  }
  return clampNumber(extentSum / extentCount * 0.025, 4, 24);
}

function findContainingPageFrom(
  pageRects: Float32Array,
  pageCount: number,
  startPage: number,
  x: number,
  y: number,
  margin: number
): number {
  for (let pageIndex = Math.max(0, startPage); pageIndex < pageCount; pageIndex += 1) {
    if (pointInPageRect(pageRects, pageIndex, x, y, margin)) {
      return pageIndex;
    }
  }
  return -1;
}

function pointInPageRect(pageRects: Float32Array, pageIndex: number, x: number, y: number, margin: number): boolean {
  const offset = pageIndex * 4;
  const x0 = Math.min(pageRects[offset], pageRects[offset + 2]) - margin;
  const x1 = Math.max(pageRects[offset], pageRects[offset + 2]) + margin;
  const y0 = Math.min(pageRects[offset + 1], pageRects[offset + 3]) - margin;
  const y1 = Math.max(pageRects[offset + 1], pageRects[offset + 3]) + margin;
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

function clampNumber(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function computeGridPlacements(pageScenes: VectorScene[], pagesPerRow: number): PagePlacement[] {
  const pageBoundsList = pageScenes.map((scene) => normalizeSceneBounds(scene.pageBounds, scene.bounds));
  const rowCount = Math.ceil(pageScenes.length / pagesPerRow);
  const rowHeights = new Float64Array(rowCount);
  let extentSum = 0;

  for (let i = 0; i < pageBoundsList.length; i += 1) {
    const bounds = pageBoundsList[i];
    const width = Math.max(bounds.maxX - bounds.minX, 1e-3);
    const height = Math.max(bounds.maxY - bounds.minY, 1e-3);
    extentSum += Math.max(width, height);
    const row = Math.floor(i / pagesPerRow);
    rowHeights[row] = Math.max(rowHeights[row], height);
  }

  const averageExtent = extentSum / Math.max(1, pageBoundsList.length);
  const gap = Math.max(averageExtent * PAGE_GRID_GAP_FACTOR, PAGE_GRID_MIN_GAP);
  const rowTop = new Float64Array(rowCount);
  for (let row = 1; row < rowCount; row += 1) {
    rowTop[row] = rowTop[row - 1] - rowHeights[row - 1] - gap;
  }

  const rowCursorX = new Float64Array(rowCount);
  const placements: PagePlacement[] = new Array(pageScenes.length);
  for (let i = 0; i < pageBoundsList.length; i += 1) {
    const bounds = pageBoundsList[i];
    const width = Math.max(bounds.maxX - bounds.minX, 1e-3);
    const row = Math.floor(i / pagesPerRow);
    const translateX = rowCursorX[row] - bounds.minX;
    const translateY = rowTop[row] - bounds.maxY;
    placements[i] = { translateX, translateY };
    rowCursorX[row] += width + gap;
  }

  return placements;
}

function normalizeSceneBounds(primary: Bounds, fallback: Bounds): Bounds {
  const source = isFiniteBounds(primary) ? primary : fallback;
  if (isFiniteBounds(source)) {
    return source;
  }
  return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
}

function isFiniteBounds(bounds: Bounds): boolean {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.maxY)
  );
}

function offsetBounds(bounds: Bounds, tx: number, ty: number): Bounds {
  return {
    minX: bounds.minX + tx,
    minY: bounds.minY + ty,
    maxX: bounds.maxX + tx,
    maxY: bounds.maxY + ty
  };
}

function listSceneRasterLayers(scene: VectorScene): RasterLayer[] {
  const out: RasterLayer[] = [];
  if (Array.isArray(scene.rasterLayers)) {
    for (const layer of scene.rasterLayers) {
      const width = Math.max(0, Math.trunc(layer?.width ?? 0));
      const height = Math.max(0, Math.trunc(layer?.height ?? 0));
      if (width <= 0 || height <= 0 || !(layer.data instanceof Uint8Array) || layer.data.length < width * height * 4) {
        continue;
      }

      const matrix = new Float32Array(6);
      if (layer.matrix.length >= 6) {
        matrix[0] = layer.matrix[0];
        matrix[1] = layer.matrix[1];
        matrix[2] = layer.matrix[2];
        matrix[3] = layer.matrix[3];
        matrix[4] = layer.matrix[4];
        matrix[5] = layer.matrix[5];
      } else {
        matrix[0] = 1;
        matrix[3] = 1;
      }

      out.push({
        width,
        height,
        data: layer.data,
        matrix,
        paintOrder: Number.isFinite(layer.paintOrder) ? layer.paintOrder : 0,
        pageIndex: Number.isFinite(layer.pageIndex) ? Math.max(0, Math.trunc(layer.pageIndex)) : 0
      });
    }
  }

  if (out.length > 0) {
    return out;
  }

  const legacyWidth = Math.max(0, Math.trunc(scene.rasterLayerWidth));
  const legacyHeight = Math.max(0, Math.trunc(scene.rasterLayerHeight));
  if (legacyWidth <= 0 || legacyHeight <= 0 || scene.rasterLayerData.length < legacyWidth * legacyHeight * 4) {
    return out;
  }

  const matrix = new Float32Array([1, 0, 0, 1, 0, 0]);
  if (scene.rasterLayerMatrix.length >= 6) {
    matrix[0] = scene.rasterLayerMatrix[0];
    matrix[1] = scene.rasterLayerMatrix[1];
    matrix[2] = scene.rasterLayerMatrix[2];
    matrix[3] = scene.rasterLayerMatrix[3];
    matrix[4] = scene.rasterLayerMatrix[4];
    matrix[5] = scene.rasterLayerMatrix[5];
  }
  out.push({
    width: legacyWidth,
    height: legacyHeight,
    data: scene.rasterLayerData,
    matrix,
    paintOrder: 0,
    pageIndex: 0
  });
  return out;
}

function createEmptyVectorScene(): VectorScene {
  return {
    pageCount: 0,
    pagesPerRow: 1,
    pageRects: new Float32Array(0),
    pageTextRanges: new Uint32Array(0),
    textIndex: null,
    fillPathCount: 0,
    fillSegmentCount: 0,
    fillPathMetaA: new Float32Array(0),
    fillPathMetaB: new Float32Array(0),
    fillPathMetaC: new Float32Array(0),
    fillSegmentsA: new Float32Array(0),
    fillSegmentsB: new Float32Array(0),
    gradientCount: 0,
    gradientMetaA: new Float32Array(0),
    gradientMetaB: new Float32Array(0),
    gradientMetaC: new Float32Array(0),
    gradientMetaD: new Float32Array(0),
    gradientMetaE: new Float32Array(0),
    gradientLut: new Uint8Array(0),
    gradientFillPathCount: 0,
    gradientFillSegmentCount: 0,
    gradientFillPathMetaA: new Float32Array(0),
    gradientFillPathMetaB: new Float32Array(0),
    gradientFillPathMetaC: new Float32Array(0),
    gradientFillPaintMeta: new Float32Array(0),
    gradientFillSegmentsA: new Float32Array(0),
    gradientFillSegmentsB: new Float32Array(0),
    gradientStrokeRunCount: 0,
    gradientStrokeSegmentCount: 0,
    gradientStrokeRunMetaA: new Float32Array(0),
    gradientStrokeRunMetaB: new Float32Array(0),
    gradientStrokeEndpoints: new Float32Array(0),
    gradientStrokePrimitiveMeta: new Float32Array(0),
    gradientStrokePrimitiveBounds: new Float32Array(0),
    gradientStrokeStyles: new Float32Array(0),
    segmentCount: 0,
    sourceSegmentCount: 0,
    mergedSegmentCount: 0,
    sourceTextCount: 0,
    textInstanceCount: 0,
    textGlyphCount: 0,
    textGlyphSegmentCount: 0,
    textInPageCount: 0,
    textOutOfPageCount: 0,
    textInstanceA: new Float32Array(0),
    textInstanceB: new Float32Array(0),
    textInstanceC: new Float32Array(0),
    textGlyphMetaA: new Float32Array(0),
    textGlyphMetaB: new Float32Array(0),
    textGlyphSegmentsA: new Float32Array(0),
    textGlyphSegmentsB: new Float32Array(0),
    rasterLayers: [],
    rasterLayerWidth: 0,
    rasterLayerHeight: 0,
    rasterLayerData: new Uint8Array(0),
    rasterLayerMatrix: new Float32Array([1, 0, 0, 1, 0, 0]),
    endpoints: new Float32Array(0),
    primitiveMeta: new Float32Array(0),
    primitiveBounds: new Float32Array(0),
    styles: new Float32Array(0),
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    pageBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    maxHalfWidth: 0,
    imagePaintOpCount: 0,
    operatorCount: 0,
    pathCount: 0,
    discardedTransparentCount: 0,
    discardedDegenerateCount: 0,
    discardedDuplicateCount: 0,
    discardedContainedCount: 0
  };
}

function normalizePositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Math.trunc(Number(value));
  const valid = Number.isFinite(parsed) ? parsed : fallback;
  if (valid < min) {
    return min;
  }
  if (valid > max) {
    return max;
  }
  return valid;
}

function resolvePdfPageNumbers(pdfPageCount: number, pages: string | undefined): number[] {
  if (pages !== undefined && typeof pages !== "string") {
    throw new TypeError("pages must be a string.");
  }
  const selection = pages?.trim() ?? "";
  if (selection.length === 0) {
    return Array.from({ length: pdfPageCount }, (_value, index) => index + 1);
  }

  const seen = new Set<number>();
  for (const rawPart of selection.split(",")) {
    const part = rawPart.trim();
    const singlePageMatch = /^(\d+)$/.exec(part);
    const rangeMatch = /^(\d*)\s*-\s*(\d*)$/.exec(part);
    if (!singlePageMatch && !rangeMatch) {
      throw new RangeError(
        `Invalid pages value "${pages}". Use comma-separated page numbers or inclusive ranges such as "1-5, 8, 11-13".`
      );
    }

    const firstPage = singlePageMatch
      ? Number(singlePageMatch[1])
      : rangeMatch?.[1]
        ? Number(rangeMatch[1])
        : 1;
    const lastPage = singlePageMatch
      ? firstPage
      : rangeMatch?.[2]
        ? Number(rangeMatch[2])
        : pdfPageCount;
    if (!Number.isSafeInteger(firstPage) || !Number.isSafeInteger(lastPage)) {
      throw new RangeError(`Invalid page range "${part}": page numbers must be safe integers.`);
    }
    if (firstPage < 1 || firstPage > pdfPageCount || lastPage < 1 || lastPage > pdfPageCount) {
      const invalidPage = firstPage < 1 || firstPage > pdfPageCount ? firstPage : lastPage;
      throw new RangeError(
        `PDF page number ${invalidPage} is out of range; the document contains ${pdfPageCount} page${pdfPageCount === 1 ? "" : "s"}.`
      );
    }
    if (firstPage > lastPage) {
      throw new RangeError(`Invalid page range "${part}": the first page must not exceed the last page.`);
    }

    for (let pageNumber = firstPage; pageNumber <= lastPage; pageNumber += 1) {
      seen.add(pageNumber);
    }
  }

  return Array.from(seen).sort((left, right) => left - right);
}

function transformBounds(bounds: Bounds, matrix: Mat2D): Bounds {
  const p0 = applyMatrix(matrix, bounds.minX, bounds.minY);
  const p1 = applyMatrix(matrix, bounds.minX, bounds.maxY);
  const p2 = applyMatrix(matrix, bounds.maxX, bounds.minY);
  const p3 = applyMatrix(matrix, bounds.maxX, bounds.maxY);

  return {
    minX: Math.min(p0[0], p1[0], p2[0], p3[0]),
    minY: Math.min(p0[1], p1[1], p2[1], p3[1]),
    maxX: Math.max(p0[0], p1[0], p2[0], p3[0]),
    maxY: Math.max(p0[1], p1[1], p2[1], p3[1])
  };
}

function boundsNearlyEqual(a: Bounds, b: Bounds, epsilon = boundsComparisonTolerance(a, b)): boolean {
  return (
    Math.abs(a.minX - b.minX) <= epsilon &&
    Math.abs(a.minY - b.minY) <= epsilon &&
    Math.abs(a.maxX - b.maxX) <= epsilon &&
    Math.abs(a.maxY - b.maxY) <= epsilon
  );
}

function boundsComparisonTolerance(a: Bounds, b: Bounds): number {
  const width = Math.max(Math.abs(a.maxX - a.minX), Math.abs(b.maxX - b.minX));
  const height = Math.max(Math.abs(a.maxY - a.minY), Math.abs(b.maxY - b.minY));
  return Math.max(1e-3, Math.max(width, height) * 1e-5);
}

function combineBounds(primary: Bounds | null, secondary: Bounds | null): Bounds | null {
  if (!primary && !secondary) {
    return null;
  }
  if (!primary && secondary) {
    return { ...secondary };
  }
  if (primary && !secondary) {
    return { ...primary };
  }

  const a = primary as Bounds;
  const b = secondary as Bounds;

  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY)
  };
}

function applyMatrix(m: Mat2D, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function clamp01(value: number): number {
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}
