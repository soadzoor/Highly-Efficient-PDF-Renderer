import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

// Native outlines retain their source font units and use the bundled pinned
// Liberation face, while PDF.js normalizes its equivalent Liberation face to
// em units. Compare the rendered page-space result with a sub-pixel PDF-unit
// tolerance instead of requiring identical local path topology/factorization.
const WORLD_SPACE_GLYPH_TOLERANCE = 2e-3;

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
    { extractDenseTextMiniPdfWithNative },
    { createBundledStandardFontResolver }
  ] = await Promise.all([
    import("../src/pdfVectorExtractor.ts"),
    import("../src/nativeDenseTextExtractor.ts"),
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
  const bytes = createTextOnlyPdf();
  const expected = await extractPdfPageScenes(toArrayBuffer(bytes), {
    pdfFastPath: "off",
    enableSegmentMerge: false,
    enableInvisibleCull: false
  });
  const actual = await extractDenseTextMiniPdfWithNative(bytes, {
    missingFontResolver
  });

  assert.equal(actual.length, expected.length);
  for (let pageIndex = 0; pageIndex < expected.length; pageIndex += 1) {
    assertTextOnlyScene(actual[pageIndex], `native page ${pageIndex + 1}`);
    assertTextOnlyScene(expected[pageIndex], `PDF.js page ${pageIndex + 1}`);
    assertTextSemantics(actual[pageIndex], expected[pageIndex], pageIndex);
  }

  const cancelled = new AbortController();
  cancelled.abort(new Error("cancel native dense text"));
  await assert.rejects(
    extractDenseTextMiniPdfWithNative(bytes, {
      missingFontResolver,
      signal: cancelled.signal
    }),
    /cancel native dense text/
  );

  console.log("Native dense text-mini extractor tests passed.");
} finally {
  hooks.deregister();
}

function createTextOnlyPdf() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>" },
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
      },
      {
        number: 6,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 120 80] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>"
      },
      {
        number: 7,
        body: tinyPdfStream("", "q 1 0.1 -0.2 1 4 6 cm BT /F1 10 Tf 5 7 Td (World) Tj ET Q")
      }
    ]
  });
}

function assertTextOnlyScene(scene, label) {
  assert.equal(scene.segmentCount, 0, `${label}: stroke paint`);
  assert.equal(scene.fillPathCount, 0, `${label}: fill paint`);
  assert.equal(scene.gradientCount, 0, `${label}: gradients`);
  assert.equal(scene.imagePaintOpCount, 0, `${label}: images`);
  assert.equal(scene.rasterLayers.length, 0, `${label}: rasters`);
}

function assertTextSemantics(actual, expected, pageIndex) {
  const label = `page ${pageIndex + 1}`;
  for (const field of [
    "sourceTextCount",
    "textInstanceCount",
    "textInPageCount",
    "textOutOfPageCount"
  ]) {
    assert.equal(actual[field], expected[field], `${label}: ${field}`);
  }
  assert.equal(actual.textIndex?.pages.length, 1, `${label}: native text page count`);
  assert.equal(expected.textIndex?.pages.length, 1, `${label}: PDF.js text page count`);
  const actualIndex = actual.textIndex.pages[0];
  const expectedIndex = expected.textIndex.pages[0];
  assert.equal(actualIndex.text, expectedIndex.text, `${label}: searchable text`);
  assert.deepEqual(actualIndex.charInstance, expectedIndex.charInstance, `${label}: char mapping`);
  assertFloatArrayNear(actualIndex.fallbackQuads, expectedIndex.fallbackQuads, 2e-3,
    `${label}: fallback quads`);
  assertWorldSpaceGlyphGeometry(actual, expected, WORLD_SPACE_GLYPH_TOLERANCE, label);
  assertCanonicalColorsNear(actual.textInstanceC, expected.textInstanceC,
    `${label}: instance colors`);
}

function assertWorldSpaceGlyphGeometry(actual, expected, tolerance, label) {
  assert.equal(
    actual.textInstanceCount,
    expected.textInstanceCount,
    `${label}: world-space glyph instance count`
  );
  for (let instanceIndex = 0; instanceIndex < actual.textInstanceCount; instanceIndex += 1) {
    const actualGlyph = readGlyphInstance(actual, instanceIndex, `${label}: native`);
    const expectedGlyph = readGlyphInstance(expected, instanceIndex, `${label}: PDF.js`);
    assertPointNear(
      transformPoint(actualGlyph, 0, 0),
      transformPoint(expectedGlyph, 0, 0),
      tolerance,
      `${label}: instance ${instanceIndex} glyph origin`
    );
    assertFloatArrayNear(
      worldBounds(actualGlyph),
      worldBounds(expectedGlyph),
      tolerance,
      `${label}: instance ${instanceIndex} world-space ink bounds`
    );
  }
}

function readGlyphInstance(scene, instanceIndex, label) {
  const instanceOffset = instanceIndex * 4;
  const glyphIndex = scene.textInstanceB[instanceOffset + 2];
  assert.ok(
    Number.isSafeInteger(glyphIndex) && glyphIndex >= 0 && glyphIndex < scene.textGlyphCount,
    `${label}: instance ${instanceIndex} glyph index`
  );
  const glyphOffset = glyphIndex * 4;
  const segmentStart = scene.textGlyphMetaA[glyphOffset];
  const segmentCount = scene.textGlyphMetaA[glyphOffset + 1];
  assert.ok(
    Number.isSafeInteger(segmentStart) && Number.isSafeInteger(segmentCount) &&
      segmentStart >= 0 && segmentCount > 0 &&
      segmentStart <= scene.textGlyphSegmentCount - segmentCount,
    `${label}: instance ${instanceIndex} glyph range`
  );
  return {
    a: scene.textInstanceA[instanceOffset],
    b: scene.textInstanceA[instanceOffset + 1],
    c: scene.textInstanceA[instanceOffset + 2],
    d: scene.textInstanceA[instanceOffset + 3],
    e: scene.textInstanceB[instanceOffset],
    f: scene.textInstanceB[instanceOffset + 1],
    minX: scene.textGlyphMetaA[glyphOffset + 2],
    minY: scene.textGlyphMetaA[glyphOffset + 3],
    maxX: scene.textGlyphMetaB[glyphOffset],
    maxY: scene.textGlyphMetaB[glyphOffset + 1],
    segmentStart,
    segmentCount
  };
}

function worldBounds(glyph) {
  const corners = [
    transformPoint(glyph, glyph.minX, glyph.minY),
    transformPoint(glyph, glyph.maxX, glyph.minY),
    transformPoint(glyph, glyph.maxX, glyph.maxY),
    transformPoint(glyph, glyph.minX, glyph.maxY)
  ];
  return Float32Array.from([
    Math.min(...corners.map((point) => point[0])),
    Math.min(...corners.map((point) => point[1])),
    Math.max(...corners.map((point) => point[0])),
    Math.max(...corners.map((point) => point[1]))
  ]);
}

function transformPoint(matrix, x, y) {
  return [
    matrix.a * x + matrix.c * y + matrix.e,
    matrix.b * x + matrix.d * y + matrix.f
  ];
}

function assertPointNear(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual[0] - expected[0]) <= tolerance &&
      Math.abs(actual[1] - expected[1]) <= tolerance,
    `${label} differs (${actual[0]}, ${actual[1]} versus ${expected[0]}, ${expected[1]})`
  );
}

function assertCanonicalColorsNear(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label}: length`);
  for (let index = 0; index < actual.length; index += 1) {
    const actualByte = Math.round(Math.max(0, Math.min(1, actual[index])) * 255);
    const expectedByte = Math.round(Math.max(0, Math.min(1, expected[index])) * 255);
    // PDF.js' display-color conversion may choose the adjacent byte at a
    // half-quantum boundary (for example source 0.3 becomes 76 rather than 77).
    assert.ok(
      Math.abs(actualByte - expectedByte) <= 1,
      `${label}: normalized byte ${index} differs (${actualByte} versus ${expectedByte})`
    );
  }
}

function assertFloatArrayNear(actual, expected, tolerance, label) {
  assert.equal(actual.length, expected.length, `${label}: length`);
  for (let index = 0; index < actual.length; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= tolerance,
      `${label}: value ${index} differs (${actual[index]} versus ${expected[index]})`
    );
  }
}

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function installPdfJsNodePolyfills() {
  if (typeof globalThis.DOMMatrix === "undefined") {
    globalThis.DOMMatrix = class DOMMatrix {
      constructor(init) {
        const values = Array.isArray(init) || ArrayBuffer.isView(init)
          ? Array.from(init)
          : [1, 0, 0, 1, 0, 0];
        [this.a, this.b, this.c, this.d, this.e, this.f] = values;
      }
    };
  }
  if (typeof globalThis.ImageData === "undefined") {
    globalThis.ImageData = class ImageData {};
  }
  if (typeof globalThis.Path2D === "undefined") {
    globalThis.Path2D = class Path2D {};
  }
}
