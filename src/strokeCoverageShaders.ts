/**
 * Filter both sides of a stroke, including when its width is below one pixel.
 * A single signed-distance edge leaves a half-opaque line as width tends to
 * zero. Subtracting the opposite edge preserves the stroke's integrated ink
 * while retaining the existing filter for strokes wider than the AA radius.
 * Device hairlines supply their resolved half-pixel width at the call site.
 */
const coverageBody = `
  return smoothstep(-aaWorld, aaWorld, halfWidth - distanceValue)
    - smoothstep(-aaWorld, aaWorld, -halfWidth - distanceValue);
`;

export const STROKE_COVERAGE_GLSL = `
float heprStrokeCoverage(float distanceValue, float halfWidth, float aaWorld) {
${coverageBody}}
`;

export const STROKE_COVERAGE_WGSL = `
fn heprStrokeCoverage(distanceValue: f32, halfWidth: f32, aaWorld: f32) -> f32 {
${coverageBody}}
`;

/**
 * Runtime LOD line clusters encode their density as 1-density in primitiveType.
 * Apply it after coverage and paint alpha, matching repeated source-over at a
 * pixel. Canonical line/curve types return their original alpha unchanged.
 */
const densityBody = `
  if (primitiveType >= 0.0) { return alpha; }
  return 1.0 - pow(1.0 - clamp(alpha, 0.0, 1.0), max(1.0, 1.0 - primitiveType));
`;

export const STROKE_DENSITY_GLSL = `
float heprStrokeLodAlpha(float alpha, float primitiveType) {
${densityBody}}
`;

export const STROKE_DENSITY_WGSL = `
fn heprStrokeLodAlpha(alpha: f32, primitiveType: f32) -> f32 {
${densityBody}}
`;
