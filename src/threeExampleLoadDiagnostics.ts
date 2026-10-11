import type { Object3D } from "three";
import type { PDFLoadProgress } from "./loadProgress";
import type { VectorScene } from "./pdfVectorExtractor";
import { ViewerLoadDiagnostics } from "./viewerLoadDiagnostics";
import { describeThreeLoadMemory } from "./threeLoadMemory";
import { describeThreePerformanceScene } from "./threeRenderPerformance";

interface DiagnosticObject extends Object3D {
  readonly sceneData: VectorScene;
}

interface DiagnosticRenderer {
  readonly info: { memory: { geometries: number; textures: number }; programs?: unknown[] | null };
  readonly backend?: unknown;
}

/** Opt-in load tracing, separate from the frame profiler and its GPU timers. */
export function createThreeExampleLoadDiagnostics(signal: AbortSignal, readViewerState?: () => Record<string, unknown>) {
  const checkbox = document.querySelector<HTMLInputElement>("#load-diagnostics-enabled")!;
  const showButton = document.querySelector<HTMLButtonElement>("#show-load-report")!;
  const copyButton = document.querySelector<HTMLButtonElement>("#copy-load-report")!;
  const output = document.querySelector<HTMLTextAreaElement>("#load-diagnostics-report")!;
  const status = document.querySelector<HTMLElement>("#load-diagnostics-status")!;
  let storage: Storage | undefined;
  try { storage = window.sessionStorage; } catch { /* Storage can be disabled. */ }
  const recorder = new ViewerLoadDiagnostics({ storage });
  const requestedByUrl = new URLSearchParams(window.location.search).get("loadDiagnostics") === "1";
  checkbox.checked = requestedByUrl;
  let activeToken = -1;
  let captureId: number | null = null;
  let beginCalls = 0;
  let lastBeginEnabled: boolean | null = null;
  let loadInProgress = false;
  const restored = recorder.report();
  status.textContent = restored.previous
    ? "Previous load report recovered. Show or copy it here."
    : "Enable before opening a document. Checkpoints are saved in this tab for reload recovery.";

  function report() {
    const captured = recorder.report();
    let viewer: Record<string, unknown> | null = null;
    try { viewer = readViewerState?.() ?? null; }
    catch (error) { viewer = { stateError: String(error) }; }
    return {
      ...captured,
      capture: {
        uiVersion: 2, enabled: checkbox.checked, requestedByUrl, beginCalls, lastBeginEnabled,
        activeLoadToken: activeToken < 0 ? null : activeToken, loadInProgress,
        recording: loadInProgress && captureId !== null, disposed: signal.aborted
      },
      viewer
    };
  }
  const show = () => {
    const snapshot = report();
    const empty = !snapshot.current && !snapshot.previous;
    output.value = JSON.stringify(snapshot, null, 2);
    output.hidden = false;
    if (empty) status.textContent = "No load checkpoints were recorded. Recorder state is shown below.";
    return { text: output.value, empty };
  };
  showButton.addEventListener("click", show, { signal });
  copyButton.addEventListener("click", () => {
    const { text, empty } = show();
    // Keep the clipboard request within the tap's user activation on Safari.
    try {
      const copy = navigator.clipboard?.writeText(text);
      if (copy) void copy.then(() => {
        status.textContent = empty ? "Recorder state copied. No load checkpoints were recorded." : "Load report copied.";
      }, () => selectReport(empty));
      else selectReport(empty);
    } catch { selectReport(empty); }
  }, { signal });
  function selectReport(empty: boolean): void {
    output.focus(); output.select(); output.setSelectionRange(0, output.value.length);
    status.textContent = empty
      ? "No load checkpoints were recorded. Select the recorder state below, then Copy."
      : "Select the report below, then Copy.";
  }
  checkbox.addEventListener("change", () => {
    if (!checkbox.checked && captureId !== null) {
      recorder.finish(captureId, "cancelled", "Diagnostic recording disabled.");
      captureId = null;
    }
    status.textContent = checkbox.checked
      ? loadInProgress && captureId === null
        ? "This load started without recording. Reopen the document to capture loading."
        : "Ready to record the next document load."
      : "Recording disabled. Saved reports remain available.";
  }, { signal });

  function event(phase: string, details: Record<string, unknown>): void {
    if (!signal.aborted && captureId !== null) recorder.note(captureId, phase, details);
  }
  window.addEventListener("error", error => event("window-error", { message: error.message }), { signal });
  window.addEventListener("unhandledrejection", error => event("unhandled-rejection", {
    message: error.reason instanceof Error ? error.reason.message : String(error.reason)
  }), { signal });

  return {
    begin(token: number, context: Record<string, unknown>): void {
      if (signal.aborted) return;
      beginCalls++;
      lastBeginEnabled = checkbox.checked;
      loadInProgress = true;
      if (captureId !== null) recorder.finish(captureId, "cancelled", "Superseded by another load.");
      activeToken = token;
      captureId = checkbox.checked ? recorder.start({
        ...context, browser: navigator.userAgent, dpr: window.devicePixelRatio,
        hardwareConcurrency: navigator.hardwareConcurrency
      }) : null;
      if (captureId !== null) status.textContent = recorder.report().storage.available
        ? "Recording load checkpoints…"
        : "Recording load checkpoints. Reload recovery is unavailable; copy the report before closing.";
    },
    checkpoint(token: number, phase: string, object?: DiagnosticObject | null,
      renderer?: DiagnosticRenderer, details: Record<string, unknown> = {}): void {
      if (signal.aborted || activeToken !== token || captureId === null) return;
      // Save the phase before scanning resources, too, so even an interrupted
      // diagnostic snapshot leaves a checkpoint without retaining the document.
      recorder.checkpoint(captureId, phase, details);
      if (!object && !renderer) return;
      const started = performance.now();
      try {
        const memory = (performance as Performance & {
          memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number }
        }).memory;
        recorder.checkpoint(captureId, `${phase}:resources`, {
          ...details,
          scene: object ? describeThreePerformanceScene(object.sceneData) : null,
          resources: object ? describeThreeLoadMemory(object, object.sceneData) : null,
          three: renderer ? { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
            programs: renderer.info.programs?.length ?? null } : null,
          jsHeap: memory ? { usedBytes: memory.usedJSHeapSize, totalBytes: memory.totalJSHeapSize,
            limitBytes: memory.jsHeapSizeLimit } : null,
          snapshotMs: performance.now() - started
        });
      } catch (error) {
        recorder.checkpoint(captureId, `${phase}:snapshot-error`, { message: String(error) });
      }
    },
    progress(token: number, progress: PDFLoadProgress): void {
      if (!signal.aborted && activeToken === token && captureId !== null) recorder.progress(captureId, progress);
    },
    finish(token: number, result: "complete" | "failed" | "cancelled", message?: string): void {
      if (signal.aborted || activeToken !== token) return;
      loadInProgress = false;
      if (captureId === null) return;
      recorder.finish(captureId, result, message);
      status.textContent = recorder.report().storage.available
        ? `Load ${result}. Show or copy the report here; it is also saved for reload recovery.`
        : `Load ${result}. Reload recovery is unavailable; show or copy the report here.`;
    },
    monitorRenderer(renderer: DiagnosticRenderer, canvas: HTMLCanvasElement): void {
      canvas.addEventListener("webglcontextlost", error => event("webgl-context-lost", {
        message: (error as WebGLContextEvent).statusMessage
      }), { signal });
      canvas.addEventListener("webglcontextrestored", () => event("webgl-context-restored", {}), { signal });
      const backend = renderer.backend as { device?: { lost: Promise<{ reason: string; message: string }> } } | undefined;
      void backend?.device?.lost.then(info => {
        if (info.reason !== "destroyed") event("webgpu-device-lost", { reason: info.reason, message: info.message });
      }).catch(() => {});
    },
    report,
    json: () => JSON.stringify(report(), null, 2)
  };
}
