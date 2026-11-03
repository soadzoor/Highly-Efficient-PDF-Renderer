import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({
  resolve(specifier, context, next) {
    return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
  },
  load(url, context, next) {
    const result = next(url, context);
    // Observe actual native work without adding production instrumentation.
    return url.endsWith("/src/pdfSession.ts") ? { ...result, source: String(result.source) + "\nexport { NativePdfSession as CacheTestPdfSession };\n" } : result;
  }
});
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
try {
  const { openPdf, CacheTestPdfSession } = await import("../src/pdfSession.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { NativePdfWriter } = await import("../src/pdf/nativeWriter.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { getSceneAnnotationRuns } = await import("../src/scenePrimitives.ts");
  const { ScenePageViews } = await import("../src/scenePageViews.ts");
  const { transformWholeEditorScene, bakeEditorAnnotationEdits } = await import("../src/editorScene.ts");
  const bytes = fixture(), originalBytes = bytes.slice(), parser = await openPdf({ kind: "bytes", bytes });
  let source;
  try { source = composeVectorScenesInGrid(await Promise.all([0, 1].map(index => parser.compileVectorPage(index, { optimization: "none" }))), 1); }
  finally { await parser.close(); }
  const counts = { opens: 0, saves: 0, compiles: 0 }, originalOpen = NativePdfDocument.open, originalSave = NativePdfWriter.prototype.save;
  const originalCompile = CacheTestPdfSession.prototype.compileVectorPage;
  let nextGate;
  NativePdfDocument.open = function (...args) { counts.opens++; return originalOpen.call(this, ...args); };
  NativePdfWriter.prototype.save = function (...args) { counts.saves++; return originalSave.call(this, ...args); };
  CacheTestPdfSession.prototype.compileVectorPage = async function (...args) {
    counts.compiles++;
    if (nextGate) {
      const gate = nextGate; nextGate = undefined; gate.signal = args[1].signal; gate.entered.resolve(); await gate.release.promise;
    }
    return originalCompile.call(this, ...args);
  };
  const services = [], makeServices = async (sourcePdf = bytes) => {
    const value = await createEditorAppServices({ sourcePdf, loadFontAsset: async url => new Uint8Array(await readFile(url)) }); services.push(value); return value;
  };
  const snapshot = () => ({ ...counts }), unchanged = (before, label) => assert.deepEqual(counts, before, label);
  const gate = () => nextGate = { entered: deferred(), release: deferred() };
  const named = (scene, name) => scene.annotations.filter(annotation => annotation.field?.name === name);
  const glyphs = (scene, id) => (getSceneAnnotationRuns(scene).get(id) ?? []).flatMap(run => run.kind !== "text" ? [] :
    Array.from({ length: run.count }, (_, i) => { const offset = (run.first + i) * 4;
      return [...scene.textInstanceA.subarray(offset, offset + 4), ...scene.textInstanceB.subarray(offset, offset + 2)]; }));
  const multiply = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  const nearGlyphs = (actual, expected) => { assert.equal(actual.length, expected.length); actual.forEach((matrix, i) => matrix.forEach((value, j) =>
    assert(Math.abs(value - expected[i][j]) < .003, `glyph ${i}, matrix ${j}: ${value} versus ${expected[i][j]}`))); };
  try {
    const service = await makeServices(), compile = service.sessionOptions.compileFields;
    const values = new Map([["Shared", "A"], ["Choice", ["A"]], ["Hidden", "Hidden value"]]);
    const first = await compile(source, values), built = snapshot();
    assert.equal(built.saves, 1); assert.equal(built.compiles, 2); assert(built.opens >= 2);
    assert(named(first, "Shared").every(annotation => annotation.field.value === "A"));
    assert.equal(glyphs(first, named(first, "Hidden")[0].id).length, 0, "hidden widgets remain hidden");
    const equivalent = new Map([...values].reverse().map(([name, value]) => [name, Array.isArray(value) ? value.slice() : value]));
    const repeated = await compile(source, equivalent); unchanged(built, "unchanged semantic values reuse native writer, parser and page compilation");
    for (const annotation of named(first, "Shared")) nearGlyphs(glyphs(repeated, annotation.id), glyphs(first, annotation.id));
    // Page-local transforms still happen after the cache lookup.
    const transform = [1.2, .25, -.3, .8, 33, -17];
    const moved = bakeEditorAnnotationEdits(transformWholeEditorScene(source, transform),
      source.annotations.map(annotation => ({ id: annotation.id, transform, deleted: false })));
    const transformed = await compile(moved, equivalent); unchanged(built, "rotating/cropping/placing source pages does not regenerate APs");
    for (const annotation of named(first, "Shared")) nearGlyphs(glyphs(transformed, annotation.id), glyphs(first, annotation.id).map(matrix => multiply(transform, matrix)));
    const canonicalAgain = await compile(source, values); unchanged(built, "placing cached APs cannot mutate canonical geometry");
    for (const annotation of named(first, "Shared")) nearGlyphs(glyphs(canonicalAgain, annotation.id), glyphs(first, annotation.id));

    const editor = createEditorSession(source, service.sessionOptions);
    try {
      editor.setFieldValue("Shared", "A"); const id = editor.addObject({ kind: "shape", shape: "rectangle", pageIndex: 0, x: 20, y: 20, width: 30, height: 20 });
      editor.select([id]); await editor.getScene({ preview: false }); const warm = snapshot();
      for (let i = 0; i < 5; i++) { editor.setPreviewTransform([1, 0, 0, 1, i + 10, i + 20]); await editor.getScene(); }
      editor.setPreviewTransform(null); editor.updateObject(id, { color: "red" }); await editor.getScene();
      unchanged(warm, "dragging and styling authored objects never repeat native field work");
      const field = named(source, "Shared")[0]; editor.selectAnnotations([field.id]);
      const baseline = await editor.getScene();
      editor.setPreviewTransform(transform); const preview = await editor.getScene(); unchanged(warm, "dragging a form widget also reuses APs");
      nearGlyphs(glyphs(preview, field.id), glyphs(baseline, field.id).map(matrix => multiply(transform, matrix)));
      const sibling = named(source, "Shared")[1]; nearGlyphs(glyphs(preview, sibling.id), glyphs(baseline, sibling.id));
      editor.setPreviewTransform(null);
      const layer = editor.createLayer({ name: "Cached fields" }); editor.assignSelectionToLayer(layer); await editor.getScene();
      editor.updateLayer(layer, { defaultVisible: false }); await editor.getScene(); assert.equal(editor.isAnnotationVisible(field.id), false);
      editor.updateLayer(layer, { defaultVisible: true }); await editor.getScene(); assert.equal(editor.isAnnotationVisible(field.id), true);
      unchanged(warm, "layer ownership and visibility changes reuse values while keeping current scene layer state");
      editor.setFieldValue("Shared", "B"); assert(named(await editor.getScene(), "Shared").every(annotation => annotation.field.value === "B"));
      const changed = snapshot(); assert.equal(changed.saves, warm.saves + 1);
      editor.undo(); assert(named(await editor.getScene(), "Shared").every(annotation => annotation.field.value === "A"));
      editor.redo(); assert(named(await editor.getScene(), "Shared").every(annotation => annotation.field.value === "B"));
      assert.equal(counts.saves, changed.saves + 2, "undo/redo regenerate changed values rather than reusing a stale result");
    } finally { editor.dispose(); }

    // Public callers may mutate and reuse both their Map and array entries.
    const mutable = new Map([["Shared", "Mutable A"]]);
    const waitA = gate(), promiseA = compile(source, mutable); mutable.set("Shared", "Mutable B");
    await waitA.entered.promise; const resultB = await compile(source, mutable);
    waitA.release.resolve(); const resultA = await promiseA;
    assert(named(resultA, "Shared").every(annotation => annotation.field.value === "Mutable A"));
    assert(named(resultB, "Shared").every(annotation => annotation.field.value === "Mutable B"));
    const completedBoth = snapshot(); await compile(source, mutable); unchanged(completedBoth, "an older completion cannot overwrite the current value's cache");
    const selected = ["A"], choices = new Map([["Choice", selected]]), waitChoices = gate(), oldChoices = compile(source, choices); selected.push("B");
    await waitChoices.entered.promise; waitChoices.release.resolve();
    assert.deepEqual(named(await oldChoices, "Choice")[0].field.value, ["A"]);
    assert.deepEqual(named(await compile(source, choices), "Choice")[0].field.value, ["A", "B"]);

    const cancel = new AbortController(), waiting = gate(), canceled = compile(source, new Map([["Shared", "Cancelable"]]), cancel.signal);
    await waiting.entered.promise; const sharedWork = snapshot(); cancel.abort();
    await assert.rejects(canceled, { name: "AbortError" }); assert.equal(waiting.signal.aborted, false, "consumer cancellation does not abort shared generation");
    const follower = compile(source, new Map([["Shared", "Cancelable"]])); waiting.release.resolve(); await follower;
    assert.equal(counts.opens, sharedWork.opens); assert.equal(counts.saves, sharedWork.saves);
    assert.equal(counts.compiles, sharedWork.compiles + 1, "the shared two-page job compiles only its remaining page for the follower");

    const obsoleteController = new AbortController(), obsoleteGate = gate();
    const obsolete = compile(source, new Map([["Shared", "Obsolete"]]), obsoleteController.signal);
    await obsoleteGate.entered.promise; obsoleteController.abort(); await assert.rejects(obsolete, { name: "AbortError" });
    assert.equal(obsoleteGate.signal.aborted, false, "the current value's canceled consumer leaves reusable warm work");
    const replacement = compile(source, new Map([["Shared", "Replacement"]]));
    assert.equal(obsoleteGate.signal.aborted, true, "a replacement value aborts obsolete work once no snapshot consumers remain");
    obsoleteGate.release.resolve(); await replacement;

    const olderController = new AbortController(), olderGate = gate();
    const older = compile(source, new Map([["Shared", "Older active"]]), olderController.signal);
    await olderGate.entered.promise;
    const latest = compile(source, new Map([["Shared", "Latest"]]));
    assert.equal(olderGate.signal.aborted, false, "replacing the cache preserves an older live export/snapshot consumer");
    olderController.abort(); await assert.rejects(older, { name: "AbortError" });
    assert.equal(olderGate.signal.aborted, true, "an obsolete entry is aborted when its final live waiter leaves");
    olderGate.release.resolve(); await latest;

    const failure = gate(), failed = compile(source, new Map([["Shared", "Failed"]])); await failure.entered.promise;
    const good = await compile(source, new Map([["Shared", "Good"]])), goodCounts = snapshot();
    assert(named(good, "Shared").every(annotation => annotation.field.value === "Good"));
    failure.release.reject(new Error("Synthetic older compilation failure")); await assert.rejects(failed, /older compilation failure/);
    await compile(source, new Map([["Shared", "Good"]])); unchanged(goodCounts, "an old failure cannot evict a newer successful cache entry");
    const retryFailure = gate(), retry = compile(source, new Map([["Shared", "Retry"]])); await retryFailure.entered.promise;
    retryFailure.release.reject(new Error("Synthetic retry failure")); await assert.rejects(retry, /retry failure/);
    const beforeRetry = snapshot(); await compile(source, new Map([["Shared", "Retry"]])); assert.equal(counts.saves, beforeRetry.saves + 1, "failed AP work is evicted so retry can succeed");

    const firstPage = new ScenePageViews(source).extract(0).scene, secondPage = new ScenePageViews(source).extract(1).scene;
    await compile(firstPage, new Map([["Shared", "Subset"]])); const subsetCounts = snapshot();
    const pageTwo = await compile(secondPage, new Map([["Shared", "Subset"]])); assert.equal(counts.compiles, subsetCounts.compiles + 1, "different source-page/annotation identities cannot reuse another page's APs");
    assert(glyphs(pageTwo, named(pageTwo, "Shared")[0].id).length > 0);
    const oneWidget = { ...firstPage, annotations: firstPage.annotations.filter(annotation => annotation.id !== named(firstPage, "Shared")[0].id) };
    await compile(firstPage, new Map([["Shared", "Subset"]])); const targetCounts = snapshot();
    const reduced = await compile(oneWidget, new Map([["Shared", "Subset"]])); assert.equal(counts.compiles, targetCounts.compiles + 1, "target annotation identity changes are part of the cache key");
    assert.equal(named(reduced, "Shared").length, 1); assert(glyphs(reduced, named(reduced, "Shared")[0].id).length > 0);
    const otherSource = await makeServices(fixture("Other source")), isolated = snapshot();
    await otherSource.sessionOptions.compileFields(source, new Map([["Shared", "Subset"]])); assert.equal(counts.saves, isolated.saves + 1, "each document/services instance owns its own cache");

    const disposable = await makeServices(), disposalGate = gate(), disposal = disposable.sessionOptions.compileFields(source, new Map([["Shared", "Disposed"]]));
    await disposalGate.entered.promise; disposable.dispose(); await assert.rejects(disposal, { name: "AbortError" });
    assert.equal(disposalGate.signal.aborted, true, "service disposal aborts shared native work"); disposalGate.release.resolve();
    await assert.rejects(disposable.sessionOptions.compileFields(source, new Map([["Shared", "Disposed"]])), { name: "AbortError" });
    assert.deepEqual(bytes, originalBytes, "caching never modifies source PDF bytes");
  } finally {
    for (const service of services) service.dispose();
    NativePdfDocument.open = originalOpen; NativePdfWriter.prototype.save = originalSave; CacheTestPdfSession.prototype.compileVectorPage = originalCompile;
  }
  console.log("Field appearance cache: no native work during unchanged-value previews, affine/shared/hidden widgets, mutable inputs, cancellation sharing, overlapping failures, source/page isolation and disposal passed.");
} finally { hooks.deregister(); }

function fixture(label = "Source") {
  const widget = (parent, rect) => `<< /Type /Annot /Subtype /Widget /Parent ${parent} 0 R /Rect [${rect}] /AP << /N 7 0 R >> >>`;
  return writeTinyPdf({ objects: [
    { number: 1, body: `<< /Type /Catalog /Pages 2 0 R /AcroForm 8 0 R /Lang (${label}) >>` },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 5 0 R /Annots [10 0 R 11 0 R 12 0 R 14 0 R] >>" },
    { number: 4, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /CropBox [5 10 195 190] /Rotate 90 /Contents 5 0 R /Annots [13 0 R] >>" },
    { number: 5, body: tinyPdfStream("", "0 g 0 0 1 1 re f") },
    { number: 6, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" },
    { number: 7, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 80 20]", "") },
    { number: 8, body: "<< /Fields [9 0 R 12 0 R 14 0 R] /DR << /Font << /Helv 6 0 R >> >> /DA (/Helv 10 Tf 0 g) >>" },
    { number: 9, body: "<< /FT /Tx /T (Shared) /V (Old) /Kids [10 0 R 11 0 R 13 0 R] >>" },
    { number: 10, body: widget(9, "10 20 90 40") }, { number: 11, body: widget(9, "10 60 90 80") }, { number: 13, body: widget(9, "20 20 100 40") },
    { number: 12, body: "<< /Type /Annot /Subtype /Widget /FT /Tx /T (Hidden) /V () /F 2 /Rect [10 100 90 120] /AP << /N 7 0 R >> >>" },
    { number: 14, body: "<< /Type /Annot /Subtype /Widget /FT /Ch /T (Choice) /Ff 2097152 /Opt [(A) (B) (C)] /V [(A)] /Rect [100 20 190 80] /AP << /N 7 0 R >> >>" }
  ] });
}
