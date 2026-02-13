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
  endpoints: Float32Array;
  styles: Float32Array;
  bounds: Bounds;
  pageBounds: Bounds;
  maxHalfWidth: number;
  operatorCount: number;
  pathCount: number;
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

export async function extractFirstPageVectors(pdfData: ArrayBuffer): Promise<VectorScene> {
  const loadingTask = getDocument({ data: new Uint8Array(pdfData) });
  const pdf = await loadingTask.promise;

  try {
    const page = await pdf.getPage(1);
    const operatorList = await page.getOperatorList();

    const endpointBuilder = new Float4Builder();
    const styleBuilder = new Float4Builder();

    const pageView = page.view;
    const pageBounds: Bounds = {
      minX: Math.min(pageView[0], pageView[2]),
      minY: Math.min(pageView[1], pageView[3]),
      maxX: Math.max(pageView[0], pageView[2]),
      maxY: Math.max(pageView[1], pageView[3])
    };

    const bounds: Bounds = {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY
    };

    let pathCount = 0;
    let maxHalfWidth = 0;

    const stateStack: GraphicsState[] = [];
    let currentState: GraphicsState = createDefaultState();

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
      emitSegmentsFromPath(
        pathData,
        currentState.matrix,
        halfWidth,
        styleLuma,
        styleAlpha,
        endpointBuilder,
        styleBuilder,
        bounds
      );
    }

    const segmentCount = endpointBuilder.quadCount;

    if (segmentCount === 0) {
      return {
        segmentCount,
        endpoints: new Float32Array(0),
        styles: new Float32Array(0),
        bounds: { ...pageBounds },
        pageBounds,
        maxHalfWidth: 0,
        operatorCount: operatorList.fnArray.length,
        pathCount
      };
    }

    return {
      segmentCount,
      endpoints: endpointBuilder.toTypedArray(),
      styles: styleBuilder.toTypedArray(),
      bounds,
      pageBounds,
      maxHalfWidth,
      operatorCount: operatorList.fnArray.length,
      pathCount
    };
  } finally {
    await pdf.destroy();
  }
}

function createDefaultState(): GraphicsState {
  return {
    matrix: [...IDENTITY_MATRIX],
    lineWidth: 1,
    strokeLuma: 0,
    strokeAlpha: 1
  };
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
  endpoints: Float4Builder,
  styles: Float4Builder,
  bounds: Bounds
): void {
  let cursorX = 0;
  let cursorY = 0;
  let startX = 0;
  let startY = 0;
  let hasStart = false;

  const emitLine = (x0: number, y0: number, x1: number, y1: number): void => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (dx * dx + dy * dy < 1e-10) {
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

      flattenCubic(
        t0x,
        t0y,
        t1x,
        t1y,
        t2x,
        t2y,
        t3x,
        t3y,
        (ax, ay, bx, by) => emitLine(ax, ay, bx, by),
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
        (ax, ay, bx, by) => emitLine(ax, ay, bx, by),
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
        emitLine(tx0, ty0, tx1, ty1);
      }
      cursorX = startX;
      cursorY = startY;
      continue;
    }

    break;
  }
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
