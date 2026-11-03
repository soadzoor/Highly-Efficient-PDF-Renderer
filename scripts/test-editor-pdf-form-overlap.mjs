import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });
try {
  const { findEditorPdfFormOverlaps: find } = await import("../src/editorPdfFormOverlap.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { bakeEditorAnnotationEdits, setEditorAnnotationSource } = await import("../src/editorScene.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { NativePdfFormAppearanceRegistry } = await import("../src/pdf/nativeForms.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const rect = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY });
  const widget = (id = "field", bounds = rect(10, 10, 40, 40), pageIndex = 0, annotationIndex = 0) => ({
    id, subtype: "Widget", sourcePageIndex: 7 + pageIndex, pageIndex, annotationIndex,
    pdfGeometry: { rect: [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY] }, bounds,
    flags: 4, visibleInDefaultView: true, hasAppearance: true, field: { name: id, flags: 0, type: "Tx" }
  });
  const annotation = (id, annotationIndex, subtype = "Ink", extra = {}) => ({ ...widget(id), annotationIndex, subtype, field: undefined, ...extra });
  const ink = (id = "drawn", pageIndex = 0, extra = {}) => ({ id, kind: "ink", pageIndex,
    transform: [1, 0, 0, 1, 0, 0], paths: [[[20, 20], [30, 30]]], strokeWidth: 2, ...extra });
  const scene = (annotations = [widget()]) => Object.assign(createEmptyVectorScene(), {
    pageCount: 2, pagesPerRow: 2, pageRects: Float32Array.of(0, 0, 100, 100, 200, 0, 300, 100),
    annotations, bounds: rect(0, 0, 300, 100), pageBounds: rect(0, 0, 300, 100)
  });
  const session = (objects = [ink()], boxes = {}) => ({
    getObjects() { return objects; },
    getObjectBounds(id) { return boxes[id] ?? rect(20, 20, 30, 30); }
  });
  const pair = (widgetId = "field", objectId = "drawn", pageIndex = 0, objectKind = "ink") =>
    ({ pageIndex, widgetId, fieldName: widgetId, objectId, objectKind });

  const original = scene(), originalMetadata = JSON.stringify(original.annotations);
  assert.deepEqual(find(original, session()), [pair()]);
  assert.equal(JSON.stringify(original.annotations), originalMetadata, "overlap queries do not mutate document metadata");
  assert.deepEqual(find(original, session([ink()], { drawn: rect(41, 20, 50, 30) })), []);
  assert.deepEqual(find(original, session([ink()], { drawn: rect(40, 20, 50, 30) })), [], "touching bounds do not imply painted overlap");
  for (const bounds of [rect(20, 25, 30, 25), rect(25, 20, 25, 30), rect(25, 25, 25, 25), rect(40, 20, 40, 30)]) {
    assert.deepEqual(find(original, session([ink("hairline", 0, { strokeWidth: 0 })], { hairline: bounds })), [pair("field", "hairline")],
      "zero-width/height hairlines and dots retain potential form overlap, including a conservative field boundary");
  }
  assert.deepEqual(find(original, session([ink("hairline", 0, { strokeWidth: 0 })], { hairline: rect(41, 20, 41, 30) })), [],
    "a hairline outside the field does not become a false overlap through artificial expansion");
  assert.deepEqual(find(original, session([ink("hairline", 0, { strokeWidth: 0, opacity: 0 })], { hairline: rect(25, 25, 25, 25) })), []);
  assert.deepEqual(find(original, session([ink("empty", 0, { strokeWidth: 0, paths: [[]] })], { empty: rect(25, 25, 25, 25) })), []);
  assert.deepEqual(find(original, session([{ id: "hairline-clone", kind: "source", pageIndex: 0, isClone: true, primitives: [] }],
    { "hairline-clone": rect(25, 20, 25, 30) })), [pair("field", "hairline-clone", 0, "source")]);
  const hairlines = await openEditorSession(original);
  try {
    for (const [points, expected] of [
      [[[20, 25], [30, 25]], rect(20, 25, 30, 25)],
      [[[25, 20], [25, 30]], rect(25, 20, 25, 30)],
      [[[25, 25]], rect(25, 25, 25, 25)]
    ]) {
      const id = hairlines.addObject({ kind: "ink", pageIndex: 0, paths: [points], strokeWidth: 0 });
      assert.deepEqual(hairlines.getObjectBounds(id), expected, "the actual session retains zero-area hairline bounds without a minimum-width expansion");
    }
    assert.equal(find(original, hairlines).length, 3, "real session hairlines and point strokes remain detectable");
  } finally { hairlines.dispose(); }
  assert.deepEqual(find(original, session([ink("other-page", 1)])), [], "coincident local coordinates on different pages do not overlap");
  const second = scene([widget("second", rect(220, 20, 250, 50), 1)]);
  assert.deepEqual(find(second, session([ink("drawn", 1)], { drawn: rect(230, 30, 240, 40) })), [pair("second", "drawn", 1)],
    "composed page placement and current page slots are independent of PDF source page indexes");
  const outside = scene([widget("cropped", rect(90, 20, 110, 40))]);
  assert.deepEqual(find(outside, session([ink()], { drawn: rect(100, 25, 105, 35) })), [], "overlap outside the displayed page crop is ignored");
  assert.deepEqual(find(outside, session([ink()], { drawn: rect(99, 25, 105, 35) })), [pair("cropped")]);
  for (const flags of [1, 2, 32]) assert.deepEqual(find(scene([{ ...widget(), flags }]), session()), [], "Invisible, Hidden and NoView widgets are excluded");
  assert.deepEqual(find(scene([{ ...widget(), visibleInDefaultView: false }]), session()), []);
  assert.deepEqual(find(scene([{ ...widget(), hasAppearance: false }]), session()), [pair()], "blank fields may acquire appearances in an independent reader");
  assert.deepEqual(find(scene([{ ...widget(), field: { name: "field", flags: 1 } }]), session()), [pair()], "read-only fields still paint above ordinary annotations");
  const layered = scene([{ ...widget(), optionalContent: 0 }]);
  layered.optionalContent = { groups: [{ id: "off", name: "Hidden fields", defaultVisible: false, locked: false, usedInView: true }],
    conditions: [{ kind: "group", groupId: "off" }], order: [], radioGroups: [] };
  assert.deepEqual(find(layered, session()), [], "default-hidden PDF layers do not produce visible form overlaps");
  const shownLayer = { ...layered, optionalContent: { ...layered.optionalContent,
    groups: [{ ...layered.optionalContent.groups[0], defaultVisible: true }] } };
  assert.deepEqual(find(shownLayer, session()), [pair()]);
  assert.deepEqual(find({ ...shownLayer, annotations: [{ ...shownLayer.annotations[0], visibleInDefaultView: false }] }, session()), [pair()],
    "the current compiled layer condition takes precedence over a previously hidden annotation snapshot");

  const objects = [ink("ink"), ink("signature", 0, { kind: "signature" }), ink("transparent", 0, { opacity: 0 }), ink("empty", 0, { paths: [[]] }),
    { id: "text", kind: "text", pageIndex: 0, text: "Words" }, { id: "empty-text", kind: "text", pageIndex: 0, text: "" },
    { id: "rich", kind: "text", pageIndex: 0, text: "", runs: [{ text: "Rich text" }] },
    { id: "group", kind: "group", pageIndex: 0, children: ["ink", "signature"] },
    { id: "source", kind: "source", pageIndex: 0, primitives: [{ kind: "stroke", index: 0 }] },
    { id: "clone", kind: "source", pageIndex: 0, isClone: true, primitives: [{ kind: "stroke", index: 0 }] },
    { id: "image", kind: "image", pageIndex: 0 }, { id: "shape", kind: "shape", pageIndex: 0 }];
  assert.deepEqual(find(original, session(objects)).map(overlap => overlap.objectId), ["ink", "signature", "text", "rich", "clone", "image", "shape"],
    "author content and source clones are checked without double-counting groups or ordinary source primitives");
  const untouched = { getObjects() { assert.fail("a document without visible widgets needs no object query"); }, getObjectBounds() { assert.fail(); } };
  assert.deepEqual(find(scene([]), untouched), []);

  const moved = bakeEditorAnnotationEdits(original, [{ id: "field", transform: [1, 0, 0, 1, 50, 0], deleted: false }]);
  assert.deepEqual(find(moved, session()), [], "moved fields use committed positions rather than original rectangles");
  assert.deepEqual(find(moved, session([ink()], { drawn: rect(70, 20, 80, 30) })), [pair()]);
  assert.deepEqual(find(bakeEditorAnnotationEdits(moved, [{ id: "field", transform: [1, 0, 0, 1, 0, 0], deleted: true }]), session()), [],
    "deleted fields are absent from the committed scene");
  const narrow = widget("rotated", rect(20, 20, 60, 30)), c = Math.SQRT1_2;
  const rotation = [c, c, -c, c, 40 - c * 40 + c * 25, 25 - c * 40 - c * 25];
  const rotated = bakeEditorAnnotationEdits(scene([narrow]), [{ id: narrow.id, transform: rotation, deleted: false }]);
  const emptyCorner = session([ink()], { drawn: rect(23, 8, 25, 10) });
  assert.deepEqual(find(rotated, emptyCorner), [], "a recovered rotated field frame rejects empty corners of its enclosing AABB");
  assert.deepEqual(find(rotated, session([ink()], { drawn: rect(39, 24, 41, 26) })), [pair("rotated")]);
  assert.deepEqual(find(rotated, session([ink("hairline", 0, { strokeWidth: 0 })], { hairline: rect(35, 25, 45, 25) })), [pair("rotated", "hairline")],
    "rotated widget SAT retains a zero-height visible line through the field");
  assert.deepEqual(find(rotated, session([ink("point", 0, { strokeWidth: 0 })], { point: rect(40, 25, 40, 25) })), [pair("rotated", "point")],
    "rotated widget SAT retains a point with zero projection length on every axis");
  assert.deepEqual(find(rotated, session([ink("hairline", 0, { strokeWidth: 0 })], { hairline: rect(24, 8, 24, 10) })), [],
    "rotated widget SAT still rejects a degenerate line in an empty enclosing-box corner");
  const recovered = { ...rotated }; setEditorAnnotationSource(recovered, narrow, rotation);
  assert.deepEqual(find(recovered, emptyCorner), [], "reopened PDF field frames use their recovered baseline transform exactly once");
  assert.deepEqual(find({ ...rotated }, emptyCorner), [pair("rotated")], "metadata without an exact field frame retains conservative potential-overlap detection");

  const reopened = scene([widget("field", rect(10, 10, 40, 40), 0, 5), annotation("old-ink", 4), annotation("saved-ink", 6),
    annotation("link", 7, "Link"), annotation("popup", 8, "Popup"), annotation("hidden", 9, "Square", { flags: 2 })]);
  assert.deepEqual(find(reopened, session([])), [{ ...pair("field", "annotation:saved-ink", 0, "annotation"), annotationSubtype: "Ink" }],
    "only visible reopened annotations after the widget can change relative paint order");
  assert.deepEqual(find(scene([widget(), annotation("generated-ink", 1, "Ink", { hasAppearance: false })]), session([])),
    [{ ...pair("field", "annotation:generated-ink", 0, "annotation"), annotationSubtype: "Ink" }], "reader-generated markup appearances remain conservatively covered");
  assert.deepEqual(find(scene([widget(), annotation("saved-hairline", 1, "Line", { bounds: rect(20, 25, 30, 25) })]), session([])),
    [{ ...pair("field", "annotation:saved-hairline", 0, "annotation"), annotationSubtype: "Line" }], "reopened hairline annotations retain potential overlap");
  assert.throws(() => find(original, session(), { signal: AbortSignal.abort() }), { name: "AbortError" });
  const cancel = new AbortController(); let checks = 0;
  assert.throws(() => find(scene(Array.from({ length: 100 }, (_, index) => widget(`field-${index}`))), session(), {
    signal: { throwIfAborted() { if (++checks === 20) cancel.abort(); cancel.signal.throwIfAborted(); } }
  }), { name: "AbortError" });
  assert.equal(checks, 20, "large overlap queries check cancellation while walking field metadata");

  const sourcePdf = pdfFixture(), parser = await openPdf({ kind: "bytes", bytes: sourcePdf }); let pdfScene;
  try {
    const pages = [];
    for (let index = 0; index < parser.info.pageCount; index++) pages.push(await parser.compileVectorPage(index, { optimization: "none" }));
    pdfScene = composeVectorScenesInGrid(pages, 2);
  } finally { await parser.close(); }
  const editor = await openEditorSession(pdfScene, { sourcePdf, loadFontAsset: async url => new Uint8Array(await readFile(url)) });
  try {
    const field = editor.sourceScene.annotations.find(annotation => annotation.field?.name === "Second"), offset = field.pageIndex * 4;
    const x = (field.bounds.minX + field.bounds.maxX) / 2 - editor.sourceScene.pageRects[offset];
    const y = (field.bounds.minY + field.bounds.maxY) / 2 - editor.sourceScene.pageRects[offset + 1];
    const id = editor.addObject({ kind: "ink", pageIndex: field.pageIndex, paths: [[[x - 2, y], [x + 2, y]]], strokeWidth: 2 });
    const query = async () => find(await editor.getScene({ preview: false }), editor);
    assert.deepEqual((await query()).map(pair => [pair.pageIndex, pair.fieldName, pair.objectId]), [[1, "Second", id]],
      "a PDF crop and quarter-turn page rotation do not change overlap geometry");
    editor.select([id]); const [duplicate] = editor.cloneSelection([1, 0]);
    assert.equal((await query()).length, 2);
    const warnings = [], editableBytes = new Uint8Array(await (await editor.savePdf({ onWarning: warning => warnings.push(warning) })).arrayBuffer());
    assert.equal(warnings.filter(warning => warning.startsWith("Artwork may overlap form fields.")).length, 1,
      "an editable PDF reports potential form layering once, even for several overlapping objects");
    const editable = await NativePdfDocument.open({ kind: "bytes", bytes: editableBytes });
    try {
      const registry = new NativePdfFormAppearanceRegistry(editable), annotations = [];
      for (let page = 0; page < editable.pages.length; page++) annotations.push(...await registry.listPageAnnotations(page));
      assert.equal(annotations.filter(annotation => annotation.subtype === "Widget").length, 2, "the editable save retains native form widgets");
      assert.equal(annotations.filter(annotation => annotation.subtype === "Ink").length, 2, "the editable save retains ordinary Ink annotations");
      assert.equal((await registry.getAcroFormMetadata()).fields.length, 2);
    } finally { await editable.close(); }
    const flatWarnings = [], flattenedBytes = new Uint8Array(await (await editor.savePdf({ flatten: true, onWarning: warning => flatWarnings.push(warning) })).arrayBuffer());
    assert(!flatWarnings.some(warning => warning.startsWith("Artwork may overlap form fields.")), "flattened copies need no editable-form layering warning");
    const flattened = await NativePdfDocument.open({ kind: "bytes", bytes: flattenedBytes });
    try {
      assert(!flattened.catalog.has("AcroForm"), "the flattened copy has no live form field tree");
      for (const page of flattened.pages) assert(!page.annotations || !(await flattened.resolveValue(page.annotations))?.length,
        "the flattened copy contains no remaining annotations");
    } finally { await flattened.close(); }
    editor.select([duplicate]); editor.deleteSelection();
    await editor.rotatePages([1], 90);
    assert.deepEqual((await query()).map(pair => [pair.pageIndex, pair.fieldName, pair.objectId]), [[1, "Second", id]],
      "page rotation preserves overlapping author objects while replacing baked source annotations");
    await editor.removePages([0]);
    assert.deepEqual((await query()).map(pair => [pair.pageIndex, pair.fieldName, pair.objectId]), [[0, "Second", id]],
      "page removal uses the new displayed page index without stale or duplicate warnings");
    const hep = await editor.saveHep({ withVectorLod: false, withTextLod: false, encodeRasterImages: false });
    const baked = await loadSceneFromHep(await hep.arrayBuffer());
    assert(baked.annotations.some(annotation => annotation.field?.name === "Second"));
    assert.deepEqual(find(baked, session([])), [], "HEP geometry has no invented author-object identities or editor persistence to inspect");
    editor.select([id]); editor.deleteSelection(); assert.deepEqual(await query(), [], "deleted author objects do not leave stale overlap candidates");
    assert(editor.undo()); assert.equal((await query()).length, 1, "undo restores the authored overlap");
  } finally { editor.dispose(); }
  console.log("PDF form overlap: visible widgets, author/cloned/reopened overlays, affine frames, crops/pages, deletion/undo, HEP and cancellation passed.");
} finally { hooks.deregister(); }

function pdfFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R 6 0 R] >> >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 150 200] /CropBox [10 20 110 100] /Annots [5 0 R] /Resources << >> >>" },
    { number: 4, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 150 200] /CropBox [10 20 110 170] /Rotate 90 /Annots [6 0 R] /Resources << >> >>" },
    { number: 5, body: "<< /Type /Annot /Subtype /Widget /FT /Btn /Ff 65536 /T (First) /Rect [30 40 70 60] /F 4 /AP << /N 7 0 R >> >>" },
    { number: 6, body: "<< /Type /Annot /Subtype /Widget /FT /Btn /Ff 65536 /T (Second) /Rect [40 60 80 80] /F 4 /AP << /N 7 0 R >> >>" },
    { number: 7, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 40 20] /Resources << >>", ".7 0 .7 rg 0 0 40 20 re f") }
  ] });
}
