import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

let blockCanvas = true;
let canvasAttempts = 0;
const originalWarn = console.warn;
const warnings = [];
console.warn = (...args) => warnings.push(args.map(String).join(" "));
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@napi-rs/canvas") {
      canvasAttempts += 1;
      if (blockCanvas) {
        throw Object.assign(new Error("Fixture: optional canvas is not installed"), { code: "MODULE_NOT_FOUND" });
      }
    }
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
        !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const { loadNodeCanvas } = await import("../src/nodeCanvas.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const missingCodec = await import("../src/rasterImageCodec.ts?missing-canvas");
  assert.equal(canvasAttempts, 0, "importing HEPR modules must not load native canvas");

  const vectorSession = await openPdf({ kind: "bytes", bytes: fixture(false) });
  try {
    const scene = await vectorSession.compileVectorPage(0);
    assert.equal(scene.fillPathCount, 1);
    assert.equal(canvasAttempts, 0, "vector-only parsing must work without canvas");
  } finally {
    await vectorSession.close();
  }

  // A valid PNG signature reaches the decoder selection before image decoding.
  const pngHeader = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  await assert.rejects(missingCodec.decodeRasterImageToRgba("png", pngHeader),
    error => /npm install @napi-rs\/canvas/.test(error.message) && error.cause?.code === "MODULE_NOT_FOUND");
  assert.deepEqual(warnings, [], "imports, vector parsing, and decoding must not warn about an encoding fallback");

  const rgba = new Uint8Array(16 * 16 * 4).fill(255);
  assert.equal(await missingCodec.encodeRasterRgbaAsBestImage(16, 16, rgba), null,
    "HEP encoding must retain its raw RGBA fallback without native canvas");
  assert.equal(warnings.length, 1, "warn on the first encoding fallback even if decoding cached the missing backend");
  assert.match(warnings[0], /\[HEPR\] WARNING/);
  assert.match(warnings[0], /raw RGBA instead of WebP\/PNG/);
  assert.match(warnings[0], /HEP files much larger/);
  assert.match(warnings[0], /npm install @napi-rs\/canvas/);
  assert.match(warnings[0], /regenerate/);
  assert.equal(await missingCodec.encodeRasterRgbaAsBestImage(16, 16, rgba), null);
  assert.equal(warnings.length, 1, "do not repeat warnings for PNG/WebP attempts or subsequent images");
  assert.equal(canvasAttempts, 1, "cache the unavailable codec across encoding attempts");

  const rasterSession = await openPdf({ kind: "bytes", bytes: fixture(true) });
  try {
    await assert.rejects(rasterSession.compileVectorPage(0),
      error => error.code === "unsupported-content" && /npm install @napi-rs\/canvas/.test(error.message));
  } finally {
    await rasterSession.close();
  }

  const processDescriptor = Object.getOwnPropertyDescriptor(globalThis, "process");
  const attemptsBeforeBrowser = canvasAttempts;
  try {
    Object.defineProperty(globalThis, "process", { configurable: true, value: undefined });
    assert.equal(loadNodeCanvas(), null);
    // Browser process shims also must not trigger a native import.
    Object.defineProperty(globalThis, "process", { configurable: true, value: { versions: {} } });
    assert.equal(loadNodeCanvas(), null);
  } finally {
    Object.defineProperty(globalThis, "process", processDescriptor);
  }
  assert.equal(canvasAttempts, attemptsBeforeBrowser);

  blockCanvas = false;
  const installedCodec = await import("../src/rasterImageCodec.ts?installed-canvas");
  const encoded = await installedCodec.encodeRasterRgbaAsBestImage(16, 16, rgba);
  assert.ok(encoded, "Node image encoding must work with the optional peer installed");
  const decoded = await installedCodec.decodeRasterImageToRgba(encoded.encoding, encoded.bytes);
  assert.equal(decoded.width, 16);
  assert.equal(decoded.height, 16);
  assert.equal(decoded.data.length, rgba.length);
  assert.ok(decoded.data.every((value, index) => index % 4 !== 3 || value === 255));
  assert.equal(await installedCodec.encodeRasterRgbaAsBestImage(1, 1, rgba.subarray(0, 4)), null,
    "raw RGBA is still preferred when it is smaller than the encoded image");
  assert.equal(warnings.length, 1, "working codecs and size-based RGBA selection must not warn");

  const installedSession = await openPdf({ kind: "bytes", bytes: fixture(true) });
  try {
    const scene = await installedSession.compileVectorPage(0);
    assert.equal(scene.rasterLayers.length, 1);
    assert.ok(scene.rasterLayers[0].data.some((value, index) => index % 4 === 3 && value === 255));
  } finally {
    await installedSession.close();
  }
  console.log("optional Node canvas: lazy loading, missing peer, browser guard, codecs, and compositing passed");
} finally {
  console.warn = originalWarn;
  hooks.deregister();
}

function fixture(raster) {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << /XObject << /Im 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", raster
      ? "q 5 5 10 10 re W n 0 20 -20 0 20 0 cm /Im Do Q"
      : "1 0 0 rg 1 2 3 4 re f") },
    { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8",
      Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0)) }
  ] });
}
