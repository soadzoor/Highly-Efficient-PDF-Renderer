import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

const { openDocumentSession } = await import("../src/nodeDocumentSession.ts");
const { buildHep, buildHepWithScene } = await import("../src/hepBuilder.ts");
const { loadSceneFromHep } = await import("../src/hepReader.ts");
const { createSceneTextSearcher } = await import("../src/textSearch.ts");
const { canonicalTextRecognitionScene } = await import("../src/textRecognitionScene.ts");
const pixels = Uint8Array.of(1, 2, 3, 255), compressed = { format: "bc7" }, prepared = {};
const display = { rasterLayers: [{ data: pixels, gpuCompression: compressed, gpuPreparation: prepared }] };
const canonical = canonicalTextRecognitionScene(display);
assert.equal(canonical.rasterLayers[0].data, pixels, "recognition retains original scan pixels without copying");
assert.equal(canonical.rasterLayers[0].gpuCompression, undefined);
assert.equal(canonical.rasterLayers[0].gpuPreparation, undefined);
assert.equal(display.rasterLayers[0].gpuCompression, compressed, "OCR never changes display preparation");
const source = writeTinyPdf({ objects: [
  { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
  { number: 2, body: "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>" },
  ...[3, 4].map(number => ({ number, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 36] /Resources << /XObject << /Im 5 0 R >> >> /Contents 6 0 R >>" })),
  { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 2 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB", Uint8Array.of(20, 40, 60, 220, 230, 240)) },
  { number: 6, body: tinyPdfStream("", "q 72 0 0 36 0 0 cm /Im Do Q") }
] });
const original = source.slice();
const calls = [];
let disposed = false;
const provider = {
  async recognize(input) {
    calls.push({ page: input.sourcePageIndex, width: input.width, height: input.height });
    assert.equal(input.rgba.length, input.width * input.height * 4);
    return { lines: [{ text: `Árvíz 😀 ${input.sourcePageIndex + 1}`,
      polygon: [[0, 0], [input.width, 0], [input.width, input.height / 2], [0, input.height / 2]] }] };
  },
  dispose() { disposed = true; }
};

const workerSource = `import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\\.\\.?\\//.test(specifier) && !/\\.[a-z0-9]+(?:[?#]|$)/i.test(specifier) ? specifier + ".ts" : specifier, context);
} });
await import(${JSON.stringify(new URL("../src/pdf/pdfWorkerEntry.ts", import.meta.url).href)});`;
const session = await openDocumentSession(source, { workerUrl: new URL(`data:text/javascript,${encodeURIComponent(workerSource)}`) });
try {
  const selected = await session.buildHepWithScene({ pages: "2", textRecognition: { provider },
    withVectorLod: false, withTextLod: false, compression: "store" });
  assert.deepEqual(calls, [{ page: 1, width: 300, height: 150 }], "recognize selected source pages at the requested DPI");
  assert.equal(selected.scene.textInstanceCount, 0, "recognized text creates no visible glyphs");
  assert.equal(selected.scene.textIndex.pages[0].text, "Árvíz 😀 2");
  const reopened = await loadSceneFromHep(await selected.blob.arrayBuffer());
  assert.deepEqual(reopened.textIndex, selected.scene.textIndex, "HEP retains Unicode text and its fallback geometry");
  assert.equal(createSceneTextSearcher(reopened).search("Árvíz").length, 1);
  assert.equal(reopened.rasterLayers[0].width, 2, "OCR pixels never replace canonical scan pixels");
  assert.equal(disposed, false, "supplied providers remain caller-owned");

  calls.length = 0;
  const all = await session.buildHep({ textRecognition: { provider, dpi: 72 }, withVectorLod: false, withTextLod: false });
  const allScene = await loadSceneFromHep(await all.arrayBuffer());
  assert.deepEqual(calls, [{ page: 0, width: 72, height: 36 }, { page: 1, width: 72, height: 36 }],
    "incremental page encoding recognizes each source once");
  assert.deepEqual(allScene.textIndex.pages.map(page => page.text), ["Árvíz 😀 1", "Árvíz 😀 2"]);
} finally { await session.close(); }

try {
  calls.length = 0;
  const options = { textRecognition: { provider, dpi: 72 }, pages: "2", withVectorLod: false, withTextLod: false };
  const result = await buildHepWithScene(source, options);
  assert.equal(result.scene.textIndex.pages[0].text, "Árvíz 😀 2", "one-shot PDF conversion forwards recognition options");
  const blob = await buildHep(source, options);
  assert.equal((await loadSceneFromHep(await blob.arrayBuffer())).textIndex.pages[0].text, "Árvíz 😀 2");
  assert.deepEqual(source, original, "input bytes remain owned and unchanged");
  assert.equal(disposed, false);
} finally { hooks.deregister(); }

console.log("PDF-to-HEP recognition preserves selected source pages, Unicode, scan pixels and provider ownership.");
