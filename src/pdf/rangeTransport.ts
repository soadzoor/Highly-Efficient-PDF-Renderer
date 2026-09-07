import { PdfError, type PdfSource } from "./nativeTypes";

export type PdfRangeRequestMessage = {
  readonly type: "pdf-range-read";
  readonly requestId: number;
  readonly offset: number;
  readonly length: number;
};

export type PdfRangeCancelMessage = {
  readonly type: "pdf-range-cancel";
  readonly requestId: number;
};

export type PdfRangeCloseMessage = { readonly type: "pdf-range-close" };

export type PdfRangeHostMessage =
  | PdfRangeRequestMessage
  | PdfRangeCancelMessage
  | PdfRangeCloseMessage;

export type PdfRangeSuccessMessage = {
  readonly type: "pdf-range-result";
  readonly requestId: number;
  readonly ok: true;
  readonly bytes: Uint8Array;
};

export type PdfRangeFailureMessage = {
  readonly type: "pdf-range-result";
  readonly requestId: number;
  readonly ok: false;
  readonly error: SerializedPdfRangeError;
};

export type PdfRangeWorkerMessage = PdfRangeSuccessMessage | PdfRangeFailureMessage;

export interface SerializedPdfRangeError {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
}

export interface PdfMessageEndpoint<Incoming, Outgoing> {
  addEventListener(type: "message", listener: (event: MessageEvent<Incoming>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<Incoming>) => void): void;
  postMessage(message: Outgoing, transfer?: Transferable[]): void;
}

/** Host half of the range-read protocol used by browser and Node workers. */
export function servePdfRangeSource(
  source: Extract<PdfSource, { kind: "range" }>,
  endpoint: PdfMessageEndpoint<PdfRangeHostMessage, PdfRangeWorkerMessage>
): { close(): Promise<void> } {
  if (!Number.isSafeInteger(source.byteLength) || source.byteLength < 0) {
    throw new RangeError("Hosted PDF source length must be a non-negative safe integer.");
  }
  const active = new Map<number, AbortController>();
  let closed = false;
  let closePromise: Promise<void> | null = null;

  const listener = (event: MessageEvent<PdfRangeHostMessage>): void => {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === "pdf-range-cancel") {
      active.get(message.requestId)?.abort(
        new PdfError("aborted", "The worker cancelled the PDF range read.")
      );
      return;
    }
    if (message.type === "pdf-range-close") {
      void close().catch(() => undefined);
      return;
    }
    if (message.type !== "pdf-range-read") return;
    void handleRead(message);
  };

  const handleRead = async (message: PdfRangeRequestMessage): Promise<void> => {
    if (closed) {
      postFailure(message.requestId, new PdfError("closed", "The PDF range host is closed."));
      return;
    }
    if (active.has(message.requestId)) {
      postFailure(message.requestId, new PdfError("source-read", "Duplicate PDF range request id."));
      return;
    }
    if (!validRange(message.offset, message.length, source.byteLength)) {
      postFailure(message.requestId, new RangeError("Worker PDF range request is outside the source."));
      return;
    }
    const controller = new AbortController();
    active.set(message.requestId, controller);
    try {
      const received = await source.read(
        message.offset,
        message.length,
        controller.signal
      );
      if (!(received instanceof Uint8Array) || received.length !== message.length) {
        throw new PdfError("source-read", "The PDF range callback returned an unexpected byte count.", {
          details: {
            offset: message.offset,
            requestedLength: message.length,
            receivedLength: received instanceof Uint8Array ? received.length : -1
          }
        });
      }
      if (closed || controller.signal.aborted) return;
      // Always transfer a tightly owned buffer. A callback is permitted to
      // return a view into a cache that must remain valid on the host.
      const bytes = received.slice();
      endpoint.postMessage(
        { type: "pdf-range-result", requestId: message.requestId, ok: true, bytes },
        [bytes.buffer]
      );
    } catch (error) {
      if (!closed && !controller.signal.aborted) postFailure(message.requestId, error);
    } finally {
      if (active.get(message.requestId) === controller) active.delete(message.requestId);
    }
  };

  const postFailure = (requestId: number, error: unknown): void => {
    try {
      endpoint.postMessage({
        type: "pdf-range-result",
        requestId,
        ok: false,
        error: serializeRangeError(error)
      });
    } catch {
      // A terminated worker has no pending request left to receive the error.
    }
  };

  const close = async (): Promise<void> => {
    if (closePromise) return await closePromise;
    closed = true;
    endpoint.removeEventListener("message", listener);
    for (const controller of active.values()) {
      controller.abort(new PdfError("closed", "The PDF range host is closing."));
    }
    active.clear();
    closePromise = Promise.resolve().then(() => source.close?.()).then(() => undefined);
    return await closePromise;
  };

  endpoint.addEventListener("message", listener);
  return { close };
}

/** Worker half of the protocol, surfaced as an ordinary `PdfSource`. */
export function createRemoteRangePdfSource(
  byteLength: number,
  endpoint: PdfMessageEndpoint<PdfRangeWorkerMessage, PdfRangeHostMessage>,
  label?: string
): Extract<PdfSource, { kind: "range" }> {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new RangeError("Remote PDF source length must be a non-negative safe integer.");
  }
  let nextRequestId = 1;
  let closed = false;
  const pending = new Map<number, {
    resolve(bytes: Uint8Array): void;
    reject(error: unknown): void;
  }>();

  const listener = (event: MessageEvent<PdfRangeWorkerMessage>): void => {
    const message = event.data;
    if (!message || message.type !== "pdf-range-result") return;
    const request = pending.get(message.requestId);
    if (!request) return;
    pending.delete(message.requestId);
    if (message.ok === true) {
      if (!(message.bytes instanceof Uint8Array)) {
        request.reject(new PdfError("source-read", "The remote PDF range result did not contain bytes."));
      } else {
        request.resolve(message.bytes);
      }
    } else if (message.ok === false) {
      request.reject(deserializeRangeError(message.error));
    } else {
      request.reject(new PdfError("source-read", "The remote PDF range result is malformed."));
    }
  };
  endpoint.addEventListener("message", listener);

  return {
    kind: "range",
    byteLength,
    label,
    read(offset, length, signal) {
      signal.throwIfAborted();
      if (closed) return Promise.reject(new PdfError("closed", "The remote PDF source is closed."));
      if (!validRange(offset, length, byteLength)) {
        return Promise.reject(new RangeError("Remote PDF source read is outside the source."));
      }
      if (length === 0) return Promise.resolve(new Uint8Array());
      const requestId = allocateRequestId();
      return new Promise<Uint8Array>((resolve, reject) => {
        const abort = (): void => {
          if (!pending.delete(requestId)) return;
          try {
            endpoint.postMessage({ type: "pdf-range-cancel", requestId });
          } catch {
            // Cancellation still has a local terminal outcome.
          }
          reject(signal.reason ?? new DOMException("The PDF range read was aborted.", "AbortError"));
        };
        pending.set(requestId, {
          resolve(bytes) {
            signal.removeEventListener("abort", abort);
            if (!(bytes instanceof Uint8Array) || bytes.length !== length) {
              reject(new PdfError("source-read", "The remote PDF range result has an unexpected length.", {
                details: {
                  offset,
                  requestedLength: length,
                  receivedLength: bytes instanceof Uint8Array ? bytes.length : -1
                }
              }));
              return;
            }
            resolve(bytes);
          },
          reject(error) {
            signal.removeEventListener("abort", abort);
            reject(error);
          }
        });
        signal.addEventListener("abort", abort, { once: true });
        try {
          endpoint.postMessage({ type: "pdf-range-read", requestId, offset, length });
        } catch (cause) {
          const request = pending.get(requestId);
          if (!request) return;
          pending.delete(requestId);
          request.reject(new PdfError("source-read", "Unable to send the remote PDF range request.", {
            cause
          }));
        }
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      endpoint.removeEventListener("message", listener);
      const error = new PdfError("closed", "The remote PDF source is closed.");
      for (const request of pending.values()) request.reject(error);
      pending.clear();
      try {
        endpoint.postMessage({ type: "pdf-range-close" });
      } catch {
        // The endpoint may already have terminated; local cleanup is complete.
      }
    }
  };

  function allocateRequestId(): number {
    const start = nextRequestId;
    do {
      const candidate = nextRequestId;
      nextRequestId += 1;
      if (!Number.isSafeInteger(nextRequestId)) nextRequestId = 1;
      if (!pending.has(candidate)) return candidate;
    } while (nextRequestId !== start);
    throw new PdfError("resource-limit", "The remote PDF range request id space is exhausted.");
  }
}

function validRange(offset: number, length: number, byteLength: number): boolean {
  const end = offset + length;
  return Number.isSafeInteger(offset) && Number.isSafeInteger(length) &&
    Number.isSafeInteger(end) && offset >= 0 && length >= 0 && end <= byteLength;
}

function serializeRangeError(error: unknown): SerializedPdfRangeError {
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
    return { name: error.name, message: error.message, ...(code ? { code } : {}) };
  }
  return { name: "Error", message: String(error) };
}

function deserializeRangeError(error: SerializedPdfRangeError): Error {
  if (!error || typeof error !== "object" || typeof error.message !== "string") {
    return new PdfError("source-read", "The remote PDF range error is malformed.");
  }
  if (error.code) {
    return new PdfError(error.code as ConstructorParameters<typeof PdfError>[0], error.message);
  }
  const result = new Error(error.message);
  result.name = error.name;
  return result;
}
