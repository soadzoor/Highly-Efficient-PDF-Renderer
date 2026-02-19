import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import type { DrawStats, SceneStats, ViewState } from "./webGlFloorplanRenderer";

export type RendererBackend = "webgl" | "webgpu";

export interface RendererApi {
  setFrameListener(listener: ((stats: DrawStats) => void) | null): void;
  setPanOptimizationEnabled(enabled: boolean): void;
  setStrokeCurveEnabled(enabled: boolean): void;
  setTextVectorOnly(enabled: boolean): void;
  setPageBackgroundColor(red: number, green: number, blue: number, alpha: number): void;
  setVectorColorOverride(red: number, green: number, blue: number, opacity: number): void;
  beginPanInteraction(): void;
  endPanInteraction(): void;
  resize(): void;
  setScene(scene: VectorScene): SceneStats;
  getSceneStats(): SceneStats | null;
  fitToBounds(bounds: Bounds, paddingPixels?: number): void;
  panByPixels(deltaX: number, deltaY: number): void;
  zoomAtClientPoint(clientX: number, clientY: number, zoomFactor: number): void;
  getViewState(): ViewState;
  setViewState(viewState: ViewState): void;
  dispose(): void;
}
