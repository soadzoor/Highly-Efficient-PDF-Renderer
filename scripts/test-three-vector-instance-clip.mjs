// A batch that spans several clip roots reads the root per instance instead of
// from a uniform, which is what lets one draw cover a whole span of the paint
// schedule. Both three.js material backends have to express that: the raw GLSL
// materials through the core shaders' instance stream, and the WebGPU node
// materials through an instanced attribute feeding the same clip evaluator.

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
  const { createThreeInstanceVectorClipMaterial, createThreeVectorClipMaterial, createThreeVectorClipTexture,
    initializeThreeVectorClip, VECTOR_CLIP_INSTANCE_ATTRIBUTE } = await import("../src/threeVectorClips.ts");
  const { createThreeWebGpuStrokeMaterial } = await import("../src/threeWebGpuStrokeMaterial.ts");
  const { CORE_STROKE_VERTEX_SHADER_SOURCE, CORE_STROKE_FRAGMENT_SHADER_SOURCE,
    CORE_FILL_VERTEX_SHADER_SOURCE, CORE_FILL_FRAGMENT_SHADER_SOURCE,
    CORE_TEXT_VERTEX_SHADER_SOURCE, CORE_TEXT_FRAGMENT_SHADER_SOURCE } = await import("../src/coreShaders.ts");

  assert.equal(VECTOR_CLIP_INSTANCE_ATTRIBUTE, "aVectorClipIndex");

  // The shaders the raw three.js materials share with the native backends must
  // already carry the instance stream, or the uniform below selects nothing.
  for (const [name, vertex, fragment] of [
    ["stroke", CORE_STROKE_VERTEX_SHADER_SOURCE, CORE_STROKE_FRAGMENT_SHADER_SOURCE],
    ["fill", CORE_FILL_VERTEX_SHADER_SOURCE, CORE_FILL_FRAGMENT_SHADER_SOURCE],
    ["text", CORE_TEXT_VERTEX_SHADER_SOURCE, CORE_TEXT_FRAGMENT_SHADER_SOURCE]
  ]) {
    assert.match(vertex, new RegExp(`in float ${VECTOR_CLIP_INSTANCE_ATTRIBUTE};`),
      `the ${name} vertex shader must read the per-instance clip root`);
    assert.match(vertex, /vVectorClipIndex = aVectorClipIndex - 1\.0;/,
      `the ${name} vertex shader must undo the unclipped offset`);
    assert.match(fragment, /uVectorClipIndex < -1\.5 \? vVectorClipIndex : uVectorClipIndex/,
      `the ${name} fragment shader must fall back to the instance stream`);
  }

  const scene = clipScene();
  const clipTexture = createThreeVectorClipTexture(scene);

  const raw = new THREE.RawShaderMaterial();
  initializeThreeVectorClip(raw, clipTexture);
  assert.equal(createThreeVectorClipMaterial(raw, undefined), raw, "unclipped paints reuse the layer material");
  assert.equal(createThreeVectorClipMaterial(raw, 1).uniforms.uVectorClipIndex.value, 1,
    "a batch under one clip root binds it as a constant");
  const rawInstanced = createThreeInstanceVectorClipMaterial(raw);
  assert.equal(rawInstanced.uniforms.uVectorClipIndex.value, -2,
    "a batch spanning clip roots selects the instance stream");
  assert.equal(rawInstanced.uniforms.uVectorClipTex.value, clipTexture, "the clip texture stays shared");

  const node = createThreeWebGpuStrokeMaterial({
    colorCompositing: "linear",
    viewport: new THREE.Vector2(800, 600), cameraCenter: new THREE.Vector2(),
    localToClip: new THREE.Matrix4(), vectorOverride: new THREE.Vector4(),
    segmentTextureA: dataTexture(), segmentTextureB: dataTexture(),
    segmentStyleTexture: dataTexture(), segmentBoundsTexture: dataTexture(),
    segmentTextureWidth: 4, strokeCurveEnabled: true
  });
  initializeThreeVectorClip(node.material, clipTexture);
  const nodeInstanced = createThreeInstanceVectorClipMaterial(node.material);
  const shaders = build(nodeInstanced, quadGeometry());
  assert.match(shaders.vertexShader, new RegExp(`${VECTOR_CLIP_INSTANCE_ATTRIBUTE}`),
    "the WebGPU vertex stage must read the per-instance clip root");
  assert.match(shaders.fragmentShader, /heprVectorClip/,
    "the WebGPU fragment stage must evaluate the clip with it");
  // The root has to reach the fragment stage; a value that stayed in the vertex
  // stage would silently clip every batch to whatever the first instance used.
  const varyings = shaders.vertexShader.match(/struct VaryingsStruct \{[\s\S]*?\n\};/);
  assert.ok(varyings, "the WebGPU vertex stage declares a varyings struct");
  const forwarded = shaders.vertexShader.match(/varyings\.(\w+) = aVectorClipIndex;/);
  assert.ok(forwarded, "the clip root travels to the fragment stage as a varying");
  assert.match(varyings[0], new RegExp(`@interpolate\\(\\s*flat\\s*\\) ${forwarded[1]} : f32`),
    "a per-instance clip root must not be interpolated across the primitive");

  nodeInstanced.dispose();
  node.material.dispose();
  rawInstanced.dispose();
  raw.dispose();
  clipTexture.dispose();

  console.log("Three per-instance vector clip tests passed");
} finally { hooks.deregister(); }

function dataTexture() {
  const texture = new THREE.DataTexture(new Float32Array(4 * 4 * 4), 4, 4, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  return texture;
}

function quadGeometry() {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("aCorner", new THREE.Float32BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
  geometry.setAttribute("aSegmentIndex", new THREE.InstancedBufferAttribute(new Float32Array([0, 1]), 1));
  geometry.setAttribute("aVectorClipIndex", new THREE.InstancedBufferAttribute(new Float32Array([1, 2]), 1));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  geometry.instanceCount = 2;
  return geometry;
}

function clipScene() {
  const rectangle = (minX, minY, maxX, maxY) => ({ parent: -1, fillRule: 0, edges: new Float32Array([
    minX, minY, maxX, minY, maxX, minY, maxX, maxY,
    maxX, maxY, minX, maxY, minX, maxY, minX, minY]) });
  return { clipPaths: [rectangle(0, 0, 10, 10), rectangle(2, 2, 8, 8)] };
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
