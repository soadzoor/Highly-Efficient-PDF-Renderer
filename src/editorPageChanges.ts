import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import type { EditorAnnotationEdit, EditorFieldValue, EditorLayerEdits, EditorObject, EditorSession, EditorSourceEdit } from "./editorTypes";
import { getScenePrimitiveBounds, type PrimitiveRef } from "./scenePrimitives";
import { editorTransformBounds, EDITOR_IDENTITY } from "./editorScene";
import { PAGE_PRIMITIVE_KINDS, PAGE_PRIMITIVE_RANGE_STRIDE, ScenePageViews, scenePrimitiveCounts } from "./scenePageViews";
import { editorPaintIdentity, editorPaintOwnerObject } from "./editorPaintIdentity";

/** Private immutable model references; capturing never copies source geometry or image pixels. */
export interface EditorPageChangesSnapshot {
  readonly sourceScene: VectorScene;
  readonly objects: ReadonlyMap<string, EditorObject>;
  readonly sourceEdits: ReadonlyMap<string, EditorSourceEdit>;
  readonly annotationEdits: ReadonlyMap<string, EditorAnnotationEdit>;
  readonly fields: ReadonlyMap<string, EditorFieldValue>;
  readonly layers: EditorLayerEdits;
  /** Resolved back-to-front tokens, evaluated only when explicit stacking changes. */
  readonly getObjectOrder: () => readonly string[];
}

const readers = new WeakMap<EditorSession, () => EditorPageChangesSnapshot | undefined>();
export function registerEditorPageChangesReader(session: EditorSession, read: () => EditorPageChangesSnapshot | undefined): void {
  readers.set(session, read);
}
export function captureEditorPageChanges(session: EditorSession): EditorPageChangesSnapshot | undefined {
  return readers.get(session)?.();
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (ArrayBuffer.isView(left) || ArrayBuffer.isView(right)) {
    if (!ArrayBuffer.isView(left) || !ArrayBuffer.isView(right) || left.constructor !== right.constructor || left.byteLength !== right.byteLength) return false;
    const a = new Uint8Array(left.buffer, left.byteOffset, left.byteLength), b = new Uint8Array(right.buffer, right.byteOffset, right.byteLength);
    return a.every((value, index) => value === b[index]);
  }
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every(key => sameValue(a[key], b[key]));
}
function changedEntries<K, V>(before: ReadonlyMap<K, V>, after: ReadonlyMap<K, V>, change: (key: K, previous: V | undefined, current: V | undefined) => void): void {
  if (before === after) return;
  for (const [key, value] of before) if (value !== after.get(key)) change(key, value, after.get(key));
  for (const [key, value] of after) if (!before.has(key)) change(key, undefined, value);
}
function sameObjectPaint(previous: EditorObject | undefined, current: EditorObject | undefined): boolean {
  if (previous?.kind === "group" || current?.kind === "group") return (!previous || previous.kind === "group") && (!current || current.kind === "group");
  if (!previous || !current) return previous === current;
  // Test placement first, so transforming an image never compares its pixel buffer.
  if (previous.kind !== current.kind || previous.pageIndex !== current.pageIndex || !sameValue(previous.transform, current.transform)) return false;
  const ignored = new Set(["id", "kind", "pageIndex", "transform", "locked", "link", "review"]);
  const a = previous as unknown as Record<string, unknown>, b = current as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) if (!ignored.has(key) && !sameValue(a[key], b[key])) return false;
  if (previous.kind === "shape" && current.kind === "shape") {
    return previous.review?.type === current.review?.type && sameValue(previous.review?.quads, current.review?.quads);
  }
  return true;
}

const annotations = new WeakMap<VectorScene, Map<string, NonNullable<VectorScene["annotations"]>[number]>>();
const fieldWidgets = new WeakMap<VectorScene, Map<string, NonNullable<VectorScene["annotations"]>[number][]>>();
function annotationIndex(scene: VectorScene) {
  let index = annotations.get(scene);
  if (!index) annotations.set(scene, index = new Map(scene.annotations?.map(annotation => [annotation.id, annotation])));
  return index;
}
function widgets(scene: VectorScene) {
  let index = fieldWidgets.get(scene);
  if (!index) {
    fieldWidgets.set(scene, index = new Map());
    for (const annotation of scene.annotations ?? []) if (annotation.field?.name) {
      const list = index.get(annotation.field.name) ?? []; list.push(annotation); index.set(annotation.field.name, list);
    }
  }
  return index;
}
function primitivePage(scene: VectorScene, ref: PrimitiveRef): number | undefined {
  if (scene.pagePrimitiveRanges) {
    const kind = PAGE_PRIMITIVE_KINDS.indexOf(ref.kind);
    for (let page = 0; page < scene.pageCount; page++) {
      const offset = page * PAGE_PRIMITIVE_RANGE_STRIDE + kind * 2;
      if (ref.index >= scene.pagePrimitiveRanges[offset] && ref.index < scene.pagePrimitiveRanges[offset] + scene.pagePrimitiveRanges[offset + 1]) return page;
    }
  }
  if (ref.kind === "raster") return scene.rasterLayers[ref.index].pageIndex;
  if (ref.kind === "gradient-fill") return scene.gradientFillPaintMeta[ref.index * 4 + 3];
  if (ref.kind === "gradient-stroke") return scene.gradientStrokeRunMetaB[ref.index * 4 + 1];
  if (ref.kind === "text") for (let page = 0; page < scene.pageCount; page++) {
    if (ref.index >= scene.pageTextRanges[page * 2] && ref.index < scene.pageTextRanges[page * 2] + scene.pageTextRanges[page * 2 + 1]) return page;
  }
  return undefined;
}
function layerMetadataOnly(previous: EditorLayerEdits, current: EditorLayerEdits): boolean {
  if (previous === current) return true;
  if (!sameValue(previous.removals, current.removals)) return false;
  if (previous.stackingChanged !== current.stackingChanged) return false;
  if ((previous.stackingChanged || current.stackingChanged) && !sameValue(previous.catalog.order, current.catalog.order)) return false;
  const groups = new Map(current.catalog.groups.map(group => [group.id, group]));
  for (const group of previous.catalog.groups) {
    const next = groups.get(group.id);
    if (next && (group.defaultVisible !== next.defaultVisible || group.usedInView !== next.usedInView)) return false;
  }
  // Appending unused conditions/groups, or undoing that append, changes no existing paint.
  const conditions = Math.min(previous.catalog.conditions.length, current.catalog.conditions.length);
  for (let index = 0; index < conditions; index++) if (!sameValue(previous.catalog.conditions[index], current.catalog.conditions[index])) return false;
  return true;
}

const sourceOwnerPages = new WeakMap<VectorScene, ReadonlyMap<string, ReadonlySet<number>>>();
function sourcePaintPages(scene: VectorScene): ReadonlyMap<string, ReadonlySet<number>> {
  let result = sourceOwnerPages.get(scene);
  if (!result) {
    const partition = new ScenePageViews(scene), identity = editorPaintIdentity(scene), counts = scenePrimitiveCounts(scene), owners = new Map<string, Set<number>>();
    for (const kind of PAGE_PRIMITIVE_KINDS) for (let index = 0; index < counts[kind]; index++) {
      const owner = identity({ kind, index }), pages = owners.get(owner) ?? new Set(); pages.add(partition.owners[kind][index]); owners.set(owner, pages);
    }
    for (const annotation of scene.annotations ?? []) {
      const owner = `annotation:${annotation.id}`, pages = owners.get(owner) ?? new Set(); pages.add(annotation.pageIndex); owners.set(owner, pages);
    }
    sourceOwnerPages.set(scene, result = owners);
  }
  return result;
}
function boundsPages(scene: VectorScene, bounds: Bounds): number[] {
  const result: number[] = [];
  for (let page = 0; page < scene.pageCount; page++) {
    const i = page * 4, r = scene.pageRects;
    if (bounds.maxX >= Math.min(r[i], r[i + 2]) && bounds.minX <= Math.max(r[i], r[i + 2]) &&
        bounds.maxY >= Math.min(r[i + 1], r[i + 3]) && bounds.minY <= Math.max(r[i + 1], r[i + 3])) result.push(page);
  }
  return result;
}
function pageObjectOrder(snapshot: EditorPageChangesSnapshot): ReadonlyMap<number, readonly string[]> | undefined {
  const scene = snapshot.sourceScene, sourcePages = sourcePaintPages(scene), edits = new Map<string, Set<number>>(), identity = editorPaintIdentity(scene);
  for (const edit of snapshot.sourceEdits.values()) if (!edit.deleted) {
    const owner = identity(edit.ref), pages = edits.get(owner) ?? new Set<number>();
    for (const page of boundsPages(scene, editorTransformBounds(getScenePrimitiveBounds(scene, edit.ref), edit.transform))) pages.add(page);
    edits.set(owner, pages);
  }
  const result = new Map<number, string[]>();
  for (const token of snapshot.getObjectOrder()) {
    let owner: string;
    try { owner = JSON.parse(token)[0]; if (typeof owner !== "string") return undefined; } catch { return undefined; }
    const id = editorPaintOwnerObject(owner), object = id === undefined ? undefined : snapshot.objects.get(id);
    const pages = new Set(object ? [object.pageIndex] : sourcePages.get(owner));
    for (const page of edits.get(owner) ?? []) pages.add(page);
    if (!pages.size) return undefined;
    for (const page of pages) { const order = result.get(page) ?? []; order.push(token); result.set(page, order); }
  }
  return result;
}

/** Undefined requests a complete refresh when page identity or global paint order changes. */
export function changedEditorPages(previous: EditorPageChangesSnapshot | undefined, current: EditorPageChangesSnapshot | undefined): readonly number[] | undefined {
  if (!previous || !current || previous.sourceScene !== current.sourceScene) return undefined;
  const scene = current.sourceScene, affected = new Set<number>();
  const add = (page: number | undefined) => { if (page !== undefined && Number.isInteger(page) && page >= 0 && page < scene.pageCount) affected.add(page); };
  const addBounds = (bounds: Bounds) => { for (const page of boundsPages(scene, bounds)) add(page); };
  const addPrimitive = (ref: PrimitiveRef, before = previous.sourceEdits.get(`${ref.kind}:${ref.index}`), after = current.sourceEdits.get(`${ref.kind}:${ref.index}`)) => {
    add(primitivePage(scene, ref)); const bounds = getScenePrimitiveBounds(scene, ref);
    if (!before?.deleted) addBounds(editorTransformBounds(bounds, before?.transform ?? EDITOR_IDENTITY));
    if (!after?.deleted) addBounds(editorTransformBounds(bounds, after?.transform ?? EDITOR_IDENTITY));
  };
  const addAnnotation = (id: string) => {
    const annotation = annotationIndex(scene).get(id); if (!annotation) return;
    add(annotation.pageIndex);
    for (const snapshot of [previous, current]) {
      const edit = snapshot.annotationEdits.get(id);
      if (!edit?.deleted) addBounds(editorTransformBounds(annotation.bounds, edit?.transform ?? EDITOR_IDENTITY));
    }
  };
  changedEntries(previous.objects, current.objects, (_id, before, after) => {
    if (!sameObjectPaint(before, after)) { add(before?.pageIndex); add(after?.pageIndex); }
  });
  changedEntries(previous.sourceEdits, current.sourceEdits, (_id, before, after) => {
    if (!!before?.deleted !== !!after?.deleted || !sameValue(before?.transform ?? EDITOR_IDENTITY, after?.transform ?? EDITOR_IDENTITY) || !sameValue(before?.color, after?.color)) addPrimitive((after ?? before)!.ref, before, after);
  });
  changedEntries(previous.annotationEdits, current.annotationEdits, (id, before, after) => {
    if (!!before?.deleted !== !!after?.deleted || !sameValue(before?.transform ?? EDITOR_IDENTITY, after?.transform ?? EDITOR_IDENTITY)) addAnnotation(id);
  });
  changedEntries(previous.fields, current.fields, (name, before, after) => {
    if (!sameValue(before, after)) for (const annotation of widgets(scene).get(name) ?? []) addAnnotation(annotation.id);
  });
  if (previous.layers !== current.layers) {
    if (!layerMetadataOnly(previous.layers, current.layers)) return undefined;
    if (!sameValue(previous.layers.objectOrder, current.layers.objectOrder)) {
      const before = pageObjectOrder(previous), after = pageObjectOrder(current);
      if (!before || !after) return undefined;
      for (const page of new Set([...before.keys(), ...after.keys()])) if (!sameValue(before.get(page), after.get(page))) add(page);
    }
    const assignments = (layers: EditorLayerEdits) => new Map(layers.sourceAssignments.map(value => [`${value.ref.kind}:${value.ref.index}`, value]));
    changedEntries(assignments(previous.layers), assignments(current.layers), (_id, before, after) => {
      if (before?.layerId !== after?.layerId) addPrimitive((after ?? before)!.ref);
    });
    changedEntries(new Map(previous.layers.annotationAssignments.map(value => [value.id, value.layerId])), new Map(current.layers.annotationAssignments.map(value => [value.id, value.layerId])),
      (id, before, after) => { if (before !== after) addAnnotation(id); });
  }
  return [...affected].sort((a, b) => a - b);
}
