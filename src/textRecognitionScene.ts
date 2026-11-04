import type { RasterLayer, VectorScene } from "./pdfVectorExtractor";

/** OCR samples original scan pixels rather than viewing-only compressed derivatives. */
export function canonicalTextRecognitionScene(scene: VectorScene): VectorScene {
  if (!scene.rasterLayers.some(layer => layer.gpuCompression || layer.gpuPreparation || layer.compressionHint)) return scene;
  const canonical = Object.defineProperties({}, Object.getOwnPropertyDescriptors(scene)) as VectorScene;
  canonical.rasterLayers = scene.rasterLayers.map(layer => {
    if (!layer.gpuCompression && !layer.gpuPreparation && !layer.compressionHint) return layer;
    const descriptors = Object.getOwnPropertyDescriptors(layer);
    for (const key of ["gpuCompression", "gpuPreparation", "compressionHint"] as const) {
      descriptors[key] = { value: undefined, writable: true, enumerable: true, configurable: true };
    }
    return Object.defineProperties({}, descriptors) as RasterLayer;
  });
  return canonical;
}
