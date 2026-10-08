import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const warn = console.warn, warnings = [];
console.warn = (...args) => warnings.push(args);
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { deviceMemory: 0.5 } });

try {
  const { WebGlRasterCompression, detectWebGlRasterCompression } = await import("../src/webGlRasterCompression.ts");
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { estimateCompressedRasterBytes, rasterCompressionMipLayout } = await import("../src/rasterCompression.ts");
  const { automaticRasterMemoryBudget, estimateRasterTextureBytes } = await import("../src/rasterMemoryBudget.ts");
  const { monochromeRasterFragmentGlsl } = await import("../src/monochromeRasterWebGlShader.ts");
  const { RASTER_FRAGMENT_SHADER_SOURCE } = await import("../src/nativeWebGlCoreShaders.ts");
  const noSupport = mockGl(32, false);
  assert.deepEqual(detectWebGlRasterCompression(noSupport.gl), { bc7: false, astc4x4: false });

  for (const format of ["bc7", "astc-4x4"]) {
    const mock = mockGl(32), encoder = new WebGlRasterCompression(mock.gl);
    const initial = mock.snapshot();
    const pixels = new Uint8Array(7 * 11 * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([100, 50, 25, 128], i);
    const compressed = encoder.upload(pixels, 7, 11, format, 768);
    assert.deepEqual(compressed.uvScale, [7 / 8, 11 / 12]);
    assert.equal(compressed.estimatedBytes, estimateCompressedRasterBytes(7, 11, format));
    assert.equal(encoder.workspaceBytes, 768, "input band, integer target and PBO share the fixed workspace allowance");
    assert.deepEqual(mock.storage.find(call => typeof call[2] === "number").slice(1),
      [4, format === "bc7" ? 0x8e8c : 0x93b0, 8, 12], "immutable compressed storage includes the full physical mip chain");
    assert.deepEqual(mock.snapshot(), initial, "encoding restores texture/sampler/program/VAO/FBO/PBO/pixel-store/draw state");
    assert.deepEqual(mock.compressed.map(call => call.slice(1, 7)), [
      [0, 0, 0, 8, 4, format === "bc7" ? 0x8e8c : 0x93b0],
      [0, 0, 4, 8, 4, format === "bc7" ? 0x8e8c : 0x93b0],
      [0, 0, 8, 8, 4, format === "bc7" ? 0x8e8c : 0x93b0],
      [1, 0, 0, 4, 4, format === "bc7" ? 0x8e8c : 0x93b0],
      [1, 0, 4, 4, 2, format === "bc7" ? 0x8e8c : 0x93b0],
      [2, 0, 0, 2, 3, format === "bc7" ? 0x8e8c : 0x93b0],
      [3, 0, 0, 1, 1, format === "bc7" ? 0x8e8c : 0x93b0]
    ], "block-aligned bands populate every padded physical mip, including terminal partial blocks");
    assert(mock.reads.every(call => call.at(-1) === 0));
    assert(mock.compressed.every(call => call.at(-1) === 0), "the same PBO supplies byte offset zero without JS readback");
    assert.deepEqual(mock.bandPixels[0].subarray(0, 4), Uint8Array.of(100, 50, 25, 128), "already-premultiplied source bytes are unchanged");
    const allocations = mock.allocations;
    const other = encoder.upload(new Uint8Array(12 * 12 * 4).fill(128), 12, 12, format, 768);
    assert.equal(mock.allocations - allocations, 1, "different source widths reuse the fixed device-width workspace");
    mock.gl.deleteTexture(compressed.texture); mock.gl.deleteTexture(other.texture);
    encoder.dispose(); assert.equal(mock.alive.size, 0);
    assert.equal(mock.listeners.size, 0);
  }

  for (const format of ["bc7", "astc-4x4"]) {
    const mock = mockGl(32), encoder = new WebGlRasterCompression(mock.gl);
    mock.allowReadback = true;
    const initial = mock.snapshot(), pixels = new Uint8Array(7 * 11 * 4).fill(255);
    const encoded = encoder.encode(pixels, 7, 11, format, 768);
    const layout = rasterCompressionMipLayout(7, 11, format);
    const expected = new Uint8Array(estimateCompressedRasterBytes(7, 11, format));
    let marker = 0;
    for (const level of layout) {
      for (let row = 0; row < level.blocksY; row++) {
        const start = level.byteOffset + row * level.blocksX * 16;
        expected.fill(++marker, start, start + level.blocksX * 16);
      }
    }
    assert.deepEqual(encoded, expected, "parsing retains compact bytes in contiguous physical mip and block-row order");
    assert.equal(mock.compressed.length, 0, "preparation needs no sampled compressed destination texture");
    assert.equal(encoder.workspaceBytes, 768);
    assert.equal(mock.readbacks.length, marker);
    assert(mock.readbacks.every(read => read.byteLength <= read.bufferBytes && read.bufferBytes <= 768),
      "each compressed readback is bounded by the shared band buffer");
    assert.deepEqual(mock.snapshot(), initial, "byte encoding restores all renderer GL state");

    const draws = mock.draws, reads = mock.reads.length, readbacks = mock.readbacks.length;
    const compressed = encoder.uploadEncoded(encoded, 7, 11, format);
    assert.equal(mock.draws, draws, "prepared bytes upload without executing the encoder again");
    assert.equal(mock.reads.length, reads);
    assert.equal(mock.readbacks.length, readbacks);
    assert.deepEqual(compressed.uvScale, [7 / 8, 11 / 12]);
    assert.equal(compressed.estimatedBytes, encoded.byteLength);
    assert.deepEqual(mock.compressed.map(call => call.slice(1, 7)), layout.map((level, mip) =>
      [mip, 0, 0, level.width, level.height, format === "bc7" ? 0x8e8c : 0x93b0]));
    assert.deepEqual(mock.compressed.map(call => Array.from(call[7])), layout.map(level =>
      Array.from(encoded.subarray(level.byteOffset, level.byteOffset + level.byteLength))),
    "every uploaded mip contains precisely the saved bytes for that level");
    assert.deepEqual(mock.snapshot(), initial, "saved-byte upload preserves renderer GL state");

    const allocations = mock.allocations;
    for (const invalid of [encoded.subarray(1), new Uint8Array(encoded.byteLength + 1)]) {
      assert.throws(() => encoder.uploadEncoded(invalid, 7, 11, format), RangeError);
    }
    assert.throws(() => encoder.uploadEncoded(encoded, 0, 11, format));
    assert.throws(() => encoder.uploadEncoded(encoded, 33, 11, format));
    assert.equal(mock.allocations, allocations, "invalid saved bytes or dimensions fail before GPU allocation");
    assert(encoder.capabilities[format === "bc7" ? "bc7" : "astc4x4"], "invalid cache input cannot disable supported compression");
    mock.gl.deleteTexture(compressed.texture); encoder.dispose();
    assert.equal(mock.alive.size, 0);
  }

  for (const abortDuringRead of [false, true]) {
    const mock = mockGl(32), encoder = new WebGlRasterCompression(mock.gl), abort = new AbortController();
    mock.allowReadback = true;
    const initial = mock.snapshot();
    if (abortDuringRead) mock.onRead = () => abort.abort(); else abort.abort();
    assert.throws(() => encoder.encode(new Uint8Array(8 * 12 * 4).fill(255), 8, 12, "bc7", 768, abort.signal),
      error => error.code === "aborted");
    assert.deepEqual(mock.snapshot(), initial, "cancelled preparation restores caller GL state");
    assert.equal(encoder.workspaceBytes, 0);
    assert.equal(encoder.capabilities.bc7, true, "user cancellation cannot mark an otherwise usable format as failed");
    if (!abortDuringRead) assert.equal(mock.allocations, 0, "already-cancelled parsing allocates no encoder resources");
    encoder.dispose(); assert.equal(mock.alive.size, 0);
  }

  for (const fail of ["shader", "framebuffer", "buffer", "compressed"]) {
    const mock = mockGl(32); mock.fail = fail;
    const encoder = new WebGlRasterCompression(mock.gl), initial = mock.snapshot();
    assert.throws(() => encoder.upload(new Uint8Array(8 * 12 * 4).fill(255), 8, 12, "bc7", 768));
    assert.equal(encoder.workspaceBytes, 0);
    assert.equal(encoder.capabilities.bc7, false, "a failed format is excluded from the fallback plan");
    assert.deepEqual(mock.snapshot(), initial);
    encoder.dispose(); assert.equal(mock.alive.size, 0, `${fail} failure releases partial destinations, scratch objects and programs`);
  }

  const lost = mockGl(32), reset = new WebGlRasterCompression(lost.gl);
  const beforeLoss = reset.upload(new Uint8Array(8 * 8 * 4).fill(255), 8, 8, "bc7", 768);
  lost.gl.deleteTexture(beforeLoss.texture);
  lost.contextLost = true;
  for (const listener of lost.listeners) listener();
  assert.equal(reset.workspaceBytes, 0);
  assert.deepEqual(reset.capabilities, { bc7: false, astc4x4: false });
  lost.contextLost = false;
  const afterLoss = reset.upload(new Uint8Array(8 * 8 * 4).fill(255), 8, 8, "bc7", 768);
  lost.gl.deleteTexture(afterLoss.texture); reset.dispose();
  assert.equal(lost.alive.size, 0, "context restoration recreates both programs and workspace");

  const padded = mockGl(32), paddedRenderer = makeRenderer(WebGlFloorplanRenderer, padded.gl, createEmptyVectorScene());
  const paddedLayer = paddedRenderer.createRasterLayerGpu({ width: 7, height: 11,
    data: new Uint8Array(7 * 11 * 4).fill(255), matrix: Float32Array.of(7, 0, 0, 11, 0, 0) }, 0, undefined, "bc7");
  assert.deepEqual(paddedLayer.uv, Float32Array.of(0, 0, 7 / 8, 11 / 12), "whole-image GPU layers preserve logical UVs after block padding");
  paddedRenderer.drawRasterTile(paddedLayer);
  assert(padded.uniforms.some(call => call[0] === "uRasterOpaque" && call[1] === 1));
  paddedRenderer.deleteRasterLayerTextures(paddedLayer); paddedRenderer.rasterCompression.dispose();
  assert.equal(padded.alive.size, 0);

  const smooth = new Uint8Array(1024 * 1024 * 4);
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
    smooth.set([Math.floor(x / 8), Math.floor(y / 8), Math.floor((x + y) / 16), 255], (y * 1024 + x) * 4);
  }
  const scene = Object.assign(createEmptyVectorScene(), {
    rasterLayers: Array.from({ length: 4 }, (_, index) => ({ width: 1024, height: 1024, data: smooth,
      matrix: Float32Array.of(1024, 0, 0, 1024, index, 0), opacity: 0.5, paintOrder: index, pageIndex: 0 }))
  });
  const success = mockGl(4096), renderer = makeRenderer(WebGlFloorplanRenderer, success.gl, scene);
  renderer.uploadRasterLayers(scene);
  assert(renderer.rasterLayers.every(layer => layer.compressionFormat === "bc7"));
  assert(renderer.rasterLayers.every(layer => layer.estimatedBytes === estimateCompressedRasterBytes(1024, 1024, "bc7")),
    "compressed allocation bytes enter the residency ledger");
  assert(renderer.estimatedRasterResidentBytes() <= automaticRasterMemoryBudget().bytes);
  assert.equal(renderer.rasterStripBatches.size + renderer.rasterAtlasBatches.size, 0);
  assert.equal(scene.rasterLayers[0].data, smooth);
  const prepared = renderer.prepareRasterLayerUpdates(new Map([[0, { ...scene.rasterLayers[0], matrix: Float32Array.of(1024, 0, 0, 1024, 9, 0) }]]));
  prepared.dispose();
  assert.equal(renderer.rasterStagedBytes, 0);
  assert(renderer.rasterCompression.workspaceBytes > 0, "pending plans retain the shared bounded encoder pool");
  renderer.destroyRasterLayerTextures(); renderer.rasterCompression.dispose();
  assert.equal(success.alive.size, 0);

  const fallback = mockGl(4096); fallback.astc = false; fallback.fail = "compressed";
  const fallbackRenderer = makeRenderer(WebGlFloorplanRenderer, fallback.gl, scene);
  fallbackRenderer.uploadRasterLayers(scene);
  assert(fallbackRenderer.rasterLayers.every(layer => !layer.compressionFormat));
  assert(fallback.rgbaUploads.every(upload => upload.width < 1024), "failed compression replans RGBA resolution instead of retaining an over-budget full-size fallback");
  assert(fallbackRenderer.estimatedRasterResidentBytes() <= automaticRasterMemoryBudget().bytes);
  assert.equal(fallbackRenderer.rasterCompression.workspaceBytes, 0);
  assert(warnings.some(args => String(args[0]).includes("replanning raster memory")));
  fallbackRenderer.destroyRasterLayerTextures(); fallbackRenderer.rasterCompression.dispose();
  assert.equal(fallback.alive.size, 0);
  assert(monochromeRasterFragmentGlsl(RASTER_FRAGMENT_SHADER_SOURCE).includes("if (uRasterOpaque > 0.5) color.a = 1.0"),
    "opaque compressed pixels correct BC7 endpoint alpha before scene opacity is applied");
  assert(!RASTER_FRAGMENT_SHADER_SOURCE.includes("uRasterOpaque"), "shared Three/page-background shaders keep their defaults");
  console.log("WebGL GPU block compression: fixed bands, bounded parser readback, prepared mip uploads, cancellation, UVs, state, failures, context restoration, residency and budget fallback passed.");

  function mockGl(limit, support = true) {
    const alive = new Set(), listeners = new Set(), stores = new Map(), bindings = new Map(), enabled = new Set(["BLEND", "SCISSOR_TEST", "DITHER"]);
    const pixels = new Map([['PACK_ALIGNMENT', 4], ['UNPACK_ALIGNMENT', 8]]);
    for (const parameter of ["PACK_ROW_LENGTH", "PACK_SKIP_PIXELS", "PACK_SKIP_ROWS", "UNPACK_ROW_LENGTH", "UNPACK_IMAGE_HEIGHT",
      "UNPACK_SKIP_PIXELS", "UNPACK_SKIP_ROWS", "UNPACK_SKIP_IMAGES", "UNPACK_FLIP_Y_WEBGL", "UNPACK_PREMULTIPLY_ALPHA_WEBGL",
      "UNPACK_COLORSPACE_CONVERSION_WEBGL"]) pixels.set(parameter, 0);
    const state = { active: 1007, viewport: [5, 6, 20, 21], mask: [true, false, true, false],
      program: {}, vao: {}, draw: {}, read: {}, sampler: {}, error: 0 };
    bindings.set(1000, {}); stores.set("PIXEL_PACK_BUFFER", {}); stores.set("PIXEL_UNPACK_BUFFER", {});
    let id = 0, boundBuffer = null;
    const mock = { alive, listeners, compressed: [], reads: [], readbacks: [], storage: [], uniforms: [], bandPixels: [], rgbaUploads: [], allocations: 0,
      astc: support, contextLost: false, fail: "", allowReadback: false, onRead: null, draws: 0,
      snapshot: () => ({ ...state, viewport: [...state.viewport], mask: [...state.mask], bindings: [...bindings], stores: [...stores], pixels: [...pixels], enabled: [...enabled].sort() }) };
    const gl = new Proxy({ TEXTURE0: 1000, NO_ERROR: 0, canvas: {
      addEventListener(_name, fn) { listeners.add(fn); }, removeEventListener(_name, fn) { listeners.delete(fn); }
    } }, { get(target, name) {
      if (name in target) return target[name];
      if (name.toUpperCase() === name) return name;
      return (...args) => {
        if (name === "getExtension") return name && args[0] === "EXT_texture_compression_bptc" && support
          ? { COMPRESSED_RGBA_BPTC_UNORM_EXT: 0x8e8c } : args[0] === "WEBGL_compressed_texture_astc" && mock.astc
            ? { COMPRESSED_RGBA_ASTC_4x4_KHR: 0x93b0, getSupportedProfiles: () => ["ldr"] } : null;
        if (name === "isContextLost") return mock.contextLost;
        if (name === "getParameter") return ({ MAX_TEXTURE_SIZE: limit, ACTIVE_TEXTURE: state.active, TEXTURE_BINDING_2D: bindings.get(state.active),
          VIEWPORT: state.viewport, COLOR_WRITEMASK: state.mask, CURRENT_PROGRAM: state.program, VERTEX_ARRAY_BINDING: state.vao,
          SAMPLER_BINDING: state.sampler, DRAW_FRAMEBUFFER_BINDING: state.draw, READ_FRAMEBUFFER_BINDING: state.read,
          PIXEL_PACK_BUFFER_BINDING: stores.get("PIXEL_PACK_BUFFER"), PIXEL_UNPACK_BUFFER_BINDING: stores.get("PIXEL_UNPACK_BUFFER") })[args[0]] ?? pixels.get(args[0]) ?? 0;
        if (name.startsWith("create")) {
          if (name === "createBuffer" && mock.fail === "buffer") return null;
          const resource = { id: ++id, kind: name }; alive.add(resource); mock.allocations++; return resource;
        }
        if (name.startsWith("delete")) { alive.delete(args[0]); return; }
        if (name === "getShaderParameter") return mock.fail !== "shader";
        if (name === "getProgramParameter") return true;
        if (name === "getUniformLocation") return args[1];
        if (name === "checkFramebufferStatus") return mock.fail === "framebuffer" ? "INCOMPLETE" : "FRAMEBUFFER_COMPLETE";
        if (name === "getError") { const value = state.error; state.error = 0; return value; }
        if (name === "isEnabled") return enabled.has(args[0]);
        if (name === "enable") enabled.add(args[0]);
        if (name === "disable") enabled.delete(args[0]);
        if (name === "activeTexture") state.active = args[0];
        if (name === "bindTexture") bindings.set(state.active, args[1]);
        if (name === "bindSampler") state.sampler = args[1];
        if (name === "useProgram") state.program = args[0];
        if (name === "bindVertexArray") state.vao = args[0];
        if (name === "viewport") state.viewport = args;
        if (name === "colorMask") state.mask = args;
        if (name === "pixelStorei") pixels.set(args[0], args[1]);
        if (name === "texStorage2D") {
          mock.storage.push(args);
          const texture = bindings.get(state.active);
          texture.storage = { levels: args[1], format: args[2], width: args[3], height: args[4] };
          texture.uploadedRows = new Map();
          if (typeof args[2] === "number") {
            assert.equal(args[3] % 4, 0); assert.equal(args[4] % 4, 0);
            assert.equal(args[1], Math.floor(Math.log2(Math.max(args[3], args[4]))) + 1);
          }
        }
        if (name === "uniform1f") mock.uniforms.push(args);
        if (name === "bindFramebuffer") { if (args[0] !== "READ_FRAMEBUFFER") state.draw = args[1]; if (args[0] !== "DRAW_FRAMEBUFFER") state.read = args[1]; }
        if (name === "bindBuffer") { stores.set(args[0], args[1]); boundBuffer = args[1]; }
        if (name === "bufferData") boundBuffer.bytes = typeof args[1] === "number" ? args[1] : args[1].byteLength;
        if (name === "texSubImage2D") { assert.equal(stores.get("PIXEL_UNPACK_BUFFER"), null); mock.bandPixels.push(args.at(-1).slice()); }
        if (name === "drawArrays") mock.draws++;
        if (name === "readPixels") {
          assert.equal(typeof args.at(-1), "number"); assert(stores.get("PIXEL_PACK_BUFFER"));
          mock.reads.push(args); stores.get("PIXEL_PACK_BUFFER").marker = mock.reads.length;
          mock.onRead?.();
        }
        if (name === "compressedTexSubImage2D") {
          const fromBytes = args[7] instanceof Uint8Array;
          if (fromBytes) assert.equal(stores.get("PIXEL_UNPACK_BUFFER"), null);
          else assert.equal(stores.get("PIXEL_UNPACK_BUFFER"), stores.get("PIXEL_PACK_BUFFER"));
          const texture = bindings.get(state.active), storage = texture.storage;
          const [, level, x, y, width, height, format] = args;
          const mipWidth = Math.max(1, storage.width >> level), mipHeight = Math.max(1, storage.height >> level);
          assert.equal(format, storage.format);
          assert.equal(x % 4, 0); assert.equal(y % 4, 0);
          assert(width % 4 === 0 || x + width === mipWidth, "partial block widths must reach the mip edge");
          assert(height % 4 === 0 || y + height === mipHeight, "partial block heights must reach the mip edge");
          assert(x + width <= mipWidth && y + height <= mipHeight);
          if (format === 0x8e8c) {
            assert.equal((mipWidth << level) % 4, 0);
            assert.equal((mipHeight << level) % 4, 0);
          }
          assert.equal(y, texture.uploadedRows.get(level) ?? 0, "bands upload in contiguous row order");
          texture.uploadedRows.set(level, y + height);
          assert.equal(fromBytes ? args[7].byteLength : args[7], Math.ceil(args[4] / 4) * Math.ceil(args[5] / 4) * 16);
          mock.compressed.push(args); if (mock.fail === "compressed") state.error = "INVALID_OPERATION";
        }
        if (name === "texImage2D") mock.rgbaUploads.push({ width: args[3], height: args[4] });
        if (name === "getBufferSubData") {
          if (!mock.allowReadback) throw new Error("JS compressed-byte readback is prohibited during renderer upload");
          const buffer = stores.get(args[0]);
          assert.equal(args[1], 0);
          assert(args[2] instanceof Uint8Array);
          assert(args[2].byteLength <= buffer.bytes);
          args[2].fill(buffer.marker);
          mock.readbacks.push({ byteLength: args[2].byteLength, bufferBytes: buffer.bytes });
        }
      };
    } });
    mock.gl = gl; return mock;
  }
} finally {
  console.warn = warn;
  if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
  else delete globalThis.navigator;
  hooks.deregister();
}

function makeRenderer(Renderer, gl, scene) {
  return Object.assign(Object.create(Renderer.prototype), { gl, scene, isDisposed: false,
    rasterTextureResidencyEnabled: true, rasterLayers: [], rasterLayerUpdates: new Map(),
    rasterStripBatches: new Map(), rasterAtlasBatches: new Map(), rasterStagedBytes: 0,
    uRasterOpaque: "uRasterOpaque", frameDrawCalls: 0,
    destroyVectorMinifyResources() {}, requestFrame() {} });
}
