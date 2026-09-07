import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

const { openNativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
const {
  DEFAULT_NATIVE_PDF_FUNCTION_LIMITS,
  NativePdfFunctionRegistry
} = await import("../src/pdf/nativeFunctions.ts");
const { PdfError } = await import("../src/pdf/nativeTypes.ts");

const encoder = new TextEncoder();

function ref(objectNumber) {
  return { kind: "ref", objectNumber, generation: 0 };
}

function dictionary(entries) {
  return new Map(Object.entries(entries));
}

function stream(entries, bytes = new Uint8Array(0)) {
  return {
    kind: "stream",
    dictionary: dictionary(entries),
    bytes: typeof bytes === "string" ? encoder.encode(bytes) : bytes
  };
}

function exponential({
  domain = [0, 1],
  range = [0, 1],
  c0 = [0],
  c1 = [1],
  exponent = 1
} = {}) {
  const entries = { FunctionType: 2, Domain: domain, N: exponent, C0: c0, C1: c1 };
  if (range !== null) entries.Range = range;
  return dictionary(entries);
}

function sampled({
  domain = [0, 1],
  range = [0, 1],
  size = [2],
  bits = 8,
  values = [0, (2 ** bits) - 1],
  encode,
  decode,
  order
} = {}) {
  const entries = { FunctionType: 0, Domain: domain, Range: range, Size: size, BitsPerSample: bits };
  if (encode !== undefined) entries.Encode = encode;
  if (decode !== undefined) entries.Decode = decode;
  if (order !== undefined) entries.Order = order;
  return stream(entries, packUnsignedSamples(values, bits));
}

function stitching({
  domain = [0, 1],
  range = [0, 1],
  functions,
  bounds = [],
  encode = [0, 1]
}) {
  const entries = {
    FunctionType: 3,
    Domain: domain,
    Functions: functions,
    Bounds: bounds,
    Encode: encode
  };
  if (range !== null) entries.Range = range;
  return dictionary(entries);
}

function calculator(program, outputCount = 1, rangePair = [-10_000_000_000, 10_000_000_000]) {
  return stream({
    FunctionType: 4,
    Domain: [0, 1],
    Range: Array.from({ length: outputCount }, () => rangePair).flat()
  }, program);
}

function packUnsignedSamples(values, bitsPerSample) {
  const output = new Uint8Array(Math.ceil(values.length * bitsPerSample / 8));
  let bitOffset = 0;
  for (const value of values) {
    assert(Number.isSafeInteger(value) && value >= 0 && value <= (2 ** bitsPerSample) - 1);
    for (let bit = bitsPerSample - 1; bit >= 0; bit -= 1) {
      const set = Math.floor(value / (2 ** bit)) % 2;
      if (set) output[bitOffset >>> 3] |= 1 << (7 - (bitOffset & 7));
      bitOffset += 1;
    }
  }
  return output;
}

function closeTo(actual, expected, tolerance = 1e-6) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`
  );
}

function hasPdfCode(code) {
  return (error) => error instanceof PdfError && error.code === code;
}

async function rejectsCode(action, code) {
  await assert.rejects(Promise.resolve().then(action), hasPdfCode(code));
}

function throwsCode(action, code) {
  assert.throws(action, hasPdfCode(code));
}

function fixtureBytes() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1 1] >>" },
      {
        number: 10,
        body: "<< /FunctionType 2 /Domain [0 1] /Range [0 1] /C0 [0] /C1 [1] /N 1 >>"
      },
      {
        number: 11,
        body: "<< /FunctionType 3 /Domain [0 1] /Range [0 1] /Functions [11 0 R] /Bounds [] /Encode [0 1] >>"
      },
      {
        number: 12,
        body: "<< /FunctionType 3 /Domain [0 1] /Range [0 1] /Functions [13 0 R] /Bounds [] /Encode [0 1] >>"
      },
      {
        number: 13,
        body: "<< /FunctionType 3 /Domain [0 1] /Range [0 1] /Functions [12 0 R] /Bounds [] /Encode [0 1] >>"
      }
    ]
  });
}

const document = await openNativePdfDocument({ kind: "bytes", bytes: fixtureBytes() });

async function testSampledFunctions() {
  const registry = new NativePdfFunctionRegistry(document);
  for (const bits of [1, 2, 4, 8, 12, 16, 24, 32]) {
    const maximum = (2 ** bits) - 1;
    const index = await registry.add(sampled({ bits, values: [0, maximum] }));
    closeTo(registry.evaluate(index, [0])[0], 0);
    closeTo(registry.evaluate(index, [0.5])[0], 0.5);
    closeTo(registry.evaluate(index, [1])[0], 1);
  }

  const firstDimensionFastest = await registry.add(sampled({
    domain: [0, 1, 0, 1],
    size: [2, 2],
    bits: 8,
    values: [0, 64, 128, 255]
  }));
  closeTo(registry.evaluate(firstDimensionFastest, [1, 0])[0], 64 / 255);
  closeTo(registry.evaluate(firstDimensionFastest, [0, 1])[0], 128 / 255);
  closeTo(registry.evaluate(firstDimensionFastest, [0.5, 0.5])[0], 447 / 1020);

  const twoOutputs = await registry.add(sampled({
    range: [0, 1, 0, 1],
    values: [0, 255, 255, 0]
  }));
  assert.deepEqual([...registry.evaluate(twoOutputs, [0.25])], [0.25, 0.75]);

  const reversedMaps = await registry.add(sampled({
    range: [-10, 10],
    encode: [1, 0],
    decode: [2, -2]
  }));
  closeTo(registry.evaluate(reversedMaps, [0.25])[0], -1);

  const clippedDecode = await registry.add(sampled({ range: [0, 1], decode: [-2, 2] }));
  assert.equal(registry.evaluate(clippedDecode, [0])[0], 0);
  assert.equal(registry.evaluate(clippedDecode, [1])[0], 1);

  const degenerateDomain = await registry.add(sampled({
    domain: [1, 1],
    size: [1],
    values: [128]
  }));
  closeTo(registry.evaluate(degenerateDomain, [-100])[0], 128 / 255);

  const missingRange = sampled();
  missingRange.dictionary.delete("Range");
  await rejectsCode(() => registry.add(missingRange), "invalid-object");
  await rejectsCode(
    () => registry.add(sampled({ bits: 12, values: [0] })),
    "invalid-object"
  );
  const ignoredCubic = await registry.add(sampled({ order: 3 }));
  closeTo(registry.evaluate(ignoredCubic, [0.5])[0], 0.5);
  const cubic = await registry.add(sampled({
    size: [4],
    order: 3,
    values: [0, 255, 0, 0]
  }));
  closeTo(registry.evaluate(cubic, [0.5])[0], 0.5625);
  assert.equal(registry.describe(cubic).parameters[3], 3, "HEP parameters retain /Order");

  const bicubic = await registry.add(sampled({
    domain: [0, 1, 0, 1],
    size: [4, 4],
    order: 3,
    values: [
      0, 255, 0, 0,
      0, 255, 0, 0,
      0, 255, 0, 0,
      0, 255, 0, 0
    ]
  }));
  closeTo(registry.evaluate(bicubic, [0.5, 0.37])[0], 0.5625);
  await rejectsCode(() => registry.add(sampled({ order: 2 })), "invalid-object");
  await rejectsCode(
    () => new NativePdfFunctionRegistry(document, { maxSampleValues: 3 }).add(sampled({
      size: [4],
      values: [0, 1, 2, 3]
    })),
    "resource-limit"
  );
}

async function testExponentialAndStitchingFunctions() {
  const registry = new NativePdfFunctionRegistry(document);
  const vector = await registry.add(exponential({
    range: [0, 2, 0, 4],
    c0: [0, 1],
    c1: [2, 3],
    exponent: 2
  }));
  assert.deepEqual([...registry.evaluate(vector, [0.5])], [0.5, 1.5]);

  const clipping = await registry.add(exponential({ c0: [-1], c1: [2] }));
  assert.deepEqual([...registry.evaluate(clipping, [0])], [0]);
  assert.deepEqual([...registry.evaluate(clipping, [1])], [1]);

  const equalRange = await registry.add(exponential({ range: [0.25, 0.25] }));
  assert.deepEqual([...registry.evaluate(equalRange, [0.75])], [0.25]);
  const equalDomain = await registry.add(exponential({ domain: [0.5, 0.5], range: [0, 2] }));
  assert.deepEqual([...registry.evaluate(equalDomain, [100])], [0.5]);

  await rejectsCode(
    () => registry.add(exponential({ domain: [-1, 1], exponent: 0.5 })),
    "invalid-object"
  );
  await rejectsCode(
    () => registry.add(exponential({ domain: [0, 1], exponent: -1 })),
    "invalid-object"
  );
  await rejectsCode(
    () => registry.add(exponential({ domain: [1, 0] })),
    "invalid-object"
  );
  await rejectsCode(
    () => registry.add(exponential({ c0: [0, 1], c1: [1] })),
    "invalid-object"
  );

  const low = exponential({ range: null, c0: [0], c1: [1] });
  const high = exponential({ range: null, c0: [10], c1: [20] });
  const joined = await registry.add(stitching({
    range: [0, 20],
    functions: [low, high],
    bounds: [0.5],
    encode: [0, 1, 0, 1]
  }));
  closeTo(registry.evaluate(joined, [0.25])[0], 0.5);
  closeTo(registry.evaluate(joined, [0.5])[0], 10);
  closeTo(registry.evaluate(joined, [1])[0], 20);

  const oneDegenerate = await registry.add(stitching({
    domain: [1, 1],
    range: [0, 1],
    functions: [low]
  }));
  assert.deepEqual([...registry.evaluate(oneDegenerate, [0])], [0]);
  await rejectsCode(
    () => registry.add(stitching({
      domain: [1, 1],
      functions: [low, high],
      bounds: [1],
      encode: [0, 1, 0, 1]
    })),
    "invalid-object"
  );
  const finalPointSegment = await registry.add(stitching({
    range: [0, 20],
    functions: [low, high],
    bounds: [1],
    encode: [0, 1, 0.25, 0.75]
  }));
  closeTo(registry.evaluate(finalPointSegment, [0.999])[0], 0.999);
  closeTo(registry.evaluate(finalPointSegment, [1])[0], 12.5);

  const reusable = exponential();
  const reuseRegistry = new NativePdfFunctionRegistry(document);
  const childIndex = await reuseRegistry.add(reusable);
  const parentIndex = await reuseRegistry.add(stitching({
    functions: [reusable, reusable],
    bounds: [0.5],
    encode: [0, 1, 0, 1]
  }));
  assert.equal(await reuseRegistry.add(reusable), childIndex);
  assert.equal(reuseRegistry.size, 2);
  assert.equal(reuseRegistry.describe(parentIndex).functionType, 3);

  const indirect = new NativePdfFunctionRegistry(document);
  assert.equal(await indirect.add(ref(10)), await indirect.add(ref(10)));
  await rejectsCode(() => indirect.add(ref(11)), "invalid-object");
  await rejectsCode(() => indirect.add(ref(12)), "invalid-object");

  const directCycle = stitching({ functions: [], bounds: [], encode: [0, 1] });
  directCycle.set("Functions", [directCycle]);
  await rejectsCode(() => new NativePdfFunctionRegistry(document).add(directCycle), "invalid-object");

  let deep = exponential();
  for (let index = 0; index < 4; index += 1) {
    deep = stitching({ functions: [deep] });
  }
  await rejectsCode(
    () => new NativePdfFunctionRegistry(document, { maxFunctionDepth: 3 }).add(deep),
    "resource-limit"
  );

  const countRegistry = new NativePdfFunctionRegistry(document, { maxFunctions: 1 });
  await countRegistry.add(exponential());
  await rejectsCode(() => countRegistry.add(exponential()), "resource-limit");
}

async function addAndEvaluateCalculator(registry, program, expected, options = {}) {
  const values = Array.isArray(expected) ? expected : [expected];
  const index = await registry.add(calculator(
    program,
    values.length,
    options.rangePair ?? [-10_000_000_000, 10_000_000_000]
  ));
  const actual = [...registry.evaluate(index, [options.input ?? 0])];
  assert.equal(actual.length, values.length);
  for (let component = 0; component < values.length; component += 1) {
    closeTo(actual[component], values[component], options.tolerance ?? 1e-5);
  }
  return index;
}

async function testCalculatorOperatorsAndBytecode() {
  const registry = new NativePdfFunctionRegistry(document);
  const arithmetic = await registry.add(calculator(`{
    pop
    -5 abs 2 3 add 1 1 atan 1.2 ceiling 60 cos 1.9 cvi 2 cvr 7 2 div
    2 3 exp 1.8 floor -7 2 idiv 1 ln 100 log -7 3 mod 2 3 mul 5 neg
    -6.5 round 30 sin 4 sqrt 7 2 sub -2.8 truncate
  }`, 21));
  const arithmeticExpected = [
    5, 5, 45, 2, 0.5, 1, 2, 3.5, 8, 1, -3, 0, 2, -1, 6, -5, -6, 0.5, 2, 5, -2
  ];
  const arithmeticActual = [...registry.evaluate(arithmetic, [0])];
  arithmeticExpected.forEach((value, index) => closeTo(arithmeticActual[index], value, 1e-5));

  const comparisons = await registry.add(calculator(`{
    pop
    1 1.0 eq {1} {0} ifelse
    1 2 ne {1} {0} ifelse
    2 1 ge {1} {0} ifelse
    2 1 gt {1} {0} ifelse
    1 2 le {1} {0} ifelse
    1 2 lt {1} {0} ifelse
    true false and {1} {0} ifelse
    true false or {1} {0} ifelse
    true false xor {1} {0} ifelse
    6 3 and 4 1 or 7 2 xor -1 -1 bitshift 1 32 bitshift 1 not
  }`, 15, [-3_000_000_000, 3_000_000_000]));
  assert.deepEqual(
    [...registry.evaluate(comparisons, [0])],
    [1, 1, 1, 1, 1, 1, 0, 1, 1, 2, 5, 5, 2_147_483_647, 0, -2]
  );

  await addAndEvaluateCalculator(registry, "{ pop 3 4 2 copy add add add }", 14);
  await addAndEvaluateCalculator(registry, "{ pop 3 dup mul }", 9);
  await addAndEvaluateCalculator(registry, "{ pop 2 3 exch sub }", 1);
  await addAndEvaluateCalculator(registry, "{ pop 2 3 1 index add add }", 7);
  await addAndEvaluateCalculator(registry, "{ pop 2 3 pop }", 2);
  await addAndEvaluateCalculator(registry, "{ pop 1 2 3 3 1 roll sub sub }", 4);
  await addAndEvaluateCalculator(registry, "{ pop 2 true { 3 add } if }", 5);
  await addAndEvaluateCalculator(registry, "{ pop 2 false { 3 add } if }", 2);

  await addAndEvaluateCalculator(registry, "{ pop 2147483647 1 add }", 2_147_483_648);
  await addAndEvaluateCalculator(registry, "{ pop -2147483648 -1 bitshift }", 1_073_741_824);
  const clipped = await registry.add(calculator("{ pop 10 }", 1, [0, 1]));
  assert.deepEqual([...registry.evaluate(clipped, [0])], [1]);

  const bytecodeIndex = await registry.add(calculator("{ pop 7 .5 add }"));
  assert.deepEqual(
    [...registry.describe(bytecodeIndex).calculatorBytecode],
    [4, 36, 0, 7, 0, 0, 0, 1, 0, 0, 0, 63, 4, 1]
  );
  const conditionalBytecode = await registry.add(calculator("{ pop true { 1 } { 2 } ifelse }"));
  assert.deepEqual(
    [...registry.describe(conditionalBytecode).calculatorBytecode],
    [4, 36, 3, 5, 0, 1, 0, 0, 0, 6, 5, 0, 2, 0, 0, 0, 6, 4, 39]
  );
}

async function testCalculatorFailuresAndLimits() {
  const registry = new NativePdfFunctionRegistry(document);
  const invalidPrograms = [
    "{ pop 1 0 div }",
    "{ pop -2147483648 -1 idiv }",
    "{ pop 1 0 mod }",
    "{ pop -1 sqrt }",
    "{ pop 0 ln }",
    "{ pop -1 log }",
    "{ pop 0 0 atan }",
    "{ pop -2 .5 exp }",
    "{ pop 0 0 exp }",
    "{ pop 2147483648 cvi }",
    "{ pop 1.0 1 and }"
  ];
  for (const program of invalidPrograms) {
    const index = await registry.add(calculator(program));
    throwsCode(() => registry.evaluate(index, [0]), "invalid-object");
  }

  const overflow = await registry.add(calculator("{ pop 340282300000000000000000000000000000000 2 mul }"));
  throwsCode(() => registry.evaluate(overflow, [0]), "invalid-object");
  const booleanResult = await registry.add(calculator("{ pop true }"));
  throwsCode(() => registry.evaluate(booleanResult, [0]), "invalid-object");
  const wrongStack = await registry.add(calculator("{ dup }"));
  throwsCode(() => registry.evaluate(wrongStack, [0]), "invalid-object");
  throwsCode(() => registry.evaluate(wrongStack, [Number.NaN]), "invalid-object");

  await rejectsCode(() => registry.add(calculator("{ pop 1e2 }")), "unsupported-content");
  await rejectsCode(() => registry.add(calculator("{ pop 1 for }")), "unsupported-content");
  await rejectsCode(
    () => registry.add(calculator("{ pop {1} {1} eq {1} {0} ifelse }")),
    "invalid-object"
  );
  await rejectsCode(() => registry.add(calculator("{ pop 1 } trailing")), "invalid-object");
  await rejectsCode(() => registry.add(calculator("{ pop { 1 }")), "invalid-object");
  await rejectsCode(
    () => registry.add(calculator(`{ pop ${"9".repeat(50)} }`)),
    "invalid-object"
  );

  await rejectsCode(
    () => new NativePdfFunctionRegistry(document, { maxCalculatorTokens: 2 })
      .add(calculator("{ pop 1 2 }", 2)),
    "resource-limit"
  );
  await rejectsCode(
    () => new NativePdfFunctionRegistry(document, { maxCalculatorDepth: 1 })
      .add(calculator("{ pop true { true { 1 } if } if }")),
    "resource-limit"
  );
  await rejectsCode(
    () => new NativePdfFunctionRegistry(document, { maxCalculatorBytes: 8 })
      .add(calculator("{ pop 123456 }")),
    "resource-limit"
  );

  const operationRegistry = new NativePdfFunctionRegistry(document, { maxCalculatorOperations: 1 });
  const operationLimited = await operationRegistry.add(calculator("{ pop 1 }"));
  throwsCode(() => operationRegistry.evaluate(operationLimited, [0]), "resource-limit");

  const stackRegistry = new NativePdfFunctionRegistry(document, { maxCalculatorStack: 1 });
  const stackLimited = await stackRegistry.add(calculator("{ 1 }"));
  throwsCode(() => stackRegistry.evaluate(stackLimited, [0]), "resource-limit");
}

async function testCancellationAndStores() {
  const registry = new NativePdfFunctionRegistry(document);
  const index = await registry.add(calculator("{ pop 7 .5 add }"));
  const controller = new AbortController();
  controller.abort("fixture abort");
  await rejectsCode(() => registry.add(exponential(), controller.signal), "aborted");
  throwsCode(() => registry.evaluate(index, [0], controller.signal), "aborted");
  throwsCode(() => registry.buildStore(controller.signal), "aborted");

  const store = registry.buildStore();
  assert.equal(store.kinds.length, 1);
  assert.deepEqual([...store.calculatorBytecode], [...registry.describe(index).calculatorBytecode]);

  const bounded = new NativePdfFunctionRegistry(document, { maxStoreValues: 2 });
  await rejectsCode(() => bounded.add(sampled()), "resource-limit");

  assert.equal(DEFAULT_NATIVE_PDF_FUNCTION_LIMITS.maxFunctions, 4_096);
  assert.equal(DEFAULT_NATIVE_PDF_FUNCTION_LIMITS.maxFunctionDepth, 64);
  assert.equal(DEFAULT_NATIVE_PDF_FUNCTION_LIMITS.maxStoreValues, 16_777_216);
  assert.equal(DEFAULT_NATIVE_PDF_FUNCTION_LIMITS.maxCalculatorBytes, 1_048_576);
}

try {
  await testSampledFunctions();
  await testExponentialAndStitchingFunctions();
  await testCalculatorOperatorsAndBytecode();
  await testCalculatorFailuresAndLimits();
  await testCancellationAndStores();
  console.log("native PDF function semantics tests passed");
} finally {
  await document.close();
  hooks.deregister();
}
