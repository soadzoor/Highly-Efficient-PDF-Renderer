import type { VectorScene } from "./pdfVectorExtractor";
import type { RendererApi } from "./rendererTypes";
import { RetainedPageReplay } from "./retainedPageReplay";
import { OptionalContentController, type LayerVisibilityChange, type OptionalContentControllerOptions,
  type OptionalContentListener, type OptionalContentSnapshot, type LayerVisibilitySummary } from "./optionalContent";

export interface LayerVisibilityOptions extends OptionalContentControllerOptions {
  getScene(): VectorScene | null;
  getRenderer(): RendererApi;
}

/** Per-view native layer state, independent of drawing-selection gestures and GPU backend. */
export function createLayerVisibilityController(options: LayerVisibilityOptions) {
  let scene: VectorScene | null = null;
  let controller: OptionalContentController | null = null;
  let replay: RetainedPageReplay | null = null;
  let snapshot: OptionalContentSnapshot | null = null;
  const rememberedVisibility = new Map<string, boolean>();
  const listeners = new Set<OptionalContentListener>();
  const notify = (value: OptionalContentSnapshot, remember = true): void => {
    snapshot = value;
    if (remember) for (const layer of value.layers) rememberedVisibility.set(layer.id, layer.visible);
    options.getRenderer().setOptionalContentVisibility?.(value);
    try { options.onChange?.(value); } catch { /* Observers cannot roll back an applied revision. */ }
    for (const listener of listeners) { try { listener(value); } catch { /* Isolate host observers. */ } }
  };
  return {
    getLayers: () => controller?.getLayers() ?? [],
    getLayerOrder: () => controller?.getOrder() ?? [],
    getOptionalContentVisibility: () => snapshot,
    setLayerVisibility(id: string, visible: boolean): Promise<void> {
      return controller?.setLayerVisibility(id, visible) ?? Promise.reject(new Error("No PDF is loaded."));
    },
    setLayerVisibilities(changes: readonly LayerVisibilityChange[]): Promise<void> {
      return controller?.setLayerVisibilities(changes) ?? Promise.reject(new Error("No PDF is loaded."));
    },
    setAllLayerVisibility(visible: boolean, layerIds?: readonly string[]): Promise<void> {
      return controller?.setAllLayerVisibility(visible, layerIds) ?? Promise.reject(new Error("No PDF is loaded."));
    },
    getAllLayerVisibility(layerIds?: readonly string[]): LayerVisibilitySummary {
      return controller?.getAllLayerVisibility(layerIds) ?? { checked: false, indeterminate: false, disabled: true };
    },
    resetLayerVisibility: () => controller?.resetLayerVisibility() ?? Promise.resolve(),
    getAnnotationLayers: () => controller?.getAnnotationLayers() ?? [],
    setAnnotationVisibility(annotationIds: readonly string[], visible: boolean): Promise<void> {
      return controller?.setAnnotationVisibility(annotationIds, visible) ?? Promise.reject(new Error("No PDF is loaded."));
    },
    subscribeLayerVisibility(listener: OptionalContentListener): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    sceneChanged(preserveVisibility = false): Promise<void> {
      const next = options.getScene();
      if (next === scene) return Promise.resolve();
      if (!preserveVisibility) rememberedVisibility.clear();
      controller?.dispose();
      replay?.dispose(); replay = null;
      controller = null;
      snapshot = null;
      scene = next;
      if (scene) {
        replay = scene.retainedPages?.length ? new RetainedPageReplay(scene) : null;
        const owner = replay;
        controller = new OptionalContentController(scene, { ...options, onChange: notify,
          prepare: async (value, context) => {
            const hostCommit = await options.prepare?.(value, context);
            const prepared = await owner?.prepare(value, context);
            context.signal.throwIfAborted();
            let target = options.getRenderer();
            let resources = prepared ? target.prepareRasterLayerUpdates?.(prepared.layers) : undefined;
            const abort = (): void => resources?.dispose();
            context.signal.addEventListener("abort", abort, { once: true });
            return () => {
              try {
                context.signal.throwIfAborted();
                if (target !== options.getRenderer()) {
                  resources?.dispose(); target = options.getRenderer();
                  // A replacement starts with canonical defaults. Include prior
                  // applied revisions before overlaying this preparation's delta.
                  const updates = new Map(owner?.getLayers());
                  for (const [index, layer] of prepared?.layers ?? []) updates.set(index, layer);
                  resources = prepared ? target.prepareRasterLayerUpdates?.(updates) : undefined;
                }
                hostCommit?.(); resources?.commit(); prepared?.commit();
              } finally { context.signal.removeEventListener("abort", abort); resources?.dispose(); }
            };
          } });
        const target = controller;
        const changes = preserveVisibility ? target.getLayers().filter(layer => !layer.locked && layer.usedInView &&
          rememberedVisibility.has(layer.id) && rememberedVisibility.get(layer.id) !== layer.visible)
          .map(layer => ({ id: layer.id, visible: rememberedVisibility.get(layer.id)! })) : [];
        const annotations = preserveVisibility ? scene.optionalContent?.groups.filter(group => group.annotationId &&
          rememberedVisibility.has(group.id)).map(group => ({ id: group.annotationId!, visible: rememberedVisibility.get(group.id)! })) ?? [] : [];
        notify(target.getSnapshot(), !preserveVisibility);
        if (changes.length || annotations.length) return (async () => {
          if (changes.length) await target.setLayerVisibilities(changes);
          for (const visible of [false, true]) {
            const ids = annotations.filter(annotation => annotation.visible === visible).map(annotation => annotation.id);
            if (ids.length) await target.setAnnotationVisibility(ids, visible);
          }
        })();
      }
      return Promise.resolve();
    },
    rendererChanged(): void {
      if (replay) {
        const resources = options.getRenderer().prepareRasterLayerUpdates?.(replay.getLayers());
        try { resources?.commit(); } finally { resources?.dispose(); }
      }
      if (snapshot) options.getRenderer().setOptionalContentVisibility?.(snapshot);
    },
    dispose(): void { controller?.dispose(); replay?.dispose(); replay = null; controller = null; scene = null; snapshot = null; listeners.clear(); rememberedVisibility.clear(); }
  };
}

export type LayerVisibilityController = ReturnType<typeof createLayerVisibilityController>;
