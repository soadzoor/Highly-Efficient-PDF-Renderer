import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) {
    return next(`${specifier}.ts`, context);
  }
  return next(specifier, context);
} });

try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { validateVectorDrawRuns, defaultVectorDrawRuns } = await import("../src/vectorDrawOrder.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");
  const { initializeThreeVectorClip, createThreeVectorClipTexture } = await import("../src/threeVectorClips.ts");
  const { ThreeVectorDrawRuns, vectorDrawRunRenderOrder } = await import("../src/threeVectorDrawRuns.ts");
  const { applyThreePdfOverlayPaintOrder } = await import("../src/threePdfPaintOrder.ts");
  const { HepArchive } = await import("../src/hepContainer.ts");

  const session = await openPdf({ kind: "bytes", bytes: fixture() }, {
    missingFontResolver: () => ({ sfntBytes: buildTinySfnt(), identifier: "synthetic-paint-order" })
  });
  let scene;
  try {
    scene = await session.compileVectorPage(0, { vectorFallback: "error", preserveDrawingOrder: true });
    assert.equal(scene.textInstanceCount, 1);
    assert.equal(scene.segmentCount, 3, "a repeated stroke after intervening paint must survive culling");
    assert.equal(scene.rasterLayers.length, 1, "only the source image needs pixels");
    assert.deepEqual(scene.drawRuns, [
      { kind: "fill", first: 0, count: 1 },
      { kind: "text", first: 0, count: 1 },
      { kind: "stroke", first: 2, count: 1, clipIndex: 0 },
      { kind: "raster", first: 0, count: 1, clipIndex: 0 },
      { kind: "fill", first: 2, count: 1, clipIndex: 0 },
      { kind: "stroke", first: 0, count: 1 },
      { kind: "fill", first: 1, count: 1 },
      { kind: "stroke", first: 1, count: 1 }
    ]);
    assert(!session.getDiagnostics().some(d => d.code === "page-raster-fallback"));
  } finally { await session.close(); }

  validateVectorDrawRuns(scene);
  const grid = composeVectorScenesInGrid([scene, scene], 2);
  validateVectorDrawRuns(grid);
  assert.deepEqual(grid.drawRuns.slice(scene.drawRuns.length), scene.drawRuns.map(run => ({ ...run,
    ...(run.clipIndex === undefined ? {} : { clipIndex: run.clipIndex + scene.clipPaths.length }),
    first: run.first + ({ fill: scene.fillPathCount, stroke: scene.segmentCount,
      text: scene.textInstanceCount, raster: scene.rasterLayers.length })[run.kind] })));
  const coarse = { ...scene, drawRuns: undefined, clipPaths: undefined };
  const mixed = composeVectorScenesInGrid([coarse, scene], 2);
  assert.deepEqual(mixed.drawRuns.slice(0, defaultVectorDrawRuns(coarse).length), defaultVectorDrawRuns(coarse));
  validateVectorDrawRuns(mixed);
  const legacyRaster = { ...coarse, rasterLayers: [] };
  validateVectorDrawRuns(composeVectorScenesInGrid([legacyRaster, scene], 2));
  assert.throws(() => validateVectorDrawRuns({ ...scene, drawRuns: scene.drawRuns.slice(1) }), /cover|omit/);
  assert.throws(() => validateVectorDrawRuns({ ...scene, drawRuns: [...scene.drawRuns, scene.drawRuns[0]] }), /overlap/);
  assert.throws(() => validateVectorDrawRuns({ ...scene, drawRuns: [{ kind: "fill", first: -1, count: 1 }] }), /outside/);

  // Small synthetic in-memory archive: order must survive optimization and persistence.
  const hep = await buildHep(grid, { encodeRasterImages: false, compression: "store" });
  const bytes = await hep.arrayBuffer();
  const restored = await loadSceneFromHep(bytes);
  assert.deepEqual(restored.drawRuns, grid.drawRuns);
  assert.deepEqual(restored.clipPaths, grid.clipPaths);
  // v8 keeps the scene structures in their own sections; the manifest carries
  // only the counts a reader checks the decoded sections against.
  const { SCENE_CLIP_PATHS_PATH, SCENE_DRAW_RUNS_PATH, SCENE_PAINT_GRAPH_PATH, encodeSceneDrawRuns } =
    await import("../src/hepSceneSections.ts");
  const rebuild = async mutate => {
    const archive = await HepArchive.loadAsync(bytes);
    const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
    await mutate(manifest, archive);
    archive.file("manifest.json", JSON.stringify(manifest));
    return archive.generateAsync({ type: "arraybuffer", compression: "STORE" });
  };
  const pristine = JSON.parse(await (await HepArchive.loadAsync(bytes)).file("manifest.json").async("string"));
  for (const [corrupt, pattern] of [
    [manifest => { manifest.scene.drawRuns.count += 1; }, /draw runs do not match/],
    [manifest => { manifest.scene.clipPaths.count += 1; }, /clip paths do not match/],
    [manifest => { manifest.scene.clipPaths.edgeCount += 1; }, /clip paths do not match/],
    [manifest => { manifest.scene.clipPaths.file = "geometry/elsewhere.d512"; }, /does not name/],
    [manifest => { manifest.scene.drawRuns.count = -1; }, /Invalid scene draw runs count/],
    ...(pristine.scene.paintGraph
      ? [[manifest => { manifest.scene.paintGraph.rootCount += 1; }, /paint graph does not match/]]
      : [])
  ]) {
    await assert.rejects(loadSceneFromHep(await rebuild(corrupt)), pattern);
  }
  // A truncated section must be rejected rather than silently decoded short.
  for (const section of [SCENE_CLIP_PATHS_PATH, SCENE_DRAW_RUNS_PATH, SCENE_PAINT_GRAPH_PATH].filter(
    name => pristine.scene.paintGraph || name !== SCENE_PAINT_GRAPH_PATH)) {
    await assert.rejects(loadSceneFromHep(await rebuild(async (_manifest, archive) => {
      const original = await archive.file(section).async("uint8array");
      archive.file(section, original.subarray(0, original.length - 1));
    })), error => error instanceof Error);
  }
  // A draw run may not reference a clip path that does not exist.
  await assert.rejects(loadSceneFromHep(await rebuild(async (_manifest, archive) => {
    archive.file(SCENE_DRAW_RUNS_PATH, encodeSceneDrawRuns(
      grid.drawRuns.map((run, index) => index === 0 ? { ...run, clipIndex: grid.clipPaths.length } : run)));
  })), /clip/);

  // Exercise production dispatch without a browser or GPU context.
  const expected = scene.drawRuns.map(run => [run.kind, run.first, run.count]);
  const glRenderer = Object.create(WebGlFloorplanRenderer.prototype);
  Object.assign(glRenderer, { scene, rasterRenderingEnabled: true, fillRenderingEnabled: true,
    strokeRenderingEnabled: true, textRenderingEnabled: true });
  let calls = [];
  const glClipRoots = [];
  glRenderer.drawPageBackgrounds = () => calls.push(["background"]);
  glRenderer.drawFilledPaths = (_w, _h, _x, _y, _z, first, count) => { glClipRoots.push(glRenderer.vectorClipIndex); calls.push(["fill", first, count]); };
  glRenderer.drawVisibleSegments = (_w, _h, _x, _y, _z, range) => {
    glClipRoots.push(glRenderer.vectorClipIndex); calls.push(["stroke", range.start, range.count]); return range.count;
  };
  glRenderer.drawTextInstances = (_w, _h, _x, _y, _z, _lod, range) => { glClipRoots.push(glRenderer.vectorClipIndex); calls.push(["text", range.start, range.count]); };
  glRenderer.drawRasterLayerAtIndex = index => { glClipRoots.push(glRenderer.vectorClipIndex); calls.push(["raster", index, 1]); };
  assert.equal(glRenderer.drawSourceOrderedContent(64, 64, 32, 32, 1), scene.segmentCount);
  assert.deepEqual(calls, [["background"], ...expected]);
  assert.deepEqual(glClipRoots, scene.drawRuns.map(run => run.clipIndex ?? -1));
  assert.equal(glRenderer.vectorClipIndex, -1);
  assert.equal(glRenderer.shouldUseVectorMinifyPath(), false);
  assert.equal(glRenderer.shouldUsePanCache(true), false);
  glRenderer.textRenderingEnabled = false;
  calls = [];
  glRenderer.drawSourceOrderedContent(64, 64, 32, 32, 1);
  assert.deepEqual(calls, [["background"], ...expected.filter(run => run[0] !== "text")]);

  // WebGL's instance-attribute offsets must address each retained range, not
  // restart at instance zero on every draw.
  const lowLevel = Object.create(WebGlFloorplanRenderer.prototype);
  const attributes = [], draws = [];
  lowLevel.gl = new Proxy({
    vertexAttribPointer: (...args) => attributes.push(args),
    drawArraysInstanced: (...args) => draws.push(args)
  }, { get(target, key) { return target[key] ?? (() => {}); } });
  Object.assign(lowLevel, { scene, fillPathCount: 3, textInstanceCount: 10, visibleTextRanges: [],
    vectorOverrideColor: [0, 0, 0], vectorOverrideOpacity: 0 });
  lowLevel.bindVectorClip = () => {};
  lowLevel.drawFilledPaths(64, 64, 32, 32, 1, 2, 1);
  lowLevel.drawStrokeInstances({}, {}, 2, 64, 64, 32, 32, 1, 3);
  lowLevel.drawTextInstances(64, 64, 32, 32, 1, undefined, { start: 5, count: 2 });
  assert.deepEqual(attributes.map(args => [args[0], args[5]]), [[3, 8], [1, 12], [2, 20]]);
  assert.deepEqual(draws.map(args => args[3]), [1, 2, 2]);

  const gpuRenderer = Object.create(WebGpuFloorplanRenderer.prototype);
  Object.assign(gpuRenderer, { scene, rasterRenderingEnabled: true, fillRenderingEnabled: true,
    strokeRenderingEnabled: true, textRenderingEnabled: true, fillPipeline: "fill", strokePipeline: "stroke",
    textPipeline: "text", rasterPipeline: "raster", fillBindGroup: "fill", strokeBindGroupAll: "all-strokes",
    textBindGroup: "text", vectorClipBindGroups: ["instanced", "unclipped", "clip-0"], rasterLayerResources: [{ bindGroup: "image" }] });
  calls = [];
  gpuRenderer.drawPageBackgroundContentIntoPass = () => calls.push(["background"]);
  let pipeline;
  const gpuClipRoots = [];
  const pass = { setPipeline(value) { pipeline = value; }, setBindGroup(group, value) { if (group === 1) gpuClipRoots.push(value); },
    draw(vertices, count, firstVertex, firstInstance) {
      assert.equal(vertices, 4); assert.equal(firstVertex, 0);
      calls.push([pipeline, firstInstance, count]);
    } };
  assert.equal(gpuRenderer.drawSourceOrderedContentIntoPass(pass), scene.segmentCount);
  assert.deepEqual(gpuClipRoots, scene.drawRuns.map(run => run.clipIndex === undefined ? "unclipped" : `clip-${run.clipIndex}`));
  assert.equal(gpuRenderer.vectorClipIndex, -1);
  assert.deepEqual(calls, [["background"], ...expected]);

  // Three material batches retain source IDs when the existing culler selects a subset.
  const geometry = new THREE.InstancedBufferGeometry();
  const ids = new THREE.InstancedBufferAttribute(Float32Array.from([0, 1, 2]), 1);
  geometry.setAttribute("aSegmentIndex", ids);
  geometry.instanceCount = 3;
  const material = new THREE.RawShaderMaterial();
  const clipTexture = createThreeVectorClipTexture(scene);
  initializeThreeVectorClip(material, clipTexture);
  const mesh = new THREE.Mesh(geometry, material);
  const ordered = ThreeVectorDrawRuns.create(scene, "stroke", mesh, "aSegmentIndex");
  assert.equal(mesh.geometry.instanceCount, 0);
  assert.deepEqual(mesh.children.map(child => child.geometry.getAttribute("aSegmentIndex").getX(0)), [2, 0, 1]);
  const rasterGroup = new THREE.Group();
  rasterGroup.add(new THREE.Mesh(), new THREE.Mesh());
  applyThreePdfOverlayPaintOrder(scene, rasterGroup, []);
  assert(mesh.children[0].renderOrder < rasterGroup.children[1].renderOrder);
  assert(rasterGroup.children[1].renderOrder < mesh.children[1].renderOrder);

  // A grid merges every page background into one tagged mesh, so image meshes
  // must be found through their canonical draw run rather than by counting one
  // background child per page.
  const gridGroup = new THREE.Group();
  const gridBackground = new THREE.Mesh();
  gridBackground.userData.heprPageBackground = true;
  gridGroup.add(gridBackground);
  const gridImages = grid.rasterLayers.map((_layer, first) => {
    const image = new THREE.Mesh();
    image.userData.heprDrawRun = { kind: "raster", first, count: 1 };
    gridGroup.add(image);
    return image;
  });
  applyThreePdfOverlayPaintOrder(grid, gridGroup, []);
  const gridRasterRuns = grid.drawRuns.flatMap((run, index) => run.kind === "raster" ? [index] : []);
  assert.equal(gridImages.length, 2, "both composed pages contribute an image");
  assert.equal(gridRasterRuns.length, 2, "each page keeps its own image run");
  assert.deepEqual(gridImages.map(image => image.renderOrder),
    gridRasterRuns.map(index => vectorDrawRunRenderOrder(index, grid.drawRuns.length)),
    "each image mesh takes the paint order of its own draw run");
  assert.equal(gridBackground.renderOrder, 0,
    "the merged page-background mesh must not be ordered as an image layer");
  ordered.beginUpdate();
  ids.setX(0, 1); ids.needsUpdate = true;
  geometry.instanceCount = 1;
  ordered.finishUpdate();
  assert.deepEqual(mesh.children.map(child => child.geometry.instanceCount), [0, 0, 1]);
  ordered.beginUpdate(); ordered.finishUpdate();
  assert.deepEqual(mesh.children.map(child => child.geometry.instanceCount), [0, 0, 1], "unchanged culling is stable");
  ordered.setEnabled(false);
  assert(mesh.children.every(child => !child.visible));
  assert.equal(ordered.getRenderedCount(), 0);
  ordered.dispose(); geometry.dispose(); material.dispose(); clipTexture.dispose();
  assert.equal(mesh.children.length, 0);

  // Construct the production Three layers for both backends without a renderer/server.
  const { ThreeMaterialFillLayer } = await import("../src/threeMaterialFillLayer.ts");
  const { ThreeMaterialStrokeLayer } = await import("../src/threeMaterialStrokeLayer.ts");
  const { ThreeMaterialTextLayer } = await import("../src/threeMaterialTextLayer.ts");
  const { ThreeMaterialRasterLayer } = await import("../src/threeMaterialRasterLayer.ts");
  const materialScene = { ...scene, drawRuns: scene.drawRuns.map(run => ({ ...run, clipIndex: 0 })) };
  for (const materialBackend of ["webgl", "webgpu"]) {
    const options = { materialBackend, vectorOverride: [0, 0, 0, 0], pageBackground: [1, 1, 1, 1],
      strokeCurveEnabled: true, textVectorOnly: true };
    const layers = [new ThreeMaterialFillLayer(materialScene, options), new ThreeMaterialStrokeLayer(materialScene, options),
      new ThreeMaterialTextLayer(materialScene, options), new ThreeMaterialRasterLayer(materialScene, options)];
    try {
      for (const layer of layers.slice(0, 3)) {
        assert(layer.mesh.children.length > 0);
        for (const child of layer.mesh.children) {
          assert.notEqual(child.material, layer.mesh.material);
          if (materialBackend === "webgl") assert.equal(child.material.uniforms.uVectorClipIndex.value, 0);
          else assert.notEqual(child.material.fragmentNode, layer.mesh.material.fragmentNode);
        }
      }
      const imageMaterial = layers[3].group.children.at(-1).material;
      if (materialBackend === "webgl") assert.equal(imageMaterial.uniforms.uVectorClipIndex.value, 0);
      else assert(imageMaterial.fragmentNode);
    } finally { layers.forEach(layer => layer.dispose()); }
  }

  // A nested transparency subtree is lowered once, without leaking partial retries.
  const compositeSession = await openPdf({ kind: "bytes", bytes: fixture(true) }, {
    missingFontResolver: () => ({ sfntBytes: buildTinySfnt(), identifier: "synthetic-composite-order" })
  });
  try {
    const composite = await compositeSession.compileVectorPage(0, { preserveDrawingOrder: true, vectorFallback: "error" });
    assert.equal(composite.fillPathCount, 4, "caller and child fills remain canonical");
    assert.equal(composite.segmentCount, 3, "the child stroke appears exactly once");
    assert.equal(composite.textInstanceCount, 1);
    assert.equal(composite.rasterLayers.length, 1, "only the original image remains raster");
    assert.ok(composite.paintGraph, "compositing boundaries are retained");
    validateVectorDrawRuns(composite);
  } finally { await compositeSession.close(); }
  console.log("Vector draw order survives Forms, culling, rendering, grids and HEP persistence");
} finally { hooks.deregister(); }

function fixture(nestedComposite = false) {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 64 64] /Resources << /XObject << /Fm 5 0 R >> /Font << /F1 7 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "1 0 0 rg 0 0 30 30 re f BT /F1 8 Tf 2 2 Td (A) Tj ET /Fm Do 0 0 1 RG 2 w 1 1 m 22 1 l S 0 1 0 rg 0 0 4 4 re f 1 1 m 22 1 l S") },
    { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 40 40] /Resources << /XObject << /Im 6 0 R /Nested 8 0 R >> >>",
      "0 0 1 RG 2 w 1 1 m 22 1 l S q 12 0 0 12 0 0 cm /Im Do Q 1 1 8 8 re f" + (nestedComposite ? " /Nested Do" : "")) },
    { number: 6, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8", new Uint8Array([0, 255, 255])) },
    { number: 7, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>" },
    { number: 8, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 40 40] /Group << /S /Transparency /I true >> /Resources << >>", "0 0 1 rg 0 0 4 4 re f") }
  ] });
}
