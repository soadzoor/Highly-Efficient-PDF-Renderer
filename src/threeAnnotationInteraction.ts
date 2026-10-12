import type { Camera } from "three";
import type { HeprThreePdfObject } from "./threePdfObject";
import type { AnnotationInteractionAdapter } from "./annotationInteraction";
import { createThreeViewKey } from "./threeViewKey";

export function createThreeAnnotationInteractionAdapter(options: {
  getCanvas(): HTMLCanvasElement;
  getCamera(): Camera;
  getPdfObject(): HeprThreePdfObject | null;
  requestRender(): void;
}): AnnotationInteractionAdapter {
  return {
    getCanvas: options.getCanvas, getTarget: options.getPdfObject,
    getScene: () => options.getPdfObject()?.sceneData ?? null,
    getViewKey: createThreeViewKey(() => options.getCamera(), () => options.getPdfObject()),
    async pick(point, signal) {
      return options.getPdfObject()?.pickAnnotation({ camera: options.getCamera(), element: options.getCanvas(),
        clientX: point.x, clientY: point.y, tolerancePx: 4, includeHidden: true, signal }) ?? null;
    },
    setSelection(ids) { options.getPdfObject()?.setAnnotationSelection(ids); options.requestRender(); },
    setHover(id) { options.getPdfObject()?.setAnnotationHover(id); options.requestRender(); }
  };
}
