import type { EditorSession, EditorSessionOptions, EditorState, EditorPageOperationOptions, EditorPdfInsertOptions, EditorMatrix, EditorGroupObject } from "./editorTypes";
import type { VectorScene } from "./pdfVectorExtractor";
import type { PdfPageOperation } from "./editorPdfPages";
import type { NativeVectorPdfSession } from "./pdfSession";
import { createLoadProgressReporter, type PDFLoadProgress } from "./loadProgress";
import { invertEditorMatrix, multiplyEditorMatrices } from "./editorScene";
import { editorOperationPageTargets, rebaseEditorOrderedSource, type EditorRebasedObjectIds } from "./editorPageOrderRebase";
import { editorClipboardStore, shareEditorClipboard, getEditorCapturedSourceScene, registerEditorCapturedSourceReader } from "./editorClipboard";
import { editorSourceLinks, registerEditorLinkRebinder, rebindEditorLinkTarget } from "./editorLinks";

export interface EditorDocumentVersion { session: EditorSession; options: EditorSessionOptions }
interface Version extends EditorDocumentVersion { observedRevision: number; unsubscribe: () => void }
interface Point { version: Version; identity: object }
interface Action { kind: "edit" | "pages"; before: Point; after: Point }

/** Document history keeps author models alive while structural steps swap complete sources. */
export function createEditorDocumentSession(initial: EditorDocumentVersion,
  openSingle: (scene: VectorScene, options: EditorSessionOptions) => Promise<EditorDocumentVersion>): EditorSession {
  const versions = new Set<Version>(), listeners = new Set<(state: EditorState) => void>();
  const lifetime = new AbortController(), undo: Action[] = [], redo: Action[] = [];
  let disposed = false, suppressed = 0, revision = 0, busy = false;
  let current: Point, savedIdentity: object;
  let layerVersion: Version | undefined, observedLayerRevision = -1, layerRevision = 0;
  let orderSource = 0;
  const assertLive = () => { if (disposed) throw new Error("Editor session is disposed."); };
  const getState = (): EditorState => ({ ...current.version.session.getState(), revision, dirty: current.identity !== savedIdentity,
    canUndo: undo.length > 0, canRedo: redo.length > 0 });
  const emit = () => { const state = getState(); for (const listener of listeners) { try { listener(state); } catch { /* Observers cannot interrupt an edit. */ } } };
  const prune = () => {
    const retained = new Set([current.version]);
    for (const action of [...undo, ...redo]) { retained.add(action.before.version); retained.add(action.after.version); }
    for (const version of versions) if (!retained.has(version)) {
      version.unsubscribe(); version.session.dispose(); versions.delete(version);
    }
  };
  const retain = (value: EditorDocumentVersion): Version => {
    shareEditorClipboard(initial.session, value.session);
    const version: Version = { ...value, observedRevision: value.session.revision, unsubscribe: () => {} };
    versions.add(version);
    version.unsubscribe = version.session.subscribe(state => {
      const changed = state.revision !== version.observedRevision; version.observedRevision = state.revision;
      if (disposed || suppressed || current?.version !== version) return;
      if (changed) {
        const before = current; current = { version, identity: {} };
        undo.push({ kind: "edit", before, after: current }); redo.length = 0; revision++; prune();
      }
      emit();
    });
    return version;
  };
  current = { version: retain(initial), identity: {} }; savedIdentity = current.identity;
  const silent = <T>(operation: () => T): T => { suppressed++; try { return operation(); } finally { suppressed--; } };
  const pageIndices = (indices: readonly number[]): number[] => {
    const count = current.version.session.sourceScene.pageCount, result = [...indices];
    if (result.some(index => !Number.isSafeInteger(index) || index < 0 || index >= count)) throw new RangeError("Page index is out of range.");
    if (new Set(result).size !== result.length) throw new RangeError("Page indexes must be unique.");
    return result;
  };
  const perform = async (request: PdfPageOperation, options: EditorPageOperationOptions): Promise<void> => {
    assertLive(); if (busy) throw new Error("Another page operation is already running.");
    const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
    signal.throwIfAborted(); busy = true;
    const before = current, startedRevision = revision, progress = createLoadProgressReporter(options.onProgress);
    let opened: EditorDocumentVersion | undefined;
    let releaseSource: (() => void) | undefined;
    const check = () => {
      signal.throwIfAborted();
      if (current !== before || revision !== startedRevision) throw new Error("The document changed during the page operation. Try again with the current document.");
    };
    const child = (start: number, end: number) => {
      const reporter = progress.child(start, end);
      return (value: PDFLoadProgress) => { if (!signal.aborted) reporter.report(value.value, { ...value, stage: value.stage === "complete" ? "compile" : value.stage }); };
    };
    try {
      const source = before.version, password = source.options.password;
      const onDiagnostic = options.onDiagnostic ?? source.options.onDiagnostic;
      progress.report(0, { stage: "compile", sourceType: source.session.sourcePdf ? "pdf" : "scene" });
      if (source.session.sourcePdf) {
        const { NativePdfDocument } = await import("./pdf/nativeDocument"); check();
        const document = await NativePdfDocument.open({ kind: "bytes", bytes: source.session.sourcePdf }, { password, signal });
        try {
          const count = document.pages.length, scene = source.session.sourceScene;
          const pages = scene.pdfPages;
          const mapping = new Map(pages?.map(page => [page.pageIndex, page.sourcePageIndex]));
          if (scene.pageCount !== count || pages?.length !== count || Array.from({ length: count }, (_, index) =>
            mapping.get(index) === index).some(ordered => !ordered)) {
            throw new Error("Page operations require the complete source PDF in its original page order. Open the complete source PDF before changing pages.");
          }
        } finally { await document.close(); }
        check();
      }
      const layerEdits = source.session.getLayerEdits();
      const ordered = layerEdits.objectOrderChanged || layerEdits.stackingChanged;
      const orderRuntime = ordered ? await import("./editorSessionRuntime") : undefined;
      const currentOrder = orderRuntime?.getEditorCurrentObjectOrder(source.session);
      const canonical = ordered ? await orderRuntime!.getEditorOrderedSourceScene(source.session, { signal }) : undefined;
      check();
      // Inner save markers are private. Only the document facade owns the
      // user's saved identity, so this materialization never clears dirty.
      const materialized = new Uint8Array(await (await source.session.savePdf({ signal, flatten: false, protection: { mode: "preserve" }, onProgress: child(0, .35),
        onDiagnostic,
        onWarning: message => onDiagnostic?.({ code: "editor.page-materialized", severity: "warning", message }) })).arrayBuffer());
      check();
      const { manipulatePdfPages } = await import("./editorPdfPages"); check();
      const result = await manipulatePdfPages(materialized, request, { password, signal, onProgress: child(.35, .6),
        onDiagnostic });
      const bytes = new Uint8Array(await result.arrayBuffer()); check();
      const [{ openPdf }, { composeVectorScenesInGrid }, { createBundledStandardFontResolver }] = await Promise.all([
        import("./pdfSession"), import("./pdfVectorExtractor"), import("./standardFontResolver")
      ]); check();
      const node = !!(globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node;
      const missingFontResolver = source.options.loadFontAsset
        ? createBundledStandardFontResolver({ loadAsset: async (asset, loadSignal) => { loadSignal?.throwIfAborted(); return source.options.loadFontAsset!(asset.url); } })
        : node ? (await import("./nodePdfResources")).createNodeBundledStandardFontResolver() : createBundledStandardFontResolver();
      check();
      const parser = await openPdf({ kind: "bytes", bytes }, { password, signal, missingFontResolver,
        onDiagnostic }) as NativeVectorPdfSession;
      let scene: VectorScene;
      try {
        const pages: VectorScene[] = [];
        for (let index = 0; index < parser.info.pageCount; index++) {
          check(); pages.push(await parser.compileVectorPage(index, { signal, optimization: "none", preserveDrawingOrder: true }));
          progress.report(.6 + .34 * (index + 1) / parser.info.pageCount, { stage: "compile", sourceType: "pdf", unit: "pages",
            processed: index + 1, total: parser.info.pageCount, pageIndex: index, pageCount: parser.info.pageCount });
        }
        scene = composeVectorScenesInGrid(pages, source.session.sourceScene.pagesPerRow || 1);
      } finally { await parser.close(); }
      check();
      const rebased = canonical ? rebaseEditorOrderedSource(source.session, canonical, scene, request, `source:page:${++orderSource}:`, signal) : undefined;
      if (rebased) scene = rebased.scene;
      const sourceOptions: EditorSessionOptions = source.options.createSourceOptions ? await source.options.createSourceOptions(bytes, password)
        : { sourcePdf: bytes, password, compileObject: source.options.compileObject, loadFontAsset: source.options.loadFontAsset,
          onDiagnostic: source.options.onDiagnostic };
      let sourceReleased = false;
      releaseSource = () => { if (!sourceReleased) { sourceReleased = true; sourceOptions.disposeSource?.(); } };
      check(); opened = await openSingle(scene, { ...sourceOptions, sourceLabel: sourceOptions.sourceLabel ?? source.options.sourceLabel,
        sourcePdf: bytes, password, signal, disposeSource: releaseSource }); check();
      const nextSession = opened.session;
      reseedAuthoredObjects(source.session, nextSession, request, ids => {
        if (rebased && currentOrder) orderRuntime!.restoreEditorObjectOrder(nextSession, rebased.remapOrder(currentOrder, ids), layerEdits.stackingChanged);
      }); check();
      const after = { version: retain(opened), identity: {} }; opened = undefined;
      releaseSource = undefined;
      current = after; undo.push({ kind: "pages", before, after }); redo.length = 0; revision++; prune();
      progress.complete({ sourceType: "pdf", unit: "pages", processed: scene.pageCount, total: scene.pageCount, pageCount: scene.pageCount }); emit();
    } finally { opened?.session.dispose(); releaseSource?.(); busy = false; }
  };
  const session: EditorSession = {
    get sourceScene() { return current.version.session.sourceScene; },
    get sourcePdf() { return current.version.session.sourcePdf; },
    get revision() { return revision; }, getState,
    getObjects: options => { assertLive(); return current.version.session.getObjects(options); },
    getObject: id => { assertLive(); return current.version.session.getObject(id); },
    isObjectLocked: id => { assertLive(); return current.version.session.isObjectLocked(id); },
    setObjectsLocked: (ids, locked) => { assertLive(); current.version.session.setObjectsLocked(ids, locked); },
    getObjectLink: id => { assertLive(); return current.version.session.getObjectLink(id); },
    setObjectLink: (id, link) => { assertLive(); current.version.session.setObjectLink(id, link); },
    getObjectBounds: id => { assertLive(); return current.version.session.getObjectBounds(id); },
    getSelection: () => { assertLive(); return current.version.session.getSelection(); },
    getSelectionBounds: () => { assertLive(); return current.version.session.getSelectionBounds(); },
    getSelectionFrame: () => { assertLive(); return current.version.session.getSelectionFrame(); },
    select: (ids, options) => { assertLive(); current.version.session.select(ids, options); },
    selectPrimitives: (refs, options) => { assertLive(); current.version.session.selectPrimitives(refs, options); },
    selectAnnotations: (ids, options) => { assertLive(); current.version.session.selectAnnotations(ids, options); },
    selectArea: (bounds, options) => { assertLive(); current.version.session.selectArea(bounds, options); },
    addObject: object => { assertLive(); return current.version.session.addObject(object); },
    updateObject: (id, patch) => { assertLive(); current.version.session.updateObject(id, patch); },
    transformSelection: matrix => { assertLive(); current.version.session.transformSelection(matrix); },
    setPreviewTransform: matrix => { assertLive(); current.version.session.setPreviewTransform(matrix); },
    deleteSelection: () => { assertLive(); current.version.session.deleteSelection(); },
    cloneSelection: offset => { assertLive(); return current.version.session.cloneSelection(offset); },
    duplicateSelection: options => { assertLive(); return current.version.session.duplicateSelection(options); },
    copySelection: options => { assertLive(); return current.version.session.copySelection(options); },
    cutSelection: options => { assertLive(); return current.version.session.cutSelection(options); },
    canPaste: () => { assertLive(); return current.version.session.canPaste(); },
    pasteSelection: options => { assertLive(); return current.version.session.pasteSelection(options); },
    groupSelection: () => { assertLive(); return current.version.session.groupSelection(); },
    ungroupSelection: () => { assertLive(); current.version.session.ungroupSelection(); },
    setFieldValue: (name, value) => { assertLive(); current.version.session.setFieldValue(name, value); },
    getFieldValues: () => { assertLive(); return current.version.session.getFieldValues(); },
    getSourceEdits: () => { assertLive(); return current.version.session.getSourceEdits(); },
    getAnnotationEdits: () => { assertLive(); return current.version.session.getAnnotationEdits(); },
    updateAnnotation: (id, patch) => { assertLive(); current.version.session.updateAnnotation(id, patch); },
    getLayers: () => { assertLive(); return current.version.session.getLayers(); },
    getLayerOrder: () => { assertLive(); return current.version.session.getLayerOrder(); },
    createLayer: options => { assertLive(); return current.version.session.createLayer(options); },
    updateLayer: (id, patch) => { assertLive(); current.version.session.updateLayer(id, patch); },
    moveLayer: (id, position) => { assertLive(); current.version.session.moveLayer(id, position); },
    setLayerOrder: order => { assertLive(); current.version.session.setLayerOrder(order); },
    removeLayer: (id, options) => { assertLive(); current.version.session.removeLayer(id, options); },
    getActiveLayer: () => { assertLive(); return current.version.session.getActiveLayer(); },
    setActiveLayer: id => { assertLive(); current.version.session.setActiveLayer(id); },
    getObjectLayerIds: id => { assertLive(); return current.version.session.getObjectLayerIds(id); },
    getObjectLayerCondition: id => { assertLive(); return current.version.session.getObjectLayerCondition(id); },
    copyObjectLayerMembership: (source, target) => { assertLive(); current.version.session.copyObjectLayerMembership(source, target); },
    assignObjectsToLayer: (ids, id) => { assertLive(); current.version.session.assignObjectsToLayer(ids, id); },
    assignSelectionToLayer: id => { assertLive(); current.version.session.assignSelectionToLayer(id); },
    getLayerObjects: id => { assertLive(); return current.version.session.getLayerObjects(id); },
    selectLayerContents: id => { assertLive(); current.version.session.selectLayerContents(id); },
    getLayerEdits: () => { assertLive(); return current.version.session.getLayerEdits(); },
    getObjectLayerEdits: id => { assertLive(); return current.version.session.getObjectLayerEdits(id); },
    getLayerRevision: () => {
      assertLive(); const next = current.version.session.getLayerRevision();
      if (layerVersion !== current.version || observedLayerRevision !== next) { layerRevision++; layerVersion = current.version; observedLayerRevision = next; }
      return layerRevision;
    },
    isObjectVisible: id => { assertLive(); return current.version.session.isObjectVisible(id); },
    isPrimitiveVisible: ref => { assertLive(); return current.version.session.isPrimitiveVisible(ref); },
    isAnnotationVisible: id => { assertLive(); return current.version.session.isAnnotationVisible(id); },
    getPrimitivePaintRank: ref => { assertLive(); return current.version.session.getPrimitivePaintRank(ref); },
    getObjectPaintRank: id => { assertLive(); return current.version.session.getObjectPaintRank(id); },
    canReorderSelection: action => { assertLive(); return current.version.session.canReorderSelection(action); },
    reorderSelection: action => { assertLive(); current.version.session.reorderSelection(action); },
    getPages: () => { assertLive(); return current.version.session.getPages(); },
    async rotatePages(indices, degrees, options = {}) {
      assertLive(); options.signal?.throwIfAborted(); const pages = pageIndices(indices);
      if (!Number.isFinite(degrees) || !Number.isInteger(degrees / 90)) throw new RangeError("Page rotation must be a multiple of 90 degrees.");
      if (!pages.length || degrees % 360 === 0) return;
      await perform({ kind: "rotate", pages, degrees }, { ...options });
    },
    async removePages(indices, options = {}) {
      assertLive(); options.signal?.throwIfAborted(); const pages = pageIndices(indices);
      if (pages.length >= session.sourceScene.pageCount) throw new RangeError("At least one page must remain in the document.");
      if (pages.length) await perform({ kind: "remove", pages }, { ...options });
    },
    async insertPdf(bytes, options: EditorPdfInsertOptions = {}) {
      assertLive(); options.signal?.throwIfAborted();
      const at = options.at ?? session.sourceScene.pageCount;
      if (!Number.isSafeInteger(at) || at < 0 || at > session.sourceScene.pageCount) throw new RangeError("Page insertion position is out of range.");
      await perform({ kind: "insert", at, bytes: bytes.slice(), pages: options.pages ? [...options.pages] : undefined, password: options.password }, { ...options });
    },
    async reorderPages(order, options = {}) {
      assertLive(); options.signal?.throwIfAborted(); const pages = pageIndices(order), count = session.sourceScene.pageCount;
      if (pages.length !== count) throw new RangeError("Page order must contain every current page once.");
      if (pages.some((page, index) => page !== index)) await perform({ kind: "reorder", pages }, { ...options });
    },
    async duplicatePages(indices, options = {}) {
      assertLive(); options.signal?.throwIfAborted(); const pages = pageIndices(indices), at = options.at ?? session.sourceScene.pageCount;
      if (!Number.isSafeInteger(at) || at < 0 || at > session.sourceScene.pageCount) throw new RangeError("Page duplication position is out of range.");
      if (pages.length) await perform({ kind: "duplicate", pages, at }, { ...options });
    },
    async cropPages(indices, box, options = {}) {
      assertLive(); options.signal?.throwIfAborted(); const pages = pageIndices(indices);
      if (pages.length) await perform({ kind: "crop", pages, box: box ? { ...box } : null }, { ...options });
    },
    async extractPages(indices, options = {}) {
      assertLive(); if (busy) throw new Error("Another document operation is already running.");
      const pages = pageIndices(indices); if (!pages.length) throw new RangeError("Select at least one page to extract.");
      const point = current, startedRevision = revision, signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
      const progress = createLoadProgressReporter(options.onProgress);
      const child = (start: number, end: number) => {
        const reporter = progress.child(start, end);
        return (value: PDFLoadProgress) => { if (!signal.aborted) reporter.report(value.value, { ...value, stage: value.stage === "complete" ? "compile" : value.stage }); };
      };
      signal.throwIfAborted();
      progress.report(0, { stage: "compile", sourceType: point.version.session.sourcePdf ? "pdf" : "scene" });
      const bytes = new Uint8Array(await (await point.version.session.savePdf({ signal, markSaved: false, onProgress: child(0, .65),
        onDiagnostic: options.onDiagnostic, protection: { mode: "preserve" } })).arrayBuffer());
      signal.throwIfAborted(); if (current !== point || revision !== startedRevision) throw new Error("The document changed while extracting pages. Try again.");
      const mapping = point.version.session.sourceScene.pdfPages, mapped = pages.map(page => mapping?.find(item => item.pageIndex === page)?.sourcePageIndex ?? page);
      const { manipulatePdfPages } = await import("./editorPdfPages");
      const result = await manipulatePdfPages(bytes, { kind: "extract", pages: mapped }, { ...options, signal,
        onProgress: child(.65, 1), password: point.version.options.password });
      signal.throwIfAborted(); if (current !== point || revision !== startedRevision) throw new Error("The document changed while extracting pages. Try again.");
      progress.complete({ sourceType: "pdf" });
      return result;
    },
    transaction: (label, operation) => { assertLive(); current.version.session.transaction(label, operation); },
    undo() {
      assertLive(); const action = undo.pop();
      if (!action) { silent(() => current.version.session.setPreviewTransform(null)); emit(); return false; }
      if (action.kind === "edit") silent(() => { if (!current.version.session.undo()) throw new Error("Editor history is inconsistent."); });
      else silent(() => current.version.session.setPreviewTransform(null));
      current = action.before; redo.push(action); revision++; emit(); return true;
    },
    redo() {
      assertLive(); const action = redo.pop();
      if (!action) { silent(() => current.version.session.setPreviewTransform(null)); emit(); return false; }
      if (action.kind === "edit") silent(() => { if (!current.version.session.redo()) throw new Error("Editor history is inconsistent."); });
      else silent(() => current.version.session.setPreviewTransform(null));
      current = action.after; undo.push(action); revision++; emit(); return true;
    },
    markSaved() { assertLive(); savedIdentity = current.identity; silent(() => current.version.session.markSaved()); emit(); },
    subscribe(listener) { assertLive(); listeners.add(listener); return () => listeners.delete(listener); },
    getScene: options => { assertLive(); return current.version.session.getScene(options); },
    async savePdf(options = {}) {
      assertLive(); const point = current, startedRevision = revision;
      const result = await point.version.session.savePdf(options);
      if (!disposed && current === point && revision === startedRevision && options.markSaved !== false) session.markSaved(); return result;
    },
    async saveHep(options = {}) {
      assertLive(); const point = current, startedRevision = revision;
      const result = await point.version.session.saveHep(options);
      if (!disposed && current === point && revision === startedRevision && options.markSaved !== false) session.markSaved(); return result;
    },
    captureRecovery(options) { assertLive(); return current.version.session.captureRecovery(options); },
    async restoreRecovery(snapshot, options = {}) {
      assertLive(); if (busy) throw new Error("Another document operation is already running.");
      if (snapshot?.format !== "hepr-editor-recovery" || snapshot.version !== 1) throw new TypeError("Unsupported editor recovery snapshot.");
      const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal, before = current, startedRevision = revision;
      signal.throwIfAborted(); busy = true; let opened: EditorDocumentVersion | undefined, release: (() => void) | undefined;
      const check = () => { signal.throwIfAborted(); assertLive(); if (current !== before || revision !== startedRevision) throw new Error("The document changed while preparing recovery. Try again."); };
      try {
        if (snapshot.sourcePdf) {
          // Normal opening/unlocking still happens before any stored decrypted
          // scene or author models can replace the current document.
          const { NativePdfDocument } = await import("./pdf/nativeDocument"); check();
          const document = await NativePdfDocument.open({ kind: "bytes", bytes: snapshot.sourcePdf }, { password: before.version.options.password, signal });
          await document.close(); check();
        }
        const sourceOptions = snapshot.sourcePdf && before.version.options.createSourceOptions
          ? await before.version.options.createSourceOptions(snapshot.sourcePdf, before.version.options.password)
          : { ...before.version.options, sourcePdf: snapshot.sourcePdf, prepareScene: undefined };
        let released = false; release = () => { if (!released) { released = true; sourceOptions.disposeSource?.(); } };
        check(); opened = await openSingle(structuredClone(snapshot.sourceScene), { ...sourceOptions, sourceLabel: snapshot.sourceLabel ?? sourceOptions.sourceLabel,
          sourcePdf: snapshot.sourcePdf, signal, disposeSource: release }); check();
        await opened.session.restoreRecovery(snapshot, { signal }); check();
        const after = { version: retain(opened), identity: {} }; opened = undefined; release = undefined;
        current = after; undo.push({ kind: "pages", before, after }); redo.length = 0; revision++; prune(); emit();
      } finally { opened?.session.dispose(); release?.(); busy = false; }
    },
    dispose() {
      if (disposed) return; disposed = true; lifetime.abort(); listeners.clear(); undo.length = redo.length = 0;
      const clipboard = editorClipboardStore(initial.session); clipboard.value = null; clipboard.sequence++;
      for (const version of versions) { version.unsubscribe(); version.session.dispose(); } versions.clear();
    }
  };
  shareEditorClipboard(initial.session, session);
  registerEditorCapturedSourceReader(session, id => getEditorCapturedSourceScene(current.version.session, id));
  registerEditorLinkRebinder(session, (previous, replacement) => { assertLive(); rebindEditorLinkTarget(current.version.session, previous, replacement); });
  return session;
}

/** Keep in-memory author tools while replacing their baked PDF appearances. */
function reseedAuthoredObjects(previous: EditorSession, next: EditorSession, operation: PdfPageOperation,
  restoreOrder?: (ids: EditorRebasedObjectIds) => void): void {
  const objects = previous.getObjects(), sourceScene = previous.sourceScene, targetScene = next.sourceScene;
  const targets = editorOperationPageTargets(sourceScene.pageCount, targetScene.pageCount, operation);
  const oldMatrices = new Map(sourceScene.pdfPages?.map(page => [page.pageIndex, page.pdfToScene]));
  const newMatrices = new Map(targetScene.pdfPages?.map(page => [page.pageIndex, page.pdfToScene]));
  const localMatrix = (scene: VectorScene, index: number): EditorMatrix => {
    const matrix = (scene === sourceScene ? oldMatrices : newMatrices).get(index);
    return matrix ? multiplyEditorMatrices([1, 0, 0, 1, -scene.pageRects[index * 4], -scene.pageRects[index * 4 + 1]], matrix) : [1, 0, 0, 1, 0, 0];
  };
  const deltas = new Map<string, EditorMatrix>();
  const delta = (index: number, target: number): EditorMatrix => {
    const key = `${index}:${target}`; let matrix = deltas.get(key);
    if (!matrix) { matrix = multiplyEditorMatrices(localMatrix(targetScene, target), invertEditorMatrix(previous.sourcePdf
      ? localMatrix(sourceScene, index) : [1, 0, 0, 1, 0, 0])); deltas.set(key, matrix); }
    return matrix;
  };
  const annotations = new Map<string, NonNullable<VectorScene["annotations"]>[number][]>();
  for (const annotation of targetScene.annotations ?? []) if (annotation.name) {
    const key = `${annotation.pageIndex}:${annotation.name}`, entries = annotations.get(key) ?? [];
    entries.push(annotation); annotations.set(key, entries);
  }
  const authored = objects.filter(object => object.kind !== "source" && object.kind !== "group" && targets[object.pageIndex].length);
  const replaced = new Set<string>();
  for (const object of authored) for (const target of targets[object.pageIndex]) {
    const matches = annotations.get(`${target}:${object.id}`);
    if (!matches?.length) throw new Error(`The saved PDF did not retain the editable annotation for ${object.id}. Page changes were not applied.`);
    for (const annotation of matches) replaced.add(annotation.id);
  }
  const reserved = new Set((targetScene.annotations ?? []).filter(annotation => !replaced.has(annotation.id))
    .flatMap(annotation => annotation.name ? [annotation.id, annotation.name] : [annotation.id]));
  const originalIds = new Set(objects.map(object => object.id)); let serial = 0;
  const freshId = (): string => { let id: string; do { id = `editor-page:${++serial}`; } while (reserved.has(id) || originalIds.has(id)); return id; };
  const pageCopies = new Map<number, Map<string, string>>(), ids = Object.assign(new Map<string, string>(), { pageCopies });
  const targetIds = (page: number): Map<string, string> => { let map = pageCopies.get(page); if (!map) pageCopies.set(page, map = new Map()); return map; };
  const groups = new Map(objects.filter((object): object is EditorGroupObject => object.kind === "group").map(group => [group.id, group]));
  next.transaction("Retain author models", () => {
    if (replaced.size) { next.selectAnnotations([...replaced]); next.setObjectsLocked(next.getSelection(), false); next.deleteSelection(); }
    // Restore every original before its copies, so existing object IDs survive
    // even when the copied pages were inserted before their original pages.
    for (const copy of [false, true]) for (const object of authored) for (const target of targets[object.pageIndex]) {
      if ((target !== targets[object.pageIndex][0]) !== copy) continue;
      const id = next.addObject({ ...object, id: copy || reserved.has(object.id) ? freshId() : object.id,
        ...(object.layerCondition === undefined ? {} : { layerId: null, layerCondition: undefined }),
        pageIndex: target, transform: multiplyEditorMatrices(delta(object.pageIndex, target), object.transform) });
      if (object.layerCondition !== undefined) next.copyObjectLayerMembership(`annotation:${annotations.get(`${target}:${object.id}`)![0].id}`, id);
      targetIds(target).set(object.id, id); if (!copy) ids.set(object.id, id); reserved.add(id);
    }
    const visiting = new Set<string>();
    const restoreGroup = (id: string, target: number): boolean => {
      const mapped = targetIds(target); if (mapped.has(id)) return true;
      const group = groups.get(id), key = `${target}:${id}`;
      if (!group || !targets[group.pageIndex].includes(target) || visiting.has(key)) return false;
      visiting.add(key); const children = group.children.every(child => mapped.has(child) || restoreGroup(child, target)); visiting.delete(key);
      if (!children) return false;
      const restored = next.addObject({ ...group, id: target !== targets[group.pageIndex][0] || reserved.has(id) ? freshId() : id, pageIndex: target,
        children: group.children.map(child => mapped.get(child)!), transform: multiplyEditorMatrices(delta(group.pageIndex, target), group.transform) });
      mapped.set(id, restored); if (target === targets[group.pageIndex][0]) ids.set(id, restored); reserved.add(restored); return true;
    };
    for (const copy of [false, true]) for (const group of groups.values()) for (const target of targets[group.pageIndex])
      if ((target !== targets[group.pageIndex][0]) === copy) restoreGroup(group.id, target);
    for (const [page, mapped] of pageCopies) for (const [original, restored] of mapped) {
      const link = previous.getObjectLink(original); if (!link) continue;
      let target: string | undefined;
      if (link.type === "object") {
        const ownerPage = previous.getObject(original).pageIndex;
        const cohort = targets[ownerPage].indexOf(page);
        try {
          const destinationPage = previous.getObject(link.objectId).pageIndex, copiedPage = targets[destinationPage]?.[cohort];
          target = mapped.get(link.objectId) ?? (copiedPage === undefined ? undefined : pageCopies.get(copiedPage)?.get(link.objectId)) ?? ids.get(link.objectId);
        } catch { /* A removed target remains a broken reference, without preventing page edits. */ }
      }
      const annotation = annotations.get(`${page}:${original}`)?.[0];
      const fallback = annotation && editorSourceLinks(targetScene).get(`annotation:${annotation.id}`)?.link;
      const value = link.type !== "object" ? link : target ? { type: "object" as const, objectId: target } : fallback ?? link;
      if (value.type === "object") { try { next.getObject(value.objectId); } catch { continue; } }
      if (JSON.stringify(next.getObjectLink(restored)) === JSON.stringify(value)) continue;
      const locked = next.isObjectLocked(restored);
      if (locked) next.setObjectsLocked([restored], false);
      next.setObjectLink(restored, value);
      if (locked) next.setObjectsLocked([restored], true);
    }
    restoreOrder?.(ids);
    const active = previous.getActiveLayer(); if (active && next.getLayers().some(layer => layer.id === active)) next.setActiveLayer(active);
    next.select(previous.getSelection().flatMap(id => ids.has(id) ? [ids.get(id)!] : []));
  });
  next.markSaved();
}
