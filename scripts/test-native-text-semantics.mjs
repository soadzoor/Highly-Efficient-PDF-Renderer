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

const {
  NativeTextCompiler,
  multiplyPdfTextMatrices
} = await import("../src/pdf/nativeText.ts");
const { buildNativePageTextResources } = await import("../src/pdf/nativePageText.ts");
const { HEPR_GLYPH_FLAG, HEPR_PATH_VERB } = await import("../src/heprDocumentData.ts");
const { PdfError } = await import("../src/pdf/nativeTypes.ts");

const binaryText = (...values) => Uint8Array.of(...values);
const fontA = makeFont();
const fontV = makeFont({ subtype: "Type0", writingMode: 1 });

testTextObjectLegalityAndPersistentState();
testHorizontalOperatorsAndUnicodeIndex();
testLinePositioningAndSearchSeparators();
testGraphicsStateCtmAndTransformDeduplication();
testWordSpacingCodeSemantics();
testVerticalMetricsAndAdjustments();
testRenderingModesAndInvisibleGeometry();
testOutlineStoresAndLimits();
testCancellationMalformedValuesAndResourceLimits();

console.log("native text semantics tests passed");
hooks.deregister();

function testTextObjectLegalityAndPersistentState() {
  const text = compilerFor([["F1", fontA]]);
  text.applyOperator("Tf", ["/F1", 10]);
  text.applyOperator("Tc", [1]);
  text.applyOperator("Tw", [2]);
  text.applyOperator("Tz", [50]);
  text.applyOperator("TL", [12]);
  text.applyOperator("Ts", [3]);
  text.applyOperator("Tr", [0]);
  text.applyOperator("q", []);
  text.applyOperator("Tf", ["F1", 20]);
  text.applyOperator("BT", []);
  text.applyOperator("ET", []);
  text.applyOperator("Q", []);
  text.applyOperator("BT", []);
  text.applyOperator("Tm", [1, 0, 0, 1, 0, 0]);
  text.applyOperator("Tj", [binaryText(65)]);
  text.applyOperator("ET", []);
  const compiled = text.build();
  assertMatrix(matrixForGlyph(compiled, 0), [0.005, 0, 0, 0.01, 0, 3]);
  assert.deepEqual([...compiled.glyphs.advances], [3.5, 0]);

  for (const [operator, operands] of [
    ["Td", [1, 2]],
    ["TD", [1, 2]],
    ["Tm", [1, 0, 0, 1, 0, 0]],
    ["T*", []],
    ["Tj", [binaryText(65)]],
    ["TJ", [[binaryText(65)]]],
    ["'", [binaryText(65)]],
    ["\"", [0, 0, binaryText(65)]],
    ["ET", []]
  ]) {
    expectPdfError(() => compilerFor([["F1", fontA]]).applyOperator(operator, operands), "unsupported-content");
  }

  const nested = compilerFor([["F1", fontA]]);
  nested.beginText();
  expectPdfError(() => nested.beginText(), "unsupported-content");
  expectPdfError(() => nested.saveGraphicsState(), "unsupported-content");
  expectPdfError(() => nested.restoreGraphicsState(), "unsupported-content");
  expectPdfError(() => nested.concatTransform([1, 0, 0, 1, 0, 0]), "unsupported-content");

  const openText = compilerFor([]);
  openText.beginText();
  expectPdfError(() => openText.build(), "unsupported-content");
  const openGraphics = compilerFor([]);
  openGraphics.saveGraphicsState();
  expectPdfError(() => openGraphics.build(), "unsupported-content");
  expectPdfError(() => compilerFor([]).restoreGraphicsState(), "unsupported-content");
}

function testHorizontalOperatorsAndUnicodeIndex() {
  const text = compilerFor([["F1", fontA]]);
  text.beginText();
  text.setFont("F1", 10);
  text.setCharacterSpacing(1);
  text.setWordSpacing(2);
  text.setHorizontalScale(50);
  text.setRise(3);
  text.setTextMatrix([1, 0, 0, 1, 100, 200]);
  text.showText(binaryText(65, 32));
  text.showAdjustedText([binaryText(66), 100, binaryText(67)]);
  text.endText();
  const compiled = text.build();

  assert.equal(compiled.textIndex.text, "A fi😀");
  assert.deepEqual([...compiled.textIndex.charGlyphIndices], [0, 1, 2, 2, 3, 3]);
  assert.deepEqual(compiled.runs.map(({ first, count }) => [first, count]), [[0, 2], [2, 2]]);
  assert.deepEqual([...compiled.glyphs.advances], [3.5, 0, 2.75, 0, 3.5, 0, 3.5, 0]);
  assertMatrix(matrixForGlyph(compiled, 0), [0.005, 0, 0, 0.01, 100, 203]);
  assertMatrix(matrixForGlyph(compiled, 1), [0.005, 0, 0, 0.01, 103.5, 203]);
  assertMatrix(matrixForGlyph(compiled, 2), [0.005, 0, 0, 0.01, 106.25, 203]);
  assertMatrix(matrixForGlyph(compiled, 3), [0.005, 0, 0, 0.01, 109.25, 203]);

  const gap = compilerFor([["F1", fontA]]);
  gap.setFont("F1", 10);
  gap.beginText();
  gap.showAdjustedText([binaryText(65), -500, binaryText(66)]);
  gap.endText();
  const gapResult = gap.build();
  assert.equal(gapResult.textIndex.text, "A fi");
  assert.deepEqual([...gapResult.glyphGapBefore], [0, 1]);

  const hidden = compilerFor([["F1", fontA]]);
  hidden.setFont("F1", 10);
  hidden.beginText();
  hidden.setOutputEnabled(false);
  hidden.showText(binaryText(65));
  hidden.setOutputEnabled(true);
  hidden.showText(binaryText(66));
  hidden.endText();
  const hiddenResult = hidden.build();
  assert.equal(hiddenResult.textIndex.text, "fi");
  assert.deepEqual([...hiddenResult.textIndex.charGlyphIndices], [0, 0]);
  assertMatrix(matrixForGlyph(hiddenResult, 0), [0.01, 0, 0, 0.01, 6, 0]);

  const unmapped = compilerFor([["F1", makeFont({ missingUnicode: true })]]);
  unmapped.setFont("F1", 10);
  unmapped.beginText();
  unmapped.showText(binaryText(68, 68));
  unmapped.endText();
  const unmappedResult = unmapped.build();
  assert.equal(unmappedResult.textIndex.text, "��");
  assert.deepEqual([...unmappedResult.textIndex.charGlyphIndices], [0, 1]);
  assert.equal(unmappedResult.diagnostics.length, 1, "one unmapped code emits one stable warning");

  const negative = compilerFor([["F1", fontA]]);
  negative.setFont("F1", -10);
  negative.setHorizontalScale(-100);
  negative.beginText();
  negative.showText(binaryText(65));
  negative.endText();
  const negativeResult = negative.build();
  assert.deepEqual([...negativeResult.glyphs.advances], [6, 0]);
  assertMatrix(matrixForGlyph(negativeResult, 0), [0.01, 0, 0, -0.01, 0, 0]);
}

function testLinePositioningAndSearchSeparators() {
  const text = compilerFor([["F1", fontA]]);
  text.setFont("F1", 10);
  text.beginText();
  text.setTextMatrix([1, 0, 0, 1, 100, 200]);
  text.moveText(0, -12, true);
  text.showText(binaryText(65));
  text.applyOperator("'", [binaryText(66)]);
  text.applyOperator("\"", [5, 2, binaryText(67)]);
  text.nextLine();
  text.endText();
  const compiled = text.build();
  assert.equal(compiled.textIndex.text, "A\nfi\n😀", "pending separators omit the final empty line");
  assert.deepEqual([...compiled.textIndex.charGlyphIndices], [0, -1, 1, 1, -1, 2, 2]);
  assertMatrix(matrixForGlyph(compiled, 0), [0.01, 0, 0, 0.01, 100, 188]);
  assertMatrix(matrixForGlyph(compiled, 1), [0.01, 0, 0, 0.01, 100, 176]);
  assertMatrix(matrixForGlyph(compiled, 2), [0.01, 0, 0, 0.01, 100, 164]);
  assert.deepEqual([...compiled.glyphs.advances].slice(-2), [8, 0]);

  const moved = compilerFor([["F1", fontA]]);
  moved.setFont("F1", 10);
  moved.appendSeparator(" ");
  moved.beginText();
  moved.setTextMatrix([1, 0, 0, 1, 0, 0]);
  moved.moveText(10, 20);
  moved.showText(binaryText(65));
  moved.endText();
  moved.appendSeparator(" ");
  moved.appendSeparator("\n");
  moved.beginText();
  moved.showText(binaryText(66));
  moved.endText();
  moved.appendSeparator(" ");
  const movedResult = moved.build();
  assert.equal(movedResult.textIndex.text, "A\nfi");
  assertMatrix(matrixForGlyph(movedResult, 0), [0.01, 0, 0, 0.01, 10, 20]);

  const positioned = compilerFor([["F1", fontA]]);
  positioned.setFont("F1", 10);
  positioned.beginText();
  positioned.showText(binaryText(65));
  positioned.moveText(5, 0);
  positioned.showText(binaryText(66));
  positioned.moveText(0, -10);
  positioned.showText(binaryText(67));
  positioned.endText();
  assert.equal(positioned.build().textIndex.text, "A fi\n😀");

  // A leading TJ number is relative to the current Tm, not necessarily to
  // the previous text-show operation. Here the large adjustment returns the
  // next glyph to a slightly overlapping position at the end of the same
  // word, so it must not create a searchable-space boundary.
  const resetAndKerned = compilerFor([["F1", fontA]]);
  resetAndKerned.setFont("F1", 1);
  resetAndKerned.beginText();
  resetAndKerned.setTextMatrix([10, 0, 0, 10, 0, 0]);
  resetAndKerned.showText(binaryText(65));
  resetAndKerned.setTextMatrix([10, 0, 0, 10, -14, 0]);
  resetAndKerned.showAdjustedText([-1950, binaryText(66)]);
  resetAndKerned.endText();
  const resetAndKernedResult = resetAndKerned.build();
  assert.equal(resetAndKernedResult.textIndex.text, "Afi");
  assert.deepEqual([...resetAndKernedResult.glyphGapBefore], [0, 0]);

  const rotatedResetAndKerned = compilerFor([["F1", fontA]]);
  rotatedResetAndKerned.setFont("F1", 1);
  rotatedResetAndKerned.beginText();
  rotatedResetAndKerned.setTextMatrix([0, 10, -10, 0, 0, 0]);
  rotatedResetAndKerned.showText(binaryText(65));
  rotatedResetAndKerned.setTextMatrix([0, 10, -10, 0, 0, -14]);
  rotatedResetAndKerned.showAdjustedText([-1950, binaryText(66)]);
  rotatedResetAndKerned.endText();
  const rotatedResetResult = rotatedResetAndKerned.build();
  assert.equal(rotatedResetResult.textIndex.text, "Afi");
  assert.deepEqual([...rotatedResetResult.glyphGapBefore], [0, 0]);

  // Word-gap thresholds follow the transformed writing direction, not the
  // perpendicular text axis. This deliberately anisotropic Tm has a 10-unit
  // baseline em and a 100-unit perpendicular em; its 2-unit forward gap is a
  // word boundary.
  const anisotropicGap = compilerFor([["F1", fontA]]);
  anisotropicGap.setFont("F1", 1);
  anisotropicGap.beginText();
  anisotropicGap.setTextMatrix([10, 0, 0, 100, 0, 0]);
  anisotropicGap.showAdjustedText([binaryText(65), -200, binaryText(66)]);
  anisotropicGap.endText();
  const anisotropicGapResult = anisotropicGap.build();
  assert.equal(anisotropicGapResult.textIndex.text, "A fi");
  assert.deepEqual([...anisotropicGapResult.glyphGapBefore], [0, 1]);
}

function testGraphicsStateCtmAndTransformDeduplication() {
  const text = compilerFor([["F1", fontA]]);
  text.setFont("F1", 10);
  text.saveGraphicsState();
  text.setFont("F1", 20);
  text.concatTransform([2, 0, 0, 3, 10, 20]);
  text.beginText();
  text.setTextMatrix([1, 0, 0, 1, 4, 5]);
  text.showText(binaryText(65));
  text.endText();
  text.restoreGraphicsState();
  text.beginText();
  text.setTextMatrix([1, 0, 0, 1, 4, 5]);
  text.showText(binaryText(65));
  text.endText();
  const compiled = text.build();
  assertMatrix(matrixForGlyph(compiled, 0), [0.04, 0, 0, 0.06, 18, 35]);
  assertMatrix(matrixForGlyph(compiled, 1), [0.01, 0, 0, 0.01, 4, 5]);
  assert.deepEqual(multiplyPdfTextMatrices(
    [2, 0, 0, 3, 10, 20],
    [1, 0, 0, 1, 4, 5]
  ), [2, 0, 0, 3, 18, 35]);

  const deduplicated = compilerFor([["F1", fontA]]);
  deduplicated.setFont("F1", 1000);
  deduplicated.beginText();
  deduplicated.showText(binaryText(65));
  deduplicated.setTextMatrix([1, 0, 0, 1, 0, 0]);
  deduplicated.showText(binaryText(65));
  deduplicated.endText();
  const deduplicatedResult = deduplicated.build();
  assert.deepEqual([...deduplicatedResult.glyphs.transformIndices], [0, 0]);
  assert.equal(deduplicatedResult.transforms.values.length, 6);

  const depth = compilerFor([], { maxGraphicsStateDepth: 1 });
  depth.saveGraphicsState();
  expectPdfError(() => depth.saveGraphicsState(), "resource-limit");
}

function testWordSpacingCodeSemantics() {
  const simple = compileSingle(fontA, binaryText(32), (text) => text.setWordSpacing(5));
  assert.deepEqual([...simple.glyphs.advances], [7.5, 0]);

  const oneByteComposite = compileSingle(
    makeFont({ subtype: "Type0" }),
    binaryText(32),
    (text) => text.setWordSpacing(5)
  );
  assert.deepEqual([...oneByteComposite.glyphs.advances], [7.5, 0]);

  const multibyteComposite = compileSingle(
    makeFont({ subtype: "Type0", multibyte: true }),
    binaryText(0, 32),
    (text) => text.setWordSpacing(5)
  );
  assert.deepEqual([...multibyteComposite.glyphs.advances], [2.5, 0]);
}

function testVerticalMetricsAndAdjustments() {
  const text = compilerFor([["FV", fontV]]);
  text.setFont("FV", 10);
  text.setCharacterSpacing(1);
  text.setHorizontalScale(50);
  text.setRise(2);
  text.beginText();
  text.setTextMatrix([1, 0, 0, 1, 100, 200]);
  text.showAdjustedText([binaryText(65), 100, binaryText(66)]);
  text.endText();
  const compiled = text.build();
  assert.deepEqual([...compiled.glyphs.advances], [0, -8, 0, -8]);
  assertMatrix(matrixForGlyph(compiled, 0), [0.005, 0, 0, 0.01, 98.5, 194.5]);
  assertMatrix(matrixForGlyph(compiled, 1), [0.005, 0, 0, 0.01, 98.5, 185.5]);
  assert.ok(compiled.glyphs.flags[0] & HEPR_GLYPH_FLAG.Vertical);
  assert.deepEqual(compiled.runs.map(({ first, count }) => [first, count]), [[0, 2]]);

  const verticalGap = compilerFor([["FV", fontV]]);
  verticalGap.setFont("FV", 10);
  verticalGap.beginText();
  verticalGap.showAdjustedText([binaryText(65), 500, binaryText(66)]);
  verticalGap.endText();
  const verticalGapResult = verticalGap.build();
  assert.equal(verticalGapResult.textIndex.text, "A fi");
  assert.deepEqual([...verticalGapResult.glyphGapBefore], [0, 1]);

  const verticalResetAndKerned = compilerFor([["FV", fontV]]);
  verticalResetAndKerned.setFont("FV", 10);
  verticalResetAndKerned.beginText();
  verticalResetAndKerned.showText(binaryText(65));
  verticalResetAndKerned.setTextMatrix([1, 0, 0, 1, 0, 10]);
  verticalResetAndKerned.showAdjustedText([1950, binaryText(66)]);
  verticalResetAndKerned.endText();
  const verticalResetResult = verticalResetAndKerned.build();
  assert.equal(verticalResetResult.textIndex.text, "Afi");
  assert.deepEqual([...verticalResetResult.glyphGapBefore], [0, 0]);
}

function testRenderingModesAndInvisibleGeometry() {
  const modes = compilerFor([["F1", fontA]]);
  modes.setFont("F1", 10);
  modes.beginText();
  for (let mode = 0; mode <= 7; mode += 1) {
    modes.setRenderingMode(mode);
    modes.setTextMatrix([1, 0, 0, 1, mode * 20, 0]);
    modes.showText(binaryText(65));
  }
  modes.endText();
  const modeResult = modes.build();
  for (let mode = 0; mode <= 7; mode += 1) {
    const flags = modeResult.glyphs.flags[mode];
    assert.equal(Boolean(flags & HEPR_GLYPH_FLAG.Invisible), mode === 3 || mode === 7);
    assert.equal(Boolean(flags & HEPR_GLYPH_FLAG.ClipOnly), mode >= 4);
  }

  const supported = compilerFor([["F1", fontA]]);
  supported.setFont("F1", 10);
  supported.beginText();
  for (let mode = 0; mode <= 3; mode += 1) {
    supported.setRenderingMode(mode);
    supported.setTextMatrix([1, 0, 0, 1, mode * 20, 0]);
    supported.showText(binaryText(65));
  }
  supported.endText();
  const supportedPage = buildNativePageTextResources(
    supported.build(),
    [{ font: fontA, fontIndex: 0 }],
    { maxPaths: 10 }
  );
  assert.deepEqual(supportedPage.runs.map((run) => run.renderingMode), [0, 1, 2, 3]);
  assert.deepEqual([...supportedPage.textIndex.charGlyphIndices], [0, 1, 2, -2]);

  let outlineCalls = 0;
  const invisibleFont = makeFont({ onOutline: () => { outlineCalls += 1; } });
  const invisible = compilerFor([["F1", invisibleFont]]);
  invisible.setFont("F1", 10);
  invisible.beginText();
  invisible.setRenderingMode(3);
  invisible.setTextMatrix([1, 0, 0, 1, 25, 50]);
  invisible.showText(binaryText(66));
  invisible.endText();
  const raw = invisible.build();
  assert.deepEqual([...raw.textIndex.charGlyphIndices], [0, 0]);
  const page = buildNativePageTextResources(raw, [{ font: invisibleFont, fontIndex: 0 }], {
    maxPaths: 10
  });
  assert.equal(outlineCalls, 0, "invisible OCR text does not require a usable font program");
  assert.deepEqual([...page.textIndex.charGlyphIndices], [-2, -2]);
  assert.equal(page.textIndex.fallbackQuads.length, 4);
  assert.ok(page.textIndex.fallbackQuads[0] < page.textIndex.fallbackQuads[2]);
  assert.ok(page.textIndex.fallbackQuads[1] < page.textIndex.fallbackQuads[3]);

  const clipping = compilerFor([["F1", fontA]]);
  clipping.setFont("F1", 10);
  clipping.beginText();
  clipping.setRenderingMode(7);
  clipping.showText(binaryText(65));
  clipping.endText();
  const clippingPage = buildNativePageTextResources(
    clipping.build(),
    [{ font: fontA, fontIndex: 0 }],
    { maxPaths: 10 }
  );
  assert.equal(clippingPage.outlinePaths.pathVerbOffsets.length - 1, 1);
  assert.deepEqual([...clippingPage.textIndex.charGlyphIndices], [-2]);

  const invalidTransition = compilerFor([["F1", fontA]]);
  invalidTransition.setFont("F1", 10);
  invalidTransition.beginText();
  invalidTransition.setRenderingMode(4);
  invalidTransition.showText(binaryText(65));
  expectPdfError(() => invalidTransition.setRenderingMode(0), "unsupported-content");
}

function testOutlineStoresAndLimits() {
  let outlineCalls = 0;
  const outlinedFont = makeFont({ onOutline: () => { outlineCalls += 1; } });
  const text = compilerFor([["F1", outlinedFont]]);
  text.setFont("F1", 10);
  text.beginText();
  text.showText(binaryText(65, 65));
  text.endText();
  const compilation = text.build();
  const page = buildNativePageTextResources(
    compilation,
    [{ font: outlinedFont, fontIndex: 0 }],
    { maxPaths: 10 }
  );
  assert.equal(outlineCalls, 1, "a repeated glyph owns one derived outline");
  assert.deepEqual([...page.fonts.glyphOffsets], [0, 1]);
  assert.deepEqual([...page.fonts.glyphIds], [65]);
  assert.deepEqual([...page.fonts.outlinePathStarts], [0]);
  assert.deepEqual([...page.fonts.outlinePathCounts], [1]);
  assert.deepEqual([...page.outlinePaths.pathVerbOffsets], [0, 5]);
  assert.deepEqual([...page.outlinePaths.verbs], [
    HEPR_PATH_VERB.MoveTo,
    HEPR_PATH_VERB.LineTo,
    HEPR_PATH_VERB.LineTo,
    HEPR_PATH_VERB.LineTo,
    HEPR_PATH_VERB.Close
  ]);
  assert.deepEqual([...page.outlinePaths.verbCoordinateOffsets], [0, 2, 4, 6, 8, 8]);
  assert.deepEqual([...page.outlinePaths.bounds], [0, -200, 600, 800]);

  expectPdfError(
    () => buildNativePageTextResources(
      compilation,
      [{ font: outlinedFont, fontIndex: 0 }],
      { maxPaths: 10, maxPathVerbs: 4 }
    ),
    "resource-limit"
  );
  expectPdfError(
    () => buildNativePageTextResources(
      compilation,
      [{ font: makeFont({ openOutline: true }), fontIndex: 0 }],
      { maxPaths: 10 }
    ),
    "unsupported-font"
  );
}

function testCancellationMalformedValuesAndResourceLimits() {
  const aborted = new AbortController();
  aborted.abort("fixture cancellation");
  expectPdfError(
    () => compilerFor([["F1", fontA]], { signal: aborted.signal }),
    "aborted"
  );

  const glyphLimit = compilerFor([["F1", fontA]], { maxGlyphs: 1 });
  glyphLimit.setFont("F1", 10);
  glyphLimit.beginText();
  expectPdfError(() => glyphLimit.showText(binaryText(65, 66)), "resource-limit");

  const textLimit = compilerFor([["F1", fontA]], { maxTextCodeUnits: 1 });
  textLimit.setFont("F1", 10);
  textLimit.beginText();
  expectPdfError(() => textLimit.showText(binaryText(66)), "resource-limit");

  const fallbackLimit = compilerFor([], { maxFallbackQuads: 1 });
  fallbackLimit.appendFallbackText("A", [0, 0, 1, 1]);
  expectPdfError(() => fallbackLimit.appendFallbackText("B", [0, 0, 1, 1]), "resource-limit");
  expectPdfError(() => compilerFor([]).appendFallbackText("A", [1, 0, 0, 1]), "unsupported-content");

  const transformLimit = compilerFor([["F1", fontA]], { maxTransforms: 1 });
  transformLimit.setFont("F1", 10);
  transformLimit.beginText();
  expectPdfError(() => transformLimit.showText(binaryText(65)), "resource-limit");

  const arrayLimit = compilerFor([["F1", fontA]], { maxTextArrayItems: 1 });
  arrayLimit.setFont("F1", 10);
  arrayLimit.beginText();
  expectPdfError(
    () => arrayLimit.showAdjustedText([binaryText(65), 10]),
    "resource-limit"
  );

  expectPdfError(() => compilerFor([]).setRise(Number.NaN), "unsupported-content");
  expectPdfError(
    () => multiplyPdfTextMatrices(
      [Number.MAX_VALUE, 0, 0, 1, 0, 0],
      [2, 0, 0, 1, 0, 0]
    ),
    "unsupported-content"
  );
  const floatOverflow = compilerFor(
    [["F1", fontA]],
    { initialTransform: [1e39, 0, 0, 1, 0, 0] }
  );
  floatOverflow.setFont("F1", 1000);
  floatOverflow.beginText();
  expectPdfError(() => floatOverflow.showText(binaryText(65)), "unsupported-content");

  const invalidDecoder = makeFont({ invalidCodeLength: true });
  const invalidText = compilerFor([["F1", invalidDecoder]]);
  invalidText.setFont("F1", 10);
  invalidText.beginText();
  expectPdfError(() => invalidText.showText(binaryText(65)), "unsupported-content");

  const valid = compileSingle(fontA, binaryText(65));
  const badTransformReference = {
    ...valid,
    glyphs: {
      ...valid.glyphs,
      transformIndices: Uint32Array.of(999)
    }
  };
  expectPdfError(
    () => buildNativePageTextResources(
      badTransformReference,
      [{ font: fontA, fontIndex: 0 }],
      { maxPaths: 10 }
    ),
    "invalid-object"
  );
  expectPdfError(
    () => buildNativePageTextResources(
      valid,
      [{ font: fontA, fontIndex: 0 }],
      { maxPaths: 10, signal: aborted.signal }
    ),
    "aborted"
  );
}

function compileSingle(font, bytes, configure = () => {}) {
  const text = compilerFor([["F", font]]);
  text.setFont("F", 10);
  configure(text);
  text.beginText();
  text.showText(bytes);
  text.endText();
  return text.build();
}

function compilerFor(entries, options = {}) {
  return new NativeTextCompiler({
    fonts: new Map(entries.map(([resourceName, font], fontIndex) => [
      resourceName,
      { font, fontIndex }
    ])),
    ...options
  });
}

function makeFont({
  subtype = "TrueType",
  writingMode = 0,
  multibyte = false,
  invalidCodeLength = false,
  missingUnicode = false,
  openOutline = false,
  onOutline = () => {}
} = {}) {
  return {
    subtype,
    baseFont: `Fixture-${subtype}-${writingMode}`,
    writingMode,
    descriptor: {
      flags: 0,
      ascent: 800,
      descent: -200,
      missingWidth: 600,
      fontBBox: [0, -200, 600, 800],
      embeddedKind: "truetype",
      family: "Fixture",
      stretch: null,
      weight: 400,
      italicAngle: 0,
      capHeight: 700,
      xHeight: 500,
      stemV: 80
    },
    style: {},
    unitsPerEm: 1000,
    sfnt: null,
    substitution: null,
    diagnostics: [],
    decode(bytes, offset = 0) {
      if (invalidCodeLength) {
        return mappedCharacter(65, 0, 600, "A", writingMode);
      }
      if (multibyte) {
        const code = (bytes[offset] << 8) | bytes[offset + 1];
        return mappedCharacter(code, 2, code === 32 ? 250 : 600, unicodeFor(code), writingMode);
      }
      const code = bytes[offset];
      return mappedCharacter(
        code,
        1,
        code === 32 ? 250 : 600,
        missingUnicode && code === 68 ? null : unicodeFor(code),
        writingMode
      );
    },
    getGlyphOutline(glyphId) {
      onOutline(glyphId);
      const commands = [
        { kind: "move", x: 0, y: -200 },
        { kind: "line", x: 600, y: -200 },
        { kind: "line", x: 600, y: 800 },
        { kind: "line", x: 0, y: 800 }
      ];
      if (!openOutline) commands.push({ kind: "close" });
      return {
        glyphId,
        commands,
        bounds: [0, -200, 600, 800],
        advanceWidth: 600,
        leftSideBearing: 0
      };
    }
  };
}

function mappedCharacter(code, codeByteLength, width, unicode, writingMode) {
  return {
    code,
    codeByteLength,
    cid: code,
    glyphId: code,
    glyphName: null,
    unicode,
    width,
    verticalMetric: writingMode === 1
      ? { advanceY: -900, originX: 300, originY: 750 }
      : null
  };
}

function unicodeFor(code) {
  if (code === 32) return " ";
  if (code === 65) return "A";
  if (code === 66) return "fi";
  if (code === 67) return "😀";
  return "�";
}

function matrixForGlyph(compilation, glyphIndex) {
  const transformIndex = compilation.glyphs.transformIndices[glyphIndex];
  return [...compilation.transforms.values.subarray(transformIndex * 6, transformIndex * 6 + 6)];
}

function assertMatrix(actual, expected, epsilon = 1e-6) {
  assert.equal(actual.length, 6);
  for (let index = 0; index < 6; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= epsilon,
      `matrix component ${index}: expected ${expected[index]}, received ${actual[index]}`
    );
  }
}

function expectPdfError(callback, code) {
  assert.throws(callback, (error) => error instanceof PdfError && error.code === code);
}
