import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import type { PrimitiveColorTexel } from "./nativePrimitiveColors";
import { vectorFillCoverageMetadata, type VectorFillCoverageMetadata } from "./vectorFillCoverage";
import type { VectorPathSegmentStore } from "./vectorFillBands";
import { GUARDED_RUN_COUNT, VISIBILITY_GUARD_PIXELS } from "./visibilityGuard";

interface Contour extends Bounds { first: number; count: number }
interface FillParts { first: number; count: number; separation: number }

/** Additional renderer-only paths address the original immutable segment store. */
export interface VectorFillDrawData extends VectorFillCoverageMetadata, VectorPathSegmentStore {
  readonly canonicalCount: number;
  readonly parts: ReadonlyMap<number, readonly FillParts[]>;
  /** Canonical IDs for the additional paths only. */
  readonly origins: Uint32Array;
}

const cache = new WeakMap<VectorScene, { source: readonly unknown[]; data: VectorFillDrawData }>();

function baseData(scene: VectorScene): VectorFillDrawData {
  return { ...vectorFillCoverageMetadata(scene), pathCount: scene.fillPathCount,
    canonicalCount: scene.fillPathCount, segmentCount: scene.fillSegmentCount,
    segmentsA: scene.fillSegmentsA, segmentsB: scene.fillSegmentsB,
    parts: new Map(), origins: new Uint32Array(0) };
}

function contoursOf(data: VectorFillDrawData, path: number): Contour[] | null {
  const offset = path * 4, first = data.pathMetaA[offset], count = data.pathMetaA[offset + 1];
  if (count < 6 || data.pathMetaC[offset] < 0) return null;
  // Most fills have one contour. Detect those without allocating any objects.
  let disconnected = false;
  for (let i = first + 1; i < first + count; i++) {
    if (data.segmentsA[i * 4] !== data.segmentsB[(i - 1) * 4] ||
        data.segmentsA[i * 4 + 1] !== data.segmentsB[(i - 1) * 4 + 1]) { disconnected = true; break; }
  }
  if (!disconnected) return null;
  const contours: Contour[] = [];
  let current: Contour | undefined;
  for (let i = first; i < first + count; i++) {
    const o = i * 4, x = data.segmentsA[o], y = data.segmentsA[o + 1];
    if (!current || x !== data.segmentsB[o - 4] || y !== data.segmentsB[o - 3]) {
      current = { first: i, count: 0, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      contours.push(current);
    }
    current.count++;
    current.minX = Math.min(current.minX, x, data.segmentsB[o]);
    current.minY = Math.min(current.minY, y, data.segmentsB[o + 1]);
    current.maxX = Math.max(current.maxX, x, data.segmentsB[o]);
    current.maxY = Math.max(current.maxY, y, data.segmentsB[o + 1]);
    if (data.segmentsB[o + 2] >= 1) {
      current.minX = Math.min(current.minX, data.segmentsA[o + 2]);
      current.minY = Math.min(current.minY, data.segmentsA[o + 3]);
      current.maxX = Math.max(current.maxX, data.segmentsA[o + 2]);
      current.maxY = Math.max(current.maxY, data.segmentsA[o + 3]);
    }
  }
  return contours;
}

/** Interval unions retain touching, overlapping and nested contours together. */
function partition(contours: readonly Contour[], axis: "X" | "Y", gap: number): {
  groups: Contour[]; separation: number; contiguous: boolean
} | null {
  const lower = axis === "X" ? "minX" : "minY", upper = axis === "X" ? "maxX" : "maxY";
  const sorted = [...contours].sort((a, b) => a[lower] - b[lower]);
  const groups: (Contour & { end: number })[] = [];
  let separation = Infinity, end = 0;
  for (const contour of sorted) {
    const previous = groups.at(-1);
    if (!previous || contour[lower] - previous[upper] > gap) {
      if (previous) separation = Math.min(separation, contour[lower] - previous[upper]);
      end = contour.first + contour.count;
      groups.push({ ...contour, end });
    } else {
      previous.first = Math.min(previous.first, contour.first);
      end = Math.max(end, contour.first + contour.count);
      previous.count += contour.count;
      previous.minX = Math.min(previous.minX, contour.minX);
      previous.minY = Math.min(previous.minY, contour.minY);
      previous.maxX = Math.max(previous.maxX, contour.maxX);
      previous.maxY = Math.max(previous.maxY, contour.maxY);
    }
    // A group must be one contiguous source range. Check after all members
    // have arrived: their spatial order need not match their source order.
    groups.at(-1)!.end = end;
  }
  if (groups.length < 2) return null;
  const contiguous = groups.every(group => group.first + group.count === group.end);
  groups.sort((a, b) => a.first - b.first);
  return { groups, separation, contiguous };
}

const area = (bounds: Bounds): number => (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);

/** Never changes canonical IDs, geometry, exports, picking or paint graph ranges. */
export function vectorFillDrawData(scene: VectorScene, maxPaths = Infinity): VectorFillDrawData {
  const source = [scene.fillPathMetaA, scene.fillPathMetaB, scene.fillPathMetaC, scene.fillSegmentsA,
    scene.fillSegmentsB, scene.fillPathCount, scene.fillSegmentCount, scene.drawRuns];
  const cached = cache.get(scene);
  let data = cached?.source.every((value, index) => value === source[index]) ? cached.data : undefined;
  if (!data) {
    const base = baseData(scene), additions: { source: number; groups: Contour[]; separation: number }[] = [];
    let additionalCount = 0;
    if (scene.drawRuns) for (let path = 0; path < base.canonicalCount; path++) {
      const contours = contoursOf(base, path);
      if (!contours) continue;
      const o = path * 4;
      const wholeArea = (base.pathMetaB[o] - base.pathMetaA[o + 2]) *
        (base.pathMetaB[o + 1] - base.pathMetaA[o + 3]);
      const candidates = new Map<string, { groups: Contour[]; separation: number; area: number }>();
      for (const axis of ["X", "Y"] as const) {
        let gap = 0;
        for (;;) {
          const candidate = partition(contours, axis, gap);
          if (!candidate) break;
          const sum = candidate.groups.reduce((total, group) => total + area(group), 0);
          // This is a benefit test, not a geometry/resource limit. Modest
          // savings do not justify more instances and metadata.
          if (candidate.contiguous && sum * 2 < wholeArea) {
            const key = candidate.groups.map(group => `${group.first}:${group.count}`).join(",");
            const previous = candidates.get(key);
            if (!previous || candidate.separation > previous.separation) {
              candidates.set(key, { ...candidate, area: sum });
            }
          }
          // Coarser groups keep close neighbours together as zoom decreases.
          // Every step merges at least one pair; there is no contour-count cap.
          gap = 2 ** Math.ceil(Math.log2(candidate.separation));
          if (!(gap > 0) || !Number.isFinite(gap)) break;
        }
      }
      for (const candidate of [...candidates.values()].sort((a, b) => a.area - b.area)) {
        additions.push({ source: path, groups: candidate.groups, separation: candidate.separation });
        additionalCount += candidate.groups.length;
      }
    }
    if (!additionalCount) data = base;
    else {
      const pathCount = base.canonicalCount + additionalCount;
      if (pathCount > maxPaths) return base;
      let pathMetaA: Float32Array, pathMetaB: Float32Array, pathMetaC: Float32Array, origins: Uint32Array;
      try {
        pathMetaA = new Float32Array(pathCount * 4); pathMetaB = new Float32Array(pathCount * 4);
        pathMetaC = new Float32Array(pathCount * 4); origins = new Uint32Array(additionalCount);
      } catch (error) {
        console.warn("[hepr] Sparse fill metadata allocation failed; retaining original vector fills.", error);
        return base;
      }
      pathMetaA.set(base.pathMetaA); pathMetaB.set(base.pathMetaB); pathMetaC.set(base.pathMetaC);
      const parts = new Map<number, FillParts[]>();
      let next = base.canonicalCount;
      for (const { source, groups, separation } of additions) {
        let variants = parts.get(source);
        if (!variants) parts.set(source, variants = []);
        variants.push({ first: next, count: groups.length, separation });
        const original = source * 4;
        for (const group of groups) {
          const offset = next * 4;
          pathMetaA.set([group.first, group.count, group.minX, group.minY], offset);
          pathMetaB.set([group.maxX, group.maxY, base.pathMetaB[original + 2], base.pathMetaB[original + 3]], offset);
          // Keep the original edge integration rather than enabling a new
          // small-hull approximation for a previously large compound path.
          pathMetaC.set([-(base.pathMetaC[original] + 1), 0,
            base.pathMetaC[original + 2], base.pathMetaC[original + 3]], offset);
          origins[next - base.canonicalCount] = source;
          next++;
        }
      }
      data = { ...base, pathCount, pathMetaA, pathMetaB, pathMetaC, parts, origins };
    }
    cache.set(scene, { source, data });
  }
  // Optional derived paths must not prevent an otherwise usable GPU upload.
  return data.pathCount <= maxPaths ? data : baseData(scene);
}

/** Preserve renderer-only bounds/rules and propagate canonical color overrides. */
export function fillDrawColorTexels(data: VectorFillDrawData, patches: PrimitiveColorTexel[]): PrimitiveColorTexel[] {
  const result: PrimitiveColorTexel[] = [];
  for (const patch of patches) {
    const metadata = patch.kind === "fillB" ? data.pathMetaB : patch.kind === "fillC" ? data.pathMetaC : null;
    if (!metadata) { result.push(patch); continue; }
    const write = (index: number): void => {
      const pixels = new Float32Array(patch.pixels);
      pixels[0] = metadata[index * 4]; pixels[1] = metadata[index * 4 + 1];
      result.push({ kind: patch.kind, index, pixels });
    };
    write(patch.index);
    const variants = data.parts.get(patch.index);
    if (variants) for (const parts of variants) {
      for (let id = parts.first; id < parts.first + parts.count; id++) write(id);
    }
  }
  return result;
}

/** Guarded per-fill visibility is shared by native WebGL and WebGPU batches. */
export class VectorFillDrawSelection {
  readonly data: VectorFillDrawData;
  readonly splitPaths = new Map<number, FillParts>();
  visible: Uint8Array | null = null;
  private padding = NaN;
  private window: Bounds | null = null;
  private initialized = false;

  constructor(data: VectorFillDrawData) { this.data = data; }

  update(unitsPerPixel: number | null, view: Readonly<Bounds> | null): boolean {
    if (!this.data.canonicalCount) return false;
    const known = unitsPerPixel !== null && Number.isFinite(unitsPerPixel) && unitsPerPixel > 0;
    const padding = known ? 2 ** Math.ceil(Math.log2(Math.max(0.001, unitsPerPixel * 4))) : Infinity;
    if (!known || !view || ![view.minX, view.minY, view.maxX, view.maxY].every(Number.isFinite) ||
        view.minX > view.maxX || view.minY > view.maxY) view = null;
    const previous = this.window;
    const guard = known && this.data.canonicalCount >= GUARDED_RUN_COUNT ? VISIBILITY_GUARD_PIXELS * unitsPerPixel : 0;
    if (this.initialized && padding === this.padding &&
        ((!view && !previous) || (view && previous && view.minX >= previous.minX && view.minY >= previous.minY &&
          view.maxX <= previous.maxX && view.maxY <= previous.maxY &&
          previous.maxX - previous.minX <= view.maxX - view.minX + guard * 4 &&
          previous.maxY - previous.minY <= view.maxY - view.minY + guard * 4))) return false;
    let changed = !this.initialized;
    this.initialized = true;
    this.padding = padding;
    for (const [path, variants] of this.data.parts) {
      // The two padded component bounds must not overlap: otherwise the
      // original fill's nonlinear winding/alpha calculation remains necessary.
      const parts = known ? variants.find(variant => variant.separation > 2 * padding) : undefined;
      if (this.splitPaths.get(path) !== parts) changed = true;
      if (parts) this.splitPaths.set(path, parts);
      else this.splitPaths.delete(path);
    }
    this.window = view ? { minX: view.minX - guard, minY: view.minY - guard,
      maxX: view.maxX + guard, maxY: view.maxY + guard } : null;
    if (!this.window) { changed ||= this.visible?.some(flag => flag === 0) ?? false; this.visible = null; }
    else {
      const flags = this.visible ?? new Uint8Array(this.data.pathCount), box = this.window;
      const a = this.data.pathMetaA, b = this.data.pathMetaB;
      for (let id = 0; id < this.data.pathCount; id++) {
        const o = id * 4;
        // Invalid legacy bounds are retained conservatively.
        const visible = b[o] < box.minX - padding || b[o + 1] < box.minY - padding ||
          a[o + 2] > box.maxX + padding || a[o + 3] > box.maxY + padding ? 0 : 1;
        if ((this.visible ? flags[id] : 1) !== visible) changed = true;
        flags[id] = visible;
      }
      this.visible = flags;
    }
    return changed;
  }
}
