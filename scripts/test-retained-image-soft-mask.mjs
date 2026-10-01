import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });

try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { lowerRetainedPageToVectorScene } = await import("../src/retainedVectorPage.ts");

  /**
   * An image whose /SMask supplies its alpha, inside a transparency-group Form.
   * The Form only reaches the vector scene if the page's retained lowering
   * succeeds, and that lowering used to refuse any soft-masked image - so one
   * such image cost the whole page its vectors, the Form included.
   */
  const image = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]); // 2x2 RGB
  const fixture = (softMask, maskSize = 2) => writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: [
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R",
      "/Resources << /XObject << /Im 5 0 R /Fm 7 0 R >> >> >>"
    ].join(" ") },
    { number: 4, body: tinyPdfStream("", "q 80 0 0 80 10 10 cm /Im Do Q q /Fm Do Q") },
    { number: 5, body: tinyPdfStream([
      "/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB",
      `/BitsPerComponent 8${softMask ? " /SMask 6 0 R" : ""}`
    ].join(" "), image) },
    { number: 6, body: tinyPdfStream([
      `/Type /XObject /Subtype /Image /Width ${maskSize} /Height ${maskSize}`,
      "/ColorSpace /DeviceGray /BitsPerComponent 8"
    ].join(" "), Uint8Array.from({ length: maskSize * maskSize }, (_, i) => i * (255 / (maskSize * maskSize - 1)))) },
    { number: 7, body: tinyPdfStream([
      "/Type /XObject /Subtype /Form /BBox [0 0 100 100]",
      "/Group << /S /Transparency /CS /DeviceRGB /I true >>"
    ].join(" "), "0 0 1 rg 20 20 40 40 re f") }
  ] });

  const compile = async (bytes) => {
    const diagnostics = [];
    const session = await openPdf({ kind: "bytes", bytes, label: "soft-mask" },
      { onDiagnostic: diagnostic => diagnostics.push(diagnostic) });
    try {
      return { scene: await session.compileVectorPage(0, {}), diagnostics };
    } finally { await session.close(); }
  };

  const { scene, diagnostics } = await compile(fixture(true));
  assert.equal(diagnostics.find(d => d.code === "retained-vector-fallback"), undefined,
    "a soft-masked image no longer defeats the page's retained lowering");
  assert.equal(diagnostics.find(d => d.code === "selective-raster-fallback"), undefined,
    "and the transparency-group Form beside it keeps its vectors");
  assert(scene.paintGraph, "the Form reaches the scene as a paint graph group");

  const layer = scene.rasterLayers.find(entry => entry.width === 2 && entry.height === 2);
  assert(layer, "the soft-masked image is present as a 2x2 raster layer");
  // The mask ramps 0, 85, 170, 255 across its four samples; colour is untouched.
  assert.deepEqual([...layer.data], [255, 0, 0, 0, 0, 255, 0, 85, 0, 0, 255, 170, 255, 255, 0, 255],
    "the mask's gray samples become the image's alpha, leaving colour alone");

  // A mask at a different resolution is sampled across the image's own grid.
  const scaled = await compile(fixture(true, 4));
  const scaledLayer = scaled.scene.rasterLayers.find(entry => entry.width === 2 && entry.height === 2);
  assert.deepEqual([...scaledLayer.data].filter((_, index) => index % 4 === 3), [0, 34, 136, 170],
    "a mask of another size is point-sampled, not stretched or refused");

  // Without a mask the image keeps full alpha, and the page still lowers.
  const plain = await compile(fixture(false));
  const plainLayer = plain.scene.rasterLayers.find(entry => entry.width === 2 && entry.height === 2);
  assert.deepEqual([...plainLayer.data].filter((_, index) => index % 4 === 3), [255, 255, 255, 255],
    "an image without a soft mask is unchanged");

  // A stencil mask is coverage painted in the current fill colour. Beside the
  // same transparency-group Form it used to cost the page its vectors, too.
  const stencilFixture = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: [
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R",
      "/Resources << /XObject << /St 5 0 R /Fm 7 0 R >> /ExtGState << /G 6 0 R >> >> >>"
    ].join(" ") },
    { number: 4, body: tinyPdfStream("", [
      "q /G gs 0 .5 1 rg 40 0 0 40 10 10 cm /St Do Q",
      "q 1 0 0 rg 40 0 0 40 50 50 cm /St Do Q q /Fm Do Q"
    ].join(" ")) },
    // Zero samples paint: the diagonal of a 2x2 mask.
    { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 2 /Height 2 /ImageMask true /BitsPerComponent 1",
      Uint8Array.of(0x40, 0x80)) },
    { number: 6, body: "<< /ca .5 >>" },
    { number: 7, body: tinyPdfStream([
      "/Type /XObject /Subtype /Form /BBox [0 0 100 100]",
      "/Group << /S /Transparency /I true >>"
    ].join(" "), "0 0 1 rg 60 10 20 20 re f") }
  ] });
  const stencil = await compile(stencilFixture);
  assert.equal(stencil.diagnostics.find(d => d.code.endsWith("-fallback")), undefined,
    "a stencil mask no longer defeats the page's retained lowering");
  // One mask painted in two colours is two images. The /ca stays on the
  // group around the first, as in the reference renderer, not in its pixels.
  assert.deepEqual(stencil.scene.rasterLayers.map(entry => [...entry.data]), [
    [0, 128, 255, 255, 0, 128, 255, 0, 0, 128, 255, 0, 0, 128, 255, 255],
    [255, 0, 0, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255]
  ], "the mask's coverage takes the fill colour of each paint");
  const translucent = stencil.scene.paintGraph.roots[0].children[0];
  assert.equal(translucent.alpha, 0.5);
  assert.equal(stencil.scene.drawRuns[translucent.children[0].runIndex].kind, "raster");

  // Masks share a pixel budget; past it, each averages its coverage down.
  const session = await openPdf({ kind: "bytes", bytes: stencilFixture, label: "stencil" });
  try {
    const page = await session.compilePage(0);
    const diagnostics = [];
    const reduced = await lowerRetainedPageToVectorScene(page, { signal: new AbortController().signal,
      maxStencilPixels: 2, onDiagnostic: diagnostic => diagnostics.push(diagnostic) });
    assert.deepEqual(reduced.rasterLayers.map(entry => [entry.width, entry.height, ...entry.data]), [
      [1, 1, 0, 128, 255, 128], [1, 1, 255, 0, 0, 128]
    ], "a 2x2 diagonal averages to half coverage");
    assert.equal(diagnostics.find(d => d.code === "image.stencil-resolution-reduced")?.details.pixels, 4);
  } finally { await session.close(); }

  console.log("Retained images: soft-mask alpha folded in, foreign mask sizes sampled, stencil masks tinted, pages keep their vectors");
} finally { hooks.deregister(); }
