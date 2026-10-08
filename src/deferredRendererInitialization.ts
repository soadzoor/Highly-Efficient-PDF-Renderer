import type { Bounds } from "./pdfVectorExtractor";
import type { RendererApi, ViewStateUpdateOptions } from "./rendererTypes";
import type { ViewState } from "./webGlFloorplanRenderer";

const CONFIG_METHODS = new Set([
  "setFrameListener", "setInteractionViewportProvider", "setRasterRenderingEnabled",
  "setRasterTextureResidency", "setFillRenderingEnabled", "setStrokeRenderingEnabled",
  "setTextRenderingEnabled", "setVectorLodMode", "setTextLodMode", "setStrokeCurveEnabled",
  "setTextVectorOnly", "setPageBackgroundColor", "setVectorColorOverride",
  "setPrimitiveHighlights", "setSearchHighlights", "setTextSelectionHighlights",
  "setOptionalContentVisibility", "setPageRasterVisibility"
]);

/**
 * The Three material path only needs native configuration and view state.
 * Keep those on the CPU until a fallback frame or a native resource is requested.
 * A synchronous factory preserves RendererApi's synchronous fallback methods.
 */
export function deferRendererInitialization(
  canvas: HTMLCanvasElement,
  prototype: object,
  create: () => RendererApi,
  releaseUnused?: () => void
): RendererApi {
  let renderer: RendererApi | null = null;
  let disposed = false;
  let view: ViewState = { cameraCenterX: 0, cameraCenterY: 0, zoom: 1 };
  let presented = { ...view };
  let minZoom = 0.01;
  let fittedBounds: { bounds: Bounds; padding: number } | null = null;
  let provider: Parameters<RendererApi["setInteractionViewportProvider"]>[0] = null;
  let panInteracting = false;
  const config = new Map<string, unknown[]>();
  const forwarded = new Map<PropertyKey, Function>();
  const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

  const invoke = (native: RendererApi, key: PropertyKey, args: unknown[]): unknown => {
    const method = Reflect.get(native, key, native);
    return typeof method === "function" ? Reflect.apply(method, native, args) : undefined;
  };
  const initialize = (): RendererApi => {
    if (disposed) throw new Error("Cannot initialize a disposed native renderer.");
    if (renderer) return renderer;
    let created: RendererApi | null = null;
    try {
      created = create();
      // Applying queued colors/LOD must not start an unseen native frame loop.
      created.setExternalFrameDriver?.(true);
      for (const [key, args] of config) invoke(created, key, args);
      if (fittedBounds) created.fitToBounds(fittedBounds.bounds, fittedBounds.padding);
      created.setViewState(view, { scheduleFrame: false });
      if (panInteracting) created.beginPanInteraction();
      renderer = created;
      config.clear();
      return created;
    } catch (error) {
      disposed = true;
      try { created ? created.dispose() : releaseUnused?.(); } catch { /* Preserve initialization failure. */ }
      config.clear(); provider = null;
      throw error;
    }
  };
  const viewport = (): DOMRect | DOMRectReadOnly => provider?.() ?? canvas.getBoundingClientRect();
  const scale = (rect: DOMRect | DOMRectReadOnly): { x: number; y: number } => {
    const fallback = Math.max(globalThis.devicePixelRatio || 1, 1e-6);
    return {
      x: Math.max(1e-6, rect.width > 1e-6 ? canvas.width / rect.width : fallback),
      y: Math.max(1e-6, rect.height > 1e-6 ? canvas.height / rect.height : fallback)
    };
  };
  const cpu: Record<string, (...args: any[]) => unknown> = {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      config.clear(); provider = null;
      renderer ? renderer.dispose() : releaseUnused?.();
    },
    getViewState: () => ({ ...view }),
    getPresentedViewState: () => ({ ...presented }),
    getPresentedFrameSerial: () => 0,
    getOptionalContentVisibility: () => config.get("setOptionalContentVisibility")?.[0] ?? null,
    getVectorColorOverride: () => config.get("setVectorColorOverride")?.map(value => clamp(Number(value), 0, 1)) ?? [0, 0, 0, 0],
    getRasterLayerUpdates: () => new Map(),
    resize: () => {},
    setViewState: (next: ViewState, _options?: ViewStateUpdateOptions) => {
      const x = Number(next.cameraCenterX), y = Number(next.cameraCenterY), zoom = Number(next.zoom);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) return;
      view = { cameraCenterX: x, cameraCenterY: y, zoom: clamp(zoom, minZoom, 8192) };
      presented = { ...view }; panInteracting = false;
    },
    fitToBounds: (bounds: Bounds, padding = 64) => {
      const zoom = clamp(Math.min(Math.max(1, canvas.width - padding * 2) / Math.max(1e-4, bounds.maxX - bounds.minX),
        Math.max(1, canvas.height - padding * 2) / Math.max(1e-4, bounds.maxY - bounds.minY)), 1e-8, 8192);
      minZoom = Math.min(minZoom, zoom);
      fittedBounds = { bounds: { ...bounds }, padding };
      view = { cameraCenterX: (bounds.minX + bounds.maxX) / 2, cameraCenterY: (bounds.minY + bounds.maxY) / 2, zoom };
      presented = { ...view }; panInteracting = false;
    },
    beginPanInteraction: () => { panInteracting = true; },
    endPanInteraction: () => { panInteracting = false; },
    clientToScenePoint: (x: number, y: number) => {
      if (disposed) return null;
      const rect = viewport(), pixels = scale(rect);
      return { x: ((x - rect.left) * pixels.x - canvas.width / 2) / view.zoom + view.cameraCenterX,
        y: ((rect.bottom - y) * pixels.y - canvas.height / 2) / view.zoom + view.cameraCenterY };
    },
    sceneToClientPoint: (x: number, y: number) => {
      if (disposed) return null;
      const rect = viewport(), pixels = scale(rect);
      return { x: rect.left + ((x - view.cameraCenterX) * view.zoom + canvas.width / 2) / pixels.x,
        y: rect.bottom - ((y - view.cameraCenterY) * view.zoom + canvas.height / 2) / pixels.y };
    },
    setExternalFrameDriver: (enabled: boolean) => {
      if (!Boolean(enabled)) initialize().setExternalFrameDriver?.(enabled);
    }
  };

  return new Proxy(Object.create(prototype), {
    get: (_target, key) => {
      if (key === "constructor") return Reflect.get(prototype, key);
      const source = renderer ?? prototype;
      const value = Reflect.get(source, key, source);
      if (typeof value !== "function") {
        // Probe absent optional capabilities without creating the backend.
        return key in source ? Reflect.get(initialize(), key) : undefined;
      }
      const cached = forwarded.get(key);
      if (cached) return cached;
      const method = (...args: unknown[]): unknown => {
        if (key === "dispose") return cpu.dispose();
        if (renderer) return invoke(renderer, key, args);
        if (typeof key === "string" && cpu[key]) return cpu[key](...args);
        if (typeof key === "string" && CONFIG_METHODS.has(key)) {
          if (disposed) return;
          config.set(key, args);
          if (key === "setInteractionViewportProvider") provider = args[0] as typeof provider;
          return;
        }
        return invoke(initialize(), key, args);
      };
      forwarded.set(key, method);
      return method;
    },
    set: (_target, key, value) => Reflect.set(initialize(), key, value)
  }) as RendererApi;
}
