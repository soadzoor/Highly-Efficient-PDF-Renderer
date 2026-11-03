import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { sceneFingerprint } from "./lib/sceneFingerprint.mjs";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
const hooks = registerHooks({ resolve(s, c, n) { return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c); } });
try {
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { createEditorRecoveryCodec } = await import("../src/editorRecoveryCodec.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const source = createEmptyVectorScene();
  Object.assign(source, { pageCount: 1, pagesPerRow: 1, pageTextRanges: Uint32Array.of(0, 0), pageRects: Float32Array.of(40, 70, 640, 470), bounds: { minX: 40, minY: 70, maxX: 640, maxY: 470 },
    pageBounds: { minX: 40, minY: 70, maxX: 640, maxY: 470 }, pdfPages: [{ pageIndex: 0, sourcePageIndex: 0, pdfToScene: [1, 0, 0, 1, 40, 70] }] });
  source.annotations = [["field:left", [30, 30, 230, 54]], ["field:right", [40, 110, 180, 134]]].map(([id, rect], annotationIndex) => ({
    id, pageIndex: 0, sourcePageIndex: 0, annotationIndex, subtype: "Widget", flags: 0, visibleInDefaultView: true, hasAppearance: false,
    pdfGeometry: { rect }, bounds: { minX: rect[0] + 40, minY: rect[1] + 70, maxX: rect[2] + 40, maxY: rect[3] + 70 },
    field: { name: "Shared", type: "Tx", flags: 0, value: "Seed" }
  }));
  source.annotations.push({ ...source.annotations[0], id: "comment", annotationIndex: 2, subtype: "Text", field: undefined });
  const asset = async url => new Uint8Array(await readFile(url));
  const services = await createEditorAppServices({ loadFontAsset: asset }), restoredServices = await createEditorAppServices({ loadFontAsset: asset });
  const editor = await openEditorSession(source, services.sessionOptions), restored = await openEditorSession(structuredClone(source), restoredServices.sessionOptions);
  try {
    const regular = await services.fonts.loadBundled(), bold = await services.fonts.loadBundled(undefined, { fontWeight: 700 });
    const layer = editor.createLayer({ name: "Author models" }); editor.setActiveLayer(layer);
    const text = editor.addObject({ kind: "text", pageIndex: 0, x: 250, y: 100, width: 180, height: 80, text: "Héllo world", fontSize: 14,
      fontId: regular.id, runs: [{ text: "Héllo ", fontId: regular.id, color: "#123456" }, { text: "world", fontId: bold.id, fontWeight: 700, underline: true, fontSize: 18 }] });
    const shape = editor.addObject({ kind: "shape", shape: "rectangle", pageIndex: 0, x: 20, y: 160, width: 50, height: 30, fill: "red", fillOpacity: .3, color: "blue", opacity: .7 });
    const image = editor.addObject({ kind: "image", pageIndex: 0, x: 350, y: 220, width: 20, height: 20, imageWidth: 1, imageHeight: 1, data: Uint8Array.of(12, 34, 56, 128) });
    const signature = editor.addObject({ kind: "signature", pageIndex: 0, paths: [[[2, 3], [8, 10], [15, 2]]], smoothing: .2, strokeWidth: 3, color: "purple" });
    editor.select([text, shape, image, signature]); const group = editor.groupSelection();
    editor.transformSelection([0, 1, -1, 0, 400, 0]);
    editor.setFieldValue("Shared", "Current value"); editor.selectAnnotations(["field:left"]);
    const c = Math.cos(.4), s = Math.sin(.4); editor.transformSelection([c, s, -s, c, 20, -10]);
    const beforeMetadata = editor.getState(); assert.throws(() => editor.updateAnnotation("field:left", { author: "Cannot rename the field" }), /Widget.*field name/);
    assert.deepEqual(editor.getState(), beforeMetadata, "rejecting Widget author metadata cannot rename a field or create history");
    editor.updateAnnotation("field:left", { contents: "Discussion" }); editor.updateAnnotation("comment", { contents: "Comment", author: "Local author" });
    editor.select([shape]); await editor.copySelection(); editor.selectAnnotations(["field:left"]);
    const [duplicate] = await editor.duplicateSelection({ offset: [250, 0] }); assert.equal(editor.getObject(duplicate).kind, "source");
    const [clipboard] = editor.pasteSelection(); assert.equal(editor.getObject(clipboard).kind, "shape", "duplicate never replaces the existing clipboard"); editor.deleteSelection();
    editor.setFieldValue("Shared", "Later value"); editor.select([group]); editor.setObjectsLocked([group], true);
    const expected = await editor.getScene({ preview: false }), before = editor.getState(), snapshot = await editor.captureRecovery();
    assert.deepEqual(editor.getState(), before, "checkpoint creation does not clear dirty state or create history");
    assert(snapshot.fonts.some(font => font.id === regular.id) && snapshot.fonts.some(font => font.id === bold.id));
    assert(!("password" in snapshot) && !("history" in snapshot));
    const codec = createEditorRecoveryCodec(), envelope = await codec.encode(snapshot), decoded = await codec.decode(envelope);
    await restored.restoreRecovery(decoded.snapshot);
    assert.deepEqual(restored.getObjects({ includeSource: false }), editor.getObjects({ includeSource: false }));
    assert.deepEqual(restored.getFieldValues(), editor.getFieldValues()); assert.deepEqual(restored.getSourceEdits(), editor.getSourceEdits());
    assert.deepEqual(restored.getAnnotationEdits(), editor.getAnnotationEdits()); assert.deepEqual(restored.getLayerEdits(), editor.getLayerEdits());
    assert.equal(restored.getActiveLayer(), layer); assert(restored.isObjectLocked(group)); assert(restored.isObjectLocked(text));
    assert.deepEqual(restoredServices.fonts.get(regular.id).bytes, regular.bytes, "actual authoring font programs survive recovery");
    assert.equal(sceneFingerprint(await restored.getScene({ preview: false })), sceneFingerprint(expected), "committed rendering and rotated field/copy geometry round-trip exactly");
    const invalid = structuredClone(snapshot); invalid.data.state.objects.get(shape).width = -1;
    const stable = restored.getState(); await assert.rejects(restored.restoreRecovery(invalid), /Width/); assert.deepEqual(restored.getState(), stable);
    await restored.savePdf({ markSaved: false }); assert(restored.getState().dirty, "export can serialize without claiming a browser file was saved");
    const hep = await restored.saveHep({ markSaved: false, withVectorLod: false, withTextLod: false }); assert(restored.getState().dirty);
    const reopened = await loadSceneFromHep(await hep.arrayBuffer()); assert(!("recovery" in reopened) && !("editor" in reopened));
    restored.setObjectsLocked([group], false); restored.select([text]); restored.updateObject(text, { text: "Still editable", runs: undefined });
    assert.equal(restored.getObject(text).text, "Still editable");
  } finally { editor.dispose(); restored.dispose(); services.dispose(); restoredServices.dispose(); }

  const bytes = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" }, { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << >> >>" },
    { number: 4, body: tinyPdfStream("", "1 0 0 rg 10 10 20 20 re f") }
  ] });
  const compile = async (input, password) => { const parser = await openPdf({ kind: "bytes", bytes: input }, { password }); try { return await parser.compileVectorPage(0, { optimization: "none" }); } finally { await parser.close(); } };
  // Fixed ISO 32000 R2 reference fixture: empty user password, owner "owner".
  // No content streams or strings need encryption in this blank document.
  const emptyPasswordBytes = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" }, { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>" },
    { number: 4, body: "<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O <c92422687facee686e373f10b5c7d04738053152f7e2ee30e11c69ec442576ab> /U <adb43c8d5c0a904ecd6878928abf0a1ef65fa75e1632b2134005fa3b1d844c68> >>" }
  ], trailerEntries: "/Encrypt 4 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]" });
  const plainServices = await createEditorAppServices({ sourcePdf: bytes }), emptyPasswordServices = await createEditorAppServices({ sourcePdf: emptyPasswordBytes });
  try {
    assert.equal(await plainServices.isSourceProtected(), false);
    assert.equal(await emptyPasswordServices.isSourceProtected(), true, "a no-form PDF opening without a password can still require encrypted recovery");
    const canceled = new AbortController(); canceled.abort(); await assert.rejects(emptyPasswordServices.isSourceProtected(canceled.signal), { name: "AbortError" });
  } finally { plainServices.dispose(); emptyPasswordServices.dispose(); }
  const initial = await openEditorSession(await compile(bytes), { sourcePdf: bytes }); let protectedBytes;
  try { protectedBytes = new Uint8Array(await (await initial.savePdf({ protection: { mode: "password", password: "unlock" } })).arrayBuffer()); } finally { initial.dispose(); }
  const protectedSource = await compile(protectedBytes, "unlock"), encrypted = await openEditorSession(protectedSource, { sourcePdf: protectedBytes, password: "unlock" });
  const wrong = await openEditorSession(await compile(bytes), { sourcePdf: bytes });
  const unlocked = await openEditorSession(protectedSource, { sourcePdf: protectedBytes, password: "unlock" });
  try {
    encrypted.addObject({ kind: "shape", shape: "ellipse", pageIndex: 0, x: 30, y: 40, width: 10, height: 20 });
    await encrypted.rotatePages([0], 90); await encrypted.insertPdf(bytes);
    const expected = await encrypted.getScene({ preview: false }), snapshot = await encrypted.captureRecovery(); const before = wrong.getState();
    await assert.rejects(wrong.restoreRecovery(snapshot), error => error.code === "encrypted"); assert.deepEqual(wrong.getState(), before, "recovery cannot bypass normal PDF password verification");
    await unlocked.restoreRecovery(snapshot); assert.equal(unlocked.getObjects({ includeSource: false }).length, 1);
    assert.deepEqual(unlocked.getPages(), encrypted.getPages(), "recovery restores rotated/merged page state rather than only the reopened source");
    assert.equal(sceneFingerprint(await unlocked.getScene({ preview: false })), sceneFingerprint(expected));
  } finally { encrypted.dispose(); wrong.dispose(); unlocked.dispose(); }

  const localSource = createEmptyVectorScene(); localSource.pageCount = 1; localSource.pageRects = Float32Array.of(0, 0, 100, 100); localSource.pageTextRanges = Uint32Array.of(0, 0);
  const local = createEditorSession(localSource);
  try { const id = local.addObject({ kind: "shape", shape: "rectangle", pageIndex: 0, x: 1, y: 2, width: 5, height: 5 });
    const snapshot = await local.captureRecovery(); snapshot.data.state.objects.get(id).x = 900; assert.equal(local.getObject(id).x, 1, "snapshots own their editable data"); }
  finally { local.dispose(); }
  console.log("Editor recovery: author models/fonts/groups/images, fields/source copies/frames, locks/layers/metadata, dirty exports, HEP isolation and protected-source verification passed.");
} finally { hooks.deregister(); }
