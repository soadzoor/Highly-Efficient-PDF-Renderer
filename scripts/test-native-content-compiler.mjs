import assert from "node:assert/strict";

import {
  DENSE_PDF_VECTOR_SCENE_EVENT_FILL,
  DENSE_PDF_VECTOR_SCENE_EVENT_COMPOSITE,
  DENSE_PDF_VECTOR_SCENE_EVENT_FORM,
  DENSE_PDF_VECTOR_SCENE_EVENT_GLYPH,
  DENSE_PDF_VECTOR_SCENE_EVENT_GRADIENT,
  DENSE_PDF_VECTOR_SCENE_EVENT_IMAGE,
  DENSE_PDF_VECTOR_SCENE_EVENT_ORDINARY_PAINT,
  DENSE_PDF_VECTOR_SCENE_IMAGE_FLAG_LATE_AFTER_TEXT,
  DENSE_PDF_VECTOR_SCENE_IMAGE_FLAG_LATE_AFTER_PATH,
  DENSE_PDF_VECTOR_SCENE_IMAGE_FLAG_SELECTIVE_PATH_SPAN,
  DENSE_PDF_PAINT_RUN_IMAGE,
  compileDensePdfContent,
  compileGroupedVectorPageContent,
  compileVectorFormContent,
  compileRetainedTextContent,
  DensePdfSyntaxError,
  DensePdfUnsupportedError,
  DensePdfResourceLimitError,
  getDensePdfPaintSourceIdentity,
  scanDensePdfPreparedResourceReferences
} from "../src/pdf/nativeContentCompiler.ts";

const encoder = new TextEncoder();
const NOOP_TEXT_SINK = Object.freeze({ applyOperator() {} });
const DEFAULT_OPTIONS = Object.freeze({
  output: "geometry",
  pageMatrix: [1, 0, 0, 1, 0, 0],
  pageBounds: { minX: -1_000, minY: -1_000, maxX: 1_000, maxY: 1_000 },
  enableSegmentMerge: true,
  enableInvisibleCull: true,
  yieldIntervalMs: 4
});

await testChunkBoundaryLexer();
await testPreparedInlineImageSegments();
await testLongDecimalOperands();
await testPrivatePaintSourceIdentityRange();
await testCompilationContexts();
await testVectorSceneOutput();
await testPathsTransformsAndCurves();
await testPathsAcrossGraphicsStatesAndEof();
await testClippingAndDashes();
await testDeviceColorsAndMetadataCounts();
await testTextAndMarkedContentSemantics();
await testExtGStateOpacityAndOptionalContent();
await testNativeFormXObjects();
await testUnsupportedAndMalformedContent();
await testCancellationAndProgress();
await testMergeCullAndFillBoundaries();
await testLosslessExtremeCoordinateKeys();
await testLargeVectorPaths();
await testDeepMarkedContent();
await testGroupedSelectiveImageCheckpoints();

console.log("Dense PDF content compiler tests passed.");

async function compile(content, options = {}, compiler = compileDensePdfContent) {
  const source = typeof content === "string" ? encoder.encode(content) : content;
  return compiler(source, {
    ...DEFAULT_OPTIONS,
    ...options,
    pageMatrix: options.pageMatrix ?? [...DEFAULT_OPTIONS.pageMatrix],
    pageBounds: options.pageBounds ?? { ...DEFAULT_OPTIONS.pageBounds }
  });
}

function groupedFormCompiler(source, options) {
  return compileVectorFormContent(source, options, "grouped");
}

function compileGroupedForm(content, options = {}) {
  return compile(content, options, groupedFormCompiler);
}

function compileGroupedPage(content, options = {}) {
  return compile(content, options, compileGroupedVectorPageContent);
}

function expectUnsupportedGroupedForm(content, operator, options = {}) {
  return expectUnsupported(content, operator, options, groupedFormCompiler);
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

async function testLongDecimalOperands() {
  for (const token of ["9007199254740993", "12345678901234567890.123456789", "-0", "+.5", "2.",
    "0." + "0".repeat(320) + "1", "1." + "0".repeat(350)]) {
    const values = [];
    const bytes = encoder.encode(`${token} Tc`);
    await compile({ async *[Symbol.asyncIterator]() {
      for (const byte of bytes) yield Uint8Array.of(byte);
    } }, { textOperatorSink: { applyOperator(operator, operands) {
      if (operator === "Tc") values.push(operands[0]);
    } } });
    assert.equal(values[0], Number(token), `numeric operand ${token.slice(0, 32)} must round correctly`);
  }
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
    output: "display-program",
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
    output: "display-program",
    capturePaintSourceIdentities: true
  });
  assert.deepEqual(
    getDensePdfPaintSourceIdentity(compiled, 0),
    [sourceOffset + bytes.lastIndexOf(0x66), 1],
    "private source identities retain offsets above the signed 32-bit range"
  );
  const ordinary = await compile("0 0 1 1 re f", { output: "display-program" });
  assert.equal(getDensePdfPaintSourceIdentity(ordinary, 0), null,
    "ordinary dense compilation does not allocate a paint-identity trace");
}

async function testCompilationContexts() {
  const textOperatorSink = {
    applyOperator(operator) {
      return operator === "Tj" ? [{ first: 0, count: 1, renderingMode: 0 }] : undefined;
    }
  };
  const content = "BT (covered) Tj ET 0 0 10 10 re f /Im0 Do";
  const options = { textOperatorSink, imageXObjects: new Map([["Im0", 0]]) };
  const geometry = await compile(content, options);
  assert.equal(geometry.vectorSceneData, undefined);
  assert.equal(geometry.paintRuns.length, 0);

  const display = await compile(content, { ...options, output: "display-program" });
  assert.equal(display.vectorSceneData, undefined);
  assert.equal(display.paintRuns.length, 9, "all three paints have display commands");

  const page = await compile(content, { ...options, output: "vector-scene" });
  const form = await compile(content, options, compileVectorFormContent);
  for (const compiled of [page, form]) {
    assert.equal(compiled.paintRuns.length, 0);
    assert.deepEqual([...compiled.vectorSceneData.pathPaintRanges], [0, 1]);
    const kinds = [...compiled.vectorSceneData.sourceEvents].filter((_, i) => i % 2 === 0);
    assert.deepEqual(kinds.filter(kind => kind !== DENSE_PDF_VECTOR_SCENE_EVENT_ORDINARY_PAINT), [
      DENSE_PDF_VECTOR_SCENE_EVENT_GLYPH,
      DENSE_PDF_VECTOR_SCENE_EVENT_FILL,
      DENSE_PDF_VECTOR_SCENE_EVENT_IMAGE
    ], "normal page and Form output preserve text/fill/image overlap order");
  }

  // An image under an empty clip intersection paints nothing; it must not
  // reach the image sidecar with an inverted clip rectangle.
  for (const compiler of [compileDensePdfContent, compileVectorFormContent]) {
    const emptyClip = await compile(
      "q 0 0 10 10 re W n 50 50 10 10 re W n 2 0 0 2 0 0 cm /Im0 Do Q /Im0 Do",
      { ...options, output: "vector-scene" },
      compiler
    );
    assert.deepEqual([...emptyClip.vectorSceneData.imageIndices], [0]);
    assert.deepEqual([...emptyClip.vectorSceneData.imageTransforms], [1, 0, 0, 1, 0, 0]);
    assert.deepEqual([...emptyClip.vectorSceneData.imageClipBounds], [-1_000, -1_000, 1_000, 1_000]);
  }

  const clip = "0 0 m 10 0 l 5 10 l h W n 0 0 10 10 re f";
  for (const compiler of [compileDensePdfContent, compileVectorFormContent]) {
    const clipped = await compile(clip, { output: "vector-scene" }, compiler);
    assert.ok(clipped.vectorSceneData.sourceClips.some(Boolean), "ordered output keeps exact clips");
    assert.equal(clipped.vectorSceneData.selectivePaintSourceSpans.length, 0);
  }
  const groupedClip = await compileGroupedPage(clip);
  assert.equal(groupedClip.fillPathCount, 0);
  assert.equal(groupedClip.vectorSceneData.pathPaintRanges, undefined);
  assert.equal(groupedClip.vectorSceneData.selectivePaintSourceSpans.length, 2,
    "the grouped page retry captures clipped paint automatically");
  await expectUnsupportedGroupedForm(clip, "f");

  const shadingOptions = { output: "vector-scene", shadings: new Map([["Sh0", 0]]) };
  const shading = await compile("/Sh0 sh", shadingOptions);
  assert.deepEqual([...shading.vectorSceneData.sourceEvents], [DENSE_PDF_VECTOR_SCENE_EVENT_COMPOSITE, 0]);
  assert.equal(shading.vectorSceneData.selectivePaintSourceSpans.length, 2);
  await expectUnsupported("/Sh0 sh", "sh", shadingOptions, compileVectorFormContent);
  const vectorShading = await compile("/Sh0 sh", { ...shadingOptions, vectorShadings: new Set([0]) },
    compileVectorFormContent);
  assert.deepEqual([...vectorShading.vectorSceneData.sourceEvents], [DENSE_PDF_VECTOR_SCENE_EVENT_GRADIENT, 0]);
  assert.equal(vectorShading.vectorSceneData.selectivePaintSourceSpans.length, 0,
    "supported Form shading retains its analytic gradient paint");

  const compositeOptions = {
    output: "vector-scene",
    formXObjects: new Map([["Fm0", 0]]),
    extGStates: [{ resourceName: "Multiply", blendMode: "Multiply" }]
  };
  const composite = await compile("/Multiply gs /Fm0 Do", compositeOptions);
  assert.equal(composite.formPaints.length, 1, "the page delegates composite Forms to its adapter");
  const multiplyForm = await compile("/Multiply gs /Fm0 Do", compositeOptions, compileVectorFormContent);
  assert.equal(multiplyForm.formPaints[0].initialGraphicsState.blendMode, "Multiply",
    "ordered Forms preserve Multiply for their nested paint");

  const textOptions = { textOperatorSink, extGStates: [{ resourceName: "OP", fillOverprint: true }] };
  const retained = await compile("BT (label) Tj ET", textOptions, compileRetainedTextContent);
  assert.deepEqual([...retained.vectorSceneData.glyphRunMeta], [0, 1, 0]);
  assert.equal(retained.vectorSceneData.pathPaintRanges, undefined);
  await expectUnsupported("/OP gs BT (label) Tj ET", "Tj", textOptions, compileRetainedTextContent);
  for (const compiler of [compileDensePdfContent, compileVectorFormContent]) {
    const staticText = await compile("/OP gs BT (label) Tj ET", { ...textOptions, output: "vector-scene" }, compiler);
    assert.equal(staticText.vectorSceneData.glyphRunMeta.length, 3,
      "page and Form output retain the static renderer's overprint approximation");
  }

  await assert.rejects(compile("", { output: undefined }), TypeError);
  await assert.rejects(compile("", { output: "unknown" }), TypeError);
}

async function testVectorSceneOutput() {
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
  const scene = await compileGroupedForm(content, options);

  assertSceneGeometryEqual(scene, baseline);
  assert.equal(scene.paintRuns.length, 0, "the grouped bridge does not retain vector paint runs");
  assert.equal(scene.glyphPaints.length, 0, "the ordered glyph ABI remains unused");
  assert.equal(scene.imageTransforms.length, 0, "the ordered image ABI remains unused");
  assert.equal("displayProgram" in scene, false, "direct compilation does not construct HEP data");
  assert.equal(baseline.vectorSceneData, undefined);

  const vectorData = scene.vectorSceneData;
  assert.ok(vectorData);
  assert.ok(vectorData.sourceEvents instanceof Uint32Array);
  assert.ok(vectorData.glyphRunMeta instanceof Uint32Array);
  assert.ok(vectorData.glyphFillColors instanceof Float32Array);
  assert.ok(vectorData.imageIndices instanceof Uint32Array);
  assert.ok(vectorData.imageTransforms instanceof Float32Array);
  assert.ok(vectorData.imageClipBounds instanceof Float32Array);
  assert.ok(vectorData.imagePaintOrders instanceof Uint32Array);
  assert.ok(vectorData.imageFlags instanceof Uint8Array);
  assert.deepEqual([...vectorData.glyphRunMeta], [5, 2, 0]);
  assert.deepEqual(
    [...vectorData.glyphFillColors],
    [Math.fround(0.2), Math.fround(0.4), Math.fround(0.6), 0.5]
  );
  assert.deepEqual([...vectorData.imageIndices], [4]);
  assert.deepEqual([...vectorData.imageTransforms], [2, 0, 0, 3, 5, 7]);
  assert.deepEqual([...vectorData.imageClipBounds], [-1_000, -1_000, 1_000, 1_000]);
  assert.deepEqual([...vectorData.imagePaintOrders], [0]);
  assert.deepEqual([...vectorData.imageFlags], [0]);
  assert.deepEqual([...vectorData.sourceEvents], [
    DENSE_PDF_VECTOR_SCENE_EVENT_IMAGE, 0,
    DENSE_PDF_VECTOR_SCENE_EVENT_ORDINARY_PAINT, 0,
    DENSE_PDF_VECTOR_SCENE_EVENT_GLYPH, 0
  ]);

  const invisibleThenImage = await compileGroupedForm("BT (ocr) Tj ET /Im0 Do", {
    imageXObjects: new Map([["Im0", 9]]),
    textOperatorSink: textSink(3, 11, 1)
  });
  assert.deepEqual([...invisibleThenImage.vectorSceneData.glyphRunMeta], [11, 1, 3]);
  assert.deepEqual([...invisibleThenImage.vectorSceneData.imageIndices], [9]);
  assert.deepEqual([...invisibleThenImage.vectorSceneData.imagePaintOrders], [0]);
  assert.deepEqual([...invisibleThenImage.vectorSceneData.sourceEvents], [
    DENSE_PDF_VECTOR_SCENE_EVENT_GLYPH, 0,
    DENSE_PDF_VECTOR_SCENE_EVENT_IMAGE, 0
  ]);

  const selectivelyClippedText = await compileGroupedPage(
    "0 0 m 10 0 l 5 10 l h W n BT (label) Tj ET",
    {
      textOperatorSink: textSink(0, 0, 1)
    }
  );
  assert.deepEqual([...selectivelyClippedText.vectorSceneData.glyphRunMeta], [0, 1, 0]);
  assert.equal(selectivelyClippedText.vectorSceneData.glyphFillColors[3], 0,
    "selectively rasterized text remains indexed but is transparent in the VectorScene glyph layer");
  assert.equal(selectivelyClippedText.vectorSceneData.selectivePaintSourceSpans.length, 2);
  assert.deepEqual(
    [...selectivelyClippedText.vectorSceneData.selectivePaintOrdinalSpans],
    [0, 0],
    "a selectively captured operator retains its VectorScene raster ordering slot"
  );

  const visibleThenImage = await compileGroupedForm("BT (label) Tj ET /Im0 Do", {
    imageXObjects: new Map([["Im0", 10]]),
    textOperatorSink: textSink(0, 0, 1)
  });
  assert.deepEqual([...visibleThenImage.vectorSceneData.imagePaintOrders], [1]);
  assert.deepEqual(
    [...visibleThenImage.vectorSceneData.imageFlags],
    [DENSE_PDF_VECTOR_SCENE_IMAGE_FLAG_LATE_AFTER_TEXT]
  );
  assert.deepEqual([...visibleThenImage.vectorSceneData.sourceEvents], [
    DENSE_PDF_VECTOR_SCENE_EVENT_ORDINARY_PAINT, 0,
    DENSE_PDF_VECTOR_SCENE_EVENT_GLYPH, 0,
    DENSE_PDF_VECTOR_SCENE_EVENT_IMAGE, 0
  ]);

  let orderedTextShow = 0;
  const formOrdering = await compileGroupedForm([
    "BT (ocr) Tj ET",
    "/Im0 Do",
    "/Hidden Do",
    "/Visible Do",
    "0 0 1 1 re f",
    "BT (visible) Tj ET"
  ].join("\n"), {
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
  assert.deepEqual([...formOrdering.vectorSceneData.formPaintOrders], [1]);
  assert.deepEqual([...formOrdering.vectorSceneData.sourceEvents], [
    DENSE_PDF_VECTOR_SCENE_EVENT_GLYPH, 0,
    DENSE_PDF_VECTOR_SCENE_EVENT_IMAGE, 0,
    DENSE_PDF_VECTOR_SCENE_EVENT_FORM, 0,
    DENSE_PDF_VECTOR_SCENE_EVENT_ORDINARY_PAINT, 0,
    DENSE_PDF_VECTOR_SCENE_EVENT_GLYPH, 1
  ]);

  const formThenImage = await compileGroupedForm("/Fm0 Do /Im0 Do", {
    formXObjects: new Map([["Fm0", 6]]),
    imageXObjects: new Map([["Im0", 2]])
  });
  assert.deepEqual([...formThenImage.vectorSceneData.sourceEvents], [
    DENSE_PDF_VECTOR_SCENE_EVENT_FORM, 0,
    DENSE_PDF_VECTOR_SCENE_EVENT_IMAGE, 0
  ], "a Form event is not itself an ordinary-paint barrier");
  assert.deepEqual([...formThenImage.vectorSceneData.formPaintOrders], [0]);
  assert.deepEqual(
    [...formThenImage.vectorSceneData.imagePaintOrders],
    [1],
    "a Form and a following image must share one monotonically ordered raster timeline"
  );

  const clippedImage = await compileGroupedForm("0 0 10 10 re W n /Im0 Do", {
    imageXObjects: new Map([["Im0", 1]])
  });
  assert.deepEqual([...clippedImage.vectorSceneData.imageClipBounds], [0, 0, 10, 10]);
  assert.deepEqual([...clippedImage.vectorSceneData.imageFlags], [1]);
  await expectUnsupportedGroupedForm(
    "0 0 m 10 0 l 5 10 l h W n /Im0 Do",
    "Do",
    {
      imageXObjects: new Map([["Im0", 1]])
    }
  );

  const rectangularClip = await compileGroupedForm(
    "0 0 10 10 re W n -5 -5 20 20 re f 1 1 m 9 9 l S",
    {}
  );
  assert.equal(rectangularClip.fillPathCount, 1);
  assert.equal(rectangularClip.segmentCount, 1);
  await expectUnsupportedGroupedForm(
    "0 0 m 10 0 l 5 10 l h W n 0 0 10 10 re f",
    "f",
    {}
  );
  await expectUnsupportedGroupedForm(
    "0 0 m 10 0 l 5 10 l h W n 1 1 m 9 9 l S",
    "S",
    {}
  );

  const disjointPathThenImage = await compileGroupedForm("0 20 10 10 re f /Im0 Do", {
    imageXObjects: new Map([["Im0", 1]])
  });
  assert.deepEqual([...disjointPathThenImage.vectorSceneData.imageFlags], [
    DENSE_PDF_VECTOR_SCENE_IMAGE_FLAG_LATE_AFTER_PATH
  ], "a conservatively disjoint preceding path may remain above the image underlay");
  await expectUnsupportedGroupedForm("0 0 10 10 re f /Im0 Do", "Do", {
    imageXObjects: new Map([["Im0", 1]])
  });
  const selectiveLateImage = await compileGroupedPage(
    "/Im0 Do 0 0 10 10 re f /Im1 Do",
    {
      imageXObjects: new Map([["Im0", 0], ["Im1", 1]])
    }
  );
  assert.equal(selectiveLateImage.vectorSceneData.imageFlags[1],
    DENSE_PDF_VECTOR_SCENE_IMAGE_FLAG_LATE_AFTER_PATH |
    DENSE_PDF_VECTOR_SCENE_IMAGE_FLAG_SELECTIVE_PATH_SPAN);
  assert.deepEqual([...selectiveLateImage.vectorSceneData.imagePathSpanCheckpoints], [
    0, 0, 0, 0, 0, 0,
    0, 1, 0, 0, 1, 2
  ]);
  const densePathOnly = await compileGroupedPage(
    Array.from({ length: 1_000 }, (_, index) => `${index} 20 1 1 re f`).join("\n"),
    {}
  );
  assert.equal(densePathOnly.vectorSceneData.imagePathSpanCheckpoints.length, 0,
    "path-dense pages allocate no per-path selective-image tape");
  const selectiveDisconnectedFill = await compileGroupedPage(
    Array.from({ length: 100 }, (_, index) => `${index * 2} 0 m ${index * 2 + 1} 0 l ${index * 2 + 1} 1 l h`).join("\n") + "\nf",
    {}
  );
  assert.equal(selectiveDisconnectedFill.fillPathCount, 0,
    "a selectively captured exact path is omitted from the packed VectorScene store");
  assert.equal(selectiveDisconnectedFill.vectorSceneData.selectivePaintSourceSpans.length, 2,
    "a selectively captured exact path retains one transient source identity");
  assert.deepEqual([...selectiveDisconnectedFill.vectorSceneData.selectivePaintOrdinalSpans], [0, 0]);
  const formBarrierSpan = await compileGroupedPage(
    "/Im0 Do 0 0 10 10 re f /Fm0 Do /Im1 Do",
    {
      imageXObjects: new Map([["Im0", 0], ["Im1", 1]]),
      formXObjects: new Map([["Fm0", 0]])
    }
  );
  assert.equal(formBarrierSpan.vectorSceneData.imagePathSourceSpans.length, 8,
    "the compiler defers Form-barrier safety to resource-aware flattening");
  await expectUnsupportedGroupedForm(
    "0 0 m 10 0 l S 10 0 m 0 0 l S /Im0 Do",
    "Do",
    {
      imageXObjects: new Map([["Im0", 1]])
    }
  );
  await expectUnsupportedGroupedForm("BT (stroke) Tj ET", "Tr", {
    textOperatorSink: textSink(1)
  });
  await expectUnsupportedGroupedForm("/Multiply gs 0 0 10 10 re f", "f", {
    extGStates: [{ resourceName: "Multiply", blendMode: "Multiply" }]
  });
  const inertAlphaAsShape = await compileGroupedForm(
    "/Shape gs 0 0 10 10 re f 0 20 m 10 20 l S",
    {
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
  const ignoredStrokeAdjustment = await compileGroupedForm(
    "/Adjusted gs 0 0 m 10 0 l S",
    {
      extGStates: [{ resourceName: "Adjusted", strokeAdjustment: true }]
    }
  );
  assert.equal(ignoredStrokeAdjustment.segmentCount, 1);
  const clearedSoftMask = await compileGroupedForm(
    "/NoMask gs 0 0 10 10 re f",
    {
      extGStates: [{ resourceName: "NoMask", softMaskIndex: null }]
    }
  );
  assert.equal(clearedSoftMask.fillPathCount, 1);
  await expectUnsupportedGroupedForm("/Shape gs 0 0 10 10 re f", "f", {
    extGStates: [{
      resourceName: "Shape",
      fillAlpha: 0.5,
      blendMode: "Normal",
      softMaskIndex: null,
      alphaIsShape: true
    }]
  });
  await expectUnsupportedGroupedForm("/ShapeMask gs 0 0 10 10 re f", "f", {
    extGStates: [{
      resourceName: "ShapeMask",
      fillAlpha: 1,
      blendMode: "Normal",
      softMaskIndex: 0,
      alphaIsShape: true
    }]
  });
  const translucentImage = await compileGroupedForm("/Half gs /Im0 Do", {
    imageXObjects: new Map([["Im0", 1]]),
    extGStates: [{ resourceName: "Half", fillAlpha: 0.5 }]
  });
  assert.deepEqual([...translucentImage.vectorSceneData.imageOpacities], [0.5],
    "constant image alpha is retained per paint without rasterizing the Form");
  await expectUnsupportedGroupedForm("/Multiply gs /Fm0 Do", "Do", {
    formXObjects: new Map([["Fm0", 0]]),
    extGStates: [{ resourceName: "Multiply", blendMode: "Multiply" }]
  });
  const deferredCompositeForm = await compileGroupedPage("/Multiply gs /Fm0 Do", {
    formXObjects: new Map([["Fm0", 0]]),
    extGStates: [{ resourceName: "Multiply", blendMode: "Multiply" }]
  });
  assert.deepEqual([...deferredCompositeForm.vectorSceneData.sourceEvents], [
    DENSE_PDF_VECTOR_SCENE_EVENT_FORM, 0
  ], "the selective-composite bridge retains the exact root Form event");
  await expectUnsupportedGroupedForm("0 0 10 10 re f /Fm0 Do /Im0 Do", "Do", {
    formXObjects: new Map([["Fm0", 0]]),
    imageXObjects: new Map([["Im0", 1]])
  });
  await assert.rejects(
    compile("", { output: "unknown" }),
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

async function testPathsAcrossGraphicsStatesAndEof() {
  const options = { enableSegmentMerge: false, enableInvisibleCull: false };
  for (const [content, expected, matrix] of [
    ["0 0 m q 1 0 0 1 1 1 cm 1 1 l Q 4 4 l S", "0 0 m 2 2 l 4 4 l S"],
    ["q 2 0 0 3 5 7 cm 0 0 m 1 1 l Q 9 10 l S", "5 7 m 7 10 l 9 10 l S"],
    ["0 0 m q 2 w 1 1 l Q 2 2 l S", "0 0 m 1 1 l 2 2 l S"],
    ["0 0 m 1 0 0 1 1 1 cm 1 1 l S", "-1 -1 m 1 1 l S", [1, 0, 0, 1, 1, 1]],
    ["q 2 0 0 2 4 6 cm 0 0 m 1 0 l h Q 5 8 8 8 v S",
      "4 6 m 6 6 l h 5 8 8 8 v S"]
  ]) {
    const actual = await compile(content, options);
    const explicit = await compile(expected, { ...options, ...(matrix ? { pageMatrix: matrix } : {}) });
    assertSceneGeometryEqual(actual, { ...explicit, operatorCount: actual.operatorCount });
  }
  const display = await compile("q 2 0 0 3 5 7 cm 0 0 m 1 1 l Q 9 10 l S", {
    ...options, output: "display-program"
  });
  assert.deepEqual([...display.pagePaths[0].data], [0, 5, 7, 1, 7, 10, 1, 9, 10]);
  assert.deepEqual(display.pagePaths[0].transform, [1, 0, 0, 1, 0, 0]);
  const curved = await compile("q 2 0 0 3 5 7 cm 0 0 m 1 0 2 1 3 1 c h Q f", {
    ...options, output: "display-program"
  });
  assert.deepEqual([...curved.pagePaths[0].data], [0, 5, 7, 2, 7, 7, 9, 10, 11, 10, 4]);
  assert.deepEqual(curved.pagePaths[0].transform, [1, 0, 0, 1, 0, 0]);
  for (const [paint, resources] of [
    ["/Resource Do", { imageXObjects: new Map([["Resource", 0]]) }],
    ["/Resource Do", { formXObjects: new Map([["Resource", 0]]) }],
    ["/Resource sh", { shadings: new Map([["Resource", 0]]) }]
  ]) {
    const invoked = await compile(`0 0 m ${paint} 10 0 l S`, {
      ...options, ...resources, output: "display-program"
    });
    assert.deepEqual([...invoked.endpoints], [0, 0, 10, 0],
      `${paint} leaves the caller's current path intact`);
    assert.equal(invoked.paintRuns.length, 6, "the resource paints before the pending path");
  }
  const before = encoder.encode("0 0 m ");
  const after = encoder.encode(" 10 0 l S");
  const inline = await compile([
    { kind: "content", bytes: before, sourceOffset: 0, sourceLength: before.length },
    { kind: "image", imageIndex: 0, sourceOffset: before.length, sourceLength: 12 },
    { kind: "content", bytes: after, sourceOffset: before.length + 12, sourceLength: after.length }
  ], { ...options, output: "display-program" });
  assert.deepEqual([...inline.endpoints], [0, 0, 10, 0]);
  assert.equal(inline.paintRuns[0], DENSE_PDF_PAINT_RUN_IMAGE);
  assert.equal(inline.paintRuns.length, 6);
  for (const tail of ["0 0 m", "0 0 1 1 re", "0 0 1 1 re W", "0 0 1 1 re W* q"]) {
    const painted = await compile(`5 5 m 6 6 l S ${tail}`, options);
    const expected = await compile("5 5 m 6 6 l S", options);
    assertSceneGeometryEqual(painted, { ...expected, operatorCount: painted.operatorCount });
  }
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
  assert.equal("retainedTextContent" in scene, false);

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
    output: "display-program",
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
    output: "display-program",
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
    output: "display-program",
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

async function testLargeVectorPaths() {
  const segmentCount = 70_000;
  const geometryOptions = {
    pageBounds: { minX: -1, minY: -1, maxX: segmentCount + 1, maxY: 4 },
    enableInvisibleCull: false,
    enableSegmentMerge: false
  };
  const commands = ["0 0 m"];
  for (let index = 1; index <= segmentCount; index += 1) {
    commands.push(`${index} ${index % 2} l`);
  }
  commands.push("S");
  const path = commands.slice(0, -1).join("\n");
  const stroked = await compile(`${path}\nS`, geometryOptions);
  assert.equal(stroked.segmentCount, segmentCount, "a long path keeps every vector stroke");

  const form = await compile(`${path}\nB*`, geometryOptions, compileVectorFormContent);
  assert.equal(form.segmentCount, segmentCount, "large Form paths remain vector");
  assert(form.fillSegmentCount > 65_536, "large Form fills exceed the former analytic cutoff");

  const content = `0 0 2 2 re f\n${path}\nB*\n0 0 3 3 re f`;
  const vectors = await compile(content, { ...geometryOptions, output: "vector-scene" });
  assert.equal(vectors.fillPathCount, 3, "large and surrounding fills all stay vector");
  assert.equal(vectors.segmentCount, segmentCount, "the companion stroke stays vector");
  assert(vectors.fillSegmentCount > 65_536, "the complete analytic fill exceeds the former cutoff");
  assert.deepEqual(vectors.vectorSceneData.selectivePaintReasons ?? [], []);
  assert.equal(vectors.vectorSceneData.selectivePaintSourceSpans.length, 0);
  assert.equal(vectors.vectorSceneData.selectivePaintOrdinalSpans.length, 0);

  const retained = await compile(`${path}\nB*`, { ...geometryOptions, output: "display-program" });
  assert.equal(retained.pagePaths[0].data.length, segmentCount * 3 + 3,
    "the display program retains every path command");
  assert.equal(retained.genericPathPaints[0].fillRule, 1, "even-odd winding is retained");
  assert.ok(retained.genericPathPaints[0].fill && retained.genericPathPaints[0].stroke);

  const clipped = await compile(`${path}\nW n\n0 0 2 2 re f`, { ...geometryOptions, output: "vector-scene" });
  assert.equal(clipped.pagePaths[0].data.length, segmentCount * 3 + 3,
    "large clip-only paths remain exact vector clip resources");
  assert.equal(clipped.clipPaths.length, 1);
  assert.equal(clipped.fillPathCount, 1);
  assert.equal(clipped.vectorSceneData.selectivePaintSourceSpans.length, 0,
    "clip construction itself has no raster paint to capture");

  const discarded = await compile(`${path}\nn`, { output: "vector-scene" });
  assert.equal(discarded.pathCount, 0, "unpainted paths produce no geometry");
  const invisible = await compile(`${path}\nf`, {
    output: "vector-scene",
    pageBounds: { minX: -10, minY: -10, maxX: -1, maxY: -1 }
  });
  assert.equal(invisible.pathCount, 0, "off-page fills do not require capture");

  await assert.rejects(compile(content, { output: "vector-scene", maxPathVerbs: segmentCount }),
    error => error instanceof DensePdfResourceLimitError && /verb limit/.test(error.message),
    "explicit path resource limits still apply");

  const controller = new AbortController();
  await assert.rejects(compile(content, {
    output: "vector-scene",
    signal: controller.signal,
    onProgress(progress) {
      if (progress.phase === "finalizing") controller.abort(new Error("large-path cancellation"));
    }
  }), /large-path cancellation/, "large paths remain cancellable before finalization");
}

async function testDeepMarkedContent() {
  const depth = 128;
  const content = `${"/Span BMC\n".repeat(depth)}0 0 2 2 re f\n${"EMC\n".repeat(depth)}`;
  const compiled = await compile(content);
  assert.equal(compiled.markedContent.length, depth, "valid nesting beyond the former default stays vector");
  assert.equal(compiled.fillPathCount, 1);
  await assert.rejects(compile(content, { maxMarkedContentDepth: 64 }),
    error => error instanceof DensePdfResourceLimitError && /nesting/.test(error.message),
    "caller-selected nesting limits still apply");
}

async function testGroupedSelectiveImageCheckpoints() {
  const containedImageSpan = await compileGroupedPage(
    "0 0 m 100 0 l S 10 0 m 20 0 l S /Im0 Do",
    { imageXObjects: new Map([["Im0", 0]]) }
  );
  assert.equal(containedImageSpan.segmentCount, 1, "a contained stroke is culled");
  assert.deepEqual([...containedImageSpan.vectorSceneData.imagePathSpanCheckpoints], [0, 0, 0, 1, 0, 2],
    "grouped containment culling remaps selective-image geometry checkpoints");

  const twoImages = await compileGroupedPage(
    "0 100 m 100 100 l S /Im0 Do 0 0 m 100 0 l S 10 0 m 20 0 l S /Im0 Do",
    { imageXObjects: new Map([["Im0", 0]]) }
  );
  assert.equal(twoImages.segmentCount, 2);
  assert.deepEqual([...twoImages.vectorSceneData.imagePathSpanCheckpoints],
    [0, 0, 1, 1, 1, 1, 0, 0, 1, 2, 2, 4],
    "nonzero stroke starts and the final stroke boundary both follow compaction");
}

async function* delayedChunks(bytes, chunkSize) {
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    yield bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
  }
}

async function expectUnsupported(content, operator, options = {}, compiler = compileDensePdfContent) {
  await assert.rejects(
    compile(content, options, compiler),
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
