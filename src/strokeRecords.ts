import type { VectorScene } from "./pdfVectorExtractor";

/** Consecutive stroke IDs whose records one scene holds from its index 0. */
export interface StrokeRecordSegment {
  first: number;
  count: number;
  scene: VectorScene;
}

/**
 * Stroke records addressed by one ID space, possibly held by several scenes.
 * Vector LOD keeps canonical strokes and LOD-only records apart this way, so
 * consumers read and upload both without building a combined copy.
 */
export interface StrokeRecords {
  count: number;
  segments: readonly StrokeRecordSegment[];
}

/** Stroke geometry given as one scene, or as records split across scenes. */
export interface StrokeRecordSource {
  scene?: VectorScene;
  records?: StrokeRecords;
}

export type StrokeRecordField = "endpoints" | "primitiveMeta" | "primitiveBounds" | "styles";

/** RGBA32F texels starting at column 0 of row `y`. */
export interface StrokeTextureRows {
  y: number;
  width: number;
  height: number;
  data: Float32Array;
}

export function sceneStrokeRecords(scene: VectorScene): StrokeRecords {
  const count = Math.max(0, scene.segmentCount | 0);
  return { count, segments: [{ first: 0, count, scene }] };
}

export function strokeSourceRecords(source: StrokeRecordSource): StrokeRecords {
  return source.records ?? sceneStrokeRecords(source.scene!);
}

/** The segment holding `id`. Hierarchies have a handful of segments, so a scan is cheapest. */
export function strokeRecordSegment(records: StrokeRecords, id: number): StrokeRecordSegment {
  const segments = records.segments;
  let index = 0;
  while (index + 1 < segments.length && id >= segments[index + 1].first) index++;
  return segments[index];
}

/**
 * Uploads of one stroke field into a texture `width` texels wide. Rows inside
 * one scene are views of its array, batched to at most `maxBytes`. Only a row
 * that spans two scenes, or ends in an incomplete texel, is staged, one row at
 * a time. The last row may be narrower. Texels without source data are not
 * uploaded: new textures start zero-filled.
 */
export function* strokeTextureRows(
  records: StrokeRecords,
  field: StrokeRecordField,
  width: number,
  maxBytes = 4 * 1024 * 1024
): Generator<StrokeTextureRows, void, void> {
  const total = Math.max(0, records.count | 0);
  const batchRows = Math.max(1, Math.floor(maxBytes / (width * 16)));
  const segments = records.segments.filter(segment => segment.count > 0);
  // Texels of each segment backed by complete source data.
  const available = segments.map(segment => Math.min(segment.count, Math.floor(segment.scene[field].length / 4)));
  const rowCount = Math.ceil(total / width);
  let segmentIndex = 0;
  for (let row = 0; row < rowCount;) {
    const start = row * width;
    const end = Math.min(start + width, total);
    while (segmentIndex + 1 < segments.length && start >= segments[segmentIndex + 1].first) segmentIndex++;
    const segment = segments[segmentIndex];
    const direct = segment && end <= segment.first + available[segmentIndex];
    if (direct) {
      // Batch only full rows; a narrower last row is its own upload.
      let rows = 1;
      if (end - start === width) {
        const lastRow = Math.floor((segment.first + available[segmentIndex]) / width);
        rows = Math.max(1, Math.min(batchRows, lastRow - row));
      }
      const offset = (start - segment.first) * 4;
      const texels = rows === 1 ? end - start : rows * width;
      yield { y: row, width: rows === 1 ? end - start : width, height: rows,
        data: segment.scene[field].subarray(offset, offset + texels * 4) };
      row += rows;
      continue;
    }
    const data = new Float32Array((end - start) * 4);
    let copied = false;
    for (let index = segmentIndex; index < segments.length && segments[index].first < end; index++) {
      const source = segments[index];
      const from = Math.max(start, source.first);
      const to = Math.min(end, source.first + source.count);
      const values = source.scene[field];
      const sourceStart = (from - source.first) * 4;
      const sourceEnd = Math.min(values.length, (to - source.first) * 4);
      if (sourceEnd <= sourceStart) continue;
      data.set(values.subarray(sourceStart, sourceEnd), (from - start) * 4);
      copied = true;
    }
    if (copied) yield { y: row, width: end - start, height: 1, data };
    row++;
  }
}

/** RGBA32F data of one stroke field texture, `width` by `height` texels. */
export interface StrokeTextureData {
  width: number;
  height: number;
  data: Float32Array;
}

/**
 * Stroke records as two texture sets, for renderers whose textures upload one
 * array each (Three data textures). IDs below `split` are the first scene's
 * complete texture rows: its own arrays back the head textures, so they are
 * never copied. The tail holds every ID from `split` on: the first scene's
 * partial last row, then the later segments.
 */
export interface SplitStrokeTextures {
  split: number;
  head: Record<StrokeRecordField, StrokeTextureData>;
  tail: Record<StrokeRecordField, StrokeTextureData>;
}

const STROKE_RECORD_FIELDS = ["endpoints", "primitiveMeta", "primitiveBounds", "styles"] as const;

/**
 * Build split texture data. Later segments' scenes are re-pointed to views of
 * the tail data, so their records are not stored twice; the first scene's
 * arrays are only viewed, never replaced or written.
 */
export function splitStrokeTextures(records: StrokeRecords): SplitStrokeTextures {
  const first = records.segments[0];
  const headCount = Math.max(0, first?.count ?? 0);
  const headWidth = Math.max(1, Math.ceil(Math.sqrt(headCount)));
  const headRows = Math.floor(headCount / headWidth);
  const split = headWidth * headRows;
  const tailCount = Math.max(0, records.count - split);
  const tailWidth = Math.max(1, Math.ceil(Math.sqrt(tailCount)));
  const tailRows = Math.max(1, Math.ceil(tailCount / tailWidth));
  const head = {} as Record<StrokeRecordField, StrokeTextureData>;
  const tail = {} as Record<StrokeRecordField, StrokeTextureData>;
  for (const field of STROKE_RECORD_FIELDS) {
    const source = first?.scene[field];
    if (split === 0) {
      head[field] = { width: 1, height: 1, data: new Float32Array(4) };
    } else if (source && source.length >= split * 4) {
      head[field] = { width: headWidth, height: headRows, data: source.subarray(0, split * 4) };
    } else {
      // A short source cannot back the texture; copy what it has.
      const data = new Float32Array(split * 4);
      if (source) data.set(source.subarray(0, Math.min(source.length, data.length)));
      head[field] = { width: headWidth, height: headRows, data };
    }
    const data = new Float32Array(tailWidth * tailRows * 4);
    for (const segment of records.segments) {
      const from = Math.max(segment.first, split), to = segment.first + segment.count;
      if (to <= from) continue;
      const values = segment.scene[field];
      const start = (from - segment.first) * 4, end = Math.min(values.length, (to - segment.first) * 4);
      if (end > start) data.set(values.subarray(start, end), (from - split) * 4);
      if (segment !== first) segment.scene[field] = data.subarray((segment.first - split) * 4, (to - split) * 4);
    }
    tail[field] = { width: tailWidth, height: tailRows, data };
  }
  return { split, head, tail };
}
