import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import JSZip from "jszip";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const forbiddenResolutions = [];
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === "pdf-lib" || specifier.startsWith("pdf-lib/") ||
      specifier === "pdfjs-dist" || specifier.startsWith("pdfjs-dist/")
    ) {
      forbiddenResolutions.push({ specifier, parentURL: context.parentURL });
      throw new Error(`HEP v6 raster recovery resolved forbidden dependency ${specifier}.`);
    }
    if (
      context.parentURL?.includes("/src/") &&
      /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const [
    { buildParsedDataZip },
    { listSceneRasterLayers, loadSceneFromParsedDataZip },
    { extractPdfRasterScene }
  ] = await Promise.all([
    import("../src/hepBuilder.ts"),
    import("../src/hep.ts"),
    import("../src/pdfVectorExtractor.ts")
  ]);

  const sourcePdf = imagePdf();
  const expectedRasterScene = await extractPdfRasterScene(
    toArrayBuffer(sourcePdf),
    { pages: "1-2", maxPagesPerRow: 2 }
  );
  const expectedLayers = listSceneRasterLayers(expectedRasterScene);
  assert.equal(expectedRasterScene.pageCount, 2);
  assert.equal(expectedRasterScene.pagesPerRow, 2);
  assert.equal(expectedRasterScene.imagePaintOpCount, 2);
  assert.equal(expectedLayers.length, 2);
  assert.deepEqual(expectedLayers.map((layer) => layer.pageIndex), [0, 1]);
  assert.deepEqual([...expectedLayers[0].data], [255, 0, 0, 255, 0, 128, 255, 255]);

  const missingRasterScene = {
    ...expectedRasterScene,
    rasterLayers: [],
    rasterLayerWidth: 0,
    rasterLayerHeight: 0,
    rasterLayerData: new Uint8Array(0),
    rasterLayerMatrix: new Float32Array([1, 0, 0, 1, 0, 0])
  };
  const hep = await buildParsedDataZip(missingRasterScene, {
    sourceLabel: "native-raster-recovery.pdf",
    sourcePdf,
    sourcePdfPages: "1-2",
    encodeRasterImages: false,
    compression: "store"
  });
  const hepBytes = await hep.arrayBuffer();
  const archive = await JSZip.loadAsync(hepBytes);
  const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
  assert.equal(manifest.formatVersion, 6);
  assert.equal(manifest.sourcePdfFile, "source/source.pdf");
  assert.equal(manifest.sourcePdfPages, "1-2");
  assert.ok(archive.file("source/source.pdf"));
  assert.deepEqual(manifest.scene.rasterLayers, []);

  const recoveredScene = await loadSceneFromParsedDataZip(hepBytes);
  const recoveredLayers = listSceneRasterLayers(recoveredScene);
  assert.equal(recoveredScene.pageCount, 2);
  assert.equal(recoveredScene.pagesPerRow, 2);
  assert.deepEqual([...recoveredScene.pageRects], [...expectedRasterScene.pageRects]);
  assert.equal(recoveredLayers.length, expectedLayers.length);
  for (let index = 0; index < expectedLayers.length; index += 1) {
    assert.equal(recoveredLayers[index].pageIndex, expectedLayers[index].pageIndex);
    assert.equal(recoveredLayers[index].paintOrder, expectedLayers[index].paintOrder);
    assert.equal(recoveredLayers[index].width, expectedLayers[index].width);
    assert.equal(recoveredLayers[index].height, expectedLayers[index].height);
    assert.deepEqual([...recoveredLayers[index].matrix], [...expectedLayers[index].matrix]);
    assert.deepEqual([...recoveredLayers[index].data], [...expectedLayers[index].data]);
  }
  assert.deepEqual(
    forbiddenResolutions,
    [],
    "native HEP v6 embedded-source recovery must never resolve PDF.js or pdf-lib"
  );

  console.log("HEP v6 native raster recovery test passed");
} finally {
  hooks.deregister();
}

function imagePdf() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 80] " +
          "/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>"
      },
      {
        number: 4,
        body: tinyPdfStream("", "q 20 0 0 10 5 15 cm /Im0 Do Q\n")
      },
      {
        number: 5,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 2 /Height 1 " +
            "/ColorSpace /DeviceRGB /BitsPerComponent 8 /Interpolate true",
          Uint8Array.of(255, 0, 0, 0, 128, 255)
        )
      },
      {
        number: 6,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 60 120] /Rotate 90 " +
          "/Resources << /XObject << /Im1 8 0 R >> >> /Contents 7 0 R >>"
      },
      {
        number: 7,
        body: tinyPdfStream("", "q 12 0 0 24 7 11 cm /Im1 Do Q\n")
      },
      {
        number: 8,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 1 /Height 2 " +
            "/ColorSpace /DeviceRGB /BitsPerComponent 8",
          Uint8Array.of(10, 20, 30, 40, 50, 60)
        )
      }
    ]
  });
}

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
