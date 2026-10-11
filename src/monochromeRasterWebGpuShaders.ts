import { COMPACT_MONOCHROME_WGSL } from "./compactMonochromeShaders";
import { PACKED_COVERAGE_WGSL } from "./packedMonochromeCoverageShaders";

/** Packed MSB-first image sampling with filtered four-bit coverage for minification. */
export const MONOCHROME_RASTER_WGSL = /* wgsl */ `
${PACKED_COVERAGE_WGSL}
${COMPACT_MONOCHROME_WGSL}
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
  // A half-integer width marks compact data; a quarter marks nearest sampling.
  let fraction = fract(abs(uRaster.matrixB.w));
  let compact = fraction > 0.375;
  let nearest = fraction > 0.125 && fraction < 0.375;
  var size = vec2i(i32(abs(uRaster.matrixB.w)), i32(textureDimensions(uRasterTex).y));
  if (compact) { size = vec2i(i32(heprCompactWord(uRasterTex, 0u)), i32(heprCompactWord(uRasterTex, 1u))); }
  let footprint = max(length(uvDx * vec2f(size)), length(uvDy * vec2f(size)));
  let lod = max(log2(max(footprint, 1.0)), 0.0);
  var coverage : f32;
  if (nearest) {
    let pixel = clamp(vec2i(floor(uv * vec2f(size))), vec2i(0), size - vec2i(1));
    if (uRaster.matrixB.w < 0.0) { coverage = textureLoad(uRasterTex, pixel, 0).r; }
    else { coverage = heprMonochromeBit(pixel, size); }
  } else if (compact) {
    coverage = heprCompactSample(uRasterTex, size, uv, lod);
  } else if (lod < 1.0) {
    var base : f32;
    if (uRaster.matrixB.w < 0.0) {
      base = textureSampleLevel(uRasterTex, uRasterSampler, uv, 0.0).r;
    } else { base = heprMonochromeBilinear(uv, size); }
    let reduced = heprPackedCoverage(uRasterCoverageTex, size, uv, 0.0);
    coverage = mix(base, reduced, lod);
  } else {
    coverage = heprPackedCoverage(uRasterCoverageTex, size, uv, lod - 1.0);
  }
  return mix(uRaster.zeroColor, uRaster.oneColor, coverage);
}
`;
