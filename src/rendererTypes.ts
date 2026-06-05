import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import type { DrawStats, ProjectedFrameOptions, SceneStats, ViewState } from "./webGlFloorplanRenderer";
import type { VectorLodMode, VectorStrokeLodStats } from "./vectorStrokeLodCore";

/** Native HEPR renderer backend identifier. */
export type RendererBackend = "webgl" | "webgpu";

/** Options for setting HEPR native view state. */
export interface ViewStateUpdateOptions {
  /** Keep the native pan cache when possible. */
  preservePanCache?: boolean;

  /** Mark the update as part of an active pointer interaction. */
  interacting?: boolean;
}

/**
 * Advanced native renderer interface used internally by `HeprThreePdfObject`.
 *
 * Most three.js applications should use `pdfObjectGenerator` and
 * `HeprThreePdfObject` methods instead of calling this interface directly.
 */
export interface RendererApi {
  /** Subscribe to per-frame draw diagnostics. */
  setFrameListener(listener: ((stats: DrawStats) => void) | null): void;

  /** Switch native rendering to an externally driven frame loop. */
  setExternalFrameDriver?(enabled: boolean): void;

  /** Render one native frame when external frame driving is enabled. */
  renderExternalFrame?(timestamp?: number): void;

  /** Render using a supplied local-to-clip projection. */
  renderProjectedFrame?(options: ProjectedFrameOptions): DrawStats;

  /** Enable or disable native raster rendering. */
  setRasterRenderingEnabled?(enabled: boolean): void;

  /** Enable or disable native fill rendering. */
  setFillRenderingEnabled?(enabled: boolean): void;

  /** Enable or disable native stroke rendering. */
  setStrokeRenderingEnabled?(enabled: boolean): void;

  /** Enable or disable native text rendering. */
  setTextRenderingEnabled?(enabled: boolean): void;

  /** Enable or disable the native fallback pan cache. */
  setPanOptimizationEnabled(enabled: boolean): void;

  /** Change Vector LOD mode. */
  setVectorLodMode?(mode: VectorLodMode): void;

  /** Enable or disable curve-aware stroke rendering. */
  setStrokeCurveEnabled(enabled: boolean): void;

  /** Force text to render as vector geometry only. */
  setTextVectorOnly(enabled: boolean): void;

  /** Set page background color with normalized RGBA channels. */
  setPageBackgroundColor(red: number, green: number, blue: number, alpha: number): void;

  /** Set vector color override with normalized RGBA-style channels. */
  setVectorColorOverride(red: number, green: number, blue: number, opacity: number): void;

  /** Return the view state used for the last presented native frame. */
  getPresentedViewState(): ViewState;

  /** Monotonic serial for the last presented native frame. */
  getPresentedFrameSerial(): number;

  /** Provide a DOM viewport for pointer interaction coordinate mapping. */
  setInteractionViewportProvider(
    provider: (() => DOMRect | DOMRectReadOnly | null) | null
  ): void;

  /** Begin a native pan interaction. */
  beginPanInteraction(): void;

  /** End a native pan interaction. */
  endPanInteraction(): void;

  /** Resize native GPU resources to the backing canvas. */
  resize(): void;

  /** Upload a parsed scene and return GPU/resource stats. */
  setScene(scene: VectorScene): SceneStats;

  /** Return stats for the uploaded scene, if available. */
  getSceneStats(): SceneStats | null;

  /** Return Vector LOD diagnostics, if active. */
  getVectorStrokeLodStats?(): VectorStrokeLodStats | null;

  /** Fit native view state to bounds with optional pixel padding. */
  fitToBounds(bounds: Bounds, paddingPixels?: number): void;

  /** Pan native view state by screen pixels. */
  panByPixels(deltaX: number, deltaY: number): void;

  /** Zoom native view state around a client-space point. */
  zoomAtClientPoint(clientX: number, clientY: number, zoomFactor: number): void;

  /** Return current native HEPR view state. */
  getViewState(): ViewState;

  /** Set current native HEPR view state. */
  setViewState(viewState: ViewState, options?: ViewStateUpdateOptions): void;

  /** Dispose renderer-owned GPU resources. */
  dispose(): void;
}
