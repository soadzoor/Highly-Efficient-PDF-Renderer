import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { createLoadProgressReporter } from "../src/loadProgress.ts";
import { collectPdfOperatorList } from "../src/pdfOperatorList.ts";

await testBatchedOperatorCollection();
await testConcurrentCollectionSharesWrapper();
await testMalformedChunkFallback();
await testPublicApiFallback();
await testChunkHandlerRestoredAfterFailure();
await testIndeterminateOperatorProgress();
await testRealPdfJsPage();

console.log("PDF operator loading tests passed.");

async function testBatchedOperatorCollection() {
  const firstArg = { id: "first" };
  const lastArg = { id: "last" };
  const fixture = createChunkedPage([
    createChunk([10, 11, 12], [firstArg, "middle", 3]),
    createChunk([20, 21], [4, lastArg], { lastChunk: true, separateAnnots: { form: true } })
  ]);

  const result = await collectPdfOperatorList(fixture.page);

  assert.deepEqual(result.fnArray, [10, 11, 12, 20, 21]);
  assert.deepEqual(result.argsArray, [firstArg, "middle", 3, 4, lastArg]);
  assert.equal(result.argsArray[0], firstArg, "operator arguments must retain reference identity");
  assert.equal(result.argsArray.at(-1), lastArg, "operator arguments must retain reference identity");
  assert.equal(result.lastChunk, true);
  assert.deepEqual(result.separateAnnots, { form: true });
  assert.equal(fixture.metrics.fnPushCalls, 2, "each operator chunk should use one bulk append");
  assert.equal(fixture.metrics.argPushCalls, 2, "each argument chunk should use one bulk append");
  assert.equal(fixture.metrics.notifications, 2, "PDF.js tasks must still be notified for every chunk");
  assert.ok(fixture.metrics.originalThisValues.every((value) => value === fixture.page));
  assert.equal(fixture.page._renderPageChunk, fixture.originalChunkHandler);
  assert.equal(
    Object.prototype.hasOwnProperty.call(fixture.page, "_renderPageChunk"),
    false,
    "an inherited PDF.js chunk handler must remain inherited after loading"
  );
}

async function testConcurrentCollectionSharesWrapper() {
  const fixture = createChunkedPage([
    createChunk([1, 2], ["a", "b"]),
    createChunk([3], ["c"], { lastChunk: true })
  ]);

  const [first, second] = await Promise.all([
    collectPdfOperatorList(fixture.page),
    collectPdfOperatorList(fixture.page)
  ]);

  assert.equal(first, second, "concurrent calls should share PDF.js's cached operator-list promise");
  assert.deepEqual(first.fnArray, [1, 2, 3]);
  assert.equal(fixture.metrics.fnPushCalls, 2, "concurrent calls must not nest batching wrappers");
  assert.equal(fixture.page._renderPageChunk, fixture.originalChunkHandler);
  assert.equal(Object.prototype.hasOwnProperty.call(fixture.page, "_renderPageChunk"), false);
}

async function testMalformedChunkFallback() {
  const malformed = createChunk([1, 2, 3], ["a", "b", "c"]);
  malformed.length = 2;
  const fixture = createChunkedPage([malformed]);

  const result = await collectPdfOperatorList(fixture.page);

  assert.deepEqual(result.fnArray, [1, 2]);
  assert.deepEqual(result.argsArray, ["a", "b"]);
  assert.equal(fixture.metrics.fnPushCalls, 2, "invalid chunk shapes must use PDF.js's original loop");
  assert.equal(fixture.metrics.argPushCalls, 2, "invalid chunk shapes must use PDF.js's original loop");
  assert.equal(fixture.page._renderPageChunk, fixture.originalChunkHandler);
}

async function testPublicApiFallback() {
  const expected = { fnArray: [7], argsArray: ["fallback"] };
  let calls = 0;
  const result = await collectPdfOperatorList({
    async getOperatorList() {
      calls += 1;
      return expected;
    }
  });

  assert.equal(result, expected);
  assert.equal(calls, 1);
}

async function testChunkHandlerRestoredAfterFailure() {
  const fixture = createChunkedPage([createChunk([1], ["one"])], new Error("operator failure"));

  await assert.rejects(collectPdfOperatorList(fixture.page), /operator failure/);
  assert.equal(fixture.page._renderPageChunk, fixture.originalChunkHandler);
  assert.equal(Object.prototype.hasOwnProperty.call(fixture.page, "_renderPageChunk"), false);
}

async function testIndeterminateOperatorProgress() {
  const events = [];
  const progress = createLoadProgressReporter((event) => events.push(event), {
    throttleMs: 0,
    minDelta: 0
  });
  const parseProgress = progress.child(0, 0.34);
  const operatorStart = 0.08 + 0.84 * 0.28;
  const operatorEnd = 0.08 + 0.84 * 0.58;
  const operatorProgress = parseProgress.child(operatorStart, operatorEnd);
  let resolveWork;
  const work = new Promise((resolve) => {
    resolveWork = resolve;
  });

  const pending = operatorProgress.withIndeterminateProgress(work, {
    stage: "pdf-operators",
    sourceType: "pdf",
    unit: "operators",
    processed: 0,
    tickMs: 50,
    ceiling: 0.97,
    timeConstantMs: 100
  });

  await waitFor(() => events.length >= 3);
  const expectedStart = operatorStart * 0.34;
  const expectedEnd = operatorEnd * 0.34;
  assert.ok(Math.abs(events[0].value - expectedStart) < 1e-12);
  assert.ok(events.some((event) => event.value > expectedStart && event.value < expectedEnd));
  assert.ok(events.every((event) => event.stage === "pdf-operators"));
  assert.ok(events.every((event, index) => index === 0 || event.value >= events[index - 1].value));

  resolveWork("done");
  assert.equal(await pending, "done");
  assert.ok(Math.abs(events.at(-1).value - expectedEnd) < 1e-12);

  const eventCountAtCompletion = events.length;
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(events.length, eventCountAtCompletion, "operator progress timer must stop after completion");
}

async function testRealPdfJsPage() {
  const pdfBytes = new Uint8Array(
    await readFile(new URL("../public/examples/pdfs/LK Office Level 1.pdf", import.meta.url))
  );
  const loadingTask = getDocument({
    data: pdfBytes,
    disableFontFace: true,
    fontExtraProperties: true,
    verbosity: 0
  });

  try {
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const originalChunkHandler = page._renderPageChunk;
    const operatorList = await collectPdfOperatorList(page);

    assert.ok(operatorList.fnArray.length > 1_000, "the smoke fixture must exercise multiple PDF.js chunks");
    assert.equal(operatorList.argsArray.length, operatorList.fnArray.length);
    assert.equal(operatorList.lastChunk, true);
    assert.equal(page._renderPageChunk, originalChunkHandler);
    assert.equal(Object.prototype.hasOwnProperty.call(page, "_renderPageChunk"), false);
  } finally {
    await loadingTask.destroy();
  }
}

function createChunk(fnArray, argsArray, metadata = {}) {
  return {
    fnArray,
    argsArray,
    length: fnArray.length,
    lastChunk: false,
    separateAnnots: null,
    ...metadata
  };
}

function createChunkedPage(chunks, failure = null) {
  const metrics = {
    fnPushCalls: 0,
    argPushCalls: 0,
    notifications: 0,
    originalThisValues: []
  };
  const originalChunkHandler = function (chunk, intentState) {
    metrics.originalThisValues.push(this);
    for (let index = 0; index < chunk.length; index += 1) {
      intentState.operatorList.fnArray.push(chunk.fnArray[index]);
      intentState.operatorList.argsArray.push(chunk.argsArray[index]);
    }
    intentState.operatorList.lastChunk = chunk.lastChunk;
    intentState.operatorList.separateAnnots = chunk.separateAnnots;
    metrics.notifications += 1;
  };
  const prototype = { _renderPageChunk: originalChunkHandler };
  let operatorListPromise = null;
  const page = Object.assign(Object.create(prototype), {
    getOperatorList() {
      if (!operatorListPromise) {
        operatorListPromise = (async () => {
          const operatorList = {
            fnArray: createInstrumentedArray(() => {
              metrics.fnPushCalls += 1;
            }),
            argsArray: createInstrumentedArray(() => {
              metrics.argPushCalls += 1;
            }),
            lastChunk: false,
            separateAnnots: null
          };
          const intentState = { operatorList };
          for (const chunk of chunks) {
            await Promise.resolve();
            this._renderPageChunk(chunk, intentState);
          }
          if (failure) {
            throw failure;
          }
          return operatorList;
        })();
      }
      return operatorListPromise;
    }
  });

  return { page, metrics, originalChunkHandler };
}

function createInstrumentedArray(onPush) {
  const values = [];
  Object.defineProperty(values, "push", {
    configurable: true,
    value(...items) {
      onPush();
      return Array.prototype.push.apply(this, items);
    }
  });
  return values;
}

async function waitFor(predicate) {
  const deadline = performance.now() + 2_000;
  while (!predicate()) {
    assert.ok(performance.now() < deadline, "timed out waiting for progress events");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
