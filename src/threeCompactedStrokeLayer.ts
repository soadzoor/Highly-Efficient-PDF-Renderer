import * as THREE from "three";

import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import { configureStraightAlphaBlending } from "./threeMaterialBlending";
import { normalizeThreeStrokeRawFragmentShaderSource } from "./threeRawShaderColorSpace";

interface CompactedStrokeLayerOptions {
  sceneBounds: Bounds;
  sceneCenterX: number;
  sceneCenterY: number;
  vectorOverride: [number, number, number, number];
}

interface LodSpec {
  name: string;
  tolerance: number;
  minLocalUnitsPerPixel: number;
  longAxisTiles: number;
  mergeCollinear: boolean;
}

interface TileGrid {
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
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
  colorR: number;
  colorG: number;
  colorB: number;
  alpha: number;
  intervals: number[];
}

interface CompactSegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  halfWidth: number;
  flags: number;
  colorR: number;
  colorG: number;
  colorB: number;
  alpha: number;
}

interface TileBuild {
  segments: CompactSegment[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface CompactedLevel {
  group: THREE.Group;
  meshes: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>[];
  minLocalUnitsPerPixel: number;
  segmentCount: number;
}

const STROKE_PRIMITIVE_QUADRATIC = 1;
const STROKE_STYLE_FLAG_HAIRLINE = 1 << 0;
const STROKE_STYLE_FLAG_ROUND_CAP = 1 << 1;
const ANGLE_BIN_COUNT = 720;
const ANGLE_STEP = Math.PI / ANGLE_BIN_COUNT;

const COMPACTED_STROKE_VERTEX_SHADER = `
precision highp float;

attribute vec2 aP0;
attribute vec2 aP1;
attribute vec2 aStrokeMeta;
attribute vec4 aColor;

uniform float uLocalUnitsPerPixel;
uniform vec4 uVectorOverride;

varying vec4 vColor;
varying vec2 vStrokeCoord;
varying float vAxisLength;
varying float vHalfWidth;
varying float vAAWorld;
varying float vIsRoundCap;

void main() {
  vec2 p0 = aP0;
  vec2 p1 = aP1;
  float halfWidth = aStrokeMeta.x;
  float flags = aStrokeMeta.y;
  bool isHairline = mod(flags, 2.0) >= 0.5;
  bool isRoundCap = mod(floor(flags * 0.5), 2.0) >= 0.5;

  vec2 axis = p1 - p0;
  float axisLen = length(axis);
  vec2 tangent = axisLen > 1e-6 ? axis / axisLen : vec2(1.0, 0.0);
  vec2 normal = vec2(-tangent.y, tangent.x);

  float localUnitsPerPixel = max(uLocalUnitsPerPixel, 1e-6);
  if (isHairline) {
    halfWidth = max(0.5 * localUnitsPerPixel, 1e-5);
  }

  float aaWorld = isHairline
    ? max(0.35 * localUnitsPerPixel, 5e-5)
    : max(localUnitsPerPixel, 0.0001);
  float extent = halfWidth + aaWorld;
  float capExtent = isRoundCap ? extent : aaWorld;
  float side01 = position.x * 0.5 + 0.5;
  float lineCoord = mix(-capExtent, axisLen + capExtent, side01);
  float crossCoord = position.y * extent;
  vec2 localPosition = p0 + tangent * lineCoord + normal * crossCoord;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(localPosition, 0.0, 1.0);

  vec3 color = mix(aColor.rgb, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));
  vColor = vec4(color, aColor.a);
  vStrokeCoord = vec2(lineCoord, crossCoord);
  vAxisLength = axisLen;
  vHalfWidth = halfWidth;
  vAAWorld = aaWorld;
  vIsRoundCap = isRoundCap ? 1.0 : 0.0;
}
`;

const COMPACTED_STROKE_FRAGMENT_SHADER = `
precision highp float;

varying vec4 vColor;
varying vec2 vStrokeCoord;
varying float vAxisLength;
varying float vHalfWidth;
varying float vAAWorld;
varying float vIsRoundCap;

void main() {
  if (vColor.a <= 0.001) {
    discard;
  }

  float edgeDistance = abs(vStrokeCoord.y) - vHalfWidth;
  if (vIsRoundCap >= 0.5) {
    if (vStrokeCoord.x < 0.0) {
      edgeDistance = length(vStrokeCoord) - vHalfWidth;
    } else if (vStrokeCoord.x > vAxisLength) {
      edgeDistance = length(vec2(vStrokeCoord.x - vAxisLength, vStrokeCoord.y)) - vHalfWidth;
    }
  } else {
    edgeDistance = max(edgeDistance, max(-vStrokeCoord.x, vStrokeCoord.x - vAxisLength));
  }

  float coverage = 1.0 - smoothstep(-vAAWorld, vAAWorld, edgeDistance);
  float alpha = coverage * vColor.a;
  if (alpha <= 0.001) {
    discard;
  }
  gl_FragColor = vec4(vColor.rgb, alpha);
}
`;

export class ThreeCompactedStrokeLayer {
  readonly group = new THREE.Group();

  private readonly material: THREE.ShaderMaterial;
  private readonly levels: CompactedLevel[];
  private readonly localUnitsPerPixelUniform: { value: number };
  private readonly vectorOverrideUniform: THREE.Vector4;
  private activeLevelIndex = -1;

  constructor(scene: VectorScene, options: CompactedStrokeLayerOptions) {
    this.group.name = "hepr-compacted-strokes";
    this.group.visible = false;

    this.localUnitsPerPixelUniform = { value: 1 };
    this.vectorOverrideUniform = new THREE.Vector4(
      options.vectorOverride[0],
      options.vectorOverride[1],
      options.vectorOverride[2],
      options.vectorOverride[3]
    );
    this.material = new THREE.ShaderMaterial({
      vertexShader: COMPACTED_STROKE_VERTEX_SHADER,
      fragmentShader: normalizeThreeStrokeRawFragmentShaderSource(COMPACTED_STROKE_FRAGMENT_SHADER),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      uniforms: {
        uLocalUnitsPerPixel: this.localUnitsPerPixelUniform,
        uVectorOverride: { value: this.vectorOverrideUniform }
      }
    });
    configureStraightAlphaBlending(this.material);

    const effectiveLevels: CompactedLevel[] = [];
    for (const spec of buildLodSpecs(options.sceneBounds)) {
      const level = buildCompactedLevel(scene, options, spec, this.material);
      if (level.segmentCount > 0) {
        effectiveLevels.push(level);
      } else {
        disposeLevelGeometry(level);
      }
    }
    this.levels = effectiveLevels;

    for (const level of this.levels) {
      level.group.visible = false;
      this.group.add(level.group);
    }
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible && this.activeLevelIndex >= 0;
  }

  getRenderedSegmentCount(): number {
    if (!this.group.visible || this.activeLevelIndex < 0) {
      return 0;
    }
    return this.levels[this.activeLevelIndex]?.segmentCount ?? 0;
  }

  setVectorOverride(red: number, green: number, blue: number, opacity: number): void {
    this.vectorOverrideUniform.set(red, green, blue, opacity);
  }

  updateForLocalUnitsPerPixel(localUnitsPerPixel: number): boolean {
    const safeLocalUnitsPerPixel =
      Number.isFinite(localUnitsPerPixel) && localUnitsPerPixel > 1e-8
        ? localUnitsPerPixel
        : 1;
    this.localUnitsPerPixelUniform.value = safeLocalUnitsPerPixel;

    const nextLevelIndex = this.chooseLevel(safeLocalUnitsPerPixel);
    if (nextLevelIndex !== this.activeLevelIndex) {
      const previousLevel = this.activeLevelIndex >= 0 ? this.levels[this.activeLevelIndex] : undefined;
      if (previousLevel) {
        previousLevel.group.visible = false;
      }
      this.activeLevelIndex = nextLevelIndex;
      const activeLevel = this.activeLevelIndex >= 0 ? this.levels[this.activeLevelIndex] : undefined;
      if (activeLevel) {
        activeLevel.group.visible = true;
      }
    }

    this.group.visible = this.activeLevelIndex >= 0;
    return this.activeLevelIndex >= 0;
  }

  deactivate(): void {
    const activeLevel = this.activeLevelIndex >= 0 ? this.levels[this.activeLevelIndex] : undefined;
    if (activeLevel) {
      activeLevel.group.visible = false;
    }
    this.activeLevelIndex = -1;
    this.group.visible = false;
  }

  dispose(): void {
    for (const level of this.levels) {
      disposeLevelGeometry(level);
    }
    this.material.dispose();
    this.group.clear();
  }

  private chooseLevel(localUnitsPerPixel: number): number {
    for (let i = 0; i < this.levels.length; i += 1) {
      if (localUnitsPerPixel >= this.levels[i].minLocalUnitsPerPixel) {
        return i;
      }
    }
    return -1;
  }
}

function buildLodSpecs(bounds: Bounds): LodSpec[] {
  const pageWidth = Math.max(1e-6, bounds.maxX - bounds.minX);
  const pageHeight = Math.max(1e-6, bounds.maxY - bounds.minY);
  const longSide = Math.max(pageWidth, pageHeight);
  const exactTolerance = Math.max(longSide / 65536, 0.01);
  return [
    {
      name: "static",
      tolerance: exactTolerance,
      minLocalUnitsPerPixel: 0,
      longAxisTiles: 24,
      mergeCollinear: false
    }
  ];
}

function buildCompactedLevel(
  scene: VectorScene,
  options: CompactedStrokeLayerOptions,
  spec: LodSpec,
  material: THREE.ShaderMaterial
): CompactedLevel {
  const grid = createTileGrid(options.sceneBounds, spec.longAxisTiles);
  const tileCount = grid.columns * grid.rows;
  const tiles = createTileBuilds(tileCount);
  const groups = new Map<string, IntervalGroup>();
  const endpoints = scene.endpoints;
  const primitiveMeta = scene.primitiveMeta;
  const styles = scene.styles;
  const segmentCount = Math.max(0, scene.segmentCount | 0);

  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const offset = segmentIndex * 4;
    const x0 = endpoints[offset];
    const y0 = endpoints[offset + 1];
    const cx = endpoints[offset + 2];
    const cy = endpoints[offset + 3];
    const x1 = primitiveMeta[offset];
    const y1 = primitiveMeta[offset + 1];
    const primitiveType = primitiveMeta[offset + 2];
    const packedStyle = primitiveMeta[offset + 3];
    const flags = Math.max(0, Math.trunc(packedStyle / 2 + 1e-6));
    const alpha = clamp01(packedStyle - flags * 2);
    if (alpha <= 0.001) {
      continue;
    }

    const halfWidth = Math.max(0, styles[offset]);
    const colorR = clamp01(styles[offset + 1]);
    const colorG = clamp01(styles[offset + 2]);
    const colorB = clamp01(styles[offset + 3]);
    const isQuadratic = primitiveType >= STROKE_PRIMITIVE_QUADRATIC - 0.5;
    const endX = x1;
    const endY = y1;
    const tileIndex = tileIndexForSegment(
      isQuadratic ? (x0 + cx + endX) / 3 : (x0 + endX) * 0.5,
      isQuadratic ? (y0 + cy + endY) / 3 : (y0 + endY) * 0.5,
      options.sceneBounds,
      grid
    );

    if (isQuadratic || !spec.mergeCollinear) {
      const dx = endX - x0;
      const dy = endY - y0;
      if (dx * dx + dy * dy <= 1e-10 && (flags & STROKE_STYLE_FLAG_ROUND_CAP) === 0) {
        continue;
      }
      addSegmentToTile(tiles[tileIndex], {
        x0,
        y0,
        x1: endX,
        y1: endY,
        halfWidth,
        flags,
        colorR,
        colorG,
        colorB,
        alpha
      }, options, spec.tolerance);
      continue;
    }

    const dx = endX - x0;
    const dy = endY - y0;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= 1e-10) {
      if ((flags & STROKE_STYLE_FLAG_ROUND_CAP) !== 0) {
        addSegmentToTile(tiles[tileIndex], {
          x0,
          y0,
          x1: endX,
          y1: endY,
          halfWidth,
          flags,
          colorR,
          colorG,
          colorB,
          alpha
        }, options, spec.tolerance);
      }
      continue;
    }

    const group = resolveIntervalGroup(
      groups,
      tileIndex,
      x0,
      y0,
      endX,
      endY,
      halfWidth,
      flags,
      colorR,
      colorG,
      colorB,
      alpha,
      spec.tolerance
    );
    const start = x0 * group.axisX + y0 * group.axisY;
    const end = endX * group.axisX + endY * group.axisY;
    if (start <= end) {
      group.intervals.push(start, end);
    } else {
      group.intervals.push(end, start);
    }
  }

  for (const group of groups.values()) {
    emitMergedIntervals(group, tiles[group.tileIndex], options, spec.tolerance);
  }

  const group = new THREE.Group();
  group.name = `hepr-compacted-strokes-${spec.name}`;
  const meshes: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>[] = [];
  let outputSegmentCount = 0;
  for (let tileIndex = 0; tileIndex < tiles.length; tileIndex += 1) {
    const tile = tiles[tileIndex];
    if (tile.segments.length === 0) {
      continue;
    }
    outputSegmentCount += tile.segments.length;
    const geometry = createTileGeometry(tile, options);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${group.name}-tile-${tileIndex}`;
    mesh.frustumCulled = true;
    mesh.renderOrder = 1;
    meshes.push(mesh);
    group.add(mesh);
  }

  return {
    group,
    meshes,
    minLocalUnitsPerPixel: spec.minLocalUnitsPerPixel,
    segmentCount: outputSegmentCount
  };
}

function resolveIntervalGroup(
  groups: Map<string, IntervalGroup>,
  tileIndex: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  halfWidth: number,
  flags: number,
  colorR: number,
  colorG: number,
  colorB: number,
  alpha: number,
  tolerance: number
): IntervalGroup {
  const dx = x1 - x0;
  const dy = y1 - y0;
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
  const offset = x0 * normalX + y0 * normalY;
  const offsetKey = Math.round(offset / tolerance);
  const widthKey = (flags & STROKE_STYLE_FLAG_HAIRLINE) !== 0
    ? -1
    : Math.round(halfWidth * 256);
  const colorKey = `${Math.round(colorR * 255)},${Math.round(colorG * 255)},${Math.round(colorB * 255)},${Math.round(alpha * 255)}`;
  const styleFlags = flags & (STROKE_STYLE_FLAG_HAIRLINE | STROKE_STYLE_FLAG_ROUND_CAP);
  const key = `${tileIndex}|${styleFlags}|${widthKey}|${colorKey}|${angleBin}|${offsetKey}`;
  let group = groups.get(key);
  if (!group) {
    group = {
      tileIndex,
      axisX,
      axisY,
      normalX,
      normalY,
      offset: offsetKey * tolerance,
      halfWidth,
      flags: styleFlags,
      colorR,
      colorG,
      colorB,
      alpha,
      intervals: []
    };
    groups.set(key, group);
  }
  return group;
}

function emitMergedIntervals(
  group: IntervalGroup,
  tile: TileBuild,
  options: CompactedStrokeLayerOptions,
  tolerance: number
): void {
  const intervals = group.intervals;
  if (intervals.length === 0) {
    return;
  }

  const pairCount = intervals.length >> 1;
  const sorted = new Array<{ start: number; end: number }>(pairCount);
  for (let i = 0; i < pairCount; i += 1) {
    const offset = i * 2;
    sorted[i] = { start: intervals[offset], end: intervals[offset + 1] };
  }
  sorted.sort((a, b) => a.start - b.start || a.end - b.end);

  const mergeGap = tolerance;
  let currentStart = sorted[0].start;
  let currentEnd = sorted[0].end;
  for (let i = 1; i < sorted.length; i += 1) {
    const interval = sorted[i];
    if (interval.start <= currentEnd + mergeGap) {
      currentEnd = Math.max(currentEnd, interval.end);
      continue;
    }
    emitIntervalSegment(group, tile, options, tolerance, currentStart, currentEnd);
    currentStart = interval.start;
    currentEnd = interval.end;
  }
  emitIntervalSegment(group, tile, options, tolerance, currentStart, currentEnd);
}

function emitIntervalSegment(
  group: IntervalGroup,
  tile: TileBuild,
  options: CompactedStrokeLayerOptions,
  tolerance: number,
  start: number,
  end: number
): void {
  if (end - start <= 1e-6) {
    return;
  }

  const x0 = group.axisX * start + group.normalX * group.offset;
  const y0 = group.axisY * start + group.normalY * group.offset;
  const x1 = group.axisX * end + group.normalX * group.offset;
  const y1 = group.axisY * end + group.normalY * group.offset;
  addSegmentToTile(tile, {
    x0,
    y0,
    x1,
    y1,
    halfWidth: group.halfWidth,
    flags: group.flags,
    colorR: group.colorR,
    colorG: group.colorG,
    colorB: group.colorB,
    alpha: group.alpha
  }, options, tolerance);
}

function createTileGeometry(
  tile: TileBuild,
  options: CompactedStrokeLayerOptions
): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array([
    -1, -1, 0,
    1, -1, 0,
    1, 1, 0,
    -1, 1, 0
  ]), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));

  const count = tile.segments.length;
  const p0 = new Float32Array(count * 2);
  const p1 = new Float32Array(count * 2);
  const meta = new Float32Array(count * 2);
  const color = new Float32Array(count * 4);

  for (let i = 0; i < count; i += 1) {
    const segment = tile.segments[i];
    const pOffset = i * 2;
    const colorOffset = i * 4;
    p0[pOffset] = segment.x0 - options.sceneCenterX;
    p0[pOffset + 1] = segment.y0 - options.sceneCenterY;
    p1[pOffset] = segment.x1 - options.sceneCenterX;
    p1[pOffset + 1] = segment.y1 - options.sceneCenterY;
    meta[pOffset] = segment.halfWidth;
    meta[pOffset + 1] = segment.flags;
    color[colorOffset] = segment.colorR;
    color[colorOffset + 1] = segment.colorG;
    color[colorOffset + 2] = segment.colorB;
    color[colorOffset + 3] = segment.alpha;
  }

  geometry.setAttribute("aP0", new THREE.InstancedBufferAttribute(p0, 2));
  geometry.setAttribute("aP1", new THREE.InstancedBufferAttribute(p1, 2));
  geometry.setAttribute("aStrokeMeta", new THREE.InstancedBufferAttribute(meta, 2));
  geometry.setAttribute("aColor", new THREE.InstancedBufferAttribute(color, 4));
  geometry.instanceCount = count;

  const min = new THREE.Vector3(
    tile.minX - options.sceneCenterX,
    tile.minY - options.sceneCenterY,
    -1e-3
  );
  const max = new THREE.Vector3(
    tile.maxX - options.sceneCenterX,
    tile.maxY - options.sceneCenterY,
    1e-3
  );
  geometry.boundingBox = new THREE.Box3(min, max);
  const center = new THREE.Vector3();
  geometry.boundingBox.getCenter(center);
  const radius = Math.max(center.distanceTo(min), center.distanceTo(max), 1e-6);
  geometry.boundingSphere = new THREE.Sphere(center, radius);

  return geometry;
}

function addSegmentToTile(
  tile: TileBuild,
  segment: CompactSegment,
  _options: CompactedStrokeLayerOptions,
  tolerance: number
): void {
  tile.segments.push(segment);
  const margin = Math.max(segment.halfWidth * 2, tolerance * 8, 1);
  tile.minX = Math.min(tile.minX, segment.x0 - margin, segment.x1 - margin);
  tile.minY = Math.min(tile.minY, segment.y0 - margin, segment.y1 - margin);
  tile.maxX = Math.max(tile.maxX, segment.x0 + margin, segment.x1 + margin);
  tile.maxY = Math.max(tile.maxY, segment.y0 + margin, segment.y1 + margin);
}

function disposeLevelGeometry(level: CompactedLevel): void {
  for (const mesh of level.meshes) {
    mesh.geometry.dispose();
  }
  level.group.clear();
}

function createTileBuilds(count: number): TileBuild[] {
  const tiles: TileBuild[] = [];
  for (let i = 0; i < count; i += 1) {
    tiles.push({
      segments: [],
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY
    });
  }
  return tiles;
}

function createTileGrid(bounds: Bounds, longAxisTiles: number): TileGrid {
  const width = Math.max(1e-6, bounds.maxX - bounds.minX);
  const height = Math.max(1e-6, bounds.maxY - bounds.minY);
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

function tileIndexForSegment(x: number, y: number, bounds: Bounds, grid: TileGrid): number {
  const column = clampIndex(Math.floor((x - bounds.minX) / grid.tileWidth), grid.columns);
  const row = clampIndex(Math.floor((y - bounds.minY) / grid.tileHeight), grid.rows);
  return row * grid.columns + column;
}

function clampIndex(value: number, count: number): number {
  if (count <= 1) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value >= count) {
    return count - 1;
  }
  return value;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}
