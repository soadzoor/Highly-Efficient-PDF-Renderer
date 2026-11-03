import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const originalDocument = globalThis.document;
try {
  const { createEditorGlyphStoreCache } = await import("../src/editorGlyphStoreCache.ts");
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { buildTextRasterAtlas } = await import("../src/textRasterAtlas.ts");
  const { editorPaintIdentity, editorAuthoredOwner, setEditorPaintIdentity } = await import("../src/editorPaintIdentity.ts");
  const { setEditorAnnotationSource, getEditorAnnotationSource, retainEditorAnnotationPlacements } = await import("../src/editorScene.ts");
  const { getScenePrimitive } = await import("../src/scenePrimitives.ts");
  const keys = ["textGlyphMetaA", "textGlyphMetaB", "textGlyphSegmentsA", "textGlyphSegmentsB"];
  const cloneStores = value => ({ textGlyphCount: value.textGlyphCount, ...Object.fromEntries(keys.map(key => [key, value[key].slice()])) });
  const sameRefs = (actual, expected, label) => { for (const key of keys) assert.equal(actual[key], expected[key], `${label}: ${key}`); };
  const originalStores = { textGlyphCount: 1, textGlyphMetaA: Float32Array.of(0, 3, 0, 0), textGlyphMetaB: Float32Array.of(5, 8, 0, 0),
    textGlyphSegmentsA: Float32Array.of(0, 0, 0, 0, 5, 0, 0, 0, 0, 8, 0, 0),
    textGlyphSegmentsB: Float32Array.of(5, 0, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0) };
  {
    const cache = createEditorGlyphStoreCache(originalStores), copy = cloneStores(originalStores);
    sameRefs(cache.reuse(copy), originalStores, "identical copied resources reuse the seeded set");
    assert.notEqual(copy.textGlyphMetaA, originalStores.textGlyphMetaA, "resource lookup does not assign into the supplied store object");
    const changed = cloneStores(copy); changed.textGlyphSegmentsA[4] = 7;
    sameRefs(cache.reuse(changed), changed, "a real outline change replaces the single retained set");
    const oldContentAgain = cloneStores(originalStores);
    sameRefs(cache.reuse(oldContentAgain), oldContentAgain, "the cache does not retain historical glyph sets");
    const next = cloneStores(oldContentAgain); cache.clear();
    sameRefs(cache.reuse(next), next, "clearing releases resource identities");
    for (const key of keys) {
      const seed = cloneStores(originalStores), cache = createEditorGlyphStoreCache(seed), altered = cloneStores(seed);
      altered[key][0] += 1; sameRefs(cache.reuse(altered), altered, `${key} changes invalidate all resource identities together`);
    }
    const changedCount = { ...cloneStores(originalStores), textGlyphCount: 2 };
    sameRefs(createEditorGlyphStoreCache(originalStores).reuse(changedCount), changedCount, "glyph count participates in resource identity");
    const shorter = cloneStores(originalStores); shorter.textGlyphSegmentsA = shorter.textGlyphSegmentsA.subarray(0, 4);
    sameRefs(createEditorGlyphStoreCache(originalStores).reuse(shorter), shorter, "length differences are never reused");
    const negativeZero = cloneStores(originalStores); negativeZero.textGlyphMetaA[0] = -0;
    sameRefs(createEditorGlyphStoreCache(originalStores).reuse(negativeZero), negativeZero, "signed zero retains its bit identity");
    const nan = cloneStores(originalStores), otherNan = cloneStores(originalStores);
    new Uint32Array(nan.textGlyphMetaB.buffer)[0] = 0x7fc00001; new Uint32Array(otherNan.textGlyphMetaB.buffer)[0] = 0x7fc00002;
    const nanCache = createEditorGlyphStoreCache(nan);
    sameRefs(nanCache.reuse(cloneStores(nan)), nan, "identical NaN payloads compare equal by bits");
    sameRefs(nanCache.reuse(otherNan), otherNan, "different NaN payloads are never normalized together");
    const backing = new Float32Array(originalStores.textGlyphMetaA.length + 4); backing.set(originalStores.textGlyphMetaA, 4);
    sameRefs(createEditorGlyphStoreCache(originalStores).reuse({ ...cloneStores(originalStores), textGlyphMetaA: backing.subarray(4) }), originalStores,
      "bit comparison observes typed-array view offsets");
  }

  const identity = [1, 0, 0, 1, 0, 0], source = buildStrokeScene([{ points: [[5, 5], [80, 5]], color: "black", width: 1 }]);
  Object.assign(source, originalStores, { pageCount: 1, pageRects: Float32Array.of(0, 0, 100, 100), pageBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, textGlyphSegmentCount: 3, textInstanceCount: 2,
    textInstanceA: Float32Array.of(1, 0, 0, 1, 1, 0, 0, 1), textInstanceB: Float32Array.of(10, 30, 0, 0, 30, 30, 0, 0),
    textInstanceC: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1), pageTextRanges: Uint32Array.of(0, 2),
    textIndex: { version: 2, pages: [{ text: "AA", charInstance: Int32Array.of(0, 1), fallbackQuads: new Float32Array() }] },
    drawRuns: [{ kind: "stroke", first: 0, count: 1 }, { kind: "text", first: 0, count: 2 }],
    annotations: [{ id: "field", pageIndex: 0, sourcePageIndex: 0, annotationIndex: 0, subtype: "Widget", visibleInDefaultView: true,
      hasAppearance: false, flags: 0, bounds: { minX: 10, minY: 30, maxX: 40, maxY: 40 }, pdfGeometry: { rect: [10, 30, 40, 40] },
      field: { type: "Tx", name: "Name", flags: 0, value: "Old" } }] });
  setEditorAnnotationSource(source, source.annotations[0]); setEditorPaintIdentity(source, ref => `original:${ref.kind}:${ref.index}`);
  const pristine = structuredClone(source);
  let canvases = 0;
  globalThis.document = { createElement(tag) { assert.equal(tag, "canvas"); canvases++; return createCanvas(1, 1); } };
  const originalAtlas = buildTextRasterAtlas(source, 1024); assert(originalAtlas); assert.equal(canvases, 1);
  const session = createEditorSession(source);
  try {
    assert.equal(await session.getScene(), source, "the unchanged session returns its source without a scene clone");
    const id = session.addObject({ kind: "shape", shape: "rectangle", pageIndex: 0, x: 50, y: 50, width: 20, height: 10, fill: "red" });
    session.select([id]); let previous;
    for (const matrix of [[1, 0, 0, 1, 2, 3], [0, 1, -1, 0, 90, 0], [1, .2, .3, .7, -4, 5]]) {
      session.setPreviewTransform(matrix); const scene = await session.getScene({ preview: true });
      sameRefs(scene, source, "composed added-object previews retain immutable source glyphs");
      assert.equal(buildTextRasterAtlas(scene, 1024), originalAtlas); assert.equal(canvases, 1, "moving and rotating a shape never redraws the text atlas");
      assert.equal(editorPaintIdentity(scene)({ kind: "stroke", index: 0 }), "original:stroke:0");
      assert.equal(editorPaintIdentity(scene)({ kind: "fill", index: 0 }), editorAuthoredOwner(id), "glyph-only scene clones preserve authored paint owners");
      assert.deepEqual(getEditorAnnotationSource(scene, "field"), source.annotations[0], "annotation-local source placement survives the clone");
      assert.deepEqual([...scene.textInstanceB], [...source.textInstanceB], "unselected text instances never inherit another object's transform");
      const bounds = getScenePrimitive(scene, { kind: "fill", index: 0 }).bounds;
      if (previous) assert.notDeepEqual(bounds, previous, "each preview retains the current object pose"); previous = bounds;
    }
    session.setPreviewTransform(null); session.selectPrimitives([{ kind: "text", index: 0 }]);
    session.setPreviewTransform([1, 0, 0, 1, 4, 5]); const movedText = await session.getScene();
    sameRefs(movedText, source, "glyphs stay shared when text instances move");
    assert.equal(movedText.textInstanceB[0], 14); assert.equal(movedText.textInstanceB[1], 35); assert.equal(movedText.textInstanceB[4], 30);
    assert.equal(buildTextRasterAtlas(movedText, 1024), originalAtlas); assert.equal(canvases, 1);
  } finally { session.dispose(); }
  assert.deepEqual(source, pristine, "source arrays, instances, metadata and paint runs remain untouched");

  let fieldCompilations = 0;
  const fields = createEditorSession(source, { compileFields: async (base, values) => {
    fieldCompilations++; const value = values.get("Name"), result = { ...base, ...cloneStores(base), textInstanceB: base.textInstanceB.slice(), textInstanceC: base.textInstanceC.slice(),
      annotations: base.annotations.map(annotation => ({ ...annotation, field: { ...annotation.field, value } })) };
    result.textGlyphMetaB[0] = value === "New outline" ? 7 : 5;
    result.textInstanceB[0] += fieldCompilations; result.textInstanceC[0] = fieldCompilations / 10;
    retainEditorAnnotationPlacements(base, result); return result;
  } });
  try {
    fields.setFieldValue("Name", "Same glyphs"); const first = await fields.getScene({ preview: false });
    sameRefs(first, source, "freshly compiled fields can reuse identical glyph resources without an authored addition");
    assert.equal(first.annotations[0].field.value, "Same glyphs"); assert.equal(first.textInstanceB[0], 11);
    assert.equal(buildTextRasterAtlas(first, 1024), originalAtlas);
    fields.setFieldValue("Name", "Another value"); const second = await fields.getScene({ preview: false });
    sameRefs(second, first, "field values and instances do not invalidate unchanged glyphs");
    assert.equal(second.textInstanceB[0], 12); assert.equal(second.textInstanceC[0], Math.fround(.2));
    assert.equal(first.textInstanceB[0], 11); assert.equal(first.annotations[0].field.value, "Same glyphs", "older scenes retain their own current field values");
    assert.equal(second.annotations[0].field.value, "Another value");
    fields.setFieldValue("Name", "New outline"); const changed = await fields.getScene({ preview: false });
    assert.notEqual(changed.textGlyphMetaB, first.textGlyphMetaB); assert.notEqual(buildTextRasterAtlas(changed, 1024), originalAtlas);
    assert.equal(canvases, 2, "a changed glyph resource regenerates the atlas");
    fields.setFieldValue("Name", "New outline"); const stable = await fields.getScene({ preview: false });
    sameRefs(stable, changed, "repeated compilation retains the new glyph set"); assert.equal(buildTextRasterAtlas(stable, 1024), buildTextRasterAtlas(changed, 1024));
    assert.equal(canvases, 2);
  } finally { fields.dispose(); }

  const independentSource = structuredClone(source), independent = createEditorSession(independentSource);
  try {
    const id = independent.addObject({ kind: "shape", shape: "ellipse", pageIndex: 0, x: 60, y: 60, width: 10, height: 10 }); independent.select([id]);
    const scene = await independent.getScene(); sameRefs(scene, independentSource, "another session uses its own immutable resource identities");
    assert.notEqual(scene.textGlyphMetaA, source.textGlyphMetaA);
  } finally { independent.dispose(); }

  const fonts = createEditorSession(source, { compileObject: async object => {
    assert.equal(object.kind, "text");
    const scene = createEmptyVectorScene(), width = object.fontId === "wide" ? 9 : 6;
    Object.assign(scene, cloneStores(source), { textGlyphSegmentCount: 3, textInstanceCount: 1,
      textInstanceA: Float32Array.of(1, 0, 0, 1), textInstanceB: Float32Array.of(60, 40, 0, 0), textInstanceC: Float32Array.of(1, 0, 0, 1),
      pageCount: 1, pageRects: Float32Array.of(0, 0, 100, 100), pageTextRanges: Uint32Array.of(0, 1),
      pageBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      textIndex: { version: 2, pages: [{ text: object.text, charInstance: Int32Array.of(0), fallbackQuads: new Float32Array() }] },
      drawRuns: [{ kind: "text", first: 0, count: 1 }] });
    scene.textGlyphMetaB[0] = scene.textGlyphSegmentsA[4] = scene.textGlyphSegmentsB[0] = width;
    return scene;
  } });
  try {
    const id = fonts.addObject({ kind: "text", pageIndex: 0, x: 60, y: 40, width: 20, height: 10, text: "B", fontSize: 10, fontId: "narrow" });
    const first = await fonts.getScene(), atlas = buildTextRasterAtlas(first, 1024), before = canvases;
    fonts.select([id]); fonts.setPreviewTransform([1, 0, 0, 1, 3, 4]);
    const moved = await fonts.getScene(); sameRefs(moved, first, "authored font outlines survive instance-only transforms");
    assert.equal(buildTextRasterAtlas(moved, 1024), atlas); assert.equal(canvases, before);
    fonts.setPreviewTransform(null); fonts.updateObject(id, { fontId: "wide", text: "C" });
    const changed = await fonts.getScene();
    assert.notEqual(changed.textGlyphSegmentsA, first.textGlyphSegmentsA, "switching to a font with different outlines invalidates resource reuse");
    assert.notEqual(buildTextRasterAtlas(changed, 1024), atlas); assert.equal(canvases, before + 1);
    assert(changed.textIndex.pages[0].text.includes("C")); assert(!changed.textIndex.pages[0].text.includes("B"), "text/search data always belongs to the current compile");
    assert.deepEqual([...first.textInstanceB], [...moved.textInstanceB].map((value, index) => index === 8 ? value - 3 : index === 9 ? value - 4 : value),
      "instance positions retain the requested text transform while shared glyphs remain local");
  } finally { fonts.dispose(); }
  console.log("Editor glyph-store reuse: exact bits, bounded current entry, outline/meta/count invalidation, immutable scenes, shape/text transforms, field values, paint identity and atlas reuse passed.");
} finally { if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; hooks.deregister(); }
