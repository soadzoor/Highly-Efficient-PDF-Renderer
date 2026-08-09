// Example-manifest URL and source-signature regressions.
//
// Vite runs in middleware mode only; this script never binds a network port.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";
import { createServer } from "vite";

import { encodeExampleAssetPathSegment } from "./example-asset-path.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRootDir = path.resolve(scriptDir, "..");

async function requestViteMiddleware(viteServer, url) {
  const request = new Readable({
    read() {
      this.push(null);
    }
  });
  request.url = url;
  request.originalUrl = url;
  request.method = "GET";
  request.headers = { accept: "*/*" };

  const chunks = [];
  const responseHeaders = new Map();
  const response = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    }
  });
  response.statusCode = 200;
  response.setHeader = (name, value) => {
    responseHeaders.set(String(name).toLowerCase(), value);
    return response;
  };
  response.getHeader = (name) => responseHeaders.get(String(name).toLowerCase());
  response.getHeaders = () => Object.fromEntries(responseHeaders);
  response.hasHeader = (name) => responseHeaders.has(String(name).toLowerCase());
  response.removeHeader = (name) => responseHeaders.delete(String(name).toLowerCase());
  response.writeHead = (statusCode, statusMessageOrHeaders, headers) => {
    response.statusCode = statusCode;
    const values = typeof statusMessageOrHeaders === "string" ? headers : statusMessageOrHeaders;
    if (values) {
      for (const [name, value] of Object.entries(values)) {
        response.setHeader(name, value);
      }
    }
    return response;
  };

  await new Promise((resolve, reject) => {
    response.once("finish", resolve);
    response.once("error", reject);
    viteServer.middlewares.handle(request, response, (error) => {
      if (error) {
        reject(error);
      } else if (!response.writableEnded) {
        response.statusCode = response.statusCode === 200 ? 404 : response.statusCode;
        response.end();
      }
    });
  });

  return {
    status: response.statusCode,
    headers: Object.fromEntries(responseHeaders),
    body: Buffer.concat(chunks)
  };
}

async function run() {
  const validNames = new Map([
    ["a+b.pdf", "a+b.pdf"],
    ["a b.pdf", "a%20b.pdf"],
    ["Grüße 文.pdf", "Gr%C3%BC%C3%9Fe%20%E6%96%87.pdf"],
    ["100%.pdf", "100%25.pdf"],
    ["a&b=c,$@d.pdf", "a&b=c,$@d.pdf"],
    ["[draft].pdf", "%5Bdraft%5D.pdf"],
    ["a%2Bb.pdf", "a%252Bb.pdf"]
  ]);
  for (const [fileName, expected] of validNames) {
    const encoded = encodeExampleAssetPathSegment(fileName);
    assert.equal(encoded, expected);
    const pathname = new URL(`examples/pdfs/${encoded}`, "http://example.test/").pathname;
    assert.equal(decodeURI(pathname), `/examples/pdfs/${fileName}`);
  }
  for (const invalidName of ["", ".", "..", "a/b.pdf", "a\\b.pdf", "a?b.pdf", "a#b.pdf", "a\u0000b.pdf"]) {
    assert.throws(() => encodeExampleAssetPathSegment(invalidName), /Unsupported public asset filename/);
  }

  const manifestPath = path.join(repoRootDir, "public/examples/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const brochure = manifest.examples.find((entry) => entry.name.includes("Broschuere_Leo_B2C"));
  assert.ok(brochure, "brochure example must be present in the generated manifest");
  assert.equal(
    brochure.pdf.path,
    "examples/pdfs/20260415+Broschuere_Leo_B2C_RZ+(online+reduz).pdf"
  );
  assert.doesNotMatch(brochure.pdf.path, /%2B/i);

  const viteServer = await createServer({
    configFile: false,
    root: repoRootDir,
    publicDir: "public",
    base: "/",
    logLevel: "error",
    appType: "spa",
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true }
  });

  try {
    const requestPath = new URL(brochure.pdf.path, "http://example.test/").pathname;
    const servedPdf = await requestViteMiddleware(viteServer, requestPath);
    assert.equal(servedPdf.status, 200);
    assert.match(String(servedPdf.headers["content-type"]), /^application\/pdf\b/i);
    assert.equal(servedPdf.body.length, brochure.pdf.sizeBytes);
    assert.equal(servedPdf.body.subarray(0, 5).toString("ascii"), "%PDF-");

    const [
      { assertPdfBytes, hasPdfHeader },
      { readPdfDownloadBlob },
      { loadPdfSceneFromSource },
      { extractPdfPageScenes }
    ] = await Promise.all([
      viteServer.ssrLoadModule("/src/pdfSignature.ts"),
      viteServer.ssrLoadModule("/src/downloadUtils.ts"),
      viteServer.ssrLoadModule("/src/pdfObjectGenerator.ts"),
      viteServer.ssrLoadModule("/src/pdfVectorExtractor.ts")
    ]);
    const prefixedPdf = new Uint8Array([0, 1, 2, 0x25, 0x50, 0x44, 0x46, 0x2d]);
    assert.doesNotThrow(() => assertPdfBytes(prefixedPdf, { contentType: "application/octet-stream" }));
    assert.doesNotThrow(() => assertPdfBytes(prefixedPdf, { contentType: "text/html" }));

    const htmlFallback = await requestViteMiddleware(viteServer, "/index.html");
    assert.equal(htmlFallback.status, 200);
    assert.match(String(htmlFallback.headers["content-type"]), /^text\/html\b/i);
    assert.throws(
      () => assertPdfBytes(htmlFallback.body, { label: "/index.html", contentType: "text/html" }),
      /received HTML instead.*fallback page/i
    );
    await assert.rejects(
      readPdfDownloadBlob({
        label: "HTML fallback",
        blob: new Blob([htmlFallback.body], { type: "text/html" })
      }),
      /received HTML instead.*fallback page/i
    );
    await assert.rejects(
      extractPdfPageScenes(Uint8Array.from(htmlFallback.body).buffer),
      /received HTML instead.*fallback page/i
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(htmlFallback.body, { status: 200, headers: { "content-type": "text/html" } });
    try {
      await assert.rejects(
        loadPdfSceneFromSource("https://example.test/fallback.pdf"),
        /received HTML instead.*fallback page/i
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    const ambiguousZip = new JSZip();
    ambiguousZip.file("source.pdf", "%PDF-1.4\n");
    const ambiguousZipBytes = await ambiguousZip.generateAsync({ type: "uint8array", compression: "STORE" });
    assert.equal(hasPdfHeader(ambiguousZipBytes), true, "fixture must contain a PDF header in its first 1 KiB");
    await assert.rejects(
      loadPdfSceneFromSource(ambiguousZipBytes),
      /Parsed data zip is missing manifest\.json/,
      "ZIP magic must take precedence over an embedded PDF signature"
    );

    console.log("Example asset regressions passed");
  } finally {
    await viteServer.close();
  }
}

run().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
