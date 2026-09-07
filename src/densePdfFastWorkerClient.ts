import type {
  DensePdfBounds,
  DensePdfCompiledPage,
  DensePdfMatrix
} from "./densePdfContentCompiler";
import type { PDFLoadProgress } from "./loadProgress";
import type { VectorScene } from "./pdfVectorExtractor";

export type DensePdfFastWorkerStage =
  | "pdf-fast-check"
  | "pdf-fast-decode"
  | "pdf-operators"
  | "pdf-optimize"
  | "pdf-text"
  | "compile";

export type DensePdfFastWorkerProgress = PDFLoadProgress & {
  stage: DensePdfFastWorkerStage;
  executionPath: "dense-vector-worker";
  sourceType: "pdf";
};

export interface DensePdfFastWorkerOptions {
  /** One-based PDF page selection using HEPR's existing page-range syntax. */
  pages?: string;
  enableSegmentMerge?: boolean;
  enableInvisibleCull?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: DensePdfFastWorkerProgress) => void;
}

export interface DensePdfFastCompiledPage {
  /** Zero-based page index in the source PDF. */
  sourcePageIndex: number;
  mediaBox: [number, number, number, number];
  cropBox: [number, number, number, number];
  rotation: number;
  userUnit: number;
  pageMatrix: DensePdfMatrix;
  pageBounds: DensePdfBounds;
  encodedContentBytes: number;
  decodedContentBytes: number;
  /** Time awaiting decoded content chunks; decoding may overlap scanning. */
  decodeMs: number;
  compileMs: number;
  compiled: DensePdfCompiledPage;
}

export interface DensePdfFastWorkerTiming {
  preflightMs: number;
  /** Time awaiting decoded content chunks across all selected pages. */
  decodeMs: number;
  compileMs: number;
  /** Retained for result compatibility; always zero in the native-only worker. */
  textMiniPdfMs: number;
  /** Direct native retained-text compilation; zero when selected pages contain no text. */
  nativeTextMs: number;
  totalMs: number;
}

export interface DensePdfFastWorkerSuccess {
  kind: "success";
  /** Parser backend used before the unchanged dense compiler. */
  structureBackend: "hepr-native";
  sourcePageCount: number;
  pages: DensePdfFastCompiledPage[];
  /** @internal Compatibility field; the native worker always returns an empty array. */
  textMiniPdfBytes: Uint8Array;
  /** Existing one-page VectorScene text ABI, present when selected pages contain text. */
  nativeTextScenes?: VectorScene[];
  timing: DensePdfFastWorkerTiming;
}

export interface DensePdfFastWorkerFallback {
  kind: "fallback";
  reason: string;
  message: string;
  sourcePageIndex?: number;
  resourceName?: string;
  filterName?: string;
  operator?: string;
}

export interface DensePdfFastWorkerSerializedError {
  name: string;
  message: string;
  stack?: string;
}

export interface DensePdfFastWorkerFailure {
  kind: "error";
  error: DensePdfFastWorkerSerializedError;
}

export type DensePdfFastWorkerResult =
  | DensePdfFastWorkerSuccess
  | DensePdfFastWorkerFallback
  | DensePdfFastWorkerFailure;

export interface DensePdfFastWorkerRequest {
  type: "compile";
  pdfBytes: Uint8Array;
  options: {
    pages?: string;
    enableSegmentMerge: boolean;
    enableInvisibleCull: boolean;
  };
}

export type DensePdfFastWorkerResponse =
  | { type: "progress"; progress: DensePdfFastWorkerProgress }
  | { type: "result"; result: DensePdfFastWorkerResult };

/**
 * Attempt the dense-vector PDF path in a short-lived browser module worker or
 * Node `worker_threads` isolate.
 *
 * The source is copied before transfer, so this never detaches caller-owned
 * bytes. Expected incompatibilities are returned as `kind: "fallback"`;
 * unexpected worker failures are returned as `kind: "error"`. Aborting rejects
 * with the AbortSignal reason after immediately terminating the worker.
 */
export async function compileDensePdfInWorker(
  pdfBytes: ArrayBuffer | Uint8Array,
  options: DensePdfFastWorkerOptions = {}
): Promise<DensePdfFastWorkerResult> {
  options.signal?.throwIfAborted();

  let worker: DensePdfWorkerLike;
  try {
    worker = await createDensePdfWorker();
  } catch (error) {
    return {
      kind: "fallback",
      reason: "worker-unavailable",
      message: readErrorMessage(error, "Unable to create the dense PDF worker.")
    };
  }
  if (options.signal?.aborted) {
    terminateDensePdfWorker(worker);
    throw readAbortReason(options.signal);
  }

  let ownedBytes: Uint8Array<ArrayBuffer>;
  try {
    ownedBytes = copyBytes(pdfBytes);
  } catch (error) {
    terminateDensePdfWorker(worker);
    return { kind: "error", error: serializeError(error) };
  }
  const request: DensePdfFastWorkerRequest = {
    type: "compile",
    pdfBytes: ownedBytes,
    options: {
      pages: options.pages,
      enableSegmentMerge: options.enableSegmentMerge !== false,
      enableInvisibleCull: options.enableInvisibleCull !== false
    }
  };

  return new Promise<DensePdfFastWorkerResult>((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.removeEventListener("messageerror", onMessageError);
      options.signal?.removeEventListener("abort", onAbort);
      terminateDensePdfWorker(worker);
    };
    const finish = (result: DensePdfFastWorkerResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };
    const fail = (error: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };
    const onMessage = (event: MessageEvent<unknown>): void => {
      const response = event.data as Partial<DensePdfFastWorkerResponse> | null;
      if (response?.type === "progress" && "progress" in response && response.progress) {
        try {
          options.onProgress?.(response.progress);
        } catch (error) {
          fail(error);
        }
        return;
      }
      if (response?.type === "result" && "result" in response && response.result) {
        finish(response.result);
      }
    };
    const onError = (event: ErrorEvent): void => {
      event.preventDefault();
      finish({
        kind: "error",
        error: {
          name: "WorkerError",
          message: event.message || "The dense PDF worker failed.",
          ...(event.error instanceof Error && event.error.stack ? { stack: event.error.stack } : {})
        }
      });
    };
    const onMessageError = (): void => {
      finish({
        kind: "error",
        error: {
          name: "DataCloneError",
          message: "The dense PDF worker returned an unreadable response."
        }
      });
    };
    const onAbort = (): void => {
      fail(readAbortReason(options.signal));
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.addEventListener("messageerror", onMessageError);
    options.signal?.addEventListener("abort", onAbort, { once: true });

    if (options.signal?.aborted) {
      onAbort();
      return;
    }

    try {
      worker.postMessage(request, [ownedBytes.buffer]);
    } catch (error) {
      finish({ kind: "error", error: serializeError(error) });
    }
  });
}

interface DensePdfWorkerLike {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void
  ): void;
  addEventListener(
    type: "error",
    listener: (event: ErrorEvent) => void
  ): void;
  addEventListener(type: "messageerror", listener: () => void): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void
  ): void;
  removeEventListener(
    type: "error",
    listener: (event: ErrorEvent) => void
  ): void;
  removeEventListener(type: "messageerror", listener: () => void): void;
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
  terminate(): void | Promise<unknown>;
}

interface NodeDenseWorkerLike {
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
  on(type: "message", listener: (message: unknown) => void): void;
  on(type: "error" | "messageerror", listener: (error: Error) => void): void;
  on(type: "exit", listener: (code: number) => void): void;
  terminate(): Promise<number>;
}

async function createDensePdfWorker(): Promise<DensePdfWorkerLike> {
  if (isNodeRuntime()) return await createNodeDensePdfWorker();
  if (typeof Worker !== "function") {
    throw new Error("Module workers are unavailable in this environment.");
  }
  return new Worker(new URL("./densePdfFastWorker.ts", import.meta.url), {
    type: "module",
    name: "hepr-dense-pdf"
  }) as DensePdfWorkerLike;
}

function isNodeRuntime(): boolean {
  const nodeProcess = (globalThis as {
    readonly process?: { readonly versions?: { readonly node?: string } };
  }).process;
  return typeof nodeProcess?.versions?.node === "string";
}

async function createNodeDensePdfWorker(): Promise<DensePdfWorkerLike> {
  const nodeProcess = (globalThis as {
    readonly process?: {
      readonly versions?: { readonly node?: string };
      readonly execArgv?: readonly string[];
      readonly env?: Readonly<Record<string, string | undefined>>;
    };
  }).process;
  if (!nodeProcess?.versions?.node) {
    throw new Error("Node worker_threads are unavailable outside Node.js.");
  }
  const moduleName = "node:worker_threads";
  const module = await import(/* @vite-ignore */ moduleName) as unknown as {
    Worker: new (
      filename: string | URL,
      options: {
        readonly name?: string;
        readonly execArgv?: readonly string[];
        readonly resourceLimits?: { readonly maxOldGenerationSizeMb?: number };
      }
    ) => NodeDenseWorkerLike;
  };
  const currentUrl = new URL(import.meta.url);
  const sourceMode = currentUrl.pathname.endsWith(".ts");
  const workerUrl = sourceMode
    ? createNodeDenseSourceWorkerBootstrapUrl(
        new URL("./densePdfNodeWorkerEntry.ts", currentUrl)
      )
    : new URL("./dense-pdf-worker.js", currentUrl);
  const execArgv = sanitizeNodeDenseWorkerExecArgv(nodeProcess.execArgv ?? []);
  if (sourceMode && !execArgv.some((argument) => argument === "--experimental-strip-types")) {
    execArgv.push("--experimental-strip-types");
  }
  const maxOldGenerationSizeMb = resolveNodeDenseWorkerHeapMb(
    nodeProcess.execArgv ?? [],
    nodeProcess.env ?? {}
  );
  const worker = new module.Worker(workerUrl, {
    name: "hepr-dense-pdf",
    execArgv,
    ...(maxOldGenerationSizeMb === undefined
      ? {}
      : { resourceLimits: { maxOldGenerationSizeMb } })
  });
  return adaptNodeDensePdfWorker(worker);
}

function sanitizeNodeDenseWorkerExecArgv(execArgv: readonly string[]): string[] {
  const output: string[] = [];
  for (let index = 0; index < execArgv.length; index += 1) {
    const argument = execArgv[index];
    const optionName = argument.split("=", 1)[0].replaceAll("_", "-");
    if (NODE_DENSE_WORKER_VALUE_FLAGS.has(optionName)) {
      if (!argument.includes("=")) index += 1;
      continue;
    }
    if (NODE_DENSE_WORKER_BOOLEAN_V8_FLAGS.has(optionName)) continue;
    if (argument === "--input-type") {
      index += 1;
      continue;
    }
    if (argument.startsWith("--input-type=")) continue;
    output.push(argument);
  }
  return output;
}

const NODE_DENSE_WORKER_VALUE_FLAGS = new Set([
  "--max-old-space-size",
  "--max-semi-space-size",
  "--initial-old-space-size",
  "--initial-heap-size",
  "--heap-growing-percent",
  "--stack-size",
  "--stack-trace-limit",
  "--title"
]);

const NODE_DENSE_WORKER_BOOLEAN_V8_FLAGS = new Set([
  "--huge-max-old-generation-size",
  "--optimize-for-size"
]);

function resolveNodeDenseWorkerHeapMb(
  execArgv: readonly string[],
  environment: Readonly<Record<string, string | undefined>>
): number | undefined {
  const configured = parsePositiveInteger(environment.HEPR_PDF_TO_HEP_HEAP_MB);
  if (configured !== undefined) return configured;
  let resolved: number | undefined;
  for (let index = 0; index < execArgv.length; index += 1) {
    const argument = execArgv[index];
    const inline = /^--max[-_]old[-_]space[-_]size=(\d+)$/i.exec(argument);
    if (inline) {
      resolved = parsePositiveInteger(inline[1]);
      continue;
    }
    if (/^--max[-_]old[-_]space[-_]size$/i.test(argument)) {
      resolved = parsePositiveInteger(execArgv[index + 1]);
      index += 1;
    }
  }
  return resolved;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function createNodeDenseSourceWorkerBootstrapUrl(entryUrl: URL): URL {
  const loaderSource = `
    let sourceRootUrl = "";
    export function initialize(data) {
      sourceRootUrl = String(data?.sourceRootUrl ?? "");
    }
    export async function resolve(specifier, context, nextResolve) {
      if (
        sourceRootUrl &&
        context.parentURL?.startsWith(sourceRootUrl) &&
        /^\\.\\.?\\//.test(specifier) &&
        !/\\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
      ) {
        return nextResolve(specifier + ".ts", context);
      }
      return nextResolve(specifier, context);
    }
  `;
  const loaderUrl = `data:text/javascript,${encodeURIComponent(loaderSource)}`;
  const sourceRootUrl = new URL("./", entryUrl).href;
  const bootstrapSource = `
    import { register } from "node:module";
    register(${JSON.stringify(loaderUrl)}, import.meta.url, {
      data: { sourceRootUrl: ${JSON.stringify(sourceRootUrl)} }
    });
    await import(${JSON.stringify(entryUrl.href)});
  `;
  return new URL(`data:text/javascript,${encodeURIComponent(bootstrapSource)}`);
}

function adaptNodeDensePdfWorker(worker: NodeDenseWorkerLike): DensePdfWorkerLike {
  type ListenerMap = {
    message: Set<(event: MessageEvent<unknown>) => void>;
    error: Set<(event: ErrorEvent) => void>;
    messageerror: Set<() => void>;
  };
  const listeners: ListenerMap = {
    message: new Set(),
    error: new Set(),
    messageerror: new Set()
  };
  let terminationRequested = false;
  let resultReceived = false;
  const dispatchError = (error: unknown): void => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    const event = {
      message: normalized.message,
      error: normalized,
      preventDefault() {}
    } as ErrorEvent;
    for (const listener of listeners.error) listener(event);
  };
  worker.on("message", (data) => {
    const candidate = data as Partial<DensePdfFastWorkerResponse> | null;
    if (candidate?.type === "result") resultReceived = true;
    const event = { data } as MessageEvent<unknown>;
    for (const listener of listeners.message) listener(event);
  });
  worker.on("messageerror", () => {
    for (const listener of listeners.messageerror) listener();
  });
  worker.on("error", dispatchError);
  worker.on("exit", (code) => {
    if (!terminationRequested && !resultReceived) {
      dispatchError(new Error(
        `The Node dense PDF worker exited before returning a result (code ${code}).`
      ));
    }
  });

  return {
    addEventListener(type, listener) {
      (listeners[type] as Set<typeof listener>).add(listener);
    },
    removeEventListener(type, listener) {
      (listeners[type] as Set<typeof listener>).delete(listener);
    },
    postMessage(message, transfer) {
      worker.postMessage(message, transfer);
    },
    terminate() {
      if (terminationRequested) return;
      terminationRequested = true;
      return worker.terminate();
    }
  } as DensePdfWorkerLike;
}

function terminateDensePdfWorker(worker: DensePdfWorkerLike): void {
  void Promise.resolve(worker.terminate()).catch(() => {
    // A one-shot worker may already have exited after posting its result.
  });
}

function copyBytes(source: ArrayBuffer | Uint8Array): Uint8Array<ArrayBuffer> {
  const view = source instanceof Uint8Array ? source : new Uint8Array(source);
  return new Uint8Array(view);
}

function readAbortReason(signal: AbortSignal | undefined): unknown {
  if (signal?.reason !== undefined) {
    return signal.reason;
  }
  const error = new Error("The dense PDF operation was aborted.");
  error.name = "AbortError";
  return error;
}

function readErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function serializeError(error: unknown): DensePdfFastWorkerSerializedError {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || String(error),
      ...(error.stack ? { stack: error.stack } : {})
    };
  }
  return { name: "Error", message: String(error) };
}
