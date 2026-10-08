/** Coverage atlas addressing and filtering are shared by native and Three materials. */
export const PACKED_COVERAGE_GLSL = /* glsl */ `
float heprCoverageTexel(sampler2D image, ivec2 size, int offset, ivec2 pixel) {
  ivec2 p = clamp(pixel, ivec2(0), size - 1);
  int index = offset + p.y * ((size.x + 1) / 2) + p.x / 2;
  int atlasWidth = textureSize(image, 0).x;
  uint packed = uint(round(texelFetch(image, ivec2(index % atlasWidth, index / atlasWidth), 0).r * 255.0));
  return float((packed >> uint((p.x & 1) == 0 ? 4 : 0)) & 15u) / 15.0;
}

float heprCoverageBilinear(sampler2D image, ivec2 size, int offset, vec2 uv) {
  vec2 position = uv * vec2(size) - 0.5;
  ivec2 pixel = ivec2(floor(position));
  vec2 weight = fract(position);
  return mix(mix(heprCoverageTexel(image, size, offset, pixel),
    heprCoverageTexel(image, size, offset, pixel + ivec2(1, 0)), weight.x),
    mix(heprCoverageTexel(image, size, offset, pixel + ivec2(0, 1)),
    heprCoverageTexel(image, size, offset, pixel + ivec2(1, 1)), weight.x), weight.y);
}

float heprPackedCoverage(sampler2D image, ivec2 baseSize, vec2 uv, float lod) {
  float level = clamp(lod, 0.0, max(0.0, floor(log2(float(max(baseSize.x, baseSize.y)))) - 1.0));
  int target = int(floor(level));
  ivec2 size = max(ivec2(1), baseSize / 2);
  int offset = 0;
  for (int i = 0; i < 32; i++) {
    if (i == target) {
      float first = heprCoverageBilinear(image, size, offset, uv);
      float fraction = fract(level);
      if (fraction == 0.0) return first;
      offset += ((size.x + 1) / 2) * size.y;
      size = max(ivec2(1), size / 2);
      return mix(first, heprCoverageBilinear(image, size, offset, uv), fraction);
    }
    offset += ((size.x + 1) / 2) * size.y;
    size = max(ivec2(1), size / 2);
  }
  return 0.0;
}
`;

export const PACKED_COVERAGE_TEXEL_WGSL = /* wgsl */ `
fn heprCoverageTexel(image: texture_2d<f32>, size: vec2i, offset: i32, pixel: vec2i) -> f32 {
  let p = clamp(pixel, vec2i(0), size - vec2i(1));
  let index = offset + p.y * ((size.x + 1) / 2) + p.x / 2;
  let atlasWidth = i32(textureDimensions(image).x);
  let packed = u32(round(textureLoad(image, vec2i(index % atlasWidth, index / atlasWidth), 0).r * 255.0));
  let shift = select(0u, 4u, (u32(p.x) & 1u) == 0u);
  return f32((packed >> shift) & 15u) / 15.0;
}`;

export const PACKED_COVERAGE_BILINEAR_WGSL = /* wgsl */ `
fn heprCoverageBilinear(image: texture_2d<f32>, size: vec2i, offset: i32, uv: vec2f) -> f32 {
  let position = uv * vec2f(size) - vec2f(0.5);
  let pixel = vec2i(floor(position));
  let weight = fract(position);
  return mix(mix(heprCoverageTexel(image, size, offset, pixel),
    heprCoverageTexel(image, size, offset, pixel + vec2i(1, 0)), weight.x),
    mix(heprCoverageTexel(image, size, offset, pixel + vec2i(0, 1)),
    heprCoverageTexel(image, size, offset, pixel + vec2i(1, 1)), weight.x), weight.y);
}`;

export const PACKED_COVERAGE_TRILINEAR_WGSL = /* wgsl */ `
fn heprPackedCoverage(image: texture_2d<f32>, baseSize: vec2i, uv: vec2f, lod: f32) -> f32 {
  let level = clamp(lod, 0.0, max(0.0, floor(log2(f32(max(baseSize.x, baseSize.y)))) - 1.0));
  let target = i32(floor(level));
  var size = max(vec2i(1), baseSize / vec2i(2));
  var offset = 0;
  for (var i = 0; i < 32; i++) {
    if (i == target) {
      let first = heprCoverageBilinear(image, size, offset, uv);
      let fraction = fract(level);
      if (fraction == 0.0) { return first; }
      offset += ((size.x + 1) / 2) * size.y;
      size = max(vec2i(1), size / vec2i(2));
      return mix(first, heprCoverageBilinear(image, size, offset, uv), fraction);
    }
    offset += ((size.x + 1) / 2) * size.y;
    size = max(vec2i(1), size / vec2i(2));
  }
  return 0.0;
}`;

export const PACKED_COVERAGE_WGSL = PACKED_COVERAGE_TEXEL_WGSL +
  PACKED_COVERAGE_BILINEAR_WGSL + PACKED_COVERAGE_TRILINEAR_WGSL;
