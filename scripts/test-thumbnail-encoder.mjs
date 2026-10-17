import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";
import { inflateSync } from "node:zlib";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")
      ? `${specifier}.ts` : specifier, context);
  }
});
const scratch = await mkdtemp(join(tmpdir(), "hepr-thumbnail-encoder-"));
const workers = [];
const originalWorker = globalThis.Worker;
try {
  const { ThumbnailEncoder, encodeThumbnailPixelsDirect, createThumbnailWebpCodec, THUMBNAIL_WEBP_ASSET } = await import("../src/thumbnailEncoder.ts");
  const manifest = JSON.parse(await readFile(new URL("../src/assets/codecs/webp/manifest.json", import.meta.url), "utf8"));
  const binary = Uint8Array.from(await readFile(THUMBNAIL_WEBP_ASSET));
  assert.equal(binary.length, manifest.runtime.byteLength);
  assert.equal(createHash("sha256").update(binary).digest("hex"), manifest.runtime.sha256);
  assert.equal(manifest.libwebpRevision, "3757b8afeb54e305eaef18502812a9a88b7ed662");

  const fixture = { width: 8, height: 8, rgba: new Uint8Array(8 * 8 * 4) };
  for (let index = 0; index < 64; index++) fixture.rgba.set([(index * 29) & 255, (index * 113) & 255, 251 - index, [0, 1, 63, 128, 254, 255][index % 6]], index * 4);

  const originalCompile = WebAssembly.compile;
  const diagnostics = [];
  let rejectedCodecCompiles = 0;
  WebAssembly.compile = async (source, ...options) => {
    const bytes = ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
      : source instanceof ArrayBuffer ? new Uint8Array(source) : null;
    // Node also lazily compiles its HTTP parser when PNG fallback constructs a
    // Response. Fail only this codec so unrelated runtime initialization works.
    if (bytes?.byteLength === binary.byteLength && Buffer.compare(bytes, binary) === 0) {
      rejectedCodecCompiles++;
      throw Error("Synthetic unavailable WASM capability.");
    }
    return originalCompile.call(WebAssembly, source, ...options);
  };
  try {
    const fallback = await encodeThumbnailPixelsDirect(fixture, "webp", undefined, diagnostic => diagnostics.push(diagnostic));
    assert.equal(fallback.type, "image/png");
    assert.deepEqual(decodePng(new Uint8Array(await fallback.arrayBuffer())).rgba, fixture.rgba);
  } finally { WebAssembly.compile = originalCompile; }
  assert.equal(rejectedCodecCompiles, 1, "fallback exercises an actual WebP codec compilation failure");
  assert.equal(diagnostics[0].code, "thumbnail.webp-png-fallback");

  const codec = await createThumbnailWebpCodec(binary);
  for (let repeat = 0; repeat < 3; repeat++) {
    const encoded = codec.encode(fixture);
    assert.equal(new TextDecoder().decode(encoded.subarray(12, 16)), "VP8L", "WebP uses the lossless bitstream, never quality-1 browser lossy output");
    const decoded = decodeWebp(binary, encoded);
    assert.equal(decoded.width, fixture.width);
    assert.equal(decoded.height, fixture.height);
    assert.deepEqual(decoded.rgba, fixture.rgba, "all straight RGBA bytes survive, including hidden transparent RGB and one-step alpha");
  }
  const webp = await encodeThumbnailPixelsDirect(fixture, "webp");
  assert.equal(webp.type, "image/webp", "a failed initial codec load is evicted and retried");
  const png = await encodeThumbnailPixelsDirect(fixture, "png");
  assert.equal(png.type, "image/png");
  assert.deepEqual(decodePng(new Uint8Array(await png.arrayBuffer())).rgba, fixture.rgba);
  const compression = globalThis.CompressionStream;
  try {
    globalThis.CompressionStream = undefined;
    const stored = await encodeThumbnailPixelsDirect(fixture, "png");
    assert.deepEqual(decodePng(new Uint8Array(await stored.arrayBuffer())).rgba, fixture.rgba, "PNG remains available without CompressionStream or canvas");
  } finally { globalThis.CompressionStream = compression; }
  const wide = { width: 16384, height: 1, rgba: new Uint8Array(16384 * 4) };
  const limits = [];
  assert.equal((await encodeThumbnailPixelsDirect(wide, "webp", undefined, diagnostic => limits.push(diagnostic))).type, "image/png");
  assert.equal(limits[0].code, "thumbnail.webp-png-fallback", "intrinsic WebP dimension limit preserves usable PNG output");
  await assert.rejects(encodeThumbnailPixelsDirect({ ...fixture, rgba: new Uint8Array(1) }, "png"), RangeError);
  const aborted = new AbortController(), abortReason = Error("fixture removed");
  aborted.abort(abortReason);
  await assert.rejects(encodeThumbnailPixelsDirect(fixture, "webp", aborted.signal), error => error === abortReason);

  const adapterPath = join(scratch, "worker-adapter.mjs");
  await writeFile(adapterPath, `import { parentPort, workerData } from "node:worker_threads";
import { registerHooks } from "node:module";
registerHooks({ resolve(s,c,n) { return n(c.parentURL?.includes("/src/") && /^\\.\\.?\\//.test(s) && !s.endsWith(".ts") ? s+".ts" : s,c); } });
globalThis.postMessage = message => parentPort.postMessage(message);
const instantiate = WebAssembly.instantiate.bind(WebAssembly);
WebAssembly.instantiate = async (...args) => {
  const instance = await instantiate(...args);
  if (!instance.exports?.h) return instance;
  return { exports: { ...instance.exports, h(...callArgs) {
    parentPort.postMessage({ encodingStarted: true });
    return instance.exports.h(...callArgs);
  } } };
};
await import(workerData.entry);
parentPort.on("message", data => globalThis.onmessage({ data }));
`);
  let onEncodeStarted;
  globalThis.Worker = class BrowserWorkerAdapter {
    onmessage;
    onerror;
    terminated = false;
    posted = [];
    constructor(entry) {
      this.native = new NodeWorker(pathToFileURL(adapterPath), { workerData: { entry: entry.href } });
      this.native.on("message", data => {
        if (data.encodingStarted) { onEncodeStarted?.(); return; }
        this.onmessage?.({ data });
      });
      this.native.on("error", error => this.onerror?.({ message: error.message, preventDefault() {} }));
      workers.push(this);
    }
    postMessage(message, transfer) { this.posted.push(message.id); this.native.postMessage(message, transfer); }
    terminate() { this.terminated = true; void this.native.terminate(); }
  };
  const encoder = new ThumbnailEncoder();
  const originalPixels = fixture.rgba.slice();
  assert.equal((await encoder.encode(fixture, "webp")).type, "image/webp");
  assert.equal(workers.length, 1);
  assert.deepEqual(fixture.rgba, originalPixels, "canonical caller pixels are never detached or modified");
  const busy = new AbortController(), queued = new AbortController();
  const busyReason = Error("replaced while encoding"), queuedReason = Error("queued thumbnail removed");
  const large = { width: 2048, height: 2048, rgba: new Uint8Array(2048 * 2048 * 4) };
  let state = 7;
  for (let index = 0; index < large.rgba.length; index++) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; large.rgba[index] = state >>> 24; }
  onEncodeStarted = () => { onEncodeStarted = undefined; busy.abort(busyReason); };
  const busyRejected = assert.rejects(encoder.encode(large, "webp", busy.signal), error => error === busyReason);
  const queuedRejected = assert.rejects(encoder.encode(fixture, "png", queued.signal), error => error === queuedReason);
  queued.abort(queuedReason);
  const survivor = encoder.encode(fixture, "webp");
  await Promise.all([busyRejected, queuedRejected]);
  assert.equal((await survivor).type, "image/webp");
  assert.equal(workers.length, 2, "busy encoder termination recreates only the encoder worker");
  assert(workers[0].terminated, "an active synchronous WASM encode is terminated, not merely ignored");
  assert.deepEqual(workers[0].posted, [1, 2], "cancelled queued job is never posted");
  assert.deepEqual(workers[1].posted, [4], "remaining queued work runs in a fresh worker");
  encoder.close();
  assert(workers[1].terminated);
  await assert.rejects(encoder.encode(fixture, "png"), /closed/);
  console.log("Thumbnail encoding: pinned lossless WebP exact RGBA, PNG, intrinsic-limit recovery, active worker cancellation and queue/session reuse passed.");
} finally {
  for (const worker of workers) await worker.native.terminate();
  globalThis.Worker = originalWorker;
  hooks.deregister();
  await rm(scratch, { recursive: true, force: true });
}

function decodePng(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20), chunks = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = view.getUint32(offset), type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    if (type === "IDAT") chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), rgba = new Uint8Array(width * height * 4), stride = width * 4;
  for (let row = 0; row < height; row++) {
    assert.equal(raw[row * (stride + 1)], 0);
    rgba.set(raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1)), row * stride);
  }
  return { width, height, rgba };
}
function decodeWebp(binary, bytes) {
  let exports;
  const instance = new WebAssembly.Instance(new WebAssembly.Module(binary), { a: {
    a() { throw Error("Unexpected timer"); },
    b(requested) { try { exports.f.grow(Math.ceil(((requested >>> 0) - exports.f.buffer.byteLength) / 65536)); return 1; } catch { return 0; } },
    c() { throw Error("Unexpected exit"); }, d() {}, e() { throw Error("Unexpected abort"); }
  } });
  exports = instance.exports;
  exports.g();
  const input = exports.k(bytes.length), dimensions = exports.k(8);
  new Uint8Array(exports.f.buffer).set(bytes, input);
  let output = 0;
  try {
    output = exports.i(input, bytes.length, dimensions, dimensions + 4);
    assert(output);
    const view = new DataView(exports.f.buffer), width = view.getUint32(dimensions, true), height = view.getUint32(dimensions + 4, true);
    return { width, height, rgba: new Uint8Array(exports.f.buffer, output, width * height * 4).slice() };
  } finally { if (output) exports.j(output); exports.l(input); exports.l(dimensions); }
}
