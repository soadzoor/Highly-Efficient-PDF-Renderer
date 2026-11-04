import { PaddleOCR } from "@paddleocr/paddleocr-js";
import cvModule from "@techstark/opencv-js";
import type { TextRecognitionResult } from "./textRecognition";
import type { ViewerPaddleOcrAssets, ViewerPaddleOcrOptions, ViewerPaddleOcrProgress } from "./viewerPaddleOcr";

declare const __HEPR_OCR_ORT_VERSION__: string;

interface RecognitionRequest {
  id: number;
  width: number;
  height: number;
  rgba: Uint8Array;
  assets?: ViewerPaddleOcrAssets;
  detectorMaxSide?: ViewerPaddleOcrOptions["detectorMaxSide"];
}

const MODEL_BASE = "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/";
const CACHE_NAME = "hepr-text-recognition-ppocrv6-v1";
const RECOVERY_DETECTOR_MAX_SIDE = 1536;
let client: ReturnType<typeof PaddleOCR.create> | undefined;
let queue = Promise.resolve();
let activeRequest: RecognitionRequest | undefined;
const downloads = new Map<string, { received: number; total?: number; complete: boolean }>();
let lastDownloadProgress = 0;
let forceWasm = false;
let gpuDetectorMaxSide: number | undefined;

type ReadyClient = Awaited<ReturnType<typeof PaddleOCR.create>>;
type RecognitionResult = Awaited<ReturnType<ReadyClient["predict"]>>[number];
type DetectionParameters = NonNullable<Parameters<ReadyClient["predict"]>[1]>;

function detectorParameters(message: RecognitionRequest, automaticSide?: number): DetectionParameters {
  const setting = message.detectorMaxSide ?? automaticSide;
  // Preserve the SDK's normal detection policy until a GPU needs recovery.
  if (setting === undefined) return {};
  const side = setting === "source" ? Math.max(message.width, message.height) : setting;
  if (!Number.isFinite(side) || side <= 0) throw new RangeError("OCR detectorMaxSide must be positive and finite, or 'source'.");
  return {
    textDetLimitType: "max",
    textDetLimitSideLen: side,
    // The SDK also applies a separate 4000px ceiling. Override it explicitly so
    // a caller choosing source resolution can use larger images too.
    textDetMaxSideLimit: Math.ceil(Math.max(32, side) / 32) * 32
  };
}

function usesWebGpu(readyClient: ReadyClient): boolean {
  const summary = readyClient.getInitializationSummary();
  return summary?.detProvider === "webgpu" || summary?.recProvider === "webgpu";
}

function recognitionBackend(readyClient: ReadyClient): "webgpu" | "wasm" | "mixed" {
  const summary = readyClient.getInitializationSummary();
  if (summary?.detProvider === "webgpu" && summary.recProvider === "webgpu") return "webgpu";
  return usesWebGpu(readyClient) ? "mixed" : "wasm";
}

function unusableResult(result: RecognitionResult | undefined): string | null {
  if (!result || !Array.isArray(result.items)) return "missing-result";
  let hasText = false;
  for (const item of result.items) {
    if (!item || typeof item.text !== "string") return "invalid-text";
    if (!/[^\s\ufffd\u0000]/u.test(item.text)) continue;
    hasText = true;
    if (!Array.isArray(item.poly) || item.poly.length < 3 || item.poly.some(point =>
      !Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) return "invalid-text-geometry";
    const xs = item.poly.map(point => point[0]), ys = item.poly.map(point => point[1]);
    if (!(Math.max(...xs) > Math.min(...xs) && Math.max(...ys) > Math.min(...ys))) return "empty-text-geometry";
  }
  if (result.metrics?.detectedBoxes === 0) return "no-detected-text";
  return hasText ? null : "no-recognized-text";
}

function createClient(assets: ViewerPaddleOcrAssets | undefined, backend: "auto" | "wasm") {
  return PaddleOCR.create({
    lang: "en", ocrVersion: "PP-OCRv6", worker: false,
    textDetectionModelName: "PP-OCRv6_small_det",
    textRecognitionModelName: "PP-OCRv6_small_rec",
    textDetectionModelAsset: { url: assets?.detectionModelUrl ?? `${MODEL_BASE}PP-OCRv6_small_det_onnx_infer.tar` },
    textRecognitionModelAsset: { url: assets?.recognitionModelUrl ?? `${MODEL_BASE}PP-OCRv6_small_rec_onnx_infer.tar` },
    // auto tries WebGPU sessions first and falls back to WASM per model.
    // Non-isolated hosting requires one WASM thread; isolated hosts can use
    // ONNX Runtime's device-aware default. HEPR already owns the outer worker.
    ortOptions: { backend, ...(globalThis.crossOriginIsolated ? {} : { numThreads: 1 }), proxy: false,
      wasmPaths: assets?.wasmPath ?? `https://cdn.jsdelivr.net/npm/onnxruntime-web@${__HEPR_OCR_ORT_VERSION__}/dist/` },
    fetch: fetchModel
  });
}

async function predict(readyClient: ReadyClient, mat: Parameters<ReadyClient["predict"]>[0], parameters: DetectionParameters) {
  const started = performance.now();
  const backend = recognitionBackend(readyClient);
  const report = () => reportProgress({ stage: "recognizing", elapsedMs: performance.now() - started, backend });
  report();
  // The SDK exposes timings after inference, but no line-level progress hook.
  // Report elapsed time instead of inventing a completion percentage.
  const timer = setInterval(report, 1000);
  try { return await readyClient.predict(mat, parameters); }
  finally { clearInterval(timer); }
}

function emptyResult(reason: string | null): boolean {
  return reason === "no-detected-text" || reason === "no-recognized-text";
}

function retireClient(readyClient: ReadyClient): void {
  // Device loss can leave GPU cleanup pending. Never hold recognition behind it.
  try { void readyClient.dispose().catch(error => console.warn("[HEPR] Recognition cleanup failed.", error)); }
  catch (error) { console.warn("[HEPR] Recognition cleanup failed.", error); }
}

async function verifyWithCpu(gpuClient: ReadyClient, mat: Parameters<ReadyClient["predict"]>[0],
  parameters: DetectionParameters, assets: ViewerPaddleOcrAssets | undefined, reason: string,
  error?: unknown): Promise<RecognitionResult> {
  const mayBeBlank = emptyResult(reason);
  console.warn("[HEPR] GPU text recognition requires CPU verification.", error ?? reason);
  if (!mayBeBlank) {
    forceWasm = true;
    retireClient(gpuClient);
  }
  reportProgress({ stage: "initializing", backend: "wasm" });
  const pending = createClient(assets, "wasm");
  if (!mayBeBlank) client = pending;
  let cpuClient: ReadyClient | undefined;
  try {
    cpuClient = await pending;
    console.info("[HEPR] CPU recognition verification initialized.", JSON.stringify(cpuClient.getInitializationSummary()));
    const [result] = await predict(cpuClient, mat, parameters);
    const invalid = unusableResult(result);
    if (invalid && !emptyResult(invalid)) throw new Error(`Text recognition returned invalid output (${invalid}).`);
    if (mayBeBlank) {
      if (invalid === null) {
        // CPU found text that the GPU missed. Keep the verified engine warm.
        forceWasm = true;
        client = Promise.resolve(cpuClient);
        retireClient(gpuClient);
      } else {
        // Both engines agree that this page is blank. It does not establish a
        // GPU failure, so let subsequent pages keep using GPU acceleration.
        retireClient(cpuClient);
      }
    }
    return result;
  } catch (failure) {
    if (mayBeBlank && cpuClient) retireClient(cpuClient);
    throw failure;
  }
}

function reportProgress(progress: ViewerPaddleOcrProgress): void {
  if (activeRequest) globalThis.postMessage({ id: activeRequest.id, progress });
}

function reportDownloadProgress(force = false): void {
  const now = performance.now();
  if (!force && now - lastDownloadProgress < 100) return;
  lastDownloadProgress = now;
  const entries = [...downloads.values()];
  const completedBytes = entries.reduce((sum, entry) => sum + entry.received, 0);
  const totalBytes = entries.every(entry => entry.total !== undefined)
    ? entries.reduce((sum, entry) => sum + entry.total!, 0) : undefined;
  reportProgress({ stage: "downloading", completedBytes, ...(totalBytes === undefined ? {} : { totalBytes }) });
}

function trackDownload(response: Response, url: string): Response {
  const contentLength = Number(response.headers.get("content-length"));
  const entry = { received: 0, total: contentLength > 0 ? contentLength : undefined, complete: false };
  downloads.set(url, entry);
  reportDownloadProgress(true);
  if (!response.body) return response;
  const reader = response.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          entry.complete = true;
          reportDownloadProgress(true);
          controller.close();
          if ([...downloads.values()].every(download => download.complete)) reportProgress({ stage: "initializing" });
        } else {
          entry.received += chunk.value.byteLength;
          reportDownloadProgress();
          controller.enqueue(chunk.value);
        }
      } catch (error) { controller.error(error); }
    },
    cancel(reason) { return reader.cancel(reason); }
  });
  return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/** Models are public assets; document pixels are never part of a network request. */
async function fetchModel(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let cache: Cache | undefined;
  try {
    cache = await globalThis.caches?.open(CACHE_NAME);
    const hit = await cache?.match(input);
    if (hit) return hit;
  } catch { /* Cache access can be disabled by the browser's storage policy. */ }
  const response = await fetch(input, init);
  const tracked = response.ok ? trackDownload(response, String(input)) : response;
  if (response.ok && cache) {
    // Cache writes must not delay model initialization or recognition.
    try { void cache.put(input, tracked.clone()).catch(() => {}); }
    catch { /* A failed cache write does not prevent recognition. */ }
  }
  return tracked;
}

async function recognize(message: RecognitionRequest): Promise<void> {
  activeRequest = message;
  const started = performance.now();
  try {
    const assets = message.assets;
    let parameters = detectorParameters(message);
    reportProgress({ stage: "initializing" });
    client ??= createClient(assets, forceWasm ? "wasm" : "auto");
    const readyClient = await client;
    if (usesWebGpu(readyClient) && gpuDetectorMaxSide !== undefined) parameters = detectorParameters(message, gpuDetectorMaxSide);
    console.info("[HEPR] Local recognition runtime initialized.", JSON.stringify(readyClient.getInitializationSummary()));
    // PaddleOCR's ImageData adapter assumes a DOM canvas. Passing a Mat uses
    // its supported clone path and also works in a dedicated module worker.
    // The SDK has already initialized this same OpenCV module. Its legacy
    // `then` resolves to itself: awaiting it would recurse forever.
    const cv = cvModule as unknown as { matFromImageData(image: ImageData): { delete(): void } };
    const image = new ImageData(new Uint8ClampedArray(message.rgba), message.width, message.height);
    const mat = cv.matFromImageData(image);
    let recognized: RecognitionResult | undefined;
    try {
      let prediction: RecognitionResult | undefined;
      let executionError: { value: unknown } | undefined;
      try {
        [prediction] = await predict(readyClient, mat, parameters);
      } catch (error) {
        if (!usesWebGpu(readyClient) || forceWasm) throw error;
        executionError = { value: error };
      }
      if (usesWebGpu(readyClient)) {
        let reason = executionError ? "execution-failed" : unusableResult(prediction);
        if ((executionError || (reason === "no-detected-text" && readyClient.getInitializationSummary()?.detProvider === "webgpu")) &&
            message.detectorMaxSide === undefined && gpuDetectorMaxSide === undefined &&
            Math.max(message.width, message.height) > RECOVERY_DETECTOR_MAX_SIDE) {
          // Large detector tensors can fail silently on a GPU even though its
          // much smaller line-recognition tensors work. Retry only detection
          // at a smaller scale; the SDK still crops lines from the original Mat.
          const compact = detectorParameters(message, RECOVERY_DETECTOR_MAX_SIDE);
          console.warn("[HEPR] Retrying GPU text detection with a smaller detector image; recognition keeps source pixels.",
            JSON.stringify({ reason, ...prediction?.metrics, ...compact }));
          try {
            const [retry] = await predict(readyClient, mat, compact);
            const retryReason = unusableResult(retry);
            if (retryReason === null) {
              recognized = retry;
              parameters = compact;
              gpuDetectorMaxSide = RECOVERY_DETECTOR_MAX_SIDE;
            } else {
              if (!emptyResult(retryReason)) reason = retryReason;
              console.warn("[HEPR] Smaller GPU detector output still requires CPU verification:", JSON.stringify({
                reason: retryReason, ...retry?.metrics, ...retry?.runtime, ...compact }));
            }
          } catch (error) {
            executionError = { value: error };
            reason = "execution-failed";
          }
        }
        if (!recognized && reason) {
          console.warn("[HEPR] GPU recognition output requires CPU verification:", JSON.stringify({ reason,
            ...prediction?.image, ...prediction?.metrics, ...prediction?.runtime, ...parameters }));
          recognized = await verifyWithCpu(readyClient, mat, parameters, assets, reason, executionError?.value);
        }
      }
      recognized ??= prediction;
    } finally { mat.delete(); }
    const invalid = unusableResult(recognized);
    if (!recognized || (invalid && !emptyResult(invalid))) {
      throw new Error(`Text recognition returned invalid output (${invalid}).`);
    }
    console.info("[HEPR] Local text recognition timings:", JSON.stringify({ ...recognized.image,
      ...recognized.metrics, ...recognized.runtime, ...parameters, workerTotalMs: performance.now() - started }));
    const result: TextRecognitionResult = {
      lines: recognized.items.map(item => ({ text: item.text,
        polygon: item.poly.map(point => [point[0], point[1]] as const) }))
    };
    globalThis.postMessage({ id: message.id, result });
  } catch (error) {
    console.error("[HEPR] Local text recognition failed.", error);
    const failedClient = client;
    client = undefined;
    const errorMessage = error && typeof error === "object" && "message" in error
      ? String(error.message) : typeof error === "string" ? error : "Local text recognition failed.";
    globalThis.postMessage({ id: message.id, error: errorMessage });
    try { await (await failedClient)?.dispose(); } catch { /* Initialization can fail before the client exists. */ }
  } finally { activeRequest = undefined; }
}

globalThis.addEventListener("message", event => {
  const request = (event as MessageEvent<RecognitionRequest>).data;
  queue = queue.then(() => recognize(request));
});
