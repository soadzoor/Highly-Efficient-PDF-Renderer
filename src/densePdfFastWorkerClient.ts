import type {
  DensePdfBounds,
  DensePdfCompiledPage,
  DensePdfMatrix
} from "./densePdfContentCompiler";
import type { PDFLoadProgress } from "./loadProgress";

export type DensePdfFastWorkerStage =
  | "pdf-fast-check"
  | "pdf-fast-decode"
  | "pdf-operators"
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
  textMiniPdfMs: number;
  totalMs: number;
}

export interface DensePdfFastWorkerSuccess {
  kind: "success";
  sourcePageCount: number;
  pages: DensePdfFastCompiledPage[];
  /** Minimal PDF containing the retained text program/resources for PDF.js. */
  textMiniPdfBytes: Uint8Array;
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
 * Attempt the dense-vector PDF path in a short-lived browser worker.
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
  if (typeof Worker !== "function") {
    return {
      kind: "fallback",
      reason: "worker-unavailable",
      message: "The dense PDF path requires browser Worker support."
    };
  }

  let worker: Worker;
  try {
    worker = new Worker(new URL("./densePdfFastWorker.ts", import.meta.url), {
      type: "module",
      name: "hepr-dense-pdf"
    });
  } catch (error) {
    return {
      kind: "fallback",
      reason: "worker-unavailable",
      message: readErrorMessage(error, "Unable to create the dense PDF worker.")
    };
  }

  let ownedBytes: Uint8Array<ArrayBuffer>;
  try {
    ownedBytes = copyBytes(pdfBytes);
  } catch (error) {
    worker.terminate();
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
      worker.terminate();
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
