// The three.js material layers submit one mesh per batch of the shared paint
// schedule. These checks pin the properties that make that safe: the batches
// still cover every canonical instance exactly once, they only ever merge
// paints that are adjacent in the schedule, `renderOrder` reproduces the
// schedule across every layer including images, and a batch that spans several
// clip roots carries the root per instance.

import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import * as THREE from "three";
import { RenderPerformanceProfiler } from "../src/renderPerformance.ts";
import { withThreeRenderPerformance } from "../src/threeRenderPerformance.ts";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) {
    return next(`${specifier}.ts`, context);
  }
  return next(specifier, context);
} });

try {
  const { ThreeVectorDrawRuns } = await import("../src/threeVectorDrawRuns.ts");
  const { getThreeVectorDrawPlan, ThreeVectorDrawPlan } = await import("../src/threeVectorDrawPlan.ts");
  const { applyThreePdfOverlayPaintOrder } = await import("../src/threePdfPaintOrder.ts");
  const { createThreeVectorClipTexture, initializeThreeVectorClip } =
    await import("../src/threeVectorClips.ts");

  const scene = createInterleavedScene();
  const plan = getThreeVectorDrawPlan(scene);
  assert.deepEqual([...plan.order], scene.drawRuns.map((_run, index) => index),
    "the canonical order applies until a pixel scale is known");

  const layers = {
    stroke: createLayer(scene, "stroke", "aSegmentIndex", scene.segmentCount),
    fill: createLayer(scene, "fill", "aFillPathIndex", scene.fillPathCount),
    text: createLayer(scene, "text", "aTextInstanceIndex", scene.textInstanceCount)
  };

  const canonicalMeshes = totalMeshes(layers);
  assert.equal(canonicalMeshes, scene.drawRuns.filter(run => run.kind !== "raster").length,
    "interleaved paints cannot batch in canonical order");

  assert.equal(plan.update(0.01), true, "a pixel scale replans the submission order");
  const profiler = new RenderPerformanceProfiler();
  profiler.start({ gpu: false, maxFrames: 2 });
  profiler.beginFrame();
  withThreeRenderPerformance(profiler, () => { for (const layer of Object.values(layers)) refresh(layer); });
  profiler.endFrame();
  const batchedMeshes = totalMeshes(layers);
  profiler.beginFrame();
  withThreeRenderPerformance(profiler, () => { for (const layer of Object.values(layers)) refresh(layer); });
  profiler.endFrame();
  const capture = profiler.getReport();
  assert.equal(capture.counters["three.batchRebuilds"].total, 3, "all three replanned layers report a rebuild");
  assert.equal(capture.counters["three.batchesCreated"].total, batchedMeshes);
  assert.equal(capture.frameRecords[1].counters["three.batchRebuilds"], 0, "profiling never forces a rebuild");
  assert.ok(capture.cpuSections["three.batchRebuild"]);
  assert.ok(capture.cpuSections["three.batchUpdate"]);
  profiler.dispose();
  assert.ok(batchedMeshes < canonicalMeshes,
    `the schedule must reduce the submitted draws (${batchedMeshes} of ${canonicalMeshes})`);

  // Every canonical instance still renders, exactly once, in schedule order.
  for (const [kind, layer] of Object.entries(layers)) {
    const drawn = [];
    for (const mesh of orderedMeshes(layer)) {
      const ids = mesh.geometry.getAttribute(layer.attribute);
      for (let i = 0; i < mesh.geometry.instanceCount; i++) drawn.push(ids.getX(i));
    }
    assert.deepEqual([...drawn].sort((a, b) => a - b), expectedInstances(scene, kind),
      `${kind} batches must cover every canonical instance exactly once`);
  }

  // A batch may only merge paints the schedule lists next to each other, so the
  // positions a mesh covers form one contiguous, non-overlapping span.
  const spans = [];
  for (const [kind, layer] of Object.entries(layers)) {
    for (const mesh of orderedMeshes(layer)) {
      const positions = mesh.userData.heprDrawRunIndices.map(index => plan.positions[index]);
      const first = Math.min(...positions);
      const last = Math.max(...positions);
      assert.equal(last - first + 1, positions.length, `${kind} batch positions must be contiguous`);
      assert.deepEqual(positions, [...positions].sort((a, b) => a - b),
        `${kind} batch must keep the scheduled order`);
      spans.push({ first, last, renderOrder: mesh.renderOrder, kind });
    }
  }
  spans.sort((left, right) => left.first - right.first);
  for (let index = 1; index < spans.length; index++) {
    assert.ok(spans[index - 1].last < spans[index].first, "batches must not overlap");
    assert.ok(spans[index - 1].renderOrder < spans[index].renderOrder,
      "renderOrder must reproduce the scheduled order");
  }

  // Images take their order from the same schedule, so they stay interleaved
  // with the vector paints that were moved around them.
  const rasterGroup = new THREE.Group();
  const rasterRuns = scene.drawRuns.flatMap((run, index) => run.kind === "raster" ? [{ run, index }] : []);
  const rasterMeshes = rasterRuns.map(({ run }) => {
    const mesh = new THREE.Mesh();
    mesh.userData.heprDrawRun = { kind: "raster", first: run.first, count: run.count };
    rasterGroup.add(mesh);
    return mesh;
  });
  applyThreePdfOverlayPaintOrder(scene, rasterGroup, [], plan.positions);
  rasterRuns.forEach(({ index }, position) => {
    const neighbours = spans.filter(span => span.last < plan.positions[index]);
    const before = Math.max(...neighbours.map(span => span.renderOrder), -Infinity);
    const after = Math.min(...spans.filter(span => span.first > plan.positions[index])
      .map(span => span.renderOrder), Infinity);
    assert.ok(before < rasterMeshes[position].renderOrder && rasterMeshes[position].renderOrder < after,
      "an image must render between the batches the schedule puts around it");
  });

  // Clip roots never end a batch; a batch that spans several carries them per instance.
  let instanceClipped = 0;
  for (const [kind, layer] of Object.entries(layers)) {
    for (const mesh of orderedMeshes(layer)) {
      const clips = mesh.geometry.getAttribute("aVectorClipIndex");
      const roots = new Set(mesh.userData.heprDrawRunIndices.map(index => scene.drawRuns[index].clipIndex ?? -1));
      if (roots.size <= 1) {
        assert.equal(clips, undefined, `${kind} batch under one clip root must not carry per-instance roots`);
        continue;
      }
      instanceClipped++;
      assert.equal(mesh.material.uniforms.uVectorClipIndex.value, -2,
        `${kind} batch spanning clip roots must read them from its instance stream`);
      const ids = mesh.geometry.getAttribute(layer.attribute);
      for (let i = 0; i < mesh.geometry.instanceCount; i++) {
        assert.equal(clips.getX(i), clipRootOf(scene, kind, ids.getX(i)) + 1,
          `${kind} instance must carry its own clip root, offset so zero means unclipped`);
      }
    }
  }
  assert.ok(instanceClipped > 0, "the fixture must exercise a batch that spans clip roots");

  // Replanning replaces the batch meshes. Their geometries borrow the layer's
  // corner and index buffers, and three frees the GPU buffer of every attribute
  // a disposed geometry still lists, so they have to give those back first.
  const replaced = Object.values(layers).flatMap(layer => layer.mesh.children.map(mesh => mesh.geometry));
  // A pixel scale coarse enough to make every paint overlap leaves the schedule
  // far less room to reorder, so it always produces a different set of batches.
  assert.equal(plan.update(100), true, "a coarse pixel scale replans the submission order");
  assert.equal(plan.paintOrderApproximated, false,
    "a scene this small keeps exact margins: holding them would win back no draws");
  for (const layer of Object.values(layers)) refresh(layer);
  assert.ok(totalMeshes(layers) > batchedMeshes, "overlapping paints must batch less aggressively");
  for (const geometry of replaced) {
    assert.equal(geometry.index, null, "a replaced batch must release the borrowed index buffer");
    assert.equal(geometry.getAttribute("aCorner"), undefined,
      "a replaced batch must release the borrowed vertex buffers");
  }
  for (const [kind, layer] of Object.entries(layers)) {
    assert.ok(layer.mesh.geometry.getAttribute("aCorner"), `${kind} layer keeps its own vertex buffer`);
    assert.ok(layer.mesh.geometry.index, `${kind} layer keeps its own index buffer`);
    assert.ok(layer.mesh.children.length > 0, `${kind} layer keeps its batches after replanning`);
  }

  // A layer built after the schedule already exists — a second object over the
  // same scene, such as after a renderer backend switch — inherits it instead of
  // starting from the canonical order.
  plan.update(0.01);
  const inherited = createLayer(scene, "fill", "aFillPathIndex", scene.fillPathCount);
  assert.ok(inherited.mesh.children.length < scene.drawRuns.filter(run => run.kind === "fill").length,
    "a layer built later must inherit the existing schedule");
  inherited.runs.dispose();
  inherited.clipTexture.dispose();

  for (const layer of Object.values(layers)) {
    layer.runs.dispose();
    assert.equal(layer.mesh.children.length, 0, "disposal must detach every batch mesh");
    layer.clipTexture.dispose();
  }

  // An effect constrains batching to its own source-over span; it does not
  // force every unrelated paint back to an individual submission.
  const composited = createInterleavedScene();
  const split = Math.floor(composited.drawRuns.length / 2);
  const group = children => ({ kind: "group", isolated: true, knockout: false, alpha: 0.5,
    blendMode: "Normal", children });
  composited.paintGraph = { roots: [group(composited.drawRuns.slice(0, split).map((_run, runIndex) => ({ kind: "draw", runIndex }))),
    group(composited.drawRuns.slice(split).map((_run, index) => ({ kind: "draw", runIndex: split + index })))] };
  const firstPlan = new ThreeVectorDrawPlan(composited), secondPlan = new ThreeVectorDrawPlan(composited);
  const compositedLayers = {
    stroke: createLayer(composited, "stroke", "aSegmentIndex", composited.segmentCount, firstPlan),
    fill: createLayer(composited, "fill", "aFillPathIndex", composited.fillPathCount, firstPlan),
    text: createLayer(composited, "text", "aTextInstanceIndex", composited.textInstanceCount, firstPlan)
  };
  const before = totalMeshes(compositedLayers);
  firstPlan.update(0.01);
  for (const layer of Object.values(compositedLayers)) refresh(layer);
  assert.ok(totalMeshes(compositedLayers) < before, "ordinary paints inside effect spans still batch");
  assert.equal(secondPlan.version, 0, "two objects over one scene keep independent view schedules");
  assert.deepEqual(secondPlan.order, composited.drawRuns.map((_run, index) => index));
  for (const layer of Object.values(compositedLayers)) {
    for (const mesh of layer.mesh.children) {
      assert.equal(new Set(mesh.userData.heprDrawRunIndices.map(index => firstPlan.segments[index])).size, 1,
        "no mesh crosses a compositing boundary");
      assert.equal(mesh.userData.heprDrawRanges.length, mesh.userData.heprDrawRunIndices.length,
        "every canonical range remains available to compositor subset lookup");
    }
    layer.runs.dispose(); layer.clipTexture.dispose();
  }
  const reversed = { ...composited, paintGraph: { roots: [group(composited.drawRuns.map((_run, index) =>
    ({ kind: "draw", runIndex: composited.drawRuns.length - 1 - index })))] } };
  assert.equal(new ThreeVectorDrawPlan(reversed).update(0.01), false,
    "an arbitrary graph visiting source paints backwards keeps its graph order");

  function createLayer(sceneData, kind, attribute, count, drawPlan) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("aCorner", new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
    const ids = new THREE.InstancedBufferAttribute(Float32Array.from({ length: count }, (_value, index) => index), 1);
    ids.setUsage(THREE.StreamDrawUsage);
    geometry.setAttribute(attribute, ids);
    geometry.instanceCount = count;
    const material = new THREE.RawShaderMaterial();
    const clipTexture = createThreeVectorClipTexture(sceneData);
    initializeThreeVectorClip(material, clipTexture);
    const mesh = new THREE.Mesh(geometry, material);
    const runs = ThreeVectorDrawRuns.create(sceneData, kind, mesh, attribute, drawPlan);
    assert.ok(runs, `${kind} layer must build ordered draw runs`);
    return { mesh, runs, attribute, ids, count, clipTexture };
  }

  function refresh(layer) {
    layer.runs.beginUpdate();
    layer.mesh.geometry.instanceCount = layer.count;
    layer.runs.finishUpdate();
  }

  function orderedMeshes(layer) {
    return [...layer.mesh.children].sort((left, right) => left.renderOrder - right.renderOrder);
  }

  function totalMeshes(all) {
    return Object.values(all).reduce((count, layer) => count + layer.mesh.children.length, 0);
  }
} finally {
  hooks.deregister();
}

console.log("Three vector draw batching tests passed");

function expectedInstances(scene, kind) {
  const counts = { stroke: scene.segmentCount, fill: scene.fillPathCount, text: scene.textInstanceCount };
  return Array.from({ length: counts[kind] }, (_value, index) => index);
}

function clipRootOf(scene, kind, instance) {
  for (const run of scene.drawRuns) {
    if (run.kind === kind && instance >= run.first && instance < run.first + run.count) return run.clipIndex ?? -1;
  }
  throw new Error(`No draw run covers ${kind} instance ${instance}.`);
}

/**
 * Four well-separated cells of interleaved stroke/fill/text paints plus two
 * images. Nothing overlaps across cells, so the schedule is free to group the
 * paints by kind, and the two clip roots make one batch span both.
 */
function createInterleavedScene() {
  const cells = 4;
  const perCell = 2;
  const drawRuns = [];
  const endpoints = [];
  const styles = [];
  const primitiveBounds = [];
  const fillA = [];
  const fillB = [];
  const fillC = [];
  const textA = [];
  const textB = [];
  const textC = [];
  const pushStroke = (x, y) => {
    endpoints.push(x, y, x + 1, y + 1);
    styles.push(0.05, 0, 0, 0);
    primitiveBounds.push(x, y, x + 1, y + 1);
  };
  const pushFill = (x, y) => {
    fillA.push(0, 1, 0, 0);
    fillB.push(x, y, 0, 0);
    fillC.push(x + 1, y + 1, 0, 0);
  };
  const pushText = (x, y) => {
    textA.push(x, y, 1, 0);
    textB.push(0, 0, 0, 0);
    textC.push(0, 0, 0, 1);
  };
  let strokes = 0;
  let fills = 0;
  let texts = 0;
  for (let cell = 0; cell < cells; cell++) {
    const x = cell * 100;
    const y = 0;
    // Interleave the kinds so nothing batches without reordering, and alternate
    // the clip root so batching across cells has to carry it per instance.
    const clipIndex = cell % 2;
    for (let item = 0; item < perCell; item++) pushStroke(x + item * 2, y);
    drawRuns.push({ kind: "stroke", first: strokes, count: perCell, clipIndex });
    strokes += perCell;
    for (let item = 0; item < perCell; item++) pushFill(x + item * 2, y + 10);
    drawRuns.push({ kind: "fill", first: fills, count: perCell, clipIndex });
    fills += perCell;
    for (let item = 0; item < perCell; item++) pushText(x + item * 2, y + 20);
    drawRuns.push({ kind: "text", first: texts, count: perCell, clipIndex });
    texts += perCell;
  }
  // Two images, each isolated in its own cell so the schedule may move vector
  // paints around them without changing what covers what.
  const rasterLayers = [0, 1].map(index => ({
    width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]),
    matrix: new Float32Array([1, 0, 0, 1, index * 100, 40]), pageIndex: 0, paintOrder: index
  }));
  drawRuns.splice(3, 0, { kind: "raster", first: 0, count: 1 });
  drawRuns.splice(8, 0, { kind: "raster", first: 1, count: 1 });

  const clip = (minX, minY, maxX, maxY) => ({ parent: -1, fillRule: 0, edges: new Float32Array([
    minX, minY, maxX, minY, maxX, minY, maxX, maxY,
    maxX, maxY, minX, maxY, minX, maxY, minX, minY]) });

  return {
    pageCount: 1,
    pagesPerRow: 1,
    pageRects: new Float32Array([0, 0, 400, 60]),
    pageTextRanges: new Uint32Array([0, texts]),
    textIndex: null,
    fillPathCount: fills,
    fillSegmentCount: 0,
    fillPathMetaA: Float32Array.from(fillA),
    fillPathMetaB: Float32Array.from(fillB),
    fillPathMetaC: Float32Array.from(fillC),
    fillSegmentsA: new Float32Array(0),
    fillSegmentsB: new Float32Array(0),
    segmentCount: strokes,
    sourceSegmentCount: strokes,
    mergedSegmentCount: strokes,
    endpoints: Float32Array.from(endpoints),
    primitiveMeta: new Float32Array(strokes * 4),
    primitiveBounds: Float32Array.from(primitiveBounds),
    styles: Float32Array.from(styles),
    maxHalfWidth: 0.05,
    sourceTextCount: texts,
    textInstanceCount: texts,
    textGlyphCount: 0,
    textGlyphSegmentCount: 0,
    textInPageCount: texts,
    textOutOfPageCount: 0,
    textInstanceA: Float32Array.from(textA),
    textInstanceB: Float32Array.from(textB),
    textInstanceC: Float32Array.from(textC),
    textGlyphMetaA: new Float32Array(0),
    textGlyphMetaB: new Float32Array(0),
    textGlyphSegmentsA: new Float32Array(0),
    textGlyphSegmentsB: new Float32Array(0),
    rasterLayers,
    rasterLayerWidth: 0,
    rasterLayerHeight: 0,
    rasterLayerData: new Uint8Array(0),
    rasterLayerMatrix: new Float32Array([1, 0, 0, 1, 0, 0]),
    clipPaths: [clip(-10, -10, 410, 70), clip(-5, -5, 405, 65)],
    drawRuns,
    bounds: { minX: 0, minY: 0, maxX: 400, maxY: 60 },
    pageBounds: { minX: 0, minY: 0, maxX: 400, maxY: 60 }
  };
}
