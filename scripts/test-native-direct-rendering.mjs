import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

try {
  const { WebGlPdfRenderer } = await import("../src/webGlPdfRenderer.ts");
  const { WebGpuPdfRenderer } = await import("../src/webGpuPdfRenderer.ts");
  const legacyWebGl = await import("../src/webGlFloorplanRenderer.ts");
  const legacyWebGpu = await import("../src/webGpuFloorplanRenderer.ts");
  assert.equal(legacyWebGl.WebGlFloorplanRenderer, WebGlPdfRenderer,
    "the legacy WebGL module and class name retain constructor identity");
  assert.equal(legacyWebGpu.WebGpuFloorplanRenderer, WebGpuPdfRenderer,
    "the legacy WebGPU module and class name retain constructor identity and static factories");
  assert.equal(legacyWebGl.WebGlPdfRenderer, WebGlPdfRenderer);
  assert.equal(legacyWebGpu.WebGpuPdfRenderer, WebGpuPdfRenderer);
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { VectorDrawRunCuller, vectorViewBounds } = await import("../src/vectorDrawRunCulling.ts");
  const { VectorStrokeLodRuntime, buildRuntimeTileBuckets } = await import("../src/vectorStrokeLodCore.ts");
  const { VISIBILITY_GUARD_PIXELS: guard } = await import("../src/visibilityGuard.ts");
  const backends = [["WebGL", WebGlPdfRenderer], ["WebGPU", WebGpuPdfRenderer]];
  for (const [backend, Renderer] of backends) {
    // Meets the former paint-count threshold. Four columns let viewport
    // movement remove strokes progressively before the pointer is released.
    const count = 4096, scene = Object.assign(createEmptyVectorScene(), {
      segmentCount: count,
      drawRuns: Array.from({ length: count }, (_, first) => ({ kind: "stroke", first, count: 1 })),
      endpoints: new Float32Array(count * 4), primitiveMeta: new Float32Array(count * 4),
      styles: new Float32Array(count * 4)
    });
    for (let i = 0; i < count; i++) {
      const x = -1800 + i % 4 * 1200;
      scene.endpoints.set([x, 0, x + 2, 0], i * 4);
      scene.primitiveMeta.set([x, 0, 0, 0], i * 4);
    }
    const culler = new VectorDrawRunCuller(scene);
    const { renderer, events, render, stats } = fixture(backend, Renderer, scene, view => {
      const [width, height, x, y, zoom] = view;
      return culler.select(vectorViewBounds(width, height, x, y, zoom), 1 / zoom)
        .reduce((sum, run) => sum + run.count, 0);
    });
    // Columns sit 300 px apart at -450, -150, 150 and 450 px from the start.
    // Culling keeps a margin of `guard` pixels and selects again only once the
    // view leaves it. Each target pan leaves the previous margin, and the new
    // margin's left edge passes exactly the columns that should be dropped.
    const dropOne = guard + 100, dropTwo = Math.max(guard + 450, dropOne + guard + 10);
    const offscreen = Math.max(guard + 1000, dropTwo + guard + 10);
    renderer.beginPanInteraction();
    render();
    assert.equal(stats().renderedSegments, count, `${backend}: initial viewport includes all strokes`);
    renderer.panByPixels(-dropOne, 0); render();
    assert.equal(renderer.isPanInteracting, true);
    assert.equal(stats().renderedSegments, 3072, `${backend}: count changes before releasing the pointer`);
    renderer.panByPixels(dropOne - dropTwo, 0); render();
    assert.equal(stats().renderedSegments, 2048, `${backend}: continuing drag updates viewport selection`);
    renderer.panByPixels(dropTwo - offscreen, 0); render();
    assert.equal(stats().renderedSegments, 0, `${backend}: moving offscreen submits no strokes while dragging`);
    renderer.panByPixels(offscreen, 0); render();
    assert.equal(stats().renderedSegments, count, `${backend}: returning onscreen restores the scene`);
    renderer.endPanInteraction();
    renderer.animating = true;
    renderer.panByPixels(-(guard + 450), 0); render();
    assert.equal(stats().renderedSegments, 2048, `${backend}: translation animation also renders the current view`);
    renderer.animating = false; render();
    assert.equal(stats().renderedSegments, 2048, `${backend}: settled and moving selections match`);
    assert.equal(events.filter(e => e.kind === "ordered").length, 7, `${backend}: every frame submits scene geometry`);
    for (let index = 0; index < events.length; index += 2) {
      const draw = events[index], overlay = events[index + 1];
      assert.equal(draw.kind, "ordered"); assert.equal(overlay.kind, "highlight");
      assert.equal(draw.target, "screen"); assert.equal(overlay.target, "screen");
      assert.deepEqual(draw.view.slice(0, 2), [1000, 600], "scene uses viewport dimensions without overscan");
      assert.deepEqual(overlay.view, draw.view, "scene and overlay share the live camera");
    }
  }
  const makeRuntime = lodFixture(createEmptyVectorScene, VectorStrokeLodRuntime, buildRuntimeTileBuckets);
  for (const [backend, Renderer] of backends) checkLodDirect(backend, Renderer, makeRuntime());
  console.log("Native direct rendering: drag, inertia, live culling, overlays and vector LOD passed for WebGL and WebGPU");
} finally { hooks.deregister(); }

function fixture(backend, Renderer, scene, select = () => 0) {
  const events = [];
  let target = "screen", report;
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    scene, segmentCount: scene.segmentCount, fillPathCount: 0, textInstanceCount: 0,
    pageRects: new Float32Array(0), rasterLayers: [],
    canvas: { width: 1000, height: 600 }, zoom: .25, targetZoom: .25,
    cameraCenterX: 0, cameraCenterY: 0, isPanInteracting: false, animating: false,
    vectorLodRuntime: null, frameDrawCalls: 0, presentedFrameSerial: 0,
    strokeRenderingEnabled: true, fillRenderingEnabled: true, textRenderingEnabled: true, rasterRenderingEnabled: true,
    strokeCurveEnabled: true, needsVisibleSetUpdate: true,
    ensureRenderState() {}, updateCameraWithDamping() { return this.animating; }, updatePanReleaseVelocitySample() {},
    resolveClientToPixelScale: () => ({ x: 1, y: 1 }), requestFrame() {},
    emitFrameStats(stats) { report = stats; }, frameListener(stats) { report = stats; },
    getRedundantSegmentCount: () => 0, isPaintOrderApproximated: () => false,
    updateVisibleSet() {}, updateStrokeVisibleSet() {}
  });
  const ordered = (target, view) => {
    const count = select(view);
    renderer.orderedRunsCulled = count < scene.segmentCount;
    events.push({ kind: "ordered", target, view });
    return count;
  };
  if (backend === "WebGL") {
    renderer.gl = {
      FRAMEBUFFER: 1, COLOR_BUFFER_BIT: 2,
      bindFramebuffer(_binding, framebuffer) { target = framebuffer ?? "screen"; },
      viewport() {}, clearColor() {}, clear() {}
    };
    renderer.drawSourceOrderedContent = (width, height, x, y, zoom) => ordered(target, [width, height, x, y, zoom]);
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
          draw() { assert.fail("unexpected presentation draw"); }
        }), finish: () => ({})
      })
    };
    renderer.gpuContext = { getCurrentTexture: () => ({ createView: () => "screen" }) };
    renderer.updateCameraUniforms = (width, height, x, y) => { view = [width, height, x, y, renderer.zoom]; };
    renderer.drawSourceOrderedContentIntoPass = pass => ordered(pass.target, view);
    renderer.drawHighlightsIntoPass = (pass, width, height, x, y, zoom) => {
      events.push({ kind: "highlight", target: pass.target, view: [width, height, x, y, zoom] });
    };
  }
  return { renderer, events, render: () => renderer.render(0), stats: () => report };
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

function checkLodDirect(backend, Renderer, runtime) {
  const { renderer, events, render, stats } = fixture(backend, Renderer, runtime.levels[0].scene);
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
    let boundBuffer;
    renderer.gl.bindBuffer = (_target, buffer) => { boundBuffer = buffer; };
    renderer.gl.bufferData = (_target, ids) => upload(boundBuffer, ids);
    renderer.vectorLodLevels = runtime.levels.map((level, index) => ({ index,
      visibleSegmentIdBuffer: index, visibleSegmentIdsFloat: new Float32Array(level.segmentCount) }));
    renderer.drawStrokeInstances = (level, _buffer, count, ...view) => submitted(level.index, count, view);
  } else {
    delete renderer.updateStrokeVisibleSet;
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
  renderer.beginPanInteraction();
  render();
  assert.equal(stats().renderedSegments, 40_000, check("dragging draws the simplified level"));
  assert.deepEqual(events.find(event => event.kind === "lod").view, [1000, 600, 0, 0, .25]);
  assert.deepEqual(events.find(event => event.kind === "selection").viewport, { width: 1000, height: 600 });
  const uploads = count("upload");
  renderer.panByPixels(-25, 0); render();
  assert.equal(count("selection"), 2, check("every camera movement checks current LOD visibility"));
  assert.equal(count("lod"), 2, check("unchanged selection still draws vectors every frame"));
  assert.equal(count("upload"), uploads, check("unchanged selections retain GPU buffers"));
  assert.deepEqual(events.filter(event => event.kind === "lod").at(-1).view, [1000, 600, 100, 0, .25]);

  renderer.setStrokeCurveEnabled(false); render();
  assert.equal(count("lod"), 3, check("style changes redraw the live vector geometry"));
  assert.equal(count("upload"), uploads);
  renderer.panByPixels(-1000, 0); render();
  assert.equal(stats().renderedSegments, 0, check("leaving geometry clears the live LOD count while dragging"));
  assert.equal(runtime.getRenderedSegmentCount(), 0);
  renderer.panByPixels(1025, 0); render();
  assert.equal(stats().renderedSegments, 40_000, check("returning restores simplified geometry"));

  renderer.zoom = renderer.targetZoom = 10;
  renderer.needsVisibleSetUpdate = true; render();
  assert.equal(stats().renderedSegments, 320_000, check("close zoom restores exact geometry during interaction"));
  assert.equal(events.filter(event => event.kind === "lod").at(-1).index, 0);
  assert.deepEqual(events.filter(event => event.kind === "lod").at(-1).view, [1000, 600, 0, 0, 10]);
  renderer.endPanInteraction(); renderer.animating = true;
  renderer.panByPixels(-1000, 0); render();
  assert.equal(stats().renderedSegments, 0, check("inertia uses current LOD visibility too"));
}
