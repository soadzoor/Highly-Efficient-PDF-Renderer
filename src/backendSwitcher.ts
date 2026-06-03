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
  initializeToggleState(): void;
  applyPreference(targetBackend: RendererBackend): Promise<void>;
}

export function createBackendSwitcher(options: BackendSwitcherOptions): BackendSwitcher {
  const webGpuSupported = isWebGpuSupported();
  let activeRendererBackend: RendererBackend = "webgl";
  let backendSwitchInFlight = false;

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

    backendSwitchInFlight = true;
    const previousRenderer = options.getRenderer();
    const previousViewState = previousRenderer.getViewState();
    const sceneSnapshot = options.getSceneSnapshot();
    const previousCanvas = options.getCanvasElement();
    const replacementCanvas = cloneViewportCanvas(previousCanvas);

    options.setStatus(`Switching renderer backend to ${targetBackend.toUpperCase()}...`);

    try {
      previousCanvas.replaceWith(replacementCanvas);
      options.setCanvasElement(replacementCanvas);
      options.attachCanvasInteractionListeners(replacementCanvas);

      const nextRenderer =
        targetBackend === "webgpu"
          ? await options.createWebGpuRenderer(replacementCanvas)
          : options.createWebGlRenderer(replacementCanvas);

      options.setRenderer(nextRenderer);
      activeRendererBackend = targetBackend;
      options.backendSelectElement.value = activeRendererBackend;
      options.resetPointerInteractionState();

      previousRenderer.setFrameListener(null);
      previousRenderer.dispose();

      if (sceneSnapshot.scene && sceneSnapshot.label) {
        const nextSceneStats = nextRenderer.setScene(sceneSnapshot.scene);
        options.setSceneStats(nextSceneStats);
        nextRenderer.setViewState(previousViewState);
        options.updateMetricsAfterSwitch(sceneSnapshot.label, sceneSnapshot.scene, nextSceneStats);
        options.setMetricTimesText("parse -, vector lod -, upload - (backend switch)");

        const sourceSuffix = sceneSnapshot.loadedSourceKind === "parsed-zip" ? " Source: parsed data zip." : "";
        const statusBase = `Ready.${sourceSuffix}`;
        options.setBaseStatus(statusBase);
        options.setStatusText(
          targetBackend === "webgpu"
            ? `${statusBase} | backend: WebGPU (preview)`
            : `${statusBase} | backend: WebGL`
        );
      } else {
        nextRenderer.setViewState(previousViewState);
        options.setStatus(`Switched to ${targetBackend.toUpperCase()} backend.`);
      }
    } catch (error) {
      if (options.getCanvasElement() === replacementCanvas) {
        replacementCanvas.replaceWith(previousCanvas);
        options.setCanvasElement(previousCanvas);
        options.resetPointerInteractionState();
      }

      const message = error instanceof Error ? error.message : String(error);
      options.backendSelectElement.value = activeRendererBackend;
      options.setStatus(`Failed to switch backend: ${message}`);
    } finally {
      backendSwitchInFlight = false;
    }
  }

  return {
    webGpuSupported,
    getActiveBackend: () => activeRendererBackend,
    initializeToggleState,
    applyPreference
  };
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
