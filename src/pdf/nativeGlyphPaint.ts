import type { NativeGlyphPathCommand } from "./nativeFont";
import { buildNativeGlyphStroke } from "./nativeGlyphStroke";
import { PdfError, throwIfAborted } from "./nativeTypes";

export interface NativeGlyphPaintOptions {
  /** Raw character coordinates to the caller's outline coordinate system. */
  readonly transform?: ArrayLike<number>;
  readonly lineCap?: 0 | 1 | 2;
  readonly lineJoin?: 0 | 1 | 2;
  readonly miterLimit?: number;
  readonly dashArray?: readonly number[];
  readonly dashPhase?: number;
  readonly signal?: AbortSignal;
  readonly maxPathCommands?: number;
}

export interface NativeGlyphPaintResult {
  readonly commands: readonly NativeGlyphPathCommand[];
  /** Filled-stroke bounds; ordinary fill and device hairlines retain source bounds. */
  readonly bounds: readonly [number, number, number, number] | null;
  /** Width zero must be retained as a device hairline, never filled as a contour. */
  readonly hairline: boolean;
  readonly approximated: boolean;
}

const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

/**
 * PaintType 0 fills and PaintType 2 strokes in raw character coordinates
 * (Adobe Type 1 Font Format, section 6.1; PLRM, table 5.4). Expand positive
 * widths before FontMatrix so shears and unequal scales transform the pen too.
 * Width zero remains explicitly device dependent for the caller to retain.
 */
export function paintNativeGlyphCommands(
  commands: readonly NativeGlyphPathCommand[],
  paintType: number,
  strokeWidth = 0,
  options: NativeGlyphPaintOptions = {}
): NativeGlyphPaintResult {
  throwIfAborted(options.signal);
  const limit = options.maxPathCommands ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(limit) || limit < 0) throw new TypeError("Glyph paint command limit must be a nonnegative safe integer.");
  const transform = options.transform ?? IDENTITY;
  if (transform.length < 6 || Array.from({ length: 6 }, (_, index) => transform[index]).some(value => !Number.isFinite(value))) {
    throw unsupported("Glyph paint has an invalid transform.");
  }
  if (paintType !== 0 && paintType !== 2) throw unsupported(`Font PaintType ${paintType} is unsupported.`);
  if (paintType === 2 && !Number.isFinite(strokeWidth)) throw unsupported("Font StrokeWidth must be finite.");
  const append = (target: NativeGlyphPathCommand[], command: NativeGlyphPathCommand): void => {
    if (target.length >= limit) throw new PdfError("resource-limit", "Painted glyph exceeds the configured path command limit.", {
      details: { reason: "native-glyph-paint-commands", maxPathCommands: limit }
    });
    target.push(Object.freeze(command));
  };
  if (paintType === 0 || strokeWidth === 0) {
    const result: NativeGlyphPathCommand[] = [];
    for (let index = 0; index < commands.length; index++) {
      if ((index & 255) === 0) throwIfAborted(options.signal);
      append(result, transformCommand(commands[index], transform));
    }
    return Object.freeze({ commands: Object.freeze(result), bounds: null,
      hairline: paintType === 2, approximated: false });
  }
  let geometry: ReturnType<typeof buildNativeGlyphStroke>;
  try {
    geometry = buildNativeGlyphStroke(commands, transform, {
      transform, width: Math.abs(strokeWidth), lineCap: options.lineCap ?? 0,
      lineJoin: options.lineJoin ?? 0, miterLimit: options.miterLimit ?? 10,
      dashArray: options.dashArray ?? [], dashPhase: options.dashPhase ?? 0
    }, options.signal);
  } catch (cause) {
    // The path stroker also serves ordinary PDF content. At this boundary its
    // unsupported geometry is an outline capability, so font substitution can
    // recover it. Cancellation and configured resource ceilings propagate.
    if (!(cause instanceof PdfError) || cause.code !== "unsupported-content") throw cause;
    throw new PdfError("unsupported-font", cause.message, {
      cause, details: { ...cause.details, reason: "native-glyph-paint" }
    });
  }
  if (!geometry) return Object.freeze({ commands: Object.freeze([]), bounds: Object.freeze([0, 0, 0, 0]) as readonly [number, number, number, number],
    hairline: false, approximated: false });
  const result: NativeGlyphPathCommand[] = [];
  let startX = NaN, startY = NaN, previousX = NaN, previousY = NaN;
  for (let offset = 0; offset < geometry.segmentsA.length; offset += 4) {
    if ((offset & 1023) === 0) throwIfAborted(options.signal);
    const x0 = geometry.segmentsA[offset], y0 = geometry.segmentsA[offset + 1];
    const x1 = geometry.segmentsA[offset + 2], y1 = geometry.segmentsA[offset + 3];
    if (x0 !== previousX || y0 !== previousY) {
      if (Number.isFinite(previousX)) append(result, { kind: "close" });
      append(result, { kind: "move", x: x0, y: y0 });
      startX = x0; startY = y0;
    }
    if (x1 === startX && y1 === startY) {
      append(result, { kind: "close" });
      previousX = previousY = NaN;
    } else {
      append(result, { kind: "line", x: x1, y: y1 });
      previousX = x1; previousY = y1;
    }
  }
  if (Number.isFinite(previousX)) append(result, { kind: "close" });
  const { minX, minY, maxX, maxY } = geometry.bounds;
  return Object.freeze({ commands: Object.freeze(result),
    bounds: Object.freeze([minX, minY, maxX, maxY]) as readonly [number, number, number, number],
    hairline: false, approximated: geometry.approximated });
}

function transformCommand(command: NativeGlyphPathCommand, matrix: ArrayLike<number>): NativeGlyphPathCommand {
  if (command.kind === "close") return { kind: "close" };
  const point = (x: number, y: number): readonly [number, number] => {
    const tx = matrix[0] * x + matrix[2] * y + matrix[4], ty = matrix[1] * x + matrix[3] * y + matrix[5];
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) throw unsupported("Glyph paint has non-finite coordinates.");
    return [tx, ty];
  };
  const [x, y] = point(command.x, command.y);
  if (command.kind === "quadratic") {
    const [controlX, controlY] = point(command.controlX, command.controlY);
    return { kind: "quadratic", x, y, controlX, controlY };
  }
  if (command.kind === "cubic") {
    const [control1X, control1Y] = point(command.control1X, command.control1Y);
    const [control2X, control2Y] = point(command.control2X, command.control2Y);
    return { kind: "cubic", x, y, control1X, control1Y, control2X, control2Y };
  }
  return { kind: command.kind, x, y };
}

function unsupported(message: string): PdfError {
  return new PdfError("unsupported-font", message, { details: { reason: "native-glyph-paint" } });
}
