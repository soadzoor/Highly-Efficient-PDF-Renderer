import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { WebGlPdfRenderer } = await import("../src/webGlPdfRenderer.ts");
  const { WebGpuPdfRenderer } = await import("../src/webGpuPdfRenderer.ts");
  const { compileEditorObjectGeometry } = await import("../src/editorSceneObjects.ts");
  const { prepareEditorTranslationPreview } = await import("../src/editorTranslationPreview.ts");
  const { getEditorSceneTranslationHint, setEditorSceneTranslationHint } = await import("../src/editorScenePreview.ts");
  const { prepareEditorPreviewSceneUpdate, editorPreviewFillCoverage, editorPreviewFillDrawData, editorPreviewRectangleClipTexels,
    coalesceEditorPreviewTexels } = await import("../src/editorPreviewSceneUpdate.ts");
  const { packVectorClips, vectorClipChainBounds } = await import("../src/vectorClips.ts");
  const { vectorFillCoverageMetadata } = await import("../src/vectorFillCoverage.ts");
  const { VectorDrawRunCuller } = await import("../src/vectorDrawRunCulling.ts");
  const { sceneRequiresPaintCompositing } = await import("../src/scenePaintVisibility.ts");
  const { validateScenePaintGraph } = await import("../src/scenePaintGraph.ts");
  const rectangle = (a, b, c, d) => Float32Array.of(a, b, c, b, c, b, c, d, c, d, a, d, a, d, a, b);
  const source = await compileEditorObjectGeometry({ id: "shape", kind: "shape", shape: "rectangle", pageIndex: 0,
    x: 10, y: 20, width: 30, height: 25, fill: "red", color: "blue", strokeWidth: 2, transform: [1, 0, 0, 1, 0, 0] });
  Object.assign(source, { pageCount: 1, pageRects: Float32Array.of(0, 0, 200, 200), pageTextRanges: Uint32Array.of(0, 2),
    textInstanceCount: 2, textGlyphCount: 1, textGlyphSegmentCount: 3,
    textInstanceA: Float32Array.of(1, 0, 0, 1, 1, 0, 0, 1), textInstanceB: Float32Array.of(20, 30, 0, 0, 65, 30, 0, 1),
    textInstanceC: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1), textGlyphMetaA: Float32Array.of(0, 3, 0, 0),
    textGlyphMetaB: Float32Array.of(8, 12, 0, 0), textGlyphSegmentsA: Float32Array.of(0, 0, 0, 0, 8, 0, 0, 0, 0, 12, 0, 0),
    textGlyphSegmentsB: Float32Array.of(8, 0, 0, 0, 0, 12, 0, 0, 0, 0, 0, 0), textClipRects: Float32Array.of(0, 0, 100, 100),
    clipPaths: [{ parent: -1, fillRule: 0, edges: rectangle(0, 0, 100, 100) },
      { parent: 0, fillRule: 0, edges: rectangle(5, 10, 80, 90) }, { parent: 0, fillRule: 0, edges: rectangle(5, 10, 80, 90) },
      { parent: -1, fillRule: 0, edges: rectangle(10, 15, 70, 75) }] });
  source.drawRuns = [...source.drawRuns.map(run => ({ ...run, clipIndex: 3 })),
    { kind: "text", first: 0, count: 1, clipIndex: 3 }, { kind: "text", first: 1, count: 1, clipIndex: 1 }];
  // Unchanged images/gradients must not disable an ordinary vector selection.
  source.rasterLayers = [{ matrix: Float32Array.of(5, 0, 0, 5, 120, 120), width: 1, height: 1, data: Uint8Array.of(255, 0, 0, 255) }];
  source.rasterLayers.push({ ...source.rasterLayers[0] });
  source.drawRuns.push({ kind: "raster", first: 0, count: 1 }, { kind: "raster", first: 1, count: 1 });
  const last = source.drawRuns.length - 1;
  source.paintGraph = { roots: [...source.drawRuns.slice(0, -2).map((_, runIndex) => ({ kind: "draw", runIndex })),
    { kind: "group", alpha: .5, isolated: true, knockout: false, blendMode: "Normal", children: [{ kind: "draw", runIndex: last - 1 }],
      softMask: { subtype: "Alpha", children: [{ kind: "draw", runIndex: last }] } }] };
  validateScenePaintGraph(source); assert(sceneRequiresPaintCompositing(source));
  source.gradientCount = 1; source.gradientMetaA = Float32Array.of(1, 2, 3, 4);
  const pristine = structuredClone(source), refs = [
    ...Array.from({ length: source.segmentCount }, (_, index) => ({ kind: "stroke", index })),
    { kind: "fill", index: 0 }, { kind: "text", index: 0 }
  ];
  const prepared = prepareEditorTranslationPreview(source, refs, []); assert(prepared);
  const selectedEffect = { ...source, paintGraph: { roots: [{ kind: "group", alpha: .5, isolated: false, knockout: false, blendMode: "Normal",
    children: source.drawRuns.map((_, runIndex) => ({ kind: "draw", runIndex })) }] } };
  assert.equal(prepareEditorTranslationPreview(selectedEffect, refs, []), null, "a selected effect group remains on the full-fidelity path");
  const first = prepared.translate(3, 4), second = prepared.translate(75, -20), third = prepared.translate(0, 0);
  const hint = getEditorSceneTranslationHint(first), exclusive = new Set(hint.changedClips);
  assert(exclusive.size > 0);
  for (const index of [0, 1, 2]) assert.deepEqual(second.clipPaths[index], source.clipPaths[index], "shared ancestor clips stay fixed while the owned inset clip moves");
  const packed = packVectorClips(first.clipPaths, undefined, { cells: true, exclusive });
  const headers = packed.slice(0, first.clipPaths.length * 4), plan = prepareEditorPreviewSceneUpdate(first, second); assert(plan);
  assert.deepEqual(editorPreviewFillCoverage(second, plan), vectorFillCoverageMetadata(second), "moved-only coverage equals a complete canonical recomputation");
  const clipPatch = editorPreviewRectangleClipTexels(second, plan, headers); assert(clipPatch);
  const patchedClips = packed.slice(); clipPatch.patches.forEach(patch => patchedClips.set(patch.pixels, patch.index * 4));
  assert.deepEqual(patchedClips, packVectorClips(second.clipPaths, undefined, { cells: true, exclusive }), "private clip payloads preserve exact rectangle fusion and AA headers");
  assert.deepEqual(clipPatch.bounds, vectorClipChainBounds(second.clipPaths));
  const baseCoverage = vectorFillCoverageMetadata(first), extra = {
    ...Object.fromEntries(Object.entries(baseCoverage).map(([key, values]) => [key, Float32Array.from([...values, 10, 20, 30, 40])])),
    pathCount: first.fillPathCount + 1, canonicalCount: first.fillPathCount, parts: new Map([[99, [{ first: first.fillPathCount, count: 1 }]]]), origins: Uint32Array.of(99)
  }, extraBefore = structuredClone(extra), retained = editorPreviewFillDrawData(second, plan, editorPreviewFillCoverage(second, plan), extra);
  for (const key of ["pathMetaA", "pathMetaB", "pathMetaC"]) {
    assert.deepEqual(retained[key].subarray(first.fillPathCount * 4), extra[key].subarray(first.fillPathCount * 4), "unselected sparse metadata survives canonical fill updates");
    assert.deepEqual(retained[key].subarray(0, first.fillPathCount * 4), vectorFillCoverageMetadata(second)[key]);
  }
  assert.deepEqual(extra, extraBefore, "updating derived stores never mutates a previous upload"); assert.equal(retained.parts, extra.parts); assert.equal(retained.pathCount, extra.pathCount);
  const shared = packVectorClips(first.clipPaths);
  assert.equal(shared[1 * 4 + 1], shared[2 * 4 + 1], "default View packing still deduplicates equal clips");
  const copied = packVectorClips(first.clipPaths, undefined, { exclusive: new Set([1]) });
  assert.notEqual(copied[1 * 4 + 1], copied[2 * 4 + 1], "private nodes cannot alias or seed the shared payload cache");
  const rows = coalesceEditorPreviewTexels([0, 1, 2, 3, 4, 4].map((index, n) => ({ kind: "textB", index, pixels: Float32Array.of(n, 0, 0, 0) })), { textB: 3 });
  assert.deepEqual(rows.map(row => [row.index, row.count]), [[0, 3], [3, 2]]); assert.equal(rows[1].pixels[4], 5, "coalescing keeps the latest texel and never crosses rows");

  for (const [backend, Renderer] of [["WebGL", WebGlPdfRenderer], ["WebGPU", WebGpuPdfRenderer]]) {
    const { renderer, textures, calls } = mockRenderer(Renderer, backend, first, packed, baseCoverage);
    for (const scene of [second, third]) {
      assert.equal(renderer.updateEditorPreviewScene(scene), true, `${backend} reuses the uploaded prepared generation`);
      const coverage = vectorFillCoverageMetadata(scene);
      for (const [texture, values] of [["strokeA", scene.endpoints], ["strokeB", scene.primitiveMeta], ["strokeBounds", scene.primitiveBounds],
        ["fillA", coverage.pathMetaA], ["fillB", coverage.pathMetaB], ["fillC", coverage.pathMetaC], ["fillSegmentsA", scene.fillSegmentsA], ["fillSegmentsB", scene.fillSegmentsB]]) {
        assert.deepEqual(textures[texture].data.subarray(0, values.length), values, `${backend} ${texture} matches a fresh full upload`);
      }
      const text = scene.textInstanceB.slice(); for (let i = 3; i < text.length; i += 4) if (text[i] > 0) text[i] += scene.textGlyphCount;
      assert.deepEqual(textures.textB.data.subarray(0, text.length), text, `${backend} text instances preserve static glyphs and current clip offsets`);
      assert.deepEqual(textures.glyphA.data.subarray(scene.textGlyphCount * 4, (scene.textGlyphCount * 4) + scene.textClipRects.length), scene.textClipRects);
      assert.deepEqual(textures.clips.data.subarray(0, packed.length), packVectorClips(scene.clipPaths, undefined, { cells: true, exclusive }));
      assert.deepEqual(renderer.vectorClipBounds, vectorClipChainBounds(scene.clipPaths));
      for (const index of [renderer.fillBandBase, renderer.fillCellBase]) assert.deepEqual(textures.fillSegmentsA.data.subarray(index * 4, index * 4 + 4), new Float32Array(4), "moved fills use exact linear coverage instead of stale spatial indices");
      assert.equal(renderer.scene, scene); assert.equal(renderer.orderedBatches, null); assert.equal(renderer.mixedVectorBatches, null);
      assert(renderer.orderedRunCuller instanceof VectorDrawRunCuller); assert.equal(renderer.needsVisibleSetUpdate, true);
      const fresh = new VectorDrawRunCuller(scene);
      for (const view of [{ minX: 0, minY: 0, maxX: 50, maxY: 50 }, { minX: 70, minY: -30, maxX: 130, maxY: 40 }]) {
        assert.deepEqual(renderer.orderedRunCuller.select(view, 1), fresh.select(view, 1), "culling follows moved geometry at both old and new positions");
      }
    }
    assert.equal(calls.identityUploads, 1, `${backend} allocates the canonical stroke identity buffer only on the first fast frame`);
    assert.equal(calls.frames, 2); assert(calls.textureWrites > 0);
    const writes = calls.textureWrites;
    for (const key of ["primitiveColors", "vectorLodRuntime", "textLodGpuActive"]) {
      renderer[key] = {}; assert.equal(renderer.updateEditorPreviewScene(second), false, `${backend} rejects active ${key}`); renderer[key] = null;
    }
    renderer.fillDrawData.parts.set(0, [1]); assert.equal(renderer.updateEditorPreviewScene(second), false); renderer.fillDrawData.parts.clear();
    assert.equal(renderer.updateEditorPreviewScene({ ...second }), false, "unhinted scenes fall back without changing GPU state");
    assert.equal(calls.textureWrites, writes);
  }
  // The renderer also accepts independently prepared hard-clip textures. The
  // editor's canonical baker intentionally keeps these legacy selections on
  // its general path, so exercise the upload contract without that preparer.
  const hardBefore = { ...first, textInstanceB: first.textInstanceB.slice(), textClipRects: Float32Array.from([...first.textClipRects, ...first.textClipRects]) };
  hardBefore.textInstanceB[3] = 2;
  const hardAfter = { ...hardBefore, textInstanceB: hardBefore.textInstanceB.slice(), textClipRects: hardBefore.textClipRects.slice() };
  hardAfter.textInstanceB[0] += 5; hardAfter.textInstanceB[1] += 6;
  for (let index = 4; index < 8; index++) hardAfter.textClipRects[index] += index % 2 ? 6 : 5;
  setEditorSceneTranslationHint(hardBefore, { source: hardBefore, changed: [{ kind: "text", index: 0 }], dx: 0, dy: 0 });
  setEditorSceneTranslationHint(hardAfter, { source: hardBefore, changed: [{ kind: "text", index: 0 }], dx: 5, dy: 6 });
  for (const [backend, Renderer] of [["WebGL", WebGlPdfRenderer], ["WebGPU", WebGpuPdfRenderer]]) {
    const { renderer, textures } = mockRenderer(Renderer, backend, hardBefore, packed, baseCoverage);
    assert.equal(renderer.updateEditorPreviewScene(hardAfter), true);
    assert.equal(textures.textB.data[3], hardAfter.textGlyphCount + 2, "packed hard-clip references retain their glyph-resource offset");
    assert.deepEqual(textures.glyphA.data.subarray(hardAfter.textGlyphCount * 4, (hardAfter.textGlyphCount * 4) + hardAfter.textClipRects.length), hardAfter.textClipRects);
    assert.deepEqual(hardAfter.textClipRects.subarray(0, 4), hardBefore.textClipRects.subarray(0, 4), "a selected private hard clip cannot move the unselected instance's clip");
  }
  for (const change of [scene => ({ ...scene, styles: scene.styles.slice() }), scene => ({ ...scene, textGlyphMetaA: scene.textGlyphMetaA.slice() }),
    scene => ({ ...scene, drawRuns: scene.drawRuns.slice() }), scene => ({ ...scene, fillSegmentCount: scene.fillSegmentCount + 1 }),
    scene => ({ ...scene, rasterLayers: scene.rasterLayers.slice() })]) {
    const altered = change(second); setEditorSceneTranslationHint(altered, getEditorSceneTranslationHint(second));
    assert.equal(prepareEditorPreviewSceneUpdate(first, altered), null, "resource and topology changes require a normal scene upload");
  }
  const unsupported = { ...second }; setEditorSceneTranslationHint(unsupported, { ...getEditorSceneTranslationHint(second), changed: [{ kind: "gradient-fill", index: 0 }] });
  assert.equal(prepareEditorPreviewSceneUpdate(first, unsupported), null);
  const foreign = { ...second }; setEditorSceneTranslationHint(foreign, { ...getEditorSceneTranslationHint(second), source: {} });
  assert.equal(prepareEditorPreviewSceneUpdate(first, foreign), null);
  const polygon = { ...second, clipPaths: second.clipPaths.slice() }, moved = hint.changedClips[0];
  polygon.clipPaths[moved] = { ...polygon.clipPaths[moved], edges: Float32Array.of(0, 0, 20, 0, 20, 0, 0, 20, 0, 20, 0, 0) };
  setEditorSceneTranslationHint(polygon, getEditorSceneTranslationHint(second)); assert.equal(prepareEditorPreviewSceneUpdate(first, polygon), null, "nonrectangular moving clips retain the full path");
  const sharedHeaders = headers.slice(); sharedHeaders[1] = sharedHeaders[moved * 4 + 1];
  assert.equal(editorPreviewRectangleClipTexels(second, plan, sharedHeaders), null, "shared clip payloads cannot be mutated");
  assert.deepEqual(source, pristine, "preview preparation and GPU patches leave the source document untouched");
  console.log("Editor native partial uploads: WebGL/WebGPU mock texture parity, current culling/paint order, private antialiased clips, fill indices, stable resources and safe fallbacks passed.");
} finally { hooks.deregister(); }

function mockRenderer(Renderer, backend, first, packed, coverage) {
  const names = ["strokeA", "strokeB", "strokeBounds", "fillA", "fillB", "fillC", "fillSegmentsA", "fillSegmentsB", "textB", "glyphA", "clips", "clipBounds"];
  const textures = Object.fromEntries(names.map(name => [name, { name, width: 8, data: new Float32Array(4096) }]));
  const calls = { textureWrites: 0, identityUploads: 0, frames: 0 }; let bound;
  const write = (texture, x, y, pixels) => { calls.textureWrites++; texture.data.set(pixels, (y * texture.width + x) * 4); };
  const renderer = Object.assign(Object.create(Renderer.prototype), { scene: first, segmentCount: first.segmentCount,
    isDisposed: false, vectorLodRuntime: null, textLodGpuActive: false, primitiveColors: null,
    segmentTextureA: textures.strokeA, segmentTextureB: textures.strokeB, segmentTextureD: textures.strokeBounds, segmentTextureWidth: 8,
    fillPathMetaTextureA: textures.fillA, fillPathMetaTextureB: textures.fillB, fillPathMetaTextureC: textures.fillC, fillPathMetaTextureWidth: 8,
    fillSegmentTextureA: textures.fillSegmentsA, fillSegmentTextureB: textures.fillSegmentsB, fillSegmentTextureWidth: 8,
    textInstanceTextureB: textures.textB, textInstanceTextureWidth: 8, textGlyphMetaTextureA: textures.glyphA, textGlyphMetaTextureWidth: 8,
    vectorClipTexture: textures.clips, vectorClipTextureWidth: 8, vectorClipHeaders: packed.slice(0, first.clipPaths.length * 4),
    vectorClipBoundsTexture: textures.clipBounds, vectorClipBuffers: Array.from({ length: first.clipPaths.length + 2 }, () => ({})),
    fillDrawData: { ...coverage, parts: new Map() }, fillBandBase: 64, fillCellBase: 72, allSegmentIds: new Uint32Array(),
    optionalContentVisibility: null, orderedBatches: {}, mixedVectorBatches: {}, destroyVectorMinifyResources() {}, resetOrderedState() {},
    requestFrame() { calls.frames++; }, refreshStrokeBindGroups() {},
    ensureSegmentIdBuffers() { this.segmentIdBufferAll = { identity: true }; },
    gl: { TEXTURE0: 0, TEXTURE_2D: 1, RGBA: 2, FLOAT: 3, ARRAY_BUFFER: 4, STATIC_DRAW: 5, MAX_TEXTURE_SIZE: 6,
      isContextLost: () => false, activeTexture() {}, bindTexture(target, texture) { bound = texture; }, getParameter() { return 64; },
      texSubImage2D(target, level, x, y, width, height, format, type, data) { write(bound, x, y, data); }, bindBuffer() {}, bufferData() { calls.identityUploads++; } },
    gpuDevice: { queue: { writeTexture({ texture, origin }, data) { write(texture, origin[0], origin[1], data); },
      writeBuffer(buffer, offset, data) { if (buffer.identity) calls.identityUploads++; else buffer.data = data.slice(); } } }
  });
  for (const [texture, values] of [["strokeA", first.endpoints], ["strokeB", first.primitiveMeta], ["strokeBounds", first.primitiveBounds],
    ["fillA", first.fillPathMetaA], ["fillB", first.fillPathMetaB], ["fillC", first.fillPathMetaC], ["fillSegmentsA", first.fillSegmentsA],
    ["fillSegmentsB", first.fillSegmentsB], ["textB", first.textInstanceB], ["glyphA", first.textGlyphMetaA], ["clips", packed]]) textures[texture].data.set(values);
  for (let i = 3; i < first.textInstanceB.length; i += 4) if (textures.textB.data[i] > 0) textures.textB.data[i] += first.textGlyphCount;
  textures.glyphA.data.set(first.textClipRects, first.textGlyphCount * 4);
  textures.fillSegmentsA.data.fill(7, 64 * 4, 73 * 4);
  // The real GL bounds sampler chooses a square width, independent of the clip store width.
  textures.clipBounds.width = Math.ceil(Math.sqrt(first.clipPaths.length));
  return { renderer, textures, calls };
}
