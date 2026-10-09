import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });
try {
  const { WebGpuPaintCompositor, beginPdfManagedRenderPass } = await import("../src/webGpuPaintCompositor.ts");
  const { WebGpuPaintFolds } = await import("../src/webGpuPaintFold.ts");
  const { WebGlPaintCompositor } = await import("../src/webGlPaintCompositor.ts");
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");
  const { compositeScenePaintGraph } = await import("../src/scenePaintCompositor.ts");
  const { ScenePaintPlan } = await import("../src/scenePaintPlan.ts");
  const { pdfShapeCoverageWgsl } = await import("../src/pdfShapeCoverage.ts");
  const { choosePdfCompositeResolution } = await import("../src/pdfCompositeBudget.ts");
  const scene = { drawRuns: [{ kind: "fill", first: 0, count: 1 }],
    paintGraph: { roots: [{ kind: "draw", runIndex: 0 }] } };
  const textures = [], writes = [], uploads = [];
  const device = {
    limits: { maxTextureDimension2D: 8 },
    queue: {
      writeTexture(destination, pixels, layout, dimensions) { uploads.push({ destination, pixels, layout, dimensions }); },
      writeBuffer(buffer, offset, values) { writes.push({ buffer, values: values.slice() }); }
    },
    createShaderModule: descriptor => descriptor,
    createBindGroupLayout: descriptor => descriptor,
    createPipelineLayout: descriptor => descriptor,
    createSampler: descriptor => descriptor,
    createRenderPipeline: descriptor => ({ descriptor, getBindGroupLayout: () => ({}) }),
    createBindGroup: descriptor => descriptor,
    createBuffer: descriptor => ({ descriptor, destroy() { this.destroyed = true; } }),
    createTexture(descriptor) {
      const texture = { descriptor, destroyed: false, createView() { return { texture: this }; }, destroy() { this.destroyed = true; } };
      textures.push(texture); return texture;
    }
  };
  // Exercise the real native pipeline declarations without requesting a GPU.
  // Image opacity is read in the fragment stage, including page backgrounds;
  // excluding it from the layout invalidates the entire raster pipeline.
  const previousGlobals = Object.fromEntries(["GPUBufferUsage", "GPUTextureUsage", "GPUShaderStage"]
    .map(key => [key, globalThis[key]]));
  try {
    globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 };
    globalThis.GPUTextureUsage = { TEXTURE_BINDING: 1, COPY_DST: 2 };
    globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2 };
    const renderer = new WebGpuFloorplanRenderer({}, device, { configure() {} }, "rgba8unorm");
    const shader = renderer.rasterPipeline.descriptor.fragment.module.code;
    assert.match(shader.slice(shader.indexOf("@fragment")), /uRaster\.matrixB\.z/);
    const rasterUniform = renderer.rasterBindGroupLayout.entries.find(entry => entry.binding === 1);
    assert.equal(rasterUniform.visibility, GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      "raster transform and opacity uniform must be visible to both shader stages");
  } finally {
    for (const [key, value] of Object.entries(previousGlobals)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
    textures.length = 0; writes.length = 0; uploads.length = 0;
  }
  const compositor = new WebGpuPaintCompositor(device, "rgba8unorm");
  const encoder = makeEncoder();
  const target = device.createTexture({ size: [6, 6] });
  const parent = beginPdfManagedRenderPass(encoder, { colorAttachments: [{ view: target.createView(), loadOp: "clear", storeOp: "store" }] });
  const draws = [];
  const draw = (run, pass, shapeOnly) => { draws.push({ run, shapeOnly }); pass.draw(3); };
  compositor.render(scene, parent, 4, 4, draw, () => true);
  const firstBuffers = new Set(writes.map(write => write.buffer)), firstTextures = textures.slice();
  const firstWriteCount = writes.length;
  compositor.render(scene, parent, 6, 6, draw, () => true);
  assert(writes.slice(firstWriteCount).every(write => !firstBuffers.has(write.buffer)),
    "composites encoded before one queue submit must use distinct uniform buffers");
  assert(firstTextures.every(texture => !texture.destroyed),
    "resizing within an encoder cannot destroy textures referenced by earlier commands");
  // Geometric shape is only ever sampled through a knockout group, so an
  // ordinary tree submits its geometry once per composite instead of twice.
  assert.deepEqual(draws.map(draw => draw.shapeOnly), [false, false]);
  const knockout = { ...scene, paintGraph: { roots: [{ kind: "group", children: scene.paintGraph.roots,
    isolated: true, knockout: true, alpha: 1, blendMode: "Normal" }] } };
  draws.length = 0;
  compositor.render(knockout, parent, 6, 6, draw, () => true);
  assert.deepEqual(draws.map(draw => draw.shapeOnly), [false, true], "knockout groups still render their shape");
  assert.deepEqual([...writes.at(-1).values.slice(8, 10)], [6, 6], "final copy explicitly addresses the destination dimensions");
  parent.end(); encoder.finish();

  // Both native adapters replay a stable graph while applying this frame's
  // draw callback. Explicit visibility revisions opt in; dynamic callbacks
  // without one keep their original per-frame behavior.
  {
    const graph = { drawRuns: [{ kind: "fill", first: 0, count: 1 }, { kind: "fill", first: 1, count: 1 }],
      paintGraph: { roots: [{ kind: "draw", runIndex: 0, optionalContent: 0 },
        { kind: "draw", runIndex: 1, optionalContent: 1 }] } };
    const knownState = { framebuffer: null, readFramebuffer: null, viewport: [0, 0, 4, 4],
      clearColor: [1, 1, 1, 1], scissor: false, blend: true, depth: false, program: null, vao: null,
      blendFunction: [0, 0, 0, 0], blendEquation: [0, 0] };
    const nativeGl = Object.create(WebGlPaintCompositor.prototype);
    Object.assign(nativeGl, { paintPlan: new ScenePaintPlan(), width: 4, height: 4, bound: [],
      gl: { disable() {}, enable() {}, bindFramebuffer() {}, blitFramebuffer() {}, viewport() {},
        clearColor() {}, blendFuncSeparate() {}, blendEquationSeparate() {}, useProgram() {}, bindVertexArray() {} },
      acquire: () => ({}), release() {}, clear() {}, copy() {}, pass() {},
      draw(runs, _destination, shapeOnly) { this.drawSpan(runs, shapeOnly); } });
    const nativeGpu = new WebGpuPaintCompositor(device, "rgba8unorm");
    for (const backend of ["webgl", "webgpu"]) {
      const native = backend === "webgl" ? nativeGl : nativeGpu;
      let visibleChecks = 0, showSecond = true;
      const visible = condition => { visibleChecks++; return condition !== 1 || showSecond; };
      const render = (revision, selected = null, blackDarkenSourceOverEnabled = true) => {
        const actual = [];
        if (backend === "webgl") {
          native.render(graph, 4, 4, runs => actual.push(...runs), visible, selected, null, knownState,
            null, true, revision, blackDarkenSourceOverEnabled);
        } else {
          const log = makeEncoder(), pass = beginPdfManagedRenderPass(log,
            { colorAttachments: [{ view: target.createView(), loadOp: "load", storeOp: "store" }] });
          native.render(graph, pass, 4, 4, (runs, targetPass) => { actual.push(...runs); targetPass.draw(3); },
            visible, selected, null, null, true, revision, blackDarkenSourceOverEnabled);
          pass.end(); log.finish();
        }
        return actual.map(run => [run.first, run.count]);
      };
      assert.deepEqual(render(0), [[0, 2]], backend);
      assert.equal(native.paintPlanReused, false);
      visibleChecks = 0;
      assert.deepEqual(render(0), [[0, 2]], backend);
      assert.equal(native.paintPlanReused, true);
      assert(native.paintPlanOperations > 0, `${backend}: cached operation counts are available to profiling`);
      assert.equal(visibleChecks, 0, `${backend}: stable frames skip canonical graph traversal`);
      showSecond = false;
      assert.deepEqual(render(1), [[0, 1]], `${backend}: a visibility revision drops hidden content`);
      assert.equal(native.paintPlan.reused, false);
      showSecond = true;
      const selected = Uint8Array.of(1, 0);
      assert.deepEqual(render(2, selected), [[0, 1]], backend);
      assert.deepEqual(render(2, selected), [[0, 1]], backend);
      assert.equal(native.paintPlan.reused, true);
      selected[0] = 0; selected[1] = 1;
      assert.deepEqual(render(2, selected), [[1, 1]], `${backend}: mutated culling flags invalidate the plan`);
      assert.equal(native.paintPlan.reused, false);
      assert.deepEqual(render(2, selected, false), [[1, 1]], backend);
      assert.equal(native.paintPlan.reused, false, `${backend}: global tint eligibility invalidates the operation plan`);
      assert.deepEqual(render(2, selected, false), [[1, 1]], backend);
      assert.equal(native.paintPlan.reused, true);
      assert.deepEqual(render(undefined), [[0, 2]], backend);
      showSecond = false;
      assert.deepEqual(render(undefined), [[0, 1]], `${backend}: unversioned callbacks remain dynamic`);
      assert.equal(native.paintPlan.reused, false);
    }
    nativeGpu.dispose();
  }

  const nextEncoder = makeEncoder(), nextPass = beginPdfManagedRenderPass(nextEncoder,
    { colorAttachments: [{ view: target.createView(), loadOp: "load", storeOp: "store" }] });
  const transfer = Float32Array.from({ length: 17 }, (_, i) => i / 16);
  const masked = { ...scene, drawRuns: [...scene.drawRuns, { kind: "fill", first: 1, count: 1 }], paintGraph: { roots: [{
    kind: "group", children: scene.paintGraph.roots, isolated: true, knockout: false, alpha: .5, blendMode: "Normal",
    softMask: { subtype: "Alpha", transfer, children: [{ kind: "draw", runIndex: 1 }] }
  }] } };
  compositor.render(masked, nextPass, 6, 6, draw, () => true);
  const transferUpload = uploads.find(upload => upload.destination.texture.descriptor.format === "r32float");
  assert.deepEqual(transferUpload.dimensions, [8, 3], "large transfer functions span texture rows");
  assert.equal(transferUpload.layout.bytesPerRow, 32);
  assert.deepEqual([...transferUpload.pixels.slice(0, 17)], [...transfer]);
  nextPass.end(); nextEncoder.finish();

  // A group chain holding one fill folds onto it: the fill draws straight onto
  // the parent surface with the chain's opacity and the mask surface's view.
  const foldEncoder = makeEncoder(), foldPass = beginPdfManagedRenderPass(foldEncoder,
    { colorAttachments: [{ view: target.createView(), loadOp: "load", storeOp: "store" }] });
  const folded = [];
  draws.length = 0;
  compositor.render(masked, foldPass, 6, 6, draw, () => true, null, null, {
    canFold: run => run.kind === "fill",
    draw(run, pass, opacity, mask) { folded.push({ run, opacity, mask }); pass.draw(3); }
  });
  assert.deepEqual(folded.map(fold => [fold.run.first, fold.opacity]), [[0, 0.5]], "the masked group folds onto its fill");
  assert.ok([...compositor.all].some(surface => surface.view === folded[0].mask), "the fold reads the mask surface");
  assert.deepEqual(draws.map(draw => draw.run.map(run => run.first)), [[1]], "only the mask's content draws as a span");
  foldPass.end(); foldEncoder.finish();

  // A clear rides on the next pass that renders into its surface, rather than
  // costing a render pass of its own; a surface read first is cleared first.
  {
    const log = [], parentView = { texture: {} };
    const logEncoder = {
      beginRenderPass(descriptor) {
        const attachment = descriptor.colorAttachments[0];
        const entry = { view: attachment.view, loadOp: attachment.loadOp, clearValue: attachment.clearValue, draws: 0 };
        log.push(entry);
        return { setPipeline() {}, setBindGroup(_index, group) { entry.reads = group.entries?.map(e => e.resource); },
          setScissorRect() {}, draw() { entry.draws++; }, end() {} };
      },
      copyTextureToTexture() { log.push({ copy: true }); }, finish() {}
    };
    const runPasses = graph => {
      log.length = 0;
      const parentPass = beginPdfManagedRenderPass(logEncoder, { colorAttachments: [{ view: parentView, loadOp: "load", storeOp: "store" }] });
      compositor.render(graph, parentPass, 6, 6, draw, () => true);
      parentPass.end();
      return log.filter(entry => !entry.copy && entry.view !== parentView);
    };
    const passes = runPasses(masked);
    assert.deepEqual(passes.filter(entry => entry.draws === 0), [], "no pass only clears");
    assert.ok(passes.some(entry => entry.loadOp === "clear" && entry.clearValue.a === 0 && entry.draws > 0),
      "a span pass clears its surface as it loads");
    const emptyMask = { ...masked, paintGraph: { roots: [{ ...masked.paintGraph.roots[0],
      softMask: { subtype: "Alpha", children: [] } }] } };
    const emptyPasses = runPasses(emptyMask);
    const clearOnly = emptyPasses.findIndex(entry => entry.draws === 0);
    assert.ok(clearOnly >= 0, "an empty mask's surface is still cleared");
    assert.equal(emptyPasses[clearOnly].loadOp, "clear");
    assert.ok(emptyPasses.slice(clearOnly + 1).some(entry => entry.reads?.some(read => read === emptyPasses[clearOnly].view)),
      "before the mask pass reads it");
  }

  // Consecutive writes share an attachment, but copies and pooled texture
  // clears finish the pass first. A bounded composite cannot clip the next span.
  {
    const batch = new WebGpuPaintCompositor(device, "rgba8unorm"), log = makeEncoder();
    Object.assign(batch, { encoder: log, width: 6, height: 6, viewportWidth: 6, viewportHeight: 6,
      project: box => ({ x: box.minX, y: box.minY, width: box.maxX - box.minX, height: box.maxY - box.minY }),
      drawSpan: (_runs, pass) => pass.draw(3), folding: { draw: (_run, pass) => pass.draw(3) } });
    const destination = batch.acquire(), source = batch.acquire(), copied = batch.acquire();
    batch.clear(source); batch.draw(scene.drawRuns, source, false);
    batch.clear(destination); batch.draw(scene.drawRuns, destination, false);
    batch.drawFolded(scene.drawRuns[0], destination, 0.5, undefined);
    batch.pass({ operation: 6, source, blend: true, bounds: { minX: 1, minY: 2, maxX: 3, maxY: 4 } }, destination);
    batch.draw(scene.drawRuns, destination, false);
    assert.equal(log.passes.length, 2, "four consecutive destination operations share one pass");
    assert.deepEqual(log.passes[1].scissors, [[0, 0, 6, 6], [0, 0, 6, 6], [0, 0, 5, 6], [0, 0, 6, 6]],
      "the span following a bounded composite resets the scissor");
    batch.copy(destination, copied);
    batch.draw(scene.drawRuns, destination, false);
    assert.equal(log.passes.length, 3, "a copy breaks the batch");
    batch.clear(source); // It was sampled by an earlier pass and may now be reused.
    batch.draw(scene.drawRuns, source, false);
    batch.endPass(); log.finish(); batch.dispose();
  }

  // A gradient soft mask can be computed by the folded paint itself. Transfer
  // functions, curved boundaries and renderer overrides keep the surface path.
  {
    const f = values => Float32Array.from(values);
    const analytic = { ...masked,
      drawRuns: [scene.drawRuns[0], { kind: "gradient-fill", first: 0, count: 1 }],
      gradientCount: 1, gradientMetaA: f([0, 0, 3, 0]), gradientMetaB: f([1, 0, 0, 1]),
      gradientMetaC: f([0, 0, 0, 0]), gradientMetaD: f([6, 0, 0, 0]), gradientMetaE: f([0, 0, 6, 6]),
      gradientFillPathMetaA: f([0, 4, 0, 0]), gradientFillPathMetaC: f([0, 0, 0, 1]),
      gradientFillPaintMeta: f([0, -1, 0, 0]),
      gradientFillSegmentsA: f([0, 0, 0, 0, 6, 0, 6, 0, 6, 6, 6, 6, 0, 6, 0, 6]),
      gradientFillSegmentsB: f([6, 0, 0, 0, 6, 6, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0]),
      paintGraph: { roots: [{ ...masked.paintGraph.roots[0],
        softMask: { subtype: "Alpha", children: [{ kind: "draw", runIndex: 1 }] } }] } };
    let projectShift = 0;
    const project = box => ({ x: box.minX + projectShift, y: box.minY,
      width: box.maxX - box.minX, height: box.maxY - box.minY });
    for (const mode of ["computed", "override", "transfer", "curved"]) {
      projectShift = 0;
      const graph = mode === "transfer" ? { ...analytic, paintGraph: { roots: [{ ...analytic.paintGraph.roots[0],
        softMask: { ...analytic.paintGraph.roots[0].softMask, transfer } }] } }
        : mode === "curved" ? { ...analytic, gradientFillSegmentsB: analytic.gradientFillSegmentsB.slice() } : analytic;
      if (mode === "curved") graph.gradientFillSegmentsB[2] = 1;
      const log = makeEncoder(), parentPass = beginPdfManagedRenderPass(log,
        { colorAttachments: [{ view: target.createView(), loadOp: "load", storeOp: "store" }] });
      draws.length = 0;
      let actual, maskOverride = mode === "override";
      const folding = {
        canFold: run => run.kind === "fill", canFoldMaskPaint: () => !maskOverride,
        draw(run, pass, opacity, mask, content, gradient) { actual = { mask, gradient }; pass.draw(3); }
      };
      const render = () => compositor.render(graph, parentPass, 6, 6, draw, () => true, null, project, folding, true, 0);
      render();
      assert.equal(!!actual.gradient, mode === "computed", mode);
      assert.equal(actual.mask === null, mode === "computed", mode);
      assert.equal(draws.length, mode === "computed" ? 0 : 1, `${mode}: mask paint submissions`);
      if (mode === "computed") {
        const previousGradient = actual.gradient.slice();
        projectShift = 0.25;
        render();
        assert.equal(compositor.paintPlanReused, true, "camera movement reuses the computed-mask operation plan");
        assert.notDeepEqual(actual.gradient, previousGradient, "replayed masks receive fresh projection vectors");
        maskOverride = true;
        draws.length = 0;
        render();
        assert.equal(compositor.paintPlanReused, false, "a mask color override invalidates computed-mask capability");
        assert.equal(actual.gradient, undefined);
        assert.equal(draws.length, 1, "the overridden mask restores its rendered-surface path");
        maskOverride = false;
        render();
        assert.equal(compositor.paintPlanReused, false, "restoring the mask colors restores computed-mask capability");
        assert(actual.gradient);
      }
      assert.equal(new Set(compositor.pool).size, compositor.pool.length, "backdrop/result aliases return to the pool once");
      parentPass.end(); log.finish();
      // Both adapters use the same eligibility, with backend-specific Y direction.
      const gl = Object.create(WebGlPaintCompositor.prototype);
      Object.assign(gl, { scene: graph, folding: { canFoldMaskPaint: () => mode !== "override" }, project,
        width: 6, height: 6, viewportWidth: 6, viewportHeight: 6 });
      if (mode !== "transfer") assert.equal(gl.canFoldMaskPaint(graph.drawRuns[0], graph.drawRuns[1]), mode === "computed");
    }
  }

  // Native GL binds the LUT and gradient parameters only for the computed
  // mask, then restores neutral opacity when the next ordinary paint draws.
  {
    const values = new Map(), textures = [];
    const renderer = Object.create(WebGlFloorplanRenderer.prototype);
    Object.assign(renderer, { paintFoldUnit: 27, paintFoldUniforms: new Map(), gl: {
      TEXTURE0: 0, TEXTURE_2D: 1, activeTexture() {}, bindTexture(_kind, texture) { textures.push(texture); },
      getUniformLocation(_program, name) { return name; },
      uniform4f(name, ...value) { values.set(name, value); }, uniform4fv(name, value) { values.set(name, [...value]); }
    } });
    const program = {}, lut = {}, gradient = Float32Array.from({ length: 60 }, (_, i) => i);
    renderer.paintFold = { opacity: 0.5, mask: lut, gradient, weights: [0.3, 0.59, 0.11, -1, 1] };
    renderer.bindPaintFold(program);
    assert.equal(textures.at(-1), lut);
    assert.deepEqual(values.get("uPaintFold"), [0.5, 2, 1, 0]);
    assert.deepEqual(values.get("uPaintMaskGradient"), [...gradient]);
    renderer.paintFold = null; renderer.bindPaintFold(program);
    assert.deepEqual(values.get("uPaintFold"), [1, 0, 0, 0], "later paints do not inherit the mask");
  }

  // Fold slots: the neutral fold sits at offset 0, each fold of a frame takes a
  // slot of its own, and an outgrown buffer lives until the next frame.
  {
    const bound = [], folds = new WebGpuPaintFolds(device);
    const pass = { setBindGroup(index, group, offsets) { bound.push({ index, group, offsets }); } };
    writes.length = 0;
    folds.beginFrame();
    folds.bind(pass, 2);
    assert.deepEqual(bound.at(-1).offsets, [0], "unfolded draws bind the neutral slot");
    assert.deepEqual([...writes.find(write => write.values.length === 68).values.slice(0, 8)], [1, 0, 0, 0, 0, 0, 0, 0]);
    const maskView = { texture: {} };
    folds.begin(0.25, maskView); folds.bind(pass, 3); folds.end();
    assert.equal(bound.at(-1).index, 3);
    assert.deepEqual(bound.at(-1).offsets, [512], "the first fold takes slot 1");
    assert.equal(bound.at(-1).group.entries[1].resource, maskView, "the fold binds its mask");
    assert.equal(bound.at(-1).group.entries[0].resource.size, 272, "each fold binds its opacity and mask weights");
    assert.deepEqual([...writes.at(-1).values.slice(0, 8)], [0.25, 1, 0, 0, 1, 0, 0, 0], "a converted mask is read from red");
    // Unconverted luminosity content over a white backdrop: lum(rgb) - a + 1.
    folds.begin(0.5, maskView, { subtype: "Luminosity", backdrop: [1, 1, 1], children: [] }); folds.end();
    assert.deepEqual([...writes.at(-1).values.slice(0, 8)], [...Float32Array.of(0.5, 1, 1, 0, 0.3, 0.59, 0.11, -1)]);
    folds.bind(pass, 2);
    assert.deepEqual(bound.at(-1).offsets, [0], "a fold ends with its draw");
    const gradient = Float32Array.from({ length: 60 }, (_, index) => index / 60);
    folds.begin(0.75, maskView, { subtype: "Alpha", children: [] }, gradient); folds.bind(pass, 2); folds.end();
    assert.equal(writes.at(-1).values[1], 2, "gradient masks select the analytic shader branch");
    assert.deepEqual(writes.at(-1).values.slice(8), gradient, "mask vectors travel with this fold's uniform slot");
    assert.equal(bound.at(-1).offsets[0] % 256, 0, "the larger fold stays aligned");
    const first = bound.at(-1).group.entries[0].resource.buffer;
    for (let fold = 0; fold < 64; fold++) { folds.begin(1, null); folds.end(); }
    folds.bind(pass, 2);
    assert.notEqual(bound.at(-1).group.entries[0].resource.buffer, first, "more folds than slots grow the buffer");
    assert.equal(first.destroyed, undefined, "the outgrown buffer stays alive for this frame's commands");
    folds.beginFrame();
    assert.equal(first.destroyed, true, "and is released by the next frame");
    folds.dispose();
  }
  assert(firstTextures.some(texture => texture.descriptor.size[0] === 4 && texture.destroyed),
    "obsolete target sizes are released when the renderer advances to its next submitted-frame encoder");

  const failureEncoder = makeEncoder(), failurePass = beginPdfManagedRenderPass(failureEncoder,
    { colorAttachments: [{ view: target.createView(), loadOp: "load", storeOp: "store" }] });
  assert.throws(() => compositor.render(scene, failurePass, 6, 6, () => { throw new Error("draw failed"); }, () => true), /draw failed/);
  failurePass.draw(3); failurePass.end(); failureEncoder.finish();
  assert.equal(compositor.pool.length, compositor.all.size, "failure releases all leased surfaces and resumes the parent pass");
  compositor.dispose();
  assert(textures.filter(texture => texture !== target).every(texture => texture.destroyed));

  const live = new Set(), adapter = {
    acquire() { const surface = {}; live.add(surface); return surface; },
    release(surface) { assert(live.delete(surface)); },
    copy() { throw new Error("copy failed"); }
  };
  assert.throws(() => compositeScenePaintGraph(scene, adapter, {}, () => true), /copy failed/);
  assert.equal(live.size, 0, "failure initializing the root accumulation surface must also clean up");
  let deleted = false;
  const partial = Object.create(WebGlPaintCompositor.prototype);
  Object.assign(partial, { pool: [], all: new Set(), width: 1, height: 1,
    gl: { createTexture: () => ({}), createFramebuffer: () => null, deleteTexture: () => { deleted = true; } } });
  assert.throws(() => partial.acquire(), /Unable to allocate/);
  assert(deleted, "partial GL allocations must not leak");
  const bounded = choosePdfCompositeResolution(masked, 4096, 2160, 32 * 1024 * 1024, 8);
  assert(bounded.width < 4096 && bounded.height < 2160);
  assert(bounded.width * bounded.height * 8 * bounded.estimatedSurfaces <= 32 * 1024 * 1024,
    "deep or high-DPR viewports downgrade transient resolution before allocating beyond the budget");
  assert(Math.abs(bounded.width / bounded.height - 4096 / 2160) < .01, "resolution downgrade preserves projection aspect ratio");
  assert.equal(choosePdfCompositeResolution(scene, 320, 200).scale, 1, "ordinary viewports retain full resolution");
  assert.equal(pdfShapeCoverageWgsl("let color = textureSample(x,y,z) * uRaster.matrixB.z;"), "let color = textureSample(x,y,z) ;");
  console.log("native paint compositor: queue-write isolation, resize lifetime, transfer atlas, folding, failure cleanup, resolution budgets and shape opacity passed");
} finally { hooks.deregister(); }

function makeEncoder() {
  let active = false;
  const resources = new Set(), passes = [];
  return {
    passes,
    beginRenderPass(descriptor) {
      assert.equal(active, false, "render passes cannot overlap"); active = true;
      for (const attachment of descriptor.colorAttachments) resources.add(attachment.view.texture);
      const entry = { descriptor, scissors: [] }; passes.push(entry);
      let scissor = null, ended = false;
      return {
        setPipeline() {}, setScissorRect(...rect) { scissor = rect; },
        setBindGroup(_index, group) { for (const entry of group.entries) if (entry.resource.texture) resources.add(entry.resource.texture); },
        draw() { assert(!ended); entry.scissors.push(scissor); },
        end() { assert(!ended); ended = true; active = false; }
      };
    },
    copyTextureToTexture(source, destination) { assert(!active); resources.add(source.texture); resources.add(destination.texture); },
    finish() { assert(!active); assert([...resources].every(texture => !texture.destroyed), "all encoded textures remain alive until submission"); }
  };
}
