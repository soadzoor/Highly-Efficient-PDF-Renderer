import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { createCanvas, ImageData } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";
import { sceneFingerprint } from "./lib/sceneFingerprint.mjs";
import { installSelectionTestHost } from "./lib/selectionTestHost.mjs";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });

try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { createSceneTextSearcher } = await import("../src/textSearch.ts");
  const { computeCharQuad } = await import("../src/sceneTextGeometry.ts");
  const { createTextSelectionController } = await import("../src/textSelection.ts");
  const { getSceneSegmentAccounting } = await import("../src/sceneStatistics.ts");

  const tinySession = await openPdf({ kind: "bytes", bytes: clippedOverlapFixture() }, {
    missingFontResolver: () => ({ sfntBytes: buildTinySfnt(), identifier: "visual-clip-fixture-v1" })
  });
  try {
    const scene = await tinySession.compileVectorPage(0);
    assert.equal(scene.textInstanceCount, 1, "only B remains in the vector glyph store; A is clipped in its image layer");
    const matches = createSceneTextSearcher(scene).search("A");
    assert.equal(matches.length, 1);
    const indexed = scene.textIndex.pages[0];
    assert(indexed.charInstance[matches[0].startChar] <= -2, "composited A keeps selection geometry");
    checkSelection(scene, matches[0], "A");
    // The fixture's PDF coordinates are flipped into the viewer's page space.
    const canvas = rasterPreview(scene);
    const sample = (x, y) => [...canvas.getContext("2d").getImageData(x, 100 - y, 1, 1).data];
    assert.deepEqual(sample(11, 17), [0, 0, 255, 255], "the clipped-out half of A must not leak over the blue image");
    assert.deepEqual(sample(13, 11), [255, 0, 0, 255], "the retained label ink paints above the background image");
    assert.deepEqual(sample(16, 11), [0, 255, 0, 255], "a later image covers the label, preserving source order");
    const { buildParsedDataZip } = await import("../src/hepBuilder.ts");
    const { loadSceneFromParsedDataZip } = await import("../src/hep.ts");
    // Only this tiny in-memory fixture is exported, never the tracked brochure.
    const hep = await buildParsedDataZip(scene, { encodeRasterImages: false, compression: "store" });
    const restored = await loadSceneFromParsedDataZip(await hep.arrayBuffer());
    assert.deepEqual(rasterPreview(restored).data(), canvas.data(), "HEP preserves overlap pixels");
    checkSelection(restored, createSceneTextSearcher(restored).search("A")[0], "A");
  } finally {
    await tinySession.close();
  }

  // Physical PDF page 5 (source index 4), printed spread 8-9. Baseline comes
  // exclusively from the accepted native appearance, never main or PDF.js.
  const bytes = new Uint8Array(await readFile(new URL(
    "../public/examples/pdfs/20260415+Broschuere_Leo_B2C_RZ+(online+reduz).pdf", import.meta.url)));
  const session = await openPdf({ kind: "bytes", bytes });
  try {
    const scene = await session.compileVectorPage(4);
    assert.equal(scene.textInstanceCount, 2469, "90 clipped labels must not be painted again as vector text");
    assert.equal(scene.rasterLayers.length, 11);
    const queries = ["SolvisLeo", "Wechselrichter", "Batteriespeicher", "Wärmepumpe", "Wallbox", "Photovoltaik"];
    const searcher = createSceneTextSearcher(scene);
    const diagramMatches = queries.map(query => {
      const matches = searcher.search(query);
      const match = matches.find(item => item.bounds.minX > 700 && item.bounds.maxX < 1100 &&
        item.bounds.minY > 200 && item.bounds.maxY < 530);
      assert(match, `diagram search result for ${query}`);
      checkSelection(scene, match, query);
      assert.equal(matches.filter(item => scene.textIndex.pages[0].charInstance[item.startChar] <= -2).length,
        0, `${query}: completely clipped duplicate labels must not remain searchable`);
      return { query, ...match };
    });
    const heatPump = diagramMatches.find(match => match.query === "Wärmepumpe");
    const markerStart = scene.textIndex.pages[0].text.lastIndexOf("D ", heatPump.startChar);
    assert.equal(markerStart, heatPump.startChar - 2);
    checkSelection(scene, { ...heatPump, startChar: markerStart, length: heatPump.length + 2 }, "D Wärmepumpe", true);
    checkSelection(scene, { ...heatPump, startChar: markerStart, length: heatPump.length + 1 }, "D Wärmepump", true);
    // Exercise layout remapping too: a page's index in this grid is not its
    // original source-page index, and fallback quads must translate with it.
    const grid = composeVectorScenesInGrid([scene, scene], 2);
    const rightPage = grid.textIndex.pages[1];
    const quad = new Float32Array(4);
    for (const match of diagramMatches) {
      const translated = createSceneTextSearcher(grid).search(match.query).find(
        item => item.pageIndex === 1 && item.startChar === match.startChar);
      assert(translated);
      assert(computeCharQuad(grid, rightPage, match.startChar, quad, 0));
      assert(quad[0] >= grid.pageRects[4] && quad[2] <= grid.pageRects[6]);
      checkSelection(grid, translated, match.query);
    }
    const reference = {
      sourceSha256: sha(bytes), sourcePageIndex: 4,
      paintHash: sceneFingerprint(Object.fromEntries(Object.entries(scene).filter(([key]) =>
        !["textIndex", "operatorCount", "operatorCountKind", "imageLayerSegmentCount", "sourceSegmentCount",
          "mergedSegmentCount", "discardedTransparentCount", "discardedDegenerateCount",
          "discardedDuplicateCount", "discardedContainedCount"].includes(key)))),
      // Exact CPU output provided to the unchanged GPU viewer: includes every
      // geometry/text store, clip, transform, image pixel and paint-order value.
      paintAndTextHash: sceneFingerprint(Object.fromEntries(Object.entries(scene).filter(([key]) =>
        !["operatorCount", "operatorCountKind", "imageLayerSegmentCount", "sourceSegmentCount",
          "mergedSegmentCount", "discardedTransparentCount", "discardedDegenerateCount",
          "discardedDuplicateCount", "discardedContainedCount"].includes(key)))),
      textSha256: sha(scene.textIndex.pages[0].text),
      imageLayers: scene.rasterLayers.map(layer => ({ width: layer.width, height: layer.height,
        matrix: [...layer.matrix], paintOrder: layer.paintOrder, rgbaSha256: sha(layer.data) })),
      accounting: getSceneSegmentAccounting(scene),
      diagramMatches
    };
    const expected = JSON.parse(await readFile(new URL("./fixtures/brochure-page5.json", import.meta.url), "utf8"));
    assert.equal(reference.paintHash, expected.paintHash, "index filtering must not change any paint resource");
    assert.deepEqual(reference.imageLayers, expected.imageLayers, "every accepted image-layer pixel stays identical");
    if (process.argv.includes("--print-reference")) {
      // Print only: never silently update a reviewed reference after a failure.
      console.log(JSON.stringify(reference, null, 2));
    } else {
      assert.deepEqual(reference, expected, "accepted page-5 paint, text, search geometry and accounting");
    }
  } finally {
    await session.close();
  }
  console.log("native clipped-label, overlap, search/selection and page-5 regressions passed");

  function checkSelection(scene, match, expected, drag = false) {
    assert(match);
    const page = scene.textIndex.pages[match.pageIndex];
    const quad = new Float32Array(4);
    assert(computeCharQuad(scene, page, match.startChar, quad, 0));
    assert([...quad].every(Number.isFinite));
    assert(quad[2] > quad[0] && quad[3] > quad[1]);
    const host = installSelectionTestHost();
    let highlights;
    const controller = createTextSelectionController({ getCanvas: () => host.canvas, adapter: {
      getScene: () => scene,
      clientToScenePoint: (x, y) => ({ x, y }),
      sceneToClientPoint: (x, y) => ({ x, y }),
      setSelectionHighlights: rects => { highlights = rects; }
    } });
    try {
      const x = (quad[0] + quad[2]) / 2;
      const y = (quad[1] + quad[3]) / 2;
      // Real controller's double-click hit test, word selection and text copy
      // payload. No privileged test-only setter of the selection range.
      if (drag) {
        const endQuad = new Float32Array(4);
        assert(computeCharQuad(scene, page, match.startChar + match.length - 1, endQuad, 0));
        host.pointer("pointerdown", quad[0] + (quad[2] - quad[0]) * 0.05, y);
        host.pointer("pointermove", endQuad[2] - (endQuad[2] - endQuad[0]) * 0.05, y);
        host.pointer("pointerup", endQuad[2], y);
      } else {
        for (let click = 0; click < 2; click++) {
          host.pointer("pointerdown", x, y);
          host.pointer("pointerup", x, y);
        }
      }
      assert.equal(controller.getSelectedText(), expected);
      assert.deepEqual(controller.getSelectionRange(), {
        start: { pageIndex: match.pageIndex, offset: match.startChar },
        end: { pageIndex: match.pageIndex, offset: match.startChar + match.length }
      });
      assert.equal(highlights?.length, 4, "one visible label must have one highlight box, never overlapping ghost boxes");
      assert([...highlights].every(Number.isFinite));
      assert(highlights[0] <= quad[0] && highlights[2] >= quad[2]);
    } finally {
      controller.dispose();
      assert.equal(host.listenerCount, 0);
      host.close();
    }
  }
} finally {
  hooks.deregister();
}

function sha(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

function rasterPreview(scene) {
  const canvas = createCanvas(100, 100);
  const context = canvas.getContext("2d");
  for (const layer of [...scene.rasterLayers].sort((a, b) => a.paintOrder - b.paintOrder)) {
    const image = createCanvas(layer.width, layer.height);
    image.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(layer.data), layer.width, layer.height), 0, 0);
    const [a, b, c, d, e, f] = layer.matrix;
    context.setTransform(a, -b, c, -d, e, 100 - f);
    context.drawImage(image, 0, 0, 1, 1);
  }
  return canvas;
}

function clippedOverlapFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F 6 0 R >> /XObject << /Bg 5 0 R /Top 7 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "q 100 0 0 100 0 0 cm /Bg Do Q " +
      "q 10 10 m 20 10 l 20 20 l h W n 1 0 0 rg BT /F 100 Tf 1 0 0 1 10 10 Tm (A) Tj ET Q " +
      "q 4 0 0 10 14 10 cm /Top Do Q BT /F 100 Tf 1 0 0 1 50 60 Tm (B) Tj ET") },
    { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8", Uint8Array.of(0, 0, 255)) },
    { number: 6, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Fixture /Encoding /WinAnsiEncoding >>" },
    { number: 7, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8", Uint8Array.of(0, 255, 0)) }
  ] });
}
