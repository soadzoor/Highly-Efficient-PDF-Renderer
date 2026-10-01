import type { VectorScene } from "./pdfVectorExtractor";
import type { StoredVectorStrokeLod } from "./vectorStrokeLodCore";
import type { TextLodBuildData } from "./textGreekLod";

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
interface PackedVector extends Omit<StoredVectorStrokeLod, "literals" | "levels"> {
  tileIndexes?: "rebuild";
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

// Text nodes used to repeat JSON keys and decimal coordinates for every run.
// Fixed Float64 columns preserve the original JS numbers (including directions
// and transforms), while byte-plane compression sees like values together.
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
interface PackedTable { count: number; columns: Float64Array }
type PackedText = Omit<TextLodBuildData, TableKind> & Record<TableKind, PackedTable>;

export function packTextLod(data: TextLodBuildData): PackedText {
  const result = { ...data } as unknown as PackedText;
  for (const kind of ["runs", "clusters", "pages"] as const) {
    const nodes = data[kind], fields = TABLE_FIELDS[kind];
    const columns = new Float64Array(nodes.length * fields.length);
    fields.forEach((path, column) => {
      const [key, child] = path.split(".");
      nodes.forEach((node, i) => {
        const object = node as unknown as Record<string, unknown>;
        const value = child === undefined ? object[key] : (object[key] as Record<string, unknown> | undefined)?.[child];
        columns[column * nodes.length + i] = value === undefined ? NaN : Number(value);
      });
    });
    result[kind] = { count: nodes.length, columns };
  }
  return result;
}

export function unpackTextLod(data: PackedText): TextLodBuildData {
  const result = { ...data } as unknown as TextLodBuildData;
  for (const kind of ["runs", "clusters", "pages"] as const) {
    const table = data?.[kind], fields = TABLE_FIELDS[kind];
    check(table && Number.isSafeInteger(table.count) && table.count >= 0 &&
      table.count <= data.exactInstanceCount + 4096 && table.columns instanceof Float64Array &&
      table.columns.length === table.count * fields.length);
    const paths = fields.map(path => path.split("."));
    const nodes: Record<string, unknown>[] = [];
    for (let i = 0; i < table.count; i++) {
      const node: Record<string, unknown> = {};
      paths.forEach(([key, child], column) => {
        const value = table.columns[column * table.count + i];
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
      });
      nodes.push(node);
    }
    (result as unknown as Record<TableKind, unknown>)[kind] = nodes;
  }
  return result;
}
function check(value: unknown): asserts value {
  if (!value) throw new Error("invalid compact LOD encoding");
}
