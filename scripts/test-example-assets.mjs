// Example-manifest URL and source-signature regressions.
//
// Vite runs in middleware mode only; this script never binds a network port.

import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
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
  assert.ok(manifest.examples.length > 0, "example manifest must not be empty");
  for (const entry of manifest.examples) {
    assert.match(entry.parsedZip.path, /\.hep$/i, `${entry.name} must use the canonical .hep extension`);
    const hepAssetPath = decodeURIComponent(entry.parsedZip.path);
    const hepStat = await stat(path.join(repoRootDir, "public", hepAssetPath));
    assert.equal(hepStat.size, entry.parsedZip.sizeBytes, `${entry.name} HEP size must match the manifest`);
  }

  for (const htmlName of ["index.html", "three-example.html", "room-overlay-demo.html"]) {
    const html = await readFile(path.join(repoRootDir, htmlName), "utf8");
    const accept = html.match(/<input\b(?=[^>]*\bid="file-input")[^>]*\baccept="([^"]+)"/i)?.[1];
    assert.ok(accept, `${htmlName} must define a file-input accept filter`);
    assert.match(accept, /(?:^|,)\.hep(?:,|$)/i, `${htmlName} must advertise .hep files`);
    assert.doesNotMatch(accept, /(?:\.zip|application\/(?:x-)?zip)/i, `${htmlName} must not advertise generic ZIP files`);
  }

  for (const sourceName of ["src/main.ts", "src/three-example.ts"]) {
    const source = await readFile(path.join(repoRootDir, sourceName), "utf8");
    assert.match(source, /-parsed-data\.hep/, `${sourceName} must export .hep filenames`);
    assert.doesNotMatch(source, /-parsed-data\.zip/, `${sourceName} must not export .zip filenames`);
  }
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

    const smallestHep = manifest.examples.reduce((smallest, entry) =>
      entry.parsedZip.sizeBytes < smallest.parsedZip.sizeBytes ? entry : smallest
    );
    const hepRequestPath = new URL(smallestHep.parsedZip.path, "http://example.test/").pathname;
    const servedHep = await requestViteMiddleware(viteServer, hepRequestPath);
    assert.equal(servedHep.status, 200);
    assert.equal(servedHep.body.length, smallestHep.parsedZip.sizeBytes);
    assert.equal(servedHep.body.subarray(0, 2).toString("ascii"), "PK");

    const [
      { assertPdfBytes, hasPdfHeader },
      { formatPdfDownloadFilename, readPdfDownloadBlob },
      { loadPdfSceneFromSource },
      { loadSceneFromParsedDataZip },
      { extractPdfPageScenes }
    ] = await Promise.all([
      viteServer.ssrLoadModule("/src/pdfSignature.ts"),
      viteServer.ssrLoadModule("/src/downloadUtils.ts"),
      viteServer.ssrLoadModule("/src/pdfObjectGenerator.ts"),
      viteServer.ssrLoadModule("/src/parsedDataZip.ts"),
      viteServer.ssrLoadModule("/src/pdfVectorExtractor.ts")
    ]);
    const prefixedPdf = new Uint8Array([0, 1, 2, 0x25, 0x50, 0x44, 0x46, 0x2d]);
    assert.doesNotThrow(() => assertPdfBytes(prefixedPdf, { contentType: "application/octet-stream" }));
    assert.doesNotThrow(() => assertPdfBytes(prefixedPdf, { contentType: "text/html" }));
    assert.equal(formatPdfDownloadFilename("floorplan.hep"), "floorplan.pdf");
    assert.equal(formatPdfDownloadFilename("floorplan-parsed-data.hep"), "floorplan.pdf");
    assert.equal(formatPdfDownloadFilename("floorplan.pdf (HEP)"), "floorplan.pdf");
    assert.equal(formatPdfDownloadFilename("legacy.zip"), "legacy.pdf");

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
      /not a valid HEP file.*Compressing a PDF into a ZIP does not create a HEP file/is,
      "ZIP magic must take precedence over an embedded PDF signature"
    );
    await assert.rejects(
      loadPdfSceneFromSource(new File(["%PDF-1.4\n"], "renamed-pdf.hep")),
      /Unable to open HEP file.*renaming or compressing a PDF does not create one/is,
      ".hep filenames must be recognized before byte-signature fallback"
    );

    const hepSource = new File([servedHep.body], "example.hep");
    const loadedHep = await loadPdfSceneFromSource(hepSource);
    assert.equal(loadedHep.sourceKind, "parsed-zip");
    assert.equal(loadedHep.sourceLabel, "example.hep");

    const progressCallbackError = new Error("progress callback sentinel");
    await assert.rejects(
      loadSceneFromParsedDataZip(Uint8Array.from(servedHep.body).buffer, {
        onProgress: (progress) => {
          if (progress.stage === "zip-open") {
            throw progressCallbackError;
          }
        }
      }),
      (error) => error === progressCallbackError,
      "HEP-open guidance must not replace consumer progress callback errors"
    );

    const legacyZipSource = new File([servedHep.body], "legacy-example.zip", {
      type: "application/zip"
    });
    const loadedLegacyZip = await loadPdfSceneFromSource(legacyZipSource);
    assert.equal(loadedLegacyZip.sourceKind, "parsed-zip");
    assert.equal(loadedLegacyZip.sourceLabel, "legacy-example.zip");

    console.log("Example asset regressions passed");
  } finally {
    await viteServer.close();
  }
}

run().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
