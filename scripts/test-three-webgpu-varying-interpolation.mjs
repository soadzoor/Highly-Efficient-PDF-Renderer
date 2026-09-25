import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";
import { TSL } from "three/webgpu";
import WGSLNodeBuilder from "../node_modules/three/src/renderers/webgpu/nodes/WGSLNodeBuilder.js";

// The GLSL shaders declare every per-primitive value `flat` and the native WGSL
// shaders tag them `@interpolate(flat)`. The Three WebGPU node materials must
// describe the same pipeline: only positions genuinely vary across a primitive,
// and per-vertex mesh colors stay interpolated so patch meshes keep shading.
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
  const { createThreeWebGpuStrokeMaterial } = await import("../src/threeWebGpuStrokeMaterial.ts");
  const { createThreeWebGpuFillMaterial } = await import("../src/threeWebGpuFillMaterial.ts");
  const { createThreeWebGpuTextMaterial } = await import("../src/threeWebGpuTextMaterial.ts");
  const { createThreeWebGpuGradientFillMaterial, createThreeWebGpuGradientStrokeMaterial } =
    await import("../src/threeWebGpuGradientMaterial.ts");

  const common = {
    colorCompositing: "linear",
    viewport: new THREE.Vector2(800, 600), cameraCenter: new THREE.Vector2(),
    localToClip: new THREE.Matrix4(), vectorOverride: new THREE.Vector4()
  };
  const gradient = {
    ...common, primitiveColor: new THREE.Vector4(),
    gradientMetaTextureA: dataTexture(), gradientMetaTextureB: dataTexture(), gradientMetaTextureC: dataTexture(),
    gradientMetaTextureD: dataTexture(), gradientMetaTextureE: dataTexture(), gradientLutTexture: dataTexture(),
    gradientMetaTextureWidth: 4, sourceGradientIndex: 0, maskGradientIndex: -1
  };
  const fillTextures = {
    fillPathMetaTextureA: dataTexture(), fillPathMetaTextureB: dataTexture(), fillPathMetaTextureC: dataTexture(),
    fillSegmentTextureA: dataTexture(), fillSegmentTextureB: dataTexture(),
    fillPathTextureWidth: 4, fillSegmentTextureWidth: 4
  };
  const strokeTextures = {
    segmentTextureA: dataTexture(), segmentTextureB: dataTexture(),
    segmentStyleTexture: dataTexture(), segmentBoundsTexture: dataTexture(),
    segmentTextureWidth: 4, strokeCurveEnabled: true
  };

  const cases = [
    ["stroke", createThreeWebGpuStrokeMaterial({ ...common, ...strokeTextures }),
      quadGeometry("aSegmentIndex"), { flat: 4, interpolated: 1 }],
    ["fill", createThreeWebGpuFillMaterial({ ...common, ...fillTextures }),
      quadGeometry("aFillPathIndex"), { flat: 4, interpolated: 1 }],
    ["text", createThreeWebGpuTextMaterial({
      ...common,
      textInstanceTextureA: dataTexture(), textInstanceTextureB: dataTexture(), textInstanceTextureC: dataTexture(),
      textGlyphMetaTextureA: dataTexture(), textGlyphMetaTextureB: dataTexture(), textGlyphRasterMetaTexture: dataTexture(),
      textGlyphSegmentTextureA: dataTexture(), textGlyphSegmentTextureB: dataTexture(),
      textRasterAtlasTexture: dataTexture(), textRasterAtlasSize: new THREE.Vector2(4, 4),
      textInstanceTextureWidth: 4, textGlyphTextureWidth: 4, textSegmentTextureWidth: 4,
      strokeCurveEnabled: true, textVectorOnly: false
    }), quadGeometry("aTextInstanceIndex"), { flat: 6, interpolated: 1 }],
    ["gradient fill", createThreeWebGpuGradientFillMaterial({ ...gradient, ...fillTextures, mesh: false }),
      quadGeometry("aFillPathIndex"), { flat: 4, interpolated: 1 }],
    ["gradient stroke", createThreeWebGpuGradientStrokeMaterial({ ...gradient, ...strokeTextures }),
      quadGeometry("aSegmentIndex"), { flat: 4, interpolated: 1 }],
    // Patch meshes carry one path index for the whole geometry, so the path
    // metadata is still per-primitive; only the Gouraud colors interpolate.
    ["gradient patch mesh", createThreeWebGpuGradientFillMaterial({ ...gradient, ...fillTextures, mesh: true }),
      meshGeometry(), { flat: 4, interpolated: 2 }]
  ];

  for (const [name, state, geometry, expected] of cases) {
    const shaders = build(state.material, geometry);
    const vertex = shaders.vertexShader;
    if (name.includes("fill") || name === "gradient patch mesh") {
      assert.match(vertex, /heprFillBandInfo/, `${name}: vertex loads per-path band metadata`);
      assert.match(shaders.fragmentShader, /heprBandRows\(bandInfo, band, bandCount, box\)/, `${name}: each band integrates only its own rows`);
      assert.match(shaders.fragmentShader, /packedIndex & 3/, `${name}: packed segment addressing is shared`);
    }
    if (name === "text") {
      assert.doesNotMatch(shaders.fragmentShader, /i < 2048/, "outlined glyphs have no fixed 2048-edge ceiling");
      assert.match(shaders.fragmentShader, /i < segmentCount/, "text traverses every outline edge");
    }
    const struct = vertex.match(/struct VaryingsStruct \{[\s\S]*?\n\};/);
    assert(struct, `${name} declares a varyings struct`);
    const locations = struct[0].split("\n").filter(line => line.includes("@location("));
    const flat = locations.filter(line => /@interpolate\(\s*flat\s*\)/.test(line));
    assert.equal(flat.length, expected.flat, `${name}: per-primitive varyings are flat`);
    assert.equal(locations.length - flat.length, expected.interpolated,
      `${name}: only positions (and patch-mesh colors) interpolate`);
    // The position pack must never be flat: the fragment shader reconstructs
    // page-space coordinates and screen-space derivatives from it.
    assert.doesNotMatch(locations[0], /@interpolate/, `${name}: the position pack stays interpolated`);
    state.material.dispose();
    geometry.dispose();
  }

  console.log("Three WebGPU node materials: per-primitive varyings are flat, positions interpolate.");
} finally { hooks.deregister(); }

function dataTexture() {
  const texture = new THREE.DataTexture(new Float32Array(4 * 4 * 4), 4, 4, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  return texture;
}

function quadGeometry(instanceAttributeName) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("aCorner", new THREE.Float32BufferAttribute(
    new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
  geometry.setAttribute(instanceAttributeName, new THREE.InstancedBufferAttribute(new Float32Array([0, 1]), 1));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  geometry.instanceCount = 2;
  return geometry;
}

function meshGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("aMeshPosition", new THREE.Float32BufferAttribute(new Float32Array(6), 2));
  geometry.setAttribute("aMeshColor", new THREE.Float32BufferAttribute(new Float32Array(12), 4));
  geometry.setAttribute("aFillPathIndex", new THREE.Float32BufferAttribute(new Float32Array(3), 1));
  return geometry;
}

function build(material, geometry) {
  // Shader generation needs neither a GPU device nor a browser. This validates
  // TSL/WGSL node integration; driver compilation still belongs to manual checks.
  const renderer = {
    contextNode: TSL.context({}), library: { fromMaterial: value => value },
    getRenderTarget: () => null, getMRT: () => null,
    backend: { compatibilityMode: false, utils: { getTextureSampleData: () => ({ primarySamples: 1 }) },
      capabilities: { getUniformBufferLimit: () => 65536 } },
    hasFeature: () => false, hasCompatibility: () => false,
    coordinateSystem: THREE.WebGPUCoordinateSystem
  };
  const builder = new WGSLNodeBuilder(new THREE.Mesh(geometry, material), renderer);
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.PerspectiveCamera();
  return builder.build();
}
