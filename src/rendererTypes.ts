import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import type { DrawStats, ProjectedFrameOptions, SceneStats, ViewState } from "./webGlFloorplanRenderer";
import type { VectorLodMode, VectorStrokeLodStats } from "./vectorStrokeLodCore";

export type RendererBackend = "webgl" | "webgpu";

export interface ViewStateUpdateOptions {
  preservePanCache?: boolean;
  interacting?: boolean;
}

export interface RendererApi {
  setFrameListener(listener: ((stats: DrawStats) => void) | null): void;
  setExternalFrameDriver?(enabled: boolean): void;
  renderExternalFrame?(timestamp?: number): void;
  renderProjectedFrame?(options: ProjectedFrameOptions): DrawStats;
  setRasterRenderingEnabled?(enabled: boolean): void;
  setFillRenderingEnabled?(enabled: boolean): void;
  setStrokeRenderingEnabled?(enabled: boolean): void;
  setTextRenderingEnabled?(enabled: boolean): void;
  setPanOptimizationEnabled(enabled: boolean): void;
  setVectorLodMode?(mode: VectorLodMode): void;
  setStrokeCurveEnabled(enabled: boolean): void;
  setTextVectorOnly(enabled: boolean): void;
  setPageBackgroundColor(red: number, green: number, blue: number, alpha: number): void;
  setVectorColorOverride(red: number, green: number, blue: number, opacity: number): void;
  getPresentedViewState(): ViewState;
  getPresentedFrameSerial(): number;
  setInteractionViewportProvider(
    provider: (() => DOMRect | DOMRectReadOnly | null) | null
  ): void;
  beginPanInteraction(): void;
  endPanInteraction(): void;
  resize(): void;
  setScene(scene: VectorScene): SceneStats;
  getSceneStats(): SceneStats | null;
  getVectorStrokeLodStats?(): VectorStrokeLodStats | null;
  fitToBounds(bounds: Bounds, paddingPixels?: number): void;
  panByPixels(deltaX: number, deltaY: number): void;
  zoomAtClientPoint(clientX: number, clientY: number, zoomFactor: number): void;
  getViewState(): ViewState;
  setViewState(viewState: ViewState, options?: ViewStateUpdateOptions): void;
  dispose(): void;
}
