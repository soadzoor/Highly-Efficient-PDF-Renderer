import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(s, c, next) {
  return next(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });
try {
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const mock = mockGl();
  const renderer = new WebGlFloorplanRenderer({ width: 1920, height: 945, getContext: () => mock.gl });
  renderer.externalFrameDriver = true;
  const counters = new Map();
  renderer.performanceProfiler = { enabled: true, add(name, value = 1) { counters.set(name, value); }, dispose() {} };
  renderer.pageRects = Float32Array.from({ length: 396 * 4 }, (_, i) => {
    const page = Math.floor(i / 4);
    return [page * 20, 0, page * 20 + 10, 10][i % 4];
  });
  renderer.setAllPagesAndTextVisible();
  renderer.scene = { pendingPagePreviews: Uint8Array.from({ length: 396 }, (_, i) => i === 0 ? 1 : 0) };
  const draw = (x = 50, zoom = 1) => {
    mock.calls.length = mock.draws.length = 0;
    renderer.frameDrawCalls = 0;
    renderer.drawPageBackgrounds(1920, 945, x, 50, zoom);
  };
  draw();
  assert.equal(mock.draws.length, 1, "396 page backgrounds use a single draw");
  assert.equal(renderer.frameDrawCalls, 1, "the frame counter reports actual draws, not page instances");
  assert.deepEqual(mock.draws[0].args, ["TRIANGLE_STRIP", 0, 4, 396]);
  const { vao, program, uniforms } = mock.draws[0];
  const attributes = mock.vaos.get(vao);
  assert.equal(attributes.get(0).divisor, 0);
  assert.deepEqual(attributes.get(1), {
    enabled: true, buffer: renderer.pageBackgroundBuffer, size: 4, stride: 20, offset: 0, divisor: 1
  }, "each instance supplies one page rectangle");
  assert.deepEqual(attributes.get(4), {
    enabled: true, buffer: renderer.pageBackgroundBuffer, size: 1, stride: 20, offset: 16, divisor: 1
  }, "the same instance carries its overview loading flag");
  assert.equal(uniforms.get("uRasterTex"), 12);
  assert.equal(uniforms.get("uRasterOpacity"), 1);
  assert(uniforms.get("uPagePlaceholderTime") >= 0);
  assert.equal(counters.get("pageBackgroundBatches"), 1);
  assert.equal(counters.get("pageBackgroundInstances"), 396);
  const firstUpload = mock.uploads.get(renderer.pageBackgroundBuffer);
  assert.equal(firstUpload.length, 396 * 5);
  assert.deepEqual(firstUpload.slice(0, 10), [0, 0, 10, 10, 1, 20, 0, 10, 10, 0]);
  assert.deepEqual(firstUpload.slice(-5), [7900, 0, 10, 10, 0]);

  draw(60, 2);
  assert.equal(mock.calls.filter(c => c[0] === "bufferData").length, 0, "panning/zooming with the same pages reuses the buffer");
  assert.deepEqual(mock.draws[0].uniforms.get("uCameraCenter"), [60, 50]);
  assert.equal(mock.draws[0].uniforms.get("uZoom"), 2);
  renderer.updateVisiblePagesAndTextRanges(40, 0, 50, 10);
  draw();
  assert.equal(mock.draws[0].args[3], 1, "only visible pages are instanced");
  assert.deepEqual(mock.uploads.get(renderer.pageBackgroundBuffer), [40, 0, 10, 10, 0]);
  renderer.updateVisiblePagesAndTextRanges(60, 0, 70, 10);
  draw();
  assert.deepEqual(mock.uploads.get(renderer.pageBackgroundBuffer), [60, 0, 10, 10, 0],
    "a different page with the same visible count refreshes the buffer");

  renderer.localToClipRenderingEnabled = true;
  renderer.localToClipMatrix.set([1,0,0,0, 0,1,0,0, 0,0,1,0, .2,.3,0,1]);
  draw();
  assert.equal(mock.draws[0].uniforms.get("uUseLocalToClip"), 1);
  assert.deepEqual(mock.draws[0].uniforms.get("uLocalToClip"), Array.from(renderer.localToClipMatrix));
  assert.equal(mock.calls.filter(c => c[0] === "bufferData").length, 0, "projection changes retain instance data");
  renderer.setPageBackgroundColor(.2, .4, .6, .5);
  assert.deepEqual(mock.calls.findLast(c => c[0] === "texImage2D").at(-1), Uint8Array.of(51,102,153,128),
    "background color and alpha keep the existing texture encoding");
  draw();
  assert.equal(mock.calls.filter(c => c[0] === "bufferData").length, 0, "color changes retain instance data");

  renderer.pageRects = Float32Array.of(-5, -6, -5, -8);
  renderer.scene.pendingPagePreviews = undefined;
  renderer.setAllPagesAndTextVisible();
  draw();
  assert.deepEqual(mock.uploads.get(renderer.pageBackgroundBuffer), [-5, -6, Math.fround(1e-6), Math.fround(1e-6), 0],
    "scene replacement refreshes geometry and preserves degenerate rectangle handling");
  renderer.updateVisiblePagesAndTextRanges(100, 100, 110, 110);
  draw();
  assert.equal(mock.draws.length, 0); assert.equal(renderer.frameDrawCalls, 0);
  renderer.setAllPagesAndTextVisible(); draw();
  assert.equal(mock.calls.filter(c => c[0] === "bufferData").length, 0, "returning to the same page reuses its upload");

  renderer.rasterLayers = [{ texture: {}, opacity: .7, matrix: [2,3,4,5,6,7] }];
  renderer.drawRasterLayerAtIndex(0, 1920, 945, 50, 50, 1);
  const raster = mock.draws.at(-1);
  assert.equal(raster.program, renderer.rasterProgram);
  assert.equal(raster.vao, renderer.blitVao, "ordinary images keep their original non-instanced geometry");
  assert.deepEqual(raster.uniforms.get("uRasterMatrixABCD"), [2,3,4,5]);
  assert.deepEqual(raster.uniforms.get("uRasterMatrixEF"), [6,7]);
  const buffer = renderer.pageBackgroundBuffer;
  renderer.dispose(); renderer.dispose();
  for (const resource of [vao, program, buffer]) assert(mock.deleted.has(resource), "batch resources are released on disposal");
  assert.equal(renderer.pageBackgroundInstanceRects.length, 0);
  console.log("WebGL page backgrounds: one draw, visibility, upload reuse, projection, color, scene replacement and disposal passed.");
} finally { hooks.deregister(); }

function mockGl() {
  const calls = [], draws = [], uploads = new Map(), vaos = new Map(), uniforms = new Map(), deleted = new Set();
  let vao, buffer, program;
  const attribute = index => {
    if (!vaos.has(vao)) vaos.set(vao, new Map());
    const attributes = vaos.get(vao);
    if (!attributes.has(index)) attributes.set(index, {});
    return attributes.get(index);
  };
  const gl = new Proxy({}, { get(_target, name) {
    if (name === "TEXTURE0") return 1000;
    if (name.toUpperCase() === name) return name;
    return (...args) => {
      calls.push([name, ...args]);
      if (name.startsWith("create")) return {};
      if (name.startsWith("delete")) deleted.add(args[0]);
      if (name === "getParameter") return 4096;
      if (name === "getShaderParameter" || name === "getProgramParameter") return true;
      if (name === "getUniformLocation") return { program: args[0], name: args[1] };
      if (name === "useProgram") program = args[0];
      if (name === "bindVertexArray") vao = args[0];
      if (name === "bindBuffer") buffer = args[1];
      if (name === "bufferData") uploads.set(buffer, Array.from(args[1]));
      if (name === "enableVertexAttribArray") attribute(args[0]).enabled = true;
      if (name === "vertexAttribDivisor") attribute(args[0]).divisor = args[1];
      if (name === "vertexAttribPointer") Object.assign(attribute(args[0]), { buffer, size: args[1], stride: args[4], offset: args[5] });
      if (name.startsWith("uniform")) {
        const location = args[0];
        if (!uniforms.has(location.program)) uniforms.set(location.program, new Map());
        uniforms.get(location.program).set(location.name, name === "uniformMatrix4fv" ? Array.from(args[2]) :
          args.length === 2 ? args[1] : args.slice(1));
      }
      if (name.startsWith("drawArrays")) draws.push({ args, vao, program, uniforms: new Map(uniforms.get(program)) });
    };
  } });
  return { gl, calls, draws, uploads, vaos, deleted };
}
