/** Loaded explicitly by the async object factory when WebGPU is selected. */
export type ThreeWebGpuBackend = typeof import("./threeWebGpuBackend");

export function requireThreeWebGpuBackend(backend?: ThreeWebGpuBackend): ThreeWebGpuBackend {
  if (!backend) throw new Error("The WebGPU material backend must be supplied by the async PDF object factory.");
  return backend;
}
