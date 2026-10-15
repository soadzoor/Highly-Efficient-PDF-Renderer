import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const scratch = await mkdtemp(join(tmpdir(), "hepr-node-thumbnail-encoder-")), encoders = [];
try {
  const { NodeThumbnailEncoder, resolveNodeThumbnailEncoderWorkerUrl } = await import("../src/nodeThumbnailEncoder.ts");
  const { encodeThumbnailPixelsDirect } = await import("../src/thumbnailEncodingCore.ts");
  const fixture = { width: 2, height: 2, rgba: Uint8Array.of(20, 100, 200, 0, 70, 30, 210, 1, 250, 255, 190, 128, 25, 150, 40, 255) };
  const before = fixture.rgba.slice(), encoder = createEncoder();
  assert.equal(resolveNodeThumbnailEncoderWorkerUrl().protocol, "data:", "direct source use boots the local TypeScript worker with an extension resolver");
  await encoder.warm("webp");
  const warmedWorker = encoder.worker.worker, afterWarmId = encoder.nextId;
  await encoder.warm("webp");
  assert.equal(encoder.nextId, afterWarmId, "an already warmed codec does no extra pixel encoding");
  for (const format of ["webp", "png"]) {
    const result = await encoder.encode(fixture, format);
    assert.equal(result.type, `image/${format}`);
    assert.deepEqual(new Uint8Array(await result.arrayBuffer()),
      new Uint8Array(await (await encodeThumbnailPixelsDirect(fixture, format)).arrayBuffer()),
      "the Node worker uses the same exact pixel encoder as browser workers");
  }
  assert.deepEqual(fixture.rgba, before, "caller pixels remain attached and unchanged");
  assert.equal(encoder.worker.worker, warmedWorker, "real output reuses the prewarmed thread and compiled codec");
  const reusedWorker = encoder.worker.worker;
  const pooled = { width: 1, height: 1, rgba: Buffer.from([1, 10, 100, 255]) }, pooledBefore = Buffer.from(pooled.rgba);
  await encoder.encode(pooled, "webp");
  assert.deepEqual(pooled.rgba, pooledBefore, "Node Buffer inputs remain caller-owned");
  assert.equal(encoder.worker.worker, reusedWorker, "completed calls reuse one thread and its compiled codec");
  const diagnostics = [];
  const wide = { width: 16384, height: 1, rgba: new Uint8Array(16384 * 4) };
  assert.equal((await encoder.encode(wide, "webp", undefined, diagnostic => diagnostics.push(diagnostic))).type, "image/png");
  assert.equal(diagnostics[0].code, "thumbnail.webp-png-fallback", "worker transports diagnosed intrinsic-format fallback");
  await encoder.close();
  assert.equal(reusedWorker.threadId, -1, "close waits for actual thread termination");
  await encoder.close();
  await assert.rejects(encoder.encode(fixture, "png"), /closed/);

  const startup = createEncoder(), startupAbort = new AbortController(), startupReason = Error("cancelled before worker startup");
  const startupRejected = assert.rejects(startup.encode(fixture, "webp", startupAbort.signal), error => error === startupReason);
  startupAbort.abort(startupReason);
  await startupRejected;
  await startup.close();
  assert.equal(startup.worker, undefined);
  const invalid = createEncoder(), preAborted = new AbortController(); preAborted.abort(startupReason);
  await assert.rejects(invalid.encode(fixture, "webp", preAborted.signal), error => error === startupReason);
  await assert.rejects(invalid.encode({ ...fixture, rgba: new Uint8Array(1) }, "png"), RangeError);
  await assert.rejects(invalid.warm("webp", preAborted.signal), error => error === startupReason);
  assert.equal(invalid.worker, undefined, "invalid and pre-aborted calls never create a thread");

  const workerEntry = new URL("../src/nodeThumbnailEncodeWorker.ts", import.meta.url).href;
  const bootstrap = `import { parentPort } from "node:worker_threads";
import { registerHooks } from "node:module";
registerHooks({ resolve(s,c,n) { return n(c.parentURL?.includes("/src/") && /^\\.\\.?\\//.test(s) && !/\\.[a-z0-9]+(?:[?#]|$)/i.test(s) ? s+".ts" : s,c); } });
const instantiate = WebAssembly.instantiate.bind(WebAssembly);
WebAssembly.instantiate = async (...args) => {
  const instance = await instantiate(...args);
  if (!instance.exports?.h) return instance;
  return { exports: { ...instance.exports, h(...callArgs) {
    parentPort.postMessage({ id: -1, encodingStarted: true });
    return instance.exports.h(...callArgs);
  } } };
};
parentPort.on("message", request => { if (request.pixels.width === 9) throw Error("synthetic encoder worker crash"); });
await import(${JSON.stringify(workerEntry)});
`;
  const workerUrl = pathToFileURL(join(scratch, "instrumented-worker.mjs"));
  await writeFile(workerUrl, bootstrap);
  const warming = createEncoder({ workerUrl }), warmAbort = new AbortController();
  const warmRejected = assert.rejects(warming.warm("webp", warmAbort.signal), error => error === startupReason);
  // Cancellation during a codec's native entry must also discard the warm
  // worker, even though no application pixels have reached it yet.
  await new Promise(resolve => {
    const inspect = () => {
      if (!warming.worker) { setImmediate(inspect); return; }
      warming.worker.worker.on("message", message => {
        if (message.encodingStarted) { warmAbort.abort(startupReason); resolve(); }
      });
    };
    inspect();
  });
  await warmRejected;
  assert.equal((await warming.encode(fixture, "webp")).type, "image/webp", "cancelled warm work recreates an independent encoder thread");
  await warming.close();
  const cancellable = createEncoder({ workerUrl });
  await cancellable.encode(fixture, "webp");
  const firstWorker = cancellable.worker.worker;
  const busy = new AbortController(), queued = new AbortController();
  const busyReason = Error("PDF replaced during Node WASM encode"), queuedReason = Error("queued preview removed");
  const large = { width: 2048, height: 2048, rgba: new Uint8Array(2048 * 2048 * 4) };
  let state = 7;
  for (let index = 0; index < large.rgba.length; index++) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; large.rgba[index] = state >>> 24; }
  firstWorker.on("message", message => { if (message.encodingStarted) busy.abort(busyReason); });
  const busyRejected = assert.rejects(cancellable.encode(large, "webp", busy.signal), error => error === busyReason);
  const queuedRejected = assert.rejects(cancellable.encode(fixture, "png", queued.signal), error => error === queuedReason);
  queued.abort(queuedReason);
  const survivor = cancellable.encode(fixture, "webp");
  await Promise.all([busyRejected, queuedRejected]);
  assert.equal((await survivor).type, "image/webp");
  assert.notEqual(cancellable.worker.worker, firstWorker, "busy encode cancellation replaces only its encoder thread");
  await cancellable.close();
  assert.equal(firstWorker.threadId, -1, "synchronous WASM encoding is actually stopped, rather than merely ignored");

  const closing = createEncoder({ workerUrl });
  await closing.encode(fixture, "webp");
  const closingWorker = closing.worker.worker;
  let markClose, closePromise;
  const closeStarted = new Promise(resolve => { markClose = resolve; });
  closingWorker.on("message", message => {
    if (message.encodingStarted) { closePromise = closing.close(); markClose(); }
  });
  const closeRejected = assert.rejects(closing.encode(large, "webp"), error => error.name === "AbortError");
  await closeStarted; await closePromise; await closeRejected;
  assert.equal(closingWorker.threadId, -1, "close terminates a busy native encode and waits for release");

  const recovering = createEncoder({ workerUrl });
  await assert.rejects(recovering.encode({ width: 9, height: 1, rgba: new Uint8Array(9 * 4) }, "webp"), /synthetic encoder worker crash/);
  assert.equal((await recovering.encode(fixture, "webp")).type, "image/webp", "a crashed thread does not poison the encoder session");
  await recovering.close();
  console.log("Node thumbnail encoder: real worker WebP/PNG parity, reuse, Buffer ownership, diagnosed fallback, startup/queued/busy cancellation, busy close and crash recovery passed.");

  function createEncoder(options) { const value = new NodeThumbnailEncoder(options); encoders.push(value); return value; }
} finally {
  await Promise.all(encoders.map(encoder => encoder.close()));
  hooks.deregister();
  await rm(scratch, { recursive: true, force: true });
}
