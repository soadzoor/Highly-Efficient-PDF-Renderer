import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });
const identity = [1, 0, 0, 1, 0, 0];
const multiply = (outer, local) => [outer[0] * local[0] + outer[2] * local[1], outer[1] * local[0] + outer[3] * local[1],
  outer[0] * local[2] + outer[2] * local[3], outer[1] * local[2] + outer[3] * local[3],
  outer[0] * local[4] + outer[2] * local[5] + outer[4], outer[1] * local[4] + outer[3] * local[5] + outer[5]];
const rotation = angle => {
  const c = Math.cos(angle), s = Math.sin(angle), cx = 170, cy = 107;
  return [c, s, -s, c, cx - c * cx + s * cy + 12, cy - s * cx - c * cy + 8];
};
const close = (actual, expected, message, tolerance = .0002) => {
  assert.equal(actual.length, expected.length, message);
  actual.forEach((value, index) => assert(Math.abs(value - expected[index]) <= tolerance,
    `${message}: component ${index}, ${value} vs ${expected[index]}`));
};

try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { getSceneAnnotationRuns } = await import("../src/scenePrimitives.ts");
  const { getEditorAnnotationSource, getEditorAnnotationFrameTransform } = await import("../src/editorScene.ts");
  const { validateVectorDrawRuns } = await import("../src/vectorDrawOrder.ts");
  const { validateScenePaintGraph } = await import("../src/scenePaintGraph.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const services = await createEditorAppServices({ loadFontAsset: async url => new Uint8Array(await readFile(url)) });
  const glyphs = (scene, id) => (getSceneAnnotationRuns(scene).get(id) ?? []).flatMap(run => run.kind !== "text" ? []
    : Array.from({ length: run.count }, (_, index) => {
      const offset = (run.first + index) * 4;
      return [...scene.textInstanceA.subarray(offset, offset + 4), ...scene.textInstanceB.subarray(offset, offset + 2)];
    }));
  const compareField = (actual, baseline, id, transform, label) => {
    const actualGlyphs = glyphs(actual, id), baselineGlyphs = glyphs(baseline, id);
    assert(baselineGlyphs.length > 0, `${label}: baseline has text glyphs`);
    assert.equal(actualGlyphs.length, baselineGlyphs.length, `${label}: there are no missing or duplicate appearances`);
    actualGlyphs.forEach((matrix, index) => close(matrix, multiply(transform, baselineGlyphs[index]), `${label}: glyph ${index} basis and position`));
  };
  const sourceScene = () => {
    const scene = createEmptyVectorScene();
    Object.assign(scene, { pageCount: 1, pagesPerRow: 1, pageRects: Float32Array.of(40, 70, 640, 470),
      pageTextRanges: Uint32Array.of(0, 0), bounds: { minX: 40, minY: 70, maxX: 640, maxY: 470 },
      pageBounds: { minX: 40, minY: 70, maxX: 640, maxY: 470 },
      pdfPages: [{ pageIndex: 0, sourcePageIndex: 4, pdfToScene: [1, 0, 0, 1, 40, 70] }] });
    scene.annotations = [["field:left", [30, 30, 230, 44]], ["field:right", [40, 110, 180, 134]]].map(([id, rect], annotationIndex) => ({
      id, pageIndex: 0, sourcePageIndex: 4, annotationIndex, subtype: "Widget", flags: 0, visibleInDefaultView: true,
      hasAppearance: false, pdfGeometry: { rect }, bounds: { minX: rect[0] + 40, minY: rect[1] + 70, maxX: rect[2] + 40, maxY: rect[3] + 70 },
      field: { name: "Shared", type: "Tx", flags: 0, value: "" }
    }));
    return scene;
  };
  const transforms = [rotation(Math.PI * 31 / 180), [1.35, .25, .4, .7, 20, -10], [-.8, .15, .2, 1.2, 350, 5]];
  try {
    for (const painted of [false, true]) for (const [caseIndex, firstTransform] of transforms.entries()) {
      const empty = sourceScene(), source = painted ? await services.sessionOptions.compileFields(empty, new Map([["Shared", "Seed"]])) : empty;
      const before = structuredClone(source), label = `${painted ? "painted" : "blank"} field, affine case ${caseIndex}`;
      if (painted) assert(glyphs(source, "field:left").length, `${label}: starts with a generated appearance`);
      else assert.equal(getSceneAnnotationRuns(source).size, 0);
      const editor = await openEditorSession(source, services.sessionOptions);
      const baselines = new Map();
      const baseline = async value => {
        if (!baselines.has(value)) baselines.set(value, await services.sessionOptions.compileFields(source, new Map([["Shared", value]])));
        return baselines.get(value);
      };
      const assertState = async (value, transform, title) => {
        const current = await editor.getScene(), expected = await baseline(value);
        compareField(current, expected, "field:left", transform, `${label}: ${title}`);
        compareField(current, expected, "field:right", identity, `${label}: shared sibling ${title}`);
        assert(current.annotations.filter(annotation => annotation.field?.name === "Shared").every(annotation => annotation.field.value === value),
          `${label}: shared widgets keep one current value`);
        const native = getEditorAnnotationSource(current, "field:left"); assert(native, `${label}: original frame survives compilation/composition`);
        assert.deepEqual(native.pdfGeometry.rect, source.annotations[0].pdfGeometry.rect, `${label}: original native rectangle survives`);
        assert.deepEqual(native.bounds, source.annotations[0].bounds, `${label}: wrapping dimensions remain independent from the transformed AABB`);
        close(getEditorAnnotationFrameTransform(current, "field:left"), transform, `${label}: retained field frame`);
        validateVectorDrawRuns(current); validateScenePaintGraph(current);
        return current;
      };
      try {
        editor.addObject({ kind: "shape", pageIndex: 0, shape: "rectangle", x: 300, y: 150, width: 20, height: 12, color: "red", fill: "red" });
        editor.addObject({ kind: "text", pageIndex: 0, x: 320, y: 180, width: 100, height: 24, text: "Added", fontSize: 10 });
        editor.selectAnnotations(["field:left"]); editor.transformSelection(firstTransform);
        editor.setFieldValue("Shared", "Alpha");
        const first = await assertState("Alpha", firstTransform, "typing after the first transform");
        const direct = await services.sessionOptions.compileFields(first, new Map([["Shared", "Direct"]]));
        compareField(direct, await baseline("Direct"), "field:left", firstTransform, `${label}: regenerating the composed scene`);
        compareField(direct, await baseline("Direct"), "field:right", identity, `${label}: composed shared sibling`);
        close(getEditorAnnotationFrameTransform(direct, "field:left"), firstTransform, `${label}: frame survives repeated compilation`);
        assert.deepEqual(getEditorAnnotationSource(direct, "field:left").bounds, source.annotations[0].bounds);
        editor.setFieldValue("Shared", "Beta"); await assertState("Beta", firstTransform, "retyping");
        const nextTransform = [.9, -.15, .3, 1.1, -8, 12], combined = multiply(nextTransform, firstTransform);
        editor.selectAnnotations(["field:left"]); editor.transformSelection(nextTransform);
        await assertState("Beta", combined, "second transform after filling");
        editor.setFieldValue("Shared", "Gamma"); const final = await assertState("Gamma", combined, "retyping after the second transform");
        editor.undo(); await assertState("Beta", combined, "undoing a value change");
        editor.undo(); await assertState("Beta", firstTransform, "undoing the second transform");
        editor.redo(); await assertState("Beta", combined, "redoing the transform");
        editor.redo(); await assertState("Gamma", combined, "redoing the value change");
        assert(final.textInstanceCount > glyphs(final, "field:left").length + glyphs(final, "field:right").length,
          `${label}: unrelated authored text remains in the composed scene`);
        if (caseIndex === 0) {
          const bytes = new Uint8Array(await (await editor.saveHep({ withVectorLod: false, withTextLod: false, encodeRasterImages: false, compression: "store" })).arrayBuffer());
          const reopened = await loadSceneFromHep(bytes);
          assert.equal(getEditorAnnotationSource(reopened, "field:left"), undefined, "HEP contains no operation-local source frame");
          assert.equal(getEditorAnnotationFrameTransform(reopened, "field:left"), undefined, "HEP contains no operation-local transform map");
          assert(!("editor" in reopened) && !("sourcePdf" in reopened) && !("history" in reopened));
          const annotationKeys = Object.keys(source.annotations[0]).sort();
          for (const annotation of reopened.annotations) assert.deepEqual(Object.keys(annotation).sort(), annotationKeys,
            "field placements do not add annotation persistence properties");
          for (const font of services.fonts.list()) assert.equal(Buffer.from(bytes).indexOf(Buffer.from(font.bytes)), -1, "HEP contains no source font programs");
          assert.equal(Buffer.from(bytes).indexOf(Buffer.from("%PDF-")), -1, "HEP contains no embedded source PDF");
          assert.equal(Buffer.from(bytes).indexOf(Buffer.from("annotationSources")), -1);
          assert.equal(Buffer.from(bytes).indexOf(Buffer.from("annotationTransforms")), -1);
        }
        assert.deepEqual(source, before, `${label}: caller source geometry and annotations remain immutable`);
      } finally { editor.dispose(); }
    }
  } finally { services.dispose(); }
  console.log("Field transforms: native wrapping frames, affine glyph poses, shared widgets, repeated typing/history, composition and compact HEP passed.");
} finally { hooks.deregister(); }
