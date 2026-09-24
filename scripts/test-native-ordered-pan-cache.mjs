import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

try {
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");
  for (const [backend, Renderer] of [["WebGL", WebGlFloorplanRenderer], ["WebGPU", WebGpuFloorplanRenderer]]) {
    const { renderer, events, render } = fixture(backend, Renderer);
    const check = message => `${backend}: ${message}`;
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
  console.log("Native source-ordered pan cache dispatch, reuse, invalidation, and overlay tests passed");
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
