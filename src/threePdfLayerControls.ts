import type { HeprThreePdfObject } from "./threePdfObject";
import type { OptionalContentListener } from "./optionalContent";
import { createPdfLayerControls } from "./pdfLayerControls";
import { waitForLoad } from "./loadCancellation";

export interface ThreePdfLayerControlsOptions {
  container: HTMLElement;
  getPdfObject(): HeprThreePdfObject | null;
  requestRender(): void;
  /** Refresh host search/selection UI after an applied visibility change. */
  onVisibilityChange?(): void;
}

/** Shared layer panel binding for Three hosts. Call objectChanged after assigning
 * a PDF object (including null), before disposing its predecessor. The host owns
 * the PDF objects and canvas; the panel owns only its DOM and subscriptions. */
export function createThreePdfLayerControls(options: ThreePdfLayerControlsOptions) {
  let object: HeprThreePdfObject | null = null;
  let disposed = false;
  let generation = 0;
  let unsubscribeVisibility: (() => void) | null = null;
  let unsubscribeProgress: (() => void) | null = null;
  let preparation: AbortController | null = null;
  const listeners = new Set<OptionalContentListener>();
  const pending = new Set<Promise<void>>();
  const current = (): HeprThreePdfObject | null =>
    !disposed && options.getPdfObject() === object ? object : null;
  const change = (operation: (pdf: HeprThreePdfObject) => Promise<void>): Promise<void> => {
    const owner = current();
    if (!owner) return Promise.reject(new Error("No PDF is loaded."));
    const task = operation(owner);
    pending.add(task);
    void task.then(() => pending.delete(task), () => pending.delete(task));
    return task;
  };
  const controls = createPdfLayerControls({ container: options.container, controller: {
    getLayers: () => current()?.getLayers() ?? [],
    getLayerOrder: () => current()?.getLayerOrder() ?? [],
    getAllLayerVisibility: () => current()?.getAllLayerVisibility() ??
      { checked: false, indeterminate: false, disabled: true },
    setLayerVisibility: (id, visible) => change(pdf => pdf.setLayerVisibility(id, visible)),
    setAllLayerVisibility: visible => change(pdf => pdf.setAllLayerVisibility(visible)),
    resetLayerVisibility: () => change(pdf => pdf.resetLayerVisibility()),
    subscribeLayerVisibility(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }
  } });

  function objectChanged(): void {
    if (disposed) return;
    const next = options.getPdfObject();
    if (object === next) return;
    const sameScene = object !== null && object.sceneData === next?.sceneData;
    const token = ++generation;
    preparation?.abort(new DOMException("PDF object replaced.", "AbortError"));
    preparation = null;
    unsubscribeVisibility?.(); unsubscribeProgress?.();
    unsubscribeVisibility = unsubscribeProgress = null;
    pending.clear();
    object = next;
    controls.setEnabled(true);
    controls.refresh({ resetFilter: !sameScene });
    if (next) {
      let previousVisibility = next.getOptionalContentVisibility();
      unsubscribeVisibility = next.subscribeLayerVisibility(snapshot => {
        if (token !== generation || current() !== next) return;
        const changed = previousVisibility.layers.length !== snapshot.layers.length ||
          previousVisibility.layers.some((layer, index) => layer.id !== snapshot.layers[index].id || layer.visible !== snapshot.layers[index].visible) ||
          previousVisibility.conditions.length !== snapshot.conditions.length ||
          previousVisibility.conditions.some((value, index) => value !== snapshot.conditions[index]);
        previousVisibility = snapshot;
        for (const listener of listeners) {
          try { listener(snapshot); } catch { /* Isolate panel observers. */ }
        }
        // Display page residency republishes the same visibility while replacing
        // resources. Keep controls current without dirtying host thumbnails.
        try { if (changed) options.onVisibilityChange?.(); } finally { options.requestRender(); }
      });
      unsubscribeProgress = next.subscribeLayerVisibilityProgress(percentage => {
        if (token === generation && current() === next) controls.setProgress(percentage);
      });
    }
    options.requestRender();
  }

  objectChanged();
  return {
    objectChanged,
    /** Prepare a same-scene replacement before installing it. Let any pending
     * panel operation finish, then replay the latest applied visibility. This
     * prevents a layer toggle during backend setup from being silently lost. */
    async prepareReplacement(next: HeprThreePdfObject, signal?: AbortSignal): Promise<void> {
      signal?.throwIfAborted();
      if (disposed) throw new DOMException("Layer controls disposed.", "AbortError");
      const owner = current();
      if (!owner || owner === next || owner.sceneData !== next.sceneData) return;
      preparation?.abort(new DOMException("Layer preparation superseded.", "AbortError"));
      const controller = new AbortController();
      preparation = controller;
      const abort = (): void => controller.abort(signal?.reason);
      signal?.addEventListener("abort", abort, { once: true });
      controls.setEnabled(false);
      let unsubscribe: (() => void) | undefined;
      const assertCurrent = (): void => {
        controller.signal.throwIfAborted();
        if (current() !== owner) throw new DOMException("PDF object replaced.", "AbortError");
      };
      try {
        while (pending.size) {
          await waitForLoad(Promise.allSettled([...pending]), controller.signal);
          assertCurrent();
        }
        unsubscribe = next.subscribeLayerVisibilityProgress(percentage => {
          if (preparation === controller && !controller.signal.aborted && current() === owner) controls.setProgress(percentage);
        });
        let revision: number;
        do {
          assertCurrent();
          revision = owner.layerVisibilityRevision;
          const changes = owner.getLayers().filter(layer => layer.visible !== layer.defaultVisible)
            .map(({ id, visible }) => ({ id, visible }));
          const annotations = owner.getAnnotationLayers();
          // PDF defaults can enable several radio alternatives. Reset preserves
          // those authored defaults; an explicit all-layer batch would reject
          // them. Reset on retries also restores choices reverted by the user.
          await waitForLoad(next.resetLayerVisibility(), controller.signal);
          assertCurrent();
          if (changes.length) await waitForLoad(next.setLayerVisibilities(changes), controller.signal);
          assertCurrent();
          // Hidden annotation appearances are host state and survive the switch too.
          for (const visible of [true, false]) {
            const ids = annotations.filter(layer => layer.visible === visible).map(layer => layer.annotationId);
            if (ids.length) await waitForLoad(next.setAnnotationVisibility(ids, visible), controller.signal);
            assertCurrent();
          }
        } while (revision !== owner.layerVisibilityRevision);
      } finally {
        signal?.removeEventListener("abort", abort);
        unsubscribe?.();
        if (preparation === controller) {
          preparation = null;
          controls.setEnabled(true);
          controls.setProgress(null);
        }
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true; generation++;
      preparation?.abort(new DOMException("Layer controls disposed.", "AbortError"));
      preparation = null;
      unsubscribeVisibility?.(); unsubscribeProgress?.();
      unsubscribeVisibility = unsubscribeProgress = null;
      object = null; pending.clear();
      controls.dispose(); listeners.clear();
    }
  };
}
