import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(s, c, next) {
  return next(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { buildTextLod, buildTextLodAsync } = await import("../src/textGreekLod.ts");
  const { TextLodRuntime } = await import("../src/textLodCore.ts");
  const { OrderedTextLodSelection } = await import("../src/orderedTextLod.ts");
  const { VectorOrderedBatches } = await import("../src/vectorOrderedBatches.ts");
  const { VectorDrawRunCuller } = await import("../src/vectorDrawRunCulling.ts");
  const { createDefaultOptionalContentSnapshot } = await import("../src/optionalContent.ts");
  const { createOrthographicLocalToClip } = await import("../src/planarProjection.ts");
  const { WebGlPdfRenderer } = await import("../src/webGlPdfRenderer.ts");
  const { WebGpuPdfRenderer } = await import("../src/webGpuPdfRenderer.ts");
  const count = 60_000;
  const rectangle = (x0, y0, x1, y1) => ({ parent: -1, fillRule: 0,
    edges: Float32Array.of(x0,y0,x1,y0, x1,y0,x1,y1, x1,y1,x0,y1, x0,y1,x0,y0) });
  const scene = { ...createEmptyVectorScene(), textInstanceCount: count, textGlyphCount: 1, textGlyphSegmentCount: 4,
    textInstanceA: new Float32Array(count * 4), textInstanceB: new Float32Array(count * 4), textInstanceC: new Float32Array(count * 4),
    textGlyphMetaA: Float32Array.of(0,4,0,0), textGlyphMetaB: Float32Array.of(0.7,1,0,0),
    textGlyphSegmentsA: Float32Array.of(0,0,0,0, .7,0,.7,0, .7,1,.7,1, 0,1,0,1),
    textGlyphSegmentsB: Float32Array.of(.7,0,0,0, .7,1,0,0, 0,1,0,0, 0,0,0,0),
    pageCount: 1, pageRects: Float32Array.of(-1,-1,501,241), pageTextRanges: Uint32Array.of(0,count),
    bounds: { minX: -1, minY: -1, maxX: 501, maxY: 241 },
    fillPathCount: 1, fillPathMetaA: Float32Array.of(0,0,5,0), fillPathMetaB: Float32Array.of(6,1,0,1), fillPathMetaC: Float32Array.of(1,0,0,1),
    clipPaths: [rectangle(-1,-1,9,241), rectangle(0,-1,501,241)],
    optionalContent: { groups: [], conditions: [{ kind: "constant", value: true }, { kind: "constant", value: true }], order: [], radioGroups: [] },
    // The first boundary is in the middle of a baseline, around another paint.
    drawRuns: [{ kind: "text", first: 0, count: 17, clipIndex: 0, optionalContent: 0 },
      { kind: "fill", first: 0, count: 1 },
      { kind: "text", first: 17, count: count - 17, clipIndex: 1, optionalContent: 1 }] };
  scene.pageBounds = scene.bounds;
  for (let i = 0; i < count; i++) {
    scene.textInstanceA.set([1,0,0,1], i * 4);
    scene.textInstanceB.set([i % 500, Math.floor(i / 500) * 2, 0, 0], i * 4);
    scene.textInstanceC.set([0,0,0,1], i * 4);
  }
  const canonical = structuredClone(scene);
  const build = buildTextLod(scene);
  assert(build.data);
  assert.equal(build.data.runs[0].exactCount, 17, "a coarse baseline stops before the next paint");
  const asyncBuild = await buildTextLodAsync(scene);
  assert(asyncBuild.data.runs.every(r => r.exactStart >= 17 || r.exactStart + r.exactCount <= 17),
    "the asynchronous builder preserves the same paint boundaries");
  const multiply = buildTextLod({ ...scene, drawRuns: scene.drawRuns.map((r, i) => i === 0 ? { ...r, blendMode: "Multiply" } : r) });
  assert.equal(multiply.data.runs[0].eligible, false, "Multiply glyphs retain their exact per-instance blending");
  assert.throws(() => new OrderedTextLodSelection(scene, buildTextLod({ ...scene, drawRuns: undefined }).data), /paint boundary/);

  const view = { localToClip: createOrthographicLocalToClip(250,120,.02,1000,600), viewportWidth: 1000, viewportHeight: 600 };
  const selected = new TextLodRuntime(build).update(view);
  assert(selected.instanceIds.length < count / 10);
  const reversed = { ...scene, drawRuns: [...scene.drawRuns].reverse() };
  const reversedSelection = new OrderedTextLodSelection(reversed, build.data);
  reversedSelection.update(selected);
  const reversedPlan = new VectorOrderedBatches(reversed, null);
  reversedPlan.setTextSelection(reversedSelection); reversedPlan.update(reversed.drawRuns, 50);
  assert.deepEqual(reversedPlan.batches.map(b => b.kind), ["text", "fill", "text"], "canonical paint order can differ from glyph-store order");
  assert.equal(reversedPlan.uintInstances[1], 2, "reordered selection keeps its original clip");

  // Conservative culling must include the replacement rectangle, even if it
  // extends into a gap between the original transformed glyph boxes.
  const culler = new VectorDrawRunCuller(scene);
  const edgeView = { minX: 800, minY: 0, maxX: 801, maxY: 1 };
  const unclipped = { ...scene, drawRuns: scene.drawRuns.map(r => ({ ...r, clipIndex: undefined })) };
  const expanded = new VectorDrawRunCuller(unclipped);
  assert.equal(expanded.select(edgeView, .001).length, 0);
  expanded.includeTextLod({ ...build.data, runs: [{ ...build.data.runs[0], bounds: { minX: 0,minY: 0,maxX: 801,maxY: 1 } }] });
  assert(expanded.select(edgeView, .001).includes(unclipped.drawRuns[0]), "coarse bounds invalidate a prior culling result");
  culler.includeTextLod(build.data);

  // A text-heavy guide interleaves thousands of text/fill paints. Enabling LOD
  // must retain safe batching rather than force a draw for every alternation.
  // Exercise both subset scheduling and the large monochrome schedule cache.
  for (const glyphsPerPaint of [500, 50]) {
    const rows = count / glyphsPerPaint;
    const batchScene = { ...scene, clipPaths: [], optionalContent: undefined,
      pageRects: Float32Array.of(-1,-1,701,241), fillPathCount: rows,
      fillPathMetaA: new Float32Array(rows * 4), fillPathMetaB: new Float32Array(rows * 4),
      fillPathMetaC: new Float32Array(rows * 4), drawRuns: [] };
    for (let row = 0; row < rows; row++) {
      batchScene.drawRuns.push({ kind: "text", first: row * glyphsPerPaint, count: glyphsPerPaint }, { kind: "fill", first: row, count: 1 });
      const y = Math.floor(row * glyphsPerPaint / 500) * 2;
      batchScene.fillPathMetaA.set([0,0,600,y], row * 4);
      batchScene.fillPathMetaB.set([601,y + 1,glyphsPerPaint === 500 ? 1 : 0,0], row * 4);
      batchScene.fillPathMetaC.set([0,0,0,1], row * 4);
    }
    const batchBuild = buildTextLod(batchScene), batchRuntime = new TextLodRuntime(batchBuild);
    const batchSelection = new OrderedTextLodSelection(batchScene, batchBuild.data);
    const batchPlan = new VectorOrderedBatches(batchScene, null);
    batchPlan.update(batchScene.drawRuns, 50);
    assert.equal(batchPlan.batches.length, 2, "independent text and fills batch before LOD is enabled");
    for (const zoom of [.02, 1, .02]) {
      const result = batchRuntime.update({ ...view, localToClip: createOrthographicLocalToClip(350,120,zoom,1000,600) });
      batchSelection.update(result); batchPlan.setTextSelection(batchSelection);
      batchPlan.update(batchScene.drawRuns, 1 / zoom);
      assert.equal(batchPlan.batches.length, 2, "both coarse and exact LOD selections retain safe batching");
      const textBatch = batchPlan.batches.find(b => b.kind === "text");
      assert.deepEqual(Array.from({ length: textBatch.count }, (_, i) => batchPlan.uintInstances[(textBatch.first + i) * 2]),
        Array.from(result.instanceIds), "batching preserves every selected exact/coarse glyph");
      assert.equal(batchPlan.instanceCount, result.instanceIds.length + rows, "all fill instances remain present");
      assert.equal(batchPlan.update(batchScene.drawRuns, 1 / zoom), false, "unchanged selection reuses the instance upload");
    }
    batchPlan.setTextSelection(null); batchPlan.update(batchScene.drawRuns, 50);
    assert.equal(batchPlan.batches.length, 2, "LOD Off keeps batching");
    assert.equal(batchPlan.instanceCount, count + rows);
  }

  // The bounding rectangle of rotated glyphs may reach beyond their exact
  // combined bounds. A fill in that extra coverage must retain paint order.
  const cornerScene = { ...scene, clipPaths: [], optionalContent: undefined,
    textInstanceCount: 3, textGlyphCount: 2,
    textInstanceA: Float32Array.of(1,0,0,1, 1,1,-1,1, 1,1,-1,1),
    textInstanceB: Float32Array.of(-20,0,0,0, 0,0,0,0, 3,3,1,0),
    textInstanceC: Float32Array.of(0,0,0,1, 0,0,0,1, 0,0,0,1),
    textGlyphMetaA: Float32Array.of(0,0,0,0, 0,0,0,0), textGlyphMetaB: Float32Array.of(1,2,0,0, 2,1,0,0),
    fillPathMetaA: Float32Array.of(0,0,3.4,6.5), fillPathMetaB: Float32Array.of(3.6,6.8,1,0),
    fillPathMetaC: Float32Array.of(0,0,0,1), pageRects: Float32Array.of(-30,-10,10,10),
    drawRuns: [{ kind: "text", first: 0, count: 1 }, { kind: "fill", first: 0, count: 1 },
      { kind: "text", first: 1, count: 2 }] };
  const cornerData = { ...build.data, exactInstanceCount: 3, coarseInstanceCount: 1, combinedInstanceCount: 4,
    runs: [{ exactStart: 1, exactCount: 2, coarseIndex: 0, bounds: { minX: -2,minY: 0,maxX: 5,maxY: 7 } }] };
  const cornerSelection = new OrderedTextLodSelection(cornerScene, cornerData);
  cornerSelection.update({ instanceIds: Uint32Array.of(0,3), changed: true });
  const cornerPlan = new VectorOrderedBatches(cornerScene, null);
  cornerPlan.update(cornerScene.drawRuns, .01);
  assert.equal(cornerPlan.batches.length, 2, "exact glyphs do not reach the fill");
  cornerPlan.setTextSelection(cornerSelection); cornerPlan.update(cornerScene.drawRuns, .01);
  assert.deepEqual(cornerPlan.batches.map(b => b.kind), ["text","fill","text"],
    "coarse coverage invalidates an existing schedule even within the same scale bucket");
  cornerPlan.update(cornerScene.drawRuns.slice(0,2), .01);
  cornerPlan.update(cornerScene.drawRuns, .01);
  assert.deepEqual(cornerPlan.batches.map(b => b.kind), ["text","fill","text"], "returning paints retain coarse overlap order");

  let reference;
  for (const [backend, Renderer] of [["WebGL", WebGlPdfRenderer], ["WebGPU", WebGpuPdfRenderer]]) {
    const runtime = new TextLodRuntime(build), selection = new OrderedTextLodSelection(scene, build.data);
    const plan = new VectorOrderedBatches(scene, null), calls = [];
    let uploads = 0, pipeline;
    const instance = Object.assign(Object.create(Renderer.prototype), {
      scene, textInstanceCount: count, textLodRuntime: runtime, orderedTextLod: selection,
      textLodGpuActive: true, textLodMode: "auto", orderedBatches: plan, orderedRunCuller: culler,
      canvas: { width: 1000,height: 600 }, cameraCenterX: 250,cameraCenterY: 120,zoom: .02,
      rasterRenderingEnabled: false, strokeRenderingEnabled: false, textRenderingEnabled: true, fillRenderingEnabled: true,
      optionalContentVisibility: createDefaultOptionalContentSnapshot(scene), orderedCullingBounds: null,
      textInstanceIdBuffer: {}, orderedInstanceBuffer: {}, vectorClipBindGroups: [{}], frameDrawCalls: 0,
      fillPipeline: "fill",textPipeline: "text",fillBindGroup: {},textBindGroup: {},vectorOverrideColor: [0,0,0],vectorOverrideOpacity: 0,
      gl: { bindBuffer() {}, bufferData() { uploads++; } },
      gpuDevice: { queue: { writeBuffer(buffer) { if (buffer === instance.orderedInstanceBuffer) uploads++; } } },
      drawPageBackgroundContentIntoPass() {},
      drawFilledPaths(_w,_h,_x,_y,_z,first,count) { calls.push(["fill",first,count]); },
      drawTextInstances(_w,_h,_x,_y,_z,_projection,range) { calls.push(["text",range.start,range.count]); }
    });
    const pass = { setPipeline(value) { pipeline = value; }, setBindGroup() {},
      draw(_vertices,count,_firstVertex,first) { calls.push([pipeline,first,count]); } };
    function render() {
      calls.length = 0;
      if (backend === "WebGL") instance.drawSourceOrderedFrame(1000,600,instance.cameraCenterX,120,instance.zoom,null);
      else {
        instance.updateCameraUniforms(1000,600,instance.cameraCenterX,120,instance.zoom);
        assert.equal(instance.useTextInstanceIndirection, false, "ordered WebGPU IDs use the interleaved clip buffer");
        instance.drawSourceOrderedContentIntoPass(pass);
      }
      return Array.from(plan.uintInstances.subarray(0,plan.instanceCount * 2));
    }
    const first = render();
    assert.equal(uploads, 1, `${backend}: first selection uploads once`);
    assert(plan.instanceCount < count / 10, `${backend}: Auto uses coarse instances with source-ordered paints`);
    assert.deepEqual(calls.map(c => c[0]), ["text","fill","text"], `${backend}: text never crosses an intervening fill`);
    assert.equal(first[1], 1, `${backend}: coarse text retains its PDF clip`);
    assert.equal(first.at(-1), 2);
    if (reference) assert.deepEqual(first, reference, "native backends submit identical exact/coarse IDs and clips"); else reference = first;
    for (let i = 0; i < 240; i++) { instance.cameraCenterX += .01; render(); }
    assert.equal(uploads, 1, `${backend}: panning within the visibility guard does not rebuild/upload the selection`);

    instance.optionalContentVisibility = { revision: 2, layers: [], conditions: Uint8Array.of(1,0) };
    render();
    assert.deepEqual(calls.map(c => c[0]), ["text","fill"], `${backend}: hidden-layer text is excluded`);
    assert.equal(plan.instanceCount, selection.ranges[1] + 1);
    instance.optionalContentVisibility = createDefaultOptionalContentSnapshot(scene);
    instance.textLodMode = "off"; runtime.setMode("off"); render();
    assert.equal(plan.instanceCount, count + 1, `${backend}: Off restores the complete original glyph set`);
    instance.textLodMode = "auto"; runtime.setMode("auto"); render();
    assert(plan.instanceCount < count / 10);
    instance.zoom = 1; render();
    assert.equal(runtime.getStats().renderedRuns, 0, `${backend}: readable text returns to exact glyphs`);
    assert(plan.instanceCount > count / 2);
    instance.canvas.clientWidth = instance.canvas.width / 3;
    instance.zoom = 1.2; render();
    assert(plan.instanceCount < count / 10, `${backend}: DPR 3 uses CSS-pixel ink height`);
    const retinaIds = runtime.getSelectedInstanceIds().slice();
    const retinaUploads = uploads;
    render();
    assert.equal(uploads, retinaUploads, `${backend}: stationary Retina frames do not reupload`);
    instance.canvas.clientWidth = instance.canvas.width; render();
    assert.equal(runtime.getStats().renderedRuns, 0, `${backend}: actual canvas presentation scale controls detail`);
    instance.canvas.clientWidth = instance.canvas.width / 3; render();
    assert.deepEqual(runtime.getSelectedInstanceIds(), retinaIds);
    instance.zoom = 3; render();
    assert.equal(runtime.getStats().renderedRuns, 0, `${backend}: readable Retina text returns to exact glyphs`);
    instance.zoom = 1;
    runtime.setResourceFallback("resource-capacity"); instance.textLodGpuActive = false; render();
    assert.equal(plan.instanceCount, count + 1, `${backend}: resource fallback retains exact drawing`);
  }
  assert.deepEqual(scene, canonical, "rendering preserves canonical geometry, clips, layers and paint order");
  for (const file of ["webGlPdfRenderer.ts","webGpuPdfRenderer.ts"]) {
    const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /textLodBuildResult = scene.drawRuns \? null/, "ordered metadata alone must not disable LOD");
    assert.match(source, /textLodBuildResult = (?:this.thumbnailMode \|\| )?this.scenePaintVisibility.requiresCompositing \? null/,
      "compositor effects conservatively retain exact text");
    assert.match(source, /scene.drawRuns && textLodUploadData \? new OrderedTextLodSelection/,
      "ordered LOD is activated only after a successful combined texture upload");
  }
  console.log("Native ordered text LOD: safe batching, coarse overlap order, paint boundaries, clipping, layers, native parity, pan reuse, exact zoom and fallback passed.");
} finally { hooks.deregister(); }
