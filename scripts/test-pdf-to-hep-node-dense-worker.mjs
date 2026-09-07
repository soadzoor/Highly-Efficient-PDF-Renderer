import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
delete globalThis.Worker;

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.includes("/src/") &&
      /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const client = await import("../src/densePdfFastWorkerClient.ts");

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
  assert.equal(success.structureBackend, "hepr-native");
  assert.equal(success.pages.length, 1);
  assert.equal(success.pages[0].compiled.segmentCount, 1);
  assert.deepEqual(success.pages[0].compiled.referencedXObjects, ["EmptyForm"]);
  assert.equal(success.textMiniPdfBytes.length, 0);
  assert.equal(success.timing.textMiniPdfMs, 0);
  assert.equal(success.nativeTextScenes, undefined);
  assert.equal(success.timing.nativeTextMs, 0);
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

  assert.equal(
    Object.hasOwn(globalThis, "Worker"),
    false,
    "the Node dense client must not install a global Worker shim"
  );
  console.log("Direct Node dense worker success, fallback, ownership, and abort tests passed.");
} finally {
  restoreGlobal("Worker", originalWorker);
  hooks.deregister();
}

function createEligiblePdf() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 80] /Resources << /XObject << /EmptyForm 5 0 R >> >> /Contents 4 0 R >>"
      },
      { number: 4, body: tinyPdfStream("", "0 0 m 10 10 l S /EmptyForm Do\n") },
      {
        number: 5,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Resources << >>",
          "q Q\n"
        )
      }
    ]
  });
}

function createAnnotatedPdf() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 80] /Resources << >> /Annots [4 0 R] >>"
      },
      { number: 4, body: "<< /Type /Annot /Subtype /Text /Rect [0 0 10 10] >>" }
    ]
  });
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

function restoreGlobal(name, descriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}
