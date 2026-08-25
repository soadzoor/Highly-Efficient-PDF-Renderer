/**
 * Allocation-conscious compiler for simple, vector-dense PDF page content streams.
 *
 * The caller is responsible for resolving and decoding page content streams. This
 * module deliberately understands only the PDF graphics subset that HEPR can map
 * directly to its native stroke/fill representation. Unsupported content throws a
 * typed error so the caller can atomically fall back to PDF.js.
 */

export type DensePdfMatrix = [number, number, number, number, number, number];

export interface DensePdfBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type DensePdfContentSource =
  | Uint8Array
  | Iterable<Uint8Array>
  | AsyncIterable<Uint8Array>;

export interface DensePdfCompileProgress {
  phase: "scanning" | "finalizing";
  processedBytes: number;
  totalBytes?: number;
  operatorCount: number;
  sourceSegmentCount: number;
}

export interface DensePdfContentCompileOptions {
  pageMatrix: DensePdfMatrix;
  pageBounds: DensePdfBounds;
  /** Names of page `/ExtGState` resources preflight proved behaviorally inert. */
  availableExtGStates?: readonly string[];
  enableSegmentMerge?: boolean;
  enableInvisibleCull?: boolean;
  totalBytes?: number;
  signal?: AbortSignal;
  yieldIntervalMs?: number;
  onProgress?: (progress: DensePdfCompileProgress) => void;
}

export interface DensePdfCompiledPage {
  operatorCount: number;
  dependencyOpCount: number;
  pathCount: number;
  sourceSegmentCount: number;
  mergedSegmentCount: number;
  segmentCount: number;
  endpoints: Float32Array;
  primitiveMeta: Float32Array;
  primitiveBounds: Float32Array;
  styles: Float32Array;
  fillPathCount: number;
  fillSegmentCount: number;
  fillPathMetaA: Float32Array;
  fillPathMetaB: Float32Array;
  fillPathMetaC: Float32Array;
  fillSegmentsA: Float32Array;
  fillSegmentsB: Float32Array;
  bounds: DensePdfBounds;
  strokeBounds: DensePdfBounds | null;
  fillBounds: DensePdfBounds | null;
  maxHalfWidth: number;
  discardedTransparentCount: number;
  discardedDegenerateCount: number;
  discardedDuplicateCount: number;
  discardedContainedCount: number;
  retainedTextContent: Uint8Array;
  referencedFonts: string[];
  referencedProperties: string[];
  textShowOpCount: number;
}

export class DensePdfUnsupportedError extends Error {
  readonly operator?: string;

  constructor(message: string, operator?: string) {
    super(message);
    this.name = "DensePdfUnsupportedError";
    this.operator = operator;
  }
}

export class DensePdfSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DensePdfSyntaxError";
  }
}

const DRAW_MOVE_TO = 0;
const DRAW_LINE_TO = 1;
const DRAW_CURVE_TO = 2;
const DRAW_QUAD_TO = 3;
const DRAW_CLOSE = 4;

const STROKE_PRIMITIVE_LINE = 0;
const STROKE_PRIMITIVE_QUADRATIC = 1;
const FILL_PRIMITIVE_LINE = 0;
const FILL_PRIMITIVE_QUADRATIC = 1;
const FILL_RULE_NONZERO = 0;
const FILL_RULE_EVEN_ODD = 1;

const SEGMENT_JOIN_EPSILON = 1e-3;
const COLLINEAR_DOT_THRESHOLD = 0.999995;
const COLLINEAR_PERP_EPSILON = 0.05;
const CURVE_FLATNESS = 0.35;
const MAX_CURVE_SPLIT_DEPTH = 9;
const FILL_CUBIC_TO_QUAD_ERROR = 0.08;
const MAX_FILL_CUBIC_TO_QUAD_DEPTH = 9;
const ALPHA_INVISIBLE_EPSILON = 1e-3;
const OPAQUE_ALPHA_EPSILON = 0.999;
const DUPLICATE_POSITION_SCALE = 1_000;
const DUPLICATE_STYLE_SCALE = 10_000;
const COVER_DIRECTION_SCALE = 2_000;
const COVER_OFFSET_SCALE = 200;
const COVER_INTERVAL_EPSILON = 0.05;
const COVER_HALF_WIDTH_EPSILON = 1e-4;
const BACKGROUND_FILL_COLOR_EPSILON = 1e-3;
const BACKGROUND_FILL_MIN_AREA_RATIO = 0.2;
const BACKGROUND_FILL_MIN_DIMENSION_RATIO = 0.65;

export const DENSE_PDF_STROKE_STYLE_FLAG_HAIRLINE = 1 << 0;
const STROKE_STYLE_FLAG_ROUND_CAP = 1 << 1;
const STROKE_STYLE_FLAG_CLIPPED = 1 << 2;
const STROKE_STYLE_FLAG_OFFSET = 2;

const MAX_INPUT_SLICE_BYTES = 256 * 1024;
const DEFAULT_YIELD_INTERVAL_MS = 50;
const MAX_OPERAND_COUNT = 1_000_000;
const MAX_PAINT_PATH_FLOATS = 65_536;
const MAX_COVERAGE_GROUP_SIZE = 8_192;
const UTF8_ENCODER = new TextEncoder();

interface PdfNameValue {
  kind: "name";
  value: string;
}

interface PdfStringValue {
  kind: "string";
  value: Uint8Array;
}

interface PdfArrayValue {
  kind: "array";
  value: PdfValue[];
}

interface PdfDictionaryValue {
  kind: "dictionary";
  value: Array<[string, PdfValue]>;
}

type PdfValue =
  | number
  | PdfNameValue
  | PdfStringValue
  | PdfArrayValue
  | PdfDictionaryValue
  | boolean
  | null;

type LexerToken =
  | { kind: "number"; value: number }
  | { kind: "name"; value: string }
  | { kind: "string"; value: Uint8Array }
  | { kind: "word"; value: string }
  | { kind: "array-start" | "array-end" | "dict-start" | "dict-end" };

interface ParserContainer {
  kind: "array" | "dictionary";
  values: PdfValue[];
  entries: Array<[string, PdfValue]>;
  pendingKey: string | null;
}

interface GraphicsState {
  matrix: DensePdfMatrix;
  matrixScale: number;
  clipBounds: DensePdfBounds | null;
  clipMask: DensePdfClipMask | null;
  lineWidth: number;
  lineCap: number;
  lineDash: number[];
  dashPhase: number;
  strokeR: number;
  strokeG: number;
  strokeB: number;
  fillR: number;
  fillG: number;
  fillB: number;
  strokeColorSpace: DeviceColorSpace;
  fillColorSpace: DeviceColorSpace;
}

interface DensePdfClipMask {
  bounds: DensePdfBounds;
  exclusionBounds: DensePdfBounds[];
}

type DeviceColorSpace = "DeviceGray" | "DeviceRGB" | "DeviceCMYK";

interface CoverageCandidate {
  index: number;
  start: number;
  end: number;
  halfWidth: number;
  alpha: number;
  styleFlags: number;
}

interface StrokeFinalizeResult {
  endpoints: Float32Array;
  primitiveMeta: Float32Array;
  primitiveBounds: Float32Array;
  styles: Float32Array;
  bounds: DensePdfBounds | null;
  maxHalfWidth: number;
  discardedContainedCount: number;
}

/** Compile already-decoded page content without materializing a PDF.js operator list. */
export async function compileDensePdfContent(
  source: DensePdfContentSource,
  options: DensePdfContentCompileOptions
): Promise<DensePdfCompiledPage> {
  assertFiniteMatrix(options.pageMatrix);
  assertValidBounds(options.pageBounds, "pageBounds");
  options.signal?.throwIfAborted();

  const compiler = new DenseContentCompiler(options);
  const lexer = new IncrementalPdfLexer((token) => compiler.consumeToken(token));
  const yieldIntervalMs = Math.max(4, options.yieldIntervalMs ?? DEFAULT_YIELD_INTERVAL_MS);
  let processedBytes = 0;
  let lastYieldAt = nowMs();

  for await (const inputChunk of normalizeContentChunks(source)) {
    for (let offset = 0; offset < inputChunk.length; offset += MAX_INPUT_SLICE_BYTES) {
      options.signal?.throwIfAborted();
      const slice = inputChunk.subarray(
        offset,
        Math.min(inputChunk.length, offset + MAX_INPUT_SLICE_BYTES)
      );
      lexer.feed(slice, false);
      processedBytes += slice.length;

      const now = nowMs();
      if (now - lastYieldAt >= yieldIntervalMs) {
        options.onProgress?.({
          phase: "scanning",
          processedBytes,
          totalBytes: options.totalBytes,
          operatorCount: compiler.operatorCount,
          sourceSegmentCount: compiler.sourceSegmentCount
        });
        await yieldToHost();
        options.signal?.throwIfAborted();
        lastYieldAt = nowMs();
      }
    }
  }

  lexer.finish();
  options.signal?.throwIfAborted();
  let lastFinalizeYieldAt = nowMs();
  const finalizeCheckpoint = async (force = false): Promise<void> => {
    options.signal?.throwIfAborted();
    const now = nowMs();
    if (!force && now - lastFinalizeYieldAt < yieldIntervalMs) return;
    options.onProgress?.({
      phase: "finalizing",
      processedBytes,
      totalBytes: options.totalBytes ?? processedBytes,
      operatorCount: compiler.operatorCount,
      sourceSegmentCount: compiler.sourceSegmentCount
    });
    await yieldToHost();
    options.signal?.throwIfAborted();
    lastFinalizeYieldAt = nowMs();
  };
  await finalizeCheckpoint(true);
  const result = await compiler.finish(finalizeCheckpoint);
  options.onProgress?.({
    phase: "finalizing",
    processedBytes,
    totalBytes: options.totalBytes ?? processedBytes,
    operatorCount: result.operatorCount,
    sourceSegmentCount: result.sourceSegmentCount
  });
  return result;
}

class DenseContentCompiler {
  readonly options: DensePdfContentCompileOptions;

  readonly path = new ReusablePathBuilder();

  readonly strokes: DenseStrokeBuilder;

  readonly fillPathMetaA = new Float4Builder(2_048);

  readonly fillPathMetaB = new Float4Builder(2_048);

  readonly fillPathMetaC = new Float4Builder(2_048);

  readonly fillSegmentsA = new Float4Builder(16_384);

  readonly fillSegmentsB = new Float4Builder(16_384);

  readonly textProgram = new PdfProgramBuilder();

  readonly referencedFonts = new Set<string>();

  readonly referencedProperties = new Set<string>();

  readonly operands: PdfValue[] = [];

  readonly containers: ParserContainer[] = [];

  readonly stateStack: GraphicsState[] = [];

  readonly operatorTracker = new PdfJsOperatorCountTracker();

  readonly availableExtGStates: ReadonlySet<string>;

  private state: GraphicsState;

  private pendingClipRule: number | null = null;

  private pendingTextClipPath: Uint8Array | null = null;

  private pendingTextClipStatement: Uint8Array | null = null;

  private fillBounds: DensePdfBounds | null = null;

  private finished = false;

  pathCount = 0;

  fillPathCount = 0;

  textShowOpCount = 0;

  constructor(options: DensePdfContentCompileOptions) {
    this.options = options;
    this.availableExtGStates = new Set(options.availableExtGStates ?? []);
    this.state = {
      matrix: [...options.pageMatrix],
      matrixScale: matrixScale(options.pageMatrix),
      clipBounds: { ...options.pageBounds },
      clipMask: null,
      lineWidth: 1,
      lineCap: 0,
      lineDash: [],
      dashPhase: 0,
      strokeR: 0,
      strokeG: 0,
      strokeB: 0,
      fillR: 0,
      fillG: 0,
      fillB: 0,
      strokeColorSpace: "DeviceGray",
      fillColorSpace: "DeviceGray"
    };
    this.strokes = new DenseStrokeBuilder(options.enableInvisibleCull !== false);
  }

  get operatorCount(): number {
    return this.operatorTracker.operatorCount;
  }

  get sourceSegmentCount(): number {
    return this.strokes.sourceSegmentCount;
  }

  consumeToken(token: LexerToken): void {
    if (this.finished) {
      throw new DensePdfSyntaxError("Content appeared after the compiler was finalized.");
    }

    if (token.kind === "array-start") {
      this.containers.push({ kind: "array", values: [], entries: [], pendingKey: null });
      return;
    }
    if (token.kind === "dict-start") {
      this.containers.push({ kind: "dictionary", values: [], entries: [], pendingKey: null });
      return;
    }
    if (token.kind === "array-end" || token.kind === "dict-end") {
      this.closeContainer(token.kind);
      return;
    }
    if (token.kind === "number") {
      this.appendValue(token.value);
      return;
    }
    if (token.kind === "name") {
      this.appendValue({ kind: "name", value: token.value });
      return;
    }
    if (token.kind === "string") {
      this.appendValue({ kind: "string", value: token.value });
      return;
    }
    if (token.kind !== "word") {
      throw new DensePdfSyntaxError(`Unexpected ${token.kind} token in PDF content.`);
    }

    if (token.value === "true" || token.value === "false" || token.value === "null") {
      this.appendValue(token.value === "null" ? null : token.value === "true");
      return;
    }
    if (this.containers.length > 0) {
      throw new DensePdfSyntaxError(
        `Unexpected keyword ${token.value} inside a content-stream object.`
      );
    }

    this.executeOperator(token.value, this.operands);
    this.operands.length = 0;
  }

  async finish(
    checkpoint: (force?: boolean) => Promise<void>
  ): Promise<DensePdfCompiledPage> {
    if (this.finished) {
      throw new DensePdfSyntaxError("Dense PDF content compiler was finalized twice.");
    }
    this.finished = true;
    if (this.containers.length > 0) {
      throw new DensePdfSyntaxError("Unterminated array or dictionary in PDF content.");
    }
    if (this.operands.length > 0) {
      throw new DensePdfSyntaxError("Dangling operands at the end of PDF content.");
    }
    if (this.path.length > 0 || this.pendingClipRule !== null) {
      throw new DensePdfSyntaxError("Unpainted path at the end of PDF content.");
    }
    if (this.stateStack.length > 0) {
      // PDF.js implicitly closes missing restores at EOF. Mirror its normalized
      // operator count; geometry already retains the innermost state at EOF.
      while (this.stateStack.length > 0) {
        this.operatorTracker.addOperator("Q");
        this.stateStack.pop();
        if ((this.stateStack.length & 0x1fff) === 0) await checkpoint();
      }
    }

    const strokeResult = await this.strokes.finalize(checkpoint);
    const fillPathMetaA = this.fillPathMetaA.toTypedArray();
    const fillPathMetaB = this.fillPathMetaB.toTypedArray();
    const fillPathMetaC = this.fillPathMetaC.toTypedArray();
    const fillSegmentsA = this.fillSegmentsA.toTypedArray();
    const fillSegmentsB = this.fillSegmentsB.toTypedArray();
    const combinedBounds = combineBounds(strokeResult.bounds, this.fillBounds) ?? {
      ...this.options.pageBounds
    };
    return {
      operatorCount: this.operatorTracker.operatorCount,
      dependencyOpCount: this.operatorTracker.dependencyOpCount,
      pathCount: this.pathCount,
      sourceSegmentCount: this.strokes.sourceSegmentCount,
      mergedSegmentCount: this.strokes.mergedSegmentCount,
      segmentCount: strokeResult.endpoints.length >> 2,
      endpoints: strokeResult.endpoints,
      primitiveMeta: strokeResult.primitiveMeta,
      primitiveBounds: strokeResult.primitiveBounds,
      styles: strokeResult.styles,
      fillPathCount: this.fillPathCount,
      fillSegmentCount: fillSegmentsA.length >> 2,
      fillPathMetaA,
      fillPathMetaB,
      fillPathMetaC,
      fillSegmentsA,
      fillSegmentsB,
      bounds: combinedBounds,
      strokeBounds: strokeResult.bounds,
      fillBounds: this.fillBounds,
      maxHalfWidth: strokeResult.maxHalfWidth,
      discardedTransparentCount: this.strokes.discardedTransparentCount,
      discardedDegenerateCount: this.strokes.discardedDegenerateCount,
      discardedDuplicateCount: this.strokes.discardedDuplicateCount,
      discardedContainedCount: strokeResult.discardedContainedCount,
      retainedTextContent: this.textProgram.toUint8Array(),
      referencedFonts: [...this.referencedFonts],
      referencedProperties: [...this.referencedProperties],
      textShowOpCount: this.textShowOpCount
    };
  }

  private appendValue(value: PdfValue): void {
    const container = this.containers.at(-1);
    if (!container) {
      if (this.operands.length >= MAX_OPERAND_COUNT) {
        throw new DensePdfSyntaxError("PDF content operand stack exceeded its safety limit.");
      }
      this.operands.push(value);
      return;
    }

    if (container.kind === "array") {
      container.values.push(value);
      return;
    }

    if (container.pendingKey === null) {
      if (!isPdfName(value)) {
        throw new DensePdfSyntaxError("PDF dictionary keys must be names.");
      }
      container.pendingKey = value.value;
      return;
    }
    container.entries.push([container.pendingKey, value]);
    container.pendingKey = null;
  }

  private closeContainer(kind: "array-end" | "dict-end"): void {
    const container = this.containers.pop();
    const expected = kind === "array-end" ? "array" : "dictionary";
    if (!container || container.kind !== expected) {
      throw new DensePdfSyntaxError(`Unexpected ${kind} token in PDF content.`);
    }
    if (container.kind === "dictionary" && container.pendingKey !== null) {
      throw new DensePdfSyntaxError("PDF dictionary ended without a value for its final key.");
    }
    this.appendValue(
      container.kind === "array"
        ? { kind: "array", value: container.values }
        : { kind: "dictionary", value: container.entries }
    );
  }

  private executeOperator(operator: string, args: PdfValue[]): void {
    switch (operator) {
      case "m":
        this.requireArgs(operator, args, 2);
        this.path.moveTo(numberArg(args, 0), numberArg(args, 1));
        return;
      case "l":
        this.requireArgs(operator, args, 2);
        this.path.lineTo(numberArg(args, 0), numberArg(args, 1));
        return;
      case "c":
        this.requireArgs(operator, args, 6);
        this.path.curveTo(
          numberArg(args, 0), numberArg(args, 1), numberArg(args, 2),
          numberArg(args, 3), numberArg(args, 4), numberArg(args, 5)
        );
        return;
      case "v":
        this.requireArgs(operator, args, 4);
        this.path.curveTo2(
          numberArg(args, 0), numberArg(args, 1), numberArg(args, 2), numberArg(args, 3)
        );
        return;
      case "y":
        this.requireArgs(operator, args, 4);
        this.path.curveTo3(
          numberArg(args, 0), numberArg(args, 1), numberArg(args, 2), numberArg(args, 3)
        );
        return;
      case "re":
        this.requireArgs(operator, args, 4);
        this.path.rectangle(
          numberArg(args, 0), numberArg(args, 1), numberArg(args, 2), numberArg(args, 3)
        );
        return;
      case "h":
        this.requireArgs(operator, args, 0);
        this.path.closePath();
        return;
      case "W":
      case "W*":
        this.requireArgs(operator, args, 0);
        if (this.pendingClipRule !== null) {
          throw new DensePdfSyntaxError("A PDF path contains more than one clipping operator.");
        }
        this.pendingClipRule = operator === "W*" ? FILL_RULE_EVEN_ODD : FILL_RULE_NONZERO;
        this.pendingTextClipStatement = serializePdfStatement(args, operator);
        this.operatorTracker.addOperator(operator);
        return;
      case "S":
      case "s":
      case "f":
      case "F":
      case "f*":
      case "B":
      case "B*":
      case "b":
      case "b*":
      case "n":
        this.requireArgs(operator, args, 0);
        this.paintPath(operator);
        return;
      case "q":
        this.requireArgs(operator, args, 0);
        this.rejectTransformChangeInsidePath(operator);
        this.stateStack.push(cloneState(this.state));
        this.trackAndRetainState(args, operator);
        return;
      case "Q": {
        this.requireArgs(operator, args, 0);
        this.rejectTransformChangeInsidePath(operator);
        const restored = this.stateStack.pop();
        if (!restored) {
          throw new DensePdfSyntaxError("Unbalanced Q operator in PDF content.");
        }
        this.state = restored;
        this.trackAndRetainState(args, operator);
        return;
      }
      case "cm":
        this.requireArgs(operator, args, 6);
        this.rejectTransformChangeInsidePath(operator);
        this.state.matrix = multiplyMatrices(this.state.matrix, matrixFromArgs(args));
        this.state.matrixScale = matrixScale(this.state.matrix);
        this.trackAndRetainState(args, operator);
        return;
      case "w":
        this.requireArgs(operator, args, 1);
        this.state.lineWidth = Math.abs(numberArg(args, 0));
        this.trackAndRetainState(args, operator);
        return;
      case "J":
        this.requireArgs(operator, args, 1);
        this.state.lineCap = clampInt(Math.trunc(numberArg(args, 0)), 0, 2);
        this.trackAndRetainState(args, operator);
        return;
      case "j":
      case "M":
      case "ri":
      case "i":
        this.requireArgs(operator, args, 1);
        if (operator !== "ri") numberArg(args, 0);
        else nameArg(args, 0);
        this.trackAndRetainState(args, operator);
        return;
      case "d": {
        this.requireArgs(operator, args, 2);
        const dash = arrayArg(args, 0).map((value) => numberValue(value, "d"));
        if (dash.some((value) => value < 0)) {
          throw new DensePdfSyntaxError("Negative dash-array entry in PDF content.");
        }
        this.state.lineDash = normalizeDashPattern(dash);
        this.state.dashPhase = numberArg(args, 1);
        this.trackAndRetainState(args, operator);
        return;
      }
      case "gs": {
        this.requireArgs(operator, args, 1);
        const resourceName = nameArg(args, 0);
        if (!this.availableExtGStates.has(resourceName)) {
          throw new DensePdfUnsupportedError(
            `Graphics state /${resourceName} was not validated as behaviorally inert.`,
            operator
          );
        }
        // PDF.js omits OPM-only/overprint-disabled ExtGState applications from
        // its operator list. They have no rendering or text-state effect, so
        // consume the source operator without retaining or counting it.
        return;
      }
      case "G":
        this.requireArgs(operator, args, 1);
        this.state.strokeColorSpace = "DeviceGray";
        [this.state.strokeR, this.state.strokeG, this.state.strokeB] = normalizeGray(numberArg(args, 0));
        this.trackAndRetainState(args, operator);
        return;
      case "g":
        this.requireArgs(operator, args, 1);
        this.state.fillColorSpace = "DeviceGray";
        [this.state.fillR, this.state.fillG, this.state.fillB] = normalizeGray(numberArg(args, 0));
        this.trackAndRetainState(args, operator);
        return;
      case "RG":
        this.requireArgs(operator, args, 3);
        this.state.strokeColorSpace = "DeviceRGB";
        [this.state.strokeR, this.state.strokeG, this.state.strokeB] = normalizeRgb(
          numberArg(args, 0), numberArg(args, 1), numberArg(args, 2)
        );
        this.trackAndRetainState(args, operator);
        return;
      case "rg":
        this.requireArgs(operator, args, 3);
        this.state.fillColorSpace = "DeviceRGB";
        [this.state.fillR, this.state.fillG, this.state.fillB] = normalizeRgb(
          numberArg(args, 0), numberArg(args, 1), numberArg(args, 2)
        );
        this.trackAndRetainState(args, operator);
        return;
      case "K":
        this.requireArgs(operator, args, 4);
        this.state.strokeColorSpace = "DeviceCMYK";
        [this.state.strokeR, this.state.strokeG, this.state.strokeB] = normalizeCmyk(
          numberArg(args, 0), numberArg(args, 1), numberArg(args, 2), numberArg(args, 3)
        );
        this.trackAndRetainState(args, operator);
        return;
      case "k":
        this.requireArgs(operator, args, 4);
        this.state.fillColorSpace = "DeviceCMYK";
        [this.state.fillR, this.state.fillG, this.state.fillB] = normalizeCmyk(
          numberArg(args, 0), numberArg(args, 1), numberArg(args, 2), numberArg(args, 3)
        );
        this.trackAndRetainState(args, operator);
        return;
      case "CS":
      case "cs": {
        this.requireArgs(operator, args, 1);
        const colorSpace = parseDeviceColorSpace(nameArg(args, 0), operator);
        if (operator === "CS") this.state.strokeColorSpace = colorSpace;
        else this.state.fillColorSpace = colorSpace;
        // PDF.js consumes device color-space selection as evaluator state. It
        // retains only the subsequent color-setting operator in its op list.
        this.textProgram.pushStatement(args, operator);
        return;
      }
      case "SC":
      case "sc":
      case "SCN":
      case "scn": {
        const stroke = operator === "SC" || operator === "SCN";
        const colorSpace = stroke ? this.state.strokeColorSpace : this.state.fillColorSpace;
        const color = normalizeDeviceColor(colorSpace, args, operator);
        if (stroke) {
          [this.state.strokeR, this.state.strokeG, this.state.strokeB] = color;
        } else {
          [this.state.fillR, this.state.fillG, this.state.fillB] = color;
        }
        this.trackAndRetainState(args, operator);
        return;
      }
      case "BT":
      case "ET":
      case "T*":
        this.requireArgs(operator, args, 0);
        this.operatorTracker.addOperator(operator);
        this.textProgram.pushStatement(args, operator);
        return;
      case "Tc":
      case "Tw":
      case "Tz":
      case "TL":
      case "Ts":
        this.requireArgs(operator, args, 1);
        numberArg(args, 0);
        this.operatorTracker.addOperator(operator);
        this.textProgram.pushStatement(args, operator);
        return;
      case "Tr": {
        this.requireArgs(operator, args, 1);
        const modeValue = numberArg(args, 0);
        const mode = Math.trunc(modeValue);
        if (mode !== modeValue || mode < 0 || mode > 7) {
          throw new DensePdfSyntaxError("Tr requires an integer text rendering mode from 0 through 7.");
        }
        if (mode >= 4) {
          throw new DensePdfUnsupportedError(
            "Glyph clipping text modes require PDF.js to clip later vector geometry.",
            operator
          );
        }
        this.operatorTracker.addOperator(operator);
        this.textProgram.pushStatement(args, operator);
        return;
      }
      case "Td":
      case "TD":
        this.requireArgs(operator, args, 2);
        numberArg(args, 0);
        numberArg(args, 1);
        this.operatorTracker.addOperator(operator);
        this.textProgram.pushStatement(args, operator);
        return;
      case "Tm":
        this.requireArgs(operator, args, 6);
        matrixFromArgs(args);
        this.operatorTracker.addOperator(operator);
        this.textProgram.pushStatement(args, operator);
        return;
      case "Tf": {
        this.requireArgs(operator, args, 2);
        const font = nameArg(args, 0);
        numberArg(args, 1);
        this.referencedFonts.add(font);
        this.operatorTracker.addFontOperator(font);
        this.textProgram.pushStatement(args, operator);
        return;
      }
      case "Tj":
        this.requireArgs(operator, args, 1);
        stringArg(args, 0);
        this.operatorTracker.addOperator(operator);
        this.textProgram.pushStatement(args, operator);
        this.textShowOpCount += 1;
        return;
      case "TJ":
        this.requireArgs(operator, args, 1);
        validateTextArray(arrayArg(args, 0));
        this.operatorTracker.addOperator(operator);
        this.textProgram.pushStatement(args, operator);
        this.textShowOpCount += 1;
        return;
      case "'":
        this.requireArgs(operator, args, 1);
        stringArg(args, 0);
        // PDF.js expands ' into nextLine followed by showText.
        this.operatorTracker.addOperator("T*");
        this.operatorTracker.addOperator("Tj");
        this.textProgram.pushStatement(args, operator);
        this.textShowOpCount += 1;
        return;
      case "\"":
        this.requireArgs(operator, args, 3);
        numberArg(args, 0);
        numberArg(args, 1);
        stringArg(args, 2);
        // PDF.js expands " into nextLine, word/character spacing, and showText.
        this.operatorTracker.addOperator("T*");
        this.operatorTracker.addOperator("Tw");
        this.operatorTracker.addOperator("Tc");
        this.operatorTracker.addOperator("Tj");
        this.textProgram.pushStatement(args, operator);
        this.textShowOpCount += 1;
        return;
      case "BMC": {
        this.requireArgs(operator, args, 1);
        const tag = nameArg(args, 0);
        if (tag === "OC") {
          throw new DensePdfUnsupportedError("Optional-content marked content requires PDF.js.", operator);
        }
        this.operatorTracker.addOperator(operator);
        this.textProgram.pushStatement(args, operator);
        return;
      }
      case "BDC": {
        this.requireArgs(operator, args, 2);
        const tag = nameArg(args, 0);
        if (tag === "OC") {
          throw new DensePdfUnsupportedError("Optional-content marked content requires PDF.js.", operator);
        }
        const property = args[1];
        if (isPdfName(property)) {
          this.referencedProperties.add(property.value);
        } else if (!isPdfDictionary(property)) {
          throw new DensePdfSyntaxError("BDC property operand must be a name or dictionary.");
        } else if (dictionaryContainsOptionalContent(property)) {
          throw new DensePdfUnsupportedError(
            "Optional-content properties require PDF.js.",
            operator
          );
        }
        this.operatorTracker.addOperator(operator);
        this.textProgram.pushStatement(args, operator);
        return;
      }
      case "EMC":
        this.requireArgs(operator, args, 0);
        this.operatorTracker.addOperator(operator);
        this.textProgram.pushStatement(args, operator);
        return;
      case "MP":
        this.requireArgs(operator, args, 1);
        nameArg(args, 0);
        // Point marked-content operators are retained for the text mini-PDF,
        // but PDF.js does not expose them in its operator list.
        this.textProgram.pushStatement(args, operator);
        return;
      case "DP": {
        this.requireArgs(operator, args, 2);
        const tag = nameArg(args, 0);
        if (tag === "OC") {
          throw new DensePdfUnsupportedError("Optional-content marked content requires PDF.js.", operator);
        }
        const property = args[1];
        if (isPdfName(property)) {
          this.referencedProperties.add(property.value);
        } else if (!isPdfDictionary(property)) {
          throw new DensePdfSyntaxError("DP property operand must be a name or dictionary.");
        } else if (dictionaryContainsOptionalContent(property)) {
          throw new DensePdfUnsupportedError("Optional-content properties require PDF.js.", operator);
        }
        // As with MP, PDF.js consumes DP without emitting an operator-list op.
        this.textProgram.pushStatement(args, operator);
        return;
      }
      case "BX":
      case "EX":
        this.requireArgs(operator, args, 0);
        return;
      default:
        throw new DensePdfUnsupportedError(
          `PDF content operator ${operator} is not supported by the dense-vector path.`,
          operator
        );
    }
  }

  private paintPath(operator: string): void {
    const closesPath = operator === "s" || operator === "b" || operator === "b*";
    if (closesPath) {
      this.path.closePath();
    }

    if (
      operator === "S" &&
      this.pendingClipRule === null &&
      this.state.lineDash.length === 0 &&
      this.path.isSingleLine()
    ) {
      this.paintSimpleStrokeLine();
      return;
    }

    const pathData = this.path.view();
    if (pathData.length > MAX_PAINT_PATH_FLOATS) {
      throw new DensePdfUnsupportedError(
        "A single PDF path is too large for cooperative dense-vector compilation.",
        operator
      );
    }
    const pathBounds = pathData.length > 0
      ? computeTransformedPathBounds(pathData, this.state.matrix)
      : null;
    if (this.pendingClipRule !== null) {
      if (!pathData.length || !pathBounds) {
        throw new DensePdfSyntaxError("Clipping operator was applied to an empty path.");
      }
      const clipMask = this.pendingClipRule === FILL_RULE_EVEN_ODD
        ? extractSimpleEvenOddRectangleClipMask(pathData, this.state.matrix)
        : null;
      applyClipToState(this.state, pathBounds, clipMask, this.pendingClipRule);
      // W/W* marks the current path for clipping, but PDF permits additional
      // construction operators before the painting/end-path operator. Capture
      // the completed path here so the retained text program sees the exact
      // same clip as direct geometry.
      this.pendingTextClipPath = serializePathProgram(pathData);
      this.flushTextClip();
    }

    const strokePaint = operator === "S" || operator === "s" || operator === "B" ||
      operator === "B*" || operator === "b" || operator === "b*";
    const fillPaint = operator === "f" || operator === "F" || operator === "f*" ||
      operator === "B" || operator === "B*" || operator === "b" || operator === "b*";
    const isEndPath = operator === "n";

    this.operatorTracker.addOperator("constructPath");
    const pathVisible = pathData.length > 0 && boundsIntersectNullable(this.state.clipBounds, pathBounds);
    if (!isEndPath && pathVisible) {
      this.pathCount += 1;
    }

    if (pathVisible && strokePaint) {
      const isHairline = this.state.lineWidth <= 0;
      const halfWidth = isHairline ? 0 : this.state.lineWidth * this.state.matrixScale * 0.5;
      // The PDF.js path records the width once for a path whose aggregate
      // bounds intersect the clip, even when every primitive of that path is
      // later rejected by primitive-level clipping. Preserve that no-cull
      // metadata boundary independently from primitive emission.
      this.strokes.recordPathHalfWidth(halfWidth);
      let flags = isHairline ? DENSE_PDF_STROKE_STYLE_FLAG_HAIRLINE : 0;
      if (this.state.lineCap === 1) {
        flags |= STROKE_STYLE_FLAG_ROUND_CAP;
      }
      emitSegmentsFromPath(
        pathData,
        this.state.matrix,
        halfWidth,
        this.state.strokeR,
        this.state.strokeG,
        this.state.strokeB,
        1,
        flags,
        this.state.lineDash,
        this.state.dashPhase,
        this.options.enableSegmentMerge !== false,
        this.strokes,
        this.state.clipBounds
      );
    }

    if (pathVisible && fillPaint) {
      const fillRule = operator.includes("*") ? FILL_RULE_EVEN_ODD : FILL_RULE_NONZERO;
      if (fillRule === FILL_RULE_NONZERO && countPathMoveOps(pathData) >= 100) {
        throw new DensePdfUnsupportedError(
          "Large disconnected nonzero fills require HEPR's PDF.js subpath splitter.",
          operator
        );
      }
      const emittedBounds = emitFilledPathFromPath(
        pathData,
        this.state.matrix,
        fillRule,
        strokePaint,
        this.state.fillR,
        this.state.fillG,
        this.state.fillB,
        1,
        this.fillPathMetaA,
        this.fillPathMetaB,
        this.fillPathMetaC,
        this.fillSegmentsA,
        this.fillSegmentsB,
        this.state.clipBounds,
        this.state.clipMask,
        this.options.pageBounds
      );
      if (emittedBounds) {
        this.fillPathCount += 1;
        this.fillBounds = combineBounds(this.fillBounds, emittedBounds);
      }
    }

    this.path.clear();
    this.pendingTextClipPath = null;
    this.pendingTextClipStatement = null;
    this.pendingClipRule = null;
  }

  private paintSimpleStrokeLine(): void {
    this.operatorTracker.addOperator("constructPath");
    const data = this.path.rawData();
    const matrix = this.state.matrix;
    const x0 = matrix[0] * data[1] + matrix[2] * data[2] + matrix[4];
    const y0 = matrix[1] * data[1] + matrix[3] * data[2] + matrix[5];
    const x1 = matrix[0] * data[4] + matrix[2] * data[5] + matrix[4];
    const y1 = matrix[1] * data[4] + matrix[3] * data[5] + matrix[5];
    const clip = this.state.clipBounds;
    const geometryMinX = Math.min(x0, x1);
    const geometryMinY = Math.min(y0, y1);
    const geometryMaxX = Math.max(x0, x1);
    const geometryMaxY = Math.max(y0, y1);
    if (
      !clip ||
      geometryMaxX < clip.minX || geometryMinX > clip.maxX ||
      geometryMaxY < clip.minY || geometryMinY > clip.maxY
    ) {
      this.path.clear();
      return;
    }
    this.pathCount += 1;
    const hairline = this.state.lineWidth <= 0;
    const halfWidth = hairline
      ? 0
      : this.state.lineWidth * this.state.matrixScale * 0.5;
    this.strokes.recordPathHalfWidth(halfWidth);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const zeroLength = dx * dx + dy * dy < 1e-10;
    if (zeroLength && this.state.lineCap !== 1) {
      this.path.clear();
      return;
    }
    this.strokes.sourceSegmentCount += 1;
    let flags = hairline ? DENSE_PDF_STROKE_STYLE_FLAG_HAIRLINE : 0;
    if (this.state.lineCap === 1) flags |= STROKE_STYLE_FLAG_ROUND_CAP;
    const paintMinX = geometryMinX - halfWidth;
    const paintMinY = geometryMinY - halfWidth;
    const paintMaxX = geometryMaxX + halfWidth;
    const paintMaxY = geometryMaxY + halfWidth;
    const visibleMinX = Math.max(clip.minX, paintMinX);
    const visibleMinY = Math.max(clip.minY, paintMinY);
    const visibleMaxX = Math.min(clip.maxX, paintMaxX);
    const visibleMaxY = Math.min(clip.maxY, paintMaxY);
    if (visibleMinX <= visibleMaxX && visibleMinY <= visibleMaxY) {
      const clipped =
        visibleMinX > paintMinX + 1e-6 || visibleMinY > paintMinY + 1e-6 ||
        visibleMaxX < paintMaxX - 1e-6 || visibleMaxY < paintMaxY - 1e-6;
      if (clipped) flags |= STROKE_STYLE_FLAG_CLIPPED;
      this.strokes.emitPrimitive(
        x0, y0, x1, y1, x1, y1, STROKE_PRIMITIVE_LINE,
        halfWidth,
        this.state.strokeR, this.state.strokeG, this.state.strokeB,
        1, flags,
        clipped ? visibleMinX : geometryMinX,
        clipped ? visibleMinY : geometryMinY,
        clipped ? visibleMaxX : geometryMaxX,
        clipped ? visibleMaxY : geometryMaxY
      );
    }
    this.path.clear();
  }

  private flushTextClip(): void {
    if (!this.pendingTextClipStatement) {
      throw new DensePdfSyntaxError("Missing retained clipping statement.");
    }
    if (!this.pendingTextClipPath) {
      throw new DensePdfSyntaxError("Missing retained clipping path.");
    }
    this.textProgram.pushBytes(this.pendingTextClipPath);
    this.textProgram.pushBytes(this.pendingTextClipStatement);
    this.textProgram.pushStatement([], "n");
  }

  private trackAndRetainState(args: PdfValue[], operator: string): void {
    this.operatorTracker.addOperator(operator);
    this.textProgram.pushStatement(args, operator);
  }

  private requireArgs(operator: string, args: PdfValue[], count: number): void {
    if (args.length !== count) {
      throw new DensePdfSyntaxError(
        `Operator ${operator} expected ${count} operands but received ${args.length}.`
      );
    }
  }

  private rejectTransformChangeInsidePath(operator: string): void {
    if (this.path.length > 0) {
      throw new DensePdfUnsupportedError(
        `Operator ${operator} changes graphics transforms inside an active path.`,
        operator
      );
    }
  }
}

class IncrementalPdfLexer {
  private buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

  private readonly onToken: (token: LexerToken) => void;

  private readonly numberToken: Extract<LexerToken, { kind: "number" }> = {
    kind: "number",
    value: 0
  };

  private readonly wordToken: Extract<LexerToken, { kind: "word" }> = {
    kind: "word",
    value: ""
  };

  constructor(onToken: (token: LexerToken) => void) {
    this.onToken = onToken;
  }

  feed(chunk: Uint8Array, final: boolean): void {
    if (chunk.length > 0) {
      if (this.buffer.length === 0) {
        this.buffer = chunk;
      } else {
        const combined = new Uint8Array(this.buffer.length + chunk.length);
        combined.set(this.buffer);
        combined.set(chunk, this.buffer.length);
        this.buffer = combined;
      }
    }

    let offset = 0;
    while (true) {
      const nextOffset = this.readToken(offset, final);
      if (nextOffset === null) {
        break;
      }
      offset = nextOffset;
      if (offset >= this.buffer.length) {
        break;
      }
    }

    this.buffer = offset >= this.buffer.length
      ? new Uint8Array(0)
      : this.buffer.slice(offset);
  }

  finish(): void {
    this.feed(new Uint8Array(0), true);
    if (this.buffer.length > 0) {
      throw new DensePdfSyntaxError("Incomplete token at the end of PDF content.");
    }
  }

  private readToken(
    initialOffset: number,
    final: boolean
  ): number | null {
    const bytes = this.buffer;
    let offset = initialOffset;
    while (offset < bytes.length) {
      const byte = bytes[offset];
      if (isPdfWhitespace(byte)) {
        offset += 1;
        continue;
      }
      if (byte === 0x25) {
        const end = findLineEnd(bytes, offset + 1);
        if (end < 0) {
          return final ? bytes.length : null;
        }
        offset = end;
        continue;
      }
      break;
    }

    if (offset >= bytes.length) {
      return offset;
    }

    const start = offset;
    const byte = bytes[offset++];
    if (byte === 0x5b) {
      this.onToken(ARRAY_START_TOKEN);
      return offset;
    }
    if (byte === 0x5d) {
      this.onToken(ARRAY_END_TOKEN);
      return offset;
    }
    if (byte === 0x3c) {
      if (offset >= bytes.length && !final) {
        return null;
      }
      if (bytes[offset] === 0x3c) {
        this.onToken(DICT_START_TOKEN);
        return offset + 1;
      }
      const end = findByte(bytes, 0x3e, offset);
      if (end < 0) {
        if (!final) {
          return null;
        }
        throw new DensePdfSyntaxError("Unterminated hexadecimal string in PDF content.");
      }
      this.onToken({ kind: "string", value: decodeHexString(bytes.subarray(offset, end)) });
      return end + 1;
    }
    if (byte === 0x3e) {
      if (offset >= bytes.length && !final) {
        return null;
      }
      if (bytes[offset] !== 0x3e) {
        throw new DensePdfSyntaxError("Unexpected > delimiter in PDF content.");
      }
      this.onToken(DICT_END_TOKEN);
      return offset + 1;
    }
    if (byte === 0x28) {
      const parsed = parseLiteralString(bytes, offset, final);
      if (!parsed) {
        return null;
      }
      this.onToken({ kind: "string", value: parsed.value });
      return parsed.offset;
    }
    if (byte === 0x2f) {
      const end = findRegularTokenEnd(bytes, offset);
      if (end === bytes.length && !final) {
        return null;
      }
      this.onToken({ kind: "name", value: decodePdfName(bytes.subarray(offset, end)) });
      return end;
    }

    const end = findRegularTokenEnd(bytes, start);
    if (end === bytes.length && !final) {
      return null;
    }
    if (end === start) {
      throw new DensePdfSyntaxError(`Unexpected delimiter byte 0x${byte.toString(16)}.`);
    }
    if (looksLikePdfNumberBytes(bytes, start, end)) {
      const value = parsePdfNumberBytes(bytes, start, end);
      if (!Number.isFinite(value)) {
        throw new DensePdfSyntaxError("Invalid numeric token in PDF content.");
      }
      this.numberToken.value = value;
      this.onToken(this.numberToken);
      return end;
    }
    this.wordToken.value = internPdfWord(bytes, start, end);
    this.onToken(this.wordToken);
    return end;
  }
}

class ReusablePathBuilder {
  private data = new Float32Array(256);

  private used = 0;

  private currentX = 0;

  private currentY = 0;

  get length(): number {
    return this.used;
  }

  clear(): void {
    this.used = 0;
  }

  view(): Float32Array {
    return this.data.subarray(0, this.used);
  }

  rawData(): Float32Array {
    return this.data;
  }

  isSingleLine(): boolean {
    return this.used === 6 && this.data[0] === DRAW_MOVE_TO && this.data[3] === DRAW_LINE_TO;
  }

  moveTo(x: number, y: number): void {
    this.currentX = x;
    this.currentY = y;
    this.ensureCapacity(3);
    this.data[this.used++] = DRAW_MOVE_TO;
    this.data[this.used++] = x;
    this.data[this.used++] = y;
  }

  lineTo(x: number, y: number): void {
    this.currentX = x;
    this.currentY = y;
    this.ensureCapacity(3);
    this.data[this.used++] = DRAW_LINE_TO;
    this.data[this.used++] = x;
    this.data[this.used++] = y;
  }

  curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    this.currentX = x;
    this.currentY = y;
    this.ensureCapacity(7);
    this.data[this.used++] = DRAW_CURVE_TO;
    this.data[this.used++] = x1;
    this.data[this.used++] = y1;
    this.data[this.used++] = x2;
    this.data[this.used++] = y2;
    this.data[this.used++] = x;
    this.data[this.used++] = y;
  }

  curveTo2(x2: number, y2: number, x: number, y: number): void {
    this.curveTo(this.currentX, this.currentY, x2, y2, x, y);
  }

  curveTo3(x1: number, y1: number, x: number, y: number): void {
    this.curveTo(x1, y1, x, y, x, y);
  }

  rectangle(x: number, y: number, width: number, height: number): void {
    const xw = x + width;
    const yh = y + height;
    this.currentX = x;
    this.currentY = y;
    if (width === 0 || height === 0) {
      this.ensureCapacity(7);
      this.data[this.used++] = DRAW_MOVE_TO;
      this.data[this.used++] = x;
      this.data[this.used++] = y;
      this.data[this.used++] = DRAW_LINE_TO;
      this.data[this.used++] = xw;
      this.data[this.used++] = yh;
      this.data[this.used++] = DRAW_CLOSE;
    } else {
      this.ensureCapacity(13);
      this.data[this.used++] = DRAW_MOVE_TO;
      this.data[this.used++] = x;
      this.data[this.used++] = y;
      this.data[this.used++] = DRAW_LINE_TO;
      this.data[this.used++] = xw;
      this.data[this.used++] = y;
      this.data[this.used++] = DRAW_LINE_TO;
      this.data[this.used++] = xw;
      this.data[this.used++] = yh;
      this.data[this.used++] = DRAW_LINE_TO;
      this.data[this.used++] = x;
      this.data[this.used++] = yh;
      this.data[this.used++] = DRAW_CLOSE;
    }
  }

  closePath(): void {
    this.ensureCapacity(1);
    this.data[this.used++] = DRAW_CLOSE;
  }

  private ensureCapacity(extra: number): void {
    if (this.used + extra <= this.data.length) {
      return;
    }
    let length = this.data.length;
    while (this.used + extra > length) {
      length *= 2;
    }
    const next = new Float32Array(length);
    next.set(this.data);
    this.data = next;
  }
}

class Float4Builder {
  private data: Float32Array;

  private length = 0;

  constructor(initialQuads = 32_768) {
    this.data = new Float32Array(Math.max(1, initialQuads) * 4);
  }

  get quadCount(): number {
    return this.length >> 2;
  }

  truncateQuads(quadCount: number): void {
    this.length = clampInt(quadCount, 0, this.quadCount) * 4;
  }

  push(a: number, b: number, c: number, d: number): void {
    this.ensureCapacity(4);
    this.data[this.length] = a;
    this.data[this.length + 1] = b;
    this.data[this.length + 2] = c;
    this.data[this.length + 3] = d;
    this.length += 4;
  }

  valueAt(index: number): number {
    return this.data[index];
  }

  usedView(): Float32Array {
    return this.data.subarray(0, this.length);
  }

  toTypedArray(): Float32Array {
    return this.data.slice(0, this.length);
  }

  async toTypedArrayCooperative(
    checkpoint: (force?: boolean) => Promise<void>
  ): Promise<Float32Array> {
    const output = new Float32Array(this.length);
    const chunkLength = 256 * 1024;
    for (let offset = 0; offset < this.length; offset += chunkLength) {
      const end = Math.min(this.length, offset + chunkLength);
      output.set(this.data.subarray(offset, end), offset);
      await checkpoint();
    }
    return output;
  }

  private ensureCapacity(extra: number): void {
    if (this.length + extra <= this.data.length) {
      return;
    }
    let length = this.data.length;
    while (this.length + extra > length) {
      length *= 2;
    }
    const next = new Float32Array(length);
    next.set(this.data);
    this.data = next;
  }
}

class PdfProgramBuilder {
  private data = new Uint8Array(16_384);

  private byteLength = 0;

  pushStatement(args: PdfValue[], operator: string): void {
    this.pushAscii(serializePdfStatementText(args, operator));
  }

  pushBytes(bytes: Uint8Array): void {
    this.ensureCapacity(bytes.length);
    this.data.set(bytes, this.byteLength);
    this.byteLength += bytes.length;
  }

  toUint8Array(): Uint8Array {
    return this.data.slice(0, this.byteLength);
  }

  private pushAscii(value: string): void {
    this.ensureCapacity(value.length);
    for (let index = 0; index < value.length; index += 1) {
      const byte = value.charCodeAt(index);
      if (byte > 0x7f) {
        throw new DensePdfSyntaxError("Retained PDF syntax was not ASCII-safe.");
      }
      this.data[this.byteLength++] = byte;
    }
  }

  private ensureCapacity(extra: number): void {
    const required = this.byteLength + extra;
    if (required <= this.data.length) {
      return;
    }
    let capacity = this.data.length;
    while (capacity < required) {
      capacity *= 2;
    }
    const next = new Uint8Array(capacity);
    next.set(this.data.subarray(0, this.byteLength));
    this.data = next;
  }
}

class PdfJsOperatorCountTracker {
  operatorCount = 0;

  dependencyOpCount = 0;

  private weight = 0;

  private readonly fontDependencies = new Set<string>();

  addFontOperator(fontName: string): void {
    if (!this.fontDependencies.has(fontName)) {
      this.fontDependencies.add(fontName);
      this.dependencyOpCount += 1;
      this.addOperator("dependency");
    }
    this.addOperator("Tf");
  }

  addOperator(operator: string): void {
    this.operatorCount += 1;
    this.weight += 1;
    if (
      this.weight >= 1_000 ||
      (this.weight >= 995 && (operator === "Q" || operator === "ET"))
    ) {
      this.weight = 0;
      this.fontDependencies.clear();
    }
  }
}

class DenseStrokeBuilder {
  readonly endpoints = new Float4Builder(65_536);

  readonly primitiveMeta = new Float4Builder(65_536);

  readonly primitiveBounds = new Float4Builder(65_536);

  readonly styles = new Float4Builder(65_536);

  readonly duplicateIndex = new DenseDuplicateIndex();

  readonly duplicateTuple = new Float64Array(13);

  readonly duplicateTupleWords = new Uint32Array(
    this.duplicateTuple.buffer,
    this.duplicateTuple.byteOffset,
    this.duplicateTuple.length * 2
  );

  readonly existingDuplicateTuple = new Float64Array(13);

  private readonly duplicateEquals = (index: number, tuple: Float64Array): boolean =>
    this.matchesDuplicateTuple(index, tuple);

  readonly enableInvisibleCull: boolean;

  sourceSegmentCount = 0;

  mergedSegmentCount = 0;

  discardedTransparentCount = 0;

  discardedDegenerateCount = 0;

  discardedDuplicateCount = 0;

  emittedMaxHalfWidth = 0;

  constructor(enableInvisibleCull: boolean) {
    this.enableInvisibleCull = enableInvisibleCull;
  }

  recordPathHalfWidth(halfWidth: number): void {
    if (!this.enableInvisibleCull) {
      this.emittedMaxHalfWidth = Math.max(this.emittedMaxHalfWidth, halfWidth);
    }
  }

  emitPrimitive(
    p0x: number,
    p0y: number,
    p1x: number,
    p1y: number,
    p2x: number,
    p2y: number,
    primitiveType: number,
    halfWidth: number,
    colorR: number,
    colorG: number,
    colorB: number,
    alpha: number,
    styleFlags: number,
    visibleMinX: number,
    visibleMinY: number,
    visibleMaxX: number,
    visibleMaxY: number
  ): void {
    this.mergedSegmentCount += 1;
    if (!this.enableInvisibleCull) {
      // The established no-cull extractor reports the pre-Float32 stroke
      // width even though the packed style buffer is normalized to Float32.
      this.emittedMaxHalfWidth = Math.max(this.emittedMaxHalfWidth, halfWidth);
    }
    const x0 = Math.fround(p0x);
    const y0 = Math.fround(p0y);
    const cx = Math.fround(p1x);
    const cy = Math.fround(p1y);
    const x1 = Math.fround(p2x);
    const y1 = Math.fround(p2y);
    const type = Math.fround(primitiveType);
    const width = Math.fround(halfWidth);
    const r = Math.fround(colorR);
    const g = Math.fround(colorG);
    const b = Math.fround(colorB);
    const encodedStyle = Math.fround(encodeStrokeStyleMeta(alpha, styleFlags));
    const decodedFlags = Math.max(
      0,
      Math.trunc(encodedStyle / STROKE_STYLE_FLAG_OFFSET + 1e-6)
    );
    const decodedAlpha = clamp01(encodedStyle - decodedFlags * STROKE_STYLE_FLAG_OFFSET);

    if (this.enableInvisibleCull) {
      if (decodedAlpha <= ALPHA_INVISIBLE_EPSILON) {
        this.discardedTransparentCount += 1;
        return;
      }
      const isQuadratic = type >= STROKE_PRIMITIVE_QUADRATIC - 0.5;
      const isDegenerate = isQuadratic
        ? Math.hypot(cx - x0, cy - y0) + Math.hypot(x1 - cx, y1 - cy) < 1e-5
        : (x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0) < 1e-10;
      if (isDegenerate) {
        const roundPoint = !isQuadratic && (decodedFlags & STROKE_STYLE_FLAG_ROUND_CAP) !== 0;
        const hairline = (decodedFlags & DENSE_PDF_STROKE_STYLE_FLAG_HAIRLINE) !== 0;
        if (!roundPoint || (!hairline && width <= 1e-6)) {
          this.discardedDegenerateCount += 1;
          return;
        }
      }
      fillDuplicateTuple(
        this.duplicateTuple,
        x0, y0, cx, cy, x1, y1, type, width, r, g, b, decodedAlpha,
        decodedFlags
      );
      if (this.duplicateIndex.hasOrInsert(
        this.duplicateTuple,
        this.duplicateTupleWords,
        this.endpoints.quadCount,
        this.duplicateEquals
      )) {
        this.discardedDuplicateCount += 1;
        return;
      }
    }

    this.endpoints.push(x0, y0, cx, cy);
    this.primitiveMeta.push(x1, y1, type, encodedStyle);
    this.styles.push(width, r, g, b);
    this.primitiveBounds.push(
      visibleMinX,
      visibleMinY,
      visibleMaxX,
      visibleMaxY
    );
  }

  async finalize(
    checkpoint: (force?: boolean) => Promise<void>
  ): Promise<StrokeFinalizeResult> {
    if (!this.enableInvisibleCull || this.endpoints.quadCount === 0) {
      const endpoints = await this.endpoints.toTypedArrayCooperative(checkpoint);
      const primitiveMeta = await this.primitiveMeta.toTypedArrayCooperative(checkpoint);
      const primitiveBounds = await this.primitiveBounds.toTypedArrayCooperative(checkpoint);
      const styles = await this.styles.toTypedArrayCooperative(checkpoint);
      return buildUncompactedStrokeResult(
        endpoints,
        primitiveMeta,
        primitiveBounds,
        styles,
        checkpoint,
        this.enableInvisibleCull ? null : this.emittedMaxHalfWidth
      );
    }
    return cullContainedSegments(
      this.endpoints.usedView(),
      this.primitiveMeta.usedView(),
      this.primitiveBounds.usedView(),
      this.styles.usedView(),
      checkpoint
    );
  }

  private matchesDuplicateTuple(index: number, tuple: Float64Array): boolean {
    const offset = index * 4;
    const encoded = this.primitiveMeta.valueAt(offset + 3);
    const decodedFlags = Math.max(0, Math.trunc(encoded / STROKE_STYLE_FLAG_OFFSET + 1e-6));
    const decodedAlpha = clamp01(encoded - decodedFlags * STROKE_STYLE_FLAG_OFFSET);
    fillDuplicateTuple(
      this.existingDuplicateTuple,
      this.endpoints.valueAt(offset),
      this.endpoints.valueAt(offset + 1),
      this.endpoints.valueAt(offset + 2),
      this.endpoints.valueAt(offset + 3),
      this.primitiveMeta.valueAt(offset),
      this.primitiveMeta.valueAt(offset + 1),
      this.primitiveMeta.valueAt(offset + 2),
      this.styles.valueAt(offset),
      this.styles.valueAt(offset + 1),
      this.styles.valueAt(offset + 2),
      this.styles.valueAt(offset + 3),
      decodedAlpha,
      decodedFlags
    );
    for (let i = 0; i < tuple.length; i += 1) {
      if (this.existingDuplicateTuple[i] !== tuple[i]) {
        return false;
      }
    }
    return true;
  }
}

class DenseDuplicateIndex {
  private hashes = new Uint32Array(1 << 20);

  private indices = new Uint32Array(1 << 20);

  private size = 0;

  hasOrInsert(
    tuple: Float64Array,
    tupleWords: Uint32Array,
    newIndex: number,
    equals: (index: number, tuple: Float64Array) => boolean
  ): boolean {
    if ((this.size + 1) * 10 >= this.hashes.length * 7) {
      this.grow();
    }
    const hash = hashFloatTuple(tuple, tupleWords);
    let slot = hash & (this.hashes.length - 1);
    while (this.hashes[slot] !== 0) {
      if (this.hashes[slot] === hash && equals(this.indices[slot] - 1, tuple)) {
        return true;
      }
      slot = (slot + 1) & (this.hashes.length - 1);
    }
    this.hashes[slot] = hash;
    this.indices[slot] = newIndex + 1;
    this.size += 1;
    return false;
  }

  private grow(): void {
    const oldHashes = this.hashes;
    const oldIndices = this.indices;
    this.hashes = new Uint32Array(oldHashes.length * 2);
    this.indices = new Uint32Array(oldIndices.length * 2);
    const mask = this.hashes.length - 1;
    for (let i = 0; i < oldHashes.length; i += 1) {
      const hash = oldHashes[i];
      if (hash === 0) {
        continue;
      }
      let slot = hash & mask;
      while (this.hashes[slot] !== 0) {
        slot = (slot + 1) & mask;
      }
      this.hashes[slot] = hash;
      this.indices[slot] = oldIndices[i];
    }
  }
}

function emitSegmentsFromPath(
  pathData: Float32Array,
  matrix: DensePdfMatrix,
  halfWidth: number,
  colorR: number,
  colorG: number,
  colorB: number,
  alpha: number,
  styleFlags: number,
  lineDash: number[],
  dashPhase: number,
  allowSegmentMerge: boolean,
  output: DenseStrokeBuilder,
  clipBounds: DensePdfBounds | null
): void {
  let cursorX = 0;
  let cursorY = 0;
  let startX = 0;
  let startY = 0;
  let hasStart = false;
  let pendingX0 = 0;
  let pendingY0 = 0;
  let pendingX1 = 0;
  let pendingY1 = 0;
  let hasPending = false;

  const dashScale = matrixScale(matrix);
  const dashPattern = lineDash.map((entry) => entry * dashScale);
  const dashPatternLength = dashPattern.reduce((sum, entry) => sum + entry, 0);
  const hasDashPattern = dashPattern.length > 0 && dashPatternLength > 1e-9;
  let dashIndex = 0;
  let dashRemaining = Number.POSITIVE_INFINITY;
  let dashPaint = true;

  const emitPrimitive = (
    p0x: number,
    p0y: number,
    p1x: number,
    p1y: number,
    p2x: number,
    p2y: number,
    primitiveType: number
  ): void => {
    const minX = Math.min(p0x, p1x, p2x);
    const minY = Math.min(p0y, p1y, p2y);
    const maxX = Math.max(p0x, p1x, p2x);
    const maxY = Math.max(p0y, p1y, p2y);
    const paintBounds = {
      minX: minX - halfWidth,
      minY: minY - halfWidth,
      maxX: maxX + halfWidth,
      maxY: maxY + halfWidth
    };
    const visiblePaintBounds = clipBounds ? intersectBounds(clipBounds, paintBounds) : paintBounds;
    if (!isNonEmptyBounds(visiblePaintBounds)) {
      return;
    }
    const clipped = Boolean(clipBounds) && (
      visiblePaintBounds.minX > paintBounds.minX + 1e-6 ||
      visiblePaintBounds.minY > paintBounds.minY + 1e-6 ||
      visiblePaintBounds.maxX < paintBounds.maxX - 1e-6 ||
      visiblePaintBounds.maxY < paintBounds.maxY - 1e-6
    );
    output.emitPrimitive(
      p0x, p0y, p1x, p1y, p2x, p2y, primitiveType,
      halfWidth, colorR, colorG, colorB, alpha,
      clipped ? styleFlags | STROKE_STYLE_FLAG_CLIPPED : styleFlags,
      clipped ? visiblePaintBounds.minX : minX,
      clipped ? visiblePaintBounds.minY : minY,
      clipped ? visiblePaintBounds.maxX : maxX,
      clipped ? visiblePaintBounds.maxY : maxY
    );
  };

  const flushPending = (): void => {
    if (!hasPending) {
      return;
    }
    emitPrimitive(
      pendingX0, pendingY0, pendingX1, pendingY1,
      pendingX1, pendingY1, STROKE_PRIMITIVE_LINE
    );
    hasPending = false;
  };

  const tryMergePending = (x0: number, y0: number, x1: number, y1: number): boolean => {
    if (!hasPending) {
      return false;
    }
    const joinDx = x0 - pendingX1;
    const joinDy = y0 - pendingY1;
    if (joinDx * joinDx + joinDy * joinDy > SEGMENT_JOIN_EPSILON * SEGMENT_JOIN_EPSILON) {
      return false;
    }
    const baseDx = pendingX1 - pendingX0;
    const baseDy = pendingY1 - pendingY0;
    const nextDx = x1 - x0;
    const nextDy = y1 - y0;
    const baseLenSq = baseDx * baseDx + baseDy * baseDy;
    const nextLenSq = nextDx * nextDx + nextDy * nextDy;
    if (baseLenSq < 1e-10 || nextLenSq < 1e-10) {
      return false;
    }
    const dot = (baseDx * nextDx + baseDy * nextDy) / Math.sqrt(baseLenSq * nextLenSq);
    if (dot < COLLINEAR_DOT_THRESHOLD) {
      return false;
    }
    const chainDx = x1 - pendingX0;
    const chainDy = y1 - pendingY0;
    if (crossDistanceSq(chainDx, chainDy, baseDx, baseDy, baseLenSq) > COLLINEAR_PERP_EPSILON ** 2) {
      return false;
    }
    pendingX1 = x1;
    pendingY1 = y1;
    return true;
  };

  const emitLine = (x0: number, y0: number, x1: number, y1: number, merge: boolean): void => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (dx * dx + dy * dy < 1e-10) {
      if ((styleFlags & STROKE_STYLE_FLAG_ROUND_CAP) !== 0) {
        output.sourceSegmentCount += 1;
        flushPending();
        emitPrimitive(x0, y0, x1, y1, x1, y1, STROKE_PRIMITIVE_LINE);
      }
      return;
    }
    output.sourceSegmentCount += 1;
    if (allowSegmentMerge && merge && tryMergePending(x0, y0, x1, y1)) {
      return;
    }
    if (allowSegmentMerge) {
      flushPending();
      pendingX0 = x0;
      pendingY0 = y0;
      pendingX1 = x1;
      pendingY1 = y1;
      hasPending = true;
      return;
    }
    emitPrimitive(x0, y0, x1, y1, x1, y1, STROKE_PRIMITIVE_LINE);
  };

  const advanceDash = (): void => {
    if (!hasDashPattern) {
      dashRemaining = Number.POSITIVE_INFINITY;
      dashPaint = true;
      return;
    }
    for (let guard = 0; guard <= dashPattern.length; guard += 1) {
      dashIndex = (dashIndex + 1) % dashPattern.length;
      dashPaint = !dashPaint;
      dashRemaining = dashPattern[dashIndex];
      if (dashRemaining > 1e-9) {
        return;
      }
    }
  };

  const resetDash = (): void => {
    if (!hasDashPattern) {
      dashIndex = 0;
      dashRemaining = Number.POSITIVE_INFINITY;
      dashPaint = true;
      return;
    }
    dashIndex = 0;
    dashRemaining = dashPattern[0];
    dashPaint = true;
    if (dashRemaining <= 1e-9) {
      advanceDash();
    }
    let phase = ((dashPhase * dashScale) % dashPatternLength + dashPatternLength) % dashPatternLength;
    while (phase > 1e-9) {
      if (phase < dashRemaining - 1e-9) {
        dashRemaining -= phase;
        phase = 0;
      } else {
        phase -= dashRemaining;
        advanceDash();
      }
    }
  };

  const emitStrokedLine = (x0: number, y0: number, x1: number, y1: number, merge: boolean): void => {
    if (!hasDashPattern) {
      emitLine(x0, y0, x1, y1, merge);
      return;
    }
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    if (length <= 1e-9) {
      if (dashPaint) {
        emitLine(x0, y0, x1, y1, false);
      }
      return;
    }
    let consumed = 0;
    while (consumed < length - 1e-9) {
      const span = Math.min(length - consumed, dashRemaining);
      const next = consumed + span;
      if (dashPaint && span > 1e-9) {
        emitLine(
          x0 + dx * (consumed / length), y0 + dy * (consumed / length),
          x0 + dx * (next / length), y0 + dy * (next / length), merge
        );
      } else {
        flushPending();
      }
      consumed = next;
      dashRemaining -= span;
      if (dashRemaining <= 1e-9) {
        advanceDash();
        if (!dashPaint) {
          flushPending();
        }
      }
    }
  };

  const emitQuadratic = (
    x0: number, y0: number, cx: number, cy: number, x1: number, y1: number
  ): void => {
    if (
      (x1 - x0) ** 2 + (y1 - y0) ** 2 < 1e-10 &&
      (cx - x0) ** 2 + (cy - y0) ** 2 < 1e-10
    ) {
      return;
    }
    output.sourceSegmentCount += 1;
    flushPending();
    emitPrimitive(x0, y0, cx, cy, x1, y1, STROKE_PRIMITIVE_QUADRATIC);
  };

  resetDash();
  for (let offset = 0; offset < pathData.length;) {
    const op = pathData[offset++];
    if (op === DRAW_MOVE_TO) {
      flushPending();
      cursorX = pathData[offset++];
      cursorY = pathData[offset++];
      startX = cursorX;
      startY = cursorY;
      hasStart = true;
      resetDash();
    } else if (op === DRAW_LINE_TO) {
      const x = pathData[offset++];
      const y = pathData[offset++];
      const p0 = applyMatrix(matrix, cursorX, cursorY);
      const p1 = applyMatrix(matrix, x, y);
      emitStrokedLine(p0[0], p0[1], p1[0], p1[1], true);
      cursorX = x;
      cursorY = y;
    } else if (op === DRAW_CURVE_TO) {
      const x1 = pathData[offset++];
      const y1 = pathData[offset++];
      const x2 = pathData[offset++];
      const y2 = pathData[offset++];
      const x3 = pathData[offset++];
      const y3 = pathData[offset++];
      const p0 = applyMatrix(matrix, cursorX, cursorY);
      const p1 = applyMatrix(matrix, x1, y1);
      const p2 = applyMatrix(matrix, x2, y2);
      const p3 = applyMatrix(matrix, x3, y3);
      if (hasDashPattern) {
        flattenCubic(
          ...p0, ...p1, ...p2, ...p3,
          (ax, ay, bx, by) => emitStrokedLine(ax, ay, bx, by, true),
          CURVE_FLATNESS,
          MAX_CURVE_SPLIT_DEPTH
        );
      } else {
        emitCubicAsQuadratics(
          ...p0, ...p1, ...p2, ...p3, emitQuadratic,
          FILL_CUBIC_TO_QUAD_ERROR, MAX_FILL_CUBIC_TO_QUAD_DEPTH
        );
      }
      cursorX = x3;
      cursorY = y3;
    } else if (op === DRAW_QUAD_TO) {
      const cx = pathData[offset++];
      const cy = pathData[offset++];
      const x = pathData[offset++];
      const y = pathData[offset++];
      const p0 = applyMatrix(matrix, cursorX, cursorY);
      const pc = applyMatrix(matrix, cx, cy);
      const p1 = applyMatrix(matrix, x, y);
      emitQuadratic(p0[0], p0[1], pc[0], pc[1], p1[0], p1[1]);
      cursorX = x;
      cursorY = y;
    } else if (op === DRAW_CLOSE) {
      if (hasStart && (cursorX !== startX || cursorY !== startY)) {
        const p0 = applyMatrix(matrix, cursorX, cursorY);
        const p1 = applyMatrix(matrix, startX, startY);
        emitStrokedLine(p0[0], p0[1], p1[0], p1[1], true);
      }
      cursorX = startX;
      cursorY = startY;
      flushPending();
    } else {
      throw new DensePdfSyntaxError(`Invalid path opcode ${op}.`);
    }
  }
  flushPending();
}

function emitFilledPathFromPath(
  pathData: Float32Array,
  matrix: DensePdfMatrix,
  fillRule: number,
  hasCompanionStroke: boolean,
  colorR: number,
  colorG: number,
  colorB: number,
  alpha: number,
  metaA: Float4Builder,
  metaB: Float4Builder,
  metaC: Float4Builder,
  segmentsA: Float4Builder,
  segmentsB: Float4Builder,
  clipBounds: DensePdfBounds | null,
  clipMask: DensePdfClipMask | null,
  pageBounds: DensePdfBounds
): DensePdfBounds | null {
  let cursorX = 0;
  let cursorY = 0;
  let startX = 0;
  let startY = 0;
  let hasStart = false;
  const segmentStart = segmentsA.quadCount;
  let primitiveCount = 0;
  const localBounds = emptyBounds();

  const emitLine = (x0: number, y0: number, x1: number, y1: number): void => {
    if ((x1 - x0) ** 2 + (y1 - y0) ** 2 < 1e-12) {
      return;
    }
    segmentsA.push(x0, y0, x1, y1);
    segmentsB.push(x1, y1, FILL_PRIMITIVE_LINE, 0);
    primitiveCount += 1;
    includePoint(localBounds, x0, y0);
    includePoint(localBounds, x1, y1);
  };
  const emitQuadratic = (
    x0: number, y0: number, cx: number, cy: number, x1: number, y1: number
  ): void => {
    if (
      (x1 - x0) ** 2 + (y1 - y0) ** 2 < 1e-12 &&
      (cx - x0) ** 2 + (cy - y0) ** 2 < 1e-12
    ) {
      return;
    }
    segmentsA.push(x0, y0, cx, cy);
    segmentsB.push(x1, y1, FILL_PRIMITIVE_QUADRATIC, 0);
    primitiveCount += 1;
    includePoint(localBounds, x0, y0);
    includePoint(localBounds, cx, cy);
    includePoint(localBounds, x1, y1);
  };
  const closeSubpath = (): void => {
    if (hasStart && (cursorX !== startX || cursorY !== startY)) {
      const p0 = applyMatrix(matrix, cursorX, cursorY);
      const p1 = applyMatrix(matrix, startX, startY);
      emitLine(p0[0], p0[1], p1[0], p1[1]);
    }
    cursorX = startX;
    cursorY = startY;
  };

  for (let offset = 0; offset < pathData.length;) {
    const op = pathData[offset++];
    if (op === DRAW_MOVE_TO) {
      closeSubpath();
      cursorX = pathData[offset++];
      cursorY = pathData[offset++];
      startX = cursorX;
      startY = cursorY;
      hasStart = true;
    } else if (op === DRAW_LINE_TO) {
      const x = pathData[offset++];
      const y = pathData[offset++];
      const p0 = applyMatrix(matrix, cursorX, cursorY);
      const p1 = applyMatrix(matrix, x, y);
      emitLine(p0[0], p0[1], p1[0], p1[1]);
      cursorX = x;
      cursorY = y;
    } else if (op === DRAW_CURVE_TO) {
      const x1 = pathData[offset++];
      const y1 = pathData[offset++];
      const x2 = pathData[offset++];
      const y2 = pathData[offset++];
      const x3 = pathData[offset++];
      const y3 = pathData[offset++];
      const p0 = applyMatrix(matrix, cursorX, cursorY);
      const p1 = applyMatrix(matrix, x1, y1);
      const p2 = applyMatrix(matrix, x2, y2);
      const p3 = applyMatrix(matrix, x3, y3);
      emitCubicAsQuadratics(
        ...p0, ...p1, ...p2, ...p3, emitQuadratic,
        FILL_CUBIC_TO_QUAD_ERROR, MAX_FILL_CUBIC_TO_QUAD_DEPTH
      );
      cursorX = x3;
      cursorY = y3;
    } else if (op === DRAW_QUAD_TO) {
      const cx = pathData[offset++];
      const cy = pathData[offset++];
      const x = pathData[offset++];
      const y = pathData[offset++];
      const p0 = applyMatrix(matrix, cursorX, cursorY);
      const pc = applyMatrix(matrix, cx, cy);
      const p1 = applyMatrix(matrix, x, y);
      emitQuadratic(p0[0], p0[1], pc[0], pc[1], p1[0], p1[1]);
      cursorX = x;
      cursorY = y;
    } else if (op === DRAW_CLOSE) {
      closeSubpath();
    } else {
      throw new DensePdfSyntaxError(`Invalid fill-path opcode ${op}.`);
    }
  }
  closeSubpath();

  if (primitiveCount === 0 || !isNonEmptyBounds(localBounds)) {
    segmentsA.truncateQuads(segmentStart);
    segmentsB.truncateQuads(segmentStart);
    return null;
  }
  const visibleBounds = clipBounds ? intersectBounds(clipBounds, localBounds) : localBounds;
  if (!isNonEmptyBounds(visibleBounds)) {
    segmentsA.truncateQuads(segmentStart);
    segmentsB.truncateQuads(segmentStart);
    return null;
  }

  const clipConstrainedPath = createClipConstrainedFillPath(
    pathData,
    matrix,
    localBounds,
    visibleBounds,
    clipMask
  );
  if (clipConstrainedPath) {
    segmentsA.truncateQuads(segmentStart);
    segmentsB.truncateQuads(segmentStart);
    return emitFilledPathFromPath(
      clipConstrainedPath,
      [1, 0, 0, 1, 0, 0],
      FILL_RULE_EVEN_ODD,
      hasCompanionStroke,
      colorR,
      colorG,
      colorB,
      alpha,
      metaA,
      metaB,
      metaC,
      segmentsA,
      segmentsB,
      null,
      null,
      pageBounds
    );
  }

  if (isOpaqueWhiteBackgroundFill(
    visibleBounds, pageBounds, colorR, colorG, colorB, alpha
  )) {
    segmentsA.truncateQuads(segmentStart);
    segmentsB.truncateQuads(segmentStart);
    return null;
  }
  metaA.push(segmentStart, primitiveCount, visibleBounds.minX, visibleBounds.minY);
  metaB.push(visibleBounds.maxX, visibleBounds.maxY, colorR, colorG);
  metaC.push(fillRule, hasCompanionStroke ? 1 : 0, colorB, alpha);
  return { ...visibleBounds };
}

function countPathMoveOps(pathData: Float32Array): number {
  let count = 0;
  for (let offset = 0; offset < pathData.length;) {
    const operator = pathData[offset++];
    if (operator === DRAW_MOVE_TO) {
      count += 1;
      offset += 2;
    } else if (operator === DRAW_LINE_TO) offset += 2;
    else if (operator === DRAW_CURVE_TO) offset += 6;
    else if (operator === DRAW_QUAD_TO) offset += 4;
    else if (operator !== DRAW_CLOSE) break;
  }
  return count;
}

async function cullContainedSegments(
  endpoints: Float32Array,
  primitiveMeta: Float32Array,
  primitiveBounds: Float32Array,
  styles: Float32Array,
  checkpoint: (force?: boolean) => Promise<void>
): Promise<StrokeFinalizeResult> {
  const count = endpoints.length >> 2;
  const keep = new Uint8Array(count);
  keep.fill(1);
  const starts = new Float64Array(count);
  const ends = new Float64Array(count);
  const groupIndex = new DenseCoverageGroupIndex();
  const groups: number[][] = [];
  const tuple = new Float64Array(7);
  const tupleWords = new Uint32Array(
    tuple.buffer,
    tuple.byteOffset,
    tuple.length * 2
  );

  for (let index = 0; index < count; index += 1) {
    if ((index & 0x1fff) === 0) await checkpoint();
    const offset = index * 4;
    if (primitiveMeta[offset + 2] >= STROKE_PRIMITIVE_QUADRATIC - 0.5) {
      continue;
    }
    let ax = endpoints[offset];
    let ay = endpoints[offset + 1];
    let bx = primitiveMeta[offset];
    let by = primitiveMeta[offset + 1];
    let dx = bx - ax;
    let dy = by - ay;
    const length = Math.hypot(dx, dy);
    if (length < 1e-5) {
      continue;
    }
    let ux = dx / length;
    let uy = dy / length;
    if (ux < 0 || (Math.abs(ux) < 1e-10 && uy < 0)) {
      ux = -ux;
      uy = -uy;
      ax = primitiveMeta[offset];
      ay = primitiveMeta[offset + 1];
      bx = endpoints[offset];
      by = endpoints[offset + 1];
      dx = bx - ax;
      dy = by - ay;
    }
    const nx = -uy;
    const ny = ux;
    starts[index] = Math.min(ux * ax + uy * ay, ux * bx + uy * by);
    ends[index] = Math.max(ux * ax + uy * ay, ux * bx + uy * by);
    const encodedStyle = primitiveMeta[offset + 3];
    const decodedFlags = Math.max(
      0,
      Math.trunc(encodedStyle / STROKE_STYLE_FLAG_OFFSET + 1e-6)
    );
    tuple[0] = quantize(ux, COVER_DIRECTION_SCALE);
    tuple[1] = quantize(uy, COVER_DIRECTION_SCALE);
    tuple[2] = quantize(nx * ax + ny * ay, COVER_OFFSET_SCALE);
    tuple[3] = quantize(styles[offset + 1], DUPLICATE_STYLE_SCALE);
    tuple[4] = quantize(styles[offset + 2], DUPLICATE_STYLE_SCALE);
    tuple[5] = quantize(styles[offset + 3], DUPLICATE_STYLE_SCALE);
    tuple[6] = quantize(decodedFlags, 1);
    const groupId = groupIndex.getOrInsert(tuple, tupleWords, groups.length);
    if (groupId === groups.length) {
      groups.push([]);
    }
    groups[groupId].push(index);
  }

  let discardedContainedCount = 0;
  const coverageSorter = new LegacyCoverageObjectSorter();
  for (let groupNumber = 0; groupNumber < groups.length; groupNumber += 1) {
    const candidates = groups[groupNumber];
    if (candidates.length > MAX_COVERAGE_GROUP_SIZE) {
      throw new DensePdfUnsupportedError(
        "A collinear stroke group is too large for cooperative dense-vector culling."
      );
    }
    await coverageSorter.sort(
      candidates,
      starts,
      ends,
      styles,
      primitiveMeta,
      checkpoint
    );
    const opaqueCovers: number[] = [];
    for (let candidateNumber = 0; candidateNumber < candidates.length; candidateNumber += 1) {
      if ((candidateNumber & 0x1fff) === 0) await checkpoint();
      const candidate = candidates[candidateNumber];
      const candidateOffset = candidate * 4;
      const candidateWidth = styles[candidateOffset];
      let covered = false;
      for (let coverNumber = 0; coverNumber < opaqueCovers.length; coverNumber += 1) {
        if (coverNumber > 0 && (coverNumber & 0x1fff) === 0) await checkpoint();
        const cover = opaqueCovers[coverNumber];
        if (styles[cover * 4] + COVER_HALF_WIDTH_EPSILON < candidateWidth) {
          continue;
        }
        if (
          starts[cover] - COVER_INTERVAL_EPSILON <= starts[candidate] &&
          ends[cover] + COVER_INTERVAL_EPSILON >= ends[candidate]
        ) {
          covered = true;
          break;
        }
      }
      if (covered) {
        keep[candidate] = 0;
        discardedContainedCount += 1;
      } else {
        const encodedStyle = primitiveMeta[candidateOffset + 3];
        const flags = Math.max(
          0,
          Math.trunc(encodedStyle / STROKE_STYLE_FLAG_OFFSET + 1e-6)
        );
        if (clamp01(encodedStyle - flags * STROKE_STYLE_FLAG_OFFSET) >= OPAQUE_ALPHA_EPSILON) {
          opaqueCovers.push(candidate);
        }
      }
    }
    if ((groupNumber & 0xff) === 0) await checkpoint();
  }

  return compactStrokeBuffers(
    endpoints,
    primitiveMeta,
    primitiveBounds,
    styles,
    keep,
    count - discardedContainedCount,
    discardedContainedCount,
    checkpoint
  );
}

class LegacyCoverageObjectSorter {
  private readonly pool: CoverageCandidate[] = [];

  private readonly work: CoverageCandidate[] = [];

  async sort(
    values: number[],
    starts: Float64Array,
    ends: Float64Array,
    styles: Float32Array,
    primitiveMeta: Float32Array,
    checkpoint: (force?: boolean) => Promise<void>
  ): Promise<void> {
    // Baseline coverage buckets are created with push and therefore have V8's
    // PACKED_ELEMENTS representation. Do not pre-size this array: assigning
    // into pre-created holes keeps it HOLEY_ELEMENTS and can change comparison
    // order for the legacy non-transitive epsilon comparator.
    this.work.length = 0;
    for (let offset = 0; offset < values.length; offset += 1) {
      const index = values[offset];
      const encoded = primitiveMeta[index * 4 + 3];
      const styleFlags = Math.max(
        0,
        Math.trunc(encoded / STROKE_STYLE_FLAG_OFFSET + 1e-6)
      );
      const candidate = this.pool[offset] ?? (this.pool[offset] = {
        index: 0,
        start: 0,
        end: 0,
        halfWidth: 0,
        alpha: 0,
        styleFlags: 0
      });
      candidate.index = index;
      candidate.start = starts[index];
      candidate.end = ends[index];
      candidate.halfWidth = styles[index * 4];
      candidate.alpha = clamp01(encoded - styleFlags * STROKE_STYLE_FLAG_OFFSET);
      candidate.styleFlags = styleFlags;
      this.work.push(candidate);
    }

    // Match the established cull's packed-object sort representation as well
    // as its comparator. The epsilon comparator is not globally transitive,
    // so changing V8 element representation can otherwise change legacy
    // containment choices within the same browser runtime.
    this.work.sort((a, b) => {
      if (Math.abs(a.halfWidth - b.halfWidth) > COVER_HALF_WIDTH_EPSILON) {
        return b.halfWidth - a.halfWidth;
      }
      const lenA = a.end - a.start;
      const lenB = b.end - b.start;
      if (Math.abs(lenA - lenB) > COVER_INTERVAL_EPSILON) {
        return lenB - lenA;
      }
      return a.start - b.start;
    });
    for (let offset = 0; offset < values.length; offset += 1) {
      values[offset] = this.work[offset].index;
    }
    await checkpoint();
  }
}

class DenseCoverageGroupIndex {
  private hashes = new Uint32Array(1 << 16);

  private groupIds = new Uint32Array(1 << 16);

  private keys = new Float64Array((1 << 16) * 7);

  private size = 0;

  getOrInsert(
    tuple: Float64Array,
    tupleWords: Uint32Array,
    newGroupId: number
  ): number {
    if ((this.size + 1) * 10 >= this.hashes.length * 7) {
      this.grow();
    }
    const hash = hashFloatTuple(tuple, tupleWords);
    let slot = hash & (this.hashes.length - 1);
    while (this.hashes[slot] !== 0) {
      if (this.hashes[slot] === hash && this.matches(slot, tuple)) {
        return this.groupIds[slot] - 1;
      }
      slot = (slot + 1) & (this.hashes.length - 1);
    }
    this.hashes[slot] = hash;
    this.groupIds[slot] = newGroupId + 1;
    this.keys.set(tuple, slot * 7);
    this.size += 1;
    return newGroupId;
  }

  private matches(slot: number, tuple: Float64Array): boolean {
    const offset = slot * 7;
    for (let i = 0; i < 7; i += 1) {
      if (this.keys[offset + i] !== tuple[i]) {
        return false;
      }
    }
    return true;
  }

  private grow(): void {
    const oldHashes = this.hashes;
    const oldIds = this.groupIds;
    const oldKeys = this.keys;
    this.hashes = new Uint32Array(oldHashes.length * 2);
    this.groupIds = new Uint32Array(oldIds.length * 2);
    this.keys = new Float64Array(oldKeys.length * 2);
    const mask = this.hashes.length - 1;
    for (let oldSlot = 0; oldSlot < oldHashes.length; oldSlot += 1) {
      const hash = oldHashes[oldSlot];
      if (hash === 0) {
        continue;
      }
      let slot = hash & mask;
      while (this.hashes[slot] !== 0) {
        slot = (slot + 1) & mask;
      }
      this.hashes[slot] = hash;
      this.groupIds[slot] = oldIds[oldSlot];
      this.keys.set(oldKeys.subarray(oldSlot * 7, oldSlot * 7 + 7), slot * 7);
    }
  }
}

async function compactStrokeBuffers(
  endpoints: Float32Array,
  primitiveMeta: Float32Array,
  primitiveBounds: Float32Array,
  styles: Float32Array,
  keep: Uint8Array,
  visibleCount: number,
  discardedContainedCount: number,
  checkpoint: (force?: boolean) => Promise<void>
): Promise<StrokeFinalizeResult> {
  const outEndpoints = new Float32Array(visibleCount * 4);
  const outMeta = new Float32Array(visibleCount * 4);
  const outBoundsArray = new Float32Array(visibleCount * 4);
  const outStyles = new Float32Array(visibleCount * 4);
  const bounds = emptyBounds();
  let maxHalfWidth = 0;
  let out = 0;
  for (let index = 0; index < keep.length; index += 1) {
    if ((index & 0x1fff) === 0) await checkpoint();
    if (keep[index] === 0) {
      continue;
    }
    const inputOffset = index * 4;
    const outputOffset = out * 4;
    for (let component = 0; component < 4; component += 1) {
      outEndpoints[outputOffset + component] = endpoints[inputOffset + component];
      outMeta[outputOffset + component] = primitiveMeta[inputOffset + component];
      outBoundsArray[outputOffset + component] = primitiveBounds[inputOffset + component];
      outStyles[outputOffset + component] = styles[inputOffset + component];
    }
    includePoint(bounds, primitiveBounds[inputOffset], primitiveBounds[inputOffset + 1]);
    includePoint(bounds, primitiveBounds[inputOffset + 2], primitiveBounds[inputOffset + 3]);
    maxHalfWidth = Math.max(maxHalfWidth, styles[inputOffset]);
    out += 1;
  }
  return {
    endpoints: outEndpoints,
    primitiveMeta: outMeta,
    primitiveBounds: outBoundsArray,
    styles: outStyles,
    bounds: visibleCount > 0 ? bounds : null,
    maxHalfWidth,
    discardedContainedCount
  };
}

async function buildUncompactedStrokeResult(
  endpoints: Float32Array,
  primitiveMeta: Float32Array,
  primitiveBounds: Float32Array,
  styles: Float32Array,
  checkpoint: (force?: boolean) => Promise<void>,
  preservedMaxHalfWidth: number | null = null
): Promise<StrokeFinalizeResult> {
  const count = endpoints.length >> 2;
  const bounds = emptyBounds();
  let maxHalfWidth = count > 0 ? preservedMaxHalfWidth ?? 0 : 0;
  for (let index = 0; index < count; index += 1) {
    if ((index & 0x1fff) === 0) await checkpoint();
    const offset = index * 4;
    includePoint(bounds, primitiveBounds[offset], primitiveBounds[offset + 1]);
    includePoint(bounds, primitiveBounds[offset + 2], primitiveBounds[offset + 3]);
    if (preservedMaxHalfWidth === null) {
      maxHalfWidth = Math.max(maxHalfWidth, styles[offset]);
    }
  }
  return {
    endpoints,
    primitiveMeta,
    primitiveBounds,
    styles,
    bounds: count > 0 ? bounds : null,
    maxHalfWidth,
    discardedContainedCount: 0
  };
}

const ARRAY_START_TOKEN: LexerToken = { kind: "array-start" };
const ARRAY_END_TOKEN: LexerToken = { kind: "array-end" };
const DICT_START_TOKEN: LexerToken = { kind: "dict-start" };
const DICT_END_TOKEN: LexerToken = { kind: "dict-end" };

const SINGLE_BYTE_PDF_WORDS: string[] = Array.from(
  { length: 256 },
  (_, value) => String.fromCharCode(value)
);

async function* normalizeContentChunks(
  source: DensePdfContentSource
): AsyncGenerator<Uint8Array> {
  if (source instanceof Uint8Array) {
    if (source.length > 0) {
      yield source;
    }
    return;
  }
  if (Symbol.asyncIterator in Object(source)) {
    for await (const chunk of source as AsyncIterable<Uint8Array>) {
      if (!(chunk instanceof Uint8Array)) {
        throw new TypeError("Dense PDF content sources must yield Uint8Array chunks.");
      }
      if (chunk.length > 0) {
        yield chunk;
      }
    }
    return;
  }
  for (const chunk of source as Iterable<Uint8Array>) {
    if (!(chunk instanceof Uint8Array)) {
      throw new TypeError("Dense PDF content sources must yield Uint8Array chunks.");
    }
    if (chunk.length > 0) {
      yield chunk;
    }
  }
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function yieldToHost(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function assertFiniteMatrix(matrix: DensePdfMatrix): void {
  if (matrix.length !== 6 || matrix.some((value) => !Number.isFinite(value))) {
    throw new TypeError("pageMatrix must contain six finite numbers.");
  }
}

function assertValidBounds(bounds: DensePdfBounds, label: string): void {
  if (
    !Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY) ||
    !Number.isFinite(bounds.maxX) || !Number.isFinite(bounds.maxY) ||
    bounds.minX > bounds.maxX || bounds.minY > bounds.maxY
  ) {
    throw new TypeError(`${label} must be finite and non-empty.`);
  }
}

function isPdfWhitespace(byte: number): boolean {
  return byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
}

function isPdfDelimiter(byte: number): boolean {
  return byte === 0x28 || byte === 0x29 || byte === 0x3c || byte === 0x3e ||
    byte === 0x5b || byte === 0x5d || byte === 0x7b || byte === 0x7d ||
    byte === 0x2f || byte === 0x25;
}

function findRegularTokenEnd(bytes: Uint8Array, offset: number): number {
  while (
    offset < bytes.length &&
    !isPdfWhitespace(bytes[offset]) &&
    !isPdfDelimiter(bytes[offset])
  ) {
    offset += 1;
  }
  return offset;
}

function findLineEnd(bytes: Uint8Array, offset: number): number {
  while (offset < bytes.length) {
    const byte = bytes[offset++];
    if (byte === 10) {
      return offset;
    }
    if (byte === 13) {
      return offset < bytes.length && bytes[offset] === 10 ? offset + 1 : offset;
    }
  }
  return -1;
}

function findByte(bytes: Uint8Array, expected: number, offset: number): number {
  while (offset < bytes.length) {
    if (bytes[offset] === expected) {
      return offset;
    }
    offset += 1;
  }
  return -1;
}

function hexNibble(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return -1;
}

function decodeHexString(bytes: Uint8Array): Uint8Array {
  let digits = 0;
  for (const byte of bytes) {
    if (isPdfWhitespace(byte)) continue;
    if (hexNibble(byte) < 0) {
      throw new DensePdfSyntaxError("Invalid hexadecimal digit in PDF string.");
    }
    digits += 1;
  }
  const output = new Uint8Array((digits + 1) >> 1);
  let high = -1;
  let index = 0;
  for (const byte of bytes) {
    if (isPdfWhitespace(byte)) continue;
    const nibble = hexNibble(byte);
    if (high < 0) {
      high = nibble;
    } else {
      output[index++] = (high << 4) | nibble;
      high = -1;
    }
  }
  if (high >= 0) {
    output[index] = high << 4;
  }
  return output;
}

function parseLiteralString(
  bytes: Uint8Array,
  offset: number,
  final: boolean
): { value: Uint8Array; offset: number } | null {
  const output: number[] = [];
  let depth = 1;
  while (offset < bytes.length) {
    const byte = bytes[offset++];
    if (byte === 0x28) {
      depth += 1;
      output.push(byte);
      continue;
    }
    if (byte === 0x29) {
      depth -= 1;
      if (depth === 0) {
        return { value: Uint8Array.from(output), offset };
      }
      output.push(byte);
      continue;
    }
    if (byte !== 0x5c) {
      output.push(byte);
      continue;
    }
    if (offset >= bytes.length) {
      if (!final) return null;
      throw new DensePdfSyntaxError("Incomplete escape at the end of a PDF string.");
    }
    const escaped = bytes[offset++];
    if (escaped === 0x6e) output.push(10);
    else if (escaped === 0x72) output.push(13);
    else if (escaped === 0x74) output.push(9);
    else if (escaped === 0x62) output.push(8);
    else if (escaped === 0x66) output.push(12);
    else if (escaped === 0x0a) { /* escaped line continuation */ }
    else if (escaped === 0x0d) {
      if (offset < bytes.length && bytes[offset] === 0x0a) offset += 1;
    } else if (escaped >= 0x30 && escaped <= 0x37) {
      let value = escaped - 0x30;
      let count = 1;
      while (count < 3 && offset < bytes.length) {
        const digit = bytes[offset];
        if (digit < 0x30 || digit > 0x37) break;
        value = value * 8 + digit - 0x30;
        offset += 1;
        count += 1;
      }
      output.push(value & 0xff);
    } else {
      output.push(escaped);
    }
  }
  if (!final) return null;
  throw new DensePdfSyntaxError("Unterminated literal string in PDF content.");
}

function decodePdfName(bytes: Uint8Array): string {
  let output = "";
  for (let offset = 0; offset < bytes.length; offset += 1) {
    let byte = bytes[offset];
    if (byte === 0x23) {
      if (offset + 2 >= bytes.length) {
        throw new DensePdfSyntaxError("Incomplete # escape in PDF name.");
      }
      const high = hexNibble(bytes[++offset]);
      const low = hexNibble(bytes[++offset]);
      if (high < 0 || low < 0) {
        throw new DensePdfSyntaxError("Invalid # escape in PDF name.");
      }
      byte = (high << 4) | low;
    }
    output += String.fromCharCode(byte);
  }
  return output;
}

function looksLikePdfNumberBytes(bytes: Uint8Array, start: number, end: number): boolean {
  if (start >= end) return false;
  const first = bytes[start];
  return (first >= 0x30 && first <= 0x39) || first === 0x2b || first === 0x2d || first === 0x2e;
}

function parsePdfNumberBytes(bytes: Uint8Array, start: number, end: number): number {
  let offset = start;
  let sign = 1;
  if (bytes[offset] === 0x2b || bytes[offset] === 0x2d) {
    if (bytes[offset] === 0x2d) sign = -1;
    offset += 1;
  }
  let divideBy = 0;
  if (offset < end && bytes[offset] === 0x2e) {
    divideBy = 10;
    offset += 1;
  }
  if (offset >= end || bytes[offset] < 0x30 || bytes[offset] > 0x39) {
    throw new DensePdfSyntaxError("Malformed numeric token in PDF content.");
  }
  let value = bytes[offset++] - 0x30;
  while (offset < end) {
    const byte = bytes[offset++];
    if (byte >= 0x30 && byte <= 0x39) {
      if (divideBy !== 0) divideBy *= 10;
      value = value * 10 + byte - 0x30;
    } else if (byte === 0x2e && divideBy === 0) {
      divideBy = 1;
    } else {
      throw new DensePdfSyntaxError("Malformed numeric token in PDF content.");
    }
  }
  return sign * (divideBy === 0 ? value : value / divideBy);
}

function internPdfWord(bytes: Uint8Array, start: number, end: number): string {
  const length = end - start;
  if (length === 1) {
    return SINGLE_BYTE_PDF_WORDS[bytes[start]];
  }
  // Avoid allocating strings for the small set of multi-byte operators that can
  // occur millions of times in machine-generated CAD streams.
  if (length === 2) {
    const a = bytes[start];
    const b = bytes[start + 1];
    if (a === 0x42 && b === 0x54) return "BT";
    if (a === 0x45 && b === 0x54) return "ET";
    if (a === 0x54 && b === 0x66) return "Tf";
    if (a === 0x54 && b === 0x6a) return "Tj";
    if (a === 0x54 && b === 0x4a) return "TJ";
    if (a === 0x54 && b === 0x64) return "Td";
    if (a === 0x54 && b === 0x44) return "TD";
    if (a === 0x54 && b === 0x6d) return "Tm";
    if (a === 0x54 && b === 0x63) return "Tc";
    if (a === 0x54 && b === 0x77) return "Tw";
    if (a === 0x54 && b === 0x7a) return "Tz";
    if (a === 0x54 && b === 0x4c) return "TL";
    if (a === 0x54 && b === 0x72) return "Tr";
    if (a === 0x54 && b === 0x73) return "Ts";
    if (a === 0x54 && b === 0x2a) return "T*";
    if (a === 0x52 && b === 0x47) return "RG";
    if (a === 0x72 && b === 0x67) return "rg";
    if (a === 0x43 && b === 0x53) return "CS";
    if (a === 0x63 && b === 0x73) return "cs";
    if (a === 0x53 && b === 0x43) return "SC";
    if (a === 0x73 && b === 0x63) return "sc";
    if (a === 0x63 && b === 0x6d) return "cm";
    if (a === 0x72 && b === 0x65) return "re";
    if (a === 0x57 && b === 0x2a) return "W*";
    if (a === 0x66 && b === 0x2a) return "f*";
    if (a === 0x42 && b === 0x2a) return "B*";
    if (a === 0x62 && b === 0x2a) return "b*";
    if (a === 0x4d && b === 0x50) return "MP";
    if (a === 0x44 && b === 0x50) return "DP";
    if (a === 0x42 && b === 0x58) return "BX";
    if (a === 0x45 && b === 0x58) return "EX";
    if (a === 0x72 && b === 0x69) return "ri";
  } else if (length === 3) {
    const a = bytes[start];
    const b = bytes[start + 1];
    const c = bytes[start + 2];
    if (a === 0x42 && b === 0x4d && c === 0x43) return "BMC";
    if (a === 0x42 && b === 0x44 && c === 0x43) return "BDC";
    if (a === 0x45 && b === 0x4d && c === 0x43) return "EMC";
    if (a === 0x53 && b === 0x43 && c === 0x4e) return "SCN";
    if (a === 0x73 && b === 0x63 && c === 0x6e) return "scn";
  }
  let output = "";
  for (let offset = start; offset < end; offset += 1) {
    output += String.fromCharCode(bytes[offset]);
  }
  return output;
}

function isPdfName(value: PdfValue): value is PdfNameValue {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "name";
}

function isPdfDictionary(value: PdfValue): value is PdfDictionaryValue {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "dictionary";
}

function dictionaryContainsOptionalContent(dictionary: PdfDictionaryValue): boolean {
  for (const [key, value] of dictionary.value) {
    if (key === "OC" || key === "OCGs" || key === "OCProperties") return true;
    if (
      key === "Type" && isPdfName(value) &&
      (value.value === "OCG" || value.value === "OCMD")
    ) return true;
    if (pdfValueContainsOptionalContent(value)) return true;
  }
  return false;
}

function pdfValueContainsOptionalContent(value: PdfValue): boolean {
  if (!value || typeof value !== "object" || !("kind" in value)) return false;
  if (value.kind === "array") return value.value.some(pdfValueContainsOptionalContent);
  if (value.kind === "dictionary") return dictionaryContainsOptionalContent(value);
  return false;
}

function numberValue(value: PdfValue | undefined, operator: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DensePdfSyntaxError(`Operator ${operator} requires numeric operands.`);
  }
  return value;
}

function numberArg(args: PdfValue[], index: number): number {
  return numberValue(args[index], "content");
}

function nameArg(args: PdfValue[], index: number): string {
  const value = args[index];
  if (!value || typeof value !== "object" || !("kind" in value) || value.kind !== "name") {
    throw new DensePdfSyntaxError("PDF operator requires a name operand.");
  }
  return value.value;
}

function stringArg(args: PdfValue[], index: number): Uint8Array {
  const value = args[index];
  if (!value || typeof value !== "object" || !("kind" in value) || value.kind !== "string") {
    throw new DensePdfSyntaxError("PDF text operator requires a string operand.");
  }
  return value.value;
}

function arrayArg(args: PdfValue[], index: number): PdfValue[] {
  const value = args[index];
  if (!value || typeof value !== "object" || !("kind" in value) || value.kind !== "array") {
    throw new DensePdfSyntaxError("PDF operator requires an array operand.");
  }
  return value.value;
}

function validateTextArray(values: PdfValue[]): void {
  for (const value of values) {
    if (typeof value === "number") continue;
    if (value && typeof value === "object" && "kind" in value && value.kind === "string") continue;
    throw new DensePdfSyntaxError("TJ arrays may contain only strings and numbers.");
  }
}

function serializePdfStatement(args: PdfValue[], operator: string): Uint8Array {
  return UTF8_ENCODER.encode(serializePdfStatementText(args, operator));
}

function serializePdfStatementText(args: PdfValue[], operator: string): string {
  let output = "";
  for (let index = 0; index < args.length; index += 1) {
    if (index > 0) output += " ";
    output += serializePdfValue(args[index]);
  }
  if (args.length > 0) output += " ";
  output += operator;
  output += "\n";
  return output;
}

function serializePdfValue(value: PdfValue): string {
  if (typeof value === "number") return formatPdfNumber(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null) return "null";
  if (value.kind === "name") return `/${encodePdfName(value.value)}`;
  if (value.kind === "string") {
    let output = "<";
    for (const byte of value.value) output += byte.toString(16).padStart(2, "0");
    return `${output}>`;
  }
  if (value.kind === "array") {
    return `[${value.value.map(serializePdfValue).join(" ")}]`;
  }
  return `<<${value.value.map(([key, entry]) => `/${encodePdfName(key)} ${serializePdfValue(entry)}`).join(" ")}>>`;
}

function formatPdfNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new DensePdfSyntaxError("Cannot serialize a non-finite PDF number.");
  }
  if (Object.is(value, -0) || value === 0) return "0";
  const compact = String(value);
  if (!/[eE]/.test(compact)) return compact;
  const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(compact);
  if (!match) {
    throw new DensePdfSyntaxError("Cannot serialize an exponential PDF number.");
  }
  const negative = match[1] === "-";
  const integerDigits = match[2];
  const fractionalDigits = match[3] ?? "";
  const digits = integerDigits + fractionalDigits;
  const decimalAt = integerDigits.length + Number(match[4]);
  let expanded: string;
  if (decimalAt <= 0) expanded = `0.${"0".repeat(-decimalAt)}${digits}`;
  else if (decimalAt >= digits.length) expanded = `${digits}${"0".repeat(decimalAt - digits.length)}`;
  else expanded = `${digits.slice(0, decimalAt)}.${digits.slice(decimalAt)}`;
  return negative ? `-${expanded}` : expanded;
}

function encodePdfName(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const byte = value.charCodeAt(index) & 0xff;
    if (byte >= 33 && byte <= 126 && byte !== 0x23 && !isPdfDelimiter(byte)) {
      output += String.fromCharCode(byte);
    } else {
      output += `#${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return output;
}

function serializePathProgram(pathData: Float32Array): Uint8Array {
  let output = "";
  for (let offset = 0; offset < pathData.length;) {
    const operator = pathData[offset++];
    if (operator === DRAW_MOVE_TO || operator === DRAW_LINE_TO) {
      output += `${formatPdfNumber(pathData[offset++])} ${formatPdfNumber(pathData[offset++])} `;
      output += operator === DRAW_MOVE_TO ? "m\n" : "l\n";
    } else if (operator === DRAW_CURVE_TO) {
      output += `${formatPdfNumber(pathData[offset++])} ${formatPdfNumber(pathData[offset++])} `;
      output += `${formatPdfNumber(pathData[offset++])} ${formatPdfNumber(pathData[offset++])} `;
      output += `${formatPdfNumber(pathData[offset++])} ${formatPdfNumber(pathData[offset++])} c\n`;
    } else if (operator === DRAW_QUAD_TO) {
      throw new DensePdfUnsupportedError("Internal quadratic paths cannot be serialized as PDF source.");
    } else if (operator === DRAW_CLOSE) {
      output += "h\n";
    } else {
      throw new DensePdfSyntaxError(`Invalid path opcode ${operator}.`);
    }
  }
  return UTF8_ENCODER.encode(output);
}

function cloneState(state: GraphicsState): GraphicsState {
  return {
    ...state,
    matrix: [...state.matrix],
    clipBounds: state.clipBounds ? { ...state.clipBounds } : null,
    clipMask: cloneClipMaskOrNull(state.clipMask),
    lineDash: [...state.lineDash]
  };
}

function cloneClipMaskOrNull(mask: DensePdfClipMask | null): DensePdfClipMask | null {
  if (!mask) return null;
  return {
    bounds: { ...mask.bounds },
    exclusionBounds: mask.exclusionBounds.map((bounds) => ({ ...bounds }))
  };
}

function matrixFromArgs(args: PdfValue[]): DensePdfMatrix {
  return [
    numberArg(args, 0), numberArg(args, 1), numberArg(args, 2),
    numberArg(args, 3), numberArg(args, 4), numberArg(args, 5)
  ];
}

function multiplyMatrices(a: DensePdfMatrix, b: DensePdfMatrix): DensePdfMatrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5]
  ];
}

function applyMatrix(matrix: DensePdfMatrix, x: number, y: number): [number, number] {
  return [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5]
  ];
}

function matrixScale(matrix: DensePdfMatrix): number {
  const sx = Math.hypot(matrix[0], matrix[1]);
  const sy = Math.hypot(matrix[2], matrix[3]);
  const scale = (sx + sy) * 0.5;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizeDashPattern(values: number[]): number[] {
  if (values.length === 0) return [];
  const normalized = values.length % 2 === 0 ? values : values.concat(values);
  let patternLength = 0;
  for (const value of normalized) patternLength += value;
  return patternLength <= 1e-9 ? [] : normalized;
}

function normalizeColorTriplet(r: number, g: number, b: number): [number, number, number] {
  const output = new Uint8ClampedArray(3);
  output[0] = r * 255;
  output[1] = g * 255;
  output[2] = b * 255;
  return [output[0] / 255, output[1] / 255, output[2] / 255];
}

function normalizeGray(gray: number): [number, number, number] {
  return normalizeColorTriplet(gray, gray, gray);
}

function normalizeRgb(r: number, g: number, b: number): [number, number, number] {
  return normalizeColorTriplet(r, g, b);
}

function normalizeCmyk(c: number, m: number, y: number, k: number): [number, number, number] {
  c = clamp01(c);
  m = clamp01(m);
  y = clamp01(y);
  k = clamp01(k);
  const r = 255 + c * (-4.387332384609988 * c + 54.48615194189176 * m +
    18.82290502165302 * y + 212.25662451639585 * k - 285.2331026137004) +
    m * (1.7149763477362134 * m - 5.6096736904047315 * y -
      17.873870861415444 * k - 5.497006427196366) +
    y * (-2.5217340131683033 * y - 21.248923337353073 * k + 17.5119270841813) +
    k * (-21.86122147463605 * k - 189.48180835922747);
  const g = 255 + c * (8.841041422036149 * c + 60.118027045597366 * m +
    6.871425592049007 * y + 31.159100130055922 * k - 79.2970844816548) +
    m * (-15.310361306967817 * m + 17.575251261109482 * y +
      131.35250912493976 * k - 190.9453302588951) +
    y * (4.444339102852739 * y + 9.8632861493405 * k - 24.86741582555878) +
    k * (-20.737325471181034 * k - 187.80453709719578);
  const b = 255 + c * (0.8842522430003296 * c + 8.078677503112928 * m +
    30.89978309703729 * y - 0.23883238689178934 * k - 14.183576799673286) +
    m * (10.49593273432072 * m + 63.02378494754052 * y +
      50.606957656360734 * k - 112.23884253719248) +
    y * (0.03296041114873217 * y + 115.60384449646641 * k - 193.58209356861505) +
    k * (-22.33816807309886 * k - 180.12613974708367);
  return normalizeColorTriplet(r / 255, g / 255, b / 255);
}

function parseDeviceColorSpace(name: string, operator: string): DeviceColorSpace {
  if (name === "DeviceGray" || name === "G") return "DeviceGray";
  if (name === "DeviceRGB" || name === "RGB") return "DeviceRGB";
  if (name === "DeviceCMYK" || name === "CMYK") return "DeviceCMYK";
  throw new DensePdfUnsupportedError(
    `Color space /${name} is not a built-in device color space.`,
    operator
  );
}

function normalizeDeviceColor(
  colorSpace: DeviceColorSpace,
  args: PdfValue[],
  operator: string
): [number, number, number] {
  const componentCount = colorSpace === "DeviceGray" ? 1 : colorSpace === "DeviceRGB" ? 3 : 4;
  if (args.length !== componentCount) {
    throw new DensePdfSyntaxError(
      `${operator} expected ${componentCount} components for ${colorSpace}.`
    );
  }
  if (colorSpace === "DeviceGray") return normalizeGray(numberArg(args, 0));
  if (colorSpace === "DeviceRGB") {
    return normalizeRgb(numberArg(args, 0), numberArg(args, 1), numberArg(args, 2));
  }
  return normalizeCmyk(
    numberArg(args, 0), numberArg(args, 1), numberArg(args, 2), numberArg(args, 3)
  );
}

function encodeStrokeStyleMeta(alpha: number, styleFlags: number): number {
  return clamp01(alpha) + Math.max(0, Math.trunc(styleFlags + 1e-6)) * STROKE_STYLE_FLAG_OFFSET;
}

function decodeStrokeStyleMeta(encoded: number): { alpha: number; styleFlags: number } {
  const styleFlags = Math.max(0, Math.trunc(encoded / STROKE_STYLE_FLAG_OFFSET + 1e-6));
  return { alpha: clamp01(encoded - styleFlags * STROKE_STYLE_FLAG_OFFSET), styleFlags };
}

function emptyBounds(): DensePdfBounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };
}

function includePoint(bounds: DensePdfBounds, x: number, y: number): void {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
}

function isNonEmptyBounds(bounds: DensePdfBounds | null): bounds is DensePdfBounds {
  return Boolean(bounds && bounds.minX <= bounds.maxX && bounds.minY <= bounds.maxY);
}

function combineBounds(
  primary: DensePdfBounds | null,
  secondary: DensePdfBounds | null
): DensePdfBounds | null {
  if (!primary) return secondary ? { ...secondary } : null;
  if (!secondary) return { ...primary };
  return {
    minX: Math.min(primary.minX, secondary.minX),
    minY: Math.min(primary.minY, secondary.minY),
    maxX: Math.max(primary.maxX, secondary.maxX),
    maxY: Math.max(primary.maxY, secondary.maxY)
  };
}

function intersectBounds(
  primary: DensePdfBounds | null,
  secondary: DensePdfBounds | null
): DensePdfBounds | null {
  if (!primary) return secondary ? { ...secondary } : null;
  if (!secondary) return { ...primary };
  const result = {
    minX: Math.max(primary.minX, secondary.minX),
    minY: Math.max(primary.minY, secondary.minY),
    maxX: Math.min(primary.maxX, secondary.maxX),
    maxY: Math.min(primary.maxY, secondary.maxY)
  };
  return result.minX <= result.maxX && result.minY <= result.maxY
    ? result
    : { minX: 1, minY: 1, maxX: 0, maxY: 0 };
}

function boundsIntersectNullable(
  primary: DensePdfBounds | null,
  secondary: DensePdfBounds | null
): boolean {
  if (!primary || !secondary) return false;
  if (!isNonEmptyBounds(primary) || !isNonEmptyBounds(secondary)) return false;
  return !(
    primary.maxX < secondary.minX || primary.minX > secondary.maxX ||
    primary.maxY < secondary.minY || primary.minY > secondary.maxY
  );
}

function computeTransformedPathBounds(
  pathData: Float32Array,
  matrix: DensePdfMatrix
): DensePdfBounds | null {
  const bounds = emptyBounds();
  let cursorX = 0;
  let cursorY = 0;
  let startX = 0;
  let startY = 0;
  let hasStart = false;
  const includeTransformed = (x: number, y: number): void => {
    includePoint(
      bounds,
      matrix[0] * x + matrix[2] * y + matrix[4],
      matrix[1] * x + matrix[3] * y + matrix[5]
    );
  };
  for (let offset = 0; offset < pathData.length;) {
    const operator = pathData[offset++];
    if (operator === DRAW_MOVE_TO) {
      cursorX = pathData[offset++];
      cursorY = pathData[offset++];
      startX = cursorX;
      startY = cursorY;
      hasStart = true;
      includeTransformed(cursorX, cursorY);
    } else if (operator === DRAW_LINE_TO) {
      includeTransformed(cursorX, cursorY);
      cursorX = pathData[offset++];
      cursorY = pathData[offset++];
      includeTransformed(cursorX, cursorY);
    } else if (operator === DRAW_CURVE_TO) {
      includeTransformed(cursorX, cursorY);
      includeTransformed(pathData[offset++], pathData[offset++]);
      includeTransformed(pathData[offset++], pathData[offset++]);
      cursorX = pathData[offset++];
      cursorY = pathData[offset++];
      includeTransformed(cursorX, cursorY);
    } else if (operator === DRAW_QUAD_TO) {
      includeTransformed(cursorX, cursorY);
      includeTransformed(pathData[offset++], pathData[offset++]);
      cursorX = pathData[offset++];
      cursorY = pathData[offset++];
      includeTransformed(cursorX, cursorY);
    } else if (operator === DRAW_CLOSE) {
      if (hasStart) {
        includeTransformed(cursorX, cursorY);
        includeTransformed(startX, startY);
        cursorX = startX;
        cursorY = startY;
      }
    } else {
      throw new DensePdfSyntaxError(`Invalid path opcode ${operator}.`);
    }
  }
  return isNonEmptyBounds(bounds) ? bounds : null;
}

function applyClipToState(
  state: GraphicsState,
  pathBounds: DensePdfBounds | null,
  pathMask: DensePdfClipMask | null,
  clipRule: number
): void {
  const nextClipBounds = intersectBounds(state.clipBounds, pathBounds);
  state.clipBounds = nextClipBounds;
  state.clipMask = combineClipMasks(
    state.clipMask,
    clipRule === FILL_RULE_EVEN_ODD ? pathMask : null,
    nextClipBounds
  );
}

function combineClipMasks(
  currentMask: DensePdfClipMask | null,
  nextMask: DensePdfClipMask | null,
  clipBounds: DensePdfBounds | null
): DensePdfClipMask | null {
  if (!isNonEmptyBounds(clipBounds)) return null;

  const exclusionBounds: DensePdfBounds[] = [];
  const addExclusion = (bounds: DensePdfBounds): void => {
    const clipped = intersectBounds(clipBounds, bounds);
    if (
      !isNonEmptyBounds(clipped) ||
      denseBoundsArea(clipped) <= 1e-6 ||
      denseBoundsNearlyEqual(clipped, clipBounds)
    ) return;
    exclusionBounds.push(clipped);
  };

  for (const bounds of currentMask?.exclusionBounds ?? []) addExclusion(bounds);
  for (const bounds of nextMask?.exclusionBounds ?? []) addExclusion(bounds);
  if (exclusionBounds.length === 0) return null;
  return { bounds: { ...clipBounds }, exclusionBounds };
}

function createClipConstrainedFillPath(
  pathData: Float32Array,
  matrix: DensePdfMatrix,
  localBounds: DensePdfBounds,
  visibleBounds: DensePdfBounds,
  clipMask: DensePdfClipMask | null
): Float32Array | null {
  if (!clipMask || clipMask.exclusionBounds.length === 0) return null;
  if (!denseBoundsNearlyEqual(visibleBounds, clipMask.bounds)) return null;
  if (!denseBoundsContainBoundsWithTolerance(localBounds, clipMask.bounds)) return null;
  if (!isAxisAlignedRectangleSubpath(
    pathData,
    { start: 0, end: pathData.length, bounds: localBounds },
    matrix
  )) return null;

  const exclusionBounds = clipMask.exclusionBounds.filter((bounds) => (
    denseBoundsContainBoundsWithTolerance(visibleBounds, bounds) &&
    denseBoundsArea(bounds) > 1e-6
  ));
  if (exclusionBounds.length === 0) return null;
  return createEvenOddRectanglePath(visibleBounds, exclusionBounds);
}

function createEvenOddRectanglePath(
  outerBounds: DensePdfBounds,
  exclusionBounds: DensePdfBounds[]
): Float32Array {
  const commands: number[] = [];
  appendRectanglePath(commands, outerBounds);
  for (const bounds of exclusionBounds) appendRectanglePath(commands, bounds);
  return new Float32Array(commands);
}

function appendRectanglePath(commands: number[], bounds: DensePdfBounds): void {
  commands.push(
    DRAW_MOVE_TO,
    bounds.minX,
    bounds.minY,
    DRAW_LINE_TO,
    bounds.maxX,
    bounds.minY,
    DRAW_LINE_TO,
    bounds.maxX,
    bounds.maxY,
    DRAW_LINE_TO,
    bounds.minX,
    bounds.maxY,
    DRAW_CLOSE
  );
}

interface RectangleClipSubpath {
  start: number;
  end: number;
  bounds: DensePdfBounds | null;
}

/**
 * Mirrors the one non-AABB W* case handled by the generic PDF.js extractor.
 * Every other even-odd path is reduced there to its transformed bounds, which
 * is also the representation used by the dense compiler.
 */
function extractSimpleEvenOddRectangleClipMask(
  pathData: Float32Array,
  matrix: DensePdfMatrix
): DensePdfClipMask | null {
  const subpaths: RectangleClipSubpath[] = [];
  let subpathStart = -1;

  const pushSubpath = (end: number): void => {
    if (subpathStart < 0 || end <= subpathStart) return;
    const data = pathData.subarray(subpathStart, end);
    const bounds = computeTransformedPathBounds(data, matrix);
    subpaths.push({ start: subpathStart, end, bounds });
  };

  for (let offset = 0; offset < pathData.length;) {
    const operatorOffset = offset;
    const operator = pathData[offset++];
    if (operator === DRAW_MOVE_TO) {
      pushSubpath(operatorOffset);
      subpathStart = operatorOffset;
      offset += 2;
    } else if (operator === DRAW_LINE_TO) offset += 2;
    else if (operator === DRAW_CURVE_TO) offset += 6;
    else if (operator === DRAW_QUAD_TO) offset += 4;
    else if (operator !== DRAW_CLOSE) return null;
  }
  pushSubpath(pathData.length);

  if (subpaths.length < 2) return null;
  const rectangleSubpaths: Array<RectangleClipSubpath & { bounds: DensePdfBounds }> = [];
  for (const subpath of subpaths) {
    const bounds = subpath.bounds;
    if (!isNonEmptyBounds(bounds)) return null;
    const rectangleSubpath = { ...subpath, bounds };
    if (!isAxisAlignedRectangleSubpath(pathData, rectangleSubpath, matrix)) return null;
    rectangleSubpaths.push(rectangleSubpath);
  }

  rectangleSubpaths.sort((a, b) => denseBoundsArea(b.bounds) - denseBoundsArea(a.bounds));
  const outerBounds = rectangleSubpaths[0].bounds;
  const exclusionBounds: DensePdfBounds[] = [];
  for (let index = 1; index < rectangleSubpaths.length; index += 1) {
    const bounds = rectangleSubpaths[index].bounds;
    if (
      denseBoundsArea(bounds) > 1e-6 &&
      denseBoundsContainBoundsWithTolerance(outerBounds, bounds)
    ) {
      exclusionBounds.push({ ...bounds });
    }
  }
  if (exclusionBounds.length === 0) return null;
  return { bounds: { ...outerBounds }, exclusionBounds };
}

function isAxisAlignedRectangleSubpath(
  pathData: Float32Array,
  subpath: RectangleClipSubpath & { bounds: DensePdfBounds },
  matrix: DensePdfMatrix
): boolean {
  const { bounds } = subpath;
  const width = Math.max(0, bounds.maxX - bounds.minX);
  const height = Math.max(0, bounds.maxY - bounds.minY);
  if (width <= 1e-6 || height <= 1e-6) return false;

  const epsilon = Math.max(1e-3, Math.max(width, height) * 1e-4);
  let cornerMask = 0;
  let moveCount = 0;
  let lineCount = 0;

  const recordPoint = (x: number, y: number): boolean => {
    const transformedX = matrix[0] * x + matrix[2] * y + matrix[4];
    const transformedY = matrix[1] * x + matrix[3] * y + matrix[5];
    const nearMinX = Math.abs(transformedX - bounds.minX) <= epsilon;
    const nearMaxX = Math.abs(transformedX - bounds.maxX) <= epsilon;
    const nearMinY = Math.abs(transformedY - bounds.minY) <= epsilon;
    const nearMaxY = Math.abs(transformedY - bounds.maxY) <= epsilon;
    if (nearMinX && nearMinY) cornerMask |= 1;
    else if (nearMaxX && nearMinY) cornerMask |= 2;
    else if (nearMaxX && nearMaxY) cornerMask |= 4;
    else if (nearMinX && nearMaxY) cornerMask |= 8;
    else return false;
    return true;
  };

  for (let offset = subpath.start; offset < subpath.end;) {
    const operator = pathData[offset++];
    if (operator === DRAW_MOVE_TO) {
      moveCount += 1;
      if (!recordPoint(pathData[offset++], pathData[offset++])) return false;
    } else if (operator === DRAW_LINE_TO) {
      lineCount += 1;
      if (!recordPoint(pathData[offset++], pathData[offset++])) return false;
    } else if (operator === DRAW_CLOSE) {
      continue;
    } else {
      return false;
    }
  }
  return moveCount === 1 && lineCount >= 3 && lineCount <= 4 && cornerMask === 15;
}

function denseBoundsContainBoundsWithTolerance(
  outer: DensePdfBounds,
  inner: DensePdfBounds
): boolean {
  const epsilon = denseBoundsComparisonTolerance(outer, inner);
  return (
    inner.minX >= outer.minX - epsilon &&
    inner.minY >= outer.minY - epsilon &&
    inner.maxX <= outer.maxX + epsilon &&
    inner.maxY <= outer.maxY + epsilon
  );
}

function denseBoundsNearlyEqual(a: DensePdfBounds, b: DensePdfBounds): boolean {
  const epsilon = denseBoundsComparisonTolerance(a, b);
  return (
    Math.abs(a.minX - b.minX) <= epsilon &&
    Math.abs(a.minY - b.minY) <= epsilon &&
    Math.abs(a.maxX - b.maxX) <= epsilon &&
    Math.abs(a.maxY - b.maxY) <= epsilon
  );
}

function denseBoundsComparisonTolerance(a: DensePdfBounds, b: DensePdfBounds): number {
  const width = Math.max(Math.abs(a.maxX - a.minX), Math.abs(b.maxX - b.minX));
  const height = Math.max(Math.abs(a.maxY - a.minY), Math.abs(b.maxY - b.minY));
  return Math.max(1e-3, Math.max(width, height) * 1e-5);
}

function denseBoundsArea(bounds: DensePdfBounds): number {
  return Math.max(0, bounds.maxX - bounds.minX) * Math.max(0, bounds.maxY - bounds.minY);
}

function isOpaqueWhiteBackgroundFill(
  bounds: DensePdfBounds,
  pageBounds: DensePdfBounds,
  colorR: number,
  colorG: number,
  colorB: number,
  alpha: number
): boolean {
  if (
    alpha < OPAQUE_ALPHA_EPSILON ||
    colorR < 1 - BACKGROUND_FILL_COLOR_EPSILON ||
    colorG < 1 - BACKGROUND_FILL_COLOR_EPSILON ||
    colorB < 1 - BACKGROUND_FILL_COLOR_EPSILON
  ) return false;
  const pageWidth = Math.max(1e-6, pageBounds.maxX - pageBounds.minX);
  const pageHeight = Math.max(1e-6, pageBounds.maxY - pageBounds.minY);
  const width = Math.max(0, bounds.maxX - bounds.minX);
  const height = Math.max(0, bounds.maxY - bounds.minY);
  return (
    (width * height) / Math.max(1e-6, pageWidth * pageHeight) >= BACKGROUND_FILL_MIN_AREA_RATIO &&
    Math.max(width / pageWidth, height / pageHeight) >= BACKGROUND_FILL_MIN_DIMENSION_RATIO
  );
}

function quantize(value: number, scale: number): number {
  const result = Math.round(value * scale);
  // String-based keys in the established culler canonicalize -0 to "0".
  // Normalize it before hashing the IEEE representation so equal keys always
  // have equal hashes as well.
  return result === 0 ? 0 : result;
}

function fillDuplicateTuple(
  tuple: Float64Array,
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  primitiveType: number,
  halfWidth: number,
  colorR: number,
  colorG: number,
  colorB: number,
  alpha: number,
  styleFlags: number
): void {
  const isQuadratic = primitiveType >= STROKE_PRIMITIVE_QUADRATIC - 0.5;
  let ax = x0;
  let ay = y0;
  let bx = x1;
  let by = y1;
  let qcx = cx;
  let qcy = cy;
  if (!isQuadratic && (ax > bx || (ax === bx && ay > by))) {
    ax = x1;
    ay = y1;
    bx = x0;
    by = y0;
  }
  if (!isQuadratic) {
    qcx = bx;
    qcy = by;
  }
  tuple[0] = quantize(primitiveType, 10);
  tuple[1] = quantize(halfWidth, DUPLICATE_STYLE_SCALE);
  tuple[2] = quantize(colorR, DUPLICATE_STYLE_SCALE);
  tuple[3] = quantize(colorG, DUPLICATE_STYLE_SCALE);
  tuple[4] = quantize(colorB, DUPLICATE_STYLE_SCALE);
  tuple[5] = quantize(alpha, DUPLICATE_STYLE_SCALE);
  tuple[6] = quantize(styleFlags, 1);
  tuple[7] = quantize(ax, DUPLICATE_POSITION_SCALE);
  tuple[8] = quantize(ay, DUPLICATE_POSITION_SCALE);
  tuple[9] = quantize(qcx, DUPLICATE_POSITION_SCALE);
  tuple[10] = quantize(qcy, DUPLICATE_POSITION_SCALE);
  tuple[11] = quantize(bx, DUPLICATE_POSITION_SCALE);
  tuple[12] = quantize(by, DUPLICATE_POSITION_SCALE);
}

function hashFloatTuple(tuple: Float64Array, words: Uint32Array): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < words.length; index += 1) {
    let value = words[index];
    hash = Math.imul(hash ^ value, 0x01000193);
    value >>>= 16;
    hash = Math.imul(hash ^ value, 0x01000193);
  }
  hash >>>= 0;
  return hash === 0 ? 1 : hash;
}

function crossDistanceSq(px: number, py: number, ux: number, uy: number, lenSq: number): number {
  const cross = px * uy - py * ux;
  return (cross * cross) / lenSq;
}

function flattenCubic(
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, x3: number, y3: number,
  emitLine: (ax: number, ay: number, bx: number, by: number) => void,
  flatness: number,
  maxDepth: number
): void {
  const stack: number[] = [x0, y0, x1, y1, x2, y2, x3, y3, 0];
  const flatnessSq = flatness * flatness;
  while (stack.length > 0) {
    const depth = stack.pop() as number;
    const q3y = stack.pop() as number;
    const q3x = stack.pop() as number;
    const q2y = stack.pop() as number;
    const q2x = stack.pop() as number;
    const q1y = stack.pop() as number;
    const q1x = stack.pop() as number;
    const q0y = stack.pop() as number;
    const q0x = stack.pop() as number;
    if (depth >= maxDepth || cubicFlatnessSq(
      q0x, q0y, q1x, q1y, q2x, q2y, q3x, q3y
    ) <= flatnessSq) {
      emitLine(q0x, q0y, q3x, q3y);
      continue;
    }
    const x01 = (q0x + q1x) * 0.5;
    const y01 = (q0y + q1y) * 0.5;
    const x12 = (q1x + q2x) * 0.5;
    const y12 = (q1y + q2y) * 0.5;
    const x23 = (q2x + q3x) * 0.5;
    const y23 = (q2y + q3y) * 0.5;
    const x012 = (x01 + x12) * 0.5;
    const y012 = (y01 + y12) * 0.5;
    const x123 = (x12 + x23) * 0.5;
    const y123 = (y12 + y23) * 0.5;
    const x0123 = (x012 + x123) * 0.5;
    const y0123 = (y012 + y123) * 0.5;
    const nextDepth = depth + 1;
    stack.push(x0123, y0123, x123, y123, x23, y23, q3x, q3y, nextDepth);
    stack.push(q0x, q0y, x01, y01, x012, y012, x0123, y0123, nextDepth);
  }
}

function cubicFlatnessSq(
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, x3: number, y3: number
): number {
  const ux = x3 - x0;
  const uy = y3 - y0;
  const lengthSq = ux * ux + uy * uy;
  if (lengthSq < 1e-12) return 0;
  return Math.max(
    crossDistanceSq(x1 - x0, y1 - y0, ux, uy, lengthSq),
    crossDistanceSq(x2 - x0, y2 - y0, ux, uy, lengthSq)
  );
}

function emitCubicAsQuadratics(
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, x3: number, y3: number,
  emitQuadratic: (sx: number, sy: number, cx: number, cy: number, ex: number, ey: number) => void,
  maxError: number,
  maxDepth: number
): void {
  const stack: number[] = [x0, y0, x1, y1, x2, y2, x3, y3, 0];
  const maxErrorSq = maxError * maxError;
  while (stack.length > 0) {
    const depth = stack.pop() as number;
    const q3y = stack.pop() as number;
    const q3x = stack.pop() as number;
    const q2y = stack.pop() as number;
    const q2x = stack.pop() as number;
    const q1y = stack.pop() as number;
    const q1x = stack.pop() as number;
    const q0y = stack.pop() as number;
    const q0x = stack.pop() as number;
    const controlX = (3 * (q1x + q2x) - q0x - q3x) * 0.25;
    const controlY = (3 * (q1y + q2y) - q0y - q3y) * 0.25;
    if (depth >= maxDepth || cubicQuadraticApproxErrorSq(
      q0x, q0y, q1x, q1y, q2x, q2y, q3x, q3y, controlX, controlY
    ) <= maxErrorSq) {
      emitQuadratic(q0x, q0y, controlX, controlY, q3x, q3y);
      continue;
    }
    const x01 = (q0x + q1x) * 0.5;
    const y01 = (q0y + q1y) * 0.5;
    const x12 = (q1x + q2x) * 0.5;
    const y12 = (q1y + q2y) * 0.5;
    const x23 = (q2x + q3x) * 0.5;
    const y23 = (q2y + q3y) * 0.5;
    const x012 = (x01 + x12) * 0.5;
    const y012 = (y01 + y12) * 0.5;
    const x123 = (x12 + x23) * 0.5;
    const y123 = (y12 + y23) * 0.5;
    const x0123 = (x012 + x123) * 0.5;
    const y0123 = (y012 + y123) * 0.5;
    const nextDepth = depth + 1;
    stack.push(x0123, y0123, x123, y123, x23, y23, q3x, q3y, nextDepth);
    stack.push(q0x, q0y, x01, y01, x012, y012, x0123, y0123, nextDepth);
  }
}

function cubicQuadraticApproxErrorSq(
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, x3: number, y3: number,
  cx: number, cy: number
): number {
  let maxSq = 0;
  for (const t of [0.25, 0.5, 0.75]) {
    const oneMinus = 1 - t;
    const oneMinusSq = oneMinus * oneMinus;
    const tSq = t * t;
    const cubicX = oneMinusSq * oneMinus * x0 + 3 * oneMinusSq * t * x1 +
      3 * oneMinus * tSq * x2 + tSq * t * x3;
    const cubicY = oneMinusSq * oneMinus * y0 + 3 * oneMinusSq * t * y1 +
      3 * oneMinus * tSq * y2 + tSq * t * y3;
    const quadX = oneMinusSq * x0 + 2 * oneMinus * t * cx + tSq * x3;
    const quadY = oneMinusSq * y0 + 2 * oneMinus * t * cy + tSq * y3;
    const dx = cubicX - quadX;
    const dy = cubicY - quadY;
    maxSq = Math.max(maxSq, dx * dx + dy * dy);
  }
  return maxSq;
}
