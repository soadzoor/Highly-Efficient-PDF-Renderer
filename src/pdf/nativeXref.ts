import {
  PdfCosParser,
  PdfNeedMoreDataError,
  isPdfDictionary,
  isPdfName,
  isPdfRef,
  isPdfStream,
  type PdfDictionary,
  type PdfStream,
  type PdfValue
} from "./nativeCos";
import { decodePdfFilterChain, readDecodeParameters, readFilterNames } from "./nativeFilters";
import { readIndirectObjectAt } from "./nativeObjects";
import type { PdfRandomAccessReader } from "./nativeSource";
import {
  PdfError,
  type PdfDiagnostic,
  type PdfResourceLimits,
  throwIfAborted
} from "./nativeTypes";

export type NativeXrefEntry =
  | { readonly kind: "free"; readonly generation: number; readonly nextFreeObject: number }
  | { readonly kind: "uncompressed"; readonly generation: number; readonly offset: number }
  | {
      readonly kind: "compressed";
      readonly generation: 0;
      readonly objectStreamNumber: number;
      readonly objectStreamIndex: number;
    };

export interface NativeXrefResult {
  readonly entries: ReadonlyMap<number, NativeXrefEntry>;
  /** Revision trailers in newest-to-oldest order. */
  readonly trailers: readonly PdfDictionary[];
  readonly startXref: number | null;
  readonly repaired: boolean;
  /** True when any active revision trailer, including a hybrid supplement, declares /Encrypt. */
  readonly encrypted: boolean;
}

interface XrefSection {
  readonly entries: Map<number, NativeXrefEntry>;
  readonly trailer: PdfDictionary;
  readonly previousOffset?: number;
  readonly hybridOffset?: number;
}

const INITIAL_STARTXREF_TAIL_BYTES = 64 * 1024;
const MAX_STARTXREF_TAIL_BYTES = 1024 * 1024;

export async function readNativeXref(
  reader: PdfRandomAccessReader,
  limits: Readonly<PdfResourceLimits>,
  repair: "off" | "safe",
  diagnostics: PdfDiagnostic[],
  signal?: AbortSignal
): Promise<NativeXrefResult> {
  let startXref: number | null = null;
  try {
    startXref = await findStartXref(reader, signal);
    return await readRevisionChain(reader, startXref, limits, signal);
  } catch (cause) {
    const repairable = isRepairableXrefError(cause);
    if (repair === "off" || !repairable) throw cause;
    let repairCause = cause;
    if (startXref !== null && isObjectZeroGenerationFailure(cause)) {
      try {
        const targeted = await readRevisionChain(
          reader,
          startXref,
          limits,
          signal,
          true
        );
        const actualGeneration = cause.details?.actualGeneration;
        diagnostics.push({
          code: "xref.repaired",
          severity: "warning",
          message:
            "The strict PDF structure was invalid; HEPR normalized the malformed free-object sentinel without scanning object payloads.",
          details: {
            strictError: cause.message,
            repairKind: "object-zero-generation",
            ...(typeof actualGeneration === "number" ? { actualGeneration } : {})
          }
        });
        diagnostics.push({
          code: "xref.repair-complete",
          severity: "info",
          message: `Targeted xref repair retained ${targeted.entries.size} indexed objects.`,
          details: {
            objectCount: targeted.entries.size,
            repairKind: "object-zero-generation"
          }
        });
        return { ...targeted, repaired: true };
      } catch (targetedCause) {
        if (!isRepairableXrefError(targetedCause)) throw targetedCause;
        repairCause = targetedCause;
      }
    }
    return await repairNativeXref(reader, limits, diagnostics, repairCause, signal, startXref);
  }
}

function isRepairableXrefError(value: unknown): value is PdfError {
  return value instanceof PdfError &&
    (value.code === "invalid-xref" || value.code === "invalid-object" || value.code === "unexpected-eof");
}

function isObjectZeroGenerationFailure(value: PdfError): boolean {
  return value.code === "invalid-xref" &&
    value.details?.reason === "object-zero-generation";
}

/** Run the single bounded structural repair pass after a strict structural failure. */
export async function repairNativeXref(
  reader: PdfRandomAccessReader,
  limits: Readonly<PdfResourceLimits>,
  diagnostics: PdfDiagnostic[],
  strictCause: unknown,
  signal?: AbortSignal,
  startXref: number | null = null
): Promise<NativeXrefResult> {
  diagnostics.push({
    code: "xref.repaired",
    severity: "warning",
    message: "The strict PDF structure was invalid; HEPR rebuilt object offsets with a bounded structural scan.",
    details: { strictError: strictCause instanceof Error ? strictCause.message : String(strictCause) }
  });
  return await repairXref(reader, limits, diagnostics, signal, startXref);
}

async function findStartXref(
  reader: PdfRandomAccessReader,
  signal?: AbortSignal
): Promise<number> {
  const maximumLength = Math.min(reader.byteLength, MAX_STARTXREF_TAIL_BYTES);
  let length = Math.min(maximumLength, INITIAL_STARTXREF_TAIL_BYTES);
  let offset = reader.byteLength - length;
  throwIfAborted(signal);
  let text = binaryString(await reader.read(offset, length, signal));
  throwIfAborted(signal);

  while (true) {
    const parsed = parseStartXrefTail(text, offset, reader.byteLength);
    if (parsed.kind === "found") return parsed.value;
    if (parsed.kind === "invalid-eof") {
      throw new PdfError("invalid-xref", "The PDF does not end with a valid %%EOF marker.", {
        offset: parsed.offset
      });
    }
    if (parsed.kind === "invalid-startxref") {
      throw new PdfError("invalid-xref", "The final PDF trailer has malformed startxref syntax.", {
        offset: parsed.offset
      });
    }
    if (length >= maximumLength) {
      throw new PdfError(
        "invalid-xref",
        parsed.syntax === "eof"
          ? "The PDF does not end with a valid %%EOF marker."
          : "The final PDF trailer has malformed startxref syntax.",
        { offset: parsed.offset }
      );
    }

    throwIfAborted(signal);
    const nextLength = Math.min(maximumLength, Math.max(length + 1, length * 2));
    const nextOffset = reader.byteLength - nextLength;
    const prefix = await reader.read(nextOffset, offset - nextOffset, signal);
    throwIfAborted(signal);
    text = binaryString(prefix) + text;
    offset = nextOffset;
    length = nextLength;
  }
}

type StartXrefTailParseResult =
  | { readonly kind: "found"; readonly value: number }
  | { readonly kind: "need-more"; readonly syntax: "eof" | "startxref"; readonly offset: number }
  | { readonly kind: "invalid-eof"; readonly offset: number }
  | { readonly kind: "invalid-startxref"; readonly offset: number };

function parseStartXrefTail(
  text: string,
  offset: number,
  sourceByteLength: number
): StartXrefTailParseResult {
  let syntaxEnd = text.length;
  while (syntaxEnd > 0 && isSpace(text.charCodeAt(syntaxEnd - 1))) syntaxEnd -= 1;
  const eofStart = syntaxEnd - 5;
  if (eofStart < 0) {
    return {
      kind: "need-more",
      syntax: "eof",
      offset: offset + Math.max(0, syntaxEnd - 1)
    };
  }
  if (text.slice(eofStart, syntaxEnd) !== "%%EOF") {
    return {
      kind: "invalid-eof",
      offset: offset + Math.max(0, syntaxEnd - 1)
    };
  }
  const expression = /(?:^|[\r\n])[\x00\x09\x0c\x20]*startxref[\x00\x09\x0a\x0c\x0d\x20]+(\d+)[\x00\x09\x0a\x0c\x0d\x20]*$/;
  const match = expression.exec(text.slice(0, eofStart));
  if (!match) {
    return text.lastIndexOf("startxref", eofStart) >= 0
      ? { kind: "invalid-startxref", offset: offset + eofStart }
      : { kind: "need-more", syntax: "startxref", offset: offset + eofStart };
  }
  // A match at the left edge relies on the regular expression's `^`
  // alternative. Fetch preceding source bytes before accepting it so a small
  // initial window cannot weaken the existing line-boundary validation.
  const firstMatchByte = match[0].charCodeAt(0);
  if (
    match.index === 0 &&
    offset > 0 &&
    firstMatchByte !== 0x0a &&
    firstMatchByte !== 0x0d
  ) {
    return { kind: "need-more", syntax: "startxref", offset: offset + eofStart };
  }
  const value = Number(match[1]);
  if (!Number.isSafeInteger(value) || value < 0 || value >= sourceByteLength) {
    throw new PdfError("invalid-xref", "startxref points outside the PDF source.", {
      offset: offset + match.index
    });
  }
  return { kind: "found", value };
}

async function readRevisionChain(
  reader: PdfRandomAccessReader,
  startXref: number,
  limits: Readonly<PdfResourceLimits>,
  signal?: AbortSignal,
  repairObjectZeroGeneration = false
): Promise<NativeXrefResult> {
  const entries = new Map<number, NativeXrefEntry>();
  const trailers: PdfDictionary[] = [];
  const visited = new Set<number>();
  let encrypted = false;
  let revisionOffset: number | undefined = startXref;
  let revisions = 0;
  let acceptedLinearizedForwardLink = false;
  while (revisionOffset !== undefined) {
    throwIfAborted(signal);
    if (visited.has(revisionOffset)) {
      throw new PdfError("invalid-xref", "The incremental xref chain contains a cycle.", {
        offset: revisionOffset
      });
    }
    visited.add(revisionOffset);
    revisions += 1;
    if (revisions > limits.maxIncrementalRevisions) {
      throw new PdfError("resource-limit", "The PDF has too many incremental revisions.", {
        details: { limit: limits.maxIncrementalRevisions }
      });
    }

    const section = await readXrefSection(
      reader,
      revisionOffset,
      limits,
      signal,
      repairObjectZeroGeneration
    );
    if (section.previousOffset === revisionOffset) {
      throw new PdfError("invalid-xref", "The incremental xref chain contains a cycle.", {
        offset: revisionOffset
      });
    }
    if (section.previousOffset !== undefined && section.previousOffset >= revisionOffset) {
      const isLinearizedForwardLink =
        revisions === 1 &&
        !acceptedLinearizedForwardLink &&
        await validatesLinearizedForwardLink(
          reader,
          startXref,
          section.previousOffset,
          limits,
          signal
        );
      if (!isLinearizedForwardLink) {
        validateBackwardLink(section.previousOffset, revisionOffset, reader.byteLength, "Prev");
      }
      acceptedLinearizedForwardLink = true;
    } else {
      validateBackwardLink(section.previousOffset, revisionOffset, reader.byteLength, "Prev");
    }
    const revisionEntries = new Map(section.entries);
    trailers.push(section.trailer);
    encrypted ||= declaresEncryption(section.trailer);
    if (section.hybridOffset !== undefined) {
      if (visited.has(section.hybridOffset)) {
        throw new PdfError("invalid-xref", "The xref /XRefStm graph contains a cycle.", {
          offset: section.hybridOffset
        });
      }
      const isLinearizedForwardHybrid = acceptedLinearizedForwardLink &&
        section.hybridOffset > revisionOffset &&
        section.previousOffset !== undefined &&
        section.hybridOffset < section.previousOffset;
      if (!isLinearizedForwardHybrid) {
        validateBackwardLink(section.hybridOffset, revisionOffset, reader.byteLength, "XRefStm");
      }
      visited.add(section.hybridOffset);
      const hybrid = await readXrefStreamSection(
        reader,
        section.hybridOffset,
        limits,
        signal,
        repairObjectZeroGeneration
      );
      encrypted ||= declaresEncryption(hybrid.trailer);
      // The current standard section is consulted before its supplemental
      // hybrid stream, and both precede the section reached through /Prev.
      for (const [objectNumber, entry] of hybrid.entries) {
        if (!revisionEntries.has(objectNumber)) revisionEntries.set(objectNumber, entry);
      }
      // A hybrid stream supplements, rather than creates, the revision trailer.
    }
    mergeNewestEntries(entries, revisionEntries);
    revisionOffset = section.previousOffset;
  }
  if (entries.size === 0) throw new PdfError("invalid-xref", "The PDF xref chain is empty.");
  return { entries, trailers, startXref, repaired: false, encrypted };
}

/**
 * A linearized PDF is the one standard exception to the usual newest-to-oldest
 * /Prev ordering: the final startxref names the first-page xref near the front,
 * whose /Prev names the main xref near the end. Keep this exception narrow by
 * validating the first indirect object's linearization dictionary and its main
 * xref hint before following the forward edge.
 */
async function validatesLinearizedForwardLink(
  reader: PdfRandomAccessReader,
  startXref: number,
  linkedOffset: number,
  limits: Readonly<PdfResourceLimits>,
  signal?: AbortSignal
): Promise<boolean> {
  if (linkedOffset <= startXref || linkedOffset >= reader.byteLength) return false;
  const prefixLength = Math.min(reader.byteLength, 64 * 1024);
  const prefix = await reader.read(0, prefixLength, signal);
  throwIfAborted(signal);
  const text = binaryString(prefix);
  const header = /%PDF-\d\.\d/.exec(text);
  if (!header) return false;
  const objectPattern = /(?:^|[\r\n])[\x00\x09\x0c\x20]*(\d+)[\x00\x09\x0a\x0c\x0d\x20]+(\d+)[\x00\x09\x0a\x0c\x0d\x20]+obj\b/g;
  objectPattern.lastIndex = header.index + header[0].length;
  const match = objectPattern.exec(text);
  if (!match) return false;
  const objectOffset = match.index + match[0].indexOf(match[1]);
  if (objectOffset >= startXref) return false;
  try {
    const indirect = await readIndirectObjectAt(reader, objectOffset, limits, signal);
    if (!isPdfDictionary(indirect.value)) return false;
    const dictionary = indirect.value;
    const linearized = dictionary.get("Linearized");
    const length = dictionary.get("L");
    const mainXrefHint = dictionary.get("T");
    const firstPageEnd = dictionary.get("E");
    const pageCount = dictionary.get("N");
    return typeof linearized === "number" && linearized > 0 &&
      length === reader.byteLength &&
      typeof mainXrefHint === "number" && Number.isSafeInteger(mainXrefHint) &&
      mainXrefHint >= linkedOffset && mainXrefHint - linkedOffset <= 256 &&
      typeof firstPageEnd === "number" && firstPageEnd > startXref &&
      typeof pageCount === "number" && Number.isSafeInteger(pageCount) && pageCount > 0;
  } catch (error) {
    if (signal?.aborted || (error instanceof PdfError && error.code === "aborted")) throw error;
    return false;
  }
}

async function readXrefSection(
  reader: PdfRandomAccessReader,
  offset: number,
  limits: Readonly<PdfResourceLimits>,
  signal?: AbortSignal,
  repairObjectZeroGeneration = false
): Promise<XrefSection> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= reader.byteLength) {
    throw new PdfError("invalid-xref", "An xref section offset is outside the PDF source.", {
      offset,
      details: { sourceBytes: reader.byteLength }
    });
  }
  const prefix = await reader.read(offset, Math.min(16, reader.byteLength - offset), signal);
  const text = binaryString(prefix);
  return /^[\x00\x09\x0a\x0c\x0d\x20]*xref(?:[\x00\x09\x0a\x0c\x0d\x20]|$)/.test(text)
    ? await readClassicXrefSection(reader, offset, limits, signal, repairObjectZeroGeneration)
    : await readXrefStreamSection(reader, offset, limits, signal, repairObjectZeroGeneration);
}

async function readClassicXrefSection(
  reader: PdfRandomAccessReader,
  offset: number,
  limits: Readonly<PdfResourceLimits>,
  signal?: AbortSignal,
  repairObjectZeroGeneration = false
): Promise<XrefSection> {
  const maximum = Math.min(reader.byteLength - offset, limits.maxRepairScanBytes);
  let length = Math.min(64 * 1024, maximum);
  while (true) {
    const bytes = await reader.read(offset, length, signal);
    try {
      return parseClassicXref(
        bytes,
        offset,
        reader.byteLength,
        limits,
        repairObjectZeroGeneration
      );
    } catch (error) {
      if (!(error instanceof PdfNeedMoreDataError)) throw error;
      if (length >= maximum) {
        throw new PdfError(
          maximum < reader.byteLength - offset ? "resource-limit" : "unexpected-eof",
          "The classic xref section is incomplete or exceeds the structural byte limit.",
          { offset }
        );
      }
      length = Math.min(maximum, Math.max(length + 1, length * 2));
    }
  }
}

function parseClassicXref(
  bytes: Uint8Array,
  baseOffset: number,
  sourceByteLength: number,
  limits: Readonly<PdfResourceLimits>,
  repairObjectZeroGeneration = false
): XrefSection {
  let position = skipSpaceAndComments(bytes, 0);
  position = consumeAsciiKeyword(bytes, position, "xref");
  const entries = new Map<number, NativeXrefEntry>();
  let previousSubsectionEnd = 0;
  let sawSubsection = false;
  let totalEntries = 0;
  while (true) {
    position = skipSpaceAndComments(bytes, position);
    if (matchesAsciiKeyword(bytes, position, "trailer")) {
      position = consumeAsciiKeyword(bytes, position, "trailer");
      const parser = new PdfCosParser(bytes, {
        baseOffset,
        position,
        maxDepth: limits.maxRecursionDepth
      });
      const trailer = parser.parseValue();
      if (!isPdfDictionary(trailer)) {
        throw new PdfError("invalid-xref", "The xref trailer is not a dictionary.", {
          offset: baseOffset + position
        });
      }
      const size = requiredPositiveSize(trailer.get("Size"));
      validateXrefEntries(
        entries,
        size,
        sourceByteLength,
        repairObjectZeroGeneration
      );
      return {
        entries,
        trailer,
        previousOffset: optionalNonNegativeInteger(trailer.get("Prev"), "Prev"),
        hybridOffset: optionalNonNegativeInteger(trailer.get("XRefStm"), "XRefStm")
      };
    }
    const subsectionStart = readUnsignedToken(bytes, position);
    position = subsectionStart.position;
    const subsectionCount = readUnsignedToken(bytes, position);
    position = subsectionCount.position;
    if (subsectionCount.value > Number.MAX_SAFE_INTEGER - subsectionStart.value) {
      throw new PdfError("invalid-xref", "An xref subsection range exceeds the safe integer range.");
    }
    const subsectionEnd = subsectionStart.value + subsectionCount.value;
    if (sawSubsection && subsectionStart.value < previousSubsectionEnd) {
      throw new PdfError("invalid-xref", "Classic xref subsections are out of order or overlap.");
    }
    if (subsectionCount.value > limits.maxRepairCandidates - totalEntries) {
      throw new PdfError("resource-limit", "An xref subsection exceeds the configured object limit.");
    }
    totalEntries += subsectionCount.value;
    previousSubsectionEnd = subsectionEnd;
    sawSubsection = true;
    for (let index = 0; index < subsectionCount.value; index += 1) {
      const field1 = readUnsignedToken(bytes, position);
      const field2 = readUnsignedToken(bytes, field1.position);
      const status = readAsciiToken(bytes, field2.position);
      position = status.position;
      const objectNumber = subsectionStart.value + index;
      if (status.value === "n") {
        entries.set(objectNumber, {
          kind: "uncompressed",
          generation: checkedGeneration(field2.value),
          offset: field1.value
        });
      } else if (status.value === "f") {
        entries.set(objectNumber, {
          kind: "free",
          generation: checkedGeneration(field2.value),
          nextFreeObject: field1.value
        });
      } else {
        throw new PdfError("invalid-xref", "An xref entry has an invalid status marker.", {
          offset: baseOffset + field2.position
        });
      }
    }
  }
}

async function readXrefStreamSection(
  reader: PdfRandomAccessReader,
  offset: number,
  limits: Readonly<PdfResourceLimits>,
  signal?: AbortSignal,
  repairObjectZeroGeneration = false
): Promise<XrefSection> {
  const indirect = await readIndirectObjectAt(reader, offset, limits, signal);
  if (!isPdfStream(indirect.value)) {
    throw new PdfError("invalid-xref", "startxref does not point to an xref table or stream.", {
      offset
    });
  }
  const stream = indirect.value;
  if (!isPdfName(stream.dictionary.get("Type"), "XRef")) {
    throw new PdfError("invalid-xref", "The xref stream has no /Type /XRef.", { offset });
  }
  const filters = readFilterNames(stream.dictionary.get("Filter"));
  const parameters = readDecodeParameters(stream.dictionary.get("DecodeParms"), filters.length);
  const decoded = await decodePdfFilterChain(stream.bytes, filters, parameters, { limits, signal });
  const entries = parseXrefStreamEntries(
    stream,
    decoded,
    reader.byteLength,
    limits,
    repairObjectZeroGeneration
  );
  return {
    entries,
    trailer: stream.dictionary,
    previousOffset: optionalNonNegativeInteger(stream.dictionary.get("Prev"), "Prev")
  };
}

function parseXrefStreamEntries(
  stream: PdfStream,
  decoded: Uint8Array,
  sourceByteLength: number,
  limits: Readonly<PdfResourceLimits>,
  repairObjectZeroGeneration = false
): Map<number, NativeXrefEntry> {
  const widths = integerArray(stream.dictionary.get("W"), "W");
  if (widths.length !== 3 || widths.some((width) => width < 0 || width > 8)) {
    throw new PdfError("invalid-xref", "An xref stream has an invalid /W array.");
  }
  const size = requiredPositiveSize(stream.dictionary.get("Size"));
  const index = stream.dictionary.has("Index")
    ? integerArray(stream.dictionary.get("Index"), "Index")
    : [0, size];
  if (index.length % 2 !== 0) {
    throw new PdfError("invalid-xref", "An xref stream /Index array has odd length.");
  }
  const entryBytes = widths[0] + widths[1] + widths[2];
  if (entryBytes === 0) throw new PdfError("invalid-xref", "An xref stream entry has zero width.");
  let totalEntries = 0;
  let previousRangeEnd = 0;
  let sawRange = false;
  for (let pair = 0; pair < index.length; pair += 2) {
    const first = index[pair];
    const count = index[pair + 1];
    if (count > Number.MAX_SAFE_INTEGER - first) {
      throw new PdfError("invalid-xref", "An xref stream /Index range overflows.");
    }
    const rangeEnd = first + count;
    if (rangeEnd > size) {
      throw new PdfError("invalid-xref", "An xref stream /Index range is invalid.");
    }
    if (sawRange && first < previousRangeEnd) {
      throw new PdfError("invalid-xref", "Xref stream /Index ranges are out of order or overlap.");
    }
    if (count > limits.maxRepairCandidates - totalEntries) {
      throw new PdfError("resource-limit", "An xref stream exceeds configured limits.");
    }
    totalEntries += count;
    previousRangeEnd = rangeEnd;
    sawRange = true;
  }
  if (totalEntries > Math.floor(Number.MAX_SAFE_INTEGER / entryBytes)) {
    throw new PdfError("resource-limit", "An xref stream exceeds configured limits.");
  }
  const expectedBytes = totalEntries * entryBytes;
  if (expectedBytes !== decoded.length) {
    throw new PdfError("invalid-xref", "The decoded xref stream has unexpected trailing bytes.");
  }
  const entries = new Map<number, NativeXrefEntry>();
  let offset = 0;
  for (let pair = 0; pair < index.length; pair += 2) {
    const first = index[pair];
    const count = index[pair + 1];
    for (let relative = 0; relative < count; relative += 1) {
      const type = widths[0] === 0 ? 1 : readBigEndianInteger(decoded, offset, widths[0]);
      offset += widths[0];
      const field1 = readBigEndianInteger(decoded, offset, widths[1]);
      offset += widths[1];
      const field2 = readBigEndianInteger(decoded, offset, widths[2]);
      offset += widths[2];
      const objectNumber = first + relative;
      if (type === 0) {
        entries.set(objectNumber, {
          kind: "free",
          nextFreeObject: field1,
          generation: checkedGeneration(field2)
        });
      } else if (type === 1) {
        if (field1 >= sourceByteLength) {
          throw new PdfError("invalid-xref", "An xref stream object offset is outside the PDF source.");
        }
        entries.set(objectNumber, {
          kind: "uncompressed",
          offset: field1,
          generation: checkedGeneration(field2)
        });
      } else if (type === 2) {
        if (field1 === 0 || field1 >= size) {
          throw new PdfError("invalid-xref", "An xref stream references an invalid object stream number.");
        }
        entries.set(objectNumber, {
          kind: "compressed",
          objectStreamNumber: field1,
          objectStreamIndex: field2,
          generation: 0
        });
      }
      // Unknown entry types are explicitly ignored by ISO 32000.
    }
  }
  validateXrefEntries(
    entries,
    size,
    sourceByteLength,
    repairObjectZeroGeneration
  );
  return entries;
}

async function repairXref(
  reader: PdfRandomAccessReader,
  limits: Readonly<PdfResourceLimits>,
  diagnostics: PdfDiagnostic[],
  signal: AbortSignal | undefined,
  startXref: number | null
): Promise<NativeXrefResult> {
  if (reader.byteLength > limits.maxRepairScanBytes) {
    throw new PdfError("resource-limit", "The PDF is larger than the configured repair scan limit.", {
      details: { sourceBytes: reader.byteLength, limit: limits.maxRepairScanBytes }
    });
  }
  const entries = new Map<number, NativeXrefEntry>();
  const entryDefinitionOffsets = new Map<number, number>();
  const candidates: Array<{
    readonly objectNumber: number;
    readonly generation: number;
    readonly offset: number;
  }> = [];
  const trailerOffsets: number[] = [];
  const repairedTrailerCandidates: Array<{
    readonly offset: number;
    readonly dictionary: PdfDictionary;
  }> = [];
  const seenCandidateOffsets = new Set<number>();
  const seenTrailerOffsets = new Set<number>();
  const blockSize = 1024 * 1024;
  const overlap = 128;
  for (let offset = 0; offset < reader.byteLength; offset += blockSize - overlap) {
    throwIfAborted(signal);
    const length = Math.min(blockSize, reader.byteLength - offset);
    const bytes = await reader.read(offset, length, signal);
    const text = binaryString(bytes);
    const objects = /(?:^|[\r\n])[\x00\x09\x0c\x20]*(\d+)[\x00\x09\x0a\x0c\x0d\x20]+(\d+)[\x00\x09\x0a\x0c\x0d\x20]+obj(?:[\x00\x09\x0a\x0c\x0d\x20]|[<\[\/(])/g;
    let objectMatch: RegExpExecArray | null;
    while ((objectMatch = objects.exec(text))) {
      const localDigits = objectMatch.index + objectMatch[0].indexOf(objectMatch[1]);
      const candidateOffset = offset + localDigits;
      if (seenCandidateOffsets.has(candidateOffset)) continue;
      seenCandidateOffsets.add(candidateOffset);
      if (seenCandidateOffsets.size > limits.maxRepairCandidates) {
        throw new PdfError("resource-limit", "PDF repair found too many indirect-object candidates.", {
          details: { limit: limits.maxRepairCandidates }
        });
      }
      const objectNumber = Number(objectMatch[1]);
      const generation = Number(objectMatch[2]);
      if (
        !Number.isSafeInteger(objectNumber) || objectNumber <= 0 ||
        !Number.isSafeInteger(generation) || generation < 0 || generation > 65_535
      ) continue;
      candidates.push({ objectNumber, generation, offset: candidateOffset });
    }
    const trailers = /trailer[\x00\x09\x0a\x0c\x0d\x20]*(?=<<)/g;
    let trailerMatch: RegExpExecArray | null;
    while ((trailerMatch = trailers.exec(text))) {
      const suffix = trailerMatch[0];
      const dictionaryOffset = offset + trailerMatch.index + suffix.length;
      if (!seenTrailerOffsets.has(dictionaryOffset)) {
        if (seenTrailerOffsets.size >= limits.maxRepairCandidates) {
          throw new PdfError("resource-limit", "PDF repair found too many trailer candidates.", {
            details: { limit: limits.maxRepairCandidates }
          });
        }
        seenTrailerOffsets.add(dictionaryOffset);
        trailerOffsets.push(dictionaryOffset);
      }
    }
    if (offset + length >= reader.byteLength) break;
  }
  candidates.sort((left, right) => left.offset - right.offset);
  const latestCandidateByRef = new Map<string, typeof candidates[number]>();
  for (const candidate of candidates) {
    latestCandidateByRef.set(`${candidate.objectNumber}:${candidate.generation}`, candidate);
  }
  const resolvingLengths = new Set<string>();
  const resolveRepairLength = async (value: PdfValue): Promise<number | undefined> => {
    if (!isPdfRef(value)) return undefined;
    const key = `${value.objectNumber}:${value.generation}`;
    const candidate = latestCandidateByRef.get(key);
    if (!candidate || resolvingLengths.has(key)) return undefined;
    if (resolvingLengths.size >= limits.maxRecursionDepth) {
      throw new PdfError("resource-limit", "Repair stream-length resolution exceeds the recursion limit.", {
        objectNumber: value.objectNumber,
        details: { reason: "repair-length-depth", limit: limits.maxRecursionDepth }
      });
    }
    resolvingLengths.add(key);
    try {
      const indirect = await readIndirectObjectAt(reader, candidate.offset, limits, signal, {
        resolveLength: resolveRepairLength,
        duplicateDictionaryKeys: "keep-last"
      });
      if (
        indirect.ref.objectNumber !== value.objectNumber ||
        indirect.ref.generation !== value.generation
      ) return undefined;
      return Number.isSafeInteger(indirect.value) && (indirect.value as number) >= 0
        ? indirect.value as number
        : undefined;
    } finally {
      resolvingLengths.delete(key);
    }
  };
  const objectRanges: Array<readonly [number, number]> = [];
  let recoveredCompressedObjects = 0;
  let containingObjectEnd = -1;
  for (const candidate of candidates) {
    throwIfAborted(signal);
    if (candidate.offset < containingObjectEnd) continue;
    try {
      const indirect = await readIndirectObjectAt(
        reader,
        candidate.offset,
        limits,
        signal,
        {
          resolveLength: resolveRepairLength,
          duplicateDictionaryKeys: "keep-last"
        }
      );
      if (
        indirect.ref.objectNumber !== candidate.objectNumber ||
        indirect.ref.generation !== candidate.generation
      ) continue;
      // Once the outer indirect object is structurally complete, no lexical hit
      // in its stream/string payload may become a separate repair candidate,
      // even if later ObjStm-specific validation rejects the outer object.
      containingObjectEnd = indirect.endOffset;
      objectRanges.push(Object.freeze([candidate.offset, indirect.endOffset]));
      let compressedObjectNumbers: readonly number[] = [];
      if (isPdfStream(indirect.value) && isPdfName(indirect.value.dictionary.get("Type"), "ObjStm")) {
        if (candidate.generation !== 0) {
          throw new PdfError("invalid-object", "An object stream has a non-zero generation.", {
            objectNumber: candidate.objectNumber
          });
        }
        compressedObjectNumbers = await readRepairObjectStreamHeader(
          indirect.value,
          candidate.objectNumber,
          limits,
          signal
        );
        if (compressedObjectNumbers.length > limits.maxRepairCandidates - recoveredCompressedObjects) {
          throw new PdfError("resource-limit", "PDF repair recovered too many compressed objects.", {
            details: { limit: limits.maxRepairCandidates }
          });
        }
      }
      setRepairedEntry(entries, entryDefinitionOffsets, candidate.objectNumber, candidate.offset, {
        kind: "uncompressed",
        generation: candidate.generation,
        offset: candidate.offset
      });
      if (isPdfStream(indirect.value) && isPdfName(indirect.value.dictionary.get("Type"), "XRef")) {
        repairedTrailerCandidates.push({
          offset: candidate.offset,
          dictionary: indirect.value.dictionary
        });
      }
      if (compressedObjectNumbers.length > 0) {
        recoveredCompressedObjects += compressedObjectNumbers.length;
        for (let index = 0; index < compressedObjectNumbers.length; index += 1) {
          setRepairedEntry(entries, entryDefinitionOffsets, compressedObjectNumbers[index], candidate.offset, {
            kind: "compressed",
            generation: 0,
            objectStreamNumber: candidate.objectNumber,
            objectStreamIndex: index
          });
        }
      }
    } catch (error) {
      if (
        signal?.aborted ||
        (error instanceof PdfError && (error.code === "aborted" || error.code === "resource-limit"))
      ) throw error;
      // A raw lexical hit that is not a complete indirect object is ignored.
    }
  }
  if (entries.size === 0) throw new PdfError("invalid-xref", "PDF repair found no indirect objects.");
  trailerOffsets.sort((left, right) => right - left);
  for (const offset of trailerOffsets) {
    if (isOffsetInsideRanges(offset, objectRanges)) continue;
    try {
      const value = await readCosValueAt(reader, offset, limits, signal);
      if (isPdfDictionary(value)) repairedTrailerCandidates.push({ offset, dictionary: value });
    } catch (error) {
      if (signal?.aborted || (error instanceof PdfError && error.code === "aborted")) throw error;
      // A false-positive trailer inside a stream is ignored; objects themselves
      // remain strict and are validated when resolved.
    }
  }
  repairedTrailerCandidates.sort((left, right) => right.offset - left.offset);
  const trailers = repairedTrailerCandidates.map(({ dictionary }) => dictionary);
  diagnostics.push({
    code: "xref.repair-complete",
    severity: "info",
    message: `Structural repair retained ${entries.size} indirect-object offsets.`,
    details: { objectCount: entries.size }
  });
  return {
    entries,
    trailers,
    startXref,
    repaired: true,
    encrypted: trailers.some(declaresEncryption)
  };
}

async function readRepairObjectStreamHeader(
  stream: PdfStream,
  objectStreamNumber: number,
  limits: Readonly<PdfResourceLimits>,
  signal?: AbortSignal
): Promise<readonly number[]> {
  const count = requiredNonNegativeInteger(stream.dictionary.get("N"), "ObjStm N");
  const first = requiredNonNegativeInteger(stream.dictionary.get("First"), "ObjStm First");
  if (count > limits.maxRepairCandidates) {
    throw new PdfError("resource-limit", "An object stream contains too many objects.", {
      objectNumber: objectStreamNumber,
      details: { limit: limits.maxRepairCandidates }
    });
  }
  const filters = readFilterNames(stream.dictionary.get("Filter"));
  const parameters = readDecodeParameters(
    stream.dictionary.get("DecodeParms") ?? stream.dictionary.get("DP"),
    filters.length
  );
  const decoded = await decodePdfFilterChain(stream.bytes, filters, parameters, { limits, signal });
  if (first > decoded.length) {
    throw new PdfError("invalid-object", "An object stream /First offset is outside the stream.", {
      objectNumber: objectStreamNumber
    });
  }
  const header = new PdfCosParser(decoded, { maxDepth: limits.maxRecursionDepth });
  const objectNumbers: number[] = [];
  const relativeOffsets: number[] = [];
  const seenObjectNumbers = new Set<number>();
  for (let index = 0; index < count; index += 1) {
    const objectNumber = header.readInteger();
    const relativeOffset = header.readInteger();
    if (objectNumber <= 0 || objectNumber === objectStreamNumber || seenObjectNumbers.has(objectNumber)) {
      throw new PdfError("invalid-object", "An object stream contains invalid object numbers.", {
        objectNumber: objectStreamNumber
      });
    }
    seenObjectNumbers.add(objectNumber);
    objectNumbers.push(objectNumber);
    relativeOffsets.push(relativeOffset);
  }
  if (header.position > first) {
    throw new PdfError("invalid-object", "An object stream header overlaps its object data.", {
      objectNumber: objectStreamNumber
    });
  }
  if (count > 0 && relativeOffsets[0] !== 0) {
    throw new PdfError("invalid-object", "An object stream's first relative offset must be zero.", {
      objectNumber: objectStreamNumber
    });
  }
  for (let index = 0; index < count; index += 1) {
    const relativeOffset = relativeOffsets[index];
    if (
      relativeOffset < 0 || relativeOffset > decoded.length - first ||
      (index > 0 && relativeOffset <= relativeOffsets[index - 1])
    ) {
      throw new PdfError("invalid-object", "An object stream contains invalid object offsets.", {
        objectNumber: objectStreamNumber
      });
    }
    const position = first + relativeOffset;
    const nextPosition = index + 1 < count ? first + relativeOffsets[index + 1] : decoded.length;
    if (position < first || position >= nextPosition || nextPosition > decoded.length) {
      throw new PdfError("invalid-object", "An object stream contains invalid object offsets.", {
        objectNumber: objectStreamNumber
      });
    }
    const parser = new PdfCosParser(decoded, {
      position,
      maxDepth: limits.maxRecursionDepth,
      duplicateDictionaryKeys: "keep-last"
    });
    const value = parser.parseValue();
    if (isPdfRef(value)) {
      throw new PdfError("invalid-object", "A compressed object cannot be only an indirect reference.", {
        objectNumber: objectNumbers[index]
      });
    }
    parser.skipWhitespaceAndComments();
    if (parser.position !== nextPosition) {
      throw new PdfError("invalid-object", "An object stream value does not end at its declared boundary.", {
        objectNumber: objectNumbers[index]
      });
    }
  }
  return objectNumbers;
}

function setRepairedEntry(
  entries: Map<number, NativeXrefEntry>,
  definitionOffsets: Map<number, number>,
  objectNumber: number,
  definitionOffset: number,
  entry: NativeXrefEntry
): void {
  const previousOffset = definitionOffsets.get(objectNumber);
  if (previousOffset !== undefined && previousOffset > definitionOffset) return;
  definitionOffsets.set(objectNumber, definitionOffset);
  entries.set(objectNumber, entry);
}

function validateBackwardLink(
  linkedOffset: number | undefined,
  currentOffset: number,
  sourceByteLength: number,
  name: "Prev" | "XRefStm"
): void {
  if (linkedOffset !== undefined && linkedOffset >= sourceByteLength) {
    throw new PdfError("invalid-xref", `Xref /${name} points outside the PDF source.`, {
      offset: linkedOffset,
      details: { sourceBytes: sourceByteLength }
    });
  }
  if (linkedOffset !== undefined && linkedOffset >= currentOffset) {
    throw new PdfError("invalid-xref", `Xref /${name} does not point to an earlier structural section.`, {
      offset: linkedOffset,
      details: { currentOffset }
    });
  }
}

function declaresEncryption(trailer: PdfDictionary): boolean {
  return trailer.has("Encrypt") && trailer.get("Encrypt") !== null;
}

async function readCosValueAt(
  reader: PdfRandomAccessReader,
  offset: number,
  limits: Readonly<PdfResourceLimits>,
  signal?: AbortSignal
): Promise<PdfValue> {
  const maximum = Math.min(reader.byteLength - offset, limits.maxRepairScanBytes);
  let length = Math.min(64 * 1024, maximum);
  while (true) {
    const bytes = await reader.read(offset, length, signal);
    const parser = new PdfCosParser(bytes, {
      baseOffset: offset,
      maxDepth: limits.maxRecursionDepth,
      duplicateDictionaryKeys: "keep-last"
    });
    try {
      return parser.parseValue();
    } catch (error) {
      if (!(error instanceof PdfNeedMoreDataError)) throw error;
      if (length >= maximum) throw new PdfError("unexpected-eof", "A repaired trailer is incomplete.");
      length = Math.min(maximum, Math.max(length + 1, length * 2));
    }
  }
}

function mergeNewestEntries(
  target: Map<number, NativeXrefEntry>,
  source: ReadonlyMap<number, NativeXrefEntry>
): void {
  for (const [objectNumber, entry] of source) {
    if (!target.has(objectNumber)) target.set(objectNumber, entry);
  }
}

function validateXrefEntries(
  entries: Map<number, NativeXrefEntry>,
  size: number,
  sourceByteLength: number,
  repairObjectZeroGeneration = false
): void {
  for (const [objectNumber, entry] of entries) {
    if (objectNumber < 0 || objectNumber >= size) {
      throw new PdfError("invalid-xref", "An xref entry has an object number outside /Size.");
    }
    if (entry.kind === "free") {
      if (entry.nextFreeObject < 0 || entry.nextFreeObject >= size) {
        throw new PdfError("invalid-xref", "A free xref entry points outside the free-object list.");
      }
    } else if (entry.kind === "uncompressed" && entry.offset >= sourceByteLength) {
      throw new PdfError("invalid-xref", "An xref object offset is outside the PDF source.");
    }
  }
  const zero = entries.get(0);
  if (zero?.kind === "free" && zero.generation !== 65_535) {
    if (repairObjectZeroGeneration) {
      entries.set(0, { ...zero, generation: 65_535 });
      return;
    }
    throw new PdfError("invalid-xref", "Xref object 0 must be free with generation 65535.", {
      details: {
        reason: "object-zero-generation",
        actualGeneration: zero.generation
      }
    });
  }
  if (zero && zero.kind !== "free") {
    throw new PdfError("invalid-xref", "Xref object 0 must be free with generation 65535.", {
      details: { reason: "object-zero-not-free" }
    });
  }
}

function isOffsetInsideRanges(
  offset: number,
  ranges: readonly (readonly [number, number])[]
): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const range = ranges[middle];
    if (offset < range[0]) high = middle - 1;
    else if (offset >= range[1]) low = middle + 1;
    else return true;
  }
  return false;
}

function integerArray(value: PdfValue | undefined, name: string): number[] {
  if (!Array.isArray(value)) throw new PdfError("invalid-xref", `Xref /${name} is not an array.`);
  return value.map((entry) => requiredNonNegativeInteger(entry, name));
}

function requiredNonNegativeInteger(value: PdfValue | undefined, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new PdfError("invalid-xref", `Xref /${name} is not a non-negative integer.`);
  }
  return value as number;
}

function requiredPositiveSize(value: PdfValue | undefined): number {
  const size = requiredNonNegativeInteger(value, "Size");
  if (size === 0) throw new PdfError("invalid-xref", "Xref /Size must be positive.");
  return size;
}

function optionalNonNegativeInteger(value: PdfValue | undefined, name: string): number | undefined {
  return value === undefined ? undefined : requiredNonNegativeInteger(value, name);
}

function checkedGeneration(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 65_535) {
    throw new PdfError("invalid-xref", "An xref generation number is invalid.");
  }
  return value;
}

function readBigEndianInteger(bytes: Uint8Array, offset: number, width: number): number {
  let result = 0;
  for (let index = 0; index < width; index += 1) {
    result = result * 256 + bytes[offset + index];
    if (!Number.isSafeInteger(result)) {
      throw new PdfError("invalid-xref", "An xref stream field exceeds the safe integer range.");
    }
  }
  return result;
}

function readUnsignedToken(bytes: Uint8Array, position: number): { value: number; position: number } {
  const token = readAsciiToken(bytes, position);
  if (!/^\d+$/.test(token.value)) throw new PdfError("invalid-xref", "Expected an unsigned xref integer.");
  const value = Number(token.value);
  if (!Number.isSafeInteger(value)) throw new PdfError("invalid-xref", "An xref integer is too large.");
  return { value, position: token.position };
}

function readAsciiToken(bytes: Uint8Array, position: number): { value: string; position: number } {
  position = skipSpaceAndComments(bytes, position);
  if (position >= bytes.length) throw new PdfNeedMoreDataError();
  const start = position;
  while (position < bytes.length && !isSpace(bytes[position])) position += 1;
  if (position === bytes.length) throw new PdfNeedMoreDataError();
  return { value: binaryString(bytes.subarray(start, position)), position };
}

function skipSpaceAndComments(bytes: Uint8Array, initial: number): number {
  let position = initial;
  while (position < bytes.length) {
    if (isSpace(bytes[position])) {
      position += 1;
      continue;
    }
    if (bytes[position] !== 0x25) return position;
    position += 1;
    while (position < bytes.length && bytes[position] !== 0x0a && bytes[position] !== 0x0d) position += 1;
  }
  return position;
}

function consumeAsciiKeyword(bytes: Uint8Array, position: number, keyword: string): number {
  position = skipSpaceAndComments(bytes, position);
  if (!matchesAsciiKeyword(bytes, position, keyword)) {
    if (position + keyword.length > bytes.length) throw new PdfNeedMoreDataError();
    throw new PdfError("invalid-xref", `Expected xref keyword ${keyword}.`);
  }
  return position + keyword.length;
}

function matchesAsciiKeyword(bytes: Uint8Array, position: number, keyword: string): boolean {
  if (position + keyword.length > bytes.length) return false;
  for (let index = 0; index < keyword.length; index += 1) {
    if (bytes[position + index] !== keyword.charCodeAt(index)) return false;
  }
  const following = bytes[position + keyword.length];
  return following === undefined || isSpace(following) || following === 0x3c;
}

function isSpace(byte: number): boolean {
  return byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
}

function binaryString(bytes: Uint8Array): string {
  let output = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    output += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 8192)));
  }
  return output;
}
