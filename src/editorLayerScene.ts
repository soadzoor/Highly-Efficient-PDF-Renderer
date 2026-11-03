import type { EditorLayerEdits, EditorStackingAction } from "./editorTypes";
import { editorPaintIdentity, editorAuthoredOwner, setEditorPaintIdentity, retainEditorPaintIdentity } from "./editorPaintIdentity";
import { editorOrderGeometry, editorOrderToken, editorCloneOwner, arrangeEditorOrder, editorOrderTokens, applyEditorOrderTokens, projectEditorOrder, type EditorOrderUnit } from "./editorObjectOrder";
import type { SceneOptionalContent, OptionalContentCondition } from "./optionalContentData";
import type { VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import type { PrimitiveRef } from "./scenePrimitives";
import { getSceneAnnotationRuns, getScenePrimitiveBounds, getPrimitiveVisibilityConditions, isScenePrimitiveVisible } from "./scenePrimitives";
import { importEditorLayerCondition } from "./editorLayers";
import { createDefaultOptionalContentSnapshot, validateSceneOptionalContentReferences } from "./optionalContent";
import type { ScenePaintGroup, ScenePaintNode } from "./scenePaintGraph";
import { defaultVectorDrawRuns } from "./vectorDrawOrder";
import { applyRetainedPageVisibility } from "./retainedPageReplay";
import { compactEditorScene, retainEditorAnnotationPlacements } from "./editorScene";
import type { PdfDiagnostic } from "./pdf/nativeTypes";
import { PAGE_PRIMITIVE_KINDS, ScenePageViews } from "./scenePageViews";
import { RetainedSpanDependencies } from "./retainedSpanDependencies";
import type { HeprPageData } from "./heprDocumentData";

type LayerId = string | null;
const key = (ref: PrimitiveRef): string => `${ref.kind}:${ref.index}`;

/** These scopes must retain their mask, alpha and backdrop as one editing unit. */
export function isEditorLayerCompositingUnit(group: ScenePaintGroup): boolean {
  return Boolean(group.softMask || group.knockout || group.alpha !== 1 || group.blendMode !== "Normal" || group.alphaIsShape);
}

/** Appends canonical expressions without changing any existing condition address. */
class Conditions {
  readonly values: OptionalContentCondition[];
  private readonly indices = new Map<string, number>();
  private readonly annotationGroups: Set<string>;
  private readonly dependencies = new Map<number, ReadonlySet<string>>();
  private readonly restrictions = new Map<string, number>();
  private readonly projections = new Map<number, number>();
  readonly catalog: SceneOptionalContent;
  constructor(catalog: SceneOptionalContent) {
    this.catalog = catalog;
    this.values = [...catalog.conditions];
    this.values.forEach((condition, index) => this.indices.set(JSON.stringify(condition), index));
    this.annotationGroups = new Set(catalog.groups.filter(group => group.annotationId !== undefined).map(group => group.id));
  }
  add(condition: OptionalContentCondition): number {
    const serialized = JSON.stringify(condition), existing = this.indices.get(serialized);
    if (existing !== undefined) return existing;
    const index = this.values.length; this.values.push(condition); this.indices.set(serialized, index); return index;
  }
  constant(value: boolean): number { return this.add({ kind: "constant", value }); }
  group(id: string): number {
    if (!this.catalog.groups.some(group => group.id === id && group.annotationId === undefined)) throw new RangeError(`Unknown PDF layer ${id}.`);
    return this.add({ kind: "group", groupId: id });
  }
  combine(kind: "and" | "or", input: readonly (number | undefined)[]): number | undefined {
    const operands: number[] = [];
    for (const index of input) {
      if (index === undefined) { if (kind === "or") return undefined; continue; }
      const condition = this.values[index];
      if (condition.kind === "constant") {
        if (condition.value !== (kind === "and")) return this.constant(condition.value);
      } else if (condition.kind === kind) operands.push(...condition.operands);
      else operands.push(index);
    }
    const unique = [...new Set(operands)].sort((a, b) => a - b), members = new Set(unique);
    if (unique.some(index => this.values[index].kind === "not" && members.has((this.values[index] as { kind: "not"; operand: number }).operand))) return this.constant(kind === "or");
    if (!unique.length) return kind === "and" ? undefined : this.constant(false);
    return unique.length === 1 ? unique[0] : this.add({ kind, operands: unique });
  }
  private restrict(index: number, id: string, value: boolean): number {
    const key = `${index}:${id}:${value}`, cached = this.restrictions.get(key); if (cached !== undefined) return cached;
    const condition = this.values[index]; let result = index;
    if (condition.kind === "group" && condition.groupId === id) result = this.constant(value);
    else if (condition.kind === "not") {
      const operand = this.restrict(condition.operand, id, value), expression = this.values[operand];
      result = expression.kind === "constant" ? this.constant(!expression.value) : this.add({ kind: "not", operand });
    } else if (condition.kind === "and" || condition.kind === "or") {
      result = this.combine(condition.kind, condition.operands.map(operand => this.restrict(operand, id, value))) ?? this.constant(true);
    }
    this.restrictions.set(key, result); return result;
  }
  replace(index: number | undefined, id: string, target: string | null): number | undefined {
    if (index === undefined) return undefined;
    if (target === null) return this.combine("or", [this.restrict(index, id, false), this.restrict(index, id, true)]);
    const visit = (current: number, cache = new Map<number, number>()): number => {
      const cached = cache.get(current); if (cached !== undefined) return cached;
      const expression = this.values[current]; let result = current;
      // An ordered removal may retarget through a layer removed by a later
      // operation. Its temporary variable is eliminated by that later step.
      if (expression.kind === "group" && expression.groupId === id) result = this.add({ kind: "group", groupId: target });
      else if (expression.kind === "not") result = this.add({ kind: "not", operand: visit(expression.operand, cache) });
      else if (expression.kind === "and" || expression.kind === "or") result = this.combine(expression.kind, expression.operands.map(operand => visit(operand, cache))) ?? this.constant(true);
      cache.set(current, result); return result;
    };
    return visit(index);
  }
  /** Existentially remove PDF memberships, retaining annotation ownership even under Not/Or. */
  project(index: number | undefined): number | undefined {
    if (index === undefined) return undefined;
    let result = this.projections.get(index);
    if (result === undefined) {
      result = index;
      for (const id of this.pdfDependencies(index)) result = this.combine("or", [this.restrict(result, id, false), this.restrict(result, id, true)]) ?? this.constant(true);
      this.projections.set(index, result);
    }
    return this.values[result].kind === "constant" && (this.values[result] as { kind: "constant"; value: boolean }).value ? undefined : result;
  }
  private pdfDependencies(index: number): ReadonlySet<string> {
    const cached = this.dependencies.get(index); if (cached) return cached;
    const condition = this.values[index], result = new Set<string>();
    if (condition.kind === "group" && !this.annotationGroups.has(condition.groupId)) result.add(condition.groupId);
    else if (condition.kind === "not") for (const id of this.pdfDependencies(condition.operand)) result.add(id);
    else if (condition.kind === "and" || condition.kind === "or") for (const operand of condition.operands) for (const id of this.pdfDependencies(operand)) result.add(id);
    this.dependencies.set(index, result); return result;
  }
  assign(condition: number | undefined, layerId: LayerId): number | undefined {
    return this.combine("and", [this.project(condition), layerId === null ? undefined : this.group(layerId)]);
  }
  data(): SceneOptionalContent { return { ...this.catalog, conditions: this.values }; }
}

function scope<T extends { optionalContent?: number }>(value: T, condition: number | undefined): T {
  const result = { ...value }; if (condition === undefined) delete result.optionalContent; else result.optionalContent = condition; return result;
}

interface ApplyOptions { signal?: AbortSignal; onDiagnostic?: (diagnostic: PdfDiagnostic) => void }
const compiledSources = new WeakMap<VectorScene, WeakMap<EditorLayerEdits, VectorScene>>();

/** Replace effective source memberships while retaining paint order and all compositing scopes. */
export async function applyEditorSceneLayers(source: VectorScene, edits: EditorLayerEdits, options: ApplyOptions = {}): Promise<VectorScene> {
  return refreshEditorSceneLayerDefaults(compileEditorSceneLayers(source, edits, options), options);
}

function compileEditorSceneLayers(source: VectorScene, edits: EditorLayerEdits, options: ApplyOptions = {}): VectorScene {
  options.signal?.throwIfAborted();
  let cached = compiledSources.get(source); if (!cached) { cached = new WeakMap(); compiledSources.set(source, cached); }
  const previous = cached.get(edits); if (previous) return previous;
  if (!edits.catalogChanged && !edits.objectOrderChanged && !edits.sourceAssignments.length && !edits.annotationAssignments.length && !edits.removals.length) return source;
  if (!edits.stackingChanged && !edits.objectOrderChanged && !edits.sourceAssignments.length && !edits.annotationAssignments.length && !edits.removals.length) {
    const result = { ...source, optionalContent: edits.catalog }, snapshot = createDefaultOptionalContentSnapshot(result);
    if (source.annotations) result.annotations = source.annotations.map(annotation => ({ ...annotation,
      visibleInDefaultView: (annotation.flags & (1 | 2 | 32)) === 0 && annotation.subtype !== "Popup" &&
        (annotation.optionalContent === undefined ? annotation.visibleInDefaultView : snapshot.conditions[annotation.optionalContent] !== 0) }));
    retainEditorAnnotationPlacements(source, result); cached.set(edits, result); return result;
  }
  const assignments = new Map(edits.sourceAssignments.map(assignment => [key(assignment.ref), assignment.layerId]));
  const annotations = new Map(edits.annotationAssignments.map(assignment => [assignment.id, assignment.layerId]));
  for (const [id, layerId] of annotations) for (const run of getSceneAnnotationRuns(source).get(id) ?? []) {
    for (let index = run.first; index < run.first + run.count; index++) assignments.set(key({ kind: run.kind, index }), layerId);
  }
  const builder = new Conditions(edits.catalog), originalRuns = source.drawRuns ?? defaultVectorDrawRuns(source);
  const originals = new Map<number, number>(), rewritten = new Map<number, number | undefined>();
  const original = (index: number | undefined): number | undefined => {
    if (index === undefined || index < 0) return undefined;
    const cached = originals.get(index); if (cached !== undefined) return cached;
    const condition = source.optionalContent?.conditions[index]; if (!condition) throw new RangeError("Unknown source layer condition.");
    const expression = condition.kind === "not" ? { ...condition, operand: original(condition.operand)! } :
      condition.kind === "and" || condition.kind === "or" ? { ...condition, operands: condition.operands.map(operand => original(operand)!) } : { ...condition };
    const result = builder.add(expression); originals.set(index, result); return result;
  };
  const rewrite = (index: number | undefined): number | undefined => {
    if (index === undefined) return undefined;
    if (rewritten.has(index)) return rewritten.get(index);
    let result: number | undefined = index;
    for (const removal of edits.removals) result = builder.replace(result, removal.id, removal.targetLayerId);
    rewritten.set(index, result); return result;
  };
  const runs: VectorDrawRun[] = [], runMap = new Map<number, number[]>(), effectiveText = new Map<number, number | undefined>();
  let retainedPages = source.retainedPages?.slice();
  const rasterAssignments: { index: number; layerId: LayerId }[] = [];
  const targets = (node: ScenePaintNode, found = new Set<LayerId>()): Set<LayerId> => {
    if (node.kind === "draw") {
      const run = originalRuns[node.runIndex];
      for (let index = run.first; index < run.first + run.count; index++) { const id = key({ kind: run.kind, index }); if (assignments.has(id)) found.add(assignments.get(id)!); }
    } else if (node.kind === "retained") { const id = `raster:${node.rasterIndex}`; if (assignments.has(id)) found.add(assignments.get(id)!); }
    else { node.children.forEach(child => targets(child, found)); node.softMask?.children.forEach(child => targets(child, found)); }
    return found;
  };
  const appendRun = (runIndex: number, inherited?: number, forced?: { layerId: LayerId }): number[] => {
    const run = originalRuns[runIndex], indices: number[] = [];
    let pending: VectorDrawRun | undefined;
    for (let index = run.first; index < run.first + run.count; index++) {
      const id = key({ kind: run.kind, index }), assigned = forced !== undefined || assignments.has(id), layerId = forced ? forced.layerId : assignments.get(id) ?? null;
      const effective = builder.combine("and", [inherited, original(run.optionalContent)]);
      const condition = assigned ? builder.assign(effective, layerId) : rewrite(effective);
      if (run.kind === "text") effectiveText.set(index, condition);
      if (run.kind === "raster" && assigned) rasterAssignments.push({ index, layerId });
      if (pending && pending.optionalContent === condition && pending.first + pending.count === index) pending.count++;
      else { pending = scope({ ...run, first: index, count: 1 }, condition); indices.push(runs.length); runs.push(pending); }
    }
    runMap.set(runIndex, indices); return indices;
  };
  const visit = (node: ScenePaintNode, inherited?: number, forced?: { layerId: LayerId }): ScenePaintNode[] => {
    options.signal?.throwIfAborted();
    const effective = builder.combine("and", [inherited, original(node.optionalContent)]);
    if (node.kind === "draw") return appendRun(node.runIndex, effective, forced).map(runIndex => ({ kind: "draw", runIndex }));
    if (node.kind === "retained") {
      const id = `raster:${node.rasterIndex}`, assigned = forced !== undefined || assignments.has(id), layerId = forced ? forced.layerId : assignments.get(id) ?? null;
      const rasterRun = originalRuns.findIndex(run => run.kind === "raster" && run.first === node.rasterIndex && run.count === 1);
      if (rasterRun < 0) throw new RangeError("Retained content has no singleton raster draw run.");
      const condition = builder.combine("and", [effective, original(originalRuns[rasterRun].optionalContent)]);
      const runIndex = runs.length; runs.push(scope({ ...originalRuns[rasterRun] }, undefined)); runMap.set(rasterRun, [runIndex]);
      let retainedPage = node.retainedPage;
      if (assigned || edits.removals.length) {
        const resource = retainedPages![retainedPage]; retainedPage = retainedPages!.length;
        retainedPages!.push({ ...resource, optionalContentConditions: Int32Array.from(resource.optionalContentConditions,
          condition => { const membership = builder.combine("and", [effective, original(condition)]);
            return (assigned ? builder.project(membership) : rewrite(membership)) ?? -1; }) });
        if (assigned) rasterAssignments.push({ index: node.rasterIndex, layerId });
      }
      return [scope({ ...node, retainedPage }, assigned ? builder.assign(condition, layerId) : rewrite(condition))];
    }
    const found = forced ? new Set([forced.layerId]) : targets(node);
    if (found.size && isEditorLayerCompositingUnit(node)) {
      if (found.size !== 1) throw new RangeError("An inseparable compositing group cannot belong to different replacement layers.");
      const target = { layerId: [...found][0] };
      if (!forced) options.onDiagnostic?.({ code: "editor.layer-compositing-unit", severity: "warning",
        message: "Layer assignment includes the complete compositing group, including its mask, to preserve its appearance." });
      return [scope({ ...node, children: node.children.flatMap(child => visit(child, undefined, target)),
        ...(node.softMask ? { softMask: { ...node.softMask, children: node.softMask.children.flatMap(child => visit(child, undefined, target)) } } : {}) }, builder.assign(effective, target.layerId))];
    }
    return [scope({ ...node, children: node.children.flatMap(child => visit(child, effective, forced)),
      ...(node.softMask ? { softMask: { ...node.softMask, children: node.softMask.children.flatMap(child => visit(child, effective, forced)) } } : {}) }, undefined)];
  };
  const roots = source.paintGraph?.roots.flatMap(node => visit(node));
  if (!source.paintGraph) originalRuns.forEach((_, index) => appendRun(index));
  let result: VectorScene = { ...source, optionalContent: builder.data(), drawRuns: runs,
    ...(roots ? { paintGraph: { roots } } : {}), ...(retainedPages ? { retainedPages } : {}) };
  if (source.annotations) result.annotations = source.annotations.map(annotation => {
    const condition = annotations.has(annotation.id) ? builder.assign(original(annotation.optionalContent), annotations.get(annotation.id)!) : rewrite(original(annotation.optionalContent));
    return scope({ ...annotation }, condition);
  });
  if (source.textIndex) result.textIndex = { ...source.textIndex, pages: source.textIndex.pages.map(page => ({ ...page,
    optionalContent: Int32Array.from(page.charInstance, (glyph, index) => {
      if (glyph >= 0 && effectiveText.has(glyph)) return effectiveText.get(glyph) ?? -1;
      const condition = page.optionalContent?.[index];
      if (glyph <= -2 && rasterAssignments.length) {
        const offset = (-glyph - 2) * 4, quad = page.fallbackQuads;
        const matches = rasterAssignments.filter(assignment => { const bounds = getScenePrimitiveBounds(source, { kind: "raster", index: assignment.index });
          return quad[offset] >= bounds.minX && quad[offset + 1] >= bounds.minY && quad[offset + 2] <= bounds.maxX && quad[offset + 3] <= bounds.maxY; });
        if (matches.length && matches.every(match => match.layerId === matches[0].layerId)) return builder.assign(original(condition), matches[0].layerId) ?? -1;
      }
      return rewrite(original(condition)) ?? -1;
    })
  })) };
  // Original expressions are temporary inputs to complete-scope forgetting.
  // They may contain removed ids; never retain those ids in the stored graph.
  const removed = new Set(edits.removedLayerIds);
  for (let index = edits.catalog.conditions.length; index < builder.values.length; index++) {
    const condition = builder.values[index];
    if (condition.kind === "group" && removed.has(condition.groupId)) builder.values[index] = { kind: "constant", value: true };
  }
  result.optionalContent = builder.data();
  result = compactAppendedConditions(result, edits.catalog.conditions.length);
  const snapshot = createDefaultOptionalContentSnapshot(result);
  if (result.annotations) result.annotations = result.annotations.map(annotation => ({ ...annotation,
    visibleInDefaultView: (annotation.flags & (1 | 2 | 32)) === 0 && annotation.subtype !== "Popup" &&
      (annotation.optionalContent === undefined ? annotation.visibleInDefaultView || annotations.has(annotation.id) : snapshot.conditions[annotation.optionalContent] !== 0) }));
  retainEditorAnnotationPlacements(source, result); validateSceneOptionalContentReferences(result); cached.set(edits, result); return result;
}

export interface EditorLayerHitAddition {
  id: string;
  pageIndex: number;
  layerIds: readonly string[];
  layerCondition?: number;
  /** Preserved source clones can contain several distinct paint memberships. */
  sourcePrimitives?: readonly PrimitiveRef[];
  sourceLayerEdits?: EditorLayerEdits;
}

/** Capture the PDF annotation's exact membership independently from its appearance owner. */
export function captureEditorAnnotationLayerCondition(source: VectorScene, edits: EditorLayerEdits, id: string): {
  catalog: SceneOptionalContent;
  condition?: number;
} {
  const scene = compileEditorSceneLayers(source, edits), annotation = scene.annotations?.find(annotation => annotation.id === id);
  if (!annotation) throw new RangeError(`Unknown source annotation ${id}.`);
  const builder = new Conditions(scene.optionalContent ?? edits.catalog);
  let condition = annotation.optionalContent;
  for (const group of builder.catalog.groups) if (group.annotationId !== undefined) condition = builder.replace(condition, group.id, null);
  return { catalog: builder.data(), ...(condition === undefined ? {} : { condition }) };
}

/** A source object's hotspot is eligible when any of its painted members is visible. */
export function captureEditorPrimitiveLayerCondition(source: VectorScene, edits: EditorLayerEdits, refs: readonly PrimitiveRef[]): {
  catalog: SceneOptionalContent;
  condition?: number;
} {
  const scene = compileEditorSceneLayers(source, edits), builder = new Conditions(scene.optionalContent ?? edits.catalog);
  const members: (number | undefined)[] = [];
  for (const ref of refs) {
    const conditions = getPrimitiveVisibilityConditions(scene, ref);
    if (conditions) members.push(builder.combine("and", conditions));
  }
  let condition = builder.combine("or", members);
  for (const group of builder.catalog.groups) if (group.annotationId !== undefined) condition = builder.replace(condition, group.id, null);
  return { catalog: builder.data(), ...(condition === undefined ? {} : { condition }) };
}

/** Merge independent membership tables without changing existing condition addresses. */
export function combineEditorLayerConditions(catalog: SceneOptionalContent, members: readonly { catalog: SceneOptionalContent; condition?: number }[]): {
  catalog: SceneOptionalContent;
  condition?: number;
} {
  const operands: number[] = [];
  for (const member of members) {
    if (member.condition === undefined) return { catalog };
    const imported = importEditorLayerCondition(catalog, member.catalog, member.condition);
    catalog = imported.catalog; if (imported.condition === undefined) return { catalog };
    operands.push(imported.condition);
  }
  const builder = new Conditions(catalog), condition = builder.combine("or", operands);
  return { catalog: builder.data(), ...(condition === undefined ? {} : { condition }) };
}

/** Synchronous eligibility for editor picking; it never replays raster resources. */
export function createEditorLayerVisibility(source: VectorScene, edits: EditorLayerEdits, additions: readonly EditorLayerHitAddition[] = [], excluded?: ReadonlySet<string>,
  provideObjectOrder?: () => ReturnType<typeof createEditorObjectOrderSchedule>): {
  isPrimitiveVisible(ref: PrimitiveRef): boolean;
  isAnnotationVisible(id: string): boolean;
  getPrimitivePaintRank(ref: PrimitiveRef): number;
  getObjectPaintRank(id: string): number;
  getObjectOrder(): ReturnType<typeof createEditorObjectOrderSchedule>;
} {
  const scene = compileEditorSceneLayers(source, edits), snapshot = createDefaultOptionalContentSnapshot(scene);
  let legacyRanks: { ranks: Map<string, number>; objectRanks: Map<string, number> } | undefined;
  const legacy = () => {
    if (legacyRanks) return legacyRanks;
    const ranks = new Map<string, number>(), objectRanks = new Map<string, number>(), catalog = scene.optionalContent, layerOrder = catalog ? layerRanks(catalog) : new Map<string, number>();
    const partition = new ScenePageViews(scene);
    type Unit = { node?: ScenePaintNode; scene?: VectorScene; objectId?: string; rank: number | null };
    const pages: Unit[][] = Array.from({ length: partition.pageCount }, () => []);
    for (const node of editorPaintUnits(scene, edits.stackingChanged)) {
      const first = nodePrimitiveRefs(scene, node)[0], page = first ? partition.owners[first.kind][first.index] : 0;
      pages[page].push({ node, scene, rank: editorPaintNodeRank(scene, node) });
    }
    for (const addition of additions) {
      if (addition.sourcePrimitives?.length && addition.sourceLayerEdits) {
        const compiledClone = compileEditorSceneLayers(source, addition.sourceLayerEdits);
        const cloneSource = addition.sourceLayerEdits.objectOrderChanged ? applyEditorObjectOrdering(compiledClone,
          createEditorObjectOrderSchedule(source, addition.sourceLayerEdits, [])) : compiledClone;
        const keep = Object.fromEntries(PAGE_PRIMITIVE_KINDS.map(kind => [kind, new Set<number>()])) as Record<PrimitiveRef["kind"], Set<number>>;
        addition.sourcePrimitives.forEach(ref => keep[ref.kind].add(ref.index));
        const cloneScene = compactEditorScene(cloneSource, keep);
        for (const node of editorPaintUnits(cloneScene, edits.stackingChanged)) {
          pages[addition.pageIndex].push({ objectId: addition.id, rank: editorPaintNodeRank(cloneScene, node) });
        }
      } else {
        const rank = addition.layerIds.reduce((value, id) => Math.min(value, layerOrder.get(id) ?? Infinity), Infinity);
        pages[addition.pageIndex].push({ objectId: addition.id, rank: addition.layerCondition === undefined ? rank === Infinity ? null : rank : editorLayerPaintRank(catalog, addition.layerCondition) });
      }
    }
    let nextRank = 0;
    const appearances = getSceneAnnotationRuns(scene);
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex];
      for (const unit of edits.stackingChanged ? stableLayerSlots(page, unit => unit.rank) : page) {
        if (unit.objectId) objectRanks.set(unit.objectId, nextRank++);
        else if (unit.node && unit.scene) for (const ref of nodePrimitiveRefs(unit.scene, unit.node)) ranks.set(key(ref), nextRank++);
      }
      // Blank widgets have controls but no canonical paint slot. Keep those
      // interaction targets in the annotation plane without inventing paint slots
      // that would change the fixed-unlayered ordering of visible content.
      const metadata = scene.annotations?.filter(annotation => annotation.pageIndex === pageIndex && !appearances.get(annotation.id)?.length) ?? [];
      for (const annotation of edits.stackingChanged ? stableLayerSlots(metadata, annotation => editorLayerPaintRank(catalog, annotation.optionalContent)) : metadata) objectRanks.set(`annotation:${annotation.id}`, nextRank++);
    }
    return legacyRanks = { ranks, objectRanks };
  };
  const visible = (condition?: number): boolean => condition === undefined || snapshot.conditions[condition] !== 0;
  let objectOrder: ReturnType<typeof createEditorObjectOrderSchedule> | undefined;
  const order = () => provideObjectOrder ? provideObjectOrder() : objectOrder ??= createEditorObjectOrderSchedule(source, edits, additions, excluded);
  return { isPrimitiveVisible: ref => isScenePrimitiveVisible(scene, ref, visible),
    getPrimitivePaintRank: ref => edits.objectOrderChanged ? order().primitiveRanks.get(key(ref)) ?? -1 : legacy().ranks.get(key(ref)) ?? -1,
    getObjectPaintRank: id => edits.objectOrderChanged ? order().objectRanks.get(id) ?? -1 : legacy().objectRanks.get(id) ?? -1,
    getObjectOrder: order,
    isAnnotationVisible: id => { const annotation = scene.annotations?.find(annotation => annotation.id === id);
      return Boolean(annotation?.visibleInDefaultView && visible(annotation.optionalContent)); } };
}

/** Full virtual slots keep source-only PDF projections consistent with authored objects. */
export function createEditorObjectOrderSchedule(source: VectorScene, edits: EditorLayerEdits, additions: readonly EditorLayerHitAddition[], excluded?: ReadonlySet<string>): {
  primitiveRanks: ReadonlyMap<string, number>;
  objectRanks: ReadonlyMap<string, number>;
  tokenRanks: ReadonlyMap<string, number>;
  order: readonly string[];
  arrange(selected: ReadonlySet<string>, action: EditorStackingAction): { changed: boolean; order: string[] };
} {
  const scene = compileEditorSceneLayers(source, edits.objectOrderChanged ? edits : { ...edits, objectOrderChanged: true }), catalog = scene.optionalContent ?? edits.catalog;
  const layers = layerRanks(catalog), byRank = new Map([...layers].map(([id, rank]) => [rank, id]));
  const layer = (target: VectorScene, node: ScenePaintNode): string | null => {
    const rank = editorPaintNodeRank(target, node); return rank === null ? null : byRank.get(rank) ?? null;
  };
  const sourceGeometry = editorOrderGeometry(scene, { layer: node => layer(scene, node), atomic: node => node.kind === "group" && isEditorLayerCompositingUnit(node), excluded });
  const units = [...sourceGeometry.units];
  for (const addition of additions) {
    if (addition.sourcePrimitives?.length && addition.sourceLayerEdits) {
      const compiledClone = compileEditorSceneLayers(source, addition.sourceLayerEdits);
      const cloneSource = addition.sourceLayerEdits.objectOrderChanged ? applyEditorObjectOrdering(compiledClone,
        createEditorObjectOrderSchedule(source, addition.sourceLayerEdits, [])) : compiledClone;
      const keep = Object.fromEntries(PAGE_PRIMITIVE_KINDS.map(kind => [kind, new Set<number>()])) as Record<PrimitiveRef["kind"], Set<number>>;
      addition.sourcePrimitives.forEach(ref => keep[ref.kind].add(ref.index));
      const cloned = compactEditorScene(cloneSource, keep), identity = editorPaintIdentity(cloned);
      setEditorPaintIdentity(cloned, ref => editorCloneOwner(addition.id, identity(ref)));
      const geometry = editorOrderGeometry(cloned, { layer: node => layer(cloned, node), atomic: node => node.kind === "group" && isEditorLayerCompositingUnit(node), objectId: addition.id, page: addition.pageIndex });
      for (const unit of geometry.units) units.push(unit);
    } else {
      const rank = addition.layerCondition === undefined ? addition.layerIds.reduce((value, id) => Math.min(value, layers.get(id) ?? Infinity), Infinity) : editorLayerPaintRank(catalog, addition.layerCondition);
      const owner = rank === null || rank === Infinity ? null : byRank.get(rank) ?? null;
      units.push({ owners: [addition.id], tokens: [editorOrderToken(editorAuthoredOwner(addition.id), owner)], page: addition.pageIndex, layer: owner, plane: "paint", atomic: true, objectId: addition.id });
    }
  }
  // A page's source paints precede its authored additions before any editing.
  units.sort((a, b) => a.page - b.page);
  const ordered = applyEditorOrderTokens(units, edits.objectOrder, edits.stackingChanged ? layers : undefined);
  const appearances = getSceneAnnotationRuns(scene);
  const metadata: EditorOrderUnit[] = (scene.annotations ?? []).filter(annotation => !excluded?.has(`annotation:${annotation.id}`) && !appearances.get(annotation.id)?.length && annotation.subtype !== "Popup").map(annotation => {
    const rank = editorLayerPaintRank(catalog, annotation.optionalContent), layer = rank === null ? null : byRank.get(rank) ?? null, owner = `annotation:${annotation.id}`;
    return { owners: [owner], tokens: [editorOrderToken(owner, layer)], page: annotation.pageIndex, layer, plane: "metadata", atomic: true, objectId: owner };
  });
  const metadataOrdered = applyEditorOrderTokens(metadata, edits.objectOrder, edits.stackingChanged ? layers : undefined);
  const primitiveRanks = new Map<string, number>(), objectRanks = new Map<string, number>(), tokenRanks = new Map<string, number>();
  let next = 0;
  const assign = (input: readonly EditorOrderUnit[]): void => { for (const unit of input) {
    if (unit.children) assign(unit.children);
    else {
      const rank = next++;
      unit.tokens.forEach(token => tokenRanks.set(token, rank));
      unit.refs?.forEach(ref => { if (!unit.objectId) primitiveRanks.set(key(ref), rank); });
      unit.owners.forEach(owner => objectRanks.set(owner, Math.max(objectRanks.get(owner) ?? -1, rank)));
      if (unit.objectId) objectRanks.set(unit.objectId, Math.max(objectRanks.get(unit.objectId) ?? -1, rank));
    }
  } };
  assign(ordered); assign(metadataOrdered);
  return { primitiveRanks, objectRanks, tokenRanks, order: [...editorOrderTokens(ordered), ...editorOrderTokens(metadataOrdered)],
    arrange(selected, action) {
      const paints = arrangeEditorOrder(ordered, selected, action), controls = arrangeEditorOrder(metadataOrdered, selected, action);
      return { changed: paints.changed || controls.changed, order: [...editorOrderTokens(paints.units), ...editorOrderTokens(controls.units)] };
    } };
}

export function applyEditorObjectOrdering(scene: VectorScene, schedule: ReturnType<typeof createEditorObjectOrderSchedule>): VectorScene {
  const catalog = scene.optionalContent, ranks = catalog ? layerRanks(catalog) : new Map<string, number>(), byRank = new Map([...ranks].map(([id, rank]) => [rank, id]));
  const geometry = editorOrderGeometry(scene, { layer(node) { const rank = editorPaintNodeRank(scene, node); return rank === null ? null : byRank.get(rank) ?? null; }, atomic: node => node.kind === "group" && isEditorLayerCompositingUnit(node) });
  const result = projectEditorOrder(geometry.scene, geometry.units, schedule.tokenRanks);
  if (scene.annotations) {
    const ordered = scene.annotations.map((annotation, index) => ({ annotation, index, rank: schedule.objectRanks.get(`annotation:${annotation.id}`) ?? -1 }))
      .filter(item => item.rank >= 0).sort((a, b) => a.rank - b.rank || a.index - b.index);
    let next = 0; result.annotations = scene.annotations.map(annotation => (schedule.objectRanks.get(`annotation:${annotation.id}`) ?? -1) < 0 ? annotation : ordered[next++].annotation);
  }
  retainEditorAnnotationPlacements(scene, result); retainEditorPaintIdentity(scene, result); return result;
}

/** A duplicate is independent from the original annotation's visibility controls. */
export function detachEditorGeometryAnnotationLayers(scene: VectorScene): VectorScene {
  const data = scene.optionalContent, ids = data?.groups.filter(group => group.annotationId !== undefined).map(group => group.id) ?? [];
  if (!data || !ids.length) return scene;
  const builder = new Conditions(data), map = new Map<number, number | undefined>();
  for (let index = 0; index < data.conditions.length; index++) {
    let condition: number | undefined = index; for (const id of ids) condition = builder.replace(condition, id, null); map.set(index, condition);
  }
  const remap = (index?: number): number | undefined => index === undefined || index < 0 ? undefined : map.get(index);
  const nodes = (input: readonly ScenePaintNode[]): ScenePaintNode[] => input.map(node => scope(node.kind === "group" ? { ...node, children: nodes(node.children),
    ...(node.softMask ? { softMask: { ...node.softMask, children: nodes(node.softMask.children) } } : {}) } : { ...node }, remap(node.optionalContent)));
  for (let index = 0; index < builder.values.length; index++) {
    const condition = builder.values[index]; if (condition.kind === "group" && ids.includes(condition.groupId)) builder.values[index] = { kind: "constant", value: true };
  }
  const result: VectorScene = { ...scene, optionalContent: { ...builder.data(), groups: data.groups.filter(group => group.annotationId === undefined) },
    drawRuns: scene.drawRuns?.map(run => scope({ ...run }, remap(run.optionalContent))) };
  if (scene.paintGraph) result.paintGraph = { roots: nodes(scene.paintGraph.roots) };
  if (scene.annotations) result.annotations = scene.annotations.map(annotation => scope({ ...annotation }, remap(annotation.optionalContent)));
  if (scene.textIndex) result.textIndex = { ...scene.textIndex, pages: scene.textIndex.pages.map(page => ({ ...page,
    ...(page.optionalContent ? { optionalContent: Int32Array.from(page.optionalContent, index => remap(index) ?? -1) } : {}) })) };
  if (scene.retainedPages) result.retainedPages = scene.retainedPages.map(resource => ({ ...resource,
    optionalContentConditions: Int32Array.from(resource.optionalContentConditions, index => remap(index) ?? -1) }));
  retainEditorAnnotationPlacements(scene, result); return result;
}

/** Keep source addresses stable, dropping temporary Boolean work beyond that prefix. */
function compactAppendedConditions(scene: VectorScene, prefix: number): VectorScene {
  const data = scene.optionalContent!, needed = new Set<number>();
  const collect = (index: number | undefined): void => {
    if (index === undefined || index < 0 || needed.has(index)) return;
    needed.add(index); const condition = data.conditions[index];
    if (condition.kind === "not") collect(condition.operand);
    else if (condition.kind === "and" || condition.kind === "or") condition.operands.forEach(collect);
  };
  const walk = (nodes: readonly ScenePaintNode[]): void => { for (const node of nodes) {
    collect(node.optionalContent); if (node.kind === "group") { walk(node.children); if (node.softMask) walk(node.softMask.children); }
  } };
  for (let index = 0; index < prefix; index++) collect(index);
  scene.drawRuns?.forEach(run => collect(run.optionalContent)); walk(scene.paintGraph?.roots ?? []);
  scene.annotations?.forEach(annotation => collect(annotation.optionalContent));
  scene.textIndex?.pages.forEach(page => page.optionalContent?.forEach(collect));
  scene.retainedPages?.forEach(resource => resource.optionalContentConditions.forEach(collect));
  const ids = [...needed].sort((a, b) => a - b), map = new Map(ids.map((id, index) => [id, index]));
  if (ids.length === data.conditions.length) return scene;
  const remap = (index: number | undefined): number | undefined => index === undefined ? undefined : map.get(index)!;
  const nodes = (input: readonly ScenePaintNode[]): ScenePaintNode[] => input.map(node => scope(node.kind === "group" ? { ...node, children: nodes(node.children),
    ...(node.softMask ? { softMask: { ...node.softMask, children: nodes(node.softMask.children) } } : {}) } : { ...node }, remap(node.optionalContent)));
  const result: VectorScene = { ...scene, optionalContent: { ...data, conditions: ids.map(index => {
    const condition = data.conditions[index]; return condition.kind === "not" ? { ...condition, operand: remap(condition.operand)! } :
      condition.kind === "and" || condition.kind === "or" ? { ...condition, operands: condition.operands.map(operand => remap(operand)!) } : condition;
  }) }, drawRuns: scene.drawRuns?.map(run => scope({ ...run }, remap(run.optionalContent))) };
  if (scene.paintGraph) result.paintGraph = { roots: nodes(scene.paintGraph.roots) };
  if (scene.annotations) result.annotations = scene.annotations.map(annotation => scope({ ...annotation }, remap(annotation.optionalContent)));
  if (scene.textIndex) result.textIndex = { ...scene.textIndex, pages: scene.textIndex.pages.map(page => ({ ...page,
    ...(page.optionalContent ? { optionalContent: Int32Array.from(page.optionalContent, index => index < 0 ? -1 : remap(index)!) } : {}) })) };
  if (scene.retainedPages) result.retainedPages = scene.retainedPages.map(resource => ({ ...resource,
    optionalContentConditions: Int32Array.from(resource.optionalContentConditions, index => index < 0 ? -1 : remap(index)!) }));
  retainEditorAnnotationPlacements(scene, result); return result;
}

const paintRanks = new WeakMap<SceneOptionalContent, Map<string, number>>();
function layerRanks(catalog: SceneOptionalContent): Map<string, number> {
  let ranks = paintRanks.get(catalog); if (ranks) return ranks;
  ranks = new Map(); const valid = new Set(catalog.groups.filter(group => group.annotationId === undefined).map(group => group.id));
  const visit = (nodes: SceneOptionalContent["order"]): void => { for (const node of nodes) {
    if (node.kind === "group" && valid.has(node.groupId) && !ranks!.has(node.groupId)) ranks!.set(node.groupId, ranks!.size);
    if (node.children) visit(node.children);
  } };
  visit(catalog.order); for (const id of valid) if (!ranks.has(id)) ranks.set(id, ranks.size);
  paintRanks.set(catalog, ranks); return ranks;
}

/** Zero is frontmost. A compound membership follows its frontmost real PDF layer. */
export function editorLayerPaintRank(catalog: SceneOptionalContent | undefined, condition?: number): number | null {
  if (!catalog || condition === undefined) return null;
  const ranks = layerRanks(catalog), seen = new Set<number>(), pending = [condition]; let rank = Infinity;
  while (pending.length) {
    const index = pending.pop()!; if (seen.has(index)) continue; seen.add(index);
    const expression = catalog.conditions[index];
    if (expression?.kind === "group") rank = Math.min(rank, ranks.get(expression.groupId) ?? Infinity);
    else if (expression?.kind === "not") pending.push(expression.operand);
    else if (expression?.kind === "and" || expression?.kind === "or") pending.push(...expression.operands);
  }
  return rank === Infinity ? null : rank;
}

function nodePrimitiveRefs(scene: VectorScene, node: ScenePaintNode): PrimitiveRef[] {
  if (node.kind === "retained") return [{ kind: "raster", index: node.rasterIndex }];
  if (node.kind === "draw") {
    const run = (scene.drawRuns ?? defaultVectorDrawRuns(scene))[node.runIndex];
    return Array.from({ length: run.count }, (_, index) => ({ kind: run.kind, index: run.first + index }));
  }
  return [...(node.softMask?.children.flatMap(child => nodePrimitiveRefs(scene, child)) ?? []), ...node.children.flatMap(child => nodePrimitiveRefs(scene, child))];
}

const retainedDependencies = new WeakMap<HeprPageData, RetainedSpanDependencies>();
function editorPaintNodeRank(scene: VectorScene, node: ScenePaintNode): number | null {
  const catalog = scene.optionalContent, runs = scene.drawRuns ?? defaultVectorDrawRuns(scene);
  let value = editorLayerPaintRank(catalog, node.optionalContent);
  const include = (candidate: number | null): void => { if (candidate !== null) value = value === null ? candidate : Math.min(value, candidate); };
  if (node.kind === "draw") include(editorLayerPaintRank(catalog, runs[node.runIndex].optionalContent));
  else if (node.kind === "retained") {
    include(editorLayerPaintRank(catalog, runs.find(run => run.kind === "raster" && run.first === node.rasterIndex)?.optionalContent));
    const resource = scene.retainedPages?.[node.retainedPage];
    if (resource) {
      let dependencies = retainedDependencies.get(resource.page);
      if (!dependencies) { dependencies = new RetainedSpanDependencies(resource.page); retainedDependencies.set(resource.page, dependencies); }
      for (const member of dependencies.span(node.firstCommand, node.count)) {
        const condition = resource.optionalContentConditions[member]; if (condition >= 0) include(editorLayerPaintRank(catalog, condition));
      }
    }
  } else node.children.forEach(child => include(editorPaintNodeRank(scene, child)));
  return value;
}

function stableLayerSlots<T>(values: readonly T[], getRank: (value: T) => number | null): T[] {
  const sorted = values.flatMap((value, index) => { const rank = getRank(value); return rank === null ? [] : [{ value, rank, index }]; })
    .sort((a, b) => b.rank - a.rank || a.index - b.index);
  let next = 0; return values.map(value => getRank(value) === null ? value : sorted[next++].value);
}

/** Flatten only scopes whose isolation cannot change the color of a descendant. */
function editorPaintUnits(scene: VectorScene, restackContainers = false): ScenePaintNode[] {
  const runs = scene.drawRuns ?? defaultVectorDrawRuns(scene);
  const sourceOverOnly = (nodes: readonly ScenePaintNode[]): boolean => nodes.every(node => node.kind === "draw" ? !runs[node.runIndex].blendMode :
    node.kind === "retained" ? false : !isEditorLayerCompositingUnit(node) && sourceOverOnly(node.children));
  const visit = (nodes: readonly ScenePaintNode[]): ScenePaintNode[] => nodes.flatMap(node => {
    if (node.kind !== "group") return [node];
    if (!isEditorLayerCompositingUnit(node) && node.optionalContent === undefined && (!node.isolated || sourceOverOnly(node.children))) return visit(node.children);
    const children = visit(node.children);
    return [{ ...node, children: restackContainers && !isEditorLayerCompositingUnit(node)
      ? stableLayerSlots(children, child => editorPaintNodeRank(scene, child)) : children,
    ...(node.softMask ? { softMask: { ...node.softMask, children: node.softMask.children.slice() } } : {}) }];
  });
  return visit(scene.paintGraph?.roots ?? runs.map((_, runIndex) => ({ kind: "draw", runIndex })));
}

/** Stable sorting changes only layer-owned paint slots; unlayered page content stays in place. */
export function reorderEditorSceneLayers(scene: VectorScene, edits: Pick<EditorLayerEdits, "stackingChanged">): VectorScene {
  if (!edits.stackingChanged || !scene.optionalContent) return scene;
  const catalog = scene.optionalContent, original = scene.drawRuns ?? defaultVectorDrawRuns(scene);
  const units = editorPaintUnits(scene, true), partition = new ScenePageViews(scene), pages = new Map<number, ScenePaintNode[]>();
  const pageOf = (node: ScenePaintNode): number => { const ref = nodePrimitiveRefs(scene, node)[0]; return ref ? partition.owners[ref.kind][ref.index] : 0; };
  for (const node of units) { const page = pageOf(node), nodes = pages.get(page) ?? []; nodes.push(node); pages.set(page, nodes); }
  const sorted = new Map([...pages].map(([page, nodes]) => [page, stableLayerSlots(nodes, node => editorPaintNodeRank(scene, node))]));
  const cursors = new Map<number, number>();
  const roots = units.map(node => { const page = pageOf(node), next = cursors.get(page) ?? 0; cursors.set(page, next + 1); return sorted.get(page)![next]; });
  const runs: VectorDrawRun[] = [];
  const reindex = (nodes: readonly ScenePaintNode[]): ScenePaintNode[] => nodes.map(node => {
    if (node.kind === "draw") { const runIndex = runs.length; runs.push(original[node.runIndex]); return { ...node, runIndex }; }
    if (node.kind === "retained") {
      const run = original.find(run => run.kind === "raster" && run.first === node.rasterIndex && run.count === 1);
      if (!run) throw new RangeError("Retained content has no singleton raster draw run."); runs.push(run); return { ...node };
    }
    return { ...node, ...(node.softMask ? { softMask: { ...node.softMask, children: reindex(node.softMask.children) } } : {}), children: reindex(node.children) };
  });
  const result: VectorScene = { ...scene, paintGraph: { roots: reindex(roots) }, drawRuns: runs,
    annotations: scene.annotations ? scene.annotations.map(annotation => annotation) : undefined };
  if (result.annotations) for (let page = 0; page < scene.pageCount; page++) {
    const sorted: NonNullable<VectorScene["annotations"]> = stableLayerSlots(result.annotations.filter(annotation => annotation.pageIndex === page), (annotation): number | null => editorLayerPaintRank(catalog, annotation.optionalContent));
    let next = 0; result.annotations = result.annotations.map(annotation => annotation.pageIndex === page ? sorted[next++] : annotation);
  }
  retainEditorAnnotationPlacements(scene, result); return result;
}

/** Layer an authored object (or explicitly reassigned clone) as one independent appearance. */
export function assignEditorGeometryLayer(geometry: VectorScene, catalog: SceneOptionalContent, layerId: string | null | undefined, layerCondition?: number): VectorScene {
  if (layerId === undefined && layerCondition === undefined) return geometry;
  if (layerCondition !== undefined && (!Number.isSafeInteger(layerCondition) || layerCondition < 0 || layerCondition >= catalog.conditions.length)) throw new RangeError("Unknown object layer condition.");
  const local = geometry.optionalContent;
  if (!local && layerId === null && layerCondition === undefined) return geometry;
  const layer = typeof layerId === "string" ? catalog.groups.find(group => group.id === layerId && group.annotationId === undefined) : undefined;
  if (typeof layerId === "string" && !layer) throw new RangeError(`Unknown PDF layer ${layerId}.`);
  // Ordinary new objects need one membership, rather than a copy of every
  // source condition for every textbox, image or stroke.
  const internal = new Set(catalog.groups.filter(group => group.annotationId !== undefined).map(group => group.id));
  const sharesSourceTable = local && catalog.conditions.every((condition, index) => JSON.stringify(condition) === JSON.stringify(local.conditions[index]) ||
    condition.kind === "group" && internal.has(condition.groupId) && local.conditions[index]?.kind === "constant" && (local.conditions[index] as { value: boolean }).value);
  const offset = local && !sharesSourceTable ? catalog.conditions.length : 0;
  const data: SceneOptionalContent = !local ? layerCondition !== undefined ? catalog : { groups: [layer!], conditions: [], order: [{ kind: "group", groupId: layer!.id }], radioGroups: [] } :
    { ...catalog, groups: [...catalog.groups, ...local.groups.filter(group => !catalog.groups.some(candidate => candidate.id === group.id))],
      conditions: sharesSourceTable ? [...catalog.conditions, ...local.conditions.slice(catalog.conditions.length)] : [...catalog.conditions, ...local.conditions.map(condition =>
        condition.kind === "not" ? { ...condition, operand: condition.operand + offset } : condition.kind === "and" || condition.kind === "or" ? { ...condition, operands: condition.operands.map(operand => operand + offset) } : condition)] };
  const condition = (index: number | undefined): number | undefined => index === undefined || index < 0 ? undefined : index + offset;
  const builder = new Conditions(data), runs = geometry.drawRuns ?? defaultVectorDrawRuns(geometry);
  const assign = (condition: number | undefined): number | undefined => layerCondition === undefined ? builder.assign(condition, layerId ?? null) : builder.combine("and", [builder.project(condition), layerCondition]);
  const result: VectorScene = { ...geometry, drawRuns: runs.map(run => scope({ ...run }, assign(condition(run.optionalContent)))) };
  const visit = (node: ScenePaintNode): ScenePaintNode => scope(node.kind === "group" ? { ...node, children: node.children.map(visit),
    ...(node.softMask ? { softMask: { ...node.softMask, children: node.softMask.children.map(visit) } } : {}) } : { ...node }, assign(condition(node.optionalContent)));
  if (geometry.paintGraph) result.paintGraph = { roots: geometry.paintGraph.roots.map(visit) };
  if (geometry.textIndex) result.textIndex = { ...geometry.textIndex, pages: geometry.textIndex.pages.map(page => ({ ...page,
    optionalContent: Int32Array.from(page.charInstance, (_, index) => assign(condition(page.optionalContent?.[index])) ?? -1) })) };
  if (geometry.annotations) result.annotations = geometry.annotations.map(annotation => scope({ ...annotation }, assign(condition(annotation.optionalContent))));
  if (geometry.retainedPages) result.retainedPages = geometry.retainedPages.map(resource => ({ ...resource,
    optionalContentConditions: Int32Array.from(resource.optionalContentConditions, index => index < 0 ? -1 : builder.project(condition(index)) ?? -1) }));
  result.optionalContent = builder.data(); retainEditorAnnotationPlacements(geometry, result); return result;
}

/** Raster islands and their retained defaults must describe the same compiled revision. */
export async function refreshEditorSceneLayerDefaults(scene: VectorScene, options: ApplyOptions = {}): Promise<VectorScene> {
  if (!scene.retainedPages?.length) return scene;
  const snapshot = createDefaultOptionalContentSnapshot(scene), changed = new Set<number>();
  const retainedPages = scene.retainedPages.map((resource, index) => {
    const page = applyRetainedPageVisibility(resource, snapshot), before = resource.page.stores.optionalContent.defaultVisible, after = page.stores.optionalContent.defaultVisible;
    if (after.every((value, index) => value === before[index])) return resource;
    changed.add(index); return { ...resource, page };
  });
  if (!changed.size) return scene;
  const rasterLayers = scene.rasterLayers.slice(), signal = options.signal ?? new AbortController().signal;
  const { renderNativeRetainedCommandSpan } = await import("./retainedPageCompositor");
  const visit = async (nodes: readonly ScenePaintNode[]): Promise<void> => {
    for (const node of nodes) {
      signal.throwIfAborted();
      if (node.kind === "group") { await visit(node.children); if (node.softMask) await visit(node.softMask.children); }
      else if (node.kind === "retained" && changed.has(node.retainedPage)) {
        const resource = retainedPages[node.retainedPage], original = rasterLayers[node.rasterIndex];
        const rendered = await renderNativeRetainedCommandSpan(resource.page, node.firstCommand, node.count, signal, undefined, options.onDiagnostic);
        if (!rendered) rasterLayers[node.rasterIndex] = { ...original, monochrome: undefined, width: 1, height: 1, data: new Uint8Array(4) };
        else {
          const a = resource.matrix, b = rendered.matrix, matrix = Float32Array.of(a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
            a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]);
          rasterLayers[node.rasterIndex] = { ...rendered, matrix, paintOrder: original.paintOrder, pageIndex: original.pageIndex };
        }
      }
    }
  };
  await visit(scene.paintGraph?.roots ?? []);
  const primary = rasterLayers[0], result = { ...scene, retainedPages, rasterLayers,
    rasterLayerWidth: primary?.width ?? 0, rasterLayerHeight: primary?.height ?? 0, rasterLayerData: primary?.data ?? new Uint8Array(),
    rasterLayerMatrix: primary?.matrix ?? Float32Array.of(1, 0, 0, 1, 0, 0) };
  retainEditorAnnotationPlacements(scene, result); return result;
}
