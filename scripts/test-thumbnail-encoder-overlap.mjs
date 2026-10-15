import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const sessions = [];
try {
  const { ProcessingSession } = await import("../src/documentSessionRuntime.ts");
  const options = { maxDimension: 8 };
  const started = deferred(), render = deferred(), warmed = deferred();
  const overlap = harness({
    async render() { await render.promise; },
    async warm(format, signal) { assert.equal(format, "webp"); started.resolve(); await cancellable(warmed.promise, signal); }
  });
  const result = overlap.session.renderThumbnail(options);
  await started.promise;
  assert.equal(overlap.rendered, 1, "PDF preparation and worker warming start before either has completed");
  assert.equal(overlap.encoded, 0);
  warmed.resolve(); render.resolve();
  await result;
  assert.equal(overlap.factories, 1, "warming and real encoding share one lazy owner");
  await overlap.session.renderThumbnail(options);
  assert.equal(overlap.warms, 1, "identical completed thumbnails do no additional startup work");

  const browserRender = deferred(), browser = harness({ prewarm: false, async render() { await browserRender.promise; } });
  const browserResult = browser.session.renderThumbnail(options);
  await browser.renderStarted.promise;
  assert.equal(browser.factories, 0, "the browser path leaves encoding lazy until pixels are ready");
  browserRender.resolve(); await browserResult;
  assert.equal(browser.warms, 0);

  const prepareError = Error("synthetic preparation failure"), failureWarm = deferred();
  const failed = harness({
    async render() { await failureWarm.promise; throw prepareError; },
    async warm(_format, signal) { failureWarm.resolve(); await untilAborted(signal); }
  });
  await assert.rejects(failed.session.renderThumbnail(options), error => error === prepareError);
  assert.equal(failed.warmAborts, 1, "failed preparation cancels pending codec startup");
  assert.equal(failed.encoded, 0);
  await failed.session.close(); assert.equal(failed.closes, 1);

  const abortStarted = deferred(), cancelled = harness({
    async render(signal) { await untilAborted(signal); },
    async warm(_format, signal) { abortStarted.resolve(); await untilAborted(signal); }
  });
  const controller = new AbortController(), reason = Error("PDF replaced");
  const cancelledResult = assert.rejects(cancelled.session.renderThumbnail({ ...options, signal: controller.signal }), error => error === reason);
  await abortStarted.promise; controller.abort(reason); await cancelledResult;
  await cancelled.session.close();
  assert.equal(cancelled.warmAborts, 1, "request cancellation stops its warm worker work");
  assert.equal(cancelled.closes, 1); assert.equal(cancelled.terminations, 1);

  const factoryStarted = deferred(), factory = deferred();
  const late = harness({
    async factory() { factoryStarted.resolve(); await factory.promise; },
    async render(signal) { await untilAborted(signal); }
  });
  const lateResult = assert.rejects(late.session.renderThumbnail(options), error => error.name === "AbortError");
  await factoryStarted.promise;
  let closed = false;
  const closing = late.session.close().then(() => { closed = true; });
  await lateResult;
  assert.equal(closed, false, "close waits for a lazy encoder that is still being created");
  factory.resolve(); await closing;
  assert.equal(late.warms, 0, "a late-created encoder never starts a worker after close");
  assert.equal(late.closes, 1, "close releases the encoder created during cancellation exactly once");

  const warmError = Error("optional warm failed"), warmFailed = harness({ async warm() { throw warmError; } });
  assert.equal((await warmFailed.session.renderThumbnail(options)).blob.type, "image/webp",
    "opportunistic warming cannot replace normal encode behavior or fallback diagnostics");
  assert.equal(warmFailed.factories, 1);
  const encodeError = Error("real encoding failed"), encodeFailed = harness({
    async warm() { throw warmError; }, async encode() { throw encodeError; }
  });
  await assert.rejects(encodeFailed.session.renderThumbnail(options), error => error === encodeError);
  const retry = harness({ async factory(attempt) { if (attempt === 1) throw warmError; } });
  await retry.session.renderThumbnail(options);
  assert.equal(retry.factories, 2, "a failed opportunistic factory is retried by the real encoding path");
  console.log("Thumbnail encoder overlap: parallel startup, cache/browser laziness, shared creation, failure/cancellation cleanup and late close ownership passed.");

  function harness(configuration = {}) {
    const state = { factories: 0, warms: 0, warmAborts: 0, rendered: 0, encoded: 0, closes: 0, terminations: 0,
      renderStarted: deferred() };
    const encoder = {
      async warm(format, signal) {
        state.warms++;
        signal.addEventListener("abort", () => { state.warmAborts++; }, { once: true });
        await configuration.warm?.(format, signal);
      },
      async encode(pixels, format, signal) {
        state.encoded++; signal.throwIfAborted(); await configuration.encode?.();
        return new Blob([pixels.rgba], { type: `image/${format}` });
      },
      async close() { state.closes++; }
    };
    const pdf = {
      info: { pages: [{ width: 8, height: 4 }] },
      async renderThumbnailPage(_page, { signal }) {
        state.rendered++; state.renderStarted.resolve();
        await configuration.render?.(signal); signal.throwIfAborted();
        return { width: 8, height: 4, rgba: new Uint8Array(8 * 4 * 4) };
      },
      async terminate() { state.terminations++; }
    };
    state.session = new ProcessingSession("pdf", 1, "synthetic.pdf", {}, [], pdf, undefined, {
      prewarmEncoder: configuration.prewarm !== false,
      async createEncoder() { state.factories++; await configuration.factory?.(state.factories); return encoder; }
    });
    sessions.push(state.session); return state;
  }
} finally { await Promise.all(sessions.map(session => session.close())); hooks.deregister(); }

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function untilAborted(signal) { return cancellable(new Promise(() => {}), signal); }
function cancellable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
  });
}
