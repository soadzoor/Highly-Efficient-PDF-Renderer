import type { VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import type { PdfBlendMode } from "./heprDocumentData";
import type { PrimitivePoint, PrimitiveRef } from "./scenePrimitives";
import type { ScenePaintGroup, ScenePaintMask, ScenePaintNode } from "./scenePaintGraph";
import { compositePdfPixel, extractPdfGroupPixel, knockoutPdfPixel, pdfMaskValue, type PdfRgba } from "./pdfComposite";

interface Scope { parent: Scope | null; group?: ScenePaintGroup; condition?: number; maskOnly: boolean }
interface GraphLookup { scopes: Map<VectorDrawRun, Scope>; ordered: VectorDrawRun[] }
const lookups = new WeakMap<VectorScene, GraphLookup>();
export function releaseScenePaintQuery(scene: VectorScene): void { lookups.delete(scene); }
function lookup(scene: VectorScene): GraphLookup {
  let result = lookups.get(scene);
  if (result) return result;
  result = { scopes: new Map(), ordered: [] };
  const rasters = new Map<number, VectorDrawRun>();
  for (const run of scene.drawRuns ?? []) if (run.kind === "raster" && run.count === 1) rasters.set(run.first, run);
  const visit = (nodes: readonly ScenePaintNode[], parent: Scope | null, maskOnly: boolean): void => {
    for (const node of nodes) {
      const scope: Scope = { parent, condition: node.optionalContent, maskOnly,
        ...(node.kind === "group" ? { group: node } : {}) };
      if (node.kind === "group") {
        if (node.softMask) visit(node.softMask.children, scope, true);
        visit(node.children, scope, maskOnly);
      } else {
        const run = node.kind === "draw" ? scene.drawRuns?.[node.runIndex] : rasters.get(node.rasterIndex);
        if (run) { result!.scopes.set(run, scope); result!.ordered.push(run); }
      }
    }
  };
  visit(scene.paintGraph?.roots ?? [], null, false);
  lookups.set(scene, result); return result;
}

export function scenePaintOrderedRuns(scene: VectorScene): readonly VectorDrawRun[] {
  return scene.paintGraph ? lookup(scene).ordered : scene.drawRuns ?? [];
}

/** Geometric mask contents are inspectable, but are not visible page primitives. */
export function isScenePaintRunVisible(scene: VectorScene, run: VectorDrawRun | undefined,
  visible: (condition?: number) => boolean): boolean {
  if (!run || !visible(run.optionalContent)) return false;
  if (!scene.paintGraph) return true;
  let scope = lookup(scene).scopes.get(run);
  if (!scope || scope.maskOnly) return false;
  for (; scope; scope = scope.parent ?? undefined) {
    if (!visible(scope.condition) || scope.group?.alpha === 0) return false;
  }
  return true;
}

/** Includes conditions that affect a primitive through ancestor groups or masks. */
export function scenePaintRunConditions(scene: VectorScene, run: VectorDrawRun | undefined, includeMasks = true): number[] {
  const conditions = new Set<number>();
  if (run?.optionalContent !== undefined) conditions.add(run.optionalContent);
  const addNodes = (nodes: readonly ScenePaintNode[]): void => {
    for (const node of nodes) {
      if (node.optionalContent !== undefined) conditions.add(node.optionalContent);
      if (node.kind === "draw") {
        const condition = scene.drawRuns?.[node.runIndex]?.optionalContent;
        if (condition !== undefined) conditions.add(condition);
      } else if (node.kind === "group") {
        addNodes(node.children); if (node.softMask) addNodes(node.softMask.children);
      }
    }
  };
  for (let scope = run && scene.paintGraph ? lookup(scene).scopes.get(run) : undefined; scope; scope = scope.parent ?? undefined) {
    if (scope.condition !== undefined) conditions.add(scope.condition);
    if (includeMasks && scope.group?.softMask) addNodes(scope.group.softMask.children);
  }
  return [...conditions];
}

export interface ScenePaintSample { color: PdfRgba; shape: number }
export interface ScenePaintQueryOptions {
  visible(condition?: number): boolean;
  sample(ref: PrimitiveRef, point: PrimitivePoint): Promise<ScenePaintSample>;
  yield(): Promise<void>;
}
const CLEAR: PdfRgba = [0, 0, 0, 0];

/** Evaluates only a candidate's ancestor masks, with the same compositing algebra as the GPU. */
export async function scenePaintRunAlpha(scene: VectorScene, run: VectorDrawRun, point: PrimitivePoint,
  options: ScenePaintQueryOptions): Promise<number> {
  if (!scene.paintGraph) return 1;
  const maskValues = new Map<ScenePaintMask, number>();
  const group = async (nodes: readonly ScenePaintNode[], backdrop: PdfRgba,
    settings: Pick<ScenePaintGroup, "isolated" | "knockout" | "alpha" | "alphaIsShape" | "softMask">): Promise<ScenePaintSample> => {
    const initial = settings.isolated ? CLEAR : backdrop;
    let current: PdfRgba = initial, alpha = 0, shape = 0;
    const paint = (child: ScenePaintSample, blend: PdfBlendMode = "Normal"): void => {
      const result = compositePdfPixel(settings.knockout ? initial : current, child.color, blend);
      current = settings.knockout ? knockoutPdfPixel(current, initial, result, child.shape) : result;
      alpha = child.color[3] + alpha * (1 - (settings.knockout ? child.shape : child.color[3]));
      shape = child.shape + shape * (1 - child.shape);
    };
    for (const node of nodes) {
      await options.yield();
      if (!options.visible(node.optionalContent)) continue;
      if (node.kind === "group") paint(await group(node.children, settings.knockout ? initial : current, node), node.blendMode);
      else {
        const run = node.kind === "draw" ? scene.drawRuns![node.runIndex] : { kind: "raster" as const, first: node.rasterIndex, count: 1 };
        if (!options.visible(run.optionalContent)) continue;
        for (let index = run.first; index < run.first + run.count; index++) {
          await options.yield(); paint(await options.sample({ kind: run.kind, index }, point), run.blendMode);
        }
      }
    }
    const opacity = settings.alpha * (settings.softMask ? await mask(settings.softMask) : 1);
    return { color: extractPdfGroupPixel(current, initial, alpha, opacity), shape: shape * (settings.alphaIsShape ? opacity : 1) };
  };
  const mask = async (value: ScenePaintMask): Promise<number> => {
    const cached = maskValues.get(value); if (cached !== undefined) return cached;
    const result = await group(value.children, CLEAR, { isolated: true, knockout: false, alpha: 1 });
    const amount = pdfMaskValue(result.color, value.subtype, value.backdrop, value.transfer);
    maskValues.set(value, amount); return amount;
  };
  let result = 1;
  for (let scope = lookup(scene).scopes.get(run); scope; scope = scope.parent ?? undefined) {
    if (scope.group) result *= scope.group.alpha * (scope.group.softMask ? await mask(scope.group.softMask) : 1);
    if (result <= 0) break;
  }
  return result;
}
