import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { changePdfProtection } = await import("../src/editorApi.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const { editorTransformBounds, multiplyEditorMatrices, invertEditorMatrix } = await import("../src/editorScene.ts");
  const compile = async (bytes, password) => {
    const parser = await openPdf({ kind: "bytes", bytes }, { password });
    try {
      const pages = [];
      for (let index = 0; index < parser.info.pageCount; index++) pages.push(await parser.compileVectorPage(index, { optimization: "none", preserveDrawingOrder: true }));
      return composeVectorScenesInGrid(pages, 1);
    } finally { await parser.close(); }
  };
  const bytes = fixture(true), original = bytes.slice(), foreign = fixture(false), foreignOriginal = foreign.slice();
  const scopeParser = await openPdf({ kind: "bytes", bytes });
  try {
    const first = await scopeParser.compileVectorPage(0, { optimization: "none" }), second = await scopeParser.compileVectorPage(1, { optimization: "none" });
    for (const scoped of [composeVectorScenesInGrid([second], 1), composeVectorScenesInGrid([second, first], 1)]) {
      let materializations = 0;
      const scopedEditor = await openEditorSession(scoped, { sourcePdf: bytes, savePdf: async () => { materializations++; return new Blob([bytes]); } });
      try {
        const object = scopedEditor.addObject({ kind: "shape", pageIndex: 0, shape: "rectangle", x: 1, y: 1, width: 5, height: 5 });
        const source = scopedEditor.sourceScene, sourcePdf = scopedEditor.sourcePdf, revision = scopedEditor.revision;
        await assert.rejects(scopedEditor.rotatePages([0], 90), /complete source PDF/);
        await assert.rejects(scopedEditor.insertPdf(foreign), /complete source PDF/);
        assert.equal(materializations, 0, "subset/reordered sources are rejected before PDF materialization");
        assert.equal(scopedEditor.sourceScene, source); assert.equal(scopedEditor.sourcePdf, sourcePdf); assert.equal(scopedEditor.revision, revision);
        assert.equal(scopedEditor.getObject(object).kind, "shape"); assert(scopedEditor.getState().dirty);
      } finally { scopedEditor.dispose(); }
    }
  } finally { await scopeParser.close(); }
  const scene = await compile(bytes), services = await createEditorAppServices({ sourcePdf: bytes });
  const font = await services.fonts.register(buildTinySfnt(), { family: "Shared page font" });
  const editor = await openEditorSession(scene, services.sessionOptions);
  const shapeInput = { kind: "shape", pageIndex: 0, shape: "rectangle", x: 5, y: 5, width: 12, height: 8, fill: "green" };
  try {
    assert.deepEqual(editor.getPages().map(page => [page.index, page.width, page.height, page.rotation]), [[0, 100, 80, 0], [1, 90, 150, 90]]);
    assert.equal(editor.getState().dirty, false);
    const text = editor.addObject({ kind: "text", pageIndex: 1, x: 3, y: 3, width: 60, height: 20,
      text: "AB", fontId: font.id, fontSize: 8, runs: [{ text: "A", underline: true }, { text: "B", color: "red" }] });
    const shape = editor.addObject(shapeInput); editor.markSaved();
    const before = editor.sourceScene, beforePdf = editor.sourcePdf, progress = [];
    await editor.rotatePages([0], 90, { onProgress: event => progress.push(event) });
    assert(editor.getState().dirty); assert.equal(editor.getPages()[0].rotation, 90);
    assert.deepEqual([editor.getPages()[0].width, editor.getPages()[0].height], [80, 100]);
    assert.equal(progress.at(-1).stage, "complete"); assert.equal(progress.at(-1).value, 1);
    for (let index = 1; index < progress.length; index++) assert(progress[index].value >= progress[index - 1].value);
    const rotated = editor.sourceScene, rotatedPdf = editor.sourcePdf;
    assert.notEqual(rotated, before); assert.notEqual(rotatedPdf, beforePdf);
    const restoredAnnotation = rotated.annotations.find(annotation => annotation.name === text);
    assert(restoredAnnotation, "page changes preserve standard editable FreeText annotations");
    const restored = await services.readTextAnnotation(restoredAnnotation.id, rotated, undefined, { pdf: rotatedPdf });
    assert.equal(restored.text, "AB"); assert(restored.runs.some(run => run.underline));
    const after = editor.addObject({ ...shapeInput, pageIndex: 1 });
    const extraText = editor.addObject({ kind: "text", pageIndex: 0, x: 2, y: 2, width: 40, height: 12, text: "AB", fontId: font.id, fontSize: 7 });
    await editor.getScene(); assert.equal(editor.getObject(extraText).fontId, font.id, "source forks retain the shared custom font registry");
    assert(editor.undo()); assert(editor.undo());
    assert(editor.undo()); assert.equal(editor.sourceScene, before); assert.equal(editor.sourcePdf, beforePdf);
    assert.equal(editor.getState().dirty, false, "undoing a structural step restores the saved document identity");
    assert.equal(editor.getObject(text).kind, "text"); assert.equal(editor.getObject(shape).kind, "shape", "undo retains original author models");
    assert(editor.redo()); assert.equal(editor.sourceScene, rotated); assert.equal(editor.sourcePdf, rotatedPdf);
    assert(editor.redo()); assert.equal(editor.getObject(after).kind, "shape"); assert(editor.redo());
    editor.setFieldValue("Field", "B");
    const filled = new Uint8Array(await (await editor.savePdf()).arrayBuffer());
    assert.equal((await compile(filled)).annotations.find(annotation => annotation.field?.name === "Field").field.value, "B", "fields bind to the new rotated source");
    assert.equal(editor.getState().dirty, false);
    await editor.removePages([0]); assert.equal(editor.getPages().length, 1);
    assert(editor.getState().dirty); assert.equal(editor.getPages()[0].rotation, 90);
    assert(editor.sourceScene.annotations.some(annotation => annotation.name === text), "unremoved pages keep rich text metadata");
    assert(!editor.sourceScene.annotations.some(annotation => annotation.name === shape), "removed pages lose their own annotations");
    assert(editor.undo()); assert.equal(editor.getPages().length, 2); assert.equal(editor.getObject(extraText).kind, "text");
    assert.equal(editor.getState().dirty, false); assert(editor.redo());
    editor.setFieldValue("Field", "A");
    await editor.insertPdf(foreign, { at: 0, pages: [1, 0] });
    assert.deepEqual(editor.getPages().map(page => [page.width, page.height, page.rotation]), [[150, 90, 180], [100, 80, 0], [90, 150, 90]], "selected foreign pages retain requested order and geometry");
    assert.equal(editor.sourceScene.annotations.find(annotation => annotation.field?.name === "Field").field.value, "A");
    editor.setFieldValue("Field", "B");
    const insertedSave = new Uint8Array(await (await editor.savePdf()).arrayBuffer());
    assert.equal((await compile(insertedSave)).annotations.find(annotation => annotation.field?.name === "Field").field.value, "B", "fields continue editing after insert/removal changes page positions");
    editor.addObject({ ...shapeInput, pageIndex: 2 });
    const stable = { scene: editor.sourceScene, pdf: editor.sourcePdf, revision: editor.revision, dirty: editor.getState().dirty };
    await assert.rejects(editor.removePages([0, 1, 2]), /At least one page/);
    await assert.rejects(editor.rotatePages([0], 45), /multiple of 90/);
    await assert.rejects(editor.insertPdf(foreign, { pages: [20] }));
    const canceled = new AbortController();
    await assert.rejects(editor.rotatePages([0], 90, { signal: canceled.signal, onProgress: event => { if (event.value >= .35) canceled.abort(); } }), { name: "AbortError" });
    assert.equal(editor.sourceScene, stable.scene); assert.equal(editor.sourcePdf, stable.pdf); assert.equal(editor.revision, stable.revision);
    assert.equal(editor.getState().dirty, stable.dirty, "failed/canceled materialization never changes the facade saved marker");
    assert(stable.dirty);
    const hep = await editor.saveHep({ withVectorLod: false, withTextLod: false, encodeRasterImages: false });
    assert.equal((await loadSceneFromHep(await hep.arrayBuffer())).pageCount, 3);
  } finally { editor.dispose(); services.dispose(); }

  // Concurrent edits remain available and cause an in-flight structural result
  // to be rejected instead of overwriting newly authored state.
  let release, announce;
  const gate = new Promise(resolve => release = resolve), started = new Promise(resolve => announce = resolve);
  const concurrent = await openEditorSession(scene, { sourcePdf: bytes, savePdf: async () => { announce(); await gate; return new Blob([bytes]); } });
  try {
    const first = concurrent.addObject(shapeInput), pending = concurrent.rotatePages([0], 90); await started;
    await assert.rejects(concurrent.removePages([0]), /already running/);
    const newest = concurrent.addObject(shapeInput); release();
    await assert.rejects(pending, /document changed/);
    assert.equal(concurrent.getPages().length, 2); assert.equal(concurrent.getObject(first).kind, "shape"); assert.equal(concurrent.getObject(newest).kind, "shape");
    assert(concurrent.getState().dirty, "internal PDF materialization cannot mark concurrent edits saved");
    assert(concurrent.undo()); assert.throws(() => concurrent.getObject(newest));
  } finally { release(); concurrent.dispose(); }

  const lifecycleServices = await createEditorAppServices({ sourcePdf: bytes });
  const releases = new Map(); let nextSource = 0, mode = "normal", cancelSource;
  const sourceFactory = async (sourcePdf, password) => {
    const options = await lifecycleServices.sessionOptions.createSourceOptions(sourcePdf, password), id = ++nextSource;
    const dispose = options.disposeSource;
    const result = { ...options, createSourceOptions: sourceFactory,
      disposeSource: () => { releases.set(id, (releases.get(id) ?? 0) + 1); dispose?.(); } };
    if (mode === "prepare-failure") result.prepareScene = async () => { throw new Error("Source preparation failed"); };
    if (mode === "cancel-source") cancelSource.abort();
    return result;
  };
  const lifecycle = await openEditorSession(scene, { ...lifecycleServices.sessionOptions, createSourceOptions: sourceFactory });
  try {
    await lifecycle.rotatePages([0], 90); assert.equal(nextSource, 1); assert.equal(releases.size, 0);
    lifecycle.undo(); lifecycle.addObject(shapeInput);
    assert.equal(releases.get(1), 1, "branching after undo immediately releases the discarded source version");
    const beforeFailure = lifecycle.sourceScene;
    mode = "prepare-failure";
    await assert.rejects(lifecycle.rotatePages([0], 90), /Source preparation failed/);
    assert.equal(releases.get(2), 1, "failed preparation releases source services exactly once");
    assert.equal(lifecycle.sourceScene, beforeFailure);
    mode = "cancel-source"; cancelSource = new AbortController();
    await assert.rejects(lifecycle.rotatePages([0], 90, { signal: cancelSource.signal }), { name: "AbortError" });
    assert.equal(releases.get(3), 1, "cancellation after source factory completion releases unclaimed source services");
    assert.equal(lifecycle.sourceScene, beforeFailure);
    assert(lifecycle.getState().dirty);
  } finally { lifecycle.dispose(); lifecycleServices.dispose(); }
  assert.deepEqual([...releases.values()], [1, 1, 1], "pruned and failed sources are never released twice");

  const modelServices = await createEditorAppServices({ sourcePdf: bytes });
  const modelFont = await modelServices.fonts.register(buildTinySfnt(), { family: "Retained author font" });
  const models = await openEditorSession(scene, modelServices.sessionOptions);
  try {
    const shape = models.addObject({ ...shapeInput, id: "primary-shape", pageIndex: 1, shape: "arrow", strokeWidth: 3, opacity: .7 });
    const ink = models.addObject({ kind: "ink", id: "primary-ink", pageIndex: 1, paths: [[[10, 35], [20, 45], [30, 35]]], color: "purple", strokeWidth: 2 });
    const signature = models.addObject({ kind: "signature", id: "primary-signature", pageIndex: 1, paths: [[[5, 60], [15, 70], [30, 60]]], color: "orange", strokeWidth: 4, opacity: .6 });
    const image = models.addObject({ kind: "image", id: "primary-image", pageIndex: 1, x: 45, y: 45, width: 8, height: 6,
      imageWidth: 2, imageHeight: 2, data: Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255) });
    const text = models.addObject({ kind: "text", id: "primary-text", pageIndex: 1, x: 3, y: 85, width: 50, height: 15,
      text: "AB", fontId: modelFont.id, fontSize: 7, runs: [{ text: "A", underline: true }, { text: "B", color: "red" }] });
    models.select([shape, image]); const group = models.groupSelection();
    const originalBounds = new Map([shape, ink, signature, image, text].map(id => [id, models.getObjectBounds(id)]));
    const oldScene = models.sourceScene, oldPage = oldScene.pdfPages.find(page => page.pageIndex === 1);
    await models.rotatePages([0, 1], 90);
    const newScene = models.sourceScene, newPage = newScene.pdfPages.find(page => page.pageIndex === 1);
    const placement = multiplyEditorMatrices(newPage.pdfToScene, invertEditorMatrix(oldPage.pdfToScene));
    for (const [id, kind] of [[shape, "shape"], [ink, "ink"], [signature, "signature"], [image, "image"], [text, "text"]]) {
      assert.equal(models.getObject(id).kind, kind, `${kind} retains its author controls after rotation`);
      const expected = editorTransformBounds(originalBounds.get(id), placement), actual = models.getObjectBounds(id);
      for (const key of ["minX", "minY", "maxX", "maxY"]) assert(Math.abs(actual[key] - expected[key]) < .001, `${kind} rotation matches its materialized page geometry`);
    }
    assert.deepEqual(models.getObject(group).children, [shape, image]);
    models.updateObject(shape, { color: "cyan", strokeWidth: 5, opacity: .3 });
    models.updateObject(ink, { color: "red", strokeWidth: 4 }); models.updateObject(signature, { color: "blue", strokeWidth: 6 });
    models.updateObject(image, { opacity: .25 }); models.updateObject(text, { text: "BA" });
    assert.equal((await models.getScene()).rasterLayers.length, 1, "reseeded images replace their baked appearance without duplication");
    await models.removePages([0]);
    for (const id of [shape, ink, signature, image, text]) assert.equal(models.getObject(id).pageIndex, 0, "surviving author models shift after removal");
    assert.equal(models.getObject(signature).strokeWidth, 6); assert.equal(models.getObject(image).opacity, .25);
    const incomingServices = await createEditorAppServices({ sourcePdf: foreign }, modelServices.fonts);
    const incoming = await openEditorSession(await compile(foreign), incomingServices.sessionOptions);
    let incomingBytes;
    try {
      incoming.addObject({ ...shapeInput, id: shape });
      incoming.addObject({ kind: "text", id: text, pageIndex: 0, x: 4, y: 35, width: 50, height: 15, text: "AB", fontId: modelFont.id, fontSize: 7 });
      incomingBytes = new Uint8Array(await (await incoming.savePdf()).arrayBuffer());
    } finally { incoming.dispose(); incomingServices.dispose(); }
    await models.insertPdf(incomingBytes, { at: 0, pages: [0] });
    const retained = models.getObjects(), retainedShape = retained.find(object => object.kind === "shape"), retainedText = retained.find(object => object.kind === "text");
    assert.notEqual(retainedShape.id, shape); assert.notEqual(retainedText.id, text, "foreign same-NM annotations get no author-ID collision");
    assert.equal(retainedShape.color, "cyan"); assert.equal(retainedShape.strokeWidth, 5); assert.equal(retainedText.text, "BA");
    assert.deepEqual(retained.find(object => object.kind === "group").children, [retainedShape.id, image], "retained groups follow remapped author IDs");
    for (const id of [ink, signature, image]) assert.equal(models.getObject(id).pageIndex, 1);
    models.updateObject(signature, { color: "green" }); models.updateObject(retainedShape.id, { strokeWidth: 7 });
    const current = await models.getScene(); assert.equal(current.rasterLayers.length, 1);
    const saved = new Uint8Array(await (await models.savePdf()).arrayBuffer()), savedScene = await compile(saved);
    assert.equal(savedScene.rasterLayers.length, 1);
    for (const id of [shape, text, retainedShape.id, retainedText.id, ink, signature, image]) assert.equal(savedScene.annotations.filter(annotation => annotation.name === id).length, 1, "PDF stores each retained/imported appearance once");
    const hep = await models.saveHep({ withVectorLod: false, withTextLod: false, encodeRasterImages: false }), hepScene = await loadSceneFromHep(await hep.arrayBuffer());
    assert.equal(hepScene.rasterLayers.length, current.rasterLayers.length); assert.equal(hepScene.fillPathCount, current.fillPathCount); assert.equal(hepScene.segmentCount, current.segmentCount);
    models.undo(); models.undo(); models.undo();
    assert.equal(models.getObject(shape).kind, "shape"); assert.equal(models.getObject(text).text, "BA", "undo restores the original author model before insertion");
  } finally { models.dispose(); modelServices.dispose(); }

  // HEP sources gain a PDF only for editing page structure; compact HEP output
  // still carries no original PDF or authoring history.
  const hepEditor = await openEditorSession(scene);
  try {
    assert.equal(hepEditor.sourcePdf, undefined); await hepEditor.rotatePages([1], -90);
    assert(hepEditor.sourcePdf); assert.equal(hepEditor.getPages()[1].rotation, 270);
    await hepEditor.insertPdf(foreign, { pages: [0] }); assert.equal(hepEditor.getPages().length, 3);
    assert(hepEditor.undo()); assert.equal(hepEditor.getPages().length, 2);
    assert(hepEditor.undo()); assert.equal(hepEditor.sourcePdf, undefined); assert.equal(hepEditor.sourceScene, scene);
  } finally { hepEditor.dispose(); }

  const password = "primary pages password", incomingPassword = "foreign pages password";
  const protectedBytes = new Uint8Array(await (await changePdfProtection(bytes, { mode: "password", password })).arrayBuffer());
  const incoming = new Uint8Array(await (await changePdfProtection(foreign, { mode: "password", password: incomingPassword })).arrayBuffer());
  const protectedEditor = await openEditorSession(await compile(protectedBytes, password), { sourcePdf: protectedBytes, password });
  try {
    await assert.rejects(protectedEditor.insertPdf(incoming), error => error?.details?.reason === "password-required");
    await protectedEditor.insertPdf(incoming, { at: 1, pages: [0], password: incomingPassword });
    await protectedEditor.rotatePages([0], 90); await protectedEditor.removePages([2]);
    const saved = new Uint8Array(await (await protectedEditor.savePdf()).arrayBuffer());
    await assert.rejects(NativePdfDocument.open({ kind: "bytes", bytes: saved }), error => error?.details?.reason === "password-required");
    const reopened = await NativePdfDocument.open({ kind: "bytes", bytes: saved }, { password });
    try { assert.equal(reopened.pages.length, 2); assert.equal(reopened.getPage(0).rotation, 90); }
    finally { await reopened.close(); }
  } finally { protectedEditor.dispose(); }
  assert.deepEqual(bytes, original); assert.deepEqual(foreign, foreignOriginal);
  console.log("Editor pages: page metadata, atomic rotation/removal/insertion, global undo/redo, editable text/fonts/fields, cancellation, concurrent edits, HEP and passwords passed.");
} finally { hooks.deregister(); }

function fixture(fields) {
  return writeTinyPdf({ objects: [
    { number: 1, body: `<< /Type /Catalog /Pages 2 0 R${fields ? " /AcroForm << /Fields [11 0 R] /NeedAppearances false /DA (/F 10 Tf 0 g) /DR << /Font << /F 6 0 R >> >> >>" : ""} >>` },
    { number: 2, body: "<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 80] /Contents 5 0 R /Resources << >> >>" },
    { number: 4, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 150 90] /Rotate ${fields ? 90 : 180} /Contents 9 0 R /Resources << >>${fields ? " /Annots [11 0 R]" : ""} >>` },
    { number: 5, body: tinyPdfStream("", "1 0 0 rg 10 10 20 20 re f") },
    { number: 6, body: "<< /Type /Font /Subtype /TrueType /BaseFont /Tiny /FirstChar 65 /LastChar 66 /Widths [600 700] /Encoding /WinAnsiEncoding /FontDescriptor 7 0 R >>" },
    { number: 7, body: "<< /Type /FontDescriptor /FontName /Tiny /Flags 32 /FontBBox [0 -200 1000 800] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 8 0 R >>" },
    { number: 8, body: tinyPdfStream("", buildTinySfnt()) },
    { number: 9, body: tinyPdfStream("", "0 0 1 rg 10 10 20 20 re f") },
    { number: 10, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 40 20] /Resources << /Font << /F 6 0 R >> >>", "BT /F 10 Tf 2 5 Td (A) Tj ET") },
    { number: 11, body: "<< /Type /Annot /Subtype /Widget /FT /Tx /T (Field) /V (A) /Rect [60 30 100 50] /AP << /N 10 0 R >> >>" }
  ] });
}
