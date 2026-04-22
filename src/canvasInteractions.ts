import type { RendererApi } from "./rendererTypes";

type InteractionRenderer = Pick<
  RendererApi,
  "beginPanInteraction" | "endPanInteraction" | "panByPixels" | "zoomAtClientPoint"
>;

export interface CanvasInteractionController {
  attach(targetCanvas: HTMLCanvasElement): void;
  detach(): void;
  resetState(): void;
}

export function createCanvasInteractionController(
  getRenderer: () => InteractionRenderer
): CanvasInteractionController {
  let attachedCanvas: HTMLCanvasElement | null = null;
  let isPanning = false;
  let previousX = 0;
  let previousY = 0;
  const activePointerIds = new Set<number>();
  const activeTouchPointers = new Map<number, { x: number; y: number }>();
  let touchPanPointerId: number | null = null;
  let touchPinchActive = false;
  let touchPreviousDistance = 0;
  let touchPreviousCenterX = 0;
  let touchPreviousCenterY = 0;

  function resetState(): void {
    isPanning = false;
    previousX = 0;
    previousY = 0;
    activePointerIds.clear();
    activeTouchPointers.clear();
    touchPanPointerId = null;
    touchPinchActive = false;
    touchPreviousDistance = 0;
    touchPreviousCenterX = 0;
    touchPreviousCenterY = 0;
  }

  function resetTouchGestureState(): void {
    activeTouchPointers.clear();
    touchPanPointerId = null;
    touchPinchActive = false;
    touchPreviousDistance = 0;
    touchPreviousCenterX = 0;
    touchPreviousCenterY = 0;
  }

  function resetPointerGestureState(endPan: boolean): void {
    if (endPan && isPanning) {
      getRenderer().endPanInteraction();
    }
    resetTouchGestureState();
    resetState();
  }

  function getTouchPinchInfo(): { distance: number; centerX: number; centerY: number } | null {
    if (activeTouchPointers.size < 2) {
      return null;
    }
    const iter = activeTouchPointers.values();
    const first = iter.next().value as { x: number; y: number } | undefined;
    const second = iter.next().value as { x: number; y: number } | undefined;
    if (!first || !second) {
      return null;
    }

    const dx = second.x - first.x;
    const dy = second.y - first.y;
    return {
      distance: Math.hypot(dx, dy),
      centerX: (first.x + second.x) * 0.5,
      centerY: (first.y + second.y) * 0.5
    };
  }

  function releasePointerCaptureIfHeld(targetCanvas: HTMLCanvasElement, pointerId: number): void {
    if (!targetCanvas.hasPointerCapture(pointerId)) {
      return;
    }
    try {
      targetCanvas.releasePointerCapture(pointerId);
    } catch {
      // Ignore release failures when pointer capture is already gone.
    }
  }

  function handleTouchPointerMove(event: PointerEvent): void {
    if (!activeTouchPointers.has(event.pointerId) || !isPanning) {
      return;
    }

    activeTouchPointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    });

    const renderer = getRenderer();

    if (activeTouchPointers.size >= 2) {
      const pinchInfo = getTouchPinchInfo();
      if (!pinchInfo) {
        return;
      }

      if (!touchPinchActive) {
        touchPinchActive = true;
        touchPanPointerId = null;
        touchPreviousDistance = Math.max(pinchInfo.distance, 1e-3);
        touchPreviousCenterX = pinchInfo.centerX;
        touchPreviousCenterY = pinchInfo.centerY;
        return;
      }

      const previousDistance = Math.max(touchPreviousDistance, 1e-3);
      const nextDistance = Math.max(pinchInfo.distance, 1e-3);
      const zoomFactor = nextDistance / previousDistance;

      const centerDeltaX = pinchInfo.centerX - touchPreviousCenterX;
      const centerDeltaY = pinchInfo.centerY - touchPreviousCenterY;
      if (centerDeltaX !== 0 || centerDeltaY !== 0) {
        renderer.panByPixels(centerDeltaX, centerDeltaY);
      }

      if (Number.isFinite(zoomFactor) && Math.abs(zoomFactor - 1) > 1e-4) {
        renderer.zoomAtClientPoint(pinchInfo.centerX, pinchInfo.centerY, zoomFactor);
      }

      touchPreviousDistance = nextDistance;
      touchPreviousCenterX = pinchInfo.centerX;
      touchPreviousCenterY = pinchInfo.centerY;
      return;
    }

    if (touchPanPointerId === null) {
      touchPanPointerId = event.pointerId;
      previousX = event.clientX;
      previousY = event.clientY;
      touchPinchActive = false;
      touchPreviousDistance = 0;
      return;
    }

    if (event.pointerId !== touchPanPointerId) {
      return;
    }

    const deltaX = event.clientX - previousX;
    const deltaY = event.clientY - previousY;

    previousX = event.clientX;
    previousY = event.clientY;

    renderer.panByPixels(deltaX, deltaY);
  }

  function handleTouchPointerEnd(targetCanvas: HTMLCanvasElement, event: PointerEvent): void {
    activeTouchPointers.delete(event.pointerId);
    activePointerIds.delete(event.pointerId);
    releasePointerCaptureIfHeld(targetCanvas, event.pointerId);

    if (activeTouchPointers.size >= 2) {
      const pinchInfo = getTouchPinchInfo();
      if (pinchInfo) {
        touchPinchActive = true;
        touchPanPointerId = null;
        touchPreviousDistance = Math.max(pinchInfo.distance, 1e-3);
        touchPreviousCenterX = pinchInfo.centerX;
        touchPreviousCenterY = pinchInfo.centerY;
      }
      return;
    }

    if (activeTouchPointers.size === 1) {
      const remaining = activeTouchPointers.entries().next().value as [number, { x: number; y: number }] | undefined;
      if (remaining) {
        touchPanPointerId = remaining[0];
        previousX = remaining[1].x;
        previousY = remaining[1].y;
      } else {
        touchPanPointerId = null;
      }
      touchPinchActive = false;
      touchPreviousDistance = 0;
      touchPreviousCenterX = 0;
      touchPreviousCenterY = 0;
      return;
    }

    resetPointerGestureState(true);
  }

  const handlePointerDown = (event: PointerEvent): void => {
    const targetCanvas = attachedCanvas;
    if (!targetCanvas) {
      return;
    }
    activePointerIds.add(event.pointerId);

    if (!isPanning) {
      isPanning = true;
      getRenderer().beginPanInteraction();
    }

    if (event.pointerType === "touch") {
      activeTouchPointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY
      });

      if (activeTouchPointers.size === 1) {
        touchPanPointerId = event.pointerId;
        touchPinchActive = false;
        touchPreviousDistance = 0;
        touchPreviousCenterX = event.clientX;
        touchPreviousCenterY = event.clientY;
        previousX = event.clientX;
        previousY = event.clientY;
      } else {
        const pinchInfo = getTouchPinchInfo();
        if (pinchInfo) {
          touchPinchActive = true;
          touchPanPointerId = null;
          touchPreviousDistance = Math.max(pinchInfo.distance, 1e-3);
          touchPreviousCenterX = pinchInfo.centerX;
          touchPreviousCenterY = pinchInfo.centerY;
        }
      }
    } else {
      previousX = event.clientX;
      previousY = event.clientY;
    }

    targetCanvas.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerType === "touch") {
      handleTouchPointerMove(event);
      return;
    }

    if (!isPanning) {
      return;
    }

    const deltaX = event.clientX - previousX;
    const deltaY = event.clientY - previousY;

    previousX = event.clientX;
    previousY = event.clientY;

    getRenderer().panByPixels(deltaX, deltaY);
  };

  const handlePointerUp = (event: PointerEvent): void => {
    const targetCanvas = attachedCanvas;
    if (!targetCanvas) {
      return;
    }

    if (event.pointerType === "touch") {
      handleTouchPointerEnd(targetCanvas, event);
      return;
    }

    activePointerIds.delete(event.pointerId);
    resetPointerGestureState(true);
    releasePointerCaptureIfHeld(targetCanvas, event.pointerId);
  };

  const handlePointerCancel = (event: PointerEvent): void => {
    const targetCanvas = attachedCanvas;
    if (!targetCanvas) {
      return;
    }

    if (event.pointerType === "touch") {
      handleTouchPointerEnd(targetCanvas, event);
      return;
    }

    activePointerIds.delete(event.pointerId);
    resetPointerGestureState(true);
    releasePointerCaptureIfHeld(targetCanvas, event.pointerId);
  };

  const handleLostPointerCapture = (event: PointerEvent): void => {
    activePointerIds.delete(event.pointerId);
    if (event.pointerType === "touch") {
      if (activeTouchPointers.has(event.pointerId)) {
        activeTouchPointers.delete(event.pointerId);
      }
      if (activeTouchPointers.size === 0) {
        resetPointerGestureState(true);
      }
      return;
    }

    if (isPanning) {
      resetPointerGestureState(true);
    }
  };

  const handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const zoomFactor = Math.exp(-event.deltaY * 0.0013);
    getRenderer().zoomAtClientPoint(event.clientX, event.clientY, zoomFactor);
  };

  function attach(targetCanvas: HTMLCanvasElement): void {
    if (attachedCanvas === targetCanvas) {
      return;
    }

    if (attachedCanvas) {
      detach();
    }

    attachedCanvas = targetCanvas;
    targetCanvas.addEventListener("pointerdown", handlePointerDown);
    targetCanvas.addEventListener("pointermove", handlePointerMove);
    targetCanvas.addEventListener("pointerup", handlePointerUp);
    targetCanvas.addEventListener("pointercancel", handlePointerCancel);
    targetCanvas.addEventListener("lostpointercapture", handleLostPointerCapture);
    targetCanvas.addEventListener("wheel", handleWheel, { passive: false });
  }

  function detach(): void {
    const targetCanvas = attachedCanvas;
    if (!targetCanvas) {
      return;
    }

    for (const pointerId of activePointerIds) {
      releasePointerCaptureIfHeld(targetCanvas, pointerId);
    }
    targetCanvas.removeEventListener("pointerdown", handlePointerDown);
    targetCanvas.removeEventListener("pointermove", handlePointerMove);
    targetCanvas.removeEventListener("pointerup", handlePointerUp);
    targetCanvas.removeEventListener("pointercancel", handlePointerCancel);
    targetCanvas.removeEventListener("lostpointercapture", handleLostPointerCapture);
    targetCanvas.removeEventListener("wheel", handleWheel);

    attachedCanvas = null;
    resetPointerGestureState(true);
  }

  return {
    attach,
    detach,
    resetState
  };
}
