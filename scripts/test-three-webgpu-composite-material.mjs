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
  const { ThreePaintCompositor } = await import("../src/threePaintCompositor.ts");
  const compositor = new ThreePaintCompositor("webgpu");
  const fragment = build(compositor.passMaterial, compositor.mesh.geometry).fragmentShader;

  // Three keys a texture uniform by the bound texture's UUID, so every input
  // that still holds the shared placeholder when the shader is generated
  // collapses onto one binding. That left the pass reading its own source in
  // every channel, and the composited page resolved to nothing on screen.
  const bindings = [...fragment.matchAll(/var (\w+) : texture_2d<f32>/g)].map(match => match[1]);
  assert.deepEqual(bindings, ["uSource", "uShape", "uCurrent", "uStats", "uInitial", "uMask", "uTransfer"],
    "each composite input keeps its own texture binding");

  const call = fragment.match(/heprComposite\( ([^\n]*) \)/);
  assert(call, "the fragment shader calls the composite function");
  const loads = new Map([...fragment.matchAll(/(\w+) = textureLoad\( (\w+),/g)].map(match => [match[1], match[2]]));
  const [source, shape, current, stats, initial, mask, transfer] = call[1].split(", ");
  assert.deepEqual(
    [loads.get(source), loads.get(shape), loads.get(current), loads.get(stats), loads.get(initial), loads.get(mask)],
    ["uSource", "uShape", "uCurrent", "uStats", "uInitial", "uMask"],
    "each composite argument samples the binding it names");
  assert.equal(transfer, "uTransfer", "the soft-mask transfer stays a texture argument of its own");

  // An absent mask is a white 1×1 texture. Loading it at the viewport's
  // coordinates returned zero away from the origin, hiding translucent groups
  // such as the two diagonal ovals on Broschuere page 14. Check the generated
  // GPU code: selecting the right fallback texture alone does not protect it.
  const pixelLoads = new Map([...fragment.matchAll(/textureLoad\( (u\w+), ([^\n]*) \);/g)]
    .map(match => [match[1], match[2].replace(/\s+/g, "")]));
  for (const name of bindings.slice(0, 6)) {
    assert.equal(pixelLoads.get(name),
      `vec2<i32>(clamp(fragCoord.xy,vec2<f32>(0.0,0.0),(vec2<f32>(textureDimensions(${name},0))-vec2<f32>(1.0)))),u32(0u)`,
      `${name} clamps pixel loads to its own dimensions, including neutral 1×1 inputs`);
  }

  // Every pass input is an explicit texture load, so a filterable placeholder
  // would only add an unused sampler binding to each of them.
  assert.doesNotMatch(fragment, /: sampler;/, "the composite inputs bind no samplers");

  // Three reads filterability from the placeholder the node holds while the
  // shader is generated. A nearest one compiled the presented surface to a
  // point fetch, which showed up as blocky upscaling whenever the compositor
  // budget scaled its surfaces below the viewport.
  const present = build(compositor.mesh.material, compositor.mesh.geometry).fragmentShader;
  assert.match(present, /textureSample\(/, "the presented surface is filtered, as it is on the GL path");

  compositor.dispose();
  console.log("Three WebGPU compositor: independent texture bindings, bounded neutral inputs, filtered presentation.");
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
    coordinateSystem: THREE.WebGPUCoordinateSystem
  };
  const builder = new WGSLNodeBuilder(new THREE.Mesh(geometry, material), renderer);
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.PerspectiveCamera();
  return builder.build();
}
