import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const scratch = await mkdtemp(resolve(tmpdir(), "hepr-node-thumbnail-"));
const globals = new Map(["Worker", "document", "OffscreenCanvas"].map(name => [name, globalThis[name]]));
const workerOptions = {
  workerUrl: sourceWorkerBootstrapUrl(new URL("../src/pdf/pdfWorkerEntry.ts", import.meta.url)),
  encoderWorkerUrl: sourceWorkerBootstrapUrl(new URL("../src/nodeThumbnailEncodeWorker.ts", import.meta.url))
};
let activeSession;
try {
  const { renderPdfThumbnail, openDocumentSession } = await import("../src/nodePdfSource.ts");
  const { loadSceneFromHep } = await import("../src/hepReader.ts");
  assert.equal(typeof renderPdfThumbnail, "function", "the Node entry exports the one-shot thumbnail API");
  assert.equal(typeof openDocumentSession, "function", "the Node entry exports reusable document sessions");
  const pdf = pageFixture(), original = pdf.slice();
  const path = resolve(scratch, "drawing with spaces.pdf");
  await writeFile(path, pdf);
  const sources = [path, pathToFileURL(path), pathToFileURL(path).href, pdf, pdf.buffer.slice(0), Buffer.from(pdf)];
  for (const source of sources) {
    const timings = [];
    const result = await renderPdfThumbnail(source, { ...workerOptions, maxDimension: 40, format: "png",
      onTiming: timing => timings.push(timing) });
    assert(result.blob instanceof Blob);
    assert.deepEqual([result.width, result.height, result.blob.type], [20, 40, "image/png"], "local paths, file URLs and bytes preserve crop/rotation sizing");
    assert.deepEqual([...new Uint8Array(await result.blob.arrayBuffer()).subarray(0, 8)], [137,80,78,71,13,10,26,10]);
    assert(timings.some(timing => timing.stage === "total"));
  }
  assert.deepEqual(pdf, original, "Node thumbnail workers preserve caller-owned bytes");
  let rangeReads = 0, rangeCloses = 0;
  await renderPdfThumbnail({ kind: "range", byteLength: pdf.length,
    async read(offset, length, signal) { signal.throwIfAborted(); rangeReads++; return pdf.slice(offset, offset + length); },
    close() { rangeCloses++; } }, { ...workerOptions, maxDimension: 8, format: "png" });
  assert(rangeReads > 0, "explicit random-access PDF sources remain supported");
  assert.equal(rangeCloses, 1, "one-shot Node cleanup closes an owned source exactly once");
  const webp = await renderPdfThumbnail(pdf, { ...workerOptions, maxDimension: 16 });
  assert.equal(webp.blob.type, "image/webp");
  assert.equal(new TextDecoder().decode(new Uint8Array(await webp.blob.arrayBuffer()).subarray(12, 16)), "VP8L", "default WebP output uses a lossless bitstream");

  const cancelled = new AbortController(), reason = new Error("Node thumbnail removed");
  cancelled.abort(reason);
  await assert.rejects(renderPdfThumbnail(path, { ...workerOptions, signal: cancelled.signal }), error => error === reason);
  await assert.rejects(renderPdfThumbnail(path, { ...workerOptions, backend: "webgl" }), /WebGL|webgl|Canvas2D|canvas2d/);
  await assert.rejects(openDocumentSession(pdf, { ...workerOptions, sourceKind: "hep" }), /HEP|hep|PDF|pdf/);
  await assert.rejects(openDocumentSession(Uint8Array.of(72, 69, 80, 0, 1, 0, 0, 0), workerOptions), /HEP.*browser|Node.*PDF/);
  await assert.rejects(renderPdfThumbnail(path, { ...workerOptions, page: 0 }), RangeError);

  activeSession = await openDocumentSession(pathToFileURL(path), workerOptions);
  assert.equal(activeSession.info.sourceKind, "pdf");
  assert.equal(activeSession.info.pageCount, 2);
  assert.deepEqual(activeSession.info.pages[0], { width: 80, height: 160 });
  const blank = await activeSession.renderThumbnail({ page: 2, maxDimension: 8, background: "transparent", format: "png" });
  const { loadImage, createCanvas } = await import("@napi-rs/canvas");
  const image = await loadImage(Buffer.from(await blank.blob.arrayBuffer()));
  const canvas = createCanvas(8, 8), context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  assert(context.getImageData(0, 0, 8, 8).data.every(value => value === 0), "Node transparent blank pages retain alpha");
  const queuedCancellation = new AbortController();
  const first = activeSession.renderThumbnail({ maxDimension: 40, format: "png" });
  const queued = activeSession.renderThumbnail({ maxDimension: 24, signal: queuedCancellation.signal });
  queuedCancellation.abort(reason);
  await assert.rejects(queued, error => error === reason);
  await first;
  assert.equal((await activeSession.renderThumbnail({ maxDimension: 16 })).blob.type, "image/webp", "cancelling a queued thumbnail leaves the session usable");
  const exportOptions = { withVectorLod: false, withTextLod: false, encodeRasterImages: false, compression: "store" };
  const reused = await loadSceneFromHep(await (await activeSession.buildHep(exportOptions)).arrayBuffer());
  const freshSession = await openDocumentSession(pdf, workerOptions);
  try {
    const fresh = await loadSceneFromHep(await (await freshSession.buildHep(exportOptions)).arrayBuffer());
    assert.equal(reused.pageCount, 2);
    for (const key of ["endpoints", "fillSegmentsA", "fillSegmentsB", "pageRects", "textInstanceA", "textGlyphSegmentsA"]) {
      assert.deepEqual(reused[key], fresh[key], `thumbnail reuse preserves full-quality HEP ${key}`);
    }
  } finally { await freshSession.close(); }
  await activeSession.close(); await activeSession.close();
  await assert.rejects(activeSession.renderThumbnail(), error => error.code === "closed");
  await assert.rejects(activeSession.buildHep(), error => error.code === "closed");
  activeSession = undefined;

  // Pause an actual image decode, then cancel that operation. The host callback
  // observes cancellation and the parser session must recover for the next job.
  let entered, firstDecode = true;
  const decodeEntered = new Promise(resolve => { entered = resolve; });
  activeSession = await openDocumentSession(imageFixture(), { ...workerOptions,
    imageCodecResolver(_request, signal) {
      if (!firstDecode) return { width: 1, height: 1, components: 3, bitsPerComponent: 8, samples: Uint8Array.of(10, 80, 190) };
      firstDecode = false; entered();
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        if (signal.aborted) reject(signal.reason);
      });
    } });
  const inFlightCancellation = new AbortController();
  const inFlight = activeSession.renderThumbnail({ maxDimension: 16, signal: inFlightCancellation.signal });
  await withTimeout(decodeEntered, 10_000);
  inFlightCancellation.abort(reason);
  await assert.rejects(inFlight, error => error === reason);
  assert.equal((await activeSession.renderThumbnail({ maxDimension: 16, format: "png" })).blob.type, "image/png", "in-flight cancellation releases the operation and permits another thumbnail");
  await activeSession.close(); activeSession = undefined;
  for (const [name, value] of globals) assert.equal(globalThis[name], value, `the Node API must not install a global ${name} shim`);
  console.log("Node PDF thumbnails: paths/file URLs/bytes, crop/rotation, lossless WebP/PNG, transparency, queued/in-flight cancellation, reusable canonical HEP output and cleanup passed.");
} finally {
  await activeSession?.close();
  hooks.deregister();
  await rm(scratch, { recursive: true, force: true });
}

function sourceWorkerBootstrapUrl(entryUrl) {
  const source = `import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\\.\\.?\\//.test(specifier) && !/\\.[a-z0-9]+(?:[?#]|$)/i.test(specifier) ? specifier + ".ts" : specifier, context);
} });
await import(${JSON.stringify(entryUrl.href)});`;
  return new URL(`data:text/javascript,${encodeURIComponent(source)}`);
}

function withTimeout(promise, milliseconds) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Node thumbnail image decode did not start.")), milliseconds);
    promise.then(value => { clearTimeout(timeout); resolve(value); }, error => { clearTimeout(timeout); reject(error); });
  });
}

function pageFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /CropBox [20 10 180 90] /Rotate 90 /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "1 0 0 rg 20 10 160 80 re f 0 0 1 rg 40 30 20 20 re f BT /F1 12 Tf 1 0 0 1 60 40 Tm (AB) Tj ET") },
    { number: 5, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 6 0 R >>" },
    { number: 6, body: tinyPdfStream("", "") },
    { number: 7, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" }
  ] });
}

function imageFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 10] /Resources << /XObject << /Im 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "q 20 0 0 10 0 0 cm /Im Do Q") },
    { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode", Uint8Array.of(0xff,0xd8,0xff,0xd9)) }
  ] });
}
