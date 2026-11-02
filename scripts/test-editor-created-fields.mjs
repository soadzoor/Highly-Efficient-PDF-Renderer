import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { editorFieldClientGeometry } = await import("../src/editorCoordinates.ts");
  const { getEditorAnnotationSource, getEditorAnnotationFrameTransform } = await import("../src/editorScene.ts");
  const { getSceneAnnotationRuns } = await import("../src/scenePrimitives.ts");
  const { captureEditorPageChanges, changedEditorPages } = await import("../src/editorPageChanges.ts");
  const { editorPaintRole } = await import("../src/editorPaintIdentity.ts");
  const scene = buildStrokeScene([{ points: [[0, 0], [200, 0]], width: 1 }]);
  scene.pageCount = 2; scene.pageRects = Float32Array.of(0, 0, 200, 200, 250, 0, 450, 200); scene.pageTextRanges = new Uint32Array(4);
  scene.pdfPages = [{ pageIndex: 0, sourcePageIndex: 0, pdfToScene: [1, 0, 0, 1, 0, 0] },
    { pageIndex: 1, sourcePageIndex: 1, pdfToScene: [0, 1, -1, 0, 450, 0] }];
  const services = await createEditorAppServices(), session = createEditorSession(scene, services.sessionOptions);
  const field = (name, fieldType = "text", extra = {}) => ({ kind: "field", name, fieldType, pageIndex: 0,
    x: 10, y: 20, width: 100, height: 25, fontSize: 12, ...extra });
  try {
    const text = session.addObject(field("Name", "text", { value: "Árvíz 中文" }));
    assert.equal(session.getObject(text).color, 0); assert.equal(session.getObject(text).fill, "#ffffff");
    let compiled = await session.getScene();
    assert.equal(compiled.annotations.find(annotation => annotation.id === text).field.type, "Tx");
    assert(compiled.textInstanceCount > 0); assert(getSceneAnnotationRuns(compiled).get(text).length > 0);
    const roles = editorPaintRole(compiled);
    assert(getSceneAnnotationRuns(compiled).get(text).some(run => roles({ kind: run.kind, index: run.first }) === "color"));
    assert(getSceneAnnotationRuns(compiled).get(text).some(run => roles({ kind: run.kind, index: run.first }) === "fill"));
    assert(getSceneAnnotationRuns(compiled).get(text).some(run => roles({ kind: run.kind, index: run.first }) === null), "field borders are not recolored by text Color previews");
    session.selectAnnotations([text]); assert.deepEqual(session.getSelection(), [text]); assert(session.isAnnotationVisible(text));
    const before = captureEditorPageChanges(session); session.setFieldValue("Name", "New value");
    assert.deepEqual(changedEditorPages(before, captureEditorPageChanges(session)), [0]);
    assert.equal(session.getFieldValues().get("Name"), "New value"); assert.equal(session.getSourceEdits().length, 0);
    assert(session.undo()); assert.equal(session.getFieldValues().get("Name"), "Árvíz 中文"); assert(session.redo());
    const number = session.addObject(field("Amount", "number", { value: "12.50" }));
    session.setFieldValue("Amount", "-3.25e2"); assert.equal(session.getObject(number).value, "-3.25e2");
    assert.throws(() => session.setFieldValue("Amount", "NaN"), /number/);
    session.addObject(field("Date", "date", { value: "2024-02-29" }));
    assert.throws(() => session.setFieldValue("Date", "2025-02-29"), /date/);
    session.addObject(field("Short", "text", { maxLength: 3 })); assert.throws(() => session.setFieldValue("Short", "Long"), /at most/);
    session.addObject(field("ReadOnly", "text", { readOnly: true })); assert.throws(() => session.setFieldValue("ReadOnly", "x"), /read-only/);
    assert.throws(() => session.addObject(field("Name")), /already uses/);
    assert.throws(() => session.addObject(field("Person.Name")), /periods/);
    const check = session.addObject(field("Accept", "checkbox", { width: 18, height: 18 })); session.setFieldValue("Accept", true);
    const a = session.addObject(field("Choice", "radio", { onValue: "A", width: 18, height: 18 }));
    const b = session.addObject(field("Choice", "radio", { onValue: "B", width: 18, height: 18, x: 40 }));
    session.setFieldValue("Choice", "B"); assert.equal(session.getObject(a).value, "B"); assert.equal(session.getObject(b).value, "B");
    assert.throws(() => session.setFieldValue("Choice", "C"), /available radio/);
    assert.throws(() => session.addObject(field("Choice", "radio", { onValue: "A" })), /distinct export/);
    const c = session.addObject(field("Choice", "radio", { onValue: "C", value: "C", defaultValue: "C" }));
    assert.equal(session.getObject(a).value, "C"); assert.equal(session.getObject(b).value, "C"); assert.equal(session.getObject(a).defaultValue, "C");
    assert(session.undo()); assert.equal(session.getObject(a).value, "B"); assert.equal(session.getObject(a).defaultValue, undefined);
    assert(session.redo()); assert.equal(session.getObject(c).value, "C");
    session.updateObject(b, { required: true }); assert(session.getObject(a).required); assert(session.getObject(c).required);
    assert.throws(() => session.addObject(field("Choice", "radio", { onValue: "D", required: false })), /share required/);
    session.updateObject(c, { onValue: "UpdatedC" }); assert.equal(session.getObject(a).value, "UpdatedC"); assert.equal(session.getObject(b).defaultValue, "UpdatedC");
    session.select([c]); session.deleteSelection(); assert.equal(session.getObject(a).value, "Off"); assert.equal(session.getObject(a).defaultValue, "Off");
    assert(session.undo()); assert.equal(session.getObject(a).value, "UpdatedC");
    session.setFieldValue("Choice", "B");
    const metadataBefore = captureEditorPageChanges(session); session.updateObject(b, { tooltip: "Choose one", required: false });
    assert.deepEqual(changedEditorPages(metadataBefore, captureEditorPageChanges(session)), [], "field validation metadata does not refresh page thumbnails");
    session.updateObject(a, { name: "Separate radio" }); assert.equal(session.getObject(a).value, "Off"); assert.equal(session.getObject(b).value, "B");
    session.updateObject(a, { name: "Choice" }); assert.equal(session.getObject(a).value, "B"); assert.equal(session.getObject(b).value, "B");
    session.addObject(field("Dropdown", "dropdown", { options: [{ value: "one", label: "First" }, { value: "two", label: "Second" }] }));
    session.setFieldValue("Dropdown", "two"); assert.throws(() => session.setFieldValue("Dropdown", "missing"), /available field/);
    session.addObject(field("List", "list", { multiSelect: true, options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }] }));
    session.setFieldValue("List", ["a", "b"]);
    compiled = await session.getScene();
    assert.equal(compiled.annotations.find(annotation => annotation.id === check).field.appearanceState, "Yes");
    assert.equal(compiled.annotations.find(annotation => annotation.id === a).field.appearanceState, "Off");
    assert.equal(compiled.annotations.find(annotation => annotation.id === b).field.appearanceState, "B");
    const rotated = session.addObject(field("Rotated", "text", { pageIndex: 1, value: "Rotated", x: 30, y: 40, transform: [0, 1, -1, 0, 100, 0] }));
    compiled = await session.getScene();
    const annotation = getEditorAnnotationSource(compiled, rotated), matrix = getEditorAnnotationFrameTransform(compiled, rotated);
    const geometry = editorFieldClientGeometry(annotation, compiled.pdfPages, point => point, matrix);
    assert.equal(geometry.width, 100); assert.equal(geometry.height, 25);
    assert.deepEqual(geometry.transform.map(value => value || 0), [0, 1, 1, 0, 0, 0]);
    session.setFieldValue("Rotated", "Changed"); const after = await session.getScene();
    const nextGeometry = editorFieldClientGeometry(getEditorAnnotationSource(after, rotated), after.pdfPages, point => point, getEditorAnnotationFrameTransform(after, rotated));
    assert.deepEqual(nextGeometry, geometry, "editing an authored rotated field preserves its local input axes and dimensions");
    session.select([text]); const copies = await session.duplicateSelection({ offset: [0, 0] });
    assert.notEqual(session.getObject(copies[0]).name, "Name");
    session.select([a, b]); await session.copySelection(); const radios = session.pasteSelection({ offset: [0, 0] }).map(id => session.getObject(id));
    assert.equal(radios[0].name, radios[1].name); assert.notEqual(radios[0].name, "Choice");
    session.select([rotated]); session.deleteSelection(); assert(!session.getObjects().some(object => object.id === rotated)); assert(session.undo());
    const recovery = await session.captureRecovery(); const recovered = createEditorSession(scene, services.sessionOptions);
    try { await recovered.restoreRecovery(recovery); assert.equal(recovered.getFieldValues().get("Amount"), "-3.25e2"); assert.equal(recovered.getObject(rotated).kind, "field"); }
    finally { recovered.dispose(); }
    const hep = await session.saveHep({ markSaved: false }); assert(hep.size > 0);
  } finally { session.dispose(); services.dispose(); }
  const document = await openEditorSession(scene);
  try {
    document.addObject(field("PageText", "text", { value: "Page copy" }));
    document.addObject(field("PageRadio", "radio", { onValue: "A" }));
    document.addObject(field("PageRadio", "radio", { onValue: "B", value: "B", defaultValue: "B", pageIndex: 1 }));
    await document.duplicatePages([0, 1], { at: 2 });
    const fields = document.getObjects().filter(object => object.kind === "field");
    assert.equal(fields.length, 6, "page duplication retains author models for every widget");
    const originalText = fields.find(object => object.fieldType === "text" && object.pageIndex === 0), copiedText = fields.find(object => object.fieldType === "text" && object.pageIndex === 2);
    assert.notEqual(copiedText.name, originalText.name, "duplicated pages have independent text fields");
    const copiedRadios = fields.filter(object => object.fieldType === "radio" && object.pageIndex >= 2);
    assert.equal(copiedRadios[0].name, copiedRadios[1].name); assert.notEqual(copiedRadios[0].name, "PageRadio");
    assert.equal(copiedRadios[0].value, "B"); assert.equal(copiedRadios[1].defaultValue, "B");
    const compiled = await document.getScene();
    assert.equal(compiled.annotations.filter(annotation => annotation.field && annotation.visibleInDefaultView).length, 6, "page operations do not duplicate saved and authored widget appearances");
    assert(document.undo()); assert.equal(document.getObjects().filter(object => object.kind === "field").length, 3);
    assert(document.redo()); assert.equal(document.getObjects().filter(object => object.kind === "field").length, 6);
  } finally { document.dispose(); }
  const hepOnly = await openEditorSession({ ...scene, pdfPages: undefined });
  try {
    const id = hepOnly.addObject(field("Hep field", "text", { pageIndex: 1, transform: [0, 1, -1, 0, 100, 0] }));
    const scene = await hepOnly.getScene();
    const geometry = editorFieldClientGeometry(getEditorAnnotationSource(scene, id), scene.pdfPages, point => point, getEditorAnnotationFrameTransform(scene, id));
    assert(geometry, "HEP-only documents synthesize a page mapping for authored field controls");
    assert.equal(geometry.width, 100); assert.equal(geometry.height, 25);
    assert.deepEqual(geometry.transform.map(value => value || 0), [0, 1, 1, 0, 0, 0]);
  } finally { hepOnly.dispose(); }
  console.log("Authored form fields: typed values, shared radio groups, vector ownership, transforms, history, clipboard and recovery passed.");
} finally { hooks.deregister(); }
