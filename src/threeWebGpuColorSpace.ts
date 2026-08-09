import { TSL } from "three/webgpu";

// Three's NodeMaterial pipeline expects fragment colors in linear space and
// applies its configured output transform. Extracted PDF colors are already
// display/sRGB values, so decode them once before handing them to NodeMaterial.
// Keep this typed as unknown to avoid instantiating TSL's deeply recursive
// proxy types in consumers.
export const threeWebGpuOutputSrgbToLinearFn: unknown = TSL.wgslFn(`
fn heprThreeOutputSrgbToLinear(color: vec3<f32>) -> vec3<f32> {
  let safeColor = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
  let lower = safeColor / 12.92;
  let higher = pow((safeColor + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
  return select(higher, lower, safeColor <= vec3<f32>(0.04045));
}
`);
