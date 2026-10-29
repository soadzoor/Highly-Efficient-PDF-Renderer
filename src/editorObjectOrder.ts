import type { VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import type { PrimitiveRef } from "./scenePrimitives";
import type { ScenePaintNode } from "./scenePaintGraph";
import type { EditorStackingAction } from "./editorTypes";
import { defaultVectorDrawRuns } from "./vectorDrawOrder";
import { ScenePageViews } from "./scenePageViews";
import { editorPaintIdentity, retainEditorPaintIdentity } from "./editorPaintIdentity";

export interface EditorOrderUnit {
  owners: string[];
  tokens: string[];
  page: number;
  layer: string | null;
  plane: "paint" | "metadata";
  atomic: boolean;
  children?: EditorOrderUnit[];
  refs?: PrimitiveRef[];
  objectId?: string;
  node?: ScenePaintNode;
}
export interface EditorOrderGeometry {
  scene: VectorScene;
  units: EditorOrderUnit[];
}
export const editorOrderToken = (owner: string, layer: string | null): string => JSON.stringify([owner, layer]);
export { editorCloneOwner } from "./editorPaintIdentity";
const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];
const joinTokens = (units: readonly EditorOrderUnit[]): string[] => unique(units.flatMap(unit => unit.tokens));
const joinOwners = (units: readonly EditorOrderUnit[]): string[] => unique(units.flatMap(unit => unit.owners));

/** Split only temporary editor units. Final output coalesces compatible ranges again. */
export function editorOrderGeometry(source: VectorScene, options: {
  layer(node: ScenePaintNode): string | null;
  atomic(node: ScenePaintNode): boolean;
  excluded?: ReadonlySet<string>;
  objectId?: string;
  page?: number;
}): EditorOrderGeometry {
  const original = source.drawRuns ?? defaultVectorDrawRuns(source), identity = editorPaintIdentity(source), partition = new ScenePageViews(source);
  const runs: VectorDrawRun[] = [];
  const refKey = (ref: PrimitiveRef): string => `${ref.kind}:${ref.index}`;
  const pageOf = (ref?: PrimitiveRef): number => options.page ?? (ref ? partition.owners[ref.kind][ref.index] : 0);
  const sourceOverOnly = (nodes: readonly ScenePaintNode[]): boolean => nodes.every(node => node.kind === "draw" ? !original[node.runIndex].blendMode :
    node.kind === "retained" ? false : !options.atomic(node) && sourceOverOnly(node.children));
  const visit = (nodes: readonly ScenePaintNode[]): EditorOrderUnit[] => nodes.flatMap(node => {
    const layer = options.layer(node);
    if (node.kind === "draw") {
      const run = original[node.runIndex], result: EditorOrderUnit[] = [];
      for (let index = run.first; index < run.first + run.count; index++) {
        const ref = { kind: run.kind, index }, owner = identity(ref); if (options.excluded?.has(refKey(ref)) || options.excluded?.has(owner)) continue;
        const token = editorOrderToken(owner, layer), previous = result[result.length - 1];
        const previousRun = previous?.node?.kind === "draw" ? runs[previous.node.runIndex] : undefined;
        if (previous?.tokens[0] === token && previousRun && previousRun.first + previousRun.count === index) {
          previous.refs!.push(ref); runs[(previous.node as { runIndex: number }).runIndex].count++; continue;
        }
        const runIndex = runs.length; runs.push({ ...run, first: index, count: 1 });
        result.push({ owners: [options.objectId ?? owner], tokens: [token], page: pageOf(ref), layer, plane: "paint", atomic: true,
          refs: [ref], objectId: options.objectId, node: { ...node, runIndex } });
      }
      return result;
    }
    if (node.kind === "retained") {
      const ref = { kind: "raster" as const, index: node.rasterIndex }, owner = identity(ref); if (options.excluded?.has(refKey(ref)) || options.excluded?.has(owner)) return [];
      const run = original.find(run => run.kind === "raster" && run.first === node.rasterIndex && run.count === 1);
      if (!run) throw new RangeError("Retained content requires a singleton raster paint."); runs.push(run);
      return [{ owners: [options.objectId ?? owner], tokens: [editorOrderToken(owner, layer)], page: pageOf(ref), layer, plane: "paint", atomic: true,
        refs: [ref], objectId: options.objectId, node: { ...node } }];
    }
    const children = visit(node.children), masks = node.softMask ? visit(node.softMask.children) : [];
    if (!children.length) return [];
    const owners = joinOwners(children), tokens = joinTokens(children), atomic = options.atomic(node);
    const oneObject = owners.length === 1 && children.every(child => child.layer === children[0].layer);
    if (!atomic && !oneObject && node.optionalContent === undefined && (!node.isolated || sourceOverOnly(node.children))) return children;
    const maskNodes = masks.flatMap(unit => unit.node ? [unit.node] : []);
    return [{ owners, tokens, page: children[0].page, layer, plane: "paint", atomic: atomic || oneObject,
      children, objectId: options.objectId, node: { ...node, children: children.flatMap(unit => unit.node ? [unit.node] : []),
        ...(node.softMask ? { softMask: { ...node.softMask, children: maskNodes } } : {}) } }];
  });
  const units = visit(source.paintGraph?.roots ?? original.map((_, runIndex) => ({ kind: "draw", runIndex })));
  const scene: VectorScene = { ...source, drawRuns: runs, paintGraph: { roots: units.flatMap(unit => unit.node ? [unit.node] : []) } };
  retainEditorPaintIdentity(source, scene); return { scene, units };
}

function stableSlots(units: readonly EditorOrderUnit[], arranged: readonly EditorOrderUnit[], scope: (unit: EditorOrderUnit) => string): EditorOrderUnit[] {
  const byScope = new Map<string, EditorOrderUnit[]>();
  for (const unit of arranged) { const key = scope(unit), values = byScope.get(key) ?? []; values.push(unit); byScope.set(key, values); }
  const cursors = new Map<string, number>();
  return units.map(unit => { const key = scope(unit), index = cursors.get(key) ?? 0; cursors.set(key, index + 1); return byScope.get(key)![index]; });
}
const scope = (unit: EditorOrderUnit): string => JSON.stringify([unit.page, unit.plane, unit.layer]);

/** The result is calculated from paint order, never selection-click order. */
export function arrangeEditorOrder(units: readonly EditorOrderUnit[], selected: ReadonlySet<string>, action: EditorStackingAction): { units: EditorOrderUnit[]; changed: boolean } {
  if (!["send-to-back", "bring-to-front", "bring-forward", "send-backward"].includes(action)) throw new TypeError("Unknown stacking action.");
  let changed = false;
  const children = units.map(unit => {
    if (unit.atomic || !unit.children) return unit;
    const nested = arrangeEditorOrder(unit.children, selected, action); changed ||= nested.changed;
    return nested.changed ? { ...unit, children: nested.units, tokens: joinTokens(nested.units) } : unit;
  });
  const scopes = new Map<string, EditorOrderUnit[]>();
  for (const unit of children) { const key = scope(unit), peers = scopes.get(key) ?? []; peers.push(unit); scopes.set(key, peers); }
  const isSelected = (unit: EditorOrderUnit): boolean => unit.owners.length > 0 && unit.owners.every(owner => selected.has(owner));
  for (const [key, peers] of scopes) {
    let ordered: EditorOrderUnit[];
    if (action === "send-to-back") ordered = [...peers.filter(isSelected), ...peers.filter(unit => !isSelected(unit))];
    else if (action === "bring-to-front") ordered = [...peers.filter(unit => !isSelected(unit)), ...peers.filter(isSelected)];
    else {
      ordered = [...peers];
      if (action === "bring-forward") for (let i = ordered.length - 2; i >= 0; i--) {
        if (isSelected(ordered[i]) && !isSelected(ordered[i + 1])) [ordered[i], ordered[i + 1]] = [ordered[i + 1], ordered[i]];
      }
      else for (let i = 1; i < ordered.length; i++) {
        if (isSelected(ordered[i]) && !isSelected(ordered[i - 1])) [ordered[i], ordered[i - 1]] = [ordered[i - 1], ordered[i]];
      }
    }
    changed ||= ordered.some((unit, index) => unit !== peers[index]); scopes.set(key, ordered);
  }
  const ordered = [...scopes.values()].flat();
  return { units: stableSlots(children, ordered, scope), changed };
}

export function editorOrderTokens(units: readonly EditorOrderUnit[]): string[] {
  return unique(units.flatMap(unit => unit.children ? editorOrderTokens(unit.children) : unit.tokens));
}
export function applyEditorOrderTokens(units: readonly EditorOrderUnit[], order: readonly string[] | undefined,
  layerOrder?: ReadonlyMap<string, number>): EditorOrderUnit[] {
  const ranks = new Map(order?.map((token, index) => [token, index]));
  const ownerRanks = new Map<string, number>();
  for (const [token, rank] of ranks) { const owner = JSON.parse(token)[0]; if (!ownerRanks.has(owner)) ownerRanks.set(owner, rank); }
  const rank = (unit: EditorOrderUnit): number => unit.tokens.reduce((minimum, token) => Math.min(minimum, ranks.get(token) ?? ownerRanks.get(JSON.parse(token)[0]) ?? Infinity), Infinity);
  const visit = (input: readonly EditorOrderUnit[]): EditorOrderUnit[] => {
    let next = input.map(unit => !unit.atomic && unit.children ? { ...unit, children: visit(unit.children) } : unit);
    if (order?.length) {
      const byPage = new Map<number, EditorOrderUnit[]>();
      for (const unit of next) { const values = byPage.get(unit.page) ?? []; values.push(unit); byPage.set(unit.page, values); }
      const sorted = [...byPage.values()].flatMap(units => units.map((unit, index) => ({ unit, index })).sort((a, b) => rank(a.unit) - rank(b.unit) || a.index - b.index).map(item => item.unit));
      next = stableSlots(next, sorted, unit => String(unit.page));
    }
    if (layerOrder) {
      const sorted = new Map<number, EditorOrderUnit[]>();
      for (const unit of next) if (unit.layer !== null) { const values = sorted.get(unit.page) ?? []; values.push(unit); sorted.set(unit.page, values); }
      for (const [page, units] of sorted) sorted.set(page, units.map((unit, index) => ({ unit, index }))
        .sort((a, b) => (layerOrder.get(b.unit.layer!) ?? 0) - (layerOrder.get(a.unit.layer!) ?? 0) || a.index - b.index).map(item => item.unit));
      const cursors = new Map<number, number>();
      next = next.map(unit => { if (unit.layer === null) return unit; const index = cursors.get(unit.page) ?? 0; cursors.set(unit.page, index + 1); return sorted.get(unit.page)![index]; });
    }
    return next;
  };
  return visit(units);
}

/** Use the full virtual schedule before projecting missing authored paints out. */
export function projectEditorOrder(scene: VectorScene, units: readonly EditorOrderUnit[], tokenRanks: ReadonlyMap<string, number>): VectorScene {
  const original = scene.drawRuns ?? defaultVectorDrawRuns(scene), runs: VectorDrawRun[] = [];
  const rank = (unit: EditorOrderUnit): number => unit.tokens.reduce((minimum, token) => Math.min(minimum, tokenRanks.get(token) ?? Infinity), Infinity);
  const appendRun = (run: VectorDrawRun, nodes: ScenePaintNode[], node: ScenePaintNode): void => {
    const previous = nodes[nodes.length - 1];
    if (previous?.kind === "draw" && node.kind === "draw") {
      const old = runs[previous.runIndex], { first: _a, count: _b, ...oldMeta } = old, { first: _c, count: _d, ...nextMeta } = run;
      if (old.kind === run.kind && old.first + old.count === run.first && JSON.stringify(oldMeta) === JSON.stringify(nextMeta) && previous.optionalContent === node.optionalContent) { old.count += run.count; return; }
    }
    const runIndex = runs.length; runs.push({ ...run }); nodes.push({ ...node, kind: "draw", runIndex } as ScenePaintNode);
  };
  const emit = (input: readonly EditorOrderUnit[], sort = true): ScenePaintNode[] => {
    const ordered = sort ? input.map((unit, index) => ({ unit, index })).sort((a, b) => rank(a.unit) - rank(b.unit) || a.index - b.index).map(item => item.unit) : input;
    const nodes: ScenePaintNode[] = [];
    for (const unit of ordered) {
      const node = unit.node; if (!node) continue;
      if (node.kind === "draw") appendRun(original[node.runIndex], nodes, node);
      else if (node.kind === "retained") {
        const run = original.find(run => run.kind === "raster" && run.first === node.rasterIndex && run.count === 1); if (!run) throw new RangeError("Retained paint is missing."); runs.push(run); nodes.push(node);
      } else {
        // Masks retain their original order; they do not own sibling paint slots.
        const masks = (children: readonly ScenePaintNode[]): ScenePaintNode[] => children.map(child => {
          if (child.kind === "draw") { const runIndex = runs.length; runs.push({ ...original[child.runIndex] }); return { ...child, runIndex }; }
          if (child.kind === "group") return { ...child, children: masks(child.children), ...(child.softMask ? { softMask: { ...child.softMask, children: masks(child.softMask.children) } } : {}) };
          const run = original.find(run => run.kind === "raster" && run.first === child.rasterIndex && run.count === 1); if (run) runs.push(run); return child;
        });
        nodes.push({ ...node, children: emit(unit.children ?? [], !unit.atomic), ...(node.softMask ? { softMask: { ...node.softMask, children: masks(node.softMask.children) } } : {}) });
      }
    }
    return nodes;
  };
  const result: VectorScene = { ...scene, drawRuns: runs, paintGraph: { roots: emit(units) } };
  retainEditorPaintIdentity(scene, result); return result;
}
