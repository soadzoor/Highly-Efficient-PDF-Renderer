import { createLoadProgressReporter, type LoadProgressCallback } from "./loadProgress";
import { assertPdfBytes } from "./pdfSignature";

const pdfJsModule = (
  typeof window === "undefined"
    ? await import("pdfjs-dist/legacy/build/pdf.mjs")
    : await import("pdfjs-dist")
) as {
  getDocument: typeof import("pdfjs-dist").getDocument;
  OPS: typeof import("pdfjs-dist").OPS;
  VerbosityLevel: typeof import("pdfjs-dist").VerbosityLevel;
};

const { getDocument, OPS, VerbosityLevel } = pdfJsModule;

const DRAW_MOVE_TO = 0;
const DRAW_LINE_TO = 1;
const DRAW_CURVE_TO = 2;
const DRAW_QUAD_TO = 3;
const DRAW_CLOSE = 4;

type Mat2D = [number, number, number, number, number, number];
type RgbColor = [number, number, number];

interface GraphicsState {
  matrix: Mat2D;
  clipBounds: Bounds | null;
  clipMask: ClipMask | null;
  groupFillAlpha: number;
  groupStrokeAlpha: number;
  groupFillAlphaVersion: number;
  groupStrokeAlphaVersion: number;
  fillAlphaVersion: number;
  strokeAlphaVersion: number;
  lineWidth: number;
  lineCap: number;
  lineDash: number[];
  dashPhase: number;
  strokeR: number;
  strokeG: number;
  strokeB: number;
  strokeAlpha: number;
  fillR: number;
  fillG: number;
  fillB: number;
  fillAlpha: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface ClipMask {
  bounds: Bounds;
  exclusionBounds: Bounds[];
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
 * One text string extracted from a PDF page via pdf.js `getTextContent()`, with its
 * axis-aligned bounding box in composed scene coordinates (Y-up, same space as
 * `VectorScene.endpoints`).
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
  sourceTextCount: number;
  textInstanceCount: number;
  textGlyphCount: number;
  textGlyphSegmentCount: number;
  textInPageCount: number;
  textOutOfPageCount: number;
  textInstanceA: Float32Array;
  textInstanceB: Float32Array;
  textInstanceC: Float32Array;
  textGlyphMetaA: Float32Array;
  textGlyphMetaB: Float32Array;
  textGlyphSegmentsA: Float32Array;
  textGlyphSegmentsB: Float32Array;
  rasterLayers: RasterLayer[];
  // Legacy single-layer fields kept for backward compatibility with old parsed-data ZIPs.
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
  imagePaintOpCount: number;
  pathCount: number;
  discardedTransparentCount: number;
  discardedDegenerateCount: number;
  discardedDuplicateCount: number;
  discardedContainedCount: number;
  /**
   * Text strings with scene-space bounding boxes, present only when extracted from a PDF
   * source with `extractTextContent` enabled (parsed-zip sources do not carry strings).
   */
  textContent?: SceneTextItem[];
}

export interface VectorExtractOptions {
  enableSegmentMerge?: boolean;
  enableInvisibleCull?: boolean;
  /** One-based PDF page selection such as `"1-5, 8, 11-13"`. */
  pages?: string;
  maxPagesPerRow?: number;
  onProgress?: LoadProgressCallback;
  /** Also extract text strings with positions via pdf.js `getTextContent()`. Default false. */
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

/** Pen-position jump (in em units) treated as a word/line break in the text index. */
const TEXT_INDEX_GAP_EM_FACTOR = 0.25;
/** Fallback glyph box (em units, +y up) for glyphs without atlas ink bounds. */
const TEXT_INDEX_FALLBACK_DESCENT = -0.25;
const TEXT_INDEX_FALLBACK_ASCENT = 0.85;

class PageTextIndexBuilder {
  private readonly chars: string[] = [];

  private readonly instanceRefs: number[] = [];

  private readonly fallbackQuads = new Float4Builder(1_024);

  private prevEndX = 0;

  private prevEndY = 0;

  private prevEmHeight = 0;

  private hasPrev = false;

  private separatorPending = false;

  appendSeparator(): void {
    this.separatorPending = true;
  }

  appendGlyph(
    unicode: string,
    quad: Bounds,
    penStartX: number,
    penStartY: number,
    penEndX: number,
    penEndY: number,
    emHeight: number,
    instanceIndex: number
  ): void {
    const needsFallbackQuad = instanceIndex < 0;
    if (
      !Number.isFinite(penStartX) ||
      !Number.isFinite(penStartY) ||
      (needsFallbackQuad &&
        (!Number.isFinite(quad.minX) ||
          !Number.isFinite(quad.minY) ||
          !Number.isFinite(quad.maxX) ||
          !Number.isFinite(quad.maxY)))
    ) {
      this.separatorPending = true;
      return;
    }

    if (this.hasPrev && !this.separatorPending) {
      const gap = Math.hypot(penStartX - this.prevEndX, penStartY - this.prevEndY);
      if (gap > TEXT_INDEX_GAP_EM_FACTOR * Math.max(emHeight, this.prevEmHeight, 1e-6)) {
        this.separatorPending = true;
      }
    }

    if (this.separatorPending && this.chars.length > 0) {
      this.chars.push(" ");
      this.instanceRefs.push(-1);
    }
    this.separatorPending = false;

    for (let i = 0; i < unicode.length; i += 1) {
      this.chars.push(unicode[i]);
      if (needsFallbackQuad) {
        this.instanceRefs.push(-2 - this.fallbackQuads.quadCount);
        this.fallbackQuads.push(quad.minX, quad.minY, quad.maxX, quad.maxY);
      } else {
        this.instanceRefs.push(instanceIndex);
      }
    }

    this.prevEndX = Number.isFinite(penEndX) ? penEndX : penStartX;
    this.prevEndY = Number.isFinite(penEndY) ? penEndY : penStartY;
    this.prevEmHeight = Number.isFinite(emHeight) && emHeight > 0 ? emHeight : this.prevEmHeight;
    this.hasPrev = true;
  }

  build(): PageTextIndex {
    return {
      text: this.chars.join(""),
      charInstance: Int32Array.from(this.instanceRefs),
      fallbackQuads: this.fallbackQuads.toTypedArray()
    };
  }
}

const IDENTITY_MATRIX: Mat2D = [1, 0, 0, 1, 0, 0];
const CURVE_FLATNESS = 0.35;
const MAX_CURVE_SPLIT_DEPTH = 9;
const SEGMENT_JOIN_EPSILON = 1e-3;
const COLLINEAR_DOT_THRESHOLD = 0.999995;
const COLLINEAR_PERP_EPSILON = 0.05;
const ALPHA_INVISIBLE_EPSILON = 1e-3;
const OPAQUE_ALPHA_EPSILON = 0.999;
const DUPLICATE_POSITION_SCALE = 1_000;
const DUPLICATE_STYLE_SCALE = 10_000;
const COVER_DIRECTION_SCALE = 2_000;
const COVER_OFFSET_SCALE = 200;
const COVER_INTERVAL_EPSILON = 0.05;
const COVER_HALF_WIDTH_EPSILON = 1e-4;
const TEXT_CUBIC_TO_QUAD_ERROR = 0.015;
const MAX_TEXT_CUBIC_TO_QUAD_DEPTH = 12;
const TEXT_BOUNDS_EPSILON = 1e-4;
const BACKGROUND_FILL_COLOR_EPSILON = 1e-3;
const BACKGROUND_FILL_MIN_AREA_RATIO = 0.2;
const BACKGROUND_FILL_MIN_DIMENSION_RATIO = 0.65;
const FILL_SUBPATH_SPLIT_MIN_SUBPATHS = 100;
const FILL_SUBPATH_TILE_TARGET_CHILDREN = 48;
const FILL_SUBPATH_TILE_MAX_COUNT = 32;
const FONT_MATRIX_FALLBACK = 0.001;
const TEXT_MIN_ALPHA = 1e-3;
const FILL_MIN_ALPHA = 1e-3;
// Render scale for raster content without a measurable native resolution (full-page
// vector fallback, unmeasurable image ops, solid-color masks). A fixed policy value
// keeps extraction deterministic across devices instead of depending on the display.
const RASTER_FALLBACK_TARGET_SCALE = 3;
// Shadings are continuous vector color fields without embedded pixel detail.
// A lower scale preserves smooth gradients and clipped edges without retaining
// a multi-megapixel 3x texture for every decorated brochure page.
const RASTER_SHADING_TARGET_SCALE = 1.5;
// Above this many image ops on a page, fall back to one flattened page layer instead of
// per-image layers to bound texture count and draw calls.
const RASTER_MAX_IMAGE_LAYERS = 32;
// Padding around a per-image crop so clip antialiasing at the image edge is kept.
const RASTER_CROP_PADDING_PX = 2;
const RASTER_MAX_SCALE = 24;
const RASTER_MAX_DIMENSION = 16384;
const RASTER_MAX_PIXELS = 134_217_728;
export const GRADIENT_LUT_WIDTH = 1024;

const FILL_RULE_NONZERO = 0;
const FILL_RULE_EVEN_ODD = 1;

const TEXT_RENDER_MODE_FILL = 0;
const TEXT_RENDER_MODE_FILL_STROKE = 2;
const TEXT_RENDER_MODE_FILL_ADD_PATH = 4;
const TEXT_RENDER_MODE_FILL_STROKE_ADD_PATH = 6;

const TEXT_PRIMITIVE_LINE = 0;
const TEXT_PRIMITIVE_QUADRATIC = 1;
const STROKE_PRIMITIVE_LINE = 0;
const STROKE_PRIMITIVE_QUADRATIC = 1;
const FILL_PRIMITIVE_LINE = 0;
const FILL_PRIMITIVE_QUADRATIC = 1;
const FILL_CUBIC_TO_QUAD_ERROR = 0.08;
const MAX_FILL_CUBIC_TO_QUAD_DEPTH = 9;
export const STROKE_STYLE_FLAG_HAIRLINE = 1 << 0;
const STROKE_STYLE_FLAG_ROUND_CAP = 1 << 1;
const STROKE_STYLE_FLAG_CLIPPED = 1 << 2;
const STROKE_STYLE_FLAG_OFFSET = 2;
const PAGE_GRID_GAP_FACTOR = 0.08;
const PAGE_GRID_MIN_GAP = 24;
const PDFJS_VERBOSITY_ERRORS = VerbosityLevel?.ERRORS ?? 0;

function encodeStrokeStyleMeta(alpha: number, styleFlags: number): number {
  const normalizedAlpha = clamp01(alpha);
  const normalizedFlags = Math.max(0, Math.trunc(styleFlags + 1e-6));
  return normalizedAlpha + normalizedFlags * STROKE_STYLE_FLAG_OFFSET;
}

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

export async function extractPdfPageScenes(pdfData: ArrayBuffer, options: VectorExtractOptions = {}): Promise<VectorScene[]> {
  const enableSegmentMerge = options.enableSegmentMerge !== false;
  const enableInvisibleCull = options.enableInvisibleCull !== false;
  const enableTextContent = options.extractTextContent === true;
  const standardFontDataUrl = resolveStandardFontDataUrl();
  const progress = createLoadProgressReporter(options.onProgress);
  progress.report(0, { stage: "source", sourceType: "pdf" });
  const pdfBytes = new Uint8Array(pdfData);
  assertPdfBytes(pdfBytes);

  const loadingTask = getDocument({
    data: pdfBytes,
    disableFontFace: true,
    fontExtraProperties: true,
    verbosity: PDFJS_VERBOSITY_ERRORS,
    ...(standardFontDataUrl ? { standardFontDataUrl } : {})
  });
  const pdf = await loadingTask.promise;
  progress.report(0.06, { stage: "pdf-page", sourceType: "pdf" });

  try {
    const pdfPageCount = normalizePositiveInt((pdf as { numPages?: unknown }).numPages, 1, 1, Number.MAX_SAFE_INTEGER);
    const pageNumbers = resolvePdfPageNumbers(pdfPageCount, options.pages);
    const extractedPageCount = pageNumbers.length;
    const pageScenes: VectorScene[] = [];
    const pageProgressStart = 0.08;
    const pageProgressRange = 0.84;

    for (let selectionIndex = 0; selectionIndex < extractedPageCount; selectionIndex += 1) {
      const pageNumber = pageNumbers[selectionIndex];
      const sourcePageIndex = pageNumber - 1;
      const pageStart = pageProgressStart + (selectionIndex / extractedPageCount) * pageProgressRange;
      const pageEnd = pageProgressStart + ((selectionIndex + 1) / extractedPageCount) * pageProgressRange;
      progress.report(pageStart, {
        stage: "pdf-page",
        sourceType: "pdf",
        unit: "pages",
        processed: selectionIndex,
        total: extractedPageCount,
        pageIndex: selectionIndex,
        pageCount: extractedPageCount,
        sourcePageIndex,
        sourcePageCount: pdfPageCount
      });
      const page = await pdf.getPage(pageNumber);
      progress.report(lerpNumber(pageStart, pageEnd, 0.28), {
        stage: "pdf-operators",
        sourceType: "pdf",
        unit: "pages",
        processed: selectionIndex,
        total: extractedPageCount,
        pageIndex: selectionIndex,
        pageCount: extractedPageCount,
        sourcePageIndex,
        sourcePageCount: pdfPageCount
      });
      const operatorList = await page.getOperatorList();
      progress.report(lerpNumber(pageStart, pageEnd, 0.58), {
        stage: "compile",
        sourceType: "pdf",
        unit: "operators",
        processed: operatorList.fnArray.length,
        total: operatorList.fnArray.length,
        pageIndex: selectionIndex,
        pageCount: extractedPageCount,
        sourcePageIndex,
        sourcePageCount: pdfPageCount
      });
      const pageScene = await extractSinglePageVectors(page, operatorList, {
        enableSegmentMerge,
        enableInvisibleCull
      });
      if (enableTextContent) {
        pageScene.textContent = await extractPageTextContent(page);
      }
      pageScenes.push(pageScene);
      progress.report(pageEnd, {
        stage: "pdf-page",
        sourceType: "pdf",
        unit: "pages",
        processed: selectionIndex + 1,
        total: extractedPageCount,
        pageIndex: selectionIndex,
        pageCount: extractedPageCount,
        sourcePageIndex,
        sourcePageCount: pdfPageCount
      });
    }

    progress.report(0.94, { stage: "compile", sourceType: "pdf" });
    return pageScenes;
  } finally {
    await loadingTask.destroy();
  }
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
  options: VectorExtractOptions = {}
): Promise<VectorScene[]> {
  const standardFontDataUrl = resolveStandardFontDataUrl();
  const progress = createLoadProgressReporter(options.onProgress);
  progress.report(0, { stage: "source", sourceType: "pdf" });
  const pdfBytes = new Uint8Array(pdfData);
  assertPdfBytes(pdfBytes);
  const loadingTask = getDocument({
    data: pdfBytes,
    disableFontFace: true,
    fontExtraProperties: true,
    verbosity: PDFJS_VERBOSITY_ERRORS,
    ...(standardFontDataUrl ? { standardFontDataUrl } : {})
  });
  const pdf = await loadingTask.promise;
  progress.report(0.06, { stage: "pdf-page", sourceType: "pdf" });

  try {
    const pdfPageCount = normalizePositiveInt((pdf as { numPages?: unknown }).numPages, 1, 1, Number.MAX_SAFE_INTEGER);
    const pageNumbers = resolvePdfPageNumbers(pdfPageCount, options.pages);
    const extractedPageCount = pageNumbers.length;
    const pageScenes: VectorScene[] = [];
    const pageProgressStart = 0.08;
    const pageProgressRange = 0.84;

    for (let selectionIndex = 0; selectionIndex < extractedPageCount; selectionIndex += 1) {
      const pageNumber = pageNumbers[selectionIndex];
      const sourcePageIndex = pageNumber - 1;
      const pageStart = pageProgressStart + (selectionIndex / extractedPageCount) * pageProgressRange;
      const pageEnd = pageProgressStart + ((selectionIndex + 1) / extractedPageCount) * pageProgressRange;
      progress.report(pageStart, {
        stage: "pdf-page",
        sourceType: "pdf",
        unit: "pages",
        processed: selectionIndex,
        total: extractedPageCount,
        pageIndex: selectionIndex,
        pageCount: extractedPageCount,
        sourcePageIndex,
        sourcePageCount: pdfPageCount
      });
      const page = await pdf.getPage(pageNumber);
      const operatorList = await page.getOperatorList();
      progress.report(lerpNumber(pageStart, pageEnd, 0.4), {
        stage: "pdf-raster",
        sourceType: "pdf",
        unit: "pages",
        processed: selectionIndex,
        total: extractedPageCount,
        pageIndex: selectionIndex,
        pageCount: extractedPageCount,
        sourcePageIndex,
        sourcePageCount: pdfPageCount
      });
      pageScenes.push(await extractSinglePageRasterOnly(page, operatorList));
      progress.report(pageEnd, {
        stage: "pdf-page",
        sourceType: "pdf",
        unit: "pages",
        processed: selectionIndex + 1,
        total: extractedPageCount,
        pageIndex: selectionIndex,
        pageCount: extractedPageCount,
        sourcePageIndex,
        sourcePageCount: pdfPageCount
      });
    }

    progress.report(0.94, { stage: "compile", sourceType: "pdf" });
    return pageScenes;
  } finally {
    await loadingTask.destroy();
  }
}

export async function extractPdfRasterScene(pdfData: ArrayBuffer, options: VectorExtractOptions = {}): Promise<VectorScene> {
  const maxPagesPerRow = normalizePositiveInt(options.maxPagesPerRow, 10, 1, 100);
  const pageScenes = await extractPdfRasterPageScenes(pdfData, options);
  const progress = createLoadProgressReporter(options.onProgress);
  progress.report(0.96, { stage: "compile", sourceType: "pdf" });
  const scene = composeScenesInGrid(pageScenes, maxPagesPerRow);
  progress.complete({ sourceType: "pdf" });
  return scene;
}

interface SinglePageExtractOptions {
  enableSegmentMerge: boolean;
  enableInvisibleCull: boolean;
}

interface PagePlacement {
  translateX: number;
  translateY: number;
}

async function extractSinglePageRasterOnly(
  page: unknown,
  operatorList: { fnArray: number[]; argsArray: unknown[] }
): Promise<VectorScene> {
  const pageView = (page as { view?: unknown }).view;
  const pageBoundsInput = Array.isArray(pageView) ? pageView : [0, 0, 1, 1];
  const rawPageBounds: Bounds = {
    minX: Math.min(Number(pageBoundsInput[0]) || 0, Number(pageBoundsInput[2]) || 1),
    minY: Math.min(Number(pageBoundsInput[1]) || 0, Number(pageBoundsInput[3]) || 1),
    maxX: Math.max(Number(pageBoundsInput[0]) || 0, Number(pageBoundsInput[2]) || 1),
    maxY: Math.max(Number(pageBoundsInput[1]) || 0, Number(pageBoundsInput[3]) || 1)
  };
  const pageMatrix = buildPageMatrix(page as {
    rotate: number;
    getViewport: (params: { scale: number; rotation?: number; dontFlip?: boolean }) => { transform: unknown; height: number };
  });
  const pageBounds = transformBounds(rawPageBounds, pageMatrix);
  const imagePaintOpCount = countImagePaintOps(operatorList);
  const rasterExtract = await extractRasterLayerData(page, operatorList, pageMatrix, {
    allowFullPageFallback: true
  });
  const rasterLayers: RasterLayer[] = rasterExtract.layers.map((layer) => ({
    width: layer.width,
    height: layer.height,
    data: layer.data,
    matrix: new Float32Array(layer.matrix),
    paintOrder: Number.isFinite(layer.paintOrder) ? layer.paintOrder : 0,
    pageIndex: Number.isFinite(layer.pageIndex) ? Math.max(0, Math.trunc(layer.pageIndex)) : 0
  }));

  const base = createEmptyVectorScene();
  const primaryRasterLayer = rasterLayers[0] ?? null;
  const combinedBounds = combineBounds(pageBounds, rasterExtract.bounds) ?? pageBounds;

  return {
    ...base,
    pageCount: 1,
    pagesPerRow: 1,
    pageRects: new Float32Array([pageBounds.minX, pageBounds.minY, pageBounds.maxX, pageBounds.maxY]),
    pageTextRanges: new Uint32Array([0, 0]),
    rasterLayers,
    rasterLayerWidth: primaryRasterLayer?.width ?? 0,
    rasterLayerHeight: primaryRasterLayer?.height ?? 0,
    rasterLayerData: primaryRasterLayer?.data ?? new Uint8Array(0),
    rasterLayerMatrix: primaryRasterLayer?.matrix ?? new Float32Array([1, 0, 0, 1, 0, 0]),
    bounds: combinedBounds,
    pageBounds,
    imagePaintOpCount,
    operatorCount: operatorList.fnArray.length
  };
}

async function extractSinglePageVectors(
  page: unknown,
  operatorList: { fnArray: number[]; argsArray: unknown[] },
  options: SinglePageExtractOptions
): Promise<VectorScene> {
  const pageView = (page as { view?: unknown }).view;
  const pageBoundsInput = Array.isArray(pageView) ? pageView : [0, 0, 1, 1];
  const rawPageBounds: Bounds = {
    minX: Math.min(Number(pageBoundsInput[0]) || 0, Number(pageBoundsInput[2]) || 1),
    minY: Math.min(Number(pageBoundsInput[1]) || 0, Number(pageBoundsInput[3]) || 1),
    maxX: Math.max(Number(pageBoundsInput[0]) || 0, Number(pageBoundsInput[2]) || 1),
    maxY: Math.max(Number(pageBoundsInput[1]) || 0, Number(pageBoundsInput[3]) || 1)
  };
  const pageMatrix = buildPageMatrix(page as {
    rotate: number;
    getViewport: (params: { scale: number; rotation?: number; dontFlip?: boolean }) => { transform: unknown; height: number };
  });
  const pageBounds = transformBounds(rawPageBounds, pageMatrix);
  const imagePaintOpCount = countImagePaintOps(operatorList);
  const sourceNativeGradientPlan = buildNativeGradientPlan(
    page,
    operatorList,
    pageMatrix,
    pageBounds
  );
  let nativeGradientPlan: NativeGradientPlan | null = null;
  let displayNativeGradientPlan: NativeGradientPlan | null = null;
  let preparedDisplayOperatorList: PdfOperatorListLike | null | undefined;
  if (sourceNativeGradientPlan.paints.length > 0) {
    preparedDisplayOperatorList = await prepareDisplayOperatorList(page as RasterPageLike);
    if (preparedDisplayOperatorList) {
      displayNativeGradientPlan = buildNativeGradientPlan(
        page,
        preparedDisplayOperatorList,
        pageMatrix,
        pageBounds
      );
      const displayExcludedPaintMask = displayNativeGradientPlan.rasterExcludedPaintMask;
      const displayHasExternalImagePaint = preparedDisplayOperatorList.fnArray.some(
        (fn, index) => isImagePaintOperator(fn) && displayExcludedPaintMask[index] !== 1
      );
      const displayImageScan = displayHasExternalImagePaint
        ? scanRasterImageOps(preparedDisplayOperatorList, displayExcludedPaintMask)
        : null;
      const nativeImageOrderingIsRepresentable =
        !displayHasExternalImagePaint ||
        (displayImageScan?.plans !== null &&
          displayImageScan?.plans !== undefined &&
          displayImageScan.plans.length <= RASTER_MAX_IMAGE_LAYERS);
      if (
        nativeGradientTopologyMatches(sourceNativeGradientPlan, displayNativeGradientPlan) &&
        nativeImageOrderingIsRepresentable
      ) {
        nativeGradientPlan = sourceNativeGradientPlan;
      } else {
        displayNativeGradientPlan = null;
      }
    }
  }
  let rasterExtract = await extractRasterLayerData(page, operatorList, pageMatrix, {
    allowFullPageFallback: false,
    preparedDisplayOperatorList,
    nativeSourcePlan: nativeGradientPlan,
    nativeDisplayPlan: displayNativeGradientPlan
  });
  if (nativeGradientPlan && rasterExtract.nativeOrderingFailed) {
    // A nominally measurable image can still fail its individual crop/render
    // at runtime. Revert the whole page to its established atomic raster plan
    // instead of flattening images across a sparse native paint.
    nativeGradientPlan = null;
    displayNativeGradientPlan = null;
    rasterExtract = await extractRasterLayerData(page, operatorList, pageMatrix, {
      allowFullPageFallback: false,
      preparedDisplayOperatorList
    });
  }
  const suppressedPaintMask = rasterExtract.suppressedSourcePaintMask;

  const endpointBuilder = new Float4Builder();
  const primitiveMetaBuilder = new Float4Builder();
  const primitiveBoundsBuilder = new Float4Builder();
  const styleBuilder = new Float4Builder();
  const fillPathMetaABuilder = new Float4Builder(8_192);
  const fillPathMetaBBuilder = new Float4Builder(8_192);
  const fillPathMetaCBuilder = new Float4Builder(8_192);
  const fillSegmentBuilderA = new Float4Builder(65_536);
  const fillSegmentBuilderB = new Float4Builder(65_536);
  const gradientFillPathMetaABuilder = new Float4Builder(128);
  const gradientFillPathMetaBBuilder = new Float4Builder(128);
  const gradientFillPathMetaCBuilder = new Float4Builder(128);
  const gradientFillPaintMetaBuilder = new Float4Builder(128);
  const gradientFillSegmentBuilderA = new Float4Builder(1_024);
  const gradientFillSegmentBuilderB = new Float4Builder(1_024);
  const gradientStrokeRunMetaABuilder = new Float4Builder(128);
  const gradientStrokeRunMetaBBuilder = new Float4Builder(128);
  const gradientStrokeEndpointBuilder = new Float4Builder(1_024);
  const gradientStrokePrimitiveMetaBuilder = new Float4Builder(1_024);
  const gradientStrokePrimitiveBoundsBuilder = new Float4Builder(1_024);
  const gradientStrokeStyleBuilder = new Float4Builder(1_024);

  const bounds: Bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };
  const fillBounds: Bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };
  const gradientBounds: Bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };

  let pathCount = 0;
  let sourceSegmentCount = 0;
  let maxHalfWidth = 0;
  let gradientMaxHalfWidth = 0;
  let fillPathCount = 0;

  const stateStack: GraphicsState[] = [];
  const formStateStack: GraphicsState[] = [];
  const annotationStateStack: GraphicsState[] = [];
  const groupAlphaStack: Array<Pick<
    GraphicsState,
    "groupFillAlpha" | "groupStrokeAlpha" | "groupFillAlphaVersion" | "groupStrokeAlphaVersion"
  >> = [];
  let currentState: GraphicsState = createDefaultState(pageMatrix, pageBounds);
  let pendingClipPathBounds: Bounds | null = null;
  let pendingClipPathMask: ClipMask | null = null;
  let pendingClipOperator = false;
  let pendingClipRule = FILL_RULE_NONZERO;

  for (let i = 0; i < operatorList.fnArray.length; i += 1) {
    const fn = operatorList.fnArray[i];
    const args = operatorList.argsArray[i];

    if (fn === OPS.save) {
      stateStack.push(cloneState(currentState));
      continue;
    }

    if (fn === OPS.restore) {
      const restored = stateStack.pop();
      if (restored) {
        currentState = restored;
      }
      pendingClipPathBounds = null;
      pendingClipOperator = false;
      continue;
    }

    if (fn === OPS.transform) {
      const transform = readTransform(args);
      if (transform) {
        currentState.matrix = multiplyMatrices(currentState.matrix, transform);
      }
      continue;
    }

    if (fn === OPS.paintFormXObjectBegin) {
      formStateStack.push(cloneState(currentState));
      const transform = readTransform(args);
      if (transform) {
        currentState.matrix = multiplyMatrices(currentState.matrix, transform);
      }
      pendingClipPathBounds = null;
      pendingClipOperator = false;
      continue;
    }

    if (fn === OPS.paintFormXObjectEnd) {
      const restored = formStateStack.pop();
      if (restored) {
        currentState = restored;
      }
      pendingClipPathBounds = null;
      pendingClipOperator = false;
      continue;
    }

    if (fn === OPS.beginAnnotation) {
      annotationStateStack.push(cloneState(currentState));
      const annotationTransform = readAnnotationTransform(args);
      if (annotationTransform) {
        currentState.matrix = multiplyMatrices(currentState.matrix, annotationTransform);
      }
      pendingClipPathBounds = null;
      pendingClipOperator = false;
      continue;
    }

    if (fn === OPS.endAnnotation) {
      const restored = annotationStateStack.pop();
      if (restored) {
        currentState = restored;
      }
      pendingClipPathBounds = null;
      pendingClipOperator = false;
      continue;
    }

    if (fn === OPS.setLineWidth) {
      const nextWidth = readNumber(args, 0, currentState.lineWidth);
      currentState.lineWidth = Math.max(0, nextWidth);
      continue;
    }

    if (fn === OPS.setLineCap) {
      const nextCap = Math.trunc(readNumber(args, 0, currentState.lineCap));
      currentState.lineCap = Math.min(2, Math.max(0, nextCap));
      continue;
    }

    if (fn === OPS.setDash) {
      const nextDash = readLineDash(args);
      if (nextDash) {
        currentState.lineDash = nextDash.pattern;
        currentState.dashPhase = nextDash.phase;
      }
      continue;
    }

    if (fn === OPS.setStrokeRGBColor || fn === OPS.setStrokeColor) {
      const [r, g, b] = parseColorFromOperatorArgs(args, [currentState.strokeR, currentState.strokeG, currentState.strokeB]);
      currentState.strokeR = r;
      currentState.strokeG = g;
      currentState.strokeB = b;
      continue;
    }

    if (fn === OPS.setStrokeGray) {
      const strokeGray = readArg(args, 0);
      const [gray] = parseGrayColor(strokeGray, currentState.strokeR);
      currentState.strokeR = gray;
      currentState.strokeG = gray;
      currentState.strokeB = gray;
      continue;
    }

    if (fn === OPS.setStrokeCMYKColor) {
      const [r, g, b] = parseCmykColorFromOperatorArgs(args, [currentState.strokeR, currentState.strokeG, currentState.strokeB]);
      currentState.strokeR = r;
      currentState.strokeG = g;
      currentState.strokeB = b;
      continue;
    }

    if (fn === OPS.setFillRGBColor || fn === OPS.setFillColor) {
      const [r, g, b] = parseColorFromOperatorArgs(args, [currentState.fillR, currentState.fillG, currentState.fillB]);
      currentState.fillR = r;
      currentState.fillG = g;
      currentState.fillB = b;
      continue;
    }

    if (fn === OPS.setFillGray) {
      const [gray] = parseGrayColor(readArg(args, 0), currentState.fillR);
      currentState.fillR = gray;
      currentState.fillG = gray;
      currentState.fillB = gray;
      continue;
    }

    if (fn === OPS.setFillCMYKColor) {
      const [r, g, b] = parseCmykColorFromOperatorArgs(args, [currentState.fillR, currentState.fillG, currentState.fillB]);
      currentState.fillR = r;
      currentState.fillG = g;
      currentState.fillB = b;
      continue;
    }

    if (fn === OPS.setGState) {
      applyGraphicsStateEntries(readArg(args, 0), currentState);
      continue;
    }

    if (fn === OPS.beginGroup) {
      groupAlphaStack.push({
        groupFillAlpha: currentState.groupFillAlpha,
        groupStrokeAlpha: currentState.groupStrokeAlpha,
        groupFillAlphaVersion: currentState.groupFillAlphaVersion,
        groupStrokeAlphaVersion: currentState.groupStrokeAlphaVersion
      });
      currentState.groupFillAlpha = clamp01(currentState.groupFillAlpha * currentState.fillAlpha);
      currentState.groupStrokeAlpha = clamp01(currentState.groupStrokeAlpha * currentState.strokeAlpha);
      currentState.groupFillAlphaVersion = currentState.fillAlphaVersion;
      currentState.groupStrokeAlphaVersion = currentState.strokeAlphaVersion;
      pendingClipPathBounds = null;
      pendingClipOperator = false;
      continue;
    }

    if (fn === OPS.endGroup) {
      const restoredGroupAlpha = groupAlphaStack.pop();
      if (restoredGroupAlpha) {
        currentState.groupFillAlpha = restoredGroupAlpha.groupFillAlpha;
        currentState.groupStrokeAlpha = restoredGroupAlpha.groupStrokeAlpha;
        currentState.groupFillAlphaVersion = restoredGroupAlpha.groupFillAlphaVersion;
        currentState.groupStrokeAlphaVersion = restoredGroupAlpha.groupStrokeAlphaVersion;
      }
      pendingClipPathBounds = null;
      pendingClipOperator = false;
      continue;
    }

    if (fn === OPS.clip || fn === OPS.eoClip) {
      const clipRule = fn === OPS.eoClip ? FILL_RULE_EVEN_ODD : FILL_RULE_NONZERO;
      if (pendingClipPathBounds) {
        applyClipToState(currentState, pendingClipPathBounds, pendingClipPathMask, clipRule);
        pendingClipPathBounds = null;
        pendingClipPathMask = null;
      } else {
        pendingClipOperator = true;
        pendingClipRule = clipRule;
      }
      continue;
    }

    if (fn === OPS.endPath) {
      pendingClipPathBounds = null;
      pendingClipOperator = false;
      continue;
    }

    if (fn !== OPS.constructPath) {
      pendingClipPathBounds = null;
      continue;
    }

    const paintOp = readNumber(args, 0, -1);
    const pathData = readPathData(args);
    if (!pathData) {
      pendingClipPathBounds = null;
      pendingClipOperator = false;
      continue;
    }
    const transformedPathBounds =
      pendingClipOperator || paintOp === OPS.endPath || currentState.clipBounds
        ? computeTransformedPathBounds(pathData, currentState.matrix)
        : null;
    const transformedClipMask =
      pendingClipOperator || paintOp === OPS.endPath
        ? extractSimpleEvenOddRectangleClipMask(pathData, currentState.matrix)
        : null;

    if (pendingClipOperator) {
      applyClipToState(currentState, transformedPathBounds, transformedClipMask, pendingClipRule);
      pendingClipOperator = false;
      pendingClipRule = FILL_RULE_NONZERO;
      pendingClipPathBounds = null;
      pendingClipPathMask = null;
    } else if (paintOp === OPS.endPath) {
      pendingClipPathBounds = transformedPathBounds;
      pendingClipPathMask = transformedClipMask;
    } else {
      pendingClipPathBounds = null;
      pendingClipPathMask = null;
    }

    const strokePaint = isStrokePaintOp(paintOp);
    const fillPaint = isFillPaintOp(paintOp);
    if (!strokePaint && !fillPaint) {
      continue;
    }

    if (suppressedPaintMask?.[i] === 1) {
      continue;
    }

    if (nativeGradientPlan?.nativePathPaintMask[i] === 1) {
      pathCount += 1;
      continue;
    }

    if (currentState.clipBounds && !isNonEmptyBounds(intersectBounds(currentState.clipBounds, transformedPathBounds))) {
      continue;
    }

    pathCount += 1;

    if (strokePaint) {
      const isHairlineStroke = currentState.lineWidth <= 0;
      const widthScale = matrixScale(currentState.matrix);
      const strokeWidth = isHairlineStroke ? 0 : currentState.lineWidth * widthScale;
      const halfWidth = Math.max(0, strokeWidth * 0.5);
      maxHalfWidth = Math.max(maxHalfWidth, halfWidth);
      let styleFlags = 0;
      if (isHairlineStroke) {
        styleFlags |= STROKE_STYLE_FLAG_HAIRLINE;
      }
      if (currentState.lineCap === 1) {
        styleFlags |= STROKE_STYLE_FLAG_ROUND_CAP;
      }

      const styleR = clamp01(currentState.strokeR);
      const styleG = clamp01(currentState.strokeG);
      const styleB = clamp01(currentState.strokeB);
      const styleAlpha = effectiveStrokeAlpha(currentState);
      sourceSegmentCount += emitSegmentsFromPath(
        pathData,
        currentState.matrix,
        halfWidth,
        styleR,
        styleG,
        styleB,
        styleAlpha,
        styleFlags,
        currentState.lineDash,
        currentState.dashPhase,
        options.enableSegmentMerge,
        endpointBuilder,
        primitiveMetaBuilder,
        styleBuilder,
        primitiveBoundsBuilder,
        bounds,
        currentState.clipBounds
      );
    }

    if (fillPaint) {
      const fillRule = isEvenOddFillPaintOp(paintOp) ? FILL_RULE_EVEN_ODD : FILL_RULE_NONZERO;
      const fillAlpha = effectiveFillAlpha(currentState);
      const hasCompanionStroke = strokePaint && effectiveStrokeAlpha(currentState) > ALPHA_INVISIBLE_EPSILON;
      if (fillAlpha > FILL_MIN_ALPHA) {
        const emittedFillPathCount = emitFilledPathFromPath(
          pathData,
          currentState.matrix,
          fillRule,
          hasCompanionStroke,
          clamp01(currentState.fillR),
          clamp01(currentState.fillG),
          clamp01(currentState.fillB),
          fillAlpha,
          fillPathMetaABuilder,
          fillPathMetaBBuilder,
          fillPathMetaCBuilder,
          fillSegmentBuilderA,
          fillSegmentBuilderB,
          fillBounds,
          currentState.clipBounds,
          currentState.clipMask,
          pageBounds
        );
        fillPathCount += emittedFillPathCount;
      }
    }
  }

  if (nativeGradientPlan) {
    for (const paint of nativeGradientPlan.paints) {
      if (paint.kind === "fill") {
        const pathStart = gradientFillPathMetaABuilder.quadCount;
        const sourceIsSolid = paint.sourceGradientIndex < 0;
        const emittedPathCount = emitFilledPathFromPath(
          paint.pathData,
          paint.matrix,
          paint.fillRule,
          false,
          sourceIsSolid ? clamp01(paint.state.fillR) : 0,
          sourceIsSolid ? clamp01(paint.state.fillG) : 0,
          sourceIsSolid ? clamp01(paint.state.fillB) : 0,
          effectiveNativeFillAlpha(paint.state),
          gradientFillPathMetaABuilder,
          gradientFillPathMetaBBuilder,
          gradientFillPathMetaCBuilder,
          gradientFillSegmentBuilderA,
          gradientFillSegmentBuilderB,
          gradientBounds,
          paint.state.clipBounds,
          null,
          pageBounds,
          true,
          false
        );
        for (let i = 0; i < emittedPathCount; i += 1) {
          gradientFillPaintMetaBuilder.push(
            paint.sourceGradientIndex,
            paint.maskGradientIndex,
            paint.paintOrdinal,
            0
          );
        }
        if (gradientFillPathMetaABuilder.quadCount - pathStart !== emittedPathCount) {
          throw new Error("Native gradient fill metadata is out of sync with its path geometry.");
        }
        continue;
      }

      const segmentStart = gradientStrokeEndpointBuilder.quadCount;
      const isHairlineStroke = paint.state.lineWidth <= 0;
      const widthScale = matrixScale(paint.matrix);
      const strokeWidth = isHairlineStroke ? 0 : paint.state.lineWidth * widthScale;
      const halfWidth = Math.max(0, strokeWidth * 0.5);
      gradientMaxHalfWidth = Math.max(gradientMaxHalfWidth, halfWidth);
      let styleFlags = isHairlineStroke ? STROKE_STYLE_FLAG_HAIRLINE : 0;
      if (paint.state.lineCap === 1) {
        styleFlags |= STROKE_STYLE_FLAG_ROUND_CAP;
      }
      const sourceIsSolid = paint.sourceGradientIndex < 0;
      emitSegmentsFromPath(
        paint.pathData,
        paint.matrix,
        halfWidth,
        sourceIsSolid ? clamp01(paint.state.strokeR) : 0,
        sourceIsSolid ? clamp01(paint.state.strokeG) : 0,
        sourceIsSolid ? clamp01(paint.state.strokeB) : 0,
        effectiveNativeStrokeAlpha(paint.state),
        styleFlags,
        paint.state.lineDash,
        paint.state.dashPhase,
        options.enableSegmentMerge,
        gradientStrokeEndpointBuilder,
        gradientStrokePrimitiveMetaBuilder,
        gradientStrokeStyleBuilder,
        gradientStrokePrimitiveBoundsBuilder,
        gradientBounds,
        paint.state.clipBounds,
        true
      );
      const segmentCount = gradientStrokeEndpointBuilder.quadCount - segmentStart;
      if (segmentCount > 0) {
        gradientStrokeRunMetaABuilder.push(
          segmentStart,
          segmentCount,
          paint.sourceGradientIndex,
          paint.maskGradientIndex
        );
        gradientStrokeRunMetaBBuilder.push(paint.paintOrdinal, 0, 0, 0);
      }
    }
  }

  const gradientCount = nativeGradientPlan?.gradients.length ?? 0;
  const gradientMetaA = new Float32Array(gradientCount * 4);
  const gradientMetaB = new Float32Array(gradientCount * 4);
  const gradientMetaC = new Float32Array(gradientCount * 4);
  const gradientMetaD = new Float32Array(gradientCount * 4);
  const gradientMetaE = new Float32Array(gradientCount * 4);
  const gradientLut = new Uint8Array(gradientCount * GRADIENT_LUT_WIDTH * 4);
  if (nativeGradientPlan) {
    for (let i = 0; i < nativeGradientPlan.gradients.length; i += 1) {
      const gradient = nativeGradientPlan.gradients[i];
      const offset = i * 4;
      gradientMetaA[offset] = gradient.kind;
      gradientMetaA[offset + 1] = gradient.bbox ? 1 : 0;
      gradientMetaB.set(gradient.sceneToGradient.slice(0, 4), offset);
      gradientMetaC[offset] = gradient.sceneToGradient[4];
      gradientMetaC[offset + 1] = gradient.sceneToGradient[5];
      gradientMetaC[offset + 2] = gradient.p0[0];
      gradientMetaC[offset + 3] = gradient.p0[1];
      gradientMetaD[offset] = gradient.p1[0];
      gradientMetaD[offset + 1] = gradient.p1[1];
      gradientMetaD[offset + 2] = gradient.r0;
      gradientMetaD[offset + 3] = gradient.r1;
      if (gradient.bbox) {
        gradientMetaE.set(gradient.bbox, offset);
      }
      gradientLut.set(gradient.lut, i * GRADIENT_LUT_WIDTH * 4);
    }
  }

  const mergedSegmentCount = endpointBuilder.quadCount;
  const mergedEndpoints = endpointBuilder.toTypedArray();
  const mergedPrimitiveMeta = primitiveMetaBuilder.toTypedArray();
  const mergedPrimitiveBounds = primitiveBoundsBuilder.toTypedArray();
  const mergedStyles = styleBuilder.toTypedArray();
  const fillSegmentCount = fillSegmentBuilderA.quadCount;
  const fillPathMetaA = fillPathMetaABuilder.toTypedArray();
  const fillPathMetaB = fillPathMetaBBuilder.toTypedArray();
  const fillPathMetaC = fillPathMetaCBuilder.toTypedArray();
  const fillSegmentsA = fillSegmentBuilderA.toTypedArray();
  const fillSegmentsB = fillSegmentBuilderB.toTypedArray();
  const resolvedFillBounds = fillPathCount > 0 ? fillBounds : null;
  const gradientFillPathCount = gradientFillPathMetaABuilder.quadCount;
  const gradientFillSegmentCount = gradientFillSegmentBuilderA.quadCount;
  const gradientFillPathMetaA = gradientFillPathMetaABuilder.toTypedArray();
  const gradientFillPathMetaB = gradientFillPathMetaBBuilder.toTypedArray();
  const gradientFillPathMetaC = gradientFillPathMetaCBuilder.toTypedArray();
  const gradientFillPaintMeta = gradientFillPaintMetaBuilder.toTypedArray();
  const gradientFillSegmentsA = gradientFillSegmentBuilderA.toTypedArray();
  const gradientFillSegmentsB = gradientFillSegmentBuilderB.toTypedArray();
  const gradientStrokeRunCount = gradientStrokeRunMetaABuilder.quadCount;
  const gradientStrokeSegmentCount = gradientStrokeEndpointBuilder.quadCount;
  const gradientStrokeRunMetaA = gradientStrokeRunMetaABuilder.toTypedArray();
  const gradientStrokeRunMetaB = gradientStrokeRunMetaBBuilder.toTypedArray();
  const gradientStrokeEndpoints = gradientStrokeEndpointBuilder.toTypedArray();
  const gradientStrokePrimitiveMeta = gradientStrokePrimitiveMetaBuilder.toTypedArray();
  const gradientStrokePrimitiveBounds = gradientStrokePrimitiveBoundsBuilder.toTypedArray();
  const gradientStrokeStyles = gradientStrokeStyleBuilder.toTypedArray();
  const resolvedGradientBounds = gradientFillPathCount > 0 || gradientStrokeSegmentCount > 0
    ? gradientBounds
    : null;

  let segmentCount = mergedSegmentCount;
  let endpoints = mergedEndpoints;
  let primitiveMeta = mergedPrimitiveMeta;
  let primitiveBounds = mergedPrimitiveBounds;
  let styles = mergedStyles;
  let segmentBounds: Bounds | null = mergedSegmentCount > 0 ? bounds : null;
  let resolvedMaxHalfWidth = mergedSegmentCount > 0 ? maxHalfWidth : 0;
  let discardedTransparentCount = 0;
  let discardedDegenerateCount = 0;
  let discardedDuplicateCount = 0;
  let discardedContainedCount = 0;

  if (mergedSegmentCount > 0 && options.enableInvisibleCull) {
    const culled = cullInvisibleSegments(mergedEndpoints, mergedPrimitiveMeta, mergedStyles, mergedPrimitiveBounds);
    segmentCount = culled.segmentCount;
    endpoints = culled.endpoints;
    primitiveMeta = culled.primitiveMeta;
    primitiveBounds = culled.primitiveBounds;
    styles = culled.styles;
    segmentBounds = culled.segmentCount > 0 ? culled.bounds : null;
    resolvedMaxHalfWidth = culled.maxHalfWidth;
    discardedTransparentCount = culled.discardedTransparentCount;
    discardedDegenerateCount = culled.discardedDegenerateCount;
    discardedDuplicateCount = culled.discardedDuplicateCount;
    discardedContainedCount = culled.discardedContainedCount;
  }

  if (segmentCount === 0) {
    endpoints = new Float32Array(0);
    primitiveMeta = new Float32Array(0);
    primitiveBounds = new Float32Array(0);
    styles = new Float32Array(0);
    resolvedMaxHalfWidth = 0;
  }

  let textData = await extractTextVectorData(page, operatorList, pageMatrix, pageBounds, suppressedPaintMask);
  if (textData.sourceTextCount === 0 && hasTextShowOperators(operatorList)) {
    await warmUpTextPathCache(page);
    textData = await extractTextVectorData(page, operatorList, pageMatrix, pageBounds, suppressedPaintMask);
  }

  const allowFullPageRasterFallback =
    segmentCount === 0 &&
    fillPathCount === 0 &&
    gradientFillPathCount === 0 &&
    gradientStrokeSegmentCount === 0 &&
    textData.instanceCount === 0;
  if (allowFullPageRasterFallback) {
    rasterExtract = await extractRasterLayerData(page, operatorList, pageMatrix, {
      allowFullPageFallback: true
    });
  }
  const rasterLayers: RasterLayer[] = rasterExtract.layers.map((layer) => ({
    width: layer.width,
    height: layer.height,
    data: layer.data,
    matrix: new Float32Array(layer.matrix),
    paintOrder: Number.isFinite(layer.paintOrder) ? layer.paintOrder : 0,
    pageIndex: Number.isFinite(layer.pageIndex) ? Math.max(0, Math.trunc(layer.pageIndex)) : 0
  }));
  const combinedBounds =
    combineBounds(
      combineBounds(
        combineBounds(combineBounds(segmentBounds, resolvedFillBounds), resolvedGradientBounds),
        textData.bounds
      ),
      rasterExtract.bounds
    ) ??
    { ...pageBounds };

  return {
    pageCount: 1,
    pagesPerRow: 1,
    pageRects: new Float32Array([pageBounds.minX, pageBounds.minY, pageBounds.maxX, pageBounds.maxY]),
    pageTextRanges: new Uint32Array([0, textData.instanceCount]),
    textIndex: { version: 2, pages: [textData.textIndexPage] },
    fillPathCount,
    fillSegmentCount,
    fillPathMetaA,
    fillPathMetaB,
    fillPathMetaC,
    fillSegmentsA,
    fillSegmentsB,
    gradientCount,
    gradientMetaA,
    gradientMetaB,
    gradientMetaC,
    gradientMetaD,
    gradientMetaE,
    gradientLut,
    gradientFillPathCount,
    gradientFillSegmentCount,
    gradientFillPathMetaA,
    gradientFillPathMetaB,
    gradientFillPathMetaC,
    gradientFillPaintMeta,
    gradientFillSegmentsA,
    gradientFillSegmentsB,
    gradientStrokeRunCount,
    gradientStrokeSegmentCount,
    gradientStrokeRunMetaA,
    gradientStrokeRunMetaB,
    gradientStrokeEndpoints,
    gradientStrokePrimitiveMeta,
    gradientStrokePrimitiveBounds,
    gradientStrokeStyles,
    segmentCount,
    sourceSegmentCount,
    mergedSegmentCount,
    sourceTextCount: textData.sourceTextCount,
    textInstanceCount: textData.instanceCount,
    textGlyphCount: textData.glyphCount,
    textGlyphSegmentCount: textData.glyphSegmentCount,
    textInPageCount: textData.inPageCount,
    textOutOfPageCount: textData.outOfPageCount,
    textInstanceA: textData.instanceA,
    textInstanceB: textData.instanceB,
    textInstanceC: textData.instanceC,
    textGlyphMetaA: textData.glyphMetaA,
    textGlyphMetaB: textData.glyphMetaB,
    textGlyphSegmentsA: textData.glyphSegmentsA,
    textGlyphSegmentsB: textData.glyphSegmentsB,
    rasterLayers,
    rasterLayerWidth: rasterLayers[0]?.width ?? 0,
    rasterLayerHeight: rasterLayers[0]?.height ?? 0,
    rasterLayerData: rasterLayers[0]?.data ?? new Uint8Array(0),
    rasterLayerMatrix: rasterLayers[0]?.matrix ?? new Float32Array([1, 0, 0, 1, 0, 0]),
    endpoints,
    primitiveMeta,
    primitiveBounds,
    styles,
    bounds: combinedBounds,
    pageBounds,
    maxHalfWidth: Math.max(resolvedMaxHalfWidth, gradientMaxHalfWidth),
    imagePaintOpCount,
    operatorCount: operatorList.fnArray.length,
    pathCount,
    discardedTransparentCount,
    discardedDegenerateCount,
    discardedDuplicateCount,
    discardedContainedCount
  };
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
      textInstanceB[dst + 3] = scene.textInstanceB[src + 3];
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
    sourceTextCount: totalSourceTextCount,
    textInstanceCount: totalTextInstanceCount,
    textGlyphCount: totalTextGlyphCount,
    textGlyphSegmentCount: totalTextGlyphSegmentCount,
    textInPageCount: totalTextInPageCount,
    textOutOfPageCount: totalTextOutOfPageCount,
    textInstanceA,
    textInstanceB,
    textInstanceC,
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

function createDefaultState(initialMatrix: Mat2D = IDENTITY_MATRIX, initialClipBounds: Bounds | null = null): GraphicsState {
  return {
    matrix: [...initialMatrix],
    clipBounds: cloneBoundsOrNull(initialClipBounds),
    clipMask: null,
    groupFillAlpha: 1,
    groupStrokeAlpha: 1,
    groupFillAlphaVersion: -1,
    groupStrokeAlphaVersion: -1,
    fillAlphaVersion: 0,
    strokeAlphaVersion: 0,
    lineWidth: 1,
    lineCap: 0,
    lineDash: [],
    dashPhase: 0,
    strokeR: 0,
    strokeG: 0,
    strokeB: 0,
    strokeAlpha: 1,
    fillR: 0,
    fillG: 0,
    fillB: 0,
    fillAlpha: 1
  };
}

function buildPageMatrix(page: {
  rotate: number;
  getViewport: (params: { scale: number; rotation?: number; dontFlip?: boolean }) => { transform: unknown; height: number };
}): Mat2D {
  const rotation = normalizeRotationDegrees(page.rotate);
  const viewport = page.getViewport({ scale: 1, rotation, dontFlip: false });
  const transform = viewport.transform;

  if (!Array.isArray(transform) || transform.length < 6) {
    return [...IDENTITY_MATRIX];
  }

  const a = Number(transform[0]);
  const b = Number(transform[1]);
  const c = Number(transform[2]);
  const d = Number(transform[3]);
  const e = Number(transform[4]);
  const f = Number(transform[5]);

  if (![a, b, c, d, e, f].every(Number.isFinite)) {
    return [...IDENTITY_MATRIX];
  }

  const viewportHeight = Number(viewport.height);
  if (!Number.isFinite(viewportHeight)) {
    return [a, b, c, d, e, f];
  }

  // PDF.js display viewport is Y-down by default; convert to Y-up world space.
  return multiplyMatrices([1, 0, 0, -1, 0, viewportHeight], [a, b, c, d, e, f]);
}

async function extractPageTextContent(page: unknown): Promise<SceneTextItem[]> {
  const textPage = page as { getTextContent?: () => Promise<{ items?: unknown[] }> };
  if (typeof textPage.getTextContent !== "function") {
    return [];
  }

  let content: { items?: unknown[] };
  try {
    content = await textPage.getTextContent();
  } catch {
    return [];
  }

  const pageMatrix = buildPageMatrix(page as {
    rotate: number;
    getViewport: (params: { scale: number; rotation?: number; dontFlip?: boolean }) => { transform: unknown; height: number };
  });
  const rawItems = Array.isArray(content.items) ? content.items : [];
  const items: SceneTextItem[] = [];

  for (const raw of rawItems) {
    const item = raw as { str?: unknown; transform?: unknown; width?: unknown; height?: unknown };
    const text = typeof item.str === "string" ? item.str : "";
    if (text.trim().length === 0 || !Array.isArray(item.transform) || item.transform.length < 6) {
      continue;
    }

    const a = Number(item.transform[0]);
    const b = Number(item.transform[1]);
    const c = Number(item.transform[2]);
    const d = Number(item.transform[3]);
    const e = Number(item.transform[4]);
    const f = Number(item.transform[5]);
    const width = Number(item.width);
    const height = Number(item.height);
    if (![a, b, c, d, e, f, width, height].every(Number.isFinite)) {
      continue;
    }

    // The transform's columns carry the baseline/up directions with the font size baked
    // into their magnitudes, while width/height are already user-space lengths — so the
    // text rect is spanned by the *unit* directions scaled by width/height.
    const baselineScale = Math.hypot(a, b);
    const upScale = Math.hypot(c, d);
    const wx = baselineScale > 0 ? (a / baselineScale) * width : width;
    const wy = baselineScale > 0 ? (b / baselineScale) * width : 0;
    const ux = upScale > 0 ? (c / upScale) * height : 0;
    const uy = upScale > 0 ? (d / upScale) * height : height;

    const corners = [
      applyMatrix(pageMatrix, e, f),
      applyMatrix(pageMatrix, e + wx, f + wy),
      applyMatrix(pageMatrix, e + ux, f + uy),
      applyMatrix(pageMatrix, e + wx + ux, f + wy + uy)
    ];

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const corner of corners) {
      minX = Math.min(minX, corner[0]);
      minY = Math.min(minY, corner[1]);
      maxX = Math.max(maxX, corner[0]);
      maxY = Math.max(maxY, corner[1]);
    }

    items.push({ text, minX, minY, maxX, maxY, pageIndex: 0 });
  }

  return items;
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

function normalizeRotationDegrees(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  let normalized = value % 360;
  if (normalized < 0) {
    normalized += 360;
  }
  return normalized;
}

function resolveStandardFontDataUrl(): string | undefined {
  if (typeof window !== "undefined" && window.location) {
    return new URL("pdfjs-standard-fonts/", window.location.href).toString();
  }

  if (typeof window === "undefined") {
    // Node-side extraction (example ZIP generation) needs an explicit local font directory.
    const nodeFontUrl = new URL(
      /* @vite-ignore */
      "../node_modules/pdfjs-dist/standard_fonts/",
      import.meta.url
    );
    if (nodeFontUrl.protocol === "file:") {
      const directoryPath = decodeURIComponent(nodeFontUrl.pathname);
      return directoryPath.endsWith("/") ? directoryPath : `${directoryPath}/`;
    }
    return nodeFontUrl.toString();
  }

  return undefined;
}

function chooseRasterExtractionScale(baseWidth: number, baseHeight: number, targetScale: number): number {
  if (!Number.isFinite(baseWidth) || !Number.isFinite(baseHeight) || baseWidth <= 0 || baseHeight <= 0) {
    return 1;
  }

  let scale = Math.max(1, Math.min(RASTER_MAX_SCALE, Number.isFinite(targetScale) ? targetScale : 1));

  while (scale > 1) {
    const width = Math.max(1, Math.ceil(baseWidth * scale));
    const height = Math.max(1, Math.ceil(baseHeight * scale));
    if (width <= RASTER_MAX_DIMENSION && height <= RASTER_MAX_DIMENSION && width * height <= RASTER_MAX_PIXELS) {
      return scale;
    }

    scale *= 0.85;
    if (scale < 1.05) {
      return 1;
    }
  }

  return 1;
}

function cloneState(state: GraphicsState): GraphicsState {
  return {
    matrix: [...state.matrix],
    clipBounds: cloneBoundsOrNull(state.clipBounds),
    clipMask: cloneClipMaskOrNull(state.clipMask),
    groupFillAlpha: state.groupFillAlpha,
    groupStrokeAlpha: state.groupStrokeAlpha,
    groupFillAlphaVersion: state.groupFillAlphaVersion,
    groupStrokeAlphaVersion: state.groupStrokeAlphaVersion,
    fillAlphaVersion: state.fillAlphaVersion,
    strokeAlphaVersion: state.strokeAlphaVersion,
    lineWidth: state.lineWidth,
    lineCap: state.lineCap,
    lineDash: [...state.lineDash],
    dashPhase: state.dashPhase,
    strokeR: state.strokeR,
    strokeG: state.strokeG,
    strokeB: state.strokeB,
    strokeAlpha: state.strokeAlpha,
    fillR: state.fillR,
    fillG: state.fillG,
    fillB: state.fillB,
    fillAlpha: state.fillAlpha
  };
}

interface FontPathInfoLike {
  path?: unknown;
}

interface FontLike {
  loadedName?: string;
  fontMatrix?: unknown;
  vertical?: boolean;
}

interface GlyphTokenLike {
  fontChar?: unknown;
  unicode?: unknown;
  width?: unknown;
  isSpace?: unknown;
}

interface TextExtractResult {
  sourceTextCount: number;
  instanceCount: number;
  glyphCount: number;
  glyphSegmentCount: number;
  inPageCount: number;
  outOfPageCount: number;
  instanceA: Float32Array;
  instanceB: Float32Array;
  instanceC: Float32Array;
  glyphMetaA: Float32Array;
  glyphMetaB: Float32Array;
  glyphSegmentsA: Float32Array;
  glyphSegmentsB: Float32Array;
  bounds: Bounds | null;
  textIndexPage: PageTextIndex;
}

interface ExtractedRasterLayer {
  width: number;
  height: number;
  data: Uint8Array;
  matrix: Mat2D;
  /** Dense display-list paint ordinal used while assembling the page. */
  paintOrder: number;
  pageIndex: number;
}

interface RasterLayerExtractResult {
  layers: ExtractedRasterLayer[];
  bounds: Bounds | null;
  /** Source-list paints already represented by a captured soft-mask composite. */
  suppressedSourcePaintMask?: Uint8Array;
  /** A native sparse plan must be disabled and raster extraction retried atomically. */
  nativeOrderingFailed?: boolean;
}

interface RasterLayerExtractOptions {
  allowFullPageFallback: boolean;
  preparedDisplayOperatorList?: PdfOperatorListLike | null;
  nativeSourcePlan?: NativeGradientPlan | null;
  nativeDisplayPlan?: NativeGradientPlan | null;
}

interface NativeGradientDefinition {
  kind: 0 | 1;
  sceneToGradient: Mat2D;
  p0: [number, number];
  p1: [number, number];
  r0: number;
  r1: number;
  bbox: [number, number, number, number] | null;
  lut: Uint8Array;
}

interface NativeClipGeometry {
  pathData: Float32Array;
  matrix: Mat2D;
  fillRule: number;
  bounds: Bounds;
  isAxisAlignedRectangle: boolean;
}

interface NativeGradientPaintState {
  matrix: Mat2D;
  patternBaseMatrix: Mat2D;
  clipBounds: Bounds | null;
  clipGeometry: NativeClipGeometry | null;
  fillR: number;
  fillG: number;
  fillB: number;
  fillAlpha: number;
  groupFillAlpha: number;
  fillAlphaVersion: number;
  groupFillAlphaVersion: number;
  strokeR: number;
  strokeG: number;
  strokeB: number;
  strokeAlpha: number;
  groupStrokeAlpha: number;
  strokeAlphaVersion: number;
  groupStrokeAlphaVersion: number;
  lineWidth: number;
  lineCap: number;
  lineDash: number[];
  dashPhase: number;
  fillPattern: NativePatternReference | null;
  strokePattern: NativePatternReference | null;
  blendMode: string;
}

interface NativePatternReference {
  patternId: string;
  matrix: Mat2D;
}

interface NativeGradientPaint {
  opIndex: number;
  paintOrdinal: number;
  kind: "fill" | "stroke";
  pathData: Float32Array;
  matrix: Mat2D;
  fillRule: number;
  state: NativeGradientPaintState;
  sourceGradientIndex: number;
  maskGradientIndex: number;
}

interface NativeGradientPlan {
  gradients: NativeGradientDefinition[];
  paints: NativeGradientPaint[];
  nativePathPaintMask: Uint8Array;
  rasterExcludedPaintMask: Uint8Array;
  paintTopologySignature: string;
  nativeTopologySignature: string;
}

interface RasterRenderSurface {
  context: CanvasRenderingContext2D | { getImageData: (x: number, y: number, width: number, height: number) => { data: Uint8Array | Uint8ClampedArray } };
  dispose: () => void;
}

let cachedNodeCanvasModule:
  | {
    createCanvas: (width: number, height: number) => {
      width: number;
      height: number;
      getContext: (kind: "2d") => unknown;
    };
  }
  | null
  | undefined;

interface TextGlyphBuildResult {
  segmentCount: number;
  bounds: Bounds;
}

interface CommonObjsLike {
  get(id: string): unknown;
  has?(id: string): boolean;
}

interface TextState {
  matrix: Mat2D;
  groupFillAlpha: number;
  groupFillAlphaVersion: number;
  fillAlphaVersion: number;
  fillR: number;
  fillG: number;
  fillB: number;
  fillAlpha: number;
  textMatrix: Mat2D;
  textX: number;
  textY: number;
  lineX: number;
  lineY: number;
  charSpacing: number;
  wordSpacing: number;
  textHScale: number;
  leading: number;
  textRise: number;
  renderMode: number;
  fontRef: string;
  fontSize: number;
  fontDirection: number;
}

function readTransform(args: unknown): Mat2D | null {
  const topLevel = asNumberArrayLike(args);
  if (!topLevel) {
    return null;
  }

  const nested = Array.isArray(args) ? asNumberArrayLike(args[0]) : null;
  const matrixArgs = topLevel.length >= 6 ? topLevel : nested;
  if (!matrixArgs || matrixArgs.length < 6) {
    return null;
  }

  const a = Number(matrixArgs[0]);
  const b = Number(matrixArgs[1]);
  const c = Number(matrixArgs[2]);
  const d = Number(matrixArgs[3]);
  const e = Number(matrixArgs[4]);
  const f = Number(matrixArgs[5]);
  if (![a, b, c, d, e, f].every(Number.isFinite)) {
    return null;
  }
  return [a, b, c, d, e, f];
}

function readAnnotationTransform(args: unknown): Mat2D | null {
  const annotationPlacement = readTransformFromValue(readArg(args, 2));
  const annotationMatrix = readTransformFromValue(readArg(args, 3));
  if (annotationPlacement && annotationMatrix) {
    return multiplyMatrices(annotationPlacement, annotationMatrix);
  }
  return annotationPlacement ?? annotationMatrix;
}

function readTransformFromValue(value: unknown): Mat2D | null {
  const matrixArgs = asNumberArrayLike(value);
  if (!matrixArgs || matrixArgs.length < 6) {
    return null;
  }

  const a = Number(matrixArgs[0]);
  const b = Number(matrixArgs[1]);
  const c = Number(matrixArgs[2]);
  const d = Number(matrixArgs[3]);
  const e = Number(matrixArgs[4]);
  const f = Number(matrixArgs[5]);
  if (![a, b, c, d, e, f].every(Number.isFinite)) {
    return null;
  }
  return [a, b, c, d, e, f];
}

function asNumberArrayLike(value: unknown): ArrayLike<unknown> | null {
  if (Array.isArray(value)) {
    return value;
  }

  if (ArrayBuffer.isView(value)) {
    return value as unknown as ArrayLike<unknown>;
  }

  return null;
}

function readPathData(args: unknown): Float32Array | null {
  if (!Array.isArray(args) || args.length < 2) {
    return null;
  }
  const data = args[1];
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }
  const first = data[0];
  return first instanceof Float32Array ? first : null;
}

function readArg(args: unknown, index: number): unknown {
  if (!Array.isArray(args)) {
    return undefined;
  }
  return args[index];
}

function readNumber(args: unknown, index: number, fallback: number): number {
  const raw = readArg(args, index);
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function readLineDash(value: unknown): { pattern: number[]; phase: number } | null {
  const rawPattern = asNumberArrayLike(readArg(value, 0));
  if (!rawPattern) {
    return null;
  }

  const pattern: number[] = [];
  let patternLength = 0;
  for (let i = 0; i < rawPattern.length; i += 1) {
    const entry = Number(rawPattern[i]);
    if (!Number.isFinite(entry) || entry < 0) {
      return null;
    }
    pattern.push(entry);
    patternLength += entry;
  }

  // PDF repeats an odd-sized dash array to produce an even number of on/off
  // intervals. Normalize it here so phase wrapping has the correct period.
  if (pattern.length % 2 === 1) {
    pattern.push(...pattern);
    patternLength *= 2;
  }

  if (patternLength <= 1e-9) {
    pattern.length = 0;
  }

  const rawPhase = Number(readArg(value, 1));
  return {
    pattern,
    phase: Number.isFinite(rawPhase) ? rawPhase : 0
  };
}

function isStrokePaintOp(op: number): boolean {
  return (
    op === OPS.stroke ||
    op === OPS.closeStroke ||
    op === OPS.fillStroke ||
    op === OPS.eoFillStroke ||
    op === OPS.closeFillStroke ||
    op === OPS.closeEOFillStroke
  );
}

function isFillPaintOp(op: number): boolean {
  return (
    op === OPS.fill ||
    op === OPS.eoFill ||
    op === OPS.fillStroke ||
    op === OPS.eoFillStroke ||
    op === OPS.closeFillStroke ||
    op === OPS.closeEOFillStroke
  );
}

function isEvenOddFillPaintOp(op: number): boolean {
  return op === OPS.eoFill || op === OPS.eoFillStroke || op === OPS.closeEOFillStroke;
}

function parseGrayColor(value: unknown, fallback: number): RgbColor {
  const gray = Number(value);
  if (Number.isFinite(gray)) {
    const normalized = clamp01(gray > 1 ? gray / 255 : gray);
    return [normalized, normalized, normalized];
  }
  return [fallback, fallback, fallback];
}

function parseColor(value: unknown, fallback: RgbColor): RgbColor {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = clamp01(value > 1 ? value / 255 : value);
    return [normalized, normalized, normalized];
  }

  if (typeof value === "string") {
    if (value.startsWith("#") && (value.length === 7 || value.length === 4)) {
      const [r, g, b] = parseHexColor(value);
      return [clamp01(r / 255), clamp01(g / 255), clamp01(b / 255)];
    }
  }

  if (Array.isArray(value) && value.length >= 3) {
    const r = Number(value[0]);
    const g = Number(value[1]);
    const b = Number(value[2]);
    if ([r, g, b].every(Number.isFinite)) {
      return [
        clamp01(r > 1 ? r / 255 : r),
        clamp01(g > 1 ? g / 255 : g),
        clamp01(b > 1 ? b / 255 : b)
      ];
    }
  }

  return [fallback[0], fallback[1], fallback[2]];
}

function parseColorFromOperatorArgs(args: unknown, fallback: RgbColor): RgbColor {
  if (!Array.isArray(args)) {
    return parseColor(args, fallback);
  }

  if (args.length >= 3 && args.slice(0, 3).every((entry) => Number.isFinite(Number(entry)))) {
    return parseColor([args[0], args[1], args[2]], fallback);
  }

  if (args.length > 0) {
    return parseColor(args[0], fallback);
  }

  return [fallback[0], fallback[1], fallback[2]];
}

function parseCmykColorFromOperatorArgs(args: unknown, fallback: RgbColor): RgbColor {
  if (!Array.isArray(args) || args.length < 4) {
    return parseColorFromOperatorArgs(args, fallback);
  }

  const c = normalizeColorComponent(args[0]);
  const m = normalizeColorComponent(args[1]);
  const y = normalizeColorComponent(args[2]);
  const k = normalizeColorComponent(args[3]);
  if ([c, m, y, k].some((component) => component === null)) {
    return parseColorFromOperatorArgs(args, fallback);
  }

  const cyan = c as number;
  const magenta = m as number;
  const yellow = y as number;
  const black = k as number;

  const r = 1 - Math.min(1, cyan + black);
  const g = 1 - Math.min(1, magenta + black);
  const b = 1 - Math.min(1, yellow + black);
  return [clamp01(r), clamp01(g), clamp01(b)];
}

function normalizeColorComponent(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const normalized = numeric > 1 ? numeric / 100 : numeric;
  return clamp01(normalized);
}

function parseHexColor(hex: string): [number, number, number] {
  if (hex.length === 4) {
    const r = Number.parseInt(hex[1] + hex[1], 16);
    const g = Number.parseInt(hex[2] + hex[2], 16);
    const b = Number.parseInt(hex[3] + hex[3], 16);
    return [r, g, b];
  }

  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function applyGraphicsStateEntries(rawEntries: unknown, state: GraphicsState): void {
  if (!Array.isArray(rawEntries)) {
    return;
  }

  for (const pair of rawEntries) {
    if (!Array.isArray(pair) || pair.length < 2) {
      continue;
    }

    const key = pair[0];
    const value = pair[1];

    if (key === "CA") {
      const alpha = Number(value);
      if (Number.isFinite(alpha)) {
        state.strokeAlpha = clamp01(alpha);
        state.strokeAlphaVersion += 1;
      }
      continue;
    }

    if (key === "ca") {
      const alpha = Number(value);
      if (Number.isFinite(alpha)) {
        state.fillAlpha = clamp01(alpha);
        state.fillAlphaVersion += 1;
      }
      continue;
    }

    if (key === "LW") {
      const lineWidth = Number(value);
      if (Number.isFinite(lineWidth)) {
        state.lineWidth = Math.max(0, lineWidth);
      }
      continue;
    }

    if (key === "LC") {
      const lineCap = Number(value);
      if (Number.isFinite(lineCap)) {
        state.lineCap = Math.min(2, Math.max(0, Math.trunc(lineCap)));
      }
      continue;
    }

    if (key === "D") {
      const nextDash = readLineDash(value);
      if (nextDash) {
        state.lineDash = nextDash.pattern;
        state.dashPhase = nextDash.phase;
      }
    }
  }
}

function effectiveFillAlpha(state: GraphicsState): number {
  if (state.fillAlphaVersion === state.groupFillAlphaVersion) {
    return clamp01(state.groupFillAlpha);
  }
  return clamp01(state.groupFillAlpha * state.fillAlpha);
}

function effectiveStrokeAlpha(state: GraphicsState): number {
  if (state.strokeAlphaVersion === state.groupStrokeAlphaVersion) {
    return clamp01(state.groupStrokeAlpha);
  }
  return clamp01(state.groupStrokeAlpha * state.strokeAlpha);
}

function emitSegmentsFromPath(
  pathData: Float32Array,
  matrix: Mat2D,
  halfWidth: number,
  colorR: number,
  colorG: number,
  colorB: number,
  alpha: number,
  styleFlags: number,
  lineDash: number[],
  dashPhase: number,
  allowSegmentMerge: boolean,
  endpoints: Float4Builder,
  primitiveMeta: Float4Builder,
  styles: Float4Builder,
  primitiveBounds: Float4Builder,
  bounds: Bounds,
  clipBounds: Bounds | null,
  clipExpandedStroke = true
): number {
  let sourceSegmentCount = 0;
  let cursorX = 0;
  let cursorY = 0;
  let startX = 0;
  let startY = 0;
  let hasStart = false;

  let pendingX0 = 0;
  let pendingY0 = 0;
  let pendingX1 = 0;
  let pendingY1 = 0;
  let hasPending = false;

  const dashScale = matrixScale(matrix);
  const dashPattern = lineDash.map((entry) => entry * dashScale);
  const dashPatternLength = dashPattern.reduce((sum, entry) => sum + entry, 0);
  const hasDashPattern = dashPattern.length > 0 && dashPatternLength > 1e-9;
  let dashIndex = 0;
  let dashRemaining = Number.POSITIVE_INFINITY;
  let dashPaint = true;

  const emitPrimitive = (
    p0x: number,
    p0y: number,
    p1x: number,
    p1y: number,
    p2x: number,
    p2y: number,
    primitiveType: number
  ): void => {
    const minX = Math.min(p0x, p1x, p2x);
    const minY = Math.min(p0y, p1y, p2y);
    const maxX = Math.max(p0x, p1x, p2x);
    const maxY = Math.max(p0y, p1y, p2y);
    const geometryBounds = { minX, minY, maxX, maxY };
    const paintBounds = clipExpandedStroke
      ? {
        minX: minX - halfWidth,
        minY: minY - halfWidth,
        maxX: maxX + halfWidth,
        maxY: maxY + halfWidth
      }
      : geometryBounds;
    const visiblePaintBounds = clipBounds ? intersectBounds(clipBounds, paintBounds) : { ...paintBounds };
    if (!isNonEmptyBounds(visiblePaintBounds)) {
      return;
    }
    const wasClipped =
      Boolean(clipBounds) &&
      (visiblePaintBounds.minX > paintBounds.minX + 1e-6 ||
        visiblePaintBounds.minY > paintBounds.minY + 1e-6 ||
        visiblePaintBounds.maxX < paintBounds.maxX - 1e-6 ||
        visiblePaintBounds.maxY < paintBounds.maxY - 1e-6);
    const visibleBounds = wasClipped ? visiblePaintBounds : geometryBounds;

    endpoints.push(p0x, p0y, p1x, p1y);
    const visibleStyleFlags = wasClipped ? styleFlags | STROKE_STYLE_FLAG_CLIPPED : styleFlags;
    primitiveMeta.push(p2x, p2y, primitiveType, encodeStrokeStyleMeta(alpha, visibleStyleFlags));
    styles.push(halfWidth, colorR, colorG, colorB);
    primitiveBounds.push(visibleBounds.minX, visibleBounds.minY, visibleBounds.maxX, visibleBounds.maxY);

    bounds.minX = Math.min(bounds.minX, visibleBounds.minX);
    bounds.minY = Math.min(bounds.minY, visibleBounds.minY);
    bounds.maxX = Math.max(bounds.maxX, visibleBounds.maxX);
    bounds.maxY = Math.max(bounds.maxY, visibleBounds.maxY);
  };

  const flushPending = (): void => {
    if (!hasPending) {
      return;
    }

    emitPrimitive(
      pendingX0,
      pendingY0,
      pendingX1,
      pendingY1,
      pendingX1,
      pendingY1,
      STROKE_PRIMITIVE_LINE
    );

    hasPending = false;
  };

  const tryMergePending = (x0: number, y0: number, x1: number, y1: number): boolean => {
    if (!hasPending) {
      return false;
    }

    const joinDx = x0 - pendingX1;
    const joinDy = y0 - pendingY1;
    if (joinDx * joinDx + joinDy * joinDy > SEGMENT_JOIN_EPSILON * SEGMENT_JOIN_EPSILON) {
      return false;
    }

    const baseDx = pendingX1 - pendingX0;
    const baseDy = pendingY1 - pendingY0;
    const nextDx = x1 - x0;
    const nextDy = y1 - y0;

    const baseLenSq = baseDx * baseDx + baseDy * baseDy;
    const nextLenSq = nextDx * nextDx + nextDy * nextDy;
    if (baseLenSq < 1e-10 || nextLenSq < 1e-10) {
      return false;
    }

    const invLenProduct = 1 / Math.sqrt(baseLenSq * nextLenSq);
    const dot = (baseDx * nextDx + baseDy * nextDy) * invLenProduct;
    if (dot < COLLINEAR_DOT_THRESHOLD) {
      return false;
    }

    const chainDx = x1 - pendingX0;
    const chainDy = y1 - pendingY0;
    const perpDistSq = crossDistanceSq(chainDx, chainDy, baseDx, baseDy, baseLenSq);
    if (perpDistSq > COLLINEAR_PERP_EPSILON * COLLINEAR_PERP_EPSILON) {
      return false;
    }

    pendingX1 = x1;
    pendingY1 = y1;
    return true;
  };

  const emitLine = (x0: number, y0: number, x1: number, y1: number, allowMerge: boolean): void => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq < 1e-10) {
      // Round-cap zero-length strokes are rendered as point dots in PDFs.
      if ((styleFlags & STROKE_STYLE_FLAG_ROUND_CAP) === 0) {
        return;
      }
      sourceSegmentCount += 1;
      flushPending();
      emitPrimitive(x0, y0, x1, y1, x1, y1, STROKE_PRIMITIVE_LINE);
      return;
    }

    sourceSegmentCount += 1;

    if (allowSegmentMerge && allowMerge && tryMergePending(x0, y0, x1, y1)) {
      return;
    }

    if (allowSegmentMerge) {
      flushPending();
      pendingX0 = x0;
      pendingY0 = y0;
      pendingX1 = x1;
      pendingY1 = y1;
      hasPending = true;
      return;
    }

    emitPrimitive(x0, y0, x1, y1, x1, y1, STROKE_PRIMITIVE_LINE);
  };

  const advanceDashInterval = (): void => {
    if (!hasDashPattern) {
      dashRemaining = Number.POSITIVE_INFINITY;
      dashPaint = true;
      return;
    }

    // Zero-length intervals are legal as long as the whole pattern is not zero.
    // Skip them while retaining their on/off transition.
    for (let guard = 0; guard <= dashPattern.length; guard += 1) {
      dashIndex = (dashIndex + 1) % dashPattern.length;
      dashPaint = !dashPaint;
      dashRemaining = dashPattern[dashIndex];
      if (dashRemaining > 1e-9) {
        return;
      }
    }
  };

  const resetDashCursor = (): void => {
    if (!hasDashPattern) {
      dashIndex = 0;
      dashRemaining = Number.POSITIVE_INFINITY;
      dashPaint = true;
      return;
    }

    dashIndex = 0;
    dashRemaining = dashPattern[0];
    dashPaint = true;
    if (dashRemaining <= 1e-9) {
      advanceDashInterval();
    }

    let phase = dashPhase * dashScale;
    phase = ((phase % dashPatternLength) + dashPatternLength) % dashPatternLength;
    while (phase > 1e-9) {
      if (phase < dashRemaining - 1e-9) {
        dashRemaining -= phase;
        phase = 0;
      } else {
        phase -= dashRemaining;
        advanceDashInterval();
      }
    }
  };

  const emitStrokedLine = (x0: number, y0: number, x1: number, y1: number, allowMerge: boolean): void => {
    if (!hasDashPattern) {
      emitLine(x0, y0, x1, y1, allowMerge);
      return;
    }

    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    if (length <= 1e-9) {
      if (dashPaint) {
        emitLine(x0, y0, x1, y1, false);
      }
      return;
    }

    let consumed = 0;
    while (consumed < length - 1e-9) {
      const spanLength = Math.min(length - consumed, dashRemaining);
      const nextConsumed = consumed + spanLength;
      if (dashPaint && spanLength > 1e-9) {
        const startT = consumed / length;
        const endT = nextConsumed / length;
        emitLine(
          x0 + dx * startT,
          y0 + dy * startT,
          x0 + dx * endT,
          y0 + dy * endT,
          allowMerge
        );
      } else {
        flushPending();
      }

      consumed = nextConsumed;
      dashRemaining -= spanLength;
      if (dashRemaining <= 1e-9) {
        advanceDashInterval();
        if (!dashPaint) {
          flushPending();
        }
      }
    }
  };

  const emitQuadratic = (x0: number, y0: number, cx: number, cy: number, x1: number, y1: number): void => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const cdx = cx - x0;
    const cdy = cy - y0;
    if (dx * dx + dy * dy < 1e-10 && cdx * cdx + cdy * cdy < 1e-10) {
      return;
    }

    sourceSegmentCount += 1;
    flushPending();
    emitPrimitive(x0, y0, cx, cy, x1, y1, STROKE_PRIMITIVE_QUADRATIC);
  };

  resetDashCursor();

  for (let i = 0; i < pathData.length; ) {
    const op = pathData[i++];

    if (op === DRAW_MOVE_TO) {
      flushPending();
      cursorX = pathData[i++];
      cursorY = pathData[i++];
      startX = cursorX;
      startY = cursorY;
      hasStart = true;
      resetDashCursor();
      continue;
    }

    if (op === DRAW_LINE_TO) {
      const x = pathData[i++];
      const y = pathData[i++];
      const [tx0, ty0] = applyMatrix(matrix, cursorX, cursorY);
      const [tx1, ty1] = applyMatrix(matrix, x, y);
      emitStrokedLine(tx0, ty0, tx1, ty1, true);
      cursorX = x;
      cursorY = y;
      continue;
    }

    if (op === DRAW_CURVE_TO) {
      const x1 = pathData[i++];
      const y1 = pathData[i++];
      const x2 = pathData[i++];
      const y2 = pathData[i++];
      const x3 = pathData[i++];
      const y3 = pathData[i++];

      const [t0x, t0y] = applyMatrix(matrix, cursorX, cursorY);
      const [t1x, t1y] = applyMatrix(matrix, x1, y1);
      const [t2x, t2y] = applyMatrix(matrix, x2, y2);
      const [t3x, t3y] = applyMatrix(matrix, x3, y3);

      if (hasDashPattern) {
        flattenCubic(
          t0x,
          t0y,
          t1x,
          t1y,
          t2x,
          t2y,
          t3x,
          t3y,
          (ax, ay, bx, by) => emitStrokedLine(ax, ay, bx, by, true),
          CURVE_FLATNESS,
          MAX_CURVE_SPLIT_DEPTH
        );
      } else {
        emitCubicAsQuadratics(
          t0x,
          t0y,
          t1x,
          t1y,
          t2x,
          t2y,
          t3x,
          t3y,
          emitQuadratic,
          FILL_CUBIC_TO_QUAD_ERROR,
          MAX_FILL_CUBIC_TO_QUAD_DEPTH
        );
      }

      cursorX = x3;
      cursorY = y3;
      continue;
    }

    if (op === DRAW_QUAD_TO) {
      const cx = pathData[i++];
      const cy = pathData[i++];
      const x = pathData[i++];
      const y = pathData[i++];

      const [t0x, t0y] = applyMatrix(matrix, cursorX, cursorY);
      const [tcx, tcy] = applyMatrix(matrix, cx, cy);
      const [t1x, t1y] = applyMatrix(matrix, x, y);

      if (hasDashPattern) {
        const c1x = t0x + (2 / 3) * (tcx - t0x);
        const c1y = t0y + (2 / 3) * (tcy - t0y);
        const c2x = t1x + (2 / 3) * (tcx - t1x);
        const c2y = t1y + (2 / 3) * (tcy - t1y);
        flattenCubic(
          t0x,
          t0y,
          c1x,
          c1y,
          c2x,
          c2y,
          t1x,
          t1y,
          (ax, ay, bx, by) => emitStrokedLine(ax, ay, bx, by, true),
          CURVE_FLATNESS,
          MAX_CURVE_SPLIT_DEPTH
        );
      } else {
        emitQuadratic(t0x, t0y, tcx, tcy, t1x, t1y);
      }

      cursorX = x;
      cursorY = y;
      continue;
    }

    if (op === DRAW_CLOSE) {
      if (hasStart && (cursorX !== startX || cursorY !== startY)) {
        const [tx0, ty0] = applyMatrix(matrix, cursorX, cursorY);
        const [tx1, ty1] = applyMatrix(matrix, startX, startY);
        emitStrokedLine(tx0, ty0, tx1, ty1, true);
      }
      cursorX = startX;
      cursorY = startY;
      flushPending();
      continue;
    }

    flushPending();
    break;
  }

  flushPending();
  return sourceSegmentCount;
}

function emitFilledPathFromPath(
  pathData: Float32Array,
  matrix: Mat2D,
  fillRule: number,
  hasCompanionStroke: boolean,
  colorR: number,
  colorG: number,
  colorB: number,
  alpha: number,
  metaA: Float4Builder,
  metaB: Float4Builder,
  metaC: Float4Builder,
  segmentsA: Float4Builder,
  segmentsB: Float4Builder,
  bounds: Bounds,
  clipBounds: Bounds | null,
  clipMask: ClipMask | null,
  pageBounds: Bounds,
  allowSubpathSplit = true,
  allowOpaqueWhiteCull = true
): number {
  if (allowSubpathSplit && fillRule === FILL_RULE_NONZERO && countPathMoveOps(pathData) >= FILL_SUBPATH_SPLIT_MIN_SUBPATHS) {
    const splitPaths = splitPathIntoDrawableSubpaths(pathData, matrix, clipBounds);
    if (splitPaths.length > 1) {
      let emittedCount = 0;
      for (const splitPath of splitPaths) {
        const splitClipBounds = splitPath.clipBounds ? intersectBounds(clipBounds, splitPath.clipBounds) : clipBounds;
        emittedCount += emitFilledPathFromPath(
          splitPath.data,
          matrix,
          fillRule,
          hasCompanionStroke,
          colorR,
          colorG,
          colorB,
          alpha,
          metaA,
          metaB,
          metaC,
          segmentsA,
          segmentsB,
          bounds,
          splitClipBounds,
          clipMask,
          pageBounds,
          false,
          allowOpaqueWhiteCull
        );
      }
      return emittedCount;
    }
  }

  let cursorX = 0;
  let cursorY = 0;
  let startX = 0;
  let startY = 0;
  let hasStart = false;

  const segmentStart = segmentsA.quadCount;
  let primitiveCount = 0;

  const localBounds: Bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };

  const emitLine = (x0: number, y0: number, x1: number, y1: number): void => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (dx * dx + dy * dy < 1e-12) {
      return;
    }

    segmentsA.push(x0, y0, x1, y1);
    segmentsB.push(x1, y1, FILL_PRIMITIVE_LINE, 0);
    primitiveCount += 1;

    localBounds.minX = Math.min(localBounds.minX, x0, x1);
    localBounds.minY = Math.min(localBounds.minY, y0, y1);
    localBounds.maxX = Math.max(localBounds.maxX, x0, x1);
    localBounds.maxY = Math.max(localBounds.maxY, y0, y1);
  };

  const emitQuadratic = (x0: number, y0: number, cx: number, cy: number, x1: number, y1: number): void => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const cdx = cx - x0;
    const cdy = cy - y0;
    if (dx * dx + dy * dy < 1e-12 && cdx * cdx + cdy * cdy < 1e-12) {
      return;
    }

    segmentsA.push(x0, y0, cx, cy);
    segmentsB.push(x1, y1, FILL_PRIMITIVE_QUADRATIC, 0);
    primitiveCount += 1;

    localBounds.minX = Math.min(localBounds.minX, x0, cx, x1);
    localBounds.minY = Math.min(localBounds.minY, y0, cy, y1);
    localBounds.maxX = Math.max(localBounds.maxX, x0, cx, x1);
    localBounds.maxY = Math.max(localBounds.maxY, y0, cy, y1);
  };

  const closeSubpath = (): void => {
    if (!hasStart) {
      return;
    }
    if (cursorX !== startX || cursorY !== startY) {
      const [tx0, ty0] = applyMatrix(matrix, cursorX, cursorY);
      const [tx1, ty1] = applyMatrix(matrix, startX, startY);
      emitLine(tx0, ty0, tx1, ty1);
    }
    cursorX = startX;
    cursorY = startY;
  };

  for (let i = 0; i < pathData.length; ) {
    const op = pathData[i++];

    if (op === DRAW_MOVE_TO) {
      closeSubpath();
      cursorX = pathData[i++];
      cursorY = pathData[i++];
      startX = cursorX;
      startY = cursorY;
      hasStart = true;
      continue;
    }

    if (op === DRAW_LINE_TO) {
      const x = pathData[i++];
      const y = pathData[i++];
      const [tx0, ty0] = applyMatrix(matrix, cursorX, cursorY);
      const [tx1, ty1] = applyMatrix(matrix, x, y);
      emitLine(tx0, ty0, tx1, ty1);
      cursorX = x;
      cursorY = y;
      continue;
    }

    if (op === DRAW_CURVE_TO) {
      const x1 = pathData[i++];
      const y1 = pathData[i++];
      const x2 = pathData[i++];
      const y2 = pathData[i++];
      const x3 = pathData[i++];
      const y3 = pathData[i++];

      const [t0x, t0y] = applyMatrix(matrix, cursorX, cursorY);
      const [t1x, t1y] = applyMatrix(matrix, x1, y1);
      const [t2x, t2y] = applyMatrix(matrix, x2, y2);
      const [t3x, t3y] = applyMatrix(matrix, x3, y3);

      emitCubicAsQuadratics(
        t0x,
        t0y,
        t1x,
        t1y,
        t2x,
        t2y,
        t3x,
        t3y,
        emitQuadratic,
        FILL_CUBIC_TO_QUAD_ERROR,
        MAX_FILL_CUBIC_TO_QUAD_DEPTH
      );

      cursorX = x3;
      cursorY = y3;
      continue;
    }

    if (op === DRAW_QUAD_TO) {
      const cx = pathData[i++];
      const cy = pathData[i++];
      const x = pathData[i++];
      const y = pathData[i++];

      const [t0x, t0y] = applyMatrix(matrix, cursorX, cursorY);
      const [tcx, tcy] = applyMatrix(matrix, cx, cy);
      const [t1x, t1y] = applyMatrix(matrix, x, y);

      emitQuadratic(t0x, t0y, tcx, tcy, t1x, t1y);

      cursorX = x;
      cursorY = y;
      continue;
    }

    if (op === DRAW_CLOSE) {
      closeSubpath();
      continue;
    }

    closeSubpath();
    break;
  }

  closeSubpath();

  if (primitiveCount === 0) {
    segmentsA.truncateQuads(segmentStart);
    segmentsB.truncateQuads(segmentStart);
    return 0;
  }

  const visibleBounds = clipBounds ? intersectBounds(clipBounds, localBounds) : { ...localBounds };
  if (!isNonEmptyBounds(visibleBounds)) {
    segmentsA.truncateQuads(segmentStart);
    segmentsB.truncateQuads(segmentStart);
    return 0;
  }

  const clipConstrainedPath = createClipConstrainedFillPath(pathData, matrix, localBounds, visibleBounds, clipMask);
  if (clipConstrainedPath) {
    segmentsA.truncateQuads(segmentStart);
    segmentsB.truncateQuads(segmentStart);
    return emitFilledPathFromPath(
      clipConstrainedPath,
      IDENTITY_MATRIX,
      FILL_RULE_EVEN_ODD,
      hasCompanionStroke,
      colorR,
      colorG,
      colorB,
      alpha,
      metaA,
      metaB,
      metaC,
      segmentsA,
      segmentsB,
      bounds,
      null,
      null,
      pageBounds,
      false,
      allowOpaqueWhiteCull
    );
  }

  if (allowOpaqueWhiteCull && isOpaqueWhiteBackgroundFill(visibleBounds, pageBounds, colorR, colorG, colorB, alpha)) {
    segmentsA.truncateQuads(segmentStart);
    segmentsB.truncateQuads(segmentStart);
    return 0;
  }

  metaA.push(segmentStart, primitiveCount, visibleBounds.minX, visibleBounds.minY);
  metaB.push(visibleBounds.maxX, visibleBounds.maxY, colorR, colorG);
  metaC.push(fillRule, hasCompanionStroke ? 1 : 0, colorB, alpha);

  bounds.minX = Math.min(bounds.minX, visibleBounds.minX);
  bounds.minY = Math.min(bounds.minY, visibleBounds.minY);
  bounds.maxX = Math.max(bounds.maxX, visibleBounds.maxX);
  bounds.maxY = Math.max(bounds.maxY, visibleBounds.maxY);

  return 1;
}

function countPathMoveOps(pathData: Float32Array): number {
  let moveCount = 0;
  for (let i = 0; i < pathData.length; ) {
    const op = pathData[i++];
    if (op === DRAW_MOVE_TO) {
      moveCount += 1;
      i += 2;
      continue;
    }
    if (op === DRAW_LINE_TO) {
      i += 2;
      continue;
    }
    if (op === DRAW_CURVE_TO) {
      i += 6;
      continue;
    }
    if (op === DRAW_QUAD_TO) {
      i += 4;
      continue;
    }
    if (op === DRAW_CLOSE) {
      continue;
    }
    break;
  }
  return moveCount;
}

function createClipConstrainedFillPath(
  pathData: Float32Array,
  matrix: Mat2D,
  localBounds: Bounds,
  visibleBounds: Bounds,
  clipMask: ClipMask | null
): Float32Array | null {
  if (!clipMask || clipMask.exclusionBounds.length === 0) {
    return null;
  }
  if (!boundsNearlyEqual(visibleBounds, clipMask.bounds)) {
    return null;
  }
  if (!boundsContainBoundsWithTolerance(localBounds, clipMask.bounds)) {
    return null;
  }
  if (!isAxisAlignedRectanglePath(pathData, matrix, localBounds)) {
    return null;
  }

  const exclusionBounds = clipMask.exclusionBounds.filter((bounds) => {
    return boundsContainBoundsWithTolerance(visibleBounds, bounds) && boundsArea(bounds) > 1e-6;
  });
  if (exclusionBounds.length === 0) {
    return null;
  }

  return createEvenOddRectanglePath(visibleBounds, exclusionBounds);
}

function extractSimpleEvenOddRectangleClipMask(pathData: Float32Array, matrix: Mat2D): ClipMask | null {
  const subpaths = collectFillSubpaths(pathData, matrix);
  if (subpaths.length < 2) {
    return null;
  }

  const rectangles: Bounds[] = [];
  for (const subpath of subpaths) {
    if (!isNonEmptyBounds(subpath.bounds) || !isAxisAlignedRectanglePath(subpath.data, matrix, subpath.bounds)) {
      return null;
    }
    rectangles.push(subpath.bounds);
  }

  rectangles.sort((a, b) => boundsArea(b) - boundsArea(a));
  const outerBounds = rectangles[0];
  const exclusionBounds = rectangles.slice(1).filter((bounds) => {
    return boundsArea(bounds) > 1e-6 && boundsContainBoundsWithTolerance(outerBounds, bounds);
  });

  if (exclusionBounds.length === 0) {
    return null;
  }

  return {
    bounds: { ...outerBounds },
    exclusionBounds: exclusionBounds.map((bounds) => ({ ...bounds }))
  };
}

function createEvenOddRectanglePath(outerBounds: Bounds, exclusionBounds: Bounds[]): Float32Array {
  const commands: number[] = [];
  appendRectanglePath(commands, outerBounds);
  for (const bounds of exclusionBounds) {
    appendRectanglePath(commands, bounds);
  }
  return new Float32Array(commands);
}

function appendRectanglePath(commands: number[], bounds: Bounds): void {
  commands.push(
    DRAW_MOVE_TO,
    bounds.minX,
    bounds.minY,
    DRAW_LINE_TO,
    bounds.maxX,
    bounds.minY,
    DRAW_LINE_TO,
    bounds.maxX,
    bounds.maxY,
    DRAW_LINE_TO,
    bounds.minX,
    bounds.maxY,
    DRAW_CLOSE
  );
}

function isAxisAlignedRectanglePath(pathData: Float32Array, matrix: Mat2D, bounds: Bounds): boolean {
  const width = Math.max(0, bounds.maxX - bounds.minX);
  const height = Math.max(0, bounds.maxY - bounds.minY);
  if (width <= 1e-6 || height <= 1e-6) {
    return false;
  }

  const epsilon = Math.max(1e-3, Math.max(width, height) * 1e-4);
  let cornerMask = 0;
  let moveCount = 0;
  let lineCount = 0;
  let valid = true;

  const recordPoint = (x: number, y: number): void => {
    if (!valid) {
      return;
    }
    const [tx, ty] = applyMatrix(matrix, x, y);
    const nearMinX = Math.abs(tx - bounds.minX) <= epsilon;
    const nearMaxX = Math.abs(tx - bounds.maxX) <= epsilon;
    const nearMinY = Math.abs(ty - bounds.minY) <= epsilon;
    const nearMaxY = Math.abs(ty - bounds.maxY) <= epsilon;

    if (nearMinX && nearMinY) {
      cornerMask |= 1;
      return;
    }
    if (nearMaxX && nearMinY) {
      cornerMask |= 2;
      return;
    }
    if (nearMaxX && nearMaxY) {
      cornerMask |= 4;
      return;
    }
    if (nearMinX && nearMaxY) {
      cornerMask |= 8;
      return;
    }
    valid = false;
  };

  for (let i = 0; i < pathData.length; ) {
    const op = pathData[i++];
    if (op === DRAW_MOVE_TO) {
      moveCount += 1;
      recordPoint(pathData[i++], pathData[i++]);
      continue;
    }
    if (op === DRAW_LINE_TO) {
      lineCount += 1;
      recordPoint(pathData[i++], pathData[i++]);
      continue;
    }
    if (op === DRAW_CLOSE) {
      continue;
    }
    return false;
  }

  return valid && moveCount === 1 && lineCount >= 3 && lineCount <= 4 && cornerMask === 15;
}

interface FillSubpath {
  data: Float32Array;
  bounds: Bounds | null;
  parent: number;
  children: number[];
}

interface FillPathSplit {
  data: Float32Array;
  clipBounds: Bounds | null;
}

function splitPathIntoDrawableSubpaths(pathData: Float32Array, matrix: Mat2D, clipBounds: Bounds | null): FillPathSplit[] {
  const subpaths = collectFillSubpaths(pathData, matrix);
  if (subpaths.length <= 1) {
    return subpaths.map((subpath) => ({ data: subpath.data, clipBounds: null }));
  }

  for (let i = 0; i < subpaths.length; i += 1) {
    const inner = subpaths[i];
    if (!isNonEmptyBounds(inner.bounds)) {
      continue;
    }

    let parentIndex = -1;
    let parentArea = Number.POSITIVE_INFINITY;
    for (let j = 0; j < subpaths.length; j += 1) {
      if (i === j) {
        continue;
      }

      const outer = subpaths[j];
      if (!isNonEmptyBounds(outer.bounds) || !boundsContainBounds(outer.bounds, inner.bounds)) {
        continue;
      }

      const outerArea = boundsArea(outer.bounds);
      const innerArea = boundsArea(inner.bounds);
      if (outerArea <= innerArea + 1e-6 || outerArea >= parentArea) {
        continue;
      }

      parentIndex = j;
      parentArea = outerArea;
    }

    inner.parent = parentIndex;
  }

  for (let i = 0; i < subpaths.length; i += 1) {
    const parent = subpaths[i].parent;
    if (parent >= 0) {
      subpaths[parent].children.push(i);
    }
  }

  const rootIndices: number[] = [];
  for (let i = 0; i < subpaths.length; i += 1) {
    if (subpaths[i].parent >= 0) {
      continue;
    }
    rootIndices.push(i);
  }

  if (rootIndices.length === 1) {
    const tiled = splitSingleRootFillSubpathGroup(subpaths, rootIndices[0], clipBounds);
    if (tiled.length > 1) {
      return tiled;
    }
  }

  const out: FillPathSplit[] = [];
  for (const rootIndex of rootIndices) {
    out.push({
      data: concatenateFillSubpathGroup(subpaths, rootIndex),
      clipBounds: null
    });
  }
  return out;
}

function collectFillSubpaths(pathData: Float32Array, matrix: Mat2D): FillSubpath[] {
  const subpaths: FillSubpath[] = [];
  let subpathStart = -1;

  const pushSubpath = (endOffset: number): void => {
    if (subpathStart < 0 || endOffset <= subpathStart) {
      return;
    }
    const data = pathData.slice(subpathStart, endOffset);
    subpaths.push({
      data,
      bounds: computeTransformedPathBounds(data, matrix),
      parent: -1,
      children: []
    });
  };

  for (let i = 0; i < pathData.length; ) {
    const opOffset = i;
    const op = pathData[i++];

    if (op === DRAW_MOVE_TO) {
      pushSubpath(opOffset);
      subpathStart = opOffset;
      i += 2;
      continue;
    }
    if (op === DRAW_LINE_TO) {
      i += 2;
      continue;
    }
    if (op === DRAW_CURVE_TO) {
      i += 6;
      continue;
    }
    if (op === DRAW_QUAD_TO) {
      i += 4;
      continue;
    }
    if (op === DRAW_CLOSE) {
      continue;
    }
    break;
  }

  pushSubpath(pathData.length);
  return subpaths;
}

function concatenateFillSubpathGroup(subpaths: FillSubpath[], rootIndex: number): Float32Array {
  const indices: number[] = [];
  const collect = (index: number): void => {
    indices.push(index);
    for (const childIndex of subpaths[index].children) {
      collect(childIndex);
    }
  };
  collect(rootIndex);
  indices.sort((a, b) => a - b);
  return concatenateFillSubpathIndices(subpaths, indices);
}

function concatenateFillSubpathIndices(subpaths: FillSubpath[], indices: number[]): Float32Array {
  let totalLength = 0;
  for (const index of indices) {
    totalLength += subpaths[index].data.length;
  }

  const out = new Float32Array(totalLength);
  let offset = 0;
  for (const index of indices) {
    out.set(subpaths[index].data, offset);
    offset += subpaths[index].data.length;
  }

  return out;
}

function splitSingleRootFillSubpathGroup(subpaths: FillSubpath[], rootIndex: number, clipBounds: Bounds | null): FillPathSplit[] {
  const root = subpaths[rootIndex];
  if (!isNonEmptyBounds(root.bounds) || root.children.length < FILL_SUBPATH_TILE_TARGET_CHILDREN) {
    return [];
  }

  const visibleBounds = clipBounds ? intersectBounds(clipBounds, root.bounds) : { ...root.bounds };
  if (!isNonEmptyBounds(visibleBounds)) {
    return [];
  }

  const tileCount = Math.min(
    FILL_SUBPATH_TILE_MAX_COUNT,
    Math.max(2, Math.ceil(root.children.length / FILL_SUBPATH_TILE_TARGET_CHILDREN))
  );
  const width = Math.max(0, visibleBounds.maxX - visibleBounds.minX);
  const height = Math.max(0, visibleBounds.maxY - visibleBounds.minY);
  const columns = width >= height ? tileCount : 1;
  const rows = width >= height ? 1 : tileCount;
  const splits: FillPathSplit[] = [];

  for (let row = 0; row < rows; row += 1) {
    const tileMinY = visibleBounds.minY + (height * row) / rows;
    const tileMaxY = row + 1 === rows ? visibleBounds.maxY : visibleBounds.minY + (height * (row + 1)) / rows;
    for (let column = 0; column < columns; column += 1) {
      const tileMinX = visibleBounds.minX + (width * column) / columns;
      const tileMaxX = column + 1 === columns ? visibleBounds.maxX : visibleBounds.minX + (width * (column + 1)) / columns;
      const tileBounds = { minX: tileMinX, minY: tileMinY, maxX: tileMaxX, maxY: tileMaxY };
      const indices = new Set<number>([rootIndex]);

      for (const childIndex of root.children) {
        const child = subpaths[childIndex];
        if (isNonEmptyBounds(child.bounds) && boundsIntersect(child.bounds, tileBounds)) {
          collectFillSubpathTreeIndices(subpaths, childIndex, indices);
        }
      }

      const sortedIndices = [...indices].sort((a, b) => a - b);
      splits.push({
        data: concatenateFillSubpathIndices(subpaths, sortedIndices),
        clipBounds: tileBounds
      });
    }
  }

  return splits;
}

function collectFillSubpathTreeIndices(subpaths: FillSubpath[], index: number, out: Set<number>): void {
  if (out.has(index)) {
    return;
  }
  out.add(index);
  for (const childIndex of subpaths[index].children) {
    collectFillSubpathTreeIndices(subpaths, childIndex, out);
  }
}

function boundsContainBounds(outer: Bounds, inner: Bounds): boolean {
  const epsilon = 1e-3;
  return boundsContainBoundsWithTolerance(outer, inner, epsilon);
}

function boundsContainBoundsWithTolerance(
  outer: Bounds,
  inner: Bounds,
  epsilon = boundsComparisonTolerance(outer, inner)
): boolean {
  return (
    inner.minX >= outer.minX - epsilon &&
    inner.minY >= outer.minY - epsilon &&
    inner.maxX <= outer.maxX + epsilon &&
    inner.maxY <= outer.maxY + epsilon
  );
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

function boundsArea(bounds: Bounds): number {
  return Math.max(0, bounds.maxX - bounds.minX) * Math.max(0, bounds.maxY - bounds.minY);
}

interface CoverageCandidate {
  index: number;
  start: number;
  end: number;
  halfWidth: number;
  alpha: number;
  styleFlags: number;
}

interface InvisibleCullResult {
  segmentCount: number;
  endpoints: Float32Array;
  primitiveMeta: Float32Array;
  primitiveBounds: Float32Array;
  styles: Float32Array;
  bounds: Bounds;
  maxHalfWidth: number;
  discardedTransparentCount: number;
  discardedDegenerateCount: number;
  discardedDuplicateCount: number;
  discardedContainedCount: number;
}

function cullInvisibleSegments(
  endpoints: Float32Array,
  primitiveMeta: Float32Array,
  styles: Float32Array,
  primitiveBounds: Float32Array
): InvisibleCullResult {
  const segmentCount = endpoints.length >> 2;
  const keepMask = new Uint8Array(segmentCount);
  const seenDuplicates = new Set<string>();
  const coverageGroups = new Map<string, CoverageCandidate[]>();

  let discardedTransparentCount = 0;
  let discardedDegenerateCount = 0;
  let discardedDuplicateCount = 0;
  let discardedContainedCount = 0;

  for (let i = 0; i < segmentCount; i += 1) {
    const offset = i * 4;
    const x0 = endpoints[offset];
    const y0 = endpoints[offset + 1];
    const cx = endpoints[offset + 2];
    const cy = endpoints[offset + 3];
    const x1 = primitiveMeta[offset];
    const y1 = primitiveMeta[offset + 1];
    const primitiveType = primitiveMeta[offset + 2];
    const isQuadratic = primitiveType >= STROKE_PRIMITIVE_QUADRATIC - 0.5;

    const halfWidth = styles[offset];
    const colorR = styles[offset + 1];
    const colorG = styles[offset + 2];
    const colorB = styles[offset + 3];
    const { alpha, styleFlags } = decodeStrokeStyleMeta(primitiveMeta[offset + 3]);

    if (alpha <= ALPHA_INVISIBLE_EPSILON) {
      discardedTransparentCount += 1;
      continue;
    }

    const curveLength = isQuadratic
      ? Math.hypot(cx - x0, cy - y0) + Math.hypot(x1 - cx, y1 - cy)
      : Math.hypot(x1 - x0, y1 - y0);
    if (curveLength < 1e-5) {
      const isRoundCapPoint = !isQuadratic && (styleFlags & STROKE_STYLE_FLAG_ROUND_CAP) !== 0;
      const isHairline = (styleFlags & STROKE_STYLE_FLAG_HAIRLINE) !== 0;
      const hasVisibleRadius = isHairline || halfWidth > 1e-6;
      if (!isRoundCapPoint || !hasVisibleRadius) {
        discardedDegenerateCount += 1;
        continue;
      }
    }

    const duplicateKey = buildDuplicateKey(
      x0,
      y0,
      cx,
      cy,
      x1,
      y1,
      primitiveType,
      halfWidth,
      colorR,
      colorG,
      colorB,
      alpha,
      styleFlags
    );
    if (seenDuplicates.has(duplicateKey)) {
      discardedDuplicateCount += 1;
      continue;
    }
    seenDuplicates.add(duplicateKey);

    keepMask[i] = 1;

    if (!isQuadratic && curveLength >= 1e-5) {
      const coverage = buildCoverageCandidate(i, x0, y0, x1, y1, halfWidth, colorR, colorG, colorB, alpha, styleFlags);
      let bucket = coverageGroups.get(coverage.key);
      if (!bucket) {
        bucket = [];
        coverageGroups.set(coverage.key, bucket);
      }
      bucket.push({
        index: coverage.index,
        start: coverage.start,
        end: coverage.end,
        halfWidth: coverage.halfWidth,
        alpha: coverage.alpha,
        styleFlags: coverage.styleFlags
      });
    }
  }

  for (const candidates of coverageGroups.values()) {
    candidates.sort((a, b) => {
      if (Math.abs(a.halfWidth - b.halfWidth) > COVER_HALF_WIDTH_EPSILON) {
        return b.halfWidth - a.halfWidth;
      }

      const lenA = a.end - a.start;
      const lenB = b.end - b.start;
      if (Math.abs(lenA - lenB) > COVER_INTERVAL_EPSILON) {
        return lenB - lenA;
      }

      return a.start - b.start;
    });

    const opaqueCovers: CoverageCandidate[] = [];

    for (const candidate of candidates) {
      let covered = false;
      for (const cover of opaqueCovers) {
        if (cover.halfWidth + COVER_HALF_WIDTH_EPSILON < candidate.halfWidth) {
          continue;
        }

        if (
          cover.start - COVER_INTERVAL_EPSILON <= candidate.start &&
          cover.end + COVER_INTERVAL_EPSILON >= candidate.end
        ) {
          covered = true;
          break;
        }
      }

      if (covered) {
        if (keepMask[candidate.index] === 1) {
          keepMask[candidate.index] = 0;
          discardedContainedCount += 1;
        }
        continue;
      }

      if (candidate.alpha >= OPAQUE_ALPHA_EPSILON) {
        opaqueCovers.push(candidate);
      }
    }
  }

  let visibleCount = 0;
  for (let i = 0; i < segmentCount; i += 1) {
    if (keepMask[i] === 1) {
      visibleCount += 1;
    }
  }

  if (visibleCount === 0) {
    return {
      segmentCount: 0,
      endpoints: new Float32Array(0),
      primitiveMeta: new Float32Array(0),
      primitiveBounds: new Float32Array(0),
      styles: new Float32Array(0),
      bounds: {
        minX: 0,
        minY: 0,
        maxX: 0,
        maxY: 0
      },
      maxHalfWidth: 0,
      discardedTransparentCount,
      discardedDegenerateCount,
      discardedDuplicateCount,
      discardedContainedCount
    };
  }

  const outEndpoints = new Float32Array(visibleCount * 4);
  const outPrimitiveMeta = new Float32Array(visibleCount * 4);
  const outPrimitiveBounds = new Float32Array(visibleCount * 4);
  const outStyles = new Float32Array(visibleCount * 4);
  const outBounds: Bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };
  let maxHalfWidth = 0;
  let out = 0;

  for (let i = 0; i < segmentCount; i += 1) {
    if (keepMask[i] === 0) {
      continue;
    }

    const inOffset = i * 4;
    const outOffset = out * 4;

    const x0 = endpoints[inOffset];
    const y0 = endpoints[inOffset + 1];
    const minX = primitiveBounds[inOffset];
    const minY = primitiveBounds[inOffset + 1];
    const maxX = primitiveBounds[inOffset + 2];
    const maxY = primitiveBounds[inOffset + 3];
    const halfWidth = styles[inOffset];

    outEndpoints[outOffset] = x0;
    outEndpoints[outOffset + 1] = y0;
    outEndpoints[outOffset + 2] = endpoints[inOffset + 2];
    outEndpoints[outOffset + 3] = endpoints[inOffset + 3];

    outPrimitiveMeta[outOffset] = primitiveMeta[inOffset];
    outPrimitiveMeta[outOffset + 1] = primitiveMeta[inOffset + 1];
    outPrimitiveMeta[outOffset + 2] = primitiveMeta[inOffset + 2];
    outPrimitiveMeta[outOffset + 3] = primitiveMeta[inOffset + 3];

    outPrimitiveBounds[outOffset] = minX;
    outPrimitiveBounds[outOffset + 1] = minY;
    outPrimitiveBounds[outOffset + 2] = maxX;
    outPrimitiveBounds[outOffset + 3] = maxY;

    outStyles[outOffset] = styles[inOffset];
    outStyles[outOffset + 1] = styles[inOffset + 1];
    outStyles[outOffset + 2] = styles[inOffset + 2];
    outStyles[outOffset + 3] = styles[inOffset + 3];

    outBounds.minX = Math.min(outBounds.minX, minX);
    outBounds.minY = Math.min(outBounds.minY, minY);
    outBounds.maxX = Math.max(outBounds.maxX, maxX);
    outBounds.maxY = Math.max(outBounds.maxY, maxY);

    maxHalfWidth = Math.max(maxHalfWidth, halfWidth);
    out += 1;
  }

  return {
    segmentCount: visibleCount,
    endpoints: outEndpoints,
    primitiveMeta: outPrimitiveMeta,
    primitiveBounds: outPrimitiveBounds,
    styles: outStyles,
    bounds: outBounds,
    maxHalfWidth,
    discardedTransparentCount,
    discardedDegenerateCount,
    discardedDuplicateCount,
    discardedContainedCount
  };
}

function buildDuplicateKey(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  primitiveType: number,
  halfWidth: number,
  colorR: number,
  colorG: number,
  colorB: number,
  alpha: number,
  styleFlags: number
): string {
  const isQuadratic = primitiveType >= STROKE_PRIMITIVE_QUADRATIC - 0.5;

  let ax = x0;
  let ay = y0;
  let bx = x1;
  let by = y1;
  let qcx = cx;
  let qcy = cy;

  if (!isQuadratic && (ax > bx || (ax === bx && ay > by))) {
    ax = x1;
    ay = y1;
    bx = x0;
    by = y0;
  }

  if (!isQuadratic) {
    qcx = bx;
    qcy = by;
  }

  return [
    quantize(primitiveType, 10),
    quantize(halfWidth, DUPLICATE_STYLE_SCALE),
    quantize(colorR, DUPLICATE_STYLE_SCALE),
    quantize(colorG, DUPLICATE_STYLE_SCALE),
    quantize(colorB, DUPLICATE_STYLE_SCALE),
    quantize(alpha, DUPLICATE_STYLE_SCALE),
    quantize(styleFlags, 1),
    quantize(ax, DUPLICATE_POSITION_SCALE),
    quantize(ay, DUPLICATE_POSITION_SCALE),
    quantize(qcx, DUPLICATE_POSITION_SCALE),
    quantize(qcy, DUPLICATE_POSITION_SCALE),
    quantize(bx, DUPLICATE_POSITION_SCALE),
    quantize(by, DUPLICATE_POSITION_SCALE)
  ].join("|");
}

function buildCoverageCandidate(
  index: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  halfWidth: number,
  colorR: number,
  colorG: number,
  colorB: number,
  alpha: number,
  styleFlags: number
): { key: string; index: number; start: number; end: number; halfWidth: number; alpha: number; styleFlags: number } {
  let ax = x0;
  let ay = y0;
  let bx = x1;
  let by = y1;

  let dx = bx - ax;
  let dy = by - ay;
  const len = Math.hypot(dx, dy);

  let ux = dx / len;
  let uy = dy / len;

  if (ux < 0 || (Math.abs(ux) < 1e-10 && uy < 0)) {
    ux = -ux;
    uy = -uy;
    ax = x1;
    ay = y1;
    bx = x0;
    by = y0;
  }

  const nx = -uy;
  const ny = ux;
  const offset = nx * ax + ny * ay;

  const t0 = ux * ax + uy * ay;
  const t1 = ux * bx + uy * by;
  const start = Math.min(t0, t1);
  const end = Math.max(t0, t1);

  const key = [
    quantize(ux, COVER_DIRECTION_SCALE),
    quantize(uy, COVER_DIRECTION_SCALE),
    quantize(offset, COVER_OFFSET_SCALE),
    quantize(colorR, DUPLICATE_STYLE_SCALE),
    quantize(colorG, DUPLICATE_STYLE_SCALE),
    quantize(colorB, DUPLICATE_STYLE_SCALE),
    quantize(styleFlags, 1)
  ].join("|");

  return { key, index, start, end, halfWidth, alpha, styleFlags };
}

async function extractTextVectorData(
  page: unknown,
  operatorList: { fnArray: number[]; argsArray: unknown[] },
  pageMatrix: Mat2D,
  pageBounds?: Bounds,
  suppressedPaintMask?: Uint8Array
): Promise<TextExtractResult> {
  const commonObjs = resolveCommonObjs(page);
  if (!commonObjs) {
    return createEmptyTextExtractResult();
  }

  const textInstanceA = new Float4Builder(4_096);
  const textInstanceB = new Float4Builder(4_096);
  const textInstanceC = new Float4Builder(4_096);
  const textGlyphMetaA = new Float4Builder(2_048);
  const textGlyphMetaB = new Float4Builder(2_048);
  const textGlyphSegmentsA = new Float4Builder(16_384);
  const textGlyphSegmentsB = new Float4Builder(16_384);

  const glyphIndexByKey = new Map<string, number>();
  const glyphBoundsByIndex: Bounds[] = [];
  const textIndexBuilder = new PageTextIndexBuilder();

  let sourceTextCount = 0;
  let textBounds: Bounds | null = null;
  let inPageCount = 0;
  let outOfPageCount = 0;

  const stateStack: TextState[] = [];
  const formStateStack: TextState[] = [];
  const clipBoundsStack: Array<Bounds | null> = [];
  const formClipBoundsStack: Array<Bounds | null> = [];
  const annotationStateStack: TextState[] = [];
  const annotationClipBoundsStack: Array<Bounds | null> = [];
  const groupAlphaStack: Array<Pick<TextState, "groupFillAlpha" | "groupFillAlphaVersion">> = [];
  let state = createDefaultTextState(pageMatrix);
  let clipBounds: Bounds | null = null;
  let pendingClipPathBounds: Bounds | null = null;
  let pendingClipOperator = false;

  const getOrCreateGlyph = (font: FontLike | null, fontRef: string, fontChar: string): { index: number; bounds: Bounds } | null => {
    if (!fontChar) {
      return null;
    }

    const loadedName = typeof font?.loadedName === "string" && font.loadedName.length > 0 ? font.loadedName : fontRef;
    if (!loadedName) {
      return null;
    }

    const glyphKey = `${loadedName}|${fontChar}`;
    const cachedIndex = glyphIndexByKey.get(glyphKey);
    if (cachedIndex !== undefined) {
      return { index: cachedIndex, bounds: glyphBoundsByIndex[cachedIndex] };
    }

    const pathData = getGlyphPathData(commonObjs, loadedName, fontChar);
    if (!pathData) {
      return null;
    }

    const segmentStart = textGlyphSegmentsA.quadCount;
    const glyphBuild = emitTextGlyphSegmentsFromPath(pathData, textGlyphSegmentsA, textGlyphSegmentsB);
    if (glyphBuild.segmentCount <= 0) {
      return null;
    }

    const glyphIndex = textGlyphMetaA.quadCount;
    textGlyphMetaA.push(segmentStart, glyphBuild.segmentCount, glyphBuild.bounds.minX, glyphBuild.bounds.minY);
    textGlyphMetaB.push(glyphBuild.bounds.maxX, glyphBuild.bounds.maxY, 0, 0);

    glyphIndexByKey.set(glyphKey, glyphIndex);
    glyphBoundsByIndex[glyphIndex] = glyphBuild.bounds;

    return { index: glyphIndex, bounds: glyphBuild.bounds };
  };

  const emitTextEntries = (entries: unknown[], suppressRender = false): void => {
    if (entries.length === 0 || state.fontSize === 0) {
      return;
    }

    const font = resolveFont(commonObjs, state.fontRef);
    const fontMatrixScale = resolveFontMatrixScale(font);
    const widthAdvanceScale = state.fontSize * fontMatrixScale;
    const vertical = font?.vertical === true;
    const spacingDir = vertical ? 1 : -1;
    const textHScale = state.textHScale * state.fontDirection;

    let x = 0;

    for (const entry of entries) {
      if (typeof entry === "number" && Number.isFinite(entry)) {
        x += spacingDir * entry * state.fontSize / 1000;
        continue;
      }

      const glyph = entry as GlyphTokenLike;
      const fontChar = typeof glyph.fontChar === "string" ? glyph.fontChar : "";
      const width = Number(glyph.width);
      const glyphWidth = Number.isFinite(width) ? width : 0;
      const isSpace = glyph.isSpace === true;
      const skipGlyphRender = isWhitespaceGlyphToken(glyph, fontChar);
      const spacing = (isSpace ? state.wordSpacing : 0) + state.charSpacing;
      const glyphMatrix = buildTextGlyphTransform(state, vertical ? 0 : x, vertical ? x : 0);
      let indexGlyphBounds: Bounds | null = null;
      let emittedInstanceIndex = -1;

      if (
        !suppressRender &&
        !vertical &&
        !skipGlyphRender &&
        shouldRenderFilledText(state.renderMode) &&
        effectiveTextFillAlpha(state) > TEXT_MIN_ALPHA
      ) {
        const glyphRecord = getOrCreateGlyph(font, state.fontRef, fontChar);
        if (glyphRecord) {
          const transformedGlyphBounds = transformBounds(glyphRecord.bounds, glyphMatrix);
          indexGlyphBounds = transformedGlyphBounds;
          const visibleByClip = !clipBounds || boundsIntersect(transformedGlyphBounds, clipBounds);
          if (visibleByClip) {
            sourceTextCount += 1;

            // Viewers hide content outside the page/crop box. Vector content is
            // culled through the clip state (seeded with the page bounds), so
            // cull text the same way instead of emitting out-of-page glyphs.
            const visibleInPage = !pageBounds || boundsIntersect(transformedGlyphBounds, pageBounds);
            if (!visibleInPage) {
              outOfPageCount += 1;
            } else {
              if (pageBounds) {
                inPageCount += 1;
              }

              textInstanceA.push(glyphMatrix[0], glyphMatrix[1], glyphMatrix[2], glyphMatrix[3]);
              textInstanceB.push(glyphMatrix[4], glyphMatrix[5], glyphRecord.index, 0);
              textInstanceC.push(state.fillR, state.fillG, state.fillB, effectiveTextFillAlpha(state));
              emittedInstanceIndex = textInstanceA.quadCount - 1;

              if (!textBounds) {
                textBounds = {
                  minX: transformedGlyphBounds.minX - TEXT_BOUNDS_EPSILON,
                  minY: transformedGlyphBounds.minY - TEXT_BOUNDS_EPSILON,
                  maxX: transformedGlyphBounds.maxX + TEXT_BOUNDS_EPSILON,
                  maxY: transformedGlyphBounds.maxY + TEXT_BOUNDS_EPSILON
                };
              } else {
                textBounds.minX = Math.min(textBounds.minX, transformedGlyphBounds.minX - TEXT_BOUNDS_EPSILON);
                textBounds.minY = Math.min(textBounds.minY, transformedGlyphBounds.minY - TEXT_BOUNDS_EPSILON);
                textBounds.maxX = Math.max(textBounds.maxX, transformedGlyphBounds.maxX + TEXT_BOUNDS_EPSILON);
                textBounds.maxY = Math.max(textBounds.maxY, transformedGlyphBounds.maxY + TEXT_BOUNDS_EPSILON);
              }
            }
          }
        }
      }

      const charWidth = vertical
        ? glyphWidth * widthAdvanceScale - spacing * state.fontDirection
        : glyphWidth * widthAdvanceScale + spacing * state.fontDirection;

      // Text-index capture runs regardless of render gating so invisible
      // (e.g. OCR), clip-culled, and atlas-miss glyphs stay searchable.
      const unicode = typeof glyph.unicode === "string" ? glyph.unicode : "";
      if (skipGlyphRender || unicode.length === 0) {
        textIndexBuilder.appendSeparator();
      } else {
        const advanceEm = charWidth / state.fontSize;
        const glyphQuad =
          indexGlyphBounds ??
          transformBounds(
            vertical
              ? { minX: -0.5, minY: -Math.abs(advanceEm), maxX: 0.5, maxY: 0 }
              : { minX: 0, minY: TEXT_INDEX_FALLBACK_DESCENT, maxX: advanceEm, maxY: TEXT_INDEX_FALLBACK_ASCENT },
            glyphMatrix
          );
        const penEndX = vertical
          ? glyphMatrix[2] * advanceEm + glyphMatrix[4]
          : glyphMatrix[0] * advanceEm + glyphMatrix[4];
        const penEndY = vertical
          ? glyphMatrix[3] * advanceEm + glyphMatrix[5]
          : glyphMatrix[1] * advanceEm + glyphMatrix[5];
        const emHeight = Math.hypot(glyphMatrix[2], glyphMatrix[3]);
        textIndexBuilder.appendGlyph(
          unicode,
          glyphQuad,
          glyphMatrix[4],
          glyphMatrix[5],
          penEndX,
          penEndY,
          emHeight,
          emittedInstanceIndex
        );
      }

      x += charWidth;
    }

    if (vertical) {
      state.textY -= x;
    } else {
      state.textX += x * textHScale;
    }
  };

  for (let i = 0; i < operatorList.fnArray.length; i += 1) {
    const fn = operatorList.fnArray[i];
    const args = operatorList.argsArray[i];

    if (fn === OPS.save) {
      stateStack.push(cloneTextState(state));
      clipBoundsStack.push(cloneBoundsOrNull(clipBounds));
      continue;
    }

    if (fn === OPS.restore) {
      const restored = stateStack.pop();
      if (restored) {
        state = restored;
      }
      clipBounds = clipBoundsStack.pop() ?? null;
      pendingClipPathBounds = null;
      pendingClipOperator = false;
      continue;
    }

    if (fn === OPS.transform) {
      const transform = readTransform(args);
      if (transform) {
        state.matrix = multiplyMatrices(state.matrix, transform);
      }
      continue;
    }

    if (fn === OPS.paintFormXObjectBegin) {
      formStateStack.push(cloneTextState(state));
      formClipBoundsStack.push(cloneBoundsOrNull(clipBounds));
      const transform = readTransform(args);
      if (transform) {
        state.matrix = multiplyMatrices(state.matrix, transform);
      }
      pendingClipPathBounds = null;
      pendingClipOperator = false;
      continue;
    }

    if (fn === OPS.paintFormXObjectEnd) {
      const restoredState = formStateStack.pop();
      if (restoredState) {
        state = restoredState;
      }
      clipBounds = formClipBoundsStack.pop() ?? clipBounds;
      pendingClipPathBounds = null;
      pendingClipOperator = false;
      continue;
    }

    if (fn === OPS.beginAnnotation) {
      annotationStateStack.push(cloneTextState(state));
      annotationClipBoundsStack.push(cloneBoundsOrNull(clipBounds));
      const annotationTransform = readAnnotationTransform(args);
      if (annotationTransform) {
        state.matrix = multiplyMatrices(state.matrix, annotationTransform);
      }
      pendingClipPathBounds = null;
      pendingClipOperator = false;
      continue;
    }

    if (fn === OPS.endAnnotation) {
      const restoredState = annotationStateStack.pop();
      if (restoredState) {
        state = restoredState;
      }
      clipBounds = annotationClipBoundsStack.pop() ?? clipBounds;
      pendingClipPathBounds = null;
      pendingClipOperator = false;
      continue;
    }

    if (fn === OPS.constructPath) {
      const paintOp = readNumber(args, 0, -1);
      const pathData = readPathData(args);
      const pathBounds = pathData ? computeTransformedPathBounds(pathData, state.matrix) : null;
      if (pendingClipOperator) {
        clipBounds = intersectBounds(clipBounds, pathBounds);
        pendingClipPathBounds = null;
        pendingClipOperator = false;
      } else if (paintOp === OPS.endPath) {
        pendingClipPathBounds = pathBounds;
      } else {
        pendingClipPathBounds = null;
      }
      continue;
    }

    if (fn === OPS.clip || fn === OPS.eoClip) {
      if (pendingClipPathBounds) {
        clipBounds = intersectBounds(clipBounds, pendingClipPathBounds);
        pendingClipPathBounds = null;
      } else {
        pendingClipOperator = true;
      }
      continue;
    }

    if (fn === OPS.endPath) {
      pendingClipPathBounds = null;
      pendingClipOperator = false;
      continue;
    }

    if (fn === OPS.setFillRGBColor || fn === OPS.setFillColor || fn === OPS.setFillGray || fn === OPS.setFillCMYKColor) {
      if (fn === OPS.setFillCMYKColor) {
        const [r, g, b] = parseCmykColorFromOperatorArgs(args, [state.fillR, state.fillG, state.fillB]);
        state.fillR = r;
        state.fillG = g;
        state.fillB = b;
      } else if (fn === OPS.setFillGray) {
        const [gray] = parseGrayColor(readArg(args, 0), state.fillR);
        state.fillR = gray;
        state.fillG = gray;
        state.fillB = gray;
      } else {
        const [r, g, b] = parseColorFromOperatorArgs(args, [state.fillR, state.fillG, state.fillB]);
        state.fillR = r;
        state.fillG = g;
        state.fillB = b;
      }
      continue;
    }

    if (fn === OPS.setGState) {
      applyTextGraphicsStateEntries(readArg(args, 0), state);
      continue;
    }

    if (fn === OPS.beginGroup) {
      groupAlphaStack.push({
        groupFillAlpha: state.groupFillAlpha,
        groupFillAlphaVersion: state.groupFillAlphaVersion
      });
      state.groupFillAlpha = clamp01(state.groupFillAlpha * state.fillAlpha);
      state.groupFillAlphaVersion = state.fillAlphaVersion;
      pendingClipPathBounds = null;
      pendingClipOperator = false;
      continue;
    }

    if (fn === OPS.endGroup) {
      const restoredGroupAlpha = groupAlphaStack.pop();
      if (restoredGroupAlpha) {
        state.groupFillAlpha = restoredGroupAlpha.groupFillAlpha;
        state.groupFillAlphaVersion = restoredGroupAlpha.groupFillAlphaVersion;
      }
      pendingClipPathBounds = null;
      pendingClipOperator = false;
      continue;
    }

    if (fn === OPS.beginText) {
      beginText(state);
      continue;
    }

    if (fn === OPS.setCharSpacing) {
      state.charSpacing = readNumber(args, 0, state.charSpacing);
      continue;
    }

    if (fn === OPS.setWordSpacing) {
      state.wordSpacing = readNumber(args, 0, state.wordSpacing);
      continue;
    }

    if (fn === OPS.setHScale) {
      state.textHScale = readNumber(args, 0, state.textHScale * 100) / 100;
      continue;
    }

    if (fn === OPS.setLeading) {
      state.leading = -readNumber(args, 0, -state.leading);
      continue;
    }

    if (fn === OPS.setFont) {
      const fontRef = readArg(args, 0);
      const rawSize = readNumber(args, 1, state.fontSize);
      if (typeof fontRef === "string") {
        state.fontRef = fontRef;
      }
      if (rawSize < 0) {
        state.fontSize = -rawSize;
        state.fontDirection = -1;
      } else {
        state.fontSize = rawSize;
        state.fontDirection = 1;
      }
      continue;
    }

    if (fn === OPS.setTextRenderingMode) {
      state.renderMode = Math.max(0, Math.trunc(readNumber(args, 0, state.renderMode)));
      continue;
    }

    if (fn === OPS.setTextRise) {
      state.textRise = readNumber(args, 0, state.textRise);
      continue;
    }

    if (fn === OPS.moveText) {
      const tx = readNumber(args, 0, 0);
      const ty = readNumber(args, 1, 0);
      moveText(state, tx, ty);
      continue;
    }

    if (fn === OPS.setLeadingMoveText) {
      const tx = readNumber(args, 0, 0);
      const ty = readNumber(args, 1, 0);
      state.leading = ty;
      moveText(state, tx, ty);
      continue;
    }

    if (fn === OPS.setTextMatrix) {
      const matrix = readTransform(args);
      if (matrix) {
        state.textMatrix = matrix;
        state.textX = 0;
        state.textY = 0;
        state.lineX = 0;
        state.lineY = 0;
      }
      continue;
    }

    if (fn === OPS.nextLine) {
      moveText(state, 0, state.leading);
      continue;
    }

    if (fn === OPS.showText || fn === OPS.showSpacedText) {
      emitTextEntries(readTextEntries(readArg(args, 0)), suppressedPaintMask?.[i] === 1);
      pendingClipPathBounds = null;
      continue;
    }

    if (fn === OPS.nextLineShowText) {
      moveText(state, 0, state.leading);
      emitTextEntries(readTextEntries(readArg(args, 0)), suppressedPaintMask?.[i] === 1);
      pendingClipPathBounds = null;
      continue;
    }

    if (fn === OPS.nextLineSetSpacingShowText) {
      state.wordSpacing = readNumber(args, 0, state.wordSpacing);
      state.charSpacing = readNumber(args, 1, state.charSpacing);
      moveText(state, 0, state.leading);
      emitTextEntries(readTextEntries(readArg(args, 2)), suppressedPaintMask?.[i] === 1);
      pendingClipPathBounds = null;
      continue;
    }
  }

  return {
    sourceTextCount,
    instanceCount: textInstanceA.quadCount,
    glyphCount: textGlyphMetaA.quadCount,
    glyphSegmentCount: textGlyphSegmentsA.quadCount,
    inPageCount,
    outOfPageCount,
    instanceA: textInstanceA.toTypedArray(),
    instanceB: textInstanceB.toTypedArray(),
    instanceC: textInstanceC.toTypedArray(),
    glyphMetaA: textGlyphMetaA.toTypedArray(),
    glyphMetaB: textGlyphMetaB.toTypedArray(),
    glyphSegmentsA: textGlyphSegmentsA.toTypedArray(),
    glyphSegmentsB: textGlyphSegmentsB.toTypedArray(),
    bounds: textBounds,
    textIndexPage: textIndexBuilder.build()
  };
}

function cloneBoundsOrNull(bounds: Bounds | null): Bounds | null {
  if (!bounds) {
    return null;
  }
  return { ...bounds };
}

function cloneClipMaskOrNull(mask: ClipMask | null): ClipMask | null {
  if (!mask) {
    return null;
  }
  return {
    bounds: { ...mask.bounds },
    exclusionBounds: mask.exclusionBounds.map((bounds) => ({ ...bounds }))
  };
}

function applyClipToState(
  state: GraphicsState,
  pathBounds: Bounds | null,
  pathMask: ClipMask | null,
  clipRule: number
): void {
  const nextClipBounds = intersectBounds(state.clipBounds, pathBounds);
  state.clipBounds = nextClipBounds;
  state.clipMask = combineClipMasks(
    state.clipMask,
    clipRule === FILL_RULE_EVEN_ODD ? pathMask : null,
    nextClipBounds
  );
}

function combineClipMasks(
  currentMask: ClipMask | null,
  nextMask: ClipMask | null,
  clipBounds: Bounds | null
): ClipMask | null {
  if (!isNonEmptyBounds(clipBounds)) {
    return null;
  }

  const exclusionBounds: Bounds[] = [];
  const addExclusion = (bounds: Bounds): void => {
    const clipped = intersectBounds(clipBounds, bounds);
    if (!isNonEmptyBounds(clipped) || boundsArea(clipped) <= 1e-6 || boundsNearlyEqual(clipped, clipBounds)) {
      return;
    }
    exclusionBounds.push(clipped);
  };

  if (currentMask) {
    for (const bounds of currentMask.exclusionBounds) {
      addExclusion(bounds);
    }
  }
  if (nextMask) {
    for (const bounds of nextMask.exclusionBounds) {
      addExclusion(bounds);
    }
  }

  if (exclusionBounds.length === 0) {
    return null;
  }

  return {
    bounds: { ...clipBounds },
    exclusionBounds
  };
}

function intersectBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a && !b) {
    return null;
  }
  if (!a && b) {
    return { ...b };
  }
  if (a && !b) {
    return { ...a };
  }

  const minX = Math.max((a as Bounds).minX, (b as Bounds).minX);
  const minY = Math.max((a as Bounds).minY, (b as Bounds).minY);
  const maxX = Math.min((a as Bounds).maxX, (b as Bounds).maxX);
  const maxY = Math.min((a as Bounds).maxY, (b as Bounds).maxY);

  if (!(minX <= maxX && minY <= maxY)) {
    return { minX: 1, minY: 1, maxX: 0, maxY: 0 };
  }
  return { minX, minY, maxX, maxY };
}

function isNonEmptyBounds(bounds: Bounds | null): bounds is Bounds {
  return Boolean(bounds && bounds.minX <= bounds.maxX && bounds.minY <= bounds.maxY);
}

function isOpaqueWhiteBackgroundFill(
  bounds: Bounds,
  pageBounds: Bounds,
  colorR: number,
  colorG: number,
  colorB: number,
  alpha: number
): boolean {
  if (
    alpha < OPAQUE_ALPHA_EPSILON ||
    colorR < 1 - BACKGROUND_FILL_COLOR_EPSILON ||
    colorG < 1 - BACKGROUND_FILL_COLOR_EPSILON ||
    colorB < 1 - BACKGROUND_FILL_COLOR_EPSILON
  ) {
    return false;
  }

  const pageWidth = Math.max(1e-6, pageBounds.maxX - pageBounds.minX);
  const pageHeight = Math.max(1e-6, pageBounds.maxY - pageBounds.minY);
  const width = Math.max(0, bounds.maxX - bounds.minX);
  const height = Math.max(0, bounds.maxY - bounds.minY);
  const areaRatio = (width * height) / Math.max(1e-6, pageWidth * pageHeight);
  const widthRatio = width / pageWidth;
  const heightRatio = height / pageHeight;

  return (
    areaRatio >= BACKGROUND_FILL_MIN_AREA_RATIO &&
    Math.max(widthRatio, heightRatio) >= BACKGROUND_FILL_MIN_DIMENSION_RATIO
  );
}

function computeTransformedPathBounds(pathData: Float32Array, matrix: Mat2D): Bounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let hasPoint = false;
  let cursorX = 0;
  let cursorY = 0;
  let startX = 0;
  let startY = 0;
  let hasStart = false;

  const includePoint = (x: number, y: number): void => {
    const [tx, ty] = applyMatrix(matrix, x, y);
    minX = Math.min(minX, tx);
    minY = Math.min(minY, ty);
    maxX = Math.max(maxX, tx);
    maxY = Math.max(maxY, ty);
    hasPoint = true;
  };

  for (let i = 0; i < pathData.length; ) {
    const op = pathData[i++];

    if (op === DRAW_MOVE_TO) {
      if (i + 1 >= pathData.length) {
        break;
      }
      cursorX = pathData[i++];
      cursorY = pathData[i++];
      startX = cursorX;
      startY = cursorY;
      hasStart = true;
      includePoint(cursorX, cursorY);
      continue;
    }

    if (op === DRAW_LINE_TO) {
      if (i + 1 >= pathData.length) {
        break;
      }
      const x = pathData[i++];
      const y = pathData[i++];
      includePoint(cursorX, cursorY);
      includePoint(x, y);
      cursorX = x;
      cursorY = y;
      continue;
    }

    if (op === DRAW_CURVE_TO) {
      if (i + 5 >= pathData.length) {
        break;
      }
      const x1 = pathData[i++];
      const y1 = pathData[i++];
      const x2 = pathData[i++];
      const y2 = pathData[i++];
      const x3 = pathData[i++];
      const y3 = pathData[i++];
      includePoint(cursorX, cursorY);
      includePoint(x1, y1);
      includePoint(x2, y2);
      includePoint(x3, y3);
      cursorX = x3;
      cursorY = y3;
      continue;
    }

    if (op === DRAW_QUAD_TO) {
      if (i + 3 >= pathData.length) {
        break;
      }
      const cx = pathData[i++];
      const cy = pathData[i++];
      const x = pathData[i++];
      const y = pathData[i++];
      includePoint(cursorX, cursorY);
      includePoint(cx, cy);
      includePoint(x, y);
      cursorX = x;
      cursorY = y;
      continue;
    }

    if (op === DRAW_CLOSE) {
      if (hasStart) {
        includePoint(cursorX, cursorY);
        includePoint(startX, startY);
        cursorX = startX;
        cursorY = startY;
      }
      continue;
    }

    break;
  }

  if (!hasPoint) {
    return null;
  }
  return { minX, minY, maxX, maxY };
}

function createEmptyTextExtractResult(): TextExtractResult {
  return {
    sourceTextCount: 0,
    instanceCount: 0,
    glyphCount: 0,
    glyphSegmentCount: 0,
    inPageCount: 0,
    outOfPageCount: 0,
    instanceA: new Float32Array(0),
    instanceB: new Float32Array(0),
    instanceC: new Float32Array(0),
    glyphMetaA: new Float32Array(0),
    glyphMetaB: new Float32Array(0),
    glyphSegmentsA: new Float32Array(0),
    glyphSegmentsB: new Float32Array(0),
    bounds: null,
    textIndexPage: { text: "", charInstance: new Int32Array(0), fallbackQuads: new Float32Array(0) }
  };
}

function resolveCommonObjs(page: unknown): CommonObjsLike | null {
  const candidate = page as { commonObjs?: CommonObjsLike };
  if (!candidate.commonObjs || typeof candidate.commonObjs.get !== "function") {
    return null;
  }
  return candidate.commonObjs;
}

function hasTextShowOperators(operatorList: { fnArray: number[] }): boolean {
  for (const fn of operatorList.fnArray) {
    if (
      fn === OPS.showText ||
      fn === OPS.showSpacedText ||
      fn === OPS.nextLineShowText ||
      fn === OPS.nextLineSetSpacingShowText
    ) {
      return true;
    }
  }
  return false;
}

function countImagePaintOps(operatorList: { fnArray: number[] }): number {
  let count = 0;
  for (const fn of operatorList.fnArray) {
    if (isImagePaintOperator(fn)) {
      count += 1;
    }
  }
  return count;
}

async function warmUpTextPathCache(page: unknown): Promise<void> {
  if (typeof document === "undefined") {
    return;
  }

  const pageLike = page as {
    rotate: number;
    view: number[];
    getViewport: (params: { scale: number; rotation?: number; dontFlip?: boolean }) => { width: number; height: number };
    render: (params: { canvasContext: CanvasRenderingContext2D; viewport: unknown; intent?: string }) => { promise: Promise<unknown> };
  };

  if (
    !Array.isArray(pageLike.view) ||
    typeof pageLike.getViewport !== "function" ||
    typeof pageLike.render !== "function"
  ) {
    return;
  }

  const pageWidth = Math.max(1, Math.abs(pageLike.view[2] - pageLike.view[0]));
  const pageHeight = Math.max(1, Math.abs(pageLike.view[3] - pageLike.view[1]));
  const maxDim = Math.max(pageWidth, pageHeight);
  const targetMaxDim = 1024;
  const scale = clamp01(targetMaxDim / maxDim) * 0.95 + 0.05;

  const viewport = pageLike.getViewport({
    scale,
    rotation: normalizeRotationDegrees(pageLike.rotate),
    dontFlip: true
  });

  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", {
    alpha: false
  });

  if (!context) {
    return;
  }

  try {
    await pageLike.render({
      canvasContext: context,
      viewport,
      intent: "display"
    }).promise;
  } catch {
    // Best-effort warm-up only; extraction continues regardless.
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

interface NativeGradientScan {
  states: Map<number, NativeGradientPaintState>;
  softMaskGroupEntryStates: Map<number, NativeGradientPaintState>;
  paintOrdinalByOp: Int32Array;
  paintTopologySignature: string;
}

interface NativeSoftMaskRange {
  definitionStart: number;
  definitionEnd: number;
  definitionPaint: number;
  consumerStart: number;
  consumerEnd: number;
  consumerPaint: number;
  subtype: "Alpha" | "Luminosity";
  backdrop: string | null;
  transferMap: Uint8Array | null;
}

function isNativeDensePaintOperator(fn: number, args: unknown): boolean {
  if (fn === OPS.shadingFill || isNativeDenseImagePaintOperator(fn) || isTextPaintOperator(fn)) {
    return true;
  }
  if (fn !== OPS.constructPath) {
    return false;
  }
  const paintOp = readNumber(args, 0, OPS.endPath);
  return isFillPaintOp(paintOp) || isStrokePaintOp(paintOp);
}

function isNativeDenseImagePaintOperator(fn: number): boolean {
  return (
    isImagePaintOperator(fn) &&
    fn !== OPS.beginInlineImage &&
    fn !== OPS.beginImageData &&
    fn !== OPS.endInlineImage
  );
}

function cloneNativeClipGeometry(value: NativeClipGeometry | null): NativeClipGeometry | null {
  if (!value) {
    return null;
  }
  return {
    pathData: value.pathData,
    matrix: [...value.matrix],
    fillRule: value.fillRule,
    bounds: { ...value.bounds },
    isAxisAlignedRectangle: value.isAxisAlignedRectangle
  };
}

function cloneNativeGradientPaintState(state: NativeGradientPaintState): NativeGradientPaintState {
  return {
    ...state,
    matrix: [...state.matrix],
    patternBaseMatrix: [...state.patternBaseMatrix],
    clipBounds: cloneBoundsOrNull(state.clipBounds),
    clipGeometry: cloneNativeClipGeometry(state.clipGeometry),
    lineDash: [...state.lineDash],
    fillPattern: state.fillPattern
      ? { patternId: state.fillPattern.patternId, matrix: [...state.fillPattern.matrix] }
      : null,
    strokePattern: state.strokePattern
      ? { patternId: state.strokePattern.patternId, matrix: [...state.strokePattern.matrix] }
      : null
  };
}

function createNativeRectangleClip(bounds: Bounds): NativeClipGeometry {
  return {
    pathData: new Float32Array([
      DRAW_MOVE_TO, bounds.minX, bounds.minY,
      DRAW_LINE_TO, bounds.maxX, bounds.minY,
      DRAW_LINE_TO, bounds.maxX, bounds.maxY,
      DRAW_LINE_TO, bounds.minX, bounds.maxY,
      DRAW_CLOSE
    ]),
    matrix: [...IDENTITY_MATRIX],
    fillRule: FILL_RULE_NONZERO,
    bounds: { ...bounds },
    isAxisAlignedRectangle: true
  };
}

function nativeMatrixPreservesAxisAlignedRectangles(matrix: Mat2D): boolean {
  const epsilon = 1e-8;
  return (
    (Math.abs(matrix[1]) <= epsilon && Math.abs(matrix[2]) <= epsilon) ||
    (Math.abs(matrix[0]) <= epsilon && Math.abs(matrix[3]) <= epsilon)
  );
}

function nativeBoundsContains(outer: Bounds, inner: Bounds): boolean {
  const epsilon = 1e-4;
  return (
    outer.minX <= inner.minX + epsilon &&
    outer.minY <= inner.minY + epsilon &&
    outer.maxX + epsilon >= inner.maxX &&
    outer.maxY + epsilon >= inner.maxY
  );
}

function nativeBoundsEqual(left: Bounds | null, right: Bounds | null): boolean {
  if (!left || !right) {
    return left === right;
  }
  const epsilon = 1e-4;
  return (
    Math.abs(left.minX - right.minX) <= epsilon &&
    Math.abs(left.minY - right.minY) <= epsilon &&
    Math.abs(left.maxX - right.maxX) <= epsilon &&
    Math.abs(left.maxY - right.maxY) <= epsilon
  );
}

function applyNativeClipGeometry(
  state: NativeGradientPaintState,
  geometry: NativeClipGeometry
): void {
  const previousBounds = state.clipBounds;
  const nextBounds = intersectBounds(previousBounds, geometry.bounds);
  state.clipBounds = nextBounds;
  if (!nextBounds) {
    state.clipGeometry = null;
    return;
  }
  if (state.clipGeometry?.isAxisAlignedRectangle && geometry.isAxisAlignedRectangle) {
    state.clipGeometry = createNativeRectangleClip(nextBounds);
    return;
  }
  if (!previousBounds || nativeBoundsContains(previousBounds, geometry.bounds)) {
    state.clipGeometry = geometry;
    return;
  }
  if (nativeBoundsContains(geometry.bounds, previousBounds)) {
    return;
  }
  // A general intersection of two arbitrary PDF clips needs boolean path
  // geometry. Keep its bounds for culling, but make native shading ineligible.
  state.clipGeometry = null;
}

function readNativePatternReference(args: unknown): NativePatternReference | null {
  if (readArg(args, 0) !== "Shading") {
    return null;
  }
  const patternId = readArg(args, 1);
  const matrix = readTransform(readArg(args, 2));
  return typeof patternId === "string" && matrix
    ? { patternId, matrix }
    : null;
}

function readNativeBlendMode(entries: unknown, fallback: string): string {
  if (!Array.isArray(entries)) {
    return fallback;
  }
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry[0] !== "BM") {
      continue;
    }
    const raw = Array.isArray(entry[1]) ? entry[1][0] : entry[1];
    return typeof raw === "string" ? raw : fallback;
  }
  return fallback;
}

function isNativeNormalBlendMode(value: string): boolean {
  return value === "source-over" || value === "normal" || value === "Normal";
}

function effectiveNativeFillAlpha(state: NativeGradientPaintState): number {
  return state.fillAlphaVersion === state.groupFillAlphaVersion
    ? clamp01(state.groupFillAlpha)
    : clamp01(state.groupFillAlpha * state.fillAlpha);
}

function effectiveNativeStrokeAlpha(state: NativeGradientPaintState): number {
  return state.strokeAlphaVersion === state.groupStrokeAlphaVersion
    ? clamp01(state.groupStrokeAlpha)
    : clamp01(state.groupStrokeAlpha * state.strokeAlpha);
}

function scanNativeGradientStates(
  operatorList: PdfOperatorListLike,
  pageMatrix: Mat2D,
  pageBounds: Bounds
): NativeGradientScan {
  const states = new Map<number, NativeGradientPaintState>();
  const softMaskGroupEntryStates = new Map<number, NativeGradientPaintState>();
  const paintOrdinalByOp = new Int32Array(operatorList.fnArray.length);
  paintOrdinalByOp.fill(-1);
  const topology: string[] = [];
  const stateStack: NativeGradientPaintState[] = [];
  const formStateStack: NativeGradientPaintState[] = [];
  const annotationStateStack: NativeGradientPaintState[] = [];
  const groupStateStack: NativeGradientPaintState[] = [];
  let state: NativeGradientPaintState = {
    matrix: [...pageMatrix],
    patternBaseMatrix: [...pageMatrix],
    clipBounds: { ...pageBounds },
    clipGeometry: createNativeRectangleClip(pageBounds),
    fillR: 0,
    fillG: 0,
    fillB: 0,
    fillAlpha: 1,
    groupFillAlpha: 1,
    fillAlphaVersion: 0,
    groupFillAlphaVersion: -1,
    strokeR: 0,
    strokeG: 0,
    strokeB: 0,
    strokeAlpha: 1,
    groupStrokeAlpha: 1,
    strokeAlphaVersion: 0,
    groupStrokeAlphaVersion: -1,
    lineWidth: 1,
    lineCap: 0,
    lineDash: [],
    dashPhase: 0,
    fillPattern: null,
    strokePattern: null,
    blendMode: "source-over"
  };
  let pendingClipRule: number | null = null;
  let pendingClipGeometry: NativeClipGeometry | null = null;
  let paintOrdinal = 0;

  for (let i = 0; i < operatorList.fnArray.length; i += 1) {
    const fn = operatorList.fnArray[i];
    const args = operatorList.argsArray[i];

    if (isNativeDensePaintOperator(fn, args)) {
      paintOrdinalByOp[i] = paintOrdinal;
      const paintOp = fn === OPS.constructPath ? readNumber(args, 0, -1) : -1;
      topology.push(
        fn === OPS.shadingFill ? "G" :
          isNativeDenseImagePaintOperator(fn) ? "I" :
            isTextPaintOperator(fn) ? "T" :
              isFillPaintOp(paintOp) && isStrokePaintOp(paintOp) ? "B" :
                isFillPaintOp(paintOp) ? "F" : "S"
      );
      states.set(i, cloneNativeGradientPaintState(state));
      paintOrdinal += 1;
    }

    if (fn === OPS.beginGroup && readNativeSoftMaskMetadata(args)) {
      softMaskGroupEntryStates.set(i, cloneNativeGradientPaintState(state));
    }

    if (fn === OPS.save) {
      stateStack.push(cloneNativeGradientPaintState(state));
      continue;
    }
    if (fn === OPS.restore) {
      state = stateStack.pop() ?? state;
      pendingClipRule = null;
      pendingClipGeometry = null;
      continue;
    }
    if (fn === OPS.transform) {
      const matrix = readTransform(args);
      if (matrix) {
        state.matrix = multiplyMatrices(state.matrix, matrix);
      }
      continue;
    }
    if (fn === OPS.paintFormXObjectBegin) {
      formStateStack.push(cloneNativeGradientPaintState(state));
      const matrix = readTransform(args);
      if (matrix) {
        state.matrix = multiplyMatrices(state.matrix, matrix);
      }
      state.patternBaseMatrix = [...state.matrix];
      continue;
    }
    if (fn === OPS.paintFormXObjectEnd) {
      state = formStateStack.pop() ?? state;
      pendingClipRule = null;
      pendingClipGeometry = null;
      continue;
    }
    if (fn === OPS.beginAnnotation) {
      annotationStateStack.push(cloneNativeGradientPaintState(state));
      const matrix = readAnnotationTransform(args);
      if (matrix) {
        state.matrix = multiplyMatrices(state.matrix, matrix);
        state.patternBaseMatrix = [...state.matrix];
      }
      continue;
    }
    if (fn === OPS.endAnnotation) {
      state = annotationStateStack.pop() ?? state;
      pendingClipRule = null;
      pendingClipGeometry = null;
      continue;
    }
    if (fn === OPS.beginGroup) {
      groupStateStack.push(cloneNativeGradientPaintState(state));
      state.groupFillAlpha = effectiveNativeFillAlpha(state);
      state.groupStrokeAlpha = effectiveNativeStrokeAlpha(state);
      state.groupFillAlphaVersion = state.fillAlphaVersion;
      state.groupStrokeAlphaVersion = state.strokeAlphaVersion;
      const group = readArg(args, 0) as { matrix?: unknown; bbox?: unknown } | null;
      const groupMatrix = readTransform(group?.matrix);
      if (groupMatrix) {
        state.matrix = multiplyMatrices(state.matrix, groupMatrix);
      }
      const bbox = asNumberArrayLike(group?.bbox);
      if (bbox && bbox.length >= 4) {
        const x0 = Number(bbox[0]);
        const y0 = Number(bbox[1]);
        const x1 = Number(bbox[2]);
        const y1 = Number(bbox[3]);
        if (![x0, y0, x1, y1].every(Number.isFinite)) {
          state.clipGeometry = null;
          continue;
        }
        const localBounds: Bounds = {
          minX: Math.min(x0, x1),
          minY: Math.min(y0, y1),
          maxX: Math.max(x0, x1),
          maxY: Math.max(y0, y1)
        };
        const geometry = createNativeRectangleClip(localBounds);
        geometry.matrix = [...state.matrix];
        geometry.bounds = transformBounds(localBounds, state.matrix);
        geometry.isAxisAlignedRectangle = nativeMatrixPreservesAxisAlignedRectangles(state.matrix);
        applyNativeClipGeometry(state, geometry);
      }
      continue;
    }
    if (fn === OPS.endGroup) {
      state = groupStateStack.pop() ?? state;
      pendingClipRule = null;
      pendingClipGeometry = null;
      continue;
    }

    if (fn === OPS.clip || fn === OPS.eoClip) {
      if (pendingClipGeometry) {
        pendingClipGeometry.fillRule = fn === OPS.eoClip ? FILL_RULE_EVEN_ODD : FILL_RULE_NONZERO;
        applyNativeClipGeometry(state, pendingClipGeometry);
        pendingClipGeometry = null;
      } else {
        pendingClipRule = fn === OPS.eoClip ? FILL_RULE_EVEN_ODD : FILL_RULE_NONZERO;
      }
      continue;
    }
    if (fn === OPS.constructPath) {
      const pathData = readPathData(args);
      if (pathData) {
        const localBounds = computeTransformedPathBounds(pathData, state.matrix);
        if (!localBounds) {
          pendingClipGeometry = null;
          pendingClipRule = null;
          continue;
        }
        const geometry: NativeClipGeometry = {
          pathData,
          matrix: [...state.matrix],
          fillRule: pendingClipRule ?? FILL_RULE_NONZERO,
          bounds: localBounds,
          isAxisAlignedRectangle: (() => {
            const rectangleMask = extractSimpleEvenOddRectangleClipMask(pathData, state.matrix);
            return Boolean(rectangleMask && rectangleMask.exclusionBounds.length === 0);
          })()
        };
        if (pendingClipRule !== null) {
          applyNativeClipGeometry(state, geometry);
          pendingClipRule = null;
        } else if (readNumber(args, 0, -1) === OPS.endPath) {
          pendingClipGeometry = geometry;
        } else {
          pendingClipGeometry = null;
        }
      }
      continue;
    }
    if (fn === OPS.endPath) {
      pendingClipGeometry = null;
      pendingClipRule = null;
      continue;
    }

    if (fn === OPS.setLineWidth) {
      state.lineWidth = Math.max(0, readNumber(args, 0, state.lineWidth));
      continue;
    }
    if (fn === OPS.setLineCap) {
      state.lineCap = Math.min(2, Math.max(0, Math.trunc(readNumber(args, 0, state.lineCap))));
      continue;
    }
    if (fn === OPS.setDash) {
      const dash = readLineDash(args);
      if (dash) {
        state.lineDash = dash.pattern;
        state.dashPhase = dash.phase;
      }
      continue;
    }
    if (fn === OPS.setFillColorN) {
      state.fillPattern = readNativePatternReference(args);
      continue;
    }
    if (fn === OPS.setStrokeColorN) {
      state.strokePattern = readNativePatternReference(args);
      continue;
    }
    if (isSolidFillColorOperator(fn)) {
      state.fillPattern = null;
      if (fn === OPS.setFillCMYKColor) {
        [state.fillR, state.fillG, state.fillB] = parseCmykColorFromOperatorArgs(args, [state.fillR, state.fillG, state.fillB]);
      } else if (fn === OPS.setFillGray) {
        const [gray] = parseGrayColor(readArg(args, 0), state.fillR);
        state.fillR = state.fillG = state.fillB = gray;
      } else if (fn === OPS.setFillRGBColor || fn === OPS.setFillColor) {
        [state.fillR, state.fillG, state.fillB] = parseColorFromOperatorArgs(args, [state.fillR, state.fillG, state.fillB]);
      }
      continue;
    }
    if (isSolidStrokeColorOperator(fn)) {
      state.strokePattern = null;
      if (fn === OPS.setStrokeCMYKColor) {
        [state.strokeR, state.strokeG, state.strokeB] = parseCmykColorFromOperatorArgs(args, [state.strokeR, state.strokeG, state.strokeB]);
      } else if (fn === OPS.setStrokeGray) {
        const [gray] = parseGrayColor(readArg(args, 0), state.strokeR);
        state.strokeR = state.strokeG = state.strokeB = gray;
      } else if (fn === OPS.setStrokeRGBColor || fn === OPS.setStrokeColor) {
        [state.strokeR, state.strokeG, state.strokeB] = parseColorFromOperatorArgs(args, [state.strokeR, state.strokeG, state.strokeB]);
      }
      continue;
    }
    if (fn === OPS.setGState) {
      const entries = readArg(args, 0);
      state.blendMode = readNativeBlendMode(entries, state.blendMode);
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (!Array.isArray(entry) || entry.length < 2) {
            continue;
          }
          if (entry[0] === "ca") {
            const alpha = Number(entry[1]);
            if (Number.isFinite(alpha)) {
              state.fillAlpha = clamp01(alpha);
              state.fillAlphaVersion += 1;
            }
          } else if (entry[0] === "CA") {
            const alpha = Number(entry[1]);
            if (Number.isFinite(alpha)) {
              state.strokeAlpha = clamp01(alpha);
              state.strokeAlphaVersion += 1;
            }
          }
        }
      }
    }
  }

  return {
    states,
    softMaskGroupEntryStates,
    paintOrdinalByOp,
    paintTopologySignature: topology.join("")
  };
}

type NativeGradientStop = [number, number, number, number, number];

function parseNativeGradientColor(value: unknown): [number, number, number, number] | null {
  if (value === "transparent") {
    return [0, 0, 0, 0];
  }
  if (typeof value !== "string" || !/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value)) {
    return null;
  }
  const [r, g, b] = parseHexColor(value);
  return [r / 255, g / 255, b / 255, 1];
}

function buildNativeGradientLut(stops: NativeGradientStop[]): Uint8Array {
  const lut = new Uint8Array(GRADIENT_LUT_WIDTH * 4);
  let stopIndex = 0;
  for (let i = 0; i < GRADIENT_LUT_WIDTH; i += 1) {
    const t = GRADIENT_LUT_WIDTH > 1 ? i / (GRADIENT_LUT_WIDTH - 1) : 0;
    while (stopIndex + 1 < stops.length && stops[stopIndex + 1][0] <= t) {
      stopIndex += 1;
    }
    const left = stops[stopIndex];
    const right = stops[Math.min(stops.length - 1, stopIndex + 1)];
    const span = right[0] - left[0];
    const ratio = span > 1e-9 ? clamp01((t - left[0]) / span) : 0;
    const offset = i * 4;
    const leftAlpha = left[4];
    const rightAlpha = right[4];
    const alpha = leftAlpha + (rightAlpha - leftAlpha) * ratio;
    for (let channel = 0; channel < 3; channel += 1) {
      const leftPremultiplied = left[channel + 1] * leftAlpha;
      const rightPremultiplied = right[channel + 1] * rightAlpha;
      const premultiplied = leftPremultiplied + (rightPremultiplied - leftPremultiplied) * ratio;
      const value = alpha > 1e-9 ? premultiplied / alpha : 0;
      lut[offset + channel] = Math.round(clamp01(value) * 255);
    }
    lut[offset + 3] = Math.round(clamp01(alpha) * 255);
  }
  return lut;
}

function parseNativeRadialAxialGradient(
  page: unknown,
  patternId: string,
  gradientToScene: Mat2D
): NativeGradientDefinition | null {
  const objects = (page as { objs?: { get?: (id: string) => unknown } }).objs;
  if (!objects || typeof objects.get !== "function") {
    return null;
  }
  let raw: unknown;
  try {
    raw = objects.get(patternId);
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || raw[0] !== "RadialAxial") {
    return null;
  }
  const kind = raw[1] === "axial" ? 0 : raw[1] === "radial" ? 1 : -1;
  if (kind < 0) {
    return null;
  }
  const p0 = asNumberArrayLike(raw[4]);
  const p1 = asNumberArrayLike(raw[5]);
  if (!p0 || !p1 || p0.length < 2 || p1.length < 2) {
    return null;
  }
  const p0x = Number(p0[0]);
  const p0y = Number(p0[1]);
  const p1x = Number(p1[0]);
  const p1y = Number(p1[1]);
  let r0 = kind === 1 ? Number(raw[6]) : 0;
  let r1 = kind === 1 ? Number(raw[7]) : 0;
  if (![...gradientToScene, p0x, p0y, p1x, p1y, r0, r1].every(Number.isFinite)) {
    return null;
  }
  if (kind === 0 && Math.hypot(p1x - p0x, p1y - p0y) <= 1e-9) {
    return null;
  }
  if (kind === 1) {
    if (r0 < 0 || r1 < 0) {
      return null;
    }
    const centerDistance = Math.hypot(p0x - p1x, p0y - p1y);
    if (centerDistance <= 1e-9 && Math.abs(r1 - r0) <= 1e-9) {
      return null;
    }
    // PDF.js needs a second reversed Canvas gradient for intersecting/conic
    // radial circles. Keep that uncommon topology on the exact raster path.
    if (centerDistance + r1 > r0 && centerDistance + r0 > r1) {
      return null;
    }
  }
  const sceneToGradient = invertMatrix(gradientToScene);
  if (!sceneToGradient) {
    return null;
  }
  const rawStops = Array.isArray(raw[3]) ? raw[3] : [];
  const stops: NativeGradientStop[] = [];
  for (const entry of rawStops) {
    if (!Array.isArray(entry) || entry.length < 2) {
      return null;
    }
    const offset = Number(entry[0]);
    const color = parseNativeGradientColor(entry[1]);
    if (!Number.isFinite(offset) || !color) {
      return null;
    }
    stops.push([clamp01(offset), color[0], color[1], color[2], color[3]]);
  }
  if (stops.length === 0) {
    return null;
  }
  stops.sort((left, right) => left[0] - right[0]);
  if (stops[0][0] > 0) {
    stops.unshift([0, stops[0][1], stops[0][2], stops[0][3], stops[0][4]]);
  }
  if (stops[stops.length - 1][0] < 1) {
    const last = stops[stops.length - 1];
    stops.push([1, last[1], last[2], last[3], last[4]]);
  }
  let bbox: [number, number, number, number] | null = null;
  if (raw[2] !== null && raw[2] !== undefined) {
    const values = asNumberArrayLike(raw[2]);
    if (!values || values.length < 4) {
      return null;
    }
    const x0 = Number(values[0]);
    const y0 = Number(values[1]);
    const x1 = Number(values[2]);
    const y1 = Number(values[3]);
    if (![x0, y0, x1, y1].every(Number.isFinite)) {
      return null;
    }
    bbox = [
      Math.min(x0, x1),
      Math.min(y0, y1),
      Math.max(x0, x1),
      Math.max(y0, y1)
    ];
  }
  return {
    kind: kind as 0 | 1,
    sceneToGradient,
    p0: [p0x, p0y],
    p1: [p1x, p1y],
    r0,
    r1,
    bbox,
    lut: buildNativeGradientLut(stops)
  };
}

function readNativeSoftMaskMetadata(args: unknown): {
  subtype: "Alpha" | "Luminosity";
  backdrop: string | null;
  transferMap: Uint8Array | null;
} | null {
  const group = readArg(args, 0) as { smask?: unknown } | null;
  const smask = group?.smask as { subtype?: unknown; backdrop?: unknown; transferMap?: unknown } | null;
  if (!smask || (smask.subtype !== "Alpha" && smask.subtype !== "Luminosity")) {
    return null;
  }
  const backdrop = typeof smask.backdrop === "string" ? smask.backdrop : null;
  if (smask.transferMap !== null && smask.transferMap !== undefined && !(smask.transferMap instanceof Uint8Array)) {
    return null;
  }
  const transferMap = smask.transferMap instanceof Uint8Array ? smask.transferMap : null;
  return { subtype: smask.subtype, backdrop, transferMap };
}

function collectNativeSoftMaskRanges(operatorList: PdfOperatorListLike): {
  ranges: NativeSoftMaskRange[];
  structuralMask: Uint8Array;
} {
  const ranges: NativeSoftMaskRange[] = [];
  const structuralMask = new Uint8Array(operatorList.fnArray.length);
  for (let start = 0; start < operatorList.fnArray.length; start += 1) {
    if (operatorList.fnArray[start] !== OPS.beginGroup) {
      continue;
    }
    const metadata = readNativeSoftMaskMetadata(operatorList.argsArray[start]);
    if (!metadata) {
      continue;
    }
    const definitionEnd = findMatchingGroupEnd(operatorList.fnArray, start);
    if (definitionEnd < 0) {
      break;
    }
    let definitionPaint = -1;
    let definitionPaintCount = 0;
    for (let i = start + 1; i < definitionEnd; i += 1) {
      if (isNativeDensePaintOperator(operatorList.fnArray[i], operatorList.argsArray[i])) {
        definitionPaint = i;
        definitionPaintCount += 1;
      }
    }

    let activated = false;
    let consumerStart = -1;
    let consumerEnd = -1;
    for (let i = definitionEnd + 1; i < operatorList.fnArray.length; i += 1) {
      const fn = operatorList.fnArray[i];
      if (fn === OPS.setGState) {
        const toggle = readGraphicsStateSoftMaskToggle(operatorList.argsArray[i]);
        if (toggle !== null) {
          activated = toggle;
        }
        continue;
      }
      if (!activated) {
        if (isNativeDensePaintOperator(fn, operatorList.argsArray[i]) || fn === OPS.restore || fn === OPS.paintFormXObjectEnd) {
          break;
        }
        continue;
      }
      if (fn === OPS.beginGroup) {
        consumerStart = i;
        consumerEnd = findMatchingGroupEnd(operatorList.fnArray, i);
        break;
      }
      if (isNativeDensePaintOperator(fn, operatorList.argsArray[i])) {
        consumerStart = consumerEnd = i;
        break;
      }
      if (fn === OPS.restore || fn === OPS.paintFormXObjectEnd || fn === OPS.endGroup) {
        break;
      }
    }
    if (consumerStart < 0 || consumerEnd < consumerStart) {
      structuralMask.fill(1, start, definitionEnd + 1);
      start = definitionEnd;
      continue;
    }
    structuralMask.fill(1, start, consumerEnd + 1);
    let consumerPaint = -1;
    let consumerPaintCount = 0;
    for (let i = consumerStart; i <= consumerEnd; i += 1) {
      if (isNativeDensePaintOperator(operatorList.fnArray[i], operatorList.argsArray[i])) {
        consumerPaint = i;
        consumerPaintCount += 1;
      }
    }
    if (
      definitionPaintCount === 1 &&
      operatorList.fnArray[definitionPaint] === OPS.shadingFill &&
      consumerPaintCount === 1
    ) {
      ranges.push({
        definitionStart: start,
        definitionEnd,
        definitionPaint,
        consumerStart,
        consumerEnd,
        consumerPaint,
        ...metadata
      });
    }
    start = definitionEnd;
  }
  return { ranges, structuralMask };
}

function bakeNativeMaskGradient(
  source: NativeGradientDefinition,
  subtype: "Alpha" | "Luminosity",
  backdrop: string | null,
  transferMap: Uint8Array | null,
  definitionOpacity: number
): NativeGradientDefinition | null {
  if (subtype === "Alpha" && backdrop) {
    return null;
  }
  const backdropColor = backdrop ? parseNativeGradientColor(backdrop) : null;
  if (backdrop && !backdropColor) {
    return null;
  }
  const lut = new Uint8Array(source.lut.length);
  for (let i = 0; i < GRADIENT_LUT_WIDTH; i += 1) {
    const offset = i * 4;
    const alpha = (source.lut[offset + 3] / 255) * clamp01(definitionOpacity);
    let mask: number;
    if (subtype === "Alpha") {
      mask = alpha;
    } else {
      let r = source.lut[offset] / 255;
      let g = source.lut[offset + 1] / 255;
      let b = source.lut[offset + 2] / 255;
      if (backdropColor) {
        r = r * alpha + backdropColor[0] * (1 - alpha);
        g = g * alpha + backdropColor[1] * (1 - alpha);
        b = b * alpha + backdropColor[2] * (1 - alpha);
      } else if (alpha < 1) {
        r *= alpha;
        g *= alpha;
        b *= alpha;
      }
      mask = clamp01(0.3 * r + 0.59 * g + 0.11 * b);
    }
    let byte = Math.round(mask * 255);
    if (transferMap && transferMap.length >= 256) {
      byte = transferMap[byte];
    }
    lut[offset] = 255;
    lut[offset + 1] = 255;
    lut[offset + 2] = 255;
    lut[offset + 3] = byte;
  }
  return { ...source, sceneToGradient: [...source.sceneToGradient], lut };
}

function constrainNativeMaskGradientToDefinitionClip(
  gradient: NativeGradientDefinition,
  state: NativeGradientPaintState
): boolean {
  if (
    !state.clipBounds ||
    !isNonEmptyBounds(state.clipBounds) ||
    !state.clipGeometry?.isAxisAlignedRectangle ||
    !nativeMatrixPreservesAxisAlignedRectangles(gradient.sceneToGradient)
  ) {
    return false;
  }
  const clipInGradientSpace = transformBounds(state.clipBounds, gradient.sceneToGradient);
  const existingBounds = gradient.bbox
    ? { minX: gradient.bbox[0], minY: gradient.bbox[1], maxX: gradient.bbox[2], maxY: gradient.bbox[3] }
    : null;
  const constrained = intersectBounds(existingBounds, clipInGradientSpace);
  if (!constrained || !isNonEmptyBounds(constrained)) {
    return false;
  }
  gradient.bbox = [constrained.minX, constrained.minY, constrained.maxX, constrained.maxY];
  return true;
}

function nativeGradientTopologyMatches(source: NativeGradientPlan, display: NativeGradientPlan): boolean {
  return (
    source.paintTopologySignature === display.paintTopologySignature &&
    source.nativeTopologySignature === display.nativeTopologySignature
  );
}

function nativePaintHasEarlierOrdinaryVectorHazard(
  operatorList: PdfOperatorListLike,
  opIndex: number,
  alreadyNativePathOps: ReadonlySet<number>
): boolean {
  for (let i = 0; i < opIndex; i += 1) {
    const fn = operatorList.fnArray[i];
    if (isTextPaintOperator(fn)) {
      return true;
    }
    if (fn !== OPS.constructPath || alreadyNativePathOps.has(i)) {
      continue;
    }
    const paintOp = readNumber(operatorList.argsArray[i], 0, OPS.endPath);
    if (isFillPaintOp(paintOp) || isStrokePaintOp(paintOp)) {
      return true;
    }
  }
  return false;
}

function hasNativeGradientCandidateOperators(operatorList: PdfOperatorListLike): boolean {
  for (let i = 0; i < operatorList.fnArray.length; i += 1) {
    const fn = operatorList.fnArray[i];
    if (fn === OPS.shadingFill) {
      return true;
    }
    if (
      (fn === OPS.setFillColorN || fn === OPS.setStrokeColorN) &&
      readNativePatternReference(operatorList.argsArray[i])
    ) {
      return true;
    }
  }
  return false;
}

function buildNativeGradientPlan(
  page: unknown,
  operatorList: PdfOperatorListLike,
  pageMatrix: Mat2D,
  pageBounds: Bounds
): NativeGradientPlan {
  // The state scan retains a snapshot for every paint operator so candidate
  // gradients can be reconstructed with their exact PDF graphics state. Most
  // PDFs have no gradient-capable operators at all; skipping the scan matters
  // especially for CAD exports with millions of ordinary path paints.
  if (!hasNativeGradientCandidateOperators(operatorList)) {
    return {
      gradients: [],
      paints: [],
      nativePathPaintMask: new Uint8Array(0),
      rasterExcludedPaintMask: new Uint8Array(0),
      paintTopologySignature: "",
      nativeTopologySignature: ""
    };
  }

  const gradients: NativeGradientDefinition[] = [];
  const paints: NativeGradientPaint[] = [];
  const nativePathPaintMask = new Uint8Array(operatorList.fnArray.length);
  const rasterExcludedPaintMask = new Uint8Array(operatorList.fnArray.length);
  const scan = scanNativeGradientStates(operatorList, pageMatrix, pageBounds);
  const masks = collectNativeSoftMaskRanges(operatorList);
  const reservedMask = masks.structuralMask;
  const nativeConsumerOps = new Set<number>();
  const nativeLeadingStrokeOps = new Set<number>();
  const nativeOrderedPathOps = new Set<number>();
  const topology: string[] = [];

  // Existing exact graphics-composite fallback owns the whole page when a
  // backdrop-dependent blend is present. Do not layer native paints over it.
  if (operatorList.fnArray.some((fn, index) => fn === OPS.setGState && graphicsStateHasBackdropDependentBlend(operatorList.argsArray[index]))) {
    return {
      gradients,
      paints,
      nativePathPaintMask,
      rasterExcludedPaintMask,
      paintTopologySignature: scan.paintTopologySignature,
      nativeTopologySignature: ""
    };
  }

  const addGradient = (gradient: NativeGradientDefinition): number => {
    gradients.push(gradient);
    return gradients.length - 1;
  };
  const addPaint = (paint: NativeGradientPaint): void => {
    paints.push(paint);
    if (operatorList.fnArray[paint.opIndex] === OPS.constructPath) {
      nativePathPaintMask[paint.opIndex] = 1;
      nativeOrderedPathOps.add(paint.opIndex);
    }
    rasterExcludedPaintMask[paint.opIndex] = 1;
    topology.push(`${paint.paintOrdinal}:${paint.kind}:${paint.sourceGradientIndex >= 0 ? "g" : "s"}:${paint.maskGradientIndex >= 0 ? "m" : "-"}`);
  };

  // A patterned stroke is only order-safe in the current split vector scene
  // when it belongs to the first visible, stroke-only paint run. Move that
  // complete run (including its solid-color companion arcs) into ordered
  // gradient stroke runs. Pattern paints later in the page keep using the
  // existing atomic graphics raster fallback.
  const leadingStrokeOps: number[] = [];
  let leadingRunHasPattern = false;
  for (let i = 0; i < operatorList.fnArray.length; i += 1) {
    const fn = operatorList.fnArray[i];
    const args = operatorList.argsArray[i];
    if (fn === OPS.constructPath) {
      const paintOp = readNumber(args, 0, -1);
      if (paintOp === OPS.endPath) {
        continue;
      }
      if (!isStrokePaintOp(paintOp) || isFillPaintOp(paintOp)) {
        break;
      }
      const state = scan.states.get(i);
      if (
        !state ||
        !isNativeNormalBlendMode(state.blendMode) ||
        !state.clipBounds ||
        !isNonEmptyBounds(state.clipBounds) ||
        !state.clipGeometry?.isAxisAlignedRectangle ||
        reservedMask[i] === 1
      ) {
        leadingStrokeOps.length = 0;
        break;
      }
      leadingStrokeOps.push(i);
      leadingRunHasPattern = leadingRunHasPattern || state.strokePattern !== null;
      continue;
    }
    if (fn === OPS.shadingFill || isImagePaintOperator(fn) || isTextPaintOperator(fn) || fn === OPS.paintXObject) {
      break;
    }
  }
  if (leadingRunHasPattern && leadingStrokeOps.length > 0) {
    const compiledLeadingRun: Array<{
      opIndex: number;
      pathData: Float32Array;
      state: NativeGradientPaintState;
      gradient: NativeGradientDefinition | null;
    }> = [];
    for (const opIndex of leadingStrokeOps) {
      const state = scan.states.get(opIndex);
      const pathData = readPathData(operatorList.argsArray[opIndex]);
      if (!state || !pathData) {
        compiledLeadingRun.length = 0;
        break;
      }
      let gradient: NativeGradientDefinition | null = null;
      if (state.strokePattern) {
        gradient = parseNativeRadialAxialGradient(
          page,
          state.strokePattern.patternId,
          multiplyMatrices(state.patternBaseMatrix, state.strokePattern.matrix)
        );
        if (!gradient) {
          compiledLeadingRun.length = 0;
          break;
        }
      }
      compiledLeadingRun.push({ opIndex, pathData, state, gradient });
    }
    if (compiledLeadingRun.length === leadingStrokeOps.length) {
      for (const entry of compiledLeadingRun) {
        addPaint({
          opIndex: entry.opIndex,
          paintOrdinal: scan.paintOrdinalByOp[entry.opIndex],
          kind: "stroke",
          pathData: entry.pathData,
          matrix: [...entry.state.matrix],
          fillRule: FILL_RULE_NONZERO,
          state: entry.state,
          sourceGradientIndex: entry.gradient ? addGradient(entry.gradient) : -1,
          maskGradientIndex: -1
        });
        nativeLeadingStrokeOps.add(entry.opIndex);
      }
    }
  }

  for (const range of masks.ranges) {
    const definitionState = scan.states.get(range.definitionPaint);
    const definitionGroupEntryState = scan.softMaskGroupEntryStates.get(range.definitionStart);
    const consumerState = scan.states.get(range.consumerPaint);
    if (
      !definitionState ||
      !definitionGroupEntryState ||
      !consumerState ||
      !consumerState.clipBounds ||
      !isNonEmptyBounds(consumerState.clipBounds) ||
      !consumerState.clipGeometry?.isAxisAlignedRectangle ||
      !isNativeNormalBlendMode(definitionState.blendMode) ||
      !isNativeNormalBlendMode(consumerState.blendMode) ||
      nativePaintHasEarlierOrdinaryVectorHazard(
        operatorList,
        range.consumerPaint,
        nativeOrderedPathOps
      )
    ) {
      continue;
    }
    const definitionId = readArg(operatorList.argsArray[range.definitionPaint], 0);
    if (typeof definitionId !== "string") {
      continue;
    }
    const maskSource = parseNativeRadialAxialGradient(page, definitionId, definitionState.matrix);
    const definitionGroupEntryAlpha = effectiveNativeFillAlpha(definitionGroupEntryState);
    if (definitionGroupEntryAlpha <= ALPHA_INVISIBLE_EPSILON) {
      continue;
    }
    const definitionLocalOpacity = clamp01(
      effectiveNativeFillAlpha(definitionState) / definitionGroupEntryAlpha
    );
    const bakedMask = maskSource
      ? bakeNativeMaskGradient(
        maskSource,
        range.subtype,
        range.backdrop,
        range.transferMap,
        definitionLocalOpacity
      )
      : null;
    if (!bakedMask) {
      continue;
    }
    const definitionClipSharedByConsumer =
      definitionState.clipGeometry?.isAxisAlignedRectangle === true &&
      consumerState.clipGeometry?.isAxisAlignedRectangle === true &&
      nativeBoundsEqual(definitionState.clipBounds, consumerState.clipBounds);
    if (
      !definitionClipSharedByConsumer &&
      !constrainNativeMaskGradientToDefinitionClip(bakedMask, definitionState)
    ) {
      continue;
    }
    const consumerFn = operatorList.fnArray[range.consumerPaint];
    const consumerArgs = operatorList.argsArray[range.consumerPaint];
    let paint: NativeGradientPaint | null = null;
    let sourceGradient: NativeGradientDefinition | null = null;
    if (consumerFn === OPS.constructPath) {
      const paintOp = readNumber(consumerArgs, 0, -1);
      const fill = isFillPaintOp(paintOp);
      const stroke = isStrokePaintOp(paintOp);
      const pathData = readPathData(consumerArgs);
      if (!pathData || fill === stroke) {
        continue;
      }
      const pattern = fill ? consumerState.fillPattern : consumerState.strokePattern;
      if (pattern) {
        sourceGradient = parseNativeRadialAxialGradient(
          page,
          pattern.patternId,
          multiplyMatrices(consumerState.patternBaseMatrix, pattern.matrix)
        );
        if (!sourceGradient) {
          continue;
        }
      }
      paint = {
        opIndex: range.consumerPaint,
        paintOrdinal: scan.paintOrdinalByOp[range.consumerPaint],
        kind: fill ? "fill" : "stroke",
        pathData,
        matrix: [...consumerState.matrix],
        fillRule: isEvenOddFillPaintOp(paintOp) ? FILL_RULE_EVEN_ODD : FILL_RULE_NONZERO,
        state: consumerState,
        sourceGradientIndex: -1,
        maskGradientIndex: -1
      };
    } else if (
      consumerFn === OPS.shadingFill &&
      consumerState.clipGeometry?.isAxisAlignedRectangle
    ) {
      const patternId = readArg(consumerArgs, 0);
      if (typeof patternId !== "string") {
        continue;
      }
      sourceGradient = parseNativeRadialAxialGradient(page, patternId, consumerState.matrix);
      if (!sourceGradient) {
        continue;
      }
      paint = {
        opIndex: range.consumerPaint,
        paintOrdinal: scan.paintOrdinalByOp[range.consumerPaint],
        kind: "fill",
        pathData: consumerState.clipGeometry.pathData,
        matrix: [...consumerState.clipGeometry.matrix],
        fillRule: consumerState.clipGeometry.fillRule,
        state: consumerState,
        sourceGradientIndex: -1,
        maskGradientIndex: -1
      };
    }
    if (!paint) {
      continue;
    }
    const consumerBounds = computeTransformedPathBounds(paint.pathData, paint.matrix);
    if (
      !consumerBounds ||
      (
        consumerState.clipBounds &&
        !nativeBoundsContains(consumerState.clipBounds, consumerBounds) &&
        !consumerState.clipGeometry?.isAxisAlignedRectangle
      )
    ) {
      // Dedicated path geometry supports bounds clipping only for a scene-axis
      // rectangle. A clipped consumer under an arbitrary PDF clip remains an
      // atomic raster composite.
      continue;
    }
    if (sourceGradient) {
      paint.sourceGradientIndex = addGradient(sourceGradient);
    }
    paint.maskGradientIndex = addGradient(bakedMask);
    addPaint(paint);
    nativeConsumerOps.add(range.consumerPaint);
    rasterExcludedPaintMask[range.definitionPaint] = 1;
  }

  for (let i = 0; i < operatorList.fnArray.length; i += 1) {
    if (reservedMask[i] === 1 || nativeConsumerOps.has(i) || nativeLeadingStrokeOps.has(i)) {
      continue;
    }
    const fn = operatorList.fnArray[i];
    const args = operatorList.argsArray[i];
    const state = scan.states.get(i);
    if (!state || !isNativeNormalBlendMode(state.blendMode)) {
      continue;
    }
    if (fn === OPS.shadingFill) {
      if (nativePaintHasEarlierOrdinaryVectorHazard(operatorList, i, nativeOrderedPathOps)) {
        continue;
      }
      const patternId = readArg(args, 0);
      if (typeof patternId !== "string" || !state.clipGeometry?.isAxisAlignedRectangle) {
        continue;
      }
      const gradient = parseNativeRadialAxialGradient(page, patternId, state.matrix);
      if (!gradient) {
        continue;
      }
      addPaint({
        opIndex: i,
        paintOrdinal: scan.paintOrdinalByOp[i],
        kind: "fill",
        pathData: state.clipGeometry.pathData,
        matrix: [...state.clipGeometry.matrix],
        fillRule: state.clipGeometry.fillRule,
        state,
        sourceGradientIndex: addGradient(gradient),
        maskGradientIndex: -1
      });
      continue;
    }
    if (fn !== OPS.constructPath) {
      continue;
    }
    const paintOp = readNumber(args, 0, -1);
    const pathData = readPathData(args);
    if (!pathData) {
      continue;
    }
    const fill = isFillPaintOp(paintOp);
    const stroke = isStrokePaintOp(paintOp);
    if (fill === stroke) {
      continue;
    }
    const pattern = fill ? state.fillPattern : state.strokePattern;
    if (!pattern) {
      continue;
    }
    // Non-leading ColorN paths cannot be placed safely relative to the
    // ordinary fill/stroke/text bands, so leave their complete graphics run to
    // the existing ordered raster fallback.
  }

  const hasNonLeadingPatternPaint = operatorList.fnArray.some((fn, i) => {
    if (fn !== OPS.constructPath || nativeOrderedPathOps.has(i)) {
      return false;
    }
    const state = scan.states.get(i);
    if (!state) {
      return false;
    }
    const paintOp = readNumber(operatorList.argsArray[i], 0, OPS.endPath);
    return (
      (isFillPaintOp(paintOp) && state.fillPattern !== null) ||
      (isStrokePaintOp(paintOp) && state.strokePattern !== null)
    );
  });
  if (hasNonLeadingPatternPaint) {
    // The ordered-pattern fallback replays the complete graphics backdrop.
    // Mixing that atomic layer with native sparse paints would duplicate or
    // straddle them, so keep the whole page on the established fallback.
    return {
      gradients: [],
      paints: [],
      nativePathPaintMask: new Uint8Array(operatorList.fnArray.length),
      rasterExcludedPaintMask: new Uint8Array(operatorList.fnArray.length),
      paintTopologySignature: scan.paintTopologySignature,
      nativeTopologySignature: ""
    };
  }

  if (buildSoftMaskPaintMask(operatorList, rasterExcludedPaintMask).compositeCount > 0) {
    // Unsupported soft-mask groups are captured atomically by PDF.js. Their
    // group span has no single safe sparse paint anchor, so do not interleave
    // native paints elsewhere on the same page.
    return {
      gradients: [],
      paints: [],
      nativePathPaintMask: new Uint8Array(operatorList.fnArray.length),
      rasterExcludedPaintMask: new Uint8Array(operatorList.fnArray.length),
      paintTopologySignature: scan.paintTopologySignature,
      nativeTopologySignature: ""
    };
  }

  const residualRasterPlan = buildRasterOperatorPlan(operatorList, rasterExcludedPaintMask);
  const residualShadingSpan = resolveAggregateShadingPaintSpan(
    operatorList,
    residualRasterPlan,
    residualRasterPlan.hasEarlyStrokeUnderlayOps
  );
  if (
    residualShadingSpan &&
    paints.some((paint) => nativePaintOrdinalIsInsideSpan(paint.paintOrdinal, residualShadingSpan))
  ) {
    // A selective shading/soft-mask texture has one painter anchor. Include
    // consumer ordinals in its span and keep the page atomic when a native
    // paint would split that span.
    return {
      gradients: [],
      paints: [],
      nativePathPaintMask: new Uint8Array(operatorList.fnArray.length),
      rasterExcludedPaintMask: new Uint8Array(operatorList.fnArray.length),
      paintTopologySignature: scan.paintTopologySignature,
      nativeTopologySignature: ""
    };
  }

  paints.sort((left, right) => left.paintOrdinal - right.paintOrdinal);
  return {
    gradients,
    paints,
    nativePathPaintMask,
    rasterExcludedPaintMask,
    paintTopologySignature: scan.paintTopologySignature,
    nativeTopologySignature: topology.sort().join("|")
  };
}

interface RasterOperatorPlan {
  hasImagePaintOps: boolean;
  hasShadingFillOps: boolean;
  hasSoftMaskPaintOps: boolean;
  hasEarlyStrokeUnderlayOps: boolean;
  hasOrderedPatternPaintOps: boolean;
  hasBackdropDependentBlendOps: boolean;
  hasFormXObjectOps: boolean;
  /** Image paint ops plus the state ops they depend on. */
  imageOnlyMask: Uint8Array;
  /** Direct shadings and complete soft-mask composites, plus required state ops. */
  shadingOnlyMask: Uint8Array;
  /** State ops only — combined with a single op index to render one image in isolation. */
  imageStateMask: Uint8Array;
  /** Definition/activation/consumer ranges whose paint output must not also be vectorized. */
  softMaskPaintMask: Uint8Array;
  softMaskCompositeCount: number;
  /** A leading stroke-only paint run captured below later vector artwork. */
  earlyStrokeUnderlayMask: Uint8Array;
  earlyStrokeUnderlayCount: number;
  earlyStrokeUnderlaySignature: string;
  orderedPatternPaintCount: number;
  orderedPatternPaintSignature: string;
  /** True when every graphics paint precedes every text paint on the page. */
  graphicsPaintsBeforeText: boolean;
  /** Complete non-text artwork for pages that require an existing backdrop to blend. */
  graphicsOnlyMask: Uint8Array;
  /** Source vector paths represented by graphicsOnlyMask and therefore suppressed. */
  vectorPaintMask: Uint8Array;
  backdropBlendCount: number;
}

interface PdfOperatorListLike {
  fnArray: number[];
  argsArray: unknown[];
  lastChunk?: boolean;
}

function isImagePaintOperator(fn: number): boolean {
  return (
    fn === OPS.paintImageXObject ||
    fn === OPS.paintInlineImageXObject ||
    fn === OPS.paintInlineImageXObjectGroup ||
    fn === OPS.paintImageXObjectRepeat ||
    fn === OPS.paintImageMaskXObject ||
    fn === OPS.paintImageMaskXObjectGroup ||
    fn === OPS.paintImageMaskXObjectRepeat ||
    fn === OPS.paintSolidColorImageMask ||
    fn === OPS.beginInlineImage ||
    fn === OPS.beginImageData ||
    fn === OPS.endInlineImage
  );
}

function isTextPaintOperator(fn: number): boolean {
  return (
    fn === OPS.showText ||
    fn === OPS.showSpacedText ||
    fn === OPS.nextLineShowText ||
    fn === OPS.nextLineSetSpacingShowText
  );
}

function graphicsStateHasBackdropDependentBlend(args: unknown): boolean {
  const isBackdropDependent = (value: unknown): boolean =>
    typeof value === "string" && value !== "source-over" && value !== "normal";
  const entries = readArg(args, 0);
  if (!Array.isArray(entries)) {
    return false;
  }
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length < 2 || entry[0] !== "BM") {
      continue;
    }
    const blendMode = entry[1];
    if (Array.isArray(blendMode)) {
      return blendMode.some(isBackdropDependent);
    }
    return isBackdropDependent(blendMode);
  }
  return false;
}

function readGraphicsStateSoftMaskToggle(args: unknown): boolean | null {
  const entries = readArg(args, 0);
  if (!Array.isArray(entries)) {
    return null;
  }
  for (const entry of entries) {
    if (Array.isArray(entry) && entry.length >= 2 && entry[0] === "SMask") {
      return entry[1] === true;
    }
  }
  return null;
}

function groupDefinesSoftMask(args: unknown): boolean {
  const group = readArg(args, 0);
  if (!group || typeof group !== "object") {
    return false;
  }
  const softMask = (group as { smask?: unknown }).smask;
  return Boolean(softMask && typeof softMask === "object");
}

function findMatchingGroupEnd(fnArray: number[], beginIndex: number): number {
  let depth = 0;
  for (let i = beginIndex; i < fnArray.length; i += 1) {
    if (fnArray[i] === OPS.beginGroup) {
      depth += 1;
    } else if (fnArray[i] === OPS.endGroup) {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function buildSoftMaskPaintMask(
  operatorList: { fnArray: number[]; argsArray: unknown[] },
  excludedPaintMask?: Uint8Array
): { mask: Uint8Array; compositeCount: number } {
  const { fnArray, argsArray } = operatorList;
  const mask = new Uint8Array(fnArray.length);
  let compositeCount = 0;

  for (let definitionStart = 0; definitionStart < fnArray.length; definitionStart += 1) {
    if (fnArray[definitionStart] !== OPS.beginGroup || !groupDefinesSoftMask(argsArray[definitionStart])) {
      continue;
    }

    const definitionEnd = findMatchingGroupEnd(fnArray, definitionStart);
    if (definitionEnd < 0) {
      break;
    }
    let definitionIsNative = false;
    if (excludedPaintMask) {
      for (let i = definitionStart; i <= definitionEnd; i += 1) {
        if (excludedPaintMask[i] === 1) {
          definitionIsNative = true;
          break;
        }
      }
    }
    if (definitionIsNative) {
      definitionStart = definitionEnd;
      continue;
    }

    let softMaskActive = false;
    let consumerStart = -1;
    // PDF.js emits the SMask activation and its consumer group immediately after
    // the luminosity-mask definition. Follow non-paint state/marked-content ops,
    // but stop at a paint or graphics-scope boundary so unrelated groups cannot
    // be paired merely because they occur later in the list.
    for (let i = definitionEnd + 1; i < fnArray.length; i += 1) {
      const fn = fnArray[i];
      if (fn === OPS.setGState) {
        const toggle = readGraphicsStateSoftMaskToggle(argsArray[i]);
        if (toggle !== null) {
          softMaskActive = toggle;
        }
        continue;
      }
      if (fn === OPS.beginGroup) {
        if (softMaskActive) {
          consumerStart = i;
        }
        break;
      }
      if (
        fn === OPS.restore ||
        fn === OPS.paintFormXObjectEnd ||
        fn === OPS.endAnnotation ||
        fn === OPS.shadingFill ||
        isImagePaintOperator(fn) ||
        (fn === OPS.constructPath && readNumber(argsArray[i], 0, OPS.endPath) !== OPS.endPath) ||
        fn === OPS.showText ||
        fn === OPS.showSpacedText ||
        fn === OPS.nextLineShowText ||
        fn === OPS.nextLineSetSpacingShowText
      ) {
        break;
      }
    }

    if (consumerStart < 0) {
      definitionStart = definitionEnd;
      continue;
    }
    const consumerEnd = findMatchingGroupEnd(fnArray, consumerStart);
    if (consumerEnd < 0) {
      break;
    }

    mask.fill(1, definitionStart, consumerEnd + 1);
    compositeCount += 1;
    definitionStart = consumerEnd;
  }

  return { mask, compositeCount };
}

function isSolidStrokeColorOperator(fn: number): boolean {
  return (
    fn === OPS.setStrokeRGBColor ||
    fn === OPS.setStrokeColor ||
    fn === OPS.setStrokeGray ||
    fn === OPS.setStrokeCMYKColor ||
    fn === OPS.setStrokeColorSpace ||
    fn === OPS.setStrokeTransparent
  );
}

function isSolidFillColorOperator(fn: number): boolean {
  return (
    fn === OPS.setFillRGBColor ||
    fn === OPS.setFillColor ||
    fn === OPS.setFillGray ||
    fn === OPS.setFillCMYKColor ||
    fn === OPS.setFillColorSpace ||
    fn === OPS.setFillTransparent
  );
}

/**
 * Find a safe vector underlay that can be moved into the page's raster pass.
 *
 * Pattern-colored strokes cannot be represented by the flat RGB stroke buffer.
 * When such a stroke occurs in the first visible, stroke-only paint run, the
 * entire run can be rendered by PDF.js and placed below all later artwork
 * without changing painter order. Capturing the complete run also keeps nearby
 * solid-color decorative strokes in their original order relative to the
 * pattern stroke.
 */
function buildEarlyStrokeUnderlayMask(
  operatorList: { fnArray: number[]; argsArray: unknown[] },
  excludedPaintMask?: Uint8Array
): { mask: Uint8Array; count: number; signature: string } {
  const { fnArray, argsArray } = operatorList;
  if (!fnArray.includes(OPS.setStrokeColorN)) {
    return { mask: new Uint8Array(0), count: 0, signature: "" };
  }
  const mask = new Uint8Array(fnArray.length);
  const patternStates: boolean[] = [];
  const stateStack: boolean[] = [];
  const formStateStack: boolean[] = [];
  const annotationStateStack: boolean[] = [];
  let strokeUsesPattern = false;

  for (let i = 0; i < fnArray.length; i += 1) {
    const fn = fnArray[i];

    if (fn === OPS.save) {
      stateStack.push(strokeUsesPattern);
      continue;
    }
    if (fn === OPS.restore) {
      strokeUsesPattern = stateStack.pop() ?? strokeUsesPattern;
      continue;
    }
    if (fn === OPS.paintFormXObjectBegin) {
      formStateStack.push(strokeUsesPattern);
      continue;
    }
    if (fn === OPS.paintFormXObjectEnd) {
      strokeUsesPattern = formStateStack.pop() ?? strokeUsesPattern;
      continue;
    }
    if (fn === OPS.beginAnnotation) {
      annotationStateStack.push(strokeUsesPattern);
      continue;
    }
    if (fn === OPS.endAnnotation) {
      strokeUsesPattern = annotationStateStack.pop() ?? strokeUsesPattern;
      continue;
    }

    if (fn === OPS.setStrokeColorN) {
      strokeUsesPattern = true;
      continue;
    }
    if (isSolidStrokeColorOperator(fn)) {
      strokeUsesPattern = false;
      continue;
    }

    if (fn === OPS.constructPath) {
      const paintOp = readNumber(argsArray[i], 0, -1);
      const strokeOnly = isStrokePaintOp(paintOp) && !isFillPaintOp(paintOp);
      if (!strokeOnly) {
        if (isFillPaintOp(paintOp)) {
          break;
        }
        continue;
      }
      if (excludedPaintMask?.[i] === 1) {
        continue;
      }
      mask[i] = 1;
      patternStates.push(strokeUsesPattern);
      continue;
    }

    if (
      fn === OPS.shadingFill ||
      isTextPaintOperator(fn) ||
      isImagePaintOperator(fn) ||
      fn === OPS.paintXObject
    ) {
      break;
    }
  }

  if (patternStates.length === 0 || !patternStates.some(Boolean)) {
    return { mask: new Uint8Array(fnArray.length), count: 0, signature: "" };
  }

  return {
    mask,
    count: patternStates.length,
    signature: patternStates.map((value) => value ? "1" : "0").join("")
  };
}

function buildOrderedPatternPaintPlan(
  operatorList: { fnArray: number[]; argsArray: unknown[] },
  earlyStrokeUnderlayMask?: Uint8Array,
  excludedPaintMask?: Uint8Array
): { count: number; signature: string } {
  const { fnArray, argsArray } = operatorList;
  if (!fnArray.includes(OPS.setStrokeColorN) && !fnArray.includes(OPS.setFillColorN)) {
    return { count: 0, signature: "" };
  }
  const stateStack: Array<{ stroke: boolean; fill: boolean }> = [];
  const formStateStack: Array<{ stroke: boolean; fill: boolean }> = [];
  const annotationStateStack: Array<{ stroke: boolean; fill: boolean }> = [];
  const signatureParts: string[] = [];
  let strokeUsesPattern = false;
  let fillUsesPattern = false;

  const snapshot = (): { stroke: boolean; fill: boolean } => ({
    stroke: strokeUsesPattern,
    fill: fillUsesPattern
  });
  const restore = (state: { stroke: boolean; fill: boolean } | undefined): void => {
    if (state) {
      strokeUsesPattern = state.stroke;
      fillUsesPattern = state.fill;
    }
  };

  for (let i = 0; i < fnArray.length; i += 1) {
    const fn = fnArray[i];

    if (fn === OPS.save) {
      stateStack.push(snapshot());
      continue;
    }
    if (fn === OPS.restore) {
      restore(stateStack.pop());
      continue;
    }
    if (fn === OPS.paintFormXObjectBegin) {
      formStateStack.push(snapshot());
      continue;
    }
    if (fn === OPS.paintFormXObjectEnd) {
      restore(formStateStack.pop());
      continue;
    }
    if (fn === OPS.beginAnnotation) {
      annotationStateStack.push(snapshot());
      continue;
    }
    if (fn === OPS.endAnnotation) {
      restore(annotationStateStack.pop());
      continue;
    }

    if (fn === OPS.setStrokeColorN) {
      strokeUsesPattern = true;
      continue;
    }
    if (fn === OPS.setFillColorN) {
      fillUsesPattern = true;
      continue;
    }
    if (isSolidStrokeColorOperator(fn)) {
      strokeUsesPattern = false;
      continue;
    }
    if (isSolidFillColorOperator(fn)) {
      fillUsesPattern = false;
      continue;
    }

    if (fn !== OPS.constructPath || earlyStrokeUnderlayMask?.[i] === 1 || excludedPaintMask?.[i] === 1) {
      continue;
    }

    const paintOp = readNumber(argsArray[i], 0, -1);
    const patternedStroke = isStrokePaintOp(paintOp) && strokeUsesPattern;
    const patternedFill = isFillPaintOp(paintOp) && fillUsesPattern;
    if (!patternedStroke && !patternedFill) {
      continue;
    }

    signatureParts.push(patternedStroke && patternedFill ? "B" : patternedStroke ? "S" : "F");
  }

  return {
    count: signatureParts.length,
    signature: signatureParts.join("")
  };
}

function isImageRasterStateOperator(fn: number, args: unknown): boolean {
  if (
    fn === OPS.dependency ||
    fn === OPS.save ||
    fn === OPS.restore ||
    fn === OPS.transform ||
    fn === OPS.setLineWidth ||
    fn === OPS.setLineCap ||
    fn === OPS.setLineJoin ||
    fn === OPS.setMiterLimit ||
    fn === OPS.setDash ||
    fn === OPS.setRenderingIntent ||
    fn === OPS.setFlatness ||
    fn === OPS.setGState ||
    fn === OPS.beginGroup ||
    fn === OPS.endGroup ||
    fn === OPS.beginCompat ||
    fn === OPS.endCompat ||
    fn === OPS.beginAnnotation ||
    fn === OPS.endAnnotation ||
    fn === OPS.beginMarkedContent ||
    fn === OPS.beginMarkedContentProps ||
    fn === OPS.endMarkedContent ||
    fn === OPS.paintFormXObjectBegin ||
    fn === OPS.paintFormXObjectEnd ||
    fn === OPS.paintXObject ||
    fn === OPS.beginText ||
    fn === OPS.endText ||
    fn === OPS.setCharSpacing ||
    fn === OPS.setWordSpacing ||
    fn === OPS.setHScale ||
    fn === OPS.setLeading ||
    fn === OPS.setFont ||
    fn === OPS.setTextRenderingMode ||
    fn === OPS.setTextRise ||
    fn === OPS.moveText ||
    fn === OPS.setLeadingMoveText ||
    fn === OPS.setTextMatrix ||
    fn === OPS.nextLine ||
    fn === OPS.setCharWidth ||
    fn === OPS.setCharWidthAndBounds ||
    fn === OPS.clip ||
    fn === OPS.eoClip ||
    fn === OPS.endPath
  ) {
    return true;
  }

  if (
    fn === OPS.setFillRGBColor ||
    fn === OPS.setFillColor ||
    fn === OPS.setFillGray ||
    fn === OPS.setFillCMYKColor ||
    fn === OPS.setFillColorN ||
    fn === OPS.setFillColorSpace ||
    fn === OPS.setFillTransparent ||
    fn === OPS.setStrokeRGBColor ||
    fn === OPS.setStrokeColor ||
    fn === OPS.setStrokeGray ||
    fn === OPS.setStrokeCMYKColor ||
    fn === OPS.setStrokeColorN ||
    fn === OPS.setStrokeColorSpace ||
    fn === OPS.setStrokeTransparent
  ) {
    return true;
  }

  if (fn === OPS.constructPath) {
    const paintOp = readNumber(args, 0, -1);
    return paintOp === OPS.endPath;
  }

  return false;
}

function buildRasterOperatorPlan(
  operatorList: { fnArray: number[]; argsArray: unknown[] },
  excludedPaintMask?: Uint8Array
): RasterOperatorPlan {
  const imageOnlyMask = new Uint8Array(operatorList.fnArray.length);
  const shadingOnlyMask = new Uint8Array(operatorList.fnArray.length);
  const imageStateMask = new Uint8Array(operatorList.fnArray.length);
  const graphicsOnlyMask = new Uint8Array(operatorList.fnArray.length);
  const vectorPaintMask = new Uint8Array(operatorList.fnArray.length);
  const softMaskPlan = buildSoftMaskPaintMask(operatorList, excludedPaintMask);
  const softMaskPaintMask = softMaskPlan.mask;
  const earlyStrokeUnderlayPlan = buildEarlyStrokeUnderlayMask(operatorList, excludedPaintMask);
  const orderedPatternPlan = buildOrderedPatternPaintPlan(
    operatorList,
    earlyStrokeUnderlayPlan.mask,
    excludedPaintMask
  );
  let hasImagePaintOps = false;
  let hasShadingFillOps = false;
  let hasSoftMaskPaintOps = false;
  let hasBackdropDependentBlendOps = false;
  let backdropBlendCount = 0;
  let hasFormXObjectOps = false;
  let firstTextPaintIndex = Number.POSITIVE_INFINITY;
  let lastGraphicsPaintIndex = -1;

  for (let i = 0; i < operatorList.fnArray.length; i += 1) {
    const fn = operatorList.fnArray[i];
    const args = operatorList.argsArray[i];
    const nativePaint = excludedPaintMask?.[i] === 1;

    if (!isTextPaintOperator(fn)) {
      graphicsOnlyMask[i] = 1;
    }
    if (isTextPaintOperator(fn)) {
      firstTextPaintIndex = Math.min(firstTextPaintIndex, i);
    }
    if (fn === OPS.constructPath && !nativePaint) {
      const paintOp = readNumber(args, 0, -1);
      if (isStrokePaintOp(paintOp) || isFillPaintOp(paintOp)) {
        vectorPaintMask[i] = 1;
        lastGraphicsPaintIndex = i;
      }
    }
    if (!nativePaint && (fn === OPS.shadingFill || isImagePaintOperator(fn) || fn === OPS.paintXObject)) {
      lastGraphicsPaintIndex = i;
    }
    if (fn === OPS.setGState && graphicsStateHasBackdropDependentBlend(args)) {
      hasBackdropDependentBlendOps = true;
      backdropBlendCount += 1;
    }

    if (fn === OPS.paintFormXObjectBegin || fn === OPS.paintFormXObjectEnd || fn === OPS.paintXObject) {
      hasFormXObjectOps = true;
    }

    if (!nativePaint && softMaskPaintMask[i] === 1) {
      hasSoftMaskPaintOps = true;
      shadingOnlyMask[i] = 1;
    }

    if (fn === OPS.shadingFill && !nativePaint) {
      hasShadingFillOps = true;
      if (softMaskPaintMask[i] === 0) {
        shadingOnlyMask[i] = 1;
      }
    }

    if (isImagePaintOperator(fn) && softMaskPaintMask[i] === 0 && !nativePaint) {
      hasImagePaintOps = true;
      imageOnlyMask[i] = 1;
      continue;
    }

    if ((fn === OPS.shadingFill && !nativePaint) || softMaskPaintMask[i] === 1) {
      continue;
    }

    if (isImageRasterStateOperator(fn, args)) {
      imageOnlyMask[i] = 1;
      shadingOnlyMask[i] = 1;
      imageStateMask[i] = 1;
    }
  }

  return {
    hasImagePaintOps,
    hasShadingFillOps,
    hasSoftMaskPaintOps,
    hasEarlyStrokeUnderlayOps: earlyStrokeUnderlayPlan.count > 0,
    hasOrderedPatternPaintOps: orderedPatternPlan.count > 0,
    hasBackdropDependentBlendOps,
    hasFormXObjectOps,
    imageOnlyMask,
    shadingOnlyMask,
    imageStateMask,
    softMaskPaintMask,
    softMaskCompositeCount: softMaskPlan.compositeCount,
    earlyStrokeUnderlayMask: earlyStrokeUnderlayPlan.mask,
    earlyStrokeUnderlayCount: earlyStrokeUnderlayPlan.count,
    earlyStrokeUnderlaySignature: earlyStrokeUnderlayPlan.signature,
    orderedPatternPaintCount: orderedPatternPlan.count,
    orderedPatternPaintSignature: orderedPatternPlan.signature,
    graphicsPaintsBeforeText: lastGraphicsPaintIndex < firstTextPaintIndex,
    graphicsOnlyMask,
    vectorPaintMask,
    backdropBlendCount
  };
}

interface RasterImageOpPlan {
  opIndex: number;
  paintOrder: number;
  /** PDF-user-space CTM at the op; the image covers the unit square under this matrix. */
  ctm: Mat2D;
  /** Source pixels per page point; null for scale-free paints (solid-color masks). */
  nativeScale: number | null;
}

interface RasterImageOpScan {
  /** One entry per visible image paint op, in paint order; null when any op's placement or size is unreadable (repeat/group/inline-marker ops). */
  plans: RasterImageOpPlan[] | null;
  /** Largest native image scale on the page; null when any image op is unmeasurable. */
  nativeScaleHint: number | null;
}

function scanRasterImageOps(
  operatorList: { fnArray: number[]; argsArray: unknown[] },
  excludedPaintMask?: Uint8Array
): RasterImageOpScan {
  const matrixStack: Mat2D[] = [];
  let currentMatrix: Mat2D = [...IDENTITY_MATRIX];
  let maxScaleHint = 1;
  const plans: RasterImageOpPlan[] = [];
  let plansValid = true;
  let hintValid = true;
  let paintOrdinal = 0;

  for (let i = 0; i < operatorList.fnArray.length; i += 1) {
    const fn = operatorList.fnArray[i];
    const args = operatorList.argsArray[i];
    const currentPaintOrdinal = isNativeDensePaintOperator(fn, args) ? paintOrdinal++ : -1;

    if (fn === OPS.save) {
      matrixStack.push([...currentMatrix]);
      continue;
    }

    if (fn === OPS.restore) {
      const restored = matrixStack.pop();
      if (restored) {
        currentMatrix = restored;
      }
      continue;
    }

    if (fn === OPS.transform) {
      const transform = readTransform(args);
      if (transform) {
        currentMatrix = multiplyMatrices(currentMatrix, transform);
      }
      continue;
    }

    if (fn === OPS.paintFormXObjectBegin) {
      matrixStack.push([...currentMatrix]);
      const transform = readTransform(args);
      if (transform) {
        currentMatrix = multiplyMatrices(currentMatrix, transform);
      }
      continue;
    }

    if (fn === OPS.paintFormXObjectEnd) {
      const restored = matrixStack.pop();
      if (restored) {
        currentMatrix = restored;
      }
      continue;
    }

    if (fn === OPS.beginAnnotation) {
      matrixStack.push([...currentMatrix]);
      const annotationTransform = readAnnotationTransform(args);
      if (annotationTransform) {
        currentMatrix = multiplyMatrices(currentMatrix, annotationTransform);
      }
      continue;
    }

    if (fn === OPS.endAnnotation) {
      const restored = matrixStack.pop();
      if (restored) {
        currentMatrix = restored;
      }
      continue;
    }

    if (!isImagePaintOperator(fn) || excludedPaintMask?.[i] === 1) {
      continue;
    }

    const sx = Math.hypot(currentMatrix[0], currentMatrix[1]);
    const sy = Math.hypot(currentMatrix[2], currentMatrix[3]);
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 1e-5 || sy <= 1e-5) {
      // Degenerate placement paints a zero-area region — nothing visible to capture.
      continue;
    }

    // Solid-color mask paints carry no pixel data, so they don't constrain resolution.
    if (fn === OPS.paintSolidColorImageMask) {
      plans.push({ opIndex: i, paintOrder: currentPaintOrdinal, ctm: [...currentMatrix], nativeScale: null });
      continue;
    }

    const size = readImageOpIntrinsicSize(fn, args);
    if (!size) {
      plansValid = false;
      hintValid = false;
      continue;
    }

    const nativeScale = Math.max(size.width / sx, size.height / sy);
    if (!Number.isFinite(nativeScale)) {
      plansValid = false;
      hintValid = false;
      continue;
    }

    plans.push({ opIndex: i, paintOrder: currentPaintOrdinal, ctm: [...currentMatrix], nativeScale: Math.max(1, nativeScale) });
    if (nativeScale > maxScaleHint) {
      maxScaleHint = nativeScale;
    }
  }

  return {
    plans: plansValid ? plans : null,
    nativeScaleHint: hintValid && Number.isFinite(maxScaleHint) ? Math.max(1, maxScaleHint) : null
  };
}

function readImageOpIntrinsicSize(fn: number, args: unknown): { width: number; height: number } | null {
  // paintImageXObject args are [objId, width, height].
  if (fn === OPS.paintImageXObject) {
    const width = readNumber(args, 1, Number.NaN);
    const height = readNumber(args, 2, Number.NaN);
    if (width > 0 && height > 0) {
      return { width, height };
    }
    return null;
  }

  // Inline images and image masks carry the image object (with width/height) as args[0].
  if (fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
    const imageObject = readArg(args, 0);
    const width = Number((imageObject as { width?: unknown })?.width);
    const height = Number((imageObject as { height?: unknown })?.height);
    if (width > 0 && height > 0) {
      return { width, height };
    }
    return null;
  }

  // Repeat/group ops carry placement scales and position maps, not native pixel sizes.
  return null;
}

function createEmptyRasterLayerResult(): RasterLayerExtractResult {
  return {
    layers: [],
    bounds: null
  };
}

function createNativeOrderingFailureRasterResult(): RasterLayerExtractResult {
  return {
    layers: [],
    bounds: null,
    nativeOrderingFailed: true
  };
}

function combineRasterLayerResults(
  first: RasterLayerExtractResult,
  second: RasterLayerExtractResult
): RasterLayerExtractResult {
  const layers = [...first.layers, ...second.layers];
  if (
    layers.length > 1 &&
    layers.every((layer) => typeof layer.paintOrder === "number" && Number.isFinite(layer.paintOrder))
  ) {
    // Array order is the raster painter order persisted into VectorScene/ZIP.
    // Modern JS sorting is stable, so equal display-list anchors retain capture order.
    layers.sort((left, right) => (left.paintOrder as number) - (right.paintOrder as number));
  }
  return {
    layers,
    bounds: combineBounds(first.bounds, second.bounds),
    suppressedSourcePaintMask: combinePaintMasks(
      first.suppressedSourcePaintMask,
      second.suppressedSourcePaintMask
    )
  };
}

function isCapturedShadingPaint(
  rasterPlan: RasterOperatorPlan,
  index: number,
  includeEarlyStrokeUnderlay: boolean
): boolean {
  return (
    rasterPlan.shadingOnlyMask[index] === 1 ||
    (includeEarlyStrokeUnderlay && rasterPlan.earlyStrokeUnderlayMask[index] === 1)
  );
}

function buildDensePaintOrdinalByOp(
  operatorList: { fnArray: number[]; argsArray?: unknown[] }
): Int32Array {
  const ordinals = new Int32Array(operatorList.fnArray.length);
  ordinals.fill(-1);
  let paintOrdinal = 0;
  for (let i = 0; i < operatorList.fnArray.length; i += 1) {
    const args = operatorList.argsArray?.[i];
    if (!isNativeDensePaintOperator(operatorList.fnArray[i], args)) {
      continue;
    }
    ordinals[i] = paintOrdinal;
    paintOrdinal += 1;
  }
  return ordinals;
}

interface DensePaintSpan {
  first: number;
  last: number;
}

function resolveDensePaintSpan(
  operatorList: { fnArray: number[]; argsArray?: unknown[] },
  include: (index: number) => boolean
): DensePaintSpan | null {
  const ordinals = buildDensePaintOrdinalByOp(operatorList);
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < ordinals.length; i += 1) {
    const ordinal = ordinals[i];
    if (ordinal < 0 || !include(i)) {
      continue;
    }
    first = Math.min(first, ordinal);
    last = Math.max(last, ordinal);
  }
  return Number.isFinite(first) && Number.isFinite(last) ? { first, last } : null;
}

function nativePaintOrdinalIsInsideSpan(paintOrdinal: number, span: DensePaintSpan): boolean {
  return paintOrdinal > span.first && paintOrdinal < span.last;
}

function densePaintSelectionFallsInsideSpan(
  operatorList: { fnArray: number[]; argsArray?: unknown[] },
  span: DensePaintSpan,
  include: (index: number) => boolean
): boolean {
  const ordinals = buildDensePaintOrdinalByOp(operatorList);
  for (let i = 0; i < ordinals.length; i += 1) {
    if (include(i) && nativePaintOrdinalIsInsideSpan(ordinals[i], span)) {
      return true;
    }
  }
  return false;
}

function resolveAggregateShadingPaintSpan(
  operatorList: { fnArray: number[]; argsArray?: unknown[] },
  rasterPlan: RasterOperatorPlan,
  includeEarlyStrokeUnderlay: boolean
): DensePaintSpan | null {
  return resolveDensePaintSpan(
    operatorList,
    (index) => isCapturedShadingPaint(rasterPlan, index, includeEarlyStrokeUnderlay)
  );
}

function resolveAggregateImagePaintSpan(
  operatorList: { fnArray: number[]; argsArray?: unknown[] },
  rasterPlan: RasterOperatorPlan
): DensePaintSpan | null {
  return resolveDensePaintSpan(
    operatorList,
    (index) =>
      isNativeDenseImagePaintOperator(operatorList.fnArray[index]) &&
      rasterPlan.softMaskPaintMask[index] === 0
  );
}

function combineDensePaintSpans(
  first: DensePaintSpan | null,
  second: DensePaintSpan | null
): DensePaintSpan | null {
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }
  return { first: Math.min(first.first, second.first), last: Math.max(first.last, second.last) };
}

function resolveAggregateShadingPaintOrder(
  operatorList: { fnArray: number[]; argsArray?: unknown[] },
  rasterPlan: RasterOperatorPlan,
  includeEarlyStrokeUnderlay: boolean
): number | null {
  const span = resolveAggregateShadingPaintSpan(operatorList, rasterPlan, includeEarlyStrokeUnderlay);
  if (!span) {
    return null;
  }

  // All selected shadings currently share one texture. It has one exact raster
  // painter position only when no separately captured image lies inside its span.
  if (densePaintSelectionFallsInsideSpan(
    operatorList,
    span,
    (index) =>
      isNativeDenseImagePaintOperator(operatorList.fnArray[index]) &&
      rasterPlan.softMaskPaintMask[index] === 0
  )) {
    return null;
  }
  return span.last;
}

function resolveAggregateImagePaintOrder(
  operatorList: { fnArray: number[]; argsArray?: unknown[] },
  rasterPlan: RasterOperatorPlan,
  includeEarlyStrokeUnderlay: boolean
): number | null {
  const span = resolveAggregateImagePaintSpan(operatorList, rasterPlan);
  if (!span) {
    return null;
  }

  if (densePaintSelectionFallsInsideSpan(
    operatorList,
    span,
    (index) => isCapturedShadingPaint(rasterPlan, index, includeEarlyStrokeUnderlay)
  )) {
    return null;
  }
  return span.last;
}

function setRasterLayerPaintOrder(result: RasterLayerExtractResult, paintOrder: number | null): void {
  if (paintOrder === null || !Number.isFinite(paintOrder)) {
    return;
  }
  for (const layer of result.layers) {
    layer.paintOrder = paintOrder;
  }
}

function combinePaintMasks(first?: Uint8Array, second?: Uint8Array): Uint8Array | undefined {
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }

  const combined = new Uint8Array(Math.max(first.length, second.length));
  combined.set(first);
  for (let i = 0; i < second.length; i += 1) {
    if (second[i] !== 0) {
      combined[i] = 1;
    }
  }
  return combined;
}

function applyCapturedRasterSuppression(
  result: RasterLayerExtractResult,
  rasterPlan: RasterOperatorPlan,
  sourceRasterPlan: RasterOperatorPlan,
  includeEarlyStrokeUnderlay: boolean
): void {
  if (
    rasterPlan.softMaskCompositeCount > 0 &&
    rasterPlan.softMaskCompositeCount === sourceRasterPlan.softMaskCompositeCount
  ) {
    result.suppressedSourcePaintMask = sourceRasterPlan.softMaskPaintMask;
  }
  if (includeEarlyStrokeUnderlay) {
    result.suppressedSourcePaintMask = combinePaintMasks(
      result.suppressedSourcePaintMask,
      sourceRasterPlan.earlyStrokeUnderlayMask
    );
  }
}

interface RasterPageLike {
  rotate: number;
  view: number[];
  getViewport: (params: {
    scale: number;
    rotation?: number;
    offsetX?: number;
    offsetY?: number;
    dontFlip?: boolean;
  }) => { transform: unknown; width: number; height: number };
  render: (params: {
    canvasContext: CanvasRenderingContext2D;
    viewport: unknown;
    intent?: string;
    background?: string;
    operationsFilter?: (index: number) => boolean;
  }) => { promise: Promise<unknown> };
  _intentStates?: {
    get: (key: string) => { operatorList?: PdfOperatorListLike } | undefined;
  };
  _transport?: {
    getRenderingIntent?: (intent: string) => { cacheKey?: string };
  };
}

function getCachedDisplayOperatorList(pageLike: RasterPageLike): PdfOperatorListLike | null {
  const intentStates = pageLike._intentStates;
  const getRenderingIntent = pageLike._transport?.getRenderingIntent;
  if (!intentStates || typeof intentStates.get !== "function" || typeof getRenderingIntent !== "function") {
    return null;
  }

  let cacheKey: string | undefined;
  try {
    cacheKey = getRenderingIntent.call(pageLike._transport, "display").cacheKey;
  } catch {
    return null;
  }
  if (!cacheKey) {
    return null;
  }

  const operatorList = intentStates.get(cacheKey)?.operatorList;
  if (
    !operatorList?.lastChunk ||
    !Array.isArray(operatorList.fnArray) ||
    !Array.isArray(operatorList.argsArray) ||
    operatorList.fnArray.length !== operatorList.argsArray.length
  ) {
    return null;
  }
  return operatorList;
}

async function prepareDisplayOperatorList(pageLike: RasterPageLike): Promise<PdfOperatorListLike | null> {
  const cached = getCachedDisplayOperatorList(pageLike);
  if (cached) {
    return cached;
  }

  // PDF.js deliberately returns an unoptimized list from getOperatorList(), but
  // render() streams an optimized list whose operator indices can differ. Prime that
  // display list with a no-op render so operationsFilter is built against the exact
  // list it will receive, rather than applying unoptimized indices to optimized ops.
  const pageWidth = Math.max(1, Math.abs(pageLike.view[2] - pageLike.view[0]));
  const pageHeight = Math.max(1, Math.abs(pageLike.view[3] - pageLike.view[1]));
  const probeScale = 1 / Math.max(pageWidth, pageHeight);
  const viewport = pageLike.getViewport({
    scale: probeScale,
    rotation: normalizeRotationDegrees(pageLike.rotate),
    dontFlip: false
  });
  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));
  const surface = await createRasterRenderSurface(width, height);
  if (!surface) {
    return null;
  }

  try {
    await pageLike.render({
      canvasContext: surface.context as unknown as CanvasRenderingContext2D,
      viewport,
      intent: "display",
      background: "rgba(0,0,0,0)",
      operationsFilter: () => false
    }).promise;
  } catch {
    return null;
  } finally {
    surface.dispose();
  }

  return getCachedDisplayOperatorList(pageLike);
}

async function extractRasterLayerData(
  page: unknown,
  operatorList: { fnArray: number[]; argsArray: unknown[] },
  pageMatrix: Mat2D,
  options: RasterLayerExtractOptions
): Promise<RasterLayerExtractResult> {
  const sourceRasterPlan = buildRasterOperatorPlan(
    operatorList,
    options.nativeSourcePlan?.rasterExcludedPaintMask
  );
  if (
    !sourceRasterPlan.hasImagePaintOps &&
    !sourceRasterPlan.hasShadingFillOps &&
    !sourceRasterPlan.hasSoftMaskPaintOps &&
    !sourceRasterPlan.hasEarlyStrokeUnderlayOps &&
    !sourceRasterPlan.hasOrderedPatternPaintOps &&
    !sourceRasterPlan.hasBackdropDependentBlendOps &&
    !(options.allowFullPageFallback && sourceRasterPlan.hasFormXObjectOps)
  ) {
    return createEmptyRasterLayerResult();
  }

  const pageLike = page as RasterPageLike;
  if (
    !Array.isArray(pageLike.view) ||
    typeof pageLike.getViewport !== "function" ||
    typeof pageLike.render !== "function"
  ) {
    return createEmptyRasterLayerResult();
  }

  const displayOperatorList = options.preparedDisplayOperatorList !== undefined
    ? options.preparedDisplayOperatorList
    : await prepareDisplayOperatorList(pageLike);
  const filterOperatorList = displayOperatorList ?? operatorList;
  const rasterPlan = buildRasterOperatorPlan(
    filterOperatorList,
    displayOperatorList ? options.nativeDisplayPlan?.rasterExcludedPaintMask : options.nativeSourcePlan?.rasterExcludedPaintMask
  );
  const earlyStrokeUnderlayMatches =
    rasterPlan.earlyStrokeUnderlayCount > 0 &&
    rasterPlan.earlyStrokeUnderlayCount === sourceRasterPlan.earlyStrokeUnderlayCount &&
    rasterPlan.earlyStrokeUnderlaySignature === sourceRasterPlan.earlyStrokeUnderlaySignature;
  let orderedPatternPaintMatches =
    rasterPlan.orderedPatternPaintCount > 0 &&
    rasterPlan.orderedPatternPaintCount === sourceRasterPlan.orderedPatternPaintCount &&
    rasterPlan.orderedPatternPaintSignature === sourceRasterPlan.orderedPatternPaintSignature &&
    rasterPlan.graphicsPaintsBeforeText &&
    sourceRasterPlan.graphicsPaintsBeforeText;
  if (
    displayOperatorList &&
    !earlyStrokeUnderlayMatches &&
    (rasterPlan.earlyStrokeUnderlayCount > 0 || sourceRasterPlan.earlyStrokeUnderlayCount > 0)
  ) {
    const displayPatternPlan = buildOrderedPatternPaintPlan(filterOperatorList);
    const sourcePatternPlan = buildOrderedPatternPaintPlan(operatorList);
    orderedPatternPaintMatches =
      displayPatternPlan.count > 0 &&
      displayPatternPlan.count === sourcePatternPlan.count &&
      displayPatternPlan.signature === sourcePatternPlan.signature &&
      rasterPlan.graphicsPaintsBeforeText &&
      sourceRasterPlan.graphicsPaintsBeforeText;
  }
  const backdropBlendMatches =
    rasterPlan.backdropBlendCount > 0 &&
    rasterPlan.backdropBlendCount === sourceRasterPlan.backdropBlendCount;
  const shadingPaintOrder = resolveAggregateShadingPaintOrder(
    filterOperatorList,
    rasterPlan,
    earlyStrokeUnderlayMatches
  );

  const rotation = normalizeRotationDegrees(pageLike.rotate);
  const baseViewport = pageLike.getViewport({ scale: 1, rotation, dontFlip: false });
  const baseWidth = Math.max(1, Math.ceil(baseViewport.width));
  const baseHeight = Math.max(1, Math.ceil(baseViewport.height));
  const completeImageScan = scanRasterImageOps(filterOperatorList);
  const scan = scanRasterImageOps(filterOperatorList, rasterPlan.softMaskPaintMask);
  const perImagePlans =
    scan.plans && scan.plans.length > 0 && scan.plans.length <= RASTER_MAX_IMAGE_LAYERS
      ? scan.plans
      : null;
  const aggregateImagePaintOrder = rasterPlan.hasImagePaintOps
    ? resolveAggregateImagePaintOrder(
      filterOperatorList,
      rasterPlan,
      earlyStrokeUnderlayMatches
    )
    : null;
  const shadingPaintSpan = resolveAggregateShadingPaintSpan(
    filterOperatorList,
    rasterPlan,
    earlyStrokeUnderlayMatches
  );
  const imagePaintSpan = resolveAggregateImagePaintSpan(filterOperatorList, rasterPlan);
  const orderedRasterPaintSpan = combineDensePaintSpans(shadingPaintSpan, imagePaintSpan);
  const nativePaintFallsInside = (span: DensePaintSpan | null): boolean =>
    Boolean(
      span &&
      options.nativeDisplayPlan?.paints.some((paint) =>
        nativePaintOrdinalIsInsideSpan(paint.paintOrdinal, span)
      )
    );
  const buildViewport = (rasterScale: number): { transform: unknown; width: number; height: number } =>
    rasterScale === 1 ? baseViewport : pageLike.getViewport({ scale: rasterScale, rotation, dontFlip: false });

  if (
    options.allowFullPageFallback &&
    (sourceRasterPlan.hasFormXObjectOps || rasterPlan.hasFormXObjectOps)
  ) {
    const fallbackScale = chooseRasterExtractionScale(
      baseWidth,
      baseHeight,
      Math.max(RASTER_FALLBACK_TARGET_SCALE, scan.nativeScaleHint ?? 1)
    );
    const viewport = buildViewport(fallbackScale);
    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      const fallbackRgba = await renderRasterLayerRgba(pageLike, viewport, width, height);
      if (fallbackRgba && hasVisibleAlphaPixels(fallbackRgba)) {
        const fallbackResult = finalizeSingleRasterLayerResult(width, height, fallbackRgba, viewport, pageMatrix);
        const fullPaintSpan = resolveDensePaintSpan(filterOperatorList, () => true);
        setRasterLayerPaintOrder(fallbackResult, fullPaintSpan?.last ?? null);
        return fallbackResult;
      }
    }
    // If the larger full-page allocation/render fails, retain the selective
    // lower-resolution paths below instead of dropping content altogether.
  }

  if (
    displayOperatorList &&
    (backdropBlendMatches || orderedPatternPaintMatches)
  ) {
    const graphicsScale = chooseRasterExtractionScale(
      baseWidth,
      baseHeight,
      backdropBlendMatches
        ? Math.max(RASTER_SHADING_TARGET_SCALE, completeImageScan.nativeScaleHint ?? 1)
        : RASTER_SHADING_TARGET_SCALE
    );
    const viewport = buildViewport(graphicsScale);
    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      const graphicsOnlyMask = rasterPlan.graphicsOnlyMask;
      const filter = (index: number): boolean =>
        index >= 0 && index < graphicsOnlyMask.length && graphicsOnlyMask[index] === 1;
      const graphicsRgba = await renderRasterLayerRgba(pageLike, viewport, width, height, filter);
      if (graphicsRgba && hasVisibleAlphaPixels(graphicsRgba)) {
        const graphicsResult = finalizeCroppedRasterLayerResult(width, height, graphicsRgba, viewport, pageMatrix);
        const graphicsPaintSpan = resolveDensePaintSpan(
          filterOperatorList,
          (index) => graphicsOnlyMask[index] === 1
        );
        setRasterLayerPaintOrder(graphicsResult, graphicsPaintSpan?.last ?? null);
        graphicsResult.suppressedSourcePaintMask = sourceRasterPlan.vectorPaintMask;
        return graphicsResult;
      }
    }
    // Retain the selective shading/image path when the ordered graphics render
    // cannot be allocated or rendered.
  }

  const hasCapturedShadingPaints =
    rasterPlan.hasShadingFillOps || rasterPlan.hasSoftMaskPaintOps || earlyStrokeUnderlayMatches;
  let orderedRasterCompositeAttempted = false;
  const renderOrderedRasterComposite = async (): Promise<RasterLayerExtractResult | null> => {
    orderedRasterCompositeAttempted = true;
    // One aggregate shading texture cannot be inserted on both sides of an
    // intervening image. Replay just the raster-backed paints together so PDF.js
    // preserves their source order and mutual compositing in one layer.
    const orderedRasterScale = chooseRasterExtractionScale(
      baseWidth,
      baseHeight,
      Math.max(RASTER_SHADING_TARGET_SCALE, completeImageScan.nativeScaleHint ?? 1)
    );
    const viewport = buildViewport(orderedRasterScale);
    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      const imageOnlyMask = rasterPlan.imageOnlyMask;
      const shadingOnlyMask = rasterPlan.shadingOnlyMask;
      const earlyStrokeUnderlayMask = rasterPlan.earlyStrokeUnderlayMask;
      const filter = (index: number): boolean =>
        index >= 0 &&
        index < shadingOnlyMask.length &&
        (imageOnlyMask[index] === 1 ||
          shadingOnlyMask[index] === 1 ||
          (earlyStrokeUnderlayMatches && earlyStrokeUnderlayMask[index] === 1));
      const orderedRasterRgba = await renderRasterLayerRgba(
        pageLike,
        viewport,
        width,
        height,
        filter
      );
      if (orderedRasterRgba && hasVisibleAlphaPixels(orderedRasterRgba)) {
        const orderedRasterResult = finalizeCroppedRasterLayerResult(
          width,
          height,
          orderedRasterRgba,
          viewport,
          pageMatrix
        );
        setRasterLayerPaintOrder(orderedRasterResult, orderedRasterPaintSpan?.last ?? null);
        applyCapturedRasterSuppression(
          orderedRasterResult,
          rasterPlan,
          sourceRasterPlan,
          earlyStrokeUnderlayMatches
        );
        return orderedRasterResult.layers.length > 0 ? orderedRasterResult : null;
      }
    }
    return null;
  };

  if (
    displayOperatorList &&
    rasterPlan.hasImagePaintOps &&
    hasCapturedShadingPaints &&
    (shadingPaintOrder === null || (perImagePlans === null && aggregateImagePaintOrder === null))
  ) {
    if (nativePaintFallsInside(orderedRasterPaintSpan)) {
      return createNativeOrderingFailureRasterResult();
    }
    const orderedRasterResult = await renderOrderedRasterComposite();
    if (orderedRasterResult) {
      return orderedRasterResult;
    }
    if (options.nativeDisplayPlan?.paints.length) {
      return createNativeOrderingFailureRasterResult();
    }
    // If the ordered composite cannot be rendered, keep the selective legacy
    // fallback below rather than dropping raster content.
  }

  let rgba: Uint8Array | null = null;
  let shadingResult = createEmptyRasterLayerResult();
  if (
    displayOperatorList &&
    (rasterPlan.hasShadingFillOps || rasterPlan.hasSoftMaskPaintOps || earlyStrokeUnderlayMatches)
  ) {
    const shadingScale = chooseRasterExtractionScale(baseWidth, baseHeight, RASTER_SHADING_TARGET_SCALE);
    const viewport = buildViewport(shadingScale);
    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      const shadingOnlyMask = rasterPlan.shadingOnlyMask;
      const earlyStrokeUnderlayMask = rasterPlan.earlyStrokeUnderlayMask;
      const filter = (index: number): boolean =>
        index >= 0 &&
        index < shadingOnlyMask.length &&
        (shadingOnlyMask[index] === 1 ||
          (earlyStrokeUnderlayMatches && earlyStrokeUnderlayMask[index] === 1));
      rgba = await renderRasterLayerRgba(pageLike, viewport, width, height, filter);
      if (rgba && hasVisibleAlphaPixels(rgba)) {
        shadingResult = finalizeCroppedRasterLayerResult(width, height, rgba, viewport, pageMatrix);
        setRasterLayerPaintOrder(shadingResult, shadingPaintOrder);
      }

      if (shadingResult.layers.length > 0) {
        applyCapturedRasterSuppression(
          shadingResult,
          rasterPlan,
          sourceRasterPlan,
          earlyStrokeUnderlayMatches
        );
      }
    }
  }

  // Preferred path: one cropped layer per image op, each at its own native resolution.
  if (
    displayOperatorList &&
    rasterPlan.hasImagePaintOps &&
    perImagePlans
  ) {
    const perImage = await renderPerImageRasterLayers(
      pageLike,
      perImagePlans,
      rasterPlan.imageStateMask,
      pageMatrix,
      rotation,
      baseViewport
    );
    if (perImage) {
      return combineRasterLayerResults(shadingResult, perImage);
    }
    if (nativePaintFallsInside(imagePaintSpan)) {
      return createNativeOrderingFailureRasterResult();
    }
    if (
      hasCapturedShadingPaints &&
      aggregateImagePaintOrder === null &&
      !orderedRasterCompositeAttempted
    ) {
      if (nativePaintFallsInside(orderedRasterPaintSpan)) {
        return createNativeOrderingFailureRasterResult();
      }
      const orderedRasterResult = await renderOrderedRasterComposite();
      if (orderedRasterResult) {
        return orderedRasterResult;
      }
      if (options.nativeDisplayPlan?.paints.length) {
        return createNativeOrderingFailureRasterResult();
      }
    }
  }

  if (displayOperatorList && rasterPlan.hasImagePaintOps) {
    if (nativePaintFallsInside(imagePaintSpan)) {
      return createNativeOrderingFailureRasterResult();
    }
    // Flattened-image fallback: per-image placement is unavailable (repeat/group
    // ops, unreadable sizes) or there are too many image ops for individual layers.
    const imageScale = chooseRasterExtractionScale(
      baseWidth,
      baseHeight,
      scan.nativeScaleHint ?? RASTER_FALLBACK_TARGET_SCALE
    );
    const viewport = buildViewport(imageScale);
    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      const imageOnlyMask = rasterPlan.imageOnlyMask;
      const filter = (index: number): boolean => index >= 0 && index < imageOnlyMask.length && imageOnlyMask[index] === 1;
      rgba = await renderRasterLayerRgba(pageLike, viewport, width, height, filter);
      if (rgba && hasVisibleAlphaPixels(rgba)) {
        const imageResult = finalizeCroppedRasterLayerResult(width, height, rgba, viewport, pageMatrix);
        setRasterLayerPaintOrder(imageResult, aggregateImagePaintOrder);
        return combineRasterLayerResults(shadingResult, imageResult);
      }
    }
  }

  if (displayOperatorList && shadingResult.layers.length > 0) {
    return shadingResult;
  }

  if (
    !displayOperatorList &&
    (sourceRasterPlan.hasImagePaintOps || sourceRasterPlan.hasShadingFillOps || sourceRasterPlan.hasSoftMaskPaintOps)
  ) {
    // If a future PDF.js version stops exposing its cached display list, avoid an
    // unsafe index filter. A full render may duplicate vector pixels, but it preserves
    // the document's raster content and cannot unbalance PDF.js graphics state.
    const imageScale = chooseRasterExtractionScale(
      baseWidth,
      baseHeight,
      scan.nativeScaleHint ?? RASTER_FALLBACK_TARGET_SCALE
    );
    const viewport = buildViewport(imageScale);
    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));
    rgba = await renderRasterLayerRgba(pageLike, viewport, width, height);
    if (rgba && hasVisibleAlphaPixels(rgba)) {
      const fallbackResult = finalizeSingleRasterLayerResult(width, height, rgba, viewport, pageMatrix);
      const fullPaintSpan = resolveDensePaintSpan(operatorList, () => true);
      setRasterLayerPaintOrder(fallbackResult, fullPaintSpan?.last ?? null);
      return fallbackResult;
    }
  }

  return createEmptyRasterLayerResult();
}

const UNIT_BOUNDS: Bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

async function renderPerImageRasterLayers(
  pageLike: RasterPageLike,
  plans: RasterImageOpPlan[],
  imageStateMask: Uint8Array,
  pageMatrix: Mat2D,
  rotation: number,
  baseViewport: { transform: unknown; width: number; height: number }
): Promise<RasterLayerExtractResult | null> {
  const baseTransform = readTransform(baseViewport.transform);
  if (!baseTransform) {
    return null;
  }
  const pageDeviceBounds: Bounds = {
    minX: 0,
    minY: 0,
    maxX: Math.max(1, baseViewport.width),
    maxY: Math.max(1, baseViewport.height)
  };

  const layers: ExtractedRasterLayer[] = [];
  let bounds: Bounds | null = null;

  for (const plan of plans) {
    // Visible placement at scale 1 decides the scale clamp; skip fully off-page images.
    const placedBase = transformBounds(UNIT_BOUNDS, multiplyMatrices(baseTransform, plan.ctm));
    const visibleBase = intersectBounds(placedBase, pageDeviceBounds);
    if (!visibleBase || visibleBase.maxX <= visibleBase.minX || visibleBase.maxY <= visibleBase.minY) {
      continue;
    }

    const scale = chooseRasterExtractionScale(
      Math.max(1, Math.ceil(visibleBase.maxX - visibleBase.minX)),
      Math.max(1, Math.ceil(visibleBase.maxY - visibleBase.minY)),
      plan.nativeScale ?? RASTER_FALLBACK_TARGET_SCALE
    );
    const scaledViewport = scale === 1 ? baseViewport : pageLike.getViewport({ scale, rotation, dontFlip: false });
    const scaledTransform = readTransform(scaledViewport.transform);
    if (!scaledTransform) {
      return null;
    }

    const placed = transformBounds(UNIT_BOUNDS, multiplyMatrices(scaledTransform, plan.ctm));
    const cropMinX = Math.max(0, Math.floor(placed.minX - RASTER_CROP_PADDING_PX));
    const cropMinY = Math.max(0, Math.floor(placed.minY - RASTER_CROP_PADDING_PX));
    const cropMaxX = Math.min(Math.ceil(scaledViewport.width), Math.ceil(placed.maxX + RASTER_CROP_PADDING_PX));
    const cropMaxY = Math.min(Math.ceil(scaledViewport.height), Math.ceil(placed.maxY + RASTER_CROP_PADDING_PX));
    const width = cropMaxX - cropMinX;
    const height = cropMaxY - cropMinY;
    if (width <= 0 || height <= 0) {
      continue;
    }

    // Shift the viewport so the crop starts at the canvas origin.
    const renderViewport = pageLike.getViewport({ scale, rotation, offsetX: -cropMinX, offsetY: -cropMinY, dontFlip: false });
    const opIndex = plan.opIndex;
    const filter = (index: number): boolean =>
      index === opIndex || (index >= 0 && index < imageStateMask.length && imageStateMask[index] === 1);
    const rgba = await renderRasterLayerRgba(pageLike, renderViewport, width, height, filter);
    if (!rgba) {
      return null;
    }
    if (!hasVisibleAlphaPixels(rgba)) {
      // Fully clipped away or transparent — nothing worth storing.
      continue;
    }

    const matrix = buildRasterLayerMatrix(width, height, cropMinX, cropMinY, scaledTransform, pageMatrix);
    layers.push({ width, height, data: rgba, matrix, paintOrder: plan.paintOrder, pageIndex: 0 });
    bounds = combineBounds(bounds, transformBounds(UNIT_BOUNDS, matrix));
  }

  if (layers.length === 0) {
    return null;
  }
  return { layers, bounds };
}

async function getNodeCanvasModule():
  Promise<{
    createCanvas: (width: number, height: number) => {
      width: number;
      height: number;
      getContext: (kind: "2d") => unknown;
    };
  } | null> {
  if (cachedNodeCanvasModule !== undefined) {
    return cachedNodeCanvasModule;
  }

  if (typeof window !== "undefined") {
    cachedNodeCanvasModule = null;
    return null;
  }

  try {
    const moduleName = "@napi-rs/canvas";
    const mod = await import(
      /* @vite-ignore */
      moduleName
    ) as { createCanvas?: unknown };
    if (typeof mod.createCanvas !== "function") {
      cachedNodeCanvasModule = null;
      return null;
    }
    cachedNodeCanvasModule = {
      createCanvas: mod.createCanvas as (width: number, height: number) => {
        width: number;
        height: number;
        getContext: (kind: "2d") => unknown;
      }
    };
    return cachedNodeCanvasModule;
  } catch {
    cachedNodeCanvasModule = null;
    return null;
  }
}

async function createRasterRenderSurface(width: number, height: number): Promise<RasterRenderSurface | null> {
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", {
      alpha: true,
      willReadFrequently: true
    });
    if (!context) {
      return null;
    }

    return {
      context,
      dispose: () => {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }

  const nodeCanvas = await getNodeCanvasModule();
  if (!nodeCanvas) {
    return null;
  }

  const canvas = nodeCanvas.createCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context || typeof (context as { getImageData?: unknown }).getImageData !== "function") {
    return null;
  }

  return {
    context: context as { getImageData: (x: number, y: number, renderWidth: number, renderHeight: number) => { data: Uint8Array | Uint8ClampedArray } },
    dispose: () => {
      canvas.width = 0;
      canvas.height = 0;
    }
  };
}

async function renderRasterLayerRgba(
  pageLike: Pick<RasterPageLike, "render">,
  viewport: unknown,
  width: number,
  height: number,
  operationsFilter?: (index: number) => boolean
): Promise<Uint8Array | null> {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  const surface = await createRasterRenderSurface(width, height);
  if (!surface) {
    return null;
  }
  const context = surface.context;

  try {
    const params: {
      canvasContext: CanvasRenderingContext2D;
      viewport: unknown;
      intent?: string;
      background?: string;
      operationsFilter?: (index: number) => boolean;
    } = {
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      intent: "display",
      // Keep a transparent background so we only capture rasterized PDF content.
      background: "rgba(0,0,0,0)"
    };
    if (operationsFilter) {
      params.operationsFilter = operationsFilter;
    }
    await pageLike.render(params).promise;
  } catch {
    surface.dispose();
    return null;
  }

  const imageData = context.getImageData(0, 0, width, height);
  const rgba = new Uint8Array(imageData.data instanceof Uint8ClampedArray ? imageData.data : new Uint8Array(imageData.data));
  surface.dispose();
  return rgba;
}

function hasVisibleAlphaPixels(rgba: Uint8Array): boolean {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Matrix mapping the layer's unit square to world space, where the layer canvas covers
 * the device-space rect [offsetX, offsetX + width] x [offsetY, offsetY + height] of the
 * given viewport transform.
 */
function buildRasterLayerMatrix(
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  viewportTransform: Mat2D,
  pageMatrix: Mat2D
): Mat2D {
  const inverseTransform = invertMatrix(viewportTransform) ?? [...IDENTITY_MATRIX];
  const unitToDevice: Mat2D = [width, 0, 0, height, offsetX, offsetY];
  return multiplyMatrices(pageMatrix, multiplyMatrices(inverseTransform, unitToDevice));
}

function finalizeSingleRasterLayerResult(
  width: number,
  height: number,
  rgba: Uint8Array,
  viewport: unknown,
  pageMatrix: Mat2D
): RasterLayerExtractResult {
  const transform = readTransform((viewport as { transform?: unknown }).transform) ?? [...IDENTITY_MATRIX];
  const matrix = buildRasterLayerMatrix(width, height, 0, 0, transform, pageMatrix);
  const bounds = transformBounds(UNIT_BOUNDS, matrix);

  return {
    layers: [{ width, height, data: rgba, matrix, paintOrder: 0, pageIndex: 0 }],
    bounds
  };
}

function finalizeCroppedRasterLayerResult(
  width: number,
  height: number,
  rgba: Uint8Array,
  viewport: unknown,
  pageMatrix: Mat2D
): RasterLayerExtractResult {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (rgba[rowOffset + x * 4 + 3] === 0) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return createEmptyRasterLayerResult();
  }

  const cropMinX = Math.max(0, minX - RASTER_CROP_PADDING_PX);
  const cropMinY = Math.max(0, minY - RASTER_CROP_PADDING_PX);
  const cropMaxX = Math.min(width, maxX + 1 + RASTER_CROP_PADDING_PX);
  const cropMaxY = Math.min(height, maxY + 1 + RASTER_CROP_PADDING_PX);
  const cropWidth = cropMaxX - cropMinX;
  const cropHeight = cropMaxY - cropMinY;
  const cropped = new Uint8Array(cropWidth * cropHeight * 4);
  const sourceStride = width * 4;
  const cropStride = cropWidth * 4;
  for (let y = 0; y < cropHeight; y += 1) {
    const sourceOffset = (cropMinY + y) * sourceStride + cropMinX * 4;
    cropped.set(rgba.subarray(sourceOffset, sourceOffset + cropStride), y * cropStride);
  }

  const transform = readTransform((viewport as { transform?: unknown }).transform) ?? [...IDENTITY_MATRIX];
  const matrix = buildRasterLayerMatrix(cropWidth, cropHeight, cropMinX, cropMinY, transform, pageMatrix);
  return {
    layers: [{ width: cropWidth, height: cropHeight, data: cropped, matrix, paintOrder: 0, pageIndex: 0 }],
    bounds: transformBounds(UNIT_BOUNDS, matrix)
  };
}

function createDefaultTextState(matrix: Mat2D): TextState {
  return {
    matrix: [...matrix],
    groupFillAlpha: 1,
    groupFillAlphaVersion: -1,
    fillAlphaVersion: 0,
    fillR: 0,
    fillG: 0,
    fillB: 0,
    fillAlpha: 1,
    textMatrix: [...IDENTITY_MATRIX],
    textX: 0,
    textY: 0,
    lineX: 0,
    lineY: 0,
    charSpacing: 0,
    wordSpacing: 0,
    textHScale: 1,
    leading: 0,
    textRise: 0,
    renderMode: TEXT_RENDER_MODE_FILL,
    fontRef: "",
    fontSize: 0,
    fontDirection: 1
  };
}

function cloneTextState(state: TextState): TextState {
  return {
    matrix: [...state.matrix],
    groupFillAlpha: state.groupFillAlpha,
    groupFillAlphaVersion: state.groupFillAlphaVersion,
    fillAlphaVersion: state.fillAlphaVersion,
    fillR: state.fillR,
    fillG: state.fillG,
    fillB: state.fillB,
    fillAlpha: state.fillAlpha,
    textMatrix: [...state.textMatrix],
    textX: state.textX,
    textY: state.textY,
    lineX: state.lineX,
    lineY: state.lineY,
    charSpacing: state.charSpacing,
    wordSpacing: state.wordSpacing,
    textHScale: state.textHScale,
    leading: state.leading,
    textRise: state.textRise,
    renderMode: state.renderMode,
    fontRef: state.fontRef,
    fontSize: state.fontSize,
    fontDirection: state.fontDirection
  };
}

function beginText(state: TextState): void {
  state.textMatrix = [...IDENTITY_MATRIX];
  state.textX = 0;
  state.textY = 0;
  state.lineX = 0;
  state.lineY = 0;
}

function moveText(state: TextState, tx: number, ty: number): void {
  state.lineX += tx;
  state.lineY += ty;
  state.textX = state.lineX;
  state.textY = state.lineY;
}

function applyTextGraphicsStateEntries(rawEntries: unknown, state: TextState): void {
  if (!Array.isArray(rawEntries)) {
    return;
  }

  for (const pair of rawEntries) {
    if (!Array.isArray(pair) || pair.length < 2) {
      continue;
    }

    const key = pair[0];
    const value = pair[1];

    if (key === "ca") {
      const alpha = Number(value);
      if (Number.isFinite(alpha)) {
        state.fillAlpha = clamp01(alpha);
        state.fillAlphaVersion += 1;
      }
      continue;
    }

    if (key === "Font" && Array.isArray(value)) {
      const fontRef = value[0];
      const rawSize = Number(value[1]);

      if (typeof fontRef === "string") {
        state.fontRef = fontRef;
      }

      if (Number.isFinite(rawSize)) {
        if (rawSize < 0) {
          state.fontSize = -rawSize;
          state.fontDirection = -1;
        } else {
          state.fontSize = rawSize;
          state.fontDirection = 1;
        }
      }
    }
  }
}

function shouldRenderFilledText(renderMode: number): boolean {
  return (
    renderMode === TEXT_RENDER_MODE_FILL ||
    renderMode === TEXT_RENDER_MODE_FILL_STROKE ||
    renderMode === TEXT_RENDER_MODE_FILL_ADD_PATH ||
    renderMode === TEXT_RENDER_MODE_FILL_STROKE_ADD_PATH
  );
}

function isWhitespaceGlyphToken(glyph: GlyphTokenLike, fontChar: string): boolean {
  if (!fontChar) {
    return true;
  }

  if (glyph.isSpace === true) {
    return true;
  }

  const unicode = typeof glyph.unicode === "string" ? glyph.unicode : "";
  if (unicode.length > 0 && unicode.trim().length === 0) {
    return true;
  }

  return false;
}

function readTextEntries(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function resolveFont(commonObjs: CommonObjsLike, fontRef: string): FontLike | null {
  if (!fontRef) {
    return null;
  }

  try {
    const raw = commonObjs.get(fontRef);
    if (!raw || typeof raw !== "object") {
      return null;
    }
    return raw as FontLike;
  } catch {
    return null;
  }
}

function effectiveTextFillAlpha(state: TextState): number {
  if (state.fillAlphaVersion === state.groupFillAlphaVersion) {
    return clamp01(state.groupFillAlpha);
  }
  return clamp01(state.groupFillAlpha * state.fillAlpha);
}

function resolveFontMatrixScale(font: FontLike | null): number {
  const matrix = font?.fontMatrix;
  if (Array.isArray(matrix) && matrix.length >= 1) {
    const value = Number(matrix[0]);
    if (Number.isFinite(value) && value !== 0) {
      return value;
    }
  }
  return FONT_MATRIX_FALLBACK;
}

function getGlyphPathData(commonObjs: CommonObjsLike, loadedFontName: string, fontChar: string): Float32Array | null {
  const objId = `${loadedFontName}_path_${fontChar}`;
  let pathInfo: unknown;

  try {
    pathInfo = commonObjs.get(objId);
  } catch {
    return null;
  }

  const rawPath = (pathInfo as FontPathInfoLike | null)?.path;
  return toFloat32Path(rawPath);
}

function toFloat32Path(raw: unknown): Float32Array | null {
  if (!raw) {
    return null;
  }

  if (raw instanceof Float32Array) {
    return raw;
  }

  if (ArrayBuffer.isView(raw)) {
    const view = raw as unknown as ArrayLike<number>;
    const out = new Float32Array(view.length);
    for (let i = 0; i < view.length; i += 1) {
      const value = Number(view[i]);
      out[i] = Number.isFinite(value) ? value : 0;
    }
    return out;
  }

  if (Array.isArray(raw)) {
    const out = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
      const value = Number(raw[i]);
      out[i] = Number.isFinite(value) ? value : 0;
    }
    return out;
  }

  return null;
}

function emitTextGlyphSegmentsFromPath(
  pathData: Float32Array,
  outSegmentsA: Float4Builder,
  outSegmentsB: Float4Builder
): TextGlyphBuildResult {
  let segmentCount = 0;

  let cursorX = 0;
  let cursorY = 0;
  let startX = 0;
  let startY = 0;
  let hasStart = false;

  const bounds: Bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };

  const emitLine = (x0: number, y0: number, x1: number, y1: number): void => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (dx * dx + dy * dy < 1e-12) {
      return;
    }

    outSegmentsA.push(x0, y0, x1, y1);
    outSegmentsB.push(x1, y1, TEXT_PRIMITIVE_LINE, 0);
    segmentCount += 1;

    bounds.minX = Math.min(bounds.minX, x0, x1);
    bounds.minY = Math.min(bounds.minY, y0, y1);
    bounds.maxX = Math.max(bounds.maxX, x0, x1);
    bounds.maxY = Math.max(bounds.maxY, y0, y1);
  };

  const emitQuadratic = (x0: number, y0: number, cx: number, cy: number, x1: number, y1: number): void => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const cdx = cx - x0;
    const cdy = cy - y0;
    if (dx * dx + dy * dy < 1e-12 && cdx * cdx + cdy * cdy < 1e-12) {
      return;
    }

    outSegmentsA.push(x0, y0, cx, cy);
    outSegmentsB.push(x1, y1, TEXT_PRIMITIVE_QUADRATIC, 0);
    segmentCount += 1;

    bounds.minX = Math.min(bounds.minX, x0, cx, x1);
    bounds.minY = Math.min(bounds.minY, y0, cy, y1);
    bounds.maxX = Math.max(bounds.maxX, x0, cx, x1);
    bounds.maxY = Math.max(bounds.maxY, y0, cy, y1);
  };

  for (let i = 0; i < pathData.length; ) {
    const op = pathData[i++];

    if (op === DRAW_MOVE_TO) {
      cursorX = pathData[i++];
      cursorY = pathData[i++];
      startX = cursorX;
      startY = cursorY;
      hasStart = true;
      continue;
    }

    if (op === DRAW_LINE_TO) {
      const x = pathData[i++];
      const y = pathData[i++];
      emitLine(cursorX, cursorY, x, y);
      cursorX = x;
      cursorY = y;
      continue;
    }

    if (op === DRAW_CURVE_TO) {
      const x1 = pathData[i++];
      const y1 = pathData[i++];
      const x2 = pathData[i++];
      const y2 = pathData[i++];
      const x3 = pathData[i++];
      const y3 = pathData[i++];

      emitCubicAsQuadratics(
        cursorX,
        cursorY,
        x1,
        y1,
        x2,
        y2,
        x3,
        y3,
        emitQuadratic,
        TEXT_CUBIC_TO_QUAD_ERROR,
        MAX_TEXT_CUBIC_TO_QUAD_DEPTH
      );

      cursorX = x3;
      cursorY = y3;
      continue;
    }

    if (op === DRAW_QUAD_TO) {
      const cx = pathData[i++];
      const cy = pathData[i++];
      const x = pathData[i++];
      const y = pathData[i++];

      emitQuadratic(cursorX, cursorY, cx, cy, x, y);

      cursorX = x;
      cursorY = y;
      continue;
    }

    if (op === DRAW_CLOSE) {
      if (hasStart && (cursorX !== startX || cursorY !== startY)) {
        emitLine(cursorX, cursorY, startX, startY);
      }
      cursorX = startX;
      cursorY = startY;
      continue;
    }

    break;
  }

  if (segmentCount === 0) {
    return {
      segmentCount: 0,
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }
    };
  }

  return { segmentCount, bounds };
}

function emitCubicAsQuadratics(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  emitQuadratic: (sx: number, sy: number, cx: number, cy: number, ex: number, ey: number) => void,
  maxError: number,
  maxDepth: number
): void {
  const stack: number[] = [x0, y0, x1, y1, x2, y2, x3, y3, 0];
  const maxErrorSq = maxError * maxError;

  while (stack.length > 0) {
    const depth = stack.pop() as number;
    const q3y = stack.pop() as number;
    const q3x = stack.pop() as number;
    const q2y = stack.pop() as number;
    const q2x = stack.pop() as number;
    const q1y = stack.pop() as number;
    const q1x = stack.pop() as number;
    const q0y = stack.pop() as number;
    const q0x = stack.pop() as number;

    const [controlX, controlY] = approximateCubicAsQuadraticControl(q0x, q0y, q1x, q1y, q2x, q2y, q3x, q3y);
    const errorSq = cubicQuadraticApproxErrorSq(q0x, q0y, q1x, q1y, q2x, q2y, q3x, q3y, controlX, controlY);
    if (depth >= maxDepth || errorSq <= maxErrorSq) {
      emitQuadratic(q0x, q0y, controlX, controlY, q3x, q3y);
      continue;
    }

    const x01 = (q0x + q1x) * 0.5;
    const y01 = (q0y + q1y) * 0.5;
    const x12 = (q1x + q2x) * 0.5;
    const y12 = (q1y + q2y) * 0.5;
    const x23 = (q2x + q3x) * 0.5;
    const y23 = (q2y + q3y) * 0.5;

    const x012 = (x01 + x12) * 0.5;
    const y012 = (y01 + y12) * 0.5;
    const x123 = (x12 + x23) * 0.5;
    const y123 = (y12 + y23) * 0.5;

    const x0123 = (x012 + x123) * 0.5;
    const y0123 = (y012 + y123) * 0.5;

    const nextDepth = depth + 1;
    stack.push(x0123, y0123, x123, y123, x23, y23, q3x, q3y, nextDepth);
    stack.push(q0x, q0y, x01, y01, x012, y012, x0123, y0123, nextDepth);
  }
}

function approximateCubicAsQuadraticControl(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number
): [number, number] {
  return [
    (3 * (x1 + x2) - x0 - x3) * 0.25,
    (3 * (y1 + y2) - y0 - y3) * 0.25
  ];
}

function cubicQuadraticApproxErrorSq(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  cx: number,
  cy: number
): number {
  const tValues = [0.25, 0.5, 0.75];
  let maxSq = 0;

  for (const t of tValues) {
    const cubic = evaluateCubicPoint(x0, y0, x1, y1, x2, y2, x3, y3, t);
    const quad = evaluateQuadraticPoint(x0, y0, cx, cy, x3, y3, t);
    const dx = cubic[0] - quad[0];
    const dy = cubic[1] - quad[1];
    const distSq = dx * dx + dy * dy;
    if (distSq > maxSq) {
      maxSq = distSq;
    }
  }

  return maxSq;
}

function evaluateCubicPoint(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  t: number
): [number, number] {
  const oneMinusT = 1 - t;
  const oneMinusTSq = oneMinusT * oneMinusT;
  const oneMinusTCube = oneMinusTSq * oneMinusT;
  const tSq = t * t;
  const tCube = tSq * t;

  const x =
    oneMinusTCube * x0 +
    3 * oneMinusTSq * t * x1 +
    3 * oneMinusT * tSq * x2 +
    tCube * x3;
  const y =
    oneMinusTCube * y0 +
    3 * oneMinusTSq * t * y1 +
    3 * oneMinusT * tSq * y2 +
    tCube * y3;

  return [x, y];
}

function evaluateQuadraticPoint(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  t: number
): [number, number] {
  const oneMinusT = 1 - t;
  const oneMinusTSq = oneMinusT * oneMinusT;
  const tSq = t * t;

  const x = oneMinusTSq * x0 + 2 * oneMinusT * t * cx + tSq * x1;
  const y = oneMinusTSq * y0 + 2 * oneMinusT * t * cy + tSq * y1;
  return [x, y];
}

function buildTextGlyphTransform(state: TextState, glyphX: number, glyphY: number): Mat2D {
  let matrix = state.matrix;
  matrix = multiplyMatrices(matrix, state.textMatrix);
  matrix = multiplyMatrices(matrix, [1, 0, 0, 1, state.textX, state.textY + state.textRise]);
  matrix = multiplyMatrices(matrix, [state.textHScale * state.fontDirection, 0, 0, state.fontDirection > 0 ? -1 : 1, 0, 0]);
  matrix = multiplyMatrices(matrix, [1, 0, 0, 1, glyphX, glyphY]);
  matrix = multiplyMatrices(matrix, [state.fontSize, 0, 0, -state.fontSize, 0, 0]);
  return matrix;
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

function boundsIntersect(a: Bounds, b: Bounds): boolean {
  if (!isNonEmptyBounds(a) || !isNonEmptyBounds(b)) {
    return false;
  }
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

function flattenCubic(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  emitLine: (ax: number, ay: number, bx: number, by: number) => void,
  flatness: number,
  maxDepth: number
): void {
  const stack: number[] = [x0, y0, x1, y1, x2, y2, x3, y3, 0];
  const flatnessSq = flatness * flatness;

  while (stack.length > 0) {
    const depth = stack.pop() as number;
    const q3y = stack.pop() as number;
    const q3x = stack.pop() as number;
    const q2y = stack.pop() as number;
    const q2x = stack.pop() as number;
    const q1y = stack.pop() as number;
    const q1x = stack.pop() as number;
    const q0y = stack.pop() as number;
    const q0x = stack.pop() as number;

    if (depth >= maxDepth || cubicFlatnessSq(q0x, q0y, q1x, q1y, q2x, q2y, q3x, q3y) <= flatnessSq) {
      emitLine(q0x, q0y, q3x, q3y);
      continue;
    }

    const x01 = (q0x + q1x) * 0.5;
    const y01 = (q0y + q1y) * 0.5;
    const x12 = (q1x + q2x) * 0.5;
    const y12 = (q1y + q2y) * 0.5;
    const x23 = (q2x + q3x) * 0.5;
    const y23 = (q2y + q3y) * 0.5;

    const x012 = (x01 + x12) * 0.5;
    const y012 = (y01 + y12) * 0.5;
    const x123 = (x12 + x23) * 0.5;
    const y123 = (y12 + y23) * 0.5;

    const x0123 = (x012 + x123) * 0.5;
    const y0123 = (y012 + y123) * 0.5;

    const nextDepth = depth + 1;

    stack.push(x0123, y0123, x123, y123, x23, y23, q3x, q3y, nextDepth);
    stack.push(q0x, q0y, x01, y01, x012, y012, x0123, y0123, nextDepth);
  }
}

function cubicFlatnessSq(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number
): number {
  const ux = x3 - x0;
  const uy = y3 - y0;
  const lenSq = ux * ux + uy * uy;
  if (lenSq < 1e-12) {
    return 0;
  }

  const d1 = crossDistanceSq(x1 - x0, y1 - y0, ux, uy, lenSq);
  const d2 = crossDistanceSq(x2 - x0, y2 - y0, ux, uy, lenSq);
  return Math.max(d1, d2);
}

function crossDistanceSq(px: number, py: number, ux: number, uy: number, lenSq: number): number {
  const cross = px * uy - py * ux;
  return (cross * cross) / lenSq;
}

function quantize(value: number, scale: number): number {
  return Math.round(value * scale);
}

function multiplyMatrices(a: Mat2D, b: Mat2D): Mat2D {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5]
  ];
}

function invertMatrix(m: Mat2D): Mat2D | null {
  const a = m[0];
  const b = m[1];
  const c = m[2];
  const d = m[3];
  const e = m[4];
  const f = m[5];

  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) <= 1e-12) {
    return null;
  }

  const invDet = 1 / det;
  return [
    d * invDet,
    -b * invDet,
    -c * invDet,
    a * invDet,
    (c * f - d * e) * invDet,
    (b * e - a * f) * invDet
  ];
}

function matrixScale(m: Mat2D): number {
  const sx = Math.hypot(m[0], m[1]);
  const sy = Math.hypot(m[2], m[3]);
  const scale = (sx + sy) * 0.5;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
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

function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
