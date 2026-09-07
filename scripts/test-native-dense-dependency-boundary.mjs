import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import { writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const originalSelf = Object.getOwnPropertyDescriptor(globalThis, "self");
const forbiddenImports = [];
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "pdf-lib" || specifier.startsWith("pdfjs-dist")) {
      forbiddenImports.push({ specifier, parentURL: context.parentURL });
      throw new Error(`Native dense parsing imported ${specifier}.`);
    }
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
  let messageListener;
  let resolveResult;
  const resultPromise = new Promise((resolve) => {
    resolveResult = resolve;
  });
  Object.defineProperty(globalThis, "self", {
    configurable: true,
    value: {
      addEventListener(type, listener) {
        if (type === "message") messageListener = listener;
      },
      postMessage(message) {
        if (message.type === "result") resolveResult(message.result);
      }
    }
  });
  await import("../src/densePdfFastWorker.ts?native-dependency-boundary");
  restoreGlobal("self", originalSelf);
  assert.equal(typeof messageListener, "function");

  messageListener({
    data: {
      type: "compile",
      pdfBytes: annotatedPdf(),
      options: {
        enableSegmentMerge: true,
        enableInvisibleCull: true
      }
    }
  });
  let timeoutId;
  const result = await Promise.race([
    resultPromise,
    new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("Native dependency-boundary worker timed out.")),
        5_000
      );
    })
  ]).finally(() => clearTimeout(timeoutId));
  assert.equal(result.kind, "fallback");
  assert.equal(result.reason, "annotations");
  assert.deepEqual(forbiddenImports, []);
  console.log("native dense dependency boundary test passed");
} finally {
  hooks.deregister();
  restoreGlobal("self", originalSelf);
}

function annotatedPdf() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 80] " +
          "/Resources << >> /Annots [4 0 R] >>"
      },
      { number: 4, body: "<< /Type /Annot /Subtype /Text /Rect [0 0 10 10] >>" }
    ]
  });
}

function restoreGlobal(name, descriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}
