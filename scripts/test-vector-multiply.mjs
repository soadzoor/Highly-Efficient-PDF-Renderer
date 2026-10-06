import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) {
    return next(`${specifier}.ts`, context);
  }
  return next(specifier, context);
} });
const webGpu = await import("../src/threeWebGpuBackend.ts");

try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { validateVectorDrawRuns } = await import("../src/vectorDrawOrder.ts");
  const { VectorOrderedBatches } = await import("../src/vectorOrderedBatches.ts");
  const { multiplyBlendState, multiplyFragmentGlsl, multiplyFragmentWgsl } = await import("../src/vectorMultiply.ts");
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");
  const { ThreeVectorDrawRuns } = await import("../src/threeVectorDrawRuns.ts");
  const { ThreeMaterialRasterLayer } = await import("../src/threeMaterialRasterLayer.ts");
  const { initializeThreeVectorClip, createThreeVectorClipTexture } = await import("../src/threeVectorClips.ts");
  const { applyThreePdfOverlayPaintOrder } = await import("../src/threePdfPaintOrder.ts");
  const { createThreeMultiplyMaterial } = await import("../src/threeVectorMultiply.ts");
  const { NodeMaterial, TSL } = await import("three/webgpu");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");

  const session = await openPdf({ kind: "bytes", bytes: fixture() });
  let scene;
  try {
    scene = await session.compileVectorPage(0, { vectorFallback: "error", optimization: "none" });
    assert.equal(scene.rasterLayers.length, 1, "Multiply retains only the original image");
    assert.equal(scene.fillPathCount, 4);
    assert.deepEqual(scene.drawRuns.map(run => [run.kind, run.blendMode]), [
      ["fill", undefined], ["fill", "Multiply"], ["fill", undefined], ["fill", "Multiply"], ["raster", "Multiply"]
    ], "nested nonisolated single-paint group inherits Multiply and q/Q restores Normal");
    assert(!session.getDiagnostics().some(d => d.code.endsWith("raster-fallback")));
  } finally { await session.close(); }
  const merged = composeVectorScenesInGrid([scene, scene], 2);
  assert.equal(merged.drawRuns.filter(run => run.blendMode === "Multiply").length, 6);
  const archive = await buildHep(merged, { encodeRasterImages: false, compression: "store" });
  const restored = await loadSceneFromHep(await archive.arrayBuffer());
  assert.deepEqual(restored.drawRuns, merged.drawRuns, "in-memory persistence retains blend order");
  assert.throws(() => validateVectorDrawRuns({ ...scene,
    drawRuns: scene.drawRuns.map((r, i) => i === 0 ? { ...r, blendMode: "Screen" } : r) }), /blend/);
  const plan = new VectorOrderedBatches(scene, null);
  plan.update(scene.drawRuns);
  assert.deepEqual(plan.batches.map(run => run.blendMode), scene.drawRuns.map(run => run.blendMode),
    "batching cannot merge Normal and Multiply fills");

  // Evaluate the actual blend-factor descriptors against the PDF premultiplied
  // equation, including antialias coverage and a transparent destination.
  for (const ad of [0, 0.2, 0.75, 1]) for (const opacity of [0, 0.3, 1]) for (const coverage of [0, 0.25, 1]) {
    const a = opacity * coverage;
    const source = [0.7 * a, 0.2 * a, 0.4 * a, a];
    const target = [0.15 * ad, 0.8 * ad, 0.3 * ad, ad];
    const expected = target.map((cd, channel) => channel === 3 ? a + ad * (1 - a)
      : source[channel] * cd + cd * (1 - a) + source[channel] * (1 - ad));
    let result = blend(source, target, multiplyBlendState(0));
    result = blend(source, result, multiplyBlendState(1));
    result.forEach((value, index) => assert(Math.abs(value - expected[index]) < 1e-12));
  }
  assert.match(multiplyFragmentGlsl("out vec4 outColor; void main() { outColor=vec4(1.); }", true), /if \(uHeprMultiply\) outColor.rgb \*= outColor.a/);
  assert.match(multiplyFragmentWgsl("@fragment fn fsMain(inData : VsOut) -> @location(0) vec4f { return vec4f(1.); }"), /vec4f\(color.rgb \* color.a, color.a\)/);

  const runs = [{ kind: "fill", first: 0, count: 2, blendMode: "Multiply" },
    { kind: "fill", first: 2, count: 1 }, { kind: "raster", first: 0, count: 1, blendMode: "Multiply" }];
  const flags = { scene: { drawRuns: runs }, fillRenderingEnabled: true, strokeRenderingEnabled: true,
    textRenderingEnabled: true, rasterRenderingEnabled: true };
  const calls = [];
  const gl = Object.assign(Object.create(WebGlFloorplanRenderer.prototype), flags, {
    gl: { blendFuncSeparate() {} }, drawPageBackgrounds() {}, setMultiplyBlend() {},
    drawFilledPaths(_w, _h, _x, _y, _z, first, count) { calls.push(["fill", first, count, this.multiplyPass ?? null]); },
    drawRasterLayerAtIndex(index) { calls.push(["raster", index, 1, this.multiplyPass ?? null]); }
  });
  gl.drawSourceOrderedContent(100, 100, 50, 50, 1);
  const expected = [["fill", 0, 1, 0], ["fill", 0, 1, 1], ["fill", 1, 1, 0], ["fill", 1, 1, 1],
    ["fill", 2, 1, null], ["raster", 0, 1, 0], ["raster", 0, 1, 1]];
  assert.deepEqual(calls, expected, "GL pairs both passes before overlapping next primitive");
  calls.length = 0;
  const gpu = Object.assign(Object.create(WebGpuFloorplanRenderer.prototype), flags, {
    fillPipeline: ["fill", null], rasterPipeline: ["raster", null], fillBindGroup: {}, rasterLayerResources: [{ bindGroup: {} }],
    drawPageBackgroundContentIntoPass() {}, bindVectorClip() {}, multiplyPipeline(pipeline, pass) { return [pipeline[0], pass]; }
  });
  let pipeline;
  gpu.drawSourceOrderedContentIntoPass({ setPipeline(p) { pipeline = p; }, setBindGroup() {},
    draw(_vertices, count, _firstVertex, first) { calls.push([pipeline[0], first, count, pipeline[1]]); }
  });
  assert.deepEqual(calls, expected, "WebGPU uses identical perprimitive paint ordering");

  // Real Three material/mesh construction without a browser or GPU session.
  const material = new THREE.RawShaderMaterial({ fragmentShader: "out vec4 outColor; void main(){outColor=vec4(1.);}",
    uniforms: { camera: { value: 1 } } });
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("id", new THREE.InstancedBufferAttribute(new Float32Array([0, 1, 2]), 1));
  geometry.instanceCount = 3;
  const parent = new THREE.Mesh(geometry, material);
  const clipTexture = createThreeVectorClipTexture(scene);
  initializeThreeVectorClip(material, clipTexture);
  const split = ThreeVectorDrawRuns.create({ drawRuns: runs }, "fill", parent, "id");
  assert.equal(parent.children.length, 5);
  assert.deepEqual(parent.children.map(mesh => mesh.geometry.getAttribute("id").getX(0)), [0, 0, 1, 1, 2]);
  assert(parent.children.every((mesh, i) => i === 0 || mesh.renderOrder > parent.children[i - 1].renderOrder));
  assert.equal(parent.children[0].material.blendSrcAlpha, THREE.ZeroFactor);
  assert.equal(parent.children[1].material.blendSrc, THREE.OneMinusDstAlphaFactor);
  assert.equal(parent.children[0].material.uniforms, material.uniforms);
  split.dispose(); geometry.dispose(); material.dispose(); clipTexture.dispose();
  const node = new NodeMaterial(); node.fragmentNode = TSL.vec4(0.5, 0.2, 0.1, 0.3);
  const nodeBlend = createThreeMultiplyMaterial(node, 0);
  assert(nodeBlend.premultipliedAlpha);
  assert.equal(nodeBlend.fragmentNode, node.fragmentNode);
  nodeBlend.dispose(); node.dispose();
  for (const materialBackend of ["webgl", "webgpu"]) {
    const layer = new ThreeMaterialRasterLayer(scene, { materialBackend, webGpu, pageBackground: [1, 1, 1, 0] });
    applyThreePdfOverlayPaintOrder(scene, layer.group, []);
    const image = layer.group.children.at(-1), completion = image.children[0];
    assert(completion.userData.heprMultiplyCompletion);
    assert(completion.renderOrder > image.renderOrder);
    assert.equal(completion.material.blendSrc, THREE.OneMinusDstAlphaFactor);
    assert.equal(image.material.blendSrcAlpha, THREE.ZeroFactor);
    layer.dispose();
  }
  console.log("Multiply vectors, transparent compositing, batching, persistence and both GPU dispatchers passed");
} finally { hooks.deregister(); }

function blend(source, destination, state) {
  const factor = (name, channel) => ({ one: 1, zero: 0, dst: destination[channel],
    "one-minus-src-alpha": 1 - source[3], "one-minus-dst-alpha": 1 - destination[3] })[name];
  return source.map((value, channel) => {
    const rule = channel === 3 ? state.alpha : state.color;
    return value * factor(rule.srcFactor, channel) + destination[channel] * factor(rule.dstFactor, channel);
  });
}
function fixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ExtGState << /M << /BM /Multiply /ca .5 >> /Opaque << /BM /Multiply >> >> /XObject << /G 5 0 R /Im 6 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", ".8 .5 .2 rg 0 0 90 90 re f q /M gs .5 g 5 5 20 20 re f Q 0 1 0 rg 20 20 5 5 re f q /M gs /G Do Q q /Opaque gs 10 0 0 10 60 60 cm /Im Do Q") },
    { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Group << /S /Transparency /I false /K false >> /Resources << >>", "1 0 0 rg 30 30 5 5 re f") },
    { number: 6, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB", new Uint8Array([100, 150, 200])) }
  ] });
}
