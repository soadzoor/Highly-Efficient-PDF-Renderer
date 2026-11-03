import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { applyEditorSourceColors, editorSourcePaintColors } = await import("../src/editorSourceColors.ts");
  const { getScenePrimitive } = await import("../src/scenePrimitives.ts");
  const { sampleSceneGradientChannel } = await import("../src/gradientSampling.ts");
  const { getGradientMeshTriangle } = await import("../src/gradientMesh.ts");
  const { GRADIENT_LUT_WIDTH } = await import("../src/orderedGradientPaint.ts");
  const identity = [1, 0, 0, 1, 0, 0], edit = (kind, index, color) => ({ ref: { kind, index }, transform: identity, deleted: false, color });
  const scene = buildStrokeScene([{ points: [[0, 0], [10, 0]], width: 2, color: "red" }, { points: [[0, 2], [10, 2]], width: 3, color: "blue" }]);
  scene.fillPathCount = 2; scene.fillSegmentCount = 8;
  scene.fillPathMetaA = Float32Array.of(0, 4, 0, 0, 4, 4, 20, 0);
  scene.fillPathMetaB = Float32Array.of(10, 10, 1, 0, 30, 10, 0, 0);
  scene.fillPathMetaC = Float32Array.of(0, 0, 0, .25, 0, 0, 1, .75);
  scene.fillSegmentsA = Float32Array.of(0, 0, 10, 0, 10, 0, 10, 10, 10, 10, 0, 10, 0, 10, 0, 0, 20, 0, 30, 0, 30, 0, 30, 10, 30, 10, 20, 10, 20, 10, 20, 0);
  scene.fillSegmentsB = new Float32Array(32);
  scene.textInstanceCount = 2; scene.textGlyphCount = 1; scene.textGlyphSegmentCount = 4;
  scene.textInstanceA = Float32Array.of(1, 0, 0, 1, 1, 0, 0, 1);
  scene.textInstanceB = Float32Array.of(0, 20, 0, 0, 20, 20, 0, 0);
  scene.textInstanceC = Float32Array.of(1, 0, 0, .4, 0, 0, 1, .8);
  scene.textGlyphMetaA = Float32Array.of(0, 4, 0, 0); scene.textGlyphMetaB = Float32Array.of(10, 10, 0, 0);
  scene.textGlyphSegmentsA = scene.fillSegmentsA.slice(0, 16); scene.textGlyphSegmentsB = scene.fillSegmentsB.slice(0, 16);
  scene.pageTextRanges = Uint32Array.of(0, 2);
  const before = structuredClone(scene), selected = [edit("stroke", 0, "#00ff00"), edit("fill", 1, "yellow"), edit("text", 0, [0, 1, 1])];
  const recolored = applyEditorSourceColors(scene, selected);
  assert.deepEqual(scene, before, "recoloring cannot mutate shared original scene data");
  assert.deepEqual(getScenePrimitive(recolored, { kind: "stroke", index: 0 }).color, [0, 1, 0]);
  assert.deepEqual(getScenePrimitive(recolored, { kind: "stroke", index: 1 }).color, [0, 0, 1]);
  assert.deepEqual(getScenePrimitive(recolored, { kind: "fill", index: 1 }).color, [1, 1, 0]);
  assert.deepEqual(getScenePrimitive(recolored, { kind: "text", index: 0 }).color, [0, 1, 1]);
  assert.deepEqual(getScenePrimitive(recolored, { kind: "text", index: 1 }).color, [0, 0, 1], "shared glyph outlines do not share instance paint changes");
  for (const name of ["endpoints", "primitiveMeta", "primitiveBounds", "fillPathMetaA", "fillSegmentsA", "fillSegmentsB", "textInstanceA", "textInstanceB", "textGlyphSegmentsA", "textGlyphSegmentsB"])
    assert.equal(recolored[name], scene[name], `${name}: geometry stays shared during RGB changes`);
  assert.equal(recolored.fillPathMetaC[7], .75); assert.equal(recolored.textInstanceC[3], scene.textInstanceC[3]);
  assert.deepEqual(editorSourcePaintColors(scene, selected.map(e => e.ref), selected), { color: [[0, 1, 0], [1, 1, 0], [0, 1, 1]], fill: [[1, 1, 0]] });
  assert.equal(applyEditorSourceColors(scene, []), scene);
  assert.equal(applyEditorSourceColors(scene, [{ ...selected[0], deleted: true }]), scene);
  assert.throws(() => applyEditorSourceColors(scene, [selected[0], edit("stroke", 99, "blue")]), /outside/);
  assert.throws(() => applyEditorSourceColors(scene, [selected[0], edit("fill", 0, "invalid-color")]), /color/);
  assert.deepEqual(scene, before, "later validation failures cannot partially recolor the source");
  const raster = { ...scene, rasterLayers: [{ width: 1, height: 1, data: Uint8Array.of(1, 2, 3, 128), matrix: Float32Array.from(identity), pageIndex: 0, paintOrder: 0 }] };
  assert.deepEqual(editorSourcePaintColors(raster, [{ kind: "raster", index: 0 }]), { color: [], fill: [] });
  assert.throws(() => applyEditorSourceColors(raster, [edit("raster", 0, "green")]), /Raster image pixels/);

  // A paint and a mask may share a gradient resource, and another visible paint
  // may reuse it. Only the edited invocation gets copied RGB data.
  const gradients = structuredClone(scene); gradients.gradientCount = 3;
  gradients.gradientMetaA = Float32Array.of(0, 0, 0, 0x112233 + 1, 0, 0, 0, 0, 2, 0, 0, 0);
  gradients.gradientMetaB = Float32Array.of(1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1);
  gradients.gradientMetaC = new Float32Array(12); gradients.gradientMetaD = Float32Array.of(10, 0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0); gradients.gradientMetaE = new Float32Array(12);
  gradients.gradientLut = new Uint8Array(3 * GRADIENT_LUT_WIDTH * 4);
  for (let g = 0; g < 3; g++) for (let i = 0; i < GRADIENT_LUT_WIDTH; i++) gradients.gradientLut.set([i % 256, 50, 200, 50 + i % 206], (g * GRADIENT_LUT_WIDTH + i) * 4);
  gradients.gradientFillPathCount = 3; gradients.gradientFillSegmentCount = 12;
  gradients.gradientFillPathMetaA = Float32Array.of(0, 4, 0, 0, 4, 4, 20, 0, 8, 4, 40, 0);
  gradients.gradientFillPathMetaB = Float32Array.of(10, 10, 0, 0, 30, 10, 0, 0, 50, 10, 0, 0);
  gradients.gradientFillPathMetaC = Float32Array.of(0, 0, 0, .3, 0, 0, 0, .5, 0, 0, 0, .7);
  gradients.gradientFillPaintMeta = Float32Array.of(0, 0, 0, 0, 0, 1, 1, 0, 2, 1, 2, 0);
  gradients.gradientFillSegmentsA = new Float32Array(48); gradients.gradientFillSegmentsB = new Float32Array(48);
  gradients.gradientStrokeRunCount = 1; gradients.gradientStrokeSegmentCount = 2;
  gradients.gradientStrokeRunMetaA = Float32Array.of(0, 2, 0, 1); gradients.gradientStrokeRunMetaB = Float32Array.of(0, 0, 0, 0);
  gradients.gradientStrokeEndpoints = scene.endpoints.slice(); gradients.gradientStrokePrimitiveMeta = scene.primitiveMeta.slice(); gradients.gradientStrokePrimitiveBounds = scene.primitiveBounds.slice(); gradients.gradientStrokeStyles = scene.styles.slice();
  gradients.gradientMeshRanges = Uint32Array.of(0, 0, 0, 0, 0, 3);
  gradients.gradientMeshPositions = Float32Array.of(0, 0, 10, 0, 0, 10);
  gradients.gradientMeshColors = Float32Array.of(1, 0, 0, .2, 0, 1, 0, .5, 0, 0, 1, .9);
  gradients.gradientMeshIndices = Uint32Array.of(0, 1, 2);
  assert.deepEqual(editorSourcePaintColors(gradients, [{ kind: "gradient-fill", index: 2 }]).fill, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], "mesh readback ignores its unused LUT row");
  const originalGradients = structuredClone(gradients);
  const changed = applyEditorSourceColors(gradients, [edit("gradient-fill", 0, "#aabbcc"), edit("gradient-fill", 2, "#00ff00"), edit("gradient-stroke", 0, "#aabbcc")]);
  const axial = changed.gradientFillPaintMeta[0], mesh = changed.gradientFillPaintMeta[8];
  assert.equal(changed.gradientCount, 5, "same resource and RGB reuse one new gradient");
  assert.equal(changed.gradientStrokeRunMetaA[2], axial); assert.equal(changed.gradientFillPaintMeta[4], 0, "unselected invocation keeps the original shading");
  assert.equal(changed.gradientFillPaintMeta[1], 0); assert.equal(changed.gradientStrokeRunMetaA[3], 1, "mask references are not rebound");
  for (let segment = 0; segment < 2; segment++) {
    assert.equal(changed.gradientStrokeStyles[segment * 4], gradients.gradientStrokeStyles[segment * 4]);
    assert.deepEqual([...changed.gradientStrokeStyles.slice(segment * 4 + 1, segment * 4 + 4)].map(v => Math.round(v * 255)), [170, 187, 204]);
  }
  assert.equal(changed.gradientStrokePrimitiveMeta, gradients.gradientStrokePrimitiveMeta, "stroke alpha and flags stay unchanged");
  assert.equal(changed.gradientMetaA[axial * 4 + 3], 0xaabbcc + 1, "shading background is recolored with its paint");
  for (let channel = 0; channel < 3; channel++) assert(Math.abs(sampleSceneGradientChannel(changed, axial, 5, 0, channel) - [170, 187, 204][channel] / 255) < 1e-6);
  assert.equal(sampleSceneGradientChannel(changed, axial, 5, 0, 3), sampleSceneGradientChannel(gradients, 0, 5, 0, 3), "gradient alpha profile is preserved");
  const triangle = getGradientMeshTriangle(changed, mesh, 0), originalTriangle = getGradientMeshTriangle(gradients, 2, 0);
  assert.deepEqual(triangle.points, originalTriangle.points);
  assert.deepEqual(triangle.colors.map(c => c.slice(0, 3)), [[0, 1, 0], [0, 1, 0], [0, 1, 0]]);
  assert.deepEqual(triangle.colors.map(c => c[3]), originalTriangle.colors.map(c => c[3]));
  assert.deepEqual(gradients, originalGradients);
  assert.equal(changed.gradientFillSegmentsA, gradients.gradientFillSegmentsA); assert.equal(changed.gradientStrokeEndpoints, gradients.gradientStrokeEndpoints);
  assert.deepEqual(editorSourcePaintColors(changed, [{ kind: "gradient-fill", index: 2 }]).fill, [[0, 1, 0]], "mesh readback contains the current paint color");

  const masked = structuredClone(scene); masked.drawRuns = [{ kind: "stroke", first: 0, count: 1 }, { kind: "stroke", first: 1, count: 1 }];
  masked.paintGraph = { roots: [{ kind: "group", alpha: 1, isolated: true, knockout: false, blendMode: "Normal", children: [{ kind: "draw", runIndex: 0 }],
    softMask: { subtype: "Luminosity", children: [{ kind: "draw", runIndex: 1 }] } }] };
  assert.deepEqual(editorSourcePaintColors(masked, [{ kind: "stroke", index: 1 }]), { color: [], fill: [] });
  assert.throws(() => applyEditorSourceColors(masked, [edit("stroke", 1, "green")]), /Mask-only/);
  const painted = applyEditorSourceColors(masked, [edit("stroke", 0, "green")]);
  assert.deepEqual(painted.styles.slice(4), masked.styles.slice(4), "luminosity mask RGB is preserved");
  console.log("Source colors: per-instance strokes/fills/glyphs, shared gradients/meshes, alpha/masks, immutable geometry and validation passed.");
} finally { hooks.deregister(); }
