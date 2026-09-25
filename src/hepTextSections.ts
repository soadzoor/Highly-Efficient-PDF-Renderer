/**
 * Scene v9 text sections: glyph outlines and glyph instance origins.
 *
 * A text-heavy PDF stores glyph outlines once per font program and places
 * glyphs by advancing along a line with the font's widths plus sparse kerning.
 * Scene v8 stored every outline coordinate as an unrelated uint16 and every
 * origin as a plain delta from the previous glyph, which made a 396-page
 * manual's HEP larger than the PDF itself. v9 chains outline points the way
 * contours are drawn and predicts each origin from the advance last seen most
 * often after the same glyph at the same scale. Decoded values are unchanged:
 * outlines use the uint16 range grid and origins the 1/512 grid.
 *
 * Every integer is an unsigned LEB128 varint unless it is called zigzag.
 */

import {
  ByteWriter,
  POSITION_FIXED_SCALE,
  VarintCursor,
  decodeRangeUint16,
  encodeFixed512DeltaColumn,
  encodeRangeUint16,
  quantizePosition
} from "./parsedDataVarint";

export const TEXT_GLYPH_SEGMENTS_PATH = "geometry/text-glyph-segments.cq16";
export const TEXT_INSTANCE_POSITIONS_PATH = "geometry/text-instance-ef.pd512";

const MAX_GLYPH_SEGMENTS = 50_000_000;
const MAX_UINT16 = 65_535;

export interface TextGlyphSegmentsMeta {
  file: string;
  segmentCount: number;
  /** Shared `[x, y]` ranges of every outline point, start, control and end. */
  quantizationMin: number[];
  quantizationMax: number[];
}

function fail(section: string, message: string): never {
  throw new Error(`Invalid HEP ${section} section: ${message}.`);
}

/* ---------------------------------------------------------- glyph outlines */

function axisRange(a: Float32Array, b: Float32Array, count: number, axis: number): [number, number] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const include = (value: number): void => {
    if (!Number.isFinite(value)) return;
    if (value < min) min = value;
    if (value > max) max = value;
  };
  for (let i = 0; i < count; i += 1) {
    include(a[i * 4 + axis]);
    include(a[i * 4 + 2 + axis]);
    include(b[i * 4 + axis]);
  }
  return Number.isFinite(min) ? [min, max] : [0, 0];
}

/**
 * Outline segments are `A = [x0, y0, cx, cy]` and `B = [x1, y1, type, 0]`,
 * where a line's control point is its end point and `type` is 1 for a
 * quadratic. All points share one uint16 grid per axis, so a contour's start
 * equals the previous end exactly.
 *
 * `varint segmentCount`, a quadratic bitset and a control bitset of
 * `ceil(segmentCount / 8)` bytes each (bit `i & 7` of byte `i >> 3`), then six
 * `varint` column byte lengths and the zigzag columns: start x/y against the
 * previous end, end x/y against the start, and, for segments whose control bit
 * is set, control x/y against the rounded-down chord midpoint. Quadratics
 * always store a control point; a line stores one only if it differs from its
 * end. `B.w` is reserved and decodes as zero.
 */
export function encodeTextGlyphSegments(
  segmentsA: Float32Array,
  segmentsB: Float32Array,
  count: number
): { bytes: Uint8Array; meta: TextGlyphSegmentsMeta } {
  if (count > MAX_GLYPH_SEGMENTS) fail("text glyph segments", "too many segments");
  if (segmentsA.length < count * 4 || segmentsB.length < count * 4) {
    throw new Error(`Text glyph segments have insufficient data for ${count} segments.`);
  }
  const [minX, maxX] = axisRange(segmentsA, segmentsB, count, 0);
  const [minY, maxY] = axisRange(segmentsA, segmentsB, count, 1);
  const bitsetBytes = Math.ceil(count / 8);
  const quadratic = new Uint8Array(bitsetBytes);
  const control = new Uint8Array(bitsetBytes);
  const columns = Array.from({ length: 6 }, () => new ByteWriter(count + 16));
  let previousX = 0;
  let previousY = 0;
  for (let i = 0; i < count; i += 1) {
    const offset = i * 4;
    const sx = encodeRangeUint16(segmentsA[offset], minX, maxX);
    const sy = encodeRangeUint16(segmentsA[offset + 1], minY, maxY);
    const cx = encodeRangeUint16(segmentsA[offset + 2], minX, maxX);
    const cy = encodeRangeUint16(segmentsA[offset + 3], minY, maxY);
    const ex = encodeRangeUint16(segmentsB[offset], minX, maxX);
    const ey = encodeRangeUint16(segmentsB[offset + 1], minY, maxY);
    const isQuadratic = segmentsB[offset + 2] >= 0.5;
    columns[0].writeZigzagVarint(sx - previousX);
    columns[1].writeZigzagVarint(sy - previousY);
    columns[2].writeZigzagVarint(ex - sx);
    columns[3].writeZigzagVarint(ey - sy);
    if (isQuadratic) quadratic[i >> 3] |= 1 << (i & 7);
    if (isQuadratic || cx !== ex || cy !== ey) {
      control[i >> 3] |= 1 << (i & 7);
      columns[4].writeZigzagVarint(cx - ((sx + ex) >> 1));
      columns[5].writeZigzagVarint(cy - ((sy + ey) >> 1));
    }
    previousX = ex;
    previousY = ey;
  }
  const writer = new ByteWriter(bitsetBytes * 2 + count * 4 + 32);
  writer.writeVarUint32(count);
  writer.writeBytes(quadratic);
  writer.writeBytes(control);
  const columnBytes = columns.map(column => column.toUint8Array());
  for (const column of columnBytes) writer.writeVarUint32(column.length);
  for (const column of columnBytes) writer.writeBytes(column);
  return {
    bytes: writer.toUint8Array(),
    meta: {
      file: TEXT_GLYPH_SEGMENTS_PATH,
      segmentCount: count,
      quantizationMin: [minX, minY],
      quantizationMax: [maxX, maxY]
    }
  };
}

export function decodeTextGlyphSegments(
  bytes: Uint8Array,
  meta: TextGlyphSegmentsMeta
): { segmentsA: Float32Array; segmentsB: Float32Array } {
  const section = "text glyph segments";
  const header = new VarintCursor(bytes);
  const count = header.readVarUint32();
  if (count !== meta.segmentCount || count > MAX_GLYPH_SEGMENTS) {
    fail(section, "segment count does not match its manifest entry");
  }
  const bitsetBytes = Math.ceil(count / 8);
  const bitsetStart = header.byteOffset;
  if (bitsetStart + bitsetBytes * 2 > bytes.length) fail(section, "bitsets are truncated");
  const lengths = new VarintCursor(bytes, bitsetStart + bitsetBytes * 2);
  const columnLengths = Array.from({ length: 6 }, () => lengths.readVarUint32());
  let columnStart = lengths.byteOffset;
  if (columnStart + columnLengths.reduce((sum, length) => sum + length, 0) !== bytes.length) {
    fail(section, "column lengths do not fill the section");
  }
  const columns = columnLengths.map((length) => {
    const cursor = new VarintCursor(bytes, columnStart, columnStart + length);
    columnStart += length;
    return cursor;
  });
  const [minX, minY] = meta.quantizationMin;
  const [maxX, maxY] = meta.quantizationMax;
  const segmentsA = new Float32Array(count * 4);
  const segmentsB = new Float32Array(count * 4);
  const requireGrid = (value: number): number => {
    if (value < 0 || value > MAX_UINT16) fail(section, "a point leaves the quantization grid");
    return value;
  };
  let previousX = 0;
  let previousY = 0;
  for (let i = 0; i < count; i += 1) {
    const bit = 1 << (i & 7);
    const isQuadratic = (bytes[bitsetStart + (i >> 3)] & bit) !== 0;
    const hasControl = (bytes[bitsetStart + bitsetBytes + (i >> 3)] & bit) !== 0;
    if (isQuadratic && !hasControl) fail(section, "a quadratic has no control point");
    const sx = requireGrid(previousX + columns[0].readZigzagVarint());
    const sy = requireGrid(previousY + columns[1].readZigzagVarint());
    const ex = requireGrid(sx + columns[2].readZigzagVarint());
    const ey = requireGrid(sy + columns[3].readZigzagVarint());
    const cx = hasControl ? requireGrid(((sx + ex) >> 1) + columns[4].readZigzagVarint()) : ex;
    const cy = hasControl ? requireGrid(((sy + ey) >> 1) + columns[5].readZigzagVarint()) : ey;
    const offset = i * 4;
    segmentsA[offset] = decodeRangeUint16(sx, minX, maxX);
    segmentsA[offset + 1] = decodeRangeUint16(sy, minY, maxY);
    segmentsA[offset + 2] = decodeRangeUint16(cx, minX, maxX);
    segmentsA[offset + 3] = decodeRangeUint16(cy, minY, maxY);
    segmentsB[offset] = decodeRangeUint16(ex, minX, maxX);
    segmentsB[offset + 1] = decodeRangeUint16(ey, minY, maxY);
    segmentsB[offset + 2] = isQuadratic ? 1 : 0;
    previousX = ex;
    previousY = ey;
  }
  columns.forEach((cursor, index) => cursor.expectEnd(`${section} column ${index}`));
  return { segmentsA, segmentsB };
}

/* ---------------------------------------------------------- glyph origins */

interface AdvanceState {
  best: number;
  bestCount: number;
  counts: Map<number, number>;
}

/**
 * Predicts the next origin's x step as the step seen most often so far after
 * the same glyph at the same horizontal scale; ties keep the earlier leader.
 * That is the glyph's advance plus the line's character spacing, so what
 * remains is kerning and word spacing. Writer and reader update it in the same
 * order from values both have, so predictions agree exactly.
 */
class AdvanceModel {
  private readonly scaleTables = new Map<number, Map<number, AdvanceState>>();

  private lastScale = Number.NaN;

  private lastTable: Map<number, AdvanceState> | null = null;

  state(scale: number, glyph: number): AdvanceState {
    // Neighbouring glyphs usually share a scale. NaN never equals the cached
    // scale, so it takes the Map path, whose SameValueZero still matches it.
    if (this.lastTable === null || scale !== this.lastScale) {
      let table = this.scaleTables.get(scale);
      if (!table) {
        table = new Map();
        this.scaleTables.set(scale, table);
      }
      this.lastScale = scale;
      this.lastTable = table;
    }
    let state = this.lastTable.get(glyph);
    if (!state) {
      state = { best: 0, bestCount: 0, counts: new Map() };
      this.lastTable.set(glyph, state);
    }
    return state;
  }

  static observe(state: AdvanceState, step: number): void {
    const count = (state.counts.get(step) ?? 0) + 1;
    state.counts.set(step, count);
    if (count > state.bestCount) {
      state.best = step;
      state.bestCount = count;
    }
  }
}

/**
 * Glyph origins `e, f` on the 1/512 grid, as three zigzag streams whose byte
 * lengths the manifest lists: `f` delta-coded against the previous origin;
 * then, for an origin on the previous origin's baseline (equal quantized `f`),
 * its `e` step minus the predicted advance, wrapped to int32; and otherwise
 * its plain `e` step. The advance model keys on the previous instance's glyph
 * index and its matrix `a` (from `text-instance-a`).
 */
export function encodeTextInstancePositions(
  instanceA: Float32Array,
  instanceB: Float32Array,
  glyphs: ArrayLike<number>,
  count: number
): { bytes: Uint8Array; columnByteLengths: number[] } {
  const fColumn = encodeFixed512DeltaColumn(instanceB, count, 4, 1);
  const advances = new ByteWriter(count + 16);
  const jumps = new ByteWriter(count / 8 + 16);
  const model = new AdvanceModel();
  let previousE = 0;
  let previousF = 0;
  for (let i = 0; i < count; i += 1) {
    const e = quantizePosition(instanceB[i * 4]);
    const f = quantizePosition(instanceB[i * 4 + 1]);
    const step = e - previousE;
    if (i > 0 && f === previousF) {
      const state = model.state(instanceA[(i - 1) * 4], glyphs[i - 1]);
      advances.writeZigzagVarint((step - state.best) | 0);
      AdvanceModel.observe(state, step);
    } else {
      jumps.writeZigzagVarint(step);
    }
    previousE = e;
    previousF = f;
  }
  const advanceBytes = advances.toUint8Array();
  const jumpBytes = jumps.toUint8Array();
  const bytes = new Uint8Array(fColumn.length + advanceBytes.length + jumpBytes.length);
  bytes.set(fColumn, 0);
  bytes.set(advanceBytes, fColumn.length);
  bytes.set(jumpBytes, fColumn.length + advanceBytes.length);
  return { bytes, columnByteLengths: [fColumn.length, advanceBytes.length, jumpBytes.length] };
}

/** Fills `instanceB` channels 0 and 1; `instanceA` and `glyphs` must be decoded. */
export function decodeTextInstancePositionsInto(
  bytes: Uint8Array,
  columnByteLengths: readonly number[],
  instanceA: Float32Array,
  glyphs: ArrayLike<number>,
  instanceB: Float32Array,
  count: number
): void {
  const section = "text instance positions";
  const [fLength, advanceLength, jumpLength] = columnByteLengths;
  if (columnByteLengths.length !== 3 || fLength + advanceLength + jumpLength !== bytes.length) {
    fail(section, "column lengths do not fill the section");
  }
  if (instanceA.length < count * 4 || glyphs.length < count) fail(section, "instance data is incomplete");
  const fColumn = new VarintCursor(bytes, 0, fLength);
  const advances = new VarintCursor(bytes, fLength, fLength + advanceLength);
  const jumps = new VarintCursor(bytes, fLength + advanceLength, bytes.length);
  const model = new AdvanceModel();
  let e = 0;
  let f = 0;
  for (let i = 0; i < count; i += 1) {
    const nextF = f + fColumn.readZigzagVarint();
    if (i > 0 && nextF === f) {
      const state = model.state(instanceA[(i - 1) * 4], glyphs[i - 1]);
      const step = (advances.readZigzagVarint() + state.best) | 0;
      AdvanceModel.observe(state, step);
      e += step;
    } else {
      e += jumps.readZigzagVarint();
    }
    f = nextF;
    instanceB[i * 4] = e / POSITION_FIXED_SCALE;
    instanceB[i * 4 + 1] = f / POSITION_FIXED_SCALE;
  }
  fColumn.expectEnd(`${section} f column`);
  advances.expectEnd(`${section} advance stream`);
  jumps.expectEnd(`${section} jump stream`);
}
