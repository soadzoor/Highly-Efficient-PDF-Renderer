import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const originalWorker = globalThis.Worker, warn = console.warn;
const originalOnmessage = Object.getOwnPropertyDescriptor(globalThis, "onmessage");
const originalPostMessage = Object.getOwnPropertyDescriptor(globalThis, "postMessage");
try {
  const { planRasterTiles } = await import("../src/rasterTiles.ts");
  const { buildPreparedRasterPixels, buildPreparedRasterPixelsAsync } = await import("../src/rasterPreparationCore.ts");
  const { RasterResourceCache } = await import("../src/rasterResourceCache.ts");
  // Exercise the actual worker module through browser globals, without a browser or server.
  await import("../src/rasterPreparationWorker.ts");
  const workerMessage = globalThis.onmessage;
  if (originalOnmessage) Object.defineProperty(globalThis, "onmessage", originalOnmessage); else delete globalThis.onmessage;
  const color = (width, height) => ({ width, height,
    data: Uint8Array.from({ length: width * height * 4 }, (_, index) => index * 43 % 256) });
  const binary = (width, height) => ({ width, height,
    monochrome: { data: Uint8Array.from({ length: Math.ceil(width / 8) * height }, (_, i) => i * 37 % 256),
      colors: Uint8Array.of(0, 0, 0, 255, 255, 255, 255, 255) },
    get data() { throw Error("preparation must not materialize packed RGBA"); } });
  for (const source of [color(137, 71), binary(137, 71)]) {
    const canonical = (source.monochrome?.data ?? source.data).slice();
    for (const maxTextureSize of [256, 31]) {
      const plan = planRasterTiles(source.width, source.height, maxTextureSize);
      const sync = buildPreparedRasterPixels(source, plan), async = await buildPreparedRasterPixelsAsync(source, plan);
      assert.deepEqual(async, sync, "cooperative and worker algorithms retain exact tile and mip bytes");
    }
    assert.deepEqual(source.monochrome?.data ?? source.data, canonical);
  }
  {
    const performanceDescriptor = Object.getOwnPropertyDescriptor(globalThis, "performance");
    let clockCalls = 0, ticked = false;
    const timer = setTimeout(() => { ticked = true; }, 0);
    try {
      // Exhaust the first time slice regardless of machine speed, then hold the clock steady.
      Object.defineProperty(globalThis, "performance", { configurable: true,
        value: { now: () => clockCalls++ === 0 ? 0 : 5 } });
      const big = binary(1025, 1027), plan = planRasterTiles(big.width, big.height, 32);
      assert.deepEqual(await buildPreparedRasterPixelsAsync(big, plan), buildPreparedRasterPixels(big, plan));
      assert(ticked, "fallback preparation yields even for extreme downscaling");
    } finally {
      clearTimeout(timer);
      if (performanceDescriptor) Object.defineProperty(globalThis, "performance", performanceDescriptor);
      else delete globalThis.performance;
    }
  }

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
        else {
          globalThis.postMessage = (response, transfers) => {
            for (const bits of response.result?.monochromeTiles ?? []) assert.equal(bits.symbols, undefined,
              "the worker returns ready texture data without retaining JBIG2 dictionaries");
            const symbols = cloned.source.monochrome?.symbols;
            if (symbols) {
              assert(!transfers.includes(symbols.placements.buffer), "placements are not sent back after encoding");
              for (const symbol of symbols.symbols) assert(!transfers.includes(symbol.data.buffer),
                "symbol bitmaps are not sent back after encoding");
            }
            this.onmessage({ data: structuredClone(response, { transfer: transfers }) });
          };
          try { workerMessage({ data: cloned }); }
          finally {
            if (originalPostMessage) Object.defineProperty(globalThis, "postMessage", originalPostMessage); else delete globalThis.postMessage;
          }
        }
      }, 0);
    }
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = FakeWorker;
  const { prepareRasterPixels, finishRasterUpdateStepsAsync } = await import("../src/rasterPreparation.ts");
  const workerSource = binary(512, 256), workerPlan = planRasterTiles(512, 256, 64);
  const glyph = { width: 9, height: 7, data: Uint8Array.from({ length: 14 }, (_, i) => i & 1 ? 128 : 0xaa) };
  const symbols = { symbols: [glyph], placements: Int32Array.of(29, 28, 0, 137, 74, 0, 253, 134, 0, 400, 219, 0) };
  workerSource.monochrome.symbols = symbols;
  workerSource.monochrome.data.fill(255);
  for (let i = 0; i < symbols.placements.length; i += 3) {
    const x = symbols.placements[i], y = symbols.placements[i + 1];
    for (let sy = 0; sy < glyph.height; sy++) for (let sx = 0; sx < glyph.width; sx++) {
      if (glyph.data[sy * 2 + (sx >> 3)] & (128 >> (sx & 7)))
        workerSource.monochrome.data[(y + sy) * 64 + ((x + sx) >> 3)] &= ~(128 >> ((x + sx) & 7));
    }
  }
  const before = workerSource.monochrome.data.slice();
  const symbolsBefore = structuredClone(symbols), colorsBefore = workerSource.monochrome.colors.slice();
  const results = await Promise.all([prepareRasterPixels(workerSource, workerPlan), prepareRasterPixels(workerSource, workerPlan)]);
  assert.equal(workers.length, 1); assert.equal(maxPending, 1);
  for (const result of results) assert.deepEqual(result, buildPreparedRasterPixels(workerSource, workerPlan));
  assert.deepEqual(workerSource.monochrome.data, before);
  assert.equal(sends[0].source.data.byteLength, 0);
  assert.equal(sends[0].source.monochrome.symbols, undefined, "reduced coverage never clones unused symbol dictionaries");
  assert.equal(sends[0].source.monochrome.data, workerSource.monochrome.data, "packed input remains canonical until structured cloning");
  assert.equal(sends[0].source.monochrome.colors, workerSource.monochrome.colors);
  const fullPlan = planRasterTiles(workerSource.width, workerSource.height, 8192);
  const fullExpected = buildPreparedRasterPixels(workerSource, fullPlan);
  assert(fullExpected.compactAtlases[0].symbolBlocks > 0, "the full-detail fixture uses its symbol dictionary during encoding");
  fullExpected.monochromeTiles = fullExpected.monochromeTiles.map(bits => ({ data: bits.data, colors: bits.colors }));
  assert.deepEqual(await prepareRasterPixels(workerSource, fullPlan), fullExpected,
    "full detail retains exact packed pixels, palettes and compact output after dropping transport-only dictionaries");
  assert.equal(sends.at(-1).source.monochrome.symbols, symbols, "full detail still gives the encoder its symbol dictionary");
  assert.deepEqual(workerSource.monochrome.data, before, "transferred result buffers do not detach packed source pixels");
  assert.deepEqual(workerSource.monochrome.colors, colorsBefore);
  assert.deepEqual(symbols, symbolsBefore, "symbol placements and dictionaries remain owned by the canonical document");
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
} finally {
  globalThis.Worker = originalWorker; console.warn = warn;
  if (originalOnmessage) Object.defineProperty(globalThis, "onmessage", originalOnmessage); else delete globalThis.onmessage;
  if (originalPostMessage) Object.defineProperty(globalThis, "postMessage", originalPostMessage); else delete globalThis.postMessage;
  hooks.deregister();
}
