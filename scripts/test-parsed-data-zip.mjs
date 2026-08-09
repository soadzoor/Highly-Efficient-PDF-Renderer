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
