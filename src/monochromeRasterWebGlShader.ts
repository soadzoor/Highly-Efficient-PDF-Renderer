/** Packed binary base texels, with ordinary coverage mips for readable minification. */
export function monochromeRasterFragmentGlsl(source: string): string {
  return source.replace("precision highp float;", "precision highp float;\nprecision highp int;")
    .replace("uniform sampler2D uRasterTex;", `uniform sampler2D uRasterTex;
uniform sampler2D uRasterMonoMips;
uniform float uRasterMonochrome;
uniform vec2 uRasterMonoSize;
uniform vec4 uRasterMonoColor0;
uniform vec4 uRasterMonoColor1;

float heprRasterBit(ivec2 pixel) {
  pixel = clamp(pixel, ivec2(0), ivec2(uRasterMonoSize) - 1);
  uint packed = uint(round(texelFetch(uRasterTex, ivec2(pixel.x >> 3, pixel.y), 0).r * 255.0));
  return float((packed >> uint(7 - (pixel.x & 7))) & 1u);
}

float heprRasterBinaryLinear(vec2 uv) {
  vec2 pixel = uv * uRasterMonoSize - 0.5;
  ivec2 corner = ivec2(floor(pixel));
  vec2 weight = fract(pixel);
  return mix(mix(heprRasterBit(corner), heprRasterBit(corner + ivec2(1, 0)), weight.x),
    mix(heprRasterBit(corner + ivec2(0, 1)), heprRasterBit(corner + ivec2(1, 1)), weight.x), weight.y);
}

vec4 heprRasterColor(vec2 uv, vec2 uvDx, vec2 uvDy) {
  if (uRasterMonochrome < 0.5) return textureGrad(uRasterTex, uv, uvDx, uvDy);
  float footprint = max(length(uvDx * uRasterMonoSize), length(uvDy * uRasterMonoSize));
  float lod = max(0.0, log2(max(footprint, 1.0)));
  float coverage;
  if (lod < 1.0) {
    float base = heprRasterBinaryLinear(uv);
    coverage = mix(base, textureLod(uRasterMonoMips, uv, 0.0).r, lod);
  } else {
    coverage = textureLod(uRasterMonoMips, uv, lod - 1.0).r;
  }
  return mix(uRasterMonoColor0, uRasterMonoColor1, coverage);
}`)
    // Derivatives are measured before either sampling branch or a clip discard.
    .replace("texture(uRasterTex, vUv)", "heprRasterColor(vUv, dFdx(vUv), dFdy(vUv))");
}
