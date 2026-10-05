import type { Camera } from "three";
import type { HeprThreePdfObject } from "./threePdfObject";
import type { AnnotationInteractionAdapter } from "./annotationInteraction";

export function createThreeAnnotationInteractionAdapter(options: {
  getCanvas(): HTMLCanvasElement;
  getCamera(): Camera;
  getPdfObject(): HeprThreePdfObject | null;
  requestRender(): void;
}): AnnotationInteractionAdapter {
  return {
    getCanvas: options.getCanvas, getTarget: options.getPdfObject,
    getScene: () => options.getPdfObject()?.sceneData ?? null,
    getViewKey() {
      const camera = options.getCamera(), pdf = options.getPdfObject();
      camera.updateWorldMatrix(true, false); pdf?.updateWorldMatrix(true, true);
      const pages = pdf?.children.filter(child => child.userData.hepr).map(page => page.matrixWorld.elements.join(",")).join(":") ?? "";
      return `${camera.projectionMatrix.elements.join(",")}:${camera.matrixWorld.elements.join(",")}:` +
        `${pdf?.matrixWorld.elements.join(",") ?? ""}:${pages}:${pdf?.layerVisibilityRevision ?? 0}`;
    },
    async pick(point, signal) {
      return options.getPdfObject()?.pickAnnotation({ camera: options.getCamera(), element: options.getCanvas(),
        clientX: point.x, clientY: point.y, tolerancePx: 4, includeHidden: true, signal }) ?? null;
    },
    setSelection(ids) { options.getPdfObject()?.setAnnotationSelection(ids); options.requestRender(); },
    setHover(id) { options.getPdfObject()?.setAnnotationHover(id); options.requestRender(); }
  };
}
