import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { compileDensePdfContent, getDensePdfPaintSourceIdentity } = await import("../src/pdf/nativeContentCompiler.ts");
  const { densePdfPagePathCount, getDensePdfPagePath, densePdfGenericPathPaintCount,
    getDensePdfGenericPathPaint } = await import("../src/pdf/nativeRetainedResources.ts");
  const { createHeprPageDataFromDense } = await import("../src/densePdfPageData.ts");
  const { validateHeprPageData } = await import("../src/heprDocumentDataValidation.ts");
  const { lowerRetainedPageToVectorScene } = await import("../src/retainedVectorPage.ts");
  const encoder = new TextEncoder();
  const defaults = {
    output: "display-program", pageMatrix: [1.23456789012345, .123456789012345, -.234567890123456, .987654321098765, 7.12345678901234, -2.98765432109876],
    pageBounds: { minX: -1_000, minY: -1_000, maxX: 1_000, maxY: 1_000 },
    enableSegmentMerge: false, enableInvisibleCull: false, capturePaintSourceIdentities: true
  };
  const pageInfo = { sourcePageIndex: 0, width: 200, height: 200, mediaBox: [0, 0, 200, 200],
    cropBox: [0, 0, 200, 200], bleedBox: null, trimBox: null, artBox: null, rotation: 0, userUnit: 1 };
  const materialize = compiled => {
    const result = { ...compiled,
      pagePaths: Array.from({ length: densePdfPagePathCount(compiled) }, (_, i) => getDensePdfPagePath(compiled, i)),
      genericPathPaints: Array.from({ length: densePdfGenericPathPaintCount(compiled) }, (_, i) => getDensePdfGenericPathPaint(compiled, i)) };
    delete result.packedRetainedResources;
    return result;
  };
  async function pair(source, options = {}) {
    const input = () => typeof source === "function" ? source() : typeof source === "string" ? encoder.encode(source) : source;
    const legacy = await compileDensePdfContent(input(), { ...defaults, ...options });
    const compact = await compileDensePdfContent(input(), { ...defaults, ...options, compactRetainedResources: true });
    assert(compact.packedRetainedResources, "display-program compilation adopts the packed retained arena");
    assert.equal(compact.pagePaths.length, 0, "packed capture does not also retain the legacy path graph");
    assert.equal(compact.genericPathPaints.length, 0, "packed capture does not also retain legacy paint records");
    assert.deepEqual(materialize(compact), materialize(legacy), "packed resources preserve every compiled value exactly");
    assert.deepEqual(materialize(structuredClone(compact)), materialize(legacy),
      "packed resources remain readable after structured clone across the PDF worker boundary");
    for (let i = 0; i < legacy.paintRuns.length / 3; i++) {
      assert.deepEqual(getDensePdfPaintSourceIdentity(compact, i), getDensePdfPaintSourceIdentity(legacy, i),
        "packing leaves source-order provenance intact");
    }
    return { legacy, compact };
  }
  async function comparePages(legacy, compact, legacyOptions = {}, compactOptions = legacyOptions, lower = true) {
    const before = createHeprPageDataFromDense(pageInfo, legacy, legacyOptions);
    const after = createHeprPageDataFromDense(pageInfo, compact, compactOptions);
    assert.deepEqual(after, before, "compact and legacy resources create byte-identical page stores and display commands");
    validateHeprPageData(after);
    if (lower) {
      assert.deepEqual(await lowerRetainedPageToVectorScene(after, { signal: new AbortController().signal }),
        await lowerRetainedPageToVectorScene(before, { signal: new AbortController().signal }),
        "compact records preserve exact vector lowering");
    }
    return after;
  }

  const variedSource = [
    "0 0 100 100 re W n",
    "1.234567890123 w 2 J 1 j 7.987654321098 M [3.123456789012 1.987654321098] .234567890123 d",
    ".123456789012 .234567890123 .345678901234 rg .876543210987 .765432109876 .654321098765 RG",
    "10 10 m 30 10 l 30 30 l h B*",
    "q .812345678901 .123456789012 -.234567890123 1.123456789012 5.234567890123 6.345678901234 cm",
    "/Split gs 1 J 2 j [7 2 1] .333333333333 d 1 0 0 RG 0 1 0 rg",
    "5 5 m 12 3 19 17 25 25 c 0 25 l h B Q",
    "10 40 m 30 40 l S 10 50 20 10 re f",
    "q 20 20 10 10 re W* n 15 15 20 20 re B Q",
    "0 w [] 0 d 0 70 m 30 70 l S"
  ].join(" ");
  const variedOptions = { extGStates: [{ resourceName: "Split", strokeAlpha: .75, fillAlpha: .375,
    strokeOverprint: true, fillOverprint: false, overprintMode: 1 }] };
  const varied = await pair(variedSource, variedOptions);
  assert(varied.legacy.genericPathPaints.some(p => p.fill && p.stroke), "same-composite B retains both path roles");
  assert(varied.legacy.genericPathPaints.some(p => p.fill && !p.stroke), "different fill alpha retains its own role");
  assert(varied.legacy.genericPathPaints.some(p => !p.fill && p.stroke), "different stroke alpha retains its own role");
  assert(varied.legacy.paintRunCompositeStates.some(s => s.alpha === .375));
  assert(varied.legacy.paintRunCompositeStates.some(s => s.alpha === .75));
  assert(varied.legacy.clipPaths.length >= 2, "persistent clips address compact source paths");
  assert.notEqual(Math.fround(defaults.pageMatrix[0]), getDensePdfPagePath(varied.compact, 0).transform[0],
    "path CTMs retain Float64 precision, rather than rounding to the final GPU format early");
  await comparePages(varied.legacy, varied.compact);

  const hugeIndex = 0x1_0000_0000 + 19;
  const indexed = await pair("/Huge cs .2 .4 .6 sc /Huge CS .6 .4 .2 SC 1 1 20 20 re B", {
    colorSpaceResolver: name => name === "Huge" ? { resourceName: name, colorSpaceIndex: hugeIndex,
      componentCount: 3, initialComponents: [0, 0, 0], convertToSrgb: values => values } : undefined
  });
  const indexedPaint = getDensePdfGenericPathPaint(indexed.compact, 0);
  assert.equal(indexedPaint.fill.sourceColorSpaceIndex, hugeIndex);
  assert.equal(indexedPaint.stroke.sourceColorSpaceIndex, hugeIndex, "transient color metadata does not truncate to Int32");

  const inherited = await pair("2 J 1 j [3.5 1.25] .75 d 10 10 m 30 10 l 30 30 l h B* 40 40 10 10 re f", {
    type3PaintMode: "uncolored"
  });
  for (const paint of materialize(inherited.compact).genericPathPaints) {
    if (paint.fill) assert.equal(paint.fill.inheritType3Paint, true);
    if (paint.stroke) assert.equal(paint.stroke.inheritType3Paint, true);
  }
  const empty = await compileDensePdfContent(new Uint8Array(), defaults);
  const type3Options = compiled => ({ type3: { glyphProgramIndices: new Int32Array(), programs: [{
    compiled, glyphOffset: 0, invocationProgramIndices: new Uint32Array(), matrix: [1, 0, 0, 1, 0, 0],
    bounds: [0, 0, 100, 100], resourceName: "A", colored: false, inheritedPaintRole: "both"
  }] } });
  await comparePages(empty, empty, type3Options(inherited.legacy), type3Options(inherited.compact), false);

  const patterns = new Map([
    ["Colored", { resourceName: "Colored", patternIndex: 0, kind: "colored-tiling", hasExtGState: false }],
    ["Uncolored", { resourceName: "Uncolored", patternIndex: 1, kind: "uncolored-tiling", hasExtGState: false }]
  ]);
  const rgb = { resourceName: "DeviceRGB", colorSpaceIndex: -1, componentCount: 3, initialComponents: [0, 0, 0],
    convertToSrgb: values => values };
  const patterned = await pair("0 0 80 80 re W n /Pattern cs /Colored scn 0 0 20 20 re f " +
    "/PCS CS .2 .4 .6 /Uncolored SCN 1.25 w [3 1] .5 d 30 5 m 50 20 l S", {
    patterns, patternColorSpaces: new Map([["Pattern", { resourceName: "Pattern", baseColorSpace: null }],
      ["PCS", { resourceName: "PCS", baseColorSpace: rgb }]])
  });
  assert.equal(patterned.compact.patternPaints.length, 2);
  const coloredCell = await pair("0 0 1 rg 0 0 5 5 re f");
  const uncoloredCell = await pair("0 0 5 5 re f", { uncoloredPatternPaint: true });
  const patternOptions = packed => ({ patterns: {
    store: { kinds: Uint8Array.of(0, 1), paintTypes: Uint8Array.of(1, 2), tilingTypes: Uint8Array.of(1, 1),
      bounds: Float32Array.of(0, 0, 5, 5, 0, 0, 5, 5), xSteps: Float32Array.of(10, 10), ySteps: Float32Array.of(10, 10),
      matrixIndices: Uint32Array.of(0, 1), programIndices: Int32Array.of(-1, -1), gradientIndices: Int32Array.of(-1, -1),
      underlyingColorSpaceIndices: Int32Array.of(-1, -1) },
    matrices: Float32Array.of(1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0),
    programs: [coloredCell, uncoloredCell].map((p, index) => ({ compiled: packed ? p.compact : p.legacy,
      glyphOffset: 0, invocationProgramIndices: new Uint32Array(), patternIndex: index,
      bounds: [0, 0, 5, 5], resourceName: index ? "Uncolored" : "Colored", colored: index === 0 }))
  } });
  await comparePages(patterned.legacy, patterned.compact, patternOptions(false), patternOptions(true));

  const repeated = "2 J 1 j [2 1] .5 d " + "10 10 m 30 10 l S ".repeat(3);
  const repeatedPair = await pair(repeated);
  assert.equal(densePdfPagePathCount(repeatedPair.compact), 3, "interning does not merge logical source resources");
  assert.equal(repeatedPair.compact.packedRetainedResources.strokeStyles.length, 1,
    "the limits below cover three logical styles represented by one physical style record");
  for (const [limit, value] of [["maxPathResources", 2], ["maxPathVerbs", 5], ["maxPathCoordinates", 11],
    ["maxStrokeStyles", 2], ["maxDashValues", 5]]) {
    for (const compactRetainedResources of [false, true]) {
      await assert.rejects(compileDensePdfContent(encoder.encode(repeated), { ...defaults, compactRetainedResources, [limit]: value }),
        error => error.name === "DensePdfResourceLimitError", `${limit} counts logical resources even when storage is shared`);
    }
  }
  await assert.rejects(compileDensePdfContent(encoder.encode("q 0 0 5 5 re W n Q ".repeat(3)), {
    ...defaults, compactRetainedResources: true, maxClipPaths: 2
  }), error => error.name === "DensePdfResourceLimitError");

  const streamBytes = encoder.encode(variedSource);
  const streamed = await pair(() => ({ async *[Symbol.asyncIterator]() {
    for (let i = 0; i < streamBytes.length; i += 7) yield streamBytes.subarray(i, i + 7);
  } }), { ...variedOptions, totalBytes: streamBytes.length });
  assert.deepEqual(materialize(streamed.compact), materialize(varied.compact), "streaming across tokens preserves compact capture");
  const sourceOffset = 0x8000_0000 + 23;
  const segmentBytes = encoder.encode("10 10 m 20 20 l S");
  const segmented = await pair([{ kind: "content", bytes: segmentBytes, sourceOffset, sourceLength: segmentBytes.length }]);
  assert(getDensePdfPaintSourceIdentity(segmented.compact, 0)[0] > 0x7fff_ffff,
    "prepared segment source offsets preserve their full unsigned range");

  await assert.rejects(compileDensePdfContent(streamBytes, { ...defaults, compactRetainedResources: true,
    signal: AbortSignal.abort() }), { name: "AbortError" });
  const duringStream = new AbortController();
  await assert.rejects(compileDensePdfContent({ async *[Symbol.asyncIterator]() {
    yield encoder.encode("10 10 m 20 20 l S ");
    duringStream.abort();
    yield encoder.encode("30 30 m 40 40 l S ");
  } }, { ...defaults, compactRetainedResources: true, signal: duringStream.signal }), { name: "AbortError" });

  for (const output of ["geometry", "vector-scene"]) {
    const bytes = encoder.encode("0 0 1 RG 2 w 10 10 m 20 20 l S 0 1 0 rg 30 30 10 10 re f");
    const legacy = await compileDensePdfContent(bytes, { ...defaults, output });
    const compactFlag = await compileDensePdfContent(bytes, { ...defaults, output, compactRetainedResources: true });
    assert.equal(compactFlag.packedRetainedResources, undefined, "the retained-only flag leaves direct output adapters alone");
    assert.deepEqual(compactFlag, legacy);
  }
  console.log("Compact retained compiler checks passed: exact paths/CTMs/styles, paint roles, clips, patterns, inherited Type3 paint, large color indexes, logical limits, streaming, cancellation and direct-output compatibility.");
} finally { hooks.deregister(); }
