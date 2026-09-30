import type { VectorScene } from "./pdfVectorExtractor";
import { VectorDrawRunCuller } from "./vectorDrawRunCulling";
import { packVectorClips } from "./vectorClips";
import type { StrokeRecordSource } from "./strokeRecords";

/** Skip a redundant rectangle clip only when every possible instance stays inside. */
export class VectorRunClipElision {
  /** Renderer-only root + 1; zero skips geometric clipping in the shaders. */
  readonly clipCodes: Uint32Array;
  private readonly originals: Uint32Array;
  private readonly clearances: Float64Array;
  private padding = NaN;

  static create(scene: VectorScene, strokes: StrokeRecordSource & { sourceRuns: Uint32Array }): VectorRunClipElision | null {
    if (!scene.clipPaths?.length || !scene.drawRuns?.some(run => run.clipIndex !== undefined &&
      (run.kind === "stroke" || run.kind === "fill" || run.kind === "text"))) return null;
    return new VectorRunClipElision(scene, strokes);
  }

  private constructor(scene: VectorScene, strokes: StrokeRecordSource & { sourceRuns: Uint32Array }) {
    const runs = scene.drawRuns!;
    this.clipCodes = Uint32Array.from(runs, run => (run.clipIndex ?? -1) + 1);
    this.originals = this.clipCodes.slice();
    this.clearances = new Float64Array(runs.length).fill(-Infinity);
    // The shared packer recognizes exact closed rectangles and intersects
    // consecutive rectangle ancestors. A remaining parent means a polygon
    // still participates in the chain and its clip must remain active.
    const clips = packVectorClips(scene.clipPaths);
    const bounds = new VectorDrawRunCuller(scene, strokes);
    const hull = [0, 0, 0, 0];
    runs.forEach((run, index) => {
      if (run.clipIndex === undefined || (run.kind !== "stroke" && run.kind !== "fill" && run.kind !== "text")) return;
      const header = run.clipIndex * 4;
      if (clips[header] !== -1 || clips[header + 2] !== -1) return;
      const rectangle = clips[header + 1] * 4;
      bounds.getUnclippedBounds(index, 0, hull);
      if (!hull.every(Number.isFinite) || hull[0] > hull[2] || hull[1] > hull[3]) return;
      this.clearances[index] = Math.min(hull[0] - clips[rectangle], hull[1] - clips[rectangle + 1],
        clips[rectangle + 2] - hull[2], clips[rectangle + 3] - hull[3]);
    });
  }

  /** Unknown/perspective scale retains clipping; changes require an instance upload. */
  update(unitsPerPixel: number | null): boolean {
    const padding = unitsPerPixel !== null && Number.isFinite(unitsPerPixel) && unitsPerPixel > 0
      ? Math.max(0.001, 4 * 2 ** Math.ceil(Math.log2(Math.max(1e-6, unitsPerPixel)))) : Infinity;
    if (padding === this.padding) return false;
    this.padding = padding;
    let changed = false;
    for (let index = 0; index < this.clipCodes.length; index++) {
      // Include all combined LOD bounds, stroke widths, glyph transforms and
      // a conservative screen-space AA/hairline margin. Strict containment
      // keeps clip-edge fragments on the normal shader path.
      const code = this.clearances[index] > padding ? 0 : this.originals[index];
      if (this.clipCodes[index] !== code) { this.clipCodes[index] = code; changed = true; }
    }
    return changed;
  }
}
