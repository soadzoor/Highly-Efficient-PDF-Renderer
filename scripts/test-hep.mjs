// Focused public API and round-trip regressions for HEP creation.
//
// Vite is used only as an in-process TypeScript/SSR transformer. Middleware mode
// does not bind a network listener, and HMR/WebSocket support is disabled.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HepArchive } from "./lib/hepContainer.mjs";
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
  // Probes are in the e's font units (2048 per em): the crossbar's internal
  // edge lies at y=582 and two contours' lower edges coincide at y=393. Outline
  // stores keep either font units or the glyph's baked 2x2, so map points
  // through the outline bounds instead of assuming one scale.
  const unitBounds = [66, -25, 997, 1012];
  const glyphMeta = glyphIndex * 4;
  const outlineBounds = [
    scene.textGlyphMetaA[glyphMeta + 2], scene.textGlyphMetaA[glyphMeta + 3],
    scene.textGlyphMetaB[glyphMeta], scene.textGlyphMetaB[glyphMeta + 1]
  ];
  const scaleX = (outlineBounds[2] - outlineBounds[0]) / (unitBounds[2] - unitBounds[0]);
  const scaleY = (outlineBounds[3] - outlineBounds[1]) / (unitBounds[3] - unitBounds[1]);
  assert.ok(Math.abs(scaleX / scaleY - 1) < 1e-4, "the brochure e is upright and uniformly scaled");
  const windingAt = (x, y) => textGlyphWindingAt(scene, glyphIndex,
    outlineBounds[0] + (x - unitBounds[0]) * scaleX, outlineBounds[1] + (y - unitBounds[1]) * scaleY);
  const probe = 0.02;

  const internalEdgeWindings = [
    windingAt(800, 582 + probe),
    windingAt(800, 582 - probe)
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
    windingAt(800, 393 + probe),
    windingAt(800, 393 - probe)
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
  return HepArchive.loadAsync(await blob.arrayBuffer());
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

/** Draw runs in paint-graph order, with the groups (and soft masks) enclosing each one. */
function scenePaintOrder(scene) {
  const order = [];
  const visit = (nodes, scopes) => {
    for (const node of nodes) {
      if (node.kind === "draw") {
        order.push({ runIndex: node.runIndex, run: scene.drawRuns[node.runIndex], scopes });
      } else if (node.kind === "group") {
        if (node.softMask) visit(node.softMask.children, [...scopes, { mask: node }]);
        visit(node.children, [...scopes, { group: node }]);
      }
    }
  };
  visit(scene.paintGraph?.roots ?? [], []);
  return order;
}

function paintGroups(scene) {
  const groups = [];
  const visit = (nodes) => {
    for (const node of nodes) {
      if (node.kind !== "group") continue;
      groups.push(node);
      if (node.softMask) visit(node.softMask.children);
      visit(node.children);
    }
  };
  visit(scene.paintGraph?.roots ?? []);
  return groups;
}

function gradientLutSamples(scene, gradientIndex) {
  const samples = [];
  for (let x = 0; x < 1024; x += 32) {
    const offset = (gradientIndex * 1024 + x) * 4;
    samples.push(Array.from(scene.gradientLut.subarray(offset, offset + 4)));
  }
  return samples;
}

function byteColor(...components) {
  return components.map((component) => Math.round(component * 255)).join(",");
}

function orderIndexOf(order, predicate, context) {
  const index = order.findIndex(predicate);
  assert.notEqual(index, -1, context);
  return index;
}

/** A vector page paints every draw run once, and HEP keeps its paint structure exactly. */
function assertVectorPaintStructure(scene, roundTrip, context) {
  const order = scenePaintOrder(scene);
  assert.equal(new Set(order.map(({ runIndex }) => runIndex)).size, order.length,
    `${context}: no draw run is painted twice`);
  assert.equal(scene.rasterLayers.length, scene.imagePaintOpCount,
    `${context}: only the page's own images stay raster`);
  if (roundTrip) {
    // Absent optional fields are omitted from HEP rather than stored as undefined.
    const defined = (value) => Array.isArray(value) ? value.map(defined)
      : value && typeof value === "object" && !ArrayBuffer.isView(value)
        ? Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)
          .map(([key, entry]) => [key, defined(entry)]))
        : value;
    assert.deepEqual(defined(roundTrip.drawRuns), defined(scene.drawRuns), `${context}: HEP keeps draw runs`);
    assert.deepEqual(defined(roundTrip.paintGraph), defined(scene.paintGraph), `${context}: HEP keeps the paint graph`);
    assert.deepEqual(defined(roundTrip.clipPaths), defined(scene.clipPaths), `${context}: HEP keeps vector clips`);
    assertNativeGradientResourcesEqual(roundTrip, scene, `${context}: HEP gradient resources`);
  }
  return order;
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
      { buildHep },
      { loadPdfSceneFromSource },
      { listSceneRasterLayers, loadSceneFromHep },
      { composeVectorScenesInGrid },
      { SCENE_RASTER_LAYERS_PATH, decodeRasterLayerTable, rasterAtlasFile, rasterLayerFile },
      { sceneRequiresPaintCompositing }
    ] = await Promise.all([
      viteServer.ssrLoadModule("/src/index.ts"),
      viteServer.ssrLoadModule("/src/pdfObjectGenerator.ts"),
      viteServer.ssrLoadModule("/src/hep.ts"),
      viteServer.ssrLoadModule("/src/pdfVectorExtractor.ts"),
      viteServer.ssrLoadModule("/src/hepRasterLayers.ts"),
      viteServer.ssrLoadModule("/src/scenePaintVisibility.ts")
    ]);
    const readRasterLayerTable = async (zip) => decodeRasterLayerTable(
      await zip.file(SCENE_RASTER_LAYERS_PATH).async("uint8array"),
      { maxLayers: 262_144, maxAtlases: 4_096, maxDimension: 16_384 }
    );
    const rasterPayloadFile = (table, index) => {
      const layer = table.layers[index];
      return layer.cell
        ? rasterAtlasFile(layer.cell.atlas, table.atlases[layer.cell.atlas].encoding)
        : rasterLayerFile(index, layer.storage);
    };
    const pdfBytes = await readFile(fixturePath);
    const parsedPdf = await loadPdfSceneFromSource(pdfBytes, { sourceKind: "pdf" });

    const sourceStages = [];
    const sourceZipBlob = await buildHep(pdfBytes, {
      sourceLabel: "fixture.pdf",
      encodeRasterImages: false,
      compression: "store",
      onProgress: (progress) => sourceStages.push(progress.stage)
    });
    assert.ok(sourceZipBlob instanceof Blob);
    assert.equal(sourceZipBlob.type, "application/x-hep");
    const sourceZipBytes = new Uint8Array(await sourceZipBlob.arrayBuffer());
    assert.deepEqual(Array.from(sourceZipBytes.subarray(0, 4)), [0x48, 0x45, 0x50, 0]);
    assert.ok(sourceStages.includes("hep-build"));
    assert.equal(sourceStages.at(-1), "complete");

    const sourceZipArchive = await HepArchive.loadAsync(sourceZipBytes);
    const sourceManifest = JSON.parse(await sourceZipArchive.file("manifest.json").async("string"));
    assert.equal(sourceManifest.formatVersion, 9, "new scenes use the v9 HEP schema");
    for (const unsupportedVersion of [5, 6, 7, 8]) {
      const incompatibleZip = await HepArchive.loadAsync(sourceZipBytes);
      const incompatibleManifest = {
        ...sourceManifest,
        formatVersion: unsupportedVersion
      };
      incompatibleZip.file("manifest.json", JSON.stringify(incompatibleManifest));
      const incompatibleBytes = await incompatibleZip.generateAsync({ type: "arraybuffer", compression: "STORE" });
      await assert.rejects(
        loadSceneFromHep(incompatibleBytes),
        new RegExp(`format v${unsupportedVersion} is not supported`)
      );
    }

    const sourceRoundTrip = await loadSceneFromHep(sourceZipBytes.buffer);
    assertSceneCountsEqual(sourceRoundTrip, parsedPdf.scene, "PDF source round trip");
    assertNativeGradientResourcesEqual(sourceRoundTrip, parsedPdf.scene, "PDF source round trip");
    assert.equal(sourceRoundTrip.textClipRects, undefined, "scenes without clipped glyphs omit text clips");

    const base64ZipBlob = await buildHep(pdfBytes.toString("base64"), {
      encodeRasterImages: false,
      compression: "store"
    });
    const base64Zip = await readZip(base64ZipBlob);
    const base64Manifest = JSON.parse(await base64Zip.file("manifest.json").async("string"));
    assert.equal(base64Manifest.sourceFile, "document.pdf");

    const sceneZipBlob = await buildHep(parsedPdf.scene, {
      sourceLabel: "already-parsed.pdf",
      encodeRasterImages: false,
      compression: "store"
    });
    const sceneZip = await readZip(sceneZipBlob);
    const sceneManifest = JSON.parse(await sceneZip.file("manifest.json").async("string"));
    assert.equal(sceneManifest.sourceFile, "already-parsed.pdf");
    const sceneRoundTrip = await loadSceneFromHep(await sceneZipBlob.arrayBuffer());
    assertSceneCountsEqual(sceneRoundTrip, parsedPdf.scene, "parsed scene round trip");
    assertNativeGradientResourcesEqual(sceneRoundTrip, parsedPdf.scene, "parsed scene round trip");

    if (parsedPdf.scene.textInstanceCount > 0) {
      const clippedInstanceB = new Float32Array(parsedPdf.scene.textInstanceB);
      clippedInstanceB[3] = 1;
      const clippedScene = {
        ...parsedPdf.scene,
        textInstanceB: clippedInstanceB,
        textClipRects: new Float32Array([1, 2, 30, 40])
      };
      const clippedZip = await buildHep(clippedScene, {
        sourceLabel: "clipped-scene.pdf",
          encodeRasterImages: false,
        compression: "store"
      });
      const clippedRoundTrip = await loadSceneFromHep(await clippedZip.arrayBuffer());
      assert.deepEqual([...clippedRoundTrip.textClipRects], [1, 2, 30, 40]);
      assert.equal(clippedRoundTrip.textInstanceB[3], 1);
      assert.deepEqual(
        [...clippedRoundTrip.textInstanceB.subarray(4)],
        [...parsedPdf.scene.textInstanceB.subarray(4)],
        "unclipped text-instance channels remain byte-exact"
      );
    }

    if (parsedPdf.scene.segmentCount > 0) {
      const clippedPrimitiveMeta = new Float32Array(parsedPdf.scene.primitiveMeta);
      const clippedPrimitiveBounds = new Float32Array(parsedPdf.scene.primitiveBounds);
      const packedStyle = clippedPrimitiveMeta[3];
      const originalFlags = Math.max(0, Math.trunc(packedStyle / 2 + 1e-6));
      const alpha = packedStyle - originalFlags * 2;
      clippedPrimitiveMeta[3] = alpha + (originalFlags | 4) * 2;
      const exactStrokeClip = [-3.25, -4.5, 33.75, 44.125];
      clippedPrimitiveBounds.set(exactStrokeClip, 0);
      const clippedStrokeScene = {
        ...parsedPdf.scene,
        primitiveMeta: clippedPrimitiveMeta,
        primitiveBounds: clippedPrimitiveBounds
      };
      const clippedStrokeZipBlob = await buildHep(clippedStrokeScene, {
        sourceLabel: "clipped-stroke-scene.pdf",
          encodeRasterImages: false,
        compression: "store"
      });
      const clippedStrokeZip = await readZip(clippedStrokeZipBlob);
      const clippedStrokeManifest = JSON.parse(
        await clippedStrokeZip.file("manifest.json").async("string")
      );
      assert.equal(
        clippedStrokeManifest.strokeGeometry.clipBoundsFile,
        "geometry/stroke-clip-bounds.f32"
      );
      assert.ok(clippedStrokeManifest.strokeGeometry.clippedSegmentCount >= 1);
      assert.ok(clippedStrokeZip.file(clippedStrokeManifest.strokeGeometry.clipBoundsFile));
      const clippedStrokeRoundTrip = await loadSceneFromHep(
        await clippedStrokeZipBlob.arrayBuffer()
      );
      assert.deepEqual(
        [...clippedStrokeRoundTrip.primitiveBounds.subarray(0, 4)],
        exactStrokeClip,
        "HEP v7 must retain exact clipped-stroke bounds instead of deriving endpoint bounds"
      );
      assert.equal(Math.trunc(clippedStrokeRoundTrip.primitiveMeta[3] / 2 + 1e-6) & 4, 4);

      const incompleteStrokeClipZip = await readZip(clippedStrokeZipBlob);
      const incompleteStrokeClipManifest = JSON.parse(
        await incompleteStrokeClipZip.file("manifest.json").async("string")
      );
      delete incompleteStrokeClipManifest.strokeGeometry.clippedSegmentCount;
      incompleteStrokeClipZip.file("manifest.json", JSON.stringify(incompleteStrokeClipManifest));
      const incompleteStrokeClipBytes = await incompleteStrokeClipZip.generateAsync({
        type: "arraybuffer",
        compression: "STORE"
      });
      await assert.rejects(
        loadSceneFromHep(incompleteStrokeClipBytes),
        /invalid strokeGeometry section/
      );
    }

    const missingRasterScene = {
      ...parsedPdf.scene,
      drawRuns: [...(parsedPdf.scene.drawRuns ?? []), { kind: "raster", first: 0, count: 1 }],
      imagePaintOpCount: Math.max(1, parsedPdf.scene.imagePaintOpCount),
      rasterLayers: [],
      rasterLayerWidth: 0,
      rasterLayerHeight: 0,
      rasterLayerData: new Uint8Array(0),
      rasterLayerMatrix: new Float32Array([1, 0, 0, 1, 0, 0])
    };
    await assert.rejects(
      buildHep(missingRasterScene, { encodeRasterImages: false }),
      /raster|draw run|drawRun/i
    );
    await assert.rejects(
      buildHep(missingRasterScene, {
        sourcePdf: new Uint8Array([1, 2, 3, 4]),
        encodeRasterImages: false
      }),
      /no longer supported/
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
    await assert.rejects(buildHep(rasterFallbackScene, {
      sourceLabel: "incomplete.pdf", encodeRasterImages: false, compression: "store"
    }), /raster|draw run|drawRun/i, "missing canonical raster slots must never export silently");
    const retainedZipBlob = await buildHep(parsedRasterPdf.scene, {
      sourceLabel: "retained.pdf", encodeRasterImages: false, compression: "store"
    });
    const retainedZip = await readZip(retainedZipBlob);
    const retainedManifest = JSON.parse(await retainedZip.file("manifest.json").async("string"));
    assert.equal(retainedManifest.sourcePdfFile, undefined);
    assert.equal(retainedZip.file("source/source.pdf"), null);
    const retainedRoundTrip = await loadSceneFromHep(await retainedZipBlob.arrayBuffer());
    assert.equal(listSceneRasterLayers(retainedRoundTrip).length, expectedRasterLayers.length);

    const optimizedRasterPdfBytes = await readFile(optimizedRasterFixturePath);
    const parsedOptimizedRasterPdf = await loadPdfSceneFromSource(optimizedRasterPdfBytes, {
      sourceKind: "pdf",
      pages: "1"
    });
    assertBrochureOverlapCoverage(parsedOptimizedRasterPdf.scene);
    assert.ok(parsedOptimizedRasterPdf.scene.imagePaintOpCount > 0);
    assert.ok(
      listSceneRasterLayers(parsedOptimizedRasterPdf.scene).length > 0,
      "the optimized raster PDF must preserve raster layers"
    );

    // Brochure pages with shadings, soft masks and blend groups stay vector:
    // native gradients, vector clips and paint-graph groups that the renderer
    // composites. Their structure is checked here and must survive HEP exactly.
    const loadBrochurePage = async (pages) =>
      (await loadPdfSceneFromSource(optimizedRasterPdfBytes, { sourceKind: "pdf", pages })).scene;
    const roundTripScene = async (scene, sourceLabel) => loadSceneFromHep(await (await buildHep(scene, {
      sourceLabel, encodeRasterImages: false, compression: "store"
    })).arrayBuffer());

    // Page 11: ColorN circle strokes under a table.
    const underlayScene = await loadBrochurePage("11");
    const underlayOrder = assertVectorPaintStructure(underlayScene,
      await roundTripScene(underlayScene, "native-circle-strokes.pdf"), "page 11");
    assert.equal(underlayScene.rasterLayers.length, 0, "the circle shading no longer needs a raster composite");
    assert.equal(underlayScene.gradientCount, 7, "ColorN circle strokes become native gradients");
    for (let gradientIndex = 0; gradientIndex < underlayScene.gradientCount; gradientIndex += 1) {
      assert.equal(underlayScene.gradientMetaA[gradientIndex * 4], 0, `circle gradient ${gradientIndex} is linear`);
      assert.ok(new Set(gradientLutSamples(underlayScene, gradientIndex).map(String)).size > 4,
        `native circle gradient ${gradientIndex} must retain color variation`);
    }
    assert.deepEqual(underlayOrder.slice(0, 5).map(({ run }) => run.kind), Array(5).fill("gradient-fill"),
      "the decorative-circle prefix paints first, below later page content");
    assert.equal(underlayScene.textInstanceCount, 2_608, "native circle extraction must preserve vector text");
    let blackStrokeCount = 0;
    let burgundyStrokeCount = 0;
    for (let i = 0; i < underlayScene.segmentCount; i += 1) {
      const color = byteColor(...underlayScene.styles.subarray(i * 4 + 1, i * 4 + 4));
      if (color === "0,0,0") blackStrokeCount += 1;
      if (color === "80,23,31") burgundyStrokeCount += 1;
    }
    assert.equal(blackStrokeCount, 0, "ColorN pattern strokes must not fall back to black vectors");
    assert.equal(burgundyStrokeCount, 0, "solid companion circles must stay in the ordered gradient prefix");
    const tableOverlapX = 724.574;
    const tableOverlapY = 352.798;
    let creamTableFill = -1;
    for (let i = 0; i < underlayScene.fillPathCount && creamTableFill < 0; i += 1) {
      const offset = i * 4;
      const covers = tableOverlapX >= underlayScene.fillPathMetaA[offset + 2] &&
        tableOverlapX <= underlayScene.fillPathMetaB[offset] &&
        tableOverlapY >= underlayScene.fillPathMetaA[offset + 3] &&
        tableOverlapY <= underlayScene.fillPathMetaB[offset + 1];
      const color = byteColor(underlayScene.fillPathMetaB[offset + 2], underlayScene.fillPathMetaB[offset + 3],
        underlayScene.fillPathMetaC[offset + 2], underlayScene.fillPathMetaC[offset + 3]);
      if (covers && color === "251,243,240,255") creamTableFill = i;
    }
    assert.ok(creamTableFill >= 0, "an opaque cream table fill must remain vector-rendered");
    assert.ok(orderIndexOf(underlayOrder, ({ run }) => run.kind === "fill" &&
      creamTableFill >= run.first && creamTableFill < run.first + run.count, "the table fill is painted") > 4,
    "the table fill paints above the circle underlay");

    // Page 6: ColorN strokes interleaved with images.
    const orderedPatternScene = await loadBrochurePage("6");
    const orderedPatternOrder = assertVectorPaintStructure(orderedPatternScene,
      await roundTripScene(orderedPatternScene, "interleaved-pattern-strokes.pdf"), "page 6");
    assert.equal(orderedPatternScene.textInstanceCount, 1_461, "vector text is preserved next to pattern strokes");
    const redOrangeGradients = [];
    for (let gradientIndex = 0; gradientIndex < orderedPatternScene.gradientCount; gradientIndex += 1) {
      if (gradientLutSamples(orderedPatternScene, gradientIndex).every(([red, green, blue, alpha]) =>
        red > 245 && green >= 70 && green <= 190 && blue < 60 && alpha > 250)) redOrangeGradients.push(gradientIndex);
    }
    assert.equal(redOrangeGradients.length, 2, "interleaved ColorN strokes must retain their red/orange gradients");
    const lastImage = orderedPatternOrder.findLastIndex(({ run }) => run.kind === "raster");
    for (const gradientIndex of redOrangeGradients) {
      assert.ok(orderIndexOf(orderedPatternOrder, ({ run }) => run.kind === "gradient-fill" && run.first === gradientIndex,
        `red/orange gradient ${gradientIndex} is painted`) > lastImage,
      "interleaved ColorN strokes keep their PDF paint order above the images");
    }

    // Page 12: shadings, luminosity soft masks and dashes.
    const shadingScene = await loadBrochurePage("12");
    const shadingOrder = assertVectorPaintStructure(shadingScene,
      await roundTripScene(shadingScene, "shading-and-dash.pdf"), "page 12");
    assert.equal(shadingScene.rasterLayers.length, 0, "shadingFill operators become native gradients");
    assert.equal(shadingScene.gradientCount, 7);
    for (let gradientIndex = 0; gradientIndex < shadingScene.gradientCount; gradientIndex += 1) {
      assert.ok(new Set(gradientLutSamples(shadingScene, gradientIndex).map(String)).size > 16,
        `captured shading ${gradientIndex} must retain gradient color variation`);
    }
    const shadingMasks = paintGroups(shadingScene).filter((group) => group.softMask);
    assert.equal(shadingMasks.length, 4, "soft-mask consumers keep their luminosity-mask groups");
    for (const group of shadingMasks) {
      assert.equal(group.softMask.subtype, "Luminosity");
      assert.ok(shadingOrder.some(({ run, scopes }) => run.kind === "gradient-fill" && scopes.some((scope) => scope.mask === group)),
        "each luminosity mask is defined by a native gradient");
      assert.ok(shadingOrder.some(({ scopes }) => scopes.some((scope) => scope.group === group)),
        "each soft mask has painted consumers");
    }
    let salmonConsumerCount = 0;
    for (let i = 0; i < shadingScene.fillPathCount; i += 1) {
      const offset = i * 4;
      if (byteColor(shadingScene.fillPathMetaB[offset + 2], shadingScene.fillPathMetaB[offset + 3],
        shadingScene.fillPathMetaC[offset + 2]) !== "255,76,41") continue;
      salmonConsumerCount += 1;
      const painted = shadingOrder.filter(({ run }) => run.kind === "fill" && i >= run.first && i < run.first + run.count);
      assert.equal(painted.length, 1, "each soft-mask consumer is painted once");
      assert.ok(painted[0].scopes.some((scope) => scope.group?.softMask),
        "soft-mask consumers must not be emitted as opaque vector fills outside their mask");
    }
    assert.ok(salmonConsumerCount > 0, "the salmon soft-mask consumers are present");
    assert.equal(shadingScene.textInstanceCount, 1_764, "shadings must preserve vector text");
    let darkTableTextCount = 0;
    for (let i = 0; i < shadingScene.textInstanceCount; i += 1) {
      if (byteColor(...shadingScene.textInstanceC.subarray(i * 4, i * 4 + 4)) === "44,46,53,255") darkTableTextCount += 1;
    }
    assert.equal(darkTableTextCount, 1_649, "PDF display/sRGB text colors must survive extraction unchanged");

    // Page 3: shadings interleaved with two images.
    const interleavedScene = await loadBrochurePage("3");
    const interleavedOrder = assertVectorPaintStructure(interleavedScene,
      await roundTripScene(interleavedScene, "interleaved-images.pdf"), "page 3");
    const imagePositions = interleavedOrder.flatMap(({ run }, index) => run.kind === "raster" ? [index] : []);
    assert.equal(imagePositions.length, 2, "page 3 paints two source images");
    const gradientPositions = interleavedOrder.flatMap(({ run }, index) => run.kind === "gradient-fill" ? [index] : []);
    assert.ok(gradientPositions.some((index) => index > imagePositions[0] && index < imagePositions[1]),
      "the early gradient paints over the first image");
    assert.ok(gradientPositions.some((index) => index > imagePositions[1]),
      "the post-image shading remains after the intervening image");

    // Page 13: a photo, a luminosity-masked circle and a signature.
    const photoOverlayScene = await loadBrochurePage("13");
    const photoOverlayLayers = listSceneRasterLayers(photoOverlayScene);
    const photoOrder = assertVectorPaintStructure(photoOverlayScene, null, "page 13");
    assert.equal(photoOverlayLayers.length, 2, "page 13 must retain only its photo and signature raster paints");
    assert.equal(photoOverlayScene.textInstanceCount, 976, "page 13 text must remain vector-rendered");
    assert.equal(photoOverlayScene.gradientCount, 1, "the soft-mask definition must become one native gradient");
    assert.ok(
      photoOverlayLayers.reduce((sum, layer) => sum + layer.width * layer.height, 0) < 3_000_000,
      "native mask extraction must not flatten page 13 into an additional full-page texture"
    );
    const [photoMask] = paintGroups(photoOverlayScene).filter((group) => group.softMask);
    assert.equal(photoMask?.softMask.subtype, "Luminosity", "the circle keeps its luminosity mask");
    assert.ok(photoOrder.some(({ run, scopes }) => run.kind === "gradient-fill" && run.first === 0 &&
      scopes.some((scope) => scope.mask === photoMask)), "the mask is the native gradient");
    const photoPosition = orderIndexOf(photoOrder, ({ run }) => run.kind === "raster" && run.first === 0, "the photo is painted");
    const circlePosition = orderIndexOf(photoOrder, ({ scopes }) => scopes.some((scope) => scope.group === photoMask),
      "the masked circle is painted");
    const signaturePosition = orderIndexOf(photoOrder, ({ run }) => run.kind === "raster" && run.first === 1,
      "the signature is painted");
    assert.ok(photoPosition < circlePosition && circlePosition < signaturePosition,
      "paint order must remain photo -> masked circle -> signature");
    const circle = photoOrder[circlePosition];
    assert.equal(circle.run.kind, "fill");
    const circleOffset = circle.run.first * 4;
    assert.equal(byteColor(photoOverlayScene.fillPathMetaB[circleOffset + 2], photoOverlayScene.fillPathMetaB[circleOffset + 3],
      photoOverlayScene.fillPathMetaC[circleOffset + 2], photoOverlayScene.fillPathMetaC[circleOffset + 3]), "255,76,41,255",
    "the masked circle keeps its salmon paint");
    const circleOpacity = circle.scopes.reduce((alpha, scope) => alpha * (scope.group?.alpha ?? 1), 1);
    assertApprox(circleOpacity, 0.8, 1e-5, "native circle group alpha");
    assert.deepEqual(Array.from(photoOverlayScene.gradientMetaA.subarray(0, 4)), [0, 0, 0, 0]);
    assert.deepEqual(Array.from(photoOverlayScene.gradientLut.subarray(0, 4)), [255, 255, 255, 255]);
    assert.deepEqual(Array.from(photoOverlayScene.gradientLut.subarray(1023 * 4, 1024 * 4)), [0, 0, 0, 255],
      "the luminosity mask runs from white (visible) to black (hidden)");
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
    const maskCoverage = (0.2126 * maskOverlapPixel[0] + 0.7152 * maskOverlapPixel[1] + 0.0722 * maskOverlapPixel[2]) / 255;
    assert.ok(maskCoverage * 255 >= 166 && maskCoverage * 255 <= 170,
      "the native luminosity mask must retain its white-to-black coverage");
    const nativeCircleAlpha = circleOpacity * maskCoverage;
    assertApprox(nativeCircleAlpha * 255, 134, 2, "native circle effective alpha");
    const compositedOverlapPixel = [255, 76, 41].map((component, index) =>
      Math.round(component * nativeCircleAlpha + photoOverlapPixel[index] * (1 - nativeCircleAlpha))
    );
    assert.ok(
      Math.abs(compositedOverlapPixel[0] - 203) <= 2 &&
        Math.abs(compositedOverlapPixel[1] - 120) <= 2 &&
        Math.abs(compositedOverlapPixel[2] - 116) <= 2,
      "native mask coverage must composite the circle over the photo"
    );

    const composedGradientScene = composeVectorScenesInGrid([underlayScene, photoOverlayScene], 2);
    const underlayGradientCount = underlayScene.gradientCount;
    const translatedGradientIndex = underlayGradientCount;
    const translatedGradientOffset = translatedGradientIndex * 4;
    const translatedFillOffset = underlayScene.gradientFillPathCount * 4;
    const translatedPageRectOffset = 4;
    const translateX = composedGradientScene.pageRects[translatedPageRectOffset] - photoOverlayScene.pageRects[0];
    const translateY = composedGradientScene.pageRects[translatedPageRectOffset + 1] - photoOverlayScene.pageRects[1];
    assert.equal(composedGradientScene.pageCount, 2);
    assert.equal(composedGradientScene.gradientCount, underlayGradientCount + photoOverlayScene.gradientCount);
    assert.equal(composedGradientScene.gradientFillPathCount,
      underlayScene.gradientFillPathCount + photoOverlayScene.gradientFillPathCount);
    const [sourceGradient, maskGradient, sourcePaint, sourcePage] = photoOverlayScene.gradientFillPaintMeta.subarray(0, 4);
    assert.deepEqual(
      Array.from(composedGradientScene.gradientFillPaintMeta.subarray(translatedFillOffset, translatedFillOffset + 4)),
      [
        sourceGradient >= 0 ? sourceGradient + underlayGradientCount : -1,
        maskGradient >= 0 ? maskGradient + underlayGradientCount : -1,
        sourcePaint,
        sourcePage + 1
      ],
      "grid composition remaps gradient and page references"
    );
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

    const photoOverlayZipBlob = await buildHep(photoOverlayScene, {
      sourceLabel: "photo-overlay.pdf",
      encodeRasterImages: false,
      compression: "store"
    });
    const photoOverlayZip = await readZip(photoOverlayZipBlob);
    const photoOverlayManifest = JSON.parse(await photoOverlayZip.file("manifest.json").async("string"));
    assert.equal(photoOverlayManifest.formatVersion, 9);
    assert.equal(photoOverlayManifest.scene.gradientCount, 1);
    assert.equal(photoOverlayManifest.scene.gradientFillPathCount, photoOverlayScene.gradientFillPathCount);
    assert.equal(photoOverlayManifest.scene.gradientFillSegmentCount, photoOverlayScene.gradientFillSegmentCount);
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
    const photoOverlayRoundTrip = await loadSceneFromHep(await photoOverlayZipBlob.arrayBuffer());
    assertVectorPaintStructure(photoOverlayScene, photoOverlayRoundTrip, "page 13");
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

    // Encoded raster sections: the page 13 photo is large enough for its own.
    const encodedPhotoBlob = await buildHep(photoOverlayScene, {
      sourceLabel: "photo-overlay-encoded.pdf",
      compression: "store"
    });
    const encodedPhotoZip = await readZip(encodedPhotoBlob);
    const encodedPhotoTable = await readRasterLayerTable(encodedPhotoZip);
    assert.match(encodedPhotoTable.layers[0].storage, /^(?:png|webp)$/, "large layers keep their own encoded section");
    const encodedPhotoBytes = await encodedPhotoZip.file(rasterPayloadFile(encodedPhotoTable, 0)).async("uint8array");
    assert.ok(encodedPhotoBytes.length < photoOverlayLayers[0].data.length, "Node HEP builds must compress raster layers");
    const decodedPhotoLayers = listSceneRasterLayers(await loadSceneFromHep(await encodedPhotoBlob.arrayBuffer()));
    assert.equal(decodedPhotoLayers.length, photoOverlayLayers.length, "Node HEP loads must decode encoded raster layers");
    assert.equal(decodedPhotoLayers[0].width, photoOverlayLayers[0].width);
    assert.equal(decodedPhotoLayers[0].height, photoOverlayLayers[0].height);
    // Photos may use lossy WebP: bound the whole layer's mean error, not one texel.
    let photoError = 0;
    for (let i = 0; i < photoOverlayLayers[0].data.length; i += 1) {
      photoError += Math.abs(photoOverlayLayers[0].data[i] - decodedPhotoLayers[0].data[i]);
    }
    assert.ok(photoError / photoOverlayLayers[0].data.length < 3, "encoded raster layers must survive the Node HEP round trip");
    const decodedPhotoPixel = sampleRasterLayerAtWorld(decodedPhotoLayers[0], 650, 100);
    assert.ok(decodedPhotoPixel.every((component, index) => Math.abs(component - photoOverlapPixel[index]) <= 12),
      "the decoded photo keeps its color at the circle overlap");

    const corruptGradientLutZip = await readZip(photoOverlayZipBlob);
    corruptGradientLutZip.remove(photoOverlayManifest.gradientLut.file);
    const corruptGradientLutBytes = await corruptGradientLutZip.generateAsync({
      type: "arraybuffer",
      compression: "STORE"
    });
    await assert.rejects(
      loadSceneFromHep(corruptGradientLutBytes),
      /missing its gradient LUT payload/
    );

    for (const radialCase of [
      {
        label: "identical",
        p1x: photoOverlayScene.gradientMetaC[2],
        expectedError: /identical start and end circles/
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
        loadSceneFromHep(corruptRadialBytes),
        radialCase.expectedError,
        `${radialCase.label} radial metadata must be rejected`
      );
    }

    const photoOverlayTableBytes = await photoOverlayZip.file(SCENE_RASTER_LAYERS_PATH).async("uint8array");
    let firstLayerFlagsOffset = 0;
    {
      const readVarint = () => {
        let value = 0;
        for (let shift = 0; ; shift += 7) {
          const byte = photoOverlayTableBytes[firstLayerFlagsOffset++];
          value += (byte & 127) * 2 ** shift;
          if (!(byte & 128)) return value;
        }
      };
      const atlasCount = readVarint();
      for (let atlas = 0; atlas < atlasCount; atlas += 1) {
        firstLayerFlagsOffset += 1;
        readVarint();
        readVarint();
      }
      assert.ok(readVarint() > 0, "the photo overlay exports raster layers");
    }
    const corruptRasterTables = [
      {
        label: "reserved flag bits",
        bytes: (() => {
          const bytes = photoOverlayTableBytes.slice();
          bytes[firstLayerFlagsOffset] |= 0x80;
          return bytes;
        })(),
        expectedError: /layer 0 has reserved flag bits/
      },
      {
        label: "truncated matrices",
        bytes: photoOverlayTableBytes.slice(0, -1),
        expectedError: /matrix data does not fill the section/
      }
    ];
    for (const corruptCase of corruptRasterTables) {
      const corruptRasterZip = await readZip(photoOverlayZipBlob);
      corruptRasterZip.file(SCENE_RASTER_LAYERS_PATH, corruptCase.bytes);
      await assert.rejects(
        loadSceneFromHep(await corruptRasterZip.generateAsync({ type: "arraybuffer", compression: "STORE" })),
        corruptCase.expectedError,
        `raster layer table with ${corruptCase.label} must be rejected`
      );
    }

    const miscountedRasterZip = await readZip(photoOverlayZipBlob);
    miscountedRasterZip.file("manifest.json", JSON.stringify({
      ...photoOverlayManifest,
      scene: {
        ...photoOverlayManifest.scene,
        rasterLayers: { ...photoOverlayManifest.scene.rasterLayers, count: photoOverlayManifest.scene.rasterLayers.count + 1 }
      }
    }));
    await assert.rejects(
      loadSceneFromHep(await miscountedRasterZip.generateAsync({ type: "arraybuffer", compression: "STORE" })),
      /Scene raster layers do not match their manifest entry/,
      "a raster layer count that disagrees with the table must be rejected"
    );

    const missingRasterPayloadZip = await readZip(photoOverlayZipBlob);
    missingRasterPayloadZip.remove(rasterPayloadFile(await readRasterLayerTable(missingRasterPayloadZip), 0));
    const missingRasterPayloadBytes = await missingRasterPayloadZip.generateAsync({
      type: "arraybuffer",
      compression: "STORE"
    });
    await assert.rejects(
      loadSceneFromHep(missingRasterPayloadBytes),
      /missing raster (?:layer|atlas) 0/,
      "missing raster payload must be rejected"
    );

    // Page 14: backdrop-dependent HardLight groups over an image.
    const backdropBlendScene = await loadBrochurePage("14");
    const backdropBlendOrder = assertVectorPaintStructure(backdropBlendScene,
      await roundTripScene(backdropBlendScene, "backdrop-blend.pdf"), "page 14");
    assert.ok(backdropBlendScene.imagePaintOpCount > 0, "blend fixture must contain an image backdrop");
    const hardLightGroups = paintGroups(backdropBlendScene).filter((group) => group.blendMode === "HardLight");
    assert.ok(hardLightGroups.length > 0, "backdrop-dependent blend groups keep their blend mode");
    assert.equal(sceneRequiresPaintCompositing(backdropBlendScene), true);
    const backdropPosition = orderIndexOf(backdropBlendOrder, ({ run }) => run.kind === "raster", "the backdrop image is painted");
    assert.ok(backdropBlendOrder.some(({ scopes }, index) => index > backdropPosition &&
      scopes.some((scope) => hardLightGroups.includes(scope.group))),
    "a HardLight group composites over the image backdrop in PDF paint order");
    assert.ok(
      backdropBlendScene.textInstanceCount > 1_000,
      "blend groups must preserve searchable vector text"
    );

    await assert.rejects(
      buildHep(new Uint8Array([1]), { compression: "deflate", compressionLevel: 0 }),
      /compressionLevel is no longer supported/
    );
    await assert.rejects(
      buildHep(new Uint8Array([1]), { compression: "gzip" }),
      /compression must be either "deflate" or "store"/
    );

    console.log("HEP regressions passed");
  } finally {
    await viteServer.close();
  }
}

run().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
