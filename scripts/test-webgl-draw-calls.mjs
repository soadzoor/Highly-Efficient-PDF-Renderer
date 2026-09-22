import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const draws = [], frames = [];
  const gl = new Proxy({}, { get(_target, name) {
    if (name.toUpperCase() === name) return name;
    return (...args) => {
      if (name.startsWith("drawArrays")) draws.push([name, ...args]);
      if (name.startsWith("create")) return {};
      if (name === "getParameter") return 4096;
      if (name === "getShaderParameter" || name === "getProgramParameter") return true;
      if (name === "checkFramebufferStatus") return gl.FRAMEBUFFER_COMPLETE;
      if (name === "getUniformLocation") return {};
    };
  } });
  const renderer = new WebGlFloorplanRenderer({ width: 100, height: 100, getContext: () => gl });
  const scene = Object.assign(createEmptyVectorScene(), { segmentCount: 100, fillPathCount: 10, textInstanceCount: 20 });
  Object.assign(renderer, {
    scene, segmentCount: 100, fillPathCount: 10, textInstanceCount: 20, usingAllSegments: true,
    visibleTextRanges: [{ start: 0, count: 7 }, { start: 7, count: 13 }],
    pageRects: new Float32Array([0, 0, 100, 100, 0, 100, 100, 200]),
    visiblePageRectCount: 2, visiblePageRectIndices: new Uint32Array([0, 1]),
    highlightSelectionCount: 2, highlightOthersCount: 4, highlightCurrentCount: 1,
    primitiveHighlights: { draw() { gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 5); return 1; } },
    resolveClientToPixelScale: () => ({ x: 1, y: 1 }),
    updateCameraWithDamping: () => false, updatePanReleaseVelocitySample() {},
    shouldUsePanCache: () => false, shouldUseVectorMinifyPath: () => false,
    updateVisibleSet() {}, setAllPagesAndTextVisible() {},
    frameListener(stats) {
      assert.equal(stats.drawCalls, draws.length, "the callback includes every draw, including overlays");
      frames.push(stats);
    }
  });
  const frame = expected => {
    draws.length = 0;
    renderer.renderExternalFrame();
    assert.equal(frames.at(-1).drawCalls, expected);
  };
  frame(10); // Two pages, fill, stroke, two text ranges, and four overlay batches.
  frame(10); // Counts describe the current frame, rather than accumulating.
  assert.equal(frames.at(-1).renderedSegments, 100, "instances remain separate from draw calls");

  // Minified pages hold the paint scheduler's coverage margin. Every path that
  // reports stats forwards that, because order between neighbours is relaxed.
  assert.equal(frames.at(-1).paintOrderApproximated, false, "an exact schedule reports exact paint order");
  renderer.orderedBatches = { paintOrderApproximated: true, culledSegmentCount: 0 };
  frame(10);
  assert.equal(frames.at(-1).paintOrderApproximated, true, "a held margin reaches the frame listener");
  renderer.shouldUsePanCache = () => true;
  draws.length = 0;
  renderer.renderExternalFrame();
  assert.equal(frames.at(-1).paintOrderApproximated, true, "including a cached frame");
  renderer.shouldUsePanCache = () => false;
  draws.length = 0;
  assert.equal(renderer.renderProjectedFrame({ viewportWidth: 100, viewportHeight: 100, localUnitsPerPixel: 1,
    localToClip: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }).paintOrderApproximated, true,
    "and a projected one");
  renderer.orderedBatches = null;
  renderer.panCacheValid = false;
  frame(10);
  renderer.textRenderingEnabled = false;
  frame(8);
  renderer.textRenderingEnabled = true;

  renderer.shouldUsePanCache = () => true;
  frame(11); // Cache refresh draws its content and then presents it.
  frame(5); // Reuse only presents the cache and draws the live overlays.
  renderer.panCacheValid = false;
  frame(11);
  renderer.shouldUsePanCache = () => false;
  renderer.shouldUseVectorMinifyPath = () => true;
  renderer.vectorMinifyTexture = {};
  renderer.vectorMinifyFramebuffer = {};
  renderer.vectorMinifyWidth = renderer.vectorMinifyHeight = 200;
  renderer.ensureVectorMinifyResources = () => true;
  frame(11);
  renderer.shouldUseVectorMinifyPath = () => false;

  const projected = { viewportWidth: 100, viewportHeight: 100, localUnitsPerPixel: 1,
    localToClip: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
  draws.length = 0;
  assert.equal(renderer.renderProjectedFrame(projected).drawCalls, 10);
  assert.equal(renderer.renderProjectedFrame({ ...projected, localToClip: [] }).drawCalls, 0);
  assert.equal(renderer.renderProjectedFrame({ ...projected, localToClip: new Array(16).fill(NaN) }).drawCalls, 0);
  frame(10);

  // The retained paint graph adds its compositing passes. Framebuffer copies
  // and clears are not GPU draw commands and are not counted, and without a
  // knockout above it no geometric shape pass is rendered at all.
  Object.assign(renderer, { pageRects: new Float32Array(), visiblePageRectCount: 0,
    highlightSelectionCount: 0, highlightOthersCount: 0, highlightCurrentCount: 0, primitiveHighlights: null });
  scene.drawRuns = [{ kind: "fill", first: 0, count: 1 }];
  scene.paintGraph = { roots: [{ kind: "group", isolated: true, knockout: false, alpha: 0.5,
    blendMode: "Normal", children: [{ kind: "draw", runIndex: 0 }] }] };
  draws.length = 0;
  renderer.renderExternalFrame();
  assert.equal(frames.at(-1).drawCalls, 2,
    "the group's own paint and the composite carrying its opacity are both included");
  const composedCalls = frames.at(-1).drawCalls;
  frame(composedCalls);

  // Count each gradient/raster submission while leaving early exits at zero.
  renderer.frameDrawCalls = 0; draws.length = 0;
  renderer.gradientData = { gradientFillPathCount: 2, gradientStrokeRunCount: 2,
    gradientStrokeRunMetaA: new Float32Array([0, 3, 0, 0, 3, 0, 0, 0]) };
  renderer.gradientMeshRanges = new Uint32Array([0, 0, 0, 6]);
  renderer.drawGradientFillPath(-1, 100, 100, 0, 0, 1);
  renderer.drawGradientFillPath(0, 100, 100, 0, 0, 1);
  renderer.drawGradientFillPath(1, 100, 100, 0, 0, 1);
  renderer.drawGradientStrokeRun(0, 100, 100, 0, 0, 1);
  renderer.drawGradientStrokeRun(1, 100, 100, 0, 0, 1);
  renderer.rasterLayers = [{ texture: {}, opacity: 1, matrix: [1, 0, 0, 1, 0, 0] }];
  renderer.drawRasterLayerAtIndex(0, 100, 100, 0, 0, 1);
  renderer.drawRasterLayerAtIndex(1, 100, 100, 0, 0, 1);
  renderer.rasterStripProgram = { program: {}, uniforms: {} };
  renderer.drawRasterStripBatch({ vao: {}, texture: {}, width: 4, height: 4, count: 20 }, 100, 100, 0, 0, 1);
  assert.equal(renderer.frameDrawCalls, 5);
  assert.equal(renderer.frameDrawCalls, draws.length);

  renderer.scene = null;
  frame(0);
  console.log("WebGL draw calls: instancing, per-frame reset, overlays, cached/minified/projected frames, compositing and skipped draws passed");
} finally { hooks.deregister(); }
