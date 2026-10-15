import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { deflateSync } from "node:zlib";
import { createCanvas } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";
import { sceneFingerprint } from "./lib/sceneFingerprint.mjs";

const hooks = registerHooks({ resolve(s, c, next) {
  return next(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c);
} });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const inline = "BI /W 1 /H 1 /BPC 8 /CS /RGB ID abc EI";
  const prefix = "BT /F1 8 Tf 10 70 Td (A) Tj ET q 20 0 0 20 5 5 cm /Im Do Q q 5 0 0 5 40 40 cm ";
  // Split B, BI, the dictionary, and the binary payload across compiler chunks.
  for (const split of [0, 1, 2, 12, 34]) {
    const padding = " ".repeat(256 * 1024 - prefix.length - split);
    const streams = [prefix + padding + inline + " Q 1 0 0 RG 2 w 10 30 m 90 30 l S", "q 8 0 0 8 60 60 cm " + inline + " Q"];
    const bytes = fixture(streams);
    const expected = await compile(bytes, true);
    const actual = await compile(bytes, false);
    assert.equal(sceneFingerprint(actual.scene), sceneFingerprint(expected.scene), `split ${split}: streamed/prepared parity`);
    assert.equal(actual.fonts, 1, "inline images must not restart font resolution");
    assert.equal(actual.codecs, 1, "inline images must not restart XObject decoding");
    assert.equal(actual.profile.timings.resourceScanMs, 0, "no page-wide resource scan");
    assert.equal(actual.profile.timings.inlinePreparationSkipped, false);
    assert.equal(actual.scene.rasterLayers.length, 3);
  }

  // Large uncompressed chunks exercise the zero-copy decoder path, including
  // an inline image before a first-use XObject and two images in the same tail.
  {
    const bytes = fixture([" ".repeat(400_000) + inline + " " + prefix + inline + " Q"], false, false);
    const actual = await compile(bytes, false), expected = await compile(bytes, true);
    assert.equal(sceneFingerprint(actual.scene), sceneFingerprint(expected.scene));
    assert.equal(actual.fonts, 1);
    assert.equal(actual.codecs, 1);
  }

  // First-use patterns/shadings, including unused malformed resources.
  for (const content of [
    "/Sh sh /Pattern cs /P scn 10 10 10 10 re f /Sh sh",
    "/Pattern cs /P scn 10 10 10 10 re f /Sh sh",
    "0 0 1 rg 10 10 10 10 re f"
  ]) {
    const bytes = fixture([content], true);
    const expected = await compile(bytes, true);
    const actual = await compile(bytes, false);
    assert.equal(sceneFingerprint(actual.scene), sceneFingerprint(expected.scene), "lazy shading/pattern output matches preparation");
    assert.equal(actual.profile.timings.resourceScanMs, 0);
  }

  // A shading pattern registers its gradient before standalone shadings in
  // prepared input, but after /Sh in streamed input. Compare pixels and the
  // lowered scene instead of assuming retained resource indices are stable.
  {
    const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
    for (const content of [
      "/Sh sh /Pattern cs /Gradient scn 0 0 50 100 re f",
      "/Pattern cs /Gradient scn 0 0 50 100 re f q 50 0 50 100 re W n /Sh sh Q"
    ]) {
      const bytes = fixture([content], true);
      const expected = await compile(bytes, true), actual = await compile(bytes, false);
      assert.equal(sceneFingerprint(actual.scene), sceneFingerprint(expected.scene));
      const pixels = [], gradientOrders = [];
      for (const prepared of [true, false]) {
        const session = await openPdf({ kind: "bytes", bytes });
        // compilePage normally prepares input. Force its resource preparation
        // through streaming so the reference renderer exercises both loaders.
        if (!prepared) session.preparePageResources = session.prepareStreamedPageResources.bind(session);
        try {
          const page = await session.compilePage(0);
          gradientOrders.push([...page.stores.gradients.coordinates]);
          const rendered = await renderHeprPageToCanvas2d(page, {
            scale: 1, background: [1, 1, 1, 1],
            surfaceFactory(width, height) {
              const canvas = createCanvas(width, height);
              return { canvas, context: canvas.getContext("2d") };
            }
          });
          pixels.push(rendered.surface.context.getImageData(0, 0, 100, 100).data);
        } finally { await session.close(); }
      }
      if (content.startsWith("/Sh")) {
        assert.notDeepEqual(gradientOrders[1], gradientOrders[0],
          "the pixel comparison must exercise different retained gradient indices");
      }
      assert.deepEqual(pixels[1], pixels[0], "first-use gradient indices preserve pixels");
      assert(pixels[1].some((value, index) => index % 4 !== 3 && value < 200));
    }
  }

  // A selective compositing pass must reuse the inline pixels and bound tail.
  {
    const bytes = fixture(["q 0 0 15 15 re W n 0 20 -20 0 20 0 cm /Im Do Q " +
      "q 5 0 0 5 40 40 cm " + inline + " Q BT /F1 8 Tf 10 70 Td (A) Tj ET"]);
    const actual = await compile(bytes, false, { preserveDrawingOrder: false });
    const expected = await compile(bytes, true, { preserveDrawingOrder: false });
    assert.equal(sceneFingerprint(actual.scene), sceneFingerprint(expected.scene));
    assert.equal(actual.codecs, 1);
    assert.equal(actual.fonts, 1);
    assert.equal(actual.profile.timings.selectiveCompilation.decodedImages, 0);
    assert.equal(actual.profile.timings.selectiveCompilation.preparedFonts, 0);
  }

  // A malformed image cannot consume the next stream as its missing payload.
  await assert.rejects(compile(fixture(["BI /W 1 /H 1 /BPC 8 /CS /RGB ID", "abc EI"]), false),
    error => error.code === "unsupported-image");
  await assert.rejects(compile(fixture([inline, inline]), false, { limits: { maxCommandsPerPage: 1 } }),
    error => error.code === "resource-limit");
  {
    const controller = new AbortController();
    await assert.rejects(compile(fixture([prefix + inline + " Q"]), false, { signal: controller.signal },
      () => controller.abort()), error => error.code === "aborted");
  }
  // Thumbnail retained programs use the same lazy resource loader. Compare
  // pixels against prepared input when first-use resources and inline images
  // suspend/resume the shared token stream, including a chunk boundary.
  for (const streams of [
    [prefix + " ".repeat(256 * 1024 - prefix.length - 1) + inline + " Q", "2 J 0.2 w 10 30 m 90 30 l S"],
    ["/Sh sh /Pattern cs /Gradient scn 0 0 50 100 re f"],
    ["/Pattern cs /Gradient scn 0 0 50 100 re f q 50 0 50 100 re W n /Sh sh Q"],
    ["/Pattern cs /P scn 10 10 30 30 re f q 10 10 10 10 re W n /Sh sh Q"]
  ]) {
    const bytes = fixture(streams, true), pixels = [];
    for (const prepared of [true, false]) {
      const session = await openPdf({ kind: "bytes", bytes }, {
        missingFontResolver() { return { identifier: "thumbnail-stream", sfntBytes: buildTinySfnt() }; },
        imageCodecResolver() {
          return { samples: Uint8Array.of(100, 120, 140), width: 1, height: 1, components: 3, bitsPerComponent: 8 };
        }
      });
      if (prepared) session.prepareStreamedPageResources = async () => null;
      try {
        const thumbnail = await session.renderThumbnailPage(0, {
          maxDimension: 80, backend: "canvas2d", background: [1, 1, 1, 1]
        });
        assert.deepEqual([thumbnail.width, thumbnail.height], [80, 80]);
        pixels.push(thumbnail.rgba);
      } finally { await session.close(); }
    }
    assert.deepEqual(pixels[1], pixels[0], "streamed thumbnail resources preserve prepared thumbnail pixels");
  }
  console.log("Streamed inline boundaries, resource loading, limits, cancellation, and second-pass reuse passed.");

  async function compile(bytes, prepared, options = {}, onCodec) {
    let fonts = 0, codecs = 0;
    const session = await openPdf({ kind: "bytes", bytes }, {
      missingFontResolver() { fonts++; return { identifier: "stream-test", sfntBytes: buildTinySfnt() }; },
      imageCodecResolver(request) {
        codecs++; onCodec?.();
        return { samples: Uint8Array.of(100, 120, 140), width: 1, height: 1, components: 3, bitsPerComponent: 8 };
      }
    });
    // Internal reference path: retain the mature prepared-input implementation
    // as an independent oracle for streaming; no public engine option is added.
    if (prepared) session.prepareStreamedPageResources = async () => null;
    try {
      const profile = await session.compileVectorPageWithTimings(0, options);
      return { scene: profile.scene, profile, fonts, codecs };
    } finally { await session.close(); }
  }
} finally { hooks.deregister(); }

function fixture(streams, patterns = false, compressed = true) {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents [${streams.map((_, i) => `${10 + i} 0 R`).join(" ")}] /Resources << /Font << /F1 4 0 R >> /XObject << /Im 5 0 R >> ${patterns ? "/Shading << /Sh 6 0 R /Unused 999 0 R >> /Pattern << /P 7 0 R /Gradient 8 0 R /Unused 999 0 R >>" : ""} >> >>` },
    { number: 4, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" },
    { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode", Uint8Array.of(255, 216, 255, 217)) },
    { number: 6, body: "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 0] /Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >> /Extend [true true] >>" },
    { number: 7, body: tinyPdfStream("/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 10 10] /XStep 10 /YStep 10 /Resources << >>", "0 1 0 rg 0 0 10 10 re f") },
    { number: 8, body: "<< /Type /Pattern /PatternType 2 /Shading 9 0 R >>" },
    { number: 9, body: "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 0 100] /Function << /FunctionType 2 /Domain [0 1] /C0 [0 1 0] /C1 [0 0 0] /N 1 >> /Extend [true true] >>" },
    ...streams.map((content, i) => ({ number: 10 + i, body: tinyPdfStream(
      compressed ? "/Filter /FlateDecode" : "", compressed ? deflateSync(Buffer.from(content)) : content) }))
  ] });
}
