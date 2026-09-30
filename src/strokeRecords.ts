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
