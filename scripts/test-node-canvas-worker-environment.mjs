import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const originalFontSetting = process.env.DISABLE_SYSTEM_FONTS_LOAD;
const originalMarker = process.env.HEPR_OUTLINE_WORKER_ENV_REGRESSION;
try {
  const { openPdfInNodeWorker } = await import("../src/pdf/workerClient.ts");
  const pdf = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 50] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "BT /F1 100 Tf 1 0 0 1 10 20 Tm (AB) Tj ET") },
    { number: 5, body: "<< /Type /Font /Subtype /TrueType /BaseFont /FixtureSans /Encoding /WinAnsiEncoding >>" }
  ] });
  process.env.HEPR_OUTLINE_WORKER_ENV_REGRESSION = "inherited-worker-setting";
  const workerUrl = bootstrap(new URL("../src/pdf/pdfWorkerEntry.ts", import.meta.url));
  for (const hostSetting of [undefined, "host-owned-setting"]) {
    if (hostSetting === undefined) delete process.env.DISABLE_SYSTEM_FONTS_LOAD;
    else process.env.DISABLE_SYSTEM_FONTS_LOAD = hostSetting;
    const before = { ...process.env };
    const session = await openPdfInNodeWorker({ kind: "bytes", bytes: pdf }, { workerUrl,
      missingFontResolver() { return { sfntBytes: buildTinySfnt(), identifier: "outline-env-fixture" }; } });
    try {
      const page = await session.compilePage(0);
      assert.equal(page.textIndex.text, "AB", "PDF font parsing remains available without Canvas system fonts");
      const result = await session.renderThumbnailPage(0, { maxDimension: 100,
        background: [1, 1, 1, 1], backend: "canvas2d" });
      assert.deepEqual([result.width, result.height], [100, 50]);
      for (const [x, y] of [[12, 27], [77, 27]]) {
        const offset = (y * result.width + x) * 4;
        assert(result.rgba[offset] < 30 && result.rgba[offset + 3] === 255,
          "ordinary and compound glyph outlines render with native text APIs disabled");
      }
    } finally { await session.close(); }
    assert.deepEqual({ ...process.env }, before, "creating, rendering and closing the worker never modifies host environment variables");
  }
  console.log("Node Canvas worker environment passed: isolated font-scan opt-out, inherited env, unchanged host env and real ordinary/compound outline rendering.");
} finally {
  if (originalFontSetting === undefined) delete process.env.DISABLE_SYSTEM_FONTS_LOAD;
  else process.env.DISABLE_SYSTEM_FONTS_LOAD = originalFontSetting;
  if (originalMarker === undefined) delete process.env.HEPR_OUTLINE_WORKER_ENV_REGRESSION;
  else process.env.HEPR_OUTLINE_WORKER_ENV_REGRESSION = originalMarker;
  hooks.deregister();
}

function bootstrap(entryUrl) {
  const source = `import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
assert.equal(process.env.DISABLE_SYSTEM_FONTS_LOAD, "1");
assert.equal(process.env.HEPR_OUTLINE_WORKER_ENV_REGRESSION, "inherited-worker-setting");
registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\\.\\.?\\//.test(specifier) && !/\\.[a-z0-9]+(?:[?#]|$)/i.test(specifier) ? specifier + ".ts" : specifier, context);
} });
const require = createRequire(${JSON.stringify(entryUrl.href)});
const canvas = require("@napi-rs/canvas");
assert.equal(canvas.GlobalFonts.families.length, 0, "the isolated parser worker does not discover or register system fonts");
const contextPrototype = Object.getPrototypeOf(canvas.createCanvas(1, 1).getContext("2d"));
for (const name of ["fillText", "strokeText", "measureText"]) {
  contextPrototype[name] = function () { throw new Error("Native text API must not be used: " + name); };
}
await import(${JSON.stringify(entryUrl.href)});`;
  return new URL(`data:text/javascript,${encodeURIComponent(source)}`);
}
