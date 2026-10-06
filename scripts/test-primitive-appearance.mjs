import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { Color } from "three";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { PrimitiveAppearanceState, normalizePrimitiveColor } = await import("../src/primitiveAppearance.ts");
  const { getScenePrimitive } = await import("../src/scenePrimitives.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const scene = createEmptyVectorScene();
  Object.assign(scene, {
    pageCount: 1, pageRects: Float32Array.of(0, 0, 100, 100),
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    pageBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    segmentCount: 2, sourceSegmentCount: 2, maxHalfWidth: 1,
    endpoints: Float32Array.of(0, 10, 100, 10, 0, 30, 50, 70),
    primitiveMeta: Float32Array.of(100, 10, 0, 1, 100, 30, 1, 8.5),
    primitiveBounds: Float32Array.of(0, 10, 100, 10, 10, 20, 90, 80),
    styles: Float32Array.of(1, 0.25, 0.5, 0.75, 1, 0, 0, 0),
    clipPaths: [{ parent: -1, fillRule: 0, edges: Float32Array.of(0,0,100,0, 100,0,100,100, 100,100,0,100, 0,100,0,0) }],
    drawRuns: [{ kind: "stroke", first: 0, count: 2, clipIndex: 0 }]
  });
  const original = structuredClone(scene);
  const colorCalls = [], highlightCalls = [];
  const state = new PrimitiveAppearanceState(scene, {
    onColors: updates => colorCalls.push(updates), onHighlights: data => highlightCalls.push(data)
  });
  const a = { kind: "stroke", index: 0 }, b = { kind: "stroke", index: 1 };
  assert.deepEqual(normalizePrimitiveColor("red"), [1, 0, 0]);
  assert.deepEqual(normalizePrimitiveColor("ff0000"), [1, 0, 0]);
  assert.deepEqual(normalizePrimitiveColor("rebeccapurple"), [102 / 255, 51 / 255, 153 / 255]);
  for (const [name, packed] of Object.entries(Color.NAMES)) {
    assert.deepEqual(normalizePrimitiveColor(` ${name.toUpperCase()} `),
      [(packed >>> 16) / 255, ((packed >>> 8) & 255) / 255, (packed & 255) / 255],
      `Preserve the existing named color ${name}`);
  }
  assert.deepEqual(normalizePrimitiveColor("#abc"), [170 / 255, 187 / 255, 204 / 255]);
  assert.deepEqual(normalizePrimitiveColor(0x123456), [18 / 255, 52 / 255, 86 / 255]);
  assert.throws(() => normalizePrimitiveColor("nonsense"), /color/);
  assert.throws(() => normalizePrimitiveColor("constructor"), /color/);
  assert.throws(() => normalizePrimitiveColor("transparent"), /color/);
  assert.throws(() => normalizePrimitiveColor([1, NaN, 0]), /color/);
  state.setOverrides([a, a], { color: "red" });
  assert.equal(colorCalls.length, 1);
  assert.equal(colorCalls[0].length, 1);
  assert(state.hasOverrides("stroke"));
  state.setOverrides([a], { color: "#ff0000" });
  assert.equal(colorCalls.length, 1, "same color does not upload again");
  assert.throws(() => state.setOverrides([b, { kind: "stroke", index: 99 }], { color: "blue" }));
  assert.throws(() => state.setOverrides([b], { color: "invalid" }));
  assert.equal(state.getColorUpdates().length, 1, "failed batches do not partially apply");
  const external = state.getColorUpdates(); external[0].color[0] = 0; external[0].ref.index = 1;
  assert.deepEqual(state.getColorUpdates()[0], { ref: a, color: [1, 0, 0] });
  state.setSelection([a, a]);
  state.setHover(b);
  const highlights = state.getHighlights();
  assert.equal(highlights.selectionCount, 1);
  assert.equal(highlights.count, 2);
  assert.deepEqual([...highlights.segments.subarray(8, 15)], [0, 30, 50, 70, 100, 30, 1]);
  assert(highlights.clipPaths.length >= 2, "traces include source and rectangular stroke clips");
  state.setHover({ ...b });
  assert.equal(state.getHighlights(), highlights, "unchanged hover reuses overlay geometry");
  state.setSelection([b]);
  assert.deepEqual(state.getHover(), b, "selection does not overwrite hover");
  state.clearOverrides([a]);
  assert.deepEqual(colorCalls.at(-1), [{ ref: a, color: null }]);
  state.setOverrides([b], { color: "blue" });
  state.dispose();
  assert.equal(highlightCalls.at(-1), null);
  assert.equal(colorCalls.at(-1)[0].color, null);
  assert.throws(() => state.setHover(a), /disposed/);
  assert.deepEqual(scene, original, "interaction never mutates canonical data");

  // Only a tiny synthetic scene is serialized. No source PDF conversion.
  const hep = await buildHep(scene, { compression: "store", encodeRasterImages: false });
  const bytes = await hep.arrayBuffer();
  const restoredA = await loadSceneFromHep(bytes);
  const restoredB = await loadSceneFromHep(bytes);
  for (const ref of [a, b]) {
    assert.deepEqual(getScenePrimitive(restoredA, ref).getSegment(0), getScenePrimitive(restoredB, ref).getSegment(0));
    assert.equal(getScenePrimitive(restoredA, ref).index, ref.index);
  }
  const restoredState = new PrimitiveAppearanceState(restoredA);
  restoredState.setOverrides([a], { color: "red" });
  const exported = await buildHep(restoredA, { compression: "store", encodeRasterImages: false });
  const reloaded = await loadSceneFromHep(await exported.arrayBuffer());
  assert.deepEqual([...reloaded.styles], [...restoredA.styles], "appearance changes are not exported");
  console.log("Primitive appearance, tracing, and HEP reference tests passed.");
} finally { hooks.deregister(); }
