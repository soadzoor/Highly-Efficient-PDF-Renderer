import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
        !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});
const originalOffscreen = Object.getOwnPropertyDescriptor(globalThis, "OffscreenCanvas");
const canvases = [];
let failure = null;
let cancelReadback = null;
Object.defineProperty(globalThis, "OffscreenCanvas", {
  configurable: true,
  value: class {
    constructor(width, height) {
      const canvas = createCanvas(width, height);
      canvases.push(canvas);
      const getContext = canvas.getContext.bind(canvas);
      canvas.getContext = (...args) => {
        if (failure === "context") return null;
        const context = getContext(...args);
        if (failure === "readback") {
          context.getImageData = () => { throw new Error("fixture pixel readback failed"); };
        }
        if (failure === "abort") {
          const read = context.getImageData.bind(context);
          context.getImageData = (...args) => {
            const pixels = read(...args);
            cancelReadback.abort();
            return pixels;
          };
        }
        return context;
      };
      return canvas;
    }
  }
});

let session;
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  session = await openPdf({ kind: "bytes", bytes: writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << /XObject << /Im 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "q 5 5 10 10 re W n 0 20 -20 0 20 0 cm /Im Do Q") },
    { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8", Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0)) }
  ] }) });

  const scene = await session.compileVectorPage(0);
  assert.equal(scene.rasterLayers.length, 1);
  assert(canvases.length >= 2, "fixture must create both output and intermediate image surfaces");
  const pixels = scene.rasterLayers[0].data;
  assert(pixels.some((value, offset) => offset % 4 === 3 && value === 255));
  assert(pixels.some((value, offset) => offset % 4 === 3 && value === 0), "image clipping is preserved");
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] === 255) assert.deepEqual([...pixels.subarray(offset, offset + 3)], [255, 0, 0]);
  }
  assertReleased();
  const snapshot = pixels.slice();
  for (const mode of ["readback", "context"]) {
    canvases.length = 0;
    failure = mode;
    await assert.rejects(session.compileVectorPage(0), mode === "readback"
      ? /fixture pixel readback failed/
      : error => error?.code === "canvas2d.invalid-surface" &&
        error.cause?.message === "OffscreenCanvas 2D is unavailable.");
    assert(canvases.length > 0, "failure must occur after a surface was allocated");
    assertReleased();
  }
  canvases.length = 0;
  failure = "abort";
  cancelReadback = new AbortController();
  await assert.rejects(session.compileVectorPage(0, { signal: cancelReadback.signal }),
    error => error?.code === "aborted");
  assertReleased();
  failure = null;
  canvases.length = 0;
  const retried = await session.compileVectorPage(0);
  assertReleased();
  assert.deepEqual(retried.rasterLayers[0].data, snapshot, "the session remains reusable after failed rendering");
  assert.deepEqual(pixels, snapshot, "released canvases must not own returned scene pixels");
  console.log("native composite surface lifetime tests passed");
} finally {
  await session?.close();
  if (originalOffscreen) Object.defineProperty(globalThis, "OffscreenCanvas", originalOffscreen);
  else delete globalThis.OffscreenCanvas;
  hooks.deregister();
}

function assertReleased() {
  assert(canvases.every(canvas => canvas.width === 1 && canvas.height === 1),
    "all parser-owned canvas backing stores must be released, not only the final output");
}
