import assert from "node:assert/strict";
import { registerHooks } from "node:module";

let allowWebGpu = false;
let webGpuImports = 0;
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === "three/webgpu") {
    webGpuImports++;
    assert(allowWebGpu, "WebGL construction must not initialize the WebGPU material graph");
  }
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) {
    return next(`${specifier}.ts`, context);
  }
  return next(specifier, context);
} });
const previousDocument = globalThis.document;
globalThis.document = { createElement: () => ({ width: 1, height: 1, style: {} }) };

try {
  const { CORE_STROKE_VERTEX_SHADER_SOURCE } = await import("../src/coreShaders.ts");
  assert.match(CORE_STROKE_VERTEX_SHADER_SOURCE, /gl_Position/);
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { createThreePdfObject } = await import("../src/threePdfObject.ts");
  const scene = buildStrokeScene([{ points: [[0, 0], [10, 10]], width: 1, color: "red" }]);
  const native = () => new Proxy({
    getViewState: () => ({ zoom: 1, cameraCenterX: 5, cameraCenterY: 5 })
  }, { get: (target, key) => target[key] ?? (() => {}) });
  const source = { scene, sourceLabel: "backend loading", sourceKind: "scene" };
  const webGl = await createThreePdfObject(source, { rendererType: "webgl", vectorLod: "off", textLod: "off" },
    undefined, undefined, native);
  assert.equal(webGpuImports, 0);
  assert.equal(webGl.strokeMaterialLayer.mesh.material.isRawShaderMaterial, true);
  webGl.dispose();

  allowWebGpu = true;
  const webGpu = await createThreePdfObject(source, { rendererType: "webgpu", vectorLod: "off", textLod: "off" },
    undefined, undefined, native);
  assert(webGpuImports > 0);
  assert.equal(webGpu.strokeMaterialLayer.mesh.material.isNodeMaterial, true,
    "the async factory prepares the selected backend before returning its object");
  webGpu.dispose();
  console.log("Three backend loading: WebGL excludes WebGPU initialization; WebGPU factories return prepared node materials.");
} finally {
  globalThis.document = previousDocument;
  hooks.deregister();
}
