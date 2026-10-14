import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });

try {
  const { ProcessingSession } = await import("../src/documentSessionRuntime.ts");
  const { openDocumentSession } = await import("../src/nodeDocumentSession.ts");
  await closeDuringEncoderFactory(ProcessingSession);
  await failedOpenClosesRange(openDocumentSession);
  await cancelledHeaderClosesRange(openDocumentSession);
  await cancelledNoncooperativeHeaderClosesRange(openDocumentSession);
  await rejectHepBeforeWorker(openDocumentSession);
  await pdfSignatureOverridesExtension(openDocumentSession);
  console.log("Node document resources: deferred encoder cleanup, failed-open and header-abort range ownership, early HEP rejection and PDF signature precedence passed.");
} finally {
  hooks.deregister();
}

async function closeDuringEncoderFactory(ProcessingSession) {
  const entered = deferred(), released = deferred();
  let closes = 0, encodes = 0, parserCloses = 0;
  const pdf = {
    info: { pages: [{ width: 10, height: 10 }] },
    async renderThumbnailPage() { return { width: 1, height: 1, rgba: new Uint8Array(4) }; },
    async terminate() { parserCloses++; }
  };
  const session = new ProcessingSession("pdf", 1, "factory.pdf", {}, [], pdf, undefined, {
    canvas2dOnly: true,
    async createEncoder() {
      entered.resolve();
      await released.promise;
      return {
        async encode() { encodes++; throw new Error("An aborted thumbnail must not encode."); },
        async close() { closes++; }
      };
    }
  });
  const render = session.renderThumbnail({ format: "png" });
  const rejected = assert.rejects(render, error => error?.name === "AbortError");
  try {
    await withTimeout(entered.promise, "The encoder factory did not start.");
    const closing = session.close();
    released.resolve();
    await withTimeout(closing, "Session close did not drain its encoder factory.");
    await rejected;
    await session.close();
    assert.equal(parserCloses, 1, "the owned parser closes once");
    assert.equal(closes, 1, "an encoder created while closing is released exactly once");
    assert.equal(encodes, 0, "close prevents work on the newly created encoder");
  } finally {
    released.resolve();
    await session.close();
    await rejected;
  }
}

async function failedOpenClosesRange(openDocumentSession) {
  const bytes = pdfFixture(), source = countedRange(bytes);
  await assert.rejects(openDocumentSession(source.input, {
    workerUrl: new URL("./missing-node-thumbnail-resource-worker.mjs", import.meta.url)
  }), error => error?.code === "worker-crash");
  assert.equal(source.closes(), 1, "worker failure and failed-open cleanup share one range close");
  assert.equal(source.reads(), 1, "only the signature is read before worker startup fails");
}

async function cancelledHeaderClosesRange(openDocumentSession) {
  const controller = new AbortController(), entered = deferred();
  const reason = new Error("The initial PDF header read was cancelled.");
  let closes = 0, reads = 0;
  const opening = openDocumentSession({
    kind: "range", byteLength: 100, label: "pending.pdf",
    read(_offset, _length, signal) {
      reads++;
      entered.resolve();
      return new Promise((_resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
    },
    async close() { closes++; }
  }, { signal: controller.signal,
    workerUrl: new URL("./missing-node-thumbnail-resource-worker.mjs", import.meta.url) });
  const rejected = assert.rejects(opening, error => error === reason);
  await withTimeout(entered.promise, "The initial header read did not start.");
  controller.abort(reason);
  await withTimeout(rejected, "Cancelling the initial header read did not settle open.");
  assert.equal(reads, 1);
  assert.equal(closes, 1, "an aborted header read closes its source exactly once");
}

async function rejectHepBeforeWorker(openDocumentSession) {
  for (const bytes of [Uint8Array.of(72, 69, 80, 0), Uint8Array.of(80, 75, 3, 4, 0, 0, 0, 0)]) {
    const source = countedRange(bytes);
    await assert.rejects(openDocumentSession(source.input, {
      workerUrl: new URL("./missing-node-thumbnail-resource-worker.mjs", import.meta.url)
    }), error => error?.code === "unsupported-content" && /HEP/.test(error.message));
    assert.equal(source.reads(), 1, "HEP is rejected during signature inspection before opening the worker");
    assert.equal(source.closes(), 1, "rejected HEP sources release their range owner");
  }
}

async function cancelledNoncooperativeHeaderClosesRange(openDocumentSession) {
  const controller = new AbortController(), entered = deferred(), released = deferred();
  const reason = new Error("The host stopped waiting for a noncooperative PDF header read.");
  let closes = 0, reads = 0;
  const opening = openDocumentSession({
    kind: "range", byteLength: 100, label: "pending.pdf",
    read() { reads++; entered.resolve(); return released.promise; },
    async close() { closes++; }
  }, { signal: controller.signal,
    workerUrl: new URL("./missing-node-thumbnail-resource-worker.mjs", import.meta.url) });
  const rejected = assert.rejects(opening, error => error === reason);
  try {
    await withTimeout(entered.promise, "The noncooperative header read did not start.");
    controller.abort(reason);
    await withTimeout(rejected, "Cancellation must settle before a noncooperative header read finishes.");
    assert.equal(reads, 1);
    assert.equal(closes, 1, "cancellation releases the source while its noncooperative read is pending");
  } finally {
    // The host can finish later; cancellation must drain its result without
    // reviving parser startup or attempting another source close.
    released.resolve(new TextEncoder().encode("%PDF-1.7"));
    await rejected;
  }
  await Promise.resolve();
  assert.equal(closes, 1, "the late header result cannot close its source again");
}

async function pdfSignatureOverridesExtension(openDocumentSession) {
  const bytes = pdfFixture();
  const prefix = new TextEncoder().encode(" ".repeat(32));
  const prefixed = new Uint8Array(prefix.length + bytes.length);
  prefixed.set(prefix); prefixed.set(bytes, prefix.length);
  for (const sourceBytes of [bytes, prefixed]) {
    const session = await openDocumentSession({ kind: "bytes", bytes: sourceBytes, label: "actual-pdf.hep" }, {
      repair: "safe",
      workerUrl: sourceWorkerBootstrapUrl(new URL("../src/pdf/pdfWorkerEntry.ts", import.meta.url))
    });
    try {
      assert.equal(session.info.sourceKind, "pdf", "a PDF signature within the accepted leading-byte range overrides the extension");
      assert.equal(session.info.pageCount, 1);
    } finally { await session.close(); }
  }
}

function countedRange(bytes) {
  let closes = 0, reads = 0;
  return {
    input: {
      kind: "range", byteLength: bytes.length, label: "owned.pdf",
      async read(offset, length, signal) { signal.throwIfAborted(); reads++; return bytes.slice(offset, offset + length); },
      async close() { closes++; }
    },
    closes: () => closes,
    reads: () => reads
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function withTimeout(promise, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), 10_000);
    promise.then(value => { clearTimeout(timeout); resolve(value); }, error => { clearTimeout(timeout); reject(error); });
  });
}

function sourceWorkerBootstrapUrl(entryUrl) {
  const source = `import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(context.parentURL?.includes("/src/") && /^\\.\\.?\\//.test(specifier) && !/\\.[a-z0-9]+(?:[?#]|$)/i.test(specifier) ? specifier + ".ts" : specifier, context);
} });
await import(${JSON.stringify(entryUrl.href)});`;
  return new URL(`data:text/javascript,${encodeURIComponent(source)}`);
}

function pdfFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "1 0 0 rg 1 1 8 8 re f") }
  ] });
}
