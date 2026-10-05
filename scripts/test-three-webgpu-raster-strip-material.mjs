import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";
// The builder must come from the same three/webgpu module as the materials:
// a second copy keeps its own TSL stack, and a clip's assignments vanish.
import { TSL, WGSLNodeBuilder } from "three/webgpu";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  }
});

try {
  const { createThreeWebGpuRasterStripMaterial } = await import("../src/threeWebGpuRasterStripMaterial.ts");
  const { createThreeWebGpuRasterMaterial } = await import("../src/threeWebGpuRasterMaterial.ts");
  const { RASTER_STRIP_WGSL } = await import("../src/nativeRasterStripWebGpuShader.ts");
  const { RASTER_STRIP_LEVEL_WGSL, RASTER_STRIP_SAMPLE_WGSL } = await import("../src/rasterStripWebGpuSampling.ts");
  const { initializeThreeVectorClip, createThreeVectorClipMaterial } = await import("../src/threeVectorClips.ts");
  const { setThreePdfShapeOnly } = await import("../src/threePdfShape.ts");
  const texture = new THREE.DataTexture(new Uint8Array(32 * 4 * 4), 32, 4, THREE.RGBAFormat);
  texture.generateMipmaps = false;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  const viewport = new THREE.Vector2(800, 600), cameraCenter = new THREE.Vector2(20, 30);
  const localToClip = new THREE.Matrix4().makeTranslation(0.2, -0.1, 0);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
  geometry.setAttribute("aCorner", new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), 2));
  const instances = new THREE.InstancedInterleavedBuffer(new Float32Array([
    10, 0, 0, 2, 0, 0, 3, 0.5,
    -5, 2, 1, 4, 20, 30, 8, 1,
    1, 0, 0, 1, 0, 2, 1, 0.8,
    2, 1, 0, 4, 8, 12, 5, 0.3
  ]), 8);
  geometry.setAttribute("aRasterMatrixABCD", new THREE.InterleavedBufferAttribute(instances, 4, 0));
  geometry.setAttribute("aRasterMatrixEFWidthOpacity", new THREE.InterleavedBufferAttribute(instances, 4, 4));
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  geometry.instanceCount = 4;

  for (const colorCompositing of ["display", "linear"]) {
    const state = createThreeWebGpuRasterStripMaterial({ texture, viewport, cameraCenter, localToClip, colorCompositing });
    const { material } = state;
    assert.equal(material.depthWrite, false);
    assert.equal(material.depthTest, false);
    assert.equal(material.blending, THREE.CustomBlending);
    assert.equal(material.blendSrc, THREE.OneFactor);
    assert.equal(material.blendDst, THREE.OneMinusSrcAlphaFactor);
    assert.equal(material.blendSrcAlpha, THREE.OneFactor);
    assert.equal(material.blendDstAlpha, THREE.OneMinusSrcAlphaFactor);
    assert.equal(state.zoomUniform.value, 1);
    assert.equal(state.useLocalToClipUniform.value, 0);
    state.zoomUniform.value = 2.5;
    state.useLocalToClipUniform.value = 1;

    const builder = build(material, geometry);
    const vertex = builder.vertexShader, fragment = builder.fragmentShader;
    assert.match(vertex, /@builtin\(\s*instance_index\s*\)/, "rows use the GPU instance index without another per-image buffer");
    assert.match(vertex, /aRasterMatrixABCD/);
    assert.match(vertex, /aRasterMatrixEFWidthOpacity/);
    assert.match(vertex, /localToClip \* vec4<f32>\(world/);
    assert.match(vertex, /1\.0 - corner01\.y/);
    assert.match(fragment, /@interpolate\(\s*flat\s*\)/, "row and width/opacity remain constant throughout each quad");
    assert.match(fragment, /var .* : sampler;/);
    assert.match(fragment, /var .* : texture_2d<f32>;/);
    for (const source of [RASTER_STRIP_LEVEL_WGSL, RASTER_STRIP_SAMPLE_WGSL]) {
      // This is Three's real NodeBuilder output. Native and Three must use the same
      // level offsets, derivatives and manual trilinear filter, not parallel copies.
      const body = source.slice(source.indexOf("{") + 1, source.lastIndexOf("}"));
      assert(fragment.includes(body));
      assert(RASTER_STRIP_WGSL.includes(source));
    }
    assert.equal((fragment.match(/fn heprRasterStripLevel\s*\(/g) ?? []).length, 1);
    assert.equal((fragment.match(/fn heprRasterStripSample\s*\(/g) ?? []).length, 1);
    assert.equal((fragment.match(/fn heprThreeOutputColor\s*\(/g) ?? []).length, 1);
    assert.equal(fragment.includes("pow("), colorCompositing === "linear");
    assert.match(fragment, /heprThreeOutputColor\(straightSrgb\) \* color\.a/);
    assert.match(fragment, /mix\(opacity, 1\.0, shapeOnly\)/);
    const baseline = createThreeWebGpuRasterMaterial({
      texture, viewport, cameraCenter, localToClip, colorCompositing,
      matrixABCD: new THREE.Vector4(1, 0, 0, 1), matrixEF: new THREE.Vector2()
    });
    const baselineBuilder = build(baseline.material, geometry);
    for (const name of ["heprRasterPack", "heprRasterClipPosition"]) {
      assert.equal(wgslFunction(vertex, name), wgslFunction(baselineBuilder.vertexShader, name));
    }
    assert.equal(wgslFunction(fragment, "heprRasterFragment"), wgslFunction(baselineBuilder.fragmentShader, "heprRasterFragment"));
    // A single image antialiases its clip the same way.
    const baselineClipTexture = new THREE.DataTexture(new Float32Array(16), 4, 1, THREE.RGBAFormat, THREE.FloatType);
    initializeThreeVectorClip(baseline.material, baselineClipTexture);
    const baselineClipped = createThreeVectorClipMaterial(baseline.material, 0);
    const baselineFragment = build(baselineClipped, geometry).fragmentShader;
    assert.match(baselineFragment, /heprRasterClipRectSamples\(/, "ordinary images keep tile/page clips solid");
    assert.match(baselineFragment.slice(baselineFragment.lastIndexOf("@fragment")),
      /heprClipAAWidth = heprClipPixelWidth[\s\S]*heprClipSource \* vec4<f32>\( heprVectorClipAA\(/);
    baselineClipped.dispose();
    baselineClipTexture.dispose();
    // NodeBuilder evaluates the sampling argument before the shared fragment
    // helper can discard a transparent pixel, so derivatives stay uniform.
    assert.match(fragment, /heprRasterFragment\(\s*heprRasterStripSample\(/);
    baseline.material.dispose();
    const restoreShape = setThreePdfShapeOnly(material, true);
    restoreShape();

    const clipTexture = new THREE.DataTexture(new Float32Array(16), 4, 1, THREE.RGBAFormat, THREE.FloatType);
    initializeThreeVectorClip(material, clipTexture);
    const clipped = createThreeVectorClipMaterial(material, 0);
    const clippedBuilder = build(clipped, geometry);
    assert.match(clippedBuilder.fragmentShader, /heprRasterClipRectSamples\(/, "strip images use the same solid rectangle clips");
    assert.match(clippedBuilder.fragmentShader, /fn heprVectorClipAA\s*\(/, "a clip is often an image's outline: antialiased");
    assert.match(clippedBuilder.fragmentShader, /heprVectorClipAA\( .*\.xy,/, "clipping uses transformed page coordinates");
    const clippedMain = clippedBuilder.fragmentShader.slice(clippedBuilder.fragmentShader.lastIndexOf("@fragment"));
    assert.match(clippedMain, /heprClipSource \* vec4<f32>\( heprVectorClipAA\(/, "premultiplied color scales whole at the clip edge");
    assert(clippedMain.indexOf("heprClipAAWidth = heprClipPixelWidth") >= 0 &&
      clippedMain.indexOf("heprClipAAWidth = heprClipPixelWidth") < clippedMain.search(/heprClipSource = heprRasterFragment\w*\(/),
      `clip derivatives execute before the paint helper can discard: ${clippedMain}`);
    setThreePdfShapeOnly(clipped, true)();
    clipped.dispose();
    clipTexture.dispose();
    material.dispose();
  }
  geometry.dispose();
  texture.dispose();
  console.log("Three WebGPU raster strips: real NodeBuilder shaders, shared sampling, instance rows, color variants, clipping and shape coverage passed.");
} finally { hooks.deregister(); }

function build(material, geometry) {
  // Shader generation needs neither a GPU device nor a browser. This validates
  // TSL/WGSL node integration; driver compilation still belongs to manual checks.
  const renderer = {
    contextNode: TSL.context({}), library: { fromMaterial: value => value },
    getRenderTarget: () => null, getMRT: () => null,
    backend: { compatibilityMode: false, utils: { getTextureSampleData: () => ({ primarySamples: 1 }) },
      capabilities: { getUniformBufferLimit: () => 65536 } },
    hasFeature: () => false, hasCompatibility: () => false,
    coordinateSystem: THREE.WebGPUCoordinateSystem,
    debug: { diagnostics: { keywords: false } }
  };
  const builder = new WGSLNodeBuilder(new THREE.Mesh(geometry, material), renderer);
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.PerspectiveCamera();
  return builder.build();
}

function wgslFunction(source, name) {
  const result = source.match(new RegExp(`fn ${name}\\s*\\([\\s\\S]*?\\n}`));
  assert(result, `generated shader contains ${name}`);
  return result[0];
}
