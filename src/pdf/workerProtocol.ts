import type {
  HeprPageData,
  PdfCompileOptions,
  PdfDocumentInfo,
  PdfProgress
} from "../heprDocumentData";
import type { VectorScene } from "../pdfVectorExtractor";
import type { NativeVectorCompileOptions } from "../pdfSession";
import {
  PdfError,
  type PdfDiagnostic,
  type PdfErrorCode,
  type PdfResourceLimits
} from "./nativeTypes";
import type {
  PdfRangeHostMessage,
  PdfRangeWorkerMessage
} from "./rangeTransport";
import type {
  NativeMissingFontRequest,
  NativeMissingFontResult
} from "./nativeFont";
import type {
  NativeImageCodecRequest,
  NativeImageCodecResult
} from "./nativeImage";
import type {
  NativeIccTransformRequest,
  NativeIccTransformResult
} from "./nativeIcc";

// Version 6 transports the established renderer's independent merge/cull
// controls for internal VectorScene compilation. Bumping prevents an older
// emitted worker from silently changing scene semantics.
export const PDF_WORKER_PROTOCOL_VERSION = 6 as const;

/** Clone-safe subset of RequestInit used by the worker's GET-only URL reader. */
export interface PdfWorkerRequestInit {
  readonly cache?: RequestCache;
  readonly credentials?: RequestCredentials;
  readonly headers?: readonly (readonly [string, string])[];
  readonly integrity?: string;
  readonly keepalive?: boolean;
  readonly mode?: RequestMode;
  readonly redirect?: RequestRedirect;
  readonly referrer?: string;
  readonly referrerPolicy?: ReferrerPolicy;
}

export type PdfWorkerSource =
  | {
      readonly kind: "bytes";
      readonly bytes: Uint8Array;
      readonly label?: string;
    }
  | { readonly kind: "blob"; readonly blob: Blob; readonly label?: string }
  | {
      readonly kind: "url";
      readonly url: string;
      readonly request?: PdfWorkerRequestInit;
      readonly label?: string;
    }
  | {
      readonly kind: "remote-range";
      readonly byteLength: number;
      readonly label?: string;
    };

export interface PdfWorkerOpenOptions {
  readonly repair?: "off" | "safe";
  readonly limits?: Partial<PdfResourceLimits>;
  /** The worker should proxy missing-font requests to its owning host. */
  readonly hasMissingFontResolver?: boolean;
  /** The worker should proxy focused image-codec requests to its owning host. */
  readonly hasImageCodecResolver?: boolean;
  /** The worker should proxy batched ICC transform requests to its owning host. */
  readonly hasIccTransformResolver?: boolean;
}

export interface PdfWorkerCompileOptions {
  readonly limits?: Partial<PdfResourceLimits>;
  readonly optimization?: PdfCompileOptions["optimization"];
}

export interface PdfWorkerVectorCompileOptions extends PdfWorkerCompileOptions {
  readonly enableSegmentMerge?: NativeVectorCompileOptions["enableSegmentMerge"];
  readonly enableInvisibleCull?: NativeVectorCompileOptions["enableInvisibleCull"];
}

/** Internal legacy-renderer payload returned by compile-vector-page. */
export interface NativeVectorPageResult {
  readonly scene: VectorScene;
  readonly diagnostics: readonly PdfDiagnostic[];
}

export type PdfWorkerRequest =
  | {
      readonly type: "hepr-pdf-request";
      readonly protocolVersion: typeof PDF_WORKER_PROTOCOL_VERSION;
      readonly requestId: number;
      readonly operation: "open";
      readonly source: PdfWorkerSource;
      readonly options: PdfWorkerOpenOptions;
    }
  | {
      readonly type: "hepr-pdf-request";
      readonly protocolVersion: typeof PDF_WORKER_PROTOCOL_VERSION;
      readonly requestId: number;
      readonly operation: "compile-page";
      readonly sourcePageIndex: number;
      readonly options: PdfWorkerCompileOptions;
    }
  | {
      readonly type: "hepr-pdf-request";
      readonly protocolVersion: typeof PDF_WORKER_PROTOCOL_VERSION;
      readonly requestId: number;
      readonly operation: "compile-vector-page";
      readonly sourcePageIndex: number;
      readonly options: PdfWorkerVectorCompileOptions;
    }
  | {
      readonly type: "hepr-pdf-request";
      readonly protocolVersion: typeof PDF_WORKER_PROTOCOL_VERSION;
      readonly requestId: number;
      readonly operation: "close";
    };

export interface PdfWorkerCancel {
  readonly type: "hepr-pdf-cancel";
  readonly protocolVersion: typeof PDF_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
}

export interface SerializedPdfError {
  readonly name: "PdfError";
  readonly code: PdfErrorCode;
  readonly message: string;
  readonly offset?: number;
  readonly objectNumber?: number;
  readonly pageIndex?: number;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

export type PdfWorkerSuccess =
  | {
      readonly type: "hepr-pdf-result";
      readonly protocolVersion: typeof PDF_WORKER_PROTOCOL_VERSION;
      readonly requestId: number;
      readonly ok: true;
      readonly operation: "open";
      readonly info: PdfDocumentInfo;
      readonly diagnostics: readonly PdfDiagnostic[];
    }
  | {
      readonly type: "hepr-pdf-result";
      readonly protocolVersion: typeof PDF_WORKER_PROTOCOL_VERSION;
      readonly requestId: number;
      readonly ok: true;
      readonly operation: "compile-page";
      readonly page: HeprPageData;
      readonly diagnostics: readonly PdfDiagnostic[];
    }
  | ({
      readonly type: "hepr-pdf-result";
      readonly protocolVersion: typeof PDF_WORKER_PROTOCOL_VERSION;
      readonly requestId: number;
      readonly ok: true;
      readonly operation: "compile-vector-page";
    } & NativeVectorPageResult)
  | {
      readonly type: "hepr-pdf-result";
      readonly protocolVersion: typeof PDF_WORKER_PROTOCOL_VERSION;
      readonly requestId: number;
      readonly ok: true;
      readonly operation: "close";
    };

export interface PdfWorkerFailure {
  readonly type: "hepr-pdf-result";
  readonly protocolVersion: typeof PDF_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly ok: false;
  readonly error: SerializedPdfError;
}

export interface PdfWorkerProgressEvent {
  readonly type: "hepr-pdf-progress";
  readonly protocolVersion: typeof PDF_WORKER_PROTOCOL_VERSION;
  /** Zero denotes the session-level callback supplied while opening. */
  readonly requestId: number;
  readonly progress: PdfProgress;
}

export interface PdfWorkerDiagnosticEvent {
  readonly type: "hepr-pdf-diagnostic";
  readonly protocolVersion: typeof PDF_WORKER_PROTOCOL_VERSION;
  readonly diagnostic: PdfDiagnostic;
}

/** A clone-safe missing-font request sent from the parser worker to its host. */
export interface PdfWorkerFontRequestEvent {
  readonly type: "hepr-pdf-font-request";
  readonly protocolVersion: typeof PDF_WORKER_PROTOCOL_VERSION;
  readonly fontRequestId: number;
  readonly request: NativeMissingFontRequest;
}

/** Cancels only the matching host resolver invocation. */
export interface PdfWorkerFontCancelEvent {
  readonly type: "hepr-pdf-font-cancel";
  readonly protocolVersion: typeof PDF_WORKER_PROTOCOL_VERSION;
  readonly fontRequestId: number;
}

export type PdfWorkerFontResult =
  | {
      readonly type: "hepr-pdf-font-result";
      readonly protocolVersion: typeof PDF_WORKER_PROTOCOL_VERSION;
      readonly fontRequestId: number;
      readonly ok: true;
      readonly resolution: NativeMissingFontResult | null;
    }
  | {
      readonly type: "hepr-pdf-font-result";
      readonly protocolVersion: typeof PDF_WORKER_PROTOCOL_VERSION;
      readonly fontRequestId: number;
      readonly ok: false;
      readonly error: SerializedPdfError;
    };

/** A clone-safe image-codec request sent from the parser worker to its host. */
export interface PdfWorkerImageCodecRequestEvent {
  readonly type: "hepr-pdf-image-codec-request";
  readonly protocolVersion: typeof PDF_WORKER_PROTOCOL_VERSION;
  readonly imageCodecRequestId: number;
  readonly request: NativeImageCodecRequest;
}

/** Cancels only the matching host codec invocation. */
export interface PdfWorkerImageCodecCancelEvent {
  readonly type: "hepr-pdf-image-codec-cancel";
  readonly protocolVersion: typeof PDF_WORKER_PROTOCOL_VERSION;
  readonly imageCodecRequestId: number;
}

export type PdfWorkerImageCodecResult =
  | {
      readonly type: "hepr-pdf-image-codec-result";
      readonly protocolVersion: typeof PDF_WORKER_PROTOCOL_VERSION;
      readonly imageCodecRequestId: number;
      readonly ok: true;
      readonly resolution: NativeImageCodecResult;
    }
  | {
      readonly type: "hepr-pdf-image-codec-result";
      readonly protocolVersion: typeof PDF_WORKER_PROTOCOL_VERSION;
      readonly imageCodecRequestId: number;
      readonly ok: false;
      readonly error: SerializedPdfError;
    };

/** A clone-safe ICC transform request sent from the parser worker to its host. */
export interface PdfWorkerIccTransformRequestEvent {
  readonly type: "hepr-pdf-icc-transform-request";
  readonly protocolVersion: typeof PDF_WORKER_PROTOCOL_VERSION;
  readonly iccTransformRequestId: number;
  readonly request: NativeIccTransformRequest;
}

/** Cancels only the matching host ICC transform invocation. */
export interface PdfWorkerIccTransformCancelEvent {
  readonly type: "hepr-pdf-icc-transform-cancel";
  readonly protocolVersion: typeof PDF_WORKER_PROTOCOL_VERSION;
  readonly iccTransformRequestId: number;
}

export type PdfWorkerIccTransformResult =
  | {
      readonly type: "hepr-pdf-icc-transform-result";
      readonly protocolVersion: typeof PDF_WORKER_PROTOCOL_VERSION;
      readonly iccTransformRequestId: number;
      readonly ok: true;
      readonly resolution: NativeIccTransformResult;
    }
  | {
      readonly type: "hepr-pdf-icc-transform-result";
      readonly protocolVersion: typeof PDF_WORKER_PROTOCOL_VERSION;
      readonly iccTransformRequestId: number;
      readonly ok: false;
      readonly error: SerializedPdfError;
    };

export type PdfWorkerHostToWorkerMessage =
  | PdfWorkerRequest
  | PdfWorkerCancel
  | PdfWorkerFontResult
  | PdfWorkerImageCodecResult
  | PdfWorkerIccTransformResult
  | PdfRangeWorkerMessage;

export type PdfWorkerWorkerToHostMessage =
  | PdfWorkerSuccess
  | PdfWorkerFailure
  | PdfWorkerProgressEvent
  | PdfWorkerDiagnosticEvent
  | PdfWorkerFontRequestEvent
  | PdfWorkerFontCancelEvent
  | PdfWorkerImageCodecRequestEvent
  | PdfWorkerImageCodecCancelEvent
  | PdfWorkerIccTransformRequestEvent
  | PdfWorkerIccTransformCancelEvent
  | PdfRangeHostMessage;

export function serializePdfError(
  error: unknown,
  fallbackCode: PdfErrorCode = "invalid-object"
): SerializedPdfError {
  if (error instanceof PdfError) {
    return {
      name: "PdfError",
      code: error.code,
      message: error.message,
      ...(error.offset === undefined ? {} : { offset: error.offset }),
      ...(error.objectNumber === undefined ? {} : { objectNumber: error.objectNumber }),
      ...(error.pageIndex === undefined ? {} : { pageIndex: error.pageIndex }),
      ...(error.details === undefined ? {} : { details: error.details })
    };
  }
  if (isAbortError(error)) {
    return {
      name: "PdfError",
      code: "aborted",
      message: readErrorMessage(error, "The PDF operation was aborted.")
    };
  }
  return {
    name: "PdfError",
    code: fallbackCode,
    message: readErrorMessage(error, "The PDF worker operation failed.")
  };
}

export function deserializePdfError(error: SerializedPdfError): PdfError {
  return new PdfError(error.code, error.message, {
    offset: error.offset,
    objectNumber: error.objectNumber,
    pageIndex: error.pageIndex,
    details: error.details
  });
}

/** Collect each transferable ArrayBuffer once without traversing Blob payloads. */
export function collectPdfTransferables(value: unknown): Transferable[] {
  const transferables: Transferable[] = [];
  const buffers = new Set<ArrayBuffer>();
  const visited = new Set<object>();
  const visit = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== "object") return;
    if (ArrayBuffer.isView(candidate)) {
      const buffer = candidate.buffer;
      if (buffer instanceof ArrayBuffer && !buffers.has(buffer)) {
        buffers.add(buffer);
        transferables.push(buffer);
      }
      return;
    }
    if (candidate instanceof ArrayBuffer) {
      if (!buffers.has(candidate)) {
        buffers.add(candidate);
        transferables.push(candidate);
      }
      return;
    }
    if (typeof Blob === "function" && candidate instanceof Blob) return;
    if (visited.has(candidate)) return;
    visited.add(candidate);
    if (Array.isArray(candidate)) {
      for (const entry of candidate) visit(entry);
      return;
    }
    for (const entry of Object.values(candidate as Record<string, unknown>)) visit(entry);
  };
  visit(value);
  return transferables;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError" ||
    error instanceof Error && error.name === "AbortError";
}

function readErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
