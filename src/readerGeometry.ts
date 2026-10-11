/** Reader coordinates are Y-up, with the first page's top at zero. */
export const READER_PAGE_GAP = 16;
export const READER_MARGIN = 24;
export const READER_ACTUAL_SIZE_ZOOM = 96 / 72;

export interface ReaderCameraView { centerX: number; centerY: number; zoom: number }
export interface ReaderView extends ReaderCameraView { width: number; height: number }
export interface ReaderMetrics {
  minX: number; maxY: number; zoom: number; width: number; height: number;
  originX: number; originY: number; surfaceWidth: number; surfaceHeight: number;
}
export interface ReaderAnchor { pageIndex: number; x: number; y: number }

export function computeReaderPageRects(pages: readonly { width: number; height: number }[]): Float32Array {
  const rects = new Float32Array(pages.length * 4);
  let top = 0;
  pages.forEach((page, index) => {
    const width = Number.isFinite(page.width) ? Math.max(.001, Math.abs(page.width)) : 1;
    const height = Number.isFinite(page.height) ? Math.max(.001, Math.abs(page.height)) : 1;
    rects.set([-width / 2, top - height, width / 2, top], index * 4);
    top -= height + READER_PAGE_GAP;
  });
  return rects;
}

export function readerContentMetrics(rects: Float32Array, zoom: number, width: number, height: number): ReaderMetrics {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 3 < rects.length; i += 4) {
    minX = Math.min(minX, rects[i]); minY = Math.min(minY, rects[i + 1]);
    maxX = Math.max(maxX, rects[i + 2]); maxY = Math.max(maxY, rects[i + 3]);
  }
  if (!Number.isFinite(minX)) { minX = minY = 0; maxX = maxY = 1; }
  const contentWidth = (maxX - minX) * zoom, contentHeight = (maxY - minY) * zoom;
  return { minX, maxY, zoom, width, height,
    originX: Math.max(READER_MARGIN, (width - contentWidth) / 2),
    originY: Math.max(READER_MARGIN, (height - contentHeight) / 2),
    surfaceWidth: Math.max(width, contentWidth + READER_MARGIN * 2),
    surfaceHeight: Math.max(height, contentHeight + READER_MARGIN * 2) };
}

export function readerViewFromScroll(metrics: ReaderMetrics, left: number, top: number): ReaderView {
  return { centerX: metrics.minX + (left + metrics.width / 2 - metrics.originX) / metrics.zoom,
    centerY: metrics.maxY - (top + metrics.height / 2 - metrics.originY) / metrics.zoom,
    zoom: metrics.zoom, width: metrics.width, height: metrics.height };
}

export function readerScrollFromView(metrics: ReaderMetrics, view: ReaderCameraView): { left: number; top: number } {
  return { left: Math.max(0, Math.min(metrics.surfaceWidth - metrics.width,
    (view.centerX - metrics.minX) * metrics.zoom + metrics.originX - metrics.width / 2)),
    top: Math.max(0, Math.min(metrics.surfaceHeight - metrics.height,
      (metrics.maxY - view.centerY) * metrics.zoom + metrics.originY - metrics.height / 2)) };
}

export function readerPageAtPoint(rects: Float32Array, x: number, y: number): number {
  let nearest = 0, distance = Infinity;
  for (let i = 0; i + 3 < rects.length; i += 4) {
    const dx = Math.max(rects[i] - x, 0, x - rects[i + 2]);
    const dy = Math.max(rects[i + 1] - y, 0, y - rects[i + 3]);
    const next = dx * dx + dy * dy;
    if (next < distance) { distance = next; nearest = i / 4; }
  }
  return nearest;
}

export function readerCaptureAnchor(rects: Float32Array, view: ReaderCameraView): ReaderAnchor {
  const pageIndex = readerPageAtPoint(rects, view.centerX, view.centerY), i = pageIndex * 4;
  return { pageIndex, x: (view.centerX - rects[i]) / (rects[i + 2] - rects[i] || 1),
    y: (view.centerY - rects[i + 1]) / (rects[i + 3] - rects[i + 1] || 1) };
}

export function readerRestoreAnchor(rects: Float32Array, anchor: ReaderAnchor, zoom: number): ReaderCameraView {
  const i = Math.max(0, Math.min(rects.length / 4 - 1, anchor.pageIndex)) * 4;
  return { centerX: rects[i] + anchor.x * (rects[i + 2] - rects[i]),
    centerY: rects[i + 1] + anchor.y * (rects[i + 3] - rects[i + 1]), zoom };
}

export function readerFitZoom(rects: Float32Array, index: number, width: number, height: number,
  mode: "width" | "page"): number {
  const i = index * 4;
  const fitWidth = Math.max(1, width - READER_MARGIN * 2) / Math.max(.001, rects[i + 2] - rects[i]);
  return mode === "width" ? fitWidth : Math.min(fitWidth,
    Math.max(1, height - READER_MARGIN * 2) / Math.max(.001, rects[i + 3] - rects[i + 1]));
}

/** Keep the document point under a viewport pixel fixed while zoom changes. */
export function readerZoomAt(view: ReaderView, zoom: number, x: number, y: number): ReaderCameraView {
  return { centerX: view.centerX + (x - view.width / 2) * (1 / view.zoom - 1 / zoom),
    centerY: view.centerY - (y - view.height / 2) * (1 / view.zoom - 1 / zoom), zoom };
}
