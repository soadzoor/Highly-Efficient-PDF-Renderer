import {
  scanDensePdfPreparedResourceReferences,
  type DensePdfContentSegment,
  type DensePdfResourceReferences
} from "./nativeContentCompiler";

const MAX_TOP_LEVEL_OPERANDS = 1_000_000;
const MAX_FAST_CONTAINER_DEPTH = 256;
const MAX_FAST_NUMBER_TOKEN_BYTES = 300;

type OperandKind = "none" | "name" | "number" | "dictionary" | "other";

export type FastPreparedResourceScanFallbackReason =
  | "cross-segment-token"
  | "inline-image-boundary"
  | "inline-image-operator"
  | "invalid-resource-operands"
  | "malformed-container"
  | "malformed-token"
  | "nesting-limit"
  | "numeric-token-limit"
  | "operand-limit";

export interface FastPreparedResourceScanStats {
  /** Specialized top-level FSM used when possible; otherwise the general scanner. */
  readonly scannerTier: "simple" | "general";
  /** Content bytes inspected. Prepared image payloads are deliberately excluded. */
  readonly contentBytes: number;
  readonly inlineImageCount: number;
  readonly tokenCount: number;
  readonly numericTokenCount: number;
  readonly nameTokenCount: number;
  readonly operatorTokenCount: number;
  /** Name decodes performed for resource-consuming operators. */
  readonly decodedNameCount: number;
  /** Always zero: numeric syntax is validated directly over bytes. */
  readonly numericValueConversions: 0;
  readonly maxOperandCount: number;
  /** Bounded operand metadata retained by the scanner; never exceeds three. */
  readonly maxRetainedOperandSlots: number;
  readonly fallbackReason: FastPreparedResourceScanFallbackReason | null;
}

export type FastPreparedResourceScanResult =
  | {
      readonly kind: "complete";
      readonly references: DensePdfResourceReferences;
      readonly stats: FastPreparedResourceScanStats;
    }
  | {
      readonly kind: "fallback";
      readonly reason: FastPreparedResourceScanFallbackReason;
      readonly stats: FastPreparedResourceScanStats;
    };

export interface PreparedResourceScanResolution {
  readonly references: DensePdfResourceReferences;
  readonly strategy: "fast" | "exact";
  readonly fastScan: FastPreparedResourceScanResult;
}

export interface FastPreparedResourceScanOptions {
  readonly signal?: AbortSignal;
}

interface ContainerFrame {
  readonly kind: "array" | "dictionary";
  /** Dictionaries alternate name keys and arbitrary values. */
  expectingKey: boolean;
}

/**
 * Scan replayable, prepared content without parsing or retaining path numbers.
 *
 * A `complete` result has the same resource-reference semantics as the exact
 * dense scanner. A `fallback` result is not partial and must not be consumed;
 * the caller should run the exact scanner over the same replayable segments.
 * Fully prepared callers represent inline image payloads with `image`
 * segments. A caller may also use this `try` API on raw decoded content as a
 * conservative proof: lexical BI/ID/EI operators return `fallback` before any
 * payload is interpreted, while `complete` proves inline preparation is not
 * needed. The fast-or-exact wrapper still requires prepared content because
 * its fallback invokes the exact prepared scanner.
 *
 * The fast scanner deliberately falls back when one lexical token crosses a
 * content-segment boundary. Native inline-image preparation normally creates
 * boundaries between complete tokens, while this rule keeps arbitrary caller
 * chunking correctness-conservative without copying chunks together.
 *
 * @internal
 */
export function tryScanFastPreparedResourceReferences(
  segments: readonly DensePdfContentSegment[],
  options: FastPreparedResourceScanOptions = {}
): FastPreparedResourceScanResult {
  if (!Array.isArray(segments)) {
    throw new TypeError("Fast prepared resource scanning requires a replayable segment array.");
  }
  options.signal?.throwIfAborted();
  const simple = tryScanSimplePreparedResourceReferences(segments, options.signal);
  if (simple) return simple;
  const scanner = new FastPreparedResourceScanner(options.signal);
  try {
    for (let index = 0; index < segments.length; index += 1) {
      options.signal?.throwIfAborted();
      const segment = segments[index];
      validatePreparedSegment(segment);
      if (segment.kind === "image") {
        scanner.consumeInlineImage();
        continue;
      }
      scanner.scan(segment.bytes, firstFollowingContentByte(segments, index, options.signal));
    }
    return scanner.complete();
  } catch (error) {
    if (!(error instanceof FastScanFallback)) throw error;
    return scanner.fallback(error.reason);
  }
}

/** Run the allocation-conscious scanner, then the existing exact scanner only when requested. */
export function scanPreparedResourceReferencesFastOrExact(
  segments: readonly DensePdfContentSegment[],
  options: FastPreparedResourceScanOptions = {}
): PreparedResourceScanResolution {
  const fastScan = tryScanFastPreparedResourceReferences(segments, options);
  if (fastScan.kind === "complete") {
    return Object.freeze({
      references: fastScan.references,
      strategy: "fast" as const,
      fastScan
    });
  }
  options.signal?.throwIfAborted();
  return Object.freeze({
    references: scanDensePdfPreparedResourceReferences(segments, {
      signal: options.signal
    }),
    strategy: "exact" as const,
    fastScan
  });
}

const SIMPLE_OPERAND_NONE = 0;
const SIMPLE_OPERAND_NAME = 1;
const SIMPLE_OPERAND_NUMBER = 2;
const SIMPLE_OPERAND_OTHER = 3;

/**
 * Allocation-free hot path for the common single-stream technical-page
 * grammar. It accepts only top-level numbers, names, hex strings, booleans,
 * nulls, and operators. Any structural or malformed ambiguity returns null so
 * the general fast scanner remains the sole fallback authority.
 */
function tryScanSimplePreparedResourceReferences(
  segments: readonly DensePdfContentSegment[],
  signal?: AbortSignal
): FastPreparedResourceScanResult | null {
  if (segments.length !== 1) return null;
  const segment = segments[0];
  validatePreparedSegment(segment);
  if (segment.kind !== "content") return null;

  const bytes = segment.bytes;
  const xObjects = new Set<string>();
  const properties = new Set<string>();
  const optionalContentProperties = new Set<string>();
  const fonts = new Set<string>();
  const extGStates = new Set<string>();
  const colorSpaces = new Set<string>();
  const shadings = new Set<string>();
  const patterns = new Set<string>();

  let operandCount = 0;
  let firstKind: number = SIMPLE_OPERAND_NONE;
  let firstNameStart = 0;
  let firstNameEnd = 0;
  let secondKind: number = SIMPLE_OPERAND_NONE;
  let secondNameStart = 0;
  let secondNameEnd = 0;
  let lastKind: number = SIMPLE_OPERAND_NONE;
  let lastNameStart = 0;
  let lastNameEnd = 0;

  let tokenCount = 0;
  let numericTokenCount = 0;
  let nameTokenCount = 0;
  let operatorTokenCount = 0;
  let decodedNameCount = 0;
  let maxOperandCount = 0;
  let maxRetainedOperandSlots = 0;

  const appendNonNumeric = (
    kind: typeof SIMPLE_OPERAND_NAME | typeof SIMPLE_OPERAND_OTHER,
    nameStart = 0,
    nameEnd = 0
  ): boolean => {
    if (operandCount >= MAX_TOP_LEVEL_OPERANDS) return false;
    if (operandCount === 0) {
      firstKind = kind;
      firstNameStart = nameStart;
      firstNameEnd = nameEnd;
    } else if (operandCount === 1) {
      secondKind = kind;
      secondNameStart = nameStart;
      secondNameEnd = nameEnd;
    }
    operandCount += 1;
    lastKind = kind;
    lastNameStart = nameStart;
    lastNameEnd = nameEnd;
    maxOperandCount = Math.max(maxOperandCount, operandCount);
    maxRetainedOperandSlots = Math.max(maxRetainedOperandSlots, Math.min(operandCount, 3));
    return true;
  };
  const clearOperands = (): void => {
    operandCount = 0;
    firstKind = SIMPLE_OPERAND_NONE;
    secondKind = SIMPLE_OPERAND_NONE;
    lastKind = SIMPLE_OPERAND_NONE;
  };
  const decodeName = (start: number, end: number): string => {
    decodedNameCount += 1;
    return decodePdfName(bytes, start, end, signal);
  };

  let offset = 0;
  let nextAbortCheckOffset = 0;
  while (offset < bytes.length) {
    if (offset >= nextAbortCheckOffset) {
      signal?.throwIfAborted();
      nextAbortCheckOffset = offset + 0x10000;
    }
    const byte = bytes[offset];
    if (isPdfWhitespace(byte)) {
      offset += 1;
      continue;
    }

    if (byte === 0x2f) { // name
      const start = offset + 1;
      const end = findRegularTokenEnd(bytes, start, signal);
      for (let nameOffset = start; nameOffset < end; nameOffset += 1) {
        if (bytes[nameOffset] !== 0x23) continue;
        if (
          nameOffset + 2 >= end ||
          hexNibble(bytes[nameOffset + 1]) < 0 ||
          hexNibble(bytes[nameOffset + 2]) < 0
        ) return null;
        nameOffset += 2;
      }
      tokenCount += 1;
      nameTokenCount += 1;
      if (!appendNonNumeric(SIMPLE_OPERAND_NAME, start, end)) return null;
      offset = end;
      continue;
    }

    if (byte === 0x3c) { // top-level hex string; dictionaries use the general scanner
      if (offset + 1 >= bytes.length || bytes[offset + 1] === 0x3c) return null;
      let end = offset + 1;
      for (; end < bytes.length && bytes[end] !== 0x3e; end += 1) {
        if (((end - offset) & 0xffff) === 0) signal?.throwIfAborted();
        if (!isPdfWhitespace(bytes[end]) && hexNibble(bytes[end]) < 0) return null;
      }
      if (end >= bytes.length) return null;
      tokenCount += 1;
      if (!appendNonNumeric(SIMPLE_OPERAND_OTHER)) return null;
      offset = end + 1;
      continue;
    }

    // Arrays, dictionaries, literal strings, comments, and unmatched
    // delimiters are uncommon in dense path streams and stay on the exact
    // general path rather than growing this FSM's proof surface.
    if (isPdfDelimiter(byte)) return null;

    if (isPdfNumberStartByte(byte)) {
      let end = offset;
      if (bytes[end] === 0x2b || bytes[end] === 0x2d) end += 1;
      let sawDigit = false;
      let sawDot = false;
      let malformed = false;
      while (end < bytes.length) {
        if (((end - offset) & 0xffff) === 0) signal?.throwIfAborted();
        const tokenByte = bytes[end];
        if (tokenByte >= 0x30 && tokenByte <= 0x39) {
          sawDigit = true;
          end += 1;
          continue;
        }
        if (tokenByte === 0x2e && !sawDot) {
          sawDot = true;
          end += 1;
          continue;
        }
        if (isRegularByte(tokenByte)) {
          malformed = true;
          end += 1;
          continue;
        }
        break;
      }
      if (
        end - offset > MAX_FAST_NUMBER_TOKEN_BYTES ||
        malformed ||
        !sawDigit ||
        operandCount >= MAX_TOP_LEVEL_OPERANDS
      ) return null;
      tokenCount += 1;
      numericTokenCount += 1;
      if (operandCount === 0) firstKind = SIMPLE_OPERAND_NUMBER;
      else if (operandCount === 1) secondKind = SIMPLE_OPERAND_NUMBER;
      operandCount += 1;
      lastKind = SIMPLE_OPERAND_NUMBER;
      maxOperandCount = Math.max(maxOperandCount, operandCount);
      maxRetainedOperandSlots = Math.max(maxRetainedOperandSlots, Math.min(operandCount, 3));
      offset = end;
      continue;
    }

    const end = findRegularTokenEnd(bytes, offset, signal);
    if (end === offset) return null;
    tokenCount += 1;
    if (
      matchesAscii(bytes, offset, end, "true") ||
      matchesAscii(bytes, offset, end, "false") ||
      matchesAscii(bytes, offset, end, "null")
    ) {
      if (!appendNonNumeric(SIMPLE_OPERAND_OTHER)) return null;
      offset = end;
      continue;
    }

    operatorTokenCount += 1;
    const length = end - offset;
    if (length === 1) {
      const operator = bytes[offset];
      if (operator === 0x47 || operator === 0x67) colorSpaces.add("DeviceGray");
      else if (operator === 0x4b || operator === 0x6b) colorSpaces.add("DeviceCMYK");
    } else if (length === 2) {
      const operator = (bytes[offset] << 8) | bytes[offset + 1];
      if (operator === 0x4249 || operator === 0x4944 || operator === 0x4549) return null;
      if (operator === 0x446f) { // Do
        if (operandCount !== 1 || firstKind !== SIMPLE_OPERAND_NAME) return null;
        xObjects.add(decodeName(firstNameStart, firstNameEnd));
      } else if (operator === 0x5466) { // Tf
        if (
          operandCount !== 2 ||
          firstKind !== SIMPLE_OPERAND_NAME ||
          secondKind !== SIMPLE_OPERAND_NUMBER
        ) return null;
        fonts.add(decodeName(firstNameStart, firstNameEnd));
      } else if (operator === 0x6773) { // gs
        if (operandCount !== 1 || firstKind !== SIMPLE_OPERAND_NAME) return null;
        extGStates.add(decodeName(firstNameStart, firstNameEnd));
      } else if (operator === 0x5247 || operator === 0x7267) { // RG, rg
        colorSpaces.add("DeviceRGB");
      } else if (operator === 0x4353 || operator === 0x6373) { // CS, cs
        if (operandCount !== 1 || firstKind !== SIMPLE_OPERAND_NAME) return null;
        colorSpaces.add(decodeName(firstNameStart, firstNameEnd));
      } else if (operator === 0x7368) { // sh
        if (operandCount !== 1 || firstKind !== SIMPLE_OPERAND_NAME) return null;
        shadings.add(decodeName(firstNameStart, firstNameEnd));
      } else if (operator === 0x4450) { // DP
        if (
          operandCount !== 2 ||
          firstKind !== SIMPLE_OPERAND_NAME ||
          secondKind !== SIMPLE_OPERAND_NAME
        ) return null;
        const tag = decodeName(firstNameStart, firstNameEnd);
        const property = decodeName(secondNameStart, secondNameEnd);
        properties.add(property);
        if (tag === "OC") optionalContentProperties.add(property);
      }
    } else if (length === 3) {
      const operator = (bytes[offset] << 16) |
        (bytes[offset + 1] << 8) |
        bytes[offset + 2];
      if (operator === 0x53434e || operator === 0x73636e) { // SCN, scn
        if (lastKind === SIMPLE_OPERAND_NAME) {
          patterns.add(decodeName(lastNameStart, lastNameEnd));
        }
      } else if (operator === 0x424443) { // BDC
        if (
          operandCount !== 2 ||
          firstKind !== SIMPLE_OPERAND_NAME ||
          secondKind !== SIMPLE_OPERAND_NAME
        ) return null;
        const tag = decodeName(firstNameStart, firstNameEnd);
        const property = decodeName(secondNameStart, secondNameEnd);
        properties.add(property);
        if (tag === "OC") optionalContentProperties.add(property);
      }
    }
    clearOperands();
    offset = end;
  }

  signal?.throwIfAborted();
  if (operandCount !== 0) return null;
  return Object.freeze({
    kind: "complete" as const,
    references: freezeReferenceSets([
      xObjects,
      properties,
      optionalContentProperties,
      fonts,
      extGStates,
      colorSpaces,
      shadings,
      patterns
    ]),
    stats: Object.freeze({
      scannerTier: "simple" as const,
      contentBytes: bytes.length,
      inlineImageCount: 0,
      tokenCount,
      numericTokenCount,
      nameTokenCount,
      operatorTokenCount,
      decodedNameCount,
      numericValueConversions: 0 as const,
      maxOperandCount,
      maxRetainedOperandSlots,
      fallbackReason: null
    })
  });
}

class FastPreparedResourceScanner {
  private readonly signal: AbortSignal | undefined;

  private readonly xObjects = new Set<string>();

  private readonly properties = new Set<string>();

  private readonly optionalContentProperties = new Set<string>();

  private readonly fonts = new Set<string>();

  private readonly extGStates = new Set<string>();

  private readonly colorSpaces = new Set<string>();

  private readonly shadings = new Set<string>();

  private readonly patterns = new Set<string>();

  private readonly containers: ContainerFrame[] = [];

  private operandCount = 0;

  private firstKind: OperandKind = "none";

  private firstNameBytes: Uint8Array | null = null;

  private firstNameStart = 0;

  private firstNameEnd = 0;

  private secondKind: OperandKind = "none";

  private secondNameBytes: Uint8Array | null = null;

  private secondNameStart = 0;

  private secondNameEnd = 0;

  private lastKind: OperandKind = "none";

  private lastNameBytes: Uint8Array | null = null;

  private lastNameStart = 0;

  private lastNameEnd = 0;

  private contentBytes = 0;

  private inlineImageCount = 0;

  private tokenCount = 0;

  private numericTokenCount = 0;

  private nameTokenCount = 0;

  private operatorTokenCount = 0;

  private decodedNameCount = 0;

  private maxOperandCount = 0;

  private maxRetainedOperandSlots = 0;

  constructor(signal?: AbortSignal) {
    this.signal = signal;
  }

  scan(bytes: Uint8Array, followingByte: number | null): void {
    this.contentBytes += bytes.length;
    let offset = 0;
    let nextAbortCheckOffset = 0;
    while (offset < bytes.length) {
      if (offset >= nextAbortCheckOffset) {
        this.signal?.throwIfAborted();
        nextAbortCheckOffset = offset + 0x10000;
      }
      const byte = bytes[offset];
      if (isPdfWhitespace(byte)) {
        offset += 1;
        continue;
      }
      if (byte === 0x25) {
        const end = findLineEnd(bytes, offset + 1, this.signal);
        if (end < 0) {
          if (followingByte !== null) this.fail("cross-segment-token");
          return;
        }
        offset = end;
        continue;
      }

      if (byte === 0x5b) {
        this.tokenCount += 1;
        this.pushContainer("array");
        offset += 1;
        continue;
      }
      if (byte === 0x5d) {
        this.tokenCount += 1;
        this.closeContainer("array");
        offset += 1;
        continue;
      }
      if (byte === 0x3c) {
        if (offset + 1 >= bytes.length) {
          if (followingByte !== null) this.fail("cross-segment-token");
          this.fail("malformed-token");
        }
        if (bytes[offset + 1] === 0x3c) {
          this.tokenCount += 1;
          this.pushContainer("dictionary");
          offset += 2;
          continue;
        }
        const end = scanHexString(bytes, offset + 1, this.signal);
        if (end < 0) {
          if (followingByte !== null) this.fail("cross-segment-token");
          this.fail("malformed-token");
        }
        this.tokenCount += 1;
        this.appendValue("other");
        offset = end;
        continue;
      }
      if (byte === 0x3e) {
        if (offset + 1 >= bytes.length) {
          if (followingByte !== null) this.fail("cross-segment-token");
          this.fail("malformed-token");
        }
        if (bytes[offset + 1] !== 0x3e) this.fail("malformed-token");
        this.tokenCount += 1;
        this.closeContainer("dictionary");
        offset += 2;
        continue;
      }
      if (byte === 0x28) {
        const end = scanLiteralString(bytes, offset + 1, this.signal);
        if (end < 0) {
          if (followingByte !== null) this.fail("cross-segment-token");
          this.fail("malformed-token");
        }
        this.tokenCount += 1;
        this.appendValue("other");
        offset = end;
        continue;
      }
      if (byte === 0x29 || byte === 0x7b || byte === 0x7d) {
        this.fail("malformed-token");
      }
      if (byte === 0x2f) {
        const start = offset + 1;
        const end = findRegularTokenEnd(bytes, start, this.signal);
        if (end === bytes.length && followingByte !== null && isRegularByte(followingByte)) {
          this.fail("cross-segment-token");
        }
        validatePdfName(bytes, start, end, this.signal);
        this.tokenCount += 1;
        this.nameTokenCount += 1;
        this.appendValue("name", bytes, start, end);
        offset = end;
        continue;
      }

      const numericCandidate = isPdfNumberStartByte(byte);
      let numericSawDigit = false;
      let numericSawDot = false;
      let numericMalformed = false;
      let end: number;
      if (numericCandidate) {
        // Numeric operands dominate dense technical PDFs. Validate their
        // grammar while locating the token boundary so those bytes are not
        // traversed a second time by a separate validation pass.
        end = offset;
        while (end < bytes.length && isRegularByte(bytes[end])) {
          if (((end - offset) & 0xffff) === 0) this.signal?.throwIfAborted();
          const tokenByte = bytes[end];
          if (tokenByte >= 0x30 && tokenByte <= 0x39) {
            numericSawDigit = true;
          } else if (tokenByte === 0x2e && !numericSawDot) {
            numericSawDot = true;
          } else if (
            end !== offset ||
            (tokenByte !== 0x2b && tokenByte !== 0x2d)
          ) {
            numericMalformed = true;
          }
          end += 1;
        }
      } else {
        end = findRegularTokenEnd(bytes, offset, this.signal);
      }
      if (end === offset) this.fail("malformed-token");
      if (end === bytes.length && followingByte !== null && isRegularByte(followingByte)) {
        this.fail("cross-segment-token");
      }
      this.tokenCount += 1;
      if (numericCandidate) {
        if (end - offset > MAX_FAST_NUMBER_TOKEN_BYTES) this.fail("numeric-token-limit");
        if (numericMalformed || !numericSawDigit) this.fail("malformed-token");
        this.numericTokenCount += 1;
        this.appendValue("number");
      } else if (
        matchesAscii(bytes, offset, end, "true") ||
        matchesAscii(bytes, offset, end, "false") ||
        matchesAscii(bytes, offset, end, "null")
      ) {
        this.appendValue("other");
      } else {
        if (this.containers.length > 0) this.fail("malformed-container");
        this.operatorTokenCount += 1;
        this.consumeOperator(bytes, offset, end);
      }
      offset = end;
    }
  }

  consumeInlineImage(): void {
    this.inlineImageCount += 1;
    if (this.containers.length > 0 || this.operandCount > 0) {
      this.fail("inline-image-boundary");
    }
  }

  complete(): FastPreparedResourceScanResult {
    this.signal?.throwIfAborted();
    if (this.containers.length > 0) this.fail("malformed-container");
    if (this.operandCount > 0) this.fail("invalid-resource-operands");
    return Object.freeze({
      kind: "complete" as const,
      references: freezeReferences(this),
      stats: this.stats(null)
    });
  }

  fallback(reason: FastPreparedResourceScanFallbackReason): FastPreparedResourceScanResult {
    return Object.freeze({
      kind: "fallback" as const,
      reason,
      stats: this.stats(reason)
    });
  }

  referenceSets(): readonly ReadonlySet<string>[] {
    return [
      this.xObjects,
      this.properties,
      this.optionalContentProperties,
      this.fonts,
      this.extGStates,
      this.colorSpaces,
      this.shadings,
      this.patterns
    ];
  }

  private consumeOperator(bytes: Uint8Array, start: number, end: number): void {
    const length = end - start;
    if (length === 1) {
      const operator = bytes[start];
      if (operator === 0x47 || operator === 0x67) {
        this.colorSpaces.add("DeviceGray");
      } else if (operator === 0x4b || operator === 0x6b) {
        this.colorSpaces.add("DeviceCMYK");
      }
    } else if (length === 2) {
      const operator = (bytes[start] << 8) | bytes[start + 1];
      if (operator === 0x4249 || operator === 0x4944 || operator === 0x4549) {
        // Prepared inline images are represented by image segments, never raw
        // BI/ID/EI operators. This fallback also lets callers scan decoded
        // content first: a complete result then proves inline preparation can
        // be skipped without a separate byte probe.
        this.fail("inline-image-operator");
      }
      switch (operator) {
        case 0x446f: // Do
          this.xObjects.add(this.requireNameOperand(0, 1));
          break;
        case 0x5466: // Tf
          this.fonts.add(this.requireNameOperand(0, 2));
          if (this.secondKind !== "number") this.fail("invalid-resource-operands");
          break;
        case 0x6773: // gs
          this.extGStates.add(this.requireNameOperand(0, 1));
          break;
        case 0x5247: // RG
        case 0x7267: // rg
          this.colorSpaces.add("DeviceRGB");
          break;
        case 0x4353: // CS
        case 0x6373: // cs
          this.colorSpaces.add(this.requireNameOperand(0, 1));
          break;
        case 0x7368: // sh
          this.shadings.add(this.requireNameOperand(0, 1));
          break;
        case 0x4450: // DP
          this.consumeMarkedContentProperty();
          break;
      }
    } else if (length === 3) {
      const operator = (bytes[start] << 16) | (bytes[start + 1] << 8) | bytes[start + 2];
      if (operator === 0x53434e || operator === 0x73636e) { // SCN, scn
        if (this.lastKind === "name") this.patterns.add(this.decodeLastName());
      } else if (operator === 0x424443) { // BDC
        this.consumeMarkedContentProperty();
      }
    }
    this.clearOperands();
  }

  private consumeMarkedContentProperty(): void {
    if (this.operandCount !== 2 || this.firstKind !== "name") {
      this.fail("invalid-resource-operands");
    }
    const tag = this.decodeFirstName();
    if (this.secondKind === "name") {
      const property = this.decodeSecondName();
      this.properties.add(property);
      if (tag === "OC") this.optionalContentProperties.add(property);
    } else if (this.secondKind !== "dictionary") {
      this.fail("invalid-resource-operands");
    }
  }

  private appendValue(
    kind: OperandKind,
    nameBytes: Uint8Array | null = null,
    nameStart = 0,
    nameEnd = 0
  ): void {
    const container = this.containers.at(-1);
    if (container) {
      if (container.kind === "dictionary") {
        if (container.expectingKey) {
          if (kind !== "name") this.fail("malformed-container");
          container.expectingKey = false;
        } else {
          container.expectingKey = true;
        }
      }
      return;
    }
    if (this.operandCount >= MAX_TOP_LEVEL_OPERANDS) this.fail("operand-limit");
    const index = this.operandCount++;
    this.maxOperandCount = Math.max(this.maxOperandCount, this.operandCount);
    this.maxRetainedOperandSlots = Math.max(
      this.maxRetainedOperandSlots,
      Math.min(this.operandCount, 3)
    );
    if (index === 0) {
      this.firstKind = kind;
      this.firstNameBytes = nameBytes;
      this.firstNameStart = nameStart;
      this.firstNameEnd = nameEnd;
    } else if (index === 1) {
      this.secondKind = kind;
      this.secondNameBytes = nameBytes;
      this.secondNameStart = nameStart;
      this.secondNameEnd = nameEnd;
    }
    this.lastKind = kind;
    this.lastNameBytes = nameBytes;
    this.lastNameStart = nameStart;
    this.lastNameEnd = nameEnd;
  }

  private pushContainer(kind: ContainerFrame["kind"]): void {
    if (this.containers.length >= MAX_FAST_CONTAINER_DEPTH) this.fail("nesting-limit");
    this.containers.push({ kind, expectingKey: kind === "dictionary" });
  }

  private closeContainer(kind: ContainerFrame["kind"]): void {
    const container = this.containers.pop();
    if (!container || container.kind !== kind) this.fail("malformed-container");
    if (container.kind === "dictionary" && !container.expectingKey) {
      this.fail("malformed-container");
    }
    this.appendValue(kind === "dictionary" ? "dictionary" : "other");
  }

  private requireNameOperand(index: 0 | 1, count: number): string {
    if (this.operandCount !== count) this.fail("invalid-resource-operands");
    if (index === 0 && this.firstKind === "name") return this.decodeFirstName();
    if (index === 1 && this.secondKind === "name") return this.decodeSecondName();
    this.fail("invalid-resource-operands");
  }

  private decodeFirstName(): string {
    if (!this.firstNameBytes) this.fail("invalid-resource-operands");
    this.decodedNameCount += 1;
    return decodePdfName(
      this.firstNameBytes,
      this.firstNameStart,
      this.firstNameEnd,
      this.signal
    );
  }

  private decodeSecondName(): string {
    if (!this.secondNameBytes) this.fail("invalid-resource-operands");
    this.decodedNameCount += 1;
    return decodePdfName(
      this.secondNameBytes,
      this.secondNameStart,
      this.secondNameEnd,
      this.signal
    );
  }

  private decodeLastName(): string {
    if (!this.lastNameBytes) this.fail("invalid-resource-operands");
    this.decodedNameCount += 1;
    return decodePdfName(
      this.lastNameBytes,
      this.lastNameStart,
      this.lastNameEnd,
      this.signal
    );
  }

  private clearOperands(): void {
    this.operandCount = 0;
    this.firstKind = "none";
    this.firstNameBytes = null;
    this.secondKind = "none";
    this.secondNameBytes = null;
    this.lastKind = "none";
    this.lastNameBytes = null;
  }

  private stats(
    fallbackReason: FastPreparedResourceScanFallbackReason | null
  ): FastPreparedResourceScanStats {
    return Object.freeze({
      scannerTier: "general" as const,
      contentBytes: this.contentBytes,
      inlineImageCount: this.inlineImageCount,
      tokenCount: this.tokenCount,
      numericTokenCount: this.numericTokenCount,
      nameTokenCount: this.nameTokenCount,
      operatorTokenCount: this.operatorTokenCount,
      decodedNameCount: this.decodedNameCount,
      numericValueConversions: 0 as const,
      maxOperandCount: this.maxOperandCount,
      maxRetainedOperandSlots: this.maxRetainedOperandSlots,
      fallbackReason
    });
  }

  private fail(reason: FastPreparedResourceScanFallbackReason): never {
    throw new FastScanFallback(reason);
  }
}

class FastScanFallback extends Error {
  readonly reason: FastPreparedResourceScanFallbackReason;

  constructor(reason: FastPreparedResourceScanFallbackReason) {
    super(reason);
    this.reason = reason;
  }
}

function freezeReferences(scanner: FastPreparedResourceScanner): DensePdfResourceReferences {
  return freezeReferenceSets(scanner.referenceSets());
}

function freezeReferenceSets(
  sets: readonly ReadonlySet<string>[]
): DensePdfResourceReferences {
  const [
    xObjects, properties, optionalContentProperties, fonts,
    extGStates, colorSpaces, shadings, patterns
  ] = sets;
  return Object.freeze({
    xObjects: Object.freeze([...xObjects]),
    properties: Object.freeze([...properties]),
    optionalContentProperties: Object.freeze([...optionalContentProperties]),
    fonts: Object.freeze([...fonts]),
    extGStates: Object.freeze([...extGStates]),
    colorSpaces: Object.freeze([...colorSpaces]),
    shadings: Object.freeze([...shadings]),
    patterns: Object.freeze([...patterns])
  });
}

function firstFollowingContentByte(
  segments: readonly DensePdfContentSegment[],
  index: number,
  signal?: AbortSignal
): number | null {
  for (let next = index + 1; next < segments.length; next += 1) {
    if (((next - index) & 0xfff) === 0) signal?.throwIfAborted();
    const segment = segments[next];
    if (segment.kind === "image") return null;
    if (segment.bytes.length > 0) return segment.bytes[0];
  }
  return null;
}

function validatePreparedSegment(segment: DensePdfContentSegment): void {
  if (!segment || (segment.kind !== "content" && segment.kind !== "image")) {
    throw new TypeError("Dense PDF content sources yielded an invalid segment.");
  }
  if (
    !Number.isSafeInteger(segment.sourceOffset) || segment.sourceOffset < 0 ||
    !Number.isSafeInteger(segment.sourceLength) || segment.sourceLength < 0 ||
    !Number.isSafeInteger(segment.sourceOffset + segment.sourceLength)
  ) {
    throw new TypeError("Dense PDF content segment source metadata is invalid.");
  }
  if (segment.kind === "content") {
    if (!(segment.bytes instanceof Uint8Array) || segment.bytes.length !== segment.sourceLength) {
      throw new TypeError("Dense PDF content spans must contain their exact source bytes.");
    }
  } else if (
    !Number.isSafeInteger(segment.imageIndex) || segment.imageIndex < 0 ||
    segment.imageIndex > 0xffff_ffff || segment.sourceLength <= 0
  ) {
    throw new TypeError("Dense PDF inline-image segment has an invalid image index or span.");
  }
}

function scanLiteralString(bytes: Uint8Array, start: number, signal?: AbortSignal): number {
  let depth = 1;
  for (let offset = start; offset < bytes.length;) {
    if (((offset - start) & 0xffff) === 0) signal?.throwIfAborted();
    const byte = bytes[offset++];
    if (byte === 0x28) {
      depth += 1;
    } else if (byte === 0x29) {
      depth -= 1;
      if (depth === 0) return offset;
    } else if (byte === 0x5c) {
      if (offset >= bytes.length) return -1;
      if (bytes[offset++] === 0x0d && offset < bytes.length && bytes[offset] === 0x0a) {
        offset += 1;
      }
    }
  }
  return -1;
}

function scanHexString(bytes: Uint8Array, start: number, signal?: AbortSignal): number {
  for (let offset = start; offset < bytes.length; offset += 1) {
    if (((offset - start) & 0xffff) === 0) signal?.throwIfAborted();
    const byte = bytes[offset];
    if (byte === 0x3e) return offset + 1;
    if (!isPdfWhitespace(byte) && hexNibble(byte) < 0) {
      throw new FastScanFallback("malformed-token");
    }
  }
  return -1;
}

function validatePdfName(
  bytes: Uint8Array,
  start: number,
  end: number,
  signal?: AbortSignal
): void {
  for (let offset = start; offset < end; offset += 1) {
    if (((offset - start) & 0xffff) === 0) signal?.throwIfAborted();
    if (bytes[offset] !== 0x23) continue;
    if (
      offset + 2 >= end ||
      hexNibble(bytes[offset + 1]) < 0 ||
      hexNibble(bytes[offset + 2]) < 0
    ) {
      throw new FastScanFallback("malformed-token");
    }
    offset += 2;
  }
}

function decodePdfName(
  bytes: Uint8Array,
  start: number,
  end: number,
  signal?: AbortSignal
): string {
  let output = "";
  for (let offset = start; offset < end; offset += 1) {
    if (((offset - start) & 0xffff) === 0) signal?.throwIfAborted();
    let byte = bytes[offset];
    if (byte === 0x23) {
      byte = (hexNibble(bytes[offset + 1]) << 4) | hexNibble(bytes[offset + 2]);
      offset += 2;
    }
    output += String.fromCharCode(byte);
  }
  return output;
}

function isPdfNumberStartByte(byte: number): boolean {
  return (byte >= 0x30 && byte <= 0x39) ||
    byte === 0x2b || byte === 0x2d || byte === 0x2e;
}

function matchesAscii(
  bytes: Uint8Array,
  start: number,
  end: number,
  expected: string
): boolean {
  if (end - start !== expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[start + index] !== expected.charCodeAt(index)) return false;
  }
  return true;
}

function findRegularTokenEnd(bytes: Uint8Array, start: number, signal?: AbortSignal): number {
  let offset = start;
  while (offset < bytes.length && isRegularByte(bytes[offset])) {
    if (((offset - start) & 0xffff) === 0) signal?.throwIfAborted();
    offset += 1;
  }
  return offset;
}

function findLineEnd(bytes: Uint8Array, start: number, signal?: AbortSignal): number {
  for (let offset = start; offset < bytes.length; offset += 1) {
    if (((offset - start) & 0xffff) === 0) signal?.throwIfAborted();
    if (bytes[offset] === 0x0a) return offset + 1;
    if (bytes[offset] === 0x0d) {
      return offset + 1 < bytes.length && bytes[offset + 1] === 0x0a
        ? offset + 2
        : offset + 1;
    }
  }
  return -1;
}

function isRegularByte(byte: number): boolean {
  return !isPdfWhitespace(byte) && !isPdfDelimiter(byte);
}

function isPdfWhitespace(byte: number): boolean {
  return byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
}

function isPdfDelimiter(byte: number): boolean {
  return byte === 0x28 || byte === 0x29 || byte === 0x3c || byte === 0x3e ||
    byte === 0x5b || byte === 0x5d || byte === 0x7b || byte === 0x7d ||
    byte === 0x2f || byte === 0x25;
}

function hexNibble(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return -1;
}
