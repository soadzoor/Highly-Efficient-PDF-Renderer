import assert from "node:assert/strict";

import {
  DENSE_PDF_LEGACY_VECTOR_EVENT_FORM,
  DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH,
  DENSE_PDF_LEGACY_VECTOR_EVENT_IMAGE,
  DENSE_PDF_LEGACY_VECTOR_EVENT_ORDINARY_PAINT,
  DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_LATE_AFTER_TEXT,
  DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_LATE_AFTER_PATH,
  DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_SELECTIVE_PATH_SPAN,
  DENSE_PDF_PAINT_RUN_IMAGE,
  compileDensePdfContent,
  DensePdfSyntaxError,
  DensePdfUnsupportedError,
  getDensePdfPaintSourceIdentity,
  scanDensePdfPreparedResourceReferences
} from "../src/pdf/nativeContentCompiler.ts";

const encoder = new TextEncoder();
const NOOP_TEXT_SINK = Object.freeze({ applyOperator() {} });
const DEFAULT_OPTIONS = Object.freeze({
  pageMatrix: [1, 0, 0, 1, 0, 0],
  pageBounds: { minX: -1_000, minY: -1_000, maxX: 1_000, maxY: 1_000 },
  enableSegmentMerge: true,
  enableInvisibleCull: true,
  yieldIntervalMs: 4
});

await testChunkBoundaryLexer();
await testPreparedInlineImageSegments();
await testPrivatePaintSourceIdentityRange();
await testLegacyVectorOutput();
await testPathsTransformsAndCurves();
await testClippingAndDashes();
await testDeviceColorsAndMetadataCounts();
await testTextAndMarkedContentSemantics();
await testExtGStateOpacityAndOptionalContent();
await testNativeFormXObjects();
await testUnsupportedAndMalformedContent();
await testCancellationAndProgress();
await testMergeCullAndFillBoundaries();
await testLosslessExtremeCoordinateKeys();
await testCooperativeEligibilityLimits();

console.log("Dense PDF content compiler tests passed.");

async function compile(content, options = {}) {
  const source = typeof content === "string" ? encoder.encode(content) : content;
  return compileDensePdfContent(source, {
    ...DEFAULT_OPTIONS,
    ...options,
    pageMatrix: options.pageMatrix ?? [...DEFAULT_OPTIONS.pageMatrix],
    pageBounds: options.pageBounds ?? { ...DEFAULT_OPTIONS.pageBounds }
  });
}

async function testChunkBoundaryLexer() {
  const content = "% a comment split at every byte\r\n\t0.25  .5 m 10.75 20.125 l S\n";
  const expected = await compile(content, {
    enableSegmentMerge: false,
    enableInvisibleCull: false
  });
  const bytes = encoder.encode(content);
  const chunks = {
    async *[Symbol.asyncIterator]() {
      for (let index = 0; index < bytes.length; index += 1) {
        yield bytes.subarray(index, index + 1);
      }
    }
  };
  const actual = await compile(chunks, {
    enableSegmentMerge: false,
    enableInvisibleCull: false,
    totalBytes: bytes.length
  });
  assertSceneGeometryEqual(actual, expected);
  assert.equal(actual.operatorCount, 3);
  assert.equal(actual.pathCount, 1);
  assert.equal(actual.sourceSegmentCount, 1);
}

async function testPreparedInlineImageSegments() {
  const before = encoder.encode("q 2 0 0 3 5 7 cm /OC /Layer BDC ");
  const imageSourceLength = 19;
  const after = encoder.encode(" EMC Q 0 0 1 1 re f");
  const segments = [
    { kind: "content", bytes: before, sourceOffset: 0, sourceLength: before.length },
    {
      kind: "image",
      imageIndex: 7,
      sourceOffset: before.length,
      sourceLength: imageSourceLength
    },
    {
      kind: "content",
      bytes: after,
      sourceOffset: before.length + imageSourceLength,
      sourceLength: after.length
    }
  ];
  const references = scanDensePdfPreparedResourceReferences(segments);
  assert.deepEqual(references.properties, ["Layer"]);
  assert.deepEqual(references.optionalContentProperties, ["Layer"]);

  const scene = await compileDensePdfContent(segments, {
    ...DEFAULT_OPTIONS,
    preservePaintOrder: true,
    enableInvisibleCull: false,
    markedContentProperties: new Map([["Layer", {
      resourceName: "Layer",
      optionalContentIndex: 3,
      defaultVisible: true,
      mcid: 9
    }]])
  });
  assert.equal(scene.operatorCount, 8, "BI…EI counts as one prepared source operator");
  assert.deepEqual([...scene.paintRuns.slice(0, 3)], [DENSE_PDF_PAINT_RUN_IMAGE, 7, 1]);
  assert.deepEqual(scene.imageTransforms, [[2, 0, 0, 3, 5, 7]]);
  assert.equal(scene.imagePaints[0].sourceOffset, before.length);
  assert.equal(scene.imagePaints[0].sourceLength, imageSourceLength);
  assert.equal(scene.paintRunOptionalContentIndices[0], 3);
  assert.equal(scene.paintRunMarkedContentIndices[0], 0);
  assert.equal(scene.paintRuns.length / 3, 2, "graphics state continues after the image event");
}

async function testPrivatePaintSourceIdentityRange() {
  const bytes = encoder.encode("0 0 1 1 re f");
  const sourceOffset = 0x8000_0000 + 17;
  const compiled = await compileDensePdfContent([
    { kind: "content", bytes, sourceOffset, sourceLength: bytes.length }
  ], {
    ...DEFAULT_OPTIONS,
    preservePaintOrder: true,
    capturePaintSourceIdentities: true
  });
  assert.deepEqual(
    getDensePdfPaintSourceIdentity(compiled, 0),
    [sourceOffset + bytes.lastIndexOf(0x66), 1],
    "private source identities retain offsets above the signed 32-bit range"
  );
  const ordinary = await compile("0 0 1 1 re f", { preservePaintOrder: true });
  assert.equal(getDensePdfPaintSourceIdentity(ordinary, 0), null,
    "ordinary dense compilation does not allocate a paint-identity trace");
}

async function testLegacyVectorOutput() {
  const textSink = (renderingMode, first = 5, count = 2) => ({
    applyOperator(operator) {
      return operator === "Tj" ? [{ first, count, renderingMode }] : undefined;
    }
  });
  const content = [
    "q 2 0 0 3 5 7 cm /Im0 Do Q",
    "/Half gs 0.2 0.4 0.6 rg",
    "0 0 10 10 re f",
    "0 20 m 10 20 l S",
    "BT /F0 10 Tf (hi) Tj ET"
  ].join("\n");
  const options = {
    imageXObjects: new Map([["Im0", 4]]),
    textOperatorSink: textSink(0),
    extGStates: [{ resourceName: "Half", fillAlpha: 0.5 }]
  };
  const baseline = await compile(content, options);
  const scene = await compile(content, { ...options, legacyVectorOutput: true });

  assertSceneGeometryEqual(scene, baseline);
  assert.equal(scene.paintRuns.length, 0, "the grouped bridge does not retain vector paint runs");
  assert.equal(scene.glyphPaints.length, 0, "the ordered glyph ABI remains unused");
  assert.equal(scene.imageTransforms.length, 0, "the ordered image ABI remains unused");
  assert.equal("displayProgram" in scene, false, "direct compilation does not construct HEP data");
  assert.equal(baseline.legacyVector, undefined);

  const legacy = scene.legacyVector;
  assert.ok(legacy);
  assert.ok(legacy.sourceEvents instanceof Uint32Array);
  assert.ok(legacy.glyphRunMeta instanceof Uint32Array);
  assert.ok(legacy.glyphFillColors instanceof Float32Array);
  assert.ok(legacy.imageIndices instanceof Uint32Array);
  assert.ok(legacy.imageTransforms instanceof Float32Array);
  assert.ok(legacy.imageClipBounds instanceof Float32Array);
  assert.ok(legacy.imagePaintOrders instanceof Uint32Array);
  assert.ok(legacy.imageFlags instanceof Uint8Array);
  assert.deepEqual([...legacy.glyphRunMeta], [5, 2, 0]);
  assert.deepEqual(
    [...legacy.glyphFillColors],
    [Math.fround(0.2), Math.fround(0.4), Math.fround(0.6), 0.5]
  );
  assert.deepEqual([...legacy.imageIndices], [4]);
  assert.deepEqual([...legacy.imageTransforms], [2, 0, 0, 3, 5, 7]);
  assert.deepEqual([...legacy.imageClipBounds], [-1_000, -1_000, 1_000, 1_000]);
  assert.deepEqual([...legacy.imagePaintOrders], [0]);
  assert.deepEqual([...legacy.imageFlags], [0]);
  assert.deepEqual([...legacy.sourceEvents], [
    DENSE_PDF_LEGACY_VECTOR_EVENT_IMAGE, 0,
    DENSE_PDF_LEGACY_VECTOR_EVENT_ORDINARY_PAINT, 0,
    DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH, 0
  ]);

  const invisibleThenImage = await compile("BT (ocr) Tj ET /Im0 Do", {
    legacyVectorOutput: true,
    imageXObjects: new Map([["Im0", 9]]),
    textOperatorSink: textSink(3, 11, 1)
  });
  assert.deepEqual([...invisibleThenImage.legacyVector.glyphRunMeta], [11, 1, 3]);
  assert.deepEqual([...invisibleThenImage.legacyVector.imageIndices], [9]);
  assert.deepEqual([...invisibleThenImage.legacyVector.imagePaintOrders], [0]);
  assert.deepEqual([...invisibleThenImage.legacyVector.sourceEvents], [
    DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH, 0,
    DENSE_PDF_LEGACY_VECTOR_EVENT_IMAGE, 0
  ]);

  const selectivelyClippedText = await compile(
    "0 0 m 10 0 l 5 10 l h W n BT (label) Tj ET",
    {
      legacyVectorOutput: true,
      legacySelectiveTextClips: true,
      textOperatorSink: textSink(0, 0, 1)
    }
  );
  assert.deepEqual([...selectivelyClippedText.legacyVector.glyphRunMeta], [0, 1, 0]);
  assert.equal(selectivelyClippedText.legacyVector.glyphFillColors[3], 0,
    "selectively rasterized text remains indexed but is transparent in the legacy glyph layer");
  assert.equal(selectivelyClippedText.legacyVector.selectivePaintSourceSpans.length, 2);
  assert.deepEqual(
    [...selectivelyClippedText.legacyVector.selectivePaintOrdinalSpans],
    [0, 0],
    "a selectively captured operator retains its legacy raster ordering slot"
  );

  const visibleThenImage = await compile("BT (label) Tj ET /Im0 Do", {
    legacyVectorOutput: true,
    imageXObjects: new Map([["Im0", 10]]),
    textOperatorSink: textSink(0, 0, 1)
  });
  assert.deepEqual([...visibleThenImage.legacyVector.imagePaintOrders], [1]);
  assert.deepEqual(
    [...visibleThenImage.legacyVector.imageFlags],
    [DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_LATE_AFTER_TEXT]
  );
  assert.deepEqual([...visibleThenImage.legacyVector.sourceEvents], [
    DENSE_PDF_LEGACY_VECTOR_EVENT_ORDINARY_PAINT, 0,
    DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH, 0,
    DENSE_PDF_LEGACY_VECTOR_EVENT_IMAGE, 0
  ]);

  let orderedTextShow = 0;
  const formOrdering = await compile([
    "BT (ocr) Tj ET",
    "/Im0 Do",
    "/Hidden Do",
    "/Visible Do",
    "0 0 1 1 re f",
    "BT (visible) Tj ET"
  ].join("\n"), {
    legacyVectorOutput: true,
    imageXObjects: new Map([["Im0", 3]]),
    formXObjects: new Map([["Visible", 7], ["Hidden", 8]]),
    formOptionalContent: new Map([
      ["Visible", { optionalContentIndex: 4, defaultVisible: true }],
      ["Hidden", { optionalContentIndex: 5, defaultVisible: false }]
    ]),
    textOperatorSink: {
      applyOperator(operator) {
        if (operator !== "Tj") return undefined;
        const first = orderedTextShow++;
        return [{ first, count: 1, renderingMode: first === 0 ? 3 : 0 }];
      }
    }
  });
  assert.deepEqual(
    formOrdering.formPaints.map(({ definitionIndex }) => definitionIndex),
    [7],
    "a default-hidden Form does not create a paint occurrence"
  );
  assert.deepEqual([...formOrdering.legacyVector.formPaintOrders], [1]);
  assert.deepEqual([...formOrdering.legacyVector.sourceEvents], [
    DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH, 0,
    DENSE_PDF_LEGACY_VECTOR_EVENT_IMAGE, 0,
    DENSE_PDF_LEGACY_VECTOR_EVENT_FORM, 0,
    DENSE_PDF_LEGACY_VECTOR_EVENT_ORDINARY_PAINT, 0,
    DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH, 1
  ]);

  const formThenImage = await compile("/Fm0 Do /Im0 Do", {
    legacyVectorOutput: true,
    formXObjects: new Map([["Fm0", 6]]),
    imageXObjects: new Map([["Im0", 2]])
  });
  assert.deepEqual([...formThenImage.legacyVector.sourceEvents], [
    DENSE_PDF_LEGACY_VECTOR_EVENT_FORM, 0,
    DENSE_PDF_LEGACY_VECTOR_EVENT_IMAGE, 0
  ], "a Form event is not itself an ordinary-paint barrier");
  assert.deepEqual([...formThenImage.legacyVector.formPaintOrders], [0]);
  assert.deepEqual(
    [...formThenImage.legacyVector.imagePaintOrders],
    [1],
    "a Form and a following image must share one monotonically ordered raster timeline"
  );

  const clippedImage = await compile("0 0 10 10 re W n /Im0 Do", {
    legacyVectorOutput: true,
    imageXObjects: new Map([["Im0", 1]])
  });
  assert.deepEqual([...clippedImage.legacyVector.imageClipBounds], [0, 0, 10, 10]);
  assert.deepEqual([...clippedImage.legacyVector.imageFlags], [1]);
  await expectUnsupported(
    "0 0 m 10 0 l 5 10 l h W n /Im0 Do",
    "Do",
    {
      legacyVectorOutput: true,
      imageXObjects: new Map([["Im0", 1]])
    }
  );

  const rectangularClip = await compile(
    "0 0 10 10 re W n -5 -5 20 20 re f 1 1 m 9 9 l S",
    { legacyVectorOutput: true }
  );
  assert.equal(rectangularClip.fillPathCount, 1);
  assert.equal(rectangularClip.segmentCount, 1);
  await expectUnsupported(
    "0 0 m 10 0 l 5 10 l h W n 0 0 10 10 re f",
    "f",
    { legacyVectorOutput: true }
  );
  await expectUnsupported(
    "0 0 m 10 0 l 5 10 l h W n 1 1 m 9 9 l S",
    "S",
    { legacyVectorOutput: true }
  );

  const disjointPathThenImage = await compile("0 20 10 10 re f /Im0 Do", {
    legacyVectorOutput: true,
    imageXObjects: new Map([["Im0", 1]])
  });
  assert.deepEqual([...disjointPathThenImage.legacyVector.imageFlags], [
    DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_LATE_AFTER_PATH
  ], "a conservatively disjoint preceding path may remain above the image underlay");
  await expectUnsupported("0 0 10 10 re f /Im0 Do", "Do", {
    legacyVectorOutput: true,
    imageXObjects: new Map([["Im0", 1]])
  });
  const selectiveLateImage = await compile(
    "/Im0 Do 0 0 10 10 re f /Im1 Do",
    {
      legacyVectorOutput: true,
      legacySelectiveImageSpans: true,
      imageXObjects: new Map([["Im0", 0], ["Im1", 1]])
    }
  );
  assert.equal(selectiveLateImage.legacyVector.imageFlags[1],
    DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_LATE_AFTER_PATH |
    DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_SELECTIVE_PATH_SPAN);
  assert.deepEqual([...selectiveLateImage.legacyVector.imagePathSpanCheckpoints], [
    0, 0, 0, 0, 0, 0,
    0, 1, 0, 0, 1, 2
  ]);
  const densePathOnly = await compile(
    Array.from({ length: 1_000 }, (_, index) => `${index} 20 1 1 re f`).join("\n"),
    { legacyVectorOutput: true, legacySelectiveImageSpans: true }
  );
  assert.equal(densePathOnly.legacyVector.imagePathSpanCheckpoints.length, 0,
    "path-dense pages allocate no per-path selective-image tape");
  const selectiveDisconnectedFill = await compile(
    Array.from({ length: 100 }, (_, index) => `${index * 2} 0 m ${index * 2 + 1} 0 l ${index * 2 + 1} 1 l h`).join("\n") + "\nf",
    { legacyVectorOutput: true, legacySelectivePaths: true }
  );
  assert.equal(selectiveDisconnectedFill.fillPathCount, 0,
    "a selectively captured exact path is omitted from the packed legacy store");
  assert.equal(selectiveDisconnectedFill.legacyVector.selectivePaintSourceSpans.length, 2,
    "a selectively captured exact path retains one transient source identity");
  assert.deepEqual([...selectiveDisconnectedFill.legacyVector.selectivePaintOrdinalSpans], [0, 0]);
  const formBarrierSpan = await compile(
    "/Im0 Do 0 0 10 10 re f /Fm0 Do /Im1 Do",
    {
      legacyVectorOutput: true,
      legacyAllowCompositeForms: true,
      legacySelectiveImageSpans: true,
      imageXObjects: new Map([["Im0", 0], ["Im1", 1]]),
      formXObjects: new Map([["Fm0", 0]])
    }
  );
  assert.equal(formBarrierSpan.legacyVector.imagePathSourceSpans.length, 8,
    "the compiler defers Form-barrier safety to resource-aware flattening");
  await expectUnsupported(
    "0 0 m 10 0 l S 10 0 m 0 0 l S /Im0 Do",
    "Do",
    {
      legacyVectorOutput: true,
      imageXObjects: new Map([["Im0", 1]])
    }
  );
  await expectUnsupported("BT (stroke) Tj ET", "Tr", {
    legacyVectorOutput: true,
    textOperatorSink: textSink(1)
  });
  await expectUnsupported("/Multiply gs 0 0 10 10 re f", "f", {
    legacyVectorOutput: true,
    extGStates: [{ resourceName: "Multiply", blendMode: "Multiply" }]
  });
  const inertAlphaAsShape = await compile(
    "/Shape gs 0 0 10 10 re f 0 20 m 10 20 l S",
    {
      legacyVectorOutput: true,
      extGStates: [{
        resourceName: "Shape",
        strokeAlpha: 1,
        fillAlpha: 1,
        blendMode: "Normal",
        softMaskIndex: null,
        alphaIsShape: true
      }]
    }
  );
  assert.equal(inertAlphaAsShape.fillPathCount, 1);
  assert.equal(inertAlphaAsShape.segmentCount, 1);
  const ignoredStrokeAdjustment = await compile(
    "/Adjusted gs 0 0 m 10 0 l S",
    {
      legacyVectorOutput: true,
      extGStates: [{ resourceName: "Adjusted", strokeAdjustment: true }]
    }
  );
  assert.equal(ignoredStrokeAdjustment.segmentCount, 1);
  const clearedSoftMask = await compile(
    "/NoMask gs 0 0 10 10 re f",
    {
      legacyVectorOutput: true,
      extGStates: [{ resourceName: "NoMask", softMaskIndex: null }]
    }
  );
  assert.equal(clearedSoftMask.fillPathCount, 1);
  await expectUnsupported("/Shape gs 0 0 10 10 re f", "f", {
    legacyVectorOutput: true,
    extGStates: [{
      resourceName: "Shape",
      fillAlpha: 0.5,
      blendMode: "Normal",
      softMaskIndex: null,
      alphaIsShape: true
    }]
  });
  await expectUnsupported("/ShapeMask gs 0 0 10 10 re f", "f", {
    legacyVectorOutput: true,
    extGStates: [{
      resourceName: "ShapeMask",
      fillAlpha: 1,
      blendMode: "Normal",
      softMaskIndex: 0,
      alphaIsShape: true
    }]
  });
  await expectUnsupported("/Half gs /Im0 Do", "Do", {
    legacyVectorOutput: true,
    imageXObjects: new Map([["Im0", 1]]),
    extGStates: [{ resourceName: "Half", fillAlpha: 0.5 }]
  });
  await expectUnsupported("/Multiply gs /Fm0 Do", "Do", {
    legacyVectorOutput: true,
    formXObjects: new Map([["Fm0", 0]]),
    extGStates: [{ resourceName: "Multiply", blendMode: "Multiply" }]
  });
  const deferredCompositeForm = await compile("/Multiply gs /Fm0 Do", {
    legacyVectorOutput: true,
    legacyAllowCompositeForms: true,
    formXObjects: new Map([["Fm0", 0]]),
    extGStates: [{ resourceName: "Multiply", blendMode: "Multiply" }]
  });
  assert.deepEqual([...deferredCompositeForm.legacyVector.sourceEvents], [
    DENSE_PDF_LEGACY_VECTOR_EVENT_FORM, 0
  ], "the selective-composite bridge retains the exact root Form event");
  await expectUnsupported("0 0 10 10 re f /Fm0 Do /Im0 Do", "Do", {
    legacyVectorOutput: true,
    formXObjects: new Map([["Fm0", 0]]),
    imageXObjects: new Map([["Im0", 1]])
  });
  await assert.rejects(
    compile("", { legacyVectorOutput: true, preservePaintOrder: true }),
    TypeError
  );
}

async function testPathsTransformsAndCurves() {
  const content = [
    "0 0 m 10 0 l S",
    "20 20 10 5 re S",
    "0 0 m 5 10 10 10 15 0 c S",
    "0 0 m 5 10 15 0 v S",
    "0 0 m 5 10 15 0 y S"
  ].join("\n");
  const scene = await compile(content, {
    enableSegmentMerge: false,
    enableInvisibleCull: false
  });
  assert.equal(scene.operatorCount, 14);
  assert.equal(scene.pathCount, 5);
  assert.ok(scene.sourceSegmentCount >= 8);
  assert.ok(scene.segmentCount >= 8);

  const transformed = await compile(
    "q 2 0 0 3 5 7 cm 2 w 0 0 m 10 0 l S Q\n",
    { enableInvisibleCull: false }
  );
  assert.deepEqual([...transformed.endpoints], [5, 7, 25, 7]);
  assert.deepEqual([...transformed.primitiveMeta.slice(0, 3)], [25, 7, 0]);
  assert.equal(transformed.styles[0], 2.5);
  assert.equal(transformed.maxHalfWidth, 2.5);
  assert.equal(transformed.operatorCount, 7);

  await expectUnsupported("0 0 m q 1 0 0 1 1 1 cm Q 1 1 l S", "q");
  await expectUnsupported("0 0 m 1 0 0 1 1 1 cm 1 1 l S", "cm");

  // The compact builder keeps the pre-close shorthand-control current point
  // after h in its normalized path representation.
  const shorthand = await compile(
    "0 0 m 10 0 l h 10 10 20 20 v S",
    { enableSegmentMerge: false, enableInvisibleCull: false }
  );
  const explicit = await compile(
    "0 0 m 10 0 l h 10 0 10 10 20 20 c S",
    { enableSegmentMerge: false, enableInvisibleCull: false }
  );
  assertSceneGeometryEqual(shorthand, explicit);

  const nonUniform = await compile("2 w 0 0 m 10 0 l S", {
    pageMatrix: [1.25, 0.75, -0.5, 3, 0, 0],
    enableInvisibleCull: false
  });
  const scale = (Math.hypot(1.25, 0.75) + Math.hypot(-0.5, 3)) * 0.5;
  assert.equal(nonUniform.maxHalfWidth, scale);
  assert.equal(nonUniform.styles[0], Math.fround(scale));

  const zeroButt = await compile("0 0 m 0 0 l S", {
    enableInvisibleCull: false
  });
  assert.equal(zeroButt.pathCount, 1);
  assert.equal(zeroButt.sourceSegmentCount, 0);
  assert.equal(zeroButt.mergedSegmentCount, 0);
  const zeroRound = await compile("1 J 0 0 m 0 0 l S", {
    enableInvisibleCull: false
  });
  assert.equal(zeroRound.sourceSegmentCount, 1);
  assert.equal(zeroRound.segmentCount, 1);
}

async function testClippingAndDashes() {
  const postClipPath = await compile(
    "0 0 m 100 0 l W 100 100 l 0 100 l h n -10 50 m 110 50 l S"
  );
  assert.equal(postClipPath.segmentCount, 1);
  assert.deepEqual([...postClipPath.primitiveBounds], [0, 0, 100, 100]);
  assert.ok((Math.trunc(postClipPath.primitiveMeta[3] / 2 + 1e-6) & 4) !== 0);

  const clippedHairline = await compile(
    "0 0 100 100 re W n 0 w -10 50 m 110 50 l S"
  );
  assert.equal(clippedHairline.segmentCount, 1);
  assert.deepEqual([...clippedHairline.endpoints], [-10, 50, 110, 50]);
  assert.deepEqual(
    [...clippedHairline.primitiveBounds],
    [0, 0, 100, 100],
    "hairlines retain the full effective clip instead of a zero-height paint intersection"
  );
  assert.equal(Math.trunc(clippedHairline.primitiveMeta[3] / 2 + 1e-6) & 5, 5);

  const widthOnlyIntersection = await compile(
    "0 0 100 100 re W n 4 w -10 -1 m 110 -1 l S"
  );
  assert.equal(
    widthOnlyIntersection.segmentCount,
    1,
    "a centerline outside the clip remains visible when its stroke width intersects it"
  );
  assert.deepEqual([...widthOnlyIntersection.primitiveBounds], [0, 0, 100, 100]);

  const evenOddRectangle = await compile("0 0 100 100 re W* n");
  assert.equal(evenOddRectangle.operatorCount, 3);

  // Generic HEPR reduces nonzero clips to their transformed AABB, including
  // curved/non-rectangular paths. It does the same for even-odd paths unless
  // every subpath is a rectangle and one rectangle creates an exclusion mask.
  await compile("0 0 m 10 20 20 -10 30 10 c 0 30 l h W n");
  const irregularEvenOdd = await compile(
    "0 0 m 100 0 l 75 100 l 0 50 l h W* n -10 50 m 110 50 l S"
  );
  assert.equal(irregularEvenOdd.segmentCount, 1);
  assert.deepEqual([...irregularEvenOdd.primitiveBounds], [0, 0, 100, 100]);

  const multiIrregularEvenOdd = await compile(
    "0 0 m 40 0 l 20 40 l h 60 60 m 100 60 l 80 100 l h W* n " +
    "-10 50 m 110 50 l S"
  );
  assert.equal(multiIrregularEvenOdd.segmentCount, 1);
  assert.deepEqual([...multiIrregularEvenOdd.primitiveBounds], [0, 0, 100, 100]);

  const rectangleHole = await compile(
    "0 0 100 100 re 25 25 50 50 re W* n -10 -10 120 120 re f"
  );
  assert.equal(rectangleHole.fillPathCount, 1);
  assert.equal(rectangleHole.fillSegmentCount, 8);
  assert.deepEqual([...rectangleHole.fillPathMetaA], [0, 8, 0, 0]);
  assert.deepEqual([...rectangleHole.fillPathMetaB.slice(0, 2)], [100, 100]);
  assert.equal(rectangleHole.fillPathMetaC[0], 1);

  // The generic extractor applies its compact rectangle mask only when the
  // consumer is itself an enclosing rectangle. Strokes and irregular fills
  // intentionally retain its established AABB-only behavior.
  const maskedStroke = await compile(
    "0 0 100 100 re 25 25 50 50 re W* n -10 50 m 110 50 l S"
  );
  assert.equal(maskedStroke.segmentCount, 1);
  assert.deepEqual([...maskedStroke.primitiveBounds], [0, 0, 100, 100]);

  const disjointClippedDuplicates = await compile(
    "q 0 0 4 10 re W n -1 5 m 11 5 l S Q " +
    "q 6 0 4 10 re W n -1 5 m 11 5 l S Q"
  );
  assert.equal(disjointClippedDuplicates.segmentCount, 2);
  assert.deepEqual(
    [...disjointClippedDuplicates.primitiveBounds],
    [0, 0, 4, 10, 6, 0, 10, 10]
  );
  assert.equal(disjointClippedDuplicates.discardedDuplicateCount, 0);
  assert.equal(disjointClippedDuplicates.discardedContainedCount, 0);

  const maskedTriangle = await compile(
    "0 0 100 100 re 25 25 50 50 re W* n 0 0 m 100 0 l 50 100 l h f"
  );
  assert.equal(maskedTriangle.fillPathCount, 1);
  assert.equal(maskedTriangle.fillSegmentCount, 3);
  assert.equal(maskedTriangle.fillPathMetaC[0], 0);

  const restoredMask = await compile(
    "q 0 0 100 100 re 25 25 50 50 re W* n -10 -10 120 120 re f Q " +
    "-10 -10 120 120 re f"
  );
  assert.equal(restoredMask.fillPathCount, 2);
  assert.equal(restoredMask.fillSegmentCount, 12);

  const dashed = await compile("[2 1] 0 d 0 0 m 10 0 l S", {
    enableSegmentMerge: false,
    enableInvisibleCull: false
  });
  assert.equal(dashed.sourceSegmentCount, 4);
  assert.equal(dashed.segmentCount, 4);
  assert.deepEqual(
    [...dashed.endpoints].filter((_, index) => index % 4 < 2),
    [0, 0, 3, 0, 6, 0, 9, 0]
  );

  const dotted = await compile("1 J [0 2] 0 d 0 0 m 10 0 l S", {
    enableSegmentMerge: false,
    enableInvisibleCull: false
  });
  assert.equal(dotted.sourceSegmentCount, 6,
    "zero-length painted dashes remain visible under round caps");
  assert.equal(dotted.segmentCount, 6);
  assert.deepEqual(
    Array.from({ length: dotted.segmentCount }, (_, index) =>
      dotted.endpoints[index * 4]
    ),
    [0, 2, 4, 6, 8, 10],
    "a dotted stroke emits every source-ordered round-cap point, including path endpoints"
  );
  assert.ok(Array.from({ length: dotted.segmentCount }, (_, index) => {
    const offset = index * 4;
    return dotted.endpoints[offset] === dotted.primitiveMeta[offset] &&
      dotted.endpoints[offset + 1] === dotted.primitiveMeta[offset + 1];
  }).every(Boolean));

  const tinyDash = await compile("[0.0000000005 0.0000000005] 0 d 0 0 m 10 0 l S", {
    pageMatrix: [10, 0, 0, 10, 0, 0],
    enableSegmentMerge: false,
    enableInvisibleCull: false
  });
  assert.equal(tinyDash.sourceSegmentCount, 1);
  assert.equal(tinyDash.segmentCount, 1);
}

async function testDeviceColorsAndMetadataCounts() {
  const shorthand = await compile("0.1 0.2 0.3 RG 0 0 m 10 0 l S", {
    enableInvisibleCull: false
  });
  const explicit = await compile("/DeviceRGB CS 0.1 0.2 0.3 SC 0 0 m 10 0 l S", {
    enableInvisibleCull: false
  });
  const explicitN = await compile("/RGB CS 0.1 0.2 0.3 SCN 0 0 m 10 0 l S", {
    enableInvisibleCull: false
  });
  assert.deepEqual([...explicit.styles], [...shorthand.styles]);
  assert.deepEqual([...explicitN.styles], [...shorthand.styles]);
  assert.equal(shorthand.operatorCount, 4);
  assert.equal(explicit.operatorCount, 5);
  assert.equal(explicitN.operatorCount, 5);
  assert.equal((await compile("/DeviceRGB CS")).operatorCount, 1);

  await compile("/DeviceGray CS 0.5 SC 0 0 m 1 0 l S");
  await compile("/DeviceCMYK CS 0.1 0.2 0.3 0.4 SC 0 0 m 1 0 l S");
  await compile("0.5 G 0 0 m 1 0 l S 0.1 0.2 0.3 rg 0 0 1 1 re f");
  await compile("0.1 0.2 0.3 0.4 K 0 0 m 1 0 l S");
}

async function testTextAndMarkedContentSemantics() {
  const tiny = "0.00000012345678901234567";
  const content = [
    "q 2 w 1 J 2 j 9 M [3 1] 0 d 0.25 G 0.1 0.2 0.3 rg",
    `BT ${tiny} 0 0 ${tiny} 1 2 Tm /F1 12 Tf 1 Tc 2 Tw 90 Tz 14 TL 0 Tr 3 Ts`,
    "10 20 Td 1 2 TD T* (hello) Tj [(a) -10 <62>] TJ (c) ' 1 2 (d) \" ET",
    "/Span BMC EMC /Span << /MCID 1 >> BDC EMC",
    "/Point MP /Point << /MCID 2 >> DP Q"
  ].join("\n");
  const scene = await compile(content, { textOperatorSink: NOOP_TEXT_SINK });
  assert.deepEqual(scene.referencedFonts, ["F1"]);
  assert.deepEqual(scene.referencedProperties, []);
  assert.equal(scene.textShowOpCount, 4);
  for (const removedField of [
    "retainedTextContent",
    "dependencyOpCount",
    "dependencyKeys",
    "operatorCountTrace"
  ]) {
    assert.equal(removedField in scene, false, removedField);
  }

  const nextLineShow = await compile("(a) '", { textOperatorSink: NOOP_TEXT_SINK });
  assert.equal(nextLineShow.operatorCount, 1);
  assert.equal(nextLineShow.textShowOpCount, 1);
  const spacingNextLineShow = await compile('1 2 (a) "', { textOperatorSink: NOOP_TEXT_SINK });
  assert.equal(spacingNextLineShow.operatorCount, 1);
  assert.equal(spacingNextLineShow.textShowOpCount, 1);

  const namedProperties = await compile("/Span /MC0 BDC EMC /Point /MC1 DP");
  assert.deepEqual(namedProperties.referencedProperties, ["MC0", "MC1"]);
  assert.equal((await compile("/Point MP /Point << /MCID 1 >> DP")).operatorCount, 2);

  for (const [text, operator] of [
    ["(a) Tj", "Tj"],
    ["[(a)] TJ", "TJ"],
    ["(a) '", "'"],
    ['1 2 (a) "', '"']
  ]) {
    await expectUnsupported(text, operator);
  }
  const hiddenText = await compile(
    "/OC /Hidden BDC BT 4 Tr /F1 10 Tf (hidden) Tj ET EMC",
    {
      markedContentProperties: new Map([["Hidden", {
        resourceName: "Hidden",
        optionalContentIndex: 2,
        defaultVisible: false,
        mcid: -1
      }]])
    }
  );
  assert.equal(hiddenText.operatorCount, 7);
  assert.equal(hiddenText.textShowOpCount, 1);
}

async function testExtGStateOpacityAndOptionalContent() {
  const extGStates = [
    {
      resourceName: "Alpha",
      strokeAlpha: 0.4,
      fillAlpha: 0.2,
      blendMode: "Multiply",
      softMaskIndex: 4,
      strokeOverprint: true,
      fillOverprint: true,
      overprintMode: 1
    },
    {
      resourceName: "Opaque",
      strokeAlpha: 1,
      fillAlpha: 1,
      blendMode: "Normal",
      softMaskIndex: null,
      strokeOverprint: false,
      fillOverprint: false,
      overprintMode: 0
    }
  ];
  const scene = await compile([
    "/Alpha gs",
    "0 0 m 10 0 l S",
    "0 0 2 2 re f",
    "q /Opaque gs 0 1 m 10 1 l S Q",
    "0 2 m 10 2 l S"
  ].join("\n"), {
    extGStates,
    enableInvisibleCull: false
  });
  assert.equal(scene.operatorCount, 15);
  assert.deepEqual(scene.referencedExtGStates, ["Alpha", "Opaque"]);
  assert.ok(Math.abs(scene.primitiveMeta[3] - 0.4) < 1e-6);
  assert.ok(Math.abs(scene.primitiveMeta[7] - 1) < 1e-6);
  assert.ok(Math.abs(scene.primitiveMeta[11] - 0.4) < 1e-6);
  assert.ok(Math.abs(scene.fillPathMetaC[3] - 0.2) < 1e-6);

  const ordered = await compile([
    "/Alpha gs 0 0 2 2 re f",
    "q /Opaque gs 3 0 2 2 re f Q",
    "6 0 2 2 re f"
  ].join("\n"), {
    extGStates,
    preservePaintOrder: true,
    enableInvisibleCull: false
  });
  assert.deepEqual(ordered.paintRunCompositeStates, [
    { alpha: 0.2, alphaIsShape: false, blendMode: "Multiply", softMaskIndex: 4, overprint: true, overprintMode: 1 },
    { alpha: 1, alphaIsShape: false, blendMode: "Normal", softMaskIndex: -1, overprint: false, overprintMode: 0 },
    { alpha: 0.2, alphaIsShape: false, blendMode: "Multiply", softMaskIndex: 4, overprint: true, overprintMode: 1 }
  ], "q/Q snapshots and restores every native compositing parameter");

  const shapeAlpha = await compile([
    "/Shape gs 0 0 2 2 re f",
    "q /Opacity gs 3 0 2 2 re f Q",
    "6 0 2 2 re f"
  ].join("\n"), {
    extGStates: [
      { resourceName: "Shape", fillAlpha: 0.5, alphaIsShape: true },
      { resourceName: "Opacity", alphaIsShape: false }
    ],
    preservePaintOrder: true,
    enableInvisibleCull: false
  });
  assert.deepEqual(
    shapeAlpha.paintRunCompositeStates.map((state) => state.alphaIsShape),
    [true, false, true],
    "/AIS participates in q/Q graphics-state inheritance without changing source order"
  );

  const translucentDuplicates = await compile(
    "/Alpha gs 0 0 m 10 0 l S 10 0 m 0 0 l S",
    { extGStates }
  );
  assert.equal(translucentDuplicates.segmentCount, 2);
  assert.equal(translucentDuplicates.discardedDuplicateCount, 0);

  const transparent = await compile(
    "/Invisible gs 0 0 m 10 0 l S 0 0 2 2 re f",
    {
      extGStates: [{
        resourceName: "Invisible",
        strokeAlpha: 0,
        fillAlpha: 0
      }]
    }
  );
  assert.equal(transparent.segmentCount, 0);
  assert.equal(transparent.fillPathCount, 0);
  assert.equal(transparent.discardedTransparentCount, 1);

  const flattenedLayer = await compile(
    "/OC /VisibleLayer BDC 0 0 m 10 0 l S EMC",
    { alwaysVisibleOptionalContentProperties: ["VisibleLayer"] }
  );
  assert.equal(flattenedLayer.operatorCount, 5);
  assert.deepEqual(flattenedLayer.referencedProperties, []);
  await expectUnsupported("/OC /HiddenLayer BDC EMC", "BDC", {
    alwaysVisibleOptionalContentProperties: ["VisibleLayer"]
  });
}

async function testNativeFormXObjects() {
  const scene = await compile("/Footer Do /Footer Do", {
    preservePaintOrder: true,
    formXObjects: new Map([["Footer", 7]])
  });
  assert.equal(scene.operatorCount, 2);
  assert.equal(scene.textShowOpCount, 0);
  assert.deepEqual(scene.referencedXObjects, ["Footer"]);
  assert.deepEqual(scene.formPaints.map(({ definitionIndex }) => definitionIndex), [7, 7]);
  await expectUnsupported("/Missing Do", "Do");
}

async function testUnsupportedAndMalformedContent() {
  const inertGraphicsState = await compile("/R10 gs 0 0 m 10 0 l S", {
    availableExtGStates: ["R10"]
  });
  assert.equal(inertGraphicsState.operatorCount, 4);
  assert.equal(inertGraphicsState.segmentCount, 1);

  for (const [content, operator] of [
    ["BI /W 1 /H 1 ID x EI", "BI"],
    ["/Im0 Do", "Do"],
    ["/GS0 gs", "gs"],
    ["/Pattern CS", "CS"],
    ["/CalRGB cs", "cs"],
    ["/Pattern cs /P scn", "cs"]
  ]) {
    await expectUnsupported(content, operator);
  }
  for (const mode of [4, 5, 6, 7]) {
    await expectUnsupported(`${mode} Tr`, "Tr");
  }
  for (const content of [
    "/OC BMC",
    "/Span << /OC /Layer >> BDC",
    "/Span << /Nested << /OCGs [] >> >> BDC",
    "/Span << /Nested << /Type /OCG >> >> BDC",
    "/Span << /Nested << /Type /OCMD >> >> BDC",
    "/Point << /OCProperties <<>> >> DP"
  ]) {
    await expectUnsupported(content);
  }

  for (const content of [
    "Q",
    "0 m",
    "0 0 m",
    "[1 2 d",
    "<< /MCID >> /Span BDC",
    "(unterminated",
    "1 2",
    "0 0 m W W n",
    "/DeviceRGB CS /P SCN",
    "8 Tr"
  ]) {
    await assert.rejects(
      compile(content),
      (error) => error instanceof DensePdfSyntaxError
    );
  }
}

async function testCancellationAndProgress() {
  const preAborted = new AbortController();
  preAborted.abort();
  await assert.rejects(compile("0 0 m 1 1 l S", { signal: preAborted.signal }), {
    name: "AbortError"
  });

  const lines = [];
  for (let index = 0; index < 24_000; index += 1) {
    lines.push(`0 ${index} m 1 ${index} l S\n`);
  }
  const bytes = encoder.encode(lines.join(""));
  const progress = [];
  const source = delayedChunks(bytes, 4_096);
  const scene = await compile(source, {
    pageBounds: { minX: -1, minY: -1, maxX: 2, maxY: 25_000 },
    enableSegmentMerge: false,
    enableInvisibleCull: false,
    totalBytes: bytes.length,
    onProgress(event) {
      progress.push({ ...event, at: performance.now() });
    }
  });
  assert.equal(scene.segmentCount, 24_000);
  assert.ok(progress.filter(({ phase }) => phase === "scanning").length >= 3);
  assert.ok(progress.filter(({ phase }) => phase === "finalizing").length >= 2);
  for (let index = 1; index < progress.length; index += 1) {
    assert.ok(progress[index].processedBytes >= progress[index - 1].processedBytes);
    assert.ok(progress[index].operatorCount >= progress[index - 1].operatorCount);
    assert.ok(progress[index].at - progress[index - 1].at < 200);
  }

  const midAbort = new AbortController();
  await assert.rejects(
    compile(delayedChunks(bytes, 4_096), {
      pageBounds: { minX: -1, minY: -1, maxX: 2, maxY: 25_000 },
      enableInvisibleCull: false,
      signal: midAbort.signal,
      onProgress(event) {
        if (event.phase === "scanning") midAbort.abort();
      }
    }),
    { name: "AbortError" }
  );
}

async function testMergeCullAndFillBoundaries() {
  const merged = await compile("0 0 m 5 0 l 10 0 l S", {
    enableInvisibleCull: false
  });
  assert.equal(merged.sourceSegmentCount, 2);
  assert.equal(merged.mergedSegmentCount, 1);
  assert.equal(merged.segmentCount, 1);

  const duplicate = await compile("0 0 m 10 0 l S 10 0 m 0 0 l S");
  assert.equal(duplicate.sourceSegmentCount, 2);
  assert.equal(duplicate.mergedSegmentCount, 2);
  assert.equal(duplicate.discardedDuplicateCount, 1);
  assert.equal(duplicate.segmentCount, 1);

  const contained = await compile("2 w 0 0 m 20 0 l S 1 w 5 0 m 15 0 l S");
  assert.equal(contained.discardedContainedCount, 1);
  assert.equal(contained.segmentCount, 1);

  const fills = await compile(
    "0 0 10 10 re 20 20 5 5 re f 40 40 10 10 re 42 42 2 2 re f*"
  );
  assert.equal(fills.fillPathCount, 2);
  assert.equal(fills.fillSegmentCount, 16);
}

async function testLosslessExtremeCoordinateKeys() {
  // These two y coordinates produced the same wrapped Int32 tuple at both the
  // duplicate (x1000) and coverage-offset (x200) scales. Float64 key storage
  // must keep the physically distant lines distinct.
  const scene = await compile(
    "0 -0.48 m 10 -0.48 l S 0 21474836 m 10 21474836 l S",
    {
      pageBounds: {
        minX: -1,
        minY: -1,
        maxX: 11,
        maxY: 21_474_840
      }
    }
  );
  assert.equal(scene.discardedDuplicateCount, 0);
  assert.equal(scene.discardedContainedCount, 0);
  assert.equal(scene.segmentCount, 2);
}

async function testCooperativeEligibilityLimits() {
  const commands = ["0 0 m"];
  for (let index = 1; index <= 22_000; index += 1) {
    commands.push(`${index} ${index % 2} l`);
  }
  commands.push("S");
  await expectUnsupported(commands.join("\n"), "S");
}

async function* delayedChunks(bytes, chunkSize) {
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    yield bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
  }
}

async function expectUnsupported(content, operator, options = {}) {
  await assert.rejects(
    compile(content, options),
    (error) => {
      assert.ok(
        error instanceof DensePdfUnsupportedError,
        `${content}: expected DensePdfUnsupportedError, received ${error}`
      );
      if (operator !== undefined) assert.equal(error.operator, operator);
      return true;
    }
  );
}

function assertSceneGeometryEqual(actual, expected) {
  for (const key of [
    "endpoints",
    "primitiveMeta",
    "primitiveBounds",
    "styles",
    "fillPathMetaA",
    "fillPathMetaB",
    "fillPathMetaC",
    "fillSegmentsA",
    "fillSegmentsB"
  ]) {
    assert.deepEqual([...actual[key]], [...expected[key]], key);
  }
  for (const key of [
    "operatorCount",
    "pathCount",
    "sourceSegmentCount",
    "mergedSegmentCount",
    "segmentCount",
    "fillPathCount",
    "fillSegmentCount"
  ]) {
    assert.equal(actual[key], expected[key], key);
  }
}
