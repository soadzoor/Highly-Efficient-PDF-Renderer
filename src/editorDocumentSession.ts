import type { EditorSession, EditorSessionOptions, EditorState, EditorPageOperationOptions, EditorPdfInsertOptions, EditorMatrix, EditorGroupObject } from "./editorTypes";
import type { VectorScene } from "./pdfVectorExtractor";
import type { PdfPageOperation } from "./editorPdfPages";
import type { NativeVectorPdfSession } from "./pdfSession";
import { createLoadProgressReporter, type PDFLoadProgress } from "./loadProgress";
import { invertEditorMatrix, multiplyEditorMatrices } from "./editorScene";

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
      // Inner save markers are private. Only the document facade owns the
      // user's saved identity, so this materialization never clears dirty.
      const materialized = new Uint8Array(await (await source.session.savePdf({ signal, flatten: false, protection: { mode: "preserve" }, onProgress: child(0, .35),
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
      const sourceOptions: EditorSessionOptions = source.options.createSourceOptions ? await source.options.createSourceOptions(bytes, password)
        : { sourcePdf: bytes, password, compileObject: source.options.compileObject, loadFontAsset: source.options.loadFontAsset,
          onDiagnostic: source.options.onDiagnostic };
      let sourceReleased = false;
      releaseSource = () => { if (!sourceReleased) { sourceReleased = true; sourceOptions.disposeSource?.(); } };
      check(); opened = await openSingle(scene, { ...sourceOptions, sourceLabel: sourceOptions.sourceLabel ?? source.options.sourceLabel,
        sourcePdf: bytes, password, signal, disposeSource: releaseSource }); check();
      reseedAuthoredObjects(source.session, opened.session, request); check();
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
    getObjectBounds: id => { assertLive(); return current.version.session.getObjectBounds(id); },
    getSelection: () => { assertLive(); return current.version.session.getSelection(); },
    getSelectionBounds: () => { assertLive(); return current.version.session.getSelectionBounds(); },
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
    groupSelection: () => { assertLive(); return current.version.session.groupSelection(); },
    ungroupSelection: () => { assertLive(); current.version.session.ungroupSelection(); },
    setFieldValue: (name, value) => { assertLive(); current.version.session.setFieldValue(name, value); },
    getFieldValues: () => { assertLive(); return current.version.session.getFieldValues(); },
    getSourceEdits: () => { assertLive(); return current.version.session.getSourceEdits(); },
    getAnnotationEdits: () => { assertLive(); return current.version.session.getAnnotationEdits(); },
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
      if (!disposed && current === point && revision === startedRevision) session.markSaved(); return result;
    },
    async saveHep(options = {}) {
      assertLive(); const point = current, startedRevision = revision;
      const result = await point.version.session.saveHep(options);
      if (!disposed && current === point && revision === startedRevision) session.markSaved(); return result;
    },
    dispose() {
      if (disposed) return; disposed = true; lifetime.abort(); listeners.clear(); undo.length = redo.length = 0;
      for (const version of versions) { version.unsubscribe(); version.session.dispose(); } versions.clear();
    }
  };
  return session;
}

/** Keep in-memory author tools while replacing their baked PDF appearances. */
function reseedAuthoredObjects(previous: EditorSession, next: EditorSession, operation: PdfPageOperation): void {
  const objects = previous.getObjects(), sourceScene = previous.sourceScene, targetScene = next.sourceScene;
  const removed = new Set(operation.kind === "remove" ? operation.pages : []);
  const added = targetScene.pageCount - sourceScene.pageCount;
  let shift = 0;
  const pageMap = Array.from({ length: sourceScene.pageCount }, (_, index) => {
    if (removed.has(index)) { shift++; return null; }
    return operation.kind === "insert" && index >= operation.at ? index + added : index - shift;
  });
  const pageIndex = (index: number) => pageMap[index];
  const oldMatrices = new Map(sourceScene.pdfPages?.map(page => [page.pageIndex, page.pdfToScene]));
  const newMatrices = new Map(targetScene.pdfPages?.map(page => [page.pageIndex, page.pdfToScene]));
  const localMatrix = (scene: VectorScene, index: number): EditorMatrix => {
    const matrix = (scene === sourceScene ? oldMatrices : newMatrices).get(index);
    return matrix ? multiplyEditorMatrices([1, 0, 0, 1, -scene.pageRects[index * 4], -scene.pageRects[index * 4 + 1]], matrix) : [1, 0, 0, 1, 0, 0];
  };
  const deltas = new Map<number, EditorMatrix>();
  const delta = (index: number, target: number): EditorMatrix => {
    let matrix = deltas.get(index);
    if (!matrix) { matrix = multiplyEditorMatrices(localMatrix(targetScene, target), invertEditorMatrix(previous.sourcePdf
      ? localMatrix(sourceScene, index) : [1, 0, 0, 1, 0, 0])); deltas.set(index, matrix); }
    return matrix;
  };
  const annotations = new Map<string, NonNullable<VectorScene["annotations"]>[number][]>();
  for (const annotation of targetScene.annotations ?? []) if (annotation.name) {
    const key = `${annotation.pageIndex}:${annotation.name}`, entries = annotations.get(key) ?? [];
    entries.push(annotation); annotations.set(key, entries);
  }
  const authored = objects.filter(object => object.kind !== "source" && object.kind !== "group" && pageIndex(object.pageIndex) !== null);
  const replaced = new Set<string>();
  for (const object of authored) {
    const matches = annotations.get(`${pageIndex(object.pageIndex)}:${object.id}`);
    if (!matches?.length) throw new Error(`The saved PDF did not retain the editable annotation for ${object.id}. Page changes were not applied.`);
    for (const annotation of matches) replaced.add(annotation.id);
  }
  const reserved = new Set((targetScene.annotations ?? []).filter(annotation => !replaced.has(annotation.id))
    .flatMap(annotation => annotation.name ? [annotation.id, annotation.name] : [annotation.id]));
  const ids = new Map<string, string>();
  const groups = new Map(objects.filter((object): object is EditorGroupObject => object.kind === "group").map(group => [group.id, group]));
  next.transaction("Retain author models", () => {
    if (replaced.size) { next.selectAnnotations([...replaced]); next.deleteSelection(); }
    for (const object of authored) {
      const target = pageIndex(object.pageIndex)!;
      const id = next.addObject({ ...object, id: reserved.has(object.id) ? undefined : object.id,
        pageIndex: target, transform: multiplyEditorMatrices(delta(object.pageIndex, target), object.transform) });
      ids.set(object.id, id); reserved.add(id);
    }
    const visiting = new Set<string>();
    const restoreGroup = (id: string): boolean => {
      if (ids.has(id)) return true;
      const group = groups.get(id), target = group ? pageIndex(group.pageIndex) : null;
      if (!group || target === null || visiting.has(id)) return false;
      visiting.add(id); const children = group.children.every(child => ids.has(child) || restoreGroup(child)); visiting.delete(id);
      if (!children) return false;
      const restored = next.addObject({ ...group, id: reserved.has(id) ? undefined : id, pageIndex: target,
        children: group.children.map(child => ids.get(child)!) });
      ids.set(id, restored); reserved.add(restored); return true;
    };
    for (const id of groups.keys()) restoreGroup(id);
    next.select(previous.getSelection().flatMap(id => ids.has(id) ? [ids.get(id)!] : []));
  });
  next.markSaved();
}
