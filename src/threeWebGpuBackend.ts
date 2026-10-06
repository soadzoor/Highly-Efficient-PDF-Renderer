// This module is loaded only for WebGPU objects. Constructors receive the module
// explicitly, so WebGL imports never initialize the optional node material graph.
export { createThreeWebGpuFillMaterial } from "./threeWebGpuFillMaterial";
export { createThreeWebGpuStrokeMaterial } from "./threeWebGpuStrokeMaterial";
export { createThreeWebGpuTextMaterial } from "./threeWebGpuTextMaterial";
export { createThreeWebGpuRasterMaterial } from "./threeWebGpuRasterMaterial";
export { createThreeWebGpuRasterStripMaterial } from "./threeWebGpuRasterStripMaterial";
export { createThreeWebGpuGradientFillMaterial, createThreeWebGpuGradientStrokeMaterial } from "./threeWebGpuGradientMaterial";
export { enableThreeNodePaintFold } from "./threeWebGpuPaintFold";
export { createThreeWebGpuPrimitiveHighlightMaterial } from "./threeWebGpuPrimitiveHighlightMaterial";
export { createThreeWebGpuPaintCompositorMaterials } from "./threeWebGpuPaintCompositorMaterials";
