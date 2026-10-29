import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";
import { createCanvas } from "@napi-rs/canvas";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const previousDocument = globalThis.document;
globalThis.document = { createElement: () => Object.assign(createCanvas(1, 1), { style: {} }) };
try {
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { prepareEditorTranslationPreview } = await import("../src/editorTranslationPreview.ts");
  const { getEditorSceneTranslationHint, setEditorSceneTranslationHint } = await import("../src/editorScenePreview.ts");
  const { prepareEditorPreviewSceneUpdate } = await import("../src/editorPreviewSceneUpdate.ts");
  const { ThreeMaterialStrokeLayer } = await import("../src/threeMaterialStrokeLayer.ts");
  const { ThreeMaterialFillLayer } = await import("../src/threeMaterialFillLayer.ts");
  const { ThreeMaterialTextLayer } = await import("../src/threeMaterialTextLayer.ts");
  const { ThreeVectorDrawPlan } = await import("../src/threeVectorDrawPlan.ts");
  const { HeprThreePdfObject } = await import("../src/threePdfObject.ts");
  const { deferRendererSceneUpload } = await import("../src/deferredRendererApi.ts");
  const webGpu = await import("../src/threeWebGpuBackend.ts");
  const f = values => Float32Array.from(values);
  const rectangle = () => ({ parent: -1, fillRule: 0, edges: f([0, 0, 100, 0, 100, 0, 100, 100, 100, 100, 0, 100, 0, 100, 0, 0]) });
  function fixture() {
    const scene = buildStrokeScene([
      { points: [[10, 10], [60, 10]], width: 2, color: "black" },
      { points: [[75, 75], [90, 75]], width: 2, color: "red" },
      { points: [[75, 75], [90, 75]], width: 2, color: "red" }
    ]);
    const points = Array.from({ length: 64 }, (_, index) => {
      const angle = index / 64 * Math.PI * 2; return [30 + 10 * Math.cos(angle), 30 + 10 * Math.sin(angle)];
    });
    const paths = [points, points.map(([x, y]) => [x + 35, y + 35])];
    Object.assign(scene, { pageCount: 1, pageRects: f([0, 0, 100, 100]), pageTextRanges: Uint32Array.of(0, 2),
      pageBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      fillPathCount: 2, fillSegmentCount: 128, fillPathMetaA: f([0, 64, 20, 20, 64, 64, 55, 55]),
      fillPathMetaB: f([40, 40, 0, 0, 75, 75, 0, 0]), fillPathMetaC: f([0, 0, 1, 1, 0, 0, 1, 1]),
      fillSegmentsA: f(paths.flatMap(path => path.flatMap(point => [...point, 0, 0]))),
      fillSegmentsB: f(paths.flatMap(path => path.flatMap((_, index) => [...path[(index + 1) % path.length], 0, 0]))),
      textGlyphCount: 1, textGlyphSegmentCount: 3, textGlyphMetaA: f([0, 3, 0, 0]), textGlyphMetaB: f([10, 10, 0, 0]),
      textGlyphSegmentsA: f([0, 0, 0, 0, 10, 0, 0, 0, 5, 10, 0, 0]), textGlyphSegmentsB: f([10, 0, 0, 0, 5, 10, 0, 0, 0, 0, 0, 0]),
      textInstanceCount: 2, textInstanceA: f([1, 0, 0, 1, 1, 0, 0, 1]), textInstanceB: f([15, 45, 0, 0, 65, 85, 0, 1]),
      textInstanceC: f([0, 0, 0, 1, 0, 0, 0, 1]), textClipRects: f([0, 0, 100, 100]),
      clipPaths: [rectangle(), rectangle()], drawRuns: [
        { kind: "stroke", first: 0, count: 1, clipIndex: 0 }, { kind: "fill", first: 0, count: 1, clipIndex: 0 },
        { kind: "text", first: 0, count: 1, clipIndex: 0 }, { kind: "stroke", first: 1, count: 1, clipIndex: 1 },
        { kind: "fill", first: 1, count: 1, clipIndex: 1 }, { kind: "text", first: 1, count: 1, clipIndex: 1 },
        { kind: "stroke", first: 2, count: 1, clipIndex: 1 }
      ] });
    return scene;
  }
  const refs = ["stroke", "fill", "text"].map(kind => ({ kind, index: 0 }));
  const source = fixture(), pristine = structuredClone(source), prepared = prepareEditorTranslationPreview(source, refs, []);
  assert(prepared);
  const first = prepared.translate(0, 0), poses = [prepared.translate(350, -210), prepared.translate(-120, 80), prepared.translate(0, 0)];
  const texel = (texture, index) => Array.from(texture.image.data.subarray(index * 4, index * 4 + 4));
  const ids = (layer, attribute) => layer.mesh.children.filter(mesh => mesh.visible).flatMap(mesh =>
    Array.from({ length: mesh.geometry.instanceCount }, (_, index) => mesh.geometry.getAttribute(attribute).getX(index)));
  const strokeTexel = (layer, key, index) => index < layer.segmentSplit ? texel(layer[key], index)
    : texel(layer[key.replace("segment", "segmentTail")], index - layer.segmentSplit);

  function layers(scene, backend) {
    const plan = new ThreeVectorDrawPlan(scene), common = { drawPlan: plan, materialBackend: backend, webGpu, vectorOverride: [0, 0, 0, 0] };
    const stroke = new ThreeMaterialStrokeLayer(scene, { ...common, strokeCurveEnabled: true });
    const fill = new ThreeMaterialFillLayer(scene, common), text = new ThreeMaterialTextLayer(scene, { ...common, strokeCurveEnabled: true, textVectorOnly: false });
    const object = new THREE.Group(); Object.setPrototypeOf(object, HeprThreePdfObject.prototype);
    const native = { accepted: true, calls: [], updateEditorPreviewScene(next) { this.calls.push(next); return this.accepted; } };
    Object.assign(object, { currentScene: scene, editorClipSource: null, isDisposed: false, pageViews: null, pageTransforms: null,
      deferredMaterials: null, pendingLayerUpdate: null, shaderPreparations: 0,
      primitiveAppearance: { hasAnyOverrides: () => false, getHighlights: () => null },
      searchHighlightGroup: null, textSelectionHighlightGroup: null, vectorLodStrokeLayer: null, compactedStrokeLayer: null,
      triangleStrokeLayer: null, textLodLayer: null, drawPlan: plan, appliedDrawPlanVersion: -1,
      renderer: native, strokeMaterialLayer: stroke, fillMaterialLayer: fill, textMaterialLayer: text,
      rasterMaterialLayer: { group: new THREE.Group() }, gradientMaterialLayer: { getOrderedPaintMeshes: () => [] },
      previewPagePartition: {}, primitivePicker: { dispose() {} }, annotationIndex: { dispose() {} }, textSearcher: {} });
    return { object, native, plan, stroke, fill, text, dispose() { stroke.dispose(); fill.dispose(); text.dispose(); } };
  }
  const textures = entry => [
    ...["segmentTextureA", "segmentTextureB", "segmentBoundsTexture", "segmentStyleTexture", "segmentTailTextureA", "segmentTailTextureB", "segmentTailBoundsTexture", "segmentTailStyleTexture"].map(key => entry.stroke[key]),
    ...["fillPathMetaTextureA", "fillPathMetaTextureB", "fillPathMetaTextureC", "fillSegmentTextureA", "fillSegmentTextureB"].map(key => entry.fill[key]),
    ...["textInstanceTextureA", "textInstanceTextureB", "textInstanceTextureC", "textGlyphMetaTextureA", "textGlyphMetaTextureB", "textGlyphSegmentTextureA", "textGlyphSegmentTextureB", "textRasterAtlasTexture"].map(key => entry.text[key]),
    entry.stroke.vectorClipTexture
  ];

  for (const backend of ["webgl", "webgpu"]) {
    const entry = layers(first, backend), resources = textures(entry), originals = resources.map(texture => texture.image.data.slice());
    const materials = [entry.stroke.mesh.material, entry.fill.mesh.material, entry.text.mesh.material];
    assert(materials.every(material => backend === "webgl" ? material.isRawShaderMaterial : material.isNodeMaterial));
    const clip = entry.stroke.vectorClipTexture;
    assert.equal(clip, entry.fill.vectorClipTexture); assert.equal(clip, entry.text.vectorClipTexture);
    const movedClip = getEditorSceneTranslationHint(first).changedClips[0], originalPayload = texel(clip, 0)[1], movedPayload = texel(clip, movedClip)[1];
    assert.equal(texel(clip, 1)[1], originalPayload, "unmoved identical rectangle payloads may be shared");
    assert.notEqual(movedPayload, originalPayload, "a moving rectangle has private AA payload storage");
    const bandBase = entry.fill.mixedOptions.fillBandBase, cellBase = entry.fill.mixedOptions.fillCellBase;
    assert(bandBase >= 0 && cellBase >= 0, "the fixture exercises packed fill index headers");
    const untouchedHeaders = [texel(entry.fill.fillSegmentTextureA, bandBase + 1), texel(entry.fill.fillSegmentTextureA, cellBase + 1)];
    const initialStorage = resources.map(texture => texture.image.data), initialVersions = resources.map(texture => texture.version), initialPlanVersion = entry.plan.version;
    const unchangedInitial = () => {
      assert.equal(entry.object.sceneData, first); assert.equal(entry.object.editorClipSource, null); assert.equal(entry.plan.version, initialPlanVersion);
      resources.forEach((texture, index) => {
        assert.equal(texture.image.data, initialStorage[index]); assert.equal(texture.version, initialVersions[index]);
        assert.deepEqual(texture.image.data, originals[index]);
      });
    };
    entry.object.pageViews = []; assert.equal(entry.object.updateEditorPreviewScene(poses[0]), false); entry.object.pageViews = null; unchangedInitial();
    entry.fill.fillData.parts.set(0, []); assert.equal(entry.object.updateEditorPreviewScene(poses[0]), false); entry.fill.fillData.parts.delete(0); unchangedInitial();
    assert.equal(entry.object.updateEditorPreviewScene({ ...poses[0] }), false, "an unproven scene cannot enter the fast path"); unchangedInitial();
    assert.equal(entry.native.calls.length, 0, "unsupported initial scenes never reach the native backend");
    entry.native.accepted = false; assert.equal(entry.object.updateEditorPreviewScene(poses[0]), false); unchangedInitial(); entry.native.accepted = true;
    let warmedStorage, warmedBatches;
    try {
      for (const [poseIndex, pose] of poses.entries()) {
        const before = entry.object.sceneData, update = prepareEditorPreviewSceneUpdate(before, pose); assert(update);
        const dx = pose.endpoints[0] - first.endpoints[0], dy = pose.endpoints[1] - first.endpoints[1];
        assert.equal(entry.object.updateEditorPreviewScene(pose), true, `${backend}: compatible pose updates actual layers in place`);
        assert.equal(entry.object.sceneData, pose); assert.equal(entry.native.calls.at(-1), pose);
        assert.equal(entry.object.primitivePicker, null); assert.equal(entry.object.annotationIndex, null); assert.equal(entry.object.textSearcher, null);
        textures(entry).forEach((texture, index) => assert.equal(texture, resources[index], "texture objects and their material bindings remain stable"));
        [entry.stroke.mesh.material, entry.fill.mesh.material, entry.text.mesh.material].forEach((material, index) => assert.equal(material, materials[index]));
        if (warmedStorage) textures(entry).forEach((texture, index) => assert.equal(texture.image.data, warmedStorage[index], "later poses reuse writable backing arrays"));
        else warmedStorage = resources.map(texture => texture.image.data);
        assert.deepEqual(strokeTexel(entry.stroke, "segmentTextureA", 0), Array.from(pose.endpoints.subarray(0, 4)));
        assert.deepEqual(strokeTexel(entry.stroke, "segmentTextureB", 0), Array.from(pose.primitiveMeta.subarray(0, 4)));
        assert.deepEqual(strokeTexel(entry.stroke, "segmentBoundsTexture", 0), Array.from(pose.primitiveBounds.subarray(0, 4)));
        for (const id of [0, 31, 63]) {
          assert.deepEqual(texel(entry.fill.fillSegmentTextureA, id), Array.from(pose.fillSegmentsA.subarray(id * 4, id * 4 + 4)));
          assert.deepEqual(texel(entry.fill.fillSegmentTextureB, id), Array.from(pose.fillSegmentsB.subarray(id * 4, id * 4 + 4)));
        }
        assert.deepEqual(texel(entry.fill.fillPathMetaTextureA, 0).slice(2), Array.from(pose.fillPathMetaA.subarray(2, 4)));
        assert.deepEqual(texel(entry.fill.fillPathMetaTextureB, 0).slice(0, 2), Array.from(pose.fillPathMetaB.subarray(0, 2)));
        assert.deepEqual(texel(entry.text.textInstanceTextureB, 0), [pose.textInstanceB[0], pose.textInstanceB[1], 0, 0]);
        assert.deepEqual(texel(entry.text.textInstanceTextureB, 1), Array.from(first.textInstanceB.subarray(4, 8)).map((value, index) => index === 3 ? value + first.textGlyphCount : value));
        assert.deepEqual(texel(entry.text.textGlyphMetaTextureA, pose.textGlyphCount), Array.from(first.textClipRects), "untouched packed hard text clip stays unchanged");
        assert.deepEqual(texel(clip, movedPayload), [dx, dy, 100 + dx, 100 + dy], "the private AA rectangle follows exact translated page coordinates");
        assert.deepEqual(texel(clip, originalPayload), Array.from(originals.at(-1).subarray(originalPayload * 4, originalPayload * 4 + 4)), "untouched AA clip remains unchanged");
        assert.equal(texel(entry.fill.fillSegmentTextureA, bandBase)[1], 0); assert.equal(texel(entry.fill.fillSegmentTextureA, cellBase)[1], 0);
        assert.deepEqual([texel(entry.fill.fillSegmentTextureA, bandBase + 1), texel(entry.fill.fillSegmentTextureA, cellBase + 1)], untouchedHeaders);
        const ranges = entry.fill.fillSegmentTextureA.updateRanges;
        for (const offset of [0, 63 * 4, bandBase * 4, cellBase * 4]) assert(ranges.some(range => range.start <= offset && range.start + range.count > offset), "geometry and both header patches retain their upload ranges");
        assert.deepEqual(entry.plan.order, first.drawRuns.map((_, index) => index), "moving paints disable all source-geometry commutation");
        assert.equal(entry.plan.colorBatchingEnabled, false); assert.equal(entry.plan.blackDarkenSourceOverEnabled, false);
        assert.equal(entry.stroke.orderedRuns.strokeRedundancyEnabled, false);
        const view = { cameraCenterX: 30 + dx, cameraCenterY: 30 + dy, zoom: 10 }, viewport = { width: 100, height: 100 };
        entry.stroke.updateFrame(view, viewport); entry.fill.updateFrame(view, viewport); entry.text.updateFrame(view, viewport);
        const batches = [entry.stroke, entry.fill, entry.text].flatMap(layer => layer.mesh.children.flatMap(mesh => [mesh.geometry, mesh.material]));
        if (warmedBatches) { assert.equal(batches.length, warmedBatches.length); batches.forEach((value, index) => assert.equal(value, warmedBatches[index], "later poses retain actual draw geometries and materials")); }
        else warmedBatches = batches;
        assert(ids(entry.stroke, "aSegmentIndex").includes(0), "the moved stroke remains selectable outside its old spatial grid");
        assert(ids(entry.fill, "aFillPathIndex").includes(0), "the moved fill remains visible outside its original fill bounds");
        assert(ids(entry.text, "aTextInstanceIndex").includes(0), "the moved glyph survives old page-range culling");
        assert.deepEqual(first, prepared.translate(0, 0), "texture patches never write into canonical first-pose arrays");
        if (poseIndex === poses.length - 1) assert.deepEqual(strokeTexel(entry.stroke, "segmentTextureA", 0), Array.from(source.endpoints.subarray(0, 4)), "zero delta restores exact source coordinates");
      }
      const snapshot = resources.map(texture => ({ data: texture.image.data.slice(), version: texture.version })), nativeCalls = entry.native.calls.length;
      const reject = (change, restore, label) => {
        change(); assert.equal(entry.object.updateEditorPreviewScene(poses[0]), false, label); restore();
        assert.equal(entry.native.calls.length, nativeCalls, "unsupported material states reject before touching the native backend");
        resources.forEach((texture, index) => { assert.equal(texture.version, snapshot[index].version); assert.deepEqual(texture.image.data, snapshot[index].data); });
      };
      reject(() => { entry.object.pageViews = []; }, () => { entry.object.pageViews = null; }, "page-view objects fall back atomically");
      reject(() => entry.fill.fillData.parts.set(0, []), () => entry.fill.fillData.parts.delete(0), "split fill contours fall back atomically");
      reject(() => { entry.object.shaderPreparations = 1; }, () => { entry.object.shaderPreparations = 0; }, "shader preparation rejects atomically");
      entry.native.accepted = false; assert.equal(entry.object.updateEditorPreviewScene(poses[0]), false);
      assert.equal(entry.object.sceneData, poses.at(-1));
      resources.forEach((texture, index) => { assert.equal(texture.version, snapshot[index].version); assert.deepEqual(texture.image.data, snapshot[index].data); });
    } finally { entry.dispose(); }

    // Engine preparation intentionally declines legacy hard text clips because
    // committed transforms use AA clips. Exercise renderer packing separately.
    const hardSource = fixture();
    hardSource.textInstanceB[3] = 2;
    hardSource.textClipRects = f([0, 0, 100, 100, 0, 0, 100, 100]);
    assert.equal(prepareEditorTranslationPreview(hardSource, [{ kind: "text", index: 0 }], []), null);
    const hardPose = { ...hardSource, textInstanceB: hardSource.textInstanceB.slice(), textClipRects: hardSource.textClipRects.slice() };
    hardPose.textInstanceB[0] += 40; hardPose.textInstanceB[1] -= 20;
    hardPose.textClipRects.set([40, -20, 140, 80], 4);
    setEditorSceneTranslationHint(hardPose, { source: hardSource, changed: [{ kind: "text", index: 0 }], dx: 40, dy: -20 });
    const hardEntry = layers(hardSource, backend);
    try {
      const oldClip = texel(hardEntry.text.textGlyphMetaTextureA, hardSource.textGlyphCount);
      assert.equal(hardEntry.object.updateEditorPreviewScene(hardPose), true);
      assert.deepEqual(texel(hardEntry.text.textInstanceTextureB, 0), [55, 25, 0, hardSource.textGlyphCount + 2]);
      assert.deepEqual(texel(hardEntry.text.textInstanceTextureB, 1), [65, 85, 0, hardSource.textGlyphCount + 1]);
      assert.deepEqual(texel(hardEntry.text.textGlyphMetaTextureA, hardSource.textGlyphCount), oldClip);
      assert.deepEqual(texel(hardEntry.text.textGlyphMetaTextureA, hardSource.textGlyphCount + 1), [40, -20, 140, 80]);
      assert.deepEqual(hardSource.textClipRects, f([0, 0, 100, 100, 0, 0, 100, 100]));
    } finally { hardEntry.dispose(); }
  }
  assert.deepEqual(source, pristine, "both backend layers leave canonical source stores immutable");

  // A dormant native fallback adopts new poses without creating/uploading a
  // duplicate scene; its first actual use uploads the most recent pose.
  const calls = [], native = { setScene(scene) { calls.push(["upload", scene]); return {}; },
    renderExternalFrame() { calls.push(["draw"]); }, updateEditorPreviewScene() { calls.push(["preview"]); return false; }, dispose() {} };
  const deferred = deferRendererSceneUpload(native, first);
  assert.equal(deferred.updateEditorPreviewScene(poses[0]), true); assert.equal(deferred.updateEditorPreviewScene(poses[1]), true);
  assert.deepEqual(calls, []); assert.equal(deferred.hasUploadedScene(), false);
  deferred.renderExternalFrame(0); assert.deepEqual(calls, [["upload", poses[1]], ["draw"]]);
  assert.equal(deferred.updateEditorPreviewScene(poses[2]), false); deferred.invalidateUploadedScene(); deferred.ensureSceneUploaded();
  assert.equal(calls.at(-1)[1], poses[1], "a rejected native patch cannot replace the deferred fallback's current scene");
  deferred.dispose();
  console.log("Three editor previews: real WebGL/WebGPU layers, immutable textures, clip AA, packed fill uploads, culling, paint order, restoration, atomic fallback and deferred native upload passed.");
} finally { globalThis.document = previousDocument; hooks.deregister(); }
