const pdfJsModule = (
  typeof window === "undefined"
    ? await import("pdfjs-dist/legacy/build/pdf.mjs")
    : await import("pdfjs-dist")
) as {
  getDocument: typeof import("pdfjs-dist").getDocument;
  OPS: typeof import("pdfjs-dist").OPS;
};

const { getDocument, OPS } = pdfJsModule;

const DRAW_MOVE_TO = 0;
const DRAW_LINE_TO = 1;
const DRAW_CURVE_TO = 2;
const DRAW_QUAD_TO = 3;
const DRAW_CLOSE = 4;

type Mat2D = [number, number, number, number, number, number];
type RgbColor = [number, number, number];

interface GraphicsState {
  matrix: Mat2D;
  lineWidth: number;
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

export interface RasterLayer {
  width: number;
  height: number;
  data: Uint8Array<ArrayBufferLike>;
  matrix: Float32Array;
}

export interface VectorScene {
  pageCount: number;
  pagesPerRow: number;
  pageRects: Float32Array;
  fillPathCount: number;
  fillSegmentCount: number;
  fillPathMetaA: Float32Array;
  fillPathMetaB: Float32Array;
  fillPathMetaC: Float32Array;
  fillSegmentsA: Float32Array;
  fillSegmentsB: Float32Array;
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
}

export interface VectorExtractOptions {
  enableSegmentMerge?: boolean;
  enableInvisibleCull?: boolean;
  maxPages?: number;
  maxPagesPerRow?: number;
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

  push(a: number, b: number, c: number, d: number): void {
    this.ensureCapacity(4);
    const offset = this.length;
    this.data[offset] = a;
    this.data[offset + 1] = b;
    this.data[offset + 2] = c;
    this.data[offset + 3] = d;
    this.length += 4;
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
const FONT_MATRIX_FALLBACK = 0.001;
const TEXT_MIN_ALPHA = 1e-3;
const FILL_MIN_ALPHA = 1e-3;
const RASTER_TARGET_SCALE_PER_DPR = 3;
const RASTER_MAX_SCALE = 24;
const RASTER_MAX_DIMENSION = 16384;
const RASTER_MAX_PIXELS = 134_217_728;

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
const STROKE_STYLE_FLAG_OFFSET = 2;
const PAGE_GRID_GAP_FACTOR = 0.08;
const PAGE_GRID_MIN_GAP = 24;

function encodeStrokeStyleMeta(alpha: number, styleFlags: number): number {
  const normalizedAlpha = clamp01(alpha);
  const normalizedFlags = styleFlags >= 0.5 ? STROKE_STYLE_FLAG_OFFSET : 0;
  return normalizedAlpha + normalizedFlags;
}

function decodeStrokeStyleMeta(encoded: number): { alpha: number; styleFlags: number } {
  const hasFlags = encoded >= STROKE_STYLE_FLAG_OFFSET - 1e-6;
  const alpha = clamp01(hasFlags ? encoded - STROKE_STYLE_FLAG_OFFSET : encoded);
  return { alpha, styleFlags: hasFlags ? 1 : 0 };
}

export async function extractFirstPageVectors(pdfData: ArrayBuffer, options: VectorExtractOptions = {}): Promise<VectorScene> {
  return extractPdfVectors(pdfData, {
    ...options,
    maxPages: 1,
    maxPagesPerRow: 1
  });
}

export async function extractPdfPageScenes(pdfData: ArrayBuffer, options: VectorExtractOptions = {}): Promise<VectorScene[]> {
  const enableSegmentMerge = options.enableSegmentMerge !== false;
  const enableInvisibleCull = options.enableInvisibleCull !== false;
  const maxPages = normalizePositiveInt(options.maxPages, Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER);
  const standardFontDataUrl = resolveStandardFontDataUrl();

  const loadingTask = getDocument({
    data: new Uint8Array(pdfData),
    disableFontFace: true,
    fontExtraProperties: true,
    ...(standardFontDataUrl ? { standardFontDataUrl } : {})
  });
  const pdf = await loadingTask.promise;

  try {
    const pdfPageCount = normalizePositiveInt((pdf as { numPages?: unknown }).numPages, 1, 1, Number.MAX_SAFE_INTEGER);
    const extractedPageCount = Math.max(1, Math.min(pdfPageCount, maxPages));
    const pageScenes: VectorScene[] = [];

    for (let pageNumber = 1; pageNumber <= extractedPageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const operatorList = await page.getOperatorList();
      const pageScene = await extractSinglePageVectors(page, operatorList, {
        enableSegmentMerge,
        enableInvisibleCull
      });
      pageScenes.push(pageScene);
    }

    return pageScenes;
  } finally {
    await pdf.destroy();
  }
}

export function composeVectorScenesInGrid(pageScenes: VectorScene[], requestedPagesPerRow: number): VectorScene {
  return composeScenesInGrid(pageScenes, requestedPagesPerRow);
}

export async function extractPdfVectors(pdfData: ArrayBuffer, options: VectorExtractOptions = {}): Promise<VectorScene> {
  const maxPagesPerRow = normalizePositiveInt(options.maxPagesPerRow, 10, 1, 100);
  const pageScenes = await extractPdfPageScenes(pdfData, options);
  return composeScenesInGrid(pageScenes, maxPagesPerRow);
}

export async function extractPdfRasterPageScenes(
  pdfData: ArrayBuffer,
  options: VectorExtractOptions = {}
): Promise<VectorScene[]> {
  const maxPages = normalizePositiveInt(options.maxPages, Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER);
  const standardFontDataUrl = resolveStandardFontDataUrl();
  const loadingTask = getDocument({
    data: new Uint8Array(pdfData),
    disableFontFace: true,
    fontExtraProperties: true,
    ...(standardFontDataUrl ? { standardFontDataUrl } : {})
  });
  const pdf = await loadingTask.promise;

  try {
    const pdfPageCount = normalizePositiveInt((pdf as { numPages?: unknown }).numPages, 1, 1, Number.MAX_SAFE_INTEGER);
    const extractedPageCount = Math.max(1, Math.min(pdfPageCount, maxPages));
    const pageScenes: VectorScene[] = [];

    for (let pageNumber = 1; pageNumber <= extractedPageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const operatorList = await page.getOperatorList();
      pageScenes.push(await extractSinglePageRasterOnly(page, operatorList));
    }

    return pageScenes;
  } finally {
    await pdf.destroy();
  }
}

export async function extractPdfRasterScene(pdfData: ArrayBuffer, options: VectorExtractOptions = {}): Promise<VectorScene> {
  const maxPagesPerRow = normalizePositiveInt(options.maxPagesPerRow, 10, 1, 100);
  const pageScenes = await extractPdfRasterPageScenes(pdfData, options);
  return composeScenesInGrid(pageScenes, maxPagesPerRow);
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
  const rasterLayer = await extractRasterLayerData(page, operatorList, pageMatrix, {
    allowFullPageFallback: true
  });
  const rasterLayers: RasterLayer[] =
    rasterLayer.width > 0 && rasterLayer.height > 0 && rasterLayer.data.length >= rasterLayer.width * rasterLayer.height * 4
      ? [
        {
          width: rasterLayer.width,
          height: rasterLayer.height,
          data: rasterLayer.data,
          matrix: new Float32Array(rasterLayer.matrix)
        }
      ]
      : [];

  const base = createEmptyVectorScene();
  const primaryRasterLayer = rasterLayers[0] ?? null;
  const combinedBounds = combineBounds(pageBounds, rasterLayer.bounds) ?? pageBounds;

  return {
    ...base,
    pageCount: 1,
    pagesPerRow: 1,
    pageRects: new Float32Array([pageBounds.minX, pageBounds.minY, pageBounds.maxX, pageBounds.maxY]),
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

  const endpointBuilder = new Float4Builder();
  const primitiveMetaBuilder = new Float4Builder();
  const primitiveBoundsBuilder = new Float4Builder();
  const styleBuilder = new Float4Builder();
  const fillPathMetaABuilder = new Float4Builder(8_192);
  const fillPathMetaBBuilder = new Float4Builder(8_192);
  const fillPathMetaCBuilder = new Float4Builder(8_192);
  const fillSegmentBuilderA = new Float4Builder(65_536);
  const fillSegmentBuilderB = new Float4Builder(65_536);

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

  let pathCount = 0;
  let sourceSegmentCount = 0;
  let maxHalfWidth = 0;
  let fillPathCount = 0;

  const stateStack: GraphicsState[] = [];
  const formStateStack: GraphicsState[] = [];
  let currentState: GraphicsState = createDefaultState(pageMatrix);

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
      continue;
    }

    if (fn === OPS.paintFormXObjectEnd) {
      const restored = formStateStack.pop();
      if (restored) {
        currentState = restored;
      }
      continue;
    }

    if (fn === OPS.setLineWidth) {
      const nextWidth = readNumber(args, 0, currentState.lineWidth);
      currentState.lineWidth = Math.max(0, nextWidth);
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

    if (fn !== OPS.constructPath) {
      continue;
    }

    const paintOp = readNumber(args, 0, -1);
    const strokePaint = isStrokePaintOp(paintOp);
    const fillPaint = isFillPaintOp(paintOp);
    if (!strokePaint && !fillPaint) {
      continue;
    }

    const pathData = readPathData(args);
    if (!pathData) {
      continue;
    }

    pathCount += 1;

    if (strokePaint) {
      const isHairlineStroke = currentState.lineWidth <= 0;
      const widthScale = matrixScale(currentState.matrix);
      const strokeWidth = isHairlineStroke ? 0 : currentState.lineWidth * widthScale;
      const halfWidth = Math.max(0, strokeWidth * 0.5);
      maxHalfWidth = Math.max(maxHalfWidth, halfWidth);

      const styleR = clamp01(currentState.strokeR);
      const styleG = clamp01(currentState.strokeG);
      const styleB = clamp01(currentState.strokeB);
      const styleAlpha = clamp01(currentState.strokeAlpha);
      sourceSegmentCount += emitSegmentsFromPath(
        pathData,
        currentState.matrix,
        halfWidth,
        styleR,
        styleG,
        styleB,
        styleAlpha,
        isHairlineStroke ? 1 : 0,
        options.enableSegmentMerge,
        endpointBuilder,
        primitiveMetaBuilder,
        styleBuilder,
        primitiveBoundsBuilder,
        bounds
      );
    }

    if (fillPaint) {
      const fillRule = isEvenOddFillPaintOp(paintOp) ? FILL_RULE_EVEN_ODD : FILL_RULE_NONZERO;
      const fillAlpha = clamp01(currentState.fillAlpha);
      const hasCompanionStroke = strokePaint && clamp01(currentState.strokeAlpha) > ALPHA_INVISIBLE_EPSILON;
      if (fillAlpha > FILL_MIN_ALPHA) {
        const emitted = emitFilledPathFromPath(
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
          fillBounds
        );
        if (emitted) {
          fillPathCount += 1;
        }
      }
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

  let textData = await extractTextVectorData(page, operatorList, pageMatrix, pageBounds);
  if (textData.instanceCount === 0 && hasTextShowOperators(operatorList)) {
    await warmUpTextPathCache(page);
    textData = await extractTextVectorData(page, operatorList, pageMatrix, pageBounds);
  }

  if (textData.instanceCount > 0 && textData.inPageCount < textData.instanceCount * 0.2) {
    const fallbackTextData = await extractTextVectorData(page, operatorList, IDENTITY_MATRIX, pageBounds);
    if (fallbackTextData.inPageCount > textData.inPageCount) {
      textData = fallbackTextData;
    }
  }

  const allowFullPageRasterFallback = segmentCount === 0 && fillPathCount === 0 && textData.instanceCount === 0;
  const rasterLayer = await extractRasterLayerData(page, operatorList, pageMatrix, {
    allowFullPageFallback: allowFullPageRasterFallback
  });
  const rasterLayers: RasterLayer[] =
    rasterLayer.width > 0 && rasterLayer.height > 0 && rasterLayer.data.length >= rasterLayer.width * rasterLayer.height * 4
      ? [
        {
          width: rasterLayer.width,
          height: rasterLayer.height,
          data: rasterLayer.data,
          matrix: new Float32Array(rasterLayer.matrix)
        }
      ]
      : [];
  const combinedBounds =
    combineBounds(combineBounds(combineBounds(segmentBounds, resolvedFillBounds), textData.bounds), rasterLayer.bounds) ??
    { ...pageBounds };

  return {
    pageCount: 1,
    pagesPerRow: 1,
    pageRects: new Float32Array([pageBounds.minX, pageBounds.minY, pageBounds.maxX, pageBounds.maxY]),
    fillPathCount,
    fillSegmentCount,
    fillPathMetaA,
    fillPathMetaB,
    fillPathMetaC,
    fillSegmentsA,
    fillSegmentsB,
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
    maxHalfWidth: resolvedMaxHalfWidth,
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
      pagesPerRow: 1
    };
  }

  const pagesPerRow = normalizePositiveInt(requestedPagesPerRow, 10, 1, 100);
  const placements = computeGridPlacements(pageScenes, pagesPerRow);

  let totalFillPathCount = 0;
  let totalFillSegmentCount = 0;
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

  for (const scene of pageScenes) {
    totalFillPathCount += scene.fillPathCount;
    totalFillSegmentCount += scene.fillSegmentCount;
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

  let fillPathOffset = 0;
  let fillSegmentOffset = 0;
  let segmentOffset = 0;
  let textInstanceOffset = 0;
  let textGlyphOffset = 0;
  let textGlyphSegmentOffset = 0;
  let pageRectOffset = 0;
  let combinedBounds: Bounds | null = null;
  let combinedPageBounds: Bounds | null = null;

  const rasterLayers: RasterLayer[] = [];

  for (let pageIndex = 0; pageIndex < pageScenes.length; pageIndex += 1) {
    const scene = pageScenes[pageIndex];
    const placement = placements[pageIndex];
    const tx = placement.translateX;
    const ty = placement.translateY;

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
      for (let i = 0; i < sceneRectCount; i += 1) {
        const src = i * 4;
        const dst = (pageRectOffset + i) * 4;
        pageRects[dst] = scenePageRects[src] + tx;
        pageRects[dst + 1] = scenePageRects[src + 1] + ty;
        pageRects[dst + 2] = scenePageRects[src + 2] + tx;
        pageRects[dst + 3] = scenePageRects[src + 3] + ty;
      }
      pageRectOffset += sceneRectCount;
    } else {
      const dst = pageRectOffset * 4;
      pageRects[dst] = scene.pageBounds.minX + tx;
      pageRects[dst + 1] = scene.pageBounds.minY + ty;
      pageRects[dst + 2] = scene.pageBounds.maxX + tx;
      pageRects[dst + 3] = scene.pageBounds.maxY + ty;
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
        matrix
      });
    }

    fillPathOffset += scene.fillPathCount;
    fillSegmentOffset += scene.fillSegmentCount;
    segmentOffset += scene.segmentCount;
    textInstanceOffset += scene.textInstanceCount;
    textGlyphOffset += scene.textGlyphCount;
    textGlyphSegmentOffset += scene.textGlyphSegmentCount;
  }

  const primaryRasterLayer = rasterLayers[0] ?? null;

  return {
    pageCount: pageScenes.length,
    pagesPerRow,
    pageRects,
    fillPathCount: totalFillPathCount,
    fillSegmentCount: totalFillSegmentCount,
    fillPathMetaA,
    fillPathMetaB,
    fillPathMetaC,
    fillSegmentsA,
    fillSegmentsB,
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
        matrix
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
    matrix
  });
  return out;
}

function createEmptyVectorScene(): VectorScene {
  return {
    pageCount: 0,
    pagesPerRow: 1,
    pageRects: new Float32Array(0),
    fillPathCount: 0,
    fillSegmentCount: 0,
    fillPathMetaA: new Float32Array(0),
    fillPathMetaB: new Float32Array(0),
    fillPathMetaC: new Float32Array(0),
    fillSegmentsA: new Float32Array(0),
    fillSegmentsB: new Float32Array(0),
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

function createDefaultState(initialMatrix: Mat2D = IDENTITY_MATRIX): GraphicsState {
  return {
    matrix: [...initialMatrix],
    lineWidth: 1,
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

function chooseRasterExtractionScale(baseWidth: number, baseHeight: number, nativeScaleHint = 1): number {
  if (!Number.isFinite(baseWidth) || !Number.isFinite(baseHeight) || baseWidth <= 0 || baseHeight <= 0) {
    return 1;
  }

  const dpr = typeof window === "undefined" ? 1 : Math.max(1, Number(window.devicePixelRatio) || 1);
  const targetScale = Math.max(dpr * RASTER_TARGET_SCALE_PER_DPR, Number.isFinite(nativeScaleHint) ? nativeScaleHint : 1);
  let scale = Math.max(1, Math.min(RASTER_MAX_SCALE, targetScale));

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
    lineWidth: state.lineWidth,
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
}

interface RasterLayerExtractResult {
  width: number;
  height: number;
  data: Uint8Array;
  matrix: Mat2D;
  bounds: Bounds | null;
}

interface RasterLayerExtractOptions {
  allowFullPageFallback: boolean;
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
      }
      continue;
    }

    if (key === "ca") {
      const alpha = Number(value);
      if (Number.isFinite(alpha)) {
        state.fillAlpha = clamp01(alpha);
      }
      continue;
    }

    if (key === "LW") {
      const lineWidth = Number(value);
      if (Number.isFinite(lineWidth)) {
        state.lineWidth = Math.max(0, lineWidth);
      }
    }
  }
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
  allowSegmentMerge: boolean,
  endpoints: Float4Builder,
  primitiveMeta: Float4Builder,
  styles: Float4Builder,
  primitiveBounds: Float4Builder,
  bounds: Bounds
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

  const emitPrimitive = (
    p0x: number,
    p0y: number,
    p1x: number,
    p1y: number,
    p2x: number,
    p2y: number,
    primitiveType: number
  ): void => {
    endpoints.push(p0x, p0y, p1x, p1y);
    primitiveMeta.push(p2x, p2y, primitiveType, encodeStrokeStyleMeta(alpha, styleFlags));
    styles.push(halfWidth, colorR, colorG, colorB);

    const minX = Math.min(p0x, p1x, p2x);
    const minY = Math.min(p0y, p1y, p2y);
    const maxX = Math.max(p0x, p1x, p2x);
    const maxY = Math.max(p0y, p1y, p2y);
    primitiveBounds.push(minX, minY, maxX, maxY);

    bounds.minX = Math.min(bounds.minX, minX);
    bounds.minY = Math.min(bounds.minY, minY);
    bounds.maxX = Math.max(bounds.maxX, maxX);
    bounds.maxY = Math.max(bounds.maxY, maxY);
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
    if (dx * dx + dy * dy < 1e-10) {
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

  for (let i = 0; i < pathData.length; ) {
    const op = pathData[i++];

    if (op === DRAW_MOVE_TO) {
      flushPending();
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
      emitLine(tx0, ty0, tx1, ty1, true);
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
      if (hasStart && (cursorX !== startX || cursorY !== startY)) {
        const [tx0, ty0] = applyMatrix(matrix, cursorX, cursorY);
        const [tx1, ty1] = applyMatrix(matrix, startX, startY);
        emitLine(tx0, ty0, tx1, ty1, true);
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
  bounds: Bounds
): boolean {
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
    return false;
  }

  metaA.push(segmentStart, primitiveCount, localBounds.minX, localBounds.minY);
  metaB.push(localBounds.maxX, localBounds.maxY, colorR, colorG);
  metaC.push(fillRule, hasCompanionStroke ? 1 : 0, colorB, alpha);

  bounds.minX = Math.min(bounds.minX, localBounds.minX);
  bounds.minY = Math.min(bounds.minY, localBounds.minY);
  bounds.maxX = Math.max(bounds.maxX, localBounds.maxX);
  bounds.maxY = Math.max(bounds.maxY, localBounds.maxY);

  return true;
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
      discardedDegenerateCount += 1;
      continue;
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

    if (!isQuadratic) {
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
  pageBounds?: Bounds
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

  let sourceTextCount = 0;
  let textBounds: Bounds | null = null;
  let inPageCount = 0;
  let outOfPageCount = 0;

  const stateStack: TextState[] = [];
  const formStateStack: TextState[] = [];
  const clipBoundsStack: Array<Bounds | null> = [];
  const formClipBoundsStack: Array<Bounds | null> = [];
  let state = createDefaultTextState(pageMatrix);
  let clipBounds: Bounds | null = null;
  let pendingClipPathBounds: Bounds | null = null;

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

  const emitTextEntries = (entries: unknown[]): void => {
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

      if (!vertical && !skipGlyphRender && shouldRenderFilledText(state.renderMode) && state.fillAlpha > TEXT_MIN_ALPHA) {
        const glyphRecord = getOrCreateGlyph(font, state.fontRef, fontChar);
        if (glyphRecord) {
          const glyphMatrix = buildTextGlyphTransform(state, x, 0);
          const transformedGlyphBounds = transformBounds(glyphRecord.bounds, glyphMatrix);
          const visibleByClip = !clipBounds || boundsIntersect(transformedGlyphBounds, clipBounds);
          if (visibleByClip) {
            textInstanceA.push(glyphMatrix[0], glyphMatrix[1], glyphMatrix[2], glyphMatrix[3]);
            textInstanceB.push(glyphMatrix[4], glyphMatrix[5], glyphRecord.index, 0);
            textInstanceC.push(state.fillR, state.fillG, state.fillB, state.fillAlpha);
            sourceTextCount += 1;

            if (pageBounds) {
              if (boundsIntersect(transformedGlyphBounds, pageBounds)) {
                inPageCount += 1;
              } else {
                outOfPageCount += 1;
              }
            }

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

      const charWidth = vertical
        ? glyphWidth * widthAdvanceScale - spacing * state.fontDirection
        : glyphWidth * widthAdvanceScale + spacing * state.fontDirection;
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
      continue;
    }

    if (fn === OPS.paintFormXObjectEnd) {
      const restoredState = formStateStack.pop();
      if (restoredState) {
        state = restoredState;
      }
      clipBounds = formClipBoundsStack.pop() ?? clipBounds;
      pendingClipPathBounds = null;
      continue;
    }

    if (fn === OPS.constructPath) {
      const paintOp = readNumber(args, 0, -1);
      if (paintOp === OPS.endPath) {
        const pathData = readPathData(args);
        pendingClipPathBounds = pathData ? computeTransformedPathBounds(pathData, state.matrix) : null;
      } else {
        pendingClipPathBounds = null;
      }
      continue;
    }

    if (fn === OPS.clip || fn === OPS.eoClip) {
      if (pendingClipPathBounds) {
        clipBounds = intersectBounds(clipBounds, pendingClipPathBounds);
      }
      continue;
    }

    if (fn === OPS.endPath) {
      pendingClipPathBounds = null;
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
      emitTextEntries(readTextEntries(readArg(args, 0)));
      pendingClipPathBounds = null;
      continue;
    }

    if (fn === OPS.nextLineShowText) {
      moveText(state, 0, state.leading);
      emitTextEntries(readTextEntries(readArg(args, 0)));
      pendingClipPathBounds = null;
      continue;
    }

    if (fn === OPS.nextLineSetSpacingShowText) {
      state.wordSpacing = readNumber(args, 0, state.wordSpacing);
      state.charSpacing = readNumber(args, 1, state.charSpacing);
      moveText(state, 0, state.leading);
      emitTextEntries(readTextEntries(readArg(args, 2)));
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
    bounds: textBounds
  };
}

function cloneBoundsOrNull(bounds: Bounds | null): Bounds | null {
  if (!bounds) {
    return null;
  }
  return { ...bounds };
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
    return null;
  }
  return { minX, minY, maxX, maxY };
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
    bounds: null
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

interface RasterOperatorPlan {
  hasImagePaintOps: boolean;
  hasFormXObjectOps: boolean;
  imageOnlyMask: Uint8Array;
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

function isImageRasterStateOperator(fn: number, args: unknown): boolean {
  if (
    fn === OPS.dependency ||
    fn === OPS.save ||
    fn === OPS.restore ||
    fn === OPS.transform ||
    fn === OPS.setGState ||
    fn === OPS.beginGroup ||
    fn === OPS.endGroup ||
    fn === OPS.beginCompat ||
    fn === OPS.endCompat ||
    fn === OPS.beginMarkedContent ||
    fn === OPS.beginMarkedContentProps ||
    fn === OPS.endMarkedContent ||
    fn === OPS.paintFormXObjectBegin ||
    fn === OPS.paintFormXObjectEnd ||
    fn === OPS.paintXObject ||
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

function buildRasterOperatorPlan(operatorList: { fnArray: number[]; argsArray: unknown[] }): RasterOperatorPlan {
  const imageOnlyMask = new Uint8Array(operatorList.fnArray.length);
  let hasImagePaintOps = false;
  let hasFormXObjectOps = false;

  for (let i = 0; i < operatorList.fnArray.length; i += 1) {
    const fn = operatorList.fnArray[i];
    const args = operatorList.argsArray[i];

    if (isImagePaintOperator(fn)) {
      hasImagePaintOps = true;
      imageOnlyMask[i] = 1;
      continue;
    }

    if (fn === OPS.paintFormXObjectBegin || fn === OPS.paintFormXObjectEnd || fn === OPS.paintXObject) {
      hasFormXObjectOps = true;
    }

    if (isImageRasterStateOperator(fn, args)) {
      imageOnlyMask[i] = 1;
    }
  }

  return {
    hasImagePaintOps,
    hasFormXObjectOps,
    imageOnlyMask
  };
}

function estimateRasterNativeScaleHint(operatorList: { fnArray: number[]; argsArray: unknown[] }): number {
  const matrixStack: Mat2D[] = [];
  let currentMatrix: Mat2D = [...IDENTITY_MATRIX];
  let maxScaleHint = 1;

  for (let i = 0; i < operatorList.fnArray.length; i += 1) {
    const fn = operatorList.fnArray[i];
    const args = operatorList.argsArray[i];

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

    if (!isImagePaintOperator(fn)) {
      continue;
    }

    const size = readImageOpIntrinsicSize(fn, args);
    if (!size) {
      continue;
    }

    const sx = Math.hypot(currentMatrix[0], currentMatrix[1]);
    const sy = Math.hypot(currentMatrix[2], currentMatrix[3]);
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 1e-5 || sy <= 1e-5) {
      continue;
    }

    const scaleX = size.width / sx;
    const scaleY = size.height / sy;
    if (Number.isFinite(scaleX) && scaleX > maxScaleHint) {
      maxScaleHint = scaleX;
    }
    if (Number.isFinite(scaleY) && scaleY > maxScaleHint) {
      maxScaleHint = scaleY;
    }
  }

  if (!Number.isFinite(maxScaleHint)) {
    return 1;
  }
  return Math.max(1, maxScaleHint);
}

function readImageOpIntrinsicSize(fn: number, args: unknown): { width: number; height: number } | null {
  if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
    const width = readNumber(args, 1, Number.NaN);
    const height = readNumber(args, 2, Number.NaN);
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }

  if (fn === OPS.paintInlineImageXObject) {
    const imageObject = readArg(args, 0);
    const width = Number((imageObject as { width?: unknown })?.width);
    const height = Number((imageObject as { height?: unknown })?.height);
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }

  if (fn === OPS.paintImageMaskXObject || fn === OPS.paintImageMaskXObjectRepeat) {
    const width = readNumber(args, 1, Number.NaN);
    const height = readNumber(args, 2, Number.NaN);
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }

  return null;
}

function createEmptyRasterLayerResult(): RasterLayerExtractResult {
  return {
    width: 0,
    height: 0,
    data: new Uint8Array(0),
    matrix: [...IDENTITY_MATRIX],
    bounds: null
  };
}

async function extractRasterLayerData(
  page: unknown,
  operatorList: { fnArray: number[]; argsArray: unknown[] },
  pageMatrix: Mat2D,
  options: RasterLayerExtractOptions
): Promise<RasterLayerExtractResult> {
  const rasterPlan = buildRasterOperatorPlan(operatorList);
  if (!rasterPlan.hasImagePaintOps && !(options.allowFullPageFallback && rasterPlan.hasFormXObjectOps)) {
    return createEmptyRasterLayerResult();
  }

  const pageLike = page as {
    rotate: number;
    view: number[];
    getViewport: (params: { scale: number; rotation?: number; dontFlip?: boolean }) => { transform: unknown; width: number; height: number };
    render: (params: {
      canvasContext: CanvasRenderingContext2D;
      viewport: unknown;
      intent?: string;
      background?: string;
      operationsFilter?: (index: number) => boolean;
    }) => { promise: Promise<unknown> };
  };

  if (
    !Array.isArray(pageLike.view) ||
    typeof pageLike.getViewport !== "function" ||
    typeof pageLike.render !== "function"
  ) {
    return createEmptyRasterLayerResult();
  }

  const baseViewport = pageLike.getViewport({
    scale: 1,
    rotation: normalizeRotationDegrees(pageLike.rotate),
    dontFlip: false
  });
  const nativeScaleHint = estimateRasterNativeScaleHint(operatorList);
  const rasterScale = chooseRasterExtractionScale(
    Math.max(1, Math.ceil(baseViewport.width)),
    Math.max(1, Math.ceil(baseViewport.height)),
    nativeScaleHint
  );
  const viewport = rasterScale === 1
    ? baseViewport
    : pageLike.getViewport({
      scale: rasterScale,
      rotation: normalizeRotationDegrees(pageLike.rotate),
      dontFlip: false
    });

  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return createEmptyRasterLayerResult();
  }

  let rgba: Uint8Array | null = null;
  if (rasterPlan.hasImagePaintOps) {
    rgba = await renderRasterLayerRgba(pageLike, viewport, rasterPlan.imageOnlyMask);
    if (rgba && hasVisibleAlphaPixels(rgba)) {
      return finalizeRasterLayerResult(width, height, rgba, viewport, pageMatrix);
    }
  }

  if (!options.allowFullPageFallback || !rasterPlan.hasFormXObjectOps) {
    return createEmptyRasterLayerResult();
  }

  rgba = await renderRasterLayerRgba(pageLike, viewport);
  if (!rgba || !hasVisibleAlphaPixels(rgba)) {
    return createEmptyRasterLayerResult();
  }

  return finalizeRasterLayerResult(width, height, rgba, viewport, pageMatrix);
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
  pageLike: {
    render: (params: {
      canvasContext: CanvasRenderingContext2D;
      viewport: unknown;
      intent?: string;
      background?: string;
      operationsFilter?: (index: number) => boolean;
    }) => { promise: Promise<unknown> };
  },
  viewport: unknown,
  operationMask?: Uint8Array
): Promise<Uint8Array | null> {
  const viewportLike = viewport as { width?: unknown; height?: unknown };
  const width = Math.max(1, Math.ceil(Number(viewportLike.width) || 1));
  const height = Math.max(1, Math.ceil(Number(viewportLike.height) || 1));
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
    if (operationMask) {
      params.operationsFilter = (index: number): boolean => index >= 0 && index < operationMask.length && operationMask[index] === 1;
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

function finalizeRasterLayerResult(
  width: number,
  height: number,
  rgba: Uint8Array,
  viewport: unknown,
  pageMatrix: Mat2D
): RasterLayerExtractResult {
  const transform = readTransform((viewport as { transform?: unknown }).transform) ?? [...IDENTITY_MATRIX];
  const inverseTransform = invertMatrix(transform) ?? [...IDENTITY_MATRIX];
  const unitToCanvas: Mat2D = [width, 0, 0, height, 0, 0];
  const matrix = multiplyMatrices(pageMatrix, multiplyMatrices(inverseTransform, unitToCanvas));
  const bounds = transformBounds(
    {
      minX: 0,
      minY: 0,
      maxX: 1,
      maxY: 1
    },
    matrix
  );

  return {
    width,
    height,
    data: rgba,
    matrix,
    bounds
  };
}

function createDefaultTextState(matrix: Mat2D): TextState {
  return {
    matrix: [...matrix],
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
