import {
  openPdf,
  type NativeVectorCompileOptions,
  type NativeVectorPdfSession
} from "../pdfSession";
import type {
  NativeMissingFontResolver,
  NativeMissingFontResult
} from "./nativeFont";
import type {
  NativeImageCodecRequest,
  NativeImageCodecResolver,
  NativeImageCodecResult
} from "./nativeImage";
import type {
  NativeIccTransformRequest,
  NativeIccTransformResolver,
  NativeIccTransformResult
} from "./nativeIcc";
import { PdfError, type PdfSource } from "./nativeTypes";
import {
  createRemoteRangePdfSource,
  type PdfMessageEndpoint
} from "./rangeTransport";
import {
  PDF_WORKER_PROTOCOL_VERSION,
  collectPdfTransferables,
  deserializePdfError,
  serializePdfError,
  type PdfWorkerHostToWorkerMessage,
  type PdfWorkerRequest,
  type PdfWorkerSource,
  type PdfWorkerWorkerToHostMessage
} from "./workerProtocol";

export interface PdfWorkerRuntime {
  /** Stop accepting requests and release the session without posting a result. */
  close(): Promise<void>;
}

/**
 * Attach the dependency-free PDF session engine to a browser Worker or an
 * adapted Node MessagePort. Requests are serialized; cancellation messages
 * bypass the queue and abort only their matching operation.
 */
export function attachPdfWorkerRuntime(
  endpoint: PdfMessageEndpoint<PdfWorkerHostToWorkerMessage, PdfWorkerWorkerToHostMessage>
): PdfWorkerRuntime {
  let session: NativeVectorPdfSession | null = null;
  let stopped = false;
  let closing: Promise<void> | null = null;
  let operationTail: Promise<void> = Promise.resolve();
  const controllers = new Map<number, AbortController>();
  const pendingFontRequests = new Map<number, {
    resolve(result: NativeMissingFontResult | null): void;
    reject(error: unknown): void;
    removeAbort(): void;
  }>();
  let nextFontRequestId = 1;
  const pendingImageCodecRequests = new Map<number, {
    resolve(result: NativeImageCodecResult): void;
    reject(error: unknown): void;
    removeAbort(): void;
  }>();
  let nextImageCodecRequestId = 1;
  const pendingIccTransformRequests = new Map<number, {
    resolve(result: NativeIccTransformResult): void;
    reject(error: unknown): void;
    removeAbort(): void;
  }>();
  let nextIccTransformRequestId = 1;

  const listener = (event: MessageEvent<PdfWorkerHostToWorkerMessage>): void => {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === "hepr-pdf-icc-transform-result") {
      const pending = pendingIccTransformRequests.get(message.iccTransformRequestId);
      if (!pending) return;
      pendingIccTransformRequests.delete(message.iccTransformRequestId);
      pending.removeAbort();
      if (message.protocolVersion !== PDF_WORKER_PROTOCOL_VERSION) {
        pending.reject(new PdfError(
          "invalid-object",
          `Unsupported PDF worker protocol version ${String(message.protocolVersion)}.`
        ));
      } else if (message.ok) {
        pending.resolve(message.resolution);
      } else {
        pending.reject(deserializePdfError(message.error));
      }
      return;
    }
    if (message.type === "hepr-pdf-image-codec-result") {
      const pending = pendingImageCodecRequests.get(message.imageCodecRequestId);
      if (!pending) return;
      pendingImageCodecRequests.delete(message.imageCodecRequestId);
      pending.removeAbort();
      if (message.protocolVersion !== PDF_WORKER_PROTOCOL_VERSION) {
        pending.reject(new PdfError(
          "invalid-object",
          `Unsupported PDF worker protocol version ${String(message.protocolVersion)}.`
        ));
      } else if (message.ok) {
        pending.resolve(message.resolution);
      } else {
        pending.reject(deserializePdfError(message.error));
      }
      return;
    }
    if (message.type === "hepr-pdf-font-result") {
      const pending = pendingFontRequests.get(message.fontRequestId);
      if (!pending) return;
      pendingFontRequests.delete(message.fontRequestId);
      pending.removeAbort();
      if (message.protocolVersion !== PDF_WORKER_PROTOCOL_VERSION) {
        pending.reject(new PdfError(
          "invalid-object",
          `Unsupported PDF worker protocol version ${String(message.protocolVersion)}.`
        ));
      } else if (message.ok) {
        pending.resolve(message.resolution);
      } else {
        pending.reject(deserializePdfError(message.error));
      }
      return;
    }
    if (message.type === "hepr-pdf-cancel") {
      controllers.get(message.requestId)?.abort(
        new PdfError("aborted", "The host cancelled the PDF worker operation.")
      );
      return;
    }
    if (message.type !== "hepr-pdf-request") return;
    if (message.operation === "close") {
      void handleCloseRequest(message);
      return;
    }
    const controller = new AbortController();
    controllers.set(message.requestId, controller);
    operationTail = operationTail.then(
      () => handleRequest(message, controller),
      () => handleRequest(message, controller)
    );
  };

  const handleRequest = async (
    request: Exclude<PdfWorkerRequest, { operation: "close" }>,
    controller: AbortController
  ): Promise<void> => {
    try {
      validateRequest(request);
      if (stopped) throw new PdfError("closed", "The PDF worker is closed.");
      controller.signal.throwIfAborted();
      if (request.operation === "open") {
        if (session) throw new PdfError("invalid-object", "The PDF worker session is already open.");
        const source = materializeSource(request.source, endpoint);
        let openedSession: NativeVectorPdfSession;
        try {
          const {
            hasMissingFontResolver,
            hasImageCodecResolver,
            hasIccTransformResolver,
            ...nativeOpenOptions
          } = request.options;
          openedSession = await openPdf(source, {
            ...nativeOpenOptions,
            signal: controller.signal,
            missingFontResolver: hasMissingFontResolver
              ? resolveMissingFontThroughHost
              : undefined,
            imageCodecResolver: hasImageCodecResolver
              ? resolveImageCodecThroughHost
              : undefined,
            iccTransformResolver: hasIccTransformResolver
              ? resolveIccTransformThroughHost
              : undefined,
            onProgress: (progress) => endpoint.postMessage({
              type: "hepr-pdf-progress",
              protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
              requestId: 0,
              progress
            }),
            onDiagnostic: (diagnostic) => endpoint.postMessage({
              type: "hepr-pdf-diagnostic",
              protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
              diagnostic
            })
          }) as NativeVectorPdfSession;
        } catch (error) {
          if (source.kind === "range") {
            await Promise.resolve().then(() => source.close?.()).catch(() => undefined);
          }
          throw error;
        }
        if (stopped) {
          await openedSession.close();
          throw new PdfError("closed", "The PDF worker closed while the document was opening.");
        }
        session = openedSession;
        endpoint.postMessage({
          type: "hepr-pdf-result",
          protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
          requestId: request.requestId,
          ok: true,
          operation: "open",
          info: session.info,
          diagnostics: session.getDiagnostics()
        });
        return;
      }

      const activeSession = session;
      if (!activeSession) throw new PdfError("closed", "The PDF worker session is not open.");
      const compileOptions: NativeVectorCompileOptions = {
        ...request.options,
        signal: controller.signal,
        onProgress: (progress) => endpoint.postMessage({
          type: "hepr-pdf-progress",
          protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
          requestId: request.requestId,
          progress
        })
      };
      if (request.operation === "compile-vector-page") {
        const scene = await activeSession.compileVectorPage(
          request.sourcePageIndex,
          compileOptions
        );
        const response = {
          type: "hepr-pdf-result" as const,
          protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
          requestId: request.requestId,
          ok: true as const,
          operation: "compile-vector-page" as const,
          scene,
          diagnostics: activeSession.getDiagnostics()
        };
        endpoint.postMessage(response, collectPdfTransferables(scene));
        return;
      }
      const page = await activeSession.compilePage(request.sourcePageIndex, compileOptions);
      const response = {
        type: "hepr-pdf-result" as const,
        protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
        requestId: request.requestId,
        ok: true as const,
        operation: "compile-page" as const,
        page,
        diagnostics: activeSession.getDiagnostics()
      };
      endpoint.postMessage(response, collectPdfTransferables(page));
    } catch (error) {
      postFailure(request.requestId, error);
    } finally {
      controllers.delete(request.requestId);
    }
  };

  const handleCloseRequest = async (
    request: Extract<PdfWorkerRequest, { operation: "close" }>
  ): Promise<void> => {
    try {
      validateRequest(request);
      await stop();
      endpoint.postMessage({
        type: "hepr-pdf-result",
        protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
        requestId: request.requestId,
        ok: true,
        operation: "close"
      });
    } catch (error) {
      postFailure(request.requestId, error);
    }
  };

  const postFailure = (requestId: number, error: unknown): void => {
    endpoint.postMessage({
      type: "hepr-pdf-result",
      protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
      requestId,
      ok: false,
      error: serializePdfError(error)
    });
  };

  const stop = (): Promise<void> => {
    if (closing) return closing;
    stopped = true;
    for (const controller of controllers.values()) {
      controller.abort(new PdfError("closed", "The PDF worker is closing."));
    }
    controllers.clear();
    const fontError = new PdfError("closed", "The PDF worker is closing.");
    for (const [fontRequestId, pending] of pendingFontRequests) {
      pending.removeAbort();
      pending.reject(fontError);
      try {
        endpoint.postMessage({
          type: "hepr-pdf-font-cancel",
          protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
          fontRequestId
        });
      } catch {
        // Closing remains best effort after the pending promise is rejected.
      }
    }
    pendingFontRequests.clear();
    const imageCodecError = new PdfError("closed", "The PDF worker is closing.");
    for (const [imageCodecRequestId, pending] of pendingImageCodecRequests) {
      pending.removeAbort();
      pending.reject(imageCodecError);
      try {
        endpoint.postMessage({
          type: "hepr-pdf-image-codec-cancel",
          protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
          imageCodecRequestId
        });
      } catch {
        // Closing remains best effort after the pending promise is rejected.
      }
    }
    pendingImageCodecRequests.clear();
    const iccTransformError = new PdfError("closed", "The PDF worker is closing.");
    for (const [iccTransformRequestId, pending] of pendingIccTransformRequests) {
      pending.removeAbort();
      pending.reject(iccTransformError);
      try {
        endpoint.postMessage({
          type: "hepr-pdf-icc-transform-cancel",
          protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
          iccTransformRequestId
        });
      } catch {
        // Closing remains best effort after the pending promise is rejected.
      }
    }
    pendingIccTransformRequests.clear();
    const activeSession = session;
    session = null;
    closing = (activeSession?.close() ?? Promise.resolve()).finally(() => {
      endpoint.removeEventListener("message", listener);
    });
    return closing;
  };

  endpoint.addEventListener("message", listener);
  return { close: stop };

  function resolveMissingFontThroughHost(
    request: Parameters<NativeMissingFontResolver>[0],
    signal?: AbortSignal
  ): Promise<NativeMissingFontResult | null> {
    if (stopped) {
      return Promise.reject(new PdfError("closed", "The PDF worker is closed."));
    }
    if (signal?.aborted) {
      return Promise.reject(new PdfError("aborted", "The missing-font request was aborted.", {
        cause: signal.reason
      }));
    }
    const fontRequestId = allocateFontRequestId();
    return new Promise<NativeMissingFontResult | null>((resolve, reject) => {
      const abort = (): void => {
        const pending = pendingFontRequests.get(fontRequestId);
        if (!pending) return;
        pendingFontRequests.delete(fontRequestId);
        pending.removeAbort();
        try {
          endpoint.postMessage({
            type: "hepr-pdf-font-cancel",
            protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
            fontRequestId
          });
        } catch {
          // The local cancellation remains the primary failure.
        }
        reject(new PdfError("aborted", "The missing-font request was aborted.", {
          cause: signal?.reason
        }));
      };
      const removeAbort = (): void => signal?.removeEventListener("abort", abort);
      pendingFontRequests.set(fontRequestId, { resolve, reject, removeAbort });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        endpoint.postMessage({
          type: "hepr-pdf-font-request",
          protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
          fontRequestId,
          request
        });
      } catch (cause) {
        pendingFontRequests.delete(fontRequestId);
        removeAbort();
        reject(new PdfError(
          "worker-crash",
          "Unable to send a missing-font request to the worker host.",
          { cause }
        ));
      }
    });
  }

  function allocateFontRequestId(): number {
    const start = nextFontRequestId;
    do {
      const requestId = nextFontRequestId;
      nextFontRequestId += 1;
      if (!Number.isSafeInteger(nextFontRequestId)) nextFontRequestId = 1;
      if (!pendingFontRequests.has(requestId)) return requestId;
    } while (nextFontRequestId !== start);
    throw new PdfError("resource-limit", "The PDF worker font request id space is exhausted.");
  }

  function resolveImageCodecThroughHost(
    request: Parameters<NativeImageCodecResolver>[0],
    signal?: AbortSignal
  ): Promise<NativeImageCodecResult> {
    if (stopped) {
      return Promise.reject(new PdfError("closed", "The PDF worker is closed."));
    }
    if (signal?.aborted) {
      return Promise.reject(new PdfError("aborted", "The image-codec request was aborted.", {
        cause: signal.reason
      }));
    }
    const imageCodecRequestId = allocateImageCodecRequestId();
    return new Promise<NativeImageCodecResult>((resolve, reject) => {
      const abort = (): void => {
        const pending = pendingImageCodecRequests.get(imageCodecRequestId);
        if (!pending) return;
        pendingImageCodecRequests.delete(imageCodecRequestId);
        pending.removeAbort();
        try {
          endpoint.postMessage({
            type: "hepr-pdf-image-codec-cancel",
            protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
            imageCodecRequestId
          });
        } catch {
          // The local cancellation remains the primary failure.
        }
        reject(new PdfError("aborted", "The image-codec request was aborted.", {
          cause: signal?.reason
        }));
      };
      const removeAbort = (): void => signal?.removeEventListener("abort", abort);
      pendingImageCodecRequests.set(imageCodecRequestId, { resolve, reject, removeAbort });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        const hostRequest = transferImageCodecRequestToHost(request);
        endpoint.postMessage({
          type: "hepr-pdf-image-codec-request",
          protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
          imageCodecRequestId,
          request: hostRequest
        }, collectPdfTransferables(hostRequest));
      } catch (cause) {
        pendingImageCodecRequests.delete(imageCodecRequestId);
        removeAbort();
        reject(new PdfError(
          "worker-crash",
          "Unable to send an image-codec request to the worker host.",
          { cause }
        ));
      }
    });
  }

  function allocateImageCodecRequestId(): number {
    const start = nextImageCodecRequestId;
    do {
      const requestId = nextImageCodecRequestId;
      nextImageCodecRequestId += 1;
      if (!Number.isSafeInteger(nextImageCodecRequestId)) nextImageCodecRequestId = 1;
      if (!pendingImageCodecRequests.has(requestId)) return requestId;
    } while (nextImageCodecRequestId !== start);
    throw new PdfError("resource-limit", "The PDF worker image-codec request id space is exhausted.");
  }

  function resolveIccTransformThroughHost(
    request: Parameters<NativeIccTransformResolver>[0],
    signal?: AbortSignal
  ): Promise<NativeIccTransformResult> {
    if (stopped) {
      return Promise.reject(new PdfError("closed", "The PDF worker is closed."));
    }
    if (signal?.aborted) {
      return Promise.reject(new PdfError("aborted", "The ICC transform request was aborted.", {
        cause: signal.reason
      }));
    }
    const iccTransformRequestId = allocateIccTransformRequestId();
    return new Promise<NativeIccTransformResult>((resolve, reject) => {
      const abort = (): void => {
        const pending = pendingIccTransformRequests.get(iccTransformRequestId);
        if (!pending) return;
        pendingIccTransformRequests.delete(iccTransformRequestId);
        pending.removeAbort();
        try {
          endpoint.postMessage({
            type: "hepr-pdf-icc-transform-cancel",
            protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
            iccTransformRequestId
          });
        } catch {
          // The local cancellation remains the primary failure.
        }
        reject(new PdfError("aborted", "The ICC transform request was aborted.", {
          cause: signal?.reason
        }));
      };
      const removeAbort = (): void => signal?.removeEventListener("abort", abort);
      pendingIccTransformRequests.set(iccTransformRequestId, { resolve, reject, removeAbort });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        const hostRequest = transferIccTransformRequestToHost(request);
        endpoint.postMessage({
          type: "hepr-pdf-icc-transform-request",
          protocolVersion: PDF_WORKER_PROTOCOL_VERSION,
          iccTransformRequestId,
          request: hostRequest
        }, collectPdfTransferables(hostRequest));
      } catch (cause) {
        pendingIccTransformRequests.delete(iccTransformRequestId);
        removeAbort();
        reject(new PdfError(
          "worker-crash",
          "Unable to send an ICC transform request to the worker host.",
          { cause }
        ));
      }
    });
  }

  function allocateIccTransformRequestId(): number {
    const start = nextIccTransformRequestId;
    do {
      const requestId = nextIccTransformRequestId;
      nextIccTransformRequestId += 1;
      if (!Number.isSafeInteger(nextIccTransformRequestId)) nextIccTransformRequestId = 1;
      if (!pendingIccTransformRequests.has(requestId)) return requestId;
    } while (nextIccTransformRequestId !== start);
    throw new PdfError("resource-limit", "The PDF worker ICC transform request id space is exhausted.");
  }
}

function transferImageCodecRequestToHost(
  request: Readonly<NativeImageCodecRequest>
): NativeImageCodecRequest {
  // NativePdfImageRegistry gives the resolver isolated input arrays. The proxy
  // can transfer those owned copies directly without detaching PDF source data
  // or paying for a second worker-side clone.
  return Object.freeze({ ...request });
}

function transferIccTransformRequestToHost(
  request: Readonly<NativeIccTransformRequest>
): NativeIccTransformRequest {
  // NativePdfColorRegistry creates isolated profile and lattice arrays for each
  // resolver invocation, so the proxy can transfer them without detaching the
  // profile retained in the page color store.
  return Object.freeze({
    ...request,
    metadata: Object.freeze({ ...request.metadata })
  });
}

function materializeSource(
  source: PdfWorkerSource,
  endpoint: PdfMessageEndpoint<PdfWorkerHostToWorkerMessage, PdfWorkerWorkerToHostMessage>
): PdfSource {
  switch (source.kind) {
    case "bytes":
      if (!(source.bytes instanceof Uint8Array)) {
        throw new PdfError("source-read", "The worker received an invalid byte source.");
      }
      return { kind: "bytes", bytes: source.bytes, ownership: "transfer", label: source.label };
    case "blob":
      if (!(source.blob instanceof Blob)) {
        throw new PdfError("source-read", "The worker received an invalid Blob source.");
      }
      return { kind: "blob", blob: source.blob, label: source.label };
    case "url":
      return {
        kind: "url",
        url: source.url,
        request: deserializeRequestInit(source.request),
        label: source.label
      };
    case "remote-range":
      return createRemoteRangePdfSource(
        source.byteLength,
        endpoint as unknown as Parameters<typeof createRemoteRangePdfSource>[1],
        source.label
      );
  }
}

function deserializeRequestInit(
  request: Extract<PdfWorkerSource, { kind: "url" }>["request"]
): RequestInit | undefined {
  if (!request) return undefined;
  return {
    ...request,
    headers: request.headers?.map(([name, value]) => [name, value])
  };
}

function validateRequest(request: PdfWorkerRequest): void {
  if (request.protocolVersion !== PDF_WORKER_PROTOCOL_VERSION) {
    throw new PdfError(
      "invalid-object",
      `Unsupported PDF worker protocol version ${String(request.protocolVersion)}.`
    );
  }
  if (!Number.isSafeInteger(request.requestId) || request.requestId <= 0) {
    throw new PdfError("invalid-object", "The PDF worker request id is invalid.");
  }
}
