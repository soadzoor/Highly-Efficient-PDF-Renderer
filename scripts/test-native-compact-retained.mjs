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

  const previewSource = "2 J [3 1] .5 d 10 10 m 30 10 l S 10 20 m 30 20 l S " +
    "q 2 .25 .5 .75 5 6 cm 10 30 m 30 30 l S Q 10 40 m 30 40 l S";
  const preview = await pair(previewSource, { thumbnail: true });
  const ordinary = await compileDensePdfContent(encoder.encode(previewSource), {
    ...defaults, compactRetainedResources: true
  });
  assert.equal(ordinary.packedRetainedResources.matrices.length, 2,
    "canonical capture continues globally interning equal CTMs");
  assert.equal(preview.compact.packedRetainedResources.matrices.length, 3,
    "thumbnail compiler forwards its disposable-capture policy");
  assert.deepEqual(materialize(preview.compact), materialize(ordinary),
    "thumbnail capture changes neither anisotropic/sheared stroke geometry nor exact clip and paint state");
  await comparePages(ordinary, preview.compact);
  const previewVaried = await pair(variedSource, { ...variedOptions, thumbnail: true });
  await comparePages(varied.legacy, previewVaried.compact);

  const translatedSource = "2 J .75 w [3 1] .5 d " +
    ["10 20", "30 40", "50 60"].map(translation =>
      `q 1 0 0 1 ${translation} cm 1 1 m 4 1 l S Q`).join(" ");
  const translated = await pair(translatedSource, { pageMatrix: [1, 0, 0, 1, 0, 0], thumbnail: true });
  const translatedCanonical = createHeprPageDataFromDense(pageInfo, translated.compact);
  const translatedThumbnail = createHeprPageDataFromDense(pageInfo, translated.compact, { thumbnail: true });
  validateHeprPageData(translatedThumbnail);
  assert.equal(translatedCanonical.stores.transforms.values.length / 6, 4);
  assert.equal(translatedThumbnail.stores.transforms.values.length / 6, 1,
    "translated thumbnail paths share the identity transform");
  assert.equal(translatedCanonical.stores.strokes.lineWidths.length, 3);
  assert.equal(translatedThumbnail.stores.strokes.lineWidths.length, 1,
    "identical packed stroke styles share one thumbnail style record");
  assert.deepEqual([...translatedThumbnail.stores.strokes.dashValues], [3, 1]);
  assert.deepEqual([...translatedThumbnail.stores.paths.coordinates], [11, 21, 14, 21, 31, 41, 34, 41, 51, 61, 54, 61]);
  assert.equal(translatedThumbnail.displayProgram.groups[0].commands.length, 1);
  assert.equal(translatedThumbnail.displayProgram.groups[0].commands[0].count, 3,
    "contiguous paths with identical execution state share command dispatch");
  await compareLoweredGeometry(translatedCanonical, translatedThumbnail);
  assert.deepEqual(createHeprPageDataFromDense(pageInfo, translated.compact), translatedCanonical,
    "thumbnail adaptation cannot mutate the compiled source or subsequent canonical output");

  const clippedTranslated = await pair("2 J q 1 0 0 1 20 30 cm 0 0 10 10 re W n " +
    "-5 5 m 15 5 l S 2 2 m 8 8 l S Q", { pageMatrix: [1, 0, 0, 1, 0, 0], thumbnail: true });
  const clippedCanonical = createHeprPageDataFromDense(pageInfo, clippedTranslated.compact);
  const clippedThumbnail = createHeprPageDataFromDense(pageInfo, clippedTranslated.compact, { thumbnail: true });
  validateHeprPageData(clippedThumbnail);
  assert.deepEqual([...clippedThumbnail.stores.clips.transformIndices], [0],
    "translated persistent clips use their baked path with the shared identity transform");
  await compareLoweredGeometry(clippedCanonical, clippedThumbnail);

  const rotated = await pair(translatedSource, { pageMatrix: [0, 1, -1, 0, 100, 0], thumbnail: true });
  const rotatedCanonical = createHeprPageDataFromDense(pageInfo, rotated.compact);
  const rotatedThumbnail = createHeprPageDataFromDense(pageInfo, rotated.compact, { thumbnail: true });
  assert.deepEqual(rotatedThumbnail.stores.paths.coordinates, rotatedCanonical.stores.paths.coordinates,
    "rotated CTMs retain their original path coordinates");
  await compareLoweredGeometry(rotatedCanonical, rotatedThumbnail);

  const formRoot = { compact: await compileDensePdfContent(encoder.encode("/Form Do"), { ...defaults,
    pageMatrix: [1, 0, 0, 1, 0, 0], formXObjects: new Map([["Form", 0]]), compactRetainedResources: true }) };
  const formOptions = { forms: {
    rootInvocationProgramIndices: Uint32Array.of(0), annotations: [],
    programs: [{ compiled: translated.compact, glyphOffset: 0, invocationProgramIndices: new Uint32Array(),
      matrix: [0, 1, -1, 0, 100, 0], bounds: [0, 0, 100, 100], resourceName: "Form" }]
  } };
  const formCanonical = createHeprPageDataFromDense(pageInfo, formRoot.compact, formOptions);
  const formThumbnail = createHeprPageDataFromDense(pageInfo, formRoot.compact, { ...formOptions, thumbnail: true });
  validateHeprPageData(formThumbnail);
  assert.equal(formThumbnail.displayProgram.programs[0].commands.length, 1,
    "thumbnail state sharing also applies inside reusable Forms");
  await compareLoweredGeometry(formCanonical, formThumbnail);

  const alpha = await pair("2 J /Alpha gs " + translatedSource, { pageMatrix: [1, 0, 0, 1, 0, 0],
    extGStates: [{ resourceName: "Alpha", strokeAlpha: .5 }], thumbnail: true });
  const alphaThumbnail = createHeprPageDataFromDense(pageInfo, alpha.compact, { thumbnail: true });
  assert.equal(alphaThumbnail.displayProgram.groups.length, 4);
  assert(alphaThumbnail.displayProgram.groups.slice(1).every(group => group.alpha === .5 && group.commands[0].count === 1),
    "translucent strokes retain independent compositing boundaries when paths overlap");

  const overflow = materialize(translated.legacy);
  overflow.pagePaths[0] = { ...overflow.pagePaths[0], transform: [1, 0, 0, 1, 3e38, 0],
    data: Float32Array.of(0, 3e38, 1, 1, 3e38, 2) };
  const overflowThumbnail = createHeprPageDataFromDense(pageInfo, overflow, { thumbnail: true });
  assert.equal(overflowThumbnail.stores.paths.pathVerbOffsets.length - 1, 3,
    "translation overflow rolls back the temporary path before keeping the original CTM");
  assert.equal(overflowThumbnail.stores.paths.coordinates[0], Math.fround(3e38));
  assert.equal(overflowThumbnail.stores.transforms.values[10], Math.fround(3e38));

  const thinLines = "2 J .25 w 1 0 0 RG " + ["10 20", "30 40", "50 60"].map(translation =>
    `q 1 0 0 1 ${translation} cm 1 1 m 4 1 l S Q`).join(" ");
  const thin = await compileDensePdfContent(encoder.encode(thinLines), { ...defaults,
    pageMatrix: [1, 0, 0, 1, 0, 0], compactRetainedResources: true, thumbnail: true, thumbnailScale: .1 });
  assert.equal(thin.segmentCount, 3);
  assert.equal(densePdfPagePathCount(thin), 0, "thin isolated preview lines can stay in the dense stroke store");
  const thinUnmerged = createHeprPageDataFromDense(pageInfo, thin);
  const thinMerged = createHeprPageDataFromDense(pageInfo, thin, { thumbnail: true });
  validateHeprPageData(thinMerged);
  assert.equal(thinUnmerged.displayProgram.groups[0].commands.length, 3);
  assert.deepEqual(thinMerged.displayProgram.groups[0].commands.map(command => [command.source, command.first, command.count]),
    [["stroke-segments", 0, 3]], "contiguous same-state packed strokes share thumbnail command dispatch");
  assert.deepEqual(thinMerged.stores, thinUnmerged.stores,
    "merging packed commands retains every primitive's geometry, width, alpha, and clipping flags");
  await compareLoweredGeometry(thinUnmerged, thinMerged);
  const coalescedThin = await compileDensePdfContent(encoder.encode(thinLines), { ...defaults,
    pageMatrix: [1, 0, 0, 1, 0, 0], compactRetainedResources: true, thumbnail: true, thumbnailScale: .1,
    capturePaintSourceIdentities: false });
  assert.equal(coalescedThin.pathPaints.length, 1,
    "root previews without provenance do not allocate duplicate same-color packed paint records");
  assert.deepEqual([...coalescedThin.paintRuns], [thin.paintRuns[0], 0, 3]);
  const coalescedThinPage = createHeprPageDataFromDense(pageInfo, coalescedThin, { thumbnail: true });
  assert.deepEqual(coalescedThinPage.stores, thinMerged.stores);
  await compareLoweredGeometry(thinUnmerged, coalescedThinPage);
  const differentScopes = await compileDensePdfContent(encoder.encode("2 J .25 w " +
    "q 0 0 100 100 re W n 10 10 m 20 10 l S Q 10 20 m 20 20 l S"), { ...defaults,
    pageMatrix: [1, 0, 0, 1, 0, 0], compactRetainedResources: true, thumbnail: true, thumbnailScale: .1,
    capturePaintSourceIdentities: false });
  assert.equal(differentScopes.pathPaints.length, 2, "root preview coalescing preserves different persistent clip scopes");

  const colorSeparated = await compileDensePdfContent(encoder.encode(thinLines +
    " 0 0 1 RG 5 5 m 8 5 l S 1 0 0 RG 6 6 m 9 6 l S"), { ...defaults,
    pageMatrix: [1, 0, 0, 1, 0, 0], compactRetainedResources: true, thumbnail: true, thumbnailScale: .1,
    capturePaintSourceIdentities: false });
  const colorPage = createHeprPageDataFromDense(pageInfo, colorSeparated, { thumbnail: true });
  assert.deepEqual(colorPage.displayProgram.groups[0].commands.map(command => [command.first, command.count]), [[0, 3], [3, 1], [4, 1]],
    "packed stroke command merging cannot cross intervening paint colors or reorder earlier strokes");
  const thinAlpha = await compileDensePdfContent(encoder.encode("/Alpha gs " + thinLines), { ...defaults,
    pageMatrix: [1, 0, 0, 1, 0, 0], compactRetainedResources: true, thumbnail: true, thumbnailScale: .1,
    capturePaintSourceIdentities: false, extGStates: [{ resourceName: "Alpha", strokeAlpha: .5 }] });
  const thinAlphaPage = createHeprPageDataFromDense(pageInfo, thinAlpha, { thumbnail: true });
  assert.equal(thinAlphaPage.displayProgram.groups.length, 4,
    "packed translucent strokes retain independent compositing groups");

  const previewLine = (source, options = {}) => compileDensePdfContent(encoder.encode(source), { ...defaults,
    pageMatrix: [1, 0, 0, 1, 0, 0], compactRetainedResources: true, thumbnail: true, thumbnailScale: 1,
    capturePaintSourceIdentities: false, ...options });
  const approximations = [];
  const isolated = await previewLine("2 J 2 j 3 M /Adjust gs .5 w 10 10 m 20 10 l S 10 20 m 20 20 l S", {
    extGStates: [{ resourceName: "Adjust", strokeAdjustment: true }],
    onDiagnostic: diagnostic => approximations.push(diagnostic)
  });
  assert.equal(isolated.segmentCount, 2);
  assert.equal(densePdfPagePathCount(isolated), 0,
    "subpixel isolated strokes can ignore nonparticipating joins and retain approximate square-cap/adjusted pens compactly");
  assert.equal(isolated.pathPaints.length, 1);
  assert((Math.trunc(isolated.primitiveMeta[3] / 2 + 1e-6) & (1 << 1)) !== 0,
    "the preview square-cap approximation stores an explicit round-cap flag");
  assert.equal(approximations.filter(diagnostic => diagnostic.code === "thumbnail.stroke-approximation").length, 1,
    "square-cap and stroke-adjustment approximations are diagnosed once per compilation");
  const canonicalIsolated = await previewLine("2 J 2 j 3 M .5 w 10 10 m 20 10 l S", {
    thumbnail: false, thumbnailScale: undefined
  });
  assert.equal(canonicalIsolated.segmentCount, 0);
  assert.equal(densePdfPagePathCount(canonicalIsolated), 1, "full-quality canonical square caps remain generic exact paths");
  const nestedIsolated = await previewLine("2 J .5 w 10 10 m 20 10 l S", { thumbnailScale: undefined });
  assert.equal(nestedIsolated.segmentCount, 0,
    "thumbnail state sharing alone does not enable root-only pen approximation in nested Forms or soft masks");
  for (const [label, source, options] of [
    ["thick", "2 J 2 w 10 10 m 20 10 l S", {}],
    ["dashed", "2 J .5 w [2 1] .25 d 10 10 m 20 10 l S", {}],
    ["anisotropic", "2 J .25 w 10 10 m 20 10 l S", { pageMatrix: [2, 0, 0, 1, 0, 0] }]
  ]) {
    const retained = await previewLine(source, options);
    assert.equal(retained.segmentCount, 0, `${label} strokes stay on their exact generic path`);
    assert.equal(densePdfPagePathCount(retained), 1);
  }
  const nearClip = await previewLine("0 0 10 10 re W n 2 J .1 w -.25 2 m -.25 8 l S");
  assert.equal(nearClip.segmentCount, 1,
    "a widened subpixel pen can remain visible when its centerline lies just outside the clip");
  assert.equal(nearClip.clipPaths.length, 1);
  assert.equal(nearClip.paintRunClipIndices[0], 0, "compact preview strokes retain their exact persistent clip reference");
  assert((Math.trunc(nearClip.primitiveMeta[3] / 2 + 1e-6) & (1 << 2)) !== 0,
    "the packed stroke preserves its clipping flag and bounds");

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

async function compareLoweredGeometry(before, after) {
  const { lowerRetainedPageToVectorScene } = await import("../src/retainedVectorPage.ts");
  const canonical = await lowerRetainedPageToVectorScene(before, { signal: new AbortController().signal });
  const thumbnail = await lowerRetainedPageToVectorScene(after, { signal: new AbortController().signal });
  for (const field of ["endpoints", "primitiveMeta", "primitiveBounds", "styles", "fillSegmentsA", "fillSegmentsB",
    "fillPathMetaA", "fillPathMetaB", "fillPathMetaC", "clipPaths"]) {
    assert.deepEqual(thumbnail[field], canonical[field], `thumbnail adapter preserves ${field}`);
  }
  const orderedPrimitives = scene => scene.drawRuns.flatMap(({ first, count, ...state }) =>
    Array.from({ length: count }, (_, offset) => ({ ...state, index: first + offset })));
  assert.deepEqual(orderedPrimitives(thumbnail), orderedPrimitives(canonical),
    "thumbnail adapter preserves per-primitive paint order and execution state across equivalent run ranges");
}
