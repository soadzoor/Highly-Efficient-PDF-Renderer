import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });
try {
  const { WebGlFloorplanRenderer: Renderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { VectorOrderedBatches } = await import("../src/vectorOrderedBatches.ts");
  const { buildRasterRepeatInstances, translateRasterRepeat } = await import("../src/rasterRepeat.ts");
  const repeat = { transform: Float64Array.of(.6677356761455009, 0, 0, -.6677356761455009, .25, 20),
    bounds: Float64Array.of(0, 0, .9998646415770054, .9998646415770054),
    xStep: 1, yStep: 1, xFirst: -20, xLast: 79, yFirst: -3, yLast: 6 };
  const data = new Uint8Array(256).fill(255);
  const image = { width: 8, height: 8, data, matrix: Float32Array.of(100, 0, 0, -10, 0, 20),
    opacity: .5, interpolate: false, pageIndex: 0, paintOrder: 0 };
  const layers = [{ ...image, repeat }, { ...image, paintOrder: 1 },
    { ...image, repeat: translateRasterRepeat({ ...repeat, xLast: -18, yLast: -2 }, 17, -4), paintOrder: 2 }];
  const scene = Object.assign(createEmptyVectorScene(), { rasterLayers: layers,
    clipPaths: [{ parent: -1, fillRule: 0, edges: Float32Array.of(0, 0, 100, 0, 100, 0, 100, 100, 100, 100, 0, 100, 0, 100, 0, 0) }],
    drawRuns: [{ kind: "raster", first: 0, count: 3, clipIndex: 0 }] });
  const canonical = structuredClone(scene), mock = mockGl();
  const renderer = new Renderer({ width: 100, height: 80, getContext: () => mock.gl });
  mock.describe = program => renderer.describeProgram(program);
  renderer.setExternalFrameDriver(true);
  Object.assign(renderer, { scene, orderedBatches: new VectorOrderedBatches(scene, null) });
  renderer.uploadVectorClips(scene); renderer.uploadRasterLayers(scene);
  assert.equal(renderer.rasterLayers.length, 3);
  assert.equal(new Set(renderer.rasterLayers.map(layer => layer.texture)).size, 1,
    "repeat grids and ordinary placements share canonical pixels");
  const first = renderer.rasterLayers[0];
  assert.equal(first.repeat.count, 1000);
  assert.deepEqual(mock.buffers.get(first.repeat.buffer), buildRasterRepeatInstances(repeat),
    "one packed buffer reproduces every original cell placement");
  assert.equal(renderer.rasterRepeatBufferBytes, (1000 + 6) * 24);
  mock.clear(); renderer.drawSourceOrderedContent(100, 80, 0, 0, 1);
  assert.deepEqual(mock.paints.map(p => [p.label, p.count]), [["rasterRepeat", 1000], ["raster", 1], ["rasterRepeat", 6]],
    "repeat instances keep paint order across ordinary image boundaries");
  assert(mock.paints.filter(p => p.label === "rasterRepeat").every(p => p.uniforms.get("uVectorClipIndex")[0] === 0));
  assert(mock.paints.every(p => p.uniforms.get("uRasterOpacity")[0] === .5));
  mock.clear(); renderer.localToClipRenderingEnabled = true;
  renderer.drawSourceOrderedContent(100, 80, 10, 5, 2);
  assert(mock.paints.every(p => p.uniforms.get("uUseLocalToClip")[0] === 1));
  assert(!mock.calls.some(call => ["bufferData", "texImage2D", "createBuffer", "createTexture"].includes(call[0])),
    "panning and projected rendering reuse repeat geometry and texture storage");
  renderer.localToClipRenderingEnabled = false;
  mock.clear(); renderer.multiplyPass = 0;
  renderer.drawRasterLayerAtIndex(0, 100, 80, 0, 0, 1);
  assert.equal(mock.paints[0].count, 1000);
  assert(mock.calls.some(call => call[0] === "blendFuncSeparate" && call[1] === "DST_COLOR"));
  renderer.multiplyPass = null;
  const oldBuffer = first.repeat.buffer;
  const cancelled = renderer.prepareRasterLayerUpdates(new Map([[0, { ...layers[0], repeat: { ...repeat, xLast: -19 } }]]));
  const cancelledBuffer = [...mock.alive].find(resource => resource.kind === "Buffer" && resource !== oldBuffer &&
    mock.buffers.get(resource)?.length === 20 * 6);
  assert(cancelledBuffer); cancelled.dispose(); assert(!mock.alive.has(cancelledBuffer));
  assert(mock.alive.has(oldBuffer), "cancelling an update preserves the presented repeat geometry");
  const updated = renderer.prepareRasterLayerUpdates(new Map([[0, { ...layers[0], repeat: { ...repeat, xLast: -19 } }]]));
  updated.commit(); updated.dispose();
  assert.equal(renderer.rasterLayers[0].repeat.count, 20);
  const replacementBuffer = renderer.rasterLayers[0].repeat.buffer;
  renderer.setRasterTextureResidency(false);
  assert.equal(renderer.rasterRepeatBufferBytes, 0);
  assert(!mock.alive.has(oldBuffer) && !mock.alive.has(replacementBuffer));
  renderer.setRasterTextureResidency(true);
  assert.equal(renderer.rasterLayers[0].repeat.count, 20, "residency restoration keeps committed repeat metadata");
  assert.deepEqual(scene, canonical, "view-owned updates leave canonical repeat metadata intact");
  renderer.dispose();
  assert.equal(mock.alive.size, 0, "all programs, textures, buffers and VAOs are released exactly once");

  const failedMock = mockGl(), failed = new Renderer({ width: 100, height: 80, getContext: () => failedMock.gl });
  failed.setExternalFrameDriver(true); failedMock.failBufferUpload = true;
  assert.throws(() => failed.createRasterLayerGpu(layers[0], 0), /synthetic repeat buffer/);
  assert.equal(failed.sharedRasterTextureBytes, 0); assert.equal(failed.rasterRepeatBufferBytes, 0);
  failedMock.failBufferUpload = false;
  const retry = failed.createRasterLayerGpu(layers[0], 0); failed.deleteRasterLayerTextures(retry);
  failed.dispose(); assert.equal(failedMock.alive.size, 0, "partial repeat failures release their shared texture lease");
  console.log("WebGL compact raster repeats: exact instances, shared texture, clips, order, projection, Multiply, updates, residency and cleanup passed.");
} finally { hooks.deregister(); }

function mockGl() {
  const alive = new Set(), buffers = new Map(), uniforms = new Map(), calls = [], paints = [];
  let nextId = 0, program, buffer;
  const mock = { alive, buffers, calls, paints, describe: () => null, failBufferUpload: false,
    clear() { calls.length = paints.length = 0; } };
  mock.gl = new Proxy({ TEXTURE0: 1000 }, { get(target, name) {
    if (name in target) return target[name];
    if (typeof name === "string" && name.toUpperCase() === name) return name;
    return (...args) => {
      calls.push([name, ...args]);
      if (name.startsWith("create")) { const value = { kind: name.slice(6), id: ++nextId }; alive.add(value); return value; }
      if (name.startsWith("delete")) { if (args[0]) assert(alive.delete(args[0]), `release exactly once: ${name}`); return; }
      if (name === "getParameter") return 4096;
      if (name === "getShaderParameter" || name === "getProgramParameter") return true;
      if (name === "getUniformLocation") return { program: args[0], name: args[1] };
      if (name === "useProgram") { program = args[0]; if (!uniforms.has(program)) uniforms.set(program, new Map()); }
      if (name.startsWith("uniform")) {
        assert.equal(args[0].program, program, "uniform locations belong to the active raster program");
        uniforms.get(program).set(args[0].name, args.slice(1));
      }
      if (name === "bindBuffer") buffer = args[1];
      if (name === "bufferData" && ArrayBuffer.isView(args[1])) {
        if (mock.failBufferUpload) throw new Error("synthetic repeat buffer upload failure");
        buffers.set(buffer, args[1].slice());
      }
      if (name.startsWith("drawArrays")) paints.push({ label: mock.describe(program),
        count: name === "drawArraysInstanced" ? args[3] : 1, uniforms: new Map(uniforms.get(program)) });
    };
  } });
  return mock;
}
