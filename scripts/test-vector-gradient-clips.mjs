import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) {
    return next(`${specifier}.ts`, context);
  }
  return next(specifier, context);
} });
try {
  const { validateVectorDrawRuns } = await import("../src/vectorDrawOrder.ts");
  const { VectorOrderedBatches } = await import("../src/vectorOrderedBatches.ts");
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");
  const { ThreeMaterialGradientLayer } = await import("../src/threeMaterialGradientLayer.ts");
  const { GRADIENT_FILL_FRAGMENT_SHADER_SOURCE, GRADIENT_STROKE_FRAGMENT_SHADER_SOURCE } =
    await import("../src/nativeGradientWebGlShaders.ts");
  const { GRADIENT_FILL_WGSL, GRADIENT_STROKE_WGSL } = await import("../src/nativeGradientWebGpuShaders.ts");

  const scene = gradientScene();
  validateVectorDrawRuns(scene);
  assert.throws(() => validateVectorDrawRuns({ ...scene,
    drawRuns: scene.drawRuns.map(run => ({ ...run, blendMode: "Multiply" })) }), /Multiply/);
  const batches = new VectorOrderedBatches(scene, null);
  batches.update(scene.drawRuns);
  assert.deepEqual(batches.batches, scene.drawRuns, "gradient batching retains individual clip roots");

  for (const source of [GRADIENT_FILL_FRAGMENT_SHADER_SOURCE, GRADIENT_STROKE_FRAGMENT_SHADER_SOURCE]) {
    assert.match(source, /uniform float uVectorClipIndex/);
    assert.match(source, /\* heprVectorClip\(vLocal\)/);
  }
  for (const source of [GRADIENT_FILL_WGSL, GRADIENT_STROKE_WGSL]) {
    assert.match(source, /@group\(1\) @binding\(0\) var uVectorClipTex/);
    assert.match(source, /\* heprVectorClip\(inData.local, uVectorClip.x, uVectorClipTex\)/);
  }

  // Dispatch real gradient methods against small command recorders. Each draw
  // must use its clip, including restoring the unrestricted second fill.
  const flags = { scene, gradientData: scene, fillRenderingEnabled: true, strokeRenderingEnabled: true,
    textRenderingEnabled: true, rasterRenderingEnabled: true, zoom: 1 };
  const calls = [];
  let program, clip;
  const glApi = new Proxy({
    useProgram(value) { program = value; },
    getUniformLocation(_program, name) { return name; },
    uniform1f(name, value) { if (name === "uVectorClipIndex") clip = value; },
    drawArraysInstanced(_mode, first, _vertices, count) { calls.push([program, first, count, clip]); }
  }, { get(target, key) { return target[key] ?? (() => {}); } });
  const gl = Object.assign(Object.create(WebGlFloorplanRenderer.prototype), flags, {
    gl: glApi, drawPageBackgrounds() {}, vectorClipUniforms: new Map(),
    paintShapeUniforms: new Map(), orderedUniformPrograms: new Set(), orderedPaintUniformStates: new Map(),
    gradientFillProgram: "fill", gradientStrokeProgram: "stroke",
    gradientFillUniforms: {}, gradientStrokeUniforms: {}, gradientFillTextures: [], gradientStrokeTextures: [],
    gradientMetaTextures: [], vectorOverrideColor: [0, 0, 0], vectorOverrideOpacity: 0,
    strokeCurveEnabled: true
  });
  gl.drawSourceOrderedContent(100, 100, 50, 50, 1);
  assert.deepEqual(calls, [["fill", 0, 1, 1], ["fill", 4, 1, -1], ["stroke", 0, 1, 0]]);
  calls.length = 0;
  const gpu = Object.assign(Object.create(WebGpuFloorplanRenderer.prototype), flags, {
    drawPageBackgroundContentIntoPass() {}, gradientFillPipeline: "fill", gradientStrokePipeline: "stroke",
    primitiveGradientColors: { bindGroup() { return {}; } },
    gradientFillBindGroup: {}, gradientStrokeBindGroup: {}, vectorClipBindGroups: [-2, -1, 0, 1]
  });
  gpu.drawSourceOrderedContentIntoPass({
    setPipeline(value) { program = value; },
    setBindGroup(group, value) { if (group === 1) clip = value; },
    draw(_vertices, count, first) { calls.push([program, first, count, clip]); }
  });
  assert.deepEqual(calls, [["fill", 0, 1, 1], ["fill", 4, 1, -1], ["stroke", 0, 1, 0]]);

  // Construct Three materials without creating a browser or GPU session.
  for (const materialBackend of ["webgl", "webgpu"]) {
    const layer = new ThreeMaterialGradientLayer(scene, { materialBackend,
      strokeCurveEnabled: true, vectorOverride: [0, 0, 0, 0] });
    const entries = layer.getOrderedPaintMeshes();
    const materials = entries.map(entry => entry.mesh.material);
    assert.equal(materials.length, 3);

    // A default-constructed THREE.Vector4 carries w = 1, which would mix every
    // gradient to the unset primitive color (solid black) before any override.
    assert.deepEqual(entries.map(entry => entry.primitiveColor.w), [0, 0, 0],
      "gradients keep their own paint until a primitive color is requested");
    const fill = { kind: "gradient-fill", index: 0 };
    layer.setPrimitiveColorUpdates([{ ref: fill, color: [1, 0, 0] }]);
    assert.deepEqual(entries.map(entry => [...entry.primitiveColor]),
      [[1, 0, 0, 1], [0, 0, 0, 0], [0, 0, 0, 0]], "only the requested paint is recolored");
    layer.setPrimitiveColorUpdates([{ ref: fill, color: null }]);
    assert.deepEqual([...entries[0].primitiveColor], [0, 0, 0, 0], "clearing restores the source paint");
    if (materialBackend === "webgl") {
      assert(entries.every(entry => entry.mesh.material.uniforms.uPrimitiveColor.value === entry.primitiveColor),
        "clipped gradient materials share the entry's live primitive color");
    }
    if (materialBackend === "webgl") {
      assert.deepEqual(materials.map(m => m.uniforms.uVectorClipIndex.value), [1, -1, 0]);
      assert.equal(materials[0].uniforms.uVectorClipTex.value, materials[2].uniforms.uVectorClipTex.value);
      assert(materials.every(m => m.fragmentShader.includes("heprVectorClip(vLocal)")));
    } else {
      assert.equal(materials[0].fragmentNode.node.op, "*");
      assert.equal(materials[2].fragmentNode.node.op, "*");
      assert.notEqual(materials[1].fragmentNode.node?.op, "*");
    }
    layer.updateFrame({ zoom: 2, cameraCenterX: 3, cameraCenterY: 4 }, { width: 200, height: 100 });
    layer.dispose();
  }
  console.log("Clipped gradients retain ordered clip roots in both native renderers and both Three material backends");
} finally { hooks.deregister(); }

function gradientScene() {
  const floats = values => new Float32Array(values);
  return {
    fillPathCount: 0, fillSegmentCount: 0, segmentCount: 0, textInstanceCount: 0, rasterLayers: [],
    pageRects: floats([0, 0, 100, 100]), endpoints: floats([]), primitiveMeta: floats([]),
    primitiveBounds: floats([]), styles: floats([]),
    clipPaths: [
      { parent: -1, fillRule: 0, edges: floats([0, 0, 100, 0, 100, 0, 0, 100, 0, 100, 0, 0]) },
      { parent: 0, fillRule: 1, edges: floats([20, 20, 80, 20, 80, 20, 80, 80, 80, 80, 20, 80, 20, 80, 20, 20]) }
    ],
    drawRuns: [{ kind: "gradient-fill", first: 0, count: 1, clipIndex: 1 },
      { kind: "gradient-fill", first: 1, count: 1 }, { kind: "gradient-stroke", first: 0, count: 1, clipIndex: 0 }],
    gradientCount: 1, gradientMetaA: floats([0, 0, 0, 0]), gradientMetaB: floats([1, 0, 0, 1]),
    gradientMetaC: floats([0, 0, 0, 0]), gradientMetaD: floats([100, 0, 0, 0]), gradientMetaE: floats([0, 0, 0, 0]),
    gradientLut: new Uint8Array(1024 * 4).fill(255),
    gradientFillPathCount: 2, gradientFillSegmentCount: 4,
    gradientFillPathMetaA: floats([0, 4, 0, 0, 0, 4, 0, 0]),
    gradientFillPathMetaB: floats([100, 100, 0, 0, 100, 100, 0, 0]),
    gradientFillPathMetaC: floats([0, 0, 0, 1, 0, 0, 0, 1]),
    gradientFillPaintMeta: floats([0, -1, 0, 0, 0, -1, 1, 0]),
    gradientFillSegmentsA: floats([0, 0, 0, 0, 100, 0, 0, 0, 100, 100, 0, 0, 0, 100, 0, 0]),
    gradientFillSegmentsB: floats([100, 0, 0, 0, 100, 100, 0, 0, 0, 100, 0, 0, 0, 0, 0, 0]),
    gradientStrokeRunCount: 1, gradientStrokeSegmentCount: 1,
    gradientStrokeRunMetaA: floats([0, 1, 0, -1]), gradientStrokeRunMetaB: floats([2, 0, 0, 0]),
    gradientStrokeEndpoints: floats([0, 50, 100, 50]), gradientStrokePrimitiveMeta: floats([0, 0, 0, 0]),
    gradientStrokePrimitiveBounds: floats([0, 49, 100, 51]), gradientStrokeStyles: floats([1, 0, 0, 0])
  };
}
