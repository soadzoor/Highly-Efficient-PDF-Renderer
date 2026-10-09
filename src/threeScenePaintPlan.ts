import type { Bounds, VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import type { ScenePaintMask } from "./scenePaintGraph";
import { compositeScenePaintGraph, type PdfCompositeOperation, type ScenePaintCompositorAdapter } from "./scenePaintCompositor";

type Operation =
  | { kind: "acquire" | "release"; surface: number }
  | { kind: "clear"; surface: number; color?: readonly [number, number, number, number]; bounds?: Bounds }
  | { kind: "copy"; source: number; destination: number; bounds?: Bounds }
  | { kind: "draw"; runs: readonly VectorDrawRun[]; destination: number; shapeOnly: boolean }
  | { kind: "pass"; operation: PdfCompositeOperation<number>; destination: number }
  | { kind: "fold"; run: VectorDrawRun; destination: number; opacity: number; mask?: number;
    content?: ScenePaintMask; maskRun?: VectorDrawRun };

interface Capability { run: VectorDrawRun; maskRun?: VectorDrawRun; accepted: boolean }
interface Plan { operations: Operation[]; capabilities: Capability[]; result: number }

/**
 * A stable selection's graph work, with symbolic surfaces rather than GPU resources.
 * Replay still acquires surfaces and applies each adapter operation, so projected
 * rectangles, uniform values and pending-batch dependencies remain frame-local.
 * Scene graphs and draw runs follow the renderer's existing immutable-scene policy.
 */
export class ThreeScenePaintPlan {
  private plan: Plan | null = null;
  private scene: VectorScene | null = null;
  private roots: VectorScene["paintGraph"];
  private runs: VectorScene["drawRuns"];
  private revision: number | undefined;
  private structure = 0;
  private width = 0;
  private height = 0;
  private blendsPasses: boolean | undefined;
  private colorBatchingEnabled: boolean | undefined;
  private selected: Uint8Array | null = null;
  /** Whether the last execution reused its graph operations. */
  reused = false;
  /** Number of graph operations replayed by the last execution. */
  operations = 0;

  execute<Surface>(scene: VectorScene, adapter: ScenePaintCompositorAdapter<Surface>, backdrop: Surface,
    visible: (condition?: number) => boolean, selected: Uint8Array | null,
    revision: number | undefined, structure: number, width: number, height: number,
    colorBatchingEnabled = true): Surface {
    // Callers without an explicit visibility revision keep the ordinary path.
    // A callback's identity cannot identify its mutable visibility state.
    if (revision === undefined || (globalThis as { HEPR_DEBUG_COMPOSITE_STATS?: boolean }).HEPR_DEBUG_COMPOSITE_STATS) {
      this.clear();
      return compositeScenePaintGraph(scene, adapter, backdrop, visible, selected, true, colorBatchingEnabled);
    }
    const compatible = this.plan && this.scene === scene && this.roots === scene.paintGraph && this.runs === scene.drawRuns &&
      this.revision === revision && this.structure === structure && this.width === width && this.height === height &&
      this.blendsPasses === adapter.blendsPasses && this.colorBatchingEnabled === colorBatchingEnabled &&
      sameSelection(this.selected, selected) && this.plan.capabilities.every(capability =>
        (capability.maskRun ? adapter.canFoldMaskPaint?.(capability.run, capability.maskRun) : adapter.canFold?.(capability.run)) ===
          capability.accepted);
    this.reused = !!compatible;
    if (!compatible) {
      // Commit only a completely built plan; a failed graph must not remain cached.
      this.plan = null;
      const plan = recordPlan(scene, adapter, visible, selected, colorBatchingEnabled);
      this.scene = scene; this.roots = scene.paintGraph; this.runs = scene.drawRuns;
      this.revision = revision; this.structure = structure; this.width = width; this.height = height;
      this.blendsPasses = adapter.blendsPasses;
      this.colorBatchingEnabled = colorBatchingEnabled;
      this.selected = selected?.slice() ?? null;
      this.plan = plan;
    }
    this.operations = this.plan!.operations.length;
    return replayPlan(this.plan!, adapter, backdrop);
  }

  clear(): void {
    this.plan = null; this.scene = null; this.roots = undefined; this.runs = undefined;
    this.selected = null; this.reused = false; this.operations = 0;
  }
}

function sameSelection(previous: Uint8Array | null, selected: Uint8Array | null): boolean {
  if (!previous || !selected) return previous === selected;
  return previous.length === selected.length && selected.every((value, index) => value === previous[index]);
}

function recordPlan<Surface>(scene: VectorScene, adapter: ScenePaintCompositorAdapter<Surface>,
  visible: (condition?: number) => boolean, selected: Uint8Array | null, colorBatchingEnabled: boolean): Plan {
  const operations: Operation[] = [], capabilities: Capability[] = [];
  let nextSurface = 0;
  const recording: ScenePaintCompositorAdapter<number> = {
    blendsPasses: adapter.blendsPasses,
    acquire: () => { const surface = ++nextSurface; operations.push({ kind: "acquire", surface }); return surface; },
    release: surface => { operations.push({ kind: "release", surface }); },
    clear: (surface, color, bounds) => { operations.push({ kind: "clear", surface, color, bounds }); },
    copy: (source, destination, bounds) => { operations.push({ kind: "copy", source, destination, bounds }); },
    draw: (runs, destination, shapeOnly) => { operations.push({ kind: "draw", runs, destination, shapeOnly }); },
    pass: (operation, destination) => { operations.push({ kind: "pass", operation, destination }); },
    canFold: adapter.canFold && (run => {
      const accepted = adapter.canFold!(run); capabilities.push({ run, accepted }); return accepted;
    }),
    canFoldMaskPaint: adapter.canFoldMaskPaint && ((run, maskRun) => {
      const accepted = adapter.canFoldMaskPaint!(run, maskRun);
      capabilities.push({ run, maskRun, accepted }); return accepted;
    }),
    drawFolded: adapter.drawFolded && ((run, destination, opacity, mask, content, maskRun) => {
      operations.push({ kind: "fold", run, destination, opacity, mask, content, maskRun });
    })
  };
  const result = compositeScenePaintGraph(scene, recording, 0, visible, selected, true, colorBatchingEnabled);
  return { operations, capabilities, result };
}

function replayPlan<Surface>(plan: Plan, adapter: ScenePaintCompositorAdapter<Surface>, backdrop: Surface): Surface {
  const surfaces = new Map<number, Surface>([[0, backdrop]]);
  const get = (id: number): Surface => surfaces.get(id)!;
  const optional = (id: number | undefined): Surface | undefined => id === undefined ? undefined : get(id);
  try {
    for (const entry of plan.operations) {
      switch (entry.kind) {
        case "acquire": surfaces.set(entry.surface, adapter.acquire()); break;
        case "release": {
          const surface = get(entry.surface); surfaces.delete(entry.surface); adapter.release(surface); break;
        }
        case "clear": adapter.clear(get(entry.surface), entry.color, entry.bounds); break;
        case "copy": adapter.copy(get(entry.source), get(entry.destination), entry.bounds); break;
        case "draw": adapter.draw(entry.runs, get(entry.destination), entry.shapeOnly); break;
        case "pass": {
          const operation = entry.operation;
          adapter.pass({ ...operation, source: optional(operation.source), shape: optional(operation.shape),
            current: optional(operation.current), stats: optional(operation.stats), initial: optional(operation.initial),
            mask: optional(operation.mask) }, get(entry.destination));
          break;
        }
        case "fold":
          // Computing a mask's vectors uses this frame's projection. The
          // adapter also pairs its accepted mask with the immediately following draw.
          if (entry.maskRun) adapter.canFoldMaskPaint!(entry.run, entry.maskRun);
          adapter.drawFolded!(entry.run, get(entry.destination), entry.opacity, optional(entry.mask), entry.content, entry.maskRun);
          break;
      }
    }
    const result = get(plan.result);
    surfaces.delete(plan.result);
    return result;
  } finally {
    surfaces.delete(0); // The caller always owns the initial backdrop, including on failure.
    for (const surface of surfaces.values()) adapter.release(surface);
  }
}
