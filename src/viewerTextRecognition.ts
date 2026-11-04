import { waitForTextRecognition, type TextRecognitionProgress, type TextRecognitionProvider,
  type TextRecognitionResult, type TextRecognitionSetting } from "./textRecognition";
import type { ViewerPaddleOcrAssets, ViewerPaddleOcrOptions, ViewerPaddleOcrProgress } from "./viewerPaddleOcr";
import "./viewerTextRecognition.css";

const CONSENT_KEY = "hepr.local-text-recognition.enabled.v1";
const ENABLED_KEY = "hepr.text-recognition.enabled.v1";

export interface ViewerTextRecognitionControlsOptions {
  onSettingsChange(setting: TextRecognitionSetting): void;
  assets?: ViewerPaddleOcrAssets;
  detectorMaxSide?: ViewerPaddleOcrOptions["detectorMaxSide"];
}

export interface ViewerTextRecognitionControls {
  readonly element: HTMLDivElement;
  readonly settings: TextRecognitionSetting;
  setProgress(progress: TextRecognitionProgress): void;
  setDocumentAvailable(available: boolean): void;
  dispose(): void;
}

/** Shared example-viewer controls. The optional engine loads only after consent. */
export function createViewerTextRecognitionControls(options: ViewerTextRecognitionControlsOptions): ViewerTextRecognitionControls {
  const detectorMaxSide = options.detectorMaxSide;
  if (detectorMaxSide !== undefined && detectorMaxSide !== "source" &&
      (typeof detectorMaxSide !== "number" || !Number.isFinite(detectorMaxSide) || detectorMaxSide <= 0)) {
    throw new RangeError('detectorMaxSide must be a positive finite number or "source".');
  }
  const assets = options.assets ? { ...options.assets } : undefined;
  let enabled = true;
  let localConsent = false;
  try {
    enabled = localStorage.getItem(ENABLED_KEY) !== "false";
    localConsent = localStorage.getItem(CONSENT_KEY) === "true";
  } catch { /* Storage can be disabled. */ }
  let available = false;
  let disposed = false;
  let usingLocal = false;
  let localStage: "initializing" | "downloading" | "recognizing" | undefined;
  let localDownloadPercent: number | undefined;
  let localBackend: ViewerPaddleOcrProgress["backend"];
  let localStartedAt: number | undefined;
  let elapsedTimer: ReturnType<typeof setInterval> | undefined;
  let localProvider: TextRecognitionProvider | undefined;
  let localProviderPending: Promise<TextRecognitionProvider | null> | undefined;
  let localProviderGeneration = 0;
  let activeLocalJobs = 0;
  const recognizedResults = new Map<string, TextRecognitionResult>();
  let progress: TextRecognitionProgress = { state: "idle", completed: 0, total: 0 };
  const lifetime = new AbortController();
  const element = document.createElement("div");
  element.className = "viewer-text-recognition";
  const label = document.createElement("label");
  label.className = "viewer-text-recognition-toggle";
  label.title = "Recognize scanned text for selection, copying and search. Uses browser OCR first.";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = enabled;
  checkbox.autocomplete = "off";
  const labelText = document.createElement("span");
  labelText.textContent = "Recognize scanned text";
  label.append(checkbox, labelText);
  const status = document.createElement("span");
  status.className = "viewer-text-recognition-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const elapsed = document.createElement("span");
  elapsed.className = "viewer-text-recognition-status";
  elapsed.setAttribute("aria-hidden", "true");
  elapsed.hidden = true;
  const useLocal = document.createElement("button");
  useLocal.type = "button";
  useLocal.textContent = "Use local OCR";
  useLocal.title = "Download the local OCR engine and models. Your documents stay on this device.";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Retry";
  element.append(label, status, useLocal, retry, elapsed);

  function disposeLocalProvider(): void {
    localProviderGeneration++;
    const provider = localProvider;
    localProvider = undefined;
    localProviderPending = undefined;
    activeLocalJobs = 0;
    if (provider) {
      try { void Promise.resolve(provider.dispose?.()).catch(error => console.warn("[HEPR] Local OCR cleanup failed.", error)); }
      catch (error) { console.warn("[HEPR] Local OCR cleanup failed.", error); }
    }
  }

  async function getLocalProvider(): Promise<TextRecognitionProvider | null> {
    if (localProvider) return localProvider;
    if (localProviderPending) return localProviderPending;
    const generation = localProviderGeneration;
    const pending = import("./viewerPaddleOcr").then(({ createViewerPaddleTextRecognitionProvider }) => {
      if (!enabled || !localConsent || disposed || generation !== localProviderGeneration) return null;
      localProvider = createViewerPaddleTextRecognitionProvider({ assets, detectorMaxSide, onProgress(value) {
        if (disposed || !enabled || generation !== localProviderGeneration) return;
        if (value.stage === "recognizing" && (localStage !== "recognizing" || localStartedAt === undefined)) {
          localStartedAt = performance.now() - Math.max(0, value.elapsedMs ?? 0);
        }
        localStage = value.stage;
        if (value.backend) localBackend = value.backend;
        localDownloadPercent = value.totalBytes && value.completedBytes !== undefined
          ? Math.min(100, Math.round(value.completedBytes / value.totalBytes * 100)) : undefined;
        refresh();
      } });
      return localProvider;
    });
    localProviderPending = pending;
    try { return await pending; }
    finally { if (localProviderPending === pending) localProviderPending = undefined; }
  }

  function settings(): TextRecognitionSetting {
    if (!enabled) return "off";
    return { onProgress: setProgress, ...(localConsent ? {
      fallback: async () => {
        // Recheck when the session reaches fallback; consent may have been revoked.
        if (!enabled || !localConsent || disposed) return null;
        const provider = await getLocalProvider();
        if (!enabled || !localConsent || disposed) return null;
        if (!provider || provider !== localProvider) return null;
        usingLocal = true;
        localStage = "initializing";
        refresh();
        return {
          async recognize(input) {
            input.signal.throwIfAborted();
            if (disposed || !enabled || provider !== localProvider) {
              throw new DOMException("Local OCR is no longer active.", "AbortError");
            }
            const generation = localProviderGeneration;
            activeLocalJobs++;
            localStage = "initializing";
            localStartedAt = undefined;
            refresh();
            try {
              const rgba = new Uint8Array(input.rgba), languages = [...input.languages];
              let key: string | undefined;
              const subtle = globalThis.crypto?.subtle;
              if (subtle) {
                try {
                  const digest = await waitForTextRecognition(subtle.digest("SHA-256", rgba), input.signal);
                  input.signal.throwIfAborted();
                  key = `${input.width}:${input.height}:${JSON.stringify(languages)}:` +
                    Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
                } catch { input.signal.throwIfAborted(); }
              }
              input.signal.throwIfAborted();
              if (generation !== localProviderGeneration || disposed || !enabled || provider !== localProvider) {
                throw new DOMException("Local OCR is no longer active.", "AbortError");
              }
              const cached = key ? recognizedResults.get(key) : undefined;
              if (cached) return structuredClone(cached);
              const result = await provider.recognize({ ...input, rgba, languages });
              input.signal.throwIfAborted();
              if (key && result.lines.some(line => /[^\s\ufffd\u0000]/u.test(line.text)) &&
                  generation === localProviderGeneration && !disposed && enabled) {
                recognizedResults.set(key, structuredClone(result));
              }
              return result;
            } finally {
              if (generation === localProviderGeneration) activeLocalJobs = Math.max(0, activeLocalJobs - 1);
            }
          },
          // Documents release their handle; the viewer retains idle models for the next document.
          dispose() {}
        };
      }
    } : {}) };
  }

  function refresh(): void {
    checkbox.checked = enabled;
    const recognizing = progress.state === "recognizing";
    const failed = progress.state === "unavailable" || progress.state === "failed";
    const empty = progress.state === "complete" && progress.total > 0 && progress.recognizedPages === 0;
    useLocal.hidden = !enabled || !available || !failed || localConsent;
    useLocal.disabled = !available;
    retry.hidden = !enabled || !available || !(failed || empty);
    retry.disabled = !available;
    status.hidden = !available || !enabled;
    const local = progress.provider === "fallback" || usingLocal;
    const backend = localBackend === "webgpu" ? "GPU" : localBackend === "wasm" ? "CPU" : localBackend === "mixed" ? "GPU/CPU" : undefined;
    const provider = local ? `Local OCR${backend ? ` (${backend})` : ""}` : progress.provider === "custom" ? "OCR" : "Browser OCR";
    let statusText: string;
    if (failed) statusText = `${provider} ${progress.state === "failed" ? "failed" : "unavailable"}`;
    else if (recognizing) {
      const stage = usingLocal ? localStage : progress.stage;
      statusText = stage === "downloading" ? `Downloading local OCR…${localDownloadPercent === undefined ? "" : ` ${localDownloadPercent}%`}`
        : stage === "initializing" ? `Starting ${provider.toLowerCase()}…`
          : `${provider}… ${progress.completed}/${progress.total}`;
    } else if (progress.state === "complete") statusText = progress.total === 0 ? "No scanned pages"
      : progress.recognizedPages === 0 ? `${provider}: no text found` : `${provider} complete`;
    else if (progress.state === "paused") statusText = "OCR paused";
    else statusText = "Browser OCR";
    if (status.textContent !== statusText) status.textContent = statusText;
    const timing = available && enabled && recognizing && usingLocal && localStage === "recognizing" &&
      (progress.stage === undefined || progress.stage === "recognizing");
    if (timing) {
      localStartedAt ??= performance.now();
      updateElapsed();
      elapsedTimer ??= setInterval(updateElapsed, 1000);
    } else {
      if (elapsedTimer !== undefined) clearInterval(elapsedTimer);
      elapsedTimer = undefined;
      localStartedAt = undefined;
      elapsed.hidden = true;
    }
  }

  function updateElapsed(): void {
    if (disposed || localStartedAt === undefined) return;
    const text = `${Math.max(0, Math.floor((performance.now() - localStartedAt) / 1000))}s`;
    if (elapsed.textContent !== text) elapsed.textContent = text;
    elapsed.hidden = false;
  }

  function setProgress(value: TextRecognitionProgress): void {
    if (disposed) return;
    if (value.provider === "native" || value.provider === "custom") usingLocal = false;
    else if (value.provider === "fallback") usingLocal = true;
    progress = value;
    refresh();
  }

  function resetAttempt(): void {
    usingLocal = false;
    localStage = undefined;
    localDownloadPercent = undefined;
    localBackend = undefined;
    progress = { state: "idle", completed: 0, total: 0 };
  }

  checkbox.addEventListener("change", () => {
    enabled = checkbox.checked;
    if (!enabled) { disposeLocalProvider(); recognizedResults.clear(); }
    resetAttempt();
    try { localStorage.setItem(ENABLED_KEY, String(enabled)); } catch { /* Session-only preferences still work. */ }
    refresh();
    options.onSettingsChange(settings());
  }, { signal: lifetime.signal });
  useLocal.addEventListener("click", () => {
    localConsent = true;
    resetAttempt();
    try { localStorage.setItem(CONSENT_KEY, "true"); } catch { /* Session-only consent still works. */ }
    refresh();
    options.onSettingsChange(settings());
  }, { signal: lifetime.signal });
  retry.addEventListener("click", () => {
    resetAttempt();
    refresh();
    options.onSettingsChange(settings());
  }, { signal: lifetime.signal });
  refresh();
  return {
    element,
    get settings() { return settings(); },
    setProgress,
    setDocumentAvailable(value) {
      if (disposed || available === value) return;
      available = value;
      if (!value) {
        if (progress.state === "recognizing" || activeLocalJobs > 0) disposeLocalProvider();
        resetAttempt();
      }
      refresh();
    },
    dispose() {
      disposed = true;
      disposeLocalProvider();
      recognizedResults.clear();
      if (elapsedTimer !== undefined) clearInterval(elapsedTimer);
      elapsedTimer = undefined;
      lifetime.abort();
      element.remove();
    }
  };
}
