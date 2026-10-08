export const COMPACT_WORD_WGSL = /* wgsl */ `
fn heprCompactWord(image: texture_2d<f32>, offset: u32) -> u32 {
  let width = textureDimensions(image).x;
  let bytes = vec4u(round(textureLoad(image, vec2i(i32(offset % width), i32(offset / width)), 0) * 255.0));
  return bytes.r | (bytes.g << 8u) | (bytes.b << 16u) | (bytes.a << 24u);
}`;
export const COMPACT_BLOCK_WGSL = /* wgsl */ `
fn heprCompactBlock(image: texture_2d<f32>, entry: u32, pixel: vec2u, bits: u32) -> f32 {
  if ((entry & 0x80000000u) != 0u) { return f32(entry & 255u); }
  let bit = ((pixel.y & 31u) * 32u + (pixel.x & 31u)) * bits;
  return f32((heprCompactWord(image, entry + bit / 32u) >> (bit & 31u)) & ((1u << bits) - 1u));
}`;
export const COMPACT_TEXEL_WGSL = /* wgsl */ `
fn heprCompactTexel(image: texture_2d<f32>, size: vec2i, level: u32, pixel: vec2i) -> f32 {
  let p = vec2u(clamp(pixel, vec2i(0), size - vec2i(1)));
  let bits = select(4u, heprCompactWord(image, 4u), level == 0u);
  let map = heprCompactWord(image, 5u + level);
  let entry = heprCompactWord(image, map + (p.y / 32u) * ((u32(size.x) + 31u) / 32u) + p.x / 32u);
  if ((entry & 0xc0000000u) != 0x40000000u) {
    return heprCompactBlock(image, entry, p, bits) / f32((1u << bits) - 1u);
  }
  let list = entry & 0x3fffffffu;
  var value = heprCompactBlock(image, heprCompactWord(image, list), p, 1u);
  let count = heprCompactWord(image, list + 1u);
  for (var i = 0u; i < 8u; i++) {
    if (i >= count) { break; }
    let record = list + 2u + 3u * i;
    let glyph = heprCompactWord(image, record);
    let origin = vec2i(bitcast<i32>(heprCompactWord(image, record + 1u)), bitcast<i32>(heprCompactWord(image, record + 2u)));
    let local = vec2i(p) - origin;
    let glyphSize = vec2i(i32(heprCompactWord(image, glyph)), i32(heprCompactWord(image, glyph + 1u)));
    if (all(local >= vec2i(0)) && all(local < glyphSize)) {
      let byte = u32(local.y) * ((u32(glyphSize.x) + 7u) / 8u) + u32(local.x) / 8u;
      let word = heprCompactWord(image, glyph + 2u + byte / 4u);
      let ink = (word >> ((byte & 3u) * 8u + 7u - (u32(local.x) & 7u))) & 1u;
      value = min(value, 1.0 - f32(ink));
    }
  }
  return value;
}`;
export const COMPACT_BILINEAR_WGSL = /* wgsl */ `
fn heprCompactBilinear(image: texture_2d<f32>, size: vec2i, level: u32, uv: vec2f) -> f32 {
  let position = uv * vec2f(size) - vec2f(0.5);
  let pixel = vec2i(floor(position)); let weight = fract(position);
  return mix(mix(heprCompactTexel(image, size, level, pixel), heprCompactTexel(image, size, level, pixel + vec2i(1,0)), weight.x),
    mix(heprCompactTexel(image, size, level, pixel + vec2i(0,1)), heprCompactTexel(image, size, level, pixel + vec2i(1,1)), weight.x), weight.y);
}`;
export const COMPACT_SAMPLE_WGSL = /* wgsl */ `
fn heprCompactSample(image: texture_2d<f32>, baseSize: vec2i, uv: vec2f, lod: f32) -> f32 {
  let bounded = clamp(lod, 0.0, f32(heprCompactWord(image, 2u) - 1u));
  let level = u32(floor(bounded)); var size = baseSize;
  for (var i = 0u; i < 32u; i++) { if (i >= level) { break; } size = max(size / 2, vec2i(1)); }
  let first = heprCompactBilinear(image, size, level, uv);
  let next = min(level + 1u, heprCompactWord(image, 2u) - 1u);
  return mix(first, heprCompactBilinear(image, max(size / 2, vec2i(1)), next, uv), fract(bounded));
}`;
export const COMPACT_MONOCHROME_WGSL = [COMPACT_WORD_WGSL, COMPACT_BLOCK_WGSL, COMPACT_TEXEL_WGSL,
  COMPACT_BILINEAR_WGSL, COMPACT_SAMPLE_WGSL].join("\n");

export const COMPACT_MONOCHROME_GLSL = /* glsl */ `
uint heprCompactWord(sampler2D image, uint offset) {
  uint width = uint(textureSize(image, 0).x);
  uvec4 bytes = uvec4(round(texelFetch(image, ivec2(offset % width, offset / width), 0) * 255.0));
  return bytes.r | (bytes.g << 8u) | (bytes.b << 16u) | (bytes.a << 24u);
}
float heprCompactBlock(sampler2D image, uint entry, uvec2 pixel, uint bits) {
  if ((entry & 0x80000000u) != 0u) return float(entry & 255u);
  uint bit = ((pixel.y & 31u) * 32u + (pixel.x & 31u)) * bits;
  return float((heprCompactWord(image, entry + bit / 32u) >> (bit & 31u)) & ((1u << bits) - 1u));
}
float heprCompactTexel(sampler2D image, ivec2 size, uint level, ivec2 pixel) {
  uvec2 p = uvec2(clamp(pixel, ivec2(0), size - 1));
  uint bits = level == 0u ? heprCompactWord(image, 4u) : 4u;
  uint map = heprCompactWord(image, 5u + level);
  uint entry = heprCompactWord(image, map + (p.y / 32u) * ((uint(size.x) + 31u) / 32u) + p.x / 32u);
  float value = 0.0;
  if ((entry & 0xc0000000u) != 0x40000000u) {
    value = heprCompactBlock(image, entry, p, bits) / float((1u << bits) - 1u);
  } else {
    uint list = entry & 0x3fffffffu;
    value = heprCompactBlock(image, heprCompactWord(image, list), p, 1u);
    uint count = heprCompactWord(image, list + 1u);
    for (uint i = 0u; i < 8u; i++) {
      if (i >= count) break;
      uint record = list + 2u + 3u * i;
      uint glyph = heprCompactWord(image, record);
      ivec2 local = ivec2(p) - ivec2(int(heprCompactWord(image, record + 1u)), int(heprCompactWord(image, record + 2u)));
      ivec2 glyphSize = ivec2(heprCompactWord(image, glyph), heprCompactWord(image, glyph + 1u));
      if (all(greaterThanEqual(local, ivec2(0))) && all(lessThan(local, glyphSize))) {
        uint byteOffset = uint(local.y) * ((uint(glyphSize.x) + 7u) / 8u) + uint(local.x) / 8u;
        uint word = heprCompactWord(image, glyph + 2u + byteOffset / 4u);
        uint ink = (word >> ((byteOffset & 3u) * 8u + 7u - (uint(local.x) & 7u))) & 1u;
        value = min(value, 1.0 - float(ink));
      }
    }
  }
  return value;
}
float heprCompactBilinear(sampler2D image, ivec2 size, uint level, vec2 uv) {
  vec2 position = uv * vec2(size) - 0.5;
  ivec2 pixel = ivec2(floor(position)); vec2 weight = fract(position);
  return mix(mix(heprCompactTexel(image, size, level, pixel), heprCompactTexel(image, size, level, pixel + ivec2(1,0)), weight.x),
    mix(heprCompactTexel(image, size, level, pixel + ivec2(0,1)), heprCompactTexel(image, size, level, pixel + ivec2(1,1)), weight.x), weight.y);
}
float heprCompactSample(sampler2D image, ivec2 baseSize, vec2 uv, float lod) {
  float bounded = clamp(lod, 0.0, float(heprCompactWord(image, 2u) - 1u));
  uint level = uint(floor(bounded)); ivec2 size = baseSize;
  for (uint i = 0u; i < 32u; i++) { if (i >= level) break; size = max(size / 2, ivec2(1)); }
  float first = heprCompactBilinear(image, size, level, uv);
  uint next = min(level + 1u, heprCompactWord(image, 2u) - 1u);
  return mix(first, heprCompactBilinear(image, max(size / 2, ivec2(1)), next, uv), fract(bounded));
}`;
