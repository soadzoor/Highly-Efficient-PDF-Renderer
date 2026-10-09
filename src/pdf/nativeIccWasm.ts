import { PdfError, throwIfAborted } from "./nativeTypes";
import { configureWasm32Memory } from "./nativeWasmMemory";

/** Recoverable failures of the built-in engines, not caller-owned resolvers. */
export class IccEngineError extends PdfError {
  readonly reason: "engine-load-failed" | "profile-unsupported";

  constructor(reason: "engine-load-failed" | "profile-unsupported", cause?: unknown) {
    super("unsupported-color", `The selected ICC engine ${reason === "engine-load-failed" ? "could not load" : "cannot convert this profile"}.`, {
      cause, details: { reason }
    });
    this.reason = reason;
  }
}

/** The engines use unsigned 32-bit pointers. Memory grows on demand. */
export const ICC_WASM_MAX_BYTES = 2 ** 32;

export function iccMemoryError(cause?: unknown): PdfError {
  return new PdfError("resource-limit", "The ICC engine exceeded its working-memory limit.", {
    cause, details: { limit: ICC_WASM_MAX_BYTES }
  });
}

/** Cache code only. Each transform gets a fresh instance that grows on demand. */
export function createIccModuleLoader(url: URL, byteLength: number): (signal?: AbortSignal) => Promise<WebAssembly.Module> {
  let pending: Promise<WebAssembly.Module> | undefined;
  return async signal => {
    throwIfAborted(signal);
    if (!pending) {
      pending = (async () => {
        let bytes: Uint8Array<ArrayBuffer>;
        if (url.protocol === "file:") {
          const specifier = "node:fs/promises";
          const fs = await import(/* @vite-ignore */ specifier) as {
            readFile(url: URL): Promise<Uint8Array>;
          };
          bytes = new Uint8Array(await fs.readFile(url));
        } else {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`ICC asset HTTP ${response.status}.`);
          bytes = new Uint8Array(await response.arrayBuffer());
        }
        if (bytes.byteLength !== byteLength) throw new Error("ICC asset length mismatch.");
        return await WebAssembly.compile(configureWasm32Memory(bytes));
      })().catch(cause => {
        pending = undefined;
        if (cause instanceof PdfError) throw cause;
        if (cause instanceof RangeError) throw iccMemoryError(cause);
        throw new IccEngineError("engine-load-failed", cause);
      });
    }
    // Aborting one session must not abort another session's shared module load.
    return await waitForIccOperation(pending, signal);
  };
}

export async function waitForIccOperation<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return await operation;
  return await new Promise<T>((resolve, reject) => {
    const abort = () => {
      try { throwIfAborted(signal); } catch (error) { reject(error); }
    };
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function yieldIccConversion(signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  throwIfAborted(signal);
}
