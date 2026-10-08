import type { RasterLayer, VectorScene } from "./pdfVectorExtractor";
import { monochromeCoverageTilePixels } from "./monochromeRaster";
import { planRasterTiles, rasterTilePixels } from "./rasterTiles";

/** Compact raster-only page previews; the worker never transfers full-size decoded images. */
export function buildRasterScenePreview(scene: VectorScene, maximumDimension: number): VectorScene {
  const layers = scene.rasterLayers.map(layer => {
    const scale = Math.min(1, maximumDimension / Math.max(layer.width, layer.height));
    const width = Math.max(1, Math.floor(layer.width * scale)), height = Math.max(1, Math.floor(layer.height * scale));
    const plan = planRasterTiles(width, height, maximumDimension);
    let data: Uint8Array;
    if (layer.monochrome) {
      const coverage = monochromeCoverageTilePixels(layer.monochrome, layer.width, layer.height, plan)[0];
      const colors = layer.monochrome.colors;
      data = new Uint8Array(width * height * 4);
      for (let pixel = 0; pixel < coverage.length; pixel++) {
        const t = coverage[pixel] / 255, a0 = colors[3] * (1 - t), a1 = colors[7] * t, alpha = a0 + a1;
        for (let channel = 0; channel < 3; channel++) data[pixel * 4 + channel] = alpha > 0
          ? Math.round((colors[channel] * a0 + colors[channel + 4] * a1) / alpha) : 0;
        data[pixel * 4 + 3] = Math.round(alpha);
      }
    } else {
      data = rasterTilePixels(layer, plan)[0];
      // Scene pixels are straight-alpha; tile preparation produces premultiplied bytes.
      for (let pixel = 0; pixel < data.length; pixel += 4) {
        const alpha = data[pixel + 3];
        if (alpha > 0 && alpha < 255) for (let channel = 0; channel < 3; channel++) {
          data[pixel + channel] = Math.min(255, Math.round(data[pixel + channel] * 255 / alpha));
        }
      }
    }
    const descriptors = Object.getOwnPropertyDescriptors(layer);
    delete descriptors.monochrome;
    descriptors.width = { enumerable: true, configurable: true, writable: true, value: width };
    descriptors.height = { enumerable: true, configurable: true, writable: true, value: height };
    descriptors.data = { enumerable: true, configurable: true, writable: true, value: data };
    return Object.defineProperties({}, descriptors) as RasterLayer;
  });
  const descriptors = Object.getOwnPropertyDescriptors(scene);
  const values = { rasterLayers: layers, rasterLayerWidth: layers[0]?.width ?? 0,
    rasterLayerHeight: layers[0]?.height ?? 0, rasterLayerData: layers[0]?.data ?? new Uint8Array(0) };
  for (const [key, value] of Object.entries(values)) descriptors[key] = { enumerable: true, configurable: true, writable: true, value };
  return Object.defineProperties({}, descriptors) as VectorScene;
}

/** Count owned payloads without evaluating lazy pixel getters or counting shared buffers twice. */
export function sceneCpuBytes(scene: VectorScene): number {
  const buffers = new Set<ArrayBufferLike>(), visited = new Set<object>();
  let bytes = 0;
  const visit = (value: unknown): void => {
    if (typeof value === "string") { bytes += value.length * 2; return; }
    if (value === null || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (ArrayBuffer.isView(value)) { buffers.add(value.buffer); return; }
    if (value instanceof ArrayBuffer) { buffers.add(value); return; }
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if ("value" in descriptor) visit(descriptor.value);
    }
  };
  visit(scene);
  for (const buffer of buffers) bytes += buffer.byteLength;
  return bytes;
}
