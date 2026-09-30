import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import type { StrokeRecords } from "./strokeRecords";
import {
  explicitStrokePaintOrigins, hasStrokePaintOrigins, setStrokePaintOrigins, strokePaintOrigin, strokePaintOrigins
} from "./vectorStrokePaintOrder";

const STROKE_FIELDS = ["endpoints", "primitiveMeta", "primitiveBounds", "styles"] as const;

/**
 * Stroke records shared by every level of one Vector LOD hierarchy. Storage ID
 * `id < canonical.segmentCount` addresses the canonical scene; larger IDs
 * address `literals` at `id - canonical.segmentCount`. A literal is a derived
 * record that differs from the canonical stroke at its paint origin: unchanged
 * strokes are referenced, never copied. @internal
 */
export interface VectorStrokeLodRecordStore {
  canonical: VectorScene;
  /** LOD-only records, with paint origins when the canonical scene has them. */
  literals: VectorScene;
}

/** Level fields that address stroke records. */
interface StrokeLodStorageLevel {
  segmentCount: number;
  /** Store-backed levels: storage ID per record (absent for the canonical level). */
  records?: Uint32Array;
  store?: VectorStrokeLodRecordStore;
  /** Caller-built levels carry their own records. Never read on store-backed levels. */
  scene?: VectorScene;
}

/** Store-backed level fields needed to reproduce its standalone scene. */
interface StoredStrokeLodLevel {
  segmentCount: number;
  records: Uint32Array;
  store: VectorStrokeLodRecordStore;
  sceneBounds: Bounds;
  maxHalfWidth: number;
}

/**
 * One ID space for every level: canonical strokes first, then the LOD-only
 * parts. Levels with the same stroke therefore select the same ID. @internal
 */
export interface VectorStrokeLodStorageLayout {
  canonical: VectorScene;
  count: number;
  /** LOD-only records in storage order, each starting at its base ID. */
  parts: readonly { base: number; scene: VectorScene }[];
  /** Storage IDs of each store-backed level; null levels use `bases[level] + id`. */
  records: readonly (Uint32Array | null)[];
  bases: readonly number[];
}

interface CombinedStrokeLodStorage {
  scene: VectorScene;
  layout: VectorStrokeLodStorageLayout;
}

const layouts = new WeakMap<readonly StrokeLodStorageLevel[], VectorStrokeLodStorageLayout>();
const combinedStores = new WeakMap<readonly StrokeLodStorageLevel[], CombinedStrokeLodStorage>();
const textureData = new WeakMap<Float32Array, Float32Array>();
const materializedLevels = new WeakMap<Uint32Array, VectorScene>();

/** A texture-ready immutable view, available only for owned combined stores. */
export function sharedVectorStrokeLodTextureData(source: Float32Array): Float32Array | undefined {
  return textureData.get(source);
}

/**
 * Storage IDs for a hierarchy. Built hierarchies share one record store whose
 * literals follow the canonical strokes. Caller-built levels without a store
 * are appended in level order, which reproduces the original combined layout.
 */
export function vectorStrokeLodStorageLayout(
  canonical: VectorScene, levels: readonly StrokeLodStorageLevel[]
): VectorStrokeLodStorageLayout {
  const cached = layouts.get(levels);
  if (cached) return cached;
  const canonicalCount = Math.max(0, canonical.segmentCount | 0);
  const parts: { base: number; scene: VectorScene }[] = [];
  let count = canonicalCount;
  const include = (scene: VectorScene, recordCount: number): void => {
    if (recordCount <= 0) return;
    parts.push({ base: count, scene });
    count += recordCount;
  };
  // Store records are absolute IDs, so its literals must start right after
  // the canonical strokes, before any caller-built level.
  const store = levels.find(level => level.store)?.store;
  if (store) {
    if (store.canonical !== canonical) throw new Error("Vector LOD store belongs to a different scene.");
    include(store.literals, Math.max(0, store.literals.segmentCount | 0));
  }
  const records: (Uint32Array | null)[] = [];
  const bases: number[] = [];
  levels.forEach((level, index) => {
    if (level.store) {
      if (level.store !== store) throw new Error("Vector LOD levels belong to different hierarchies.");
      records.push(level.records ?? null);
      bases.push(0);
      return;
    }
    records.push(null);
    if (index === 0 && level.scene === canonical) {
      bases.push(0);
      return;
    }
    bases.push(count);
    include(level.scene!, Math.max(0, level.segmentCount | 0));
  });
  const layout = { canonical, count, parts, records, bases };
  layouts.set(levels, layout);
  return layout;
}

/** Every storage ID's record, read in place from the canonical scene and each part. */
export function vectorStrokeLodStorageRecords(layout: VectorStrokeLodStorageLayout): StrokeRecords {
  const segments = [{ first: 0, count: Math.max(0, layout.canonical.segmentCount | 0), scene: layout.canonical }];
  layout.parts.forEach((part, index) => segments.push({
    first: part.base, count: (layout.parts[index + 1]?.base ?? layout.count) - part.base, scene: part.scene
  }));
  return { count: layout.count, segments };
}

/** Source paint origin of every storage ID, or undefined without paint metadata. */
export function vectorStrokeLodStorageOrigins(layout: VectorStrokeLodStorageLayout): Uint32Array | undefined {
  const canonical = layout.canonical, canonicalCount = Math.max(0, canonical.segmentCount | 0);
  if (!hasStrokePaintOrigins(canonical)) return undefined;
  const origins = new Uint32Array(layout.count);
  // Canonical scenes are their own origins unless they carry explicit ones.
  const explicit = explicitStrokePaintOrigins(canonical);
  if (explicit) origins.set(explicit.subarray(0, canonicalCount));
  else for (let id = 0; id < canonicalCount; id++) origins[id] = id;
  for (const part of layout.parts) origins.set(strokePaintOrigins(part.scene)!, part.base);
  return origins;
}

/**
 * Immutable stroke storage shared by LOD selection and ordered rendering:
 * canonical strokes followed by LOD-only records, in storage-ID order. Store
 * literals and caller-built levels become views into this store, instead of
 * retaining a second copy of every derived record. Keep the caller's canonical
 * scene and its arrays untouched: picking, exports, and independent viewers
 * own that identity. Temporary colors belong to renderer-owned textures.
 */
export function getCombinedVectorStrokeLodStorage(
  canonicalScene: VectorScene, levels: readonly StrokeLodStorageLevel[]
): CombinedStrokeLodStorage {
  const cached = combinedStores.get(levels);
  if (cached) return cached;
  const layout = vectorStrokeLodStorageLayout(canonicalScene, levels);
  if (layout.parts.length === 0) {
    const storage = { scene: canonicalScene, layout };
    combinedStores.set(levels, storage);
    return storage;
  }
  const count = layout.count;
  const canonicalCount = Math.max(0, canonicalScene.segmentCount | 0);
  const scene = { ...canonicalScene, segmentCount: count };
  // Match Three's square texture layout. One partial row of zeroes lets it
  // upload this immutable store directly instead of retaining four padded copies.
  const width = Math.max(1, Math.ceil(Math.sqrt(count)));
  const paddedCount = width * Math.max(1, Math.ceil(count / width));
  // Rebase one field at a time so each old LOD-only allocation can be
  // collected before allocating the next combined field. Preserve every bit.
  for (const key of STROKE_FIELDS) {
    const data = new Float32Array(paddedCount * 4);
    const values = data.subarray(0, count * 4);
    textureData.set(values, data);
    const canonical = canonicalScene[key];
    values.set(canonical.subarray(0, Math.min(canonical.length, canonicalCount * 4)));
    layout.parts.forEach((part, index) => {
      const end = layout.parts[index + 1]?.base ?? count;
      values.set(part.scene[key].subarray(0, (end - part.base) * 4), part.base * 4);
      part.scene[key] = values.subarray(part.base * 4, end * 4);
    });
    scene[key] = values;
  }
  const storage = { scene, layout };
  combinedStores.set(levels, storage);
  return storage;
}

/**
 * The canonical scene of a level, its caller-built scene, or a standalone copy
 * of a store-backed level. Copies are made once per level; uploads that only
 * need a temporary copy use vectorStrokeLodLevelUploadScene instead.
 */
export function vectorStrokeLodLevelScene(level: StrokeLodStorageLevel & Partial<StoredStrokeLodLevel>): VectorScene {
  if (!level.store) return level.scene!;
  if (!level.records) return level.store.canonical;
  let scene = materializedLevels.get(level.records);
  if (!scene) {
    scene = materializeVectorStrokeLodLevel(level as StoredStrokeLodLevel);
    materializedLevels.set(level.records, scene);
  }
  return scene;
}

/**
 * A level scene for a one-time upload. Store-backed levels receive a temporary
 * copy, so renderers that upload levels separately retain only their textures.
 */
export function vectorStrokeLodLevelUploadScene(level: StrokeLodStorageLevel & Partial<StoredStrokeLodLevel>): VectorScene {
  if (!level.store) return level.scene!;
  if (!level.records) return level.store.canonical;
  return materializedLevels.get(level.records) ?? materializeVectorStrokeLodLevel(level as StoredStrokeLodLevel);
}

/** Copy a store-backed level into its own arrays, bit for bit, with paint origins. */
export function materializeVectorStrokeLodLevel(level: StoredStrokeLodLevel): VectorScene {
  const { canonical, literals } = level.store;
  const canonicalCount = Math.max(0, canonical.segmentCount | 0);
  const count = Math.max(0, level.segmentCount | 0);
  const records = level.records;
  const scene: VectorScene = { ...canonical, segmentCount: count, bounds: level.sceneBounds, maxHalfWidth: level.maxHalfWidth };
  for (const key of STROKE_FIELDS) {
    const output = new Float32Array(count * 4);
    const target = wordsOf(output), canonicalWords = wordsOf(canonical[key]), literalWords = wordsOf(literals[key]);
    for (let index = 0; index < count; index++) {
      const id = records[index];
      const source = id < canonicalCount ? canonicalWords : literalWords;
      const offset = (id < canonicalCount ? id : id - canonicalCount) * 4;
      target[index * 4] = source[offset];
      target[index * 4 + 1] = source[offset + 1];
      target[index * 4 + 2] = source[offset + 2];
      target[index * 4 + 3] = source[offset + 3];
    }
    scene[key] = output;
  }
  if (hasStrokePaintOrigins(canonical)) {
    const literalOrigins = strokePaintOrigins(literals)!;
    const origins = new Uint32Array(count);
    for (let index = 0; index < count; index++) {
      const id = records[index];
      origins[index] = id < canonicalCount ? strokePaintOrigin(canonical, id)! : literalOrigins[id - canonicalCount];
    }
    setStrokePaintOrigins(scene, origins);
  }
  return scene;
}

function wordsOf(values: Float32Array): Uint32Array {
  return new Uint32Array(values.buffer, values.byteOffset, values.length);
}
