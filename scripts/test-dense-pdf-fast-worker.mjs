import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import {
  PDFDocument,
  PDFName,
  degrees
} from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

Promise.try ??= (callback, ...args) => Promise.resolve().then(() => callback(...args));
Uint8Array.prototype.toHex ??= function toHex() {
  return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("hex");
};
Uint8Array.prototype.toBase64 ??= function toBase64() {
  return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("base64");
};
Uint8Array.fromHex ??= (value) => new Uint8Array(Buffer.from(value, "hex"));
Uint8Array.fromBase64 ??= (value) => new Uint8Array(Buffer.from(value, "base64"));

const originalSelfDescriptor = Object.getOwnPropertyDescriptor(globalThis, "self");
const originalWorkerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");
const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === "./densePdfContentCompiler" ||
      specifier === "./densePdfDocument"
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const geometryWorker = await loadWorkerEntry("geometry");
  await testGeometryParity(geometryWorker.module.computeDensePdfPageGeometry);
  console.log("  geometry parity passed");

  const fallbackWorker = await loadWorkerEntry("fallback");
  await testWorkerFallback(fallbackWorker);
  console.log("  fallback protocol passed");

  const mixedFallbackWorker = await loadWorkerEntry("mixed-fallback");
  await testMixedPageAtomicFallback(mixedFallbackWorker);
  console.log("  mixed-page atomic fallback passed");

  const missingResourceWorker = await loadWorkerEntry("missing-resource");
  await testTextMiniResourceFallback(missingResourceWorker);
  console.log("  text-mini resource fallback passed");

  const successWorker = await loadWorkerEntry("success");
  await testWorkerSuccessAndProgress(successWorker);
  console.log("  success/progress protocol passed");

  restoreGlobal("self", originalSelfDescriptor);
  const client = await import(
    new URL("../src/densePdfFastWorkerClient.ts?worker-client-test", import.meta.url)
  );
  await testClient(client.compileDensePdfInWorker);
  console.log("  client fallback/transfer/abort passed");

  console.log("Dense PDF fast worker/client tests passed.");
} finally {
  restoreGlobal("self", originalSelfDescriptor);
  restoreGlobal("Worker", originalWorkerDescriptor);
  moduleHooks.deregister();
}

async function testGeometryParity(computeGeometry) {
  const sourceDocument = await PDFDocument.create({ updateMetadata: false });
  const inputs = [];

  for (const rotation of [0, 90, 180, 270]) {
    const page = sourceDocument.addPage([200, 100]);
    page.setMediaBox(10, 20, 200, 100);
    page.setCropBox(30, 10, 170, 80);
    page.setRotation(degrees(rotation));
    page.node.set(PDFName.of("UserUnit"), sourceDocument.context.obj(2));
    inputs.push({
      mediaBox: { left: 10, bottom: 20, right: 210, top: 120 },
      cropBox: { left: 30, bottom: 10, right: 200, top: 90 },
      rotation,
      userUnit: 2
    });
  }

  // PDF.js falls back to MediaBox when CropBox has no positive-area
  // intersection with it.
  const disjointPage = sourceDocument.addPage([200, 100]);
  disjointPage.setMediaBox(0, 0, 200, 100);
  disjointPage.setCropBox(300, 300, 20, 20);
  inputs.push({
    mediaBox: { left: 0, bottom: 0, right: 200, top: 100 },
    cropBox: { left: 300, bottom: 300, right: 320, top: 320 },
    rotation: 0,
    userUnit: 1
  });

  const bytes = await sourceDocument.save({ useObjectStreams: false });
  const loadingTask = getDocument({ data: new Uint8Array(bytes) });
  const pdf = await loadingTask.promise;
  try {
    assert.equal(pdf.numPages, inputs.length);
    for (let index = 0; index < inputs.length; index += 1) {
      const page = await pdf.getPage(index + 1);
      const viewport = page.getViewport({
        scale: 1,
        rotation: page.rotate,
        dontFlip: false
      });
      const [a, b, c, d, e, f] = viewport.transform;
      const expectedMatrix = [a, -b, c, -d, e, viewport.height - f];
      const actual = computeGeometry(inputs[index]);

      assertNumbersClose(actual.pageMatrix, expectedMatrix, `page ${index + 1} matrix`);
      assertNumbersClose(
        boundsArray(actual.pageBounds),
        transformedBounds(page.view, expectedMatrix),
        `page ${index + 1} bounds`
      );
    }
  } finally {
    await loadingTask.destroy();
  }
}

async function testWorkerFallback(workerHarness) {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([100, 100]);
  const annotation = document.context.register(document.context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: [0, 0, 10, 10]
  }));
  page.node.set(PDFName.Annots, document.context.obj([annotation]));

  const resultMessage = await workerHarness.compile(
    await document.save({ useObjectStreams: false })
  );
  assert.equal(resultMessage.message.type, "result");
  assert.equal(resultMessage.message.result.kind, "fallback");
  assert.equal(resultMessage.message.result.reason, "annotations");
  assert.deepEqual(resultMessage.transfer, []);
  assertMonotonicProgress(workerHarness.messages);
  assert.equal(
    workerHarness.messages.some(({ message }) => message.type === "result" && "pages" in message),
    false,
    "fallback must not expose partially compiled pages"
  );
}

async function testMixedPageAtomicFallback(workerHarness) {
  const document = await PDFDocument.create({ updateMetadata: false });
  const eligiblePage = document.addPage([100, 100]);
  const eligibleContent = document.context.register(
    document.context.stream(new TextEncoder().encode("0 0 m 10 10 l S\n"))
  );
  eligiblePage.node.set(PDFName.Contents, eligibleContent);

  const unsupportedPage = document.addPage([100, 100]);
  const annotation = document.context.register(document.context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: [0, 0, 10, 10]
  }));
  unsupportedPage.node.set(PDFName.Annots, document.context.obj([annotation]));

  const resultMessage = await workerHarness.compile(
    await document.save({ useObjectStreams: false })
  );
  assert.equal(resultMessage.message.type, "result");
  assert.equal(resultMessage.message.result.kind, "fallback");
  assert.equal(resultMessage.message.result.reason, "annotations");
  assert.equal("pages" in resultMessage.message.result, false);
  assert.deepEqual(resultMessage.transfer, []);
  assertMonotonicProgress(workerHarness.messages);
}

async function testTextMiniResourceFallback(workerHarness) {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([100, 100]);
  const content = document.context.register(document.context.stream(
    new TextEncoder().encode("BT /MissingFont 12 Tf (fallback) Tj ET\n")
  ));
  page.node.set(PDFName.Contents, content);

  const resultMessage = await workerHarness.compile(
    await document.save({ useObjectStreams: false })
  );
  assert.equal(resultMessage.message.type, "result");
  assert.equal(resultMessage.message.result.kind, "fallback");
  assert.equal(resultMessage.message.result.reason, "unsupported-resource");
  assert.match(resultMessage.message.result.message, /MissingFont/);
  assert.equal("pages" in resultMessage.message.result, false);
  assert.deepEqual(resultMessage.transfer, []);
  assertMonotonicProgress(workerHarness.messages);
}

async function testWorkerSuccessAndProgress(workerHarness) {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([100, 80]);
  const content = document.context.register(
    document.context.stream(new TextEncoder().encode("0 0 m 10 10 l S\n"))
  );
  page.node.set(PDFName.Contents, content);

  const resultMessage = await workerHarness.compile(
    await document.save({ useObjectStreams: false })
  );
  assert.equal(resultMessage.message.type, "result");
  const result = resultMessage.message.result;
  assert.equal(result.kind, "success");
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].compiled.segmentCount, 1);
  assert.ok(result.textMiniPdfBytes.length > 0);
  assert.ok(result.timing.preflightMs >= 0);
  assert.ok(result.timing.decodeMs >= 0);
  assert.ok(result.timing.compileMs >= 0);
  assert.ok(result.timing.textMiniPdfMs >= 0);

  assert.ok(resultMessage.transfer.length > 1);
  assert.ok(resultMessage.transfer.includes(result.textMiniPdfBytes.buffer));
  assert.ok(resultMessage.transfer.includes(result.pages[0].compiled.endpoints.buffer));
  assert.equal(new Set(resultMessage.transfer).size, resultMessage.transfer.length);

  const progress = assertMonotonicProgress(workerHarness.messages);
  assert.equal(progress.at(-1).value, 1);
  for (const stage of ["pdf-fast-check", "pdf-fast-decode", "pdf-operators", "compile"]) {
    assert.ok(progress.some((event) => event.stage === stage), `missing ${stage} progress`);
  }

  const firstPayload = workerHarness.messages.findIndex(({ message }) => message.type === "result");
  assert.equal(firstPayload, workerHarness.messages.length - 1);
  assert.ok(
    workerHarness.messages.slice(0, firstPayload).every(({ message }) => message.type === "progress"),
    "compiled pages must be posted atomically in the final result"
  );
}

async function testClient(compileDensePdfInWorker) {
  restoreGlobal("Worker", undefined);
  const unavailable = await compileDensePdfInWorker(new Uint8Array([1]));
  assert.equal(unavailable.kind, "fallback");
  assert.equal(unavailable.reason, "worker-unavailable");

  const workerInstances = [];
  let behavior = "success";
  class MockWorker {
    listeners = new Map();
    terminated = false;
    request = null;
    transfer = null;

    constructor() {
      workerInstances.push(this);
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
      this.listeners.get(type)?.delete(listener);
    }

    postMessage(request, transfer) {
      this.request = request;
      this.transfer = transfer;
      if (behavior === "hold") {
        return;
      }
      queueMicrotask(() => {
        if (behavior === "fallback") {
          this.emit("message", {
            data: {
              type: "result",
              result: { kind: "fallback", reason: "unsupported-content", message: "nope" }
            }
          });
          return;
        }
        this.emit("message", {
          data: {
            type: "progress",
            progress: {
              value: 0.4,
              stage: "pdf-operators",
              executionPath: "dense-vector-worker",
              sourceType: "pdf"
            }
          }
        });
        this.emit("message", {
          data: {
            type: "result",
            result: {
              kind: "success",
              sourcePageCount: 1,
              pages: [],
              textMiniPdfBytes: new Uint8Array([9]),
              timing: {
                preflightMs: 1,
                decodeMs: 2,
                compileMs: 3,
                textMiniPdfMs: 4,
                totalMs: 10
              }
            }
          }
        });
      });
    }

    emit(type, event) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(event);
      }
    }

    terminate() {
      this.terminated = true;
    }
  }
  setGlobal("Worker", MockWorker);

  const backing = new Uint8Array([99, 1, 2, 3, 99]);
  const source = backing.subarray(1, 4);
  const progress = [];
  const success = await compileDensePdfInWorker(source, {
    pages: "1",
    onProgress: (event) => progress.push(event)
  });
  assert.equal(success.kind, "success");
  assert.deepEqual([...source], [1, 2, 3], "caller bytes must remain attached and unchanged");
  const successWorker = workerInstances.at(-1);
  assert.notEqual(successWorker.request.pdfBytes, source);
  assert.deepEqual([...successWorker.request.pdfBytes], [1, 2, 3]);
  assert.deepEqual(successWorker.transfer, [successWorker.request.pdfBytes.buffer]);
  assert.equal(successWorker.request.options.pages, "1");
  assert.equal(successWorker.terminated, true);
  assert.deepEqual(progress.map(({ value }) => value), [0.4]);

  behavior = "fallback";
  const fallback = await compileDensePdfInWorker(new Uint8Array([4, 5]));
  assert.equal(fallback.kind, "fallback");
  assert.equal(fallback.reason, "unsupported-content");
  assert.equal(workerInstances.at(-1).terminated, true);

  behavior = "hold";
  const controller = new AbortController();
  const abortReason = new DOMException("cancel test", "AbortError");
  const pending = compileDensePdfInWorker(new Uint8Array([6]), {
    signal: controller.signal
  });
  const abortWorker = workerInstances.at(-1);
  controller.abort(abortReason);
  await assert.rejects(pending, (error) => error === abortReason);
  assert.equal(abortWorker.terminated, true);
}

async function loadWorkerEntry(testName) {
  let messageListener = null;
  const messages = [];
  let resolveResult;
  const resultPromise = new Promise((resolve) => {
    resolveResult = resolve;
  });
  const scope = {
    addEventListener(type, listener) {
      if (type === "message") {
        messageListener = listener;
      }
    },
    postMessage(message, transfer = []) {
      const entry = { message, transfer };
      messages.push(entry);
      if (message.type === "result") {
        resolveResult(entry);
      }
    }
  };
  setGlobal("self", scope);
  const module = await import(
    new URL(`../src/densePdfFastWorker.ts?worker-test=${testName}`, import.meta.url)
  );
  restoreGlobal("self", originalSelfDescriptor);
  assert.equal(typeof messageListener, "function");

  return {
    module,
    messages,
    async compile(pdfBytes) {
      messageListener({
        data: {
          type: "compile",
          pdfBytes: new Uint8Array(pdfBytes),
          options: { enableSegmentMerge: true, enableInvisibleCull: true }
        }
      });
      let timeoutId;
      try {
        return await Promise.race([
          resultPromise,
          new Promise((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error(`${testName} worker timed out`)),
              5_000
            );
          })
        ]);
      } finally {
        clearTimeout(timeoutId);
      }
    }
  };
}

function assertMonotonicProgress(messages) {
  const events = messages
    .filter(({ message }) => message.type === "progress")
    .map(({ message }) => message.progress);
  assert.ok(events.length >= 2);
  for (let index = 0; index < events.length; index += 1) {
    assert.ok(events[index].value >= 0 && events[index].value <= 1);
    assert.equal(events[index].executionPath, "dense-vector-worker");
    assert.equal(events[index].sourceType, "pdf");
    if (index > 0) {
      assert.ok(events[index].value >= events[index - 1].value, "progress must be monotonic");
    }
  }
  return events;
}

function transformedBounds(box, matrix) {
  const points = [
    transformPoint(matrix, box[0], box[1]),
    transformPoint(matrix, box[0], box[3]),
    transformPoint(matrix, box[2], box[1]),
    transformPoint(matrix, box[2], box[3])
  ];
  return [
    Math.min(...points.map(([x]) => x)),
    Math.min(...points.map(([, y]) => y)),
    Math.max(...points.map(([x]) => x)),
    Math.max(...points.map(([, y]) => y))
  ];
}

function transformPoint(matrix, x, y) {
  return [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5]
  ];
}

function boundsArray(bounds) {
  return [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY];
}

function assertNumbersClose(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label} length`);
  for (let index = 0; index < actual.length; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= 1e-8,
      `${label}[${index}]: expected ${expected[index]}, received ${actual[index]}`
    );
  }
}

function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value
  });
}

function restoreGlobal(name, descriptor) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    delete globalThis[name];
  }
}
