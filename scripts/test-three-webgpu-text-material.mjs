import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";
import { TSL } from "three/webgpu";
import WGSLNodeBuilder from "../node_modules/three/src/renderers/webgpu/nodes/WGSLNodeBuilder.js";

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
  const { createThreeWebGpuTextMaterial } = await import("../src/threeWebGpuTextMaterial.ts");
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("aCorner", new THREE.Float32BufferAttribute(
    new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
  geometry.setAttribute("aTextInstanceIndex", new THREE.InstancedBufferAttribute(new Float32Array([0, 1]), 1));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  geometry.instanceCount = 2;

  const state = createThreeWebGpuTextMaterial({
    colorCompositing: "linear",
    textInstanceTextureA: dataTexture(), textInstanceTextureB: dataTexture(), textInstanceTextureC: dataTexture(),
    textGlyphMetaTextureA: dataTexture(), textGlyphMetaTextureB: dataTexture(), textGlyphRasterMetaTexture: dataTexture(),
    textGlyphSegmentTextureA: dataTexture(), textGlyphSegmentTextureB: dataTexture(),
    textRasterAtlasTexture: dataTexture(), textRasterAtlasSize: new THREE.Vector2(4, 4),
    textInstanceTextureWidth: 4, textGlyphTextureWidth: 4, textSegmentTextureWidth: 4,
    viewport: new THREE.Vector2(800, 600), cameraCenter: new THREE.Vector2(),
    localToClip: new THREE.Matrix4(), vectorOverride: new THREE.Vector4(),
    strokeCurveEnabled: true, textVectorOnly: false
  });
  const vertex = build(state.material, geometry).vertexShader;
  const clipFn = wgslFunction(vertex, "heprTextClipPosition").replace(/^\s*\/\/.*$/gm, "");

  // Glyph outlines are stored in font units, so vertexPack.zw holds real
  // glyph-space coordinates. Culling on a sentinel packed there also matched
  // glyphs whose bounds reach below the origin and dragged a single quad
  // corner to clip space (-2, -2), drawing a long sliver across the page.
  assert.doesNotMatch(clipFn, /vertexPack\.[zw]/,
    "degenerate glyphs must not be detected from packed glyph-space coordinates");
  assert.match(clipFn, /i32\(\s*glyphMetaA\.y \+ 0\.5\s*\) <= 0/,
    "degenerate glyphs are culled per instance on the glyph segment count, like the GLSL and native WGSL shaders");

  // The cull must read the same glyph metadata the vertex pack positions from.
  const packArgs = callArguments(vertex, "heprTextVertexPack");
  const clipArgs = callArguments(vertex, "heprTextClipPosition");
  assert.equal(clipArgs[1], packArgs[3], "the clip position reads the glyph metadata used to build the quad");

  state.material.dispose();
  geometry.dispose();
  console.log("Three WebGPU text material: degenerate glyph culling matches the GLSL and native WGSL shaders.");
} finally { hooks.deregister(); }

function dataTexture() {
  const texture = new THREE.DataTexture(new Float32Array(4 * 4 * 4), 4, 4, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  return texture;
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

function wgslFunction(source, name) {
  const result = source.match(new RegExp(`fn ${name}\\s*\\([\\s\\S]*?\\n}`));
  assert(result, `generated shader contains ${name}`);
  return result[0];
}

function callArguments(source, name) {
  const result = source.match(new RegExp(`= ${name}\\( ([^\\n]*) \\);`));
  assert(result, `generated shader calls ${name}`);
  return result[1].split(", ");
}
