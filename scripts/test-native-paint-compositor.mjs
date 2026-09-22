import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });
try {
  const { WebGpuPaintCompositor, beginPdfManagedRenderPass } = await import("../src/webGpuPaintCompositor.ts");
  const { WebGlPaintCompositor } = await import("../src/webGlPaintCompositor.ts");
  const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");
  const { compositeScenePaintGraph } = await import("../src/scenePaintCompositor.ts");
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
  console.log("native paint compositor: queue-write isolation, resize lifetime, transfer atlas, failure cleanup, resolution budgets and shape opacity passed");
} finally { hooks.deregister(); }

function makeEncoder() {
  let active = false;
  const resources = new Set();
  return {
    beginRenderPass(descriptor) {
      assert.equal(active, false, "render passes cannot overlap"); active = true;
      for (const attachment of descriptor.colorAttachments) resources.add(attachment.view.texture);
      let ended = false;
      return {
        setPipeline() {},
        setBindGroup(_index, group) { for (const entry of group.entries) if (entry.resource.texture) resources.add(entry.resource.texture); },
        draw() { assert(!ended); },
        end() { assert(!ended); ended = true; active = false; }
      };
    },
    copyTextureToTexture(source, destination) { assert(!active); resources.add(source.texture); resources.add(destination.texture); },
    finish() { assert(!active); assert([...resources].every(texture => !texture.destroyed), "all encoded textures remain alive until submission"); }
  };
}
