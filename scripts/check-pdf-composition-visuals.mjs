import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas, DOMMatrix, Path2D, ImageData } from "@napi-rs/canvas";
import { createPdfCompositionExample } from "../examples/pdf-composition.mjs";

// Optional offline comparison with independently installed pdf.js.
// HEPR_PDFJS_MODULE=/path/to/pdfjs-dist/legacy/build/pdf.mjs node scripts/check-pdf-composition-visuals.mjs
const output = resolve(process.argv[2] ?? "/tmp/hepr-pdf-composition-validation");
const referenceModule = process.env.HEPR_PDFJS_MODULE ?? "/tmp/hepr-editor-reference/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });
Object.assign(globalThis, { DOMMatrix, Path2D, ImageData });
class CanvasFactory {
  create(width, height) { const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext("2d") }; }
  reset(target, width, height) { target.canvas.width = width; target.canvas.height = height; }
  destroy(target) { target.canvas.width = target.canvas.height = 0; target.canvas = target.context = null; }
}
try {
  const { createPdfDocument } = await import("../src/pdfComposition.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const pdfjs = await import(pathToFileURL(referenceModule).href);
  await mkdir(output, { recursive: true });
  const result = await createPdfCompositionExample(createPdfDocument), bytes = new Uint8Array(await result.blob.arrayBuffer());
  await writeFile(resolve(output, "source.pdf"), new Uint8Array(await result.sourceBlob.arrayBuffer()));
  await writeFile(resolve(output, "composition.pdf"), bytes);
  const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false, isEvalSupported: false, CanvasFactory });
  const document = await task.promise, pages = [], rows = [];
  try {
    assert.equal(document.numPages, 2);
    for (let index = 0; index < document.numPages; index++) {
      const page = await document.getPage(index + 1), viewport = page.getViewport({ scale: 2 });
      const reference = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: reference.getContext("2d"), viewport }).promise;
      const parser = await openPdf({ kind: "bytes", bytes });
      let actual;
      try {
        const compiled = await parser.compilePage(index, { optimization: "none" });
        actual = (await renderHeprPageToCanvas2d(compiled, { scale: 2, background: [1, 1, 1, 1], surfaceFactory(width, height) {
          const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext("2d") };
        } })).surface.canvas;
      } finally { await parser.close(); }
      assert.equal(actual.width, reference.width); assert.equal(actual.height, reference.height);
      const text = (await page.getTextContent()).items.filter(value => "str" in value).map(value => value.str).join(" ");
      const annotations = (await page.getAnnotations()).map(value => ({ subtype: value.subtype, url: value.url, dest: value.dest, rect: value.rect }));
      const difference = compare(reference, actual);
      const name = `page-${index + 1}`;
      await writeFile(resolve(output, `${name}-pdfjs.png`), reference.toBuffer("image/png"));
      await writeFile(resolve(output, `${name}-hepr.png`), actual.toBuffer("image/png"));
      const row = sideBySide(reference, actual, `pdf.js ${pdfjs.version}: page ${index + 1}`, "HEPR Canvas2D");
      await writeFile(resolve(output, `${name}-side-by-side.png`), row.toBuffer("image/png")); rows.push(row);
      pages.push({ page: index + 1, width: viewport.width / 2, height: viewport.height / 2, view: page.view,
        text, annotations, ...difference });
    }
  } finally { await task.destroy(); }
  // PDF readers intersect an outlying CropBox with the preserved MediaBox.
  assert.deepEqual(pages.map(page => [page.width, page.height]), [[700, 520], [420, 345]]);
  assert(pages[0].text.includes("SOURCE BACKGROUND"), "visible source text survives native import");
  assert(!pages[1].text.includes("SOURCE BACKGROUND"), "hidden source content is absent");
  for (const text of ["PDF composition example", "Icon A", "Compound path with a hole", "8.10 m", "3.42 m²"]) {
    assert(pages[0].text.includes(text), `searchable text: ${text}`);
  }
  assert(pages[1].text.includes("custom viewport"));
  assert(pages[0].annotations.some(value => value.subtype === "Link" && value.url === "https://example.com/composition"));
  assert(pages[0].annotations.some(value => value.subtype === "Link" && value.dest));
  for (const page of pages) assert(page.meanMaxChannelDifference < 5 && page.fractionDifferentByMoreThan20 < .08,
    `page ${page.page}: independent offline renderer agreement`);
  const overview = createCanvas(Math.max(...rows.map(row => row.width)), rows.reduce((sum, row) => sum + row.height, 0));
  const context = overview.getContext("2d"); context.fillStyle = "#eef2f6"; context.fillRect(0, 0, overview.width, overview.height);
  let y = 0; for (const row of rows) { context.drawImage(row, 0, y); y += row.height; }
  await writeFile(resolve(output, "overview.png"), overview.toBuffer("image/png"));
  const report = { description: result.description, verification: "Synthetic offline PDF reader and Canvas2D checks. Browser, GPU and application integration require separate verification.",
    pdfjsVersion: pdfjs.version, sourceBytes: result.sourceBlob.size, outputBytes: bytes.length,
    checks: { twoPagesAndViewportDimensions: true, searchableAuthoredText: true, visibleSourcePreserved: true,
      hiddenSourceAbsent: true, urlAndPageLinks: true, offlineRendererAgreement: true }, diagnostics: result.diagnostics, pages };
  await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, checks: report.checks, pages: pages.map(({ text, annotations, ...page }) => page) }, null, 2));
} finally { hooks.deregister(); }

function compare(left, right) {
  const a = left.getContext("2d").getImageData(0, 0, left.width, left.height).data;
  const b = right.getContext("2d").getImageData(0, 0, right.width, right.height).data;
  let error = 0, changed = 0;
  for (let index = 0; index < a.length; index += 4) {
    const delta = Math.max(Math.abs(a[index] - b[index]), Math.abs(a[index + 1] - b[index + 1]), Math.abs(a[index + 2] - b[index + 2]));
    error += delta; if (delta > 20) changed++;
  }
  return { meanMaxChannelDifference: error / (a.length / 4), fractionDifferentByMoreThan20: changed / (a.length / 4) };
}
function sideBySide(left, right, leftLabel, rightLabel) {
  const canvas = createCanvas(left.width + right.width, left.height + 30), context = canvas.getContext("2d");
  context.fillStyle = "#eef2f6"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#19293d"; context.font = "13px sans-serif";
  context.fillText(leftLabel, 8, 20); context.fillText(rightLabel, left.width + 8, 20);
  context.drawImage(left, 0, 30); context.drawImage(right, left.width, 30); return canvas;
}
