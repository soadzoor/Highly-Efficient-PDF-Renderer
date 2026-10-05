import { RASTER_CLIP_GLSL } from "./rasterClipShaders";

export const RASTER_STRIP_VERTEX_GLSL = `#version 300 es
precision highp float;

layout(location = 0) in vec4 aRasterMatrixABCD;
layout(location = 1) in vec4 aRasterMatrixEFWidthOpacity;
uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;
out vec2 vUv;
out vec2 vWorld;
flat out float vWidth;
flat out float vOpacity;
flat out float vRow;

void main() {
  vec2 uv = vec2(float(gl_VertexID & 1), float(1 - (gl_VertexID >> 1)));
  vec2 world = vec2(
    aRasterMatrixABCD.x * uv.x + aRasterMatrixABCD.z * uv.y + aRasterMatrixEFWidthOpacity.x,
    aRasterMatrixABCD.y * uv.x + aRasterMatrixABCD.w * uv.y + aRasterMatrixEFWidthOpacity.y
  );
  if (uUseLocalToClip >= 0.5) {
    gl_Position = uLocalToClip * vec4(world, 0.0, 1.0);
  } else {
    vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
    gl_Position = vec4(screen / (0.5 * uViewport) - 1.0, 0.0, 1.0);
  }
  vUv = uv;
  vWorld = world;
  vWidth = aRasterMatrixEFWidthOpacity.z;
  vOpacity = aRasterMatrixEFWidthOpacity.w;
  vRow = float(gl_InstanceID);
}
`;

export const RASTER_STRIP_FRAGMENT_GLSL = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uRasterStripTex;
uniform vec2 uRasterStripSize;
in vec2 vUv;
in vec2 vWorld;
flat in float vWidth;
flat in float vOpacity;
flat in float vRow;
out vec4 outColor;

${RASTER_CLIP_GLSL}

vec4 sampleStripLevel(float level) {
  float offset = 0.0;
  float width = vWidth;
  // Each row holds this image's independent mip chain, capped at 1024 pixels.
  for (int step = 0; step < 10; step++) {
    if (float(step) >= level) break;
    offset += width;
    width = max(1.0, floor(width * 0.5));
  }
  vec2 texel = vec2(offset + clamp(vUv.x * width, 0.5, width - 0.5), vRow + 0.5);
  return textureLod(uRasterStripTex, texel / uRasterStripSize, 0.0);
}

void main() {
  // Polygon clip AA is measured before discard; rectangular tile clips stay solid.
  float clipAAWidth = max(max(length(vec2(dFdx(vWorld.x), dFdy(vWorld.x))),
    length(vec2(dFdx(vWorld.y), dFdy(vWorld.y)))), 1e-4);
  vec2 sourcePixels = vUv * vec2(vWidth, 1.0);
  float footprint = max(length(dFdx(sourcePixels)), length(dFdy(sourcePixels)));
  int remaining = int(vWidth);
  int maxLevel = 0;
  for (int step = 0; step < 10; step++) {
    if (remaining < 2) break;
    remaining /= 2;
    maxLevel++;
  }
  float lod = clamp(log2(max(footprint, 1.0)), 0.0, float(maxLevel));
  float lower = floor(lod);
  vec4 color = mix(sampleStripLevel(lower), sampleStripLevel(ceil(lod)), fract(lod)) * vOpacity;
  if (color.a <= 0.001) discard;
  outColor = color * heprVectorClipAA(vWorld, clipAAWidth);
}
`;
