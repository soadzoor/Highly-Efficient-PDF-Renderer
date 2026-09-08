import {
  isPdfDictionary,
  isPdfRef,
  isPdfStream,
  pdfRefKey,
  type PdfDictionary,
  type PdfStream,
  type PdfValue
} from "./nativeCos";
import type { NativePdfDocument } from "./nativeDocument";
import { PdfError, throwIfAborted } from "./nativeTypes";
import {
  HEPR_FUNCTION_KIND,
  type HeprFunctionStore
} from "../heprDocumentData";

export interface NativePdfFunctionLimits {
  readonly maxFunctions: number;
  readonly maxFunctionDepth: number;
  readonly maxInputs: number;
  readonly maxOutputs: number;
  readonly maxSampleValues: number;
  readonly maxStoreValues: number;
  readonly maxCalculatorBytes: number;
  readonly maxCalculatorTokens: number;
  readonly maxCalculatorDepth: number;
  readonly maxCalculatorStack: number;
  readonly maxCalculatorOperations: number;
}

export const DEFAULT_NATIVE_PDF_FUNCTION_LIMITS: Readonly<NativePdfFunctionLimits> = Object.freeze({
  maxFunctions: 4_096,
  maxFunctionDepth: 64,
  maxInputs: 8,
  maxOutputs: 32,
  maxSampleValues: 16_777_216,
  maxStoreValues: 16_777_216,
  maxCalculatorBytes: 1_048_576,
  maxCalculatorTokens: 4_096,
  maxCalculatorDepth: 16,
  maxCalculatorStack: 256,
  maxCalculatorOperations: 16_384
});

export interface NativePdfFunctionDescription {
  readonly functionType: 0 | 2 | 3 | 4;
  readonly inputCount: number;
  readonly outputCount: number;
  readonly domain: readonly number[];
  readonly range: readonly number[] | null;
  /** Stable HEPR v7 parameter encoding documented by `buildStore()`. */
  readonly parameters: readonly number[];
  readonly samples: readonly number[];
  readonly calculatorBytecode: Uint8Array;
}

interface SampledFunction extends NativePdfFunctionDescription {
  readonly functionType: 0;
  readonly size: readonly number[];
  readonly bitsPerSample: number;
  readonly order: 1 | 3;
  readonly encode: readonly number[];
  readonly decode: readonly number[];
}

interface ExponentialFunction extends NativePdfFunctionDescription {
  readonly functionType: 2;
  readonly exponent: number;
  readonly c0: readonly number[];
  readonly c1: readonly number[];
}

interface StitchingFunction extends NativePdfFunctionDescription {
  readonly functionType: 3;
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

interface CalculatorFunction extends NativePdfFunctionDescription {
  readonly functionType: 4;
  readonly program: readonly CalculatorToken[];
}

type ParsedFunction = SampledFunction | ExponentialFunction | StitchingFunction | CalculatorFunction;

interface ParseStack {
  readonly refs: ReadonlySet<string>;
  readonly objects: ReadonlySet<object>;
  readonly depth: number;
}

/**
 * Resolves, validates, evaluates, deduplicates, and serializes PDF function
 * objects. The evaluator contains no loops from PDF input: type 4 programs are
 * a bounded, loop-free instruction language with bounded procedures and stack.
 */
export class NativePdfFunctionRegistry {
  private readonly document: NativePdfDocument;
  private readonly limits: Readonly<NativePdfFunctionLimits>;
  private readonly records: ParsedFunction[] = [];
  private readonly refCache = new Map<string, Promise<number>>();
  private readonly objectCache = new WeakMap<object, Promise<number>>();
  private domainValueCount = 0;
  private rangeValueCount = 0;
  private parameterValueCount = 0;
  private sampleValueCount = 0;
  private calculatorByteCount = 0;

  constructor(
    document: NativePdfDocument,
    limits: Partial<NativePdfFunctionLimits> = {}
  ) {
    this.document = document;
    this.limits = mergeFunctionLimits(limits);
  }

  get size(): number {
    return this.records.length;
  }

  async add(value: PdfValue, signal?: AbortSignal): Promise<number> {
    throwIfAborted(signal);
    return await this.addInternal(value, { refs: new Set(), objects: new Set(), depth: 0 }, signal);
  }

  describe(index: number): Readonly<NativePdfFunctionDescription> {
    return this.getRecord(index);
  }

  evaluate(index: number, inputs: readonly number[], signal?: AbortSignal): Float64Array {
    return this.evaluateInternal(index, inputs, 0, signal);
  }

  private evaluateInternal(
    index: number,
    inputs: readonly number[],
    depth: number,
    signal?: AbortSignal
  ): Float64Array {
    throwIfAborted(signal);
    if (depth >= this.limits.maxFunctionDepth) {
      throw new PdfError("resource-limit", "PDF function evaluation nesting exceeds its limit.");
    }
    const functionValue = this.getRecord(index);
    if (inputs.length !== functionValue.inputCount) {
      throw new PdfError(
        "invalid-object",
        `PDF function ${index} expects ${functionValue.inputCount} inputs, received ${inputs.length}.`
      );
    }
    if (inputs.some((value) => !Number.isFinite(value))) {
      throw new PdfError("invalid-object", "A PDF function input is not a finite number.");
    }
    const boundedInputs = clampPairs(inputs, functionValue.domain);
    let output: number[];
    switch (functionValue.functionType) {
      case 0:
        output = evaluateSampled(functionValue, boundedInputs, signal);
        break;
      case 2:
        output = evaluateExponential(functionValue, boundedInputs);
        break;
      case 3:
        output = this.evaluateStitching(functionValue, boundedInputs, depth, signal);
        break;
      case 4:
        output = evaluateCalculator(functionValue, boundedInputs, this.limits, signal);
        break;
    }
    for (const component of output) {
      if (!Number.isFinite(component)) {
        throw new PdfError("invalid-object", "A PDF function produced a non-finite result.");
      }
    }
    if (functionValue.range) output = clampPairs(output, functionValue.range);
    return Float64Array.from(output);
  }

  /**
   * Build the HEPR function store. Parameter encodings are:
   *
   * - type 0: `[inputCount, outputCount, bits, order, size..., encode..., decode...]`
   * - type 2: `[inputCount, outputCount, exponent, C0..., C1...]`
   * - type 3: `[inputCount, outputCount, childCount, childIndices..., bounds..., encode...]`
   * - type 4: `[inputCount, outputCount]`, with validated bytecode in its byte span
   */
  buildStore(signal?: AbortSignal): HeprFunctionStore {
    const domainOffsets = [0];
    const rangeOffsets = [0];
    const parameterOffsets = [0];
    const sampleOffsets = [0];
    const calculatorOffsets = [0];
    const domains: number[] = [];
    const ranges: number[] = [];
    const parameters: number[] = [];
    const samples: number[] = [];
    const calculatorBytes: number[] = [];
    const kinds = new Uint8Array(this.records.length);
    for (let index = 0; index < this.records.length; index += 1) {
      throwIfAborted(signal);
      const record = this.records[index];
      kinds[index] = record.functionType === 0
        ? HEPR_FUNCTION_KIND.Sampled
        : record.functionType === 2
          ? HEPR_FUNCTION_KIND.Exponential
          : record.functionType === 3
            ? HEPR_FUNCTION_KIND.Stitching
            : HEPR_FUNCTION_KIND.Calculator;
      appendBoundedNumbers(domains, record.domain, this.limits.maxStoreValues, "domain", signal);
      if (record.range) {
        appendBoundedNumbers(ranges, record.range, this.limits.maxStoreValues, "range", signal);
      }
      appendBoundedNumbers(
        parameters,
        record.parameters,
        this.limits.maxStoreValues,
        "parameter",
        signal
      );
      appendBoundedNumbers(samples, record.samples, this.limits.maxStoreValues, "sample", signal);
      appendBoundedBytes(
        calculatorBytes,
        record.calculatorBytecode,
        this.limits.maxStoreValues,
        signal
      );
      domainOffsets.push(domains.length);
      rangeOffsets.push(ranges.length);
      parameterOffsets.push(parameters.length);
      sampleOffsets.push(samples.length);
      calculatorOffsets.push(calculatorBytes.length);
    }
    return {
      kinds,
      domainOffsets: Uint32Array.from(domainOffsets),
      domains: Float32Array.from(domains),
      rangeOffsets: Uint32Array.from(rangeOffsets),
      ranges: Float32Array.from(ranges),
      parameterOffsets: Uint32Array.from(parameterOffsets),
      parameters: Float32Array.from(parameters),
      sampleOffsets: Uint32Array.from(sampleOffsets),
      samples: Float32Array.from(samples),
      calculatorOffsets: Uint32Array.from(calculatorOffsets),
      calculatorBytecode: Uint8Array.from(calculatorBytes)
    };
  }

  private async addInternal(
    value: PdfValue,
    stack: ParseStack,
    signal?: AbortSignal
  ): Promise<number> {
    throwIfAborted(signal);
    if (stack.depth >= this.limits.maxFunctionDepth) {
      throw new PdfError("resource-limit", "PDF function graph nesting exceeds its limit.");
    }
    if (isPdfRef(value)) {
      const key = pdfRefKey(value);
      if (stack.refs.has(key)) {
        throw new PdfError("invalid-object", "A PDF function graph contains a cycle.", {
          objectNumber: value.objectNumber
        });
      }
      const cached = this.refCache.get(key);
      if (cached) return await cached;
      const refs = new Set(stack.refs);
      refs.add(key);
      const promise = this.document.resolveObject(value, signal)
        .then((resolved) => this.parseAndAppend(
          resolved,
          { refs, objects: stack.objects, depth: stack.depth + 1 },
          signal
        ));
      this.refCache.set(key, promise);
      try {
        return await promise;
      } catch (error) {
        this.refCache.delete(key);
        throw error;
      }
    }
    if (!isObjectValue(value)) {
      throw new PdfError("invalid-object", "A PDF function must be a dictionary or stream.");
    }
    if (stack.objects.has(value)) {
      throw new PdfError("invalid-object", "A direct PDF function graph contains a cycle.");
    }
    const cached = this.objectCache.get(value);
    if (cached) return await cached;
    const objects = new Set(stack.objects);
    objects.add(value);
    const promise = this.parseAndAppend(
      value,
      { refs: stack.refs, objects, depth: stack.depth + 1 },
      signal
    );
    this.objectCache.set(value, promise);
    try {
      return await promise;
    } catch (error) {
      this.objectCache.delete(value);
      throw error;
    }
  }

  private async parseAndAppend(
    value: PdfValue,
    stack: ParseStack,
    signal?: AbortSignal
  ): Promise<number> {
    const stream = isPdfStream(value) ? value : null;
    const dictionary = stream?.dictionary ?? (isPdfDictionary(value) ? value : null);
    if (!dictionary) {
      throw new PdfError("invalid-object", "A PDF function must resolve to a dictionary or stream.");
    }
    const functionType = await requiredInteger(this.document, dictionary, "FunctionType", signal);
    const domain = await requiredNumberArray(
      this.document,
      dictionary,
      "Domain",
      this.limits.maxInputs * 2,
      signal
    );
    validatePairs(domain, "Function Domain", this.limits.maxInputs, "nondecreasing");
    const range = dictionary.has("Range")
      ? await requiredNumberArray(
        this.document,
        dictionary,
        "Range",
        this.limits.maxOutputs * 2,
        signal
      )
      : null;
    if (range) validatePairs(range, "Function Range", this.limits.maxOutputs, "nondecreasing");
    let record: ParsedFunction;
    switch (functionType) {
      case 0:
        if (!stream) throw new PdfError("invalid-object", "A sampled PDF function must be a stream.");
        record = await this.parseSampled(stream, domain, range, signal);
        break;
      case 2:
        record = await this.parseExponential(dictionary, domain, range, signal);
        break;
      case 3:
        record = await this.parseStitching(dictionary, domain, range, stack, signal);
        break;
      case 4:
        if (!stream) throw new PdfError("invalid-object", "A calculator PDF function must be a stream.");
        record = await this.parseCalculator(stream, domain, range, signal);
        break;
      default:
        throw new PdfError("unsupported-content", `Unsupported PDF FunctionType ${functionType}.`, {
          details: { functionType }
        });
    }
    throwIfAborted(signal);
    const index = this.records.length;
    if (index >= this.limits.maxFunctions) {
      throw new PdfError("resource-limit", "PDF function count exceeds its configured limit.");
    }
    this.reserveStoreValues(record);
    this.records.push(Object.freeze(record) as ParsedFunction);
    return index;
  }

  private reserveStoreValues(record: ParsedFunction): void {
    const nextDomain = checkedStoreLength(
      this.domainValueCount,
      record.domain.length,
      this.limits.maxStoreValues,
      "domain"
    );
    const nextRange = checkedStoreLength(
      this.rangeValueCount,
      record.range?.length ?? 0,
      this.limits.maxStoreValues,
      "range"
    );
    const nextParameters = checkedStoreLength(
      this.parameterValueCount,
      record.parameters.length,
      this.limits.maxStoreValues,
      "parameter"
    );
    const nextSamples = checkedStoreLength(
      this.sampleValueCount,
      record.samples.length,
      this.limits.maxStoreValues,
      "sample"
    );
    const nextCalculator = checkedStoreLength(
      this.calculatorByteCount,
      record.calculatorBytecode.length,
      this.limits.maxStoreValues,
      "calculator bytecode"
    );
    this.domainValueCount = nextDomain;
    this.rangeValueCount = nextRange;
    this.parameterValueCount = nextParameters;
    this.sampleValueCount = nextSamples;
    this.calculatorByteCount = nextCalculator;
  }

  private async parseSampled(
    stream: PdfStream,
    domain: readonly number[],
    range: readonly number[] | null,
    signal?: AbortSignal
  ): Promise<SampledFunction> {
    const dictionary = stream.dictionary;
    if (!range) {
      throw new PdfError("invalid-object", "A sampled PDF function requires Range.");
    }
    const size = await requiredIntegerArray(
      this.document,
      dictionary,
      "Size",
      this.limits.maxInputs,
      signal
    );
    const inputCount = domain.length / 2;
    if (size.length !== inputCount || size.some((entry) => entry <= 0)) {
      throw new PdfError("invalid-object", "A sampled PDF function has an invalid Size array.");
    }
    if (size.some((entry) => entry > this.limits.maxSampleValues)) {
      throw new PdfError("resource-limit", "A sampled PDF function Size exceeds its configured limit.");
    }
    const bitsPerSample = await requiredInteger(this.document, dictionary, "BitsPerSample", signal);
    if (![1, 2, 4, 8, 12, 16, 24, 32].includes(bitsPerSample)) {
      throw new PdfError("unsupported-content", `Unsupported sampled-function precision ${bitsPerSample}.`);
    }
    const order = await optionalInteger(this.document, dictionary, "Order", 1, signal);
    if (order !== 1 && order !== 3) {
      throw new PdfError("invalid-object", "A sampled PDF function has an invalid interpolation Order.");
    }
    const encode = dictionary.has("Encode")
      ? await requiredNumberArray(
        this.document,
        dictionary,
        "Encode",
        this.limits.maxInputs * 2,
        signal
      )
      : size.flatMap((entry) => [0, entry - 1]);
    if (encode.length !== inputCount * 2) {
      throw new PdfError("invalid-object", "A sampled PDF function has an invalid Encode array.");
    }
    const decode = dictionary.has("Decode")
      ? await requiredNumberArray(
        this.document,
        dictionary,
        "Decode",
        this.limits.maxOutputs * 2,
        signal
      )
      : range;
    validatePairs(decode, "Function Decode", this.limits.maxOutputs, "none");
    const outputCount = decode.length / 2;
    if (range.length / 2 !== outputCount) {
      throw new PdfError("invalid-object", "A sampled function's Decode and Range sizes differ.");
    }
    const pointCount = checkedProduct(size, this.limits.maxSampleValues);
    const sampleCount = checkedProduct([pointCount, outputCount], this.limits.maxSampleValues);
    const bytes = await this.document.decodeStream(stream, signal);
    const requiredBits = checkedMultiply(
      sampleCount,
      bitsPerSample,
      Number.MAX_SAFE_INTEGER,
      "PDF function sample bit count exceeds the safe integer range."
    );
    if (bytes.length < Math.ceil(requiredBits / 8)) {
      throw new PdfError("invalid-object", "A sampled PDF function stream is truncated.");
    }
    const samples = unpackNormalizedSamples(bytes, sampleCount, bitsPerSample, signal);
    return {
      functionType: 0,
      inputCount,
      outputCount,
      domain,
      range,
      size,
      bitsPerSample,
      order,
      encode,
      decode,
      parameters: [inputCount, outputCount, bitsPerSample, order, ...size, ...encode, ...decode],
      samples,
      calculatorBytecode: new Uint8Array(0)
    };
  }

  private async parseExponential(
    dictionary: PdfDictionary,
    domain: readonly number[],
    range: readonly number[] | null,
    signal?: AbortSignal
  ): Promise<ExponentialFunction> {
    if (domain.length !== 2) {
      throw new PdfError("invalid-object", "An exponential PDF function must have one input.");
    }
    const exponent = await requiredNumber(this.document, dictionary, "N", signal);
    if (!Number.isInteger(exponent) && domain[0] < 0) {
      throw new PdfError(
        "invalid-object",
        "An exponential PDF function with a non-integer exponent requires a nonnegative Domain."
      );
    }
    if (exponent < 0 && domain[0] <= 0 && domain[1] >= 0) {
      throw new PdfError(
        "invalid-object",
        "An exponential PDF function with a negative exponent cannot include zero in its Domain."
      );
    }
    const c0 = dictionary.has("C0")
      ? await requiredNumberArray(
        this.document,
        dictionary,
        "C0",
        this.limits.maxOutputs,
        signal
      )
      : [0];
    const c1 = dictionary.has("C1")
      ? await requiredNumberArray(
        this.document,
        dictionary,
        "C1",
        this.limits.maxOutputs,
        signal
      )
      : [1];
    if (c0.length === 0 || c0.length !== c1.length || c0.length > this.limits.maxOutputs) {
      throw new PdfError("invalid-object", "An exponential PDF function has incompatible C0/C1 arrays.");
    }
    if (range && range.length !== c0.length * 2) {
      throw new PdfError("invalid-object", "An exponential PDF function has an incompatible Range.");
    }
    return {
      functionType: 2,
      inputCount: 1,
      outputCount: c0.length,
      domain,
      range,
      exponent,
      c0,
      c1,
      parameters: [1, c0.length, exponent, ...c0, ...c1],
      samples: [],
      calculatorBytecode: new Uint8Array(0)
    };
  }

  private async parseStitching(
    dictionary: PdfDictionary,
    domain: readonly number[],
    range: readonly number[] | null,
    stack: ParseStack,
    signal?: AbortSignal
  ): Promise<StitchingFunction> {
    if (domain.length !== 2) {
      throw new PdfError("invalid-object", "A stitching PDF function must have one input.");
    }
    const rawFunctions = await resolveRawArray(
      this.document,
      dictionary.get("Functions"),
      this.limits.maxFunctions,
      signal
    );
    if (rawFunctions.length === 0 || rawFunctions.length > this.limits.maxFunctions) {
      throw new PdfError("resource-limit", "A stitching PDF function contains too many subfunctions.");
    }
    const childIndices: number[] = [];
    for (const child of rawFunctions) childIndices.push(await this.addInternal(child, stack, signal));
    const bounds = await requiredNumberArray(
      this.document,
      dictionary,
      "Bounds",
      this.limits.maxFunctions - 1,
      signal
    );
    const encode = await requiredNumberArray(
      this.document,
      dictionary,
      "Encode",
      this.limits.maxFunctions * 2,
      signal
    );
    if (bounds.length !== childIndices.length - 1 || encode.length !== childIndices.length * 2) {
      throw new PdfError("invalid-object", "A stitching PDF function has invalid Bounds or Encode arrays.");
    }
    if (childIndices.length > 1 && !(domain[0] < domain[1])) {
      throw new PdfError(
        "invalid-object",
        "A stitching PDF function with multiple subfunctions requires a non-empty Domain."
      );
    }
    let previous = domain[0];
    for (let index = 0; index < bounds.length; index += 1) {
      const bound = bounds[index];
      const isLast = index === bounds.length - 1;
      // The one explicit ISO exception permits only the last bound to equal
      // Domain[1]. That creates a final point subdomain evaluated at Encode[2i].
      // Repeated bounds are accepted as the empty subdomain they describe, not
      // rejected as disorder: evaluateStitching selects the first bound strictly
      // above the input, so a segment between two equal bounds is unreachable and
      // its subfunction is never evaluated. Only a decreasing bound is disorder.
      if (!(bound >= previous && (bound < domain[1] || (isLast && bound === domain[1])))) {
        throw new PdfError("invalid-object", "A stitching PDF function has unordered Bounds.");
      }
      previous = bound;
    }
    const first = this.getRecord(childIndices[0]);
    if (first.inputCount !== 1) {
      throw new PdfError("invalid-object", "A stitching subfunction must accept one input.");
    }
    for (const index of childIndices.slice(1)) {
      const child = this.getRecord(index);
      if (child.inputCount !== 1 || child.outputCount !== first.outputCount) {
        throw new PdfError("invalid-object", "Stitching subfunctions have incompatible arity.");
      }
    }
    if (range && range.length !== first.outputCount * 2) {
      throw new PdfError("invalid-object", "A stitching PDF function has an incompatible Range.");
    }
    return {
      functionType: 3,
      inputCount: 1,
      outputCount: first.outputCount,
      domain,
      range,
      childIndices,
      bounds,
      encode,
      parameters: [1, first.outputCount, childIndices.length, ...childIndices, ...bounds, ...encode],
      samples: [],
      calculatorBytecode: new Uint8Array(0)
    };
  }

  private async parseCalculator(
    stream: PdfStream,
    domain: readonly number[],
    range: readonly number[] | null,
    signal?: AbortSignal
  ): Promise<CalculatorFunction> {
    if (!range) throw new PdfError("invalid-object", "A calculator PDF function requires Range.");
    const inputCount = domain.length / 2;
    const outputCount = range.length / 2;
    const bytes = await this.document.decodeStream(stream, signal);
    if (bytes.length > this.limits.maxCalculatorBytes) {
      throw new PdfError("resource-limit", "Calculator function stream exceeds its configured byte limit.");
    }
    const parser = new CalculatorParser(bytes, this.limits, signal);
    const program = parser.parse();
    const calculatorBytecode = encodeCalculatorProgram(program, signal);
    return {
      functionType: 4,
      inputCount,
      outputCount,
      domain,
      range,
      program,
      parameters: [inputCount, outputCount],
      samples: [],
      calculatorBytecode
    };
  }

  private evaluateStitching(
    functionValue: StitchingFunction,
    inputs: readonly number[],
    depth: number,
    signal?: AbortSignal
  ): number[] {
    throwIfAborted(signal);
    const input = inputs[0];
    let segment = functionValue.bounds.findIndex((bound) => input < bound);
    if (segment < 0) segment = functionValue.childIndices.length - 1;
    const lower = segment === 0 ? functionValue.domain[0] : functionValue.bounds[segment - 1];
    const upper = segment === functionValue.bounds.length
      ? functionValue.domain[1]
      : functionValue.bounds[segment];
    const encoded = interpolate(
      input,
      lower,
      upper,
      functionValue.encode[segment * 2],
      functionValue.encode[segment * 2 + 1]
    );
    return [...this.evaluateInternal(functionValue.childIndices[segment], [encoded], depth + 1, signal)];
  }

  private getRecord(index: number): ParsedFunction {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.records.length) {
      throw new RangeError(`PDF function index ${index} is out of range.`);
    }
    return this.records[index];
  }
}

function evaluateSampled(
  functionValue: SampledFunction,
  inputs: readonly number[],
  signal?: AbortSignal
): number[] {
  const dimensions = functionValue.inputCount;
  const lower = new Uint32Array(dimensions);
  const upper = new Uint32Array(dimensions);
  const fractions = new Float64Array(dimensions);
  for (let index = 0; index < dimensions; index += 1) {
    const encoded = clamp(
      interpolate(
        inputs[index],
        functionValue.domain[index * 2],
        functionValue.domain[index * 2 + 1],
        functionValue.encode[index * 2],
        functionValue.encode[index * 2 + 1]
      ),
      0,
      functionValue.size[index] - 1
    );
    lower[index] = Math.floor(encoded);
    upper[index] = Math.ceil(encoded);
    fractions[index] = encoded - lower[index];
  }
  const output = functionValue.order === 3
    ? evaluateCubicSampleTable(functionValue, lower, fractions, signal)
    : evaluateLinearSampleTable(functionValue, lower, upper, fractions, signal);
  for (let component = 0; component < output.length; component += 1) {
    output[component] = interpolate(
      output[component],
      0,
      1,
      functionValue.decode[component * 2],
      functionValue.decode[component * 2 + 1]
    );
  }
  return output;
}

function evaluateLinearSampleTable(
  functionValue: SampledFunction,
  lower: Uint32Array,
  upper: Uint32Array,
  fractions: Float64Array,
  signal?: AbortSignal
): number[] {
  const dimensions = functionValue.inputCount;
  const output = Array.from<number>({ length: functionValue.outputCount }).fill(0);
  const cornerCount = 1 << dimensions;
  for (let corner = 0; corner < cornerCount; corner += 1) {
    if ((corner & 0xff) === 0) throwIfAborted(signal);
    let pointIndex = 0;
    let stride = 1;
    let weight = 1;
    for (let dimension = 0; dimension < dimensions; dimension += 1) {
      const high = (corner & (1 << dimension)) !== 0;
      pointIndex += (high ? upper[dimension] : lower[dimension]) * stride;
      weight *= high ? fractions[dimension] : 1 - fractions[dimension];
      stride *= functionValue.size[dimension];
    }
    if (weight === 0) continue;
    const sampleOffset = pointIndex * functionValue.outputCount;
    for (let component = 0; component < output.length; component += 1) {
      output[component] += functionValue.samples[sampleOffset + component] * weight;
    }
  }
  return output;
}

interface CubicDimensionWeights {
  readonly indices: readonly number[];
  readonly weights: readonly number[];
}

/**
 * Acrobat-compatible tensor-product cubic convolution for sampled functions.
 * The `a = -0.5` kernel and duplicated boundary samples match Ghostscript's
 * long-standing PDF implementation. Dimensions with fewer than four samples
 * naturally degrade to quadratic or linear interpolation as required by PDF.
 */
function evaluateCubicSampleTable(
  functionValue: SampledFunction,
  lower: Uint32Array,
  fractions: Float64Array,
  signal?: AbortSignal
): number[] {
  const dimensions = functionValue.inputCount;
  const dimensionWeights = new Array<CubicDimensionWeights>(dimensions);
  const strides = new Uint32Array(dimensions);
  let stride = 1;
  for (let dimension = 0; dimension < dimensions; dimension += 1) {
    strides[dimension] = stride;
    stride *= functionValue.size[dimension];
    dimensionWeights[dimension] = sampledCubicDimensionWeights(
      functionValue.size[dimension],
      lower[dimension],
      fractions[dimension]
    );
  }

  const output = Array.from<number>({ length: functionValue.outputCount }).fill(0);
  let visited = 0;
  const accumulate = (dimension: number, pointIndex: number, weight: number): void => {
    if (dimension === dimensions) {
      if ((visited++ & 0xff) === 0) throwIfAborted(signal);
      if (weight === 0) return;
      const sampleOffset = pointIndex * functionValue.outputCount;
      for (let component = 0; component < output.length; component += 1) {
        output[component] += functionValue.samples[sampleOffset + component] * weight;
      }
      return;
    }
    const axis = dimensionWeights[dimension];
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

function sampledCubicDimensionWeights(
  size: number,
  lower: number,
  fraction: number
): CubicDimensionWeights {
  if (fraction === 0 || size === 1) {
    return { indices: [lower], weights: [1] };
  }
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
  const weights = cubicConvolutionWeights(fraction + 1);
  return {
    indices: [lower - 1, lower, lower + 1, lower + 2],
    weights
  };
}

/** Four coefficients for f(0)..f(3), evaluated over 1 <= x <= 2. */
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

function evaluateExponential(functionValue: ExponentialFunction, inputs: readonly number[]): number[] {
  const power = Math.pow(inputs[0], functionValue.exponent);
  return functionValue.c0.map((start, index) => start + power * (functionValue.c1[index] - start));
}

function unpackNormalizedSamples(
  bytes: Uint8Array,
  count: number,
  bitsPerSample: number,
  signal?: AbortSignal
): number[] {
  const output = new Array<number>(count);
  let bitOffset = 0;
  const denominator = bitsPerSample === 32 ? 0xffff_ffff : (2 ** bitsPerSample) - 1;
  for (let index = 0; index < count; index += 1) {
    if ((index & 0x3fff) === 0) throwIfAborted(signal);
    let value = 0;
    for (let bit = 0; bit < bitsPerSample; bit += 1) {
      value = value * 2 + ((bytes[bitOffset >>> 3] >>> (7 - (bitOffset & 7))) & 1);
      bitOffset += 1;
    }
    output[index] = value / denominator;
  }
  return output;
}

const CALCULATOR_OPERATORS = [
  "abs", "add", "atan", "ceiling", "cos", "cvi", "cvr", "div", "exp", "floor",
  "idiv", "ln", "log", "mod", "mul", "neg", "round", "sin", "sqrt", "sub", "truncate",
  "eq", "ge", "gt", "le", "lt", "ne", "and", "bitshift", "not", "or", "xor",
  "copy", "dup", "exch", "index", "pop", "roll", "if", "ifelse"
] as const;

const CALCULATOR_OPERATOR_IDS = new Map<string, number>(
  CALCULATOR_OPERATORS.map((operator, index) => [operator, index])
);
const CALCULATOR_TOKEN_DECODER = new TextDecoder("latin1");

class CalculatorParser {
  private readonly bytes: Uint8Array;
  private readonly limits: Readonly<NativePdfFunctionLimits>;
  private readonly signal: AbortSignal | undefined;
  private offset = 0;
  private tokens = 0;

  constructor(
    bytes: Uint8Array,
    limits: Readonly<NativePdfFunctionLimits>,
    signal?: AbortSignal
  ) {
    this.bytes = bytes;
    this.limits = limits;
    this.signal = signal;
  }

  parse(): readonly CalculatorToken[] {
    throwIfAborted(this.signal);
    this.skipSpace();
    if (this.bytes[this.offset] !== 0x7b) {
      throw new PdfError("invalid-object", "A calculator PDF function must start with `{`.");
    }
    this.offset += 1;
    const program = this.parseProcedure(0);
    this.skipSpace();
    if (this.offset !== this.bytes.length) {
      throw new PdfError("invalid-object", "A calculator PDF function contains trailing tokens.");
    }
    validateCalculatorProgramSyntax(program);
    return program;
  }

  private parseProcedure(depth: number): readonly CalculatorToken[] {
    if (depth > this.limits.maxCalculatorDepth) {
      throw new PdfError("resource-limit", "Calculator function procedure nesting exceeds its limit.");
    }
    const output: CalculatorToken[] = [];
    while (true) {
      throwIfAborted(this.signal);
      this.skipSpace();
      if (this.offset >= this.bytes.length) {
        throw new PdfError("invalid-object", "A calculator PDF function has an unterminated procedure.");
      }
      if (this.bytes[this.offset] === 0x7d) {
        this.offset += 1;
        return output;
      }
      if (++this.tokens > this.limits.maxCalculatorTokens) {
        throw new PdfError("resource-limit", "Calculator function token count exceeds its limit.");
      }
      if (this.bytes[this.offset] === 0x7b) {
        this.offset += 1;
        output.push(this.parseProcedure(depth + 1));
        continue;
      }
      const token = this.readToken();
      if (token === "true") output.push(true);
      else if (token === "false") output.push(false);
      else {
        const numeric = parseCalculatorNumber(token);
        if (numeric) output.push(numeric);
        else if (CALCULATOR_OPERATOR_IDS.has(token)) output.push(token);
        else {
          throw new PdfError("unsupported-content", `Unsupported calculator-function operator ${token}.`, {
            details: { operator: token }
          });
        }
      }
    }
  }

  private readToken(): string {
    throwIfAborted(this.signal);
    const start = this.offset;
    while (this.offset < this.bytes.length) {
      if (((this.offset - start) & 0x3fff) === 0) throwIfAborted(this.signal);
      const byte = this.bytes[this.offset];
      if (isCalculatorWhitespace(byte) || byte === 0x7b || byte === 0x7d || byte === 0x25) break;
      this.offset += 1;
    }
    if (start === this.offset) throw new PdfError("invalid-object", "Invalid calculator-function token.");
    return CALCULATOR_TOKEN_DECODER.decode(this.bytes.subarray(start, this.offset));
  }

  private skipSpace(): void {
    while (this.offset < this.bytes.length) {
      if ((this.offset & 0x3fff) === 0) throwIfAborted(this.signal);
      const byte = this.bytes[this.offset];
      if (isCalculatorWhitespace(byte)) {
        this.offset += 1;
        continue;
      }
      if (byte !== 0x25) return;
      this.offset += 1;
      while (this.offset < this.bytes.length) {
        const comment = this.bytes[this.offset++];
        if (comment === 0x0a || comment === 0x0d) break;
      }
    }
  }
}

function validateCalculatorProgramSyntax(program: readonly CalculatorToken[]): void {
  for (let index = 0; index < program.length; index += 1) {
    const token = program[index];
    if (!isCalculatorProcedure(token)) continue;
    validateCalculatorProgramSyntax(token);
    if (program[index + 1] === "if") continue;
    const alternate = program[index + 1];
    if (isCalculatorProcedure(alternate) && program[index + 2] === "ifelse") {
      validateCalculatorProgramSyntax(alternate);
      index += 1;
      continue;
    }
    throw new PdfError(
      "invalid-object",
      "A calculator conditional expression is not directly associated with if or ifelse."
    );
  }
}

function evaluateCalculator(
  functionValue: CalculatorFunction,
  inputs: readonly number[],
  limits: Readonly<NativePdfFunctionLimits>,
  signal?: AbortSignal
): number[] {
  const stack: CalculatorStackValue[] = inputs.map((value) => calculatorReal(value, "input"));
  enforceCalculatorStack(stack, limits);
  let operations = 0;
  const execute = (program: readonly CalculatorToken[], depth: number): void => {
    if (depth > limits.maxCalculatorDepth) {
      throw new PdfError("resource-limit", "Calculator function execution nesting exceeds its limit.");
    }
    for (const token of program) {
      if (++operations > limits.maxCalculatorOperations) {
        throw new PdfError("resource-limit", "Calculator function operation count exceeds its limit.");
      }
      if ((operations & 0x3f) === 0) throwIfAborted(signal);
      if (typeof token !== "string") {
        stack.push(token);
        enforceCalculatorStack(stack, limits);
        continue;
      }
      executeCalculatorOperator(token, stack, execute, depth, limits);
      enforceCalculatorStack(stack, limits);
    }
  };
  throwIfAborted(signal);
  execute(functionValue.program, 0);
  if (stack.length !== functionValue.outputCount) {
    throw new PdfError("invalid-object", "A calculator PDF function left the wrong number of results on its stack.");
  }
  const values = stack.slice(-functionValue.outputCount);
  return values.map((value) => {
    if (!isCalculatorNumeric(value) || !Number.isFinite(value.value)) {
      throw new PdfError("invalid-object", "A calculator PDF function result is not a finite number.");
    }
    return value.value;
  });
}

function executeCalculatorOperator(
  operator: string,
  stack: CalculatorStackValue[],
  execute: (program: readonly CalculatorToken[], depth: number) => void,
  depth: number,
  limits: Readonly<NativePdfFunctionLimits>
): void {
  const number = () => popNumber(stack, operator);
  const integer = () => popInteger(stack, operator);
  const boolean = () => popBoolean(stack, operator);
  const procedure = () => popProcedure(stack, operator);
  let a: CalculatorNumber;
  let b: CalculatorNumber;
  switch (operator) {
    case "abs": {
      const value = number();
      stack.push(calculatorSameTypeResult(value, Math.abs(value.value), operator));
      return;
    }
    case "add":
      b = number(); a = number();
      stack.push(calculatorArithmeticResult(a, b, a.value + b.value, operator));
      return;
    case "atan":
      b = number(); a = number();
      if (a.value === 0 && b.value === 0) throw calculatorDomainError(operator);
      stack.push(calculatorReal(normalizeDegrees(Math.atan2(a.value, b.value) * 180 / Math.PI), operator));
      return;
    case "ceiling": {
      const value = number();
      stack.push(calculatorSameTypeResult(value, Math.ceil(value.value), operator));
      return;
    }
    case "cos": {
      const value = number();
      stack.push(calculatorReal(Math.cos(value.value * Math.PI / 180), operator));
      return;
    }
    case "cvi": {
      const value = number();
      stack.push(calculatorInteger(Math.trunc(value.value), operator));
      return;
    }
    case "cvr": stack.push(calculatorReal(number().value, operator)); return;
    case "div":
      b = number(); a = number();
      if (b.value === 0) throw calculatorDomainError(operator);
      stack.push(calculatorReal(a.value / b.value, operator));
      return;
    case "exp":
      b = number(); a = number();
      if (
        (a.value === 0 && b.value <= 0)
        || (a.value < 0 && !Number.isInteger(b.value))
      ) {
        throw calculatorDomainError(operator);
      }
      stack.push(calculatorReal(Math.pow(a.value, b.value), operator));
      return;
    case "floor": {
      const value = number();
      stack.push(calculatorSameTypeResult(value, Math.floor(value.value), operator));
      return;
    }
    case "idiv": {
      const divisor = integer();
      const dividend = integer();
      if (divisor.value === 0) throw calculatorDomainError(operator);
      stack.push(calculatorInteger(Math.trunc(dividend.value / divisor.value), operator));
      return;
    }
    case "ln": {
      const value = number();
      if (value.value <= 0) throw calculatorDomainError(operator);
      stack.push(calculatorReal(Math.log(value.value), operator));
      return;
    }
    case "log": {
      const value = number();
      if (value.value <= 0) throw calculatorDomainError(operator);
      stack.push(calculatorReal(Math.log10(value.value), operator));
      return;
    }
    case "mod": {
      const divisor = integer();
      const dividend = integer();
      if (divisor.value === 0) throw calculatorDomainError(operator);
      stack.push(calculatorInteger(dividend.value % divisor.value, operator));
      return;
    }
    case "mul":
      b = number(); a = number();
      stack.push(calculatorArithmeticResult(a, b, a.value * b.value, operator));
      return;
    case "neg": {
      const value = number();
      stack.push(calculatorSameTypeResult(value, -value.value, operator));
      return;
    }
    case "round": {
      const value = number();
      // PostScript ties are rounded toward the greater integer, including -0.5 -> 0.0.
      stack.push(calculatorSameTypeResult(value, Math.floor(value.value + 0.5), operator));
      return;
    }
    case "sin": {
      const value = number();
      stack.push(calculatorReal(Math.sin(value.value * Math.PI / 180), operator));
      return;
    }
    case "sqrt": {
      const value = number();
      if (value.value < 0) throw calculatorDomainError(operator);
      stack.push(calculatorReal(Math.sqrt(value.value), operator));
      return;
    }
    case "sub":
      b = number(); a = number();
      stack.push(calculatorArithmeticResult(a, b, a.value - b.value, operator));
      return;
    case "truncate": {
      const value = number();
      stack.push(calculatorSameTypeResult(value, Math.trunc(value.value), operator));
      return;
    }
    case "eq": stack.push(calculatorEqual(popAny(stack, operator), popAny(stack, operator), operator)); return;
    case "ne": stack.push(!calculatorEqual(popAny(stack, operator), popAny(stack, operator), operator)); return;
    case "ge": b = number(); a = number(); stack.push(a.value >= b.value); return;
    case "gt": b = number(); a = number(); stack.push(a.value > b.value); return;
    case "le": b = number(); a = number(); stack.push(a.value <= b.value); return;
    case "lt": b = number(); a = number(); stack.push(a.value < b.value); return;
    case "and": binaryBooleanOrInteger(stack, operator, (x, y) => x && y, (x, y) => x & y); return;
    case "or": binaryBooleanOrInteger(stack, operator, (x, y) => x || y, (x, y) => x | y); return;
    case "xor": binaryBooleanOrInteger(stack, operator, (x, y) => x !== y, (x, y) => x ^ y); return;
    case "bitshift": {
      const shift = integer();
      const value = integer();
      const distance = Math.abs(shift.value);
      const result = distance >= 32
        ? 0
        : shift.value >= 0
          ? value.value << distance
          : value.value >>> distance;
      stack.push(calculatorInteger(result, operator));
      return;
    }
    case "not": {
      const value = popAny(stack, operator);
      if (typeof value === "boolean") stack.push(!value);
      else if (isCalculatorNumeric(value) && value.kind === "integer") {
        stack.push(calculatorInteger(~value.value, operator));
      }
      else throw calculatorTypeError(operator);
      return;
    }
    case "copy": {
      const count = integer();
      if (
        count.value < 0
        || count.value > stack.length
        || stack.length + count.value > limits.maxCalculatorStack
      ) {
        throw calculatorStackError(operator);
      }
      stack.push(...stack.slice(stack.length - count.value));
      return;
    }
    case "dup": stack.push(peekAny(stack, operator)); return;
    case "exch": {
      const top = popAny(stack, operator);
      const below = popAny(stack, operator);
      stack.push(top, below);
      return;
    }
    case "index": {
      const index = integer();
      if (index.value < 0 || index.value >= stack.length) throw calculatorStackError(operator);
      stack.push(stack[stack.length - 1 - index.value]);
      return;
    }
    case "pop": popAny(stack, operator); return;
    case "roll": {
      const amount = integer();
      const count = integer();
      if (count.value < 0 || count.value > stack.length) throw calculatorStackError(operator);
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
      throw new PdfError("unsupported-content", `Unsupported calculator-function operator ${operator}.`);
  }
}

/**
 * Stable HEPR v7 calculator bytecode:
 * `0 i32le`, `1 f32le`, `2 false`, `3 true`, `4 operator-id`,
 * `5 procedure-start`, and `6 procedure-end`. PDF real literals are rounded
 * once to IEEE-754 binary32 so serialized programs execute deterministically.
 */
function encodeCalculatorProgram(
  program: readonly CalculatorToken[],
  signal?: AbortSignal
): Uint8Array {
  const bytes: number[] = [];
  const append = (tokens: readonly CalculatorToken[], nested: boolean): void => {
    throwIfAborted(signal);
    if (nested) bytes.push(5);
    for (const token of tokens) {
      if (isCalculatorNumeric(token)) {
        const encoded = new Uint8Array(4);
        const view = new DataView(encoded.buffer);
        if (token.kind === "integer") {
          bytes.push(0);
          view.setInt32(0, token.value, true);
        } else {
          bytes.push(1);
          view.setFloat32(0, token.value, true);
        }
        for (const byte of encoded) bytes.push(byte);
      } else if (typeof token === "boolean") {
        bytes.push(token ? 3 : 2);
      } else if (typeof token === "string") {
        bytes.push(4, CALCULATOR_OPERATOR_IDS.get(token)!);
      } else {
        append(token, true);
      }
    }
    if (nested) bytes.push(6);
  };
  append(program, false);
  return Uint8Array.from(bytes);
}

function binaryBooleanOrInteger(
  stack: CalculatorStackValue[],
  operator: string,
  booleanOperation: (left: boolean, right: boolean) => boolean,
  integerOperation: (left: number, right: number) => number
): void {
  const right = popAny(stack, operator);
  const left = popAny(stack, operator);
  if (typeof left === "boolean" && typeof right === "boolean") {
    stack.push(booleanOperation(left, right));
  } else if (
    isCalculatorNumeric(left)
    && isCalculatorNumeric(right)
    && left.kind === "integer"
    && right.kind === "integer"
  ) {
    stack.push(calculatorInteger(integerOperation(left.value, right.value), operator));
  } else {
    throw calculatorTypeError(operator);
  }
}

function popAny(
  stack: CalculatorStackValue[],
  operator: string
): CalculatorStackValue {
  const value = stack.pop();
  if (value === undefined) throw calculatorStackError(operator);
  return value;
}

function peekAny(
  stack: CalculatorStackValue[],
  operator: string
): CalculatorStackValue {
  if (stack.length === 0) throw calculatorStackError(operator);
  return stack[stack.length - 1];
}

function popNumber(
  stack: CalculatorStackValue[],
  operator: string
): CalculatorNumber {
  const value = popAny(stack, operator);
  if (!isCalculatorNumeric(value)) throw calculatorTypeError(operator);
  return value;
}

function popInteger(stack: CalculatorStackValue[], operator: string): CalculatorNumber {
  const value = popNumber(stack, operator);
  if (value.kind !== "integer") throw calculatorTypeError(operator);
  return value;
}

function popBoolean(
  stack: CalculatorStackValue[],
  operator: string
): boolean {
  const value = popAny(stack, operator);
  if (typeof value !== "boolean") throw calculatorTypeError(operator);
  return value;
}

function popProcedure(
  stack: CalculatorStackValue[],
  operator: string
): readonly CalculatorToken[] {
  const value = popAny(stack, operator);
  if (!Array.isArray(value)) throw calculatorTypeError(operator);
  return value;
}

function calculatorInteger(value: number, operator: string): CalculatorNumber {
  if (!Number.isInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff) {
    throw calculatorDomainError(operator);
  }
  return Object.freeze({ kind: "integer", value: value === 0 ? 0 : value });
}

function calculatorReal(value: number, operator: string): CalculatorNumber {
  const rounded = Math.fround(value);
  if (!Number.isFinite(rounded)) throw calculatorDomainError(operator);
  return Object.freeze({ kind: "real", value: rounded });
}

function calculatorArithmeticResult(
  left: CalculatorNumber,
  right: CalculatorNumber,
  result: number,
  operator: string
): CalculatorNumber {
  if (
    left.kind === "integer"
    && right.kind === "integer"
    && Number.isInteger(result)
    && result >= -0x8000_0000
    && result <= 0x7fff_ffff
  ) {
    return calculatorInteger(result, operator);
  }
  return calculatorReal(result, operator);
}

function calculatorSameTypeResult(
  operand: CalculatorNumber,
  result: number,
  operator: string
): CalculatorNumber {
  if (operand.kind === "integer" && result >= -0x8000_0000 && result <= 0x7fff_ffff) {
    return calculatorInteger(result, operator);
  }
  return calculatorReal(result, operator);
}

function calculatorEqual(
  left: CalculatorStackValue,
  right: CalculatorStackValue,
  operator: string
): boolean {
  if (isCalculatorProcedure(left) || isCalculatorProcedure(right)) {
    throw calculatorTypeError(operator);
  }
  if (isCalculatorNumeric(left) && isCalculatorNumeric(right)) return left.value === right.value;
  return left === right;
}

function calculatorStackError(operator: string): PdfError {
  return new PdfError("invalid-object", `Calculator-function stack error in ${operator}.`);
}

function calculatorTypeError(operator: string): PdfError {
  return new PdfError("invalid-object", `Calculator-function type error in ${operator}.`);
}

function calculatorDomainError(operator: string): PdfError {
  return new PdfError("invalid-object", `Calculator-function numeric domain error in ${operator}.`);
}

function enforceCalculatorStack(
  stack: readonly unknown[],
  limits: Readonly<NativePdfFunctionLimits>
): void {
  if (stack.length > limits.maxCalculatorStack) {
    throw new PdfError("resource-limit", "Calculator function stack exceeds its limit.");
  }
  if (stack.some((value) => isCalculatorNumeric(value) && !Number.isFinite(value.value))) {
    throw new PdfError("invalid-object", "A calculator function produced a non-finite intermediate value.");
  }
}

async function requiredNumber(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  key: string,
  signal?: AbortSignal
): Promise<number> {
  const value = await document.resolveValue(dictionary.get(key), signal);
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || Math.abs(value) > 3.402823466e38
  ) {
    throw new PdfError("invalid-object", `A PDF function has an invalid /${key} number.`);
  }
  return value;
}

async function requiredInteger(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  key: string,
  signal?: AbortSignal
): Promise<number> {
  const value = await requiredNumber(document, dictionary, key, signal);
  if (!Number.isSafeInteger(value)) {
    throw new PdfError("invalid-object", `A PDF function has a non-integer /${key}.`);
  }
  return value;
}

async function optionalInteger(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  key: string,
  fallback: number,
  signal?: AbortSignal
): Promise<number> {
  if (!dictionary.has(key)) return fallback;
  return await requiredInteger(document, dictionary, key, signal);
}

async function requiredNumberArray(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  key: string,
  maxItems: number,
  signal?: AbortSignal
): Promise<number[]> {
  const values = await resolveArray(document, dictionary.get(key), maxItems, signal);
  return values.map((value) => {
    if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 3.402823466e38) {
      throw new PdfError("invalid-object", `A PDF function has an invalid /${key} array.`);
    }
    return value;
  });
}

async function requiredIntegerArray(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  key: string,
  maxItems: number,
  signal?: AbortSignal
): Promise<number[]> {
  const values = await requiredNumberArray(document, dictionary, key, maxItems, signal);
  if (values.some((value) => !Number.isSafeInteger(value))) {
    throw new PdfError("invalid-object", `A PDF function has a non-integer /${key} array.`);
  }
  return values;
}

async function resolveArray(
  document: NativePdfDocument,
  value: PdfValue | undefined,
  maxItems: number,
  signal?: AbortSignal
): Promise<PdfValue[]> {
  const resolved = await document.resolveValue(value, signal);
  if (!Array.isArray(resolved)) {
    throw new PdfError("invalid-object", "A PDF function entry expected an array.");
  }
  if (resolved.length > maxItems) {
    throw new PdfError("resource-limit", "A PDF function array exceeds its configured item limit.");
  }
  const output: PdfValue[] = [];
  for (const item of resolved) {
    throwIfAborted(signal);
    output.push((await document.resolveValue(item, signal)) ?? null);
  }
  return output;
}

async function resolveRawArray(
  document: NativePdfDocument,
  value: PdfValue | undefined,
  maxItems: number,
  signal?: AbortSignal
): Promise<PdfValue[]> {
  const resolved = await document.resolveValue(value, signal);
  if (!Array.isArray(resolved)) {
    throw new PdfError("invalid-object", "A PDF function entry expected an array.");
  }
  if (resolved.length > maxItems) {
    throw new PdfError("resource-limit", "A PDF function array exceeds its configured item limit.");
  }
  // Preserve indirect subfunction references so registry-level reuse and cycle
  // checks retain their stable object identity.
  return [...resolved];
}

function validatePairs(
  values: readonly number[],
  label: string,
  maxPairs: number,
  order: "none" | "nondecreasing" | "strict"
): void {
  if (values.length === 0 || values.length % 2 !== 0 || values.length / 2 > maxPairs) {
    throw new PdfError("invalid-object", `${label} has invalid arity.`);
  }
  for (let index = 0; index < values.length; index += 2) {
    const first = values[index];
    const second = values[index + 1];
    if (
      (order === "nondecreasing" && first > second)
      || (order === "strict" && first >= second)
    ) {
      throw new PdfError("invalid-object", `${label} contains a reversed or disallowed empty interval.`);
    }
  }
}

function mergeFunctionLimits(
  overrides: Partial<NativePdfFunctionLimits>
): Readonly<NativePdfFunctionLimits> {
  const result = { ...DEFAULT_NATIVE_PDF_FUNCTION_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`PDF function limit ${name} must be a positive safe integer.`);
    }
  }
  if (result.maxInputs > 16) {
    throw new RangeError("PDF function maxInputs cannot exceed 16 for bounded interpolation.");
  }
  if (result.maxFunctions > 0x00ff_ffff || result.maxSampleValues > 0x0100_0000) {
    throw new RangeError(
      "PDF function count and sample limits cannot exceed exactly representable HEPR Float32 indices."
    );
  }
  if (result.maxOutputs > 0x0100_0000) {
    throw new RangeError("PDF function maxOutputs cannot exceed exact HEPR Float32 arity capacity.");
  }
  if (result.maxStoreValues > 0xffff_ffff) {
    throw new RangeError("PDF function store limits cannot exceed Uint32 offset capacity.");
  }
  if (result.maxFunctionDepth > 64 || result.maxCalculatorDepth > 64) {
    throw new RangeError("PDF function and calculator nesting limits cannot exceed 64.");
  }
  return Object.freeze(result);
}

function checkedProduct(values: readonly number[], limit: number): number {
  let result = 1;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value <= 0 || result > Math.floor(limit / value)) {
      throw new PdfError("resource-limit", "PDF function sample storage exceeds its configured limit.");
    }
    result *= value;
  }
  return result;
}

function checkedMultiply(
  left: number,
  right: number,
  limit: number,
  message: string
): number {
  if (
    !Number.isSafeInteger(left)
    || !Number.isSafeInteger(right)
    || left < 0
    || right < 0
    || left > Math.floor(limit / Math.max(1, right))
  ) {
    throw new PdfError("resource-limit", message);
  }
  return left * right;
}

function checkedStoreLength(
  current: number,
  added: number,
  limit: number,
  label: string
): number {
  if (added > limit - current) {
    throw new PdfError("resource-limit", `PDF function ${label} store exceeds its configured limit.`);
  }
  return current + added;
}

function appendBoundedNumbers(
  target: number[],
  values: readonly number[],
  limit: number,
  label: string,
  signal?: AbortSignal
): void {
  if (values.length > limit - target.length) {
    throw new PdfError("resource-limit", `PDF function ${label} store exceeds its configured limit.`);
  }
  for (let index = 0; index < values.length; index += 1) {
    if ((index & 0x3fff) === 0) throwIfAborted(signal);
    target.push(values[index]);
  }
}

function appendBoundedBytes(
  target: number[],
  values: Uint8Array,
  limit: number,
  signal?: AbortSignal
): void {
  if (values.length > limit - target.length) {
    throw new PdfError("resource-limit", "PDF calculator bytecode store exceeds its configured limit.");
  }
  for (let index = 0; index < values.length; index += 1) {
    if ((index & 0x3fff) === 0) throwIfAborted(signal);
    target.push(values[index]);
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

function isObjectValue(value: PdfValue): value is PdfDictionary | PdfStream {
  return isPdfDictionary(value) || isPdfStream(value);
}

function isCalculatorWhitespace(byte: number): boolean {
  return byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
}

function parseCalculatorNumber(value: string): CalculatorNumber | null {
  const integerSyntax = /^[+-]?\d+$/.test(value);
  const realSyntax = /^[+-]?(?:\d+\.\d*|\.\d+)$/.test(value);
  if (!integerSyntax && !realSyntax) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || Math.abs(numeric) > 3.402823466e38) {
    throw new PdfError("invalid-object", "A calculator PDF function contains an out-of-range number.");
  }
  if (integerSyntax && numeric >= -0x8000_0000 && numeric <= 0x7fff_ffff) {
    return calculatorInteger(numeric, "literal");
  }
  return calculatorReal(numeric, "literal");
}

function isCalculatorNumeric(value: unknown): value is CalculatorNumber {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && ((value as CalculatorNumber).kind === "integer" || (value as CalculatorNumber).kind === "real")
    && typeof (value as CalculatorNumber).value === "number";
}

function isCalculatorProcedure(value: unknown): value is readonly CalculatorToken[] {
  return Array.isArray(value);
}
