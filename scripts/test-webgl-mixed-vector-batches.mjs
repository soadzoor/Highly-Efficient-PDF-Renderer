import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });
try {
  const { WebGlFloorplanRenderer: Renderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const makeScene = () => ({ ...createEmptyVectorScene(), segmentCount: 4, fillPathCount: 4,
    textInstanceCount: 1, pageRects: Float32Array.of(0, 0, 100, 100),
    endpoints: Float32Array.of(10, 10, 20, 20, 10, 20, 20, 10, 30, 10, 40, 20, 30, 20, 40, 10),
    primitiveMeta: Float32Array.of(20, 20, 0, 1, 20, 10, 0, 1, 40, 20, 0, 1, 40, 10, 0, 1),
    primitiveBounds: Float32Array.of(10, 10, 20, 20, 10, 10, 20, 20, 30, 10, 40, 20, 30, 10, 40, 20),
    styles: Float32Array.of(.1, 1, 0, 0, .1, 0, 1, 0, .1, 0, 0, 1, .1, 1, 0, 1),
    fillPathMetaA: Float32Array.of(0, 4, 10, 10, 0, 4, 20, 20, 0, 4, 30, 30, 0, 4, 40, 40),
    fillPathMetaB: Float32Array.of(20, 20, 1, 0, 30, 30, 0, 1, 40, 40, 0, 0, 50, 50, 1, 0),
    fillPathMetaC: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1) });
  const indirect = (kind, first, count = 1, extra = {}) => ({ kind, first, count, clipIndex: -2, ...extra });
  const makePlan = (count = 8) => {
    const instances = Uint32Array.from({ length: count * 2 }, (_, index) =>
      index % 2 === 0 ? Math.floor(index / 4) % 4 : Math.floor(index / 2) % 3);
    return { batches: Array.from({ length: count }, (_, index) => indirect(index % 2 === 0 ? "stroke" : "fill", index)),
      uintInstances: instances, get floatInstances() { return Float32Array.from(this.uintInstances); },
      instanceCount: count, batchSegments: [], revision: 1, coverageRevision: 1, spanOrdered: true,
      colorBatchingEnabled: true, blackDarkenSourceOverEnabled: true, culledSegmentCount: 0,
      pending: false, update() { const result = this.pending; this.pending = false; return result; } };
  };
  const setup = (options = {}, limits = {}) => {
    const mock = mockGl(limits);
    const renderer = new Renderer({ width: 100, height: 100, getContext: () => mock.gl }, options);
    renderer.setExternalFrameDriver(true);
    const counters = new Map();
    renderer.performanceProfiler = { enabled: true, geometryDiagnostics: false,
      add(name, count = 1) { counters.set(name, (counters.get(name) ?? 0) + count); },
      beginSection() {}, endSection() {}, dispose() {} };
    const install = (plan, scene = makeScene()) => {
      scene.drawRuns = plan.batches.map(batch => ({ ...batch,
        first: plan.uintInstances[batch.first * 2] ?? batch.first, clipIndex: undefined }));
      Object.assign(renderer, { scene, pageRects: scene.pageRects, fillPathCount: scene.fillPathCount,
        segmentCount: scene.segmentCount, textInstanceCount: scene.textInstanceCount,
        orderedBatches: plan, orderedRunCuller: null, scenePaintVisibility: null });
      renderer.orderedInstanceBuffer ??= mock.gl.createBuffer();
      mock.gl.bindBuffer(mock.gl.ARRAY_BUFFER, renderer.orderedInstanceBuffer);
      mock.gl.bufferData(mock.gl.ARRAY_BUFFER, plan.floatInstances, mock.gl.DYNAMIC_DRAW);
      renderer.vectorLodLevels = [{ textureA: renderer.segmentTextureA, textureB: renderer.segmentTextureB,
        textureC: renderer.segmentTextureC, textureD: renderer.segmentTextureD,
        textureWidth: 2, textureHeight: 2, ownsTextures: false, visibleSegmentIdBuffer: renderer.orderedInstanceBuffer }];
      renderer.setAllPagesAndTextVisible();
      return scene;
    };
    const frame = (x = 50) => {
      mock.clear(); counters.clear(); renderer.frameDrawCalls = 0;
      const strokes = renderer.drawSourceOrderedContent(100, 100, x, 50, 1);
      assert.equal(renderer.frameDrawCalls, mock.draws.length, "frame counters describe actual GL submissions");
      return strokes;
    };
    return { mock, renderer, counters, install, frame };
  };

  for (const combined of [16, 19, 32]) {
    const h = setup({}, { combined }), { renderer: r, mock, counters } = h;
    const plan = makePlan(4_096); h.install(plan);
    assert.equal(h.frame(), 2_048);
    const gpu = r.mixedVectorGpu, mixed = mock.draws.filter(draw => draw.program === gpu.program);
    assert.equal(mock.draws.length, 2, "4,096 alternating paints and the page background require two draws");
    assert.equal(mixed.length, 1); assert.equal(mixed[0].args[3], 4_096);
    assert.equal(counters.get("mixedVectorBatches"), 1);
    assert.equal(counters.get("strokeInstances"), 2_048);
    assert.equal(counters.get("fillInstances"), 2_048);
    assert.equal(counters.get("mixedVectorInstanceUploadBytes"), 4_096 * 12);
    assert.equal(counters.get("sourcePaints"), 4_096);
    const attributes = mixed[0].attributes;
    for (const [location, offset] of [[1, 0], [4, 4], [5, 8]]) {
      assert.deepEqual(attributes.get(location), { enabled: true, divisor: 1,
        buffer: gpu.buffer, size: 1, stride: 12, offset }, "mixed ID, clip and kind attributes share one packed buffer");
    }
    const uploaded = mock.uploads.get(gpu.buffer);
    for (let index = 0; index < plan.instanceCount; index++) {
      assert.deepEqual(uploaded.slice(index * 3, index * 3 + 3),
        [plan.uintInstances[index * 2], plan.uintInstances[index * 2 + 1], index % 2],
        "the GPU receives painter order with each original ID and clip");
    }
    for (const [unit, texture] of [r.segmentTextureA, r.segmentTextureB, r.segmentTextureC, r.segmentTextureD,
      r.fillPathMetaTextureA, r.fillPathMetaTextureB, r.fillPathMetaTextureC, r.fillSegmentTextureA, r.fillSegmentTextureB].entries()) {
      assert.equal(mixed[0].textures.get(unit), texture, "both branches receive their original geometry textures");
    }
    assert.equal(mixed[0].uniforms.get("uVectorClipIndex"), -2);
    assert.equal(mixed[0].textures.get(mixed[0].uniforms.get("uVectorClipTex")), r.vectorClipTexture);
    assert.equal(r.describeProgram(gpu.program), "mixedVector");
    const description = r.describeDrawSource(gpu.program, plan.instanceCount);
    assert.deepEqual(description, { kind: "mixed-vector", first: 0, indirect: true,
      ids: Array.from({ length: 32 }, (_, index) => plan.uintInstances[index * 2]),
      clips: Array.from({ length: 32 }, (_, index) => plan.uintInstances[index * 2 + 1] - 1),
      kinds: Array.from({ length: 32 }, (_, index) => index % 2 === 0 ? "stroke" : "fill"), truncated: true },
    "GPU operation diagnostics identify mixed primitive kinds and bound their copied IDs");
    assert.equal(r.describeDrawSource(gpu.program, 3).truncated, false);
    assert.equal(r.describeDrawSource(gpu.program, 3).ids.length, 3);
    const areaMetrics = ["fillUnclippedQuadPixelsEstimate", "fillQuadPixelsEstimate", "fillClipBoundsTestedInstances",
      "fillClipBoundedInstances", "fillClipCulledInstances"];
    r.performanceProfiler.geometryDiagnostics = true;
    h.frame();
    const mixedAreas = areaMetrics.map(name => counters.get(name));
    assert.equal(counters.get("fillQuadPixelsEstimate"), 2_048 * 12 * 12,
      "mixed geometry diagnostics count only the padded fill quads, skipping every stroke instance");
    r.setMixedVectorBatchingEnabled(false); h.frame();
    assert.deepEqual(areaMetrics.map(name => counters.get(name)), mixedAreas,
      "mixed and separate submissions report the same fill geometry estimates");
    r.setMixedVectorBatchingEnabled(true);
    r.performanceProfiler.geometryDiagnostics = false;
    h.frame(51);
    assert.equal(mock.calls.filter(([name]) => name === "bufferData").length, 0, "stable camera frames reuse all instance uploads");
    assert.equal(counters.get("mixedVectorInstanceUploadBytes"), undefined);
    plan.uintInstances[0] = 3; plan.revision++; plan.pending = true;
    h.frame();
    assert.equal(mock.uploads.get(gpu.buffer)[0], 3, "a changed LOD selection refreshes the mixed buffer");
    assert.equal(counters.get("mixedVectorInstanceUploadBytes"), 4_096 * 12);
    assert.equal(mock.calls.filter(([name]) => name === "bufferData").length, 2, "replanning uploads ordinary and mixed IDs once");
    r.setMixedVectorBatchingEnabled(false); assert.equal(r.getMixedVectorBatchingEnabled(), false);
    h.frame(); assert.equal(mock.draws.length, 4_097, "the comparison switch restores ordinary separate draws");
    assert.equal(counters.get("mixedVectorBatches"), undefined);
    r.setMixedVectorBatchingEnabled(true); h.frame(); assert.equal(mock.draws.length, 2);
    assert.equal(mock.calls.filter(([name]) => name === "bufferData").length, 0, "reenabling reuses unchanged mixed data");
    r.setFillRenderingEnabled(false); h.frame();
    assert.equal(mock.draws.length, 2_049, "hidden fills never reach the mixed shader");
    assert(mock.draws.every(draw => draw.program !== gpu.program));
    r.setFillRenderingEnabled(true); r.setStrokeRenderingEnabled(false); h.frame();
    assert.equal(mock.draws.length, 2_049, "hidden strokes never reach the mixed shader");
    r.setStrokeRenderingEnabled(true);
    const previousPlan = r.mixedVectorBatches;
    const replacement = makeScene();
    replacement.drawRuns = [{ kind: "stroke", first: 0, count: 4 }, { kind: "fill", first: 0, count: 4 }];
    r.vectorLodMode = "off";
    r.rebuildVectorLod(replacement);
    assert.equal(r.mixedVectorBatches, null, "rebuilding a scene releases the mixed plan retaining the old scene");
    assert.equal(r.mixedVectorGpu.revision, -1, "rebuilding invalidates the old mixed upload");
    assert(previousPlan !== r.mixedVectorBatches);
    r.dispose(); r.dispose();
    for (const resource of [gpu.program, gpu.buffer, gpu.vao]) assert(mock.deleted.has(resource), "disposal releases optional mixed resources");
    assert.equal(r.mixedVectorBatches, null); assert.equal(r.orderedBatches, null);
  }

  const disabled = setup({ mixedVectorBatching: false }); disabled.install(makePlan()); disabled.frame();
  assert.equal(disabled.mock.draws.length, 9);
  assert.equal(disabled.renderer.mixedVectorGpu, null, "the constructor option avoids optional GPU setup");
  disabled.renderer.dispose();
  const single = setup(), singlePlan = makePlan();
  singlePlan.batches.forEach(run => { run.kind = "stroke"; }); single.install(singlePlan); single.frame();
  assert.equal(single.mock.draws.length, 9); assert.equal(single.renderer.mixedVectorGpu, null);
  single.renderer.dispose();

  const barriers = setup(), barrierPlan = makePlan(5);
  barrierPlan.batches = [indirect("stroke", 0), indirect("fill", 1), indirect("text", 2),
    indirect("stroke", 3), indirect("fill", 4)];
  barriers.install(barrierPlan); barriers.frame();
  assert.deepEqual(barriers.mock.draws.map(draw => draw.program), [barriers.renderer.pageBackgroundProgram,
    barriers.renderer.mixedVectorGpu.program, barriers.renderer.textProgram, barriers.renderer.mixedVectorGpu.program],
    "text remains between the two mixed paint ranges");
  assert.equal(barriers.mock.draws.at(-1).attributes.get(1).offset, 24,
    "the later mixed draw uses its own offset in the triple buffer");
  barrierPlan.batches[2] = indirect("stroke", 2, 1, { blendMode: "Multiply" }); barrierPlan.revision++;
  barriers.install(barrierPlan); barriers.frame();
  assert.equal(barriers.mock.draws.filter(draw => draw.program === barriers.renderer.segmentProgram).length, 2,
    "Multiply retains both source-ordered passes between mixed ranges");
  assert.equal(barriers.mock.draws.filter(draw => draw.program === barriers.renderer.mixedVectorGpu.program).length, 2);
  const composited = makeScene(); composited.paintGraph = { roots: [{ kind: "group", isolated: true,
    knockout: false, alpha: .5, blendMode: "Normal", children: [{ kind: "draw", runIndex: 0 }] }] };
  const compositePlan = makePlan(2); compositePlan.spanOrdered = false;
  barriers.install(compositePlan, composited);
  let compositeCalls = 0;
  barriers.renderer.paintCompositor = { paintPlanReused: false, paintPlanOperations: 2,
    render(scene, _width, _height, draw) { compositeCalls++; draw(scene.drawRuns, false); }, dispose() {} };
  barriers.frame();
  assert.equal(compositeCalls, 1);
  assert(barriers.mock.draws.every(draw => draw.program !== barriers.renderer.mixedVectorGpu.program),
    "compositing keeps the ordinary surface and paint submission path");
  barriers.renderer.dispose();

  const limits = [{ vertex: 8 }, { fragment: 2 }, { varying: 9 }];
  for (const limit of limits) checkFallback(limit);
  for (const failure of ["vertex", "fragment", "link", "buffer", "vao", "uniform", "upload"]) checkFallback({}, failure);
  function checkFallback(limit, failure) {
    const h = setup({}, limit), { renderer: r, mock } = h;
    h.install(makePlan());
    const resourcesBefore = mock.created.length;
    mock.failure = failure;
    const warn = console.warn, warnings = [];
    console.warn = (...args) => warnings.push(args);
    try {
      h.frame(); h.frame();
      assert.equal(mock.draws.length, 9, "optional setup failures leave every ordinary paint drawable");
      assert.equal(warnings.length, 1, "an unsupported mixed path reports its fallback once");
      assert.match(warnings[0][0], /Mixed vector batching unavailable/);
      assert.equal(r.mixedVectorGpu, null); assert.equal(r.mixedVectorBatches, null);
      for (const resource of mock.created.slice(resourcesBefore)) {
        assert(mock.deleted.has(resource), `${failure ?? JSON.stringify(limit)} releases partial ${resource.kind} allocation`);
      }
    } finally { console.warn = warn; mock.failure = null; r.dispose(); }
  }
  console.log("WebGL mixed vector batches: draw reduction, painter/clip data, upload reuse, switches, barriers, compositing, capability/error fallbacks and resource lifecycle passed");
} finally { hooks.deregister(); }

function mockGl(limits = {}) {
  const mock = { calls: [], draws: [], uploads: new Map(), created: [], deleted: new Set(), failure: null };
  const vaos = new Map(), uniforms = new Map(), textures = new Map();
  let vao, buffer, program, active = 0, nextId = 0;
  const attribute = location => {
    if (!vaos.has(vao)) vaos.set(vao, new Map());
    if (!vaos.get(vao).has(location)) vaos.get(vao).set(location, { enabled: false, divisor: 0 });
    return vaos.get(vao).get(location);
  };
  const gl = new Proxy({}, { get(_target, name) {
    if (name === "TEXTURE0") return 1000;
    if (name.toUpperCase() === name) return name;
    return (...args) => {
      mock.calls.push([name, ...args]);
      if (name.startsWith("create")) {
        if ((name === "createBuffer" && mock.failure === "buffer") ||
            (name === "createVertexArray" && mock.failure === "vao")) return null;
        const resource = { id: ++nextId, kind: name.slice(6), type: args[0], optional: mock.failure !== null };
        mock.created.push(resource); return resource;
      }
      if (name.startsWith("delete")) { if (args[0]) mock.deleted.add(args[0]); return; }
      if (name === "getParameter") return ({ MAX_COMBINED_TEXTURE_IMAGE_UNITS: limits.combined ?? 32,
        MAX_VERTEX_TEXTURE_IMAGE_UNITS: limits.vertex ?? 16, MAX_TEXTURE_IMAGE_UNITS: limits.fragment ?? 16,
        MAX_VARYING_VECTORS: limits.varying ?? 16, MAX_TEXTURE_SIZE: 4096 })[args[0]] ?? 4096;
      if (name === "getShaderParameter") return !((mock.failure === "vertex" && args[0].type === gl.VERTEX_SHADER) ||
        (mock.failure === "fragment" && args[0].type === gl.FRAGMENT_SHADER));
      if (name === "getProgramParameter") return mock.failure !== "link";
      if (name === "getShaderInfoLog" || name === "getProgramInfoLog") return "test failure";
      if (name === "getUniformLocation") return mock.failure === "uniform" && args[1] === "uSegmentTexSize"
        ? null : { program: args[0], name: args[1] };
      if (name === "useProgram") program = args[0];
      if (name === "bindVertexArray") vao = args[0];
      if (name === "bindBuffer") buffer = args[1];
      if (name === "bufferData") {
        if (mock.failure === "upload" && buffer.optional) throw new Error("test upload failure");
        mock.uploads.set(buffer, Array.from(args[1]));
      }
      if (name === "enableVertexAttribArray") attribute(args[0]).enabled = true;
      if (name === "disableVertexAttribArray") attribute(args[0]).enabled = false;
      if (name === "vertexAttribDivisor") attribute(args[0]).divisor = args[1];
      if (name === "vertexAttribPointer") Object.assign(attribute(args[0]),
        { buffer, size: args[1], stride: args[4], offset: args[5] });
      if (name === "activeTexture") { active = args[0] - 1000; assert(active >= 0 && active < (limits.combined ?? 32)); }
      if (name === "bindTexture") textures.set(active, args[1]);
      if (name.startsWith("uniform")) {
        const location = args[0];
        assert.equal(location.program, program, "uniform updates target the active program");
        if (!uniforms.has(program)) uniforms.set(program, new Map());
        uniforms.get(program).set(location.name, name === "uniformMatrix4fv" ? Array.from(args[2]) :
          args.length === 2 ? args[1] : args.slice(1));
      }
      if (name.startsWith("drawArrays")) mock.draws.push({ args, program, vao,
        uniforms: new Map(uniforms.get(program)), textures: new Map(textures),
        attributes: new Map([...vaos.get(vao) ?? []].map(([location, value]) => [location, { ...value }])) });
    };
  } });
  mock.gl = gl;
  mock.clear = () => { mock.calls.length = mock.draws.length = 0; };
  return mock;
}
