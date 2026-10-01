import type { Bounds, VectorScene } from "./pdfVectorExtractor";

const MIN_GRID_SIDE = 64;
const STROKE_STYLE_FLAG_CLIPPED = 1 << 2;
// Antialiasing reach of a stroke beyond its geometry, in scene units.
const STROKE_CULLING_MARGIN = 0.35;
const MAX_GRID_SIDE = 1024;
const MIN_TARGET_CELLS = 30_000;
const MAX_TARGET_CELLS = 220_000;

export interface SpatialGrid {
  gridWidth: number;
  gridHeight: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cellWidth: number;
  cellHeight: number;
  offsets: Uint32Array;
  counts: Uint32Array;
  indices: Uint32Array;
  maxCellPopulation: number;
}

/**
 * Bounds of everything a stroke can draw, including the antialiasing margin;
 * false when it can draw nothing. For a clipped stroke, primitiveBounds holds
 * its clip window rather than its extent, and a page-sized clip would place a
 * short stroke in every grid cell. Such strokes are also bounded by their
 * control hull, widened by the largest cap extent: a square cap's corner lies
 * √2 half widths from its endpoint.
 */
export function writeStrokeCullingBounds(scene: VectorScene, index: number, out: Bounds): boolean {
  const offset = index * 4;
  const halfWidth = scene.styles[offset];
  const margin = halfWidth + STROKE_CULLING_MARGIN;
  const bounds = scene.primitiveBounds;
  out.minX = bounds[offset] - margin;
  out.minY = bounds[offset + 1] - margin;
  out.maxX = bounds[offset + 2] + margin;
  out.maxY = bounds[offset + 3] + margin;
  const meta = scene.primitiveMeta;
  if ((Math.floor(meta[offset + 3] / 2 + 1e-6) & STROKE_STYLE_FLAG_CLIPPED) === 0) return true;
  const endpoints = scene.endpoints;
  const extent = Math.SQRT2 * Math.max(0, halfWidth) + STROKE_CULLING_MARGIN;
  out.minX = Math.max(out.minX, Math.min(endpoints[offset], endpoints[offset + 2], meta[offset]) - extent);
  out.minY = Math.max(out.minY, Math.min(endpoints[offset + 1], endpoints[offset + 3], meta[offset + 1]) - extent);
  out.maxX = Math.min(out.maxX, Math.max(endpoints[offset], endpoints[offset + 2], meta[offset]) + extent);
  out.maxY = Math.min(out.maxY, Math.max(endpoints[offset + 1], endpoints[offset + 3], meta[offset + 1]) + extent);
  return out.minX <= out.maxX && out.minY <= out.maxY;
}

export function buildSpatialGrid(scene: VectorScene): SpatialGrid {
  const segmentCount = scene.segmentCount;

  const width = Math.max(scene.bounds.maxX - scene.bounds.minX, 1e-5);
  const height = Math.max(scene.bounds.maxY - scene.bounds.minY, 1e-5);

  const { gridWidth, gridHeight } = chooseGridSize(segmentCount, width, height);

  const cellCount = gridWidth * gridHeight;
  const cellWidth = width / gridWidth;
  const cellHeight = height / gridHeight;

  const counts = new Uint32Array(cellCount);

  let maxCellPopulation = 0;
  const bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  for (let i = 0; i < segmentCount; i += 1) {
    if (!writeStrokeCullingBounds(scene, i, bounds)) continue;

    const c0 = clampToCell(Math.floor((bounds.minX - scene.bounds.minX) / cellWidth), gridWidth);
    const c1 = clampToCell(Math.floor((bounds.maxX - scene.bounds.minX) / cellWidth), gridWidth);
    const r0 = clampToCell(Math.floor((bounds.minY - scene.bounds.minY) / cellHeight), gridHeight);
    const r1 = clampToCell(Math.floor((bounds.maxY - scene.bounds.minY) / cellHeight), gridHeight);

    for (let row = r0; row <= r1; row += 1) {
      let cellIndex = row * gridWidth + c0;
      for (let col = c0; col <= c1; col += 1) {
        const next = counts[cellIndex] + 1;
        counts[cellIndex] = next;
        if (next > maxCellPopulation) {
          maxCellPopulation = next;
        }
        cellIndex += 1;
      }
    }
  }

  const offsets = new Uint32Array(cellCount + 1);
  for (let i = 0; i < cellCount; i += 1) {
    offsets[i + 1] = offsets[i] + counts[i];
  }

  const totalIndexCount = offsets[cellCount];
  const indices = new Uint32Array(totalIndexCount);
  const cursors = offsets.slice(0, cellCount);

  for (let i = 0; i < segmentCount; i += 1) {
    if (!writeStrokeCullingBounds(scene, i, bounds)) continue;

    const c0 = clampToCell(Math.floor((bounds.minX - scene.bounds.minX) / cellWidth), gridWidth);
    const c1 = clampToCell(Math.floor((bounds.maxX - scene.bounds.minX) / cellWidth), gridWidth);
    const r0 = clampToCell(Math.floor((bounds.minY - scene.bounds.minY) / cellHeight), gridHeight);
    const r1 = clampToCell(Math.floor((bounds.maxY - scene.bounds.minY) / cellHeight), gridHeight);

    for (let row = r0; row <= r1; row += 1) {
      let cellIndex = row * gridWidth + c0;
      for (let col = c0; col <= c1; col += 1) {
        const writeOffset = cursors[cellIndex];
        indices[writeOffset] = i;
        cursors[cellIndex] = writeOffset + 1;
        cellIndex += 1;
      }
    }
  }

  return {
    gridWidth,
    gridHeight,
    minX: scene.bounds.minX,
    minY: scene.bounds.minY,
    maxX: scene.bounds.maxX,
    maxY: scene.bounds.maxY,
    cellWidth,
    cellHeight,
    offsets,
    counts,
    indices,
    maxCellPopulation
  };
}

function chooseGridSize(segmentCount: number, width: number, height: number): { gridWidth: number; gridHeight: number } {
  const targetCells = clamp(
    Math.round(segmentCount / 8),
    MIN_TARGET_CELLS,
    MAX_TARGET_CELLS
  );

  const aspect = width / height;
  let gridWidth = Math.round(Math.sqrt(targetCells * aspect));
  let gridHeight = Math.round(targetCells / Math.max(gridWidth, 1));

  gridWidth = clamp(gridWidth, MIN_GRID_SIDE, MAX_GRID_SIDE);
  gridHeight = clamp(gridHeight, MIN_GRID_SIDE, MAX_GRID_SIDE);

  return { gridWidth, gridHeight };
}

function clampToCell(value: number, maxCells: number): number {
  if (value < 0) {
    return 0;
  }
  if (value >= maxCells) {
    return maxCells - 1;
  }
  return value;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}
