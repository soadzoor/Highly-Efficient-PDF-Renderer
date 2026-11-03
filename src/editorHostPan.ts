import type { ReaderView } from "./readerViewport";

/** Drag displacement is in CSS pixels, independent of framebuffer resolution. */
export function panEditorReader(reader: {
  isActive(): boolean;
  getView(): ReaderView;
  setView(view: { centerX: number; centerY: number; zoom: number }): void;
  panByPixels?(dx: number, dy: number): void;
} | null | undefined, dx: number, dy: number): boolean {
  if (!reader?.isActive()) return false;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return true;
  if (reader.panByPixels) { reader.panByPixels(dx, dy); return true; }
  const view = reader.getView();
  if (!(view.zoom > 0)) return true;
  reader.setView({ centerX: view.centerX - dx / view.zoom, centerY: view.centerY + dy / view.zoom, zoom: view.zoom });
  return true;
}

/** Camera-plane displacement for a perspective view; no scene geometry changes. */
export function editorPerspectivePanDelta(matrix: ArrayLike<number>, distance: number, fov: number,
  zoom: number, height: number, dx: number, dy: number): readonly [number, number, number] {
  if (![distance, fov, zoom, height, dx, dy].every(Number.isFinite) || distance < 0 || zoom <= 0 || height <= 0) return [0, 0, 0];
  const scale = 2 * distance * Math.tan(fov * Math.PI / 360) / (zoom * height);
  const delta = [0, 1, 2].map(index => scale * (-dx * matrix[index] + dy * matrix[index + 4]));
  return delta.every(Number.isFinite) ? delta as [number, number, number] : [0, 0, 0];
}
