import type { RendererApi, SceneUpdateOptions } from "./rendererTypes";
import type { RasterLayer, VectorScene } from "./pdfVectorExtractor";
import type { PrimitiveColorUpdate } from "./primitiveAppearance";
import type { DrawStats, ViewState } from "./webGlFloorplanRenderer";
import { validateRasterLayerUpdates } from "./rasterLayerUpdates";
import type { DeferredSceneRendererApi } from "./deferredRendererApi";

/**
 * Independent Three page views share one native fallback context. Until a view
 * actually needs the fallback, its renderer is just local CPU state. A fallback
 * frame is copied into that view's canvas before another page can reuse the GPU.
 * The document, not its page views, owns and disposes the native renderer.
 */
export class SharedPageRenderer {
  private active: object | null = null;
  private readonly renderer: RendererApi;
  private readonly canvas: HTMLCanvasElement;
  private readonly documentRenderer: Partial<DeferredSceneRendererApi>;
  private documentRevision = -1;
  constructor(renderer: RendererApi, canvas: HTMLCanvasElement) {
    this.documentRenderer = renderer;
    this.renderer = this.documentRenderer.getNativeRenderer?.() ?? renderer; this.canvas = canvas;
  }

  createView(initialScene: VectorScene, canvas: HTMLCanvasElement): RendererApi {
    const identity = {}, config = new Map<string, unknown[]>();
    const colors = new Map<string, PrimitiveColorUpdate>();
    let source = initialScene, disposed = false, dirty = true;
    let sceneOptions: SceneUpdateOptions | undefined;
    let view: ViewState = { cameraCenterX: 0, cameraCenterY: 0, zoom: 1 };
    let presented = { ...view }, serial = 0;
    let listener: ((stats: DrawStats) => void) | null = null;
    let provider: (() => DOMRect | DOMRectReadOnly | null) | null = null;
    const replacements = new Map<number, RasterLayer>();
    const native = this.renderer;
    const apply = (key: string, args: unknown[]): unknown => {
      const method = (native as unknown as Record<string, unknown>)[key];
      return typeof method === "function" ? Reflect.apply(method, native, args) : undefined;
    };
    const acquire = (): RendererApi => {
      if (disposed) throw new DOMException("PDF page disposed.", "AbortError");
      const revision = this.documentRenderer.getSceneUploadRevision?.() ?? 0;
      const changed = this.active !== identity || this.documentRevision !== revision;
      if (changed) {
        this.documentRenderer.invalidateUploadedScene?.();
        this.documentRevision = revision;
        this.active = identity;
        try {
          if (sceneOptions?.preserveRasterResolution) {
            if (this.canvas.width !== canvas.width || this.canvas.height !== canvas.height) {
              this.canvas.width = canvas.width; this.canvas.height = canvas.height; native.resize();
            }
            native.setViewState(view, { scheduleFrame: false });
          }
          native.setScene(source, sceneOptions);
        } catch (error) { this.active = null; throw error; }
        dirty = true;
      }
      if (this.canvas.width !== canvas.width || this.canvas.height !== canvas.height) {
        this.canvas.width = canvas.width; this.canvas.height = canvas.height; native.resize();
      }
      if (dirty) {
        native.setExternalFrameDriver?.(true);
        for (const [key, args] of config) apply(key, args);
        native.setPrimitiveColorUpdates?.([...colors.values()]);
        if (replacements.size) {
          const staged = native.prepareRasterLayerUpdates?.(replacements);
          try { staged?.commit(); } finally { staged?.dispose(); }
        }
        dirty = false;
      }
      native.setViewState(view, { scheduleFrame: false });
      native.setInteractionViewportProvider(provider);
      native.setFrameListener(stats => listener?.(stats));
      return native;
    };
    const copyFrame = (): void => {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Independent PDF page fallback requires a 2D canvas.");
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(this.canvas, 0, 0, canvas.width, canvas.height);
      presented = { ...native.getPresentedViewState() }; serial++;
    };
    const methods: Record<string, (...args: any[]) => unknown> = {
      dispose: () => { disposed = true; listener = null; provider = null; config.clear(); colors.clear(); replacements.clear();
        if (this.active === identity) { this.active = null; native.setFrameListener(null); native.setInteractionViewportProvider(null); } },
      setScene: (scene: VectorScene, options?: SceneUpdateOptions) => { source = scene; sceneOptions = options;
        if (this.active === identity) this.active = null; return acquire().getSceneStats(); },
      getSceneStats: () => acquire().getSceneStats(),
      getViewState: () => ({ ...view }),
      setViewState: (next: ViewState) => { view = { ...next }; },
      getPresentedViewState: () => ({ ...presented }),
      getPresentedFrameSerial: () => serial,
      setFrameListener: (next: typeof listener) => { listener = next; },
      setInteractionViewportProvider: (next: typeof provider) => { provider = next; },
      setExternalFrameDriver: (enabled: boolean) => { if (!enabled) throw new Error("Independent PDF pages are driven by their Three.js host renderer."); },
      resize: () => {},
      fitToBounds: (bounds: VectorScene["bounds"], padding = 0) => {
        view = { cameraCenterX: (bounds.minX + bounds.maxX) / 2, cameraCenterY: (bounds.minY + bounds.maxY) / 2,
          zoom: Math.max(1e-6, Math.min(Math.max(1, canvas.width - padding * 2) / Math.max(1e-6, bounds.maxX - bounds.minX),
            Math.max(1, canvas.height - padding * 2) / Math.max(1e-6, bounds.maxY - bounds.minY))) };
      },
      renderExternalFrame: (timestamp?: number) => { acquire().renderExternalFrame?.(timestamp); copyFrame(); },
      renderProjectedFrame: (options: Parameters<NonNullable<RendererApi["renderProjectedFrame"]>>[0]) => {
        const result = acquire().renderProjectedFrame?.(options); copyFrame(); return result;
      },
      getVectorStrokeLodStats: () => this.active === identity ? native.getVectorStrokeLodStats?.() ?? null : null,
      getTextLodStats: () => this.active === identity ? native.getTextLodStats?.() ?? null : null,
      getOptionalContentVisibility: () => config.get("setOptionalContentVisibility")?.[0] ?? null,
      getVectorColorOverride: () => config.get("setVectorColorOverride") ?? [0,0,0,0],
      setPrimitiveColorUpdates: (updates: readonly PrimitiveColorUpdate[]) => {
        for (const update of updates) colors.set(`${update.ref.kind}:${update.ref.index}`, update); dirty = true;
      },
      getRasterLayerUpdates: () => new Map(replacements),
      prepareRasterLayerUpdates: (updates: ReadonlyMap<number, RasterLayer>) => {
        validateRasterLayerUpdates(source, updates);
        const capturedScene = source;
        const staged = new Map(updates); let released = false;
        return { commit: () => { if (disposed || released || source !== capturedScene) throw new DOMException("PDF page update cancelled.", "AbortError");
          for (const [index, layer] of staged) replacements.set(index, layer); dirty = true; }, dispose: () => { released = true; } };
      },
      // Preparation updates CPU state; acquiring the shared context here would upload every page.
      prepareRasterLayerUpdatesAsync: async (updates: ReadonlyMap<number, RasterLayer>) => methods.prepareRasterLayerUpdates(updates)
    };
    const forwarded = new Map<PropertyKey, Function>();
    return new Proxy(methods, {
      get: (_target, key) => {
        if (typeof key !== "string") return undefined;
        if (methods[key]) return methods[key];
        if (forwarded.has(key)) return forwarded.get(key);
        if (typeof (native as unknown as Record<string, unknown>)[key] !== "function") return undefined;
        const method = key.startsWith("set")
          ? (...args: unknown[]) => { config.set(key, args); dirty = true; }
          : (...args: unknown[]) => { const renderer = acquire(); const result = apply(key, args); view = { ...renderer.getViewState() }; return result; };
        forwarded.set(key, method); return method;
      }
    }) as unknown as RendererApi;
  }
}
