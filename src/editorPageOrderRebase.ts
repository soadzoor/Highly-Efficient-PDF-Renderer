import type { EditorMatrix, EditorSession } from "./editorTypes";
import { composeOverlappingVectorScenes, type VectorDrawRun, type VectorScene } from "./pdfVectorExtractor";
import type { PdfPageOperation } from "./editorPdfPages";
import type { ScenePaintNode } from "./scenePaintGraph";
import { createEmptyVectorScene } from "./emptyVectorScene";
import { composeEditorPage, invertEditorMatrix, multiplyEditorMatrices, transformWholeEditorScene } from "./editorScene";
import { editorPaintIdentity, editorPaintOwnerObject, setEditorPaintIdentity, retainEditorPaintIdentity, remapEditorPaintIdentity, composeEditorPaintIdentity, remapEditorPaintOwner } from "./editorPaintIdentity";
import { PAGE_PRIMITIVE_KINDS, ScenePageViews, scenePrimitiveCounts } from "./scenePageViews";

export function editorOperationPageMap(before: number, after: number, operation: PdfPageOperation): (number | null)[] {
  const removed = new Set(operation.kind === "remove" ? operation.pages : []), added = after - before;
  let shift = 0;
  return Array.from({ length: before }, (_, index) => {
    if (removed.has(index)) { shift++; return null; }
    return operation.kind === "insert" && index >= operation.at ? index + added : index - shift;
  });
}

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
    remapOrder(order: readonly string[], ids: ReadonlyMap<string, string>): readonly string[];
  } {
  const pageMap = editorOperationPageMap(previous.sourceScene.pageCount, parsed.pageCount, operation);
  const originals = new Map(pageMap.flatMap((page, index) => page === null ? [] : [[page, index] as const]));
  const targetAnnotations = parsed.annotations ?? [], aliases = new Map<string, string>();
  for (const annotation of canonical.annotations ?? []) {
    const targetPage = pageMap[annotation.pageIndex]; if (targetPage === null || !previous.sourcePdf) continue;
    const exact = targetAnnotations.find(item => item.id === annotation.id && item.pageIndex === targetPage);
    const named = annotation.name ? targetAnnotations.filter(item => item.name === annotation.name && item.pageIndex === targetPage) : [];
    const target = exact ?? (named.length === 1 ? named[0] : undefined);
    if (!target) throw new Error(`Page changes could not preserve the annotation identity ${annotation.id}; the active document is unchanged.`);
    aliases.set(annotation.id, target.id);
  }
  const clones = new Map(previous.getObjects({ includeSource: false }).filter(object => object.kind === "source" && object.isClone).flatMap(object => {
    const page = pageMap[object.pageIndex]; if (page === null) return [];
    const entries = targetAnnotations.filter(annotation => annotation.pageIndex === page && annotation.name === object.id);
    if (entries.length !== 1) throw new Error(`Page changes could not preserve the source copy ${object.id}; the active document is unchanged.`);
    return [[object.id, entries[0].id] as const];
  }));
  const views = new ScenePageViews(canonical), targets = new ScenePageViews(parsed), owners = new Set<string>(), pages: VectorScene[] = [];
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
    if (kept.optionalContent) {
      const internal = new Map(kept.optionalContent.groups.filter(group => group.annotationId !== undefined).map(group => [group.id, group]));
      const groupNames = new Map(kept.optionalContent.groups.map(group => {
        const id = group.annotationId ? aliases.get(group.annotationId) : undefined;
        const replacement = id ? parsed.optionalContent?.groups.find(item => item.annotationId === id) : undefined;
        return [group.id, replacement?.id ?? group.id];
      }));
      const before = kept;
      kept = { ...kept, optionalContent: { ...kept.optionalContent,
        groups: kept.optionalContent.groups.flatMap(group => {
          if (!previous.sourcePdf && group.annotationId !== undefined) return [];
          const annotationId = group.annotationId ? aliases.get(group.annotationId) : undefined;
          return [{ ...group, id: groupNames.get(group.id)!, ...(annotationId ? { annotationId } : {}) }];
        }),
        conditions: kept.optionalContent.conditions.map(condition => condition.kind !== "group" ? condition :
          !previous.sourcePdf && internal.has(condition.groupId) ? { kind: "constant" as const, value: internal.get(condition.groupId)!.defaultVisible }
          : { ...condition, groupId: groupNames.get(condition.groupId) ?? condition.groupId }) } };
      retainEditorPaintIdentity(before, kept);
    }
    const identity = editorPaintIdentity(kept), counts = scenePrimitiveCounts(kept), cloneOwners = new Map<string, string>();
    for (const kind of PAGE_PRIMITIVE_KINDS) for (let index = 0; index < counts[kind]; index++) {
      const owner = identity({ kind, index }); owners.add(owner);
      const object = editorPaintOwnerObject(owner), annotation = object === undefined ? undefined : clones.get(object);
      if (annotation !== undefined) cloneOwners.set(`${namespace}retained:${owner}`, annotation);
    }
    kept = { ...kept, pageRects: target.pageRects, pdfPages: target.pdfPages, annotations: undefined };
    setEditorPaintIdentity(kept, ref => `${namespace}retained:${identity(ref)}`);
    const metadata = { ...createEmptyVectorScene(), pageCount: 1, pagesPerRow: 1, pageRects: target.pageRects,
      pageTextRanges: Uint32Array.of(0, 0), bounds: target.bounds, pdfPages: target.pdfPages, annotations: target.annotations, optionalContent: target.optionalContent };
    pages.push(annotationConditions(composeEditorPage(kept, [metadata]), cloneOwners));
  }
  const scene = composeOverlappingVectorScenes(pages);
  composeEditorPaintIdentity(pages, scene); scene.pdfPages = parsed.pdfPages;
  scene.pageCount = parsed.pageCount; scene.pagesPerRow = parsed.pagesPerRow; scene.pageRects = parsed.pageRects.slice();
  scene.sourcePdfByteLength = parsed.sourcePdfByteLength;
  return { scene,
    remapOrder(order, ids) {
      return order.flatMap(token => {
        const [owner, layer] = JSON.parse(token) as [string, string | null];
        if (owners.has(owner)) return [JSON.stringify([`${namespace}retained:${owner}`, layer])];
        const object = editorPaintOwnerObject(owner);
        if (object !== undefined) return ids.has(object) ? [JSON.stringify([remapEditorPaintOwner(owner, ids), layer])] : [];
        if (owner.startsWith("annotation:")) { const id = aliases.get(owner.slice(11)); return id ? [JSON.stringify([`annotation:${id}`, layer])] : []; }
        return [];
      });
    } };
}
