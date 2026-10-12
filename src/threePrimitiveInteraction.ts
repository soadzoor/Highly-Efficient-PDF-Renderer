import type { Camera } from "three";
import type { HeprThreePdfObject } from "./threePdfObject";
import {
  createPrimitiveInteractionControllerForAdapter,
  type PrimitiveInteractionCallbacks, type PrimitiveInteractionController
} from "./primitiveInteraction";
import { createThreeViewKey } from "./threeViewKey";

export interface ThreePrimitiveInteractionOptions extends PrimitiveInteractionCallbacks {
  getCanvas(): HTMLCanvasElement;
  getCamera(): Camera;
  getPdfObject(): HeprThreePdfObject | null;
  requestRender(): void;
}

/** Optional mouse/touch drawing selection for Three hosts, sharing the native viewer's gestures.
 * Call onFrame after view updates, sceneChanged after replacing a document, and
 * rendererChanged when replacing the object/canvas for the same canonical scene.
 */
export function createThreePrimitiveInteractionController(
  options: ThreePrimitiveInteractionOptions
): PrimitiveInteractionController {
  let object: HeprThreePdfObject | null = null;
  let unsubscribe: (() => void) | null = null;
  let onProgress: (percentage: number | null) => void = () => {};
  let hoverKey: string | null | undefined;

  function detach(): void {
    unsubscribe?.(); unsubscribe = null;
    object?.clearPrimitiveInteraction(); object = null;
    hoverKey = undefined;
    options.requestRender();
  }

  function attach(): void {
    object = options.getPdfObject();
    const owner = object;
    if (owner) unsubscribe = owner.subscribePrimitivePreparationProgress(percentage => {
      if (object === owner && options.getPdfObject() === owner) onProgress(percentage);
    });
    else onProgress(null);
  }

  return createPrimitiveInteractionControllerForAdapter({
    isVisible: ref => options.getPdfObject()?.isPrimitiveVisible(ref) ?? false,
    getCanvas: options.getCanvas,
    getScene: () => options.getPdfObject()?.sceneData ?? null,
    getTarget: options.getPdfObject,
    getViewKey: createThreeViewKey(() => options.getCamera(), () => options.getPdfObject()),
    async pick(point, signal) {
      return object?.pick({ camera: options.getCamera(), element: options.getCanvas(),
        clientX: point.x, clientY: point.y, tolerancePx: 4, signal }) ?? null;
    },
    setHover(ref) {
      const key = ref ? `${ref.kind}:${ref.index}` : null;
      if (key === hoverKey) return;
      object?.setHover(ref); hoverKey = key;
      options.requestRender();
    },
    setSelection(refs) { object?.setSelection(refs); options.requestRender(); },
    setOverrides(refs, color) { object?.setPrimitiveOverrides(refs, { color }); options.requestRender(); },
    clearOverrides(refs) { object?.clearPrimitiveOverrides(refs); options.requestRender(); },
    sceneChanged(progress) { detach(); onProgress = progress; attach(); },
    rendererChanged() { detach(); onProgress(null); attach(); },
    dispose: detach
  }, options);
}
