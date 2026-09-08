import { isPdfDictionary, isPdfName, type PdfDictionary, type PdfValue } from "./nativeCos";
import { PdfError, type PdfResourceLimits, mergePdfLimits, throwIfAborted } from "./nativeTypes";

const MAX_FILTER_CHAIN_LENGTH = 64;
const DEFAULT_DECODED_CHUNK_SIZE = 256 * 1024;

export interface PdfFilterDecodeOptions {
  readonly limits?: Partial<PdfResourceLimits>;
  readonly signal?: AbortSignal;
}

export interface PdfFilterChunkDecodeOptions extends PdfFilterDecodeOptions {
  /** Maximum yielded chunk size. @default 262144 */
  readonly chunkSize?: number;
}

/** Decode a stream's complete PDF filter chain, including TIFF/PNG predictors. */
export async function decodePdfFilterChain(
  input: Uint8Array,
  filters: readonly string[],
  decodeParameters: readonly (PdfDictionary | null)[],
  options: PdfFilterDecodeOptions = {}
): Promise<Uint8Array> {
  const limits = mergePdfLimits(options.limits);
  throwIfAborted(options.signal);
  enforceFilterCount(filters.length);
  if (decodeParameters.length !== filters.length) {
    throw new PdfError("invalid-object", "A decoded filter chain has mismatched DecodeParms arity.", {
      details: { filterCount: filters.length, decodeParameterCount: decodeParameters.length }
    });
  }
  if (filters.length === 0) {
    enforceLimit(input.length, limits.maxDecodedStreamBytes);
    return input;
  }
  let bytes = input;
  for (let index = 0; index < filters.length; index += 1) {
    throwIfAborted(options.signal);
    const filter = normalizeFilterName(filters[index]);
    const params = decodeParameters[index] ?? null;
    switch (filter) {
      case "FlateDecode":
        bytes = await decodeFlate(bytes, limits.maxDecodedStreamBytes, options.signal);
        break;
      case "LZWDecode":
        bytes = decodeLzw(
          bytes,
          integerEntry(params, "EarlyChange", 1),
          limits.maxDecodedStreamBytes,
          options.signal
        );
        break;
      case "ASCII85Decode":
        bytes = decodeAscii85(bytes, limits.maxDecodedStreamBytes, options.signal);
        break;
      case "ASCIIHexDecode":
        bytes = decodeAsciiHex(bytes, limits.maxDecodedStreamBytes, options.signal);
        break;
      case "RunLengthDecode":
        bytes = decodeRunLength(bytes, limits.maxDecodedStreamBytes, options.signal);
        break;
      default:
        throw new PdfError("unsupported-filter", `Unsupported PDF stream filter /${filters[index]}.`, {
          details: { filter: filters[index] }
        });
    }
    enforceLimit(bytes.length, limits.maxDecodedStreamBytes);
    // Predictor decoding is kept as an explicit post-filter transform. This
    // also accepts producer output that attaches the predictor dictionary to a
    // simple outer byte filter; the bytes are never inspected to infer one.
    bytes = applyPredictor(bytes, params, limits.maxDecodedStreamBytes, options.signal);
    throwIfAborted(options.signal);
  }
  return bytes;
}

/**
 * Decode a PDF filter chain as bounded chunks.
 *
 * The common single-FlateDecode, Predictor=1 case is genuinely streaming and
 * never accumulates the complete decoded stream. Every other chain retains
 * the established whole-buffer decoder and yields bounded views of its result.
 * Consumers must exhaust the iterable to observe end-of-stream integrity
 * failures such as a damaged zlib checksum.
 */
export async function* decodePdfFilterChainChunks(
  input: Uint8Array,
  filters: readonly string[],
  decodeParameters: readonly (PdfDictionary | null)[],
  options: PdfFilterChunkDecodeOptions = {}
): AsyncIterable<Uint8Array> {
  const limits = mergePdfLimits(options.limits);
  const chunkSize = normalizeChunkSize(options.chunkSize);
  throwIfAborted(options.signal);
  enforceFilterCount(filters.length);
  if (decodeParameters.length !== filters.length) {
    throw new PdfError("invalid-object", "A decoded filter chain has mismatched DecodeParms arity.", {
      details: { filterCount: filters.length, decodeParameterCount: decodeParameters.length }
    });
  }

  const params = decodeParameters[0] ?? null;
  const streamsDirectly =
    filters.length === 1 &&
    normalizeFilterName(filters[0]) === "FlateDecode" &&
    integerEntry(params, "Predictor", 1) === 1;
  if (streamsDirectly) {
    for await (const chunk of decodeFlateChunks(
      input,
      limits.maxDecodedStreamBytes,
      chunkSize,
      options.signal
    )) {
      yield chunk;
    }
    return;
  }

  const decoded = await decodePdfFilterChain(input, filters, decodeParameters, {
    limits,
    signal: options.signal
  });
  for (let offset = 0; offset < decoded.length; offset += chunkSize) {
    throwIfAborted(options.signal);
    yield decoded.subarray(offset, Math.min(decoded.length, offset + chunkSize));
  }
  throwIfAborted(options.signal);
}

export function readFilterNames(value: PdfValue | undefined): string[] {
  if (value === undefined || value === null) return [];
  if (isPdfName(value)) return [value.value];
  if (Array.isArray(value)) {
    enforceFilterCount(value.length);
    return value.map((entry) => {
      if (!isPdfName(entry)) {
        throw new PdfError("invalid-object", "A stream Filter array contains a non-name value.");
      }
      return entry.value;
    });
  }
  throw new PdfError("invalid-object", "A stream Filter entry is not a name or array.");
}

export function readDecodeParameters(
  value: PdfValue | undefined,
  filterCount: number
): (PdfDictionary | null)[] {
  if (!Number.isSafeInteger(filterCount) || filterCount < 0) {
    throw new RangeError("Filter count must be a nonnegative safe integer.");
  }
  enforceFilterCount(filterCount);
  const output = Array.from<PdfDictionary | null>({ length: filterCount }).fill(null);
  if (value === undefined || value === null) return output;
  if (isPdfDictionary(value)) {
    if (filterCount !== 1) {
      throw new PdfError(
        "invalid-object",
        "A dictionary DecodeParms value requires exactly one stream filter."
      );
    }
    output[0] = value;
    return output;
  }
  if (!Array.isArray(value)) {
    throw new PdfError("invalid-object", "A stream DecodeParms entry is not a dictionary or array.");
  }
  if (value.length !== filterCount) {
    throw new PdfError("invalid-object", "A stream DecodeParms array must match its Filter array length.");
  }
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (entry !== null && !isPdfDictionary(entry)) {
      throw new PdfError("invalid-object", "A stream DecodeParms array contains an invalid value.");
    }
    output[index] = entry;
  }
  return output;
}

async function decodeFlate(
  input: Uint8Array,
  limit: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const wrapper = classifyFlateWrapper(input);
  if (wrapper === "zlib") {
    return (await inflateWithPlatformStream([input], "deflate", limit, signal, true)).bytes!;
  }
  const decoded = (await inflateWithPlatformStream(
    [input],
    "deflate-raw",
    limit,
    signal,
    true
  )).bytes!;
  // DecompressionStream implementations commonly accept bytes after the raw
  // DEFLATE end marker. Feed a zlib header, the original raw view, and a checked
  // Adler-32 trailer as separate chunks. The strict zlib decoder then proves
  // that the raw payload was consumed exactly without copying the compressed
  // payload into a second contiguous allocation.
  const checkedWrapper = rawDeflateValidationChunks(input, adler32(decoded, signal));
  const validation = await inflateWithPlatformStream(
    checkedWrapper,
    "deflate",
    limit,
    signal,
    false
  );
  if (validation.length !== decoded.length) {
    throw new PdfError("invalid-object", "Raw FlateDecode validation length mismatch.");
  }
  return decoded;
}

async function* decodeFlateChunks(
  input: Uint8Array,
  limit: number,
  chunkSize: number,
  signal?: AbortSignal
): AsyncIterable<Uint8Array> {
  const wrapper = classifyFlateWrapper(input);
  const inflateState: PlatformInflateState = { length: 0 };
  const checksum = wrapper === "raw" ? createAdler32State() : null;
  for await (const platformChunk of inflatePlatformChunks(
    [input],
    wrapper === "zlib" ? "deflate" : "deflate-raw",
    limit,
    signal,
    inflateState
  )) {
    if (checksum) updateAdler32(checksum, platformChunk, signal);
    for (let offset = 0; offset < platformChunk.length; offset += chunkSize) {
      throwIfAborted(signal);
      yield platformChunk.subarray(
        offset,
        Math.min(platformChunk.length, offset + chunkSize)
      );
    }
  }

  if (!checksum) return;
  const validation = await inflateWithPlatformStream(
    rawDeflateValidationChunks(input, finishAdler32(checksum)),
    "deflate",
    limit,
    signal,
    false
  );
  if (validation.length !== inflateState.length) {
    throw new PdfError("invalid-object", "Raw FlateDecode validation length mismatch.");
  }
}

/**
 * True when `inputs` end with a single EOL marker whose removal yields a
 * stream that decodes to exactly `producedLength` bytes. Nothing else is
 * trimmed: NUL, spaces, tabs and repeated markers stay decode failures.
 */
async function decodesIdenticallyWithoutEolMarker(
  inputs: readonly Uint8Array[],
  format: "deflate" | "deflate-raw",
  limit: number,
  signal: AbortSignal | undefined,
  producedLength: number
): Promise<boolean> {
  const trimmed = withoutTrailingEolMarker(inputs);
  if (!trimmed) return false;
  const state: PlatformInflateState = { length: 0 };
  try {
    for await (const chunk of inflatePlatformChunks(trimmed, format, limit, signal, state, false)) {
      void chunk;
    }
  } catch {
    return false;
  }
  return state.length === producedLength;
}

/** The trailing CR, LF, or CRLF removed, or null when there is no marker. */
function withoutTrailingEolMarker(
  inputs: readonly Uint8Array[]
): readonly Uint8Array[] | null {
  let lastIndex = inputs.length - 1;
  while (lastIndex >= 0 && inputs[lastIndex].length === 0) lastIndex -= 1;
  if (lastIndex < 0) return null;
  const last = inputs[lastIndex];
  let end = last.length;
  if (last[end - 1] === 0x0a) end -= 1;
  if (end > 0 && last[end - 1] === 0x0d) end -= 1;
  if (end === last.length || end === 0) return null;
  return [...inputs.slice(0, lastIndex), last.subarray(0, end)];
}

function classifyFlateWrapper(input: Uint8Array): "zlib" | "raw" {
  if (input.length === 0) throw new PdfError("invalid-object", "FlateDecode stream is empty.");
  const cmf = input[0];
  const looksLikeZlib = (cmf & 0x0f) === 8 && (cmf >>> 4) <= 7;
  if (!looksLikeZlib) return "raw";
  // A plausible zlib CMF commits the stream to zlib framing. Do not silently
  // reinterpret a damaged FCHECK/header as raw DEFLATE based on decoder luck.
  if (input.length < 2 || ((cmf << 8) | input[1]) % 31 !== 0) {
    throw new PdfError("invalid-object", "Malformed FlateDecode zlib header.");
  }
  if (input[1] & 0x20) {
    throw new PdfError("unsupported-filter", "FlateDecode preset dictionaries are not supported.", {
      details: { reason: "flate-preset-dictionary" }
    });
  }
  if (input.length < 6) throw new PdfError("invalid-object", "Truncated FlateDecode zlib stream.");
  return "zlib";
}

async function inflateWithPlatformStream(
  inputs: readonly Uint8Array[],
  format: "deflate" | "deflate-raw",
  limit: number,
  signal: AbortSignal | undefined,
  collect: boolean
): Promise<{ readonly bytes?: Uint8Array; readonly length: number }> {
  const state: PlatformInflateState = { length: 0 };
  const writer = collect ? new BoundedByteWriter(limit) : null;
  for await (const chunk of inflatePlatformChunks(
    inputs,
    format,
    limit,
    signal,
    state
  )) {
    writer?.append(chunk);
  }
  return collect
    ? { bytes: writer!.finish(), length: state.length }
    : { length: state.length };
}

interface PlatformInflateState {
  length: number;
}

async function* inflatePlatformChunks(
  inputs: readonly Uint8Array[],
  format: "deflate" | "deflate-raw",
  limit: number,
  signal: AbortSignal | undefined,
  state: PlatformInflateState,
  recoverEolMarker = true
): AsyncIterable<Uint8Array> {
  if (typeof DecompressionStream !== "function") {
    throw new PdfError("unsupported-filter", "FlateDecode requires DecompressionStream support.");
  }
  let stream: ReadableStream<Uint8Array<ArrayBuffer>>;
  try {
    const chunks = inputs.map(toPlatformChunk);
    const source = new ReadableStream<BufferSource>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      }
    });
    stream = source.pipeThrough(new DecompressionStream(format));
  } catch (cause) {
    if (cause instanceof PdfError) throw cause;
    throw new PdfError(
      format === "deflate-raw" ? "unsupported-filter" : "invalid-object",
      `Unable to initialize ${format === "deflate-raw" ? "raw " : ""}FlateDecode.`,
      { cause, details: { format } }
    );
  }
  const reader = stream.getReader();
  state.length = 0;
  let completed = false;
  const cancelForAbort = (): void => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.addEventListener("abort", cancelForAbort, { once: true });
  try {
    while (true) {
      throwIfAborted(signal);
      const { value, done } = await reader.read();
      if (done) break;
      state.length = checkedAdd(state.length, value.length, "FlateDecode output length");
      enforceLimit(state.length, limit);
      yield value;
    }
    throwIfAborted(signal);
    completed = true;
  } catch (cause) {
    await reader.cancel().catch(() => undefined);
    if (cause instanceof PdfError) throw cause;
    if (signal?.aborted) throwIfAborted(signal);
    // PDF 32000-1 7.3.8.1 places an EOL marker after the stream data and keeps
    // it out of /Length. Producers that count it leave a stray CR, LF, or CRLF
    // that platform decoders reject as trailing junk, discarding a payload that
    // was already complete. Accept that marker, but only after re-decoding
    // without it proves the same byte count: a truncated stream cannot be
    // rescued this way, and any other trailing byte remains an error.
    if (
      recoverEolMarker &&
      await decodesIdenticallyWithoutEolMarker(inputs, format, limit, signal, state.length)
    ) {
      completed = true;
      return;
    }
    throw new PdfError("invalid-object", "Malformed FlateDecode stream.", { cause });
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => undefined);
    }
    signal?.removeEventListener("abort", cancelForAbort);
    reader.releaseLock();
  }
}

function rawDeflateValidationChunks(
  input: Uint8Array,
  checksum: number
): readonly Uint8Array[] {
  checkedAdd(input.length, 6, "raw Flate validation wrapper length");
  // 0x7801 advertises DEFLATE with a 32 KiB window and no preset dictionary.
  return [
    Uint8Array.of(0x78, 0x01),
    input,
    Uint8Array.of(checksum >>> 24, checksum >>> 16, checksum >>> 8, checksum)
  ];
}

function toPlatformChunk(input: Uint8Array): Uint8Array<ArrayBuffer> {
  return input.buffer instanceof ArrayBuffer
    ? input as Uint8Array<ArrayBuffer>
    : copyBytes(input, "FlateDecode shared-buffer input");
}

interface Adler32State {
  first: number;
  second: number;
}

function createAdler32State(): Adler32State {
  return { first: 1, second: 0 };
}

function updateAdler32(
  state: Adler32State,
  bytes: Uint8Array,
  signal?: AbortSignal
): void {
  // RFC 1950's 5552-byte block bound keeps both sums exactly representable and
  // avoids two remainder operations per decoded byte on the raw compatibility
  // path.
  for (let offset = 0; offset < bytes.length;) {
    throwIfAborted(signal);
    const end = Math.min(bytes.length, offset + 5552);
    for (; offset < end; offset += 1) {
      state.first += bytes[offset];
      state.second += state.first;
    }
    state.first %= 65521;
    state.second %= 65521;
  }
}

function finishAdler32(state: Adler32State): number {
  return ((state.second << 16) | state.first) >>> 0;
}

function adler32(bytes: Uint8Array, signal?: AbortSignal): number {
  const state = createAdler32State();
  updateAdler32(state, bytes, signal);
  return finishAdler32(state);
}

function decodeLzw(
  input: Uint8Array,
  earlyChange: number,
  limit: number,
  signal?: AbortSignal
): Uint8Array {
  if (earlyChange !== 0 && earlyChange !== 1) {
    throw new PdfError("invalid-object", "LZW EarlyChange must be 0 or 1.");
  }
  const reader = new MsbBitReader(input);
  const dictionary: Array<Uint8Array | undefined> = Array.from({ length: 4096 });
  for (let index = 0; index < 256; index += 1) dictionary[index] = Uint8Array.of(index);
  let codeWidth = 9;
  let nextCode = 258;
  let previous: Uint8Array | null = null;
  let tableFull = false;
  const output = new BoundedByteWriter(limit);
  let codeCount = 0;
  while (true) {
    if ((codeCount++ & 0x0fff) === 0) throwIfAborted(signal);
    const code = reader.read(codeWidth);
    if (code === undefined) {
      throw new PdfError("invalid-object", "Truncated LZWDecode stream without an EOD code.");
    }
    if (code === 256) {
      // Only dynamic entries can be stale. Clearing the populated suffix keeps
      // an adversarial run of clear-table codes O(number of input codes).
      dictionary.fill(undefined, 258, nextCode);
      codeWidth = 9;
      nextCode = 258;
      previous = null;
      tableFull = false;
      continue;
    }
    if (code === 257) {
      reader.requireZeroBytePadding();
      break;
    }
    if (tableFull) {
      throw new PdfError("invalid-object", "LZWDecode table was not cleared after becoming full.");
    }
    let current = dictionary[code];
    if (!current && code === nextCode && previous) {
      current = appendByte(previous, previous[0]);
    }
    if (!current) throw new PdfError("invalid-object", "Malformed LZWDecode code sequence.");
    output.append(current);
    if (previous && nextCode < 4096) {
      dictionary[nextCode++] = appendByte(previous, current[0]);
      if (codeWidth < 12 && nextCode + earlyChange === (1 << codeWidth)) codeWidth += 1;
      tableFull = nextCode === 4096;
    }
    previous = current;
  }
  throwIfAborted(signal);
  return output.finish();
}

function decodeAscii85(input: Uint8Array, limit: number, signal?: AbortSignal): Uint8Array {
  const output = new BoundedByteWriter(limit);
  const group: number[] = [];
  let ended = false;
  for (let index = 0; index < input.length; index += 1) {
    if ((index & 0x3fff) === 0) throwIfAborted(signal);
    const byte = input[index];
    if (isWhitespace(byte)) continue;
    if (byte === 0x7e) {
      while (index + 1 < input.length && isWhitespace(input[index + 1])) {
        index += 1;
        if ((index & 0x3fff) === 0) throwIfAborted(signal);
      }
      if (input[++index] !== 0x3e) throw new PdfError("invalid-object", "Malformed ASCII85 terminator.");
      ended = true;
      for (index += 1; index < input.length; index += 1) {
        if ((index & 0x3fff) === 0) throwIfAborted(signal);
        if (!isWhitespace(input[index])) {
          throw new PdfError("invalid-object", "ASCII85 data follows its terminator.");
        }
      }
      break;
    }
    if (byte === 0x7a) {
      if (group.length !== 0) throw new PdfError("invalid-object", "ASCII85 z appears inside a group.");
      output.appendValues(0, 0, 0, 0);
      continue;
    }
    if (byte < 0x21 || byte > 0x75) throw new PdfError("invalid-object", "Invalid ASCII85 character.");
    group.push(byte - 0x21);
    if (group.length === 5) {
      appendAscii85Group(output, group, 4);
      group.length = 0;
    }
  }
  if (!ended) throw new PdfError("invalid-object", "ASCII85 stream has no ~> terminator.");
  if (group.length === 1) throw new PdfError("invalid-object", "Invalid final ASCII85 group.");
  if (group.length > 1) {
    const byteCount = group.length - 1;
    while (group.length < 5) group.push(84);
    appendAscii85Group(output, group, byteCount);
  }
  throwIfAborted(signal);
  return output.finish();
}

function appendAscii85Group(
  output: BoundedByteWriter,
  group: readonly number[],
  byteCount: number
): void {
  let value = 0;
  for (const digit of group) value = value * 85 + digit;
  if (value > 0xffff_ffff) throw new PdfError("invalid-object", "ASCII85 group overflows 32 bits.");
  for (let shift = 24, count = 0; count < byteCount; shift -= 8, count += 1) {
    output.appendByte((value >>> shift) & 0xff);
  }
}

function decodeAsciiHex(input: Uint8Array, limit: number, signal?: AbortSignal): Uint8Array {
  const output = new BoundedByteWriter(limit);
  let high = -1;
  let ended = false;
  for (let index = 0; index < input.length; index += 1) {
    if ((index & 0x3fff) === 0) throwIfAborted(signal);
    const byte = input[index];
    if (isWhitespace(byte)) continue;
    if (byte === 0x3e) {
      ended = true;
      for (index += 1; index < input.length; index += 1) {
        if ((index & 0x3fff) === 0) throwIfAborted(signal);
        if (!isWhitespace(input[index])) {
          throw new PdfError("invalid-object", "ASCIIHex data follows its terminator.");
        }
      }
      break;
    }
    const digit = hexDigit(byte);
    if (digit < 0) throw new PdfError("invalid-object", "Invalid ASCIIHex character.");
    if (high < 0) high = digit;
    else {
      output.appendByte((high << 4) | digit);
      high = -1;
    }
  }
  if (!ended) throw new PdfError("invalid-object", "ASCIIHex stream has no > terminator.");
  if (high >= 0) output.appendByte(high << 4);
  throwIfAborted(signal);
  return output.finish();
}

function decodeRunLength(input: Uint8Array, limit: number, signal?: AbortSignal): Uint8Array {
  const output = new BoundedByteWriter(limit);
  let offset = 0;
  let ended = false;
  while (offset < input.length) {
    if ((offset & 0x3fff) === 0) throwIfAborted(signal);
    const lengthByte = input[offset++];
    if (lengthByte === 128) {
      ended = true;
      if (offset !== input.length) {
        throw new PdfError("invalid-object", "RunLengthDecode data follows its EOD marker.");
      }
      break;
    }
    if (lengthByte <= 127) {
      const count = lengthByte + 1;
      if (offset + count > input.length) throw new PdfError("invalid-object", "Truncated RunLengthDecode literal.");
      output.append(input.subarray(offset, offset + count));
      offset += count;
    } else {
      if (offset >= input.length) throw new PdfError("invalid-object", "Truncated RunLengthDecode repeat.");
      const count = 257 - lengthByte;
      output.appendRepeated(input[offset++], count);
    }
  }
  if (!ended) throw new PdfError("invalid-object", "RunLengthDecode stream has no EOD marker.");
  throwIfAborted(signal);
  return output.finish();
}

function applyPredictor(
  input: Uint8Array,
  params: PdfDictionary | null,
  limit: number,
  signal?: AbortSignal
): Uint8Array {
  throwIfAborted(signal);
  const predictor = integerEntry(params, "Predictor", 1);
  if (predictor === 1) return input;
  const colors = integerEntry(params, "Colors", 1);
  const bits = integerEntry(params, "BitsPerComponent", 8);
  const columns = integerEntry(params, "Columns", 1);
  if (colors <= 0 || columns <= 0 || ![1, 2, 4, 8, 16].includes(bits)) {
    throw new PdfError("invalid-object", "Invalid stream predictor parameters.");
  }
  const samplesPerRow = checkedMultiply(colors, columns, "predictor samples per row");
  const rowBits = checkedMultiply(samplesPerRow, bits, "predictor bits per row");
  const rowBytes = Math.ceil(rowBits / 8);
  if (!Number.isSafeInteger(rowBytes) || rowBytes <= 0 || rowBytes > limit) {
    throw new PdfError("resource-limit", "Predictor row size exceeds supported limits.");
  }
  if (predictor === 2) {
    return decodeTiffPredictor(
      input,
      colors,
      bits,
      samplesPerRow,
      rowBytes,
      limit,
      signal
    );
  }
  if (predictor >= 10 && predictor <= 15) {
    return decodePngPredictor(input, colors, bits, rowBytes, limit, signal);
  }
  throw new PdfError("unsupported-filter", `Unsupported PDF predictor ${predictor}.`, {
    details: { predictor }
  });
}

function decodeTiffPredictor(
  input: Uint8Array,
  colors: number,
  bits: number,
  samplesPerRow: number,
  rowBytes: number,
  limit: number,
  signal?: AbortSignal
): Uint8Array {
  if (input.length % rowBytes !== 0) throw new PdfError("invalid-object", "Truncated TIFF predictor row.");
  enforceLimit(input.length, limit);
  const output = copyBytes(input, "TIFF predictor output");
  const mask = 2 ** bits - 1;
  for (let rowOffset = 0; rowOffset < output.length; rowOffset += rowBytes) {
    throwIfAborted(signal);
    for (let sample = colors; sample < samplesPerRow; sample += 1) {
      if ((sample & 0x3fff) === 0) throwIfAborted(signal);
      const encoded = readPackedSample(output, rowOffset, sample, bits);
      const left = readPackedSample(output, rowOffset, sample - colors, bits);
      writePackedSample(output, rowOffset, sample, bits, (encoded + left) & mask);
    }
  }
  return output;
}

function decodePngPredictor(
  input: Uint8Array,
  colors: number,
  bits: number,
  rowBytes: number,
  limit: number,
  signal?: AbortSignal
): Uint8Array {
  // ISO 32000 PNG prediction stores a filter tag byte at the start of every
  // row for every predictor value 10..15 (not only optimum predictor 15).
  const encodedRowBytes = checkedAdd(rowBytes, 1, "PNG predictor encoded row size");
  if (input.length % encodedRowBytes !== 0) throw new PdfError("invalid-object", "Truncated PNG predictor row.");
  const rows = input.length / encodedRowBytes;
  const outputLength = checkedMultiply(rows, rowBytes, "PNG predictor output length");
  enforceLimit(outputLength, limit);
  const output = allocateBytes(outputLength, "PNG predictor output");
  const bytesPerPixel = Math.max(1, Math.ceil(colors * bits / 8));
  let inputOffset = 0;
  for (let row = 0; row < rows; row += 1) {
    throwIfAborted(signal);
    const filter = input[inputOffset++];
    if (filter > 4) throw new PdfError("invalid-object", "Invalid PNG predictor filter byte.");
    const rowOffset = row * rowBytes;
    for (let column = 0; column < rowBytes; column += 1) {
      if ((column & 0x3fff) === 0) throwIfAborted(signal);
      const encoded = input[inputOffset++];
      const left = column >= bytesPerPixel ? output[rowOffset + column - bytesPerPixel] : 0;
      const up = row > 0 ? output[rowOffset - rowBytes + column] : 0;
      const upLeft = row > 0 && column >= bytesPerPixel
        ? output[rowOffset - rowBytes + column - bytesPerPixel]
        : 0;
      const prediction = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up
        : filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, upLeft);
      output[rowOffset + column] = (encoded + prediction) & 0xff;
    }
  }
  return output;
}

function integerEntry(dictionary: PdfDictionary | null, key: string, fallback: number): number {
  const value = dictionary?.get(key);
  if (value === undefined || value === null) return fallback;
  if (!Number.isSafeInteger(value)) {
    throw new PdfError("invalid-object", `Filter parameter /${key} is not an integer.`);
  }
  return value as number;
}

function normalizeFilterName(name: string): string {
  return name === "Fl" ? "FlateDecode" : name === "LZW" ? "LZWDecode"
    : name === "A85" ? "ASCII85Decode" : name === "AHx" ? "ASCIIHexDecode"
      : name === "RL" ? "RunLengthDecode" : name;
}

function normalizeChunkSize(value: number | undefined): number {
  if (value === undefined) return DEFAULT_DECODED_CHUNK_SIZE;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError("Decoded PDF chunk size must be a positive safe integer.");
  }
  return value;
}

function enforceFilterCount(count: number): void {
  if (count > MAX_FILTER_CHAIN_LENGTH) {
    throw new PdfError("resource-limit", "A PDF stream filter chain exceeds its depth limit.", {
      details: { filterCount: count, limit: MAX_FILTER_CHAIN_LENGTH }
    });
  }
}

function enforceLimit(length: number, limit: number): void {
  if (!Number.isSafeInteger(length) || length < 0 || length > limit) {
    throw new PdfError("resource-limit", "A decoded PDF stream exceeds the configured byte limit.", {
      details: { decodedBytes: length, limit }
    });
  }
}

function appendByte(bytes: Uint8Array, byte: number): Uint8Array {
  const output = allocateBytes(
    checkedAdd(bytes.length, 1, "LZW dictionary entry"),
    "LZW dictionary entry"
  );
  output.set(bytes);
  output[bytes.length] = byte;
  return output;
}

/**
 * Incrementally accumulates one decoded filter stage without allocating past
 * that stage's decoded-stream ceiling. The geometric buffer is private;
 * finish() returns only initialized bytes and never exposes spare capacity.
 */
class BoundedByteWriter {
  private buffer: Uint8Array = new Uint8Array(0);
  private lengthValue = 0;
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
    enforceLimit(0, limit);
  }

  appendByte(value: number): void {
    const offset = this.reserve(1);
    this.buffer[offset] = value & 0xff;
  }

  appendValues(...values: readonly number[]): void {
    const offset = this.reserve(values.length);
    for (let index = 0; index < values.length; index += 1) {
      this.buffer[offset + index] = values[index] & 0xff;
    }
  }

  append(bytes: Uint8Array): void {
    const offset = this.reserve(bytes.length);
    this.buffer.set(bytes, offset);
  }

  appendRepeated(value: number, count: number): void {
    const offset = this.reserve(count);
    this.buffer.fill(value & 0xff, offset, offset + count);
  }

  finish(): Uint8Array {
    if (this.lengthValue === this.buffer.length) return this.buffer;
    const output = allocateBytes(this.lengthValue, "decoded filter output");
    output.set(this.buffer.subarray(0, this.lengthValue));
    return output;
  }

  private reserve(additional: number): number {
    const required = checkedAdd(this.lengthValue, additional, "decoded filter output length");
    enforceLimit(required, this.limit);
    this.ensureCapacity(required);
    const offset = this.lengthValue;
    this.lengthValue = required;
    return offset;
  }

  private ensureCapacity(required: number): void {
    if (required <= this.buffer.length) return;
    let capacity = this.buffer.length === 0 ? Math.min(1024, this.limit) : this.buffer.length;
    while (capacity < required) {
      const doubled = checkedMultiply(capacity, 2, "decoded filter buffer capacity");
      capacity = Math.min(this.limit, Math.max(required, doubled));
    }
    const replacement = allocateBytes(capacity, "decoded filter output buffer");
    replacement.set(this.buffer.subarray(0, this.lengthValue));
    this.buffer = replacement;
  }
}

function checkedAdd(left: number, right: number, label: string): number {
  if (!Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0) {
    throw arithmeticLimit(label, left, right);
  }
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw arithmeticLimit(label, left, right);
  return result;
}

function checkedMultiply(left: number, right: number, label: string): number {
  if (!Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0) {
    throw arithmeticLimit(label, left, right);
  }
  const result = left * right;
  if (!Number.isSafeInteger(result)) throw arithmeticLimit(label, left, right);
  return result;
}

function arithmeticLimit(label: string, left: number, right: number): PdfError {
  return new PdfError("resource-limit", `${label} exceeds safe allocation arithmetic.`, {
    details: {
      reason: "filter-checked-arithmetic",
      left: Number.isFinite(left) ? left : String(left),
      right: Number.isFinite(right) ? right : String(right)
    }
  });
}

function allocateBytes(length: number, label: string): Uint8Array<ArrayBuffer> {
  if (!Number.isSafeInteger(length) || length < 0) throw arithmeticLimit(label, length, 0);
  try {
    return new Uint8Array(length);
  } catch (cause) {
    throw new PdfError("resource-limit", `Unable to allocate ${label}.`, {
      cause,
      details: { reason: "filter-allocation", bytes: length }
    });
  }
}

function copyBytes(bytes: Uint8Array, label: string): Uint8Array<ArrayBuffer> {
  const output = allocateBytes(bytes.length, label);
  output.set(bytes);
  return output;
}

class MsbBitReader {
  private bitOffset = 0;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  read(width: number): number | undefined {
    if (this.bitOffset + width > this.bytes.length * 8) return undefined;
    let value = 0;
    for (let bit = 0; bit < width; bit += 1) {
      const absolute = this.bitOffset++;
      value = (value << 1) | ((this.bytes[absolute >>> 3] >>> (7 - (absolute & 7))) & 1);
    }
    return value;
  }

  requireZeroBytePadding(): void {
    const totalBits = this.bytes.length * 8;
    const remainingBits = totalBits - this.bitOffset;
    if (remainingBits > 7) {
      throw new PdfError("invalid-object", "LZWDecode data follows its EOD code.");
    }
    while (this.bitOffset < totalBits) {
      const absolute = this.bitOffset++;
      if (((this.bytes[absolute >>> 3] >>> (7 - (absolute & 7))) & 1) !== 0) {
        throw new PdfError("invalid-object", "LZWDecode has nonzero padding after its EOD code.");
      }
    }
  }
}

function readPackedSample(bytes: Uint8Array, rowOffset: number, sample: number, bits: number): number {
  let value = 0;
  const startBit = sample * bits;
  for (let bit = 0; bit < bits; bit += 1) {
    const position = startBit + bit;
    value = (value << 1) | ((bytes[rowOffset + (position >>> 3)] >>> (7 - (position & 7))) & 1);
  }
  return value;
}

function writePackedSample(
  bytes: Uint8Array,
  rowOffset: number,
  sample: number,
  bits: number,
  value: number
): void {
  const startBit = sample * bits;
  for (let bit = 0; bit < bits; bit += 1) {
    const position = startBit + bit;
    const byteOffset = rowOffset + (position >>> 3);
    const mask = 1 << (7 - (position & 7));
    const sourceMask = 1 << (bits - bit - 1);
    bytes[byteOffset] = value & sourceMask ? bytes[byteOffset] | mask : bytes[byteOffset] & ~mask;
  }
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const diagonalDistance = Math.abs(estimate - upLeft);
  return leftDistance <= upDistance && leftDistance <= diagonalDistance ? left
    : upDistance <= diagonalDistance ? up : upLeft;
}

function isWhitespace(byte: number): boolean {
  return byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
}

function hexDigit(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return -1;
}
