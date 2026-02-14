import { getDocument, OPS } from "pdfjs-dist";

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

export interface VectorScene {
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
  endpoints: Float32Array;
  primitiveMeta: Float32Array;
  primitiveBounds: Float32Array;
  styles: Float32Array;
  bounds: Bounds;
  pageBounds: Bounds;
  maxHalfWidth: number;
  operatorCount: number;
  pathCount: number;
  discardedTransparentCount: number;
  discardedDegenerateCount: number;
  discardedDuplicateCount: number;
  discardedContainedCount: number;
}

export interface VectorExtractOptions {
  enableSegmentMerge?: boolean;
  enableInvisibleCull?: boolean;
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
const TEXT_CUBIC_TO_QUAD_ERROR = 0.05;
const MAX_TEXT_CUBIC_TO_QUAD_DEPTH = 10;
const TEXT_BOUNDS_EPSILON = 1e-4;
const FONT_MATRIX_FALLBACK = 0.001;
const TEXT_MIN_ALPHA = 1e-3;
const FILL_MIN_ALPHA = 1e-3;

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
  const enableSegmentMerge = options.enableSegmentMerge !== false;
  const enableInvisibleCull = options.enableInvisibleCull !== false;

  const loadingTask = getDocument({
    data: new Uint8Array(pdfData),
    disableFontFace: true,
    fontExtraProperties: true
  });
  const pdf = await loadingTask.promise;

  try {
    const page = await pdf.getPage(1);
    const operatorList = await page.getOperatorList();

    const endpointBuilder = new Float4Builder();
    const primitiveMetaBuilder = new Float4Builder();
    const primitiveBoundsBuilder = new Float4Builder();
    const styleBuilder = new Float4Builder();
    const fillPathMetaABuilder = new Float4Builder(8_192);
    const fillPathMetaBBuilder = new Float4Builder(8_192);
    const fillPathMetaCBuilder = new Float4Builder(8_192);
    const fillSegmentBuilderA = new Float4Builder(65_536);
    const fillSegmentBuilderB = new Float4Builder(65_536);

    const pageView = page.view;
    const rawPageBounds: Bounds = {
      minX: Math.min(pageView[0], pageView[2]),
      minY: Math.min(pageView[1], pageView[3]),
      maxX: Math.max(pageView[0], pageView[2]),
      maxY: Math.max(pageView[1], pageView[3])
    };
    const pageMatrix = buildPageMatrix(page);
    const pageBounds = transformBounds(rawPageBounds, pageMatrix);

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
          enableSegmentMerge,
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

    if (mergedSegmentCount > 0 && enableInvisibleCull) {
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
    const combinedBounds = combineBounds(combineBounds(segmentBounds, resolvedFillBounds), textData.bounds) ?? { ...pageBounds };

    return {
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
      endpoints,
      primitiveMeta,
      primitiveBounds,
      styles,
      bounds: combinedBounds,
      pageBounds,
      maxHalfWidth: resolvedMaxHalfWidth,
      operatorCount: operatorList.fnArray.length,
      pathCount,
      discardedTransparentCount,
      discardedDegenerateCount,
      discardedDuplicateCount,
      discardedContainedCount
    };
  } finally {
    await pdf.destroy();
  }
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
  let state = createDefaultTextState(pageMatrix);

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
            textInstanceA.push(glyphMatrix[0], glyphMatrix[1], glyphMatrix[2], glyphMatrix[3]);
            textInstanceB.push(glyphMatrix[4], glyphMatrix[5], glyphRecord.index, 0);
            textInstanceC.push(state.fillR, state.fillG, state.fillB, state.fillAlpha);
            sourceTextCount += 1;

          const transformedGlyphBounds = transformBounds(glyphRecord.bounds, glyphMatrix);
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
      continue;
    }

    if (fn === OPS.restore) {
      const restored = stateStack.pop();
      if (restored) {
        state = restored;
      }
      continue;
    }

    if (fn === OPS.transform) {
      const transform = readTransform(args);
      if (transform) {
        state.matrix = multiplyMatrices(state.matrix, transform);
      }
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
      continue;
    }

    if (fn === OPS.nextLineShowText) {
      moveText(state, 0, state.leading);
      emitTextEntries(readTextEntries(readArg(args, 0)));
      continue;
    }

    if (fn === OPS.nextLineSetSpacingShowText) {
      state.wordSpacing = readNumber(args, 0, state.wordSpacing);
      state.charSpacing = readNumber(args, 1, state.charSpacing);
      moveText(state, 0, state.leading);
      emitTextEntries(readTextEntries(readArg(args, 2)));
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
