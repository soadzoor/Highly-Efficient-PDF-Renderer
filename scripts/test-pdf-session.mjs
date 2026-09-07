import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const [{ openPdf, parsePdf }, { validateHeprPageData }] =
    await Promise.all([
      import("../src/pdfSession.ts"),
      import("../src/heprDocumentDataValidation.ts")
    ]);

  const bytes = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /CropBox [10 5 190 95] /Rotate 90 /UserUnit 2 /Resources << /Font << /F1 5 0 R >> /XObject << /Im1 7 0 R >> >> /Contents 4 0 R >>"
      },
      {
        number: 4,
        body: tinyPdfStream("", "1 0 0 rg 10 5 20 10 re f q 10 0 0 10 40 20 cm /Im1 Do Q BT /F1 12 Tf 3 Tr 1 0 0 1 20 30 Tm (Hi) Tj ET 0 0 0 RG 10 20 m 100 20 l S\n")
      },
      {
        number: 5,
        body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
      },
      {
        number: 7,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8",
          Uint8Array.of(255, 0, 0)
        )
      }
    ]
  });
  const source = { kind: "bytes", bytes, ownership: "copy", label: "session-fixture.pdf" };
  const session = await openPdf(source);
  assert.equal(session.info.pageCount, 1);
  assert.equal(session.info.pages[0].sourcePageIndex, 0);
  assert.equal(session.info.pages[0].rotation, 90);
  assert.equal(session.info.pages[0].userUnit, 2);
  assert.equal(session.info.pages[0].width, 180);
  assert.equal(session.info.pages[0].height, 360);

  const page = await session.compilePage(0);
  validateHeprPageData(page);
  assert.deepEqual(
    page.displayProgram.groups[0].commands.map((command) => command.source),
    ["fill-paths", "images", "glyphs", "stroke-segments"]
  );
  assert.equal(page.textIndex.text, "Hi");
  assert.deepEqual([...page.stores.glyphs.flags], [2, 2]);
  assert.deepEqual([...page.stores.fonts.glyphOffsets], [0, 2]);
  assert.deepEqual([...page.stores.images.data], [255, 0, 0, 255]);
  const iterator = session.compilePages()[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).done, false);
  await iterator.return();
  validateHeprPageData(await session.compilePage(0));
  await assert.rejects(
    async () => {
      for await (const _page of session.compilePages({ sourcePageIndexes: [0, 0] })) {
        // Duplicate validation runs before compilation.
      }
    },
    (error) => error?.code === "invalid-page-index"
  );
  await session.close();
  await session.close();
  await assert.rejects(session.compilePage(0), (error) => error?.code === "closed");

  const copiedBytes = bytes.slice();
  const copiedSession = await openPdf({ kind: "bytes", bytes: copiedBytes, ownership: "copy" });
  copiedBytes.fill(0);
  validateHeprPageData(await copiedSession.compilePage(0));
  await copiedSession.close();

  const pooledCopiedBytes = Buffer.from(bytes);
  const pooledCopiedSession = await openPdf({
    kind: "bytes",
    bytes: pooledCopiedBytes,
    ownership: "copy"
  });
  pooledCopiedBytes.fill(0);
  validateHeprPageData(await pooledCopiedSession.compilePage(0));
  await pooledCopiedSession.close();

  const transferredBytes = bytes.slice();
  const transferredLength = transferredBytes.byteLength;
  const transferredSession = await openPdf({
    kind: "bytes",
    bytes: transferredBytes,
    ownership: "transfer"
  });
  assert.equal(transferredBytes.byteLength, 0,
    "direct transfer ownership must detach an ordinary ArrayBuffer");
  assert.equal(transferredSession.info.byteLength, transferredLength);
  validateHeprPageData(await transferredSession.compilePage(0));
  await transferredSession.close();

  const pooledTransferredBytes = Buffer.from(bytes);
  const pooledTransferredSession = await openPdf({
    kind: "bytes",
    bytes: pooledTransferredBytes,
    ownership: "transfer"
  });
  assert.equal(pooledTransferredBytes.byteLength, bytes.byteLength,
    "a non-transferable pooled Buffer must remain attached");
  pooledTransferredBytes.fill(0);
  validateHeprPageData(await pooledTransferredSession.compilePage(0));
  await pooledTransferredSession.close();

  const preAbortedBytes = bytes.slice();
  const preAborted = new AbortController();
  preAborted.abort("cancel before direct open");
  await assert.rejects(
    openPdf(
      { kind: "bytes", bytes: preAbortedBytes, ownership: "transfer" },
      { signal: preAborted.signal }
    ),
    (error) => error?.code === "aborted"
  );
  assert.equal(preAbortedBytes.byteLength, bytes.byteLength,
    "a pre-aborted open must not take byte ownership");

  let failedOpenCloseCount = 0;
  const progressFailure = new Error("fixture source progress failure");
  await assert.rejects(openPdf({
    kind: "range",
    byteLength: bytes.length,
    async read(offset, length) { return bytes.slice(offset, offset + length); },
    close() { failedOpenCloseCount += 1; }
  }, {
    onProgress(update) {
      if (update.stage === "source-read") throw progressFailure;
    }
  }), (error) => error === progressFailure);
  assert.equal(failedOpenCloseCount, 1,
    "a failed open must close a range source after ownership is accepted");

  await testDirectOperationLifecycle(openPdf, source, validateHeprPageData);

  let missingFontRequests = 0;
  const resolverSession = await openPdf(source, {
    missingFontResolver(request) {
      missingFontRequests += 1;
      assert.equal(request.baseFont, "Helvetica");
      return null;
    }
  });
  validateHeprPageData(await resolverSession.compilePage(0));
  assert.equal(missingFontRequests, 1);
  await resolverSession.close();

  let parseRangeCloseCount = 0;
  const documentData = await parsePdf({
    kind: "range",
    byteLength: bytes.length,
    async read(offset, length, signal) {
      signal.throwIfAborted();
      return bytes.slice(offset, offset + length);
    },
    close() { parseRangeCloseCount += 1; }
  });
  assert.equal(parseRangeCloseCount, 1, "parsePdf must close its source after atomic collection");
  assert.equal(documentData.pages.length, 1);
  assert.equal(documentData.pages[0].pageInfo.sourcePageIndex, 0);

  const failingBytes = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Contents 4 0 R >>"
      },
      { number: 4, body: tinyPdfStream("", "Q") }
    ]
  });
  let failingRangeCloseCount = 0;
  await assert.rejects(parsePdf({
    kind: "range",
    byteLength: failingBytes.length,
    async read(offset, length, signal) {
      signal.throwIfAborted();
      return failingBytes.slice(offset, offset + length);
    },
    close() { failingRangeCloseCount += 1; }
  }), (error) => error?.code === "unsupported-content");
  assert.equal(failingRangeCloseCount, 1,
    "parsePdf must close its source when atomic collection fails");

  const closeFailure = new Error("fixture close failure");
  await assert.rejects(parsePdf({
    kind: "range",
    byteLength: failingBytes.length,
    async read(offset, length, signal) {
      signal.throwIfAborted();
      return failingBytes.slice(offset, offset + length);
    },
    close() { throw closeFailure; }
  }), (error) => error?.code === "unsupported-content",
  "source cleanup must not mask the atomic page-compilation failure");

  console.log("PDF session and atomic parse tests passed.");
} finally {
  hooks.deregister();
}

async function testDirectOperationLifecycle(openPdf, source, validateHeprPageData) {
  let resolverCalls = 0;
  let activeResolverSignal;
  let markActiveStarted;
  const activeStarted = new Promise((resolve) => { markActiveStarted = resolve; });
  const session = await openPdf(source, {
    missingFontResolver(_request, signal) {
      resolverCalls += 1;
      if (resolverCalls > 1) return null;
      activeResolverSignal = signal;
      markActiveStarted();
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
  });
  const activeController = new AbortController();
  const active = session.compilePage(0, { signal: activeController.signal });
  await activeStarted;

  const queuedController = new AbortController();
  const queued = session.compilePage(0, { signal: queuedController.signal });
  queuedController.abort("cancel queued direct compilation");
  await rejectsPromptly(
    queued,
    (error) => error?.code === "aborted",
    "queued direct cancellation"
  );
  assert.equal(resolverCalls, 1,
    "a queued compilation must not enter page compilation while another operation is active");
  assert.equal(activeResolverSignal.aborted, false,
    "cancelling queued work must not cancel the active operation");

  activeController.abort("finish active direct compilation");
  await assert.rejects(active, (error) => error?.code === "aborted");
  validateHeprPageData(await session.compilePage(0));
  await session.close();

  let iteratorResolverCalls = 0;
  let iteratorResolverSignal;
  let markIteratorStarted;
  const iteratorStarted = new Promise((resolve) => { markIteratorStarted = resolve; });
  const iteratorSession = await openPdf(source, {
    missingFontResolver(_request, signal) {
      iteratorResolverCalls += 1;
      if (iteratorResolverCalls > 1) return null;
      iteratorResolverSignal = signal;
      markIteratorStarted();
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
  });
  const iterator = iteratorSession.compilePages()[Symbol.asyncIterator]();
  const pendingNext = iterator.next();
  await iteratorStarted;
  await iterator.return();
  await assert.rejects(pendingNext, (error) => error?.code === "aborted");
  assert.equal(iteratorResolverSignal.aborted, true,
    "ending active iteration must cancel its page compilation");
  validateHeprPageData(await iteratorSession.compilePage(0));
  await iteratorSession.close();
}

async function rejectsPromptly(promise, predicate, label) {
  let timeout;
  try {
    await assert.rejects(Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} did not settle promptly`)), 500);
      })
    ]), predicate);
  } finally {
    clearTimeout(timeout);
  }
}
