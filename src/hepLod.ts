import { prepareVectorLodForStorage, packVectorLod, unpackVectorLod, packTextLod, unpackTextLod } from "./hepLodEncoding";
import { HepArchive } from "./hepContainer";
import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import {
  getStoredVectorStrokeLod, prebuildVectorStrokeLodRuntime, storeVectorStrokeLod, rebuildStoredVectorStrokeLodIndexes,
  type StoredVectorStrokeLod
} from "./vectorStrokeLodCore";
import { prebuildTextLod, storePrebuiltTextLod } from "./textLodCore";
import type { TextLodBuildData } from "./textGreekLod";

// Bump independently when a build algorithm or its persisted representation changes.
export const HEP_VECTOR_LOD_VERSION = 3;
export const HEP_TEXT_LOD_VERSION = 3;
export interface HepLodOptions {
  /** Embed vector LOD geometry, building it if absent; rebuild spatial indexes on load. @default false */
  withVectorLod?: boolean;
  /** Round derived positions on grids bounded by each level's tolerance. @default "compact" */
  vectorLodPrecision?: "lossless" | "compact";
  /** Embed text LOD clusters when the scene is eligible. @default false */
  withTextLod?: boolean;
}
interface LodDescriptor { version: number; file: string; precision?: "lossless" | "compact" }
export interface HepLodManifest { vector?: LodDescriptor; text?: LodDescriptor }

export async function writeHepLod(archive: HepArchive, scene: VectorScene,
  options: HepLodOptions & { signal?: AbortSignal; onProgress?: (value: number, kind: "vector-lod" | "text-lod") => void }
): Promise<HepLodManifest | undefined> {
  const result: HepLodManifest = {};
  const vector = Boolean(options.withVectorLod && scene.segmentCount > 0);
  const text = Boolean(options.withTextLod && scene.textInstanceCount > 0);
  const steps = Number(vector) + Number(text);
  if (vector) {
    options.onProgress?.(0, "vector-lod");
    let data = getStoredVectorStrokeLod(scene);
    if (!data) {
      await prebuildVectorStrokeLodRuntime(scene, "force", "webgl", {
        shouldCancel: () => options.signal?.aborted ?? false,
        onProgress: event => options.onProgress?.(event.value / steps, "vector-lod")
      });
      data = getStoredVectorStrokeLod(scene);
    }
    options.signal?.throwIfAborted();
    if (data) data = prepareVectorLodForStorage(data, (options.vectorLodPrecision ?? "compact") === "compact");
    if (data) result.vector = { ...writeData(archive, "lod-vector", HEP_VECTOR_LOD_VERSION, packVectorLod(scene, data)),
      precision: data.positionQuantum || data.positionQuanta ? "compact" : "lossless" };
    options.onProgress?.(1 / steps, "vector-lod");
  }
  if (text) {
    options.onProgress?.(Number(vector) / steps, "text-lod");
    const resultText = await prebuildTextLod(scene, { signal: options.signal,
      onProgress: event => options.onProgress?.((Number(vector) + event.value) / steps, "text-lod") });
    options.signal?.throwIfAborted();
    if (resultText.data) result.text = writeData(archive, "lod-text", HEP_TEXT_LOD_VERSION, packTextLod(resultText.data, scene, options.signal));
    options.onProgress?.(1, "text-lod");
  }
  return result.vector || result.text ? result : undefined;
}

/** Optional caches must never prevent the canonical document from opening. */
export async function readHepLod(archive: HepArchive, scene: VectorScene, metadata: unknown,
  signal?: AbortSignal): Promise<void> {
  if (metadata === undefined) return;
  if (!metadata || typeof metadata !== "object") {
    console.warn("[HEP] Invalid LOD metadata. Regenerate this HEP; LODs will be built when needed.");
    return;
  }
  for (const kind of ["vector", "text"] as const) {
    const descriptor = (metadata as HepLodManifest)[kind];
    if (descriptor === undefined) continue;
    try {
      signal?.throwIfAborted();
      const version = kind === "vector" ? HEP_VECTOR_LOD_VERSION : HEP_TEXT_LOD_VERSION;
      if (descriptor?.version !== version && descriptor?.version !== 1 && descriptor?.version !== 2) throw new Error(`stored version ${descriptor?.version}, current version ${version}`);
      const prefix = `lod-${kind}`;
      if (descriptor.file !== `${prefix}/index.json`) throw new Error("invalid cache descriptor");
      let data = await readData(archive, prefix, signal);
      if (kind === "text" && descriptor.version === 3) requireValid((data as { textEncoding?: string }).textEncoding === "predictive");
      if (kind === "vector" && descriptor.version === 3) requireValid((data as { tileIndexes?: string }).tileIndexes === "rebuild");
      if (descriptor.version >= 2) data = kind === "vector"
        ? unpackVectorLod(scene, data as Parameters<typeof unpackVectorLod>[1])
        : unpackTextLod(data as Parameters<typeof unpackTextLod>[0], scene, signal);
      if (kind === "vector") {
        validateVector(scene, data as StoredVectorStrokeLod, descriptor.version !== 3);
        if (descriptor.version === 3) data = await rebuildStoredVectorStrokeLodIndexes(scene, data as StoredVectorStrokeLod, signal);
        storeVectorStrokeLod(scene, data as StoredVectorStrokeLod);
      } else {
        if (descriptor.version === 1) {
          // v1 JSON converted the builder's exact-only Infinity sentinel to null.
          // Recover only that documented sentinel; reject other invalid numbers.
          const text = data as TextLodBuildData;
          for (const nodes of [text?.runs, text?.clusters, text?.pages]) {
            if (!Array.isArray(nodes)) continue;
            for (const node of nodes) if (node?.maxInkHeight === null && node.eligible === false) node.maxInkHeight = Infinity;
          }
        }
        if (descriptor.version === 1) {
          const text = data as TextLodBuildData;
          for (const nodes of [text?.clusters, text?.pages]) if (Array.isArray(nodes)) {
            for (const node of nodes) if (node && typeof node === "object") {
              node.inkHeightDirection ??= undefined;
              node.baselineDirection ??= undefined;
            }
          }
        }
        validateText(scene, data as TextLodBuildData);
        storePrebuiltTextLod(scene, { data: data as TextLodBuildData, fallbackReason: null, buildTimeMs: 0 });
      }
      if (descriptor.version < version) console.warn(`[HEP] Using older ${kind} LOD storage. ` +
        "Re-export or repack this HEP for smaller LOD storage; no LOD simplification is needed.");
    } catch (error) {
      signal?.throwIfAborted();
      console.warn(`[HEP] Ignoring ${kind} LOD: ${error instanceof Error ? error.message : String(error)}. ` +
        "Regenerate this HEP to use the latest LODs; they will be built when needed.");
    }
  }
}

type NumericArray = Float32Array | Float64Array | Uint32Array;

// Byte-plane storage makes both record IDs and floating point geometry compress
// well without rounding derived geometry or serializing numbers as JSON arrays.
function writeData(archive: HepArchive, prefix: string, version: number, data: object): LodDescriptor {
  let index = 0;
  const json = JSON.stringify(data, (_key, value: unknown) => {
    if (!(value instanceof Float32Array || value instanceof Float64Array || value instanceof Uint32Array)) return value;
    const file = `${prefix}/${index++}.bin`;
    const bytes = encodeArray(value);
    archive.file(file, bytes);
    return { array: value instanceof Float64Array ? "f64" : value instanceof Float32Array ? "f32" : "u32", file, length: value.length };
  });
  const file = `${prefix}/index.json`;
  archive.file(file, json);
  return { version, file };
}

function encodeArray(values: NumericArray): Uint8Array {
  const width = values.BYTES_PER_ELEMENT;
  const bytes = new Uint8Array(values.byteLength);
  const word = new DataView(new ArrayBuffer(width));
  for (let i = 0; i < values.length; i++) {
    if (values instanceof Float64Array) word.setFloat64(0, values[i], true);
    else if (values instanceof Float32Array) word.setFloat32(0, values[i], true);
    else word.setUint32(0, values[i], true);
    for (let plane = 0; plane < width; plane++) bytes[plane * values.length + i] = word.getUint8(plane);
  }
  return bytes;
}

async function readData(archive: HepArchive, prefix: string, signal?: AbortSignal): Promise<unknown> {
  const entry = archive.file(`${prefix}/index.json`);
  if (!entry) throw new Error("missing index");
  const json = await entry.async("string");
  signal?.throwIfAborted();
  const data: unknown = JSON.parse(json);
  let arrays = 0;
  async function hydrate(value: unknown, depth: number): Promise<unknown> {
    signal?.throwIfAborted();
    if (depth > 16) throw new Error("cache nesting limit exceeded");
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if ("array" in record) {
      if (++arrays > 128 || !["f32", "f64", "u32"].includes(String(record.array)) ||
          typeof record.file !== "string" || !new RegExp(`^${prefix}/[0-9]+\\.bin$`).test(record.file) ||
          !Number.isSafeInteger(record.length) || Number(record.length) < 0) throw new Error("invalid array descriptor");
      const entry = archive.file(record.file);
      if (!entry) throw new Error("missing array");
      const bytes = await entry.async("uint8array");
      signal?.throwIfAborted();
      const length = Number(record.length), width = record.array === "f64" ? 8 : 4;
      if (bytes.length !== length * width) throw new Error("invalid array length");
      const result = record.array === "f64" ? new Float64Array(length) : record.array === "f32" ? new Float32Array(length) : new Uint32Array(length);
      const word = new DataView(new ArrayBuffer(width));
      for (let i = 0; i < length; i++) {
        for (let plane = 0; plane < width; plane++) word.setUint8(plane, bytes[plane * length + i]);
        result[i] = record.array === "f64" ? word.getFloat64(0, true) : record.array === "f32" ? word.getFloat32(0, true) : word.getUint32(0, true);
      }
      return result;
    }
    for (const key of Object.keys(record)) {
      if (record[key] && typeof record[key] === "object") record[key] = await hydrate(record[key], depth + 1);
    }
    return value;
  }
  return hydrate(data, 0);
}

function requireValid(condition: unknown): asserts condition {
  if (!condition) throw new Error("invalid LOD build data");
}
function count(value: number, max = 0xffffffff): void {
  requireValid(Number.isSafeInteger(value) && value >= 0 && value <= max);
}
function bounds(value: Bounds): void {
  requireValid(value && [value.minX, value.minY, value.maxX, value.maxY].every(Number.isFinite) &&
    value.minX <= value.maxX && value.minY <= value.maxY);
}
function floats(value: Float32Array, length: number): void {
  requireValid(value instanceof Float32Array && value.length === length && value.every(Number.isFinite));
}
function ids(value: Uint32Array, length: number, limit?: number): void {
  requireValid(value instanceof Uint32Array && value.length === length);
  if (limit !== undefined) requireValid(value.every(id => id < limit));
}

function validateVector(scene: VectorScene, data: StoredVectorStrokeLod, withIndexes = true): void {
  requireValid(data && data.tileGrid && data.literals && Array.isArray(data.levels));
  const grid = data.tileGrid, literals = data.literals;
  count(grid.columns, 96); count(grid.rows, 96);
  requireValid(grid.columns > 0 && grid.rows > 0 && grid.columns * grid.rows <= 96 * 96);
  bounds(grid);
  requireValid(Number.isFinite(grid.tileWidth) && grid.tileWidth > 0 && Number.isFinite(grid.tileHeight) && grid.tileHeight > 0);
  for (const [edges, size, min, max] of [[grid.xEdges, grid.columns, grid.minX, grid.maxX],
    [grid.yEdges, grid.rows, grid.minY, grid.maxY]] as const) {
    requireValid(edges instanceof Float64Array && edges.length === size + 1 && edges[0] === min && edges[size] === max);
    requireValid(edges.every((v, i) => Number.isFinite(v) && (i === 0 || v > edges[i - 1])));
  }
  count(literals.segmentCount);
  for (const field of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"] as const) floats(literals[field], literals.segmentCount * 4);
  if (data.origins !== undefined) ids(data.origins, literals.segmentCount, scene.segmentCount);
  requireValid(!scene.drawRuns?.length || literals.segmentCount === 0 || data.origins !== undefined);
  requireValid(data.levels.length > 0 && data.levels.length <= 9);
  const tiles = grid.columns * grid.rows;
  data.levels.forEach((level, index) => {
    count(level.segmentCount, scene.segmentCount);
    bounds(level.sceneBounds);
    requireValid(Number.isFinite(level.maxHalfWidth) && level.maxHalfWidth >= 0 &&
      Number.isFinite(level.tolerance) && level.tolerance >= 0 &&
      (level.overview === undefined || typeof level.overview === "boolean"));
    if (index === 0) requireValid(level.segmentCount === scene.segmentCount && level.records === undefined && level.tolerance === 0);
    else {
      requireValid(level.tolerance > 0);
      ids(level.records!, level.segmentCount, scene.segmentCount + literals.segmentCount);
      if (data.positionQuanta) for (const id of level.records!) if (id >= scene.segmentCount) {
        requireValid(data.positionQuanta[id - scene.segmentCount] <= level.tolerance / 32);
      }
    }
    if (!withIndexes) return;
    ids(level.tileOffsets, tiles + 1); ids(level.tileCounts, tiles);
    requireValid(level.tileSegmentIds instanceof Uint32Array);
    ids(level.tileSegmentIds, level.tileSegmentIds.length, level.segmentCount);
    requireValid(level.tileOffsets[0] === 0 && level.tileOffsets[tiles] === level.tileSegmentIds.length);
    for (let i = 0; i < tiles; i++) requireValid(level.tileOffsets[i + 1] === level.tileOffsets[i] + level.tileCounts[i]);
  });
}

function validateText(scene: VectorScene, data: TextLodBuildData): void {
  requireValid(data && data.exactInstanceCount === scene.textInstanceCount && data.solidGlyphIndex === scene.textGlyphCount);
  count(data.coarseInstanceCount, scene.textInstanceCount);
  requireValid(data.combinedInstanceCount === data.exactInstanceCount + data.coarseInstanceCount);
  for (const values of [data.coarseInstanceA, data.coarseInstanceB, data.coarseInstanceC]) floats(values, data.coarseInstanceCount * 4);
  requireValid(Array.isArray(data.runs) && Array.isArray(data.clusters) && Array.isArray(data.pages));
  requireValid(data.runs.length <= scene.textInstanceCount && data.clusters.length <= data.runs.length && data.pages.length === scene.pageCount);
  for (const nodes of [data.runs, data.clusters, data.pages]) {
    let exactEnd = 0;
    for (const node of nodes) {
      count(node.pageIndex, Math.max(0, scene.pageCount - 1));
      count(node.exactStart, scene.textInstanceCount); count(node.exactCount, scene.textInstanceCount - node.exactStart);
      requireValid(node.exactStart === exactEnd);
      exactEnd += node.exactCount;
      bounds(node.bounds);
      requireValid((Number.isFinite(node.maxInkHeight) || (node.maxInkHeight === Infinity && node.eligible === false)) &&
        node.maxInkHeight >= 0 && typeof node.eligible === "boolean");
      for (const key of ["inkHeightDirection", "baselineDirection"] as const) {
        const direction = key in node ? (node as { inkHeightDirection?: number[]; baselineDirection?: number[] })[key] : undefined;
        requireValid(direction === undefined || (Array.isArray(direction) && direction.length === 2 && direction.every(Number.isFinite)));
      }
    }
    requireValid(exactEnd === scene.textInstanceCount);
  }
  let coarseEnd = 0;
  for (const run of data.runs) {
    requireValid(Array.isArray(run.transform) && run.transform.length === 6 && run.transform.every(Number.isFinite));
    requireValid(run.coarseIndex === -1 || run.coarseIndex === coarseEnd++);
  }
  requireValid(coarseEnd === data.coarseInstanceCount);
  let runEnd = 0, clusterEnd = 0;
  for (const cluster of data.clusters) {
    requireValid(cluster.runStart === runEnd); count(cluster.runCount, data.runs.length - runEnd);
    requireValid(cluster.runCount > 0); runEnd += cluster.runCount;
    count(cluster.coarseCount, data.coarseInstanceCount);
    requireValid(cluster.coarseStart === -1 || (Number.isSafeInteger(cluster.coarseStart) && cluster.coarseStart >= 0 &&
      cluster.coarseStart + cluster.coarseCount <= data.coarseInstanceCount));
  }
  requireValid(runEnd === data.runs.length);
  for (const page of data.pages) {
    requireValid(page.exactStart === scene.pageTextRanges[page.pageIndex * 2] &&
      page.exactCount === scene.pageTextRanges[page.pageIndex * 2 + 1]);
    requireValid(page.clusterStart === clusterEnd); count(page.clusterCount, data.clusters.length - clusterEnd);
    clusterEnd += page.clusterCount;
    count(page.coarseCount, data.coarseInstanceCount);
  }
  requireValid(clusterEnd === data.clusters.length);
}
