import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { prepareSceneForHepRendering } = await import("../src/hep.ts");
  const paint = "1 0 0 rg 0 0 100 100 re f";
  const reference = await compile(paint);
  for (const clip of [
    "-300000000 -300000000 600000000 600000000 re W n",
    "-300000000 -300000000 m -300000000 300000000 l 300000000 300000000 l 300000000 -300000000 l W* n",
    "-300000000 -300000000 m 300000000 -300000000 l 300000000 300000000 l -300000000 300000000 l -300000000 -300000000 l h W n"
  ]) {
    const actual = await compile(`${clip} ${paint}`);
    assert.equal(actual.scene.clipPaths?.length ?? 0, reference.scene.clipPaths?.length ?? 0,
      "containing rectangles retain no redundant clipping geometry");
    assertGeometry(actual.scene, reference.scene);
    assert.deepEqual(actual.pixels, reference.pixels, "default page clipping remains exact");
    const warnings = [], originalWarn = console.warn;
    try {
      console.warn = message => warnings.push(String(message));
      prepareSceneForHepRendering(actual.scene);
    } finally { console.warn = originalWarn; }
    assert(!warnings.some(w => /clamp|fixed-point/.test(w)), "unused large coordinates never reach HEP quantization");
  }
  const transformed = await compile(`q 2 0 0 3 20 30 cm -300000000 -300000000 600000000 600000000 re W n ${paint} Q`);
  const transformedReference = await compile(`q 2 0 0 3 20 30 cm ${paint} Q`);
  assertGeometry(transformed.scene, transformedReference.scene);
  assert.deepEqual(transformed.pixels, transformedReference.pixels, "transformed containing clips remain redundant");
  const nested = "q 10 10 20 20 re W n q -300000000 -300000000 600000000 600000000 re W n";
  const actualNested = await compile(`${nested} ${paint} Q Q 0 0 1 rg 80 80 10 10 re f`);
  const referenceNested = await compile(`q 10 10 20 20 re W n q ${paint} Q Q 0 0 1 rg 80 80 10 10 re f`);
  assertGeometry(actualNested.scene, referenceNested.scene);
  assert.deepEqual(actualNested.pixels, referenceNested.pixels, "nested clips and Q restore exactly");

  for (const [clip, emptyPixel] of [
    ["-10 -10 60 60 re W n", [75, 75]],
    ["-200 -200 m 300 300 l -200 300 l 300 -200 l h W* n", [90, 50]],
    ["-200 -200 m 300 300 l 300 310 l -200 -190 l h W n", [80, 20]],
    ["-100 -100 300 300 re 40 40 20 20 re W* n", [50, 50]]
  ]) {
    const actual = await compile(`${clip} ${paint}`);
    assert((actual.scene.clipPaths?.length ?? 0) > 0, "partial, crossing, sheared and compound clips remain exact");
    const [x, y] = emptyPixel, offset = ((99 - y) * 100 + x) * 4;
    assert.equal(actual.pixels[offset + 3], 0, "a bounding rectangle is insufficient to elide this clip");
  }

  for (const clip of ["-1 -1 12 12 re W n", "0 -1 11 12 re W n", ""]) {
    const actual = await compile("BT /F1 1 Tf 1 0 0 1 10 10 Tm (A) Tj ET",
      `20 0 d0 ${clip} 1 0 0 rg 0 0 20 20 re f`);
    assert.equal(actual.pixels[((99 - 15) * 100 + 15) * 4 + 3], 255);
    assert.equal(actual.pixels[((99 - 15) * 100 + 25) * 4 + 3], clip ? 0 : 255,
      "Type3 FontBBox is advisory: a containing rectangle can still clip visible glyph paint");
  }

  async function compile(content, charProc) {
    const session = await openPdf({ kind: "bytes", bytes: writeTinyPdf({ objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R ${charProc ? "/Resources << /Font << /F1 5 0 R >> >>" : ""} >>` },
      { number: 4, body: tinyPdfStream("", content) },
      ...(charProc ? [
        { number: 5, body: "<< /Type /Font /Subtype /Type3 /FontBBox [0 0 10 10] /FontMatrix [1 0 0 1 0 0] /CharProcs << /A 6 0 R >> /Encoding << /Type /Encoding /Differences [65 /A] >> /FirstChar 65 /LastChar 65 /Widths [20] /Resources << >> >>" },
        { number: 6, body: tinyPdfStream("", charProc) }
      ] : [])
    ] }) });
    try {
      const page = await session.compilePage(0, { optimization: "none" });
      const scene = await session.compileVectorPage(0, { optimization: "none", vectorFallback: "error" });
      const rendered = await renderHeprPageToCanvas2d(page, { surfaceFactory(width, height) {
        const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext("2d") };
      } });
      assert.equal(scene.rasterLayers.length, 0);
      return { scene, pixels: rendered.surface.context.getImageData(0, 0, 100, 100).data };
    } finally { await session.close(); }
  }
  function assertGeometry(actual, expected) {
    for (const field of ["fillPathMetaA", "fillPathMetaB", "fillPathMetaC", "fillSegmentsA", "fillSegmentsB", "drawRuns", "clipPaths"]) {
      assert.deepEqual(actual[field], expected[field], field);
    }
  }
} finally { hooks.deregister(); }
console.log("Redundant PDF clip rectangles passed: exact elision, nesting, winding and HEP quantization.");
