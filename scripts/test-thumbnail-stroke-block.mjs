import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { compileDensePdfContent, getDensePdfPaintSourceIdentity, DensePdfSyntaxError, DensePdfResourceLimitError } =
    await import("../src/pdf/nativeContentCompiler.ts");
  const encoder = new TextEncoder();
  const defaults = { pageMatrix: [1, 0, 0, 1, 0, 0], pageBounds: { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 },
    output: "display-program", thumbnail: true, thumbnailScale: .2, enableSegmentMerge: false, enableInvisibleCull: false };
  const tokens = ["q", "1", "0", "0", "1", "5", "7", "cm", ".25", "w", "0", "j", "1", "J", "2", "3", "m", "40", "50", "l", "S", "Q"];
  const block = (...changes) => {
    const values = [...tokens]; for (const [index, value] of changes) values[index] = value;
    return `${values.join(" ")} `;
  };
  const ordinary = block();
  const grayBlock = (gray, ...changes) => block(...changes).replace("cm ", `cm ${gray} G `);
  const polyline = (source, extras) => source.replace(" l S", ` l ${extras} S`);
  await parity(ordinary);
  const precise = block([1, "1.000000059604644775390625"], [2, "-.123456789012345678901"],
    [5, "+0.0000000000000000000000000001"], [6, "-0"], [8, "0.123456789012345"],
    [14, "1.000000178813934326171875"], [15, "-0"], [17, "40.000000000000000000000001"]);
  const cases = [
    ordinary, precise, grayBlock(".25"), grayBlock("-0"), grayBlock("-1"), grayBlock("2"),
    grayBlock("1.000000059604644775390625"),
    block([1, "-0"], [2, "+0"], [3, "+.5"], [4, "2."], [8, "0"]),
    block([1, "1"], [2, "1"], [3, "1"], [4, "1"]),
    block([14, `0.${"0".repeat(320)}1`]),
    block([8, "8"], [10, "2"], [12, "2"]),
    `${ordinary}${ordinary}0 80 m 40 80 l S`,
    polyline(ordinary, "60 70 l 80 90 l"),
    polyline(grayBlock(".2"), "1.000000059604644775390625 -0 l 40 50 l"),
    polyline(block([8, "8"], [10, "2"]), "60 70 l 80 90 l"),
    `/Pattern CS /Colored SCN ${polyline(ordinary, "60 70 l 80 90 l")}/Form Do`,
    polyline(ordinary, Array.from({ length: 20 }, (_, index) => `${index + 100} ${index + 200} l`).join(" ")),
    `2 w 2 j 2 J .2 .3 .4 RG ${ordinary}0 80 m 40 80 l S /Form Do`,
    `[2 3] 1 d 8 w .4 G ${block([8, "8"])}0 80 m 40 80 l S /Form Do`,
    `/Alpha gs ${ordinary}0 80 m 40 80 l S`,
    `/Pattern CS /Colored SCN ${ordinary}0 80 m 40 80 l S`,
    `/Pattern CS /Colored SCN ${grayBlock(".25")}0 80 m 40 80 l S ${grayBlock(".8")}/Form Do`,
    `.1 G ${grayBlock(".2")}${grayBlock(".3")}0 80 m 40 80 l S`,
    `q .1 G ${grayBlock(".2")}q .3 G ${grayBlock(".4")}Q ${grayBlock(".5")}Q /Form Do`,
    `q .2 .3 .4 RG /Alpha gs 2 0 0 3 11 13 cm ${ordinary}/Form Do Q /Form Do`,
    `q 1 0 0 1 100 200 cm 3 w 2 j 2 J q [2 3] 0 d ${ordinary}Q /Form Do Q /Form Do`,
    `0 0 100 100 re W n ${ordinary}0 0 120 120 re f`,
    `q 0 0 100 100 re W* n ${ordinary}Q ${ordinary}`,
    // The PDF current path is not saved by q/Q. A pending path/clip must
    // retain the generic dispatcher's rebase and combined-paint behavior.
    `-10 -20 m ${ordinary}0 80 m 40 80 l S`,
    `0 0 100 100 re W ${ordinary}0 0 120 120 re f`,
    `BT /F1 12 Tf (A) Tj ${ordinary}(B) Tj ET ${ordinary}`,
    `BT /F1 12 Tf 7 Tr (A) Tj ${ordinary}ET ${ordinary}`,
    `BT /F1 12 Tf q /F2 8 Tf ${ordinary}(A) Tj Q (B) Tj ET /Form Do`,
    ordinary.replaceAll(" ", "\x00\t\n\f\r "),
    ordinary.replaceAll(" ", " % ordinary comment\r\n"),
    ordinary.replace(".25 w", ".25 w .4 G"),
    ordinary.replace(".25 w", ".25 w .4 g"),
    ordinary.replace(".25 w", ".25 w 1 0 0 RG"),
    ordinary.replace(".25 w", ".25 w [2 3] 0 d"),
    ordinary.replace(" S ", " s "),
    `${ordinary}% trailing comment without newline`,
    `${ordinary}/Form Do`
  ];
  for (const source of cases) {
    for (const output of ["geometry", "display-program", "vector-scene"]) {
      await parity(source, { output, ...resources() });
    }
    await parity(source, { compactRetainedResources: true, ...resources() });
  }

  for (const source of [ordinary, precise, grayBlock(".1234567890123456789012345"), `${ordinary}${ordinary}/Form Do`,
    polyline(grayBlock(".2"), "1.000000059604644775390625 -0 l 80 90 l")]) {
    const bytes = encoder.encode(source), expected = await compile(bytes, false, resources());
    for (let split = 0; split <= bytes.length; split++) {
      assert.deepEqual(comparable(await compile([bytes.subarray(0, split), bytes.subarray(split)], true, resources())),
        comparable(expected), `stroke block preserves output and save/text hooks at byte split ${split}`);
    }
    assert.deepEqual(comparable(await compile(byteChunks(bytes), true, resources())), comparable(expected),
      "every-byte chunks retain the ordinary lexer's exact decimal conversion and boundaries");
  }

  const grayCalls = [], grayReferenceCalls = [];
  const colorResolver = calls => name => {
    calls.push(["resolve", name]);
    if (name !== "DeviceGray") return undefined;
    return { resourceName: "HostDefaultGray", colorSpaceIndex: 11, componentCount: 1, initialComponents: [.2],
      convertToSrgb(components) { calls.push(["convert", [...components]]); return [components[0] / 2, .25, .75]; } };
  };
  const coloredSource = `.1 G ${grayBlock(".2")}${grayBlock(".8")}0 80 m 40 80 l S /Form Do`;
  const colored = await compile(coloredSource, true, { colorSpaceResolver: colorResolver(grayCalls) });
  const coloredReference = await compile(coloredSource, false, { colorSpaceResolver: colorResolver(grayReferenceCalls) });
  assert.deepEqual(comparable(colored), comparable(coloredReference), "fast G honors host DeviceGray conversion and restores outer RGB/source color space");
  assert.deepEqual(grayCalls, grayReferenceCalls, "G uses the normal resolver/converter exactly once per source operator");
  assert(colored.page.referencedColorSpaces.includes("DeviceGray"));
  assert.equal(colored.page.formPaints[0].initialGraphicsState.strokeColorSpace.colorSpaceIndex, 11);
  const retainedMatrices = await compile(`[2 3] 0 d ${grayBlock(".2", [8, "8"], [10, "2"])}${grayBlock(".8", [5, "100"], [6, "200"], [8, "9"], [10, "2"])}`,
    true, resources());
  assert.deepEqual(retainedMatrices.page.pagePaths[0].transform, [1, 0, 0, 1, 5, 7]);
  assert.deepEqual(retainedMatrices.page.pagePaths[1].transform, [1, 0, 0, 1, 100, 200]);
  assert.notEqual(retainedMatrices.page.pagePaths[0].transform, retainedMatrices.page.pagePaths[1].transform,
    "retained paths own matrix snapshots rather than the scanner's reusable scratch array");

  const malformed = [
    `[${ordinary}]`, `<< /Value ${ordinary}>>`, `(${ordinary}) S`, `<71> ${ordinary}`,
    `true ${ordinary}`, `/Name ${ordinary}`, `1 ${ordinary}`, `${ordinary}Q`,
    ordinary.replace("Q ", "QX "), ordinary.replace("q ", "qX "),
    ordinary.replace("cm ", "cmX "), ordinary.replace("S ", "SX "),
    ordinary.replace("cm ", "cm%comment\n"),
    block([8, "-1"]), block([10, "-.5"]), block([10, "3"]), block([12, "-1"]), block([12, "2.5"]),
    ...["/Name", "true", "[.5]", ".1.2", "1e2"].map(gray => grayBlock(gray)),
    ...["20 l", "20 30 40 l", "20 /Name l", "20 30 m", "20 30 lX", "20 30 l 1.2.3 1 l", "20 30 l %comment\n"].map(extras => polyline(ordinary, extras)),
    block([1, "9".repeat(320)]), block([1, `1${"0".repeat(160)}`], [4, `1${"0".repeat(160)}`])
  ];
  for (const index of [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 15, 17, 18]) {
    for (const value of ["/Name", "(string)", "[1 2]", "<< /Value 1 >>", "true", "null", "1.2.3", "+", "1e2"]) malformed.push(block([index, value]));
  }
  for (const index of [0, 7, 9, 11, 13, 16, 19, 20, 21]) {
    const removed = [...tokens]; removed.splice(index, 1); malformed.push(`${removed.join(" ")} `);
    const extra = [...tokens]; extra.splice(index, 0, "123"); malformed.push(`${extra.join(" ")} `);
  }
  for (const source of malformed) {
    // Some mutations remain valid PDF; compare both successful compilation
    // and exact error identities rather than presupposing malformed arity.
    await parity(source, resources());
    await parity(byteChunks(encoder.encode(source)), resources());
  }
  const huge = `1${"0".repeat(200)}`;
  const overflowing = `q ${huge} 0 0 ${huge} 0 0 cm ${block([1, huge], [4, huge])}Q`;
  const overflow = await outcome(overflowing, true), overflowReference = await outcome(overflowing, false);
  assert(overflow.error instanceof DensePdfSyntaxError);
  assert.deepEqual(errorIdentity(overflow.error), errorIdentity(overflowReference.error), "an overflowing inherited CTM falls back to the normal transform error");

  for (const [source, limits] of [
    [ordinary, { maxPathVerbs: 1 }], [ordinary, { maxPathCoordinates: 3 }],
    [polyline(ordinary, "60 70 l 80 90 l"), { maxPathVerbs: 3 }],
    [polyline(ordinary, "60 70 l 80 90 l"), { maxPathCoordinates: 7 }],
    [`[2 3] 0 d ${block([8, "8"], [10, "2"])}${block([8, "9"], [10, "2"])}`, { maxPathResources: 1 }],
    [`[2 3] 0 d ${block([8, "8"], [10, "2"])}${block([8, "9"], [10, "2"])}`, { maxStrokeStyles: 1 }],
    [`[2 3] 0 d ${block([8, "8"], [10, "2"])}`, { maxDashValues: 1 }]
  ]) {
    const expected = await outcome(source, false, limits), actual = await outcome(source, true, limits);
    assert(expected.error instanceof DensePdfResourceLimitError, "explicit caller limits are exercised by the fixture");
    assert.deepEqual(errorIdentity(actual.error), errorIdentity(expected.error));
  }
  const nesting = await outcome(`q ${ordinary}Q`, true, { maxSinkDepth: 1 });
  const nestingReference = await outcome(`q ${ordinary}Q`, false, { maxSinkDepth: 1 });
  assert(nesting.error instanceof DensePdfResourceLimitError);
  assert.deepEqual(errorIdentity(nesting.error), errorIdentity(nestingReference.error), "block scanning preserves the external text stack limit");
  let restoredAfterLimit = 0;
  const limited = await outcome(ordinary, true, { maxPathVerbs: 1, onRestore() { restoredAfterLimit++; } });
  assert(limited.error instanceof DensePdfResourceLimitError);
  assert.equal(restoredAfterLimit, 1, "a failure after native save restores external text state in finally");

  // Explicit provenance disables the root-only scanner and continues to
  // report exact source positions, including the paint immediately afterward.
  const offset = 0x8000_0000 + 31, traced = `${ordinary}0 80 m 40 80 l S `, tracedBytes = encoder.encode(traced);
  const trace = await compile([{ kind: "content", bytes: tracedBytes, sourceOffset: offset, sourceLength: tracedBytes.length }],
    true, { capturePaintSourceIdentities: true });
  for (let index = 0; index < trace.page.paintRuns.length / 3; index++) {
    const [start, length] = getDensePdfPaintSourceIdentity(trace.page, index);
    assert.equal(traced.slice(start - offset, start - offset + length), "S");
  }
  const nextPaint = getDensePdfPaintSourceIdentity(trace.page, trace.page.paintRuns.length / 3 - 1);
  assert.equal(nextPaint[0], offset + traced.lastIndexOf("S"));
  for (const limits of [{ type3PaintMode: "colored" }, { type3PaintMode: "uncolored" }, { uncoloredPatternPaint: true },
    { thumbnailScale: undefined }, { thumbnail: false }]) {
    await parity(grayBlock(".5"), limits);
  }

  for (const mode of [false, true]) {
    const reason = Error("thumbnail removed"), before = new AbortController(); before.abort(reason);
    assert.equal((await outcome(ordinary, mode, { signal: before.signal })).error, reason);
    const saved = new AbortController();
    assert.equal((await outcome(`${ordinary}${ordinary}`, mode, { signal: saved.signal,
      onSave() { saved.abort(reason); } })).error, reason, "cancellation from an external state hook remains observable");
    const between = new AbortController();
    const source = { async *[Symbol.asyncIterator]() { yield encoder.encode(ordinary); between.abort(reason); yield encoder.encode(ordinary); } };
    assert.equal((await outcome(source, mode, { signal: between.signal })).error, reason);
    const finalizing = new AbortController();
    assert.equal((await outcome(ordinary, mode, { signal: finalizing.signal,
      onProgress(event) { if (event.phase === "finalizing") finalizing.abort(reason); } })).error, reason);
  }

  const resourceSource = `${ordinary}BT /F1 12 Tf (A) Tj ET ${ordinary}/Alpha gs ${ordinary}/Form Do ${ordinary}`;
  const streamed = await compile(resourceSource, true, { streamed: true, ...resources() });
  const streamedReference = await compile(resourceSource, false, { streamed: true, ...resources() });
  assert.deepEqual(comparable(streamed), comparable(streamedReference), "font/ExtGState/Form suspension resumes neighboring stroke blocks exactly once");
  assert.deepEqual(streamed.loads, ["font:F1", "state:Alpha", "form:Form"]);
  console.log("Thumbnail stroke blocks: exact geometry/state/hooks, numeric and chunk boundaries, malformed syntax, inherited paint/clip/text/Form state, limits, provenance, cancellation and resource suspension passed.");

  async function parity(source, overrides = {}) {
    // Iterators must be replayable for the second compiler.
    if (source?.[Symbol.asyncIterator]) {
      const chunks = []; for await (const chunk of source) chunks.push(chunk); source = chunks;
    }
    const expected = await outcome(source, false, overrides), actual = await outcome(source, true, overrides);
    if (expected.error || actual.error) assert.deepEqual(errorIdentity(actual.error), errorIdentity(expected.error));
    else assert.deepEqual(comparable(actual.value), comparable(expected.value));
  }
  async function outcome(source, scanner, overrides) {
    try { return { value: await compile(source, scanner, overrides) }; } catch (error) { return { error }; }
  }
  function compile(source, scanner, overrides = {}) {
    const events = [], loads = [], stack = [];
    let font, glyph = 0, mode = 0;
    const { maxSinkDepth = Infinity, onSave, onRestore, streamed, ...options } = overrides;
    const save = () => {
      if (stack.length >= maxSinkDepth) throw new DensePdfResourceLimitError("Synthetic text stack depth exceeded.", "q");
      stack.push({ font, mode }); events.push("q"); onSave?.();
    };
    const restore = () => {
      events.push("Q"); const state = stack.pop();
      if (state) { font = state.font; mode = state.mode; }
      onRestore?.();
    };
    const formXObjects = new Map(streamed ? [] : [["Form", 0]]);
    const textOperatorSink = {
      ...(scanner ? { externalGraphicsState: { save, restore } } : {}),
      getFontSelection() { return font; },
      applyOperator(operator, operands, context) {
        if (operator === "q") { save(); return; }
        if (operator === "Q") { restore(); return; }
        // Internal thumbnail text engines borrow context.graphicsTransform;
        // their regular cm callback has no separate transformation to apply.
        if (operator === "cm") return;
        events.push({ operator, operands: structuredClone(operands), context: structuredClone(context) });
        if (operator === "Tf") font = { resourceName: operands[0].value ?? operands[0], size: operands[1] };
        if (operator === "Tr") mode = operands[0];
        if (operator === "Tj") return [{ first: glyph++, count: 1, renderingMode: mode }];
      }
    };
    const resourceLoader = streamed ? {
      async font(name) { loads.push(`font:${name}`); await Promise.resolve(); },
      async extGState(name) { loads.push(`state:${name}`); await Promise.resolve(); return resources().extGStates[0]; },
      async xObject(name) { loads.push(`form:${name}`); await Promise.resolve(); formXObjects.set(name, 0); },
      async markedContentProperty() { assert.fail("unexpected property"); },
      async colorSpace() { assert.fail("unexpected color space"); }
    } : undefined;
    return compileDensePdfContent(typeof source === "string" ? encoder.encode(source) : source,
      { ...defaults, ...options, formXObjects, textOperatorSink, ...(resourceLoader ? { extGStates: [], resourceLoader } : {}) })
      .then(page => ({ page, events, loads, remainingDepth: stack.length }));
  }
  function resources() {
    return { extGStates: [{ resourceName: "Alpha", strokeAlpha: .5, fillAlpha: .75 }],
      patterns: new Map([["Colored", { resourceName: "Colored", patternIndex: 0, kind: "colored-tiling", hasExtGState: false }]]),
      patternColorSpaces: new Map([["Pattern", { resourceName: "Pattern", baseColorSpace: null }]]) };
  }
  function comparable(value) {
    if (typeof value === "function") return "[converter]";
    if (ArrayBuffer.isView(value)) return value;
    if (Array.isArray(value)) return value.map(comparable);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, comparable(entry)]));
    return value;
  }
  function errorIdentity(error) { return error && { name: error.name, message: error.message, operator: error.operator, reason: error.reason }; }
  async function* byteChunks(bytes) { for (let index = 0; index < bytes.length; index++) yield bytes.subarray(index, index + 1); }
} finally { hooks.deregister(); }
