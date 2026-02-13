import type { VectorScene } from "./pdfVectorExtractor";

const MIN_GRID_SIDE = 64;
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

  for (let i = 0; i < segmentCount; i += 1) {
    const primitiveBoundsOffset = i * 4;
    const styleOffset = i * 4;

    const halfWidth = scene.styles[styleOffset];
    const margin = halfWidth + 0.35;

    const minX = scene.primitiveBounds[primitiveBoundsOffset] - margin;
    const minY = scene.primitiveBounds[primitiveBoundsOffset + 1] - margin;
    const maxX = scene.primitiveBounds[primitiveBoundsOffset + 2] + margin;
    const maxY = scene.primitiveBounds[primitiveBoundsOffset + 3] + margin;

    const c0 = clampToCell(Math.floor((minX - scene.bounds.minX) / cellWidth), gridWidth);
    const c1 = clampToCell(Math.floor((maxX - scene.bounds.minX) / cellWidth), gridWidth);
    const r0 = clampToCell(Math.floor((minY - scene.bounds.minY) / cellHeight), gridHeight);
    const r1 = clampToCell(Math.floor((maxY - scene.bounds.minY) / cellHeight), gridHeight);

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
    const primitiveBoundsOffset = i * 4;
    const styleOffset = i * 4;

    const halfWidth = scene.styles[styleOffset];
    const margin = halfWidth + 0.35;

    const minX = scene.primitiveBounds[primitiveBoundsOffset] - margin;
    const minY = scene.primitiveBounds[primitiveBoundsOffset + 1] - margin;
    const maxX = scene.primitiveBounds[primitiveBoundsOffset + 2] + margin;
    const maxY = scene.primitiveBounds[primitiveBoundsOffset + 3] + margin;

    const c0 = clampToCell(Math.floor((minX - scene.bounds.minX) / cellWidth), gridWidth);
    const c1 = clampToCell(Math.floor((maxX - scene.bounds.minX) / cellWidth), gridWidth);
    const r0 = clampToCell(Math.floor((minY - scene.bounds.minY) / cellHeight), gridHeight);
    const r1 = clampToCell(Math.floor((maxY - scene.bounds.minY) / cellHeight), gridHeight);

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
