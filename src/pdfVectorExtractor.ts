import { getDocument, OPS } from "pdfjs-dist";

const DRAW_MOVE_TO = 0;
const DRAW_LINE_TO = 1;
const DRAW_CURVE_TO = 2;
const DRAW_QUAD_TO = 3;
const DRAW_CLOSE = 4;

type Mat2D = [number, number, number, number, number, number];

interface GraphicsState {
  matrix: Mat2D;
  lineWidth: number;
  strokeLuma: number;
  strokeAlpha: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface VectorScene {
  segmentCount: number;
  sourceSegmentCount: number;
  mergedSegmentCount: number;
  endpoints: Float32Array;
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

export async function extractFirstPageVectors(pdfData: ArrayBuffer, options: VectorExtractOptions = {}): Promise<VectorScene> {
  const enableSegmentMerge = options.enableSegmentMerge !== false;
  const enableInvisibleCull = options.enableInvisibleCull !== false;

  const loadingTask = getDocument({ data: new Uint8Array(pdfData) });
  const pdf = await loadingTask.promise;

  try {
    const page = await pdf.getPage(1);
    const operatorList = await page.getOperatorList();

    const endpointBuilder = new Float4Builder();
    const styleBuilder = new Float4Builder();

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

    let pathCount = 0;
    let sourceSegmentCount = 0;
    let maxHalfWidth = 0;

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
        currentState.strokeLuma = parseLuma(readArg(args, 0), currentState.strokeLuma);
        continue;
      }

      if (fn === OPS.setStrokeGray) {
        const strokeGray = readArg(args, 0);
        currentState.strokeLuma = parseLuma(strokeGray, currentState.strokeLuma);
        continue;
      }

      if (fn === OPS.setStrokeCMYKColor) {
        currentState.strokeLuma = parseLuma(readArg(args, 0), currentState.strokeLuma);
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
      if (!isStrokePaintOp(paintOp)) {
        continue;
      }

      const pathData = readPathData(args);
      if (!pathData) {
        continue;
      }

      pathCount += 1;

      const widthScale = matrixScale(currentState.matrix);
      const strokeWidth = currentState.lineWidth > 0 ? currentState.lineWidth * widthScale : 0.7;
      const halfWidth = Math.max(0.2, strokeWidth * 0.5);
      maxHalfWidth = Math.max(maxHalfWidth, halfWidth);

      const styleLuma = clamp01(currentState.strokeLuma);
      const styleAlpha = clamp01(currentState.strokeAlpha);
      sourceSegmentCount += emitSegmentsFromPath(
        pathData,
        currentState.matrix,
        halfWidth,
        styleLuma,
        styleAlpha,
        enableSegmentMerge,
        endpointBuilder,
        styleBuilder,
        bounds
      );
    }

    const mergedSegmentCount = endpointBuilder.quadCount;

    if (mergedSegmentCount === 0) {
      return {
        segmentCount: 0,
        sourceSegmentCount,
        mergedSegmentCount,
        endpoints: new Float32Array(0),
        styles: new Float32Array(0),
        bounds: { ...pageBounds },
        pageBounds,
        maxHalfWidth: 0,
        operatorCount: operatorList.fnArray.length,
        pathCount,
        discardedTransparentCount: 0,
        discardedDegenerateCount: 0,
        discardedDuplicateCount: 0,
        discardedContainedCount: 0
      };
    }

    const mergedEndpoints = endpointBuilder.toTypedArray();
    const mergedStyles = styleBuilder.toTypedArray();

    if (!enableInvisibleCull) {
      return {
        segmentCount: mergedSegmentCount,
        sourceSegmentCount,
        mergedSegmentCount,
        endpoints: mergedEndpoints,
        styles: mergedStyles,
        bounds,
        pageBounds,
        maxHalfWidth,
        operatorCount: operatorList.fnArray.length,
        pathCount,
        discardedTransparentCount: 0,
        discardedDegenerateCount: 0,
        discardedDuplicateCount: 0,
        discardedContainedCount: 0
      };
    }

    const culled = cullInvisibleSegments(mergedEndpoints, mergedStyles);

    if (culled.segmentCount === 0) {
      return {
        segmentCount: 0,
        sourceSegmentCount,
        mergedSegmentCount,
        endpoints: new Float32Array(0),
        styles: new Float32Array(0),
        bounds: { ...pageBounds },
        pageBounds,
        maxHalfWidth: 0,
        operatorCount: operatorList.fnArray.length,
        pathCount,
        discardedTransparentCount: culled.discardedTransparentCount,
        discardedDegenerateCount: culled.discardedDegenerateCount,
        discardedDuplicateCount: culled.discardedDuplicateCount,
        discardedContainedCount: culled.discardedContainedCount
      };
    }

    return {
      segmentCount: culled.segmentCount,
      sourceSegmentCount,
      mergedSegmentCount,
      endpoints: culled.endpoints,
      styles: culled.styles,
      bounds: culled.bounds,
      pageBounds,
      maxHalfWidth: culled.maxHalfWidth,
      operatorCount: operatorList.fnArray.length,
      pathCount,
      discardedTransparentCount: culled.discardedTransparentCount,
      discardedDegenerateCount: culled.discardedDegenerateCount,
      discardedDuplicateCount: culled.discardedDuplicateCount,
      discardedContainedCount: culled.discardedContainedCount
    };
  } finally {
    await pdf.destroy();
  }
}

function createDefaultState(initialMatrix: Mat2D = IDENTITY_MATRIX): GraphicsState {
  return {
    matrix: [...initialMatrix],
    lineWidth: 1,
    strokeLuma: 0,
    strokeAlpha: 1
  };
}

function buildPageMatrix(page: {
  rotate: number;
  getViewport: (params: { scale: number; rotation?: number; dontFlip?: boolean }) => { transform: unknown };
}): Mat2D {
  const rotation = normalizeRotationDegrees(page.rotate);
  const viewport = page.getViewport({ scale: 1, rotation, dontFlip: true });
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

  return [a, b, c, d, e, f];
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
    strokeLuma: state.strokeLuma,
    strokeAlpha: state.strokeAlpha
  };
}

function readTransform(args: unknown): Mat2D | null {
  if (!Array.isArray(args) || args.length < 6) {
    return null;
  }
  const a = Number(args[0]);
  const b = Number(args[1]);
  const c = Number(args[2]);
  const d = Number(args[3]);
  const e = Number(args[4]);
  const f = Number(args[5]);
  if (![a, b, c, d, e, f].every(Number.isFinite)) {
    return null;
  }
  return [a, b, c, d, e, f];
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

function parseLuma(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clamp01(value);
  }

  if (typeof value === "string") {
    if (value.startsWith("#") && (value.length === 7 || value.length === 4)) {
      const [r, g, b] = parseHexColor(value);
      return clamp01((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);
    }
  }

  if (Array.isArray(value) && value.length >= 3) {
    const r = Number(value[0]);
    const g = Number(value[1]);
    const b = Number(value[2]);
    if ([r, g, b].every(Number.isFinite)) {
      const normalized = [r, g, b].map((entry) => (entry > 1 ? entry / 255 : entry));
      return clamp01(0.2126 * normalized[0] + 0.7152 * normalized[1] + 0.0722 * normalized[2]);
    }
  }

  return fallback;
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
  luma: number,
  alpha: number,
  allowSegmentMerge: boolean,
  endpoints: Float4Builder,
  styles: Float4Builder,
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

  const flushPending = (): void => {
    if (!hasPending) {
      return;
    }

    endpoints.push(pendingX0, pendingY0, pendingX1, pendingY1);
    styles.push(halfWidth, luma, alpha, 0);

    bounds.minX = Math.min(bounds.minX, pendingX0, pendingX1);
    bounds.minY = Math.min(bounds.minY, pendingY0, pendingY1);
    bounds.maxX = Math.max(bounds.maxX, pendingX0, pendingX1);
    bounds.maxY = Math.max(bounds.maxY, pendingY0, pendingY1);

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

    endpoints.push(x0, y0, x1, y1);
    styles.push(halfWidth, luma, alpha, 0);

    bounds.minX = Math.min(bounds.minX, x0, x1);
    bounds.minY = Math.min(bounds.minY, y0, y1);
    bounds.maxX = Math.max(bounds.maxX, x0, x1);
    bounds.maxY = Math.max(bounds.maxY, y0, y1);
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

      flattenCubic(
        t0x,
        t0y,
        t1x,
        t1y,
        t2x,
        t2y,
        t3x,
        t3y,
        (ax, ay, bx, by) => emitLine(ax, ay, bx, by, false),
        CURVE_FLATNESS,
        MAX_CURVE_SPLIT_DEPTH
      );

      cursorX = x3;
      cursorY = y3;
      continue;
    }

    if (op === DRAW_QUAD_TO) {
      const x1 = pathData[i++];
      const y1 = pathData[i++];
      const x2 = pathData[i++];
      const y2 = pathData[i++];

      const c1x = cursorX + (2 / 3) * (x1 - cursorX);
      const c1y = cursorY + (2 / 3) * (y1 - cursorY);
      const c2x = x2 + (2 / 3) * (x1 - x2);
      const c2y = y2 + (2 / 3) * (y1 - y2);

      const [t0x, t0y] = applyMatrix(matrix, cursorX, cursorY);
      const [t1x, t1y] = applyMatrix(matrix, c1x, c1y);
      const [t2x, t2y] = applyMatrix(matrix, c2x, c2y);
      const [t3x, t3y] = applyMatrix(matrix, x2, y2);

      flattenCubic(
        t0x,
        t0y,
        t1x,
        t1y,
        t2x,
        t2y,
        t3x,
        t3y,
        (ax, ay, bx, by) => emitLine(ax, ay, bx, by, false),
        CURVE_FLATNESS,
        MAX_CURVE_SPLIT_DEPTH
      );

      cursorX = x2;
      cursorY = y2;
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

interface CoverageCandidate {
  index: number;
  start: number;
  end: number;
  halfWidth: number;
  alpha: number;
}

interface InvisibleCullResult {
  segmentCount: number;
  endpoints: Float32Array;
  styles: Float32Array;
  bounds: Bounds;
  maxHalfWidth: number;
  discardedTransparentCount: number;
  discardedDegenerateCount: number;
  discardedDuplicateCount: number;
  discardedContainedCount: number;
}

function cullInvisibleSegments(endpoints: Float32Array, styles: Float32Array): InvisibleCullResult {
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
    const x1 = endpoints[offset + 2];
    const y1 = endpoints[offset + 3];

    const halfWidth = styles[offset];
    const luma = styles[offset + 1];
    const alpha = styles[offset + 2];

    if (alpha <= ALPHA_INVISIBLE_EPSILON) {
      discardedTransparentCount += 1;
      continue;
    }

    const dx = x1 - x0;
    const dy = y1 - y0;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-10) {
      discardedDegenerateCount += 1;
      continue;
    }

    const duplicateKey = buildDuplicateKey(x0, y0, x1, y1, halfWidth, luma, alpha);
    if (seenDuplicates.has(duplicateKey)) {
      discardedDuplicateCount += 1;
      continue;
    }
    seenDuplicates.add(duplicateKey);

    keepMask[i] = 1;

    const coverage = buildCoverageCandidate(i, x0, y0, x1, y1, halfWidth, luma, alpha);
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
      alpha: coverage.alpha
    });
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
    const x1 = endpoints[inOffset + 2];
    const y1 = endpoints[inOffset + 3];
    const halfWidth = styles[inOffset];

    outEndpoints[outOffset] = x0;
    outEndpoints[outOffset + 1] = y0;
    outEndpoints[outOffset + 2] = x1;
    outEndpoints[outOffset + 3] = y1;

    outStyles[outOffset] = styles[inOffset];
    outStyles[outOffset + 1] = styles[inOffset + 1];
    outStyles[outOffset + 2] = styles[inOffset + 2];
    outStyles[outOffset + 3] = styles[inOffset + 3];

    outBounds.minX = Math.min(outBounds.minX, x0, x1);
    outBounds.minY = Math.min(outBounds.minY, y0, y1);
    outBounds.maxX = Math.max(outBounds.maxX, x0, x1);
    outBounds.maxY = Math.max(outBounds.maxY, y0, y1);

    maxHalfWidth = Math.max(maxHalfWidth, halfWidth);
    out += 1;
  }

  return {
    segmentCount: visibleCount,
    endpoints: outEndpoints,
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
  x1: number,
  y1: number,
  halfWidth: number,
  luma: number,
  alpha: number
): string {
  let ax = x0;
  let ay = y0;
  let bx = x1;
  let by = y1;

  if (ax > bx || (ax === bx && ay > by)) {
    ax = x1;
    ay = y1;
    bx = x0;
    by = y0;
  }

  return [
    quantize(halfWidth, DUPLICATE_STYLE_SCALE),
    quantize(luma, DUPLICATE_STYLE_SCALE),
    quantize(alpha, DUPLICATE_STYLE_SCALE),
    quantize(ax, DUPLICATE_POSITION_SCALE),
    quantize(ay, DUPLICATE_POSITION_SCALE),
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
  luma: number,
  alpha: number
): { key: string; index: number; start: number; end: number; halfWidth: number; alpha: number } {
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
    quantize(luma, DUPLICATE_STYLE_SCALE)
  ].join("|");

  return { key, index, start, end, halfWidth, alpha };
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
