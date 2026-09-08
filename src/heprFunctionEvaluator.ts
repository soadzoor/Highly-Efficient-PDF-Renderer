import {
  HEPR_FUNCTION_KIND,
  type HeprFunctionStore
} from "./heprDocumentData";

export const HEPR_FUNCTION_EVALUATION_CODES = {
  InvalidStore: "function.invalid-store",
  InvalidIndex: "function.invalid-index",
  InvalidInput: "function.invalid-input",
  InvalidFunction: "function.invalid-function",
  ResourceCycle: "function.resource-cycle",
  ResourceLimit: "function.resource-limit",
  Aborted: "function.aborted"
} as const;

export type HeprFunctionEvaluationCode =
  (typeof HEPR_FUNCTION_EVALUATION_CODES)[keyof typeof HEPR_FUNCTION_EVALUATION_CODES];

export class HeprFunctionEvaluationError extends Error {
  readonly code: HeprFunctionEvaluationCode;
  readonly path: string | null;

  constructor(
    code: HeprFunctionEvaluationCode,
    message: string,
    options: { readonly path?: string; readonly cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "HeprFunctionEvaluationError";
    this.code = code;
    this.path = options.path ?? null;
  }
}

export interface HeprFunctionEvaluationLimits {
  readonly maxFunctions: number;
  readonly maxStoreValues: number;
  readonly maxFunctionDepth: number;
  readonly maxInputs: number;
  readonly maxOutputs: number;
  /** Maximum sample-table points visited by one interpolation. */
  readonly maxInterpolationSamples: number;
  readonly maxCalculatorBytes: number;
  readonly maxCalculatorTokens: number;
  readonly maxCalculatorDepth: number;
  readonly maxCalculatorStack: number;
  readonly maxCalculatorOperations: number;
}

export const DEFAULT_HEPR_FUNCTION_EVALUATION_LIMITS:
Readonly<HeprFunctionEvaluationLimits> = Object.freeze({
  maxFunctions: 4_096,
  maxStoreValues: 16_777_216,
  maxFunctionDepth: 64,
  maxInputs: 16,
  maxOutputs: 32,
  maxInterpolationSamples: 1_048_576,
  maxCalculatorBytes: 1_048_576,
  maxCalculatorTokens: 4_096,
  maxCalculatorDepth: 16,
  maxCalculatorStack: 256,
  maxCalculatorOperations: 16_384
});

export interface HeprFunctionEvaluatorOptions {
  readonly limits?: Partial<HeprFunctionEvaluationLimits>;
}

export interface HeprFunctionEvaluationOptions {
  readonly signal?: AbortSignal;
}

interface FunctionBase {
  readonly inputCount: number;
  readonly outputCount: number;
  readonly domain: readonly number[];
  readonly range: readonly number[] | null;
}

interface SampledFunction extends FunctionBase {
  readonly kind: "sampled";
  readonly bitsPerSample: number;
  readonly order: 1 | 3;
  readonly size: readonly number[];
  readonly encode: readonly number[];
  readonly decode: readonly number[];
  /** Zero-copy view into the immutable HEPR store payload. */
  readonly samples: Float32Array;
}

interface ExponentialFunction extends FunctionBase {
  readonly kind: "exponential";
  readonly exponent: number;
  readonly c0: readonly number[];
  readonly c1: readonly number[];
}

interface StitchingFunction extends FunctionBase {
  readonly kind: "stitching";
  readonly childIndices: readonly number[];
  readonly bounds: readonly number[];
  readonly encode: readonly number[];
}

interface CalculatorNumber {
  readonly kind: "integer" | "real";
  readonly value: number;
}

type CalculatorToken = CalculatorNumber | boolean | string | readonly CalculatorToken[];
type CalculatorStackValue = CalculatorNumber | boolean | readonly CalculatorToken[];

interface CalculatorFunction extends FunctionBase {
  readonly kind: "calculator";
  readonly program: readonly CalculatorToken[];
}

type FunctionRecord =
  | SampledFunction
  | ExponentialFunction
  | StitchingFunction
  | CalculatorFunction;

/**
 * Renderer-owned evaluator for the self-contained HEPR v7 function store.
 * It never consults the source PDF or parser-owned function objects.
 */
export class HeprFunctionEvaluator {
  private readonly store: HeprFunctionStore;
  private readonly limits: Readonly<HeprFunctionEvaluationLimits>;
  private readonly records: Array<FunctionRecord | undefined>;
  private readonly validatedGraphRoots = new Set<number>();

  constructor(store: HeprFunctionStore, options: HeprFunctionEvaluatorOptions = {}) {
    this.limits = normalizeLimits(options.limits);
    validateStoreShape(store, this.limits);
    this.store = store;
    this.records = new Array(store.kinds.length);
  }

  evaluate(
    index: number,
    inputs: ArrayLike<number>,
    options: HeprFunctionEvaluationOptions = {}
  ): Float64Array {
    checkAbort(options.signal);
    this.assertIndex(index, "functions");
    const inputValues = normalizeFunctionInputs(inputs, this.limits, options.signal);
    if (!this.validatedGraphRoots.has(index)) {
      this.validateGraph(index, options.signal);
      this.validatedGraphRoots.add(index);
    }
    return this.evaluateInternal(index, inputValues, 0, new Set(), options.signal);
  }

  private evaluateInternal(
    index: number,
    inputs: readonly number[],
    depth: number,
    active: Set<number>,
    signal?: AbortSignal
  ): Float64Array {
    checkAbort(signal);
    if (depth >= this.limits.maxFunctionDepth) {
      throw evaluationError(
        HEPR_FUNCTION_EVALUATION_CODES.ResourceLimit,
        `Function nesting exceeds limit ${this.limits.maxFunctionDepth}.`,
        `functions[${index}]`
      );
    }
    if (active.has(index)) {
      throw evaluationError(
        HEPR_FUNCTION_EVALUATION_CODES.ResourceCycle,
        "Function graph contains a cycle.",
        `functions[${index}]`
      );
    }
    const record = this.record(index, signal);
    if (inputs.length !== record.inputCount) {
      throw evaluationError(
        HEPR_FUNCTION_EVALUATION_CODES.InvalidInput,
        `Function ${index} expects ${record.inputCount} inputs, received ${inputs.length}.`,
        "inputs"
      );
    }
    if (inputs.some((value) => !Number.isFinite(value))) {
      throw evaluationError(
        HEPR_FUNCTION_EVALUATION_CODES.InvalidInput,
        "Function input contains a non-finite number.",
        "inputs"
      );
    }
    active.add(index);
    try {
      const boundedInputs = clampPairs(inputs, record.domain);
      let output: number[];
      if (record.kind === "sampled") {
        output = evaluateSampled(record, boundedInputs, this.limits, signal);
      } else if (record.kind === "exponential") {
        const power = Math.pow(boundedInputs[0], record.exponent);
        output = record.c0.map(
          (start, component) => start + power * (record.c1[component] - start)
        );
      } else if (record.kind === "stitching") {
        output = this.evaluateStitching(record, boundedInputs[0], depth, active, signal);
      } else {
        output = evaluateCalculator(
          record,
          boundedInputs,
          this.limits,
          signal,
          `functions[${index}].calculator`
        );
      }
      if (
        output.length !== record.outputCount ||
        output.some((value) => !Number.isFinite(value))
      ) {
        throw evaluationError(
          HEPR_FUNCTION_EVALUATION_CODES.InvalidFunction,
          `Function ${index} produced an invalid result.`,
          `functions[${index}]`
        );
      }
      if (record.range !== null) output = clampPairs(output, record.range);
      return Float64Array.from(output);
    } finally {
      active.delete(index);
    }
  }

  private evaluateStitching(
    record: StitchingFunction,
    input: number,
    depth: number,
    active: Set<number>,
    signal?: AbortSignal
  ): number[] {
    checkAbort(signal);
    let segment = record.bounds.findIndex((bound) => input < bound);
    if (segment < 0) segment = record.childIndices.length - 1;
    const lower = segment === 0 ? record.domain[0] : record.bounds[segment - 1];
    const upper = segment === record.bounds.length
      ? record.domain[1]
      : record.bounds[segment];
    const encoded = interpolate(
      input,
      lower,
      upper,
      record.encode[segment * 2],
      record.encode[segment * 2 + 1]
    );
    return [...this.evaluateInternal(
      record.childIndices[segment],
      [encoded],
      depth + 1,
      active,
      signal
    )];
  }

  private validateGraph(root: number, signal?: AbortSignal): void {
    const state = new Uint8Array(this.store.kinds.length);
    const visit = (index: number, depth: number): void => {
      checkAbort(signal);
      if (depth >= this.limits.maxFunctionDepth) {
        throw evaluationError(
          HEPR_FUNCTION_EVALUATION_CODES.ResourceLimit,
          `Function graph nesting exceeds limit ${this.limits.maxFunctionDepth}.`,
          `functions[${index}]`
        );
      }
      if (state[index] === 1) {
        throw evaluationError(
          HEPR_FUNCTION_EVALUATION_CODES.ResourceCycle,
          "Function graph contains a cycle.",
          `functions[${index}]`
        );
      }
      if (state[index] === 2) return;
      state[index] = 1;
      const record = this.record(index, signal);
      if (record.kind === "stitching") {
        for (const childIndex of record.childIndices) {
          this.assertIndex(childIndex, `functions[${index}].children`);
          const child = this.record(childIndex, signal);
          if (child.inputCount !== 1 || child.outputCount !== record.outputCount) {
            throw evaluationError(
              HEPR_FUNCTION_EVALUATION_CODES.InvalidFunction,
              "Stitching child has incompatible input/output arity.",
              `functions[${index}]`
            );
          }
          visit(childIndex, depth + 1);
        }
      }
      state[index] = 2;
    };
    visit(root, 0);
  }

  private record(index: number, signal?: AbortSignal): FunctionRecord {
    this.assertIndex(index, "functions");
    let record = this.records[index];
    if (record !== undefined) return record;
    record = decodeRecord(this.store, index, this.limits, signal);
    this.records[index] = record;
    return record;
  }

  private assertIndex(index: number, path: string): void {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.store.kinds.length) {
      throw evaluationError(
        HEPR_FUNCTION_EVALUATION_CODES.InvalidIndex,
        `Function index ${index} is out of range.`,
        path
      );
    }
  }
}

export function evaluateHeprFunction(
  store: HeprFunctionStore,
  index: number,
  inputs: ArrayLike<number>,
  options: HeprFunctionEvaluatorOptions & HeprFunctionEvaluationOptions = {}
): Float64Array {
  return new HeprFunctionEvaluator(store, { limits: options.limits })
    .evaluate(index, inputs, { signal: options.signal });
}

function validateStoreShape(
  store: HeprFunctionStore,
  limits: Readonly<HeprFunctionEvaluationLimits>
): void {
  if (typeof store !== "object" || store === null) {
    throw evaluationError(
      HEPR_FUNCTION_EVALUATION_CODES.InvalidStore,
      "Function store must be an object.",
      "functions"
    );
  }
  requireTypedArray(store.kinds, Uint8Array, "functions.kinds");
  const count = store.kinds.length;
  if (count > limits.maxFunctions) {
    throw evaluationError(
      HEPR_FUNCTION_EVALUATION_CODES.ResourceLimit,
      `Function count exceeds limit ${limits.maxFunctions}.`,
      "functions.kinds"
    );
  }
  requireTypedArray(store.domains, Float32Array, "functions.domains");
  requireTypedArray(store.ranges, Float32Array, "functions.ranges");
  requireTypedArray(store.parameters, Float32Array, "functions.parameters");
  requireTypedArray(store.samples, Float32Array, "functions.samples");
  requireTypedArray(store.calculatorBytecode, Uint8Array, "functions.calculatorBytecode");
  for (const [name, offsets, length] of [
    ["domainOffsets", store.domainOffsets, store.domains.length],
    ["rangeOffsets", store.rangeOffsets, store.ranges.length],
    ["parameterOffsets", store.parameterOffsets, store.parameters.length],
    ["sampleOffsets", store.sampleOffsets, store.samples.length],
    ["calculatorOffsets", store.calculatorOffsets, store.calculatorBytecode.length]
  ] as const) {
    requireTypedArray(offsets, Uint32Array, `functions.${name}`);
    if (offsets.length !== count + 1 || offsets[0] !== 0 || offsets[count] !== length) {
      throw evaluationError(
        HEPR_FUNCTION_EVALUATION_CODES.InvalidStore,
        `${name} does not span its payload exactly.`,
        `functions.${name}`
      );
    }
    for (let index = 1; index < offsets.length; index += 1) {
      if (offsets[index] < offsets[index - 1]) {
        throw evaluationError(
          HEPR_FUNCTION_EVALUATION_CODES.InvalidStore,
          `${name} is not monotonic.`,
          `functions.${name}[${index}]`
        );
      }
    }
  }
  for (const [name, length] of [
    ["domains", store.domains.length],
    ["ranges", store.ranges.length],
    ["parameters", store.parameters.length],
    ["samples", store.samples.length],
    ["calculatorBytecode", store.calculatorBytecode.length]
  ] as const) {
    if (length > limits.maxStoreValues) {
      throw evaluationError(
        HEPR_FUNCTION_EVALUATION_CODES.ResourceLimit,
        `${name} exceeds limit ${limits.maxStoreValues}.`,
        `functions.${name}`
      );
    }
  }
}

function decodeRecord(
  store: HeprFunctionStore,
  index: number,
  limits: Readonly<HeprFunctionEvaluationLimits>,
  signal?: AbortSignal
): FunctionRecord {
  checkAbort(signal);
  const domainValues = floatSpan(
    store.domains,
    store.domainOffsets,
    index,
    `functions[${index}].domain`
  );
  const rangeValues = floatSpan(
    store.ranges,
    store.rangeOffsets,
    index,
    `functions[${index}].range`
  );
  const parameters = floatSpan(
    store.parameters,
    store.parameterOffsets,
    index,
    `functions[${index}].parameters`
  );
  const samples = floatSpan(
    store.samples,
    store.sampleOffsets,
    index,
    `functions[${index}].samples`
  );
  const byteStart = store.calculatorOffsets[index];
  const byteEnd = store.calculatorOffsets[index + 1];
  const calculatorBytes = store.calculatorBytecode.subarray(byteStart, byteEnd);
  assertFiniteNumbers(domainValues, `functions[${index}].domain`, signal);
  assertFiniteNumbers(rangeValues, `functions[${index}].range`, signal);
  assertFiniteNumbers(parameters, `functions[${index}].parameters`, signal);
  const path = `functions[${index}]`;
  const kind = store.kinds[index];
  if (parameters.length < 2) invalidFunction(path, "parameter header is truncated");
  const inputCount = exactPositiveInteger(parameters[0], limits.maxInputs, `${path}.inputCount`);
  const outputCount = exactPositiveInteger(parameters[1], limits.maxOutputs, `${path}.outputCount`);
  const domain = Array.from(domainValues);
  const range = rangeValues.length === 0 ? null : Array.from(rangeValues);
  validatePairs(domain, inputCount, true, `${path}.domain`);
  if (range !== null) validatePairs(range, outputCount, true, `${path}.range`);

  if (kind === HEPR_FUNCTION_KIND.Sampled) {
    if (range === null) invalidFunction(path, "sampled function requires Range");
    if (calculatorBytes.length !== 0) invalidFunction(path, "sampled function carries calculator bytecode");
    if (parameters.length < 4 + inputCount * 3 + outputCount * 2) {
      invalidFunction(path, "sampled parameters are truncated");
    }
    const bitsPerSample = exactInteger(parameters[2], `${path}.bitsPerSample`);
    if (![1, 2, 4, 8, 12, 16, 24, 32].includes(bitsPerSample)) {
      invalidFunction(path, "sampled precision is unsupported");
    }
    const orderValue = exactInteger(parameters[3], `${path}.order`);
    if (orderValue !== 1 && orderValue !== 3) invalidFunction(path, "sampled Order must be 1 or 3");
    let cursor = 4;
    const size = Array.from(
      parameters.subarray(cursor, cursor += inputCount),
      (value, dimension) => exactPositiveInteger(
        value,
        limits.maxStoreValues,
        `${path}.size[${dimension}]`
      )
    );
    const encode = Array.from(parameters.subarray(cursor, cursor += inputCount * 2));
    const decode = Array.from(parameters.subarray(cursor, cursor += outputCount * 2));
    if (cursor !== parameters.length) invalidFunction(path, "sampled parameters have trailing values");
    const sampleCount = checkedProduct(size, outputCount, limits.maxStoreValues, `${path}.samples`);
    if (samples.length !== sampleCount) invalidFunction(path, "sample table length does not match Size");
    validateNormalizedSamples(samples, `${path}.samples`, signal);
    return Object.freeze({
      kind: "sampled",
      inputCount,
      outputCount,
      domain,
      range,
      bitsPerSample,
      order: orderValue,
      size,
      encode,
      decode,
      samples
    });
  }

  if (samples.length !== 0) invalidFunction(path, "non-sampled function carries sample values");
  if (kind === HEPR_FUNCTION_KIND.Exponential) {
    if (calculatorBytes.length !== 0) invalidFunction(path, "exponential function carries bytecode");
    if (inputCount !== 1 || parameters.length !== 3 + outputCount * 2) {
      invalidFunction(path, "exponential parameters have invalid arity");
    }
    const exponent = parameters[2];
    const c0 = Array.from(parameters.subarray(3, 3 + outputCount));
    const c1 = Array.from(parameters.subarray(3 + outputCount));
    if (!Number.isInteger(exponent) && domain[0] < 0) {
      invalidFunction(path, "fractional exponent has a negative domain");
    }
    if (exponent < 0 && domain[0] <= 0 && domain[1] >= 0) {
      invalidFunction(path, "negative exponent domain contains zero");
    }
    return Object.freeze({
      kind: "exponential",
      inputCount,
      outputCount,
      domain,
      range,
      exponent,
      c0,
      c1
    });
  }

  if (kind === HEPR_FUNCTION_KIND.Stitching) {
    if (calculatorBytes.length !== 0) invalidFunction(path, "stitching function carries bytecode");
    if (inputCount !== 1 || parameters.length < 4) {
      invalidFunction(path, "stitching parameters are truncated");
    }
    const childCount = exactPositiveInteger(parameters[2], limits.maxFunctions, `${path}.childCount`);
    const expected = 3 + childCount + (childCount - 1) + childCount * 2;
    if (parameters.length !== expected) invalidFunction(path, "stitching parameters have invalid arity");
    let cursor = 3;
    const childIndices = Array.from(
      parameters.subarray(cursor, cursor += childCount),
      (value, child) => exactInteger(value, `${path}.childIndices[${child}]`)
    );
    const bounds = Array.from(parameters.subarray(cursor, cursor += childCount - 1));
    const encode = Array.from(parameters.subarray(cursor));
    if (childCount > 1 && !(domain[0] < domain[1])) {
      invalidFunction(path, "multi-segment stitching domain is empty");
    }
    let previous = domain[0];
    for (let boundIndex = 0; boundIndex < bounds.length; boundIndex += 1) {
      const bound = bounds[boundIndex];
      const last = boundIndex === bounds.length - 1;
      // Repeated bounds describe an empty subdomain, not disorder: selection
      // above takes the first bound strictly greater than the input, so that
      // segment is unreachable. Only a decreasing bound is disorder.
      if (!(bound >= previous && (bound < domain[1] || (last && bound === domain[1])))) {
        invalidFunction(path, "stitching bounds are unordered");
      }
      previous = bound;
    }
    return Object.freeze({
      kind: "stitching",
      inputCount,
      outputCount,
      domain,
      range,
      childIndices,
      bounds,
      encode
    });
  }

  if (kind === HEPR_FUNCTION_KIND.Calculator) {
    if (range === null) invalidFunction(path, "calculator function requires Range");
    if (parameters.length !== 2) invalidFunction(path, "calculator parameters have trailing values");
    if (calculatorBytes.length > limits.maxCalculatorBytes) {
      throw evaluationError(
        HEPR_FUNCTION_EVALUATION_CODES.ResourceLimit,
        `Calculator bytecode exceeds limit ${limits.maxCalculatorBytes}.`,
        `${path}.calculatorBytecode`
      );
    }
    return Object.freeze({
      kind: "calculator",
      inputCount,
      outputCount,
      domain,
      range,
      program: decodeCalculatorProgram(calculatorBytes, limits, path, signal)
    });
  }
  invalidFunction(path, `unknown function kind ${kind}`);
}

function evaluateSampled(
  record: SampledFunction,
  inputs: readonly number[],
  limits: Readonly<HeprFunctionEvaluationLimits>,
  signal?: AbortSignal
): number[] {
  const lower = new Uint32Array(record.inputCount);
  const upper = new Uint32Array(record.inputCount);
  const fractions = new Float64Array(record.inputCount);
  for (let dimension = 0; dimension < record.inputCount; dimension += 1) {
    const encoded = clamp(
      interpolate(
        inputs[dimension],
        record.domain[dimension * 2],
        record.domain[dimension * 2 + 1],
        record.encode[dimension * 2],
        record.encode[dimension * 2 + 1]
      ),
      0,
      record.size[dimension] - 1
    );
    lower[dimension] = Math.floor(encoded);
    upper[dimension] = Math.ceil(encoded);
    fractions[dimension] = encoded - lower[dimension];
  }
  const output = record.order === 3
    ? evaluateCubicSamples(record, lower, fractions, limits, signal)
    : evaluateLinearSamples(record, lower, upper, fractions, limits, signal);
  for (let component = 0; component < output.length; component += 1) {
    output[component] = interpolate(
      output[component],
      0,
      1,
      record.decode[component * 2],
      record.decode[component * 2 + 1]
    );
  }
  return output;
}

function evaluateLinearSamples(
  record: SampledFunction,
  lower: Uint32Array,
  upper: Uint32Array,
  fractions: Float64Array,
  limits: Readonly<HeprFunctionEvaluationLimits>,
  signal?: AbortSignal
): number[] {
  const cornerCount = 2 ** record.inputCount;
  assertInterpolationWork(cornerCount, limits);
  const output = new Array<number>(record.outputCount).fill(0);
  for (let corner = 0; corner < cornerCount; corner += 1) {
    if ((corner & 0xff) === 0) checkAbort(signal);
    let pointIndex = 0;
    let stride = 1;
    let weight = 1;
    for (let dimension = 0; dimension < record.inputCount; dimension += 1) {
      const high = (corner & (2 ** dimension)) !== 0;
      pointIndex += (high ? upper[dimension] : lower[dimension]) * stride;
      weight *= high ? fractions[dimension] : 1 - fractions[dimension];
      stride *= record.size[dimension];
    }
    if (weight === 0) continue;
    const sampleOffset = pointIndex * record.outputCount;
    for (let component = 0; component < output.length; component += 1) {
      output[component] += record.samples[sampleOffset + component] * weight;
    }
  }
  return output;
}

interface CubicDimensionWeights {
  readonly indices: readonly number[];
  readonly weights: readonly number[];
}

function evaluateCubicSamples(
  record: SampledFunction,
  lower: Uint32Array,
  fractions: Float64Array,
  limits: Readonly<HeprFunctionEvaluationLimits>,
  signal?: AbortSignal
): number[] {
  const axes = new Array<CubicDimensionWeights>(record.inputCount);
  const strides = new Uint32Array(record.inputCount);
  let stride = 1;
  let work = 1;
  for (let dimension = 0; dimension < record.inputCount; dimension += 1) {
    strides[dimension] = stride;
    stride *= record.size[dimension];
    axes[dimension] = cubicDimensionWeights(
      record.size[dimension],
      lower[dimension],
      fractions[dimension]
    );
    work = checkedWorkProduct(work, axes[dimension].indices.length, limits);
  }
  assertInterpolationWork(work, limits);
  const output = new Array<number>(record.outputCount).fill(0);
  let visited = 0;
  const accumulate = (dimension: number, pointIndex: number, weight: number): void => {
    if (dimension === record.inputCount) {
      if ((visited++ & 0xff) === 0) checkAbort(signal);
      if (weight === 0) return;
      const sampleOffset = pointIndex * record.outputCount;
      for (let component = 0; component < output.length; component += 1) {
        output[component] += record.samples[sampleOffset + component] * weight;
      }
      return;
    }
    const axis = axes[dimension];
    for (let index = 0; index < axis.indices.length; index += 1) {
      accumulate(
        dimension + 1,
        pointIndex + axis.indices[index] * strides[dimension],
        weight * axis.weights[index]
      );
    }
  };
  accumulate(0, 0, 1);
  return output;
}

function cubicDimensionWeights(
  size: number,
  lower: number,
  fraction: number
): CubicDimensionWeights {
  if (fraction === 0 || size === 1) return { indices: [lower], weights: [1] };
  if (size === 2) {
    return { indices: [lower, lower + 1], weights: [1 - fraction, fraction] };
  }
  if (lower === 0) {
    const weights = cubicConvolutionWeights(fraction + 1);
    return {
      indices: [0, 1, 2],
      weights: [weights[0] + weights[1], weights[2], weights[3]]
    };
  }
  if (lower === size - 2) {
    const weights = cubicConvolutionWeights(2 - fraction);
    return {
      indices: [lower + 1, lower, lower - 1],
      weights: [weights[0] + weights[1], weights[2], weights[3]]
    };
  }
  return {
    indices: [lower - 1, lower, lower + 1, lower + 2],
    weights: cubicConvolutionWeights(fraction + 1)
  };
}

function cubicConvolutionWeights(x: number): readonly [number, number, number, number] {
  const a = -0.5;
  const xm1 = x - 1;
  const m2x = 2 - x;
  const m3x = 3 - x;
  return [
    a * x ** 3 - 5 * a * x ** 2 + 8 * a * x - 4 * a,
    (a + 2) * xm1 ** 3 - (a + 3) * xm1 ** 2 + 1,
    (a + 2) * m2x ** 3 - (a + 3) * m2x ** 2 + 1,
    a * m3x ** 3 - 5 * a * m3x ** 2 + 8 * a * m3x - 4 * a
  ];
}

const CALCULATOR_OPERATORS = [
  "abs", "add", "atan", "ceiling", "cos", "cvi", "cvr", "div", "exp", "floor",
  "idiv", "ln", "log", "mod", "mul", "neg", "round", "sin", "sqrt", "sub", "truncate",
  "eq", "ge", "gt", "le", "lt", "ne", "and", "bitshift", "not", "or", "xor",
  "copy", "dup", "exch", "index", "pop", "roll", "if", "ifelse"
] as const;

function decodeCalculatorProgram(
  bytes: Uint8Array,
  limits: Readonly<HeprFunctionEvaluationLimits>,
  functionPath: string,
  signal?: AbortSignal
): readonly CalculatorToken[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let tokens = 0;
  const decode = (nested: boolean, depth: number): readonly CalculatorToken[] => {
    if (depth > limits.maxCalculatorDepth) {
      throw evaluationError(
        HEPR_FUNCTION_EVALUATION_CODES.ResourceLimit,
        `Calculator procedure nesting exceeds limit ${limits.maxCalculatorDepth}.`,
        `${functionPath}.calculatorBytecode`
      );
    }
    const output: CalculatorToken[] = [];
    while (offset < bytes.length) {
      if ((offset & 0x3fff) === 0) checkAbort(signal);
      const tag = bytes[offset++];
      // Procedure-end markers are framing, not calculator-language tokens.
      // This matches the parser-side token accounting which counts `{` but
      // returns on `}` before consuming a token budget entry.
      if (tag !== 6 && ++tokens > limits.maxCalculatorTokens) {
        throw evaluationError(
          HEPR_FUNCTION_EVALUATION_CODES.ResourceLimit,
          `Calculator token count exceeds limit ${limits.maxCalculatorTokens}.`,
          `${functionPath}.calculatorBytecode`
        );
      }
      const tagOffset = offset - 1;
      if (tag === 6) {
        if (!nested) invalidFunction(functionPath, "calculator bytecode has an unmatched procedure end");
        return Object.freeze(output);
      }
      if (tag === 5) {
        output.push(decode(true, depth + 1));
        continue;
      }
      if (tag === 0 || tag === 1) {
        if (offset + 4 > bytes.length) invalidFunction(functionPath, "calculator literal is truncated");
        const value = tag === 0
          ? calculatorInteger(view.getInt32(offset, true), "literal", functionPath)
          : calculatorReal(view.getFloat32(offset, true), "literal", functionPath);
        offset += 4;
        output.push(value);
        continue;
      }
      if (tag === 2 || tag === 3) {
        output.push(tag === 3);
        continue;
      }
      if (tag === 4) {
        if (offset >= bytes.length) invalidFunction(functionPath, "calculator operator is truncated");
        const operator = CALCULATOR_OPERATORS[bytes[offset++]];
        if (operator === undefined) {
          invalidFunction(functionPath, `calculator operator at byte ${tagOffset} is unknown`);
        }
        output.push(operator);
        continue;
      }
      invalidFunction(functionPath, `calculator bytecode tag ${tag} is unknown`);
    }
    if (nested) invalidFunction(functionPath, "calculator procedure is unterminated");
    return Object.freeze(output);
  };
  const program = decode(false, 0);
  validateCalculatorSyntax(program, functionPath, signal);
  return program;
}

function validateCalculatorSyntax(
  program: readonly CalculatorToken[],
  functionPath: string,
  signal?: AbortSignal
): void {
  for (let index = 0; index < program.length; index += 1) {
    if ((index & 0xff) === 0) checkAbort(signal);
    const token = program[index];
    if (!isCalculatorProcedure(token)) continue;
    validateCalculatorSyntax(token, functionPath, signal);
    if (program[index + 1] === "if") continue;
    const alternate = program[index + 1];
    if (isCalculatorProcedure(alternate) && program[index + 2] === "ifelse") {
      validateCalculatorSyntax(alternate, functionPath, signal);
      index += 1;
      continue;
    }
    invalidFunction(
      functionPath,
      "calculator procedure is not directly associated with if or ifelse"
    );
  }
}

function evaluateCalculator(
  record: CalculatorFunction,
  inputs: readonly number[],
  limits: Readonly<HeprFunctionEvaluationLimits>,
  signal: AbortSignal | undefined,
  path: string
): number[] {
  const stack: CalculatorStackValue[] = inputs.map(
    (value) => calculatorReal(value, "input", path)
  );
  enforceCalculatorStack(stack, limits, path);
  let operations = 0;
  const execute = (program: readonly CalculatorToken[], depth: number): void => {
    if (depth > limits.maxCalculatorDepth) {
      throw evaluationError(
        HEPR_FUNCTION_EVALUATION_CODES.ResourceLimit,
        `Calculator execution nesting exceeds limit ${limits.maxCalculatorDepth}.`,
        path
      );
    }
    for (const token of program) {
      if (++operations > limits.maxCalculatorOperations) {
        throw evaluationError(
          HEPR_FUNCTION_EVALUATION_CODES.ResourceLimit,
          `Calculator operations exceed limit ${limits.maxCalculatorOperations}.`,
          path
        );
      }
      if ((operations & 0x3f) === 0) checkAbort(signal);
      if (typeof token !== "string") {
        stack.push(token);
      } else {
        executeCalculatorOperator(token, stack, execute, depth, limits, path);
      }
      enforceCalculatorStack(stack, limits, path);
    }
  };
  checkAbort(signal);
  execute(record.program, 0);
  if (stack.length !== record.outputCount) {
    invalidFunction(path, "calculator left the wrong number of stack results");
  }
  return stack.map((value) => {
    if (!isCalculatorNumeric(value) || !Number.isFinite(value.value)) {
      invalidFunction(path, "calculator result is not a finite number");
    }
    return value.value;
  });
}

function executeCalculatorOperator(
  operator: string,
  stack: CalculatorStackValue[],
  execute: (program: readonly CalculatorToken[], depth: number) => void,
  depth: number,
  limits: Readonly<HeprFunctionEvaluationLimits>,
  path: string
): void {
  const number = () => popNumber(stack, operator, path);
  const integer = () => popInteger(stack, operator, path);
  const boolean = () => popBoolean(stack, operator, path);
  const procedure = () => popProcedure(stack, operator, path);
  let a: CalculatorNumber;
  let b: CalculatorNumber;
  switch (operator) {
    case "abs": {
      const value = number();
      stack.push(calculatorSameTypeResult(value, Math.abs(value.value), operator, path));
      return;
    }
    case "add":
      b = number(); a = number();
      stack.push(calculatorArithmeticResult(a, b, a.value + b.value, operator, path));
      return;
    case "atan":
      b = number(); a = number();
      if (a.value === 0 && b.value === 0) calculatorDomainError(operator, path);
      stack.push(calculatorReal(
        normalizeDegrees(Math.atan2(a.value, b.value) * 180 / Math.PI),
        operator,
        path
      ));
      return;
    case "ceiling": {
      const value = number();
      stack.push(calculatorSameTypeResult(value, Math.ceil(value.value), operator, path));
      return;
    }
    case "cos": {
      const value = number();
      stack.push(calculatorReal(Math.cos(value.value * Math.PI / 180), operator, path));
      return;
    }
    case "cvi":
      stack.push(calculatorInteger(Math.trunc(number().value), operator, path));
      return;
    case "cvr":
      stack.push(calculatorReal(number().value, operator, path));
      return;
    case "div":
      b = number(); a = number();
      if (b.value === 0) calculatorDomainError(operator, path);
      stack.push(calculatorReal(a.value / b.value, operator, path));
      return;
    case "exp":
      b = number(); a = number();
      if ((a.value === 0 && b.value <= 0) || (a.value < 0 && !Number.isInteger(b.value))) {
        calculatorDomainError(operator, path);
      }
      stack.push(calculatorReal(Math.pow(a.value, b.value), operator, path));
      return;
    case "floor": {
      const value = number();
      stack.push(calculatorSameTypeResult(value, Math.floor(value.value), operator, path));
      return;
    }
    case "idiv": {
      const divisor = integer();
      const dividend = integer();
      if (divisor.value === 0) calculatorDomainError(operator, path);
      stack.push(calculatorInteger(Math.trunc(dividend.value / divisor.value), operator, path));
      return;
    }
    case "ln": {
      const value = number();
      if (value.value <= 0) calculatorDomainError(operator, path);
      stack.push(calculatorReal(Math.log(value.value), operator, path));
      return;
    }
    case "log": {
      const value = number();
      if (value.value <= 0) calculatorDomainError(operator, path);
      stack.push(calculatorReal(Math.log10(value.value), operator, path));
      return;
    }
    case "mod": {
      const divisor = integer();
      const dividend = integer();
      if (divisor.value === 0) calculatorDomainError(operator, path);
      stack.push(calculatorInteger(dividend.value % divisor.value, operator, path));
      return;
    }
    case "mul":
      b = number(); a = number();
      stack.push(calculatorArithmeticResult(a, b, a.value * b.value, operator, path));
      return;
    case "neg": {
      const value = number();
      stack.push(calculatorSameTypeResult(value, -value.value, operator, path));
      return;
    }
    case "round": {
      const value = number();
      stack.push(calculatorSameTypeResult(value, Math.floor(value.value + 0.5), operator, path));
      return;
    }
    case "sin": {
      const value = number();
      stack.push(calculatorReal(Math.sin(value.value * Math.PI / 180), operator, path));
      return;
    }
    case "sqrt": {
      const value = number();
      if (value.value < 0) calculatorDomainError(operator, path);
      stack.push(calculatorReal(Math.sqrt(value.value), operator, path));
      return;
    }
    case "sub":
      b = number(); a = number();
      stack.push(calculatorArithmeticResult(a, b, a.value - b.value, operator, path));
      return;
    case "truncate": {
      const value = number();
      stack.push(calculatorSameTypeResult(value, Math.trunc(value.value), operator, path));
      return;
    }
    case "eq":
      stack.push(calculatorEqual(popAny(stack, operator, path), popAny(stack, operator, path), operator, path));
      return;
    case "ne":
      stack.push(!calculatorEqual(popAny(stack, operator, path), popAny(stack, operator, path), operator, path));
      return;
    case "ge": b = number(); a = number(); stack.push(a.value >= b.value); return;
    case "gt": b = number(); a = number(); stack.push(a.value > b.value); return;
    case "le": b = number(); a = number(); stack.push(a.value <= b.value); return;
    case "lt": b = number(); a = number(); stack.push(a.value < b.value); return;
    case "and":
      binaryBooleanOrInteger(stack, operator, path, (x, y) => x && y, (x, y) => x & y);
      return;
    case "or":
      binaryBooleanOrInteger(stack, operator, path, (x, y) => x || y, (x, y) => x | y);
      return;
    case "xor":
      binaryBooleanOrInteger(stack, operator, path, (x, y) => x !== y, (x, y) => x ^ y);
      return;
    case "bitshift": {
      const shift = integer();
      const value = integer();
      const distance = Math.abs(shift.value);
      const result = distance >= 32
        ? 0
        : shift.value >= 0
          ? value.value << distance
          : value.value >>> distance;
      stack.push(calculatorInteger(result, operator, path));
      return;
    }
    case "not": {
      const value = popAny(stack, operator, path);
      if (typeof value === "boolean") stack.push(!value);
      else if (isCalculatorNumeric(value) && value.kind === "integer") {
        stack.push(calculatorInteger(~value.value, operator, path));
      } else calculatorTypeError(operator, path);
      return;
    }
    case "copy": {
      const count = integer();
      if (
        count.value < 0 || count.value > stack.length ||
        stack.length + count.value > limits.maxCalculatorStack
      ) calculatorStackError(operator, path);
      stack.push(...stack.slice(stack.length - count.value));
      return;
    }
    case "dup":
      stack.push(peekAny(stack, operator, path));
      return;
    case "exch": {
      const top = popAny(stack, operator, path);
      const below = popAny(stack, operator, path);
      stack.push(top, below);
      return;
    }
    case "index": {
      const index = integer();
      if (index.value < 0 || index.value >= stack.length) calculatorStackError(operator, path);
      stack.push(stack[stack.length - 1 - index.value]);
      return;
    }
    case "pop":
      popAny(stack, operator, path);
      return;
    case "roll": {
      const amount = integer();
      const count = integer();
      if (count.value < 0 || count.value > stack.length) calculatorStackError(operator, path);
      if (count.value === 0) return;
      const normalized = ((amount.value % count.value) + count.value) % count.value;
      const values = stack.splice(stack.length - count.value, count.value);
      stack.push(
        ...values.slice(count.value - normalized),
        ...values.slice(0, count.value - normalized)
      );
      return;
    }
    case "if": {
      const body = procedure();
      if (boolean()) execute(body, depth + 1);
      return;
    }
    case "ifelse": {
      const whenFalse = procedure();
      const whenTrue = procedure();
      execute(boolean() ? whenTrue : whenFalse, depth + 1);
      return;
    }
    default:
      invalidFunction(path, `unsupported calculator operator ${operator}`);
  }
}

function binaryBooleanOrInteger(
  stack: CalculatorStackValue[],
  operator: string,
  path: string,
  booleanOperation: (left: boolean, right: boolean) => boolean,
  integerOperation: (left: number, right: number) => number
): void {
  const right = popAny(stack, operator, path);
  const left = popAny(stack, operator, path);
  if (typeof left === "boolean" && typeof right === "boolean") {
    stack.push(booleanOperation(left, right));
  } else if (
    isCalculatorNumeric(left) && isCalculatorNumeric(right) &&
    left.kind === "integer" && right.kind === "integer"
  ) {
    stack.push(calculatorInteger(integerOperation(left.value, right.value), operator, path));
  } else calculatorTypeError(operator, path);
}

function popAny(
  stack: CalculatorStackValue[],
  operator: string,
  path: string
): CalculatorStackValue {
  const value = stack.pop();
  if (value === undefined) calculatorStackError(operator, path);
  return value;
}

function peekAny(
  stack: CalculatorStackValue[],
  operator: string,
  path: string
): CalculatorStackValue {
  if (stack.length === 0) calculatorStackError(operator, path);
  return stack[stack.length - 1];
}

function popNumber(
  stack: CalculatorStackValue[],
  operator: string,
  path: string
): CalculatorNumber {
  const value = popAny(stack, operator, path);
  if (!isCalculatorNumeric(value)) calculatorTypeError(operator, path);
  return value;
}

function popInteger(
  stack: CalculatorStackValue[],
  operator: string,
  path: string
): CalculatorNumber {
  const value = popNumber(stack, operator, path);
  if (value.kind !== "integer") calculatorTypeError(operator, path);
  return value;
}

function popBoolean(
  stack: CalculatorStackValue[],
  operator: string,
  path: string
): boolean {
  const value = popAny(stack, operator, path);
  if (typeof value !== "boolean") calculatorTypeError(operator, path);
  return value;
}

function popProcedure(
  stack: CalculatorStackValue[],
  operator: string,
  path: string
): readonly CalculatorToken[] {
  const value = popAny(stack, operator, path);
  if (!Array.isArray(value)) calculatorTypeError(operator, path);
  return value as readonly CalculatorToken[];
}

function calculatorInteger(value: number, operator: string, path: string): CalculatorNumber {
  if (!Number.isInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff) {
    calculatorDomainError(operator, path);
  }
  return Object.freeze({ kind: "integer", value: value === 0 ? 0 : value });
}

function calculatorReal(value: number, operator: string, path: string): CalculatorNumber {
  const rounded = Math.fround(value);
  if (!Number.isFinite(rounded)) calculatorDomainError(operator, path);
  return Object.freeze({ kind: "real", value: rounded });
}

function calculatorArithmeticResult(
  left: CalculatorNumber,
  right: CalculatorNumber,
  result: number,
  operator: string,
  path: string
): CalculatorNumber {
  if (
    left.kind === "integer" && right.kind === "integer" && Number.isInteger(result) &&
    result >= -0x8000_0000 && result <= 0x7fff_ffff
  ) return calculatorInteger(result, operator, path);
  return calculatorReal(result, operator, path);
}

function calculatorSameTypeResult(
  operand: CalculatorNumber,
  result: number,
  operator: string,
  path: string
): CalculatorNumber {
  if (operand.kind === "integer" && result >= -0x8000_0000 && result <= 0x7fff_ffff) {
    return calculatorInteger(result, operator, path);
  }
  return calculatorReal(result, operator, path);
}

function calculatorEqual(
  left: CalculatorStackValue,
  right: CalculatorStackValue,
  operator: string,
  path: string
): boolean {
  if (isCalculatorProcedure(left) || isCalculatorProcedure(right)) {
    calculatorTypeError(operator, path);
  }
  if (isCalculatorNumeric(left) && isCalculatorNumeric(right)) return left.value === right.value;
  return left === right;
}

function calculatorStackError(operator: string, path: string): never {
  invalidFunction(path, `calculator stack error in ${operator}`);
}

function calculatorTypeError(operator: string, path: string): never {
  invalidFunction(path, `calculator type error in ${operator}`);
}

function calculatorDomainError(operator: string, path: string): never {
  invalidFunction(path, `calculator numeric domain error in ${operator}`);
}

function enforceCalculatorStack(
  stack: readonly CalculatorStackValue[],
  limits: Readonly<HeprFunctionEvaluationLimits>,
  path: string
): void {
  if (stack.length > limits.maxCalculatorStack) {
    throw evaluationError(
      HEPR_FUNCTION_EVALUATION_CODES.ResourceLimit,
      `Calculator stack exceeds limit ${limits.maxCalculatorStack}.`,
      path
    );
  }
  if (stack.some((value) => isCalculatorNumeric(value) && !Number.isFinite(value.value))) {
    invalidFunction(path, "calculator produced a non-finite intermediate value");
  }
}

function isCalculatorNumeric(value: unknown): value is CalculatorNumber {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    ((value as CalculatorNumber).kind === "integer" ||
      (value as CalculatorNumber).kind === "real") &&
    typeof (value as CalculatorNumber).value === "number";
}

function isCalculatorProcedure(value: unknown): value is readonly CalculatorToken[] {
  return Array.isArray(value);
}

function normalizeLimits(
  overrides: Partial<HeprFunctionEvaluationLimits> | undefined
): Readonly<HeprFunctionEvaluationLimits> {
  const limits = { ...DEFAULT_HEPR_FUNCTION_EVALUATION_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`HEPR function limit ${name} must be a positive safe integer.`);
    }
  }
  if (limits.maxInputs > 16) {
    throw new RangeError("HEPR function maxInputs cannot exceed 16.");
  }
  if (limits.maxFunctions > 0x00ff_ffff || limits.maxOutputs > 0x0100_0000) {
    throw new RangeError(
      "HEPR function count and output limits cannot exceed exactly representable Float32 integers."
    );
  }
  if (limits.maxFunctionDepth > 64 || limits.maxCalculatorDepth > 64) {
    throw new RangeError("HEPR function recursion limits cannot exceed 64.");
  }
  if (limits.maxStoreValues > 0xffff_ffff) {
    throw new RangeError("HEPR function store limit cannot exceed Uint32 capacity.");
  }
  return Object.freeze(limits);
}

function requireTypedArray<T extends ArrayBufferView>(
  value: unknown,
  constructor: { new (...args: never[]): T },
  path: string
): asserts value is T {
  if (!(value instanceof constructor)) {
    throw evaluationError(
      HEPR_FUNCTION_EVALUATION_CODES.InvalidStore,
      `Expected ${constructor.name}.`,
      path
    );
  }
}

function floatSpan(
  values: Float32Array,
  offsets: Uint32Array,
  index: number,
  path: string
): Float32Array {
  const start = offsets[index];
  const end = offsets[index + 1];
  if (start > end || end > values.length) {
    throw evaluationError(
      HEPR_FUNCTION_EVALUATION_CODES.InvalidStore,
      "Offset span is out of range.",
      path
    );
  }
  return values.subarray(start, end);
}

function assertFiniteNumbers(
  values: ArrayLike<number>,
  path: string,
  signal?: AbortSignal
): void {
  for (let index = 0; index < values.length; index += 1) {
    if ((index & 0x3fff) === 0) checkAbort(signal);
    if (!Number.isFinite(values[index])) {
      throw evaluationError(
        HEPR_FUNCTION_EVALUATION_CODES.InvalidStore,
        "Numeric payload contains a non-finite value.",
        path
      );
    }
  }
}

function validateNormalizedSamples(
  values: Float32Array,
  path: string,
  signal?: AbortSignal
): void {
  for (let index = 0; index < values.length; index += 1) {
    if ((index & 0x3fff) === 0) checkAbort(signal);
    const value = values[index];
    if (!Number.isFinite(value)) {
      throw evaluationError(
        HEPR_FUNCTION_EVALUATION_CODES.InvalidStore,
        "Sample payload contains a non-finite value.",
        path
      );
    }
    if (value < 0 || value > 1) {
      invalidFunction(path, "normalized sample value is outside [0, 1]");
    }
  }
}

function normalizeFunctionInputs(
  value: unknown,
  limits: Readonly<HeprFunctionEvaluationLimits>,
  signal?: AbortSignal
): number[] {
  if (typeof value !== "object" || value === null) {
    throw evaluationError(
      HEPR_FUNCTION_EVALUATION_CODES.InvalidInput,
      "Function inputs must be an array-like finite-number sequence.",
      "inputs"
    );
  }
  const inputs = value as { readonly length?: unknown; readonly [index: number]: unknown };
  if (!Number.isSafeInteger(inputs.length) || (inputs.length as number) < 0) {
    throw evaluationError(
      HEPR_FUNCTION_EVALUATION_CODES.InvalidInput,
      "Function inputs have an invalid length.",
      "inputs"
    );
  }
  const length = inputs.length as number;
  if (length > limits.maxInputs) {
    throw evaluationError(
      HEPR_FUNCTION_EVALUATION_CODES.ResourceLimit,
      `Function input count exceeds limit ${limits.maxInputs}.`,
      "inputs"
    );
  }
  const output = new Array<number>(length);
  for (let index = 0; index < length; index += 1) {
    checkAbort(signal);
    const input = inputs[index];
    if (typeof input !== "number" || !Number.isFinite(input)) {
      throw evaluationError(
        HEPR_FUNCTION_EVALUATION_CODES.InvalidInput,
        "Function input contains a non-finite number.",
        `inputs[${index}]`
      );
    }
    output[index] = input;
  }
  return output;
}

function validatePairs(
  values: readonly number[],
  expectedPairs: number,
  nondecreasing: boolean,
  path: string
): void {
  if (values.length !== expectedPairs * 2) invalidFunction(path, "pair array has invalid arity");
  if (!nondecreasing) return;
  for (let index = 0; index < values.length; index += 2) {
    if (values[index] > values[index + 1]) invalidFunction(path, "pair interval is reversed");
  }
}

function exactInteger(value: number, path: string): number {
  if (!Number.isSafeInteger(value)) invalidFunction(path, "expected an exact integer");
  return value;
}

function exactPositiveInteger(value: number, limit: number, path: string): number {
  const integer = exactInteger(value, path);
  if (integer <= 0) invalidFunction(path, "expected a positive integer");
  if (integer > limit) {
    throw evaluationError(
      HEPR_FUNCTION_EVALUATION_CODES.ResourceLimit,
      `${path} exceeds limit ${limit}.`,
      path
    );
  }
  return integer;
}

function checkedProduct(
  values: readonly number[],
  trailing: number,
  limit: number,
  path: string
): number {
  let product = trailing;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value <= 0 || product > Math.floor(limit / value)) {
      throw evaluationError(
        HEPR_FUNCTION_EVALUATION_CODES.ResourceLimit,
        `Sample storage exceeds limit ${limit}.`,
        path
      );
    }
    product *= value;
  }
  return product;
}

function checkedWorkProduct(
  current: number,
  factor: number,
  limits: Readonly<HeprFunctionEvaluationLimits>
): number {
  if (current > Math.floor(limits.maxInterpolationSamples / factor)) {
    throw evaluationError(
      HEPR_FUNCTION_EVALUATION_CODES.ResourceLimit,
      `Interpolation work exceeds limit ${limits.maxInterpolationSamples}.`,
      "interpolation"
    );
  }
  return current * factor;
}

function assertInterpolationWork(
  count: number,
  limits: Readonly<HeprFunctionEvaluationLimits>
): void {
  if (!Number.isSafeInteger(count) || count > limits.maxInterpolationSamples) {
    throw evaluationError(
      HEPR_FUNCTION_EVALUATION_CODES.ResourceLimit,
      `Interpolation work exceeds limit ${limits.maxInterpolationSamples}.`,
      "interpolation"
    );
  }
}

function clampPairs(values: readonly number[], pairs: readonly number[]): number[] {
  return values.map((value, index) => clamp(value, pairs[index * 2], pairs[index * 2 + 1]));
}

function clamp(value: number, first: number, second: number): number {
  return Math.max(Math.min(first, second), Math.min(Math.max(first, second), value));
}

function interpolate(value: number, x0: number, x1: number, y0: number, y1: number): number {
  if (x0 === x1) return y0;
  return y0 + ((value - x0) * (y1 - y0)) / (x1 - x0);
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function checkAbort(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw evaluationError(
    HEPR_FUNCTION_EVALUATION_CODES.Aborted,
    "Function evaluation was aborted.",
    "signal",
    signal.reason
  );
}

function invalidFunction(path: string, message: string): never {
  throw evaluationError(
    HEPR_FUNCTION_EVALUATION_CODES.InvalidFunction,
    message,
    path
  );
}

function evaluationError(
  code: HeprFunctionEvaluationCode,
  message: string,
  path?: string,
  cause?: unknown
): HeprFunctionEvaluationError {
  return new HeprFunctionEvaluationError(code, message, { path, cause });
}
