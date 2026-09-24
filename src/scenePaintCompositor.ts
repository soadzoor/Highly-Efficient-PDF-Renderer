import type { Bounds, VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import { normalizeScenePaintGraph, scenePaintNodeBounds, PDF_BLEND_MODES, type ScenePaintDraw,
  type ScenePaintGroup, type ScenePaintMask, type ScenePaintNode, type ScenePaintRetained } from "./scenePaintGraph";
import { vectorDrawRunsShareSubmission } from "./vectorDrawOrder";

export interface PdfCompositeOperation<Surface> {
  /** 6 emits the source layer for a blending destination; see `blend`. */
  operation: 0 | 1 | 2 | 3 | 4 | 5 | 6;
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
  /** The source is a self-contained isolated group layer: scale its
   * premultiplied color by `opacity` and `mask` while compositing it. */
  isolated?: boolean;
  /**
   * World extent this operation can affect. Everything outside it is already
   * correct in the destination, so an adapter may restrict the pass to it.
   */
  bounds?: Bounds;
  /**
   * Composite the pass's premultiplied output onto the destination with
   * source-over rather than replacing it. Only adapters advertising
   * `blendsPasses` are asked for this.
   */
  blend?: boolean;
  softMask?: ScenePaintMask;
}

/**
 * Backend surfaces are transient premultiplied RGBA; no surface belongs to VectorScene.
 *
 * `bounds` restricts an operation to a world rectangle. An adapter is free to
 * ignore it and cover the whole surface, but one that honours it anywhere must
 * honour it everywhere: a surface cleared inside a rectangle holds nothing
 * meaningful outside it, and only passes restricted the same way ever read it.
 */
export interface ScenePaintCompositorAdapter<Surface> {
  /**
   * Whether `pass` honours `blend`. Source-over is what a blending destination
   * already computes, so an adapter that can do it lets a Normal composite be
   * one pass instead of copying the backdrop out and reading it back.
   */
  readonly blendsPasses?: boolean;
  acquire(): Surface;
  release(surface: Surface): void;
  clear(surface: Surface, color?: readonly [number, number, number, number], bounds?: Bounds): void;
  copy(source: Surface, destination: Surface, bounds?: Bounds): void;
  /** Draws a span of runs in the given order, as one batch, over the destination's contents. */
  draw(runs: readonly VectorDrawRun[], destination: Surface, shapeOnly: boolean): void;
  pass(operation: PdfCompositeOperation<Surface>, destination: Surface): void;
}

interface CompositeDiagnostics {
  clears: number;
  copies: number;
  passes: number;
  spans: number;
  runs: number;
  live: number;
  peak: number;
}

/**
 * Opt-in composite cost diagnostics, off until `HEPR_DEBUG_COMPOSITE_STATS` is
 * set on the global. Counts include bounded and whole-surface operations;
 * adapters may restrict their pixel work to the supplied bounds. The peak
 * surface count describes the transient GPU storage in use. Instrumentation
 * forwards every adapter capability and bound so it observes the same work
 * the compositor would perform without diagnostics.
 *
 * Throttled to one line a second, since compositing runs once per frame.
 */
const COMPOSITE_STATS_INTERVAL_MS = 1000;
let lastCompositeStatsAt = -Infinity;

function compositeStatsAdapter<Surface>(adapter: ScenePaintCompositorAdapter<Surface>,
  stats: CompositeDiagnostics): ScenePaintCompositorAdapter<Surface> {
  return {
    blendsPasses: adapter.blendsPasses,
    acquire: () => { stats.peak = Math.max(stats.peak, ++stats.live); return adapter.acquire(); },
    release: surface => { stats.live--; adapter.release(surface); },
    clear: (surface, color, bounds) => { stats.clears++; adapter.clear(surface, color, bounds); },
    copy: (source, destination, bounds) => { stats.copies++; adapter.copy(source, destination, bounds); },
    draw: (runs, destination, shapeOnly) => {
      stats.spans++; stats.runs += runs.length; adapter.draw(runs, destination, shapeOnly);
    },
    pass: (operation, destination) => { stats.passes++; adapter.pass(operation, destination); }
  };
}

/** A device rectangle in pixels, measured from the surface's bottom-left corner. */
export interface PdfCompositeScissor { x: number; y: number; width: number; height: number }

/** World bounds to viewport pixels, bottom-left origin. null means no restriction. */
export type PdfCompositeProjector = (bounds: Bounds) => PdfCompositeScissor | null;

/**
 * The surface rectangle an operation may touch, or null to cover the surface.
 *
 * Coverage bleeds a pixel or so past the geometry that produced these bounds,
 * so the rectangle is grown before it is rounded out; restricting a pass too
 * tightly would clip what it composites, while a little slack costs nothing.
 */
export function pdfCompositeScissorRect(bounds: Bounds | undefined, project: PdfCompositeProjector | null | undefined,
  viewportWidth: number, viewportHeight: number, surfaceWidth: number, surfaceHeight: number): PdfCompositeScissor | null {
  if (!bounds || !project || !Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY) ||
      !Number.isFinite(bounds.maxX) || !Number.isFinite(bounds.maxY)) return null;
  const projected = project(bounds);
  if (!projected) return null;
  const scaleX = surfaceWidth / Math.max(1, viewportWidth), scaleY = surfaceHeight / Math.max(1, viewportHeight);
  const margin = 2;
  const left = Math.floor((projected.x - margin) * scaleX), bottom = Math.floor((projected.y - margin) * scaleY);
  const right = Math.ceil((projected.x + projected.width + margin) * scaleX);
  const top = Math.ceil((projected.y + projected.height + margin) * scaleY);
  const x = Math.max(0, Math.min(surfaceWidth, left)), y = Math.max(0, Math.min(surfaceHeight, bottom));
  const width = Math.max(0, Math.min(surfaceWidth, right) - x), height = Math.max(0, Math.min(surfaceHeight, top) - y);
  if (x === 0 && y === 0 && width >= surfaceWidth && height >= surfaceHeight) return null;
  return { x, y, width, height };
}

/**
 * A rendered layer awaiting composition. `shape` is geometric coverage, which
 * only a knockout ancestor ever reads, and `opacity`/`mask` are a uniform scale
 * that whoever composites `color` applies while reading it anyway. All three
 * are absent when nothing has to pay for them.
 */
interface PaintResult<Surface> {
  color: Surface;
  shape: Surface | null;
  opacity?: number;
  mask?: Surface;
}

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
  const stats = (globalThis as { HEPR_DEBUG_COMPOSITE_STATS?: boolean }).HEPR_DEBUG_COMPOSITE_STATS === true
    ? { clears: 0, copies: 0, passes: 0, spans: 0, runs: 0, live: 0, peak: 0 } : null;
  if (stats) adapter = compositeStatsAdapter(adapter, stats);
  const owned = new Set<Surface>();
  const take = (): Surface => { const surface = adapter.acquire(); owned.add(surface); return surface; };
  const drop = (surface: Surface): void => { if (owned.delete(surface)) adapter.release(surface); };
  const blank = (bounds?: Bounds): Surface => { const surface = take(); adapter.clear(surface, undefined, bounds); return surface; };
  const copy = (source: Surface, bounds?: Bounds): Surface => {
    const surface = take(); adapter.copy(source, surface, bounds); return surface;
  };
  const extents = scenePaintNodeBounds(scene);
  const boundsOf = (nodes: readonly ScenePaintNode[]): Bounds | undefined => extents.nodes.get(nodes);
  const runBounds = (index: number): Bounds | undefined => {
    const offset = index * 4, values = extents.runs;
    if (!values || offset + 3 >= values.length || !Number.isFinite(values[offset])) return undefined;
    return { minX: values[offset], minY: values[offset + 1], maxX: values[offset + 2], maxY: values[offset + 3] };
  };
  const spread = (first: Bounds | undefined, second: Bounds | undefined): Bounds | undefined => {
    if (!first || !second) return undefined;
    return { minX: Math.min(first.minX, second.minX), minY: Math.min(first.minY, second.minY),
      maxX: Math.max(first.maxX, second.maxX), maxY: Math.max(first.maxY, second.maxY) };
  };
  /** Releases everything a composited layer owned, once its passes have read it. */
  const release = (result: PaintResult<Surface>): void => {
    drop(result.color);
    if (result.shape) drop(result.shape);
    if (result.mask) drop(result.mask);
  };
  // Geometric shape only reaches a rendered pixel through a knockout group: the
  // color pass reads it when this group knocks out, and the stats pass folds it
  // into a coverage channel that nothing but an enclosing knockout ever samples.
  // Documents without knockout therefore render every span once instead of
  // twice, and leave the binding unset rather than fetching a viewport of zeroes.
  const draw = (runs: readonly VectorDrawRun[], needsShape: boolean, bounds?: Bounds): PaintResult<Surface> => {
    const color = blank(bounds);
    adapter.draw(runs, color, false);
    if (!needsShape) return { color, shape: null };
    const shape = blank(bounds);
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

  /** The canonical draw run a leaf node paints, or null when it is dropped this frame. */
  const leaf = (node: ScenePaintDraw | ScenePaintRetained): VectorDrawRun | null => {
    if (node.kind === "draw" && selected && !selected[node.runIndex]) return null;
    const run = node.kind === "draw" ? scene.drawRuns![node.runIndex] :
      { kind: "raster" as const, first: node.rasterIndex, count: 1 };
    return visible(run.optionalContent) ? run : null;
  };

  /**
   * Plain source-over accumulation into one surface, for a list of nodes whose
   * enclosing group neither knocks out nor reads its own geometric shape.
   *
   * Source-over is associative, so painting a Normal-blend span straight onto
   * the running surface leaves exactly what compositing it as a separate layer
   * would - without the surface, the clear and the two full-surface passes that
   * every span used to cost. Only a blend mode, which has to read the surface
   * it writes, still needs its own layer and a composite pass.
   *
   * The surface holding the result is returned: those composite passes replace
   * it, and the caller owns whatever comes back rather than what it passed in.
   */
  const accumulate = (nodes: readonly ScenePaintNode[], current: Surface, depth: number): Surface => {
    // Adjacent same-kind paints that share a clip and cover a contiguous
    // primitive range submit identically as one range, so a span reaches the
    // adapter as a handful of draws rather than one per source paint. Holes
    // left by hidden optional content break contiguity and stay separate.
    let span: VectorDrawRun[] = [];
    const flushSpan = (): void => {
      if (span.length === 0) return;
      const runs = span;
      span = [];
      adapter.draw(runs, current, false);
    };
    /**
     * Composites a rendered layer onto the running surface without replacing
     * it. The layer is transparent outside its own rectangle, so the pass only
     * has to cover that, and only what the pass covers may change - which is
     * what keeps the running surface valid everywhere else. The backdrop the
     * pass reads is a copy of that same rectangle, since a pass cannot read the
     * surface it writes.
     */
    const over = (result: PaintResult<Surface>, blendMode: number, bounds: Bounds | undefined): void => {
      if (blendMode === 0 && adapter.blendsPasses) {
        adapter.pass({ operation: 6, source: result.color, opacity: result.opacity, mask: result.mask,
          isolated: result.opacity !== undefined, blend: true, bounds }, current);
        release(result);
        return;
      }
      const backdrop = take();
      adapter.copy(current, backdrop, bounds);
      adapter.pass({ operation: 0, source: result.color, shape: result.shape ?? undefined, current: backdrop,
        blendMode, opacity: result.opacity, mask: result.mask, isolated: result.opacity !== undefined,
        bounds }, current);
      drop(backdrop);
      release(result);
    };
    for (const node of nodes) {
      if (!visible(node.optionalContent)) continue;
      if (node.kind === "group") {
        // An empty group composites to nothing, and its soft mask cannot
        // reintroduce coverage that no paint contributed in the first place.
        if (!paints(node.children)) continue;
        flushSpan();
        over(group(node.children, current, node, depth + 1, false), PDF_BLEND_MODES.indexOf(node.blendMode),
          boundsOf(node.children));
        continue;
      }
      const run = leaf(node);
      if (!run) continue;
      if (run.blendMode) {
        // A blend applies to individual objects, not to a batched union. The
        // whole paint's extent covers each of them, which is all a pass needs.
        flushSpan();
        const extent = node.kind === "draw" ? runBounds(node.runIndex) : undefined;
        for (let first = run.first; first < run.first + run.count; first++) {
          over(draw([{ ...run, first, count: 1, blendMode: undefined }], false, extent),
            PDF_BLEND_MODES.indexOf(run.blendMode), extent);
        }
        continue;
      }
      const previous = span[span.length - 1];
      if (vectorDrawRunsShareSubmission(previous, run)) previous.count += run.count;
      else span.push({ ...run, blendMode: undefined });
    }
    flushSpan();
    return current;
  };

  /**
   * Soft masks always render isolated against a transparent backdrop. The mask
   * is read wherever the group it applies to is composited, so it is prepared
   * over that rectangle as well as its own: an empty mask still has to convert
   * to a defined value there, not to whatever the surface held before.
   */
  const maskSurface = (softMask: ScenePaintMask, depth: number, bounds: Bounds | undefined): Surface => {
    const extent = spread(boundsOf(softMask.children), bounds);
    const rendered = accumulate(softMask.children, blank(extent), depth);
    const mask = take();
    adapter.pass({ operation: 4, source: rendered, softMask, bounds: extent }, mask);
    drop(rendered);
    return mask;
  };

  /**
   * An isolated group that does not knock out and whose shape nothing reads
   * needs neither a backdrop copy nor a separate alpha accumulator: its surface
   * starts transparent, so the surface's own alpha is the accumulated group
   * alpha and its color is already the extracted group color.
   *
   * Group opacity and the soft mask scale that premultiplied surface uniformly,
   * which the composite consuming it can do while it reads the surface anyway.
   * They ride along rather than costing an extraction pass and a surface of
   * their own, and whoever composites the layer releases them with it.
   */
  const isolatedGroup = (nodes: readonly ScenePaintNode[], settings: ScenePaintGroup, depth: number): PaintResult<Surface> => {
    const bounds = boundsOf(nodes);
    // The mask renders first, where the source puts it: it is independent of
    // the group's own paints, and taking it in source order lets a caller
    // batching these paints keep one rising sequence.
    const mask = settings.softMask ? maskSurface(settings.softMask, depth + 1, bounds) : undefined;
    const color = accumulate(nodes, blank(bounds), depth);
    if (settings.alpha === 1 && !mask) return { color, shape: null };
    return { color, shape: null, opacity: settings.alpha, mask };
  };

  const group = (nodes: readonly ScenePaintNode[], initialBackdrop: Surface, settings: ScenePaintGroup, depth: number,
    shapeConsumed: boolean): PaintResult<Surface> => {
    if (depth > 64) throw new RangeError("PDF compositor exceeds its group nesting budget.");
    if (settings.isolated && !settings.knockout && !shapeConsumed) return isolatedGroup(nodes, settings, depth);
    const needsShape = shapeConsumed || settings.knockout;
    // Knockout and non-isolated blending read their own backdrop rather than a
    // transparent one, but only where this group paints: the parent composites
    // the result over that same rectangle, so every surface here shares it.
    const bounds = boundsOf(nodes);
    const mask = settings.softMask ? maskSurface(settings.softMask, depth + 1, bounds) : undefined;
    const initial = settings.isolated ? blank(bounds) : copy(initialBackdrop, bounds);
    let current = copy(initial, bounds), stats = blank(bounds);
    let nextColor = take(), nextStats = take();
    const paint = (result: PaintResult<Surface>, blendMode: number): void => {
      const operation = { source: result.color, shape: result.shape ?? undefined, current, stats, initial,
        blendMode, knockout: settings.knockout, bounds,
        opacity: result.opacity, mask: result.mask, isolated: result.opacity !== undefined };
      adapter.pass({ ...operation, operation: 0 }, nextColor);
      adapter.pass({ ...operation, operation: 1 }, nextStats);
      [current, nextColor] = [nextColor, current];
      [stats, nextStats] = [nextStats, stats];
      release(result);
    };
    // Source-over is associative in color, in accumulated group alpha and in
    // shape coverage alike, so an uninterrupted span of Normal-blend leaves
    // composites identically whether it is unioned first or applied one leaf
    // at a time. Batching each span costs one composite per span instead of
    // one per draw run, which is what stops a single transparency group from
    // dragging every unrelated paint in the document through the compositor.
    let span: VectorDrawRun[] = [];
    const extend = (run: VectorDrawRun): void => {
      const previous = span[span.length - 1];
      if (vectorDrawRunsShareSubmission(previous, run)) previous.count += run.count;
      else span.push({ ...run, blendMode: undefined });
    };
    const flushSpan = (): void => {
      if (span.length === 0) return;
      const runs = span;
      span = [];
      paint(draw(runs, needsShape, bounds), 0);
    };
    for (const node of nodes) {
      if (!visible(node.optionalContent)) continue;
      if (node.kind === "group") {
        if (!paints(node.children)) continue;
        flushSpan();
        const result = group(node.children, settings.knockout ? initial : current, node, depth + 1, needsShape);
        paint(result, PDF_BLEND_MODES.indexOf(node.blendMode));
      } else {
        const run = leaf(node);
        if (!run) continue;
        // Knockout and non-normal blends apply to individual objects, not a batched union.
        if (settings.knockout || run.blendMode) {
          flushSpan();
          for (let i = run.first; i < run.first + run.count; i++) {
            paint(draw([{ ...run, first: i, count: 1, blendMode: undefined }], needsShape, bounds),
              PDF_BLEND_MODES.indexOf(run.blendMode ?? "Normal"));
          }
        } else extend(run);
      }
    }
    flushSpan();
    const result: PaintResult<Surface> = { color: take(), shape: shapeConsumed ? take() : null };
    const extraction = { current, stats, initial, mask, bounds,
      opacity: settings.alpha, alphaIsShape: settings.alphaIsShape };
    adapter.pass({ ...extraction, operation: 2 }, result.color);
    if (result.shape) adapter.pass({ ...extraction, operation: 3 }, result.shape);
    if (mask) drop(mask);
    for (const surface of [initial, current, stats, nextColor, nextStats]) drop(surface);
    return result;
  };
  try {
    // The page root is an opaque, non-isolated, Normal-blend group that nothing
    // knocks out, so its paints land on the backdrop exactly as compositing the
    // whole root as one layer would. Accumulating straight into a copy of the
    // backdrop saves a surface, a clear and two full-surface passes per span.
    const result = accumulate(normalizeScenePaintGraph(scene), copy(backdrop), 0);
    // Transfer only the result's ownership to the caller.
    owned.delete(result);
    return result;
  } finally {
    for (const surface of owned) adapter.release(surface);
    if (stats && performance.now() - lastCompositeStatsAt >= COMPOSITE_STATS_INTERVAL_MS) {
      lastCompositeStatsAt = performance.now();
      console.info(`[hepr] PDF composite frame: ${stats.clears + stats.copies + stats.passes} surface ops ` +
        `(${stats.passes} passes, ${stats.clears} clears, ${stats.copies} copies), ` +
        `${stats.spans} span draws over ${stats.runs} paints, ${stats.peak} peak surfaces.`);
    }
  }
}
