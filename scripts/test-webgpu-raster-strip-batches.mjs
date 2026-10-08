import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
const globals = Object.fromEntries(["GPUBufferUsage", "GPUTextureUsage", "GPUShaderStage"]
  .map(key => [key, globalThis[key]]));
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 };
globalThis.GPUTextureUsage = { TEXTURE_BINDING: 1, COPY_DST: 2 };
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2 };

try {
  const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");
  const { buildRasterStripBatches } = await import("../src/rasterStripBatches.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const scene = makeScene(createEmptyVectorScene);
  const original = structuredClone(scene);
  const expected = buildRasterStripBatches(scene, 2048);
  assert.deepEqual(expected.map(batch => [batch.first, batch.count]), [[0, 4], [4, 6]]);
  const create = () => {
    const device = makeDevice();
    const renderer = new WebGpuFloorplanRenderer({}, device, { configure() {}, unconfigure() {} }, "rgba8unorm");
    renderer.scene = scene;
    renderer.requestFrame = () => {};
    renderer.vectorClipBindGroups = [{ clip: -2 }, { clip: -1 }, { clip: 0 }];
    renderer.fillBindGroup = { fill: true };
    return { device, renderer };
  };

  {
    const { renderer, device } = create();
    assert.equal(renderer.rasterStripPipeline, null, "ordinary setup does not compile the optional pipeline");
    renderer.configureRasterLayers(scene);
    const pipeline = renderer.rasterStripPipeline;
    const batches = [...renderer.rasterStripResources.values()];
    assert.equal(renderer.rasterLayerResources.length, 10, "canonical textures remain available for partial runs and updates");
    assert.equal(batches.length, 2);
    assert.equal(pipeline.descriptor.fragment.targets[0].blend.color.srcFactor, "one",
      "the atlas stores premultiplied colors");
    const layout = pipeline.descriptor.layout.bindGroupLayouts[0];
    assert.equal(layout.entries[0].visibility, GPUShaderStage.VERTEX);
    assert.deepEqual(layout.entries[1], {
      binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" }
    });
    assert.equal(layout.entries[2].visibility, GPUShaderStage.FRAGMENT);
    assert.equal(layout.entries[3].visibility, GPUShaderStage.FRAGMENT);
    assert.equal(pipeline.descriptor.layout.bindGroupLayouts[1], renderer.vectorClipBindGroupLayout);
    for (const [index, resource] of batches.entries()) {
      const source = expected[index];
      assert.equal(resource.texture.descriptor.mipLevelCount ?? 1, 1,
        "hardware mip levels must not mix neighboring image rows");
      const uploads = device.uploads.filter(upload => upload.destination.texture === resource.texture);
      assert.equal(uploads.length, 1);
      assert.deepEqual(unpadUpload(uploads[0]), source.data, "GPU atlas rows match independent premultiplied CPU mip chains");
      const write = device.writes.find(write => write.buffer === resource.instanceBuffer);
      assert.deepEqual(write.values, source.instances, "matrix, width and opacity preserve each original image");
      assert.equal(resource.instanceBuffer.descriptor.size, source.instances.byteLength);
      assert.deepEqual(Object.keys(resource).sort(), ["bindGroup", "count", "first", "instanceBuffer", "texture"],
        "GPU resources do not retain temporary CPU atlas arrays");
      assert.equal(resource.bindGroup.entries[1].resource.buffer, resource.instanceBuffer);
      assert.equal(resource.bindGroup.entries[3].resource.texture, resource.texture);
    }
    // These are source-contract checks, not GPU compilation: the test needs no
    // browser/device, and a manual GPU run still verifies driver acceptance.
    const shader = pipeline.descriptor.fragment.module.code;
    assert(shader.indexOf("dpdx(sourceUv)") < shader.indexOf("if (color.a"));
    // A clip is often an image's visible outline: its edge is antialiased over
    // one pixel, measured before any discard, scaling the premultiplied color.
    assert(shader.indexOf("let clipAAWidth") >= 0 && shader.indexOf("let clipAAWidth") < shader.indexOf("if (color.a"));
    assert.match(shader, /return color \* heprVectorClipAA\(inData\.world, uVectorClip\.x, uVectorClipTex, clipAAWidth\)/);
    assert.match(shader, /firstLeadingBit\(width\)/);
    assert.match(shader, /levelWidth = max\(levelWidth \/ 2u, 1u\)/);
    assert.match(shader, /textureSampleLevel\(uRasterTex, uRasterSampler, atlasUv, 0\.0\)/);
    assert.match(shader, /clamp\(uv\.x \* f32\(levelWidth\), 0\.5, f32\(levelWidth\) - 0\.5\)/);

    let draws = submit(renderer);
    assert.deepEqual(draws.map(draw => [draw.pipeline === pipeline ? "strip" : "fill", draw.args]),
      [["strip", [4, 4, 0, 0]], ["fill", [4, 1, 0, 0]], ["strip", [4, 6, 0, 0]]],
      "raster batches preserve the intervening vector paint");
    assert.equal(draws[0].groups[1], renderer.vectorClipBindGroups[2]);
    assert.equal(draws[2].groups[1], renderer.vectorClipBindGroups[1]);
    assert.equal(draws[0].groups[0], batches[0].bindGroup);
    assert.equal(draws[2].groups[0], batches[1].bindGroup);

    const uploads = device.uploads.length, writes = device.writes.length;
    renderer.setViewState({ cameraCenterX: 4, cameraCenterY: 5, zoom: 2 }, { scheduleFrame: false });
    submit(renderer);
    renderer.setViewState({ cameraCenterX: 5, cameraCenterY: 5, zoom: 2 }, { scheduleFrame: false });
    submit(renderer);
    assert.equal(device.uploads.length, uploads, "panning does not rebuild image atlases");
    assert.equal(device.writes.length, writes, "draw submission does not reupload immutable image placements");
    assert.equal(renderer.rasterStripPipeline, pipeline);

    for (const partial of [{ ...scene.drawRuns[0], count: 3 }, { ...scene.drawRuns[0], first: 1, count: 3 }]) {
      renderer.orderedRunCuller = { select: () => [partial] };
      draws = submit(renderer);
      assert.equal(draws.length, 3);
      assert(draws.every(draw => draw.pipeline === renderer.rasterPipeline));
      assert.deepEqual(draws.map(draw => draw.groups[0]),
        renderer.rasterLayerResources.slice(partial.first, partial.first + partial.count).map(resource => resource.bindGroup),
        "partial batches draw only their original image subset");
    }
    renderer.orderedRunCuller = null;
    renderer.setOptionalContentVisibility({ revision: 1, layers: [], conditions: Uint8Array.of(0) });
    draws = submit(renderer);
    assert.equal(draws.length, 2, "a hidden optional-content run suppresses its complete batch");
    assert.equal(draws[0].pipeline, renderer.fillPipeline);
    assert.equal(draws[1].groups[0], batches[1].bindGroup);
    renderer.setOptionalContentVisibility({ revision: 2, layers: [], conditions: Uint8Array.of(1) });

    const replacement = { ...scene.rasterLayers[0], data: Uint8Array.of(0, 255, 0, 128), width: 1,
      matrix: Float32Array.of(2, 0, 0, -1, 7, 8), opacity: .25 };
    const previous = renderer.rasterLayerResources[0];
    const staged = renderer.prepareRasterLayerUpdates(new Map([[0, replacement]]));
    assert.equal(renderer.rasterStripResources.size, 2, "preparation keeps the displayed atlases intact");
    staged.commit(); staged.dispose();
    assert.equal(renderer.rasterStripResources.size, 0);
    assert(batches.every(batch => batch.texture.destroyed && batch.instanceBuffer.destroyed));
    assert(!previous.texture.destroyed && !previous.uniformBuffer.destroyed, "canonical replacements remain warm within the cache budget");
    assert.notEqual(renderer.rasterLayerResources[0], previous);
    draws = submit(renderer);
    assert.equal(draws.filter(draw => draw.pipeline === renderer.rasterPipeline).length, 10,
      "committed replacements resume canonical individual rendering");
    renderer.setRasterTextureResidency(false);
    assert.equal(renderer.rasterLayerResources.length, 0);
    renderer.setRasterTextureResidency(true);
    assert.equal(renderer.rasterStripResources.size, 0, "waking cannot revive atlases of stale source pixels");
    const replacementUpload = device.uploads.findLast(upload => upload.destination.texture === renderer.rasterLayerResources[0].texture);
    assert.deepEqual([...unpadUpload(replacementUpload)], [0, 128, 0, 128]);
    renderer.dispose();
    assert(device.textures.every(texture => texture.destroyed));
    assert(device.buffers.every(buffer => buffer.destroyed));
  }

  {
    const { renderer, device } = create();
    renderer.configureRasterLayers(scene);
    const batches = [...renderer.rasterStripResources.values()];
    renderer.setRasterTextureResidency(false);
    assert(batches.every(batch => batch.texture.destroyed && batch.instanceBuffer.destroyed));
    renderer.setRasterTextureResidency(true);
    const reuploaded = [...renderer.rasterStripResources.values()];
    assert.equal(reuploaded.length, 2);
    assert(reuploaded.every(batch => !batches.includes(batch)));
    renderer.dispose();
    assert(reuploaded.every(batch => batch.texture.destroyed && batch.instanceBuffer.destroyed));
    assert(device.textures.every(texture => texture.destroyed));
    assert(device.buffers.every(buffer => buffer.destroyed));
  }

  for (const failure of ["pipeline", "second buffer"]) {
    const { renderer, device } = create();
    device.failure = failure;
    const warnings = [], warn = console.warn;
    console.warn = (...args) => warnings.push(args);
    try { renderer.configureRasterLayers(scene); }
    finally { console.warn = warn; }
    assert.equal(warnings.length, 1, "an unavailable optimization reports its fallback");
    assert.equal(renderer.rasterStripResources.size, 0);
    assert.equal(renderer.rasterLayerResources.length, 10);
    assert(renderer.rasterLayerResources.every(resource => !resource.texture.destroyed && !resource.uniformBuffer.destroyed));
    assert(device.textures.filter(texture => texture.descriptor.size.height > 1).every(texture => texture.destroyed),
      "partial atlas allocation failures release all optional textures");
    assert.equal(submit(renderer).filter(draw => draw.pipeline === renderer.rasterPipeline).length, 10);
    renderer.dispose();
    assert(device.textures.every(texture => texture.destroyed));
    assert(device.buffers.every(buffer => buffer.destroyed));
  }
  assert.deepEqual(scene, original, "batch upload, drawing, replay and disposal leave the canonical scene unchanged");
  console.log("WebGPU raster strips: uploads, pipeline contract, ordered dispatch, clipping, visibility, pan reuse, updates and cleanup passed.");
} finally {
  for (const [key, value] of Object.entries(globals)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
  hooks.deregister();
}

function makeScene(empty) {
  const scene = empty();
  scene.rasterLayers = Array.from({ length: 10 }, (_, index) => {
    const width = [1, 3, 8, 5][index % 4];
    const data = Uint8Array.from({ length: width * 4 }, (_, offset) =>
      offset % 4 === 3 ? 80 + index * 15 : (offset * 17 + index * 23) % 256);
    return { width, height: 1, data, opacity: (index + 1) / 10,
      matrix: Float32Array.of(width, index * .01, .2, -1, index, index + 1) };
  });
  scene.fillPathCount = 1;
  scene.drawRuns = [
    { kind: "raster", first: 0, count: 4, clipIndex: 0, optionalContent: 0 },
    { kind: "fill", first: 0, count: 1 },
    { kind: "raster", first: 4, count: 6 }
  ];
  scene.clipPaths = [{ parent: -1, fillRule: 0, edges: Float32Array.of(0, 0, 20, 0, 20, 0, 20, 20,
    20, 20, 0, 20, 0, 20, 0, 0) }];
  scene.optionalContent = { groups: [], conditions: [{ kind: "constant", value: true }], order: [], radioGroups: [] };
  return scene;
}

function makeDevice() {
  const textures = [], buffers = [], uploads = [], writes = [];
  let stripBuffers = 0;
  return {
    textures, buffers, uploads, writes, failure: null,
    limits: { maxTextureDimension2D: 2048 },
    queue: {
      writeTexture(destination, pixels, layout, dimensions) {
        uploads.push({ destination, pixels: pixels.slice(), layout, dimensions });
      },
      writeBuffer(buffer, offset, values) { writes.push({ buffer, offset, values: values.slice() }); }
    },
    createShaderModule: descriptor => descriptor,
    createBindGroupLayout: descriptor => descriptor,
    createPipelineLayout: descriptor => descriptor,
    createSampler: descriptor => descriptor,
    createBindGroup: descriptor => descriptor,
    createRenderPipeline(descriptor) {
      if (this.failure === "pipeline" && descriptor.vertex.module.code.includes("fn heprRasterStripSample(")) throw new Error("synthetic pipeline failure");
      return { descriptor, getBindGroupLayout: index => descriptor.layout.bindGroupLayouts[index] };
    },
    createBuffer(descriptor) {
      if (this.failure === "second buffer" && descriptor.usage === (GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST) &&
          ++stripBuffers === 2) throw new Error("synthetic strip buffer failure");
      const buffer = { descriptor, destroyed: false, destroy() { this.destroyed = true; } };
      buffers.push(buffer); return buffer;
    },
    createTexture(descriptor) {
      const texture = { descriptor, destroyed: false, createView() { return { texture: this }; },
        destroy() { this.destroyed = true; } };
      textures.push(texture); return texture;
    },
    destroy() {}
  };
}

function submit(renderer) {
  const draws = [], groups = [];
  let pipeline;
  renderer.drawSourceOrderedContentIntoPass({
    setPipeline(value) { pipeline = value; },
    setBindGroup(index, value) { groups[index] = value; },
    draw(...args) { draws.push({ pipeline, groups: groups.slice(), args }); }
  });
  return draws;
}

function unpadUpload(upload) {
  const { width, height } = upload.dimensions;
  const stride = upload.layout.bytesPerRow ?? width * 4;
  const result = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    result.set(upload.pixels.subarray(row * stride, row * stride + width * 4), row * width * 4);
  }
  return result;
}
