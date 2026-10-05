import { RASTER_CLIP_GLSL } from "./rasterClipShaders";

export const RASTER_ATLAS_VERTEX_GLSL = `#version 300 es
precision highp float;

layout(location = 0) in vec4 aRasterMatrixABCD;
layout(location = 1) in vec4 aRasterEFOpacity;
layout(location = 2) in vec4 aRasterAtlasRect;
uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;
out vec2 vUv;
out vec2 vWorld;
flat out vec4 vAtlasRect;
flat out float vOpacity;

void main() {
  vec2 uv = vec2(float(gl_VertexID & 1), float(1 - (gl_VertexID >> 1)));
  vec2 world = vec2(
    aRasterMatrixABCD.x * uv.x + aRasterMatrixABCD.z * uv.y + aRasterEFOpacity.x,
    aRasterMatrixABCD.y * uv.x + aRasterMatrixABCD.w * uv.y + aRasterEFOpacity.y
  );
  if (uUseLocalToClip >= 0.5) gl_Position = uLocalToClip * vec4(world, 0.0, 1.0);
  else {
    vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
    gl_Position = vec4(screen / (0.5 * uViewport) - 1.0, 0.0, 1.0);
  }
  vUv = uv; vWorld = world; vAtlasRect = aRasterAtlasRect; vOpacity = aRasterEFOpacity.z;
}
`;

export const RASTER_ATLAS_FRAGMENT_GLSL = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uRasterAtlasTex;
uniform vec2 uRasterAtlasSize;
uniform float uPdfShapeOnly;
in vec2 vUv;
in vec2 vWorld;
flat in vec4 vAtlasRect;
flat in float vOpacity;
out vec4 outColor;

${RASTER_CLIP_GLSL}

vec4 sampleImageLevel(float level) {
  vec2 size = vAtlasRect.zw;
  float offset = 0.0;
  for (int step = 0; step < 10; step++) {
    if (float(step) >= level) break;
    offset += size.x;
    size = max(vec2(1.0), floor(size * 0.5));
  }
  // Clamp to the texel centres of this image and this mip level. Linear
  // filtering cannot reach neighbouring images or their other mip levels.
  vec2 pixel = vAtlasRect.xy + vec2(offset, 0.0) + clamp(vUv * size, vec2(0.5), size - 0.5);
  return textureLod(uRasterAtlasTex, pixel / uRasterAtlasSize, 0.0);
}

void main() {
  float clipAAWidth = max(max(length(vec2(dFdx(vWorld.x), dFdy(vWorld.x))),
    length(vec2(dFdx(vWorld.y), dFdy(vWorld.y)))), 1e-4);
  vec2 sourcePixels = vUv * vAtlasRect.zw;
  float footprint = max(length(dFdx(sourcePixels)), length(dFdy(sourcePixels)));
  float maxLevel = floor(log2(max(vAtlasRect.z, vAtlasRect.w)));
  float lod = clamp(log2(max(footprint, 1.0)), 0.0, maxLevel);
  vec4 color = mix(sampleImageLevel(floor(lod)), sampleImageLevel(ceil(lod)), fract(lod)) * mix(vOpacity, 1.0, uPdfShapeOnly);
  if (color.a <= 0.001) discard;
  outColor = color * heprVectorClipAA(vWorld, clipAAWidth);
}
`;
