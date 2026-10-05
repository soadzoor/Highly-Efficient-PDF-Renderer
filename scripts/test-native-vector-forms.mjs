import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const session = await openPdf(
    { kind: "bytes", bytes: nestedFormFixture(), label: "native-vector-forms.pdf" },
    {
      missingFontResolver() {
        return { sfntBytes: buildTinySfnt(), identifier: "vector-form-fixture-v1" };
      }
    }
  );
  try {
    const scene = await session.compileVectorPage(0, { optimization: "none" });
    assert.equal(scene.fillPathCount, 4, "two nested Form occurrences must flatten every path");
    assert.equal(scene.pathCount, 4);
    assert.equal(scene.textInstanceCount, 2, "text is expanded once per Form occurrence");
    assert.equal(scene.textIndex.pages[0].text.replaceAll(" ", ""), "AA");
    assert.equal(scene.imagePaintOpCount, 0);
    assert.ok(scene.formPaints === undefined, "the established VectorScene gains no Form ABI");
  } finally {
    await session.close();
  }

  await assertIdenticalFormOccurrenceCache(openPdf);
  await assertSelectiveTransparencyComposite(openPdf);
  await assertBackdropMultiplyCorrection(openPdf);
  await assertClippedFormVectors(openPdf);
  await assertOrderedInterleavedPaint(openPdf);
  await assertSafeDisjointInterleavedPaint(openPdf);
  await assertSafeDisjointInterleavedText(openPdf);
  await assertOrderedOverlappingInterleavedText(openPdf);
  await assertExactRectangleFillClip(openPdf, false);
  await assertExactRectangleFillClip(openPdf, true);
  await assertExactRectangleStrokeClip(openPdf, "4 w 2 0 m 8 0 l S", {
    segmentCount: 1,
    mustRetainOutsideGeometry: false
  });
  await assertExactRectangleStrokeClip(openPdf, "0 w -2 5 m 12 5 l S", {
    segmentCount: 1,
    mustRetainOutsideGeometry: true,
    expectedFlags: 5
  });
  await assertExactRectangleStrokeClip(openPdf, "[3 2] 0 d 4 w -2 5 m 12 5 l S", {
    minimumSegmentCount: 2,
    mustRetainOutsideGeometry: true
  });
  await assertExactRectangleStrokeClip(openPdf, "1 J 4 w -2 5 m 12 5 l S", {
    segmentCount: 1,
    mustRetainOutsideGeometry: true,
    expectedFlags: 6
  });
  await assertExactRectangleStrokeClip(openPdf, "4 w -2 2 m 0 14 10 14 12 2 c S", {
    minimumSegmentCount: 2,
    mustRetainOutsideGeometry: true
  });
  await assertExactRectangleTextClip(openPdf);
  await assertOutsideFormTextIsCulled(openPdf);
  await assertArbitraryTextClipVectors(openPdf);
  console.log("native direct VectorScene Form flattening passed");
} finally {
  hooks.deregister();
}

async function assertIdenticalFormOccurrenceCache(openPdf) {
  const compile = async (bytes, label) => {
    const session = await openPdf(
      { kind: "bytes", bytes, label },
      {
        missingFontResolver() {
          return { sfntBytes: buildTinySfnt(), identifier: "vector-form-cache-fixture-v1" };
        }
      }
    );
    try {
      assert.equal(typeof session.compileVectorPageWithTimings, "function");
      return await session.compileVectorPageWithTimings(0, { optimization: "none" });
    } finally {
      await session.close();
    }
  };

  const cached = await compile(
    identicalFormSpecializationFixture(false),
    "native-vector-identical-form-cache.pdf"
  );
  const uncached = await compile(
    identicalFormSpecializationFixture(true),
    "native-vector-distinct-form-definitions.pdf"
  );
  assert.equal(cached.timings.formOccurrenceCacheMisses, 1);
  assert.equal(cached.timings.formOccurrenceCacheHits, 1);
  assert.equal(uncached.timings.formOccurrenceCacheMisses, 2);
  assert.equal(uncached.timings.formOccurrenceCacheHits, 0);
  assert.deepEqual(
    cached.scene,
    uncached.scene,
    "a cached identical specialization must equal two independently compiled definitions"
  );
}

async function assertClippedFormVectors(openPdf) {
  const session = await openPdf({ kind: "bytes", bytes: clippedCallerFixture() });
  try {
    const scene = await session.compileVectorPage(0, { preserveDrawingOrder: true, vectorFallback: "error" });
    assert.equal(scene.rasterLayers.length, 0);
    assert.equal(scene.fillPathCount, 1);
    assert.equal(scene.clipPaths.length, 2, "caller path intersects the Form BBox");
    assert.equal(scene.drawRuns[0].clipIndex, 1);
    assert(!session.getDiagnostics().some(d => d.code === "page-raster-fallback"));
  } finally { await session.close(); }
}

async function assertSelectiveTransparencyComposite(openPdf) {
  const session = await openPdf({
    kind: "bytes",
    bytes: transparencyGroupFixture(),
    label: "native-vector-selective-transparency.pdf"
  });
  try {
    const scene = await session.compileVectorPage(0, { optimization: "none" });
    assert.equal(scene.fillPathCount, 1, "transparency groups retain their canonical vector paint");
    assert.equal(scene.rasterLayers.length, 0);
    const groups = [];
    const visit = nodes => { for (const node of nodes) if (node.kind === "group") { groups.push(node); visit(node.children); } };
    visit(scene.paintGraph.roots);
    assert.ok(groups.some(group => group.isolated), "the Form preserves its isolated compositing boundary");
  } finally {
    await session.close();
  }
}

async function assertBackdropMultiplyCorrection(openPdf) {
  const session = await openPdf({
    kind: "bytes",
    bytes: backdropMultiplyFixture(),
    label: "native-vector-backdrop-multiply.pdf"
  });
  try {
    const scene = await session.compileVectorPage(0, { optimization: "none" });
    assert.equal(scene.rasterLayers.length, 1, "only the original image remains raster");
    assert.equal(scene.fillPathCount, 1, "the translucent Multiply Form remains vector");
    assert.deepEqual(scene.drawRuns.map(run => [run.kind, run.blendMode]),
      [["raster", undefined], ["fill", "Multiply"]]);
    assert.equal(scene.fillPathMetaC[3], 0.5, "Multiply retains source alpha");
    assert.deepEqual(sampleRasterLayers(scene.rasterLayers, 5, 5), [200, 100, 50, 255]);
    assert(!session.getDiagnostics().some(d => d.code.endsWith("raster-fallback")));
  } finally {
    await session.close();
  }
}

function sampleRasterLayers(layers, x, y) {
  let output = [0, 0, 0, 0];
  for (const layer of layers) {
    output = sourceOver(sampleRasterLayer(layer, x, y), output);
  }
  return output;
}

function sampleRasterLayer(layer, x, y) {
  const [a, b, c, d, e, f] = layer.matrix;
  assert.equal(b, 0);
  assert.equal(c, 0);
  const pixelX = Math.floor((x - e) * layer.width / a);
  const pixelY = Math.floor((y - f) * layer.height / d);
  if (pixelX < 0 || pixelY < 0 || pixelX >= layer.width || pixelY >= layer.height) {
    return [0, 0, 0, 0];
  }
  const offset = (pixelY * layer.width + pixelX) * 4;
  return Array.from(layer.data.subarray(offset, offset + 4));
}

function sourceOver(source, backdrop) {
  const sourceAlpha = source[3] / 255;
  const backdropAlpha = backdrop[3] / 255;
  const alpha = sourceAlpha + backdropAlpha * (1 - sourceAlpha);
  if (alpha === 0) return [0, 0, 0, 0];
  return [0, 1, 2].map((channel) => Math.round((
    source[channel] / 255 * sourceAlpha +
    backdrop[channel] / 255 * backdropAlpha * (1 - sourceAlpha)
  ) / alpha * 255)).concat(Math.round(alpha * 255));
}

function assertRgbaWithin(actual, expected, tolerance, message) {
  assert.equal(actual.length, expected.length);
  for (let channel = 0; channel < expected.length; channel += 1) {
    assert.ok(Math.abs(actual[channel] - expected[channel]) <= tolerance,
      `${message}: channel ${channel}, expected ${expected[channel]}, got ${actual[channel]}`);
  }
}

async function assertSafeDisjointInterleavedPaint(openPdf) {
  const session = await openPdf({ kind: "bytes", bytes: disjointInterleavedPaintFixture() });
  try {
    const scene = await session.compileVectorPage(0, { optimization: "none" });
    assert.equal(scene.fillPathCount, 2);
  } finally {
    await session.close();
  }
}

async function assertSafeDisjointInterleavedText(openPdf) {
  const session = await openPdf(
    { kind: "bytes", bytes: interleavedTextFixture(12, 12) },
    {
      missingFontResolver() {
        return { sfntBytes: buildTinySfnt(), identifier: "vector-form-order-fixture-v1" };
      }
    }
  );
  try {
    const scene = await session.compileVectorPage(0, { optimization: "none" });
    assert.equal(scene.fillPathCount, 1);
    assert.equal(scene.textInstanceCount, 1);
  } finally {
    await session.close();
  }
}

async function assertOrderedOverlappingInterleavedText(openPdf) {
  const session = await openPdf(
    { kind: "bytes", bytes: interleavedTextFixture(2, 2) },
    {
      missingFontResolver() {
        return { sfntBytes: buildTinySfnt(), identifier: "vector-form-order-fixture-v1" };
      }
    }
  );
  try {
    const scene = await session.compileVectorPage(0, { vectorFallback: "error", preserveDrawingOrder: true });
    assert.equal(scene.rasterLayers.length, 0);
    assert.deepEqual(scene.drawRuns, [
      { kind: "text", first: 0, count: 1 }, { kind: "fill", first: 0, count: 1, clipIndex: 0 }
    ]);
  } finally {
    await session.close();
  }
}

async function assertExactRectangleTextClip(openPdf) {
  const session = await openPdf(
    { kind: "bytes", bytes: exactRectangleTextClipFixture() },
    {
      missingFontResolver() {
        return { sfntBytes: buildTinySfnt(), identifier: "vector-form-clip-fixture-v1" };
      }
    }
  );
  try {
    const scene = await session.compileVectorPage(0, { optimization: "none" });
    assert.equal(scene.textInstanceCount, 1);
    assert.equal(scene.textIndex.pages[0].text, "A");
  } finally {
    await session.close();
  }
}

async function assertExactRectangleFillClip(openPdf, evenOdd) {
  const session = await openPdf({
    kind: "bytes",
    bytes: crossingFillFixture(evenOdd)
  });
  try {
    const scene = await session.compileVectorPage(0, { optimization: "none" });
    assert.equal(scene.fillPathCount, 1);
    assert.equal(scene.fillSegmentCount, 4);
    assert.deepEqual(
      Array.from(scene.fillPathMetaA.subarray(2, 4)),
      [0, 0],
      "the retained winding path may cross the Form BBox, but its draw quad may not"
    );
    assert.deepEqual(Array.from(scene.fillPathMetaB.subarray(0, 2)), [10, 10]);
    assert.equal(scene.fillPathMetaC[0], evenOdd ? 1 : 0);
    assert.ok(
      scene.fillSegmentsA.some((value) => value < 0) &&
        scene.fillSegmentsA.some((value) => value > 10),
      "the complete source edges remain available for exact winding evaluation"
    );
  } finally {
    await session.close();
  }
}

async function assertExactRectangleStrokeClip(openPdf, formContent, expectations) {
  const session = await openPdf({
    kind: "bytes",
    bytes: crossingStrokeFixture(formContent)
  });
  try {
    const scene = await session.compileVectorPage(0, { optimization: "none" });
    if (expectations.segmentCount !== undefined) {
      assert.equal(scene.segmentCount, expectations.segmentCount);
    } else {
      assert.ok(scene.segmentCount >= expectations.minimumSegmentCount);
    }
    if (expectations.mustRetainOutsideGeometry) {
      assert.ok(
        scene.endpoints.some((value, index) => index % 2 === 0 && (value < 0 || value > 10)) ||
          scene.primitiveMeta.some((value, index) => index % 4 === 0 && (value < 0 || value > 10)),
        "fragment clipping must not analytically trim source lines, dashes, or curves"
      );
    } else {
      assert.deepEqual(Array.from(scene.endpoints), [2, 0, 8, 0]);
    }
    let clippedCount = 0;
    for (let index = 0; index < scene.segmentCount; index += 1) {
      const offset = index * 4;
      const styleFlags = Math.trunc(scene.primitiveMeta[offset + 3] / 2 + 1e-6);
      if (expectations.expectedFlags !== undefined) {
        assert.equal(styleFlags, expectations.expectedFlags);
      }
      if ((styleFlags & 4) === 0) continue;
      clippedCount += 1;
      assert.deepEqual(
        Array.from(scene.primitiveBounds.subarray(offset, offset + 4)),
        [0, 0, 10, 10],
        "each crossing primitive retains the complete Form BBox as its exact fragment clip"
      );
    }
    assert.ok(clippedCount > 0, "the renderer receives at least one fragment-clipped primitive");
  } finally {
    await session.close();
  }
}

async function assertOutsideFormTextIsCulled(openPdf) {
  const session = await openPdf(
    { kind: "bytes", bytes: outsideFormTextFixture() },
    {
      missingFontResolver() {
        return { sfntBytes: buildTinySfnt(), identifier: "vector-form-clip-fixture-v1" };
      }
    }
  );
  try {
    const scene = await session.compileVectorPage(0, { optimization: "none" });
    assert.equal(scene.textInstanceCount, 0, "the implicit Form BBox culls outside glyph paint");
    assert.equal(
      scene.textIndex.pages[0].text,
      "",
      "off-view Form text must not be searchable"
    );
  } finally {
    await session.close();
  }
}

async function assertArbitraryTextClipVectors(openPdf) {
  const session = await openPdf(
    { kind: "bytes", bytes: arbitraryTextClipFixture() },
    {
      missingFontResolver() {
        return { sfntBytes: buildTinySfnt(), identifier: "vector-form-clip-fixture-v1" };
      }
    }
  );
  try {
    const scene = await session.compileVectorPage(0, { preserveDrawingOrder: true, vectorFallback: "error" });
    assert.equal(scene.rasterLayers.length, 0);
    assert.equal(scene.textInstanceCount, 1, "clipped text retains its original glyph outlines");
    assert.equal(scene.drawRuns[0].clipIndex, 1);
    assert.equal(scene.textIndex.pages[0].text, "A", "clipped Form text remains searchable");
    assert([...scene.textIndex.pages[0].charInstance].every(index => index >= 0));
    assert(!session.getDiagnostics().some(d => d.code === "page-raster-fallback"));
  } finally {
    await session.close();
  }
}

function nestedFormFixture() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 120 100] /Resources << /XObject << /Outer 5 0 R >> >> /Contents 4 0 R >>"
      },
      {
        number: 4,
        body: tinyPdfStream("", "/Outer Do q 1 0 0 1 40 40 cm /Outer Do Q")
      },
      {
        number: 5,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 30 20] /Matrix [2 0 0 2 5 5] /Resources << /XObject << /Inner 6 0 R >> /Font << /F1 7 0 R >> >>",
          "q 1 0 0 1 20 0 cm /Inner Do Q 1 0 0 rg 0 0 10 10 re f BT /F1 10 Tf 12 2 Td (A) Tj ET"
        )
      },
      {
        number: 6,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 5 5] /Resources << >>",
          "0 0 1 rg 0 0 5 5 re f"
        )
      },
      {
        number: 7,
        body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
      }
    ]
  });
}

function identicalFormSpecializationFixture(useDistinctDefinitions) {
  const formDictionary =
    "/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Resources << /Font << /F1 7 0 R >> >>";
  const formContent = "0 0 1 rg 0 0 2 2 re f BT /F1 4 Tf 2 2 Td (A) Tj ET";
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: useDistinctDefinitions
          ? "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << /XObject << /A 5 0 R /B 6 0 R >> >> /Contents 4 0 R >>"
          : "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << /XObject << /A 5 0 R >> >> /Contents 4 0 R >>"
      },
      {
        number: 4,
        body: tinyPdfStream("", useDistinctDefinitions ? "/A Do /B Do" : "/A Do /A Do")
      },
      { number: 5, body: tinyPdfStream(formDictionary, formContent) },
      ...(useDistinctDefinitions
        ? [{ number: 6, body: tinyPdfStream(formDictionary, formContent) }]
        : []),
      {
        number: 7,
        body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
      }
    ]
  });
}

function transparencyGroupFixture() {
  return oneFormFixture(
    "/Group << /S /Transparency /I true /K false >>",
    "0 0 10 10 re f"
  );
}

function backdropMultiplyFixture() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] " +
          "/Resources << /XObject << /Bg 5 0 R /Fm 6 0 R >> >> /Contents 4 0 R >>"
      },
      {
        number: 4,
        body: tinyPdfStream("", "q 20 0 0 20 0 0 cm /Bg Do Q /Fm Do")
      },
      {
        number: 5,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 1 /Height 1 " +
            "/ColorSpace /DeviceRGB /BitsPerComponent 8",
          new Uint8Array([200, 100, 50])
        )
      },
      {
        number: 6,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 10 10] " +
            "/Resources << /ExtGState << /Mul 7 0 R >> >>",
          "/Mul gs 0.5 0.5 0.5 rg 0 0 10 10 re f"
        )
      },
      { number: 7, body: "<< /Type /ExtGState /BM /Multiply /ca 0.5 >>" }
    ]
  });
}

function clippedCallerFixture() {
  return oneFormFixture("", "0 0 10 10 re f", "0 0 m 5 0 l 2.5 5 l h W n /Fm Do");
}

function interleavedPaintFixture() {
  return oneFormFixture("", "0 0 10 10 re f", "0 0 2 2 re f /Fm Do");
}

function disjointInterleavedPaintFixture() {
  return oneFormFixture("", "0 0 10 10 re f", "12 12 2 2 re f /Fm Do");
}

function interleavedTextFixture(x, y) {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] " +
          "/Resources << /XObject << /Fm 5 0 R >> /Font << /F1 6 0 R >> >> /Contents 4 0 R >>"
      },
      {
        number: 4,
        body: tinyPdfStream("", `BT /F1 4 Tf ${x} ${y} Td (A) Tj ET /Fm Do`)
      },
      {
        number: 5,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Resources << >>",
          "0 0 10 10 re f"
        )
      },
      {
        number: 6,
        body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
      }
    ]
  });
}

function crossingFillFixture(evenOdd) {
  return oneFormFixture("", `-1 -1 12 12 re ${evenOdd ? "f*" : "f"}`);
}

function crossingStrokeFixture(formContent) {
  return oneFormFixture("", formContent);
}

function exactRectangleTextClipFixture() {
  return textClipFixture("q 0 0 10 10 re W n BT /F1 6 Tf 2 2 Td (A) Tj ET Q");
}

function arbitraryTextClipFixture() {
  return textClipFixture("q 0 0 m 10 0 l 5 10 l h W n BT /F1 6 Tf 2 2 Td (A) Tj ET Q");
}

function outsideFormTextFixture() {
  return textClipFixture("BT /F1 6 Tf 12 2 Td (A) Tj ET");
}

function textClipFixture(formContent) {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << /XObject << /Fm 5 0 R >> >> /Contents 4 0 R >>"
      },
      { number: 4, body: tinyPdfStream("", "/Fm Do") },
      {
        number: 5,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Resources << /Font << /F1 6 0 R >> >>",
          formContent
        )
      },
      {
        number: 6,
        body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
      }
    ]
  });
}

function oneFormFixture(extraDictionary, formContent, pageContent = "/Fm Do") {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << /XObject << /Fm 5 0 R >> >> /Contents 4 0 R >>"
      },
      { number: 4, body: tinyPdfStream("", pageContent) },
      {
        number: 5,
        body: tinyPdfStream(
          `/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Resources << >> ${extraDictionary}`,
          formContent
        )
      }
    ]
  });
}

async function assertOrderedInterleavedPaint(openPdf) {
  const session = await openPdf({ kind: "bytes", bytes: oneFormFixture("", "0 0 10 10 re f",
    "0 0 m 8 8 l S /Fm Do 1 1 2 2 re f 1 1 m 8 1 l S") });
  try {
    const scene = await session.compileVectorPage(0, { vectorFallback: "error", preserveDrawingOrder: true });
    assert.equal(scene.rasterLayers.length, 0);
    assert.equal(scene.fillPathCount, 2);
    assert.equal(scene.segmentCount, 2);
    assert.deepEqual(scene.drawRuns, [
      { kind: "stroke", first: 0, count: 1, clipIndex: 0 },
      { kind: "fill", first: 1, count: 1, clipIndex: 1 },
      { kind: "fill", first: 0, count: 1 },
      { kind: "stroke", first: 1, count: 1 }
    ]);
  } finally { await session.close(); }
}
