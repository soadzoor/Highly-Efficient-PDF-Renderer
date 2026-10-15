/** Compact, exact resources for retained native PDF programs. */
import type {
  DensePdfBounds,
  DensePdfCompiledPage,
  DensePdfGenericPathPaint,
  DensePdfGenericStrokeStyle,
  DensePdfMatrix,
  DensePdfPagePath,
  DensePdfSolidPaint,
} from "./nativeContentCompiler";

const RECORD_CHUNK_SIZE = 4096;
const SMALL_RECORD_CHUNK_SIZES = [8, 32, 128, 512, 2048] as const;
const SMALL_RECORD_COUNT = SMALL_RECORD_CHUNK_SIZES.reduce((total, count) => total + count, 0);
const INITIAL_GEOMETRY_CHUNK_SIZE = 256;
const GEOMETRY_CHUNK_SIZE = 65536;
const PATH_RECORD_SIZE = 8;
const PAINT_RECORD_SIZE = 5;

export interface DensePdfPackedResourceChunk {
  readonly start: number;
  readonly records: Float64Array;
  readonly count: number;
}

interface CapturedResourceChunk {
  start: number;
  records: Float64Array;
  count: number;
}

/** Plain data, including after structured clone across the PDF worker boundary. */
export interface DensePdfPackedRetainedResources {
  readonly pathCount: number;
  readonly paintCount: number;
  readonly pathChunks: readonly DensePdfPackedResourceChunk[];
  readonly paintChunks: readonly DensePdfPackedResourceChunk[];
  readonly geometryChunks: readonly Float32Array[];
  readonly matrices: readonly DensePdfMatrix[];
  readonly solidPaints: readonly DensePdfSolidPaint[];
  readonly strokeStyles: readonly DensePdfGenericStrokeStyle[];
}

type RetainedPage = Pick<DensePdfCompiledPage, "pagePaths" | "genericPathPaints"> & {
  readonly packedRetainedResources?: DensePdfPackedRetainedResources;
};

function numberKey(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

function numbersKey(values: readonly number[]): string {
  let key = "";
  for (let index = 0; index < values.length; index++) {
    if (index) key += ",";
    key += numberKey(values[index]);
  }
  return key;
}

function equalNumbers(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    if (!Object.is(a[index], b[index])) return false;
  }
  return true;
}

function inheritedPaintKey(paint: DensePdfSolidPaint): string {
  return "inheritType3Paint" in paint ? String(paint.inheritType3Paint) : "absent";
}

function equalSolidPaint(a: DensePdfSolidPaint, b: DensePdfSolidPaint): boolean {
  return Object.is(a.sourceColorSpaceIndex, b.sourceColorSpaceIndex) &&
    inheritedPaintKey(a) === inheritedPaintKey(b) && equalNumbers(a.color, b.color);
}

function equalStrokeStyle(a: DensePdfGenericStrokeStyle, b: DensePdfGenericStrokeStyle): boolean {
  return Object.is(a.lineWidth, b.lineWidth) && Object.is(a.lineCap, b.lineCap) && Object.is(a.lineJoin, b.lineJoin) &&
    Object.is(a.miterLimit, b.miterLimit) && Object.is(a.dashPhase, b.dashPhase) &&
    a.hairline === b.hairline && a.strokeAdjust === b.strokeAdjust && equalNumbers(a.dash, b.dash);
}

function recordChunkIndex(index: number): number {
  if (index >= SMALL_RECORD_COUNT) {
    return SMALL_RECORD_CHUNK_SIZES.length + Math.floor((index - SMALL_RECORD_COUNT) / RECORD_CHUNK_SIZE);
  }
  for (let chunk = 0; chunk < SMALL_RECORD_CHUNK_SIZES.length; chunk++) {
    if (index < SMALL_RECORD_CHUNK_SIZES[chunk]) return chunk;
    index -= SMALL_RECORD_CHUNK_SIZES[chunk];
  }
  return -1;
}

function captureRecordChunk(chunks: CapturedResourceChunk[], index: number, recordSize: number): CapturedResourceChunk {
  let chunk = chunks[chunks.length - 1];
  if (!chunk || chunk.count * recordSize === chunk.records.length) {
    const capacity = SMALL_RECORD_CHUNK_SIZES[chunks.length] ?? RECORD_CHUNK_SIZE;
    chunk = { start: index, records: new Float64Array(capacity * recordSize), count: 0 };
    chunks.push(chunk);
  }
  return chunk;
}

function pathAt(resources: DensePdfPackedRetainedResources, index: number): DensePdfPagePath | undefined {
  if (!Number.isInteger(index) || index < 0 || index >= resources.pathCount) return undefined;
  const chunk = resources.pathChunks[recordChunkIndex(index)];
  const record = (index - chunk.start) * PATH_RECORD_SIZE;
  const values = chunk.records;
  const geometry = resources.geometryChunks[values[record]];
  const offset = values[record + 1];
  return Object.freeze({
    data: geometry.subarray(offset, offset + values[record + 2]),
    transform: resources.matrices[values[record + 3]],
    bounds: Object.freeze({
      minX: values[record + 4], minY: values[record + 5],
      maxX: values[record + 6], maxY: values[record + 7],
    }),
  });
}

function paintAt(resources: DensePdfPackedRetainedResources, index: number): DensePdfGenericPathPaint | undefined {
  if (!Number.isInteger(index) || index < 0 || index >= resources.paintCount) return undefined;
  const chunk = resources.paintChunks[recordChunkIndex(index)];
  const record = (index - chunk.start) * PAINT_RECORD_SIZE;
  const values = chunk.records;
  return Object.freeze({
    pathIndex: values[record],
    fillRule: values[record + 1] as 0 | 1,
    fill: values[record + 2] < 0 ? null : resources.solidPaints[values[record + 2]],
    stroke: values[record + 3] < 0 ? null : resources.solidPaints[values[record + 3]],
    strokeStyle: values[record + 4] < 0 ? null : resources.strokeStyles[values[record + 4]],
  });
}

export function densePdfPagePathCount(page: RetainedPage): number {
  return page.packedRetainedResources?.pathCount ?? page.pagePaths.length;
}

export function densePdfGenericPathPaintCount(page: RetainedPage): number {
  return page.packedRetainedResources?.paintCount ?? page.genericPathPaints.length;
}

export function getDensePdfPagePath(page: RetainedPage, index: number): DensePdfPagePath | undefined {
  return page.packedRetainedResources ? pathAt(page.packedRetainedResources, index) : page.pagePaths[index];
}

export function getDensePdfGenericPathPaint(page: RetainedPage, index: number): DensePdfGenericPathPaint | undefined {
  return page.packedRetainedResources ? paintAt(page.packedRetainedResources, index) : page.genericPathPaints[index];
}

/** Reusable, caller-owned view of a retained path. No geometry view or wrapper
 * is allocated while reading packed records. Consume it before the next read.
 * @internal */
export interface DensePdfPathReadTarget extends DensePdfBounds {
  data: Float32Array;
  dataOffset: number;
  dataLength: number;
  transform: DensePdfMatrix;
}

/** @internal */
export function readDensePdfPagePathInto(page: RetainedPage, index: number, target: DensePdfPathReadTarget): boolean {
  const resources = page.packedRetainedResources;
  if (!resources) {
    const path = page.pagePaths[index];
    if (!path) return false;
    target.data = path.data;
    target.dataOffset = 0;
    target.dataLength = path.data.length;
    target.transform = path.transform;
    target.minX = path.bounds.minX;
    target.minY = path.bounds.minY;
    target.maxX = path.bounds.maxX;
    target.maxY = path.bounds.maxY;
    return true;
  }
  if (!Number.isInteger(index) || index < 0 || index >= resources.pathCount) return false;
  const chunk = resources.pathChunks[recordChunkIndex(index)];
  const record = (index - chunk.start) * PATH_RECORD_SIZE;
  const values = chunk.records;
  target.data = resources.geometryChunks[values[record]];
  target.dataOffset = values[record + 1];
  target.dataLength = values[record + 2];
  target.transform = resources.matrices[values[record + 3]];
  target.minX = values[record + 4];
  target.minY = values[record + 5];
  target.maxX = values[record + 6];
  target.maxY = values[record + 7];
  return true;
}

/** @internal */
export type DensePdfPaintReadTarget = { -readonly [Key in keyof DensePdfGenericPathPaint]: DensePdfGenericPathPaint[Key] };

/** Reuses the supplied record without materializing a frozen paint wrapper.
 * Referenced paints and styles remain the original immutable resources.
 * @internal */
export function readDensePdfGenericPathPaintInto(page: RetainedPage, index: number, target: DensePdfPaintReadTarget): boolean {
  const resources = page.packedRetainedResources;
  if (!resources) {
    const paint = page.genericPathPaints[index];
    if (!paint) return false;
    target.pathIndex = paint.pathIndex;
    target.fillRule = paint.fillRule;
    target.fill = paint.fill;
    target.stroke = paint.stroke;
    target.strokeStyle = paint.strokeStyle;
    return true;
  }
  if (!Number.isInteger(index) || index < 0 || index >= resources.paintCount) return false;
  const chunk = resources.paintChunks[recordChunkIndex(index)];
  const record = (index - chunk.start) * PAINT_RECORD_SIZE;
  const values = chunk.records;
  target.pathIndex = values[record];
  target.fillRule = values[record + 1] as 0 | 1;
  target.fill = values[record + 2] < 0 ? null : resources.solidPaints[values[record + 2]];
  target.stroke = values[record + 3] < 0 ? null : resources.solidPaints[values[record + 3]];
  target.strokeStyle = values[record + 4] < 0 ? null : resources.strokeStyles[values[record + 4]];
  return true;
}

/** Capture owns geometry ranges immediately; finalization never rebuilds the resource graph. */
export class DensePdfRetainedResourceBuilder {
  private readonly thumbnail: boolean;
  private readonly pathChunks: CapturedResourceChunk[] = [];
  private readonly paintChunks: CapturedResourceChunk[] = [];
  private readonly geometryChunks: Float32Array[] = [];
  private readonly matrices: DensePdfMatrix[] = [];
  private readonly solidPaints: DensePdfSolidPaint[] = [];
  private readonly strokeStyles: DensePdfGenericStrokeStyle[] = [];
  private readonly matrixIndices = new Map<string, number>();
  private readonly paintIndices = new Map<string, number>();
  private readonly styleIndices = new Map<string, number>();
  private lastMatrixIndex = -1;
  private lastPaintIndex = -1;
  private lastStyleIndex = -1;
  private geometryChunkIndex = -1;
  private geometryOffset = 0;
  private nextGeometryChunkSize = INITIAL_GEOMETRY_CHUNK_SIZE;
  private paths = 0;
  private paints = 0;
  private finished = false;

  constructor(thumbnail = false) {
    this.thumbnail = thumbnail;
  }

  get pathCount(): number { return this.paths; }
  get paintCount(): number { return this.paints; }

  private assertCapturing(): void {
    if (this.finished) throw new Error("Retained PDF resources have already been finalized.");
  }

  private internMatrix(transform: DensePdfMatrix): number {
    if (this.lastMatrixIndex >= 0 && equalNumbers(this.matrices[this.lastMatrixIndex], transform)) {
      return this.lastMatrixIndex;
    }
    // Thumbnail page adaptation appends each path's CTM again. Avoid global
    // string-key interning here while retaining the common consecutive-CTM
    // fast path and every original Float64 value.
    const key = this.thumbnail ? undefined : numbersKey(transform);
    let index = key === undefined ? undefined : this.matrixIndices.get(key);
    if (index === undefined) {
      index = this.matrices.length;
      const matrix: DensePdfMatrix = [transform[0], transform[1], transform[2], transform[3], transform[4], transform[5]];
      Object.freeze(matrix);
      this.matrices.push(matrix);
      if (key !== undefined) this.matrixIndices.set(key, index);
    }
    this.lastMatrixIndex = index;
    return index;
  }

  private internPaint(paint: DensePdfSolidPaint): number {
    if (this.lastPaintIndex >= 0 && equalSolidPaint(this.solidPaints[this.lastPaintIndex], paint)) {
      return this.lastPaintIndex;
    }
    const key = `${numbersKey(paint.color)};${numberKey(paint.sourceColorSpaceIndex)};${inheritedPaintKey(paint)}`;
    let index = this.paintIndices.get(key);
    if (index === undefined) {
      index = this.solidPaints.length;
      const color = Object.freeze([paint.color[0], paint.color[1], paint.color[2], paint.color[3]]) as DensePdfSolidPaint["color"];
      const owned: DensePdfSolidPaint = "inheritType3Paint" in paint
        ? { color, sourceColorSpaceIndex: paint.sourceColorSpaceIndex, inheritType3Paint: paint.inheritType3Paint }
        : { color, sourceColorSpaceIndex: paint.sourceColorSpaceIndex };
      this.solidPaints.push(Object.freeze(owned));
      this.paintIndices.set(key, index);
    }
    this.lastPaintIndex = index;
    return index;
  }

  private internStyle(style: DensePdfGenericStrokeStyle): number {
    if (this.lastStyleIndex >= 0 && equalStrokeStyle(this.strokeStyles[this.lastStyleIndex], style)) {
      return this.lastStyleIndex;
    }
    const key = `${numberKey(style.lineWidth)},${numberKey(style.lineCap)},${numberKey(style.lineJoin)},${numberKey(style.miterLimit)},` +
      `${numberKey(style.dashPhase)},${style.hairline},${style.strokeAdjust};${numbersKey(style.dash)}`;
    let index = this.styleIndices.get(key);
    if (index === undefined) {
      index = this.strokeStyles.length;
      this.strokeStyles.push(Object.freeze({
        lineWidth: style.lineWidth, lineCap: style.lineCap, lineJoin: style.lineJoin,
        miterLimit: style.miterLimit, dash: Object.freeze(Array.from(style.dash)),
        dashPhase: style.dashPhase, hairline: style.hairline, strokeAdjust: style.strokeAdjust,
      }));
      this.styleIndices.set(key, index);
    }
    this.lastStyleIndex = index;
    return index;
  }

  appendPath(data: Float32Array, transform: DensePdfMatrix, bounds: DensePdfBounds): number {
    this.assertCapturing();
    let geometryChunkIndex = this.geometryChunkIndex;
    let offset = this.geometryOffset;
    if (data.length > GEOMETRY_CHUNK_SIZE) {
      geometryChunkIndex = this.geometryChunks.length;
      this.geometryChunks.push(new Float32Array(data.length));
      offset = 0;
    } else if (geometryChunkIndex < 0 || offset + data.length > this.geometryChunks[geometryChunkIndex].length) {
      geometryChunkIndex = this.geometryChunks.length;
      const capacity = Math.max(this.nextGeometryChunkSize, data.length);
      this.geometryChunks.push(new Float32Array(capacity));
      this.nextGeometryChunkSize = Math.min(GEOMETRY_CHUNK_SIZE, capacity * 4);
      offset = 0;
      this.geometryChunkIndex = geometryChunkIndex;
      this.geometryOffset = 0;
    }
    this.geometryChunks[geometryChunkIndex].set(data, offset);
    if (data.length <= GEOMETRY_CHUNK_SIZE) this.geometryOffset = offset + data.length;
    const index = this.paths;
    const chunk = captureRecordChunk(this.pathChunks, index, PATH_RECORD_SIZE);
    const record = chunk.count * PATH_RECORD_SIZE;
    chunk.records[record] = geometryChunkIndex;
    chunk.records[record + 1] = offset;
    chunk.records[record + 2] = data.length;
    chunk.records[record + 3] = this.internMatrix(transform);
    chunk.records[record + 4] = bounds.minX;
    chunk.records[record + 5] = bounds.minY;
    chunk.records[record + 6] = bounds.maxX;
    chunk.records[record + 7] = bounds.maxY;
    chunk.count++;
    this.paths++;
    return index;
  }

  getPath(index: number): DensePdfPagePath | undefined {
    return pathAt(this.resources(), index);
  }

  appendPaint(paint: DensePdfGenericPathPaint): number {
    this.assertCapturing();
    const index = this.paints;
    const chunk = captureRecordChunk(this.paintChunks, index, PAINT_RECORD_SIZE);
    const record = chunk.count * PAINT_RECORD_SIZE;
    chunk.records[record] = paint.pathIndex;
    chunk.records[record + 1] = paint.fillRule;
    chunk.records[record + 2] = paint.fill === null ? -1 : this.internPaint(paint.fill);
    chunk.records[record + 3] = paint.stroke === null ? -1 : this.internPaint(paint.stroke);
    chunk.records[record + 4] = paint.strokeStyle === null ? -1 : this.internStyle(paint.strokeStyle);
    chunk.count++;
    this.paints++;
    return index;
  }

  getPaint(index: number): DensePdfGenericPathPaint | undefined {
    return paintAt(this.resources(), index);
  }

  private resources(): DensePdfPackedRetainedResources {
    return {
      pathCount: this.paths, paintCount: this.paints,
      pathChunks: this.pathChunks, paintChunks: this.paintChunks, geometryChunks: this.geometryChunks,
      matrices: this.matrices, solidPaints: this.solidPaints, strokeStyles: this.strokeStyles,
    };
  }

  async finish(checkpoint: () => Promise<void>): Promise<DensePdfPackedRetainedResources> {
    this.assertCapturing();
    this.finished = true;
    await checkpoint();
    for (const chunks of [this.pathChunks, this.paintChunks]) {
      for (const chunk of chunks) {
        Object.freeze(chunk);
        await checkpoint();
      }
      Object.freeze(chunks);
    }
    Object.freeze(this.geometryChunks);
    Object.freeze(this.matrices);
    Object.freeze(this.solidPaints);
    Object.freeze(this.strokeStyles);
    this.matrixIndices.clear();
    this.paintIndices.clear();
    this.styleIndices.clear();
    await checkpoint();
    return Object.freeze(this.resources());
  }
}
