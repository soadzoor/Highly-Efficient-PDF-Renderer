import { Color } from "three";
import type { Bounds, VectorClipPath, VectorScene } from "./pdfVectorExtractor";
import { buildGradientMeshBoundary } from "./gradientMeshBoundary";
import { MAX_VECTOR_CLIP_EDGES } from "./vectorClips";
import {
  getPrimitiveClipChain, getPrimitiveSegmentClipBounds, getScenePrimitive, validatePrimitiveRef,
  type PrimitiveInfo, type PrimitiveKind, type PrimitiveRef
} from "./scenePrimitives";

export type PrimitiveColorInput = string | number | readonly [number, number, number];
export interface PrimitiveOverride { color: PrimitiveColorInput }
export interface PrimitiveColorUpdate {
  ref: PrimitiveRef;
  /** sRGB channels; null restores the immutable scene's original color. */
  color: [number, number, number] | null;
}

/** Compact canonical line/quadratic traces; selection precedes hover. */
export interface PrimitiveHighlightSet {
  /** Eight floats: start.xy, control.xy, end.xy, quadratic flag, clip index. */
  segments: Float32Array;
  clipPaths: VectorClipPath[];
  selectionCount: number;
  count: number;
}

export const PRIMITIVE_SELECTION_COLOR: readonly [number, number, number] = [0.15, 0.45, 1];
export const PRIMITIVE_HOVER_COLOR: readonly [number, number, number] = [1, 0.65, 0.05];
export const PRIMITIVE_TRACE_WIDTH_PX = 2;

export function primitiveRefKey(ref: PrimitiveRef): string { return `${ref.kind}:${ref.index}`; }

/** Parse without applying Three's automatic sRGB-to-linear conversion. */
export function normalizePrimitiveColor(input: PrimitiveColorInput): [number, number, number] {
  if (Array.isArray(input)) {
    if (input.length !== 3 || !input.every(Number.isFinite)) throw new TypeError("Invalid primitive color channels.");
    return input.map(value => Math.max(0, Math.min(1, value))) as [number, number, number];
  }
  let packed: number;
  if (typeof input === "number") packed = input;
  else if (typeof input === "string") {
    const value = input.trim().toLowerCase();
    if (/^#[\da-f]{3}$/.test(value)) packed = parseInt(value.slice(1).split("").map(c => c + c).join(""), 16);
    else if (/^#?[\da-f]{6}$/.test(value)) packed = parseInt(value.replace(/^#/, ""), 16);
    else if (Object.hasOwn(Color.NAMES, value)) packed = Color.NAMES[value as keyof typeof Color.NAMES];
    else throw new TypeError(`Unsupported primitive color: ${input}`);
  } else throw new TypeError("Invalid primitive color.");
  if (!Number.isInteger(packed) || packed < 0 || packed > 0xffffff) throw new TypeError("Invalid primitive color number.");
  return [(packed >>> 16) / 255, ((packed >>> 8) & 255) / 255, (packed & 255) / 255];
}

interface AppearanceCallbacks {
  onColors?(updates: readonly PrimitiveColorUpdate[]): void;
  onHighlights?(highlights: PrimitiveHighlightSet | null): void;
}

/** Viewer-owned interaction state. Never writes to the supplied VectorScene. */
export class PrimitiveAppearanceState {
  private readonly colors = new Map<string, PrimitiveColorUpdate>();
  private selected: PrimitiveRef[] = [];
  private hover: PrimitiveRef | null = null;
  private annotationSelected: PrimitiveRef[] = [];
  private annotationHovered: PrimitiveRef[] = [];
  private annotationFallback: PrimitiveHighlightSet | null = null;
  private highlights: PrimitiveHighlightSet | null = null;
  private disposed = false;
  private readonly scene: VectorScene;
  private readonly callbacks: AppearanceCallbacks;

  constructor(scene: VectorScene, callbacks: AppearanceCallbacks = {}) {
    this.scene = scene;
    this.callbacks = callbacks;
  }

  getSelection(): PrimitiveRef[] { return this.selected.map(ref => ({ ...ref })); }
  getHover(): PrimitiveRef | null { return this.hover && { ...this.hover }; }
  getOverrideColor(ref: PrimitiveRef): [number, number, number] | null {
    validatePrimitiveRef(this.scene, ref);
    const color = this.colors.get(primitiveRefKey(ref))?.color;
    return color ? [...color] : null;
  }
  getHighlights(): PrimitiveHighlightSet | null { return this.highlights; }
  getColorUpdates(): PrimitiveColorUpdate[] {
    return [...this.colors.values()].map(({ ref, color }) => ({ ref: { ...ref }, color: color && [...color] }));
  }
  hasAnyOverrides(): boolean { return this.colors.size > 0; }
  hasOverrides(kind: PrimitiveKind): boolean {
    for (const update of this.colors.values()) if (update.ref.kind === kind) return true;
    return false;
  }

  setHover(ref: PrimitiveRef | null): void {
    this.assertLive();
    if (ref) validatePrimitiveRef(this.scene, ref);
    if (ref ? this.hover && primitiveRefKey(ref) === primitiveRefKey(this.hover) : !this.hover) return;
    const next = ref && { ...ref };
    const highlights = this.buildHighlights(this.selected, next);
    this.hover = next;
    this.highlights = highlights;
    this.callbacks.onHighlights?.(highlights);
  }

  setSelection(refs: readonly PrimitiveRef[]): void {
    this.assertLive();
    const next = this.validateRefs(refs);
    if (next.length === this.selected.length && next.every((ref, index) => primitiveRefKey(ref) === primitiveRefKey(this.selected[index]))) return;
    const highlights = this.buildHighlights(next, this.hover);
    this.selected = next;
    this.highlights = highlights;
    this.callbacks.onHighlights?.(highlights);
  }

  /** Additional annotation interaction state; ordinary primitive selection stays independent. */
  setAnnotationHighlights(selected: readonly PrimitiveRef[], hovered: readonly PrimitiveRef[], fallback: PrimitiveHighlightSet | null): void {
    this.assertLive();
    const nextSelected = this.validateRefs(selected), nextHovered = this.validateRefs(hovered);
    const highlights = mergePrimitiveHighlights(buildPrimitiveHighlights(this.scene,
      [...this.selected, ...nextSelected], [...(this.hover ? [this.hover] : []), ...nextHovered],
      nextSelected.length || nextHovered.length ? 262_144 : Infinity,
      !!(nextSelected.length || nextHovered.length || fallback)), fallback);
    this.annotationSelected = nextSelected; this.annotationHovered = nextHovered; this.annotationFallback = fallback;
    this.highlights = highlights; this.callbacks.onHighlights?.(highlights);
  }

  private buildHighlights(selected: readonly PrimitiveRef[], hover: PrimitiveRef | null): PrimitiveHighlightSet | null {
    return mergePrimitiveHighlights(buildPrimitiveHighlights(this.scene, [...selected, ...this.annotationSelected],
      [...(hover ? [hover] : []), ...this.annotationHovered], Infinity,
      !!(this.annotationSelected.length || this.annotationHovered.length || this.annotationFallback)), this.annotationFallback);
  }

  setOverrides(refs: readonly PrimitiveRef[], override: PrimitiveOverride): void {
    this.assertLive();
    const next = this.validateRefs(refs);
    if (next.some(ref => ref.kind === "raster")) throw new TypeError("Raster layers support highlighting, but not color overrides.");
    const color = normalizePrimitiveColor(override?.color);
    const updates = next.filter(ref => {
      const previous = this.colors.get(primitiveRefKey(ref))?.color;
      return !previous || previous.some((value, channel) => value !== color[channel]);
    }).map(ref => ({ ref, color: [...color] as [number, number, number] }));
    for (const update of updates) this.colors.set(primitiveRefKey(update.ref), update);
    if (updates.length) this.callbacks.onColors?.(updates);
  }

  clearOverrides(refs?: readonly PrimitiveRef[]): void {
    this.assertLive();
    const next = refs === undefined ? [...this.colors.values()].map(update => update.ref) : this.validateRefs(refs);
    const updates: PrimitiveColorUpdate[] = [];
    for (const ref of next) if (this.colors.delete(primitiveRefKey(ref))) updates.push({ ref, color: null });
    if (updates.length) this.callbacks.onColors?.(updates);
  }

  clear(): void {
    this.assertLive();
    this.clearOverrides();
    const hadHighlights = this.highlights !== null;
    this.selected = [];
    this.hover = null;
    this.annotationSelected = []; this.annotationHovered = []; this.annotationFallback = null;
    this.highlights = null;
    if (hadHighlights) this.callbacks.onHighlights?.(null);
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("Primitive appearance state has been disposed.");
  }
  private validateRefs(refs: readonly PrimitiveRef[]): PrimitiveRef[] {
    if (!Array.isArray(refs)) throw new TypeError("Primitive references must be an array.");
    const unique = new Map<string, PrimitiveRef>();
    for (const ref of refs) {
      validatePrimitiveRef(this.scene, ref);
      unique.set(primitiveRefKey(ref), { ...ref });
    }
    return [...unique.values()];
  }
}

export function buildPrimitiveHighlights(
  scene: VectorScene, selected: readonly PrimitiveRef[], hover: PrimitiveRef | readonly PrimitiveRef[] | null,
  maxSegments = Infinity, deduplicate = false
): PrimitiveHighlightSet | null {
  const hovered = !hover ? [] : Array.isArray(hover) ? hover : [hover as PrimitiveRef];
  let refs = [...selected, ...hovered];
  if (deduplicate) {
    const unique = new Map<string, PrimitiveRef>();
    for (const ref of selected) unique.set(primitiveRefKey(ref), ref);
    selected = [...unique.values()]; refs = [...selected];
    for (const ref of hovered) if (!unique.has(primitiveRefKey(ref))) {
      unique.set(primitiveRefKey(ref), ref); refs.push(ref);
    }
  }
  if (!refs.length) return null;
  const traces = new Map<string, { primitive: PrimitiveInfo; mesh?: ReturnType<typeof buildGradientMeshBoundary> }>();
  let count = 0;
  let selectionCount = 0;
  for (let index = 0; index < refs.length; index++) {
    const key = primitiveRefKey(refs[index]);
    let trace = traces.get(key);
    if (!trace) {
      const primitive = getScenePrimitive(scene, refs[index]);
      const mesh = primitive.kind === "gradient-fill" && primitive.shadingKind === "mesh"
        ? buildGradientMeshBoundary(scene, primitive.gradientIndex!) : undefined;
      traces.set(key, trace = { primitive, ...(mesh ? { mesh } : {}) });
    }
    count += trace.mesh ? trace.mesh.edges.length / 4 : trace.primitive.segmentCount;
    if (count > maxSegments) throw new RangeError("Annotation highlight trace exceeds its segment budget.");
    if (index === selected.length - 1) selectionCount = count;
  }
  if (!count) return null;
  const segments = new Float32Array(count * 8);
  const clipPaths: VectorClipPath[] = [];
  const clipMap = new Map<number, number>();
  const rectMap = new Map<string, number>();
  const copyClip = (index: number): number => {
    if (index < 0) return -1;
    const previous = clipMap.get(index);
    if (previous !== undefined) return previous;
    const clip = scene.clipPaths?.[index];
    if (!clip) throw new RangeError("Invalid primitive clip reference.");
    const parent = copyClip(clip.parent);
    const next = clipPaths.length;
    clipPaths.push({ parent, fillRule: clip.fillRule, edges: clip.edges.slice() });
    clipMap.set(index, next);
    return next;
  };
  const appendRect = (parent: number, rect: Bounds | undefined): number => {
    if (!rect) return parent;
    const { minX: x0, minY: y0, maxX: x1, maxY: y1 } = rect;
    const key = `${parent}:${x0}:${y0}:${x1}:${y1}`;
    const previous = rectMap.get(key);
    if (previous !== undefined) return previous;
    const next = clipPaths.length;
    clipPaths.push({ parent, fillRule: 0, edges: Float32Array.of(x0,y0,x1,y0, x1,y0,x1,y1, x1,y1,x0,y1, x0,y1,x0,y0) });
    rectMap.set(key, next);
    return next;
  };
  let cursor = 0;
  const meshClips = new Map<string, number>();
  for (const ref of refs) {
    const key = primitiveRefKey(ref);
    const { primitive, mesh } = traces.get(key)!;
    const clip = getPrimitiveClipChain(scene, ref);
    const baseClip = appendRect(copyClip(clip.clipIndex), clip.rect);
    if (mesh) {
      let clipIndex = meshClips.get(key);
      if (clipIndex === undefined) {
        clipIndex = clipPaths.length;
        clipPaths.push({ parent: baseClip, fillRule: primitive.fillRule === "evenodd" ? 1 : 0,
          edges: primitiveContourClip(primitive) });
        if (mesh.domainClip) {
          clipPaths.push({ parent: clipIndex, fillRule: 0, edges: mesh.domainClip });
          clipIndex = clipPaths.length - 1;
        }
        meshClips.set(key, clipIndex);
      }
      for (let i = 0; i < mesh.edges.length; i += 4) {
        const x0 = mesh.edges[i], y0 = mesh.edges[i + 1], x1 = mesh.edges[i + 2], y1 = mesh.edges[i + 3];
        segments.set([x0, y0, x1, y1, x1, y1, 0, clipIndex], cursor);
        cursor += 8;
      }
      continue;
    }
    for (let index = 0; index < primitive.segmentCount; index++) {
      const segment = primitive.getSegment(index);
      const control = segment.control ?? segment.end;
      const clipIndex = ref.kind === "gradient-stroke"
        ? appendRect(baseClip, getPrimitiveSegmentClipBounds(scene, ref, index)) : baseClip;
      segments.set([segment.start.x, segment.start.y, control.x, control.y, segment.end.x, segment.end.y,
        segment.control ? 1 : 0, clipIndex], cursor);
      cursor += 8;
    }
  }
  return { segments, clipPaths, selectionCount, count };
}

/** Merge packets while keeping selected traces ahead of hovered traces and remapping clips. */
export function mergePrimitiveHighlights(a: PrimitiveHighlightSet | null, b: PrimitiveHighlightSet | null): PrimitiveHighlightSet | null {
  if (!a) return b;
  if (!b) return a;
  const segments = new Float32Array((a.count + b.count) * 8);
  const clipPaths = [...a.clipPaths, ...b.clipPaths.map(clip => ({ ...clip, parent: clip.parent < 0 ? -1 : clip.parent + a.clipPaths.length }))];
  let cursor = 0;
  const copy = (packet: PrimitiveHighlightSet, first: number, end: number, clipOffset: number): void => {
    for (let i = first; i < end; i++) {
      segments.set(packet.segments.subarray(i * 8, i * 8 + 8), cursor);
      if (segments[cursor + 7] >= 0) segments[cursor + 7] += clipOffset;
      cursor += 8;
    }
  };
  copy(a, 0, a.selectionCount, 0); copy(b, 0, b.selectionCount, a.clipPaths.length);
  copy(a, a.selectionCount, a.count, 0); copy(b, b.selectionCount, b.count, a.clipPaths.length);
  return { segments, clipPaths, selectionCount: a.selectionCount + b.selectionCount, count: a.count + b.count };
}

/** Clip approximation matches the existing vector clip tolerance; traced curves stay quadratic. */
function primitiveContourClip(primitive: PrimitiveInfo): Float32Array {
  const edges: number[] = [];
  const line = (x0: number, y0: number, x1: number, y1: number): void => {
    if (x0 === x1 && y0 === y1) return;
    if (edges.length / 4 >= MAX_VECTOR_CLIP_EDGES) throw new RangeError("Mesh highlight paint clipping exceeds its edge budget.");
    edges.push(x0, y0, x1, y1);
  };
  const quadratic = (x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, depth = 0): void => {
    const dx = x1 - x0, dy = y1 - y0;
    const t = Math.max(0, Math.min(1, ((cx - x0) * dx + (cy - y0) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(cx - x0 - t * dx, cy - y0 - t * dy) <= 0.0001) { line(x0, y0, x1, y1); return; }
    if (depth >= 20) throw new RangeError("Mesh highlight paint clipping exceeds its subdivision budget.");
    const ax = (x0 + cx) / 2, ay = (y0 + cy) / 2, bx = (cx + x1) / 2, by = (cy + y1) / 2;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    quadratic(x0, y0, ax, ay, mx, my, depth + 1);
    quadratic(mx, my, bx, by, x1, y1, depth + 1);
  };
  if (primitive.segmentCount > MAX_VECTOR_CLIP_EDGES) throw new RangeError("Mesh highlight paint clipping exceeds its edge budget.");
  for (let i = 0; i < primitive.segmentCount; i++) {
    const { start, control, end } = primitive.getSegment(i);
    if (control) quadratic(start.x, start.y, control.x, control.y, end.x, end.y);
    else line(start.x, start.y, end.x, end.y);
  }
  return Float32Array.from(edges);
}
