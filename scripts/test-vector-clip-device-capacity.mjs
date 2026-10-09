import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
const previousUsage = globalThis.GPUBufferUsage;
const previousTextureUsage = globalThis.GPUTextureUsage;
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 };
globalThis.GPUTextureUsage = { TEXTURE_BINDING: 1, COPY_DST: 2 };

try {
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");
  const { WebGlPrimitiveHighlights, WebGpuPrimitiveHighlights } = await import("../src/nativePrimitiveHighlights.ts");
  const { packVectorClips } = await import("../src/vectorClips.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const scene = Object.assign(createEmptyVectorScene(), { clipPaths: [ellipse(256)] });
  const maxSize = 24;
  const complete = packVectorClips(scene.clipPaths, undefined, { cells: true });
  const fitted = packVectorClips(scene.clipPaths, maxSize ** 2, { cells: true });
  assert(complete.length / 4 > maxSize ** 2, "optional indices exceed this small device's capacity");
  assert(fitted.length / 4 <= maxSize ** 2, "exact canonical geometry fits with a smaller index");
  const canonical = structuredClone(scene.clipPaths);

  const glUploads = [];
  const gl = new Proxy({
    getParameter: () => maxSize,
    createTexture: () => ({}),
    texImage2D(_target, _level, _internalFormat, width, height, _border, _format, _type, data) {
      glUploads.push({ width, height, data: data.slice() });
    }
  }, { get(target, key) { return target[key] ?? (() => {}); } });
  const webgl = Object.assign(Object.create(WebGlFloorplanRenderer.prototype), { gl });
  webgl.uploadVectorClips(scene);
  assert(glUploads[0].width <= maxSize && glUploads[0].height <= maxSize);
  assert.deepEqual(glUploads[0].data.subarray(0, fitted.length), fitted,
    "WebGL packing adapts optional indices before device allocation");
  assert.equal(webgl.vectorClipStoreTexels, fitted.length / 4);

  const gpuUploads = [];
  const gpu = {
    limits: { maxTextureDimension2D: maxSize },
    createBuffer: () => ({ destroy() {} }),
    queue: { writeBuffer() {} }
  };
  const webgpu = Object.assign(Object.create(WebGpuFloorplanRenderer.prototype), {
    gpuDevice: gpu, vectorClipBuffers: [], vectorClipBindGroups: [],
    createFloatTexture(width, height, data) {
      gpuUploads.push({ width, height, data: data.slice() });
      return { destroy() {} };
    },
    refreshVectorClipBindGroups() {}
  });
  webgpu.uploadVectorClips(scene);
  assert(gpuUploads[0].width <= maxSize && gpuUploads[0].height <= maxSize);
  assert.deepEqual(gpuUploads[0].data, fitted,
    "WebGPU packing adapts optional indices before device allocation");
  assert.deepEqual(scene.clipPaths, canonical, "device packing preserves source clip geometry");

  const oversized = { ...scene, clipPaths: [ellipse(1024)] };
  const glCount = glUploads.length, gpuCount = gpuUploads.length;
  assert.throws(() => webgl.uploadVectorClips(oversized), /capacity/i,
    "WebGL rejects geometry that cannot fit this actual device");
  assert.throws(() => webgpu.uploadVectorClips(oversized), /capacity/i,
    "WebGPU rejects geometry that cannot fit this actual device");
  assert.equal(glUploads.length, glCount, "impossible clip uploads fail before allocating a texture");
  assert.equal(gpuUploads.length, gpuCount, "impossible clip uploads fail before allocating a texture");

  const highlights = { clipPaths: scene.clipPaths, count: 1, selectionCount: 1,
    segments: Float32Array.of(0, 0, 0, 0, 1, 1, 0, 0) };
  const highlightMaxSize = 24;
  const highlightPacked = packVectorClips(scene.clipPaths, highlightMaxSize ** 2);
  assert(packVectorClips(scene.clipPaths).length / 4 > highlightMaxSize ** 2,
    "optional highlight bands exceed this actual device capacity");
  const highlightGlUploads = [];
  const highlightGl = new Proxy({
    getParameter: () => highlightMaxSize,
    texImage2D(_target, _level, _internalFormat, width, height, _border, _format, _type, data) {
      highlightGlUploads.push({ width, height, data: data.slice() });
    }
  }, { get(target, key) { return target[key] ?? (() => {}); } });
  const glHighlight = Object.assign(Object.create(WebGlPrimitiveHighlights.prototype), {
    gl: highlightGl, buffer: {}, clips: {}, capacityBytes: 0, clipWidth: 0, clipHeight: 0
  });
  glHighlight.set(highlights);
  assert(highlightGlUploads[0].width <= highlightMaxSize && highlightGlUploads[0].height <= highlightMaxSize);
  assert.deepEqual(highlightGlUploads[0].data.subarray(0, highlightPacked.length), highlightPacked,
    "WebGL highlight packing retains exact clipping within device capacity");

  let highlightGpuData;
  const highlightDevice = { ...gpu, limits: { maxTextureDimension2D: highlightMaxSize },
    queue: { writeBuffer() {}, writeTexture(_target, data) { highlightGpuData = data.slice(); } },
    createTexture: () => ({ createView() { return {}; } }),
    createBindGroup: () => ({})
  };
  const gpuHighlight = Object.assign(Object.create(WebGpuPrimitiveHighlights.prototype), {
    device: highlightDevice, pipeline: { getBindGroupLayout() { return {}; } }, camera: {},
    capacityBytes: 0, clipWidth: 0, clipHeight: 0
  });
  gpuHighlight.set(highlights);
  assert(gpuHighlight.clipWidth <= highlightMaxSize && gpuHighlight.clipHeight <= highlightMaxSize);
  assert.deepEqual(highlightGpuData.subarray(0, highlightPacked.length), highlightPacked,
    "WebGPU highlight packing retains exact clipping within device capacity");

  // Profiling uses the same complete ancestry as the dynamic shader traversal.
  const depth = 70;
  webgl.vectorClipHeaders = Float32Array.from(Array.from({ length: depth }, (_, index) =>
    [index - 1, 0, 1, 2]).flat());
  webgl.vectorClipIndex = depth - 1;
  let indexed = 0;
  assert.equal(webgl.countGradientClipPolygonEdges({ add(_counter, count) { indexed += count; } },
    "gradientFillIndexedClipNodes"), depth, "all validated clip ancestors contribute to profiling");
  assert.equal(indexed, depth);

  // Bounds for a large clip table are permitted when the actual device can
  // allocate them; the former independent 4 MiB cap disabled this optimization.
  const manyUploads = [];
  const manyGl = new Proxy({
    getParameter: () => 1024,
    createTexture: () => ({}),
    texImage2D(_target, _level, _internalFormat, width, height, _border, _format, _type, data) {
      manyUploads.push({ width, height, data: data.slice() });
    }
  }, { get(target, key) { return target[key] ?? (() => {}); } });
  const manyRenderer = Object.assign(Object.create(WebGlFloorplanRenderer.prototype), { gl: manyGl });
  const rectangle = { parent: -1, fillRule: 0,
    edges: Float32Array.of(0, 0, 1, 0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1, 0, 0) };
  manyRenderer.uploadVectorClips({ ...scene, clipPaths: Array(256 * 1024 + 1).fill(rectangle) });
  assert(manyRenderer.vectorClipBoundsTexture, "device-supported bounds larger than 4 MiB remain available");
  assert.equal(manyUploads.length, 2, "upload both exact clipping and its independent bounds");
  assert(manyUploads[1].width <= 1024 && manyUploads[1].height <= 1024);
  assert(manyUploads[1].data.byteLength > 4 * 1024 * 1024);

  console.log("Vector clip uploads adapt exact indices to WebGL/WebGPU device capacity and traverse complete ancestry.");
} finally {
  if (previousUsage === undefined) delete globalThis.GPUBufferUsage;
  else globalThis.GPUBufferUsage = previousUsage;
  if (previousTextureUsage === undefined) delete globalThis.GPUTextureUsage;
  else globalThis.GPUTextureUsage = previousTextureUsage;
  hooks.deregister();
}

function ellipse(count) {
  const points = Array.from({ length: count }, (_, index) => {
    const angle = index * Math.PI * 2 / count;
    return [Math.cos(angle), Math.sin(angle)];
  });
  return { parent: -1, fillRule: 0,
    edges: Float32Array.from(points.flatMap((point, index) => [...point, ...points[(index + 1) % count]])) };
}
