import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import vm from "node:vm";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { sourceFunction } from "./lib/sourceFunction.mjs";
import { editorUiTestContext } from "./lib/editorUiTestContext.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { createNodeBundledStandardFontResolver } = await import("../src/nodePdfResources.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const properties = await import("../src/editorProperties.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { NativePdfFormAppearanceRegistry, decodePdfString } = await import("../src/pdf/nativeForms.ts");
  const { parseDefaultAppearance } = await import("../src/pdf/nativeAppearanceSynthesis.ts");
  const { NativePdfWriter } = await import("../src/pdf/nativeWriter.ts");
  const { applyEditorPdfFields } = await import("../src/editorNativePdf.ts");
  const { getSceneAnnotationRuns } = await import("../src/scenePrimitives.ts");
  const { createEditorFieldControl, styleEditorFieldControl } = await import("../src/editorFormControls.ts");
  const { lowerRetainedPageToVectorScene } = await import("../src/retainedVectorPage.ts");
  const bytes = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] /DA (/Helv 8 Tf 0 g) /DR << /Font << /Helv 8 0 R >> >> >> >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Rotate 90 /UserUnit 2 /Annots [4 0 R 6 0 R] >>" },
    { number: 4, body: "<< /Subtype /Widget /Parent 5 0 R /Rect [10 10 170 40] /AP << /N 7 0 R >> >>" },
    { number: 5, body: "<< /FT /Tx /T (Shared) /Ff 4096 /V (Initial) /Kids [4 0 R 6 0 R] >>" },
    { number: 6, body: "<< /Subtype /Widget /Parent 5 0 R /Rect [10 50 170 80] /AP << /N 7 0 R >> >>" },
    { number: 7, body: tinyPdfStream("/Subtype /Form /BBox [0 0 160 30] /Resources << /Font << /Helv 8 0 R >> >>", "BT /Helv 6 Tf 1 0 0 1 2 12 Tm (Initial) Tj ET") },
    { number: 8, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" }
  ] });
  const parser = await openPdf({ kind: "bytes", bytes }, { missingFontResolver: createNodeBundledStandardFontResolver() });
  const diagnostics = [];
  const services = await createEditorAppServices({ sourcePdf: bytes, loadFontAsset: url => readFile(url), onDiagnostic: diagnostic => diagnostics.push(diagnostic) });
  let editor;
  const near = (actual, expected) => assert(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`);
  class Control extends EventTarget {
    style = {}; dataset = {}; value = "";
    constructor(tag = "input") { super(); this.tagName = tag.toUpperCase(); }
    setAttribute() {}
  }
  const document = { createElement: tag => tag === "canvas" ? { getContext: () => null } : new Control(tag) };
  try {
    const scene = await parser.compileVectorPage(0, { optimization: "none", preserveDrawingOrder: true, retainOptionalContent: true });
    editor = await openEditorSession(scene, { ...services.sessionOptions, sourcePdf: bytes });
    const initial = editor.sourceScene.annotations[0], owner = `annotation:${initial.id}`;
    editor.select([owner]);
    assert.deepEqual(properties.editorPropertySelection(editor, "fontSize"), [owner], "imported fields enable Size in Select");
    near(properties.editorPropertyState(editor, "fontSize").value, 6);
    const control = createEditorFieldControl(document, initial, undefined, () => {});
    near(parseFloat(control.style.fontSize), 6, "typing starts at the stored appearance's size rather than stale /DA");
    const scale = scene => {
      const run = getSceneAnnotationRuns(scene).get(initial.id).find(run => run.kind === "text");
      return Math.hypot(scene.textInstanceA[run.first * 4 + 2], scene.textInstanceA[run.first * 4 + 3]);
    };
    const originalScale = scale(scene), originalBounds = editor.getObjectBounds(owner);
    const retained = await lowerRetainedPageToVectorScene(await parser.compilePage(0), { signal: new AbortController().signal });
    const retainedRun = getSceneAnnotationRuns(retained).get(initial.id).find(run => run.kind === "text");
    assert.deepEqual(Array.from(retained.textInstanceA.subarray(retainedRun.first * 4, retainedRun.first * 4 + 4)), [1, 0, 0, 1], "the retained renderer bakes glyph scale into its outline");
    const retainedEditor = await openEditorSession(retained, { ...services.sessionOptions, sourcePdf: bytes });
    try {
      const field = retainedEditor.sourceScene.annotations.find(annotation => annotation.id === initial.id);
      const textarea = createEditorFieldControl(document, field, undefined, () => {});
      assert.equal(textarea.tagName, "TEXTAREA");
      near(field.field.textStyle.appearanceFontSize, 6);
      near(parseFloat(textarea.style.fontSize), 6, "baked glyph transforms cannot turn a multiline field into an em-sized scroll area");
    } finally { retainedEditor.dispose(); }
    const typing = await openEditorSession(scene, { ...services.sessionOptions, sourcePdf: bytes });
    try {
      typing.setFieldValue("Shared", "Typed");
      near(scale(await typing.getScene()), originalScale, "typing retains a stored fixed size when /DA is stale");
      const typedBytes = new Uint8Array(await (await typing.savePdf()).arrayBuffer()), typedPdf = await NativePdfDocument.open({ kind: "bytes", bytes: typedBytes });
      try {
        const [typedField] = await new NativePdfFormAppearanceRegistry(typedPdf).listPageAnnotations(0);
        near(parseDefaultAppearance(typedField.widget.defaultAppearance.bytes, typedField).fontSize, 6);
      } finally { await typedPdf.close(); }
    } finally { typing.dispose(); }
    properties.applyEditorPropertyPatch(editor, { fontSize: 22 });
    assert.equal(editor.getAnnotationEdits().filter(edit => edit.fontSize === 22).length, 2, "widgets sharing one field retain a shared size");
    assert.deepEqual(editor.getSelection(), [owner]); assert.deepEqual(editor.getObjectBounds(owner), originalBounds, "form size changes retain the field rectangle");
    let updated = await editor.getScene();
    assert.equal(diagnostics.filter(diagnostic => diagnostic.code === "editor.appearance-regenerated").length, 0, JSON.stringify(diagnostics));
    near(scale(updated) / originalScale, 22 / 6);
    styleEditorFieldControl(control, updated.annotations[0]); near(parseFloat(control.style.fontSize), 22);
    control.dispatchEvent(new Event("input")); near(parseFloat(control.style.fontSize), 22, "subsequent typing cannot restore the old control style");
    editor.setFieldValue("Shared", "Typed");
    updated = await editor.getScene(); near(scale(updated) / originalScale, 22 / 6);
    properties.applyEditorPropertyPatch(editor, { fontSize: 14 });
    updated = await editor.getScene(); near(scale(updated) / originalScale, 14 / 6, "appearance caching includes font size");
    assert(editor.undo()); updated = await editor.getScene(); near(scale(updated) / originalScale, 22 / 6);
    const saved = new Uint8Array(await (await editor.savePdf()).arrayBuffer()), pdf = await NativePdfDocument.open({ kind: "bytes", bytes: saved });
    try {
      const fields = await new NativePdfFormAppearanceRegistry(pdf).listPageAnnotations(0);
      for (const field of fields) {
        assert.equal(parseDefaultAppearance(field.widget.defaultAppearance.bytes, field).fontSize, 22);
        assert.equal(decodePdfString(field.widget.value, 0, 0), "Typed");
      }
    } finally { await pdf.close(); }
    const recovery = await editor.captureRecovery();
    assert(editor.undo()); assert(editor.undo()); updated = await editor.getScene(); near(scale(updated), originalScale);
    await editor.restoreRecovery(recovery); updated = await editor.getScene(); near(scale(updated) / originalScale, 22 / 6);
    const peer = `annotation:${initial.id === "ref:4:0" ? "ref:6:0" : "ref:4:0"}`;
    editor.setObjectsLocked([peer], true); const revision = editor.revision;
    assert.throws(() => properties.applyEditorPropertyPatch(editor, { fontSize: 30 }), /locked/i); assert.equal(editor.revision, revision);
    editor.setObjectsLocked([peer], false);
    for (const fontSize of [-1, NaN, Infinity]) assert.throws(() => properties.applyEditorPropertyPatch(editor, { fontSize }), /font size/i);

    const ui = (await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8")).replace(/^ {2}/gm, "");
    const modes = [], context = editorUiTestContext({ session: editor, tool: "form", activeText: null, ...properties,
      appearanceControls: { refresh: mode => modes.push(mode) },
      property: () => ({ checked: false, value: "#000000" }), commit: change => change() });
    for (const name of ["changeAppearance", "updateAppearanceControls"]) vm.runInContext(sourceFunction(ui, name), context);
    context.updateAppearanceControls(); assert.equal(modes.at(-1), "selection", "Fill retains selected-field appearance controls");
    context.changeAppearance({ dataset: { prop: "font-size" }, value: "18" });
    assert.equal(properties.editorPropertyState(editor, "fontSize").value, 18);
    assert.deepEqual(editor.getSelection(), [owner]); assert.equal(context.tool, "form", "Size edits keep the selected field and Fill mode");

    const plainServices = await createEditorAppServices({ loadFontAsset: url => readFile(url) });
    const plain = await openEditorSession(editor.sourceScene, plainServices.sessionOptions);
    try {
      plain.select([owner]); properties.applyEditorPropertyPatch(plain, { fontSize: 22 });
      const withoutSource = await plain.getScene(); near(scale(withoutSource) / originalScale, 22 / 6, "source-less regeneration retains PDF-local font sizes through rotation and UserUnit");
    } finally { plain.dispose(); plainServices.dispose(); }

    const fallbackSource = await NativePdfDocument.open({ kind: "bytes", bytes });
    try {
      const writer = new NativePdfWriter(fallbackSource), warnings = [];
      await applyEditorPdfFields(writer, new Map(), services.fonts, { fontSizes: new Map([["Shared", 24]]),
        missingFontResolver: async () => { throw new Error("Synthetic font recovery"); }, onWarning: warning => warnings.push(warning) });
      const fallbackBytes = await writer.save(), fallback = await openPdf({ kind: "bytes", bytes: fallbackBytes }, { missingFontResolver: createNodeBundledStandardFontResolver() });
      try { near(scale(await fallback.compileVectorPage(0, { optimization: "none" })) / originalScale, 24 / 6); }
      finally { await fallback.close(); }
      assert(warnings.some(warning => warning.includes("regenerated portable font appearance")), "font recovery stays diagnostic and retains the requested size");
    } finally { await fallbackSource.close(); }
  } finally { editor?.dispose(); services.dispose(); await parser.close(); }
  console.log("Imported form font sizes: appearance parity, shared widgets, Select/Fill controls, typing, cache, save, undo and recovery passed.");
} finally { hooks.deregister(); }
