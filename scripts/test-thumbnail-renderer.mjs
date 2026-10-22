import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const original = new Map(["OffscreenCanvas", "document", "requestAnimationFrame", "cancelAnimationFrame"].map(name =>
  [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const canvases = [];
try {
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { WebGlPdfRenderer } = await import("../src/webGlPdfRenderer.ts");
  const { ThumbnailSceneRenderer, renderThumbnailScene } = await import("../src/thumbnailRenderer.ts");
  setGlobal("requestAnimationFrame", () => { throw new Error("Thumbnail work must not schedule RAF."); });
  setGlobal("cancelAnimationFrame", () => { throw new Error("Thumbnail work must not cancel RAF."); });
  setGlobal("document", { createElement() { throw new Error("Offscreen thumbnails must not allocate a DOM glyph atlas."); } });
  setGlobal("OffscreenCanvas", class {
    constructor(width, height) { const canvas = mockCanvas(width, height); canvases.push(canvas); return canvas; }
  });
  const scene = buildStrokeScene([{ points: [[10, 20], [110, 70]], width: 0 }]);
  scene.pageBounds = { minX: 10, minY: 20, maxX: 110, maxY: 70 };
  scene.pageRects = Float32Array.of(10, 20, 110, 70);
  scene.pendingPagePreviews = Uint8Array.of(1);
  const group = id => ({ id, name: id, defaultVisible: true, locked: false, usedInView: true });
  scene.optionalContent = { groups: [group("a"), group("b")], order: [], radioGroups: [],
    conditions: [{ kind: "group", groupId: "b" }, { kind: "group", groupId: "a" }] };
  const before = structuredClone(scene);
  const options = { maxDimension: 4, backend: "auto", background: [1, 1, 1, 0], vectorOverride: [0, .5, 0, .25],
    optionalContent: { revision: 7, layers: [{ id: "a", visible: false }, { id: "b", visible: true }], conditions: Uint8Array.of(0, 1) } };
  const service = new ThumbnailSceneRenderer();
  const first = await service.render(scene, options);
  assert.deepEqual(first.timings.map(timing => timing.stage), ["factory", "upload", "draw", "readback"]);
  assert(first.timings.every(timing => Number.isFinite(timing.durationMs) && timing.durationMs >= 0));
  assert.deepEqual([first.width, first.height], [4, 2], "backing dimensions follow the requested page aspect");
  assert.deepEqual([...first.rgba.slice(0, 4)], [255, 0, 0, 128], "top row is flipped and converted to straight alpha");
  assert.deepEqual([...first.rgba.slice(16, 20)], [128, 0, 0, 128], "bottom row retains its distinct coverage");
  assert.deepEqual([...first.rgba.slice(4, 8)], [0, 0, 0, 0], "fully transparent RGB is normalized");
  assert.equal(canvases.length, 1);
  const canvas = canvases[0], renderer = service.renderer;
  assert.equal(canvas.contextOptions.alpha, true);
  assert.equal(canvas.contextOptions.premultipliedAlpha, true);
  assert.equal(canvas.contextOptions.preserveDrawingBuffer, false);
  assert.deepEqual([...renderer.getOptionalContentVisibility().conditions], [1, 0], "visibility maps stable IDs into page-local conditions");
  assert.equal(renderer.getOptionalContentVisibility().revision, 7);
  assert.equal(renderer.vectorLodRuntime, null);
  assert.equal(renderer.textLodRuntime, null);
  assert.equal(renderer.orderedRunCuller, null);
  assert.equal(renderer.grid, null);
  assert.equal(renderer.highlightProgram, null);
  assert.equal(renderer.vectorCompositeProgram, null);
  assert.equal(renderer.selectedTextInstanceIdBuffer, null);
  assert.equal(renderer.scene.pendingPagePreviews, undefined, "static pages do not animate loader placeholders");
  assert(canvas.calls.some(call => call[0] === "uniform2f" && call[1].name === "uCameraCenter" && call[2] === 60 && call[3] === 45),
    "composed page offsets remain in the snapshot projection");
  assert.deepEqual(scene, before, "thumbnail generation preserves canonical scene buffers and visibility");
  const programs = canvas.calls.filter(call => call[0] === "createProgram").length;
  const second = await service.render(scene, { ...options, maxDimension: 2 });
  assert(!second.timings.some(timing => timing.stage === "factory"), "warm results do not invent a repeated factory timing");
  assert.deepEqual([second.width, second.height], [2, 1]);
  assert.equal(canvases.length, 1, "warm renders reuse their GPU context");
  assert.equal(canvas.calls.filter(call => call[0] === "createProgram").length, programs, "warm pages reuse compiled paint shaders");

  const text = { ...scene, textInstanceCount: 1, textGlyphCount: 1, textGlyphSegmentCount: 4,
    textInstanceA: Float32Array.of(1, 0, 0, 1), textInstanceB: Float32Array.of(20, 30, 0, 0), textInstanceC: Float32Array.of(0, 0, 0, 1),
    textGlyphMetaA: Float32Array.of(0, 4, 0, 0), textGlyphMetaB: Float32Array.of(1, 1, 0, 0),
    textGlyphSegmentsA: Float32Array.of(0,0,1,0, 1,0,1,1, 1,1,0,1, 0,1,0,0),
    textGlyphSegmentsB: Float32Array.of(1,0,0,0, 1,1,0,0, 0,1,0,0, 0,0,0,0), pageTextRanges: Uint32Array.of(0, 1) };
  await service.render(text, options);
  assert.equal(renderer.textRasterAtlasWidth, 1, "text does not prepare the full interactive glyph atlas");
  assert.equal(renderer.textRasterAtlasHeight, 1);
  const documentGlyphs = { ...text, textGlyphCount: 3, textGlyphSegmentCount: 12,
    textInstanceB: Float32Array.of(20, 30, 2, 0),
    textGlyphMetaA: Float32Array.of(0,4,0,0, 4,4,0,0, 8,4,0,0),
    textGlyphMetaB: Float32Array.of(1,1,0,0, 2,2,0,0, 3,3,0,0),
    textGlyphSegmentsA: Float32Array.from([...text.textGlyphSegmentsA, ...text.textGlyphSegmentsA, ...text.textGlyphSegmentsA]),
    textGlyphSegmentsB: Float32Array.from([...text.textGlyphSegmentsB, ...text.textGlyphSegmentsB, ...text.textGlyphSegmentsB]) };
  await service.render(documentGlyphs, options);
  assert.equal(renderer.scene.textGlyphCount, 1, "an extracted HEP page uploads only referenced document glyphs");
  assert.equal(renderer.scene.textGlyphSegmentCount, 4);
  assert.equal(renderer.scene.textInstanceB[2], 0);
  assert.equal(renderer.scene.textGlyphMetaA[0], 0);
  assert.equal(renderer.scene.textGlyphMetaB[0], 3, "compacted glyph metadata belongs to the referenced outline");
  assert.equal(documentGlyphs.textInstanceB[2], 2, "remapping never rewrites shared document text instances");
  assert.equal(documentGlyphs.textGlyphCount, 3);

  const linework = buildStrokeScene([
    { points: [[0, 10], [100, 10]], width: 0 },
    { points: [[0, 20], [100, 20]], width: .02 },
    { points: [[0, 30], [100, 30]], width: 40 }
  ]);
  linework.pageBounds = { minX: 0, minY: 0, maxX: 101, maxY: 53 };
  linework.pageRects = Float32Array.of(0, 0, 101, 53);
  linework.gradientCount = 1;
  linework.gradientMetaA = Float32Array.of(0, 0, 0, 0);
  linework.gradientMetaB = Float32Array.of(1, 0, 0, 1);
  linework.gradientMetaC = Float32Array.of(0, 0, 0, 0);
  linework.gradientMetaD = Float32Array.of(100, 0, 0, 0);
  linework.gradientMetaE = Float32Array.of(0, 0, 0, 0);
  linework.gradientLut = new Uint8Array(1024 * 4).fill(255);
  linework.gradientStrokeRunCount = 1; linework.gradientStrokeSegmentCount = 3;
  linework.gradientStrokeRunMetaA = Float32Array.of(0, 3, 0, -1);
  linework.gradientStrokeRunMetaB = Float32Array.of(0, 0, 0, 0);
  linework.gradientStrokeEndpoints = linework.endpoints.slice();
  linework.gradientStrokePrimitiveMeta = linework.primitiveMeta.slice();
  linework.gradientStrokePrimitiveBounds = linework.primitiveBounds.slice();
  linework.gradientStrokeStyles = linework.styles.slice();
  const lineworkBefore = structuredClone(linework);
  const lineworkPixels = await service.render(linework, { ...options, maxDimension: 10 });
  assert.deepEqual([lineworkPixels.width, lineworkPixels.height], [10, 5]);
  const localLinework = renderer.scene;
  for (const key of ["styles", "gradientStrokeStyles"]) {
    assert.equal(localLinework[key], linework[key], "overview rendering reuses source styles without copying or widening them");
    assert.equal(localLinework[key][0], 0, "native device hairlines retain zero half-width");
    assert.equal(localLinework[key][4], lineworkBefore[key][4], "thin positive half-widths retain source geometry");
    assert.equal(localLinework[key][8], 20, "larger source widths remain unchanged");
    assert.deepEqual([...localLinework[key]].filter((_, index) => index % 4), [...linework[key]].filter((_, index) => index % 4),
      "overview rendering preserves all style color channels");
  }
  assert.equal(localLinework.maxHalfWidth, linework.maxHalfWidth, "the display floor does not rewrite source width metadata");
  const widths = canvas.calls.filter(call => call[0] === "uniform1f" && call[1].name === "uMinimumStrokeWidthPx");
  assert(widths.length > 0 && widths.every(call => call[2] === 1), "solid and gradient thumbnail shaders use the shared one-output-pixel minimum across sizes");
  assert.deepEqual(linework, lineworkBefore, "stronger overview linework never changes canonical geometry, styles, clips or width metadata");
  const cancelled = new AbortController(); cancelled.abort(new Error("removed PDF"));
  await assert.rejects(async () => service.render(scene, options, cancelled.signal), /removed PDF/);
  const queuedCancellation = new AbortController();
  const pending = service.render(scene, options);
  const queued = service.render(scene, options, queuedCancellation.signal);
  queuedCancellation.abort(new Error("replaced queued PDF"));
  await assert.rejects(queued, /replaced queued PDF/);
  await pending;
  service.close(); service.close();
  assert.equal(canvas.lost, true);
  assert.deepEqual([canvas.width, canvas.height], [0, 0]);
  await assert.rejects(async () => service.render(scene, options), /closed/);
  await assert.rejects(renderThumbnailScene(scene, { ...options, backend: "canvas2d" }), /Canvas2D.*PDF/);

  setGlobal("OffscreenCanvas", class { constructor() { return { width: 1, height: 1, getContext: () => null }; } });
  let domCanvases = 0;
  setGlobal("document", { createElement(name) { assert.equal(name, "canvas"); domCanvases++; return mockCanvas(1, 1); } });
  await renderThumbnailScene(scene, options);
  assert.equal(domCanvases, 1, "a DOM WebGL canvas supplies the fallback when Offscreen WebGL is unavailable");
  setGlobal("OffscreenCanvas", undefined); setGlobal("document", undefined);
  await assert.rejects(renderThumbnailScene(scene, options), error => error.code === "thumbnail.webgl-unavailable");

  const interactiveCanvas = mockCanvas(2, 1), thumbnailCanvas = mockCanvas(2, 1);
  const interactive = new WebGlPdfRenderer(interactiveCanvas);
  const thumbnail = new WebGlPdfRenderer(thumbnailCanvas, { thumbnail: true });
  assert(thumbnailCanvas.calls.filter(call => call[0] === "createProgram").length < interactiveCanvas.calls.filter(call => call[0] === "createProgram").length,
    "snapshot construction omits interactive shader programs");
  assert(thumbnailCanvas.calls.filter(call => call[0] === "createBuffer").length < interactiveCanvas.calls.filter(call => call[0] === "createBuffer").length,
    "snapshot construction omits interactive buffers");
  interactive.dispose(); thumbnail.dispose();
  console.log("Thumbnail renderer: sizing, offset bounds, alpha/readback, immutable scenes, overview stroke widths, local visibility, warm reuse, no LOD/atlas/RAF, fallback, cancellation and disposal passed.");
} finally {
  for (const [name, descriptor] of original) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  hooks.deregister();
}

function setGlobal(name, value) { Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); }

function mockCanvas(width, height) {
  const canvas = { width, height, calls: [], lost: false };
  const gl = new Proxy({}, { get(_target, name) {
    if (name === "TEXTURE0") return 1000;
    if (name.toUpperCase() === name) return name;
    return (...args) => {
      canvas.calls.push([name, ...args]);
      if (name.startsWith("create")) return {};
      if (name === "getParameter") return 4096;
      if (name === "getExtension") return args[0] === "WEBGL_lose_context" ? { loseContext() { canvas.lost = true; } } : null;
      if (name === "getShaderParameter" || name === "getProgramParameter") return true;
      if (name === "getUniformLocation") return { name: args[1] };
      if (name === "isContextLost") return canvas.lost;
      if (name === "readPixels") {
        const [, , pixelWidth, pixelHeight, , , rgba] = args;
        for (let row = 0; row < pixelHeight; row++) for (let x = 0; x < pixelWidth; x++) {
          rgba.set(x === 1 ? [9, 9, 9, 0] : [row === 0 ? 64 : 128, 0, 0, 128], (row * pixelWidth + x) * 4);
        }
      }
    };
  } });
  canvas.getContext = (_kind, options) => { if (options) canvas.contextOptions = options; return gl; };
  return canvas;
}
