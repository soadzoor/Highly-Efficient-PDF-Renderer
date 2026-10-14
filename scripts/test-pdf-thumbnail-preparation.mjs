import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createOcrPdfFixture } from "./lib/ocrPdfFixture.mjs";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildType1Fixture } from "./lib/type1Fixture.mjs";
import { createCanvas } from "@napi-rs/canvas";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { NativeSfntFont, parseNativePdfFont } = await import("../src/pdf/nativeFont.ts");
  const { NativePdfFontProgramCache } = await import("../src/pdf/nativeFontResources.ts");
  const { reduceNativeThumbnailImage } = await import("../src/pdf/nativeImage.ts");
  const { HEPR_IMAGE_FORMAT } = await import("../src/heprDocumentData.ts");
  const { lowerRetainedPageToVectorScene } = await import("../src/retainedVectorPage.ts");
  const options = { maxDimension: 40, background: [1, 1, 1, 1], backend: "canvas2d" };

  // Ordinary tiny labels bypass outline derivation; the subsequent canonical
  // compile still derives the original outlines and reuses the parsed face.
  const originalParse = NativeSfntFont.parse, originalOutline = NativeSfntFont.prototype.getGlyphOutline;
  let parsed = 0, outlines = 0;
  NativeSfntFont.parse = function (...args) { parsed++; return originalParse.apply(this, args); };
  NativeSfntFont.prototype.getGlyphOutline = function (...args) { outlines++; return originalOutline.apply(this, args); };
  try {
    const bytes = createOcrPdfFixture({ scan: false, glyphless: false,
      content: "BT /F1 10 Tf 20 30 Td <0001000200010002> Tj ET" });
    const session = await openPdf({ kind: "bytes", bytes });
    try {
      const small = await session.renderThumbnailPage(0, options);
      assert.deepEqual([small.width, small.height], [40, 20]);
      assert.equal(outlines, 0, "two-pixel labels use density marks before reading glyph outlines");
      assert.equal(parsed, 1);
      assert(small.timings.some(timing => timing.stage === "prepare"));
      const canonical = await session.compilePage(0);
      assert(outlines > 0, "canonical compilation still derives precise text");
      assert.equal(parsed, 1, "thumbnail and canonical conversion share their parsed font");
      assert.equal(canonical.textIndex.text, "ABAB");
      const canonicalAgain = await session.compilePage(0);
      assert.deepEqual(canonicalAgain.stores.paths.coordinates, canonical.stores.paths.coordinates);
      assert.equal(parsed, 1);
      const large = await session.renderThumbnailPage(0, { ...options, maxDimension: 200 });
      assert.deepEqual([large.width, large.height], [200, 100]);
      const abort = new AbortController(); abort.abort();
      await assert.rejects(session.renderThumbnailPage(0, { ...options, signal: abort.signal }), error => error.code === "aborted");
      assert.equal((await session.compilePage(0)).textIndex.text, "ABAB", "cancelled thumbnail does not close its session");
    } finally { await session.close(); }
  } finally { NativeSfntFont.parse = originalParse; NativeSfntFont.prototype.getGlyphOutline = originalOutline; }

  const clipped = await openPdf({ kind: "bytes", bytes: createOcrPdfFixture({ scan: false, glyphless: false,
    content: "BT /F1 10 Tf 7 Tr 20 30 Td <0001> Tj ET 0 0 200 100 re f" }) });
  try {
    let calls = 0;
    NativeSfntFont.prototype.getGlyphOutline = function (...args) { calls++; return originalOutline.apply(this, args); };
    await clipped.renderThumbnailPage(0, options);
    assert(calls > 0, "text clipping preserves exact glyph outlines even for tiny text");
  } finally { NativeSfntFont.prototype.getGlyphOutline = originalOutline; await clipped.close(); }

  const scan = await openPdf({ kind: "bytes", bytes: createOcrPdfFixture({ imageWidth: 512, imageHeight: 256 }) });
  try {
    const before = await scan.compilePage(0);
    await scan.renderThumbnailPage(0, options);
    const after = await scan.compilePage(0);
    assert.deepEqual(after.stores.images, before.stores.images, "thumbnail image reduction cannot alter canonical resources");
    assert.deepEqual([after.stores.images.widths[0], after.stores.images.heights[0]], [512, 256]);
  } finally { await scan.close(); }

  const crop = await openPdf({ kind: "bytes", bytes: writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /CropBox [10 5 190 95] /Rotate 90 /UserUnit 2 /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "1 0 0 rg 10 5 180 90 re f") }
  ] }) });
  try {
    const pixels = await crop.renderThumbnailPage(0, { ...options, maxDimension: 72, vectorOverride: [0, 0, 1, 1] });
    assert.deepEqual([pixels.width, pixels.height], [36, 72]);
    const center = (36 * 36 + 18) * 4;
    assert.deepEqual([...pixels.rgba.subarray(center, center + 4)], [0, 0, 255, 255]);
  } finally { await crop.close(); }

  const fractional = await openPdf({ kind: "bytes", bytes: writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 201 101] /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "0 0 201 101 re f") }
  ] }) });
  try {
    const pixels = await fractional.renderThumbnailPage(0, { ...options, maxDimension: 400 });
    assert.deepEqual([pixels.width, pixels.height], [400, Math.round(101 * 400 / 201)],
      "Canvas2D and WebGL share rounded backing dimensions");
  } finally { await fractional.close(); }

  const annotations = await openPdf({ kind: "bytes", bytes: writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Annots [5 0 R] >>" },
    { number: 5, body: "<< /Type /Annot /Subtype /Square /Rect [10 10 30 30] /AP << /N 6 0 R >> >>" },
    { number: 6, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 20 20] /Resources << >>", "1 0 0 rg 0 0 20 20 re f") }
  ] }) });
  try {
    const annotationId = (await annotations.getPageAnnotations(0))[0].id;
    const visible = await annotations.renderThumbnailPage(0, { ...options, background: [0, 0, 0, 0] });
    assert(visible.rgba.some((value, index) => index % 4 === 3 && value > 0));
    const hidden = await annotations.renderThumbnailPage(0, { ...options, background: [0, 0, 0, 0],
      optionalContent: { revision: 1, conditions: new Uint8Array(0), layers: [{ id: `annotation:${annotationId}`, visible: false }] } });
    assert(hidden.rgba.every((value, index) => index % 4 !== 3 || value === 0),
      "Reader annotation visibility remains effective after search/annotation metadata is omitted");
  } finally { await annotations.close(); }

  const layers = await openPdf({ kind: "bytes", bytes: createOcrPdfFixture({ scan: false,
    content: "/OC /Hidden BDC 0 0 100 100 re f EMC" }) });
  try {
    const scene = await layers.compileVectorPage(0);
    const group = scene.optionalContent.groups.find(group => group.name === "Hidden");
    const shown = await layers.renderThumbnailPage(0, { ...options, background: [0, 0, 0, 0],
      optionalContent: { revision: 1, conditions: new Uint8Array(0), layers: [{ id: group.id, visible: true }] } });
    assert(shown.rgba.some((value, index) => index % 4 === 3 && value > 0), "snapshot maps PDF layer ids to its page conditions");
    const hidden = await layers.renderThumbnailPage(0, { ...options, background: [0, 0, 0, 0] });
    assert(hidden.rgba.every((value, index) => index % 4 !== 3 || value === 0), "default PDF layers keep their original visibility");
  } finally { await layers.close(); }

  const rgba = { width: 2, height: 1, format: HEPR_IMAGE_FORMAT.Rgba8,
    data: Uint8Array.of(255, 0, 0, 0, 0, 0, 255, 255) };
  const averaged = reduceNativeThumbnailImage(rgba, 1);
  assert.deepEqual([...averaged.data], [0, 0, 255, 128], "downsampling averages premultiplied coverage");
  assert.deepEqual([...rgba.data], [255, 0, 0, 0, 0, 0, 255, 255]);
  const packed = reduceNativeThumbnailImage({ width: 8, height: 1, format: HEPR_IMAGE_FORMAT.Gray1,
    data: Uint8Array.of(0xf0) }, 1);
  assert.equal(packed.format, HEPR_IMAGE_FORMAT.Gray8);
  assert.deepEqual([...packed.data], [128], "packed scans reduce without a full RGBA plane");

  // Completed Type1 programs survive their original operation signal. Failed
  // cache entries are evicted rather than poisoning the next compilation.
  const cache = new NativePdfFontProgramCache(), fixture = buildType1Fixture();
  const dictionary = new Map([["Subtype", { kind: "name", value: "Type1" }],
    ["BaseFont", { kind: "name", value: "FixtureType1" }],
    ["FontDescriptor", new Map([["Flags", 4], ["FontFile", { kind: "stream", bytes: fixture.bytes,
      dictionary: new Map([["Length1", fixture.length1], ["Length2", fixture.length2], ["Length3", fixture.length3]]) }]])]]);
  const resolver = { async resolveValue(value) { return value; }, async decodeStream(stream) { return stream.bytes; } };
  const controller = new AbortController();
  const font = await cache.load(dictionary, () => parseNativePdfFont(dictionary, resolver, { signal: controller.signal }));
  controller.abort();
  assert.equal(font.decode(Uint8Array.of(1)).width, 600);
  assert(font.getGlyphOutline(1).commands.length > 0);
  assert.strictEqual(await cache.load(dictionary, () => { throw new Error("unexpected parse"); }), font);
  const failedDictionary = new Map();
  await assert.rejects(cache.load(failedDictionary, async () => { throw new Error("cancelled parse"); }), /cancelled parse/);
  assert.strictEqual(await cache.load(failedDictionary, async () => font), font);

  // One output pixel replaces the canonical 0.015-point cubic subdivision.
  const curves = await openPdf({ kind: "bytes", bytes: writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 1000] /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "0 0 m 0 1000 1000 1000 1000 0 c h f") }
  ] }) });
  try {
    const page = await curves.compilePage(0);
    const exact = await lowerRetainedPageToVectorScene(page, { signal: new AbortController().signal });
    const preview = await lowerRetainedPageToVectorScene(page, { signal: new AbortController().signal,
      curveTolerance: 25, omitMetadata: true, defaultVisibilityOnly: true });
    assert(preview.fillSegmentCount < exact.fillSegmentCount);
    assert.equal(preview.textIndex, null);
  } finally { await curves.close(); }

  const { renderThumbnailPageCanvas2d } = await import("../src/thumbnailCanvas2d.ts");
  const domSession = await openPdf({ kind: "bytes", bytes: writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "1 0 0 rg 0 0 200 100 re f") }
  ] }) });
  const globals = Object.fromEntries(["process", "document", "OffscreenCanvas"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const canvases = [];
  try {
    Object.defineProperty(globalThis, "process", { value: undefined, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", { value: undefined, configurable: true, writable: true });
    Object.defineProperty(globalThis, "OffscreenCanvas", { value: undefined, configurable: true, writable: true });
    const fallback = await domSession.renderThumbnailPage(0, options);
    assert("page" in fallback, "a worker without Canvas2D returns its already prepared retained page");
    assert.equal(fallback.limits.maxImagePixels > 0, true, "host fallback receives the caller's resource ceilings");
    globalThis.document = { createElement(name) {
      assert.equal(name, "canvas"); const canvas = createCanvas(1, 1); canvases.push(canvas); return canvas;
    } };
    const domPixels = await renderThumbnailPageCanvas2d(fallback.page, options, undefined, fallback.limits);
    assert.deepEqual([domPixels.width, domPixels.height], [40, 20]);
    assert.deepEqual([...domPixels.rgba.subarray(0, 4)], [255, 0, 0, 255], "DOM Canvas2D renders the prepared page without parsing again");
    assert(canvases.every(canvas => canvas.width === 1 && canvas.height === 1), "DOM surfaces release on success");
    assert(domPixels.timings.some(timing => timing.stage === "readback"));

    globalThis.OffscreenCanvas = class {
      constructor(width, height) { this.width = width; this.height = height; canvases.push(this); }
      getContext() { return null; }
    };
    const unavailableOffscreen = await renderThumbnailPageCanvas2d(fallback.page, options, undefined, fallback.limits);
    assert.deepEqual(unavailableOffscreen.rgba, domPixels.rgba, "missing Offscreen 2D capability falls through to DOM Canvas2D");
    assert(canvases.every(canvas => canvas.width === 1 && canvas.height === 1));
    const aborted = new AbortController(); aborted.abort();
    const beforeAbort = canvases.length;
    await assert.rejects(renderThumbnailPageCanvas2d(fallback.page, options, aborted.signal), error => error.name === "AbortError");
    assert.equal(canvases.length, beforeAbort, "cancelled host fallback allocates no surface");
    await assert.rejects(renderThumbnailPageCanvas2d(fallback.page, options, undefined,
      { maxImagePixels: 2, maxDecodedStreamBytes: 1024 * 1024 }), error => error.code === "canvas2d.resource-limit");
    assert(canvases.every(canvas => canvas.width === 1 && canvas.height === 1), "DOM surfaces release on failure");
  } finally {
    for (const [key, descriptor] of Object.entries(globals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
    await domSession.close();
  }

  console.log("Thumbnail preparation passed: target detail, canonical isolation, font reuse, cancellation, crop/rotation, and alpha.");
} finally { hooks.deregister(); }
