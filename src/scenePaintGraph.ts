import type { PdfBlendMode } from "./heprDocumentData";
import type { Bounds, VectorScene } from "./pdfVectorExtractor";

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
