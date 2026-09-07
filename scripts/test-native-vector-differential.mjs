import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

installPdfJsNodePolyfills();

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
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
    { extractPdfPageScenes },
    { openPdf },
    { createBundledStandardFontResolver }
  ] = await Promise.all([
    import("../src/pdfVectorExtractor.ts"),
    import("../src/pdfSession.ts"),
    import("../src/standardFontResolver.ts")
  ]);
  const missingFontResolver = createBundledStandardFontResolver({
    async loadAsset(asset, signal) {
      signal?.throwIfAborted();
      const url = new URL(asset.url);
      url.search = "";
      return new Uint8Array(await readFile(url));
    }
  });
  for (const fixture of createFixtures()) {
    const legacyScenes = await extractPdfPageScenes(toArrayBuffer(fixture.bytes), {
      pdfFastPath: "off",
      enableSegmentMerge: false,
      enableInvisibleCull: false,
      extractTextContent: true
    });
    assert.equal(legacyScenes.length, 1, `${fixture.name}: legacy page count`);

    const session = await openPdf({
      kind: "bytes",
      bytes: fixture.bytes,
      ownership: "copy",
      label: fixture.name
    }, {
      ...(fixture.requiresFont ? { missingFontResolver } : {})
    });
    try {
      assert.equal(
        typeof session.compileVectorPage,
        "function",
        "the internal native VectorScene operation must be available"
      );
      const nativeScene = await session.compileVectorPage(0, { optimization: "none" });
      assertSceneParity(nativeScene, legacyScenes[0], fixture.name);
      if (fixture.expectsTextClip) {
        assert.ok(nativeScene.textClipRects?.length >= 4, `${fixture.name}: native clip sidecar`);
        assert.ok(nativeScene.textInstanceB.some((_, index) => index % 4 === 3 &&
          nativeScene.textInstanceB[index] > 0), `${fixture.name}: clipped instance reference`);

        const denseProgress = [];
        const [denseScene] = await extractPdfPageScenes(toArrayBuffer(fixture.bytes), {
          enableSegmentMerge: false,
          enableInvisibleCull: false,
          extractTextContent: true,
          onProgress: (event) => denseProgress.push(event)
        });
        assert.ok(
          denseProgress.some(({ executionPath }) => executionPath === "dense-vector-worker"),
          `${fixture.name}: regression must exercise the dense geometry/text merge`
        );
        assert.deepEqual(
          denseScene.textClipRects,
          nativeScene.textClipRects,
          `${fixture.name}: dense merge must retain page-space text clips`
        );
        assert.deepEqual(
          denseScene.textInstanceB,
          nativeScene.textInstanceB,
          `${fixture.name}: dense merge must retain text clip references`
        );
      }
    } finally {
      await session.close();
    }
  }

  console.log("native/legacy VectorScene differential fixture passed");
} finally {
  hooks.deregister();
}

function createFixtures() {
  return [
    { name: "basic geometry", bytes: createGeometryFixture() },
    { name: "transformed clipped geometry", bytes: createTransformedFixture() },
    { name: "raw image underlay", bytes: createImageFixture() },
    { name: "visible and OCR text", bytes: createTextFixture(), requiresFont: true },
    {
      name: "rotated and skewed clipped text",
      bytes: createClippedTextFixture(),
      requiresFont: true,
      expectsTextClip: true
    },
    { name: "nested Form geometry and text", bytes: createFormFixture(), requiresFont: true }
  ];
}

function createGeometryFixture() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << >> /Contents 4 0 R >>"
      },
      {
        number: 4,
        body: tinyPdfStream("", [
          "q",
          "0.25 0.5 0.75 rg",
          "10 10 40 20 re f",
          "Q",
          "1 0 0 RG",
          "2 w",
          "0 J",
          "0 j",
          "5 5 m 100 5 l S"
        ].join("\n"))
      }
    ]
  });
}

function createTransformedFixture() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 140 100] /CropBox [10 20 110 70] /Rotate 90 /UserUnit 2 /Resources << >> /Contents 4 0 R >>"
      },
      {
        number: 4,
        body: tinyPdfStream("", [
          "q",
          "1 0.2 -0.1 1 20 10 cm",
          "0.2 G",
          "0 w",
          "[4 2] 1 d",
          "10 10 m 30 40 50 0 70 20 c S",
          "Q",
          "q",
          "10 10 50 30 re W n",
          "0.4 g",
          "0 0 100 100 re f",
          "Q"
        ].join("\n"))
      }
    ]
  });
}

function createImageFixture() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>"
      },
      {
        number: 4,
        body: tinyPdfStream("", "q 20 0 0 10 5 15 cm /Im0 Do Q\n0 0 m 10 0 l S")
      },
      {
        number: 5,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 2 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Interpolate true",
          new Uint8Array([255, 0, 0, 0, 128, 255])
        )
      }
    ]
  });
}

function createTextFixture() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"
      },
      {
        number: 4,
        body: tinyPdfStream("", [
          "BT /F1 12 Tf 20 30 Td 0.1 0.2 0.3 rg (Hello) Tj ET",
          "BT /F1 8 Tf 3 Tr 20 10 Td (OCR) Tj ET"
        ].join("\n"))
      },
      {
        number: 5,
        body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
      }
    ]
  });
}

function createClippedTextFixture() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 120 100] " +
          "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"
      },
      {
        number: 4,
        body: tinyPdfStream("", [
          "q 18 18 18 25 re W n BT /F1 30 Tf 1 .25 .35 1 10 15 Tm (W) Tj ET Q",
          "q 55 15 18 30 re W n BT /F1 28 Tf 0 1 -1 0 82 12 Tm (S) Tj ET Q"
        ].join("\n"))
      },
      {
        number: 5,
        body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
      }
    ]
  });
}

function createFormFixture() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 180 80] /Resources << /XObject << /Outer 5 0 R >> >> /Contents 4 0 R >>"
      },
      {
        number: 4,
        body: tinyPdfStream("", "q 1 0 0 1 10 15 cm /Outer Do Q q 1 0 0 1 100 15 cm /Outer Do Q")
      },
      {
        number: 5,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 40 20] /Matrix [2 0 0 2 0 0] /Resources << /XObject << /Inner 6 0 R >> /Font << /F1 7 0 R >> >>",
          "q 1 0 0 1 12 0 cm /Inner Do Q 0.25 0.5 0.75 rg 0 0 8 8 re f BT /F1 6 Tf 10 2 Td (F) Tj ET"
        )
      },
      {
        number: 6,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 4 4] /Resources << >>",
          "1 0 0 rg 0 0 4 4 re f"
        )
      },
      {
        number: 7,
        body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
      }
    ]
  });
}

function assertSceneParity(actual, expected, fixtureName) {
  for (const field of [
    "pageCount",
    "fillPathCount",
    "fillSegmentCount",
    "segmentCount",
    "sourceSegmentCount",
    "mergedSegmentCount",
    "pathCount",
    "textInstanceCount",
    "textGlyphCount",
    "imagePaintOpCount"
  ]) {
    assert.equal(actual[field], expected[field], `${fixtureName}: ${field} differs`);
  }
  assert.equal(
    actual.textGlyphSegmentCount > 0,
    expected.textGlyphSegmentCount > 0,
    `${fixtureName}: visible text outline presence differs`
  );
  for (const field of [
    "pageRects",
    "fillPathMetaA",
    "fillSegmentsA",
    "fillSegmentsB",
    "endpoints",
    "primitiveBounds"
  ]) {
    assertFloatArrayNear(actual[field], expected[field], `${fixtureName}: ${field}`);
  }
  // PDF.js normalizes device colors through an 8-bit display-color path,
  // while the native compiler retains the source float. They are visually
  // equivalent when they differ by no more than one channel quantum.
  for (const field of ["fillPathMetaB", "fillPathMetaC", "primitiveMeta", "styles"]) {
    assertFloatArrayNear(
      actual[field],
      expected[field],
      `${fixtureName}: ${field}`,
      1 / 255 + 1e-5
    );
  }
  assert.equal(
    actual.rasterLayers.length,
    expected.rasterLayers.length,
    `${fixtureName}: raster layer count differs`
  );
  for (let index = 0; index < actual.rasterLayers.length; index += 1) {
    const actualLayer = actual.rasterLayers[index];
    const expectedLayer = expected.rasterLayers[index];
    assert.equal(actualLayer.paintOrder, expectedLayer.paintOrder, `${fixtureName}: raster order`);
    assert.equal(actualLayer.data.length, actualLayer.width * actualLayer.height * 4);
    assert.equal(expectedLayer.data.length, expectedLayer.width * expectedLayer.height * 4);
    assertBoundsNear(
      visibleRasterBounds(actualLayer),
      visibleRasterBounds(expectedLayer),
      `${fixtureName}: visible raster bounds`
    );
    assertFloatArrayNear(
      rasterAlphaWeightedColor(actualLayer),
      rasterAlphaWeightedColor(expectedLayer),
      `${fixtureName}: raster color`,
      2 / 255
    );
    const actualCoverage = rasterAlphaCoverage(actualLayer);
    const expectedCoverage = rasterAlphaCoverage(expectedLayer);
    assert.ok(
      Math.abs(actualCoverage - expectedCoverage) <= Math.max(1e-5, expectedCoverage * 0.01),
      `${fixtureName}: raster alpha coverage differs: ${actualCoverage} versus ${expectedCoverage}`
    );
  }
  assertBoundsNear(actual.pageBounds, expected.pageBounds, `${fixtureName}: pageBounds`);
  if (actual.rasterLayers.length === 0) {
    assertBoundsNear(
      actual.bounds,
      expected.bounds,
      `${fixtureName}: bounds`,
      actual.textInstanceCount > 0 ? 0.02 : 1e-5
    );
  } else {
    assertBoundsNear(
      semanticSceneBounds(actual),
      semanticSceneBounds(expected),
      `${fixtureName}: visible scene bounds`
    );
  }
  assert.equal(actual.textIndex?.version, expected.textIndex?.version, `${fixtureName}: text ABI`);
  const actualText = actual.textIndex?.pages[0];
  const expectedText = expected.textIndex?.pages[0];
  assert.equal(actualText?.text, expectedText?.text, `${fixtureName}: indexed text`);
  if (actualText && expectedText) {
    assert.deepEqual(
      actualText.charInstance,
      expectedText.charInstance,
      `${fixtureName}: character-to-instance mapping`
    );
    assertFloatArrayNear(
      actualText.fallbackQuads,
      expectedText.fallbackQuads,
      `${fixtureName}: fallback text geometry`,
      2e-3
    );
  }
}

function semanticSceneBounds(scene) {
  const bounds = emptyBounds();
  for (let offset = 0; offset < scene.fillPathMetaA.length; offset += 4) {
    includeRectangle(
      bounds,
      scene.fillPathMetaA[offset + 2],
      scene.fillPathMetaA[offset + 3],
      scene.fillPathMetaB[offset],
      scene.fillPathMetaB[offset + 1]
    );
  }
  for (let offset = 0; offset < scene.primitiveBounds.length; offset += 4) {
    includeRectangle(
      bounds,
      scene.primitiveBounds[offset],
      scene.primitiveBounds[offset + 1],
      scene.primitiveBounds[offset + 2],
      scene.primitiveBounds[offset + 3]
    );
  }
  for (const layer of scene.rasterLayers) includeBounds(bounds, visibleRasterBounds(layer));
  return finalizeBounds(bounds);
}

function visibleRasterBounds(layer) {
  let minColumn = layer.width;
  let minRow = layer.height;
  let maxColumn = -1;
  let maxRow = -1;
  for (let row = 0; row < layer.height; row += 1) {
    for (let column = 0; column < layer.width; column += 1) {
      if (layer.data[(row * layer.width + column) * 4 + 3] === 0) continue;
      minColumn = Math.min(minColumn, column);
      minRow = Math.min(minRow, row);
      maxColumn = Math.max(maxColumn, column);
      maxRow = Math.max(maxRow, row);
    }
  }
  assert.ok(maxColumn >= minColumn && maxRow >= minRow, "raster layer is fully transparent");
  const left = minColumn / layer.width;
  const right = (maxColumn + 1) / layer.width;
  const top = minRow / layer.height;
  const bottom = (maxRow + 1) / layer.height;
  const bounds = emptyBounds();
  for (const [u, v] of [[left, top], [right, top], [right, bottom], [left, bottom]]) {
    includePoint(
      bounds,
      layer.matrix[0] * u + layer.matrix[2] * v + layer.matrix[4],
      layer.matrix[1] * u + layer.matrix[3] * v + layer.matrix[5]
    );
  }
  return finalizeBounds(bounds);
}

function rasterAlphaWeightedColor(layer) {
  let alphaSum = 0;
  const sums = [0, 0, 0];
  for (let offset = 0; offset < layer.data.length; offset += 4) {
    const alpha = layer.data[offset + 3] / 255;
    alphaSum += alpha;
    sums[0] += layer.data[offset] / 255 * alpha;
    sums[1] += layer.data[offset + 1] / 255 * alpha;
    sums[2] += layer.data[offset + 2] / 255 * alpha;
  }
  assert.ok(alphaSum > 0);
  return Float32Array.from(sums, (sum) => sum / alphaSum);
}

function rasterAlphaCoverage(layer) {
  let alphaSum = 0;
  for (let offset = 3; offset < layer.data.length; offset += 4) {
    alphaSum += layer.data[offset] / 255;
  }
  const determinant = Math.abs(
    layer.matrix[0] * layer.matrix[3] - layer.matrix[1] * layer.matrix[2]
  );
  return alphaSum / (layer.width * layer.height) * determinant;
}

function emptyBounds() {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };
}

function includePoint(bounds, x, y) {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
}

function includeRectangle(bounds, minX, minY, maxX, maxY) {
  includePoint(bounds, minX, minY);
  includePoint(bounds, maxX, maxY);
}

function includeBounds(target, source) {
  includeRectangle(target, source.minX, source.minY, source.maxX, source.maxY);
}

function finalizeBounds(bounds) {
  assert.ok(Number.isFinite(bounds.minX), "semantic scene bounds are empty");
  return bounds;
}

function assertFloatArrayNear(actual, expected, label, epsilon = 1e-5) {
  assert.equal(actual.length, expected.length, `${label}.length differs`);
  for (let index = 0; index < actual.length; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= epsilon,
      `${label}[${index}] differs: ${actual[index]} versus ${expected[index]}`
    );
  }
}

function assertBoundsNear(actual, expected, label, epsilon = 1e-5) {
  for (const key of ["minX", "minY", "maxX", "maxY"]) {
    assert.ok(
      Math.abs(actual[key] - expected[key]) <= epsilon,
      `${label}.${key} differs: ${actual[key]} versus ${expected[key]}`
    );
  }
}

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function installPdfJsNodePolyfills() {
  Promise.try ??= (callback, ...args) => Promise.resolve().then(() => callback(...args));
  Uint8Array.prototype.toHex ??= function toHex() {
    return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("hex");
  };
  Uint8Array.prototype.toBase64 ??= function toBase64() {
    return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("base64");
  };
  Uint8Array.fromHex ??= (value) => new Uint8Array(Buffer.from(value, "hex"));
  Uint8Array.fromBase64 ??= (value) => new Uint8Array(Buffer.from(value, "base64"));
}
