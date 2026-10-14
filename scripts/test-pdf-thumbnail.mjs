import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

try {
  const { renderPdfThumbnail, normalizeThumbnailOptions } = await import("../src/pdfThumbnail.ts");
  const { openDocumentSession } = await import("../src/documentSession.ts");
  const { loadSceneFromHep } = await import("../src/hepReader.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { thumbnailSize } = await import("../src/thumbnailTypes.ts");
  const pdf = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /CropBox [20 10 180 90] /Rotate 90 /Resources << >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "1 0 0 rg 20 10 160 80 re f 0 0 1 rg 40 30 20 20 re f") },
    { number: 5, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 6 0 R >>" },
    { number: 6, body: tinyPdfStream("", "") }
  ] });
  for (const invalid of [{ page: 0 }, { page: 1.2 }, { maxDimension: 0 }, { maxDimension: Infinity },
    { maxDimension: 1.5 }, { format: "jpeg" }, { backend: "webgpu" }, { background: "bad-color" }]) {
    await assert.rejects(renderPdfThumbnail(pdf, invalid));
  }
  const aborted = new AbortController(), reason = new Error("thumbnail cancelled before loading");
  aborted.abort(reason);
  await assert.rejects(renderPdfThumbnail(pdf, { signal: aborted.signal }), error => error === reason);
  assert.deepEqual(normalizeThumbnailOptions({ background: "transparent" }).background, [0, 0, 0, 0]);
  assert.deepEqual(normalizeThumbnailOptions({ background: "#abc" }).background, [170/255,187/255,204/255,1]);
  assert.deepEqual(normalizeThumbnailOptions({ background: "rebeccapurple" }).background, [102/255,51/255,153/255,1]);
  assert.equal(normalizeThumbnailOptions({ maxDimension: 8192 }).maxDimension, 8192, "no legacy preview dimension cap");
  assert.deepEqual(thumbnailSize(100, 200, 1), { width: 1, height: 1, scale: .005 });

  const original = pdf.slice(), timings = [];
  const result = await renderPdfThumbnail(pdf, { backend: "canvas2d", maxDimension: 40, format: "png", onTiming: timing => timings.push(timing) });
  assert.deepEqual(pdf, original, "caller bytes stay attached and unchanged");
  assert.deepEqual([result.width, result.height, result.blob.type], [20, 40, "image/png"], "crop and rotation determine output size");
  assert.equal(timings.filter(timing => timing.stage === "total").length, 1);
  assert(timings.every(timing => timing.durationMs >= 0));

  const session = await openDocumentSession(pdf);
  try {
    assert.equal(session.info.pageCount, 2);
    assert.equal(session.info.sourceKind, "pdf");
    assert.deepEqual(session.info.pages[0], { width: 80, height: 160 });
    await assert.rejects(session.renderThumbnail({ page: 3 }), /outside/);
    const cancelled = new AbortController(); cancelled.abort(reason);
    await assert.rejects(session.renderThumbnail({ signal: cancelled.signal }), error => error === reason);
    const small = await session.renderThumbnail({ backend: "canvas2d", maxDimension: 16 });
    assert.equal(small.blob.type, "image/webp", "default is true WebP when the bundled encoder is available");
    const blank = await session.renderThumbnail({ backend: "canvas2d", page: 2, background: "transparent", format: "png", maxDimension: 8 });
    const { loadImage, createCanvas } = await import("@napi-rs/canvas");
    const image = await loadImage(Buffer.from(await blank.blob.arrayBuffer()));
    const canvas = createCanvas(8, 8), context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
    assert(context.getImageData(0, 0, 8, 8).data.every(value => value === 0), "transparent blank pages remain transparent");
    await assert.rejects(session.buildHep({ password: "new policy" }), /fixed when opening/);
    const exportOptions = { withVectorLod: false, withTextLod: false, encodeRasterImages: false, compression: "store" };
    const reused = await loadSceneFromHep(await (await session.buildHep(exportOptions)).arrayBuffer());
    const fresh = await loadSceneFromHep(await (await buildHep(pdf, exportOptions)).arrayBuffer());
    for (const key of ["endpoints", "fillSegmentsA", "fillSegmentsB", "pageRects", "textInstanceA"]) {
      assert.deepEqual(reused[key], fresh[key], `thumbnail preparation does not change canonical ${key}`);
    }
    const hepSession = await openDocumentSession(await session.buildHep(exportOptions));
    try {
      assert.equal(hepSession.info.sourceKind, "hep"); assert.equal(hepSession.info.pageCount, 2);
      assert.equal((await hepSession.buildHep(exportOptions)).type, "application/x-hep");
    } finally { await hepSession.close(); }
  } finally { await session.close(); await session.close(); }
  await assert.rejects(session.renderThumbnail(), error => error.code === "closed");
  await assert.rejects(session.buildHep(), error => error.code === "closed");
  console.log("PDF thumbnail API: sizing, colors, cancellation, lossless output, session reuse, canonical HEP parity passed.");
} finally { hooks.deregister(); }
