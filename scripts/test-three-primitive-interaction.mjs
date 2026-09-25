import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) {
    return next(`${specifier}.ts`, context);
  }
  return next(specifier, context);
} });

try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { HeprThreePdfObject } = await import("../src/threePdfObject.ts");
  const { ThreeMaterialStrokeLayer } = await import("../src/threeMaterialStrokeLayer.ts");
  const { ThreeMaterialFillLayer } = await import("../src/threeMaterialFillLayer.ts");
  const { ThreeMaterialTextLayer } = await import("../src/threeMaterialTextLayer.ts");
  const { ThreeMaterialGradientLayer } = await import("../src/threeMaterialGradientLayer.ts");
  const { ThreePrimitiveHighlightLayer } = await import("../src/threePrimitiveHighlightLayer.ts");
  const { buildPrimitiveHighlights } = await import("../src/primitiveAppearance.ts");
  const floats = values => new Float32Array(values);
  const scene = Object.assign(createEmptyVectorScene(), {
    pageCount: 1, pagesPerRow: 1, pageRects: floats([0, 0, 10, 10]), pageTextRanges: new Uint32Array([0, 1]),
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, pageBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    segmentCount: 1, maxHalfWidth: 0.1,
    endpoints: floats([1, 5, 0, 0]), primitiveMeta: floats([9, 5, 0, 0.5]),
    primitiveBounds: floats([0, 0, 10, 10]), styles: floats([0.1, 0.2, 0.3, 0.4]),
    fillPathCount: 1, fillSegmentCount: 1,
    fillPathMetaA: floats([0, 1, 0, 0]), fillPathMetaB: floats([10, 10, 0.2, 0.3]),
    fillPathMetaC: floats([0, 0, 0.4, 0.5]), fillSegmentsA: floats([1, 5, 0, 0]),
    fillSegmentsB: floats([9, 5, 0, 0]),
    textInstanceCount: 1, textGlyphCount: 1, textGlyphSegmentCount: 1,
    textInstanceA: floats([1, 0, 0, 1]), textInstanceB: floats([0, 0, 0, 0]),
    textInstanceC: floats([0.2, 0.3, 0.4, 0.5]), textGlyphMetaA: floats([0, 1, 1, 5]),
    textGlyphMetaB: floats([9, 5, 0, 0]), textGlyphSegmentsA: floats([1, 5, 0, 0]),
    textGlyphSegmentsB: floats([9, 5, 0, 0]),
    gradientCount: 1, gradientMetaA: floats([0, 0, 0, 0]), gradientMetaB: floats([1, 0, 0, 1]),
    gradientMetaC: floats([0, 0, 0, 0]), gradientMetaD: floats([10, 0, 0, 0]),
    gradientMetaE: floats([0, 0, 0, 0]), gradientLut: new Uint8Array(4096).fill(128),
    gradientFillPathCount: 1, gradientFillSegmentCount: 1,
    gradientFillPathMetaA: floats([0, 1, 0, 0]), gradientFillPathMetaB: floats([10, 10, 0.2, 0.3]),
    gradientFillPathMetaC: floats([0, 0, 0.4, 0.5]), gradientFillPaintMeta: floats([0, 0, 1, 0]),
    gradientFillSegmentsA: floats([1, 5, 0, 0]), gradientFillSegmentsB: floats([9, 5, 0, 0])
  });
  const original = Object.fromEntries(Object.entries(scene).filter(([, v]) => ArrayBuffer.isView(v))
    .map(([key, value]) => [key, value.slice()]));

  for (const backend of ["webgl", "webgpu"]) {
    const options = { materialBackend: backend, strokeCurveEnabled: true, textVectorOnly: true,
      vectorOverride: [0.8, 0.7, 0.6, 0.25] };
    const stroke = new ThreeMaterialStrokeLayer(scene, options);
    const fill = new ThreeMaterialFillLayer(scene, options);
    const text = new ThreeMaterialTextLayer(scene, options);
    const gradient = new ThreeMaterialGradientLayer(scene, options);
    const updates = ["stroke", "fill", "text", "gradient-fill"].map(kind => ({ ref: { kind, index: 0 }, color: [1, 0, 0.75] }));
    for (const layer of [stroke, fill, text]) layer.setPrimitiveColorUpdates(updates, scene);
    gradient.setPrimitiveColorUpdates(updates);
    assert.deepEqual([...stroke.segmentStyleTexture.image.data], [scene.styles[0], 1, 0, 0.75]);
    assert.deepEqual([...fill.fillPathMetaTextureB.image.data], [10, 10, 1, 0]);
    assert.deepEqual([...fill.fillPathMetaTextureC.image.data], [0, 0, 0.75, 0.5]);
    assert.deepEqual([...text.textInstanceTextureC.image.data], [255, 0, 191, 128]);
    assert.deepEqual(gradient.entries[0].primitiveColor.toArray(), [1, 0, 0.75, 1]);
    if (backend === "webgl") {
      const shader = gradient.entries[0].material.fragmentShader;
      assert.match(shader, /baseColor = mix\(baseColor, uPrimitiveColor.rgb, uPrimitiveColor.a\)/);
      assert.match(shader, /sourcePaint.a \* mix\(maskPaint.a, 1.0, uPdfShapeOnly\)/);
      assert.match(shader, /float alpha = heprThreeLinearCoverageToOutputAlpha\(coverage\).* \* paintAlpha;/);
      assert.deepEqual(gradient.entries[0].material.uniforms.uVectorOverride.value.toArray(), options.vectorOverride);
    }
    const restores = updates.map(update => ({ ...update, color: null }));
    for (const layer of [stroke, fill, text]) layer.setPrimitiveColorUpdates(restores, scene);
    gradient.setPrimitiveColorUpdates(restores);
    assert.deepEqual([...stroke.segmentStyleTexture.image.data], [...scene.styles]);
    assert.deepEqual([...fill.fillPathMetaTextureB.image.data], [...scene.fillPathMetaB]);
    assert.deepEqual([...fill.fillPathMetaTextureC.image.data], [...scene.fillPathMetaC]);
    assert.deepEqual([...text.textInstanceTextureC.image.data], [...scene.textInstanceC].map(value => Math.round(value * 255)));
    assert.equal(gradient.entries[0].primitiveColor.w, 0);
    const overlay = new ThreePrimitiveHighlightLayer(backend, "linear");
    assert.equal(overlay.mesh.material.transparent, true, "traces follow the opaque fallback page");
    const packet = buildPrimitiveHighlights(scene, [{ kind: "stroke", index: 0 }], { kind: "text", index: 0 });
    overlay.setHighlights(packet);
    overlay.updateFrame(new THREE.Matrix4(), 0.1, 2);
    assert.equal(overlay.mesh.geometry.instanceCount, 2);
    assert.equal(overlay.selectionCount.value, 1);
    assert.equal(overlay.pixelRatio.value, 2);
    const bufferGeometry = overlay.mesh.geometry;
    overlay.setHighlights(buildPrimitiveHighlights(scene, [], { kind: "stroke", index: 0 }));
    assert.equal(overlay.mesh.geometry, bufferGeometry, "changed hover reuses sufficient buffer capacity");
    assert.equal(overlay.mesh.geometry.instanceCount, 1);
    overlay.dispose();
    for (const layer of [stroke, fill, text, gradient]) layer.dispose();
  }

  // Stroke elimination is renderer-owned and must be reversible when any
  // original solid paint changes, including intervening fills or glyphs.
  const duplicateScene = { ...scene, segmentCount: 2,
    endpoints: floats([1, 5, 0, 0, 1, 5, 0, 0]),
    primitiveMeta: floats([9, 5, 0, 1, 9, 5, 0, 1]),
    primitiveBounds: floats([1, 5, 9, 5, 1, 5, 9, 5]),
    styles: floats([0.1, 0.2, 0.3, 0.4, 0.1, 0.2, 0.3, 0.4]),
    drawRuns: [{ kind: "stroke", first: 0, count: 2 }] };
  for (const backend of ["webgl", "webgpu"]) {
    const layer = new ThreeMaterialStrokeLayer(duplicateScene, {
      materialBackend: backend, strokeCurveEnabled: true, vectorOverride: [0, 0, 0, 0]
    });
    assert.equal(layer.getRenderedSegmentCount(), 1);
    for (const kind of ["stroke", "fill", "text"]) {
      const update = { ref: { kind, index: 0 }, color: [1, 0, 0] };
      layer.setPrimitiveColorUpdates([update], duplicateScene);
      assert.equal(layer.getRenderedSegmentCount(), 2, `${backend}: ${kind} override restores redundant strokes`);
      layer.setPrimitiveColorUpdates([{ ...update, color: null }], duplicateScene);
      assert.equal(layer.getRenderedSegmentCount(), 1, `${backend}: clearing ${kind} restores stroke elimination`);
    }
    layer.setPrimitiveColorUpdates([
      { ref: { kind: "stroke", index: 0 }, color: [1, 0, 0] },
      { ref: { kind: "fill", index: 0 }, color: [0, 0, 1] }
    ], duplicateScene);
    layer.setPrimitiveColorUpdates([{ ref: { kind: "stroke", index: 0 }, color: null }], duplicateScene);
    assert.equal(layer.getRenderedSegmentCount(), 2, "other active solid overrides still invalidate the proof");
    layer.setPrimitiveColorUpdates([{ ref: { kind: "fill", index: 0 }, color: null }], duplicateScene);
    assert.equal(layer.getRenderedSegmentCount(), 1);
    layer.dispose();
  }

  // Exercise the public object API without a DOM, renderer, or graphics context.
  const noop = () => {};
  const nativeUpdates = [];
  let uploaded = false;
  const renderer = new Proxy({ hasUploadedScene: () => uploaded,
    setPrimitiveColorUpdates: updates => nativeUpdates.push(updates),
    getViewState: () => ({ zoom: 1, cameraCenterX: 5, cameraCenterY: 5 }) },
  { get: (target, key) => target[key] ?? noop });
  const stub = () => new Proxy({ mesh: new THREE.Mesh(), group: new THREE.Group() },
    { get: (target, key) => target[key] ?? noop });
  const page = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial());
  const uv = new Float32Array(8);
  const object = new HeprThreePdfObject({ sourceLabel: "fixture", sourceKind: "hep", scene }, "webgl",
    renderer, { width: 200, height: 200 }, null,
    { vectorLodMode: "off", textLodMode: "off", strokeCurveEnabled: true, textVectorOnly: true,
      threeColorCompositing: "linear", pageBackground: [1, 1, 1, 1], vectorOverride: [0, 0, 0, 0] },
    0, stub(), stub(), stub(), stub(), null, null, null, stub(), null, page, uv, new THREE.BufferAttribute(uv, 2));
  const element = { getBoundingClientRect: () => ({ left: 75, top: 30, width: 200, height: 200 }) };
  const cameras = [new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100),
    new THREE.PerspectiveCamera(60, 1, 0.1, 100)];
  object.scale.set(1.5, 0.7, 1);
  object.rotation.z = 0.2;
  object.updateMatrixWorld(true);
  const preparation = [];
  const unsubscribe = object.subscribePrimitivePreparationProgress(value => preparation.push(value));
  const unsubscribeThrowing = object.subscribePrimitivePreparationProgress(() => { throw new Error("observer"); });
  assert.deepEqual(preparation, [null]);
  for (const camera of cameras) {
    camera.position.set(0, 0, 20);
    camera.updateMatrixWorld(true);
    const client = object.sceneToClientPoint(camera, 5, 5, element);
    const hit = await object.pick({ camera, element, clientX: client.x, clientY: client.y,
      tolerancePx: 4, kinds: ["stroke"] });
    assert.deepEqual(hit.primitive, { kind: "stroke", index: 0 });
    assert.ok(hit.distancePx < 1e-8);
    assert.equal(await object.pick({ camera, element, clientX: 0, clientY: 0 }), null);
  }
  const aborted = new AbortController();
  assert.equal(preparation[1], 0);
  assert.equal(preparation.at(-1), 100);
  const replay = [];
  const stopReplay = object.subscribePrimitivePreparationProgress(value => replay.push(value));
  assert.deepEqual(replay, [100], "new observers receive completed preparation");
  stopReplay();
  aborted.abort(new Error("cancelled pick"));
  await assert.rejects(object.pick({ camera: cameras[0], element, clientX: 175, clientY: 130,
    signal: aborted.signal }), /cancelled pick/);
  object.setSelection([{ kind: "stroke", index: 0 }]);
  const geometry = object.primitiveHighlightLayer.mesh.geometry;
  object.setSelection([{ kind: "stroke", index: 0 }, { kind: "stroke", index: 0 }]);
  assert.equal(object.primitiveHighlightLayer.mesh.geometry, geometry, "duplicate selection reuses traces");
  object.setPrimitiveOverrides([{ kind: "stroke", index: 0 }], { color: "red" });
  assert.equal(nativeUpdates.length, 0, "dormant native scene must stay unallocated");
  uploaded = true;
  object.setPrimitiveOverrides([{ kind: "fill", index: 0 }], { color: "blue" });
  assert.equal(nativeUpdates[0].length, 2, "first native update replays overrides made before upload");
  object.clearPrimitiveInteraction();
  assert.equal(preparation.at(-1), null, "clearing releases the preparation state");
  assert.deepEqual(replay, [100], "unsubscribed observers receive no further progress");
  unsubscribe(); unsubscribeThrowing();
  assert.equal(object.primitiveHighlightLayer, null);
  assert.equal(object.primitivePicker, null);
  object.dispose();
  await assert.rejects(object.pick({ camera: cameras[0], element, clientX: 100, clientY: 100 }), /disposed/);
  for (const [key, value] of Object.entries(original)) assert.deepEqual(scene[key], value, `${key} remains immutable`);
  console.log("Three primitive interaction, color restoration, projection, overlay, and deferred replay tests passed");
} finally { hooks.deregister(); }
