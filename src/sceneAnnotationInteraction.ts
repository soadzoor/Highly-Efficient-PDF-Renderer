import type { SceneAnnotation } from "./annotationData";
import type { Bounds, VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import type { OptionalContentSnapshot } from "./optionalContent";
import { getSceneAnnotationRuns, getScenePrimitiveBounds, type PrimitivePickRange, type PrimitivePoint, type PrimitiveRef } from "./scenePrimitives";
import type { PrimitiveHighlightSet } from "./primitiveAppearance";
import { waitForLoad } from "./loadCancellation";

export interface AnnotationHit { annotationId: string; distancePx: number }
interface AnnotationPath { points: PrimitivePoint[]; closed: boolean; filled: boolean }
interface AnnotationEntry { id: string; annotations: SceneAnnotation[]; runs: readonly VectorDrawRun[]; bounds: Bounds;
  geometry?: SpatialNode<PrimitivePickRange> | null }
interface SpatialNode<T> { bounds: Bounds; value?: T; left?: SpatialNode<T>; right?: SpatialNode<T> }
const MAX_METADATA_POINTS = 65_536;
const MAX_GEOMETRY_BLOCKS = 65_536;
const approximated = new WeakSet<SceneAnnotation>();

function union(a: Bounds, b: Bounds): Bounds {
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}
function intersects(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
function spatialTree<T>(entries: { bounds: Bounds; value: T }[]): SpatialNode<T> | null {
  entries.sort((a, b) => a.bounds.minX + a.bounds.maxX - b.bounds.minX - b.bounds.maxX);
  const tree = (first: number, end: number): SpatialNode<T> | null => {
    if (first === end) return null;
    if (end - first === 1) return entries[first];
    const mid = (first + end) >>> 1, left = tree(first, mid)!, right = tree(mid, end)!;
    return { bounds: union(left.bounds, right.bounds), left, right };
  };
  return tree(0, entries.length);
}
function queryTree<T>(root: SpatialNode<T> | null, bounds: Bounds): T[] {
  const result: T[] = [], stack = root ? [root] : [];
  while (stack.length) {
    const node = stack.pop()!;
    if (!intersects(node.bounds, bounds)) continue;
    if (node.value !== undefined) result.push(node.value);
    else stack.push(node.left!, node.right!);
  }
  return result;
}
function rectangle(bounds: Bounds): AnnotationPath {
  const { minX, minY, maxX, maxY } = bounds;
  return { points: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }],
    closed: true, filled: true };
}
function points(values: readonly number[]): PrimitivePoint[] {
  return Array.from({ length: values.length / 2 }, (_, i) => ({ x: values[i * 2], y: values[i * 2 + 1] }));
}
function metadataPaths(annotation: SceneAnnotation): AnnotationPath[] {
  const pointCount = (annotation.quadPoints?.length ?? 0) / 2 + (annotation.vertices?.length ?? 0) / 2 +
    (annotation.line?.length ?? 0) / 2 + (annotation.inkList?.reduce((sum, path) => sum + path.length / 2, 0) ?? 0);
  if (pointCount > MAX_METADATA_POINTS) {
    if (!approximated.has(annotation)) {
      approximated.add(annotation);
      console.warn(`[HEPR] Annotation ${annotation.id} metadata exceeds the interaction point budget; using its bounds.`);
    }
    return [rectangle(annotation.bounds)];
  }
  if (annotation.quadPoints?.length) {
    const paths: AnnotationPath[] = [];
    for (let i = 0; i < annotation.quadPoints.length; i += 8) {
      const quad = points(annotation.quadPoints.slice(i, i + 8));
      const center = quad.reduce((sum, p) => ({ x: sum.x + p.x / 4, y: sum.y + p.y / 4 }), { x: 0, y: 0 });
      quad.sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
      paths.push({ points: quad, closed: true, filled: true });
    }
    return paths;
  }
  if (annotation.inkList?.some(path => path.length)) return annotation.inkList.filter(path => path.length)
    .map(path => ({ points: points(path), closed: false, filled: false }));
  if (annotation.vertices?.length) return [{ points: points(annotation.vertices),
    closed: annotation.subtype === "Polygon", filled: annotation.subtype === "Polygon" }];
  if (annotation.line?.length) return [{ points: points(annotation.line), closed: false, filled: false }];
  return [rectangle(annotation.bounds)];
}

/** PDF flags and OCG membership still apply when an appearance is temporarily hidden by a host. */
export function isAnnotationInteractionVisible(annotation: SceneAnnotation, snapshot: OptionalContentSnapshot): boolean {
  if (annotation.subtype === "Popup" || (annotation.flags & (1 | 2 | 32)) !== 0) return false;
  return annotation.optionalContent === undefined ? annotation.visibleInDefaultView : snapshot.conditions[annotation.optionalContent] === 1;
}

export function annotationPrimitiveRefs(runs: readonly VectorDrawRun[]): PrimitiveRef[] {
  const refs: PrimitiveRef[] = [];
  const seen = new Set<string>();
  for (const run of runs) for (let index = run.first; index < run.first + run.count; index++) {
    const key = `${run.kind}:${index}`;
    if (!seen.has(key)) { seen.add(key); refs.push({ kind: run.kind, index }); }
  }
  return refs;
}

/** Lazy spatial index of annotations and their appearance extents, never the entire drawing. */
export class SceneAnnotationIndex {
  private readonly entries = new Map<string, AnnotationEntry>();
  private root: SpatialNode<AnnotationEntry> | null = null;
  private prepared = false;
  private building: Promise<void> | null = null;
  private disposed = false;
  private readonly scene: VectorScene;
  constructor(scene: VectorScene) {
    this.scene = scene;
    // This lightweight lookup is also used by selection; appearance bounds are deferred to picking.
    const runs = getSceneAnnotationRuns(scene);
    for (const annotation of scene.annotations ?? []) {
      const entry = this.entries.get(annotation.id);
      if (entry) { entry.annotations.push(annotation); entry.bounds = union(entry.bounds, annotation.bounds); }
      else this.entries.set(annotation.id, { id: annotation.id, annotations: [annotation],
        runs: runs.get(annotation.id) ?? [], bounds: { ...annotation.bounds } });
    }
  }
  get(id: string): AnnotationEntry {
    if (this.disposed) throw new Error("Annotation index disposed.");
    const entry = this.entries.get(id);
    if (!entry) throw new RangeError(`Unknown annotation: ${id}`);
    return entry;
  }
  async query(bounds: Bounds, signal?: AbortSignal): Promise<AnnotationEntry[]> {
    signal?.throwIfAborted();
    if (this.disposed) throw new DOMException("Annotation index disposed.", "AbortError");
    if (!this.prepared) {
      this.building ??= this.build().finally(() => { this.building = null; });
      await waitForLoad(this.building, signal);
    }
    if (this.disposed) throw new DOMException("Annotation index disposed.", "AbortError");
    signal?.throwIfAborted();
    return queryTree(this.root, bounds);
  }
  appearanceRanges(entry: AnnotationEntry, bounds: Bounds): readonly PrimitivePickRange[] {
    return entry.geometry ? queryTree(entry.geometry, bounds) : entry.runs;
  }
  dispose(): void { this.disposed = true; this.entries.clear(); this.root = null; }
  private async build(): Promise<void> {
    let operations = 0, time = performance.now();
    const primitiveCount = [...this.entries.values()].reduce((sum, entry) =>
      sum + entry.runs.reduce((count, run) => count + run.count, 0), 0);
    const groupSize = Math.max(64, Math.ceil(primitiveCount / MAX_GEOMETRY_BLOCKS));
    let blockCount = 0, warned = false;
    const check = (): void => { if (this.disposed) throw new DOMException("Annotation index disposed.", "AbortError"); };
    for (const entry of this.entries.values()) {
      check();
      const blocks: { bounds: Bounds; value: PrimitivePickRange }[] = [];
      let boundedScan = false;
      for (const annotation of entry.annotations) for (const path of metadataPaths(annotation)) for (const point of path.points) {
        const radius = metadataRadius(annotation);
        entry.bounds = union(entry.bounds, { minX: point.x - radius, minY: point.y - radius,
          maxX: point.x + radius, maxY: point.y + radius });
        if (++operations % 1024 === 0 && performance.now() - time >= 8) {
          await new Promise<void>(resolve => setTimeout(resolve, 0)); check(); time = performance.now();
        }
      }
      for (const run of entry.runs) for (let first = run.first; first < run.first + run.count; first += groupSize) {
        const count = Math.min(groupSize, run.first + run.count - first);
        let bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        for (let index = first; index < first + count; index++) {
          bounds = union(bounds, getScenePrimitiveBounds(this.scene, { kind: run.kind, index }));
          if (++operations % 1024 === 0 && performance.now() - time >= 8) {
            await new Promise<void>(resolve => setTimeout(resolve, 0)); check(); time = performance.now();
          }
        }
        entry.bounds = union(entry.bounds, bounds);
        if (blockCount < MAX_GEOMETRY_BLOCKS) {
          blockCount++;
          blocks.push({ bounds, value: { kind: run.kind, first, count, paintRun: run } });
        } else boundedScan = true;
      }
      entry.geometry = boundedScan ? null : spatialTree(blocks);
      if (boundedScan && !warned) {
        warned = true;
        console.warn("[HEPR] Annotation picking index reached its block budget; fragmented appearances use bounded-memory geometry scans.");
      }
    }
    check(); this.root = spatialTree([...this.entries.values()].map(value => ({ bounds: value.bounds, value }))); this.prepared = true;
  }
}

function metadataRadius(annotation: SceneAnnotation): number {
  const rect = annotation.pdfGeometry.rect, b = annotation.bounds;
  const sourceArea = Math.abs((rect[2] - rect[0]) * (rect[3] - rect[1]));
  const scale = sourceArea > 0 ? Math.sqrt(Math.abs((b.maxX - b.minX) * (b.maxY - b.minY)) / sourceArea) : 1;
  return Math.max(0, annotation.border?.width ?? 1) * scale / 2;
}
function segmentDistance(p: PrimitivePoint, a: PrimitivePoint, b: PrimitivePoint): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function contains(points: PrimitivePoint[], point: PrimitivePoint): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < a.x + (point.y - a.y) * (b.x - a.x) / (b.y - a.y)) inside = !inside;
  }
  return inside;
}

export function projectedAnnotationArea(annotation: SceneAnnotation, project: (point: PrimitivePoint) => PrimitivePoint | null): number {
  const projected = rectangle(annotation.bounds).points.map(project);
  if (projected.some(point => !point)) return Infinity;
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = projected[i]!, b = projected[(i + 1) % 4]!;
    area += a.x * b.y - a.y * b.x;
  }
  return Math.abs(area) / 2;
}

/** Metadata approximation only; compiled appearance misses never fall back to a broad rectangle. */
export function pickAnnotationMetadata(annotation: SceneAnnotation, client: PrimitivePoint,
  project: (point: PrimitivePoint) => PrimitivePoint | null, tolerance: number): number | null {
  let best = Infinity;
  for (const path of metadataPaths(annotation)) {
    const projected = path.points.map(project);
    if (projected.some(point => !point)) continue;
    const vertices = projected as PrimitivePoint[];
    if (path.filled && contains(vertices, client)) return 0;
    for (let i = 0; i < vertices.length; i++) {
      const next = i + 1 < vertices.length ? i + 1 : path.closed ? 0 : i;
      let radiusPx = 0;
      if (!path.filled) {
        const radius = metadataRadius(annotation), source = path.points[i], center = vertices[i];
        for (const edge of [{ x: source.x + radius, y: source.y }, { x: source.x, y: source.y + radius }]) {
          const p = project(edge);
          if (p) radiusPx = Math.max(radiusPx, Math.hypot(p.x - center.x, p.y - center.y));
        }
      }
      best = Math.min(best, Math.max(0, segmentDistance(client, vertices[i], vertices[next]) - radiusPx));
    }
  }
  return best <= tolerance ? best : null;
}

/** Metadata traces use the same native selection/hover materials as compiled appearances. */
export function buildAnnotationMetadataHighlights(selected: readonly SceneAnnotation[], hovered: readonly SceneAnnotation[],
  boundsOnly = false): PrimitiveHighlightSet | null {
  const values: number[] = [];
  let selectionCount = 0;
  for (const [index, annotations] of [selected, hovered].entries()) {
    for (const annotation of annotations) {
      const paths = boundsOnly ? [rectangle(annotation.bounds)] : metadataPaths(annotation);
      for (const path of paths) for (let i = 0; i < path.points.length; i++) {
        const a = path.points[i], b = path.points[i + 1] ?? (path.closed ? path.points[0] : a);
        if (i === path.points.length - 1 && !path.closed && path.points.length > 1) continue;
        if (values.length / 8 >= 262_144) throw new RangeError("Annotation metadata highlight exceeds its segment budget.");
        values.push(a.x, a.y, b.x, b.y, b.x, b.y, 0, -1);
      }
    }
    if (index === 0) selectionCount = values.length / 8;
  }
  return values.length ? { segments: Float32Array.from(values), clipPaths: [], selectionCount, count: values.length / 8 } : null;
}
