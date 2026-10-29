import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import { composeOverlappingVectorScenes } from "./pdfVectorExtractor";
import { editorObjectHasVisiblePaint } from "./editorObjectOpacity";
import { getScenePrimitive, getSceneAnnotationRuns, type PrimitiveRef } from "./scenePrimitives";
import { defaultVectorDrawRuns } from "./vectorDrawOrder";
import { PAGE_PRIMITIVE_KINDS, ScenePageViews, scenePrimitiveCounts } from "./scenePageViews";
import type { ScenePaintNode } from "./scenePaintGraph";
import type { EditorAnnotationEdit, EditorFieldValue, EditorMatrix, EditorObject, EditorObjectInput, EditorSession, EditorSessionOptions,
  EditorSourceEdit, EditorSourceObject, EditorState, EditorSelectionFrame, EditorLayerEdits, EditorStackingAction } from "./editorTypes";
import { editorPaintIdentity, editorAuthoredOwner, editorPaintOwnerObject, setEditorPaintIdentity, remapEditorPaintIdentity, composeEditorPaintIdentity } from "./editorPaintIdentity";
import { prepareEditorTranslationPreview } from "./editorTranslationPreview";
import { editorCloneOwner } from "./editorObjectOrder";
import { editorLayerCatalog, editorLayer, createEditorLayer, updateEditorLayer, moveEditorLayer, setEditorLayerOrder, removeEditorLayer, importEditorLayerCondition } from "./editorLayers";
import { getOptionalContentGroupIds, createDefaultOptionalContentSnapshot } from "./optionalContent";
import { applyEditorSceneLayers, assignEditorGeometryLayer, refreshEditorSceneLayerDefaults, isEditorLayerCompositingUnit,
  createEditorLayerVisibility, createEditorObjectOrderSchedule, reorderEditorSceneLayers, applyEditorObjectOrdering, detachEditorGeometryAnnotationLayers, captureEditorAnnotationLayerCondition } from "./editorLayerScene";

interface LayerSnapshot {
  catalog: EditorLayerEdits["catalog"];
  removals: EditorLayerEdits["removals"];
  sourceAssignments: Map<string, EditorLayerEdits["sourceAssignments"][number]>;
  annotationAssignments: Map<string, string | null>;
  stackingChanged: boolean;
  objectOrder?: readonly string[];
}
import { bakeEditorAnnotationEdits, bakeEditorSourceScene, compactEditorScene, composeEditorPage, EDITOR_IDENTITY, editorMatrix, editorMatrixIsIdentity,
  editorRefKey, editorTransformBounds, editorUnionBounds, invertEditorMatrix, multiplyEditorMatrices, retainEditorAnnotationPlacements, transformWholeEditorScene } from "./editorScene";
import { compileEditorObjectGeometry, editorArrowHeadPoints } from "./editorSceneObjects";
import { waitForLoad } from "./loadCancellation";
import { createLoadProgressReporter, type PDFLoadProgress } from "./loadProgress";
import { createEditorGlyphStoreCache } from "./editorGlyphStoreCache";
import { editorClipboardStore, releaseEditorClipboard, registerEditorCapturedSourceReader, type EditorCapturedSource, type EditorClipboardSnapshot } from "./editorClipboard";

interface Snapshot {
  objects: Map<string, EditorObject>;
  edits: Map<string, EditorSourceEdit>;
  annotationEdits: Map<string, EditorAnnotationEdit>;
  fields: Map<string, EditorFieldValue>;
  layers: LayerSnapshot;
  selection: string[];
  selectionBasis?: EditorMatrix;
  identity: object;
}
function copy<T>(value: T): T { return structuredClone(value); }
const orderRestorers = new WeakMap<EditorSession, (tokens: readonly string[], stackingChanged?: boolean) => void>();
const orderReaders = new WeakMap<EditorSession, () => readonly string[]>();
const orderedSourceReaders = new WeakMap<EditorSession, (options: { signal?: AbortSignal }) => Promise<VectorScene>>();
/** Private document-reseed hook; order stays in editor snapshots, never scene/HEP data. */
export function restoreEditorObjectOrder(session: EditorSession, tokens: readonly string[], stackingChanged?: boolean): void {
  const restore = orderRestorers.get(session); if (!restore) throw new TypeError("Object order can only be restored to an editor runtime session."); restore(tokens, stackingChanged);
}
export function getEditorCurrentObjectOrder(session: EditorSession): readonly string[] {
  const read = orderReaders.get(session); if (!read) throw new TypeError("Object order can only be read from an editor runtime session."); return read();
}
/** Capture only original content and source clones before ordinary author geometry is compiled. */
export function getEditorOrderedSourceScene(session: EditorSession, options: { signal?: AbortSignal } = {}): Promise<VectorScene> {
  const read = orderedSourceReaders.get(session); if (!read) throw new TypeError("Ordered source can only be read from an editor runtime session."); return read(options);
}
function finite(value: unknown, name: string, minimum?: number): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || (minimum !== undefined && value < minimum)) throw new RangeError(`${name} must be a finite number${minimum === undefined ? "" : ` at least ${minimum}`}.`);
}
function validateObject(object: EditorObject, pageCount: number): void {
  if (!object.id || typeof object.id !== "string") throw new TypeError("Editor objects require an ID.");
  if (!Number.isSafeInteger(object.pageIndex) || object.pageIndex < 0 || object.pageIndex >= pageCount) throw new RangeError("Editor object references an unknown page.");
  editorMatrix(object.transform);
  if (object.opacity !== undefined) { finite(object.opacity, "Opacity", 0); if (object.opacity > 1) throw new RangeError("Opacity must not exceed one."); }
  if ((object.kind === "shape" || object.kind === "ink" || object.kind === "signature") && object.fillOpacity !== undefined) {
    finite(object.fillOpacity, "Fill opacity", 0); if (object.fillOpacity > 1) throw new RangeError("Fill opacity must not exceed one.");
  }
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
  const initialCatalog = editorLayerCatalog(sourceScene.optionalContent);
  const initialLayers: LayerSnapshot = { catalog: initialCatalog, removals: [], sourceAssignments: new Map(), annotationAssignments: new Map(), stackingChanged: false };
  let state: Snapshot = { objects: new Map(), edits: new Map(), annotationEdits: new Map(), fields: new Map(), layers: initialLayers, selection: [], identity: {} };
  let activeLayer: string | null = null, nextLayerId = 0, layerRevision = 0;
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
  let committedSceneCache: { identity: object; scene: VectorScene } | null = null;
  let translationPreviewCache: { identity: object; selection: string; promise: Promise<ReturnType<typeof prepareEditorTranslationPreview>> } | null = null;
  let frameCache: { snapshot: Snapshot; frame: EditorSelectionFrame | null } | null = null;
  const compiled = new WeakMap<EditorObject, Promise<VectorScene>>();
  const geometryOrigins = new WeakMap<EditorObject, EditorObject>();
  const capturedSources = new WeakMap<EditorObject, EditorCapturedSource>();
  const capturedSource = (object: EditorObject): EditorCapturedSource | undefined => capturedSources.get(geometryOrigins.get(object) ?? object);
  const glyphStores = createEditorGlyphStoreCache(sourceScene);
  const reuseGlyphStores = (scene: VectorScene): VectorScene => {
    const shared = glyphStores.reuse(scene);
    if (shared.textGlyphMetaA === scene.textGlyphMetaA && shared.textGlyphMetaB === scene.textGlyphMetaB &&
        shared.textGlyphSegmentsA === scene.textGlyphSegmentsA && shared.textGlyphSegmentsB === scene.textGlyphSegmentsB) return scene;
    const result = { ...scene, ...shared }; retainEditorAnnotationPlacements(scene, result); return result;
  };
  const lifetime = new AbortController();
  const sourcePdf = options.sourcePdf?.slice();
  const assertLive = () => { if (disposed) throw new Error("Editor session is disposed."); };
  const getState = (): EditorState => ({ revision, dirty: state.identity !== savedIdentity, canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0, selection: state.selection.slice(), previewing: previewTransform !== null });
  const emit = () => { const value = getState(); for (const listener of listeners) { try { listener(value); } catch { /* Observers cannot interrupt an edit. */ } } };
  const change = (operation: () => void) => {
    assertLive(); const before = state;
    state = { ...state, objects: new Map(state.objects), edits: new Map(state.edits), annotationEdits: new Map(state.annotationEdits), fields: new Map(state.fields), selection: state.selection.slice(), selectionBasis: state.selectionBasis, identity: {} };
    try { operation(); } catch (error) { state = before; throw error; }
    if (state.layers !== before.layers) layerRevision++;
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
    if (capturedSource(object)) return editorTransformBounds(object.bounds, object.transform);
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
      const captured = capturedSource(object);
      if (captured) return { ...captured.frame, transform: multiplyEditorMatrices(object.transform, captured.frame.transform) };
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
        if (isEditorLayerCompositingUnit(node)) { if (!promoted) promoted = { id: `source-group:${path}${index}`, nodes: [node] }; return; }
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
  const layerCache = new WeakMap<LayerSnapshot, EditorLayerEdits>();
  const layerEdits = (snapshot = state): EditorLayerEdits => {
    let result = layerCache.get(snapshot.layers);
    if (!result) {
      const layers = snapshot.layers;
      result = { catalog: layers.catalog, catalogChanged: layers.catalog !== initialCatalog,
        removals: layers.removals, removedLayerIds: layers.removals.map(value => value.id), stackingChanged: layers.stackingChanged,
        objectOrderChanged: layers.objectOrder !== undefined, objectOrder: layers.objectOrder,
        sourceAssignments: [...layers.sourceAssignments.values()],
        annotationAssignments: [...layers.annotationAssignments].map(([id, layerId]) => ({ id, layerId })) };
      layerCache.set(layers, result);
    }
    return result;
  };
  const visibilityCache = new WeakMap<LayerSnapshot, WeakMap<Snapshot["objects"], ReturnType<typeof createEditorLayerVisibility>>>();
  const orderSchedules = new WeakMap<LayerSnapshot, { key: string; value: ReturnType<typeof createEditorObjectOrderSchedule> }>();
  const sourceOrderOrigins = new WeakMap<EditorObject, number>(); let nextSourceOrderOrigin = 0;
  const visibility = () => {
    let objects = visibilityCache.get(state.layers); if (!objects) visibilityCache.set(state.layers, objects = new WeakMap());
    let result = objects.get(state.objects);
    if (!result) {
      const layers = state.layers, edits = layerEdits(), models = [...state.objects.values()].filter(object => object.kind !== "group");
      const additions = models.map(object => ({ id: object.id, pageIndex: object.pageIndex, layerIds: objectLayerIds(object.id),
        layerCondition: object.layerCondition,
        ...(object.kind === "source" && object.layerId === undefined && object.layerCondition === undefined ? { sourcePrimitives: object.primitives, sourceLayerEdits: objectLayerEdits(object.id) } : {}) }));
      const excluded = new Set([...state.edits.values()].filter(edit => edit.deleted).map(edit => editorRefKey(edit.ref)).concat([...state.annotationEdits.values()].filter(edit => edit.deleted).map(edit => `annotation:${edit.id}`)));
      // Positions, formatting and opacity cannot change sibling paint slots.
      // Share the large source schedule across those undo snapshots instead of
      // retaining another complete unit/rank table for every object movement.
      const layout = JSON.stringify([models.map((object, index) => {
        let origin: number | undefined;
        if (object.kind === "source") { const source = geometryOrigins.get(object) ?? object; origin = sourceOrderOrigins.get(source); if (origin === undefined) sourceOrderOrigins.set(source, origin = ++nextSourceOrderOrigin); }
        return [object.id, object.pageIndex, additions[index].layerIds, object.layerCondition, origin];
      }), [...excluded].sort()]);
      result = createEditorLayerVisibility(sourceScene, edits, additions, excluded, () => {
        let cached = orderSchedules.get(layers);
        if (!cached || cached.key !== layout) { cached = { key: layout, value: createEditorObjectOrderSchedule(sourceScene, edits, additions, excluded) }; orderSchedules.set(layers, cached); }
        return cached.value;
      });
      objects.set(state.objects, result); }
    return result;
  };
  const remapLayer = (id: string): string | null => {
    let result: string | null = id;
    for (const removal of state.layers.removals) if (result === removal.id) result = removal.targetLayerId;
    return result;
  };
  const sourceLayerIds = (ref: PrimitiveRef, captured?: EditorLayerEdits): string[] => {
    const assignment = captured ? captured.sourceAssignments.find(value => editorRefKey(value.ref) === editorRefKey(ref)) : state.layers.sourceAssignments.get(editorRefKey(ref)), info = getScenePrimitive(sourceScene, ref);
    const annotationAssignment = info.annotationId ? captured ? captured.annotationAssignments.find(value => value.id === info.annotationId)?.layerId : state.layers.annotationAssignments.get(info.annotationId) : undefined;
    const assigned = assignment ? assignment.layerId : annotationAssignment;
    return assigned !== undefined ? assigned === null ? [] : [remapLayer(assigned)].filter((id): id is string => id !== null) : [...new Set(info.optionalContent.layerIds.map(remapLayer)
      .filter((id): id is string => id !== null && state.layers.catalog.groups.some(group => group.id === id && !group.annotationId)))];
  };
  const objectLayerIds = (id: string): string[] => {
    const object = internalObject(id);
    if (object.kind === "group") return [...new Set(object.children.flatMap(objectLayerIds))];
    if (object.layerCondition !== undefined) return getOptionalContentGroupIds(state.layers.catalog, object.layerCondition).filter(id => !state.layers.catalog.groups.find(group => group.id === id)?.annotationId);
    if (object.kind !== "source" || state.objects.has(id)) {
      if (object.layerId !== undefined) return object.layerId === null ? [] : [object.layerId];
      if (object.kind !== "source") return [];
    }
    const captured = state.objects.has(id) ? cloneLayers.get(geometryOrigins.get(object) ?? object) : undefined;
    if (object.primitives.length) return [...new Set(object.primitives.flatMap(ref => sourceLayerIds(ref, captured)))];
    const assigned = object.annotationId ? state.layers.annotationAssignments.get(object.annotationId) : undefined;
    if (assigned !== undefined) return assigned === null ? [] : [assigned];
    const annotation = sourceScene.annotations?.find(value => value.id === object.annotationId);
    return getOptionalContentGroupIds(state.layers.catalog, annotation?.optionalContent).filter(id => !state.layers.catalog.groups.find(group => group.id === id)?.annotationId);
  };
  const conditionVisibility = new WeakMap<LayerSnapshot, ReturnType<typeof createDefaultOptionalContentSnapshot>>();
  const visibleCondition = (index: number): boolean => {
    let snapshot = conditionVisibility.get(state.layers);
    if (!snapshot) { snapshot = createDefaultOptionalContentSnapshot({ ...sourceScene, optionalContent: state.layers.catalog }); conditionVisibility.set(state.layers, snapshot); }
    return snapshot.conditions[index] !== 0;
  };
  const objectVisible = (id: string): boolean => {
    const object = internalObject(id);
    if (objectDeleted(object)) return false;
    if (object.kind === "group") return object.children.some(objectVisible);
    if (object.kind !== "source" || state.objects.has(id)) {
      if (!editorObjectHasVisiblePaint(object)) return false;
      if (object.layerCondition !== undefined) return visibleCondition(object.layerCondition);
      if (object.layerId !== undefined) return object.layerId === null || editorLayer(state.layers.catalog, object.layerId).defaultVisible;
      if (object.kind !== "source") return true;
    }
    if (object.annotationId && !object.primitives.length) return visibility().isAnnotationVisible(object.annotationId);
    const sourceVisibility = state.objects.has(id) ? cloneVisibility(objectLayerEdits(id)) : visibility();
    return object.primitives.some(ref => (state.objects.has(id) || !state.edits.get(editorRefKey(ref))?.deleted) && sourceVisibility.isPrimitiveVisible(ref));
  };
  const objectLayerCondition = (id: string): { catalog: EditorLayerEdits["catalog"]; condition?: number } => {
    const object = internalObject(id), catalog = state.layers.catalog;
    if (object.kind === "group") throw new TypeError("A temporary group may contain several different layer memberships.");
    if (object.layerCondition !== undefined) return { catalog, condition: object.layerCondition };
    if (object.layerId !== undefined || object.kind !== "source") {
      if (object.layerId == null) return { catalog };
      const conditions = [...catalog.conditions, { kind: "group" as const, groupId: object.layerId }];
      return importEditorLayerCondition(catalog, { ...catalog, conditions }, conditions.length - 1);
    }
    if (!object.annotationId) throw new TypeError("Exact membership copying requires an annotation or an authored object.");
    return captureEditorAnnotationLayerCondition(sourceScene, objectLayerEdits(id), object.annotationId);
  };
  const validateObjectLayer = (object: EditorObject): void => {
    if (object.layerCondition !== undefined) {
      if (object.kind === "group") throw new TypeError("Assign layer membership to a temporary group's contents.");
      importEditorLayerCondition(state.layers.catalog, state.layers.catalog, object.layerCondition);
      delete object.layerId;
    } else if (object.layerId != null) editorLayer(state.layers.catalog, object.layerId);
  };
  const catalogChange = (catalog: EditorLayerEdits["catalog"], stacking = false): void => {
    if (catalog === state.layers.catalog && !stacking) return;
    change(() => { state.layers = { ...state.layers, catalog, stackingChanged: state.layers.stackingChanged || stacking };
      state.selection = state.selection.filter(objectVisible); state.selectionBasis = undefined; });
  };
  const cloneLayers = new WeakMap<EditorObject, EditorLayerEdits>();
  const cloneEditCache = new WeakMap<LayerSnapshot, WeakMap<EditorLayerEdits, EditorLayerEdits>>();
  const cloneVisibilities = new WeakMap<EditorLayerEdits, ReturnType<typeof createEditorLayerVisibility>>();
  const cloneVisibility = (edits: EditorLayerEdits) => {
    let result = cloneVisibilities.get(edits); if (!result) { result = createEditorLayerVisibility(sourceScene, edits); cloneVisibilities.set(edits, result); } return result;
  };
  const objectLayerEdits = (id: string, snapshot = state): EditorLayerEdits => {
    const object = snapshot.objects.get(id) ?? sourceObject(id), captured = cloneLayers.get(geometryOrigins.get(object) ?? object);
    if (!captured || object.kind !== "source") return layerEdits(snapshot);
    let entries = cloneEditCache.get(snapshot.layers); if (!entries) cloneEditCache.set(snapshot.layers, entries = new WeakMap());
    let result = entries.get(captured);
    if (!result) {
      const retarget = (id: string | null): string | null => { for (const removal of snapshot.layers.removals) if (id === removal.id) id = removal.targetLayerId; return id; };
      result = { ...layerEdits(snapshot), objectOrder: captured.objectOrder, objectOrderChanged: captured.objectOrderChanged,
        sourceAssignments: captured.sourceAssignments.map(value => ({ ...value, layerId: retarget(value.layerId) })),
        annotationAssignments: captured.annotationAssignments.map(value => ({ ...value, layerId: retarget(value.layerId) })) };
      entries.set(captured, result);
    }
    return result;
  };
  const appliedLayers = new WeakMap<LayerSnapshot, Promise<VectorScene>>();
  const appliedCloneLayers = new WeakMap<EditorLayerEdits, Promise<VectorScene>>();
  const appliedLayerSource = (snapshot: Snapshot, signal: AbortSignal): Promise<VectorScene> => {
    let result = appliedLayers.get(snapshot.layers);
    if (!result) {
      const edits = layerEdits(snapshot);
      result = !edits.catalogChanged && !edits.objectOrderChanged && !edits.sourceAssignments.length && !edits.annotationAssignments.length
        ? Promise.resolve(sourceScene) : applyEditorSceneLayers(sourceScene, edits, { signal: lifetime.signal, onDiagnostic: options.onDiagnostic });
      appliedLayers.set(snapshot.layers, result); void result.catch(() => appliedLayers.delete(snapshot.layers));
    }
    return waitForLoad(result, signal);
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
  const selectedPaintOwners = (): Set<string> => {
    const owners = new Set<string>(), sourceIdentity = editorPaintIdentity(sourceScene);
    for (const id of expand(state.selection)) {
      if (!objectVisible(id)) continue;
      const object = internalObject(id);
      if (object.kind === "source" && !state.objects.has(id)) {
        if (object.primitives.length) object.primitives.forEach(ref => owners.add(sourceIdentity(ref)));
        else if (object.annotationId) owners.add(`annotation:${object.annotationId}`);
      } else owners.add(id);
    }
    return owners;
  };
  const arrangeSelection = (action: EditorStackingAction) => {
    assertLive();
    if (!["send-to-back", "bring-to-front", "bring-forward", "send-backward"].includes(action)) throw new TypeError("Unknown stacking action.");
    const owners = selectedPaintOwners();
    return owners.size ? visibility().getObjectOrder().arrange(owners, action) : { changed: false, order: [] };
  };
  const captureSelection = async (cut: boolean, suppliedSignal?: AbortSignal): Promise<number> => {
    assertLive(); const signal = suppliedSignal ? AbortSignal.any([suppliedSignal, lifetime.signal]) : lifetime.signal;
    signal.throwIfAborted();
    const snapshot = state, roots = snapshot.selection.slice(); if (!roots.length) return 0;
    const store = editorClipboardStore(session), sequence = ++store.sequence;
    const objects = new Map<string, EditorObject>(), frames = new Map<string, EditorSelectionFrame>();
    const visit = (id: string) => {
      if (objects.has(id)) return;
      const object = internalObject(id); objects.set(id, copy(object));
      if (object.kind === "group") object.children.forEach(visit);
      else if (object.kind === "source") frames.set(id, copy(objectFrame(id, snapshot)));
    };
    roots.forEach(visit);
    const basis = copy(selectionFrame(snapshot)?.transform), sources = new Map<string, EditorCapturedSource>();
    if (frames.size) {
      // getScene captures the current snapshot before its first await. Copy the
      // actual appearance, including current form values, clips and shared resources.
      const canonical = await session.getScene({ preview: false, signal }), resolve = editorPaintIdentity(canonical);
      const originalIdentity = editorPaintIdentity(sourceScene), counts = scenePrimitiveCounts(canonical), appearances = getSceneAnnotationRuns(canonical);
      for (const [id, frame] of frames) {
        signal.throwIfAborted(); const object = objects.get(id) as EditorSourceObject;
        const keep = Object.fromEntries(PAGE_PRIMITIVE_KINDS.map(kind => [kind, new Set<number>()])) as Record<PrimitiveRef["kind"], Set<number>>;
        if (!snapshot.objects.has(id) && object.annotationId) {
          for (const run of appearances.get(object.annotationId) ?? []) for (let index = run.first; index < run.first + run.count; index++) keep[run.kind].add(index);
        } else {
          const owners = new Set(object.primitives.map(originalIdentity));
          if (!snapshot.objects.has(id)) {
            const selected = new Set(object.primitives.map(editorRefKey)), originalCounts = scenePrimitiveCounts(sourceScene);
            for (const kind of PAGE_PRIMITIVE_KINDS) for (let index = 0; index < originalCounts[kind]; index++) {
              const ref = { kind, index };
              if (owners.has(originalIdentity(ref)) && !selected.has(editorRefKey(ref))) throw new Error("This content shares an inseparable source identity. Select the complete source group before copying.");
            }
          }
          for (const kind of PAGE_PRIMITIVE_KINDS) for (let index = 0; index < counts[kind]; index++) {
            const owner = resolve({ kind, index });
            if (snapshot.objects.has(id) ? editorPaintOwnerObject(owner) === id : owners.has(owner)) keep[kind].add(index);
          }
        }
        const geometry = detachEditorGeometryAnnotationLayers(compactEditorScene(canonical, keep));
        geometry.annotations = undefined; geometry.markedContent = undefined; geometry.structureElements = undefined;
        sources.set(id, { scene: geometry, frame });
        object.bounds = editorTransformBounds(frame.bounds, frame.transform); object.transform = EDITOR_IDENTITY; object.primitives = []; object.isClone = true;
        delete object.annotationId;
      }
    }
    signal.throwIfAborted(); assertLive();
    if (store.sequence !== sequence) throw new DOMException("A newer clipboard operation superseded this capture.", "AbortError");
    if (cut && (state.identity !== snapshot.identity || JSON.stringify(state.selection) !== JSON.stringify(roots))) {
      throw new Error("The selection or document changed while copying. Cut was cancelled; the selected objects are unchanged.");
    }
    const captured: EditorClipboardSnapshot = { source: sourceScene, roots, objects, sources, basis, cut, pastes: 0 }, previous = store.value;
    store.value = captured;
    try { if (cut) session.deleteSelection(); else emit(); }
    catch (error) { store.value = previous; throw error; }
    return roots.length;
  };
  const capturedSourceScene = (id: string, snapshot = state): VectorScene | undefined => {
    const object = snapshot.objects.get(id), captured = object && capturedSource(object);
    return object && captured ? transformWholeEditorScene(captured.scene, object.transform, lifetime.signal, options.onDiagnostic) : undefined;
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
      for (const object of session.getObjects({ pageIndex: selectionOptions.pageIndex })) if (objectVisible(object.id) && hit(objectBounds(object.id))) found.add(object.id);
      const counts = scenePrimitiveCounts(sourceScene);
      for (const annotation of sourceScene.annotations ?? []) {
        if (!session.isAnnotationVisible(annotation.id) || annotation.subtype === "Popup" ||
          (selectionOptions.pageIndex !== undefined && annotation.pageIndex !== selectionOptions.pageIndex)) continue;
        if ((getSceneAnnotationRuns(sourceScene).get(annotation.id)?.length ?? 0) > 0) continue;
        const id = `annotation:${annotation.id}`, object = sourceObject(id);
        if (!objectDeleted(object) && hit(objectBounds(id))) found.add(id);
      }
      for (const kind of PAGE_PRIMITIVE_KINDS) for (let index = 0; index < counts[kind]; index++) {
        const ref = { kind, index }, edit = state.edits.get(editorRefKey(ref)); if (edit?.deleted) continue;
        if (!session.isPrimitiveVisible(ref)) continue;
        if (selectionOptions.pageIndex !== undefined) { sourcePartition ??= new ScenePageViews(sourceScene); if (sourcePartition.owners[kind][index] !== selectionOptions.pageIndex) continue; }
        if (hit(editorTransformBounds(getScenePrimitive(sourceScene, ref).bounds, edit?.transform ?? EDITOR_IDENTITY))) found.add(promoteSource(ref));
      }
      selection([...found], selectionOptions);
    },
    addObject(input) {
      assertLive(); const id = input.id ?? nextObjectId();
      if (!sourceIdIsDeleted(id) || state.objects.has(id) || sourceObjects.has(id) || /^(source:|annotation:|source-group:)/.test(id)) throw new RangeError("Editor object ID already exists or is reserved.");
      const object = copy({ ...input, id, transform: input.transform ?? EDITOR_IDENTITY }) as EditorObject;
      if (object.kind !== "source" && object.kind !== "group") {
        if (object.layerId === undefined && object.layerCondition === undefined) {
          object.layerId = session.getActiveLayer();
          if (object.layerId !== null && !editorLayer(state.layers.catalog, object.layerId).defaultVisible) throw new Error("Show the active layer before adding content.");
        }
      }
      validateObjectLayer(object);
      if (object.kind === "text" && object.runs !== undefined) object.text = object.runs.map(run => run.text).join("");
      validateObject(object, pageCount);
      if (object.kind === "source") { object.isClone = true; for (const ref of object.primitives) getScenePrimitive(sourceScene, ref); }
      if (object.kind === "group") object.children.forEach(internalObject);
      if (object.kind === "source") cloneLayers.set(object, layerEdits());
      change(() => { state.objects.set(id, object); if (object.layerId != null || object.layerCondition !== undefined) state.layers = { ...state.layers }; state.selection = [id]; state.selectionBasis = undefined; }); return id;
    },
    updateObject(id, patch) {
      assertLive(); const original = internalObject(id);
      if (!state.objects.has(id) && original.kind === "source") throw new TypeError("Original content is updated through selection transforms.");
      const object = copy({ ...original, ...patch, id, kind: original.kind }) as EditorObject;
      if (Object.hasOwn(patch, "layerId") && !Object.hasOwn(patch, "layerCondition")) delete object.layerCondition;
      if (object.kind === "text") {
        if (Object.hasOwn(patch, "text") && !Object.hasOwn(patch, "runs")) delete object.runs;
        if (object.runs !== undefined) object.text = object.runs.map(run => run.text).join("");
      }
      validateObject(object, pageCount);
      validateObjectLayer(object);
      if (object.kind === "group") throw new TypeError("Use group and ungroup operations to change group membership.");
      if (Object.keys(patch).every(key => key === "transform" || key === "pageIndex")) geometryOrigins.set(object, geometryOrigins.get(original) ?? original);
      const inherited = cloneLayers.get(original); if (inherited) cloneLayers.set(object, inherited);
      const captured = capturedSource(original); if (captured) capturedSources.set(object, captured);
      change(() => { state.objects.set(id, object); if (object.layerId !== original.layerId || object.layerCondition !== original.layerCondition) state.layers = { ...state.layers }; });
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
        if (expand(state.selection).some(id => objectLayerIds(id).length)) state.layers = { ...state.layers };
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
          const captured = capturedSource(original); if (captured) capturedSources.set(clone, captured);
          if (clone.kind === "source") cloneLayers.set(clone, cloneLayers.get(geometryOrigins.get(original) ?? original) ?? layerEdits());
          change(() => { state.objects.set(clone.id, clone); if (objectLayerIds(id).length) state.layers = { ...state.layers }; }); clones.push(clone.id);
        }
        state.selection = clones; state.selectionBasis = clones.length > 1 ? basis : undefined;
        session.transformSelection([1, 0, 0, 1, offset[0], offset[1]]);
      }); return clones;
    },
    copySelection(clipboardOptions = {}) { return captureSelection(false, clipboardOptions.signal); },
    cutSelection(clipboardOptions = {}) { return captureSelection(true, clipboardOptions.signal); },
    canPaste() { assertLive(); return editorClipboardStore(session).value !== null; },
    pasteSelection(pasteOptions = {}) {
      assertLive(); const store = editorClipboardStore(session), captured = store.value;
      if (!captured) return [];
      if (captured.source !== sourceScene) throw new Error("Document pages changed since these objects were copied. Copy them again, or undo the page change before pasting.");
      const step = captured.cut ? 0 : captured.pastes + 1, offset = pasteOptions.offset ?? [12 * step, -12 * step];
      finite(offset[0], "Paste X offset"); finite(offset[1], "Paste Y offset");
      const destination = session.getActiveLayer(); if (destination !== null) editorLayer(state.layers.catalog, destination);
      const ids = new Map([...captured.objects.keys()].map(id => [id, nextObjectId()])), additions: EditorObject[] = [];
      for (const [id, original] of captured.objects) {
        const object = copy(original); object.id = ids.get(id)!;
        if (object.kind === "group") { object.children = object.children.map(child => ids.get(child)!); delete object.layerId; delete object.layerCondition; }
        else { object.layerId = destination; delete object.layerCondition; }
        validateObject(object, pageCount);
        const source = captured.sources.get(id); if (source) capturedSources.set(object, source);
        additions.push(object);
      }
      const roots = captured.roots.map(id => ids.get(id)!);
      session.transaction("Paste", () => {
        change(() => {
          for (const object of additions) state.objects.set(object.id, object);
          state.layers = { ...state.layers }; state.selection = roots; state.selectionBasis = roots.length > 1 ? captured.basis : undefined;
        });
        session.transformSelection([1, 0, 0, 1, offset[0], offset[1]]);
        state.selection = state.selection.filter(objectVisible);
      });
      store.value = { ...captured, pastes: captured.pastes + 1 };
      return roots;
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
    getLayers() { assertLive(); return copy(state.layers.catalog.groups.filter(group => group.annotationId === undefined)); },
    getLayerOrder() { assertLive(); return copy(state.layers.catalog.order); },
    createLayer(input) {
      assertLive(); let id: string;
      do { id = `editor:layer:${++nextLayerId}`; } while (state.layers.catalog.groups.some(group => group.id === id) || state.layers.removals.some(value => value.id === id));
      catalogChange(createEditorLayer(state.layers.catalog, id, input)); return id;
    },
    updateLayer(id, patch) { assertLive(); catalogChange(updateEditorLayer(state.layers.catalog, id, patch)); },
    moveLayer(id, position) {
      assertLive(); const catalog = moveEditorLayer(state.layers.catalog, id, position);
      if (catalog !== state.layers.catalog) catalogChange(catalog, true);
    },
    setLayerOrder(order) {
      assertLive(); const catalog = setEditorLayerOrder(state.layers.catalog, order);
      if (catalog !== state.layers.catalog) catalogChange(catalog, true);
    },
    canReorderSelection(action) { return arrangeSelection(action).changed; },
    reorderSelection(action) {
      const result = arrangeSelection(action); if (!result.changed) return;
      change(() => { state.layers = { ...state.layers, objectOrder: result.order }; });
    },
    removeLayer(id, removal = {}) {
      assertLive(); const targetLayerId = removal.targetLayerId ?? null;
      const catalog = removeEditorLayer(state.layers.catalog, id, targetLayerId);
      change(() => {
        const sourceAssignments = new Map([...state.layers.sourceAssignments].map(([key, value]) => [key, value.layerId === id ? { ...value, layerId: targetLayerId } : value]));
        const annotationAssignments = new Map([...state.layers.annotationAssignments].map(([key, value]) => [key, value === id ? targetLayerId : value]));
        state.layers = { ...state.layers, catalog, sourceAssignments, annotationAssignments,
          removals: [...state.layers.removals, { id, targetLayerId }] };
        for (const [key, object] of state.objects) if (object.layerId === id) {
          const next = { ...object, layerId: targetLayerId }; state.objects.set(key, next);
          const inherited = cloneLayers.get(object); if (inherited) cloneLayers.set(next, inherited);
          geometryOrigins.set(next, geometryOrigins.get(object) ?? object);
        }
        state.selection = state.selection.filter(objectVisible); state.selectionBasis = undefined;
      });
      if (activeLayer === id) { activeLayer = targetLayerId; emit(); }
    },
    getActiveLayer() { assertLive(); return activeLayer !== null && state.layers.catalog.groups.some(group => group.id === activeLayer) ? activeLayer : null; },
    setActiveLayer(id) { assertLive(); if (id !== null) editorLayer(state.layers.catalog, id); if (id !== activeLayer) { activeLayer = id; emit(); } },
    getObjectLayerIds(id) { assertLive(); return objectLayerIds(id); },
    getObjectLayerCondition(id) { assertLive(); return copy(objectLayerCondition(id)); },
    copyObjectLayerMembership(sourceId, targetId) {
      assertLive(); const source = objectLayerCondition(sourceId), target = internalObject(targetId);
      if (!state.objects.has(targetId) || target.kind === "group" || objectDeleted(target)) throw new TypeError("Layer membership can be copied onto an authored object.");
      const imported = importEditorLayerCondition(state.layers.catalog, source.catalog, source.condition);
      const next: EditorObject = { ...target, layerId: null, layerCondition: imported.condition };
      if (imported.condition !== undefined) delete next.layerId;
      change(() => {
        state.layers = { ...state.layers, catalog: imported.catalog }; state.objects.set(targetId, next);
        geometryOrigins.set(next, geometryOrigins.get(target) ?? target);
        const inherited = cloneLayers.get(target); if (inherited) cloneLayers.set(next, inherited);
        state.selection = state.selection.filter(objectVisible); state.selectionBasis = undefined;
      });
    },
    assignObjectsToLayer(input, layerId) {
      assertLive(); if (layerId !== null) editorLayer(state.layers.catalog, layerId);
      const ids = expand(input), source = new Map<string, EditorSourceObject>();
      for (const id of ids) {
        const object = internalObject(id); if (objectDeleted(object)) throw new RangeError("A deleted object cannot be assigned to a layer.");
        if (object.kind !== "source" || state.objects.has(id)) continue;
        if (!object.primitives.length) source.set(id, object);
        for (const ref of object.primitives) { const promoted = internalObject(promoteSource(ref)); if (promoted.kind === "source") source.set(promoted.id, promoted); }
      }
      change(() => {
        const sourceAssignments = new Map(state.layers.sourceAssignments), annotationAssignments = new Map(state.layers.annotationAssignments);
        for (const object of source.values()) {
          if (object.annotationId) annotationAssignments.set(object.annotationId, layerId);
          for (const ref of object.primitives) {
            sourceAssignments.set(editorRefKey(ref), { ref: { ...ref }, layerId });
            const annotation = getScenePrimitive(sourceScene, ref).annotationId; if (annotation) annotationAssignments.set(annotation, layerId);
          }
        }
        for (const id of ids) {
          const object = internalObject(id); if (object.kind === "source" && !state.objects.has(id)) continue;
          const next = { ...object, layerId }; delete next.layerCondition; state.objects.set(id, next);
          geometryOrigins.set(next, geometryOrigins.get(object) ?? object);
          const inherited = cloneLayers.get(object); if (inherited) cloneLayers.set(next, inherited);
        }
        state.layers = { ...state.layers, sourceAssignments, annotationAssignments };
        state.selection = state.selection.filter(objectVisible); state.selectionBasis = undefined;
      });
    },
    assignSelectionToLayer(layerId) { session.assignObjectsToLayer(state.selection, layerId); },
    getLayerObjects(id) {
      assertLive(); editorLayer(state.layers.catalog, id);
      return session.getObjects({ includeSource: true }).filter(object => object.kind !== "group" && objectLayerIds(object.id).includes(id)).map(object => object.id);
    },
    selectLayerContents(id) { selection(session.getLayerObjects(id).filter(objectVisible)); },
    getLayerEdits() { assertLive(); return copy(layerEdits()); },
    getObjectLayerEdits(id) { assertLive(); return copy(objectLayerEdits(id)); },
    getLayerRevision() { assertLive(); return layerRevision; },
    isObjectVisible(id) { assertLive(); return objectVisible(id); },
    isPrimitiveVisible(ref) { assertLive(); return !state.edits.get(editorRefKey(ref))?.deleted && visibility().isPrimitiveVisible(ref); },
    isAnnotationVisible(id) { assertLive(); return !state.annotationEdits.get(id)?.deleted && visibility().isAnnotationVisible(id); },
    getPrimitivePaintRank(ref) { assertLive(); return visibility().getPrimitivePaintRank(ref); },
    getObjectPaintRank(id) {
      assertLive(); const object = internalObject(id), ranks = visibility();
      if (object.kind === "group") return object.children.reduce((maximum, child) => objectVisible(child) ? Math.max(maximum, session.getObjectPaintRank(child)) : maximum, -1);
      if (object.kind === "source" && !state.objects.has(id)) return object.primitives.length
        ? object.primitives.reduce((maximum, ref) => !state.edits.get(editorRefKey(ref))?.deleted && ranks.isPrimitiveVisible(ref) ? Math.max(maximum, ranks.getPrimitivePaintRank(ref)) : maximum, -1)
        : ranks.getObjectPaintRank(object.annotationId ? `annotation:${object.annotationId}` : id);
      return ranks.getObjectPaintRank(id);
    },
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
      assertLive(); const before = state, beforeLayers = layerRevision, outer = transactionDepth === 0; if (outer) transactionStart = before; transactionDepth++;
      try { operation(); } catch (error) { state = before; layerRevision = beforeLayers; throw error; }
      finally { transactionDepth--; if (outer) {
        if (state.identity !== transactionStart!.identity) { undoStack.push(transactionStart!); redoStack.length = 0; revision++; cache = null; emit(); }
        transactionStart = null;
      } }
    },
    undo() { assertLive(); previewTransform = null; previewSequence++; const previous = undoStack.pop(); if (!previous) { emit(); return false; } redoStack.push(state); if (previous.layers !== state.layers) layerRevision++; state = previous; revision++; cache = null; emit(); return true; },
    redo() { assertLive(); previewTransform = null; previewSequence++; const next = redoStack.pop(); if (!next) { emit(); return false; } undoStack.push(state); if (next.layers !== state.layers) layerRevision++; state = next; revision++; cache = null; emit(); return true; },
    markSaved() { assertLive(); savedIdentity = state.identity; emit(); },
    subscribe(listener) { assertLive(); listeners.add(listener); return () => listeners.delete(listener); },
    async getScene(compileOptions = {}) {
      assertLive(); const signal = compileOptions.signal ? AbortSignal.any([compileOptions.signal, lifetime.signal]) : lifetime.signal;
      const progress = createLoadProgressReporter(compileOptions.onProgress);
      const compileMeta = { stage: "compile" as const, sourceType: "scene" as const, pageCount };
      const completeMeta = { sourceType: "scene" as const, unit: "pages" as const, processed: pageCount, total: pageCount, pageCount };
      const preview = compileOptions.preview !== false, startedPreview = preview ? previewSequence : -1;
      const committedSnapshot = state, capturedPreview = previewTransform, startedRevision = revision;
      const objectOrder = committedSnapshot.layers.objectOrder || committedSnapshot.layers.stackingChanged ? visibility().getObjectOrder() : undefined;
      const includeObjects = compileOptions.includeObjects !== false;
      const sourceCopiesOnly = (compileOptions as { sourceCopiesOnly?: boolean }).sourceCopiesOnly === true;
      const useFullCache = includeObjects && !sourceCopiesOnly;
      signal.throwIfAborted(); progress.report(0, { ...compileMeta, unit: "pages", processed: 0, total: pageCount }); signal.throwIfAborted();
      if (useFullCache && cache?.revision === startedRevision && cache.previewSequence === startedPreview) { const cachedScene = cache.scene; progress.complete(completeMeta); return cachedScene; }
      if (useFullCache && (!preview || !capturedPreview) && committedSceneCache?.identity === committedSnapshot.identity) {
        progress.complete(completeMeta); return committedSceneCache.scene;
      }
      if (useFullCache && preview && capturedPreview && state === committedSnapshot && capturedPreview[0] === 1 && capturedPreview[1] === 0 && capturedPreview[2] === 0 && capturedPreview[3] === 1) {
        const selection = JSON.stringify(committedSnapshot.selection), identity = committedSnapshot.identity;
        if (!translationPreviewCache || translationPreviewCache.identity !== identity || translationPreviewCache.selection !== selection) {
          const owners = new Set<string>(), authored = new Set<string>(), annotationIds = new Set<string>(), originalRefs = new Set<string>();
          const originalIdentity = editorPaintIdentity(sourceScene), visit = (id: string): void => {
            const object = committedSnapshot.objects.get(id) ?? sourceObject(id);
            if (object.kind === "group") { object.children.forEach(visit); return; }
            if (object.kind === "source" && !committedSnapshot.objects.has(id)) {
              if (object.annotationId) annotationIds.add(object.annotationId);
              else for (const ref of object.primitives) { owners.add(originalIdentity(ref)); originalRefs.add(editorRefKey(ref)); }
            } else authored.add(id);
          };
          committedSnapshot.selection.forEach(visit);
          const promise = (async (): Promise<ReturnType<typeof prepareEditorTranslationPreview>> => {
            const canonical = committedSceneCache?.identity === identity ? committedSceneCache.scene : await session.getScene({ preview: false, signal: lifetime.signal });
            // A host-supplied shared owner cannot safely identify one precise primitive.
            const originalCounts = scenePrimitiveCounts(sourceScene);
            if (owners.size) for (const kind of PAGE_PRIMITIVE_KINDS) for (let index = 0; index < originalCounts[kind]; index++) {
              const ref = { kind, index }; if (owners.has(originalIdentity(ref)) && !originalRefs.has(editorRefKey(ref))) return null;
            }
            const selected = new Map<string, PrimitiveRef>(), counts = scenePrimitiveCounts(canonical), resolve = editorPaintIdentity(canonical);
            for (const kind of PAGE_PRIMITIVE_KINDS) for (let index = 0; index < counts[kind]; index++) {
              const ref = { kind, index }, owner = resolve(ref);
              let objectId: string | undefined;
              try { objectId = editorPaintOwnerObject(owner); } catch { return null; }
              if (owners.has(owner) || objectId !== undefined && authored.has(objectId)) selected.set(editorRefKey(ref), ref);
            }
            const appearances = getSceneAnnotationRuns(canonical);
            for (const id of annotationIds) for (const run of appearances.get(id) ?? []) for (let index = run.first; index < run.first + run.count; index++) {
              const ref = { kind: run.kind, index }; selected.set(editorRefKey(ref), ref);
            }
            return prepareEditorTranslationPreview(canonical, [...selected.values()], [...annotationIds]);
          })();
          translationPreviewCache = { identity, selection, promise };
          void promise.catch(() => { if (translationPreviewCache?.promise === promise) translationPreviewCache = null; });
        }
        const prepared = await waitForLoad(translationPreviewCache.promise, signal);
        if (prepared) {
          const scene = prepared.translate(capturedPreview[4], capturedPreview[5], signal);
          if (revision === startedRevision && previewSequence === startedPreview && !disposed) cache = { revision, previewSequence: startedPreview, scene };
          progress.complete(completeMeta); return scene;
        }
      }
      const snapshot = preview && capturedPreview ? transformedSnapshot(committedSnapshot, capturedPreview) : committedSnapshot;
      const layeredSource = await appliedLayerSource(snapshot, signal);
      let base = bakeEditorSourceScene(layeredSource, [...snapshot.edits.values()], signal, options.onDiagnostic);
      const metadataOnly = [...snapshot.annotationEdits.values()].filter(edit => !(getSceneAnnotationRuns(sourceScene).get(edit.id)?.length));
      base = bakeEditorAnnotationEdits(base, metadataOnly);
      progress.report(.15, compileMeta); signal.throwIfAborted();
      if (snapshot.fields.size) {
        if (!options.compileFields) throw new Error("Form field updates require the editor's field appearance compiler.");
        base = await options.compileFields(base, snapshot.fields, signal);
      }
      signal.throwIfAborted(); progress.report(.3, compileMeta); signal.throwIfAborted();
      const additions = includeObjects ? [...snapshot.objects.values()].filter(object => object.kind !== "group" && (!sourceCopiesOnly || object.kind === "source")) : [];
      if (!additions.length) {
        base = reorderEditorSceneLayers(base, layerEdits(snapshot));
        if (objectOrder) base = applyEditorObjectOrdering(base, objectOrder);
        base = await refreshEditorSceneLayerDefaults(base, { signal, onDiagnostic: options.onDiagnostic });
        base = reuseGlyphStores(base);
        if (useFullCache && (!preview || !capturedPreview) && !disposed && state.identity === committedSnapshot.identity) committedSceneCache = { identity: committedSnapshot.identity, scene: base };
        if (useFullCache && revision === startedRevision && (!preview || previewSequence === startedPreview) && !disposed) cache = { revision, previewSequence: startedPreview, scene: base };
        progress.complete(completeMeta); return base;
      }
      const partition = new ScenePageViews(base), pages: VectorScene[] = [];
      for (let index = 0; index < pageCount; index++) {
        signal.throwIfAborted(); const view = partition.extract(index); remapEditorPaintIdentity(base, view.scene, view.primitives); pages.push(view.scene);
        progress.report(.3 + .15 * (index + 1) / pageCount, { ...compileMeta, pageIndex: index, unit: "pages", processed: index + 1, total: pageCount });
      }
      const pageAdditions: VectorScene[][] = Array.from({ length: pageCount }, () => []);
      for (let objectIndex = 0; objectIndex < additions.length; objectIndex++) {
        const object = additions[objectIndex];
        signal?.throwIfAborted(); let geometry: VectorScene;
        if (object.kind === "source") {
          const captured = capturedSource(object);
          if (captured) geometry = transformWholeEditorScene(captured.scene, object.transform, signal, options.onDiagnostic);
          else {
            const keep = Object.fromEntries(PAGE_PRIMITIVE_KINDS.map(kind => [kind, new Set<number>()])) as Record<PrimitiveRef["kind"], Set<number>>;
            for (const ref of object.primitives) keep[ref.kind].add(ref.index);
            const cloneEdits = objectLayerEdits(object.id, snapshot);
            let clonePromise = appliedCloneLayers.get(cloneEdits);
            if (!clonePromise) {
              clonePromise = applyEditorSceneLayers(sourceScene, cloneEdits, { signal: lifetime.signal, onDiagnostic: options.onDiagnostic })
                .then(scene => cloneEdits.objectOrderChanged ? applyEditorObjectOrdering(scene, createEditorObjectOrderSchedule(sourceScene, cloneEdits, [])) : scene);
              appliedCloneLayers.set(cloneEdits, clonePromise); void clonePromise.catch(() => appliedCloneLayers.delete(cloneEdits));
            }
            const cloneSource = await waitForLoad(clonePromise, signal);
            geometry = transformWholeEditorScene(compactEditorScene(cloneSource, keep), object.transform, signal, options.onDiagnostic);
          }
          geometry.pageCount = 1; geometry.pageRects = sourceScene.pageRects.slice(object.pageIndex * 4, object.pageIndex * 4 + 4);
          geometry.pageTextRanges = Uint32Array.of(0, geometry.textInstanceCount); geometry.pagePrimitiveRanges = undefined;
          geometry.pdfPages = undefined; geometry.annotations = undefined;
          geometry = detachEditorGeometryAnnotationLayers(geometry);
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
        geometry = assignEditorGeometryLayer(geometry, snapshot.layers.catalog, object.layerId, object.layerCondition);
        if (object.kind === "source" && object.layerId === undefined && object.layerCondition === undefined) {
          const identity = editorPaintIdentity(geometry); setEditorPaintIdentity(geometry, ref => editorCloneOwner(object.id, identity(ref)));
        } else setEditorPaintIdentity(geometry, editorAuthoredOwner(object.id));
        pageAdditions[object.pageIndex].push(geometry);
        progress.report(.45 + .4 * (objectIndex + 1) / additions.length, { ...compileMeta, pageIndex: object.pageIndex });
      }
      signal.throwIfAborted();
      const composedPages = pages.map((page, index) => {
        signal.throwIfAborted(); const composed = composeEditorPage(page, pageAdditions[index]);
        progress.report(.85 + .12 * (index + 1) / pageCount, { ...compileMeta, pageIndex: index, unit: "pages", processed: index + 1, total: pageCount });
        return composed;
      });
      let result = composeOverlappingVectorScenes(composedPages); signal.throwIfAborted();
      composeEditorPaintIdentity(composedPages, result);
      retainEditorAnnotationPlacements(base, result);
      result.pagesPerRow = sourceScene.pagesPerRow; result.sourcePdfByteLength = sourceScene.sourcePdfByteLength;
      result = reorderEditorSceneLayers(result, layerEdits(snapshot));
      if (objectOrder) result = applyEditorObjectOrdering(result, objectOrder);
      result = await refreshEditorSceneLayerDefaults(result, { signal, onDiagnostic: options.onDiagnostic });
      result = reuseGlyphStores(result);
      if (useFullCache && (!preview || !capturedPreview) && !disposed && state.identity === committedSnapshot.identity) committedSceneCache = { identity: committedSnapshot.identity, scene: result };
      if (useFullCache && revision === startedRevision && (!preview || previewSequence === startedPreview) && !disposed) cache = { revision, previewSequence: startedPreview, scene: result };
      progress.complete(completeMeta); return result;
    },
    async savePdf(saveOptions = {}) {
      assertLive();
      saveOptions = { ...saveOptions, protection: saveOptions.protection ? { ...saveOptions.protection } : undefined,
        signal: saveOptions.signal ? AbortSignal.any([saveOptions.signal, lifetime.signal]) : lifetime.signal };
      saveOptions.signal!.throwIfAborted();
      const progress = createLoadProgressReporter(saveOptions.onProgress), compileProgress = progress.child(0, .4), persistenceProgress = progress.child(.4, 1);
      const snapshot = state, targetRevision = revision, snapshotObjects = new Map(sourceObjects);
      const snapshotLayerRevision = layerRevision, snapshotActiveLayer = session.getActiveLayer();
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
        getLayers: () => withSnapshot(() => session.getLayers()), getLayerOrder: () => withSnapshot(() => session.getLayerOrder()),
        getLayerEdits: () => copy(layerEdits(snapshot)), getLayerRevision: () => snapshotLayerRevision,
        getObjectLayerEdits: id => copy(objectLayerEdits(id, snapshot)),
        getObjectLayerCondition: id => withSnapshot(() => copy(objectLayerCondition(id))),
        getActiveLayer: () => snapshotActiveLayer, getObjectLayerIds: id => withSnapshot(() => objectLayerIds(id)),
        getLayerObjects: id => withSnapshot(() => session.getLayerObjects(id)),
        isObjectVisible: id => withSnapshot(() => objectVisible(id)), isPrimitiveVisible: ref => withSnapshot(() => session.isPrimitiveVisible(ref)),
        isAnnotationVisible: id => withSnapshot(() => session.isAnnotationVisible(id)), getPrimitivePaintRank: ref => withSnapshot(() => session.getPrimitivePaintRank(ref)),
        getObjectPaintRank: id => withSnapshot(() => session.getObjectPaintRank(id)),
        canReorderSelection: action => withSnapshot(() => session.canReorderSelection(action)), reorderSelection: readOnly,
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
        createLayer: readOnly, updateLayer: readOnly, moveLayer: readOnly, setLayerOrder: readOnly, removeLayer: readOnly,
        setActiveLayer: readOnly, assignObjectsToLayer: readOnly, assignSelectionToLayer: readOnly, selectLayerContents: readOnly, copyObjectLayerMembership: readOnly,
        addObject: readOnly, updateObject: readOnly, transformSelection: readOnly, setPreviewTransform: readOnly,
        deleteSelection: readOnly, cloneSelection: readOnly, copySelection: readOnly, cutSelection: readOnly, canPaste: () => false, pasteSelection: readOnly, groupSelection: readOnly, ungroupSelection: readOnly,
        setFieldValue: readOnly, transaction: readOnly, undo: readOnly, redo: readOnly, markSaved: readOnly,
        rotatePages: readOnly, removePages: readOnly, insertPdf: readOnly,
        subscribe: readOnly, savePdf: readOnly, saveHep: readOnly, dispose: readOnly
      };
      registerEditorCapturedSourceReader(owner, id => capturedSourceScene(id, snapshot));
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
      const exportScene: VectorScene = scene.annotations?.some(annotation => annotation.field && ["maxLength", "options", "selectedIndices", "alignment", "textStyle", "buttonMark", "onValue", "appearanceState"].some(key => key in annotation.field!))
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
    dispose() { if (disposed) return; disposed = true; lifetime.abort(); releaseEditorClipboard(session); listeners.clear(); undoStack.length = redoStack.length = 0; sourceObjects.clear(); cache = null; committedSceneCache = null; translationPreviewCache = null; frameCache = null; sourcePartition = null; glyphStores.clear(); state = { objects: new Map(), fields: new Map(), edits: new Map(), annotationEdits: new Map(), layers: initialLayers, selection: [], identity: {} }; }
  };
  registerEditorCapturedSourceReader(session, id => { assertLive(); return capturedSourceScene(id); });
  orderReaders.set(session, () => { assertLive(); return [...visibility().getObjectOrder().order]; });
  orderedSourceReaders.set(session, options => session.getScene({ ...options, preview: false, sourceCopiesOnly: true } as NonNullable<Parameters<EditorSession["getScene"]>[0]>));
  orderRestorers.set(session, (tokens, stackingChanged = state.layers.stackingChanged) => {
    assertLive();
    for (const token of tokens) {
      const value = JSON.parse(token); if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string" || (value[1] !== null && typeof value[1] !== "string")) throw new TypeError("Invalid restored object-order token.");
    }
    const order = tokens.length ? [...new Set(tokens)] : undefined;
    if (JSON.stringify(order) !== JSON.stringify(state.layers.objectOrder) || stackingChanged !== state.layers.stackingChanged) change(() => { state.layers = { ...state.layers, objectOrder: order, stackingChanged }; });
  });
  return session;
}
