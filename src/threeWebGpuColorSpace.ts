import { TSL } from "three/webgpu";

/** Alpha-compositing domain used by HEPR's custom three.js materials. */
export type ThreeColorCompositing = "linear" | "display";

// Three's usual NodeMaterial pipeline expects fragment colors in linear space
// and applies its configured output transform. Extracted PDF colors are
// display/sRGB values, so the default variant decodes them once before handing
// them to NodeMaterial.
const threeWebGpuLinearOutputColorFn: unknown = TSL.wgslFn(`
fn heprThreeOutputColor(color: vec3<f32>) -> vec3<f32> {
  let safeColor = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
  let lower = safeColor / 12.92;
  let higher = pow((safeColor + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
  return select(higher, lower, safeColor <= vec3<f32>(0.04045));
}
`);

// Native HEPR and the RawShaderMaterial WebGL path intentionally blend the
// extracted PDF display values directly in an unorm target. The comparison
// example uses this variant with a LinearSRGBColorSpace WebGPU host so all four
// paths composite in the same numeric domain.
const threeWebGpuDisplayOutputColorFn: unknown = TSL.wgslFn(`
fn heprThreeOutputColor(color: vec3<f32>) -> vec3<f32> {
  return clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
}
`);

/**
 * Build and cache both color-compositing variants of a WGSL fragment helper.
 *
 * Each variant includes exactly one implementation of `heprThreeOutputColor`,
 * so display compositing has no transfer-function branch or `pow` in its
 * generated shader.
 */
export function createThreeWebGpuOutputFragmentFns(
  source: string,
  dependencies: readonly unknown[] = []
): Readonly<Record<ThreeColorCompositing, unknown>> {
  const create = (outputColorFn: unknown): unknown =>
    TSL.wgslFn(source, [outputColorFn, ...dependencies] as never);
  return {
    linear: create(threeWebGpuLinearOutputColorFn),
    display: create(threeWebGpuDisplayOutputColorFn)
  };
}
