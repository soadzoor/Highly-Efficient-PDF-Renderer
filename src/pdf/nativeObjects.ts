import {
  PdfCosParser,
  PdfNeedMoreDataError,
  type PdfDuplicateDictionaryKeyPolicy,
  type PdfIndirectObject,
  type PdfValue
} from "./nativeCos";
import type { PdfRandomAccessReader } from "./nativeSource";
import { PdfError, type PdfResourceLimits, throwIfAborted } from "./nativeTypes";

const INITIAL_OBJECT_WINDOW = 64 * 1024;

/** Parse one indirect object at an xref offset, growing the read window only as needed. */
export async function readIndirectObjectAt(
  reader: PdfRandomAccessReader,
  offset: number,
  limits: Readonly<PdfResourceLimits>,
  signal?: AbortSignal,
  options: {
    readonly resolveLength?: (value: PdfValue, signal?: AbortSignal) => Promise<number | undefined>;
    readonly duplicateDictionaryKeys?: PdfDuplicateDictionaryKeyPolicy;
    readonly onDuplicateDictionaryKey?: (key: string, offset: number) => void;
    readonly repairMissingStreamEndEol?: boolean;
    readonly onMissingStreamEndEol?: (offset: number) => void;
  } = {}
): Promise<PdfIndirectObject> {
  if (!Number.isSafeInteger(reader.byteLength) || reader.byteLength < 0) {
    throw new PdfError("source-read", "The PDF source reports an invalid byte length.");
  }
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= reader.byteLength) {
    throw new PdfError("invalid-xref", "An xref entry points outside the PDF source.", {
      offset,
      details: { sourceBytes: reader.byteLength }
    });
  }
  const available = reader.byteLength - offset;
  const maximum = Math.min(available, limits.maxDecodedStreamBytes);
  let windowLength = Math.min(INITIAL_OBJECT_WINDOW, maximum);
  let indirectLength: number | undefined;
  while (true) {
    throwIfAborted(signal);
    const bytes = await reader.read(offset, windowLength, signal);
    throwIfAborted(signal);
    if (!(bytes instanceof Uint8Array) || bytes.length !== windowLength) {
      throw new PdfError("source-read", "The PDF source returned an unexpected indirect-object window length.", {
        offset,
        details: {
          requestedBytes: windowLength,
          receivedBytes: bytes instanceof Uint8Array ? bytes.length : -1
        }
      });
    }
    const parser = new PdfCosParser(bytes, {
      baseOffset: offset,
      maxDepth: limits.maxRecursionDepth,
      duplicateDictionaryKeys: options.duplicateDictionaryKeys,
      onDuplicateDictionaryKey: options.onDuplicateDictionaryKey,
      repairMissingStreamEndEol: options.repairMissingStreamEndEol,
      onMissingStreamEndEol: options.onMissingStreamEndEol
    });
    let lengthAwareWindow = 0;
    try {
      if (options.resolveLength) {
        const prefix = parser.parseIndirectObjectPrefix();
        parser.skipWhitespaceAndComments();
        const rawLength = prefix.value instanceof Map ? prefix.value.get("Length") : undefined;
        if (
          prefix.value instanceof Map && parser.peekKeyword("stream") &&
          rawLength !== undefined && typeof rawLength !== "number" && indirectLength === undefined
        ) {
          indirectLength = await options.resolveLength(rawLength, signal);
          throwIfAborted(signal);
          if (!Number.isSafeInteger(indirectLength) || (indirectLength as number) < 0) {
            throw new PdfError("invalid-object", "An indirect stream /Length is not a non-negative integer.", {
              offset,
              objectNumber: prefix.ref.objectNumber
            });
          }
          if ((indirectLength as number) >= available) {
            throw new PdfError("unexpected-eof", "An indirect stream /Length exceeds the remaining PDF source.", {
              offset,
              objectNumber: prefix.ref.objectNumber,
              details: { declaredLength: indirectLength as number, availableBytes: available }
            });
          }
          if (maximum < available && (indirectLength as number) >= maximum) {
            throw new PdfError("resource-limit", "An indirect stream /Length exceeds the structural byte limit.", {
              offset,
              objectNumber: prefix.ref.objectNumber,
              details: { declaredLength: indirectLength as number, limit: maximum }
            });
          }
        }
        const declaredLength = typeof rawLength === "number"
          ? rawLength
          : indirectLength;
        if (
          prefix.value instanceof Map && parser.peekKeyword("stream") &&
          Number.isSafeInteger(declaredLength) && (declaredLength as number) >= 0
        ) {
          // The parser still validates the exact stream framing. This is only
          // a read-size hint which avoids rereading 64K, 128K, 256K, ... when
          // /Length already proves that a much larger window is required.
          const streamSyntaxSlack = 64;
          lengthAwareWindow = Math.min(
            maximum,
            parser.position + "stream".length + (declaredLength as number) +
              streamSyntaxSlack
          );
        }
        parser.position = 0;
      }
      return parser.parseIndirectObject({
        resolveLength: indirectLength === undefined ? undefined : () => indirectLength
      });
    } catch (error) {
      if (!(error instanceof PdfNeedMoreDataError)) throw error;
      if (windowLength >= maximum) {
        const code = maximum < available ? "resource-limit" : "unexpected-eof";
        throw new PdfError(
          code,
          code === "resource-limit"
            ? "An indirect PDF object exceeds the configured structural byte limit."
            : "The PDF ends inside an indirect object.",
          { offset }
        );
      }
      windowLength = Math.min(
        maximum,
        Math.max(windowLength + 1, windowLength * 2, lengthAwareWindow)
      );
    }
  }
}
