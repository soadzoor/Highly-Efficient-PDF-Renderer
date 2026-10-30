import type { EditorMatrix, EditorSession } from "./editorTypes";
import { composeOverlappingVectorScenes, type VectorDrawRun, type VectorScene } from "./pdfVectorExtractor";
import type { PdfPageOperation } from "./editorPdfPages";
import type { ScenePaintNode } from "./scenePaintGraph";
import { createEmptyVectorScene } from "./emptyVectorScene";
import { compactEditorScene, composeEditorPage, editorTransformBounds, invertEditorMatrix, multiplyEditorMatrices, transformWholeEditorScene } from "./editorScene";
import { editorPaintIdentity, editorPaintOwnerObject, setEditorPaintIdentity, retainEditorPaintIdentity, remapEditorPaintIdentity, composeEditorPaintIdentity, remapEditorPaintOwner } from "./editorPaintIdentity";
import { PAGE_PRIMITIVE_KINDS, ScenePageViews, scenePrimitiveCounts } from "./scenePageViews";
import { getScenePrimitiveBounds, type PrimitiveKind } from "./scenePrimitives";

export function editorOperationPageMap(before: number, after: number, operation: PdfPageOperation): (number | null)[] {
  if (operation.kind === "reorder") return Array.from({ length: before }, (_, index) => operation.pages.indexOf(index));
  if (operation.kind === "extract") return Array.from({ length: before }, (_, index) => {
    const target = operation.pages.indexOf(index); return target < 0 ? null : target;
  });
  const removed = new Set(operation.kind === "remove" ? operation.pages : []), added = after - before;
  let shift = 0;
  return Array.from({ length: before }, (_, index) => {
    if (removed.has(index)) { shift++; return null; }
    return (operation.kind === "insert" || operation.kind === "duplicate") && index >= operation.at ? index + added : index - shift;
  });
}

/** Originals retain their identity; duplicates get additional independent targets. */
export function editorOperationPageTargets(before: number, after: number, operation: PdfPageOperation): readonly (readonly number[])[] {
  const primary = editorOperationPageMap(before, after, operation);
  return primary.map((page, index) => page === null ? [] : [page,
    ...(operation.kind === "duplicate" ? operation.pages.flatMap((source, offset) => source === index ? [operation.at + offset] : []) : [])]);
}

export type EditorRebasedObjectIds = ReadonlyMap<string, string> & {
  readonly pageCopies?: ReadonlyMap<number, ReadonlyMap<string, string>>;
};

/** Captured source copies become real native Stamp annotations after page edits. */
function annotationConditions(scene: VectorScene, owners: ReadonlyMap<string, string>): VectorScene {
  if (!owners.size || !scene.optionalContent) return scene;
  const identity = editorPaintIdentity(scene), runs: VectorDrawRun[] = [], indices: number[][] = [];
  const conditions = [...scene.optionalContent.conditions], known = new Map(conditions.map((condition, index) => [JSON.stringify(condition), index]));
  const put = (condition: typeof conditions[number]): number => {
    const key = JSON.stringify(condition); let index = known.get(key);
    if (index === undefined) { index = conditions.length; conditions.push(condition); known.set(key, index); } return index;
  };
  const join = (a: number | undefined, b: number | undefined): number | undefined => a === undefined ? b : b === undefined || a === b ? a : put({ kind: "and", operands: [a, b] });
  const outer = new Map<string, number | undefined>();
  for (const id of new Set(owners.values())) {
    const group = scene.optionalContent.groups.find(group => group.annotationId === id), annotation = scene.annotations?.find(annotation => annotation.id === id);
    outer.set(id, join(group ? put({ kind: "group", groupId: group.id }) : undefined, annotation?.optionalContent));
  }
  for (const run of scene.drawRuns ?? []) {
    const mapped: number[] = []; indices.push(mapped);
    for (let index = run.first; index < run.first + run.count; index++) {
      const id = owners.get(identity({ kind: run.kind, index })), condition = join(run.optionalContent, id === undefined ? undefined : outer.get(id));
      const previous = runs[mapped[mapped.length - 1]];
      if (previous && previous.optionalContent === condition) { previous.count++; continue; }
      const next: VectorDrawRun = { ...run, first: index, count: 1 }; delete next.optionalContent;
      if (condition !== undefined) next.optionalContent = condition;
      mapped.push(runs.length); runs.push(next);
    }
  }
  const nodes = (values: readonly ScenePaintNode[]): ScenePaintNode[] => values.flatMap((node): ScenePaintNode[] => node.kind === "draw"
    ? indices[node.runIndex].map(runIndex => ({ ...node, runIndex }))
    : [{ ...node, ...(node.kind === "group" ? { children: nodes(node.children),
      ...(node.softMask ? { softMask: { ...node.softMask, children: nodes(node.softMask.children) } } : {}) } : {}) }]);
  const result: VectorScene = { ...scene, optionalContent: { ...scene.optionalContent, conditions }, drawRuns: runs,
    ...(scene.paintGraph ? { paintGraph: { roots: nodes(scene.paintGraph.roots) } } : {}) };
  retainEditorPaintIdentity(scene, result); return result;
}

/** PDF page materialization cannot encode source/annotation interleaving. Retain
 * canonical geometry in memory, while using the new PDF's actual editable refs. */
export function rebaseEditorOrderedSource(previous: EditorSession, canonical: VectorScene, parsed: VectorScene,
  operation: PdfPageOperation, namespace: string, signal: AbortSignal): {
    scene: VectorScene;
    remapOrder(order: readonly string[], ids: EditorRebasedObjectIds): readonly string[];
  } {
  const pageTargets = editorOperationPageTargets(previous.sourceScene.pageCount, parsed.pageCount, operation);
  const originals = new Map(pageTargets.flatMap((pages, index) => pages.map(page => [page, index] as const)));
  const targetAnnotations = parsed.annotations ?? [], aliasesByPage = new Map<number, Map<string, string>>(), aliases = new Map<string, string[]>();
  for (const annotation of canonical.annotations ?? []) for (const targetPage of pageTargets[annotation.pageIndex]) {
    if (!previous.sourcePdf) continue;
    const exact = targetAnnotations.find(item => item.id === annotation.id && item.pageIndex === targetPage);
    const named = annotation.name ? targetAnnotations.filter(item => item.name === annotation.name && item.pageIndex === targetPage) : [];
    const originalAnnotations = targetAnnotations.filter(item => item.pageIndex === pageTargets[annotation.pageIndex][0]);
    const ordinal = originalAnnotations.findIndex(item => item.id === annotation.id);
    // Native page duplication retains the annotation-array order, including
    // widgets without /NM names. Their new refs must alias the copied widget.
    const copied = targetPage !== pageTargets[annotation.pageIndex][0] && ordinal >= 0
      ? targetAnnotations.filter(item => item.pageIndex === targetPage)[ordinal] : undefined;
    const target = exact ?? (named.length === 1 ? named[0] : undefined) ?? copied;
    if (!target) throw new Error(`Page changes could not preserve the annotation identity ${annotation.id}; the active document is unchanged.`);
    let page = aliasesByPage.get(targetPage); if (!page) aliasesByPage.set(targetPage, page = new Map()); page.set(annotation.id, target.id);
    aliases.set(annotation.id, [...(aliases.get(annotation.id) ?? []), target.id]);
  }
  const clonesByPage = new Map<number, Map<string, string>>();
  for (const object of previous.getObjects({ includeSource: false }).filter(object => object.kind === "source" && object.isClone)) for (const page of pageTargets[object.pageIndex]) {
    const entries = targetAnnotations.filter(annotation => annotation.pageIndex === page && annotation.name === object.id);
    if (entries.length !== 1) throw new Error(`Page changes could not preserve the source copy ${object.id}; the active document is unchanged.`);
    let clones = clonesByPage.get(page); if (!clones) clonesByPage.set(page, clones = new Map()); clones.set(object.id, entries[0].id);
  }
  const views = new ScenePageViews(canonical), targets = new ScenePageViews(parsed), owners = new Map<string, string[]>(), pages: VectorScene[] = [];
  for (let page = 0; page < parsed.pageCount; page++) {
    signal.throwIfAborted(); const target = targets.extract(page).scene, original = originals.get(page);
    if (original === undefined) {
      const identity = editorPaintIdentity(target); setEditorPaintIdentity(target, ref => `${namespace}foreign:${page}:${identity(ref)}`);
      pages.push(target); continue;
    }
    const extracted = views.extract(original); remapEditorPaintIdentity(canonical, extracted.scene, extracted.primitives);
    const oldPage = previous.sourceScene.pdfPages?.find(info => info.pageIndex === original), newPage = parsed.pdfPages?.find(info => info.pageIndex === page);
    if (!newPage) throw new Error("The changed PDF has no page-coordinate mapping.");
    const origin = canonical.pageRects.subarray(original * 4, original * 4 + 4);
    const matrix: EditorMatrix = multiplyEditorMatrices(newPage.pdfToScene, previous.sourcePdf && oldPage
      ? invertEditorMatrix(oldPage.pdfToScene) : [1, 0, 0, 1, -origin[0], -origin[1]]);
    let kept = transformWholeEditorScene(extracted.scene, matrix, signal);
    const pageAliases = aliasesByPage.get(page) ?? new Map<string, string>(), clones = clonesByPage.get(page) ?? new Map<string, string>();
    if (kept.optionalContent) {
      const internal = new Map(kept.optionalContent.groups.filter(group => group.annotationId !== undefined).map(group => [group.id, group]));
      const groupNames = new Map(kept.optionalContent.groups.map(group => {
        const id = group.annotationId ? pageAliases.get(group.annotationId) : undefined;
        const replacement = id ? parsed.optionalContent?.groups.find(item => item.annotationId === id) : undefined;
        return [group.id, replacement?.id ?? group.id];
      }));
      const before = kept;
      kept = { ...kept, optionalContent: { ...kept.optionalContent,
        groups: kept.optionalContent.groups.flatMap(group => {
          if (!previous.sourcePdf && group.annotationId !== undefined) return [];
          const annotationId = group.annotationId ? pageAliases.get(group.annotationId) : undefined;
          return [{ ...group, id: groupNames.get(group.id)!, ...(annotationId ? { annotationId } : {}) }];
        }),
        conditions: kept.optionalContent.conditions.map(condition => condition.kind !== "group" ? condition :
          !previous.sourcePdf && internal.has(condition.groupId) ? { kind: "constant" as const, value: internal.get(condition.groupId)!.defaultVisible }
          : { ...condition, groupId: groupNames.get(condition.groupId) ?? condition.groupId }) } };
      retainEditorPaintIdentity(before, kept);
    }
    const identity = editorPaintIdentity(kept), counts = scenePrimitiveCounts(kept), cloneOwners = new Map<string, string>();
    for (const kind of PAGE_PRIMITIVE_KINDS) for (let index = 0; index < counts[kind]; index++) {
      const owner = identity({ kind, index }), mapped = `${namespace}retained:${page}:${owner}`;
      if (!owners.get(owner)?.includes(mapped)) owners.set(owner, [...(owners.get(owner) ?? []), mapped]);
      const object = editorPaintOwnerObject(owner), annotation = object === undefined ? undefined : clones.get(object);
      if (annotation !== undefined) cloneOwners.set(`${namespace}retained:${page}:${owner}`, annotation);
    }
    kept = { ...kept, pageRects: target.pageRects, pdfPages: target.pdfPages, annotations: undefined };
    setEditorPaintIdentity(kept, ref => `${namespace}retained:${page}:${identity(ref)}`);
    let revealed: VectorScene | undefined;
    if (operation.kind === "crop" && operation.pages.includes(original)) {
      const previousBounds = editorTransformBounds({ minX: origin[0], minY: origin[1], maxX: origin[2], maxY: origin[3] }, matrix);
      const box = target.pageRects;
      const expands = box[0] < previousBounds.minX - .001 || box[1] < previousBounds.minY - .001 ||
        box[2] > previousBounds.maxX + .001 || box[3] > previousBounds.maxY + .001;
      if (expands) {
        // The old parser can omit paint wholly outside its CropBox. Keep the
        // canonical result within that former box and reveal native paint only
        // outside it, without changing existing source/annotation interleaving.
        kept = clipRebasedPage(kept, [previousBounds.minX, previousBounds.minY, previousBounds.maxX, previousBounds.maxY]);
        const counts = scenePrimitiveCounts(target), keep = Object.fromEntries(PAGE_PRIMITIVE_KINDS.map(kind => [kind, new Set<number>()])) as Record<PrimitiveKind, Set<number>>;
        for (const kind of PAGE_PRIMITIVE_KINDS) for (let index = 0; index < counts[kind]; index++) {
          const b = getScenePrimitiveBounds(target, { kind, index });
          if (b.minX < previousBounds.minX || b.minY < previousBounds.minY || b.maxX > previousBounds.maxX || b.maxY > previousBounds.maxY) keep[kind].add(index);
        }
        const exterior = compactEditorScene(target, keep), parsedIdentity = editorPaintIdentity(exterior);
        revealed = clipRebasedPage({ ...exterior, annotations: undefined }, box, previousBounds);
        setEditorPaintIdentity(revealed, ref => `${namespace}revealed:${page}:${parsedIdentity(ref)}`);
        const aliases = new Map([...pageAliases].map(([old, current]) => [current, `annotation:${old}`]));
        const sourceCopies = new Map([...clones].map(([old, current]) => [current, old]));
        const revealedCounts = scenePrimitiveCounts(revealed);
        for (const kind of PAGE_PRIMITIVE_KINDS) for (let index = 0; index < revealedCounts[kind]; index++) {
          const owner = parsedIdentity({ kind, index }); if (!owner.startsWith("annotation:")) continue;
          const id = owner.slice(11), mapped = `${namespace}revealed:${page}:${owner}`, alias = aliases.get(id), copy = sourceCopies.get(id);
          for (const old of alias ? [alias] : copy ? [...owners.keys()].filter(owner => editorPaintOwnerObject(owner) === copy) : [])
            if (!owners.get(old)?.includes(mapped)) owners.set(old, [...(owners.get(old) ?? []), mapped]);
        }
      }
      kept = clipRebasedPage(kept, box);
    }
    const metadata = { ...createEmptyVectorScene(), pageCount: 1, pagesPerRow: 1, pageRects: target.pageRects,
      pageTextRanges: Uint32Array.of(0, 0), bounds: target.bounds, pdfPages: target.pdfPages, annotations: target.annotations, optionalContent: target.optionalContent };
    pages.push(annotationConditions(composeEditorPage(kept, [...(revealed ? [revealed] : []), metadata]), cloneOwners));
  }
  const scene = composeOverlappingVectorScenes(pages);
  composeEditorPaintIdentity(pages, scene); scene.pdfPages = parsed.pdfPages;
  scene.pageCount = parsed.pageCount; scene.pagesPerRow = parsed.pagesPerRow; scene.pageRects = parsed.pageRects.slice();
  scene.sourcePdfByteLength = parsed.sourcePdfByteLength;
  return { scene,
    remapOrder(order, ids) {
      return order.flatMap(token => {
        const [owner, layer] = JSON.parse(token) as [string, string | null];
        if (owners.has(owner)) return owners.get(owner)!.map(mapped => JSON.stringify([mapped, layer]));
        const object = editorPaintOwnerObject(owner);
        if (object !== undefined) {
          const maps = ids.pageCopies ? [...ids.pageCopies.values()] : [ids];
          return maps.flatMap(map => map.has(object) ? [JSON.stringify([remapEditorPaintOwner(owner, map), layer])] : []);
        }
        if (owner.startsWith("annotation:")) return (aliases.get(owner.slice(11)) ?? []).map(id => JSON.stringify([`annotation:${id}`, layer]));
        return [];
      });
    } };
}

/** Apply a visible-page boundary, optionally excluding the former visible box. */
function clipRebasedPage(scene: VectorScene, rect: ArrayLike<number>, exclude?: { minX: number; minY: number; maxX: number; maxY: number }): VectorScene {
  const edges = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y0, x1, y1, x1, y1, x0, y1, x0, y1, x0, y0];
  const [x0, y0, x1, y1] = Array.from(rect), pageClip = 0, offset = 1;
  const clipPaths = [{ parent: -1, fillRule: (exclude ? 1 : 0) as 0 | 1,
    edges: Float32Array.from([...edges(x0, y0, x1, y1), ...(exclude ? edges(exclude.minX, exclude.minY, exclude.maxX, exclude.maxY) : [])]) },
    ...(scene.clipPaths ?? []).map(clip => ({ ...clip, parent: clip.parent < 0 ? pageClip : clip.parent + offset }))];
  const result: VectorScene = { ...scene, clipPaths,
    drawRuns: (scene.drawRuns ?? []).map(run => ({ ...run, clipIndex: run.clipIndex === undefined || run.clipIndex < 0 ? pageClip : run.clipIndex + offset })) };
  retainEditorPaintIdentity(scene, result); return result;
}
