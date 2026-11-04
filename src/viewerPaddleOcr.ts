import type { TextRecognitionInput, TextRecognitionProvider, TextRecognitionResult } from "./textRecognition";

/** Demo asset overrides; a host can serve all recognition assets on its own origin. */
export interface ViewerPaddleOcrAssets {
  detectionModelUrl?: string;
  recognitionModelUrl?: string;
  /** Directory containing the matching ONNX Runtime .mjs and .wasm files. */
  wasmPath?: string;
}

export interface ViewerPaddleOcrOptions {
  assets?: ViewerPaddleOcrAssets;
  /** Optional detector target in pixels, or "source" to retain source resolution. Omitted allows automatic GPU recovery. */
  detectorMaxSide?: number | "source";
  createWorker?: () => Worker;
  onProgress?: (progress: ViewerPaddleOcrProgress) => void;
}

export interface ViewerPaddleOcrProgress {
  stage: "initializing" | "downloading" | "recognizing";
  completedBytes?: number;
  totalBytes?: number;
  elapsedMs?: number;
  backend?: "webgpu" | "wasm" | "mixed";
}

interface PendingRecognition {
  resolve(value: TextRecognitionResult): void;
  reject(reason: unknown): void;
  removeAbort(): void;
}

/** Viewer-only local engine. Construction is lazy and never fetches assets. */
export function createViewerPaddleTextRecognitionProvider(options: ViewerPaddleOcrOptions = {}): TextRecognitionProvider {
  return createViewerPaddleClient(options);
}

export function createViewerPaddleClient(options: ViewerPaddleOcrOptions = {}): TextRecognitionProvider {
  const { detectorMaxSide, createWorker, onProgress } = options;
  if (detectorMaxSide !== undefined && detectorMaxSide !== "source" &&
      (typeof detectorMaxSide !== "number" || !Number.isFinite(detectorMaxSide) || detectorMaxSide <= 0)) {
    throw new RangeError('detectorMaxSide must be a positive finite number or "source".');
  }
  const assets = options.assets ? { ...options.assets } : undefined;
  let worker: Worker | null = null;
  let disposed = false;
  let requestId = 0;
  const pending = new Map<number, PendingRecognition>();

  function stop(reason: unknown): void {
    worker?.terminate();
    worker = null;
    for (const entry of pending.values()) {
      entry.removeAbort();
      entry.reject(reason);
    }
    pending.clear();
  }

  function ensureWorker(): Worker {
    if (worker) return worker;
    worker = createWorker?.() ?? new Worker(new URL("./viewerPaddleOcrWorker.ts", import.meta.url), { type: "module" });
    const activeWorker = worker;
    worker.addEventListener("message", event => {
      if (worker !== activeWorker) return;
      const message = event.data as { id: number; result?: TextRecognitionResult; error?: string; progress?: ViewerPaddleOcrProgress };
      const entry = pending.get(message.id);
      if (!entry) return;
      if (message.progress) {
        try { onProgress?.(message.progress); }
        catch (error) { console.warn("[HEPR] Local recognition progress callback failed.", error); }
      } else if (message.result) {
        pending.delete(message.id);
        entry.removeAbort();
        entry.resolve(message.result);
      } else {
        // The SDK can allocate one model before a second model fails to load.
        // Retire the entire worker so retries cannot retain an unhealthy heap.
        stop(new Error(message.error || "Local text recognition failed."));
      }
    });
    worker.addEventListener("error", event => {
      if (worker === activeWorker) stop(new Error(event.message || "Local text recognition worker failed."));
    });
    worker.addEventListener("messageerror", () => {
      if (worker === activeWorker) stop(new Error("Local text recognition returned an invalid response."));
    });
    return worker;
  }

  return {
    recognize(input: TextRecognitionInput): Promise<TextRecognitionResult> {
      input.signal.throwIfAborted();
      if (disposed) return Promise.reject(new DOMException("Text recognition disposed.", "AbortError"));
      return new Promise((resolve, reject) => {
        const id = ++requestId;
        const abort = () => stop(input.signal.reason);
        pending.set(id, { resolve, reject, removeAbort: () => input.signal.removeEventListener("abort", abort) });
        input.signal.addEventListener("abort", abort, { once: true });
        try {
          // Recognition never transfers or mutates the caller's pixel buffer.
          const rgba = new Uint8Array(input.rgba);
          ensureWorker().postMessage({ id, width: input.width, height: input.height, rgba,
            assets, detectorMaxSide }, [rgba.buffer]);
        } catch (error) {
          stop(error);
        }
      });
    },
    dispose() {
      disposed = true;
      stop(new DOMException("Text recognition disposed.", "AbortError"));
    }
  };
}
