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

function lineWindingDelta(ax, ay, bx, by, px, py) {
  const upward = ay <= py && by > py;
  const downward = ay > py && by <= py;
  if (!upward && !downward) {
    return 0;
  }
  const denominator = by - ay;
  if (Math.abs(denominator) <= 1e-6) {
    return 0;
  }
  const xCross = ax + ((py - ay) * (bx - ax)) / denominator;
  return xCross > px ? (upward ? 1 : -1) : 0;
}

function quadraticWindingDelta(ax, ay, bx, by, cx, cy, px, py) {
  const quadraticY = ay - 2 * by + cy;
  const linearY = 2 * (by - ay);
  const constantY = ay - py;
  const roots = [];
  if (Math.abs(quadraticY) <= 1e-8) {
    if (Math.abs(linearY) > 1e-8) {
      roots.push(-constantY / linearY);
    }
  } else {
    const discriminant = linearY * linearY - 4 * quadraticY * constantY;
    if (discriminant >= 0) {
      const sqrtDiscriminant = Math.sqrt(discriminant);
      roots.push(
        (-linearY - sqrtDiscriminant) / (2 * quadraticY),
        (-linearY + sqrtDiscriminant) / (2 * quadraticY)
      );
    }
  }

  let winding = 0;
  let previousRoot = Number.NaN;
  for (const root of roots) {
    if (root < -1e-5 || root >= 1 - 1e-5 || Math.abs(root - previousRoot) <= 1e-5) {
      continue;
    }
    previousRoot = root;
    const t = Math.max(0, Math.min(1, root));
    const oneMinusT = 1 - t;
    const xCross = oneMinusT * oneMinusT * ax + 2 * oneMinusT * t * bx + t * t * cx;
    const derivativeY = linearY + 2 * quadraticY * t;
    if (xCross > px && Math.abs(derivativeY) > 1e-6) {
      winding += derivativeY > 0 ? 1 : -1;
    }
  }
  return winding;
}

function textGlyphWindingAt(scene, glyphIndex, x, y) {
  const glyphOffset = glyphIndex * 4;
  const segmentStart = Math.max(0, Math.trunc(scene.textGlyphMetaA[glyphOffset]));
  const segmentCount = Math.max(0, Math.trunc(scene.textGlyphMetaA[glyphOffset + 1]));
  let winding = 0;
  for (let i = 0; i < segmentCount; i += 1) {
    const offset = (segmentStart + i) * 4;
    const ax = scene.textGlyphSegmentsA[offset];
    const ay = scene.textGlyphSegmentsA[offset + 1];
    const bx = scene.textGlyphSegmentsA[offset + 2];
    const by = scene.textGlyphSegmentsA[offset + 3];
    const cx = scene.textGlyphSegmentsB[offset];
    const cy = scene.textGlyphSegmentsB[offset + 1];
    winding += scene.textGlyphSegmentsB[offset + 2] >= 1
      ? quadraticWindingDelta(ax, ay, bx, by, cx, cy, x, y)
      : lineWindingDelta(ax, ay, cx, cy, x, y);
  }
  return winding;
}

function midpointCoverageAcrossWindings(first, second) {
  if ((first !== 0) !== (second !== 0)) {
    return 0.5;
  }
  return first !== 0 ? 1 : 0;
}

function assertBrochureOverlapCoverage(scene) {
  const page = scene.textIndex?.pages[0];
  assert.ok(page, "brochure page must expose a searchable text index");
  const wordStart = page.text.indexOf("zuverlässig");
  assert.notEqual(wordStart, -1, "brochure fixture must contain zuverlässig");
  const instanceIndex = page.charInstance[wordStart + 3];
  assert.ok(instanceIndex >= 0, "the first e in zuverlässig must have vector geometry");
  const glyphIndex = Math.trunc(scene.textInstanceB[instanceIndex * 4 + 2]);
  const probe = 1e-5;

  const internalEdgeWindings = [
    textGlyphWindingAt(scene, glyphIndex, 0.4, 0.291015625 + probe),
    textGlyphWindingAt(scene, glyphIndex, 0.4, 0.291015625 - probe)
  ];
  assert.ok(
    internalEdgeWindings.every((winding) => winding !== 0),
    "the brochure e crossbar edge must be filled on both sides"
  );
  assert.equal(
    midpointCoverageAcrossWindings(...internalEdgeWindings),
    1,
    "an overlap-only contour edge must stay fully opaque"
  );

  const coincidentExteriorWindings = [
    textGlyphWindingAt(scene, glyphIndex, 0.4, 0.196533203 + probe),
    textGlyphWindingAt(scene, glyphIndex, 0.4, 0.196533203 - probe)
  ];
  assert.ok(
    coincidentExteriorWindings.includes(0) &&
      coincidentExteriorWindings.some((winding) => Math.abs(winding) === 2),
    "the brochure e lower edge must retain its coincident two-contour transition"
  );
  assert.equal(
    midpointCoverageAcrossWindings(...coincidentExteriorWindings),
    0.5,
    "coincident exterior contours must be antialiased as one boundary"
  );
}

async function readZip(blob) {
  return JSZip.loadAsync(await blob.arrayBuffer());
}

async function mutateInterleavedFloat32Texture(zip, manifest, textureName, mutate) {
  const texture = manifest.textures.find((entry) => entry.name === textureName);
  assert.ok(texture, `missing ${textureName} manifest entry`);
  assert.equal(texture.componentType, "float32");
  assert.equal(texture.layout, "interleaved");
  assert.equal(texture.byteShuffle, false);
  assert.equal(texture.predictor, "none");
  const zipEntry = zip.file(texture.file);
  assert.ok(zipEntry, `missing ${textureName} payload`);
  const bytes = (await zipEntry.async("uint8array")).slice();
  assert.equal(bytes.byteLength % 4, 0);
  const values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  mutate(values);
  zip.file(texture.file, bytes, { compression: "STORE" });
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

function evaluateSceneGradientParameter(scene, gradientIndex, worldX, worldY) {
  assert.ok(gradientIndex >= 0 && gradientIndex < scene.gradientCount);
  const offset = gradientIndex * 4;
  const a = scene.gradientMetaB[offset];
  const b = scene.gradientMetaB[offset + 1];
  const c = scene.gradientMetaB[offset + 2];
  const d = scene.gradientMetaB[offset + 3];
  const e = scene.gradientMetaC[offset];
  const f = scene.gradientMetaC[offset + 1];
  const qx = a * worldX + c * worldY + e;
  const qy = b * worldX + d * worldY + f;
  if (
    scene.gradientMetaA[offset + 1] >= 0.5 &&
    (
      qx < scene.gradientMetaE[offset] ||
      qy < scene.gradientMetaE[offset + 1] ||
      qx > scene.gradientMetaE[offset + 2] ||
      qy > scene.gradientMetaE[offset + 3]
    )
  ) {
    return null;
  }
  const p0x = scene.gradientMetaC[offset + 2];
  const p0y = scene.gradientMetaC[offset + 3];
  const p1x = scene.gradientMetaD[offset];
  const p1y = scene.gradientMetaD[offset + 1];
  const kind = Math.round(scene.gradientMetaA[offset]);
  if (kind === 0) {
    const dx = p1x - p0x;
    const dy = p1y - p0y;
    const denominator = dx * dx + dy * dy;
    return denominator > 1e-12
      ? ((qx - p0x) * dx + (qy - p0y) * dy) / denominator
      : null;
  }

  assert.equal(kind, 1, `gradient ${gradientIndex} must be axial or radial`);
  const dcx = p1x - p0x;
  const dcy = p1y - p0y;
  const radius0 = scene.gradientMetaD[offset + 2];
  const dr = scene.gradientMetaD[offset + 3] - radius0;
  const px = qx - p0x;
  const py = qy - p0y;
  const qa = dcx * dcx + dcy * dcy - dr * dr;
  const qb = -2 * (px * dcx + py * dcy + radius0 * dr);
  const qc = px * px + py * py - radius0 ** 2;
  let roots;
  if (Math.abs(qa) <= 1e-10) {
    if (Math.abs(qb) <= 1e-10) {
      return null;
    }
    roots = [-qc / qb];
  } else {
    const discriminant = qb * qb - 4 * qa * qc;
    if (discriminant < 0) {
      return null;
    }
    const rootDelta = Math.sqrt(Math.max(0, discriminant));
    roots = [(-qb - rootDelta) / (2 * qa), (-qb + rootDelta) / (2 * qa)];
  }

  let bestRoot = null;
  for (const root of roots) {
    if (
      Number.isFinite(root) &&
      radius0 + root * dr >= 0 &&
      (bestRoot === null || root > bestRoot)
    ) {
      bestRoot = root;
    }
  }
  return bestRoot;
}

function sampleSceneGradient(scene, gradientIndex, worldX, worldY) {
  const t = evaluateSceneGradientParameter(scene, gradientIndex, worldX, worldY);
  if (t === null) {
    return [0, 0, 0, 0];
  }
  const sampleX = Math.min(1, Math.max(0, t)) * 1023;
  const x0 = Math.floor(sampleX);
  const x1 = Math.min(1023, x0 + 1);
  const amount = sampleX - x0;
  const rowOffset = gradientIndex * 1024 * 4;
  return [0, 1, 2, 3].map((channel) => {
    const left = scene.gradientLut[rowOffset + x0 * 4 + channel];
    const right = scene.gradientLut[rowOffset + x1 * 4 + channel];
    return left + (right - left) * amount;
  });
}

function assertApprox(actual, expected, tolerance, context) {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${context}: expected ${expected} +/- ${tolerance}, got ${actual}`
  );
}

function testSyntheticRadialGradientMath() {
  const scene = {
    gradientCount: 3,
    gradientMetaA: new Float32Array([
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0
    ]),
    gradientMetaB: new Float32Array([
      1, 0, 0, 1,
      0.5, 0, 0, 0.25,
      1, 0, 0, 1
    ]),
    gradientMetaC: new Float32Array([
      0, 0, 0, 0,
      -1, -3, 0, 0,
      0, 0, 0, 0
    ]),
    gradientMetaD: new Float32Array([
      0, 0, 0, 10,
      2, 0, 1, 3,
      1, 0, 4, 1
    ]),
    gradientMetaE: new Float32Array(12)
  };

  assertApprox(
    evaluateSceneGradientParameter(scene, 0, 5, 0),
    0.5,
    1e-9,
    "concentric expanding radial gradient"
  );
  assertApprox(
    evaluateSceneGradientParameter(scene, 1, 8, 12),
    0.5,
    1e-9,
    "translated tangent radial gradient linear root"
  );
  assertApprox(
    evaluateSceneGradientParameter(scene, 2, 3, 0),
    0.5,
    1e-9,
    "shrinking radial gradient must ignore its negative-radius root"
  );
}

function assertNativeGradientResourcesEqual(actual, expected, context) {
  for (const key of [
    "gradientCount",
    "gradientFillPathCount",
    "gradientFillSegmentCount",
    "gradientStrokeRunCount",
    "gradientStrokeSegmentCount"
  ]) {
    assert.equal(actual[key], expected[key], `${context}: ${key} changed`);
  }
  for (const key of [
    "gradientMetaA",
    "gradientMetaB",
    "gradientMetaC",
    "gradientMetaD",
    "gradientMetaE",
    "gradientLut",
    "gradientFillPathMetaA",
    "gradientFillPathMetaB",
    "gradientFillPathMetaC",
    "gradientFillPaintMeta",
    "gradientFillSegmentsA",
    "gradientFillSegmentsB",
    "gradientStrokeRunMetaA",
    "gradientStrokeRunMetaB",
    "gradientStrokeEndpoints",
    "gradientStrokePrimitiveMeta",
    "gradientStrokePrimitiveBounds",
    "gradientStrokeStyles"
  ]) {
    assert.deepEqual(Array.from(actual[key]), Array.from(expected[key]), `${context}: ${key} changed`);
  }
}

async function run() {
  testSyntheticRadialGradientMath();
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
      { listSceneRasterLayers, loadSceneFromParsedDataZip },
      { composeVectorScenesInGrid }
    ] = await Promise.all([
      viteServer.ssrLoadModule("/src/index.ts"),
      viteServer.ssrLoadModule("/src/pdfObjectGenerator.ts"),
      viteServer.ssrLoadModule("/src/parsedDataZip.ts"),
      viteServer.ssrLoadModule("/src/pdfVectorExtractor.ts")
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

    const sourceZipArchive = await JSZip.loadAsync(sourceZipBytes);
    const sourceManifest = JSON.parse(await sourceZipArchive.file("manifest.json").async("string"));
    assert.equal(sourceManifest.formatVersion, 6, "native gradient scenes require the v6 ZIP schema");
    for (const unsupportedVersion of [5, 7]) {
      const incompatibleZip = await JSZip.loadAsync(sourceZipBytes);
      const incompatibleManifest = {
        ...sourceManifest,
        formatVersion: unsupportedVersion
      };
      incompatibleZip.file("manifest.json", JSON.stringify(incompatibleManifest));
      const incompatibleBytes = await incompatibleZip.generateAsync({ type: "arraybuffer", compression: "STORE" });
      await assert.rejects(
        loadSceneFromParsedDataZip(incompatibleBytes),
        new RegExp(`format v${unsupportedVersion} is not supported`)
      );
    }

    const sourceRoundTrip = await loadSceneFromParsedDataZip(sourceZipBytes.buffer);
    assertSceneCountsEqual(sourceRoundTrip, parsedPdf.scene, "PDF source round trip");
    assertNativeGradientResourcesEqual(sourceRoundTrip, parsedPdf.scene, "PDF source round trip");

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
    assertNativeGradientResourcesEqual(sceneRoundTrip, parsedPdf.scene, "parsed scene round trip");

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
    assertBrochureOverlapCoverage(parsedOptimizedRasterPdf.scene);
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
    assert.equal(orderedUnderlayLayers.length, 1, "the later page shading must remain a selective raster paint");
    assert.equal(orderedUnderlayLayers[0].width, 1_663);
    assert.equal(orderedUnderlayLayers[0].height, 250);
    assert.equal(orderedUnderlayLayers[0].paintOrder, 501);
    assert.equal(orderedUnderlayLayers[0].pageIndex, 0);
    assert.equal(parsedOrderedUnderlayPdf.scene.gradientCount, 5, "ColorN strokes must retain five native gradients");
    assert.equal(parsedOrderedUnderlayPdf.scene.gradientStrokeRunCount, 13, "the complete visible circle prefix must retain ordered native runs");
    assert.equal(parsedOrderedUnderlayPdf.scene.gradientStrokeSegmentCount, 550);
    const nativeCircleSourceRefs = [];
    const nativeCirclePaintOrders = [];
    const nativeCircleSegmentCounts = [];
    for (let i = 0; i < parsedOrderedUnderlayPdf.scene.gradientStrokeRunCount; i += 1) {
      const offset = i * 4;
      nativeCircleSourceRefs.push(parsedOrderedUnderlayPdf.scene.gradientStrokeRunMetaA[offset + 2]);
      nativeCirclePaintOrders.push(parsedOrderedUnderlayPdf.scene.gradientStrokeRunMetaB[offset]);
      nativeCircleSegmentCounts.push(parsedOrderedUnderlayPdf.scene.gradientStrokeRunMetaA[offset + 1]);
      assert.equal(parsedOrderedUnderlayPdf.scene.gradientStrokeRunMetaA[offset + 3], -1);
      assert.equal(parsedOrderedUnderlayPdf.scene.gradientStrokeRunMetaB[offset + 1], 0);
      assert.ok(
        parsedOrderedUnderlayPdf.scene.gradientStrokeRunMetaB[offset] < orderedUnderlayLayers[0].paintOrder,
        "the decorative-circle prefix must remain below later raster paints"
      );
    }
    assert.deepEqual(nativeCircleSourceRefs, [0, 1, 2, 3, 4, -1, -1, -1, -1, -1, -1, -1, -1]);
    assert.deepEqual(nativeCirclePaintOrders, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14]);
    assert.deepEqual(nativeCircleSegmentCounts, [71, 71, 15, 40, 6, 84, 52, 37, 84, 8, 41, 39, 2]);
    for (let gradientIndex = 0; gradientIndex < 5; gradientIndex += 1) {
      const colors = new Set();
      const rowOffset = gradientIndex * 1024 * 4;
      for (let x = 0; x < 1024; x += 32) {
        const offset = rowOffset + x * 4;
        colors.add(Array.from(parsedOrderedUnderlayPdf.scene.gradientLut.subarray(offset, offset + 4)).join(","));
      }
      assert.ok(colors.size > 4, `native circle gradient ${gradientIndex} must retain color variation`);
    }
    assert.equal(parsedOrderedUnderlayPdf.scene.segmentCount, 2_322, "decorative circles must not remain in the ordinary stroke batch");
    assert.equal(parsedOrderedUnderlayPdf.scene.fillPathCount, 156, "native circle extraction must preserve vector tables");
    assert.equal(parsedOrderedUnderlayPdf.scene.textInstanceCount, 2_608, "native circle extraction must preserve vector text");
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
    assert.equal(burgundyStrokeCount, 0, "solid companion circles must stay in the ordered native prefix");
    const tableOverlapX = 724.574;
    const tableOverlapY = 352.798;
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

    const nativeCircleZipBlob = await buildParsedDataZip(parsedOrderedUnderlayPdf.scene, {
      sourceLabel: "native-circle-strokes.pdf",
      encodeRasterImages: false,
      compression: "store"
    });
    const nativeCircleRoundTrip = await loadSceneFromParsedDataZip(await nativeCircleZipBlob.arrayBuffer());
    assertNativeGradientResourcesEqual(
      nativeCircleRoundTrip,
      parsedOrderedUnderlayPdf.scene,
      "page 11 native gradient stroke round trip"
    );
    const roundTripCircleLayers = listSceneRasterLayers(nativeCircleRoundTrip);
    assert.equal(roundTripCircleLayers.length, 1);
    assert.equal(roundTripCircleLayers[0].paintOrder, 501);
    assert.equal(roundTripCircleLayers[0].pageIndex, 0);

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

    const parsedInterleavedRasterPdf = await loadPdfSceneFromSource(optimizedRasterPdfBytes, {
      sourceKind: "pdf",
      pages: "3"
    });
    const interleavedRasterLayers = listSceneRasterLayers(parsedInterleavedRasterPdf.scene);
    assert.equal(
      interleavedRasterLayers.length,
      1,
      "image-interleaved shadings must share one source-ordered raster composite"
    );
    assert.ok(
      interleavedRasterLayers[0].width * interleavedRasterLayers[0].height < 4_500_000,
      "the ordered raster composite must stay within the bounded page texture budget"
    );
    const interleavedOverlapPixel = sampleRasterLayerAtWorld(
      interleavedRasterLayers[0],
      372.6666667,
      607.89
    );
    assert.ok(
      interleavedOverlapPixel[0] >= 142 && interleavedOverlapPixel[0] <= 146 &&
        interleavedOverlapPixel[1] >= 47 && interleavedOverlapPixel[1] <= 51 &&
        interleavedOverlapPixel[2] >= 35 && interleavedOverlapPixel[2] <= 39 &&
        interleavedOverlapPixel[3] >= 253,
      "the early gradient must remain composited over the first image"
    );
    const lateShadingPixel = sampleRasterLayerAtWorld(
      interleavedRasterLayers[0],
      924.6666667,
      232.5566667
    );
    assert.ok(
      lateShadingPixel[0] >= 253 &&
        lateShadingPixel[1] >= 72 && lateShadingPixel[1] <= 78 &&
        lateShadingPixel[2] >= 40 && lateShadingPixel[2] <= 46 &&
        lateShadingPixel[3] >= 69 && lateShadingPixel[3] <= 73,
      "the post-image shading must remain after the intervening image"
    );

    const parsedPhotoOverlayPdf = await loadPdfSceneFromSource(optimizedRasterPdfBytes, {
      sourceKind: "pdf",
      pages: "13"
    });
    const photoOverlayLayers = listSceneRasterLayers(parsedPhotoOverlayPdf.scene);
    const photoOverlayScene = parsedPhotoOverlayPdf.scene;
    assert.equal(photoOverlayLayers.length, 2, "page 13 must retain only its photo and signature raster paints");
    assert.equal(parsedPhotoOverlayPdf.scene.segmentCount, 56, "page 13 strokes must remain vector-rendered");
    assert.equal(parsedPhotoOverlayPdf.scene.fillPathCount, 16, "page 13 fills must remain vector-rendered");
    assert.equal(parsedPhotoOverlayPdf.scene.textInstanceCount, 976, "page 13 text must remain vector-rendered");
    assert.equal(photoOverlayScene.gradientCount, 1, "the soft-mask definition must become one native gradient");
    assert.equal(photoOverlayScene.gradientFillPathCount, 1, "the salmon circle must become one native masked fill");
    assert.equal(photoOverlayScene.gradientFillSegmentCount, 16);
    assert.equal(photoOverlayScene.gradientStrokeRunCount, 0);
    assert.equal(photoOverlayScene.gradientStrokeSegmentCount, 0);
    assert.deepEqual(Array.from(photoOverlayScene.gradientFillPaintMeta), [-1, 0, 2, 0]);
    assert.ok(
      photoOverlayLayers.reduce((sum, layer) => sum + layer.width * layer.height, 0) < 3_000_000,
      "native mask extraction must not flatten page 13 into an additional full-page texture"
    );
    assert.equal(photoOverlayLayers[0].width, 1_243);
    assert.equal(photoOverlayLayers[0].height, 1_755);
    assert.equal(photoOverlayLayers[0].paintOrder, 0, "the main photo must be the first ordered paint");
    assert.equal(photoOverlayLayers[0].pageIndex, 0);
    assert.equal(photoOverlayLayers[1].width, 732);
    assert.equal(photoOverlayLayers[1].height, 137);
    assert.equal(photoOverlayLayers[1].paintOrder, 25, "the signature must remain after the native gradient");
    assert.equal(photoOverlayLayers[1].pageIndex, 0);
    assert.ok(
      photoOverlayLayers[0].paintOrder < photoOverlayScene.gradientFillPaintMeta[2] &&
        photoOverlayScene.gradientFillPaintMeta[2] < photoOverlayLayers[1].paintOrder,
      "paint order must remain photo -> native masked fill -> signature"
    );
    assert.ok(
      photoOverlayLayers.every((layer) => !(layer.width >= 590 && layer.width <= 610 && layer.height >= 340 && layer.height <= 355)),
      "the former soft-mask raster must not remain in the scene"
    );
    assertApprox(photoOverlayScene.gradientFillPathMetaB[2], 1, 1e-6, "native circle red");
    assertApprox(photoOverlayScene.gradientFillPathMetaB[3], 76 / 255, 1e-6, "native circle green");
    assertApprox(photoOverlayScene.gradientFillPathMetaC[2], 41 / 255, 1e-6, "native circle blue");
    assertApprox(photoOverlayScene.gradientFillPathMetaC[3], 0.800003, 1e-5, "native circle group alpha");
    assert.deepEqual(Array.from(photoOverlayScene.gradientMetaA.subarray(0, 4)), [0, 0, 0, 0]);
    assert.deepEqual(Array.from(photoOverlayScene.gradientLut.subarray(0, 4)), [255, 255, 255, 255]);
    assert.deepEqual(Array.from(photoOverlayScene.gradientLut.subarray(1023 * 4, 1024 * 4)), [255, 255, 255, 0]);
    const photoOverlapPixel = sampleRasterLayerAtWorld(photoOverlayLayers[0], 650, 100);
    assert.ok(
      Math.abs(photoOverlapPixel[0] - 146) <= 2 &&
        Math.abs(photoOverlapPixel[1] - 168) <= 2 &&
        Math.abs(photoOverlapPixel[2] - 198) <= 2 &&
        photoOverlapPixel[3] >= 253,
      "the first overlap paint must contain the opaque photo"
    );
    assertApprox(
      evaluateSceneGradientParameter(photoOverlayScene, 0, 650, 100),
      0.342696,
      1e-5,
      "page 13 native mask parameter"
    );
    const maskOverlapPixel = sampleSceneGradient(photoOverlayScene, 0, 650, 100);
    assert.ok(
      maskOverlapPixel.slice(0, 3).every((component) => component >= 254) &&
        maskOverlapPixel[3] >= 166 && maskOverlapPixel[3] <= 170,
      "the native luminosity mask must retain its white-to-transparent coverage"
    );
    const nativeGradientAlpha = photoOverlayScene.gradientFillPathMetaC[3] * maskOverlapPixel[3] / 255;
    assertApprox(nativeGradientAlpha * 255, 134, 2, "native circle effective alpha");
    const nativeGradientColor = [
      photoOverlayScene.gradientFillPathMetaB[2] * 255,
      photoOverlayScene.gradientFillPathMetaB[3] * 255,
      photoOverlayScene.gradientFillPathMetaC[2] * 255
    ];
    const compositedOverlapPixel = nativeGradientColor.map((component, index) =>
      Math.round(component * nativeGradientAlpha + photoOverlapPixel[index] * (1 - nativeGradientAlpha))
    );
    assert.ok(
      Math.abs(compositedOverlapPixel[0] - 203) <= 2 &&
        Math.abs(compositedOverlapPixel[1] - 120) <= 2 &&
        Math.abs(compositedOverlapPixel[2] - 116) <= 2,
      "native mask coverage must composite the gradient over the photo"
    );

    const composedGradientScene = composeVectorScenesInGrid(
      [parsedOrderedUnderlayPdf.scene, photoOverlayScene],
      2
    );
    const underlayGradientCount = parsedOrderedUnderlayPdf.scene.gradientCount;
    const translatedGradientIndex = underlayGradientCount;
    const translatedGradientOffset = translatedGradientIndex * 4;
    const translatedFillIndex = parsedOrderedUnderlayPdf.scene.gradientFillPathCount;
    const translatedFillOffset = translatedFillIndex * 4;
    const translatedPageRectOffset = 4;
    const translateX = composedGradientScene.pageRects[translatedPageRectOffset] - photoOverlayScene.pageRects[0];
    const translateY = composedGradientScene.pageRects[translatedPageRectOffset + 1] - photoOverlayScene.pageRects[1];
    assert.equal(composedGradientScene.pageCount, 2);
    assert.equal(composedGradientScene.gradientCount, underlayGradientCount + photoOverlayScene.gradientCount);
    assert.equal(composedGradientScene.gradientStrokeRunCount, parsedOrderedUnderlayPdf.scene.gradientStrokeRunCount);
    assert.equal(composedGradientScene.gradientFillPathCount, 1);
    assert.equal(composedGradientScene.gradientFillPaintMeta[translatedFillOffset], -1);
    assert.equal(composedGradientScene.gradientFillPaintMeta[translatedFillOffset + 1], translatedGradientIndex);
    assert.equal(composedGradientScene.gradientFillPaintMeta[translatedFillOffset + 2], 2);
    assert.equal(composedGradientScene.gradientFillPaintMeta[translatedFillOffset + 3], 1);
    const sourceGradientB = photoOverlayScene.gradientMetaB;
    const sourceGradientC = photoOverlayScene.gradientMetaC;
    assertApprox(
      composedGradientScene.gradientMetaC[translatedGradientOffset],
      sourceGradientC[0] - sourceGradientB[0] * translateX - sourceGradientB[2] * translateY,
      1e-4,
      "grid-composed gradient e translation"
    );
    assertApprox(
      composedGradientScene.gradientMetaC[translatedGradientOffset + 1],
      sourceGradientC[1] - sourceGradientB[1] * translateX - sourceGradientB[3] * translateY,
      1e-4,
      "grid-composed gradient f translation"
    );
    assertApprox(
      composedGradientScene.gradientFillPathMetaA[translatedFillOffset + 2],
      photoOverlayScene.gradientFillPathMetaA[2] + translateX,
      1e-4,
      "grid-composed gradient fill min-x translation"
    );
    assertApprox(
      composedGradientScene.gradientFillPathMetaA[translatedFillOffset + 3],
      photoOverlayScene.gradientFillPathMetaA[3] + translateY,
      1e-4,
      "grid-composed gradient fill min-y translation"
    );
    const originalMaskSample = sampleSceneGradient(photoOverlayScene, 0, 650, 100);
    const translatedMaskSample = sampleSceneGradient(
      composedGradientScene,
      translatedGradientIndex,
      650 + translateX,
      100 + translateY
    );
    for (let channel = 0; channel < 4; channel += 1) {
      assertApprox(translatedMaskSample[channel], originalMaskSample[channel], 0.25, `grid gradient sample channel ${channel}`);
    }
    const composedRasterLayers = listSceneRasterLayers(composedGradientScene);
    const translatedPhotoLayers = composedRasterLayers.filter((layer) => layer.pageIndex === 1);
    assert.equal(translatedPhotoLayers.length, 2);
    for (let i = 0; i < photoOverlayLayers.length; i += 1) {
      assert.equal(translatedPhotoLayers[i].paintOrder, photoOverlayLayers[i].paintOrder);
      assertApprox(
        translatedPhotoLayers[i].matrix[4],
        photoOverlayLayers[i].matrix[4] + translateX,
        1e-4,
        `grid raster ${i} x translation`
      );
      assertApprox(
        translatedPhotoLayers[i].matrix[5],
        photoOverlayLayers[i].matrix[5] + translateY,
        1e-4,
        `grid raster ${i} y translation`
      );
    }

    const photoOverlayZipBlob = await buildParsedDataZip(parsedPhotoOverlayPdf.scene, {
      sourceLabel: "photo-overlay.pdf",
      encodeRasterImages: false,
      compression: "store"
    });
    const photoOverlayZip = await readZip(photoOverlayZipBlob);
    const photoOverlayManifest = JSON.parse(await photoOverlayZip.file("manifest.json").async("string"));
    assert.equal(photoOverlayManifest.formatVersion, 6);
    assert.equal(photoOverlayManifest.scene.gradientCount, 1);
    assert.equal(photoOverlayManifest.scene.gradientFillPathCount, 1);
    assert.equal(photoOverlayManifest.scene.gradientFillSegmentCount, 16);
    assert.deepEqual(
      photoOverlayManifest.gradientLut,
      {
        file: "textures/gradient-lut.rgba",
        width: 1024,
        height: 1,
        byteLength: 4096
      }
    );
    assert.equal(
      (await photoOverlayZip.file(photoOverlayManifest.gradientLut.file).async("uint8array")).length,
      4096
    );
    const photoOverlayRoundTrip = await loadSceneFromParsedDataZip(await photoOverlayZipBlob.arrayBuffer());
    assertNativeGradientResourcesEqual(photoOverlayRoundTrip, photoOverlayScene, "page 13 native gradient round trip");
    const roundTripPhotoOverlayLayers = listSceneRasterLayers(photoOverlayRoundTrip);
    assert.equal(roundTripPhotoOverlayLayers.length, photoOverlayLayers.length);
    for (let i = 0; i < photoOverlayLayers.length; i += 1) {
      assert.equal(roundTripPhotoOverlayLayers[i].width, photoOverlayLayers[i].width);
      assert.equal(roundTripPhotoOverlayLayers[i].height, photoOverlayLayers[i].height);
      assert.deepEqual(
        Array.from(roundTripPhotoOverlayLayers[i].matrix),
        Array.from(photoOverlayLayers[i].matrix)
      );
      assert.equal(roundTripPhotoOverlayLayers[i].paintOrder, photoOverlayLayers[i].paintOrder);
      assert.equal(roundTripPhotoOverlayLayers[i].pageIndex, photoOverlayLayers[i].pageIndex);
    }
    const corruptGradientLutZip = await readZip(photoOverlayZipBlob);
    corruptGradientLutZip.remove(photoOverlayManifest.gradientLut.file);
    const corruptGradientLutBytes = await corruptGradientLutZip.generateAsync({
      type: "arraybuffer",
      compression: "STORE"
    });
    await assert.rejects(
      loadSceneFromParsedDataZip(corruptGradientLutBytes),
      /missing its gradient LUT payload/
    );

    for (const radialCase of [
      {
        label: "identical",
        p1x: photoOverlayScene.gradientMetaC[2],
        expectedError: /identical start and end circles/
      },
      {
        label: "intersecting",
        p1x: photoOverlayScene.gradientMetaC[2] + 1,
        expectedError: /unsupported intersecting-circle topology/
      }
    ]) {
      const corruptRadialZip = await readZip(photoOverlayZipBlob);
      await mutateInterleavedFloat32Texture(
        corruptRadialZip,
        photoOverlayManifest,
        "gradient-meta-a",
        (values) => {
          values[0] = 1;
        }
      );
      await mutateInterleavedFloat32Texture(
        corruptRadialZip,
        photoOverlayManifest,
        "gradient-meta-d",
        (values) => {
          values[0] = radialCase.p1x;
          values[1] = photoOverlayScene.gradientMetaC[3];
          values[2] = 1;
          values[3] = 1;
        }
      );
      const corruptRadialBytes = await corruptRadialZip.generateAsync({
        type: "arraybuffer",
        compression: "STORE"
      });
      await assert.rejects(
        loadSceneFromParsedDataZip(corruptRadialBytes),
        radialCase.expectedError,
        `${radialCase.label} radial metadata must be rejected`
      );
    }

    for (const missingField of ["paintOrder", "pageIndex"]) {
      const incompleteRasterZip = await readZip(photoOverlayZipBlob);
      const incompleteRasterManifest = JSON.parse(
        await incompleteRasterZip.file("manifest.json").async("string")
      );
      delete incompleteRasterManifest.scene.rasterLayers[0][missingField];
      incompleteRasterZip.file("manifest.json", JSON.stringify(incompleteRasterManifest));
      const incompleteRasterBytes = await incompleteRasterZip.generateAsync({
        type: "arraybuffer",
        compression: "STORE"
      });
      await assert.rejects(
        loadSceneFromParsedDataZip(incompleteRasterBytes),
        /Raster layer 0 has incomplete or invalid v6 metadata/,
        `missing raster ${missingField} must be rejected`
      );
    }

    const missingRasterPayloadZip = await readZip(photoOverlayZipBlob);
    const missingRasterPayloadManifest = JSON.parse(
      await missingRasterPayloadZip.file("manifest.json").async("string")
    );
    const missingRasterPayloadPath = missingRasterPayloadManifest.scene.rasterLayers[0].file;
    missingRasterPayloadZip.remove(missingRasterPayloadPath);
    const missingRasterPayloadBytes = await missingRasterPayloadZip.generateAsync({
      type: "arraybuffer",
      compression: "STORE"
    });
    await assert.rejects(
      loadSceneFromParsedDataZip(missingRasterPayloadBytes),
      /missing or cannot decode raster layer 0/,
      "missing raster payload must be rejected"
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
