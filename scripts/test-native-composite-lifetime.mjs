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
let peakCanvasPixels = 0;
let failure = null;
let cancelReadback = null;
Object.defineProperty(globalThis, "OffscreenCanvas", {
  configurable: true,
  value: class {
    constructor(width, height) {
      const canvas = createCanvas(width, height);
      canvases.push(canvas);
      peakCanvasPixels = Math.max(peakCanvasPixels,
        canvases.reduce((pixels, surface) => pixels + surface.width * surface.height, 0));
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

  // This fixture used to rasterize because of its clip. Exercise that retained
  // compatibility path so these tests still verify compositor resource cleanup.
  const compile = (options = {}) => session.compileVectorPage(0, { ...options, preserveDrawingOrder: false });
  const scene = await compile();
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
    await assert.rejects(compile(), mode === "readback"
      ? /fixture pixel readback failed/
      : error => error?.code === "canvas2d.invalid-surface" &&
        error.cause?.message === "OffscreenCanvas 2D is unavailable.");
    assert(canvases.length > 0, "failure must occur after a surface was allocated");
    assertReleased();
  }
  canvases.length = 0;
  failure = "abort";
  cancelReadback = new AbortController();
  await assert.rejects(compile({ signal: cancelReadback.signal }),
    error => error?.code === "aborted");
  assertReleased();
  failure = null;
  canvases.length = 0;
  const retried = await compile();
  assertReleased();
  assert.deepEqual(retried.rasterLayers[0].data, snapshot, "the session remains reusable after failed rendering");
  assert.deepEqual(pixels, snapshot, "released canvases must not own returned scene pixels");

  // Non-isolated alpha paints each need an intermediate group. Their backing
  // stores must be released before the next paint, rather than at page readback.
  const groupSession = await openPdf({ kind: "bytes", bytes: writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << /ExtGState << /GM 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", Array.from({ length: 6 }, () =>
      "q /GM gs 1 0 0 rg 0 0 10 10 re f Q").join("\n")) },
    { number: 5, body: "<< /Type /ExtGState /ca 0.5 >>" }
  ] }) });
  try {
    const { createNativeCompositeSurfaceFactory } = await import("../src/retainedPageCompositor.ts");
    const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
    const page = await groupSession.compilePage(0);
    assert.equal(page.displayProgram.groups.length, 7, "fixture must exercise six separate alpha groups");
    canvases.length = 0;
    peakCanvasPixels = 0;
    const factory = await createNativeCompositeSurfaceFactory();
    try {
      const rendered = await renderHeprPageToCanvas2d(page, { surfaceFactory: factory });
      assert.equal(canvases.length, 7, "the output and each paint use distinct surfaces");
      assert(peakCanvasPixels <= 20 * 20 * 2 + 6,
        "only the output and current group retain full page-sized backing stores");
      assert(canvases.slice(1).every(canvas => canvas.width === 1 && canvas.height === 1),
        "completed group buffers are released before readback or factory cleanup");
      assert.deepEqual([...rendered.surface.context.getImageData(5, 15, 1, 1).data], [255, 0, 0, 252],
        "releasing group buffers preserves ordered alpha compositing");
      assert.equal(rendered.surface.context.getImageData(15, 5, 1, 1).data[3], 0,
        "the live output keeps its transparent background");
    } finally { factory.releaseAll(); }
    assertReleased();

    canvases.length = 0;
    const failedFactory = await createNativeCompositeSurfaceFactory();
    const throwDuringPaint = (width, height) => {
      const surface = failedFactory(width, height);
      if (canvases.length > 1) surface.context.fill = () => { throw new Error("fixture group paint failed"); };
      return surface;
    };
    try {
      await assert.rejects(renderHeprPageToCanvas2d(page, { surfaceFactory: throwDuringPaint }),
        /fixture group paint failed/);
      assert(canvases.length > 1, "painting fails after a group surface was allocated");
      assert(canvases.slice(1).every(canvas => canvas.width === 1 && canvas.height === 1),
        "failed group rendering releases intermediate backing stores while unwinding");
    } finally { failedFactory.releaseAll(); }
    assertReleased();
  } finally { await groupSession.close(); }
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
