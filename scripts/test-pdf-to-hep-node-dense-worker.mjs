import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";

import { PDFDocument, PDFName } from "pdf-lib";
import { createServer } from "vite";

import { installNodeDensePdfWorkerSupport } from "../PDFtoHEP.js";

await testNodeWorkerAdapterLifecycle();

const viteServer = await createServer({
  configFile: false,
  root: fileURLToPath(new URL("..", import.meta.url)),
  logLevel: "error",
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true },
  appType: "custom"
});
let restoreWorker = () => {};

try {
  const client = await viteServer.ssrLoadModule(
    "/src/densePdfFastWorkerClient.ts?pdf-to-hep-node-worker-test"
  );
  restoreWorker = installNodeDensePdfWorkerSupport(1_024);

  const eligibleBytes = await createEligiblePdf();
  const backing = new Uint8Array(eligibleBytes.length + 2);
  backing[0] = 99;
  backing.set(eligibleBytes, 1);
  backing[backing.length - 1] = 100;
  const source = backing.subarray(1, backing.length - 1);
  const sourceSnapshot = new Uint8Array(source);
  const progress = [];
  const success = await compileWithTimeout(client.compileDensePdfInWorker, source, {
    onProgress: (event) => progress.push(event)
  });

  assert.equal(success.kind, "success");
  assert.equal(success.pages.length, 1);
  assert.equal(success.pages[0].compiled.segmentCount, 1);
  assert.deepEqual(success.pages[0].compiled.referencedXObjects, ["EmptyForm"]);
  assert.ok(success.textMiniPdfBytes.length > 0);
  assert.deepEqual(source, sourceSnapshot, "the caller-owned PDF bytes must remain intact");
  assertMonotonicDenseProgress(progress);

  const fallbackProgress = [];
  const fallback = await compileWithTimeout(
    client.compileDensePdfInWorker,
    await createAnnotatedPdf(),
    {
      onProgress: (event) => fallbackProgress.push(event)
    }
  );
  assert.equal(fallback.kind, "fallback");
  assert.equal(fallback.reason, "annotations");
  assert.notEqual(fallback.reason, "worker-unavailable");
  assertMonotonicDenseProgress(fallbackProgress);

  const controller = new AbortController();
  const abortReason = new DOMException("synthetic Node worker abort", "AbortError");
  const pending = client.compileDensePdfInWorker(eligibleBytes, {
    signal: controller.signal
  });
  controller.abort(abortReason);
  await assert.rejects(pending, (error) => error === abortReason);

  console.log("PDF-to-HEP Node dense worker success, fallback, and abort tests passed.");
} finally {
  restoreWorker();
  await viteServer.close();
}

async function testNodeWorkerAdapterLifecycle() {
  const instances = [];
  class FakeNodeWorker extends EventEmitter {
    constructor(url, options) {
      super();
      this.url = url;
      this.options = options;
      this.messages = [];
      this.terminated = false;
      instances.push(this);
    }

    postMessage(value, transfer) {
      this.messages.push({ value, transfer });
    }

    terminate() {
      this.terminated = true;
      return Promise.resolve(0);
    }
  }

  const restoreWorker = installNodeDensePdfWorkerSupport(2_048, {
    WorkerImplementation: FakeNodeWorker,
    bootstrapUrl: new URL("file:///synthetic-bootstrap.mjs")
  });
  try {
    const worker = new globalThis.Worker(
      new URL("file:///synthetic-dense-worker.ts"),
      { name: "synthetic-dense" }
    );
    const instance = instances[0];
    assert.equal(instance.options.workerData.moduleUrl, "file:///synthetic-dense-worker.ts");
    assert.deepEqual(instance.options.execArgv, ["--experimental-strip-types"]);
    assert.deepEqual(instance.options.resourceLimits, { maxOldGenerationSizeMb: 2_048 });
    assert.equal(instance.options.name, "synthetic-dense");

    const messages = [];
    const messageErrors = [];
    const errors = [];
    const onMessage = (event) => messages.push(event.data);
    worker.addEventListener("message", onMessage);
    worker.addEventListener("messageerror", (event) => messageErrors.push(event.data));
    worker.addEventListener("error", (event) => {
      event.preventDefault();
      errors.push(event.error);
    });

    worker.postMessage({ hello: "worker" }, []);
    assert.deepEqual(instance.messages, [{ value: { hello: "worker" }, transfer: [] }]);
    instance.emit("message", { type: "progress", progress: { value: 0.5 } });
    assert.deepEqual(messages, [{ type: "progress", progress: { value: 0.5 } }]);
    worker.removeEventListener("message", onMessage);
    instance.emit("message", { ignored: true });
    assert.equal(messages.length, 1);

    const cloneError = new Error("synthetic clone error");
    instance.emit("messageerror", cloneError);
    assert.deepEqual(messageErrors, [cloneError]);

    instance.emit("exit", 7);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /before returning a result \(code 7\)/);

    // The adapter's permanent EventEmitter error listener must prevent an
    // unhandled Node "error" event even after browser-style listeners change.
    instance.emit("error", new Error("synthetic worker error"));
    assert.equal(errors.length, 2);
    worker.terminate();
    assert.equal(instance.terminated, true);
  } finally {
    restoreWorker();
  }
}

async function createEligiblePdf() {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([100, 80]);
  const emptyForm = document.context.register(document.context.stream(
    new TextEncoder().encode("q Q\n"),
    {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, 10, 10],
      Resources: {}
    }
  ));
  page.node.Resources().set(
    PDFName.XObject,
    document.context.obj({ EmptyForm: emptyForm })
  );
  page.node.set(
    PDFName.Contents,
    document.context.register(
      document.context.stream(
        new TextEncoder().encode("0 0 m 10 10 l S /EmptyForm Do\n")
      )
    )
  );
  return new Uint8Array(await document.save({ useObjectStreams: false }));
}

async function createAnnotatedPdf() {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([100, 80]);
  const annotation = document.context.register(document.context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: [0, 0, 10, 10]
  }));
  page.node.set(PDFName.Annots, document.context.obj([annotation]));
  return new Uint8Array(await document.save({ useObjectStreams: false }));
}

function assertMonotonicDenseProgress(progress) {
  assert.ok(progress.length >= 2);
  for (let index = 0; index < progress.length; index += 1) {
    assert.equal(progress[index].executionPath, "dense-vector-worker");
    assert.equal(progress[index].sourceType, "pdf");
    assert.ok(progress[index].value >= 0 && progress[index].value <= 1);
    if (index > 0) {
      assert.ok(progress[index].value >= progress[index - 1].value);
    }
  }
}

async function compileWithTimeout(compile, pdfBytes, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error("Node dense worker test timed out."));
  }, 10_000);
  try {
    return await compile(pdfBytes, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
