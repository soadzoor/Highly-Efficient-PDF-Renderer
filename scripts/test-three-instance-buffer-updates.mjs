import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as THREE from "three";
import { createServer } from "vite";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRootDir = path.resolve(scriptDir, "..");

const viteServer = await createServer({
  configFile: false,
  root: repoRootDir,
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true }
});

try {
  const [textModule, fillModule, strokeModule, triangleStrokeModule, rasterModule] = await Promise.all([
    viteServer.ssrLoadModule("/src/threeMaterialTextLayer.ts"),
    viteServer.ssrLoadModule("/src/threeMaterialFillLayer.ts"),
    viteServer.ssrLoadModule("/src/threeMaterialStrokeLayer.ts"),
    viteServer.ssrLoadModule("/src/threeTriangleStrokeLayer.ts"),
    viteServer.ssrLoadModule("/src/threeMaterialRasterLayer.ts")
  ]);

  const scene = createScene();
  const textLayer = new textModule.ThreeMaterialTextLayer(scene, {
    materialBackend: "webgl",
    strokeCurveEnabled: true,
    textVectorOnly: false,
    vectorOverride: [0, 0, 0, 0]
  });
  const fillLayer = new fillModule.ThreeMaterialFillLayer(scene, {
    materialBackend: "webgl",
    vectorOverride: [0, 0, 0, 0]
  });
  const strokeLayer = new strokeModule.ThreeMaterialStrokeLayer(scene, {
    materialBackend: "webgl",
    strokeCurveEnabled: true,
    vectorOverride: [0, 0, 0, 0]
  });
  const triangleStrokeLayer = new triangleStrokeModule.ThreeTriangleStrokeLayer(scene, {
    vectorOverride: [0, 0, 0, 0]
  });
  const pageScene = createScene();
  pageScene.pageCount = 3;
  pageScene.pagesPerRow = 3;
  pageScene.pageRects = new Float32Array([
    0, 0, 10, 10,
    12, 0, 22, 10,
    24, 0, 34, 10
  ]);
  const rasterLayer = new rasterModule.ThreeMaterialRasterLayer(pageScene, {
    materialBackend: "webgl",
    pageBackground: [1, 1, 1, 1]
  });

  try {
    const textAttribute = assertStreamAttribute(textLayer, "aTextInstanceIndex", "text");
    const fillAttribute = assertStreamAttribute(fillLayer, "aFillPathIndex", "fill");
    const strokeAttribute = assertStreamAttribute(strokeLayer, "aSegmentIndex", "exact stroke");
    const triangleStrokeAttribute = assertStreamAttribute(
      triangleStrokeLayer,
      "aSegmentIndex",
      "triangle stroke"
    );

    assert.equal(
      rasterLayer.group.children.length,
      1,
      "all page backgrounds must share one mesh and one draw call"
    );
    const pageBackgroundMesh = rasterLayer.group.children[0];
    assert.equal(pageBackgroundMesh.geometry.getAttribute("aCorner").count, 12);
    assert.equal(pageBackgroundMesh.geometry.getIndex()?.count, 18);

    const textVersion = textAttribute.version;
    assert.equal(textLayer.setSelectedTextInstanceIds(new Uint32Array([0])), true);
    assertDirtyRange(textAttribute, textVersion, 1, "text selection");
    const unchangedTextVersion = textAttribute.version;
    assert.equal(textLayer.setSelectedTextInstanceIds(new Uint32Array([0])), false);
    assert.equal(
      textAttribute.version,
      unchangedTextVersion,
      "an unchanged text selection must not schedule another upload"
    );

    const viewState = { cameraCenterX: 0.5, cameraCenterY: 0.5, zoom: 100 };
    const viewport = { width: 10, height: 10 };
    const cullingBounds = { minX: 0.45, minY: 0.45, maxX: 0.55, maxY: 0.55 };

    const fillVersion = fillAttribute.version;
    fillLayer.updateFrame(viewState, viewport, cullingBounds);
    assertDirtyRange(fillAttribute, fillVersion, 1, "fill culling");

    const strokeVersion = strokeAttribute.version;
    strokeLayer.updateFrame(viewState, viewport, cullingBounds);
    assertDirtyRange(strokeAttribute, strokeVersion, 1, "exact-stroke culling");

    const triangleStrokeVersion = triangleStrokeAttribute.version;
    triangleStrokeLayer.updateFrame(viewState, viewport, cullingBounds);
    assertDirtyRange(triangleStrokeAttribute, triangleStrokeVersion, 1, "triangle-stroke culling");
  } finally {
    textLayer.dispose();
    fillLayer.dispose();
    strokeLayer.dispose();
    triangleStrokeLayer.dispose();
    rasterLayer.dispose();
  }

  const sourceNames = (await readdir(path.resolve(repoRootDir, "src")))
    .filter((name) => name.endsWith(".ts"));
  const sourceTexts = await Promise.all(
    sourceNames.map((name) => readFile(path.resolve(repoRootDir, "src", name), "utf8"))
  );
  assert.doesNotMatch(
    sourceTexts.join("\n"),
    /\.setUsage\(THREE\.DynamicDrawUsage\)/,
    "Three layer attributes must not opt into the common renderer's unconditional per-render upload path"
  );

  const threeExampleSource = await readFile(path.resolve(repoRootDir, "src/three-example.ts"), "utf8");
  const webGpuFactorySource = threeExampleSource.slice(
    threeExampleSource.indexOf("async function createWebGpuThreeRenderer"),
    threeExampleSource.indexOf("function stopThreeInternalAnimationLoop")
  );
  assert.match(webGpuFactorySource, /powerPreference:\s*"high-performance"/);
  assert.match(webGpuFactorySource, /outputBufferType:\s*THREE\.UnsignedByteType/);
  assert.doesNotMatch(webGpuFactorySource, /THREE\.HalfFloatType/);
  assert.match(threeExampleSource, /nextRenderer\.autoClear\s*=\s*true/);
  assert.doesNotMatch(
    threeExampleSource,
    /renderer\.clear(?:Depth)?\s*\(/,
    "the on-demand render loop must not add standalone WebGPU clear/output passes"
  );
  assert.match(threeExampleSource, /prepareThreeRendererFrame\(renderer\);/);

  const threeExampleHtml = await readFile(path.resolve(repoRootDir, "three-example.html"), "utf8");
  assert.doesNotMatch(threeExampleHtml, /id="webgpu-output-buffer-select"/);
} finally {
  await viteServer.close();
}

console.log("Three rendering performance regression tests passed");

function assertStreamAttribute(layer, attributeName, context) {
  const attribute = layer.mesh.geometry.getAttribute(attributeName);
  assert.ok(attribute?.isInstancedBufferAttribute, `${context} must use an instanced index attribute`);
  assert.equal(attribute.usage, THREE.StreamDrawUsage, `${context} index data must use StreamDrawUsage`);
  assert.notEqual(
    attribute.usage,
    THREE.DynamicDrawUsage,
    `${context} index data must not be uploaded by Three on every render`
  );
  return attribute;
}

function assertDirtyRange(attribute, previousVersion, expectedCount, context) {
  assert.equal(attribute.version, previousVersion + 1, `${context} must explicitly mark its attribute dirty`);
  assert.ok(
    attribute.updateRanges.some((range) => range.start === 0 && range.count === expectedCount),
    `${context} must retain its partial upload range`
  );
}

function createScene() {
  return {
    pageCount: 1,
    pagesPerRow: 1,
    pageRects: new Float32Array([0, 0, 10, 10]),
    pageTextRanges: new Uint32Array([0, 1]),
    textIndex: null,
    fillPathCount: 1,
    fillSegmentCount: 1,
    fillPathMetaA: new Float32Array([0, 1, 0, 0]),
    fillPathMetaB: new Float32Array([10, 10, 0, 0]),
    fillPathMetaC: new Float32Array(4),
    fillSegmentsA: new Float32Array(4),
    fillSegmentsB: new Float32Array(4),
    segmentCount: 1,
    sourceSegmentCount: 1,
    mergedSegmentCount: 1,
    endpoints: new Float32Array([0, 0, 1, 1]),
    primitiveMeta: new Float32Array(4),
    primitiveBounds: new Float32Array([0, 0, 1, 1]),
    styles: new Float32Array([0.1, 0, 0, 1]),
    maxHalfWidth: 0.1,
    sourceTextCount: 1,
    textInstanceCount: 1,
    textGlyphCount: 0,
    textGlyphSegmentCount: 0,
    textInPageCount: 1,
    textOutOfPageCount: 0,
    textInstanceA: new Float32Array(4),
    textInstanceB: new Float32Array(4),
    textInstanceC: new Float32Array(4),
    textGlyphMetaA: new Float32Array(0),
    textGlyphMetaB: new Float32Array(0),
    textGlyphSegmentsA: new Float32Array(0),
    textGlyphSegmentsB: new Float32Array(0),
    rasterLayers: [],
    rasterLayerWidth: 0,
    rasterLayerHeight: 0,
    rasterLayerData: new Uint8Array(0),
    rasterLayerMatrix: new Float32Array([1, 0, 0, 1, 0, 0]),
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    pageBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }
  };
}
