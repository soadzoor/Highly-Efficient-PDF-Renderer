import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });
try {
  const { WebGlFloorplanRenderer: Renderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { VectorOrderedBatches } = await import("../src/vectorOrderedBatches.ts");
  const { RenderPerformanceProfiler } = await import("../src/renderPerformance.ts");
  const makeScene = (count, height = 2) => {
    const drawRuns = Array.from({ length: count }, (_, first) => ({ kind: "raster", first, count: 1 }));
    return Object.assign(createEmptyVectorScene(), {
      rasterLayers: Array.from({ length: count }, (_, i) => image(i, height)), drawRuns,
      paintGraph: { roots: [group(drawRuns.map((_, runIndex) => ({ kind: "draw", runIndex })))] }
    });
  };
  const scene = makeScene(3204), canonical = structuredClone(scene);
  const { renderer, mock } = fixture(Renderer, scene, VectorOrderedBatches);
  const profile = new RenderPerformanceProfiler({ now: () => 0 });
  renderer.performanceProfiler = profile;
  profile.start({ gpu: false, maxFrames: 1 }); profile.beginFrame();
  renderer.drawSourceOrderedContent(1920, 945, 50, 40, 0.126);
  profile.endFrame();
  const report = profile.getReport();
  assert.equal(mock.paints.filter(p => p.label === "rasterAtlas").length, 7);
  assert.equal(report.counters.rasterAtlasBatches.total, 7);
  assert.equal(report.counters.rasterInstances.total, 3204);
  assert.equal(report.counters.drawBatches.total, 7);
  assert.equal(renderer.frameDrawCalls, mock.paints.length);
  assert.deepEqual(mock.paints.filter(p => p.label === "rasterAtlas").map(p => p.count), [512, 512, 512, 512, 512, 512, 132]);
  assert.deepEqual(scene, canonical, "render-only optimization preserves the document");
  mock.clear(); renderer.frameDrawCalls = 0;
  renderer.drawSourceOrderedContent(1920, 945, 55, 42, 0.126);
  assert.equal(mock.calls.filter(c => ["texImage2D", "bufferData"].includes(c[0])).length, 0,
    "camera motion reuses atlas storage and instance data");
  assert(mock.paints.filter(p => p.label === "rasterAtlas").every(p => p.uniforms.get("uCameraCenter")[0] === 55));
  renderer.localToClipRenderingEnabled = true;
  renderer.localToClipMatrix.set([1, 0, 0, 0.1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  mock.clear(); renderer.drawSourceOrderedContent(1920, 945, 55, 42, 0.126);
  assert(mock.paints.filter(p => p.label === "rasterAtlas").every(p =>
    p.uniforms.get("uUseLocalToClip") === 1 && p.uniforms.get("uLocalToClip")[0] === false &&
    p.uniforms.get("uLocalToClip")[1] === renderer.localToClipMatrix), "projected draws use the live local-to-clip matrix");
  renderer.localToClipRenderingEnabled = false;

  // The real capture had 3142 standalone draws and 62 atlas singletons, with
  // no saved draws. Exercise that eligibility pattern, changing clip roots on
  // every image, instead of assuming all images fit one compatible atlas run.
  const mixed = makeScene(3204);
  for (let i = 0; i < 3142; i++) mixed.rasterLayers[i] = largeImage(i);
  mixed.clipPaths = Array.from({ length: 13 }, (_, i) => rectangle(i));
  mixed.drawRuns.forEach((run, i) => { run.clipIndex = i % 13; });
  mixed.paintGraph.roots = [group(mixed.drawRuns.slice(0, 3142).map((_, runIndex) => ({ kind: "draw", runIndex }))),
    ...mixed.drawRuns.slice(3142).map((_, i) => group([{ kind: "draw", runIndex: 3142 + i }], 0.5))];
  const mixedSource = structuredClone(mixed), reuse = fixture(Renderer, mixed, VectorOrderedBatches);
  const mixedProfile = new RenderPerformanceProfiler({ now: () => 0 });
  reuse.renderer.performanceProfiler = mixedProfile;
  mixedProfile.start({ gpu: false, maxFrames: 1 }); mixedProfile.beginFrame();
  reuse.renderer.drawSourceOrderedContent(1920, 945, 50, 40, 0.126); mixedProfile.endFrame();
  const mixedReport = mixedProfile.getReport(), texturePaints = reuse.mock.paints.filter(p => p.label === "rasterTextureBatch");
  assert.equal(texturePaints.length, 393, "3142 non-atlas images share eight-texture draws despite different clip roots");
  assert.equal(mixedReport.counters.rasterTextureBatchInstances.total, 3142);
  assert.equal(mixedReport.counters.rasterInstances.total, 3204);
  assert.equal(mixedReport.counters.rasterAtlasBatches.total, 62, "folded singleton scopes stay separate");
  assert.equal(mixedReport.counters.rasterStandaloneDraws?.total ?? 0, 0);
  let submitted = 0;
  for (const paint of texturePaints) for (let i = 0; i < paint.count; i++, submitted++) {
    const instance = paint.instances.slice(i * 12, i * 12 + 12);
    assert.deepEqual(instance.slice(0, 6), mixed.rasterLayers[submitted].matrix, "overlapping images retain their exact paint order");
    assert.equal(instance[7], submitted % 13, "each instance keeps its own geometric clip root");
    assert.equal(paint.textures[instance[8]], reuse.renderer.rasterLayers[submitted].texture, "the original hardware mip texture is reused");
  }
  assert.equal(submitted, 3142); assert.deepEqual(mixed, mixedSource);
  reuse.mock.clear(); reuse.renderer.localToClipRenderingEnabled = true;
  reuse.renderer.localToClipMatrix.set([1, 0, 0, 0.1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  reuse.renderer.drawSourceOrderedContent(1920, 945, 55, 42, 0.126);
  assert.equal(reuse.mock.calls.filter(c => ["texImage2D", "generateMipmap"].includes(c[0])).length, 0,
    "camera motion creates no new image or mip textures");
  assert(reuse.mock.paints.filter(p => p.label === "rasterTextureBatch").every(p => p.uniforms.get("uUseLocalToClip") === 1));
  const replacedTexture = reuse.renderer.rasterLayers[0].texture;
  const updated = reuse.renderer.prepareRasterLayerUpdates(new Map([[0, largeImage(99)]])); updated.commit();
  reuse.mock.clear(); reuse.renderer.drawSourceOrderedContent(1920, 945, 55, 42, 0.126);
  const firstUpdated = reuse.mock.paints.find(p => p.label === "rasterTextureBatch");
  assert.equal(firstUpdated.instances[4], 99);
  assert.equal(firstUpdated.textures[0], reuse.renderer.rasterLayers[0].texture);
  assert.notEqual(firstUpdated.textures[0], replacedTexture, "texture batches cannot revive replaced pixels");

  const ordered = makeScene(6); ordered.rasterLayers = ordered.rasterLayers.map((_, i) => largeImage(i));
  ordered.fillPathCount = 1;
  ordered.drawRuns.splice(3, 0, { kind: "fill", first: 0, count: 1 });
  ordered.paintGraph.roots = [group(ordered.drawRuns.map((_, runIndex) => ({ kind: "draw", runIndex })))];
  const interleaved = fixture(Renderer, ordered, VectorOrderedBatches); interleaved.renderer.fillPathCount = 1;
  interleaved.renderer.drawSourceOrderedContent(100, 80, 0, 0, 1);
  assert.deepEqual(interleaved.mock.paints.filter(p => ["rasterTextureBatch", "fill"].includes(p.label)).map(p => [p.label, p.count]),
    [["rasterTextureBatch", 3], ["fill", 1], ["rasterTextureBatch", 3]], "a vector paint flushes preceding images before drawing");

  const paired = makeScene(7); paired.rasterLayers = paired.rasterLayers.map((_, i) => largeImage(i));
  paired.drawRuns[3].blendMode = "Multiply"; delete paired.paintGraph;
  const multiplyBoundary = fixture(Renderer, paired, VectorOrderedBatches);
  multiplyBoundary.renderer.drawSourceOrderedContent(100, 80, 0, 0, 1);
  assert.deepEqual(multiplyBoundary.mock.paints.map(p => [p.label, p.count]),
    [["rasterTextureBatch", 3], ["raster", 1], ["raster", 1], ["rasterTextureBatch", 3]],
    "pending images flush before paired Multiply passes change the blend state");

  const tiledScene = makeScene(5); tiledScene.rasterLayers = tiledScene.rasterLayers.map((_, i) => largeImage(i));
  const tiled = fixture(Renderer, tiledScene, VectorOrderedBatches);
  tiled.renderer.rasterLayers[2].extraTiles = [{ texture: tiled.renderer.rasterLayers[2].texture,
    quad: Float32Array.of(0.5, 0, 1, 1), uv: Float32Array.of(0, 0, 1, 1) }];
  tiled.renderer.drawSourceOrderedContent(100, 80, 0, 0, 1);
  assert.deepEqual(tiled.mock.paints.filter(p => p.label.startsWith("raster")).map(p => [p.label, p.count]),
    [["rasterTextureBatch", 2], ["raster", 1], ["raster", 1], ["rasterTextureBatch", 2]],
    "tiled images retain individual quads and flush neighbouring batches");

  const maskedScene = makeScene(24); maskedScene.rasterLayers = maskedScene.rasterLayers.map((_, i) => largeImage(i));
  const content = group(maskedScene.drawRuns.slice(0, 8).map((_, runIndex) => ({ kind: "draw", runIndex })));
  content.softMask = { subtype: "Alpha", children: maskedScene.drawRuns.slice(8, 16).map((_, i) => ({ kind: "draw", runIndex: i + 8 })) };
  maskedScene.paintGraph.roots = [content, group(maskedScene.drawRuns.slice(16).map((_, i) => ({ kind: "draw", runIndex: i + 16 })))];
  const maskedBatch = fixture(Renderer, maskedScene, VectorOrderedBatches);
  maskedBatch.renderer.drawSourceOrderedContent(100, 80, 0, 0, 1);
  const maskedPaints = maskedBatch.mock.paints.filter(p => p.label === "rasterTextureBatch");
  assert.equal(maskedPaints.length, 3);
  assert(maskedPaints.every(p => p.count === 8));
  assert.deepEqual(maskedPaints.map(p => p.instances[4]).sort((a, b) => a - b), [0, 8, 16],
    "mask contents, group content and the next surface retain separate submissions");

  const nestedShape = makeScene(8); nestedShape.rasterLayers = nestedShape.rasterLayers.map((_, i) => largeImage(i));
  nestedShape.paintGraph.roots = [group([nestedShape.paintGraph.roots[0]])]; nestedShape.paintGraph.roots[0].knockout = true;
  const shapeBatch = fixture(Renderer, nestedShape, VectorOrderedBatches);
  shapeBatch.renderer.drawSourceOrderedContent(100, 80, 0, 0, 1);
  assert(shapeBatch.mock.paints.some(p => p.label === "rasterTextureBatch" && p.count === 8 && p.uniforms.get("uPdfShapeOnly") === 1),
    "batched knockout shape coverage ignores image opacity in the shader");

  const unavailableScene = makeScene(14); unavailableScene.rasterLayers = unavailableScene.rasterLayers.map((_, i) => largeImage(i));
  const unavailable = fixture(Renderer, unavailableScene, VectorOrderedBatches);
  unavailable.mock.failBufferAfter = 0;
  const originalWarn = console.warn, batchWarnings = []; console.warn = (...args) => batchWarnings.push(args);
  try {
    unavailable.renderer.drawSourceOrderedContent(100, 80, 0, 0, 1);
    assert.equal(unavailable.mock.paints.filter(p => p.label === "raster").length, 14);
    assert.equal(unavailable.renderer.rasterTextureBatch, null);
    unavailable.mock.clear(); unavailable.renderer.drawSourceOrderedContent(100, 80, 0, 0, 1);
    assert.equal(unavailable.mock.paints.filter(p => p.label === "raster").length, 14);
  } finally { console.warn = originalWarn; }
  assert.equal(batchWarnings.length, 1, "a failed texture batch releases its resources and does not retry on every frame");

  const repeatedScene = makeScene(1100); repeatedScene.rasterLayers = repeatedScene.rasterLayers.map((_, i) => largeImage(i));
  const repeated = fixture(Renderer, repeatedScene, VectorOrderedBatches);
  const sharedTexture = repeated.renderer.rasterLayers[0].texture;
  for (const layer of repeated.renderer.rasterLayers.slice(1)) {
    repeated.mock.gl.deleteTexture(layer.texture); layer.texture = sharedTexture;
  }
  repeated.renderer.drawSourceOrderedContent(100, 80, 0, 0, 1);
  assert.deepEqual(repeated.mock.paints.filter(p => p.label === "rasterTextureBatch").map(p => p.count), [512, 512, 76],
    "a reused texture still has a bounded instance-buffer submission");

  const boundaries = makeScene(12);
  boundaries.clipPaths = [rectangle(0), rectangle(1)];
  boundaries.drawRuns.forEach((run, i) => { run.clipIndex = i < 4 ? 0 : 1; });
  boundaries.paintGraph.roots = [group(boundaries.drawRuns.slice(0, 8).map((_, runIndex) => ({ kind: "draw", runIndex }))),
    group(boundaries.drawRuns.slice(8).map((_, i) => ({ kind: "draw", runIndex: i + 8 })))];
  const split = fixture(Renderer, boundaries, VectorOrderedBatches);
  split.renderer.drawSourceOrderedContent(100, 80, 0, 0, 1);
  assert.deepEqual(split.mock.paints.filter(p => p.label === "rasterAtlas").map(p => [p.count, p.uniforms.get("uVectorClipIndex"), p.first]),
    [[4, 0, 0], [4, 1, 4], [4, 1, 8]], "clips and separate group surfaces break otherwise contiguous batches");

  const hidden = makeScene(8);
  hidden.optionalContent = { groups: [], conditions: [{ kind: "constant", value: true }, { kind: "constant", value: true }], order: [], radioGroups: [] };
  hidden.drawRuns.forEach((run, i) => { run.optionalContent = i === 3 ? 0 : 1; });
  const partial = fixture(Renderer, hidden, VectorOrderedBatches);
  partial.renderer.optionalContentVisibility = { revision: 1, conditions: Uint8Array.of(0, 1) };
  partial.renderer.drawSourceOrderedContent(100, 80, 0, 0, 1);
  assert.deepEqual(partial.mock.paints.filter(p => p.label === "rasterAtlas").map(p => [p.first, p.count]), [[0, 3], [4, 4]],
    "hidden images inside an atlas are never resurrected");
  partial.renderer.orderedRunCuller = { selected: Uint8Array.from({ length: 8 }, (_, i) => i === 1 || i === 2 ? 1 : 0),
    select() { return hidden.drawRuns.slice(1, 3); } };
  partial.mock.clear(); partial.renderer.drawSourceOrderedContent(100, 80, 0, 0, 1);
  assert.deepEqual(partial.mock.paints.filter(p => p.label === "rasterAtlas").map(p => [p.first, p.count]), [[1, 2]],
    "culled ranges select the correct instance offset inside an atlas");

  // A folded singleton reads its group's own opacity and mask. It cannot join
  // a neighbouring fold even when both images share atlas storage.
  const folded = makeScene(8);
  folded.paintGraph.roots = folded.drawRuns.map((_, runIndex) => group([{ kind: "draw", runIndex }], (runIndex + 1) / 10));
  folded.paintGraph.roots[0].softMask = { subtype: "Alpha", children: [{ kind: "draw", runIndex: 7 }] };
  const folds = fixture(Renderer, folded, VectorOrderedBatches);
  folds.renderer.drawSourceOrderedContent(100, 80, 0, 0, 1);
  const foldPaints = folds.mock.paints.filter(p => p.label === "rasterAtlas");
  assert(foldPaints.every(p => p.count === 1));
  assert(foldPaints.some(p => p.first === 0 && Math.abs(p.uniforms.get("uPaintFold")[0] - 0.1) < 1e-6 && p.uniforms.get("uPaintFold")[1] === 1));
  assert(foldPaints.some(p => p.first === 1 && Math.abs(p.uniforms.get("uPaintFold")[0] - 0.2) < 1e-6 && p.uniforms.get("uPaintFold")[1] === 0));

  const knockout = makeScene(8); knockout.paintGraph.roots[0].knockout = true;
  const shapes = fixture(Renderer, knockout, VectorOrderedBatches);
  shapes.renderer.drawSourceOrderedContent(100, 80, 0, 0, 1);
  assert(shapes.mock.paints.some(p => p.label === "rasterAtlas" && p.uniforms.get("uPdfShapeOnly") === 1),
    "knockout shape draws keep opacity-independent coverage");

  const multiply = makeScene(4); multiply.drawRuns.forEach(run => { run.blendMode = "Multiply"; });
  delete multiply.paintGraph;
  const blends = fixture(Renderer, multiply, VectorOrderedBatches);
  blends.renderer.drawSourceOrderedContent(100, 80, 0, 0, 1);
  assert.equal(blends.mock.paints.filter(p => p.label === "rasterAtlas").length, 0,
    "the paired multiply passes retain individual image draws");
  assert.equal(blends.mock.paints.filter(p => p.label === "raster").length, 8);

  const old = [...new Set(renderer.rasterAtlasBatches.values())];
  const cancelled = renderer.prepareRasterLayerUpdates(new Map([[0, image(99)]])); cancelled.dispose();
  assert.equal(renderer.rasterAtlasBatches.size, 3204);
  const replacement = renderer.prepareRasterLayerUpdates(new Map([[0, image(99)]])); replacement.commit();
  assert.equal(renderer.rasterAtlasBatches.size, 0, "live replacements invalidate every stale atlas");
  for (const batch of old) assert(!mock.alive.has(batch.texture) && !mock.alive.has(batch.buffer) && !mock.alive.has(batch.vao));
  renderer.setRasterTextureResidency(false); renderer.setRasterTextureResidency(true);
  assert.equal(renderer.rasterAtlasBatches.size, 0, "restoring residency cannot revive replaced pixels");

  const failure = fixture(Renderer, makeScene(600), VectorOrderedBatches, false);
  failure.mock.failBufferAfter = 1;
  const warn = console.warn, warnings = []; console.warn = (...args) => warnings.push(args);
  try { failure.renderer.uploadRasterLayers(failure.renderer.scene); } finally { console.warn = warn; }
  assert.equal(warnings.length, 1);
  assert.equal(failure.renderer.rasterAtlasBatches.size, 0, "partial atlas allocations are released after failure");
  assert.equal(failure.renderer.rasterLayers.length, 600, "allocation failure preserves the ordinary document resources");
  failure.mock.clear(); failure.renderer.drawSourceOrderedContent(100, 80, 0, 0, 1);
  assert.equal(failure.mock.paints.filter(p => p.label === "rasterTextureBatch").length, 75,
    "failed atlases can still batch the original textures");
  for (const item of [split, partial, folds, shapes, blends, failure, reuse, interleaved, multiplyBoundary, tiled,
    maskedBatch, shapeBatch, unavailable, repeated]) {
    item.renderer.dispose(); assert.equal(item.mock.alive.size, 0, "batch resources are released at disposal");
  }
  renderer.dispose();
  assert.equal(mock.alive.size, 0, "disposing the renderer releases its resources");
  console.log("WebGL raster batches: 3204-to-7 atlas draws, 3142-to-393 texture draws with varying clips, paint order, masks, knockout, multiply, tiling and resource lifecycle passed.");
} finally { hooks.deregister(); }

function image(index, height = 2) {
  return { width: 20, height, data: new Uint8Array(20 * height * 4).fill(128), opacity: 0.5,
    matrix: Float32Array.of(20, 0, 0, -height, index, 20), pageIndex: 0, paintOrder: index };
}
function largeImage(index) {
  return { ...image(index, 1), width: 1025, data: new Uint8Array(1025 * 4).fill(128),
    matrix: Float32Array.of(1025, 0, 0, -1, index, 20) };
}
function group(children, alpha = 0.5) { return { kind: "group", isolated: true, knockout: false, alpha, blendMode: "Normal", children }; }
function rectangle(offset) { return { parent: -1, fillRule: 0, edges: Float32Array.of(offset, 0, 100, 0, 100, 0, 100, 100, 100, 100, offset, 100, offset, 100, offset, 0) }; }

function fixture(Renderer, scene, Plan, upload = true) {
  const mock = mockGl(), renderer = new Renderer({ width: 100, height: 80, getContext: () => mock.gl });
  mock.describe = p => renderer.describeProgram(p);
  renderer.setExternalFrameDriver(true);
  Object.assign(renderer, { scene, orderedBatches: new Plan(scene, null) });
  if (upload) renderer.uploadRasterLayers(scene);
  renderer.uploadVectorClips(scene);
  mock.clear();
  return { renderer, mock };
}

function mockGl() {
  const calls = [], paints = [], alive = new Set(), uniforms = new Map(), attributes = new Map(), buffers = new Map(), textures = new Map();
  let program, vao, buffer, id = 0;
  let textureUnit = 0;
  const mock = { calls, paints, alive, failBufferAfter: -1, describe: () => null,
    clear() { calls.length = paints.length = 0; } };
  mock.gl = new Proxy({ TEXTURE0: 1000 }, { get(target, name) {
    if (name in target) return target[name];
    if (name.toUpperCase() === name) return name;
    return (...args) => {
      calls.push([name, ...args]);
      if (name.startsWith("create")) {
        if (name === "createBuffer" && mock.failBufferAfter >= 0 && mock.failBufferAfter-- === 0) return null;
        const resource = { kind: name.slice(6), id: ++id }; alive.add(resource); return resource;
      }
      if (name.startsWith("delete")) return void alive.delete(args[0]);
      if (name === "getParameter") return 4096;
      if (name === "getShaderParameter" || name === "getProgramParameter") return true;
      if (name === "checkFramebufferStatus") return "FRAMEBUFFER_COMPLETE";
      if (name === "getUniformLocation") return { program: args[0], name: args[1] };
      if (name === "useProgram") { program = args[0]; if (!uniforms.has(program)) uniforms.set(program, new Map()); }
      if (name.startsWith("uniform")) {
        assert.equal(args[0].program, program);
        uniforms.get(program).set(args[0].name, args.length > 2 ? args.slice(1) : args[1]);
      }
      if (name === "bindVertexArray") { vao = args[0]; if (!attributes.has(vao)) attributes.set(vao, new Map()); }
      if (name === "bindBuffer") buffer = args[1];
      if (name === "bufferData" && ArrayBuffer.isView(args[1])) buffers.set(buffer, args[1].slice());
      if (name === "activeTexture") textureUnit = args[0] - 1000;
      if (name === "bindTexture") textures.set(textureUnit, args[1]);
      if (name === "vertexAttribPointer") attributes.get(vao)?.set(args[0], { buffer, offset: args[5] });
      if (name.startsWith("drawArrays")) {
        const label = mock.describe(program), values = new Map(uniforms.get(program));
        paints.push({ label, count: name === "drawArraysInstanced" ? args[3] : 1, uniforms: values,
          instances: label === "rasterTextureBatch" ? buffers.get(attributes.get(vao).get(0).buffer).slice() : null,
          textures: Array.from({ length: 8 }, (_, unit) => textures.get(unit)),
          first: label === "rasterAtlas" ? attributes.get(vao).get(0).offset / 48 : null });
      }
    };
  } });
  return mock;
}
