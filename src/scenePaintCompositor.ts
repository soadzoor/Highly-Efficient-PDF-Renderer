import type { VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import { PDF_BLEND_MODES, type ScenePaintGroup, type ScenePaintMask, type ScenePaintNode } from "./scenePaintGraph";

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
 */
export function compositeScenePaintGraph<Surface>(scene: VectorScene, adapter: ScenePaintCompositorAdapter<Surface>,
  backdrop: Surface, visible: (condition?: number) => boolean): Surface {
  const owned = new Set<Surface>();
  const take = (): Surface => { const surface = adapter.acquire(); owned.add(surface); return surface; };
  const drop = (surface: Surface): void => { if (owned.delete(surface)) adapter.release(surface); };
  const blank = (): Surface => { const surface = take(); adapter.clear(surface); return surface; };
  const copy = (source: Surface): Surface => { const surface = take(); adapter.copy(source, surface); return surface; };
  let white: Surface;
  const draw = (runs: readonly VectorDrawRun[]): PaintResult<Surface> => {
    const color = blank(), shape = blank();
    adapter.draw(runs, color, false);
    adapter.draw(runs, shape, true);
    return { color, shape };
  };

  const group = (nodes: readonly ScenePaintNode[], initialBackdrop: Surface, settings: ScenePaintGroup, depth: number): PaintResult<Surface> => {
    if (depth > 64) throw new RangeError("PDF compositor exceeds its group nesting budget.");
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
      drop(result.color); drop(result.shape);
    };
    // Source-over is associative in color, in accumulated group alpha and in
    // shape coverage alike, so an uninterrupted span of Normal-blend leaves
    // composites identically whether it is unioned first or applied one leaf
    // at a time. Batching each span costs one composite per span instead of
    // one per draw run, which is what stops a single transparency group from
    // dragging every unrelated paint in the document through the compositor.
    let span: VectorDrawRun[] = [];
    const flushSpan = (): void => {
      if (span.length === 0) return;
      const runs = span;
      span = [];
      paint(draw(runs), 0);
    };
    for (const node of nodes) {
      if (!visible(node.optionalContent)) continue;
      if (node.kind === "group") {
        flushSpan();
        const result = group(node.children, settings.knockout ? initial : current, node, depth + 1);
        paint(result, PDF_BLEND_MODES.indexOf(node.blendMode));
      } else {
        const run = node.kind === "draw" ? scene.drawRuns![node.runIndex] :
          { kind: "raster" as const, first: node.rasterIndex, count: 1 };
        if (!visible(run.optionalContent)) continue;
        // Knockout and non-normal blends apply to individual objects, not a batched union.
        if (settings.knockout || run.blendMode) {
          flushSpan();
          for (let i = run.first; i < run.first + run.count; i++) {
            paint(draw([{ ...run, first: i, count: 1, blendMode: undefined }]),
              PDF_BLEND_MODES.indexOf(run.blendMode ?? "Normal"));
          }
        } else span.push({ ...run, blendMode: undefined });
      }
    }
    flushSpan();
    let mask = white;
    if (settings.softMask) {
      const maskInitial = blank();
      const rendered = group(settings.softMask.children, maskInitial,
        { kind: "group", children: [], alpha: 1, isolated: true, knockout: false, blendMode: "Normal" }, depth + 1);
      mask = take();
      adapter.pass({ operation: 4, source: rendered.color, softMask: settings.softMask }, mask);
      drop(rendered.color); drop(rendered.shape); drop(maskInitial);
    }
    const result = { color: take(), shape: take() };
    const extraction = { current, stats, initial, mask, opacity: settings.alpha, alphaIsShape: settings.alphaIsShape };
    adapter.pass({ ...extraction, operation: 2 }, result.color);
    adapter.pass({ ...extraction, operation: 3 }, result.shape);
    if (mask !== white) drop(mask);
    for (const surface of [initial, current, stats, nextColor, nextStats]) drop(surface);
    return result;
  };
  try {
    white = take();
    adapter.clear(white, [1, 1, 1, 1]);
    const settings: ScenePaintGroup = { kind: "group", children: scene.paintGraph?.roots ?? [], alpha: 1,
      isolated: false, knockout: false, blendMode: "Normal" };
    const source = group(settings.children, backdrop, settings, 0);
    const result = take();
    adapter.pass({ operation: 0, source: source.color, shape: source.shape, current: backdrop, initial: backdrop }, result);
    // Transfer only the result's ownership to the caller.
    owned.delete(result);
    return result;
  } finally {
    for (const surface of owned) adapter.release(surface);
  }
}
