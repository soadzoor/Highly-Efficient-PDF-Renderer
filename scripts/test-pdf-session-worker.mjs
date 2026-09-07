import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const [
    { openPdfWithWorkerEndpoint },
    { attachPdfWorkerRuntime },
    {
      PDF_WORKER_PROTOCOL_VERSION,
      collectPdfTransferables,
      deserializePdfError,
      serializePdfError
    },
    { PdfError }
  ] = await Promise.all([
    import("../src/pdf/workerClient.ts"),
    import("../src/pdf/workerRuntime.ts"),
    import("../src/pdf/workerProtocol.ts"),
    import("../src/pdf/nativeTypes.ts")
  ]);

  const fixture = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 2 /Kids [3 0 R 5 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R >>"
      },
      { number: 4, body: tinyPdfStream("", "1 0 0 rg 10 5 20 10 re f\n") },
      {
        number: 5,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 200] /Contents 6 0 R >>"
      },
      { number: 6, body: tinyPdfStream("", "0 0 0 RG 10 20 m 80 20 l S\n") }
    ]
  });

  assertRecursiveVectorTransferCollection(collectPdfTransferables);

  const [hostEndpoint, workerEndpoint] = linkedCloneEndpoints();
  let vectorTransferChecked = false;
  let vectorRequestOptions = null;
  hostEndpoint.onPost = (message) => {
    if (message.type === "hepr-pdf-request" && message.operation === "compile-vector-page") {
      vectorRequestOptions = message.options;
    }
  };
  workerEndpoint.onPost = (message, transfer = []) => {
    if (
      message.type !== "hepr-pdf-result" || !message.ok ||
      message.operation !== "compile-vector-page"
    ) return;
    const expected = collectPdfTransferables(message.scene);
    const actual = new Set(transfer);
    assert.equal(actual.size, expected.length,
      "the vector-page response must not repeat scene buffers");
    assert.ok(expected.every((buffer) => actual.has(buffer)),
      "the vector-page response must transfer every recursive scene buffer");
    vectorTransferChecked = true;
  };
  const runtime = attachPdfWorkerRuntime(workerEndpoint);
  let terminationCount = 0;
  let rangeCloseCount = 0;
  const rangeReads = [];
  const session = await openPdfWithWorkerEndpoint({
    kind: "range",
    byteLength: fixture.length,
    label: "worker-fixture.pdf",
    async read(offset, length, signal) {
      signal.throwIfAborted();
      rangeReads.push([offset, length]);
      return fixture.slice(offset, offset + length);
    },
    close() {
      rangeCloseCount += 1;
    }
  }, {}, hostEndpoint, {
    onCrash: () => () => undefined,
    terminate() {
      terminationCount += 1;
    }
  });

  assert.equal(session.info.pageCount, 2);
  assert.ok(rangeReads.length > 0);
  const [first, second] = await Promise.all([
    session.compilePage(0),
    session.compilePage(1)
  ]);
  assert.equal(first.pageInfo.sourcePageIndex, 0);
  assert.equal(second.pageInfo.sourcePageIndex, 1);
  assert.ok(first.stores.paths.fillPathMetaA.byteLength > 0);
  assert.ok(second.stores.strokes.endpoints.byteLength > 0);

  const vectorPage = await session.compileVectorPage(0, {
    optimization: "none",
    enableSegmentMerge: false,
    enableInvisibleCull: true
  });
  assert.equal(vectorPage.pageCount, 1);
  assert.equal(vectorPage.fillPathCount, 1);
  assert.ok(vectorPage.fillSegmentsA.byteLength > 0);
  assert.equal(vectorTransferChecked, true);
  assert.deepEqual(vectorRequestOptions, {
    limits: undefined,
    optimization: "none",
    enableSegmentMerge: false,
    enableInvisibleCull: true
  });

  const callerOrderedPages = [];
  for await (const orderedPage of session.compilePages({ sourcePageIndexes: [1, 0] })) {
    callerOrderedPages.push(orderedPage.pageInfo.sourcePageIndex);
  }
  assert.deepEqual(callerOrderedPages, [1, 0]);
  assert.throws(
    () => session.compilePages({ sourcePageIndexes: [0, 0] }),
    (error) => error?.code === "invalid-page-index" && error?.details?.duplicate === true
  );

  const iterator = session.compilePages({ sourcePageIndexes: [1, 0] })[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value.pageInfo.sourcePageIndex, 1);
  await iterator.return();
  assert.equal((await session.compilePage(0)).pageInfo.sourcePageIndex, 0);

  await session.close();
  await session.close();
  assert.equal(rangeCloseCount, 1);
  assert.equal(terminationCount, 1);
  await runtime.close();

  await testWorkerSourceVariants(
    openPdfWithWorkerEndpoint,
    attachPdfWorkerRuntime,
    fixture
  );
  await testWorkerMissingFontResolver(openPdfWithWorkerEndpoint, attachPdfWorkerRuntime);
  await testWorkerImageCodecResolver(openPdfWithWorkerEndpoint, attachPdfWorkerRuntime);
  await testFailedOpenClosesRange(openPdfWithWorkerEndpoint, attachPdfWorkerRuntime);

  const original = new PdfError("resource-limit", "fixture limit", {
    offset: 12,
    objectNumber: 7,
    pageIndex: 1,
    details: { limit: 3 }
  });
  const roundTrip = deserializePdfError(serializePdfError(original));
  assert.equal(roundTrip.code, "resource-limit");
  assert.equal(roundTrip.offset, 12);
  assert.deepEqual(roundTrip.details, { limit: 3 });

  await testCancellation(openPdfWithWorkerEndpoint, PDF_WORKER_PROTOCOL_VERSION);
  await testQueuedCancellation(openPdfWithWorkerEndpoint, PDF_WORKER_PROTOCOL_VERSION);
  await testCrash(openPdfWithWorkerEndpoint, PDF_WORKER_PROTOCOL_VERSION);
  await testCrashClosesRange(openPdfWithWorkerEndpoint, PDF_WORKER_PROTOCOL_VERSION);

  console.log("Long-lived PDF session worker protocol tests passed.");
} finally {
  hooks.deregister();
}

async function testCancellation(openPdfWithWorkerEndpoint, protocolVersion) {
  const endpoint = scriptedEndpoint(protocolVersion);
  const cancelledRequestIds = [];
  const compileRequestIds = [];
  const compileWaiters = [];
  endpoint.onRequest = (request) => {
    if (request.operation === "open") endpoint.open(request.requestId);
    else if (request.operation === "close") endpoint.close(request.requestId);
    else if (request.operation === "compile-page") {
      const waiter = compileWaiters.shift();
      if (waiter) waiter(request.requestId);
      else compileRequestIds.push(request.requestId);
    }
  };
  endpoint.onCancel = (request) => { cancelledRequestIds.push(request.requestId); };
  const session = await openPdfWithWorkerEndpoint(
    { kind: "bytes", bytes: new Uint8Array([1, 2, 3]) },
    {},
    endpoint
  );
  const controller = new AbortController();
  const pagePromise = session.compilePage(0, { signal: controller.signal });
  const compileRequestId = await nextCompileRequest();
  controller.abort("fixture cancellation");
  await assert.rejects(pagePromise, (error) => error?.code === "aborted");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(cancelledRequestIds, [compileRequestId]);

  const iterator = session.compilePages()[Symbol.asyncIterator]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(compileRequestIds.length, 0,
    "compilePages must not start work until the caller requests a page");
  const nextPage = iterator.next();
  const iteratorRequestId = await nextCompileRequest();
  const nextPageRejection = assert.rejects(nextPage, (error) => error?.code === "aborted");
  await iterator.return();
  await nextPageRejection;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(cancelledRequestIds, [compileRequestId, iteratorRequestId]);
  await session.close();

  function nextCompileRequest() {
    const requestId = compileRequestIds.shift();
    if (requestId !== undefined) return Promise.resolve(requestId);
    return new Promise((resolve) => compileWaiters.push(resolve));
  }
}

async function testQueuedCancellation(openPdfWithWorkerEndpoint, protocolVersion) {
  const endpoint = scriptedEndpoint(protocolVersion);
  const compileRequestIds = [];
  endpoint.onRequest = (request) => {
    if (request.operation === "open") endpoint.open(request.requestId);
    else if (request.operation === "close") endpoint.close(request.requestId);
    else if (request.operation === "compile-page") compileRequestIds.push(request.requestId);
  };
  endpoint.onCancel = () => undefined;
  const session = await openPdfWithWorkerEndpoint(
    { kind: "bytes", bytes: new Uint8Array([1, 2, 3]) },
    {},
    endpoint
  );
  const activeController = new AbortController();
  const active = session.compilePage(0, { signal: activeController.signal });
  await waitFor(() => compileRequestIds.length === 1);

  const queuedController = new AbortController();
  const queued = session.compilePage(0, { signal: queuedController.signal });
  queuedController.abort("queued cancellation");
  await rejectsPromptly(queued, (error) => error?.code === "aborted",
    "queued worker cancellation");
  assert.equal(compileRequestIds.length, 1,
    "a cancelled queued operation must never overlap the active compilation");

  activeController.abort("finish active fixture operation");
  await assert.rejects(active, (error) => error?.code === "aborted");
  await session.close();
}

async function testWorkerMissingFontResolver(
  openPdfWithWorkerEndpoint,
  attachPdfWorkerRuntime
) {
  const fontFixture = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 50] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"
      },
      { number: 4, body: tinyPdfStream("", "BT /F1 12 Tf 1 0 0 1 10 20 Tm (AB) Tj ET\n") },
      {
        number: 5,
        body: "<< /Type /Font /Subtype /TrueType /BaseFont /FixtureSans /Encoding /WinAnsiEncoding >>"
      }
    ]
  });
  const callerBytes = buildTinySfnt();
  const [hostEndpoint, workerEndpoint] = linkedCloneEndpoints();
  const runtime = attachPdfWorkerRuntime(workerEndpoint);
  const requests = [];
  const session = await openPdfWithWorkerEndpoint(
    { kind: "bytes", bytes: fontFixture },
    {
      missingFontResolver(request, signal) {
        assert.equal(signal?.aborted, false);
        requests.push(request);
        return { sfntBytes: callerBytes, identifier: "worker-fixture-font" };
      }
    },
    hostEndpoint
  );
  const page = await session.compilePage(0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].baseFont, "FixtureSans");
  assert.equal(callerBytes.byteLength, buildTinySfnt().byteLength,
    "transferring a worker-owned copy must not detach caller font bytes");
  assert.equal(page.textIndex.text, "AB");
  assert.ok(page.stores.fonts.outlinePathCounts.length >= 2);
  const vectorPage = await session.compileVectorPage(0, { optimization: "none" });
  assert.equal(vectorPage.textIndex?.pages[0]?.text, "AB");
  assert.equal(vectorPage.textInstanceCount, 2);
  assert.ok(vectorPage.textGlyphSegmentCount > 0);
  assert.equal("displayProgram" in vectorPage, false);
  assert.equal("stores" in vectorPage, false);
  assert.ok(session.getDiagnostics().some(
    (diagnostic) => diagnostic.code === "font.missing-substituted"
  ));
  await session.close();
  await runtime.close();

  const [cancelHostEndpoint, cancelWorkerEndpoint] = linkedCloneEndpoints();
  const cancelRuntime = attachPdfWorkerRuntime(cancelWorkerEndpoint);
  let resolverSignal;
  let resolverStarted;
  const started = new Promise((resolve) => { resolverStarted = resolve; });
  const cancelSession = await openPdfWithWorkerEndpoint(
    { kind: "bytes", bytes: fontFixture },
    {
      missingFontResolver(_request, signal) {
        resolverSignal = signal;
        resolverStarted();
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
    },
    cancelHostEndpoint
  );
  const controller = new AbortController();
  const compiling = cancelSession.compilePage(0, { signal: controller.signal });
  await started;
  controller.abort("cancel worker font fixture");
  await assert.rejects(compiling, (error) => error?.code === "aborted");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(resolverSignal.aborted, true,
    "worker operation cancellation must abort the host resolver invocation");
  await cancelSession.close();
  await cancelRuntime.close();
}

async function testWorkerImageCodecResolver(
  openPdfWithWorkerEndpoint,
  attachPdfWorkerRuntime
) {
  const imageFixture = workerCodecImageFixture();
  const callerSamples = Buffer.from([11, 22, 33]);
  const [hostEndpoint, workerEndpoint] = linkedCloneEndpoints();
  const runtime = attachPdfWorkerRuntime(workerEndpoint);
  const requests = [];
  const session = await openPdfWithWorkerEndpoint(
    { kind: "bytes", bytes: imageFixture },
    {
      imageCodecResolver(request, signal) {
        assert.equal(signal?.aborted, false);
        requests.push(request);
        assert.equal(request.codec, "jpeg");
        assert.equal(request.width, 1);
        assert.equal(request.height, 1);
        assert.equal(request.components, 3);
        assert.equal(request.bitsPerComponent, 8);
        assert.equal(request.imageMask, false);
        assert.deepEqual([...request.encoded], [0xff, 0xd8, 0xff, 0xd9]);
        return {
          samples: callerSamples,
          width: 1,
          height: 1,
          components: 3,
          bitsPerComponent: 8
        };
      }
    },
    hostEndpoint
  );
  const page = await session.compilePage(0, { optimization: "none" });
  assert.equal(requests.length, 1);
  assert.deepEqual([...page.stores.images.data], [11, 22, 33, 255]);
  assert.deepEqual([...callerSamples], [11, 22, 33],
    "transferring a worker-owned copy must not detach caller codec samples");
  const vectorPage = await session.compileVectorPage(0, { optimization: "none" });
  assert.equal(vectorPage.rasterLayers.length, 1);
  assert.deepEqual([...vectorPage.rasterLayers[0].data], [11, 22, 33, 255]);
  assert.equal(vectorPage.imagePaintOpCount, 1);
  await session.close();
  await runtime.close();

  const [badHostEndpoint, badWorkerEndpoint] = linkedCloneEndpoints();
  const badRuntime = attachPdfWorkerRuntime(badWorkerEndpoint);
  const badSession = await openPdfWithWorkerEndpoint(
    { kind: "bytes", bytes: imageFixture },
    {
      imageCodecResolver() {
        return {
          samples: Uint8Array.of(1, 2),
          width: 1,
          height: 1,
          components: 3,
          bitsPerComponent: 8
        };
      }
    },
    badHostEndpoint
  );
  await assert.rejects(
    badSession.compilePage(0),
    (error) => error?.code === "unsupported-image" &&
      error?.details?.reason === "invalid-codec-result"
  );
  await badSession.close();
  await badRuntime.close();

  const [cancelHostEndpoint, cancelWorkerEndpoint] = linkedCloneEndpoints();
  const cancelRuntime = attachPdfWorkerRuntime(cancelWorkerEndpoint);
  let resolverSignal;
  let resolverStarted;
  const started = new Promise((resolve) => { resolverStarted = resolve; });
  const cancelSession = await openPdfWithWorkerEndpoint(
    { kind: "bytes", bytes: imageFixture },
    {
      imageCodecResolver(_request, signal) {
        resolverSignal = signal;
        resolverStarted();
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
    },
    cancelHostEndpoint
  );
  const controller = new AbortController();
  const compiling = cancelSession.compilePage(0, { signal: controller.signal });
  await started;
  controller.abort("cancel worker codec fixture");
  await assert.rejects(compiling, (error) => error?.code === "aborted");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(resolverSignal.aborted, true,
    "worker operation cancellation must abort the host codec invocation");
  await cancelSession.close();
  await cancelRuntime.close();

  const [closeHostEndpoint, closeWorkerEndpoint] = linkedCloneEndpoints();
  const closeRuntime = attachPdfWorkerRuntime(closeWorkerEndpoint);
  let closeResolverSignal;
  let markCloseResolverStarted;
  const closeResolverStarted = new Promise((resolve) => { markCloseResolverStarted = resolve; });
  const closeSession = await openPdfWithWorkerEndpoint(
    { kind: "bytes", bytes: imageFixture },
    {
      imageCodecResolver(_request, signal) {
        closeResolverSignal = signal;
        markCloseResolverStarted();
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
    },
    closeHostEndpoint
  );
  const closingCompile = closeSession.compilePage(0);
  await closeResolverStarted;
  const compileRejection = assert.rejects(
    closingCompile,
    (error) => error?.code === "closed" || error?.code === "aborted"
  );
  await closeSession.close();
  await compileRejection;
  assert.equal(closeResolverSignal.aborted, true,
    "closing a worker session must abort the host codec invocation");
  await closeRuntime.close();

  const [crashHostEndpoint, crashWorkerEndpoint] = linkedCloneEndpoints();
  const crashRuntime = attachPdfWorkerRuntime(crashWorkerEndpoint);
  let crashListener;
  let crashResolverSignal;
  let markCrashResolverStarted;
  const crashResolverStarted = new Promise((resolve) => { markCrashResolverStarted = resolve; });
  const crashSession = await openPdfWithWorkerEndpoint(
    { kind: "bytes", bytes: imageFixture },
    {
      imageCodecResolver(_request, signal) {
        crashResolverSignal = signal;
        markCrashResolverStarted();
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
    },
    crashHostEndpoint,
    {
      onCrash(listener) {
        crashListener = listener;
        return () => { crashListener = null; };
      },
      terminate() {}
    }
  );
  const crashingCompile = crashSession.compilePage(0);
  await crashResolverStarted;
  crashListener(new Error("codec bridge fixture crash"));
  await assert.rejects(crashingCompile, (error) => error?.code === "worker-crash");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(crashResolverSignal.aborted, true,
    "worker crash disposal must abort the host codec invocation");
  await crashRuntime.close();
}

function workerCodecImageFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    {
      number: 3,
      body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << /XObject << /Im 5 0 R >> >> /Contents 4 0 R >>"
    },
    { number: 4, body: tinyPdfStream("", "/Im Do") },
    {
      number: 5,
      body: tinyPdfStream(
        "/Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Interpolate true /Filter /DCTDecode",
        Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)
      )
    }
  ] });
}

async function testFailedOpenClosesRange(openPdfWithWorkerEndpoint, attachPdfWorkerRuntime) {
  const [hostEndpoint, workerEndpoint] = linkedCloneEndpoints();
  const runtime = attachPdfWorkerRuntime(workerEndpoint);
  let closeCount = 0;
  await assert.rejects(
    openPdfWithWorkerEndpoint({
      kind: "range",
      byteLength: 3,
      async read() { return new Uint8Array(3); },
      close() { closeCount += 1; }
    }, { limits: { maxSourceCacheBytes: 0 } }, hostEndpoint),
    (error) => error?.code === "invalid-object" && /maxSourceCacheBytes/.test(error.message)
  );
  assert.equal(closeCount, 1, "failed worker opens must close a materialized remote range source");
  await runtime.close();
}

async function testWorkerSourceVariants(
  openPdfWithWorkerEndpoint,
  attachPdfWorkerRuntime,
  fixture
) {
  const copiedBytes = fixture.slice();
  await withRuntime(
    { kind: "bytes", bytes: copiedBytes, ownership: "copy" },
    () => copiedBytes.fill(0)
  );
  assert.equal(copiedBytes.byteLength, fixture.byteLength);

  const transferredBytes = fixture.slice();
  await withRuntime({ kind: "bytes", bytes: transferredBytes, ownership: "transfer" });
  assert.equal(transferredBytes.byteLength, 0);

  const pooledCopiedBytes = Buffer.from(fixture);
  await withRuntime(
    { kind: "bytes", bytes: pooledCopiedBytes, ownership: "copy" },
    () => pooledCopiedBytes.fill(0)
  );

  const pooledTransferredBytes = Buffer.from(fixture);
  await withRuntime(
    { kind: "bytes", bytes: pooledTransferredBytes, ownership: "transfer" },
    () => pooledTransferredBytes.fill(0)
  );
  assert.equal(pooledTransferredBytes.byteLength, fixture.byteLength,
    "a non-transferable pooled Buffer must be isolated rather than detached");

  const [abortedHostEndpoint, abortedWorkerEndpoint] = linkedCloneEndpoints();
  const abortedRuntime = attachPdfWorkerRuntime(abortedWorkerEndpoint);
  const preAbortedBytes = fixture.slice();
  const preAborted = new AbortController();
  preAborted.abort("cancel before worker open");
  await assert.rejects(openPdfWithWorkerEndpoint(
    { kind: "bytes", bytes: preAbortedBytes, ownership: "transfer" },
    { signal: preAborted.signal },
    abortedHostEndpoint
  ), (error) => error?.code === "aborted");
  assert.equal(preAbortedBytes.byteLength, fixture.byteLength,
    "a pre-aborted worker open must not take byte ownership");
  await abortedRuntime.close();

  await withRuntime({
    kind: "blob",
    blob: new Blob([fixture], { type: "application/pdf" })
  });

  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  try {
    globalThis.fetch = async (url, init = {}) => {
      assert.equal(String(url), "https://fixture.invalid/document.pdf");
      assert.equal(init.method, "GET");
      const headers = new Headers(init.headers);
      assert.equal(headers.get("x-hepr-fixture"), "worker-source");
      const match = /^bytes=(\d+)-(\d+)$/.exec(headers.get("range") ?? "");
      assert.ok(match);
      const start = Number(match[1]);
      const end = Number(match[2]);
      fetchCount += 1;
      return new Response(fixture.slice(start, end + 1), {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fixture.length}`,
          ETag: '"worker-source-fixture"'
        }
      });
    };
    await withRuntime({
      kind: "url",
      url: new URL("https://fixture.invalid/document.pdf"),
      request: { headers: { "X-Hepr-Fixture": "worker-source" } }
    });
    assert.ok(fetchCount > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }

  async function withRuntime(source, afterOpen) {
    const [hostEndpoint, workerEndpoint] = linkedCloneEndpoints();
    const runtime = attachPdfWorkerRuntime(workerEndpoint);
    const session = await openPdfWithWorkerEndpoint(source, {}, hostEndpoint);
    try {
      assert.equal(session.info.pageCount, 2);
      afterOpen?.();
      assert.equal((await session.compilePage(0)).pageInfo.sourcePageIndex, 0);
    } finally {
      await session.close();
      await runtime.close();
    }
  }
}

async function testCrash(openPdfWithWorkerEndpoint, protocolVersion) {
  const endpoint = scriptedEndpoint(protocolVersion);
  let crashListener = null;
  let terminated = 0;
  let acknowledgeCompile;
  const compileReceived = new Promise((resolve) => { acknowledgeCompile = resolve; });
  endpoint.onRequest = (request) => {
    if (request.operation === "open") endpoint.open(request.requestId);
    else if (request.operation === "compile-page") acknowledgeCompile();
  };
  const session = await openPdfWithWorkerEndpoint(
    { kind: "bytes", bytes: new Uint8Array([1, 2, 3]) },
    {},
    endpoint,
    {
      onCrash(listener) {
        crashListener = listener;
        return () => { crashListener = null; };
      },
      terminate() {
        terminated += 1;
      }
    }
  );
  const pagePromise = session.compilePage(0);
  await compileReceived;
  crashListener(new Error("fixture worker exit"));
  await assert.rejects(
    pagePromise,
    (error) => error?.code === "worker-crash" && /fixture worker exit/.test(error.message)
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(terminated, 1);
}

async function testCrashClosesRange(openPdfWithWorkerEndpoint, protocolVersion) {
  const endpoint = scriptedEndpoint(protocolVersion);
  let crashListener = null;
  let terminated = 0;
  let closeCount = 0;
  let readSignal = null;
  let acknowledgeRead;
  const readStarted = new Promise((resolve) => { acknowledgeRead = resolve; });
  endpoint.onRequest = (request) => {
    if (request.operation !== "open") return;
    endpoint.dispatch({
      type: "pdf-range-read",
      requestId: 91,
      offset: 0,
      length: 1
    });
  };
  const opening = openPdfWithWorkerEndpoint({
    kind: "range",
    byteLength: 3,
    read(_offset, _length, signal) {
      readSignal = signal;
      acknowledgeRead();
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
    close() {
      closeCount += 1;
    }
  }, {}, endpoint, {
    onCrash(listener) {
      crashListener = listener;
      return () => { crashListener = null; };
    },
    terminate() {
      terminated += 1;
    }
  });
  await readStarted;
  crashListener(new Error("fixture crash during range read"));
  await assert.rejects(
    opening,
    (error) => error?.code === "worker-crash" && /fixture crash during range read/.test(error.message)
  );
  assert.equal(readSignal.aborted, true, "worker crash disposal must abort active host range callbacks");
  assert.equal(closeCount, 1, "worker crash disposal must close the caller's range source once");
  assert.equal(terminated, 1, "worker crash disposal must await one worker termination");
}

function scriptedEndpoint(protocolVersion) {
  const listeners = new Set();
  const info = {
    pdfVersion: "1.7",
    byteLength: 3,
    pageCount: 1,
    pages: [{
      sourcePageIndex: 0,
      mediaBox: [0, 0, 10, 10],
      cropBox: [0, 0, 10, 10],
      bleedBox: null,
      trimBox: null,
      artBox: null,
      rotation: 0,
      userUnit: 1,
      width: 10,
      height: 10
    }],
    label: null,
    fingerprint: null,
    linearized: false,
    repaired: false,
    tagged: false,
    language: null,
    metadata: {}
  };
  return {
    onRequest: null,
    onCancel: null,
    addEventListener(type, listener) {
      if (type === "message") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "message") listeners.delete(listener);
    },
    postMessage(message) {
      if (message.type === "hepr-pdf-request") this.onRequest?.(message);
      if (message.type === "hepr-pdf-cancel") this.onCancel?.(message);
    },
    open(requestId) {
      dispatch({
        type: "hepr-pdf-result",
        protocolVersion,
        requestId,
        ok: true,
        operation: "open",
        info,
        diagnostics: []
      });
    },
    close(requestId) {
      dispatch({
        type: "hepr-pdf-result",
        protocolVersion,
        requestId,
        ok: true,
        operation: "close"
      });
    },
    dispatch(message) {
      dispatch(message);
    }
  };

  function dispatch(message) {
    queueMicrotask(() => {
      for (const listener of listeners) listener({ data: message });
    });
  }
}

function linkedCloneEndpoints() {
  const left = cloneEndpoint();
  const right = cloneEndpoint();
  left.send = (message, transfer) => queueMicrotask(() => right.dispatch(
    structuredClone(message, transfer?.length ? { transfer } : undefined)
  ));
  right.send = (message, transfer) => queueMicrotask(() => left.dispatch(
    structuredClone(message, transfer?.length ? { transfer } : undefined)
  ));
  return [left, right];
}

function cloneEndpoint() {
  const listeners = new Set();
  return {
    send: null,
    onPost: null,
    addEventListener(type, listener) {
      if (type === "message") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "message") listeners.delete(listener);
    },
    postMessage(message, transfer) {
      this.onPost?.(message, transfer);
      this.send(message, transfer);
    },
    dispatch(message) {
      for (const listener of listeners) listener({ data: message });
    }
  };
}

async function waitFor(predicate, timeoutMs = 250) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for the worker fixture.");
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function rejectsPromptly(promise, predicate, label, timeoutMs = 500) {
  let timeout;
  try {
    await assert.rejects(Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} did not settle promptly`)), timeoutMs);
      })
    ]), predicate);
  } finally {
    clearTimeout(timeout);
  }
}

function assertRecursiveVectorTransferCollection(collectPdfTransferables) {
  const shared = new ArrayBuffer(32);
  const image = new Uint8Array([1, 2, 3, 4]);
  const matrix = new Float32Array([1, 0, 0, 1, 0, 0]);
  const fallbackQuads = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const sceneShape = {
    endpoints: new Float32Array(shared, 0, 4),
    primitiveMeta: new Float32Array(shared, 16, 4),
    rasterLayers: [{ data: image, matrix }],
    textIndex: { pages: [{ fallbackQuads }] }
  };
  const transfers = collectPdfTransferables(sceneShape);
  assert.equal(new Set(transfers).size, 4,
    "recursive scene transfer collection must deduplicate shared buffers");
  for (const buffer of [shared, image.buffer, matrix.buffer, fallbackQuads.buffer]) {
    assert.ok(transfers.includes(buffer), "a nested vector-scene buffer was not transferable");
  }
}
