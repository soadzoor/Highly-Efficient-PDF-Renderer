import {
  PdfError,
  type PdfDiagnostic,
  type PdfResourceLimits,
  type PdfSource,
  mergePdfLimits,
  throwIfAborted
} from "./nativeTypes";

export const PDF_SOURCE_BLOCK_BYTES = 64 * 1024;
const MAX_COALESCED_SOURCE_BLOCKS = 16;

/**
 * One-shot marker for byte sources whose backing store is already exclusively
 * owned by HEPR's worker. Keeping this out of `PdfSource` is intentional: the
 * public API continues to offer only copy-or-transfer ownership, while the
 * worker can avoid copying bytes which were transferred to it one hop earlier.
 */
const borrowedMemorySources = new WeakSet<object>();

/**
 * Create an internal, one-shot byte source which the parser may retain without
 * copying or detaching it.
 *
 * The caller must own the backing `ArrayBuffer` exclusively and must not mutate
 * it until the resulting reader/document is closed. The parser treats the
 * bytes as immutable and never writes to them. Reusing the returned source for
 * a second reader falls back to the public copy semantics.
 *
 * @internal
 */
export function createInternalBorrowedPdfByteSource(
  bytes: Uint8Array,
  label?: string
): Extract<PdfSource, { kind: "bytes" }> {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("Borrowed PDF bytes must be a Uint8Array.");
  }
  if (!(bytes.buffer instanceof ArrayBuffer)) {
    throw new TypeError("Borrowed PDF bytes require an exclusively owned ArrayBuffer.");
  }
  const source: Extract<PdfSource, { kind: "bytes" }> = Object.freeze({
    kind: "bytes",
    bytes,
    ownership: "copy",
    ...(label === undefined ? {} : { label })
  });
  borrowedMemorySources.add(source);
  return source;
}

/** Exact, bounded random access used by the parser and worker range protocol. */
export interface PdfRandomAccessReader {
  readonly byteLength: number;
  readonly label?: string;
  /** Returned bytes are immutable parser input and must not be modified. */
  read(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array>;
  close(): Promise<void>;
}

interface PdfUncachedReader {
  readonly byteLength: number;
  readonly label?: string;
  /**
   * The backend owns one stable immutable buffer, so cached blocks and read
   * results may safely retain views into it. Deliberately absent for range,
   * Blob, and URL sources: those can return a small view backed by a much
   * larger allocation that the bounded cache must not retain.
   */
  readonly stableReadViews?: boolean;
  read(offset: number, length: number, signal: AbortSignal): Promise<Uint8Array>;
  close(): Promise<void>;
  assertReadable?(): void;
}

export interface CreatePdfReaderOptions {
  readonly limits?: Partial<PdfResourceLimits>;
  readonly signal?: AbortSignal;
  readonly onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
}

export async function createPdfRandomAccessReader(
  source: PdfSource,
  options: CreatePdfReaderOptions = {}
): Promise<PdfRandomAccessReader> {
  throwIfAborted(options.signal);
  const limits = mergePdfLimits(options.limits);
  const sourceSignal = source.kind === "url" ? optionsSignal(source.request?.signal) : undefined;
  let backend: PdfUncachedReader;
  switch (source.kind) {
    case "bytes":
      backend = new MemoryReader(
        acquireMemorySourceBytes(source),
        source.label
      );
      break;
    case "blob":
      backend = new BlobReader(source.blob, source.label);
      break;
    case "range":
      backend = new CallbackReader(source);
      break;
    case "url":
      // A non-range HTTP fallback is a whole-source allocation. Reuse the
      // existing configurable whole-source scan ceiling rather than allowing
      // an unknown-length response to grow without bound.
      backend = await HttpReader.open(
        source,
        limits.maxRepairScanBytes,
        options.signal,
        options.onDiagnostic
      );
      break;
  }
  if (options.signal?.aborted) {
    await backend.close();
    throwIfAborted(options.signal);
  }
  return new CachedReader(backend, limits.maxSourceCacheBytes, sourceSignal);
}

function acquireMemorySourceBytes(
  source: Extract<PdfSource, { kind: "bytes" }>
): Uint8Array {
  // Consume the marker before returning the view so one internal source cannot
  // create multiple readers which all assume exclusive ownership.
  if (borrowedMemorySources.delete(source)) return source.bytes;
  if (source.ownership !== "transfer") return copyMemorySourceBytes(source.bytes);

  const buffer = source.bytes.buffer;
  if (!(buffer instanceof ArrayBuffer)) {
    // SharedArrayBuffer cannot be transferred. Isolate it so later writes by
    // the caller cannot change parser input after ownership was relinquished.
    return copyMemorySourceBytes(source.bytes);
  }
  try {
    return structuredClone(source.bytes, { transfer: [buffer] });
  } catch (cause) {
    // Node marks pooled Buffer slabs as non-transferable. Buffer.slice() is a
    // shared view, so always make an explicit Uint8Array copy for this case.
    if (isDataCloneError(cause) && buffer.byteLength > 0) {
      return copyMemorySourceBytes(source.bytes);
    }
    throw new PdfError("source-read", "Unable to transfer ownership of the PDF bytes.", {
      cause
    });
  }
}

function copyMemorySourceBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function isDataCloneError(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "name" in error && error.name === "DataCloneError";
}

class MemoryReader implements PdfUncachedReader {
  readonly byteLength: number;
  readonly label?: string;
  readonly stableReadViews = true;
  private bytes: Uint8Array | null;

  constructor(bytes: Uint8Array, label?: string) {
    this.bytes = bytes;
    this.byteLength = bytes.length;
    this.label = label;
  }

  async read(offset: number, length: number, signal: AbortSignal): Promise<Uint8Array> {
    throwIfAborted(signal);
    const bytes = this.bytes;
    if (!bytes) throw new PdfError("closed", "The PDF source is closed.");
    // Byte sources have already been copied or transferred into parser
    // ownership. Let the block cache retain zero-copy views instead of making
    // a second 64 KiB copy for every memory-backed source read.
    return bytes.subarray(offset, offset + length);
  }

  async close(): Promise<void> {
    this.bytes = null;
  }
}

class BlobReader implements PdfUncachedReader {
  readonly byteLength: number;
  readonly label?: string;
  private readonly blob: Blob;
  private closed = false;

  constructor(blob: Blob, label?: string) {
    this.blob = blob;
    validateByteLength(blob.size);
    this.byteLength = blob.size;
    this.label = label;
  }

  async read(offset: number, length: number, signal: AbortSignal): Promise<Uint8Array> {
    throwIfAborted(signal);
    if (this.closed) throw new PdfError("closed", "The PDF source is closed.");
    const promise = this.blob.slice(offset, offset + length).arrayBuffer().then(
      (buffer) => new Uint8Array(buffer)
    );
    const bytes = await awaitWithSignal(promise, signal);
    if (this.closed) throw new PdfError("closed", "The PDF source is closed.");
    throwIfAborted(signal);
    return bytes;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class CallbackReader implements PdfUncachedReader {
  readonly byteLength: number;
  readonly label?: string;
  private readonly source: Extract<PdfSource, { kind: "range" }>;
  private closed = false;

  constructor(source: Extract<PdfSource, { kind: "range" }>) {
    this.source = source;
    validateByteLength(source.byteLength);
    this.byteLength = source.byteLength;
    this.label = source.label;
  }

  async read(offset: number, length: number, signal: AbortSignal): Promise<Uint8Array> {
    throwIfAborted(signal);
    if (this.closed) throw new PdfError("closed", "The PDF source is closed.");
    let bytes: Uint8Array;
    try {
      bytes = await this.source.read(offset, length, signal);
    } catch (cause) {
      if (signal.aborted) throw new PdfError("aborted", "The PDF range read was aborted.", { cause });
      if (cause instanceof PdfError) throw cause;
      throw new PdfError("source-read", "The PDF range source failed.", { cause });
    }
    if (this.closed) throw new PdfError("closed", "The PDF source is closed.");
    throwIfAborted(signal);
    if (!(bytes instanceof Uint8Array) || bytes.length !== length) {
      throw new PdfError("source-read", "The PDF range source returned an unexpected byte count.", {
        details: { offset, requestedLength: length, receivedLength: bytes?.length ?? -1 }
      });
    }
    return bytes;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.source.close?.();
  }
}

class CachedReader implements PdfRandomAccessReader {
  readonly byteLength: number;
  readonly label?: string;
  private readonly maxCacheBytes: number;
  private readonly cache = new Map<number, Uint8Array>();
  private readonly pending = new Map<number, Promise<Uint8Array>>();
  private readonly lifetime = new AbortController();
  private readonly backend: PdfUncachedReader;
  private readonly sourceSignal?: AbortSignal;
  private cachedBytes = 0;
  private closed = false;

  constructor(backend: PdfUncachedReader, maxCacheBytes: number, sourceSignal?: AbortSignal) {
    this.backend = backend;
    this.byteLength = backend.byteLength;
    this.label = backend.label;
    this.maxCacheBytes = maxCacheBytes;
    this.sourceSignal = sourceSignal;
  }

  async read(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
    validateRange(offset, length, this.byteLength);
    throwIfAborted(signal);
    throwIfAborted(this.sourceSignal);
    if (this.closed) throw new PdfError("closed", "The PDF source is closed.");
    this.assertBackendReadable();
    if (length === 0) return new Uint8Array();

    const firstBlock = Math.floor(offset / PDF_SOURCE_BLOCK_BYTES);
    const lastBlock = Math.floor((offset + length - 1) / PDF_SOURCE_BLOCK_BYTES);
    this.primeMissingBlocks(firstBlock, lastBlock);
    const promises: Promise<Uint8Array>[] = [];
    for (let block = firstBlock; block <= lastBlock; block += 1) {
      promises.push(this.getBlock(block));
    }
    let blocks: Uint8Array[];
    try {
      blocks = await awaitWithSignals(
        Promise.all(promises),
        signal,
        this.sourceSignal,
        this.lifetime.signal
      );
    } catch (cause) {
      if (cause instanceof PdfError && cause.code === "source-changed") this.clearCache();
      if (this.closed) {
        throw new PdfError("closed", "The PDF source is closed.", { cause });
      }
      throw cause;
    }
    if (this.closed) throw new PdfError("closed", "The PDF source is closed.");
    this.assertBackendReadable();
    throwIfAborted(signal);
    throwIfAborted(this.sourceSignal);

    if (blocks.length === 1) {
      const within = offset - firstBlock * PDF_SOURCE_BLOCK_BYTES;
      return this.backend.stableReadViews
        ? blocks[0].subarray(within, within + length)
        : blocks[0].slice(within, within + length);
    }
    if (this.backend.stableReadViews) {
      const view = contiguousReadView(blocks, offset - firstBlock * PDF_SOURCE_BLOCK_BYTES, length);
      if (view) return view;
    }
    const result = new Uint8Array(length);
    let resultOffset = 0;
    for (let index = 0; index < blocks.length; index += 1) {
      const blockNumber = firstBlock + index;
      const blockStart = blockNumber * PDF_SOURCE_BLOCK_BYTES;
      const from = Math.max(offset, blockStart) - blockStart;
      const to = Math.min(offset + length, blockStart + blocks[index].length) - blockStart;
      result.set(blocks[index].subarray(from, to), resultOffset);
      resultOffset += to - from;
    }
    return result;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.lifetime.abort(new PdfError("closed", "The PDF source is closed."));
    this.clearCache();
    this.pending.clear();
    await this.backend.close();
  }

  private getBlock(block: number): Promise<Uint8Array> {
    const cached = this.cache.get(block);
    if (cached) {
      this.cache.delete(block);
      this.cache.set(block, cached);
      return Promise.resolve(cached);
    }
    const existing = this.pending.get(block);
    if (existing) return existing;
    this.primeMissingBlocks(block, block);
    const primed = this.pending.get(block);
    if (primed) return primed;
    throw new PdfError("source-read", "Unable to schedule a PDF source block read.");
  }

  private primeMissingBlocks(firstBlock: number, lastBlock: number): void {
    let block = firstBlock;
    while (block <= lastBlock) {
      if (this.cache.has(block) || this.pending.has(block)) {
        block += 1;
        continue;
      }
      const runStart = block;
      let runEnd = block;
      while (
        runEnd < lastBlock &&
        runEnd - runStart + 1 < MAX_COALESCED_SOURCE_BLOCKS &&
        !this.cache.has(runEnd + 1) && !this.pending.has(runEnd + 1)
      ) runEnd += 1;
      this.scheduleBlockRun(runStart, runEnd);
      block = runEnd + 1;
    }
  }

  private scheduleBlockRun(firstBlock: number, lastBlock: number): void {
    const offset = firstBlock * PDF_SOURCE_BLOCK_BYTES;
    const finalByte = Math.min(this.byteLength, (lastBlock + 1) * PDF_SOURCE_BLOCK_BYTES);
    const length = finalByte - offset;
    const span = this.backend.read(offset, length, this.lifetime.signal).then((bytes) => {
      if (this.closed) throw new PdfError("closed", "The PDF source is closed.");
      if (bytes.length !== length) {
        throw new PdfError("source-read", "The PDF source returned an invalid coalesced block read.", {
          details: { offset, requestedLength: length, receivedLength: bytes.length }
        });
      }
      return bytes;
    }, (cause) => {
      if (this.closed) throw new PdfError("closed", "The PDF source is closed.", { cause });
      throw cause;
    });
    for (let block = firstBlock; block <= lastBlock; block += 1) {
      const blockOffset = block * PDF_SOURCE_BLOCK_BYTES - offset;
      const blockLength = Math.min(PDF_SOURCE_BLOCK_BYTES, this.byteLength - block * PDF_SOURCE_BLOCK_BYTES);
      let promise: Promise<Uint8Array>;
      promise = span.then((bytes) => {
        const blockBytes = this.backend.stableReadViews
          ? bytes.subarray(blockOffset, blockOffset + blockLength)
          : bytes.slice(blockOffset, blockOffset + blockLength);
        if (!this.closed) this.storeBlock(block, blockBytes);
        return blockBytes;
      }).finally(() => {
        if (this.pending.get(block) === promise) this.pending.delete(block);
      });
      this.pending.set(block, promise);
    }
  }

  private storeBlock(block: number, bytes: Uint8Array): void {
    const existing = this.cache.get(block);
    if (existing) {
      this.cachedBytes -= existing.byteLength;
      this.cache.delete(block);
    }
    if (bytes.byteLength > this.maxCacheBytes) return;
    this.cache.set(block, bytes);
    this.cachedBytes += bytes.byteLength;
    while (this.cachedBytes > this.maxCacheBytes) {
      const oldest = this.cache.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      this.cachedBytes -= this.cache.get(oldest)?.byteLength ?? 0;
      this.cache.delete(oldest);
    }
  }

  private assertBackendReadable(): void {
    try {
      this.backend.assertReadable?.();
    } catch (error) {
      if (error instanceof PdfError && error.code === "source-changed") this.clearCache();
      throw error;
    }
  }

  private clearCache(): void {
    this.cache.clear();
    this.cachedBytes = 0;
  }

}

function contiguousReadView(
  blocks: readonly Uint8Array[],
  withinFirstBlock: number,
  length: number
): Uint8Array | undefined {
  const first = blocks[0];
  if (!first || withinFirstBlock < 0 || withinFirstBlock > first.byteLength) return undefined;
  let end = first.byteOffset + first.byteLength;
  for (let index = 1; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.buffer !== first.buffer || block.byteOffset !== end) return undefined;
    end += block.byteLength;
  }
  const byteOffset = first.byteOffset + withinFirstBlock;
  if (byteOffset + length > end) return undefined;
  return new Uint8Array(first.buffer, byteOffset, length);
}

class HttpReader implements PdfUncachedReader {
  readonly label?: string;
  readonly byteLength: number;
  private readonly controller = new AbortController();
  private fullBytes: Uint8Array | null;
  private fullDownload: Promise<Uint8Array> | null = null;
  private closed = false;
  private readonly url: string;
  private readonly request: RequestInit;
  private readonly maxFullDownloadBytes: number;
  private validator: HttpValidator | null;
  private finalUrl: string | null;
  private readonly onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
  private fallbackReported = false;
  private terminalError: PdfError | null = null;

  private constructor(
    url: string,
    request: RequestInit,
    byteLength: number,
    maxFullDownloadBytes: number,
    validator: HttpValidator | null,
    finalUrl: string | null,
    fullBytes: Uint8Array | null,
    label?: string,
    onDiagnostic?: (diagnostic: PdfDiagnostic) => void
  ) {
    this.url = url;
    this.request = request;
    this.maxFullDownloadBytes = maxFullDownloadBytes;
    this.validator = validator;
    this.finalUrl = finalUrl;
    this.byteLength = byteLength;
    this.fullBytes = fullBytes;
    this.label = label;
    this.onDiagnostic = onDiagnostic;
  }

  static async open(
    source: Extract<PdfSource, { kind: "url" }>,
    maxFullDownloadBytes: number,
    signal?: AbortSignal,
    onDiagnostic?: (diagnostic: PdfDiagnostic) => void
  ): Promise<HttpReader> {
    const url = String(source.url);
    const request = sanitizeRequest(source.request);
    const requestSignal = combineSignals(optionsSignal(source.request?.signal), optionsSignal(signal));
    const headers = new Headers(request.headers);
    headers.set("Range", "bytes=0-0");
    headers.set("Accept-Encoding", "identity");
    let response: Response;
    try {
      response = await fetch(url, { ...request, method: "GET", headers, signal: requestSignal });
    } catch (cause) {
      if (requestSignal?.aborted) throw new PdfError("aborted", "Opening the PDF URL was aborted.", { cause });
      throw new PdfError("source-read", `Unable to open PDF URL ${url}.`, { cause });
    }
    if (!response.ok) {
      const error = new PdfError("source-read", `PDF URL returned HTTP ${response.status}.`, {
        details: { status: response.status }
      });
      cancelResponseBody(response, error);
      throw error;
    }
    if (response.status !== 200 && response.status !== 206) {
      const error = new PdfError("source-read", `Unexpected PDF URL response HTTP ${response.status}.`, {
        details: { status: response.status }
      });
      cancelResponseBody(response, error);
      throw error;
    }
    try {
      throwIfAborted(requestSignal);
    } catch (error) {
      cancelResponseBody(response, error);
      throw error;
    }
    const validator = selectHttpValidator(response);
    const finalUrl = responseUrl(response);
    if (response.status === 206) {
      const contentRange = parseContentRange(response.headers.get("content-range"));
      if (!contentRange || contentRange.start !== 0 || contentRange.end !== 0) {
        const error = new PdfError("source-read", "The PDF server returned an invalid Content-Range.");
        cancelResponseBody(response, error);
        throw error;
      }
      validateByteLength(contentRange.total);
      const probe = await readResponseBytes(response, {
        expectedBytes: 1,
        maximumBytes: 1,
        mismatchCode: "source-read",
        mismatchMessage: "The PDF server returned an invalid range probe.",
        signal: requestSignal
      });
      if (probe.length !== 1) throw new PdfError("source-read", "The PDF server returned an invalid range probe.");
      if (!validator?.canUseIfRange) {
        onDiagnostic?.({
          code: "source.validator-unavailable",
          severity: "warning",
          message: "The PDF range source supplied no strong ETag or Last-Modified validator."
        });
      }
      return new HttpReader(
        url,
        request,
        contentRange.total,
        maxFullDownloadBytes,
        validator,
        finalUrl,
        null,
        source.label,
        onDiagnostic
      );
    }
    const fullBytes = await readResponseBytes(response, {
      maximumBytes: maxFullDownloadBytes,
      mismatchCode: "source-read",
      mismatchMessage: "The PDF server returned an invalid full response.",
      signal: requestSignal
    });
    onDiagnostic?.({
      code: "source.range-full-download",
      severity: "info",
      message: "The PDF server did not honor range loading; HEPR downloaded the full source."
    });
    return new HttpReader(
      url,
      request,
      fullBytes.length,
      maxFullDownloadBytes,
      validator,
      finalUrl,
      fullBytes,
      source.label,
      onDiagnostic
    );
  }

  async read(offset: number, length: number, signal: AbortSignal): Promise<Uint8Array> {
    throwIfAborted(signal);
    if (this.closed) throw new PdfError("closed", "The PDF source is closed.");
    this.assertReadable();
    if (this.fullBytes) return this.fullBytes.slice(offset, offset + length);
    const headers = new Headers(this.request.headers);
    headers.set("Range", `bytes=${offset}-${offset + length - 1}`);
    headers.set("Accept-Encoding", "identity");
    if (this.validator?.canUseIfRange) headers.set("If-Range", this.validator.value);
    const requestSignal = combineSignals(
      signal,
      this.controller.signal,
      optionsSignal(this.request.signal)
    );
    let response: Response;
    try {
      response = await fetch(this.url, {
        ...this.request,
        method: "GET",
        headers,
        signal: requestSignal
      });
    } catch (cause) {
      if (signal.aborted || this.controller.signal.aborted) {
        throw new PdfError(this.closed ? "closed" : "aborted", "The PDF URL range read was aborted.", { cause });
      }
      throw new PdfError("source-read", "The PDF URL range read failed.", { cause });
    }
    if (!response.ok) {
      const error = new PdfError("source-read", `PDF range request returned HTTP ${response.status}.`, {
        details: { status: response.status, offset, length }
      });
      cancelResponseBody(response, error);
      throw error;
    }
    if (this.closed) {
      const error = new PdfError("closed", "The PDF source is closed.");
      cancelResponseBody(response, error);
      throw error;
    }
    try {
      throwIfAborted(requestSignal);
    } catch (error) {
      cancelResponseBody(response, error);
      throw error;
    }
    if (response.status === 200) {
      const fullBytes = await this.acceptFullDownload(response, requestSignal);
      if (!this.fallbackReported) {
        this.fallbackReported = true;
        this.onDiagnostic?.({
          code: "source.range-full-download",
          severity: "info",
          message: "The PDF server stopped honoring range requests; HEPR downloaded the full source."
        });
      }
      return fullBytes.slice(offset, offset + length);
    }
    if (response.status !== 206) {
      const error = new PdfError("source-read", `Unexpected PDF range response HTTP ${response.status}.`);
      cancelResponseBody(response, error);
      throw error;
    }
    try {
      this.verifyResponseIdentity(response);
    } catch (error) {
      void response.body?.cancel(error).catch(() => undefined);
      throw error;
    }
    const contentRange = parseContentRange(response.headers.get("content-range"));
    if (
      !contentRange || contentRange.start !== offset ||
      contentRange.end !== offset + length - 1 || contentRange.total !== this.byteLength
    ) {
      const error = new PdfError("source-read", "The PDF server returned an inconsistent Content-Range.", {
        details: { offset, length }
      });
      cancelResponseBody(response, error);
      throw error;
    }
    const bytes = await readResponseBytes(response, {
      expectedBytes: length,
      maximumBytes: length,
      mismatchCode: "source-read",
      mismatchMessage: "The PDF server returned an invalid range response.",
      signal: requestSignal
    });
    this.assertReadable();
    return bytes;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
    this.fullBytes = null;
    await this.fullDownload?.catch(() => undefined);
    this.fullDownload = null;
  }

  assertReadable(): void {
    if (this.terminalError) throw this.terminalError;
  }

  private acceptFullDownload(response: Response, signal?: AbortSignal): Promise<Uint8Array> {
    try {
      this.verifyResponseIdentity(response);
    } catch (error) {
      void response.body?.cancel(error).catch(() => undefined);
      throw error;
    }
    if (this.byteLength > this.maxFullDownloadBytes) {
      void response.body?.cancel().catch(() => undefined);
      return Promise.reject(fullDownloadLimitError(this.byteLength, this.maxFullDownloadBytes));
    }
    if (this.fullBytes) {
      void response.body?.cancel().catch(() => undefined);
      return Promise.resolve(this.fullBytes);
    }
    if (this.fullDownload) {
      void response.body?.cancel().catch(() => undefined);
      return this.fullDownload;
    }
    this.fullDownload = readResponseBytes(response, {
      expectedBytes: this.byteLength,
      maximumBytes: this.maxFullDownloadBytes,
      mismatchCode: "source-changed",
      mismatchMessage: "The PDF URL changed while it was being read.",
      signal
    }).then((bytes) => {
      if (this.closed) throw new PdfError("closed", "The PDF source is closed.");
      this.assertReadable();
      this.fullBytes = bytes;
      return bytes;
    }, (error) => {
      if (error instanceof PdfError && error.code === "source-changed") {
        this.terminalError = error;
      }
      throw error;
    });
    return this.fullDownload;
  }

  private verifyResponseIdentity(response: Response): void {
    const currentUrl = responseUrl(response);
    if (this.finalUrl && currentUrl && currentUrl !== this.finalUrl) {
      throw this.sourceChanged("The PDF URL redirected to a different resource during range loading.", {
        details: { expectedUrl: this.finalUrl, receivedUrl: currentUrl }
      });
    }
    if (!this.finalUrl && currentUrl) this.finalUrl = currentUrl;
    if (this.validator) {
      const currentValue = response.headers.get(this.validator.kind);
      if (!currentValue) {
        throw this.sourceChanged("The PDF URL stopped returning its validator during range loading.");
      }
      if (currentValue !== this.validator.value) {
        throw this.sourceChanged("The PDF URL validator changed during range loading.");
      }
      return;
    }
    const current = selectHttpValidator(response);
    if (!this.validator && current) this.validator = current;
  }

  private sourceChanged(
    message: string,
    options: ConstructorParameters<typeof PdfError>[2] = {}
  ): PdfError {
    const error = new PdfError("source-changed", message, options);
    this.terminalError = error;
    return error;
  }
}

function sanitizeRequest(request: RequestInit | undefined): RequestInit {
  if (!request) return {};
  if (request.body !== undefined && request.body !== null) {
    throw new TypeError("PDF URL requests cannot contain a body.");
  }
  if (request.method && request.method.toUpperCase() !== "GET") {
    throw new TypeError("PDF URL requests must use GET.");
  }
  const headers = new Headers(request.headers);
  if (headers.has("range") || headers.has("if-range")) {
    throw new TypeError("PDF URL request headers must not set Range or If-Range.");
  }
  const { body: _body, method: _method, ...safe } = request;
  return { ...safe, headers };
}

function validateByteLength(length: number): void {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new RangeError("PDF source byteLength must be a non-negative safe integer.");
  }
}

function validateRange(offset: number, length: number, byteLength: number): void {
  const end = offset + length;
  if (
    !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
    !Number.isSafeInteger(end) || offset < 0 || length < 0 || end > byteLength
  ) {
    throw new RangeError("PDF source read is outside the source bounds.");
  }
}

function parseContentRange(value: string | null): { start: number; end: number; total: number } | null {
  const match = /^bytes[ \t]+(\d+)-(\d+)\/(\d+)$/i.exec(value ?? "");
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && Number.isSafeInteger(total) &&
    total > 0 && start <= end && end < total
    ? { start, end, total }
    : null;
}

function parseNonNegativeInteger(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const active = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(active);
  const controller = new AbortController();
  const abort = (event: Event) => controller.abort((event.target as AbortSignal).reason);
  const aborted = active.find((signal) => signal.aborted);
  if (aborted) controller.abort(aborted.reason);
  else {
    for (const signal of active) signal.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

function optionsSignal(signal: AbortSignal | null | undefined): AbortSignal | undefined {
  return signal ?? undefined;
}

async function awaitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return await new Promise<T>((resolve, reject) => {
    const abort = () => reject(signalError(signal));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function awaitWithSignals<T>(
  promise: Promise<T>,
  ...signals: Array<AbortSignal | undefined>
): Promise<T> {
  const active = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  for (const signal of active) {
    if (signal.aborted) throw signalError(signal);
  }
  if (active.length === 0) return await promise;
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const listeners = new Map<AbortSignal, () => void>();
    const cleanup = (): void => {
      for (const [signal, listener] of listeners) {
        signal.removeEventListener("abort", listener);
      }
      listeners.clear();
    };
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    for (const signal of active) {
      const listener = (): void => finish(() => reject(signalError(signal)));
      listeners.set(signal, listener);
      signal.addEventListener("abort", listener, { once: true });
    }
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    );
  });
}

function signalError(signal: AbortSignal): PdfError {
  return signal.reason instanceof PdfError
    ? signal.reason
    : new PdfError("aborted", "The PDF operation was aborted.", { cause: signal.reason });
}

interface HttpValidator {
  readonly kind: "etag" | "last-modified";
  readonly value: string;
  readonly canUseIfRange: boolean;
}

function selectHttpValidator(response: Response): HttpValidator | null {
  const etag = response.headers.get("etag");
  if (etag && isStrongEtag(etag)) {
    return { kind: "etag", value: etag, canUseIfRange: true };
  }
  const lastModified = response.headers.get("last-modified");
  if (lastModified) {
    return { kind: "last-modified", value: lastModified, canUseIfRange: true };
  }
  if (etag) return { kind: "etag", value: etag, canUseIfRange: false };
  return null;
}

function isStrongEtag(value: string): boolean {
  return /^"[^"\r\n]*"$/.test(value);
}

function responseUrl(response: Response): string | null {
  return response.url ? response.url : null;
}

function cancelResponseBody(response: Response, reason?: unknown): void {
  void response.body?.cancel(reason).catch(() => undefined);
}

interface ReadResponseBytesOptions {
  readonly maximumBytes: number;
  readonly expectedBytes?: number;
  readonly mismatchCode: "source-read" | "source-changed";
  readonly mismatchMessage: string;
  readonly signal?: AbortSignal;
}

async function readResponseBytes(
  response: Response,
  options: ReadResponseBytesOptions
): Promise<Uint8Array> {
  const declared = parseNonNegativeInteger(response.headers.get("content-length"));
  const effectiveOptions: ReadResponseBytesOptions =
    options.expectedBytes === undefined && declared !== undefined
      ? { ...options, expectedBytes: declared }
      : options;
  try {
    if (
      declared !== undefined && declared > options.maximumBytes &&
      options.expectedBytes === undefined
    ) {
      throw fullDownloadLimitError(declared, options.maximumBytes);
    }
    if (declared !== undefined) validateResponseByteCount(declared, effectiveOptions);
    throwIfAborted(options.signal);
  } catch (error) {
    void response.body?.cancel(error).catch(() => undefined);
    throw error;
  }
  if (!response.body) {
    validateResponseByteCount(0, effectiveOptions);
    return new Uint8Array();
  }

  const chunks: Uint8Array[] = [];
  let preallocated: Uint8Array | null;
  try {
    preallocated = effectiveOptions.expectedBytes === undefined
      ? null
      : allocateResponseBytes(effectiveOptions.expectedBytes, effectiveOptions.maximumBytes);
  } catch (error) {
    cancelResponseBody(response, error);
    throw error;
  }
  const reader = response.body.getReader();
  let byteLength = 0;
  try {
    while (true) {
      const result = await awaitWithSignal(reader.read(), options.signal);
      if (result.done) break;
      const chunk = result.value;
      const nextLength = byteLength + chunk.byteLength;
      if (!Number.isSafeInteger(nextLength)) {
        throw fullDownloadLimitError(nextLength, effectiveOptions.maximumBytes);
      }
      validateResponseByteCount(nextLength, effectiveOptions, true);
      if (preallocated) preallocated.set(chunk, byteLength);
      else chunks.push(chunk);
      byteLength = nextLength;
    }
  } catch (error) {
    void reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A browser may retain the lock until its aborted read settles.
    }
  }
  validateResponseByteCount(byteLength, effectiveOptions);
  if (preallocated) return preallocated;
  const bytes = allocateResponseBytes(byteLength, effectiveOptions.maximumBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function validateResponseByteCount(
  receivedBytes: number,
  options: ReadResponseBytesOptions,
  partial = false
): void {
  if (receivedBytes > options.maximumBytes) {
    if (options.expectedBytes !== undefined) {
      throw responseByteCountError(receivedBytes, options);
    }
    throw fullDownloadLimitError(receivedBytes, options.maximumBytes);
  }
  if (
    options.expectedBytes !== undefined &&
    (receivedBytes > options.expectedBytes || (!partial && receivedBytes !== options.expectedBytes))
  ) {
    throw responseByteCountError(receivedBytes, options);
  }
}

function responseByteCountError(
  receivedBytes: number,
  options: ReadResponseBytesOptions
): PdfError {
  return new PdfError(options.mismatchCode, options.mismatchMessage, {
    details: {
      expectedLength: options.expectedBytes ?? -1,
      receivedLength: receivedBytes
    }
  });
}

function fullDownloadLimitError(receivedBytes: number, limit: number): PdfError {
  return new PdfError("resource-limit", "The PDF full download exceeds the configured source ceiling.", {
    details: {
      receivedLength: receivedBytes,
      limit,
      limitName: "maxRepairScanBytes"
    }
  });
}

function allocateResponseBytes(byteLength: number, limit: number): Uint8Array {
  try {
    return new Uint8Array(byteLength);
  } catch (cause) {
    throw new PdfError("resource-limit", "Unable to allocate the bounded PDF response buffer.", {
      cause,
      details: { receivedLength: byteLength, limit, limitName: "responseBytes" }
    });
  }
}
