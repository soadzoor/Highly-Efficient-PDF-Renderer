import type { RendererApi } from "./rendererTypes";
import type { RoomDetectionResult } from "./roomDetector";

export type RoomOverlayMode = "rooms" | "walls" | "closures" | "contours" | "off";

export interface RoomOverlayHandle {
  setResult(result: RoomDetectionResult | null): void;
  setMode(mode: RoomOverlayMode): void;
  getMode(): RoomOverlayMode;
  redraw(): void;
  syncSize(): void;
}

interface RoomOverlayOptions {
  overlayCanvas: HTMLCanvasElement;
  getRenderer: () => RendererApi;
}

/**
 * Canvas2D overlay that draws room-detection results (room polygons with labels, plus
 * wall/closure/contour debug modes) over the render canvas, following the presented
 * camera state of the active renderer.
 */
export function createRoomOverlay(options: RoomOverlayOptions): RoomOverlayHandle {
  const { overlayCanvas, getRenderer } = options;
  const context = overlayCanvas.getContext("2d");

  let result: RoomDetectionResult | null = null;
  let mode: RoomOverlayMode = "rooms";
  let lastDrawnFrameSerial = -1;
  let needsRedraw = true;

  function syncSize(): void {
    const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(overlayCanvas.clientWidth * devicePixelRatio));
    const height = Math.max(1, Math.round(overlayCanvas.clientHeight * devicePixelRatio));
    if (overlayCanvas.width !== width || overlayCanvas.height !== height) {
      overlayCanvas.width = width;
      overlayCanvas.height = height;
      needsRedraw = true;
    }
  }

  function redraw(): void {
    if (!context) {
      return;
    }
    if (!result || mode === "off") {
      if (needsRedraw) {
        context.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        needsRedraw = false;
      }
      return;
    }

    const renderer = getRenderer();
    const frameSerial = renderer.getPresentedFrameSerial?.() ?? -1;
    if (!needsRedraw && frameSerial === lastDrawnFrameSerial) {
      return;
    }
    lastDrawnFrameSerial = frameSerial;
    needsRedraw = false;

    const view = renderer.getPresentedViewState?.() ?? renderer.getViewState();
    const width = overlayCanvas.width;
    const height = overlayCanvas.height;
    const zoom = view.zoom;
    const toX = (wx: number): number => (wx - view.cameraCenterX) * zoom + width * 0.5;
    const toY = (wy: number): number => height * 0.5 - (wy - view.cameraCenterY) * zoom;

    context.clearRect(0, 0, width, height);
    const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);

    if (mode === "rooms") {
      drawRooms(context, result, toX, toY, width, height, devicePixelRatio);
      return;
    }

    const debug = result.debug;
    if (!debug) {
      return;
    }
    if (mode === "walls") {
      drawSegments(context, debug.wallSegments, toX, toY, "rgba(205, 35, 35, 0.85)", 1.5 * devicePixelRatio, null);
    } else if (mode === "closures") {
      drawSegments(context, debug.wallSegments, toX, toY, "rgba(205, 35, 35, 0.25)", devicePixelRatio, null);
      drawSegments(context, debug.virtualClosures, toX, toY, "rgba(25, 70, 255, 0.9)", 2 * devicePixelRatio, [6 * devicePixelRatio, 4 * devicePixelRatio]);
    } else if (mode === "contours") {
      context.strokeStyle = "rgba(20, 150, 60, 0.9)";
      context.lineWidth = 1.5 * devicePixelRatio;
      context.setLineDash([]);
      for (const contour of debug.rawContours) {
        if (contour.length < 6) {
          continue;
        }
        context.beginPath();
        context.moveTo(toX(contour[0]), toY(contour[1]));
        for (let i = 2; i + 1 < contour.length; i += 2) {
          context.lineTo(toX(contour[i]), toY(contour[i + 1]));
        }
        context.closePath();
        context.stroke();
      }
    }
  }

  return {
    setResult(nextResult) {
      result = nextResult;
      needsRedraw = true;
      redraw();
    },
    setMode(nextMode) {
      mode = nextMode;
      needsRedraw = true;
      redraw();
    },
    getMode() {
      return mode;
    },
    redraw,
    syncSize
  };
}

function drawRooms(
  context: CanvasRenderingContext2D,
  result: RoomDetectionResult,
  toX: (wx: number) => number,
  toY: (wy: number) => number,
  width: number,
  height: number,
  devicePixelRatio: number
): void {
  context.setLineDash([]);
  context.font = `${Math.round(12 * devicePixelRatio)}px "IBM Plex Sans", "Segoe UI", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";

  for (const [index, room] of result.rooms.entries()) {
    const polygon = room.polygon;
    if (polygon.length < 6) {
      continue;
    }

    // Skip rooms entirely outside the viewport.
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i + 1 < polygon.length; i += 2) {
      const x = toX(polygon[i]);
      const y = toY(polygon[i + 1]);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    if (maxX < 0 || maxY < 0 || minX > width || minY > height) {
      continue;
    }

    const hue = (index * 47) % 360;
    context.beginPath();
    context.moveTo(toX(polygon[0]), toY(polygon[1]));
    for (let i = 2; i + 1 < polygon.length; i += 2) {
      context.lineTo(toX(polygon[i]), toY(polygon[i + 1]));
    }
    context.closePath();
    context.fillStyle = `hsla(${hue}, 70%, 55%, 0.25)`;
    context.fill();
    context.strokeStyle = `hsla(${hue}, 70%, 45%, 0.9)`;
    context.lineWidth = 2 * devicePixelRatio;
    context.stroke();

    if (room.labelText.length > 0 && maxX - minX > 40 * devicePixelRatio) {
      const labelX = toX(room.labelX);
      const labelY = toY(room.labelY);
      const lines = room.labelText.split("\n").slice(0, 4);
      const lineHeight = 14 * devicePixelRatio;
      context.lineWidth = 3 * devicePixelRatio;
      context.strokeStyle = "rgba(255, 255, 255, 0.85)";
      context.fillStyle = `hsl(${hue}, 75%, 30%)`;
      for (const [lineIndex, line] of lines.entries()) {
        const y = labelY + (lineIndex - (lines.length - 1) / 2) * lineHeight;
        context.strokeText(line, labelX, y);
        context.fillText(line, labelX, y);
      }
    }
  }
}

function drawSegments(
  context: CanvasRenderingContext2D,
  segments: Float32Array,
  toX: (wx: number) => number,
  toY: (wy: number) => number,
  style: string,
  lineWidth: number,
  dash: number[] | null
): void {
  context.strokeStyle = style;
  context.lineWidth = lineWidth;
  context.setLineDash(dash ?? []);
  context.beginPath();
  for (let i = 0; i + 3 < segments.length; i += 4) {
    context.moveTo(toX(segments[i]), toY(segments[i + 1]));
    context.lineTo(toX(segments[i + 2]), toY(segments[i + 3]));
  }
  context.stroke();
  context.setLineDash([]);
}
