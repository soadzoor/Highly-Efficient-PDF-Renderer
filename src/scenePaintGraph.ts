import type { PdfBlendMode } from "./heprDocumentData";
import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import { VectorDrawRunCuller } from "./vectorDrawRunCulling";

interface ScenePaintScope {
  optionalContent?: number;
}
export interface ScenePaintDraw extends ScenePaintScope {
  kind: "draw";
  /** Source-ordered range in VectorScene.drawRuns. */
  runIndex: number;
}
export interface ScenePaintMask {
  children: ScenePaintNode[];
  subtype: "Alpha" | "Luminosity";
  /** Sampled transfer function; absent means identity. */
  transfer?: Float32Array;
  backdrop?: [number, number, number];
}
export interface ScenePaintGroup extends ScenePaintScope {
  kind: "group";
  children: ScenePaintNode[];
  alpha: number;
  isolated: boolean;
  knockout: boolean;
  blendMode: PdfBlendMode;
  alphaIsShape?: boolean;
  softMask?: ScenePaintMask;
  bounds?: Bounds;
}
export interface ScenePaintRetained extends ScenePaintScope {
  kind: "retained";
  retainedPage: number;
  firstCommand: number;
  count: number;
  /** Canonical raster slot updated by the view's replay resources. */
  rasterIndex: number;
}
export type ScenePaintNode = ScenePaintDraw | ScenePaintGroup | ScenePaintRetained;
export interface ScenePaintGraph { roots: ScenePaintNode[] }

export const PDF_BLEND_MODES: readonly PdfBlendMode[] = ["Normal", "Multiply", "Screen", "Overlay", "Darken", "Lighten",
  "ColorDodge", "ColorBurn", "HardLight", "SoftLight", "Difference", "Exclusion", "Hue", "Saturation", "Color", "Luminosity"];

/** Reject incomplete or cyclic graphs before allocating render surfaces. */
export function validateScenePaintGraph(scene: VectorScene): void {
  if (scene.paintGraph === undefined) return;
  if (!scene.paintGraph || !Array.isArray(scene.paintGraph.roots) || !scene.drawRuns) throw new TypeError("Invalid PDF paint graph.");
  const seen = new Set<object>();
  const coverage = new Uint8Array(scene.drawRuns.length);
  const retainedSlots = new Set<number>();
  let count = 0;
  const visit = (nodes: readonly ScenePaintNode[], depth: number): void => {
    if (!Array.isArray(nodes) || depth > 64) throw new RangeError("Invalid PDF paint graph nesting.");
    for (const node of nodes) {
      if (!node || typeof node !== "object" || seen.has(node) || ++count > 1_000_000) throw new TypeError("Invalid cyclic or oversized PDF paint graph.");
      seen.add(node);
      if (node.optionalContent !== undefined && (!Number.isSafeInteger(node.optionalContent) || node.optionalContent < 0 ||
        node.optionalContent >= (scene.optionalContent?.conditions.length ?? 0))) throw new RangeError("Invalid PDF paint graph visibility condition.");
      if (node.kind === "draw") {
        if (!Number.isSafeInteger(node.runIndex) || node.runIndex < 0 || node.runIndex >= coverage.length || coverage[node.runIndex]) {
          throw new RangeError("PDF paint graph repeats or references an unknown draw run.");
        }
        coverage[node.runIndex] = 1;
      } else if (node.kind === "retained") {
        const page = scene.retainedPages?.[node.retainedPage]?.page;
        const commands = page?.displayProgram.groups[page.displayProgram.rootGroupIndex].commands;
        if (!Number.isSafeInteger(node.retainedPage) || node.retainedPage < 0 || !commands ||
          !Number.isSafeInteger(node.firstCommand) || node.firstCommand < 0 || !Number.isSafeInteger(node.count) || node.count <= 0 ||
          node.firstCommand + node.count > commands.length || !Number.isSafeInteger(node.rasterIndex) || node.rasterIndex < 0 ||
          node.rasterIndex >= scene.rasterLayers.length) throw new RangeError("Invalid retained PDF paint graph reference.");
        const runIndex = scene.drawRuns!.findIndex(run => run.kind === "raster" && run.first === node.rasterIndex && run.count === 1);
        if (runIndex < 0 || coverage[runIndex] || retainedSlots.has(node.rasterIndex)) {
          throw new RangeError("Retained PDF paint must own a unique singleton raster draw run.");
        }
        retainedSlots.add(node.rasterIndex);
        coverage[runIndex] = 1;
      } else if (node.kind === "group") {
        if (!Number.isFinite(node.alpha) || node.alpha < 0 || node.alpha > 1 || typeof node.isolated !== "boolean" ||
          typeof node.knockout !== "boolean" || !PDF_BLEND_MODES.includes(node.blendMode) ||
          (node.alphaIsShape !== undefined && typeof node.alphaIsShape !== "boolean")) throw new TypeError("Invalid PDF composite group.");
        if (node.bounds && (![node.bounds.minX, node.bounds.minY, node.bounds.maxX, node.bounds.maxY].every(Number.isFinite) ||
          node.bounds.minX > node.bounds.maxX || node.bounds.minY > node.bounds.maxY)) throw new RangeError("Invalid PDF group bounds.");
        if (node.softMask) {
          const mask = node.softMask;
          if (mask.subtype !== "Alpha" && mask.subtype !== "Luminosity") throw new TypeError("Invalid PDF mask subtype.");
          if (mask.transfer && (!(mask.transfer instanceof Float32Array) || mask.transfer.length < 2 || mask.transfer.length > 65536 ||
            !mask.transfer.every((value: number) => Number.isFinite(value) && value >= 0 && value <= 1))) throw new TypeError("Invalid PDF mask transfer function.");
          if (mask.backdrop && (!Array.isArray(mask.backdrop) || mask.backdrop.length !== 3 ||
            !mask.backdrop.every((value: number) => Number.isFinite(value) && value >= 0 && value <= 1))) throw new TypeError("Invalid PDF mask backdrop.");
          visit(mask.children, depth + 1);
        }
        visit(node.children, depth + 1);
      } else throw new TypeError("Unknown PDF paint graph node.");
    }
  };
  visit(scene.paintGraph.roots, 0);
  if (coverage.some(value => value !== 1)) throw new RangeError("PDF paint graph omits a canonical draw run.");
}

/**
 * Marks each draw run whose successor is the very next paint in the same list.
 * Only such a pair can share one submission: anything else has a group
 * boundary or another paint between it, and the graph is free to visit run
 * indices in an order of its own, so merging by index alone could repaint them
 * out of sequence. Absent graph means no constraint, and null says so.
 */
export function scenePaintRunNeighbours(scene: VectorScene): Uint8Array | null {
  if (!scene.paintGraph || !scene.drawRuns) return null;
  const neighbours = new Uint8Array(scene.drawRuns.length);
  const visit = (nodes: readonly ScenePaintNode[]): void => {
    let previous = -1;
    for (const node of nodes) {
      if (node.kind === "draw") {
        if (previous >= 0 && node.runIndex === previous + 1) neighbours[previous] = 1;
        previous = node.runIndex;
        continue;
      }
      previous = -1;
      if (node.kind !== "group") continue;
      if (node.softMask) visit(node.softMask.children);
      visit(node.children);
    }
  };
  visit(scene.paintGraph.roots);
  return neighbours;
}

export type ScenePaintPass =
  | { kind: "draw"; runIndex: number }
  | { kind: "retained"; node: ScenePaintRetained }
  | { kind: "begin-group"; id: number; node: ScenePaintGroup }
  | { kind: "begin-mask"; id: number; mask: ScenePaintMask }
  | { kind: "end-mask"; id: number }
  | { kind: "end-group"; id: number };

/** Shared source-order pass plan. Geometry buffers and canonical indices are not changed. */
export function planScenePaintPasses(scene: VectorScene, visible: (condition?: number) => boolean): ScenePaintPass[] {
  const result: ScenePaintPass[] = [];
  let nextId = 0;
  const visit = (nodes: readonly ScenePaintNode[], depth: number): void => {
    if (depth > 64) throw new RangeError("PDF paint graph nesting exceeds 64 groups.");
    for (const node of nodes) {
      if (!visible(node.optionalContent)) continue;
      if (node.kind === "draw") {
        const run = scene.drawRuns?.[node.runIndex];
        if (!run) throw new RangeError("PDF paint graph references an unknown draw run.");
        if (visible(run.optionalContent)) result.push({ kind: "draw", runIndex: node.runIndex });
      } else if (node.kind === "retained") result.push({ kind: "retained", node });
      else {
        const id = nextId++;
        result.push({ kind: "begin-group", id, node });
        if (node.softMask) {
          result.push({ kind: "begin-mask", id, mask: node.softMask });
          visit(node.softMask.children, depth + 1);
          result.push({ kind: "end-mask", id });
        }
        visit(node.children, depth + 1);
        result.push({ kind: "end-group", id });
      }
    }
  };
  if (scene.paintGraph) visit(scene.paintGraph.roots, 0);
  else scene.drawRuns?.forEach((run, runIndex) => { if (visible(run.optionalContent)) result.push({ kind: "draw", runIndex }); });
  return result;
}

const normalizedGraphs = new WeakMap<VectorScene, readonly ScenePaintNode[]>();

/**
 * Whether every paint under these nodes reaches its backdrop through plain
 * Normal source-over. Isolation only decides which backdrop a blend or a
 * knockout reads, so a subtree without either composites identically whether
 * it starts from a transparent surface or from the enclosing one.
 *
 * A soft mask is always rendered against its own transparent backdrop, so what
 * it contains never affects the isolation of the group carrying it.
 */
function paintsSourceOverOnly(scene: VectorScene, nodes: readonly ScenePaintNode[], depth: number): boolean {
  if (depth > 64) return false;
  for (const node of nodes) {
    if (node.kind === "group") {
      if (node.knockout || node.blendMode !== "Normal" || !paintsSourceOverOnly(scene, node.children, depth + 1)) return false;
    } else if (node.kind === "draw" && scene.drawRuns?.[node.runIndex]?.blendMode) return false;
  }
  return true;
}

/**
 * The rendering-equivalent paint graph, cached per scene. Source order, run
 * indices and geometry are untouched; only the group structure the compositor
 * has to allocate surfaces for changes:
 *
 * - A group that is fully opaque, unmasked, Normal-blend and non-knockout
 *   paints exactly where its parent would, so it is spliced into the parent.
 *   That leaves the parent one uninterrupted span instead of three, and costs
 *   the frame neither surfaces nor composite passes. Knockout parents are left
 *   alone: their children are the units that knock each other out, so splicing
 *   one would change the picture.
 * - A non-knockout group whose subtree is source-over only is marked isolated.
 *   No pixel moves - its backdrop cancels out of its own extraction either way
 *   - but the compositor can then accumulate it into a single surface whose
 *   own alpha is the group alpha, instead of a backdrop copy plus a separate
 *   alpha accumulator.
 *
 * Groups carrying an optional-content condition stay put: the condition covers
 * the whole group and a spliced child could not inherit it alongside its own.
 */
export function normalizeScenePaintGraph(scene: VectorScene): readonly ScenePaintNode[] {
  if (!scene.paintGraph) return [];
  const cached = normalizedGraphs.get(scene);
  if (cached) return cached;
  const rewrite = (nodes: readonly ScenePaintNode[], depth: number, knockoutParent: boolean): ScenePaintNode[] => {
    const result: ScenePaintNode[] = [];
    for (const node of nodes) {
      if (node.kind !== "group" || depth >= 64) { result.push(node); continue; }
      const sourceOverOnly = !node.knockout && paintsSourceOverOnly(scene, node.children, 0);
      const children = rewrite(node.children, depth + 1, node.knockout);
      if (!knockoutParent && node.optionalContent === undefined && node.alpha === 1 && !node.softMask &&
          !node.knockout && node.blendMode === "Normal" && (!node.isolated || sourceOverOnly)) {
        result.push(...children);
        continue;
      }
      const softMask = node.softMask
        ? { ...node.softMask, children: rewrite(node.softMask.children, depth + 1, false) } : undefined;
      result.push({ ...node, children, softMask, isolated: node.isolated || sourceOverOnly });
    }
    return result;
  };
  const roots = rewrite(scene.paintGraph.roots, 0, false);
  normalizedGraphs.set(scene, roots);
  return roots;
}

const spanSegments = new WeakMap<VectorScene, Uint32Array>();

/**
 * The span each canonical draw run paints in, numbered in graph order.
 *
 * The compositor submits an uninterrupted stretch of Normal source-over paints
 * as one span, onto one surface, and breaks that stretch at every group
 * boundary and at every paint carrying its own blend mode. Within a span the
 * paints compose onto the same surface with nothing in between, so reordering
 * them is exactly as safe as reordering paints on a page without transparency
 * groups at all; across spans it is not, because a composite intervenes.
 *
 * Numbering is monotonic in graph order, so the spans the compositor actually
 * submits - which can be coarser, where an empty group left no composite
 * between two stretches - always cover a contiguous range of these ids. Extra
 * boundaries only cost batching, never correctness, so list starts and group
 * edges each take one rather than being computed exactly.
 */
export function scenePaintSpanSegments(scene: VectorScene): Uint32Array | null {
  if (!scene.paintGraph || !scene.drawRuns) return null;
  const cached = spanSegments.get(scene);
  if (cached) return cached;
  const runs = scene.drawRuns;
  const segments = new Uint32Array(runs.length);
  const retainedRuns = new Map<number, number>();
  runs.forEach((run, index) => { if (run.kind === "raster" && run.count === 1) retainedRuns.set(run.first, index); });
  let current = 0;
  const visit = (nodes: readonly ScenePaintNode[], depth: number, knockout = false): void => {
    if (depth > 64) return;
    current++;
    for (const node of nodes) {
      if (node.kind === "group") {
        current++;
        // A soft mask renders into a surface of its own, so where it falls
        // relative to the group's paints is free; both this walk and the
        // compositor take it first, which is also its place in the source.
        if (node.softMask) visit(node.softMask.children, depth + 1);
        visit(node.children, depth + 1, node.knockout);
        current++;
        continue;
      }
      const index = node.kind === "draw" ? node.runIndex : retainedRuns.get(node.rasterIndex);
      if (index === undefined || index >= runs.length) continue;
      // A blend mode composites each object on its own, so such a paint shares
      // its span with nothing either side of it.
      if (knockout || runs[index].blendMode) { current++; segments[index] = current; current++; }
      else segments[index] = current;
    }
    current++;
  };
  visit(normalizeScenePaintGraph(scene), 0);
  spanSegments.set(scene, segments);
  return segments;
}

export interface ScenePaintExtents {
  /** Per node list the compositor renders as a unit. */
  nodes: Map<readonly ScenePaintNode[], Bounds>;
  /** Four values per canonical draw run, or null when the scene cannot be measured. */
  runs: Float64Array | null;
}
const nodeBounds = new WeakMap<VectorScene, ScenePaintExtents>();
const UNBOUNDED: Bounds = { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity };

/**
 * The world extent each node list paints into, for every list the compositor
 * renders as a unit: the normalized roots, each group's children and each soft
 * mask's contents.
 *
 * A group composites onto its parent through a surface that is transparent
 * everywhere its own paints do not reach, so every pass that carries it only
 * has to touch this rectangle. Transparency groups in ordinary documents cover
 * a logo or a shadow, not a page, which is what makes bounding them worth the
 * lookup. A paint whose extent is unknown reports an unbounded rectangle, so a
 * group containing one is never restricted.
 */
export function scenePaintNodeBounds(scene: VectorScene): ScenePaintExtents {
  const cached = nodeBounds.get(scene);
  if (cached) return cached;
  const result: ScenePaintExtents = { nodes: new Map<readonly ScenePaintNode[], Bounds>(), runs: null };
  const runs = scene.drawRuns;
  if (!runs || !scene.paintGraph) { nodeBounds.set(scene, result); return result; }
  // Bounds are only ever an optimization, so a scene this cannot measure -
  // a synthetic one without the geometry stores, above all - simply reports
  // nothing and every pass covers its whole surface, as it always did.
  let culler: VectorDrawRunCuller;
  try { culler = new VectorDrawRunCuller(scene); }
  catch { nodeBounds.set(scene, result); return result; }
  const box = [0, 0, 0, 0];
  const perRun = new Float64Array(runs.length * 4);
  const retainedRuns = new Map<number, number>();
  runs.forEach((run, index) => { if (run.kind === "raster" && run.count === 1) retainedRuns.set(run.first, index); });
  const visit = (nodes: readonly ScenePaintNode[], depth: number): Bounds => {
    if (depth > 64) return UNBOUNDED;
    const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const include = (other: Bounds): void => {
      bounds.minX = Math.min(bounds.minX, other.minX); bounds.minY = Math.min(bounds.minY, other.minY);
      bounds.maxX = Math.max(bounds.maxX, other.maxX); bounds.maxY = Math.max(bounds.maxY, other.maxY);
    };
    for (const node of nodes) {
      if (node.kind === "group") {
        // A mask is its own surface with its own extent, and never widens the
        // group: it can only take coverage away.
        if (node.softMask) visit(node.softMask.children, depth + 1);
        include(visit(node.children, depth + 1));
        continue;
      }
      const index = node.kind === "draw" ? node.runIndex : retainedRuns.get(node.rasterIndex);
      if (index === undefined || index >= runs.length) continue;
      try { culler.getBounds(index, 0, box); }
      catch { include(UNBOUNDED); continue; }
      if (box.some(value => Number.isNaN(value))) { include(UNBOUNDED); continue; }
      perRun.set(box, index * 4);
      include({ minX: box[0], minY: box[1], maxX: box[2], maxY: box[3] });
    }
    result.nodes.set(nodes, bounds);
    return bounds;
  };
  perRun.fill(Infinity);
  visit(normalizeScenePaintGraph(scene), 0);
  result.runs = perRun;
  nodeBounds.set(scene, result);
  return result;
}
