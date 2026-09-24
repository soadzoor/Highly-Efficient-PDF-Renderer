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
