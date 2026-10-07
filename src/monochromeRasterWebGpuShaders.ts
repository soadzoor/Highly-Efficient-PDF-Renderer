/** Packed MSB-first image sampling with filtered coverage for minification. */
export const MONOCHROME_RASTER_WGSL = /* wgsl */ `
fn heprMonochromeBit(pixel : vec2i, size : vec2i) -> f32 {
  let p = clamp(pixel, vec2i(0), size - vec2i(1));
  // r8unorm preserves every byte; filtering is only used on the coverage texture.
  let packed = u32(round(textureLoad(uRasterTex, vec2i(p.x / 8, p.y), 0).r * 255.0));
  return f32((packed >> (7u - (u32(p.x) & 7u))) & 1u);
}

fn heprMonochromeBilinear(uv : vec2f, size : vec2i) -> f32 {
  let position = uv * vec2f(size) - vec2f(0.5);
  let pixel = vec2i(floor(position));
  let weight = fract(position);
  return mix(
    mix(heprMonochromeBit(pixel, size), heprMonochromeBit(pixel + vec2i(1, 0), size), weight.x),
    mix(heprMonochromeBit(pixel + vec2i(0, 1), size), heprMonochromeBit(pixel + vec2i(1, 1), size), weight.x),
    weight.y
  );
}

fn heprMonochromeColor(uv : vec2f, uvDx : vec2f, uvDy : vec2f) -> vec4f {
  let size = vec2i(i32(uRaster.matrixB.w), i32(textureDimensions(uRasterTex).y));
  let footprint = max(length(uvDx * vec2f(size)), length(uvDy * vec2f(size)));
  let lod = max(log2(max(footprint, 1.0)), 0.0);
  var coverage : f32;
  if (lod < 1.0) {
    let base = heprMonochromeBilinear(uv, size);
    let reduced = textureSampleLevel(uRasterCoverageTex, uRasterSampler, uv, 0.0).r;
    coverage = mix(base, reduced, lod);
  } else {
    coverage = textureSampleLevel(uRasterCoverageTex, uRasterSampler, uv, lod - 1.0).r;
  }
  return mix(uRaster.zeroColor, uRaster.oneColor, coverage);
}
`;
