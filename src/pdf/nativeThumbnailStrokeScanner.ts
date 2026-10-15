/** Scratch values: matrix[0..5], optional gray[6], width/join/cap[7..9],
 * start/first-line coordinates[10..13]. Gray is zero when the block omits G. */
export interface ThumbnailStrokeScanResult {
  end: number;
  hasGray: boolean;
  /** Present on every success; optional only for an uninitialized result owner. */
  lineCount?: number;
  /** Reusable scratch for subsequent x/y pairs, excluding the first line. */
  extraCoordinates?: Float64Array;
}

const byteClasses = new Uint8Array(256);
for (const byte of [0, 9, 10, 12, 13, 32]) byteClasses[byte] = 1;
for (const byte of [40, 41, 60, 62, 91, 93, 123, 125, 47, 37]) byteClasses[byte] = 2;
const numberDecoder = new TextDecoder("latin1");

/** Recognize a complete q/cm/[G]/w/j/J/m/l+/S/Q thumbnail scope.
 * A failed attempt publishes no result fields or compiler state. Numeric
 * scratch, including extraCoordinates, is unspecified until success.
 * Reuse `result` to avoid common-path allocations.
 * Tokens cut by a chunk, comments and other syntax use the ordinary lexer. */
export function scanThumbnailStrokeBlock(bytes: Uint8Array, offset: number, final: boolean,
  numbers: Float64Array, result?: ThumbnailStrokeScanResult): ThumbnailStrokeScanResult | null {
  if (offset < 0 || offset >= bytes.length || bytes[offset] !== 113) return null; // q
  let next = afterSpace(bytes, offset + 1);
  if (!next) return null;
  for (let index = 0; index < 6; index++) {
    next = readNumber(bytes, next, numbers, index);
    if (!next) return null;
  }
  if (bytes[next] !== 99 || bytes[next + 1] !== 109) return null; // cm
  next = afterSpace(bytes, next + 2);
  if (!next) return null;
  next = readNumber(bytes, next, numbers, 6);
  if (!next) return null;
  const hasGray = bytes[next] === 71; // G
  if (hasGray) {
    next = afterSpace(bytes, next + 1);
    if (!next) return null;
    next = readNumber(bytes, next, numbers, 7);
    if (!next) return null;
  } else {
    numbers[7] = numbers[6];
    numbers[6] = 0;
  }
  if (bytes[next] !== 119) return null; // w
  next = afterSpace(bytes, next + 1);
  if (!next) return null;
  next = readNumber(bytes, next, numbers, 8);
  if (!next || bytes[next] !== 106) return null; // j
  next = afterSpace(bytes, next + 1);
  if (!next) return null;
  next = readNumber(bytes, next, numbers, 9);
  if (!next || bytes[next] !== 74) return null; // J
  next = afterSpace(bytes, next + 1);
  if (!next) return null;
  next = readNumber(bytes, next, numbers, 10);
  if (!next) return null;
  next = readNumber(bytes, next, numbers, 11);
  if (!next || bytes[next] !== 109) return null; // m
  next = afterSpace(bytes, next + 1);
  if (!next) return null;
  next = readNumber(bytes, next, numbers, 12);
  if (!next) return null;
  next = readNumber(bytes, next, numbers, 13);
  if (!next || bytes[next] !== 108) return null; // l
  next = afterSpace(bytes, next + 1);
  if (!next) return null;
  let coordinateCount = 0, coordinates = result?.extraCoordinates;
  while (next < bytes.length && bytes[next] !== 83) { // additional x y l
    if (!coordinates || coordinateCount + 2 > coordinates.length) {
      const grown = new Float64Array(Math.max(16, (coordinates?.length ?? 0) * 2));
      if (coordinates) grown.set(coordinates);
      coordinates = grown;
    }
    next = readNumber(bytes, next, coordinates, coordinateCount);
    if (!next) return null;
    next = readNumber(bytes, next, coordinates, coordinateCount + 1);
    if (!next || bytes[next] !== 108) return null; // l
    next = afterSpace(bytes, next + 1);
    if (!next) return null;
    coordinateCount += 2;
  }
  if (next >= bytes.length || bytes[next] !== 83) return null; // S
  next = afterSpace(bytes, next + 1);
  if (!next || bytes[next] !== 81) return null; // Q
  const end = next + 1;
  if (end === bytes.length ? !final : !byteClasses[bytes[end]]) return null;
  result ??= { end, hasGray };
  result.end = end;
  result.hasGray = hasGray;
  result.lineCount = 1 + coordinateCount / 2;
  if (coordinates) result.extraCoordinates = coordinates;
  return result;
}

/** Every token in this narrow grammar requires at least one PDF whitespace. */
function afterSpace(bytes: Uint8Array, offset: number): number {
  if (offset >= bytes.length || byteClasses[bytes[offset]] !== 1) return 0;
  do { offset++; } while (offset < bytes.length && byteClasses[bytes[offset]] === 1);
  return offset;
}

/** Parse and skip trailing whitespace in one pass. Short operands use exactly
 * the ordinary lexer's arithmetic; only long tokens need a temporary string. */
function readNumber(bytes: Uint8Array, offset: number, numbers: Float64Array, index: number): number {
  if (offset >= bytes.length) return 0;
  const start = offset;
  let sign = 1;
  if (bytes[offset] === 43 || bytes[offset] === 45) {
    if (bytes[offset] === 45) sign = -1;
    offset++;
  }
  let value = 0, digits = 0, divideBy = 1, digit: number;
  while (offset < bytes.length && (digit = bytes[offset] - 48) >= 0 && digit <= 9) {
    value = value * 10 + digit;
    digits++; offset++;
  }
  if (offset < bytes.length && bytes[offset] === 46) {
    offset++;
    while (offset < bytes.length && (digit = bytes[offset] - 48) >= 0 && digit <= 9) {
      value = value * 10 + digit;
      divideBy *= 10;
      digits++; offset++;
    }
  }
  if (!digits || offset >= bytes.length || byteClasses[bytes[offset]] !== 1) return 0;
  const parsed = digits <= 15 ? sign * (value / divideBy)
    : Number(numberDecoder.decode(bytes.subarray(start, offset)));
  if (!Number.isFinite(parsed)) return 0;
  numbers[index] = parsed;
  do { offset++; } while (offset < bytes.length && byteClasses[bytes[offset]] === 1);
  return offset;
}
