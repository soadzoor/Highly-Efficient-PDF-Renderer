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
  webGpuToggleElement: HTMLInputElement;
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
  formatSceneStatus: (label: string, scene: VectorScene) => string;
  setBaseStatus: (status: string) => void;
  setStatus: (status: string) => void;
  setStatusText: (status: string) => void;
}

export interface BackendSwitcher {
  readonly webGpuSupported: boolean;
  getActiveBackend(): RendererBackend;
  initializeToggleState(): void;
  applyPreference(useWebGpu: boolean): Promise<void>;
}

export function createBackendSwitcher(options: BackendSwitcherOptions): BackendSwitcher {
  const webGpuSupported = isWebGpuSupported();
  let activeRendererBackend: RendererBackend = "webgl";
  let backendSwitchInFlight = false;

  function initializeToggleState(): void {
    if (!webGpuSupported) {
      options.webGpuToggleElement.checked = false;
      options.webGpuToggleElement.disabled = true;
      options.webGpuToggleElement.title = "WebGPU is not available in this browser/GPU.";
      return;
    }

    options.webGpuToggleElement.disabled = false;
    options.webGpuToggleElement.title = "Experimental WebGPU backend.";
  }

  async function applyPreference(useWebGpu: boolean): Promise<void> {
    const targetBackend: RendererBackend = useWebGpu ? "webgpu" : "webgl";
    if (targetBackend === activeRendererBackend || backendSwitchInFlight) {
      return;
    }

    if (targetBackend === "webgpu" && !webGpuSupported) {
      options.webGpuToggleElement.checked = false;
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
      options.webGpuToggleElement.checked = targetBackend === "webgpu";
      options.resetPointerInteractionState();

      previousRenderer.setFrameListener(null);
      previousRenderer.dispose();

      if (sceneSnapshot.scene && sceneSnapshot.label) {
        const nextSceneStats = nextRenderer.setScene(sceneSnapshot.scene);
        options.setSceneStats(nextSceneStats);
        nextRenderer.setViewState(previousViewState);
        options.updateMetricsAfterSwitch(sceneSnapshot.label, sceneSnapshot.scene, nextSceneStats);
        options.setMetricTimesText("parse -, upload - (backend switch)");

        const sourceSuffix = sceneSnapshot.loadedSourceKind === "parsed-zip" ? " | source: parsed data zip" : "";
        const statusBase = `${options.formatSceneStatus(sceneSnapshot.label, sceneSnapshot.scene)}${sourceSuffix}`;
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
      options.webGpuToggleElement.checked = activeRendererBackend === "webgpu";
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
