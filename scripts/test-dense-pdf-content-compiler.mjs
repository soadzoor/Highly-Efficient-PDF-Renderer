import assert from "node:assert/strict";

import {
  compileDensePdfContent,
  DensePdfSyntaxError,
  DensePdfUnsupportedError
} from "../src/densePdfContentCompiler.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const DEFAULT_OPTIONS = Object.freeze({
  pageMatrix: [1, 0, 0, 1, 0, 0],
  pageBounds: { minX: -1_000, minY: -1_000, maxX: 1_000, maxY: 1_000 },
  enableSegmentMerge: true,
  enableInvisibleCull: true,
  yieldIntervalMs: 4
});

await testChunkBoundaryLexer();
await testPathsTransformsAndCurves();
await testClippingAndDashes();
await testDeviceColorsAndMetadataCounts();
await testTextAndMarkedContentRetention();
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
  assert.equal(actual.operatorCount, 1);
  assert.equal(actual.pathCount, 1);
  assert.equal(actual.sourceSegmentCount, 1);
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
  assert.equal(scene.operatorCount, 5);
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
  assert.equal(transformed.operatorCount, 5);

  await expectUnsupported("0 0 m q 1 0 0 1 1 1 cm Q 1 1 l S", "q");
  await expectUnsupported("0 0 m 1 0 0 1 1 1 cm 1 1 l S", "cm");

  // PDF.js keeps the pre-close shorthand-control current point after h. The
  // dense builder intentionally mirrors that normalized path representation.
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
  assert.deepEqual([...postClipPath.primitiveBounds], [0, 49.5, 100, 50.5]);
  assert.equal(
    decoder.decode(postClipPath.retainedTextContent),
    "0 0 m\n100 0 l\n100 100 l\n0 100 l\nh\nW\nn\n"
  );

  const evenOddRectangle = await compile("0 0 100 100 re W* n");
  assert.match(decoder.decode(evenOddRectangle.retainedTextContent), /W\*\nn\n$/);

  // Generic HEPR reduces nonzero clips to their transformed AABB, including
  // curved/non-rectangular paths. It does the same for even-odd paths unless
  // every subpath is a rectangle and one rectangle creates an exclusion mask.
  await compile("0 0 m 10 20 20 -10 30 10 c 0 30 l h W n");
  const irregularEvenOdd = await compile(
    "0 0 m 100 0 l 75 100 l 0 50 l h W* n -10 50 m 110 50 l S"
  );
  assert.equal(irregularEvenOdd.segmentCount, 1);
  assert.deepEqual([...irregularEvenOdd.primitiveBounds], [0, 49.5, 100, 50.5]);

  const multiIrregularEvenOdd = await compile(
    "0 0 m 40 0 l 20 40 l h 60 60 m 100 60 l 80 100 l h W* n " +
    "-10 50 m 110 50 l S"
  );
  assert.equal(multiIrregularEvenOdd.segmentCount, 1);
  assert.deepEqual([...multiIrregularEvenOdd.primitiveBounds], [0, 49.5, 100, 50.5]);

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
  assert.deepEqual([...maskedStroke.primitiveBounds], [0, 49.5, 100, 50.5]);

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
  assert.equal(shorthand.operatorCount, 2);
  assert.equal(explicit.operatorCount, 2);
  assert.equal(explicitN.operatorCount, 2);
  assert.equal((await compile("/DeviceRGB CS")).operatorCount, 0);

  await compile("/DeviceGray CS 0.5 SC 0 0 m 1 0 l S");
  await compile("/DeviceCMYK CS 0.1 0.2 0.3 0.4 SC 0 0 m 1 0 l S");
  await compile("0.5 G 0 0 m 1 0 l S 0.1 0.2 0.3 rg 0 0 1 1 re f");
  await compile("0.1 0.2 0.3 0.4 K 0 0 m 1 0 l S");
}

async function testTextAndMarkedContentRetention() {
  // PDF source forbids exponent notation, but parsing a sufficiently small
  // decimal produces an exponential JS String that the retained serializer
  // must expand without re-rounding.
  const tiny = "0.00000012345678901234567";
  const content = [
    "q 2 w 1 J 2 j 9 M [3 1] 0 d 0.25 G 0.1 0.2 0.3 rg",
    `BT ${tiny} 0 0 ${tiny} 1 2 Tm /F1 12 Tf 1 Tc 2 Tw 90 Tz 14 TL 0 Tr 3 Ts`,
    "10 20 Td 1 2 TD T* (hello) Tj [(a) -10 <62>] TJ (c) ' 1 2 (d) \" ET",
    "/Span BMC EMC /Span << /MCID 1 >> BDC EMC",
    "/Point MP /Point << /MCID 2 >> DP Q"
  ].join("\n");
  const scene = await compile(content);
  const retained = decoder.decode(scene.retainedTextContent);
  assert.match(retained, /0\.00000012345678901234568 0 0 0\.00000012345678901234568 1 2 Tm/);
  assert.match(retained, /\/F1 12 Tf/);
  assert.match(retained, /\/Span <<\/MCID 1>> BDC/);
  assert.match(retained, /\/Point <<\/MCID 2>> DP/);
  assert.deepEqual(scene.referencedFonts, ["F1"]);
  assert.deepEqual(scene.referencedProperties, []);
  assert.equal(scene.textShowOpCount, 4);

  const nextLineShow = await compile("(a) '");
  assert.equal(nextLineShow.operatorCount, 2);
  assert.equal(nextLineShow.textShowOpCount, 1);
  const spacingNextLineShow = await compile('1 2 (a) "');
  assert.equal(spacingNextLineShow.operatorCount, 4);
  assert.equal(spacingNextLineShow.textShowOpCount, 1);

  const namedProperties = await compile("/Span /MC0 BDC EMC /Point /MC1 DP");
  assert.deepEqual(namedProperties.referencedProperties, ["MC0", "MC1"]);
  assert.equal((await compile("/Point MP /Point << /MCID 1 >> DP")).operatorCount, 0);
}

async function testUnsupportedAndMalformedContent() {
  const inertGraphicsState = await compile("/R10 gs 0 0 m 10 0 l S", {
    availableExtGStates: ["R10"]
  });
  assert.equal(inertGraphicsState.operatorCount, 1);
  assert.equal(inertGraphicsState.segmentCount, 1);
  assert.equal(inertGraphicsState.retainedTextContent.length, 0);

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

async function expectUnsupported(content, operator) {
  await assert.rejects(
    compile(content),
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
