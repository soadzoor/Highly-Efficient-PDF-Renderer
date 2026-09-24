import type { Bounds, VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import { retainedRasterBounds } from "./retainedRasterBounds";

/** Conservative paint bounds. Filtering retains the original order and instance ranges. */
export class VectorDrawRunCuller {
  /**
   * Per-run membership from the most recent select(), for callers that address
   * runs by index instead of walking the returned array. null means every run
   * passed, so an index test is unnecessary.
   */
  selected: Uint8Array | null = null;
  private selectedFlags: Uint8Array | null = null;
  private readonly bounds: Float64Array;
  private readonly visible: VectorDrawRun[] = [];
  private readonly scene: VectorScene;
  private readonly clipBounds: number[][];
  private paddedBounds: Float64Array | null = null;
  private padding = NaN;
  private allPaddedBounds: Bounds | null = null;

  constructor(scene: VectorScene, strokes?: { scene: VectorScene; sourceRuns: Uint32Array }) {
    this.scene = scene;
    const runs = scene.drawRuns ?? [];
    this.bounds = new Float64Array(runs.length * 4);
    const clipBounds = (scene.clipPaths ?? []).map(clip => {
      const result = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i < clip.edges.length; i += 2) {
        result[0] = Math.min(result[0], clip.edges[i]);
        result[1] = Math.min(result[1], clip.edges[i + 1]);
        result[2] = Math.max(result[2], clip.edges[i]);
        result[3] = Math.max(result[3], clip.edges[i + 1]);
      }
      return result;
    });
    this.clipBounds = clipBounds;
    scene.clipPaths?.forEach((clip, index) => {
      if (clip.parent >= 0) intersect(clipBounds[index], clipBounds[clip.parent]);
    });
    runs.forEach((run, runIndex) => {
      const bounds = [Infinity, Infinity, -Infinity, -Infinity];
      const include = (x: number, y: number, margin = 0): void => {
        bounds[0] = Math.min(bounds[0], x - margin); bounds[1] = Math.min(bounds[1], y - margin);
        bounds[2] = Math.max(bounds[2], x + margin); bounds[3] = Math.max(bounds[3], y + margin);
      };
      for (let index = run.first; index < run.first + run.count; index++) {
        const offset = index * 4;
        if (run.kind === "stroke") {
          // Use the complete control hull, including wide/round/square stroke extents.
          const margin = Math.SQRT2 * Math.max(0, scene.styles[offset]);
          include(scene.endpoints[offset], scene.endpoints[offset + 1], margin);
          include(scene.endpoints[offset + 2], scene.endpoints[offset + 3], margin);
          include(scene.primitiveMeta[offset], scene.primitiveMeta[offset + 1], margin);
        } else if (run.kind === "fill") {
          include(scene.fillPathMetaA[offset + 2], scene.fillPathMetaA[offset + 3]);
          include(scene.fillPathMetaB[offset], scene.fillPathMetaB[offset + 1]);
        } else if (run.kind === "text") {
          const glyph = Math.round(scene.textInstanceB[offset + 2]) * 4;
          for (const x of [scene.textGlyphMetaA[glyph + 2], scene.textGlyphMetaB[glyph]]) {
            for (const y of [scene.textGlyphMetaA[glyph + 3], scene.textGlyphMetaB[glyph + 1]]) {
              include(scene.textInstanceA[offset] * x + scene.textInstanceA[offset + 2] * y + scene.textInstanceB[offset],
                scene.textInstanceA[offset + 1] * x + scene.textInstanceA[offset + 3] * y + scene.textInstanceB[offset + 1]);
            }
          }
        } else if (run.kind === "raster") {
          const retained = retainedRasterBounds(scene, index);
          if (retained) {
            include(retained.minX, retained.minY); include(retained.maxX, retained.maxY);
            continue;
          }
          const m = scene.rasterLayers[index].matrix;
          for (const x of [0, 1]) for (const y of [0, 1]) include(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
        } else {
          // Legacy gradient stores have separate culling conventions. Retain them conservatively.
          bounds.splice(0, 4, -Infinity, -Infinity, Infinity, Infinity);
          break;
        }
      }
      this.bounds.set(bounds, runIndex * 4);
    });
    if (strokes) {
      runs.forEach((run, index) => {
        if (run.kind === "stroke") this.bounds.set([Infinity, Infinity, -Infinity, -Infinity], index * 4);
      });
      for (let index = 0; index < strokes.scene.segmentCount; index++) {
        includeStroke(this.bounds, strokes.sourceRuns[index] * 4, strokes.scene, index);
      }
    }
  }

  /** Conservative geometry hull, before the run's geometric clip is applied. */
  getUnclippedBounds(index: number, padding: number, output: number[]): void {
    const offset = index * 4;
    output[0] = this.bounds[offset] - padding; output[1] = this.bounds[offset + 1] - padding;
    output[2] = this.bounds[offset + 2] + padding; output[3] = this.bounds[offset + 3] + padding;
  }

  /** Expand geometry for screen-space coverage before intersecting its vector clip. */
  getBounds(index: number, padding: number, output: number[]): void {
    this.getUnclippedBounds(index, padding, output);
    const clipIndex = this.scene.drawRuns![index].clipIndex;
    if (clipIndex !== undefined) intersect(output, this.clipBounds[clipIndex]);
  }

  select(view: Readonly<Bounds> | null, unitsPerPixel: number, extraMargin = 0): readonly VectorDrawRun[] {
    const runs = this.scene.drawRuns ?? [];
    this.selected = null;
    if (!view) return runs;
    // Hairlines and analytic antialiasing grow in screen pixels, independently of source widths.
    const pad = Math.max(extraMargin, 0.001, unitsPerPixel * 4);
    // Panning changes the view, but not paint extents. Intersect clip bounds
    // once per padding change instead of for every run on every frame.
    if (!this.paddedBounds || this.padding !== pad) {
      this.paddedBounds ??= new Float64Array(this.bounds.length);
      this.padding = pad;
      const box = [0, 0, 0, 0];
      const all = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      let allNonempty = true;
      for (let index = 0; index < runs.length; index++) {
        this.getBounds(index, pad, box);
        this.paddedBounds.set(box, index * 4);
        if (box[0] > box[2] || box[1] > box[3]) allNonempty = false;
        all.minX = Math.min(all.minX, box[0]); all.minY = Math.min(all.minY, box[1]);
        all.maxX = Math.max(all.maxX, box[2]); all.maxY = Math.max(all.maxY, box[3]);
      }
      this.allPaddedBounds = allNonempty ? all : null;
    }
    const all = this.allPaddedBounds;
    if (all && view.minX <= all.minX && view.minY <= all.minY && view.maxX >= all.maxX && view.maxY >= all.maxY) return runs;
    this.visible.length = 0;
    const bounds = this.paddedBounds;
    if (!this.selectedFlags || this.selectedFlags.length !== runs.length) this.selectedFlags = new Uint8Array(runs.length);
    const flags = this.selectedFlags;
    flags.fill(0);
    for (let index = 0; index < runs.length; index++) {
      const offset = index * 4;
      const minX = bounds[offset], minY = bounds[offset + 1];
      const maxX = bounds[offset + 2], maxY = bounds[offset + 3];
      if (minX > maxX || minY > maxY || maxX < view.minX || maxY < view.minY ||
          minX > view.maxX || minY > view.maxY) continue;
      flags[index] = 1;
      this.visible.push(runs[index]);
    }
    if (this.visible.length === runs.length) return runs;
    this.selected = flags;
    return this.visible;
  }
}

function includeStroke(bounds: Float64Array, target: number, scene: VectorScene, index: number): void {
  const offset = index * 4;
  const margin = Math.SQRT2 * Math.max(0, scene.styles[offset]);
  const flags = Math.floor(scene.primitiveMeta[offset + 3] / 2 + 1e-6);
  // A clipped primitive can never paint outside its fragment-clip rectangle.
  // Using the entire rectangle is conservative even for hairlines near its edge.
  const clipped = (flags & 4) !== 0;
  const minX = clipped ? scene.primitiveBounds[offset] : Math.min(scene.endpoints[offset], scene.endpoints[offset + 2], scene.primitiveMeta[offset]) - margin;
  const minY = clipped ? scene.primitiveBounds[offset + 1] : Math.min(scene.endpoints[offset + 1], scene.endpoints[offset + 3], scene.primitiveMeta[offset + 1]) - margin;
  const maxX = clipped ? scene.primitiveBounds[offset + 2] : Math.max(scene.endpoints[offset], scene.endpoints[offset + 2], scene.primitiveMeta[offset]) + margin;
  const maxY = clipped ? scene.primitiveBounds[offset + 3] : Math.max(scene.endpoints[offset + 1], scene.endpoints[offset + 3], scene.primitiveMeta[offset + 1]) + margin;
  bounds[target] = Math.min(bounds[target], minX); bounds[target + 1] = Math.min(bounds[target + 1], minY);
  bounds[target + 2] = Math.max(bounds[target + 2], maxX); bounds[target + 3] = Math.max(bounds[target + 3], maxY);
}

export function vectorViewBounds(width: number, height: number, x: number, y: number, zoom: number): Bounds {
  const halfWidth = width / (2 * Math.max(zoom, 1e-6));
  const halfHeight = height / (2 * Math.max(zoom, 1e-6));
  return { minX: x - halfWidth, minY: y - halfHeight, maxX: x + halfWidth, maxY: y + halfHeight };
}

function intersect(bounds: number[], clip: number[]): void {
  bounds[0] = Math.max(bounds[0], clip[0]); bounds[1] = Math.max(bounds[1], clip[1]);
  bounds[2] = Math.min(bounds[2], clip[2]); bounds[3] = Math.min(bounds[3], clip[3]);
}
