import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const { buildNativeVectorPage } = await import("../src/pdf/nativeVectorPage.ts");
  const {
    compileDensePdfContent,
    DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH,
    DENSE_PDF_LEGACY_VECTOR_EVENT_IMAGE,
    DENSE_PDF_LEGACY_VECTOR_EVENT_ORDINARY_PAINT,
    DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_CLIPPED,
    DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_LATE_AFTER_TEXT
  } = await import("../src/pdf/nativeContentCompiler.ts");

  const endpoints = new Float32Array([0, 0, 5, 5]);
  const primitiveMeta = new Float32Array([0, 0, 0, 1]);
  const primitiveBounds = new Float32Array([0, 0, 5, 5]);
  const styles = new Float32Array([0.5, 0, 0, 0]);
  const fillPathMetaA = new Float32Array([0, 1, 0, 0]);
  const fillPathMetaB = new Float32Array([4, 4, 0, 1]);
  const fillPathMetaC = new Float32Array([0, 0, 0, 1]);
  const fillSegmentsA = new Float32Array([0, 0, 4, 0]);
  const fillSegmentsB = new Float32Array([4, 0, 0, 0]);
  const legacyVector = {
    sourceEvents: new Uint32Array([
      DENSE_PDF_LEGACY_VECTOR_EVENT_IMAGE, 0,
      DENSE_PDF_LEGACY_VECTOR_EVENT_ORDINARY_PAINT, 0,
      DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH, 0,
      DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH, 1
    ]),
    glyphRunMeta: new Uint32Array([
      0, 1, 0,
      1, 1, 3
    ]),
    glyphFillColors: new Float32Array([
      0.25, 0.5, 0.75, 0.8,
      0, 0, 0, 0
    ]),
    imageIndices: new Uint32Array([0]),
    imageTransforms: new Float32Array([10, 0, 0, 10, 2, 3]),
    imageClipBounds: new Float32Array([0, 0, 100, 80]),
    imagePaintOrders: new Uint32Array([7]),
    imageFlags: new Uint8Array([0])
  };
  const compiled = {
    operatorCount: 9,
    pathCount: 2,
    sourceSegmentCount: 1,
    mergedSegmentCount: 1,
    segmentCount: 1,
    endpoints,
    primitiveMeta,
    primitiveBounds,
    styles,
    fillPathCount: 1,
    fillSegmentCount: 1,
    fillPathMetaA,
    fillPathMetaB,
    fillPathMetaC,
    fillSegmentsA,
    fillSegmentsB,
    formPaints: [],
    maxHalfWidth: 0.5,
    bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
    strokeBounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
    fillBounds: { minX: 0, minY: 0, maxX: 4, maxY: 4 },
    discardedTransparentCount: 0,
    discardedDegenerateCount: 0,
    discardedDuplicateCount: 0,
    discardedContainedCount: 0,
    legacyVector
  };
  const textCompilation = {
    transforms: {
      values: new Float32Array([
        1, 0, 0, 1, 0, 0,
        1, 0, 0, 1, 10, 10,
        1, 0, 0, 1, 20, 20
      ])
    },
    glyphs: {
      fontIndices: new Uint32Array([0, 0]),
      characterCodes: new Uint32Array([65, 66]),
      glyphIds: new Uint32Array([65, 66]),
      transformIndices: new Uint32Array([1, 2]),
      advances: new Float32Array([8, 0, 8, 0]),
      flags: new Uint8Array([0, 1 << 1])
    },
    textIndex: {
      version: 1,
      text: "AB",
      charGlyphIndices: new Int32Array([0, 1]),
      fallbackQuads: new Float32Array(0)
    },
    glyphAdvanceEms: new Float32Array([0.008, 0.008]),
    runs: [
      { first: 0, count: 1, fontIndex: 0, renderingMode: 0 },
      { first: 1, count: 1, fontIndex: 0, renderingMode: 3 }
    ],
    diagnostics: []
  };
  const font = {
    subtype: "TrueType",
    baseFont: "Fixture",
    writingMode: 0,
    unitsPerEm: 1000,
    descriptor: {
      ascent: 800,
      descent: -200,
      fontBBox: [0, -200, 800, 800]
    },
    getGlyphOutline(glyphId) {
      assert.equal(glyphId, 65, "invisible glyphs must not force outline decoding");
      return {
        glyphId,
        commands: [
          { kind: "move", x: 0, y: 0 },
          { kind: "line", x: 8, y: 0 },
          {
            kind: "cubic",
            control1X: 16 / 3,
            control1Y: 20 / 3,
            control2X: 8 / 3,
            control2Y: 20 / 3,
            x: 0,
            y: 0
          },
          { kind: "close" }
        ],
        bounds: [0, 0, 8, 10],
        advanceWidth: 8,
        leftSideBearing: 0
      };
    }
  };
  const imageData = new Uint8Array([10, 20, 30, 255]);
  const imageRegistry = {
    size: 1,
    describe(index) {
      assert.equal(index, 0);
      return {
        width: 1,
        height: 1,
        sourceBitsPerComponent: 8,
        format: 0,
        colorSpaceIndex: 0,
        interpolate: true,
        imageMask: false,
        softMaskImageIndex: -1,
        maskKind: "none",
        colorKeyMask: [],
        decode: [],
        matte: [],
        data: imageData,
        codecRequest: null
      };
    }
  };
  const input = {
    pageInfo: { sourcePageIndex: 3, width: 100, height: 80 },
    pageBounds: { minX: 0, minY: 0, maxX: 100, maxY: 80 },
    compiled,
    textCompilation,
    fontResources: [{ font, fontIndex: 0 }],
    imageRegistry,
    maxPaths: 16
  };

  const scene = buildNativeVectorPage(input);
  assert.equal(scene.pageCount, 1);
  assert.equal(scene.pagesPerRow, 1);
  assert.strictEqual(scene.endpoints, endpoints, "stroke buffers must stay zero-copy");
  assert.strictEqual(scene.primitiveMeta, primitiveMeta);
  assert.strictEqual(scene.primitiveBounds, primitiveBounds);
  assert.strictEqual(scene.styles, styles);
  assert.strictEqual(scene.fillPathMetaA, fillPathMetaA, "fill buffers must stay zero-copy");
  assert.strictEqual(scene.fillSegmentsA, fillSegmentsA);
  assert.equal(scene.textGlyphCount, 1);
  assert.equal(scene.textGlyphSegmentCount, 2);
  assert.equal(scene.textGlyphSegmentsB[6], 1, "a cubic glyph must use the quadratic legacy ABI");
  assert.equal(scene.textInstanceCount, 1);
  assert.deepEqual([...scene.textInstanceA], [1, 0, 0, 1]);
  assert.deepEqual([...scene.textInstanceB], [10, 10, 0, 0]);
  assert.deepEqual([...scene.textInstanceC], [0.25, 0.5, 0.75, 0.800000011920929]);
  assert.equal(scene.textIndex.pages[0].text, "AB");
  assert.deepEqual([...scene.textIndex.pages[0].charInstance], [0, -2]);
  assert.deepEqual([...scene.textIndex.pages[0].fallbackQuads], [20, -230, 28, 870]);
  assert.equal(scene.rasterLayers.length, 1);
  assert.strictEqual(scene.rasterLayers[0].data, imageData, "decoded image bytes must stay zero-copy");
  assert.deepEqual([...scene.rasterLayers[0].matrix], [10, 0, 0, -10, 2, 13]);
  assert.equal(scene.rasterLayers[0].paintOrder, 7);
  assert.equal(scene.rasterLayers[0].pageIndex, 0, "a one-page scene uses layout slot zero");

  const softMaskedBase = {
    ...imageRegistry.describe(0),
    interpolate: false,
    softMaskImageIndex: 1,
    maskKind: "soft",
    matte: [0, 0, 0],
    data: new Uint8Array([128, 64, 32, 200])
  };
  const softMask = {
    ...imageRegistry.describe(0),
    colorSpaceIndex: 1,
    interpolate: false,
    data: new Uint8Array([128, 128, 128, 255])
  };
  const softMaskedScene = buildNativeVectorPage({
    ...input,
    imageRegistry: {
      size: 2,
      describe(index) {
        if (index === 0) return softMaskedBase;
        if (index === 1) return softMask;
        throw new RangeError(`missing image ${index}`);
      },
      colors: {
        describe(index) {
          assert.equal(index, 0);
          return { componentCount: 3 };
        },
        convertToSrgb(index, components) {
          assert.equal(index, 0);
          return components;
        }
      }
    }
  });
  assert.deepEqual(
    [...softMaskedScene.rasterLayers[0].data],
    [255, 128, 64, 100],
    "image SMask opacity and matte removal are collapsed into straight RGBA"
  );
  assert.notStrictEqual(
    softMaskedScene.rasterLayers[0].data,
    softMaskedBase.data,
    "only a masked image allocates compatibility pixels"
  );

  const disjointLateImageScene = buildNativeVectorPage({
    ...input,
    compiled: {
      ...compiled,
      legacyVector: {
        ...legacyVector,
        sourceEvents: new Uint32Array([
          DENSE_PDF_LEGACY_VECTOR_EVENT_ORDINARY_PAINT, 0,
          DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH, 0,
          DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH, 1,
          DENSE_PDF_LEGACY_VECTOR_EVENT_IMAGE, 0
        ]),
        imageTransforms: new Float32Array([10, 0, 0, 10, 40, 40]),
        imagePaintOrders: new Uint32Array([1]),
        imageFlags: new Uint8Array([
          DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_LATE_AFTER_TEXT
        ])
      }
    }
  });
  assert.deepEqual(
    [...disjointLateImageScene.rasterLayers[0].matrix],
    [10, 0, 0, -10, 40, 50],
    "a spatially disjoint late image stays in the existing underlay pass"
  );
  const nearestClippedScene = buildNativeVectorPage({
    ...input,
    imageRegistry: {
      ...imageRegistry,
      describe(index) {
        return { ...imageRegistry.describe(index), interpolate: false };
      }
    },
    compiled: {
      ...compiled,
      legacyVector: {
        ...legacyVector,
        imageClipBounds: new Float32Array([5, 5, 8, 8]),
        imageFlags: new Uint8Array([DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_CLIPPED])
      }
    }
  });
  const nearestClippedLayer = nearestClippedScene.rasterLayers[0];
  assert.deepEqual([...nearestClippedLayer.matrix], [14, 0, 0, -14, 0, 15]);
  assert.equal(nearestClippedLayer.width, 14);
  assert.equal(nearestClippedLayer.height, 14);
  const nearestOpaquePixels = [];
  for (let y = 0; y < nearestClippedLayer.height; y += 1) {
    for (let x = 0; x < nearestClippedLayer.width; x += 1) {
      const offset = (y * nearestClippedLayer.width + x) * 4;
      if (nearestClippedLayer.data[offset + 3] !== 0) {
        nearestOpaquePixels.push([x, y, ...nearestClippedLayer.data.subarray(offset, offset + 4)]);
      }
    }
  }
  assert.deepEqual(
    nearestOpaquePixels,
    Array.from({ length: 9 }, (_unused, index) => [
      5 + index % 3,
      7 + Math.floor(index / 3),
      ...imageData
    ]),
    "a rectangular clip keeps the established placement-grid padding transparent"
  );

  const brochureWidth = 1_246;
  const brochureHeight = 1_175;
  const brochurePixels = new Uint8Array(brochureWidth * brochureHeight * 4);
  setPixel(brochurePixels, brochureWidth, 2, 2, [11, 12, 13, 255]);
  setPixel(brochurePixels, brochureWidth, 622, 502, [21, 22, 23, 255]);
  setPixel(brochurePixels, brochureWidth, 1_243, 1_172, [31, 32, 33, 255]);
  setPixel(brochurePixels, brochureWidth, 102, 1_173, [41, 42, 43, 255]);
  const brochureTransform = new Float32Array([
    597.4768677, 0, 0, 563.3865967, -1.03469956, 279.524353
  ]);
  const brochureClip = new Float32Array([
    0, 280.6300049, 595.2750244, 841.8900146
  ]);
  const brochurePageBounds = {
    minX: 0,
    minY: 0,
    maxX: brochureClip[2],
    maxY: brochureClip[3]
  };
  const brochureClippedScene = buildNativeVectorPage({
    ...input,
    pageInfo: {
      sourcePageIndex: 0,
      width: brochurePageBounds.maxX,
      height: brochurePageBounds.maxY
    },
    pageBounds: brochurePageBounds,
    imageRegistry: {
      ...imageRegistry,
      describe(index) {
        return {
          ...imageRegistry.describe(index),
          width: brochureWidth,
          height: brochureHeight,
          interpolate: false,
          data: brochurePixels
        };
      }
    },
    compiled: {
      ...compiled,
      legacyVector: {
        ...legacyVector,
        imageTransforms: brochureTransform,
        imageClipBounds: brochureClip,
        imageFlags: new Uint8Array([DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_CLIPPED])
      }
    }
  });
  const brochureLayer = brochureClippedScene.rasterLayers[0];
  assert.equal(brochureLayer.width, 1_242);
  assert.equal(brochureLayer.height, 1_175);
  assert.deepEqual(
    [...brochureLayer.matrix],
    [595.5115966796875, 0, 0, -563.3865966796875, 0, 841.8900146484375],
    "the native clip must retain the established full sampling grid and page clamp"
  );
  assert.deepEqual(readPixel(brochureLayer, 0, 0), [11, 12, 13, 255]);
  assert.deepEqual(readPixel(brochureLayer, 620, 500), [21, 22, 23, 255]);
  assert.deepEqual(
    readPixel(brochureLayer, 1_241, 1_170),
    [31, 32, 33, 73],
    "fractional clip edges retain coverage without shifting the source sample"
  );
  assert.deepEqual(
    readPixel(brochureLayer, 100, 1_171),
    [0, 0, 0, 0],
    "placement padding below the exact clip remains transparent"
  );
  assert.throws(
    () => buildNativeVectorPage({
      ...input,
      compiled: {
        ...compiled,
        legacyVector: {
          ...legacyVector,
          sourceEvents: new Uint32Array([
            DENSE_PDF_LEGACY_VECTOR_EVENT_ORDINARY_PAINT, 0,
            DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH, 0,
            DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH, 1,
            DENSE_PDF_LEGACY_VECTOR_EVENT_IMAGE, 0
          ]),
          imageTransforms: new Float32Array([10, 0, 0, 10, 12, 12]),
          imagePaintOrders: new Uint32Array([1]),
          imageFlags: new Uint8Array([
            DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_LATE_AFTER_TEXT
          ])
        }
      }
    }),
    (error) => error?.code === "unsupported-content" &&
      error?.details?.reason === "legacy-vector-image-order-overlap",
    "an overlapping preceding glyph must keep the PDF.js compatibility fallback"
  );

  for (const { label, matrix, clip } of [
    { label: "rotated", matrix: [0, 1, -1, 0, 20, 10], clip: [14, 9, 19, 20] },
    { label: "skewed", matrix: [1, 0.25, 0.4, 1, 10, 10], clip: [12, 9, 17, 24] }
  ]) {
    const clippedScene = buildNativeVectorPage({
      ...input,
      compiled: {
        ...compiled,
        legacyVector: {
          ...legacyVector,
          glyphClipBounds: new Float32Array([...clip, 0, 0, 100, 80]),
          glyphRunFlags: new Uint8Array([1, 0])
        }
      },
      textCompilation: {
        ...textCompilation,
        transforms: {
          values: new Float32Array([
            1, 0, 0, 1, 0, 0,
            ...matrix,
            1, 0, 0, 1, 20, 20
          ])
        }
      }
    });
    assert.deepEqual([...clippedScene.textClipRects], clip, `${label} clip stays page-space exact`);
    assert.equal(clippedScene.textInstanceB[3], 1, `${label} glyph references its clip`);
    assert.equal(clippedScene.textGlyphSegmentCount, 2, `${label} winding/curve outline is unchanged`);
    assert.equal(clippedScene.textIndex.pages[0].text, "AB", `${label} source text is unchanged`);
  }

  assert.doesNotThrow(
    () => buildNativeVectorPage({
      ...input,
      compiled: {
        ...compiled,
        legacyVector: { ...legacyVector, imageFlags: new Uint8Array([1]) }
      }
    }),
    "an exact rectangular clip containing the whole image is a semantic no-op"
  );
  assert.throws(
    () => buildNativeVectorPage({
      ...input,
      compiled: {
        ...compiled,
        legacyVector: {
          ...legacyVector,
          imageClipBounds: new Float32Array([5, 5, 8, 8]),
          imageFlags: new Uint8Array([1])
        }
      }
    }),
    (error) => error?.code === "unsupported-content" &&
      error?.details?.reason === "legacy-vector-image-clip",
    "an interpolated partial-pixel clip still fails instead of changing sampling semantics"
  );
  assert.throws(
    () => buildNativeVectorPage({ ...input, compiled: { ...compiled, legacyVector: null } }),
    (error) => error?.code === "unsupported-content" &&
      error?.details?.reason === "legacy-vector-sidecar-missing"
  );

  assert.strictEqual(
    scene.gradientMetaA.buffer,
    scene.gradientStrokeStyles.buffer,
    "empty floating-point stores may share one buffer within a scene"
  );
  structuredClone(scene, {
    transfer: [scene.gradientMetaA.buffer]
  });
  const repeatedScene = buildNativeVectorPage(input);
  assert.notStrictEqual(
    repeatedScene.gradientMetaA.buffer,
    scene.gradientMetaA.buffer,
    "each build must own a fresh transferable empty buffer"
  );
  assert.doesNotThrow(() => structuredClone(repeatedScene, {
    transfer: [repeatedScene.gradientMetaA.buffer]
  }));

  await testCompiledAggregateBounds(buildNativeVectorPage, compileDensePdfContent);
  benchmarkPackedBoundsAdaptation(buildNativeVectorPage);

  console.log("native direct VectorScene page builder passed");
} finally {
  hooks.deregister();
}

function setPixel(data, width, x, y, rgba) {
  data.set(rgba, (y * width + x) * 4);
}

function readPixel(layer, x, y) {
  const offset = (y * layer.width + x) * 4;
  return [...layer.data.subarray(offset, offset + 4)];
}

async function testCompiledAggregateBounds(buildNativeVectorPage, compileDensePdfContent) {
  const encoder = new TextEncoder();
  const pageBounds = { minX: -100, minY: -100, maxX: 100, maxY: 100 };
  const content = encoder.encode([
    "q",
    "-7.125 -5.5 13.75 11.25 re W n",
    "0.333333343 0 0 0.714285731 0.123456789 -0.765432109 cm",
    "-20.125 -9.75 50.625 20.875 re f",
    "-12.25 -3.5 m 33.125 8.75 l S",
    "-12.25 -3.5 m 33.125 8.75 l S",
    "-2.125 -1.75 4.625 3.875 re f",
    "Q"
  ].join("\n"));
  const configurations = [
    { enableSegmentMerge: false, enableInvisibleCull: false },
    { enableSegmentMerge: true, enableInvisibleCull: false },
    { enableSegmentMerge: false, enableInvisibleCull: true },
    { enableSegmentMerge: true, enableInvisibleCull: true }
  ];

  for (const configuration of configurations) {
    const compiled = await compileDensePdfContent(content, {
      pageMatrix: [1, 0, 0, 1, 0, 0],
      pageBounds: { ...pageBounds },
      legacyVectorOutput: true,
      yieldIntervalMs: 1_000,
      ...configuration
    });
    const rescanned = rescanPackedGeometryBounds(compiled);
    assert.deepEqual(
      roundBoundsToFloat32(compiled.fillBounds),
      rescanned.fillBounds,
      `fill aggregate must match the packed ABI for ${JSON.stringify(configuration)}`
    );
    assert.deepEqual(
      compiled.strokeBounds,
      rescanned.strokeBounds,
      `stroke aggregate must match the retained primitives for ${JSON.stringify(configuration)}`
    );

    const input = makeGeometryOnlyInput(compiled, pageBounds);
    const scene = buildNativeVectorPage(input);
    assert.deepEqual(
      scene.bounds,
      combineBounds(rescanned.fillBounds, rescanned.strokeBounds),
      `adapter bounds must stay byte-domain equivalent for ${JSON.stringify(configuration)}`
    );

    assert.throws(
      () => buildNativeVectorPage({
        ...input,
        compiled: { ...compiled, fillBounds: null }
      }),
      (error) => error?.code === "invalid-object" &&
        error?.details?.reason === "legacy-vector-packed-bounds",
      "a nonempty packed fill store requires its compiler aggregate"
    );
    assert.throws(
      () => buildNativeVectorPage({
        ...input,
        compiled: { ...compiled, strokeBounds: null }
      }),
      (error) => error?.code === "invalid-object" &&
        error?.details?.reason === "legacy-vector-packed-bounds",
      "a nonempty packed stroke store requires its finalization aggregate"
    );
  }

  const overflowCompiled = makeSyntheticCompiledPage(2, 1);
  overflowCompiled.fillPathMetaA.set([0, 1, Infinity, 10, 1, 1, 1, 2]);
  overflowCompiled.fillPathMetaB.set([Infinity, 20, 0, 0, 3, 4, 0, 0]);
  overflowCompiled.fillBounds = { minX: 1, minY: 2, maxX: 1e300, maxY: 20 };
  overflowCompiled.bounds = combineBounds(
    overflowCompiled.fillBounds,
    overflowCompiled.strokeBounds
  );
  const overflowExpected = rescanPackedGeometryBounds(overflowCompiled).bounds;
  assert.deepEqual(
    buildNativeVectorPage(makeGeometryOnlyInput(overflowCompiled, pageBounds)).bounds,
    overflowExpected,
    "Float32 overflow retains the established per-path non-finite filtering"
  );
}

function benchmarkPackedBoundsAdaptation(buildNativeVectorPage) {
  const fillPathCount = 50_000;
  const segmentCount = 100_000;
  const compiled = makeSyntheticCompiledPage(fillPathCount, segmentCount);
  const pageBounds = { minX: -1, minY: -1, maxX: 2_000, maxY: 2_000 };
  const input = makeGeometryOnlyInput(compiled, pageBounds);
  const expected = combineBounds(
    roundBoundsToFloat32(compiled.fillBounds),
    compiled.strokeBounds
  );
  assert.deepEqual(rescanPackedGeometryBounds(compiled).bounds, expected);

  for (let warmup = 0; warmup < 2; warmup += 1) {
    buildNativeVectorPage(input);
    rescanPackedGeometryBounds(compiled);
  }

  const optimizedTimes = [];
  const priorTimes = [];
  for (let iteration = 0; iteration < 7; iteration += 1) {
    let started = performance.now();
    const optimized = buildNativeVectorPage(input);
    optimizedTimes.push(performance.now() - started);
    assert.deepEqual(optimized.bounds, expected);

    started = performance.now();
    const rescanned = rescanPackedGeometryBounds(compiled);
    const prior = buildNativeVectorPage(input);
    priorTimes.push(performance.now() - started);
    assert.deepEqual(rescanned.bounds, prior.bounds);
  }

  const optimizedMedian = median(optimizedTimes);
  const priorMedian = median(priorTimes);
  console.log(
    `native bounds adaptation benchmark (${fillPathCount + segmentCount} packed primitives): ` +
    `rescan ${priorMedian.toFixed(2)} ms, aggregate ${optimizedMedian.toFixed(2)} ms`
  );
}

function makeGeometryOnlyInput(compiled, pageBounds) {
  return {
    pageInfo: {
      sourcePageIndex: 0,
      width: pageBounds.maxX - pageBounds.minX,
      height: pageBounds.maxY - pageBounds.minY
    },
    pageBounds,
    compiled,
    textCompilation: {
      transforms: { values: new Float32Array([1, 0, 0, 1, 0, 0]) },
      glyphs: {
        fontIndices: new Uint32Array(0),
        characterCodes: new Uint32Array(0),
        glyphIds: new Uint32Array(0),
        transformIndices: new Uint32Array(0),
        advances: new Float32Array(0),
        flags: new Uint8Array(0)
      },
      textIndex: {
        version: 1,
        text: "",
        charGlyphIndices: new Int32Array(0),
        fallbackQuads: new Float32Array(0)
      },
      glyphAdvanceEms: new Float32Array(0),
      runs: [],
      diagnostics: []
    },
    fontResources: [],
    imageRegistry: {
      size: 0,
      describe() {
        throw new Error("The geometry-only fixture has no images.");
      }
    },
    maxPaths: 1
  };
}

function makeSyntheticCompiledPage(fillPathCount, segmentCount) {
  const fillPathMetaA = new Float32Array(fillPathCount * 4);
  const fillPathMetaB = new Float32Array(fillPathCount * 4);
  const fillPathMetaC = new Float32Array(fillPathCount * 4);
  const fillSegmentsA = new Float32Array(fillPathCount * 4);
  const fillSegmentsB = new Float32Array(fillPathCount * 4);
  for (let path = 0; path < fillPathCount; path += 1) {
    const offset = path * 4;
    const x = (path % 1_000) * 1.25 + 0.125;
    const y = Math.floor(path / 1_000) * 2.5 + 0.375;
    fillPathMetaA[offset] = path;
    fillPathMetaA[offset + 1] = 1;
    fillPathMetaA[offset + 2] = x;
    fillPathMetaA[offset + 3] = y;
    fillPathMetaB[offset] = x + 0.75;
    fillPathMetaB[offset + 1] = y + 1.5;
    fillPathMetaC[offset + 3] = 1;
    fillSegmentsA[offset] = x;
    fillSegmentsA[offset + 1] = y;
    fillSegmentsA[offset + 2] = x + 0.75;
    fillSegmentsA[offset + 3] = y;
    fillSegmentsB[offset] = x + 0.75;
    fillSegmentsB[offset + 1] = y;
  }

  const endpoints = new Float32Array(segmentCount * 4);
  const primitiveMeta = new Float32Array(segmentCount * 4);
  const primitiveBounds = new Float32Array(segmentCount * 4);
  const styles = new Float32Array(segmentCount * 4);
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const offset = segment * 4;
    const x = (segment % 2_000) * 0.625 + 0.25;
    const y = Math.floor(segment / 2_000) * 2.5 + 0.5;
    endpoints[offset] = x;
    endpoints[offset + 1] = y;
    endpoints[offset + 2] = x + 0.5;
    endpoints[offset + 3] = y + 0.25;
    primitiveMeta[offset] = x + 1;
    primitiveMeta[offset + 1] = y + 0.5;
    primitiveMeta[offset + 3] = 1;
    primitiveBounds[offset] = x - 0.25;
    primitiveBounds[offset + 1] = y - 0.25;
    primitiveBounds[offset + 2] = x + 1.25;
    primitiveBounds[offset + 3] = y + 0.75;
    styles[offset] = 0.25;
  }

  const fillBounds = {
    minX: fillPathMetaA[2],
    minY: fillPathMetaA[3],
    maxX: fillPathMetaB[(fillPathCount - 1) * 4],
    maxY: fillPathMetaB[(fillPathCount - 1) * 4 + 1]
  };
  const strokeBounds = {
    minX: primitiveBounds[0],
    minY: primitiveBounds[1],
    maxX: primitiveBounds[(segmentCount - 1) * 4 + 2],
    maxY: primitiveBounds[(segmentCount - 1) * 4 + 3]
  };
  return {
    operatorCount: fillPathCount + segmentCount,
    pathCount: fillPathCount + segmentCount,
    sourceSegmentCount: segmentCount,
    mergedSegmentCount: segmentCount,
    segmentCount,
    endpoints,
    primitiveMeta,
    primitiveBounds,
    styles,
    fillPathCount,
    fillSegmentCount: fillPathCount,
    fillPathMetaA,
    fillPathMetaB,
    fillPathMetaC,
    fillSegmentsA,
    fillSegmentsB,
    formPaints: [],
    maxHalfWidth: 0.25,
    bounds: combineBounds(fillBounds, strokeBounds),
    strokeBounds,
    fillBounds,
    discardedTransparentCount: 0,
    discardedDegenerateCount: 0,
    discardedDuplicateCount: 0,
    discardedContainedCount: 0,
    legacyVector: {
      sourceEvents: new Uint32Array(0),
      glyphRunMeta: new Uint32Array(0),
      glyphFillColors: new Float32Array(0),
      glyphClipBounds: new Float32Array(0),
      glyphRunFlags: new Uint8Array(0),
      imageIndices: new Uint32Array(0),
      imageTransforms: new Float32Array(0),
      imageClipBounds: new Float32Array(0),
      imagePaintOrders: new Uint32Array(0),
      imageFlags: new Uint8Array(0)
    }
  };
}

function rescanPackedGeometryBounds(compiled) {
  const fillAggregate = emptyMutableBounds();
  for (let path = 0; path < compiled.fillPathCount; path += 1) {
    const offset = path * 4;
    includeMutablePoint(
      fillAggregate,
      compiled.fillPathMetaA[offset + 2],
      compiled.fillPathMetaA[offset + 3]
    );
    includeMutablePoint(
      fillAggregate,
      compiled.fillPathMetaB[offset],
      compiled.fillPathMetaB[offset + 1]
    );
  }
  const strokeAggregate = emptyMutableBounds();
  for (let segment = 0; segment < compiled.segmentCount; segment += 1) {
    const offset = segment * 4;
    includeMutablePoint(
      strokeAggregate,
      compiled.primitiveBounds[offset],
      compiled.primitiveBounds[offset + 1]
    );
    includeMutablePoint(
      strokeAggregate,
      compiled.primitiveBounds[offset + 2],
      compiled.primitiveBounds[offset + 3]
    );
  }
  const fillBounds = finalMutableBounds(fillAggregate);
  const strokeBounds = finalMutableBounds(strokeAggregate);
  return {
    fillBounds,
    strokeBounds,
    bounds: combineBounds(fillBounds, strokeBounds)
  };
}

function emptyMutableBounds() {
  return {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    empty: true
  };
}

function includeMutablePoint(bounds, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
  bounds.empty = false;
}

function finalMutableBounds(bounds) {
  return bounds.empty ? null : {
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY
  };
}

function roundBoundsToFloat32(bounds) {
  return bounds === null ? null : {
    minX: Math.fround(bounds.minX),
    minY: Math.fround(bounds.minY),
    maxX: Math.fround(bounds.maxX),
    maxY: Math.fround(bounds.maxY)
  };
}

function includeRectangle(bounds, rectangle) {
  let result = bounds === null ? null : { ...bounds };
  for (const [x, y] of [
    [rectangle.minX, rectangle.minY],
    [rectangle.maxX, rectangle.maxY]
  ]) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    result = result === null ? { minX: x, minY: y, maxX: x, maxY: y } : {
      minX: Math.min(result.minX, x),
      minY: Math.min(result.minY, y),
      maxX: Math.max(result.maxX, x),
      maxY: Math.max(result.maxY, y)
    };
  }
  return result;
}

function combineBounds(left, right) {
  if (left === null) return right === null ? null : { ...right };
  if (right === null) return { ...left };
  return includeRectangle(left, right);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}
