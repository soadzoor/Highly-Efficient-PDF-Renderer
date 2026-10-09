import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

Promise.try ??= (callback, ...args) => Promise.resolve().then(() => callback(...args));
Uint8Array.prototype.toHex ??= function toHex() {
  return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("hex");
};
Uint8Array.prototype.toBase64 ??= function toBase64() {
  return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("base64");
};
Uint8Array.fromHex ??= (value) => new Uint8Array(Buffer.from(value, "hex"));
Uint8Array.fromBase64 ??= (value) => new Uint8Array(Buffer.from(value, "base64"));

function createMinimalPdfBytes() {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources <<>> /Contents 4 0 R >>\nendobj\n",
    "4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += object;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRootDir = path.resolve(scriptDir, "..");

// Middleware mode transforms TypeScript without listening on a port.
const viteServer = await createServer({
  configFile: false,
  root: repoRootDir,
  logLevel: "error",
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true },
  appType: "custom"
});

try {
  const [zipBuilder, pdfObjectGenerator] = await Promise.all([
    viteServer.ssrLoadModule("/src/hepBuilder.ts"),
    viteServer.ssrLoadModule("/src/pdfObjectGenerator.ts")
  ]);

  const originalFetch = globalThis.fetch;
  const fetchController = new AbortController();
  let receivedFetchSignal = null;
  let resolveFetchStarted;
  const fetchStarted = new Promise(resolve => { resolveFetchStarted = resolve; });
  try {
    globalThis.fetch = (_input, init) => {
      receivedFetchSignal = init?.signal ?? null;
      resolveFetchStarted();
      return new Promise((_resolve, reject) => {
        receivedFetchSignal?.addEventListener(
          "abort",
          () => reject(receivedFetchSignal.reason),
          { once: true }
        );
      });
    };

    const pendingExport = zipBuilder.buildHep(
      "https://example.test/slow.pdf",
      { signal: fetchController.signal }
    );
    await Promise.race([
      fetchStarted,
      pendingExport.then(() => {
        throw new Error("HEP export completed before starting the mocked PDF fetch.");
      })
    ]);
    assert.equal(receivedFetchSignal, fetchController.signal);
    fetchController.abort();
    await assert.rejects(pendingExport, (error) => error?.name === "AbortError");
  } finally {
    globalThis.fetch = originalFetch;
  }

  const parseController = new AbortController();
  let reachedContentDecode = false;
  const pendingParse = pdfObjectGenerator.loadPdfSceneFromSource(
    createMinimalPdfBytes(),
    {
      sourceKind: "pdf",
      onProgress: (event) => {
        // A small page compiles between progress yields, so the first
        // deterministic point inside the worker is where its content starts.
        if (event.stage === "pdf-operators" && !parseController.signal.aborted) {
          reachedContentDecode = true;
          parseController.abort();
        }
      }
    },
    parseController.signal
  );
  await assert.rejects(pendingParse, (error) => error?.name === "AbortError");
  assert.equal(reachedContentDecode, true, "the test must abort once the worker starts decoding page content");

  console.log("PDF source cancellation smoke test passed.");
} finally {
  await viteServer.close();
}
