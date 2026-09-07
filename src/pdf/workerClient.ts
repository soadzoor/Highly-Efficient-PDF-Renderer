import type {
  HeprPageData,
  PdfCompileOptions,
  PdfCompilePagesOptions,
  PdfDocumentInfo
} from "../heprDocumentData";
import type { VectorScene } from "../pdfVectorExtractor";
import type {
  NativeVectorCompileOptions,
  NativeVectorPdfSession,
  OpenPdfOptions,
  PdfSession
} from "../pdfSession";
import {
  PdfError,
  type PdfDiagnostic,
  type PdfSource
} from "./nativeTypes";
import type {
  NativeMissingFontResolution,
  NativeMissingFontResolver,
  NativeMissingFontResult
} from "./nativeFont";
import type {
  NativeImageCodecResolver,
  NativeImageCodecResult
} from "./nativeImage";
import {
  DEFAULT_MAX_ICC_TRANSFORM_BYTES,
  normalizeNativeIccTransformResult,
  validateNativeIccTransformRequest,
  type NativeIccTransformResolver
} from "./nativeIcc";
import {
  servePdfRangeSource,
  type PdfMessageEndpoint
} from "./rangeTransport";
import {
  PDF_WORKER_PROTOCOL_VERSION,
  collectPdfTransferables,
  deserializePdfError,
  serializePdfError,
  type PdfWorkerHostToWorkerMessage,
  type PdfWorkerOpenOptions,
  type PdfWorkerRequest,
  type PdfWorkerSource,
  type PdfWorkerSuccess,
  type PdfWorkerWorkerToHostMessage
} from "./workerProtocol";

export interface PdfWorkerLifecycle {
  /** Register a fatal worker error/exit callback. */
  onCrash(listener: (error: unknown) => void): () => void;
  /** Terminate the worker. It is called only after listeners are detached. */
  terminate(): void | Promise<unknown>;
}

export interface BrowserPdfWorkerOpenOptions extends OpenPdfOptions {
  /** Override the package-relative worker asset, primarily for custom bundlers. */
  readonly workerUrl?: string | URL;
  readonly workerName?: string;
}

export interface NodePdfWorkerOpenOptions extends OpenPdfOptions {
  /** Override the emitted `pdf-worker.js` package asset. */
  readonly workerUrl?: string | URL;
  readonly workerName?: string;
}

/**
 * Open a long-lived module worker in a browser. Vite emits the source worker
 * as a package-relative asset; custom bundlers may provide `workerUrl`.
 */
export async function openPdfInBrowserWorker(
  source: PdfSource,
  options: BrowserPdfWorkerOpenOptions = {}
): Promise<PdfSession> {
  if (typeof Worker !== "function") {
    throw new PdfError("worker-crash", "Module workers are unavailable in this browser.");
  }
  let worker: Worker;
  try {
    worker = options.workerUrl === undefined
      ? new Worker(new URL(
          "./pdfWorkerEntry.ts",
          import.meta.url
        ), {
          type: "module",
          name: options.workerName ?? "hepr-pdf"
        })
      : new Worker(options.workerUrl, {
          type: "module",
          name: options.workerName ?? "hepr-pdf"
        });
  } catch (cause) {
    throw workerCrash("Unable to create the HEPR PDF worker.", cause);
  }
  const { workerUrl: _workerUrl, workerName: _workerName, ...openOptions } = options;
  return await openPdfWithWorkerEndpoint(
    source,
    openOptions,
    worker as unknown as PdfMessageEndpoint<
      PdfWorkerWorkerToHostMessage,
      PdfWorkerHostToWorkerMessage
    >,
    browserWorkerLifecycle(worker)
  );
}

/**
 * Open the same worker runtime directly through `node:worker_threads`.
 * Published builds emit `pdf-worker.js` beside the package entry. Direct
 * source-tree execution uses a small Node module-loader bootstrap.
 */
export async function openPdfInNodeWorker(
  source: PdfSource,
  options: NodePdfWorkerOpenOptions = {}
): Promise<PdfSession> {
  const nodeProcess = (globalThis as {
    readonly process?: {
      readonly versions?: { readonly node?: string };
      readonly execArgv?: readonly string[];
    };
  }).process;
  if (!nodeProcess?.versions?.node) {
    throw new PdfError("worker-crash", "Node worker_threads are unavailable outside Node.js.");
  }
  const moduleName = "node:worker_threads";
  let worker: NodeWorkerLike;
  try {
    const module = await import(/* @vite-ignore */ moduleName) as unknown as {
      Worker: new (
        filename: string | URL,
        options: { readonly name?: string; readonly execArgv?: readonly string[] }
      ) => NodeWorkerLike;
    };
    const workerUrl = options.workerUrl ?? defaultNodePdfWorkerUrl();
    worker = new module.Worker(workerUrl, {
      name: options.workerName ?? "hepr-pdf",
      execArgv: sanitizeNodePdfWorkerExecArgv(nodeProcess.execArgv ?? [])
    });
  } catch (cause) {
    throw workerCrash("Unable to create the HEPR Node PDF worker.", cause);
  }
  const endpoint = nodeWorkerEndpoint(worker);
  const { workerUrl: _workerUrl, workerName: _workerName, ...openOptions } = options;
  return await openPdfWithWorkerEndpoint(
    source,
    openOptions,
    endpoint,
    nodeWorkerLifecycle(worker)
  );
}

/**
 * Node rejects `--input-type` when a worker has a file/URL entry. It also
 * rejects V8 heap/stack flags and process-wide `--title` in Worker `execArgv`;
 * callers must use Worker `resourceLimits` for those concerns. Preserve other
 * inherited runtime flags (loaders, warnings, debugging, strip-types).
 */
export function sanitizeNodePdfWorkerExecArgv(
  execArgv: readonly string[]
): readonly string[] {
  const output: string[] = [];
  for (let index = 0; index < execArgv.length; index += 1) {
    const argument = execArgv[index];
    const optionName = argument.split("=", 1)[0].replaceAll("_", "-");
    if (NODE_PDF_WORKER_VALUE_FLAGS.has(optionName)) {
      if (!argument.includes("=")) index += 1;
      continue;
    }
    if (NODE_PDF_WORKER_BOOLEAN_V8_FLAGS.has(optionName)) {
      continue;
    }
    if (argument === "--input-type") {
      index += 1;
      continue;
    }
    if (argument.startsWith("--input-type=")) continue;
    output.push(argument);
  }
  return output;
}

const NODE_PDF_WORKER_VALUE_FLAGS = new Set([
  "--max-old-space-size",
  "--max-semi-space-size",
  "--initial-old-space-size",
  "--initial-heap-size",
  "--heap-growing-percent",
  "--stack-size",
  "--stack-trace-limit",
  "--title"
]);

const NODE_PDF_WORKER_BOOLEAN_V8_FLAGS = new Set([
  "--huge-max-old-generation-size",
  "--optimize-for-size"
]);

function defaultNodePdfWorkerUrl(): URL {
  const currentUrl = new URL(import.meta.url);
  if (currentUrl.pathname.endsWith(".ts")) {
    return createNodeSourceWorkerBootstrapUrl(
      new URL("./pdfWorkerEntry.ts", currentUrl)
    );
  }
  return new URL("./pdf-worker.js", currentUrl);
}

/**
 * Direct source-tree execution needs an extension resolver inside the new
 * thread. Published packages never take this branch: they launch the emitted
 * JavaScript worker beside the package entry.
 */
function createNodeSourceWorkerBootstrapUrl(entryUrl: URL): URL {
  const source = `
    import { registerHooks } from "node:module";
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (
          context.parentURL?.includes("/src/") &&
          /^\\.\\.?\\//.test(specifier) &&
          !/\\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
        ) {
          return nextResolve(specifier + ".ts", context);
        }
        return nextResolve(specifier, context);
      }
    });
    await import(${JSON.stringify(entryUrl.href)});
  `;
  return new URL(`data:text/javascript,${encodeURIComponent(source)}`);
}

/**
 * Transport-level factory used by launchers and deterministic tests. The
 * endpoint must already be connected to `attachPdfWorkerRuntime()`.
 */
export async function openPdfWithWorkerEndpoint(
  source: PdfSource,
  options: OpenPdfOptions,
  endpoint: PdfMessageEndpoint<PdfWorkerWorkerToHostMessage, PdfWorkerHostToWorkerMessage>,
  lifecycle: PdfWorkerLifecycle = inertLifecycle()
): Promise<NativeVectorPdfSession> {
  const connection = new PdfWorkerConnection(endpoint, lifecycle, options);
  try {
    const sourceSignal = source.kind === "url" ? source.request?.signal ?? undefined : undefined;
    const signal = combineSignals(options.signal, sourceSignal);
    if (signal?.aborted) throw abortedError(signal);
    const prepared = prepareWorkerSource(source);
    if (source.kind === "range") connection.serveRange(source);
    const response = await connection.open(prepared.source, {
      repair: options.repair,
      limits: options.limits,
      hasMissingFontResolver: options.missingFontResolver !== undefined,
      hasImageCodecResolver: options.imageCodecResolver !== undefined,
      hasIccTransformResolver: options.iccTransformResolver !== undefined
    }, prepared.transfer, signal);
    if (signal?.aborted) {
      await connection.close();
      throw abortedError(signal);
    }
    return new WorkerPdfSession(
      connection,
      response.info,
      response.diagnostics,
      sourceSignal
    );
  } catch (error) {
    await connection.dispose().catch(() => undefined);
    throw error;
  }
}

class WorkerPdfSession implements NativeVectorPdfSession {
  readonly info: Readonly<PdfDocumentInfo>;

  private readonly connection: PdfWorkerConnection;
  private readonly lifetime = new AbortController();
  private operationTail: Promise<void> = Promise.resolve();
  private closePromise: Promise<void> | null = null;
  private removeSourceAbort: (() => void) | null = null;
  private closed = false;

  constructor(
    connection: PdfWorkerConnection,
    info: PdfDocumentInfo,
    diagnostics: readonly PdfDiagnostic[],
    sourceSignal?: AbortSignal
  ) {
    this.connection = connection;
    this.info = freezeDocumentInfo(info);
    connection.replaceDiagnostics(diagnostics);
    if (sourceSignal) {
      const closeFromSource = (): void => { void this.close().catch(() => undefined); };
      if (sourceSignal.aborted) closeFromSource();
      else {
        sourceSignal.addEventListener("abort", closeFromSource, { once: true });
        this.removeSourceAbort = () => sourceSignal.removeEventListener("abort", closeFromSource);
      }
    }
  }

  async compilePage(
    sourcePageIndex: number,
    options: PdfCompileOptions = {}
  ): Promise<HeprPageData> {
    const signal = combineSignals(this.lifetime.signal, options.signal);
    let release: (() => void) | null = null;
    try {
      release = await this.acquireOperation(signal);
      return await this.connection.compilePage(
        sourcePageIndex,
        options,
        signal
      );
    } finally {
      release?.();
    }
  }

  /** Internal parser-to-established-renderer bridge; not part of package exports. */
  async compileVectorPage(
    sourcePageIndex: number,
    options: NativeVectorCompileOptions = {}
  ): Promise<VectorScene> {
    const signal = combineSignals(this.lifetime.signal, options.signal);
    let release: (() => void) | null = null;
    try {
      release = await this.acquireOperation(signal);
      return await this.connection.compileVectorPage(
        sourcePageIndex,
        options,
        signal
      );
    } finally {
      release?.();
    }
  }

  compilePages(options: PdfCompilePagesOptions = {}): AsyncIterable<HeprPageData> {
    const indexes = normalizePageIndexes(options.sourcePageIndexes, this.info.pageCount);
    const session = this;
    const operation = new AbortController();
    const signal = combineSignals(session.lifetime.signal, operation.signal, options.signal);
    let cursor = 0;
    let finished = false;
    let release: (() => void) | null = null;
    let acquire: Promise<() => void> | null = null;
    let activeNext: Promise<IteratorResult<HeprPageData>> | null = null;

    const releaseOperation = (): void => {
      if (release) {
        const current = release;
        release = null;
        current();
      } else if (acquire) {
        void acquire.then((current) => current(), () => undefined);
        acquire = null;
      }
    };
    const finish = (reason: PdfError): void => {
      if (finished) return;
      finished = true;
      operation.abort(reason);
      if (!activeNext) releaseOperation();
    };
    const next = async (): Promise<IteratorResult<HeprPageData>> => {
      if (activeNext) {
        throw new PdfError("invalid-object", "Concurrent PDF iterator next() calls are not supported.");
      }
      if (finished || cursor >= indexes.length) {
        finish(new PdfError("aborted", "PDF page iteration ended."));
        return { done: true, value: undefined };
      }
      if (!acquire && !release) acquire = session.acquireOperation(signal);
      const currentAcquire = acquire;
      const promise = (async (): Promise<IteratorResult<HeprPageData>> => {
        try {
          if (!release) {
            release = await currentAcquire!;
            acquire = null;
          }
          if (finished) return { done: true, value: undefined };
          signal?.throwIfAborted();
          const page = await session.connection.compilePage(indexes[cursor], options, signal);
          cursor += 1;
          if (cursor >= indexes.length) finish(
            new PdfError("aborted", "PDF page iteration completed.")
          );
          return { done: false, value: page };
        } catch (error) {
          finish(new PdfError("aborted", "PDF page iteration failed.", { cause: error }));
          throw error;
        } finally {
          activeNext = null;
          if (finished) releaseOperation();
        }
      })();
      activeNext = promise;
      return await promise;
    };
    const iterator: AsyncIterator<HeprPageData> & AsyncIterable<HeprPageData> = {
      next,
      async return() {
        finish(new PdfError("aborted", "PDF page iteration ended."));
        return { done: true, value: undefined };
      },
      [Symbol.asyncIterator]() { return this; }
    };
    return iterator;
  }

  getDiagnostics(): readonly PdfDiagnostic[] {
    return this.connection.getDiagnostics();
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.removeSourceAbort?.();
    this.removeSourceAbort = null;
    this.lifetime.abort(new PdfError("closed", "The PDF worker session is closed."));
    this.closePromise = this.connection.close();
    return this.closePromise;
  }

  private async acquireOperation(signal?: AbortSignal): Promise<() => void> {
    this.assertOpen();
    if (signal?.aborted) throw abortedError(signal);
    const previous = this.operationTail;
    let release!: () => void;
    this.operationTail = new Promise<void>((resolve) => { release = resolve; });
    try {
      await waitForOperationTurn(previous, signal);
    } catch (error) {
      // Preserve FIFO exclusion for later callers even though this queued
      // operation can reject immediately on cancellation.
      void previous.then(release, release);
      throw error;
    }
    try {
      if (signal?.aborted) throw abortedError(signal);
      this.assertOpen();
    } catch (error) {
      release();
      throw error;
    }
    return release;
  }

  private assertOpen(): void {
    if (this.closed) throw new PdfError("closed", "The PDF worker session is closed.");
  }
}

type OpenSuccess = Extract<PdfWorkerSuccess, { operation: "open" }>;
type CompileSuccess = Extract<PdfWorkerSuccess, { operation: "compile-page" }>;
type CompileVectorSuccess = Extract<PdfWorkerSuccess, { operation: "compile-vector-page" }>;

interface PendingWorkerRequest {
  readonly operation: PdfWorkerRequest["operation"];
  readonly onProgress?: PdfCompileOptions["onProgress"];
  resolve(response: PdfWorkerSuccess): void;
  reject(error: unknown): void;
  removeAbort(): void;
}

class PdfWorkerConnection {
  private readonly endpoint: PdfMessageEndpoint<
    PdfWorkerWorkerToHostMessage,
    PdfWorkerHostToWorkerMessage
  >;
  private readonly lifecycle: PdfWorkerLifecycle;
  private readonly defaultProgress?: OpenPdfOptions["onProgress"];
  private readonly onDiagnostic?: OpenPdfOptions["onDiagnostic"];
  private readonly missingFontResolver?: NativeMissingFontResolver;
  private readonly imageCodecResolver?: NativeImageCodecResolver;
  private readonly iccTransformResolver?: NativeIccTransformResolver;
  private readonly maxIccTransformBytes: number;
  private readonly pending = new Map<number, PendingWorkerRequest>();
  private readonly fontControllers = new Map<number, AbortController>();
  private readonly imageCodecControllers = new Map<number, AbortController>();
  private readonly iccTransformControllers = new Map<number, AbortController>();
  private diagnostics: PdfDiagnostic[] = [];
  private nextRequestId = 1;
  private rangeHost: { close(): Promise<void> } | null = null;
  private removeCrashListener: (() => void) | null;
  private closePromise: Promise<void> | null = null;
  private disposePromise: Promise<void> | null = null;
  private terminalError: PdfError | null = null;
  private disposed = false;

  constructor(
    endpoint: PdfMessageEndpoint<PdfWorkerWorkerToHostMessage, PdfWorkerHostToWorkerMessage>,
    lifecycle: PdfWorkerLifecycle,
    options: OpenPdfOptions
  ) {
    this.endpoint = endpoint;
    this.lifecycle = lifecycle;
    this.defaultProgress = options.onProgress;
    this.onDiagnostic = options.onDiagnostic;
    this.missingFontResolver = options.missingFontResolver;
    this.imageCodecResolver = options.imageCodecResolver;
    this.iccTransformResolver = options.iccTransformResolver;
    this.maxIccTransformBytes = options.limits?.maxIccTransformBytes ??
      DEFAULT_MAX_ICC_TRANSFORM_BYTES;
    this.endpoint.addEventListener("message", this.onMessage);
    this.removeCrashListener = lifecycle.onCrash((error) => this.failFromCrash(error));
  }

  serveRange(source: Extract<PdfSource, { kind: "range" }>): void {
    if (this.rangeHost) throw new PdfError("invalid-object", "A PDF range host is already active.");
    this.rangeHost = servePdfRangeSource(
      source,
      this.endpoint as unknown as Parameters<typeof servePdfRangeSource>[1]
    );
  }

  open(
    source: PdfWorkerSource,
    options: PdfWorkerOpenOptions,
    transfer: Transferable[],
    signal?: AbortSignal
  ): Promise<OpenSuccess> {
    return this.request({ operation: "open", source, options }, transfer, signal) as Promise<OpenSuccess>;
  }

  compilePage(
    sourcePageIndex: number,
    options: PdfCompileOptions,
    signal?: AbortSignal
  ): Promise<HeprPageData> {
    return (this.request({
      operation: "compile-page",
      sourcePageIndex,
      options: { limits: options.limits, optimization: options.optimization }
    }, [], signal, options.onProgress) as Promise<CompileSuccess>).then((response) => {
      this.replaceDiagnostics(response.diagnostics);
      return response.page;
    });
  }

  compileVectorPage(
    sourcePageIndex: number,
    options: NativeVectorCompileOptions,
    signal?: AbortSignal
  ): Promise<VectorScene> {
    return (this.request({
      operation: "compile-vector-page",
      sourcePageIndex,
      options: {
        limits: options.limits,
        optimization: options.optimization,
        enableSegmentMerge: options.enableSegmentMerge,
        enableInvisibleCull: options.enableInvisibleCull
      }
    }, [], signal, options.onProgress) as Promise<CompileVectorSuccess>).then((response) => {
      this.replaceDiagnostics(response.diagnostics);
      return response.scene;
    });
  }

  replaceDiagnostics(diagnostics: readonly PdfDiagnostic[]): void {
    const previous = new Set(this.diagnostics.map(workerDiagnosticKey));
    this.diagnostics = diagnostics.map((diagnostic) => ({ ...diagnostic }));
    for (const diagnostic of this.diagnostics) {
      if (!previous.has(workerDiagnosticKey(diagnostic))) this.onDiagnostic?.(diagnostic);
    }
  }

  getDiagnostics(): readonly PdfDiagnostic[] {
    return Object.freeze(this.diagnostics.map((diagnostic) => Object.freeze({ ...diagnostic })));
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    if (this.terminalError || this.disposed) {
      this.closePromise = this.dispose();
      return this.closePromise;
    }
    this.closePromise = (this.request({ operation: "close" }, [], undefined, undefined, true) as Promise<
      Extract<PdfWorkerSuccess, { operation: "close" }>
    >).then(() => undefined).finally(() => this.dispose());
    return this.closePromise;
  }

  async dispose(): Promise<void> {
    if (this.disposePromise) return await this.disposePromise;
    this.disposed = true;
    this.endpoint.removeEventListener("message", this.onMessage);
    this.removeCrashListener?.();
    this.removeCrashListener = null;
    const error = new PdfError("closed", "The PDF worker connection is closed.");
    for (const request of this.pending.values()) {
      request.removeAbort();
      request.reject(error);
    }
    this.pending.clear();
    const fontError = new PdfError("closed", "The PDF worker connection is closed.");
    for (const controller of this.fontControllers.values()) controller.abort(fontError);
    this.fontControllers.clear();
    const imageCodecError = new PdfError("closed", "The PDF worker connection is closed.");
    for (const controller of this.imageCodecControllers.values()) {
      controller.abort(imageCodecError);
    }
    this.imageCodecControllers.clear();
    const iccTransformError = new PdfError("closed", "The PDF worker connection is closed.");
    for (const controller of this.iccTransformControllers.values()) {
      controller.abort(iccTransformError);
    }
    this.iccTransformControllers.clear();
    const rangeHost = this.rangeHost;
    this.rangeHost = null;
    this.disposePromise = (async () => {
      await rangeHost?.close().catch(() => undefined);
      await this.lifecycle.terminate();
    })();
    return await this.disposePromise;
  }

  private request(
    body: RequestBody,
    transfer: Transferable[],
    signal?: AbortSignal,
    onProgress?: PdfCompileOptions["onProgress"],
    allowDisposed = false
  ): Promise<PdfWorkerSuccess> {
    if (this.disposed && !allowDisposed) {
      return Promise.reject(
        this.terminalError ?? new PdfError("closed", "The PDF worker connection is closed.")
      );
    }
    if (signal?.aborted) return Promise.reject(abortedError(signal));
    const requestId = this.allocateRequestId();
    const request = {
      type: "hepr-pdf-request" as const,
      protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
      requestId,
      ...body
    } as PdfWorkerRequest;
    return new Promise<PdfWorkerSuccess>((resolve, reject) => {
      const abort = (): void => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.pending.delete(requestId);
        pending.removeAbort();
        try {
          this.endpoint.postMessage({
            type: "hepr-pdf-cancel",
            protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
            requestId
          });
        } catch {
          // The request still rejects with the caller's cancellation reason.
        }
        reject(abortedError(signal));
      };
      const removeAbort = (): void => signal?.removeEventListener("abort", abort);
      this.pending.set(requestId, {
        operation: body.operation,
        onProgress,
        resolve,
        reject,
        removeAbort
      });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        this.endpoint.postMessage(request, transfer);
      } catch (cause) {
        this.pending.delete(requestId);
        removeAbort();
        reject(workerCrash("Unable to send a request to the PDF worker.", cause));
      }
    });
  }

  private readonly onMessage = (event: MessageEvent<PdfWorkerWorkerToHostMessage>): void => {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (!("type" in message) || typeof message.type !== "string") {
      this.failFromCrash(new Error("The PDF worker returned a malformed protocol message."));
      return;
    }
    if (
      message.type.startsWith("hepr-pdf-") &&
      (!("protocolVersion" in message) ||
        message.protocolVersion !== PDF_WORKER_PROTOCOL_VERSION)
    ) {
      this.failFromCrash(new Error("The PDF worker returned an incompatible protocol version."));
      return;
    }
    if (message.type === "hepr-pdf-progress") {
      const callback = message.requestId === 0
        ? this.defaultProgress
        : this.pending.get(message.requestId)?.onProgress ?? this.defaultProgress;
      if (!callback) return;
      try {
        callback(message.progress);
      } catch (error) {
        if (message.requestId !== 0) this.rejectFromCallback(message.requestId, error);
        else this.failFromCrash(error, "The session progress callback failed.");
      }
      return;
    }
    if (message.type === "hepr-pdf-diagnostic") {
      this.diagnostics.push({ ...message.diagnostic });
      try {
        this.onDiagnostic?.(message.diagnostic);
      } catch (error) {
        this.failFromCrash(error, "The session diagnostic callback failed.");
      }
      return;
    }
    if (message.type === "hepr-pdf-font-request") {
      void this.resolveMissingFont(message);
      return;
    }
    if (message.type === "hepr-pdf-font-cancel") {
      this.fontControllers.get(message.fontRequestId)?.abort(
        new PdfError("aborted", "The PDF worker cancelled its missing-font request.")
      );
      this.fontControllers.delete(message.fontRequestId);
      return;
    }
    if (message.type === "hepr-pdf-image-codec-request") {
      void this.resolveImageCodec(message);
      return;
    }
    if (message.type === "hepr-pdf-image-codec-cancel") {
      this.imageCodecControllers.get(message.imageCodecRequestId)?.abort(
        new PdfError("aborted", "The PDF worker cancelled its image-codec request.")
      );
      this.imageCodecControllers.delete(message.imageCodecRequestId);
      return;
    }
    if (message.type === "hepr-pdf-icc-transform-request") {
      void this.resolveIccTransform(message);
      return;
    }
    if (message.type === "hepr-pdf-icc-transform-cancel") {
      this.iccTransformControllers.get(message.iccTransformRequestId)?.abort(
        new PdfError("aborted", "The PDF worker cancelled its ICC transform request.")
      );
      this.iccTransformControllers.delete(message.iccTransformRequestId);
      return;
    }
    if (message.type !== "hepr-pdf-result") {
      if (message.type.startsWith("hepr-pdf-")) {
        this.failFromCrash(new Error(`The PDF worker returned unknown message type ${message.type}.`));
      }
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    pending.removeAbort();
    if (!message.ok) {
      pending.reject(deserializePdfError(message.error));
      return;
    }
    if (message.operation !== pending.operation) {
      pending.reject(workerCrash("The PDF worker returned a mismatched operation result."));
      return;
    }
    pending.resolve(message);
  };

  private async resolveMissingFont(
    message: Extract<PdfWorkerWorkerToHostMessage, { type: "hepr-pdf-font-request" }>
  ): Promise<void> {
    const requestId = message.fontRequestId;
    if (!Number.isSafeInteger(requestId) || requestId <= 0 || this.fontControllers.has(requestId)) {
      this.failFromCrash(new Error("The PDF worker returned an invalid missing-font request id."));
      return;
    }
    const controller = new AbortController();
    this.fontControllers.set(requestId, controller);
    try {
      const resolution = this.missingFontResolver
        ? await this.missingFontResolver(Object.freeze({ ...message.request }), controller.signal)
        : null;
      if (controller.signal.aborted || this.disposed) return;
      const normalized = normalizeWorkerFontResolution(resolution);
      const response = {
        type: "hepr-pdf-font-result" as const,
        protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
        fontRequestId: requestId,
        ok: true as const,
        resolution: normalized
      };
      this.endpoint.postMessage(response, collectPdfTransferables(normalized));
    } catch (error) {
      if (controller.signal.aborted || this.disposed) return;
      try {
        this.endpoint.postMessage({
          type: "hepr-pdf-font-result",
          protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
          fontRequestId: requestId,
          ok: false,
          error: serializePdfError(error, "unsupported-font")
        });
      } catch (postError) {
        this.failFromCrash(postError, "Unable to return a missing-font result to the PDF worker.");
      }
    } finally {
      if (this.fontControllers.get(requestId) === controller) {
        this.fontControllers.delete(requestId);
      }
    }
  }

  private async resolveImageCodec(
    message: Extract<PdfWorkerWorkerToHostMessage, { type: "hepr-pdf-image-codec-request" }>
  ): Promise<void> {
    const requestId = message.imageCodecRequestId;
    if (
      !Number.isSafeInteger(requestId) || requestId <= 0 ||
      this.imageCodecControllers.has(requestId)
    ) {
      this.failFromCrash(new Error("The PDF worker returned an invalid image-codec request id."));
      return;
    }
    const controller = new AbortController();
    this.imageCodecControllers.set(requestId, controller);
    try {
      if (!this.imageCodecResolver) {
        throw new PdfError(
          "unsupported-image",
          `${message.request.codec} image data requires its pinned codec kernel.`
        );
      }
      const resolution = await this.imageCodecResolver(
        Object.freeze({ ...message.request }),
        controller.signal
      );
      if (controller.signal.aborted || this.disposed) return;
      const normalized = normalizeWorkerImageCodecResolution(resolution);
      const response = {
        type: "hepr-pdf-image-codec-result" as const,
        protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
        imageCodecRequestId: requestId,
        ok: true as const,
        resolution: normalized
      };
      this.endpoint.postMessage(response, collectPdfTransferables(normalized));
    } catch (error) {
      if (controller.signal.aborted || this.disposed) return;
      try {
        this.endpoint.postMessage({
          type: "hepr-pdf-image-codec-result",
          protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
          imageCodecRequestId: requestId,
          ok: false,
          error: serializePdfError(error, "unsupported-image")
        });
      } catch (postError) {
        this.failFromCrash(postError, "Unable to return an image-codec result to the PDF worker.");
      }
    } finally {
      if (this.imageCodecControllers.get(requestId) === controller) {
        this.imageCodecControllers.delete(requestId);
      }
    }
  }

  private async resolveIccTransform(
    message: Extract<PdfWorkerWorkerToHostMessage, { type: "hepr-pdf-icc-transform-request" }>
  ): Promise<void> {
    const requestId = message.iccTransformRequestId;
    if (
      !Number.isSafeInteger(requestId) || requestId <= 0 ||
      this.iccTransformControllers.has(requestId)
    ) {
      this.failFromCrash(new Error("The PDF worker returned an invalid ICC transform request id."));
      return;
    }
    const controller = new AbortController();
    this.iccTransformControllers.set(requestId, controller);
    try {
      if (!this.iccTransformResolver) {
        throw new PdfError(
          "unsupported-color",
          "ICCBased color conversion requires a caller-owned ICC transform resolver."
        );
      }
      validateNativeIccTransformRequest(message.request, this.maxIccTransformBytes);
      const request = Object.freeze({
        ...message.request,
        metadata: Object.freeze({ ...message.request.metadata })
      });
      const resolution = await this.iccTransformResolver(request, controller.signal);
      if (controller.signal.aborted || this.disposed) return;
      const normalized = normalizeNativeIccTransformResult(
        resolution,
        request,
        this.maxIccTransformBytes,
        controller.signal
      );
      const response = {
        type: "hepr-pdf-icc-transform-result" as const,
        protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
        iccTransformRequestId: requestId,
        ok: true as const,
        resolution: normalized
      };
      this.endpoint.postMessage(response, collectPdfTransferables(normalized));
    } catch (error) {
      if (controller.signal.aborted || this.disposed) return;
      try {
        this.endpoint.postMessage({
          type: "hepr-pdf-icc-transform-result",
          protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
          iccTransformRequestId: requestId,
          ok: false,
          error: serializePdfError(error, "unsupported-color")
        });
      } catch (postError) {
        this.failFromCrash(postError, "Unable to return an ICC transform result to the PDF worker.");
      }
    } finally {
      if (this.iccTransformControllers.get(requestId) === controller) {
        this.iccTransformControllers.delete(requestId);
      }
    }
  }

  private rejectFromCallback(requestId: number, error: unknown): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    pending.removeAbort();
    try {
      this.endpoint.postMessage({
        type: "hepr-pdf-cancel",
        protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
        requestId
      });
    } catch {
      // The callback error remains the primary failure.
    }
    pending.reject(error);
  }

  private failFromCrash(error: unknown, message = "The PDF worker crashed."): void {
    if (this.disposed) return;
    const failure = error instanceof PdfError && error.code === "worker-crash"
      ? error
      : workerCrash(message, error);
    this.terminalError = failure;
    for (const request of this.pending.values()) {
      request.removeAbort();
      request.reject(failure);
    }
    this.pending.clear();
    void this.dispose().catch(() => undefined);
  }

  private allocateRequestId(): number {
    const start = this.nextRequestId;
    do {
      const requestId = this.nextRequestId;
      this.nextRequestId += 1;
      if (!Number.isSafeInteger(this.nextRequestId)) this.nextRequestId = 1;
      if (!this.pending.has(requestId)) return requestId;
    } while (this.nextRequestId !== start);
    throw new PdfError("resource-limit", "The PDF worker request id space is exhausted.");
  }
}

type RequestBody =
  | Omit<Extract<PdfWorkerRequest, { operation: "open" }>,
      "type" | "protocolVersion" | "requestId">
  | Omit<Extract<PdfWorkerRequest, { operation: "compile-page" }>,
      "type" | "protocolVersion" | "requestId">
  | Omit<Extract<PdfWorkerRequest, { operation: "compile-vector-page" }>,
      "type" | "protocolVersion" | "requestId">
  | Omit<Extract<PdfWorkerRequest, { operation: "close" }>,
      "type" | "protocolVersion" | "requestId">;

function prepareWorkerSource(source: PdfSource): {
  source: PdfWorkerSource;
  transfer: Transferable[];
} {
  switch (source.kind) {
    case "bytes": {
      const bytes = acquireWorkerSourceBytes(source);
      const buffer = bytes.buffer;
      return {
        source: { kind: "bytes", bytes, label: source.label },
        transfer: buffer instanceof ArrayBuffer ? [buffer] : []
      };
    }
    case "blob":
      return { source: { kind: "blob", blob: source.blob, label: source.label }, transfer: [] };
    case "url":
      return {
        source: {
          kind: "url",
          url: String(source.url),
          request: serializeRequestInit(source.request),
          label: source.label
        },
        transfer: []
      };
    case "range":
      return {
        source: {
          kind: "remote-range",
          byteLength: source.byteLength,
          label: source.label
        },
        transfer: []
      };
  }
}

function acquireWorkerSourceBytes(
  source: Extract<PdfSource, { kind: "bytes" }>
): Uint8Array {
  if (source.ownership !== "transfer") return copyWorkerSourceBytes(source.bytes);
  const buffer = source.bytes.buffer;
  if (!(buffer instanceof ArrayBuffer)) return copyWorkerSourceBytes(source.bytes);
  try {
    // Take ownership here, then transfer the now host-owned buffer through the
    // endpoint. This also lets non-transferable Node Buffer slabs fall back to
    // an isolated copy before a worker postMessage is attempted.
    return structuredClone(source.bytes, { transfer: [buffer] });
  } catch (cause) {
    if (isDataCloneError(cause) && buffer.byteLength > 0) {
      return copyWorkerSourceBytes(source.bytes);
    }
    throw new PdfError("source-read", "Unable to transfer ownership of the PDF bytes.", {
      cause
    });
  }
}

function copyWorkerSourceBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function isDataCloneError(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "name" in error && error.name === "DataCloneError";
}

function serializeRequestInit(
  request: RequestInit | undefined
): Extract<PdfWorkerSource, { kind: "url" }>["request"] {
  if (!request) return undefined;
  if (request.body !== undefined && request.body !== null) {
    throw new TypeError("PDF URL requests cannot contain a body.");
  }
  if (request.method && request.method.toUpperCase() !== "GET") {
    throw new TypeError("PDF URL requests must use GET.");
  }
  const headers = [...new Headers(request.headers).entries()];
  if (headers.some(([name]) => name === "range" || name === "if-range")) {
    throw new TypeError("PDF URL request headers must not set Range or If-Range.");
  }
  return {
    ...(request.cache === undefined ? {} : { cache: request.cache }),
    ...(request.credentials === undefined ? {} : { credentials: request.credentials }),
    ...(headers.length === 0 ? {} : { headers }),
    ...(request.integrity === undefined ? {} : { integrity: request.integrity }),
    ...(request.keepalive === undefined ? {} : { keepalive: request.keepalive }),
    ...(request.mode === undefined ? {} : { mode: request.mode }),
    ...(request.redirect === undefined ? {} : { redirect: request.redirect }),
    ...(request.referrer === undefined ? {} : { referrer: request.referrer }),
    ...(request.referrerPolicy === undefined ? {} : { referrerPolicy: request.referrerPolicy })
  };
}

function workerDiagnosticKey(diagnostic: PdfDiagnostic): string {
  return JSON.stringify([
    diagnostic.code,
    diagnostic.severity,
    diagnostic.message,
    diagnostic.offset ?? null,
    diagnostic.objectNumber ?? null,
    diagnostic.pageIndex ?? null,
    diagnostic.details ?? null
  ]);
}

function normalizeWorkerFontResolution(
  resolution: NativeMissingFontResolution | null
): NativeMissingFontResult | null {
  if (resolution === null) return null;
  const result = resolution instanceof Uint8Array
    ? { sfntBytes: resolution }
    : resolution;
  if (!result || typeof result !== "object" || !(result.sfntBytes instanceof Uint8Array)) {
    throw new PdfError(
      "unsupported-font",
      "The host missing-font resolver returned an invalid result."
    );
  }
  // Resolver bytes remain caller-owned. Do not call `.slice()` here: Node's
  // Buffer overrides it with a shared-memory view, whose transfer would detach
  // the resolver cache and make the same face fail on the next page.
  let sfntBytes: Uint8Array;
  try {
    sfntBytes = new Uint8Array(result.sfntBytes.byteLength);
    sfntBytes.set(result.sfntBytes);
  } catch (cause) {
    throw new PdfError(
      "resource-limit",
      "Unable to copy the host missing-font resolver result.",
      { cause, details: { bytes: result.sfntBytes.byteLength } }
    );
  }
  return {
    sfntBytes,
    ...(result.faceIndex === undefined ? {} : { faceIndex: result.faceIndex }),
    ...(result.identifier === undefined ? {} : { identifier: result.identifier })
  };
}

function normalizeWorkerImageCodecResolution(
  resolution: NativeImageCodecResult
): NativeImageCodecResult {
  if (
    !resolution || typeof resolution !== "object" ||
    !(resolution.samples instanceof Uint8Array)
  ) {
    throw new PdfError(
      "unsupported-image",
      "The host image-codec resolver returned an invalid result."
    );
  }
  // Resolver bytes remain caller-owned. Transfer an isolated copy to the
  // worker so structured-clone detachment cannot mutate the caller's value.
  let samples: Uint8Array;
  try {
    samples = new Uint8Array(resolution.samples.byteLength);
    samples.set(resolution.samples);
  } catch (cause) {
    throw new PdfError(
      "resource-limit",
      "Unable to copy the host image-codec resolver result.",
      { cause, details: { bytes: resolution.samples.byteLength } }
    );
  }
  return {
    samples,
    width: resolution.width,
    height: resolution.height,
    components: resolution.components,
    bitsPerComponent: resolution.bitsPerComponent
  };
}

function normalizePageIndexes(
  requested: readonly number[] | undefined,
  pageCount: number
): readonly number[] {
  if (requested === undefined) {
    return Object.freeze(Array.from({ length: pageCount }, (_, index) => index));
  }
  const seen = new Set<number>();
  const indexes: number[] = [];
  for (const value of requested) {
    if (!Number.isSafeInteger(value) || value < 0 || value >= pageCount) {
      throw new PdfError("invalid-page-index", `PDF page index ${value} is out of range.`, {
        details: { pageIndex: value, pageCount }
      });
    }
    if (seen.has(value)) {
      throw new PdfError("invalid-page-index", `PDF page index ${value} was requested more than once.`, {
        details: { pageIndex: value, duplicate: true }
      });
    }
    seen.add(value);
    indexes.push(value);
  }
  return Object.freeze(indexes);
}

function freezeDocumentInfo(info: PdfDocumentInfo): Readonly<PdfDocumentInfo> {
  return Object.freeze({
    ...info,
    pages: Object.freeze(info.pages.map((page) => Object.freeze({ ...page }))),
    metadata: Object.freeze({ ...info.metadata })
  });
}

function abortedError(signal?: AbortSignal): PdfError {
  return new PdfError("aborted", "The PDF worker operation was aborted.", {
    cause: signal?.reason
  });
}

function combineSignals(
  ...signals: Array<AbortSignal | null | undefined>
): AbortSignal | undefined {
  const active = signals.filter((signal): signal is AbortSignal => signal !== undefined && signal !== null);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

function waitForOperationTurn(
  previous: Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  if (!signal) return previous;
  if (signal.aborted) return Promise.reject(abortedError(signal));
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      callback();
    };
    const abort = (): void => finish(() => reject(abortedError(signal)));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    void previous.then(
      () => finish(resolve),
      (error) => finish(() => reject(error))
    );
  });
}

function workerCrash(message: string, cause?: unknown): PdfError {
  const suffix = cause instanceof Error && cause.message ? ` ${cause.message}` : "";
  return new PdfError("worker-crash", `${message}${suffix}`, { cause });
}

function inertLifecycle(): PdfWorkerLifecycle {
  return { onCrash: () => () => undefined, terminate: () => undefined };
}

function browserWorkerLifecycle(worker: Worker): PdfWorkerLifecycle {
  return {
    onCrash(listener) {
      const onError = (event: ErrorEvent): void => {
        event.preventDefault();
        listener(event.error ?? new Error(event.message || "The PDF worker failed."));
      };
      const onMessageError = (): void => listener(
        new DOMException("The PDF worker returned an unreadable message.", "DataCloneError")
      );
      worker.addEventListener("error", onError);
      worker.addEventListener("messageerror", onMessageError);
      return () => {
        worker.removeEventListener("error", onError);
        worker.removeEventListener("messageerror", onMessageError);
      };
    },
    terminate: () => worker.terminate()
  };
}

interface NodeWorkerLike {
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
  on(type: "message", listener: (message: unknown) => void): void;
  on(type: "error" | "messageerror", listener: (error: Error) => void): void;
  on(type: "exit", listener: (code: number) => void): void;
  off(type: "message", listener: (message: unknown) => void): void;
  off(type: "error" | "messageerror", listener: (error: Error) => void): void;
  off(type: "exit", listener: (code: number) => void): void;
  terminate(): Promise<number>;
}

function nodeWorkerEndpoint(worker: NodeWorkerLike): PdfMessageEndpoint<
  PdfWorkerWorkerToHostMessage,
  PdfWorkerHostToWorkerMessage
> {
  const wrappers = new Map<
    (event: MessageEvent<PdfWorkerWorkerToHostMessage>) => void,
    (message: unknown) => void
  >();
  return {
    addEventListener(_type, listener) {
      const wrapper = (message: unknown): void => listener({ data: message } as MessageEvent<PdfWorkerWorkerToHostMessage>);
      wrappers.set(listener, wrapper);
      worker.on("message", wrapper);
    },
    removeEventListener(_type, listener) {
      const wrapper = wrappers.get(listener);
      if (!wrapper) return;
      wrappers.delete(listener);
      worker.off("message", wrapper);
    },
    postMessage(message, transfer) {
      worker.postMessage(message, transfer);
    }
  };
}

function nodeWorkerLifecycle(worker: NodeWorkerLike): PdfWorkerLifecycle {
  return {
    onCrash(listener) {
      const onError = (error: Error): void => listener(error);
      const onMessageError = (error: Error): void => listener(error);
      const onExit = (code: number): void => listener(
        new Error(`The PDF worker exited unexpectedly with code ${code}.`)
      );
      worker.on("error", onError);
      worker.on("messageerror", onMessageError);
      worker.on("exit", onExit);
      return () => {
        worker.off("error", onError);
        worker.off("messageerror", onMessageError);
        worker.off("exit", onExit);
      };
    },
    terminate: () => worker.terminate()
  };
}
