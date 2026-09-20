import type { VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import { PDF_BLEND_MODES, type ScenePaintGroup, type ScenePaintMask, type ScenePaintNode } from "./scenePaintGraph";
import { vectorDrawRunsShareSubmission } from "./vectorDrawOrder";

export interface PdfCompositeOperation<Surface> {
  operation: 0 | 1 | 2 | 3 | 4 | 5;
  source?: Surface;
  shape?: Surface;
  current?: Surface;
  stats?: Surface;
  initial?: Surface;
  mask?: Surface;
  blendMode?: number;
  knockout?: boolean;
  opacity?: number;
  alphaIsShape?: boolean;
  softMask?: ScenePaintMask;
}

/** Backend surfaces are transient premultiplied RGBA; no surface belongs to VectorScene. */
export interface ScenePaintCompositorAdapter<Surface> {
  acquire(): Surface;
  release(surface: Surface): void;
  clear(surface: Surface, color?: readonly [number, number, number, number]): void;
  copy(source: Surface, destination: Surface): void;
  /** Draws a span of runs in the given order, as one batch. */
  draw(runs: readonly VectorDrawRun[], destination: Surface, shapeOnly: boolean): void;
  pass(operation: PdfCompositeOperation<Surface>, destination: Surface): void;
}

interface PaintResult<Surface> { color: Surface; shape: Surface }

/**
 * Source-ordered PDF compositing, shared by all GPU adapters. Separate group alpha
 * and geometric shape surfaces preserve non-isolation and translucent knockout.
 *
 * Every surface covers the viewport, so a paint whose bounds fall outside it
 * contributes nothing to any composite channel. `selected`, when given, is the
 * caller's per-run-index view culling: it drops those paints exactly as the
 * non-compositing path already does. Retained raster nodes carry no run index
 * and are always kept.
 */
export function compositeScenePaintGraph<Surface>(scene: VectorScene, adapter: ScenePaintCompositorAdapter<Surface>,
  backdrop: Surface, visible: (condition?: number) => boolean, selected: Uint8Array | null = null): Surface {
  const owned = new Set<Surface>();
  const take = (): Surface => { const surface = adapter.acquire(); owned.add(surface); return surface; };
  const drop = (surface: Surface): void => { if (owned.delete(surface)) adapter.release(surface); };
  const blank = (): Surface => { const surface = take(); adapter.clear(surface); return surface; };
  const copy = (source: Surface): Surface => { const surface = take(); adapter.copy(source, surface); return surface; };
  let white: Surface;
  // Geometric shape only reaches a rendered pixel through a knockout group: the
  // color pass reads it when this group knocks out, and the stats pass folds it
  // into a coverage channel that nothing but an enclosing knockout ever samples.
  // Documents without knockout therefore render every span once instead of twice.
  let emptyShape: Surface | undefined;
  const draw = (runs: readonly VectorDrawRun[], needsShape: boolean): PaintResult<Surface> => {
    const color = blank();
    adapter.draw(runs, color, false);
    if (!needsShape) return { color, shape: (emptyShape ??= blank()) };
    const shape = blank();
    adapter.draw(runs, shape, true);
    return { color, shape };
  };

  /**
   * Whether anything under these nodes still paints. Compositing a fully
   * transparent source leaves color, group alpha and shape coverage untouched
   * under every blend mode and under knockout alike, so a group whose contents
   * are all hidden or culled can be dropped surfaces, passes and all. Visibility
   * and culling are fixed for the frame, so each child list is answered once
   * rather than again for every group that encloses it.
   */
  const painted = new Map<readonly ScenePaintNode[], boolean>();
  const paints = (nodes: readonly ScenePaintNode[]): boolean => {
    const cached = painted.get(nodes);
    if (cached !== undefined) return cached;
    let result = false;
    for (const node of nodes) {
      if (!visible(node.optionalContent)) continue;
      if (node.kind === "group") {
        if (!paints(node.children)) continue;
      } else if (node.kind === "draw") {
        if (selected && !selected[node.runIndex]) continue;
        if (!visible(scene.drawRuns![node.runIndex].optionalContent)) continue;
      }
      result = true;
      break;
    }
    painted.set(nodes, result);
    return result;
  };

  const group = (nodes: readonly ScenePaintNode[], initialBackdrop: Surface, settings: ScenePaintGroup, depth: number,
    shapeConsumed: boolean): PaintResult<Surface> => {
    if (depth > 64) throw new RangeError("PDF compositor exceeds its group nesting budget.");
    const needsShape = shapeConsumed || settings.knockout;
    const initial = settings.isolated ? blank() : copy(initialBackdrop);
    let current = copy(initial), stats = blank();
    let nextColor = take(), nextStats = take();
    const paint = (result: PaintResult<Surface>, blendMode: number): void => {
      const operation = { source: result.color, shape: result.shape, current, stats, initial,
        blendMode, knockout: settings.knockout };
      adapter.pass({ ...operation, operation: 0 }, nextColor);
      adapter.pass({ ...operation, operation: 1 }, nextStats);
      [current, nextColor] = [nextColor, current];
      [stats, nextStats] = [nextStats, stats];
      drop(result.color);
      if (result.shape !== emptyShape) drop(result.shape);
    };
    // Source-over is associative in color, in accumulated group alpha and in
    // shape coverage alike, so an uninterrupted span of Normal-blend leaves
    // composites identically whether it is unioned first or applied one leaf
    // at a time. Batching each span costs one composite per span instead of
    // one per draw run, which is what stops a single transparency group from
    // dragging every unrelated paint in the document through the compositor.
    let span: VectorDrawRun[] = [];
    // Adjacent same-kind paints that share a clip and cover a contiguous
    // primitive range submit identically as one range, so a span reaches the
    // adapter as a handful of draws rather than one per source paint. Holes
    // left by hidden optional content break contiguity and stay separate.
    const extend = (run: VectorDrawRun): void => {
      const previous = span[span.length - 1];
      if (vectorDrawRunsShareSubmission(previous, run)) previous.count += run.count;
      else span.push({ ...run, blendMode: undefined });
    };
    const flushSpan = (): void => {
      if (span.length === 0) return;
      const runs = span;
      span = [];
      paint(draw(runs, needsShape), 0);
    };
    for (const node of nodes) {
      if (!visible(node.optionalContent)) continue;
      if (node.kind === "group") {
        // An empty group composites to nothing, and its soft mask cannot
        // reintroduce coverage that no paint contributed in the first place.
        if (!paints(node.children)) continue;
        flushSpan();
        const result = group(node.children, settings.knockout ? initial : current, node, depth + 1, needsShape);
        paint(result, PDF_BLEND_MODES.indexOf(node.blendMode));
      } else {
        if (node.kind === "draw" && selected && !selected[node.runIndex]) continue;
        const run = node.kind === "draw" ? scene.drawRuns![node.runIndex] :
          { kind: "raster" as const, first: node.rasterIndex, count: 1 };
        if (!visible(run.optionalContent)) continue;
        // Knockout and non-normal blends apply to individual objects, not a batched union.
        if (settings.knockout || run.blendMode) {
          flushSpan();
          for (let i = run.first; i < run.first + run.count; i++) {
            paint(draw([{ ...run, first: i, count: 1, blendMode: undefined }], needsShape),
              PDF_BLEND_MODES.indexOf(run.blendMode ?? "Normal"));
          }
        } else extend(run);
      }
    }
    flushSpan();
    let mask = white;
    if (settings.softMask) {
      const maskInitial = blank();
      const rendered = group(settings.softMask.children, maskInitial,
        { kind: "group", children: [], alpha: 1, isolated: true, knockout: false, blendMode: "Normal" }, depth + 1, false);
      mask = take();
      adapter.pass({ operation: 4, source: rendered.color, softMask: settings.softMask }, mask);
      drop(rendered.color);
      if (rendered.shape !== emptyShape) drop(rendered.shape);
      drop(maskInitial);
    }
    const result = { color: take(), shape: shapeConsumed ? take() : (emptyShape ??= blank()) };
    const extraction = { current, stats, initial, mask, opacity: settings.alpha, alphaIsShape: settings.alphaIsShape };
    adapter.pass({ ...extraction, operation: 2 }, result.color);
    if (shapeConsumed) adapter.pass({ ...extraction, operation: 3 }, result.shape);
    if (mask !== white) drop(mask);
    for (const surface of [initial, current, stats, nextColor, nextStats]) drop(surface);
    return result;
  };
  try {
    white = take();
    adapter.clear(white, [1, 1, 1, 1]);
    const settings: ScenePaintGroup = { kind: "group", children: scene.paintGraph?.roots ?? [], alpha: 1,
      isolated: false, knockout: false, blendMode: "Normal" };
    const source = group(settings.children, backdrop, settings, 0, false);
    const result = take();
    adapter.pass({ operation: 0, source: source.color, shape: source.shape, current: backdrop, initial: backdrop }, result);
    // Transfer only the result's ownership to the caller.
    owned.delete(result);
    return result;
  } finally {
    for (const surface of owned) adapter.release(surface);
  }
}
