import { PdfError, throwIfAborted } from "./nativeTypes";

const EOL = "000000000001";
const EOFB = `${EOL}${EOL}`;
const RUN_EXTENSION = -1;

/** PDF CCITTFaxDecode parameters, using the defaults from ISO 32000-1 table 11. */
export interface NativeCcittParameters {
  readonly K?: number;
  readonly Columns?: number;
  readonly Rows?: number;
  readonly EndOfLine?: boolean;
  readonly EncodedByteAlign?: boolean;
  readonly EndOfBlock?: boolean;
  readonly BlackIs1?: boolean;
  readonly DamagedRowsBeforeError?: number;
}

export interface NativeCcittLimits {
  readonly maxColumns: number;
  readonly maxRows: number;
  readonly maxPixels: number;
  readonly maxOutputBytes: number;
  /** Total bit-reader work, including bounded EOL resynchronization and lookahead. */
  readonly maxScanBits: number;
  /** Total run/mode operations. This also bounds changing-element construction. */
  readonly maxTransitions: number;
  readonly maxDamagedRows: number;
}

export interface NativeCcittDecodeOptions {
  readonly limits?: Partial<NativeCcittLimits>;
  readonly signal?: AbortSignal;
}

export interface NativeCcittDecodeResult {
  /**
   * Row-major, MSB-first packed 1-bpp samples. A one bit denotes black exactly
   * when blackIs1 is true. Unused low bits in the last byte of every row are 0.
   */
  readonly bytes: Uint8Array;
  readonly columns: number;
  readonly rows: number;
  readonly rowStride: number;
  readonly blackIs1: boolean;
  readonly damagedRows: number;
  readonly bitsConsumed: number;
  readonly bytesConsumed: number;
  readonly terminatedBy: "end-of-block" | "rows" | "end-of-data";
}

const DEFAULT_LIMITS: Readonly<NativeCcittLimits> = Object.freeze({
  maxColumns: 65_535,
  maxRows: 65_535,
  maxPixels: 268_435_456,
  maxOutputBytes: 512 * 1024 * 1024,
  maxScanBits: 8_589_934_592,
  maxTransitions: 268_435_456,
  maxDamagedRows: 1024
});

type RunCode = readonly [runLength: number, bits: string];

// ITU-T T.4 tables 2, 3a, and 3b. Keeping the normative code words in this
// compact form makes prefix validation auditable and avoids a large sparse
// decoder table in every worker.
const WHITE_TERMINATING_BITS: readonly string[] = [
  "00110101", "000111", "0111", "1000", "1011", "1100", "1110", "1111",
  "10011", "10100", "00111", "01000", "001000", "000011", "110100", "110101",
  "101010", "101011", "0100111", "0001100", "0001000", "0010111", "0000011",
  "0000100", "0101000", "0101011", "0010011", "0100100", "0011000", "00000010",
  "00000011", "00011010", "00011011", "00010010", "00010011", "00010100",
  "00010101", "00010110", "00010111", "00101000", "00101001", "00101010",
  "00101011", "00101100", "00101101", "00000100", "00000101", "00001010",
  "00001011", "01010010", "01010011", "01010100", "01010101", "00100100",
  "00100101", "01011000", "01011001", "01011010", "01011011", "01001010",
  "01001011", "00110010", "00110011", "00110100"
];

const BLACK_TERMINATING_BITS: readonly string[] = [
  "0000110111", "010", "11", "10", "011", "0011", "0010", "00011",
  "000101", "000100", "0000100", "0000101", "0000111", "00000100", "00000111",
  "000011000", "0000010111", "0000011000", "0000001000", "00001100111",
  "00001101000", "00001101100", "00000110111", "00000101000", "00000010111",
  "00000011000", "000011001010", "000011001011", "000011001100", "000011001101",
  "000001101000", "000001101001", "000001101010", "000001101011", "000011010010",
  "000011010011", "000011010100", "000011010101", "000011010110", "000011010111",
  "000001101100", "000001101101", "000011011010", "000011011011", "000001010100",
  "000001010101", "000001010110", "000001010111", "000001100100", "000001100101",
  "000001010010", "000001010011", "000000100100", "000000110111", "000000111000",
  "000000100111", "000000101000", "000001011000", "000001011001", "000000101011",
  "000000101100", "000001011010", "000001100110", "000001100111"
];

const WHITE_MAKEUP: readonly RunCode[] = [
  [64, "11011"], [128, "10010"], [192, "010111"], [256, "0110111"],
  [320, "00110110"], [384, "00110111"], [448, "01100100"], [512, "01100101"],
  [576, "01101000"], [640, "01100111"], [704, "011001100"], [768, "011001101"],
  [832, "011010010"], [896, "011010011"], [960, "011010100"], [1024, "011010101"],
  [1088, "011010110"], [1152, "011010111"], [1216, "011011000"], [1280, "011011001"],
  [1344, "011011010"], [1408, "011011011"], [1472, "010011000"], [1536, "010011001"],
  [1600, "010011010"], [1664, "011000"], [1728, "010011011"]
];

const BLACK_MAKEUP: readonly RunCode[] = [
  [64, "0000001111"], [128, "000011001000"], [192, "000011001001"],
  [256, "000001011011"], [320, "000000110011"], [384, "000000110100"],
  [448, "000000110101"], [512, "0000001101100"], [576, "0000001101101"],
  [640, "0000001001010"], [704, "0000001001011"], [768, "0000001001100"],
  [832, "0000001001101"], [896, "0000001110010"], [960, "0000001110011"],
  [1024, "0000001110100"], [1088, "0000001110101"], [1152, "0000001110110"],
  [1216, "0000001110111"], [1280, "0000001010010"], [1344, "0000001010011"],
  [1408, "0000001010100"], [1472, "0000001010101"], [1536, "0000001011010"],
  [1600, "0000001011011"], [1664, "0000001100100"], [1728, "0000001100101"]
];

const SHARED_MAKEUP: readonly RunCode[] = [
  [1792, "00000001000"], [1856, "00000001100"], [1920, "00000001101"],
  [1984, "000000010010"], [2048, "000000010011"], [2112, "000000010100"],
  [2176, "000000010101"], [2240, "000000010110"], [2304, "000000010111"],
  [2368, "000000011100"], [2432, "000000011101"], [2496, "000000011110"],
  [2560, "000000011111"]
];

interface CodeNode<T> {
  zero?: CodeNode<T>;
  one?: CodeNode<T>;
  value?: T;
}

interface ModeValue {
  readonly kind: "pass" | "horizontal" | "vertical" | "extension";
  readonly delta?: number;
}

const WHITE_CODES = buildRunTrie("white", WHITE_TERMINATING_BITS, WHITE_MAKEUP);
const BLACK_CODES = buildRunTrie("black", BLACK_TERMINATING_BITS, BLACK_MAKEUP);
const MODE_CODES = buildCodeTrie<ModeValue>("two-dimensional", [
  ["1", { kind: "vertical", delta: 0 }],
  ["011", { kind: "vertical", delta: 1 }],
  ["010", { kind: "vertical", delta: -1 }],
  ["000011", { kind: "vertical", delta: 2 }],
  ["000010", { kind: "vertical", delta: -2 }],
  ["0000011", { kind: "vertical", delta: 3 }],
  ["0000010", { kind: "vertical", delta: -3 }],
  ["0001", { kind: "pass" }],
  ["001", { kind: "horizontal" }],
  // T.4/T.6 reserves the following prefix for extension modes. PDF does not
  // provide semantics for them, so recognizing it must produce a typed error.
  ["0000001", { kind: "extension" }]
]);

/** Decode one complete PDF CCITTFaxDecode payload without platform codecs. */
export function decodeNativeCcittFax(
  input: Uint8Array,
  parameters: NativeCcittParameters = {},
  options: NativeCcittDecodeOptions = {}
): NativeCcittDecodeResult {
  if (!(input instanceof Uint8Array)) {
    throw new PdfError("invalid-object", "CCITTFaxDecode input must be a Uint8Array.");
  }
  const limits = mergeLimits(options.limits);
  const params = readParameters(parameters, limits);
  throwIfAborted(options.signal);

  const inputBits = checkedMultiply(input.length, 8, "CCITT encoded bit length");
  if (inputBits > limits.maxScanBits) {
    throw resourceLimit("CCITT encoded input exceeds the configured scan ceiling.", {
      encodedBits: inputBits,
      limit: limits.maxScanBits
    });
  }
  if (!params.endOfBlock && params.rows > 0) {
    enforceProspectiveOutput(params.columns, params.rows, params.rowStride, limits);
  }

  const reader = new MsbBitReader(input, limits.maxScanBits, options.signal);
  const budget = new TransitionBudget(limits.maxTransitions, options.signal);
  const output = new PackedRowWriter(params.rowStride, limits.maxOutputBytes);
  let reference: DecodedRow | null = null;
  let previousWasDamaged = false;
  let pendingMode: "1d" | "2d" | null = null;
  let damagedRows = 0;
  let terminatedBy: NativeCcittDecodeResult["terminatedBy"] | null = null;

  while (terminatedBy === null) {
    throwIfAborted(options.signal);
    const decodedRows = output.rowCount;
    if (!params.endOfBlock && params.rows > 0 && decodedRows >= params.rows) {
      terminatedBy = "rows";
      break;
    }
    if (!params.endOfBlock && reader.hasOnlyFinalZeroPadding()) {
      reader.skipFinalZeroPadding();
      terminatedBy = "end-of-data";
      break;
    }

    let decoded: DecodedRow;
    let recoveryFloor = reader.position;
    try {
      let mode = pendingMode;
      pendingMode = null;
      if (mode === null) {
        const start = readLineStart(reader, params, decodedRows);
        if (start === "end-of-block") {
          terminatedBy = "end-of-block";
          break;
        }
        if (start === "end-of-data") {
          terminatedBy = "end-of-data";
          break;
        }
        mode = start;
      }
      // A bad variable-length code may have consumed the first few zero bits
      // of the following EOL before it becomes invalid. Retain a bounded
      // overlap so the explicitly permitted damaged-row resynchronizer can
      // still recognize that delimiter without rescanning earlier rows.
      recoveryFloor = reader.position;
      enforceNextDecodedRow(output.rowCount, params, limits);
      decoded = mode === "1d"
        ? decodeOneDimensionalRow(reader, params.columns, budget)
        : decodeTwoDimensionalRow(reader, params.columns, reference?.transitions ?? [], budget);
    } catch (cause) {
      if (!isRecoverableRowError(cause) || params.damagedRowsBeforeError === 0) throw cause;
      damagedRows += 1;
      if (damagedRows > params.damagedRowsBeforeError || damagedRows > limits.maxDamagedRows) {
        throw new PdfError("invalid-object", "CCITTFaxDecode damaged-row tolerance was exceeded.", {
          cause,
          offset: reader.byteOffset,
          details: {
            reason: "ccitt-damaged-row-limit",
            damagedRows,
            tolerance: params.damagedRowsBeforeError
          }
        });
      }
      reader.restore(Math.max(recoveryFloor, reader.position - EOL.length));
      const synchronization = resynchronizeAfterDamagedRow(reader, params);
      pendingMode = synchronization.nextMode;
      enforceNextDecodedRow(output.rowCount, params, limits);
      decoded = !previousWasDamaged && reference !== null
        ? cloneDecodedRow(reference)
        : whiteRow(params.rowStride);
      previousWasDamaged = true;
      appendDecodedRow(output, decoded, params, limits);
      reference = decoded;
      if (synchronization.endOfBlock) terminatedBy = "end-of-block";
      continue;
    }

    previousWasDamaged = false;
    appendDecodedRow(output, decoded, params, limits);
    reference = decoded;
  }

  if (terminatedBy === null) {
    throw new PdfError("invalid-object", "CCITTFaxDecode did not reach a deterministic terminator.");
  }
  if (terminatedBy === "end-of-block") reader.skipToByteBoundary(false);
  else if (terminatedBy === "rows") reader.skipToByteBoundary(false);

  return {
    bytes: output.finish(params.blackIs1, params.columns, options.signal),
    columns: params.columns,
    rows: output.rowCount,
    rowStride: params.rowStride,
    blackIs1: params.blackIs1,
    damagedRows,
    bitsConsumed: reader.position,
    bytesConsumed: Math.ceil(reader.position / 8),
    terminatedBy
  };
}

interface NormalizedParameters {
  readonly k: number;
  readonly columns: number;
  readonly rows: number;
  readonly rowStride: number;
  readonly endOfLine: boolean;
  readonly encodedByteAlign: boolean;
  readonly endOfBlock: boolean;
  readonly blackIs1: boolean;
  readonly damagedRowsBeforeError: number;
}

function readParameters(
  value: NativeCcittParameters,
  limits: Readonly<NativeCcittLimits>
): NormalizedParameters {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PdfError("invalid-object", "CCITTFaxDecode parameters must be an object.");
  }
  const k = integerParameter(value.K, 0, "K", true);
  const columns = integerParameter(value.Columns, 1728, "Columns", false);
  const rows = integerParameter(value.Rows, 0, "Rows", true);
  const damagedRowsBeforeError = integerParameter(
    value.DamagedRowsBeforeError,
    0,
    "DamagedRowsBeforeError",
    true
  );
  if (columns <= 0) throw invalidParameter("Columns", "must be positive");
  if (rows < 0) throw invalidParameter("Rows", "must be nonnegative");
  if (damagedRowsBeforeError < 0) {
    throw invalidParameter("DamagedRowsBeforeError", "must be nonnegative");
  }
  if (columns > limits.maxColumns) {
    throw resourceLimit("CCITT Columns exceeds the configured dimension ceiling.", {
      columns,
      limit: limits.maxColumns
    });
  }
  if (rows > limits.maxRows) {
    throw resourceLimit("CCITT Rows exceeds the configured dimension ceiling.", {
      rows,
      limit: limits.maxRows
    });
  }
  if (damagedRowsBeforeError > limits.maxDamagedRows) {
    throw resourceLimit("CCITT damaged-row tolerance exceeds the configured ceiling.", {
      damagedRowsBeforeError,
      limit: limits.maxDamagedRows
    });
  }
  const endOfLine = booleanParameter(value.EndOfLine, false, "EndOfLine");
  const encodedByteAlign = booleanParameter(
    value.EncodedByteAlign,
    false,
    "EncodedByteAlign"
  );
  const endOfBlock = booleanParameter(value.EndOfBlock, true, "EndOfBlock");
  const blackIs1 = booleanParameter(value.BlackIs1, false, "BlackIs1");
  if (k < 0 && endOfLine) {
    throw invalidParameter("EndOfLine", "is not defined for Group 4 two-dimensional data");
  }
  if (damagedRowsBeforeError > 0 && (!endOfLine || k < 0)) {
    throw invalidParameter(
      "DamagedRowsBeforeError",
      "requires EndOfLine true and a nonnegative K"
    );
  }
  return {
    k,
    columns,
    rows,
    rowStride: Math.ceil(columns / 8),
    endOfLine,
    encodedByteAlign,
    endOfBlock,
    blackIs1,
    damagedRowsBeforeError
  };
}

function readLineStart(
  reader: MsbBitReader,
  params: NormalizedParameters,
  rowIndex: number
): "1d" | "2d" | "end-of-block" | "end-of-data" {
  if (params.encodedByteAlign) reader.skipToByteBoundary(true);
  if (params.k < 0) {
    if (params.endOfBlock && reader.tryConsumeExact(EOFB)) return "end-of-block";
    if (reader.atEnd || (params.endOfBlock && reader.hasOnlyFinalZeroPadding())) {
      if (!reader.atEnd) reader.skipFinalZeroPadding();
      if (!params.endOfBlock) return "end-of-data";
      throw malformed(reader, "Truncated Group 4 data without an EOFB marker.", "ccitt-missing-eofb");
    }
    return "2d";
  }

  if (params.endOfBlock && tryConsumeRtc(reader, params.k > 0)) return "end-of-block";
  if (params.endOfBlock && reader.hasOnlyFinalZeroPadding()) {
    reader.skipFinalZeroPadding();
    throw malformed(reader, "Truncated Group 3 data without an RTC marker.", "ccitt-missing-rtc");
  }
  const hadEol = reader.tryConsumeEol();
  if (params.endOfLine && !hadEol) {
    throw malformed(reader, "CCITTFaxDecode row is missing its required EOL.", "ccitt-missing-eol");
  }
  let mode: "1d" | "2d" = "1d";
  if (params.k > 0) {
    // ISO 32000 requires decoders to distinguish negative, zero, and positive
    // K, but not different positive values; the per-row tag is authoritative.
    const tag = reader.readRequired("Truncated CCITT Group 3 line tag.");
    mode = tag === 1 ? "1d" : "2d";
    if (rowIndex === 0 && mode !== "1d") {
      throw malformed(
        reader,
        "The first mixed Group 3 row must be one-dimensional.",
        "ccitt-first-row-2d"
      );
    }
  }
  if (!params.endOfBlock && reader.hasOnlyFinalZeroPadding()) {
    reader.skipFinalZeroPadding();
    return "end-of-data";
  }
  return mode;
}

function tryConsumeRtc(reader: MsbBitReader, mixed: boolean): boolean {
  const checkpoint = reader.mark();
  if (!reader.tryConsumeEol()) {
    reader.restore(checkpoint);
    return false;
  }
  if (mixed && reader.readOptional() !== 1) {
    reader.restore(checkpoint);
    return false;
  }
  for (let index = 1; index < 6; index += 1) {
    if (!reader.tryConsumeExact(EOL) || (mixed && reader.readOptional() !== 1)) {
      reader.restore(checkpoint);
      return false;
    }
  }
  return true;
}

interface DamagedSynchronization {
  readonly nextMode: "1d" | "2d" | null;
  readonly endOfBlock: boolean;
}

function resynchronizeAfterDamagedRow(
  reader: MsbBitReader,
  params: NormalizedParameters
): DamagedSynchronization {
  reader.searchForEol();
  const afterFirstEol = reader.mark();
  if (params.endOfBlock) {
    let rtc = true;
    if (params.k > 0 && reader.readOptional() !== 1) rtc = false;
    for (let index = 1; rtc && index < 6; index += 1) {
      if (!reader.tryConsumeExact(EOL) || (params.k > 0 && reader.readOptional() !== 1)) {
        rtc = false;
      }
    }
    if (rtc) return { nextMode: null, endOfBlock: true };
    reader.restore(afterFirstEol);
  }
  if (params.k > 0) {
    const tag = reader.readRequired("Truncated CCITT line tag after damaged-row recovery.");
    return { nextMode: tag === 1 ? "1d" : "2d", endOfBlock: false };
  }
  return { nextMode: "1d", endOfBlock: false };
}

interface DecodedRow {
  /** Internal representation is always MSB-first with 1 denoting black. */
  readonly blackBits: Uint8Array;
  /** Strictly increasing changing-element positions, excluding Columns. */
  readonly transitions: readonly number[];
}

function decodeOneDimensionalRow(
  reader: MsbBitReader,
  columns: number,
  budget: TransitionBudget
): DecodedRow {
  const row = allocateBytes(Math.ceil(columns / 8), "CCITT scan line");
  const transitions: number[] = [];
  let position = 0;
  let black = false;
  while (position < columns) {
    const run = decodeRun(reader, black, columns - position, budget);
    const end = position + run;
    if (black) setBlackRange(row, position, end, budget);
    if (end < columns) toggleTransition(transitions, end, budget);
    position = end;
    black = !black;
  }
  return { blackBits: row, transitions };
}

function decodeTwoDimensionalRow(
  reader: MsbBitReader,
  columns: number,
  reference: readonly number[],
  budget: TransitionBudget
): DecodedRow {
  const row = allocateBytes(Math.ceil(columns / 8), "CCITT scan line");
  const transitions: number[] = [];
  let position = 0;
  let black = false;
  while (position < columns) {
    budget.consume();
    const mode = decodeCode(reader, MODE_CODES, 7, "two-dimensional mode");
    if (mode.kind === "extension") {
      throw new PdfError("unsupported-filter", "CCITT extension and uncompressed modes are unsupported.", {
        offset: reader.byteOffset,
        details: { reason: "ccitt-extension-mode", bitOffset: reader.position }
      });
    }
    const referencePoint = findReferenceTransition(reference, position, black, columns);
    if (mode.kind === "pass") {
      if (referencePoint.b2 <= position) {
        throw malformed(reader, "CCITT pass mode does not advance the row.", "ccitt-pass-no-progress");
      }
      if (black) setBlackRange(row, position, referencePoint.b2, budget);
      position = referencePoint.b2;
      continue;
    }
    if (mode.kind === "horizontal") {
      const first = decodeRun(reader, black, columns - position, budget);
      const firstEnd = position + first;
      const second = decodeRun(reader, !black, columns - firstEnd, budget);
      const secondEnd = firstEnd + second;
      if (black) setBlackRange(row, position, firstEnd, budget);
      else setBlackRange(row, firstEnd, secondEnd, budget);
      if (firstEnd < columns) toggleTransition(transitions, firstEnd, budget);
      if (secondEnd < columns) toggleTransition(transitions, secondEnd, budget);
      if (secondEnd <= position) {
        throw malformed(
          reader,
          "CCITT horizontal mode does not advance the row.",
          "ccitt-horizontal-no-progress"
        );
      }
      position = secondEnd;
      continue;
    }
    const next = referencePoint.b1 + mode.delta!;
    if (!Number.isSafeInteger(next) || next < position || next > columns) {
      throw new PdfError(
        "invalid-object",
        "CCITT vertical mode places a changing element outside the row.",
        {
          offset: reader.byteOffset,
          details: {
            reason: "ccitt-invalid-vertical",
            bitOffset: reader.position,
            position,
            reference: referencePoint.b1,
            delta: mode.delta!,
            columns
          }
        }
      );
    }
    if (black) setBlackRange(row, position, next, budget);
    if (next < columns) toggleTransition(transitions, next, budget);
    position = next;
    black = !black;
  }
  return { blackBits: row, transitions };
}

function decodeRun(
  reader: MsbBitReader,
  black: boolean,
  remaining: number,
  budget: TransitionBudget
): number {
  let total = 0;
  while (true) {
    budget.consume();
    const value = decodeCode(
      reader,
      black ? BLACK_CODES : WHITE_CODES,
      black ? 13 : 12,
      black ? "black run" : "white run"
    );
    if (value === RUN_EXTENSION) {
      throw new PdfError("unsupported-filter", "CCITT one-dimensional extension modes are unsupported.", {
        offset: reader.byteOffset,
        details: { reason: "ccitt-1d-extension-mode", bitOffset: reader.position }
      });
    }
    total = checkedAdd(total, value, "CCITT run length");
    if (total > remaining) {
      throw malformed(reader, "CCITT run oversubscribes its scan line.", "ccitt-run-oversubscribed");
    }
    if (value < 64) return total;
  }
}

function decodeCode<T>(
  reader: MsbBitReader,
  root: CodeNode<T>,
  maxBits: number,
  label: string
): T {
  let node = root;
  const start = reader.position;
  for (let length = 1; length <= maxBits; length += 1) {
    const bit = reader.readRequired(`Truncated CCITT ${label} code.`);
    const next = bit === 0 ? node.zero : node.one;
    if (!next) {
      throw malformedAt(reader, start, `Malformed CCITT ${label} code.`, "ccitt-invalid-code");
    }
    node = next;
    if (node.value !== undefined) return node.value;
  }
  throw malformedAt(reader, start, `Oversized CCITT ${label} code.`, "ccitt-oversized-code");
}

function findReferenceTransition(
  transitions: readonly number[],
  position: number,
  black: boolean,
  columns: number
): { readonly b1: number; readonly b2: number } {
  let low = 0;
  let high = transitions.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (transitions[middle] < position) low = middle + 1;
    else high = middle;
  }
  // Even transition indexes enter black; odd indexes enter white. b1 enters
  // the colour opposite the current coding run.
  const desiredParity = black ? 1 : 0;
  if ((low & 1) !== desiredParity) low += 1;
  const b1 = low < transitions.length ? transitions[low] : columns;
  const b2 = low + 1 < transitions.length ? transitions[low + 1] : columns;
  return { b1, b2 };
}

function toggleTransition(
  transitions: number[],
  position: number,
  budget: TransitionBudget
): void {
  budget.consume();
  const previous = transitions[transitions.length - 1];
  if (previous === position) transitions.pop();
  else {
    if (previous !== undefined && position < previous) {
      throw new PdfError("invalid-object", "CCITT changing elements are not ordered.", {
        details: { reason: "ccitt-transition-order", position, previous }
      });
    }
    transitions.push(position);
  }
}

function setBlackRange(
  bytes: Uint8Array,
  start: number,
  end: number,
  budget: TransitionBudget
): void {
  budget.checkCancellation();
  let position = start;
  while (position < end && (position & 7) !== 0) {
    bytes[position >>> 3] |= 1 << (7 - (position & 7));
    position += 1;
  }
  const fullByteEnd = end >>> 3;
  if (position < (fullByteEnd << 3)) {
    bytes.fill(0xff, position >>> 3, fullByteEnd);
    position = fullByteEnd << 3;
  }
  while (position < end) {
    bytes[position >>> 3] |= 1 << (7 - (position & 7));
    position += 1;
  }
  budget.checkCancellation();
}

function whiteRow(rowStride: number): DecodedRow {
  return { blackBits: allocateBytes(rowStride, "CCITT damaged white row"), transitions: [] };
}

function cloneDecodedRow(row: DecodedRow): DecodedRow {
  const bits = allocateBytes(row.blackBits.length, "CCITT damaged replacement row");
  bits.set(row.blackBits);
  return { blackBits: bits, transitions: row.transitions.slice() };
}

function appendDecodedRow(
  output: PackedRowWriter,
  row: DecodedRow,
  params: NormalizedParameters,
  limits: Readonly<NativeCcittLimits>
): void {
  const nextRows = checkedAdd(output.rowCount, 1, "CCITT decoded row count");
  if (nextRows > limits.maxRows) {
    throw resourceLimit("CCITT decoded row count exceeds the configured ceiling.", {
      rows: nextRows,
      limit: limits.maxRows
    });
  }
  enforceProspectiveOutput(params.columns, nextRows, params.rowStride, limits);
  output.append(row.blackBits);
}

function enforceNextDecodedRow(
  decodedRows: number,
  params: NormalizedParameters,
  limits: Readonly<NativeCcittLimits>
): void {
  const nextRows = checkedAdd(decodedRows, 1, "CCITT decoded row count");
  if (nextRows > limits.maxRows) {
    throw resourceLimit("CCITT decoded row count exceeds the configured ceiling.", {
      rows: nextRows,
      limit: limits.maxRows
    });
  }
  enforceProspectiveOutput(params.columns, nextRows, params.rowStride, limits);
}

class MsbBitReader {
  private readonly bytes: Uint8Array;
  private readonly maxScanBits: number;
  private readonly signal?: AbortSignal;
  private bitOffset = 0;
  private scanCount = 0;

  constructor(bytes: Uint8Array, maxScanBits: number, signal?: AbortSignal) {
    this.bytes = bytes;
    this.maxScanBits = maxScanBits;
    this.signal = signal;
  }

  get position(): number {
    return this.bitOffset;
  }

  get byteOffset(): number {
    return Math.floor(this.bitOffset / 8);
  }

  get atEnd(): boolean {
    return this.bitOffset >= this.bytes.length * 8;
  }

  mark(): number {
    return this.bitOffset;
  }

  restore(position: number): void {
    if (!Number.isSafeInteger(position) || position < 0 || position > this.bytes.length * 8) {
      throw new RangeError("Invalid CCITT bit-reader checkpoint.");
    }
    this.bitOffset = position;
  }

  readOptional(): 0 | 1 | undefined {
    if (this.atEnd) return undefined;
    this.accountScan();
    const absolute = this.bitOffset++;
    return ((this.bytes[absolute >>> 3] >>> (7 - (absolute & 7))) & 1) as 0 | 1;
  }

  readRequired(message: string): 0 | 1 {
    const value = this.readOptional();
    if (value === undefined) throw malformed(this, message, "ccitt-truncated-code");
    return value;
  }

  tryConsumeExact(bits: string): boolean {
    const checkpoint = this.mark();
    for (let index = 0; index < bits.length; index += 1) {
      const bit = this.readOptional();
      if (bit === undefined || bit !== (bits.charCodeAt(index) - 48)) {
        this.restore(checkpoint);
        return false;
      }
    }
    return true;
  }

  tryConsumeEol(): boolean {
    const checkpoint = this.mark();
    let zeros = 0;
    while (true) {
      const bit = this.readOptional();
      if (bit === undefined) {
        this.restore(checkpoint);
        return false;
      }
      if (bit === 0) {
        zeros += 1;
        continue;
      }
      if (zeros >= 11) return true;
      this.restore(checkpoint);
      return false;
    }
  }

  searchForEol(): void {
    let zeros = 0;
    while (true) {
      const bit = this.readOptional();
      if (bit === undefined) {
        throw malformed(
          this,
          "Unable to resynchronize a damaged CCITT row before end of data.",
          "ccitt-resync-eof"
        );
      }
      if (bit === 0) zeros += 1;
      else {
        if (zeros >= 11) return;
        zeros = 0;
      }
    }
  }

  skipToByteBoundary(requireZero: boolean): void {
    while ((this.bitOffset & 7) !== 0) {
      const bit = this.readRequired("Truncated CCITT byte-alignment padding.");
      if (requireZero && bit !== 0) {
        throw malformed(
          this,
          "CCITT EncodedByteAlign padding contains a nonzero bit.",
          "ccitt-byte-align-padding"
        );
      }
    }
  }

  hasOnlyFinalZeroPadding(): boolean {
    const remaining = this.bytes.length * 8 - this.bitOffset;
    if (remaining === 0) return true;
    if (remaining > 7) return false;
    for (let relative = 0; relative < remaining; relative += 1) {
      const absolute = this.bitOffset + relative;
      if (((this.bytes[absolute >>> 3] >>> (7 - (absolute & 7))) & 1) !== 0) return false;
    }
    return true;
  }

  skipFinalZeroPadding(): void {
    while (!this.atEnd) {
      const bit = this.readRequired("Truncated CCITT final padding.");
      if (bit !== 0) throw new Error("CCITT final-padding precondition violated.");
    }
  }

  private accountScan(): void {
    this.scanCount += 1;
    if (this.scanCount > this.maxScanBits) {
      throw resourceLimit("CCITT bit scanning exceeds the configured ceiling.", {
        scannedBits: this.scanCount,
        limit: this.maxScanBits
      });
    }
    if ((this.scanCount & 0x0fff) === 0) throwIfAborted(this.signal);
  }
}

class TransitionBudget {
  private count = 0;
  private readonly limit: number;
  private readonly signal?: AbortSignal;

  constructor(limit: number, signal?: AbortSignal) {
    this.limit = limit;
    this.signal = signal;
  }

  consume(): void {
    this.count += 1;
    if (this.count > this.limit) {
      throw resourceLimit("CCITT transition work exceeds the configured ceiling.", {
        transitions: this.count,
        limit: this.limit
      });
    }
    if ((this.count & 0x0fff) === 0) throwIfAborted(this.signal);
  }

  checkCancellation(): void {
    throwIfAborted(this.signal);
  }
}

class PackedRowWriter {
  private buffer = new Uint8Array(0);
  private length = 0;
  private rows = 0;
  private readonly rowStride: number;
  private readonly limit: number;

  constructor(rowStride: number, limit: number) {
    this.rowStride = rowStride;
    this.limit = limit;
  }

  get rowCount(): number {
    return this.rows;
  }

  append(row: Uint8Array): void {
    if (row.length !== this.rowStride) throw new Error("CCITT row-stride invariant violated.");
    const required = checkedAdd(this.length, row.length, "CCITT output length");
    if (required > this.limit) {
      throw resourceLimit("CCITT decoded output exceeds the configured byte ceiling.", {
        decodedBytes: required,
        limit: this.limit
      });
    }
    this.ensureCapacity(required);
    this.buffer.set(row, this.length);
    this.length = required;
    this.rows += 1;
  }

  finish(blackIs1: boolean, columns: number, signal?: AbortSignal): Uint8Array {
    throwIfAborted(signal);
    const output = allocateBytes(this.length, "CCITT decoded output");
    const meaningfulMask = columns % 8 === 0 ? 0xff : (0xff << (8 - (columns % 8))) & 0xff;
    for (let row = 0; row < this.rows; row += 1) {
      const offset = row * this.rowStride;
      for (let byte = 0; byte < this.rowStride; byte += 1) {
        if ((byte & 0x0fff) === 0) throwIfAborted(signal);
        const source = this.buffer[offset + byte];
        output[offset + byte] = blackIs1 ? source : source ^ 0xff;
      }
      output[offset + this.rowStride - 1] &= meaningfulMask;
    }
    throwIfAborted(signal);
    return output;
  }

  private ensureCapacity(required: number): void {
    if (required <= this.buffer.length) return;
    let capacity = this.buffer.length === 0 ? Math.min(1024, this.limit) : this.buffer.length;
    while (capacity < required) {
      capacity = Math.min(this.limit, Math.max(required, checkedMultiply(capacity, 2, "CCITT buffer")));
    }
    const replacement = allocateBytes(capacity, "CCITT output buffer");
    replacement.set(this.buffer.subarray(0, this.length));
    this.buffer = replacement;
  }
}

function buildRunTrie(
  label: string,
  terminating: readonly string[],
  makeup: readonly RunCode[]
): CodeNode<number> {
  if (terminating.length !== 64) throw new Error(`Invalid ${label} terminating-code table.`);
  const entries: Array<readonly [string, number]> = terminating.map((bits, run) => [bits, run]);
  for (const [run, bits] of makeup) entries.push([bits, run]);
  for (const [run, bits] of SHARED_MAKEUP) entries.push([bits, run]);
  // T.4 reserves 000000001xxx for one-dimensional extension modes.
  entries.push(["000000001", RUN_EXTENSION]);
  return buildCodeTrie(label, entries);
}

function buildCodeTrie<T>(
  label: string,
  entries: readonly (readonly [bits: string, value: T])[]
): CodeNode<T> {
  const root: CodeNode<T> = {};
  for (const [bits, value] of entries) {
    if (!/^[01]+$/.test(bits)) throw new Error(`Invalid ${label} Huffman code.`);
    let node = root;
    for (let index = 0; index < bits.length; index += 1) {
      if (node.value !== undefined) throw new Error(`Prefix collision in ${label} Huffman table.`);
      const key = bits[index] === "0" ? "zero" : "one";
      node = node[key] ??= {};
    }
    if (node.value !== undefined || node.zero || node.one) {
      throw new Error(`Duplicate or oversubscribed ${label} Huffman table.`);
    }
    node.value = value;
  }
  return root;
}

function mergeLimits(overrides?: Partial<NativeCcittLimits>): Readonly<NativeCcittLimits> {
  if (overrides === undefined) return DEFAULT_LIMITS;
  if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new RangeError("CCITT limits must be an object.");
  }
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`CCITT limit ${name} must be a positive safe integer.`);
    }
  }
  return limits;
}

function integerParameter(
  value: number | undefined,
  fallback: number,
  name: string,
  allowZero: boolean
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (!allowZero && value === 0)) {
    throw invalidParameter(name, "must be a safe integer");
  }
  return value;
}

function booleanParameter(
  value: boolean | undefined,
  fallback: boolean,
  name: string
): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw invalidParameter(name, "must be boolean");
  return value;
}

function enforceProspectiveOutput(
  columns: number,
  rows: number,
  rowStride: number,
  limits: Readonly<NativeCcittLimits>
): void {
  const pixels = checkedMultiply(columns, rows, "CCITT pixel count");
  if (pixels > limits.maxPixels) {
    throw resourceLimit("CCITT pixel count exceeds the configured ceiling.", {
      pixels,
      limit: limits.maxPixels
    });
  }
  const bytes = checkedMultiply(rowStride, rows, "CCITT output length");
  if (bytes > limits.maxOutputBytes) {
    throw resourceLimit("CCITT decoded output exceeds the configured byte ceiling.", {
      decodedBytes: bytes,
      limit: limits.maxOutputBytes
    });
  }
}

function checkedAdd(left: number, right: number, label: string): number {
  if (!Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0) {
    throw resourceLimit(`${label} exceeds safe arithmetic.`, { left, right });
  }
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw resourceLimit(`${label} exceeds safe arithmetic.`, { left, right });
  }
  return result;
}

function checkedMultiply(left: number, right: number, label: string): number {
  if (!Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0) {
    throw resourceLimit(`${label} exceeds safe arithmetic.`, { left, right });
  }
  const result = left * right;
  if (!Number.isSafeInteger(result)) {
    throw resourceLimit(`${label} exceeds safe arithmetic.`, { left, right });
  }
  return result;
}

function allocateBytes(length: number, label: string): Uint8Array<ArrayBuffer> {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw resourceLimit(`Invalid ${label} allocation length.`, { length });
  }
  try {
    return new Uint8Array(length);
  } catch (cause) {
    throw new PdfError("resource-limit", `Unable to allocate ${label}.`, {
      cause,
      details: { reason: "ccitt-allocation", bytes: length }
    });
  }
}

function invalidParameter(name: string, message: string): PdfError {
  return new PdfError("invalid-object", `CCITTFaxDecode /${name} ${message}.`, {
    details: { reason: "ccitt-parameter", parameter: name }
  });
}

function malformed(
  reader: MsbBitReader,
  message: string,
  reason: string
): PdfError {
  return malformedAt(reader, reader.position, message, reason);
}

function malformedAt(
  reader: MsbBitReader,
  bitOffset: number,
  message: string,
  reason: string
): PdfError {
  return new PdfError("invalid-object", message, {
    offset: Math.floor(bitOffset / 8),
    details: { reason, bitOffset }
  });
}

function resourceLimit(
  message: string,
  details: Readonly<Record<string, string | number | boolean | null>>
): PdfError {
  return new PdfError("resource-limit", message, { details: { reason: "ccitt-limit", ...details } });
}

function isRecoverableRowError(value: unknown): value is PdfError {
  return value instanceof PdfError && value.code === "invalid-object";
}
