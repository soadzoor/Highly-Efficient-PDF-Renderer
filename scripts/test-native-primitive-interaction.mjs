import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { NativePrimitiveColors, WebGpuPrimitiveGradientColors, coalescePrimitiveColorTexels } = await import("../src/nativePrimitiveColors.ts");
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");
  const { WebGlPrimitiveHighlights, WebGpuPrimitiveHighlights } = await import("../src/nativePrimitiveHighlights.ts");
  const { estimateHighlightLocalUnitsPerPixel } = await import("../src/primitiveHighlightProjection.ts");
  const { PRIMITIVE_HIGHLIGHT_FRAGMENT_GLSL, PRIMITIVE_HIGHLIGHT_COVERAGE_WGSL } = await import("../src/primitiveHighlightShaders.ts");
  const { VectorStrokeLodRuntime, createRuntimeTileGrid, buildRuntimeTileBuckets, storePrebuiltVectorStrokeLodRuntime,
    takePrebuiltVectorStrokeLodRuntime } = await import("../src/vectorStrokeLodCore.ts");
  const floats = values => new Float32Array(values);
  const scene = Object.assign(createEmptyVectorScene(), {
    segmentCount: 2, endpoints: floats([0, 0, 0, 0, 0, 1, 0, 0]),
    primitiveMeta: floats([10, 0, 0, 0.5, 10, 1, 0, 1]), primitiveBounds: floats([0, 0, 10, 1, 0, 0, 10, 1]),
    styles: floats([0.1, 0.2, 0.3, 0.4, 0.2, 0.5, 0.6, 0.7]),
    fillPathCount: 1, fillPathMetaB: floats([10, 20, 0.2, 0.3]), fillPathMetaC: floats([1, 0, 0.4, 0.5]),
    textInstanceCount: 1, textInstanceC: floats([0.2, 0.3, 0.4, 0.5]),
    gradientFillPathCount: 1, gradientStrokeRunCount: 1,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 1 }, maxHalfWidth: 0.2
  });
  const original = Object.fromEntries(Object.entries(scene).filter(([, value]) => ArrayBuffer.isView(value))
    .map(([key, value]) => [key, value.slice()]));
  const updates = ["stroke", "fill", "text", "gradient-fill", "gradient-stroke"].map(kind => ({ ref: { kind, index: 0 }, color: [1, 0, 0.75] }));
  const colors = new NativePrimitiveColors(scene);
  const patches = colors.update(updates);
  assert.equal(patches.length, 4);
  assert.deepEqual([...patches[0].pixels], [scene.styles[0], 1, 0, 0.75]);
  assert.deepEqual([...patches[1].pixels], [10, 20, 1, 0]);
  assert.deepEqual([...patches[2].pixels], [1, 0, 0.75, 0.5]);
  assert.deepEqual([...patches[3].pixels], [255, 0, 191, 128]);
  assert.deepEqual(colors.gradient("gradient-fill", 0), [1, 0, 0.75]);
  assert.throws(() => colors.update([{ ref: { kind: "stroke", index: 1 }, color: [0, 1, 0] },
    { ref: { kind: "stroke", index: 100 }, color: [0, 0, 1] }]), /range/i);
  assert.equal(colors.updates().length, 5, "invalid batches do not partly mutate sparse state");

  const grouped = coalescePrimitiveColorTexels([
    { kind: "stroke", index: 2, pixels: floats([2, 0, 0, 0]) },
    { kind: "stroke", index: 1, pixels: floats([1, 0, 0, 0]) },
    { kind: "text", index: 0, pixels: new Uint8Array([1, 2, 3, 4]) },
    { kind: "text", index: 1, pixels: new Uint8Array([5, 6, 7, 8]) },
    { kind: "stroke", index: 1, pixels: floats([9, 0, 0, 0]) }
  ], { stroke: 2, fillB: 2, fillC: 2, text: 2 });
  assert.deepEqual(grouped.map(row => [row.kind, row.index, row.count, [...row.pixels]]), [
    ["stroke", 1, 1, [9, 0, 0, 0]], ["stroke", 2, 1, [2, 0, 0, 0]],
    ["text", 0, 2, [1, 2, 3, 4, 5, 6, 7, 8]]
  ], "unsorted updates retain final values, separate row boundaries and preserve byte colors");
  assert(grouped[2].pixels instanceof Uint8Array);

  const writes = [];
  const gl = glMock(writes);
  const device = gpuMock(writes);
  globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 };
  globalThis.GPUTextureUsage = { TEXTURE_BINDING: 1, COPY_DST: 2 };
  globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2 };
  for (const [Renderer, backend] of [[WebGlFloorplanRenderer, "gl"], [WebGpuFloorplanRenderer, "gpu"]]) {
    const forceExact = [], textModes = [], colorCommutation = [];
    let frames = 0, invalidations = 0;
    const instance = Object.assign(Object.create(Renderer.prototype), {
      scene, gl, gpuDevice: device, primitiveGradientLayout: {}, primitiveColors: null,
      segmentTextureC: "stroke", fillPathMetaTextureB: "fillB", fillPathMetaTextureC: "fillC", textInstanceTextureC: "text",
      segmentTextureWidth: 2, fillPathMetaTextureWidth: 1, textInstanceTextureWidth: 1,
      vectorLodRuntime: { setForceExact(value) { forceExact.push(value); } },
      textLodRuntime: { setMode(value) { textModes.push(value); } }, textLodMode: "auto",
      orderedBatches: { invalidate() { invalidations++; }, setColorCommutationEnabled(value) { colorCommutation.push(value); } },
      vectorLodLevels: [{ ownsTextures: true, textureC: "combined", textureWidth: 3 }],
      vectorLodLevelResources: [{ ownsTextures: true, textureC: "combined", textureWidth: 3 }],
      destroyVectorMinifyResources() {}, requestFrame() { frames++; }, panCacheValid: true
    });
    writes.length = 0;
    instance.setPrimitiveColorUpdates(updates);
    assert.deepEqual(forceExact, [true]);
    assert.deepEqual(textModes, ["off"]);
    assert.equal(frames, 1);
    assert.equal(invalidations, 1);
    assert.deepEqual(colorCommutation, [false], "temporary RGB overrides restore conservative paint ordering");
    assert.equal(instance.panCacheValid, false);
    const texels = writes.filter(write => write.kind === "texel");
    assert.equal(texels.length, 5, `${backend}: base stroke and ordered LOD prefix are both patched`);
    assert(texels.some(write => write.texture === "combined"));
    assert.deepEqual(texels.find(write => write.texture === "text").data, [255, 0, 191, 128]);
    writes.length = 0;
    instance.setPrimitiveColorUpdates(updates.map(update => ({ ref: update.ref, color: null })));
    assert.deepEqual(forceExact, [true, false]);
    assert.deepEqual(textModes, ["off", "auto"]);
    assert.deepEqual(colorCommutation, [false, true], "clearing colors restores same-color batching");
    assert.equal(instance.primitiveColors.updates().length, 0);
    assert.deepEqual(writes.find(write => write.kind === "texel" && write.texture === "stroke").data, [...scene.styles.slice(0, 4)]);
    assert.deepEqual(writes.find(write => write.kind === "texel" && write.texture === "text").data, [51, 77, 102, 128]);
    const adjacent = [0, 1].map(index => ({ ref: { kind: "stroke", index }, color: [0, 1, 0] }));
    writes.length = 0;
    instance.setPrimitiveColorUpdates(adjacent);
    const adjacentWrites = writes.filter(write => write.kind === "texel");
    assert.deepEqual(adjacentWrites.map(write => [write.texture, write.count]), [["stroke", 2], ["combined", 2]],
      `${backend}: adjacent dirty texels are uploaded together for each texture`);
    assert.deepEqual(adjacentWrites[0].data, [scene.styles[0], 0, 1, 0, scene.styles[4], 0, 1, 0]);
    instance.segmentTextureWidth = 1;
    writes.length = 0;
    instance.setPrimitiveColorUpdates(adjacent.map(update => ({ ref: update.ref, color: null })));
    const splitWrites = writes.filter(write => write.kind === "texel");
    assert.deepEqual(splitWrites.map(write => [write.texture, write.origin, write.count]),
      [["stroke", [0, 0], 1], ["stroke", [0, 1], 1], ["combined", [0, 0], 2]],
      `${backend}: row boundaries use each texture's own width`);
    assert.deepEqual(splitWrites[2].data, [...scene.styles]);
    instance.primitiveGradientColors?.dispose();
    let overlayReleased = 0;
    instance.primitiveHighlights = { dispose() { overlayReleased++; } };
    instance.setPrimitiveHighlights(null);
    assert.equal(overlayReleased, 1, `${backend}: clearing interaction releases overlay resources`);
    assert.equal(instance.primitiveHighlights, null);
  }

  // Gradient draws need distinct buffers: rewriting one shared uniform while
  // encoding a pass would make every paint observe the last color.
  const gradients = new WebGpuPrimitiveGradientColors(device, {});
  gradients.update(updates);
  const first = gradients.bindGroup("gradient-fill", 0);
  const second = gradients.bindGroup("gradient-stroke", 0);
  const fallback = gradients.bindGroup("gradient-fill", 1);
  assert.notEqual(first, second);
  assert.notEqual(first, fallback);
  assert.equal(gradients.bindGroup("gradient-stroke", 1), fallback);
  gradients.update([{ ref: { kind: "gradient-fill", index: 0 }, color: null }]);
  assert.equal(gradients.bindGroup("gradient-fill", 0), fallback);
  gradients.dispose();

  // Exercise the real legacy and ordered native draw dispatch with a pass that
  // validates group 0 (paint), group 1 (clip), and group 2 (per-paint color).
  const gradientScene = { ...scene, segmentCount: 0, fillPathCount: 0, textInstanceCount: 0,
    gradientStrokeRunMetaA: floats([0, 1, 0, -1]) };
  const renderColors = new WebGpuPrimitiveGradientColors(device, {});
  renderColors.update([{ ref: { kind: "gradient-fill", index: 0 }, color: [1, 0, 0] },
    { ref: { kind: "gradient-stroke", index: 0 }, color: [0, 1, 0] }]);
  const gpuRenderer = Object.assign(Object.create(WebGpuFloorplanRenderer.prototype), {
    scene: gradientScene, gradientData: gradientScene, gpuDevice: device, primitiveGradientColors: renderColors,
    segmentCount: 0, fillPathCount: 0, textInstanceCount: 0, fillRenderingEnabled: true,
    strokeRenderingEnabled: true, textRenderingEnabled: true, rasterRenderingEnabled: true,
    pageBackgroundResources: [], rasterLayerResources: [], vectorClipIndex: -1,
    vectorClipBindGroups: ["instances", "unclipped", "clip0"],
    gradientFillPipeline: "gradient-fill", gradientStrokePipeline: "gradient-stroke",
    gradientFillBindGroup: "fill-data", gradientStrokeBindGroup: "stroke-data",
    orderedGradientPaintCommands: [{ kind: "gradient-fill", index: 0 }, { kind: "gradient-stroke", index: 0 }],
    updateCameraUniforms() {}, zoom: 1
  });
  let pipeline;
  const groups = [];
  const draws = [];
  const renderPass = {
    setPipeline(value) { pipeline = value; }, setBindGroup(index, value) { groups[index] = value; },
    draw() {
      assert.equal(groups[0], pipeline === "gradient-fill" ? "fill-data" : "stroke-data");
      assert(groups[1], "gradient clip bind group must be present");
      assert(groups[2]?.entries[0].resource.buffer, "gradient override bind group must be present");
      draws.push([pipeline, groups[1], groups[2].entries[0].resource.buffer.data]);
    }
  };
  gpuRenderer.drawSceneIntoPass(renderPass, 100, 100, 5, 5);
  assert.deepEqual(draws, [["gradient-fill", "unclipped", [1, 0, 0, 1]],
    ["gradient-stroke", "unclipped", [0, 1, 0, 1]]]);
  draws.length = 0;
  gradientScene.drawRuns = [{ kind: "gradient-fill", first: 0, count: 1, clipIndex: 0 },
    { kind: "gradient-stroke", first: 0, count: 1 }];
  gpuRenderer.drawSceneIntoPass(renderPass, 100, 100, 5, 5);
  assert.deepEqual(draws, [["gradient-fill", "clip0", [1, 0, 0, 1]],
    ["gradient-stroke", "unclipped", [0, 1, 0, 1]]]);
  renderColors.dispose();

  // Draw overlays from a reusable buffer; clearing leaves no selected geometry.
  const highlight = { segments: floats([0, 0, 5, 8, 10, 0, 1, -1]), clipPaths: [], count: 1, selectionCount: 1 };
  const identity = floats([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  // Differentiating unsigned distance erases a line centered between two
  // pixel rows. Use the analytic normal and the point's screen Jacobian.
  for (const source of [PRIMITIVE_HIGHLIGHT_FRAGMENT_GLSL, PRIMITIVE_HIGHLIGHT_COVERAGE_WGSL]) {
    assert.doesNotMatch(source, /(?:dFdx|dFdy|dpdx|dpdy)\(distanceValue\)/);
    assert.match(source, /dot\(normal,\s*(?:dFdx|dpdx)\(/);
  }
  const nonuniform = floats([0.2, 0, 0, 0, 0, 0.02, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  assert(Math.abs(estimateHighlightLocalUnitsPerPixel(nonuniform, { width: 100, height: 100 }, scene.bounds) - 1) < 1e-6,
    "overlay padding uses the compressed axis, retaining fixed screen width under nonuniform scale");
  const glOverlay = new WebGlPrimitiveHighlights(gl, () => ({}));
  writes.length = 0;
  glOverlay.set(highlight);
  glOverlay.set({ ...highlight, selectionCount: 0 });
  assert.equal(writes.filter(write => write.kind === "bufferAllocate").length, 1);
  assert.equal(glOverlay.draw(identity, 1, 2), 1, "one instanced draw reports one draw call");
  assert.equal(writes.filter(write => write.kind === "draw").length, 1);
  glOverlay.set(null);
  assert.equal(glOverlay.draw(identity, 1, 2), 0, "empty highlights report no draw calls");
  assert.equal(writes.filter(write => write.kind === "draw").length, 1);
  glOverlay.dispose();
  const gpuOverlay = new WebGpuPrimitiveHighlights(device, "bgra8unorm");
  writes.length = 0;
  gpuOverlay.set(highlight);
  gpuOverlay.set({ ...highlight, selectionCount: 0 });
  assert.equal(writes.filter(write => write.kind === "bufferAllocate").length, 1);
  assert.equal(writes.filter(write => write.kind === "textureAllocate").length, 1);
  let gpuDraws = 0;
  const pass = { setPipeline() {}, setBindGroup() {}, draw() { gpuDraws++; } };
  assert.equal(gpuOverlay.draw(pass, identity, 1, 2), 1, "one instanced draw reports one draw call");
  gpuOverlay.set(null);
  assert.equal(gpuOverlay.draw(pass, identity, 1, 2), 0, "empty highlights report no draw calls");
  assert.equal(gpuDraws, 1);
  gpuOverlay.dispose();

  // Pin and unpin a real selector's tile choices without building/repacking.
  const tileGrid = createRuntimeTileGrid(scene.bounds, scene.segmentCount, scene);
  const coarse = { ...scene, segmentCount: 1 };
  const levels = [scene, coarse].map((value, index) => ({ tolerance: index, scene: value,
    segmentCount: value.segmentCount, ...buildRuntimeTileBuckets(value, tileGrid) }));
  const runtime = new VectorStrokeLodRuntime(scene, { tileGrid, levels, elapsedMs: 0 });
  // Tile 0 under a one-stroke budget, with the coarse level inside both its
  // normal screen-error limit and its budget-pressure limit.
  const chooseTile = target => target.chooseTileLevel(0, 1, 1, 1);
  assert.equal(chooseTile(runtime), 1);
  runtime.setForceExact(true);
  assert.equal(chooseTile(runtime), 0);
  runtime.update({ cameraCenterX: 5, cameraCenterY: 0.5, zoom: 1 }, { width: 100, height: 100 });
  assert.equal(runtime.levels[0].visibleSegmentCount, 2);
  assert.equal(runtime.levels[1].visibleSegmentCount, 0);
  runtime.setForceExact(false);
  assert.equal(chooseTile(runtime), 1);
  runtime.setForceExact(true);
  storePrebuiltVectorStrokeLodRuntime(scene, runtime);
  assert.equal(chooseTile(takePrebuiltVectorStrokeLodRuntime(scene)), 1,
    "temporary appearance must not leak to another viewer through the runtime cache");

  for (const [key, value] of Object.entries(original)) assert.deepEqual(scene[key], value, `${key} remains immutable`);
  console.log("Native primitive colors, gradient state, overlays and exact-LOD restoration passed");
} finally { hooks.deregister(); }

function glMock(writes) {
  let texture;
  const methods = {
    createBuffer: () => ({}), createVertexArray: () => ({}), createTexture: () => ({}),
    getUniformLocation: (_program, name) => name, getParameter: () => 4096,
    bindTexture(_target, value) { texture = value; },
    texSubImage2D(...args) { writes.push({ kind: "texel", texture, origin: [args[2], args[3]], count: args[4], data: [...args.at(-1)] }); },
    bufferData() { writes.push({ kind: "bufferAllocate" }); },
    drawArraysInstanced() { writes.push({ kind: "draw" }); }
  };
  return new Proxy(methods, { get(target, name) { return target[name] ?? (() => {}); } });
}
function gpuMock(writes) {
  return {
    limits: { maxTextureDimension2D: 4096 },
    queue: {
      writeTexture({ texture, origin }, data, _layout, size) { writes.push({ kind: "texel", texture, origin, count: size[0], data: [...data] }); },
      writeBuffer(buffer, _offset, data) { buffer.data = [...data]; }
    },
    createBuffer() { writes.push({ kind: "bufferAllocate" }); return { destroy() { this.destroyed = true; } }; },
    createBindGroup(descriptor) { return descriptor; },
    createTexture() { writes.push({ kind: "textureAllocate" }); return { createView() { return {}; }, destroy() {} }; },
    createShaderModule(descriptor) { return descriptor; }, createBindGroupLayout(descriptor) { return descriptor; },
    createPipelineLayout(descriptor) { return descriptor; },
    createRenderPipeline(descriptor) { return { ...descriptor, getBindGroupLayout() { return {}; } }; }
  };
}
