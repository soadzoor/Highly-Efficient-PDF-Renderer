import * as THREE from "three";

import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import { ThreeMaterialStrokeLayer } from "./threeMaterialStrokeLayer";
import type { ViewState } from "./webGlFloorplanRenderer";

export type VectorLodMode = "auto" | "off" | "force";

export const VECTOR_STROKE_LOD_MIN_SEGMENTS = 150_000;
export const VECTOR_STROKE_LOD_TOLERANCES = [0.5, 1, 2, 4, 8, 16, 32] as const;

interface VectorStrokeLodLayerOptions {
  strokeCurveEnabled: boolean;
  vectorOverride: [number, number, number, number];
}

interface ViewportPixels {
  width: number;
  height: number;
}

interface CullingBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface VectorStrokeLodScene {
  tolerance: number;
  scene: VectorScene;
}

interface StrokePrimitive {
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  x1: number;
  y1: number;
  primitiveType: number;
  halfWidth: number;
  flags: number;
  alpha: number;
  colorR: number;
  colorG: number;
  colorB: number;
}

interface IntervalGroup {
  tileIndex: number;
  axisX: number;
  axisY: number;
  normalX: number;
  normalY: number;
  offset: number;
  halfWidth: number;
  flags: number;
  alpha: number;
  colorR: number;
  colorG: number;
  colorB: number;
  intervals: number[];
}

interface TileGrid {
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
}

class Float4Builder {
  private data: Float32Array;
  private length = 0;

  constructor(initialQuads = 16_384) {
    this.data = new Float32Array(Math.max(1, initialQuads) * 4);
  }

  get quadCount(): number {
    return this.length >> 2;
  }

  push(a: number, b: number, c: number, d: number): void {
    this.ensureCapacity(4);
    const offset = this.length;
    this.data[offset] = a;
    this.data[offset + 1] = b;
    this.data[offset + 2] = c;
    this.data[offset + 3] = d;
    this.length += 4;
  }

  toTypedArray(): Float32Array {
    return this.data.slice(0, this.length);
  }

  private ensureCapacity(extraFloats: number): void {
    if (this.length + extraFloats <= this.data.length) {
      return;
    }
    let nextLength = this.data.length;
    while (this.length + extraFloats > nextLength) {
      nextLength *= 2;
    }
    const next = new Float32Array(nextLength);
    next.set(this.data);
    this.data = next;
  }
}

const STROKE_PRIMITIVE_LINE = 0;
const STROKE_PRIMITIVE_QUADRATIC = 1;
const STROKE_STYLE_FLAG_HAIRLINE = 1 << 0;
const STROKE_STYLE_FLAG_ROUND_CAP = 1 << 1;
const STROKE_STYLE_FLAG_OFFSET = 2;
const ANGLE_BIN_COUNT = 720;
const ANGLE_STEP = Math.PI / ANGLE_BIN_COUNT;
const MIN_LEVEL_REDUCTION_RATIO = 0.985;
const LOD_SCREEN_ERROR_BUDGET_PX = 1.25;
const LOD_DROP_LOCAL_SIZE_FACTOR = 1.1;
const LOD_MERGE_GAP_FACTOR = 1.5;
const LOD_TILE_WORLD_FACTOR = 192;

export class ThreeVectorLodStrokeLayer {
  readonly group = new THREE.Group();

  private readonly levels: Array<{
    tolerance: number;
    layer: ThreeMaterialStrokeLayer;
    segmentCount: number;
  }>;
  private requestedVisible = false;
  private activeLevelIndex = 0;
  private useLocalToClip = false;
  private localToClip = new THREE.Matrix4();
  private localUnitsPerPixel = 1;

  constructor(scene: VectorScene, options: VectorStrokeLodLayerOptions) {
    this.group.name = "hepr-vector-lod-strokes";
    this.group.visible = false;

    this.levels = buildVectorStrokeLodScenes(scene).map((levelScene) => {
      const layer = new ThreeMaterialStrokeLayer(levelScene.scene, options);
      layer.mesh.name = `hepr-vector-lod-strokes-${formatToleranceName(levelScene.tolerance)}`;
      layer.setVisible(false);
      this.group.add(layer.mesh);
      return {
        tolerance: levelScene.tolerance,
        layer,
        segmentCount: Math.max(0, levelScene.scene.segmentCount | 0)
      };
    });

    if (this.levels.length > 0) {
      this.activeLevelIndex = 0;
    }
  }

  setVisible(visible: boolean): void {
    this.requestedVisible = visible;
    this.updateGroupVisibility();
  }

  setStrokeCurveEnabled(enabled: boolean): void {
    for (const level of this.levels) {
      level.layer.setStrokeCurveEnabled(enabled);
    }
  }

  setVectorOverride(red: number, green: number, blue: number, opacity: number): void {
    for (const level of this.levels) {
      level.layer.setVectorOverride(red, green, blue, opacity);
    }
  }

  setScreenSpaceTransform(): void {
    this.useLocalToClip = false;
    for (const level of this.levels) {
      level.layer.setScreenSpaceTransform();
    }
  }

  setLocalToClipTransform(localToClip: THREE.Matrix4, localUnitsPerPixel: number): void {
    this.useLocalToClip = true;
    this.localToClip.copy(localToClip);
    this.localUnitsPerPixel = normalizeLocalUnitsPerPixel(localUnitsPerPixel);
    for (const level of this.levels) {
      level.layer.setLocalToClipTransform(this.localToClip, this.localUnitsPerPixel);
    }
  }

  updateForLocalUnitsPerPixel(localUnitsPerPixel: number): boolean {
    this.localUnitsPerPixel = normalizeLocalUnitsPerPixel(localUnitsPerPixel);
    const nextIndex = this.chooseLevelIndex(this.localUnitsPerPixel);
    if (nextIndex !== this.activeLevelIndex) {
      this.levels[this.activeLevelIndex]?.layer.setVisible(false);
      this.activeLevelIndex = nextIndex;
      if (this.useLocalToClip) {
        this.levels[this.activeLevelIndex]?.layer.setLocalToClipTransform(this.localToClip, this.localUnitsPerPixel);
      }
    }
    this.updateGroupVisibility();
    return this.activeLevelIndex > 0;
  }

  updateFrame(viewState: ViewState, viewport: ViewportPixels, cullingBounds?: CullingBounds | null): void {
    const active = this.levels[this.activeLevelIndex];
    if (!active || !this.group.visible) {
      return;
    }
    active.layer.updateFrame(viewState, viewport, cullingBounds);
  }

  estimateVisibleSegmentCount(viewState: ViewState, viewport: ViewportPixels, cullingBounds?: CullingBounds | null): number {
    const active = this.levels[this.activeLevelIndex];
    return active?.layer.estimateVisibleSegmentCount(viewState, viewport, cullingBounds) ?? 0;
  }

  deactivate(): void {
    this.requestedVisible = false;
    for (const level of this.levels) {
      level.layer.setVisible(false);
    }
    this.group.visible = false;
  }

  dispose(): void {
    for (const level of this.levels) {
      level.layer.dispose();
    }
    this.group.clear();
  }

  private chooseLevelIndex(localUnitsPerPixel: number): number {
    const maxTolerance = localUnitsPerPixel * LOD_SCREEN_ERROR_BUDGET_PX;
    for (let i = this.levels.length - 1; i >= 1; i -= 1) {
      if (this.levels[i].tolerance <= maxTolerance) {
        return i;
      }
    }
    return 0;
  }

  private updateGroupVisibility(): void {
    const active = this.levels[this.activeLevelIndex];
    const visible = this.requestedVisible && !!active;
    this.group.visible = visible;
    for (let i = 0; i < this.levels.length; i += 1) {
      this.levels[i].layer.setVisible(visible && i === this.activeLevelIndex);
    }
  }
}

export function shouldUseVectorStrokeLod(mode: VectorLodMode, rendererType: "webgl" | "webgpu", segmentCount: number): boolean {
  if (mode === "off" || rendererType !== "webgl") {
    return false;
  }
  if (mode === "force") {
    return segmentCount > 0;
  }
  return segmentCount >= VECTOR_STROKE_LOD_MIN_SEGMENTS;
}

export function buildVectorStrokeLodScenes(scene: VectorScene): VectorStrokeLodScene[] {
  const baseCount = Math.max(0, scene.segmentCount | 0);
  const levels: VectorStrokeLodScene[] = [{ tolerance: 0, scene }];
  let previousCount = baseCount;

  for (const tolerance of VECTOR_STROKE_LOD_TOLERANCES) {
    const simplified = buildSimplifiedStrokeScene(scene, tolerance);
    if (!simplified || simplified.segmentCount <= 0) {
      continue;
    }
    if (simplified.segmentCount >= previousCount * MIN_LEVEL_REDUCTION_RATIO) {
      continue;
    }
    levels.push({
      tolerance,
      scene: {
        ...scene,
        segmentCount: simplified.segmentCount,
        endpoints: simplified.endpoints,
        primitiveMeta: simplified.primitiveMeta,
        primitiveBounds: simplified.primitiveBounds,
        styles: simplified.styles,
        bounds: simplified.bounds,
        maxHalfWidth: simplified.maxHalfWidth
      }
    });
    previousCount = simplified.segmentCount;
  }

  return levels;
}

function buildSimplifiedStrokeScene(scene: VectorScene, tolerance: number): {
  segmentCount: number;
  endpoints: Float32Array;
  primitiveMeta: Float32Array;
  primitiveBounds: Float32Array;
  styles: Float32Array;
  bounds: Bounds;
  maxHalfWidth: number;
} | null {
  const segmentCount = Math.max(0, scene.segmentCount | 0);
  if (segmentCount <= 0 || tolerance <= 0) {
    return null;
  }

  const grid = createTileGrid(scene.bounds, tolerance);
  const groups = new Map<string, IntervalGroup>();
  const endpoints = new Float4Builder(Math.min(segmentCount, 65_536));
  const primitiveMeta = new Float4Builder(Math.min(segmentCount, 65_536));
  const primitiveBounds = new Float4Builder(Math.min(segmentCount, 65_536));
  const styles = new Float4Builder(Math.min(segmentCount, 65_536));
  const outBounds = createEmptyBounds();
  let maxHalfWidth = 0;

  for (let index = 0; index < segmentCount; index += 1) {
    const primitive = readStrokePrimitive(scene, index);
    if (!primitive || primitive.alpha <= 0.001) {
      continue;
    }
    if (shouldDropPrimitiveAtTolerance(scene, index, primitive, tolerance)) {
      continue;
    }

    if (primitive.primitiveType >= STROKE_PRIMITIVE_QUADRATIC - 0.5) {
      emitPrimitive(endpoints, primitiveMeta, primitiveBounds, styles, outBounds, primitive);
      maxHalfWidth = Math.max(maxHalfWidth, primitive.halfWidth);
      continue;
    }

    const dx = primitive.x1 - primitive.x0;
    const dy = primitive.y1 - primitive.y0;
    if (dx * dx + dy * dy <= 1e-10) {
      if ((primitive.flags & STROKE_STYLE_FLAG_ROUND_CAP) !== 0) {
        emitPrimitive(endpoints, primitiveMeta, primitiveBounds, styles, outBounds, primitive);
        maxHalfWidth = Math.max(maxHalfWidth, primitive.halfWidth);
      }
      continue;
    }

    const tileIndex = tileIndexForPoint(
      (primitive.x0 + primitive.x1) * 0.5,
      (primitive.y0 + primitive.y1) * 0.5,
      scene.bounds,
      grid
    );
    const group = resolveIntervalGroup(groups, primitive, tileIndex, tolerance);
    const start = primitive.x0 * group.axisX + primitive.y0 * group.axisY;
    const end = primitive.x1 * group.axisX + primitive.y1 * group.axisY;
    if (start <= end) {
      group.intervals.push(start, end);
    } else {
      group.intervals.push(end, start);
    }
    maxHalfWidth = Math.max(maxHalfWidth, primitive.halfWidth);
  }

  for (const group of groups.values()) {
    emitMergedIntervals(group, endpoints, primitiveMeta, primitiveBounds, styles, outBounds, tolerance);
  }

  if (endpoints.quadCount === 0) {
    return null;
  }

  return {
    segmentCount: endpoints.quadCount,
    endpoints: endpoints.toTypedArray(),
    primitiveMeta: primitiveMeta.toTypedArray(),
    primitiveBounds: primitiveBounds.toTypedArray(),
    styles: styles.toTypedArray(),
    bounds: normalizeOutputBounds(outBounds, scene.bounds),
    maxHalfWidth
  };
}

function readStrokePrimitive(scene: VectorScene, index: number): StrokePrimitive | null {
  const offset = index * 4;
  const x0 = scene.endpoints[offset];
  const y0 = scene.endpoints[offset + 1];
  const cx = scene.endpoints[offset + 2];
  const cy = scene.endpoints[offset + 3];
  const x1 = scene.primitiveMeta[offset];
  const y1 = scene.primitiveMeta[offset + 1];
  const primitiveType = scene.primitiveMeta[offset + 2];
  const packedStyle = scene.primitiveMeta[offset + 3];
  const flags = Math.max(0, Math.trunc(packedStyle / STROKE_STYLE_FLAG_OFFSET + 1e-6));
  const alpha = clamp01(packedStyle - flags * STROKE_STYLE_FLAG_OFFSET);
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) {
    return null;
  }
  return {
    x0,
    y0,
    cx,
    cy,
    x1,
    y1,
    primitiveType,
    halfWidth: Math.max(0, scene.styles[offset] ?? 0),
    flags,
    alpha,
    colorR: clamp01(scene.styles[offset + 1] ?? 0),
    colorG: clamp01(scene.styles[offset + 2] ?? 0),
    colorB: clamp01(scene.styles[offset + 3] ?? 0)
  };
}

function shouldDropPrimitiveAtTolerance(
  scene: VectorScene,
  index: number,
  primitive: StrokePrimitive,
  tolerance: number
): boolean {
  const offset = index * 4;
  const minX = scene.primitiveBounds[offset] - primitive.halfWidth;
  const minY = scene.primitiveBounds[offset + 1] - primitive.halfWidth;
  const maxX = scene.primitiveBounds[offset + 2] + primitive.halfWidth;
  const maxY = scene.primitiveBounds[offset + 3] + primitive.halfWidth;
  const projectedDropLocalSize = tolerance * LOD_DROP_LOCAL_SIZE_FACTOR;
  return Math.max(maxX - minX, maxY - minY) <= projectedDropLocalSize;
}

function resolveIntervalGroup(
  groups: Map<string, IntervalGroup>,
  primitive: StrokePrimitive,
  tileIndex: number,
  tolerance: number
): IntervalGroup {
  const dx = primitive.x1 - primitive.x0;
  const dy = primitive.y1 - primitive.y0;
  let angle = Math.atan2(dy, dx);
  if (angle < 0) {
    angle += Math.PI;
  }
  if (angle >= Math.PI) {
    angle -= Math.PI;
  }
  let angleBin = Math.round(angle / ANGLE_STEP);
  if (angleBin >= ANGLE_BIN_COUNT) {
    angleBin = 0;
  }
  const snappedAngle = angleBin * ANGLE_STEP;
  const axisX = Math.cos(snappedAngle);
  const axisY = Math.sin(snappedAngle);
  const normalX = -axisY;
  const normalY = axisX;
  const offset = primitive.x0 * normalX + primitive.y0 * normalY;
  const offsetKey = Math.round(offset / tolerance);
  const widthKey = (primitive.flags & STROKE_STYLE_FLAG_HAIRLINE) !== 0
    ? -1
    : Math.round(primitive.halfWidth * 10_000);
  const colorKey =
    `${Math.round(primitive.colorR * 255)},${Math.round(primitive.colorG * 255)},` +
    `${Math.round(primitive.colorB * 255)},${Math.round(primitive.alpha * 255)}`;
  const flags = primitive.flags & (STROKE_STYLE_FLAG_HAIRLINE | STROKE_STYLE_FLAG_ROUND_CAP);
  const key = `${tileIndex}|${flags}|${widthKey}|${colorKey}|${angleBin}|${offsetKey}`;

  let group = groups.get(key);
  if (!group) {
    group = {
      tileIndex,
      axisX,
      axisY,
      normalX,
      normalY,
      offset: offsetKey * tolerance,
      halfWidth: primitive.halfWidth,
      flags,
      alpha: primitive.alpha,
      colorR: primitive.colorR,
      colorG: primitive.colorG,
      colorB: primitive.colorB,
      intervals: []
    };
    groups.set(key, group);
  }
  return group;
}

function emitMergedIntervals(
  group: IntervalGroup,
  endpoints: Float4Builder,
  primitiveMeta: Float4Builder,
  primitiveBounds: Float4Builder,
  styles: Float4Builder,
  bounds: Bounds,
  tolerance: number
): void {
  const pairCount = group.intervals.length >> 1;
  if (pairCount <= 0) {
    return;
  }

  const intervals = new Array<{ start: number; end: number }>(pairCount);
  for (let i = 0; i < pairCount; i += 1) {
    const offset = i * 2;
    intervals[i] = {
      start: group.intervals[offset],
      end: group.intervals[offset + 1]
    };
  }
  intervals.sort((a, b) => a.start - b.start || a.end - b.end);

  const mergeGap = tolerance * LOD_MERGE_GAP_FACTOR;
  let currentStart = intervals[0].start;
  let currentEnd = intervals[0].end;
  for (let i = 1; i < intervals.length; i += 1) {
    const interval = intervals[i];
    if (interval.start <= currentEnd + mergeGap) {
      currentEnd = Math.max(currentEnd, interval.end);
      continue;
    }
    emitInterval(group, endpoints, primitiveMeta, primitiveBounds, styles, bounds, currentStart, currentEnd);
    currentStart = interval.start;
    currentEnd = interval.end;
  }
  emitInterval(group, endpoints, primitiveMeta, primitiveBounds, styles, bounds, currentStart, currentEnd);
}

function emitInterval(
  group: IntervalGroup,
  endpoints: Float4Builder,
  primitiveMeta: Float4Builder,
  primitiveBounds: Float4Builder,
  styles: Float4Builder,
  bounds: Bounds,
  start: number,
  end: number
): void {
  if (end - start <= 1e-6) {
    return;
  }
  emitPrimitive(endpoints, primitiveMeta, primitiveBounds, styles, bounds, {
    x0: group.axisX * start + group.normalX * group.offset,
    y0: group.axisY * start + group.normalY * group.offset,
    cx: group.axisX * end + group.normalX * group.offset,
    cy: group.axisY * end + group.normalY * group.offset,
    x1: group.axisX * end + group.normalX * group.offset,
    y1: group.axisY * end + group.normalY * group.offset,
    primitiveType: STROKE_PRIMITIVE_LINE,
    halfWidth: group.halfWidth,
    flags: group.flags,
    alpha: group.alpha,
    colorR: group.colorR,
    colorG: group.colorG,
    colorB: group.colorB
  });
}

function emitPrimitive(
  endpoints: Float4Builder,
  primitiveMeta: Float4Builder,
  primitiveBounds: Float4Builder,
  styles: Float4Builder,
  bounds: Bounds,
  primitive: StrokePrimitive
): void {
  endpoints.push(primitive.x0, primitive.y0, primitive.cx, primitive.cy);
  primitiveMeta.push(
    primitive.x1,
    primitive.y1,
    primitive.primitiveType,
    primitive.alpha + primitive.flags * STROKE_STYLE_FLAG_OFFSET
  );
  styles.push(primitive.halfWidth, primitive.colorR, primitive.colorG, primitive.colorB);

  const minX = Math.min(primitive.x0, primitive.cx, primitive.x1);
  const minY = Math.min(primitive.y0, primitive.cy, primitive.y1);
  const maxX = Math.max(primitive.x0, primitive.cx, primitive.x1);
  const maxY = Math.max(primitive.y0, primitive.cy, primitive.y1);
  primitiveBounds.push(minX, minY, maxX, maxY);
  bounds.minX = Math.min(bounds.minX, minX);
  bounds.minY = Math.min(bounds.minY, minY);
  bounds.maxX = Math.max(bounds.maxX, maxX);
  bounds.maxY = Math.max(bounds.maxY, maxY);
}

function createTileGrid(bounds: Bounds, tolerance: number): TileGrid {
  const width = Math.max(1e-6, bounds.maxX - bounds.minX);
  const height = Math.max(1e-6, bounds.maxY - bounds.minY);
  const longSide = Math.max(width, height);
  const targetTileWorld = Math.max(96, tolerance * LOD_TILE_WORLD_FACTOR);
  const longAxisTiles = clampInt(Math.ceil(longSide / targetTileWorld), 16, 96);
  const aspect = width / height;
  const columns = aspect >= 1
    ? longAxisTiles
    : Math.max(1, Math.ceil(longAxisTiles * aspect));
  const rows = aspect >= 1
    ? Math.max(1, Math.ceil(longAxisTiles / aspect))
    : longAxisTiles;
  return {
    columns,
    rows,
    tileWidth: width / columns,
    tileHeight: height / rows
  };
}

function tileIndexForPoint(x: number, y: number, bounds: Bounds, grid: TileGrid): number {
  const column = clampInt(Math.floor((x - bounds.minX) / grid.tileWidth), 0, grid.columns - 1);
  const row = clampInt(Math.floor((y - bounds.minY) / grid.tileHeight), 0, grid.rows - 1);
  return row * grid.columns + column;
}

function createEmptyBounds(): Bounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };
}

function normalizeOutputBounds(bounds: Bounds, fallback: Bounds): Bounds {
  if (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.maxY)
  ) {
    return bounds;
  }
  return fallback;
}

function normalizeLocalUnitsPerPixel(value: number): number {
  return Number.isFinite(value) && value > 1e-8 ? value : 1;
}

function formatToleranceName(tolerance: number): string {
  return tolerance <= 0 ? "exact" : `tol-${String(tolerance).replace(".", "_")}`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function clampInt(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}
