import type { VectorScene, VectorDrawRun } from "./pdfVectorExtractor";
import type { ScenePaintNode, ScenePaintGroup } from "./scenePaintGraph";
import type { PrimitiveKind } from "./scenePrimitives";
import { PAGE_PRIMITIVE_KINDS } from "./scenePageViews";
import { defaultVectorDrawRuns } from "./vectorDrawOrder";
import { compactEditorScene, composeEditorPage } from "./editorScene";

const ORDINARY = Symbol("ordinary"), MIXED = Symbol("mixed"), EMPTY = Symbol("empty");
type Owner = string | typeof ORDINARY | typeof MIXED | typeof EMPTY;
interface Slot { id: string; node: ScenePaintNode; parent: ScenePaintNode[]; ancestors: ScenePaintGroup[] }

function withGraph(scene: VectorScene): VectorScene {
  const drawRuns = scene.drawRuns ?? defaultVectorDrawRuns(scene);
  return { ...scene, drawRuns, paintGraph: scene.paintGraph ?? { roots: drawRuns.map((_, runIndex) => ({ kind: "draw", runIndex })) } };
}

/** Ownership ignores mask paint: masks travel with their enclosing appearance. */
function ownership(scene: VectorScene): { owners: ReadonlyMap<ScenePaintNode, Owner>; conditionOwner(index?: number): string | undefined } {
  const groups = new Map(scene.optionalContent?.groups.map(group => [group.id, group.annotationId]));
  const conditions = scene.optionalContent?.conditions ?? [], cache = new Map<number, string | undefined>();
  const conditionOwner = (index?: number): string | undefined => {
    if (index === undefined) return undefined;
    if (cache.has(index)) return cache.get(index);
    const pending = [index], visited = new Set<number>(); let result: string | undefined;
    while (pending.length) {
      const at = pending.pop()!; if (visited.has(at)) continue; visited.add(at);
      const condition = conditions[at];
      if (condition?.kind === "group") { result = groups.get(condition.groupId); if (result) break; }
      else if (condition?.kind === "not") pending.push(condition.operand);
      else if (condition?.kind === "and" || condition?.kind === "or") for (let i = condition.operands.length - 1; i >= 0; i--) pending.push(condition.operands[i]);
    }
    cache.set(index, result); return result;
  };
  const rasterRuns = new Map<number, VectorDrawRun>();
  for (const run of scene.drawRuns!) if (run.kind === "raster" && run.count === 1) rasterRuns.set(run.first, run);
  const result = new Map<ScenePaintNode, Owner>();
  const visit = (node: ScenePaintNode, inherited?: string): Owner => {
    const own = conditionOwner(node.optionalContent) ?? inherited;
    let owner: Owner;
    if (node.kind === "group") {
      owner = EMPTY;
      for (const child of node.children) {
        const next = visit(child, own); if (next === EMPTY) continue;
        owner = owner === EMPTY ? next : owner === next ? owner : MIXED;
      }
    } else {
      const run = node.kind === "draw" ? scene.drawRuns![node.runIndex] : rasterRuns.get(node.rasterIndex);
      owner = conditionOwner(run?.optionalContent) ?? own ?? ORDINARY;
    }
    result.set(node, owner); return owner;
  };
  for (const node of scene.paintGraph!.roots) visit(node);
  return { owners: result, conditionOwner };
}

function compactGraph(scene: VectorScene, roots: ScenePaintNode[], signal?: AbortSignal): VectorScene {
  const keep = Object.fromEntries(PAGE_PRIMITIVE_KINDS.map(kind => [kind, new Set<number>()])) as Record<PrimitiveKind, Set<number>>;
  const visit = (nodes: readonly ScenePaintNode[]): void => {
    for (const node of nodes) {
      signal?.throwIfAborted();
      if (node.kind === "group") { visit(node.children); if (node.softMask) visit(node.softMask.children); }
      else if (node.kind === "retained") keep.raster.add(node.rasterIndex);
      else {
        const run = scene.drawRuns![node.runIndex];
        for (let index = run.first; index < run.first + run.count; index++) keep[run.kind].add(index);
      }
    }
  };
  visit(roots);
  return compactEditorScene({ ...scene, paintGraph: { roots } }, keep);
}

/** Extract one updated field together with every mask needed to paint it. */
export function extractEditorFieldAppearance(source: VectorScene, annotationId: string, signal?: AbortSignal): VectorScene {
  const scene = withGraph(source), { owners } = ownership(scene);
  const filter = (nodes: readonly ScenePaintNode[]): ScenePaintNode[] => nodes.flatMap((node): ScenePaintNode[] => {
    signal?.throwIfAborted();
    if (owners.get(node) === annotationId) return [node];
    if (node.kind !== "group") return [];
    const children = filter(node.children);
    return children.length ? [{ ...node, children }] : [];
  });
  const result = compactGraph(scene, filter(scene.paintGraph!.roots), signal);
  result.annotations = []; return result;
}

function sameScope(a: ScenePaintGroup, b: ScenePaintGroup): boolean {
  return a.alpha === b.alpha && a.isolated === b.isolated && a.knockout === b.knockout && a.blendMode === b.blendMode &&
    Boolean(a.alphaIsShape) === Boolean(b.alphaIsShape) && a.softMask?.subtype === b.softMask?.subtype &&
    (a.softMask?.transfer?.length ?? 0) === (b.softMask?.transfer?.length ?? 0);
}

/** Strip shared page scopes already supplied by the original template. */
function withinContext(roots: ScenePaintNode[], ancestors: readonly ScenePaintGroup[], conditionOwner: (index?: number) => string | undefined): ScenePaintNode[] {
  let result = roots;
  for (const ancestor of ancestors) {
    if (result.length !== 1 || result[0].kind !== "group" || !sameScope(result[0], ancestor) ||
        conditionOwner(result[0].optionalContent) !== conditionOwner(ancestor.optionalContent)) break;
    result = result[0].children;
  }
  return result;
}

/**
 * Replace field appearances at their original paint positions. Geometry stays
 * vector; ordinary content, sibling annotations and shared composite scopes
 * retain their order. A null replacement clears an appearance.
 */
export function replaceEditorFieldAppearances(source: VectorScene, replacements: ReadonlyMap<string, VectorScene | null>, options: {
  readonly preserveNonText?: ReadonlySet<string>; readonly signal?: AbortSignal;
} = {}): VectorScene {
  if (!replacements.size) return source;
  if (source.pageCount !== 1 || source.pageRects.length !== 4) throw new RangeError("Field replacement requires one page.");
  const original = withGraph(source), entries = [...replacements], additions = entries.map(([, value]) => value ? withGraph(value) : null);
  const merged = composeEditorPage(original, additions.filter((value): value is VectorScene => value !== null));
  const roots = merged.paintGraph!.roots.slice(0, original.paintGraph!.roots.length), blocks = new Map<string, ScenePaintNode[]>();
  let offset = original.paintGraph!.roots.length;
  entries.forEach(([id], index) => {
    const count = additions[index]?.paintGraph!.roots.length ?? 0;
    blocks.set(id, merged.paintGraph!.roots.slice(offset, offset + count)); offset += count;
  });
  const { owners, conditionOwner } = ownership(merged), slots: Slot[] = [];
  const trimContext = (nodes: ScenePaintNode[], ancestors: readonly ScenePaintGroup[]) => withinContext(nodes, ancestors, conditionOwner);
  const collect = (nodes: ScenePaintNode[], ancestors: ScenePaintGroup[]): void => {
    for (const node of nodes) {
      options.signal?.throwIfAborted();
      const owner = owners.get(node);
      if (typeof owner === "string") slots.push({ id: owner, node, parent: nodes, ancestors });
      else if (node.kind === "group") collect(node.children, [...ancestors, node]);
    }
  };
  collect(roots, []);
  const changed = new Map<ScenePaintNode, ScenePaintNode[]>(), before = new Map<ScenePaintNode, ScenePaintNode[]>(),
    after = new Map<ScenePaintNode, ScenePaintNode[]>(), tails = new Map<ScenePaintNode[], ScenePaintNode[]>(), affected = new Set<ScenePaintGroup>();
  const rank = new Map(source.annotations?.map(annotation => [annotation.id, annotation.annotationIndex]));
  const append = (map: Map<ScenePaintNode, ScenePaintNode[]>, key: ScenePaintNode, value: ScenePaintNode[]) => map.set(key, [...(map.get(key) ?? []), ...value]);
  for (const [id] of entries.sort(([a], [b]) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity))) {
    options.signal?.throwIfAborted();
    const ownSlots = slots.filter(slot => slot.id === id), preserve = options.preserveNonText?.has(id);
    let anchor: Slot | undefined = ownSlots[0], target: ScenePaintNode[] | undefined, ancestors: ScenePaintGroup[];
    if (preserve && ownSlots.length) {
      // Retain the original background and its masks, replacing text within
      // that same scope rather than lifting it above later annotations.
      const textSlots: Slot[] = [];
      const findText = (node: ScenePaintNode, parent: ScenePaintNode[], chain: ScenePaintGroup[]) => {
        if (node.kind === "group") for (const child of node.children) findText(child, node.children, [...chain, node]);
        else if (node.kind === "draw" && merged.drawRuns![node.runIndex].kind === "text") textSlots.push({ id, node, parent, ancestors: chain });
      };
      for (const slot of ownSlots) findText(slot.node, slot.parent, slot.ancestors);
      if (textSlots.length) {
        anchor = textSlots[0]; ancestors = anchor.ancestors;
        for (const slot of textSlots) changed.set(slot.node, []);
        target = trimContext(blocks.get(id)!, ancestors);
        changed.set(anchor.node, target);
      } else {
        anchor = ownSlots[ownSlots.length - 1];
        if (anchor.node.kind === "group") {
          ancestors = [...anchor.ancestors, anchor.node]; target = trimContext(blocks.get(id)!, ancestors);
          tails.set(anchor.node.children, [...(tails.get(anchor.node.children) ?? []), ...target]);
        } else { ancestors = anchor.ancestors; target = trimContext(blocks.get(id)!, ancestors); append(after, anchor.node, target); }
      }
    } else if (anchor) {
      ancestors = anchor.ancestors; target = trimContext(blocks.get(id)!, ancestors);
      for (const slot of ownSlots) changed.set(slot.node, []);
      changed.set(anchor.node, target);
    } else {
      const next = slots.find(slot => (rank.get(slot.id) ?? Infinity) > (rank.get(id) ?? Infinity));
      const previous = [...slots].reverse().find(slot => (rank.get(slot.id) ?? -1) < (rank.get(id) ?? Infinity));
      anchor = next ?? previous;
      if (anchor) {
        ancestors = anchor.ancestors; target = trimContext(blocks.get(id)!, ancestors);
        append(next ? before : after, anchor.node, target);
      } else {
        ancestors = [];
        let container = roots;
        const block = blocks.get(id)!;
        if (roots.length === 1 && roots[0].kind === "group" && block.length === 1 && block[0].kind === "group" && sameScope(roots[0], block[0])) {
          ancestors = [roots[0]]; container = roots[0].children;
        }
        target = trimContext(block, ancestors); tails.set(container, [...(tails.get(container) ?? []), ...target]);
      }
    }
    for (const ancestor of ancestors!) affected.add(ancestor);
  }
  const rewrite = (nodes: ScenePaintNode[]): ScenePaintNode[] => {
    const output: ScenePaintNode[] = [];
    for (const node of nodes) {
      if (before.has(node)) output.push(...before.get(node)!);
      if (changed.has(node)) output.push(...changed.get(node)!);
      else if (node.kind === "group") {
        const children = rewrite(node.children);
        if (children.length) output.push({ ...node, children, ...(affected.has(node) ? { bounds: undefined } : {}) });
      } else output.push(node);
      if (after.has(node)) output.push(...after.get(node)!);
    }
    if (tails.has(nodes)) output.push(...tails.get(nodes)!);
    return output;
  };
  return compactGraph(merged, rewrite(roots), options.signal);
}
