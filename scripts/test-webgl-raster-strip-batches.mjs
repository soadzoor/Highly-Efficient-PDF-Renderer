import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });

try {
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { buildRasterStripBatches } = await import("../src/rasterStripBatches.ts");
  const scene = Object.assign(createEmptyVectorScene(), {
    optionalContent: { groups: [], conditions: [{ kind: "constant", value: true }, { kind: "constant", value: true }], order: [], radioGroups: [] },
    rasterLayers: Array.from({ length: 9 }, (_, index) => strip(index)),
    drawRuns: [
      { kind: "raster", first: 0, count: 4, clipIndex: 0, optionalContent: 0 },
      { kind: "fill", first: 0, count: 1 },
      { kind: "raster", first: 4, count: 4, clipIndex: 1, optionalContent: 1 },
      { kind: "raster", first: 8, count: 1 }
    ]
  });
  const canonical = structuredClone(scene);
  const { renderer, mock } = makeRenderer(WebGlFloorplanRenderer, scene);
  renderer.uploadRasterLayers(scene);
  assert.equal(renderer.rasterLayers.length, 9, "canonical resources remain available for fallback");
  assert.equal(renderer.rasterStripBatches.size, 2);
  assert.equal(mock.count("texImage2D"), 11);
  assert.equal(mock.count("generateMipmap"), 9, "atlas rows never receive automatic cross-image mipmaps");
  assert.equal(mock.count("bufferData"), 2);
  const atlasUploads = mock.calls.filter(call => call[0] === "texImage2D").slice(9);
  const expectedAtlases = buildRasterStripBatches(scene, 4096, "linear");
  atlasUploads.forEach((call, index) => assert.deepEqual(call.at(-1), expectedAtlases[index].data,
    "WebGL uploads independently filtered linear mip levels, including odd image widths"));
  const batches = [...renderer.rasterStripBatches.values()];
  for (const batch of batches) {
    assert.equal(batch.data, undefined, "uploaded batch pixels are not retained");
    assert.equal(batch.instances, undefined, "uploaded instance arrays are not retained");
    const attributes = mock.vaos.get(batch.vao);
    assert.deepEqual([...attributes.values()].map(attribute => [attribute.size, attribute.stride, attribute.offset, attribute.divisor]),
      [[4, 32, 0, 1], [4, 32, 16, 1]]);
    assert([...attributes.values()].every(attribute => attribute.buffer === batch.buffer && attribute.enabled));
  }
  mock.clear();
  renderer.drawSourceOrderedContent(100, 80, 50, 40, 2);
  assert.deepEqual(mock.events, [["batch", 4, 0], ["fill", 0, 1], ["batch", 4, 1], ["raster", 8]],
    "instanced raster submission preserves clips and the intervening vector paint");
  assert.equal(renderer.performanceProfiler.counters.drawBatches, 4, "profiler counts submitted draws, not original images");
  assert(mock.paints.every(paint => paint.texture && paint.uniforms.get("uRasterStripTex") === 12));
  assert(mock.paints.every(paint => paint.uniforms.get("uZoom") === 2));
  mock.clear();
  renderer.drawSourceOrderedContent(100, 80, 52, 41, 2);
  assert.equal(mock.count("texImage2D") + mock.count("bufferData"), 0, "panning reuses atlas and instance resources");
  assert(mock.paints.every(paint => paint.uniforms.get("uCameraCenter")[0] === 52));

  renderer.setOptionalContentVisibility({ revision: 1, conditions: Uint8Array.of(0, 1) });
  mock.clear();
  renderer.drawSourceOrderedContent(100, 80, 50, 40, 2);
  assert.deepEqual(mock.events, [["fill", 0, 1], ["batch", 4, 1], ["raster", 8]], "hidden canonical runs stay hidden");
  renderer.setOptionalContentVisibility({ revision: 2, conditions: Uint8Array.of(1, 1) });

  renderer.orderedBatches = { update: () => false, batches: [{ ...scene.drawRuns[0], first: 1, count: 2 }] };
  mock.clear();
  renderer.drawSourceOrderedContent(100, 80, 50, 40, 2);
  assert.deepEqual(mock.events, [["raster", 1], ["raster", 2]], "partial ranges cannot submit unselected atlas rows");
  renderer.orderedBatches.batches = [{ ...scene.drawRuns[0], count: 3 }];
  mock.clear();
  renderer.drawSourceOrderedContent(100, 80, 50, 40, 2);
  assert.deepEqual(mock.events, [["raster", 0], ["raster", 1], ["raster", 2]], "truncated batches use original images");
  renderer.orderedBatches = null;

  const cancelled = renderer.prepareRasterLayerUpdates(new Map([[0, strip(20)]]));
  cancelled.dispose();
  assert.equal(renderer.rasterStripBatches.size, 2, "cancelled updates retain current batches");
  const replacement = strip(30);
  const staged = renderer.prepareRasterLayerUpdates(new Map([[0, replacement]]));
  assert.equal(renderer.rasterStripBatches.size, 2, "preparing updates does not change presented resources");
  staged.commit();
  assert.equal(renderer.rasterStripBatches.size, 0, "committed replacements invalidate stale atlases");
  for (const batch of batches) {
    assert(!mock.alive.has(batch.texture) && !mock.alive.has(batch.buffer) && !mock.alive.has(batch.vao));
  }
  mock.clear();
  renderer.drawSourceOrderedContent(100, 80, 50, 40, 2);
  assert.equal(mock.events.filter(event => event[0] === "raster").length, 9);
  assert.equal(mock.events.filter(event => event[0] === "batch").length, 0);
  renderer.setRasterTextureResidency(false);
  assert.equal(renderer.rasterLayers.length, 0);
  renderer.setRasterTextureResidency(true);
  assert.equal(renderer.rasterLayers.length, 9);
  assert.equal(renderer.rasterStripBatches.size, 0, "residency restoration cannot reintroduce source pixels after replacement");
  assert.deepEqual(renderer.rasterLayers[0].matrix, replacement.matrix);
  assert.deepEqual(scene, canonical, "render-only batching and replacements preserve the canonical scene");

  const fresh = makeRenderer(WebGlFloorplanRenderer, scene);
  fresh.renderer.uploadRasterLayers(scene);
  const old = [...fresh.renderer.rasterStripBatches.values()];
  fresh.renderer.setRasterTextureResidency(false);
  assert.equal(fresh.renderer.rasterStripBatches.size, 0);
  for (const batch of old) assert(!fresh.mock.alive.has(batch.texture) && !fresh.mock.alive.has(batch.buffer) && !fresh.mock.alive.has(batch.vao));
  fresh.renderer.setRasterTextureResidency(true);
  assert.equal(fresh.renderer.rasterStripBatches.size, 2);
  fresh.renderer.destroyRasterLayerTextures();
  fresh.renderer.destroyRasterLayerTextures();
  assert.equal([...fresh.mock.alive].filter(resource => resource.kind !== "program").length, 0, "raster cleanup is complete and idempotent");

  // An optimization allocation failure must release partial atlases while
  // leaving the successfully uploaded original document renderable.
  const failing = makeRenderer(WebGlFloorplanRenderer, scene);
  failing.mock.failBufferAt = 2;
  const warn = console.warn, warnings = [];
  console.warn = (...args) => warnings.push(args);
  try { failing.renderer.uploadRasterLayers(scene); }
  finally { console.warn = warn; }
  assert.equal(warnings.length, 1);
  assert.equal(failing.renderer.rasterLayers.length, 9);
  assert.equal(failing.renderer.rasterStripBatches.size, 0);
  assert.equal([...failing.mock.alive].filter(resource => resource.kind === "texture").length, 9);
  assert.equal([...failing.mock.alive].filter(resource => resource.kind === "buffer" || resource.kind === "vao").length, 0);
  failing.renderer.drawSourceOrderedContent(100, 80, 50, 40, 2);
  assert.equal(failing.mock.events.filter(event => event[0] === "raster").length, 9);
  failing.renderer.destroyRasterLayerTextures();
  renderer.destroyRasterLayerTextures();
  console.log("WebGL raster strip batches: upload, clipping, paint order, visibility, partial draws, panning, replacement, residency and failure cleanup passed.");
} finally { hooks.deregister(); }

function strip(index) {
  const width = 3 + index % 5;
  return { width, height: 1, data: Uint8Array.from({ length: width * 4 }, (_, component) => component % 4 === 3 ? 128 : index * 3),
    matrix: Float32Array.of(width, 0, 0, -1, index, 20), opacity: 0.5, pageIndex: 0, paintOrder: index };
}

function makeRenderer(Renderer, scene) {
  const mock = mockGl();
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    gl: mock.gl, scene, isDisposed: false, rasterTextureResidencyEnabled: true, rasterLayers: [],
    rasterStripBatches: new Map(), rasterStripProgram: null, rasterLayerUpdates: new Map(),
    // Isolate the strip fallback here; texture batching has compositor tests.
    rasterTextureBatchUnavailable: true,
    rasterRenderingEnabled: true, fillRenderingEnabled: true, strokeRenderingEnabled: true, textRenderingEnabled: true,
    optionalContentVisibility: { revision: 0, conditions: Uint8Array.of(1, 1) },
    vectorClipIndex: -1, vectorClipTexture: {}, vectorClipUniforms: new Map(), multiplyPass: null,
    multiplyUniforms: new Map(), paintShapeUniforms: new Map(), orderedTextureBindings: [],
    orderedUniformPrograms: new Set(), orderedPaintUniformStates: new Map(), orderedInstanceVaos: new Set(),
    performanceProfiler: { enabled: true, counters: {}, beginSection() {}, endSection() {},
      add(name, value = 1) { this.counters[name] = (this.counters[name] ?? 0) + value; } },
    drawPageBackgrounds() {}, destroyVectorMinifyResources() {}, requestFrame() {},
    drawFilledPaths(_w, _h, _x, _y, _zoom, first, count) { mock.events.push(["fill", first, count]); },
    drawRasterLayerAtIndex(index) { assert(this.rasterLayers[index]); mock.events.push(["raster", index]); }
  });
  return { renderer, mock };
}

function mockGl() {
  const calls = [], events = [], paints = [], alive = new Set(), vaos = new Map(), uniforms = new Map(), textures = new Map();
  let nextId = 0, program, vao, buffer, active = 0, buffers = 0;
  const state = { calls, events, paints, alive, vaos, failBufferAt: -1,
    count(name) { return calls.filter(call => call[0] === name).length; },
    clear() { calls.length = events.length = paints.length = 0; } };
  const attribute = index => {
    if (!vaos.has(vao)) vaos.set(vao, new Map());
    if (!vaos.get(vao).has(index)) vaos.get(vao).set(index, {});
    return vaos.get(vao).get(index);
  };
  state.gl = new Proxy({ TEXTURE0: 1000, TEXTURE12: 1012 }, { get(target, name) {
    if (name in target) return target[name];
    if (name.toUpperCase() === name) return name;
    return (...args) => {
      calls.push([name, ...args]);
      if (name.startsWith("create")) {
        if (name === "createBuffer" && ++buffers === state.failBufferAt) return null;
        const kind = name === "createVertexArray" ? "vao" : name.slice(6).toLowerCase();
        const resource = { kind, id: ++nextId }; alive.add(resource); return resource;
      }
      if (name.startsWith("delete")) { alive.delete(args[0]); return; }
      if (name === "getParameter") return 4096;
      if (name === "getShaderParameter" || name === "getProgramParameter") return true;
      if (name === "getUniformLocation") return { program: args[0], name: args[1] };
      if (name === "useProgram") { program = args[0]; if (!uniforms.has(program)) uniforms.set(program, new Map()); }
      if (name.startsWith("uniform")) {
        assert.equal(args[0].program, program);
        uniforms.get(program).set(args[0].name, args.length > 2 ? args.slice(1) : args[1]);
      }
      if (name === "activeTexture") active = args[0] - 1000;
      if (name === "bindTexture") textures.set(active, args[1]);
      if (name === "bindVertexArray") vao = args[0];
      if (name === "bindBuffer") buffer = args[1];
      if (name === "enableVertexAttribArray") attribute(args[0]).enabled = true;
      if (name === "vertexAttribDivisor") attribute(args[0]).divisor = args[1];
      if (name === "vertexAttribPointer") Object.assign(attribute(args[0]), { buffer, size: args[1], stride: args[4], offset: args[5] });
      if (name === "drawArraysInstanced") {
        assert.equal(args[0], "TRIANGLE_STRIP"); assert.equal(args[1], 0); assert.equal(args[2], 4);
        const values = new Map(uniforms.get(program));
        paints.push({ uniforms: values, texture: textures.get(12) });
        events.push(["batch", args[3], values.get("uVectorClipIndex")]);
      }
    };
  } });
  return state;
}
