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
const { NativePdfFunctionRegistry } = await import("../src/pdf/nativeFunctions.ts");
const {
  HEPR_FUNCTION_EVALUATION_CODES,
  HeprFunctionEvaluationError,
  HeprFunctionEvaluator,
  evaluateHeprFunction
} = await import("../src/heprFunctionEvaluator.ts");

const encoder = new TextEncoder();

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
  values = [0, 255],
  encode,
  decode,
  order
} = {}) {
  const entries = {
    FunctionType: 0,
    Domain: domain,
    Range: range,
    Size: size,
    BitsPerSample: bits
  };
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

function calculator(program, outputCount = 1, rangePair = [-100, 100]) {
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
      if (Math.floor(value / (2 ** bit)) % 2) {
        output[bitOffset >>> 3] |= 1 << (7 - (bitOffset & 7));
      }
      bitOffset += 1;
    }
  }
  return output;
}

function cloneStore(store) {
  return {
    kinds: store.kinds.slice(),
    domainOffsets: store.domainOffsets.slice(),
    domains: store.domains.slice(),
    rangeOffsets: store.rangeOffsets.slice(),
    ranges: store.ranges.slice(),
    parameterOffsets: store.parameterOffsets.slice(),
    parameters: store.parameters.slice(),
    sampleOffsets: store.sampleOffsets.slice(),
    samples: store.samples.slice(),
    calculatorOffsets: store.calculatorOffsets.slice(),
    calculatorBytecode: store.calculatorBytecode.slice()
  };
}

function singleFunctionStore(store, index) {
  const domain = store.domains.slice(store.domainOffsets[index], store.domainOffsets[index + 1]);
  const range = store.ranges.slice(store.rangeOffsets[index], store.rangeOffsets[index + 1]);
  const parameters = store.parameters.slice(
    store.parameterOffsets[index],
    store.parameterOffsets[index + 1]
  );
  const samples = store.samples.slice(store.sampleOffsets[index], store.sampleOffsets[index + 1]);
  const bytecode = store.calculatorBytecode.slice(
    store.calculatorOffsets[index],
    store.calculatorOffsets[index + 1]
  );
  return {
    kinds: Uint8Array.of(store.kinds[index]),
    domainOffsets: Uint32Array.of(0, domain.length),
    domains: domain,
    rangeOffsets: Uint32Array.of(0, range.length),
    ranges: range,
    parameterOffsets: Uint32Array.of(0, parameters.length),
    parameters,
    sampleOffsets: Uint32Array.of(0, samples.length),
    samples,
    calculatorOffsets: Uint32Array.of(0, bytecode.length),
    calculatorBytecode: bytecode
  };
}

function closeArrays(actual, expected, tolerance = 2e-6) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    assert(
      Math.abs(actual[index] - expected[index]) <= tolerance,
      `component ${index}: ${actual[index]} is not within ${tolerance} of ${expected[index]}`
    );
  }
}

function hasEvaluatorCode(code) {
  return (error) => error instanceof HeprFunctionEvaluationError && error.code === code;
}

function throwsCode(action, code) {
  assert.throws(action, hasEvaluatorCode(code));
}

const fixture = writeTinyPdf({
  objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1 1] >>" }
  ]
});
const document = await openNativePdfDocument({ kind: "bytes", bytes: fixture });

try {
  const registry = new NativePdfFunctionRegistry(document);
  const linear = await registry.add(sampled({
    domain: [0, 1, 0, 1],
    size: [2, 2],
    values: [0, 64, 128, 255]
  }));
  const cubic = await registry.add(sampled({
    size: [4],
    values: [0, 255, 0, 0],
    order: 3
  }));
  const clampedExponential = await registry.add(exponential({
    range: [0, 2, 0, 4],
    c0: [-1, 5],
    c1: [3, -5],
    exponent: 2
  }));
  const low = exponential({ range: null, c0: [0], c1: [2] });
  const high = exponential({ range: null, c0: [10], c1: [20] });
  await registry.add(low);
  await registry.add(high);
  const joined = await registry.add(stitching({
    range: [0, 20],
    functions: [low, high],
    bounds: [0.5],
    encode: [0, 1, 0, 1]
  }));
  // Repeated Bounds describe an empty subdomain, which selection can never
  // reach. The unreachable segment here is `high`, whose outputs start at 10.
  const plateau = await registry.add(stitching({
    range: [0, 20],
    functions: [low, high, low],
    bounds: [0.5, 0.5],
    encode: [0, 1, 0, 1, 0, 1]
  }));

  const conditional = await registry.add(calculator(
    "{ dup .5 lt { 2 mul } { 1 exch sub 4 mul } ifelse }"
  ));
  const nestedConditional = await registry.add(calculator(
    "{ true { true { pop 1 } if } if }"
  ));
  const arithmetic = await registry.add(calculator(`{
    pop
    -5 abs 2 3 add 1 1 atan 1.2 ceiling 60 cos 1.9 cvi 2 cvr 7 2 div
    2 3 exp 1.8 floor -7 2 idiv 1 ln 100 log -7 3 mod 2 3 mul 5 neg
    -6.5 round 30 sin 4 sqrt 7 2 sub -2.8 truncate
  }`, 21));
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
  const stackAndControl = await registry.add(calculator(`{
    pop
    3 4 2 copy add add add
    3 dup mul
    2 3 exch sub
    2 3 1 index add add
    2 3 pop
    1 2 3 3 1 roll sub sub
    2 true { 3 add } if
    2 false { 3 add } if
  }`, 8));

  const store = registry.buildStore();
  const evaluator = new HeprFunctionEvaluator(store);
  const vectors = [
    [linear, [[-1, -1], [0, 0], [0.25, 0.75], [0.5, 0.5], [1, 1], [2, 2]]],
    [cubic, [[0], [0.25], [0.5], [0.75], [1]]],
    [clampedExponential, [[-100], [0], [0.5], [1], [100]]],
    [joined, [[0], [0.25], [0.5], [0.75], [1]]],
    [plateau, [[0], [0.25], [0.5], [0.75], [1]]],
    [conditional, [[0], [0.25], [0.5], [0.75], [1]]],
    [nestedConditional, [[0], [0.5], [1]]],
    [arithmetic, [[0]]],
    [comparisons, [[0]]],
    [stackAndControl, [[0]]]
  ];
  for (const [index, inputs] of vectors) {
    for (const input of inputs) {
      closeArrays(evaluator.evaluate(index, input), registry.evaluate(index, input));
    }
  }

  assert.deepEqual([...evaluator.evaluate(clampedExponential, [-100])], [0, 4]);
  assert.deepEqual([...evaluator.evaluate(clampedExponential, [100])], [2, 0]);
  closeArrays(
    evaluateHeprFunction(store, cubic, new Float64Array([0.5])),
    registry.evaluate(cubic, [0.5])
  );

  const cycleStore = cloneStore(store);
  cycleStore.parameters[cycleStore.parameterOffsets[joined] + 3] = joined;
  throwsCode(
    () => new HeprFunctionEvaluator(cycleStore).evaluate(joined, [0.25]),
    HEPR_FUNCTION_EVALUATION_CODES.ResourceCycle
  );

  const missingChildStore = cloneStore(store);
  missingChildStore.parameters[missingChildStore.parameterOffsets[joined] + 3] = 999;
  throwsCode(
    () => new HeprFunctionEvaluator(missingChildStore).evaluate(joined, [0.25]),
    HEPR_FUNCTION_EVALUATION_CODES.InvalidIndex
  );

  const malformedBytecode = cloneStore(store);
  malformedBytecode.calculatorBytecode[malformedBytecode.calculatorOffsets[conditional]] = 0xff;
  throwsCode(
    () => new HeprFunctionEvaluator(malformedBytecode).evaluate(conditional, [0.25]),
    HEPR_FUNCTION_EVALUATION_CODES.InvalidFunction
  );

  const unknownKind = singleFunctionStore(store, clampedExponential);
  unknownKind.kinds[0] = 0xff;
  throwsCode(
    () => new HeprFunctionEvaluator(unknownKind).evaluate(0, [0.5]),
    HEPR_FUNCTION_EVALUATION_CODES.InvalidFunction
  );

  const missingSampleRange = singleFunctionStore(store, cubic);
  missingSampleRange.ranges = new Float32Array(0);
  missingSampleRange.rangeOffsets = Uint32Array.of(0, 0);
  throwsCode(
    () => new HeprFunctionEvaluator(missingSampleRange).evaluate(0, [0.5]),
    HEPR_FUNCTION_EVALUATION_CODES.InvalidFunction
  );

  const invalidSample = singleFunctionStore(store, cubic);
  invalidSample.samples[0] = 1.25;
  throwsCode(
    () => new HeprFunctionEvaluator(invalidSample).evaluate(0, [0.5]),
    HEPR_FUNCTION_EVALUATION_CODES.InvalidFunction
  );

  const invalidOffsets = cloneStore(store);
  invalidOffsets.parameterOffsets[invalidOffsets.parameterOffsets.length - 1] -= 1;
  throwsCode(
    () => new HeprFunctionEvaluator(invalidOffsets),
    HEPR_FUNCTION_EVALUATION_CODES.InvalidStore
  );

  throwsCode(
    () => new HeprFunctionEvaluator(store, {
      limits: { maxInterpolationSamples: 3 }
    }).evaluate(linear, [0.5, 0.5]),
    HEPR_FUNCTION_EVALUATION_CODES.ResourceLimit
  );
  throwsCode(
    () => new HeprFunctionEvaluator(store, {
      limits: { maxFunctionDepth: 1 }
    }).evaluate(joined, [0.25]),
    HEPR_FUNCTION_EVALUATION_CODES.ResourceLimit
  );
  throwsCode(
    () => new HeprFunctionEvaluator(store, {
      limits: { maxCalculatorOperations: 1 }
    }).evaluate(conditional, [0.25]),
    HEPR_FUNCTION_EVALUATION_CODES.ResourceLimit
  );
  throwsCode(
    () => new HeprFunctionEvaluator(store, {
      limits: { maxCalculatorStack: 1 }
    }).evaluate(conditional, [0.25]),
    HEPR_FUNCTION_EVALUATION_CODES.ResourceLimit
  );
  throwsCode(
    () => new HeprFunctionEvaluator(store, {
      limits: { maxCalculatorDepth: 1 }
    }).evaluate(nestedConditional, [0.5]),
    HEPR_FUNCTION_EVALUATION_CODES.ResourceLimit
  );

  const controller = new AbortController();
  controller.abort("fixture cancellation");
  throwsCode(
    () => evaluator.evaluate(linear, [0.5, 0.5], { signal: controller.signal }),
    HEPR_FUNCTION_EVALUATION_CODES.Aborted
  );
  throwsCode(
    () => evaluator.evaluate(linear, [Number.NaN, 0.5]),
    HEPR_FUNCTION_EVALUATION_CODES.InvalidInput
  );
  throwsCode(
    () => evaluator.evaluate(linear, [0.5]),
    HEPR_FUNCTION_EVALUATION_CODES.InvalidInput
  );
  throwsCode(
    () => evaluator.evaluate(99, [0]),
    HEPR_FUNCTION_EVALUATION_CODES.InvalidIndex
  );

  console.log("HEPR function evaluator tests passed");
} finally {
  await document.close();
  hooks.deregister();
}
