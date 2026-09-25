import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

try {
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");
  const backends = [["WebGL", WebGlFloorplanRenderer], ["WebGPU", WebGpuFloorplanRenderer]];
  const cases = backends.flatMap(([backend, Renderer]) => [false, true].map(lodActive => [backend, Renderer, lodActive]));
  for (const [backend, Renderer, lodActive] of cases) {
    const { renderer, events, render } = fixture(backend, Renderer);
    renderer.vectorLodRuntime = lodActive ? {} : null;
    const check = message => `${backend}${lodActive ? " with LOD" : ""}: ${message}`;
    assert.equal(renderer.shouldUsePanCache(true), true, check("paint-heavy ordered scenes qualify with few strokes"));
    renderer.isPanInteracting = false;
    assert.equal(renderer.shouldUsePanCache(true), true, check("translation inertia reuses cached paints"));
    assert.equal(renderer.shouldUsePanCache(false), false, check("stationary output returns to direct rendering"));
    renderer.isPanInteracting = true;
    renderer.targetZoom = renderer.zoom * 2;
    assert.equal(renderer.shouldUsePanCache(true), false, check("active zoom bypasses the cache even while dragging"));
    render();
    assert.equal(events.filter(event => event.kind === "direct").length, 1, check("zoom dispatch is direct"));
    assert.equal(events.filter(event => event.kind === "ordered").length, 0, check("zoom never refreshes the pan cache"));
    renderer.targetZoom = renderer.zoom;
    const heavyRuns = renderer.scene.drawRuns;
    renderer.scene.drawRuns = heavyRuns.slice(0, 4);
    assert.equal(renderer.shouldUsePanCache(true), false, check("small ordered scenes do not allocate a cache"));
    renderer.scene.drawRuns = heavyRuns;

    events.length = 0;
    render();
    const initialDraw = events.find(event => event.kind === "ordered");
    assert.ok(initialDraw, check("initial pan renders ordered content"));
    assert.equal(initialDraw.target, "cache", check("ordered content renders into the cache attachment"));
    assert.deepEqual(initialDraw.view, [1800, 1080, 100, -200, 0.25], check("ordered refresh uses overscan and the live camera"));
    assert.equal(renderer.panCacheValid, true);
    assert.equal(renderer.panCacheRenderedSegments, 2897);
    assert.equal(renderer.panCacheUsedCulling, true);
    assert.deepEqual(events.filter(event => ["ordered", "blit", "highlight"].includes(event.kind)).map(event => event.kind),
      ["ordered", "blit", "highlight"], check("highlights render after the cache blit and are never baked into it"));

    const sceneDraws = () => events.filter(event => event.kind === "ordered").length;
    renderer.cameraCenterX += 100;
    renderer.cameraCenterY -= 80;
    render();
    assert.equal(sceneDraws(), 1, check("panning inside coverage submits no scene paints"));
    assert.deepEqual(events.filter(event => event.kind === "blit").at(-1).transform, [25, -20, 1],
      check("cache reuse translates at its original resolution"));
    assert.deepEqual(events.filter(event => event.kind === "highlight").at(-1), {
      kind: "highlight", target: "screen", view: [1000, 600, 200, -280, 0.25]
    }, check("overlays follow the current camera on every cached frame"));

    renderer.cameraCenterX += 2000;
    render();
    assert.equal(sceneDraws(), 2, check("leaving overscan refreshes source-ordered content once"));
    assert.deepEqual(events.filter(event => event.kind === "blit").at(-1).transform, [0, 0, 1]);
    renderer.zoom = renderer.targetZoom = 0.3;
    render();
    assert.equal(sceneDraws(), 3, check("a settled zoom change refreshes cached pixels before the next pan"));
    assert.equal(renderer.panCacheZoom, 0.3);
    renderer.setFillRenderingEnabled(false);
    assert.equal(renderer.panCacheValid, false, check("paint visibility changes invalidate cached pixels"));
    render();
    assert.equal(sceneDraws(), 4, check("invalidated content is refreshed once"));
    render();
    assert.equal(sceneDraws(), 4, check("the refreshed cache is reusable"));
    renderer.setStrokeCurveEnabled(false);
    assert.equal(renderer.panCacheValid, false, check("stroke geometry changes invalidate cached pixels"));
    render();
    assert.equal(sceneDraws(), 5, check("curve mode changes refresh cached geometry"));
    render();
    assert.equal(sceneDraws(), 5, check("updated curve geometry is reusable"));
    assert.equal(events.filter(event => event.kind === "highlight").length, 8,
      check("each cached frame has its own live highlight overlay"));

    if (backend === "WebGL") {
      assert.equal(events.filter(event => event.kind === "metric" && event.name === "panCacheRefreshes").length, 5,
        check("profiling counts only frames that repaint the cache"));
      assert.equal(events.filter(event => event.kind === "metric" && event.name === "panCacheReuses").length, 3,
        check("profiling distinguishes reuse from expensive refreshes"));
    }
    const blitCount = events.filter(event => event.kind === "blit").length;
    renderer.ensurePanCacheResources = () => false;
    render();
    assert.equal(events.filter(event => event.kind === "direct").length, 1, check("unavailable cache resources fall back to direct rendering"));
    assert.equal(events.filter(event => event.kind === "blit").length, blitCount, check("allocation fallback never presents stale cached pixels"));
  }
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { VectorStrokeLodRuntime, buildRuntimeTileBuckets } = await import("../src/vectorStrokeLodCore.ts");
  const makeRuntime = lodFixture(createEmptyVectorScene, VectorStrokeLodRuntime, buildRuntimeTileBuckets);
  for (const [backend, Renderer] of backends) {
    checkLodCache(backend, Renderer, makeRuntime());
  }
  console.log("Native ordered and LOD pan cache dispatch, selection reuse, invalidation, and overlay tests passed");
} finally {
  hooks.deregister();
}

function fixture(backend, Renderer) {
  const events = [];
  let target = "screen";
  let blitTransform = [];
  const noUnorderedDraw = () => assert.fail(`${backend}: ordered cache refresh must not replay separate unordered paint passes`);
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    scene: { drawRuns: Array.from({ length: 4096 }, (_, first) => ({ kind: "fill", first, count: 1 })) },
    segmentCount: 2897, fillPathCount: 3563, textInstanceCount: 20881,
    canvas: { width: 1000, height: 600 }, zoom: 0.25, targetZoom: 0.25,
    cameraCenterX: 100, cameraCenterY: -200, isPanInteracting: true,
    vectorLodRuntime: null, panCacheValid: false, panCacheZoom: 1,
    panCacheCenterX: 0, panCacheCenterY: 0, panCacheWidth: 1800, panCacheHeight: 1080,
    panCacheTexture: { createView: () => "cache" }, panCacheFramebuffer: "cache",
    blitBindGroup: {}, frameDrawCalls: 0, presentedFrameSerial: 0,
    strokeRenderingEnabled: true, fillRenderingEnabled: true, textRenderingEnabled: true, rasterRenderingEnabled: true,
    orderedRunsCulled: true, strokeCurveEnabled: true, ensurePanCacheResources: () => true,
    ensureRenderState() {}, updateCameraWithDamping: () => true, updatePanReleaseVelocitySample() {},
    requestFrame() {}, emitFrameStats() {}, getRedundantSegmentCount: () => 0, isPaintOrderApproximated: () => false,
    updateVisibleSet() {}, updateStrokeVisibleSet() {},
    drawOrderedGradientPaint: noUnorderedDraw, drawFilledPaths: noUnorderedDraw,
    drawVisibleSegments: noUnorderedDraw, drawTextInstances: noUnorderedDraw,
    drawOrderedGradientPaintIntoPass: noUnorderedDraw, drawVectorContentIntoPass: noUnorderedDraw,
    renderDirectToScreen() {
      events.push({ kind: "direct" });
      return { renderedSegments: 2897, totalSegments: 2897, usedCulling: false, zoom: this.zoom };
    }
  });
  if (backend === "WebGL") {
    renderer.performanceProfiler = {
      enabled: true, beginFrame() {}, endFrame() {}, beginSection() {}, endSection() {}, setFrameContext() {},
      add(name) { events.push({ kind: "metric", name }); }
    };
    renderer.uOffsetPx = "offset";
    renderer.gl = {
      FRAMEBUFFER: 1, COLOR_BUFFER_BIT: 2, TEXTURE0: 3, TEXTURE_2D: 4, TRIANGLE_STRIP: 5, BLEND: 6,
      bindFramebuffer(_binding, framebuffer) { target = framebuffer ?? "screen"; },
      viewport() {}, clearColor() {}, clear() {}, useProgram() {}, bindVertexArray() {},
      activeTexture() {}, bindTexture() {}, uniform1i() {}, enable() {}, disable() {},
      uniform2f(uniform, x, y) { if (uniform === "offset") blitTransform = [x, y]; },
      uniform1f(_uniform, scale) { blitTransform.push(scale); },
      drawArrays() { events.push({ kind: "blit", target, transform: blitTransform }); }
    };
    renderer.drawSourceOrderedContent = (width, height, x, y, zoom, framebuffer) => {
      assert.equal(framebuffer, "cache", "WebGL compositor must receive the cache framebuffer as its destination");
      events.push({ kind: "ordered", target, view: [width, height, x, y, zoom] });
      return 2897;
    };
    renderer.drawSearchHighlights = (width, height, x, y) => {
      events.push({ kind: "highlight", target, view: [width, height, x, y, renderer.zoom] });
    };
  } else {
    let view;
    renderer.gpuDevice = {
      queue: { submit() {} },
      createCommandEncoder: () => ({
        beginRenderPass: descriptor => ({
          target: descriptor.colorAttachments[0].view,
          setPipeline() {}, setBindGroup() {}, end() {},
          draw() { events.push({ kind: "blit", target: this.target, transform: blitTransform }); }
        }),
        finish: () => ({})
      })
    };
    renderer.gpuContext = { getCurrentTexture: () => ({ createView: () => "screen" }) };
    renderer.updateCameraUniforms = (width, height, x, y) => { view = [width, height, x, y, renderer.zoom]; };
    renderer.drawSourceOrderedContentIntoPass = pass => {
      events.push({ kind: "ordered", target: pass.target, view });
      return 2897;
    };
    renderer.updateBlitUniforms = (x, y, scale) => { blitTransform = [x, y, scale]; };
    renderer.drawHighlightsIntoPass = (pass, width, height, x, y, zoom) => {
      events.push({ kind: "highlight", target: pass.target, view: [width, height, x, y, zoom] });
    };
  }
  return { renderer, events, render: () => renderer.render(0) };
}

// Prebuilt levels keep the fixture bounded while exercising real selection and
// native buffer uploads. Eight identical opaque dots become one density mark.
function lodFixture(createEmptyVectorScene, VectorStrokeLodRuntime, buildRuntimeTileBuckets) {
  const sceneFor = density => {
    const count = 320_000 / density;
    const scene = Object.assign(createEmptyVectorScene(), {
      segmentCount: count, maxHalfWidth: .05,
      bounds: { minX: -25, minY: -4, maxX: 25, maxY: 4 },
      endpoints: new Float32Array(count * 4), primitiveMeta: new Float32Array(count * 4),
      primitiveBounds: new Float32Array(count * 4), styles: new Float32Array(count * 4)
    });
    for (let index = 0; index < count; index++) {
      const dot = Math.floor(index * density / 8), x = (dot % 500) * .1 - 25, y = Math.floor(dot / 500) * .1 - 4;
      scene.endpoints.set([x, y, x, y], index * 4);
      scene.primitiveMeta.set([x, y, 1 - density, 5], index * 4);
      scene.primitiveBounds.set([x, y, x, y], index * 4);
      scene.styles.set([.05, 0, 0, 1], index * 4);
    }
    return scene;
  };
  const source = sceneFor(1), coarse = sceneFor(8);
  const tileGrid = { columns: 1, rows: 1, minX: -26, minY: -5, maxX: 26, maxY: 5,
    tileWidth: 52, tileHeight: 10, xEdges: Float64Array.of(-26, 26), yEdges: Float64Array.of(-5, 5) };
  const levels = [source, coarse].map((scene, index) => ({ scene, tolerance: index * .5,
    segmentCount: scene.segmentCount, ...buildRuntimeTileBuckets(scene, tileGrid) }));
  return () => new VectorStrokeLodRuntime(source, { tileGrid, elapsedMs: 0,
    levels: levels.map(level => ({ ...level, visibleSegmentIds: new Uint32Array(level.segmentCount),
      segmentMarks: new Uint32Array(level.segmentCount), visibleSegmentCount: 0, markToken: 0 })) });
}

function checkLodCache(backend, Renderer, runtime) {
  const { renderer, events, render } = fixture(backend, Renderer);
  const check = message => `${backend} actual LOD: ${message}`;
  Object.assign(renderer, {
    scene: runtime.levels[0].scene, segmentCount: runtime.levels[0].segmentCount,
    vectorLodRuntime: runtime, orderedBatches: null, localToClipRenderingEnabled: false,
    pageRects: new Float32Array(0), textInstanceCount: 0,
    fillRenderingEnabled: false, textRenderingEnabled: false, rasterRenderingEnabled: false,
    drawOrderedGradientPaint() {}, drawOrderedGradientPaintIntoPass() {}, bindVectorClip() {}
  });
  const buffers = new Map();
  const upload = (buffer, ids) => {
    buffers.set(buffer, Array.from(ids));
    events.push({ kind: "upload", count: ids.length });
  };
  const submitted = (index, count, view) => {
    const level = runtime.levels[index];
    assert.deepEqual(buffers.get(index).slice(0, count), Array.from(level.visibleSegmentIds.subarray(0, count)),
      check("submitted IDs are the current selected LOD buffer"));
    events.push({ kind: "lod", index, count, view });
  };
  const originalUpdate = runtime.update.bind(runtime);
  runtime.update = (...args) => {
    const changed = originalUpdate(...args);
    events.push({ kind: "selection", changed, viewport: args[1], zoom: args[0].zoom });
    return changed;
  };
  if (backend === "WebGL") {
    delete renderer.updateVisibleSet;
    delete renderer.drawVisibleSegments;
    let boundBuffer;
    renderer.gl.bindBuffer = (_target, buffer) => { boundBuffer = buffer; };
    renderer.gl.bufferData = (_target, ids) => upload(boundBuffer, ids);
    renderer.vectorLodLevels = runtime.levels.map((level, index) => ({ index,
      visibleSegmentIdBuffer: index, visibleSegmentIdsFloat: new Float32Array(level.segmentCount) }));
    renderer.drawStrokeInstances = (level, _buffer, count, ...view) => submitted(level.index, count, view);
  } else {
    delete renderer.updateStrokeVisibleSet;
    delete renderer.drawVectorContentIntoPass;
    renderer.gpuDevice.queue.writeBuffer = (buffer, _offset, ids) => upload(buffer, ids);
    renderer.vectorLodLevelResources = runtime.levels.map((_level, index) => ({
      visibleSegmentIdBuffer: index, bindGroup: { index }
    }));
    renderer.strokePipeline = "stroke";
    let view;
    renderer.updateCameraUniforms = (width, height, x, y, zoom = renderer.zoom) => { view = [width, height, x, y, zoom]; };
    const createEncoder = renderer.gpuDevice.createCommandEncoder;
    renderer.gpuDevice.createCommandEncoder = () => {
      const encoder = createEncoder(), begin = encoder.beginRenderPass;
      encoder.beginRenderPass = descriptor => {
        const pass = begin(descriptor), draw = pass.draw.bind(pass);
        let pipeline, group;
        pass.setPipeline = value => { pipeline = value; };
        pass.setBindGroup = (_slot, value) => { group = value; };
        pass.draw = (...args) => pipeline === "stroke" ? submitted(group.index, args[1], view) : draw(...args);
        return pass;
      };
      return encoder;
    };
  }
  const count = kind => events.filter(event => event.kind === kind).length;
  assert(renderer.shouldUsePanCache(true), check("LOD does not disable the dense scene pan cache"));
  render();
  assert.equal(renderer.panCacheRenderedSegments, 40_000, check("refresh draws the simplified level, not all source strokes"));
  assert.deepEqual(events.find(event => event.kind === "lod").view, [1800, 1080, 100, -200, .25],
    check("LOD refresh uses overscan with the live camera and zoom"));
  assert.deepEqual(events.find(event => event.kind === "selection").viewport, { width: 1800, height: 1080 });
  const uploads = count("upload");
  renderer.cameraCenterX += 100;
  render();
  assert.equal(count("selection"), 1, check("cache reuse performs no LOD scan"));
  assert.equal(count("lod"), 1, check("cache reuse submits no stroke instances"));
  assert.deepEqual(events.filter(event => event.kind === "blit").at(-1).transform, [25, 0, 1]);
  assert.deepEqual(events.filter(event => event.kind === "highlight").at(-1).view, [1000, 600, 200, -200, .25],
    check("highlights follow the live camera while geometry is cached"));

  renderer.setStrokeCurveEnabled(false);
  assert.equal(renderer.panCacheValid, false, check("style changes invalidate cached LOD pixels"));
  render();
  assert.equal(count("lod"), 2);
  assert.equal(events.filter(event => event.kind === "selection").at(-1).changed, false,
    check("an unchanged full-view selection can refresh styled pixels without rewriting IDs"));
  assert.equal(count("upload"), uploads, check("update(false) keeps valid GPU IDs during the refresh"));

  renderer.cameraCenterX += 2000;
  render();
  assert.equal(count("lod"), 3, check("coverage escape refreshes LOD geometry once"));
  assert.equal(events.filter(event => event.kind === "selection").at(-1).changed, false,
    check("a full-scene overscan refresh safely reuses the existing selection"));
  assert.deepEqual(events.filter(event => event.kind === "lod").at(-1).view, [1800, 1080, 2200, -200, .25]);
  assert.deepEqual(events.filter(event => event.kind === "blit").at(-1).transform, [0, 0, 1]);

  renderer.targetZoom = 10;
  render();
  assert.equal(count("direct"), 1, check("active zoom still bypasses cached LOD pixels"));
  assert.equal(count("lod"), 3, check("zoom does not rescale or refresh the old cache"));
  renderer.cameraCenterX = renderer.cameraCenterY = 0;
  renderer.zoom = renderer.targetZoom;
  render();
  assert.equal(renderer.panCacheZoom, 10);
  assert.equal(renderer.panCacheRenderedSegments, 320_000, check("settled close zoom refreshes exact geometry before reuse"));
  assert.equal(events.filter(event => event.kind === "lod").at(-1).index, 0);
  assert.deepEqual(events.filter(event => event.kind === "lod").at(-1).view, [1800, 1080, 0, 0, 10]);
  assert.deepEqual(events.filter(event => event.kind === "blit").at(-1).transform, [0, 0, 1]);

  renderer.cameraCenterX = 1000;
  render();
  assert.equal(renderer.panCacheRenderedSegments, 0, check("leaving all geometry clears the cache instead of replaying stale IDs"));
  assert.equal(runtime.getRenderedSegmentCount(), 0);
  assert.equal(count("lod"), 4);
}
