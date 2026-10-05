import type { RasterLayer, VectorScene } from "./pdfVectorExtractor";

export interface PreparedRasterLayerUpdates { commit(): void; dispose(): void }

/** Images larger than one GPU texture are valid: renderers upload them as tiles. */
export function validateRasterLayerUpdates(scene: VectorScene, updates: ReadonlyMap<number, RasterLayer>): void {
  for (const [index, layer] of updates) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= scene.rasterLayers.length ||
      !Number.isSafeInteger(layer.width) || !Number.isSafeInteger(layer.height) || layer.width < 1 || layer.height < 1 ||
      !Number.isSafeInteger(layer.width * layer.height * 4) ||
      (layer.opacity !== undefined && (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1)) ||
      layer.data.length !== layer.width * layer.height * 4 || layer.matrix.length !== 6 || !layer.matrix.every(Number.isFinite)) {
      throw new RangeError("Invalid raster replacement.");
    }
  }
}
