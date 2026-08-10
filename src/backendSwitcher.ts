import type { VectorScene } from "./pdfVectorExtractor";
import type { SceneStats } from "./webGlFloorplanRenderer";
import type { RendererApi, RendererBackend } from "./rendererTypes";

type LoadedSourceKind = "pdf" | "parsed-zip" | null;

interface SceneSnapshot {
  scene: VectorScene | null;
  label: string | null;
  loadedSourceKind: LoadedSourceKind;
}

export interface BackendSwitcherOptions {
  backendSelectElement: HTMLSelectElement;
  getRenderer: () => RendererApi;
  setRenderer: (renderer: RendererApi) => void;
  getCanvasElement: () => HTMLCanvasElement;
  setCanvasElement: (canvas: HTMLCanvasElement) => void;
  createWebGlRenderer: (canvas: HTMLCanvasElement) => RendererApi;
  createWebGpuRenderer: (canvas: HTMLCanvasElement) => Promise<RendererApi>;
  attachCanvasInteractionListeners: (canvas: HTMLCanvasElement) => void;
  resetPointerInteractionState: () => void;
  isOperationActive?: () => boolean;
  getSceneSnapshot: () => SceneSnapshot;
  setSceneStats: (stats: SceneStats | null) => void;
  updateMetricsAfterSwitch: (label: string, scene: VectorScene, sceneStats: SceneStats) => void;
  setMetricTimesText: (text: string) => void;
  setBaseStatus: (status: string) => void;
  setStatus: (status: string) => void;
  setStatusText: (status: string) => void;
}

export interface BackendSwitcher {
  readonly webGpuSupported: boolean;
  getActiveBackend(): RendererBackend;
  isSwitchInFlight(): boolean;
  runWhenIdle<T>(action: () => T): Promise<T>;
  initializeToggleState(): void;
  applyPreference(targetBackend: RendererBackend): Promise<void>;
}

export function createBackendSwitcher(options: BackendSwitcherOptions): BackendSwitcher {
  const webGpuSupported = isWebGpuSupported();
  let activeRendererBackend: RendererBackend = "webgl";
  let backendSwitchInFlight = false;
  let backendSwitchCompletion: Promise<void> = Promise.resolve();
  let resolveBackendSwitchCompletion: (() => void) | null = null;

  async function runWhenIdle<T>(action: () => T): Promise<T> {
    while (backendSwitchInFlight) {
      await backendSwitchCompletion;
    }
    return action();
  }

  function initializeToggleState(): void {
    options.backendSelectElement.value = activeRendererBackend;
    const webGpuOption = Array.from(options.backendSelectElement.options).find((option) => option.value === "webgpu");
    if (!webGpuSupported) {
      if (webGpuOption) {
        webGpuOption.disabled = true;
      }
      options.backendSelectElement.title = "WebGPU is not available in this browser/GPU.";
      return;
    }

    if (webGpuOption) {
      webGpuOption.disabled = false;
    }
    options.backendSelectElement.title = "Experimental WebGPU backend available.";
  }

  async function applyPreference(targetBackend: RendererBackend): Promise<void> {
    if (targetBackend === activeRendererBackend || backendSwitchInFlight) {
      options.backendSelectElement.value = activeRendererBackend;
      return;
    }

    if (targetBackend === "webgpu" && !webGpuSupported) {
      options.backendSelectElement.value = activeRendererBackend;
      options.setStatus("WebGPU is not supported in this browser/GPU. Using WebGL.");
      return;
    }

    if (options.isOperationActive?.()) {
      options.backendSelectElement.value = activeRendererBackend;
      options.setStatus("Wait for the current document operation to finish before switching renderer backend.");
      return;
    }

    backendSwitchInFlight = true;
    backendSwitchCompletion = new Promise<void>((resolve) => {
      resolveBackendSwitchCompletion = resolve;
    });

    let switchCommitted = false;
    try {
      const previousRenderer = options.getRenderer();
      const previousViewState = previousRenderer.getViewState();
      const sceneSnapshot = options.getSceneSnapshot();
      const previousCanvas = options.getCanvasElement();
      const replacementCanvas = cloneViewportCanvas(previousCanvas);

      options.setStatus(`Switching renderer backend to ${targetBackend.toUpperCase()}...`);

      let nextRenderer: RendererApi | null = null;
      let nextSceneStats: SceneStats | null = null;

      try {
        nextRenderer =
          targetBackend === "webgpu"
            ? await options.createWebGpuRenderer(replacementCanvas)
            : options.createWebGlRenderer(replacementCanvas);

        if (sceneSnapshot.scene && sceneSnapshot.label) {
          nextSceneStats = nextRenderer.setScene(sceneSnapshot.scene);
        }
        nextRenderer.setViewState(previousViewState);
      } catch (error) {
        disposeProvisionalRenderer(nextRenderer);
        reportSwitchFailure(options, activeRendererBackend, error);
        return;
      }

      let replacementCanvasInstalled = false;
      try {
        previousCanvas.replaceWith(replacementCanvas);
        replacementCanvasInstalled = true;
        options.setCanvasElement(replacementCanvas);
        options.attachCanvasInteractionListeners(replacementCanvas);
        options.setRenderer(nextRenderer);
        options.resetPointerInteractionState();
        options.backendSelectElement.value = targetBackend;
      } catch (error) {
        const rollbackError = restorePreviousRendererAndCanvas(
          options,
          previousRenderer,
          previousCanvas,
          replacementCanvas,
          replacementCanvasInstalled,
          nextRenderer
        );
        disposeProvisionalRenderer(nextRenderer);
        reportSwitchFailure(
          options,
          activeRendererBackend,
          rollbackError ? combineSwitchErrors(error, rollbackError) : error
        );
        return;
      }

      activeRendererBackend = targetBackend;
      switchCommitted = true;

      disposePreviousRenderer(previousRenderer);

      try {
        nextRenderer.resize();
      } catch (error) {
        console.warn("[HEPR] Backend switched, but the replacement renderer could not resize immediately.", error);
      }

      if (sceneSnapshot.scene && sceneSnapshot.label && nextSceneStats) {
        options.setSceneStats(nextSceneStats);
        options.updateMetricsAfterSwitch(sceneSnapshot.label, sceneSnapshot.scene, nextSceneStats);
        options.setMetricTimesText("parse -, vector lod -, upload - (backend switch)");

        const statusBase = "";
        options.setBaseStatus(statusBase);
        options.setStatusText(statusBase);
      } else {
        options.setStatus(`Switched to ${targetBackend.toUpperCase()} backend.`);
      }
    } catch (error) {
      if (switchCommitted) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[HEPR] Renderer backend switched, but finalization failed.", error);
        options.backendSelectElement.value = activeRendererBackend;
        options.setStatus(
          `Switched to ${activeRendererBackend.toUpperCase()}, but finalization failed: ${message}`
        );
      } else {
        reportSwitchFailure(options, activeRendererBackend, error);
      }
    } finally {
      backendSwitchInFlight = false;
      resolveBackendSwitchCompletion?.();
      resolveBackendSwitchCompletion = null;
    }
  }

  return {
    webGpuSupported,
    getActiveBackend: () => activeRendererBackend,
    isSwitchInFlight: () => backendSwitchInFlight,
    runWhenIdle,
    initializeToggleState,
    applyPreference
  };
}

function disposePreviousRenderer(renderer: RendererApi): void {
  try {
    renderer.setFrameListener(null);
  } catch (error) {
    console.warn("[HEPR] Failed to detach the previous renderer frame listener.", error);
  }
  try {
    renderer.dispose();
  } catch (error) {
    console.warn("[HEPR] Failed to dispose the previous renderer after a backend switch.", error);
  }
}

function isWebGpuSupported(): boolean {
  const nav = navigator as Navigator & { gpu?: unknown };
  return typeof nav.gpu !== "undefined";
}

function cloneViewportCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const clone = source.cloneNode(false) as HTMLCanvasElement;
  clone.width = source.width;
  clone.height = source.height;
  return clone;
}

function restorePreviousRendererAndCanvas(
  options: BackendSwitcherOptions,
  previousRenderer: RendererApi,
  previousCanvas: HTMLCanvasElement,
  replacementCanvas: HTMLCanvasElement,
  replacementCanvasInstalled: boolean,
  provisionalRenderer: RendererApi
): unknown | null {
  let firstError: unknown | null = null;
  const attempt = (restore: () => void): void => {
    try {
      restore();
    } catch (error) {
      firstError ??= error;
    }
  };

  attempt(() => {
    if (options.getRenderer() === provisionalRenderer) {
      options.setRenderer(previousRenderer);
    }
  });
  attempt(() => {
    if (replacementCanvasInstalled) {
      replacementCanvas.replaceWith(previousCanvas);
    }
  });
  attempt(() => {
    if (options.getCanvasElement() !== previousCanvas) {
      options.setCanvasElement(previousCanvas);
    }
  });
  attempt(() => options.attachCanvasInteractionListeners(previousCanvas));
  attempt(() => options.resetPointerInteractionState());
  return firstError;
}

function disposeProvisionalRenderer(renderer: RendererApi | null): void {
  if (!renderer) {
    return;
  }
  try {
    renderer.setFrameListener(null);
  } catch {
    // Preserve the original backend-switch failure.
  }
  try {
    renderer.dispose();
  } catch {
    // Preserve the original backend-switch failure.
  }
}

function reportSwitchFailure(
  options: BackendSwitcherOptions,
  activeRendererBackend: RendererBackend,
  error: unknown
): void {
  const message = error instanceof Error ? error.message : String(error);
  options.backendSelectElement.value = activeRendererBackend;
  options.setStatus(`Failed to switch backend: ${message}`);
}

function combineSwitchErrors(switchError: unknown, rollbackError: unknown): Error {
  const switchMessage = switchError instanceof Error ? switchError.message : String(switchError);
  const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
  return new Error(`${switchMessage} (rollback also failed: ${rollbackMessage})`);
}
