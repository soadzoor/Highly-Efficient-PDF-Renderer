import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
const near = (a, b, label) => { assert.equal(a.length, b.length, label); a.forEach((value, i) => assert(Math.abs(value - b[i]) < .003, `${label}[${i}]: ${value} versus ${b[i]}`)); };
try {
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { composeVectorScenesInColumn } = await import("../src/pdfVectorExtractor.ts");
  const { compileEditorObjectGeometry } = await import("../src/editorSceneObjects.ts");
  const { bakeEditorSourceScene, getEditorAnnotationFrameTransform, getEditorAnnotationSource } = await import("../src/editorScene.ts");
  const { getScenePrimitive, getSceneAnnotationRuns, getPrimitiveClipChain } = await import("../src/scenePrimitives.ts");
  const { PAGE_PRIMITIVE_KINDS, scenePrimitiveCounts } = await import("../src/scenePageViews.ts");
  const { prepareEditorTranslationPreview } = await import("../src/editorTranslationPreview.ts");
  const { getEditorSceneTranslationHint } = await import("../src/editorScenePreview.ts");
  const { validateVectorClips } = await import("../src/vectorClips.ts");
  const { validateVectorDrawRuns, defaultVectorDrawRuns } = await import("../src/vectorDrawOrder.ts");
  const { validateScenePaintGraph } = await import("../src/scenePaintGraph.ts");
  const { editorPaintIdentity, setEditorPaintIdentity } = await import("../src/editorPaintIdentity.ts");
  const refs = scene => { const counts = scenePrimitiveCounts(scene); return PAGE_PRIMITIVE_KINDS.flatMap(kind => Array.from({ length: counts[kind] }, (_, index) => ({ kind, index }))); };
  const clipEdges = (scene, ref) => {
    const result = [], clip = getPrimitiveClipChain(scene, ref); let index = clip.clipIndex;
    if (clip.rect) result.push(Object.values(clip.rect));
    while (index >= 0) { result.push([...scene.clipPaths[index].edges]); index = scene.clipPaths[index].parent; }
    return result;
  };
  const checkGeometry = (actual, expected, primitives) => {
    validateVectorClips(actual); validateVectorDrawRuns(actual); validateScenePaintGraph(actual);
    for (const ref of primitives) {
      const a = getScenePrimitive(actual, ref), b = getScenePrimitive(expected, ref);
      near(Object.values(a.bounds), Object.values(b.bounds), `${ref.kind} bounds`); assert.equal(a.segmentCount, b.segmentCount);
      for (let i = 0; i < a.segmentCount; i++) {
        const x = a.getSegment(i), y = b.getSegment(i);
        for (const point of ["start", "control", "end"]) if (x[point] || y[point]) near(Object.values(x[point]), Object.values(y[point]), `${ref.kind} ${point}`);
      }
      const x = clipEdges(actual, ref), y = clipEdges(expected, ref); assert.equal(x.length, y.length);
      x.forEach((edges, i) => near(edges, y[i], "original antialiased vector clip"));
    }
  };
  // Curves, fills and shared clipping remain in their original paint order.
  for (const object of [
    { kind: "shape", shape: "rectangle", x: 10, y: 20, width: 40, height: 30, fill: "red", color: "blue", strokeWidth: 3 },
    { kind: "shape", shape: "ellipse", x: 10, y: 20, width: 40, height: 30, fill: "red", color: "blue", strokeWidth: 3 },
    { kind: "ink", paths: [[[10, 20], [30, 50], [50, 20]]], smoothing: .2, color: "green", strokeWidth: 4 }
  ]) {
    const scene = await compileEditorObjectGeometry({ ...object, id: "Object", pageIndex: 0, transform: [1, 0, 0, 1, 0, 0] });
    scene.clipPaths = [{ parent: -1, fillRule: 0, edges: Float32Array.of(15, 15, 45, 15, 45, 15, 45, 55, 45, 55, 15, 55, 15, 55, 15, 15) }];
    scene.drawRuns = (scene.drawRuns ?? defaultVectorDrawRuns(scene)).map(run => ({ ...run, clipIndex: 0 }));
    const selected = refs(scene), before = structuredClone(scene), prepared = prepareEditorTranslationPreview(scene, [...selected, ...selected], []);
    assert(prepared);
    const first = prepared.translate(7, -3), second = prepared.translate(-9, 12), hint = getEditorSceneTranslationHint(first);
    assert.equal(getEditorSceneTranslationHint(second).source, hint.source); assert.equal(first.drawRuns, second.drawRuns); assert.equal(first.paintGraph, second.paintGraph);
    assert.equal(first.styles, second.styles); assert.equal(first.fillPathMetaC, second.fillPathMetaC);
    for (const [frame, dx, dy] of [[first, 7, -3], [second, -9, 12]]) {
      const expected = bakeEditorSourceScene(scene, selected.map(ref => ({ ref, deleted: false, transform: [1, 0, 0, 1, dx, dy] })));
      checkGeometry(frame, expected, selected); assert(getEditorSceneTranslationHint(frame).changedClips.length);
    }
    assert.deepEqual(scene, before, "neither preparation nor later poses mutate the canonical scene");
    assert.throws(() => prepared.translate(1, 2, AbortSignal.abort()), { name: "AbortError" });
    const composited = { ...scene, paintGraph: { roots: [{ kind: "group", alpha: .5, isolated: false, knockout: false, blendMode: "Normal",
      children: scene.paintGraph?.roots ?? scene.drawRuns.map((_, runIndex) => ({ kind: "draw", runIndex })) }] } };
    assert.equal(prepareEditorTranslationPreview(composited, selected, []), null, "inseparable compositing stays on the general path");
    assert.equal(prepareEditorTranslationPreview(scene, [{ kind: "raster", index: 0 }], []), null);
    assert.equal(prepareEditorTranslationPreview(scene, [{ kind: "gradient-fill", index: 0 }], []), null);
    const stroke = selected.find(ref => ref.kind === "stroke"), clipped = { ...scene, primitiveMeta: scene.primitiveMeta.slice() };
    const offset = stroke.index * 4 + 3, flags = Math.floor(clipped.primitiveMeta[offset] / 2);
    clipped.primitiveMeta[offset] = (flags | 4) * 2 + clipped.primitiveMeta[offset] - flags * 2;
    assert.equal(prepareEditorTranslationPreview(clipped, [stroke], []), null, "hard stroke clips keep final-commit antialiasing through the general compiler");
    const legacy = { ...scene, textContent: [{ text: "Unmoved source text", minX: 80, minY: 80, maxX: 100, maxY: 100, pageIndex: 0 }] };
    assert.equal(prepareEditorTranslationPreview(legacy, selected, []).translate(2, 3).textContent, legacy.textContent, "unaffected legacy word geometry stays available");
    const fillRun = scene.drawRuns.findIndex(run => run.kind === "fill");
    if (fillRun >= 0) {
      const bounds = { minX: 15, minY: 20, maxX: 45, maxY: 45 };
      const untouched = { kind: "group", alpha: .5, isolated: false, knockout: false, blendMode: "Normal", bounds, children: [{ kind: "draw", runIndex: fillRun }] };
      const scoped = { ...scene, paintGraph: { roots: [untouched, ...scene.drawRuns.flatMap((_, runIndex) => runIndex === fillRun ? [] : [{ kind: "draw", runIndex }])] } };
      const partial = prepareEditorTranslationPreview(scoped, [stroke], []); assert(partial);
      const moved = partial.translate(7, 8), group = moved.paintGraph.roots[0];
      assert.equal(group.bounds, bounds, "moving independent artwork cannot change untouched compositing extents");
      assert.equal(group.alpha, .5); assert.equal(group.children.length, 1);
    }
  }

  const bytes = fixture(), parser = await openPdf({ kind: "bytes", bytes }); let source;
  try { source = composeVectorScenesInColumn([await parser.compileVectorPage(0, { optimization: "none" })]); } finally { await parser.close(); }
  const sourceIdentity = editorPaintIdentity(source); setEditorPaintIdentity(source, ref => `source:page:test:${sourceIdentity(ref)}`);
  const services = await createEditorAppServices({ sourcePdf: bytes, loadFontAsset: async url => new Uint8Array(await readFile(url)) });
  let fieldCompilations = 0, objectCompilations = 0;
  const options = { ...services.sessionOptions,
    compileFields: (...args) => { fieldCompilations++; return services.sessionOptions.compileFields(...args); },
    compileObject: (...args) => { objectCompilations++; return services.sessionOptions.compileObject(...args); } };
  const session = createEditorSession(source, options);
  try {
    session.setFieldValue("Shared", "Example crossing the field edge");
    const shape = session.addObject({ kind: "shape", shape: "rectangle", pageIndex: 0, x: 30, y: 30, width: 50, height: 30, fill: "red", color: "blue" });
    const text = session.addObject({ kind: "text", pageIndex: 0, x: 50, y: 80, width: 70, height: 20, text: "Textbox", fontSize: 12 });
    const canonical = await session.getScene({ preview: false }), pristine = structuredClone(canonical);
    const warm = [fieldCompilations, objectCompilations], field = source.annotations.find(annotation => annotation.field?.name === "Shared");
    const canonicalRuns = getSceneAnnotationRuns(canonical).get(field.id), fieldRefs = canonicalRuns.flatMap(run => Array.from({ length: run.count }, (_, index) => ({ kind: run.kind, index: run.first + index })));
    assert(fieldRefs.length > 0); assert(fieldRefs.some(ref => getPrimitiveClipChain(canonical, ref).clipIndex >= 0));
    const hardText = { ...canonical, textInstanceB: canonical.textInstanceB.slice(), textClipRects: Float32Array.of(0, 0, 100, 100) };
    hardText.textInstanceB[fieldRefs[0].index * 4 + 3] = 1;
    assert.equal(prepareEditorTranslationPreview(hardText, [fieldRefs[0]], [field.id]), null, "hard text clips cannot change edge coverage when committing a preview");
    let lastBaseline;
    for (const selection of [[shape], [text], ["source:fill:0"], [`annotation:${field.id}`], [shape, text, `annotation:${field.id}`]]) {
      session.select(selection); let prior;
      for (const [dx, dy] of [[10, 20], [-3, 8], [32.5, -17.25]]) {
        session.setPreviewTransform([1, 0, 0, 1, dx, dy]); const frame = await session.getScene(), hint = getEditorSceneTranslationHint(frame);
        assert(hint, "translated supported selections use a prepared scene");
        lastBaseline = hint.source;
        if (prior) { assert.equal(hint.source, getEditorSceneTranslationHint(prior).source); assert.equal(frame.drawRuns, prior.drawRuns); assert.equal(frame.paintGraph, prior.paintGraph); }
        assert.equal(frame.styles, canonical.styles); assert.equal(frame.textGlyphMetaA, canonical.textGlyphMetaA); assert.equal(frame.textGlyphSegmentsA, canonical.textGlyphSegmentsA);
        assert.deepEqual([fieldCompilations, objectCompilations], warm, "each pose skips form/object compilation and whole-page composition");
        assert(frame.annotations.filter(annotation => annotation.field?.name === "Shared").every(annotation => annotation.field.value === "Example crossing the field edge"));
        const expected = bakeEditorSourceScene(canonical, hint.changed.map(ref => ({ ref, deleted: false, transform: [1, 0, 0, 1, dx, dy] })));
        checkGeometry(frame, expected, hint.changed);
        if (selection.includes(`annotation:${field.id}`)) {
          near(getEditorAnnotationFrameTransform(frame, field.id), [1, 0, 0, 1, dx, dy], "current form frame follows its translated glyphs");
          assert.equal(getEditorAnnotationSource(frame, field.id).pdfGeometry.rect.length, 4);
        }
        prior = frame;
      }
      session.setPreviewTransform(null); assert.equal(await session.getScene({ preview: false }), canonical, "gesture cancellation restores the committed canonical scene");
    }
    assert.deepEqual(canonical, pristine, "fast previews never alias or mutate the committed document");
    session.select(["source:fill:0"]); const [clone] = session.cloneSelection([20, 0]);
    await session.getScene({ preview: false }); const cloneWarm = [fieldCompilations, objectCompilations];
    session.select([clone]); session.setPreviewTransform([1, 0, 0, 1, 9, 11]);
    const clonePose = await session.getScene(); assert(getEditorSceneTranslationHint(clonePose).changed.length > 0, "source clones resolve their independent composite paint owners");
    assert.deepEqual([fieldCompilations, objectCompilations], cloneWarm);
    session.setPreviewTransform(null);
    session.select([shape]); session.setPreviewTransform([0, 1, -1, 0, 10, 20]);
    assert.equal(getEditorSceneTranslationHint(await session.getScene()), undefined, "rotation keeps full-fidelity compilation");
    assert(fieldCompilations > warm[0]); session.setPreviewTransform(null);
    session.setFieldValue("Shared", "Changed"); const changed = await session.getScene({ preview: false });
    session.selectAnnotations([field.id]); session.setPreviewTransform([1, 0, 0, 1, 4, 5]); const afterValue = await session.getScene();
    assert(afterValue.annotations.filter(annotation => annotation.field?.name === "Shared").every(annotation => annotation.field.value === "Changed"));
    assert.notEqual(getEditorSceneTranslationHint(afterValue).source, lastBaseline);
    await assert.rejects(session.getScene({ signal: AbortSignal.abort() }), { name: "AbortError" });
    let changedDuringProgress = false;
    session.setPreviewTransform([1, 0, 0, 1, 6, 7]);
    const captured = await session.getScene({ onProgress() {
      if (!changedDuringProgress) { changedDuringProgress = true; session.setFieldValue("Shared", "Changed during progress"); }
    } });
    assert(captured.annotations.filter(annotation => annotation.field?.name === "Shared").every(annotation => annotation.field.value === "Changed"), "progress callbacks cannot tear the captured document snapshot");
    assert((await session.getScene({ preview: false })).annotations.filter(annotation => annotation.field?.name === "Shared").every(annotation => annotation.field.value === "Changed during progress"));
  } finally { session.dispose(); services.dispose(); }
  const blank = createEditorSession(source);
  try {
    const field = source.annotations.find(annotation => annotation.field?.name === "Shared");
    blank.selectAnnotations([field.id]); blank.setPreviewTransform([1, 0, 0, 1, 4, 5]); const pose = await blank.getScene();
    assert.equal(getEditorSceneTranslationHint(pose).changed.length, 0, "metadata-only blank widgets need no GPU geometry edits");
    near(getEditorAnnotationFrameTransform(pose, field.id), [1, 0, 0, 1, 4, 5], "blank field controls still follow the current frame");
  } finally { blank.dispose(); }
  console.log("Translation previews: immutable prepared geometry, current field values, antialiased clip ownership, stable paint resources, source/authored/mixed selection, cancellation and conservative fallbacks passed.");
} finally { hooks.deregister(); }

function fixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /AcroForm 8 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /CropBox [3 4 197 196] /Rotate 90 /Contents 4 0 R /Annots [10 0 R 11 0 R] >>" },
    { number: 4, body: tinyPdfStream("", "0 g 100 110 10 10 re f") },
    { number: 6, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" },
    { number: 7, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 30 20]", "") },
    { number: 8, body: "<< /Fields [9 0 R] /DR << /Font << /Helv 6 0 R >> >> /DA (/Helv 10 Tf 0 g) >>" },
    { number: 9, body: "<< /FT /Tx /T (Shared) /V () /Kids [10 0 R 11 0 R] >>" },
    { number: 10, body: "<< /Type /Annot /Subtype /Widget /Parent 9 0 R /Rect [10 20 40 40] /AP << /N 7 0 R >> >>" },
    { number: 11, body: "<< /Type /Annot /Subtype /Widget /Parent 9 0 R /Rect [10 60 40 80] /AP << /N 7 0 R >> >>" }
  ] });
}
