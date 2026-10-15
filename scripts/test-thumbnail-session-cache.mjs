import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const sessions = [];
try {
  const { ProcessingSession } = await import("../src/documentSessionRuntime.ts");
  const base = { maxDimension: 8, background: "white", format: "webp" };

  const basic = harness();
  const firstTimings = [], cachedTimings = [];
  const first = await basic.session.renderThumbnail({ ...base, onTiming: value => firstTimings.push(value) });
  const blob = first.blob;
  first.width = 999; first.height = 999; first.blob = new Blob(["caller replacement"]);
  const cached = await basic.session.renderThumbnail({ ...base, background: "#ffffff", onTiming: value => cachedTimings.push(value) });
  assert.equal(cached.blob, blob, "equivalent normalized colors return the completed immutable Blob");
  assert.deepEqual([cached.width, cached.height], [8, 4], "caller changes to a returned wrapper never alter cached dimensions");
  assert.equal(basic.rendered.length, 1); assert.equal(basic.encoded.length, 1); assert.equal(basic.factories, 1);
  assert(firstTimings.some(value => value.stage === "prepare-render") && firstTimings.some(value => value.stage === "encode"));
  assert.deepEqual(cachedTimings.map(value => value.stage), ["total"], "cache hits report actual total only, never old draw/encoding durations");
  assert(cachedTimings[0].durationMs >= 0);
  await basic.session.renderThumbnail({ ...base, background: "transparent" });
  assert.equal(basic.rendered.at(-1).background[3], 0, "transparent and white requests have distinct cache keys");
  const transparentCalls = basic.rendered.length;
  await basic.session.renderThumbnail({ ...base, background: "transparent" });
  assert.equal(basic.rendered.length, transparentCalls);
  await basic.session.renderThumbnail({ ...base, background: "transparent", format: "png" });
  assert.equal(basic.encoded.at(-1).format, "png", "requested image format remains part of the key");
  await basic.session.renderThumbnail({ ...base, page: 2 });
  assert.equal(basic.rendered.at(-1).page, 1, "page selection remains part of the key");
  const beforeSize = basic.rendered.length;
  await basic.session.renderThumbnail({ ...base, page: 2, maxDimension: 9 });
  assert.equal(basic.rendered.length, beforeSize + 1, "output dimensions remain part of the key");
  await basic.session.renderThumbnail(base);
  assert.equal(basic.rendered.length, beforeSize + 2, "only the last completed result is retained, not an unbounded page/size cache");
  const backend = harness({ canvas2dOnly: true });
  await backend.session.renderThumbnail(base);
  await backend.session.renderThumbnail({ ...base, backend: "canvas2d" });
  assert.equal(backend.rendered.length, 2, "requested backend variants remain distinct even when Node auto routes to Canvas2D");
  await assert.rejects(backend.session.renderThumbnail({ ...base, backend: "webgl" }), /Node thumbnails/);

  const queued = harness();
  const [queuedFirst, queuedSecond] = await Promise.all([queued.session.renderThumbnail(base), queued.session.renderThumbnail(base)]);
  assert.equal(queuedFirst.blob, queuedSecond.blob);
  assert.equal(queued.rendered.length, 1, "serialized identical requests share the first completed result");
  const preAborted = new AbortController(), reason = Error("preview removed"); preAborted.abort(reason);
  await assert.rejects(queued.session.renderThumbnail({ ...base, signal: preAborted.signal }), error => error === reason);
  const hitAbort = new AbortController();
  await assert.rejects(queued.session.renderThumbnail({ ...base, signal: hitAbort.signal,
    onTiming() { hitAbort.abort(reason); } }), error => error === reason);
  assert.equal((await queued.session.renderThumbnail(base)).blob, queuedFirst.blob, "cancelled cache hits preserve the earlier valid result");

  const late = harness();
  const earlier = await late.session.renderThumbnail(base);
  const lateAbort = new AbortController();
  await assert.rejects(late.session.renderThumbnail({ ...base, maxDimension: 9, signal: lateAbort.signal,
    onTiming(value) { if (value.stage === "total") queueMicrotask(() => lateAbort.abort(reason)); } }), error => error === reason);
  const lateCalls = late.rendered.length;
  assert.equal((await late.session.renderThumbnail(base)).blob, earlier.blob);
  assert.equal(late.rendered.length, lateCalls, "a late aborted miss restores the previous completed result");
  await late.session.renderThumbnail({ ...base, maxDimension: 9 });
  assert.equal(late.rendered.length, lateCalls + 1, "late aborted results are not cached");

  for (const abortDepth of [1, 3]) {
    const lateQueued = harness();
    await lateQueued.session.renderThumbnail(base);
    const queuedAbort = new AbortController();
    const abandoned = lateQueued.session.renderThumbnail({ ...base, maxDimension: 9, signal: queuedAbort.signal,
      onTiming(value) {
        if (value.stage !== "total") return;
        let remaining = abortDepth;
        const abort = () => { if (--remaining) queueMicrotask(abort); else queuedAbort.abort(reason); };
        queueMicrotask(abort);
      } });
    const follower = lateQueued.session.renderThumbnail({ ...base, maxDimension: 9 });
    await assert.rejects(abandoned, error => error === reason);
    const followerResult = await follower;
    assert.equal(lateQueued.rendered.length, 3, "a queued follower prepares independently after the preceding identical request aborts late");
    assert.equal(lateQueued.encoded.length, 3, "a queued follower never returns a late-aborted request's encoded Blob");
    assert.equal((await lateQueued.session.renderThumbnail({ ...base, maxDimension: 9 })).blob, followerResult.blob,
      "only the independently completed follower becomes reusable");
  }

  const failures = harness();
  const successful = await failures.session.renderThumbnail(base);
  const compileError = Error("synthetic preparation failure"); failures.nextRenderError = compileError;
  await assert.rejects(failures.session.renderThumbnail({ ...base, maxDimension: 9 }), error => error === compileError);
  let attempts = failures.rendered.length;
  assert.equal((await failures.session.renderThumbnail(base)).blob, successful.blob);
  assert.equal(failures.rendered.length, attempts, "failed preparation preserves the last successful entry");
  const encodeError = Error("synthetic encoding failure"); failures.nextEncodeError = encodeError;
  await assert.rejects(failures.session.renderThumbnail({ ...base, maxDimension: 9 }), error => error === encodeError);
  attempts = failures.rendered.length;
  assert.equal((await failures.session.renderThumbnail(base)).blob, successful.blob);
  assert.equal(failures.rendered.length, attempts, "failed encoding preserves the last successful entry");
  const observerError = Error("timing observer failed");
  await assert.rejects(failures.session.renderThumbnail({ ...base, maxDimension: 9,
    onTiming(value) { if (value.stage === "total") throw observerError; } }), error => error === observerError);
  attempts = failures.rendered.length;
  await failures.session.renderThumbnail({ ...base, maxDimension: 9 });
  assert.equal(failures.rendered.length, attempts + 1, "a failed observer does not publish a cache entry");

  const diagnostics = harness({ diagnostics: true });
  const initial = [], replayed = [];
  const diagnosed = await diagnostics.session.renderThumbnail({ ...base, onDiagnostic: value => initial.push(value) });
  const documentDiagnostics = diagnostics.session.getDiagnostics().length;
  const openNotifications = diagnostics.openNotifications.length;
  await diagnostics.session.renderThumbnail({ ...base, onDiagnostic(value) { value.details.tag = "caller changed"; replayed.push(value); } });
  assert.equal(replayed[0].code, initial[0].code);
  const secondReplay = [];
  await diagnostics.session.renderThumbnail({ ...base, onDiagnostic: value => secondReplay.push(value) });
  assert.equal(secondReplay[0].details.tag, "overview approximation", "replayed diagnostics cannot mutate the cached snapshot");
  assert.equal(diagnostics.session.getDiagnostics().length, documentDiagnostics, "cache replay does not append duplicate document diagnostics");
  assert.equal(diagnostics.openNotifications.length, openNotifications, "cache replay does not repeat the session opening observer");
  const sharedObserver = harness({ diagnostics: true });
  await sharedObserver.session.renderThumbnail({ ...base, onDiagnostic: sharedObserver.onDiagnostic });
  assert.equal(sharedObserver.openNotifications.length, 1, "a shared opening/per-call observer receives each new diagnostic once");
  await sharedObserver.session.renderThumbnail({ ...base, onDiagnostic: sharedObserver.onDiagnostic });
  assert.equal(sharedObserver.openNotifications.length, 1, "a cache hit does not replay a diagnostic to the shared document observer");
  const diagnosticError = Error("diagnostic observer failed");
  await assert.rejects(diagnostics.session.renderThumbnail({ ...base, maxDimension: 9, onDiagnostic() { throw diagnosticError; } }), error => error === diagnosticError);
  attempts = diagnostics.rendered.length;
  assert.equal((await diagnostics.session.renderThumbnail(base)).blob, diagnosed.blob);
  assert.equal(diagnostics.rendered.length, attempts, "a failed diagnostic observer preserves the previous completed thumbnail");

  const fallback = harness({ pngFallback: true });
  const fallbackFirst = await fallback.session.renderThumbnail(base);
  assert.equal(fallbackFirst.blob.type, "image/png");
  const fallbackDiagnostics = [];
  assert.equal((await fallback.session.renderThumbnail({ ...base, onDiagnostic: value => fallbackDiagnostics.push(value) })).blob, fallbackFirst.blob);
  assert.equal(fallbackDiagnostics[0].code, "thumbnail.webp-png-fallback", "cached format fallback remains diagnosed");
  await fallback.session.renderThumbnail({ ...base, format: "png" });
  assert.equal(fallback.encoded.length, 2, "requested PNG is distinct from WebP that returned compatibility PNG");

  await basic.session.close();
  assert.equal(basic.session.completedThumbnail, undefined, "close drops the retained Blob owner");
  assert.equal(basic.closes, 1); assert.equal(basic.terminations, 1);
  await assert.rejects(basic.session.renderThumbnail(base), error => error.code === "closed");
  console.log("Thumbnail session cache: immutable last result, normalized appearance/page/format/backend keys, queued reuse, honest timings, cancellation/failure isolation, diagnostic replay and close cleanup passed.");

  function harness(configuration = {}) {
    const state = { rendered: [], encoded: [], factories: 0, closes: 0, terminations: 0,
      openNotifications: [], nextRenderError: undefined, nextEncodeError: undefined };
    const documentDiagnostics = [], onDiagnostic = diagnostic => state.openNotifications.push(diagnostic);
    state.onDiagnostic = onDiagnostic;
    const pdf = {
      info: { pages: [{ width: 200, height: 100 }, { width: 100, height: 200 }] },
      async renderThumbnailPage(page, options) {
        state.rendered.push({ page, ...options }); options.signal.throwIfAborted();
        if (state.nextRenderError) { const error = state.nextRenderError; state.nextRenderError = undefined; throw error; }
        if (configuration.diagnostics) {
          const diagnostic = { code: "thumbnail.text-approximation", severity: "info", message: "Synthetic overview approximation.",
            pageIndex: page, details: { tag: "overview approximation" } };
          documentDiagnostics.push(diagnostic); onDiagnostic(diagnostic);
        }
        const width = page === 0 ? options.maxDimension : Math.max(1, Math.round(options.maxDimension / 2));
        const height = page === 0 ? Math.max(1, Math.round(options.maxDimension / 2)) : options.maxDimension;
        return { width, height, rgba: new Uint8Array(width * height * 4) };
      },
      async terminate() { state.terminations++; },
      async close() { state.terminations++; }
    };
    const session = new ProcessingSession("pdf", 1, "synthetic.pdf", { onDiagnostic }, documentDiagnostics, pdf, undefined, {
      canvas2dOnly: configuration.canvas2dOnly,
      async createEncoder() {
        state.factories++;
        return {
          async encode(pixels, format, signal, emitDiagnostic) {
            state.encoded.push({ pixels, format }); signal.throwIfAborted();
            if (state.nextEncodeError) { const error = state.nextEncodeError; state.nextEncodeError = undefined; throw error; }
            if (configuration.pngFallback && format === "webp") emitDiagnostic({ code: "thumbnail.webp-png-fallback", severity: "warning", message: "Synthetic PNG fallback." });
            return new Blob([String(state.encoded.length)], { type: `image/${configuration.pngFallback ? "png" : format}` });
          },
          async close() { state.closes++; }
        };
      }
    });
    sessions.push(session); state.session = session; return state;
  }
} finally { await Promise.all(sessions.map(session => session.close())); hooks.deregister(); }
