import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const originalWorker = globalThis.Worker, warn = console.warn;
try {
  const { planRasterTiles } = await import("../src/rasterTiles.ts");
  const { buildPreparedRasterPixels, buildPreparedRasterPixelsAsync } = await import("../src/rasterPreparationCore.ts");
  const { RasterResourceCache } = await import("../src/rasterResourceCache.ts");
  const color = (width, height) => ({ width, height,
    data: Uint8Array.from({ length: width * height * 4 }, (_, index) => index * 43 % 256) });
  const binary = (width, height) => ({ width, height,
    monochrome: { data: Uint8Array.from({ length: Math.ceil(width / 8) * height }, (_, i) => i * 37 % 256),
      colors: Uint8Array.of(0, 0, 0, 255, 255, 255, 255, 255) },
    get data() { throw Error("preparation must not materialize packed RGBA"); } });
  for (const source of [color(137, 71), binary(137, 71)]) {
    const canonical = (source.monochrome?.data ?? source.data).slice();
    for (const scale of [1, .37]) {
      const plan = planRasterTiles(source.width, source.height, 31, scale);
      const sync = buildPreparedRasterPixels(source, plan), async = await buildPreparedRasterPixelsAsync(source, plan);
      assert.deepEqual(async, sync, "cooperative and worker algorithms retain exact tile and mip bytes");
    }
    assert.deepEqual(source.monochrome?.data ?? source.data, canonical);
  }
  let ticks = 0;
  const timer = setInterval(() => ticks++, 0);
  const big = binary(1025, 1027);
  await buildPreparedRasterPixelsAsync(big, planRasterTiles(big.width, big.height, 256, .03125));
  clearInterval(timer);
  assert(ticks > 0, "fallback preparation yields even for extreme downscaling");

  // The LRU distinguishes texture formats, placements and monochrome palettes.
  const released = [], cache = new RasterResourceCache(resource => released.push(resource));
  const source = binary(17, 9), plan = planRasterTiles(17, 9, 32), a = {}, b = {}, zero = {};
  cache.remember(a, source, plan); cache.park(a, 100);
  assert(cache.has(source, plan));
  assert(!cache.has(source, plan, "astc-12x12"));
  assert(!cache.has(Object.assign(Object.create(source), { pageIndex: 1 }), plan));
  assert(!cache.has(Object.assign(Object.create(source), { monochrome: { ...source.monochrome,
    colors: new Uint8Array(8) } }), plan));
  assert.equal(cache.take(source, plan), a); assert.equal(cache.bytes, 0);
  cache.park(a, 100);
  const second = color(17, 9);
  cache.remember(b, second, plan); cache.park(b, 100); cache.trim(100);
  assert.deepEqual(released, [a], "oldest warm resource is evicted first");
  cache.remember(zero, color(17, 9), plan); cache.park(zero, 0); cache.clear();
  assert.deepEqual(released, [a, b, zero], "clear releases zero-byte entries too");

  // Browser transport strips lazy getters and retains canonical buffers; its one worker serializes jobs.
  const sends = [], workers = [];
  let pending = 0, maxPending = 0, failNext = false;
  class FakeWorker {
    constructor(url, options) { assert.match(String(url), /rasterPreparationWorker/); assert.equal(options.type, "module"); workers.push(this); }
    postMessage(message, transfers) {
      assert.equal(transfers, undefined, "canonical inputs are copied, never transferred away");
      assert.equal(Object.getOwnPropertyDescriptor(message.source, "data").get, undefined);
      sends.push(message); pending++; maxPending = Math.max(maxPending, pending);
      const cloned = structuredClone(message);
      setTimeout(() => {
        pending--;
        if (failNext) { failNext = false; this.onerror({ message: "synthetic failure" }); }
        else this.onmessage({ data: { result: buildPreparedRasterPixels(cloned.source, cloned.plan) } });
      }, 0);
    }
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = FakeWorker;
  const { prepareRasterPixels, finishRasterUpdateStepsAsync } = await import("../src/rasterPreparation.ts");
  const workerSource = binary(257, 257), workerPlan = planRasterTiles(257, 257, 64, .25);
  const before = workerSource.monochrome.data.slice();
  const results = await Promise.all([prepareRasterPixels(workerSource, workerPlan), prepareRasterPixels(workerSource, workerPlan)]);
  assert.equal(workers.length, 1); assert.equal(maxPending, 1);
  for (const result of results) assert.deepEqual(result, buildPreparedRasterPixels(workerSource, workerPlan));
  assert.deepEqual(workerSource.monochrome.data, before);
  assert.equal(sends[0].source.data.byteLength, 0);
  failNext = true; const warnings = [];
  console.warn = (...args) => warnings.push(args);
  assert.deepEqual(await prepareRasterPixels(workerSource, workerPlan), results[0], "worker errors fall back cooperatively");
  assert(workers[0].terminated); assert.equal(warnings.length, 1);
  const sendCount = sends.length;
  await prepareRasterPixels(workerSource, workerPlan);
  assert.equal(sends.length, sendCount, "a failed worker is not retried for every image");

  let cleanup = false;
  function* aborted() {
    try { yield { source: workerSource, plan: workerPlan, cached: true }; throw new DOMException("superseded", "AbortError"); }
    finally { cleanup = true; }
  }
  await assert.rejects(finishRasterUpdateStepsAsync(aborted(), () => {}), error => error.name === "AbortError");
  assert(cleanup); assert.equal(sends.length, sendCount, "cache hits avoid pixel preparation");
  console.log("Raster preparation: exact bytes, cooperative yielding, packed transport, serialized worker fallback, cache bounds and cancellation passed.");
} finally { globalThis.Worker = originalWorker; console.warn = warn; hooks.deregister(); }
