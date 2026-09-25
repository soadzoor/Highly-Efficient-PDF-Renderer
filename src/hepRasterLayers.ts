/**
 * Scene v9 raster layers: one binary record per canonical image layer, with
 * the pixels of small lossless layers packed into shared atlas images.
 *
 * PDFs can paint thousands of tiny images; a map sliced into one-pixel
 * scanlines is common. Scene v8 stored every image as its own PNG section plus
 * a JSON record, and the per-image container, PNG and JSON overhead made such a
 * HEP larger than its PDF. v9 still keeps every layer as its own record (its
 * index, transform, paint order, page and opacity), so picking, draw order and
 * optional content see exactly the same layers. Only where the pixels live
 * changes: a reader crops each atlas cell back into the layer's own RGBA.
 *
 * Every integer is an unsigned LEB128 varint unless it is called zigzag.
 */

import { decodeXorDeltaByteShuffledFloat32, encodeXorDeltaByteShuffledFloat32 } from "./parsedDataEncoding";
import { ByteWriter, VarintCursor } from "./parsedDataVarint";

export const SCENE_RASTER_LAYERS_PATH = "geometry/raster-layers.varint";

/** Atlas pages stay small enough to decode at once in any browser. */
export const RASTER_ATLAS_MAX_SIZE = 2048;
/** Larger images gain nothing from sharing a section and keep their own. */
export const RASTER_ATLAS_MAX_CELL_TEXELS = 16_384;

/** Index order is the wire format; never reorder, only append. */
const LAYER_STORAGE = ["rgba", "png", "webp", "atlas"] as const;
const ATLAS_ENCODINGS = ["rgba", "png"] as const;
const FLAG_STORAGE_MASK = 3;
const FLAG_OPACITY = 4;
const MAX_INT32 = 0x7fffffff;

export type RasterLayerStorage = typeof LAYER_STORAGE[number];
export type RasterAtlasEncoding = typeof ATLAS_ENCODINGS[number];

export interface RasterAtlasRecord {
  encoding: RasterAtlasEncoding;
  width: number;
  height: number;
}

export interface RasterAtlasCell {
  atlas: number;
  x: number;
  y: number;
}

export interface RasterLayerRecord {
  width: number;
  height: number;
  matrix: Float32Array;
  paintOrder: number;
  pageIndex: number;
  opacity?: number;
  storage: RasterLayerStorage;
  /** Present exactly when `storage` is "atlas". */
  cell?: RasterAtlasCell;
}

export interface RasterLayerTable {
  atlases: RasterAtlasRecord[];
  layers: RasterLayerRecord[];
}

export interface RasterLayerTableLimits {
  maxLayers: number;
  maxAtlases: number;
  maxDimension: number;
}

function fail(message: string): never {
  throw new Error(`Invalid HEP raster layers section: ${message}.`);
}

function requireInteger(value: number, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label} is out of range`);
  return value;
}

/** Standalone layers are named by their layer index. */
export function rasterLayerFile(index: number, storage: Exclude<RasterLayerStorage, "atlas">): string {
  return `raster/layer-${index}.${storage}`;
}

export function rasterAtlasFile(index: number, encoding: RasterAtlasEncoding): string {
  return `raster/atlas-${index}.${encoding}`;
}

export function isRasterAtlasCandidate(width: number, height: number): boolean {
  return width <= RASTER_ATLAS_MAX_SIZE && height <= RASTER_ATLAS_MAX_SIZE &&
    width * height <= RASTER_ATLAS_MAX_CELL_TEXELS;
}

/**
 * Shelf-pack cells in their given order. Paint order keeps a sliced picture's
 * neighbouring scanlines together, which is what lets the atlas compress like
 * the picture did in the PDF. Each atlas is trimmed to the cells it holds.
 */
export function packRasterAtlases(
  sizes: ReadonlyArray<{ width: number; height: number }>
): { atlases: Array<{ width: number; height: number }>; cells: RasterAtlasCell[] } {
  const atlases: Array<{ width: number; height: number }> = [];
  const cells: RasterAtlasCell[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const { width, height } of sizes) {
    if (!isRasterAtlasCandidate(width, height) || width <= 0 || height <= 0) {
      throw new Error(`A ${width}x${height} image cannot join a raster atlas.`);
    }
    if (atlases.length > 0 && x + width > RASTER_ATLAS_MAX_SIZE) {
      y += rowHeight;
      x = 0;
      rowHeight = 0;
    }
    if (atlases.length === 0 || y + height > RASTER_ATLAS_MAX_SIZE) {
      atlases.push({ width: 0, height: 0 });
      x = 0;
      y = 0;
      rowHeight = 0;
    }
    const atlas = atlases[atlases.length - 1];
    cells.push({ atlas: atlases.length - 1, x, y });
    x += width;
    rowHeight = Math.max(rowHeight, height);
    atlas.width = Math.max(atlas.width, x);
    atlas.height = Math.max(atlas.height, y + height);
  }
  return { atlases, cells };
}

/**
 * Finds an earlier image with identical dimensions and pixels. PDFs paint the
 * same logo, symbol or blank scanline many times; a writer stores it once.
 */
export class IdenticalRasterFinder {
  private readonly candidatesByHash = new Map<number, Array<{ index: number; width: number; height: number; rgba: Uint8Array }>>();

  /** Returns the index of the first identical image added, or -1 after adding this one. */
  findOrAdd(index: number, width: number, height: number, rgba: Uint8Array): number {
    // FNV-1a; collisions are resolved by comparing the pixels themselves.
    let hash = 0x811c9dc5;
    for (let offset = 0; offset < rgba.length; offset += 1) {
      hash = Math.imul(hash ^ rgba[offset], 0x01000193);
    }
    hash = (hash ^ width ^ Math.imul(height, 0x9e3779b1)) >>> 0;
    let candidates = this.candidatesByHash.get(hash);
    if (!candidates) {
      candidates = [];
      this.candidatesByHash.set(hash, candidates);
    }
    for (const candidate of candidates) {
      if (candidate.width === width && candidate.height === height && bytesEqual(candidate.rgba, rgba)) {
        return candidate.index;
      }
    }
    candidates.push({ index, width, height, rgba });
    return -1;
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let offset = 0; offset < a.length; offset += 1) {
    if (a[offset] !== b[offset]) return false;
  }
  return true;
}

/** Copy a `width` x `height` RGBA8 rectangle between two row-major images. */
export function copyRasterRect(
  source: Uint8Array,
  sourceWidth: number,
  sourceX: number,
  sourceY: number,
  target: Uint8Array,
  targetWidth: number,
  targetX: number,
  targetY: number,
  width: number,
  height: number
): void {
  const rowBytes = width * 4;
  for (let row = 0; row < height; row += 1) {
    const from = ((sourceY + row) * sourceWidth + sourceX) * 4;
    target.set(source.subarray(from, from + rowBytes), ((targetY + row) * targetWidth + targetX) * 4);
  }
}

/**
 * `varint atlasCount`, then per atlas a byte encoding (0 RGBA8, 1 PNG) and
 * `varint width`, `varint height`. Then `varint layerCount` and per layer a
 * flags byte (bits 0-1 storage: 0 RGBA8, 1 PNG, 2 WebP section, 3 atlas cell;
 * bit 2 opacity present), `varint width`, `varint height`, zigzag deltas of
 * paint order and page index against the previous layer, then for a cell
 * `varint atlas` and zigzag `x`, `y` against the previous cell's right edge
 * and row when it is in the same atlas (else against zero), and a float64
 * opacity when present. Shelf packing makes most cell offsets zero, and a run
 * of repeated images revisits consecutive cells. The
 * section ends with every layer's float32 matrix in component-major order
 * (all `a`, then all `b`, ... all `f`) through the XOR-delta byte shuffle that
 * `text-instance-a` uses, so repeated scales and steady offsets cost little.
 */
export function encodeRasterLayerTable({ atlases, layers }: RasterLayerTable): Uint8Array {
  const writer = new ByteWriter(atlases.length * 8 + layers.length * 12 + 16);
  writer.writeVarUint32(atlases.length);
  for (const atlas of atlases) {
    const encoding = ATLAS_ENCODINGS.indexOf(atlas.encoding);
    if (encoding < 0) fail(`unknown atlas encoding ${String(atlas.encoding)}`);
    writer.writeByte(encoding);
    writer.writeVarUint32(requireInteger(atlas.width, 1, MAX_INT32, "atlas width"));
    writer.writeVarUint32(requireInteger(atlas.height, 1, MAX_INT32, "atlas height"));
  }
  writer.writeVarUint32(layers.length);
  const matrices = new Float32Array(layers.length * 6);
  let previousPaintOrder = 0;
  let previousPageIndex = 0;
  let previousCell = { atlas: -1, right: 0, y: 0 };
  layers.forEach((layer, index) => {
    const storage = LAYER_STORAGE.indexOf(layer.storage);
    if (storage < 0) fail(`layer ${index} has unknown storage ${String(layer.storage)}`);
    const hasOpacity = layer.opacity !== undefined;
    if (hasOpacity && !(Number.isFinite(layer.opacity) && layer.opacity! >= 0 && layer.opacity! <= 1)) {
      fail(`layer ${index} has an invalid opacity`);
    }
    writer.writeByte(storage | (hasOpacity ? FLAG_OPACITY : 0));
    writer.writeVarUint32(requireInteger(layer.width, 1, MAX_INT32, "layer width"));
    writer.writeVarUint32(requireInteger(layer.height, 1, MAX_INT32, "layer height"));
    writer.writeZigzagVarint(requireInteger(layer.paintOrder, 0, MAX_INT32, "paint order") - previousPaintOrder);
    writer.writeZigzagVarint(requireInteger(layer.pageIndex, 0, MAX_INT32, "page index") - previousPageIndex);
    previousPaintOrder = layer.paintOrder;
    previousPageIndex = layer.pageIndex;
    if ((layer.storage === "atlas") !== (layer.cell !== undefined)) fail(`layer ${index} has a mismatched atlas cell`);
    if (layer.cell) {
      const { atlas: atlasIndex, x, y } = layer.cell;
      const atlas = atlases[requireInteger(atlasIndex, 0, atlases.length - 1, "atlas index")];
      requireInteger(x, 0, atlas.width - layer.width, "cell x");
      requireInteger(y, 0, atlas.height - layer.height, "cell y");
      const sameAtlas = atlasIndex === previousCell.atlas;
      writer.writeVarUint32(atlasIndex);
      writer.writeZigzagVarint(x - (sameAtlas ? previousCell.right : 0));
      writer.writeZigzagVarint(y - (sameAtlas ? previousCell.y : 0));
      previousCell = { atlas: atlasIndex, right: x + layer.width, y };
    }
    if (hasOpacity) writer.writeFloat64(layer.opacity!);
    if (layer.matrix.length < 6) fail(`layer ${index} has an incomplete matrix`);
    for (let component = 0; component < 6; component += 1) {
      const value = layer.matrix[component];
      if (!Number.isFinite(value)) fail(`layer ${index} has a non-finite matrix`);
      matrices[component * layers.length + index] = value;
    }
  });
  writer.writeBytes(encodeXorDeltaByteShuffledFloat32(matrices));
  return writer.toUint8Array();
}

export function decodeRasterLayerTable(bytes: Uint8Array, limits: RasterLayerTableLimits): RasterLayerTable {
  const cursor = new VarintCursor(bytes);
  const atlasCount = requireInteger(cursor.readVarUint32(), 0, limits.maxAtlases, "atlas count");
  const atlases: RasterAtlasRecord[] = [];
  for (let index = 0; index < atlasCount; index += 1) {
    const encoding = ATLAS_ENCODINGS[cursor.readByte("atlas encoding")];
    if (!encoding) fail(`atlas ${index} has an unknown encoding`);
    const width = requireInteger(cursor.readVarUint32(), 1, limits.maxDimension, "atlas width");
    const height = requireInteger(cursor.readVarUint32(), 1, limits.maxDimension, "atlas height");
    atlases.push({ encoding, width, height });
  }
  const layerCount = requireInteger(cursor.readVarUint32(), 0, limits.maxLayers, "layer count");
  const layers: RasterLayerRecord[] = [];
  let paintOrder = 0;
  let pageIndex = 0;
  let previousCell = { atlas: -1, right: 0, y: 0 };
  for (let index = 0; index < layerCount; index += 1) {
    const flags = cursor.readByte("raster layer flags");
    if (flags & ~(FLAG_STORAGE_MASK | FLAG_OPACITY)) fail(`layer ${index} has reserved flag bits`);
    const storage = LAYER_STORAGE[flags & FLAG_STORAGE_MASK];
    const width = requireInteger(cursor.readVarUint32(), 1, limits.maxDimension, "layer width");
    const height = requireInteger(cursor.readVarUint32(), 1, limits.maxDimension, "layer height");
    paintOrder = requireInteger(paintOrder + cursor.readZigzagVarint(), 0, MAX_INT32, "paint order");
    pageIndex = requireInteger(pageIndex + cursor.readZigzagVarint(), 0, MAX_INT32, "page index");
    const layer: RasterLayerRecord = { width, height, matrix: new Float32Array(6), paintOrder, pageIndex, storage };
    if (storage === "atlas") {
      const atlas = requireInteger(cursor.readVarUint32(), 0, atlasCount - 1, "atlas index");
      const sameAtlas = atlas === previousCell.atlas;
      const x = requireInteger(cursor.readZigzagVarint() + (sameAtlas ? previousCell.right : 0),
        0, atlases[atlas].width - width, "cell x");
      const y = requireInteger(cursor.readZigzagVarint() + (sameAtlas ? previousCell.y : 0),
        0, atlases[atlas].height - height, "cell y");
      layer.cell = { atlas, x, y };
      previousCell = { atlas, right: x + width, y };
    }
    if (flags & FLAG_OPACITY) {
      const opacity = cursor.readFloat64("raster layer opacity");
      if (!(Number.isFinite(opacity) && opacity >= 0 && opacity <= 1)) fail(`layer ${index} has an invalid opacity`);
      layer.opacity = opacity;
    }
    layers.push(layer);
  }
  const matrixStart = cursor.byteOffset;
  if (bytes.length - matrixStart !== layerCount * 24) fail("matrix data does not fill the section");
  const matrices = decodeXorDeltaByteShuffledFloat32(bytes.subarray(matrixStart));
  for (let index = 0; index < layerCount; index += 1) {
    const matrix = layers[index].matrix;
    for (let component = 0; component < 6; component += 1) {
      matrix[component] = matrices[component * layerCount + index];
      if (!Number.isFinite(matrix[component])) fail(`layer ${index} has a non-finite matrix`);
    }
  }
  return { atlases, layers };
}
