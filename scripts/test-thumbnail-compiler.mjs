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
  const defaults = { pageMatrix: [1, 0, 0, 1, 0, 0], pageBounds: { minX: -100, minY: -100, maxX: 200, maxY: 200 },
    enableSegmentMerge: false, enableInvisibleCull: false };
  const paints = ["S", "s", "f", "F", "f*", "B", "B*", "b", "b*", "n"];
  const mixedPath = "% path run\r\n-.25 +.5 m 10.25 20.125 l 20 15 30 40 45 50 c 50 55 60 65 v 65 70 75 80 y h 5 6 10 12 re B*";
  const precisePath = "0.123456789012345678901234567890 -0 m 10.123456789012345678901234567890 20.987654321098765432109876543210 l S";
  const tinyDecimal = `0.${"0".repeat(320)}1`;
  const float32Ties = ["1.0000000596046447", "1.000000059604644775390625", "1.0000000596046449",
    "1.000000178813934326171875", "0.5000000298023223876953125", "-1.000000059604644775390625"];
  const valid = [mixedPath, precisePath, `${tinyDecimal} +.5 m 2. 1.000000000000000000000000000001 l S`,
    "q 0 0 40 40 re W n 0 0 m 10 20 l q 2 0 0 3 5 7 cm 2 3 l Q 20 30 l S Q 40 40 2 3 re f",
    // Thumbnail compilation keeps canonical h recovery, including redundant
    // subpath-start operands.
    "0 0 m 10 0 l 10 10 l 0 0 h f",
    ...paints.map(paint => `0 0 m 15 0 l 15 15 l 0 15 l ${paint} 30 30 2 3 re f`),
    ...float32Ties.map(value => `${value} 0 m ${value} 10 l S`)
  ];
  for (const source of valid) {
    for (const output of ["geometry", "display-program", "vector-scene"]) {
      const reference = await compile(source, false, { output });
      const actual = await compile(source, true, { output });
      assert.deepEqual(actual, reference, `${output}: thumbnail path/paint instructions preserve canonical output`);
      const bytes = encoder.encode(source);
      const chunked = await compile(byteChunks(bytes), true, { output });
      assert.deepEqual(chunked, reference, `${output}: every byte boundary preserves path operands and instructions`);
    }
  }
  for (const value of float32Ties) {
    const page = await compile(`${value} 0 m ${value} 10 l S`, true);
    assert.equal(page.endpoints[0], Math.fround(Number(value)), "thumbnail operands preserve Float32 tie-to-even rounding");
    assert.equal(page.endpoints[2], Math.fround(Number(value)));
  }

  // All two-piece splits exercise both the direct source view and the resumed
  // token buffer for correctly rounded long decimals and two-byte paints.
  for (const source of [mixedPath, precisePath]) {
    const bytes = encoder.encode(source), expected = await compile(bytes, false);
    for (let split = 0; split <= bytes.length; split++) {
      const actual = await compile([bytes.subarray(0, split), bytes.subarray(split)], true);
      assert.deepEqual(actual, expected, `two-piece source split at ${split} preserves exact output`);
    }
  }

  const arities = [["m", 2], ["l", 2], ["c", 6], ["v", 4], ["y", 4], ["re", 4], ...paints.map(paint => [paint, 0])];
  for (const [operator, arity] of arities) {
    const prefix = "0 0 m ";
    const numbers = count => Array.from({ length: count }, (_, index) => index + 1).join(" ");
    const malformed = [
      `${prefix}${numbers(arity + 1)} ${operator}`,
      `[${numbers(arity)} ${operator}]`,
      `<< /Path ${operator} >>`
    ];
    if (arity) {
      malformed.push(`${prefix}${numbers(arity - 1)} ${operator}`);
      for (const wrong of ["/Name", "(string)", "<63>", "true", "null", "[1 2]", "<< /Value 1 >>"]) {
        malformed.push(`${prefix}${wrong} ${numbers(arity - 1)} ${operator}`);
      }
    }
    for (const source of malformed) {
      const expected = await rejected(source, false);
      assert(expected instanceof DensePdfSyntaxError);
      const actual = await rejected(byteChunks(encoder.encode(source)), true);
      assert.deepEqual(errorIdentity(actual), errorIdentity(expected), `malformed ${operator} retains the canonical error`);
    }
  }

  const sourceOffset = 0x8000_0000 + 17;
  const tracedSource = paints.map(paint => `0 0 10 10 re ${paint} `).join("");
  const tracedBytes = encoder.encode(tracedSource);
  const traceOptions = { capturePaintSourceIdentities: true };
  const referenceTrace = await compile([{ kind: "content", bytes: tracedBytes, sourceOffset, sourceLength: tracedBytes.length }], false, traceOptions);
  const thumbnailTrace = await compile(Array.from(tracedBytes, (_, index) => ({ kind: "content", bytes: tracedBytes.subarray(index, index + 1),
    sourceOffset: sourceOffset + index, sourceLength: 1 })), true, traceOptions);
  assert.deepEqual(thumbnailTrace, referenceTrace);
  assert(referenceTrace.paintRuns.length > 0);
  for (let index = 0; index < referenceTrace.paintRuns.length / 3; index++) {
    const expected = getDensePdfPaintSourceIdentity(referenceTrace, index);
    assert.deepEqual(getDensePdfPaintSourceIdentity(thumbnailTrace, index), expected, "paint source spans survive thumbnail compilation and chunk resumes");
    assert(expected[0] >= sourceOffset);
    assert(paints.includes(tracedSource.slice(expected[0] - sourceOffset, expected[0] - sourceOffset + expected[1])));
  }

  for (const [source, limits] of [
    ["0 0 m 1 1 l 2 2 l S", { maxPathVerbs: 2 }],
    ["0 0 m 1 1 l S", { maxPathCoordinates: 3 }],
    ["0 0 10 10 re f", { maxPathVerbs: 3 }],
    ["0 0 10 10 re f", { maxPathCoordinates: 7 }],
    ["[2 3] 0 d 0 0 10 10 re S 20 20 10 10 re S", { maxPathResources: 1 }]
  ]) {
    const expected = await rejected(source, false, limits), actual = await rejected(byteChunks(encoder.encode(source)), true, limits);
    assert(expected instanceof DensePdfResourceLimitError);
    assert.deepEqual(errorIdentity(actual), errorIdentity(expected), "thumbnail paths preserve explicit caller resource limits");
  }

  const reason = Error("thumbnail removed");
  for (const thumbnail of [false, true]) {
    const before = new AbortController(); before.abort(reason);
    assert.equal(await rejected(mixedPath, thumbnail, { signal: before.signal }), reason);
    const between = new AbortController();
    const source = { async *[Symbol.asyncIterator]() {
      yield encoder.encode("0 0 m 10 10 l S ");
      between.abort(reason);
      yield encoder.encode("20 20 10 10 re f");
    } };
    assert.equal(await rejected(source, thumbnail, { signal: between.signal }), reason, "cancellation stops adjacent source chunks");
    const finalizing = new AbortController();
    assert.equal(await rejected(mixedPath, thumbnail, { signal: finalizing.signal,
      onProgress(event) { if (event.phase === "finalizing") finalizing.abort(reason); } }), reason,
    "cancellation remains observable when a short path finishes scanning");
  }

  const resourceSource = "0 0 m 10 0 l S BT /F1 12 Tf (A) Tj ET 0 1 m 10 1 l S " +
    "q 2 0 .25 3 4 5 cm BT /F1 8 Tf (B) Tj ET Q 0 0 5 5 re f /GS gs 20 20 m 30 30 l S /Image Do 40 40 3 3 re f";
  const referenceResources = await compileResources(resourceSource, false);
  const thumbnailResources = await compileResources(resourceSource, true);
  assert.deepEqual(comparable(thumbnailResources), comparable(referenceResources),
    "font/graphics/XObject suspension resumes adjacent path instructions exactly once");
  assert.deepEqual(thumbnailResources.loads, ["font:F1", "state:GS", "image:Image"]);
  assert.deepEqual(thumbnailResources.page.referencedFonts, ["F1"]);
  assert.equal(thumbnailResources.page.textShowOpCount, 2);
  console.log("Thumbnail compiler: canonical paint/syntax parity, every-byte/split decimals, malformed operands/containers, source spans, limits, cancellation and shared CTM/resource suspension passed.");

  function compile(source, thumbnail, overrides = {}) {
    return compileDensePdfContent(typeof source === "string" ? encoder.encode(source) : source,
      { ...defaults, output: "display-program", ...overrides, thumbnail });
  }
  async function rejected(source, thumbnail, overrides) {
    try { await compile(source, thumbnail, overrides); } catch (error) { return error; }
    assert.fail(`Expected content compilation to reject (${JSON.stringify(overrides)}): ${String(source).slice(0, 80)}`);
  }
  function errorIdentity(error) { return { name: error.name, message: error.message, operator: error.operator, reason: error.reason }; }
  function comparable(value) {
    // Each compiler owns its DeviceGray converter closure. Compare resource
    // snapshot data, keeping typed pixel/geometry buffers and numeric values.
    if (typeof value === "function") return "[converter]";
    if (ArrayBuffer.isView(value)) return value;
    if (Array.isArray(value)) return value.map(comparable);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, comparable(entry)]));
    return value;
  }
  async function* byteChunks(bytes) { for (let index = 0; index < bytes.length; index++) yield bytes.subarray(index, index + 1); }
  async function compileResources(source, thumbnail) {
    const loads = [], text = [], images = new Map(); let glyph = 0, fontLoaded = false;
    let graphics = [1, 0, 0, 1, 0, 0]; const graphicsStack = [];
    const page = await compile(byteChunks(encoder.encode(source)), thumbnail, {
      imageXObjects: images,
      resourceLoader: {
        async font(name) { loads.push(`font:${name}`); await Promise.resolve(); fontLoaded = true; },
        async extGState(name) { loads.push(`state:${name}`); await Promise.resolve(); return { resourceName: name, strokeAlpha: .5 }; },
        async xObject(name) { loads.push(`image:${name}`); await Promise.resolve(); images.set(name, 0); },
        async markedContentProperty() { assert.fail("unexpected marked-content resource"); },
        async colorSpace() { assert.fail("unexpected named color space"); }
      },
      textOperatorSink: { applyOperator(operator, operands, context) {
        if (operator === "Tf") assert(fontLoaded, "the text engine sees the font only after its suspended resource resolves");
        if (thumbnail) assert.deepEqual(context.graphicsTransform, graphics,
          "thumbnail text hooks receive the exact current CTM, including before q/Q/cm updates");
        text.push({ operator, operands: structuredClone(operands),
          context: { ...structuredClone(context), graphicsTransform: [...graphics] } });
        if (operator === "q") graphicsStack.push([...graphics]);
        else if (operator === "Q") graphics = graphicsStack.pop();
        else if (operator === "cm") {
          assert.deepEqual(operands, [2, 0, .25, 3, 4, 5]);
          graphics = [2, 0, .25, 3, 4, 5];
        }
        if (operator === "Tj") return [{ first: glyph++, count: 1, renderingMode: 0 }];
      } }
    });
    return { page, loads, text };
  }
} finally { hooks.deregister(); }
