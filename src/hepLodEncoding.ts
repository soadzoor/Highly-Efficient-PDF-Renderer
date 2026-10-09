import type { VectorScene } from "./pdfVectorExtractor";
import type { StoredVectorStrokeLod } from "./vectorStrokeLodCore";
import type { TextLodBuildData } from "./textGreekLod";
import { decodeVectorLodPointRecipes, encodeVectorLodPointRecipes, type VectorLodPointRecipes } from "./hepLodPointRecipes";

/** Legacy v2 fixed-point grid; v3 derives a grid for each literal. */
export const COMPACT_VECTOR_LOD_QUANTUM = 1 / 512;

/** Round derived geometry using the finest level that references each record.
 * A power-of-two grid <= tolerance/32 bounds displacement to sqrt(2)*tolerance/64.
 * Existing v3 rounding is retained on re-export; canonical geometry is never rounded.
 */
export function compactVectorLod(data: StoredVectorStrokeLod): StoredVectorStrokeLod {
  if (data.positionQuanta) return data;
  const count = data.literals.segmentCount;
  const quanta = new Float32Array(count).fill(Infinity);
  const canonicalCount = data.levels[0].segmentCount;
  for (const level of data.levels) {
    const q = 2 ** Math.floor(Math.log2(level.tolerance / 32));
    if (!(q > 0)) continue;
    for (const id of level.records ?? []) if (id >= canonicalCount) {
      quanta[id - canonicalCount] = Math.min(quanta[id - canonicalCount], q);
    }
  }
  const endpoints = data.literals.endpoints.slice(), primitiveMeta = data.literals.primitiveMeta.slice();
  const primitiveBounds = data.literals.primitiveBounds.slice();
  for (let record = 0; record < count; record++) {
    if (!Number.isFinite(quanta[record])) quanta[record] = COMPACT_VECTOR_LOD_QUANTUM;
    const q = quanta[record];
    for (const values of [endpoints, primitiveMeta]) for (let c = 0; c < (values === primitiveMeta ? 2 : 4); c++) {
      const i = record * 4 + c, integer = Math.round(values[i] / q);
      if (!Number.isSafeInteger(integer) || integer < -0x80000000 || integer > 0x7fffffff) {
        console.warn("[HEP] Compact vector LOD coordinates exceed the integer range; keeping existing LOD geometry.");
        return data;
      }
      values[i] = integer === 0 ? 0 : integer * q;
    }
    const i = record * 4;
    const clipped = (Math.floor(primitiveMeta[i + 3] / 2 + 1e-6) & 4) !== 0;
    if (!clipped) for (let axis = 0; axis < 2; axis++) {
      primitiveBounds[i + axis] = Math.min(endpoints[i + axis], endpoints[i + axis + 2], primitiveMeta[i + axis]);
      primitiveBounds[i + axis + 2] = Math.max(endpoints[i + axis], endpoints[i + axis + 2], primitiveMeta[i + axis]);
    }
  }
  const { positionQuantum: _legacyQuantum, ...rest } = data;
  return { ...rest, positionQuanta: quanta,
    literals: { ...data.literals, endpoints, primitiveMeta, primitiveBounds },
    levels: data.levels.map((level, index) => {
      if (index === 0) return level;
      let margin = 0;
      for (const id of level.records ?? []) if (id >= canonicalCount) margin = Math.max(margin, quanta[id - canonicalCount] / 2);
      return { ...level, tolerance: level.tolerance + Math.SQRT2 * margin, sceneBounds: { minX: level.sceneBounds.minX - margin, minY: level.sceneBounds.minY - margin,
        maxX: level.sceneBounds.maxX + margin, maxY: level.sceneBounds.maxY + margin } };
    }) };
}

/** Share bit-identical records, including paint origins. Hash collisions are compared exactly. */
export function deduplicateVectorLod(data: StoredVectorStrokeLod): StoredVectorStrokeLod {
  const count = data.literals.segmentCount, canonicalCount = data.levels[0].segmentCount;
  const views = FIELDS.map(field => words(data.literals[field]));
  const heads = new Map<number, number>(), next = new Int32Array(count).fill(-1);
  const remap = new Uint32Array(count), unique: number[] = [];
  for (let i = 0; i < count; i++) {
    let hash = 2166136261;
    for (const view of views) for (let c = 0; c < 4; c++) hash = Math.imul(hash ^ view[i * 4 + c], 16777619);
    hash = Math.imul(hash ^ (data.origins?.[i] ?? 0), 16777619);
    let match = -1;
    for (let candidate = heads.get(hash) ?? -1; candidate >= 0; candidate = next[candidate]) {
      if (data.origins?.[i] === data.origins?.[candidate] && views.every(view =>
        view[i * 4] === view[candidate * 4] && view[i * 4 + 1] === view[candidate * 4 + 1] &&
        view[i * 4 + 2] === view[candidate * 4 + 2] && view[i * 4 + 3] === view[candidate * 4 + 3])) {
        match = candidate; break;
      }
    }
    if (match >= 0) remap[i] = remap[match];
    else { remap[i] = unique.length; unique.push(i); next[i] = heads.get(hash) ?? -1; heads.set(hash, i); }
  }
  if (unique.length === count) return data;
  const literals = { segmentCount: unique.length } as StoredVectorStrokeLod["literals"];
  FIELDS.forEach((field, f) => {
    const output = new Uint32Array(unique.length * 4);
    unique.forEach((id, i) => output.set(views[f].subarray(id * 4, id * 4 + 4), i * 4));
    literals[field] = new Float32Array(output.buffer);
  });
  const result = { ...data, literals, levels: data.levels.map(level => level.records ? { ...level,
    records: level.records.map(id => id < canonicalCount ? id : canonicalCount + remap[id - canonicalCount]) } : level) };
  if (data.origins) result.origins = Uint32Array.from(unique, id => data.origins![id]);
  if (data.positionQuanta) {
    result.positionQuanta = new Float32Array(unique.length).fill(Infinity);
    for (let i = 0; i < count; i++) result.positionQuanta[remap[i]] = Math.min(result.positionQuanta[remap[i]], data.positionQuanta[i]);
  }
  return result;
}

/** The same preparation is used by export and verified offline repacking. */
export function prepareVectorLodForStorage(data: StoredVectorStrokeLod, compact = false): StoredVectorStrokeLod {
  const shared = deduplicateVectorLod(data);
  return compact ? deduplicateVectorLod(compactVectorLod(shared)) : shared;
}

const FIELDS = ["endpoints", "primitiveMeta", "primitiveBounds", "styles"] as const;
type Field = typeof FIELDS[number];
export interface PackedVector extends Omit<StoredVectorStrokeLod, "literals" | "levels"> {
  tileIndexes?: "rebuild";
  pointRecipes?: VectorLodPointRecipes;
  levels: (Omit<StoredVectorStrokeLod["levels"][number], "tileOffsets" | "tileCounts" | "tileSegmentIds"> &
    Partial<Pick<StoredVectorStrokeLod["levels"][number], "tileOffsets" | "tileCounts" | "tileSegmentIds">>)[];
  literals: { segmentCount: number } & Record<Field, Uint32Array>;
}

/** Word residuals for lossless data, fixed-point deltas for explicitly compact positions. */
export function packVectorLod(scene: VectorScene, data: StoredVectorStrokeLod, includeIndexes = false): PackedVector {
  const count = data.literals.segmentCount;
  const literals = { segmentCount: count } as PackedVector["literals"];
  for (const field of FIELDS) {
    const source = words(data.literals[field]), canonical = words(scene[field]);
    const output = new Uint32Array(source.length);
    const metaWords = field === "endpoints" ? words(data.literals.primitiveMeta) : undefined;
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < 4; c++) {
        output[c * count + i] = isCompactPosition(data, field, c)
          ? (Math.round(data.literals[field][i * 4 + c] / quantumAt(data, i)) -
            positionPredictor(scene, data, field, i, c)) >>> 0
          : source[i * 4 + c] ^ predictor(field, i, c, canonical, data, metaWords);
      }
    }
    literals[field] = output;
  }
  return { ...data, literals, ...(!includeIndexes ? { tileIndexes: "rebuild" as const } : {}),
    levels: includeIndexes ? data.levels : data.levels.map(({ tileOffsets: _offsets, tileCounts: _counts, tileSegmentIds: _ids, ...level }) => level) };
}

/** Dependencies decode before their residual consumers; canonical arrays stay untouched. */
export function unpackVectorLod(scene: VectorScene, data: PackedVector): StoredVectorStrokeLod {
  data = decodeVectorLodPointRecipes(scene, data);
  const count = data?.literals?.segmentCount;
  check(data.positionQuantum === undefined || data.positionQuantum === COMPACT_VECTOR_LOD_QUANTUM);
  check(Number.isSafeInteger(count) && count >= 0 && count <= 0x3fffffff);
  if (data.positionQuanta !== undefined) check(data.positionQuantum === undefined && data.positionQuanta instanceof Float32Array &&
    data.positionQuanta.length === count && data.positionQuanta.every(q => Number.isFinite(q) && q > 0 && Number.isInteger(Math.log2(q))));
  if (data.origins !== undefined) check(data.origins instanceof Uint32Array && data.origins.length === count &&
    data.origins.every(id => id < scene.segmentCount));
  for (const field of FIELDS) check(data.literals[field] instanceof Uint32Array && data.literals[field].length === count * 4);
  const { tileIndexes: _indexes, ...rest } = data;
  const result: StoredVectorStrokeLod = { ...rest, levels: data.levels.map(level => ({ ...level,
    tileOffsets: level.tileOffsets ?? new Uint32Array(), tileCounts: level.tileCounts ?? new Uint32Array(),
    tileSegmentIds: level.tileSegmentIds ?? new Uint32Array() })),
    literals: { segmentCount: count } as StoredVectorStrokeLod["literals"] };
  for (const field of ["primitiveMeta", "endpoints", "primitiveBounds", "styles"] as const) {
    const residuals = data.literals[field], canonical = words(scene[field]);
    const output = new Uint32Array(count * 4);
    const metaWords = field === "endpoints" ? words(result.literals.primitiveMeta) : undefined;
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < 4; c++) {
        if (isCompactPosition(result, field, c)) {
          predictionFloat[0] = ((residuals[c * count + i] + positionPredictor(scene, result, field, i, c)) | 0) * quantumAt(result, i);
          output[i * 4 + c] = predictionWord[0];
        } else output[i * 4 + c] = residuals[c * count + i] ^ predictor(field, i, c, canonical, result, metaWords);
      }
    }
    result.literals[field] = new Float32Array(output.buffer);
  }
  return result;
}

/** Existing packed caches can adopt source-point recipes without rebuilding any level. */
export async function packVectorLodWithPointRecipes(scene: VectorScene, data: PackedVector, signal?: AbortSignal): Promise<PackedVector> {
  return encodeVectorLodPointRecipes(scene, data, signal);
}

function quantumAt(data: StoredVectorStrokeLod, index: number): number {
  return data.positionQuanta?.[index] ?? data.positionQuantum!;
}
function isCompactPosition(data: StoredVectorStrokeLod, field: Field, channel: number): boolean {
  return (data.positionQuantum !== undefined || data.positionQuanta !== undefined) && (field === "endpoints" || (field === "primitiveMeta" && channel < 2));
}
function positionPredictor(scene: VectorScene, data: StoredVectorStrokeLod, field: Field, index: number, channel: number): number {
  const value = field === "endpoints" && channel >= 2 ? data.literals.primitiveMeta[index * 4 + channel - 2]
    : data.origins ? scene[field][data.origins[index] * 4 + channel] : 0;
  return Math.round(value / quantumAt(data, index)) | 0;
}

// Reuse one word for numeric bounds predictions. Other predictors use integer
// views, preserving even signed zero exactly through the XOR residual.
const predictionFloat = new Float32Array(1);
const predictionWord = new Uint32Array(predictionFloat.buffer);
function predictor(field: Field, index: number, channel: number, canonical: Uint32Array, data: StoredVectorStrokeLod, metaWords?: Uint32Array): number {
  const at = index * 4;
  if (field === "endpoints" && channel >= 2) return metaWords![at + channel - 2];
  if (field === "primitiveBounds") {
    const axis = channel % 2;
    const start = data.literals.endpoints[at + axis], end = data.literals.primitiveMeta[at + axis];
    predictionFloat[0] = channel < 2 ? Math.min(start, end) : Math.max(start, end);
    return predictionWord[0];
  }
  return data.origins ? canonical[data.origins[index] * 4 + channel] : 0;
}
function words(values: Float32Array): Uint32Array {
  return new Uint32Array(values.buffer, values.byteOffset, values.length);
}

// v2 stores Float64 columns. v3 predicts derived numbers from canonical glyph
// ranges and child nodes, then stores exact IEEE-754 XOR corrections. Source
// glyphs are visited once; this does not repeat the LOD grouping algorithm.
const BOUNDS = ["bounds.minX", "bounds.minY", "bounds.maxX", "bounds.maxY"];
const DIRECTIONS = ["inkHeightDirection.0", "inkHeightDirection.1", "baselineDirection.0", "baselineDirection.1"];
const TABLE_FIELDS = {
  runs: ["exactStart", "exactCount", "coarseIndex", "pageIndex", ...BOUNDS,
    ...Array.from({ length: 6 }, (_, i) => `transform.${i}`), "maxInkHeight", "eligible"],
  clusters: ["pageIndex", "runStart", "runCount", "exactStart", "exactCount", "coarseStart", "coarseCount",
    ...BOUNDS, "maxInkHeight", ...DIRECTIONS, "eligible"],
  pages: ["pageIndex", "clusterStart", "clusterCount", "exactStart", "exactCount", "coarseCount",
    ...BOUNDS, "maxInkHeight", ...DIRECTIONS, "eligible"]
} as const;
type TableKind = keyof typeof TABLE_FIELDS;
const COARSE_FIELDS = ["coarseInstanceA", "coarseInstanceB", "coarseInstanceC"] as const;
type CoarseField = typeof COARSE_FIELDS[number];
interface PackedTable { count: number; columns: Float64Array | Uint32Array }
type PackedText = Omit<TextLodBuildData, TableKind | CoarseField> & Record<TableKind, PackedTable> &
  Record<CoarseField, Float32Array | Uint32Array> & { textEncoding?: "predictive" };
type TextNode = Record<string, unknown>;
const textWord = new DataView(new ArrayBuffer(8));

function setTextWord(value: number): void {
  if (Number.isNaN(value)) {
    // Optional directions use one portable NaN sentinel, independently of the
    // engine's arithmetic NaN payload or the host's native byte order.
    textWord.setUint32(0, 0, true);
    textWord.setUint32(4, 0x7ff80000, true);
  } else textWord.setFloat64(0, value, true);
}

function textField(node: TextNode, path: string): number {
  const [key, child] = path.split(".");
  const value = child === undefined ? node[key] : (node[key] as Record<string, unknown> | undefined)?.[child];
  return value === undefined ? NaN : Number(value);
}

export function packTextLod(data: TextLodBuildData, scene: VectorScene, signal?: AbortSignal): PackedText {
  const result = { ...data, textEncoding: "predictive" } as unknown as PackedText;
  for (const kind of ["runs", "clusters", "pages"] as const) {
    const nodes = data[kind], fields = TABLE_FIELDS[kind];
    const columns = new Uint32Array(nodes.length * fields.length * 2);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i] as unknown as TextNode;
      signal?.throwIfAborted();
      const prediction = predictTextNode(scene, data, kind, node, i, signal);
      fields.forEach((path, column) => {
        setTextWord(textField(prediction, path));
        const low = textWord.getUint32(0, true), high = textWord.getUint32(4, true);
        setTextWord(textField(node, path));
        columns[column * 2 * nodes.length + i] = textWord.getUint32(0, true) ^ low;
        columns[(column * 2 + 1) * nodes.length + i] = textWord.getUint32(4, true) ^ high;
      });
    }
    result[kind] = { count: nodes.length, columns };
  }
  const predictions = predictCoarseInstances(scene, data, signal);
  COARSE_FIELDS.forEach((field, f) => {
    const source = words(data[field]), predicted = words(predictions[f]);
    const residuals = new Uint32Array(source.length);
    for (let i = 0; i < data.coarseInstanceCount; i++) for (let c = 0; c < 4; c++) {
      residuals[c * data.coarseInstanceCount + i] = source[i * 4 + c] ^ predicted[i * 4 + c];
    }
    result[field] = residuals;
  });
  return result;
}

export function unpackTextLod(data: PackedText, scene?: VectorScene, signal?: AbortSignal): TextLodBuildData {
  const predictive = data.textEncoding === "predictive";
  check(data.textEncoding === undefined || predictive);
  if (predictive) {
    check(scene && data.exactInstanceCount === scene.textInstanceCount &&
      Number.isSafeInteger(data.coarseInstanceCount) && data.coarseInstanceCount >= 0 &&
      data.coarseInstanceCount <= data.exactInstanceCount &&
      data.combinedInstanceCount === data.exactInstanceCount + data.coarseInstanceCount &&
      data.solidGlyphIndex === scene.textGlyphCount);
    for (const field of COARSE_FIELDS) check(data[field] instanceof Uint32Array &&
      data[field].length === data.coarseInstanceCount * 4);
  }
  const { textEncoding: _encoding, ...rest } = data;
  const result = { ...rest } as unknown as TextLodBuildData;
  for (const kind of ["runs", "clusters", "pages"] as const) {
    const table = data?.[kind], fields = TABLE_FIELDS[kind];
    check(table && Number.isSafeInteger(table.count) && table.count >= 0 &&
      table.count <= data.exactInstanceCount + 4096 &&
      (predictive ? table.columns instanceof Uint32Array : table.columns instanceof Float64Array) &&
      table.columns.length === table.count * fields.length * (predictive ? 2 : 1));
    if (predictive) check(table.count <= (kind === "runs" ? data.exactInstanceCount :
      kind === "clusters" ? result.runs.length : scene!.pageCount));
    if (predictive && kind === "pages") check(table.count === scene!.pageCount);
    const nodes: TextNode[] = [];
    (result as unknown as Record<TableKind, unknown>)[kind] = nodes;
    // Decode source ranges first so prediction work is bounded before visiting
    // glyphs or children. Other fields remain in their existing column order.
    const firstFields = kind === "runs" ? [0, 1, 2] : [1, 2];
    for (let i = 0; i < table.count; i++) {
      signal?.throwIfAborted();
      const node: TextNode = {};
      const decode = (column: number, prediction: TextNode) => {
        const path = fields[column];
        let value = table.columns[column * table.count + i];
        if (predictive) {
          setTextWord(textField(prediction, path));
          const low = textWord.getUint32(0, true), high = textWord.getUint32(4, true);
          textWord.setUint32(0, table.columns[column * 2 * table.count + i] ^ low, true);
          textWord.setUint32(4, table.columns[(column * 2 + 1) * table.count + i] ^ high, true);
          value = textWord.getFloat64(0, true);
        }
        assignTextField(node, path, value);
      };
      if (predictive) {
        const initial = initialTextPrediction(result, kind, i);
        firstFields.forEach(column => decode(column, initial));
        validatePredictionRange(result, kind, node);
        const prediction = predictTextNode(scene!, result, kind, node, i, signal);
        if (kind === "runs") {
          for (let column = 8; column < 14; column++) decode(column, prediction);
          prediction.bounds = textTransformBounds(node.transform as number[]);
          for (const column of [3, 4, 5, 6, 7, 14, 15]) decode(column, prediction);
        } else fields.forEach((_path, column) => { if (!firstFields.includes(column)) decode(column, prediction); });
      } else fields.forEach((_path, column) => decode(column, {}));
      nodes.push(node);
    }
  }
  if (predictive) {
    const predictions = predictCoarseInstances(scene!, result, signal);
    COARSE_FIELDS.forEach((field, f) => {
      const residuals = data[field];
      check(residuals instanceof Uint32Array && residuals.length === data.coarseInstanceCount * 4);
      const predicted = words(predictions[f]);
      for (let i = 0; i < data.coarseInstanceCount; i++) for (let c = 0; c < 4; c++) {
        predicted[i * 4 + c] ^= residuals[c * data.coarseInstanceCount + i];
      }
      (result as unknown as Record<CoarseField, Float32Array>)[field] = predictions[f];
    });
  }
  return result;
}

function assignTextField(node: TextNode, path: string, value: number): void {
  const [key, child] = path.split(".");
  if (key === "inkHeightDirection" || key === "baselineDirection") {
    if (Number.isNaN(value)) { check(node[key] === undefined); node[key] = undefined; return; }
    if (child === "1") check(node[key] !== undefined);
  }
  check(Number.isFinite(value) || (key === "maxInkHeight" && value === Infinity));
  if (key === "eligible") { check(value === 0 || value === 1); node[key] = value === 1; }
  else if (child === undefined) node[key] = value;
  else {
    const parent = (node[key] ??= key === "bounds" ? {} : []) as Record<string, number>;
    parent[child] = value;
  }
}

function initialTextPrediction(data: TextLodBuildData, kind: TableKind, index: number): TextNode {
  const previous = data[kind][index - 1] as unknown as TextNode | undefined;
  return { exactStart: previous ? Number(previous.exactStart) + Number(previous.exactCount) : 0,
    exactCount: 0, coarseIndex: 0,
    runStart: previous ? Number(previous.runStart) + Number(previous.runCount) : 0, runCount: 0,
    clusterStart: previous ? Number(previous.clusterStart) + Number(previous.clusterCount) : 0, clusterCount: 0 };
}

function validatePredictionRange(data: TextLodBuildData, kind: TableKind, node: TextNode): void {
  const start = Number(node[kind === "runs" ? "exactStart" : kind === "clusters" ? "runStart" : "clusterStart"]);
  const count = Number(node[kind === "runs" ? "exactCount" : kind === "clusters" ? "runCount" : "clusterCount"]);
  const children = kind === "runs" ? data.exactInstanceCount : kind === "clusters" ? data.runs.length : data.clusters.length;
  check(Number.isSafeInteger(start) && start >= 0 && Number.isSafeInteger(count) && count >= 0 && start + count <= children);
  const nodes = data[kind], previous = nodes[nodes.length - 1] as unknown as TextNode | undefined;
  const end = previous ? Number(previous[kind === "runs" ? "exactStart" : kind === "clusters" ? "runStart" : "clusterStart"]) +
    Number(previous[kind === "runs" ? "exactCount" : kind === "clusters" ? "runCount" : "clusterCount"]) : 0;
  check(start === end && (kind === "pages" || count > 0));
  if (kind === "runs") check(Number.isSafeInteger(node.coarseIndex) && Number(node.coarseIndex) >= -1 &&
    Number(node.coarseIndex) < data.coarseInstanceCount);
}

function predictTextNode(scene: VectorScene, data: TextLodBuildData, kind: TableKind, node: TextNode, index: number, signal?: AbortSignal): TextNode {
  const prediction = Object.fromEntries(TABLE_FIELDS[kind].filter(path => !path.includes(".")).map(key => [key, 0])) as TextNode;
  Object.assign(prediction, initialTextPrediction(data, kind, index));
  if (kind === "runs") {
    const transform = [0, 0, 0, 0, 0, 0];
    let maxInkHeight = Infinity;
    if (Number(node.coarseIndex) >= 0) {
      const start = Number(node.exactStart), end = start + Number(node.exactCount), at = start * 4;
      const a = scene.textInstanceA[at], b = scene.textInstanceA[at + 1], c = scene.textInstanceA[at + 2], d = scene.textInstanceA[at + 3];
      const x = scene.textInstanceB[at], y = scene.textInstanceB[at + 1], inverse = 1 / (a * d - b * c);
      let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
      maxInkHeight = 0;
      for (let glyph = start; glyph < end; glyph++) {
        if ((glyph & 4095) === 0) signal?.throwIfAborted();
        const offset = glyph * 4, meta = Math.trunc(scene.textInstanceB[offset + 2]) * 4;
        const dx = scene.textInstanceB[offset] - x, dy = scene.textInstanceB[offset + 1] - y;
        // Match the builder's first-glyph path: do not add a computed zero,
        // which can change signed zero or produce NaN for degenerate matrices.
        const u = glyph === start ? 0 : (d * dx - c * dy) * inverse;
        const v = glyph === start ? 0 : (a * dy - b * dx) * inverse;
        const lowU = scene.textGlyphMetaA[meta + 2], lowV = scene.textGlyphMetaA[meta + 3];
        const highU = scene.textGlyphMetaB[meta], highV = scene.textGlyphMetaB[meta + 1];
        minU = Math.min(minU, glyph === start ? lowU : lowU + u);
        minV = Math.min(minV, glyph === start ? lowV : lowV + v);
        maxU = Math.max(maxU, glyph === start ? highU : highU + u);
        maxV = Math.max(maxV, glyph === start ? highV : highV + v);
        // Basic arithmetic is deterministic across JS engines. Math.hypot
        // may differ in its last bit, so use this exact axis-aligned predictor
        // and retain XOR corrections for rotated glyph heights.
        maxInkHeight = Math.max(maxInkHeight, (highV - lowV) *
          (Math.abs(scene.textInstanceA[offset + 2]) + Math.abs(scene.textInstanceA[offset + 3])));
      }
      const width = maxU - minU, height = maxV - minV;
      transform.splice(0, 6, a * width, b * width, c * height, d * height,
        a * minU + c * minV + x, b * minU + d * minV + y);
    }
    prediction.transform = transform;
    prediction.bounds = textTransformBounds((node.transform as number[] | undefined) ?? transform);
    prediction.maxInkHeight = maxInkHeight;
    prediction.eligible = Number(node.coarseIndex) >= 0;
  } else {
    const children = kind === "clusters" ? data.runs : data.clusters;
    const start = Number(node[kind === "clusters" ? "runStart" : "clusterStart"]);
    const end = start + Number(node[kind === "clusters" ? "runCount" : "clusterCount"]);
    const first = children[start];
    prediction.pageIndex = kind === "pages" ? index : first?.pageIndex ?? 0;
    prediction.exactStart = first?.exactStart ?? prediction.exactStart;
    prediction.exactCount = 0;
    prediction.coarseStart = first && "coarseIndex" in first ? first.coarseIndex : -1;
    prediction.coarseCount = 0;
    prediction.maxInkHeight = 0;
    prediction.eligible = end > start;
    let bounds: { minX: number; minY: number; maxX: number; maxY: number } | undefined;
    if (kind === "pages") {
      const at = index * 4;
      bounds = { minX: Math.min(scene.pageRects[at], scene.pageRects[at + 2]), minY: Math.min(scene.pageRects[at + 1], scene.pageRects[at + 3]),
        maxX: Math.max(scene.pageRects[at], scene.pageRects[at + 2]), maxY: Math.max(scene.pageRects[at + 1], scene.pageRects[at + 3]) };
      if (!Object.values(bounds).every(Number.isFinite)) bounds = { ...scene.bounds };
      prediction.exactStart = scene.pageTextRanges[index * 2];
      prediction.exactCount = scene.pageTextRanges[index * 2 + 1];
    }
    for (let i = start; i < end; i++) {
      const child = children[i];
      if (kind === "clusters") prediction.exactCount = Number(prediction.exactCount) + child.exactCount;
      prediction.coarseCount = Number(prediction.coarseCount) + ("coarseIndex" in child ? Number(child.eligible) : child.coarseCount);
      prediction.maxInkHeight = Math.max(Number(prediction.maxInkHeight), child.maxInkHeight);
      prediction.eligible = Boolean(prediction.eligible) && child.eligible;
      bounds = bounds ? { minX: Math.min(bounds.minX, child.bounds.minX), minY: Math.min(bounds.minY, child.bounds.minY),
        maxX: Math.max(bounds.maxX, child.bounds.maxX), maxY: Math.max(bounds.maxY, child.bounds.maxY) } : { ...child.bounds };
    }
    prediction.bounds = bounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  return prediction;
}

function textTransformBounds(transform: readonly number[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const [a, b, c, d, x, y] = transform;
  return { minX: Math.min(x, a + x, c + x, a + c + x), minY: Math.min(y, b + y, d + y, b + d + y),
    maxX: Math.max(x, a + x, c + x, a + c + x), maxY: Math.max(y, b + y, d + y, b + d + y) };
}

function predictCoarseInstances(scene: VectorScene, data: TextLodBuildData, signal?: AbortSignal): Float32Array[] {
  const result = COARSE_FIELDS.map(() => new Float32Array(data.coarseInstanceCount * 4));
  for (const run of data.runs) if (run.coarseIndex >= 0) {
    signal?.throwIfAborted();
    const at = run.coarseIndex * 4;
    check(run.coarseIndex < data.coarseInstanceCount);
    result[0].set(run.transform.slice(0, 4), at);
    result[1].set([run.transform[4], run.transform[5], 0, 0], at);
    result[2].set(scene.textInstanceC.subarray(run.exactStart * 4, run.exactStart * 4 + 4), at);
  }
  return result;
}

function check(value: unknown): asserts value {
  if (!value) throw new Error("invalid compact LOD encoding");
}
