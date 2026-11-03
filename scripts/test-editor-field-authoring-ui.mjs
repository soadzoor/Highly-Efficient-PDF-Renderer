import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";
import { editorUiTestContext } from "./lib/editorUiTestContext.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { editorSelectionLeaves } = await import("../src/editorProperties.ts");
  const { editorFieldAnnotation } = await import("../src/editorFormFields.ts");
  const { editorFieldClientGeometry } = await import("../src/editorCoordinates.ts");
  const { canEditEditorField } = await import("../src/editorFormControls.ts");
  const source = (await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8")).replace(/^ {2}/gm, "");
  const tick = () => new Promise(resolve => setImmediate(resolve));
  function fixture() {
    const scene = buildStrokeScene([]); scene.pageCount = 1; scene.pageRects = Float32Array.of(0, 0, 500, 500); scene.pageTextRanges = new Uint32Array(2);
    const session = createEditorSession(scene), dialogs = [], errors = [], commits = [];
    const context = editorUiTestContext({ session, active: true, activeText: null, pointer: null, pendingPick: null, polygon: null,
      fieldDefaults: { fieldType: "text" }, tool: "add-field", editorSelectionLeaves, sourceScene: scene, IDENTITY: [1, 0, 0, 1, 0, 0],
      fieldDrafts: new Map(), fieldDialog: null, fieldDialogCreating: false, toolRequest: 0, textRequest: 0,
      fieldActivation: { pointerDown() {}, pointerMove() {}, pointerUp: () => null },
      overlay: { setPointerCapture() {}, releasePointerCapture() {} },
      host: { clientToScenePoint: (x, y) => ({ x, y }), sceneToClientPoint: (x, y) => ({ x, y }) },
      selectedFont: async () => ({ id: "test-font", family: "Liberation Sans" }),
      property: name => ({ value: name === "font-size" ? "12" : name === "stroke" ? "not a number" : "#111111", checked: false }),
      flushEditorFieldDrafts() {}, updateState() {}, updatePointerCursor() {}, clearPreview() {},
      isSceneSettling: () => false, pageLocal: (point, page) => [point.x - scene.pageRects[page * 4], point.y - scene.pageRects[page * 4 + 1]],
      editorFieldClientGeometry, canEditEditorField, getEditorAnnotationSource: () => undefined, getEditorAnnotationFrameTransform: () => undefined,
      setTool(tool) { context.tool = tool; },
      commit(change) { const before = session.revision; try { change(); commits.push([before, session.revision]); } catch (error) { errors.push(error); } },
      showEditorFieldDialog(_document, initial, onApply, onClose) {
        const dialog = { initial, changed: true, onApply,
          close() { onClose(); }, hasDraftChanges() { return this.changed; },
          apply(settings) { try { onApply(settings ?? initial); this.close(); return true; } catch (error) { this.error = error; return false; } } };
        dialogs.push(dialog); return dialog;
      }, document: {}, report: error => errors.push(error)
    });
    for (const name of ["pageAt", "sceneBoundsToClient", "selectedEditorField", "fieldObjectOwner", "fieldAtClientPoint", "openFieldEditor", "updateShapeGesture", "pointerDown", "pointerMove", "pointerUp"])
      vm.runInContext(sourceFunction(source, name), context);
    const pointerEvent = (x, y) => ({ clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", button: 0,
      target: { getAttribute: () => null, closest: () => null }, preventDefault() {}, stopPropagation() {} });
    return { session, context, dialogs, errors, commits,
      async draw(start, end = start) { await context.pointerDown(pointerEvent(...start)); context.pointerMove(pointerEvent(...end)); context.pointerUp(pointerEvent(...end)); await tick(); },
      close() { context.disposed = true; context.fieldDialog?.close(); session.dispose(); }
    };
  }
  {
    const f = fixture();
    try {
      await f.draw([20, 100], [180, 60]);
      assert.equal(f.dialogs.length, 1); assert.equal(f.session.getObjects({ includeSource: false }).length, 0, "drawing only prepares a field until Apply");
      const dialog = f.dialogs[0]; assert.equal(dialog.initial.name, "Field1"); assert.equal(f.context.fieldDialogCreating, true);
      assert(dialog.apply({ ...dialog.initial, fieldType: "number", value: "123.5", defaultValue: "" }));
      const field = f.session.getObject(f.session.getSelection()[0]);
      assert.equal(field.kind, "field"); assert.equal(field.fieldType, "number");
      assert.deepEqual([field.x, field.y, field.width, field.height], [20, 60, 160, 40]);
      assert.equal(f.context.tool, "select"); assert.equal(f.context.fieldDialog, null); assert.equal(f.commits.length, 1);
      assert.equal(f.context.fieldObjectOwner(field.id), field.id, "authored widgets pick and lock their real owner");
      assert.equal(f.context.fieldObjectOwner("source-widget"), "annotation:source-widget");
      f.context.latestScene = { ...f.session.sourceScene, annotations: [editorFieldAnnotation(field)] };
      assert.equal(f.context.fieldAtClientPoint({ x: 50, y: 80 }), field.id, "Select double-click hit testing accepts newly authored fields");
      f.session.setObjectsLocked([field.id], true);
      assert.equal(f.context.fieldAtClientPoint({ x: 50, y: 80 }), null, "editing locks prevent authored field activation");
      f.session.setObjectsLocked([field.id], false);
      assert(f.session.undo()); assert(f.session.undo()); // Remove lock-only history before checking creation undo.
      assert(f.session.undo()); assert.equal(f.session.getObjects({ includeSource: false }).length, 0); assert(f.session.redo());
      await f.context.openFieldEditor(); const properties = f.dialogs[1];
      assert.equal(properties.initial.id, field.id); assert(properties.apply({ ...properties.initial, name: "Amount", value: "42" }));
      assert.equal(f.session.getObject(field.id).name, "Amount"); assert.equal(f.session.getFieldValues().get("Amount"), "42");
      assert(f.session.undo()); assert.equal(f.session.getObject(field.id).value, "123.5");
      await f.context.openFieldEditor(); const unchanged = f.dialogs[2], revision = f.session.revision; unchanged.changed = false;
      assert(unchanged.apply(unchanged.initial)); assert.equal(f.session.revision, revision, "unchanged properties do not enter undo history");
      assert.deepEqual(f.errors, []);
    } finally { f.close(); }
  }
  {
    const f = fixture();
    try {
      await f.draw([25, 80]); f.dialogs[0].close();
      assert.equal(f.session.revision, 0, "canceling creation never inserts temporary artwork");
      await f.draw([25, 80]); const dialog = f.dialogs[1]; assert(dialog.apply({ ...dialog.initial, fieldType: "date", value: "2026-11-02", defaultValue: "" }));
      const field = f.session.getObject(f.session.getSelection()[0]);
      assert.deepEqual([field.x, field.y, field.width, field.height], [25, 56, 160, 24], "click placement has a usable default size");
      await f.context.openFieldEditor(); const invalid = f.dialogs[2];
      assert.equal(invalid.apply({ ...invalid.initial, value: "2026-02-30" }), false);
      assert.equal(f.context.fieldDialog, invalid, "invalid values keep properties open for correction");
      assert.equal(f.session.getObject(field.id).value, "2026-11-02", "failed edits preserve the active document");
    } finally { f.close(); }
  }
  {
    const f = fixture();
    try {
      let resolveFont; f.context.selectedFont = () => new Promise(resolve => { resolveFont = resolve; });
      const pending = f.context.openFieldEditor({ pageIndex: 0, x: 10, y: 10, width: 100, height: 20 });
      f.context.toolRequest++; resolveFont({ id: "late-font", family: "Liberation Sans" }); await pending;
      assert.equal(f.dialogs.length, 0, "changing tools cancels delayed field setup");
      const saving = f.context.openFieldEditor({ pageIndex: 0, x: 10, y: 10, width: 100, height: 20 });
      f.context.savePreparing = true; resolveFont({ id: "late-font", family: "Liberation Sans" }); await saving;
      assert.equal(f.dialogs.length, 0, "delayed field setup cannot reopen over an active export");
    } finally { f.close(); }
  }
  console.log("Form field authoring UI: draw/click placement, configuration, cancellation, selection, property edits and undo passed.");
} finally { hooks.deregister(); }
