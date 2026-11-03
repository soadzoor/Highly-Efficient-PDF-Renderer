import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createBlankPdfScene, createPdf } = await import("../src/pdfCreation.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { decodePdfString } = await import("../src/pdf/nativeForms.ts");
  const blank = (pageCount = 1) => createBlankPdfScene({ pageSize: { width: 200, height: 300 }, pageCount });
  const dimensions = editor => editor.getPages().map(page => [Number(page.width.toFixed(3)), Number(page.height.toFixed(3))]);
  const managed = editor => editor.getObjects().filter(object => object.kind === "text" && object.pageNumberingId);
  const bytes = async blob => new Uint8Array(await blob.arrayBuffer());
  const compile = async data => {
    const parser = await openPdf({ kind: "bytes", bytes: data });
    try {
      const pages = [];
      for (let index = 0; index < parser.info.pageCount; index++) pages.push(await parser.compileVectorPage(index, { optimization: "none", preserveDrawingOrder: true }));
      return composeVectorScenesInGrid(pages, 1);
    } finally { await parser.close(); }
  };

  const unsaved = await openEditorSession(blank(), { initiallyDirty: true });
  try {
    assert.equal(unsaved.getState().dirty, true, "a new document needs saving even before its first edit");
    assert.equal(unsaved.getState().canUndo, false, "initial unsaved state does not create a synthetic undo step");
    await unsaved.savePdf({ markSaved: false }); assert.equal(unsaved.getState().dirty, true);
    await unsaved.savePdf(); assert.equal(unsaved.getState().dirty, false, "a successful document save clears the initial unsaved marker");
  } finally { unsaved.dispose(); }

  const mixed = composeVectorScenesInGrid([
    createBlankPdfScene({ pageSize: { width: 100, height: 120 } }),
    createBlankPdfScene({ pageSize: { width: 200, height: 240 } })
  ], 1);
  const editor = await openEditorSession(mixed);
  try {
    const shape = editor.addObject({ kind: "shape", pageIndex: 1, shape: "rectangle", x: 10, y: 20, width: 30, height: 40, fill: "red" });
    editor.markSaved();
    await editor.insertBlankPages({ at: 1 });
    assert.deepEqual(dimensions(editor), [[100, 120], [200, 240], [200, 240]], "insertion inherits the adjacent page's displayed dimensions");
    assert.equal(editor.getObject(shape).pageIndex, 2); assert.equal(editor.getState().dirty, true);
    assert(editor.undo()); assert.deepEqual(dimensions(editor), [[100, 120], [200, 240]]); assert.equal(editor.getObject(shape).pageIndex, 1);
    assert.equal(editor.getState().dirty, false, "undoing insertion returns to the saved document identity");
    assert(editor.redo()); assert.equal(editor.getObject(shape).pageIndex, 2);
    await editor.insertBlankPages({ at: 0, pageSize: "Letter", orientation: "landscape", pageCount: 2 });
    assert.deepEqual(dimensions(editor), [[792, 612], [792, 612], [100, 120], [200, 240], [200, 240]], "explicit paper, orientation, count and insertion position are honored");
    assert.equal(editor.getObject(shape).pageIndex, 4);
    assert(editor.undo()); assert.equal(editor.getObject(shape).pageIndex, 2); assert.equal(editor.getPages().length, 3);
    assert(editor.redo()); assert.equal(editor.getObject(shape).pageIndex, 4);
    await editor.insertBlankPages();
    assert.deepEqual(dimensions(editor).at(-1), [200, 240], "append without paper settings inherits the final page");
    assert.equal(editor.getPages().length, 6); assert.equal(editor.getObject(shape).pageIndex, 4);
    assert(editor.undo()); assert.equal(editor.getPages().length, 5);
  } finally { editor.dispose(); }

  const snapshots = await openEditorSession(blank(2));
  try {
    const pages = [0], size = { width: 250, height: 350 }, resize = snapshots.resizePages(pages, size);
    size.width = 999; pages.push(1); await resize;
    assert.deepEqual(dimensions(snapshots), [[250, 350], [200, 300]], "resize captures the selected indexes and custom dimensions immediately");
    const options = { at: 1, pageSize: { width: 410, height: 510 }, pageCount: 1 }, insertion = snapshots.insertBlankPages(options);
    options.at = 0; options.pageSize.width = 999; options.pageCount = 2; await insertion;
    assert.deepEqual(dimensions(snapshots), [[250, 350], [410, 510], [200, 300]], "pending insertion captures nested dimensions, count and position");
  } finally { snapshots.dispose(); }

  for (const action of ["insert", "resize"]) {
    const canceled = await openEditorSession(blank(2));
    try {
      canceled.addObject({ kind: "shape", pageIndex: 1, shape: "rectangle", x: 5, y: 5, width: 20, height: 20, fill: "blue" });
      const before = { scene: canceled.sourceScene, pdf: canceled.sourcePdf, state: canceled.getState(), objects: canceled.getObjects() };
      const controller = new AbortController(); let aborted = false;
      const onProgress = event => {
        if (event.value > 0 && !aborted) { aborted = true; controller.abort(); }
      };
      const operation = action === "insert" ? canceled.insertBlankPages({ at: 1, pageCount: 2, signal: controller.signal, onProgress })
        : canceled.resizePages([0], { width: 250, height: 350 }, { signal: controller.signal, onProgress });
      await assert.rejects(operation, error => error.name === "AbortError"); assert(aborted, "cancellation occurs during preparation, after progress starts");
      assert.equal(canceled.sourceScene, before.scene); assert.equal(canceled.sourcePdf, before.pdf);
      assert.deepEqual(canceled.getState(), before.state); assert.deepEqual(canceled.getObjects(), before.objects, "cancellation preserves unsaved author models and undo history");
    } finally { canceled.dispose(); }
  }

  let materializations = 0;
  const disposed = await openEditorSession(blank(), { savePdf: async () => { materializations++; throw new Error("A disposed insertion must never reach document materialization."); } });
  const source = disposed.sourceScene, pending = disposed.insertBlankPages({ pageCount: 2 });
  disposed.dispose();
  await assert.rejects(pending, error => error.name === "AbortError");
  assert.equal(materializations, 0); assert.equal(disposed.sourceScene, source, "disposing during blank-page preparation prevents a replacement commit");

  const metadata = await openEditorSession(blank(2));
  try {
    const initial = metadata.getState();
    metadata.setPageNumbering({ enabled: false, startNumber: 12, fontSize: 16, position: "header", align: "right" });
    assert.equal(managed(metadata).length, 0); assert.equal(metadata.getState().dirty, true);
    const document = await NativePdfDocument.open({ kind: "bytes", bytes: await bytes(await metadata.savePdf({ markSaved: false })) });
    try {
      const saved = JSON.parse(decodePdfString(document.catalog.get("HEPRDocument"), 0, 0));
      assert.equal(saved.pageNumbering.enabled, false); assert.equal(saved.pageNumbering.startNumber, 12); assert.equal(saved.pageNumbering.fontSize, 16);
    } finally { await document.close(); }
    assert.equal(metadata.getState().dirty, true, "metadata-only serialization respects markSaved:false");
    assert(metadata.undo()); assert.equal(metadata.getState().dirty, initial.dirty); assert.equal(metadata.getPageNumbering().fontSize, 10);
    assert(metadata.redo()); await metadata.savePdf(); assert.equal(metadata.getState().dirty, false);
    metadata.setPageNumbering({ enabled: true, startNumber: 1 }); metadata.markSaved();
    const before = { state: metadata.getState(), policy: metadata.getPageNumbering(), objects: metadata.getObjects() };
    assert.throws(() => metadata.setPageNumbering({ startNumber: Number.MAX_SAFE_INTEGER }), /integer range/);
    assert.deepEqual(metadata.getState(), before.state); assert.deepEqual(metadata.getPageNumbering(), before.policy); assert.deepEqual(metadata.getObjects(), before.objects, "invalid numbering changes are atomic");
    metadata.setPageNumbering({ skipFirstPage: true, startNumber: Number.MAX_SAFE_INTEGER });
    assert.deepEqual(managed(metadata).map(object => [object.pageIndex, object.text]), [[1, String(Number.MAX_SAFE_INTEGER)]], "one eligible page after a cover can use the largest safe logical number");
    const coverBoundary = metadata.getState();
    assert.throws(() => metadata.setPageNumbering({ skipFirstPage: false }), /integer range/);
    assert.deepEqual(metadata.getState(), coverBoundary); assert.equal(metadata.getPageNumbering().skipFirstPage, true, "removing the cover cannot silently overflow the sequence");
  } finally { metadata.dispose(); }

  const numbered = await compile(await bytes(await createPdf({ pageSize: { width: 200, height: 300 }, pageCount: 2, pageNumbering: { enabled: true } })));
  numbered.documentAuthoring.pageNumbering.startNumber = Number.MAX_SAFE_INTEGER;
  const diagnostics = [], degraded = await openEditorSession(numbered, { onDiagnostic: value => diagnostics.push(value) });
  try {
    assert.equal(degraded.getPageNumbering().enabled, false, "an unusable optional numbering policy cannot prevent editing the visible document");
    assert.equal(managed(degraded).length, 0); assert.equal(degraded.getSourceEdits().length, 0); assert.equal(degraded.getAnnotationEdits().length, 0);
    const visible = await degraded.getScene({ preview: false });
    assert.equal(visible.textInstanceCount, numbered.textInstanceCount); assert.deepEqual(visible.annotations.map(annotation => annotation.contents), numbered.annotations.map(annotation => annotation.contents));
    assert(diagnostics.some(diagnostic => diagnostic.code === "authoring.invalid-metadata"), "degraded automation emits a fidelity diagnostic");
    assert.equal(degraded.getState().dirty, false);
  } finally { degraded.dispose(); }
  console.log("Editor page creation: initial unsaved/save identity, inherited/custom insertion, undo/redo, input snapshots, cancellation/disposal, disabled metadata and invalid numbering recovery passed.");
} finally { hooks.deregister(); }
