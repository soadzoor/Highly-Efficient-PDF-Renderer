import { MathUtils, Vector3, type PerspectiveCamera } from "three";
import type { MapControls } from "three/examples/jsm/controls/MapControls.js";
import type { HeprThreePdfObject } from "./threePdfObject";
import { createViewerLinkNavigation } from "./viewerLinkNavigation";
import type { LinkCameraView } from "./viewerLinkNavigation";
import type { VectorScene } from "./pdfVectorExtractor";

/** Shared camera adapter for the Three and room-detection examples. */
export function createThreeLinkNavigation(options: {
  getCanvas(): HTMLCanvasElement;
  getPdfObject(): HeprThreePdfObject | null;
  camera: PerspectiveCamera;
  getControls(): MapControls;
  getSourceUrl?(): string | undefined;
  /** Reader hosts map canonical scene coordinates through their page arrangement. */
  getReaderView?(): LinkCameraView | null;
  setReaderView?(view: LinkCameraView): void;
  getReaderScene?(): VectorScene | null;
  onCameraChange(): void;
}) {
  const { camera } = options;
  let cachedObject: HeprThreePdfObject | null = null;
  const center = new Vector3();
  function objectFrame() {
    const object = options.getPdfObject();
    if (!object) return null;
    if (cachedObject !== object) {
      cachedObject = object;
      // HeprThreePdfObject centers its local geometry on the union of page rectangles.
      const scene = object.sceneData, rects = scene.pageRects;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i + 3 < rects.length; i += 4) {
        if (![rects[i], rects[i + 1], rects[i + 2], rects[i + 3]].every(Number.isFinite)) continue;
        minX = Math.min(minX, rects[i], rects[i + 2]); minY = Math.min(minY, rects[i + 1], rects[i + 3]);
        maxX = Math.max(maxX, rects[i], rects[i + 2]); maxY = Math.max(maxY, rects[i + 1], rects[i + 3]);
      }
      if (!Number.isFinite(minX)) {
        const bounds = Object.values(scene.pageBounds).every(Number.isFinite) ? scene.pageBounds : scene.bounds;
        ({ minX, minY, maxX, maxY } = bounds);
      }
      center.set((minX + maxX) / 2, (minY + maxY) / 2, 0);
    }
    object.updateWorldMatrix(true, false);
    const scale = object.getWorldScale(new Vector3());
    const height = options.getCanvas().getBoundingClientRect().height;
    const focalLength = height / (2 * Math.tan(MathUtils.degToRad(camera.getEffectiveFOV()) / 2));
    return { object, pixelsAtUnitDistance: focalLength * Math.max(Math.abs(scale.x), Math.abs(scale.y)) };
  }
  return createViewerLinkNavigation({
    getCanvas: options.getCanvas,
    getScene: () => options.getReaderScene?.() ?? options.getPdfObject()?.sceneData ?? null,
    getIdentity: () => options.getPdfObject(),
    getSourceUrl: options.getSourceUrl,
    getView() {
      const readerView = options.getReaderView?.();
      if (readerView) return readerView;
      const frame = objectFrame();
      if (!frame) return null;
      const controls = options.getControls();
      const target = frame.object.worldToLocal(controls.target.clone()).add(center);
      return { centerX: target.x, centerY: target.y,
        zoom: frame.pixelsAtUnitDistance / Math.max(1e-6, camera.position.distanceTo(controls.target)) };
    },
    setView(view) {
      if (options.getReaderView?.()) {
        options.setReaderView?.(view);
        return;
      }
      const frame = objectFrame();
      if (!frame) return;
      const controls = options.getControls();
      const direction = camera.position.clone().sub(controls.target).normalize();
      if (direction.lengthSq() === 0) direction.set(0, 0, 1);
      const target = frame.object.localToWorld(new Vector3(view.centerX, view.centerY, 0).sub(center));
      const distance = Math.max(controls.minDistance, Math.min(controls.maxDistance, frame.pixelsAtUnitDistance / view.zoom));
      controls.target.copy(target);
      camera.position.copy(target).addScaledVector(direction, distance);
      controls.update();
      options.onCameraChange();
    }
  });
}
