// Focused public API and round-trip regressions for parsed-data ZIP creation.
//
// Vite is used only as an in-process TypeScript/SSR transformer. Middleware mode
// does not bind a network listener, and HMR/WebSocket support is disabled.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";
import { createServer } from "vite";

Promise.try ??= (callback, ...args) => Promise.resolve().then(() => callback(...args));
Uint8Array.prototype.toHex ??= function toHex() {
  return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("hex");
};
Uint8Array.prototype.toBase64 ??= function toBase64() {
  return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("base64");
};
Uint8Array.fromHex ??= (value) => new Uint8Array(Buffer.from(value, "hex"));
Uint8Array.fromBase64 ??= (value) => new Uint8Array(Buffer.from(value, "base64"));

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRootDir = path.resolve(scriptDir, "..");
const fixturePath = path.join(repoRootDir, "public/examples/pdfs/LK Office Level 1.pdf");
const rasterFixturePath = path.join(repoRootDir, "public/examples/pdfs/thesis.pdf");
const optimizedRasterFixturePath = path.join(
  repoRootDir,
  "public/examples/pdfs/20260415+Broschuere_Leo_B2C_RZ+(online+reduz).pdf"
);

function assertSceneCountsEqual(actual, expected, context) {
  for (const key of [
    "pageCount",
    "segmentCount",
    "fillPathCount",
    "fillSegmentCount",
    "textInstanceCount",
    "textGlyphCount",
    "textGlyphSegmentCount"
  ]) {
    assert.equal(actual[key], expected[key], `${context}: ${key} changed`);
  }
}

async function readZip(blob) {
  return JSZip.loadAsync(await blob.arrayBuffer());
}

function sampleRasterLayerAtWorld(layer, worldX, worldY) {
  const [a, b, c, d, e, f] = layer.matrix;
  const det = a * d - b * c;
  assert.ok(Math.abs(det) > 1e-9, "raster layer matrix must be invertible");
  const dx = worldX - e;
  const dy = worldY - f;
  const u = (d * dx - c * dy) / det;
  const v = (-b * dx + a * dy) / det;
  assert.ok(u >= 0 && u <= 1 && v >= 0 && v <= 1, "sample point must be inside the raster layer");
  const x = Math.min(layer.width - 1, Math.max(0, Math.floor(u * layer.width)));
  const y = Math.min(layer.height - 1, Math.max(0, Math.floor(v * layer.height)));
  const offset = (y * layer.width + x) * 4;
  return Array.from(layer.data.subarray(offset, offset + 4));
}

async function run() {
  const viteServer = await createServer({
    configFile: false,
    root: repoRootDir,
    logLevel: "error",
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true },
    appType: "custom"
  });

  try {
    const [
      { buildParsedDataZip },
      { loadPdfSceneFromSource },
      { listSceneRasterLayers, loadSceneFromParsedDataZip }
    ] = await Promise.all([
      viteServer.ssrLoadModule("/src/index.ts"),
      viteServer.ssrLoadModule("/src/pdfObjectGenerator.ts"),
      viteServer.ssrLoadModule("/src/parsedDataZip.ts")
    ]);
    const pdfBytes = await readFile(fixturePath);
    const parsedPdf = await loadPdfSceneFromSource(pdfBytes, { sourceKind: "pdf" });

    const sourceStages = [];
    const sourceZipBlob = await buildParsedDataZip(pdfBytes, {
      sourceLabel: "fixture.pdf",
      encodeRasterImages: false,
      compression: "store",
      compressionLevel: 0,
      onProgress: (progress) => sourceStages.push(progress.stage)
    });
    assert.ok(sourceZipBlob instanceof Blob);
    assert.equal(sourceZipBlob.type, "application/zip");
    const sourceZipBytes = new Uint8Array(await sourceZipBlob.arrayBuffer());
    assert.deepEqual(Array.from(sourceZipBytes.subarray(0, 2)), [0x50, 0x4b]);
    assert.ok(sourceStages.includes("zip-build"));
    assert.equal(sourceStages.at(-1), "complete");

    const sourceRoundTrip = await loadSceneFromParsedDataZip(sourceZipBytes.buffer);
    assertSceneCountsEqual(sourceRoundTrip, parsedPdf.scene, "PDF source round trip");

    const base64ZipBlob = await buildParsedDataZip(pdfBytes.toString("base64"), {
      encodeRasterImages: false,
      compression: "store"
    });
    const base64Zip = await readZip(base64ZipBlob);
    const base64Manifest = JSON.parse(await base64Zip.file("manifest.json").async("string"));
    assert.equal(base64Manifest.sourceFile, "document.pdf");

    const sceneZipBlob = await buildParsedDataZip(parsedPdf.scene, {
      sourceLabel: "already-parsed.pdf",
      sourcePdf: pdfBytes,
      encodeRasterImages: false,
      compression: "store",
      compressionLevel: 0
    });
    const sceneZip = await readZip(sceneZipBlob);
    const sceneManifest = JSON.parse(await sceneZip.file("manifest.json").async("string"));
    assert.equal(sceneManifest.sourceFile, "already-parsed.pdf");
    const sceneRoundTrip = await loadSceneFromParsedDataZip(await sceneZipBlob.arrayBuffer());
    assertSceneCountsEqual(sceneRoundTrip, parsedPdf.scene, "parsed scene round trip");

    const missingRasterScene = {
      ...parsedPdf.scene,
      imagePaintOpCount: Math.max(1, parsedPdf.scene.imagePaintOpCount),
      rasterLayers: [],
      rasterLayerWidth: 0,
      rasterLayerHeight: 0,
      rasterLayerData: new Uint8Array(0),
      rasterLayerMatrix: new Float32Array([1, 0, 0, 1, 0, 0])
    };
    await assert.rejects(
      buildParsedDataZip(missingRasterScene, { encodeRasterImages: false }),
      /Pass options\.sourcePdf/
    );
    await assert.rejects(
      buildParsedDataZip(missingRasterScene, {
        sourcePdf: new Uint8Array([1, 2, 3, 4]),
        encodeRasterImages: false
      }),
      /does not contain PDF data/
    );

    const rasterPdfBytes = await readFile(rasterFixturePath);
    const parsedRasterPdf = await loadPdfSceneFromSource(rasterPdfBytes, {
      sourceKind: "pdf",
      pages: "13"
    });
    const expectedRasterLayers = listSceneRasterLayers(parsedRasterPdf.scene);
    assert.ok(expectedRasterLayers.length > 0, "raster fixture page must contain extracted layers");
    const rasterFallbackScene = {
      ...parsedRasterPdf.scene,
      rasterLayers: [],
      rasterLayerWidth: 0,
      rasterLayerHeight: 0,
      rasterLayerData: new Uint8Array(0),
      rasterLayerMatrix: new Float32Array([1, 0, 0, 1, 0, 0])
    };
    const fallbackZipBlob = await buildParsedDataZip(rasterFallbackScene, {
      sourceLabel: "fallback.pdf",
      sourcePdf: rasterPdfBytes,
      sourcePdfPages: "13",
      encodeRasterImages: false,
      compression: "store"
    });
    const fallbackZip = await readZip(fallbackZipBlob);
    const fallbackManifest = JSON.parse(await fallbackZip.file("manifest.json").async("string"));
    assert.equal(fallbackManifest.sourcePdfFile, "source/source.pdf");
    assert.equal(fallbackManifest.sourcePdfPages, "13");
    assert.ok(fallbackZip.file("source/source.pdf"));
    const fallbackRoundTrip = await loadSceneFromParsedDataZip(await fallbackZipBlob.arrayBuffer());
    const restoredRasterLayers = listSceneRasterLayers(fallbackRoundTrip);
    assert.equal(restoredRasterLayers.length, expectedRasterLayers.length);
    for (let i = 0; i < expectedRasterLayers.length; i += 1) {
      assert.equal(restoredRasterLayers[i].width, expectedRasterLayers[i].width);
      assert.equal(restoredRasterLayers[i].height, expectedRasterLayers[i].height);
      assert.deepEqual(
        Array.from(restoredRasterLayers[i].matrix),
        Array.from(expectedRasterLayers[i].matrix)
      );
    }

    const optimizedRasterPdfBytes = await readFile(optimizedRasterFixturePath);
    const parsedOptimizedRasterPdf = await loadPdfSceneFromSource(optimizedRasterPdfBytes, {
      sourceKind: "pdf",
      pages: "1"
    });
    assert.ok(parsedOptimizedRasterPdf.scene.imagePaintOpCount > 0);
    assert.ok(
      listSceneRasterLayers(parsedOptimizedRasterPdf.scene).length > 0,
      "optimized PDF.js render lists must preserve raster layers"
    );

    const parsedOrderedUnderlayPdf = await loadPdfSceneFromSource(optimizedRasterPdfBytes, {
      sourceKind: "pdf",
      pages: "11"
    });
    const orderedUnderlayLayers = listSceneRasterLayers(parsedOrderedUnderlayPdf.scene);
    assert.equal(orderedUnderlayLayers.length, 1, "leading patterned strokes must share the page underlay capture");
    assert.ok(
      orderedUnderlayLayers[0].width >= 1_700 && orderedUnderlayLayers[0].height >= 1_200,
      "the decorative-circle underlay must retain its full-page arc extent"
    );
    assert.equal(parsedOrderedUnderlayPdf.scene.segmentCount, 2_322, "decorative circles must not remain above table fills");
    assert.equal(parsedOrderedUnderlayPdf.scene.fillPathCount, 156, "ordered underlay capture must preserve vector tables");
    assert.equal(parsedOrderedUnderlayPdf.scene.textInstanceCount, 2_608, "ordered underlay capture must preserve vector text");
    let blackStrokeCount = 0;
    let burgundyStrokeCount = 0;
    for (let i = 0; i < parsedOrderedUnderlayPdf.scene.segmentCount; i += 1) {
      const offset = i * 4;
      const red = parsedOrderedUnderlayPdf.scene.styles[offset + 1];
      const green = parsedOrderedUnderlayPdf.scene.styles[offset + 2];
      const blue = parsedOrderedUnderlayPdf.scene.styles[offset + 3];
      if (Math.abs(red) < 1e-4 && Math.abs(green) < 1e-4 && Math.abs(blue) < 1e-4) {
        blackStrokeCount += 1;
      }
      if (
        Math.abs(red - 80 / 255) < 1e-4 &&
        Math.abs(green - 23 / 255) < 1e-4 &&
        Math.abs(blue - 31 / 255) < 1e-4
      ) {
        burgundyStrokeCount += 1;
      }
    }
    assert.equal(blackStrokeCount, 0, "ColorN pattern strokes must not fall back to black vectors");
    assert.equal(burgundyStrokeCount, 0, "the complete decorative-circle run must stay below the tables");
    const orderedCirclePixel = sampleRasterLayerAtWorld(orderedUnderlayLayers[0], 361, 694);
    assert.ok(
      Math.abs(orderedCirclePixel[0] - 244) <= 2 &&
        Math.abs(orderedCirclePixel[1] - 154) <= 2 &&
        Math.abs(orderedCirclePixel[2] - 127) <= 2 &&
        orderedCirclePixel[3] >= 253,
      "ColorN circle strokes must retain their PDF shading pattern"
    );
    const tableOverlapX = 724.574;
    const tableOverlapY = 352.798;
    const underTableCirclePixel = sampleRasterLayerAtWorld(
      orderedUnderlayLayers[0],
      tableOverlapX,
      tableOverlapY
    );
    assert.ok(
      underTableCirclePixel[0] > 245 &&
        underTableCirclePixel[1] < 100 &&
        underTableCirclePixel[2] < 80 &&
        underTableCirclePixel[3] > 220,
      "the circle paint must exist in the underlay at the table intersection"
    );
    let hasOpaqueCreamTableFill = false;
    for (let i = 0; i < parsedOrderedUnderlayPdf.scene.fillPathCount; i += 1) {
      const offset = i * 4;
      const minX = parsedOrderedUnderlayPdf.scene.fillPathMetaA[offset + 2];
      const minY = parsedOrderedUnderlayPdf.scene.fillPathMetaA[offset + 3];
      const maxX = parsedOrderedUnderlayPdf.scene.fillPathMetaB[offset];
      const maxY = parsedOrderedUnderlayPdf.scene.fillPathMetaB[offset + 1];
      const red = parsedOrderedUnderlayPdf.scene.fillPathMetaB[offset + 2];
      const green = parsedOrderedUnderlayPdf.scene.fillPathMetaB[offset + 3];
      const blue = parsedOrderedUnderlayPdf.scene.fillPathMetaC[offset + 2];
      const alpha = parsedOrderedUnderlayPdf.scene.fillPathMetaC[offset + 3];
      if (
        tableOverlapX >= minX && tableOverlapX <= maxX &&
        tableOverlapY >= minY && tableOverlapY <= maxY &&
        Math.abs(red - 251 / 255) < 1e-4 &&
        Math.abs(green - 243 / 255) < 1e-4 &&
        Math.abs(blue - 240 / 255) < 1e-4 &&
        Math.abs(alpha - 1) < 1e-4
      ) {
        hasOpaqueCreamTableFill = true;
        break;
      }
    }
    assert.ok(hasOpaqueCreamTableFill, "an opaque table fill must remain vector-rendered above the circle underlay");

    const parsedOrderedPatternPdf = await loadPdfSceneFromSource(optimizedRasterPdfBytes, {
      sourceKind: "pdf",
      pages: "6"
    });
    const orderedPatternLayers = listSceneRasterLayers(parsedOrderedPatternPdf.scene);
    assert.equal(orderedPatternLayers.length, 1, "interleaved ColorN strokes require one ordered graphics composite");
    assert.ok(
      orderedPatternLayers[0].width <= 1_800 && orderedPatternLayers[0].height <= 1_300,
      "ordered vector-pattern capture must stay at the bounded shading scale"
    );
    assert.equal(parsedOrderedPatternPdf.scene.segmentCount, 0, "ordered pattern graphics must not be emitted twice");
    assert.equal(parsedOrderedPatternPdf.scene.fillPathCount, 0, "ordered pattern fills must not be emitted twice");
    assert.equal(parsedOrderedPatternPdf.scene.textInstanceCount, 1_461, "ordered graphics capture must preserve vector text");
    const orderedPatternSamples = [
      sampleRasterLayerAtWorld(orderedPatternLayers[0], 900, 236.543),
      sampleRasterLayerAtWorld(orderedPatternLayers[0], 930, 252.274),
      sampleRasterLayerAtWorld(orderedPatternLayers[0], 970, 228.581)
    ];
    assert.ok(
      orderedPatternSamples.every((pixel) => pixel[0] > 245 && pixel[1] >= 70 && pixel[1] <= 190 && pixel[2] < 60 && pixel[3] > 250),
      "interleaved ColorN strokes must retain their red/orange gradients and PDF paint order"
    );

    const parsedShadingAndDashPdf = await loadPdfSceneFromSource(optimizedRasterPdfBytes, {
      sourceKind: "pdf",
      pages: "12"
    });
    const shadingLayers = listSceneRasterLayers(parsedShadingAndDashPdf.scene);
    assert.equal(shadingLayers.length, 1, "shadingFill operators must produce a raster layer");
    const sampledShadingColors = new Set();
    for (let i = 0; i + 3 < shadingLayers[0].data.length; i += 388) {
      if (shadingLayers[0].data[i + 3] > 0) {
        sampledShadingColors.add(
          `${shadingLayers[0].data[i]},${shadingLayers[0].data[i + 1]},${shadingLayers[0].data[i + 2]}`
        );
      }
    }
    assert.ok(sampledShadingColors.size > 16, "captured shading content must retain gradient color variation");
    const maskedCirclePixel = sampleRasterLayerAtWorld(shadingLayers[0], 500, 700);
    assert.ok(
      maskedCirclePixel[3] >= 40,
      "soft-mask consumers must be composited with their luminosity-mask definitions"
    );
    const maskedCenterDotPixel = sampleRasterLayerAtWorld(shadingLayers[0], 800, 436.4);
    assert.ok(
      Math.abs(maskedCenterDotPixel[0] - 233) <= 2 &&
        Math.abs(maskedCenterDotPixel[1] - 198) <= 2 &&
        Math.abs(maskedCenterDotPixel[2] - 186) <= 2 &&
        maskedCenterDotPixel[3] >= 253,
      "soft-masked fill and dash consumers must be captured in PDF paint order"
    );
    let flatSalmonVectorFillCount = 0;
    for (let i = 0; i < parsedShadingAndDashPdf.scene.fillPathCount; i += 1) {
      const offset = i * 4;
      const red = parsedShadingAndDashPdf.scene.fillPathMetaB[offset + 2];
      const green = parsedShadingAndDashPdf.scene.fillPathMetaB[offset + 3];
      const blue = parsedShadingAndDashPdf.scene.fillPathMetaC[offset + 2];
      if (Math.abs(red - 1) < 1e-4 && Math.abs(green - 76 / 255) < 1e-4 && Math.abs(blue - 41 / 255) < 1e-4) {
        flatSalmonVectorFillCount += 1;
      }
    }
    assert.equal(flatSalmonVectorFillCount, 0, "soft-mask consumers must not be emitted again as opaque vector fills");
    assert.ok(
      parsedShadingAndDashPdf.scene.sourceSegmentCount > 1_000,
      "setDash operators must expand stroked paths into painted dash spans"
    );
    assert.equal(parsedShadingAndDashPdf.scene.textInstanceCount, 1_764, "shading fallback must preserve vector text");
    let darkTableTextCount = 0;
    for (let i = 0; i < parsedShadingAndDashPdf.scene.textInstanceCount; i += 1) {
      const offset = i * 4;
      const red = parsedShadingAndDashPdf.scene.textInstanceC[offset];
      const green = parsedShadingAndDashPdf.scene.textInstanceC[offset + 1];
      const blue = parsedShadingAndDashPdf.scene.textInstanceC[offset + 2];
      const alpha = parsedShadingAndDashPdf.scene.textInstanceC[offset + 3];
      if (
        Math.abs(red - 44 / 255) < 1e-4 &&
        Math.abs(green - 46 / 255) < 1e-4 &&
        Math.abs(blue - 53 / 255) < 1e-4 &&
        Math.abs(alpha - 1) < 1e-4
      ) {
        darkTableTextCount += 1;
      }
    }
    assert.equal(darkTableTextCount, 1_649, "PDF display/sRGB text colors must survive extraction unchanged");

    const shadingZipBlob = await buildParsedDataZip(parsedShadingAndDashPdf.scene, {
      sourceLabel: "shading-and-dash.pdf",
      compression: "store"
    });
    const shadingZip = await readZip(shadingZipBlob);
    const shadingManifest = JSON.parse(await shadingZip.file("manifest.json").async("string"));
    const encodedShading = shadingManifest.scene.rasterLayers[0];
    assert.match(encodedShading.file, /\.(?:png|webp)$/);
    assert.match(encodedShading.encoding, /^(?:png|webp)$/);
    const encodedShadingBytes = await shadingZip.file(encodedShading.file).async("uint8array");
    assert.ok(encodedShadingBytes.length < shadingLayers[0].data.length, "Node ZIP builds must compress raster layers");
    const encodedShadingRoundTrip = await loadSceneFromParsedDataZip(await shadingZipBlob.arrayBuffer());
    const decodedShadingLayers = listSceneRasterLayers(encodedShadingRoundTrip);
    assert.equal(decodedShadingLayers.length, 1, "Node ZIP loads must decode encoded raster layers");
    assert.equal(decodedShadingLayers[0].width, shadingLayers[0].width);
    assert.equal(decodedShadingLayers[0].height, shadingLayers[0].height);
    const decodedCenterDotPixel = sampleRasterLayerAtWorld(decodedShadingLayers[0], 800, 436.4);
    assert.ok(
      decodedCenterDotPixel[0] > 210 &&
        decodedCenterDotPixel[1] > 170 &&
        decodedCenterDotPixel[2] > 160 &&
        decodedCenterDotPixel[3] > 245,
      "encoded soft-mask composites must survive the Node ZIP round trip"
    );

    const parsedBackdropBlendPdf = await loadPdfSceneFromSource(optimizedRasterPdfBytes, {
      sourceKind: "pdf",
      pages: "14"
    });
    const backdropBlendLayers = listSceneRasterLayers(parsedBackdropBlendPdf.scene);
    assert.ok(parsedBackdropBlendPdf.scene.imagePaintOpCount > 0, "blend fixture must contain an image backdrop");
    assert.equal(
      backdropBlendLayers.length,
      1,
      "backdrop-dependent blend groups and their image backdrop must retain PDF paint order in one composite"
    );
    assert.equal(parsedBackdropBlendPdf.scene.segmentCount, 0, "composited blend paths must not be emitted twice");
    assert.equal(
      parsedBackdropBlendPdf.scene.sourceSegmentCount,
      0,
      "composited blend strokes must not remain in vector source data"
    );
    assert.equal(parsedBackdropBlendPdf.scene.fillPathCount, 0, "composited blend fills must not be emitted twice");
    assert.ok(
      parsedBackdropBlendPdf.scene.textInstanceCount > 1_000,
      "backdrop-inclusive graphics capture must preserve searchable vector text"
    );

    await assert.rejects(
      buildParsedDataZip(new Uint8Array([1]), { compression: "deflate", compressionLevel: 0 }),
      /compressionLevel must be an integer from 1 to 9/
    );
    await assert.rejects(
      buildParsedDataZip(new Uint8Array([1]), { compression: "gzip" }),
      /compression must be either "deflate" or "store"/
    );

    console.log("Parsed-data ZIP regressions passed");
  } finally {
    await viteServer.close();
  }
}

run().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
