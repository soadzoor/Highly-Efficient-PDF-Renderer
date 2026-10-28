import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import { composeOverlappingVectorScenes } from "./pdfVectorExtractor";
import { getScenePrimitive, getSceneAnnotationRuns, isScenePrimitiveVisible, type PrimitiveRef } from "./scenePrimitives";
import { createDefaultOptionalContentSnapshot } from "./optionalContent";
import { defaultVectorDrawRuns } from "./vectorDrawOrder";
import { PAGE_PRIMITIVE_KINDS, ScenePageViews, scenePrimitiveCounts } from "./scenePageViews";
import type { ScenePaintNode } from "./scenePaintGraph";
import type { EditorAnnotationEdit, EditorFieldValue, EditorMatrix, EditorObject, EditorObjectInput, EditorSession, EditorSessionOptions,
  EditorSourceEdit, EditorSourceObject, EditorState, EditorSelectionFrame } from "./editorTypes";
import { bakeEditorAnnotationEdits, bakeEditorSourceScene, compactEditorScene, composeEditorPage, EDITOR_IDENTITY, editorMatrix, editorMatrixIsIdentity,
  editorRefKey, editorTransformBounds, editorUnionBounds, invertEditorMatrix, multiplyEditorMatrices, transformWholeEditorScene } from "./editorScene";
import { compileEditorObjectGeometry, editorArrowHeadPoints } from "./editorSceneObjects";
import { waitForLoad } from "./loadCancellation";
import { createLoadProgressReporter, type PDFLoadProgress } from "./loadProgress";

interface Snapshot {
  objects: Map<string, EditorObject>;
  edits: Map<string, EditorSourceEdit>;
  annotationEdits: Map<string, EditorAnnotationEdit>;
  fields: Map<string, EditorFieldValue>;
  selection: string[];
  selectionBasis?: EditorMatrix;
  identity: object;
}
function copy<T>(value: T): T { return structuredClone(value); }
function finite(value: unknown, name: string, minimum?: number): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || (minimum !== undefined && value < minimum)) throw new RangeError(`${name} must be a finite number${minimum === undefined ? "" : ` at least ${minimum}`}.`);
}
function validateObject(object: EditorObject, pageCount: number): void {
  if (!object.id || typeof object.id !== "string") throw new TypeError("Editor objects require an ID.");
  if (!Number.isSafeInteger(object.pageIndex) || object.pageIndex < 0 || object.pageIndex >= pageCount) throw new RangeError("Editor object references an unknown page.");
  editorMatrix(object.transform);
  if (object.opacity !== undefined) { finite(object.opacity, "Opacity", 0); if (object.opacity > 1) throw new RangeError("Opacity must not exceed one."); }
  if (object.kind === "text" || object.kind === "shape" || object.kind === "image") {
    finite(object.x, "X"); finite(object.y, "Y"); finite(object.width, "Width", 0); finite(object.height, "Height", 0);
    if (![object.x, object.y, object.width, object.height].every(value => Number.isFinite(Math.fround(value)))) throw new RangeError("Editor bounds exceed the scene's representable coordinate range.");
  }
  if (object.kind === "text") {
    if (typeof object.text !== "string") throw new TypeError("Text content must be a string."); finite(object.fontSize, "Font size", Number.MIN_VALUE);
    if (object.runs) for (const run of object.runs) { if (typeof run.text !== "string") throw new TypeError("Text runs require text."); if (run.fontSize !== undefined) finite(run.fontSize, "Run font size", Number.MIN_VALUE); }
  } else if (object.kind === "image") {
    if (!Number.isSafeInteger(object.imageWidth) || object.imageWidth < 1 || !Number.isSafeInteger(object.imageHeight) || object.imageHeight < 1 ||
      !(object.data instanceof Uint8Array) || object.data.length !== object.imageWidth * object.imageHeight * 4) throw new TypeError("An editor image requires complete RGBA pixels and positive integer dimensions.");
  } else if (object.kind === "shape") {
    if (!["rectangle", "ellipse", "line", "arrow", "polygon", "polyline"].includes(object.shape)) throw new TypeError("Unknown editor shape.");
    if (object.strokeWidth !== undefined) finite(object.strokeWidth, "Stroke width", 0);
    for (const point of object.points ?? []) { if (point.length !== 2) throw new TypeError("Shape points must have X and Y."); point.forEach(value => finite(value, "Shape coordinate")); }
  } else if (object.kind === "ink" || object.kind === "signature") {
    if (!Array.isArray(object.paths)) throw new TypeError("Ink requires paths.");
    if (object.strokeWidth !== undefined) finite(object.strokeWidth, "Stroke width", 0);
    if (object.smoothing !== undefined) finite(object.smoothing, "Ink smoothing", 0);
    for (const path of object.paths) {
      if (!Array.isArray(path)) throw new TypeError("Ink paths must contain point arrays.");
      for (const point of path) {
        if (!Array.isArray(point) || point.length !== 2) throw new TypeError("Ink points must have X and Y.");
        point.forEach((value: number) => finite(value, "Ink coordinate"));
      }
    }
  } else if (object.kind !== "source" && object.kind !== "group") throw new TypeError("Unknown editor object kind.");
}

export function createEditorSession(sourceScene: VectorScene, options: EditorSessionOptions = {}): EditorSession {
  const pageCount = sourceScene.pageRects.length / 4;
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new RangeError("An editor requires a complete scene with at least one page.");
  let state: Snapshot = { objects: new Map(), edits: new Map(), annotationEdits: new Map(), fields: new Map(), selection: [], identity: {} };
  let savedIdentity = state.identity, revision = 0, disposed = false, nextId = 0, transactionDepth = 0, transactionStart: Snapshot | null = null;
  let previewTransform: EditorMatrix | null = null, previewSequence = 0;
  const undoStack: Snapshot[] = [], redoStack: Snapshot[] = [], listeners = new Set<(state: EditorState) => void>();
  let sourceObjects = new Map<string, EditorSourceObject>();
  const sourceObjectIds = new Set((sourceScene.annotations ?? []).flatMap(annotation => annotation.name ? [annotation.id, annotation.name] : [annotation.id]));
  let sourceAnnotationsByObjectId: Map<string, string[]> | undefined;
  const sourceIdIsDeleted = (id: string): boolean => {
    if (!sourceObjectIds.has(id)) return true;
    if (!sourceAnnotationsByObjectId) {
      sourceAnnotationsByObjectId = new Map();
      for (const annotation of sourceScene.annotations ?? []) for (const key of new Set([annotation.id, annotation.name].filter((value): value is string => !!value))) {
        const ids = sourceAnnotationsByObjectId.get(key) ?? []; ids.push(annotation.id); sourceAnnotationsByObjectId.set(key, ids);
      }
    }
    return sourceAnnotationsByObjectId.get(id)!.every(annotationId => state.annotationEdits.get(annotationId)?.deleted);
  };
  const nextObjectId = (): string => {
    let id: string;
    do { id = `editor:${++nextId}`; } while (sourceObjectIds.has(id) || state.objects.has(id) || sourceObjects.has(id));
    return id;
  };
  let cache: { revision: number; previewSequence: number; scene: VectorScene } | null = null, sourcePartition: ScenePageViews | null = null;
  let frameCache: { snapshot: Snapshot; frame: EditorSelectionFrame | null } | null = null;
  const compiled = new WeakMap<EditorObject, Promise<VectorScene>>();
  const geometryOrigins = new WeakMap<EditorObject, EditorObject>();
  const lifetime = new AbortController();
  const sourcePdf = options.sourcePdf?.slice();
  const assertLive = () => { if (disposed) throw new Error("Editor session is disposed."); };
  const getState = (): EditorState => ({ revision, dirty: state.identity !== savedIdentity, canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0, selection: state.selection.slice(), previewing: previewTransform !== null });
  const emit = () => { const value = getState(); for (const listener of listeners) { try { listener(value); } catch { /* Observers cannot interrupt an edit. */ } } };
  const change = (operation: () => void) => {
    assertLive(); const before = state;
    state = { objects: new Map(state.objects), edits: new Map(state.edits), annotationEdits: new Map(state.annotationEdits), fields: new Map(state.fields), selection: state.selection.slice(), selectionBasis: state.selectionBasis, identity: {} };
    try { operation(); } catch (error) { state = before; throw error; }
    if (previewTransform) { previewTransform = null; previewSequence++; cache = null; }
    if (!transactionDepth) { undoStack.push(before); redoStack.length = 0; revision++; cache = null; emit(); }
  };
  const pageOrigin = (pageIndex: number): [number, number] => [Math.min(sourceScene.pageRects[pageIndex * 4], sourceScene.pageRects[pageIndex * 4 + 2]),
    Math.min(sourceScene.pageRects[pageIndex * 4 + 1], sourceScene.pageRects[pageIndex * 4 + 3])];
  const sourceObject = (id: string): EditorSourceObject => {
    let object = sourceObjects.get(id); if (object) return object;
    if (id.startsWith("annotation:")) {
      const annotation = sourceScene.annotations?.find(annotation => annotation.id === id.slice("annotation:".length));
      if (!annotation) throw new RangeError(`Unknown editor annotation ${id}.`);
      const primitives: PrimitiveRef[] = [];
      for (const run of getSceneAnnotationRuns(sourceScene).get(annotation.id) ?? []) for (let index = run.first; index < run.first + run.count; index++) primitives.push({ kind: run.kind, index });
      let bounds: Bounds | null = null; for (const ref of primitives) bounds = editorUnionBounds(bounds, getScenePrimitive(sourceScene, ref).bounds);
      object = { id, kind: "source", pageIndex: annotation.pageIndex, transform: EDITOR_IDENTITY, primitives, bounds: bounds ?? annotation.bounds, annotationId: annotation.id };
      sourceObjects.set(id, object); return object;
    }
    const match = /^source:(stroke|fill|text|raster|gradient-fill|gradient-stroke):(\d+)$/.exec(id);
    if (!match) throw new RangeError(`Unknown editor object ${id}.`);
    const ref = { kind: match[1] as PrimitiveRef["kind"], index: Number(match[2]) }, primitive = getScenePrimitive(sourceScene, ref);
    object = { id, kind: "source", pageIndex: primitive.pageIndex ?? 0, transform: EDITOR_IDENTITY, primitives: [ref], bounds: primitive.bounds,
      ...(primitive.annotationId ? { annotationId: primitive.annotationId } : {}) };
    sourceObjects.set(id, object); return object;
  };
  const internalObject = (id: string): EditorObject => state.objects.get(id) ?? sourceObject(id);
  const objectDeleted = (object: EditorObject): boolean => object.kind === "source" && !state.objects.has(object.id) &&
    (!!(object.annotationId && state.annotationEdits.get(object.annotationId)?.deleted) ||
      (object.primitives.length > 0 && object.primitives.every(ref => state.edits.get(editorRefKey(ref))?.deleted)));
  const sourceBounds = (object: EditorSourceObject, snapshot = state): Bounds => {
    if (!object.primitives.length) return editorTransformBounds(object.bounds, snapshot.objects.has(object.id) ? object.transform :
      (object.annotationId ? snapshot.annotationEdits.get(object.annotationId)?.transform : undefined) ?? EDITOR_IDENTITY);
    let box: Bounds | null = null;
    for (const ref of object.primitives) {
      const edit = snapshot.objects.has(object.id) ? null : snapshot.edits.get(editorRefKey(ref)); if (edit?.deleted) continue;
      const matrix = snapshot.objects.has(object.id) ? object.transform : edit?.transform ?? EDITOR_IDENTITY;
      box = editorUnionBounds(box, editorTransformBounds(getScenePrimitive(sourceScene, ref).bounds, matrix));
    }
    return box ?? editorTransformBounds(object.bounds, object.transform);
  };
  const localObjectBounds = (object: Exclude<EditorObject, { kind: "source" | "group" }>): Bounds => {
    let box: Bounds;
    if (object.kind === "ink" || object.kind === "signature") {
      let points: Bounds | null = null;
      for (const path of object.paths) for (const [x, y] of path) points = editorUnionBounds(points, { minX: x, minY: y, maxX: x, maxY: y });
      // Fitting stays within this error of the captured centerline. Conservative
      // bounds avoid refitting handwriting while dragging selection handles.
      const width = (object.strokeWidth ?? 1) / 2 + (object.smoothing ?? 0), p = points ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      box = { minX: p.minX - width, minY: p.minY - width, maxX: p.maxX + width, maxY: p.maxY + width };
    } else if (object.kind === "shape") {
      const usePoints = object.shape === "polygon" || object.shape === "polyline" ||
        ((object.shape === "line" || object.shape === "arrow") && object.points?.length === 2);
      const points = usePoints && object.points?.length ? object.points : [[object.x, object.y], [object.x + object.width, object.y + object.height]];
      let centerline: Bounds | null = null;
      for (const [x, y] of points) centerline = editorUnionBounds(centerline, { minX: x, minY: y, maxX: x, maxY: y });
      const p = centerline!, halfWidth = (object.strokeWidth ?? 1) / 2;
      // Canonical polylines have round caps and joins, including axis-aligned
      // lines whose centerline alone has zero width or height.
      box = { minX: p.minX - halfWidth, minY: p.minY - halfWidth, maxX: p.maxX + halfWidth, maxY: p.maxY + halfWidth };
      if (object.shape === "arrow") for (const [x, y] of editorArrowHeadPoints(object)) box = editorUnionBounds(box, { minX: x, minY: y, maxX: x, maxY: y });
    } else { box = { minX: object.x, minY: object.y, maxX: object.x + object.width, maxY: object.y + object.height }; }
    return box;
  };
  const objectBounds = (id: string, visiting = new Set<string>()): Bounds => {
    const object = internalObject(id);
    if (object.kind === "source") return sourceBounds(object);
    if (object.kind === "group") {
      if (visiting.has(id)) throw new Error("Cyclic editor group."); visiting.add(id); let box: Bounds | null = null;
      for (const child of object.children) box = editorUnionBounds(box, objectBounds(child, visiting)); visiting.delete(id);
      return box ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
    const origin = pageOrigin(object.pageIndex); return editorTransformBounds(localObjectBounds(object), multiplyEditorMatrices([1, 0, 0, 1, ...origin], object.transform));
  };
  const frameInBasis = (frames: readonly EditorSelectionFrame[], basis: EditorMatrix): EditorSelectionFrame => {
    const inverse = invertEditorMatrix(basis); let bounds: Bounds | null = null;
    for (const frame of frames) bounds = editorUnionBounds(bounds, editorTransformBounds(frame.bounds, multiplyEditorMatrices(inverse, frame.transform)));
    const pageIndex = frames[0]?.pageIndex;
    return { bounds: bounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 }, transform: basis,
      ...(pageIndex !== undefined && frames.every(frame => frame.pageIndex === pageIndex) ? { pageIndex } : {}) };
  };
  const objectFrame = (id: string, snapshot = state, visiting = new Set<string>()): EditorSelectionFrame => {
    const object = snapshot.objects.get(id) ?? sourceObject(id);
    if (object.kind === "source") {
      if (snapshot.objects.has(id)) return { bounds: object.bounds, transform: object.transform, pageIndex: object.pageIndex };
      if (!object.primitives.length) return { bounds: object.bounds,
        transform: object.annotationId ? snapshot.annotationEdits.get(object.annotationId)?.transform ?? EDITOR_IDENTITY : EDITOR_IDENTITY, pageIndex: object.pageIndex };
      let bounds: Bounds | null = null, matrix: EditorMatrix | null = null, common = true;
      for (const ref of object.primitives) {
        const edit = snapshot.edits.get(editorRefKey(ref)); if (edit?.deleted) continue;
        bounds = editorUnionBounds(bounds, getScenePrimitive(sourceScene, ref).bounds);
        const current = edit?.transform ?? EDITOR_IDENTITY;
        if (!matrix) matrix = current; else if (matrix.some((value, index) => value !== current[index])) common = false;
      }
      if (common && bounds && matrix) return { bounds, transform: matrix, pageIndex: object.pageIndex };
      if (matrix) return frameInBasis(object.primitives.flatMap(ref => {
        const edit = snapshot.edits.get(editorRefKey(ref));
        return edit?.deleted ? [] : [{ bounds: getScenePrimitive(sourceScene, ref).bounds, transform: edit?.transform ?? EDITOR_IDENTITY, pageIndex: object.pageIndex }];
      }), matrix);
      return { bounds: sourceBounds(object, snapshot), transform: EDITOR_IDENTITY, pageIndex: object.pageIndex };
    }
    const transform = multiplyEditorMatrices([1, 0, 0, 1, ...pageOrigin(object.pageIndex)], object.transform);
    if (object.kind !== "group") return { bounds: localObjectBounds(object), transform, pageIndex: object.pageIndex };
    if (visiting.has(id)) throw new Error("Cyclic editor group."); visiting.add(id);
    const frame = frameInBasis(object.children.map(child => objectFrame(child, snapshot, visiting)), transform);
    visiting.delete(id); return object.children.length ? frame : { ...frame, pageIndex: object.pageIndex };
  };
  const selectionFrame = (snapshot = state): EditorSelectionFrame | null => {
    if (!snapshot.selection.length) return null;
    const frames = snapshot.selection.map(id => objectFrame(id, snapshot));
    if (frames.length === 1) return frames[0];
    let basis = snapshot.selectionBasis;
    if (!basis) {
      const first = frames[0].transform;
      const sharedAxes = frames.every(frame => [0, 1, 2, 3].every(index => frame.transform[index] === first[index]));
      basis = sharedAxes ? first : EDITOR_IDENTITY;
    }
    return frameInBasis(frames, basis);
  };
  const expand = (ids: readonly string[]): string[] => {
    const result = new Set<string>(), visiting = new Set<string>();
    const visit = (id: string) => { const object = internalObject(id); if (visiting.has(id)) throw new Error("Cyclic editor group.");
      if (object.kind !== "group") { result.add(id); return; } visiting.add(id); object.children.forEach(visit); visiting.delete(id); };
    ids.forEach(visit); return [...result];
  };
  const transformedSnapshot = (snapshot: Snapshot, matrix: EditorMatrix): Snapshot => {
    const result: Snapshot = { ...snapshot, objects: new Map(snapshot.objects), edits: new Map(snapshot.edits), annotationEdits: new Map(snapshot.annotationEdits) }, refs = new Set<string>(), annotations = new Set<string>();
    if (snapshot.selection.length > 1) result.selectionBasis = multiplyEditorMatrices(matrix, selectionFrame(snapshot)!.transform);
    const objectFor = (id: string) => snapshot.objects.get(id) ?? sourceObject(id);
    const ids = new Set<string>(), groups = new Set<string>(), visit = (id: string) => { const object = objectFor(id);
      if (object.kind === "group") { groups.add(id); object.children.forEach(visit); } else ids.add(id); };
    snapshot.selection.forEach(visit);
    for (const id of groups) {
      const object = objectFor(id), origin = pageOrigin(object.pageIndex);
      const local = multiplyEditorMatrices([1, 0, 0, 1, -origin[0], -origin[1]], multiplyEditorMatrices(matrix, [1, 0, 0, 1, ...origin]));
      result.objects.set(id, { ...object, transform: multiplyEditorMatrices(local, object.transform) });
    }
    for (const id of ids) {
      const object = objectFor(id);
      if (object.kind === "source" && !snapshot.objects.has(id)) {
        if (object.annotationId && !annotations.has(object.annotationId)) {
          annotations.add(object.annotationId); const previous = result.annotationEdits.get(object.annotationId);
          result.annotationEdits.set(object.annotationId, { id: object.annotationId, transform: multiplyEditorMatrices(matrix, previous?.transform ?? EDITOR_IDENTITY), deleted: previous?.deleted ?? false });
        }
        for (const ref of object.primitives) { const key = editorRefKey(ref); if (refs.has(key)) continue; refs.add(key);
          const previous = result.edits.get(key); result.edits.set(key, { ref: { ...ref }, transform: multiplyEditorMatrices(matrix, previous?.transform ?? EDITOR_IDENTITY), deleted: previous?.deleted ?? false }); }
      } else {
        const origin = object.kind === "source" ? [0, 0] : pageOrigin(object.pageIndex);
        const local = multiplyEditorMatrices([1, 0, 0, 1, -origin[0], -origin[1]], multiplyEditorMatrices(matrix, [1, 0, 0, 1, origin[0], origin[1]]));
        const next = { ...object, transform: multiplyEditorMatrices(local, object.transform) };
        geometryOrigins.set(next, geometryOrigins.get(object) ?? object); result.objects.set(id, next);
      }
    }
    return result;
  };
  const promoteSource = (ref: PrimitiveRef): string => {
    const info = getScenePrimitive(sourceScene, ref);
    if (info.annotationId) {
      const id = `annotation:${info.annotationId}`;
      if (!sourceObjects.has(id)) {
        const primitives = (getSceneAnnotationRuns(sourceScene).get(info.annotationId) ?? []).flatMap(run => Array.from({ length: run.count }, (_, index) => ({ kind: run.kind, index: run.first + index })));
        let bounds: Bounds | null = null; for (const primitive of primitives) bounds = editorUnionBounds(bounds, getScenePrimitive(sourceScene, primitive).bounds);
        sourceObjects.set(id, { id, kind: "source", pageIndex: info.pageIndex ?? 0, transform: EDITOR_IDENTITY, primitives: primitives.length ? primitives : [ref], bounds: bounds ?? info.bounds, annotationId: info.annotationId });
      }
      return id;
    }
    const runs = sourceScene.drawRuns ?? defaultVectorDrawRuns(sourceScene), containing = runs.findIndex(run => run.kind === ref.kind && ref.index >= run.first && ref.index < run.first + run.count);
    let promoted: { id: string; nodes: readonly ScenePaintNode[] } | null = null;
    const contains = (nodes: readonly ScenePaintNode[]): boolean => nodes.some(node => node.kind === "draw" ? node.runIndex === containing :
      node.kind === "retained" ? ref.kind === "raster" && node.rasterIndex === ref.index : contains(node.children));
    const visit = (nodes: readonly ScenePaintNode[], path: string) => {
      nodes.forEach((node, index) => {
        if (node.kind !== "group" || !contains(node.children)) return;
        if (node.softMask || node.knockout) { if (!promoted) promoted = { id: `source-group:${path}${index}`, nodes: [node] }; return; }
        visit(node.children, `${path}${index}.`);
      });
    };
    visit(sourceScene.paintGraph?.roots ?? [], "");
    const group = promoted as { id: string; nodes: readonly ScenePaintNode[] } | null;
    if (group) {
      if (!sourceObjects.has(group.id)) {
        const refs: PrimitiveRef[] = []; let bounds: Bounds | null = null;
        const collect = (nodes: readonly ScenePaintNode[]) => { for (const node of nodes) {
          if (node.kind === "group") { collect(node.children); if (node.softMask) collect(node.softMask.children); }
          else if (node.kind === "retained") refs.push({ kind: "raster", index: node.rasterIndex });
          else { const run = runs[node.runIndex]; for (let index = run.first; index < run.first + run.count; index++) refs.push({ kind: run.kind, index }); }
        } }; collect(group.nodes);
        for (const primitive of refs) bounds = editorUnionBounds(bounds, getScenePrimitive(sourceScene, primitive).bounds);
        sourceObjects.set(group.id, { id: group.id, kind: "source", pageIndex: info.pageIndex ?? 0, transform: EDITOR_IDENTITY, primitives: refs, bounds: bounds ?? info.bounds });
      }
      return group.id;
    }
    const id = `source:${editorRefKey(ref)}`; sourceObject(id); return id;
  };
  const selection = (ids: readonly string[], selectionOptions: { additive?: boolean; toggle?: boolean } = {}) => {
    assertLive(); const valid = [...new Set(ids.map(id => {
      const match = /^source:(stroke|fill|text|raster|gradient-fill|gradient-stroke):(\d+)$/.exec(id);
      return match ? promoteSource({ kind: match[1] as PrimitiveRef["kind"], index: Number(match[2]) }) : id;
    }))]; valid.forEach(id => { if (objectDeleted(internalObject(id))) throw new RangeError("A deleted object cannot be selected."); });
    const selected = new Set(selectionOptions.additive || selectionOptions.toggle ? state.selection : []);
    for (const id of valid) if (selectionOptions.toggle && selected.has(id)) selected.delete(id); else selected.add(id);
    if (previewTransform) { previewTransform = null; previewSequence++; cache = null; }
    const same = selected.size === state.selection.length && state.selection.every(id => selected.has(id));
    state = { ...state, selection: [...selected], selectionBasis: same ? state.selectionBasis : undefined }; emit();
  };
  const session: EditorSession = {
    sourceScene, sourcePdf,
    get revision() { return revision; },
    getState,
    getObjects(listOptions = {}) {
      assertLive(); const list = new Map<string, EditorObject>([...state.objects, ...sourceObjects]);
      if (listOptions.includeSource) {
        for (const annotation of sourceScene.annotations ?? []) {
          if (listOptions.pageIndex !== undefined && annotation.pageIndex !== listOptions.pageIndex) continue;
          const id = `annotation:${annotation.id}`; list.set(id, sourceObject(id));
        }
        const counts = scenePrimitiveCounts(sourceScene);
        for (const kind of PAGE_PRIMITIVE_KINDS) for (let index = 0; index < counts[kind]; index++) {
          if (listOptions.pageIndex !== undefined) {
            sourcePartition ??= new ScenePageViews(sourceScene); if (sourcePartition.owners[kind][index] !== listOptions.pageIndex) continue;
          }
          const id = promoteSource({ kind, index }); list.set(id, internalObject(id));
        }
      }
      return [...list.values()].filter(object => !objectDeleted(object) && (listOptions.pageIndex === undefined || object.pageIndex === listOptions.pageIndex)).map(object => {
        const result = copy(object);
        if (result.kind === "source" && !state.objects.has(result.id) && result.primitives.length === 1) result.transform = copy(state.edits.get(editorRefKey(result.primitives[0]))?.transform ?? EDITOR_IDENTITY);
        if (result.kind === "source" && !state.objects.has(result.id) && result.annotationId && !result.primitives.length) result.transform = copy(state.annotationEdits.get(result.annotationId)?.transform ?? EDITOR_IDENTITY);
        return result;
      });
    },
    getObject(id) { assertLive(); const object = copy(internalObject(id));
      if (object.kind === "source" && !state.objects.has(id) && object.primitives.length === 1) object.transform = copy(state.edits.get(editorRefKey(object.primitives[0]))?.transform ?? EDITOR_IDENTITY);
      if (object.kind === "source" && !state.objects.has(id) && object.annotationId && !object.primitives.length) object.transform = copy(state.annotationEdits.get(object.annotationId)?.transform ?? EDITOR_IDENTITY);
      return object; },
    getObjectBounds(id) { assertLive(); return objectBounds(id); },
    getSelection() { return state.selection.slice(); },
    getSelectionBounds() { let bounds: Bounds | null = null; for (const id of state.selection) bounds = editorUnionBounds(bounds, objectBounds(id)); return bounds; },
    getSelectionFrame() {
      assertLive(); if (frameCache?.snapshot !== state) frameCache = { snapshot: state, frame: selectionFrame() };
      return copy(frameCache.frame);
    },
    select: selection,
    selectPrimitives(refs, selectionOptions) { selection(refs.map(promoteSource), selectionOptions); },
    selectAnnotations(ids, selectionOptions) { selection(ids.map(id => `annotation:${id}`), selectionOptions); },
    selectArea(bounds, selectionOptions = {}) {
      assertLive(); for (const value of Object.values(bounds)) finite(value, "Selection bound");
      const found = new Set<string>(), hit = (box: Bounds) => selectionOptions.intersects
        ? box.minX <= bounds.maxX && box.maxX >= bounds.minX && box.minY <= bounds.maxY && box.maxY >= bounds.minY
        : box.minX >= bounds.minX && box.maxX <= bounds.maxX && box.minY >= bounds.minY && box.maxY <= bounds.maxY;
      for (const object of session.getObjects({ pageIndex: selectionOptions.pageIndex })) if (hit(objectBounds(object.id))) found.add(object.id);
      const counts = scenePrimitiveCounts(sourceScene);
      const visibility = createDefaultOptionalContentSnapshot(sourceScene);
      for (const annotation of sourceScene.annotations ?? []) {
        if (!annotation.visibleInDefaultView || annotation.subtype === "Popup" || (annotation.flags & (1 | 2 | 32)) !== 0 ||
          (annotation.optionalContent !== undefined && visibility.conditions[annotation.optionalContent] !== 1) ||
          (selectionOptions.pageIndex !== undefined && annotation.pageIndex !== selectionOptions.pageIndex)) continue;
        if ((getSceneAnnotationRuns(sourceScene).get(annotation.id)?.length ?? 0) > 0) continue;
        const id = `annotation:${annotation.id}`, object = sourceObject(id);
        if (!objectDeleted(object) && hit(objectBounds(id))) found.add(id);
      }
      for (const kind of PAGE_PRIMITIVE_KINDS) for (let index = 0; index < counts[kind]; index++) {
        const ref = { kind, index }, edit = state.edits.get(editorRefKey(ref)); if (edit?.deleted) continue;
        if (!isScenePrimitiveVisible(sourceScene, ref, condition => condition === undefined || visibility.conditions[condition] === 1)) continue;
        if (selectionOptions.pageIndex !== undefined) { sourcePartition ??= new ScenePageViews(sourceScene); if (sourcePartition.owners[kind][index] !== selectionOptions.pageIndex) continue; }
        if (hit(editorTransformBounds(getScenePrimitive(sourceScene, ref).bounds, edit?.transform ?? EDITOR_IDENTITY))) found.add(promoteSource(ref));
      }
      selection([...found], selectionOptions);
    },
    addObject(input) {
      assertLive(); const id = input.id ?? nextObjectId();
      if (!sourceIdIsDeleted(id) || state.objects.has(id) || sourceObjects.has(id) || /^(source:|annotation:|source-group:)/.test(id)) throw new RangeError("Editor object ID already exists or is reserved.");
      const object = copy({ ...input, id, transform: input.transform ?? EDITOR_IDENTITY }) as EditorObject;
      if (object.kind === "text" && object.runs !== undefined) object.text = object.runs.map(run => run.text).join("");
      validateObject(object, pageCount);
      if (object.kind === "source") { object.isClone = true; for (const ref of object.primitives) getScenePrimitive(sourceScene, ref); }
      if (object.kind === "group") object.children.forEach(internalObject);
      change(() => { state.objects.set(id, object); state.selection = [id]; state.selectionBasis = undefined; }); return id;
    },
    updateObject(id, patch) {
      assertLive(); const original = internalObject(id);
      if (!state.objects.has(id) && original.kind === "source") throw new TypeError("Original content is updated through selection transforms.");
      const object = copy({ ...original, ...patch, id, kind: original.kind }) as EditorObject;
      if (object.kind === "text") {
        if (Object.hasOwn(patch, "text") && !Object.hasOwn(patch, "runs")) delete object.runs;
        if (object.runs !== undefined) object.text = object.runs.map(run => run.text).join("");
      }
      validateObject(object, pageCount);
      if (object.kind === "group") throw new TypeError("Use group and ungroup operations to change group membership.");
      if (Object.keys(patch).every(key => key === "transform" || key === "pageIndex")) geometryOrigins.set(object, geometryOrigins.get(original) ?? original);
      change(() => state.objects.set(id, object));
    },
    transformSelection(input) {
      const matrix = editorMatrix(input); if (editorMatrixIsIdentity(matrix) || !state.selection.length) return;
      for (const id of state.selection) editorTransformBounds(objectBounds(id), matrix);
      change(() => { state = transformedSnapshot(state, matrix); });
    },
    setPreviewTransform(input) {
      assertLive(); const matrix = input === null ? null : editorMatrix(input);
      if (matrix) for (const id of state.selection) editorTransformBounds(objectBounds(id), matrix);
      previewTransform = matrix && !editorMatrixIsIdentity(matrix) ? matrix : null;
      previewSequence++; cache = null; emit();
    },
    deleteSelection() {
      if (!state.selection.length) return;
      change(() => {
        const selectedGroups = new Set<string>();
        const collectGroups = (id: string) => { const object = internalObject(id); if (object.kind !== "group") return;
          selectedGroups.add(id); object.children.forEach(collectGroups); };
        state.selection.forEach(collectGroups);
        for (const id of expand(state.selection)) { const object = internalObject(id);
          if (object.kind === "source" && !state.objects.has(id)) {
            if (object.annotationId) state.annotationEdits.set(object.annotationId, { id: object.annotationId, transform: state.annotationEdits.get(object.annotationId)?.transform ?? EDITOR_IDENTITY, deleted: true });
            for (const ref of object.primitives) {
              const key = editorRefKey(ref); state.edits.set(key, { ref: { ...ref }, transform: state.edits.get(key)?.transform ?? EDITOR_IDENTITY, deleted: true });
            }
          } else state.objects.delete(id);
        }
        for (const id of selectedGroups) state.objects.delete(id);
        const pruneGroup = (id: string): boolean => {
          const object = state.objects.get(id) ?? sourceObjects.get(id); if (!object || objectDeleted(object)) return false;
          if (object.kind !== "group") return true;
          const children = object.children.filter(pruneGroup);
          if (!children.length) { state.objects.delete(id); return false; }
          if (children.length !== object.children.length) state.objects.set(id, { ...object, children }); return true;
        };
        for (const object of state.objects.values()) if (object.kind === "group") pruneGroup(object.id);
        state.selection = []; state.selectionBasis = undefined;
      });
    },
    cloneSelection(offset = [12, -12]) {
      finite(offset[0], "Clone X offset"); finite(offset[1], "Clone Y offset"); const clones: string[] = [];
      const basis = selectionFrame()?.transform;
      session.transaction("Duplicate", () => {
        const selected = expand(state.selection);
        for (const id of selected) {
          const original = internalObject(id), clone = copy(original); clone.id = nextObjectId();
          if (clone.kind === "source" && !state.objects.has(id)) {
            // Different member transforms are already visible in the baked subset; preserve a common transform when available.
            const matrices = clone.primitives.length ? clone.primitives.map(ref => state.edits.get(editorRefKey(ref))?.transform ?? EDITOR_IDENTITY)
              : [clone.annotationId ? state.annotationEdits.get(clone.annotationId)?.transform ?? EDITOR_IDENTITY : EDITOR_IDENTITY];
            if (matrices.some(matrix => matrix.some((value, i) => value !== matrices[0][i]))) throw new Error("Group source objects with different transforms after cloning individual members.");
            clone.transform = matrices[0];
          }
          if (clone.kind === "source") clone.isClone = true;
          change(() => state.objects.set(clone.id, clone)); clones.push(clone.id);
        }
        state.selection = clones; state.selectionBasis = clones.length > 1 ? basis : undefined;
        session.transformSelection([1, 0, 0, 1, offset[0], offset[1]]);
      }); return clones;
    },
    groupSelection() {
      if (state.selection.length < 2) return null;
      const children = state.selection.slice(), pageIndex = internalObject(children[0]).pageIndex;
      if (children.some(id => internalObject(id).pageIndex !== pageIndex)) throw new RangeError("Group objects on the same page.");
      const origin = pageOrigin(pageIndex), frame = selectionFrame()!;
      return session.addObject({ kind: "group", pageIndex, children,
        transform: multiplyEditorMatrices([1, 0, 0, 1, -origin[0], -origin[1]], frame.transform) });
    },
    ungroupSelection() {
      const selected: string[] = [], basis = selectionFrame()?.transform;
      change(() => { for (const id of state.selection) { const object = internalObject(id);
        if (object.kind === "group") { selected.push(...object.children); state.objects.delete(id); } else selected.push(id);
      } state.selection = [...new Set(selected)]; state.selectionBasis = state.selection.length > 1 ? basis : undefined; });
    },
    setFieldValue(name, value) {
      if (!name || typeof name !== "string") throw new TypeError("A field name is required.");
      if (!(value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) ||
        (Array.isArray(value) && value.every(item => typeof item === "string")))) throw new TypeError("Invalid PDF field value.");
      if (sourceScene.annotations?.some(annotation => annotation.field?.name === name && (annotation.field.flags & 1) !== 0)) throw new Error("This PDF field is read-only.");
      if (!sourceScene.annotations?.some(annotation => annotation.field?.name === name)) throw new RangeError(`Unknown PDF field ${name}.`);
      change(() => state.fields.set(name, copy(value)));
    },
    getFieldValues() { return new Map([...state.fields].map(([name, value]) => [name, copy(value)])); },
    getSourceEdits() { return [...state.edits.values()].map(copy); },
    getAnnotationEdits() { return [...state.annotationEdits.values()].map(copy); },
    getPages() {
      assertLive();
      return Array.from({ length: pageCount }, (_, index) => {
        const matrix = sourceScene.pdfPages?.find(page => page.pageIndex === index)?.pdfToScene;
        const rotation = matrix ? (Math.round(Math.atan2(-matrix[1], matrix[0]) * 2 / Math.PI) * 90 + 360) % 360 : 0;
        return { index, width: Math.abs(sourceScene.pageRects[index * 4 + 2] - sourceScene.pageRects[index * 4]),
          height: Math.abs(sourceScene.pageRects[index * 4 + 3] - sourceScene.pageRects[index * 4 + 1]), rotation };
      });
    },
    async rotatePages() { throw new Error("Page operations require an editor document session."); },
    async removePages() { throw new Error("Page operations require an editor document session."); },
    async insertPdf() { throw new Error("Page operations require an editor document session."); },
    transaction(_label, operation) {
      assertLive(); const before = state, outer = transactionDepth === 0; if (outer) transactionStart = before; transactionDepth++;
      try { operation(); } catch (error) { state = before; throw error; }
      finally { transactionDepth--; if (outer) {
        if (state.identity !== transactionStart!.identity) { undoStack.push(transactionStart!); redoStack.length = 0; revision++; cache = null; emit(); }
        transactionStart = null;
      } }
    },
    undo() { assertLive(); previewTransform = null; previewSequence++; const previous = undoStack.pop(); if (!previous) { emit(); return false; } redoStack.push(state); state = previous; revision++; cache = null; emit(); return true; },
    redo() { assertLive(); previewTransform = null; previewSequence++; const next = redoStack.pop(); if (!next) { emit(); return false; } undoStack.push(state); state = next; revision++; cache = null; emit(); return true; },
    markSaved() { assertLive(); savedIdentity = state.identity; emit(); },
    subscribe(listener) { assertLive(); listeners.add(listener); return () => listeners.delete(listener); },
    async getScene(compileOptions = {}) {
      assertLive(); const signal = compileOptions.signal ? AbortSignal.any([compileOptions.signal, lifetime.signal]) : lifetime.signal;
      const progress = createLoadProgressReporter(compileOptions.onProgress);
      const compileMeta = { stage: "compile" as const, sourceType: "scene" as const, pageCount };
      const completeMeta = { sourceType: "scene" as const, unit: "pages" as const, processed: pageCount, total: pageCount, pageCount };
      const preview = compileOptions.preview !== false, startedPreview = preview ? previewSequence : -1;
      const committedSnapshot = state, capturedPreview = previewTransform, startedRevision = revision;
      const includeObjects = compileOptions.includeObjects !== false;
      signal.throwIfAborted(); progress.report(0, { ...compileMeta, unit: "pages", processed: 0, total: pageCount }); signal.throwIfAborted();
      if (includeObjects && cache?.revision === startedRevision && cache.previewSequence === startedPreview) { const cachedScene = cache.scene; progress.complete(completeMeta); return cachedScene; }
      const snapshot = preview && capturedPreview ? transformedSnapshot(committedSnapshot, capturedPreview) : committedSnapshot;
      let base = bakeEditorSourceScene(sourceScene, [...snapshot.edits.values()], signal, options.onDiagnostic);
      const metadataOnly = [...snapshot.annotationEdits.values()].filter(edit => !(getSceneAnnotationRuns(sourceScene).get(edit.id)?.length));
      base = bakeEditorAnnotationEdits(base, metadataOnly);
      progress.report(.15, compileMeta); signal.throwIfAborted();
      if (snapshot.fields.size) {
        if (!options.compileFields) throw new Error("Form field updates require the editor's field appearance compiler.");
        base = await options.compileFields(base, snapshot.fields, signal);
      }
      signal.throwIfAborted(); progress.report(.3, compileMeta); signal.throwIfAborted();
      const additions = includeObjects ? [...snapshot.objects.values()].filter(object => object.kind !== "group") : [];
      if (!additions.length) {
        if (includeObjects && revision === startedRevision && (!preview || previewSequence === startedPreview) && !disposed) cache = { revision, previewSequence: startedPreview, scene: base };
        progress.complete(completeMeta); return base;
      }
      const partition = new ScenePageViews(base), pages: VectorScene[] = [];
      for (let index = 0; index < pageCount; index++) {
        signal.throwIfAborted(); pages.push(partition.extract(index).scene);
        progress.report(.3 + .15 * (index + 1) / pageCount, { ...compileMeta, pageIndex: index, unit: "pages", processed: index + 1, total: pageCount });
      }
      const pageAdditions: VectorScene[][] = Array.from({ length: pageCount }, () => []);
      for (let objectIndex = 0; objectIndex < additions.length; objectIndex++) {
        const object = additions[objectIndex];
        signal?.throwIfAborted(); let geometry: VectorScene;
        if (object.kind === "source") {
          const keep = Object.fromEntries(PAGE_PRIMITIVE_KINDS.map(kind => [kind, new Set<number>()])) as Record<PrimitiveRef["kind"], Set<number>>;
          for (const ref of object.primitives) keep[ref.kind].add(ref.index);
          geometry = transformWholeEditorScene(compactEditorScene(sourceScene, keep), object.transform, signal, options.onDiagnostic);
          geometry.pageCount = 1; geometry.pageRects = sourceScene.pageRects.slice(object.pageIndex * 4, object.pageIndex * 4 + 4);
          geometry.pageTextRanges = Uint32Array.of(0, geometry.textInstanceCount); geometry.pagePrimitiveRanges = undefined;
          geometry.pdfPages = undefined; geometry.annotations = undefined;
          geometry.markedContent = undefined; geometry.structureElements = undefined;
          if (geometry.textIndex) geometry.textIndex = { version: 2, pages: [geometry.textIndex.pages[object.pageIndex]] };
          geometry.rasterLayers = geometry.rasterLayers.map(layer => ({ ...layer, pageIndex: 0 }));
          for (let i = 0; i < geometry.gradientFillPaintMeta.length; i += 4) geometry.gradientFillPaintMeta[i + 3] = 0;
          for (let i = 0; i < geometry.gradientStrokeRunMetaB.length; i += 4) geometry.gradientStrokeRunMetaB[i + 1] = 0;
        } else {
          const originObject = geometryOrigins.get(object) ?? object;
          let promise = compiled.get(originObject);
          if (!promise) {
            // Compiled local geometry is shared by render previews and saves.
            // Canceling one consumer must not poison another consumer's work.
            promise = (options.compileObject ?? compileEditorObjectGeometry)(originObject, lifetime.signal); compiled.set(originObject, promise);
            void promise.catch(() => compiled.delete(originObject));
          }
          geometry = await waitForLoad(promise, signal); signal?.throwIfAborted(); const origin = pageOrigin(object.pageIndex);
          geometry = transformWholeEditorScene(geometry, multiplyEditorMatrices([1, 0, 0, 1, ...origin], object.transform), signal, options.onDiagnostic);
        }
        pageAdditions[object.pageIndex].push(geometry);
        progress.report(.45 + .4 * (objectIndex + 1) / additions.length, { ...compileMeta, pageIndex: object.pageIndex });
      }
      signal.throwIfAborted();
      const composedPages = pages.map((page, index) => {
        signal.throwIfAborted(); const composed = composeEditorPage(page, pageAdditions[index]);
        progress.report(.85 + .12 * (index + 1) / pageCount, { ...compileMeta, pageIndex: index, unit: "pages", processed: index + 1, total: pageCount });
        return composed;
      });
      const result = composeOverlappingVectorScenes(composedPages); signal.throwIfAborted();
      result.pagesPerRow = sourceScene.pagesPerRow; result.sourcePdfByteLength = sourceScene.sourcePdfByteLength;
      if (revision === startedRevision && (!preview || previewSequence === startedPreview) && !disposed) cache = { revision, previewSequence: startedPreview, scene: result };
      progress.complete(completeMeta); return result;
    },
    async savePdf(saveOptions = {}) {
      assertLive();
      saveOptions = { ...saveOptions, protection: saveOptions.protection ? { ...saveOptions.protection } : undefined,
        signal: saveOptions.signal ? AbortSignal.any([saveOptions.signal, lifetime.signal]) : lifetime.signal };
      saveOptions.signal!.throwIfAborted();
      const progress = createLoadProgressReporter(saveOptions.onProgress), compileProgress = progress.child(0, .4), persistenceProgress = progress.child(.4, 1);
      const snapshot = state, targetRevision = revision, snapshotObjects = new Map(sourceObjects);
      const snapshotStatus = { ...getState(), previewing: false };
      const scene = await session.getScene({ ...saveOptions, preview: false,
        onProgress: payload => compileProgress.report(payload.value, { ...payload, stage: payload.stage === "complete" ? "compile" : payload.stage }) });
      saveOptions.signal?.throwIfAborted();
      // Native persistence queries metadata after asynchronous parsing and
      // resource imports. Give it the same revision as the compiled scene,
      // even if the user keeps editing or uses undo during that work.
      const withSnapshot = <T>(operation: () => T): T => {
        const previousState = state, previousRevision = revision, previousObjects = sourceObjects;
        const previousPreview = previewTransform, previousSequence = previewSequence, previousCache = cache;
        state = snapshot; revision = targetRevision; sourceObjects = snapshotObjects; previewTransform = null; cache = null;
        try { return operation(); }
        finally {
          state = previousState; revision = previousRevision; sourceObjects = previousObjects;
          previewTransform = previousPreview; previewSequence = previousSequence; cache = previousCache;
        }
      };
      const readOnly = (): never => { throw new Error("A PDF export session snapshot is read-only."); };
      let baseScene: Promise<VectorScene> | undefined;
      const owner: EditorSession = {
        sourceScene, sourcePdf, revision: targetRevision,
        getState: () => copy(snapshotStatus),
        getObjects: objectOptions => withSnapshot(() => session.getObjects(objectOptions)),
        getObject: id => withSnapshot(() => session.getObject(id)),
        getObjectBounds: id => withSnapshot(() => session.getObjectBounds(id)),
        getSelection: () => snapshot.selection.slice(),
        getSelectionBounds: () => withSnapshot(() => session.getSelectionBounds()),
        getSelectionFrame: () => withSnapshot(() => session.getSelectionFrame()),
        getFieldValues: () => new Map([...snapshot.fields].map(([name, value]) => [name, copy(value)])),
        getSourceEdits: () => [...snapshot.edits.values()].map(copy),
        getAnnotationEdits: () => [...snapshot.annotationEdits.values()].map(copy),
        getPages: () => withSnapshot(() => session.getPages()),
        async getScene(sceneOptions = {}) {
          sceneOptions.signal?.throwIfAborted(); saveOptions.signal?.throwIfAborted();
          if (sceneOptions.includeObjects !== false) {
            createLoadProgressReporter(sceneOptions.onProgress).complete({ sourceType: "scene", unit: "pages", processed: pageCount, total: pageCount, pageCount });
            return scene;
          }
          // getScene captures its state before its first await. Restore the
          // live session immediately; the asynchronous compile keeps only
          // this immutable snapshot and never writes the full-scene cache.
          if (!baseScene) {
            baseScene = withSnapshot(() => session.getScene({ signal: sceneOptions.signal ?? saveOptions.signal, onProgress: sceneOptions.onProgress, preview: false, includeObjects: false }));
            void baseScene.catch(() => { baseScene = undefined; });
            return baseScene;
          }
          const result = await waitForLoad(baseScene, sceneOptions.signal ?? saveOptions.signal);
          createLoadProgressReporter(sceneOptions.onProgress).complete({ sourceType: "scene", unit: "pages", processed: pageCount, total: pageCount, pageCount }); return result;
        },
        select: readOnly, selectPrimitives: readOnly, selectAnnotations: readOnly, selectArea: readOnly,
        addObject: readOnly, updateObject: readOnly, transformSelection: readOnly, setPreviewTransform: readOnly,
        deleteSelection: readOnly, cloneSelection: readOnly, groupSelection: readOnly, ungroupSelection: readOnly,
        setFieldValue: readOnly, transaction: readOnly, undo: readOnly, redo: readOnly, markSaved: readOnly,
        rotatePages: readOnly, removePages: readOnly, insertPdf: readOnly,
        subscribe: readOnly, savePdf: readOnly, saveHep: readOnly, dispose: readOnly
      };
      progress.report(.4, { stage: "pdf-page", sourceType: "scene", unit: "pages", processed: 0, total: pageCount, pageCount });
      saveOptions.signal?.throwIfAborted();
      const persistenceOptions = { ...saveOptions, onProgress: (payload: PDFLoadProgress) => {
        if (!saveOptions.signal?.aborted) persistenceProgress.report(payload.value, payload);
      } };
      const blob = options.savePdf ? await options.savePdf(scene, owner, persistenceOptions)
        : await (await import("./editorPdfWriter")).writeScenePdf(scene, persistenceOptions);
      saveOptions.signal?.throwIfAborted();
      progress.complete({ sourceType: "scene", unit: "pages", processed: pageCount, total: pageCount, pageCount });
      if (!disposed && revision === targetRevision) session.markSaved(); return blob;
    },
    async saveHep(saveOptions = {}) {
      assertLive(); saveOptions = { ...saveOptions, signal: saveOptions.signal ? AbortSignal.any([saveOptions.signal, lifetime.signal]) : lifetime.signal };
      saveOptions.signal!.throwIfAborted();
      const progress = createLoadProgressReporter(saveOptions.onProgress), compileProgress = progress.child(0, .3), persistenceProgress = progress.child(.3, 1);
      const targetRevision = revision, scene = await session.getScene({ ...saveOptions, preview: false,
        onProgress: payload => compileProgress.report(payload.value, { ...payload, stage: payload.stage === "complete" ? "compile" : payload.stage }) }), { buildHep } = await import("./hepBuilder");
      saveOptions.signal?.throwIfAborted();
      // Extra form controls are editor state, not an expansion of HEP's
      // established compact field metadata schema.
      const exportScene: VectorScene = scene.annotations?.some(annotation => annotation.field && ["maxLength", "options", "selectedIndices", "alignment", "textStyle", "onValue", "appearanceState"].some(key => key in annotation.field!))
        ? { ...scene, annotations: scene.annotations.map(annotation => {
          if (!annotation.field) return annotation;
          const { type, name, flags, value, defaultValue } = annotation.field;
          return { ...annotation, field: { ...(type !== undefined ? { type } : {}), ...(name !== undefined ? { name } : {}), flags,
            ...(value !== undefined ? { value } : {}), ...(defaultValue !== undefined ? { defaultValue } : {}) } };
        }) } : scene;
      const blob = await buildHep(exportScene, { ...saveOptions, sourceLabel: saveOptions.sourceLabel ?? options.sourceLabel,
        onProgress: payload => { if (!saveOptions.signal?.aborted) persistenceProgress.report(payload.value, payload); } });
      saveOptions.signal?.throwIfAborted(); progress.complete({ sourceType: "hep", unit: "pages", processed: pageCount, total: pageCount, pageCount });
      if (!disposed && revision === targetRevision) session.markSaved(); return blob;
    },
    dispose() { if (disposed) return; disposed = true; lifetime.abort(); listeners.clear(); undoStack.length = redoStack.length = 0; sourceObjects.clear(); cache = null; frameCache = null; sourcePartition = null; state = { objects: new Map(), fields: new Map(), edits: new Map(), annotationEdits: new Map(), selection: [], identity: {} }; }
  };
  return session;
}
